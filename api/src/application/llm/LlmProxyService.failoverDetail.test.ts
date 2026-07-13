import { describe, expect, it } from 'vitest';
import { attemptToFailover } from './LlmProxyService';

// A `code: 0` failover ("no response") means the vendor `fetch()` threw before any
// HTTP status — the status alone hides WHY (a malformed header, a dropped connection,
// a rejected body). The dispatcher captures the thrown `Error.message` on the attempt;
// the failover mapper MUST carry it through as `detail` so a connected-account failure
// can name its own cause instead of the mystifying "errored (no response)".

describe('attemptToFailover — detail threading', () => {
  it('carries the thrown vendor message through as `detail` for a code-0 network throw', () => {
    const fo = attemptToFailover({
      model: 'claude-opus-4-8',
      vendor: 'anthropic',
      status: 0,
      error: 'network: TypeError: invalid header value',
      kind: 'network',
    });
    expect(fo.code).toBe(0);
    expect(fo.detail).toBe('network: TypeError: invalid header value');
  });

  it('truncates an over-long detail to keep the diagnostic bounded', () => {
    const fo = attemptToFailover({
      model: 'claude-opus-4-8',
      vendor: 'anthropic',
      status: 0,
      error: 'x'.repeat(500),
    });
    expect(fo.detail!.length).toBe(240);
  });

  it('omits `detail` when the attempt has no error text', () => {
    const fo = attemptToFailover({ model: 'gpt-4.1', vendor: 'openai', status: 429, error: '' });
    expect(fo.detail).toBeUndefined();
    expect(fo.code).toBe(429);
  });
});
