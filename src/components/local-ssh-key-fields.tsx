"use client";

import { useId, useState } from "react";
import { KeyRound, Upload } from "lucide-react";

type LocalSshKeyFieldsProps = {
  defaultLoginUser: string;
  disabled?: boolean;
  disabledMessage?: string;
  helpText?: string;
  includeLoginUser?: boolean;
  loginUserLabel?: string;
  modeFieldName?: string;
  publicKeyFieldName?: string;
  loginUserFieldName?: string;
  title?: string;
};

type LocalSshMode = "none" | "generate" | "upload";

export function LocalSshKeyFields({
  defaultLoginUser,
  disabled = false,
  disabledMessage,
  helpText,
  includeLoginUser = true,
  loginUserFieldName = "localSshLoginUser",
  loginUserLabel = "SSH login user",
  modeFieldName = "localSshMode",
  publicKeyFieldName = "localSshPublicKey",
  title = "Optional SSH key",
}: LocalSshKeyFieldsProps) {
  const uploadId = useId();
  const [mode, setMode] = useState<LocalSshMode>("none");

  const inputClassName =
    "mt-1.5 w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-colors focus:border-zinc-500 focus:bg-zinc-900";

  if (disabled) {
    return (
      <div className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
        <input name={modeFieldName} type="hidden" value="none" />
        <p className="text-[13px] font-medium text-zinc-200">{title}</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">
          {disabledMessage ?? "Automatic SSH key injection is unavailable for this creation flow."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-white/5 bg-[#111113] px-4 py-3">
      <div>
        <p className="text-[13px] font-medium text-zinc-200">{title}</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">
          {helpText ?? "Generate a new SSH keypair or paste an existing public key. Generated private keys stay downloadable from the deployment page."}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/5 bg-zinc-950/60 px-3 py-3 text-[13px] text-zinc-300">
          <input
            checked={mode === "none"}
            name={modeFieldName}
            onChange={() => setMode("none")}
            type="radio"
            value="none"
          />
          <span>
            <span className="block font-medium text-zinc-100">No SSH key</span>
            <span className="mt-1 block text-[12px] leading-relaxed text-zinc-500">
              Skip SSH key injection for this deployment.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/5 bg-zinc-950/60 px-3 py-3 text-[13px] text-zinc-300">
          <input
            checked={mode === "generate"}
            name={modeFieldName}
            onChange={() => setMode("generate")}
            type="radio"
            value="generate"
          />
          <span>
            <span className="flex items-center gap-1.5 font-medium text-zinc-100">
              <KeyRound className="h-3.5 w-3.5" />
              Generate keypair
            </span>
            <span className="mt-1 block text-[12px] leading-relaxed text-zinc-500">
              Tainer injects the public key and stores the private key for later download.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/5 bg-zinc-950/60 px-3 py-3 text-[13px] text-zinc-300">
          <input
            checked={mode === "upload"}
            name={modeFieldName}
            onChange={() => setMode("upload")}
            type="radio"
            value="upload"
          />
          <span>
            <span className="flex items-center gap-1.5 font-medium text-zinc-100">
              <Upload className="h-3.5 w-3.5" />
              Use public key
            </span>
            <span className="mt-1 block text-[12px] leading-relaxed text-zinc-500">
              Paste a single-line OpenSSH public key you already control.
            </span>
          </span>
        </label>
      </div>

      {includeLoginUser ? (
        <label className="block">
          <span className="text-[13px] font-medium text-zinc-200">{loginUserLabel}</span>
          <input
            className={inputClassName}
            defaultValue={defaultLoginUser}
            name={loginUserFieldName}
            placeholder="root"
            type="text"
          />
        </label>
      ) : (
        <input name={loginUserFieldName} type="hidden" value={defaultLoginUser} />
      )}

      {mode === "upload" ? (
        <label className="block" htmlFor={uploadId}>
          <span className="text-[13px] font-medium text-zinc-200">Public key</span>
          <textarea
            className={`${inputClassName} min-h-24 resize-y font-mono`}
            id={uploadId}
            name={publicKeyFieldName}
            placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI..."
          />
        </label>
      ) : null}
    </div>
  );
}
