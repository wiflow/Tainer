"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Globe,
  LayoutDashboard,
  LogOut,
  Rocket,
  HardDriveDownload,
  ShieldCheck,
  Bell,
  Settings2,
  Users,
  Tag,
  Server,
  FileCode,
  Search,
} from "lucide-react";

import { signOutAction } from "@/app/auth-actions";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import type { SessionUser } from "@/lib/auth";

type CommandPaletteData = {
  deployments: { id: string; ip: string; name: string; node: string; status: string; type: string; vmid: number }[];
  nodes: { name: string; status: string }[];
  templates: { id: string; name: string }[];
};

function extractSiteSlug(pathname: string): string | null {
  const match = pathname.match(/^\/sites\/([^/]+)/);
  return match?.[1] ?? null;
}

export function CommandPalette({ currentUser }: { currentUser: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CommandPaletteData | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const siteSlug = extractSiteSlug(pathname);
  const isAdmin = currentUser.role === "admin";

  // Keyboard shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Fetch data when opened with a site context
  useEffect(() => {
    if (!open || !siteSlug) return;
    if (data) return; // Already fetched

    setLoading(true);
    fetch(`/api/command-palette?siteSlug=${encodeURIComponent(siteSlug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json) setData(json as CommandPaletteData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, siteSlug, data]);

  // Reset data when site changes
  useEffect(() => {
    setData(null);
  }, [siteSlug]);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const siteBase = siteSlug ? `/sites/${siteSlug}` : null;

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search deployments, templates, or type a command…" />
      <CommandList>
        <CommandEmpty>
          {loading ? "Loading…" : "No results found."}
        </CommandEmpty>

        {/* Navigation */}
        {siteBase && (
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => navigate(siteBase)}>
              <LayoutDashboard className="mr-2 h-4 w-4 text-zinc-500" />
              Overview
            </CommandItem>
            <CommandItem onSelect={() => navigate(`${siteBase}/deployments`)}>
              <Rocket className="mr-2 h-4 w-4 text-zinc-500" />
              Deployments
            </CommandItem>
            <CommandItem onSelect={() => navigate(`${siteBase}/images`)}>
              <HardDriveDownload className="mr-2 h-4 w-4 text-zinc-500" />
              Image Library
            </CommandItem>
            <CommandItem onSelect={() => navigate(`${siteBase}/backups`)}>
              <ShieldCheck className="mr-2 h-4 w-4 text-zinc-500" />
              Backups
            </CommandItem>
            {isAdmin && (
              <>
                <CommandItem onSelect={() => navigate(`${siteBase}/diagnostics`)}>
                  <Search className="mr-2 h-4 w-4 text-zinc-500" />
                  Diagnostics
                </CommandItem>
                <CommandItem onSelect={() => navigate(`${siteBase}/alerts`)}>
                  <Bell className="mr-2 h-4 w-4 text-zinc-500" />
                  Alerts
                </CommandItem>
                <CommandItem onSelect={() => navigate(`${siteBase}/settings`)}>
                  <Settings2 className="mr-2 h-4 w-4 text-zinc-500" />
                  Settings
                </CommandItem>
              </>
            )}
          </CommandGroup>
        )}

        {isAdmin && (
          <CommandGroup heading="Admin">
            <CommandItem onSelect={() => navigate("/tags")}>
              <Tag className="mr-2 h-4 w-4 text-zinc-500" />
              Tags
            </CommandItem>
            <CommandItem onSelect={() => navigate("/sites")}>
              <Globe className="mr-2 h-4 w-4 text-zinc-500" />
              Sites
            </CommandItem>
            <CommandItem onSelect={() => navigate("/users")}>
              <Users className="mr-2 h-4 w-4 text-zinc-500" />
              Users
            </CommandItem>
          </CommandGroup>
        )}

        <CommandSeparator />

        {/* Deployments */}
        {data && data.deployments.length > 0 && siteBase && (
          <CommandGroup heading="Deployments">
            {data.deployments.map((d) => (
              <CommandItem
                key={d.id}
                value={`${d.name} ${d.vmid} ${d.ip} ${d.node}`}
                onSelect={() => navigate(`${siteBase}/deployments/${d.id}`)}
              >
                <Rocket className="mr-2 h-4 w-4 text-zinc-500" />
                <span className="flex-1 truncate">{d.name}</span>
                <span className="ml-2 text-[11px] tabular-nums text-zinc-600">
                  {d.type.toUpperCase()} {d.vmid}
                </span>
                <span
                  className={`ml-2 h-1.5 w-1.5 rounded-full ${
                    d.status === "running" ? "bg-emerald-400" : "bg-zinc-600"
                  }`}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Templates */}
        {data && data.templates.length > 0 && siteBase && (
          <CommandGroup heading="Templates">
            {data.templates.map((t) => (
              <CommandItem
                key={t.id}
                value={`template ${t.name}`}
                onSelect={() => navigate(`${siteBase}/templates/${t.id}`)}
              >
                <FileCode className="mr-2 h-4 w-4 text-zinc-500" />
                {t.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Nodes */}
        {data && data.nodes.length > 0 && (
          <CommandGroup heading="Nodes">
            {data.nodes.map((n) => (
              <CommandItem
                key={n.name}
                value={`node ${n.name}`}
                onSelect={() => siteBase && navigate(siteBase)}
              >
                <Server className="mr-2 h-4 w-4 text-zinc-500" />
                <span className="flex-1">{n.name}</span>
                <span
                  className={`ml-2 h-1.5 w-1.5 rounded-full ${
                    n.status === "online" ? "bg-emerald-400" : "bg-zinc-600"
                  }`}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        {/* Actions */}
        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => {
              setOpen(false);
              const form = document.createElement("form");
              form.method = "POST";
              form.action = "";
              signOutAction();
            }}
          >
            <LogOut className="mr-2 h-4 w-4 text-zinc-500" />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
