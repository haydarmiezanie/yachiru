"""ClickHouse introspection: current DDL, compression stats, partition
health, cardinality sampling, and a best-effort read of query_log to see
which columns are actually used in WHERE / GROUP BY clauses.

Limitation: extracting filter/group-by columns from raw query text is done
via the LLM reasoning layer (see agent.llm_reasoning.extract_query_patterns),
not a full SQL parser. Treat it as a strong hint, not ground truth - it's
worth a human skim of the top queries before finalizing ORDER BY.
"""
from __future__ import annotations

import re
from typing import Any

import clickhouse_connect


def get_client(host: str, port: int, user: str, password: str, database: str):
    return clickhouse_connect.get_client(
        host=host, port=port, username=user, password=password, database=database
    )


def get_table_ddl(client, database: str, table: str) -> str:
    result = client.query(f"SHOW CREATE TABLE `{database}`.`{table}`")
    return result.result_rows[0][0]


def get_column_stats(client, database: str, table: str) -> list[dict[str, Any]]:
    """Per-column compression stats from system.columns."""
    query = """
        SELECT name, type, compression_codec,
               data_compressed_bytes, data_uncompressed_bytes
        FROM system.columns
        WHERE database = {database:String} AND table = {table:String}
    """
    result = client.query(query, parameters={"database": database, "table": table})
    rows = []
    for name, ch_type, codec, compressed, uncompressed in result.result_rows:
        ratio = (uncompressed / compressed) if compressed else None
        rows.append({
            "name": name,
            "type": ch_type,
            "codec": codec or "(default)",
            "compressed_bytes": compressed,
            "uncompressed_bytes": uncompressed,
            "compression_ratio": round(ratio, 2) if ratio else None,
        })
    return rows


def get_row_count(client, database: str, table: str) -> int:
    result = client.query(f"SELECT count() FROM `{database}`.`{table}`")
    return result.result_rows[0][0]


def get_cardinality_ratios(
    client, database: str, table: str, columns: list[str], row_count: int
) -> dict[str, float]:
    """Approximate distinct-value ratio per column using ClickHouse's fast
    approximate uniq(). Only worth running on string-like columns.

    Note: this issues one query per column. Fine for a handful of candidate
    columns; for tables with hundreds of string columns, consider sampling
    (SELECT ... FROM table SAMPLE 0.1) instead of a full scan.
    """
    ratios: dict[str, float] = {}
    if row_count == 0:
        return ratios
    for col in columns:
        try:
            result = client.query(f"SELECT uniq(`{col}`) FROM `{database}`.`{table}`")
            distinct = result.result_rows[0][0]
            ratios[col] = distinct / row_count
        except Exception:
            continue
    return ratios


def get_partition_stats(client, database: str, table: str) -> list[dict[str, Any]]:
    query = """
        SELECT partition, count() AS part_count, sum(rows) AS total_rows,
               sum(bytes_on_disk) AS total_bytes
        FROM system.parts
        WHERE database = {database:String} AND table = {table:String} AND active = 1
        GROUP BY partition
        ORDER BY partition
    """
    result = client.query(query, parameters={"database": database, "table": table})
    return [
        {"partition": p, "part_count": pc, "total_rows": tr, "total_bytes": tb}
        for p, pc, tr, tb in result.result_rows
    ]


def check_overpartitioning(partition_stats: list[dict[str, Any]], small_partition_mb: int = 50) -> list[str]:
    """Heuristic checks for common over-partitioning symptoms."""
    warnings = []
    if len(partition_stats) > 1000:
        warnings.append(
            f"Terdapat {len(partition_stats)} partisi aktif - jumlah ini biasanya "
            "indikasi partition key terlalu granular untuk volume data ini."
        )
    small = [p for p in partition_stats if p["total_bytes"] < small_partition_mb * 1024 * 1024]
    if len(small) > len(partition_stats) * 0.3 and len(partition_stats) > 10:
        warnings.append(
            f"{len(small)} dari {len(partition_stats)} partisi berukuran di bawah "
            f"{small_partition_mb}MB - banyak partisi kecil menambah overhead merge "
            "tanpa manfaat query performance yang sebanding."
        )
    return warnings


def get_recent_queries(client, database: str, table: str, days: int = 30, limit: int = 200) -> list[str]:
    """Best-effort fetch of recent SELECT queries that reference this table.

    Requires query_log to be enabled and retained for the lookback window.
    Returns raw query text - column extraction happens in the LLM layer.
    Degrades to an empty list (not an exception) if query_log isn't usable,
    so callers can distinguish "no workload data" from a crash.
    """
    query = """
        SELECT query
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND query_kind = 'Select'
          AND event_time >= now() - INTERVAL {days:UInt32} DAY
          AND positionCaseInsensitive(query, {table:String}) > 0
        ORDER BY event_time DESC
        LIMIT {limit:UInt32}
    """
    try:
        result = client.query(query, parameters={"days": days, "table": table, "limit": limit})
        return [row[0] for row in result.result_rows]
    except Exception:
        return []


def parse_ddl_engine_and_keys(ddl: str) -> dict[str, str | None]:
    """Small regex-based extraction of ENGINE / ORDER BY / PARTITION BY from
    a SHOW CREATE TABLE string. Good enough for reporting; not a full SQL
    parser, so unusual formatting may not match - falls back to None."""

    def _find(pattern: str) -> str | None:
        m = re.search(pattern, ddl, re.IGNORECASE | re.DOTALL)
        return m.group(1).strip() if m else None

    return {
        "engine": _find(r"ENGINE\s*=\s*([A-Za-z0-9_]+(?:\([^)]*\))?)"),
        "order_by": _find(r"ORDER BY\s*(\([^)]*\)|[^\s]+)"),
        "partition_by": _find(r"PARTITION BY\s*(\([^)]*\)|[^\s]+)"),
    }
