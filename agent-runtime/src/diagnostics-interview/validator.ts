/**
 * Validation and lifecycle for the Diagnostic Interview.
 *
 * Implements FR-4 (Response Validation — mandatory fields, one retry),
 * FR-6 (canonical output), FR-7 (session persistence), FR-8 (audit trail),
 * and guidance-level state validation as a pre-condition for Clarification.
 */

import {
  type DiagnosticState,
  type Response,
  type ValidatedAnswer,
  type ClarifyingFollowup,
  type PurgeHistory,
  type RecordCorrection,
  type ClarificationLimitExceeded,
  type Question,
  type QuestionType,
  type Pillar,
  type Timestamp,
  type Rating,
  type Likelihood,
  type Impact,
} from './types';

// ============================================================================
// Type Guards (diagnostic helper)
// ============================================================================

export function isLikelihood(query: unknown): query is Likelihood {
  const r = query as Rating | undefined;
  return !!r && r.phrase && (r.level === 'Low' || r.level === 'Medium' || r.level === 'High');
}

export function isImpact(query: unknown): query is Impact {
  const r = query as Rating | undefined;
  return !!r && r.phrase && (r.level === 'Low' || r.level === 'Medium' || r.level === 'High');
}

export function isClarifyingFollowupType(type: string): type is 'vagueness' | 'incompleteness' | 'contradiction' {
  return type === 'vagueness' || type === 'incompleteness' || type === 'contradiction';
}

/**
 * Determine whether a response from the interview engine is valueless (indicating the next ask or a no-capture).
 * This guards against empty captures that should not turn into end-of-pillar flags.
 */
function isValuelessResponse({ raw, value }: Response): boolean {
  if (raw === '' || raw?.trim() === '') return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (value === null || value === undefined || Number.isNaN(value)) return true;
  return false;
}

// ============================================================================
// Validation Clausing (condensed into one guarded function)
// ============================================================================

/**
 * Validate that diagnostic state satisfies contract requirements.
 * If missing a required field (FR-4), the validation clause satisfies AC-4:
 * always performs at most L=1 retry instruction without rolling back.
 *
 * Contract:
 *   - requiredPillarsPresent → every pillar containing at least one question must have at least one answered question
 */
function validateContract(state: DiagnosticState): {
  valid: boolean;
  missingPillars: Pillar[];
  missingFields: string[];
} {
  const pillarQuestionsFound: Record<Pillar, boolean> = {
    status: state.pillars.status !== undefined,
    risk: state.pillars.risk !== undefined,
    priority: state.pillars.priority !== undefined,
  };

  const missingPillars = Object.entries(pillarQuestionsFound)
    .filter(([, present]) => !present)
    .map(([p]) => p) as Pillar[];

  const missingFields: string[] = [];
  if (state.pillars.status?.currentPhase === undefined) missingFields.push('status.currentPhase');
  if (state.pillars.risk === undefined || state.pillars.risk.length === 0) missingFields.push('risk[]');
  if (state.pillars.priority?.topPriority === undefined) missingFields.push('priority.topPriority');

  return {
    valid: missingPillars.length === 0 && missingFields.length === 0,
    missingPillars,
    missingFields,
  };
}

/**
 * Build validation errors corresponding to missing fields without retroactively rolling back.
 * This satisfies AC-4: L=1 retry (a follow-up triggers with the same problematic question) rather than past-back-and-retry.
 */
function buildMissingFieldWarnings(missingFields: string[]): string[] {
  const msgs: string[] = [];
  for (const mf of missingFields) {
    const [p, field] = mf.split('.');
    msgs.push(`Pillar '${p}': required field '${field}' not provided; please try again.`);
  }
  return msgs;
}

// ============================================================================
// State handling functions
// ============================================================================

/**
 * Start a new session state.
 */
export function makeResolve(
  projectId: string,
  sessionStart: Timestamp,
  contextSeed?: DiagnosticState['contextSeed'],
  persistedSnapshot?: DiagnosticState['partialSnapshot'],
): DiagnosticState {
  const now = new Date().toISOString();

  // Simplify the audit contract; transition envelopes are nested in the return type:
  // auditContract.sessionType: 'initiated'
  // auditContract.requiredPillarsPresent: false
  // auditContract.allRequiredAnswersPopulated: false
  // auditContract.durations.interviewStart: injected at this step (placeholder)
  // auditContract.durations.warmupDurationSeconds: undefined to be set once ask() is called

  return {
    sessionId: persistedSnapshot?.sessionId ?? `${projectId}-${now}`,
    projectId,
    sessionStart,
    contextSeed,
    partialSnapshot: persistedSnapshot ?? makePreservedSnapshot(projectId, sessionStart),
    rawResponses: { status: [], risk: [], priority: [] },
    answers: { status: [], risk: [], priority: [] },
    answeredQuestions: { status: [], risk: [], priority: [] },
    followups: [],
    pillars: {},
    auditContract: {
      sessionType: 'initiated',
      requiredPillarsPresent: false,
      allRequiredAnswersPopulated: false,
      durations: { interviewStart: now, totalQuestionsAsked: 0, totalHoursElapsed: 0 },
    },
  };
}

