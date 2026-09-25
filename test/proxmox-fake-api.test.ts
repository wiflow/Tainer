import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import fc from "fast-check";

import {
  encodeDeploymentId,
  getDashboardOverviewData,
  getDeploymentDetail,
  getDeploymentIndex,
  getLatestDeploymentActivity,
  listAllBackups,
  listBackupsForVm,
  withSiteConfig,
} from "@/lib/proxmox";
import type { ResolvedSiteConfig } from "@/lib/site-types";
import { parseTainerMeta } from "@/lib/tainer-meta";

type Reply = { body: string; status: number };
type Route = (url: URL) => Reply;

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const ok = (data: unknown): Route => () => ({ body: JSON.stringify({ data }), status: 200 });
const notFound = (): Reply => ({ body: JSON.stringify({ data: null, message: "Not found" }), status: 500 });

const metaDescription = (templateId: string) =>
  `notes\n---tainer-meta---\n${JSON.stringify({
    deployedAt: "2026-01-01T00:00:00.000Z",
    templateId,
    templateName: "Template",
    templateVersion: "1",
  })}`;

const lxcConfig101 = {
  cores: 2,
  description: metaDescription("t101"),
  digest: "d101",
  env: "A=1\u0000B=two",
  hostname: "web-host",
  memory: 1024,
  nameserver: "1.1.1.1",
  net0: "name=eth0,bridge=vmbr0,ip=10.0.0.5/24,gw=10.0.0.1",
  ostemplate: "local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst",
  rootfs: "local-lvm:vm-101-disk-0,size=8G",
  searchdomain: "lan",
  swap: 512,
  tags: "prod;web",
};

const qemuConfig201 = {
  cores: 2,
  cpu: "host",
  description: metaDescription("t201"),
  digest: "d201",
  ide2: "local:iso/ubuntu-24.04-live-server-amd64.iso,media=cdrom",
  machine: "q35",
  memory: "4096",
  name: "ubuntu",
  ostype: "l26",
  scsi0: "local-lvm:vm-201-disk-0,size=32G",
  scsihw: "virtio-scsi-pci",
  sockets: "2",
  tags: "vm",
  vga: "std",
};

const taskTypes = new Map<number, string>();
const hits = new Map<string, number>();
let logins = 0;
let authFailuresLeft = 0;

