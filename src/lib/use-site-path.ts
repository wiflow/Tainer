"use client";

import { usePathname } from "next/navigation";

export function useSiteBasePath(): string {
  const pathname = usePathname();
  const match = pathname.match(/^\/sites\/([^/]+)/);
  return match ? `/sites/${match[1]}` : "";
}
