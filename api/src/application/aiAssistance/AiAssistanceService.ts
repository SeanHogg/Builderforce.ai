/**
 * AI Assistance Service
 * 
 * Provides context-aware AI suggestions, auto-fill, and gap detection
 * across application records and workflows.
 * 
 * Features:
 * - Inline suggestions on field input (debounced)
 * - Auto-fill for empty fields with confidence scores
 * - Gap detection for incomplete/inconsistent data
 * - Feedback tracking for model improvement
 * - Tenant/account/field-level enablement controls
 */

import { BrainService } from '../brain/BrainService';
import { Logger } from '../logger/Logger';
import {
  AISuggestion,
  AutoFillProposal,
  Gap,
  GapSeverity,
  Feedback,
  EnablementLevel,
} from './aiAssistance.types';

export class AiAssistanceService {
  private readonly debounceDelay = 300; // FR-1.1
  private readonly gapRefreshDelay = 2000;
  private readonly maxSuggestions = 5;
  private readonly maxAutoFillCandidates = 10;

  constructor(
    private readonly llmService: BrainService,
    private readonly logger: Logger
  ) {}

  /**
   * Generate inline text suggestions for a field
   * FR-1.1: Debounced (default 300ms)
   * FR-1.4: Uses field value, sibling values, and historical records
   * FR-1.5: Respects PII-sensitivity and tenant opt-in
   */
  async generateInlineSuggestions(
    recordId: string,
    fieldPath: string,
    currentValue: string,
    context: {
      recordType: string;
      parentId?: string;
      userId?: number;
      siblingFields?: Record<string, string>;
      tenantId: number;
      piiSensitiveFields: Set<string>;
    },
    enablement: {
      accountEnabled: boolean;
      recordTypeEnabled: boolean;
      fieldEnabled: boolean;
      tenantPiiOptIn: boolean;
    }
  ): Promise<AISuggestion[]> {
    // Check enablement constraints
    const isEnabled =
      enablement.accountEnabled &&
      enablement.recordTypeEnabled &&
      enablement.fieldEnabled;

    // Respect PII opt-in
    if (context.piiSensitiveFields.has(fieldPath) && !enablement.tenantPiiOptIn) {
      this.logger.debug('PII field suggestions suppressed due to tenant opt-out');
      return [];
    }

    if (!isEnabled) {
      this.logger.debug(
        `Suggestions disabled: account=${enablement.accountEnabled}, ` +
          `recordType=${enablement.recordTypeEnabled}, field=${enablement.fieldEnabled}`
      );
      return [];
    }

    // Use LLM gateway to generate suggestions
    const prompt = this.buildInlineSuggestionPrompt(
      recordId,
      fieldPath,
      currentValue,
      context,
      enablement.fieldEnabled
    );

    const rawSuggestions = await this.llmService.query(prompt);

    return this.parseSuggestionResponse(rawSuggestions, currentValue);
  }

  private buildInlineSuggestionPrompt(
    recordId: string,
    fieldPath: string,
    currentValue: string,
    context: {
      recordType: string;
      parentId?: string;
      userId?: number;
      siblingFields?: Record<string, string>;
    },
    fieldEnabled: boolean
  ): string {
    const siblingContext =
      context.siblingFields &&
      Object.entries(context.siblingFields)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');

    return `You are an intelligent form assistant. Generate ${this.maxSuggestions}
contextual text suggestions for the field "${fieldPath}" based on the available context.

RECORD CONTEXT:
- Record ID: ${recordId}
- Record Type: ${context.recordType || 'unknown'}
${context.parentId ? `- Parent Entity ID: ${context.parentId}` : ''}
${context.userId ? `- User ID: ${context.userId}` : ''}
${siblingContext ? `\nSIBLING FIELDS:\n${siblingContext}` : ''}

CURRENT FIELD VALUE: "${currentValue || '(empty)'}"

${!fieldEnabled ? 'NOTE: This field has AI suggestions explicitly disabled by user preferences.' : ''}

REQUIREMENTS:
- Return exactly ${this.maxSuggestions} JSON objects, each with:
  - suggestion: text string (clean, no markdown)
  - confidence: "high" | "medium" | "low"
  - rationale: brief explanation (1-2 sentences, highlights where it comes from)

Return ONLY the JSON array, no other text.`;
  }

