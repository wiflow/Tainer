import { redirectToSiteRoute } from "@/lib/site-redirect";

export const dynamic = "force-dynamic";

export default async function ImagesRedirect() {
  await redirectToSiteRoute("images");
}
