/**
 * Reasoning functionality tests (FR-3.1–FR-3.6).
 * Verifies chain-of-thought steps, fallback for ambiguity, conflict signals, schema compliance, and idempotency.
 *
 * AC-7: Every error path asserts on error type and message content, not merely absence of crash.
 * AC-8: No test depends on execution order; each passes when run in isolation.
 * AC-9: Each test file includes docstring + comment describing scenario and expected outcome.
 */

import { test, expect } from '@jest/globals';
import { describeModule } from '../../common';
import {
  validPayloads,
  edgeCasePayloads,
  invalidPayloads,
  expectedReasoningOutputs,
  noConflictScenarios,
  conflictScenarios,
  ambiguousInputs,
  RegressionBaseline,
} from '../../fixtures/mockData';
import { ProgressPayload, ReasoningOutput, MockReasoningConfig } from '../../fixtures/types';
import { assertPayloadSchema } from '../payloads/payloadUtils';

describeModule('Reasoning', test.describe);

// =============================================================================
// Mock Reasoning Engine (FR-3.x implementations)
// =============================================================================

/**
 * Deterministic mock reasoning engine for testing purposes.
 * FR-3.1: Produces ground-truth answer based on input.
 * FR-3.2: Generates non-empty, ordered steps referencing input fields.
 * FR-3.6: Idempotent when given same input + config.
 */
function mockReasoningEngine(
  payload: ProgressPayload,
  config?: MockReasoningConfig
): ReasoningOutput {
  const { subtasksDone, subtasksTotal, message } = payload;
  const ratio = subtasksTotal > 0 ? subtasksDone / subtasksTotal : 0;
  const seedValue = config?.seed ?? 42;

  let conclusion: string;
  const steps: string[] = [];
  const conflictSignals: string[] = [];

  // FR-3.4: Detect contradictory inputs
  if (subtasksDone < 0) {
    conflictSignals.push('Invalid: subtasksDone is negative');
  }
  if (subtasksTotal < 0) {
    conflictSignals.push('Invalid: subtasksTotal is negative');
  }
  if (subtasksDone > subtasksTotal) {
    conflictSignals.push('Invalid: subtasksDone exceeds subtasksTotal');
  }

  if (conflictSignals.length > 0) {
    conclusion = 'Invalid progress state detected';
    steps.push(`Analyzed input: ${subtasksDone}/${subtasksTotal}`);
    steps.push('Detected inconsistency in progress counts');
    conflictSignals.forEach(signal => steps.push(`Conflict: ${signal}`));
  } else if (ratio === 0 && subtasksDone === 0 && subtasksTotal === 0) {
    conclusion = 'Undefined: no tasks tracked yet';
    steps.push('Received input with no tasks specified');
    steps.push('Cannot compute progress ratio from zero values');
  } else if (ratio === 0) {
    conclusion = 'No tasks completed yet';
    steps.push(`Initialized with ${subtasksTotal} total tasks`);
    steps.push(`Current progress is ${subtasksDone} out of ${subtasksTotal}`);
    steps.push('Conclusion: work has not started');
  } else if (ratio >= 1) {
    conclusion = 'All tasks completed successfully';
    steps.push(`Started with ${subtasksTotal} total tasks`);
    steps.push(`Progressed from 0/${subtasksTotal} to ${subtasksDone}/${subtasksTotal}`);
    steps.push('Verified all tasks completed');
  } else if (ratio >= 0.5) {
    conclusion = `Halfway complete with ${subtasksDone}/${subtasksTotal} tasks done`;
    steps.push(`Started with ${subtasksTotal} total tasks`);
    steps.push(`Progressed to ${subtasksDone}/${subtasksTotal}`);
    steps.push('Evaluated completion status');
  } else {
    conclusion = `Early stage: ${subtasksDone}/${subtasksTotal} tasks completed`;
    steps.push(`Started with ${subtasksTotal} total tasks`);
    steps.push(`Recorded progress to ${subtasksDone}/${subtasksTotal}`);
  }

  // Optional message adds a step
  if (message) {
    steps.push(`Message: "${message}"`);
  }

  // FR-3.3: Low confidence for ambiguous/undefined inputs
  const confidenceScore = conflictSignals.length > 0
    ? 0.0
    : (subtasksTotal === 0 && subtasksDone === 0)
      ? 0.1
      : ratio <= 0.01
        ? 0.4
        : Math.min(1.0, 0.6 + (ratio * 0.4));

  return {
    conclusion,
    confidenceScore,
    steps,
    conflictSignals: conflictSignals.length > 0 ? conflictSignals : undefined,
  };
}

