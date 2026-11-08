/**
 * The `local.chatRail` bridge contract (G21): the shapes the host serves the chat's ticket
 * rail from its LOCAL store, and the typed request the webview sends.
 *
 * Types only, so the webview imports it the way it imports `idePersona` / `gitChangeModel`.
 *
 * A chat is named by a {@link ChatRef}: a NUMBER is the chat's SERVER id (what the rail
 * panel is handed for a bound chat); a STRING is the chat's local client id.
 */

import type { PresentedSyncStatus } from "../syncStatusPresenter";
import type { SyncSummary } from "../sync/syncSummary";

export type ChatRef = string | number;

export type RailLinkType = "linked" | "created";

/** The parent a ticket hangs under, when the server named one. */
export interface RailTicketParent {
  kind: string;
  ref: string;
  label: string;
}

/** One linked ticket of the chat, as the rail draws it (`TicketLinkVM` plus its local facts). */
export interface RailTicket {
  /** The local ticket record's id. */
  clientId: string;
  /** The server's link id; negative for a link this device made and the server has not mapped yet. */
  linkId: number;
  kind: string;
  ref: string;
  /** Empty for a work item linked before the device read it: the reader formats it from `kind` and `ref`. */
  label: string;
  status: string;
  progressPct: number;
  done: number;
  total: number;
  exists: boolean;
  linkType: RailLinkType;
  parent?: RailTicketParent;
  syncStatus: PresentedSyncStatus | undefined;
}

/** One chat-ticket link record. */
export interface RailLink {
  clientId: string;
  ticketClientId: string;
  linkType: RailLinkType;
  syncStatus: PresentedSyncStatus | undefined;
}

/** One run started against a ticket the chat links (entity type `execution`). */
export interface RailRun {
  executionId: number;
  taskId: number;
  taskTitle: string | null;
  agentRef: string | null;
  agentName: string | null;
  status: string;
  submittedBy: string;
  source: string;
  executor: string | null;
  hostId: number | null;
  hostName: string | null;
  produced: boolean | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface RailRunHistory {
  linkedRunnableTickets: number;
  runs: RailRun[];
  dispatchers: string[];
  executors: string[];
}

export interface RailFreshness {
  /** When this device last took the rail from the platform (or last saw the platform change it). */
  lastIngestedAt?: string;
  /**
   * `server-observed` when the chat is bound to the platform (read yet or not) or the platform reported
   * any of its rows; `device` while the chat and its rail exist only on this device.
   */
  source: "device" | "server-observed";
}

/** What the host answers with, and pushes when the store changes the chat's rail. */
export interface RailSnapshot {
  chatId: ChatRef;
  /** False when the store holds no such chat: every list is empty. */
  found: boolean;
  /** The chat's local client id, when found. */
  chatClientId?: string;
  tickets: RailTicket[];
  links: RailLink[];
  runHistory: RailRunHistory;
  freshness: RailFreshness;
  summary: SyncSummary;
}

/** A work item a link or unlink names (the webview knows it by kind and ref, as the platform does). */
export interface RailTicketRef {
  kind: string;
  ref: string;
}

/** The typed body of a `local.chatRail` request. */
export type ChatRailRequest =
  | { action: "read"; chatId: ChatRef }
  /** Read the platform when allowed, ingest it, answer with the (possibly unchanged) local copy. */
  | { action: "refresh"; chatId: ChatRef }
  | ({ action: "link"; chatId: ChatRef; linkType: RailLinkType } & RailTicketRef)
  | ({ action: "unlink"; chatId: ChatRef } & RailTicketRef);

/** The push frame the host posts to a webview watching a chat. */
export interface ChatRailFrame {
  type: "local.chatRail";
  chatId: ChatRef;
  rail: RailSnapshot;
}

/** What a link or unlink answers: written locally, or the reason it was not. */
export type ChatRailMutationOutcome = { ok: true } | { ok: false; error: string };

export type ChatRailRefreshOutcome =
  | { status: "ok"; written: number; tombstoned: number }
  /** The platform is not allowed (local-only, signed out): nothing was read, the last copy stands. */
  | { status: "skipped" }
  /** A read failed: nothing was ingested, the last copy stands. */
  | { status: "error"; message: string };
