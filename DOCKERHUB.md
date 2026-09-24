Self-service Proxmox LXC container management dashboard. Curated template catalog, deployment lifecycle, multi-site cluster support, env variable editing, user accounts, 2FA, and audit logs.

**Architectures:** `linux/amd64` · `linux/arm64`

---

## Quick start

`AUTH_SECRET` is required: the container exits at boot without it. Generate it once and reuse the same value on every upgrade.

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

Open http://localhost:3000 and the first-run wizard creates your admin account. On a LAN address over plain http, also pass `-e APP_URL=http://<address>:3000` so the session cookie works.

## Docker Compose

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
      APP_URL: http://localhost:3000
      AUTH_SECRET: ${AUTH_SECRET:?set AUTH_SECRET}

volumes:
  tainer-data:
```

```bash
echo "AUTH_SECRET=$(openssl rand -base64 32)" > .env   # once; keep this file
docker compose up -d
```

## Environment variables

| Variable | Description |
|---|---|
| `AUTH_SECRET` | **Required.** Key for sessions and encrypted settings. Generate with `openssl rand -base64 32` and keep it stable |
| `APP_URL` | Public base URL. Used for password reset links, the SSO redirect URI and agent snippets |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP for password reset emails. Without SMTP the reset link goes to the container log, never to disk |
| `TAINER_DATA_DIR` | Override data directory (default `/app/data`) |
| `TAINER_TRUST_PROXY_HEADERS` | `true` to trust `X-Forwarded-*` headers. Only behind a proxy that sets them |
| `TAINER_WEBHOOK_URL_ALLOWLIST` | Comma separated hosts that alert webhooks may reach on private addresses |
| `TAINER_DOWNLOAD_URL_ALLOWLIST` | Comma separated hosts allowed for template, ISO and image downloads on private addresses |
| `TAINER_AGENT_BASE_URL` | Base URL LLDP/SNMP agents post to when nodes cannot reach `APP_URL` |
| `TAINER_LDAP_ALLOW_INSECURE` | `true` allows plain `ldap://` |
| `TAINER_LDAP_INSECURE_TLS` | `true` skips LDAP certificate validation |
| `TAINER_COPILOT_ALLOW_INSECURE_ENDPOINT` | `true` allows a plain `http://` custom Tainy endpoint |
| `TAINER_DISABLE_UPDATE_CHECK` | `true` skips the hourly Docker Hub check for new tags |

The full list is in the project README.

## Behind a reverse proxy

Set `APP_URL` to the public URL, since it is used for the SSO `redirect_uri` and outgoing links. Set `TAINER_TRUST_PROXY_HEADERS=true` only when a trusted proxy sets `X-Forwarded-For`. Otherwise rate limiting sees every user as the proxy's address.

## Updating

```bash
docker compose pull && docker compose up -d
```

Data is preserved in the volume.

## Upgrading to 2.0.0

- Set `AUTH_SECRET`. If you ran without it before, the first start with it re-encrypts the secrets stored under the old generated key (`auth-secret.txt`) and removes that file. Users are signed out once. The old key and the original files are copied to `pre-2.0-key-migration-<timestamp>/` in the data volume; delete that folder once sign-in and your sites work.
- Behind a proxy, set `APP_URL` or `TAINER_TRUST_PROXY_HEADERS=true`.
- Providers that do not send `email_verified` (Entra ID, for example) need **Trust email without email_verified claim** ticked for email matching and auto-provisioning.
- Changing a site's URL, username, TLS mode or CA needs the Proxmox password entered again.
- AIA intermediates are only used when they chain to a trusted root. Otherwise paste the CA into the site's custom CA field.
- Strict SSH host key sites need `/home/tainer/.ssh/known_hosts` in the container.
- Guest firewall rules only apply on NICs with `firewall=1`, which you set in Proxmox.
- Webhooks do not follow redirects.
