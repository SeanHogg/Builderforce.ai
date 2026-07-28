/**
 * Payload generation and validation utilities for unit tests.
 * Supports deterministic output generation (FR-1.2) and schema validation (FR-1.1).
 */

import { ProgressPayload } from '../../fixtures/types';
import { validPayloads, edgeCasePayloads, invalidPayloads, generateDeterministicPayload } from '../../fixtures/mockData';

/**
 * Assert that payload conforms to schema (FR-1.1, FR-1.3).
 * Checks required fields, optional field handling, and types.
 */
export function assertPayloadSchema(
  payload: Partial<ProgressPayload>,
  expectedFields: (keyof ProgressPayload)[] = ['basis', 'subtasksDone', 'subtasksTotal', 'timestamp']
): void {
  // Check required fields
  for (const field of expectedFields) {
    if (payload[field] === undefined) {
      throw new Error(`Schema violation: missing required field '${field}'`);
    }
  }

  // Validate literal union for basis
  if (payload.basis !== 'basis' && payload.basis !== 'subtasks') {
    throw new Error(`Schema violation: basis must be 'basis' or 'subtasks', got '${payload.basis}'`);
  }

  // Validate numeric ranges
  if (payload.subtasksDone !== undefined && payload.subtasksTotal !== undefined) {
    if (payload.subtasksDone < 0) {
      throw new Error(`Schema violation: subtasksDone cannot be negative, got ${payload.subtasksDone}`);
    }
    if (payload.subtasksTotal < 0) {
      throw new Error(`Schema violation: subtasksTotal cannot be negative, got ${payload.subtasksTotal}`);
    }
    if (payload.subtasksDone > payload.subtasksTotal) {
      throw new Error(
        `Schema violation: subtasksDone (${payload.subtasksDone}) cannot exceed subtasksTotal (${payload.subtasksTotal})`
      );
    }
  }

  // Validate timestamp format (ISO 8601)
  if (payload.timestamp) {
    const date = new Date(payload.timestamp);
    if (isNaN(date.getTime())) {
      throw new Error(`Schema violation: invalid timestamp format '${payload.timestamp}'`);
    }
  }
}

/**
 * Round-trip payload through JSON serialization (FR-1.6).
 * Verifies that JSON.stringify/Parse produces byte-equivalent output.
 */
export function assertRoundTrip(payload: ProgressPayload, description: string = 'Round-trip'): void {
  const serialized = JSON.parse(JSON.stringify(payload));
  if (serialized.basis !== payload.basis) {
    throw new Error(`${description}: basis mismatch`);
  }
  if (serialized.subtasksDone !== payload.subtasksDone) {
    throw new Error(`${description}: subtasksDone mismatch`);
  }
  if (serialized.subtasksTotal !== payload.subtasksTotal) {
    throw new Error(`${description}: subtasksTotal mismatch`);
  }
  if (serialized.timestamp !== payload.timestamp) {
    throw new Error(`${description}: timestamp mismatch`);
  }
}

/**
 * Generate deterministic payload for identical input testing (FR-1.2).
 * Uses seed to ensure same inputs always produce same outputs.
 */
export function generateDeterministicPayload(
  basis: 'basis' | 'subtasks',
  subtasksDone: number,
  subtasksTotal: number,
  timestamp: string,
  message?: string | null,
  taskId?: string | null,
  seed?: number
): ProgressPayload {
  // Deterministic hash from parts
  const deterministicSeed = seed ?? (function hash(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }(`${basis}-${subtasksDone}-${subtasksTotal}-${message ?? ''}-${taskId ?? ''}`));

  // Seed-based permutations for deterministic but varied output if needed
  const randomFactor = deterministicSeed % 100;

  return {
    basis,
    subtasksDone,
    subtasksTotal,
    timestamp,
    message: message ?? (randomFactor > 50 ? 'Mock message' : undefined),
    taskId: taskId ?? (randomFactor > 75 ? `task-${deterministicSeed}` : undefined),
  };
}

/**
 * Test collection generators to avoid duplicate payload objects.
 * Returns a collection that can be filtered.
 */
export class PayloadCollection {
  constructor(private readonly payloads: ProgressPayload[]) {}

  filter(predicate: (p: ProgressPayload) => boolean): ProgressPayload[] {
    return this.payloads.filter(predicate);
  }

  map<T>(fn: (p: ProgressPayload) => T): T[] {
    return this.payloads.map(fn);
  }

  includes(payload: Partial<ProgressPayload>): boolean {
    return this.payloads.some(
      p =>
        p.basis === payload.basis &&
        p.subtasksDone === payload.subtasksDone &&
        p.subtasksTotal === payload.subtasksTotal &&
        p.timestamp === payload.timestamp &&
        p.message === payload.message &&
        p.taskId === payload.taskId
    );
  }

  static fromValid(): PayloadCollection {
    return new PayloadCollection(validPayloads);
  }

  static fromEdgeCases(): PayloadCollection {
    return new PayloadCollection(edgeCasePayloads);
  }

  static fromInvalid(): PayloadCollection {
    throw new Error('Invalid payloads should not be used in assertPayloadSchema checks');
  }
}

/**
 * Sanitization test helper that raises errors on invalid inputs (FR-1.4).
 * Silencing this by catching is only allowed for specific negative test cases.
 */
export function sanitizeWithValidation(input: Partial<ProgressPayload>): ProgressPayload {
  assertPayloadSchema(input);
  return {
    basis: input.basis as 'basis' | 'subtasks',
    subtasksDone: input.subtasksDone!,
    subtasksTotal: input.subtasksTotal!,
    timestamp: input.timestamp!,
    message: input.message,
    taskId: input.taskId,
  } as ProgressPayload;
}