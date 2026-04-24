"use client";

import { usePathname } from "next/navigation";

/**
 * Returns the site-scoped base path prefix for building links.
 *
 * When on `/sites/f25-lab/deployments`, returns `/sites/f25-lab`.
 * When on `/deployments` (no site prefix), returns an empty string
 * so that `${prefix}/deployments/123` falls back to `/deployments/123`.
 */
export function useSiteBasePath(): string {
  const pathname = usePathname();
  const match = pathname.match(/^\/sites\/([^/]+)/);
  return match ? `/sites/${match[1]}` : "";
}
