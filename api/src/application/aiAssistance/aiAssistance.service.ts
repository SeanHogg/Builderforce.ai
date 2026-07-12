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
 *       summarizeContext -> model -> embeddings (mock) -> candidates
 *   - Orchestrator functions coordinate the flow with latency tracking
 *       generateInlineSuggestions, proposeAutoFill, detectGaps
 */

import type { ConfidenceLevel, GapSeverity, FeedbackRating } from './aiAssistance.types';

/** Simplified simulation of an LLM embed response for candidate calibration and scoring */
export interface EmbeddingResponse {
  /** Embedding vector (normalized) */
  embedding: number[];
  /** Token count used for this request */
  tokenCount: number;
}

/** Mockable service shim for embeddings + completion (break-dependency until wired) */
export interface AiGenerator {
  /**
   * Return vector embeddings for a query string.
   * - Return a DependencyError when PII/mental-health/tokenizationHelper triggers are active.
   */
  embed(request: { text: string; tenantId: number; userId: number }): Promise<EmbeddingResponse | null>;

  /**
   * Return suggestions/auto-fill/gaps via prompts.
   * - Prompt and output modeling keep expectations bounded for P95 latency.
   */
  complete(body: {
    modelId: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
  }): Promise<{
    id: string;
    content: string;
    finishReason: 'stop' | 'length' | 'content_filter' | 'error';
  }>;
}

type InjectedAiGenerator = AiGenerator | null;

/** Current runtime state (used for in-session suppression) */
export interface RuntimeState {
  /** RunId to correlate flows */
  runId: string;
  /** Session-level suggestion suppression map (runId → Map<suggestionId, boolean>) */
  rejectedSuggestions: Map<string, Map<string, boolean>>;
}

/** Global preferences (persisted) */
export interface Preferences {
  accountEnabled: boolean;
  recordType: boolean | null;
  field: Record<string, boolean | null>;
}

/**
 * Build a context description line from FR-1.4 inputs.
 *
 * - Sibling fields and history keywords are small; no tokens are counted or embed generated.
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
  // siblingFields keys are human-readable titles; values are quoted content.
  if (Object.keys(ctx.siblingFields).length > 0) {
    const pairs = Object.entries(ctx.siblingFields);
    // short jumbled key/title. We use the key (the human title) plus a short value slice.
    const padded = pairs.map(([key, val]) => `${key}=${val?.slice(0, 30) || ''}`);
    parts.push(`siblings: ${padded.join(', ')}`);
  }
  return parts.join('; ');
}

/**
 * Build an inline suggestion prompt from FR-1.4 inputs.
 *
 * Implementation lower-bound:
 * - BR-1.1 / FR-1.4. The role/system prefix ensures the model understands context.
 * - We keep candidates small per invocation (P95 constraint). Future work can add scoring.
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
  generator: InjectedAiGenerator,
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

  const systemHeader = `You are an AI field-suggestion helper for the ${ctx.recordType} record type.`;
  const fieldConstraint = `The user is focusing on the field "${ctx.fieldTitle}". Suggest up to 4 relevant values or corrections.`;
  const historyConstraint = `Use the current value (${ctx.currentValue}), the sibling fields, and history if available.`;
  const sensibilityConstraint = ctx.fieldConfig?.isSensitive && !ctx.fieldConfig?.tenantOptedIn
    ? `Do NOT suggest PII or sensitive values. If nothing appropriate can be offered, indicate with a placeholder.`
    : `Suggest values that are useful, accurate, and aligned with typical norms for ${ctx.recordType}.`;

  const prompt = `${systemHeader}\n${fieldConstraint}\n${historyConstraint}\n${sensibilityConstraint}\nField: ${ctx.fieldTitle}\nContext: ${contextStr}`;

  // Quick check for PII-full content to avoid embed/noise before eventual review.
  const isLikelyPii = /password|ssn|credit.?card|insurance.+number|id.+number|medical|patient|specimen/i.test(
    ctx.currentValue,
  );
  const shouldSuppress = ctx.fieldConfig?.isSensitive && !ctx.fieldConfig?.tenantOptedIn;
  const shouldSkip = shouldSuppress || isLikelyPii;

  if (shouldSkip) {
    return JSON.stringify({ suggestions: [], suppressedReason: shouldSuppress ? 'sensitiveOptOut' : 'likelyPii' });
  }

  // We could embed the prompt for flavor later; for now we just return the concrete prompt.
  return prompt;
}

/**
 * Generate inline suggestions via an LLM.
 *
 * Response does NOT include a zipped vector; candidates are already output in content.
 * FR-1.1 (p95 <500ms): consequences are per-invocation candidate caps and minimal roundtrip.
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
    generator: InjectedAiGenerator;
    tenantId: number;
  },
): Promise<{ durationMs: number; suggestions: { id: string; suggestion: string; confidence: ConfidenceLevel; rationale: string }[]; suppressed: boolean }> {
  const start = performance.now();
  const runId = ctx.sourceField + ':' + ctx.recordId;

  const prompt = await buildInlineSuggestionPrompt(ctx, ctx.generator);
  if (!ctx.generator) {
    const jsonMatch = prompt.match(/\{[^{}]*suggestions:[^{}]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          durationMs: Math.round(performance.now() - start),
          suggestions: parsed.suggestions.map((txt: string, i: number) => ({
            id: `${runId}:${i}`,
            suggestion: txt,
            confidence: 'medium',
            rationale: 'No generator available; inline fallback to earlier answer.',
          })),
          suppressed: !!parsed.suppressedReason,
        };
      } catch {
        // Continue with fallback.
      }
    }
    return {
      durationMs: Math.round(performance.now() - start),
      suggestions: [],
      suppressed: false,
    };
  }

  // FR-1.3, FR-4.1: High cardinality.
  const candidateLimit = 4; // Small per-inv candidate cap to honor P95.
  const messages = [
    {
      role: 'system',
      content: `You act as an inline suggestion helper for the Builderforce fact-record application. Respond in a compact JSON array of strings (max ${candidateLimit}), each a single suggestion or correction. If none available or if the user wants suppression, return an empty array. Do NOT add prose.`,
    },
    { role: 'user', content: prompt },
  ];

  const response = await ctx.generator.complete({
    modelId: 'minimaxai/minimax-m2.7',
    messages,
    maxTokens: 256,
  });

  let suggestions: { id: string; suggestion: string; confidence: ConfidenceLevel; rationale: string }[] = [];
  try {
    // The model might stray into prose; contiguous JSON array is expected.
    const cleanResponse = response.content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanResponse);
    suggestions = (Array.isArray(parsed) ? parsed : []).slice(0, candidateLimit).map((txt: string, i: number) => ({
      id: `${runId}:${i}`,
      suggestion: txt,
      confidence: 'medium' as ConfidenceLevel,
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
 *
 * - Prefer account over recordType over field preferences.
 * - field is a map keyed by fieldPath.
 */
