import { describe, expect, it } from "vitest";
import type { BfBrainChat, BfCreationSessionSummary } from "./bfApi";
import { sessionsLibraryGroup, sessionsLibraryRows } from "./sessionsLibrary";

function board(overrides: Partial<BfCreationSessionSummary> = {}): BfCreationSessionSummary {
  return { id: "s1", title: "Launch plan", revision: 1, lastActivityAt: "2026-09-05T10:00:00.000Z", ...overrides };
}

function chat(overrides: Partial<BfBrainChat> = {}): BfBrainChat {
  return { id: 88, title: "Why is this 401?", projectId: null, updatedAt: "2026-09-06T10:00:00.000Z", ...overrides };
}

describe("sessionsLibraryRows", () => {
  it("puts boards and conversations in ONE list, newest first", () => {
    const rows = sessionsLibraryRows({
      sessions: [board({ lastActivityAt: "2026-03-01T10:00:00.000Z", title: "March board" })],
      chats: [chat()],
    });

    // The conversation is newer, so it leads — which a "Chats" group underneath the
    // sessions could never say.
    expect(rows.map((row) => row.title)).toEqual(["Why is this 401?", "March board"]);
    expect(rows.map((row) => row.facet)).toEqual(["chat", "canvas"]);
  });

  it("drops a conversation a board already holds a card for", () => {
    const rows = sessionsLibraryRows({
      sessions: [board({ preview: { objects: [{ resourceType: "chat", resourceId: "88" }] } })],
      chats: [chat({ id: 88 })],
    });

    // Both rows would open the same panel on the same conversation.
    expect(rows).toHaveLength(1);
    expect(rows[0].facet).toBe("canvas");
  });

  it("does not let cards without a record collapse onto one another", () => {
    // A hand-written `${type}:${id}` answers "null:null" for every record-less card,
    // so ONE such card would suppress a chat whose ref read the same way.
    const rows = sessionsLibraryRows({
      sessions: [board({ preview: { objects: [{ status: "idle" }, { status: "idle" }] } })],
      chats: [chat()],
    });

    expect(rows).toHaveLength(2);
  });

  it("pins to the top regardless of recency", () => {
    const rows = sessionsLibraryRows({
      sessions: [board({ id: "old", title: "Pinned", lastActivityAt: "2026-01-01T10:00:00.000Z", pinned: true })],
      chats: [chat()],
    });

    expect(rows[0].title).toBe("Pinned");
  });

  it("reads a conversation's run state from the host, not from its own fields", () => {
    const rows = sessionsLibraryRows({ sessions: [], chats: [chat({ id: 7 })], runningChatIds: new Set([7]) });

    expect(rows[0].running).toBe(true);
  });

  it("does not report a multi-party conversation as shared", () => {
    // `participants` is who is IN a chat, not who it is shared WITH — reading one as
    // the other would file every agent-assisted chat under "Shared" beside the boards
    // people actually invited each other to.
    const rows = sessionsLibraryRows({
      sessions: [],
      chats: [chat({ participants: [{ ref: "agent:1", kind: "agent" }, { ref: "user:2", kind: "human" }] })],
    });

    expect(rows[0].shared).toBe(false);
  });
});

describe("sessionsLibraryGroup", () => {
  const rows = sessionsLibraryRows({
    sessions: [
      board({ id: "p", title: "Pinned board", pinned: true }),
      board({ id: "sh", title: "Shared board", collaboratorCount: 3 }),
      board({ id: "r", title: "Running board", preview: { objects: [{ status: "running" }] } }),
    ],
    chats: [chat({ id: 9, title: "A chat" })],
  });

  it("shows the whole list under `all`, conversations included", () => {
    expect(sessionsLibraryGroup(rows, "all").map((row) => row.title)).toContain("A chat");
    expect(sessionsLibraryGroup(rows, "all")).toHaveLength(4);
  });

  it("caps the recent list so the sidebar stays a sidebar", () => {
    expect(sessionsLibraryGroup(rows, "all", 2)).toHaveLength(2);
  });

  it("reads the other three as facets of that same list", () => {
    expect(sessionsLibraryGroup(rows, "pinned").map((row) => row.title)).toEqual(["Pinned board"]);
    expect(sessionsLibraryGroup(rows, "shared").map((row) => row.title)).toEqual(["Shared board"]);
    expect(sessionsLibraryGroup(rows, "running").map((row) => row.title)).toEqual(["Running board"]);
  });
});
