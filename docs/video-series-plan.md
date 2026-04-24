# Tainer Tutorial Video Series — Plan

A short, focused tutorial series for the Tainer self-service Proxmox dashboard.
Each video is 2–5 minutes so viewers can pick just what they need.

---

## #1 — Getting Started / Installation
**Length:** ~5 min
**Audience:** Admin setting up Tainer for the first time

1. What Tainer is (one-sentence pitch + screenshot of dashboard)
2. Prerequisites — Proxmox VE cluster, API token, Node.js
3. Create a Proxmox API token (`user@realm!tokenname`) — show the PVE UI
4. Clone repo → `.env` walkthrough:
   - `PROXMOX_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET`
   - `PROXMOX_DEFAULT_NODE`, `PROXMOX_DEFAULT_ROOTFS_STORAGE`
   - `PROXMOX_CONSOLE_USER` / `PASSWORD` (why tokens can't do console)
5. `npm install` → `npm run build` → `npm run start`
6. First-run `/setup` page → create admin user
7. Land on the dashboard

---

## #2 — Dashboard Tour
**Length:** ~2 min

1. Cluster overview cards (nodes, resource gauges)
2. Live charts (CPU/RAM/storage) — mention 15s auto-refresh
3. Nav rundown: Deployments / Templates / Images / Users / Settings / Account

---

## #3 — Your First Deployment
**Length:** ~4 min

1. Browse `/templates` catalog
2. Open a template detail page
3. Launch form — hostname, resources, storage, env vars
4. Submit → watch the task toast progress
5. Land on `/deployments/[id]` → start/stop/restart quick actions
6. Open the console

---

## #4 — Managing Deployments
**Length:** ~3 min

1. Deployments list (filtering, status badges)
2. Lifecycle actions (start / stop / restart)
3. Editing environment variables post-deploy
4. Viewing task history / logs

---

## #5 — Templates & Images
**Length:** ~4 min

1. Built-in template catalog vs. user-defined templates
2. Creating a custom deployment template
3. `/images` — browsing available container images
4. Importing from Docker Hub (namespace, platform, auth)
5. Using a local Docker library via `DOCKER_LIBRARY_PATH`

---

## #5a — Docker Hub & Registry Integration
**Length:** ~4 min

1. Why this matters — pull any container image into your template catalog
2. Env setup: `DOCKER_HUB_USERNAME`, `DOCKER_HUB_TOKEN`,
   `DOCKER_HUB_DEFAULT_NAMESPACE`, `DOCKER_HUB_DEFAULT_PLATFORM`
3. Browsing `/images` — search Docker Hub, tags, platforms, sizes
4. Image detail page — tag list, env-var cache preview
5. Pulling an image → syncing into a site
6. Gitea registry pull — private/internal images
7. Custom registry pull — arbitrary OCI registries
8. Local Docker library via `DOCKER_LIBRARY_PATH` (offline/air-gapped)
9. Launching a deployment from a pulled image

---

## #6 — User Management & Security
**Length:** ~3 min

1. `/users` — invite users, admin vs. regular roles
2. Account page — password change, enabling TOTP 2FA
3. Recovery codes (storage, regeneration)
4. Password reset flow (SMTP setup recap)
5. Session behavior — 14-day expiry, all-sessions-revoked-on-password-change

---

## #7 — Settings & Data
**Length:** ~2 min

1. `/settings` — default rootfs storage
2. Where Tainer stores data (`$HOME/.tainer/` vs. `TAINER_DATA_DIR`)
3. What's in each JSON file (auth-store, templates, settings)
4. Backup tip: just copy the data directory

---

## #8 — Deploying Tainer Itself (Production)
**Length:** ~3 min

1. `scripts/deploy-vm.sh` walkthrough
2. systemd service setup
3. `APP_URL` + reverse proxy (for reset email links)
4. Self-signed certs → `PROXMOX_TLS_INSECURE=true`

---

## #9 — Backup Policies
**Length:** ~4 min

1. The `/sites/[siteSlug]/backups` page tour
2. Creating a policy:
   - Scope: all deployments vs. tagged only
   - Mode: snapshot / suspend / stop
   - Compression: none / lzo / gzip / zstd
   - Interval: 6h / 12h / 24h / 48h / custom
   - Retention count
   - Storage target
3. Enabling/disabling a policy, next-run time
4. Per-deployment on-demand backup, restore
5. Backup run history & job table
6. Restoring from a backup

---

## #10 — The Overview Map (Multi-Site)
**Length:** ~3 min

1. What the map is — geographic view of every Proxmox site
2. Adding a site — URL, token, location pin
3. Reading the map:
   - Status dots: green / amber / red
   - Mini-gauges: CPU / RAM / storage
   - Node / container counts
4. Clicking a site → `/sites/[siteSlug]`
5. Search & filter sites from the map sidebar
6. When to use map view vs. the flat dashboard

---

## Optional future videos

| # | Topic |
|---|-------|
| #11 | Tags & Groups — bulk ops, tag-scoped policies |
| #12 | Alert Policies & Notifications |
| #13 | CVE Scanner |
| #14 | Load Balancer & Auto-Migration |
| #15 | VM Templates & Wizard |
| #16 | Heartbeat & Diagnostics |
| #17 | ISO Library & Node Configs |
| #18 | Command Palette & Mobile API |

---

## Production notes

- **Intro:** 3-sec logo + one-line "what this video covers"
- **Outro:** "Next up: [video #N]" card
- **On-screen text:** highlight every env var / command to copy
- **Captions:** burn in for accessibility
- **Consistent demo data:** same Proxmox cluster & templates across the series
- **Zoom in** on forms and buttons — Tainer's UI is dense

## Running order

1 → 2 → 3 → 4 → 5 → 5a → 6 → 7 → 8 → 9 → 10 → optional 11–18
