import { ChevronRight } from "lucide-react";

/**
 * Collapsed "how does this work" summary for the load balancer page.
 * Static server component — native <details> keeps it collapsible with no
 * client JS.
 *
 * Deliberately short: the per-setting detail now lives in the ⓘ tooltips on
 * the controls themselves, so this only has to carry the shape of the loop.
 * The full write-up is docs/load-balancer.md; keep the two in sync when
 * behaviour changes.
 */

const STEPS: { title: string; body: string }[] = [
  {
    title: "Score",
    body:
      "Every poll, each node's memory, CPU, disk and API latency are combined into one score, plus penalties when guests are visibly suffering. Lower is healthier, and new deployments are steered to the lowest.",
  },
  {
    title: "Wait for it to persist",
    body:
      "A node becomes a migration candidate only after it stays over the threshold for several consecutive polls. A brief spike resets the counter.",
  },
  {
    title: "Move the smallest thing that helps",
    body:
      "The balancer sheds just enough load — never a 64 GB VM when a 4 GB one would do — and only to a node with genuine headroom that beats the source by your minimum improvement.",
  },
  {
    title: "Protect containers",
    body:
      "Proxmox live-migrates VMs with no downtime, but LXC containers always stop, transfer and start. Containers are therefore never moved automatically unless you opt in.",
  },
  {
    title: "Dry-run first",
    body:
      "By default every decision is recorded in the activity log without being executed. Review the recommendations for a few days, then turn dry-run off.",
  },
  {
    title: "Stay in control",
    body:
      "Drain a node for maintenance, exclude nodes or VMIDs, tag individual guests in Proxmox, or apply a whole-cluster rebalance plan yourself. Every decision and failure is logged.",
  },
];

export function LoadBalancerExplainer() {
  return (
    <details className="group rounded-xl border border-white/5 bg-[#111113] shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-[13px] font-medium text-zinc-300 transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 group-open:rotate-90" />
        How the load balancer works
        <span className="text-[12px] font-normal text-zinc-500">
          — the short version
        </span>
      </summary>
      <div className="grid gap-x-6 gap-y-4 border-t border-white/5 px-5 py-4 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <div key={step.title}>
            <h3 className="text-[12px] font-medium text-zinc-200">
              <span className="mr-1.5 text-zinc-600 tabular-nums">{i + 1}</span>
              {step.title}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{step.body}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
