/**
 * PRD 35 E8 (WS8d): the run-end code-map write carries the run's SERVER chat on the wire
 * (the route derives the map's file anchors from the files it lists), and a run whose
 * Memory switch is off leaves one trace line instead of a silent "0 writes".
 */

import * as os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunKnowledgeRecorder } from "@builderforce/agent-tools";

const mocks = vi.hoisted(() => ({
  rememberProjectFact: vi.fn(async () => ({ ok: true })),
  noteRunStep: vi.fn(),
  appendSessionNote: vi.fn(async () => undefined),
  routeStream: vi.fn(),
}));
vi.mock("../bfApi", () => ({ rememberProjectFact: mocks.rememberProjectFact }));
vi.mock("../gateway/gateway", () => ({ getApiKey: vi.fn(async () => "k") }));
vi.mock("../models/modelRouting", () => ({ resolveModelRoute: vi.fn(async () => ({})), routeStream: mocks.routeStream }));
vi.mock("../memory/sessionNotes", () => ({ appendSessionNote: mocks.appendSessionNote }));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({
  noteRunStep: mocks.noteRunStep,
  withRunUsage: (s: unknown) => s,
}));

import { recordEditorRunEnd } from "./editorRunEnd";
import { finishedRun, MEMORY_OFF_NOTE } from "@builderforce/agent-run/memory";

function readOnlyRun(): RunKnowledgeRecorder {
  const r = new RunKnowledgeRecorder();
  r.setPrompt("review the PRD");
  for (const p of ["docs/specs/a.md", "docs/specs/b.md", "docs/specs/c.md"]) r.record("read_file", { path: p });
  return r;
}

const usage = (serverId: number | undefined) => ({
  ledger: {} as never,
  chatId: 7,
  runKey: 70,
  identity: { serverIdFor: vi.fn(async () => serverId) },
});

beforeEach(() => {
  mocks.rememberProjectFact.mockClear();
  mocks.noteRunStep.mockClear();
});

describe("recordEditorRunEnd's code-map write", () => {
  it("sends the run's server chat with a read-only run's map", async () => {
    await recordEditorRunEnd({} as never, os.tmpdir(), "s", readOnlyRun(), { memory: true, projectId: 12 }, usage(4242));
    await vi.waitFor(() => expect(mocks.rememberProjectFact).toHaveBeenCalledTimes(1));
    const [, projectId, key, , meta] = mocks.rememberProjectFact.mock.calls[0] as unknown as [unknown, number, string, string, unknown];
    expect(projectId).toBe(12);
    expect(key).toBe("codemap:docs/specs");
    expect(meta).toEqual({ chatId: 4242 });
  });

  it("sends no chat for a chat the server does not know", async () => {
    await recordEditorRunEnd({} as never, os.tmpdir(), "s", readOnlyRun(), { memory: true, projectId: 12 }, usage(undefined));
    await vi.waitFor(() => expect(mocks.rememberProjectFact).toHaveBeenCalledTimes(1));
    expect((mocks.rememberProjectFact.mock.calls[0] as unknown as unknown[])[4]).toEqual({});
  });

  it("learns from a read-only run's final answer: the completion sees it and its fact is written", async () => {
    const stream = vi.fn(async () => ({ text: JSON.stringify([{ key: "specs-live-in", kind: "root_cause", content: "The specs live in docs/specs and a.md owns the PRD index." }]) }));
    mocks.routeStream.mockReturnValueOnce(stream);
    await recordEditorRunEnd({} as never, os.tmpdir(), "s", finishedRun(readOnlyRun(), "The PRD index is owned by docs/specs/a.md."), { memory: true, projectId: 12 }, usage(4242));
    await vi.waitFor(() => expect(mocks.rememberProjectFact).toHaveBeenCalledTimes(2));
    const sent = (stream.mock.calls[0] as unknown as [{ messages: Array<{ content: string }> }])[0].messages[1]!.content;
    expect(sent).toContain("Conclusion:\nThe PRD index is owned by docs/specs/a.md.");
    expect(mocks.rememberProjectFact.mock.calls.map((c) => (c as unknown as unknown[])[2])).toContain("learned:specs-live-in");
  });

  it("a failed or stopped run (learn: false) still writes its code map but asks for no learned facts", async () => {
    mocks.routeStream.mockClear();
    await recordEditorRunEnd({} as never, os.tmpdir(), "s", finishedRun(readOnlyRun(), "An answer."), { memory: true, projectId: 12, learn: false }, usage(4242));
    await vi.waitFor(() => expect(mocks.rememberProjectFact).toHaveBeenCalledTimes(1));
    expect((mocks.rememberProjectFact.mock.calls[0] as unknown as unknown[])[2]).toBe("codemap:docs/specs");
    expect(mocks.routeStream).not.toHaveBeenCalled();
  });

  it("with Memory off writes nothing and says so once on the run's trace", async () => {
    await recordEditorRunEnd({} as never, os.tmpdir(), "s", readOnlyRun(), { memory: false, projectId: 12 }, usage(4242));
    expect(mocks.noteRunStep).toHaveBeenCalledTimes(1);
    expect(mocks.noteRunStep).toHaveBeenCalledWith(70, { label: "memory.commit_skipped", args: { reason: "memory-off" }, result: MEMORY_OFF_NOTE });
    expect(mocks.rememberProjectFact).not.toHaveBeenCalled();
  });
});
