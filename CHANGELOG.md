# Changelog

All notable changes to Tainer are tracked here. Used as the source for release notes.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/) once we cut tagged releases.

Sections per release:

- **Added** — new features
- **Changed** — changes to existing behaviour
- **Fixed** — bug fixes
- **Removed** — features that have been taken out
- **Security** — vulnerability fixes (call these out, even small)

## [Unreleased]

### Added

- **Release tooling.** `scripts/release.sh` cuts a tagged release: refuses on a dirty tree, shows commits since the last tag, lets you confirm `[Unreleased]` coverage, atomically renames `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD`, opens a fresh `[Unreleased]`, commits, and tags `vX.Y.Z`. `scripts/changelog-status.sh` is a read-only audit helper that lists what has accumulated since the last tag.
- **Coverage check in `scripts/changelog-status.sh`.** Each commit since the last tag is now marked ✓ green (touched `CHANGELOG.md`), ✗ red (touched `src/` but missed `CHANGELOG.md`), or · gray (internal-only), with a summary line and a colourised view of the current `[Unreleased]` block. Honours `NO_COLOR` and disables colour automatically when stdout is not a TTY.
- **Node config restore.** Snapshots can now be applied back to Proxmox via a new restore page with side-by-side diff against live config, per-section selection (network, DNS, hosts, timezone, storage, firewall), opt-in destructive mode for cluster-wide sections, and a typed `RESTORE` confirmation gate.
- **Node config snapshot view page.** Read-only browser for snapshot contents, reachable via the eye icon on each snapshot row.
- **Scheduled node config snapshots.** Per-site interval-based schedules (1h / 6h / 12h / 24h / 48h / weekly) with per-policy retention, pause / resume, run-now, and delete. Manual snapshots are unaffected by per-policy retention.

### Changed

- **Faster page loads across the app.** Bumped Proxmox GET cache TTL from 1.5s → 10s and JSON file cache TTL from 1s → 5s — the previous values were too short for cascading reads inside a single page render to share data, so even pages that "should" be cached were re-fetching from Proxmox / disk on every related call. Both caches still invalidate on writes, so freshness is unaffected.
- **`unstable_cache` actually works now.** Removed `export const dynamic = "force-dynamic"` from seven pages that also use `unstable_cache` (dashboard, settings, images, tags, tag detail, ISO images, templates). The `force-dynamic` directive was silently disabling the cache, turning every request into a full Proxmox refetch. The cache's `revalidate` (5–30s depending on page) is now in effect, eliminating duplicate Proxmox calls within the cache window.
- **Background scheduler is faster.** The four scheduler checks (alerts, backups, config snapshots, heartbeat) now run in parallel via `Promise.all` instead of sequentially, and the per-site config-snapshot iteration uses bounded concurrency (3 sites at a time) instead of one-at-a-time. Expected savings: 100–300ms per 30-second tick.
- **`getTemplateIndex()` parallelism.** The `listAvailableTemplates` Proxmox call previously waited for the entire first batch of three calls before starting. It now chains off just `listTemplateTargets` via `.then()` and runs in parallel with the other two, so the slowest single call dominates instead of the chain.
- **`TaskToastProvider` no longer churns the context every poll.** The `activeTaskUpids` Set is now reference-stable: it returns the same Set when content is unchanged, so consumers (deployment cards, snapshot cards, etc.) only re-render when a task actually starts or finishes — not every 2-second progress update.
- **Shared scheduler helpers.** `computeNextRunAt()` and the "find due policies, run, mark, capture errors" loop now live in `src/lib/scheduler-utils.ts`. Backup and config-snapshot engines use the shared helper; engine-specific complexity stays per-engine.
- **`NodeConfigSnapshot` type** gained optional `policyId` and `trigger` fields so scheduled snapshots can be attributed and per-policy retention can prune only the right ones. Legacy snapshots without these fields default to `trigger: "manual"`.

### Fixed

- 500 on `/sites/[siteSlug]/node-configs` caused by exporting non-async values from a `"use server"` file. Restore action state moved to a companion `node-config-action-states.ts` file.

### Removed

- Dead code: `src/components/live-refresh.tsx` and `src/components/auto-refresh.tsx` — neither was imported anywhere. The audit had flagged a 15-second `router.refresh()` interval as a perf issue; it doesn't exist on any active page.
- **False "Will change" diffs in node config restore preview.** Proxmox returned the same DNS object with keys in different orders on different reads, and the diff did string equality on `JSON.stringify`, so identical-but-reordered objects were flagged as changed. JSON formatting now recursively sorts object keys, sorts arrays of objects by their stable identity field (`iface`, `storage`, `pos`), and canonicalises Proxmox set-valued comma-string fields (`content`, `nodes`, `tags`) by splitting + alphabetising. Semantically-equal sections show "No change" regardless of the order Proxmox returned them in.
