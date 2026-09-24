import "server-only";

import { randomUUID } from "node:crypto";

import { resolveDataFilePath } from "@/lib/app-data";
import type { Permission } from "@/lib/permissions";
import { GLOBAL_PERMISSIONS, SITE_PERMISSIONS } from "@/lib/permissions";
import {
  createStoreMutator,
  readDataJsonFileCached,
  writeJsonFileAtomically,
} from "@/lib/store-utils";

export type SiteAccessEntry = {
  siteId: string;
  permissions: Permission[];
};

export type UserGroup = {
  id: string;
  name: string;
  slug: string;
  description: string;
  isAdmin: boolean;
  globalPermissions: Permission[];
  siteAccess: SiteAccessEntry[];
  createdAt: string;
  updatedAt: string;
};

export type UserGroupInput = {
  name: string;
  slug: string;
  description: string;
  isAdmin: boolean;
  globalPermissions: Permission[];
  siteAccess: SiteAccessEntry[];
};

type UserGroupStore = {
  schemaVersion: 1;
  groups: UserGroup[];
};

export type ResolvedPermissions = {
  isAdmin: boolean;
  globalPermissions: Permission[];
  sitePermissions: Record<string, Permission[]>;
  accessibleSiteIds: string[];
};

const STORE_FILE = "user-groups.json";

function emptyStore(): UserGroupStore {
  return { schemaVersion: 1, groups: [] };
}

async function readStore(): Promise<UserGroupStore> {
  return readDataJsonFileCached(STORE_FILE, {
    failClosed: true,
    fallback: emptyStore,
    normalize: (parsed) => {
      const store = parsed as Partial<UserGroupStore>;
      return {
        schemaVersion: 1,
        groups: Array.isArray(store.groups) ? store.groups : [],
      };
    },
  });
}

async function writeStore(store: UserGroupStore): Promise<void> {
  const filePath = await resolveDataFilePath(STORE_FILE);
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("user-groups", readStore, writeStore);

function generateSlug(name: string, existingSlugs: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  if (!base) base = "group";

  let slug = base;
  let counter = 2;

  while (existingSlugs.has(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }

  return slug;
}

export async function listUserGroups(): Promise<UserGroup[]> {
  const store = await readStore();
  return [...store.groups].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function getUserGroup(id: string): Promise<UserGroup | null> {
  const store = await readStore();
  return store.groups.find((g) => g.id === id) ?? null;
}

export async function getUserGroupBySlug(slug: string): Promise<UserGroup | null> {
  const store = await readStore();
  return store.groups.find((g) => g.slug === slug) ?? null;
}

export async function getUserGroupsByIds(ids: string[]): Promise<UserGroup[]> {
  if (ids.length === 0) return [];
  const store = await readStore();
  const idSet = new Set(ids);
  return store.groups.filter((g) => idSet.has(g.id));
}

export async function getUserGroupCount(): Promise<number> {
  const store = await readStore();
  return store.groups.length;
}

export async function hasAnyGroups(): Promise<boolean> {
  const store = await readStore();
  return store.groups.length > 0;
}

export async function createUserGroup(input: UserGroupInput): Promise<UserGroup> {
  return mutateStore((store) => {
    const existingSlugs = new Set(store.groups.map((g) => g.slug));
    const timestamp = new Date().toISOString();

    const group: UserGroup = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug || generateSlug(input.name, existingSlugs),
      description: input.description,
      isAdmin: input.isAdmin,
      globalPermissions: input.globalPermissions,
      siteAccess: input.siteAccess,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    store.groups.push(group);
    return group;
  });
}

export async function updateUserGroup(
  id: string,
  input: Partial<UserGroupInput>,
): Promise<UserGroup | null> {
  return mutateStore((store) => {
    const index = store.groups.findIndex((g) => g.id === id);
    if (index === -1) return null;

    const existing = store.groups[index];

    store.groups[index] = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.isAdmin !== undefined && { isAdmin: input.isAdmin }),
      ...(input.globalPermissions !== undefined && { globalPermissions: input.globalPermissions }),
      ...(input.siteAccess !== undefined && { siteAccess: input.siteAccess }),
      updatedAt: new Date().toISOString(),
    };

    return store.groups[index];
  });
}

export async function deleteUserGroup(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const index = store.groups.findIndex((g) => g.id === id);
    if (index === -1) return false;
    store.groups.splice(index, 1);
    return true;
  });
}

export async function resolveEffectivePermissions(
  groupIds: string[],
): Promise<ResolvedPermissions> {
  if (groupIds.length === 0) {
    return {
      isAdmin: false,
      globalPermissions: [],
      sitePermissions: {},
      accessibleSiteIds: [],
    };
  }

  const groups = await getUserGroupsByIds(groupIds);

  let isAdmin = false;
  const globalPermsSet = new Set<Permission>();
  const sitePermsMap: Record<string, Set<Permission>> = {};

  for (const group of groups) {
    if (group.isAdmin) {
      isAdmin = true;
    }

    for (const perm of group.globalPermissions) {
      if (GLOBAL_PERMISSIONS.includes(perm)) globalPermsSet.add(perm);
    }

    for (const entry of group.siteAccess) {
      if (!sitePermsMap[entry.siteId]) {
        sitePermsMap[entry.siteId] = new Set();
      }

      for (const perm of entry.permissions) {
        sitePermsMap[entry.siteId].add(perm);
      }
    }
  }

  const sitePermissions: Record<string, Permission[]> = {};
  const accessibleSiteIds: string[] = [];

  for (const [siteId, permsSet] of Object.entries(sitePermsMap)) {
    sitePermissions[siteId] = [...permsSet];
    accessibleSiteIds.push(siteId);
  }

  return {
    isAdmin,
    globalPermissions: [...globalPermsSet],
    sitePermissions,
    accessibleSiteIds,
  };
}

let migrationPromise: Promise<void> | null = null;

export function ensureUserGroupsMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = runMigration().catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}

async function runMigration(): Promise<void> {
  const existing = await hasAnyGroups();
  if (existing) return;

  // Imported lazily to avoid a circular dependency.
  const { listSites } = await import("@/lib/site-store");

  const sites = await listSites();
  const siteIds = sites.map((s) => s.id);

  const allSiteAccess: SiteAccessEntry[] = siteIds.map((siteId) => ({
    siteId,
    permissions: [...SITE_PERMISSIONS],
  }));

  const adminGroup = await createUserGroup({
    name: "Administrators",
    slug: "administrators",
    description: "Full administrative access to all sites and features",
    isAdmin: true,
    globalPermissions: ["manage-users", "manage-sites"],
    siteAccess: allSiteAccess,
  });

  const operatorGroup = await createUserGroup({
    name: "Operators",
    slug: "operators",
    description: "Default operator access to all sites",
    isAdmin: false,
    globalPermissions: [],
    siteAccess: allSiteAccess,
  });

  // Imported lazily to avoid a circular dependency.
  const { migrateUsersToGroups } = await import("@/lib/auth");
  await migrateUsersToGroups(adminGroup.id, operatorGroup.id);
}

export async function writeUserGroupStore(store: UserGroupStore): Promise<void> {
  await writeStore(store);
}
