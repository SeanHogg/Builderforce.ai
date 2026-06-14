import type { StreamFn } from "../../builderforce/agent-loop/index.js";
import type { Api, Context, Model, SimpleStreamOptions } from "../../builderforce/model/types.js";
import { describe, expect, it } from "vitest";
import { addAnthropicSystemCacheControl, applyExtraParamsToAgent } from "./extra-params.js";

const EPHEMERAL = { type: "ephemeral" };

// ---------------------------------------------------------------------------
// addAnthropicSystemCacheControl — the pure payload transform. pi-ai caches only
// the last user/assistant message for openrouter/anthropic; this adds the
// system-prompt breakpoint it omits.
// ---------------------------------------------------------------------------

describe("addAnthropicSystemCacheControl", () => {
  it("promotes a string system prompt to a cache-marked text block", () => {
    const payload = {
      messages: [
        { role: "system", content: "You are an agent." },
        { role: "user", content: "hi" },
      ],
    };
    addAnthropicSystemCacheControl(payload);
    expect(payload.messages[0]).toEqual({
      role: "system",
      content: [{ type: "text", text: "You are an agent.", cache_control: EPHEMERAL }],
    });
    // Volatile user turn untouched (pi-ai marks that one itself).
    expect(payload.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("marks the last text part of an array-content system prompt", () => {
    const payload = {
      messages: [
        { role: "system", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
      ],
    };
    addAnthropicSystemCacheControl(payload);
    expect(payload.messages[0].content).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "b", cache_control: EPHEMERAL },
    ]);
  });

  it("is idempotent — leaves an already-marked system block untouched", () => {
    const marked = { type: "text", text: "a", cache_control: EPHEMERAL };
    const payload = { messages: [{ role: "system", content: [marked] }] };
    addAnthropicSystemCacheControl(payload);
    expect(payload.messages[0].content).toEqual([marked]); // no duplicate breakpoint
  });

  it("no-ops on missing system, malformed payloads, or an empty system string", () => {
    const noSystem = { messages: [{ role: "user", content: "hi" }] };
    addAnthropicSystemCacheControl(noSystem);
    expect(noSystem.messages[0]).toEqual({ role: "user", content: "hi" });

    const emptySystem = { messages: [{ role: "system", content: "" }] };
    addAnthropicSystemCacheControl(emptySystem);
    expect(emptySystem.messages[0].content).toBe("");

    expect(() => addAnthropicSystemCacheControl(undefined)).not.toThrow();
    expect(() => addAnthropicSystemCacheControl({ messages: "nope" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// applyExtraParamsToAgent — the wrapper is installed only for openrouter +
// anthropic/* and mutates the exact body sent upstream via the onPayload seam.
// ---------------------------------------------------------------------------

describe("applyExtraParamsToAgent — openrouter/anthropic system caching", () => {
  const drive = (provider: string, modelId: string): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    };
    // pi-ai invokes onPayload with the outgoing body just before sending; our
    // wrapper hooks that seam, so a base streamFn that fires onPayload exercises it.
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      options?.onPayload?.(payload);
      return {} as ReturnType<StreamFn>;
    };
    const agent = { streamFn: baseStreamFn };
    applyExtraParamsToAgent(agent, undefined, provider, modelId);

    const model = {
      api: "openai-completions",
      provider,
      id: modelId,
      baseUrl: "https://openrouter.ai/api/v1",
    } as unknown as Model<Api>;
    void agent.streamFn?.(model, { messages: [] } as unknown as Context, {} as SimpleStreamOptions);
    return payload;
  };

  it("caches the system prompt for openrouter/anthropic models", () => {
    const payload = drive("openrouter", "anthropic/claude-sonnet-4.6");
    expect((payload.messages as Array<{ content: unknown }>)[0]!.content).toEqual([
      { type: "text", text: "sys", cache_control: EPHEMERAL },
    ]);
  });

  it("leaves the system prompt untouched for non-Anthropic openrouter models", () => {
    const payload = drive("openrouter", "openai/gpt-4.1");
    expect((payload.messages as Array<{ content: unknown }>)[0]!.content).toBe("sys");
  });
});
