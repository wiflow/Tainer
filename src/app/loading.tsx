import Image from "next/image";

export default function RootLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a]">
      <Image
        alt="Tainer"
        className="brightness-90"
        height={83}
        priority
        src="/tainerlong.png"
        width={220}
      />
      <div className="mt-6 h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
    </div>
  );
}
