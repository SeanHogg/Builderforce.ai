/**
 * The phone side of a step's approval gate.
 *
 * `open` files a self-owned `synapse.step` approval on `/api/approvals` (the owner's
 * phone gets it), `answer` polls it every 3 s until it is decided, and `close` resolves
 * it from this side with the note "Answered in Synapse" when the person answered in the
 * editor first (or the wait ran out). The runner races `answer` against the in-window
 * prompt; the first answer wins.
 *
 * Active only while signed in AND `builderforce.agents.phoneApprovals` is on — both are
 * read through `isActive`, so toggling either takes effect on the next gate. HTTP goes
 * through the one approvals client (`bfApi/approvals.ts`), injected so this is testable.
 */

export const POLL_MS = 3000;
export const CLOSE_NOTE = "Answered in Synapse";

/** What the relay needs of the approvals client. */
export interface ApprovalsHttp {
  create(input: {
    actionType: string;
    description: string;
    metadata: Record<string, unknown>;
    expiresAt: string;
  }): Promise<{ approvalId: string }>;
  get(id: string): Promise<{ status: string }>;
  resolve(id: string, decision: "approve" | "reject", note: string): Promise<unknown>;
}

export interface RelayRequest {
  runId: string;
  skill: string;
  step: number;
  action: string;
  description: string;
  /** How long the approval stays answerable. */
  expiresInMs: number;
}

export interface PhoneApprovalRelay {
  /** The approval's id, or undefined when the relay is off or the post failed (reported). */
  open(req: RelayRequest): Promise<string | undefined>;
  /** true = approved, false = rejected or expired, undefined = stopped polling (aborted). */
  answer(approvalId: string, signal: AbortSignal): Promise<boolean | undefined>;
  /** Resolve it from this side. Best-effort: a failure is reported, never thrown. */
  close(approvalId: string, approved: boolean): Promise<void>;
}

export interface RelayDeps {
  http: ApprovalsHttp;
  /** Signed in and phone approvals on. */
  isActive(): boolean;
  now(): number;
  /** Resolves after `ms`, or early when `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  report(error: unknown, operation: string): void;
}

export function createPhoneApprovalRelay(deps: RelayDeps): PhoneApprovalRelay {
  return {
    async open(req) {
      if (!deps.isActive()) return undefined;
      try {
        const r = await deps.http.create({
          actionType: "synapse.step",
          description: req.description,
          metadata: { runId: req.runId, skill: req.skill, step: req.step, action: req.action },
          expiresAt: new Date(deps.now() + req.expiresInMs).toISOString(),
        });
        return r.approvalId;
      } catch (error) {
        deps.report(error, "phoneApprovals:open");
        return undefined;
      }
    },

    async answer(approvalId, signal) {
      while (!signal.aborted) {
        try {
          const { status } = await deps.http.get(approvalId);
          if (status === "approved") return true;
          if (status === "rejected" || status === "expired") return false;
        } catch (error) {
          // A blip must not end the wait; the next poll tries again.
          deps.report(error, "phoneApprovals:poll");
        }
        await deps.sleep(POLL_MS, signal);
      }
      return undefined;
    },

    async close(approvalId, approved) {
      try {
        await deps.http.resolve(approvalId, approved ? "approve" : "reject", CLOSE_NOTE);
      } catch (error) {
        deps.report(error, "phoneApprovals:close");
      }
    },
  };
}
