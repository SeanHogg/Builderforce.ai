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

  const completion = await client.chat.completions.create({
    model: 'auto',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: opts.prompt },
    ],
    max_tokens: 200,
    temperature: 0.7,
  });

  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) {
    // Fallback to raw prompt if the LLM returns nothing usable — diffusion still runs.
    return opts.prompt;
  }
  return text;
}
