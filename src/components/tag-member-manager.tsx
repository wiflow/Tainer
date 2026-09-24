"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, Minus, Plus } from "lucide-react";

import { assignContainerToTagAction } from "@/app/group-actions";
import { DeploymentTagList } from "@/components/deployment-tag-list";
import { useActionTaskFeedback } from "@/components/task-toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { initialActionState } from "@/lib/action-states";
import type { LiveDeployment } from "@/lib/proxmox";
import type { ManagedTagDefinition } from "@/lib/tag-utils";
import { useSiteBasePath } from "@/lib/use-site-path";

type TagMemberManagerProps = {
  tagSlug: string;
  members: LiveDeployment[];
  nonMembers: LiveDeployment[];
  tags: ManagedTagDefinition[];
};

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 disabled:pointer-events-none disabled:opacity-50";

function RemoveMemberRow({
  deployment,
  tagSlug,
  tags,
}: {
  deployment: LiveDeployment;
  tagSlug: string;
  tags: ManagedTagDefinition[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [state, formAction, isPending] = useActionState(
    assignContainerToTagAction,
    initialActionState,
  );

  useActionTaskFeedback(state, {
    errorTitle: "Remove failed",
    successTitle: "Member removed",
  });

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-zinc-950/40 px-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-zinc-200">
          {deployment.name}
        </p>
        <p className="text-[12px] text-zinc-500">
          {deployment.node} · VMID {deployment.vmid}
        </p>
        {deployment.tagList.length > 0 && (
          <DeploymentTagList className="mt-2" tagClassName="px-2 py-0.5" tagList={deployment.tagList} tags={tags} />
        )}
      </div>
      <Form action={formAction}>
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <input name="deploymentId" type="hidden" value={deployment.id} />
        <input name="removeGroupSlug" type="hidden" value={tagSlug} />
        <Button
          className="h-7 w-7 px-0 text-zinc-400 hover:text-red-400"
          disabled={isPending}
          title={`Remove ${deployment.name} from tag`}
          type="submit"
          variant="ghost"
        >
          {isPending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Minus className="h-3.5 w-3.5" />
          )}
        </Button>
      </Form>
    </div>
  );
}

function AddMemberForm({
  tagSlug,
  nonMembers,
}: {
  tagSlug: string;
  nonMembers: LiveDeployment[];
}) {
  const siteSlug = useSiteBasePath().replace(/^\/sites\//, "");
  const [selectedId, setSelectedId] = useState("");

  const [state, formAction, isPending] = useActionState(
    assignContainerToTagAction,
    initialActionState,
  );

  useActionTaskFeedback(state, {
    errorTitle: "Assignment failed",
    successTitle: "Member assigned",
  });

  return (
    <div className="rounded-md border border-dashed border-white/10 bg-zinc-900/20 px-4 py-3">
      <p className="mb-2 text-[12px] font-medium text-zinc-500">
        Add member
      </p>
      <Form action={formAction} className="flex items-center gap-2">
        <input name="siteSlug" type="hidden" value={siteSlug} />
        <input name="groupSlug" type="hidden" value={tagSlug} />
        <select
          className={selectClassName}
          name="deploymentId"
          onChange={(e) => setSelectedId(e.target.value)}
          value={selectedId}
        >
          <option value="">Select a deployment...</option>
          {nonMembers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} (VMID {d.vmid} · {d.node})
            </option>
          ))}
        </select>
        <Button
          className="flex-shrink-0"
          disabled={!selectedId || isPending}
          size="sm"
          type="submit"
          variant="secondary"
        >
          {isPending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </Button>
      </Form>
    </div>
  );
}

export function TagMemberManager({
  tagSlug,
  members,
  nonMembers,
  tags,
}: TagMemberManagerProps) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="border-b border-white/5">
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Containers and VMs currently assigned to this tag. Add or remove members below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        {members.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-zinc-500">
              Current members ({members.length})
            </p>
            {members.map((deployment) => (
              <RemoveMemberRow
                deployment={deployment}
                key={deployment.id}
                tagSlug={tagSlug}
                tags={tags}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
            <p className="text-[13px] text-zinc-500">
              No deployments are assigned to this tag yet.
            </p>
          </div>
        )}

        {nonMembers.length > 0 && (
          <AddMemberForm tagSlug={tagSlug} nonMembers={nonMembers} />
        )}

        {nonMembers.length === 0 && members.length > 0 && (
          <p className="text-[12px] text-zinc-500">
            All deployments already have this tag.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
