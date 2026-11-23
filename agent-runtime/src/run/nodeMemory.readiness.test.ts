import { afterEach, expect, it, vi } from "vitest";
import * as memoryService from "../infra/ssm-memory-service.js";
import { buildNodeMemory } from "./nodeMemory.js";

afterEach(() => vi.restoreAllMocks());

it("waits for memory startup to settle before deciding the capability is unavailable", async () => {
  let finish!: (value: null) => void;
  vi.spyOn(memoryService, "awaitSsmMemoryService").mockReturnValue(
    new Promise((resolve) => { finish = resolve; }),
  );
  const snapshot = vi.spyOn(memoryService, "getSsmMemoryService");
  let bound = false;
  const binding = buildNodeMemory().then((value) => { bound = true; return value; });
  await Promise.resolve();
  expect(bound).toBe(false);
  expect(snapshot).not.toHaveBeenCalled();
  finish(null);
  expect(await binding).toBeUndefined();
});
