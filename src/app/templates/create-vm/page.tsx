import { redirectToSiteRoute } from "@/lib/site-redirect";

export const dynamic = "force-dynamic";

export default async function TemplateCreateVmRedirect() {
  await redirectToSiteRoute("templates/create-vm");
}
