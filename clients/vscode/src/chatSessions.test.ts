import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Guards the recorded decision in `chatSessions.ts`: the proposed-API chat tab and the
 * stable `BrainWebview` session tabs stay as they are because they are NOT two
 * implementations of one thing — this file is a registration adapter over the SAME
 * handler the `@builderforce` participant uses.
 *
 * That claim is only true while the adapter stays thin. The moment turn handling, tool
 * wiring, model resolution or persistence is written HERE instead of in the shared
 * handler, a second implementation exists and the decision stops holding. This test is
 * what makes "thin by rule" a rule rather than a comment.
 */
const SOURCE = fs.readFileSync(path.join(__dirname, "chatSessions.ts"), "utf8");

describe("chatSessions stays a thin registration adapter", () => {
  it("serves every turn through the SHARED participant handler", () => {
    expect(SOURCE).toContain('import { createBuilderForceHandler } from "./chatParticipant"');
    expect(SOURCE).toContain("createBuilderForceHandler(ctx)");
  });

  it("implements no chat logic of its own", () => {
    // A second implementation would have to reach for at least one of these. None of
    // them belongs here — they all live behind `createBuilderForceHandler`.
    const forbidden = [
      "resolveEffectiveModelChoice", // model resolution
      "runLoop", // the agent loop
      "ToolRegistry", // tool wiring
      "buildLocalCapabilityProvider", // capability providers
      "ctx.secrets.get", // auth/persistence
    ];
    expect(forbidden.filter((token) => SOURCE.includes(token))).toEqual([]);
  });

  it("self-disables instead of failing when the proposed API is absent", () => {
    // The stable sidebar and `@builderforce` participant must be unaffected on the
    // overwhelming majority of installs, which have no proposed API at all.
    expect(SOURCE).toContain('typeof chatApi.registerChatSessionContentProvider !== "function"');
    expect(SOURCE).toContain("return undefined");
  });

  it("records WHY the two per-tab surfaces do not converge", () => {
    // The decision is the artifact; losing it is how a resolved question re-opens.
    expect(SOURCE).toContain("Decision: the two per-tab surfaces do NOT converge");
  });
});
