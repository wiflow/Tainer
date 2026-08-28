import "server-only";

import { requirePermission } from "@/lib/auth";
import { registerTool } from "@/lib/copilot/registry";
import { listAccessibleSites } from "@/lib/copilot/tools/helpers";
import { geocodeAddress } from "@/lib/geocode";
import { getSiteBySlug, updateSite } from "@/lib/site-store";

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
      locationAddress: s.location?.address ?? null,
    }));
  },
});

registerTool({
  name: "set_site_location",
  category: "Cluster",
  klass: "write",
  description:
    "Set a site's location on the overview map from a street address or place name (e.g. 'Ballerup, Denmark'). The address is geocoded server-side; coordinates are never entered by hand. Also sets the site's country flag when the address resolves one. Pass an empty address to clear the location.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      siteSlug: {
        type: "string",
        description: "Slug of the site to update (see list_sites).",
      },
      address: {
        type: "string",
        description: "Address or place name to geocode; empty string clears the location.",
      },
    },
    required: ["siteSlug", "address"],
  },
  describe: (args) => `Set location of ${String(args.siteSlug)} to "${String(args.address)}"`,
  execute: async (args, ctx) => {
    requirePermission(ctx.session, "manage-settings");

    const siteSlug = String(args.siteSlug ?? "");
    const address = String(args.address ?? "").trim();

    const site = await getSiteBySlug(siteSlug);
    if (!site) throw new Error(`Unknown site "${siteSlug}".`);

    if (!address) {
      await updateSite(site.id, { address: null, latitude: null, longitude: null });
      return { cleared: true, site: siteSlug };
    }

    const geo = await geocodeAddress(address);
    await updateSite(site.id, {
      address,
      countryCode: geo.countryCode ?? undefined,
      latitude: geo.latitude,
      longitude: geo.longitude,
    });

    return {
      site: siteSlug,
      address,
      resolved: geo.displayName,
      latitude: geo.latitude,
      longitude: geo.longitude,
      countryCode: geo.countryCode,
    };
  },
});
