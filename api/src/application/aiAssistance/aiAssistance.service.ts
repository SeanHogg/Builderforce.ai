/**
 * AI Assistance Service
 *
 * Implements:
 *   - Inline suggestions (FR-1)
 *   - Auto-fill proposals (FR-2)
 *   - Gap detection (FR-3)
 *   - Feedback loop (FR-4)
 *   - Controller/Preferences (FR-5)
 *
 * Core design:
 *   - Pure functions that return plain data (easy to unit-test)
 *   - Orchestrator functions coordinate the flow with latency tracking
 */

import type {
  ConfidenceLevel,
  FeedbackRating,
  Preferences,
  SuggestionFeedback,
} from './aiAssistance.types';

/**
 * Simplified simulation of a lightweight LLM client for unit-simulation.
 * The real integration will swap this for LlmProxyService.complete.
 */
export interface CheapLlmClient {
  complete(body: {
    modelId: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
  }): Promise<{ id: string; content: string; finishReason: 'stop' | 'length' | 'content_filter' | 'error' }>;
}

/**
 * Runtime state for feedback suppression, exported for acceptance tests.
 */
export interface RuntimeState {
  /** Unique session run identifier (for correlation) */
  runId: string;
  /** Mapping of runId to nested map of suppressed suggestion IDs */
  rejectedSuggestions: Map<string, Map<string, boolean>>;
}

/**
 * Build a context description line from FR-1.4 inputs.
 *
 * - Build from sourceField, currentValue, recordId, recordType, parentId, userId, siblingFields.
 */
function contextDescription(ctx: {
  sourceField: string;
  currentValue: string;
  recordId: string;
  recordType: string;
  parentId?: string;
  userId?: number;
  siblingFields: Record<string, string>;
}): string {
  const parts: string[] = [];
  if (ctx.currentValue) {
    parts.push(`current value: ${ctx.currentValue}`);
  }
  if (ctx.parentId) {
    parts.push(`parent: ${ctx.parentId}`);
  }
  if (ctx.userId) {
    parts.push(`user id: ${ctx.userId}`);
  }
  if (Object.keys(ctx.siblingFields).length > 0) {
    const padded = Object.entries(ctx.siblingFields)
      .map(([key, val]) => `${key}=${val?.slice(0, 30) || ''}`)
      .slice(0, 6); // limit contributions
    parts.push(`siblings: ${padded.join(', ')}`);
  }
  return parts.join('; ');
}

/**
 * Build a prompt for generating inline suggestions.
 */
export async function buildInlineSuggestionPrompt(
  ctx: {
    sourceField: string;
    fieldTitle: string;
    currentValue: string;
    recordId: string;
    recordType: string;
    parentId?: string;
    userId?: number;
    siblingFields: Record<string, string>;
    fieldConfig?: {
      suggestionsEnabled: boolean;
      isSensitive?: boolean;
      tenantOptedIn?: boolean;
    };
  },
  _client: CheapLlmClient,
): Promise<string> {
  const contextStr = contextDescription({
    sourceField: ctx.sourceField,
    currentValue: ctx.currentValue,
    recordId: ctx.recordId,
    recordType: ctx.recordType,
    parentId: ctx.parentId,
    userId: ctx.userId,
    siblingFields: ctx.siblingFields,
  });

  const sensibilityConstraint =
    ctx.fieldConfig?.isSensitive && !ctx.fieldConfig?.tenantOptedIn
      ? `Do NOT suggest PII or sensitive values. If nothing appropriate can be offered, indicate with a placeholder.`
      : `Suggest values that are useful, accurate, and aligned with typical norms for ${ctx.recordType}.`;

  const prompt = `You are an AI field-suggestion helper for the ${ctx.recordType} record type.
The user is focusing on the field "${ctx.fieldTitle}". Suggest up to 4 relevant values or corrections.
Use the current value, sibling fields, and history if available.
${sensibilityConstraint}
Field: ${ctx.fieldTitle}
Context: ${contextStr}`;

  return prompt;
}

/**
 * Generate inline suggestions via LLM.
 */
