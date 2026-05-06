"use client";

import { KeyRound, Network, Pencil, Plus, TestTube2, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";

import {
  createIdpProviderAction,
  deleteIdpProviderAction,
  testIdpProviderAction,
  updateIdpProviderAction,
} from "@/app/identity-provider-actions";
import { initialTestIdpActionState } from "@/app/identity-provider-action-states";
import { LdapConfigForm } from "@/app/ldap/ldap-config-form";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { IdpProviderPublic } from "@/lib/idp-providers";
import type { LdapConfigPublic } from "@/lib/ldap-config";

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

// The manager handles two distinct provider types — OIDC SSO providers
// (multiple) and a single LDAP/AD config — but presents them in a
// unified list. Mode encodes both the active view and the type of
// provider being created/edited so the same component switches forms
// cleanly without a separate route.
type Mode =
  | { kind: "list" }
  | { kind: "choose-type" }
  | { kind: "create-oidc" }
  | { kind: "create-ldap" }
  | { kind: "edit-oidc"; provider: IdpProviderPublic }
  | { kind: "edit-ldap" };

function ProviderForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: IdpProviderPublic;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(initial);
  const action = isEdit ? updateIdpProviderAction : createIdpProviderAction;
  const [state, formAction, isPending] = useActionState(action, initialBasicActionState);

  useActionFlashFeedback(state, {
    errorTitle: isEdit ? "Update failed" : "Create failed",
    successTitle: isEdit ? "Provider updated" : "Provider created",
  });

  // Bubble success up to parent so the form closes back to the list view.
  if (state.status === "success" && state.requestId) {
    queueMicrotask(onSaved);
  }

  const exampleIssuer = "https://login.microsoftonline.com/{tenant-id}/v2.0";

  return (
    <Form action={formAction} className="space-y-4">
      {initial && <input name="providerId" type="hidden" value={initial.id} />}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-[12px] font-medium text-zinc-400">Display name</span>
          <input
            className={fieldClassName}
            defaultValue={initial?.name ?? ""}
            name="name"
            placeholder="Microsoft Entra ID"
            required
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-zinc-400">
            Slug{" "}
            <span className="text-zinc-600">
              (used in callback URL: <code>/auth/sso/callback/&#123;slug&#125;</code>)
            </span>
          </span>
          <input
            className={fieldClassName}
            defaultValue={initial?.slug ?? ""}
            name="slug"
            pattern="[a-z0-9][a-z0-9-]*"
            placeholder="microsoft-entra"
            required
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[12px] font-medium text-zinc-400">Issuer URL</span>
        <input
          className={`${fieldClassName} font-mono text-[12px]`}
          defaultValue={initial?.issuer ?? ""}
          name="issuer"
          placeholder={exampleIssuer}
          required
          type="url"
        />
        <span className="mt-1 block text-[11px] text-zinc-600">
          Microsoft Entra: <code>https://login.microsoftonline.com/&#123;tenant-id&#125;/v2.0</code>{" "}
          · Google: <code>https://accounts.google.com</code>
        </span>
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-[12px] font-medium text-zinc-400">Client ID</span>
          <input
            className={`${fieldClassName} font-mono text-[12px]`}
            defaultValue={initial?.clientId ?? ""}
            name="clientId"
            required
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-zinc-400">
            Client secret{isEdit && initial?.hasClientSecret ? " (leave blank to keep)" : ""}
          </span>
          <input
            className={`${fieldClassName} font-mono text-[12px]`}
            name="clientSecret"
            placeholder={isEdit && initial?.hasClientSecret ? "•••••••••••• (unchanged)" : ""}
            required={!isEdit}
            type="password"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[12px] font-medium text-zinc-400">
          Allowed email domains{" "}
          <span className="text-zinc-600">(comma-separated, blank = unrestricted)</span>
        </span>
        <input
          className={fieldClassName}
          defaultValue={initial?.allowedEmailDomains ?? ""}
          name="allowedEmailDomains"
          placeholder="example.com, subsidiary.com"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-[12px] font-medium text-zinc-400">Default role for new users</span>
          <select
            className={fieldClassName}
            defaultValue={initial?.defaultRole ?? "operator"}
            name="defaultRole"
          >
            <option value="operator">Operator</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <div className="flex flex-col gap-2 pt-5 md:pt-0">
          <label className="flex items-center gap-2">
            <input
              defaultChecked={initial?.autoProvision ?? false}
              className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
              name="autoProvision"
              type="checkbox"
            />
            <span className="text-[13px] text-zinc-200">Auto-provision unknown users</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              defaultChecked={initial?.enabled ?? true}
              className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
              name="enabled"
              type="checkbox"
            />
            <span className="text-[13px] text-zinc-200">Enabled (show on login page)</span>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-4">
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={isPending} type="submit">
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Create provider"}
        </Button>
      </div>
    </Form>
  );
}

function ProviderRow({
  onEdit,
  provider,
}: {
  onEdit: (p: IdpProviderPublic) => void;
  provider: IdpProviderPublic;
}) {
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteIdpProviderAction,
    initialBasicActionState,
  );
  const [testState, testAction, isTesting] = useActionState(
    testIdpProviderAction,
    initialTestIdpActionState,
  );
  useActionFlashFeedback(deleteState, {
    errorTitle: "Delete failed",
    successTitle: "Provider deleted",
  });
  useActionFlashFeedback(testState, {
    errorTitle: "Connection test failed",
    successTitle: "Connection test passed",
  });

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3 last:border-b-0 hover:bg-[#111113] transition-colors">
      <div className="flex-1 min-w-[220px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-zinc-200">{provider.name}</span>
          <Badge variant={provider.enabled ? "success" : "neutral"}>
            {provider.enabled ? "enabled" : "disabled"}
          </Badge>
          <Badge variant="info">slug: {provider.slug}</Badge>
          <Badge variant="neutral">{provider.defaultRole}</Badge>
          {provider.autoProvision && <Badge variant="warning">auto-provision</Badge>}
        </div>
        <p className="mt-0.5 text-[11px] text-zinc-600 font-mono">{provider.issuer}</p>
        <p className="mt-0.5 text-[11px] text-zinc-600">
          Allowed domains:{" "}
          <span className="text-zinc-500">
            {provider.allowedEmailDomains || "(unrestricted)"}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Form action={testAction}>
          <input name="providerId" type="hidden" value={provider.id} />
          <button
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-emerald-400 transition-colors"
            disabled={isTesting}
            title="Test discovery"
            type="submit"
          >
            <TestTube2 className="h-3.5 w-3.5" />
          </button>
        </Form>
        <button
          className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-sky-400 transition-colors"
          onClick={() => onEdit(provider)}
          title="Edit"
          type="button"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <Form
          action={deleteAction}
          onSubmit={(e) => {
            if (!confirm(`Delete provider "${provider.name}"? Users created via SSO will keep their accounts but won't be able to sign in through this provider anymore.`)) {
              e.preventDefault();
            }
          }}
        >
          <input name="providerId" type="hidden" value={provider.id} />
          <button
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400 transition-colors"
            disabled={isDeleting}
            title="Delete"
            type="submit"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Form>
      </div>
    </div>
  );
}

