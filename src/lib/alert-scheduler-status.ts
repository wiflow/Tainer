import "server-only";

import {
  getSchedulerStatus,
  type SchedulerStatus,
} from "@/lib/alert-scheduler";

export type { SchedulerStatus };

export function getAlertSchedulerStatus(): SchedulerStatus {
  return getSchedulerStatus();
}
