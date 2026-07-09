import "server-only";

// Side-effect imports — each module calls registerTool() at import time.
import "@/lib/copilot/tools/sites";
import "@/lib/copilot/tools/cluster";
import "@/lib/copilot/tools/containers";
import "@/lib/copilot/tools/templates";
import "@/lib/copilot/tools/storage";
import "@/lib/copilot/tools/audit";
import "@/lib/copilot/tools/diagnostics";
import "@/lib/copilot/tools/launch";
import "@/lib/copilot/tools/snapshots";
import "@/lib/copilot/tools/ip-pools";
import "@/lib/copilot/tools/navigation";
import "@/lib/copilot/tools/backups";
import "@/lib/copilot/tools/metrics";
import "@/lib/copilot/tools/tags";
import "@/lib/copilot/tools/network";
import "@/lib/copilot/tools/security";
import "@/lib/copilot/tools/observability";
import "@/lib/copilot/tools/firewall";
import "@/lib/copilot/tools/vms";
import "@/lib/copilot/tools/admin";
import "@/lib/copilot/tools/images";

export { listTools, getTool, listToolsForModel } from "@/lib/copilot/registry";