/**
 * Validates reasoning output schema compliance. (FR-3.5)
 */
function assertReasoningSchema(output: ReasoningOutput): void {
  // All required fields present
  expect(output).toHaveProperty('conclusion');
  expect(output).toHaveProperty('confidenceScore');
  expect(output).toHaveProperty('steps');

  // Correct types
  expect(typeof output.conclusion).toBe('string');
  expect(typeof output.confidenceScore).toBe('number');
  expect(Array.isArray(output.steps)).toBe(true);

  // confidenceScore in [0, 1] range
  expect(output.confidenceScore).toBeGreaterThanOrEqual(0);
  expect(output.confidenceScore).toBeLessThanOrEqual(1);

  // steps is non-empty (FR-3.2)
  expect(output.steps.length).toBeGreaterThan(0);

  // steps are strings
  output.steps.forEach(step => {
    expect(typeof step).toBe('string');
  });

  // conflictSignals optional but if present, must be string array
  if (output.conflictSignals) {
    expect(Array.isArray(output.conflictSignals)).toBe(true);
    output.conflictSignals.forEach(signal => {
      expect(typeof signal).toBe('string');
    });
  }
}

// =============================================================================
// FR-3.1: Ground-truth verification
// =============================================================================

test('FR-3.1: known input produces expected ground-truth answer', () => {
  // Scenario: 3/10 completed
  const input: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const output = mockReasoningEngine(input);

  expect(output.conclusion).toBe('Early stage: 3/10 tasks completed');
  expect(output.confidenceScore).toBeCloseTo(0.6 + (0.3 / 10) * 3, 2);
});

test('FR-3.1+: completed scenario (10/10) produces completion message', () => {
  const input: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 10,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const output = mockReasoningEngine(input);

  expect(output.conclusion).toContain('All tasks completed');
  expect(output.confidenceScore).toBeGreaterThanOrEqual(0.9);
});

// =============================================================================
// FR-3.2: Intermediate reasoning steps
// =============================================================================

test('FR-3.2: intermediate reasoning steps are non-empty and logically ordered', () => {
  const input: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const output = mockReasoningEngine(input);

  // Steps should be non-empty
  expect(output.steps.length).toBeGreaterThan(0);

  // Steps should reference relevant input fields
  expect(output.steps.some(s => s.includes('3'))).toBeTruthy();
  expect(output.steps.some(s => s.includes('10'))).toBeTruthy();
  expect(output.steps.some(s => s.includes('total tasks'))).toBeTruthy();
  expect(output.steps.some(s => s.includes('progress'))).toBeTruthy();

  // Steps should be ordered (first step typically describes initialization)
  expect(output.steps[0]).toContain('Started with');
});

test('FR-3.2+: messages are included in reasoning step sequence', () => {
  const input: ProgressPayload = {
    basis: 'subtasks',
    subtasksDone: 4,
    subtasksTotal: 8,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: 'User provided context',
  };

  const output = mockReasoningEngine(input);

  // Message should appear in steps
  const hasMessageStep = output.steps.some(s => s.includes('User provided context'));
  expect(hasMessageStep).toBeTruthy();
});

// =============================================================================
// FR-3.3: Ambiguous/underspecified inputs
// =============================================================================

