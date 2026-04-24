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

# ── Step 3: Push docker-compose.yml ──

echo ""
echo "── Configuring docker-compose ──"
remote "mkdir -p ${APP_DIR} ${DATA_DIR}"

# Ensure data dir ownership matches container user (uid 1001)
remote "printf '%s\n' '${DEPLOY_PASSWORD}' | sudo -S -p '' chown -R 1001:1001 ${DATA_DIR}"

# Generate docker-compose.yml with bind mount to existing data
remote "cat > ${APP_DIR}/docker-compose.yml" <<COMPOSE
services:
  tainer:
    image: ${IMAGE_FULL}
    ports:
      - "3000:3000"
    volumes:
      - ${DATA_DIR}:/app/data
    environment:
      - APP_URL=http://${VM_HOST}:3000
    restart: unless-stopped
COMPOSE

# ── Step 4: Push .env file if provided ──

if [[ -n "${ENV_FILE}" && -f "${ENV_FILE}" ]]; then
  echo ""
  echo "── Pushing environment file ${ENV_FILE} ──"
  "${SCP_CMD[@]}" "${ENV_FILE}" "${VM_USER}@${VM_HOST}:${APP_DIR}/.env.local"

  # Append env_file directive
  remote "cat >> ${APP_DIR}/docker-compose.yml" <<'ENVPATCH'
    env_file:
      - .env.local
ENVPATCH
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
echo "   Tainer is running at http://${VM_HOST}:3000"
