import { SectionPanel } from "@/components/ui/section-panel";

/**
 * User-facing "how does this work" reference for the load balancer page.
 * Static server component — native <details> keeps it collapsible with no
 * client JS. The full write-up lives in docs/load-balancer.md; keep the two
 * in sync when behaviour changes.
 */

const stepClassName = "text-[13px] leading-relaxed text-zinc-400";
const headingClassName = "text-[13px] font-medium text-zinc-200";

export function LoadBalancerExplainer() {
  return (
    <SectionPanel
      title="How the load balancer works"
      description="What gets scored, when a workload moves, and the guardrails that keep migrations safe."
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <h3 className={headingClassName}>1. Every node gets a score</h3>
          <p className={stepClassName}>
            Every few seconds (the poll interval) Tainer measures each node&apos;s memory, CPU, and
            disk usage plus its API latency, and combines them into a single composite score using
            your weights — memory counts most, because running out of it is what kills workloads.
            Nodes hosting struggling guests — VMs losing CPU time to noisy neighbours (CPU steal),
            containers hitting memory limits (failcnt) — get penalty points on top, and on Proxmox
            VE 9+ the kernel&apos;s pressure metrics (PSI) add penalties when tasks are actually
            stalling on CPU, memory, or IO, even if plain utilization looks fine.
            <strong className="text-zinc-300"> Lower score = healthier node.</strong> New deployments
            are automatically suggested onto low-score nodes.
          </p>
        </div>

        <div className="space-y-1.5">
          <h3 className={headingClassName}>2. Sustained overload triggers a move — not spikes</h3>
          <p className={stepClassName}>
            A node only becomes a migration candidate when its score stays above the cluster average
            by your threshold for several consecutive polls. A brief CPU spike resets the counter and
            nothing happens. When a node does qualify, the balancer works out how much load it needs
            to shed and picks the <em>smallest</em> guest that gets it there — never a 64&nbsp;GB VM
            when a 4&nbsp;GB one would do — trying VMs before containers, and using the balloon
            driver&apos;s real memory figures rather than inflated host-reported ones. The target
            node must genuinely have room (CPU below 90%, memory with 20% headroom, disk with 10%
            headroom) and must beat the source score by your minimum improvement — otherwise it does
            nothing and waits.
          </p>
        </div>

        <div className="space-y-1.5">
          <h3 className={headingClassName}>3. Containers are protected from surprise downtime</h3>
          <p className={stepClassName}>
            Proxmox live-migrates VMs with no downtime, but LXC containers always restart-migrate:
            stop, transfer, start. The balancer therefore never moves containers automatically unless
            you opt in — either fully, or only inside downtime windows you define (e.g. 22:00–06:00).
            VMs are always eligible.
          </p>
        </div>

        <div className="space-y-1.5">
          <h3 className={headingClassName}>4. Dry-run first, then trust</h3>
          <p className={stepClassName}>
            With dry-run on (the default), the balancer records every move it <em>would</em> make as
            a “dry-run” entry in the activity log below, without touching anything. Review the
            recommendations for a few days; when they look right, disable dry-run and the same
            decisions execute for real. Migrations are capped at your concurrency limit, and each
            node gets a cooldown after a move so the cluster never churns.
          </p>
        </div>

        <div className="space-y-1.5">
          <h3 className={headingClassName}>5. Plan ahead — or let it see ahead</h3>
          <p className={stepClassName}>
            The <strong className="text-zinc-300">Rebalance Plan</strong> panel above computes a
            whole-cluster optimization: the fewest moves that even the cluster out, shown as a
            preview with projected imbalance before/after. Nothing migrates until you apply it, and
            every move is re-checked against live state right before it fires. With{" "}
            <strong className="text-zinc-300">predictive balancing</strong> enabled, the balancer
            also watches each node&apos;s score trend and can move a workload <em>before</em> a
            confidently forecast overload materialises — low-confidence or flat trends never act.
          </p>
        </div>

        <div className="space-y-1.5">
          <h3 className={headingClassName}>6. You stay in control</h3>
          <p className={stepClassName}>
            Mark a node for <strong className="text-zinc-300">maintenance</strong> and the balancer
            drains its guests one at a time and stops placing anything new on it. Exclude specific
            nodes or VMIDs from balancing entirely, or tag guests in Proxmox:{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5 text-[12px] text-zinc-300">plb_ignore</code>{" "}
            (never move),{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5 text-[12px] text-zinc-300">plb_manual</code>{" "}
            (no automatic moves; drains and plans still apply),{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5 text-[12px] text-zinc-300">plb_pin_&lt;node&gt;</code>{" "}
            (stay on a node),{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5 text-[12px] text-zinc-300">plb_affinity_&lt;group&gt;</code>{" "}
            (keep together), and{" "}
            <code className="rounded bg-zinc-900 px-1 py-0.5 text-[12px] text-zinc-300">plb_anti_affinity_&lt;group&gt;</code>{" "}
            (keep apart) — the same tag convention ProxLB uses. Every decision, failure, and
            circuit-breaker event lands in the activity log.
          </p>
        </div>
      </div>
    </SectionPanel>
  );
}
