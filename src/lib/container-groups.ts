import "server-only";

import { randomUUID } from "node:crypto";

import { resolveDataFilePath } from "@/lib/app-data";
import {
  createStoreMutator,
  readDataJsonFileCached,
  writeJsonFileAtomically,
} from "@/lib/store-utils";
import {
  TAG_PREFIX,
  addManagedTag,
  extractManagedTagSlugs,
  removeManagedTag,
  type ManagedTagDefinition,
} from "@/lib/tag-utils";

export { TAG_PREFIX };

export type ContainerTag = ManagedTagDefinition & {
  id: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type ContainerTagInput = Omit<ContainerTag, "id" | "createdAt" | "updatedAt">;

type ContainerTagStore = {
  groups: ContainerTag[];
};

async function readStore(): Promise<ContainerTagStore> {
  return readDataJsonFileCached("groups.json", {
    fallback: () => ({ groups: [] }),
    normalize: (parsed) => {
      const store = parsed as Partial<ContainerTagStore>;
      return {
        groups: Array.isArray(store.groups) ? store.groups : [],
      };
    },
  });
}

async function writeStore(store: ContainerTagStore) {
  const filePath = await resolveDataFilePath("groups.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("container-groups", readStore, writeStore);

export async function listContainerTags() {
  const store = await readStore();

  return [...store.groups].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export async function getContainerTag(id: string) {
  const store = await readStore();

  return store.groups.find((tag) => tag.id === id) ?? null;
}

export async function getContainerTagBySlug(slug: string) {
  const store = await readStore();

  return store.groups.find((tag) => tag.slug === slug) ?? null;
}

export async function createContainerTag(input: ContainerTagInput) {
  return mutateStore((store) => {
    const timestamp = new Date().toISOString();
    const tag: ContainerTag = {
      ...input,
      createdAt: timestamp,
      id: randomUUID(),
      updatedAt: timestamp,
    };

    store.groups.push(tag);

    return tag;
  });
}

export async function updateContainerTag(
  id: string,
  input: Partial<ContainerTagInput>,
) {
  return mutateStore((store) => {
    const index = store.groups.findIndex((group) => group.id === id);

    if (index === -1) {
      return null;
    }

    store.groups[index] = {
      ...store.groups[index],
      ...input,
      updatedAt: new Date().toISOString(),
    };

    return store.groups[index];
  });
}

export async function deleteContainerTag(id: string) {
  return mutateStore((store) => {
    const index = store.groups.findIndex((group) => group.id === id);

    if (index === -1) {
      return false;
    }

    store.groups.splice(index, 1);

    return true;
  });
}

export function extractTagSlug(tagList: string[]): string | null {
  return extractManagedTagSlugs(tagList)[0] ?? null;
}

export function extractTagSlugs(tagList: string[]) {
  return extractManagedTagSlugs(tagList);
}

export function buildTagsWithTag(
  existingTags: string,
  tagSlug: string | null,
): string {
  if (tagSlug) {
    return addManagedTag(existingTags, tagSlug);
  }

  return existingTags;
}

export function removeTagFromTags(
  existingTags: string,
  tagSlug: string,
) {
  return removeManagedTag(existingTags, tagSlug);
}
