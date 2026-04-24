const MARKER = "---tainer-meta---";

export type TainerGuestAccessMeta = {
  authorityFingerprint: string;
  managedLoginUser: string;
  method: "ssh-ca";
  osFamily: "linux" | "windows";
  provisionedBy: "cloud-init" | "lxc-template";
};

export type TainerLocalSshMeta = {
  createdAt: string;
  fingerprint: string;
  loginUser: string;
  mode: "generated" | "uploaded";
};

export type TainerMeta = {
  templateId: string;
  templateName: string;
  deployedAt: string;
  templateVersion: string;
  imageVolid?: string;
  imageSize?: number;
  imageCtime?: number;
  guestAccess?: TainerGuestAccessMeta;
  localSsh?: TainerLocalSshMeta;
};

export function parseTainerMeta(description: string): TainerMeta | null {
  const idx = description.indexOf(MARKER);
  if (idx === -1) return null;

  const jsonStr = description.slice(idx + MARKER.length).trim();
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);
    if (
      typeof parsed.templateId === "string" &&
      typeof parsed.templateName === "string" &&
      typeof parsed.deployedAt === "string" &&
      typeof parsed.templateVersion === "string"
    ) {
      const guestAccess = parseGuestAccessMeta(parsed.guestAccess);

      return {
        templateId: parsed.templateId,
        templateName: parsed.templateName,
        deployedAt: parsed.deployedAt,
        templateVersion: parsed.templateVersion,
        guestAccess,
        localSsh: parseLocalSshMeta(parsed.localSsh),
        imageVolid: parsed.imageVolid ?? undefined,
        imageSize: parsed.imageSize ?? undefined,
        imageCtime: parsed.imageCtime ?? undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function parseGuestAccessMeta(value: unknown): TainerGuestAccessMeta | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<Record<keyof TainerGuestAccessMeta, unknown>>;

  if (
    typeof candidate.authorityFingerprint !== "string" ||
    typeof candidate.managedLoginUser !== "string" ||
    candidate.method !== "ssh-ca" ||
    (candidate.osFamily !== "linux" && candidate.osFamily !== "windows") ||
    (candidate.provisionedBy !== "cloud-init" && candidate.provisionedBy !== "lxc-template")
  ) {
    return undefined;
  }

  return {
    authorityFingerprint: candidate.authorityFingerprint,
    managedLoginUser: candidate.managedLoginUser,
    method: "ssh-ca",
    osFamily: candidate.osFamily,
    provisionedBy: candidate.provisionedBy,
  };
}

function parseLocalSshMeta(value: unknown): TainerLocalSshMeta | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<Record<keyof TainerLocalSshMeta, unknown>>;

  if (
    typeof candidate.createdAt !== "string" ||
    Number.isNaN(Date.parse(candidate.createdAt)) ||
    typeof candidate.fingerprint !== "string" ||
    typeof candidate.loginUser !== "string" ||
    (candidate.mode !== "generated" && candidate.mode !== "uploaded")
  ) {
    return undefined;
  }

  return {
    createdAt: candidate.createdAt,
    fingerprint: candidate.fingerprint,
    loginUser: candidate.loginUser,
    mode: candidate.mode,
  };
}

export function buildDescription(userText: string, meta: TainerMeta): string {
  const json = JSON.stringify(meta);
  return `${userText.trim()}\n\n${MARKER}\n${json}`;
}

export function stripTainerMeta(description: string): string {
  const idx = description.indexOf(MARKER);
  if (idx === -1) return description.trim();
  return description.slice(0, idx).trim();
}
