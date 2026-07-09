import { redirect } from "next/navigation";

import { CopilotSettingsPanel } from "@/components/copilot-settings-panel";
import { getCurrentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tainy · Tainer",
};

export default async function CopilotSettingsPage() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-semibold text-white">Tainy</h1>
        <p className="text-[12.5px] text-zinc-500 mt-0.5">
          AI assistant for diagnosing and managing your cluster. One site-wide API key; actions
          bound to your permissions.
        </p>
      </div>
      <CopilotSettingsPanel />
    </div>
  );
}
