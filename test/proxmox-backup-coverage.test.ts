import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import fc from "fast-check";

import {
  computeBackupCoverage,
  type LxcMountInfo,
  type ProtectionReason,
  type ProxmoxBackupArchive,
  type ProxmoxBackupJob,
  type ProxmoxBackupStoragePool,
} from "@/lib/proxmox";

const NOW = Date.UTC(2026, 0, 15, 12);

beforeEach(() => mock.timers.enable({ apis: ["Date"], now: NOW }));
afterEach(() => mock.timers.reset());

const vmidArb = fc.integer({ min: 100, max: 104 });
const storageArb = fc.constantFrom("local", "nfs", "pbs");

const archiveArb = fc.record({
  ctime: fc.integer({ min: NOW / 1000 - 30 * 86400, max: NOW / 1000 }),
  storage: storageArb,
  vmid: vmidArb,
}).map(({ ctime, storage, vmid }): ProxmoxBackupArchive => ({
  ctime,
  ctimeIso: new Date(ctime * 1000).toISOString(),
  format: "tar.zst",
  node: "pve1",
  notes: "",
  sizeBytes: 1024,
  storage,
  subtype: "lxc",
  vmid,
  volid: `${storage}:backup/vzdump-lxc-${vmid}-${ctime}.tar.zst`,
}));

const jobArb = fc.record({
  all: fc.boolean(),
  enabled: fc.boolean(),
  vmids: fc.array(vmidArb, { maxLength: 3 }),
}).map((job): ProxmoxBackupJob => ({
  ...job,
  compress: "zstd",
  dow: "",
  id: "backup-1",
  mode: "snapshot",
  node: "",
  pruneBackups: "",
  schedule: "daily",
  storage: "local",
  type: "vzdump",
}));

const poolArb = fc.record({
  issues: fc.subarray(["Storage is disabled", "Storage has less than 5% free space"]),
  storage: storageArb,
}).map((pool): ProxmoxBackupStoragePool => ({
  ...pool,
  availableBytes: null,
  contentTypes: ["backup"],
  node: "pve1",
  shared: false,
  totalBytes: null,
  type: "dir",
  usageRatio: null,
  usedBytes: null,
}));

const mountArb = fc.record({
  backup: fc.boolean(),
  isBind: fc.boolean(),
  mountPoint: fc.constantFrom("/data", "/srv"),
  source: fc.constantFrom("mp0", "mp1"),
  volume: fc.constantFrom("/mnt/host", "local-lvm:vm-100-disk-1"),
});

const inputArb = fc.record({
  archives: fc.array(archiveArb, { maxLength: 6 }),
  jobs: fc.array(jobArb, { maxLength: 3 }),
  mountPoints: fc.array(mountArb, { maxLength: 3 }),
  pools: fc.array(poolArb, { maxLength: 3 }),
  slaHours: fc.integer({ min: 0, max: 400 }),
  type: fc.constantFrom("lxc" as const, "qemu" as const),
  vmid: vmidArb,
});

type Input = {
  archives: ProxmoxBackupArchive[];
  jobs: ProxmoxBackupJob[];
  mountPoints: LxcMountInfo[];
  pools: ProxmoxBackupStoragePool[];
  slaHours: number;
  type: "lxc" | "qemu";
  vmid: number;
};

function coverage(input: Input) {
  return computeBackupCoverage(
    input.vmid,
    input.type,
    input.archives,
    input.jobs,
    input.pools,
    input.mountPoints,
    input.slaHours,
  );
}

function expectedReasons({ archives, jobs, mountPoints, pools, slaHours, type, vmid }: Input) {
  const reasons: ProtectionReason[] = [];
  const own = archives.filter((a) => a.vmid === vmid);
  const age = own[0] ? (NOW - own[0].ctime * 1000) / 3600000 : null;

  if (!pools.some((p) => p.issues.length === 0)) {
    reasons.push({ level: "error", message: "No healthy backup storage is currently available" });
  }
  if (!jobs.some((j) => j.enabled && (j.all || j.vmids.includes(vmid)))) {
    reasons.push({ level: "warning", message: `No scheduled backup job includes VMID ${vmid}` });
  }
  if (age === null) {
    reasons.push({ level: "error", message: `No backup archives exist for VMID ${vmid}` });
  } else if (slaHours > 0 && age > slaHours) {
    reasons.push({
      level: "warning",
      message: `Last backup is ${Math.round(age)}h old, exceeding the ${slaHours}h SLA`,
    });
  }
  for (const mp of type === "lxc" ? mountPoints : []) {
    if (mp.isBind) {
      reasons.push({
        level: "warning",
        message: `Bind mount ${mp.volume} at ${mp.mountPoint} is not included in archive data`,
      });
    } else if (!mp.backup) {
      reasons.push({
        level: "warning",
        message: `Mount point ${mp.source} (${mp.mountPoint}) is excluded from vzdump backups (backup=0)`,
      });
    }
  }
  const used = new Set(own.map((a) => a.storage));
  for (const pool of pools) {
    if (used.has(pool.storage) && pool.issues.length > 0) {
      reasons.push({
        level: "warning",
        message: `Backup storage "${pool.storage}" has issues: ${pool.issues.join(", ")}`,
      });
    }
  }
  return reasons;
}

test("coverage reasons, status and archive stats follow the inputs", () => {
  fc.assert(
    fc.property(inputArb, (input) => {
      const own = input.archives.filter((a) => a.vmid === input.vmid);
      const reasons = expectedReasons(input);
      const status = reasons.some((r) => r.level === "error")
        ? "unprotected"
        : reasons.length > 0
          ? "warning"
          : "protected";

      assert.deepEqual(coverage(input), {
        lastBackupAge: own[0] ? (NOW - own[0].ctime * 1000) / 3600000 : null,
        lastBackupDate: own[0]?.ctimeIso ?? null,
        protectionReasons: reasons,
        protectionStatus: status,
        totalArchives: own.length,
      });
    }),
  );
});

test("a covered guest with a fresh backup on healthy storage is protected", () => {
  const [archive] = fc.sample(archiveArb, { numRuns: 1, seed: 1 });
  const result = coverage({
    archives: [{ ...archive, ctime: NOW / 1000 - 3600, vmid: 100 }],
    jobs: [{ ...fc.sample(jobArb, { numRuns: 1, seed: 1 })[0], all: true, enabled: true }],
    mountPoints: [],
    pools: [{ ...fc.sample(poolArb, { numRuns: 1, seed: 1 })[0], issues: [] }],
    slaHours: 24,
    type: "qemu",
    vmid: 100,
  });

  assert.equal(result.protectionStatus, "protected");
  assert.equal(result.lastBackupAge, 1);
  assert.deepEqual(result.protectionReasons, []);
});

test("an uncovered guest without archives or storage is unprotected", () => {
  const result = coverage({
    archives: [],
    jobs: [],
    mountPoints: [{ backup: true, isBind: true, mountPoint: "/data", source: "mp0", volume: "/mnt/host" }],
    pools: [],
    slaHours: 24,
    type: "lxc",
    vmid: 101,
  });

  assert.deepEqual(result, {
    lastBackupAge: null,
    lastBackupDate: null,
    protectionReasons: [
      { level: "error", message: "No healthy backup storage is currently available" },
      { level: "warning", message: "No scheduled backup job includes VMID 101" },
      { level: "error", message: "No backup archives exist for VMID 101" },
      { level: "warning", message: "Bind mount /mnt/host at /data is not included in archive data" },
    ],
    protectionStatus: "unprotected",
    totalArchives: 0,
  });
});
