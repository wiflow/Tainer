import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { requirePermission, requireSession } from "@/lib/auth";
import { runDiagnosticScan } from "@/lib/diagnostics";
import { ensureSiteConfig } from "@/lib/site-context";

export const dynamic = "force-dynamic";

export default async function DiagnosticsPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await ensureSiteConfig(siteSlug);
  const session = await requireSession();
  requirePermission(session, "manage-settings");

  const report = await runDiagnosticScan(siteSlug);

  return (
    <div className="space-y-4">
      <DiagnosticsPanel report={report} />
    </div>
  );
}
