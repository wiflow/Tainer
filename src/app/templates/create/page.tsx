import { redirectToSiteRoute } from "@/lib/site-redirect";

export const dynamic = "force-dynamic";

export default async function TemplateCreateRedirect() {
  await redirectToSiteRoute("templates/create");
}
