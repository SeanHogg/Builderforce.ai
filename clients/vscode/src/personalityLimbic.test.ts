import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const gateway = vi.hoisted(() => ({ key: "bfk_test" as string | undefined }));
vi.mock("./gateway", () => ({
  getApiKey: async () => gateway.key,
  getBaseUrl: () => "https://api.example",
}));

import { clearPersonalityBlockCache, fetchPersonalityBlock, turnLimbicBlock } from "./personalityLimbic";

const secrets = {} as vscode.SecretStorage;
const RISKY = "drop the production table and force-push to main";

/**
 * The per-turn affect is appraised on this machine; only the session's PERSONALITY is
 * fetched (once). Load-bearing: no request per turn, none at all signed out, and the
 * personality's setpoints seed every turn's local appraisal.
 */
describe("personality + per-turn limbic layers", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    gateway.key = "bfk_test";
    clearPersonalityBlockCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ block: "", personaBlock: "Persona: warm and direct.", setpoints: undefined }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the personality ONCE for the session, however many turns follow", async () => {
    const first = await turnLimbicBlock(secrets, RISKY, { userId: "u1" });
    await turnLimbicBlock(secrets, "another turn", { userId: "u1" });
    await fetchPersonalityBlock(secrets, { userId: "u1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The personality fetch sends no turn text — the text never leaves the machine.
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ text: "", userId: "u1" });
    expect(first).toContain("Current affective state");
    expect(first).toContain("Persona: warm and direct.");
  });

  it("signed out: no request at all, and the turn still gets its (neutral-seeded) affect", async () => {
    gateway.key = undefined;

    const block = await turnLimbicBlock(secrets, RISKY);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(block).toContain("Current affective state");
  });

  it("offline: the turn still gets its affect, and the personality is asked again next turn", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    expect(await turnLimbicBlock(secrets, RISKY, { userId: "u1" })).toContain("Current affective state");
    await turnLimbicBlock(secrets, RISKY, { userId: "u1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
