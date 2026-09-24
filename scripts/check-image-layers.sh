#!/usr/bin/env bash
# Usage: scripts/check-image-layers.sh [image-or-digest] (default tainersh/tainer:latest)

set -euo pipefail

IMAGE="${1:-tainersh/tainer:latest}"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required" >&2
  exit 1
fi

if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "error: image '${IMAGE}' not found locally — build or pull it first" >&2
  exit 1
fi

WORK="$(mktemp -d -t tainer-image-check.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo "=== Saving ${IMAGE} for layer inspection ==="
docker save "${IMAGE}" -o "${WORK}/image.tar"
mkdir -p "${WORK}/extract"
tar -xf "${WORK}/image.tar" -C "${WORK}/extract"

# Newer docker save output uses blobs/sha256/*, older output uses <hash>/layer.tar.
shopt -s nullglob
LAYER_BLOBS=("${WORK}/extract"/blobs/sha256/* "${WORK}/extract"/*/layer.tar)
shopt -u nullglob

if [[ ${#LAYER_BLOBS[@]} -eq 0 ]]; then
  echo "error: no layer blobs found in ${WORK}/extract — unexpected docker save format" >&2
  exit 1
fi

FINDINGS_FILE="${WORK}/findings.txt"
: >"${FINDINGS_FILE}"

for blob in "${LAYER_BLOBS[@]}"; do
  if ! tar -tf "${blob}" >/dev/null 2>&1; then
    continue
  fi

  tar -tf "${blob}" 2>/dev/null | awk -v blob="$(basename "${blob}")" '
    /\/$/  { next }
    # npm packages legitimately ship maps and .ts files; only Tainer output counts.
    /\/node_modules\// { next }
    /^node_modules\//  { next }
    /\.js\.map$/  { print blob "\t" $0; next }
    /\.css\.map$/ { print blob "\t" $0; next }
    /\.ts$/ && !/\.d\.ts$/ { print blob "\t" $0; next }
    /\.tsbuildinfo$/        { print blob "\t" $0; next }
    /password-reset-debug\.json$/ { print blob "\t" $0; next }
  ' >>"${FINDINGS_FILE}" || true
done

if [[ -s "${FINDINGS_FILE}" ]]; then
  echo ""
  echo "=== FAIL: forbidden artifacts in image layers ==="
  echo ""
  # Do not pipe into head: SIGPIPE under pipefail would exit 141 instead of 1.
  UNIQUE="${WORK}/findings.unique.txt"
  awk -F'\t' '{ print $2 }' "${FINDINGS_FILE}" | sort -u >"${UNIQUE}"
  TOTAL=$(wc -l <"${UNIQUE}" | tr -d ' ')

  awk 'NR<=50' "${UNIQUE}"
  if [[ "${TOTAL}" -gt 50 ]]; then
    echo "... and $((TOTAL - 50)) more"
  fi
  echo ""
  echo "Image: ${IMAGE}"
  echo "Total: ${TOTAL} unique forbidden path(s)"
  echo ""
  echo "Note: Docker layers are append-only — deleting these in a later RUN"
  echo "step does NOT remove them from the published image. Move the cleanup"
  echo "into the same RUN as 'npm run build' (in the builder stage) so the"
  echo "runtime stage never carries them in any layer."
  exit 1
fi

echo "=== OK: ${IMAGE} contains no forbidden artifacts ==="
