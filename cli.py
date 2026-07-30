"""CLI entrypoint for the MongoDB -> ClickHouse schema optimization agent.

Two commands:
  convert-mongo     : introspect a MongoDB collection, propose an optimized
                       ClickHouse DDL, and generate the full report.
  check-clickhouse   : assess whether an existing ClickHouse table is already
                       optimized, using its DDL, compression stats, partition
                       health, and (best-effort) recent query_log.

Nothing in this CLI executes DDL against ClickHouse. Output is always a
proposal in a markdown report for a human to review and apply manually.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import typer

from agent import clickhouse_introspect as ch
from agent import ddl_builder
from agent import llm_reasoning as llm
from agent import mapping_rules as rules
from agent import mongo_introspect as mongo
from agent import report as report_mod

app = typer.Typer(add_completion=False, help="MongoDB -> ClickHouse schema optimization agent")


def _write_report(content: str, out_dir: str, name: str) -> Path:
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    path = Path(out_dir) / f"{name}_{ts}.md"
    path.write_text(content, encoding="utf-8")
    return path


@app.command("convert-mongo")
def convert_mongo(
    mongo_uri: str = typer.Option(..., "--mongo-uri", envvar="MONGO_URI"),
    mongo_db: str = typer.Option(..., "--mongo-db"),
    collection: str = typer.Option(..., "--collection"),
    ch_database: str = typer.Option(..., "--ch-database", help="Target database name in the proposed DDL"),
    ch_table: str = typer.Option(..., "--ch-table", help="Target table name in the proposed DDL"),
    sample_size: int = typer.Option(1000, "--sample-size"),
    out_dir: str = typer.Option("./reports", "--out-dir"),
) -> None:
    """Introspect a MongoDB collection and propose an optimized ClickHouse DDL."""
    typer.echo(f"Sampling {sample_size} dokumen dari {mongo_db}.{collection}...")
    schema = mongo.introspect_collection(mongo_uri, mongo_db, collection, sample_size)
    sample_n = schema["sample_size"]
    typer.echo(f"Berhasil sample {sample_n} dokumen dari total ~{schema['total_doc_count']}.")

    decisions: list[rules.ColumnDecision] = []
    for name, stat in schema["fields"].items():
        decision = rules.map_field(stat, sample_n)
        if decision.confidence == "needs_review" and decision.old_type == "object":
            typer.echo(f"  -> field '{name}' nested, minta Claude resolve strategi mapping...")
            sample_vals = list(stat.distinct_values)[:5]
            resolved = llm.resolve_nested_field(name, sample_vals)
            decision.new_type = resolved.get("proposed_type", decision.new_type)
            decision.reason = resolved.get("reason", decision.reason)
        decisions.append(decision)

    engine, engine_reason, engine_conf = rules.suggest_engine(schema["fields"])
    partition_expr, partition_reason, part_conf = rules.suggest_partition_key(schema["fields"])

    # Mongo indexes as a proxy signal for ORDER BY, since there's no ClickHouse
    # query_log yet for a table that doesn't exist.
    index_hint_cols = sorted({col for spec in schema["index_specs"].values() for col, _ in spec})
    order_by_cols = [c for c in index_hint_cols if c in schema["fields"]] or [decisions[0].name]
    if index_hint_cols:
        order_by_reason = (
            f"Berdasarkan index MongoDB existing pada kolom {index_hint_cols} - dipakai sebagai "
            "proxy pola akses karena belum ada query_log ClickHouse untuk tabel baru ini. "
            "STATUS: asumsi, bukan konfirmasi - validasi dengan pola query aktual setelah data masuk."
        )
    else:
        order_by_reason = (
            "Tidak ada index MongoDB yang bisa dipakai sebagai sinyal - ORDER BY dipilih dari "
            "kolom pertama sebagai placeholder. WAJIB direvisi manual berdasarkan pola query nyata."
        )

    proposed_ddl = ddl_builder.build_create_table(
        database=ch_database,
        table=ch_table,
        columns=decisions,
        engine=engine,
        order_by=f"({', '.join(order_by_cols)})",
        partition_by=partition_expr,
    )

    typer.echo("Menyusun final recommendation lewat Claude...")
    final_rec = llm.generate_final_recommendation({
        "source": f"MongoDB {mongo_db}.{collection}",
        "target": f"ClickHouse {ch_database}.{ch_table}",
        "engine": engine,
        "engine_confidence": engine_conf,
        "partition": partition_expr,
        "partition_confidence": part_conf,
        "order_by": order_by_cols,
        "order_by_confidence": "needs_review" if index_hint_cols else "low",
        "columns_needing_review": [c.name for c in decisions if c.confidence == "needs_review"],
    })

    content = report_mod.build_report(
        title=f"Schema optimization report: {mongo_db}.{collection} -> {ch_database}.{ch_table}",
        current_ddl=None,
        proposed_ddl=proposed_ddl,
        columns=decisions,
        partition_reason=f"{partition_reason}\n\n**ORDER BY reasoning:** {order_by_reason}",
        engine_reason=engine_reason,
        final_recommendation=final_rec,
    )
    path = _write_report(content, out_dir, f"{mongo_db}_{collection}_to_ch")
    typer.echo(f"Report tersimpan di: {path}")


@app.command("check-clickhouse")
def check_clickhouse(
    host: str = typer.Option(..., "--host", envvar="CLICKHOUSE_HOST"),
    port: int = typer.Option(8123, "--port"),
    user: str = typer.Option("default", "--user"),
    password: str = typer.Option("", "--password"),
    database: str = typer.Option(..., "--database"),
    table: str = typer.Option(..., "--table"),
    days: int = typer.Option(30, "--days", help="Query log lookback window in days"),
    out_dir: str = typer.Option("./reports", "--out-dir"),
) -> None:
    """Assess whether an existing ClickHouse table is already optimized."""
    client = ch.get_client(host, port, user, password, database)

    typer.echo("Mengambil DDL existing...")
    current_ddl = ch.get_table_ddl(client, database, table)
    parsed = ch.parse_ddl_engine_and_keys(current_ddl)

    typer.echo("Mengambil statistik kompresi per kolom...")
    column_stats = ch.get_column_stats(client, database, table)

    typer.echo("Mengambil statistik partisi...")
    partition_stats = ch.get_partition_stats(client, database, table)
    overpartition_warnings = ch.check_overpartitioning(partition_stats)

    typer.echo("Menghitung cardinality kolom string (uniq approx)...")
    row_count = ch.get_row_count(client, database, table)
    string_cols = [c["name"] for c in column_stats if "String" in c["type"] and "LowCardinality" not in c["type"]]
    cardinality_ratios = ch.get_cardinality_ratios(client, database, table, string_cols, row_count)

    typer.echo(f"Mengambil {days} hari query_log terakhir...")
    recent_queries = ch.get_recent_queries(client, database, table, days=days)
    known_columns = [c["name"] for c in column_stats]
    query_patterns = llm.extract_query_patterns(recent_queries, known_columns)

    decisions = []
    for c in column_stats:
        ratio = cardinality_ratios.get(c["name"])
        new_type, new_codec, reason = rules.suggest_codec_for_existing_column(
            c["name"], c["type"], c["codec"], ratio
        )
        decisions.append(rules.ColumnDecision(
            name=c["name"], old_type=c["type"], new_type=new_type, codec=new_codec,
            confidence="high",
            reason=f"{reason} (compression ratio saat ini ~{c['compression_ratio']}x)",
        ))

    partition_summary = (
        f"Partition key saat ini: `{parsed['partition_by']}`. "
        f"Jumlah partisi aktif: {len(partition_stats)}.\n\n"
        + ("\n".join(f"- {w}" for w in overpartition_warnings) if overpartition_warnings
           else "- Tidak ada indikasi over-partitioning dari jumlah/ukuran partisi.")
    )
    engine_summary = f"Engine saat ini: `{parsed['engine']}`."

    filter_cols = [
        f["column"] for f in query_patterns.get("filter_columns", [])
        if f.get("frequency_estimate") == "high"
    ]
    proposed_order_by = f"({', '.join(filter_cols)})" if filter_cols else (parsed["order_by"] or "(tuple())")
    proposed_engine = parsed["engine"] or "MergeTree"
    proposed_partition = parsed["partition_by"]

    proposed_ddl = ddl_builder.build_create_table(
        database=database, table=table, columns=decisions,
        engine=proposed_engine, order_by=proposed_order_by, partition_by=proposed_partition,
    )

    typer.echo("Menyusun final recommendation lewat Claude...")
    final_rec = llm.generate_final_recommendation({
        "table": f"{database}.{table}",
        "current_engine": parsed["engine"],
        "current_order_by": parsed["order_by"],
        "current_partition_by": parsed["partition_by"],
        "proposed_order_by": proposed_order_by,
        "filter_columns_from_query_log": filter_cols,
        "overpartition_warnings": overpartition_warnings,
        "query_pattern_findings": query_patterns,
        "query_log_sample_count": len(recent_queries),
        "column_compression_summary": [
            {"name": c["name"], "codec": c["codec"], "ratio": c["compression_ratio"]}
            for c in column_stats
        ],
    })

    content = report_mod.build_report(
        title=f"Schema optimization assessment: {database}.{table}",
        current_ddl=current_ddl,
        proposed_ddl=proposed_ddl,
        columns=decisions,
        partition_reason=partition_summary,
        engine_reason=engine_summary,
        final_recommendation=final_rec,
    )
    path = _write_report(content, out_dir, f"{database}_{table}_assessment")
    typer.echo(f"Report tersimpan di: {path}")


if __name__ == "__main__":
    app()
