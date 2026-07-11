import { afterEach, describe, expect, it, vi } from "vitest";
import { contributeProjectEvermindFromText, type ProjectEvermindSyncConfig } from "./project-evermind-sync.js";

const CFG: ProjectEvermindSyncConfig = {
  gatewayUrl: "https://api.example.test",
  apiKey: "k",
  agentHostId: 3,
  projectId: 42,
};

/** Mock global fetch with an ok JSON response and return the spy. */
function mockFetch(body: Record<string, unknown> = { ok: true, baseVersion: 5 }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The JSON body sent in the Nth (default first) fetch call. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>, n = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[n]![1] as { body: string }).body);
}

const RUN_TEXT = "Created retry.ts and edited handler.ts; wired exponential backoff into the webhook path.";
const TICKET = "Implement a resilient retry path for the webhook handler with exponential backoff.";

describe("contributeProjectEvermindFromText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("threads the ticket PROMPT into the learn-text body (modality parity)", async () => {
    const fetchMock = mockFetch();
    const res = await contributeProjectEvermindFromText(CFG, RUN_TEXT, TICKET);
    expect(res.ok).toBe(true);
    const body = sentBody(fetchMock);
    expect(body.text).toContain("Created retry.ts");
    expect(body.prompt).toBe(TICKET);
  });

  it("omits prompt when none is provided (refine-mode fallback)", async () => {
    const fetchMock = mockFetch();
    await contributeProjectEvermindFromText(CFG, RUN_TEXT);
    expect(sentBody(fetchMock)).not.toHaveProperty("prompt");
  });

  it("weights by run QUALITY, not text length — neutral default, caller override forwarded", async () => {
    const fetchMock = mockFetch();
    await contributeProjectEvermindFromText(CFG, RUN_TEXT);
    // Neutral default (0.6), NOT the old text.length proxy.
    expect(sentBody(fetchMock).weight).toBe(0.6);
    expect(sentBody(fetchMock).weight).not.toBe(RUN_TEXT.length);

    const fm2 = mockFetch();
    await contributeProjectEvermindFromText(CFG, RUN_TEXT, undefined, 0.7);
    expect(sentBody(fm2).weight).toBe(0.7);
  });

  it("omits a blank/whitespace prompt", async () => {
    const fetchMock = mockFetch();
    await contributeProjectEvermindFromText(CFG, RUN_TEXT, "   ");
    expect(sentBody(fetchMock)).not.toHaveProperty("prompt");
  });

  it("skips the POST entirely for too-short text", async () => {
    const fetchMock = mockFetch();
    const res = await contributeProjectEvermindFromText(CFG, "hi", TICKET);
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when fetch fails (best-effort)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unreachable")));
    const res = await contributeProjectEvermindFromText(CFG, RUN_TEXT, TICKET);
    expect(res.ok).toBe(false);
  });
});
