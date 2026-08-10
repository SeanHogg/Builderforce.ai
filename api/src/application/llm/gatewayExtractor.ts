/**
 * `gatewayExtractor` — the shared {@link LlmComplete} for structured-extraction
 * work: turning prose into a spec, a brief into requirements, a design into
 * handlers.
 *
 * These calls have the same profile wherever they appear — deterministic
 * (temperature 0), short, JSON-out, and NOT worth a tenant's paid budget — so
 * they run on the free pool through `ideProxy`. Extracted here because the
 * compile primitive and the challenge pipeline both need exactly this and were
 * otherwise going to keep their own copies, which is how two callers end up
 * quietly disagreeing about temperature or about whether a non-string reply is
 * an error or an empty string.
 */

import type { LlmComplete } from '../compile';
import type { Env } from '../../env';
import { ideProxy } from './LlmProxyService';

export interface GatewayExtractorOptions {
  /** Metering label, so extraction traffic is attributable per caller. */
  useCase?: string;
  /** Reply ceiling. Extraction replies are JSON documents, not prose. */
  maxTokens?: number;
}

/**
 * Build an extractor bound to the worker env.
 *
 * Returns '' rather than throwing when the reply is not a string: every caller
 * already has a non-LLM fallback for an unparseable answer, and an exception
 * here would convert a degraded result into a failed request.
 */
export function gatewayExtractor(env: Env, opts: GatewayExtractorOptions = {}): LlmComplete {
  return async (messages) => {
    const result = await ideProxy(env).complete({
      messages,
      temperature: 0,
      max_tokens: opts.maxTokens ?? 700,
      useCase: opts.useCase ?? 'structured_extraction',
    });
    if (result.response.status >= 400) throw new Error(`gateway ${result.response.status}`);
    const raw = (await result.response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: unknown } }> }
      | null;
    const content = raw?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  };
}
