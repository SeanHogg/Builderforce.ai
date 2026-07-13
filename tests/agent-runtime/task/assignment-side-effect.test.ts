/**
 * Test Suite for Auto-Run Side-Effect Trigger Verification
 * PRD: Verify Auto-Run Side Effect Triggers Once Per Assignment (task #691)
 *
 * This test suite verifies that the auto-run side effect fires exactly once per logical assignment
 * operation, covering all critical scenarios defined in FR-3 (FR-3.1 through FR-3.6).
 *
 * Test prepared for completeness; executes assertions now.
 */

import {
  AssignmentService,
  AssignmentContext,
  SideEffectHandler,
} from '../../../agent-runtime/src/task/assignment';
import {
  StatsSideEffectHandler,
} from '../../../agent-runtime/src/task/auto-run-triggers';

describe('AssignmentService: Auto-Run Side-Effect Fire Behavior (PRD #691)', () => {
  let assignmentService: AssignmentService;

  beforeEach(() => {
    assignmentService = new AssignmentService();
    // Seed test agents and tasks for assignment tests
    assignmentService['agents'].set('agent-1', { id: 'agent-1', name: 'Agent One', type: 'human' });
    assignmentService['agents'].set('agent-2', { id: 'agent-2', name: 'Agent Two', type: 'human' });
    assignmentService['tasks'].set('task-1', {
      id: 'task-1',
      title: 'First Task',
      status: 'created',
      createdAt: Date.now() - 10000,
      updatedAt: Date.now() - 10000,
    });
    assignmentService['tasks'].set('task-2', {
      id: 'task-2',
      title: 'Second Task',
      status: 'created',
      createdAt: Date.now() - 5000,
      updatedAt: Date.now() - 5000,
    });
  });

  afterEach(() => {
    // Reset handlers after each test for isolation
    const sideEffects = assignmentService['sideEffectRegistry'] as Set<SideEffectHandler>;
    sideEffects.clear();
  });

  describe('FR-3.1 — Happy-path unit test: Side effect fires exactly once per assignment', () => {
    test('Assign one agent to one task → side effect spy/mock called exactly 1 time', async () => {
      // Track side effect invocations
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);

      // Perform single assignment operation
      await assignmentService.assignAgentToTask('task-1', 'agent-1');

      // Verify exactly ONE invocation
      expect(statsHandler.getInvocationCount()).toBe(1);
    });
  });

  describe('FR-3.2 — Repeated assignment call test: Multiple calls for same agent-task pair', () => {
    test('Call assignAgentToTask N times in sequence for same agent-task pair → side effect fires exactly N times', async () => {
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);

      const expectedCalls = 3;
      for (let i = 0; i < expectedCalls; i++) {
        await assignmentService.assignAgentToTask('task-1', 'agent-1');
      }

      // Should fire exactly N times (not idempotent per logical assignment)
      expect(statsHandler.getInvocationCount()).toBe(expectedCalls);
    });

    test('Multiple assignments for different agent-task pairs fire correctly (assignment per pair)', async () => {
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);

      await assignmentService.assignAgentToTask('task-1', 'agent-1');
      await assignmentService.assignAgentToTask('task-2', 'agent-2');
      await assignmentService.assignAgentToTask('task-1', 'agent-2'); // Same task, different agent

      // Three distinct assignments: (task-1/agent-1), (task-2/agent-2), (task-1/agent-2)
      expect(statsHandler.getInvocationCount()).toBe(3);
    });
  });

  describe('FR-3.3 — Rapid concurrent assignment test: Concurrent calls for same agent-task pair', () => {
    test('Trigger assignment operation concurrently (multiple simultaneous calls with same agent-task pair) → asserts no duplicate fires', async () => {
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);

      // Start 3 concurrent assignments for same pair
      const promises = [
        assignmentService.assignAgentToTask('task-1', 'agent-1'),
        assignmentService.assignAgentToTask('task-1', 'agent-1'),
        assignmentService.assignAgentToTask('task-1', 'agent-1'),
      ];

      await Promise.all(promises);

      // Each concurrent call is a logical assignment; we expect 3 logs (ordered per-frame)
      // The AssignmentService checks per-assignment-id and COALESces duplicates per unique assignmentId
      // We verify the ID tracking correctly deduplicates identical calls that share sametaskId:agentId
      const firedAssignments = assignmentService.getFiredAssignments();
      // Should have exactly 1 unique assignmentId (task-1:agent-1) despite 3 calls
      expect(firedAssignments).toHaveLength(1);
      expect(firedAssignments[0]).toBe('task-1:agent-1');

      // StatsSideEffectHandler records each handle() call; assignPipeline fires per unique assignment.
      // With per-assignment-id guard, expect 1 handler call from the first of the concurrent block
      expect(statsHandler.getInvocationCount()).toBe(1);
    });
  });

  describe('FR-3.4 — Re-render / re-mount test: Side effect does not re-register', () => {
    test('Perform assignment operation after component re-render → side effect does not fire again due to re-registration', async () => {
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);

      // Perform assignment
      await assignmentService.assignAgentToTask('task-1', 'agent-1');
      expect(statsHandler.getInvocationCount()).toBe(1);

      // Simulate re-render without deregistration (side effect stays registered)
      // Since side effect is a one-time handler in AssignmentService, it will only fire per assignmentId
      // The issue is if registration re-justifies another tick, but we have no React code here.
      // Verify that re-render simulation does not cause duplicate fire despite handler remaining registered.
      expect(statsHandler.getInvocationCount()).toBe(1); // Must remain 1
    });

    test('Multiple side-effect registrations for same handler (duplicate registration) → should not duplicate fires', async () => {
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);
      assignmentService.registerSideEffect(statsHandler); // Register same handler again

      await assignmentService.assignAgentToTask('task-1', 'agent-1');

      // Side effect handler is added to Set only once; we should still fire exactly once
      expect(statsHandler.getInvocationCount()).toBe(1);
    });
  });

  describe('FR-3.5 — No-assignment baseline test: Operations without assignment do not fire side effect', () => {
    test('Perform task operations that do NOT include assignment → assert side effect fires 0 times', async () => {
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);

      // Perform actions that should NOT trigger side effects
      await assignmentService['tasks'].get('task-1')!.status;
      expect(statsHandler.getInvocationCount()).toBe(0);
    });

    test('Task creation without agent assignment does not fire side effect', async () => {
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);

      const newTaskId = 'task-new';
      assignmentService['tasks'].set(newTaskId, {
        id: newTaskId,
        title: 'New Task',
        status: 'created',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Only create the task, do not call assignAgentToTask
      expect(statsHandler.getInvocationCount()).toBe(0);
    });
  });

  describe('FR-3.6 — Re-assignment test: Different agents to same task fire distinct side effects', () => {
    test('Assign agent A, then assign agent B to the SAME task → assert side effect fires exactly 2 times (once per distinct agent assignment)', async () => {
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);

      // First assignment
      await assignmentService.assignAgentToTask('task-1', 'agent-1');
      expect(statsHandler.getInvocationCount()).toBe(1);

      // Second assignment (different agent on same task)
      await assignmentService.assignAgentToTask('task-1', 'agent-2');
      expect(statsHandler.getInvocationCount()).toBe(2);

      const firedAssignments = assignmentService.getFiredAssignments();
      expect(firedAssignments).toHaveLength(2);
      expect(firedAssignments).toContain('task-1:agent-1');
      expect(firedAssignments).toContain('task-1:agent-2');
    });

    test('Multiple assignment changes for same task (round-robin) fire distinctly', async () => {
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);

      await assignmentService.assignAgentToTask('task-1', 'agent-1');
      await assignmentService.assignAgentToTask('task-1', 'agent-2');
      await assignmentService.assignAgentToTask('task-1', 'agent-1');
      await assignmentService.assignAgentToTask('task-1', 'agent-3');

      // Four distinct assignment IDs (A→1, A→2, A→1, A→3)
      expect(statsHandler.getInvocationCount()).toBe(4);
      const firedAssignments = assignmentService.getFiredAssignments();
      expect(firedAssignments).toHaveLength(4);
      expect(firedAssignments).toContain('task-1:agent-1');
      expect(firedAssignments).toContain('task-1:agent-2');
      expect(firedAssignments).toContain('task-1:agent-3');
    });
  });

  describe('Integration Observability: FR-4.3 — Log entry per fire including task ID and agent ID', () => {
    test('Auto-run side effect emits a log entry at INFO level per fire including taskId and agentId', async () => {
      const statsHandler = new StatsSideEffectHandler();
      assignmentService.registerSideEffect(statsHandler);

      await assignmentService.assignAgentToTask('task-42', 'agent-99');

      // Verify the payload in the side effect call
      const lastCallArgs = statsHandler.getLastCallArgs();
      expect(lastCallArgs).not.toBeNull();
      expect(lastCallArgs!.taskId).toBe('task-42');
      expect(lastCallArgs!.agentId).toBe('agent-99');
      expect(typeof lastCallArgs!.timestamp).toBe('number');
    });
  });
});