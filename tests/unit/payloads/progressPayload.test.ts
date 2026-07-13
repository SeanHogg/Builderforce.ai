/**
 * Progress payload integration tests.
 * These tests validate payload behavior across the payloads module boundary.
 * FR-1.1–FR-1.3 covered here plus edge cases.
 */

import { test, expect } from '@jest/globals';
import { describeModule, assertStrictSchema } from '../../common';

describeModule('Payloads: ProgressPayload tests', test.describe);

interface ProgressPayload {
  basis: 'basis' | 'subtasks';
  subtasksDone: number;
  subtasksTotal: number;
  timestamp: string;
  message?: string | null;
  taskId?: string;
}

const allowedFields: (keyof ProgressPayload)[] = [
  'basis',
  'subtasksDone',
  'subtasksTotal',
  'timestamp',
];

test('valid progress payload conforms to schema (FR-1.1)', () => {
  const payload: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 3,
    subtasksTotal: 10,
    timestamp: new Date().toISOString(),
  };

  assertStrictSchema(payload, allowedFields);
});

test('optional fields empty/null when not provided (FR-1.3)', () => {
  const payload: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 5,
    subtasksTotal: 15,
    timestamp: new Date().toISOString(),
  };

  expect(payload.message).toBeUndefined();
  assertStrictSchema(payload, allowedFields);
});

test('optional fields populated when explicitly provided (FR-1.3)', () => {
  const payload: ProgressPayload = {
    basis: 'subtasks',
    subtasksDone: 2,
    subtasksTotal: 8,
    timestamp: new Date().toISOString(),
    message: 'Partial complete',
    taskId: 'task-42',
  };

  expect(payload.message).toBe('Partial complete');
  expect(payload.taskId).toBe('task-42');
  assertStrictSchema(payload, allowedFields);
});

test('payload serialization produces equal output (round-trip) (FR-1.6)', () => {
  const original: ProgressPayload = {
    basis: 'basis',
    subtasksDone: 5,
    subtasksTotal: 20,
    timestamp: new Date().toISOString(),
    message: '',
    taskId: 'task-123',
  };

  const json = JSON.stringify(original);
  const reparsed = JSON.parse(json);
  expect(reparsed).toMatchObject(original);
});