import { afterEach, describe, expect, it } from 'vitest';
import { notifyExecutionSubscribers, setExecutionEventSinks, type ExecutionSubscriberEvent } from './executionEvents';

afterEach(() => setExecutionEventSinks());

describe('notifyExecutionSubscribers redaction', () => {
  it('scrubs every projection at the one publish primitive (message text, status error, result)', () => {
    const seen: ExecutionSubscriberEvent[] = [];
    setExecutionEventSinks((e) => seen.push(e));
    const ghp = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

    notifyExecutionSubscribers(5, { type: 'message', executionId: 5, role: 'user', text: `use GITHUB_TOKEN=${ghp} please`, ts: 't' } as ExecutionSubscriberEvent);
    notifyExecutionSubscribers(5, { type: 'status_change', executionId: 5, status: 'failed', errorMessage: `clone failed for https://u:${ghp}@github.com/o/r`, result: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123' } as unknown as ExecutionSubscriberEvent);

    const text = JSON.stringify(seen);
    expect(seen).toHaveLength(2);
    expect(text).not.toContain(ghp);
    expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz0123');
    expect(text).toContain('use GITHUB_TOKEN=');
  });
});
