#!/usr/bin/env bash
#
# Fail the build if a Tainer Docker image leaks source artifacts in its
# layers. Catches the F1/F10 class of bug — Docker layers are append-only,
# so a `RUN ... -delete` after a `COPY .next` does NOT remove the bytes
# from the COPY layer; anyone who pulls the image can still extract them
# with `docker save | tar -x`.
#
# Usage:
#   scripts/check-image-layers.sh                       # checks tainersh/tainer:latest
#   scripts/check-image-layers.sh tainersh/tainer:1.4.1 # checks a specific tag
#   scripts/check-image-layers.sh sha256:<digest>       # checks a digest
#
# Patterns rejected (in any layer of the image, not just the runtime fs):
#   - *.js.map / *.css.map  (source maps embed sourcesContent → full TS recovery)
#   - *.ts (excluding *.d.ts) (TypeScript source)
#   - .tsbuildinfo          (incremental build metadata; leaks file paths)
#   - password-reset-debug.json (legacy debug-link file, must never ship)
#
# Exit code: 0 if clean, 1 if any forbidden pattern is found.

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

# Modern Docker exports use blobs/sha256/<digest> for both manifests and
# layer tarballs; older formats use <hash>/layer.tar. Match both.
shopt -s nullglob
LAYER_BLOBS=("${WORK}/extract"/blobs/sha256/* "${WORK}/extract"/*/layer.tar)
shopt -u nullglob

if [[ ${#LAYER_BLOBS[@]} -eq 0 ]]; then
  echo "error: no layer blobs found in ${WORK}/extract — unexpected docker save format" >&2
  exit 1
fi

# Collect findings across all layers, then report once at the end. Reporting
# per-layer hides duplicates that often mean the same file was layered over
# multiple times.
FINDINGS_FILE="${WORK}/findings.txt"
: >"${FINDINGS_FILE}"

for blob in "${LAYER_BLOBS[@]}"; do
  # `blobs/sha256/*` contains both layer tars AND JSON manifests — only
  # actual tarballs are relevant. `tar -tf` errors silently for non-tars.
  if ! tar -tf "${blob}" >/dev/null 2>&1; then
    continue
  fi

  tar -tf "${blob}" 2>/dev/null | awk -v blob="$(basename "${blob}")" '
    # Skip path-prefix entries that just describe a directory.
    /\/$/  { next }
    # Skip everything under node_modules. Public npm packages routinely
    # ship .js.map, .ts, and other "source-y" files as part of their
    # legitimate published distribution — those are not a leak of Tainer
    # source. The gate is here to catch Tainer’s own .next/ build
    # artefacts (the F1/F10 class), not third-party package contents.
    /\/node_modules\// { next }
    /^node_modules\//  { next }
    # Source maps — the headline issue.
    /\.js\.map$/  { print blob "\t" $0; next }
    /\.css\.map$/ { print blob "\t" $0; next }
    # TypeScript source (but allow .d.ts type-only files; those ship
    # transitively from npm-published packages and are not a leak).
    /\.ts$/ && !/\.d\.ts$/ { print blob "\t" $0; next }
    # Incremental TS build metadata leaks original file paths.
    /\.tsbuildinfo$/        { print blob "\t" $0; next }
    # Legacy debug-link file — should never ship in any layer.
    /password-reset-debug\.json$/ { print blob "\t" $0; next }
  ' >>"${FINDINGS_FILE}" || true
done

if [[ -s "${FINDINGS_FILE}" ]]; then
  echo ""
  echo "=== FAIL: forbidden artifacts in image layers ==="
  echo ""
  # Compute the unique-paths list into a file first, then read it. Piping
  # through `head` would SIGPIPE the upstream awk/sort under `pipefail`
  # and the script would exit 141 instead of 1.
  UNIQUE="${WORK}/findings.unique.txt"
  awk -F'\t' '{ print $2 }' "${FINDINGS_FILE}" | sort -u >"${UNIQUE}"
  TOTAL=$(wc -l <"${UNIQUE}" | tr -d ' ')

  # Group by filename for readability — the same path may appear in
  # multiple layers (the COPY layer plus a later whiteout layer).
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
