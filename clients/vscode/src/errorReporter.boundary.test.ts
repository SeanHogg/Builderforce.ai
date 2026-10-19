import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createOutbox } from "@builderforce/write-outbox";

/**
 * The error-reports boundary. Two properties this module must never lose:
 *
 *   1. Filing goes through the best-effort `error-reports` outbox — the one
 *      queue every signed-in client reports through — and never as a bare request.
 *   2. Filing touches NO local-first snapshot bytes. The outbox persists through
 *      the extension's own Memento-backed store; the local system of record is a
 *      different store with different bytes. An error report must not be able to
 *      rewrite, or be lost with, a user's offline records.
 *
 * This file does not import errorReporter.ts: that module pulls the extension
 * host. errorReporter.test.ts owns the queue CLASSIFICATION (G13); this file owns
 * the CALL BOUNDARY and does not restate it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const reporter = readFileSync(path.join(here, "errorReporter.ts"), "utf8");

const countOf = (needle: string): number => reporter.split(needle).length - 1;

describe("errorReporter filing boundary", () => {
  it("files through the outbox exactly once, and never calls it directly", () => {
    // One call site = one seam. Two would mean two queueing paths that can drift.
    expect(countOf("reports.enqueue(")).toBe(1);

    // Not a bare request: the network call belongs to the queue's `send`.
    expect(reporter).toContain("send: async (lane, events, ctx) => {");
    expect(reporter).toContain('"/api/quality-ingest/client-report"');

    // Queueing is fire-and-forget for telemetry. enqueueDurable AWAITS the store
    // and throws when it fails, which would turn a best-effort report into a
    // failure path — so the queue keeps `enqueue`.
    expect(reporter).not.toContain("enqueueDurable");
    expect(reporter).not.toContain("await reports.");
  });

  it("touches no local-first snapshot bytes", () => {
    // The snapshot file, its reader/writer, and the host that owns them. None of
    // these may appear in an error-reporting path.
    for (const forbidden of [
      "bootVsixHost",
      "localFirst",
      "LocalFirst",
      "local-first",
      "local-first-v1.json",
      "VSIX_LOCAL_SNAPSHOT_FILE",
      "createMemoryLocalFirstStore",
      "exportLocalFirst",
      "commitLocalFirst",
    ]) {
      expect(reporter).not.toContain(forbidden);
    }

    // Its only persistence door is the outbox factory, not a store it builds.
    expect(reporter).toContain('from "./outboxStorage"');
    expect(reporter).not.toContain("createOutbox(");
  });

  it("keeps `enqueue` unacknowledged while `enqueueDurable` would not be", async () => {
    // The G14 seam, stated as behaviour: `enqueue` hands back an id BEFORE the
    // store acknowledges the write, so it cannot claim data is saved — and
    // cannot fail a caller on a telemetry store error. `enqueueDurable` awaits.
    const store = {
      load: () => [],
      put: () => {
        throw new Error("store unavailable");
      },
      remove: () => {},
    };
    const onStoreError = (): void => {};

    const telemetry = createOutbox<{ n: number }, string>({
      send: async () => undefined,
      work: "telemetry",
      store,
      onStoreError,
    });
    await telemetry.ready();

    // Synchronous string id, no rejection, despite the store throwing.
    expect(() => telemetry.enqueue("lane", { n: 1 })).not.toThrow();
    await expect(telemetry.enqueueDurable("lane", { n: 1 })).rejects.toThrow("store unavailable");
    telemetry.close();
  });
});