/**
 * tts-provider adapter (Voice PRD §3.1) — the bytes-returning synthesis seam.
 *
 * The gateway LLM client is string-only; voice synthesis returns audio bytes, so
 * it goes through THIS separate adapter, not `llm-client`. It is provider-
 * agnostic: any clone-capable TTS endpoint that accepts (referenceAudio, text)
 * and returns audio bytes satisfies it. The endpoint is configured via env
 * (`VOICE_CLONE_TTS_URL` / `VOICE_CLONE_TTS_KEY`) so swapping the model — an
 * in-house trained server, or a vendor — is a config change, not a code change.
 *
 * When no provider is configured the adapter throws {@link TtsProviderUnavailable}
 * and the route turns it into an honest 503, never fabricated audio (PRD §7).
 */

import type { Env } from '../../env';

export interface CloneSynthesisInput {
  /** Reference sample bytes (the enrolled voice). */
  referenceAudio: ArrayBuffer;
  referenceContentType: string;
  /** The text to speak. */
  text: string;
  speed?: number;
  language?: string;
  /** The clone's `provider` column — passed through so a multi-backend endpoint
   *  can route (PRD §8: honor the stored provider, don't hardcode). */
  provider?: string;
  signal?: AbortSignal;
}

export interface CloneSynthesisOutput {
  /** Synthesized audio bytes. */
  audio: ArrayBuffer;
  contentType: string;
  durationMs: number;
  wordTimestamps: Array<{ word: string; startMs: number; endMs: number }>;
}

/** Thrown when no synthesis backend is configured — the route maps it to 503. */
export class TtsProviderUnavailable extends Error {
  constructor(message = 'Voice synthesis provider not configured.') {
    super(message);
    this.name = 'TtsProviderUnavailable';
  }
}

/** True when a synthesis backend is wired — the single source of truth the route
 *  reads for the honesty/fallback contract. */
export function isTtsProviderConfigured(env: Env): boolean {
  return Boolean(env.VOICE_CLONE_TTS_URL);
}

/**
 * Synthesize cloned audio via the configured provider. The request shape is a
 * neutral multipart-free JSON envelope (reference as base64) so it works against
 * a plain HTTP TTS service; adapt here if a chosen vendor needs a different wire
 * format — call sites never see the difference.
 */
export async function synthesizeClonedAudio(
  env: Env,
  input: CloneSynthesisInput,
): Promise<CloneSynthesisOutput> {
  const url = env.VOICE_CLONE_TTS_URL;
  if (!url) throw new TtsProviderUnavailable();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.VOICE_CLONE_TTS_KEY) headers.Authorization = `Bearer ${env.VOICE_CLONE_TTS_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text: input.text,
      speed: input.speed ?? 1,
      language: input.language,
      provider: input.provider,
      reference_audio_base64: arrayBufferToBase64(input.referenceAudio),
      reference_content_type: input.referenceContentType,
    }),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`TTS provider failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  // The provider returns JSON with base64 audio + timing (keeps one wire shape
  // regardless of the audio codec). A raw-bytes provider would set audio_base64
  // empty and stream — handled by the content-type branch below.
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await res.json()) as {
      audio_base64: string;
      content_type?: string;
      duration_ms?: number;
      word_timestamps?: Array<{ word: string; startMs: number; endMs: number }>;
    };
    return {
      audio: base64ToArrayBuffer(body.audio_base64),
      contentType: body.content_type ?? 'audio/wav',
      durationMs: body.duration_ms ?? 0,
      wordTimestamps: body.word_timestamps ?? [],
    };
  }

  // Raw audio bytes fallback (no timing metadata available).
  const audio = await res.arrayBuffer();
  return {
    audio,
    contentType: contentType || 'audio/wav',
    durationMs: Number(res.headers.get('x-duration-ms') ?? 0),
    wordTimestamps: [],
  };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
