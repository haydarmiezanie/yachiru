# ---------------------------------------------------
# Stage 1: Build Phase
# ---------------------------------------------------
FROM node:20-slim AS builder

WORKDIR /app

# Copy package.json only to avoid lockfile libc (musl/glibc) mismatches
COPY package.json ./

# Install all dependencies (including vite, esbuild, typescript)
RUN npm install

# Copy source files
COPY . .

# Build Vite frontend and bundle Express backend to dist/server.cjs
RUN npm run build

# ---------------------------------------------------
# Stage 2: Production Runtime
# ---------------------------------------------------
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy compiled artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Create persistent data directory for scan histories
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user for container security
USER node

# Expose HTTP port
EXPOSE 3000

# Health check against Yachiru API using Node built-in http client
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start Yachiru server
CMD ["node", "dist/server.cjs"]
