# Yachiru: The Holistic ClickHouse Optimization & Health Advisor

A developer-grade, zero-mutation audit and optimization advisor for ClickHouse. Analyzes tables across 9 critical dimensions with dynamic `system.query_log` correlation, automatic migration script generation, and optional AI-assisted deep diagnostic reports.

---

## 🐳 Running with Docker

### Option 1: Docker Compose (Recommended)

Start Yachiru on port `3000`:
```bash
docker compose up -d
```

Open your browser at `http://localhost:3000`.


### Option 2: Standalone Docker

1. **Build the container image**:
   ```bash
   docker build -t yachiru:latest .
   ```

2. **Run container with persistent history storage**:
   ```bash
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

## ⚙️ Environment Variables

| Variable | Description | Required | Default |
|---|---|---|---|
| `PORT` | HTTP Port for the application | No | `3000` |
| `NODE_ENV` | Environment mode (`production` / `development`) | No | `production` |
| `GEMINI_API_KEY` | Gemini API Key for AI synthesis reports | No | None |

---

## 🛡️ ClickHouse Read-Only Auditing User

Execute this script in your ClickHouse instance (via clickhouse-client or HTTP API) to configure the least-privilege read-only auditing account:

```sql
-- Create read-only auditing user
CREATE USER yachiru_readonly IDENTIFIED WITH sha256_password BY 'StrongPassword123!';

-- Grant SELECT access to system diagnostic tables
GRANT SELECT ON system.tables TO yachiru_readonly;
GRANT SELECT ON system.columns TO yachiru_readonly;
GRANT SELECT ON system.parts TO yachiru_readonly;
GRANT SELECT ON system.merges TO yachiru_readonly;
GRANT SELECT ON system.query_log TO yachiru_readonly;
GRANT SELECT ON system.settings TO yachiru_readonly;
GRANT SELECT ON system.part_log TO yachiru_readonly;

-- Grant SELECT on your target database to inspect schema & sample cardinality
GRANT SELECT ON target_db.* TO yachiru_readonly;
```

---

## 💻 Local Development (Without Docker)

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build and start production bundle
npm run build
npm start
```
