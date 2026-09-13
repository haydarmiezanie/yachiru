# Yachiru ClickHouse Analyzer - Local Docker Deployment Guide

Yachiru is an automated health audit and performance diagnostics analyzer for ClickHouse clusters.

---

## Quick Start with Docker Compose

The repository includes a ready-to-run `docker-compose.yml` for the **Yachiru Analyzer** on port `3000`.

### 1. Build and Run
```bash
docker compose up --build
```
Or run in the background:
```bash
docker compose up -d --build
```

### 2. Access the Application
Open your browser at:
**[http://localhost:3000](http://localhost:3000)**

---

## Connecting to Your Existing ClickHouse

1. **If ClickHouse is running directly on your Host Machine (bare-metal / local service)**:
   - **Host**: `host.docker.internal` *(or your local network IP e.g. `192.168.x.x`)*
   - **Port**: `8123` (HTTP interface)
   - **Database**: `default` (or your target database)
   - **User**: your ClickHouse username
   - **Password**: your ClickHouse password

2. **If ClickHouse is running on another Server, VM, or Cloud (ClickHouse Cloud / Aiven / Self-hosted)**:
   - **Host**: your server IP or domain (e.g., `ch-server.internal.net` or `xxx.clickhouse.cloud`)
   - **Port**: `8123` (plain HTTP) or `8443` (HTTPS / Cloud)
   - **SSL/TLS**: Enable if connecting via port `8443` or HTTPS
   - **User & Password**: your credentials

3. **Zero Setup Simulation**:
   - Click the **"Simulate Production Scan"** button on the home page to test all diagnostic rules, charts, metrics, and narrative generation with realistic cluster metrics.

---

## Standalone Docker Build & Run (Without Compose)

```bash
# 1. Build Docker Image
docker build -t yachiru-analyzer .

# 2. Run Container (with host network mapping enabled)
docker run -d -p 3000:3000 --add-host=host.docker.internal:host-gateway --name yachiru-app yachiru-analyzer

# 3. (Optional) Pass Gemini API Key as environment variable
docker run -d -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e GEMINI_API_KEY="your_api_key_here" \
  --name yachiru-app yachiru-analyzer
```

---

## Stopping the Container

```bash
docker compose down
```
