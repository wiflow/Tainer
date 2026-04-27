import { Disc3, FolderOpen } from "lucide-react";
import { unstable_cache } from "next/cache";

import { IsoDownloadForm } from "@/components/iso-download-form";
import { ProxmoxIssues } from "@/components/proxmox-issues";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionPanel } from "@/components/ui/section-panel";
import { isIsoLibraryConfigured, listLocalIsoFiles } from "@/lib/iso-library";
import { getIsoStorageTargets, getNodes, listIsoImages, withSiteConfig } from "@/lib/proxmox";
import { ensureSiteConfig } from "@/lib/site-context";
import { resolveSiteConfigBySlug } from "@/lib/site-resolver";

// Avoid `force-dynamic` here — it silently disables the unstable_cache below.
const getIsoImagesPageData = unstable_cache(
  async (siteSlug: string) => {
    const siteConfig = await resolveSiteConfigBySlug(siteSlug);
    return withSiteConfig(siteConfig, async () => {
      const { nodes } = await getNodes();

      const [isoResult, isoTargetResult, localFiles] = await Promise.all([
        listIsoImages(nodes),
        getIsoStorageTargets(nodes),
        listLocalIsoFiles(),
      ]);

      return {
        isoResult,
        isoTargetResult,
        localFiles,
        nodes,
      };
    });
  },
  ["iso-images-page-data"],
  { revalidate: 5 },
);

export default async function IsoImagesPage({
  params,
}: {
  params: Promise<{ siteSlug: string }>;
}) {
  const { siteSlug } = await params;
  await ensureSiteConfig(siteSlug);

  const { isoResult, isoTargetResult, localFiles, nodes } =
    await getIsoImagesPageData(siteSlug);

  const libraryConfigured = isIsoLibraryConfigured();

  return (
    <div className="space-y-4">
      <ProxmoxIssues
        description="ISO library needs Datastore.Audit permissions on storage pools containing ISO images."
        issues={[...isoResult.issues, ...isoTargetResult.issues]}
      />

      <IsoDownloadForm isoTargets={isoTargetResult.targets} nodes={nodes} />

      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          icon={<Disc3 className="w-3.5 h-3.5" />}
          label="Proxmox ISOs"
          value={String(isoResult.images.length)}
          description="ISO images in Proxmox storage pools."
        />
        <MetricCard
          icon={<FolderOpen className="w-3.5 h-3.5" />}
          label="Local library"
          value={libraryConfigured ? String(localFiles.length) : "Not configured"}
          description={
            libraryConfigured
              ? "ISOs in the mounted Samba share."
              : "Set ISO_LIBRARY_PATH to enable."
          }
        />
      </div>

      {/* Proxmox ISO images */}
      <SectionPanel
        title="Proxmox storage"
        description="ISO images currently stored in your Proxmox cluster. These can be selected when creating a VM."
        noPadding
      >
        {isoResult.images.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-zinc-500">
            No ISO images found in Proxmox storage. Upload ISOs to a storage pool with ISO content type enabled.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {isoResult.images.map((iso) => (
              <div key={iso.volid} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-[13px] font-medium text-zinc-200">{iso.fileName}</p>
                  <p className="mt-0.5 text-[12px] text-zinc-500">
                    {iso.storage} · {iso.sizeLabel}
                    {iso.createdAt && ` · ${new Date(iso.createdAt).toLocaleDateString()}`}
                  </p>
                </div>
                <span className="rounded-md bg-zinc-800/60 px-2 py-1 text-[11px] text-zinc-400">
                  {iso.volid}
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionPanel>

      {/* Local Samba share ISOs */}
      {libraryConfigured && (
        <SectionPanel
          title="Local Samba share"
          description="ISO files from the mounted Samba share. These need to be uploaded to Proxmox storage before use."
          noPadding
        >
          {localFiles.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-zinc-500">
              No ISO files found in the configured Samba share directory.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {localFiles.map((file) => (
                <div key={file.filePath} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-[13px] font-medium text-zinc-200">{file.fileName}</p>
                    <p className="mt-0.5 text-[12px] text-zinc-500">
                      {file.sizeLabel} · Modified {new Date(file.modifiedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionPanel>
      )}
    </div>
  );
}
