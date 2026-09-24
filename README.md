<div align="center">

<img src="public/tainerlong.png" alt="Tainer" width="560">

[![Docker Hub](https://img.shields.io/docker/v/tainersh/tainer?sort=semver&label=docker%20hub&logo=docker&logoColor=white)](https://hub.docker.com/r/tainersh/tainer)
[![Docker pulls](https://img.shields.io/docker/pulls/tainersh/tainer?logo=docker&logoColor=white)](https://hub.docker.com/r/tainersh/tainer)
[![Image size](https://img.shields.io/docker/image-size/tainersh/tainer?sort=semver&logo=docker&logoColor=white)](https://hub.docker.com/r/tainersh/tainer)

[![Website](https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/compact/documentation/website_vector.svg)](https://tainer.sh)
[![Documentation](https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/compact/documentation/ghpages_vector.svg)](docs/configuration.md)

[![CI](https://github.com/wiflow/Tainer/actions/workflows/ci.yml/badge.svg)](https://github.com/wiflow/Tainer/actions/workflows/ci.yml)
[![CodeQL](https://github.com/wiflow/Tainer/actions/workflows/codeql.yml/badge.svg)](https://github.com/wiflow/Tainer/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/wiflow/Tainer/badge)](https://scorecard.dev/viewer/?uri=github.com/wiflow/Tainer)
[![CodeFactor](https://www.codefactor.io/repository/github/wiflow/tainer/badge)](https://www.codefactor.io/repository/github/wiflow/tainer)
![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/wiflow/Tainer?utm_source=oss&utm_medium=github&utm_campaign=wiflow%2FTainer&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

[![License](https://img.shields.io/github/license/wiflow/Tainer)](LICENSE)
[![Proxmox VE](https://img.shields.io/badge/Proxmox%20VE-8%20%7C%209-E57000?logo=proxmox&logoColor=white)](https://www.proxmox.com/en/proxmox-virtual-environment)
[![Lines of Code](https://sloc.xyz/github/wiflow/Tainer?category=code)](https://github.com/wiflow/Tainer)
[![Last commit](https://img.shields.io/github/last-commit/wiflow/Tainer)](https://github.com/wiflow/Tainer/commits/main)

</div>

## Tainer

Tainer is a self-service dashboard for Proxmox VE. Teams deploy and run LXC containers and VMs from a curated catalog, while admins keep control over who can touch which cluster. One Tainer instance manages any number of Proxmox clusters (sites).

**Workloads:**
- Deployments: create, start, stop, migrate and delete containers and VMs, edit resources and environment variables, and open a console in the browser
- Templates: a catalog of container and VM templates with a launch form
- Images: pull Docker Hub, OCI registry and Gitea images as container templates, and keep an ISO library
- Backups: backup policies, restore, snapshots and offsite copies to a Hetzner Storage Box
- Tags: group guests and start or stop them in bulk

**Operations:**
- Dashboard: live cluster metrics that update as soon as a guest or node changes state
- Load balancer: node scoring, automatic or dry-run migrations, maintenance drain and whole-cluster rebalance plans
- Alerts and heartbeat: alert policies and cluster health checks that notify Slack, Microsoft Teams, Discord or any webhook
- Node configs: scheduled snapshots of node configuration with restore
- Updates and CVE scanner: pending package updates and known vulnerabilities per node and guest

**Network:**
- Topology: LLDP and SNMP discovery of the switches your nodes are plugged into
- IP pools: static address allocation for new deployments, with phpIPAM integration
- Firewall: per-guest Proxmox firewall rules

**Access and security:**
- Users, groups and per-site permissions
- Two-factor authentication, SSO through OIDC, and LDAP or Active Directory sign-in
- Scoped API tokens for scripts and CI
- Audit log of every sign-in and admin action
- Encrypted backups of Tainer's own state

**Tainy:**
- A built-in assistant that answers questions about your clusters and carries out actions after you approve them
- Works with DeepInfra or any OpenAI-compatible endpoint you host yourself

## Usage

Tainer ships as a Docker image for `linux/amd64` and `linux/arm64`.

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
      AUTH_SECRET: ${AUTH_SECRET}      # required, generate with: openssl rand -base64 32
      APP_URL: https://tainer.example.com

volumes:
  tainer-data:
```

Run `docker compose up -d`, open Tainer in the browser and create the first admin account. Then add your Proxmox cluster under **Platform > Sites**.

More documentation:
- [Configuration](docs/configuration.md): environment variables, SMTP, reverse proxies and data persistence
- [Upgrading to 2.0.0](docs/upgrading.md): what to check before and after the upgrade
- [Proxmox permissions](docs/proxmox-permissions.md): the Proxmox user and privileges Tainer needs
- [Load balancer](docs/load-balancer.md): how node scoring and migrations work
- [Changelog](CHANGELOG.md)

## Contributing

You can contribute by reporting bugs, suggesting features or sending code through GitHub issues and pull requests.

To run Tainer locally you need Node.js 24:

```bash
npm ci
npm run dev
```

Every user-visible change gets a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md). Releases are cut with `scripts/release.sh`.

Security issues should not go in public issues. See [SECURITY.md](SECURITY.md) for how to report them.

## License

Tainer is licensed under the [GNU Affero General Public License v3.0](LICENSE).

---

[All contributors of this repository:](https://github.com/wiflow/Tainer/graphs/contributors)

<a href="https://github.com/wiflow/Tainer/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=wiflow/Tainer" alt="All contributors of this repository"/>
</a>
