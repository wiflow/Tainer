FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Cleanup must share the build RUN: a later delete leaves the files in earlier layers.
RUN npm run build \
    && rm -rf /app/.next/cache \
    && find /app/.next -name '*.map' -delete \
    && find /app/.next -name '*.ts' -not -name '*.d.ts' -delete

RUN ./node_modules/.bin/esbuild server.mjs --bundle --platform=node --target=node24 \
    --minify --format=esm --outfile=server.min.mjs \
    --external:next --external:@next/env --external:ws --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

FROM node:24-alpine AS runtime
WORKDIR /app

ARG TAINER_VERSION=dev
ENV TAINER_VERSION=$TAINER_VERSION

RUN apk add --no-cache openssh-client sshpass

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.min.mjs ./server.mjs
COPY --from=builder /app/next.config.mjs ./next.config.mjs

RUN addgroup -g 1001 tainer && adduser -u 1001 -G tainer -s /bin/false -D tainer
# .next/cache stays writable because Next writes its incremental cache there at runtime.
RUN mkdir -p /app/data /app/.next/cache \
    && chown -R root:tainer /app \
    && chown -R tainer:tainer /app/data /app/.next/cache \
    && find /app -path /app/data -prune -o -path /app/.next/cache -prune -o -type d -exec chmod 0750 {} + \
    && find /app -path /app/data -prune -o -path /app/.next/cache -prune -o -type f -exec chmod 0640 {} + \
    && chmod 0770 /app/data /app/.next/cache
USER tainer

ENV NODE_ENV=production
ENV PORT=3000
ENV TAINER_DATA_DIR=/app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "require('http').get('http://localhost:3000', r => process.exit(r.statusCode < 400 || r.statusCode === 307 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.mjs"]
