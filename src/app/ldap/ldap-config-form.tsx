"use client";

import { TestTube2, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import {
  deleteLdapConfigAction,
  saveLdapConfigAction,
  testLdapConnectionAction,
} from "@/app/ldap-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { LdapConfigPublic } from "@/lib/ldap-config";

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

const labelClassName = "block text-[12px] font-medium text-zinc-300";
const helpClassName = "mt-1 text-[11px] text-zinc-500";

const DEFAULT_USER_FILTER = "(&(objectClass=user)(mail={email}))";

export function LdapConfigForm({
  config,
  onCancel,
  onSaved,
}: {
  config: LdapConfigPublic | null;
  /** Optional — if provided, a Cancel button is rendered that calls back. */
  onCancel?: () => void;
  /** Optional — called after a successful save / delete so the parent can
   * close the form view and return to its list/manager. */
  onSaved?: () => void;
}) {
  const [saveState, saveAction, isSaving] = useActionState(
    saveLdapConfigAction,
    initialBasicActionState,
  );
  const [testState, testAction, isTesting] = useActionState(
    testLdapConnectionAction,
    initialBasicActionState,
  );
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteLdapConfigAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(saveState, {
    errorTitle: "Save failed",
    successTitle: "LDAP saved",
  });
  useActionFlashFeedback(testState, {
    errorTitle: "Connection test failed",
    successTitle: "Connection OK",
  });
  useActionFlashFeedback(deleteState, {
    errorTitle: "Delete failed",
    successTitle: "LDAP removed",
  });

  // Bubble save / delete success back up to the parent manager so it can
  // close this form and return to the provider list. We only fire on
  // requestId changes so the same success doesn't re-trigger across
  // re-renders.
  useEffect(() => {
    if (saveState.status === "success" && onSaved) onSaved();
  }, [saveState.status, saveState.requestId, onSaved]);
  useEffect(() => {
    if (deleteState.status === "success" && onSaved) onSaved();
  }, [deleteState.status, deleteState.requestId, onSaved]);

  // Surface the "change password" UI only on demand. New deployments always
  // show the password field; for existing configs we hide it behind a toggle
  // so admins don't accidentally clobber the stored secret with an empty
  // value (the server-side rule treats empty as "leave unchanged" but a
  // visible empty field invites confusion).
  const [changePassword, setChangePassword] = useState(!config?.hasBindPassword);

  return (
    <div className="space-y-6">
      {config ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/[0.05] bg-zinc-900/60 p-3 text-[12px]">
          <Badge variant={config.enabled ? "success" : "neutral"}>
            {config.enabled ? "Enabled" : "Disabled"}
          </Badge>
          {config.hasBindPassword ? (
            <Badge variant="info">Bind password stored</Badge>
          ) : (
            <Badge variant="warning">Bind password missing</Badge>
          )}
          <span className="text-zinc-500">
            Last updated {new Date(config.updatedAt).toLocaleString()}
          </span>
        </div>
      ) : (
        <div className="rounded-md border border-white/[0.05] bg-zinc-900/60 p-3 text-[12px] text-zinc-400">
          No LDAP configuration yet. Fill in the fields below and save to
          enable directory authentication on the standard sign-in form.
        </div>
      )}

      <Form action={saveAction} className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className={labelClassName}>LDAP server URL</span>
            <input
              autoComplete="off"
              className={fieldClassName}
              defaultValue={config?.url ?? ""}
              name="url"
              placeholder="ldaps://ad.corp.example.com:636"
              required
            />
            <p className={helpClassName}>
              <code>ldaps://</code> required by default. Plain <code>ldap://</code>{" "}
              is refused unless <code>TAINER_LDAP_ALLOW_INSECURE=true</code> is
              set (development only — bind password sent in clear).
            </p>
          </label>

          <label className="block">
            <span className={labelClassName}>Search base</span>
            <input
              autoComplete="off"
              className={fieldClassName}
              defaultValue={config?.searchBase ?? ""}
              name="searchBase"
              placeholder="dc=corp,dc=example,dc=com"
              required
            />
            <p className={helpClassName}>
              Subtree under which the user search runs.
            </p>
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className={labelClassName}>Bind DN (service account)</span>
            <input
              autoComplete="off"
              className={fieldClassName}
              defaultValue={config?.bindDN ?? ""}
              name="bindDN"
              placeholder="CN=tainer-svc,OU=Service Accounts,DC=corp,DC=example,DC=com"
              required
            />
            <p className={helpClassName}>
              Use a read-only service account scoped to the user subtree.
            </p>
          </label>

          <label className="block">
            <span className={labelClassName}>
              Bind password
              {config?.hasBindPassword && !changePassword ? (
                <button
                  className="ml-2 text-[11px] font-normal text-sky-400 hover:underline"
                  onClick={() => setChangePassword(true)}
                  type="button"
                >
                  change…
                </button>
              ) : null}
            </span>
            {changePassword ? (
              <input
                autoComplete="new-password"
                className={fieldClassName}
                name="bindPassword"
                placeholder={config?.hasBindPassword ? "Enter new bind password" : "Enter bind password"}
                type="password"
                required={!config?.hasBindPassword}
              />
            ) : (
              <div className="mt-1.5 rounded-md border border-white/[0.05] bg-zinc-900 px-3 py-2 text-[12px] text-zinc-500">
                Stored. Encrypted at rest.
              </div>
            )}
            <p className={helpClassName}>
              Encrypted with AES-256-GCM at rest in <code>ldap-config.json</code>.
              Never returned to this form. Re-enter it when changing the server
              URL or bind DN.
            </p>
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className={labelClassName}>User search filter</span>
            <input
              autoComplete="off"
              className={fieldClassName}
              defaultValue={config?.userFilter ?? DEFAULT_USER_FILTER}
              name="userFilter"
              placeholder={DEFAULT_USER_FILTER}
              required
            />
            <p className={helpClassName}>
              Must contain <code>{"{email}"}</code>. The supplied value is
              RFC-4515 escaped before substitution — safe against LDAP
              injection.
            </p>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={labelClassName}>Email attribute</span>
              <input
                autoComplete="off"
                className={fieldClassName}
                defaultValue={config?.emailAttribute ?? "mail"}
                name="emailAttribute"
                placeholder="mail"
                required
              />
              <p className={helpClassName}>Usually <code>mail</code>.</p>
            </label>

            <label className="block">
              <span className={labelClassName}>Name attribute</span>
              <input
                autoComplete="off"
                className={fieldClassName}
                defaultValue={config?.nameAttribute ?? "displayName"}
                name="nameAttribute"
                placeholder="displayName"
              />
              <p className={helpClassName}>Falls back to <code>cn</code>.</p>
            </label>
          </div>
        </div>

        <label className="block">
          <span className={labelClassName}>Allowed email domains</span>
          <input
            autoComplete="off"
            className={fieldClassName}
            defaultValue={config?.allowedEmailDomains ?? ""}
            name="allowedEmailDomains"
            placeholder="corp.example.com, subsidiary.example.com"
          />
          <p className={helpClassName}>
            Comma-separated. Empty = no domain restriction.
          </p>
        </label>

        {/* defaultRole stays in the data model for backward compatibility
            but auto-provisioning always creates users as operators with
            no group memberships (zero permissions / "guest read-only").
            Admin promotion happens explicitly via /users group assignment. */}
        <input name="defaultRole" type="hidden" value="operator" />

        <div className="rounded-md border border-white/[0.05] bg-zinc-900/40 p-3">
          <p className="text-[11px] text-zinc-400">
            Auto-provisioned users land with{" "}
            <span className="text-zinc-200">no groups and no permissions</span>.
            They can sign in and view their account; an admin must assign
            them to groups via the <span className="text-zinc-200">Users</span>{" "}
            page to grant access.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-2">
          <label className="flex items-center gap-2">
            <input
              defaultChecked={config?.autoProvision ?? false}
              name="autoProvision"
              type="checkbox"
            />
            <span className="text-[13px] text-zinc-200">
              Auto-provision unknown users on first successful login
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              defaultChecked={config?.enabled ?? true}
              name="enabled"
              type="checkbox"
            />
            <span className="text-[13px] text-zinc-200">Enabled</span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button disabled={isSaving} type="submit" variant="accent">
            {isSaving ? "Saving…" : "Save configuration"}
          </Button>
          {onCancel ? (
            <Button onClick={onCancel} type="button" variant="ghost">
              Cancel
            </Button>
          ) : null}
          {config?.hasBindPassword ? (
            <>
              <Button
                disabled={isTesting}
                formAction={testAction}
                type="submit"
                variant="secondary"
              >
                <TestTube2 className="h-3.5 w-3.5" />
                {isTesting ? "Testing…" : "Test connection"}
              </Button>
              <ConfirmSubmitButton
                confirmLabel="Remove LDAP"
                consequences={[
                  "Users who sign in via LDAP lose access until it is reconfigured.",
                  "Local accounts and their passwords are unaffected.",
                ]}
                description="Remove the LDAP configuration?"
                disabled={isDeleting}
                formAction={deleteAction}
                pending={isDeleting}
                title="Remove LDAP configuration"
                variant="danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isDeleting ? "Removing…" : "Remove"}
              </ConfirmSubmitButton>
            </>
          ) : null}
        </div>
      </Form>
    </div>
  );
}
