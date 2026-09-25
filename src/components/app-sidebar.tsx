"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import Cookies from "js-cookie";
import { AnimatePresence, motion } from "framer-motion";

import {
  Activity,
  Box,
  Cable,
  ChevronDown,
  Database,
  Disc3,
  FileBox,
  FolderOpen,
  Home,
  KeyRound,
  LogOut,
  ScrollText,
  Menu,
  Plug,
  RefreshCw,
  Scale,
  Search,
  Settings,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
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
import { normalizeCountryCode } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { formatBuildTag } from "@/lib/version";
import Form from "next/form";

import { IntentLink } from "./intent-link";

type SiteInfo = {
  id: string;
  slug: string;
  name: string;
  healthy: boolean | null;
  countryCode: string | null;
};

function SiteAvatar({ site }: { site: SiteInfo | null | undefined }) {
  const code = normalizeCountryCode(site?.countryCode ?? null);
  if (code) {
    const lower = code.toLowerCase();
    return (
      <div
        className="flex items-center justify-center w-6 h-6 rounded-md bg-white/10 shrink-0 overflow-hidden"
        title={code}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={`${code} flag`}
          className="h-full w-full object-cover"
          height={24}
          loading="lazy"
          src={`https://flagcdn.com/${lower}.svg`}
          width={24}
        />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center p-1 rounded-md bg-white/10 shrink-0">
      <Box className="w-4 h-4 text-white p-0.5" />
    </div>
  );
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

type NavItem = {
  path: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  exact?: boolean;
  adminOnly?: boolean;
};

type NavItemGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const SITE_SECTIONS: NavItemGroup[] = [
  {
    id: "workloads",
    label: "Workloads",
    items: [
      { path: "", icon: Home, label: "Dashboard", exact: true },
      { path: "/deployments", icon: RefreshCw, label: "Deployments" },
      { path: "/backups", icon: ShieldCheck, label: "Backups" },
      { path: "/tags", icon: Tags, label: "Tags" },
    ],
  },
  {
    id: "reliability",
    label: "Reliability",
    items: [
      { path: "/alerts", icon: Bell, label: "Alerts" },
      { path: "/node-configs", icon: Settings2, label: "Node Configs" },
      { path: "/network", icon: Cable, label: "Network" },
      { path: "/cve-scanner", icon: ShieldAlert, label: "CVE Scanner" },
      { path: "/load-balancer", icon: Scale, label: "Load Balancer", adminOnly: true },
    ],
  },
  {
    id: "library",
    label: "Library",
    items: [
      { path: "/templates", icon: FileBox, label: "Templates" },
      { path: "/images", icon: Database, label: "Images" },
      { path: "/iso-images", icon: Disc3, label: "ISOs" },
    ],
  },
];

const SITE_SETTINGS_ITEM: NavItem = { path: "/settings", icon: Settings, label: "Site settings" };

const GROUPS_ITEM: NavItem = { path: "/groups", icon: FolderOpen, label: "Groups" };

const GLOBAL_SECTIONS: NavItemGroup[] = [
  {
    id: "platform",
    label: "Platform",
    items: [
      { path: "/sites", icon: Globe, label: "Sites", exact: true },
      { path: "/heartbeat", icon: Activity, label: "Heartbeat" },
      { path: "/integrations", icon: Plug, label: "Integrations" },
      { path: "/settings/copilot", icon: Sparkles, label: "Tainy settings", exact: true },
      { path: "/audit-log", icon: ScrollText, label: "Audit Log" },
    ],
  },
  {
    id: "access",
    label: "Access",
    items: [
      { path: "/users", icon: Users, label: "Users" },
      GROUPS_ITEM,
      { path: "/identity-providers", icon: KeyRound, label: "Identity Providers" },
    ],
  },
];

const PREFETCH_PATHS = [
  "",
  "/deployments",
  "/backups",
  "/alerts",
  "/node-configs",
  "/network",
  "/templates",
  "/images",
  "/iso-images",
  "/load-balancer",
  "/settings",
];

function getPathSlug(pathname: string) {
  return pathname.match(/^\/sites\/([^/]+)/)?.[1] ?? "";
}

function resolveSiteSlug(pathSlug: string, sites: SiteInfo[]) {
  const cookieSlug = Cookies.get("tainer_site") ?? "";
  return (
    pathSlug ||
    (sites.some((s) => s.slug === cookieSlug) ? cookieSlug : "") ||
    sites[0]?.slug ||
    ""
  );
}

function siteHref(siteSlug: string, path: string) {
  return siteSlug ? `/sites/${siteSlug}${path}` : path || "/";
}

function isSiteItemActive(pathname: string, siteSlug: string, item: NavItem) {
  if (!siteSlug) return false;
  const href = `/sites/${siteSlug}${item.path}`;
  return pathname === href || (!item.exact && pathname.startsWith(`${href}/`));
}

function isGlobalItemActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.path : pathname.startsWith(item.path);
}

function dispatchShortcut(key: string) {
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, metaKey: true }));
}

