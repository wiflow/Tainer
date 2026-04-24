Self-service Proxmox LXC container management dashboard. Curated template catalog, deployment lifecycle, multi-site cluster support, env variable editing, user accounts, 2FA, and audit logs.

**Architectures:** `linux/amd64` · `linux/arm64`

---

## Quick start

```bash
docker run -d \
  --name tainer \
  --restart unless-stopped \
  -p 3000:3000 \
  -v tainer-data:/app/data \
  tainersh/tainer:latest
```

Open http://localhost:3000 — the first-run wizard creates your admin account.

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

volumes:
  tainer-data:
```

## Environment variables

| Variable | Description |
|---|---|
| `APP_URL` | Public base URL — required for password reset links |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP for password reset emails |
| `TAINER_DATA_DIR` | Override data directory (default `/app/data`) |

## Updating

```bash
docker compose pull && docker compose up -d
```

Data is preserved in the volume — no migration needed.
