import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const teardown = vi.hoisted(() => vi.fn());
const reported = vi.hoisted(() => vi.fn());
vi.mock('./runRollback', () => ({ teardownCrashedRunArtifacts: teardown }));
vi.mock('../observability/caughtErrorReporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../observability/caughtErrorReporter')>()),
  reportCaughtError: reported,
}));

import { sweepFailedCloudRun } from './failedRunSweep';

const db = {} as Db;
const env = { JWT_SECRET: 'jwt-secret' } as unknown as Env;

beforeEach(() => { teardown.mockReset(); reported.mockReset(); teardown.mockResolvedValue({ deleted: true, branch: 'b', commits: 1 }); });

describe('sweepFailedCloudRun - the branch residue of a cloud run that landed FAILED', () => {
  it('sweeps a failed cloud run, with the credential secret the repo context is sealed with', async () => {
    await sweepFailedCloudRun(env, db, { id: 62, status: 'failed', cloudAgentRef: 'bob' });

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledWith(env, db, { executionId: 62, secret: 'jwt-secret' });
  });

  it.each([
    ['a completed run', { id: 62, status: 'completed', cloudAgentRef: 'bob' }],
    ['a cancelled run (the cloud finalize sweeps its branch)', { id: 62, status: 'cancelled', cloudAgentRef: 'bob' }],
    ['a failed run that is not a cloud run (a host\'s own run)', { id: 62, status: 'failed', cloudAgentRef: null }],
  ])('does nothing for %s', async (_name, run) => {
    await sweepFailedCloudRun(env, db, run);
    expect(teardown).not.toHaveBeenCalled();
  });

  it('a sweep that throws is reported and swallowed - it never changes how the run landed', async () => {
    teardown.mockRejectedValue(new Error('provider down'));

    await expect(sweepFailedCloudRun(env, db, { id: 62, status: 'failed', cloudAgentRef: 'bob' })).resolves.toBeUndefined();

    expect(reported).toHaveBeenCalledTimes(1);
  });
});
