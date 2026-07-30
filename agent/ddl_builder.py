"""Builds a proposed ClickHouse CREATE TABLE statement from column decisions.

Pure string assembly - no network calls. This module never decides *what*
type/codec/engine to use; it only renders decisions made in mapping_rules
(and, for ambiguous cases, llm_reasoning) into valid DDL syntax.
"""
from __future__ import annotations

from agent.mapping_rules import ColumnDecision


def build_create_table(
    database: str,
    table: str,
    columns: list[ColumnDecision],
    engine: str,
    order_by: str,
    partition_by: str | None,
) -> str:
    column_lines = []
    for c in columns:
        codec_sql = f" CODEC({c.codec})" if c.codec else ""
        column_lines.append(f"    `{c.name}` {c.new_type}{codec_sql}")

    lines = [f"CREATE TABLE `{database}`.`{table}` (", ",\n".join(column_lines), ")"]
    lines.append(f"ENGINE = {engine}")
    if partition_by:
        lines.append(f"PARTITION BY {partition_by}")
    lines.append(f"ORDER BY {order_by}")
    return "\n".join(lines) + ";"
