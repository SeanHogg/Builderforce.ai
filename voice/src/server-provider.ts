/**
 * server-provider — Option B: synthesis through the metered gateway endpoint.
 *
 * Calls `POST /api/studio/voice-clones/:id/synthesize`, which loads the
 * license-checked reference sample, runs the clone, persists to
 * `studio_voiceovers`, bills the token ledger (`voice_clone_synthesis`), and is
 * read-through cached on sha256(cloneId + text + speed + lang). This is the path
 * that makes cloning audible on every device — including mobile / Safari with no
 * WebGPU — which is why the PRD ships it first.
 *
 * "Available" = a client is configured. The server is the authority on licensing
 * and entitlement; it returns 402/403 if the caller can't use this voice, surfaced
 * as a VoiceApiError the resolver turns into a fallback reason.
 */

import { Http } from './http';
import { VoiceApiError } from './http';
import type { NarrationProvider, NarrationResult, SynthesizeRequest, WordTimestamp } from './types';

export interface ServerProviderOptions {
  apiKey: string;
  voiceId: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** Raw shape returned by the synthesize route (see PRD §3.1). */
interface SynthesizeResponse {
  audioUrl: string;
  audioKey: string;
  durationMs: number;
  wordTimestamps: WordTimestamp[];
}

export class ServerCloneProvider implements NarrationProvider {
  readonly id = 'clone-server' as const;
  private readonly http: Http;
  private readonly voiceId: string;

  constructor(opts: ServerProviderOptions) {
    this.voiceId = opts.voiceId;
    this.http = new Http({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? 'https://api.builderforce.ai',
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    });
  }

  async isAvailable(): Promise<boolean> {
    // Configured ⇒ usable. The server enforces licensing per request; we don't
    // pre-flight it (that would be an extra round-trip the synth call already makes).
    return Boolean(this.voiceId);
  }

  async unavailableReason(): Promise<string | null> {
    return this.voiceId ? null : 'No voice id configured for server synthesis.';
  }

  async synthesize(req: SynthesizeRequest): Promise<NarrationResult> {
    const body: Record<string, unknown> = { text: req.text };
    if (req.speed !== undefined) body.speed = req.speed;
    if (req.language !== undefined) body.language = req.language;

    const res = await this.http.postJson<SynthesizeResponse>(
      `/api/studio/voice-clones/${encodeURIComponent(this.voiceId)}/synthesize`,
      body,
      req.signal,
    );

    return {
      engineId: this.id,
      cloned: true,
      audioUrl: res.audioUrl,
      audioKey: res.audioKey,
      durationMs: res.durationMs,
      wordTimestamps: res.wordTimestamps ?? [],
    };
  }
}

/** Narrow helper: is this error a licensing/entitlement denial (vs. transient)?
 *  The resolver uses it to phrase the fallback reason. */
export function isEntitlementError(err: unknown): err is VoiceApiError {
  return err instanceof VoiceApiError && (err.status === 402 || err.status === 403);
}
