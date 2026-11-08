import { vi } from "vitest";

/** The per-file routes of the knowledge client, as spies: the pack path must never call them. */
export function onPremOnlyPackSpies() {
  const putExtracted = vi.fn(async () => undefined);
  const storePutExtracted = vi.fn(async () => undefined);
  const storeWrite = vi.fn(async () => undefined);
  return {
    putExtracted, storePutExtracted, storeWrite,
    client: {
      putExtracted,
      putAnalysis: vi.fn(async () => undefined),
      graph: vi.fn(async () => null),
      store: { putExtracted: storePutExtracted, write: storeWrite },
    },
  };
}
