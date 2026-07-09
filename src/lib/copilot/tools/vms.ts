import "server-only";

import { listVmTemplates } from "@/lib/vm-templates";
import { registerTool } from "@/lib/copilot/registry";
import { runInSite, siteSlugSchema } from "@/lib/copilot/tools/helpers";

registerTool({
  name: "list_vm_templates",
  category: "Templates",
  klass: "read",
  description:
    "List the QEMU/KVM VM templates configured for a site (name, cores, memory, disk, bridge, node). VMs are created from these via the create-VM page — for 'create a VM' point the user there with open_page to /sites/<siteSlug>/deployments/create-vm-from-template, since VM creation needs ISO/cloud-init choices the UI collects. This tool answers 'what VM templates exist?' and surfaces their defaults.",
  input_schema: siteSlugSchema(),
  describe: (args) => `List VM templates for site ${String(args.siteSlug)}`,
  execute: async (args, ctx) => {
    const siteSlug = String(args.siteSlug ?? "");
    return runInSite(ctx.session, siteSlug, async () => {
      const templates = await listVmTemplates();
      return templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        cores: t.cores,
        memory: t.memory,
        diskSize: t.diskSize,
        diskStorage: t.diskStorage,
        bridge: t.bridge,
        node: t.node,
        cloudInitCapable: t.cloudInitCapable,
      }));
    });
  },
});
