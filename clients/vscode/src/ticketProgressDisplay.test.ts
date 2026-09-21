import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendTicketProgress,
  clampTicketProgressPct,
  conversationAccessibilityName,
  conversationTreeLabel,
  ticketProgressTooltipLine,
} from "./ticketProgressDisplay";

describe("clampTicketProgressPct", () => {
  it("returns null for absent / non-finite values (never fakes 0%)", () => {
    expect(clampTicketProgressPct(undefined)).toBeNull();
    expect(clampTicketProgressPct(null)).toBeNull();
    expect(clampTicketProgressPct(Number.NaN)).toBeNull();
    expect(clampTicketProgressPct(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampTicketProgressPct(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(clampTicketProgressPct("85")).toBeNull();
  });

  it("keeps a real 0%", () => {
    expect(clampTicketProgressPct(0)).toBe(0);
  });

  it("floors and clamps to [0, 100]", () => {
    expect(clampTicketProgressPct(85)).toBe(85);
    expect(clampTicketProgressPct(99.9)).toBe(99);
    expect(clampTicketProgressPct(100)).toBe(100);
    expect(clampTicketProgressPct(100.4)).toBe(100);
    expect(clampTicketProgressPct(101)).toBe(100);
    expect(clampTicketProgressPct(-1)).toBe(0);
    expect(clampTicketProgressPct(-0.4)).toBe(0);
  });
});

describe("conversationTreeLabel", () => {
  it("returns the chat title only — never a percent prefix", () => {
    expect(conversationTreeLabel({ id: 12, title: "Auth refactor" })).toBe("Auth refactor");
    expect(conversationTreeLabel({ id: 12, title: "Auth refactor" })).not.toMatch(/%/);
  });

  it("falls back to Chat {id} when title is empty", () => {
    expect(conversationTreeLabel({ id: 44, title: "" })).toBe("Chat 44");
    expect(conversationTreeLabel({ id: 44, title: null })).toBe("Chat 44");
  });
});

describe("appendTicketProgress", () => {
  it("appends · n% after relative time when a percent is present", () => {
    expect(appendTicketProgress("2h", 85)).toBe("2h · 85%");
    expect(appendTicketProgress("now", 0)).toBe("now · 0%");
    expect(appendTicketProgress("3d", 100)).toBe("3d · 100%");
  });

  it("leaves the time unchanged when percent is absent", () => {
    expect(appendTicketProgress("2h", null)).toBe("2h");
    expect(appendTicketProgress("", null)).toBe("");
  });

  it("does not emit a dangling · when time is empty", () => {
    expect(appendTicketProgress("", 85)).toBe("85%");
    expect(appendTicketProgress("", 85)).not.toMatch(/^ · /);
  });
});

describe("ticketProgressTooltipLine", () => {
  it("names the figure as ticket progress, never context", () => {
    expect(ticketProgressTooltipLine(85)).toBe("Ticket progress: 85%");
    expect(ticketProgressTooltipLine(85).toLowerCase()).not.toMatch(/context|token/);
  });
});

describe("conversationAccessibilityName", () => {
  it("includes title, time, and ticket progress when shown", () => {
    expect(conversationAccessibilityName("Auth refactor", "2h", 85)).toBe(
      "Auth refactor, 2h, 85 percent ticket progress",
    );
  });

  it("omits the progress clause when the marker is hidden", () => {
    expect(conversationAccessibilityName("Auth refactor", "2h", null)).toBe("Auth refactor, 2h");
  });

  it("skips an empty time rather than leaving a blank slot", () => {
    expect(conversationAccessibilityName("Auth refactor", "", 85)).toBe(
      "Auth refactor, 85 percent ticket progress",
    );
  });
});

describe("sessionsTree row contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "sessionsTree.ts"), "utf8");

  it("does not prefix TreeItem.label with {n}% · {title}", () => {
    // The previous defect: conversationTreeLabel returned `${pct}% · ${title}`.
    expect(source).not.toContain("% · ${title}");
    expect(source).not.toContain("% · ${");
  });

  it("feeds description through appendTicketProgress and sets a11y from the helper", () => {
    expect(source).toContain("appendTicketProgress");
    expect(source).toContain("conversationAccessibilityName");
    expect(source).toContain("ticketProgressTooltipLine");
    expect(source).toContain("accessibilityInformation");
  });

  it("does not mention context-window usage on the Sessions row", () => {
    expect(source.toLowerCase()).not.toMatch(/context window|usedtokens|modelcontextwindow/);
  });
});
