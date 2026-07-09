import "server-only";

import { registerTool } from "@/lib/copilot/registry";
import { listAccessibleSites } from "@/lib/copilot/tools/helpers";

registerTool({
  name: "list_sites",
  category: "Cluster",
  klass: "read",
  description:
    "List Proxmox sites/clusters the current user has access to. Use the returned slug for other tools' siteSlug argument.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: [],
  },
  describe: () => "List accessible sites",
  execute: async (_args, ctx) => {
    const sites = await listAccessibleSites(ctx.session);
    return sites.map((s) => ({
      slug: s.slug,
      name: s.name,
      enabled: s.enabled,
      healthy: s.lastValidationOk,
      countryCode: s.countryCode,
    }));
  },
});
