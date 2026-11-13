# Yachiru ClickHouse Analyzer

Yachiru is an automated health audit and performance diagnostics analyzer for ClickHouse clusters. It inspects table partitioning, primary key ordering, part compaction health, compression codecs, skipping indices, and slow query workloads to produce actionable, evidence-based remediation recommendations.

---

## Quick Start with Docker Compose

The repository includes a multi-stage `Dockerfile` and ready-to-run `docker-compose.yml` that builds and runs Yachiru on port `3000`.

### 1. Configure API Key & Environment (Recommended for Deployment)
To secure your deployment and prevent API endpoints from being exposed without authentication:
```bash
# Copy example configuration
cp .env.example .env

# Generate a cryptographically secure 32-byte API key
npm run generate-api-key

# Set YACHIRU_API_KEY in your .env file:
# YACHIRU_API_KEY="<your-generated-key>"
# YACHIRU_REQUIRE_API_KEY="true"
```

### 2. Build and Run
```bash
docker compose up --build
```

Or run detached in the background:
```bash
docker compose up -d --build
```

### 3. Access the Web Interface
Open your browser at:
**[http://localhost:3000](http://localhost:3000)**

When `YACHIRU_API_KEY` is configured, the web interface automatically detects that API key authentication is required and provides an API key input in the connection modal.

### 4. Zero-Setup Simulation
If you want to explore Yachiru without connecting to a live cluster, click **"Simulate Production Scan"** on the home page. This runs the full diagnostic rule engine against realistic production telemetry, demonstrating part health visualizations, primary key pruning checks, and AI narratives.

### 5. Standalone Docker Run (Without Compose)
```bash
# Build image
docker build -t yachiru-analyzer .

# Run container with API Key authentication enabled
docker run -d -p 3000:3000 \
  -e YACHIRU_API_KEY="<YOUR_SECRET_API_KEY>" \
  -e YACHIRU_REQUIRE_API_KEY="true" \
  --add-host=host.docker.internal:host-gateway \
  --name yachiru-app yachiru-analyzer
```

To stop the container:
```bash
docker compose down
```

---

## Required ClickHouse Permissions

Yachiru is designed from the ground up with a **strict read-only, zero-data-access architecture**:

1. **Client-Side Read-Only Enforcement**: Every query sent to ClickHouse passes through `assertReadOnlySql()`. Yachiru strictly issues `SELECT` queries against ClickHouse system metadata tables (`system.*`). It will never execute or accept mutating SQL statements (`INSERT`, `UPDATE`, `ALTER`, `DROP`, `TRUNCATE`, or `KILL`).
2. **Zero Table Data Access**: Yachiru never reads application data or column values from user tables (`<database>.*` is never queried).
3. **Query Log & Mutation Parameter Privacy Sanitization**: While ClickHouse `system.query_log` and `system.mutations` capture historical SQL executions across the server, Yachiru strips user parameters, row values, PII, and literals before sending evidence to diagnostic displays or external LLM providers:
   - For `system.query_log`, Yachiru selects ClickHouse's server-side `normalizeQuery(query)` (which replaces query literals with `?` at the AST level) and `normalized_query_hash`. If server-side normalization is unsupported, query text is omitted entirely.
   - For `system.mutations`, only mutation action types (e.g. `UPDATE`, `DELETE`) and targeted tables are reported; mutation predicate and command expressions are not forwarded.
   - Defense-in-depth tokenization filter (`sanitizeQueryForPrivacy` / `sanitizeEvidenceForLLM`): Quoted string literals (including escaped quotes and heredocs), numeric constants, negative numbers, array/function arguments, UUIDs, IP addresses, and developer comments are scrubbed. Unterminated literals from log truncation are redacted through end of input.
   - LLM narrative payloads receive strictly normalized query patterns, schema definitions, and operational aggregate metrics (e.g. scanned rows, read bytes, duration, amplification ratio). Known limitation: unquoted alphanumeric tokens or column alias names matching sensitive strings cannot be distinguished from schema identifiers by regex filters alone.
4. **Two-Tier Privilege Structure**:
   - **Required Grants**: The core diagnostic checks require `SELECT` access on 5 system metadata tables:
     - `system.tables`
     - `system.parts`
     - `system.columns`
     - `system.data_skipping_indices`
     - `system.settings`
   - **Recommended / Optional Grants**: Yachiru degrades gracefully if the following tables are not granted (checks in these categories are cleanly skipped rather than failing the scan):
     - `system.query_log` (enables Query Performance and unpruned scan diagnostics)
     - `system.replicas` (enables Replication & Distributed consistency checks)
     - `system.distribution_queue` (enables Distributed table queue health checks)
     - `system.mutations` (enables Table Mutations and stuck/failing DDL checks)
     - `system.disks` (enables Storage Volume Headroom and Disk Space checks)
     - `system.errors` (enables System Error Rate and Exception spike checks)
     - `system.replication_queue` (enables Replication Queue Backlog and Retry checks)
5. **Server-Level Read-Only Setting (`readonly = 2`)**:
   It is recommended to enforce read-only status on the user profile via `SETTINGS readonly = 2, max_execution_time = 30`.
   > **Note on `readonly = 2` vs `readonly = 1`**: ClickHouse setting `readonly = 1` rejects all per-query setting overrides, which breaks diagnostic execution (Yachiru sets defensive per-query execution timeouts such as `max_execution_time`). Setting `readonly = 2` safely blocks all mutations while allowing required per-query read settings and timeouts.
6. **Cross-Database Metadata Scope Notice**:
   Because ClickHouse grants `SELECT` at the table level rather than scoped to one logical database, a user granted access to these `system.*` tables can see metadata (table names, sizes, schema column names, and part counts) for **every database on that ClickHouse server**, not only the target database being analyzed. It still cannot read table contents or modify anything. If your environment requires complete segregation where the existence of other databases is obscured, you must provision isolated cluster roles or nodes through your infrastructure.

### In-App Read-Only Setup SQL Generator
Instead of manually writing ClickHouse permissions, click the **"Generate Read-Only Setup SQL"** button in the connection form. The modal generates a tailored, copy-and-paste SQL script with your desired username and strong password placeholder ready to execute in `clickhouse-client` or your database console:

```sql
-- Illustrative example (use the in-app generator for complete tailored script)
CREATE USER IF NOT EXISTS yachiru_readonly IDENTIFIED WITH sha256_password BY '<STRONG_PASSWORD>';
GRANT SELECT ON system.tables TO yachiru_readonly;
GRANT SELECT ON system.parts TO yachiru_readonly;
GRANT SELECT ON system.columns TO yachiru_readonly;
GRANT SELECT ON system.data_skipping_indices TO yachiru_readonly;
GRANT SELECT ON system.settings TO yachiru_readonly;
GRANT SELECT ON system.query_log TO yachiru_readonly;
GRANT SELECT ON system.replicas TO yachiru_readonly;
GRANT SELECT ON system.distribution_queue TO yachiru_readonly;
GRANT SELECT ON system.mutations TO yachiru_readonly;
GRANT SELECT ON system.disks TO yachiru_readonly;
GRANT SELECT ON system.errors TO yachiru_readonly;
GRANT SELECT ON system.replication_queue TO yachiru_readonly;
ALTER USER yachiru_readonly SETTINGS readonly = 2, max_execution_time = 30;
```

---

## Connecting to Your ClickHouse Instance

1. **Local Machine (Bare-Metal / Docker Host)**:
   - **Host**: `host.docker.internal` (or local IP e.g. `192.168.x.x`)
   - **Port**: `8123` (HTTP interface)
   - **Protocol**: `HTTP`
2. **Cloud or Remote ClickHouse (ClickHouse Cloud, Aiven, Self-Hosted)**:
   - **Host**: Your domain or IP (e.g., `xxx.clickhouse.cloud`)
   - **Port**: `8443` (HTTPS) or `8123` (HTTP)
   - **Protocol**: Select `HTTPS (8443 / Cloud)` for SSL/TLS encrypted traffic.
3. **Connection Verification**:
   - Use the **"Test Connection"** button in the form before launching a scan to verify network reachability, credential validity, and ClickHouse version compatibility without triggering a full audit.

---

## SSH Bastion / Jump Host Tunneling

When your ClickHouse cluster resides inside a private VPC, behind a firewall, or on an isolated network without public endpoints, enable the **SSH Tunnel** toggle on the connection form.

- **Reachable from Bastion Host**: When SSH tunneling is enabled, the **"Host or Endpoint"** field refers to the ClickHouse host *as reachable from the bastion host* (often `localhost`, `127.0.0.1`, or an internal VPC hostname like `clickhouse.internal.vpc`), rather than an endpoint reachable directly from your local browser.
- **Supported Authentication Methods**:
  - **Password Auth**: Bastion username and password.
  - **Private Key (PEM)**: OpenSSH or RSA PEM private key with optional decryption passphrase.
- **Ephemeral Port Forwarding**: Yachiru binds an OS-assigned ephemeral loopback port, establishes the encrypted SSH tunnel, runs the scan, and tears down the connection immediately upon completion.
- **Host Key Verification & MITM Protection**:
  - Yachiru supports cryptographic SSH host key pinning using OpenSSH SHA256 fingerprints (`SHA256:...`), hex SHA256, MD5 colons (`MD5:aa:bb:...`), or raw public keys.
  - In production (`NODE_ENV=production`), **strict host key verification is enforced by default**; connections without a matching pinned fingerprint are rejected with HTTP 400. Operators can explicitly allow unverified connections by setting `YACHIRU_SSH_STRICT_HOST_KEY="false"`.
  - In non-production environments, connections default to permissive mode, allowing users to test connection reachability, view the remote bastion's cryptographic fingerprint in the UI, and pin it with 1 click.
  - The server policy is an absolute floor: clients can request stricter checking (`strictHostKeyChecking: true`), but can never relax an active server-enforced policy.

---

## Saved Connection Profiles

Yachiru allows saving and reloading named connection profiles so you don't have to re-enter hostnames, ports, databases, and usernames on every visit:

- **Strict Credential Boundary**: Only non-sensitive parameters are saved to browser `localStorage` (`host`, `port`, `protocol`, `database`, `username`, `useSshTunnel`, `sshHost`, `sshPort`, `sshUsername`, `sshAuthMethod`, `enableHistoryTracking`, `historyDatabase`, `historyTableName`, `historyWriteUsername`).
- **Never Persisted to Disk**: All secrets—including database passwords, SSH passwords, SSH private keys and passphrases, AI provider API keys, and history write passwords—are **strictly excluded** from persistent storage. Credentials remain cached exclusively in browser `sessionStorage` for the active tab and are discarded when the tab is closed.

---

## Scan History & Trend Tracking (In-Cluster Persistence)

Yachiru tracks health score trends, category progressions, and finding regressions across scans without requiring any local state:

### Storage & Persistence Model
- **Scan History Snapshots**: Stored directly in your ClickHouse cluster (`default.yachiru_scan_history`). Yachiru does not require an external SQL database or cloud service to track performance trends.
- **Before/After Verification Sessions**: Stored in a lightweight JSON store on the server filesystem (`data/verifications.json`), configured via `YACHIRU_DATA_DIR` (mapped to `/app/data` volume in Docker Compose). Mutations are accepted in memory and flushed asynchronously via a coalesced atomic temp-file + rename queue within milliseconds; on `SIGTERM`/`SIGINT`, the server drains `flushPendingWrites()` (up to 5s, with `stop_grace_period: 10s` in Docker Compose) before exiting, and persistence health (`verificationStore`) is reported on `GET /api/health`.

### Dual-Credential Security Architecture
To maintain strict least-privilege security, Yachiru uses two completely separate ClickHouse accounts:
1. **Audit & Diagnostics User**: Strictly read-only access (`SELECT`) to `system.*` metadata tables.
2. **Dedicated History Write User**: Dedicated account with **ONLY `INSERT`** privileges on the specific history table. This account cannot read table data, alter schemas, or execute DDL.

| Credential | Role / Purpose | Required Privileges |
|---|---|---|
| **Diagnostic User** | Cluster audit & performance checks | `GRANT SELECT ON system.*` (or required metadata tables) |
| **History Write User** | Recording scan summaries | `GRANT INSERT ON <database>.<table_name>` ONLY |

### Setup SQL for Scan History
Click the **"Generate Read-Only & History Setup SQL"** button in the connection form or Trend View to generate ready-to-run setup scripts:

```sql
-- 1. Create the History Table (Run once as administrator)
CREATE TABLE IF NOT EXISTS default.yachiru_scan_history (
    scan_id UUID,
    scanned_at DateTime DEFAULT now(),
    target_host String,
    target_database String,
    overall_score UInt8,
    overall_verdict LowCardinality(String),
    category_scores String,
    finding_summary String,
    clickhouse_version LowCardinality(String)
) ENGINE = MergeTree()
ORDER BY (target_database, scanned_at, scan_id)
TTL scanned_at + INTERVAL 180 DAY;

-- 2. Create the Dedicated Write User (INSERT-only)
CREATE USER IF NOT EXISTS yachiru_history_writer IDENTIFIED WITH sha256_password BY '<STRONG_WRITE_PASSWORD>';
GRANT INSERT ON default.yachiru_scan_history TO yachiru_history_writer;

-- 3. Grant SELECT on the history table to your Read-Only Diagnostic user
GRANT SELECT ON default.yachiru_scan_history TO yachiru_readonly;
```

### Resilient & Non-Blocking Execution
History writes are executed asynchronously and non-blocking: if the history table has not been created or the write user credentials fail, the live diagnostic scan **always succeeds** and displays the complete audit report, while surfacing a clear diagnostic notice and setup guidance.

---

## Multi-Provider AI Diagnostics & Narrative

AI narrative synthesis in Yachiru is **100% optional**. If no AI provider or API key is configured, Yachiru executes its complete deterministic heuristic engine, computing scores, status badges, metric thresholds, and remediation advice with zero external AI calls.

When enabled, Yachiru synthesizes deep root-cause analyses, executive summaries, risk vectors, and tailored remediation plans. You can select between three AI providers:

### Supported AI Providers & Models

| Provider | Model ID | Display Name | Positioning / Badge |
|---|---|---|---|
| **Google Gemini** | `gemini-3.8-flash` | Gemini 3.8 Flash | Balanced *(Default)* |
| | `gemini-3.7-flash` | Gemini 3.7 Flash | Fast & Hybrid |
| | `gemini-3.1-pro-preview` | Gemini 3.1 Pro | High Reasoning |
| | `gemini-3.6-flash` | Gemini 3.6 Flash | High Throughput |
| | `gemini-3.1-flash-lite` | Gemini 3.1 Flash-Lite | Ultra-Fast |
| | `gemini-3.5-flash` | Gemini 3.5 Flash | Low Latency |
| **OpenAI** | `gpt-5.4-mini` | GPT-5.4 Mini | Fastest & Default *(Default)* |
| | `gpt-6-astra` | GPT-6 Astra | Flagship (1.05M ctx) |
| | `gpt-5.6-sol` | GPT-5.6 Sol | Flagship (Ultra Reasoning) |
| | `gpt-5.6-terra` | GPT-5.6 Terra | Balanced (272K ctx) |
| | `gpt-5.6-luna` | GPT-5.6 Luna | Fast & Efficient |
| **Anthropic Claude** | `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | Fastest & Default (200K ctx) *(Default)* |
| | `claude-sonnet-5` | Claude Sonnet 5 | Balanced (1M ctx) |
| | `claude-opus-5` | Claude Opus 5 | High-Capability (1M ctx) |
| | `claude-fable-5-1` | Claude Fable 5.1 | Mythos Class (1M ctx) |
| | `claude-sonnet-4-6` | Claude Sonnet 4.6 | Previous Gen Sonnet (1M ctx) |

### API Key Management: UI vs. Environment Variables
- **System-Wide Fallback Keys**: You can configure server-level fallback keys in your environment (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_API_KEY`). When present, users can run AI diagnostics without entering personal credentials.
- **Tab-Scoped UI Keys**: Users can enter their own API keys directly in the connection form. Keys entered in the UI are held exclusively in volatile server memory for the duration of the scan and saved in the browser's `sessionStorage` for the active tab only. They are never written to disk or persisted to any database.
- **Dynamic Switching**: You can switch between Gemini, OpenAI, and Claude on any scan directly in the UI without restarting the server.

