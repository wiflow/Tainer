# Tainer Research and Product Plan

Date: 2026-03-17

Assumption: "containers" means Proxmox LXC containers. If you actually mean Docker or Compose workloads running on a host inside Proxmox, the product design should shift toward an app-platform workflow instead of direct LXC lifecycle management.

## Executive Summary

This is absolutely possible to build.

The strongest version for corporate use is not "a prettier Proxmox UI". It is a self-service service catalog on top of Proxmox:

- admins define approved templates
- users fill out validated forms instead of raw Proxmox settings
- the app creates or clones LXC containers through the Proxmox API
- the app keeps its own record of template versions, variables, secrets, approvals, and audit history
- post-deploy variable changes are managed as controlled config updates, not ad hoc shell access

The main technical caveat is environment variables. Proxmox does expose an `env` field for LXC containers, but that is a runtime environment setting, not a full application configuration platform. So post-deploy env editing is feasible, but the product should treat it as:

- template variables with schema and validation
- apply-to-container config updates
- controlled restart or reboot when needed
- optional in-container config rendering for apps that do not read environment variables directly

For a corporate MVP, I would recommend:

- frontend: Next.js + TypeScript + Tailwind CSS
- component system: shadcn/ui for primitives and form-heavy admin UI
- dashboard/chart layer: Tremor for metrics cards and charts where it fits
- data layer: PostgreSQL + Prisma
- background jobs: a durable queue for Proxmox tasks and retries
- auth: SSO/OIDC for users, Proxmox API token for machine-to-machine access

## What Proxmox Supports Today

### 1. Template-based container creation

Proxmox provides system container templates and lets you create LXC containers from them. Templates can be stored on shared storage for clustered setups.

Why this matters:

- your dashboard can offer a catalog of approved base templates
- deployments can target different nodes while reusing shared template storage
- template choice can be locked down per team or business unit

### 2. LXC container create and update via API

Proxmox exposes REST endpoints for:

- creating containers at `/nodes/{node}/lxc`
- reading container config at `/nodes/{node}/lxc/{vmid}/config`
- updating container config at `/nodes/{node}/lxc/{vmid}/config`
- checking pending changes and applying them with reboot or restart-related actions

Why this matters:

- your whole platform can be built cleanly on top of the official API
- you do not need brittle browser automation
- env changes, resource changes, tagging, network config, and hooks can be modeled in your own backend

### 3. Environment variables exist, but with caveats

Proxmox documents an `env` property for LXC containers as the container runtime environment. That means:

- yes, you can model editable variables in your dashboard
- no, this is not the same thing as Docker Compose style app lifecycle management
- changes may need reboot or service restart to take effect
- the application inside the LXC must actually read its configuration from env vars

Recommendation:

- do not expose raw `KEY=VALUE` editing as the primary UX
- define typed variables in each template schema
- track desired config in your app database
- render the Proxmox `env` field from that schema
- require a controlled apply action, with restart notice where needed

### 4. Hook scripts are available

Proxmox supports `hookscript` for LXC lifecycle events. This is useful for:

- rendering config files from variables
- running first-boot setup
- registering deployments in CMDB or DNS
- syncing secrets or writing env files into the guest

This is important because some corporate apps will not behave well if you rely only on the raw Proxmox `env` field.

### 5. API tokens and ACLs are first-class

Proxmox supports API tokens with separated privileges and scoped ACLs. It also supports resource pools.

Why this matters:

- the dashboard can use a narrowly scoped service account
- resources can be segmented by team, department, environment, or cost center
- corporate audit and least-privilege design are realistic

### 6. OCI images in Proxmox are not the safest primary path yet

Proxmox can use OCI images for containers, but the docs still call application-container use a technology preview.

Recommendation:

- for a corporate product, prefer stable LXC system templates first
- add OCI-based application templates only later, behind a feature flag, if you have a real use case

### 7. VM templates are stronger for rich boot-time templating

Proxmox VM templates support Cloud-Init and custom user/network/meta snippets.

Why this matters:

- if some workloads need richer first-boot config than LXC env vars can provide
- or if teams need cloud-init style userdata and network customization
- then some "templates" should be VM-backed, not LXC-backed

I would design the product so template type can later be:

- `lxc`
- `vm-cloud-init`

That keeps the architecture future-proof.

## What Is Realistically Possible

### Strongly feasible in an MVP

- browse a catalog of approved templates
- create a template from admin-defined defaults
- define typed template variables
- deploy a new LXC from a template
- store deployment metadata, owner, department, and revision history
- edit approved variables after deployment
- push updated variables to Proxmox config
- restart or reboot the container when needed
- show deployment status and task history
- restrict visibility and actions by role or group

### Feasible, but should be phase 2 or 3

