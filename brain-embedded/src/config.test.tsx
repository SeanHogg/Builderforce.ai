import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import type { BrainStreamFn } from './brainRunStore';
import { BrainProvider, resolveBrainStream, useBrainConfig, type BrainConfig } from './config';

/**
 * The config's `stream` is the host's seam for WHERE turns run (builderforce.ai serves
 * tool-free turns on the browser's own model first). Every turn the hooks drive reads
 * the runtime's `stream`, so the provider must hand out the host's fn untouched — and
 * fall back to the shared streamer over the transport when there is none.
 */

const persistence = {} as BrainConfig['persistence'];

const runtimeFor = (config: BrainConfig) =>
  renderHook(() => useBrainConfig(), {
    wrapper: ({ children }: { children: React.ReactNode }) => <BrainProvider config={config}>{children}</BrainProvider>,
  }).result.current;

describe('BrainProvider stream seam', () => {
  it("runs every turn through the config's own stream when it has one", async () => {
    const stream = vi.fn<BrainStreamFn>(async () => ({ text: 'from-host', toolCalls: [], finishReason: 'stop' }));
    const runtime = runtimeFor({ transport: { baseUrl: 'https://gw.test', getToken: () => null }, persistence, stream });
    const result = await runtime.stream({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.text).toBe('from-host');
    expect(stream).toHaveBeenCalledWith({ messages: [{ role: 'user', content: 'hi' }] });
  });

  it('defaults to the shared streamer over the transport', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init: RequestInit) =>
      new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'from-gateway' } }] })}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    const config: BrainConfig = { transport: { baseUrl: 'https://gw.test', getToken: () => null, fetch: fetchImpl }, persistence };
    const result = await runtimeFor(config).stream({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.text).toBe('from-gateway');
    expect(fetchImpl).toHaveBeenCalledWith('https://gw.test/llm/v1/chat/completions', expect.anything());
    // The one resolution outside React agrees with the provider's.
    expect(resolveBrainStream({ transport: config.transport, stream: undefined })).toBeTypeOf('function');
    const host = vi.fn<BrainStreamFn>();
    expect(resolveBrainStream({ transport: config.transport, stream: host })).toBe(host);
  });
});
