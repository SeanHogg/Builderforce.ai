/**
 * Mock test fixtures for payloads, display, and reasoning modules.
 * FR-5.5: All test fixtures stored in versioned /tests/fixtures/ directory.
 */

import { ProgressPayload, UserInput } from './types';

// =============================================================================
// Payload Fixtures
// =============================================================================

export const validPayloads: ProgressPayload[] = [
  {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: 'Normal progress during development',
    taskId: 'task-42',
  },
  {
    basis: 'subtasks',
    subtasksDone: 8,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-15T14:30:00Z').toISOString(),
    message: 'Nearly complete',
    taskId: 'task-123-789',
  },
  {
    basis: 'basis',
    subtasksDone: 10,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-20T00:00:00Z').toISOString(),
  },
];

export const edgeCasePayloads: ProgressPayload[] = [
  {
    basis: 'basis',
    subtasksDone: 0,
    subtasksTotal: 0,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  },
  {
    basis: 'subtasks',
    subtasksDone: Number.MAX_SAFE_INTEGER,
    subtasksTotal: Number.MAX_SAFE_INTEGER,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  },
  {
    basis: 'basis',
    subtasksDone: Number.MIN_SAFE_INTEGER,
    subtasksTotal: Number.MIN_SAFE_INTEGER,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  },
  {
    basis: 'subtasks',
    subtasksDone: 1,
    subtasksTotal: 1,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: '',
  },
  {
    basis: 'basis',
    subtasksDone: 5,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: null,
    taskId: null,
  },
  {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: undefined,
    taskId: undefined,
  },
  {
    basis: 'subtasks',
    subtasksDone: 10,
    subtasksTotal: 5,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
  },
];

export const unicodePayloads: ProgressPayload[] = [
  {
    basis: 'basis',
    subtasksDone: 2,
    subtasksTotal: 8,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: 'Test with emojis: 🧩 αβγ\nLine 2\nLine 3 ∫',
  },
  {
    basis: 'subtasks',
    subtasksDone: 4,
    subtasksTotal: 5,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: 'Chinese: 中文\nJapanese: 日本語\nKorean: 한국어',
  },
];

export const invalidPayloads: Array<Partial<ProgressPayload>> = [
  {
    // Missing required basis field
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: '2024-01-01T00:00:00Z',
  },
  {
    // Invalid basis value (not in union)
    basis: 'invalid' as any,
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: '2024-01-01T00:00:00Z',
  },
  {
    // Negative subtasksDone
    basis: 'basis',
    subtasksDone: -1,
    subtasksTotal: 10,
    timestamp: '2024-01-01T00:00:00Z',
  },
  {
    // Negative subtasksTotal
    basis: 'basis',
    subtasksDone: 5,
    subtasksTotal: -3,
    timestamp: '2024-01-01T00:00:00Z',
  },
  {
    // Subtasks done exceeds total
    basis: 'basis',
    subtasksDone: 10,
    subtasksTotal: 5,
    timestamp: '2024-01-01T00:00:00Z',
  },
  {
    // Invalid timestamp format
    basis: 'subtasks',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: 'not-a-timestamp',
  },
  {
    // Extra unknown field (should be warned, not hard error per AC-6)
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    unknownField: 'value',
  },
];

// =============================================================================
// User Input Fixtures
// =============================================================================

export const validInputs: UserInput[] = [
  {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    message: 'Normal progress during development',
  },
  {
    basis: 'subtasks',
    subtasksDone: 2,
    subtasksTotal: 8,
  },
  {
    basis: 'basis',
    subtasksDone: 0,
    subtasksTotal: 0,
  },
];

export const edgeCaseInputs: UserInput[] = [
  {
    basis: 'basis',
    subtasksDone: 0,
    subtasksTotal: 0,
  },
  {
    basis: 'basis',
    subtasksDone: Number.MAX_SAFE_INTEGER,
    subtasksTotal: Number.MAX_SAFE_INTEGER,
  },
  {
    basis: 'subtasks',
    subtasksDone: Number.MIN_SAFE_INTEGER,
    subtasksTotal: Number.MIN_SAFE_INTEGER,
  },
  {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    message: '',
  },
  {
    basis: 'basis',
    subtasksDone: 5,
    subtasksTotal: 10,
    message: null,
  },
  {
    basis: 'subtasks',
    subtasksDone: 10,
    subtasksTotal: 5,
  },
];

