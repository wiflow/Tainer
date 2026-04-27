#!/usr/bin/env bash
#
# Cut a new Tainer release.
#
# Usage:
#   scripts/release.sh                # interactive: prompts for version
#   scripts/release.sh 1.2.0          # non-interactive: tag as v1.2.0
#
# What it does (in order):
#   1. Refuses if the working tree is dirty
#   2. Finds the previous tag (git describe --tags --abbrev=0)
#   3. Lists every commit since that tag, so you can verify coverage
#   4. Prints the current [Unreleased] block from CHANGELOG.md
#   5. Asks you to confirm the new version
#   6. Atomically rewrites CHANGELOG.md:
#        [Unreleased] -> [X.Y.Z] - YYYY-MM-DD
#        + new empty [Unreleased] section above it
#   7. git commit -m "Release vX.Y.Z" + git tag vX.Y.Z
#
# Push with:  git push origin main && git push origin vX.Y.Z

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

CHANGELOG="$REPO_ROOT/CHANGELOG.md"

# ── Sanity checks ──

if [[ ! -f "$CHANGELOG" ]]; then
  echo "❌ CHANGELOG.md not found at $CHANGELOG" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Working tree has uncommitted changes. Commit or stash first." >&2
  git status --short
  exit 1
fi

# ── Identify previous version ──

PREV_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"

if [[ -z "$PREV_TAG" ]]; then
  echo "ℹ️  No previous tag found — this will be the first release."
  RANGE_LABEL="all commits"
  GIT_RANGE=""
else
  echo "Previous version: $PREV_TAG"
  RANGE_LABEL="commits since $PREV_TAG"
  GIT_RANGE="$PREV_TAG..HEAD"
fi

# ── Show commits since previous tag ──

echo ""
echo "── $RANGE_LABEL ──"
if [[ -n "$GIT_RANGE" ]]; then
  git log --oneline "$GIT_RANGE" || true
else
  git log --oneline
fi

# ── Show current [Unreleased] block ──

echo ""
echo "── Current [Unreleased] in CHANGELOG.md ──"
awk '
  /^## \[Unreleased\]/ { capture = 1; print; next }
  capture && /^## \[/ { capture = 0 }
  capture { print }
' "$CHANGELOG"

# ── Decide version ──

NEW_VERSION="${1:-}"
if [[ -z "$NEW_VERSION" ]]; then
  echo ""
  read -r -p "Enter new version (e.g. 1.2.0, no leading 'v'): " NEW_VERSION
fi

if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  echo "❌ Version must look like X.Y.Z or X.Y.Z-rc.1, got: $NEW_VERSION" >&2
  exit 1
fi

NEW_TAG="v${NEW_VERSION}"
TODAY="$(date +%Y-%m-%d)"

if git rev-parse "$NEW_TAG" >/dev/null 2>&1; then
  echo "❌ Tag $NEW_TAG already exists." >&2
  exit 1
fi

echo ""
echo "About to release $NEW_TAG ($TODAY)."
read -r -p "Continue? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 1
fi

# ── Rewrite CHANGELOG.md ──

# Replace the first occurrence of `## [Unreleased]` with the new version
# header, then prepend a fresh empty [Unreleased] section above it.
TMP="$(mktemp)"
awk -v ver="$NEW_VERSION" -v today="$TODAY" '
  BEGIN { replaced = 0 }
  /^## \[Unreleased\]/ && !replaced {
    print "## [Unreleased]"
    print ""
    print "### Added"
    print ""
    print "### Changed"
    print ""
    print "### Fixed"
    print ""
    print "## [" ver "] - " today
    replaced = 1
    next
  }
  { print }
' "$CHANGELOG" > "$TMP"

mv "$TMP" "$CHANGELOG"

# ── Commit and tag ──

git add "$CHANGELOG"
git commit -m "Release ${NEW_TAG}"
git tag "$NEW_TAG"

echo ""
echo "✅ Released $NEW_TAG"
echo ""
echo "To publish:"
echo "  git push origin main"
echo "  git push origin $NEW_TAG"
