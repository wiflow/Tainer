"use client";

import { createContext, useContext, useMemo, useState } from "react";

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
