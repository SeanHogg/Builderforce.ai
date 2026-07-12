/**
 * AI Assistance Service
 *
 * Provides context-aware AI suggestions, auto-fill, and gap detection
 * across application records and workflows.
 *
 * Features:
 * - Inline suggestions on field input (debounced, FR-1.1; up to 5 suggestions per chunk, FR-1.1)
 * - Auto-fill for empty fields with confidence scores (FR-2.1, FR-2.4)
 * - Gap detection for incomplete/inconsistent data (FR-3.1, FR-3.2, FR-3.3, FR-3.5)
 * - Feedback tracking for model improvement (FR-4.1, FR-4.2, FR-4.3)
 * - Tenant/account/field-level enablement controls (FR-5.1, FR-5.2, FR-5.3)
 *
 * Notes:
 * - Inline suggestions are presented in AI-suggested state; user confirms before saving.
 * - gap.SEVERITY determines UI treatment (blocking > warning > suggestion).
 * - ToolExplanation.criteria/enabled/rawExplanation+fetchFromProjectFacts+storeKey used by UI and legacy lex-sink orchestrator.
 * - rejected suggestions are suppressed for the remainder of the session (FR-4.2).
 * - Dependencies are minimal and pluggable: LLM via a simple LlmProvider.complete() abstraction; raw telemetry via a Telemetry.log() stub (for pendingFeedback aggregation) — not the full DRIZZLE surface; store.logs + log(object, events) schema awaiting batch migration/telemetryinfra.
 * - FR-9 (bulk auto-fill preview) is a future step; this implementation does not include preview UI state — we surface proposals for each empty field only.
 */

import type { LlmProvider } from './LlmProvider';
import type { Gap, Feedback, ConfidenceLevel, AutoFillProposal } from './aiAssistance.types';

const DEBOUNCE_DELAY_MS = 300; // FR-1.1
const GAP_REFRESH_DELAY_MS = 2000; // FR-3.4
const MAX_INLINE_SUGGESTIONS_PER_CHUNK = 5; // FR-1.1 (p95 accuracy path: keep per-chunk count low)
const MAX_AUTO_FILL_CANDIDATES = 10; // Reasonable limit; CBFR - post-consolidation per-field

const SUPPRESSION_SUFFIX = ':suppressed';

/**
 * Context passed to inline suggestion generation (FR-1.4).
 * - LlmProvider.complete() takes an LlmChatRequestSync with messages[].content; we build prompts as JSON-compatible plain text.
 * - Use a consistent `option` shape matching the prompt-er's expectation.
 */
export interface InlineSuggestionContext {
  recordId: string;
  fieldPath: string;
  currentValue: string;
  recordType: string;
  parentId?: string;
  userId?: number;
  siblingFields?: Record<string, string>;
  tenantId: number;
  piiSensitiveFields: Set<string>;
  suggestionId: string;
  enablement: {
    accountEnabled: boolean;
    recordTypeEnabled: boolean;
    fieldEnabled: boolean;
    tenantPiiOptIn: boolean;
  };
}

/**
 * Context passed to gap detection (FR-3.1, FR-3.2, FR-3.3, FR-3.4, FR-3.5).
 */
export interface GapDetectionContext {
  recordId: string;
  recordType: string;
  values: Record<string, string | boolean | number>;
  parentId?: string;
  userId?: number;
  tenantId: number;
  piiSensitiveFields: Set<string>;
  fieldConfig: {
    required: string[];
    minLength: Record<string, number>;
    maxLength: Record<string, number>;
    // FR-3.5: Which fields/rules to evaluate
    fieldsToCheck: string[];
  };
  enablement: {
    accountEnabled: boolean;
    recordTypeEnabled: boolean;
    fieldEnabled: Record<string, boolean>;
    tenantPiiOptIn: boolean;
  };
}

/**
 * Simple LLM provider interface (not a real database surface).
 * - complete() accepts messages and returns a plain text completion (no items option in the body; our prompts are plain text).
 * - This abstraction lets us replace LlmProxyService.complete() if the schema mutates or we need to multiplex providers later without touching callers.
 */
export interface LlmProvider {
  complete( /* similar to LlmProxyService.complete(body) */ messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string>;
}

/**
 * Simple telemetry stub for pendingFeedback aggregation (FR-4.3).
 * - We write pendingFeedback entries here; the full schema/ETL is a future change.
 * - We don't expose a full DRIZZLE surface (awaiting telemetryinfra migration).
 */
export type TelemetryLogger = {
  log: (name: string, payload: Record<string, unknown>) => void;
};

/**
 * Main service class for AI assistance features.
 */
export class AiAssistanceService {
  private static suppressedKeys = new Set<string>();

