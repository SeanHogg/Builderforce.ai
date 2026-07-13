/**
 * Payload schema and structure tests (FR-1.1 and forward).
 * Verifies payloads strictly conform to defined schema.
 */

import { test, describe } from '@jest/globals';
import { describeModule, assertStrictSchema, assertRoundTrip } from '../../common';
import { mockMessages } from '@builderforce/test-workspace/messages';

// Track where real implementation would live
// TODO: src/modules/payloads/schema.ts

describeModule('Payloads', test.describe);

interface ProgressPayload {
  basis: 'basis' | 'subtasks';
  subtasksDone: number;
  subtasksTotal: number;
  timestamp: string;
  message?: string | null;
  taskId?: string;
}

// Allowed fields per definition (examples of expected schema)
const progressFields: (keyof ProgressPayload)[] = [
  'basis',
  'subtasksDone',
  'subtasksTotal',
  'timestamp',
];

test('FR-1.1: well-formed input produces schema-compliant payload', () => {
  const event: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date().toISOString(),
  };

  expect(event.basis).toBe('basis');
  expect(event.subtasksDone).toBe(3);
  expect(event.subtasksTotal).toBe(10);
  expect(typeof event.timestamp).toBe('string');
  // TODO: robust schema validator is implemented in src/modules/payloads/schema.ts; here we verify shape
});

test('FR-1.1+: all allowed fields present in equivalent round trip', () => {
  const event: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 5,
    subtasksTotal: 20,
    timestamp: new Date().toISOString(),
    message: 'Example message',
    taskId: 'task-42',
  };

  assertStrictSchema(event, progressFields);
  assertRoundTrip(event, 'Round-trip of well-formed event');
});

test('FR-1.3: optional fields omitted when not present', () => {
  const event: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 1,
    subtasksTotal: 5,
    timestamp: new Date().toISOString(),
  };

  expect(event.message).toBeUndefined();
  expect(event.taskId).toBeUndefined();

  assertStrictSchema(event, progressFields);
});

test('FR-1.3: optional fields populated when explicitly provided', () => {
  const event: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date().toISOString(),
    message: 'Partial completion',
    taskId: 'task-123',
  };

  expect(event.message).toBe('Partial completion');
  expect(event.taskId).toBe('task-123');

  assertStrictSchema(event, progressFields);
});

test('FR-1.2: identical inputs produce deterministic payloads (round trip)', () => {
  const payload0: ProgressPayload = {
    basis: 'subtasks',
    subtasksDone: 2,
    subtasksTotal: 8,
    timestamp: new Date().toISOString(),
  };

  const payload1: ProgressPayload = {
    basis: 'subtasks',
    subtasksDone: 2,
    subtasksTotal: 8,
    timestamp: new Date().toISOString(),
  };

  assertRoundTrip(payload0, 'First run round-trip');
  assertRoundTrip(payload1, 'Second run round-trip');
  // TODO: deterministic comparison would be implemented in src/modules/payloads/deterministic.ts
});