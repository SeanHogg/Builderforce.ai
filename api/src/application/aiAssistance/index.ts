/**
 * AI Assistance module exports
 *
 * Available functions:
 *   - buildInlineSuggestionPrompt(ctx, generator) — builds prompt for inline suggestions
 *   - generateInlineSuggestions(ctx) — generates inline field suggestions
 *   - isScopeEnabled(prefs, level, identifier, fieldPath) — checks enablement
 *   - buildAutoFillPrompt(ctx, generator) — builds prompt for auto-fill
 *   - proposeAutoFill(ctx) — proposes an auto-fill value
 *   - detectGaps(ctx, generator) — detects gaps in a record
 *   - acceptFeedback(state, feedback) — records user feedback
 *   - wouldSettingsChange(current, next) — compares preferences snapshots
 *   - getAiMetrics() — returns aggregated feedback metrics
 *
 * Types exported from aiAssistance.types.ts:
 *   - AiGenerator, RuntimeState — injected dependencies
 *   - ConfidenceLevel, GapSeverity, FeedbackRating, EnablementLevel
 *   - InlineSuggestion, AutoFillProposal, Gap, SuggestionFeedback
 *   - Preferences, EnablementConfig
 *   - SuggestionContext, InlineSuggestionsResponse, AutoFillResponse, GapDetectionResponse
 */

export {
  functions,
  buildInlineSuggestionPrompt,
  generateInlineSuggestions,
  isScopeEnabled,
  buildAutoFillPrompt,
  proposeAutoFill,
  detectGaps,
  acceptFeedback,
  wouldSettingsChange,
  getAiMetrics,
} from './aiAssistance.service';
export type {
  AiGenerator,
  RuntimeState,
  ConfidenceLevel,
  GapSeverity,
  FeedbackRating,
  EnablementLevel,
  Preferences,
  EnablementConfig,
  InlineSuggestion,
  AutoFillProposal,
  Gap,
  Feedback,
  SuggestionContext,
  InlineSuggestionsResponse,
  AutoFillResponse,
  GapDetectionResponse,
  SuggestionFeedback,
} from './aiAssistance.types';
