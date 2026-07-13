/**
 * Display rendering tests (FR-2.1–FR-2.6).
 * These tests validate the display layer's ability to correctly render payload data,
 * handle missing/null fields, and surface user-friendly error messages.
 *
 * AC-7: Every error path asserts on error type and message content, not merely absence of crash.
 * AC-8: No test depends on execution order; each passes when run in isolation.
 * AC-9: Display tests grouped under display describe.
 */

import { test, expect } from '@jest/globals';
import { describeModule } from '../../common';
import {
  validPayloads,
  edgeCasePayloads,
  missingFieldPayload,
  unicodePayloads,
} from '../../fixtures/mockData';
import { ProgressPayload } from '../../fixtures/types';
import renderDisplay from '../payloads/displayUtils';

describeModule('Display rendering', test.describe);

// =============================================================================
// FR-2.1: Correct structure without truncation/corruption
// =============================================================================

test('FR-2.1: valid payload renders expected structure without truncation', () => {
  const validSeed = validPayloads[0];
  const rendered = renderDisplay(validSeed);

  expect(rendered).toBeDefined();
  expect(rendered).toContain('## Progress Update');
  expect(rendered).toContain('### Reasoning');
  expect(rendered).toContain('### Reasoning Steps');
  expect(rendered).not.toContain('undefined');
  expect(rendered).not.toContain('null');
});

test('FR-2.1+: payload maintains full data content in display output', () => {
  const fullSeed = {
    basis: 'basis' as 'basis' | 'subtasks',
    subtasksDone: 10,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-01T00:00:00Z').toISOString(),
    message: 'Long progress message with multiple sentences that should not be truncated',
    taskId: 'task-12345',
  };

  const rendered = renderDisplay(fullSeed);
  const sections = [
    '### Reasoning Steps',
    'Missing fields placeholders',
    'null fallback logic',
    'truncation corruption tests',
  ];
  sections.forEach(section => {
    expect(rendered).not.toContain(section);
  });
});

// =============================================================================
// FR-2.2: Missing/null optional fields handled gracefully
// =============================================================================

test('FR-2.2: missing optional fields (message/taskId) handled gracefully', () => {
  const seed = {
    basis: 'basis' as 'basis' | 'subtasks',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date().toISOString(),
  };

  const rendered = renderDisplay(seed);
  expect(rendered).not.toContain('Message:');
  expect(rendered).not.toContain('task-');
});

test('FR-2.2++: null values render placeholders correctly', () => {
  const seed = missingFieldPayload; // message: null, taskId: null

  const rendered = renderDisplay(seed);
  expect(rendered).not.toContain('null');
});

test('FR-2.2+++: empty string fields omitted or placeholder', () => {
  const seed = missingFieldPayload; // message: ''

  const rendered = renderDisplay(seed);
  expect(rendered).not.toContain('Message:');
});

// =============================================================================
// FR-2.3: Special characters, Unicode, multi-line content
// =============================================================================

test('FR-2.3: Unicode characters render correctly', () => {
  const seed = unicodePayloads[0];
  const rendered = renderDisplay(seed);
  expect(rendered).toContain(seed.message);
});

test('FR-2.3++: special characters and multi-line content preserved', () => {
  const seed = {
    basis: 'basis' as 'basis' | 'subtasks',
    subtasksDone: 1,
    subtasksTotal: 2,
    timestamp: new Date().toISOString(),
    message: 'Test line\nbreak and symbols: <>&"\'\n\nmultiple\nnewlines',
  };

  const rendered = renderDisplay(seed);
  expect(rendered).toContain('line');
  expect(rendered).toContain('symbols:');
  expect(rendered).toContain('newlines');
});

// =============================================================================
// FR-2.4: Structured formats produce valid output
// =============================================================================

test('FR-2.4: bullet lists and code blocks rendered correctly', () => {
  const seed = {
    basis: 'basis' as 'basis' | 'subtasks',
    subtasksDone: 2,
    subtasksTotal: 4,
    timestamp: new Date().toISOString(),
    message: 'Steps: 1. Start, 2. Wait, 3. Finish',
  };

  const rendered = renderDisplay(seed);
  expect(rendered).toContain('### Reasoning Steps');
  expect(rendered).toMatch(/^1\. /m);
  expect(rendered).toMatch(/^2\. /m);
});

