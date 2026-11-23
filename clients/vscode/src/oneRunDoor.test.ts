/**
 * ONE door into the agent runtime on the editor host: every run - the native participant's turn, a sub-agent - opens through
 * the host's GATED start (`gateStarts`: change-set identity, the run journal's start, delta capture), and the host starts it for
 * the 'vscode' entry point. Real `createBrainRunHost` and the real shared loop against a scripted gateway; the gate's `around`
 * and the loop's `startRun` request are observed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ requests: [] as Array<Record<string, unknown>> }));

vi.mock("@seanhogg/builderforce-brain-embedded", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@seanhogg/builderforce-brain-embedded")>();
  return {
    ...actual,
    startRun: (key: number, req: Record<string, unknown>) => {
      seen.requests.push({ ...req, __key: key });
      return actual.startRun(key, req as never);
    },
  };
});

const { resetBrainRunStore } = await import("@seanhogg/builderforce-brain-embedded");
const { fakeGateway } = await import("../harness/fakeGateway");
const { createBrainRunHost } = await import("./brainRunHost");
const { gateStarts } = await import("./hostStartGate");
const { transientRunPersistence } = await import("./nativeRunStream");
const { runViaHost } = await import("./participantRun");

type Payload = Parameters<ReturnType<typeof gateStarts>["start"]>[0];

/** The editor's wiring in miniature (`brainRunHostPorts.ts`): the host's own start, and the gate every run is routed through. */
function editorHost(replies: Array<{ text: string }>) {
  const gateway = fakeGateway(replies);
  const gated: Payload[] = [];
  let door!: ReturnType<typeof gateStarts>;
  const host = createBrainRunHost({
    tools: async () => [],
    workspaceRoot: () => "/workspace",
    startThrough: (spec: Payload) => door.start(spec),
    stream: async () => gateway.stream as never,
    persistence: transientRunPersistence(),
    evermind: () => undefined,
    labels: { blockedByPolicy: (r: string) => `blocked: ${r}`, dispatchHint: "" },
  } as never);
  door = gateStarts(host, async (payload, start) => {
    gated.push(payload);
    await start();
  });
  return { host, door, gated };
}

beforeEach(() => {
  resetBrainRunStore();
  seen.requests.length = 0;
});

describe("one door into the run", () => {
  it("regression: the participant's turn starts through the gated host start, for the 'vscode' entry point", async () => {
    const { host, door, gated } = editorHost([{ text: "Hi." }]);
    const text: string[] = [];
    const ran = await runViaHost({
      host: { ...host, start: door.start, stop: door.stop },
      spec: { chatId: 7301, systemPrompt: "You are the IDE agent.", userTurn: "hello", autoApprove: true, evermind: false, wakeable: false },
      approve: async () => true,
      events: { onText: (d) => void text.push(d), onToolStart: () => undefined, onToolResult: () => undefined, onError: () => undefined },
      labels: { dispatchHint: "hint" },
      onModelFallback: () => undefined,
      signal: new AbortController().signal,
    });

    expect(ran).toBe(true);
    expect(gated.map((p) => p.chatId)).toEqual([7301]);
    expect(seen.requests).toHaveLength(1);
    expect(seen.requests[0]).toMatchObject({ entryPoint: "vscode" });
    expect(text.join("")).toContain("Hi.");
  });

  it("regression: a sub-agent's start passes the same gate as its owner's, with its lineage", async () => {
    const { host, gated } = editorHost([{ text: "Done." }]);
    const owner = { key: 7302, rootChatId: 7302, name: "Ada", depth: 0 };
    const controls = host.childControls(owner, { systemPrompt: "You are the IDE agent.", projectId: null, chatMode: "work", autoApprove: true, evermind: false });
    const spawned = controls.spawn({ label: "look", task: "Look around", role: "explore" });
    expect(spawned.ok).toBe(true);

    await vi.waitFor(() => expect(gated).toHaveLength(1));
    const child = gated[0] as Payload & { child?: { lineage: { rootChatId: number } } };
    expect(child.chatId).not.toBe(owner.key);
    expect(child.child?.lineage.rootChatId).toBe(7302);
    await vi.waitFor(() => expect(seen.requests.some((r) => r.__key === child.chatId && r.entryPoint === "vscode")).toBe(true));
  });
});
