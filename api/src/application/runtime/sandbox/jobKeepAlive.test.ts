import { describe, expect, it } from 'vitest';
import { decideJobKeepAlive, JOB_KEEPALIVE_MAX_MS } from './jobKeepAlive';

describe('decideJobKeepAlive', () => {
  const now = 10_000_000;

  it('stops an idle container with no running job and clears the clock', () => {
    expect(decideJobKeepAlive(false, now - 1_000, now)).toEqual({ keep: false, since: null });
    expect(decideJobKeepAlive(false, undefined, now)).toEqual({ keep: false, since: null });
  });

  it('keeps it for a running job and starts the clock at the first renewal', () => {
    expect(decideJobKeepAlive(true, undefined, now)).toEqual({ keep: true, since: now });
  });

  it('keeps the original start across later renewals', () => {
    const since = now - 30 * 60_000;
    expect(decideJobKeepAlive(true, since, now)).toEqual({ keep: true, since });
  });

  it('stops an abandoned job once the keep-alive has run the cap, and clears the clock', () => {
    expect(decideJobKeepAlive(true, now - JOB_KEEPALIVE_MAX_MS, now)).toEqual({ keep: false, since: null });
    expect(decideJobKeepAlive(true, now - JOB_KEEPALIVE_MAX_MS + 1, now)).toMatchObject({ keep: true });
  });

  it('caps the keep-alive at 60 minutes', () => {
    expect(JOB_KEEPALIVE_MAX_MS).toBe(60 * 60_000);
  });
});