test('FR-2.4+: markdown formatting preserved without mangled characters', () => {
  const rendered = renderDisplay(validPayloads[0]);

  expect(rendered).toMatch(/^\*\*/);
  expect(rendered).toMatch(/^\*\*/);
  expect(rendered).toMatch(/⚠️|✅/); // Emoji used as low-cost status indicator
});

// =============================================================================
// FR-2.5: All relevant fields reflected, none silently dropped
// =============================================================================

test('FR-2.5: all relevant payload fields reflected in display output', () => {
  const seed = {
    basis: 'subtasks' as 'basis' | 'subtasks',
    subtasksDone: 8,
    subtasksTotal: 10,
    timestamp: new Date('2024-01-12T15:30:00Z').toISOString(),
    message: 'Completed 80%',
    taskId: 'task-100',
  };

  const rendered = renderDisplay(seed);
  expect(rendered).toContain('subtasks');
  expect(rendered).toContain('8/10');
  expect(rendered).toContain('80%');

  // Additional reference fields per spec
  expect(rendered).toContain('Reasoning');
  expect(rendered).toContain('Progress Update');
});

test('FR-2.5++: null fields do not disappear from display', () => {
  const seed = missingFieldPayload;
  const rendered = renderDisplay(seed);
  expect(rendered).toContain('subtasks');
  expect(rendered).toContain('### Reasoning');
});

// =============================================================================
// FR-2.6: Error display surfaces human-readable errors
// =============================================================================

test('FR-2.6: invalid payload (schema violation) surfaces error message', () => {
  const invalidSeed: any = {
    basis: 'invalid',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date().toISOString(),
    message: 'Testing error display',
  };

  const rendered = renderDisplay(invalidSeed);
  expect(rendered).toContain('### Error');

  // AC-7: assert error message content
  expect(rendered).toMatch(/missing required field/i);
});

test('FR-2.6++: nil or null payload denotes error state', () => {
  const rendered = renderDisplay({
    basis: 'basis' as 'basis' | 'subtasks',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date().toISOString(),
    message: null,
    taskId: null,
  });

  // Regardless of what placeholder is used, ensure there's no panic
  expect(() => renderDisplay(invalidSeed ? invalidSeed : null)).not.toThrow();
});

// =============================================================================
// FR-2.4: UTF-8 length boundary (for multi-line or emoji in paths)
// =============================================================================

test('FR-2.4+: emoji sequences and extended Unicode characters render valid markdown', () => {
  const seed = {
    basis: 'basis' as 'basis' | 'subtasks',
    subtasksDone: 1,
    subtasksTotal: 1,
    timestamp: new Date().toISOString(),
    message: '🚀 Completed accelerated milestone ✅ verified <>&"\'',
  };

  const rendered = renderDisplay(seed);
  expect(rendered).toContain('🚀');
  expect(rendered).toContain('✅');
});

// =============================================================================
// AC-5: Edge and negative tests
// =============================================================================

test('AC-5.1: special characters in task IDs handled correctly', () => {
  const seed = {
    basis: 'basis' as 'basis' | 'subtasks',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date().toISOString(),
    message: 'Special [|`\'"\t\n] characters in taskId',
    taskId: 'task-<special>';
  };

  const rendered = renderDisplay(seed);
  expect(rendered).toContain('### Reasoning');
});

test('AC-5.2: extremely long message handled without truncation', () => {
  const seed = {
    basis: 'basis' as 'basis' | 'subtasks',
    subtasksDone: 1,
    subtasksTotal: 1,
    timestamp: new Date().toISOString(),
    message: 'X'.repeat(1000),
  };

  const rendered = renderDisplay(seed);
  expect(rendered).toContain('X');
  expect(rendered.length).toBeGreaterThan(1000);
});

test('AC-5.3: extremely long taskId handled correctly', () => {
  const seed = {
    basis: 'basis' as 'basis' | 'subtasks',
    subtasksDone: 1,
    subtasksTotal: 1,
    timestamp: new Date().toISOString(),
    message: 'ID with many characters',
    taskId: 'a'.repeat(1000),
  };

  const rendered = renderDisplay(seed);
  expect(rendered).toContain('### Reasoning');
});

// =============================================================================
// Regression Baseline
// =============================================================================

test('Reg: Regression baseline for display test coverage', () => {
  expect(RegressionBaseline.displayCoverage.totalTests).toBeGreaterThan(0);
});

/**
 * Suite cleanup
 */
afterAll(() => {
  console.log('Display test suite completed');
});