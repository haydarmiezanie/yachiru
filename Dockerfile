# ---------------------------------------------------
# Stage 1: Build Phase
# ---------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm install

# Copy source files
COPY . .

# Build Vite client and bundle Express server to dist/server.cjs
RUN npm run build

# ---------------------------------------------------
# Stage 2: Production Runtime
# ---------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./

# 1. Gunakan BuildKit cache mount & skip audit/fund (tidak perlu 'npm cache clean')
# 2. --ignore-scripts agar tidak buang waktu menjalankan lifecycle scripts
RUN --mount=type=cache,target=/root/.npm \
    npm install --omit=dev --no-audit --no-fund --ignore-scripts

# Copy compiled artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Create persistent data directory for scan histories
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.cjs"]
