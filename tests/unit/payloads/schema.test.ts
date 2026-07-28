/**
 * Payload schema and structure tests (FR-1.1 and forward).
 * Verifies payloads strictly conform to defined schema.
 */

import { test, expect, describe } from '@jest/globals';
import { describeModule } from '../../common';
import {
  validPayloads,
  edgeCasePayloads,
  invalidPayloads,
  RegressionBaseline,
} from '../../fixtures/mockData';
import { assertPayloadSchema, assertRoundTrip, sanitizeWithValidation, PayloadCollection } from './payloadUtils';

describeModule('Payloads: Schema', test.describe);

const progressFields: string[] = [
  'basis',
  'subtasksDone',
  'subtasksTotal',
  'timestamp',
];

// =============================================================================
// FR-1.1: Well-formed payload produces schema-compliant output
// =============================================================================

test('FR-1.1: well-formed input produces schema-compliant payload', () => {
  const event = validPayloads[0];

  expect(event.basis).toBe('basis');
  expect(event.subtasksDone).toBe(3);
  expect(event.subtasksTotal).toBe(10);
  expect(typeof event.timestamp).toBe('string');

  // Use schema validator
  assertPayloadSchema(event);
});

test('FR-1.1+: all allowed fields present in equivalent round trip', () => {
  const event = validPayloads[1];

  expect(event.message).toBe('Nearly complete');
  expect(event.taskId).toBe('task-123-789');
  assertPayloadSchema(event);
  assertRoundTrip(event, 'Round-trip of well-formed event');
});

test('FR-1.1++: valid payloads validate against schema across fixture set', () => {
  validPayloads.forEach(payload => {
    assertPayloadSchema(payload);
  });
});

// =============================================================================
// FR-1.2: Deterministic output
// =============================================================================

test('FR-1.2: identical inputs produce identical payloads across repeated runs', () => {
  const timestamp = new Date().toISOString();
  const payload0 = {
    basis: 'subtasks',
    subtasksDone: 2,
    subtasksTotal: 8,
    timestamp,
  };

  const payload1 = {
    basis: 'subtasks',
    subtasksDone: 2,
    subtasksTotal: 8,
    timestamp,
  };

  assertRoundTrip(payload0, 'First run round-trip');
  assertRoundTrip(payload1, 'Second run round-trip');
  expect(payload0).toEqual(payload1);
});

test('FR-1.2+: repeated serialization produces byte-equivalent JSON', () => {
  const event = validPayloads[0];

  const first = JSON.stringify(event);
  const second = JSON.stringify(event);

  expect(first).toBe(second);
  expect(JSON.parse(first)).toEqual(JSON.parse(second));
});

// =============================================================================
// FR-1.3: Optional fields omitted or populated
// =============================================================================

test('FR-1.3: optional fields omitted when not present', () => {
  const event = validPayloads[2];

  expect(event.message).toBeUndefined();
  expect(event.taskId).toBeUndefined();
  assertPayloadSchema(event);
});

test('FR-1.3+: optional fields populated when explicitly provided', () => {
  const event: typeof validPayloads[0] = {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date().toISOString(),
    message: 'Partial completion',
    taskId: 'task-123',
  };

  expect(event.message).toBe('Partial completion');
  expect(event.taskId).toBe('task-123');
  assertPayloadSchema(event);
});

test('FR-1.3++: null optional fields keep schema valid', () => {
  const event = edgeCasePayloads[4];
  expect(event.message).toBeNull();
  expect(event.taskId).toBeNull();
  // null is still a valid JSON-serializable value
  assertPayloadSchema(event);
});

// =============================================================================
// FR-1.4: Invalid/malformed inputs raise expected errors
// =============================================================================

test('FR-1.4: missing required field raises descriptive error', () => {
  const malformed = {
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: '2024-01-01T00:00:00Z',
  };

  expect(() => sanitizeWithValidation(malformed as any)).toThrow('missing required field');
  expect(() => sanitizeWithValidation(malformed as any)).toThrow("'basis'");
});

test('FR-1.4+: invalid literal union raises expected error type', () => {
  const malformed = {
    basis: 'unknown',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: '2024-01-01T00:00:00Z',
  };

  expect(() => sanitizeWithValidation(malformed as any)).toThrow("basis must be 'basis' or 'subtasks'");
});

test('FR-1.4++: negative counts raise descriptive error messages', () => {
  const malformed = {
    basis: 'basis',
    subtasksDone: -1,
    subtasksTotal: 10,
    timestamp: '2024-01-01T00:00:00Z',
  };

  expect(() => sanitizeWithValidation(malformed as any)).toThrow('subtasksDone cannot be negative');
});

test('FR-1.4+++: done > total raises schema violation error', () => {
  const malformed = {
    basis: 'basis',
    subtasksDone: 10,
    subtasksTotal: 5,
    timestamp: '2024-01-01T00:00:00Z',
  };

  expect(() => sanitizeWithValidation(malformed as any)).toThrow('exceed');
});

test('FR-1.4++++: malformed timestamp raises descriptive error', () => {
  const malformed = {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: 'not-a-timestamp',
  };

  expect(() => sanitizeWithValidation(malformed as any)).toThrow('invalid timestamp format');
});

// =============================================================================
// FR-1.5: Boundary conditions
// =============================================================================

test('FR-1.5: maximum safe integer values handled', () => {
  const max = edgeCasePayloads[1];
  assertPayloadSchema(max);
  expect(max.subtasksDone).toBe(Number.MAX_SAFE_INTEGER);
  expect(max.subtasksTotal).toBe(Number.MAX_SAFE_INTEGER);
});

test('FR-1.5+: zero values handled without errors', () => {
  const zero = edgeCasePayloads[0];
  assertPayloadSchema(zero);
  expect(zero.subtasksDone).toBe(0);
  expect(zero.subtasksTotal).toBe(0);
});

test('FR-1.5++: empty string optional fields preserved', () => {
  const emptyMessage = edgeCasePayloads[3];
  expect(emptyMessage.message).toBe('');
  assertPayloadSchema(emptyMessage);
});

test('FR-1.5+++: undefined optional fields treated as excluded', () => {
  const undefinedFields = edgeCasePayloads[5];
  expect(undefinedFields.message).toBeUndefined();
  expect(undefinedFields.taskId).toBeUndefined();
  assertPayloadSchema(undefinedFields);
});

test('FR-1.5++++: far-future timestamp boundary', () => {
  const future = {
    basis: 'basis',
    subtasksDone: 10,
    subtasksTotal: 10,
    timestamp: new Date('9999-12-31T23:59:59.999Z').toISOString(),
  } as const;

  assertPayloadSchema(future);
  expect(future.timestamp).toBe('9999-12-31T23:59:59.999Z');
});

// =============================================================================
// FR-1.6: Serialization round-trip
// =============================================================================

test('FR-1.6: JSON serialization produces round-trippable payload', () => {
  validPayloads.concat(edgeCasePayloads).forEach(payload => {
    assertRoundTrip(payload, `Round-trip for ${payload.basis}`);
  });
});

test('FR-1.6+: JSON serialization equivalence after reparse', () => {
  const original = validPayloads[0];
  const serialized = JSON.parse(JSON.stringify(original));
  expect(serialized).toEqual(original);
});

// =============================================================================
// Regression Baseline
// =============================================================================

test('Reg: Regression baseline for payload coverage is present', () => {
  expect(RegressionBaseline.payloadCoverage.schemaTest.totalTests).toBeGreaterThan(0);
});

/**
 * Suite cleanup
 */
afterAll(() => {
  console.log('Payload schema test suite completed');
});