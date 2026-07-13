import { describe, it, expect, vi } from 'vitest';
import {
  selectVideoCodec,
  AVC_CODEC_CANDIDATES,
  pixelsToRgba,
  type VideoEncoderConfigProbe,
} from './webcodecs-muxer';

/**
 * Locks the runtime codec selection (Consolidated Gap Register #140): instead of
 * hardcoding `avc1.42E01F` — which Safari rejects for many dimensions — the muxer
 * probes `VideoEncoder.isConfigSupported` across a compatibility-ordered profile
 * list and either picks the first supported one or reports an honest null (→ the
 * caller throws an actionable error). We inject a fake probe so this runs in node.
 */

const OPTS = { width: 512, height: 512, fps: 24 };

function probeAllowing(supported: Set<string>): VideoEncoderConfigProbe {
  return {
    isConfigSupported: vi.fn(async (cfg) => ({ supported: supported.has(cfg.codec) })),
  };
}

describe('selectVideoCodec', () => {
  it('returns the first candidate when every profile is supported', async () => {
    const probe = probeAllowing(new Set(AVC_CODEC_CANDIDATES));
    expect(await selectVideoCodec(OPTS, probe)).toBe(AVC_CODEC_CANDIDATES[0]);
  });

  it('skips unsupported profiles and returns the first supported one', async () => {
    // Only the High profile is supported (the Safari-pickiness case).
    const high = AVC_CODEC_CANDIDATES[AVC_CODEC_CANDIDATES.length - 1];
    const probe = probeAllowing(new Set([high]));
    expect(await selectVideoCodec(OPTS, probe)).toBe(high);
  });

  it('returns null when NO profile is supported (no MP4 encode path)', async () => {
    const probe = probeAllowing(new Set());
    expect(await selectVideoCodec(OPTS, probe)).toBeNull();
  });

  it('treats a throwing probe candidate as unsupported and keeps trying', async () => {
    const good = AVC_CODEC_CANDIDATES[1];
    const probe: VideoEncoderConfigProbe = {
      isConfigSupported: vi.fn(async (cfg) => {
        if (cfg.codec === AVC_CODEC_CANDIDATES[0]) throw new Error('boom');
        return { supported: cfg.codec === good };
      }),
    };
    expect(await selectVideoCodec(OPTS, probe)).toBe(good);
  });

  it('falls back to the most-compatible codec when no probe is available', async () => {
    // No injected probe + no global VideoEncoder in node → historical default,
    // letting configure() surface any real incompatibility.
    expect(await selectVideoCodec(OPTS)).toBe(AVC_CODEC_CANDIDATES[0]);
  });

  it('passes the requested dimensions/bitrate through to the probe', async () => {
    const probe = probeAllowing(new Set([AVC_CODEC_CANDIDATES[0]]));
    await selectVideoCodec({ width: 768, height: 320, fps: 30, bitrate: 5_000_000 }, probe);
    expect(probe.isConfigSupported).toHaveBeenCalledWith(
      expect.objectContaining({ width: 768, height: 320, framerate: 30, bitrate: 5_000_000 }),
    );
  });
});

describe('pixelsToRgba (unchanged contract sanity)', () => {
  it('maps [-1,1] planar RGB to opaque 0..255 RGBA', () => {
    // 1px: R=+1 (→255), G=0 (→~128), B=-1 (→0).
    const px = Float32Array.from([1, 0, -1]);
    const out = pixelsToRgba(px, 1, 1);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(128);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(255);
  });
});
