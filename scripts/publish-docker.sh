#!/usr/bin/env bash
#
# Build a multi-arch Docker image and push to Docker Hub.
#
# Usage:
#   ./scripts/publish-docker.sh              # push tainersh/tainer:latest
#   TAG=1.2.3 ./scripts/publish-docker.sh    # push tainersh/tainer:1.2.3 + :latest
#
# Requirements:
#   - docker buildx (bundled with Docker Desktop / Docker Engine ≥ 19.03)
#   - logged in to Docker Hub: docker login

set -euo pipefail

IMAGE="tainersh/tainer"
TAG="${TAG:-latest}"
BUILDER="tainer-multiarch"
PLATFORMS="linux/amd64,linux/arm64"

# Ensure a buildx builder with multi-arch support exists.
if ! docker buildx inspect "${BUILDER}" &>/dev/null; then
  echo "── Creating buildx builder '${BUILDER}' ──"
  docker buildx create --name "${BUILDER}" --driver docker-container --bootstrap
fi

docker buildx use "${BUILDER}"

TAGS=("-t" "${IMAGE}:${TAG}")
if [[ "${TAG}" != "latest" ]]; then
  TAGS+=("-t" "${IMAGE}:latest")
fi

echo "=== Building ${IMAGE}:${TAG} for ${PLATFORMS} ==="
docker buildx build \
  --platform "${PLATFORMS}" \
  "${TAGS[@]}" \
  --push \
  .

echo ""
echo "=== Published ==="
echo "   ${IMAGE}:${TAG}"
[[ "${TAG}" != "latest" ]] && echo "   ${IMAGE}:latest"
