import "server-only";

import { getNodes, getNodeAptUpdates, type NodeAptUpdate } from "@/lib/proxmox";

export type NodeUpdateSummary = {
  error: string | null;
  node: string;
  securityUpdates: number;
  status: string;
  totalUpdates: number;
  updates: NodeAptUpdate[];
};

export type ClusterUpdateSummary = {
  nodes: NodeUpdateSummary[];
  totalSecurityUpdates: number;
  totalUpdates: number;
};

export async function getClusterUpdates(): Promise<ClusterUpdateSummary> {
  const { nodes } = await getNodes();
  const onlineNodes = nodes.filter((n) => n.status === "online");

  const results = await Promise.allSettled(
    onlineNodes.map(async (node): Promise<NodeUpdateSummary> => {
      const updates = await getNodeAptUpdates(node.name);
      const securityUpdates = updates.filter(
        (u) =>
          u.priority === "important" ||
          u.priority === "required" ||
          u.origin.toLowerCase().includes("security"),
      );
      return {
        error: null,
        node: node.name,
        securityUpdates: securityUpdates.length,
        status: node.status,
        totalUpdates: updates.length,
        updates,
      };
    }),
  );

  const nodeSummaries = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          error: r.reason instanceof Error ? r.reason.message : "Failed to fetch updates",
          node: onlineNodes[i].name,
          securityUpdates: 0,
          status: "online",
          totalUpdates: 0,
          updates: [],
        },
  );

  return {
    nodes: nodeSummaries,
    totalSecurityUpdates: nodeSummaries.reduce((s, n) => s + n.securityUpdates, 0),
    totalUpdates: nodeSummaries.reduce((s, n) => s + n.totalUpdates, 0),
  };
}
