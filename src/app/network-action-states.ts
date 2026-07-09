import type { BasicActionState } from "@/lib/action-states";

export type LldpIssueTokenActionState = BasicActionState & {
  /** Plaintext token returned on success. Empty on error or idle. */
  plaintext: string;
  /** Label of the newly-issued token, echoed back for the success modal. */
  label: string;
  /** SNMP community for the site, returned so the snippet can bake it in.
   *  Empty when SNMP isn't configured for this site. */
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
