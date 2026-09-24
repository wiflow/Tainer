# Tainer Load Balancer

Tainer includes a per-site load balancer that keeps your Proxmox cluster evenly loaded in two ways:

1. **Smart placement**: when you deploy a new container or VM, the "Automatic" node choice picks a healthy, underloaded node instead of always defaulting to the same one.
2. **Automatic rebalancing** (opt-in): when a node stays overloaded, the balancer migrates its heaviest workload to a quieter node.

Everything is configured per site under **Site → Load Balancer** (admin only).

## How scoring works

Every poll interval (default 10 seconds) Tainer measures each node and computes a composite score:

| Signal | Default weight | What it captures |
|---|---|---|
| Memory utilization | 50% | How full the node's RAM is |
| CPU utilization | 25% | How busy the node's processors are |
| Root disk utilization | 15% | How full local storage is |
| API latency (EWMA-smoothed) | 10% | How responsive the node is |

Memory carries the most weight because it is the truly finite resource: CPU contention degrades gracefully, memory exhaustion OOM-kills. (Proxmox's own scheduler weights memory 5:1 over CPU for the same reason.) Weights are tunable and auto-normalized to sum to 1.0. **Lower score = healthier node.**

On top of the base score, nodes collect **penalty points** when their guests, or the kernel itself, show signs of contention:

- A VM losing CPU time to noisy neighbours (`cpu_steal` above the threshold, default 10%) adds +50.
- A container hitting its memory limit (`failcnt` > 0) adds +50.
- **PSI pressure (Proxmox VE 9+):** each resource (CPU, memory, IO) whose kernel Pressure Stall Information exceeds the threshold (default 10% of time stalled, 10-second average) adds +40. Pressure catches what utilization can't: a node at 60% CPU can still be stalling tasks badly. Nodes that don't report PSI (PVE 8) are simply unaffected.
- A node with missing metrics gets the cluster average for that metric plus +10, so a blip doesn't ban it.

Nodes that repeatedly fail to report metrics trip a **circuit breaker** (3 consecutive failures) and are excluded from scoring until they recover, with exponential backoff. Breaker openings and closings are recorded in the activity log.

## How rebalancing decides to move something

Automatic migration is off by default. When enabled, a move only happens after all of these gates pass:

1. **Sustained overload**: the node's score must exceed the cluster average by your threshold (default 50%) for N consecutive polls (default 3). A momentary spike resets the counter.
2. **Cooldown**: a node that just triggered a migration waits (default 5 minutes) before it can trigger another. No migration storms.
3. **Concurrency cap**: the cluster-wide number of in-flight migrations never exceeds your limit (default 1).
4. **Cost-benefit guest choice**: among the *movable* guests (not excluded, not pinned, not tag-exempt, containers only if your policy allows), the balancer computes how much memory the node needs to shed to return to the cluster average, then picks the **smallest guest that alone sheds enough**. Moving a 64 GB VM when 4 GB would rebalance the node is pure waste. VMs are always tried before containers, because a VM move is invisible and a container move is downtime. Memory figures are **ballooning-aware**: for VMs with a balloon driver, the guest's real usage is used instead of the inflated host-reported allocation, so the balancer doesn't move the wrong guest.
5. **Target quality**: the target node is chosen from below-average nodes (power-of-two-choices, which provably avoids piling onto one node), must beat the source score by your minimum improvement (default 20%), and must actually fit the guest: CPU below 90%, free memory ≥ guest memory × 1.2, free disk ≥ guest disk × 1.1.

If any gate fails, nothing moves and the balancer re-evaluates next poll.

## Containers and downtime: read this before enabling auto-migration

**Proxmox cannot live-migrate LXC containers.** A container migration is a *restart migration*: the container is stopped, transferred, and started on the target, with real downtime (seconds to minutes depending on disk size and storage layout). VMs live-migrate with no downtime.

Because Tainer is container-first, the balancer treats containers conservatively:

- **Never** (default): containers are never moved automatically. Only VMs rebalance.
- **Only inside downtime windows**: containers may move only during windows you define, e.g. `22:00-06:00` (server local time; windows may wrap midnight).
- **Always**: containers are treated like VMs. Only choose this if brief downtime is acceptable.

## Dry-run mode

When you first enable auto-migration, **dry-run is on by default**. The balancer runs its full decision pipeline but records the outcome as a *"dry-run: would migrate…"* entry in the activity log instead of acting. Recommendations are paced exactly like real migrations (same cooldowns), so the log shows you precisely what live mode would have done.

Recommended workflow:

1. Enable the load balancer, then enable auto-migration (dry-run stays on).
2. Watch the activity log for a few days.
3. If the recommendations look sensible, turn dry-run off. If not, tune the threshold/weights first.

## Predictive balancing (opt-in)

Instead of waiting for a node to overload, the balancer can act on where a node is *heading*. It keeps ~1 hour of score history per node and fits a linear trend over the last 30 minutes. When a node's score is confidently projected to cross the migration threshold within the horizon (default 30 minutes), a pre-emptive move is triggered, subject to every normal gate (cooldown, concurrency cap, eligibility, target validation, dry-run).

Only high-confidence forecasts act: the trend must fit with R² above your confidence floor (default 70%) and be rising. A noisy flat line or a brief spike can never produce a confident trend, so the forecast window doubles as hysteresis. The activity log records predictive moves with the full evidence: projected score, trend slope, confidence, and sample count.

Off by default. Enable it after live (non-dry-run) balancing has earned your trust.

## Rebalance plans (whole-cluster optimization)

Reactive balancing fixes one hot node at a time. A **rebalance plan** optimizes the whole cluster at once: on the load-balancer page, *Compute Plan* runs an optimizer that searches multi-move combinations and picks the sequence that most reduces cluster imbalance (the coefficient of variation of node scores, the same objective Proxmox's dynamic CRS uses), respecting every constraint: capacity with headroom, affinity/anti-affinity, pins, exclusions, maintenance nodes.

- The plan is a **preview**: a table of moves (guest, source → target, memory, live/restart) with projected imbalance before/after. Nothing migrates until you click *Apply*.
- Containers are only included if you tick "Include containers" for that plan. Restart migration means downtime, so it's a per-plan decision.
- An applied plan is executed by the balancer **one move at a time**, respecting the concurrency cap, and each move is **re-validated against live state** right before it fires. If a guest moved or a target filled up since planning, the move is skipped with a logged reason, never forced.
- Plans survive Tainer restarts mid-execution and can be cancelled any time (queued moves are dropped; an in-flight migration finishes, since Proxmox can't recall it).
- Plan moves ignore dry-run mode: the preview **is** the dry run, and applying it is the explicit consent.

## Maintenance mode (node drain)

Add a node to **Maintenance Nodes** and the balancer will:

- stop suggesting it for new deployments,
- never pick it as a migration target,
- evacuate its running guests one at a time (about one per minute) to healthy nodes, respecting all capacity checks.

Drains move containers too: putting a node in maintenance is an explicit downtime decision. Guests that are pinned, excluded, or tag-exempt are *not* drained; a warning event tells you to move them manually. Remove the node from the list when maintenance is done.

## Controlling individual guests with Proxmox tags

Tag guests in Proxmox (Datacenter → your guest → Tags) using the ProxLB-compatible convention:

| Tag | Effect |
|---|---|
| `plb_ignore` | Never migrated by the balancer: not automatically, not by drains, not by plans |
| `plb_manual` | No *automatic* moves, but still participates in explicit admin actions (drains and rebalance plans). The per-guest equivalent of DRS "manual" automation level |
| `plb_pin_<node>` | Pinned: never migrated off its node |
| `plb_affinity_<group>` | Guests sharing the group are kept together; the balancer won't split them |
| `plb_anti_affinity_<group>` | Guests sharing the group are kept on different nodes. A target already hosting a group member is rejected, including against planned future positions |

You can also exclude nodes or VMIDs cluster-wide in the settings form, without tagging.

## Placement suggestions at deploy time

Every migration avoided is downtime avoided, so the balancer's biggest lever is placing workloads well from the start. When the load balancer is enabled, the "Automatic" option in every deploy form (templates, VM creator, base images) uses live node scores (including penalties, exclusions, and maintenance state) instead of a simple free-memory heuristic. You can always override it by picking a node explicitly.

## Activity log

Every decision is persisted per site (survives restarts, capped at 10,000 entries):

- `migration` / `migration failed`: real moves and their errors, with the Proxmox task ID
- `dry-run`: what would have moved, and why
- `drain warning`: guests a maintenance drain could not move
- `breaker open` / `breaker closed`: node metric health transitions
- `tick error`: balancer polling failures (rate-limited to avoid flooding)
- `settings`: who changed which settings

## Settings reference

| Setting | Default | Notes |
|---|---|---|
| Enable Load Balancer | off | Scoring + placement suggestions |
| Enable Auto-Migration | off | Rebalancing decisions |
| Dry-Run Mode | on | Record decisions without acting |
| Allow Container Moves | never | `never` / `windows-only` / `always` |
| Downtime Windows | none | e.g. `22:00-06:00, 12:00-13:00`, server time |
| Poll Interval | 10 s | 5 to 300 |
| Threshold % Above Avg | 50% | 10 to 200 |
| Consecutive Polls | 3 | 1 to 20 |
| Cooldown | 300 s | 30 to 3600, per source node |
| Min Improvement % | 20% | 5 to 80, target must beat source score by this much |
| Max Concurrent Migrations | 1 | 1 to 10, cluster-wide including in-flight |
| PSI Pressure Penalty | 40 | 0 to 200 per stalled resource, PVE 9+ only |
| PSI Threshold % | 10% | 1 to 100, on the 10-second stall average |
| Act on Forecasts | off | Predictive balancing (see above) |
| Forecast Horizon | 30 min | 5 to 120 |
| Min Confidence % | 70% | 10 to 99, R² floor for acting on a forecast |
| Maintenance Nodes | none | Drained and excluded from placement |
| Excluded Nodes | none | Never a migration/placement target |
| Excluded VMIDs | none | Never migrated automatically |
| Weights / penalties / EWMA | see form | Scoring tunables |

## How this compares to other balancers

- **Proxmox VE 9.2's native dynamic CRS** only rebalances HA-managed guests; Tainer's balancer covers everything in the cluster and adds placement suggestions at deploy time. Tainer follows the same memory-primary weighting philosophy as Proxmox's TOPSIS scheduler and optimizes the same imbalance objective (coefficient of variation) in its rebalance plans.
- **ProxLB** pioneered the tag convention Tainer uses; Tainer adds per-guest contention penalties (CPU steal, failcnt), PSI pressure scoring as a first-class penalty, ballooning-aware memory accounting, capacity validation before every move (which Proxmox's own migration does not do), and a first-class dry-run activity log in the UI. Tainer's rebalance plans fill the role of ProxLB's CP-SAT solver mode: in-process, preview-first, with per-move live re-validation.
- **VMware DRS**'s cost-benefit analysis inspired Tainer's smallest-sufficient-move selection and minimum-improvement gate; its Predictive DRS inspired forecast-based pre-emption (no separate analytics product required); its per-VM automation levels map to Tainer's `plb_manual` / `plb_ignore` tags. Like DRS and **Nutanix ADS**, Tainer prefers *remediating sustained hotspots* over chasing perfect balance. For restart-migrated container workloads, fewer moves is a feature.
