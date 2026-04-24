import Link from "next/link";
import {
  ArrowRight,
  Box,
  Container,
  Cpu,
  HardDrive,
  Layers,
  Lock,
  MemoryStick,
  Monitor,
  Network,
  RefreshCw,
  Shield,
  Terminal,
  Zap,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-white/10">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link href="/hero-demo" className="font-display text-lg font-bold tracking-tight text-white">
              Tainer
            </Link>
            <div className="hidden items-center gap-6 text-[13px] text-zinc-400 md:flex">
              <a href="#features" className="transition-colors hover:text-white">Features</a>
              <a href="#how-it-works" className="transition-colors hover:text-white">How it works</a>
              <a href="#stats" className="transition-colors hover:text-white">Why Tainer</a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden rounded-lg px-4 py-2 text-[13px] font-medium text-zinc-400 transition-colors hover:text-white md:block">
              Sign in
            </Link>
            <Link href="/setup" className="rounded-lg bg-white px-4 py-2 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-zinc-200">
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,rgba(120,119,198,0.08),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.02),transparent)]" />

        <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-24 md:pt-32">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-emerald-400">
                v0.8
              </span>
              <span className="text-[12px] text-zinc-500">
                Backup policies and alert monitoring
              </span>
            </div>

            <h1 className="font-display text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-[1.1] tracking-tight text-white">
              Self-service container
              <br />
              <span className="text-zinc-500">management for Proxmox</span>
            </h1>

            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-zinc-400">
              Deploy LXC containers from curated templates, manage lifecycles,
              and monitor your entire cluster from a single dashboard.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/login"
                className="group flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-[14px] font-medium text-zinc-950 transition-all hover:bg-zinc-200"
              >
                Open Dashboard
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#features"
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 py-3 text-[14px] font-medium text-zinc-300 transition-all hover:border-white/20 hover:bg-white/[0.06]"
              >
                <Terminal className="h-4 w-4" />
                Explore Features
              </a>
            </div>
          </div>

          {/* Dashboard Preview */}
          <div className="relative mt-16 md:mt-24">
            <div className="absolute -inset-4 rounded-2xl bg-gradient-to-b from-white/[0.03] to-transparent" />
            <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-900/50 shadow-2xl shadow-black/40">
              {/* Title bar */}
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                </div>
                <div className="ml-4 h-5 w-48 rounded bg-zinc-800/80" />
              </div>
              {/* Dashboard wireframe */}
              <div className="p-4 md:p-6">
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-lg border border-white/5 bg-zinc-800/40 p-4">
                    <div className="h-2 w-12 rounded bg-zinc-700" />
                    <div className="mt-3 h-6 w-8 rounded bg-zinc-600" />
                    <div className="mt-2 h-2 w-20 rounded bg-zinc-700/50" />
                  </div>
                  <div className="rounded-lg border border-white/5 bg-zinc-800/40 p-4">
                    <div className="h-2 w-16 rounded bg-zinc-700" />
                    <div className="mt-3 h-6 w-10 rounded bg-zinc-600" />
                    <div className="mt-2 h-2 w-24 rounded bg-zinc-700/50" />
                  </div>
                  <div className="rounded-lg border border-white/5 bg-zinc-800/40 p-4">
                    <div className="h-2 w-10 rounded bg-zinc-700" />
                    <div className="mt-3 h-6 w-12 rounded bg-zinc-600" />
                    <div className="mt-2 h-2 w-16 rounded bg-zinc-700/50" />
                  </div>
                  <div className="rounded-lg border border-white/5 bg-zinc-800/40 p-4">
                    <div className="h-2 w-8 rounded bg-zinc-700" />
                    <div className="mt-3 h-6 w-6 rounded bg-zinc-600" />
                    <div className="mt-2 h-2 w-20 rounded bg-zinc-700/50" />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="h-36 rounded-lg border border-white/5 bg-zinc-800/40 p-4">
                    <div className="h-2 w-20 rounded bg-zinc-700" />
                    <svg className="mt-4 h-20 w-full" viewBox="0 0 200 60">
                      <path d="M0 50 Q25 20 50 35 T100 25 T150 30 T200 15" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                      <path d="M0 55 Q25 40 50 45 T100 35 T150 40 T200 30" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
                    </svg>
                  </div>
                  <div className="h-36 rounded-lg border border-white/5 bg-zinc-800/40 p-4">
                    <div className="h-2 w-24 rounded bg-zinc-700" />
                    <svg className="mt-4 h-20 w-full" viewBox="0 0 200 60">
                      <path d="M0 40 Q30 10 60 30 T120 20 T180 35 T200 10" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                    </svg>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-white/5 bg-zinc-800/40">
                  <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
                    <div className="h-2 w-16 rounded bg-zinc-700" />
                    <div className="h-2 w-12 rounded bg-zinc-700/50" />
                    <div className="h-2 w-10 rounded bg-zinc-700/50" />
                  </div>
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-4 border-b border-white/[0.03] px-4 py-2.5">
                      <div className="h-2 w-6 rounded bg-zinc-700/50" />
                      <div className="h-2 w-24 rounded bg-zinc-700/70" />
                      <div className="h-2 w-16 rounded bg-zinc-700/40" />
                      <div className="ml-auto flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/60" />
                        <div className="h-2 w-12 rounded bg-zinc-700/40" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Bottom fade */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-zinc-950 to-transparent" />
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="relative border-t border-white/5 py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-16">
            <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Capabilities
            </p>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Everything you need to manage
              <br />
              <span className="text-zinc-500">containerized infrastructure</span>
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Container,
                title: "LXC Management",
                desc: "Create, start, stop, restart, and delete containers with full lifecycle control through an intuitive interface.",
              },
              {
                icon: Layers,
                title: "Template Catalog",
                desc: "Curate deployment templates with pre-configured specs, environment variables, and network settings.",
              },
              {
                icon: Monitor,
                title: "Cluster Dashboard",
                desc: "Real-time CPU, RAM, storage, and network metrics with historical charts across all cluster nodes.",
              },
              {
                icon: Shield,
                title: "Backup & SLA",
                desc: "Automated backup policies with SLA tracking. Flag unprotected workloads before they become incidents.",
              },
              {
                icon: Lock,
                title: "Auth & 2FA",
                desc: "Cookie-based sessions with scrypt password hashing, TOTP two-factor auth, and encrypted recovery codes.",
              },
              {
                icon: Network,
                title: "IP Pool Management",
                desc: "Named IPv4 subnets with automatic free address discovery and IPAM integration for static networking.",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="group rounded-xl border border-white/5 bg-white/[0.02] p-6 transition-all hover:border-white/10 hover:bg-white/[0.04]"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
                  <feature.icon className="h-5 w-5 text-zinc-400 transition-colors group-hover:text-white" />
                </div>
                <h3 className="text-[15px] font-semibold text-white">{feature.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="border-t border-white/5 py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-16">
            <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Workflow
            </p>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-white md:text-4xl">
              From template to running
              <br />
              <span className="text-zinc-500">container in three steps</span>
            </h2>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                step: "01",
                icon: Box,
                title: "Choose a Template",
                desc: "Browse the catalog of pre-built container templates or import OCI images from Docker Hub or your private registry.",
              },
              {
                step: "02",
                icon: Zap,
                title: "Configure & Deploy",
                desc: "Set hostname, resources, network, and environment variables. Pick a node and storage pool, then launch.",
              },
              {
                step: "03",
                icon: RefreshCw,
                title: "Monitor & Manage",
                desc: "Track resource usage, manage backups, access the console, and control the full lifecycle from the dashboard.",
              },
            ].map((item) => (
              <div key={item.step} className="relative">
                <span className="font-mono text-[64px] font-bold leading-none text-white/[0.04]">
                  {item.step}
                </span>
                <div className="mt-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
                  <item.icon className="h-5 w-5 text-zinc-400" />
                </div>
                <h3 className="mt-4 text-[15px] font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section id="stats" className="border-t border-white/5 py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-10 md:p-16">
            <div className="mb-12 max-w-lg">
              <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Built for Scale
              </p>
              <h2 className="font-display text-3xl font-semibold tracking-tight text-white md:text-4xl">
                Infrastructure teams choose Tainer
              </h2>
            </div>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { value: "< 5s", label: "Average deploy time", icon: Zap },
                { value: "100%", label: "Proxmox API coverage", icon: Cpu },
                { value: "0", label: "Database dependencies", icon: HardDrive },
                { value: "24/7", label: "Backup SLA monitoring", icon: MemoryStick },
              ].map((stat) => (
                <div key={stat.label}>
                  <stat.icon className="mb-3 h-5 w-5 text-zinc-600" />
                  <p className="font-display text-3xl font-semibold text-white md:text-4xl">{stat.value}</p>
                  <p className="mt-1 text-[13px] text-zinc-500">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Tech Stack ── */}
      <section className="border-t border-white/5 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <p className="mb-8 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600">
            Built With
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-[13px] font-medium text-zinc-600">
            <span>Next.js</span>
            <span className="text-zinc-800">|</span>
            <span>React 19</span>
            <span className="text-zinc-800">|</span>
            <span>TypeScript</span>
            <span className="text-zinc-800">|</span>
            <span>Tailwind CSS</span>
            <span className="text-zinc-800">|</span>
            <span>Proxmox VE API</span>
            <span className="text-zinc-800">|</span>
            <span>File-based Storage</span>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="border-t border-white/5 py-28">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight text-white md:text-5xl">
            Ready to manage your
            <br />
            Proxmox containers?
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[16px] leading-relaxed text-zinc-500">
            Set up Tainer in minutes. No database required.
            Connect to your Proxmox cluster and start deploying.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/setup"
              className="group flex items-center gap-2 rounded-lg bg-white px-6 py-3.5 text-[14px] font-medium text-zinc-950 transition-all hover:bg-zinc-200"
            >
              Get Started
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-6 py-3.5 text-[14px] font-medium text-zinc-300 transition-all hover:border-white/20 hover:bg-white/[0.06]"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <span className="font-display text-sm font-bold tracking-tight text-zinc-600">Tainer</span>
          <p className="text-[12px] text-zinc-700">
            Self-service Proxmox LXC management. No database. No complexity.
          </p>
        </div>
      </footer>
    </div>
  );
}
