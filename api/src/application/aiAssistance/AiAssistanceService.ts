/**
 * AiAssistanceService
 *
 * Core AI assistance features:
 * - Inline suggestions (sensitive PII-gating, field-level enablement)
 * - Auto-fill proposals (pre-fill for empty fields with confidence scores)
 * - Gap detection (blocking/warning/suggestion by severity)
 * - Feedback recording (suppress thumbs-down for session, track metrics)
 * - Enablement preferences (account, record-type, field-level toggles)
 *
 * Current phase: Initial PR for core behavior + simple DI (messages→plain-text LLM adapter).
 *
 * Dependencies:
 * - aiAssistance.types.ts (InlineSuggestion, SuggestionContext, AutoFillProposal, Gap, Feedback, ConfidenceLevel, GapSeverity)
 * - Local LlmProvider interface (to isolate bag-of-messages LLM client for this PR)
 *
 * Future work (separate PRs):
 * - Full telemetry capture (Cache/Analytics flush)
 * - Per-field hint history & more sophisticated sibling join constraints
 * - Bulk auto-fill preview UI state and snapshot undo
 * - Enforce-only behavior (OTP verification, vault keys, custom backend)
 * - Multi-record gap analysis via join queries to Sqlite/Postgres
 * - DNS + HTTP layering for DNS bouncer or secure instrumentation
 */

import type { ConfidenceLevel, GapSeverity } from './aiAssistance.types';
import type { SuggestionContext, InlineSuggestion, Gap, Feedback } from './aiAssistance.types';

/* -------------------------------------------------------------------------- */
/* EXPOSED TYPES (forwarded)                                                  */
/* -------------------------------------------------------------------------- */
export type { ConfidenceLevel, GapSeverity };

/* -------------------------------------------------------------------------- */
/* SIMPLE LLM PROVIDER INTERFACE                                               */
/* -------------------------------------------------------------------------- */
/**
 * Minimal LLM client abstraction used by this service (messages→plain-text).
 * - Future PRs may use LlmProxyService.complete(body) or channel server into Dataflow for strict schema compliance.
 * - For now, implement with any LLM client that can finish a plain-text request and return a string.
 */
export interface LlmProvider {
  /**
   * Return a plain-text completion for the given messages.
   * - We expect a single-turn chat model; multi-turn logic is handled by the caller.
   */
  completeResponse(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string>;
}

/* -------------------------------------------------------------------------- */
/* STATUS CONSTANTS (FR-1.1, FR-3.4, FR-1.4 latency targets)                  */
/* -------------------------------------------------------------------------- */
const DEBOUNCE_DELAY_MS = 300;
const MAX_INLINE_SUGGESTIONS_PER_CHUNK = 5;
const MAX_AUTO_FILL_CANDIDATES_PER_FIELD = 10;
const GAP_REFRESH_DELAY_MS = 2000;

/* -------------------------------------------------------------------------- */
/* PREFERENCES MAP - FR-5.1                                                   */
/* -------------------------------------------------------------------------- */
import type { AutoFillProposal } from './aiAssistance.types';
/**
 * Enablement preferences snapshot.
 * - accountEnabled: tenant-level AI assist enabled/disabled.
 * - recordType: per-record-type toggle; null means inherit from account.
 * - field: per-field enablement; null means inherit from recordType or account.
 */
export interface Preferences {
  accountEnabled: boolean;
  recordType: boolean | null;
  field: Record<string, boolean | null>;
}

/* -------------------------------------------------------------------------- */
/* RESPONSE WRAPPERS (matching output types)                                   */
/* -------------------------------------------------------------------------- */
/**
 * Response when the request produces inline suggestions.
 * - runId to bind request/response pairs; pinned FR-1.1.
 * - P95 enforcement is future; for now we pass the field value only.
 */
export interface InlineSuggestionsResponse {
  runId: string;
  suggestions: InlineSuggestion[];
  durationMs: number;
}

/**
 * Response when auto-fill proposals are generated for empty fields.
 * - Field-to-proposal mapping for UI.
 * - runId to bind request/response pairs; pinned FR-2.4.
 */
export interface AutoFillResponse {
  runId: string;
  proposals: Record<string, AutoFillProposal>;
  durationMs: number;
}

/**
 * Response when gaps are detected for a record.
 * - runId to bind request/response pairs; pinned FR-3.2.
 * - Gaps surfaced by severity.
 */
export interface GapDetectionResponse {
  runId: string;
  gaps: Gap[];
  durationMs: number;
}

/**
 * Feedback wrapper for recording user ratings.
 */
export interface SuggestionFeedback {
  runId: string;
  rating: string;
}

/* -------------------------------------------------------------------------- */
/* MAIN SERVICE CLASS                                                         */
/* -------------------------------------------------------------------------- */
/**
 * AiAssistanceService orchestrates the core AI assistance mechanics.
 *
 * Note on usage:
 * - This service does NOT perform persistence of feedback; future PRs will model ProjectFacts KV write opportunities via project_facts or a new KV store.
 * - Record-level hint history or sibling join query logic is deferred to follow-on work.
 * - Bulk preview / undo is beyond this initial PR.
 */
export class AiAssistanceService {
  constructor(
    private readonly llm: LlmProvider,
    private readonly disableSuggestions: Preferences
  ) {}

