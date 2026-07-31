/**
 * Quality Risk Score Extension
 *
 * Provides High/Medium/Low risk scoring with justification and metrics breakdown
 * for product artifacts (features, releases, modules).
 */

export type { QualityMetric, RiskScoreConfig, Artifact } from './config.js';
export type { RiskLevel, CalculatedScore } from './score-engine.js';
export type { ScoreHistoryEntry, OverrideRequest } from './quality-risk-score.js';

export { QualityRiskScore } from './quality-risk-score.js';
export {
  createQualityRiskScoreProvider,
  METRIC_TEMPLATES,
  calculateDefaultMetrics,
} from './quality-risk-score-provider.js';
