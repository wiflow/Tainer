"use server";

import { randomUUID } from "node:crypto";
import path from "node:path";
import { revalidatePath } from "next/cache";

import { recordAdminAudit } from "@/lib/admin-audit-log";
import type { BasicActionState } from "@/lib/action-states";
import { requireAdminSession } from "@/lib/auth";
import {
  createStateBackup,
  getStateBackupConfig,
  hasStateBackupPassphrase,
  saveStateBackupConfig,
} from "@/lib/state-backup";

function errorState(message: string): BasicActionState {
  return { message, requestId: randomUUID(), status: "error" };
}

const MIN_PASSPHRASE_LENGTH = 12;

export async function saveStateBackupSettingsAction(
  _previousState: BasicActionState,
  formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();

    const enabled = formData.get("enabled") === "1";
    const scheduleHourUtc = Number.parseInt(String(formData.get("scheduleHourUtc") ?? "3"), 10);
    const retention = Number.parseInt(String(formData.get("retention") ?? "7"), 10);
    const destinationDir = String(formData.get("destinationDir") ?? "").trim();
    const passphrase = String(formData.get("passphrase") ?? "").trim();

    if (!Number.isInteger(scheduleHourUtc) || scheduleHourUtc < 0 || scheduleHourUtc > 23) {
      return errorState("Schedule hour must be 0-23 (UTC).");
    }
    if (!Number.isInteger(retention) || retention < 1 || retention > 60) {
      return errorState("Retention must be between 1 and 60 backups.");
    }
    if (destinationDir && !path.isAbsolute(destinationDir)) {
      return errorState("Destination must be an absolute path (or empty for the default).");
    }
    if (passphrase && passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return errorState(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }

    const current = await getStateBackupConfig();
    if (enabled && !passphrase && !hasStateBackupPassphrase(current)) {
      return errorState("Set a passphrase before enabling scheduled backups.");
    }

    await saveStateBackupConfig({
      enabled,
      scheduleHourUtc,
      retention,
      destinationDir,
      passphrase: passphrase || null,
    });

    await recordAdminAudit({
      action: "state-backup-settings-updated",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `State backup settings updated (enabled=${enabled}, hour=${String(
        scheduleHourUtc,
      ).padStart(2, "0")}:00 UTC, retention=${retention}${
        passphrase ? ", passphrase changed" : ""
      })`,
    });

    revalidatePath("/sites");
    return {
      message: "State backup settings saved.",
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(
      error instanceof Error ? error.message : "Failed to save state backup settings.",
    );
  }
}

export async function runStateBackupNowAction(
  _previousState: BasicActionState,
  _formData: FormData,
): Promise<BasicActionState> {
  try {
    const session = await requireAdminSession();

    const result = await createStateBackup("manual");
    if (!result.ok) return errorState(result.message);

    await recordAdminAudit({
      action: "state-backup-created",
      actorEmail: session.user.email,
      actorName: session.user.name,
      message: `Manual state backup created: ${result.file} (${result.sizeBytes} bytes)`,
    });

    revalidatePath("/sites");
    return {
      message: `Backup created: ${result.file}`,
      requestId: randomUUID(),
      status: "success",
    };
  } catch (error) {
    return errorState(error instanceof Error ? error.message : "State backup failed.");
  }
}