function useSiteCookie(pathSlug: string) {
  useEffect(() => {
    if (pathSlug && pathSlug !== Cookies.get("tainer_site")) {
      Cookies.set("tainer_site", pathSlug, { path: "/", expires: 365 });
    }
  }, [pathSlug]);
}

function useSiteSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleClickedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (toggleClickedRef.current) {
        toggleClickedRef.current = false;
        return;
      }
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [open]);

  function toggle() {
    toggleClickedRef.current = true;
    setOpen((prev) => !prev);
  }

  function select(slug: string) {
    Cookies.set("tainer_site", slug, { path: "/" });
    router.push(`/sites/${slug}`);
    setOpen(false);
    setQuery("");
  }

  return { open, setOpen, query, setQuery, rootRef, searchInputRef, toggle, select };
}

type SiteSwitcherState = Omit<ReturnType<typeof useSiteSwitcher>, "rootRef" | "searchInputRef">;

function usePrefetchSiteRoutes(siteSlug: string) {
  const router = useRouter();

  useEffect(() => {
    if (!siteSlug) return;
    const timer = setTimeout(() => {
      for (const path of PREFETCH_PATHS) {
        router.prefetch(`/sites/${siteSlug}${path}`);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [siteSlug, router]);
}

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (locked) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [locked]);
}

export function AppSidebar({
  currentUser,
  version,
  latestVersion,
  updateAvailable,
  buildTag,
  sites,
}: {
  currentUser: SessionUser;
  version: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  buildTag: string | null;
  sites: SiteInfo[];
}) {
  const pathname = usePathname();
  const pathSlug = getPathSlug(pathname);
  const siteSlug = resolveSiteSlug(pathSlug, sites);

  useSiteCookie(pathSlug);

  const currentSite = sites.find((s) => s.slug === siteSlug) ?? sites[0];
  const currentSiteHealth = currentSite ? getSiteHealth(currentSite) : "unknown";
  const isAdmin = currentUser.role === "admin";

  const { rootRef, searchInputRef, ...switcher } = useSiteSwitcher();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
    switcher.setOpen(false);
  }

  usePrefetchSiteRoutes(siteSlug);
  useBodyScrollLock(mobileOpen);

  const sidebarContent = (
    <>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
        <SidebarHeader onClose={() => setMobileOpen(false)} />

        {sites.length > 0 && (
          <SiteSwitcher
            currentSite={currentSite}
            rootRef={rootRef}
            searchInputRef={searchInputRef}
            siteSlug={siteSlug}
            sites={sites}
            switcher={switcher}
          />
        )}

        {siteSlug && currentSiteHealth === "unreachable" && <SiteUnreachableNotice />}

        <SidebarSearchRow />

        <nav className="mb-4 flex flex-col">
          <NavLink
            active={pathname === "/"}
            href="/"
            icon={MapIcon}
            label="Overview"
          />
        </nav>

        <nav className="flex flex-col gap-3 mb-4">
          <SiteNav isAdmin={isAdmin} pathname={pathname} siteSlug={siteSlug} />

          <ScopeLabel className="mt-1">All sites</ScopeLabel>

          <GlobalNav isAdmin={isAdmin} pathname={pathname} />
        </nav>

      </div>

      <SidebarFooter
        buildTag={buildTag}
        currentUser={currentUser}
        latestVersion={latestVersion}
        updateAvailable={updateAvailable}
        version={version}
      />
    </>
  );

  return (
    <>
      <MobileSidebarToggle onOpen={() => setMobileOpen(true)} />

      <MobileSidebar onClose={() => setMobileOpen(false)} open={mobileOpen}>
        {sidebarContent}
      </MobileSidebar>

      <aside
        aria-label="Main navigation"
        className="hidden fixed inset-y-0 left-0 z-30 border-r border-white/5 bg-[#0a0a0a] lg:flex lg:w-[240px] lg:flex-col"
      >
        {sidebarContent}
      </aside>
    </>
  );
}

function SidebarHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="mb-2 flex items-start px-1 -mt-2">
      <Image
        alt="Tainer"
        className="h-12 w-auto brightness-90"
        height={48}
        priority
        src="/tainerlong.png"
        width={127}
      />
      <div className="flex-1" />
      <button
        aria-label="Close navigation menu"
        className="shrink-0 flex items-center justify-center w-8 h-8 mt-2 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer lg:hidden"
        onClick={onClose}
        type="button"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function SiteSwitcher({
  currentSite,
  rootRef,
  searchInputRef,
  siteSlug,
  sites,
  switcher,
}: {
  currentSite: SiteInfo;
  rootRef: RefObject<HTMLDivElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  siteSlug: string;
  sites: SiteInfo[];
  switcher: SiteSwitcherState;
}) {
  return (
    <div className="relative mb-2" ref={rootRef}>
      <div className="flex items-center gap-1">
        <button
          className="flex flex-1 min-w-0 items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-left text-[13px] font-medium text-white transition-colors hover:bg-white/10 cursor-pointer"
          onClick={switcher.toggle}
          aria-label={`Switch site, current: ${currentSite?.name ?? "No site"}`}
          aria-expanded={switcher.open}
          type="button"
        >
          <SiteAvatar site={currentSite} />
          <span className="min-w-0 flex-1 truncate">
            {currentSite?.name ?? "No site"}
          </span>
          {healthDot(currentSite ?? { slug: "", name: "", healthy: null }, "sm")}
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform", switcher.open && "rotate-180")} />
        </button>
        <IntentLink
          href={siteHref(siteSlug, "/settings")}
          className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer"
          aria-label="Site settings"
        >
          <Settings className="w-4 h-4" />
        </IntentLink>
      </div>

      {switcher.open && sites.length > 1 && (
        <SiteSwitcherMenu
          searchInputRef={searchInputRef}
          siteSlug={siteSlug}
          sites={sites}
          switcher={switcher}
        />
      )}
    </div>
  );
}

function SiteSwitcherMenu({
  searchInputRef,
  siteSlug,
  sites,
  switcher,
}: {
  searchInputRef: RefObject<HTMLInputElement | null>;
  siteSlug: string;
  sites: SiteInfo[];
  switcher: SiteSwitcherState;
}) {
  const filteredSites = sites.filter((site) =>
    site.name.toLowerCase().includes(switcher.query.toLowerCase()),
  );

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-1.5 rounded-xl border border-white/[0.08] bg-zinc-900/95 backdrop-blur-xl shadow-2xl shadow-black/40 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
      {sites.length > 3 && (
        <div className="border-b border-white/[0.06] px-3 py-2.5">
          <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <Search className="h-3 w-3 text-zinc-500 shrink-0" />
            <input
              ref={searchInputRef}
              className="w-full bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-500"
              onChange={(e) => switcher.setQuery(e.target.value)}
              placeholder="Search sites..."
              type="text"
              value={switcher.query}
            />
          </div>
        </div>
      )}
      <div className="px-1.5 py-1.5">
        <p className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Sites</p>
      </div>
      <div className="max-h-[240px] overflow-y-auto px-1.5 pb-1.5">
        {filteredSites.map((site) => (
          <SiteOption
            current={site.slug === siteSlug}
            key={site.slug}
            onSelect={switcher.select}
            site={site}
          />
        ))}
      </div>
    </div>
  );
}

