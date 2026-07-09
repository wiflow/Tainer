"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * Row/page-scoped channel between DeploymentQuickActions (which learns a
 * lifecycle task's outcome the moment it completes) and whatever renders the
 * status badge/dot, so the visible status flips together with the buttons
 * instead of waiting for the server re-render. Optional — quick actions fall
 * back to component-local state when no provider is present.
 */
type DeploymentStatusContextValue = {
  optimistic: string | null;
  setOptimistic: (status: string | null) => void;
};

const DeploymentStatusContext = createContext<DeploymentStatusContextValue | null>(null);

export function DeploymentStatusProvider({ children }: { children: React.ReactNode }) {
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const value = useMemo(() => ({ optimistic, setOptimistic }), [optimistic]);
  return (
    <DeploymentStatusContext.Provider value={value}>
      {children}
    </DeploymentStatusContext.Provider>
  );
}

export function useOptionalDeploymentStatus() {
  return useContext(DeploymentStatusContext);
}
