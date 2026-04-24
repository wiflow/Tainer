export type ActionStatus = "error" | "idle" | "redirect" | "success";

export type BasicActionState = {
  message: string;
  requestId: string;
  status: ActionStatus;
};

export const initialBasicActionState: BasicActionState = {
  message: "",
  requestId: "",
  status: "idle",
};

export type ProxmoxTaskHandle = {
  node: string;
  /** Site slug for site-scoped task polling. */
  siteSlug?: string;
  submittedMessage: string;
  successHref?: string;
  successMessage: string;
  title: string;
  upid: string;
};

export type ProxmoxActionState = {
  message: string;
  requestId: string;
  status: ActionStatus;
  task: ProxmoxTaskHandle | null;
};

export const initialActionState: ProxmoxActionState = {
  message: "",
  requestId: "",
  status: "idle",
  task: null,
};

export type DockerHubActionState = {
  message: string;
  requestId: string;
  status: ActionStatus;
  task: ProxmoxTaskHandle | null;
};

export const initialDockerHubActionState: DockerHubActionState = {
  message: "",
  requestId: "",
  status: "idle",
  task: null,
};

export type LoginActionState = BasicActionState & {
  requiresTwoFactor: boolean;
};

export const initialLoginActionState: LoginActionState = {
  message: "",
  requestId: "",
  requiresTwoFactor: false,
  status: "idle",
};

export type TwoFactorSetupActionState = BasicActionState & {
  manualEntryKey: string;
  qrCodeDataUrl: string;
  recoveryCodes: string[];
};

export const initialTwoFactorSetupActionState: TwoFactorSetupActionState = {
  manualEntryKey: "",
  message: "",
  qrCodeDataUrl: "",
  recoveryCodes: [],
  requestId: "",
  status: "idle",
};

export type BulkActionState = {
  message: string;
  requestId: string;
  status: ActionStatus;
  tasks: ProxmoxTaskHandle[];
};

export const initialBulkActionState: BulkActionState = {
  message: "",
  requestId: "",
  status: "idle",
  tasks: [],
};

