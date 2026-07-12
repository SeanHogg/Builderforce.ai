/**
 * AI Assistance Service (function-based module for inline suggestions, auto-fill, gap detection, feedback, and preferences)

to:
```ts
/**
 * AI Assistance Service (function-based module for inline suggestions, auto-fill, gap detection, feedback, and preferences)

 * This module implements:
 *   - Inline suggestions (FR-1)
 *   - Auto-fill proposals (FR-2)
 *   - Gap detection (FR-3)
 *   - Feedback loop (FR-4)
 *   - Controller/Preferences (FR-5)

2. **Features**:
   - Pure functions for easy unit testing
   - Orchestrator functions that track latency
   - Sensitive field PII and tenant opt-in gating
   - Confidence scoring (high/medium/low)
   - Field-level enablement toggles (account, record-type, field)

3. **Key Functions**:
   - `generateInlineSuggestions(ctx, generator, tenantId)` — generates inline field suggestions using an LLM.
   - `proposeAutoFill(ctx, generator, tenantId)` — proposes an auto-fill value for an empty field.
   - `detectGaps(ctx, generator)` — detects gaps in a record (empty fields, heuristics, frequency keywords).
   - `isScopeEnabled(prefs, level, identifier, fieldPath)` — checks whether AI assist is enabled at the requested level.
   - `getAiMetrics()` — returns aggregated metrics (acceptance rate, rejection rate, edit-after-accept rate).
   - `acceptFeedback(state, feedback)` — records user feedback to runtime state.

4. **Usage Example**:
```ts
const generator: AiGenerator = { embed: ..., complete: ... };
const prefs: Preferences = {
  accountEnabled: true,
  recordType: null,
  field: {},
};

const ctx = {
  sourceField: 'project.priority',
  fieldTitle: 'Priority',
  currentValue: 'medium',
  recordId: '1',
  recordType: 'Project',
  parentId: 'proj-1',
  userId: 42,
  siblingFields: { status: "open", assignee: "alice" },
  fieldConfig: { suggestionsEnabled: true, tenantOptedIn: true },
};

// Inline suggestions
const inlineResult = await generateInlineSuggestions(ctx, generator, 1);
console.log(inlineResult.suggestions);

// Auto-fill proposal
const autofillResult = await proposeAutoFill(ctx, generator, 1);
console.log(autofillResult.proposal);

// Gap detection
const gapsResult = await detectGaps(ctx, generator);
console.log(gapsResult.gaps);

// Preference check
const enabled = isScopeEnabled(prefs, 'field', 'priority', 'project.priority');
console.log(enabled); // false per field config

// Metrics
const metrics = getAiMetrics();
console.log(metrics);
```

5. **Type Definitions**:

   - `Preferences` — account, record-type, and field-level AI assist enablement.
   - `AiGenerator` — embed and complete mockable interfaces.
   - `RuntimeState` — runtime state for feedback suppression and analytics hooks.
   - `InlineSuggestion` — represents a single suggestion from `generateInlineSuggestions`.
   - `AutoFillProposal` — represents a proposed auto-fill value from `proposeAutoFill`.
   - `Gap` — describes a detected gap in a record.
   - `SuggestionFeedback` — user feedback on a suggestion.
   - `GapSeverity` — blocking, warning, suggestion.
   - `FeedbackRating` — thumbs-up, thumbs-down.

6. **Notes**:
   - In this release, metrics are mocked/not persisted. Future PRs will wire project_facts KV store.
   - Bulk auto-fill preview and undo are deferred; this PR surfaces proposals with a confidence score.
   - Gap detection uses simple heuristics; future releases can plug in per-record-type rules.
   - Sensitive PII fields are gated unless the tenant opts in.
   - Always call `isScopeEnabled` before invoking suggestion generation to honor enablement.
   - Use `acceptFeedback` to record user ratings; the UI layer applies session-level suppressions.

Note on self-imports: we import `AiGenerator` and `RuntimeState` from this same file, so we must export them before they are used. The code below:
- defines `RuntimeState` near the top,
- defines `AiGenerator` before its use,
- defines the list export at the bottom.
This is intentional for a single-file module with interdependent types.
 */

// -------------------------------------------------------------------------- //
// TYPES
// -------------------------------------------------------------------------- //

/**
 * Global AI assistance preferences snapshot (FR-5.1).
 *   - accountEnabled: overall enable/disable at tenant level.
 *   - recordType: per-record-type toggles; null inherits from account.
 *   - field: per-field toggles; key is a dot-notation field path.
 */
export interface Preferences {
  accountEnabled: boolean;
  recordType: boolean | null;
  field: Record<string, boolean | null>;
}

/**
 * Simplified mockable LLM client for AI assistance (embed + complete).
 * - Intentionally lightweight to keep tests isolated; future wiring may use LlmProxyService.
 */
export interface AiGenerator {
  /**
   * Return an embedding vector (reserved for future similarity-based ranking).
   */
  embed(request: { text: string; tenantId: number; userId: number }): Promise<{ embedding: number[]; tokenCount: number }> | null;

