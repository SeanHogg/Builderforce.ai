import { QualityRiskScore } from './quality-risk-score.js';
import { QualityMetric, RiskScoreConfig } from './config.js';

// Available metric templates for easy setup
export const METRIC_TEMPLATES: Record<string, Omit<QualityMetric, 'name'> & { name: string }> = {
  openBugs: {
    name: 'openBugs',
    value: 0,
    weight: 1.0,
    threshold: { low: 0, medium: 5, high: 15 }
  },
  criticalBugs: {
    name: 'criticalBugs',
    value: 0,
    weight: 1.5, // Higher weight for critical issues
    threshold: { low: 0, medium: 1, high: 3 }
  },
  testCoverage: {
    name: 'testCoverage',
    value: 100,
    weight: 1.0,
    threshold: { low: 40, medium: 60, high: 80 }
  },
  codeComplexity: {
    name: 'codeComplexity',
    value: 30,
    weight: 0.8,
    threshold: { low: 20, medium: 35, high: 50 }
  },
  deploymentFailures: {
    name: 'deploymentFailures',
    value: 0,
    weight: 2.0, // Very high weight for failures
    threshold: { low: 0, medium: 1, high: 3 }
  },
  technicalDebt: {
    name: 'technicalDebt',
    value: 50,
    weight: 1.0,
    threshold: { low: 20, medium: 40, high: 60 }
  },
  complianceWarnings: {
    name: 'complianceWarnings',
    value: 0,
    weight: 0.8,
    threshold: { low: 0, medium: 5, high: 10 }
  },
  integrationFailureRate: {
    name: 'integrationFailureRate',
    value: 0,
    weight: 1.2,
    threshold: { low: 0, medium: 2, high: 5 }
  },
  performanceScore: {
    name: 'performanceScore',
    value: 80,
    weight: 1.0,
    threshold: { low: 50, medium: 70, high: 85 }
  },
  securityIssues: {
    name: 'securityIssues',
    value: 0,
    weight: 1.5,
    threshold: { low: 0, medium: 2, high: 5 }
  }
};

/**
 * Default quality risk score provider for BuilderForce runtime.
 * Creates a QualityRiskScore instance with predefined metric templates.
 */
export function createQualityRiskScoreProvider(
  user: {
    id: string;
    name?: string;
    email?: string;
  },
  options: {
    metrics?: QualityMetric[];
    overrideAllowed?: boolean;
    reevaluationInterval?: number;
  } = {}
): QualityRiskScore {
  const configuredMetrics = options.metrics || Object.values(METRIC_TEMPLATES);
  
  const scoreEngine = new QualityRiskScore({
    metrics: configuredMetrics,
    overrideAllowed: options.overrideAllowed !== false
  });

  // Initialize with default empty state for artifacts
  return scoreEngine;
}

/**
 * Example metric calculator - you can extend this for your repo
 */
export function calculateDefaultMetrics(artifact: {
  name: string;
  type: string;
  description?: string;
  metadata?: Record<string, any>;
}): Partial<QualityMetric>[] {
  const metrics: Partial<QualityMetric>[] = [];

  // If you have data sources like issue trackers, CI status, etc.,
  // you can calculate values here and pass to updateMetric()

  // Placeholder for custom metric calculation
  // metrics.push({ ...METRIC_TEMPLATES.openBugs, value: GetOpenBugs(artifact.id) });

  return metrics;
}

// Re-export for convenience
export { QualityRiskScore, QualityMetric, RiskScoreConfig, METRIC_TEMPLATES };