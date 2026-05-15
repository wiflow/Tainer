import "server-only";

import { readFile } from "node:fs/promises";

import { resolveDataFilePath } from "@/lib/app-data";
import type {
  LldpAnnotationsStore,
  LldpDeviceAnnotation,
} from "@/lib/lldp-types";
import {
  createStoreMutator,
  writeJsonFileAtomically,
} from "@/lib/store-utils";

const DATA_FILE = "lldp-annotations.json";
const FRIENDLY_NAME_MAX = 80;
const NOTES_MAX = 500;
const PORT_COUNT_MAX = 256;

function emptyStore(): LldpAnnotationsStore {
  return { schemaVersion: 1, annotations: {} };
}

function keyFor(siteId: string, chassisId: string): string {
  return `${siteId}::${chassisId}`;
}

async function readStore(): Promise<LldpAnnotationsStore> {
  try {
    const raw = await readFile(await resolveDataFilePath(DATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<LldpAnnotationsStore>;
    return {
      schemaVersion: 1,
      annotations:
        parsed.annotations && typeof parsed.annotations === "object"
          ? parsed.annotations
          : {},
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: LldpAnnotationsStore): Promise<void> {
  const filePath = await resolveDataFilePath(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("lldp-annotations", readStore, writeStore);

export async function getLldpAnnotationsForSite(
  siteId: string,
): Promise<Record<string, LldpDeviceAnnotation>> {
  const store = await readStore();
  const out: Record<string, LldpDeviceAnnotation> = {};
  for (const [key, annotation] of Object.entries(store.annotations)) {
    if (annotation.siteId === siteId) out[annotation.chassisId] = annotation;
  }
  return out;
}

export async function getLldpAnnotation(
  siteId: string,
  chassisId: string,
): Promise<LldpDeviceAnnotation | null> {
  const store = await readStore();
  return store.annotations[keyFor(siteId, chassisId)] ?? null;
}

export type UpsertAnnotationInput = {
  siteId: string;
  chassisId: string;
  friendlyName: string;
  portCountOverride: string;
  notes: string;
  actorEmail: string;
};

/**
 * Normalises inputs, validates the bounds, and either creates a fresh
 * annotation or merges with the existing one. Empty strings clear the
 * corresponding field (back to LLDP fallback).
 */
export async function upsertLldpAnnotation(
  input: UpsertAnnotationInput,
): Promise<LldpDeviceAnnotation> {
  const friendlyName = input.friendlyName.trim().slice(0, FRIENDLY_NAME_MAX);
  const notes = input.notes.trim().slice(0, NOTES_MAX);
  const portCountTrim = input.portCountOverride.trim();
  let portCountOverride: number | null = null;
  if (portCountTrim) {
    const parsed = Number(portCountTrim);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > PORT_COUNT_MAX) {
      throw new Error(`Port count must be an integer between 1 and ${PORT_COUNT_MAX}.`);
    }
    portCountOverride = parsed;
  }

  return mutateStore((store) => {
    const key = keyFor(input.siteId, input.chassisId);
    const now = new Date().toISOString();
    const existing = store.annotations[key];
    const updated: LldpDeviceAnnotation = {
      siteId: input.siteId,
      chassisId: input.chassisId,
      friendlyName: friendlyName || null,
      portCountOverride,
      notes,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? input.actorEmail,
      updatedAt: now,
      updatedBy: input.actorEmail,
    };
    // If everything's blank, remove the annotation entirely so the row
    // doesn't carry orphan metadata.
    if (!updated.friendlyName && !updated.portCountOverride && !updated.notes) {
      delete store.annotations[key];
    } else {
      store.annotations[key] = updated;
    }
    return updated;
  });
}

export async function deleteLldpAnnotation(input: {
  siteId: string;
  chassisId: string;
}): Promise<boolean> {
  return mutateStore((store) => {
    const key = keyFor(input.siteId, input.chassisId);
    if (!store.annotations[key]) return false;
    delete store.annotations[key];
    return true;
  });
}
