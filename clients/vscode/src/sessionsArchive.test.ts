import { describe, expect, it } from "vitest";
import type { BfBrainChat } from "./bfApi";
import { sessionsLibraryRows, type SessionsLibraryRow } from "./sessionsLibrary";
import {
  ARCHIVE_AFTER_MS,
  archive,
  isSessionComplete,
  partitionArchived,
  pruneArchive,
  sweepArchivable,
  unarchive,
  unarchiveOnInteraction,
  type ArchiveState,
} from "./sessionsArchive";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

/** A conversation row, which is the shape the `100% ·` label is computed from. */
function chatRow(overrides: Partial<BfBrainChat> = {}): SessionsLibraryRow {
  const chat: BfBrainChat = {
    id: 1,
    title: "Ship the thing",
    projectId: 11,
    updatedAt: daysAgo(10),
    ticketCount: 2,
    ticketProgressPct: 100,
    ...overrides,
  };
  return sessionsLibraryRows({ sessions: [], chats: [chat] })[0];
}

describe("isSessionComplete", () => {
  it("reads 100% over at least one ticket as finished", () => {
    expect(isSessionComplete(chatRow())).toBe(true);
  });

  it("does not call an untracked conversation finished", () => {
    // 100% of nothing is vacuous — and this is most ordinary chats, so treating it
    // as done would sweep the entire list into the archive.
    expect(isSessionComplete(chatRow({ ticketCount: 0, ticketProgressPct: 100 }))).toBe(false);
    expect(isSessionComplete(chatRow({ ticketCount: 0, ticketProgressPct: null }))).toBe(false);
  });

  it("leaves work in progress alone", () => {
    expect(isSessionComplete(chatRow({ ticketProgressPct: 99 }))).toBe(false);
    expect(isSessionComplete(chatRow({ ticketProgressPct: 19 }))).toBe(false);
  });

  it("rounds the way the row label does", () => {
    // The label prints `Math.round(pct)`, so 99.6 already READS as 100% to the user.
    expect(isSessionComplete(chatRow({ ticketProgressPct: 99.6 }))).toBe(true);
  });
});

describe("sweepArchivable", () => {
  it("archives a finished session once it has been quiet for five days", () => {
    const rows = [chatRow({ id: 7, updatedAt: daysAgo(6) })];

    expect(sweepArchivable(rows, {}, NOW)).toEqual(["chat:7"]);
  });

  it("does not archive before the fifth day", () => {
    const rows = [chatRow({ id: 7, updatedAt: daysAgo(4) })];

    expect(sweepArchivable(rows, {}, NOW)).toEqual([]);
  });

  it("is exact at the boundary rather than a day either side", () => {
    const justUnder = [chatRow({ id: 1, updatedAt: new Date(NOW - ARCHIVE_AFTER_MS + 1000).toISOString() })];
    const justOver = [chatRow({ id: 2, updatedAt: new Date(NOW - ARCHIVE_AFTER_MS - 1000).toISOString() })];

    expect(sweepArchivable(justUnder, {}, NOW)).toEqual([]);
    expect(sweepArchivable(justOver, {}, NOW)).toEqual(["chat:2"]);
  });

  it("never sweeps unfinished work, however old", () => {
    const rows = [chatRow({ id: 7, ticketProgressPct: 19, updatedAt: daysAgo(400) })];

    expect(sweepArchivable(rows, {}, NOW)).toEqual([]);
  });

  it("treats activity as the clock, so a finished session in use is never swept", () => {
    // The server records no `completedAt`; last activity is the honest stand-in, and
    // it means touching a session resets its five days.
    const rows = [chatRow({ id: 7, updatedAt: daysAgo(1) })];

    expect(sweepArchivable(rows, {}, NOW)).toEqual([]);
  });

  it("skips a row with no usable timestamp instead of calling it infinitely old", () => {
    const rows = [chatRow({ id: 7, updatedAt: undefined })];

    expect(sweepArchivable(rows, {}, NOW)).toEqual([]);
  });

  it("does not re-archive a row already in the store", () => {
    const rows = [chatRow({ id: 7, updatedAt: daysAgo(6) })];
    const state: ArchiveState = { "chat:7": { archivedAt: NOW - 1000, manual: false } };

    expect(sweepArchivable(rows, state, NOW)).toEqual([]);
  });

  it("leaves boards alone — only a conversation carries ticket progress", () => {
    const rows = sessionsLibraryRows({
      sessions: [{ id: "b1", title: "Board", revision: 1, lastActivityAt: daysAgo(90) }],
      chats: [],
    });

    expect(sweepArchivable(rows, {}, NOW)).toEqual([]);
  });
});

describe("unarchiveOnInteraction", () => {
  it("brings back a session the sweep archived", () => {
    // This is what makes the 5-day rule safe to be wrong: using a session restores it.
    const state = archive({}, ["chat:7"], NOW, false);

    expect(unarchiveOnInteraction(state, "chat:7")["chat:7"]).toBeUndefined();
  });

  it("respects a manual archive — opening it to look is not undoing it", () => {
    const state = archive({}, ["chat:7"], NOW, true);

    expect(unarchiveOnInteraction(state, "chat:7")["chat:7"]).toBeDefined();
  });

  it("returns the same object when there is nothing to do, so no write is issued", () => {
    const state: ArchiveState = {};

    expect(unarchiveOnInteraction(state, "chat:7")).toBe(state);
  });

  it("still lets the user un-archive a manual one explicitly", () => {
    const state = archive({}, ["chat:7"], NOW, true);

    expect(unarchive(state, "chat:7")["chat:7"]).toBeUndefined();
  });
});

describe("partitionArchived", () => {
  it("keeps archived rows out of the active list but still returns them", () => {
    const rows = [chatRow({ id: 1 }), chatRow({ id: 2 })];
    const state = archive({}, ["chat:2"], NOW, true);

    const { active, archived } = partitionArchived(rows, state);
    expect(active.map((r) => r.key)).toEqual(["chat:1"]);
    expect(archived.map((r) => r.key)).toEqual(["chat:2"]);
  });
});

describe("pruneArchive", () => {
  it("drops entries for rows the server no longer returns", () => {
    const state = archive({}, ["chat:1", "chat:99"], NOW, true);

    expect(Object.keys(pruneArchive(state, [chatRow({ id: 1 })]))).toEqual(["chat:1"]);
  });

  it("returns the same object when everything still exists", () => {
    const state = archive({}, ["chat:1"], NOW, true);

    expect(pruneArchive(state, [chatRow({ id: 1 })])).toBe(state);
  });
});
