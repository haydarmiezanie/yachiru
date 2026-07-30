"""LLM reasoning layer.

This module is the ONLY place that calls the Anthropic API. It is used
strictly for judgement calls that the deterministic rules engine
(agent.mapping_rules) cannot make safely:
  - extracting likely filter/group-by columns from raw query_log text
  - resolving ambiguous nested-document mapping strategies
  - writing the final synthesized recommendation, with an explicit split
    between what's confirmed by data vs what's still an assumption

It never invents type mappings or codec choices - those always come from
agent.mapping_rules and are passed in as context, not regenerated here.
"""
from __future__ import annotations

import json
from typing import Any

import anthropic

from agent.config import get_llm_config


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=get_llm_config().api_key)


def _model() -> str:
    return get_llm_config().model


def _ask_json(system: str, user: str, max_tokens: int = 1500) -> Any:
    response = _client().messages.create(
        model=_model(),
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if "\n" in text:
            text = text.split("\n", 1)[1]
    return json.loads(text)


def extract_query_patterns(query_texts: list[str], known_columns: list[str]) -> dict[str, Any]:
    """Given raw recent query text, return likely filter/groupby/join columns.

    This is a heuristic read of query text, not a SQL parser - treat the
    output as a strong signal to verify, not ground truth.
    """
    if not query_texts:
        return {
            "filter_columns": [], "groupby_columns": [], "join_columns": [],
            "note": "Tidak ada query_log yang tersedia/terbaca untuk periode ini.",
        }

    system = (
        "Kamu menganalisis query SQL ClickHouse untuk menentukan kolom mana yang "
        "paling sering dipakai di WHERE, GROUP BY, dan JOIN. Balas HANYA dengan JSON valid, "
        "tanpa teks lain, format persis: "
        '{"filter_columns": [{"column": "...", "frequency_estimate": "high|medium|low"}], '
        '"groupby_columns": [{"column": "...", "frequency_estimate": "high|medium|low"}], '
        '"join_columns": [{"column": "...", "frequency_estimate": "high|medium|low"}]}'
    )
    user = (
        f"Kolom yang valid di tabel ini: {known_columns}\n\n"
        f"Query ({len(query_texts)} query terbaru, urut dari paling baru):\n"
        + "\n---\n".join(query_texts[:200])
    )
    try:
        return _ask_json(system, user, max_tokens=1500)
    except Exception as e:
        return {
            "filter_columns": [], "groupby_columns": [], "join_columns": [],
            "note": f"Gagal parsing response LLM: {e}",
        }


def resolve_nested_field(field_name: str, sample_values: list[Any]) -> dict[str, Any]:
    """Decide a mapping strategy for a nested/object field the rules engine
    flagged as needs_review."""
    system = (
        "Kamu memutuskan strategi mapping ClickHouse untuk satu field MongoDB "
        "bertipe nested object/array-of-object, berdasarkan contoh nilai yang diberikan. "
        "Balas HANYA JSON, format persis: "
        '{"strategy": "flatten|tuple|json_type", "proposed_type": "...", "reason": "..."}'
    )
    user = (
        f"Field: {field_name}\n"
        f"Contoh nilai (maks 5 sample, di-truncate): {json.dumps(sample_values[:5], default=str)[:3000]}"
    )
    try:
        return _ask_json(system, user, max_tokens=500)
    except Exception as e:
        return {"strategy": "json_type", "proposed_type": "JSON", "reason": f"Fallback default, LLM gagal: {e}"}


def generate_final_recommendation(context: dict[str, Any]) -> str:
    """Synthesize the final recommendation section. Must explicitly separate
    confirmed-by-data findings from assumptions still needing validation."""
    system = (
        "Kamu adalah asisten teknis yang menulis bagian 'final recommendation' dari "
        "laporan optimasi schema ClickHouse. Tulis dalam Bahasa Indonesia, ringkas "
        "(maksimal 200 kata), dan WAJIB pisahkan menjadi dua bagian eksplisit dengan "
        "heading: 'Sudah dikonfirmasi oleh data' dan 'Masih asumsi - perlu validasi manual'. "
        "Jangan membuat klaim yang tidak didukung oleh context yang diberikan. "
        "Jangan mengulang isi context mentah-mentah, sintesiskan jadi rekomendasi yang actionable."
    )
    user = json.dumps(context, default=str)[:6000]
    response = _client().messages.create(
        model=_model(),
        max_tokens=800,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(block.text for block in response.content if block.type == "text").strip()