export function isScopeEnabled(
  prefs: Preferences,
  level: EnablementLevel,
  identifier: string,
  fieldPath?: string,
): boolean {
  if (!prefs.accountEnabled) {
    return false;
  }
  if (level === 'account') {
    return true;
  }
  const recordType = level === 'record-type';
  if (recordType) {
    // Null/undefined recordType entries mean "use account default".
    return prefs.recordType ?? prefs.accountEnabled;
  }
  if (level === 'field') {
    // Find the best-match key for dual usage (title/path/section).
    // Simplify: if a fieldPath is provided, use it; otherwise use identifier.
    const key = fieldPath ?? identifier;
    return (prefs.field[key] ?? prefs.recordType ?? prefs.accountEnabled) === true;
  }
  return false;
}

/**
 * Build an auto-fill proposal prompt.
 *
 * - Default expectations and prompt modeling keep candidates bounded.
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
  generator: InjectedAiGenerator,
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

  const systemHeader = `You are an AI auto-fill helper for Builderforce fact records.`;
  const fieldConstraint = ctx ? `The user hasn't yet filled in "${ctx.fieldTitle}". Propose a well-justified value.` : '';
  const sensibilityConstraint = ctx.fieldConfig?.isSensitive && !ctx.fieldConfig?.tenantOptedIn
    ? `Do NOT suggest PII or sensitive values. If none available, indicate with a placeholder.`
    : `Suggest values that are typical and useful.

Constraints (AUTO-FILL ONLY):
  - Never overwrite an already-entered value. (Auto-fill only acts on empty states.)
  - If a parent or sibling implies a unique answer, pick that and justify.';

  const prompt = `${systemHeader}\n${fieldConstraint}\n${sensibilityConstraint}\nField: ${ctx.fieldTitle}\nContext: ${contextStr}`.replace(/\n\n+/g, '\n').trim();
  return prompt;
}

/**
 * Propose a single auto-fill value via LLM.
 *
 * FR-2.5: reversibility via undo in this session (recorded separately); FR-2.4: confidence and rationale.
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
    generator: InjectedAiGenerator;
    tenantId: number;
  },
): Promise<{ durationMs: number; proposal: { value: string; confidence: ConfidenceLevel; rationale: string } | null; suppressed: boolean }> {
  const start = performance.now();
  const isLikelyPii = /password|ssn|credit.?card|insurance|id|medical|patient|specimen/i.test(ctx.currentValue || '');
  const shouldSuppress = ctx.fieldConfig?.isSensitive && !ctx.fieldConfig?.tenantOptedIn;

  if (shouldSuppress || isLikelyPii) {
    return {
      durationMs: Math.round(performance.now() - start),
      proposal: null,
      suppressed: shouldSuppress || isLikelyPii ? (shouldSuppress ? 'sensitiveOptOut' : 'likelyPii') : false,
    };
  }

  if (!ctx.generator) {
    // Fallback: if no generator, signal suppressed.
    return { durationMs: Math.round(performance.now() - start), proposal: null, suppressed: true };
  }

  const prompt = await buildAutoFillPrompt(ctx, ctx.generator);

  const response = await ctx.generator.complete({
    modelId: 'minimaxai/minimax-m2.7',
    messages: [
      { role: 'system', content: `You act as an auto-fill assistant for Builderforce fact records. Respond with one plain-value line (no JSON, no prose). If no appropriate auto-fill is available, output a placeholder like "---".` },
      { role: 'user', content: prompt },
    ],
    maxTokens: 128,
  });

  // Clean and parse value.
  let value = response.content.replace(/```|```json/g, '').trim();
  if (!value || value === '---') {
    value = '';
  }

  const confidence: ConfidenceLevel = value ? 'high' : null;

  return {
    durationMs: Math.round(performance.now() - start),
    proposal: value ? { value, confidence, rationale: 'LLM-generated auto-fill based on context' } : null,
    suppressed: false,
  };
}

/**
 * Detect gaps in a record (niche subsumption for single-field cases).
 *
 * Implementation lower-bound:
 * - Missing-empty values are handled; internal consistency is simplified.
 * - Gaps surfaced by severity: blocking → warning → suggestion.
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
  generator: InjectedAiGenerator,
): Promise<{ durationMs: number; gaps: { fieldId: string; fieldTitle: string; severity: GapSeverity; description: string; action: 'jump' | 'info' | 'skip' }[] }> {
  const start = performance.now();

  // Quick heuristics; no LLM needed yet.
  const valueEmpty = !ctx.currentValue || ctx.currentValue.trim() === '';
  const suggestionsEnabled = ctx.fieldConfig?.gapRulesEnabled ?? ctx.fieldConfig?.suggestionsEnabled ?? true;

  if (!suggestionsEnabled && !valueEmpty) {
    return {
      durationMs: Math.round(performance.now() - start),
      gaps: [],
    };
  }

  const suggestions: Array<{
    fieldId: string;
    fieldTitle: string;
    severity: GapSeverity;
    description: string;
    action: 'jump' | 'info' | 'skip';
  }> = [];

  if (valueEmpty && suggestionsEnabled) {
    // Simplified severity selection for now; future work can have richer rules.
    suggestions.push({
      fieldId: ctx.fieldTitle,
      fieldTitle: ctx.fieldTitle,
      severity: 'blocking',
      description: 'Field is empty and no value is present.',
      action: 'jump',
    });
  }

  // HINT: runId anchor ensures uniqueness.
  const runId = ctx.fieldTitle + ':' + ctx.recordType;

  // Example: internal consistency check.
  const synergyKeywords = ['annual', 'quarterly', 'monthly'];
  const lower = ctx.currentValue.toLowerCase() || '';
  const synergyScore = synergyKeywords.filter((kw) => lower.includes(kw)).length;
  const synergyEnabled = ctx.fieldConfig?.gapRulesEnabled ?? true;

  if (synergyEnabled && synergyScore >= 3) {
    const desc = `Value contains several frequency keywords (${synergyKeywords.join(', ')}), but no explicit unit is given (e.g., minutes/hours).` sat lower.includes(kw)) ;
    suggestions.push({
      fieldId: ctx.fieldTitle,
      fieldTitle: ctx.fieldTitle,
      severity: 'warning',
      description: desc,
      action: 'info',
    });
  }

  return {
    durationMs: Math.round(performance.now() - start),
    gaps: suggestions,
  };
}

/**
 * Apply feedback to the runtime state.
 *
 * - FR-4.2: rejected suggestions are suppressed for the remainder of the session.
 */
