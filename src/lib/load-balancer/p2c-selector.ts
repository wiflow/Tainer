import { randomInt } from "node:crypto";
import type { NodeScore } from "./types";

const STALE_THRESHOLD_MS = 60_000;

/**
 * Power-of-Two-Choices (P2C) node selection.
 *
 * Picks 2 random nodes from the available pool and returns the one
 * with the lower composite score. This achieves O(log log n) expected
 * max load, significantly better than greedy selection's O(log n / log log n).
 */
export function selectNodeP2C(
  scores: NodeScore[],
  excludeNodes?: Set<string>,
): string | null {
  const now = Date.now();

  const candidates = scores.filter((s) => {
    if (excludeNodes?.has(s.node)) return false;
    if (now - s.updatedAt > STALE_THRESHOLD_MS) return false;
    return true;
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].node;

  const i = randomInt(candidates.length);
  let j = randomInt(candidates.length - 1);
  if (j >= i) j++;

  const a = candidates[i];
  const b = candidates[j];

  return a.compositeScore <= b.compositeScore ? a.node : b.node;
}
