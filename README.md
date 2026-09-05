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

- **🔐 Team Access Control & RBAC (Firebase Auth + Firestore)**:
  - **Google OAuth & Email/Password**: Single-click sign-in and user onboarding.
  - **Role-Based Access Control (RBAC)**:
    - **Super Admin** (`idarstore24@gmail.com`): Unrestricted access, user approval management, and role promotion/revocation.
    - **Admin**: Manage member requests, adjust access levels, and configure audit parameters.
    - **Auditor**: Execute live cluster scans, inspect raw telemetry, test credentials, and generate migration DDL.
    - **Viewer**: Read-only access to health scorecards and historical audit trails.
  - **Access Request Workflow**: Automatic pending state for new registrants with approval dashboard for administrators.
  - **Strict Firestore Security Rules**: Profile creation locked to pending `viewer` role unless approved by an administrator.

- **🛡️ Enterprise-Grade Security & Safety**:
  - **Zero-Mutation**: Read-only queries against `system.*` tables.
  - **SQL Injection Prevention**: Strict ClickHouse identifier validation and escaping.
  - **Server Hardening**: Helmet HTTP headers, CORS origin whitelisting, and multi-tier rate limiting.
  - **Data Privacy & Query Sanitization (Best-Effort Heuristic & Zero-Raw-Query Mode)**:
    - **Heuristic Redaction (Default)**: Best-effort regex masking of string/numeric literals, passwords, API tokens, and emails in query logs prior to disk persistence. *(Note: Heuristic regex masking is a convenience layer, not a certified regulatory compliance boundary)*.
    - **Zero-Raw-Query Mode (`STORE_RAW_QUERIES=false` / `PRIVACY_PRESERVING_HISTORY=true`)**: For strict GDPR/enterprise compliance, entirely eliminates raw query storage on disk, storing only normalized structural AST skeletons and SHA-256 query fingerprints (`fp_<hash>`) for bug pattern deduplication.
  - **API Boundary Protection (`YACHIRU_API_KEY`)**: Protect your auditing backend endpoints via `x-api-key` or `Authorization: Bearer <key>`.
  - **Concurrency Mutex**: FIFO in-process asynchronous mutex around scan history operations ensuring zero lost updates during concurrent audits.

- **📜 Automated Migration Scripts**:
  - Generates ready-to-review SQL migration scripts with column inference and staging safety disclaimers.

- **📊 Modern Web UI & Presets**:
  - Clean, high-contrast dashboard with live metrics, interactive findings breakdown, copyable DDL, and historical scan comparison.
  - 4 built-in realistic demo datasets (*Apex E-commerce*, *Nexus IoT*, *FinPulse Ledger*, *CloudTrace Logs*) for instant testing.

---

## 🔒 Security Architecture: End-to-End Cryptographic RBAC

Yachiru enforces strict, server-side Role-Based Access Control (RBAC) across both the web portal and backend API endpoints:

| Layer | Technology | Enforcement & Scope |
|---|---|---|
| **End-User Authentication** | Firebase Auth (`Authorization: Bearer <ID_Token>`) | Cryptographically verified on the Express server via `firebase-admin/auth` (`verifyIdToken`). Token validity, expiration, and project binding are strictly enforced. |
| **Server-Side RBAC Enforcement** | `requireRole('viewer' \| 'auditor' \| 'admin')` | Queries user document from Firestore (via Admin SDK with REST fallback) to verify `status === 'approved'` and enforce the hierarchical role rank. |
| **Machine Service Account** | `YACHIRU_API_KEY` (`x-api-key`) | Grants authorized automated scripts, CI/CD runners, and headless workers access without requiring an interactive browser session. |

