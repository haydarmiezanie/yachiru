# Yachiru Programmatic API & Automation Guide

Yachiru provides REST API endpoints to run automated ClickHouse health audits, verify cluster connectivity, and generate AI performance diagnostics programmatically.

---

## 1. Authentication (`YACHIRU_API_KEY` / `YACHIRU_REQUIRE_API_KEY`)

By default for local development, `YACHIRU_API_KEY` is **unset**, allowing open access.

In deployment:
- **Set `YACHIRU_API_KEY`**: Configure a strong secret in your environment or `.env` file.
- **Set `YACHIRU_REQUIRE_API_KEY="true"`**: Strongly recommended for production deployments. If `YACHIRU_API_KEY` is missing, an ephemeral 32-byte key is automatically generated on server boot to prevent endpoints from ever opening unprotected.

When authentication is active:
- Endpoints marked **Auth Required** must receive the key via `Authorization: Bearer <key>` or `X-Yachiru-Api-Key: <key>`.
- Missing or invalid keys return HTTP `401 Unauthorized`:
  ```json
  {
    "error": "Missing or invalid API key. Provide it via \"Authorization: Bearer <key>\" or \"X-Yachiru-Api-Key: <key>\"."
  }
  ```

Generate a secure key via:
```bash
npm run generate-api-key
```

---

## 2. Rate Limiting

Requests to expensive diagnostic endpoints (`/api/analyze`, `/api/test-connection`, `/api/verifications`) and AI synthesis (`/api/narrate`) are throttled using standard headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`).
- **Analysis Limit**: Default 30 requests/minute per client identity (configurable via `YACHIRU_RATE_LIMIT_PER_MINUTE`).
- **Narrate Limit**: Default 15 requests/minute per client identity (configurable via `YACHIRU_NARRATE_RATE_LIMIT_PER_MINUTE`) to conserve LLM quota.
- **Exceeded**: Returns HTTP `429 Too Many Requests`:
  ```json
  {
    "error": "Too many requests. Please wait before retrying."
  }
  ```
- **Oversized / Malformed Payloads**: `/api/narrate` enforces a `1mb` JSON limit (other endpoints enforce `10mb`). Exceeding the limit returns HTTP `413 Payload Too Large`:
  ```json
  {
    "error": "Request payload too large."
  }
  ```
  Malformed JSON returns HTTP `400 Bad Request`:
  ```json
  {
    "error": "Invalid JSON request body."
  }
  ```

---

## 3. Endpoints Specification

### 3.1. `GET /api/health`
Checks server readiness, verification store persistence health, AI credentials status, and whether API key authentication is currently enforced.

- **Authentication**: Partial (Always Open for `status`, `service`, `apiKeyRequired`, and redacted `verificationStore`; full provider flags, `systemKeyState`, and detailed `verificationStore.lastError` require `YACHIRU_API_KEY` when enabled).
- **Rate Limited**: No

#### Request Example
```bash
curl -s http://localhost:3000/api/health
```

#### Successful Response (`200 OK`)
```json
{
  "status": "ok",
  "service": "Yachiru ClickHouse Analyzer",
  "apiKeyRequired": false,
  "verificationStore": {
    "ok": true,
    "pending": 0,
    "lastError": null,
    "lastWriteAt": "2026-09-15T15:30:00.000Z"
  },
  "hasGeminiApiKey": true,
  "hasOpenAiApiKey": false,
  "hasClaudeApiKey": false,
  "defaultModel": "gemini-3.8-flash",
  "geminiSystemKeyState": {
    "depleted": false,
    "depletedAt": null,
    "expiresAt": null,
    "remainingSeconds": 0,
    "reason": null
  },
  "openaiSystemKeyState": {
    "depleted": false,
    "depletedAt": null,
    "expiresAt": null,
    "remainingSeconds": 0,
    "reason": null
  },
  "claudeSystemKeyState": {
    "depleted": false,
    "depletedAt": null,
    "expiresAt": null,
    "remainingSeconds": 0,
    "reason": null
  },
  "systemKeyState": {
    "depleted": false,
    "depletedAt": null,
    "expiresAt": null,
    "remainingSeconds": 0,
    "reason": null
  }
}
```

---

### 3.2. `GET /api/system-key-status`
Returns circuit-breaker state for server-level AI API keys (quota depletion cooldown tracking).

- **Authentication**: Required when `YACHIRU_API_KEY` is set.
- **Query Parameters**:
  - `provider` (optional): `'gemini'` (default), `'openai'`, or `'claude'`
- **Rate Limited**: No

#### Request Example
```bash
curl -s -H "Authorization: Bearer YOUR_YACHIRU_API_KEY" \
  "http://localhost:3000/api/system-key-status?provider=claude"
