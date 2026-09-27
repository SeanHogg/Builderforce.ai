import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeltaLearnPayload,
  decodeDeltaPayload,
  parseDeltaLearnPayload,
  MAX_DELTA_B64_CHARS,
} from "@seanhogg/builderforce-memory-engine";
import {
  buildDeltaPayload,
  contributeProjectEvermindFromDelta,
  type DeltaEngine,
  type EvermindBase,
} from "./project-evermind-delta.js";
import type { ProjectEvermindSyncConfig } from "./project-evermind-sync.js";

/**
 * The pre-diffed delta door had a route, a dispatcher and an engine-side differ, and
 * no producer — so `kind: 'delta'` contributions never happened and the coordinator's
 * stale-`baseVersion` guard had never once been exercised by real caller code.
 *
 * These tests drive the producer over SYNTHETIC checkpoints (the same
 * CRC-trailed-f32-buffer shape `exportWeights()` emits, which is exactly what the
 * engine's `diffCheckpoints` consumes), so the whole diff → payload → POST contract is
 * pinned without a GPU, a model, or a live gateway. The recovery half is the point:
 * a base that goes stale mid-push must rebase and re-push, and a producer that loses
 * that race twice must fall back to the text door rather than dropping the run.
 */

const CFG: ProjectEvermindSyncConfig = {
  gatewayUrl: "https://api.example.test",
  apiKey: "k",
  agentHostId: 3,
  projectId: 42,
};

const RUN_TEXT = "Created retry.ts and edited handler.ts; wired exponential backoff into the webhook path so the queue drains.";
const TICKET = "Implement a resilient retry path for the webhook handler with exponential backoff.";

// ── A synthetic engine ────────────────────────────────────────────────────────
// The model side is synthetic (plain Float32 buffers, no GPU): `adaptAndDiff` perturbs
// the rows a real WSLA update would and emits (index, value) pairs. The WIRE side is the
// REAL engine — `buildDeltaLearnPayload` and the size cap — so the payload under test is
// exactly what the coordinator's `parseDeltaLearnPayload` receives.

/** A checkpoint: `[marker, ...weights]`, mirroring "same-config buffers only". */
function checkpoint(values: number[]): ArrayBuffer {
  return Float32Array.from(values).buffer;
}

function fakeEngine(opts: { modelType?: string; touchedRows?: number } = {}): DeltaEngine {
  const modelType = opts.modelType ?? "evermind-lm";
  const touched = opts.touchedRows ?? 2;
  return {
    EvermindModelPackage: {
      fromBlob(blob: ArrayBuffer) {
        return { checkpoint: blob, manifest: { modelType } } as { checkpoint: ArrayBuffer; manifest: { modelType: string } };
      },
    },
    BPETokenizer: class {
      loadFromObjects(): void {}
      encode(text: string): number[] {
        return [...text].map((c) => c.charCodeAt(0) % 97);
      }
    },
    adaptAndDiff(pkg, tok, text) {
      const ids = tok.encode(text);
      if (ids.length < 2) return null;
      const base = new Float32Array((pkg as unknown as { checkpoint: ArrayBuffer }).checkpoint);
      const n = Math.min(touched, base.length);
      const out = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { out[i * 2] = i; out[i * 2 + 1] = (base[i] ?? 0) + 1; }
      return { diff: out.buffer };
    },
    buildDeltaLearnPayload,
    MAX_DELTA_B64_CHARS,
  };
}

const BASE: EvermindBase = {
  version: 7,
  model: checkpoint([0, 0, 0, 0, 0, 0, 0, 0]),
  tokenizer: { vocab: { a: 1 }, merges: [] },
};

// ── Gateway fetch double ──────────────────────────────────────────────────────

interface Route { model?: number; learn?: (body: Record<string, unknown>) => { status: number; body: Record<string, unknown> } }

/**
 * Stub the four calls the producer makes: head, model, tokenizer, learn. `headVersion`
 * is what `/head` reports; `learn` decides how the coordinator answers each push.
 */
