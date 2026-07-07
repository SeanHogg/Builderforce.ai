/**
 * Quality Risk Score Extension
 * 
 * Provides High/Medium/Low risk scoring with justification and metrics breakdown
 * for product artifacts (features, releases, modules).
 */

export type { QualityMetric, RiskScoreConfig, Artifacts } from './config.js';
export type { RiskLevel } from './score-engine.js';
export type { CalculatedScore, ScoreHistory, OverrideRequest } from './quality-risk-score.js';
export { QualityRiskScore, createQualityRiskScoreProvider, METRIC_TEMPLATES } from './quality-risk-score.js';
export { calculateDefaultMetrics } from './quality-risk-score-provider.js';