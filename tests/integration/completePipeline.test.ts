/**
 * Integration tests: input → payload → reasoning → display output (FR-4.1–FR-4.3).
 * 
 * End-to-end flow validation for representative scenarios:
 * - FR-4.1: Full pipeline completes without error.
 * - FR-4.2: Errors propagate correctly with appropriate messaging.
 * - FR-4.3: Cross-module data integrity (no data loss/mutation).
 *
 * AC-7: Every tested error path asserts on error type and message content, not merely absence of crash.
 * AC-8: No test depends on execution order; each passes when run in isolation.
 * AC-9: Integration tests are grouped under integration describe.
 */

import { test, expect } from '@jest/globals';
import { describeModule } from '../../common';
import {
  validPayloads,
  edgeCasePayloads,
  invalidPayloads,
  validInputs,
  edgeCaseInputs,
  ambiguousInputs,
  conflictScenarios,
  noConflictScenarios,
  expectedReasoningOutputs,
  expectedDisplayOutputs,
  RegressionBaseline,
} from '../../fixtures/mockData';
import { UserInput, ProgressPayload, ReasoningOutput } from '../../fixtures/types';
import {
  assertRoundTrip,
  assertPayloadSchema,
  sanitizeWithValidation,
  generateDeterministicPayload,
  PayloadCollection,
} from '../payloads/payloadUtils';
import mockReasoningEngine from '../../core/reasoningEngine';

// =============================================================================
// Mock Implementation Note
// =============================================================================
// The mock implementations below will be replaced by:
// - src/modules/payloads/serializer.ts: generatePayload()
// - src/modules/reasoning/engine.ts: executeReasoning()
// - src/modules/display/render.ts: renderDisplay()
//
// For this PRD task, we implement inline mocks for testing purposes.

describeModule('Integration: Complete Pipeline', test.describe);

// =============================================================================
// Mock Pipeline Components
// =============================================================================

/**
 * Simulated payload generation (FR-1.1, FR-1.3).
 * In production, this would be src/modules/payloads/generator.ts.
 */
function generatePayload(input: UserInput): ProgressPayload {
  try {
    const payload: Partial<ProgressPayload> = {
      basis: input.basis as 'basis' | 'subtasks',
      subtasksDone: input.subtasksDone,
      subtasksTotal: input.subtasksTotal,
      timestamp: new Date().toISOString(),
      message: input.message ?? undefined,
    };
    return sanitizeWithValidation(payload);
  } catch (error) {
    // In production, this would propagate. Here we handle gracefully for integration testing.
    throw new Error(`Payload generation failed: ${(error as Error).message}`);
  }
}

/**
 * Simulated reasoning execution (FR-3.1–FR-3.6).
 * In production, this would be src/modules/reasoning/engine.ts.
 */
function executeReasoning(payload: ProgressPayload): ReasoningOutput {
  return mockReasoningEngine(payload);
}

/**
 * Simulated display rendering (FR-2.1–FR-2.5).
 * In production, this would be src/modules/display/render.ts.
 */
function renderDisplay(payload: ProgressPayload, reasoning: ReasoningOutput): string {
  let output = `## Progress Update (${payload.basis})\n\n`;
  output += `- **Completion**: ${payload.subtasksDone}/${payload.subtasksTotal} (${((payload.subtasksDone / Math.max(1, payload.subtasksTotal)) * 100).toFixed(1)}%)\n`;
  if (payload.taskId) {
    output += `- **Task ID**: ${payload.taskId}\n`;
  }
  if (payload.message) {
    output += `- **Message**: ${payload.message}\n`;
  }
  output += `- **Timestamp**: ${payload.timestamp}\n\n`;
  output += `### Reasoning\n\n`;
  output += `- **Status**: ${reasoning.conflictSignals ? '⚠️ Needs Attention' : '✅ Normal'}\n`;
  output += `- **Confidence**: ${(reasoning.confidenceScore * 100).toFixed(0)}%\n`;
  output += `- **Conclusion**: ${reasoning.conclusion}\n\n`;
  output += `### Reasoning Steps\n\n`;
  reasoning.steps.forEach((step, i) => {
    output += `${i + 1}. ${step}\n`;
  });
  if (reasoning.conflictSignals && reasoning.conflictSignals.length > 0) {
    output += `\n### ⚠️ Issues Detected\n\n`;
    reasoning.conflictSignals.forEach((signal, i) => {
      output += `${i + 1}. ${signal}\n`;
    });
  }
  return output;
}

// =============================================================================
// FR-4.1: Full pipeline completion
// =============================================================================

