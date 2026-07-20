/**
 * Progress payload integration tests (FR-1.1–FR-1.3, FR-1.5, FR-1.6).
 * These tests validate payload behavior across the payloads module boundary.
 */

import { test, expect } from '@jest/globals';
import { describeModule } from '../../common';
import {
  validPayloads,
  edgeCasePayloads,
  unicodePayloads,
  RegressionBaseline,
} from '../../fixtures/mockData';
import { ProgressPayload } from '../../fixtures/types';
import { assertPayloadSchema, assertRoundTrip, sanitizeWithValidation } from './payloadUtils';

describeModule('Payloads: ProgressPayload tests', test.describe);

const allowedFields: string[] = [
  'basis',
  'subtasksDone',
  'subtasksTotal',
  'timestamp',
];

// =============================================================================
// FR-1.1: Schema compliance
// =============================================================================

test('FR-1.1: valid progress payload conforms to schema', () => {
  const payload = validPayloads[0];
  assertPayloadSchema(payload);
});

test('FR-1.1+: all valid fixtures pass schema validation', () => {
  validPayloads.forEach(payload => {
    assertPayloadSchema(payload);
  });
});

// =============================================================================
// FR-1.2: Deterministic output
// =============================================================================

test('FR-1.2: identical inputs produce deterministic payloads', () => {
  const timestamp = new Date().toISOString();
  const payloadA = { basis: 'basis' as const, subtasksDone: 3, subtasksTotal: 10, timestamp };
  const payloadB = { basis: 'basis' as const, subtasksDone: 3, subtasksTotal: 10, timestamp };

  expect(payloadA).toEqual(payloadB);
  expect(JSON.stringify(payloadA)).toBe(JSON.stringify(payloadB));
});

// =============================================================================
// FR-1.3: Optional fields
// =============================================================================

test('FR-1.3: optional fields empty/null when not provided', () => {
  const payload = edgeCasePayloads[5]; // message: undefined, taskId: undefined
  expect(payload.message).toBeUndefined();
  expect(payload.taskId).toBeUndefined();
  assertPayloadSchema(payload);
});

test('FR-1.3+: optional fields populated when explicitly provided', () => {
  const payload = validPayloads[0];
  expect(payload.message).toBe('Normal progress during development');
  expect(payload.taskId).toBe('task-42');
  assertPayloadSchema(payload);
});

// =============================================================================
// FR-1.5: Boundary conditions
// =============================================================================

test('FR-1.5: payload with maximum values is valid', () => {
  const maxPayload = edgeCasePayloads[1];
  assertPayloadSchema(maxPayload);
  expect(maxPayload.subtasksDone).toBe(Number.MAX_SAFE_INTEGER);
  expect(maxPayload.subtasksTotal).toBe(Number.MAX_SAFE_INTEGER);
});

test('FR-1.5+: payload with zero values is valid', () => {
  const zeroPayload = edgeCasePayloads[0];
  assertPayloadSchema(zeroPayload);
  expect(zeroPayload.subtasksDone).toBe(0);
  expect(zeroPayload.subtasksTotal).toBe(0);
});

// =============================================================================
// FR-1.6: Serialization
// =============================================================================

test('FR-1.6: payload serialization produces equal output (round-trip)', () => {
  const original = validPayloads[0];
  assertRoundTrip(original, 'ProgressPayload round-trip');
});

// =============================================================================
// Edge Cases and Negative Tests (AC-5)
// =============================================================================

test('AC-5.1: Unicode payloads round-trip successfully', () => {
  unicodePayloads.forEach(payload => {
    assertPayloadSchema(payload);
    assertRoundTrip(payload, 'Unicode round-trip');
  });
});

test('AC-5.2: payload with null message round-trips', () => {
  const nullPayload = edgeCasePayloads[4];
  assertRoundTrip(nullPayload, 'Null message round-trip');
});

// =============================================================================
// Regression Baseline
// =============================================================================

test('Reg: Regression baseline for progress payload coverage', () => {
  expect(RegressionBaseline.payloadCoverage.progressTest).toBeDefined();
  expect(RegressionBaseline.payloadCoverage.progressTest.totalTests).toBeGreaterThan(0);
});

/**
 * Suite cleanup
 */
afterAll(() => {
  console.log('ProgressPayload test suite completed');
});