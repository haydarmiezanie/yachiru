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

- **🔐 Authentication & Access Control (Firebase Auth + API Keys)**:
  - **Google OAuth & Email/Password**: Single-click sign-in and user onboarding for team members.
  - **Role-Based Access Hierarchy & UI Gating**:
    - **Super Admin** (`idarstore24@gmail.com`): Master administrator with approval management and role elevation permissions.
    - **Admin**: Review access requests, adjust member access levels, and clear history records.
    - **Auditor**: Execute live cluster scans, inspect raw telemetry, test connection parameters, and export DDL.
    - **Viewer**: Read-only access to scorecards and historical audit reports.
  - **Access Request Workflow**: Automatic pending state for new registrants awaiting administrator review.
  - **API Middleware Verification**: Express route middleware (`requireRole`) checks token validity and role rank on protected endpoints.

- **🛡️ Security & Operational Safety Guards**:
  - **Zero-Mutation**: Read-only queries against ClickHouse `system.*` tables.
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

## 🔒 Security Architecture & Access Control Boundaries

Yachiru provides layered access control designed for internal platform engineering, SRE, and DBA teams:

| Layer | Technology | Scope & Operational Mechanism |
|---|---|---|
| **Interactive End-User Auth** | Firebase Auth (`Bearer <ID_Token>`) | Verified on the Express backend via `firebase-admin/auth` (`verifyIdToken`). Token validity, expiration, and user profile approval status are checked against Firestore. |
| **API Role Enforcement** | `requireRole('viewer' \| 'auditor' \| 'admin')` | Express route middleware that verifies user approval status and checks hierarchical role rank before granting access to sensitive endpoints. |
| **Machine Service Accounts** | `YACHIRU_API_KEY` (`x-api-key` / `Bearer`) | Allows CI/CD automation and headless monitoring scripts to access endpoints without interactive browser sessions. |
| **UI-Level Feature Gating** | React Context (`useAuth`) | Controls client-side visibility of actionable buttons (e.g. Scan buttons, approval panels, history deletion) matching user role permissions. |

### Role Permissions:
- **`viewer` (Rank 0)**: Read-only access to health scorecards, scan history (`GET /api/history`), and report views (`GET /api/history/:id`). Direct API attempts by Viewers to trigger scans receive `403 Forbidden: Insufficient role`.
- **`auditor` (Rank 1)**: Authorized to execute live cluster scans (`POST /api/clickhouse/scan`), test database connections (`POST /api/clickhouse/test-connection`), and inspect query workloads.
- **`admin` (Rank 2)**: Full administrative control, including clearing historical audits (`DELETE /api/history`) and managing team access requests.
- **Super Admin** (`idarstore24@gmail.com`): Master administrator with automatic approval and full role promotion authority.

---

## ⚠️ Known Limitations & Operational Boundaries

To ensure clear operational expectations, please review these documented architectural boundaries:

1. **Internal Single-Tenant Scope (No Multi-Tenant Isolation)**:
   - Yachiru is designed as an internal engineering diagnostic tool. It does **not** provide multi-tenant isolation, per-database access control lists (ACLs), or cryptographic tenant sandboxing. All users with the `auditor` role share the ability to scan any network-accessible ClickHouse cluster permitted by the server's network configuration.
2. **Production Fail-Closed Configuration Requirements**:
   - In local development mode (`NODE_ENV=development`), unauthenticated requests are granted local `viewer` privileges to simplify developer onboarding when no auth keys are configured.
   - For production deployments, fail-closed security **must** be enforced by setting `REQUIRE_API_KEY=true` and `STRICT_AUTH=true`, and providing a strong `YACHIRU_API_KEY` or configuring Firebase Admin service account credentials.
3. **Storage & Multi-Instance Horizontal Scaling**:
   - By default, audit history is stored in local container files (`data/scans/`).
   - If deploying multiple container instances (e.g. on Google Cloud Run or Kubernetes with horizontal pod autoscaling), you must enable `USE_FIRESTORE_HISTORY=true` and configure `REDIS_URL` for shared rate limiting. Alternatively, deploy with `minInstances = maxInstances = 1`.
4. **Heuristic Masking vs. Regulatory Privacy**:
   - Default regex redaction (`maskQueryPii`) is a best-effort hygiene measure to strip obvious passwords, tokens, and numeric literals from query logs. It does **not** guarantee regulatory compliance under GDPR, HIPAA, or PCI-DSS.
   - For strict data privacy guarantees, deploy with Zero-Raw-Query Mode (`STORE_RAW_QUERIES=false` or `PRIVACY_PRESERVING_HISTORY=true`).
