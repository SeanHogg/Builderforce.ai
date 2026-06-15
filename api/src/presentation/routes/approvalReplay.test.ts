import { describe, it, expect } from 'vitest';
import { parseApprovalReplay } from './runtimeRoutes';

/**
 * `parseApprovalReplay` reads the run context the approval gate stores on a
 * `task.execution` approval, so approving it can replay the EXACT original run
 * (same cloud agent + model in the payload, same per-run host). This is the
 * contract behind "approve actually starts the task" — before the fix, approving
 * only flipped the row and the run never started.
 */
describe('parseApprovalReplay', () => {
  it('round-trips the gate metadata (taskId + payload + agentHostId)', () => {
    const payload = JSON.stringify({ cloudAgentRef: 'kevin-durable', model: 'claude-opus-4-8' });
    const metadata = JSON.stringify({ taskId: 78, priority: 'high', payload, agentHostId: null });

    expect(parseApprovalReplay(metadata)).toEqual({ taskId: 78, payload, agentHostId: null });
  });

  it('carries a per-run pinned host through for on-prem high-priority runs', () => {
    const metadata = JSON.stringify({ taskId: 5, priority: 'urgent', payload: undefined, agentHostId: 42 });

    expect(parseApprovalReplay(metadata)).toEqual({ taskId: 5, payload: undefined, agentHostId: 42 });
  });

  it('handles a stringified-number taskId and a missing payload', () => {
    const metadata = JSON.stringify({ taskId: '12', priority: 'high' });

    expect(parseApprovalReplay(metadata)).toEqual({ taskId: 12, payload: undefined, agentHostId: null });
  });

  it('returns null when there is no parseable taskId (non-task.execution rows)', () => {
    expect(parseApprovalReplay(null)).toBeNull();
    expect(parseApprovalReplay('not json')).toBeNull();
    expect(parseApprovalReplay(JSON.stringify({ priority: 'high' }))).toBeNull();
  });
});
