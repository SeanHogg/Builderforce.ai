import { describe, expect, it } from "vitest";
import { INSIGHTS_CADENCE, insightsMode, insightsStartDelay, nextErrorBackoff } from "./insightsCadence";

describe("insightsMode", () => {
  it("streams only for a signed-in, attended window with the Health view on screen", () => {
    expect(insightsMode({ signedIn: true, attended: true, viewVisible: true })).toBe("stream");
  });

  it("falls back to slow cached reads when only the status bar shows", () => {
    expect(insightsMode({ signedIn: true, attended: true, viewVisible: false })).toBe("poll");
  });

  it("makes no requests at all while the window is unattended or signed out", () => {
    expect(insightsMode({ signedIn: true, attended: false, viewVisible: true })).toBe("off");
    expect(insightsMode({ signedIn: true, attended: false, viewVisible: false })).toBe("off");
    expect(insightsMode({ signedIn: false, attended: true, viewVisible: true })).toBe("off");
  });
});

describe("nextErrorBackoff", () => {
  it("climbs 15 s → doubling → capped at 5 min", () => {
    let ms = 0;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      ms = nextErrorBackoff(ms);
      seen.push(ms);
    }
    expect(seen[0]).toBe(INSIGHTS_CADENCE.ERROR_MIN_MS);
    expect(seen[1]).toBe(INSIGHTS_CADENCE.ERROR_MIN_MS * 2);
    expect(Math.max(...seen)).toBe(INSIGHTS_CADENCE.ERROR_MAX_MS);
    expect(seen.at(-1)).toBe(INSIGHTS_CADENCE.ERROR_MAX_MS);
  });
});

describe("insightsStartDelay", () => {
  const now = 1_000_000;

  it("starts immediately with no prior frame", () => {
    expect(insightsStartDelay("stream", now, 0, 0, false)).toBe(0);
    expect(insightsStartDelay("poll", now, 0, 0, false)).toBe(0);
  });

  it("does not reopen the stream on a focus flicker inside the min gap", () => {
    expect(insightsStartDelay("stream", now, now - 10_000, 0, false)).toBe(
      INSIGHTS_CADENCE.REFRESH_MIN_GAP_MS - 10_000,
    );
  });

  it("polls on the slow cadence measured from the last good frame", () => {
    expect(insightsStartDelay("poll", now, now - 60_000, 0, false)).toBe(INSIGHTS_CADENCE.POLL_MS - 60_000);
    // Back after a long absence → refetch right away.
    expect(insightsStartDelay("poll", now, now - 2 * 60 * 60_000, 0, false)).toBe(0);
  });

  it("honours a pending error backoff", () => {
    expect(insightsStartDelay("stream", now, 0, now + 40_000, false)).toBe(40_000);
  });

  it("fresh (sign-in / project switch) skips every wait", () => {
    expect(insightsStartDelay("stream", now, now - 1_000, now + 40_000, true)).toBe(0);
  });
});
