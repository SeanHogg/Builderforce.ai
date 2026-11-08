import { afterEach, describe, expect, it } from 'vitest';
import { notifyExecutionSubscribers, setExecutionEventSinks, type ExecutionSubscriberEvent } from './executionEvents';
import { Execution } from '../../domain/execution/Execution';
import { ExecutionStatus } from '../../domain/shared/types';

afterEach(() => setExecutionEventSinks());

const now = new Date();
/** A real `Execution`, so the event carries the real `toPlain()` shape the publishers send. */
const failedRun = (props: { payload?: string | null; result?: string | null; errorMessage?: string | null }) => Execution.reconstitute({
  id: 5 as never, taskId: 3 as never, agentId: null, agentHostId: null, tenantId: 1 as never, submittedBy: 'u', sessionId: null,
  status: ExecutionStatus.FAILED, payload: props.payload ?? null, cloudAgentRef: null, result: props.result ?? null,
  errorMessage: props.errorMessage ?? null, produced: null, startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
});

describe('notifyExecutionSubscribers redaction', () => {
  it('scrubs every projection at the one publish primitive (message text, status error, result)', () => {
    const seen: ExecutionSubscriberEvent[] = [];
    setExecutionEventSinks((e) => seen.push(e));
    const ghp = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
    const run = failedRun({ errorMessage: `clone failed for https://u:${ghp}@github.com/o/r`, result: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123' });

    notifyExecutionSubscribers(5, { type: 'message', executionId: 5, role: 'user', text: `use GITHUB_TOKEN=${ghp} please`, ts: 't' });
    notifyExecutionSubscribers(5, { type: 'status_change', executionId: 5, status: 'failed', execution: run.toPlain(), ts: 't' });

    const text = JSON.stringify(seen);
    expect(seen).toHaveLength(2);
    expect(text).not.toContain(ghp);
    expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz0123');
    expect(text).toContain('use GITHUB_TOKEN=');
  });

  it('regression: the execution.payload / result JSON text is redacted structurally, so it stays valid JSON with the secret gone', () => {
    const seen: ExecutionSubscriberEvent[] = [];
    setExecutionEventSinks((e) => seen.push(e));
    const run = failedRun({
      payload: JSON.stringify({ cloudAgentRef: 'agent-1', cmd: 'API_TOKEN="xyz123secret" run', env: { DB_PASSWORD: 'a b c' } }),
      result: JSON.stringify({ cmd: 'DB_PASSWORD="a b c" deploy' }),
    });

    notifyExecutionSubscribers(5, { type: 'status_change', executionId: 5, status: 'failed', execution: run.toPlain(), ts: 't' });

    const plain = (seen[0] as { execution: { payload: string; result: string } }).execution;
    const payload = JSON.parse(plain.payload) as { cloudAgentRef: string; cmd: string };
    const result = JSON.parse(plain.result) as { cmd: string };
    expect(payload.cloudAgentRef).toBe('agent-1');
    expect(JSON.stringify(seen)).not.toContain('xyz123secret');
    expect(JSON.stringify(seen)).not.toContain('a b c');
    expect(result.cmd).toContain('deploy');
  });
});
