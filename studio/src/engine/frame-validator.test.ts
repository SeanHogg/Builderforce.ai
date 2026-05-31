import { describe, it, expect, vi } from 'vitest';
import { validateFrame } from './frame-validator';
import type { BuilderforceClient } from '@seanhogg/builderforce-sdk';

/**
 * The validator is an ADVISORY VLM gate. Its contract: derive `ok` from the
 * score vs threshold, normalise issue kinds, send the frame as an image_url
 * content block, and NEVER throw — a validator outage must not abort video
 * generation. These are the invariants the engine relies on.
 */

function mockClient(impl: (params: unknown) => Promise<unknown>): BuilderforceClient {
  return {
    chat: { completions: { create: impl } },
  } as unknown as BuilderforceClient;
}

const DATA_URL = 'data:image/jpeg;base64,AAAA';

describe('validateFrame (VLM frame validator)', () => {
  it('derives ok=true when score >= threshold', async () => {
    const client = mockClient(async () => ({
      choices: [{ message: { content: JSON.stringify({ score: 0.9, issues: [] }) } }],
    }));
    const v = await validateFrame(
      { apiKey: 'k', frameDataUrl: DATA_URL, shotDescription: 'a knight', passThreshold: 0.6 },
      client,
    );
    expect(v.ok).toBe(true);
    expect(v.score).toBe(0.9);
  });

  it('derives ok=false when score < threshold and surfaces issues', async () => {
    const client = mockClient(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 0.3,
              issues: [{ kind: 'character-drift', detail: 'hair colour changed' }],
            }),
          },
        },
      ],
    }));
    const v = await validateFrame(
      { apiKey: 'k', frameDataUrl: DATA_URL, shotDescription: 'a knight', passThreshold: 0.6 },
      client,
    );
    expect(v.ok).toBe(false);
    expect(v.issues[0].kind).toBe('character-drift');
  });

  it('sends the frame as an image_url content block', async () => {
    const create = vi.fn(async () => ({
      choices: [{ message: { content: JSON.stringify({ score: 1, issues: [] }) } }],
    }));
    await validateFrame(
      { apiKey: 'k', frameDataUrl: DATA_URL, shotDescription: 'x' },
      mockClient(create),
    );
    const params = create.mock.calls[0][0] as {
      messages: { role: string; content: unknown }[];
    };
    const userMsg = params.messages.find((m) => m.role === 'user')!;
    const parts = userMsg.content as { type: string; image_url?: { url: string } }[];
    const imgPart = parts.find((p) => p.type === 'image_url');
    expect(imgPart?.image_url?.url).toBe(DATA_URL);
  });

  it('normalises an unknown issue kind to "other"', async () => {
    const client = mockClient(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({ score: 0.2, issues: [{ kind: 'banana', detail: 'weird' }] }),
          },
        },
      ],
    }));
    const v = await validateFrame(
      { apiKey: 'k', frameDataUrl: DATA_URL, shotDescription: 'x' },
      client,
    );
    expect(v.issues[0].kind).toBe('other');
  });

  it('returns a permissive verdict (does NOT throw) when the gateway call fails', async () => {
    const client = mockClient(async () => {
      throw new Error('gateway down');
    });
    const v = await validateFrame(
      { apiKey: 'k', frameDataUrl: DATA_URL, shotDescription: 'x' },
      client,
    );
    expect(v.ok).toBe(true);
    expect(v.score).toBe(1);
  });

  it('returns a permissive verdict when the model emits non-JSON', async () => {
    const client = mockClient(async () => ({
      choices: [{ message: { content: 'I cannot do that.' } }],
    }));
    const v = await validateFrame(
      { apiKey: 'k', frameDataUrl: DATA_URL, shotDescription: 'x' },
      client,
    );
    expect(v.ok).toBe(true);
  });
});