```

#### Successful Response (`200 OK`)
```json
{
  "depleted": false,
  "depletedAt": null,
  "expiresAt": null,
  "remainingSeconds": 0,
  "reason": null
}
```

---

### 3.2b. `POST /api/system-key-reset`
Clears the circuit-breaker depletion state for a server-level AI provider key so requests can retry immediately.

- **Authentication**: Required when `YACHIRU_API_KEY` is set.
- **Query Parameters**:
  - `provider` (optional): `'gemini'` (default), `'openai'`, or `'claude'`
- **Rate Limited**: No

#### Request Example
```bash
curl -s -X POST -H "Authorization: Bearer YOUR_YACHIRU_API_KEY" \
  "http://localhost:3000/api/system-key-reset?provider=gemini"
```

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "provider": "gemini",
  "status": {
    "depleted": false,
    "depletedAt": null,
    "expiresAt": null,
    "remainingSeconds": 0,
    "reason": null
  }
}
```

---

### 3.3. `POST /api/test-connection`
Performs a fast connectivity check and retrieves basic version and uptime metadata from the target ClickHouse instance.

- **Authentication**: Required when `YACHIRU_API_KEY` is set.
- **Rate Limited**: Yes (30 req/min).

#### Request Body (`ConnectionConfig`)
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `host` | `string` | Yes (unless `isDemo: true`) | Hostname/IP of ClickHouse server (or as reachable from bastion). |
| `port` | `number` | No | Port (1-65535, defaults to 8123 HTTP or 8443 HTTPS). |
| `protocol` | `'http' \| 'https'` | No | Connection protocol (default `'http'`). |
| `username` | `string` | No | ClickHouse user (default `'default'`). |
| `password` | `string` | No | ClickHouse password (default `''`). |
| `database` | `string` | No | Target database name (default `'default'`). |
| `isDemo` | `boolean` | No | Set to `true` to test against realistic mock cluster without a real host. |
| `useSshTunnel` | `boolean` | No | Set to `true` to tunnel traffic via an SSH bastion host. |
| `sshHost` | `string` | Conditional | Bastion host IP or domain name (required when `useSshTunnel` is `true`). |
| `sshPort` | `number` | No | Bastion SSH port (defaults to 22). |
| `sshUsername` | `string` | Conditional | Bastion SSH username (required when `useSshTunnel` is `true`). |
| `sshAuthMethod` | `'password' \| 'privateKey'` | No | Bastion authentication method (defaults to `'password'`). |
| `sshPassword` | `string` | Conditional | SSH password when `sshAuthMethod === 'password'`. |
| `sshPrivateKey` | `string` | Conditional | PEM private key when `sshAuthMethod === 'privateKey'`. |
| `sshPrivateKeyPassphrase` | `string` | No | Optional passphrase to decrypt encrypted private key. |
| `sshHostKeyFingerprint` | `string` | No | Expected bastion host key fingerprint (OpenSSH `SHA256:...`, hex `SHA256:...`, MD5 `aa:bb:...`, or public key). Protects against MITM attacks. |
| `strictHostKeyChecking` | `boolean` | No | If `true`, aborts connection if no host key fingerprint is configured. Overrides `YACHIRU_SSH_STRICT_HOST_KEY`. |

