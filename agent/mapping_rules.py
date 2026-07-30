"""Deterministic rules engine: BSON -> ClickHouse type/codec/engine mapping.

Everything in this module is pure logic - no network calls, no LLM. This is
intentional: type mapping, codec defaults, and over-partitioning checks have
objectively defensible answers given the observed data, so they should not
depend on a model's judgement (or its ability to hallucinate a plausible-
looking wrong answer). The LLM reasoning layer (agent.llm_reasoning) only
kicks in for genuinely ambiguous decisions this module can't resolve safely.

Every function that produces a recommendation also produces a `confidence`
label:
  "high"          - determined directly from observed data/types, low risk.
  "needs_review"  - a reasonable default, but depends on workload assumptions
                    (access patterns, write behaviour) not confirmed by data.
  "low"           - not enough signal to recommend anything specific.
This distinction is what makes it into the final report - don't drop it
when wiring these into the CLI.
"""
from __future__ import annotations

from dataclasses import dataclass

from agent.mongo_introspect import FieldStat

LOW_CARDINALITY_RATIO_THRESHOLD = 0.05
LOW_CARDINALITY_MAX_DISTINCT = 10_000
MONOTONIC_NAME_HINTS = ("created_at", "createdat", "timestamp", "event_time", "_ts", "updated_at")


@dataclass
class ColumnDecision:
    name: str
    old_type: str
    new_type: str
    codec: str
    confidence: str  # "high" | "needs_review" | "low"
    reason: str


def _int_type_for_range(min_v: float, max_v: float) -> str:
    if min_v >= 0:
        if max_v < 2**8:
            return "UInt8"
        if max_v < 2**16:
            return "UInt16"
        if max_v < 2**32:
            return "UInt32"
        return "UInt64"
    if -(2**7) <= min_v and max_v < 2**7:
        return "Int8"
    if -(2**15) <= min_v and max_v < 2**15:
        return "Int16"
    if -(2**31) <= min_v and max_v < 2**31:
        return "Int32"
    return "Int64"


def map_field(stat: FieldStat, sample_size: int) -> ColumnDecision:
    """Map a MongoDB field (from mongo_introspect) to a proposed ClickHouse
    column definition. Used by the convert-mongo path."""
    dominant = stat.dominant_type()
    null_ratio = stat.null_ratio(sample_size)
    cardinality_ratio = stat.cardinality_ratio(sample_size)
    nullable = null_ratio > 0.0

    def wrap_nullable(t: str) -> str:
        return f"Nullable({t})" if nullable else t

    if dominant == "objectId":
        return ColumnDecision(
            stat.name, "ObjectId", wrap_nullable("FixedString(12)"), "ZSTD", "high",
            "ObjectId disimpan sebagai 12-byte binary (FixedString) untuk hemat "
            "ruang; ganti ke String(24) kalau butuh representasi hex yang mudah dibaca.",
        )

    if dominant == "bool":
        return ColumnDecision(stat.name, "Boolean", wrap_nullable("Bool"), "ZSTD", "high",
                               "Mapping langsung, tidak ada ambiguitas.")

    if dominant == "int":
        if stat.numeric_min is not None and stat.numeric_max is not None:
            ch_type = _int_type_for_range(stat.numeric_min, stat.numeric_max)
        else:
            ch_type = "Int64"
        is_monotonic_name = any(h in stat.name.lower() for h in MONOTONIC_NAME_HINTS)
        codec = "Delta, ZSTD" if is_monotonic_name else "ZSTD"
        reason = (
            f"Range data aktual {stat.numeric_min}..{stat.numeric_max} muat di {ch_type}, "
            "dipilih tipe integer terkecil yang cukup untuk hemat storage."
        )
        if is_monotonic_name:
            reason += " Nama kolom mengindikasikan nilai monoton naik, jadi ditambah Delta codec."
        return ColumnDecision(stat.name, "int", wrap_nullable(ch_type), codec, "high", reason)

    if dominant == "double":
        return ColumnDecision(
            stat.name, "double", wrap_nullable("Float64"), "ZSTD", "high",
            "Mapping langsung ke Float64. Kalau ini nilai finansial yang butuh "
            "presisi eksak, pertimbangkan Decimal(P,S) - perlu cek manual.",
        )

    if dominant == "string":
        if cardinality_ratio < LOW_CARDINALITY_RATIO_THRESHOLD and len(stat.distinct_values) < LOW_CARDINALITY_MAX_DISTINCT:
            new_type = wrap_nullable("LowCardinality(String)")
            reason = (
                f"Cardinality ratio ~{cardinality_ratio:.3f} dari sample - cukup rendah "
                "untuk LowCardinality(String), mengurangi ukuran storage & mempercepat filter."
            )
        else:
            new_type = wrap_nullable("String")
            reason = f"Cardinality ratio ~{cardinality_ratio:.3f} - terlalu tinggi untuk LowCardinality."
        return ColumnDecision(stat.name, "string", new_type, "ZSTD", "high", reason)

    if dominant == "date":
        is_monotonic_name = any(h in stat.name.lower() for h in MONOTONIC_NAME_HINTS)
        codec = "Delta, ZSTD" if is_monotonic_name else "ZSTD"
        return ColumnDecision(
            stat.name, "date", wrap_nullable("DateTime64(3)"), codec, "high",
            "MongoDB date presisinya milidetik, dipetakan ke DateTime64(3) agar tidak kehilangan presisi.",
        )

    if stat.is_array:
        elem_dominant = stat.array_elem_types.most_common(1)[0][0] if stat.array_elem_types else "string"
        inner = {"int": "Int64", "double": "Float64", "string": "String", "bool": "Bool"}.get(elem_dominant, "String")
        return ColumnDecision(
            stat.name, "array", f"Array({inner})", "ZSTD", "needs_review",
            f"Elemen array didominasi tipe {elem_dominant}. Kalau tipe elemen "
            "bercampur di produksi, mapping ini perlu direview manual - array "
            "heterogen tidak bisa direpresentasikan bersih sebagai Array(T).",
        )

    if dominant == "object":
        return ColumnDecision(
            stat.name, "object", "Tuple(...) / JSON (perlu keputusan)", "ZSTD", "needs_review",
            "Nested document terdeteksi. Strategi mapping (flatten ke kolom "
            "terpisah, Tuple bertipe tetap, atau JSON type) tergantung stabilitas "
            "struktur field ini - diserahkan ke lapisan reasoning.",
        )

    return ColumnDecision(
        stat.name, dominant or "unknown", "String", "ZSTD", "needs_review",
        f"Tipe '{dominant}' tidak punya mapping baku, default ke String - perlu direview manual.",
    )


