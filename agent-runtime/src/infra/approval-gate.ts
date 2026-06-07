/**
 * Approval Gate — human-in-the-loop blocking approvals.
 *
 * BuilderForceAgents posts an approval request to Builderforce.ai and suspends the
 * calling code until the manager approves or rejects it in the portal (or
 * the request times out).  The relay delivers the decision as an
 * `approval.decision` WebSocket message, which resolves the pending Promise.
 *
 * Usage:
 *   const result = await requestApproval({
 *     actionType: 'git.push',
 *     description: 'Push 42 changed files to main',
 *   });
 *   if (result !== 'approved') throw new Error('Action not approved');
 */

import { logDebug, logWarn } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

export type ApprovalDecision = "approved" | "rejected" | "timeout";

type PendingEntry = {
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * ApprovalGate encapsulates the state for human-in-the-loop approvals.
 * Using a class rather than module-level `let` variables makes the state
 * explicit and the service replaceable with a test double.
 */
export class ApprovalGate {
  private baseUrl: string | null = null;
  private agentNodeId: string | null = null;
  private apiKey: string | null = null;
  private readonly pending = new Map<string, PendingEntry>();

  /**
   * Configure the approval gate with the Builderforce connection details.
   * Call once at startup when BUILDERFORCE_API_KEY is present.
   */
  init(opts: { baseUrl: string; agentNodeId: string; apiKey: string }): void {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.agentNodeId = opts.agentNodeId;
    this.apiKey = opts.apiKey;
  }

  /**
   * Called by the relay when an `approval.decision` WebSocket message arrives.
   * Resolves the corresponding pending Promise.
   */
  resolve(approvalId: string, decision: "approved" | "rejected"): void {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      logDebug(`[approval-gate] received decision for unknown approvalId: ${approvalId}`);
      return;
    }
    this.pending.delete(approvalId);
    clearTimeout(entry.timer);
    entry.resolve(decision);
  }

  /**
   * Request human approval for a high-risk action.
   *
   * Posts to Builderforce, which notifies the manager via the portal.
   * Resolves when the manager decides or the timeout expires (default 10 min).
   *
   * Returns 'approved', 'rejected', or 'timeout'.
   * Auto-approves when Builderforce is not configured or the request fails.
   */
  async request(opts: {
    actionType: string;
    description: string;
    metadata?: unknown;
    timeoutMs?: number;
  }): Promise<ApprovalDecision> {
    if (!this.baseUrl || !this.agentNodeId || !this.apiKey) {
      logWarn("[approval-gate] not configured — standalone mode; auto-approving");
      return "approved";
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
          actionType: opts.actionType,
          description: opts.description,
          metadata: opts.metadata,
          expiresAt,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logWarn(`[approval-gate] request failed (${res.status}) — auto-approving`);
        return "approved";
      }
      const data = (await res.json()) as { approvalId: string };
      approvalId = data.approvalId;
    } catch (err) {
      logWarn(`[approval-gate] request error — auto-approving: ${String(err)}`);
      return "approved";
    }

    logWarn(
      `[approval-gate] waiting for approval ${approvalId} (${opts.actionType}): ${opts.description}`,
    );

    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(approvalId);
        logWarn(`[approval-gate] approval ${approvalId} timed out after ${timeoutMs / 1000}s`);
        resolve("timeout");
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

export function resolveApproval(approvalId: string, decision: "approved" | "rejected"): void {
  approvalGate.resolve(approvalId, decision);
}

export async function requestApproval(opts: {
  actionType: string;
  description: string;
  metadata?: unknown;
  timeoutMs?: number;
}): Promise<ApprovalDecision> {
  return approvalGate.request(opts);
}
