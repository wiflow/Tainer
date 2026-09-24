import type { BasicActionState } from "@/lib/action-states";

export type LldpIssueTokenActionState = BasicActionState & {
  plaintext: string;
  label: string;
  snmpCommunity: string;
};

export const initialLldpIssueTokenActionState: LldpIssueTokenActionState = {
  message: "",
  requestId: "",
  status: "idle",
  plaintext: "",
  label: "",
  snmpCommunity: "",
};
