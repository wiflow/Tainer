import type { BasicActionState } from "@/lib/action-states";
import type { RestoreResult } from "@/lib/node-config-backup";

export type RestoreActionState = BasicActionState & {
  result: RestoreResult | null;
};

export const initialRestoreActionState: RestoreActionState = {
  message: "",
  requestId: "",
  result: null,
  status: "idle",
};
