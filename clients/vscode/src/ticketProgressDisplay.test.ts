import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendTicketProgress,
  conversationAccessibilityName,
  conversationTreeLabel,
  ticketProgressTooltipLine,
} from "./ticketProgressDisplay";

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

  it("appends open/done counts after the percent when both are known", () => {
    expect(appendTicketProgress("2h", 62, { open: 3, done: 5 })).toBe("2h · 62% · 3 open · 5 done");
    expect(appendTicketProgress("", 62, { open: 3, done: 5 })).toBe("62% · 3 open · 5 done");
    expect(appendTicketProgress("now", 0, { open: 4, done: 0 })).toBe("now · 0% · 4 open · 0 done");
  });

  it("omits counts when either is unknown (older server) — absent is never 0", () => {
    expect(appendTicketProgress("2h", 62, { open: 3 })).toBe("2h · 62%");
    expect(appendTicketProgress("2h", 62, { open: null, done: 5 })).toBe("2h · 62%");
    expect(appendTicketProgress("2h", 62, {})).toBe("2h · 62%");
  });

  it("never shows counts without a percent", () => {
    expect(appendTicketProgress("2h", null, { open: 3, done: 5 })).toBe("2h");
  });

  it("renders the counts through the host's localized labels", () => {
    const labels = { open: (n: number) => `${n} offen`, done: (n: number) => `${n} erledigt` };
    expect(appendTicketProgress("2h", 62, { open: 3, done: 5 }, labels)).toBe("2h · 62% · 3 offen · 5 erledigt");
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
    // The open/done counts reach the row, localized.
    expect(source).toContain("ticketOpenCount");
    expect(source).toContain("ticketDoneCount");
    expect(source).toContain('vscode.l10n.t("{n} open"');
    expect(source).toContain('vscode.l10n.t("{n} done"');
    // The percent goes through the ONE rounding rule the picker and the rail use.
    expect(source).toContain("displayChatProgressPct");
    expect(source).toContain("conversationAccessibilityName");
    expect(source).toContain("ticketProgressTooltipLine");
    expect(source).toContain("accessibilityInformation");
  });

  it("does not mention context-window usage on the Sessions row", () => {
    expect(source.toLowerCase()).not.toMatch(/context window|usedtokens|modelcontextwindow/);
  });
});
