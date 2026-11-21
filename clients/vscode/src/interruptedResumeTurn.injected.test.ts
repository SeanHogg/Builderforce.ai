import { describe, expect, it } from "vitest";
import { declinesShipping, injectedTurnIdsOf, isInjectedTurnMetadata, withInjectedMeta } from "@seanhogg/builderforce-brain-embedded";
import { interruptedResumeTurn, type ResumeLabel } from "./interruptedResumeTurn";

// VS Code chat #157440: the Resume continuation quoted a sub-agent's brief verbatim ("… Do not commit.") and, read as the
// person's words, set the chat's publish hold. The webview sends it marked injected (`useChatSend.continueChat`), the
// run never marks such a row a person turn, and quoted lines (`>`) are never read as an instruction.

const t: ResumeLabel = (_key, fallback) => fallback;

describe("regression: chat #157440 — the resume continuation is an injected turn", () => {
  const turn = interruptedResumeTurn(t, {
    ask: "Do not commit.",
    children: [{ handle: "@dev-1", label: "Developer", owner: "you", state: "running", brief: "Implement the page.\nDo not commit." }],
  } as Parameters<typeof interruptedResumeTurn>[1]);

  it("regression: its saved row is marked injected and listed as such for the run", () => {
    const metadata = JSON.stringify(withInjectedMeta());
    expect(isInjectedTurnMetadata(metadata)).toBe(true);
    expect(injectedTurnIdsOf([{ id: 2156, role: "user", metadata }, { id: 2157, role: "user", metadata: null }])).toEqual([2156]);
  });

  it("regression: the quoted original ask is never read as a decline", () => {
    const askOnly = turn.split("\n\n").filter((section) => section.startsWith("The original request")).join("\n\n");
    expect(askOnly).toContain("> Do not commit.");
    expect(declinesShipping(askOnly)).toBe(false);
  });
});