def suggest_codec_for_existing_column(
    name: str, ch_type: str, current_codec: str, cardinality_ratio: float | None
) -> tuple[str, str, str]:
    """For a column that already exists in ClickHouse (check-clickhouse path):
    only proposes a change when there's a concrete, structural reason to.
    Returns (suggested_type, suggested_codec, reason)."""
    reasons = []
    suggested_type = ch_type
    suggested_codec = current_codec if current_codec != "(default)" else "ZSTD"

    is_stringy = "String" in ch_type and "LowCardinality" not in ch_type
    if is_stringy and cardinality_ratio is not None and cardinality_ratio < LOW_CARDINALITY_RATIO_THRESHOLD:
        suggested_type = f"LowCardinality({ch_type})"
        reasons.append(f"Cardinality ratio aktual ~{cardinality_ratio:.4f} - kandidat kuat untuk LowCardinality.")

    if any(h in name.lower() for h in MONOTONIC_NAME_HINTS) and current_codec in ("(default)", "ZSTD", ""):
        suggested_codec = "Delta, ZSTD"
        reasons.append("Nama kolom mengindikasikan nilai monoton naik - Delta codec biasanya menang signifikan di sini.")

    if not reasons:
        reasons.append("Tidak ada perubahan structural yang jelas dibutuhkan berdasarkan data yang tersedia.")

    return suggested_type, suggested_codec, " ".join(reasons)


def suggest_engine(field_stats: dict[str, FieldStat]) -> tuple[str, str, str]:
    """Returns (engine, reason, confidence). Used by the convert-mongo path."""
    update_hint_fields = [
        name for name in field_stats
        if any(h in name.lower() for h in ("updated_at", "updatedat", "_version", "version"))
    ]
    if update_hint_fields:
        version_col = update_hint_fields[0]
        return (
            f"ReplacingMergeTree({version_col})",
            f"Terdeteksi field '{version_col}' yang mengindikasikan dokumen ini "
            "bisa di-update di tempat (mutable), bukan append-only. ReplacingMergeTree "
            "dipilih supaya versi terbaru per key bisa di-dedup saat merge. "
            "PENTING: perlu dikonfirmasi manual apakah field ini benar dipakai sebagai versioning.",
            "needs_review",
        )
    return (
        "MergeTree",
        "Tidak ada indikasi dokumen bersifat mutable (tidak ada field versi/updated_at "
        "yang jelas) - MergeTree standar dipakai sebagai default untuk data append-only/event.",
        "needs_review",  # still an assumption about write pattern until the user confirms
    )


def suggest_partition_key(field_stats: dict[str, FieldStat]) -> tuple[str | None, str, str]:
    """Returns (partition_expr, reason, confidence). Used by convert-mongo."""
    date_fields = [name for name, s in field_stats.items() if s.dominant_type() == "date"]
    preferred = next((f for f in date_fields if any(h in f.lower() for h in MONOTONIC_NAME_HINTS)), None)
    chosen = preferred or (date_fields[0] if date_fields else None)
    if chosen:
        return (
            f"toYYYYMM(`{chosen}`)",
            f"'{chosen}' adalah kolom bertipe date yang paling mungkin merepresentasikan "
            "waktu event/insert. Granularitas bulanan dipilih sebagai default aman - "
            "sesuaikan ke harian/mingguan kalau volume data per bulan sangat besar "
            "(>~50GB/partisi) atau ke lebih kasar kalau volume kecil.",
            "needs_review",
        )
    return (
        None,
        "Tidak ditemukan kolom bertipe date yang jelas - tidak ada rekomendasi partition "
        "key otomatis. Perlu input manual soal kolom mana yang merepresentasikan waktu.",
        "low",
    )
