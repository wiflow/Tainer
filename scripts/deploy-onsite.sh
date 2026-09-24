#!/usr/bin/env bash
# Usage: VM_HOST=host [ENV_FILE=.env.onsite] [DEPLOY_PASSWORD=...] ./scripts/deploy-onsite.sh

set -euo pipefail

IMAGE_NAME="tainersh/tainer"
IMAGE_TAG="latest"
IMAGE_FULL="${IMAGE_NAME}:${IMAGE_TAG}"

VM_HOST="${VM_HOST:-}"
VM_USER="${VM_USER:-tainer}"
APP_DIR="/home/tainer/tainer"
BUILD_DIR="/home/tainer/tainer-build"
DATA_DIR="/home/tainer/.tainer"
CADDY_DATA_DIR="/home/tainer/.tainer-caddy"
TAINER_HOSTNAME="${TAINER_HOSTNAME:-${VM_HOST}}"
ENV_FILE="${ENV_FILE:-}"
DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-}"

if [[ -z "${VM_HOST}" ]]; then
  echo "Set VM_HOST to the server to deploy to." >&2
  exit 1
fi

# Host keys must already be in ~/.ssh/known_hosts; verify the fingerprint with plain ssh.
SSH_CMD=(ssh -o StrictHostKeyChecking=yes)
SCP_CMD=(scp -o StrictHostKeyChecking=yes)
export RSYNC_RSH="ssh -o StrictHostKeyChecking=yes"

if [[ -n "${DEPLOY_PASSWORD}" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "sshpass is required when DEPLOY_PASSWORD is set. Install with: brew install sshpass" >&2
    exit 1
  fi
  export SSHPASS="${DEPLOY_PASSWORD}"
  SSH_CMD=(sshpass -e "${SSH_CMD[@]}")
  SCP_CMD=(sshpass -e "${SCP_CMD[@]}")
  export RSYNC_RSH="sshpass -e ${RSYNC_RSH}"
fi

remote() {
  "${SSH_CMD[@]}" "${VM_USER}@${VM_HOST}" "$@"
}

echo "=== Deploying Tainer (Docker) to ${VM_USER}@${VM_HOST} ==="

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

echo ""
echo "── Building Docker image on server ──"
remote "cd ${BUILD_DIR} && docker build -t ${IMAGE_FULL} ."

echo ""
echo "── Configuring docker-compose + Caddy reverse proxy ──"
remote "mkdir -p ${APP_DIR} ${DATA_DIR} ${CADDY_DATA_DIR}"

# uid 1001 is the tainer user inside the image.
if [[ -n "${DEPLOY_PASSWORD}" ]]; then
  printf '%s\n' "${DEPLOY_PASSWORD}" | remote "sudo -S -p '' chown -R 1001:1001 ${DATA_DIR}"
else
  "${SSH_CMD[@]}" -t "${VM_USER}@${VM_HOST}" "sudo chown -R 1001:1001 ${DATA_DIR}"
fi

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

# Caddy 2.11 fails the TLS handshake when a site block lists an address twice.
if [[ "${TAINER_HOSTNAME}" == "${VM_HOST}" ]]; then
  CADDY_SITE_ADDRESSES="${TAINER_HOSTNAME}"
else
  CADDY_SITE_ADDRESSES="${TAINER_HOSTNAME}, ${VM_HOST}"
fi

remote "cat > ${APP_DIR}/Caddyfile" <<CADDYFILE
{
  # Unused in self-signed mode, but Caddy expects a value.
  email admin@${TAINER_HOSTNAME}
  # Caddy 2.11 rejects TLS on a bare IP site address unless default_sni is set.
  default_sni ${TAINER_HOSTNAME}
}

${CADDY_SITE_ADDRESSES} {
  ${TLS_DIRECTIVE}
  encode zstd gzip

  reverse_proxy tainer:3000 {
    header_up Host {host}
  }
}
CADDYFILE

# Only caddy publishes ports, so plain HTTP to tainer is never exposed.
remote "cat > ${APP_DIR}/docker-compose.yml" <<COMPOSE
services:
  tainer:
    image: ${IMAGE_FULL}
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

if [[ -n "${ENV_FILE}" && -f "${ENV_FILE}" ]]; then
  echo ""
  echo "── Pushing environment file ${ENV_FILE} ──"
  "${SCP_CMD[@]}" "${ENV_FILE}" "${VM_USER}@${VM_HOST}:${APP_DIR}/.env.local"
fi

# The compose file is regenerated above, so re-attach .env.local or AUTH_SECRET is lost.
if remote "test -f ${APP_DIR}/.env.local"; then
  echo ""
  echo "── Detected ${APP_DIR}/.env.local — wiring env_file into docker-compose ──"
  remote "sed -i '/^  tainer:/a\\    env_file:\\n      - .env.local' ${APP_DIR}/docker-compose.yml"
fi

echo ""
echo "── Starting container ──"
remote "cd ${APP_DIR} && docker compose up -d --force-recreate --remove-orphans"

echo ""
echo "── Waiting for health check ──"
sleep 8

remote "cd ${APP_DIR} && docker compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'"
remote "docker logs \$(cd ${APP_DIR} && docker compose ps -q tainer) 2>&1 | tail -5"

echo ""
echo "=== Deploy complete ==="
echo "   HTTPS:  https://${TAINER_HOSTNAME}/"
echo ""
echo "   First-time HTTPS notes:"
echo "   - DNS: ensure ${TAINER_HOSTNAME} resolves to ${VM_HOST}"
echo "   - Cert: Caddy uses self-signed by default (browser warns once)"
echo "     To use a real cert, drop these files on the server:"
echo "       ${APP_DIR}/certs/cert.pem  (leaf + intermediate concatenated)"
echo "       ${APP_DIR}/certs/key.pem   (matching private key, chmod 600)"
echo "     Then: docker compose -f ${APP_DIR}/docker-compose.yml restart caddy"
