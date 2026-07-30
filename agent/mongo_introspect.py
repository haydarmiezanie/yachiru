"""MongoDB schema introspection.

MongoDB has no enforced schema, so "the schema" here is inferred by sampling
documents and tracking, per field: observed BSON types, null ratio,
approximate cardinality, and array/nested shape.

Limitations (read before trusting the output):
- Sampling is statistical, not exhaustive. A collection with schema drift
  across time (e.g. a field added last quarter) may show a null ratio for
  that field that does not reflect its role in current writes.
- Cardinality is *approximate* and capped to avoid loading huge distinct
  sets into memory; treat it as a signal, not an exact count.
- Nested documents are only inspected up to `max_nested_depth`. Beyond that
  they are treated as opaque and flagged for manual review.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo import MongoClient

MAX_DISTINCT_TRACKED = 2000  # cap so cardinality tracking can't blow up memory


@dataclass
class FieldStat:
    name: str
    bson_types: Counter = field(default_factory=Counter)
    null_count: int = 0
    present_count: int = 0
    distinct_values: set = field(default_factory=set)
    is_array: bool = False
    array_elem_types: Counter = field(default_factory=Counter)
    max_str_len: int = 0
    numeric_min: float | None = None
    numeric_max: float | None = None
    nested_fields: dict[str, "FieldStat"] | None = None

    def cardinality_ratio(self, sample_size: int) -> float:
        if sample_size == 0:
            return 0.0
        return len(self.distinct_values) / sample_size

    def null_ratio(self, sample_size: int) -> float:
        if sample_size == 0:
            return 0.0
        return self.null_count / sample_size

    def dominant_type(self) -> str | None:
        if not self.bson_types:
            return None
        return self.bson_types.most_common(1)[0][0]


def _bson_type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, ObjectId):
        return "objectId"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "double"
    if isinstance(value, str):
        return "string"
    if isinstance(value, datetime):
        return "date"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _track_field(stats: dict[str, FieldStat], path: str, value: Any, depth: int, max_depth: int) -> None:
    stat = stats.setdefault(path, FieldStat(name=path))
    stat.present_count += 1

    if value is None:
        stat.null_count += 1
        stat.bson_types["null"] += 1
        return

    type_name = _bson_type_name(value)
    stat.bson_types[type_name] += 1

    if len(stat.distinct_values) < MAX_DISTINCT_TRACKED:
        try:
            stat.distinct_values.add(value if not isinstance(value, (list, dict)) else str(value)[:200])
        except TypeError:
            pass

    if isinstance(value, str):
        stat.max_str_len = max(stat.max_str_len, len(value))
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        stat.numeric_min = value if stat.numeric_min is None else min(stat.numeric_min, value)
        stat.numeric_max = value if stat.numeric_max is None else max(stat.numeric_max, value)
    elif isinstance(value, list):
        stat.is_array = True
        for elem in value[:50]:  # cap per-doc array scan
            stat.array_elem_types[_bson_type_name(elem)] += 1
    elif isinstance(value, dict):
        if depth < max_depth:
            if stat.nested_fields is None:
                stat.nested_fields = {}
            for k, v in value.items():
                _track_field(stat.nested_fields, k, v, depth + 1, max_depth)
        # beyond max_depth: left as an opaque "object" type for the caller to flag


def introspect_collection(
    uri: str,
    database: str,
    collection: str,
    sample_size: int = 1000,
    max_nested_depth: int = 2,
) -> dict[str, Any]:
    """Sample a MongoDB collection and infer a per-field schema.

    Returns: collection, sample_size (actual), total_doc_count (estimated),
    fields (name -> FieldStat), index_specs (existing indexes - used
    elsewhere as a proxy signal for access patterns).
    """
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    coll = client[database][collection]

    total_doc_count = coll.estimated_document_count()
    n = min(sample_size, total_doc_count) if total_doc_count else sample_size

    cursor = coll.aggregate([{"$sample": {"size": n}}]) if total_doc_count > n else coll.find().limit(n)

    field_stats: dict[str, FieldStat] = {}
    actual_sampled = 0
    for doc in cursor:
        actual_sampled += 1
        for k, v in doc.items():
            if k == "_id":
                continue  # always ObjectId/monotonic, handled as a fixed special-case elsewhere
            _track_field(field_stats, k, v, depth=0, max_depth=max_nested_depth)

    index_info = coll.index_information()
    index_specs = {name: spec.get("key", []) for name, spec in index_info.items()}

    client.close()

    return {
        "collection": collection,
        "sample_size": actual_sampled,
        "total_doc_count": total_doc_count,
        "fields": field_stats,
        "index_specs": index_specs,
    }
