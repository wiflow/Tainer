"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import Cookies from "js-cookie";
import { AnimatePresence, motion } from "framer-motion";

import {
  Activity,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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

/**
 * Collapsed-state context. Avoids prop-drilling `collapsed` down to every
 * NavLink + NavSection. AppSidebar wraps its content in a Provider.
 */
const SidebarCollapsedContext = createContext(false);
function useSidebarCollapsed() {
  return useContext(SidebarCollapsedContext);
}

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
  // Desktop sidebar collapse state. Persists in localStorage so refresh
  // remembers it. Initial value is `false` for SSR consistency; the real
  // stored value is loaded after mount in the effect below.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("tainer_sidebar_collapsed") === "1") {
        setCollapsed(true);
      }
    } catch {
      /* ignore — private mode etc. */
    }
  }, []);

  // Sync the collapsed width to a CSS variable on <html> so the main content
  // padding (in app/layout.tsx) tracks the sidebar width without prop
  // drilling. 240px expanded, 64px collapsed = just enough for icons.
  useEffect(() => {
    const width = collapsed ? 64 : 240;
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  }, [collapsed]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("tainer_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }
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

        {/* ── Brand header ── */}
        <div className="mb-3 flex items-center gap-2 px-1">
          <Image
            alt="Tainer"
            className="rounded-md"
            height={28}
            priority
            src="/logo.png"
            width={28}
          />
          {!collapsed && (
            <span className="font-display text-[15px] font-semibold tracking-wide text-zinc-100">
              Tainer
            </span>
          )}
          <div className="flex-1" />
          {/* Mobile close button (collapse toggle replaces it on desktop) */}
          <button
            aria-label="Close navigation menu"
            className="shrink-0 flex items-center justify-center w-8 h-8 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer lg:hidden"
            onClick={() => setMobileOpen(false)}
            type="button"
          >
            <X className="w-4 h-4" />
          </button>
          {/* Desktop collapse toggle */}
          <button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden shrink-0 lg:flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            type="button"
          >
            {collapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronLeft className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* ── Overview (top-level, separate from sectioned nav) ── */}
        <nav className="mb-4">
          <NavLink
            active={pathname === "/"}
            href="/"
            icon={MapIcon}
            label="Overview"
          />
        </nav>

        {/* Site Switcher — hidden in collapsed mode (no room for the name).
            Users expand to change sites; the active-site state is preserved
            via the `tainer_site` cookie. */}
        {sites.length > 0 && !collapsed && (
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

        {/* Sectioned nav. Each section auto-expands when its current route is
            active; otherwise the user's last collapsed/expanded state from
            localStorage wins. Default-open for first-time visitors is
            controlled per-section below. */}
        <nav className="flex flex-col gap-3 mb-4">
          {/* Workloads — primary day-to-day flow */}
          <NavSection
            defaultOpen={
              (effectiveSlug && pathname === `/sites/${effectiveSlug}`) ||
              isActive("/deployments") ||
              isActive("/backups") ||
              isActive("/tags") ||
              true /* default open on first visit */
            }
            id="workloads"
            label="Workloads"
          >
            <NavLink
              active={effectiveSlug ? pathname === `/sites/${effectiveSlug}` : false}
              href={effectiveSlug ? `/sites/${effectiveSlug}` : "/"}
              icon={Home}
              label="Dashboard"
            />
            <NavLink
              active={isActive("/deployments")}
              href={effectiveSlug ? `/sites/${effectiveSlug}/deployments` : "/deployments"}
              icon={RefreshCw}
              label="Deployments"
            />
            <NavLink
              active={isActive("/backups")}
              href={effectiveSlug ? `/sites/${effectiveSlug}/backups` : "/backups"}
              icon={ShieldCheck}
              label="Backups"
            />
            <NavLink
              active={isActive("/tags")}
              href={effectiveSlug ? `/sites/${effectiveSlug}/tags` : "/tags"}
              icon={Tags}
              label="Tags"
            />
          </NavSection>

          {/* Reliability — alerts + monitoring + security scans */}
          <NavSection
            defaultOpen={
              isActive("/alerts") ||
              pathname.startsWith("/heartbeat") ||
              isActive("/node-configs") ||
              isActive("/cve-scanner") ||
              isActive("/load-balancer")
            }
            id="reliability"
            label="Reliability"
          >
            <NavLink
              active={isActive("/alerts")}
              href={effectiveSlug ? `/sites/${effectiveSlug}/alerts` : "/alerts"}
              icon={Bell}
              label="Alerts"
            />
            {currentUser.role === "admin" && (
              <NavLink
                active={pathname.startsWith("/heartbeat")}
                href="/heartbeat"
                icon={Activity}
                label="Heartbeat"
              />
            )}
            <NavLink
              active={isActive("/node-configs")}
              href={effectiveSlug ? `/sites/${effectiveSlug}/node-configs` : "/node-configs"}
              icon={Settings2}
              label="Node Configs"
            />
            <NavLink
              active={isActive("/cve-scanner")}
              href={effectiveSlug ? `/sites/${effectiveSlug}/cve-scanner` : "/cve-scanner"}
              icon={ShieldAlert}
              label="CVE Scanner"
            />
            {currentUser.role === "admin" && (
              <NavLink
                active={isActive("/load-balancer")}
                href={effectiveSlug ? `/sites/${effectiveSlug}/load-balancer` : "/load-balancer"}
                icon={Scale}
                label="Load Balancer"
              />
            )}
          </NavSection>

          {/* Library — templates and images, used while creating new things */}
          <NavSection
            defaultOpen={
              isActive("/templates") || isActive("/images") || isActive("/iso-images")
            }
            id="library"
            label="Library"
          >
            <NavLink
              active={isActive("/templates")}
              href={effectiveSlug ? `/sites/${effectiveSlug}/templates` : "/templates"}
              icon={FileBox}
              label="Templates"
            />
            <NavLink
              active={isActive("/images")}
              href={effectiveSlug ? `/sites/${effectiveSlug}/images` : "/images"}
              icon={Database}
              label="Images"
            />
            <NavLink
              active={isActive("/iso-images")}
              href={effectiveSlug ? `/sites/${effectiveSlug}/iso-images` : "/iso-images"}
              icon={Disc3}
              label="ISOs"
            />
          </NavSection>

          {/* Access — admin-only management. Hide the section entirely for
              non-admins so they don't see an empty header. */}
          {currentUser.role === "admin" && (
            <NavSection
              defaultOpen={
                pathname.startsWith("/users") ||
                pathname.startsWith("/groups") ||
                pathname.startsWith("/identity-providers") ||
                pathname.startsWith("/audit-log") ||
                pathname === "/sites"
              }
              id="access"
              label="Access"
            >
              <NavLink
                active={pathname.startsWith("/users")}
                href="/users"
                icon={Users}
                label="Users"
              />
              <NavLink
                active={pathname.startsWith("/groups")}
                href="/groups"
                icon={FolderOpen}
                label="Groups"
              />
              <NavLink
                active={pathname.startsWith("/identity-providers")}
                href="/identity-providers"
                icon={KeyRound}
                label="Identity Providers"
              />
              <NavLink
                active={pathname.startsWith("/audit-log")}
                href="/audit-log"
                icon={ScrollText}
                label="Audit Log"
              />
              <NavLink
                active={pathname === "/sites"}
                href="/sites"
                icon={Globe}
                label="Site Manager"
              />
            </NavSection>
          )}

          {/* Groups available to non-admins too. Show as a small flat link
              under the sectioned nav rather than a one-item section. */}
          {currentUser.role !== "admin" && (
            <NavLink
              active={pathname.startsWith("/groups")}
              href="/groups"
              icon={FolderOpen}
              label="Groups"
            />
          )}
        </nav>

      </div>

      {/* Bottom Nav — flex-row when expanded (avatar + name + actions),
          stacked column when collapsed (just the icons, vertically). */}
      <div className="p-3 border-t border-white/5">
        <div
          className={cn(
            "px-1 py-1",
            collapsed
              ? "flex flex-col items-center gap-1"
              : "flex items-center gap-3 px-3 py-2",
          )}
        >
          <div
            className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 border border-white/10 text-[11px] font-bold text-zinc-400 shrink-0"
            title={collapsed ? `${currentUser.name} (${currentUser.role})` : undefined}
          >
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-zinc-200 truncate">{currentUser.name}</p>
              <p className="text-[11px] text-zinc-400 truncate">{currentUser.role} · v{version}</p>
            </div>
          )}
          <IntentLink
            aria-label="Account settings"
            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer"
            href="/account"
            title={collapsed ? "Account settings" : undefined}
          >
            <Settings className="w-4 h-4" />
          </IntentLink>
          <Form action={signOutAction}>
            <button
              aria-label="Sign out"
              className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer"
              title={collapsed ? "Sign out" : undefined}
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

      {/* Mobile sidebar — always full width regardless of desktop collapse */}
      <SidebarCollapsedContext.Provider value={false}>
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 w-[280px] border-r border-white/5 bg-[#0a0a0a] flex flex-col transition-transform duration-300 ease-out lg:hidden",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
          aria-label="Main navigation"
        >
          {sidebarContent}
        </aside>
      </SidebarCollapsedContext.Provider>

      {/* Desktop sidebar — width tracks `collapsed` state via inline style.
          The CSS var --sidebar-width is also written to <html> so the main
          content padding in app/layout.tsx tracks it without prop drilling. */}
      <SidebarCollapsedContext.Provider value={collapsed}>
        <aside
          aria-label="Main navigation"
          className={cn(
            "hidden fixed inset-y-0 left-0 z-30 border-r border-white/5 bg-[#0a0a0a] lg:flex lg:flex-col transition-[width] duration-200 ease-out",
          )}
          style={{ width: collapsed ? 64 : 240 }}
        >
          {sidebarContent}
        </aside>
      </SidebarCollapsedContext.Provider>
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
  const collapsed = useSidebarCollapsed();
  return (
    <IntentLink
      href={href}
      className={cn(
        "flex items-center rounded-md text-[13px] font-medium transition-colors cursor-pointer",
        // In collapsed mode: centre the icon, square hit-box, native tooltip
        // shows the label on hover so users can still identify the icon.
        collapsed ? "justify-center h-9 w-9 mx-auto" : "gap-3 px-3 py-2",
        active
          ? "bg-white/10 text-white"
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
      )}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && label}
    </IntentLink>
  );
}

/**
 * Collapsible nav section. Header is a button with a chevron that rotates
 * 180° when expanded. Body slides open/closed via framer-motion height
 * animation, kept short (160ms) so it feels responsive, not animated-for-the-
 * sake-of-animation.
 *
 * State is persisted in localStorage keyed by `id`, so refreshing remembers
 * what the user had open. The section is also auto-expanded if it contains
 * the active route — the caller passes `defaultOpen` for that.
 */
function NavSection({
  children,
  defaultOpen,
  id,
  label,
}: {
  children: React.ReactNode;
  defaultOpen: boolean;
  id: string;
  label: string;
}) {
  const collapsed = useSidebarCollapsed();
  const storageKey = `tainer_nav_section_${id}`;

  // When the sidebar itself is collapsed, sections lose their headers and
  // animations — there's no room for them. Just render the items as a flat
  // group with a thin divider so categories are still visually grouped.
  if (collapsed) {
    return (
      <div className="flex flex-col gap-1 border-t border-white/[0.04] pt-2 first:border-t-0 first:pt-0">
        {children}
      </div>
    );
  }

  // Initial state must match server-render (defaultOpen) to avoid hydration
  // mismatch. localStorage value is read in an effect after mount.
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "1") setOpen(true);
      else if (stored === "0") setOpen(false);
      // If not stored, keep defaultOpen.
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [storageKey]);

  // Re-open the section whenever the active route falls inside it (e.g.
  // user clicks a link that's collapsed via search/cmd-k). defaultOpen
  // changing is the signal.
  useEffect(() => {
    if (defaultOpen && !open) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpen]);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col">
      <button
        aria-expanded={open}
        className="group mb-1 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.16em] text-zinc-500 transition-colors hover:text-zinc-300"
        onClick={toggle}
        type="button"
      >
        <span>{label}</span>
        <motion.span
          animate={{ rotate: open ? 0 : -90 }}
          className="text-zinc-600 group-hover:text-zinc-400"
          initial={false}
          transition={{ duration: 0.16 }}
        >
          <ChevronDown className="h-3 w-3" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={hydrated ? { height: 0, opacity: 0 } : false}
            key="body"
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <div className="flex flex-col gap-0.5 pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
