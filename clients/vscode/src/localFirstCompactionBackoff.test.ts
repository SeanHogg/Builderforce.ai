import { describe, expect, it } from "vitest";
import { createCompactionBackoff } from "./localFirstCompactionBackoff";

function clock() {
  let at = 1_000;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}

describe("createCompactionBackoff", () => {
  it("allows compaction until one fails", () => {
    const time = clock();
    const backoff = createCompactionBackoff({ now: time.now, baseMs: 100, maxMs: 1000 });
    expect(backoff.allowed()).toBe(true);
    backoff.failed();
    expect(backoff.allowed()).toBe(false);
  });

  it("allows again once the window has passed", () => {
    const time = clock();
    const backoff = createCompactionBackoff({ now: time.now, baseMs: 100, maxMs: 1000 });
    backoff.failed();
    time.advance(99);
    expect(backoff.allowed()).toBe(false);
    time.advance(1);
    expect(backoff.allowed()).toBe(true);
  });

  it("doubles the window per failure and caps it at maxMs", () => {
    const time = clock();
    const backoff = createCompactionBackoff({ now: time.now, baseMs: 100, maxMs: 500 });
    for (const window of [100, 200, 400, 500, 500]) {
      backoff.failed();
      time.advance(window - 1);
      expect(backoff.allowed()).toBe(false);
      time.advance(1);
      expect(backoff.allowed()).toBe(true);
    }
  });

  it("a success resets the delay to the base", () => {
    const time = clock();
    const backoff = createCompactionBackoff({ now: time.now, baseMs: 100, maxMs: 1000 });
    backoff.failed();
    time.advance(100);
    backoff.failed(); // 200 ms window
    backoff.succeeded();
    expect(backoff.allowed()).toBe(true);
    backoff.failed();
    time.advance(100);
    expect(backoff.allowed()).toBe(true); // back to the 100 ms base, not 400
  });

  it("defaults to 30 s doubling up to 15 min", () => {
    const time = clock();
    const backoff = createCompactionBackoff({ now: time.now });
    backoff.failed();
    time.advance(29_999);
    expect(backoff.allowed()).toBe(false);
    time.advance(1);
    expect(backoff.allowed()).toBe(true);
    for (let index = 0; index < 20; index += 1) backoff.failed();
    time.advance(15 * 60_000 - 1);
    expect(backoff.allowed()).toBe(false);
    time.advance(1);
    expect(backoff.allowed()).toBe(true);
  });
});
