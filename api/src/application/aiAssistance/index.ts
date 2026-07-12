/**
 * AI Assistance module exports
 *
 * Available functions:
 *   - generateInlineSuggestions(ctx, generator, tenantId)
 *   - proposeAutoFill(ctx, generator, tenantId)
 *   - detectGaps(ctx, generator)
 *   - isScopeEnabled(prefs, level, identifier, fieldPath)
 *   - getAiMetrics()
 *   - acceptFeedback(state, feedback)
 *
 * Types exported from aiAssistance.types.ts:
 *   - ConfidenceLevel, GapSeverity, FeedbackRating
 *   - Preferences, AiGenerator, RuntimeState
 *   - InlineSuggestion, AutoFillProposal, Gap
 *   - SuggestionFeedback
 */

export { functions } from './aiAssistance.service';
export type {
  ConfidenceLevel,
  GapSeverity,
  FeedbackRating,
  Preferences,
  AiGenerator,
  RuntimeState,
  InlineSuggestion,
  AutoFillProposal,
  Gap,
  SuggestionFeedback,
} from './aiAssistance.types';