"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Cookies from "js-cookie";

import {
  Activity,
  Box,
  ChevronDown,
  Database,
  Disc3,
  FileBox,
  FolderOpen,
  HelpCircle,
  Home,
  KeyRound,
  LogOut,
  ScrollText,
  Mail,
  Menu,
  MoreHorizontal,
  RefreshCw,
  Scale,
  Search,
  Settings,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Users,
  WifiOff,
  Bell,
  Globe,
  MapIcon,
  X,
} from "lucide-react";

import { signOutAction } from "@/app/auth-actions";
import type { SessionUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import Form from "next/form";

import { IntentLink } from "./intent-link";

type SiteInfo = {
  id: string;
  slug: string;
  name: string;
  healthy: boolean | null;
};

function getSiteHealth(site: SiteInfo) {
  if (site.healthy === true) return "connected";
  if (site.healthy === false) return "unreachable";
  return "unknown";
}

function healthDot(site: SiteInfo, size: "sm" | "md" = "sm") {
  const health = getSiteHealth(site);
  const px = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";

  return (
    <span
      className={cn(
        px,
        "shrink-0 rounded-full",
        health === "connected"
          ? "bg-emerald-500"
          : health === "unreachable"
            ? "bg-rose-500"
            : "bg-zinc-600",
      )}
    />
  );
}

export function AppSidebar({
  currentUser,
  version,
  sites,
}: {
  currentUser: SessionUser;
  version: string;
  sites: SiteInfo[];
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Resolve the active site:
  //   1. URL path (when on a /sites/{slug}/... page) — most authoritative.
  //   2. `tainer_site` cookie (last site the user visited) — preserves the
  //      site selection across global admin pages (Users, Audit Log, etc.)
  //      so coming back to a per-site page goes back to the same site
  //      instead of jumping to whatever sites[0] happens to be.
  //   3. First site as a final fallback.
  const pathSlug = pathname.match(/^\/sites\/([^/]+)/)?.[1] ?? "";
  const cookieSlug = Cookies.get("tainer_site") ?? "";
  const siteSlug =
    pathSlug ||
    (sites.some((s) => s.slug === cookieSlug) ? cookieSlug : "") ||
    sites[0]?.slug ||
    "";
  const effectiveSlug = siteSlug;

  // Persist the active site whenever the URL tells us which one it is, so
  // navigating to a global page later still remembers where the user was.
  useEffect(() => {
    if (pathSlug && pathSlug !== Cookies.get("tainer_site")) {
      Cookies.set("tainer_site", pathSlug, { path: "/", expires: 365 });
    }
  }, [pathSlug]);

  const currentSite = sites.find((s) => s.slug === effectiveSlug) ?? sites[0];
  const currentSiteHealth = currentSite ? getSiteHealth(currentSite) : "unknown";

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const switcherRef = useRef<HTMLDivElement>(null);
  const toggleClickedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (toggleClickedRef.current) {
        toggleClickedRef.current = false;
        return;
      }
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    if (switcherOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [switcherOpen]);

  const filteredSites = sites.filter((site) =>
    site.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  useEffect(() => {
    if (!effectiveSlug) return;
    const prefix = `/sites/${effectiveSlug}`;
    const routes = [
      prefix,
      `${prefix}/deployments`,
      `${prefix}/backups`,
      `${prefix}/alerts`,
      `${prefix}/node-configs`,
      `${prefix}/templates`,
      `${prefix}/images`,
      `${prefix}/iso-images`,
      `${prefix}/load-balancer`,
      `${prefix}/settings`,
    ];
    const timer = setTimeout(() => {
      for (const route of routes) {
        router.prefetch(route);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [effectiveSlug, router]);

  useEffect(() => {
    setMobileOpen(false);
    setSwitcherOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const handleSiteSwitch = (slug: string) => {
    Cookies.set("tainer_site", slug, { path: "/" });
    router.push(`/sites/${slug}`);
    setSwitcherOpen(false);
    setSearchQuery("");
  };

  const isActive = (path: string) => {
    if (!effectiveSlug) return false;
    const href = `/sites/${effectiveSlug}${path}`;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const initials = currentUser.name.slice(0, 2).toUpperCase();

  const sidebarContent = (
    <>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 py-4">

        <div className="flex items-center gap-1 mb-4">
          <nav className="flex-1">
            <NavLink icon={MapIcon} label="Overview" active={pathname === "/"} href="/" />
          </nav>
          <button
            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            type="button"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Site Switcher */}
        {sites.length > 0 && (
          <div className="relative mb-2" ref={switcherRef}>
            <div className="flex items-center gap-1">
              <button
                className="flex flex-1 min-w-0 items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-left text-[13px] font-medium text-white transition-colors hover:bg-white/10 cursor-pointer"
                onClick={() => { toggleClickedRef.current = true; setSwitcherOpen((prev) => !prev); }}
                aria-label={`Switch site, current: ${currentSite?.name ?? "No site"}`}
                aria-expanded={switcherOpen}
                type="button"
              >
                <div className="flex items-center justify-center p-1 rounded-md bg-white/10 shrink-0">
                  <Box className="w-4 h-4 text-white p-0.5" />
                </div>
                <span className="min-w-0 flex-1 truncate">
                  {currentSite?.name ?? "No site"}
                </span>
                {healthDot(currentSite ?? { slug: "", name: "", healthy: null }, "sm")}
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform", switcherOpen && "rotate-180")} />
              </button>
              <IntentLink
                href={effectiveSlug ? `/sites/${effectiveSlug}/settings` : "/settings"}
                className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer"
                aria-label="Site settings"
              >
                <Settings className="w-4 h-4" />
              </IntentLink>
            </div>

            {switcherOpen && sites.length > 1 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1.5 rounded-xl border border-white/[0.08] bg-zinc-900/95 backdrop-blur-xl shadow-2xl shadow-black/40 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                {sites.length > 3 && (
                  <div className="border-b border-white/[0.06] px-3 py-2.5">
                    <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5">
                      <Search className="h-3 w-3 text-zinc-500 shrink-0" />
                      <input
                        ref={searchInputRef}
                        className="w-full bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-500"
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search sites..."
                        type="text"
                        value={searchQuery}
                      />
                    </div>
                  </div>
                )}
                <div className="px-1.5 py-1.5">
                  <p className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Sites</p>
                </div>
                <div className="max-h-[240px] overflow-y-auto px-1.5 pb-1.5">
                  {filteredSites.map((site) => {
                    const isCurrentSite = site.slug === effectiveSlug;
                    return (
                      <button
                        key={site.slug}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors",
                          isCurrentSite
                            ? "bg-white/[0.08] text-white"
                            : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200",
                        )}
                        onClick={(e) => { e.stopPropagation(); handleSiteSwitch(site.slug); }}
                        type="button"
                      >
                        {healthDot(site, "md")}
                        <span className="min-w-0 flex-1 truncate font-medium">{site.name}</span>
                        {isCurrentSite && (
                          <span className="text-[10px] text-zinc-500">Current</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Unavailable banner for current site */}
        {effectiveSlug && currentSiteHealth === "unreachable" && (
          <div className="mx-2 mb-4 flex items-center gap-2 rounded-md border border-rose-500/10 bg-rose-500/5 px-3 py-2">
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-rose-400/60" />
            <span className="text-[11px] text-rose-400/80">Site unreachable</span>
          </div>
        )}

        {/* Main Nav */}
        <nav className="flex flex-col gap-0.5 mb-8">
          <NavLink icon={Home} label="Dashboard" active={effectiveSlug ? pathname === `/sites/${effectiveSlug}` : false} href={effectiveSlug ? `/sites/${effectiveSlug}` : "/"} />
          <NavLink icon={RefreshCw} label="Deployments" active={isActive("/deployments")} href={effectiveSlug ? `/sites/${effectiveSlug}/deployments` : "/deployments"} />
          <NavLink icon={ShieldCheck} label="Backups" active={isActive("/backups")} href={effectiveSlug ? `/sites/${effectiveSlug}/backups` : "/backups"} />
          <NavLink icon={Bell} label="Alerts" active={isActive("/alerts")} href={effectiveSlug ? `/sites/${effectiveSlug}/alerts` : "/alerts"} />
          {currentUser.role === "admin" && (
            <NavLink icon={Activity} label="Heartbeat" active={pathname.startsWith("/heartbeat")} href="/heartbeat" />
          )}
          <NavLink icon={Settings2} label="Node Configs" active={isActive("/node-configs")} href={effectiveSlug ? `/sites/${effectiveSlug}/node-configs` : "/node-configs"} />
          <NavLink icon={ShieldAlert} label="CVE Scanner" active={isActive("/cve-scanner")} href={effectiveSlug ? `/sites/${effectiveSlug}/cve-scanner` : "/cve-scanner"} />
          {currentUser.role === "admin" && (
            <NavLink icon={Scale} label="Load Balancer" active={isActive("/load-balancer")} href={effectiveSlug ? `/sites/${effectiveSlug}/load-balancer` : "/load-balancer"} />
          )}
        </nav>

        <div className="mb-2 px-3 text-[11px] font-medium text-zinc-500 uppercase tracking-widest">Library</div>
        <nav className="flex flex-col gap-0.5 mb-auto">
          <NavLink icon={FileBox} label="Templates" active={isActive("/templates")} href={effectiveSlug ? `/sites/${effectiveSlug}/templates` : "/templates"} />
          <NavLink icon={Database} label="Images" active={isActive("/images")} href={effectiveSlug ? `/sites/${effectiveSlug}/images` : "/images"} />
          <NavLink icon={Disc3} label="ISOs" active={isActive("/iso-images")} href={effectiveSlug ? `/sites/${effectiveSlug}/iso-images` : "/iso-images"} />
        </nav>

        <div className="mx-2 my-4 border-t border-white/5" />
        <nav className="flex flex-col gap-0.5 mb-4">
          <NavLink icon={Tags} label="Tags" active={isActive("/tags")} href={effectiveSlug ? `/sites/${effectiveSlug}/tags` : "/tags"} />
          <NavLink icon={FolderOpen} label="Groups" active={pathname.startsWith("/groups")} href="/groups" />
          {currentUser.role === "admin" && (
            <>
              <NavLink icon={Users} label="Users" active={pathname.startsWith("/users")} href="/users" />
              <NavLink icon={KeyRound} label="Identity Providers" active={pathname.startsWith("/identity-providers")} href="/identity-providers" />
              <NavLink icon={ScrollText} label="Audit Log" active={pathname.startsWith("/audit-log")} href="/audit-log" />
              <NavLink icon={Globe} label="Site Manager" active={pathname === "/sites"} href="/sites" />
            </>
          )}
        </nav>

      </div>

      {/* Bottom Nav */}
      <div className="p-3 border-t border-white/5">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 border border-white/10 text-[11px] font-bold text-zinc-400 shrink-0">
             {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-zinc-200 truncate">{currentUser.name}</p>
            <p className="text-[11px] text-zinc-400 truncate">{currentUser.role} · v{version}</p>
          </div>
          <IntentLink
            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer"
            href="/account"
            aria-label="Account settings"
          >
            <Settings className="w-4 h-4" />
          </IntentLink>

          <Form action={signOutAction}>
            <button
              className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer"
              aria-label="Sign out"
              type="submit"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </Form>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className="fixed top-4 left-4 z-50 flex items-center justify-center w-10 h-10 rounded-lg border border-white/10 bg-zinc-900/90 text-zinc-300 backdrop-blur transition-colors hover:bg-zinc-800 hover:text-white cursor-pointer lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        type="button"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] border-r border-white/5 bg-[#0a0a0a] flex flex-col transition-transform duration-300 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className="hidden fixed inset-y-0 left-0 z-30 border-r border-white/5 bg-[#0a0a0a] lg:flex lg:w-[240px] lg:flex-col"
        aria-label="Main navigation"
      >
        {sidebarContent}
      </aside>
    </>
  );
}

function NavLink({
  icon: Icon,
  label,
  active,
  href,
}: {
  icon: any;
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <IntentLink
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer",
        active
          ? "bg-white/10 text-white"
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="w-4 h-4" />
      {label}
    </IntentLink>
  );
}