#### Request Example
```bash
curl -s -X POST http://localhost:3000/api/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_YACHIRU_API_KEY" \
  -d '{
    "host": "clickhouse.internal.company.net",
    "port": 8123,
    "protocol": "http",
    "username": "yachiru_readonly",
    "password": "CHANGE_ME_SECURE_PASSWORD",
    "database": "default",
    "isDemo": false
  }'
```

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "message": "Successfully connected to ClickHouse v24.8.4.13 at clickhouse.internal.company.net:8123",
  "version": "24.8.4.13",
  "serverHostKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5...",
  "pinMatches": true
}
```

#### Validation Error Response (`400 Bad Request`)
```json
{
  "error": "host is required and must be a non-empty string."
}
```

#### Connection Failure Response (`400 Bad Request`)
```json
{
  "success": false,
  "error": "Connection refused by host clickhouse.internal.company.net:8123",
  "hint": "Connection was actively refused by the target host. Verify ClickHouse is running and listening on the specified HTTP port (default 8123 for HTTP, 8443 for HTTPS)."
}
```

---

### 3.4. `POST /api/analyze`
Executes an in-depth audit scan across table engines, part counts, primary keys, skip indices, compression ratios, and slow query logs. Returns an `AnalysisReport`.

- **Authentication**: Required when `YACHIRU_API_KEY` is set.
- **Rate Limited**: Yes (30 req/min).

#### Request Body (`ConnectionConfig`)
In addition to connection fields (`host`, `port`, `protocol`, `username`, `password`, `database`, `isDemo`):
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `queryDurationThresholdMs` | `number` | No | Minimum query duration to flag in slow logs (default: 3000). |
| `queryMemoryThresholdBytes` | `number` | No | Minimum memory usage to flag in memory audit (default: 1073741824). |
| `enableAiNarrative` | `boolean` | No | If `false` (recommended for CI/cron), runs purely deterministic rules with zero LLM API cost. |
| `aiProvider` | `'gemini' \| 'openai' \| 'claude'` | No | Optional AI provider override. |
| `geminiModel` | `string` | No | Target model (must match allowlist in `AVAILABLE_AI_MODELS`). |
| `geminiApiKey` | `string` | No | Caller-provided Gemini API key (optional). |
| `openaiApiKey` | `string` | No | Caller-provided OpenAI API key (optional). |
| `claudeApiKey` | `string` | No | Caller-provided Anthropic Claude API key (optional). |
| `claudeThinking` | `boolean` | No | Enable Claude extended thinking mode if supported by the chosen model. |
| `enableHistoryTracking` | `boolean` | No | Record scan results to target cluster's history table (`system_yachiru.scan_history`). |

#### Request Example (Deterministic Audit for Automation)
```bash
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_YACHIRU_API_KEY" \
  -d '{
    "host": "clickhouse.internal.company.net",
    "port": 8123,
    "protocol": "http",
    "username": "yachiru_readonly",
    "password": "CHANGE_ME_SECURE_PASSWORD",
    "database": "analytics",
    "queryDurationThresholdMs": 3000,
    "queryMemoryThresholdBytes": 1073741824,
    "enableAiNarrative": false,
    "isDemo": false
  }'