---

## Programmatic API & Automation

Every check, connection test, and narrative diagnosis can be run headlessly outside the browser for CI/CD regression gating, periodic cron health audits, or monitoring pipelines.

- **Endpoints**: `/api/health`, `/api/test-connection`, `/api/analyze`, `/api/narrate`, and `/api/system-key-status`.
- **Authentication**: Unauthenticated by default for local and UI workflows. When `YACHIRU_API_KEY` is configured in the environment, API requests require `Authorization: Bearer <key>` or `X-Yachiru-Api-Key: <key>`.
- **Rate Limiting**: Automated requests to `/api/analyze`, `/api/test-connection`, and `/api/verifications` are throttled (default 30 req/min, configurable via `YACHIRU_RATE_LIMIT_PER_MINUTE`). LLM narrative synthesis (`/api/narrate`) is throttled separately (default 15 req/min, configurable via `YACHIRU_NARRATE_RATE_LIMIT_PER_MINUTE`) to conserve AI quotas.

For full request/response JSON schemas, error codes, and copy-paste CI `curl` bash scripts, see **[API.md](API.md)**.

---

## Environment Variables Reference

All environment variables are declared in `.env.example`:

| Variable | Required / Optional | Description |
|---|---|---|
| `GEMINI_API_KEY` | Optional | API key for Google Gemini narrative synthesis. |
| `GEMINI_MODEL` | Optional | Default Gemini model ID for narrative generation (defaults to `gemini-3.8-flash`). |
| `OPENAI_API_KEY` | Optional | API key for OpenAI narrative synthesis. |
| `CLAUDE_API_KEY` | Optional | API key for Anthropic Claude narrative synthesis. |
| `APP_URL` | Optional | Public URL where Yachiru is hosted; used for discovery and self-referential links. |
| `YACHIRU_API_KEY` | Required in Production | When set, locks `/api/analyze`, `/api/narrate`, `/api/test-connection`, `/api/verifications`, `/api/history`, and `/api/system-key-status` behind Bearer token authentication. In production (`NODE_ENV=production`), required by default. |
| `YACHIRU_REQUIRE_API_KEY` | Optional | Explicitly enforces API key requirement regardless of environment. If true and `YACHIRU_API_KEY` is unset, the server fails fast and refuses to boot. |
| `YACHIRU_ALLOW_OPEN_API` | Optional | Explicit override to allow running in `NODE_ENV=production` without an API key (defaults to `false`). |
| `YACHIRU_ALLOW_SYSTEM_LLM_KEY` | Optional | When `true`, allows authenticated API requests to use server-configured LLM keys for `/api/narrate`. Defaults to `false` to protect operator quota. |
| `YACHIRU_TRUST_PROXY` | Optional | Configures reverse proxy trust for client IP rate limiting (`app.set('trust proxy', N)`). Set to hop count (e.g. `1`) or `true` when deployed behind a proxy/ALB/Cloudflare. |
| `YACHIRU_RATE_LIMIT_PER_MINUTE` | Optional | Maximum allowed requests per minute per IP for analysis and test-connection endpoints (default: `30`). |
| `YACHIRU_NARRATE_RATE_LIMIT_PER_MINUTE` | Optional | Maximum allowed requests per minute per IP for LLM narrative synthesis (`/api/narrate`) (default: `15`). |
| `YACHIRU_DATA_DIR` | Optional | Filesystem directory path for storing before/after verification sessions (default: `./data`). Mapped to `/app/data` volume in Docker Compose. |
| `YACHIRU_SSH_STRICT_HOST_KEY` | Optional | Enforces strict SSH host key checking. In production, defaults to `true` (unpinned or mismatched bastion connections rejected). In non-production, defaults to `false`. Can be explicitly set to `true` or `false`. |

---

## Feedback & Bug Reports

Have an issue or a feature idea for Yachiru?

- **In-App Feedback Modal**: Click the **Feedback** button in the top navigation bar or the **"Report a Bug / Request a Feature"** link in the footer. This opens a modal to draft bug reports or feature requests, with an optional strict diagnostic allowlist summary (app version, browser agent, finding titles, and score—never passwords, queries, or credentials) that can be copied or launched in your default email client.
- **Maintainer Contact**:
  - **Email**: `haydarsaja@gmail.com`
  - **LinkedIn**: [Haydar Miezanie Abdul Jamil](https://www.linkedin.com/in/haydar-miezanie-abdul-jamil-916302162/)