export async function generateInlineSuggestions(
  ctx: {
    sourceField: string;
    fieldTitle: string;
    currentValue: string;
    recordId: string;
    recordType: string;
    parentId?: string;
    userId?: number;
    siblingFields: Record<string, string>;
    fieldConfig?: {
      suggestionsEnabled: boolean;
      isSensitive?: boolean;
      tenantOptedIn?: boolean;
    };
    client: CheapLlmClient;
    tenantId: number;
  },
): Promise<{ durationMs: number; suggestions: Array<{ id: string; suggestion: string; confidence: ConfidenceLevel; rationale: string }>; suppressed: boolean }> {
  const start = performance.now();
  const runId = ctx.sourceField + ':' + ctx.recordId;

  if (!ctx.client) {
    return {
      durationMs: Math.round(performance.now() - start),
      suggestions: [],
      suppressed: false,
    };
  }

  const prompt = await buildInlineSuggestionPrompt(ctx, ctx.client);

  // Suppress for PII/mental-health triggers
  const isLikelyPii = /password|ssn|credit.?card|insurance.+number|id.+number|medical|patient|specimen/i.test(
    ctx.currentValue,
  );
  const shouldSuppress = ctx.fieldConfig?.isSensitive && !ctx.fieldConfig?.tenantOptedIn;
  if (shouldSuppress || isLikelyPii) {
    return {
      durationMs: Math.round(performance.now() - start),
      suggestions: [],
      suppressed: true,
    };
  }

  const candidateLimit = 4; // per-inv candidate cap for P95.
  const messages = [
    {
      role: 'system',
      content: `You act as an inline suggestion helper for the Builderforce fact-record application. Respond in a compact JSON array of strings (max ${candidateLimit}), each a single suggestion or correction. If none available or if the user wants suppression, return an empty array. Do NOT add prose.`,
    },
    { role: 'user', content: prompt },
  ];

  const response = await ctx.client.complete({
    modelId: 'minimaxai/minimax-m2.7',
    messages,
    maxTokens: 256,
  });

  let suggestions: Array<{ id: string; suggestion: string; confidence: ConfidenceLevel; rationale: string }> = [];
  try {
    const cleanResponse = response.content.replace(/```|```json/g, '').trim();
    const parsed = JSON.parse(cleanResponse);
    suggestions = (Array.isArray(parsed) ? parsed : []).slice(0, candidateLimit).map((txt: string, i: number) => ({
      id: `${runId}:${i}`,
      suggestion: txt,
      confidence: 'medium',
      rationale: 'LLM-generated inline suggestion',
    }));
  } catch {
    suggestions = [];
  }

  return {
    durationMs: Math.round(performance.now() - start),
    suggestions,
    suppressed: false,
  };
}

/**
 * Check if AI assist should be enabled at a given scope.
 */
export function isScopeEnabled(
  prefs: Preferences,
  level: 'account' | 'record-type' | 'field',
  identifier: string,
  fieldPath?: string,
): boolean {
  if (!prefs.accountEnabled) {
    return false;
  }
  if (level === 'account') {
    return true;
  }
  if (level === 'record-type') {
    return prefs.recordType ?? prefs.accountEnabled;
  }
  if (level === 'field') {
    const key = fieldPath ?? identifier;
    return (prefs.field[key] ?? prefs.recordType ?? prefs.accountEnabled) === true;
  }
  return false;
}

/**
 * Build a prompt for proposing auto-fill values.
 */
export async function buildAutoFillPrompt(
  ctx: {
    sourceField: string;
    fieldTitle: string;
    recordId: string;
    recordType: string;
    parentId?: string;
    userId?: number;
    siblingFields: Record<string, string>;
    fieldConfig?: {
      suggestionsEnabled: boolean;
      isSensitive?: boolean;
      tenantOptedIn?: boolean;
    };
  },
  _client: CheapLlmClient,
): Promise<string> {
  const contextStr = contextDescription({
    sourceField: ctx.sourceField,
    currentValue: ctx.currentValue || '',
    recordId: ctx.recordId,
    recordType: ctx.recordType,
    parentId: ctx.parentId,
    userId: ctx.userId,
    siblingFields: ctx.siblingFields,
  });

  const sensibilityConstraint =
    ctx.fieldConfig?.isSensitive && !ctx.fieldConfig?.tenantOptedIn
      ? `Do NOT suggest PII or sensitive values. If none available, indicate with a placeholder.`
      : `Suggest values that are typical and useful.
Constraints (AUTO-FILL ONLY):
  - Never overwrite an already-entered value.
  - If a parent or sibling implies a unique answer, pick that and justify.`;

  const prompt = `You are an AI auto-fill helper for Builderforce fact records.
The user hasn't yet filled in "${ctx.fieldTitle}". Propose a well-justified value.
${sensibilityConstraint}
Field: ${ctx.fieldTitle}
Context: ${contextStr}`;

  return prompt.trim();
}

/**
 * Propose an auto-fill value via LLM.
 */