const mainRoutes: Record<string, Route> = {
  "/nodes": ok([
    { id: "node/pve2", node: "pve2", status: "online", type: "node" },
    { id: "node/pve1", node: "pve1", ssl_fingerprint: "AA:BB", status: "online", type: "node" },
  ]),
  "/nodes/pve1/lxc": ok([
    { cpu: 0.25, cpus: 2, disk: GiB, maxdisk: 8 * GiB, maxmem: GiB, mem: 256 * MiB, name: "web", status: "running", tags: "prod;web", uptime: 3600, vmid: 101 },
    { status: "running", vmid: 102 },
    { cpus: 0, maxdisk: 0, name: "old", status: "stopped", vmid: 103 },
  ]),
  "/nodes/pve1/lxc/101/config": ok(lxcConfig101),
  "/nodes/pve1/lxc/101/status/current": ok({
    cpu: 0.25, cpus: 2, disk: GiB, diskread: 10, diskwrite: 20, maxdisk: 8 * GiB, maxmem: GiB, mem: 256 * MiB,
    name: "web", netin: 30, netout: 40, status: "running", uptime: 3600,
  }),
  "/nodes/pve1/lxc/101/interfaces": ok([
    { inet: "127.0.0.1/8", name: "lo" },
    { hwaddr: "aa:bb:cc:dd:ee:01", inet: "10.0.0.5/24", name: "eth0" },
  ]),
  "/nodes/pve1/lxc/102/config": ok({ cores: "1", hostname: "dhcp-ct", memory: "512", net0: "name=eth0,bridge=vmbr0,ip=dhcp" }),
  "/nodes/pve1/lxc/102/status/current": ok({ status: "running" }),
  "/nodes/pve1/lxc/102/interfaces": ok([{ inet: "10.0.0.9/24", name: "eth0" }]),
  "/nodes/pve1/lxc/104/config": () => ({
    body: JSON.stringify({ data: null, message: "Permission check failed (/vms/104, VM.Audit)" }),
    status: 500,
  }),
  "/nodes/pve1/lxc/104/status/current": ok({ maxmem: 512 * MiB, name: "orphan", status: "stopped" }),
  "/nodes/pve1/qemu": ok([
    { status: "stopped", template: 1, vmid: 200 },
    { cpu: 0.5, cpus: 4, disk: 4 * GiB, maxdisk: 32 * GiB, maxmem: 4 * GiB, mem: 2 * GiB, name: "ubuntu", status: "running", tags: "vm", uptime: 90000, vmid: 201 },
    { status: "stopped", vmid: 202 },
  ]),
  "/nodes/pve1/qemu/201/config": ok(qemuConfig201),
  "/nodes/pve1/qemu/201/status/current": ok({
    cpu: 0.5, disk: 0, diskread: 1, diskwrite: 2, maxdisk: 32 * GiB, maxmem: 4 * GiB, mem: 2 * GiB,
    name: "ubuntu", netin: 3, netout: 4, status: "running", uptime: 90000,
  }),
  "/nodes/pve1/qemu/201/agent/network-get-interfaces": ok({
    result: [
      { "ip-addresses": [{ "ip-address": "127.0.0.1", "ip-address-type": "ipv4" }], name: "lo" },
      {
        "ip-addresses": [
          { "ip-address": "fe80::1", "ip-address-type": "ipv6" },
          { "ip-address": "10.0.0.20", "ip-address-type": "ipv4" },
        ],
        name: "eth0",
      },
    ],
  }),
  "/nodes/pve1/qemu/202/config": ok({ cores: 1, ide2: "none,media=cdrom", memory: 2048, sockets: 1 }),
  "/nodes/pve1/qemu/202/status/current": ok({ cpus: 1, status: "stopped" }),
  "/nodes/pve1/qemu/204/config": ok({ name: "garbled" }),
  "/nodes/pve1/qemu/204/status/current": () => ({ body: "<html>bad gateway</html>", status: 502 }),
  "/nodes/pve2/qemu": ok([]),
  "/nodes/pve1/tasks": (url) => {
    const type = taskTypes.get(Number(url.searchParams.get("vmid")));
    const task = type === undefined
      ? { upid: "UPID:pve1:00001234:00005678:65A5B2C0:qmstart:999:root@pam:" }
      : { endtime: 1700000000, type, upid: `UPID:pve1:1:1:1:${type}:1:root@pam:` };
    return ok([task])(url);
  },
};

const backupRoutes: Record<string, Route> = {
  "/nodes": ok([
    { id: "node/pve2", node: "pve2", type: "node" },
    { id: "node/pve1", node: "pve1", type: "node" },
  ]),
  "/nodes/pve1/storage": ok([
    { avail: 50, content: "iso,backup", storage: "local", total: 100, type: "dir" },
    { avail: 50, content: "backup", shared: 1, storage: "nfs", total: 100, type: "nfs" },
    { avail: 1, content: "backup", storage: "full", total: 100, type: "dir" },
    { avail: 50, content: "backup", storage: "broken", total: 100, type: "dir" },
    { content: "vztmpl", storage: "templates", type: "dir" },
  ]),
  "/nodes/pve2/storage": ok([
    { avail: 50, content: "backup", shared: 1, storage: "nfs", total: 100, type: "nfs" },
    { avail: 50, content: "backup", storage: "local", total: 100, type: "dir" },
  ]),
  "/nodes/pve2/storage/nfs/content": ok([
    { content: "backup", ctime: 1768000000, format: "vma.zst", size: 2048, subtype: "qemu", vmid: 201, volid: "nfs:backup/vzdump-qemu-201.vma.zst" },
  ]),
  "/nodes/pve2/storage/local/content": ok([]),
  "/nodes/pve1/storage/local/content": ok([
    { content: "backup", ctime: 1768200000, format: "tar.zst", notes: "nightly", size: 1024, subtype: "lxc", vmid: 101, volid: "local:backup/vzdump-lxc-101.tar.zst" },
    { content: "iso", volid: "local:iso/x.iso" },
    { content: "backup", volid: "local:backup/stray.tar" },
  ]),
};

