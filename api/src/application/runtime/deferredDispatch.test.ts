/** A one-shot dispatch that admission deferred is parked as a `dispatch.deferred` audit row for the sweep. */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

const recordCloudToolEvent = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: (...a: unknown[]) => recordCloudToolEvent(...a) }));

import { DEFERRED_DISPATCH_EVENT, parkDeferredDispatch } from './deferredDispatch';

describe('parkDeferredDispatch', () => {
  it('regression: records the dispatch params under the ticket session key for the retry sweep', async () => {
    await parkDeferredDispatch({} as Db, { tenantId: 7, taskId: 42, submittedBy: 'system:autofix', payload: '{"a":1}', agentHostId: null });
    expect(recordCloudToolEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: 7, executionId: null, sessionKey: 'task:42', toolName: DEFERRED_DISPATCH_EVENT,
      detail: { submittedBy: 'system:autofix', payload: '{"a":1}', agentHostId: null },
    }));
  });

  it('never throws when the audit write fails', async () => {
    recordCloudToolEvent.mockRejectedValueOnce(new Error('db down'));
    await expect(parkDeferredDispatch({} as Db, { tenantId: 7, taskId: 42, submittedBy: 's' })).resolves.toBeUndefined();
  });
});
