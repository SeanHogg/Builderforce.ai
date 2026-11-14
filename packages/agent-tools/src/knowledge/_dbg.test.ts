import { expect, it, vi } from "vitest";

// A: mock the .ts specifier directly — does vi.mock intercept at all?
vi.mock("./replicaPump.ts", () => ({
  pumpReplica: Object.assign(vi.fn(async () => ({ dirty: 0, sending: false, failed: [] })), { tag: "mocked-via-ts" }),
  GENERATION_CHECK_INTERVAL_MS: 60_000,
  emptyReplicaState: () => ({ dirty: 0, sending: false, failed: [] }),
}));

import { pumpReplica } from "./replicaPump.js";

it("pumpReplica is intercepted when mocking the .ts path", () => {
  const m = pumpReplica as unknown as { tag?: string; _isMockFunction?: boolean };
  console.log("tag:", m.tag, "_isMockFunction:", m._isMockFunction);
  expect(m.tag).toBe("mocked-via-ts");
});
