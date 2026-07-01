/**
 * Example: Using Quality Risk Score with BuilderForce tasks
 * 
 * This file demonstrates how to integrate the Quality Risk Score extension
 * into runtime task handling workflows where artifacts (features, releases, etc.)
 * might need risk assessment.
 */

import { 
  createQualityRiskScoreProvider, 
  METRIC_TEMPLATES,
  type CalculatedScore 
} from './quality-risk-score/index.js';

/**
 * Simulates gathering metrics from various sources for a task/artifact
 */
async function gatherMetricsForArtifact(task: {
  id: string;
  type: string;
  name: string;
  metadata?: Record<string, any>;
}): Promise<Record<string, any>> {
  const metrics: Record<string, any> = {};

  // Example: If your runtime has access to buildersForceAgents scan results
  // metrics.testCoverage = task.metadata?.scanResults?.testCoverage || 100;
  // metrics.openBugs = task.metadata?.scanResults?.openBugs || 0;
  // metrics.deploymentFailures = task.metadata?.scanResults?.deploymentFailures || 0;

  // Placeholder: In real implementation, integrate with CI results, Jira/Webhooks, etc.
  // metrics.testCoverage = Math.random() * 100; // Simulated
  // metrics.openBugs = Math.floor(Math.random() * 10); // Simulated
  // metrics.deploymentFailures = Math.floor(Math.random() * 3); // Simulated
  
  console.log('Gathering metrics for artifact:', task.name, metrics);
  return metrics;
}

/**
 * Calculate and display quality risk score for a task
 */
async function assessTaskRisk(task: {
  id: string;
  type: string;
  name: string;
  description?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  // Create provider
  const provider = createQualityRiskScoreProvider(
    { id: 'runtime', name: 'BuilderForce Runtime' }
  );

  // Register the artifact (task as artifact)
  const artifactId = provider.registerArtifact(task);

  // Get real metrics from sources (placeholder implementation)
  const metricValues = await gatherMetricsForArtifact(task);
  
  // Build metrics array
  const metricsToScore = Object.entries(METRIC_TEMPLATES)
    .filter(([key]) => key in metricValues || key === 'testCoverage')
    .map(([key, template]) => ({
      ...template,
      value: metricValues[key] ?? template.value
    }));

  // Calculate score
  const score: CalculatedScore = provider.calculateRiskScore(
    artifactId,
    metricsToScore
  );

  console.log(`\nQuality Risk Assessment for "${task.name}":`);
  console.log('─'.repeat(40));
  console.log(`Risk Level: ${score.level}`);
  console.log(`Score: ${score.score}/100`);
  console.log(`Justification: ${score.justification}`);
  console.log('\nMetric Breakdown:');
  
  for (const [name, metric] of Object.entries(score.metrics)) {
    console.log(`  ${name}: ${metric.value} (weight: ${metric.weight}, impact: +${metric.contribution}%)`);
  }

  // In production: send to display system, notification, or dashboard
  return score;
}

/**
 * Example: Scenario - Assessing multiple tasks before release
 */
async function assessReleaseCandidates(
  tasks: Array<{ id: string; type: string; name: string }>
): Promise<void> {
  console.log('\nRelease Candidate Quality Risk Assessment\n');
  
  const assessments = tasks.map(task => 
    assessTaskRisk(task).then(score => ({
      task,
      score
    }))
  );

  const results = await Promise.all(assessments);
  
  console.log('\nSummary by Risk Level:');
  console.log('─'.repeat(40));
  
  const byLevel = results.reduce((acc, r) => {
    acc[r.score.level] = (acc[r.score.level] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  for (const [level, count] of Object.entries(byLevel)) {
    console.log(`  ${level}: ${count} item(s)`);
  }

  // Highlight actions needed
  if (byLevel.High > 0) {
    console.log('\n⚠️  Attention Required: High-risk items may need immediate review.');
  }
  if (byLevel.Medium > 0) {
    console.log('\n💡 Review suggested: Medium-risk items should be assessed before release.');
  }
}

/**
 * Example: Using metrics to drive decisions
 */
function determineActionPlan(score: CalculatedScore): string {
  switch (score.level) {
    case 'High':
      return 'Immediate action required: Fix critical issues before proceeding';
    case 'Medium':
      return 'Review within 1-2 weeks; consider holding release if possible';
    case 'Low':
      return 'Continue as planned; monitor for changes';
    default:
      return 'No immediate action required';
  }
}

/**
 * Example: Manual override workflow
 */
async function handleManualOverride(
  provider: ReturnType<typeof createQualityRiskScoreProvider>,
  artifactId: string,
  override: {
    manualScore: 'High' | 'Medium' | 'Low';
    reason: string;
    overrideBy: string;
  }
): Promise<CalculatedScore> {
  const updatedScore = provider.manualOverride(artifactId, override);
  
  if (!updatedScore) {
    throw new Error('Artifact not found or override not allowed');
  }

  console.log(`Manual Override Applied by ${override.overrideBy}:`);
  console.log(`  New Score: ${updatedScore.level}`);
  console.log(`  Reason: ${override.reason}`);
  console.log(`  Justification: ${updatedScore.justification}`);

  return updatedScore;
}

// Example usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const demoTasks = [
    { id: 'TASK-101', type: 'feature', name: 'Payment Gateway Integration' },
    { id: 'TASK-102', type: 'feature', name: 'User Analytics Dashboard' },
    { id: 'TASK-103', type: 'release', name: 'Summer 2024 Release' },
    { id: 'TASK-104', type: 'module', name: 'Authentication Module' }
  ];

  assessReleaseCandidates(demoTasks.slice(0, 2));
}

export {
  assessReleaseCandidates,
  gatherMetricsForArtifact,
  determineActionPlan,
  handleManualOverride
};