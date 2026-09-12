import { describe, expect, it } from "vitest";
import {
  answerTextOf,
  canonicalReasoningText,
  splitReasoningSegments,
  splitVendorReasoning,
  stripReasoningScratchpad,
  stripReasoningTagsFromText,
  thoughtTextOf,
} from "./reasoning";

/**
 * The three surfaces whose own copies this module replaced, each still holding the
 * contract it held before — plus the two questions they used to disagree on (an
 * unclosed block; a tag inside a code fence), which now have ONE answer.
 *
 * `reasoningTags.test.ts` carries the fourth: the on-prem runner's plain-text stripper.
 */

describe("splitReasoningSegments — the shared transcript's split", () => {
  it("separates model reasoning from the answer without exposing control tags", () => {
    expect(splitReasoningSegments("<think>Inspect the model.</think>\nThe answer.")).toEqual([
      { kind: "thought", content: "Inspect the model." },
      { kind: "answer", content: "The answer." },
    ]);
  });

  it("keeps an unclosed streaming block as visible thought content", () => {
    expect(splitReasoningSegments("<THINK>Still reasoning…")).toEqual([
      { kind: "thought", content: "Still reasoning…" },
    ]);
  });

  it("leaves a short but COMPLETE answer alone, however long the reasoning", () => {
    // "Done." is a reply. Promoting the reasoning over it would dump the model's
    // scratchpad on the user for every terse confirmation.
    const long = "x".repeat(400);
    expect(splitReasoningSegments(`<think>${long}</think>\nDone.`)).toEqual([
      { kind: "thought", content: long },
      { kind: "answer", content: "Done." },
    ]);
  });

  it("rescues an answer the model sealed inside the think block", () => {
    // Verbatim shape from a real run: the reply was inside <think> and the only text
    // after the closing tag was the tail of its own sentence, so the user saw
    // "/task number?" as the entire response.
    const reply = '"Fix" is too vague - I need to know what to fix. Could you specify a file, or a ticket';
    const out = splitReasoningSegments(`<think>${reply}</think>\n\n/task number?`);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("answer");
    expect(out[0]!.content).toBe(`${reply} /task number?`);
  });

  it("does not promote reasoning that is still streaming with no answer yet", () => {
    // No answer segment at all is a block mid-stream, not a swallowed reply.
    expect(splitReasoningSegments("<think>Still reasoning about the layout")).toEqual([
      { kind: "thought", content: "Still reasoning about the layout" },
    ]);
  });

  it("keeps a fragment as-is when there is no richer thought to promote", () => {
    expect(splitReasoningSegments("<think>ok</think>\n/task number?")).toEqual([
      { kind: "thought", content: "ok" },
      { kind: "answer", content: "/task number?" },
    ]);
  });

  it("treats a markdown-led short answer as a real reply", () => {
    const long = "y".repeat(200);
    const out = splitReasoningSegments(`<think>${long}</think>\n- Yes`);
    expect(out.map((s) => s.kind)).toEqual(["thought", "answer"]);
    expect(out[1]!.content).toBe("- Yes");
  });

  it("leaves ordinary Markdown unchanged, whitespace included", () => {
    expect(splitReasoningSegments("  **Normal answer**\n")).toEqual([
      { kind: "answer", content: "  **Normal answer**\n" },
    ]);
  });

  it("reads the WHOLE tag vocabulary, not just <think>", () => {
    for (const tag of ["think", "thinking", "thought", "antthinking", "scratchpad", "reasoning"]) {
      expect(splitReasoningSegments(`<${tag}>hmm</${tag}>Answer.`)).toEqual([
        { kind: "thought", content: "hmm" },
        { kind: "answer", content: "Answer." },
      ]);
    }
  });

  it("leaves a tag inside a code fence alone — a chat ABOUT reasoning tags keeps its example", () => {
    const text = "Strip it like this:\n\n```\n<think>hidden</think>\n```\n\nThat is all.";
    expect(splitReasoningSegments(text)).toEqual([{ kind: "answer", content: text }]);
  });

  it("leaves a tag in inline code alone", () => {
    const text = "The `<think>` tag wraps reasoning.";
    expect(splitReasoningSegments(text)).toEqual([{ kind: "answer", content: text }]);
  });

  it("re-joins a sentence the closing tag cut in two", () => {
    // Verbatim shape (MiniMax-M1, chat #103): the chat's first visible line was
    // "tickets linked to this chat…" with its subject hidden in the reasoning.
    const out = splitReasoningSegments(
      "<think>The user wants a ticket review.\nI'll start by listing the</think>tickets linked to this chat to see what open tickets we're working with.",
    );
    expect(out).toEqual([
      { kind: "thought", content: "The user wants a ticket review." },
      { kind: "answer", content: "I'll start by listing the tickets linked to this chat to see what open tickets we're working with." },
    ]);
  });

  it("does not stitch a finished thought, or an answer that opens like a reply", () => {
    expect(splitReasoningSegments("<think>Plan the steps.</think>then run them all in order today.")).toEqual([
      { kind: "thought", content: "Plan the steps." },
      { kind: "answer", content: "then run them all in order today." },
    ]);
    expect(splitReasoningSegments("<think>Checking the branches for the</think>Here is the full list of branches.")).toEqual([
      { kind: "thought", content: "Checking the branches for the" },
      { kind: "answer", content: "Here is the full list of branches." },
    ]);
  });

  it("drops an empty vendor tool-call wrapper from the reasoning", () => {
    expect(splitReasoningSegments("<think>Check more tickets.\n<minimax:tool_call>\n\n</minimax:tool_call></think>Done.")).toEqual([
      { kind: "thought", content: "Check more tickets." },
      { kind: "answer", content: "Done." },
    ]);
  });
});

