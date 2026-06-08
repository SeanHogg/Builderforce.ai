/**
 * Human-in-the-loop gate — the agent's single "bubble up to a human" channel.
 *
 * The agent posts a request to Builderforce.ai and suspends the calling code
 * until a human resolves it in the portal (or the request times out). The relay
 * delivers the resolution as an `approval.decision` WebSocket message, which
 * resolves the pending Promise.
 *
 * Three kinds, differing only in how a human resolves them:
 *   - `approval` — approve/reject a high-risk action before it runs.
 *   - `question` — the agent is blocked and needs a free-text answer to proceed.
 *   - `feedback` — the agent wants a human to review work and comment.
 * `question`/`feedback` come back as `decision: "answered"` with `responseText`.
 *
 * Usage:
 *   const r = await requestHumanInput({
 *     kind: "question",
 *     actionType: "clarify.requirements",
 *     description: "Should the export be CSV or XLSX?",
 *   });
 *   if (r.decision === "answered") use(r.responseText);
 */

import { logDebug, logWarn } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

/** Resolution of a human-in-the-loop request. */
export type HumanDecision = "approved" | "rejected" | "answered" | "timeout";
/** Backward-compatible alias for the approve/reject/timeout subset. */
export type ApprovalDecision = "approved" | "rejected" | "timeout";

/** What the agent is asking a human for. */
export type RequestKind = "approval" | "question" | "feedback";

export interface HumanInputResult {
  decision: HumanDecision;
  /** Free-text human answer, present for `decision === "answered"`. */
  responseText?: string;
}

type PendingEntry = {
  resolve: (result: HumanInputResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

export interface HumanInputRequest {
  /** Defaults to "approval". */
  kind?: RequestKind;
  actionType: string;
  description: string;
  metadata?: unknown;
  timeoutMs?: number;
}

/**
 * ApprovalGate encapsulates the state for human-in-the-loop requests.
 * Using a class rather than module-level `let` variables makes the state
 * explicit and the service replaceable with a test double.
 */
export class ApprovalGate {
  private baseUrl: string | null = null;
  private agentNodeId: string | null = null;
  private apiKey: string | null = null;
  private readonly pending = new Map<string, PendingEntry>();

  /**
   * Configure the gate with the Builderforce connection details.
   * Call once at startup when BUILDERFORCE_API_KEY is present.
   */
  init(opts: { baseUrl: string; agentNodeId: string; apiKey: string }): void {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.agentNodeId = opts.agentNodeId;
    this.apiKey = opts.apiKey;
  }

  /** True once init() has wired up a Builderforce connection. */
  isConfigured(): boolean {
    return !!(this.baseUrl && this.agentNodeId && this.apiKey);
  }

  /**
   * Called by the relay when an `approval.decision` WebSocket message arrives.
   * Resolves the corresponding pending Promise.
   */
  resolve(approvalId: string, decision: HumanDecision, responseText?: string): void {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      logDebug(`[approval-gate] received decision for unknown approvalId: ${approvalId}`);
      return;
    }
    this.pending.delete(approvalId);
    clearTimeout(entry.timer);
    entry.resolve({ decision, responseText });
  }

  /**
   * Request human input for an action / question / feedback.
   *
   * Posts to Builderforce, which notifies the manager via the portal. Resolves
   * when a human resolves it or the timeout expires (default 10 min).
   *
   * Auto-approves (no human) when Builderforce is not configured or the request
   * fails — so standalone runs are never hard-blocked.
   */
  async request(opts: HumanInputRequest): Promise<HumanInputResult> {
    const kind: RequestKind = opts.kind ?? "approval";

    if (!this.isConfigured()) {
      logWarn("[approval-gate] not configured — standalone mode; auto-approving");
      return { decision: "approved" };
    }

    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000; // 10 minutes
    const expiresAt = new Date(Date.now() + timeoutMs).toISOString();

    let approvalId: string;
    try {
      const res = await fetch(`${this.baseUrl}/api/agent-hosts/${this.agentNodeId}/approval-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          kind,
          actionType: opts.actionType,
          description: opts.description,
          metadata: opts.metadata,
          expiresAt,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logWarn(`[approval-gate] request failed (${res.status}) — auto-approving`);
        return { decision: "approved" };
      }
      const data = (await res.json()) as { approvalId: string };
      approvalId = data.approvalId;
    } catch (err) {
      logWarn(`[approval-gate] request error — auto-approving: ${String(err)}`);
      return { decision: "approved" };
    }

    logWarn(
      `[approval-gate] waiting for ${kind} ${approvalId} (${opts.actionType}): ${opts.description}`,
    );

    return new Promise<HumanInputResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(approvalId);
        logWarn(`[approval-gate] ${kind} ${approvalId} timed out after ${timeoutMs / 1000}s`);
        resolve({ decision: "timeout" });
      }, timeoutMs);
      this.pending.set(approvalId, { resolve, timer });
    });
  }
}

/** Process-wide singleton. */
export const approvalGate = new ApprovalGate();

// ── Module-level shims (backward-compatible API) ──────────────────────────────

export function initApprovalGate(opts: { baseUrl: string; agentNodeId: string; apiKey: string }): void {
  approvalGate.init(opts);
}

export function resolveApproval(approvalId: string, decision: HumanDecision, responseText?: string): void {
  approvalGate.resolve(approvalId, decision, responseText);
}

/**
 * Request human approval for a high-risk action. Backward-compatible wrapper that
 * returns just the approve/reject/timeout decision (an 'answered' question, which
 * this path never sends, is reported as 'approved').
 */
export async function requestApproval(opts: {
  actionType: string;
  description: string;
  metadata?: unknown;
  timeoutMs?: number;
}): Promise<ApprovalDecision> {
  const result = await approvalGate.request({ ...opts, kind: "approval" });
  return result.decision === "answered" ? "approved" : result.decision;
}

/** Request any kind of human input (approval / question / feedback). */
export async function requestHumanInput(opts: HumanInputRequest): Promise<HumanInputResult> {
  return approvalGate.request(opts);
}
