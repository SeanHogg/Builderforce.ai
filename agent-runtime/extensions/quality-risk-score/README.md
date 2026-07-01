# Quality Risk Score Extension

A BuilderForce extension that provides High/Medium/Low risk scoring with justification and metrics breakdown for product artifacts (features, releases, modules).

## Overview

The Quality Risk Score extension calculates a consistent, objective risk assessment for product artifacts based on configurable quality metrics. It includes:

- **FR1 (Score Calculation)**: Evaluates metrics (open bugs, test coverage, code complexity, deployment failures) and returns High/Medium/Low levels
- **FR2 (Justification Generation)**: Automatically generates human-readable explanations for scores
- **FR3 (Score Display)**: Returns complete score data, justification, and metrics
- **FR4 (Drill-down)**: Allows viewing contributing metrics with thresholds and values
- **FR5 (Manual Override)**: Supports authorized user overrides with mandatory justification
- **FR6 (Re-evaluation)**: Supports re-scoring when metrics change (minimal interval for now)

## Installation

This extension is part of the BuilderForce runtime extensions. To install:

```bash
# Ensure this directory is in your runtime's extensions path
# Add to your runtime configuration or add manually to the extensions folder
```

## Quick Start

```typescript
import { createQualityRiskScoreProvider, METRIC_TEMPLATES } from './extensions/quality-risk-score/index.js';

// Create provider instance
const provider = createQualityRiskScoreProvider(
  { id: 'admin', name: 'System Admin' },
  {
    metrics: Object.values(METRIC_TEMPLATES).slice(0, 4) // Use default 4 metrics
  }
);

// Register a feature artifact
const featureId = provider.registerArtifact({
  name: 'User Auth',
  type: 'feature',
  description: 'Authentication flow for users'
});

// Update metrics
provider.updateMetric(featureId, METRIC_TEMPLATES.openBugs);
provider.updateMetric(featureId, METRIC_TEMPLATES.criticalBugs);
provider.updateMetric(featureId, METRIC_TEMPLATES.testCoverage);
provider.updateMetric(featureId, METRIC_TEMPLATES.complianceWarnings);

// Calculate score
const score = provider.calculateRiskScore(featureId, [
  { ...METRIC_TEMPLATES.openBugs, value: 3 },
  { ...METRIC_TEMPLATES.criticalBugs, value: 1 },
  { ...METRIC_TEMPLATES.testCoverage, value: 45 },
  { ...METRIC_TEMPLATES.complianceWarnings, value: 1 }
]);

console.log(score);
// Output:
// {
//   level: 'High',
//   score: 72,
//   justification: 'High: criticalBugs: 1, openBugs: 3, testCoverage: 45, complianceWarnings: 1',
//   metrics: {
//     openBugs: { value: 3, weight: 1, contribution: '4.5' },
//     criticalBugs: { value: 1, weight: 1.5, contribution: '10.1' },
//     testCoverage: { value: 45, weight: 1, contribution: '4.1' },
//     complianceWarnings: { value: 1, weight: 0.8, contribution: '2.2' }
//   },
//   rawScore: 72
// }
```

## Available Metric Templates

| Template | Example Usage |
|----------|---------------|
| `openBugs` | Track number of open issues (weight: 1.0, high threshold: 15) |
| `criticalBugs` | Count critical P1/P2 bugs (weight: 1.5, high threshold: 3) |
| `testCoverage` | Percentage of code covered by tests (weight: 1.0, high threshold: 80) |
| `codeComplexity` | Cyclomatic complexity metric (weight: 0.8, high threshold: 50) |
| `deploymentFailures` | Failed deployments count (weight: 2.0, very high impact) |
| `technicalDebt` | Debt levels (weight: 1.0, high threshold: 60) |
| `complianceWarnings` | Policy/test warning count (weight: 0.8) |
| `integrationFailureRate` | Integration failure % (weight: 1.2) |
| `performanceScore` | Performance metrics (weight: 1.0) |
| `securityIssues` | Security scan findings (weight: 1.5) |

## Scoring Logic

The score aggregates metric values using weighted contributions, normalized against the `high` threshold for each metric:

1. Each metric's value is normalized (0-1) relative to its `high` threshold
2. Contribution = (normalized / weight) × weight
3. Raw score = sum of contributions ÷ (total weight × count)
4. Final score = raw score × 100 (clamped to 0-100)

**Risk Levels:**
- **High**: Score ≥ 70
- **Medium**: Score ≥ 40
- **Low**: Score < 40

## API Reference

### QualityRiskScore

Main service class for score calculation, history, and management.

#### `calculateRiskScore(artifactId, metrics): CalculatedScore`

Calculate score for an artifact using metric values.

#### `manualOverride(artifactId, override): CalculatedScore | null`