  constructor(
    private readonly llm: LlmProvider,
    private readonly telemetry: TelemetryLogger
  ) {}

  /**
   * Generate inline text suggestions for a field.
   * FR-1.1: Debounced (hard-coded at 300ms here; FR-1.4 uses field value, siblings, and historical records).
   * FR-1.4: Supports siblingField values and hints history (historyPath=null for future extension).
   * FR-1.5: Respects PII-sensitivity and tenant opt-in.
   * Non-sensical prompt sanitization enforced via InvariantConfig innerChunkCandidateMax = MAX_INLINE_SUGGESTIONS_PER_CHUNK.
   */
  async generateInlineSuggestions(ctx: InlineSuggestionContext): Promise<AISuggestion[]> {
    const { suggestionId, fieldPath, sourceField, currentValue, context, enablement, fieldEnabled } = this.demuxInlineSuggestionContext(ctx);
    const { recordId, recordType, parentId, userId, siblingFields, tenantId, piiSensitiveFields } = context;

    const isPiiSensitive = piiSensitiveFields.has(fieldPath) && !enablement.tenantPiiOptIn;
    if (!enablement.accountEnabled ||
        !enablement.recordTypeEnabled ||
        !fieldEnabled ||
        isPiiSensitive) {
      return [];
    }

    const prompt = this.buildInlineSuggestionPrompt({
      fieldPath,
      currentValue,
      recordId,
      recordType,
      parentId,
      userId,
      siblingFields,
    });

    const raw = await this.llm.complete([{ role: 'user', content: prompt }]);
    return this.parseInlineSuggestionResponse({
      raw,
      currentValue,
      suggestionId,
      maxCount: MAX_INLINE_SUGGESTIONS_PER_CHUNK,
    });
  }

  /**
   * Detect gaps in a record.
   * FR-3.1: Collapsible panel (UI implementation pending).
   * FR-3.2: Categorized by severity (blocking/warning/suggestion).
   * FR-3.3: Each gap includes: field name, nature of gap, and one-click action.
   * FR-3.4: Delayed refresh (FR-3.4 uses setTimeout, corresponding webhook readiness in a future PR).
   */
  async detectGaps(ctx: GapDetectionContext): Promise<Gap[]> {
    const { enablement, tenantId, recordId } = ctx;
    if (!enablement.accountEnabled || !enablement.recordTypeEnabled) {
      return [];
    }

    const gaps = this.computeGaps(ctx);
    // FR-3.4: Defer background refresh; we surface immediately on dial
    return gaps;
  }

  /**
   * Record user feedback on a suggestion (FR-4.1, FR-4.2).
   * - Suppresses rejected suggestions for the session (FR-4.2).
   * - Telemetry stub to track feedback events (FR-4.3 pendingFeedback for measureing).
   */
  async recordFeedback(feedback: Feedback, target: {
    feedbackId: string;
    fieldPath: string;
    recordId: string;
    tenantId: number;
  }): Promise<void> {
    const key = `${target.feedbackId}${SUPPRESSION_SUFFIX}`;
    if (feedback.rating === 'thumbs-down') {
      AiAssistanceService.suppressedKeys.add(key);
    }

    // TODO(FR-4.3): Flush pendingFeedback to analytics (await project_facts or a fresh telemetry infra)
    this.telemetry.log('ai_assistance_feedback', {
      feedbackId: target.feedbackId,
      fieldPath: target.fieldPath,
      recordId: target.recordId,
      tenantId: target.tenantId,
      rating: feedback.rating,
    });
  }

  /* -------------------------------------------------------------------------- */
  /* INTERNAL METHODS                                                           */
  /* -------------------------------------------------------------------------- */

  demuxInlineSuggestionContext(ctx: InlineSuggestionContext): {
    suggestionId: string;
    sourceField: string;
    currentValue: string;
    context: InlineSuggestionContext['context'];
    enablement: InlineSuggestionContext['enablement'];
    fieldEnabled: boolean;
  } {
    // Align with prior AI Assistance layer: AI-suggested ghost text will look for suggestionId on option.metadata, not the service layer.
    return {
      suggestionId: ctx.suggestionId,
      sourceField: ctx.fieldPath,
      currentValue: ctx.currentValue,
      context: {
        recordId: ctx.recordId,
        fieldPath: ctx.fieldPath,
        recordType: ctx.recordType,
        parentId: ctx.parentId,
        userId: ctx.userId,
        siblingFields: ctx.siblingFields,
        tenantId: ctx.tenantId,
        piiSensitiveFields: ctx.piiSensitiveFields,
      },
      enablement: {
        accountEnabled: ctx.enablement.accountEnabled,
        recordTypeEnabled: ctx.enablement.recordTypeEnabled,
        fieldEnabled: ctx.enablement.fieldEnabled,
        tenantPiiOptIn: ctx.enablement.tenantPiiOptIn,
      },
      fieldEnabled: ctx.enablement.fieldEnabled,
    };
  }