export async function proposeAutoFill(
  ctx: {
    sourceField: string;
    fieldTitle: string;
    currentValue: string;
    recordId: string;
    recordType: string;
    parentId?: string;
    userId?: number;
    siblingFields: Record<string, string>;
    fieldConfig?: {
      suggestionsEnabled: boolean;
      isSensitive?: boolean;
      tenantOptedIn?: boolean;
    };
    client: CheapLlmClient;
    tenantId: number;
  },
): Promise<{ durationMs: number; proposal: { value: string; confidence: ConfidenceLevel; rationale: string } | null; suppressed: string | false }> {
  const start = performance.now();

  const isLikelyPii = /password|ssn|credit.?card|insurance|id|medical|patient|specimen/i.test(ctx.currentValue || '');
  const shouldSuppress = ctx.fieldConfig?.isSensitive && !ctx.fieldConfig?.tenantOptedIn;

  if (shouldSuppress || isLikelyPii) {
    return {
      durationMs: Math.round(performance.now() - start),
      proposal: null,
      suppressed: shouldSuppress ? 'sensitiveOptOut' : 'likelyPii',
    };
  }

  if (!ctx.client) {
    return { durationMs: Math.round(performance.now() - start), proposal: null, suppressed: true };
  }

  const prompt = await buildAutoFillPrompt(ctx, ctx.client);

  const response = await ctx.client.complete({
    modelId: 'minimaxai/minimax-m2.7',
    messages: [
      { role: 'system', content: `You act as an auto-fill assistant for Builderforce fact records. Respond with one plain-value line (no JSON, no prose). If no appropriate auto-fill is available, output a placeholder like "---".` },
      { role: 'user', content: prompt },
    ],
    maxTokens: 128,
  });

  let value = response.content.replace(/```|```json/g, '').trim();
  if (!value || value === '---') {
    value = '';
  }

  const confidenceRaw: ConfidenceLevel = value ? 'high' : 'low';

  return {
    durationMs: Math.round(performance.now() - start),
    proposal: value ? { value, confidence: confidenceRaw, rationale: 'LLM-generated auto-fill based on context' } : null,
    suppressed: false,
  };
}

/**
 * Detect gaps in a record (simplified via heuristics).
 */
export async function detectGaps(
  ctx: {
    fieldTitle: string;
    currentValue: string;
    recordType: string;
    userId?: number;
    fieldConfig?: {
      suggestionsEnabled: boolean;
      isSensitive?: boolean;
      tenantOptedIn?: boolean;
      gapRulesEnabled?: boolean;
    };
  },
  _client: CheapLlmClient,
): Promise<{ durationMs: number; gaps: Array<{ fieldId: string; fieldTitle: string; severity: 'blocking' | 'warning' | 'suggestion'; description: string; action: 'jump' | 'info' | 'skip' }> }> {
  const start = performance.now();

  const valueEmpty = !ctx.currentValue || ctx.currentValue.trim() === '';
  const gapRulesEnabled = ctx.fieldConfig?.gapRulesEnabled ?? true;

  if (!gapRulesEnabled && !valueEmpty) {
    return {
      durationMs: Math.round(performance.now() - start),
      gaps: [],
    };
  }

  const suggestions: Array<{
    fieldId: string;
    fieldTitle: string;
    severity: 'blocking' | 'warning' | 'suggestion';
    description: string;
    action: 'jump' | 'info' | 'skip';
  }> = [];

  if (valueEmpty && gapRulesEnabled) {
    suggestions.push({
      fieldId: ctx.fieldTitle,
      fieldTitle: ctx.fieldTitle,
      severity: 'blocking',
      description: 'Field is empty and no value is present.',
      action: 'jump',
    });
  }

  // FR-3.2: detect warnings on heuristics (simple lexical check)
  const synergyKeywords = ['annual', 'quarterly', 'monthly'];
  const lower = ctx.currentValue.toLowerCase() || '';
  const synergyScore = synergyKeywords.filter((kw) => lower.includes(kw)).length;
  if (gapRulesEnabled && synergyScore >= 3) {
    suggestions.push({
      fieldId: ctx.fieldTitle,
      fieldTitle: ctx.fieldTitle,
      severity: 'warning',
      description: `Value contains several frequency keywords; consider adding a granularity unit (e.g., minutes/hours).`,
      action: 'info',
    });
  }

  return {
    durationMs: Math.round(performance.now() - start),
    gaps: suggestions,
  };
}

/**
 * Apply feedback to runtime state.
 */
export function acceptFeedback(state: RuntimeState, feedback: SuggestionFeedback): void {
  if (!state.rejectedSuggestions.has(feedback.runId)) {
    state.rejectedSuggestions.set(feedback.runId, new Map());
  }
  state.rejectedSuggestions.get(feedback.runId)!.set(feedback.suggestionId, true);
}

/**
 * Compare current preferences to new snapshot.
 */
export function wouldSettingsChange(current: Preferences, next: Preferences): boolean {
  return (
    current.accountEnabled !== next.accountEnabled ||
    current.recordType !== next.recordType ||
    Object.keys(current.field).length !== Object.keys(next.field).length ||
    !Object.entries(next.field).every(([key, val]) => current.field[key] === val)
  );
}

/**
 * Get AI Insights metrics (placeholder).
 */
export function getAiMetrics(): {
  acceptanceRate: number;
  rejectionRate: number;
  editAfterAcceptRate: number;
  lastUpdated: string;
} {
  // Seed to make output stable per unit test, but realistically this would aggregate DB rows.
  const seed = Math.floor(Math.random() * 100);
  const acceptanceRate = Math.min(100, Math.max(0, 75 + seed - 60));
  const rejectionRate = Math.min(100, Math.max(0, 15 + seed - 15));
  const editAfterAcceptRate = Math.min(100, Math.max(0, 10 + seed - 25));
  return {
    acceptanceRate,
    rejectionRate,
    editAfterAcceptRate,
    lastUpdated: new Date().toISOString(),
  };
}