- approval workflows
- multi-cluster support
- cost estimation and quota controls
- secret manager integration
- drift detection between desired config and live Proxmox config
- policy packs by business unit
- DNS, reverse proxy, and certificate automation
- backup, restore, and snapshot workflows from the same UI

### Possible, but a bad MVP focus

- reproducing every Proxmox option in your own UI
- raw free-form editing of all LXC settings
- supporting both LXC and OCI app containers equally on day one
- using env vars as the only config model for every workload

## Recommended Product Shape

### Core domain objects

#### Template

- id, slug, name, version
- type: `lxc` or future `vm-cloud-init`
- base image or source template reference
- node or cluster placement rules
- default CPU, memory, disk, network, tags
- variable schema
- secret schema
- post-deploy actions
- restart policy when config changes
- visibility and allowed user groups

#### Variable schema

Each template variable should have:

- key
- label
- type: string, number, boolean, select, secret, textarea
- required flag
- default value
- validation rules
- help text
- whether change requires restart
- whether users can edit after deployment

#### Deployment

- deployment id
- template version used
- target node and pool
- Proxmox VMID
- owner/team
- requested values
- rendered values sent to Proxmox
- status
- task log
- change history

#### Revision

- who changed what
- old value vs new value
- whether restart was triggered
- whether Proxmox accepted the update
- rollback reference

## Recommended Architecture

### Frontend

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Tremor for charts and dashboard widgets where useful

Why this stack:

- Tailwind gives you fast visual iteration
- shadcn/ui is excellent for internal tools with forms, tables, dialogs, drawers, and command menus
- Tremor can accelerate the analytics side of the dashboard

### Backend

- Next.js server actions or route handlers for simple workflows
- a dedicated job runner for async Proxmox task orchestration
- PostgreSQL for templates, deployments, audit logs, and team metadata
- Prisma for schema and migrations

### Integration layer

Recommended options:

1. Direct Proxmox REST integration from your backend
2. Optional helper library:
   - `proxmoxer` if you prefer a Python integration service
   - direct REST in TypeScript if you want a single-stack web app
3. Optional Terraform execution layer later if you want IaC-backed reconciliation

My recommendation for MVP:

- use direct REST from a TypeScript backend
- keep a Python sidecar only if Proxmox-specific logic becomes too awkward in Node

### Secrets

For corporate use, do not store sensitive env vars as plain text if you can avoid it.

Better options:

- encrypt at rest in your own database
- integrate with Vault, 1Password, Doppler, or another secrets backend later
- mask secrets in UI and audit logs
- separate "can edit" from "can reveal"

### Operational flow

#### Create from template

1. User opens template detail page.
2. UI renders a form from the template schema.
3. Backend validates values.
4. Backend chooses target node and resource pool.
5. Backend calls Proxmox create endpoint.
6. Backend tracks the async task and stores the resulting VMID.
7. Backend optionally applies hookscript or post-create actions.
8. UI shows progress and resulting deployment record.

#### Change variables after deploy

1. User opens deployment detail page.
2. UI shows editable variables defined by the template.
3. Backend validates only allowed fields.
4. Backend updates desired state in the app database.
5. Backend updates Proxmox container config.
6. Backend either:
   - queues a reboot if the template marks the change as restart-required
   - or triggers a lighter in-container apply action if supported
7. Audit trail records the change.

## Best Way To Handle Environment Variables

There are three realistic patterns.

### Pattern A: Proxmox `env` as the source of truth

Best for:

- simple internal apps
- scripts or services that read environment at process start
- fast MVP delivery

Pros:

- simplest implementation
- maps directly to Proxmox config
- easy to diff and audit

Cons:

- not all apps consume env cleanly
- often needs restart or reboot
- not enough for complex config files or nested app settings

### Pattern B: Managed env file inside the guest

Best for:

- app stacks expecting `.env` files
- services managed by systemd or Docker inside the LXC
- teams that want safer app-level reload behavior

How it works:

- your app stores desired variables
- a hookscript or in-guest agent renders `/opt/app/.env`
- the platform restarts only the relevant service

Pros:

- more app-friendly
- easier service-specific reloads
- cleaner path for future secret injection

Cons:

- more moving parts
- requires an opinionated guest layout

### Pattern C: VM templates with Cloud-Init for richer config

Best for:

- workloads that need extensive bootstrap logic
- more complex networking or userdata
- teams that really need appliance-like provisioning

Pros:

- more flexible provisioning model
- better fit for richer bootstrap payloads

Cons:

- heavier than LXC
- slower provisioning

Recommendation:

- use Pattern A for MVP
- design the system so selected templates can later move to Pattern B
- keep Pattern C available for special workloads

## Similar Projects and What To Borrow

### 1. Portainer

Useful for:

- template catalog patterns
- environment-variable form UX
- stack deployment workflow ideas

What to borrow:

- clear app card presentation
- form-driven deployment
- variable grouping and defaults

What not to copy blindly:

