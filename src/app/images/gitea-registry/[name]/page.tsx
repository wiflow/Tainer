import { redirectToSiteRoute } from "@/lib/site-redirect";

export const dynamic = "force-dynamic";

export default async function GiteaImageDetailRedirect({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  await redirectToSiteRoute(`images/gitea-registry/${name}`);
}