  private parseSuggestionResponse(raw: string, currentValue: string): AISuggestion[] {
    try {
      const trimmed = raw.trim().replace(/^```json\s*|\s*```$/g, '');
      const suggestions = JSON.parse(trimmed);

      if (Array.isArray(suggestions)) {
        return suggestions.slice(0, this.maxSuggestions).map(s => ({
          suggestion:
            typeof s.suggestion === 'string' ? s.suggestion : 'Empty suggestion',
          confidence: this.normalizeConfidence(s.confidence, currentValue),
          rationale:
            typeof s.rationale === 'string' ? s.rationale : 'No rationale provided',
          sourceField: fieldPath,
        }));
      }
    } catch (e) {
      this.logger.error('Failed to parse suggestion response', { error: e, raw });
    }

    return [];
  }

  private normalizeConfidence(input?: string, currentValue: string): 'high' | 'medium' | 'low' {
    if (!input) {
      return currentValue.trim().length > 50 ? 'high' : 'low';
    }
    const upper = (input as string).toLowerCase();
    if (upper.includes('high') || upper.includes('determined')) {
      return 'high';
    }
    if (upper.includes('medium') || upper.includes('likely')) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Generate auto-fill proposals for empty fields
   * FR-2.1: Based on record type, parent entities, templates
   * FR-2.4: Returns confidence scores and rationale per proposal
   */
  async generateAutoFillProposals(
    recordId: string,
    recordType: string,
    context: {
      parentId?: string;
      templateId?: string;
      userId?: number;
      existingValues: Record<string, string>;
      tenantId: number;
    },
    enablement: {
      accountEnabled: boolean;
      recordTypeEnabled: boolean;
      tenantPiiOptIn: boolean;
    }
  ): Promise<Map<string, AutoFillProposal>> {
    const proposals = new Map<string, AutoFillProposal>();

    // Only generate for empty fields
    const emptyFields = Object.entries(context.existingValues).filter(
      ([k, v]) => !v || v.trim().length === 0
    );

    if (emptyFields.length === 0) {
      return proposals;
    }

    const prompt = this.buildAutoFillPrompt(
      recordId,
      recordType,
      context,
      emptyFields.map(([k]) => k),
      enablement
    );

    const rawResponse = await this.llmService.query(prompt);
    return this.parseAutoFillResponse(rawResponse, emptyFields.map(([k]) => k));
  }

  private buildAutoFillPrompt(
    recordId: string,
    recordType: string,
    context: {
      parentId?: string;
      templateId?: string;
      userId?: number;
      existingValues: Record<string, string>;
    },
    emptyFields: string[],
    enablement: {
      accountEnabled: boolean;
      recordTypeEnabled: boolean;
      tenantPiiOptIn: boolean;
    }
  ): string {
    const existingValuesText =
      Object.entries(context.existingValues)
        .map(([k, v]) => `${k}: ${v || '(empty)'}`)
        .join('\n');

    return `You are an intelligent form auto-filler. Generate pre-populated suggestions
for ${emptyFields.length} empty fields in a "${recordType}" record.

RECORD CONTEXT:
- Record ID: ${recordId}
- Record Type: ${recordType}
${context.parentId ? `- Parent Entity ID: ${context.parentId}` : ''}
${context.templateId ? `- Template ID: ${context.templateId}` : ''}
${context.userId ? `- User ID: ${context.userId}` : ''}

EXISTING VALUES:
${existingValuesText || '(none)'}

EMPTY FIELDS TO FILL:
${emptyFields.map(f => `  - ${f}`).join('\n')}

RETURN FORMAT (JSON array):
[
  {
    "fieldPath": "field-name",
    "suggestedValue": "auto-filled text (clean, no markdown)",
    "confidence": "high" | "medium" | "low",
    "rationale": "brief explanation (1-2 sentences, references similar records or patterns)"
  }
]

Constraints:
- Always return exactly ${emptyFields.length} entries (one per field)
- Confidence should be "high" when similar records show strong pattern,
  "medium" when plausible but not strongly patterned,
  "low" when data is sparse or uncertain
- Rationale must reference "similar records" and explain why this value fits
- Return ONLY the JSON array, no other text.`;
  }

  private parseAutoFillResponse(
    raw: string,
    expectedFields: string[]
  ): Map<string, AutoFillProposal> {
    const proposals = new Map<string, AutoFillProposal>();

    try {
      const trimmed = raw.trim().replace(/^```json\s*|\s*```$/g, '');
      const result = JSON.parse(trimmed);

      if (Array.isArray(result)) {
        result.forEach(proposal => {
          if (proposal.fieldPath && expectedFields.includes(proposal.fieldPath)) {
            proposals.set(proposal.fieldPath, {
              suggestedValue:
                typeof proposal.suggestedValue === 'string'
                  ? proposal.suggestedValue
                  : '',
              confidence: this.normalizeConfidence(proposal.confidence),
              rationale:
                typeof proposal.rationale === 'string'
                  ? proposal.rationale
                  : '',
            });
          }
        });
      }
    } catch (e) {
      this.logger.error('Failed to parse auto-fill response', { error: e, raw });
    }

    return proposals;
  }

  /**
   * Detect gaps (missing/incomplete/inconsistent data) in a record
   * FR-3.1: Background analysis, collapsible panel
   * FR-3.2: Gaps categorized by severity (blocking/warning/suggestion)
   * FR-3.3: Each gap includes field name, nature, and jump-action
   */
  async detectGaps(
    recordId: string,
    recordType: string,
    values: Record<string, string | boolean | number>,
    context: {
      parentId?: string;
      userId?: number;
      tenantId: number;
      piiSensitiveFields: Set<string>;
      fieldConfig: {
        required: string[];
        minLength: Record<string, number>;
        maxLength: Record<string, number>;
        multipleOf?: Record<string, number>;
        fieldsToCheck: string[];
      };
    },
    enablement: {
      accountEnabled: boolean;
      recordTypeEnabled: boolean;
      fieldEnabled: Record<string, boolean>;
      tenantPiiOptIn: boolean;
    }
  ): Promise<Gap[]> {
    if (!enablement.accountEnabled || !enablement.recordTypeEnabled) {
      return [];
    }

    const gaps: Gap[] = [];

    // Check required fields
    context.fieldConfig.required.forEach(field => {
      if (!values[field] || String(values[field]).trim().length === 0) {
        gaps.push({
          fieldId: field,
          fieldTitle: this.fieldTitleFromPath(field),
          severity: 'blocking',
          description: 'This field is required but has no value.',
          action: 'jump',
        });
      }
    });

    // Check field-level constraints
    context.fieldConfig.fieldsToCheck.forEach(field => {
      if (values[field] !== undefined) {
        const val = String(values[field]);
        const minLength = context.fieldConfig.minLength[field];
        const maxLength = context.fieldConfig.maxLength[field];

        if (minLength && val.length < minLength) {
          gaps.push({
            fieldId: field,
            fieldTitle: this.fieldTitleFromPath(field),
            severity: 'blocking',
            description: `Value is too short (minimum ${minLength} characters).`,
            action: 'jump',
          });
        }

        if (maxLength && val.length > maxLength) {
          gaps.push({
            fieldId: field,
            fieldTitle: this.fieldTitleFromPath(field),
            severity: 'blocking',
            description: `Value is too long (maximum ${maxLength} characters).`,
            action: 'jump',
          });
        }
      }
    });

    // Heuristic: detect inconsistent values
    if (context.parentId) {
      // Add logic for consistency checks here after parent data is joined
      // For now, wildcard gaps for fields with multiple similar records
    }

    // Check field-level enablement
    context.fieldConfig.fieldsToCheck.forEach(field => {
      if (!enablement.fieldEnabled[field]) {
        gaps.push({
          fieldId: field,
          fieldTitle: this.fieldTitleFromPath(field),
          severity: 'suggestion',
          description: 'This field is non-standard for this record type.',
          action: 'info',
        });
      }
    });

    // Sort by severity (blocking > warning > suggestion)
    const severityOrder: Record<GapSeverity, number> = {
      blocking: 3,
      warning: 2,
      suggestion: 1,
    };

    return gaps.sort((a, b) =>
      severityOrder[b.severity] - severityOrder[a.severity]
    );
  }

  /**
   * Record user feedback on a suggestion
   * FR-4.1: Thumbs-up/down control per suggestion
   * FR-4.2: Rejected suggestions suppressed for session
   * FR-4.3: Metrics aggregated for AI Insights dashboard
   */
  async recordFeedback(
    feedback: Feedback,
    context: {
      recordId: string;
      fieldPath: string;
      suggestionId: string;
      tenantId: number;
    }
  ): Promise<void> {
    // In-memory suppression for rejected suggestions (session-level)
    AiAssistanceService.suppressedSuggestions
      .add(`${context.tenantId}:${feedback.suggestionId}`);

    // Persist metrics for analytics (would connect to telemetry service)
    this.logger.info('Feedback recorded', {
      recordId: context.recordId,
      fieldPath: context.fieldPath,
      suggestionId: context.suggestionId,
      feedback: feedback.rating,
    });

    // Store for aggregated metrics in future analytics integration
    AiAssistanceService.pendingFeedback.push({
      tenantId: context.tenantId,
      recordId: context.recordId,
      fieldPath: context.fieldPath,
      rating: feedback.rating,
      timestamp: new Date(),
    });
  }

  /**
   * Get pending feedback metrics for AI Insights dashboard
   * FR-4.3: Display acceptance rate, rejection rate, edit-after-accept rate
   */
  async getFeedbackMetrics(
    tenantId: number,
    daysAgo: number = 1
  ): Promise<{
    totalFeedback: number;
    acceptanceRate: number;
    rejectionRate: number;
    nestedGroups: {
      fieldPath: string;
      acceptanceRate: number;
      rejectionRate: number;
      total: number;
    }[];
  }> {
    // Filter pending feedback to time window
    const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const relevant = AiAssistanceService.pendingFeedback.filter(
      f => f.tenantId === tenantId && f.timestamp >= cutoff
    );

    const total = relevant.length;

    if (total === 0) {
      return {
        totalFeedback: 0,
        acceptanceRate: 0,
        rejectionRate: 0,
        nestedGroups: [],
      };
    }

    const accepted = relevant.filter((f) => f.rating === 'thumbs-up').length;
    const rejected = relevant.filter((f) => f.rating === 'thumbs-down').length;

    // Group by field path
    const grouped = relevant.reduce((acc, f) => {
      if (!acc[f.fieldPath]) {
        acc[f.fieldPath] = {
          total: 0,
          accepted: 0,
          rejected: 0,
        };
      }
      acc[f.fieldPath].total++;
      if (f.rating === 'thumbs-up') acc[f.fieldPath].accepted++;
      if (f.rating === 'thumbs-down') acc[f.fieldPath].rejected++;
      return acc;
    }, Record<string, { total: number; accepted: number; rejected: number }>());

    return {
      totalFeedback: total,
      acceptanceRate: (accepted / total) * 100,
      rejectionRate: (rejected / total) * 100,
      nestedGroups: Object.entries(grouped).map(([fieldPath, data]) => ({
        fieldPath,
        acceptanceRate: (data.accepted / data.total) * 100,
        rejectionRate: (data.rejected / data.total) * 100,
        total: data.total,
      })),
    };
  }

  private fieldTitleFromPath(path: string): string {
    return path
      .split(/([A-Z][a-z]+)/)
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Get or create AI field enablement configuration
   * FR-5.1: Account / record type / field level enablement
   */
  async getEnablementConfig(tenantId: number): Promise<Record<string, any>> {
    // Placeholder for fetching stored config from database
    // In production: fetch from ai_assistance_preferences table using project_facts
    return {
      accountEnabled: true,
      recordTypes: {},
      fieldConfigs: {},
    };
  }

  /**
   * Get PII-sensitive field list for a tenant
   * FR-1.5
   */
  async getPiiSensitiveFields(
    tenantId: number
  ): Promise<Set<string>> {
    // Placeholder: fetch from tenant config or detection service
    return new Set([
      'email',
      'phone',
      'salary',
      'ssn',
      'creditCard',
    ]);
  }

  /**
   * Check if a field should suppress suggestions (session-level)
   * FR-4.2
   */
  isSuppressed(sessionId: string, suggestionId: string): boolean {
    return AiAssistanceService.suppressedSuggestions.has(
      `${sessionId}:${suggestionId}`
    );
  }

  // Class-level state for session-level suppression
  private static suppressedSuggestions = new Set<string>();
  private static pendingFeedback: Feedback[] = [];

  /**
   * Get or compute field enablement per-record type
   * FR-5.1
   */
  async getFieldEnablement(
    tenantId: number,
    recordType: string
  ): Promise<Record<string, boolean>> {
    const config = await this.getEnablementConfig(tenantId);

    if (!config.recordTypes[recordType]) {
      // Default enabled for all fields
      return config.fieldConfigs || {};
    }

    return config.recordTypes[recordType];
  }
}