import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLlamaStreamFn, resetLlamaSessionCacheForTest } from "./llama-stream.js";

// Same lazy-import seam memory/embeddings.test.ts mocks — ONE place for node-llama-cpp.
const importNodeLlamaCppMock = vi.fn();
vi.mock("../memory/node-llama.js", () => ({
  importNodeLlamaCpp: (...args: unknown[]) => importNodeLlamaCppMock(...args),
}));

const MODEL = {
  id: "tiny.gguf",
  api: "llama",
  provider: "llama",
  contextWindow: 4096,
} as unknown as Parameters<ReturnType<typeof createLlamaStreamFn>>[0];

function mockLlamaCpp(promptImpl: (prompt: string, opts: Record<string, unknown>) => string) {
  const loadModel = vi.fn(async () => ({
    createContext: async () => ({
      getSequence: () => ({}),
      model: { detokenize: () => "" },
    }),
  }));
  const getLlama = vi.fn(async () => ({ loadModel }));
  const prompt = vi.fn(async (p: string, opts: Record<string, unknown>) => promptImpl(p, opts));
  class LlamaChatSession {
    prompt = prompt;
  }
  const grammarCtor = vi.fn();
  class LlamaJsonSchemaGrammar {
    constructor(...args: unknown[]) {
      grammarCtor(...args);
    }
  }
  importNodeLlamaCppMock.mockResolvedValue({ getLlama, LlamaChatSession, LlamaJsonSchemaGrammar });
  return { getLlama, loadModel, prompt, grammarCtor };
}

async function collect(streamFn: ReturnType<typeof createLlamaStreamFn>, context: unknown) {
  const stream = await streamFn(
    MODEL,
    context as Parameters<typeof streamFn>[1],
    {} as Parameters<typeof streamFn>[2],
  );
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

beforeEach(() => {
  resetLlamaSessionCacheForTest();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("createLlamaStreamFn", () => {
  it("loads the GGUF path in-process and emits the completion as a done event", async () => {
    const { getLlama, loadModel, prompt } = mockLlamaCpp(() => "hello from gguf");
    const streamFn = createLlamaStreamFn("/models/tiny.gguf", { modelPath: "/models/tiny.gguf" });

    const events = await collect(streamFn, {
      systemPrompt: "be brief",
      messages: [{ role: "user", content: "hi" }],
    });

    const done = events.at(-1) as { type: string; reason: string; message: { content: unknown } };
    expect(done.type).toBe("done");
    expect(done.reason).toBe("stop");
    expect(done.message.content).toEqual([{ type: "text", text: "hello from gguf" }]);
    expect(getLlama).toHaveBeenCalledTimes(1);
    expect(loadModel).toHaveBeenCalledWith({ modelPath: "/models/tiny.gguf", gpuLayers: "auto" });
    const [userPrompt, opts] = prompt.mock.calls[0] as [string, Record<string, unknown>];
    expect(userPrompt).toBe("hi");
    expect(opts.systemPrompt).toBe("be brief");
  });

  it("reuses the loaded model across calls for the same path/context", async () => {
    const { loadModel } = mockLlamaCpp(() => "ok");
    const streamFn = createLlamaStreamFn("/models/tiny.gguf");
    await collect(streamFn, { messages: [{ role: "user", content: "a" }] });
    await collect(streamFn, { messages: [{ role: "user", content: "b" }] });
    expect(loadModel).toHaveBeenCalledTimes(1);
  });

  it("constrains generation with a tool grammar and parses tool calls into toolUse", async () => {
    const { grammarCtor } = mockLlamaCpp(() =>
      JSON.stringify({ tool_calls: [{ name: "read", arguments: { path: "a.md" } }], content: "" }),
    );
    const streamFn = createLlamaStreamFn("/models/tiny.gguf");

    const events = await collect(streamFn, {
      messages: [{ role: "user", content: "read a.md" }],
      tools: [{ name: "read", description: "read a file", parameters: { type: "object" } }],
    });

    const done = events.at(-1) as {
      type: string;
      reason: string;
      message: { content: Array<{ type: string; name?: string; arguments?: unknown }> };
    };
    expect(done.reason).toBe("toolUse");
    expect(done.message.content[0]?.type).toBe("toolCall");
    expect(done.message.content[0]?.name).toBe("read");
    expect(done.message.content[0]?.arguments).toEqual({ path: "a.md" });
    // Grammar is built from the RESOLVED Llama instance, never the getLlama() promise.
    expect(grammarCtor).toHaveBeenCalledTimes(1);
    expect(grammarCtor.mock.calls[0]?.[0]).not.toBeInstanceOf(Promise);
  });

  it("emits an error event (not a throw) when node-llama-cpp is missing", async () => {
    importNodeLlamaCppMock.mockRejectedValue(
      Object.assign(new Error("Cannot find package 'node-llama-cpp'"), {
        code: "ERR_MODULE_NOT_FOUND",
      }),
    );
    const streamFn = createLlamaStreamFn("/models/tiny.gguf");

    const events = await collect(streamFn, { messages: [{ role: "user", content: "hi" }] });

    const last = events.at(-1) as { type: string; error?: { errorMessage?: string } };
    expect(last.type).toBe("error");
    expect(last.error?.errorMessage).toMatch(/node-llama-cpp is not installed/);
  });
});
