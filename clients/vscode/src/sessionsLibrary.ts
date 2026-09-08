import {
  representedResourceRefs,
  sortCreationLibrary,
  formatResourceRef,
  type CreationLibraryEntry,
} from "@builderforce/creation-canvas-contract";
import type { BfBrainChat, BfCreationSessionSummary } from "./bfApi";

/**
 * THE SESSIONS LIST — one list, because the sidebar opens one panel.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────
 * The tree used to draw five groups: "Recent Creation Sessions", "Pinned",
 * "Shared", "Running" — and then "Chats". The first four are FACETS of one list;
 * the fifth was a different SOURCE, with a different row shape and a different
 * command, presented as a peer of the other four.
 *
 * That was defensible while a chat opened a chat panel and a session opened a canvas
 * panel. It stopped being defensible the moment those merged: both rows now reveal
 * the SAME panel, differing only in the surface it opens at, so "Creation Sessions"
 * and "Chats" were two names for one destination sitting one above the other in the
 * same tree.
 *
 * So the kind became a property of a ROW, the groups became facets over one
 * recency-ordered list, and the ordering/dedupe rules come from the shared core the
 * web library uses (`@builderforce/creation-canvas-contract`) rather than a second
 * implementation that could disagree about which of two rows is newer.
 *
 * ── WHY IT IS A MODULE ───────────────────────────────────────────────────────
 * No `vscode` import: everything between "here are two API responses" and "here is
 * the list" is deterministic, and is tested that way in `sessionsLibrary.test.ts`.
 * The tree keeps what only it can do — icons, descriptions, commands.
 */

/** What opens when a row is clicked. The tree turns this into a command. */
export type SessionsLibrarySource =
  | { kind: "canvas"; session: BfCreationSessionSummary }
  | { kind: "chat"; chat: BfBrainChat };

export interface SessionsLibraryRow extends CreationLibraryEntry {
  /** More than one person on it — what the "Shared" facet reads. */
  shared: boolean;
  /** Something is running on it right now — what the "Running" facet reads. */
  running: boolean;
  source: SessionsLibrarySource;
}

/** The facets the tree offers as groups. `all` is the whole list, not a filter. */
export type SessionsLibraryGroup = "all" | "pinned" | "shared" | "running";

export interface SessionsLibraryInput {
  sessions: readonly BfCreationSessionSummary[];
  chats: readonly BfBrainChat[];
  /**
   * Chats a run is live on, by id. The tree learns this from `attentionFor`, which is
   * a host concern (it polls); passing it in keeps this module pure AND lets the
   * "Running" facet mean the same thing for a chat as it does for a board.
   */
  runningChatIds?: ReadonlySet<number>;
}

function boardIsRunning(session: BfCreationSessionSummary): boolean {
  return !!session.preview?.objects?.some((object) => object.status?.toLowerCase() === "running");
}

/**
 * Every session and chat as ONE recency-ordered list.
 *
 * A chat a board already holds a card for is left out: clicking that card's board and
 * clicking the chat row land in the same panel on the same conversation, so a second
 * row would be two doors into one room — the same rule the web library applies, from
 * the same shared implementation.
 */
export function sessionsLibraryRows(input: SessionsLibraryInput): SessionsLibraryRow[] {
  const represented = representedResourceRefs(input.sessions);
  const running = input.runningChatIds ?? new Set<number>();

  const canvases: SessionsLibraryRow[] = input.sessions.map((session) => ({
    key: `canvas:${session.id}`,
    facet: "canvas",
    title: session.title || "",
    lastActivityAt: session.lastActivityAt ?? null,
    pinned: !!session.pinned,
    shared: (session.collaboratorCount ?? 1) > 1,
    running: boardIsRunning(session),
    source: { kind: "canvas", session },
  }));

  const conversations: SessionsLibraryRow[] = input.chats
    .filter((chat) => !represented.has(formatResourceRef("chat", chat.id)!))
    .map((chat) => ({
      key: `chat:${chat.id}`,
      facet: "chat",
      title: chat.title || "",
      lastActivityAt: chat.updatedAt ?? null,
      // A chat has no pin and no roster of its own in this list: multi-party chats
      // report `participants`, which is who is IN it rather than who it is shared
      // WITH, and reading one as the other would put every agent-assisted chat under
      // "Shared" beside the boards people actually invited each other to.
      pinned: false,
      shared: false,
      running: running.has(chat.id),
      source: { kind: "chat", chat },
    }));

  return sortCreationLibrary([...canvases, ...conversations]);
}

/** The rows a group shows. `all` is the list itself — a group, not a filter. */
export function sessionsLibraryGroup(
  rows: readonly SessionsLibraryRow[],
  group: SessionsLibraryGroup,
  /** How many rows "all" shows before the list stops being a sidebar. */
  recentLimit = 20,
): SessionsLibraryRow[] {
  if (group === "pinned") return rows.filter((row) => row.pinned);
  if (group === "shared") return rows.filter((row) => row.shared);
  if (group === "running") return rows.filter((row) => row.running);
  return rows.slice(0, recentLimit);
}
