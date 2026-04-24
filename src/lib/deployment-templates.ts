import "server-only";

import { randomUUID } from "node:crypto";

import { resolveSiteDataFilePathFromContext } from "@/lib/site-data";
import {
  createStoreMutator,
  readJsonFileCached,
  writeJsonFileAtomically,
} from "@/lib/store-utils";

export type DeploymentTemplate = {
  accessReady: boolean;
  bridge: string;
  cores: string;
  createdAt: string;
  description: string;
  envText: string;
  hostnamePrefix: string;
  id: string;
  memory: string;
  name: string;
  node: string;
  onboot: boolean;
  rootfsSize: string;
  rootfsStorage: string;
  sourceFileName: string;
  sourceName: string;
  sourceStorage: string;
  sourceTemplateId: string;
  sourceVolid: string;
  sshAuthorityFingerprint: string | null;
  startAfterCreate: boolean;
  managedLoginUser: string;
  unprivileged: boolean;
  updatedAt: string;
};

export type DeploymentTemplateInput = Omit<
  DeploymentTemplate,
  "createdAt" | "id" | "updatedAt"
>;

type DeploymentTemplateStore = {
  templates: DeploymentTemplate[];
};

function isValidTemplate(value: unknown): value is DeploymentTemplate {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.node === "string"
  );
}

function normalizeTemplate(value: DeploymentTemplate): DeploymentTemplate {
  return {
    ...value,
    accessReady: Boolean((value as Partial<DeploymentTemplate>).accessReady),
    managedLoginUser:
      typeof (value as Partial<DeploymentTemplate>).managedLoginUser === "string" &&
      (value as Partial<DeploymentTemplate>).managedLoginUser!.trim()
        ? (value as Partial<DeploymentTemplate>).managedLoginUser!.trim()
        : "tainer",
    sshAuthorityFingerprint:
      typeof (value as Partial<DeploymentTemplate>).sshAuthorityFingerprint === "string" &&
      (value as Partial<DeploymentTemplate>).sshAuthorityFingerprint!.trim()
        ? (value as Partial<DeploymentTemplate>).sshAuthorityFingerprint!.trim()
        : null,
  };
}

async function readStore(): Promise<DeploymentTemplateStore> {
  return readJsonFileCached(
    await resolveSiteDataFilePathFromContext("deployment-templates.json"),
    {
      fallback: () => ({ templates: [] }),
      normalize: (parsed) => {
        const store = parsed as Partial<DeploymentTemplateStore>;
        return {
          templates: Array.isArray(store.templates)
            ? store.templates.filter(isValidTemplate).map(normalizeTemplate)
            : [],
        };
      },
    },
  );
}

async function writeStore(store: DeploymentTemplateStore) {
  const filePath = await resolveSiteDataFilePathFromContext("deployment-templates.json");
  await writeJsonFileAtomically(filePath, store);
}

const mutateStore = createStoreMutator(
  "deployment-templates",
  readStore,
  writeStore,
);

export async function listDeploymentTemplates() {
  const store = await readStore();

  return [...store.templates].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export async function getDeploymentTemplate(id: string) {
  const templates = await listDeploymentTemplates();

  return templates.find((template) => template.id === id) ?? null;
}

const ALLOWED_TEMPLATE_UPDATE_FIELDS = new Set<keyof DeploymentTemplateInput>([
  "accessReady",
  "bridge",
  "cores",
  "description",
  "envText",
  "hostnamePrefix",
  "memory",
  "name",
  "node",
  "onboot",
  "rootfsSize",
  "rootfsStorage",
  "sourceFileName",
  "sourceName",
  "sourceStorage",
  "sourceTemplateId",
  "sourceVolid",
  "sshAuthorityFingerprint",
  "startAfterCreate",
  "managedLoginUser",
  "unprivileged",
]);

function pickAllowedFields(input: Partial<DeploymentTemplateInput>): Partial<DeploymentTemplateInput> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (ALLOWED_TEMPLATE_UPDATE_FIELDS.has(key as keyof DeploymentTemplateInput)) {
      result[key] = value;
    }
  }

  return result as Partial<DeploymentTemplateInput>;
}

export async function updateDeploymentTemplate(
  id: string,
  input: Partial<DeploymentTemplateInput>,
) {
  const sanitizedInput = pickAllowedFields(input);

  return mutateStore((store) => {
    const index = store.templates.findIndex((template) => template.id === id);

    if (index === -1) {
      return null;
    }

    store.templates[index] = {
      ...store.templates[index],
      ...sanitizedInput,
      updatedAt: new Date().toISOString(),
    };

    return store.templates[index];
  });
}

export async function createDeploymentTemplate(input: DeploymentTemplateInput) {
  return mutateStore((store) => {
    const timestamp = new Date().toISOString();
    const template: DeploymentTemplate = {
      ...input,
      createdAt: timestamp,
      id: randomUUID(),
      updatedAt: timestamp,
    };

    store.templates.push(template);

    return template;
  });
}