Override the calculated score manually. Requires authorized user and reason.

#### `reevaluate(artifactId): CalculatedScore | null`

Recalculate score based on current metrics.

#### `getArtifactsMetrics(artifactId): Record<string, {value, weight, thresholdHigh}> | null`

Get detailed metric breakdown with thresholds.

#### `getScoreHistory(artifactId): ScoreHistory[] | null`

Get historical scores for an artifact, including overrides.

#### `registerArtifact(artifact): string`

Register a new artifact (feature, release, etc.).

#### `updateMetric(artifactId, metric): void`

Add or update a metric value for an artifact.

#### `getMetrics(artifactId): Map<string, QualityMetric> | null`

Get all metrics for an artifact.

### CalculatedScore

```typescript
interface CalculatedScore {
  level: 'High' | 'Medium' | 'Low';
  score: number;           // 0-100 integer
  justification: string;   // Human-readable explanation
  metrics: {
    [metricName]: {
      value: number;
      weight: number;
      contribution: number; // How much this metric influenced the score
    }
  };
  rawScore: number;        // Uncapped raw calculation
}
```

## Usage Examples

### Example 1: Feature Risk Assessment

```typescript
import { createQualityRiskScoreProvider } from './quality-risk-score/index.js';

const provider = createQualityRiskScoreProvider({ id: 'pm' });

const productId = provider.registerArtifact({
  name: 'Checkout Flow',
  type: 'feature',
  description: 'E-commerce payment processing'
});

const score = provider.calculateRiskScore(productId, [
  { name: 'deploymentFailures', value: 2, weight: 2.0, threshold: {low: 0, medium: 1, high: 3} },
  { name: 'criticalBugs', value: 1, weight: 1.5, threshold: {low: 0, medium: 1, high: 3} },
  { name: 'testCoverage', value: 55, weight: 1.0, threshold: {low: 40, medium: 60, high: 80} },
  { name: 'integrationFailureRate', value: 3, weight: 1.2, threshold: {low: 0, medium: 2, high: 5} }
]);

console.log(score.level); // 'Medium'
console.log(score.justification); 
// 'Medium: deploymentFailures: 2, integrationFailureRate: 3, testCoverage: 55'
```

### Example 2: Manual Override

```typescript
import { METRIC_TEMPLATES } from './quality-risk-score/index.js';

const override = {
  manualScore: 'High',
  reason: 'Manual assessment: critical UX issues preventing release',
  overrideBy: 'pmmike@example.com'
};

const updatedScore = provider.manualOverride(featureId, override);
console.log(updatedScore.justification); 
// 'Manual assessment: critical UX issues preventing release (Override)'
console.log(updatedScore.level); // 'High'
```

### Example 3: Comparison Dashboard

```typescript
const features = [
  { name: 'Auth', type: 'feature' },
  { name: 'Billing', type: 'feature' },
  { name: 'Dashboard', type: 'feature' }
];

features.forEach(async f => {
  const id = provider.registerArtifact(f);
  // Update metrics from your data sources
  provider.updateMetric(id, { ...METRIC_TEMPLATES.testCoverage, value: 70 });
  provider.updateMetric(id, { ...METRIC_TEMPLATES.openBugs, value: 0 });
  
  const score = provider.calculateRiskScore(id, [
    { ...METRIC_TEMPLATES.testCoverage, value: 70 },
    { ...METRIC_TEMPLATES.openBugs, value: 0 },
    { ...METRIC_TEMPLATES.codeComplexity, value: 25 }
  ]);

  console.log(`${f.name}: ${score.level}`);
});
```

## Configuration

Metric templates are pre-configured but can be customized:

```typescript
const customMetrics = [
  {
    name: 'myCustomMetric',
    value: 10,
    weight: 1.2,
    threshold: { low: 5, medium: 15, high: 25 }
  }
];

const provider = createQualityRiskScoreProvider(
  { id: 'admin' },
  { metrics: customMetrics }
);
```

## Notes

- **Data Sources**: This extension provides the scoring engine. Integrate with your issue trackers, CI pipelines, or LLM outputs to populate actual metric values.
- **Minimal Interval**: FR6 specifies automatic re-evaluation on significant metric changes. For pragmatic implementation, consider:
  1. Polling from your data sources and calling `reevaluate()`
  2. Integrating with event-driven pipelines
  3. Adding a `cacheTTL` parameter for periodic refreshes
- **Storage**: Option to persist data across runtime restarts by adding persistence layer to `ScoreHistory` and metrics storage.

## Out of Scope (from PRD)

- Automated blocking or workflow triggering
- User-configurable scoring algorithms
- Historical trend analysis beyond basic history
- External GRC tool integration

## License

Part of BuilderForce runtime