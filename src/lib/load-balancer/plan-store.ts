import "server-only";

import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

/**
 * Per-site persisted rebalance plan. One plan at a time: a draft is a
 * preview the admin can apply or discard; an applied ("active") plan is
 * executed by the observer one move at a time, each re-validated against
 * live cluster state, surviving Tainer restarts mid-plan.
 */

export type PlanMoveStatus = "queued" | "migrating" | "done" | "failed" | "skipped";

export type RebalancePlanMove = {
  vmid: number;
  name: string;
  type: "lxc" | "qemu";
  sourceNode: string;
  targetNode: string;
  memBytes: number;
  status: PlanMoveStatus;
  upid: string | null;
  error: string | null;
};

export type RebalancePlanStatus = "draft" | "active" | "completed" | "cancelled";

export type RebalancePlan = {
  id: string;
  createdAt: string;
  createdBy: string;
  status: RebalancePlanStatus;
  includeContainers: boolean;
  imbalanceBefore: number;
  imbalanceAfter: number;
  projectedScores: Array<{ node: string; before: number; after: number }>;
  moves: RebalancePlanMove[];
  updatedAt: string;
};

const DATA_FILE = "lb-plan.json";

type PlanStore = {
  plan: RebalancePlan | null;
};

async function readStore(): Promise<PlanStore> {
  try {
    const raw = await readFile(
      await resolveSiteDataFilePathFromContext(DATA_FILE),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<PlanStore>;
    return { plan: parsed.plan ?? null };
  } catch {
    return { plan: null };
  }
}

async function writeStore(store: PlanStore) {
  const filePath = await resolveSiteDataFilePathFromContext(DATA_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("load-balancer-plan", readStore, writeStore);

export async function getRebalancePlan(): Promise<RebalancePlan | null> {
  const store = await readStore();
  return store.plan;
}

/** Replaces any existing plan — the previous draft/terminal plan is dropped. */
export async function saveRebalancePlan(plan: RebalancePlan): Promise<RebalancePlan> {
  return mutateStore((store) => {
    store.plan = plan;
    return plan;
  });
}

export async function updateRebalancePlan(
  planId: string,
  update: (plan: RebalancePlan) => void,
): Promise<RebalancePlan | null> {
  return mutateStore((store) => {
    if (!store.plan || store.plan.id !== planId) return null;
    update(store.plan);
    store.plan.updatedAt = new Date().toISOString();
    return store.plan;
  });
}

export async function clearRebalancePlan(): Promise<void> {
  await mutateStore((store) => {
    store.plan = null;
    return undefined;
  });
}
