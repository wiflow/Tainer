# Configuration

## Running Tainer

Tainer will not start without `AUTH_SECRET`. Generate one once with `openssl rand -base64 32`, store it somewhere safe and reuse the same value on every upgrade. Changing it signs everyone out and makes stored secrets unreadable.

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

Then open [http://localhost:3000](http://localhost:3000). The first-run wizard will prompt you to create an admin account.

If you open Tainer on a LAN address over plain http instead of localhost, also pass `-e APP_URL=http://<address>:3000` so the browser accepts the session cookie.

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

## Environment variables

All variables are optional unless noted.

### App

| Variable | Description | Example |
|---|---|---|
| `AUTH_SECRET` | **Required.** Key for sessions and encrypted settings. The server refuses to start without it. Keep it stable across restarts and upgrades | `openssl rand -base64 32` |
| `APP_URL` | Public base URL. Used for password reset links, the SSO `redirect_uri` and alert links. Required for password reset in production | `https://tainer.example.com` |
| `PORT` | HTTP port the server listens on | `3000` |
| `TAINER_DATA_DIR` | Override the data directory path | `/data/tainer` |
| `AUTH_COOKIE_SECURE` | Force the `Secure` flag on the session cookie on (`true`) or off (`false`). By default it is on, except when `APP_URL` uses http or points at a local or private address | `true` |
| `TAINER_DISABLE_UPDATE_CHECK` | `true` skips the hourly Docker Hub check for newer Tainer tags | `true` |

### Network and security

| Variable | Description | Example |
|---|---|---|
| `TAINER_TRUST_PROXY_HEADERS` | `true` makes Tainer read the client IP from `X-Forwarded-For` / `X-Real-IP` and the public origin from `X-Forwarded-Proto` / `X-Forwarded-Host`. Only set it behind a proxy that overwrites these headers | `true` |
| `TAINER_WEBHOOK_URL_ALLOWLIST` | Comma separated hosts that alert webhooks may reach even though they resolve to private addresses. `.example.com` or `*.example.com` also matches subdomains | `hooks.lan,.corp.example` |
| `TAINER_DOWNLOAD_URL_ALLOWLIST` | Same format, for template, ISO and image downloads from a URL or registry | `mirror.lan` |
| `TAINER_LDAP_ALLOW_INSECURE` | `true` allows plain `ldap://` server URLs. The bind password then crosses the network in cleartext | `true` |
| `TAINER_LDAP_INSECURE_TLS` | `true` turns off certificate validation for LDAP over TLS. Logs a warning on every connection | `true` |
| `TAINER_OIDC_ALLOW_INSECURE_ISSUER` | `true` allows `http://` issuer URLs for identity providers. For local testing only | `true` |
| `TAINER_COPILOT_ALLOW_INSECURE_ENDPOINT` | `true` allows a plain `http://` custom endpoint for the Tainy assistant. Prompts and the API key then travel unencrypted | `true` |

### Integrations

| Variable | Description |
|---|---|
| `METRICS_TOKEN` | Enables `/api/metrics`. Callers send `Authorization: Bearer <token>` |
| `ALERTS_CRON_SECRET` | Enables `GET /api/alerts/check` for an external scheduler. Callers send `Authorization: Bearer <secret>` |
| `ISO_LIBRARY_PATH` | Local directory of ISO files offered on the ISO page |
| `DOCKER_LIBRARY_PATH` | Local Docker image library, used when a site has no library path set |
| `DOCKER_HUB_USERNAME` / `DOCKER_HUB_TOKEN` | Docker Hub credentials for authenticated pulls |
| `DOCKER_HUB_DEFAULT_NAMESPACE` / `DOCKER_HUB_DEFAULT_PLATFORM` | Defaults for Docker Hub browsing, for example `library` and `linux/amd64` |
| `GITEA_URL` / `GITEA_OWNER` / `GITEA_USERNAME` / `GITEA_TOKEN` | Gitea container registry for template pulls. `GITEA_TLS_INSECURE=true` skips certificate checks |
| `PROXMOX_CLOUD_INIT_SNIPPET_STORAGE` | Storage used for cloud-init snippets |
| `PROXMOX_URL` / `PROXMOX_USERNAME` / `PROXMOX_PASSWORD` | Legacy single-cluster setup. Imported as a site on first start when no sites exist. Add sites in the UI instead |

### SMTP (password reset emails)

If SMTP is not configured, the reset link is written to the server log (`docker logs tainer`). It is never saved to disk. Send errors also show up only in the server log, since the forgot-password form always shows the same message.

| Variable | Description |
|---|---|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (e.g. `587`) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | From address (e.g. `tainer@example.com`) |

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
      AUTH_SECRET: ${AUTH_SECRET:?set AUTH_SECRET}
      SMTP_HOST: smtp.example.com
      SMTP_PORT: "587"
      SMTP_USER: tainer@example.com
      SMTP_PASS: yourpassword
      SMTP_FROM: tainer@example.com

volumes:
  tainer-data:
```

## Behind a reverse proxy

- Set `APP_URL` to the public URL. It is used for the SSO `redirect_uri` and for links Tainer sends out. Without it the redirect URI falls back to the request URL and the identity provider may reject it.
- Set `TAINER_TRUST_PROXY_HEADERS=true` only when a proxy you control sets `X-Forwarded-For`. Otherwise the header is ignored and login rate limiting uses the proxy's address, so all users behind it share one per-IP limit.

## Data persistence

All state (users, sessions, settings, templates) is stored in JSON files inside the data directory (`/app/data` in the container). Mount a volume or bind mount to preserve data across container restarts.

```yaml
volumes:
  - tainer-data:/app/data       # named volume (recommended)
  # or
  - /opt/tainer/data:/app/data  # bind mount
```

## Adding your Proxmox cluster

Tainer connects to Proxmox using username + password credentials entered through the UI, so no environment variables are needed. After creating your admin account:

1. Go to **Platform > Sites**
2. Click **Add site**
3. Enter your Proxmox API URL (e.g. `https://192.168.1.10:8006`), username (`root@pam`), and password
4. Tainer validates the connection and saves the site

Multiple clusters (sites) are supported. Tainer detects duplicate clusters using node SSL fingerprints.

## Updating

```bash
docker compose pull
docker compose up -d
```

Data is preserved in the volume. Coming from 1.x, read [Upgrading to 2.0.0](upgrading.md) first.
