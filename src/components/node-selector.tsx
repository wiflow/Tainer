"use client";

import { useEffect, useMemo, useState } from "react";

import type { LiveNode, LiveNodeMetrics } from "@/lib/proxmox";

function computeBestNode(
  nodes: LiveNode[],
  metrics: LiveNodeMetrics[],
): string | null {
  let best: string | null = null;
  let bestScore = -1;

  for (const node of nodes) {
    if (node.status !== "online") continue;
    const m = metrics.find((entry) => entry.node === node.name);
    if (!m) continue;

    const freeMem = (m.memoryTotalBytes ?? 0) - (m.memoryUsedBytes ?? 0);
    const freeCpu = 1 - (m.cpuRatio ?? 1);
    const score = freeMem * 0.7 + freeCpu * 1e12 * 0.3;

    if (score > bestScore) {
      bestScore = score;
      best = node.name;
    }
  }

  return best;
}

function formatNodeLabel(
  node: LiveNode,
  metrics: LiveNodeMetrics[],
): string {
  const m = metrics.find((entry) => entry.node === node.name);
  if (!m || !m.memoryTotalBytes) return node.name;

  const usedMem = m.memoryUsedBytes ?? 0;
  const totalMem = m.memoryTotalBytes;
  const memPct = Math.round((usedMem / totalMem) * 100);
  const cpuPct = Math.round((m.cpuRatio ?? 0) * 100);

  return `${node.name} (CPU ${cpuPct}% · RAM ${memPct}%)`;
}

export function NodeSelector({
  className,
  defaultNode,
  metrics,
  name,
  nodes,
  suggestedNode,
}: {
  className?: string;
  defaultNode?: string;
  metrics: LiveNodeMetrics[];
  name: string;
  nodes: LiveNode[];
  suggestedNode?: string | null;
}) {
  const greedyBest = useMemo(() => computeBestNode(nodes, metrics), [nodes, metrics]);
  const bestNode = suggestedNode ?? greedyBest;
  const [value, setValue] = useState("__auto__");
  const [resolvedAuto, setResolvedAuto] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setResolvedAuto(bestNode);
    }, 600);
    return () => clearTimeout(timer);
  }, [bestNode]);

  const actualNode = value === "__auto__" ? (resolvedAuto ?? bestNode ?? defaultNode ?? "") : value;

  return (
    <>
      <input name={name} type="hidden" value={actualNode} />
      <select
        className={className}
        onChange={(e) => setValue(e.target.value)}
        value={value}
      >
        <option value="__auto__">
          {resolvedAuto
            ? `Automatic (${resolvedAuto})`
            : "Automatic (Loading...)"}
        </option>
        {nodes
          .filter((n) => n.status === "online")
          .map((node) => (
            <option key={node.name} value={node.name}>
              {formatNodeLabel(node, metrics)}
            </option>
          ))}
      </select>
    </>
  );
}
