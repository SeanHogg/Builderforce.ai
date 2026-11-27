/**
 * The VS Code host declares itself (PRD 35 §8.2): the run it starts carries `entryPoint: 'vscode'`, so the one agent's uniform outcome
 * row is labelled by the host and not by a test argument. The host's own `startRun` call is observed (a pass-through wrapper: the run
 * still executes); the row itself is proved for the label end to end by brain-embedded's `crossAdapterConformance.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ requests: [] as Array<Record<string, unknown>> }));

vi.mock("@seanhogg/builderforce-brain-embedded", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@seanhogg/builderforce-brain-embedded")>();
  return {
    ...actual,
    startRun: (key: number, req: Record<string, unknown>) => {
      seen.requests.push(req);
      return actual.startRun(key, req as never);
    },
  };
});

const { resetBrainRunStore } = await import("@seanhogg/builderforce-brain-embedded");
const { fakeGateway } = await import("../../harness/fakeGateway");
const { createBrainRunHost } = await import("./brainRunHost");
const { transientRunPersistence } = await import("../native/nativeRunStream");

beforeEach(() => {
  resetBrainRunStore();
  seen.requests.length = 0;
});

describe("the VS Code host labels its runs", () => {
  it("starts every run for the 'vscode' entry point", async () => {
    const gateway = fakeGateway([{ text: "Hi." }]);
    const host = createBrainRunHost({
      tools: async () => [],
      workspaceRoot: () => "/workspace",
      stream: async () => gateway.stream as never,
      persistence: transientRunPersistence(),
      evermind: () => undefined,
      labels: { blockedByPolicy: (r: string) => `blocked: ${r}` },
    } as never);
    await host.start({ chatId: 7100, systemPrompt: "You are the IDE agent.", userTurn: "hello", autoApprove: true, evermind: false });

    expect(seen.requests).toHaveLength(1);
    expect(seen.requests[0]).toMatchObject({ entryPoint: "vscode" });
  });

  it("advertises canonical Platform names while dispatching by the original catalog name", async () => {
    const name = "builtin_projects_list";
    const wireName = "platform__projects_list";
    const gateway = fakeGateway([{ toolCalls: [{ name: wireName, args: { limit: 3 } }] }, { text: "Projects listed." }]);
    const execute = vi.fn(async () => '{"ok":true}');
    const onToolRun = vi.fn();
    const base = { description: "List projects", parameters: { type: "object" }, mutating: false, execute };
    const host = createBrainRunHost({
      tools: async () => [
        { ...base, name, remote: true, wireName },
        { ...base, name: "ticket-create", remote: false, wireName: "platform__tasks_create" },
      ],
      workspaceRoot: () => "/workspace",
      stream: async () => gateway.stream,
      persistence: transientRunPersistence(),
      evermind: () => undefined,
      labels: { blockedByPolicy: (reason) => `blocked: ${reason}` },
      onToolRun,
    });
    await host.start({ chatId: 7101, systemPrompt: "You are the IDE agent.", userTurn: "list projects", autoApprove: true, evermind: false });

    expect(seen.requests[0]?.wireToolNames).toEqual([{ name, wireName }]);
    expect(gateway.requests[0]?.advertised).toEqual(expect.arrayContaining([wireName, "ticket-create"]));
    expect(gateway.requests[0]?.advertised).not.toContain(name);
    expect(gateway.requests[0]?.advertised).not.toContain("platform__tasks_create");
    expect(execute).toHaveBeenCalledOnce();
    expect(onToolRun).toHaveBeenCalledWith(expect.objectContaining({ name, remote: true, ok: true }));
  });
});