```

#### Successful Response (`200 OK`)
Abbreviated `AnalysisReport` payload:
```json
{
  "scan_id": "scan_1726414200000",
  "timestamp": "2026-09-15T15:30:00.000Z",
  "database_name": "analytics",
  "clickhouse_version": "24.8.4.13",
  "cluster_mode": "Single Node",
  "overall_score": 88,
  "overall_verdict": "Optimized",
  "is_demo": false,
  "coverage": {
    "evaluatedCount": 11,
    "applicableCount": 11,
    "totalCount": 13,
    "unavailableCount": 0,
    "notApplicableCount": 2,
    "isComplete": true,
    "categories": [
      { "id": "part_health", "name": "Part Health & Compaction", "state": "evaluated" },
      { "id": "primary_key", "name": "Primary Key & Sorting", "state": "evaluated" },
      { "id": "replication_distributed", "name": "Replication & Distributed Backlog", "state": "not_applicable", "reason": "no_replicated_tables" }
    ]
  },
  "summary": {
    "total_tables": 14,
    "total_rows": 12850400,
    "total_size_compressed": "1.42 GB",
    "total_size_uncompressed": "8.95 GB",
    "avg_compression_ratio": "6.30x",
    "total_parts": 84,
    "total_queries_analyzed": 1500,
    "critical_count": 0,
    "warning_count": 2,
    "good_count": 18
  },
  "categories": [
    {
      "category": "part_health",
      "name": "Part Count & Partitioning Health",
      "score": 95,
      "status": "good",
      "critical_count": 0,
      "warning_count": 1,
      "good_count": 5,
      "total_checks": 6,
      "description": "Evaluates active part counts, small part fragmentation, and merge health."
    }
  ],
  "findings": [
    {
      "id": "part_count_events_log",
      "category": "part_health",
      "category_name": "Part Count & Partitioning Health",
      "title": "Active part count approaching warning threshold on events_log",
      "table": "events_log",
      "status": "warning",
      "metric_value": "142 active parts",
      "threshold": "< 150 active parts per partition",
      "evidence": "events_log has 142 active parts in partition 202609.",
      "impact": "Higher part counts increase read amplification during SELECT scans.",
      "recommendation_sql_or_text": "OPTIMIZE TABLE analytics.events_log FINAL;",
      "is_sql_recommendation": true,
      "is_ai_diagnosed": false
    }
  ],
  "tables": [
    {
      "database": "analytics",
      "name": "events_log",
      "engine": "MergeTree",
      "total_rows": 8500000,
      "total_bytes_uncompressed": 5368709120,
      "total_bytes_compressed": 858993459,
      "compression_ratio": 6.25,
      "active_parts": 142,
      "partition_count": 12,
      "order_by_key": "tenant_id, event_time",
      "partition_key": "toYYYYMM(event_time)",
      "skip_indices_count": 1,
      "findings_count": { "critical": 0, "warning": 1, "good": 3 }
    }
  ]
}
```

*Note on Verdicts*: When query permission errors occur or evaluated category coverage is below 60%, `overall_verdict` evaluates to `"Incomplete"` and score is marked as partial, preventing unverified or inaccessible checks from yielding a false `"Optimized"` score.

---

### 3.5. `POST /api/narrate`
Synthesizes executive diagnoses and prioritized action items from an existing `AnalysisReport` using Gemini, OpenAI, or Claude.

- **Authentication**: Required when `YACHIRU_API_KEY` is set.
- **Rate Limited**: Yes (default 15 requests/minute, configurable via `YACHIRU_NARRATE_RATE_LIMIT_PER_MINUTE`).
- **Access Control**: Server system keys are only used if `YACHIRU_ALLOW_SYSTEM_LLM_KEY=true` and request passed authenticated API key check. Otherwise callers must supply `geminiApiKey`, `openaiApiKey`, or `claudeApiKey`.

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `report` | `AnalysisReport` | Yes | Existing analysis report (must contain non-empty `scan_id` and at most 250 `findings`). |
| `provider` | `'gemini' \| 'openai' \| 'claude'` | No | Target AI provider. |
| `model` | `string` | No | Valid model name (must match provider allowlist in `AVAILABLE_AI_MODELS`). |
| `geminiApiKey` | `string` | No | Optional client Gemini API key. |
| `openaiApiKey` | `string` | No | Optional client OpenAI API key. |
| `claudeApiKey` | `string` | No | Optional client Claude API key. |

#### Request Example
```bash
curl -s -X POST http://localhost:3000/api/narrate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_YACHIRU_API_KEY" \
  -d '{
    "report": { "scan_id": "scan_1726414200000", "findings": [] },
    "provider": "gemini",
    "model": "gemini-3.8-flash"
  }'