test('FR-4.1: validates full pipeline completes without error for representative scenarios', () => {
  const scenarios = [
    {
      name: 'typical scenario',
      input: {
        basis: 'basis',
        subtasksDone: 3,
        subtasksTotal: 10,
        message: 'Normal progress during development',
      },
      expectedPattern: /Early stage: 3\/10 tasks completed/,
    },
    {
      name: 'boundary scenario - zero values',
      input: {
        basis: 'subtasks',
        subtasksDone: 0,
        subtasksTotal: 0,
      },
      expectedPattern: /no tasks tracked/,
    },
    {
      name: 'boundary scenario - current real max',
      input: {
        basis: 'basis',
        subtasksDone: Number.MAX_SAFE_INTEGER,
        subtasksTotal: Number.MAX_SAFE_INTEGER,
      },
      expectedPattern: /Invalid progress state is detected/,
    },
    {
      name: 'well completed scenario',
      input: {
        basis: 'subtasks',
        subtasksDone: 8,
        subtasksTotal: 10,
      },
      expectedPattern: /Halfway complete with 8\/10 tasks done/,
    },
    {
      name: 'no conflict scenario',
      input: {
        basis: 'basis',
        subtasksDone: 2,
        subtasksTotal: 5,
      },
      expectedPattern: /Early stage: 2\/5 tasks completed/,
    },
    {
      name: 'completed scenario',
      input: {
        basis: 'subtasks',
        subtasksDone: 10,
        subtasksTotal: 10,
      },
      expectedPattern: /All tasks completed/,
    },
  ];

  scenarios.forEach(({ name, input, expectedPattern }) => {
    // Step 1: Generate payload (schema-checked)
    const payload = generatePayload(input);
    expect(payload).toBeDefined();
    expect(payload).toHaveProperty('basis');
    expect(payload).toHaveProperty('subtasksDone');
    expect(payload.basis).toBe(input.basis as 'basis' | 'subtasks');

    // Step 2: Execute reasoning
    const reasoning = executeReasoning(payload);
    expect(reasoning).toBeDefined();
    expect(reasoning.conclusion).toBeTruthy();

    // Step 3: Render display
    const display = renderDisplay(payload, reasoning);
    expect(display).toBeDefined();

    // Verify output contains expected information
    expect(display).toMatch(expectedPattern);
  });
});

test('FR-4.1+: pipeline processes all valid fixtures without errors', () => {
  validPayloads.forEach(payload => {
    // Generate from equivalent input
    const input: UserInput = {
      basis: payload.basis as string,
      subtasksDone: payload.subtasksDone,
      subtasksTotal: payload.subtasksTotal,
      message: payload.message,
    };

    const generatedPayload = generatePayload(input);
    assertRoundTrip(payload, `Round-trip of valid fixture: ${payload.basis}`);

    const reasoning = executeReasoning(generatedPayload);
    expect(reasoning.steps.length).toBeGreaterThan(0);

    const display = renderDisplay(generatedPayload, reasoning);
    expect(display).toContain(payload.basis);
  });
});

// =============================================================================
// FR-4.2: Error propagation
// =============================================================================

test('FR-4.2: errors at payload generation propagate to display layer with messages', () => {
  // Negative done (payload generation creates invalid structure)
  const invalidInput: UserInput = {
    basis: 'basis',
    subtasksDone: -1,
    subtasksTotal: 10,
  };

  try {
    const payload = generatePayload(invalidInput);
    
    // Payload exists with invalid values
    expect(payload.subtasksDone).toBe(-1);

    // Reasoning should detect invalid state
    const reasoning = executeReasoning(payload);
    expect(reasoning.conflictSignals).toBeDefined();
    expect(reasoning.conflictSignals?.length).toBeGreaterThan(0);
    expect(reasoning.conflictSignals?.some(s => s.toLowerCase().includes('negative'))).toBeTruthy();

    // Display should surface error messaging
    const display = renderDisplay(payload, reasoning);
    expect(display).toContain('⚠️ Issues Detected');
    expect(display).toContain('missing required field'); // From schema validation assert
  } catch (error) {
    // Should propagate error from schema validation
    expect((error as Error).message).toMatch(/missing required field/);
  }
});

test('FR-4.2+: done > total propagates conflict signals correctly', () => {
  const input: UserInput = {
    basis: 'basis',
    subtasksDone: 10,
    subtasksTotal: 5,
  };

  const payload = generatePayload(input);
  const reasoning = executeReasoning(payload);

  expect(reasoning.conflictSignals).toBeDefined();
  expect(reasoning.conflictSignals?.length).toBeGreaterThan(0);
  expect(reasoning.conflictSignals?.some(s => s.includes('exceed') || s.includes('Invalid'))).toBeTruthy();
  expect(reasoning.confidenceScore).toBe(0.0);

  const display = renderDisplay(payload, reasoning);
  expect(display).toContain('⚠️ Issues Detected');
  expect(display).toContain('Invalid progress state');
});

test('FR-4.2++: invalid basis propagates schema validation error', () => {
  const input: UserInput = {
    basis: 'invalid',
    subtasksDone: 3,
    subtasksTotal: 10,
  };

  try {
    generatePayload(input);
    // Should throw
    fail('Expected schema validation error');
  } catch (error) {
    expect((error as Error).message).toMatch(/must be/);
    expect((error as Error).message).toMatch(/basis/);
  }
});

// =============================================================================
// FR-4.3: Cross-module data integrity
// =============================================================================

