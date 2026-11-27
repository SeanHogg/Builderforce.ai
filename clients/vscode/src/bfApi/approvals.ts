import type * as vscode from "vscode";
import { reportExtensionError } from "../diagnostics/errorReporter";
import { authed } from "./transport";

/**
 * The extension's ONE client of the tenant approvals queue (`/api/approvals`): list,
 * resolve, create and read-by-id. The Inbox, the review command and the Synapse phone
 * relay all reach the endpoint through here, so the route and its payload shapes are
 * spelled once.
 */

/** A pending (or resolved) human-in-the-loop request from the tenant approvals queue.
 *  Mirrors the `approvals` row shape returned by GET/PATCH /api/approvals. */
export interface BfApproval {
  id: string;
  kind?: "approval" | "question" | "feedback" | string;
  actionType?: string;
  description?: string;
  status?: "pending" | "approved" | "rejected" | "answered" | "expired" | string;
  reviewNote?: string | null;
  responseText?: string | null;
  executionId?: number | null;
  agentHostId?: number | null;
  cloudAgentRef?: string | null;
  /** The project this approval belongs to (via its execution's task), or null when it
   *  isn't tied to a task. Server-enriched so the Inbox can scope/label by project. */
  projectId?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

/** What `POST /api/approvals` takes for a self-owned approval. */
export interface CreateApprovalInput {
  actionType: string;
  description: string;
  metadata?: Record<string, unknown>;
  /** ISO timestamp after which the approval expires unanswered. */
  expiresAt?: string;
}

/**
 * List human-in-the-loop approvals for the active tenant — the SAME endpoint the web
 * HumanRequestsView uses (GET /api/approvals). Defaults to `pending`. Optionally narrows
 * to one on-prem agent host. Degrades to [] when the endpoint isn't deployed (the
 * failure is reported, never swallowed).
 */
export async function listHumanRequests(
  secrets: vscode.SecretStorage,
  opts?: { status?: string; agentHostId?: number },
): Promise<BfApproval[]> {
  const status = opts?.status ?? "pending";
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (opts?.agentHostId != null) params.set("agentHostId", String(opts.agentHostId));
  const qs = params.toString();
  try {
    const r = await authed<{ approvals: BfApproval[] }>(secrets, `/api/approvals${qs ? `?${qs}` : ""}`);
    return r?.approvals ?? [];
  } catch (error) {
    await reportExtensionError(error, { operation: "approvals:list" });
    return [];
  }
}

/**
 * Resolve a human-in-the-loop request — the SAME endpoint the web ApprovalResolveControl
 * uses (PATCH /api/approvals/:id). `decision` maps to the backend status:
 *   - "approve" → "approved", "reject" → "rejected" (kind: approval)
 *   - "answer"  → "answered" (kind: question/feedback; requires `note` as responseText)
 * `note` is the review note for approve/reject, or the answer text for "answer".
 * Returns the updated approval (may carry `startedExecutionId` when an approval started a run).
 */
export async function resolveHumanRequest(
  secrets: vscode.SecretStorage,
  id: string,
  decision: "approve" | "reject" | "answer",
  note?: string,
): Promise<BfApproval & { startedExecutionId?: number | null }> {
  const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "answered";
  const payload: { status: string; reviewNote?: string; responseText?: string } = { status };
  if (decision === "answer") payload.responseText = note ?? "";
  else if (note) payload.reviewNote = note;

  const r = await authed<BfApproval & { startedExecutionId?: number | null }>(
    secrets,
    `/api/approvals/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
  if (!r) throw new Error("not signed in");
  return r;
}

/** File a self-owned approval (`kind: "approval"`). Throws when signed out or refused. */
export async function createApproval(
  secrets: vscode.SecretStorage,
  input: CreateApprovalInput,
): Promise<{ approvalId: string; status: string }> {
  const r = await authed<{ approvalId: string; status: string }>(secrets, "/api/approvals", {
    method: "POST",
    body: JSON.stringify({ kind: "approval", ...input }),
  });
  if (!r) throw new Error("not signed in");
  return r;
}

/** One approval's status (GET /api/approvals/:id). Throws when signed out. */
export async function getApproval(secrets: vscode.SecretStorage, id: string): Promise<{ status: string }> {
  const r = await authed<{ status: string }>(secrets, `/api/approvals/${encodeURIComponent(id)}`);
  if (!r) throw new Error("not signed in");
  return r;
}