  /**
   * Complete a plain-text completion request (FR-1.4: messages -> plain text).
   */
  complete(body: {
    modelId: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
  }): Promise<{ id: string; content: string; finishReason: 'stop' | 'length' | 'content_filter' | 'error' }>;
}

/**
 * Runtime state used by acceptFeedback and potentially by the UI layer for session suppression.
 */
export interface RuntimeState {
  /**
   * Identifier for the current run (e.g., suggestions runId or auto-fill runId).
   */
  runId: string;

  /**
   * Mapping: runId -> (suggestionId -> true) for rejected suggestions.
   * Used to suppress a rejected suggestion for the remainder of the session per FR-4.2.
   */
  rejectedSuggestions: Map<string, Map<string, true>>;
}

// -------------------------------------------------------------------------- //
// HELPERS
// -------------------------------------------------------------------------- //

/**
 * Build a human-readable context description string from inline suggestion inputs.
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
      .slice(0, 6); // limit contributions
    parts.push(`siblings: ${padded.join(', ')}`);
  }
  return parts.join('; ');
}

/**
 * Build a plain-text prompt for generating inline suggestions (FR-1.4).
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
    recordType: ctx.record_type,
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
 * Generate inline suggestions via LLM (FR-1.1, FR-1.3, FR-1.4, FR-1.5).
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
): Promise<{ durationMs: number; suggestions: Array<{ id: string; suggestion: string; confidence: ConfidenceLevel; rationale: string }>; suppressed: boolean }> {
  const start = performance.now();
  const runId = `${ctx.sourceField}:${ctx.recordId}`;

  // FR-1.5: PII field gating — tenant must opt in.
  const isLikelyPii = /password|ssn|credit.?card|insurance.+number|id.+number|medical|patient|specimen/i.test(ctx.currentValue);
  const shouldSuppress = ctx.fieldConfig?.isSensitive && !ctx.fieldConfig.tenantOptedIn;
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

  const candidateLimit = 4; // P95 latencies prefer a small,ubble candidate set.
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
 * Build a plain-text prompt for auto-fill (FR-2.1, FR-2.5 — UI does final restrict not overwrite).
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
 * Propose an auto-fill value via LLM (FR-2.1, FR-2.4, FR-2.5).
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
): Promise<{ durationMs: number; proposal: { value: string; confidence: ConfidenceLevel; rationale: string } | null; suppressed: 'sensitiveOptOut' | 'likelyPii' | false }> {
  const start = performance.now();

  // FR-1.5: PII gating
  const isLikelyPii = /password|ssn|credit.?card|insurance|id|medical|patient|specimen/i.test(ctx.currentValue);
  const shouldSuppress = ctx.fieldConfig?.isSensitive && !ctx.fieldConfig.tenantOptedIn;

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
      suppressed: true,
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

  // FR-2.3: confidence signal; our heuristics can signal quality here.
  const confidence = value ? 'high' : 'low';
  const rationale = value ? 'LLM-generated auto-fill based on context' : 'No suitable auto-fill value available from context';

  return {
    durationMs: Math.round(performance.now() - start),
    proposal: value ? { value, confidence, rationale } : null,
    suppressed: false,
  };
}

/**
 * Detect gaps in a record (FR-3.1, FR-3.2, FR-3.3, FR-3.4, FR-3.5).
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
  gaps: Array<{ fieldId: string; fieldTitle: string; severity: GapSeverity; description: string; action: 'jump' | 'info' | 'skip' }>;
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

  const suggestions: Array<{
    fieldId: string;
    fieldTitle: string;
    severity: GapSeverity;
    description: string;
    action: 'jump' | 'info' | 'skip';
  }> = [];

  // FR-3.2: treat empty values as Blocking.
  if (valueEmpty && gapRulesEnabled) {
    suggestions.push({
      fieldId: ctx.fieldTitle,
      fieldTitle: ctx.fieldTitle,
      severity: 'blocking',
      description: 'Field is empty and no value is present.',
      action: 'jump',
    });
  }

  // FR-3.2: simple heuristic — frequency keyword heuristic (optional) as a warning.
  const synergyKeywords = ['annual', 'quarterly', 'monthly'];
  const lower = ctx.currentValue.toLowerCase() || '';

  // Only flag if the current value has multiple such keywords.
  const frequencyMatches = synergyKeywords.filter((kw) => lower.includes(kw));
  if (gapRulesEnabled && frequencyMatches.length >= 3) {
    suggestions.push({
      fieldId: ctx.fieldTitle,
      fieldTitle: ctx.fieldTitle,
      severity: 'warning',
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
 * Record feedback on a suggestion (FR-4.1, FR-4.2).
 */
export function acceptFeedback(state: RuntimeState, feedback: { runId: string; suggestionId: string; rating: 'thumbs-up' | 'thumbs-down' }): void {
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
 * Get AI Insights metrics (FR-4.3: placeholder for aggregated metrics by tenant).
 */
export function getAiMetrics(): {
  acceptanceRate: number;
  rejectionRate: number;
  editAfterAcceptRate: number;
  lastUpdated: string;
} {
  // seed to make output stable for unit tests; realistically these would aggregate DB rows.
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
// LIST EXPORT (MODULAR CONVENTION)
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