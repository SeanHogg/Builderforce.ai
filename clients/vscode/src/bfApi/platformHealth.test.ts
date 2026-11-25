import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox } from "@builderforce/write-outbox";
import { apiConnectivity, trackReachability } from "../outboxStorage";
import { classifyPlatformStatus, createPlatformHealth, platformHealth } from "./platformHealth";

const respond = (status: number, body = ""): Response => new Response(body, { status });

describe("platform health classifier", () => {
  it.each([200, 204, 301, 401, 403, 404, 429, 500])("treats %i as online", (status) => {
    expect(classifyPlatformStatus(status)).toBe("online");
  });

  it.each([502, 503, 504])("treats %i as degraded", (status) => {
    expect(classifyPlatformStatus(status)).toBe("degraded");
  });

  it("maps a 503 database_unavailable answer to degraded and a thrown fetch to unreachable", () => {
    const health = createPlatformHealth();
    expect(health.reportResponse(503)).toBe("degraded");
    expect(health.reportUnreachable()).toBe("unreachable");
    expect(health.reportResponse(200)).toBe("online");
  });

  it("notifies only real transitions", () => {
    const health = createPlatformHealth();
    const seen: string[] = [];
    const off = health.subscribe((s) => seen.push(s));
    health.reportResponse(200);
    health.reportResponse(503);
    health.reportResponse(504);
    health.reportUnreachable();
    health.reportResponse(404);
    off();
    health.reportResponse(503);
    expect(seen).toEqual(["degraded", "unreachable", "online"]);
  });
});

describe("trackReachability", () => {
  beforeEach(() => {
    platformHealth.reportResponse(200);
    apiConnectivity.set(true);
  });

  it("never consumes the caller's body", async () => {
    const res = respond(503, JSON.stringify({ code: "database_unavailable" }));
    const out = await trackReachability(Promise.resolve(res));
    expect(out.bodyUsed).toBe(false);
    expect(await out.json()).toEqual({ code: "database_unavailable" });
  });

  it("records degraded on 503, unreachable on a throw, and recovers on any 4xx", async () => {
    await trackReachability(Promise.resolve(respond(503, '{"code":"database_unavailable"}')));
    expect(platformHealth.state()).toBe("degraded");
    expect(apiConnectivity.isOnline()).toBe(false);

    await expect(trackReachability(Promise.reject(new TypeError("fetch failed")))).rejects.toThrow("fetch failed");
    expect(platformHealth.state()).toBe("unreachable");
    expect(apiConnectivity.isOnline()).toBe(false);

    await trackReachability(Promise.resolve(respond(404)));
    expect(platformHealth.state()).toBe("online");
    expect(apiConnectivity.isOnline()).toBe(true);
  });
});

describe("outbox under platform health", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    platformHealth.reportResponse(200);
    apiConnectivity.set(true);
  });
  afterEach(() => vi.useRealTimers());

  it("pauses while degraded and replays when a call succeeds", async () => {
    const sent: string[] = [];
    const box = createOutbox<number>({
      maxItems: 1,
      maxWaitMs: 0,
      retry: { baseMs: 60_000 },
      online: apiConnectivity,
      send: (key) => { sent.push(key); },
    });
    await trackReachability(Promise.resolve(respond(503)));
    box.enqueue("a", 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);

    await trackReachability(Promise.resolve(respond(200)));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["a"]);
  });

  it("still pauses while unreachable and resumes on the next answer", async () => {
    const sent: string[] = [];
    const box = createOutbox<number>({
      maxItems: 1,
      maxWaitMs: 0,
      retry: { baseMs: 60_000 },
      online: apiConnectivity,
      send: (key) => { sent.push(key); },
    });
    await expect(trackReachability(Promise.reject(new Error("offline")))).rejects.toThrow();
    box.enqueue("a", 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);

    await trackReachability(Promise.resolve(respond(401)));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["a"]);
  });
});
