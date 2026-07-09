import "server-only";

import { getTemplateInventory } from "@/lib/proxmox";
import { listDeploymentTemplates } from "@/lib/deployment-templates";
import { registerTool } from "@/lib/copilot/registry";
import { runInSite, siteSlugSchema } from "@/lib/copilot/tools/helpers";

registerTool({
  name: "list_templates",
  category: "Templates",
  klass: "read",
  description:
    "List OS templates (LXC root filesystem tarballs) available on a site's nodes. These are the base images used when creating containers.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List OS templates in site ${args.siteSlug}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const { templates } = await getTemplateInventory();
      return templates.map((t) => ({
        id: t.id,
        name: t.name,
        node: t.node,
        storage: t.storage,
        sizeLabel: t.sizeLabel,
        fileName: t.fileName,
        createdAt: t.createdAt,
      }));
    });
  },
});

registerTool({
  name: "list_deployment_templates",
  category: "Templates",
  klass: "read",
  description:
    "List user-defined deployment templates for a site (curated launch presets for containers — preset image + resources + env vars). Different from list_templates which is raw OS templates. Deployment templates are stored per-site.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List deployment templates in site ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const templates = await listDeploymentTemplates();
      return templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        sourceName: t.sourceName,
        cores: t.cores,
        memory: t.memory,
        rootfsSize: t.rootfsSize,
        node: t.node,
      }));
    });
  },
});