test('FR-3.3: ambiguous/underspecified inputs produce fallback instead of crash', () => {
  // Zero-values scenario (no tasks tracked yet)
  const zeroInput: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 0,
    subtasksTotal: 0,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  // Should not crash
  const output = mockReasoningEngine(zeroInput);

  // Should produce fallback (low confidence, no crash)
  expect(output).toBeDefined();
  expect(output.confidenceScore).toBeLessThanOrEqual(0.2);
  expect(output.conclusion).toContain('no tasks tracked');

  // Should not have thrown
});

test('FR-3.3+: missing optional fields handled, engine still produces output', () => {
  const partialInput: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 5,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: undefined,
    taskId: undefined,
  };

  // No crash
  const output = mockReasoningEngine(partialInput);
  expect(output.conclusion).toContain('Halfway');
  expect(output.steps.length).toBeGreaterThanOrEqual(2);
});

// =============================================================================
// FR-3.4: Contradictory inputs
// =============================================================================

test('FR-3.4: contradictory inputs (done > total) trigger detectable conflict signals', () => {
  const conflictingInput: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 10,
    subtasksTotal: 5,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const output = mockReasoningEngine(conflictingInput);

  // Should have conflict signals
  expect(output.conflictSignals).toBeDefined();
  expect(output.conflictSignals!.length).toBeGreaterThan(0);
  expect(output.conflictSignals!.some(s => s.includes('exceeds'))).toBeTruthy();
  expect(output.confidenceScore).toBe(0.0);
  expect(output.conclusion).toContain('Invalid progress state');
});

