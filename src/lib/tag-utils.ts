export const TAG_PREFIX = "grp-";

export type TagColor = "amber" | "emerald" | "rose" | "sky" | "violet" | "zinc";

export type TagColorOption = {
  label: string;
  ring: string;
  swatch: string;
  value: TagColor;
};

export type ManagedTagDefinition = {
  color: TagColor;
  name: string;
  slug: string;
};

export function isTagColor(value: string): value is TagColor {
  return value === "amber" ||
    value === "emerald" ||
    value === "rose" ||
    value === "sky" ||
    value === "violet" ||
    value === "zinc";
}

export const TAG_COLOR_OPTIONS: TagColorOption[] = [
  { value: "emerald", label: "Emerald", swatch: "bg-emerald-500", ring: "ring-emerald-400" },
  { value: "sky", label: "Sky", swatch: "bg-sky-500", ring: "ring-sky-400" },
  { value: "amber", label: "Amber", swatch: "bg-amber-500", ring: "ring-amber-400" },
  { value: "rose", label: "Rose", swatch: "bg-rose-500", ring: "ring-rose-400" },
  { value: "violet", label: "Violet", swatch: "bg-violet-500", ring: "ring-violet-400" },
  { value: "zinc", label: "Zinc", swatch: "bg-zinc-500", ring: "ring-zinc-400" },
];

const tagAccentMap: Record<TagColor, string> = {
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  zinc: "bg-zinc-600",
};

const tagBadgeMap: Record<TagColor, string> = {
  amber: "bg-amber-950 text-amber-400",
  emerald: "bg-emerald-950 text-emerald-400",
  rose: "bg-rose-950 text-rose-400",
  sky: "bg-sky-950 text-sky-400",
  violet: "bg-violet-950 text-violet-400",
  zinc: "bg-zinc-800 text-zinc-400",
};

const tagPillMap: Record<TagColor, string> = {
  amber: "border-amber-900/70 bg-amber-950/60 text-amber-300",
  emerald: "border-emerald-900/70 bg-emerald-950/60 text-emerald-300",
  rose: "border-rose-900/70 bg-rose-950/60 text-rose-300",
  sky: "border-sky-900/70 bg-sky-950/60 text-sky-300",
  violet: "border-violet-900/70 bg-violet-950/60 text-violet-300",
  zinc: "border-zinc-800 bg-zinc-900/60 text-zinc-400",
};

export function getTagAccentClass(color: string) {
  return tagAccentMap[(color as TagColor) in tagAccentMap ? (color as TagColor) : "zinc"];
}

export function getTagBadgeClass(color: string) {
  return tagBadgeMap[(color as TagColor) in tagBadgeMap ? (color as TagColor) : "zinc"];
}

export function getTagPillClass(color: string) {
  return tagPillMap[(color as TagColor) in tagPillMap ? (color as TagColor) : "zinc"];
}

const tagSelectedPillMap: Record<TagColor, string> = {
  amber: "border-amber-700 bg-amber-950/80 text-amber-200",
  emerald: "border-emerald-700 bg-emerald-950/80 text-emerald-200",
  rose: "border-rose-700 bg-rose-950/80 text-rose-200",
  sky: "border-sky-700 bg-sky-950/80 text-sky-200",
  violet: "border-violet-700 bg-violet-950/80 text-violet-200",
  zinc: "border-zinc-600 bg-zinc-800/80 text-zinc-200",
};

export function getTagSelectedPillClass(color: string) {
  return tagSelectedPillMap[(color as TagColor) in tagSelectedPillMap ? (color as TagColor) : "zinc"];
}

const proxmoxTagBackgroundMap: Record<TagColor, string> = {
  amber: "F59E0B",
  emerald: "10B981",
  rose: "F43F5E",
  sky: "0EA5E9",
  violet: "8B5CF6",
  zinc: "71717A",
};

function normalizeTagColor(color: string): TagColor {
  return isTagColor(color) ? color : "zinc";
}

function getContrastingTextHex(backgroundHex: string) {
  const normalized = backgroundHex.replace(/^#/, "");

  if (!/^[A-Fa-f0-9]{6}$/.test(normalized)) {
    return "F8FAFC";
  }

  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return luminance > 0.45 ? "111827" : "F8FAFC";
}

export function getProxmoxTagColorSpec(color: string) {
  const background = proxmoxTagBackgroundMap[normalizeTagColor(color)];
  return `${background}:${getContrastingTextHex(background)}`;
}

export function normalizeTagValues(value: string | string[]) {
  const values = Array.isArray(value)
    ? value
    : value.split(/[;,]/);

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const rawTag of values) {
    const tag = rawTag.trim();

    if (!tag || seen.has(tag)) {
      continue;
    }

    seen.add(tag);
    tags.push(tag);
  }

  return tags;
}

export function stringifyTagValues(tags: string[]) {
  return normalizeTagValues(tags).join(";");
}

export function isManagedTag(tag: string) {
  return tag.startsWith(TAG_PREFIX);
}

export function getManagedTagValue(tagSlug: string) {
  return `${TAG_PREFIX}${tagSlug}`;
}

export function managedTagSlug(tag: string) {
  return isManagedTag(tag) ? tag.slice(TAG_PREFIX.length) : null;
}

export function extractManagedTagSlugs(tagList: string[]) {
  return tagList
    .map((tag) => managedTagSlug(tag))
    .filter((slug): slug is string => Boolean(slug));
}

export function hasManagedTag(tagList: string[], tagSlug: string) {
  return tagList.includes(getManagedTagValue(tagSlug));
}

export function addManagedTag(existingTags: string | string[], tagSlug: string) {
  const tags = normalizeTagValues(existingTags);
  const managedTag = getManagedTagValue(tagSlug);

  if (!tags.includes(managedTag)) {
    tags.push(managedTag);
  }

  return stringifyTagValues(tags);
}

export function removeManagedTag(existingTags: string | string[], tagSlug: string) {
  const managedTag = getManagedTagValue(tagSlug);

  return stringifyTagValues(
    normalizeTagValues(existingTags).filter((tag) => tag !== managedTag),
  );
}
