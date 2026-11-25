import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox } from "@builderforce/write-outbox";
import { apiConnectivity, trackReachability } from "../sync/outboxStorage";
import { BAD_SUSTAINED_MS, RECOVERY_MS, classifyPlatformStatus, createPlatformHealth, platformHealth } from "./platformHealth";

const respond = (status: number, body = ""): Response => new Response(body, { status });

describe("platform health classifier", () => {
  it.each([200, 204, 301, 401, 403, 404, 429, 500])("treats %i as online", (status) => {
    expect(classifyPlatformStatus(status)).toBe("online");
  });

  it.each([502, 503, 504])("treats %i as degraded", (status) => {
    expect(classifyPlatformStatus(status)).toBe("degraded");
  });
});

describe("platform health hysteresis", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a single non-online answer does not trip; a lone blip that recovers never shows", () => {
    const health = createPlatformHealth();
    const seen: string[] = [];
    health.subscribe((s) => seen.push(s));
    expect(health.reportResponse(503)).toBe("online");
    vi.advanceTimersByTime(BAD_SUSTAINED_MS - 1);
    health.reportResponse(200);
    vi.advanceTimersByTime(60_000);
    expect(health.state()).toBe("online");
    expect(seen).toEqual([]);
  });

  it("trips on the second non-online answer within 30s", () => {
    const health = createPlatformHealth();
    health.reportResponse(503);
    vi.advanceTimersByTime(2_000);
    health.reportResponse(200); // an online answer between does not reset the count
    vi.advanceTimersByTime(10_000);
    expect(health.reportResponse(503)).toBe("degraded");
  });

  it("does not trip on two non-online answers more than 30s apart", () => {
    const health = createPlatformHealth();
    health.reportResponse(503);
    health.reportResponse(200);
    vi.advanceTimersByTime(31_000);
    expect(health.reportResponse(503)).toBe("online");
  });

  it("trips on one non-online answer that stands for 5s with no online answer, with no further traffic", () => {
    const health = createPlatformHealth();
    const seen: string[] = [];
    health.subscribe((s) => seen.push(s));
    health.reportUnreachable();
    vi.advanceTimersByTime(BAD_SUSTAINED_MS - 1);
    expect(health.state()).toBe("online");
    vi.advanceTimersByTime(1);
    expect(health.state()).toBe("unreachable");
    expect(seen).toEqual(["unreachable"]);
  });

  it("once tripped, degraded and unreachable follow the latest answer at once", () => {
    const health = createPlatformHealth();
    health.reportResponse(503);
    health.reportResponse(503);
    expect(health.reportUnreachable()).toBe("unreachable");
    expect(health.reportResponse(504)).toBe("degraded");
  });

  it("returns to online only after 30s of CONTINUOUS online answers; a bad answer restarts the clock", () => {
    const health = createPlatformHealth("degraded");
    const seen: string[] = [];
    health.subscribe((s) => seen.push(s));
    health.reportResponse(200);
    vi.advanceTimersByTime(RECOVERY_MS - 1);
    expect(health.state()).toBe("degraded");
    health.reportResponse(503); // breaks the run
    health.reportResponse(200);
    vi.advanceTimersByTime(RECOVERY_MS - 1);
    expect(health.state()).toBe("degraded");
    vi.advanceTimersByTime(1);
    expect(health.state()).toBe("online");
    expect(seen).toEqual(["online"]);
  });

  it("notifies only real transitions of the stable state, and stops after unsubscribe", () => {
    const health = createPlatformHealth();
    const seen: string[] = [];
    const off = health.subscribe((s) => seen.push(s));
    health.reportResponse(200);
    health.reportResponse(503);
    health.reportResponse(504); // trips: degraded
    health.reportUnreachable(); // unreachable
    off();
    health.reportResponse(503);
    expect(seen).toEqual(["degraded", "unreachable"]);
  });
});

/** The singleton leaks between tests: drive it through trip and recovery so it is stably online with no recent bad answers. */
function resetPlatformHealth(): void {
  platformHealth.reportResponse(503);
  platformHealth.reportResponse(503);
  platformHealth.reportResponse(200);
  vi.advanceTimersByTime(RECOVERY_MS);
}

describe("trackReachability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPlatformHealth();
  });
  afterEach(() => vi.useRealTimers());

  it("never consumes the caller's body", async () => {
    const res = respond(503, JSON.stringify({ code: "database_unavailable" }));
    const out = await trackReachability(Promise.resolve(res));
    expect(out.bodyUsed).toBe(false);
    expect(await out.json()).toEqual({ code: "database_unavailable" });
  });

  it("a single 503 does not pause the outbox; a second does, and recovery needs 30s of online answers", async () => {
    await trackReachability(Promise.resolve(respond(503, '{"code":"database_unavailable"}')));
    expect(platformHealth.state()).toBe("online");
    expect(apiConnectivity.isOnline()).toBe(true);

    await trackReachability(Promise.resolve(respond(503)));
    expect(platformHealth.state()).toBe("degraded");
    expect(apiConnectivity.isOnline()).toBe(false);

    await expect(trackReachability(Promise.reject(new TypeError("fetch failed")))).rejects.toThrow("fetch failed");
    expect(platformHealth.state()).toBe("unreachable");
    expect(apiConnectivity.isOnline()).toBe(false);

    await trackReachability(Promise.resolve(respond(404)));
    expect(apiConnectivity.isOnline()).toBe(false); // not yet: the recovery window is still running
    vi.advanceTimersByTime(RECOVERY_MS);
    expect(platformHealth.state()).toBe("online");
    expect(apiConnectivity.isOnline()).toBe(true);
  });
});

describe("outbox under platform health", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPlatformHealth();
  });
  afterEach(() => vi.useRealTimers());

  it("pauses once the platform is stably degraded and replays after it has stably recovered", async () => {
    const sent: string[] = [];
    const box = createOutbox<number>({
      maxItems: 1,
      maxWaitMs: 0,
      retry: { baseMs: 60_000 },
      online: apiConnectivity,
      send: (key) => { sent.push(key); },
    });
    await trackReachability(Promise.resolve(respond(503)));
    await trackReachability(Promise.resolve(respond(503)));
    box.enqueue("a", 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);

    await trackReachability(Promise.resolve(respond(200)));
    await vi.advanceTimersByTimeAsync(RECOVERY_MS);
    expect(sent).toEqual(["a"]);
  });

  it("still pauses once stably unreachable and resumes after sustained healthy answers", async () => {
    const sent: string[] = [];
    const box = createOutbox<number>({
      maxItems: 1,
      maxWaitMs: 0,
      retry: { baseMs: 60_000 },
      online: apiConnectivity,
      send: (key) => { sent.push(key); },
    });
    await expect(trackReachability(Promise.reject(new Error("offline")))).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(BAD_SUSTAINED_MS); // one sustained failure trips it
    box.enqueue("a", 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);

    await trackReachability(Promise.resolve(respond(401)));
    await vi.advanceTimersByTimeAsync(RECOVERY_MS);
    expect(sent).toEqual(["a"]);
  });
});
