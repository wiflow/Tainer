import { redirectToSiteRoute } from "@/lib/site-redirect";

export const dynamic = "force-dynamic";

export default async function CreateContainerRedirect() {
  await redirectToSiteRoute("deployments/create-container");
}