5. **Advisory Nature of AI Recommendations & DDL**:
   - Diagnostic summaries and generated DDL migration scripts are advisory recommendations based on deterministic telemetry findings. All SQL scripts must be peer-reviewed and validated in non-production environments before being executed on production databases.

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
| `ENCRYPTION_KEY` | 32+ character cryptographic secret for AES-256-GCM credential encryption. **Required in production if using Saved Connections / SSH tunnels**. In development, an ephemeral key is generated. | **Required in Prod** | *(Ephemeral in dev)* |
| `SUPER_ADMIN_EMAIL` | Designated super administrator email with permanent unrevokable Admin rights | No | `idarstore24@gmail.com` |
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

## 🔒 Security Architecture & Hardening

### 1. Firestore Security Rules & Templating
Firestore rules are managed via a master template (`firestore.rules.template`) that binds the Super Administrator identity directly to the `SUPER_ADMIN_EMAIL` configuration:
- **No Self-Privilege Escalation**: Non-admin users are strictly restricted on creation to `role: 'viewer'` and `status: 'pending'`. Any client-side attempt to self-assign `role: 'auditor'` or `status: 'approved'` is rejected at the Firestore rules layer.
- **Access Requests Defense**: `access_requests/{uid}` creation requires `status == 'pending'`. Only genuine admins can approve requests.
- **Rules Generation**: Run `npm run rules:generate` to re-compile `firestore.rules` for a custom super admin email before running deployment.

### 2. Saved Credential Encryption & Key Rotation
All sensitive connection assets (ClickHouse passwords, SSH passwords, SSH private keys, passphrases) are encrypted at rest using AES-256-GCM.
- In production (`NODE_ENV=production`), `ENCRYPTION_KEY` is strictly required and fails fast on startup if omitted.
- **Migration Note**: When configuring or rotating `ENCRYPTION_KEY`, existing connection records encrypted under previous keys will fail decryption and must be re-entered and saved.

### 3. DNS-Rebinding TOCTOU Defense
ClickHouse scanner connections enforce strict IP-pinning via a custom network connection dispatcher. The initial hostname resolution verifies that the destination is not an internal, private, loopback, or cloud-metadata address. The verified IP is pinned for all subsequent query dispatches, preventing malicious DNS rebinding attacks while maintaining correct TLS Server Name Indication (SNI) and HTTP Host headers.

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

# 6. Regenerate OpenAPI 3.1 specifications (JSON & YAML)
npm run generate:openapi
```

---

## 📖 API Documentation & OpenAPI Specification

Yachiru provides formal, machine-readable **OpenAPI 3.1.0** specifications derived from the Zod schemas and runtime endpoints:

- **Interactive Swagger UI**: Explore and test API endpoints in your browser at [`/api/docs`](http://localhost:3000/api/docs).
- **OpenAPI JSON Document**: Download the complete specification at [`/api/openapi.json`](http://localhost:3000/api/openapi.json) or inspect the committed [`openapi.json`](./openapi.json) file.
- **OpenAPI YAML Document**: Download the specification at [`/api/openapi.yaml`](http://localhost:3000/api/openapi.yaml) or inspect the committed [`openapi.yaml`](./openapi.yaml) file.
- **Third-Party Tooling & Code Generation**: Import `openapi.json` or `openapi.yaml` directly into Postman, Insomnia, or TypeScript SDK generators (`openapi-typescript`, `k6`, etc.) for seamless programmatic automation and breaking-change detection in CI/CD pipelines.

---

## 🔌 API Reference

| Method | Endpoint | Description | Access / Role Requirement |
|---|---|---|---|
| `GET` | `/api/health` | Service health and AI capability status | Public (Open) |
| `GET` | `/api/demo-clusters` | List available demo dataset profiles | Public (Open) |
| `GET` | `/api/auth/me` | Current authenticated user & role profile | `viewer` role or `YACHIRU_API_KEY` |
| `POST` | `/api/clickhouse/test-connection` | Verify ClickHouse connectivity & permissions | `auditor` role or `YACHIRU_API_KEY` |
| `POST` | `/api/clickhouse/scan` | Execute 9-dimension health scan & AI synthesis | `auditor` role or `YACHIRU_API_KEY` |
| `GET` | `/api/history` | Retrieve historical scan summary list | `viewer` role or `YACHIRU_API_KEY` *(dev fallback)* |
| `GET` | `/api/history/:id` | Retrieve full scan report by ID | `viewer` role or `YACHIRU_API_KEY` *(dev fallback)* |
| `DELETE`| `/api/history` | Clear stored scan history | `admin` role or `YACHIRU_API_KEY` |
| `GET` | `/api/openapi.json` | Download OpenAPI 3.1 specification (JSON) | Public (Open) |
| `GET` | `/api/openapi.yaml` | Download OpenAPI 3.1 specification (YAML) | Public (Open) |
| `GET` | `/api/docs` | Interactive Swagger UI API documentation | Public (Open) |

---

## 📄 License

MIT License. Designed for ClickHouse administrators, platform engineers, and data teams.
