import type { ActionStatus } from "@/lib/action-states";

export type ApiTokenActionState = {
  message: string;
  requestId: string;
  status: ActionStatus;
  createdToken: string | null;
};

export const initialApiTokenActionState: ApiTokenActionState = {
  message: "",
  requestId: "",
  status: "idle",
  createdToken: null,
};
