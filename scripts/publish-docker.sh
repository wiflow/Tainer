#!/usr/bin/env bash
# Usage: [TAG=1.2.3] ./scripts/publish-docker.sh

set -euo pipefail

IMAGE="tainersh/tainer"
TAG="${TAG:-latest}"
BUILDER="tainer-multiarch"
PLATFORMS="linux/amd64,linux/arm64"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${TAG}" == "latest" ]]; then
  BUILD_VERSION="dev"
else
  BUILD_VERSION="${TAG#v}"
fi

if ! docker buildx inspect "${BUILDER}" &>/dev/null; then
  echo "── Creating buildx builder '${BUILDER}' ──"
  docker buildx create --name "${BUILDER}" --driver docker-container --bootstrap
fi

docker buildx use "${BUILDER}"

TAGS=("-t" "${IMAGE}:${TAG}")
if [[ "${TAG}" != "latest" ]]; then
  TAGS+=("-t" "${IMAGE}:latest")
fi

# A multi-arch --push build never lands locally, so load one arch to inspect first.
GATE_TAG="${IMAGE}:gate-${TAG}"
echo "=== Pre-push gate: building linux/amd64 locally ==="
docker buildx build \
  --platform linux/amd64 \
  --load \
  --build-arg "TAINER_VERSION=${BUILD_VERSION}" \
  -t "${GATE_TAG}" \
  .

echo ""
"${SCRIPT_DIR}/check-image-layers.sh" "${GATE_TAG}"
docker image rm "${GATE_TAG}" >/dev/null 2>&1 || true

echo ""
echo "=== Building ${IMAGE}:${TAG} for ${PLATFORMS} ==="
docker buildx build \
  --platform "${PLATFORMS}" \
  --build-arg "TAINER_VERSION=${BUILD_VERSION}" \
  "${TAGS[@]}" \
  --push \
  .

echo ""
echo "=== Published ==="
echo "   ${IMAGE}:${TAG}"
[[ "${TAG}" != "latest" ]] && echo "   ${IMAGE}:latest"
