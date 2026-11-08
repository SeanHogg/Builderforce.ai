import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, type LocalFirstStore } from "@builderforce/local-first";
import type { RunHostMessage } from "./brainRunHostProtocol";
import { installRunRecovery, type RunRecoveryHostContext } from "./installRunRecovery";
import { createInterruptedRuns, toInterruptedRunView } from "./interruptedRunsView";
import { recordRunStarted, type RunLifecycleDeps } from "./runRecovery";

const at = new Date("2026-10-18T12:00:00.000Z");
const deps: RunLifecycleDeps = { deviceId: "device-1", now: () => at };
const ctx = (): RunRecoveryHostContext => ({ globalState: { get: () => undefined, update: async () => undefined } });
const recoveryOver = (store: LocalFirstStore) => installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });

async function setup(store: LocalFirstStore) {
  await recordRunStarted(store, deps, { runId: "a", chatId: "7" });
  await recordRunStarted(store, deps, { runId: "b" });
  const recovery = recoveryOver(store);
  await recovery.recovered;
  const logs: string[] = [];
  const runs = createInterruptedRuns({ recovery, log: (line) => void logs.push(line) });
  const posted: RunHostMessage[] = [];
  runs.attach({ post: (m) => void posted.push(m) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { runs, logs, posted };
}

const lastList = (posted: RunHostMessage[]) => {
  const last = [...posted].reverse().find((m) => m.type === "run.interrupted");
  return last && last.type === "run.interrupted" ? last.runs : [];
};
const idsOf = (posted: RunHostMessage[]) => lastList(posted).map((r) => r.runId).sort();

describe("toInterruptedRunView", () => {
  it("maps the run id, chat and interruption time", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "r1", chatId: "3" });
    const [run] = await recoveryOver(store).recovered;
    expect(toInterruptedRunView(run!)).toEqual({ runId: "r1", chatId: "3", interruptedAt: at.toISOString() });
  });

  it("omits the chat link when the run had no chat", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "r2" });
    const [run] = await recoveryOver(store).recovered;
    expect(toInterruptedRunView(run!)).not.toHaveProperty("chatId");
  });
});

describe("createInterruptedRuns", () => {
  it("lists the recovered runs and re-sends the list to a panel that attaches later (a webview reload)", async () => {
    const { runs, posted } = await setup(createMemoryLocalFirstStore());
    expect(idsOf(posted)).toEqual(["a", "b"]);
    const reloaded: RunHostMessage[] = [];
    runs.attach({ post: (m) => void reloaded.push(m) });
    expect(idsOf(reloaded)).toEqual(["a", "b"]);
  });

  it("acknowledging (a dismiss, or the webview's ack after a resume) unlists the run and persists across a restart", async () => {
    const store = createMemoryLocalFirstStore();
    const { runs, posted } = await setup(store);
    await runs.acknowledge("b");
    expect(idsOf(posted)).toEqual(["a"]);
    expect((await recoveryOver(store).interrupted()).map((r) => r.runId)).toEqual(["a"]);
  });

  it("acknowledging is idempotent and ignores an unknown run", async () => {
    const { runs, posted, logs } = await setup(createMemoryLocalFirstStore());
    await Promise.all([runs.acknowledge("a"), runs.acknowledge("a")]);
    await runs.acknowledge("a");
    await runs.acknowledge("nope");
    expect(idsOf(posted)).toEqual(["b"]);
    expect(logs).toEqual([]);
  });
});
