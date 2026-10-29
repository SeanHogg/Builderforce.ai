/**
 * Which recorder a loader hit is told to inject (PRD 33 §3.5): a manifest channel,
 * a pinned recorder hash, the platform pin, else the latest. The hash length is the
 * contract's `RECORDER_HASH_LENGTH` — the length `replay-sdk/scripts/emit-assets.mjs`
 * actually writes — so a hash read off the CDN can really be pinned.
 */
import { describe, expect, it } from 'vitest';
import { RECORDER_HASH_LENGTH } from '@builderforce/interaction-contract';
import { pickRecorder, type RecorderManifest } from './ReplayConfigService';

const ORIGIN = 'https://cdn.builderforce.ai';
const MANIFEST: RecorderManifest = {
  latest: { version: '2026.10.3', url: `${ORIGIN}/replay/r/recorder.aaaaaaaaaaaa.js`, hash: 'aaaaaaaaaaaa' },
};

describe('pickRecorder', () => {
  it('pins a channel that is a full-length recorder hash (the length emit-assets writes)', () => {
    const hash = '0123456789ab';
    expect(hash).toHaveLength(RECORDER_HASH_LENGTH);
    expect(pickRecorder(MANIFEST, hash)).toEqual({ url: `${ORIGIN}/replay/r/recorder.${hash}.js`, version: hash });
  });

  it('honours REPLAY_CDN_ORIGIN for a pinned hash and trims its trailing slash', () => {
    expect(pickRecorder(MANIFEST, '0123456789ab', 'https://cdn.example.test//')?.url)
      .toBe('https://cdn.example.test/replay/r/recorder.0123456789ab.js');
  });

  it('does not treat a short or non-hex channel as a hash', () => {
    expect(pickRecorder(MANIFEST, '0123abcd')?.url).toBe(MANIFEST.latest!.url);
    expect(pickRecorder(MANIFEST, 'zzzzzzzzzzzz')?.url).toBe(MANIFEST.latest!.url);
  });

  it('prefers a named manifest channel, then the platform pin, then the latest', () => {
    const withPins: RecorderManifest = {
      ...MANIFEST,
      pinned: { version: 'pin', url: `${ORIGIN}/replay/r/recorder.bbbbbbbbbbbb.js` },
      channels: { stable: { version: 'stable', url: `${ORIGIN}/replay/r/recorder.cccccccccccc.js` } },
    };
    expect(pickRecorder(withPins, 'stable')?.version).toBe('stable');
    expect(pickRecorder(withPins, 'unknown')?.version).toBe('pin');
    expect(pickRecorder(withPins, null)?.version).toBe('pin');
    expect(pickRecorder(MANIFEST, null)?.version).toBe('2026.10.3');
  });

  it('ignores a channel or pin whose url is not https and falls through', () => {
    const bad: RecorderManifest = { ...MANIFEST, pinned: { url: 'http://x/r.js' }, channels: { stable: { url: '' } } };
    expect(pickRecorder(bad, 'stable')?.version).toBe('2026.10.3');
  });

  it('is null with no manifest and no pinnable channel', () => {
    expect(pickRecorder(null, 'stable')).toBeNull();
  });
});
