import type { Metadata } from "next";
import { Outfit, Plus_Jakarta_Sans, Geist } from "next/font/google";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { TaskToastProvider } from "@/components/task-toast-provider";
import { getCurrentSession, getUserCount } from "@/lib/auth";
import { listEnabledSites } from "@/lib/site-store";
import packageJson from "../../package.json";

import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
});

export const metadata: Metadata = {
  title: "Tainer",
  description:
    "A service-catalog dashboard for Proxmox LXC templates, deployments, and controlled environment changes.",
  other: {
    "color-scheme": "dark",
  },
};

const PUBLIC_PATHS = new Set([
  "/forgot-password",
  "/login",
  "/reset-password",
  "/setup",
]);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const pathname = headerStore.get("x-pathname") ?? "/";
  const [userCount, session] = await Promise.all([
    getUserCount(),
    getCurrentSession(),
  ]);
  const isPublicPath = PUBLIC_PATHS.has(pathname);
  const isDemoPath = pathname === "/hero-demo";

  if (userCount === 0 && pathname !== "/setup") {
    redirect("/setup");
  }

  if (userCount > 0 && pathname === "/setup") {
    redirect(session ? "/" : "/login");
  }

  if (isDemoPath) {
    return (
      <html className={cn(outfit.variable, plusJakarta.variable, "font-sans", geist.variable)} lang="en" style={{ background: "#0a0a0a" }} suppressHydrationWarning>
        <body className="min-h-screen bg-zinc-950 text-zinc-100">
          {children}
        </body>
      </html>
    );
  }

  if (isPublicPath) {
    if (session) {
      redirect("/");
    }

    return (
      <html className={cn(outfit.variable, plusJakarta.variable, "font-sans", geist.variable)} lang="en" style={{ background: "#0a0a0a" }} suppressHydrationWarning>
        <body className="min-h-screen bg-zinc-950 text-zinc-100">
          {children}
        </body>
      </html>
    );
  }

  if (!session) {
    redirect("/login");
  }

  // Resolve sites for the sidebar, filtered by user access.
  const allSites = await listEnabledSites();
  const sites = session.user.role === "admin"
    ? allSites
    : allSites.filter((s) => session.user.accessibleSiteIds.includes(s.id));

  return (
    <html className={cn(outfit.variable, plusJakarta.variable, "font-sans", geist.variable)} lang="en" style={{ background: "#0a0a0a" }} suppressHydrationWarning>
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        <TaskToastProvider>
          <a className="skip-to-content" href="#main-content">
            Skip to main content
          </a>
          <CommandPalette currentUser={session.user} />
          <AppSidebar
            currentUser={session.user}
            version={packageJson.version}
            sites={sites.map((s) => ({ id: s.id, slug: s.slug, name: s.name, healthy: s.lastValidationOk }))}
          />
          <main className="min-h-screen lg:pl-[240px]" id="main-content" tabIndex={-1}>
            <div className="mx-auto max-w-[1100px] px-6 py-8 lg:px-10 lg:py-10" data-content-wrapper>
              {children}
            </div>
          </main>
        </TaskToastProvider>
      </body>
    </html>
  );
}
