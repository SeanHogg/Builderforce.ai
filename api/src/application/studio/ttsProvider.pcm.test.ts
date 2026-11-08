import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeWav } from '@builderforce/voice-provenance';
import { synthesizeClonedAudio } from './ttsProvider';
import type { Env } from '../../env';

afterEach(() => vi.unstubAllGlobals());

const env = { VOICE_CLONE_TTS_URL: 'https://tts.example' } as Env;
const input = { referenceAudio: new ArrayBuffer(4), referenceContentType: 'audio/wav', text: 'hi' };

describe('ttsProvider PCM handling', () => {
  it('asks the vendor for uncompressed audio', async () => {
    const fetchMock = vi.fn(async () => new Response(new ArrayBuffer(4), { headers: { 'content-type': 'audio/wav' } }));
    vi.stubGlobal('fetch', fetchMock);
    await synthesizeClonedAudio(env, input);
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [unknown, RequestInit])[1].body as string);
    expect(sent).toMatchObject({ response_format: 'wav', output_format: 'wav', sample_rate: 24000, pcm_output_format: 'pcm_24000' });
  });

  it('wraps a headerless PCM16 answer in a decodable WAV at the stated rate', async () => {
    const pcm = new Int16Array([0, 1000, -1000, 2000]);
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(pcm.buffer, { headers: { 'content-type': 'audio/L16;rate=16000' } })));
    const out = await synthesizeClonedAudio(env, input);
    expect(out.contentType).toBe('audio/wav');
    const wav = decodeWav(out.audio);
    expect(wav?.sampleRate).toBe(16000);
    expect(wav?.channels[0]).toHaveLength(4);
  });
});
