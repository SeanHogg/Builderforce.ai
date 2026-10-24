import { describe, expect, it, vi } from "vitest";
import type { LocalDeviceSupport } from "@builderforce/local-inference";
import { AUTO_PROVISION_MAX_BYTES, chooseAutoModel, createModelProvisioner, hostModelProvisioner, type ProvisionEvent } from "./provision";

/**
 * Hybrid's first local-first turn with nothing cached provisions ONE Bonsai the native
 * engine serves — the largest that fits, never past the unasked-download cap — once per
 * session, never over a model the picker already downloaded.
 */

const GIB = 1024 ** 3;
const nativeGpu: LocalDeviceSupport = {
  supported: true,
  f16: true,
  maxBufferBytes: 2 * GIB,
  maxStorageBufferBindingSizeBytes: 2 * GIB,
  backends: { cpu: { supported: true, simd: false, threads: 16, kvBudgetBytes: 2 * GIB, maxMemoryBytes: 16 * GIB, deviceMemoryBytes: 32 * GIB } },
};
const noGpuSmallRam: LocalDeviceSupport = {
  supported: false,
  reason: "no adapter",
  f16: false,
  maxBufferBytes: 0,
  // A 3 GiB machine: the native CPU budget floors at 512 MiB under a 1.5 GiB ceiling.
  backends: { cpu: { supported: true, simd: false, threads: 4, kvBudgetBytes: 512 * 1024 ** 2, maxMemoryBytes: 1.5 * GIB, deviceMemoryBytes: 3 * GIB } },
};
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function deps(cached: string[] = [], support: LocalDeviceSupport = nativeGpu) {
  const events: ProvisionEvent[] = [];
  const store = {
    status: vi.fn(async (ref: string) => (cached.includes(ref) ? ("ready" as const) : ("absent" as const))),
    download: vi.fn(async (_ref: string, onProgress?: (fraction: number) => void, _signal?: AbortSignal) => {
      onProgress?.(0.5);
      onProgress?.(1);
    }),
  };
  return {
    available: vi.fn(() => true),
    store,
    support: vi.fn(async () => support),
    onReady: vi.fn(),
    report: (e: ProvisionEvent) => void events.push(e),
    events,
  };
}

describe("chooseAutoModel", () => {
  it("takes the largest recommended Bonsai the device fits, never past the unasked-download cap", () => {
    const row = chooseAutoModel(nativeGpu);
    expect(row?.ref).toBe("local/bfi/bonsai-4b-q1_0");
    expect(row!.bytes).toBeLessThanOrEqual(AUTO_PROVISION_MAX_BYTES);
  });

  it("falls to a smaller row on a machine whose RAM holds only that, and to none when nothing fits", () => {
    expect(chooseAutoModel(noGpuSmallRam)?.ref).toBe("local/bfi/bonsai-1.7b-q1_0");
    expect(chooseAutoModel({ ...noGpuSmallRam, backends: { cpu: { supported: false, simd: false, threads: 1 } } })).toBeNull();
  });
});

describe("createModelProvisioner", () => {
  it("downloads the chosen row once, reports progress, then re-reads the cache so the worker attaches", async () => {
    const d = deps();
    const provisioner = createModelProvisioner(d);
    provisioner.ensure();
    provisioner.ensure();
    await flush();
    expect(d.store.download).toHaveBeenCalledTimes(1);
    expect(d.store.download.mock.calls[0]![0]).toBe("local/bfi/bonsai-4b-q1_0");
    expect(d.events.map((e) => e.kind)).toEqual(["start", "progress", "progress", "done"]);
    expect(d.onReady).toHaveBeenCalledTimes(1);
  });

  it("leaves a model the picker already downloaded alone", async () => {
    const d = deps(["local/bfi/bonsai-1.7b-q1_0"]);
    createModelProvisioner(d).ensure();
    await flush();
    expect(d.store.download).not.toHaveBeenCalled();
    expect(d.events).toEqual([]);
  });

  it("does nothing on a host without the native engine — and asks only when a turn ensures", async () => {
    const d = deps();
    d.available.mockReturnValue(false);
    const provisioner = createModelProvisioner(d);
    expect(d.available).not.toHaveBeenCalled();
    provisioner.ensure();
    await flush();
    expect(d.available).toHaveBeenCalledTimes(1);
    expect(d.store.status).not.toHaveBeenCalled();
    expect(d.store.download).not.toHaveBeenCalled();
  });

  it("stops the download when the notification is cancelled, quietly", async () => {
    const d = deps();
    d.store.download.mockImplementationOnce(
      (_ref, _onProgress, signal) =>
        new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("AbortError")))),
    );
    createModelProvisioner(d).ensure();
    await flush();
    const start = d.events[0];
    if (start?.kind !== "start") throw new Error("expected start");
    start.cancel();
    await flush();
    expect(d.events.map((e) => e.kind)).toEqual(["start", "cancelled"]);
    expect(d.onReady).not.toHaveBeenCalled();
  });

  it("reports a failed download and does not retry it this session", async () => {
    const d = deps();
    d.store.download.mockRejectedValueOnce(new Error("download_failed: HTTP 503"));
    const provisioner = createModelProvisioner(d);
    provisioner.ensure();
    await flush();
    provisioner.ensure();
    await flush();
    expect(d.store.download).toHaveBeenCalledTimes(1);
    expect(d.events.at(-1)).toMatchObject({ kind: "failed", error: "download_failed: HTTP 503" });
    expect(d.onReady).not.toHaveBeenCalled();
  });
});

describe("hostModelProvisioner", () => {
  it("forwards to the installed provisioner and is a no-op once uninstalled", () => {
    const ensure = vi.fn();
    const uninstall = hostModelProvisioner.install({ ensure });
    hostModelProvisioner.ensure();
    uninstall();
    hostModelProvisioner.ensure();
    expect(ensure).toHaveBeenCalledTimes(1);
  });
});
