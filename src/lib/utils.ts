import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(
  bytes: number,
  opts: {
    decimals?: number;
    sizeType?: "accurate" | "normal";
  } = {},
) {
  const { decimals = 0, sizeType = "normal" } = opts;

  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const accurateSizes = ["Bytes", "KiB", "MiB", "GiB", "TiB"];
  if (bytes === 0) return "0 Byte";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(decimals)} ${
    sizeType === "accurate"
      ? accurateSizes[i] ?? "Bytes"
      : sizes[i] ?? "Bytes"
  }`;
}

export function truncateMiddle(
  text: string,
  startChars: number,
  endChars: number,
) {
  if (text.length <= startChars + endChars) {
    return text;
  }
  return `${text.substring(0, startChars)}...${text.substring(
    text.length - endChars,
  )}`;
}

export function formatUptime(seconds?: number | null) {
  if (seconds == null || seconds === 0) {
    return "0s";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

// new URL(path, base) drops the base path when path starts with "/", so concatenate manually
export function buildProxmoxUrl(apiPath: string, baseUrl: string): URL {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  base.pathname = prefix + apiPath;
  return base;
}

export function titleFromTemplateFile(filename: string) {
  let title = filename;

  if (title.endsWith(".tar.gz")) title = title.slice(0, -7);
  else if (title.endsWith(".tar.xz")) title = title.slice(0, -7);
  else if (title.endsWith(".tar.zst")) title = title.slice(0, -8);

  return title
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
