#!/usr/bin/env bash
#
# Deploy Tainer to the onsite server (Docker-based)
#
# Usage:
#   ./scripts/deploy-onsite.sh                         # build + deploy
#   ENV_FILE=.env.onsite ./scripts/deploy-onsite.sh    # deploy + push env file
#
# First-time setup on the server:
#   1. SSH in and install Docker + Docker Compose:
#        curl -fsSL https://get.docker.com | sh
#        sudo usermod -aG docker tainer
#   2. Create the app directory:
#        ssh tainer@192.0.2.10 "mkdir -p /home/tainer/tainer"
#   3. (Optional) Create .env.onsite locally for environment variables
#
# How it works:
#   1. Rsyncs source to a build directory on the server
#   2. Builds the Docker image natively on the server (correct arch)
#   3. Pushes docker-compose.yml and optional .env file
#   4. Runs `docker compose up -d` to start/restart the container
#   5. Verifies healthcheck
#
# The data directory at ~/.tainer is bind-mounted into the container
# so existing state (users, sessions, settings) is preserved.

set -euo pipefail

IMAGE_NAME="tainersh/tainer"
IMAGE_TAG="latest"
IMAGE_FULL="${IMAGE_NAME}:${IMAGE_TAG}"

VM_HOST="192.0.2.10"
VM_USER="tainer"
APP_DIR="/home/tainer/tainer"
BUILD_DIR="/home/tainer/tainer-build"
DATA_DIR="/home/tainer/.tainer"
CADDY_DATA_DIR="/home/tainer/.tainer-caddy"
# Public hostname users connect to — also used for HTTPS cert SAN and as APP_URL.
# Override with `TAINER_HOSTNAME=other.host bash scripts/deploy-onsite.sh`.
TAINER_HOSTNAME="${TAINER_HOSTNAME:-tainer.example.com}"
ENV_FILE="${ENV_FILE:-}"
DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-REDACTED}"

# ── SSH setup ──

SSH_CMD=(ssh -o StrictHostKeyChecking=no)
SCP_CMD=(scp -o StrictHostKeyChecking=no)

