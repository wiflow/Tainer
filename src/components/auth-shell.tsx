import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

type AuthShellProps = {
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ children, footer }: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0a0a]">
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-gradient-drift absolute -left-[15%] -top-[25%] h-[550px] w-[550px] rounded-full bg-zinc-400/[0.025] blur-[120px]" />
        <div className="animate-gradient-drift absolute -bottom-[18%] -right-[12%] h-[480px] w-[480px] rounded-full bg-zinc-500/[0.02] blur-[100px] [animation-delay:8s]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 py-16">
        <div className="animate-slide-up mb-8 flex flex-col items-center gap-3">
          <Image
            alt="Tainer"
            className="brightness-90"
            height={83}
            priority
            src="/tainerlong.png"
            width={220}
          />
        </div>

        <div className="animate-slide-up w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] p-7 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl [animation-delay:80ms] sm:p-8">
          {children}
        </div>

        {footer ? (
          <div className="animate-fade-in mt-6 text-[12px] text-zinc-600 [animation-delay:400ms]">
            {footer}
          </div>
        ) : (
          <p className="animate-fade-in mt-6 text-center text-[12px] text-zinc-600 [animation-delay:400ms]">
            Need help?{" "}
            <Link
              className="text-zinc-400 transition-colors hover:text-zinc-200"
              href="/login"
            >
              Return to sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