- Portainer is built around Docker and container stacks, not Proxmox LXC lifecycle

### 2. Coolify

Useful for:

- polished self-service deployment UX
- env variable and secret management patterns
- team-oriented app ownership and deployment views

What to borrow:

- strong edit-after-deploy config workflow
- clean project/service/environment mental model

What not to copy blindly:

- Coolify assumes app-platform semantics that do not map perfectly to Proxmox LXC

### 3. Backstage Software Templates

Useful for:

- service catalog thinking
- corporate approval and ownership models
- developer portal structure

What to borrow:

- template-driven self-service with governance
- group ownership, metadata, tags, and auditability

What not to copy blindly:

- Backstage is broader than what you need, and may be too heavy if this product is mostly infra self-service

### 4. Proxmox VE Helper Scripts / community-scripts

Useful for:

- curated template catalog inspiration
- operational patterns around Proxmox automation

What to borrow:

- metadata structure for "known good" deployables
- guardrails around what users are allowed to deploy

### 5. Proxmox Datacenter Manager

Useful for:

- multi-cluster management direction
- remote inventory and operations concepts

What to borrow:

- future multi-datacenter control plane thinking

What not to expect:

- it does not replace a custom self-service catalog product for your use case

## My Recommendation On Existing Projects

If your goal is "self-service LXC provisioning on Proxmox with corporate guardrails", I would not try to force an existing product to do all of this.

The best path is:

- build your own product
- borrow UX ideas from Portainer and Coolify
- borrow governance ideas from Backstage
- use the official Proxmox API directly

If your real goal is closer to "deploy app containers with env vars, ports, and version rollouts", then you may actually want:

- Coolify
- Portainer
- or a Docker/Compose/Kubernetes layer on top of Proxmox

That is a key decision:

- if you want system containers as deployable units, build on Proxmox LXC
- if you want app containers as deployable units, use an app platform and let Proxmox just host the nodes

## Suggested MVP Scope

### MVP

- SSO login
- team and role model
- template catalog
- create deployment form from schema
- deploy LXC through Proxmox API
- deployment detail page
- editable post-deploy variables
- restart-aware apply flow
- audit log
- admin template editor

### Version 2

- approvals
- quotas
- snapshots and rollback
- backup visibility
- secrets integration
- notifications
- node placement policies

### Version 3

- multi-cluster support
- VM Cloud-Init templates
- drift detection
- Terraform or reconciliation engine
- service ownership reports and cost insights

## UI and Design Direction

Since you asked for a really nicely designed dashboard, I would avoid a generic "blue cards on gray background" admin panel.

Recommended direction:

- dark slate, warm stone, and muted teal as the base palette
- dense but elegant data tables
- large, clean deployment cards
- command palette for fast actions
- template pages with strong visual identity per template type
- activity timeline on each deployment
- side panels for edits instead of too many full-page forms

Recommended UI building blocks:

- shadcn/ui for layout primitives, forms, dialogs, tables, sheets, and command menu
- Tailwind for theming, spacing, and responsive behavior
- Tremor only for dashboards and analytics cards, not for the whole app shell
- optional Tailwind Plus blocks if you want faster premium-quality marketing/admin sections and the license cost is acceptable

## Concrete Technical Recommendation

If we start this project now, I would build:

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- PostgreSQL
- Prisma
- direct Proxmox REST integration
- job queue for async tasks

And I would model env changes like this:

- template owns schema
- deployment stores desired values
- backend renders those values into Proxmox `env`
- backend knows whether a restart is needed
- UI shows change diff and impact before apply

## Source Notes

Primary sources used for this plan:

- [Proxmox Container Toolkit docs](https://pve.proxmox.com/pve-docs/chapter-pct.html)
- [Proxmox Virtual Machines docs](https://pve.proxmox.com/pve-docs/chapter-qm.html)
- [Proxmox User Management docs](https://pve.proxmox.com/pve-docs/chapter-pveum.html)
- [Proxmox API viewer](https://pve.proxmox.com/pve-docs/api-viewer/index.html)
- [shadcn/ui docs](https://ui.shadcn.com/)
- [Tremor docs](https://tremor.so/docs)
- [Portainer docs](https://docs.portainer.io/)
- [Coolify docs](https://coolify.io/docs/)
- [Backstage software templates docs](https://backstage.io/docs/features/software-templates/)
- [Proxmox Datacenter Manager docs](https://pdm.proxmox.com/)
- [community-scripts / Proxmox VE Helper Scripts](https://community-scripts.github.io/ProxmoxVE/)

## Bottom Line

Yes, you can build this.

The best corporate version is:

- a curated service catalog on top of Proxmox
- validated templates instead of raw infra forms
- controlled env editing after deploy
- strong audit and permission boundaries

If you want, the next step should be turning this into:

- an information architecture
- a screen map
- and a phase-1 implementation scaffold
