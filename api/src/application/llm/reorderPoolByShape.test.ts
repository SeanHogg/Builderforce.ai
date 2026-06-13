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
    // microsoft/phi-4-multimodal-instruct is an NVIDIA NIM model whose catalog
    // entry declares capabilities:['vision'] — it must outrank a plain model
    // even though it isn't in the OpenRouter-centric VISION_MODELS id-set.
    const pool = ['plain/text-only-model', 'microsoft/phi-4-multimodal-instruct'];
    const out = reorderPoolByShape(visionBody, pool);
    expect(out[0]).toBe('microsoft/phi-4-multimodal-instruct');
  });

  it('leaves the pool untouched when the request has no special shape', () => {
    const pool = ['a', 'b', 'c'];
    expect(reorderPoolByShape(plainBody, pool)).toEqual(pool);
  });
});
