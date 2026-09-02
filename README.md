# ⚡ Yachiru: ClickHouse Optimization & Health Advisor

A developer-grade, zero-mutation audit and optimization platform for ClickHouse. **Yachiru** inspects your cluster across 9 critical dimensions, correlates schema definitions with real-time `system.query_log` workload telemetry, generates executable DDL migration scripts, and provides optional AI-assisted deep diagnostic summaries via Google Gemini and OpenAI.

---

## 🌟 Key Features

- **🔍 9-Dimension Deterministic Scanner**:
  1. **Table Engines & Partitioning**: Detects non-MergeTree tables, excessive partition granularity, and invalid key distributions.
  2. **Parts & Merges Lifecycle**: Flags part fragmentation, small insert spikes, missing `async_insert`, and long-running merges.
  3. **Primary Key & Query Matching**: Highlights unindexed filter scans, sorting key mismatches, and projection candidates.
  4. **Data Skipping Indexes**: Identifies missing `minmax`, `set`, `bloom_filter`, and `tokenbf_v1` indexes on heavy filter paths.
  5. **Data Types & Storage**: Identifies `Nullable` overuse, missing `LowCardinality`, and uncompressed timestamp/metric columns (e.g. `DoubleDelta`, `Gorilla`, `ZSTD`).
  6. **TTL & Storage Tiering**: Detects unbounded tables without TTL and missing multi-volume warm/cold storage policies.
  7. **Materialized Views & Redundant Compute**: Identifies repetitive expensive aggregations that should be pre-computed.
  8. **Cluster Resource & Settings**: Audits memory limits, thread pools, and external aggregation settings.
  9. **Query Performance & Bottlenecks**: Analyzes slow queries, high RAM consumers, read-to-result ratios, and recurring exceptions.

- **🤖 Dual-Engine AI Diagnostic Synthesis**:
  - Deep architectural summaries powered by **Google Gemini** (`gemini-3.7-flash`, etc.) and **OpenAI** (`gpt-4o`, `gpt-4o-mini`).
  - Token-minimized prompt payloads with deterministic offline fallbacks when AI is disabled.

- **🛡️ Enterprise-Grade Security & Safety**:
  - **Zero-Mutation**: Read-only queries against `system.*` tables.
  - **SQL Injection Prevention**: Strict ClickHouse identifier validation and escaping.
  - **Server Hardening**: Helmet HTTP headers, CORS origin whitelisting, and multi-tier rate limiting.
  - **Data Privacy & PII Redaction**: Automatic regex masking of literal query parameters and credentials prior to disk persistence.
  - **Optional API Key Authentication**: Protect your auditing endpoints via `x-api-key` or `Authorization: Bearer`.

- **📜 Automated Migration Scripts**:
  - Generates ready-to-review SQL migration scripts with column inference and staging safety disclaimers.

- **📊 Modern Web UI & Presets**:
  - Clean, high-contrast dashboard with live metrics, interactive findings breakdown, copyable DDL, and historical scan comparison.
  - 4 built-in realistic demo datasets (*Apex E-commerce*, *Nexus IoT*, *FinPulse Ledger*, *CloudTrace Logs*) for instant testing.

---

## 🐳 Quickstart with Docker

### Option 1: Docker Compose (Recommended)

```bash
docker compose up -d
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Option 2: Standalone Docker

```bash
# Build image
docker build -t yachiru:latest .

# Run container with persistent storage volume
docker run -d \
  --name yachiru \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e GEMINI_API_KEY="your-gemini-api-key-optional" \
  -v yachiru_data:/app/data \
  --restart unless-stopped \
  yachiru:latest
```

---

## 🛡️ ClickHouse Least-Privilege Auditing User

Run the following SQL in your ClickHouse instance to set up a dedicated read-only auditing account:

```sql
-- 1. Create auditing user
CREATE USER yachiru_readonly IDENTIFIED WITH sha256_password BY 'YourSecurePasswordHere!';

-- 2. Grant read access to diagnostic system tables
GRANT SELECT ON system.tables TO yachiru_readonly;
GRANT SELECT ON system.columns TO yachiru_readonly;
GRANT SELECT ON system.parts TO yachiru_readonly;
GRANT SELECT ON system.merges TO yachiru_readonly;
GRANT SELECT ON system.query_log TO yachiru_readonly;
GRANT SELECT ON system.settings TO yachiru_readonly;
GRANT SELECT ON system.part_log TO yachiru_readonly;

-- 3. Grant SELECT on target databases for schema & cardinality inspection
GRANT SELECT ON target_db.* TO yachiru_readonly;
```

---

## ⚙️ Environment Variables

Configure these settings in your `.env` file or environment:

| Variable | Description | Required | Default |
|---|---|---|---|
| `PORT` | HTTP Port for the application | No | `3000` |
| `NODE_ENV` | Environment mode (`production` / `development`) | No | `development` |
| `GEMINI_API_KEY` | Google Gemini API key for AI synthesis | No | - |
| `OPENAI_API_KEY` | OpenAI API key for AI synthesis | No | - |
| `YACHIRU_API_KEY` | Secret API key to require `x-api-key` / `Bearer` authentication | No | *(Disabled)* |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | No | `*` |
| `LOG_LEVEL` | Structured logging level (`fatal`, `error`, `warn`, `info`, `debug`) | No | `info` |

---

## 💻 Local Development & Testing

```bash
# 1. Install dependencies
npm install

# 2. Run local development server (Express + Vite)
npm run dev

# 3. Run unit tests with Vitest
npm test

# 4. Type check & lint
npm run lint

# 5. Production build
npm run build
npm start
```

---

## 🔌 API Reference

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | Service health and AI capability status | No |
| `GET` | `/api/demo-clusters` | List available demo dataset profiles | No |
| `POST` | `/api/clickhouse/test-connection` | Verify ClickHouse connectivity & permissions | If configured |
| `POST` | `/api/clickhouse/scan` | Execute 9-dimension health scan & AI synthesis | If configured |
| `GET` | `/api/history` | Retrieve historical scan summary list | If configured |
| `GET` | `/api/history/:id` | Retrieve full scan report by ID | If configured |
| `DELETE`| `/api/history` | Clear stored scan history | If configured |

---

## 📄 License

MIT License. Designed for ClickHouse administrators, platform engineers, and data teams.
