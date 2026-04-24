import "server-only";

import type { LiveDeploymentDetail } from "@/lib/proxmox";
import type { SshKeyInfo } from "@/lib/ssh-keys";

export const SSH_CERT_PRINCIPAL = "tainer";
export const SSH_STEP_UP_COOKIE_NAME = "tainer_guest_shell_stepup";
export const SSH_STEP_UP_TTL_MINUTES = 5;
export const SSH_CERT_TTL_MINUTES = 5;

export type GuestAccessStatus =
  | "External Access Only"
  | "Legacy Guest"
  | "Provisioning"
  | "SSH Ready"
  | "Unsupported OS";

export type HostKeyState = "missing" | "pinned";

export type GuestHostKeySummary = {
  host: string;
  pinnedAt: string;
};

export type ResolvedGuestAccess = {
  accessMessage: string;
  accessStatus: GuestAccessStatus;
  hostKeyState: HostKeyState;
  managedLoginUser: string | null;
  supportsInAppAccess: boolean;
};

export function extractSshHost(ipAddress?: string | null) {
  const normalized = String(ipAddress ?? "").trim();

  if (!normalized || normalized === "Unavailable" || normalized === "No IP" || normalized === "DHCP") {
    return null;
  }

  const host = normalized.split("/")[0]?.trim() ?? "";
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ? host : null;
}

export function isLinuxGuest(detail: Pick<LiveDeploymentDetail, "type" | "guestOsType">) {
  if (detail.type === "lxc") {
    return true;
  }

  const normalized = detail.guestOsType?.trim().toLowerCase() ?? "";
  return normalized.startsWith("l");
}

export function isWindowsGuest(detail: Pick<LiveDeploymentDetail, "type" | "guestOsType">) {
  if (detail.type !== "qemu") {
    return false;
  }

  const normalized = detail.guestOsType?.trim().toLowerCase() ?? "";
  return normalized.startsWith("win");
}

const POSIX_USERNAME_REGEX = /^[a-z_][a-z0-9_-]{0,31}$/;

export function buildCloudInitUserData(authorityPublicKey: string, managedLoginUser: string) {
  if (!POSIX_USERNAME_REGEX.test(managedLoginUser)) {
    throw new Error(
      "Managed login user must be a valid POSIX username (lowercase letters, digits, hyphens, underscores; 1-32 chars; must start with a letter or underscore).",
    );
  }

  const escapedAuthority = authorityPublicKey.replace(/\n+$/g, "");
  const escapedPrincipal = SSH_CERT_PRINCIPAL;

  return `#cloud-config
users:
  - default
  - name: ${managedLoginUser}
    gecos: Tainer managed access
    shell: /bin/bash
    lock_passwd: true

write_files:
  - path: /etc/ssh/tainer_user_ca.pub
    permissions: "0644"
    content: |
      ${escapedAuthority}
  - path: /etc/ssh/auth_principals/${managedLoginUser}
    permissions: "0644"
    content: |
      ${escapedPrincipal}
  - path: /etc/ssh/sshd_config.d/60-tainer-managed.conf
    permissions: "0644"
    content: |
      PubkeyAuthentication yes
      PasswordAuthentication no
      PermitRootLogin no
      TrustedUserCAKeys /etc/ssh/tainer_user_ca.pub
      AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u

runcmd:
  - ["/bin/sh", "-lc", "mkdir -p /etc/ssh/auth_principals"]
  - ["/bin/sh", "-lc", "systemctl restart ssh || systemctl restart sshd || service ssh restart || service sshd restart || true"]
`;
}

export function resolveGuestAccessState(input: {
  authorityInfo: SshKeyInfo | null;
  currentHost: string | null;
  deployment: LiveDeploymentDetail;
  pinnedHostKey: GuestHostKeySummary | null;
}): ResolvedGuestAccess {
  const { authorityInfo, currentHost, deployment, pinnedHostKey } = input;
  const guestAccess = deployment.tainerMeta?.guestAccess;

  if (isWindowsGuest(deployment)) {
    return {
      accessMessage: "Windows guests are intentionally handled outside Tainer for now.",
      accessStatus: "Unsupported OS",
      hostKeyState: "missing",
      managedLoginUser: null,
      supportsInAppAccess: false,
    };
  }

  if (!isLinuxGuest(deployment)) {
    return {
      accessMessage: "This guest does not advertise a Linux SSH access profile.",
      accessStatus: "Unsupported OS",
      hostKeyState: "missing",
      managedLoginUser: null,
      supportsInAppAccess: false,
    };
  }

  if (!guestAccess || guestAccess.method !== "ssh-ca") {
    return {
      accessMessage: "This guest predates the managed SSH model and stays external-only.",
      accessStatus: "Legacy Guest",
      hostKeyState: "missing",
      managedLoginUser: null,
      supportsInAppAccess: false,
    };
  }

  if (!authorityInfo) {
    return {
      accessMessage: "Generate the Tainer SSH authority in Settings before opening in-app shells.",
      accessStatus: "External Access Only",
      hostKeyState: "missing",
      managedLoginUser: guestAccess.managedLoginUser,
      supportsInAppAccess: false,
    };
  }

  if (guestAccess.authorityFingerprint !== authorityInfo.fingerprint) {
    return {
      accessMessage: "This guest trusts an older Tainer SSH authority and must be reprovisioned or migrated.",
      accessStatus: "External Access Only",
      hostKeyState: "missing",
      managedLoginUser: guestAccess.managedLoginUser,
      supportsInAppAccess: false,
    };
  }

  if (!currentHost || deployment.rawStatus !== "running") {
    return {
      accessMessage: deployment.rawStatus !== "running"
        ? "Start the guest to complete SSH onboarding."
        : "Waiting for a reachable guest IP address.",
      accessStatus: "Provisioning",
      hostKeyState: "missing",
      managedLoginUser: guestAccess.managedLoginUser,
      supportsInAppAccess: false,
    };
  }

  if (!pinnedHostKey || pinnedHostKey.host !== currentHost) {
    return {
      accessMessage: "SSH host key still needs enrollment before strict verification can be enforced.",
      accessStatus: "Provisioning",
      hostKeyState: "missing",
      managedLoginUser: guestAccess.managedLoginUser,
      supportsInAppAccess: false,
    };
  }

  return {
    accessMessage: `Pinned SSH host key is ready for ${guestAccess.managedLoginUser}@${currentHost}.`,
    accessStatus: "SSH Ready",
    hostKeyState: "pinned",
    managedLoginUser: guestAccess.managedLoginUser,
    supportsInAppAccess: true,
  };
}
