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

- **Shared scheduler helpers.** `computeNextRunAt()` and the "find due policies, run, mark, capture errors" loop now live in `src/lib/scheduler-utils.ts`. Backup and config-snapshot engines use the shared helper; engine-specific complexity stays per-engine.
- **`NodeConfigSnapshot` type** gained optional `policyId` and `trigger` fields so scheduled snapshots can be attributed and per-policy retention can prune only the right ones. Legacy snapshots without these fields default to `trigger: "manual"`.

### Fixed

- 500 on `/sites/[siteSlug]/node-configs` caused by exporting non-async values from a `"use server"` file. Restore action state moved to a companion `node-config-action-states.ts` file.
