import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MambaModelProvider,
  ExternalLLMProvider,
  registerProvider,
  unregisterProvider,
  getProvider,
  listProviders,
  createExternalLLMProvider,
} from './model-provider';

// ---------------------------------------------------------------------------
// Mock sendAIMessage so ExternalLLMProvider tests don't hit the network
// ---------------------------------------------------------------------------

vi.mock('./api', () => ({
  sendAIMessage: vi.fn(),
}));

import { sendAIMessage } from './api';
const mockSendAIMessage = sendAIMessage as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// MambaModelProvider
// ---------------------------------------------------------------------------

describe('MambaModelProvider', () => {
  it('has correct identity properties', () => {
    const provider = new MambaModelProvider();
    expect(provider.id).toBe('mamba');
    expect(provider.name).toBe('Mamba (On-Device WebGPU)');
    expect(provider.isLocal).toBe(true);
  });

  it('is not ready before init()', () => {
    const provider = new MambaModelProvider();
    expect(provider.isReady()).toBe(false);
  });

  it('gracefully handles missing mambacode.js at init()', async () => {
    // In jsdom there is no navigator.gpu so mambacode.js will throw
    const provider = new MambaModelProvider();
    // Should not throw even if the dynamic import fails
    await expect(provider.init()).resolves.toBeUndefined();
    expect(provider.isReady()).toBe(false);
  });

  it('returns a fallback message when not ready', async () => {
    const provider = new MambaModelProvider();
    const result = await provider.generate('hello');
    expect(result).toContain('not ready');
  });

  it('stream() falls back gracefully when not ready', async () => {
    const tokens: string[] = [];
    const provider = new MambaModelProvider();
    const result = await provider.stream('hello', undefined, (t) => tokens.push(t));
    expect(result).toContain('not ready');
    // The fallback message is word-streamed so at least one token is emitted
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.join('').trim()).toContain('not ready');
  });

  it('train() throws when not ready', async () => {
    const provider = new MambaModelProvider();
    await expect(provider.train('some code')).rejects.toThrow('Provider not ready');
  });

  it('dispose() marks the provider as not ready', () => {
    const provider = new MambaModelProvider();
    // Simulate readiness by forcing the internal flag (white-box test)
    (provider as any)._ready = true;
    expect(provider.isReady()).toBe(true);
    provider.dispose();
    expect(provider.isReady()).toBe(false);
  });

  it('accepts custom config', () => {
    const provider = new MambaModelProvider({ dModel: 256, numLayers: 4, wsla: true });
    const cfg = (provider as any).config;
    expect(cfg.dModel).toBe(256);
    expect(cfg.numLayers).toBe(4);
    expect(cfg.wsla).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExternalLLMProvider
// ---------------------------------------------------------------------------

describe('ExternalLLMProvider', () => {
  beforeEach(() => {
    mockSendAIMessage.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct identity properties', () => {
    const provider = new ExternalLLMProvider({ projectId: 'proj-1', label: 'Workers AI' });
    expect(provider.id).toBe('external-llm');
    expect(provider.name).toBe('Workers AI');
    expect(provider.isLocal).toBe(false);
  });

  it('is always ready', () => {
    const provider = new ExternalLLMProvider({ projectId: 'proj-1' });
    expect(provider.isReady()).toBe(true);
  });

  it('generate() calls sendAIMessage and accumulates response', async () => {
    mockSendAIMessage.mockImplementation(
      async (_id: unknown, _msgs: unknown, onChunk: (c: string) => void) => {
        onChunk('Hello');
        onChunk(', world!');
      }
    );
    const provider = new ExternalLLMProvider({ projectId: 'proj-1' });
    const result = await provider.generate('say hello');
    expect(result).toBe('Hello, world!');
    expect(mockSendAIMessage).toHaveBeenCalledOnce();
  });

  it('generate() includes systemPrompt and memoryContext in messages', async () => {
    mockSendAIMessage.mockResolvedValue(undefined);
    const provider = new ExternalLLMProvider({ projectId: 'proj-1' });
    await provider.generate('prompt', {
      systemPrompt: 'Be concise.',
      memoryContext: '[step=3 signal=0.12]',
    });
    const [, messages] = mockSendAIMessage.mock.calls[0] as [
      unknown,
      Array<{ role: string; content: string }>,
    ];
    const sysMsg = messages.find((m) => m.role === 'system');
    expect(sysMsg?.content).toContain('Be concise.');
    expect(sysMsg?.content).toContain('[step=3 signal=0.12]');
  });

  it('stream() calls onToken for each chunk', async () => {
    mockSendAIMessage.mockImplementation(
      async (_id: unknown, _msgs: unknown, onChunk: (c: string) => void) => {
        onChunk('token1');
        onChunk('token2');
      }
    );
    const tokens: string[] = [];
    const provider = new ExternalLLMProvider({ projectId: 'proj-1' });
    const result = await provider.stream('go', undefined, (t) => tokens.push(t));
    expect(tokens).toEqual(['token1', 'token2']);
    expect(result).toBe('token1token2');
  });

  it('generate() uses context.messages when provided', async () => {
    mockSendAIMessage.mockResolvedValue(undefined);
    const provider = new ExternalLLMProvider({ projectId: 'proj-1' });
    await provider.generate('ignored', {
      messages: [
        { role: 'user', content: 'from context' },
      ],
    });
    const [, messages] = mockSendAIMessage.mock.calls[0] as [
      unknown,
      Array<{ role: string; content: string }>,
    ];
    const userMsgs = messages.filter((m) => m.role === 'user');
    expect(userMsgs[0].content).toBe('from context');
  });

  it('uses factory helper createExternalLLMProvider', () => {
    const provider = createExternalLLMProvider({ projectId: 42, label: 'Test' });
    expect(provider).toBeInstanceOf(ExternalLLMProvider);
    expect(provider.name).toBe('Test');
  });
});

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

describe('provider registry', () => {
  afterEach(() => {
    unregisterProvider('mamba');
    unregisterProvider('external-llm');
    unregisterProvider('test-provider');
  });

  it('registers and retrieves a provider by id', () => {
    const provider = new ExternalLLMProvider({ projectId: 'p', label: 'Test' });
    registerProvider(provider);
    expect(getProvider('external-llm')).toBe(provider);
  });

  it('listProviders() returns all registered providers', () => {
    const p1 = new ExternalLLMProvider({ projectId: 'p', label: 'External' });
    const p2 = new MambaModelProvider();
    registerProvider(p1);
    registerProvider(p2);
    const all = listProviders();
    expect(all).toContain(p1);
    expect(all).toContain(p2);
  });

  it('unregisterProvider() removes a provider', () => {
    const provider = new ExternalLLMProvider({ projectId: 'p', label: 'Temp' });
    registerProvider(provider);
    expect(getProvider('external-llm')).toBe(provider);
    unregisterProvider('external-llm');
    expect(getProvider('external-llm')).toBeUndefined();
  });

  it('getProvider() returns undefined for unknown ids', () => {
    expect(getProvider('does-not-exist')).toBeUndefined();
  });
});