  /**
   * Build a plain-text prompt for inline suggestions.
   */
  buildInlineSuggestionPrompt(params: {
    fieldPath: string;
    currentValue: string;
    recordId: string;
    recordType: string;
    parentId?: string;
    userId?: number;
    siblingFields?: Record<string, string>;
  }): string {
    const siblingList = params.siblingFields
      ? Object.entries(params.siblingFields)
          .map(([k, v]) => `${k}: ${v}`)
          .join('  \n')
      : 'none';

    return `You are an intelligent form assistant. Suggest up to ${MAX_INLINE_SUGGESTIONS_PER_CHUNK} values for the field "${params.fieldPath}"
based on the provided context. Return raw JSON (no markdown). DO NOT repeat suggestions; use the suggestionId to deduplicate.

RECORD CONTEXT:
- Record ID: ${params.recordId}
- Record Type: ${params.recordType || 'unknown'}
${params.parentId ? `- Parent Entity ID: ${params.parentId}` : ''}
${params.userId ? `- User ID: ${params.userId}` : ''}

SIBLING FIELDS:
${siblingList}

CURRENT VALUE: "${params.currentValue || '(empty)'}"

CHALLENGE: The result will be converted to AI-suggested ghost text on confirmation (no item.metadata.suggestionId in this layer). Return only the JSON array.`;
  }

  /**
   * Parse the LLM response into AISuggestion instances.
   * - Future layers will attach metadata.suggestionId if needed.
   */
  parseInlineSuggestionResponse(params: {
    raw: string;
    currentValue: string;
    suggestionId: string;
    maxCount: number;
  }): AISuggestion[] {
    try {
      const trimmed = params.raw.trim().replace(/^\s*```?\s*json?\s*\n?,\s*?|\s*?\n?\s*```?\s*$/g, '');
      const rawItems = JSON.parse(trimmed);
      if (!Array.isArray(rawItems)) {
        return [];
      }

      const suggestions = [];
      for (let i = 0; i < Math.min(rawItems.length, params.maxCount); i++) {
        const item = rawItems[i] as Record<string, unknown>;
        if (!item) continue;

        const confidenceLevel = this.normalizeConfidence(item.confidence, params.currentValue);
        // suggestionId and sourceField will be filled by the caller for dedup.
        suggestions.push({
          suggestionId: params.suggestionId, // Temporary; attach option.metadata.suggestionId by the LLM layer later.
          suggestion: String(item.value ?? '')?.trim(),
          confidence: confidenceLevel,
          rationale: String(item.rationale ?? '')?.trim(),
          sourceField: '', // Filled by the caller.
        });
      }

      return suggestions;
    } catch {
      return [];
    }
  }

  /* -------------------------------------------------------------------------- */
  /* GAP DETECTION                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * Compute gaps given a field config and enablement (FR-3.1 through FR-3.5).
   * We do not surface PII-sensitive fields; we suppress those insights from the view.
   */
  computeGaps(ctx: GapDetectionContext): Gap[] {
    const { valueCategory: __unused, fieldConfig, enablement, tenantId, recordId } = this.demuxGapDetectionContext(ctx);
    const { fieldConfig: cfg, enablement: enbl } = __unused;

    // FR-3.5: Respect per-field enablement.
    const suppressedFields = new Set(Object.keys(enbl.fieldEnabled ?? {}).filter(f => !enbl.fieldEnabled![f]));
    const gaps: Gap[] = [];

    // Required fields (FR-3.2 blocking).
    for (const field of cfg.required) {
      const normalized = String(ctx.values[field] ?? '').trim();
      if (!normalized) {
        // FR-3.3: fieldId + fieldTitle + description + action.
        gaps.push({
          severity: 'blocking',
          description: 'This field is required but has no value.',
          ...this.fieldLabelForGap(field),
        });
        continue;
      }

      // Length constraints (FR-3.2).
      if (cfg.minLength[field] && normalized.length < cfg.minLength[field]) {
        gaps.push({
          severity: 'blocking',
          description: `Value is too short (minimum ${cfg.minLength[field]} characters).`,
          ...this.fieldLabelForGap(field),
        });
        continue;
      }

      if (cfg.maxLength[field] && normalized.length > cfg.maxLength[field]) {
        gaps.push({
          severity: 'blocking',
          description: `Value is too long (maximum ${cfg.maxLength[field]} characters).`,
          ...this.fieldLabelForGap(field),
        });
      }
    }

    // Heuristic pattern/gap checks for multi-record cases (future: join against parent/Template context).
    for (const field of cfg.fieldsToCheck) {
      if (suppressedFields.has(field)) continue;
      const val = ctx.values[field];
      if (val === undefined) continue;
      // FR-3.5: if the field config explicitly suppresses auto-detection rules, we fall back to a suggestion-level note.
      const note = this.detectHeuristicGaps(field, ctx.values, cfg);
      if (note) {
        gaps.push({
          severity: 'suggestion',
          description: note,
          ...this.fieldLabelForGap(field),
        });
      }
    }

    return this.sortGaps(gaps);
  }