const authRoutes: Record<string, Route> = {
  "/nodes/pve1/tasks": () => {
    if (authFailuresLeft > 0) {
      authFailuresLeft -= 1;
      return { body: JSON.stringify({ data: null }), status: 401 };
    }
    return ok([{ endtime: 1700000000, type: "qmstart" }])(new URL("http://x"));
  },
};

const fixtures: Record<string, Record<string, Route>> = {
  auth: authRoutes,
  backups: backupRoutes,
  empty: {},
  main: mainRoutes,
};

let server: Server;
let baseUrl = "";

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const [, site, ...rest] = url.pathname.split("/");
    const path = `/${rest.join("/")}`.replace(/^\/api2\/json/, "");

    let reply: Reply;
    if (req.method === "POST" && path === "/access/ticket") {
      logins += 1;
      reply = ok({ CSRFPreventionToken: "csrf", ticket: `ticket-${logins}` })(url);
    } else {
      hits.set(`${site}${path}${url.search}`, (hits.get(`${site}${path}${url.search}`) ?? 0) + 1);
      reply = fixtures[site]?.[path]?.(url) ?? notFound();
    }

    req.resume();
    req.on("end", () => {
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function site(siteId: string): ResolvedSiteConfig {
  return {
    apiUrl: `${baseUrl}/${siteId}`,
    consoleKnownHostsContent: null,
    defaultBackupSlaHours: 24,
    defaultBackupStorage: "",
    defaultIsoStorage: "",
    defaultNode: "pve1",
    defaultRootfsStorage: "",
    defaultVmStorage: "",
    password: "secret",
    siteId,
    siteName: siteId,
    siteSlug: siteId,
    sshHostKeyPolicy: "off",
    tlsCustomCaPem: null,
    tlsFingerprint: null,
    tlsInsecure: false,
    username: "root@pam",
  };
}

const inSite = <T>(siteId: string, fn: () => Promise<T>) => withSiteConfig(site(siteId), fn);
const lxcId = (vmid: number) => encodeDeploymentId("pve1", vmid, "lxc", "main");
const qemuId = (vmid: number) => encodeDeploymentId("pve1", vmid, "qemu", "main");
const issue = (endpoint: string, message = "Not found") => ({ endpoint, message, requiredPrivileges: [], scope: undefined });

const listed = [
  {
    cpu: "2 vCPU", cpuUsage: 0.25, disk: "8 GB", diskTotalBytes: 8 * GiB, diskUsedBytes: GiB,
    environmentMode: "Runtime env", id: lxcId(101), ipAddress: "10.0.0.5", memTotalBytes: GiB,
    memUsedBytes: 256 * MiB, memory: "1 GB", name: "web", node: "pve1", rawStatus: "running",
    statusLabel: "running", tagList: ["prod", "web"], tainerMeta: parseTainerMeta(lxcConfig101.description),
    templateName: "Debian 12 Standard_12.2 1_amd64", type: "lxc" as const, uptime: "1h 0m", vmid: 101,
  },
  {
    cpu: "Unavailable", cpuUsage: null, disk: "0 Byte", diskTotalBytes: null, diskUsedBytes: null,
    environmentMode: "Runtime env", id: lxcId(102), ipAddress: "10.0.0.9", memTotalBytes: null,
    memUsedBytes: null, memory: "0 Byte", name: "CT 102", node: "pve1", rawStatus: "running",
    statusLabel: "running", tagList: [], tainerMeta: null, templateName: "Proxmox LXC",
    type: "lxc" as const, uptime: "0s", vmid: 102,
  },
  {
    cpu: "Unavailable", cpuUsage: null, disk: "0 Byte", diskTotalBytes: 0, diskUsedBytes: null,
    environmentMode: "Runtime env", id: lxcId(103), ipAddress: "Unavailable", memTotalBytes: null,
    memUsedBytes: null, memory: "0 Byte", name: "old", node: "pve1", rawStatus: "stopped",
    statusLabel: "stopped", tagList: [], tainerMeta: null, templateName: "Proxmox LXC",
    type: "lxc" as const, uptime: "0s", vmid: 103,
  },
  {
    cpu: "4 vCPU", cpuUsage: 0.5, disk: "32 GB", diskTotalBytes: 32 * GiB, diskUsedBytes: 4 * GiB,
    environmentMode: "QEMU VM", id: qemuId(201), ipAddress: "10.0.0.20", memTotalBytes: 4 * GiB,
    memUsedBytes: 2 * GiB, memory: "4 GB", name: "ubuntu", node: "pve1", rawStatus: "running",
    statusLabel: "running", tagList: ["vm"], tainerMeta: parseTainerMeta(qemuConfig201.description),
    templateName: "Ubuntu 24.04 Live Server Amd64.iso", type: "qemu" as const, uptime: "1d 1h", vmid: 201,
  },
  {
    cpu: "Unavailable", cpuUsage: null, disk: "0 Byte", diskTotalBytes: null, diskUsedBytes: null,
    environmentMode: "QEMU VM", id: qemuId(202), ipAddress: "Unavailable", memTotalBytes: null,
    memUsedBytes: null, memory: "0 Byte", name: "VM 202", node: "pve1", rawStatus: "stopped",
    statusLabel: "stopped", tagList: [], tainerMeta: null, templateName: "QEMU VM",
    type: "qemu" as const, uptime: "0s", vmid: 202,
  },
];

test("the deployment index maps containers and VMs and reports failed nodes", async () => {
  assert.deepEqual(await inSite("main", getDeploymentIndex), {
    deployments: listed,
    issues: [issue("/nodes/pve2/lxc")],
  });
});

test("the dashboard list uses list data only", async () => {
  const { deployments, issues } = await inSite("main", getDashboardOverviewData);

  assert.deepEqual(
    deployments,
    listed.map((deployment) => ({
      ...deployment,
      cpu: "Unavailable",
      ipAddress: "Unavailable",
      tainerMeta: null,
      templateName: deployment.type === "lxc" ? "Proxmox LXC" : "QEMU VM",
    })),
  );
  assert.ok(issues.some((entry) => entry.endpoint === "/nodes/pve2/lxc"));
});

test("container detail merges config, status and runtime network", async () => {
  assert.deepEqual(await inSite("main", () => getDeploymentDetail(lxcId(101))), {
    configAccessible: true, coresConfigured: 2, cpu: "2 vCPU", cpuUsage: 0.25,
    description: lxcConfig101.description, digest: "d101", disk: "8 GB", diskTotalBytes: 8 * GiB,
    diskUsedBytes: GiB, environmentMode: "Runtime env", envCount: 2, envText: "A=1\nB=two",
    guestOsType: "linux", id: lxcId(101), ipAddress: "10.0.0.5", issues: [], memTotalBytes: GiB,
    memUsedBytes: 256 * MiB, memory: "1 GB", memoryConfiguredMb: 1024, swapConfiguredMb: 512, name: "web",
    networkInfo: {
      dns: "1.1.1.1", gateway: "10.0.0.1", hwAddress: "aa:bb:cc:dd:ee:01", interfaceName: "eth0",
      ipAddress: "10.0.0.5", searchDomain: "lan", subnet: "/24",
    },
    node: "pve1", ostemplate: lxcConfig101.ostemplate, rawStatus: "running",
    resourceUsage: {
      cpuRatio: 0.25, diskReadBytes: 10, diskTotalBytes: 8 * GiB, diskUsedBytes: GiB, diskWriteBytes: 20,
      memTotalBytes: GiB, memUsedBytes: 256 * MiB, netInBytes: 30, netOutBytes: 40,
    },
    rootfs: lxcConfig101.rootfs, statusLabel: "running", tagList: ["prod", "web"],
    tainerMeta: parseTainerMeta(lxcConfig101.description), templateName: "Debian 12 Standard_12.2 1_amd64",
    type: "lxc", uptime: "1h 0m", vmid: 101,
  });

  assert.deepEqual(await inSite("main", () => getDeploymentDetail(lxcId(102))), {
    configAccessible: true, coresConfigured: 1, cpu: "1 vCPU", cpuUsage: null, description: "",
    digest: "", disk: "0 Byte", diskTotalBytes: null, diskUsedBytes: null,
    environmentMode: "No env configured", envCount: 0, envText: "", guestOsType: "linux", id: lxcId(102),
    ipAddress: "10.0.0.9", issues: [], memTotalBytes: null, memUsedBytes: null, memory: "0 Byte",
    memoryConfiguredMb: 512, swapConfiguredMb: null, name: "dhcp-ct",
    networkInfo: {
      dns: "", gateway: "", hwAddress: "", interfaceName: "eth0", ipAddress: "10.0.0.9", searchDomain: "",
      subnet: "/24",
    },
    node: "pve1", ostemplate: "Unavailable", rawStatus: "running",
    resourceUsage: {
      cpuRatio: 0, diskReadBytes: 0, diskTotalBytes: 0, diskUsedBytes: 0, diskWriteBytes: 0,
      memTotalBytes: 0, memUsedBytes: 0, netInBytes: 0, netOutBytes: 0,
    },
    rootfs: "Unavailable", statusLabel: "running", tagList: [], tainerMeta: null,
    templateName: "Proxmox LXC", type: "lxc", uptime: "0s", vmid: 102,
  });
});

test("container detail survives a forbidden config and is null when nothing loads", async () => {
  assert.deepEqual(await inSite("main", () => getDeploymentDetail(lxcId(104))), {
    configAccessible: false, coresConfigured: null, cpu: "Unavailable", cpuUsage: null, description: "",
    digest: "", disk: "0 Byte", diskTotalBytes: null, diskUsedBytes: null,
    environmentMode: "No env configured", envCount: 0, envText: "", guestOsType: "linux", id: lxcId(104),
    ipAddress: "Unavailable",
    issues: [{
      endpoint: "/nodes/pve1/lxc/104/config",
      message: "Permission check failed ([path] VM.Audit)",
      requiredPrivileges: ["VM.Audit"],
      scope: "/vms/104",
    }],
    memTotalBytes: 512 * MiB, memUsedBytes: null, memory: "512 MB", memoryConfiguredMb: null,
    swapConfiguredMb: null, name: "orphan", networkInfo: null, node: "pve1", ostemplate: "Unavailable",
    rawStatus: "stopped", resourceUsage: null, rootfs: "Unavailable", statusLabel: "stopped", tagList: [],
    tainerMeta: null, templateName: "Proxmox LXC", type: "lxc", uptime: "0s", vmid: 104,
  });

  assert.equal(await inSite("main", () => getDeploymentDetail(lxcId(103))), null);
  assert.equal(await inSite("main", () => getDeploymentDetail(qemuId(203))), null);
});

test("VM detail merges config, status and guest agent address", async () => {
  assert.deepEqual(await inSite("main", () => getDeploymentDetail(qemuId(201))), {
    configAccessible: true, coresConfigured: 2, cpu: "4 vCPU", cpuUsage: 0.5,
    description: qemuConfig201.description, digest: "d201", disk: "32 GB", diskTotalBytes: 32 * GiB,
    diskUsedBytes: 0, environmentMode: "QEMU VM", envCount: 0, envText: "", guestOsType: "l26",
    id: qemuId(201), ipAddress: "10.0.0.20", issues: [], memTotalBytes: 4 * GiB, memUsedBytes: 2 * GiB,
    memory: "4 GB", memoryConfiguredMb: 4096, swapConfiguredMb: null, name: "ubuntu", networkInfo: null,
    node: "pve1", ostemplate: "local:iso/ubuntu-24.04-live-server-amd64.iso", rawStatus: "running",
    resourceUsage: {
      cpuRatio: 0.5, diskReadBytes: 1, diskTotalBytes: 32 * GiB, diskUsedBytes: 0, diskWriteBytes: 2,
      memTotalBytes: 4 * GiB, memUsedBytes: 2 * GiB, netInBytes: 3, netOutBytes: 4,
    },
    rootfs: qemuConfig201.scsi0, statusLabel: "running", tagList: ["vm"],
    tainerMeta: parseTainerMeta(qemuConfig201.description), templateName: "Ubuntu 24.04 Live Server Amd64.iso",
    type: "qemu", uptime: "1d 1h", vmid: 201, vmCpuType: "host", vmSockets: 2, vmMachineType: "q35",
    vmScsiHw: "virtio-scsi-pci", vmVga: "std", vmIso: "local:iso/ubuntu-24.04-live-server-amd64.iso",
  });

  assert.deepEqual(await inSite("main", () => getDeploymentDetail(qemuId(202))), {
    configAccessible: true, coresConfigured: 1, cpu: "1 vCPU", cpuUsage: null, description: "", digest: "",
    disk: "0 Byte", diskTotalBytes: null, diskUsedBytes: null, environmentMode: "QEMU VM", envCount: 0,
    envText: "", guestOsType: undefined, id: qemuId(202), ipAddress: "Unavailable", issues: [],
    memTotalBytes: null, memUsedBytes: null, memory: "2 GB", memoryConfiguredMb: 2048,
    swapConfiguredMb: null, name: "VM 202", networkInfo: null, node: "pve1", ostemplate: "No ISO",
    rawStatus: "stopped", resourceUsage: null, rootfs: "Unavailable", statusLabel: "stopped", tagList: [],
    tainerMeta: null, templateName: "QEMU VM", type: "qemu", uptime: "0s", vmid: 202, vmCpuType: undefined,
    vmSockets: 1, vmMachineType: undefined, vmScsiHw: undefined, vmVga: undefined, vmIso: undefined,
  });
});

test("a response that is not JSON becomes an issue", async () => {
  const detail = await inSite("main", () => getDeploymentDetail(qemuId(204)));

  assert.equal(detail?.name, "garbled");
  assert.deepEqual(detail?.issues, [{
    endpoint: "/nodes/pve1/qemu/204/status/current",
    message: "Failed to parse Proxmox response",
    requiredPrivileges: [],
  }]);
});

test("listAllBackups reads every healthy backup storage once", async () => {
  assert.deepEqual(await inSite("backups", listAllBackups), {
    archives: [
      {
        ctime: 1768200000, ctimeIso: "2026-01-12T06:40:00.000Z", format: "tar.zst", node: "pve1",
        notes: "nightly", sizeBytes: 1024, storage: "local", subtype: "lxc", vmid: 101,
        volid: "local:backup/vzdump-lxc-101.tar.zst",
      },
      {
        ctime: 1768000000, ctimeIso: "2026-01-09T23:06:40.000Z", format: "vma.zst", node: "pve2",
        notes: "", sizeBytes: 2048, storage: "nfs", subtype: "qemu", vmid: 201,
        volid: "nfs:backup/vzdump-qemu-201.vma.zst",
      },
      {
        ctime: 0, ctimeIso: "", format: "unknown", node: "pve1", notes: "", sizeBytes: 0, storage: "local",
        subtype: "", vmid: 0, volid: "local:backup/stray.tar",
      },
    ],
    issues: [issue("/nodes/pve1/storage/broken/content")],
  });
  assert.equal(hits.get("backups/nodes/pve1/storage/full/content?content=backup"), undefined);
  assert.equal(hits.get("backups/nodes/pve1/storage/nfs/content?content=backup"), undefined);

  assert.deepEqual(await inSite("empty", listAllBackups), { archives: [], issues: [issue("/nodes")] });
});

test("listBackupsForVm reads shared storage through the given node", async () => {
  const { archives, issues } = await inSite("backups", () => listBackupsForVm("pve1", 101));

  assert.deepEqual(archives.map((archive) => [archive.volid, archive.vmid]), [
    ["local:backup/vzdump-lxc-101.tar.zst", 101],
    ["local:backup/stray.tar", 101],
  ]);
  assert.deepEqual(issues, [issue("/nodes/pve1/storage/nfs/content"), issue("/nodes/pve1/storage/broken/content")]);
  assert.equal(hits.get("backups/nodes/pve1/storage/local/content?content=backup&vmid=101"), 1);
});

const taskLabels: [string, string][] = [
  ["vzdump", "Backed up"], ["VZDump", "Backed up"], ["backup_verify", "Backed up"],
  ["qmrestore", "Restored"], ["vzrestore", "Restored"], ["vzdump-restore", "Restored"],
  ["qmigrate", "Migrated"], ["vzmigrate", "Migrated"],
  ["qmclone", "Deployed"], ["vzclone", "Deployed"], ["qmcreate", "Deployed"], ["vzcreate", "Deployed"],
  ["zfscreate", "Deployed"],
  ["qmdestroy", "Deleted"], ["vzdestroy", "Deleted"], ["imgdelete", "Deleted"],
  ["qmreboot", "Restarted"], ["vzreboot", "Restarted"], ["qmrestart", "Restarted"],
  ["qmshutdown", "Shutdown"], ["vzshutdown", "Shutdown"],
  ["qmstop", "Stopped"], ["vzstop", "Stopped"], ["stopall", "Stopped"],
  ["qmstart", "Started"], ["vzstart", "Started"], ["startall", "Started"], ["  QMStart  ", "Started"],
  ["qmresume", "Resumed"], ["vzresume", "Resumed"],
  ["qmsuspend", "Suspended"], ["vzsuspend", "Suspended"],
  ["qmreset", "Reset"], ["resetconfig", "Reset"],
  ["qmsnapshot", "Snapshotted"], ["vzsnapshot", "Snapshotted"], ["qmdelsnapshot", "Snapshotted"],
  ["qmrollback", "Rolled back"], ["vzrollback", "Rolled back"],
  ["qmconfig", "Updated"], ["qmset", "Updated"], ["aptupdate", "Updated"],
  ["qmtemplate", "Ran qmtemplate"], ["vztemplate", "Ran vztemplate"], ["qmmove", "Ran qmmove"],
  ["move_volume", "Ran move_volume"], ["resize", "Ran resize"], ["imgcopy", "Ran imgcopy"],
  ["download", "Ran download"], [" srvreload ", "Ran srvreload"],
];

let nextTaskVmid = 1000;

async function latestTaskFor(type: string) {
  const vmid = nextTaskVmid++;
  taskTypes.set(vmid, type);
  return inSite("main", () => getLatestDeploymentActivity("pve1", vmid));
}

test("task types map to activity labels", async () => {
  for (const [type, label] of taskLabels) {
    assert.deepEqual(await latestTaskFor(type), { label, occurredAt: "2023-11-14T22:13:20.000Z" }, type);
  }
});

test("unknown task types are reported as ran", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, unit: fc.constantFrom("x", "y", "q", "w", "j", "Z", "_", "0", " ") })
        .filter((type) => type.trim() !== ""),
      async (type) => {
        assert.equal((await latestTaskFor(type))?.label, `Ran ${type.trim()}`);
      },
    ),
    { numRuns: 30 },
  );
});

test("console tasks are ignored and the UPID fills in a missing type", async () => {
  for (const type of ["vncproxy", "VNCShell", "termproxy", "spiceproxy"]) {
    assert.equal(await latestTaskFor(type), null, type);
  }
  assert.deepEqual(await inSite("main", () => getLatestDeploymentActivity("pve1", 999)), {
    label: "Started",
    occurredAt: "2024-01-15T22:33:36.000Z",
  });
});

test("repeated GETs are served from cache and a 401 forces a new login", async () => {
  const call = () => inSite("main", () => getLatestDeploymentActivity("pve1", 998));
  await call();
  await call();
  assert.equal(hits.get("main/nodes/pve1/tasks?vmid=998"), 1);

  authFailuresLeft = 1;
  const before = logins;
  assert.equal(await inSite("auth", () => getLatestDeploymentActivity("pve1", 1)), null);
  assert.equal(logins, before + 1);
  assert.deepEqual(await inSite("auth", () => getLatestDeploymentActivity("pve1", 2)), {
    label: "Started",
    occurredAt: "2023-11-14T22:13:20.000Z",
  });
  assert.equal(logins, before + 2);
});
