import "server-only";

import { requirePermission } from "@/lib/auth";
import { listBackupPolicies } from "@/lib/backup-policies";
import { listAlertPolicies } from "@/lib/alert-policies";
import { listConfigSnapshots, takeConfigSnapshot } from "@/lib/node-config-backup";
import { listLocalIsoFiles, isIsoLibraryConfigured } from "@/lib/iso-library";
import { listManagedUsers } from "@/lib/auth";
import { listUserGroups } from "@/lib/user-groups";
import { registerTool } from "@/lib/copilot/registry";
import {
  runInSite,
  runInSiteWithPermission,
  siteSlugSchema,
} from "@/lib/copilot/tools/helpers";

// -- Policies ---------------------------------------------------------------

registerTool({
  name: "list_backup_policies",
  category: "Backups",
  klass: "read",
  description:
    "List the automated backup policies for a site (name, enabled, interval, storage, retention, which tags they cover). Use for 'what backup schedules are set?', 'is prod being backed up automatically?'.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List backup policies — ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const policies = await listBackupPolicies();
      return policies.map((p) => ({
        name: p.name,
        enabled: p.enabled,
        intervalMinutes: p.intervalMinutes,
        storage: p.storage,
        retentionCount: p.retentionCount,
        tagSlugs: p.tagSlugs,
        lastRunAt: p.lastRunAt,
        nextRunAt: p.nextRunAt,
      }));
    });
  },
});

registerTool({
  name: "list_alert_policies",
  category: "Diagnostics",
  klass: "read",
  description:
    "List the alert policies for a site (name, enabled, and the rules they evaluate — offline, high CPU/memory, storage pressure, etc.). Use for 'what are we alerting on?', 'is high-CPU alerting turned on?'.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List alert policies — ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const policies = await listAlertPolicies();
      return policies.map((p) => ({
        name: p.name,
        enabled: p.enabled,
        rules: p.rules
          .filter((r) => r.enabled)
          .map((r) => r.type),
      }));
    });
  },
});

// -- Node config snapshots --------------------------------------------------

registerTool({
  name: "list_config_snapshots",
  category: "Cluster",
  klass: "read",
  description:
    "List saved node configuration snapshots for a site (network, DNS, hosts, storage, firewall, timezone) with when and by whom they were taken. Use for 'what config backups exist for node1?'. Restoring is intentionally UI-only (it can rewrite cluster-wide networking) — point the user to the node-configs restore page for that.",
  input_schema: siteSlugSchema({
    node: { type: "string", description: "Optional node name to filter by." },
  }),
  describe: (args) => `List config snapshots — ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const node = typeof args.node === "string" ? args.node.trim() : "";
    return runInSite(ctx.session, siteSlug, async () => {
      const snaps = await listConfigSnapshots();
      return snaps
        .filter((s) => !node || s.nodeName === node)
        .map((s) => ({
          id: s.id,
          node: s.nodeName,
          label: s.label,
          createdAt: s.createdAt,
          createdBy: s.createdBy,
          trigger: s.trigger ?? "manual",
        }));
    });
  },
});

registerTool({
  name: "take_config_snapshot",
  category: "Cluster",
  klass: "write",
  description:
    "Capture a node's current configuration (network, DNS, hosts, storage, firewall, timezone) as a restore point. Good before making node-level changes. Requires manage-settings.",
  input_schema: siteSlugSchema({
    node: { type: "string", description: "Node name to snapshot (from list_nodes)." },
    label: { type: "string", description: "Short label for the snapshot, e.g. 'before VLAN change'." },
  }),
  describe: (args) => `Snapshot config of node ${String(args.node)} (site ${String(args.siteSlug)})`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const node = String(args.node ?? "").trim();
    const label = String(args.label ?? "").trim() || "Copilot snapshot";
    if (!node) throw new Error("node is required.");
    requirePermission(ctx.session, "manage-settings");
    return runInSiteWithPermission(ctx.session, siteSlug, "manage-settings", async () => {
      const snap = await takeConfigSnapshot(node, ctx.session.user.email, label, {
        trigger: "manual",
      });
      return {
        ok: true,
        message: `Config snapshot of ${node} captured ("${label}").`,
        snapshotId: snap.id,
      };
    });
  },
});

// -- ISO library ------------------------------------------------------------

registerTool({
  name: "list_isos",
  category: "Templates",
  klass: "read",
  description:
    "List the ISO images available in the site's ISO library (name, size, modified time). Use for 'what install ISOs do we have?', typically before creating a VM.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List ISOs — ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      if (!isIsoLibraryConfigured()) {
        return { error: "No ISO library is configured (DOCKER_LIBRARY_PATH / ISO path unset)." };
      }
      const isos = await listLocalIsoFiles();
      return isos.map((i) => ({
        fileName: i.fileName,
        sizeLabel: i.sizeLabel,
        modifiedAt: i.modifiedAt,
      }));
    });
  },
});

// -- Users & groups (read-only, admin) --------------------------------------

registerTool({
  name: "list_users",
  category: "Access",
  klass: "read",
  returnsExternalContent: true,
  description:
    "List Tainer users (name, email, role, 2FA status, group membership, last-seen). Read-only. Requires manage-users. Use for 'who has access?', 'which users don't have 2FA?', 'when did X last sign in?'.",
  input_schema: { type: "object", additionalProperties: false, properties: {} },
  describe: () => "List Tainer users",
  execute: async () => {
    // listManagedUsers self-enforces requireSession + manage-users.
    const users = await listManagedUsers();
    return users.map((u) => ({
      name: u.name,
      email: u.email,
      role: u.role,
      hasTwoFactor: u.hasTwoFactor,
      groupCount: u.groupIds.length,
      activeSessions: u.activeSessionCount,
      lastSeenAt: u.lastSeenAt,
    }));
  },
});

registerTool({
  name: "list_groups",
  category: "Access",
  klass: "read",
  description:
    "List Tainer permission groups (name, whether admin, global permissions, how many sites they grant access to). Read-only. Requires manage-groups. Use for 'what groups exist?', 'which group grants admin?'.",
  input_schema: { type: "object", additionalProperties: false, properties: {} },
  describe: () => "List permission groups",
  execute: async (_args, ctx) => {
    requirePermission(ctx.session, "manage-groups");
    const groups = await listUserGroups();
    return groups.map((g) => ({
      name: g.name,
      isAdmin: g.isAdmin,
      globalPermissions: g.globalPermissions,
      siteAccessCount: g.siteAccess.length,
    }));
  },
});