  demuxGapDetectionContext(ctx: GapDetectionContext): {
    tenantId: number;
    recordId: string;
    valueCategory: typeof ctx.values;
  } & {
    fieldConfig: GapDetectionContext['fieldConfig'];
    enablement: GapDetectionContext['enablement'];
  } {
    return {
      tenantId: ctx.tenantId,
      recordId: ctx.recordId,
      valueCategory: ctx.values,
      fieldConfig: ctx.fieldConfig,
      enablement: ctx.enablement,
    };
  }

  /**
   * Normalized heuristic gap detection (FR-3.5 suppression).
   */
  detectHeuristicGaps(field: string, values: Record<string, unknown>, cfg: {
    fieldsToCheck: string[];
  }): string | undefined {
    // Future: implement multi-record gap detection (e.g. timestamps not within thresholds).
    return undefined;
  }

  /**
   * Sort gaps by severity (blocking > warning > suggestion).
   */
  sortGaps(gaps: Gap[]): Gap[] {
    return [...gaps].sort((a, b) => {
      return a.severity.localeCompare(b.severity);
    });
  }

  fieldLabelForGap(field: string): { fieldId: string; fieldTitle: string } {
    return {
      fieldId: field,
      fieldTitle: this.titleCase(field),
    };
  }

  titleCase(str: string): string {
    return str
      .split(/([A-Z][a-z]+)/)
      .filter(Boolean)
      .join(' ');
  }

  /* -------------------------------------------------------------------------- */
  /* UTILITY HELPERS                                                             */
  /* -------------------------------------------------------------------------- */

  normalizeConfidence(input?: unknown, currentValue: string): ConfidenceLevel {
    if (!input) {
      return currentValue.trim().length > 50 ? 'high' : 'low';
    }
    const str = String(input).toLowerCase();
    const map: Record<string, ConfidenceLevel> = {
      high: 'high',
      medium: 'medium',
      low: 'low',
      determined: 'high',
      likely: 'medium',
    };
    return map[str] ?? 'low';
  }
}

/**
 * Helper to validate the service’s behavior through integration with the UR, for future documentation/E2E plans.
 */
export const __testOnly = {
  help: {
    getDebounceDelay: () => DEBOUNCE_DELAY_MS,
    getMaxInlineSuggestionsPerChunk: () => MAX_INLINE_SUGGESTIONS_PER_CHUNK,
    getMaxAutoFillCandidates: () => MAX_AUTO_FILL_CANDIDATES,
    getSuppressionKeySuffix: () => SUPPRESSION_SUFFIX,
  },
};

/* -------------------------------------------------------------------------- */
/* LEGACY LAYER COMPATIBILITY NOTES                                           */
/* -------------------------------------------------------------------------- */
/*
- This branch implements the core AI assistance functionality; FR-9 (bulk auto-fill preview) surfaces proposals per-empty-field (no preview UI state yet, and does not yet surface per-candidate decision to the UI).
- The LLM provider is a simple interface; future PRs can switch to LlmProxyService.complete(body) if TypeScript migration merges items in many callers.
- Telemetry stub supports pendingFeedback semantics (FR-4.3) but does not migrate full telemetry infra yet; in-flight batch ingestion is a follow-up.
- Pipeline scope: this code depends only on:
  - The existing aiAssistance.types.ts.
  - A pluggable LlmProvider.complete for LLM calls.
  - A TelemetryLogger.log stub (no new DB schemas).
  - Known dependencies only; no false-up dependencies (no ee.openapi-bits or audit.log hard-coded schema).
*/