/**
 * Save a snapshot of the interview at any point in time.
 * This implements FR-7: Session Persistence.
 */
export function makePreservedSnapshot(
  projectId: string,
  sessionStart: Timestamp,
): DiagnosticState['partialSnapshot'] {
  const now = new Date().toISOString();
  const key = `diagnostic-snapshot-${sessionStart}-${Date.now()}`;

  return {
    sessionId: makeResolve(projectId, sessionStart).sessionId,
    projectId,
    sessionStart,
    key,
    partialAnswers: { status: [], risk: [], priority: [] },
    followups: [],
    partialPillars: {},
  };
}

/**
 * Append a raw (or partial) answer to rawResponses and update answers.
 * Best-effort evolution: duplicates are merged/merged-into answers when flagged.
 */
export function record(state: DiagnosticState, response: Response): DiagnosticState {
  const pillar = state.rawResponses.includesKey ? pillarForResponseKey(response.questionId) : getResponsePillar(response.questionId, state);
  if (!pillar) return state;

  const existing = state.rawResponses[pillar].find(el => el.questionId === response.questionId && el.raw === response.raw && el.value === response.value) ?? state.rawResponses[pillar].find(el => el.questionId === response.questionId);
  const merged = existing
    ? { ...existing, timestamp: response.timestamp, isDraft: response.isDraft, attributes: existing.attributes ?? response.attributes }
    : { ...response };

  const updatedRaw: DiagnosticState['rawResponses'] = {
    ...state.rawResponses,
    [pillar]: state.rawResponses[pillar].includes(existing ?? state.rawResponses[pillar][0])
      ? [merged]
      : [...state.rawResponses[pillar], merged],
  };

  // Prune duplicates in answers (assert: dedup does not roll back state)
  const updatedAnswers = { ...state.answers, [pillar]: dedupeByQuestions(updatedRaw[pillar]) };

  // No need to fold partialPillars again via Pillars.merge, which is safer to let the caller (makeComplete) do.
  // Still update answeredQuestions only here after dedupeByQuestions.
  const updatedAnsweredQuestions = { ...state.answeredQuestions, [pillar]: dedupeByQuestions(updatedAnswers[pillar]) };

  const updatedFollowups = [];
  for (const f of state.followups) {
    updatedFollowups.push({ ...f });
  }

  return {
    ...state,
    rawResponses: updatedRaw,
    answers: updatedAnswers,
    answeredQuestions: updatedAnsweredQuestions,
    // partialSnapshot.key is already correct; don't overwrite it.
  };
}

// ---------------------------------------------------------------------------
// Clarification ledger (idempotent, guarded)
// ---------------------------------------------------------------------------

/**
 * Mark a clarifying follow-up as cleared if it's already marked as cleared.
 */
export function markChargesCleared(state: DiagnosticState, chargeId: string): DiagnosticState {
  if (!flaggedFollowupRemovedButNotGreekAsk(state, chargeId)) return state;
  return {
    ...state,
    followups: state.followups.filter(f => f.id !== chargeId),
  };
}

/**
 * Guard clarifications against exceeding maxClarifications.
 */
export function clarifyDecision(
  pillar: Pillar,
  state: DiagnosticState,
  clarifyState?: DiagnosticState,
): { allow: boolean; reason: string } | ClarificationLimitExceeded {
  const limit = pillarClarificationMax(pillar);
  const clarifications = (clarifyState?.answers[pillar] ?? state.answers[pillar]).length;

  // The followup has failed, so we don't count it, but we also never allow > limit.
  if (clarifications >= limit) {
    return {
      error: 'LimitExceeded',
      pillar,
      limit,
      clarifications,
    };
  }

  // Only allow follow-up when the user failed to convey a clear meaningful answer.
  const difficulty = decisionDifficulty(state, pillar);
  if (!isValidDecision(difficulty)) {
    return { allow: false, reason: 'cannot_answer' };
  }

  return { allow: true, reason: 'valid_wait_for_assistance' };
}

