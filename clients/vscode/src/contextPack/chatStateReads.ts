/**
 * The chat's linked tickets and runs, read HOST-side for the context pack (PRD 35 E2),
 * through the ONE shared reader (`readChatTicketLinks` / `readChatRunHistory` in
 * brain-embedded — the panel's chat-tickets adapter reads the same routes through it).
 * What is the pack's own: the cap on how many it lists, the fields it renders, and that
 * a failure is a missing part ([] / null), never a failed run.
 */

import type * as vscode from "vscode";
import { readChatRunHistory, readChatTicketLinks, type ChatStateGet } from "@seanhogg/builderforce-brain-embedded";
import { authed } from "../bfApi";
import type { ContextPackChat, ContextPackRun, ContextPackTicket } from "./renderContextPack";

/** Tickets / runs a pack lists — the newest work is what a planner needs. */
const MAX_TICKETS = 25;
const MAX_RUNS = 15;

type WireTicket = Partial<ContextPackTicket> & { kind?: string; ref?: string };

function getVia(secrets: vscode.SecretStorage): ChatStateGet {
  return <T>(path: string) => authed<T>(secrets, path);
}

/** The chat's tickets — [] on any failure (a pack part is optional). */
export async function readChatTickets(secrets: vscode.SecretStorage, chatId: number): Promise<ContextPackTicket[]> {
  try {
    const tickets = await readChatTicketLinks<WireTicket>(getVia(secrets), chatId);
    return tickets.slice(0, MAX_TICKETS).map((t) => ({
      kind: String(t.kind ?? ""),
      ref: String(t.ref ?? ""),
      label: String(t.label ?? ""),
      status: String(t.status ?? ""),
      ...(typeof t.progressPct === "number" ? { progressPct: t.progressPct } : {}),
    }));
  } catch {
    return [];
  }
}

/** The chat's runs — null when the history could not be read (never "nothing ran"). */
export async function readChatRuns(secrets: vscode.SecretStorage, chatId: number): Promise<ContextPackRun[] | null> {
  try {
    const r = await readChatRunHistory<{ runs?: Array<Partial<ContextPackRun>> }>(getVia(secrets), chatId);
    if (!r || !Array.isArray(r.runs)) return null;
    return r.runs.slice(0, MAX_RUNS).map((run) => ({
      executionId: Number(run.executionId ?? 0),
      taskTitle: run.taskTitle ?? null,
      agentName: run.agentName ?? null,
      status: String(run.status ?? ""),
      executor: run.executor ?? null,
      errorMessage: run.errorMessage ?? null,
    }));
  } catch {
    return null;
  }
}

/** Both reads, in parallel. */
export async function readChatState(secrets: vscode.SecretStorage, chatId: number): Promise<ContextPackChat> {
  const [tickets, runs] = await Promise.all([readChatTickets(secrets, chatId), readChatRuns(secrets, chatId)]);
  return { tickets, runs };
}
