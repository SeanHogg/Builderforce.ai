import { afterEach, describe, expect, it, vi } from "vitest";

const workerState = vi.hoisted(() => {
  class FakeWorker {
    handlers = new Map<string, Array<(value: unknown) => void>>();
    posted: unknown[] = [];

    on(event: string, handler: (value: unknown) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
      return this;
    }

    emit(event: string, value: unknown) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(value);
      }
    }

    postMessage(message: { id: string }) {
      this.posted.push(message);
      if (workerState.autoRespond) {
        queueMicrotask(() => {
          this.emit("message", {
            type: "result",
            id: message.id,
            finalText: "worker result",
          });
        });
      }
    }

    terminate = vi.fn(async () => 0);
  }

  const workers: FakeWorker[] = [];
  return { FakeWorker, workers, autoRespond: true };
});

vi.mock("node:worker_threads", () => ({
  Worker: class extends workerState.FakeWorker {
    constructor(..._args: unknown[]) {
      super();
      workerState.workers.push(this);
    }
  },
}));

import { createBuilderForceAgentsLlmLocalStreamFn } from "./builderforcellm-local-stream.js";

describe("createBuilderForceAgentsLlmLocalStreamFn worker bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    workerState.autoRespond = true;
  });

  it("delegates inference to the local brain worker", async () => {
    workerState.autoRespond = true;
    const streamFn = createBuilderForceAgentsLlmLocalStreamFn({
      workspaceDir: "C:\\workspace",
    });

    const stream = await streamFn(
      {
        id: "brain-model",
        api: "transformers",
        provider: "builderforcellm-local",
      } as never,
      {
        systemPrompt: "system",
        messages: [{ role: "user", content: "hello worker" }],
      } as never,
      {} as never,
    );

    const events: Array<{ type?: string; message?: { content?: unknown } }> = [];
    for await (const event of stream) {
      events.push(event as { type?: string; message?: { content?: unknown } });
    }

    expect(workerState.workers).toHaveLength(1);
    expect(workerState.workers[0]?.posted[0]).toMatchObject({
      type: "run",
      request: expect.objectContaining({
        workspaceDir: "C:\\workspace",
        rawMessages: [{ role: "user", content: "hello worker" }],
      }),
    });

    expect(events.at(-1)).toMatchObject({
      type: "done",
      message: {
        content: [{ type: "text", text: "worker result" }],
      },
    });
  });

  it("falls back to cortex when amygdala routing times out", async () => {
    workerState.autoRespond = false;
    vi.stubEnv("BUILDERFORCE_AGENTS_AMYGDALA_ROUTING_TIMEOUT_MS", "10");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "cortex fallback" } }] }),
      })),
    );

    const streamFn = createBuilderForceAgentsLlmLocalStreamFn({
      workspaceDir: "C:\\workspace",
      config: {
        agents: {
          defaults: {
            model: {
              primary: "openai/gpt-4o",
              fallbacks: [],
            },
          },
        },
        models: {
          providers: {
            openai: {
              api: "openai-completions",
              apiKey: "sk-test",
              baseUrl: "https://api.openai.com/v1",
              models: [{ id: "gpt-4o" }],
            },
          },
        },
      } as never,
    });

    const stream = await streamFn(
      {
        id: "brain-model",
        api: "transformers",
        provider: "builderforcellm-local",
      } as never,
      {
        systemPrompt: "system",
        messages: [{ role: "user", content: "hello worker" }],
      } as never,
      {} as never,
    );

    const events: Array<{ type?: string; message?: { content?: unknown } }> = [];
    for await (const event of stream) {
      events.push(event as { type?: string; message?: { content?: unknown } });
    }

    expect(workerState.workers[0]?.terminate).toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "done",
      message: {
        content: [{ type: "text", text: "cortex fallback" }],
      },
    });
  });
});
