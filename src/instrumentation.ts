export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/alert-scheduler");
    startScheduler();

    const { startLoadBalancerObserver } = await import("@/lib/load-balancer/observer");
    startLoadBalancerObserver();
  }
}
