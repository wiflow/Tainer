import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, Container } from "lucide-react";

export function HeroSection() {
	return (
		<section className="mx-auto w-full max-w-5xl overflow-hidden pt-16">
			{/* Shades */}
			<div
				aria-hidden="true"
				className="absolute inset-0 size-full overflow-hidden"
			>
				<div
					className={cn(
						"absolute inset-0 isolate -z-10",
						"bg-[radial-gradient(20%_80%_at_20%_0%,--theme(--color-foreground/.1),transparent)]"
					)}
				/>
			</div>
			<div className="relative z-10 flex max-w-2xl flex-col gap-5 px-4">
				<a
					className={cn(
						"group flex w-fit items-center gap-3 rounded-sm border border-white/10 bg-white/5 p-1",
						"fade-in slide-in-from-bottom-10 animate-in fill-mode-backwards transition-all delay-500 duration-500 ease-out"
					)}
					href="#features"
				>
					<div className="rounded-xs border border-white/10 bg-white/10 px-1.5 py-0.5">
						<p className="font-mono text-xs text-zinc-300">v0.8</p>
					</div>

					<span className="text-xs text-zinc-400">now with backup policies and alert monitoring</span>
					<span className="block h-5 border-l" />

					<div className="pr-1">
						<ArrowRightIcon className="size-3 -translate-x-0.5 duration-150 ease-out group-hover:translate-x-0.5" />
					</div>
				</a>

				<h1
					className={cn(
						"text-balance font-medium text-4xl text-white leading-tight md:text-5xl",
						"fade-in slide-in-from-bottom-10 animate-in fill-mode-backwards delay-100 duration-500 ease-out"
					)}
				>
					Self-Service Container Management for Proxmox
				</h1>

				<p
					className={cn(
						"text-zinc-400 text-sm tracking-wider sm:text-lg md:text-xl",
						"fade-in slide-in-from-bottom-10 animate-in fill-mode-backwards delay-200 duration-500 ease-out"
					)}
				>
					Deploy LXC containers from curated templates, manage lifecycles, <br /> and monitor your cluster — all from one dashboard.
				</p>

				<div className="fade-in slide-in-from-bottom-10 flex w-fit animate-in items-center justify-center gap-3 fill-mode-backwards pt-2 delay-300 duration-500 ease-out">
					<Button variant="outline" asChild>
						<a href="#features">
							<Container className="size-4 mr-2" data-icon="inline-start" />
							View Features
						</a>
					</Button>
					<Button asChild>
						<a href="/login">
							Open Dashboard
							<ArrowRightIcon className="size-4 ml-2" data-icon="inline-end" />
						</a>
					</Button>
				</div>
			</div>
			<div className="relative">
				<div
					className={cn(
						"absolute -inset-x-20 inset-y-0 -translate-y-1/3 scale-120 rounded-full",
						"bg-[radial-gradient(ellipse_at_center,theme(--color-foreground/.1),transparent,transparent)]",
						"blur-[50px]"
					)}
				/>
				<div
					className={cn(
						"mask-b-from-60% relative mt-8 -mr-56 overflow-hidden px-2 sm:mt-12 sm:mr-0 md:mt-20",
						"fade-in slide-in-from-bottom-5 animate-in fill-mode-backwards delay-100 duration-1000 ease-out"
					)}
				>
					<div className="relative inset-shadow-2xs inset-shadow-foreground/10 mx-auto max-w-5xl overflow-hidden rounded-lg border bg-background p-2 shadow-xl ring-1 ring-card dark:inset-shadow-foreground/20 dark:inset-shadow-xs">
						<div className="aspect-video rounded-lg border bg-zinc-900 flex items-center justify-center overflow-hidden">
							<div className="w-full h-full bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-8 flex flex-col gap-4">
								<div className="flex gap-3">
									<div className="h-20 flex-1 rounded-lg bg-zinc-800/80 border border-white/5" />
									<div className="h-20 flex-1 rounded-lg bg-zinc-800/80 border border-white/5" />
									<div className="h-20 flex-1 rounded-lg bg-zinc-800/80 border border-white/5" />
									<div className="h-20 flex-1 rounded-lg bg-zinc-800/80 border border-white/5" />
								</div>
								<div className="flex gap-3 flex-1">
									<div className="flex-1 rounded-lg bg-zinc-800/80 border border-white/5" />
									<div className="flex-1 rounded-lg bg-zinc-800/80 border border-white/5" />
								</div>
								<div className="h-32 rounded-lg bg-zinc-800/80 border border-white/5" />
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
