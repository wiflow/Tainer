# Tainer

Self-service Proxmox LXC container management dashboard. Provides a curated template catalog, deployment lifecycle management, multi-site cluster support, and environment variable editing on top of the Proxmox VE API.

Built for teams — includes user accounts, 2FA, role-based permissions, and audit logs.

**Image:** [`tainersh/tainer`](https://hub.docker.com/r/tainersh/tainer) — `linux/amd64` + `linux/arm64`

---

## Quick start

### Docker run

```bash
export AUTH_SECRET="$(openssl rand -base64 32)"   # save it and reuse it when upgrading
docker run -d \
  --name tainer \
  --restart unless-stopped \
  -p 3000:3000 \
  -v tainer-data:/app/data \
  -e AUTH_SECRET \
  tainersh/tainer:latest
```

Then open [http://localhost:3000](http://localhost:3000) — the first-run wizard will prompt you to create an admin account.

### Docker Compose

```yaml
services:
  tainer:
    image: tainersh/tainer:latest
    ports:
      - "3000:3000"
    volumes:
      - tainer-data:/app/data
    restart: unless-stopped
    environment:
      APP_URL: http://localhost:3000   # set to your public URL
      AUTH_SECRET: ${AUTH_SECRET:?set AUTH_SECRET}

volumes:
  tainer-data:
```

Save as `docker-compose.yml` and run:

```bash
echo "AUTH_SECRET=$(openssl rand -base64 32)" > .env   # once; keep this file
docker compose up -d
```

---

## Environment variables

All variables are optional unless noted.

### App

| Variable | Description | Example |
|---|---|---|
| `APP_URL` | Public base URL (required for password reset links) | `https://tainer.example.com` |
| `PORT` | HTTP port the server listens on | `3000` |
| `TAINER_DATA_DIR` | Override the data directory path | `/data/tainer` |
| `AUTH_SECRET` | **Required.** Key for sessions and encrypted settings. Keep it stable across restarts | `openssl rand -base64 32` |

### SMTP (password reset emails)

If SMTP is not configured, password reset links are written to `password-reset-debug.json` in the data directory instead.

| Variable | Description |
|---|---|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (e.g. `587`) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | From address (e.g. `tainer@example.com`) |

---

## Data persistence

All state (users, sessions, settings, templates) is stored in JSON files inside the data directory (`/app/data` in the container). Mount a volume or bind mount to preserve data across container restarts.

```yaml
volumes:
  - tainer-data:/app/data       # named volume (recommended)
  # or
  - /opt/tainer/data:/app/data  # bind mount
```

---

## Adding your Proxmox cluster

Tainer connects to Proxmox using username + password credentials entered through the UI — no environment variables needed. After creating your admin account:

1. Go to **Settings → Sites**
2. Click **Add Site**
3. Enter your Proxmox API URL (e.g. `https://192.168.1.10:8006`), username (`root@pam`), and password
4. Tainer validates the connection and saves the site

Multiple clusters (sites) are supported. Tainer detects duplicate clusters using node SSL fingerprints.

---

## Docker Compose with SMTP

```yaml
services:
  tainer:
    image: tainersh/tainer:latest
    ports:
      - "3000:3000"
    volumes:
      - tainer-data:/app/data
    restart: unless-stopped
    environment:
      APP_URL: https://tainer.example.com
      SMTP_HOST: smtp.example.com
      SMTP_PORT: "587"
      SMTP_USER: tainer@example.com
      SMTP_PASS: yourpassword
      SMTP_FROM: tainer@example.com

volumes:
  tainer-data:
```

---

## Updating

```bash
docker compose pull
docker compose up -d
```

Data is preserved in the volume — no migration steps required.
