"use client";

import { useActionState, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";

import {
  createApiTokenAction,
  initialApiTokenActionState,
  revokeApiTokenAction,
} from "@/app/api-token-actions";
import { CopyableText } from "@/components/copyable-text";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { SectionPanel } from "@/components/ui/section-panel";
import type { ApiTokenSummary } from "@/lib/api-tokens";
import { SITE_PERMISSION_LABELS, SITE_PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const inputClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500";

export function ApiTokenPanel({
  tokens,
  sites,
  appOrigin,
  now,
}: {
  tokens: ApiTokenSummary[];
  sites: { id: string; name: string }[];
  appOrigin: string;
  /** Server render time, so client render stays pure without Date.now(). */
  now: number;
}) {
  const [createState, createAction, isCreating] = useActionState(
    createApiTokenAction,
    initialApiTokenActionState,
  );
  const [revokeState, revokeAction, isRevoking] = useActionState(
    revokeApiTokenAction,
    initialApiTokenActionState,
  );
  const [showForm, setShowForm] = useState(false);

  useActionFlashFeedback(createState, {
    errorTitle: "Token not created",
    successTitle: "API token created",
  });
  useActionFlashFeedback(revokeState, {
    errorTitle: "Revoke failed",
    successTitle: "API token revoked",
  });

  return (
    <SectionPanel
      title="API tokens"
      description="Applies to the whole Tainer instance. Scoped bearer tokens so scripts, Terraform, or CI can call Tainer's API without a browser session."
    >
      <div className="space-y-5">
        {createState.createdToken ? (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3">
            <p className="text-[12px] font-medium text-emerald-200">
              Copy this token now — it is shown exactly once and stored only as a hash:
            </p>
            <div className="mt-2">
              <CopyableText className="font-mono text-[12px] text-zinc-100" text={createState.createdToken} />
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">
              Use it as{" "}
              <code className="rounded bg-black/40 px-1 py-0.5 text-[10.5px] text-zinc-300">
                curl -H &quot;Authorization: Bearer {createState.createdToken.slice(0, 12)}…&quot; {appOrigin}/api/sites/status
              </code>
            </p>
          </div>
        ) : null}

        {showForm ? (
          <Form action={createAction} className="space-y-4 rounded-lg border border-white/[0.06] bg-black/20 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[12px] text-zinc-400">
                Name
                <input className={inputClassName} name="name" placeholder="terraform-prod" required />
              </label>
              <div className="text-[12px] text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <label htmlFor="expiresDays">Expires after (days)</label>
                  <InfoTip label="Expires after" side="top">
                    Leave it empty for a token that never expires.
                  </InfoTip>
                </span>
                <input
                  className={inputClassName}
                  id="expiresDays"
                  inputMode="numeric"
                  name="expiresDays"
                  placeholder="90"
                />
              </div>
            </div>

            <fieldset>
              <legend className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                Permissions
                <InfoTip label="Permissions" side="right">
                  Tokens act as operators with only the permissions you grant — user, group, and
                  site management are never token-accessible.
                </InfoTip>
              </legend>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {SITE_PERMISSIONS.map((permission) => (
                  <label
                    key={permission}
                    className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-zinc-900/60 px-2.5 py-1.5 text-[12px] text-zinc-300"
                  >
                    <input
                      className="h-3.5 w-3.5 accent-emerald-500"
                      name="permissions"
                      type="checkbox"
                      value={permission}
                    />
                    {SITE_PERMISSION_LABELS[permission] ?? permission}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                Sites
                <InfoTip label="Sites" side="right">
                  Leave every box unchecked to give the token access to all sites.
                </InfoTip>
              </legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sites.map((site) => (
                  <label
                    key={site.id}
                    className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-zinc-900/60 px-2.5 py-1.5 text-[12px] text-zinc-300"
                  >
                    <input
                      className="h-3.5 w-3.5 accent-sky-500"
                      name="siteIds"
                      type="checkbox"
                      value={site.id}
                    />
                    {site.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex items-center gap-2 border-t border-white/5 pt-3">
              <Button disabled={isCreating} size="sm" type="submit">
                <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                {isCreating ? "Creating…" : "Create token"}
              </Button>
              <Button onClick={() => setShowForm(false)} size="sm" type="button" variant="ghost">
                Cancel
              </Button>
            </div>
          </Form>
        ) : (
          <Button onClick={() => setShowForm(true)} size="sm" type="button" variant="secondary">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New token
          </Button>
        )}

        {tokens.length > 0 ? (
          <ul className="divide-y divide-white/5 rounded-lg border border-white/5 bg-black/30">
            {tokens.map((token) => (
              <li
                key={token.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5",
                  token.revokedAt && "opacity-45",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-medium text-zinc-200">{token.name}</span>
                    <span className="font-mono text-[10.5px] text-zinc-500">
                      {token.displayPrefix}…
                    </span>
                    {token.revokedAt ? (
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9.5px] text-rose-300">
                        revoked
                      </span>
                    ) : token.expiresAt && new Date(token.expiresAt).getTime() <= now ? (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] text-amber-300">
                        expired
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-zinc-500">
                    {token.permissions.join(", ")} · {token.siteIds.length ? `${token.siteIds.length} site(s)` : "all sites"} ·{" "}
                    {token.lastUsedAt
                      ? `last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                      : "never used"}
                    {token.expiresAt ? ` · expires ${new Date(token.expiresAt).toLocaleDateString()}` : ""}
                  </div>
                </div>
                {!token.revokedAt ? (
                  <Form action={revokeAction}>
                    <input name="id" type="hidden" value={token.id} />
                    <Button
                      className="h-7 w-7 px-0 text-zinc-500 hover:text-rose-300"
                      disabled={isRevoking}
                      title={`Revoke "${token.name}"`}
                      type="submit"
                      variant="ghost"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-zinc-500">No API tokens yet.</p>
        )}
      </div>
    </SectionPanel>
  );
}
