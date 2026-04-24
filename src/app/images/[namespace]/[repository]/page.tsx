import { redirectToSiteRoute } from "@/lib/site-redirect";

export const dynamic = "force-dynamic";

export default async function ImageDetailRedirect({
  params,
}: {
  params: Promise<{ namespace: string; repository: string }>;
}) {
  const { namespace, repository } = await params;
  await redirectToSiteRoute(`images/${namespace}/${repository}`);
}