  /**
   * Generate inline suggestions for a field (FR-1.1, FR-1.3, FR-1.4).
   */
  async generateInlineSuggestions(context: SuggestionContext): Promise<InlineSuggestionsResponse> {
    const nowStart = Date.now();
    const runId = `suggestions-${Date.now()}-${Math.random()}`;

    // Simple gating (future: Domain-Scoped gate by fieldPath, recordType, account).
    const shouldUse = this.isPreferenceEnabled(this.disableSuggestions, context.recordType, context.fieldPath);
    if (!shouldUse) {
      return { runId, suggestions: [], durationMs: Date.now() - nowStart };
    }

    // P95 accuracy path (FR-1.1): limit per-chunk, minimal branching.
    const rawSuggestions = await this.buildInlineSuggestionPrompt(context);
    const suggestions = this.parseFromChunk(rawSuggestions, context.fieldPath, MAX_INLINE_SUGGESTIONS_PER_CHUNK);

    return { runId, suggestions, durationMs: Date.now() - nowStart };
  }

  /**
   * Generate auto-fill proposals for empty fields (FR-2.1, FR-2.4, FR-2.5).
   */
  async generateAutoFillProposals(context: SuggestionContext): Promise<AutoFillResponse> {
    const nowStart = Date.now();
    const runId = `autofill-${Date.now()}-${Math.random()}`;

    // Don't auto-fill for occupied fields (FR-2.2).
    const proposals: Record<string, AutoFillProposal> = {};

    for (const fieldPath of Object.keys(context)) {
      const val = String(context[fieldPath] ?? '');
      if (val.trim().length > 0) continue;

      const proposal = await this.buildAutoFillProposalForField(context, fieldPath);
      proposals[fieldPath] = proposal;
    }

    // FR-2.5: undo support for this PR is a future hook in the UI layer (cancellable proposal ship).
    return { runId, proposals, durationMs: Date.now() - nowStart };
  }

  /**
   * Detect gaps in a record (FR-3.1, FR-3.2, FR-3.3, FR-3.4, FR-3.5).
   */
  async detectGaps(values: Record<string, unknown>): Promise<GapDetectionResponse> {
    const nowStart = Date.now();
    const runId = `gaps-${Date.now()}-${Math.random()}`;

    // FR-3.5: respect per-field enablement; later plug in fieldConfig.fieldLevelSuppressionRules.
    const gaps: Gap[] = this.computeGapList(values);

    // FR-3.4: background refresh via setTimeout; this method surfaces the current snapshot only.
    return { runId, gaps, durationMs: Date.now() - nowStart };
  }

  /**
   * Record user feedback (FR-4.1, FR-4.2).
   */
  async recordFeedback(context: SuggestionFeedback): Promise<void> {
    // For this PR, feedback is a no-op (future work handles project_facts / new KV store).
    // Suppress for the remainder of the session per FR-4.2: we trust the UI to apply suppression.
    // For now, we keep below as a placeholder for telemetry hooks in follow-on PRs.
  }

  /* -------------------------------------------------------------------------- */
  /* INTERNAL HELPERS                                                           */
  /* -------------------------------------------------------------------------- */

