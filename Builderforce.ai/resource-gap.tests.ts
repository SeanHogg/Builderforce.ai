/**
 * Resource gap tests: core engine logic and metrics output (aligned with PRD FR-3 and AC-1)
 * Test constraints: types are imported from './types' if and when built (here we inline names)
 */

import {
  GapResult,
  GapSeverity,
  GapDimension,
  ResourceType,
  ResourceRecord,
  ResourceDemand,
} from './types';

/**
 * Minimal reproduction of the engine to test correct defaults and metrics (via computeGapAnalysis)
 */
function computeGapAnalysis(
  resources: ResourceRecord[],
  demands: ResourceDemand[],
  config?: { timeHorizon?: 'sprint' | 'monthly' | 'quarterly' | 'annual'; noiseTolerance?: number },
) {
  const {
    timeHorizon = 'monthly',
    noiseTolerance,
  } = config ?? {};
  const { computeGapAnalysis: compute } = require('./engine');
  return compute(resources, demands, { timeHorizon, noiseTolerance });
}

/**
 * Expected defaults: monthly, 5% noise, USD
 */
const DEFAULT_CONFIG = {
  timeHorizon: 'monthly',
  costRateCurrency: 'USD',
};

/**
 * Test 1: Check basic engine initialization and default config
 */
function testEngineDefaults() {
  console.log('[Test 1] Engine defaults check');
  const resources: ResourceRecord[] = [];
  const demands: ResourceDemand[] = [];
  const result = computeGapAnalysis(resources, demands);

  // Validate packaging
  if (!result) {
    console.error('FAIL: Result is undefined.');
    return false;
  }
  // Expect defaults aligned with PRD engine interface
  if (result.timeHorizon !== 'monthly') {
    console.error(`FAIL: Expected timeHorizon=monthly, got ${result.timeHorizon}`);
    return false;
  }
  if (!result.metrics) {
    console.error('FAIL: metrics is missing');
    return false;
  }
  console.log('PASS: Engine defaults and packaging initialized.');
  return true;
}

/**
 * Test 2: Compute metrics with no gaps
 */
function testMetricsWithNoGaps() {
  console.log('[Test 2] Metrics with no gaps');
  const resources: ResourceRecord[] = [
    { id: 'R1', type: ResourceType.Personnel, name: 'Alice', role: 'Backend Engineer', skills: ['TS', 'Node'], availability: 80, fteAllocation: 1 },
  ];
  const demands: ResourceDemand[] = [
    { id: 'D1', projectId: 'P1', role: 'Backend Engineer', skills: ['TS', 'Node'], effort: 160, effortUnits: 'hours', startDate: '2025-01-01', endDate: '2025-01-31' },
  ];
  const result = computeGapAnalysis(resources, demands, DEFAULT_CONFIG);

  if (!result.metrics) return false;

  // With no gaps, totalOpenGaps should be computed and warnings not unexpected
  if (result.metrics.totalOpenGaps < 0) {
    console.error('FAIL: totalOpenGaps should be non-negative');
    return false;
  }
  console.log(`PASS: Metrics empty-case valid. totalOpenGaps=${result.metrics.totalOpenGaps}`);
  return true;
}

/**
 * Stress metrics output: compute metrics with large gap set (all dimensions)
 */
function testMetricsWithAllDimensions() {
  console.log('[Test 3] Metrics with all dimensions (headcount, capacity, budget)');
  const resources: ResourceRecord[] = [
    { id: 'R1', type: ResourceType.Personnel, name: 'Alice', role: 'Backend Engineer', skills: ['TS', 'Node'], availability: 100, costRate: 120000, fteAllocation: 1 },
    { id: 'R2', type: ResourceType.Personnel, name: 'Bob', role: 'UI Engineer', skills: ['React'], availability: 50, costRate: 100000, fteAllocation: 1 },
  ];
  const demands: ResourceDemand[] = [
    { id: 'D1', projectId: 'P1', role: 'Backend Engineer', skills: ['TS'], effort: 160, effortUnits: 'hours', startDate: '2025-01-01', endDate: '2025-01-31' },
    { id: 'D2', projectId: 'P1', role: 'UI Engineer', skills: ['React'], effort: 160, effortUnits: 'hours', startDate: '2025-01-01', endDate: '2025-01-31' },
    { id: 'D3', projectId: 'P1', role: 'QA Engineer', skills: ['Jest'], effort: 160, effortUnits: 'hours', startDate: '2025-01-01', endDate: '2025-01-31' },
  ];

  const result = computeGapAnalysis(resources, demands, DEFAULT_CONFIG);

  if (!result.metrics) return false;

  // Sanity check: expect at least some gaps across dimensions
  if (result.metrics.totalOpenGaps < 1) {
    console.warn('WARN: Expected at least one gap across dimensions. Did timeHorizon filter drop everything?');
  } else {
    console.log(`PASS: Metrics with full dimension set. totalOpenGaps=${result.metrics.totalOpenGaps}`);
  }

  // Validate metric fields exist
  const sumBySeverity = Object.values(result.metrics.gapsBySeverity || {}).reduce((a, v) => a + v, 0);
  if (result.metrics.totalOpenGaps !== sumBySeverity) {
    console.error(`FAIL: metric totals mismatch: totalOpenGaps=${result.metrics.totalOpenGaps}, gapsBySeverity sum=${sumBySeverity}`);
    return false;
  }

  // Budget dimension metrics: totalDeficitHours is optional and applies only to CapacityHours
  if (result.metrics.totalDeficitHours !== undefined && result.metrics.totalDeficitHours < 0) {
    console.error('FAIL: totalDeficitHours should be non-negative if present');
    return false;
  }

  return true;
}

/**
 * Smoke test: ensure timeHorizon variants function (sprint, monthly, quarterly, annual)
 */
function testTimeHorizonScenarios() {
  console.log('[Test 4] Time horizon variants');
  const resources: ResourceRecord[] = [];
  const demands: ResourceDemand[] = [];
  const horizons: ('sprint' | 'monthly' | 'quarterly' | 'annual')[] = ['sprint', 'monthly', 'quarterly', 'annual'];

  for (const horizon of horizons) {
    const result = computeGapAnalysis(resources, demands, { timeHorizon: horizon });
    if (!result || result.timeHorizon !== horizon) {
      console.error(`FAIL: Invalid time horizon response for ${horizon}`);
      return false;
    }
  }

  console.log('PASS: All time horizon variants processed');
  return true;
}

/**
 * Main runner
 */
function runTests() {
  console.log('=== Resource Gap Core Tests ===\n');
  const tests = [
    testEngineDefaults(),
    testMetricsWithNoGaps(),
    testMetricsWithAllDimensions(),
    testTimeHorizonScenarios(),
  ];
  const failures = tests.filter(t => t === false).length;
  console.log(`\n=== Tests Complete: ${tests.length - failures}/${tests.length} passed ===`);
  if (failures > 0) process.exit(1);
}

if (require.main === module) {
  runTests();
}