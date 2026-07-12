/**
 * Validation, state transitions, and session persistence for the Diagnostic Interview.
 *
 * Implements:
 *   FR-3  Adaptive Follow-up (one clarifying follow-up, ≤2 consecutive on same topic)
 *   FR-4  Response Validation (mandatory fields; one retry if skipped)
 *   FR-7  Session Persistence (save mid-session, resume, retrieve by session ID)
 *   FR-8  Audit Trail (raw Q&A linked to final report)
 */

import {
  type DiagnosticState,
  type Response,
  type ValidatedAnswer,
  type ClarifyingFollowup,
  type Question,
  type Pillar,
  type Timestamp,
  type Rating,
  type PreservedSnapshot,
  type FrozenReport,
  RatingLevel,
  type ContextSeed,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 24-hour retention window in milliseconds (FR-7, AC-7). */
const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Max consecutive clarifying questions on the same topic (FR-3). */
const MAX_CLARIFICATIONS_PER_TOPIC = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function now(): Timestamp {
  return new Date().toISOString();
}

export function id(prefix = 'id'): EntityId {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export type EntityId = string;

export function pillarOfQuestionId(questionId: string): Pillar {
  if (questionId.startsWith('status_')) return 'status';
  if (questionId.startsWith('risk_')) return 'risk';
  if (questionId.startsWith('priority_')) return 'priority';
  return 'status';
}

export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

export function isVague(answer: ValidatedAnswer): boolean {
  const raw = String(answer.raw ?? '').trim();
  if (raw.length <= 2) return true;
  const words = raw.split(/\s+/).filter(Boolean).length;
  return words <= 2;
}

export function isIncomplete(answer: ValidatedAnswer, question: Question): boolean {
  if (question.type === 'rating') {
    return isBlank(answer.interpretation);
  }
  if (question.type === 'confirm') {
    return typeof answer.interpretation !== 'boolean';
  }
  return false;
}

/**
 * Parse a raw string into a Low/Medium/High Rating.
 */
function parseRating(raw: string): Rating | undefined {
  const lower = raw.toLowerCase();
  if (lower.includes('low') || lower.includes('1')) return { level: RatingLevel.Low, phrase: raw };
  if (lower.includes('medium') || lower.includes('med') || lower.includes('2')) {
    return { level: RatingLevel.Medium, phrase: raw };
  }
  if (lower.includes('high') || lower.includes('3')) return { level: RatingLevel.High, phrase: raw };
  return undefined;
}

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

export function makeState(
  projectId: string,
  opts?: {
    sessionId?: string;
    sessionStart?: Timestamp;
    contextSeed?: ContextSeed;
    partialSnapshot?: PreservedSnapshot;
  }
): DiagnosticState {
  const sessionStart = opts?.sessionStart ?? now();
  const sessionId = opts?.sessionId ?? id('diagnostic');
  const partialSnapshot: PreservedSnapshot = opts?.partialSnapshot ?? {
    sessionId,
    projectId,
    sessionStart,
    key: `snapshot-${sessionId}`,
    partialAnswers: { status: [], risk: [], priority: [] },
    followups: [],
    partialPillars: {},
  };

  return {
    sessionId,
    projectId,
    sessionStart,
    contextSeed: opts?.contextSeed,
    partialSnapshot,
    rawResponses: { status: [], risk: [], priority: [] },
    answers: { status: [], risk: [], priority: [] },
    answeredQuestions: { status: [], risk: [], priority: [] },
    followups: [],
    pillars: {},
    auditContract: {
      sessionType: opts?.partialSnapshot ? 'resumed' : 'initiated',
      requiredPillarsPresent: false,
      allRequiredAnswersPopulated: false,
      durations: {
        interviewStart: sessionStart,
        totalQuestionsAsked: 0,
        totalHoursElapsed: 0,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Response handling
// ---------------------------------------------------------------------------

export function recordAnswer(
  state: DiagnosticState,
  question: Question,
  raw: string
): DiagnosticState {
  const pillar = pillarOfQuestionId(question.id);
  const responseId = id('response');
  const response: Response = {
    id: responseId,
    questionId: question.id,
    raw,
    value: interpretRaw(question, raw),
    isDraft: false,
    timestamp: now(),
  };

  const validated: ValidatedAnswer = {
    questionId: question.id,
    raw,
    interpretation: response.value,
    timestamp: response.timestamp,
  };

  const nextRawResponses = { ...state.rawResponses, [pillar]: [...state.rawResponses[pillar], response] };
  const nextAnswers = { ...state.answers, [pillar]: upsertAnswer(state.answers[pillar], validated) };
  const nextAnsweredQuestions = { ...state.answeredQuestions, [pillar]: upsertAnswer(state.answeredQuestions[pillar], validated) };

  return {
    ...state,
    rawResponses: nextRawResponses,
    answers: nextAnswers,
    answeredQuestions: nextAnsweredQuestions,
    auditContract: {
      ...state.auditContract,
      durations: {
        ...state.auditContract.durations,
        totalQuestionsAsked: state.auditContract.durations.totalQuestionsAsked + 1,
      },
    },
  };
}

function upsertAnswer(list: ValidatedAnswer[], answer: ValidatedAnswer): ValidatedAnswer[] {
  const idx = list.findIndex(a => a.questionId === answer.questionId);
  if (idx === -1) return [...list, answer];
  const copy = [...list];
  copy[idx] = answer;
  return copy;
}

export function interpretRaw(question: Question, raw: string): unknown {
  const text = raw.trim();

  if (question.type === 'confirm') {
    const lower = text.toLowerCase();
    if (lower.startsWith('y') || lower === 'true' || lower === 'yes') return true;
    if (lower.startsWith('n') || lower === 'false' || lower === 'no') return false;
    return null;
  }

  if (question.type === 'rating') {
    const parsed = parseRating(text);
    if (parsed) return parsed;
    // Try multi-line: each line "name: likelihood/impact"
    const lines = text.split(/\n+/).filter(Boolean);
    const result: Record<string, { likelihood?: Rating; impact?: Rating }> = {};
    for (const line of lines) {
      const match = line.match(/^(.+?)[:\-–]\s*(low|medium|high)?\s*[\/\s]*\s*(low|medium|high)?/i);
      if (!match) continue;
      const name = match[1].trim();
      const l = match[2] ? parseRating(match[2]) : undefined;
      const i = match[3] ? parseRating(match[3]) : undefined;
      result[id('risk')] = { likelihood: l, impact: i };
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  if (question.type === 'sequential' || question.id === 'risk_top3') {
    // Split into separate risks by newline or bullet
    return text
      .split(/\n+|\s{2,}|\s*[–-]\s+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  if (question.id === 'status_completion') {
    // Extract numeric percentage or generic completion signal
    const pctMatch = text.match(/(\d+)\s*%/);
    if (pctMatch) {
      return { kind: 'percent', value: Number(pctMatch[1]), raw: text };
    }
    return { kind: 'text', value: text };
  }

  return text;
}

// ---------------------------------------------------------------------------
// Clarifications
// ---------------------------------------------------------------------------

export function shouldClarify(
  state: DiagnosticState,
  question: Question,
  answer: ValidatedAnswer
): ClarifyingFollowup | null {
  const pillar = pillarOfQuestionId(question.id);
  const priorFollowups = state.followups.filter(f => f.questionId === question.id).length;

  if (priorFollowups >= question.maxClarifications || priorFollowups >= MAX_CLARIFICATIONS_PER_TOPIC) {
    return null;
  }

  const reasonType: ClarifyingFollowup['type'] | null = classifyAnswer(question, answer);
  if (!reasonType) return null;

  const followup: ClarifyingFollowup = {
    questionId: question.id,
    id: id('followup'),
    rootQuestion: question.id,
    primaryReason: reasonType,
    question: makeClarifyingQuestion(question, reasonType),
    type: reasonType,
  };

  return followup;
}

function classifyAnswer(question: Question, answer: ValidatedAnswer): ClarifyingFollowup['type'] | null {
  if (question.required && isBlank(answer.interpretation)) return 'incompleteness';
  if (isVague(answer)) return 'vagueness';
  if (isIncomplete(answer, question)) return 'incompleteness';
  return null;
}

function makeClarifyingQuestion(question: Question, reason: ClarifyingFollowup['type']): string {
  if (reason === 'incompleteness') {
    return `I still need this: ${question.label ?? question.text}`;
  }
  return `Can you elaborate on: ${question.label ?? question.text}`;
}

export function addFollowup(state: DiagnosticState, followup: ClarifyingFollowup): DiagnosticState {
  return {
    ...state,
    followups: [...state.followups, followup],
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { valid: true }
  | { valid: false; missing: { pillar: Pillar; field: string; simplified: string }[] };

export function validateRequired(state: DiagnosticState): ValidationResult {
  const missing: { pillar: Pillar; field: string; simplified: string }[] = [];

  if (isBlank(state.pillars.status?.currentPhase)) {
    missing.push({
      pillar: 'status',
      field: 'status_phase',
      simplified: 'What phase is this project in?',
    });
  }

  if (!state.pillars.risk || state.pillars.risk.length === 0) {
    missing.push({
      pillar: 'risk',
      field: 'risk_top3',
      simplified: 'Please name at least one risk facing this project.',
    });
  }

  if (isBlank(state.pillars.priority?.topPriority)) {
    missing.push({
      pillar: 'priority',
      field: 'priority_top',
      simplified: 'What is the top priority for the next 1–2 weeks?',
    });
  }

  if (missing.length > 0) return { valid: false, missing };
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function saveSnapshot(state: DiagnosticState): PreservedSnapshot {
  const key = `snapshot-${state.sessionId}`;
  return {
    sessionId: state.sessionId,
    projectId: state.projectId,
    sessionStart: state.sessionStart,
    key,
    partialAnswers: state.answers,
    followups: state.followups,
    partialPillars: state.pillars,
  };
}

export function resumeFromSnapshot(snapshot: PreservedSnapshot, contextSeed?: ContextSeed): DiagnosticState {
  const started = new Date(snapshot.sessionStart).getTime();
  const elapsedHours = (Date.now() - started) / (1000 * 60 * 60);

  return {
    sessionId: snapshot.sessionId,
    projectId: snapshot.projectId,
    sessionStart: snapshot.sessionStart,
    contextSeed,
    partialSnapshot: snapshot,
    rawResponses: { status: [], risk: [], priority: [] },
    answers: snapshot.partialAnswers,
    answeredQuestions: snapshot.partialAnswers,
    followups: snapshot.followups,
    pillars: snapshot.partialPillars,
    auditContract: {
      sessionType: 'resumed',
      requiredPillarsPresent: false,
      allRequiredAnswersPopulated: false,
      durations: {
        interviewStart: snapshot.sessionStart,
        totalQuestionsAsked: 0,
        totalHoursElapsed: elapsedHours,
      },
    },
  };
}

export function isWithinRetention(state: DiagnosticState): boolean {
  const started = new Date(state.sessionStart).getTime();
  return Date.now() - started <= RETENTION_MS;
}

// ---------------------------------------------------------------------------
// Frozen report generator
// ---------------------------------------------------------------------------

export function freezeReport(state: DiagnosticState): FrozenReport | ValidationResult {
  const validation = validateRequired(state);
  if (!validation.valid) return validation;

  const completedAt = now();
  const elapsedHours = (new Date(completedAt).getTime() - new Date(state.sessionStart).getTime()) / (1000 * 60 * 60);

  return {
    sessionId: state.sessionId,
    projectId: state.projectId,
    sessionStart: state.sessionStart,
    interviewCompletedAt: completedAt,
    contextSeed: state.contextSeed,
    pillars: state.pillars,
    conflictSet: state.conflictSet,
    recommendations: state.recommendations,
    healthScore: state.healthScore,
    durations: {
      interviewStart: state.auditContract.durations.interviewStart,
      interviewEnd: completedAt,
      totalQuestionsAsked: state.auditContract.durations.totalQuestionsAsked,
      totalHoursElapsed: elapsedHours,
    },
    rawResponses: state.rawResponses,
    rawAnswers: state.answeredQuestions,
    followups: state.followups,
    auditContract: {
      ...state.auditContract,
      sessionType: 'completed',
      requiredPillarsPresent: true,
      allRequiredAnswersPopulated: true,
      durations: {
        interviewStart: state.auditContract.durations.interviewStart,
        interviewEnd: completedAt,
        totalQuestionsAsked: state.auditContract.durations.totalQuestionsAsked,
        totalHoursElapsed: elapsedHours,
      },
    },
  };
}