function SiteOption({
  current,
  onSelect,
  site,
}: {
  current: boolean;
  onSelect: (slug: string) => void;
  site: SiteInfo;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors",
        current
          ? "bg-white/[0.08] text-white"
          : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200",
      )}
      onClick={(e) => { e.stopPropagation(); onSelect(site.slug); }}
      type="button"
    >
      {healthDot(site, "md")}
      <span className="min-w-0 flex-1 truncate font-medium">{site.name}</span>
      {current && (
        <span className="text-[10px] text-zinc-500">Current</span>
      )}
    </button>
  );
}

function SiteUnreachableNotice() {
  return (
    <div className="mx-2 mb-4 flex items-center gap-2 rounded-md border border-rose-500/10 bg-rose-500/5 px-3 py-2">
      <WifiOff className="h-3.5 w-3.5 shrink-0 text-rose-400/60" />
      <span className="text-[11px] text-rose-400/80">Site unreachable</span>
    </div>
  );
}

function SidebarSearchRow() {
  return (
    <div className="mx-2 mb-4 flex items-center gap-1.5">
      <button
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-white/10 hover:bg-white/[0.05]"
        onClick={() => dispatchShortcut("k")}
        type="button"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="truncate text-[12px] text-zinc-500">Search…</span>
        <kbd className="ml-auto rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-sans text-[10px] text-zinc-500">
          ⌘K
        </kbd>
      </button>

      <button
        aria-label="Ask Tainy"
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md border border-white/5 bg-white/[0.02] text-zinc-500 transition-colors hover:border-white/10 hover:bg-white/[0.05] hover:text-zinc-300"
        onClick={() => dispatchShortcut("j")}
        title="Ask Tainy (⌘J)"
        type="button"
      >
        <Sparkles className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SiteNav({
  isAdmin,
  pathname,
  siteSlug,
}: {
  isAdmin: boolean;
  pathname: string;
  siteSlug: string;
}) {
  const isActive = (item: NavItem) => isSiteItemActive(pathname, siteSlug, item);
  const hrefFor = (item: NavItem) => siteHref(siteSlug, item.path);

  return (
    <>
      {SITE_SECTIONS.map((section) => (
        <NavItemSection
          hrefFor={hrefFor}
          isActive={isActive}
          isAdmin={isAdmin}
          key={section.id}
          section={section}
        />
      ))}

      <NavLink
        active={isActive(SITE_SETTINGS_ITEM)}
        href={hrefFor(SITE_SETTINGS_ITEM)}
        icon={SITE_SETTINGS_ITEM.icon}
        label={SITE_SETTINGS_ITEM.label}
      />
    </>
  );
}

function GlobalNav({ isAdmin, pathname }: { isAdmin: boolean; pathname: string }) {
  const isActive = (item: NavItem) => isGlobalItemActive(pathname, item);
  const hrefFor = (item: NavItem) => item.path;

  if (!isAdmin) {
    return (
      <NavLink
        active={isActive(GROUPS_ITEM)}
        href={hrefFor(GROUPS_ITEM)}
        icon={GROUPS_ITEM.icon}
        label={GROUPS_ITEM.label}
      />
    );
  }

  return (
    <>
      {GLOBAL_SECTIONS.map((section) => (
        <NavItemSection
          hrefFor={hrefFor}
          isActive={isActive}
          isAdmin={isAdmin}
          key={section.id}
          section={section}
        />
      ))}
    </>
  );
}

function NavItemSection({
  hrefFor,
  isActive,
  isAdmin,
  section,
}: {
  hrefFor: (item: NavItem) => string;
  isActive: (item: NavItem) => boolean;
  isAdmin: boolean;
  section: NavItemGroup;
}) {
  const visibleItems = section.items.filter((item) => isAdmin || !item.adminOnly);

  return (
    <NavSection
      containsActive={section.items.some(isActive)}
      id={section.id}
      label={section.label}
    >
      {visibleItems.map((item) => (
        <NavLink
          active={isActive(item)}
          href={hrefFor(item)}
          icon={item.icon}
          key={item.label}
          label={item.label}
        />
      ))}
    </NavSection>
  );
}

function SidebarFooter({
  buildTag,
  currentUser,
  latestVersion,
  updateAvailable,
  version,
}: {
  buildTag: string | null;
  currentUser: SessionUser;
  latestVersion: string | null;
  updateAvailable: boolean;
  version: string;
}) {
  const initials = currentUser.name.slice(0, 2).toUpperCase();

  return (
    <div className="p-3 border-t border-white/5">
      <div className="flex items-start gap-3 px-3 py-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 border border-white/10 text-[11px] font-bold text-zinc-400 shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-zinc-200 break-words leading-tight">
            {currentUser.name}
          </p>
          <div className="mt-0.5 flex items-end justify-between gap-6">
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-400">{currentUser.role}</p>
              <p
                className="text-[10px] text-zinc-600 whitespace-nowrap"
                title={
                  buildTag
                    ? `v${version} · build ${formatBuildTag(buildTag)} (${buildTag})`
                    : undefined
                }
              >
                v{version}
                {updateAvailable && latestVersion ? (
                  <UpdateBadge latestVersion={latestVersion} />
                ) : null}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IntentLink
                aria-label="Account settings"
                className="flex items-center justify-center w-7 h-7 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer"
                href="/account"
              >
                <Settings className="w-3.5 h-3.5" />
              </IntentLink>
              <Form action={signOutAction}>
                <button
                  aria-label="Sign out"
                  className="flex items-center justify-center w-7 h-7 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer"
                  type="submit"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </Form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UpdateBadge({ latestVersion }: { latestVersion: string }) {
  return (
    <a
      href={`https://hub.docker.com/r/tainersh/tainer/tags?name=${encodeURIComponent(latestVersion)}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Update available: v${latestVersion}. View on Docker Hub`}
      className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-px text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 transition-colors"
    >
      v{latestVersion}
      <span aria-hidden="true" className="text-emerald-400/80">↗</span>
    </a>
  );
}

function MobileSidebarToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="fixed top-4 left-4 z-50 flex items-center justify-center w-10 h-10 rounded-lg border border-white/10 bg-zinc-900/90 text-zinc-300 backdrop-blur transition-colors hover:bg-zinc-800 hover:text-white cursor-pointer lg:hidden"
      onClick={onOpen}
      aria-label="Open navigation menu"
      type="button"
    >
      <Menu className="w-5 h-5" />
    </button>
  );
}

function MobileSidebar({
  children,
  onClose,
  open,
}: {
  children: React.ReactNode;
  onClose: () => void;
  open: boolean;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Main navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] border-r border-white/5 bg-[#0a0a0a] flex flex-col transition-transform duration-300 ease-out lg:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {children}
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
  icon: ComponentType<{ className?: string }>;
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

function ScopeLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-2 px-3", className)}>
      <span className="block truncate text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-600">
        {children}
      </span>
    </div>
  );
}

function NavSection({
  children,
  containsActive,
  id,
  label,
}: {
  children: React.ReactNode;
  containsActive: boolean;
  id: string;
  label: string;
}) {
  const storageKey = `tainer_nav_section_${id}`;
  const pathname = usePathname();

  // localStorage is read after mount so the first render matches the server.
  const [open, setOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "1") setOpen(true);
      else if (stored === "0" && !containsActive) setOpen(false);
    } catch {}
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (containsActive && !open) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containsActive, pathname]);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {}
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
