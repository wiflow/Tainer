import "server-only";

import { enrollGuestHostKey } from "@/lib/guest-host-keys";
import { extractSshHost } from "@/lib/guest-access";
import { encodeDeploymentId, getDeploymentDetail } from "@/lib/proxmox";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForDeploymentSshHost(input: {
  node: string;
  type: "lxc" | "qemu";
  vmid: number;
}, timeoutMs = 180_000) {
  const deploymentId = encodeDeploymentId(input.node, input.vmid, input.type);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const deployment = await getDeploymentDetail(deploymentId).catch(() => null);
    const host = deployment
      ? extractSshHost(deployment.networkInfo?.ipAddress ?? deployment.ipAddress)
      : null;

    if (deployment?.rawStatus === "running" && host) {
      return host;
    }

    await sleep(5_000);
  }

  return null;
}

export async function enrollProvisionedGuestHostKey(input: {
  node: string;
  type: "lxc" | "qemu";
  vmid: number;
}) {
  const host = await waitForDeploymentSshHost(input);

  if (!host) {
    return null;
  }

  return enrollGuestHostKey({
    host,
    node: input.node,
    type: input.type,
    vmid: input.vmid,
  });
}
