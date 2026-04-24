"use client";

import { useActionState, useMemo, useState } from "react";
import { Variable } from "lucide-react";

import { bulkSetEnvAction } from "@/app/group-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialBasicActionState } from "@/lib/action-states";
import { useSiteBasePath } from "@/lib/use-site-path";

type MemberInfo = {
  id: string;
  templateName: string;
};

export function TagBulkEnv({
  tagSlug,
  memberCount,
  members,
}: {
  tagSlug: string;
  memberCount: number;
  members: MemberInfo[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    bulkSetEnvAction,
    initialBasicActionState,
  );
  const [existingOnly, setExistingOnly] = useState(false);
  const [imageFilter, setImageFilter] = useState("");

  const uniqueImages = useMemo(() => {
    const images = new Set(members.map((m) => m.templateName));
    return [...images].sort();
  }, [members]);

  const targetCount = imageFilter
    ? members.filter((m) => m.templateName === imageFilter).length
    : memberCount;

  const inputClassName =
    "w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500";

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-white/5">
        <div className="flex items-center gap-2">
          <Variable className="h-4 w-4 text-zinc-500" />
          <div>
            <CardTitle>Bulk environment</CardTitle>
            <CardDescription>
              Set or update a single environment variable across LXC containers in this tag.
            </CardDescription>
            <p className="text-[11px] text-zinc-600">Environment variables are only applied to LXC containers. VMs in this tag will be skipped.</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <Form action={formAction} className="space-y-4">
          <input name="siteSlug" type="hidden" value={siteSlug} />
          <input name="tagSlug" type="hidden" value={tagSlug} />
          <input name="existingOnly" type="hidden" value={existingOnly ? "true" : "false"} />
          <input name="imageFilter" type="hidden" value={imageFilter} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Key</span>
              <input
                className={`${inputClassName} mt-1 font-mono`}
                name="envKey"
                placeholder="GF_SERVER_HTTP_PORT"
                required
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                title="Letters, numbers, and underscores only"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Value</span>
              <input
                className={`${inputClassName} mt-1 font-mono`}
                name="envValue"
                placeholder="3030"
              />
            </label>
          </div>

          {uniqueImages.length > 1 && (
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-400">Target image</span>
              <select
                className={`${inputClassName} mt-1`}
                value={imageFilter}
                onChange={(e) => setImageFilter(e.target.value)}
              >
                <option value="">All images ({memberCount})</option>
                {uniqueImages.map((img) => {
                  const count = members.filter((m) => m.templateName === img).length;
                  return (
                    <option key={img} value={img}>
                      {img} ({count})
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          <label className="flex items-center gap-2 text-[13px] text-zinc-400">
            <input
              type="checkbox"
              checked={existingOnly}
              onChange={(e) => setExistingOnly(e.target.checked)}
              className="rounded"
            />
            Only update deployments that already have this key
          </label>

          {state.status === "success" && (
            <p className="text-[13px] text-emerald-400">{state.message}</p>
          )}
          {state.status === "error" && (
            <p className="text-[13px] text-red-400">{state.message}</p>
          )}

          <Button disabled={isPending || targetCount === 0} type="submit" variant="secondary">
            {isPending ? "Applying..." : `Apply to ${targetCount} deployment(s)`}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
