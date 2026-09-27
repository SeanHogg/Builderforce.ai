import { describe, expect, it } from 'vitest';
import { admitDeltaAgainstHead, deltaParseStatus } from './evermindDeltaLearn';

/**
 * The gateway's answers for the delta door. The payload contract itself is tested in
 * the engine (`parseDeltaLearnPayload`); the on-prem producer branches on exactly
 * these statuses, so they are pinned here.
 */
describe('deltaParseStatus', () => {
  it('maps a malformed body to 400 and an oversized one to 413', () => {
    expect(deltaParseStatus('invalid')).toBe(400);
    expect(deltaParseStatus('too-large')).toBe(413);
  });
});

describe('admitDeltaAgainstHead', () => {
  it('admits a delta taken against the current head', () => {
    expect(admitDeltaAgainstHead({ baseVersion: 8 }, { version: 8, mode: 'connected' })).toBeNull();
  });

  it('refuses a stale base with 409 AND the head to rebase onto', () => {
    expect(admitDeltaAgainstHead({ baseVersion: 7 }, { version: 8, mode: 'connected' }))
      .toEqual({ status: 409, body: expect.objectContaining({ headVersion: 8 }) });
  });

  it('answers unseeded and frozen before stale — neither is fixed by rebasing', () => {
    const unseeded = admitDeltaAgainstHead({ baseVersion: 3 }, { version: 0, mode: 'connected' });
    expect(unseeded?.status).toBe(409);
    expect(unseeded?.body.headVersion).toBeUndefined();
    expect(admitDeltaAgainstHead({ baseVersion: 2 }, { version: 3, mode: 'offline-frozen' })?.status).toBe(423);
  });
});