export function acceptFeedback(
  state: RuntimeState,
  feedback: SuggestionFeedback,
): void {
  if (!state.rejectedSuggestions.has(feedback.runId)) {
    state.rejectedSuggestions.set(feedback.runId, new Map());
  }
  // We store rejection as true, but we could also increment receipt counts in future.
  state.rejectedSuggestions.get(feedback.runId)!.set(feedback.suggestionId, true);
}

/** Compare current preferences to the new snapshot and return stubbing apply() as a plan for toggles. */
export function wouldSettingsChange(
  current: Preferences,
  next: Preferences,
): boolean {
  return (
    current.accountEnabled !== next.accountEnabled ||
    current.recordType !== next.recordType ||
    Object.keys(current.field).length !== Object.keys(next.field).length ||
    !Object.entries(next.field).every(([key, val]) => current.field[key] === val)
  );
}

/**
 * Get AI Insights (placeholder for FR-4.3 metric aggregation).
 *
 * - Returns mock acceptance/rejection rates without DB I/O.
 */
export function getAiMetrics(): {
  acceptanceRate: number;
  rejectionRate: number;
  editAfterAcceptRate: number;
  lastUpdated: string;
} {
  // Example seed.
  const seed = Math.floor(Math.random() * 100);
  return {
    acceptanceRate: Math.min(100, Math.max(0, 75 + seed - 60)),
    rejectionRate: Math.min(100, Math.max(0, 15 + seed - 15)),
    editAfterAcceptRate: Math.min(100, Math.max(0, 10 + seed - 25)),
    lastUpdated: new Date().toISOString(),
  };
}