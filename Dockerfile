# ── Stage 1: Build ──
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && rm -rf /app/.next/cache \
    && find /app/.next -name '*.map' -delete \
    && find /app/.next -name '*.ts' -not -name '*.d.ts' -delete

# Strip source maps + TypeScript files from the build output in the SAME
# RUN as `npm run build`, before stage 2 copies anything. Docker layers are
# append-only: a later `RUN ... -delete` only writes a "whiteout" to the
# next layer — the original bytes still live in the COPY layer and remain
# extractable via `docker save` + tar. Cleaning here means the runtime
# image never carries source maps in its history at all.
#
# Removing the entire .next/cache (not just .next/cache/webpack) also gets
# rid of .next/cache/.tsbuildinfo, which embeds absolute build paths and
# the file list; the runtime needs nothing under cache/ to actually serve.

# Minify server.mjs to strip comments and make it harder to read
RUN ./node_modules/.bin/esbuild server.mjs --bundle --platform=node --target=node24 \
    --minify --format=esm --outfile=server.min.mjs \
    --external:next --external:ws --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# ── Stage 2: Production ──
FROM node:24-alpine AS runtime
WORKDIR /app

# Baked at build time by scripts/publish-docker.sh from the release tag.
# Defaults to "dev" so local `docker build` invocations stay out of the
# update-check path and never trigger an "update available" banner.
ARG TAINER_VERSION=dev
ENV TAINER_VERSION=$TAINER_VERSION

# openssh-client + sshpass are required for the password-based SSH path used
# when a Proxmox node has no managed key (see src/lib/ssh-command.ts). Both
# stay; nothing else from the build toolchain ships.
RUN apk add --no-cache openssh-client sshpass

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy build output only — already stripped of maps + .ts in the builder.
# next.config is shipped as .mjs (not .ts) so the runtime stage doesn't
# need the typescript package (~23 MB) just to load the config at boot.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.min.mjs ./server.mjs
COPY --from=builder /app/next.config.mjs ./next.config.mjs

# Non-root user. /app is owned by root and only group-readable by tainer,
# so the runtime user can read application code but cannot rewrite it
# (server.mjs, node_modules, .next/server bundles, etc.). Only /app/data
# is writable. This means a future code-exec-in-container bug cannot
# silently replace server.mjs and persist across restarts.
RUN addgroup -g 1001 tainer && adduser -u 1001 -G tainer -s /bin/false -D tainer
# .next/cache must stay writable: Next's incremental cache (unstable_cache,
# revalidateTag, image optimizer) writes there at runtime. Without it every
# request spams EACCES unhandled rejections and data caching silently
# degrades to per-process memory. It holds cache artifacts only — no code —
# so granting it doesn't weaken the read-only-code posture.
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
