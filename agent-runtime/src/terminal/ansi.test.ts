import { describe, expect, it } from "vitest";
import { stripAnsi, truncateToWidth, visibleWidth } from "./ansi.js";

const RED = "\x1b[31m";
const RESET = "\x1b[0m";

describe("visibleWidth", () => {
  it("ignores ANSI SGR escapes", () => {
    expect(visibleWidth(`${RED}hello${RESET}`)).toBe(5);
  });
  it("counts code points, not UTF-16 units", () => {
    expect(visibleWidth("a😀b")).toBe(3);
  });
});

describe("truncateToWidth", () => {
  it("returns the input unchanged when it already fits", () => {
    expect(truncateToWidth("hello", 5)).toBe("hello");
    expect(truncateToWidth("hi", 10)).toBe("hi");
  });

  it("hard-cuts to width with an empty ellipsis", () => {
    expect(truncateToWidth("hello world", 5, "")).toBe("hello");
  });

  it("reserves room for the ellipsis when clipping", () => {
    // default ellipsis "…" is width 1, so budget = 5 - 1 = 4
    expect(truncateToWidth("hello world", 5)).toBe("hell…");
  });

  it("returns empty for non-positive width", () => {
    expect(truncateToWidth("hello", 0)).toBe("");
    expect(truncateToWidth("hello", -3)).toBe("");
  });

  it("does not count ANSI escapes toward width and preserves them", () => {
    const out = truncateToWidth(`${RED}hello world${RESET}`, 5, "");
    expect(stripAnsi(out)).toBe("hello");
    expect(out).toContain(RED); // styling survives
    expect(out).toContain(RESET); // trailing reset is kept even past the cut
  });

  it("never exceeds the requested visible width", () => {
    expect(visibleWidth(truncateToWidth("a very long line of text", 10))).toBeLessThanOrEqual(10);
  });
});