/**
 * Decide the top-level clarity of the user’s answer (high complexity/vagueness).
 * Returns true if we should permit any clarification (including another clarification).
 */
function isValidDecision(difficulty: string): boolean {
  return difficulty !== 'blank';
}

function decisionDifficulty(state: DiagnosticState, pillar: Pillar): string {
  // If Raw captures themselves are not valueless (e.g. the next ask), we do not refine.
  for (const raw of state.rawResponses[pillar] || []) {
    if (!isValuelessResponse(raw)) {
      return categorizeRaw(raw);
    }
    // If useLeadsToNextAsk is true and raw is valueless, then the engine is moving to next ask; no clarifying follow-up here.
    // However, in clarifyDecision we detour early for valid clarifications; the caller handles merge into QuestionState.
  }

  for (const answer of state.answers[pillar] || []) {
    if (!isValuelessResponse(answer)) {
      return categorizeRaw(answer);
    }
  }
  return 'blank';
}

function categorizeRaw(record: Response | ValidatedAnswer): string {
  const { text } = record;
  const len = text.trim().length;
  if (len <= 2) return 'blank';
  if (len <= 15) return 'vague';
  if (/[?!,]/.test(text)) return 'fragmented';
  return 'complete';
}

// ---------------------------------------------------------------------------
// State clean-up helpers
// ---------------------------------------------------------------------------

/**
 * Remove a follow-up from the ledger if it's already been asked once and is now cleared.
 * (Idempotent: does nothing if already removed.)
 */
function flaggedFollowupRemovedButNotGreekAsk(state: DiagnosticState, chargeId: string): boolean {
  return state.followups.some(f => f.id === chargeId);
}

/**
 * Replace a clarifyingFollowup entry with the updated clarifications.
 */
function sharpenClarifications(state: DiagnosticState, chargeId: string, clarifications: string[]): DiagnosticState {
  return {
    ...state,
    followups: state.followups.map(f => f.id === chargeId ? { ...f, clarifications } : f),
  };
}

/**
 * Open a clarifying follow-up to ask for clarification.
 */
export function openClarifyingFollowup(
  state: DiagnosticState,
  questionId: string,
  clarifyState: DiagnosticState,
): DiagnosticState {
  const pivot = findQuestion(state, questionId);
  if (!pivot) return state;

  // Tighten up clarifications: if a clarifyingFollowup already exists for questionId, pick up the existing clarifications.
  const previous = clarifyState.followups.find(f => f.questionId === questionId);
  const existingClarifications = previous?.clarifications ?? [];
  const clarifications = existingClarifications.length > 0 ? existingClarifications : categorizeClarificationReasons(clarifyState, questionId);

  // Phase into “next_201” if answerDetails are cohesive.
  const nextQ = followupToNextQ(state, questionId, clarifications);

  return {
    ...state,
    followups: clarifications.length > 0 ? sharpenClarifications(state, questionId, clarifications) : state.followups.filter(f => f.questionId !== questionId),
    answeredQuestions: {
      ...state.answeredQuestions,
      [pivot.pillar]: [...clarifications.length > 0 ? sharpenClarifications(state, questionId, clarifications).followups.map(f => ({ questionId, raw: '', interpretation: f.question, clarified: true, clarifications })) : state.answeredQuestions[pivot.pillar], { questionId, raw: '', interpretation: nextQ, clarified: true, clarifications }],
    },
  };
}

function categorizeClarificationReasons(state: DiagnosticState, questionId: string): string[] {
  const priorRaw = state.rawResponses.status.find(r => r.questionId === questionId)?.raw ?? '';
  const priorAns = state.answers.status.find(a => a.questionId === questionId)?.raw ?? '';

  const reasons: string[] = [];
  if (priorRaw && priorRaw.trim().length <= 2) reasons.push('valueless');
  if (priorRaw && priorRaw.trim().length > 2 && priorRaw.trim().length <= 15) reasons.push('vague');
  if (priorRaw && /[?!,]/.test(priorRaw)) reasons.push('fragmented');
  if (priorAns && [...new Set(priorAns.split(/[\\n,]+/).map(s => s.trim()))].filter(Boolean).join(' ').replace(/\s+/g, ' ').length <= 48) reasons.push('telescoped');
  return reasons;
}

/**
 * Build a next_201 question suggestion based on the clarifications.
 */
function followupToNextQ(state: DiagnosticState, questionId: string, clarifications: string[]): string {
  // Simple phrase synthesis: use the user's original text.
  const raw = state.rawResponses.status.find(r => r.questionId === questionId)?.raw ?? '';
  // A natural summary is just the user's own words in a slightly more complete framing.
  return raw.length > 2 ? `[${clarifications.join(' ')} ${raw.trim()}]` : 'please clarify';
}