### Role Hierarchy & Endpoint Permissions:
- **`viewer` (Rank 0)**: Read-only access to health scorecards, scan history (`GET /api/history`), and report views (`GET /api/history/:id`). Direct API attempts by Viewers to trigger scans receive `403 Forbidden: Insufficient role`.
- **`auditor` (Rank 1)**: Authorized to execute live cluster scans (`POST /api/clickhouse/scan`), test database connections (`POST /api/clickhouse/test-connection`), and inspect query workloads. Blocked from deleting history.
- **`admin` (Rank 2)**: Full administrative control, including clearing historical audits (`DELETE /api/history`) and managing team access whitelist/approvals.
- **Super Admin** (`idarstore24@gmail.com`): Master administrator with automatic approval, full role promotion authority, and complete system oversight.

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

## 🔐 Data Privacy & Compliance: Heuristic Redaction vs. Zero-Raw-Query Mode

### ⚠️ Best-Effort Heuristic Sanitization Notice
By default, Yachiru applies regular-expression-based sanitization (`maskQueryPii`) to query samples in audit findings and `rawStats` before saving scan history to disk.

**Important Compliance Disclosure:**
- **Best-Effort Layer**: Regex-based masking is a heuristic hygiene measure to redact plain string literals, numeric comparison thresholds, email addresses, and obvious credential assignments (`password`, `token`, `api_key`).
- **Inherent Limitations**: Heuristic regexes **do not guarantee formal GDPR, HIPAA, or financial PII compliance**. Complex patterns—such as concatenated strings (`concat('val', 'ue')`), base64-encoded payloads, nested arrays, or unquoted JSON function expressions (`JSONExtractRaw`)—may evade pattern matching (*under-masking*). Conversely, non-sensitive structural clauses (*over-masking*) can occasionally be obscured.
- **Rule of Thumb**: Regex redaction should never be treated as the sole security boundary for regulated or multi-tenant production databases.

### 🛡️ Zero-Raw-Query / Privacy-Preserving History Mode
For enterprise environments with strict regulatory requirements, Yachiru provides **Zero-Raw-Query Mode** (`STORE_RAW_QUERIES=false` or `PRIVACY_PRESERVING_HISTORY=true`).

When enabled:
1. **Raw SQL Queries Are Completely Discarded**: No customer SQL statements, literal parameters, or raw query text are ever persisted to disk.
2. **Normalized AST Pattern Skeletons (`normalizeQueryPattern`)**: Variable literals, strings, tuples, and parameters are normalized into neutral placeholders (`?`), preserving only the structural query skeleton (e.g. `SELECT col1, col2 FROM table WHERE status = '?' AND amount > ? LIMIT ?`).
3. **Cryptographic Pattern Fingerprinting (`fingerprintQuery`)**: A deterministic SHA-256 hash (`fp_<16_hex_chars>`) is generated for each normalized pattern. This allows audit comparison, query frequency tracking, and bug deduplication across scans without exposing any proprietary or customer data.

```bash
# Enable in .env or Docker container for zero-raw-query compliance
STORE_RAW_QUERIES=false
# or
PRIVACY_PRESERVING_HISTORY=true
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
| `YACHIRU_API_KEY` | Secret API key to require `x-api-key` / `Bearer` authentication | No | *(None)* |
| `REQUIRE_API_KEY` | Enforce API authentication; defaults to `true` in production (fail-closed) | No | `true` (prod) / `false` (dev) |
| `STRICT_AUTH` | Block requests without valid credentials; defaults to `true` in production | No | `true` (prod) / `false` (dev) |
| `ALLOWED_ORIGINS` | Comma-separated whitelist of allowed CORS origins (fail-closed in production) | Prod only | *(APP_URL / Whitelist)* |
| `STORE_RAW_QUERIES` | Whether to store raw (heuristic-masked) SQL in history. Set to `false` for zero-raw-query mode | No | `true` |
| `PRIVACY_PRESERVING_HISTORY` | Alias for zero-raw-query mode. Discards all raw SQL; stores only fingerprints and patterns | No | `false` |
| `CLICKHOUSE_QUERY_TIMEOUT_MS` | Timeout in ms for scanner queries before aborting (prevents hanging connection exhaustion / DoS) | No | `10000` |
| `USE_FIRESTORE_HISTORY` | Store scan reports in Cloud Firestore document store alongside local atomic document store | No | `false` |
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