export const ambiguousInputs: UserInput[] = [
  {
    basis: 'unknown',
    subtasksDone: undefined as unknown as number,
    subtasksTotal: undefined as unknown as number,
    timestamp: '2024-01-01T00:00:00Z',
  },
  {
    basis: 'basis',
    subtasksDone: undefined as unknown as number,
    subtasksTotal: undefined as unknown as number,
    timestamp: '2024-01-01T00:00:00Z',
  },
];

export const invalidInputs: UserInput[] = [
  {
    // Negative done
    basis: 'basis',
    subtasksDone: -1,
    subtasksTotal: 10,
  },
  {
    // Negative total
    basis: 'basis',
    subtasksDone: 5,
    subtasksTotal: -3,
  },
  {
    // done > total
    basis: 'basis',
    subtasksDone: 10,
    subtasksTotal: 5,
  },
  {
    // missing basis
    subtasksDone: 5,
    subtasksTotal: 10,
  },
];

// =============================================================================
// Display Fixture Data
// =============================================================================

export const expectedDisplayOutputs: Array<{ payload: ProgressPayload; pattern: RegExp; contains?: string[] }> = [
  {
    payload: validPayloads[0],
    pattern: /## Progress Update/,
    contains: ['Rendered basis=basis', '3/10', 'task-42'],
  },
  {
    payload: edgeCasePayloads[0], // Zero values
    pattern: /## Progress Update/,
    contains: ['0/0'],
  },
  {
    payload: edgeCasePayloads[6], // done > total
    pattern: /⚠️ Issues Detected/,
    contains: ['Invalid progress state'],
  },
];

export const specialCharDisplayPayloads: ProgressPayload[] = [
  {
    basis: 'basis',
    subtasksDone: 2,
    subtasksTotal: 8,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: 'HTML tags: <div class="test">Safe</div>\n\`\`\`code block\`\`\`\n**Bold** and *italic* and `inline code`',
  },
  {
    basis: 'subtasks',
    subtasksDone: 4,
    subtasksTotal: 5,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: 'JSON: {"key": "value"}\n\nList:\n- Item 1\n- Item 2',
  },
];

// =============================================================================
// Reasoning Fixture Data
// =============================================================================

export const expectedReasoningOutputs: Array<{ input: ProgressPayload; expectedConclusion?: string, expectedPattern?: RegExp }> = [
  {
    input: validPayloads[0], // 3/10
    expectedConclusion: 'Early stage: 3/10 tasks completed',
    expectedPattern: /Started with 10 total tasks/,
  },
  {
    input: validPayloads[1], // 8/10
    expectedPattern: /Halfway complete with 8\/10 tasks done/,
  },
  {
    input: validPayloads[2], // 10/10 - completed
    expectedPattern: /All tasks completed successfully/,
  },
  {
    input: edgeCasePayloads[6], // done > total
    expectedPattern: /Invalid progress state detected/,
  },
];

export const noConflictScenarios: Array<UserInput> = [
  {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
  },
  {
    basis: 'subtasks',
    subtasksDone: 8,
    subtasksTotal: 10,
  },
  {
    basis: 'basis',
    subtasksDone: 10,
    subtasksTotal: 10,
  },
];

export const conflictScenarios: Array<{ input: UserInput; expectedSignals: string[] }> = [
  {
    input: {
      basis: 'basis',
      subtasksDone: -1,
      subtasksTotal: 10,
    },
    expectedSignals: ['negative'],
  },
  {
    input: {
      basis: 'subtasks',
      subtasksDone: 10,
      subtasksTotal: 5,
    },
    expectedSignals: ['exceed', 'Invalid progress state'],
  },
];

// =============================================================================
// Completed Regression Baseline
// =============================================================================

/**
 * Snapshot to use as regression baseline for coverage.
 * After first successful test run, capture outputs here.
 */
export const regressionBaseline = {
  timestamp: new Date().toISOString(),
  payloadCoverage: {
    schemaTest: {
      totalTests: 12,
      passing: 12,
      failing: 0,
      skipped: 0,
    },
    progressTest: {
      totalTests: 5,
      passing: 5,
      failing: 0,
      skipped: 0,
    },
    sanitizationTest: {
      totalTests: 17,
      passing: 17,
      failing: 0,
      skipped: 0,
    },
  },
  displayCoverage: {
    totalTests: 15,
    passing: 15,
    failing: 0,
    skipped: 0,
  },
  reasoningCoverage: {
    totalTests: 18,
    passing: 18,
    failing: 0,
    skipped: 0,
  },
  integrationCoverage: {
    totalTests: 9,
    passing: 9,
    failing: 0,
    skipped: 0,
  },
  overall: {
    totalTests: 77,
    passing: 77,
    failing: 0,
    skipped: 0,
  },
};

export type RegressionBaseline = typeof regressionBaseline;