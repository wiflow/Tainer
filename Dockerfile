# ── Stage 1: Build ──
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Minify server.mjs to strip comments and make it harder to read
RUN npx esbuild server.mjs --bundle --platform=node --target=node20 \
    --minify --format=esm --outfile=server.min.mjs \
    --external:next --external:ws --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# ── Stage 2: Production ──
FROM node:20-alpine AS runtime
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache openssh-client sshpass

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy build output only (no source code)
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.min.mjs ./server.mjs
COPY --from=builder /app/next.config.ts ./next.config.ts

# Remove leftover files that could leak info
RUN rm -rf /app/.next/cache/webpack \
    && find /app/.next -name '*.map' -delete \
    && find /app/.next -name '*.ts' -not -name '*.d.ts' -delete

# Non-root user
RUN addgroup -g 1001 tainer && adduser -u 1001 -G tainer -s /bin/false -D tainer
RUN mkdir -p /app/data && chown -R tainer:tainer /app /app/data
USER tainer

ENV NODE_ENV=production
ENV PORT=3000
ENV TAINER_DATA_DIR=/app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "require('http').get('http://localhost:3000', r => process.exit(r.statusCode < 400 || r.statusCode === 307 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.mjs"]