function mockGateway(opts: { headVersion?: number; mode?: string; learn?: Route["learn"]; artifactsFail?: boolean } = {}) {
  const headVersion = opts.headVersion ?? 7;
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const learn = opts.learn ?? (() => ({ status: 200, body: { ok: true, queued: 1, contributionId: 11 } }));

  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ url, ...(body ? { body } : {}) });
    if (url.includes("/evermind/head")) {
      return { ok: true, status: 200, json: async () => ({ version: headVersion, mode: opts.mode ?? "connected" }) };
    }
    if (url.includes("/evermind/model")) {
      if (opts.artifactsFail) return { ok: false, status: 404, json: async () => ({}) };
      // The pinned version is echoed into the bytes so a test can prove WHICH base was
      // adapted — element 0 is the version marker.
      const v = Number(new URL(url).searchParams.get("version"));
      return { ok: true, status: 200, arrayBuffer: async () => checkpoint([v, 0, 0, 0, 0, 0, 0, 0]) };
    }
    if (url.includes("/evermind/tokenizer")) {
      if (opts.artifactsFail) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ vocab: { a: 1 }, merges: [] }) };
    }
    if (url.includes("/evermind/learn-text")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, baseVersion: headVersion }) };
    }
    if (url.includes("/evermind/learn")) {
      const out = learn(body ?? {});
      return { ok: out.status >= 200 && out.status < 300, status: out.status, json: async () => out.body };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const learnCalls = (calls: Array<{ url: string; body?: Record<string, unknown> }>) =>
  calls.filter((c) => c.url.includes("/evermind/learn") && !c.url.includes("learn-text"));

const engineDeps = (engine: DeltaEngine) => ({ loadEngine: async () => engine });

/** The gateway's own acceptance rule — the engine parser the route and coordinator run. */
const routeAccepts = (body: Record<string, unknown>): boolean => parseDeltaLearnPayload(body).ok;

describe("delta producer (synthetic checkpoints)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adapts the pinned base and encodes the diff for the wire", () => {
    const payload = buildDeltaPayload(fakeEngine(), BASE, RUN_TEXT, 0.7, TICKET)!;
    // Two touched rows → two (index, value) pairs, round-tripping through base64.
    expect(new Float32Array(decodeDeltaPayload(payload))).toHaveLength(4);
  });

  it("produces a payload the route's own parser accepts", () => {
    const payload = buildDeltaPayload(fakeEngine(), BASE, RUN_TEXT, 0.7, TICKET);
    expect(payload).not.toBeNull();
    expect(routeAccepts(payload as unknown as Record<string, unknown>)).toBe(true);
    expect(payload!.baseVersion).toBe(7);
    expect(payload!.weight).toBe(0.7);
    expect(payload!.label).toBe(TICKET);
  });

  it("returns nothing to push when the head is not an evermind-lm", () => {
    expect(buildDeltaPayload(fakeEngine({ modelType: "evermind-video" }), BASE, RUN_TEXT, 0.7)).toBeNull();
  });

  it("posts the delta to the agent learn door with host-key auth", async () => {
    const { calls, fetchMock } = mockGateway();
    const res = await contributeProjectEvermindFromDelta(CFG, RUN_TEXT, TICKET, 0.7, engineDeps(fakeEngine()));

    expect(res.ok).toBe(true);
    expect(res.delta).toBe(true);
    const push = learnCalls(calls)[0]!;
    expect(push.url).toBe("https://api.example.test/api/agent/projects/42/evermind/learn");
    expect(routeAccepts(push.body!)).toBe(true);
    expect(push.body!.baseVersion).toBe(7);
    expect(push.body!.weight).toBe(0.7);
    const headers = (fetchMock.mock.calls.at(-1)![1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe("Bearer k");
    expect(headers["X-AgentHost-Id"]).toBe("3");
  });

  it("pins the base artifact to the version it claims as baseVersion", async () => {
    const { calls } = mockGateway({ headVersion: 9 });
    await contributeProjectEvermindFromDelta(CFG, RUN_TEXT, TICKET, 0.7, engineDeps(fakeEngine()));
    expect(calls.some((c) => c.url.includes("/evermind/model?version=9"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/evermind/tokenizer?version=9"))).toBe(true);
    expect(learnCalls(calls)[0]!.body!.baseVersion).toBe(9);
  });
});

describe("stale-baseVersion recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rebases against the head the coordinator names and re-pushes ONCE", async () => {
    let seen = 0;
    const { calls } = mockGateway({
      headVersion: 7,
      learn: (body) => {
        seen++;
        // First push is against the base we pulled; a merge landed in between.
        if (body["baseVersion"] === 7) return { status: 409, body: { error: "stale base — rebase against current head", headVersion: 8 } };
        return { status: 200, body: { ok: true, queued: 1 } };
      },
    });

    const res = await contributeProjectEvermindFromDelta(CFG, RUN_TEXT, TICKET, 0.7, engineDeps(fakeEngine()));

    expect(seen).toBe(2);
    expect(res.ok).toBe(true);
    expect(res.rebased).toBe(true);
    expect(res.fellBackToText).toBeUndefined();
    // The rebase re-fetched the NEW base rather than re-labelling the old diff — the
    // whole point of the guard is that a diff against v7 is not valid against v8.
    expect(calls.some((c) => c.url.includes("/evermind/model?version=8"))).toBe(true);
    const pushes = learnCalls(calls);
    expect(pushes.map((p) => p.body!.baseVersion)).toEqual([7, 8]);
  });

  it("falls back to the text door when the rebase loses the race too", async () => {
    let version = 7;
    const { calls } = mockGateway({
      headVersion: 7,
      // Every push is stale: the project merges faster than this host can diff.
      learn: () => ({ status: 409, body: { error: "stale base", headVersion: ++version + 1 } }),
    });

    const res = await contributeProjectEvermindFromDelta(CFG, RUN_TEXT, TICKET, 0.7, engineDeps(fakeEngine()));

    expect(res.ok).toBe(true);
    expect(res.fellBackToText).toBe(true);
    expect(res.delta).toBe(false);
    const textPost = calls.find((c) => c.url.includes("/evermind/learn-text"));
    expect(textPost).toBeDefined();
    expect(textPost!.body!.text).toContain("Created retry.ts");
    expect(textPost!.body!.prompt).toBe(TICKET);
    // Exactly two delta attempts, then the fallback — never an unbounded retry loop.
    expect(learnCalls(calls)).toHaveLength(2);
  });

  it("does not retry when the refusal is not a stale base (frozen / unseeded / too large)", async () => {
    const { calls } = mockGateway({
      learn: () => ({ status: 423, body: { error: "project Evermind is offline-frozen (read-only); learning disabled" } }),
    });
    const res = await contributeProjectEvermindFromDelta(CFG, RUN_TEXT, TICKET, 0.7, engineDeps(fakeEngine()));
    expect(learnCalls(calls)).toHaveLength(1);
    expect(res.fellBackToText).toBe(true);
  });
});

describe("delta path never costs a contribution", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to text when the engine package is absent", async () => {
    const { calls } = mockGateway();
    const res = await contributeProjectEvermindFromDelta(CFG, RUN_TEXT, TICKET, 0.7, { loadEngine: async () => null });
    expect(res.fellBackToText).toBe(true);
    expect(res.reason).toBe("engine unavailable");
    expect(learnCalls(calls)).toHaveLength(0);
    expect(calls.some((c) => c.url.includes("/evermind/learn-text"))).toBe(true);
  });

  it("falls back to text on an unseeded head, without fetching artifacts", async () => {
    const { calls } = mockGateway({ headVersion: 0 });
    const res = await contributeProjectEvermindFromDelta(CFG, RUN_TEXT, TICKET, 0.7, engineDeps(fakeEngine()));
    expect(res.fellBackToText).toBe(true);
    expect(calls.some((c) => c.url.includes("/evermind/model"))).toBe(false);
  });

  it("falls back to text on a frozen head", async () => {
    const { calls } = mockGateway({ mode: "offline-frozen" });
    const res = await contributeProjectEvermindFromDelta(CFG, RUN_TEXT, TICKET, 0.7, engineDeps(fakeEngine()));
    expect(res.reason).toBe("offline-frozen");
    expect(calls.some((c) => c.url.includes("/evermind/learn-text"))).toBe(true);
  });

  it("falls back to text when the base artifact can't be fetched", async () => {
    const { calls } = mockGateway({ artifactsFail: true });
    const res = await contributeProjectEvermindFromDelta(CFG, RUN_TEXT, TICKET, 0.7, engineDeps(fakeEngine()));
    expect(res.reason).toBe("base artifact unavailable");
    expect(calls.some((c) => c.url.includes("/evermind/learn-text"))).toBe(true);
  });

  it("skips the whole path for too-short text, exactly like the text door", async () => {
    const { fetchMock } = mockGateway();
    const res = await contributeProjectEvermindFromDelta(CFG, "hi", TICKET, 0.7, engineDeps(fakeEngine()));
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when the adapt itself blows up", async () => {
    const broken = fakeEngine();
    broken.adaptAndDiff = () => { throw new Error("shape mismatch"); };
    const { calls } = mockGateway();
    const res = await contributeProjectEvermindFromDelta(CFG, RUN_TEXT, TICKET, 0.7, engineDeps(broken));
    expect(res.fellBackToText).toBe(true);
    expect(res.reason).toContain("shape mismatch");
    expect(calls.some((c) => c.url.includes("/evermind/learn-text"))).toBe(true);
  });
});
