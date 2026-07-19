/**
 * LLM bridge — calls the Builderforce LLM gateway to expand a short user
 * prompt into a detailed diffusion-friendly description.
 *
 * This replaces the role the user's spec attributed to "WebLLM (Text Model)".
 * No bundled local LLM — the gateway already runs at api.builderforce.ai/api/ai/chat
 * with the full vendor failover cascade, so we get free model selection,
 * cooldown handling, and budget tracking without shipping a second runtime.
 *
 * Uses the existing @seanhogg/builderforce-sdk as a peerDep so the studio
 * doesn't reimplement auth / retry / failover semantics.
 */

import { BuilderforceClient } from '@seanhogg/builderforce-sdk';

export interface ExpandPromptOptions {
  apiKey: string;
  baseUrl?: string;
  prompt: string;
  /** Gateway model id for prompt expansion. Defaults to googleai/gemini-2.5-flash-lite. */
  promptModel?: string;
  signal?: AbortSignal;
}

const SYSTEM_PROMPT =
  'You are a visual prompt engineer for a text-to-video diffusion model. ' +
  'Rewrite the user prompt into a single detailed paragraph optimized for a Stable Diffusion-class image model. ' +
  'Include: subject, action, environment, lighting, colour palette, camera angle, and a visual style descriptor (e.g. cinematic, anime, photoreal). ' +
  'Do not use newlines. Do not preface with "Here is" or any meta-commentary — output only the rewritten prompt. ' +
  'Keep it under 220 characters.';

export async function expandPrompt(opts: ExpandPromptOptions): Promise<string> {
  const client = new BuilderforceClient({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });

  // Prompt expansion is an ENHANCEMENT, not a prerequisite: diffusion is local and
  // the raw prompt renders fine. A gateway outage (vendor cascade exhausted, 5xx,
  // offline) must NOT abort a render that needs no network — degrade to the raw
  // prompt instead. An abort is re-thrown: user cancellation is not a degraded run.
  let completion: Awaited<ReturnType<typeof client.chat.completions.create>>;
  try {
    completion = await client.chat.completions.create({
      // Explicit lightweight model — the gateway still failovers across the
      // cascade if this is cooled, but we avoid relying on undocumented
      // "unknown id → substitute" behaviour that a future strict-pin mode
      // would break. Override via `promptModel` if a different model is wanted.
      model: opts.promptModel ?? 'googleai/gemini-2.5-flash-lite',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: opts.prompt },
      ],
      max_tokens: 200,
      temperature: 0.7,
      // Was accepted but never forwarded — a cancelled generation left this call
      // running and its result was silently discarded.
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted || (err as { name?: string })?.name === 'AbortError') throw err;
    return opts.prompt;
  }

  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) {
    // Fallback to raw prompt if the LLM returns nothing usable — diffusion still runs.
    return opts.prompt;
  }
  return text;
}