if [[ -n "${DEPLOY_PASSWORD}" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "sshpass is required when DEPLOY_PASSWORD is set. Install with: brew install sshpass" >&2
    exit 1
  fi
  export SSHPASS="${DEPLOY_PASSWORD}"
  SSH_CMD=(sshpass -e "${SSH_CMD[@]}")
  SCP_CMD=(sshpass -e "${SCP_CMD[@]}")
  export RSYNC_RSH="sshpass -e ssh -o StrictHostKeyChecking=no"
fi

remote() {
  "${SSH_CMD[@]}" "${VM_USER}@${VM_HOST}" "$@"
}

echo "=== Deploying Tainer (Docker) to ${VM_USER}@${VM_HOST} ==="

# ── Step 1: Sync source to server ──

echo ""
echo "── Syncing source to ${VM_HOST}:${BUILD_DIR} ──"
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude data \
  --exclude .env.local \
  --exclude .env.onsite \
  ./ "${VM_USER}@${VM_HOST}:${BUILD_DIR}/"

# ── Step 2: Build image on server (native arch) ──

echo ""
echo "── Building Docker image on server ──"
remote "cd ${BUILD_DIR} && docker build -t ${IMAGE_FULL} ."

# ── Step 3: Push docker-compose.yml + Caddyfile ──

echo ""
echo "── Configuring docker-compose + Caddy reverse proxy ──"
remote "mkdir -p ${APP_DIR} ${DATA_DIR} ${CADDY_DATA_DIR}"

# Ensure data dir ownership matches container user (uid 1001).
remote "printf '%s\n' '${DEPLOY_PASSWORD}' | sudo -S -p '' chown -R 1001:1001 ${DATA_DIR}"

# Caddy reverse proxy:
#   - Listens on 80 + 443 publicly.
#   - Cert mode auto-detected:
#       * If ${CADDY_CERTS_DIR}/cert.pem and key.pem both exist on the host,
#         use them (bring-your-own cert from corporate AD CA, etc.).
#       * Otherwise fall back to `tls internal` — Caddy's own self-signed CA.
#         Browsers warn the first time per device; accept once.
#   - Responds on both the hostname and the bare IP so old IP-based bookmarks
#     keep working with HTTPS.
#   - HTTP requests get auto-redirected to HTTPS (Caddy's default behaviour).
CADDY_CERTS_DIR="${APP_DIR}/certs"
remote "mkdir -p ${CADDY_CERTS_DIR}"

if remote "test -f ${CADDY_CERTS_DIR}/cert.pem && test -f ${CADDY_CERTS_DIR}/key.pem"; then
  echo "  Using bring-your-own TLS cert at ${CADDY_CERTS_DIR}/cert.pem"
  TLS_DIRECTIVE="tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem"
else
  echo "  No cert files found at ${CADDY_CERTS_DIR}/cert.pem — using Caddy self-signed (tls internal)"
  echo "  To switch to a real cert later: drop cert.pem + key.pem into ${CADDY_CERTS_DIR}/ and restart Caddy."
  TLS_DIRECTIVE="tls internal"
fi

remote "cat > ${APP_DIR}/Caddyfile" <<CADDYFILE
{
  # ACME email for self-signed mode is unused but Caddy expects a value.
  email admin@${TAINER_HOSTNAME}
}

${TAINER_HOSTNAME}, ${VM_HOST} {
  ${TLS_DIRECTIVE}
  encode zstd gzip

  # Surface the original host/proto so Tainer's OIDC redirect-URI builder
  # and IP-allowlists see the real client + scheme rather than the docker
  # network's internal IP.
  header_up Host {host}
  header_up X-Forwarded-For {remote}
  header_up X-Forwarded-Proto {scheme}
  header_up X-Forwarded-Host {host}

  reverse_proxy tainer:3000
}
CADDYFILE

# Generate docker-compose.yml: tainer (internal-only) + caddy (public).
remote "cat > ${APP_DIR}/docker-compose.yml" <<COMPOSE
services:
  tainer:
    image: ${IMAGE_FULL}
    # No published ports — only Caddy reaches Tainer, on the internal docker
    # network.
    expose:
      - "3000"
    volumes:
      - ${DATA_DIR}:/app/data
    environment:
      - APP_URL=https://${TAINER_HOSTNAME}
    restart: unless-stopped

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ${APP_DIR}/Caddyfile:/etc/caddy/Caddyfile:ro
      - ${CADDY_DATA_DIR}/data:/data
      - ${CADDY_DATA_DIR}/config:/config
    depends_on:
      - tainer
    restart: unless-stopped
COMPOSE

# ── Step 4: Push .env file if provided ──

if [[ -n "${ENV_FILE}" && -f "${ENV_FILE}" ]]; then
  echo ""
  echo "── Pushing environment file ${ENV_FILE} ──"
  "${SCP_CMD[@]}" "${ENV_FILE}" "${VM_USER}@${VM_HOST}:${APP_DIR}/.env.local"

  # Append env_file directive to the tainer service.
  # The block must indent under `tainer:` — careful with the heredoc whitespace.
  remote "sed -i '/^  tainer:/a\\    env_file:\\n      - .env.local' ${APP_DIR}/docker-compose.yml"
fi

# ── Step 5: Start / restart container ──

echo ""
echo "── Starting container ──"
remote "cd ${APP_DIR} && docker compose up -d --force-recreate --remove-orphans"

# ── Step 6: Verify ──

echo ""
echo "── Waiting for health check ──"
sleep 8

remote "cd ${APP_DIR} && docker compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'"
remote "docker logs \$(cd ${APP_DIR} && docker compose ps -q) 2>&1 | tail -5"

echo ""
echo "=== Deploy complete ==="
echo "   Tainer is running at https://${TAINER_HOSTNAME}/  (also: https://${VM_HOST}/)"
echo ""
echo "   First-time HTTPS notes:"
echo "   - DNS: ensure ${TAINER_HOSTNAME} resolves to ${VM_HOST}"
echo "   - Cert: Caddy uses self-signed by default (browser warns once)"
echo "     To use a real cert, drop these files on the server:"
echo "       ${APP_DIR}/certs/cert.pem  (leaf + intermediate concatenated)"
echo "       ${APP_DIR}/certs/key.pem   (matching private key, chmod 600)"
echo "     Then: docker compose -f ${APP_DIR}/docker-compose.yml restart caddy"
