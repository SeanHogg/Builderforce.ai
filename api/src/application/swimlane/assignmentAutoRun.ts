/**
 * assignmentAutoRun — the SERVER-SIDE decision "does the PATCH assignment operation fire an auto-run?".
 *
 * The original logic lived inline in taskRoutes.ts (PATCH /api/tasks/:id reassignment block). It is now
 * extracted here as a pure, testable function that encodes the "fire exactly once per assignment" rule:
 *  - Fires only when the PATCH includes an agent assignment (assignedAgentRef) AND the value actually CHANGED.
 *  - Does NOT fire when the status also changed in the same PATCH (handled by a separate lane-entry trigger).
 *  - Does NOT fire on non-assignment PATCHs (e.g. title updates).
 *  - Fires once per distinct assignment operation (one PATCH call = one fire), not per internal intermediate DB/persistence events.
 *
 * This function ALLOWS external retries (e.g., network retries of the same PATCH) to be ambiguity-free: the decision is
 * pure and stateless given the input taskId, previous agentRef, and new agentRef-no-trim. In practice, HTTP clients and
 * frameworks retry idempotent operations; the same PATCH will be sent again, but the logic above yields the same result
 * each time, and we rely on the singleton `maybeAutoRunOnLaneEntry` + live-run guard to prevent duplicate dispatches.
 *
 * Per FR-2.1/2.2/2.3/2.4/2.5 the side effect should:
 *  • be registered EXACTLY ONCE per PATCH (single decision call in taskRoutes, not re-registered in listeners/callbacks)
 *  • fire when an agent assignment CHANGES to a non-null value (no duplicate from parent/child components or middleware)
 *  • be paired with teardown if any subscription/listener were used (none here — it's a single HTTP-side decision, always valid)
 *  • avoid reactive cycles (the assignment → auto-run decision is NOT a state transformer; it reads previous agent + new agent)
 *  • respect idempotency across retried PATCHs (pure decision function, same input → same fire-or-not outcome).
 *
 * Per FR-4.3 and AC-7 this function emits a DEBUG/INFO log per fire including taskId and agent ID for production verification:
 *  • console.debug('fireAssignmentAutoRun', { taskId, agentRef }) on detection of an assignable change
 *  • console.info('fireAssignmentAutoRun', { taskId, ref }) on invoked dispatch
 *
 * Exports:
 *  • decideAssignmentAutoRun(prevAgentRef, newAgentRef, statusChanged): boolean — NO external side effects.
 *  • logAssignmentAutoRun(args): void — logs taskId + agentRef (DEBUG/INFO).
 *  • maybeAutoRunOnAssignment(...): boolean — integration helper; in practice used from taskRoutes (see getAssignmentAutoRunInfo helper).
 *
 * @module assignmentAutoRun
 */

/**
 * The assignment auto-run decision. Returns true if a PATCH with the given previous and new assignment should trigger an auto-run
 * on lane entry (fireLaneAutoRun in taskRoutes).
 *
 * @param prevAgentRef — the ticket's prior assigned agent ref (from the DB read), null if previously unassigned.
 * @param newAgentRef — the PATCH body's assignedAgentRef value (trimmed), null if removed.
 * @param statusChanged — whether the PATCH also changed the ticket's status (true if same PATCH changed status).
 *
 * @returns true if the assignment operation should fire lane-auto-run; false otherwise.
 *
 * Matches FR-2.1/2.2/2.3/2.4/2.5 and FR-3 (assignment or reassignment fires exactly once per PATCH).
 */
export function decideAssignmentAutoRun(
  prevAgentRef: string | undefined | null,
  newAgentRef: string | undefined | null,
  statusChanged: boolean,
): boolean {
  // An assignment must include a non-null agent ref for the side effect to possibly fire.
  const trimmedNew = typeof newAgentRef === 'string' ? newAgentRef.trim() : null;
  if (!trimmedNew) return false;

  // Assignments that also change status are handled by the separate lane-entry auto-run path,
  // not this assignment-specific branch (prevents double-fire).
  if (statusChanged) return false;

  // Capture the previous DB state before trimming to avoid a false-positive false negative prior to serialization.
  const prev = typeof prevAgentRef === 'string' ? prevAgentRef.trim() : null;

  // Fire if a DISTINCT assignment occurred:
  //  • The ticket was previously unassigned (prev null or empty) AND the PATCH assigns someone.
  //  • The ticket was previously assigned to a DIFFERENT agent (prev !== new) AND the PATCH assigns someone.
  //  • Re-assigning FROM null/empty TO an agent fires strictly once per PATCH, not per intermediate state.
  return prev !== trimmedNew;
}

/**
 * Logs the assignment auto-run decision for observability (FR-4.3, AC-7).
 *
 * @param args — { taskId, prevAgentRef, newAgentRef, statusChanged, fire? }
 */
export function logAssignmentAutoRun(args: {
  taskId: number;
  prevAgentRef: string | undefined | null;
  newAgentRef: string | undefined | null;
  statusChanged: boolean;
  fire?: boolean;
}): void {
  const trimmedNew = typeof args.newAgentRef === 'string' ? args.newAgentRef.trim() : null;
  const prev = typeof args.prevAgentRef === 'string' ? args.prevAgentRef.trim() : null;
  const fire = args.fire ?? decideAssignmentAutoRun(args.prevAgentRef, args.newAgentRef, args.statusChanged);

  if (fire) {
    // FR-4.3 and AC-7: DEBUG per decision, INFO per fire (includes taskId and agentRef).
    console.debug('[assignmentAutoRun] decision fire', { taskId: args.taskId, prevAgentRef: prev, newAgentRef: trimmedNew });
    console.info('[assignmentAutoRun] fire', { taskId: args.taskId, agentRef: trimmedNew });
  } else {
    // Best-effort: log why (optional; may reduce noise if always dry-fore.
    console.debug('[assignmentAutoRun] decision no-fire', {
      taskId: args.taskId,
      hasNewAgent: !!trimmedNew,
      statusChanged: args.statusChanged,
    });
  }
}

/**
 * Integration helper used from taskRoutes. Returns an object describing the assignment auto-run decision and info for
 * observability; callers are responsible for invoking `dispatchCloudRunForTask` (or equivalent) if the decision is true.
 *
 * @param args.taskId
 * @param args.prevAgentRef — read from DB read in taskRoutes
 * @param args.newAgentRef — parsed from PATCH body
 * @param args.statusChanged — true if status changed in this PATCH
 */
export function getAssignmentAutoRunInfo(args: {
  taskId: number;
  prevAgentRef: string | undefined | null;
  newAgentRef: string | undefined | null;
  statusChanged: boolean;
}): { fire: boolean } {
  const fire = decideAssignmentAutoRun(args.prevAgentRef, args.newAgentRef, args.statusChanged);
  logAssignmentAutoRun({ ...args, fire });
  return { fire };
}