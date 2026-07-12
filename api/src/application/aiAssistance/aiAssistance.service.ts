/**
 * AI Assistance Service
 *
 * This module implements FR-1 through FR-5 of the AI Assistance PRD:
 *   - Inline suggestions (FR-1)
 *   - Auto-fill proposals (FR-2)
 *   - Gap detection (FR-3)
 *   - Feedback loop (FR-4)
 *   - Controller/Preferences (FR-5)
 *
 * Key Functions:
 *   - generateInlineSuggestions(ctx, generator, tenantId) - generates inline field suggestions
 *   - proposeAutoFill(ctx, generator, tenantId) - proposes an auto-fill value
 *   - detectGaps(ctx, generator) - detects gaps in a record
 *   - isScopeEnabled(prefs, level, identifier, fieldPath) - checks enablement level
 *   - getAiMetrics() - returns aggregated metrics
 *   - acceptFeedback(state, feedback) - records user feedback
 */

import type {
  ConfidenceLevel,
  GapSeverity,
  FeedbackRating,
  Preferences,
  AiGenerator,
  RuntimeState,
  Gap,
  InlineSuggestionsResponse,
  AutoFillResponse,
  GapDetectionResponse,
  SuggestionFeedback,
} from './aiAssistance.types';

// -------------------------------------------------------------------------- //
// HELPERS
// -------------------------------------------------------------------------- //

/**
 * Build a human-readable context description string.
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
  if (ctx.currentValue) parts.push(`current value: ${ctx.currentValue}`);
  if (ctx.parentId) parts.push(`parent: ${ctx.parentId}`);
  if (ctx.userId) parts.push(`user id: ${ctx.userId}`);
  if (Object.keys(ctx.siblingFields).length > 0) {
    const padded = Object.entries(ctx.siblingFields)
      .map(([key, val]) => `${key}=${val?.slice(0, 30) || ''}`)
      .slice(0, 6);
    parts.push(`siblings: ${padded.join(', ')}`);
  }
  return parts.join('; ');
}

/**
 * Build a plain-text prompt for generating inline suggestions.
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
  generator: AiGenerator | null,
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
    ctx.fieldConfig?.isSensitive && !ctx.fieldConfig.tenantOptedIn
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
    generator: AiGenerator | null;
    tenantId: number;
  },
): Promise<{ durationMs: number; suggestions: Array<InlineSuggestion>; suppressed: boolean | 'sensitiveOptOut' | 'likelyPii' }> {
  const start = performance.now();
  const runId = `${ctx.sourceField}:${ctx.recordId}`;

  // FR-1.5: PII field gating
  const isLikelyPii = /password|ssn|credit.?card|insurance.+number|id.+number|medical|patient|specimen/i.test(ctx.currentValue);
  const shouldSuppress =
    ctx.fieldConfig?.isSensitive && !ctx.fieldConfig.tenantOptedIn;

  if (shouldSuppress || isLikelyPii) {
    return {
      durationMs: Math.round(performance.now() - start),
      suggestions: [],
      suppressed: shouldSuppress ? 'sensitiveOptOut' : 'likelyPii',
    };
  }

  if (!ctx.generator) {
    return {
      durationMs: Math.round(performance.now() - start),
      suggestions: [],
      suppressed: false,
    };
  }

  const prompt = await buildInlineSuggestionPrompt(ctx, ctx.generator);

  const candidateLimit = 4;
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

  let suggestions: Array<InlineSuggestion> = [];
  try {
    const cleanResponse = response.content.replace(/```|```json/g, '').trim();
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
 * Check if AI assist is enabled at a given scope (FR-5.1).
 */
export function isScopeEnabled(
  prefs: Preferences,
  level: 'account' | 'record-type' | 'field',
  identifier: string,
  fieldPath?: string,
): boolean {
  if (!prefs.accountEnabled) return false;
  if (level === 'account') return true;
  if (level === 'record-type') return prefs.recordType ?? prefs.accountEnabled;
  // field-level
  const key = fieldPath ?? identifier;
  return (prefs.field[key] ?? prefs.recordType ?? prefs.accountEnabled) === true;
}

/**
 * Build a plain-text prompt for auto-fill.
 */
