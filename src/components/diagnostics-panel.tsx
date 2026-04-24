"use client";

import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DiagnosticReport, DiagnosticSeverity } from "@/lib/diagnostics";

function SeverityIcon({ severity }: { severity: DiagnosticSeverity }) {
  if (severity === "critical") return <XCircle className="h-4 w-4 text-rose-400" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  return <Info className="h-4 w-4 text-sky-400" />;
}

function severityBadge(severity: DiagnosticSeverity) {
  if (severity === "critical") return <Badge variant="destructive">Critical</Badge>;
  if (severity === "warning") return <Badge variant="review">Warning</Badge>;
  return <Badge variant="info">Info</Badge>;
}

export function DiagnosticsPanel({ report }: { report: DiagnosticReport }) {
  const router = useRouter();
  const criticalCount = report.issues.filter((i) => i.severity === "critical").length;
  const warningCount = report.issues.filter((i) => i.severity === "warning").length;
  const infoCount = report.issues.filter((i) => i.severity === "info").length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-3">
        {report.issues.length === 0 ? (
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-[14px] font-medium">All checks passed</span>
          </div>
        ) : (
          <>
            {criticalCount > 0 && (
              <Badge variant="destructive">{criticalCount} critical</Badge>
            )}
            {warningCount > 0 && (
              <Badge variant="review">{warningCount} warning{warningCount !== 1 ? "s" : ""}</Badge>
            )}
            {infoCount > 0 && (
              <Badge variant="info">{infoCount} info</Badge>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-zinc-600">
            Scanned in {report.scanDurationMs}ms
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.refresh()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Re-scan
          </Button>
        </div>
      </div>

      {/* Issues */}
      {report.issues.length > 0 && (
        <Card className="overflow-hidden rounded-2xl">
          <CardHeader className="border-b border-white/5">
            <CardTitle>Issues ({report.issues.length})</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-zinc-800/60 p-0">
            {report.issues
              .sort((a, b) => {
                const order = { critical: 0, warning: 1, info: 2 };
                return order[a.severity] - order[b.severity];
              })
              .map((issue) => (
                <div key={issue.id} className="flex items-start gap-4 px-5 py-4">
                  <SeverityIcon severity={issue.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-zinc-200">
                        {issue.title}
                      </p>
                      {severityBadge(issue.severity)}
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                      {issue.description}
                    </p>
                    {issue.resourceLink && (
                      <Link
                        href={issue.resourceLink}
                        className="mt-1.5 inline-block text-[12px] text-sky-400 hover:underline"
                      >
                        View {issue.resourceLabel}
                      </Link>
                    )}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
