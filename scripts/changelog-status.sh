#!/usr/bin/env bash
#
# Show what has accumulated since the last release tag.
#
# Lists every commit since the latest vX.Y.Z tag alongside the current
# [Unreleased] block from CHANGELOG.md, so you can spot commits that
# touched user-visible code but never made it into the changelog.
#
# Read-only — never modifies anything.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

CHANGELOG="$REPO_ROOT/CHANGELOG.md"

PREV_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"

if [[ -z "$PREV_TAG" ]]; then
  echo "ℹ️  No release tags yet. Showing all commits."
  RANGE=""
else
  echo "Previous release: $PREV_TAG"
  RANGE="$PREV_TAG..HEAD"
fi

echo ""
echo "── Commits since $PREV_TAG (newest first) ──"
if [[ -n "$RANGE" ]]; then
  git log --oneline "$RANGE"
else
  git log --oneline
fi

echo ""
echo "── Files touched since $PREV_TAG ──"
if [[ -n "$RANGE" ]]; then
  git diff --stat "$RANGE"
else
  git log --stat
fi

echo ""
echo "── Current [Unreleased] section in CHANGELOG.md ──"
if [[ -f "$CHANGELOG" ]]; then
  awk '
    /^## \[Unreleased\]/ { capture = 1; print; next }
    capture && /^## \[/ { capture = 0 }
    capture { print }
  ' "$CHANGELOG"
else
  echo "(CHANGELOG.md not found)"
fi

echo ""
echo "Run scripts/release.sh when you are ready to cut the next version."
