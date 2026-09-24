# Proxmox Permissions Required for Tainer

Tainer logs in to each site with a Proxmox **username and password** (ticket authentication, `PVEAuthCookie`). API tokens are not used. The site's user needs the privileges listed below for full functionality.

---

## Quick Setup

Create a custom role with all required privileges, then assign it to the Tainer user at path `/` with `propagate=1`:

```bash
# Create the role
pvesh create /access/roles \
  --roleid TainerFull \
  --privs "Sys.Audit,Sys.Modify,VM.Allocate,VM.Audit,VM.Config.Disk,VM.Config.CPU,VM.Config.Memory,VM.Config.Network,VM.Config.Options,VM.PowerMgmt,VM.Migrate,VM.Snapshot,VM.Snapshot.Rollback,VM.Backup,VM.Console,Datastore.Audit,Datastore.Allocate,Datastore.AllocateSpace,Datastore.AllocateTemplate"

# Create a user for Tainer (if not already existing) and set its password
pvesh create /access/users --userid tainer@pve
pveum passwd tainer@pve

# Assign the role at the root path with propagation
pvesh create /access/acl \
  --path / \
  --roles TainerFull \
  --users tainer@pve \
  --propagate 1
```

Enter the same username and password when you add the site in Tainer.

> **Note:** a `@pve` user covers everything that goes through the Proxmox API. Features that run commands on the node over SSH need a `@pam` user; see [Console and SSH access](#console-and-ssh-access).

---

## Full Privilege Breakdown

### Cluster / Global

| Privilege | API Endpoints | Tainer Feature |
|-----------|--------------|----------------|
| `Sys.Audit` | `GET /cluster/nextid` | Auto-assign next available VMID |
| `Sys.Audit` | `GET /version` | Display Proxmox version in UI |
| `Sys.Audit` | `GET /cluster/firewall/rules` | Config backup export |
| `Sys.Audit` | `GET /storage` | Global storage configuration |
| `Sys.Modify` | `GET/PUT /cluster/options` | Tag color sync to Proxmox UI |
| `Sys.Modify` | `POST/DELETE /cluster/firewall/rules` | Add and delete cluster firewall rules (Tainy) |

### Nodes

| Privilege | API Endpoints | Tainer Feature |
|-----------|--------------|----------------|
| `Sys.Audit` | `GET /nodes` | List cluster nodes |
| `Sys.Audit` | `GET /nodes/{node}/status` | Node resource metrics |
| `Sys.Audit` | `GET /nodes/{node}/rrddata` | Dashboard charts |
| `Sys.Audit` | `GET /nodes/{node}/aplinfo` | Appliance/template catalog |
| `Sys.Audit` | `GET /nodes/{node}/tasks` | Task list and polling |
| `Sys.Audit` | `GET /nodes/{node}/tasks/{upid}/status` | Task progress tracking |
| `Sys.Audit` | `GET /nodes/{node}/tasks/{upid}/log` | Task log streaming |
| `Sys.Audit` | `GET /nodes/{node}/dns` | Node config backup |
| `Sys.Audit` | `GET /nodes/{node}/network` | Node config backup |
| `Sys.Audit` | `GET /nodes/{node}/hosts` | Node config backup |
| `Sys.Audit` | `GET /nodes/{node}/time` | Node config backup |
| `Sys.Audit` | `GET /nodes/{node}/apt/update` | List available APT updates |
| `Sys.Modify` | `POST /nodes/{node}/apt/update` | Refresh APT package index |

### Virtual Machines (LXC & QEMU)

| Privilege | API Endpoints | Tainer Feature |
|-----------|--------------|----------------|
| `VM.Allocate` | `POST /nodes/{node}/lxc` | Create LXC container |
| `VM.Allocate` | `DELETE /nodes/{node}/lxc/{vmid}` | Delete LXC container |
| `VM.Allocate` | `POST /nodes/{node}/qemu` | Create QEMU VM |
| `VM.Allocate` | `DELETE /nodes/{node}/qemu/{vmid}` | Delete QEMU VM |
| `VM.Allocate` | `POST /nodes/{node}/lxc` (restore) | Restore LXC from backup |
| `VM.Allocate` | `POST /nodes/{node}/qemu` (restore) | Restore QEMU from backup |
| `VM.Audit` | `GET /nodes/{node}/lxc` | List all LXC containers |
| `VM.Audit` | `GET /nodes/{node}/lxc/{vmid}/config` | Container configuration |
| `VM.Audit` | `GET /nodes/{node}/lxc/{vmid}/status/current` | Container status |
| `VM.Audit` | `GET /nodes/{node}/lxc/{vmid}/interfaces` | Container network interfaces |
| `VM.Audit` | `GET /nodes/{node}/qemu` | List all QEMU VMs |
| `VM.Audit` | `GET /nodes/{node}/qemu/{vmid}/config` | VM configuration |
| `VM.Audit` | `GET /nodes/{node}/qemu/{vmid}/status/current` | VM status |
| `VM.Audit` | `GET /nodes/{node}/qemu/{vmid}/agent/network-get-interfaces` | VM guest network info |
| `VM.Config.Disk` | `POST /nodes/{node}/lxc`, `PUT .../config` | Disk allocation on create/update |
| `VM.Config.CPU` | `POST /nodes/{node}/lxc`, `PUT .../config` | CPU cores on create/update |
| `VM.Config.Memory` | `POST /nodes/{node}/lxc`, `PUT .../config` | RAM on create/update |
| `VM.Config.Network` | `POST /nodes/{node}/lxc`, `PUT .../config` | Network on create/update |
| `VM.Config.Options` | `PUT /nodes/{node}/lxc/{vmid}/config` | Description, tags, startup, features |
| `VM.Config.Options` | `PUT /nodes/{node}/qemu/{vmid}/config` | Description, tags, startup |
| `VM.PowerMgmt` | `POST /nodes/{node}/lxc/{vmid}/status/{action}` | Start / stop / reboot / shutdown LXC |
| `VM.PowerMgmt` | `POST /nodes/{node}/qemu/{vmid}/status/{action}` | Start / stop / reboot / shutdown VM |
| `VM.Migrate` | `POST /nodes/{node}/lxc/{vmid}/migrate` | Live migrate LXC to another node |
| `VM.Migrate` | `POST /nodes/{node}/qemu/{vmid}/migrate` | Live migrate VM to another node |
| `VM.Snapshot` | `GET /nodes/{node}/{type}/{vmid}/snapshot` | List snapshots |
| `VM.Snapshot` | `POST /nodes/{node}/{type}/{vmid}/snapshot` | Create snapshot |
| `VM.Snapshot` | `DELETE /nodes/{node}/{type}/{vmid}/snapshot/{name}` | Delete snapshot |
| `VM.Snapshot.Rollback` | `POST .../snapshot/{name}/rollback` | Rollback to snapshot |
| `VM.Backup` | `POST /nodes/{node}/vzdump` | Trigger on-demand backup |
| `VM.Audit` | `GET /nodes/{node}/{type}/{vmid}/firewall/...` | Guest firewall panel |
| `VM.Config.Network` | `PUT/POST/DELETE /nodes/{node}/{type}/{vmid}/firewall/...` | Guest firewall enable and rule edits |

### Datastore / Storage

| Privilege | API Endpoints | Tainer Feature |
|-----------|--------------|----------------|
| `Datastore.Audit` | `GET /nodes/{node}/storage` | List storage pools per node |
| `Datastore.Audit` | `GET /nodes/{node}/storage/{s}/content?content=vztmpl` | List container templates |
| `Datastore.Audit` | `GET /nodes/{node}/storage/{s}/content?content=iso` | List ISO images |
| `Datastore.Audit` | `GET /nodes/{node}/storage/{s}/content` | List backup archives |
| `Datastore.AllocateTemplate` | `POST /nodes/{node}/storage/{s}/download-url` | Import template from URL |
| `Datastore.AllocateTemplate` | `POST /nodes/{node}/storage/{s}/oci-registry-pull` | Pull OCI registry template |
| `Datastore.AllocateTemplate` | `POST /nodes/{node}/storage/{s}/upload` | Upload snippets / templates |
| `Datastore.AllocateSpace` | (implicit on container/VM creation) | Allocate disk space for new VMs |
| `Datastore.Allocate` | `DELETE /nodes/{node}/storage/{s}/content/{volid}` | Delete backup archives |

---

## Console and SSH access

The web console uses the site's own Proxmox login. There is no separate console user.

Some features run commands on the node over SSH: CVE scans, the debsecan install after container create, container port scans, and restoring custom LXC config lines. Tainer connects as the part of the site username before the `@` (so `root@pam` becomes `root`) with the same password. That only works for a `@pam` user that can log in over SSH, usually `root@pam`. With a `@pve` user these features fail and everything else keeps working.

The site's SSH host key policy decides how node host keys are checked. With the strict policy Tainer needs a `known_hosts` file in the home directory of the user running it (`/home/tainer/.ssh/known_hosts` in the Docker image) and does not fall back to accept-new.

---

## Minimal Permissions (Reduced Feature Set)

If you don't need every feature, you can drop these privileges:

| Privilege | Feature You Lose |
|-----------|-----------------|
| `Sys.Modify` | Tag color sync to Proxmox UI, APT index refresh, cluster firewall rule changes |
| `VM.Migrate` | Live migration between nodes |
| `VM.Snapshot` | Snapshot create / delete / list |
| `VM.Snapshot.Rollback` | Snapshot rollback |
| `VM.Backup` | On-demand backup triggers |
| `Datastore.Allocate` | Deleting backup archives |
| `Datastore.AllocateTemplate` | Importing / pulling / uploading templates |

### Minimum Viable Role (Read-Only + Deploy)

For basic container deployment and management only:

```
Sys.Audit
VM.Allocate
VM.Audit
VM.Config.Disk
VM.Config.CPU
VM.Config.Memory
VM.Config.Network
VM.Config.Options
VM.PowerMgmt
Datastore.Audit
Datastore.AllocateSpace
```
