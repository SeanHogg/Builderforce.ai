import {
  GATED_ACTIONS,
  evaluateGate,
  grantApproval,
  pendingApprovals,
  readProvenance,
  refuseApproval,
  selfApprovalRefusal,
  type Actor,
  type ApprovalMode,
  type ProvenanceEntry,
} from '@/lib/canvasApprovalGate';

/**
 * THE APPROVAL INBOX — the read model and the one write the inbox makes.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * `canvasApprovalGate` decides, and the proposal stage records: every attributed
 * figure a tool moves lands on the object's trail as a change NOBODY HAS SIGNED. The
 * gate then refuses the object's gated acts until a named person stands behind it.
 * That was the whole mechanism with the one human step missing — there was nowhere a
 * person could see what was waiting and sign it, so the trail filled and the acts
 * stayed blocked. This is the inbox's arithmetic; the surfaces (the room's approval
 * desk and its 2D panel) render what it answers.
 *
 * ── WHY THE WRITE IS HERE AND NOT IN THE PANEL ───────────────────────────────
 * Approving is `grantApproval` over the SAME trail the gate reads, guarded by the
 * SAME separation-of-duties rule the gate applies (`selfApprovalRefusal`). A panel
 * that re-derived either would be a way round the gate, so the panel only asks this
 * for a patch and applies it through the board's ordinary edit path.
 */

export interface ApprovalBoardObject {
  id: string;
  data: Record<string, unknown>;
}

export interface ApprovalInboxItem {
  objectId: string;
  kind: string;
  title: string;
  /** Oldest first — the order the inbox reads them in. */
  pending: ProvenanceEntry[];
  /** The acts this kind gates — what a signature here unblocks. Empty for a kind that
   *  only attributes figures (a forecast) and gates nothing. */
  gatedActions: readonly string[];
  mode: ApprovalMode;
  /** When the oldest waiting change was made. */
  waitingSince: string;
}

const APPROVAL_MODES: readonly ApprovalMode[] = ['open', 'required', 'autonomous'];

/** The object's declared mode, defaulting to `required` exactly as the gate does. */
export function approvalModeOf(data: Record<string, unknown>): ApprovalMode {
  return (APPROVAL_MODES as readonly string[]).includes(String(data.approvalMode)) ? data.approvalMode as ApprovalMode : 'required';
}

/** Every object with a change waiting on a signature, longest-waiting first. */
export function approvalInboxOf(objects: readonly ApprovalBoardObject[]): ApprovalInboxItem[] {
  return objects
    .flatMap((object): ApprovalInboxItem[] => {
      const pending = pendingApprovals(object.data).sort((a, b) => a.at.localeCompare(b.at));
      if (!pending.length) return [];
      const kind = typeof object.data.kind === 'string' ? object.data.kind : '';
      const title = typeof object.data.title === 'string' ? object.data.title.trim() : '';
      return [{
        objectId: object.id,
        kind,
        title,
        pending,
        gatedActions: GATED_ACTIONS[kind] ?? [],
        mode: approvalModeOf(object.data),
        waitingSince: pending[0]!.at,
      }];
    })
    .sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
}

/** How many changes are waiting across the inbox — the desk's badge. */
export function pendingChangeCount(items: readonly ApprovalInboxItem[]): number {
  return items.reduce((total, item) => total + item.pending.length, 0);
}

export type ReviewVerdict = 'approve' | 'refuse';

export type ReviewOutcome =
  | { ok: true; patch: { provenance: ProvenanceEntry[] }; count: number }
  | { ok: false; reason: 'not-a-person' | 'nothing-pending' | 'self-approval'; message: string };

/**
 * The patch that records one person's verdict on everything waiting on an object.
 *
 * All-or-nothing per object, deliberately: the trail is a set of moves one act
 * depends on, and signing half of a rebalanced budget would unblock an act whose
 * other half nobody reviewed. Refusing is open to anyone who could approve — and to
 * the author, who may always withdraw their own change from review.
 */
export function reviewPendingChanges(
  data: Record<string, unknown>,
  reviewer: Actor,
  at: string,
  verdict: ReviewVerdict,
): ReviewOutcome {
  if (reviewer.kind !== 'human') {
    return { ok: false, reason: 'not-a-person', message: 'Only a person can review a change in the approval inbox.' };
  }
  const trail = readProvenance(data);
  const pending = pendingApprovals(data);
  if (!pending.length) return { ok: false, reason: 'nothing-pending', message: 'Nothing on this object is waiting on a signature.' };
  if (verdict === 'refuse') {
    return { ok: true, patch: { provenance: refuseApproval(trail, reviewer, at) }, count: pending.length };
  }
  const kind = typeof data.kind === 'string' ? data.kind : 'object';
  const refusal = selfApprovalRefusal(pending, reviewer, kind);
  if (refusal) return { ok: false, reason: 'self-approval', message: refusal };
  return { ok: true, patch: { provenance: grantApproval(trail, reviewer, at) }, count: pending.length };
}

/**
 * The gated acts THIS reviewer's signature would let go ahead right now.
 *
 * Asked of the gate itself rather than inferred, so "Approve and send" is offered
 * exactly when the gate would answer `approved` for this person — never for an
 * object in `open` mode (nothing to unblock) or one they authored entirely.
 */
export function actsUnblockedBy(data: Record<string, unknown>, reviewer: Actor): string[] {
  const kind = typeof data.kind === 'string' ? data.kind : '';
  const provenance = readProvenance(data);
  const mode = approvalModeOf(data);
  return (GATED_ACTIONS[kind] ?? []).filter((action) => {
    const verdict = evaluateGate({ kind, action, mode, actor: reviewer, provenance });
    return verdict.allowed && verdict.reason === 'approved';
  });
}
