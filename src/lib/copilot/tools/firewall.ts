import "server-only";

import {
  createClusterFirewallRule,
  deleteClusterFirewallRule,
  getClusterFirewallRules,
  withSiteConfig,
} from "@/lib/proxmox";
import { requireSitePermission } from "@/lib/auth";
import { registerTool } from "@/lib/copilot/registry";
import { resolveSiteForUser, runInSite, siteSlugSchema } from "@/lib/copilot/tools/helpers";
import {
  FIREWALL_ADDR_REGEX,
  FIREWALL_COMMENT_REGEX,
  FIREWALL_PORT_REGEX,
  FIREWALL_PROTO_REGEX,
} from "@/lib/proxmox-validation";

const RULE_FIELD_CHECKS = [
  ["proto", FIREWALL_PROTO_REGEX, "Invalid protocol."],
  ["dport", FIREWALL_PORT_REGEX, "Invalid destination port (use 443, 8000:8100, or a comma list)."],
  ["sport", FIREWALL_PORT_REGEX, "Invalid source port (use 443, 8000:8100, or a comma list)."],
  ["source", FIREWALL_ADDR_REGEX, "Invalid source address/CIDR."],
  ["dest", FIREWALL_ADDR_REGEX, "Invalid destination address/CIDR."],
  ["comment", FIREWALL_COMMENT_REGEX, "Comment contains unsupported characters."],
] as const;

registerTool({
  name: "list_firewall_rules",
  category: "Network",
  klass: "read",
  description:
    "List the cluster-level Proxmox firewall rules for a site (position, direction, action, protocol, ports, source/dest, enabled, comment). Use to answer 'what firewall rules are set?', 'is port 22 allowed?'. The position (pos) is needed to delete a rule.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List firewall rules for site ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const rules = (await getClusterFirewallRules()) as Array<Record<string, unknown>>;
      return rules.map((r, i) => ({
        pos: typeof r.pos === "number" ? r.pos : i,
        type: r.type ?? null,
        action: r.action ?? null,
        proto: r.proto ?? null,
        dport: r.dport ?? null,
        sport: r.sport ?? null,
        source: r.source ?? null,
        dest: r.dest ?? null,
        enable: r.enable ?? null,
        comment: r.comment ?? null,
      }));
    });
  },
});

registerTool({
  name: "add_firewall_rule",
  category: "Network",
  klass: "write",
  description:
    "Add a cluster-level Proxmox firewall rule. Specify direction (in/out), action (ACCEPT/DROP/REJECT), and optionally protocol, destination port, source/dest CIDR, and a comment. Requires manage-settings and manage-security. Example: allow inbound TCP 443 from anywhere → type=in, action=ACCEPT, proto=tcp, dport=443.",
  input_schema: siteSlugSchema({
    type: { type: "string", enum: ["in", "out"], description: "Direction." },
    action: {
      type: "string",
      enum: ["ACCEPT", "DROP", "REJECT"],
      description: "What to do with matching traffic.",
    },
    proto: { type: "string", description: "Protocol, e.g. tcp / udp / icmp. Optional." },
    dport: { type: "string", description: "Destination port or range, e.g. 443 or 8000:8100. Optional." },
    source: { type: "string", description: "Source CIDR/IP. Optional (any if omitted)." },
    dest: { type: "string", description: "Destination CIDR/IP. Optional." },
    comment: { type: "string", description: "Human-readable note. Optional." },
  }),
  describe: (args) =>
    `Add firewall rule: ${String(args.type)} ${String(args.action)}${args.proto ? ` ${String(args.proto)}` : ""}${args.dport ? ` dport ${String(args.dport)}` : ""}${args.sport ? ` sport ${String(args.sport)}` : ""} from ${args.source ? String(args.source) : "any"} to ${args.dest ? String(args.dest) : "any"} (site ${String(args.siteSlug)})`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const type = String(args.type ?? "");
    const action = String(args.action ?? "");
    if (!["in", "out"].includes(type)) throw new Error("type must be 'in' or 'out'.");
    if (!["ACCEPT", "DROP", "REJECT"].includes(action)) {
      throw new Error("action must be ACCEPT, DROP, or REJECT.");
    }
    const rule: Record<string, unknown> = { type, action, enable: 1 };
    for (const [key, regex, message] of RULE_FIELD_CHECKS) {
      const raw = args[key];
      if (raw === undefined || raw === null) continue;
      const v = key === "proto" ? String(raw).trim().toLowerCase() : String(raw).trim();
      if (!v) continue;
      if (!regex.test(v)) throw new Error(message);
      rule[key] = v;
    }

    const config = await resolveSiteForUser(ctx.session, siteSlug);
    requireSitePermission(ctx.session, config.siteId, "manage-settings");
    requireSitePermission(ctx.session, config.siteId, "manage-security");
    return withSiteConfig(config, async () => {
      await createClusterFirewallRule(rule);
      return {
        ok: true,
        message: `Firewall rule added: ${type} ${action}${rule.proto ? ` ${rule.proto}` : ""}${rule.dport ? ` dport ${rule.dport}` : ""}.`,
      };
    });
  },
});

registerTool({
  name: "delete_firewall_rule",
  category: "Network",
  klass: "destructive",
  description:
    "Delete a cluster-level Proxmox firewall rule by its position (pos, from list_firewall_rules). Destructive: removing an ACCEPT rule can cut off access, removing a DROP can open exposure. Requires manage-settings and manage-security, and typing the position number to confirm.",
  input_schema: siteSlugSchema({
    pos: { type: "integer", minimum: 0, description: "Rule position from list_firewall_rules." },
  }),
  describe: (args) => `DELETE firewall rule at position ${String(args.pos)} (site ${String(args.siteSlug)})`,
  confirmString: (args) => String(args.pos ?? ""),
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    const pos = Number(args.pos);
    if (!Number.isInteger(pos) || pos < 0) throw new Error("pos must be a non-negative integer.");
    const config = await resolveSiteForUser(ctx.session, siteSlug);
    requireSitePermission(ctx.session, config.siteId, "manage-settings");
    requireSitePermission(ctx.session, config.siteId, "manage-security");
    return withSiteConfig(config, async () => {
      await deleteClusterFirewallRule(pos);
      return { ok: true, message: `Firewall rule at position ${pos} deleted.` };
    });
  },
});