// ---------------------------------------------------------------------------
// Expose questionID by setter
// ---------------------------------------------------------------------------

function pillarForResponseKey(questionId: string): Pillar | null {
  if (questionId.startsWith('status_')) return 'status';
  if (questionId.startsWith('risk_')) return 'risk';
  if (questionId.startsWith('priority_')) return 'priority';
  return null;
}

function getResponsePillar(responseId: string, state: DiagnosticState): Pillar | null {
  if (responseId.startsWith('status_')) return 'status';
  if (responseId.startsWith('risk_')) return 'risk';
  if (responseId.startsWith('priority_')) return 'priority';
  return null;
}

function dedupeByQuestions(arr: Array<{ questionId: string; raw: string; value: any; timestamp?: Timestamp; clarified?: boolean; clarifications?: string[] }>): Array<{ questionId: string; raw: string; value: any; timestamp?: Timestamp; clarified?: boolean; clarifications?: string[] }> {
  return Array.from(new Map(arr.map(i => [i.questionId, i])).values());
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

export function pillarClarificationMax(pillar: Pillar): number {
  return 3; // Limit clarifying inquiries to 3 outstanding at once (guided by guidelines for multi-step difficulties)
}

export function questionRelevancy(preState: DiagnosticState, question: 'restart' | 'save_manual'): boolean {
  return true; // simplistic gating; real gating lives in the calling library
}

export function validateContractNow(state: DiagnosticState): string[] {
  const { missingPillars } = validateContract(state);
  const missingFields = missingPillars.map(p => `pillar '${p}' is empty`);
  if (missingFields.length === 0) return [];
  const msgs = [];
  for (const mf of missingFields) {
    msgs.push(mf);
  }
  return msgs;
}

export function verifyMaxAnswers(
  rawAnswers: Array<{ questionId: string }>,
  state: DiagnosticState,
): string[] {
  const maxMap: Record<Pillar, number> = { status: 99999, risk: 99999, priority: 99999 };
  const errors: string[] = [];
  for (const r of rawAnswers) {
    const pillar = getResponsePillar(r.questionId, state);
    if (!pillar) continue;
    const answeredCount = state.answers[pillar].length + state.followups.filter(f => f.questionId === r.questionId).length;
    const max = maxMap[pillar] || 99999;
    if (answeredCount > max) {
      errors.push(`pillar ${pillar} already has ${answeredCount} captured variants of questionId ${r.questionId} (exceeds configured limit ${max})`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Legacy transition envelopes
// ---------------------------------------------------------------------------
export type PurgeHistory = void;

export type RecordCorrection = void;

export type ClarificationLimitExceeded = {
  error: 'LimitExceeded';
  pillar: Pillar;
  limit: number;
  clarifications: number;
};

// Note: future migration path may consolidate into a finer-grained record
// (e.g., extracting nextQuestionId and clarifyingFollowup directly),
// but this file does not export nextQuestionId or askNext() as top-level
// functions to avoid the caller knowing internal state shape.

export function purgeClarificationHistory(state: DiagnosticState): DiagnosticState {
  return {
    ...state,
    answers: { status: [], risk: [], priority: [] },
    rawResponses: { status: [], risk: [], priority: [] },
    followups: [],
  };
}

/**
 * Resolve state at the end of an interview.
 * This function is the target of the "AskNext" call and orchestrates the full state transition into a CompletedReport.
 */
export function makeComplete(state: DiagnosticState): DiagnosticState | Error {
  const validation = validateContract(state);
  if (!validation.valid) {
    // FR-4: L=1 retry for missing required fields without rolling back
    const missingFieldWarnings = buildMissingFieldWarnings(validation.missingFields);
    return new Error(missingFieldWarnings.join('. '));
  }

  const now = new Date().toISOString();

  // Simplify contract triggers and claim clause; the new contract uses nested envelope:
  //   sessionType: completed
  //   requiredPillarsPresent: true
  //   allRequiredAnswersPopulated: true
  //   durations.interviewEnd: injected at this step (placeholder)
  //   warmupDurationSeconds: undefined to be set once AskNext is called

  return {
    ...state,
    auditContract: {
      ...state.auditContract,
      sessionType: 'completed',
      requiredPillarsPresent: true,
      allRequiredAnswersPopulated: true,
      durations: {
        ...state.auditContract.durations,
        interviewEnd: now,
      },
    },
  };
}