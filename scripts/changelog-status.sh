#!/usr/bin/env bash
#
# Show what has accumulated since the last release tag, with a coverage check.
#
# For each commit since the last vX.Y.Z tag:
#   ✓ green  — touched CHANGELOG.md (documented)
#   ✗ red    — touched src/ but did NOT touch CHANGELOG.md (likely missing)
#   ·  gray   — internal-only (scripts, docs, config); changelog optional
#
# Read-only — never modifies anything.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

CHANGELOG="$REPO_ROOT/CHANGELOG.md"

# ── Colour setup (auto-disabled when not a TTY or NO_COLOR set) ──

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET='\033[0m'
  C_BOLD='\033[1m'
  C_DIM='\033[2m'
  C_GREEN='\033[32m'
  C_RED='\033[31m'
  C_YELLOW='\033[33m'
  C_BLUE='\033[34m'
  C_MAGENTA='\033[35m'
  C_CYAN='\033[36m'
  C_GRAY='\033[90m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_BLUE=''; C_MAGENTA=''; C_CYAN=''; C_GRAY=''
fi

hdr() { printf "${C_BOLD}${C_CYAN}── %s ──${C_RESET}\n" "$1"; }

# ── Identify previous tag ──

PREV_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"

if [[ -z "$PREV_TAG" ]]; then
  printf "${C_DIM}No release tags yet — auditing all commits.${C_RESET}\n\n"
  RANGE=""
  RANGE_LABEL="all history"
else
  printf "Previous release: ${C_BOLD}${C_GREEN}%s${C_RESET}\n\n" "$PREV_TAG"
  RANGE="$PREV_TAG..HEAD"
  RANGE_LABEL="since $PREV_TAG"
fi

# ── Coverage table ──

hdr "Commits $RANGE_LABEL — coverage check"

documented_count=0
missing_count=0
internal_count=0

while IFS=$'\t' read -r sha subject; do
  [[ -z "$sha" ]] && continue

  files="$(git show --name-only --pretty=format: "$sha" 2>/dev/null | grep -v '^$' || true)"

  touched_changelog=0
  touched_src=0
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ "$f" == "CHANGELOG.md" ]]; then touched_changelog=1; fi
    if [[ "$f" == src/* ]]; then touched_src=1; fi
  done <<< "$files"

  if [[ $touched_changelog -eq 1 ]]; then
    icon="${C_GREEN}✓${C_RESET}"
    label="${C_GREEN}documented${C_RESET}"
    documented_count=$((documented_count + 1))
  elif [[ $touched_src -eq 1 ]]; then
    icon="${C_RED}✗${C_RESET}"
    label="${C_RED}missing changelog${C_RESET}"
    missing_count=$((missing_count + 1))
  else
    icon="${C_GRAY}·${C_RESET}"
    label="${C_GRAY}internal${C_RESET}"
    internal_count=$((internal_count + 1))
  fi

  printf " %b ${C_DIM}%s${C_RESET}  %s  ${C_DIM}[%b]${C_RESET}\n" \
    "$icon" "${sha:0:7}" "$subject" "$label"
done < <(
  if [[ -n "$RANGE" ]]; then
    git log --pretty=format:"%H	%s" "$RANGE"
  else
    git log --pretty=format:"%H	%s"
  fi
)

echo ""
printf "${C_BOLD}Summary:${C_RESET} "
printf "${C_GREEN}%d documented${C_RESET}, " "$documented_count"
if [[ $missing_count -gt 0 ]]; then
  printf "${C_RED}${C_BOLD}%d missing changelog${C_RESET}, " "$missing_count"
else
  printf "${C_GREEN}0 missing${C_RESET}, "
fi
printf "${C_GRAY}%d internal${C_RESET}\n" "$internal_count"

# ── Files touched ──

echo ""
hdr "Files touched $RANGE_LABEL"
if [[ -n "$RANGE" ]]; then
  git diff --stat "$RANGE" | sed -E \
    -e "s/(\| +[0-9]+ \+*)/$(printf "${C_GREEN}")\1$(printf "${C_RESET}")/g" \
    -e "s/(-+)$/$(printf "${C_RED}")\1$(printf "${C_RESET}")/g"
else
  echo "(no previous tag — full history would be too noisy)"
fi

# ── Current [Unreleased] section ──

echo ""
hdr "Current [Unreleased] in CHANGELOG.md"
if [[ -f "$CHANGELOG" ]]; then
  awk -v g="$C_GREEN" -v r="$C_RED" -v y="$C_YELLOW" -v b="$C_BLUE" -v m="$C_MAGENTA" -v bold="$C_BOLD" -v reset="$C_RESET" -v dim="$C_DIM" '
    /^## \[Unreleased\]/ { capture = 1; printf "%s%s%s\n", bold, $0, reset; next }
    capture && /^## \[/  { capture = 0 }
    !capture { next }
    /^### Added/    { printf "%s%s%s\n", g, $0, reset; next }
    /^### Changed/  { printf "%s%s%s\n", y, $0, reset; next }
    /^### Fixed/    { printf "%s%s%s\n", b, $0, reset; next }
    /^### Removed/  { printf "%s%s%s\n", r, $0, reset; next }
    /^### Security/ { printf "%s%s%s\n", m, $0, reset; next }
    /^- / { printf "  %s+%s %s\n", g, reset, substr($0, 3); next }
    { print }
  ' "$CHANGELOG"
else
  printf "${C_RED}CHANGELOG.md not found${C_RESET}\n"
fi

echo ""
if [[ $missing_count -gt 0 ]]; then
  printf "${C_RED}${C_BOLD}⚠ %d commit(s) touched src/ without a CHANGELOG.md update.${C_RESET}\n" "$missing_count"
  printf "${C_DIM}  Review them above and either backfill an entry or confirm they were internal-only.${C_RESET}\n"
else
  printf "${C_GREEN}✓ Every src/ commit since the last tag has a corresponding CHANGELOG.md change.${C_RESET}\n"
fi
echo ""
printf "${C_DIM}Run scripts/release.sh when you're ready to cut the next version.${C_RESET}\n"