describe("answerTextOf / thoughtTextOf", () => {
  it("returns the reply with the reasoning removed", () => {
    expect(answerTextOf("<think>Inspect the model.</think>\nThe answer.")).toBe("The answer.");
  });

  it("is empty for a reasoning-only turn, closed or still streaming", () => {
    expect(answerTextOf("<think>Only reasoning.</think>")).toBe("");
    expect(answerTextOf("<think>Still reasoning…")).toBe("");
  });

  it("keeps a plain reply untouched", () => {
    expect(answerTextOf("Done.")).toBe("Done.");
  });

  it("joins the answer around an interleaved thought", () => {
    expect(answerTextOf("First.<think>hmm</think>Second.")).toBe("First.\n\nSecond.");
  });

  it("returns the reasoning without its tags — the text a stranded reply is rescued with", () => {
    expect(thoughtTextOf("<think>Should I close them?</think>")).toBe("Should I close them?");
  });

  it("reads an UNCLOSED block, which is how a swallowed reply usually arrives", () => {
    expect(thoughtTextOf("<think>Both are archived. Close or roadmap?")).toBe("Both are archived. Close or roadmap?");
  });

  it("joins several blocks and returns nothing when the turn carried no reasoning", () => {
    expect(thoughtTextOf("<think>one</think>mid<think>two</think>")).toBe("one\n\ntwo");
    expect(thoughtTextOf("plain answer")).toBe("");
  });
});

describe("stripReasoningScratchpad — the LEARNING policy", () => {
  it("keeps the answer and drops the working-out around it", () => {
    const turn = "<think>The user is right - I should have deleted the branch.</think>\n\n"
      + "Both API and Frontend are already on `main` — the fixes are merged and pushed.";
    expect(stripReasoningScratchpad(turn))
      .toBe("Both API and Frontend are already on `main` — the fixes are merged and pushed.");
  });

  it("removes a block whose closing tag was cut off by the transport cap", () => {
    // The observed shape: contributions are sliced at 8k, so a long think block arrives
    // with no `</think>` and used to be learned verbatim as prose.
    const turn = "Here is what I found.\n\n<think>Let me check the git log first, then the";
    expect(stripReasoningScratchpad(turn)).toBe("Here is what I found.");
  });

  it("reports a turn that was nothing but scratchpad as having no answer", () => {
    const turn = "<think>The commits show 7778e5cd9 Fixes. Let me verify what is on the branch.</think>";
    expect(stripReasoningScratchpad(turn)).toBe("");
  });

  it("handles several blocks and the alternate tag spellings", () => {
    const turn = "<thinking>first</thinking>Step one is done. <think>second</think>Step two is next.";
    expect(stripReasoningScratchpad(turn)).toBe("Step one is done. Step two is next.");
  });

  it("leaves a normal answer untouched", () => {
    const turn = "The deployment finished and every health check passed on the first attempt.";
    expect(stripReasoningScratchpad(turn)).toBe(turn);
  });

  it("does not eat ordinary prose that merely mentions thinking", () => {
    const turn = "I think the retry budget is too low, so the worker gives up before the queue drains.";
    expect(stripReasoningScratchpad(turn)).toBe(turn);
  });

  it("NEVER promotes a swallowed reply — an exemplar is the answer or nothing", () => {
    // The one case where learning and display must diverge: the transcript shows this
    // reasoning to the reader rather than a scrap; teaching it to an SSM is how a
    // merged model came to imitate half-finished deliberation.
    const reply = '"Fix" is too vague - I need to know what to fix. Could you specify a file, or a ticket';
    expect(stripReasoningScratchpad(`<think>${reply}</think>\n\n/task number?`)).toBe("/task number?");
    expect(answerTextOf(`<think>${reply}</think>\n\n/task number?`)).toContain(reply);
  });
});

