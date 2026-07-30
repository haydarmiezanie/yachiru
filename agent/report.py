"""Assembles the 6-section markdown report:
1. current table structure (DDL)
2. proposed table structure (DDL)
3. column review matrix
4. partitioning purpose and why
5. engine purpose and why
6. final recommendation
"""
from __future__ import annotations

from agent.mapping_rules import ColumnDecision


def _column_matrix(columns: list[ColumnDecision]) -> str:
    header = "| Column | Old type | New type | Compression | Confidence | Reason |\n"
    header += "|---|---|---|---|---|---|\n"
    rows = [
        f"| `{c.name}` | {c.old_type} | `{c.new_type}` | {c.codec} | {c.confidence} | {c.reason} |"
        for c in columns
    ]
    return header + "\n".join(rows)


def build_report(
    *,
    title: str,
    current_ddl: str | None,
    proposed_ddl: str,
    columns: list[ColumnDecision],
    partition_reason: str,
    engine_reason: str,
    final_recommendation: str,
) -> str:
    sections = [f"# {title}\n"]

    sections.append("## 1. Current table structure\n")
    sections.append(
        f"```sql\n{current_ddl}\n```" if current_ddl else
        "_Tidak ada tabel ClickHouse existing - ini konversi dari MongoDB._"
    )

    sections.append("\n## 2. Proposed table structure\n")
    sections.append(f"```sql\n{proposed_ddl}\n```")

    sections.append("\n## 3. Column review matrix\n")
    sections.append(_column_matrix(columns))

    sections.append("\n## 4. Partitioning: purpose and why\n")
    sections.append(partition_reason)

    sections.append("\n## 5. Engine: purpose and why\n")
    sections.append(engine_reason)

    sections.append("\n## 6. Final recommendation\n")
    sections.append(final_recommendation)

    return "\n".join(sections) + "\n"
