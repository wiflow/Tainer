"use client";

import { TestTube2, Trash2 } from "lucide-react";
import { useActionState } from "react";

import {
  deleteIpamIntegrationAction,
  testIpamIntegrationAction,
  upsertIpamIntegrationAction,
} from "@/app/integration-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import type { PhpIpamIntegrationPublic } from "@/lib/integrations";

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

const DEFAULT_TIMEOUT_MS = 3500;

export function IpamForm({
  initial,
  onCancel,
  onSaved,
  onDeleted,
}: {
  initial: PhpIpamIntegrationPublic | null;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
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
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteIpamIntegrationAction,
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
  useActionFlashFeedback(deleteState, {
    errorTitle: "Remove failed",
    successTitle: "Integration removed",
  });

  if (saveState.status === "success" && saveState.requestId) {
    queueMicrotask(onSaved);
  }
  if (deleteState.status === "success" && deleteState.requestId) {
    queueMicrotask(() => (onDeleted ?? onSaved)());
  }

  return (
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
        <div className="flex items-center gap-2">
          <Button
            disabled={isTesting}
            formAction={testAction}
            type="submit"
            variant="ghost"
          >
            <TestTube2 className="h-3.5 w-3.5" />
            {isTesting ? "Testing…" : "Test connection"}
          </Button>
          {isEdit && (
            <ConfirmSubmitButton
              className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              confirmLabel="Remove integration"
              consequences={[
                "IPAM-side reservations stop appearing alongside IP pools.",
                "Nothing in phpIPAM itself is changed or deleted.",
              ]}
              description="Remove the phpIPAM integration?"
              disabled={isDeleting}
              formAction={deleteAction}
              pending={isDeleting}
              title="Remove phpIPAM"
              variant="ghost"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isDeleting ? "Removing…" : "Remove"}
            </ConfirmSubmitButton>
          )}
        </div>
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
  );
}