function LdapRow({
  config,
  onEdit,
}: {
  config: LdapConfigPublic;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3 last:border-b-0 hover:bg-[#111113] transition-colors">
      <div className="flex-1 min-w-[220px]">
        <div className="flex flex-wrap items-center gap-2">
          <Network className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-[13px] font-medium text-zinc-200">
            LDAP / Active Directory
          </span>
          <Badge variant={config.enabled ? "success" : "neutral"}>
            {config.enabled ? "enabled" : "disabled"}
          </Badge>
          <Badge variant="info">type: ldap</Badge>
          <Badge variant="neutral">{config.defaultRole}</Badge>
          {config.autoProvision && <Badge variant="warning">auto-provision</Badge>}
        </div>
        <p className="mt-0.5 text-[11px] text-zinc-600 font-mono">{config.url}</p>
        <p className="mt-0.5 text-[11px] text-zinc-600">
          Allowed domains:{" "}
          <span className="text-zinc-500">
            {config.allowedEmailDomains || "(unrestricted)"}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          onClick={onEdit}
          title="Edit"
          type="button"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ProviderTypeChooser({
  ldapAlreadyConfigured,
  onCancel,
  onPick,
}: {
  ldapAlreadyConfigured: boolean;
  onCancel: () => void;
  onPick: (type: "oidc" | "ldap") => void;
}) {
  return (
    <div className="space-y-4 px-5 py-6">
      <div>
        <h3 className="text-[14px] font-medium text-zinc-100">
          What kind of identity source?
        </h3>
        <p className="mt-1 text-[12px] text-zinc-500">
          Pick the protocol you want to add. Both authenticate users; OIDC
          adds a sign-in button, LDAP works transparently in the standard
          email + password form.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          className="flex flex-col items-start gap-2 rounded-lg border border-white/10 bg-[#111113] p-4 text-left transition-colors hover:border-white/25 hover:bg-white/[0.04]"
          onClick={() => onPick("oidc")}
          type="button"
        >
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-zinc-300" />
            <span className="text-[13px] font-medium text-zinc-100">
              OIDC (Single Sign-On)
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">
            Microsoft Entra, Google Workspace, Okta, Keycloak, Auth0 — anything
            speaking OpenID Connect. Adds a &quot;Sign in with X&quot; button to the
            login page.
          </p>
        </button>

        <button
          className="flex flex-col items-start gap-2 rounded-lg border border-white/10 bg-[#111113] p-4 text-left transition-colors hover:border-white/25 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-white/10 disabled:hover:bg-[#111113]"
          disabled={ldapAlreadyConfigured}
          onClick={() => onPick("ldap")}
          type="button"
        >
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-zinc-300" />
            <span className="text-[13px] font-medium text-zinc-100">
              LDAP / Active Directory
            </span>
            {ldapAlreadyConfigured ? (
              <Badge variant="neutral">already configured</Badge>
            ) : null}
          </div>
          <p className="text-[11px] text-zinc-500">
            Corporate AD or OpenLDAP. Authenticates transparently through the
            standard sign-in form — no separate button. Only one LDAP config
            is supported per Tainer install.
          </p>
        </button>
      </div>

      <div className="pt-2">
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function IdentityProviderManager({
  providers,
  ldapConfig,
}: {
  providers: IdpProviderPublic[];
  ldapConfig: LdapConfigPublic | null;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const totalCount = providers.length + (ldapConfig ? 1 : 0);

  if (mode.kind === "choose-type") {
    return (
      <ProviderTypeChooser
        ldapAlreadyConfigured={ldapConfig !== null}
        onCancel={() => setMode({ kind: "list" })}
        onPick={(type) =>
          setMode(type === "ldap" ? { kind: "create-ldap" } : { kind: "create-oidc" })
        }
      />
    );
  }

  if (mode.kind === "create-oidc" || mode.kind === "edit-oidc") {
    return (
      <ProviderForm
        initial={mode.kind === "edit-oidc" ? mode.provider : undefined}
        onCancel={() => setMode({ kind: "list" })}
        onSaved={() => setMode({ kind: "list" })}
      />
    );
  }

  if (mode.kind === "create-ldap" || mode.kind === "edit-ldap") {
    return (
      <div className="px-5 py-5">
        <LdapConfigForm
          config={mode.kind === "edit-ldap" ? ldapConfig : null}
          onCancel={() => setMode({ kind: "list" })}
          onSaved={() => setMode({ kind: "list" })}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
        <p className="text-[12px] text-zinc-500">
          {totalCount} identity source{totalCount === 1 ? "" : "s"} configured
        </p>
        <Button onClick={() => setMode({ kind: "choose-type" })} size="sm" variant="secondary">
          <Plus className="h-3.5 w-3.5" />
          Add provider
        </Button>
      </div>

      {totalCount === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-[13px] text-zinc-500">No identity sources yet.</p>
          <Button onClick={() => setMode({ kind: "choose-type" })} size="sm">
            <Plus className="h-3.5 w-3.5" />
            Add your first provider
          </Button>
        </div>
      ) : (
        <>
          {providers.map((p) => (
            <ProviderRow
              key={p.id}
              onEdit={(p) => setMode({ kind: "edit-oidc", provider: p })}
              provider={p}
            />
          ))}
          {ldapConfig ? (
            <LdapRow config={ldapConfig} onEdit={() => setMode({ kind: "edit-ldap" })} />
          ) : null}
        </>
      )}
    </div>
  );
}
