import type { CircuitBreakerSnapshot, CircuitBreakerState } from "./types";

const DEFAULT_FAILURE_THRESHOLD = 3;
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 300_000;

export class NodeCircuitBreaker {
  private states = new Map<string, CircuitBreakerState>();

  recordSuccess(node: string): void {
    this.states.set(node, {
      failures: 0,
      lastFailureAt: null,
      openUntil: null,
    });
  }

  recordFailure(node: string): void {
    const now = Date.now();
    const current = this.states.get(node);
    const failures = (current?.failures ?? 0) + 1;

    let openUntil: number | null = null;
    if (failures >= DEFAULT_FAILURE_THRESHOLD) {
      // Exponential backoff: 30s, 60s, 120s, 240s, 300s (capped)
      const exponent = failures - DEFAULT_FAILURE_THRESHOLD;
      const cooldown = Math.min(BASE_COOLDOWN_MS * Math.pow(2, exponent), MAX_COOLDOWN_MS);
      openUntil = now + cooldown;
    }

    this.states.set(node, {
      failures,
      lastFailureAt: now,
      openUntil,
    });
  }

  isAvailable(node: string): boolean {
    const state = this.states.get(node);
    if (!state || !state.openUntil) return true;
    if (Date.now() >= state.openUntil) return true; // half-open: allow probe
    return false;
  }

  getSnapshot(): CircuitBreakerSnapshot[] {
    const now = Date.now();
    const snapshots: CircuitBreakerSnapshot[] = [];

    for (const [node, state] of this.states) {
      let cbState: "closed" | "open" | "half-open" = "closed";
      if (state.openUntil) {
        cbState = now >= state.openUntil ? "half-open" : "open";
      }

      snapshots.push({
        node,
        state: cbState,
        failureCount: state.failures,
        lastFailureAt: state.lastFailureAt,
        cooldownEndsAt: state.openUntil,
      });
    }

    return snapshots;
  }

  getOpenNodes(): Set<string> {
    const open = new Set<string>();
    for (const [node] of this.states) {
      if (!this.isAvailable(node)) {
        open.add(node);
      }
    }
    return open;
  }

  prune(activeNodes: Set<string>): void {
    for (const node of this.states.keys()) {
      if (!activeNodes.has(node)) {
        this.states.delete(node);
      }
    }
  }
}
