import { describe, it, expect } from 'vitest';
import { reorderPoolByShape, type ChatCompletionRequest } from './LlmProxyService';

const visionBody = {
  messages: [
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }] },
  ],
} as unknown as ChatCompletionRequest;

const plainBody = { messages: [{ role: 'user', content: 'hi' }] } as unknown as ChatCompletionRequest;

describe('reorderPoolByShape capability-aware routing [1429]', () => {
  it('promotes a NON-OpenRouter vision model (catalog capabilities) for a vision request', () => {
    // meta/llama-3.2-11b-vision-instruct is an NVIDIA NIM model whose catalog entry
    // declares capabilities:['vision'] — vision comes from the catalog, never a hand
    // list, so it must outrank a plain model. (The old phi-4 id was never routable.)
    const pool = ['plain/text-only-model', 'meta/llama-3.2-11b-vision-instruct'];
    const out = reorderPoolByShape(visionBody, pool);
    expect(out[0]).toBe('meta/llama-3.2-11b-vision-instruct');
  });

  it('promotes a direct Gemini model (googleai catalog vision capability) for a vision request', () => {
    // Regression: gemini-2.5-flash is natively multimodal but its googleai
    // catalog entry declared NO capabilities, so an image request treated it as
    // non-vision and demoted it below the small declared vision models — which
    // returned an empty turn → the user's "No response" on a pasted image. The
    // catalog now declares vision, so it must float to the head here.
    const pool = ['plain/text-only-model', 'gemini-2.5-flash'];
    const out = reorderPoolByShape(visionBody, pool);
    expect(out[0]).toBe('gemini-2.5-flash');
  });

  it('leaves the pool untouched when the request has no special shape', () => {
    const pool = ['a', 'b', 'c'];
    expect(reorderPoolByShape(plainBody, pool)).toEqual(pool);
  });
});
