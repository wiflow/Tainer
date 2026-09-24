import type { LoadBalancerSettings } from "@/lib/load-balancer/types";

export type LbPresetStop = {
  key: string;
  label: string;
  description: string;
  overrides: Partial<LoadBalancerSettings>;
};

export const LB_PRESET_STOPS: LbPresetStop[] = [
  {
    key: "observe",
    label: "Observe",
    description:
      "Watch and recommend only. The balancer scores nodes and records the moves it would make, but never migrates anything. This is the trust-building mode.",
    overrides: {
      migrationDryRun: true,
      migrationEnabled: true,
    },
  },
  {
    key: "conservative",
    label: "Conservative",
    description:
      "Move a guest only under sustained, severe imbalance (90% over cluster average across 5 checks) and only for a big win. Long cooldowns; no predictive moves.",
    overrides: {
      migrationConsecutivePolls: 5,
      migrationCooldownSeconds: 1800,
      migrationDryRun: false,
      migrationEnabled: true,
      migrationThresholdPercent: 90,
      minTargetImprovementPercent: 30,
      predictiveEnabled: false,
    },
  },
  {
    key: "balanced",
    label: "Balanced",
    description:
      "The sensible default: act on clear imbalance (75% over average across 3 checks), 15-minute cooldown, and let high-confidence forecasts pre-empt overloads.",
    overrides: {
      migrationConsecutivePolls: 3,
      migrationCooldownSeconds: 900,
      migrationDryRun: false,
      migrationEnabled: true,
      migrationThresholdPercent: 75,
      minTargetImprovementPercent: 15,
      predictiveEnabled: true,
      predictiveHorizonMinutes: 30,
    },
  },
  {
    key: "aggressive",
    label: "Aggressive",
    description:
      "Chase even modest imbalance (60% over average across 2 checks), short cooldowns, forecasts act 15 minutes ahead. Expect noticeably more migrations.",
    overrides: {
      migrationConsecutivePolls: 2,
      migrationCooldownSeconds: 300,
      migrationDryRun: false,
      migrationEnabled: true,
      migrationThresholdPercent: 60,
      minTargetImprovementPercent: 10,
      predictiveEnabled: true,
      predictiveHorizonMinutes: 15,
    },
  },
];

export function detectLbPresetIndex(settings: LoadBalancerSettings): number | null {
  for (let index = 0; index < LB_PRESET_STOPS.length; index += 1) {
    const overrides = LB_PRESET_STOPS[index].overrides;
    const matches = Object.entries(overrides).every(
      ([key, value]) => settings[key as keyof LoadBalancerSettings] === value,
    );
    if (matches) return index;
  }
  return null;
}
