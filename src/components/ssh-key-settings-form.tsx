"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, RefreshCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  deleteSshKeyAction,
  generateSshKeyAction,
} from "@/app/ssh-key-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import { useSiteBasePath } from "@/lib/use-site-path";

type SshKeyInfo = {
  fingerprint: string;
  generatedAt: string;
  managedLoginUser: string;
  publicKey: string;
};

export function SshKeySettingsForm({
  keyInfo,
}: {
  keyInfo: SshKeyInfo | null;
}) {
  const router = useRouter();
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");

  // Generate key
  const [genState, genAction, genPending] = useActionState(
    generateSshKeyAction,
    initialBasicActionState,
  );
  useActionFlashFeedback(genState, {
    errorTitle: "SSH authority generation failed",
    successTitle: "SSH authority generated",
  });

  // Delete key
  const [delState, delAction, delPending] = useActionState(
    deleteSshKeyAction,
    initialBasicActionState,
  );
  useActionFlashFeedback(delState, {
    errorTitle: "SSH authority deletion failed",
    successTitle: "SSH authority deleted",
  });

  // Refresh after generate/delete
  useEffect(() => {
    if (genState.status === "success" || delState.status === "success") {
      router.refresh();
    }
  }, [genState.status, delState.status, router]);

  // Show/hide public key
  const [showPublicKey, setShowPublicKey] = useState(false);

  // Confirm delete
  const [confirmDelete, setConfirmDelete] = useState(false);

  const delFormRef = useRef<HTMLFormElement>(null);

  const handleDelete = useCallback(() => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 5000);
      return;
    }
    delFormRef.current?.requestSubmit();
    setConfirmDelete(false);
  }, [confirmDelete]);

  return (
    <SectionPanel
      title="Tainer SSH Authority"
      description="Tainer signs short-lived SSH certificates with this server-only CA. New SSH-ready Linux templates must trust the public key below and create the managed access user ahead of time."
    >
        {keyInfo ? (
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <div>
                  <p className="text-[12px] font-medium text-zinc-500">Fingerprint</p>
                  <p className="mt-1 font-mono text-[13px] text-zinc-200">{keyInfo.fingerprint}</p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <div>
                  <p className="text-[12px] font-medium text-zinc-500">Generated</p>
                  <p className="mt-1 text-[13px] text-zinc-300">
                    {new Date(keyInfo.generatedAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                <div>
                  <p className="text-[12px] font-medium text-zinc-500">Managed login user</p>
                  <p className="mt-1 font-mono text-[13px] text-zinc-200">{keyInfo.managedLoginUser}</p>
                </div>
              </div>

              {showPublicKey ? (
                <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
                  <p className="text-[12px] font-medium text-zinc-500">CA public key</p>
                  <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-zinc-400">
                    {keyInfo.publicKey}
                  </p>
                  <button
                    className="mt-2 text-[12px] text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
                    onClick={() => setShowPublicKey(false)}
                    type="button"
                  >
                    Hide
                  </button>
                </div>
              ) : (
                <button
                  className="text-[12px] text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
                  onClick={() => setShowPublicKey(true)}
                  type="button"
                >
                  Show public key
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-white/5 pt-4">
              <Form action={genAction}>
                <input name="siteSlug" type="hidden" value={siteSlug} />
                <Button disabled={genPending} type="submit" variant="secondary">
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {genPending ? "Regenerating..." : "Rotate authority"}
                </Button>
              </Form>

              <Form ref={delFormRef} action={delAction} className="hidden">
                <input name="siteSlug" type="hidden" value={siteSlug} />
              </Form>
              <Button
                disabled={delPending}
                onClick={handleDelete}
                type="button"
                variant="danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {delPending
                  ? "Deleting..."
                  : confirmDelete
                    ? "Confirm delete"
                    : "Delete authority"}
              </Button>
            </div>

            <p className="text-[11px] leading-relaxed text-zinc-600">
              The CA private key is encrypted at rest and never leaves the server. Rotating it invalidates
              existing SSH-ready templates and guests until they are rebuilt to trust the new CA.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-md border border-dashed border-white/10 bg-zinc-900/20 p-6 text-center">
              <KeyRound className="mx-auto h-8 w-8 text-zinc-600" />
              <p className="mt-3 text-[13px] text-zinc-400">
                No SSH authority configured.
              </p>
              <p className="mt-1 text-[12px] text-zinc-600">
                Generate a server-only SSH CA before enabling managed in-app guest access.
              </p>
            </div>

            <Form action={genAction}>
              <input name="siteSlug" type="hidden" value={siteSlug} />
              <Button disabled={genPending} type="submit">
                <KeyRound className="h-3.5 w-3.5" />
                {genPending ? "Generating..." : "Generate SSH authority"}
              </Button>
            </Form>
          </div>
        )}
    </SectionPanel>
  );
}
