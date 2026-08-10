import { describe, expect, it } from 'vitest';
import { applyMediaPrivacyMode } from './mediaPrivacy';

const servers = [
  { urls: ['stun:stun.example.test:3478'] },
  { urls: ['turn:relay.example.test:3478', 'turns:relay.example.test:5349'], username: 'u', credential: 'p' },
];

describe('applyMediaPrivacyMode', () => {
  it('removes every TURN URL in direct-only mode', () => {
    const result = applyMediaPrivacyMode(servers, true);
    expect(result).toEqual({ iceServers: [servers[0]], mode: 'direct-only', turnEnabled: false });
    expect(JSON.stringify(result.iceServers)).not.toMatch(/turn:/);
  });

  it('discloses TURN availability in relay-fallback mode', () => {
    const result = applyMediaPrivacyMode(servers, false);
    expect(result.iceServers).toEqual(servers);
    expect(result.turnEnabled).toBe(true);
  });
});
