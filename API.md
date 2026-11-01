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

---

## 3. Endpoints Specification

### 3.1. `GET /api/health`
Checks server readiness, AI credentials status, and whether API key authentication is currently enforced.

- **Authentication**: None (Always Open)
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
  "hasGeminiApiKey": true,
  "hasOpenAiApiKey": false,
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
  }
}
```

---

### 3.2. `GET /api/system-key-status`
Returns circuit-breaker state for server-level AI API keys (quota depletion cooldown tracking).

- **Authentication**: None (Always Open)
- **Query Parameters**:
  - `provider` (optional): `'gemini'` (default) or `'openai'`
- **Rate Limited**: No

#### Request Example
```bash
curl -s "http://localhost:3000/api/system-key-status?provider=gemini"
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
  "message": "Connected to ClickHouse 24.8.4.13.",
  "version": "24.8.4.13",
  "uptime": "14 days, 6 hours"
}
```

#### Validation Error Response (`400 Bad Request`)
```json
{
  "error": "host is required and must be a non-empty string."
}
```

#### Connection Failure Response (`500 Internal Server Error`)
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
| `aiProvider` | `'gemini' \| 'openai'` | No | Optional AI provider override. |
| `geminiModel` | `string` | No | Target model (e.g., `'gemini-3.8-flash'`). |
| `geminiApiKey` | `string` | No | Caller-provided Gemini API key (optional). |
| `openaiApiKey` | `string` | No | Caller-provided OpenAI API key (optional). |

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

#### Validation Error Response (`400 Bad Request`)
```json
{
  "error": "host is required and must be a non-empty string."
}
```

---

### 3.5. `POST /api/narrate`
Synthesizes executive diagnoses and prioritized action items from an existing `AnalysisReport` using Gemini or OpenAI.

- **Authentication**: Required when `YACHIRU_API_KEY` is set.
- **Rate Limited**: Yes (default 15 requests/minute, configurable via `YACHIRU_NARRATE_RATE_LIMIT_PER_MINUTE`).

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `report` | `AnalysisReport` | Yes | Existing analysis report to evaluate. |
| `provider` | `'gemini' \| 'openai'` | No | Target AI provider. |
| `model` | `string` | No | Model name (e.g. `'gemini-3.8-flash'`). |
| `apiKey` | `string` | No | Optional client API key for the chosen provider. |

#### Request Example
```bash
curl -s -X POST http://localhost:3000/api/narrate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_YACHIRU_API_KEY" \
  -d '{
    "report": { ... },
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
