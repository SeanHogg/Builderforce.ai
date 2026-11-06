import { describe, expect, it } from 'vitest';
import { describeStreamFailure, hostOf, type StreamFailureDetail } from './streamFailureDetail';

const base: StreamFailureDetail = {
  phase: 'headers',
  destination: { kind: 'provider', label: 'Kimi Code', host: 'api.kimi.ai' },
  elapsedMs: 240_400,
  idleMs: 240_000,
  requestBytes: 2048,
  messageCount: 1,
  toolCount: 0,
};

describe('describeStreamFailure', () => {
  it('names destination, phase, elapsed and size', () => {
    expect(describeStreamFailure(base)).toBe(
      'destination Kimi Code (api.kimi.ai) · no response headers · after 240s · request 2.0 KB · 1 message · 0 tools',
    );
  });

  it('adds body bytes and credential state when known', () => {
    const line = describeStreamFailure({ ...base, phase: 'body', bytesReceived: 512, credential: 'pending' });
    expect(line).toContain('stream failed after headers');
    expect(line).toContain('512 B received');
    expect(line).toContain('credential pending');
  });
});

describe('hostOf', () => {
  it('reads the host and tolerates a non-URL', () => {
    expect(hostOf('https://api.kimi.ai/coding/v1')).toBe('api.kimi.ai');
    expect(hostOf('nope')).toBe('nope');
  });
});
