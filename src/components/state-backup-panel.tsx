"use client";

import { useActionState, useState } from "react";
import { Download, HardDriveDownload, ShieldCheck } from "lucide-react";

import {
  runStateBackupNowAction,
  saveStateBackupSettingsAction,
} from "@/app/state-backup-actions";
import { useActionFlashFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { SectionPanel } from "@/components/ui/section-panel";
import { initialBasicActionState } from "@/lib/action-states";
import { formatBytes } from "@/lib/utils";

type PanelConfig = {
  enabled: boolean;
  scheduleHourUtc: number;
  retention: number;
  destinationDir: string;
  hasPassphrase: boolean;
  lastRun: {
    at: string;
    ok: boolean;
    message: string;
    file: string | null;
    sizeBytes: number | null;
    trigger: "manual" | "scheduled";
  } | null;
};

type BackupFileInfo = { name: string; sizeBytes: number; createdAt: string };

const inputClassName =
  "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

/**
 * Instance-wide (not per-site): backs up Tainer's own data directory —
 * users, sessions, encrypted site credentials, audit log, policies — as a
 * passphrase-encrypted archive. Tainer backs up guests; this backs up Tainer.
 */
export function StateBackupPanel({
  config,
  backups,
  defaultDestination,
}: {
  config: PanelConfig;
  backups: BackupFileInfo[];
  defaultDestination: string;
}) {
  const [saveState, saveAction, isSaving] = useActionState(
    saveStateBackupSettingsAction,
    initialBasicActionState,
  );
  const [runState, runAction, isRunning] = useActionState(
    runStateBackupNowAction,
    initialBasicActionState,
  );
  const [enabled, setEnabled] = useState(config.enabled);

  useActionFlashFeedback(saveState, {
    errorTitle: "State backup settings failed",
    successTitle: "State backup settings saved",
  });
  useActionFlashFeedback(runState, {
    errorTitle: "State backup failed",
    successTitle: "State backup created",
  });

  return (
    <SectionPanel
      title="Tainer state backup"
      description="Applies to the whole Tainer instance. Encrypts the data directory (users, sessions, site credentials, audit log, policies) with your passphrase. The Docker image library and previous backups are excluded."
    >
      <div className="space-y-6">
        <Form action={saveAction} className="space-y-4">
          <label className="flex items-center gap-2.5 text-[13px] text-zinc-200">
            <input
              checked={enabled}
              className="h-4 w-4 accent-emerald-500"
              name="enabledCheckbox"
              onChange={(e) => setEnabled(e.target.checked)}
              type="checkbox"
            />
            <input name="enabled" type="hidden" value={enabled ? "1" : "0"} />
            Run a scheduled backup daily
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-[12px] text-zinc-400">
              Daily after (UTC hour)
              <input
                className={inputClassName}
                defaultValue={config.scheduleHourUtc}
                inputMode="numeric"
                name="scheduleHourUtc"
                type="number"
                min={0}
                max={23}
              />
            </label>
            <label className="block text-[12px] text-zinc-400">
              Keep newest
              <input
                className={inputClassName}
                defaultValue={config.retention}
                inputMode="numeric"
                name="retention"
                type="number"
                min={1}
                max={60}
              />
            </label>
            <label className="block text-[12px] text-zinc-400">
              Destination directory
              <input
                className={inputClassName}
                defaultValue={config.destinationDir}
                name="destinationDir"
                placeholder={defaultDestination}
              />
            </label>
          </div>

          <label className="block text-[12px] text-zinc-400">
            Backup passphrase{" "}
            {config.hasPassphrase ? (
              <span className="text-emerald-400/80">
                (set — leave empty to keep the current one)
              </span>
            ) : (
              <span className="text-amber-300/90">(required before backups can run)</span>
            )}
            <input
              autoComplete="new-password"
              className={inputClassName}
              name="passphrase"
              placeholder={config.hasPassphrase ? "••••••••••••" : "At least 12 characters"}
              type="password"
            />
          </label>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            <ShieldCheck className="mr-1 inline h-3 w-3 align-[-2px]" />
            Restoring needs only this passphrase and{" "}
            <code className="text-zinc-400">scripts/restore-state-backup.mjs</code> — store it
            somewhere that survives losing this host (password manager). The default
            destination is on the same disk as the data itself; point it at a mounted
            share, or download copies below, for real disaster recovery.
          </p>

          <div className="flex items-center gap-2 border-t border-white/5 pt-4">
            <Button disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </Form>

        <div className="border-t border-white/5 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12px] text-zinc-400">
              {config.lastRun ? (
                <>
                  Last backup ({config.lastRun.trigger}):{" "}
                  <span className={config.lastRun.ok ? "text-emerald-400" : "text-rose-300"}>
                    {config.lastRun.ok ? "ok" : "failed"}
                  </span>{" "}
                  · {new Date(config.lastRun.at).toLocaleString()}
                  {!config.lastRun.ok ? (
                    <span className="text-zinc-500"> — {config.lastRun.message}</span>
                  ) : null}
                </>
              ) : (
                "No backup has run yet."
              )}
            </div>
            <Form action={runAction}>
              <Button
                disabled={isRunning || !config.hasPassphrase}
                size="sm"
                type="submit"
                variant="secondary"
              >
                <HardDriveDownload className="mr-1.5 h-3.5 w-3.5" />
                {isRunning ? "Backing up…" : "Back up now"}
              </Button>
            </Form>
          </div>

          {backups.length > 0 ? (
            <ul className="mt-3 divide-y divide-white/5 rounded-lg border border-white/5 bg-black/30">
              {backups.map((file) => (
                <li key={file.name} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-zinc-300">
                    {file.name}
                  </span>
                  <span className="flex-shrink-0 text-[11px] tabular-nums text-zinc-500">
                    {formatBytes(file.sizeBytes)}
                  </span>
                  <span className="hidden flex-shrink-0 text-[11px] text-zinc-600 sm:inline">
                    {new Date(file.createdAt).toLocaleString()}
                  </span>
                  <a
                    className="flex-shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
                    href={`/api/state-backup/download?file=${encodeURIComponent(file.name)}`}
                    title="Download encrypted backup"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </SectionPanel>
  );
}
