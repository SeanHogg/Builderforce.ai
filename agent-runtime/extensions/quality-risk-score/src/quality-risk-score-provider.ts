import { QualityRiskScore } from './quality-risk-score.js';
import type { QualityMetric } from './config.js';

/** Available metric templates for easy setup. */
export const METRIC_TEMPLATES: Record<
  string,
  Omit<QualityMetric, 'value'> & { value: number }
> = {
  openBugs: {
    name: 'openBugs',
    value: 0,
    weight: 1.0,
    direction: 'higher_is_worse',
    threshold: { low: 0, medium: 5, high: 15 },
  },
  criticalBugs: {
    name: 'criticalBugs',
    value: 0,
    weight: 1.5,
    direction: 'higher_is_worse',
    threshold: { low: 0, medium: 1, high: 3 },
  },
  testCoverage: {
    name: 'testCoverage',
    value: 100,
    weight: 1.0,
    direction: 'higher_is_better',
    threshold: { low: 40, medium: 60, high: 80 },
  },
  codeComplexity: {
    name: 'codeComplexity',
    value: 30,
    weight: 0.8,
    direction: 'higher_is_worse',
    threshold: { low: 20, medium: 35, high: 50 },
  },
  deploymentFailures: {
    name: 'deploymentFailures',
    value: 0,
    weight: 2.0,
    direction: 'higher_is_worse',
    threshold: { low: 0, medium: 1, high: 3 },
  },
  technicalDebt: {
    name: 'technicalDebt',
    value: 50,
    weight: 1.0,
    direction: 'higher_is_worse',
    threshold: { low: 20, medium: 40, high: 60 },
  },
  complianceWarnings: {
    name: 'complianceWarnings',
    value: 0,
    weight: 0.8,
    direction: 'higher_is_worse',
    threshold: { low: 0, medium: 5, high: 10 },
  },
  integrationFailureRate: {
    name: 'integrationFailureRate',
    value: 0,
    weight: 1.2,
    direction: 'higher_is_worse',
    threshold: { low: 0, medium: 2, high: 5 },
  },
  performanceScore: {
    name: 'performanceScore',
    value: 80,
    weight: 1.0,
    direction: 'higher_is_better',
    threshold: { low: 50, medium: 70, high: 85 },
  },
  securityIssues: {
    name: 'securityIssues',
    value: 0,
    weight: 1.5,
    direction: 'higher_is_worse',
    threshold: { low: 0, medium: 2, high: 5 },
  },
};

/**
 * Default quality risk score provider for BuilderForce runtime.
 * Creates a QualityRiskScore instance with predefined metric templates.
 */
export function createQualityRiskScoreProvider(
  _user: {
    id: string;
    name?: string;
    email?: string;
  },
  options: {
    metrics?: QualityMetric[];
    overrideAllowed?: boolean;
    reevaluationInterval?: number;
  } = {},
): QualityRiskScore {
  const configuredMetrics =
    options.metrics ?? (Object.values(METRIC_TEMPLATES) as QualityMetric[]);

  return new QualityRiskScore({
    metrics: configuredMetrics,
    overrideAllowed: options.overrideAllowed !== false,
    reevaluationInterval: options.reevaluationInterval ?? 5,
  });
}

/**
 * Hook point for populating metric values from external data sources
 * (issue trackers, CI status, etc.). Callers should override the returned
 * partial metric objects with real values before passing to
 * `QualityRiskScore.updateMetric()`.
 */
export function calculateDefaultMetrics(_artifact: {
  name: string;
  type: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Partial<QualityMetric>[] {
  // Integrate with your data sources here and return populated metrics.
  return [];
}