```

#### Successful Response (`200 OK`)
```json
{
  "model": "gemini-3.8-flash",
  "executive_summary": "The ClickHouse cluster demonstrates robust overall partitioning, but table `events_log` requires an OPTIMIZE merge to arrest part fragmentation.",
  "cluster_health_verdict": "Production Ready with Minor Tuning",
  "top_priorities": [
    {
      "priority": 1,
      "title": "Merge fragmented parts on analytics.events_log",
      "target_table": "events_log",
      "why": "142 active parts were detected, degrading primary key index lookups.",
      "action": "Run OPTIMIZE TABLE analytics.events_log FINAL during off-peak hours."
    }
  ],
  "workload_risk_analysis": "Low risk. Background merges are progressing normally with zero replication lag.",
  "isAiGenerated": true,
  "ai_diagnoses": []
}
```

---

### 3.6. `POST /api/history`
Retrieves stored historical audit scans from the target ClickHouse cluster's history tracking table (`system_yachiru.scan_history`), chronological trend data, and comparative delta against the previous scan.

- **Authentication**: Required when `YACHIRU_API_KEY` is set.
- **Rate Limited**: Yes (30 req/min).
- **Query Parameters**:
  - `limit` (optional): Maximum records to retrieve (default: `100`).

#### Request Body (`ConnectionConfig`)
Includes standard connection credentials and optional `historyDatabase` / `historyTableName`.

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "history": [
    {
      "id": "scan_1726414200000",
      "timestamp": "2026-09-15T15:30:00.000Z",
      "target_host": "clickhouse.internal.company.net",
      "target_database": "analytics",
      "overall_score": 88,
      "overall_verdict": "Optimized",
      "evaluated_categories": ["part_health", "primary_keys", "table_engines"],
      "findings_count": { "critical": 0, "warning": 2, "good": 18 },
      "metrics": {
        "total_tables": 14,
        "total_parts": 84,
        "total_size_compressed_bytes": 1524713390
      }
    }
  ],
  "comparison": {
    "hasComparison": true,
    "scoreDelta": 3,
    "coverageChanged": false,
    "coverageNote": null,
    "resolvedFindings": 1,
    "newFindings": 0
  }
}
```

*Note on Coverage*: If the evaluated categories differ between scans (e.g. Due to permission changes or skipped checks), `coverageChanged` is set to `true` and `coverageNote` explains the discrepancy to avoid interpreting category loss as performance improvement.

---

### 3.7. Remediation Verification API (`/api/verifications`)
Yachiru includes a full before-and-after verification engine that tracks remediation sessions, runs post-fix verification scans on the server, and measures real metric deltas (e.g. Compression ratio gains, disk space freed, and slow query duration drops).

#### Persistence & Shutdown Guarantees
- Mutations (`POST`, `PATCH`, `POST .../verify`, `DELETE`) are accepted immediately in memory and persisted asynchronously to `verifications.json` (in `YACHIRU_DATA_DIR`, default `./data`) via a coalesced atomic temp-file + rename write queue.
- On `SIGTERM` or `SIGINT`, the server closes HTTP connections and awaits `flushPendingWrites()` (up to 5 seconds) before exiting cleanly (`docker-compose.yml` configures `stop_grace_period: 10s`).
- Disk write status (`ok`, `pending`, `lastError`, `lastWriteAt`) is surfaced on `GET /api/health` under `verificationStore`.

