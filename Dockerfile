# ---------------------------------------------------
# Stage 1: Build Phase
# ---------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Explicitly ensure development environment and node_modules/.bin in PATH
ENV NODE_ENV=development
ENV PATH="/app/node_modules/.bin:${PATH}"

# Install all dependencies including build toolchains
COPY package*.json ./
RUN npm install --include=dev --production=false

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

# Install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy compiled artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Create persistent data directory for scan histories
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user for container security
USER node

# Expose HTTP port
EXPOSE 3000

# Health check against Yachiru API
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start Yachiru server
CMD ["node", "dist/server.cjs"]
