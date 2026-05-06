"use client";

import { Network, Pencil, Plus, TestTube2, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";

import {
  deleteIpamIntegrationAction,
  testIpamIntegrationAction,
  upsertIpamIntegrationAction,
} from "@/app/integration-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { PhpIpamIntegrationPublic } from "@/lib/integrations";

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

const DEFAULT_TIMEOUT_MS = 3500;

type Mode =
  | { kind: "list" }
  | { kind: "edit-ipam" };

function IpamForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: PhpIpamIntegrationPublic | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = initial !== null;
  const [saveState, saveAction, isSaving] = useActionState(
    upsertIpamIntegrationAction,
    initialBasicActionState,
  );
  const [testState, testAction, isTesting] = useActionState(
    testIpamIntegrationAction,
    initialBasicActionState,
  );

  useActionFlashFeedback(saveState, {
    errorTitle: isEdit ? "Update failed" : "Setup failed",
    successTitle: isEdit ? "Integration updated" : "Integration configured",
  });
  useActionFlashFeedback(testState, {
    errorTitle: "Connection test failed",
    successTitle: "Connection test passed",
  });

  if (saveState.status === "success" && saveState.requestId) {
    queueMicrotask(onSaved);
  }

  return (
    <div className="space-y-4 px-5 py-5">
      <div>
        <h3 className="text-[14px] font-medium text-zinc-100">
          phpIPAM connection
        </h3>
        <p className="mt-1 text-[12px] text-zinc-500">
          Tainer reads subnet reservations from phpIPAM when sizing IP pools so
          static deployments don&apos;t collide with addresses already in use
          elsewhere.
        </p>
      </div>

      <Form action={saveAction} className="space-y-4">
        <label className="block">
          <span className="text-[12px] font-medium text-zinc-400">Server URL</span>
          <input
            className={`${fieldClassName} font-mono text-[12px]`}
            defaultValue={initial?.serverUrl ?? ""}
            name="serverUrl"
            placeholder="https://ipam.example.com"
            required
            type="url"
          />
          <span className="mt-1 block text-[11px] text-zinc-600">
            Root of the phpIPAM install — Tainer will append{" "}
            <code>/api/&#123;app&#125;</code> when calling.
          </span>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-medium text-zinc-400">App ID</span>
            <input
              className={`${fieldClassName} font-mono text-[12px]`}
              defaultValue={initial?.appId ?? ""}
              name="appId"
              placeholder="tainer"
              required
            />
            <span className="mt-1 block text-[11px] text-zinc-600">
              The API app you created in phpIPAM under{" "}
              <em>Administration → API</em>.
            </span>
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-zinc-400">
              API token{isEdit && initial?.hasToken ? " (leave blank to keep)" : ""}
            </span>
            <input
              className={`${fieldClassName} font-mono text-[12px]`}
              name="token"
              placeholder={isEdit && initial?.hasToken ? "•••••••••••• (unchanged)" : ""}
              required={!isEdit}
              type="password"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-medium text-zinc-400">
              Timeout (ms)
            </span>
            <input
              className={fieldClassName}
              defaultValue={initial?.timeoutMs ?? DEFAULT_TIMEOUT_MS}
              max={30000}
              min={500}
              name="timeoutMs"
              type="number"
            />
            <span className="mt-1 block text-[11px] text-zinc-600">
              How long to wait per request before giving up. Default 3500&nbsp;ms.
            </span>
          </label>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="flex items-center gap-2">
              <input
                defaultChecked={initial?.tlsInsecure ?? false}
                className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
                name="tlsInsecure"
                type="checkbox"
              />
              <span className="text-[13px] text-zinc-200">
                Skip TLS verification{" "}
                <span className="text-zinc-500 text-[11px]">
                  (only for self-signed certs)
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                defaultChecked={initial?.enabled ?? true}
                className="h-4 w-4 rounded border-white/10 bg-zinc-900 text-sky-400"
                name="enabled"
                type="checkbox"
              />
              <span className="text-[13px] text-zinc-200">
                Enabled (Tainer will query phpIPAM for IP-pool usage)
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-4">
          {/* Test button submits the same form to a different action.
              Browsers honour `formAction` on the submit button, so the
              user can probe their input before saving. */}
          <Button
            disabled={isTesting}
            formAction={testAction}
            type="submit"
            variant="ghost"
          >
            <TestTube2 className="h-3.5 w-3.5" />
            {isTesting ? "Testing…" : "Test connection"}
          </Button>
          <div className="flex items-center gap-2">
            <Button onClick={onCancel} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : isEdit ? "Save changes" : "Connect"}
            </Button>
          </div>
        </div>
      </Form>
    </div>
  );
}

function IpamRow({
  ipam,
  onEdit,
}: {
  ipam: PhpIpamIntegrationPublic;
  onEdit: () => void;
}) {
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteIpamIntegrationAction,
    initialBasicActionState,
  );
  useActionFlashFeedback(deleteState, {
    errorTitle: "Remove failed",
    successTitle: "Integration removed",
  });

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3 last:border-b-0 hover:bg-[#111113] transition-colors">
      <div className="flex-1 min-w-[220px]">
        <div className="flex flex-wrap items-center gap-2">
          <Network className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-[13px] font-medium text-zinc-200">phpIPAM</span>
          <Badge variant={ipam.enabled ? "success" : "neutral"}>
            {ipam.enabled ? "enabled" : "disabled"}
          </Badge>
          <Badge variant="info">app: {ipam.appId}</Badge>
          {ipam.tlsInsecure ? (
            <Badge variant="warning">tls-insecure</Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-[11px] text-zinc-600 font-mono">{ipam.serverUrl}</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-sky-400 transition-colors"
          onClick={onEdit}
          title="Edit"
          type="button"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <Form
          action={deleteAction}
          onSubmit={(e) => {
            if (!confirm(
              "Remove the phpIPAM integration? Tainer will stop showing IPAM-side reservations alongside IP pools until it's reconfigured.",
            )) {
              e.preventDefault();
            }
          }}
        >
          <button
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-red-400 transition-colors"
            disabled={isDeleting}
            title="Remove"
            type="submit"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Form>
      </div>
    </div>
  );
}

export function IntegrationsManager({
  ipam,
}: {
  ipam: PhpIpamIntegrationPublic | null;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  if (mode.kind === "edit-ipam") {
    return (
      <IpamForm
        initial={ipam}
        onCancel={() => setMode({ kind: "list" })}
        onSaved={() => setMode({ kind: "list" })}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
        <p className="text-[12px] text-zinc-500">
          {ipam ? "1 integration configured" : "No integrations configured"}
        </p>
        {!ipam && (
          <Button onClick={() => setMode({ kind: "edit-ipam" })} size="sm" variant="secondary">
            <Plus className="h-3.5 w-3.5" />
            Connect phpIPAM
          </Button>
        )}
      </div>

      {ipam ? (
        <IpamRow ipam={ipam} onEdit={() => setMode({ kind: "edit-ipam" })} />
      ) : (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Network className="h-6 w-6 text-zinc-700" />
          <div>
            <p className="text-[13px] text-zinc-300">phpIPAM</p>
            <p className="mt-1 max-w-sm text-[12px] text-zinc-500">
              Connect a phpIPAM server so Tainer can pull live subnet
              reservations into IP-pool views.
            </p>
          </div>
          <Button onClick={() => setMode({ kind: "edit-ipam" })} size="sm">
            <Plus className="h-3.5 w-3.5" />
            Connect phpIPAM
          </Button>
        </div>
      )}
    </div>
  );
}