#### Endpoints Overview
| Method | Route | Description | Auth Required | Status Codes |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/verifications` | List verification sessions (filters: `host`, `database`, `workspaceId`). | Yes | `200`, `401`, `500` |
| `POST` | `/api/verifications` | Create new verification session with baseline metrics. | Yes | `201`, `400`, `401`, `409`, `429` |
| `GET` | `/api/verifications/:id` | Get details and verification metrics for a single session. | Yes | `200`, `401`, `404`, `500` |
| `PATCH` | `/api/verifications/:id` | Update session checklist, user status transition, or notes. | Yes | `200`, `400`, `401`, `404`, `429` |
| `POST` | `/api/verifications/:id/verify` | Re-scan cluster on the server and evaluate remediation results. | Yes | `200`, `400`, `401`, `404`, `409`, `429` |
| `DELETE` | `/api/verifications/:id` | Delete a verification session. | Yes | `200`, `401`, `404`, `429` |

#### 1. `GET /api/verifications` (List Sessions)
Returns `{ sessions, summary }`. Supports optional query filters `host`, `database`, and `workspaceId`.

#### 2. `POST /api/verifications` (Create Session)
Creates a baseline verification tracking session for a finding (`201 Created`). Client-supplied verification outcomes (`afterScanId`, `verifiedAt`, `afterMetrics`, `financialImpact`, `measuredImpactSummary`) are strictly stripped/ignored to prevent forging. Duplicate session IDs return `409 Conflict`.

Required fields: `id` (`^[a-zA-Z0-9_\-:.]{1,100}$`), `targetHost`, `targetDatabase`, `findingId`, `findingTitle`, `findingCategory`, `findingSeverity`, `baselineScanId`, `baselineMetrics` (object).

Request JSON example:
```json
{
  "id": "verif_events_raw_compression_01",
  "findingId": "low_compression_raw_payloads",
  "findingTitle": "Suboptimal compression on events_raw.payload_json",
  "findingCategory": "compression",
  "findingSeverity": "warning",
  "targetHost": "clickhouse.internal.company.net",
  "targetDatabase": "analytics",
  "targetTable": "events_raw",
  "targetColumn": "payload_json",
  "recommendationSqlOrText": "ALTER TABLE events_raw MODIFY COLUMN payload_json String CODEC(ZSTD(3));",
  "isSqlRecommendation": true,
  "riskLevel": "medium",
  "baselineScanId": "scan_1726414200000",
  "baselineCapturedAt": "2026-09-15T15:30:00.000Z",
  "baselineMetrics": {
    "compression_ratio": 1.18,
    "column_compressed_bytes": 7100000000
  }
}
```

```bash
curl -s -X POST http://localhost:3000/api/verifications \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_YACHIRU_API_KEY" \
  -d '{
    "id": "verif_events_raw_compression_01",
    "findingId": "low_compression_raw_payloads",
    "findingTitle": "Suboptimal compression on events_raw.payload_json",
    "findingCategory": "compression",
    "findingSeverity": "warning",
    "targetHost": "clickhouse.internal.company.net",
    "targetDatabase": "analytics",
    "targetTable": "events_raw",
    "targetColumn": "payload_json",
    "recommendationSqlOrText": "ALTER TABLE events_raw MODIFY COLUMN payload_json String CODEC(ZSTD(3));",
    "isSqlRecommendation": true,
    "riskLevel": "medium",
    "baselineScanId": "scan_1726414200000",
    "baselineCapturedAt": "2026-09-15T15:30:00.000Z",
    "baselineMetrics": {
      "compression_ratio": 1.18,
      "column_compressed_bytes": 7100000000
    }
  }'
```

#### 3. `GET /api/verifications/:id` (Get Session)
Returns the full `VerificationSession` (`200 OK`) or `404 Not Found` if the session ID does not exist.

#### 4. `PATCH /api/verifications/:id` (Update Notes / Checklist / User Status)
Updates user-editable fields (`notes`, `checklist`, and user-driven status transitions `'remediation_in_progress' | 'awaiting_verification' | 'cancelled'`). Attempting to set computed fields (`financialImpact`, `afterMetrics`, `status: 'verified'`) returns `400 Bad Request`; unknown IDs return `404 Not Found`.

Request JSON example:
```json
{
  "status": "remediation_in_progress",
  "notes": "Scheduled ALTER TABLE CODEC change during off-peak window."
}
```

#### 5. `POST /api/verifications/:id/verify` (Execute Verification)
Executes a server-side audit scan against the cluster and verifies whether the targeted issue was resolved, measuring actual metric impact. Client-supplied `afterReport` payloads are rejected (`400 Bad Request`), target host/database mismatches return `409 Conflict`, and unknown IDs return `404 Not Found`.

Request JSON example:
```json
{
  "connectionConfig": {
    "host": "clickhouse.internal.company.net",
    "port": 8123,
    "protocol": "http",
    "username": "yachiru_readonly",
    "password": "CHANGE_ME_SECURE_PASSWORD",
    "database": "analytics"
  }
}
```

```bash
curl -s -X POST http://localhost:3000/api/verifications/verif_events_raw_compression_01/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_YACHIRU_API_KEY" \
  -d '{
    "connectionConfig": {
      "host": "clickhouse.internal.company.net",
      "port": 8123,
      "protocol": "http",
      "username": "yachiru_readonly",
      "password": "CHANGE_ME_SECURE_PASSWORD",
      "database": "analytics"
    }
  }'
