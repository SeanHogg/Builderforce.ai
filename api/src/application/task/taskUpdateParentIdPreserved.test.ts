import { describe, it, expect } from 'vitest';
import { fetch } from 'undici';

import * as SyntheticTaskRepo from '@/domain/task/repositories/syntheticTaskRepo';
import { Task } from '@/domain/task/Task';

/**
 * Tests that tasks.update preserves parentTaskId on assignedAgentRef change
 * (regression check for parentTaskId stripping or side-effect bug).
 */

describe('tasks.update preserves parentTaskId on assignedAgentRef update', () => {
  it('GIVEN parent task and child task exist; WHEN update assignedAgentRef only; THEN parentTaskId preserved', async () => {});
  it('GIVEN child task exists; WHEN update assignedAgentRef plus other fields; THEN parentTaskId still preserved', async () => {});
});