"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { createGroupAction, updateGroupAction } from "@/app/group-management-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { Permission } from "@/lib/permissions";
import { GLOBAL_PERMISSIONS, GLOBAL_PERMISSION_LABELS, SITE_PERMISSIONS, SITE_PERMISSION_LABELS } from "@/lib/permissions";
import type { UserGroup, SiteAccessEntry } from "@/lib/user-groups";

type SiteInfo = {
  id: string;
  name: string;
};

export function GroupForm({
  group,
  sites,
}: {
  group?: UserGroup;
  sites: SiteInfo[];
}) {
  const router = useRouter();
  const isEditing = Boolean(group);

  const [state, formAction, isPending] = useActionState(
    isEditing ? updateGroupAction : createGroupAction,
    initialBasicActionState,
  );
  const lastRequestId = useRef(state.requestId);

  const [isAdmin, setIsAdmin] = useState(group?.isAdmin ?? false);
  const [globalPerms, setGlobalPerms] = useState<Set<Permission>>(
    new Set(group?.globalPermissions ?? []),
  );
  const [siteAccessMap, setSiteAccessMap] = useState<Record<string, { enabled: boolean; permissions: Set<Permission> }>>(() => {
    const map: Record<string, { enabled: boolean; permissions: Set<Permission> }> = {};
    for (const site of sites) {
      const existing = group?.siteAccess.find((sa) => sa.siteId === site.id);
      map[site.id] = {
        enabled: Boolean(existing),
        permissions: new Set(existing?.permissions ?? []),
      };
    }
    return map;
  });

  useEffect(() => {
    if (state.requestId && state.requestId !== lastRequestId.current) {
      lastRequestId.current = state.requestId;
      if (state.status === "success") {
        router.push("/groups");
      }
    }
  }, [state, router]);

  function toggleGlobalPerm(perm: Permission) {
    setGlobalPerms((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  }

  function toggleSiteEnabled(siteId: string) {
    setSiteAccessMap((prev) => ({
      ...prev,
      [siteId]: {
        ...prev[siteId],
        enabled: !prev[siteId]?.enabled,
      },
    }));
  }

  function toggleSitePerm(siteId: string, perm: Permission) {
    setSiteAccessMap((prev) => {
      const entry = prev[siteId];
      const next = new Set(entry?.permissions ?? []);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return {
        ...prev,
        [siteId]: { ...entry, permissions: next },
      };
    });
  }

  function selectAllSitePerms(siteId: string) {
    setSiteAccessMap((prev) => ({
      ...prev,
      [siteId]: {
        ...prev[siteId],
        permissions: new Set(SITE_PERMISSIONS),
      },
    }));
  }

  function deselectAllSitePerms(siteId: string) {
    setSiteAccessMap((prev) => ({
      ...prev,
      [siteId]: {
        ...prev[siteId],
        permissions: new Set(),
      },
    }));
  }

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  const checkboxClassName =
    "h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-white accent-white";

  return (
    <Card>
      <CardHeader className="border-b border-white/5">
        <CardTitle>{isEditing ? "Edit group" : "New group"}</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-5">
          {isEditing && <input name="groupId" type="hidden" value={group!.id} />}

          <input name="isAdmin" type="hidden" value={String(isAdmin)} />
          <input
            name="globalPermissions"
            type="hidden"
            value={[...globalPerms].join(",")}
          />
          {Object.entries(siteAccessMap).map(([siteId, entry]) =>
            entry.enabled ? (
              <div key={siteId}>
                <input name={`site-${siteId}-enabled`} type="hidden" value="true" />
                <input
                  name={`site-${siteId}-permissions`}
                  type="hidden"
                  value={[...entry.permissions].join(",")}
                />
              </div>
            ) : null,
          )}

          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Name</span>
            <input
              className={inputClassName}
              defaultValue={group?.name ?? ""}
              name="name"
              placeholder="e.g. Developers"
              required
              type="text"
            />
          </label>

          <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <span className="text-[13px] font-medium text-zinc-200">Description</span>
            <textarea
              className={`${inputClassName} min-h-[72px] resize-y`}
              defaultValue={group?.description ?? ""}
              name="description"
              placeholder="Optional description for this group"
              rows={2}
            />
          </label>

          <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <label className="flex items-center gap-3">
              <input
                checked={isAdmin}
                className={checkboxClassName}
                onChange={(e) => setIsAdmin(e.target.checked)}
                type="checkbox"
              />
              <div>
                <span className="text-[13px] font-medium text-zinc-200">Admin group</span>
                <p className="text-[12px] text-zinc-500">
                  Admin groups bypass all permission checks and have full access to everything.
                </p>
              </div>
            </label>
          </div>

          {!isAdmin && (
            <>
              <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <p className="text-[13px] font-medium text-zinc-200">Global permissions</p>
                <p className="mt-0.5 text-[12px] text-zinc-500">
                  These permissions apply across the entire application.
                </p>
                <div className="mt-3 space-y-2">
                  {GLOBAL_PERMISSIONS.map((perm) => (
                    <label className="flex items-center gap-2.5" key={perm}>
                      <input
                        checked={globalPerms.has(perm)}
                        className={checkboxClassName}
                        onChange={() => toggleGlobalPerm(perm)}
                        type="checkbox"
                      />
                      <span className="text-[13px] text-zinc-300">
                        {GLOBAL_PERMISSION_LABELS[perm]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <p className="text-[13px] font-medium text-zinc-200">Site access</p>
                <p className="mt-0.5 text-[12px] text-zinc-500">
                  Enable access to specific sites and choose which permissions to grant.
                </p>

                {sites.length === 0 ? (
                  <p className="mt-3 text-[12px] text-zinc-600">
                    No sites configured yet. Add sites first.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {sites.map((site) => {
                      const entry = siteAccessMap[site.id];
                      return (
                        <div
                          className="rounded-md border border-white/5 bg-black/20 px-3 py-2.5"
                          key={site.id}
                        >
                          <label className="flex items-center gap-2.5">
                            <input
                              checked={entry?.enabled ?? false}
                              className={checkboxClassName}
                              onChange={() => toggleSiteEnabled(site.id)}
                              type="checkbox"
                            />
                            <span className="text-[13px] font-medium text-zinc-200">
                              {site.name}
                            </span>
                          </label>

                          {entry?.enabled && (
                            <div className="ml-6 mt-2.5">
                              <div className="mb-2 flex gap-2">
                                <button
                                  className="text-[11px] text-emerald-400 hover:text-emerald-300"
                                  onClick={() => selectAllSitePerms(site.id)}
                                  type="button"
                                >
                                  Select all
                                </button>
                                <span className="text-[11px] text-zinc-700">|</span>
                                <button
                                  className="text-[11px] text-zinc-400 hover:text-zinc-300"
                                  onClick={() => deselectAllSitePerms(site.id)}
                                  type="button"
                                >
                                  Deselect all
                                </button>
                              </div>
                              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                {SITE_PERMISSIONS.map((perm) => (
                                  <label className="flex items-center gap-2" key={perm}>
                                    <input
                                      checked={entry.permissions.has(perm)}
                                      className={checkboxClassName}
                                      onChange={() => toggleSitePerm(site.id, perm)}
                                      type="checkbox"
                                    />
                                    <span className="text-[12px] text-zinc-400">
                                      {SITE_PERMISSION_LABELS[perm]}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {state.status === "error" && state.message && (
            <div className="rounded-md border border-red-800/50 bg-red-900/20 px-4 py-3 text-[13px] text-red-300">
              {state.message}
            </div>
          )}

          {state.status === "success" && state.message && (
            <div className="rounded-md border border-emerald-800/50 bg-emerald-900/20 px-4 py-3 text-[13px] text-emerald-300">
              {state.message}
            </div>
          )}

          <div className="flex gap-2 border-t border-white/5 pt-4">
            <Button disabled={isPending} type="submit">
              {isPending
                ? isEditing ? "Saving..." : "Creating..."
                : isEditing ? "Save changes" : "Create group"}
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}