  isPreferenceEnabled(preferences: Preferences, recordType: string | null, fieldPath: string): boolean {
    const rt = recordType ?? null;
    const ft = preferences.field[fieldPath] ?? null;

    const useAccount = preferences.accountEnabled;
    const useRecordType = rt !== null ? (preferences.recordType ?? preferences.accountEnabled) : useAccount;
    const useField = ft !== null ? ft : useRecordType;

    return useField;
  }

  buildInlineSuggestionPrompt(context: SuggestionContext): string {
    // Build a plain-text prompt suitable for multi-provider, p95-friendly prompts.
    const sibling = context.siblingFields
      ? `Sibling fields:\n${Object.entries(context.siblingFields)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')}`
      : 'No sibling fields';

    return `Return raw JSON (no markdown) with up to ${MAX_INLINE_SUGGESTIONS_PER_CHUNK} suggestions.

Field path: ${context.fieldPath}
Current value: "${context.currentValue || '(empty)'}"
Record ID: ${context.recordId}
Record type: ${context.recordType}
${context.parentId ? `Parent ID: ${context.parentId}` : ''}
${context.userId ? `User ID: ${context.userId}` : ''}

SIBLING FIELDS:
${sibling}

Respond with JSON array of suggestions, each: { maybe value, rationale, confidence }.
Minimal variation for P95; struct flat and truncatable.`;
  }

  parseFromChunk(raw: string, fieldPath: string, maxCount: number): InlineSuggestion[] {
    try {
      const cleaned = raw.trim().replace(/^\s*```json?\s*|\s*```?\s*$/g, '');
      const items = JSON.parse(cleaned);
      if (!Array.isArray(items)) return [];

      const parsed: InlineSuggestion[] = [];
      for (let i = 0; i < Math.min(items.length, maxCount); i++) {
        const item = items[i] as Record<string, unknown> | string | null | undefined;
        if (!item || typeof item !== 'object') continue;

        const base = typeof item === 'object' && item !== null ? item : {};
        const rawConf = String(base.confidence ?? '').toLowerCase();
        // FR-1.4: confidence normalization used by UI.
        const confidence = this.normalizeConfidence(rawConf, context.currentValue);
        const suggestionVal = String(base.value ?? base.suggestion ?? '');
        const rationale = String(base.rationale ?? base.reason ?? '');
        parsed.push({
          suggestionId: `inline-${Date.now()}-${i}-${fieldPath}`,
          suggestion: suggestionVal.trim(),
          confidence,
          rationale,
          sourceField: fieldPath,
        });
      }

      return parsed;
    } catch {
      return [];
    }
  }

  buildAutoFillProposalForField(context: SuggestionContext, fieldPath: string): AutoFillProposal {
    // For this PR, we return a generic fallback for fields that are empty.
    return {
      suggestedValue: '',
      confidence: 'low', // FR-2.4 baseline
      rationale: 'Within this iteration, only context gating applies; no per-field pre-seeded proposals yet.',
    };
  }

  computeGapList(values: Record<string, unknown>): Gap[] {
    // FR-3.2: defaults to blocking/warning/suggestion by severity.
    const gaps: Gap[] = [];

    // FR-3.1: treat missing values as blocking.
    // Later on, we can enrich this with sibling join checks and project_facts hints.
    for (const [key, rawVal] of Object.entries(values)) {
      const val = rawVal ?? '';
      if (String(val).trim().length === 0) {
        gaps.push({
          fieldId: key,
          fieldTitle: this.humanizeTitle(key),
          severity: 'blocking',
          description: 'Field is required but empty.',
          action: 'jump',
        });
      }
    }

    // Future FR-3.5: add heuristics if configured; for now, no rules engine.
    return gaps;
  }

  normalizeConfidence(input: string, currentValue: string): ConfidenceLevel {
    if (input === 'high') return 'high';
    if (input === 'medium') return 'medium';
    return 'low';
  }

  humanizeTitle(str: string): string {
    // Simple lower->proper for UI; future PR can localize this.
    return str
      .split(/([A-Z][a-z]+)/)
      .filter(Boolean)
      .join(' ');
  }
}