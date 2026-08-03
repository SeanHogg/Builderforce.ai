/**
 * StakeholderMapService — stakeholder alignment conflict detection and sign-off
 * state machine for the Stakeholder Alignment Diagnostic (#503).
 *
 * Pure domain logic: operates on in-memory inputs, returns results. No database
 * access, no notification delivery — persistence and event consumption belong to
 * the consuming layer.
 */
import { ValidationError } from '../shared/errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single stakeholder's P0-priority submission for a team. */
export interface StakeholderSubmission {
  stakeholderId: string;
  teamId: string;
  p0Priority: string;
  submittedAt: Date;
}

/** One group of stakeholders whose submitted P0s conflict. */
export interface PriorityConflict {
  stakeholderIds: string[];
  priorities: string[];
}

/** Output of {@link StakeholderMapService.detectConflicts}. */
export interface ConflictDetectionResult {
  hasConflict: boolean;
  conflicts: PriorityConflict[];
}

export enum SignOffState {
  Pending = 'Pending',
  Approved = 'Approved',
  ApprovedWithComment = 'ApprovedWithComment',
  Blocked = 'Blocked',
}

export enum SignOffAction {
  Approve = 'Approve',
  ApproveWithComment = 'ApproveWithComment',
  Block = 'Block',
}

/** A single transition recorded in the sign-off audit trail. */
export interface SignOffTransition {
  from: SignOffState;
  to: SignOffState;
  action: SignOffAction;
  timestamp: Date;
  actorId?: string;
  comment?: string;
}

/** Event emitted when a transition triggers escalation. */
export interface EscalationEvent {
  type: 'Escalation';
  fromState: SignOffState;
  triggeredAt: Date;
  reason: string;
  actorId?: string;
}

/**
 * A fully-instantiated sign-off that carries its own mutable state and
 * transition history. Returned by {@link StakeholderMapService.createSignOff}.
 */
export class StakeholderSignOff {
  private _state: SignOffState;
  private _comment: string | undefined;
  private readonly _history: SignOffTransition[] = [];

  constructor(
    public readonly mapId: string,
    initialState: SignOffState = SignOffState.Pending,
    history: SignOffTransition[] = [],
    comment?: string,
  ) {
    this._state = initialState;
    this._comment = comment;
    this._history = [...history];
  }

  get state(): SignOffState { return this._state; }
  get comment(): string | undefined { return this._comment; }
  get history(): readonly SignOffTransition[] { return this._history; }

  // -- transition helpers ------------------------------------------------

  /** Transition to Approved. Rejected if the current state is not Pending. */
  approve(actorId?: string): EscalationEvent | null {
    this.assertTransition(SignOffAction.Approve);
    this.recordTransition(SignOffState.Approved, SignOffAction.Approve, actorId);
    return null;
  }

  /** Transition to ApprovedWithComment. Rejected if not Pending. */
  approveWithComment(comment: string, actorId?: string): EscalationEvent | null {
    if (!comment.trim()) throw new ValidationError('Comment is required for ApproveWithComment');
    this.assertTransition(SignOffAction.ApproveWithComment);
    this._comment = comment.trim();
    this.recordTransition(SignOffState.ApprovedWithComment, SignOffAction.ApproveWithComment, actorId, this._comment);
    return null;
  }

  /** Transition to Blocked. Rejected if not Pending. Returns an EscalationEvent. */
  block(reason?: string, actorId?: string): EscalationEvent {
    this.assertTransition(SignOffAction.Block);
    this.recordTransition(SignOffState.Blocked, SignOffAction.Block, actorId);
    return {
      type: 'Escalation',
      fromState: SignOffState.Blocked,
      triggeredAt: new Date(),
      reason: reason ?? 'Sign-off blocked — automatic escalation triggered',
      actorId,
    };
  }

  // -- internal ----------------------------------------------------------

  private assertTransition(action: SignOffAction): void {
    const allowed = ALLOWED_TRANSITIONS[this._state];
    if (!allowed || !allowed.includes(action)) {
      throw new ValidationError(
        `Invalid transition: ${this._state} → ${action} is not allowed. ` +
        `Valid actions from ${this._state}: ${allowed?.join(', ') ?? 'none'}.`,
      );
    }
  }

