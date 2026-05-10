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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Bake the version into the image at build time. A real release passes
# TAG=1.5.0 (optionally with a leading v), and that's the version the
# running container reports + compares against Docker Hub. A bare
# `./scripts/publish-docker.sh` (no TAG) is treated as a dev push and
# stays out of the update-check entirely.
if [[ "${TAG}" == "latest" ]]; then
  BUILD_VERSION="dev"
else
  BUILD_VERSION="${TAG#v}"
fi

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

# ── Pre-push gate: build linux/amd64 locally and inspect its layers ──
# `docker buildx build --push` for a multi-arch manifest goes straight to
# the registry without leaving anything in the local daemon. We can't
# inspect what we just built that way. So we do a single-arch local load
# first, fail the script if the image leaks source artifacts, and only
# then run the real multi-arch build + push.
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
