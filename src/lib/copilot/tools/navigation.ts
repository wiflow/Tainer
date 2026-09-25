import "server-only";

import { registerTool } from "@/lib/copilot/registry";

function validateInternalPath(raw: string): string {
  const path = raw.trim();
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("path must be an internal path starting with '/'.");
  }
  if (/^\/api(\/|$)/.test(path)) {
    throw new Error("API routes are not navigable pages.");
  }
  if (path.includes("://") || /[\n\r\\]/.test(path)) {
    throw new Error("path contains invalid characters.");
  }
  return path;
}

registerTool({
  name: "open_page",
  category: "Navigation",
  klass: "read",
  description:
    "Navigate the user's browser to a Tainer page. Use when the user says 'take me to', 'open', 'go to', or 'show me' a page or entity. Useful targets: '/sites/<siteSlug>/deployments/<deploymentId>' (container/VM detail, use the id from list_containers), '/sites/<siteSlug>/deployments' (all deployments in a site), '/sites/<siteSlug>/network' (IP pools and the phpIPAM integration), '/sites/<siteSlug>/templates', '/sites/<siteSlug>/backups', '/settings', '/audit-log' (admin), '/users' (admin). Runs immediately, so pair it with a short confirmation like 'Taking you there.'",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        description: "Internal app path starting with '/', e.g. /deployments/abc123.",
      },
    },
    required: ["path"],
  },
  describe: (args) => `Open ${String(args.path)}`,
  execute: async (args) => {
    const path = validateInternalPath(String(args.path ?? ""));
    return { ok: true, navigate: path };
  },
});
