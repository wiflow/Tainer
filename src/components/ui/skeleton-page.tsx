import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-white/[0.04]",
        className,
      )}
    />
  );
}

function MetricRow() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-white/5 bg-zinc-900/50 p-4"
        >
          <Bone className="mb-3 h-3 w-20" />
          <Bone className="mb-1 h-7 w-24" />
          <Bone className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

function SectionSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-white/5 bg-zinc-900/50", className)}>
      <div className="border-b border-white/5 px-5 py-4">
        <Bone className="h-4 w-32" />
      </div>
      <div className="divide-y divide-white/5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3.5">
            <Bone className="h-4 w-4 rounded" />
            <Bone className="h-3.5 w-40" />
            <div className="ml-auto">
              <Bone className="h-5 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartRow() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-white/5 bg-zinc-900/50 p-5"
        >
          <Bone className="mb-4 h-4 w-28" />
          <Bone className="h-[180px] w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <MetricRow />
      <ChartRow />
      <ChartRow />
    </div>
  );
}

export function ListPageSkeleton() {
  return (
    <div className="space-y-4">
      <MetricRow />
      <SectionSkeleton rows={6} />
    </div>
  );
}

export function DetailPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Bone className="h-5 w-5 rounded" />
        <Bone className="h-6 w-48" />
        <div className="ml-auto flex gap-2">
          <Bone className="h-8 w-20 rounded-md" />
          <Bone className="h-8 w-20 rounded-md" />
        </div>
      </div>
      <MetricRow />
      <SectionSkeleton rows={4} />
      <SectionSkeleton rows={3} />
    </div>
  );
}

export function FormPageSkeleton() {
  return (
    <div className="space-y-4">
      <SectionSkeleton rows={4} />
      <SectionSkeleton rows={3} />
    </div>
  );
}

export { Bone, MetricRow, SectionSkeleton, ChartRow };