  private recordTransition(
    to: SignOffState,
    action: SignOffAction,
    actorId?: string,
    comment?: string,
  ): void {
    const from = this._state;
    this._state = to;
    this._history.push({ from, to, action, timestamp: new Date(), actorId, comment });
  }
}

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<SignOffState, SignOffAction[] | undefined> = {
  [SignOffState.Pending]: [
    SignOffAction.Approve,
    SignOffAction.ApproveWithComment,
    SignOffAction.Block,
  ],
  // Terminal states: no transitions allowed.
  [SignOffState.Approved]: undefined,
  [SignOffState.ApprovedWithComment]: undefined,
  [SignOffState.Blocked]: undefined,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Pure domain service for stakeholder alignment.
 *
 * Usage:
 * ```ts
 * const service = new StakeholderMapService();
 * const result = service.detectConflicts({ teamId, submissions, reviewWindowStart, reviewWindowEnd });
 * const signOff = service.createSignOff('map-1');
 * ```
 */
export class StakeholderMapService {
  /**
   * Detect P0-priority conflicts among stakeholder submissions for a team
   * within a review window.
   *
   * A conflict exists when two or more distinct P0 values are submitted by
   * different stakeholders for the same team during the review window.
   */
  detectConflicts(input: {
    teamId: string;
    submissions: StakeholderSubmission[];
    reviewWindowStart: Date;
    reviewWindowEnd: Date;
  }): ConflictDetectionResult {
    const { teamId, submissions, reviewWindowStart, reviewWindowEnd } = input;

    // Filter to submissions for this team within the review window.
    const inWindow = submissions.filter(
      (s) =>
        s.teamId === teamId &&
        s.submittedAt >= reviewWindowStart &&
        s.submittedAt <= reviewWindowEnd,
    );

    // Group submissions by stakeholder (latest per stakeholder wins).
    const latestByStakeholder = new Map<string, StakeholderSubmission>();
    for (const s of inWindow) {
      const existing = latestByStakeholder.get(s.stakeholderId);
      if (!existing || s.submittedAt > existing.submittedAt) {
        latestByStakeholder.set(s.stakeholderId, s);
      }
    }

    if (latestByStakeholder.size < 2) {
      return { hasConflict: false, conflicts: [] };
    }

    // Collect the set of distinct P0 values.
    const p0ToStakeholders = new Map<string, string[]>();
    for (const s of latestByStakeholder.values()) {
      const key = s.p0Priority;
      const arr = p0ToStakeholders.get(key) ?? [];
      arr.push(s.stakeholderId);
      p0ToStakeholders.set(key, arr);
    }

    if (p0ToStakeholders.size <= 1) {
      return { hasConflict: false, conflicts: [] };
    }

    // Build conflict groups: every combination that shares a team but not a P0.
    // Each pair of distinct P0 values → one conflict entry.
    const priorities = [...p0ToStakeholders.keys()];
    const conflicts: PriorityConflict[] = [];
    for (let i = 0; i < priorities.length; i++) {
      for (let j = i + 1; j < priorities.length; j++) {
        conflicts.push({
          stakeholderIds: [
            ...(p0ToStakeholders.get(priorities[i]) ?? []),
            ...(p0ToStakeholders.get(priorities[j]) ?? []),
          ],
          priorities: [priorities[i], priorities[j]],
        });
      }
    }

    return { hasConflict: true, conflicts };
  }

  /**
   * Create a new sign-off instance for a stakeholder map. Starts in `Pending`.
   */
  createSignOff(mapId: string): StakeholderSignOff {
    return new StakeholderSignOff(mapId);
  }

  /**
   * Reconstitute a sign-off from persisted state (e.g. loaded from the DB).
   */
  reconstituteSignOff(
    mapId: string,
    state: SignOffState,
    history: SignOffTransition[],
    comment?: string,
  ): StakeholderSignOff {
    return new StakeholderSignOff(mapId, state, history, comment);
  }

  /**
   * Apply an action to a sign-off and return the escalation event (if any)
   * plus the updated sign-off.
   */
  applyAction(
    signOff: StakeholderSignOff,
    action: SignOffAction,
    payload?: { comment?: string; actorId?: string; reason?: string },
  ): { signOff: StakeholderSignOff; escalation?: EscalationEvent } {
    const { comment, actorId, reason } = payload ?? {};
    let escalation: EscalationEvent | null = null;

    switch (action) {
      case SignOffAction.Approve:
        escalation = signOff.approve(actorId);
        break;
      case SignOffAction.ApproveWithComment:
        escalation = signOff.approveWithComment(comment ?? '', actorId);
        break;
      case SignOffAction.Block:
        escalation = signOff.block(reason, actorId);
        break;
      default:
        throw new ValidationError(`Unknown action: ${action}`);
    }

    return { signOff, escalation: escalation ?? undefined };
  }
}
