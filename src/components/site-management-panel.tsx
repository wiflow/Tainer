"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Globe,
  KeyRound,
  Link2,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Server,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import {
  createSiteAction,
  deleteSiteAction,
  disableSiteAction,
  enableSiteAction,
  setDefaultSiteAction,
  updateSiteAction,
  validateExistingSiteAction,
} from "@/app/site-actions";
import { CaCertField } from "@/components/ca-cert-field";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import { useSiteBasePath } from "@/lib/use-site-path";
import { cn } from "@/lib/utils";

type SiteInfo = {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  apiUrl: string;
  username: string;
  defaultNode: string;
  tlsMode: "full" | "insecure";
  tlsCustomCaPem: string | null;
  lastValidationOk: boolean | null;
  lastValidatedAt: string | null;
  isDefault: boolean;
  location: { latitude: number; longitude: number } | null;
};

const inputClassName =
  "mt-1.5 w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-[13px] text-zinc-100 outline-none transition-all duration-200 placeholder:text-zinc-600 focus:border-white/[0.15] focus:bg-white/[0.04] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.03)]";

function ValidateButton({ siteSlug }: { siteSlug: string }) {
  const [result, setResult] = useState<{ status: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = useCallback(() => {
    setResult(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("siteSlug", siteSlug);
      const state = await validateExistingSiteAction(initialBasicActionState, formData);
      setResult({ status: state.status === "error" ? "error" : "success", message: state.message });
    });
  }, [siteSlug]);

  return (
    <div>
      <Button disabled={isPending} onClick={handleClick} size="sm" type="button" variant="secondary">
        <Zap className="h-3.5 w-3.5" />
        {isPending ? "Testing..." : "Test Connection"}
      </Button>
      {result && (
        <div
          className={cn(
            "mt-2 rounded-lg border px-3 py-2 text-[12px]",
            result.status === "error"
              ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
              : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300",
          )}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}

function EditSiteForm({ site, onClose }: { site: SiteInfo; onClose: () => void }) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, action, isPending] = useActionState(updateSiteAction, initialBasicActionState);

  useEffect(() => {
    if (state.status === "success") {
      onClose();
    }
  }, [state.status, state.requestId, onClose]);

  return (
    <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
          <Pencil className="h-3.5 w-3.5 text-zinc-500" />
          Edit Site
        </h4>
        <button className="text-zinc-600 hover:text-zinc-300" onClick={onClose} type="button">
          <X className="h-4 w-4" />
        </button>
      </div>

      {state.status === "error" && (
        <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-300">
          {state.message}
        </div>
      )}

      <Form action={action} className="mt-4 space-y-3">
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <input type="hidden" name="siteId" value={site.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium text-zinc-500">Site name</span>
            <input className={inputClassName} name="siteName" defaultValue={site.name} />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-zinc-500">Default node</span>
            <input className={inputClassName} name="defaultNode" defaultValue={site.defaultNode} />
          </label>
        </div>

        <label className="block">
          <span className="text-[11px] font-medium text-zinc-500">API URL</span>
          <input className={inputClassName} name="apiUrl" defaultValue={site.apiUrl} />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium text-zinc-500">Proxmox username</span>
            <input className={inputClassName} name="username" defaultValue={site.username} />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-zinc-500">Proxmox password (leave blank to keep current)</span>
            <input className={inputClassName} name="password" type="password" placeholder="Unchanged" />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
              <MapPin className="h-3.5 w-3.5" />
              Latitude
            </span>
            <input className={inputClassName} name="latitude" type="number" step="any" placeholder="e.g. 40.7128" defaultValue={site.location?.latitude ?? ""} />
          </label>
          <label className="block">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
              <MapPin className="h-3.5 w-3.5" />
              Longitude
            </span>
            <input className={inputClassName} name="longitude" type="number" step="any" placeholder="e.g. -74.0060" defaultValue={site.location?.longitude ?? ""} />
          </label>
        </div>

        <div className="flex items-center gap-3">
          {/* Hidden field ensures "full" is sent when checkbox is unchecked */}
          <input type="hidden" name="tlsMode" value="full" />
          <input
            className="h-4 w-4 rounded border-white/[0.1] bg-white/[0.02]"
            id={`edit-tls-${site.id}`}
            name="tlsMode"
            type="checkbox"
            value="insecure"
            defaultChecked={site.tlsMode === "insecure"}
          />
          <label className="text-[12px] text-zinc-500" htmlFor={`edit-tls-${site.id}`}>
            Skip TLS certificate validation (self-signed certs)
          </label>
        </div>

        <CaCertField
          id={`edit-${site.id}`}
          name="tlsCustomCaPem"
          defaultValue={site.tlsCustomCaPem ?? ""}
          apiUrl={site.apiUrl}
        />

        <div className="flex gap-2 pt-1">
          <Button disabled={isPending} size="sm" type="submit" variant="accent">
            {isPending ? "Saving..." : "Save Changes"}
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button onClick={onClose} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
        </div>
      </Form>
    </div>
  );
}

type LiveStatus = {
  ok: boolean;
  latencyMs: number;
  version: string | null;
  message?: string;
};

export function SiteManagementPanel({
  sites,
  defaultSiteId,
}: {
  sites: SiteInfo[];
  defaultSiteId: string | null;
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [showAddForm, setShowAddForm] = useState(false);
  const [liveStatus, setLiveStatus] = useState<Record<string, LiveStatus>>({});
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchStatus() {
      try {
        const res = await fetch("/api/sites/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { sites: Record<string, LiveStatus> };
        if (!cancelled) {
          setLiveStatus(data.sites ?? {});
          setStatusLoading(false);
        }
      } catch {
        if (!cancelled) setStatusLoading(false);
      }
    }
    fetchStatus();
    return () => { cancelled = true; };
  }, []);
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [createState, createAction, isCreating] = useActionState(
    createSiteAction,
    initialBasicActionState,
  );

  const [disableState, disableAction, isDisabling] = useActionState(
    disableSiteAction,
    initialBasicActionState,
  );

  const [enableState, enableAction, isEnabling] = useActionState(
    enableSiteAction,
    initialBasicActionState,
  );

  const [defaultState, defaultAction, isSettingDefault] = useActionState(
    setDefaultSiteAction,
    initialBasicActionState,
  );

  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteSiteAction,
    initialBasicActionState,
  );

  useEffect(() => {
    if (createState.status === "success") {
      setShowAddForm(false);
    }
  }, [createState.status, createState.requestId]);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {sites.map((site) => {
          const isExpanded = expandedSiteId === site.id;
          const isEditing = editingSiteId === site.id;

          return (
            <div
              key={site.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden"
            >
              <button
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
                onClick={() => {
                  setExpandedSiteId(isExpanded ? null : site.id);
                  if (isExpanded) setEditingSiteId(null);
                }}
                type="button"
              >
                {(() => {
                  const live = liveStatus[site.id];
                  const isConnected = live ? live.ok : site.lastValidationOk;
                  return (
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        !site.enabled
                          ? "bg-zinc-700"
                          : statusLoading
                            ? "bg-zinc-500 animate-pulse"
                            : isConnected === true
                              ? "bg-emerald-500"
                              : isConnected === false
                                ? "bg-rose-500"
                                : "bg-zinc-500",
                      )}
                    />
                  );
                })()}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-medium text-zinc-200">
                      {site.name}
                    </p>
                    {site.isDefault && (
                      <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        <Star className="h-3 w-3" />
                        Default
                      </span>
                    )}
                    {!site.enabled && (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-zinc-500">
                    <span>{site.apiUrl}{site.defaultNode ? ` · ${site.defaultNode}` : ""}</span>
                    {site.tlsMode === "insecure" && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                        TLS Insecure
                      </span>
                    )}
                    {(() => {
                      const live = liveStatus[site.id];
                      if (!site.enabled) return <span className="text-zinc-600">Disabled</span>;
                      if (statusLoading) return <span className="animate-pulse text-zinc-600">Checking...</span>;
                      if (!live) return null;
                      if (live.ok) {
                        return (
                          <span className="text-emerald-500/80">
                            Connected{live.version ? ` · PVE ${live.version}` : ""} · {live.latencyMs}ms
                          </span>
                        );
                      }
                      return (
                        <span className="text-rose-400/80">
                          Unreachable{live.message ? ` · ${live.message}` : ""}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <span className="rounded-md bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-600">
                  {site.slug}
                </span>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-zinc-600" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-zinc-600" />
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-white/[0.04] px-5 py-4">
                  <div className="flex flex-wrap gap-2">
                    <ValidateButton siteSlug={site.slug} />

                    <Button
                      onClick={() => setEditingSiteId(isEditing ? null : site.id)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {isEditing ? "Cancel Edit" : "Edit"}
                    </Button>

                    {site.enabled ? (
                      <Form action={disableAction}>
                        <input name="siteSlug" type="hidden" value={siteSlug} />
                        <input type="hidden" name="siteId" value={site.id} />
                        <Button disabled={isDisabling} size="sm" type="submit" variant="danger">
                          <PowerOff className="h-3.5 w-3.5" />
                          Disable
                        </Button>
                      </Form>
                    ) : (
                      <Form action={enableAction}>
                        <input name="siteSlug" type="hidden" value={siteSlug} />
                        <input type="hidden" name="siteId" value={site.id} />
                        <Button disabled={isEnabling} size="sm" type="submit" variant="success">
                          <Power className="h-3.5 w-3.5" />
                          Enable
                        </Button>
                      </Form>
                    )}

                    {site.enabled && !site.isDefault && (
                      <Form action={defaultAction}>
                        <input name="siteSlug" type="hidden" value={siteSlug} />
                        <input type="hidden" name="siteId" value={site.id} />
                        <Button disabled={isSettingDefault} size="sm" type="submit" variant="secondary">
                          <Star className="h-3.5 w-3.5" />
                          Set as Default
                        </Button>
                      </Form>
                    )}

                    {!site.isDefault && (
                      confirmDeleteId === site.id ? (
                        <div className="flex items-center gap-2">
                          <Form action={deleteAction}>
                            <input name="siteSlug" type="hidden" value={siteSlug} />
                            <input type="hidden" name="siteId" value={site.id} />
                            <Button disabled={isDeleting} size="sm" type="submit" variant="danger">
                              <Trash2 className="h-3.5 w-3.5" />
                              {isDeleting ? "Deleting..." : "Confirm Delete"}
                            </Button>
                          </Form>
                          <Button onClick={() => setConfirmDeleteId(null)} size="sm" type="button" variant="secondary">
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={() => setConfirmDeleteId(site.id)}
                          size="sm"
                          type="button"
                          variant="secondary"
                          className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      )
                    )}
                  </div>

                  {site.lastValidatedAt && (
                    <p className="mt-2 text-[11px] text-zinc-600">
                      Last validated: {new Date(site.lastValidatedAt).toLocaleString()}
                    </p>
                  )}

                  {isEditing && (
                    <EditSiteForm
                      site={site}
                      onClose={() => setEditingSiteId(null)}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}

        {sites.length === 0 && (
          <p className="text-[13px] text-zinc-500">
            No sites configured yet.
          </p>
        )}
      </div>

      {!showAddForm ? (
        <Button onClick={() => setShowAddForm(true)} size="md" variant="accent">
          <Plus className="h-4 w-4" />
          Add Site
        </Button>
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-zinc-100">
              <Globe className="h-4 w-4 text-zinc-400" />
              Add a Proxmox Cluster
            </h3>
            <button className="text-zinc-600 hover:text-zinc-300" onClick={() => setShowAddForm(false)} type="button">
              <X className="h-4 w-4" />
            </button>
          </div>

          {createState.message && (
            <div
              className={cn(
                "mt-4 rounded-lg border px-4 py-3 text-[13px]",
                createState.status === "error"
                  ? "border-rose-500/20 bg-rose-500/[0.06] text-rose-300"
                  : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300",
              )}
            >
              {createState.message}
            </div>
          )}

          <Form action={createAction} className="mt-4 space-y-4">
            <input name="siteSlug" type="hidden" value={siteSlug} />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-400">
                  <Globe className="h-3.5 w-3.5" />
                  Site name
                </span>
                <input className={inputClassName} name="siteName" placeholder="Production" required />
              </label>
              <label className="block">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-400">
                  <Server className="h-3.5 w-3.5" />
                  Default node
                </span>
                <input className={inputClassName} name="defaultNode" placeholder="pve" />
              </label>
            </div>

            <label className="block">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-400">
                <Link2 className="h-3.5 w-3.5" />
                Proxmox API URL
              </span>
              <input className={inputClassName} name="apiUrl" placeholder="https://proxmox.example.com:8006" required />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-400">
                  <MapPin className="h-3.5 w-3.5" />
                  Latitude
                </span>
                <input className={inputClassName} name="latitude" type="number" step="any" placeholder="e.g. 40.7128" />
              </label>
              <label className="block">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-400">
                  <MapPin className="h-3.5 w-3.5" />
                  Longitude
                </span>
                <input className={inputClassName} name="longitude" type="number" step="any" placeholder="e.g. -74.0060" />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-400">
                  <KeyRound className="h-3.5 w-3.5" />
                  Proxmox username
                </span>
                <input className={inputClassName} name="username" placeholder="root@pam" required />
              </label>
              <label className="block">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-400">
                  <Lock className="h-3.5 w-3.5" />
                  Proxmox password
                </span>
                <input className={inputClassName} name="password" type="password" required />
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input type="hidden" name="tlsMode" value="full" />
              <input
                className="h-4 w-4 rounded border-white/[0.1] bg-white/[0.02]"
                id="add-tlsInsecure"
                name="tlsMode"
                type="checkbox"
                value="insecure"
              />
              <label className="text-[12px] text-zinc-500" htmlFor="add-tlsInsecure">
                Skip TLS certificate validation (self-signed certs)
              </label>
            </div>

            <CaCertField
              id="add-site"
              name="tlsCustomCaPem"
            />

            <div className="flex gap-3 pt-2">
              <Button disabled={isCreating} size="md" type="submit" variant="accent">
                {isCreating ? "Creating..." : "Create Site"}
                <Check className="h-4 w-4" />
              </Button>
              <Button onClick={() => setShowAddForm(false)} size="md" type="button" variant="ghost">
                Cancel
              </Button>
            </div>
          </Form>
        </div>
      )}
    </div>
  );
}