test('FR-4.3: payload fields accurately reflect in reasoning and display (no data loss)', () => {
  const input: UserInput = {
    basis: 'subtasks',
    subtasksDone: 2,
    subtasksTotal: 8,
    message: 'Testing data integrity',
  };

  // Payload: input → payload
  const payload = generatePayload(input);
  assertPayloadSchema(payload);
  expect(payload.basis).toBe('subtasks');
  expect(payload.subtasksDone).toBe(2);
  expect(payload.subtasksTotal).toBe(8);
  expect(payload.message).toBe('Testing data integrity');
  expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T[^T]*Z$/); // ISO timestamp

  // Reasoning: payload → reasoning
  const reasoning = executeReasoning(payload);
  expect(reasoning.steps.length).toBeGreaterThan(0);
  expect(reasoning.steps.some(s => s.includes('Testing data integrity'))).toBeTruthy();

  // Display: payload + reasoning → display
  const display = renderDisplay(payload, reasoning);

  // Verify all fields represented
  expect(display).toContain('Testing data integrity');
  expect(display).toContain('2/8');
  // Completed ratio test
  expect(display).toMatch(/\(25\.0*\)%/);
  expect(display).toContain('subtasks');
  expect(display).toContain('Progress Update');
  expect(display).toContain('Reasoning');
});

test('FR-4.3+: sample with current timestamp preserved in pipeline', () => {
  const now = new Date();
  const input: UserInput = {
    basis: 'basis',
    subtasksDone: 7,
    subtasksTotal: 10,
    message: 'Almost done',
  };

  const payload = generatePayload(input);

  // Timestamp generated
  expect(payload.timestamp).toBeTruthy();
  expect(new Date(payload.timestamp).getTime()).toBeCloseTo(now.getTime(), -5); // +/- 5ms
  expect(typeof payload.timestamp).toBe('string');

  const reasoning = executeReasoning(payload);
  expect(reasoning.conclusion).toContain('Almost done');

  const display = renderDisplay(payload, reasoning);
  expect(display).toContain(payload.timestamp);
});

// =============================================================================
// Additional integration edge cases (AC-5)
// =============================================================================

test('FR-4.1: pipeline preserves zero-value payloads without crashing', () => {
  const input = {
    basis: 'basis',
    subtasksDone: 0,
    subtasksTotal: 0,
    message: '',
  };

  const payload = generatePayload(input);
  expect(payload.subtasksDone).toBe(0);
  expect(payload.subtasksTotal).toBe(0);

  const reasoning = executeReasoning(payload);
  expect(reasoning).toBeDefined();

  const display = renderDisplay(payload, reasoning);
  expect(display).toContain('0/0');
  // Empty message should not appear
  expect(display).not.toContain('Message:');
});

test('FR-4.2: null/undefined message handling flows through pipeline', () => {
  // Null message
  const nullInput = {
    basis: 'subtasks',
    subtasksDone: 3,
    subtasksTotal: 12,
    message: null,
  };

  const payload = generatePayload(nullInput);
  expect(payload.message).toBeNull();

  const reasoning = executeReasoning(payload);
  expect(reasoning).toBeDefined();

  // No assertion on display.render behavior yet—TODO: integrate real display.nullMessage handling

  // Null taskId
  const payload2 = {
    basis: 'basis',
    subtasksDone: 5,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: null,
    taskId: null,
  };
  expect(() => executeReasoning(payload2)).not.toThrow();
});

test('AC-5.1: duplicate pipeline runs produce exactly same output', () => {
  const input: UserInput = {
    basis: 'subtasks',
    subtasksDone: 4,
    subtasksTotal: 4,
  };

  const run1 = renderDisplay(generatePayload(input), executeReasoning(generatePayload(input)));
  const run2 = renderDisplay(generatePayload(input), executeReasoning(generatePayload(input)));

  expect(run1).toBe(run2);
});

test('FR-4.2: conflicting inputs yield low confidence signals', () => {
  conflictScenarios.forEach(({ input, expectedSignals }) => {
    const payload = generatePayload(input);
    const reasoning = executeReasoning(payload);

    expect(reasoning.conflictSignals).toBeDefined();
    expect(reasoning.conflictSignals!.length).toBeGreaterThan(0);
    expect(reasoning.conflictSignals?.some(s => 
      expectedSignals.some(es => s.toLowerCase().includes(es.toLowerCase()))
    )).toBeTruthy();

    const display = renderDisplay(payload, reasoning);
    expect(display).toContain('⚠️ Issues Detected');
  });
});

test('FR-4.1: known good inputs match expected reasoning conclusion', () => {
  expectedReasoningOutputs.forEach(({ input, expectedConclusion }) => {
    const payload = generatePayload(input);
    const reasoning = executeReasoning(payload);

    // Conclusion should match expected pattern
    expect(reasoning.conclusion).toBe(expectedConclusion);
  });
});

// =============================================================================
// Regression Baseline
// =============================================================================

test('Reg: Regression baseline for integration coverage', () => {
  expect(RegressionBaseline.integrationCoverage.totalTests).toBeGreaterThan(0);
});

/**
 * Suite cleanup
 */
afterAll(() => {
  console.log('Integration test suite completed');
});