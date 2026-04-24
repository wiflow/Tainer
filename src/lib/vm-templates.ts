import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import { createStoreMutator, writeJsonFileAtomically } from "@/lib/store-utils";

export type VmTemplate = {
  accessReady: boolean;
  bridge: string;
  cloudInitCapable: boolean;
  cores: string;
  cpuType: string;
  createdAt: string;
  description: string;
  diskSize: string;
  diskStorage: string;
  enableQemuAgent: boolean;
  hostnamePrefix: string;
  id: string;
  isoFileName: string;
  isoStorage: string;
  isoVolid: string;
  machineType: string;
  managedLoginUser: string;
  memory: string;
  name: string;
  node: string;
  onboot: boolean;
  osType: string;
  scsihw: string;
  sockets: string;
  startAfterCreate: boolean;
  updatedAt: string;
  vgaType: string;
};

export type VmTemplateInput = Omit<
  VmTemplate,
  "createdAt" | "id" | "updatedAt"
>;

type VmTemplateStore = {
  templates: VmTemplate[];
};

function normalizeTemplate(template: VmTemplate): VmTemplate {
  return {
    ...template,
    accessReady: Boolean((template as Partial<VmTemplate>).accessReady),
    cloudInitCapable: Boolean((template as Partial<VmTemplate>).cloudInitCapable),
    managedLoginUser:
      typeof (template as Partial<VmTemplate>).managedLoginUser === "string" &&
      (template as Partial<VmTemplate>).managedLoginUser!.trim()
        ? (template as Partial<VmTemplate>).managedLoginUser!.trim()
        : "tainer",
  };
}

async function readStore(): Promise<VmTemplateStore> {
  try {
    const raw = await readFile(
      await resolveSiteDataFilePathFromContext("vm-templates.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<VmTemplateStore>;

    return {
      templates: Array.isArray(parsed.templates)
        ? (parsed.templates as VmTemplate[]).map(normalizeTemplate)
        : [],
    };
  } catch {
    return {
      templates: [],
    };
  }
}

async function writeStore(store: VmTemplateStore) {
  const filePath = await resolveSiteDataFilePathFromContext("vm-templates.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator("vm-templates", readStore, writeStore);

export async function listVmTemplates() {
  const store = await readStore();

  return [...store.templates].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export async function getVmTemplate(id: string) {
  const templates = await listVmTemplates();

  return templates.find((template) => template.id === id) ?? null;
}

export async function updateVmTemplate(
  id: string,
  input: Partial<VmTemplateInput>,
) {
  return mutateStore((store) => {
    const index = store.templates.findIndex((template) => template.id === id);

    if (index === -1) {
      return null;
    }

    store.templates[index] = {
      ...store.templates[index],
      ...input,
      updatedAt: new Date().toISOString(),
    };

    return store.templates[index];
  });
}

export async function createVmTemplate(input: VmTemplateInput) {
  return mutateStore((store) => {
    const timestamp = new Date().toISOString();
    const template: VmTemplate = {
      ...input,
      createdAt: timestamp,
      id: randomUUID(),
      updatedAt: timestamp,
    };

    store.templates.push(template);

    return template;
  });
}

export async function deleteVmTemplate(id: string) {
  return mutateStore((store) => {
    const index = store.templates.findIndex((template) => template.id === id);

    if (index === -1) {
      return null;
    }

    const [removed] = store.templates.splice(index, 1);

    return removed;
  });
}
