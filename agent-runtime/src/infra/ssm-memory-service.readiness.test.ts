import { afterEach, describe, expect, it, vi } from "vitest";
import { SsmMemoryRegistry, SsmMemoryService } from "./ssm-memory-service.js";

afterEach(() => vi.restoreAllMocks());

describe("SSM memory readiness", () => {
  it("waits for startup and shares initialization across concurrent callers", async () => {
    const service = Object.create(SsmMemoryService.prototype) as SsmMemoryService;
    let finish!: (value: SsmMemoryService) => void;
    const create = vi.spyOn(SsmMemoryService, "create").mockReturnValue(
      new Promise((resolve) => { finish = resolve; }),
    );
    const registry = new SsmMemoryRegistry();
    const startup = registry.init({ checkpointPath: "configured-model.bin" });
    const concurrent = registry.init();
    let bound = false;
    const binding = registry.ready().then((value) => { bound = true; return value; });
    await Promise.resolve();
    expect(bound).toBe(false);
    expect(registry.get()).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ checkpointPath: "configured-model.bin" });

    finish(service);
    expect(await binding).toBe(service);
    expect(await startup).toBe(service);
    expect(await concurrent).toBe(service);
    expect(await registry.init()).toBe(service);
    expect(await registry.ready()).toBe(service);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("settles a failed startup as unavailable and permits an explicit retry", async () => {
    const service = Object.create(SsmMemoryService.prototype) as SsmMemoryService;
    vi.spyOn(SsmMemoryService, "create")
      .mockRejectedValueOnce(new Error("load failed"))
      .mockResolvedValueOnce(service);
    const registry = new SsmMemoryRegistry();
    const startup = registry.init();
    expect(await registry.ready()).toBeNull();
    expect(await startup).toBeNull();
    expect(await registry.init()).toBe(service);
  });

  it("does not initialize an unconfigured service while checking readiness", async () => {
    const create = vi.spyOn(SsmMemoryService, "create");
    expect(await new SsmMemoryRegistry().ready()).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
