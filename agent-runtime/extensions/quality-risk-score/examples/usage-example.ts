/**
 * Example usage of the Quality Risk Score extension.
 *
 * Demonstrates registering artifacts, updating metrics, calculating scores,
 * applying manual overrides, and retrieving history.
 */
import { QualityRiskScore } from '../src/quality-risk-score.js';
import type { QualityMetric, Artifact } from '../src/config.js';

// ── 1. Create an instance with default config ──────────────────────
const qrs = new QualityRiskScore({
  metrics: [],
  overrideAllowed: true,
  reevaluationInterval: 5,
});

// ── 2. Register an artifact (e.g. a feature or release) ───────────
const feature: Artifact = {
  type: 'feature',
  name: 'User Authentication v2',
  description: 'OAuth2 + SSO refactor',
};
const artifactId = qrs.registerArtifact(feature);

// ── 3. Feed in quality metrics ────────────────────────────────────
const metrics: QualityMetric[] = [
  {
    name: 'openBugs',
    value: 12,
    weight: 1.0,
    direction: 'higher_is_worse',
    threshold: { low: 0, medium: 5, high: 15 },
  },
  {
    name: 'criticalBugs',
    value: 2,
    weight: 1.5,
    direction: 'higher_is_worse',
    threshold: { low: 0, medium: 1, high: 3 },
  },
  {
    name: 'testCoverage',
    value: 55,
    weight: 1.0,
    direction: 'higher_is_better',
    threshold: { low: 40, medium: 60, high: 80 },
  },
  {
    name: 'codeComplexity',
    value: 42,
    weight: 0.8,
    direction: 'higher_is_worse',
    threshold: { low: 20, medium: 35, high: 50 },
  },
  {
    name: 'deploymentFailures',
    value: 1,
    weight: 2.0,
    direction: 'higher_is_worse',
    threshold: { low: 0, medium: 1, high: 3 },
  },
];

for (const metric of metrics) {
  qrs.updateMetric(artifactId, metric);
}

// ── 4. Calculate the risk score ───────────────────────────────────
const score = qrs.calculateRiskScore(artifactId, metrics);
console.log('Risk Level:', score.level); // → 'High', 'Medium', or 'Low'
console.log('Score:', score.score); // → 0-100
console.log('Justification:', score.justification);
console.log('Metrics:', score.metrics);

// ── 5. Drill into contributing factors ────────────────────────────
const detail = qrs.getArtifactMetrics(artifactId);
if (detail) {
  for (const [name, info] of Object.entries(detail)) {
    console.log(`  ${name}: value=${info.value}, weight=${info.weight}, high threshold=${info.thresholdHigh}`);
  }
}

// ── 6. Manual override ────────────────────────────────────────────
const overrideResult = qrs.manualOverride(artifactId, {
  manualScore: 'Medium',
  reason: 'Known issues are cosmetic and will not affect production traffic.',
  overrideBy: 'tech-lead@example.com',
});
if (overrideResult) {
  console.log('Overridden level:', overrideResult.level);
}

// ── 7. Retrieve score history ─────────────────────────────────────
const history = qrs.getScoreHistory(artifactId);
console.log('History entries:', history?.length ?? 0);
if (history) {
  for (const entry of history) {
    console.log(
      `  ${entry.calculatedAt.toISOString()} — ${entry.level}${entry.manuallyOverride ? ' (MANUAL)' : ''}`,
    );
  }
}

// ── 8. Re-evaluation ──────────────────────────────────────────────
const reevaluated = qrs.reevaluate(artifactId);
console.log('Re-evaluated level:', reevaluated?.level);
