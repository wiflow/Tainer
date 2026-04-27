import type { BasicActionState } from "@/lib/action-states";

export type TestIdpActionState = BasicActionState & {
  authorizationEndpoint: string | null;
};

export const initialTestIdpActionState: TestIdpActionState = {
  authorizationEndpoint: null,
  message: "",
  requestId: "",
  status: "idle",
};
