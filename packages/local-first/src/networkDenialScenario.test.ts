import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NETWORK_DENIAL_HOSTS,
  runNetworkDenialScenario,
  type NetworkDenialHost,
} from './networkDenialScenario.js';

/**
 * Same scenario, three host names. This is an in-process stand-in.
 * it does not drive a packaged extension or a real browser, so it does not by itself close G27.
 */

const DISCLAIMER =
  'it does not drive a packaged extension or a real browser, so it does not by itself close G27';

const FORBIDDEN = [
  ['fe', 'tch('].join(''),
  ['globalThis', 'fetch'].join('.'),
  ['Web', 'Socket'].join(''),
  ['create', 'Connection'].join(''),
  ['create', 'Server'].join(''),
  ['node:', 'http'].join(''),
  ['node:', 'https'].join(''),
  ['node:', 'net'].join(''),
  ['node:', 'dgram'].join(''),
  ['node:', 'tls'].join(''),
];

function source(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}

describe('network denial scenario', () => {
  it('names web, Rovr, and VSIX and does not claim to close the packaged gate', () => {
    expect([...NETWORK_DENIAL_HOSTS]).toEqual(['web', 'rovr', 'vsix']);
    const scenario = source('networkDenialScenario.ts');
    const testSource = source('networkDenialScenario.test.ts');
    expect(scenario).toContain(DISCLAIMER);
    expect(testSource).toContain(DISCLAIMER);
    expect(scenario).toContain('closesG27: false');
    for (const needle of FORBIDDEN) {
      expect(scenario.includes(needle)).toBe(false);
      expect(testSource.includes(needle)).toBe(false);
    }
  });

  it.each([...NETWORK_DENIAL_HOSTS])(
    'rejects a platform call, writes locally, restarts, and replays a batch on %s',
    async (host) => {
      const result = await runNetworkDenialScenario(host);
      expect(result.host).toBe(host);
      expect(result.networkDenied).toBe(true);
      expect(result.platformCallRejected).toBe(true);
      expect(result.platformCallPerformed).toBe(false);
      expect(result.platformCallCount).toBe(0);
      expect(result.closesG27).toBe(false);
      expect(result.deniedCall).toEqual({
        capability: 'synchronize',
        replayable: true,
        recorded: true,
      });
      expect(result.write).toEqual({
        id: `ticket-${host}`,
        eventId: `event-${host}`,
        entityType: 'ticket',
        title: `offline-${host}`,
        host,
      });
      expect(result.restarted).toBe(true);
      expect(result.secondStoreRead).toBe(true);
      expect(result.readAfterRestart).toEqual(result.write);
      expect(result.batchReplayed).toEqual({
        later: true,
        replayedAfterRestart: true,
        batchId: `later-replay-${host}`,
        protocolVersion: 1,
        eventIds: [`event-${host}`],
        platformCallPerformed: false,
      });
    },
  );

  it('refuses a host that is not web, rovr, or vsix', async () => {
    await expect(runNetworkDenialScenario('electron' as NetworkDenialHost)).rejects.toThrow('unknown_host');
  });
});