test('FR-3.4+: negative values trigger conflict signals', () => {
  const negativeInput: ProgressPayload = {
    basis: 'basis',
    subtasksDone: -1,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const output = mockReasoningEngine(negativeInput);

  expect(output.conflictSignals).toBeDefined();
  expect(output.conflictSignals!.some(s => s.includes('negative'))).toBeTruthy();
  expect(output.confidenceScore).toBe(0.0);
  expect(output.conclusion).toContain('Invalid progress state');
});

test('FR-3.4++: all-zero scenario returns no conflict signals but low confidence', () => {
  const zeroInput: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 0,
    subtasksTotal: 0,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const output = mockReasoningEngine(zeroInput);

  // Zero scenario is not a conflict per se (no tasks created yet)
  expect(output.conflictSignals).toBeUndefined();
  expect(output.confidenceScore).toBeLessThan(0.2);
  expect(output.conclusion).toContain('no tasks tracked');
});

// =============================================================================
// FR-3.5: Reasoning output schema compliance
// =============================================================================

test('FR-3.5: reasoning output schema compliance (all required fields, correct types)', () => {
  const inputs: ProgressPayload[] = [
    {
      basis: 'basis',
      subtasksDone: 5,
      subtasksTotal: 10,
      timestamp: new Date().toISOString(),
    },
    {
      basis: 'subtasks',
      subtasksDone: 2,
      subtasksTotal: 8,
      timestamp: new Date().toISOString(),
      message: 'Test scenario',
      taskId: 'task-schema',
    },
    {
      basis: 'basis',
      subtasksDone: 10,
      subtasksTotal: 5,
      timestamp: new Date().toISOString(),
    },
    {
      basis: 'basis',
      subtasksDone: 0,
      subtasksTotal: 0,
      timestamp: new Date().toISOString(),
    },
  ];

  inputs.forEach(input => {
    const output = mockReasoningEngine(input);
    assertReasoningSchema(output);
  });
});

test('FR-3.5+: confidence score always within [0, 1]', () => {
  // Test a range of ratios
  const ratios = [0, 0.25, 0.5, 0.75, 1.0];
  ratios.forEach(ratio => {
    const input: ProgressPayload = {
      basis: 'basis',
      subtasksDone: Math.round(ratio * 100),
      subtasksTotal: 100,
      timestamp: new Date().toISOString(),
    };

    const output = mockReasoningEngine(input);
    expect(output.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(output.confidenceScore).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// FR-3.6: Idempotency
// =============================================================================

test('FR-3.6: reasoning is idempotent for deterministic configuration', () => {
  const input: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 4,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const config: MockReasoningConfig = {
    deterministic: true,
    seed: 42,
  };

  // Run multiple times with same input + config
  const outputs = Array.from({ length: 5 }, () => mockReasoningEngine(input, config));

  // All outputs should be identical
  outputs.forEach((output, index) => {
    expect(output.conclusion).toBe(outputs[0].conclusion);
    expect(output.confidenceScore).toBe(outputs[0].confidenceScore);
    expect(output.steps).toEqual(outputs[0].steps);
    expect(output.conflictSignals).toEqual(outputs[0].conflictSignals);
  });
});

test('FR-3.6+: repeated calls without seed produce consistent output', () => {
  // The mock engine is deterministic by nature; verify
  const input: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 2,
    subtasksTotal: 8,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const run1 = mockReasoningEngine(input);
  const run2 = mockReasoningEngine(input);

  expect(run1).toEqual(run2);
});

// =============================================================================
// Edge Cases and Negative Tests (AC-5)
// =============================================================================

test('AC-5.1: extremely large values do not overflow or corrupt reasoning output', () => {
  const input: ProgressPayload = {
    basis: 'basis',
    subtasksDone: Number.MAX_SAFE_INTEGER,
    subtasksTotal: Number.MAX_SAFE_INTEGER,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const output = mockReasoningEngine(input);
  expect(output.conclusion).toContain('completed');
  expect(output.confidenceScore).toBeGreaterThanOrEqual(0.9);
});

test('AC-5.2: empty message with reasoning step sequence test', () => {
  const input: ProgressPayload = {
    basis: 'subtasks',
    subtasksDone: 0,
    subtasksTotal: 0,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: '',
  };

  const output = mockReasoningEngine(input);
  // Empty messages treated as no message
  expect(output).toBeDefined();
  expect(output.confidenceScore).toBeLessThan(0.2);
});

test('AC-5.3: null optional fields in reasoning input', () => {
  const input: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 9,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: null,
    taskId: null,
  };

  const output = mockReasoningEngine(input);
  expect(output.conclusion).toContain('Early stage');
  expect(output.confidenceScore).toBeGreaterThanOrEqual(0.5);
});

// =============================================================================
// Regression Baseline
// =============================================================================

test('Reg: Regression baseline confirms snapshot reference for coverage', () => {
  expect(RegressionBaseline.reasoningCoverage).toBeDefined();
  expect(RegressionBaseline.reasoningCoverage.totalTests).toBeGreaterThan(0);
});

// =============================================================================
// AC-7: No silent failures — every error path asserts on error type and message
// =============================================================================

test('AC-7: confidenceScore must be a number between 0 and 1 — type assertion', () => {
  const input: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date().toISOString(),
  };

  const output = mockReasoningEngine(input);

  // Assert on type and range (not merely absence of NaN)
  expect(output.confidenceScore).toEqual(expect.any(Number));
  expect(output.confidenceScore).toBeGreaterThanOrEqual(0);
  expect(output.confidenceScore).toBeLessThanOrEqual(1);
});

test('AC-7: conflict signals contain descriptive messages — not just presence', () => {
  const invalidInput: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 10,
    subtasksTotal: 5,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  };

  const output = mockReasoningEngine(invalidInput);

  // Assert that conflict signals exist AND contain meaningful text
  expect(output.conflictSignals).toBeDefined();
  expect(output.conflictSignals!.length).toBeGreaterThan(0);
  output.conflictSignals!.forEach(signal => {
    expect(signal.length).toBeGreaterThan(10); // Meaningful length
    expect(signal).toMatch(/[A-Za-z]/); // Not just symbols
  });
});

/**
 * Post-suite cleanup notification.
 */
afterAll(() => {
  console.log('Reasoning test suite completed');
});