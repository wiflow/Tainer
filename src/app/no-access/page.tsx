import { LogOut, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";

import { signOutAction } from "@/app/auth-actions";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Form } from "@/components/ui/form";
import { getCurrentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NoAccessPage() {
  const session = await getCurrentSession();

  // Layout's auth guard normally pushes anonymous users to /login already,
  // but be defensive in case this page is hit directly during a logout
  // race or stale cookie.
  if (!session) {
    redirect("/login");
  }

  // If the user actually has access, don't strand them on this page.
  // Admins always have access; non-admins need at least one site.
  const hasAnyAccess =
    session.user.role === "admin" || session.user.accessibleSiteIds.length > 0;
  if (hasAnyAccess) {
    redirect("/");
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#0a0a0a]">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldAlert className="h-5 w-5" />
          </EmptyMedia>
          <EmptyTitle>You don&apos;t have access yet</EmptyTitle>
          <EmptyDescription>
            Your account has been created in Tainer, but no permissions have
            been assigned to it. <br />
            Ask an administrator to add you to a group so you can see the
            sites and deployments you need.
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent>
          <p className="text-[12px] text-zinc-500">
            Signed in as{" "}
            <span className="text-zinc-300">{session.user.email}</span>
          </p>
          <Form action={signOutAction}>
            <Button type="submit" variant="secondary">
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>
          </Form>
        </EmptyContent>
      </Empty>
    </div>
  );
}
