/**
 * The native participant gets the panel's two deterministic pre-turn parts (WS-L), through
 * the SAME request fields the panel's run host fills (`runSetup.ts`): the pre-search hits
 * as the run's volatile turn context, and the model-free "where is X defined?" answer.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetBrainRunStore } from "@seanhogg/builderforce-brain-embedded";
import { fakeGateway } from "../harness/fakeGateway";
import { answerFunctionPort } from "@builderforce/prefetch/testing";
import { runNativeBrain, transientRunPersistence, type NativeBrainRunOptions } from "./nativeBrainRun";

const LABELS = { dispatchHint: "[dispatch hint]", blockedByPolicy: (reason: string) => reason };

let nextChatId = 5000;

async function turn(extra: Partial<NativeBrainRunOptions>, prompt: string) {
  const gateway = fakeGateway([{ text: "From the model." }]);
  const sent: unknown[] = [];
  let text = "";
  await runNativeBrain({
    chatId: ++nextChatId,
    systemPrompt: "You are the BuilderForce IDE agent.",
    seed: [],
    userTurn: prompt,
    tools: [],
    root: "/workspace",
    permissionMode: "ask",
    approve: async () => true,
    stream: (opts, handlers) => {
      sent.push(opts.messages);
      return gateway.stream(opts, handlers);
    },
    persistence: transientRunPersistence(),
    signal: new AbortController().signal,
    labels: LABELS,
    events: { onText: (d) => { text += d; }, onToolStart: () => undefined, onToolResult: () => undefined, onError: () => undefined },
    ...extra,
  });
  return { text, requests: gateway.requests, sent };
}

beforeEach(() => {
  resetBrainRunStore();
});

describe("native participant parity with the panel's run host", () => {
  it("adopts the symbol-index answer with no model call", async () => {
    const asked: string[] = [];
    const { text, requests } = await turn({
      prefetch: answerFunctionPort(async (q) => {
        asked.push(q);
        return "`Widget` is defined in src/widget.ts:12";
      }),
    }, "where is Widget defined?");
    expect(asked).toEqual(["where is Widget defined?"]);
    expect(requests).toHaveLength(0);
    expect(text).toContain("src/widget.ts:12");
  });

  it("asks the model when the index cannot answer", async () => {
    const { text, requests } = await turn({ prefetch: answerFunctionPort(async () => undefined) }, "where is Widget defined?");
    expect(requests).toHaveLength(1);
    expect(text).toContain("From the model.");
  });

  it("hands the model the pre-search hits as the turn's context", async () => {
    const { sent } = await turn({ turnContext: async () => "PRE-SEARCH HITS: Widget → src/widget.ts:12" }, "fix Widget");
    expect(JSON.stringify(sent[0])).toContain("PRE-SEARCH HITS");
  });
});