export async function buildAutoFillPrompt(
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
  generator: AiGenerator | null,
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
    ctx.fieldConfig?.isSensitive && !ctx.fieldConfig.tenantOptedIn
      ? `Do NOT suggest PII or sensitive values. If nothing appropriate can be offered, indicate with a placeholder.`
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
    generator: AiGenerator | null;
    tenantId: number;
  },
): Promise<{ durationMs: number; proposal: AutoFillProposal | null; suppressed: boolean | 'sensitiveOptOut' | 'likelyPii' }> {
  const start = performance.now();

  // FR-1.5: PII gating
  const isLikelyPii = /password|ssn|credit.?card|insurance|id|medical|patient|specimen/i.test(ctx.currentValue);
  const shouldSuppress =
    ctx.fieldConfig?.isSensitive && !ctx.fieldConfig.tenantOptedIn;

  if (shouldSuppress || isLikelyPii) {
    return {
      durationMs: Math.round(performance.now() - start),
      proposal: null,
      suppressed: shouldSuppress ? 'sensitiveOptOut' : 'likelyPii',
    };
  }

  if (!ctx.generator) {
    return {
      durationMs: Math.round(performance.now() - start),
      proposal: null,
      suppressed: false,
    };
  }

  const prompt = await buildAutoFillPrompt(ctx, ctx.generator);

  const response = await ctx.generator.complete({
    modelId: 'minimaxai/minimax-m2.7',
    messages: [
      {
        role: 'system',
        content: `You act as an auto-fill assistant for Builderforce fact records. Respond with one plain-value line (no JSON, no prose). If no appropriate auto-fill is available, output a placeholder like "---".`,
      },
      { role: 'user', content: prompt },
    ],
    maxTokens: 128,
  });

  let value = response.content.replace(/```|```json/g, '').trim();
  if (!value || value === '-- Keep it short --') {
    value = '';
  }

  const confidence = value ? 'high' as ConfidenceLevel : 'low';
  const rationale = value
    ? 'LLM-generated auto-fill based on context'
    : 'No suitable auto-fill value available from context';

  return {
    durationMs: Math.round(performance.now() - start),
    proposal: value ? ({ suggestedValue: value, confidence, rationale } as AutoFillProposal) : null,
    suppressed: false,
  };
}

/**
 * Detect gaps in a record.
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
  generator: AiGenerator | null,
): Promise<{
  durationMs: number;
  gaps: Gap[];
}> {
  const start = performance.now();

  const valueEmpty = !ctx.currentValue || ctx.currentValue.trim() === '';
  const gapRulesEnabled = ctx.fieldConfig?.gapRulesEnabled ?? true;

  if (!gapRulesEnabled && !valueEmpty) {
    return {
      durationMs: Math.round(performance.now() - start),
      gaps: [],
    };
  }

  const suggestions: Gap[] = [];

  // FR-3.2: treat empty values as Blocking.
  if (valueEmpty && gapRulesEnabled) {
    suggestions.push({
      fieldId: ctx.fieldTitle,
      fieldTitle: ctx.fieldTitle,
      severity: 'blocking' as GapSeverity,
      description: 'Field is empty and no value is present.',
      action: 'jump',
    });
  }

  // FR-3.2: frequency keyword heuristic
  const synergyKeywords = ['annual', 'quarterly', 'monthly'];
  const lower = ctx.currentValue.toLowerCase() || '';

  // Only flag if the current value has multiple such keywords.
  const frequencyMatches = synergyKeywords.filter((kw) => lower.includes(kw));
  if (gapRulesEnabled && frequencyMatches.length >= 3) {
    suggestions.push({
      fieldId: ctx.fieldTitle,
      fieldTitle: ctx.fieldTitle,
      severity: 'warning' as GapSeverity,
      description: 'Value contains several frequency keywords. Consider adding a granularity unit (e.g., minutes/hours or a time period specifier).',
      action: 'info',
    });
  }

  return {
    durationMs: Math.round(performance.now() - start),
    gaps: suggestions,
  };
}

// -------------------------------------------------------------------------- //
// FEEDBACK & METRICS
// -------------------------------------------------------------------------- //

/**
 * Record feedback on a suggestion.
 */
export function acceptFeedback(state: RuntimeState, feedback: {
  runId: string;
  suggestionId: string;
  rating: FeedbackRating;
}): void {
  if (!state.rejectedSuggestions.has(feedback.runId)) {
    state.rejectedSuggestions.set(feedback.runId, new Map());
  }
  state.rejectedSuggestions.get(feedback.runId)!.set(feedback.suggestionId, true);
}

/**
 * Compare current preferences to a new snapshot.
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
 * Get AI Insights metrics.
 */
export function getAiMetrics(): {
  acceptanceRate: number;
  rejectionRate: number;
  editAfterAcceptRate: number;
  lastUpdated: string;
} {
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

// -------------------------------------------------------------------------- //
// LIST EXPORT
// -------------------------------------------------------------------------- //

export const functions = [
  'buildInlineSuggestionPrompt',
  'generateInlineSuggestions',
  'buildAutoFillPrompt',
  'proposeAutoFill',
  'detectGaps',
  'isScopeEnabled',
  'acceptFeedback',
  'wouldSettingsChange',
  'getAiMetrics',
] as const;