"""Configuration loading for the schema-optimization agent.

All settings are read from environment variables (optionally via a .env
file). Nothing here talks to a network - it only resolves configuration.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass
class MongoConfig:
    uri: str
    database: str


@dataclass
class ClickHouseConfig:
    host: str
    port: int
    user: str
    password: str
    database: str


@dataclass
class LLMConfig:
    api_key: str
    model: str = "claude-sonnet-5"


def get_mongo_config(uri: str | None = None, database: str | None = None) -> MongoConfig:
    return MongoConfig(
        uri=uri or os.environ.get("MONGO_URI", "mongodb://localhost:27017"),
        database=database or os.environ.get("MONGO_DB", ""),
    )


def get_clickhouse_config(
    host: str | None = None,
    port: int | None = None,
    user: str | None = None,
    password: str | None = None,
    database: str | None = None,
) -> ClickHouseConfig:
    return ClickHouseConfig(
        host=host or os.environ.get("CLICKHOUSE_HOST", "localhost"),
        port=port or int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        user=user or os.environ.get("CLICKHOUSE_USER", "default"),
        password=password or os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=database or os.environ.get("CLICKHOUSE_DATABASE", "default"),
    )


def get_llm_config() -> LLMConfig:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY belum di-set. Isi di file .env atau environment "
            "variable sebelum menjalankan agent."
        )
    return LLMConfig(
        api_key=api_key,
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5"),
    )