```

Response returns the updated session containing:
- `status`: `'verified' | 'partially_improved' | 'not_improved' | 'regressed' | 'inconclusive'`
- `metricComparisons`: Baseline vs After values and percentage delta
- `measuredImpactSummary`: Summary of improvements (e.g., parts merged, storage freed)
- `financialImpact`: Estimated monthly and annual cloud storage savings.

#### 6. `DELETE /api/verifications/:id` (Delete Session)
Deletes a verification session by ID. Returns `200 OK` (`{ "success": true }`) or `404 Not Found` if the session does not exist.

---

## 4. Using This in CI / Cron (Automated Health Gating)

Because `POST /api/analyze` supports deterministic execution (`"enableAiNarrative": false`), you can use Yachiru in automated CI pipelines, nightly test suites, or Cron jobs to enforce health thresholds without incurring AI costs or needing LLM API keys.

Below is a complete, runnable shell script that runs an audit, extracts `.overall_score` via `jq`, and exits non-zero if the health score drops below `80`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Configuration
YACHIRU_URL="${YACHIRU_URL:-http://localhost:3000}"
YACHIRU_API_KEY="${YACHIRU_API_KEY:-}"
TARGET_HOST="${CLICKHOUSE_HOST:-clickhouse.internal.company.net}"
TARGET_PORT="${CLICKHOUSE_PORT:-8123}"
TARGET_USER="${CLICKHOUSE_USER:-default}"
TARGET_PASS="${CLICKHOUSE_PASSWORD:-}"
TARGET_DB="${CLICKHOUSE_DB:-default}"
MINIMUM_SCORE=80

echo "==> Running automated ClickHouse audit against ${TARGET_HOST}:${TARGET_PORT}/${TARGET_DB}..."

# Build auth header if key is configured
AUTH_HEADER=()
if [[ -n "${YACHIRU_API_KEY}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${YACHIRU_API_KEY}")
fi

# Execute deterministic audit scan (no AI narrative needed)
RESPONSE=$(curl -s -f -X POST "${YACHIRU_URL}/api/analyze" \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  -d "{
    \"host\": \"${TARGET_HOST}\",
    \"port\": ${TARGET_PORT},
    \"protocol\": \"http\",
    \"username\": \"${TARGET_USER}\",
    \"password\": \"${TARGET_PASS}\",
    \"database\": \"${TARGET_DB}\",
    \"enableAiNarrative\": false,
    \"isDemo\": false
  }")

# Extract health score, verdict, and counts using jq
SCORE=$(echo "${RESPONSE}" | jq -r '.overall_score // empty')
VERDICT=$(echo "${RESPONSE}" | jq -r '.overall_verdict // "Unknown"')
CRITICALS=$(echo "${RESPONSE}" | jq -r '.summary.critical_count // 0')
WARNINGS=$(echo "${RESPONSE}" | jq -r '.summary.warning_count // 0')

if [[ -z "${SCORE}" ]]; then
  echo "ERROR: Failed to retrieve valid health score from Yachiru response."
  echo "${RESPONSE}" | jq .
  exit 1
fi

echo "--------------------------------------------------------"
echo "Health Score : ${SCORE}/100 (${VERDICT})"
echo "Issues Found : ${CRITICALS} critical, ${WARNINGS} warning"
echo "--------------------------------------------------------"

# Gating condition: Fail if critical issues found or score is below threshold
if (( SCORE < MINIMUM_SCORE )) || (( CRITICALS > 0 )); then
  echo "❌ CI GATE FAILED: Cluster health score (${SCORE}) is below minimum (${MINIMUM_SCORE}) or critical issues exist (${CRITICALS})."
  echo "Top Findings:"
  echo "${RESPONSE}" | jq -r '.findings[] | select(.status == "critical" or .status == "warning") | "- [\(.status | ascii_upcase)] \(.title): \(.impact)"' | head -n 5
  exit 1
fi

echo "✅ CI GATE PASSED: Cluster health satisfies performance standards."
exit 0
```
