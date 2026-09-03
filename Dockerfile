# ===================================================
# Stage 1: Dependencies Resolution & Installation
# ===================================================
FROM node:20-slim AS deps

WORKDIR /app

# Copy dependency manifests for deterministic installation
COPY package.json package-lock.json ./

# Harden npm network resilience against transient socket resets (ECONNRESET)
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

# Install all dependencies (production + devDependencies required for Vite/esbuild)
# Using BuildKit cache mount to preserve downloaded tarballs across builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ===================================================
# Stage 2: Build Client SPA & Server Bundle
# ===================================================
FROM node:20-slim AS builder

WORKDIR /app

# Ensure local npm bin is prioritized in PATH
ENV PATH="/app/node_modules/.bin:${PATH}"

# Copy source code first, then overlay freshly resolved dependencies
COPY . .
COPY --from=deps /app/node_modules ./node_modules

# Compile Vite frontend into dist/ and bundle Express server into dist/server.cjs
RUN npm run build

# ===================================================
# Stage 3: Production Dependencies (Pruned Locally)
# ===================================================
FROM node:20-slim AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules

# Prune devDependencies in-place (takes ~1-2s, 0 network requests, 0 ECONNRESET risk)
RUN npm prune --omit=dev --no-audit --no-fund

# ===================================================
# Stage 4: Production Minimal Runtime
# ===================================================
FROM node:20-slim AS runner

WORKDIR /app

# Enforce production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy only production node_modules from prod-deps stage
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy compiled production artifacts
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Prepare persistent volume directory and assign non-root ownership
RUN mkdir -p /app/data && chown -R node:node /app

# Run as non-root user for security hardening
USER node

EXPOSE 3000

# Built-in lightweight healthcheck using native Node.js HTTP client (zero external binary overhead)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) process.exit(1)}).on('error', () => process.exit(1))"

# Start production server
CMD ["node", "dist/server.cjs"]