describe("splitVendorReasoning — one reader for every vendor shape", () => {
  it("reads reasoning_content (DeepSeek / OpenAI-compatible / normalised Anthropic thinking)", () => {
    expect(splitVendorReasoning({ content: "answer", reasoning_content: "I should check the tests first." })).toEqual({
      content: "answer",
      reasoning: "I should check the tests first.",
    });
  });

  it("reads OpenRouter flat `reasoning` and structured `reasoning_details`", () => {
    expect(splitVendorReasoning({ content: "a", reasoning: "flat" }).reasoning).toBe("flat");
    expect(
      splitVendorReasoning({
        content: "a",
        reasoning_details: [
          { type: "reasoning.text", text: "step one" },
          { type: "reasoning.encrypted", data: "xxx" },
          { type: "reasoning.text", text: "step two" },
        ],
      }).reasoning,
    ).toBe("step one\nstep two");
  });

  it("lifts inline segments out of the visible content", () => {
    const out = splitVendorReasoning({ content: "<think>plan: read file</think>\n\nHere is the fix." });
    expect(out).toEqual({ content: "Here is the fix.", reasoning: "plan: read file" });
  });

  it("lifts an UNCLOSED block too — the case the per-vendor regex could not see", () => {
    // A closing-tag-only matcher left this whole scratchpad in `content`, which is how
    // a model's reasoning reached the transcript as the answer.
    const out = splitVendorReasoning({ content: "<think>Let me check the roadmap first, then" });
    expect(out.content).toBe("");
    expect(out.reasoning).toBe("Let me check the roadmap first, then");
  });

  it("is empty for a turn with no reasoning and tolerates a null message", () => {
    expect(splitVendorReasoning({ content: "plain" })).toEqual({ content: "plain", reasoning: "" });
    expect(splitVendorReasoning(null)).toEqual({ content: "", reasoning: "" });
    expect(splitVendorReasoning({ content: null })).toEqual({ content: "", reasoning: "" });
  });
});

describe("canonicalReasoningText — what a loop PERSISTS", () => {
  it("emits one CLOSED block ahead of the answer, so nothing downstream needs the model to close its own tag", () => {
    expect(canonicalReasoningText("Here is the fix.", "plan: read file"))
      .toBe("<think>plan: read file</think>\n\nHere is the fix.");
  });

  it("is idempotent — normalizing canonical text again changes nothing", () => {
    const once = canonicalReasoningText("Answer.", "reasoned");
    const split = splitVendorReasoning({ content: once });
    expect(canonicalReasoningText(split.content, split.reasoning)).toBe(once);
  });

  it("closes an unclosed block instead of leaving it to corrupt every later reader", () => {
    const raw = "<think>Both are archived. Close them or roadmap them?";
    const split = splitVendorReasoning({ content: raw });
    const canonical = canonicalReasoningText(split.content, split.reasoning);
    expect(canonical).toBe("<think>Both are archived. Close them or roadmap them?</think>");
    // …and now the learning stripper can see it, which on the raw text it also could,
    // but the api's per-vendor splitter could not.
    expect(stripReasoningScratchpad(canonical)).toBe("");
    expect(stripReasoningTagsFromText(canonical)).toBe("");
  });

  it("carries the answer alone when the turn had no reasoning", () => {
    expect(canonicalReasoningText("Just the answer.", "")).toBe("Just the answer.");
  });
});
