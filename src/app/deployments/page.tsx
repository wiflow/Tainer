import { redirectToSiteRoute } from "@/lib/site-redirect";

export const dynamic = "force-dynamic";

export default async function DeploymentsRedirect() {
  await redirectToSiteRoute("deployments");
}
