import { redirectToSiteRoute } from "@/lib/site-redirect";

export const dynamic = "force-dynamic";

export default async function CreateVmFromTemplateRedirect() {
  await redirectToSiteRoute("deployments/create-vm-from-template");
}
