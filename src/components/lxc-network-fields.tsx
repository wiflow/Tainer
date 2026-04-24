"use client";

import { useEffect, useMemo, useState } from "react";

type LxcIpPoolOption = {
  availableAddresses: string[];
  availableCount: number;
  bridge: string;
  defaultDns: string;
  gateway: string;
  hostPrefix: number;
  id: string;
  ipamIssue?: string | null;
  ipamUsedCount?: number;
  name: string;
  subnet: string;
  tagName: string | null;
  tainerUsedCount?: number;
};

type LxcNetworkFieldsProps = {
  defaultBridge: string;
  inputClassName: string;
  ipPools?: LxcIpPoolOption[];
  mode: "dhcp" | "static";
  onModeChange: (mode: "dhcp" | "static") => void;
};

export function LxcNetworkFields({
  defaultBridge,
  inputClassName,
  ipPools = [],
  mode,
  onModeChange,
}: LxcNetworkFieldsProps) {
  const isStatic = mode === "static";
  const hasPools = ipPools.length > 0;
  const [staticSource, setStaticSource] = useState<"manual" | "pool">(
    hasPools ? "pool" : "manual",
  );
  const [selectedPoolId, setSelectedPoolId] = useState(ipPools[0]?.id ?? "");
  const [selectedPoolAddress, setSelectedPoolAddress] = useState(
    ipPools[0]?.availableAddresses[0] ?? "",
  );

  useEffect(() => {
    if (!hasPools) {
      setStaticSource("manual");
      setSelectedPoolId("");
      setSelectedPoolAddress("");
      return;
    }

    setSelectedPoolId((current) => (
      ipPools.some((pool) => pool.id === current) ? current : (ipPools[0]?.id ?? "")
    ));
  }, [hasPools, ipPools]);

  const selectedPool = useMemo(() => {
    if (!hasPools) {
      return null;
    }

    return ipPools.find((pool) => pool.id === selectedPoolId) ?? ipPools[0] ?? null;
  }, [hasPools, ipPools, selectedPoolId]);

  useEffect(() => {
    if (!selectedPool) {
      setSelectedPoolAddress("");
      return;
    }

    setSelectedPoolAddress((current) => (
      selectedPool.availableAddresses.includes(current)
        ? current
        : (selectedPool.availableAddresses[0] ?? "")
    ));
  }, [selectedPool]);

  const usePoolStatic = isStatic && staticSource === "pool" && selectedPool;
  const poolIpv4Cidr = usePoolStatic && selectedPoolAddress
    ? `${selectedPoolAddress}/${selectedPool.hostPrefix}`
    : "";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
          <span className="text-[13px] font-medium text-zinc-200">Bridge</span>
          <input
            className={inputClassName}
            defaultValue={defaultBridge}
            disabled={Boolean(usePoolStatic)}
            name="bridge"
            type="text"
          />
        </label>

        <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
          <span className="text-[13px] font-medium text-zinc-200">IPv4 mode</span>
          <select
            className={inputClassName}
            name="networkMode"
            onChange={(event) =>
              onModeChange(event.target.value === "static" ? "static" : "dhcp")}
            value={mode}
          >
            <option value="dhcp">DHCP</option>
            <option value="static">Static</option>
          </select>
        </label>
      </div>

      {isStatic && hasPools ? (
        <label className="block rounded-md border border-white/5 bg-[#111113] px-4 py-3">
          <span className="text-[13px] font-medium text-zinc-200">Static source</span>
          <select
            className={inputClassName}
            name="networkStaticSource"
            onChange={(event) =>
              setStaticSource(event.target.value === "pool" ? "pool" : "manual")}
            value={staticSource}
          >
            <option value="pool">IP pool</option>
            <option value="manual">Manual</option>
          </select>
        </label>
      ) : null}

      {usePoolStatic ? (
        <>
          <input name="ipPoolId" type="hidden" value={selectedPool.id} />
          <input name="poolIpAddress" type="hidden" value={selectedPoolAddress} />
          <input name="bridge" type="hidden" value={selectedPool.bridge} />
          <input name="gateway" type="hidden" value={selectedPool.gateway} />
          <input name="nameserver" type="hidden" value={selectedPool.defaultDns} />
          <input name="ipv4Cidr" type="hidden" value={poolIpv4Cidr} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">IP pool</span>
              <select
                className={inputClassName}
                onChange={(event) => setSelectedPoolId(event.target.value)}
                value={selectedPool.id}
              >
                {ipPools.map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {pool.name} ({pool.availableCount} free)
                  </option>
                ))}
              </select>
            </label>

            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">IP address</span>
              <select
                className={inputClassName}
                disabled={selectedPool.availableAddresses.length === 0}
                onChange={(event) => setSelectedPoolAddress(event.target.value)}
                value={selectedPoolAddress}
              >
                {selectedPool.availableAddresses.length > 0 ? (
                  selectedPool.availableAddresses.map((address) => (
                    <option key={`${selectedPool.id}:${address}`} value={address}>
                      {address}
                    </option>
                  ))
                ) : (
                  <option value="">No free IPs available</option>
                )}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-white/5 bg-zinc-950/60 px-4 py-3">
              <p className="text-[11px] font-medium text-zinc-500">Subnet</p>
              <p className="mt-1 break-all text-[13px] text-zinc-200">{selectedPool.subnet}</p>
            </div>
            <div className="rounded-md border border-white/5 bg-zinc-950/60 px-4 py-3">
              <p className="text-[11px] font-medium text-zinc-500">Bridge</p>
              <p className="mt-1 break-all text-[13px] text-zinc-200">{selectedPool.bridge}</p>
            </div>
            <div className="rounded-md border border-white/5 bg-zinc-950/60 px-4 py-3">
              <p className="text-[11px] font-medium text-zinc-500">Gateway</p>
              <p className="mt-1 break-all text-[13px] text-zinc-200">{selectedPool.gateway || "Not set"}</p>
            </div>
            <div className="rounded-md border border-white/5 bg-zinc-950/60 px-4 py-3">
              <p className="text-[11px] font-medium text-zinc-500">DNS</p>
              <p className="mt-1 break-all text-[13px] text-zinc-200">{selectedPool.defaultDns || "Not set"}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-white/5 bg-zinc-950/60 px-4 py-3">
              <p className="text-[11px] font-medium text-zinc-500">Free</p>
              <p className="mt-1 text-[16px] font-semibold text-emerald-300">{selectedPool.availableCount}</p>
            </div>
            <div className="rounded-md border border-white/5 bg-zinc-950/60 px-4 py-3">
              <p className="text-[11px] font-medium text-zinc-500">Used in Tainer</p>
              <p className="mt-1 text-[16px] font-semibold text-sky-300">{selectedPool.tainerUsedCount ?? 0}</p>
            </div>
            <div className="rounded-md border border-white/5 bg-zinc-950/60 px-4 py-3">
              <p className="text-[11px] font-medium text-zinc-500">Used in IPAM</p>
              <p className="mt-1 text-[16px] font-semibold text-amber-300">{selectedPool.ipamUsedCount ?? 0}</p>
            </div>
          </div>

          {selectedPool.tagName ? (
            <p className="text-[11px] leading-relaxed text-zinc-500">
              New deployments from this pool will also get the Tainer tag "{selectedPool.tagName}".
            </p>
          ) : null}

          {selectedPool.ipamIssue ? (
            <p className="text-[11px] leading-relaxed text-amber-400">
              IPAM lookup issue: {selectedPool.ipamIssue}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <input name="ipPoolId" type="hidden" value="" />
          <input name="poolIpAddress" type="hidden" value="" />

          <div className={isStatic ? "grid gap-3 sm:grid-cols-2" : "hidden"}>
            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3 sm:col-span-2">
              <span className="text-[13px] font-medium text-zinc-200">IPv4 / CIDR</span>
              <input
                className={inputClassName}
                disabled={!isStatic}
                name="ipv4Cidr"
                placeholder="10.0.0.50/24"
                type="text"
              />
            </label>

            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">Gateway</span>
              <input
                className={inputClassName}
                disabled={!isStatic}
                name="gateway"
                placeholder="10.0.0.1"
                type="text"
              />
            </label>

            <label className="rounded-md border border-white/5 bg-[#111113] px-4 py-3">
              <span className="text-[13px] font-medium text-zinc-200">DNS servers</span>
              <input
                className={inputClassName}
                disabled={!isStatic}
                name="nameserver"
                placeholder="1.1.1.1, 8.8.8.8"
                type="text"
              />
            </label>
          </div>
        </>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-500">
        DHCP uses `ip=dhcp`. Static mode supports either a manual IPv4/CIDR entry or a saved IP pool with prefilled bridge, gateway, and DNS defaults.
      </p>
    </div>
  );
}
