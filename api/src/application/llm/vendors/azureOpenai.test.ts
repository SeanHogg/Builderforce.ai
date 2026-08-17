import { afterEach, describe, expect, it, vi } from 'vitest';
import { azureOpenAiModule } from './azureOpenai';
import { VendorFatalError, type VendorEnv } from './types';
import { dispatchVendor, parseVendorPrefix, vendorForModel } from './registry';

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

const ENDPOINT = 'https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-08-01-preview';

describe('azureOpenAiModule.apiKeyFrom', () => {
  it('composes a <key>::<endpoint> sentinel when both are bound', () => {
    const env = { AZURE_OPENAI_API_KEY: 'azkey', AZURE_OPENAI_ENDPOINT: ENDPOINT } as VendorEnv;
    expect(azureOpenAiModule.apiKeyFrom(env)).toBe(`azkey::${ENDPOINT}`);
  });

  it('is null when either half is missing', () => {
    expect(azureOpenAiModule.apiKeyFrom({ AZURE_OPENAI_API_KEY: 'azkey' } as VendorEnv)).toBeNull();
    expect(azureOpenAiModule.apiKeyFrom({ AZURE_OPENAI_ENDPOINT: ENDPOINT } as VendorEnv)).toBeNull();
    expect(azureOpenAiModule.apiKeyFrom({} as VendorEnv)).toBeNull();
  });
});

describe('direct/azure-openai/ prefix routing', () => {
  it('routes to the azure-openai vendor', () => {
    expect(parseVendorPrefix('direct/azure-openai/default')).toEqual({ vendor: 'azure-openai', modelId: 'default' });
    expect(vendorForModel('direct/azure-openai/default')).toBe('azure-openai');
  });
});

describe('azureOpenAiModule.call', () => {
  it('POSTs to the operator-configured endpoint with an api-key header, not Bearer', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init: init ?? {} });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const result = await dispatchVendor({
      env: { AZURE_OPENAI_API_KEY: 'azkey', AZURE_OPENAI_ENDPOINT: ENDPOINT } as VendorEnv,
      modelChain: ['direct/azure-openai/default'],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.vendorUsed).toBe('azure-openai');
    expect(result.content).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(ENDPOINT);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('azkey');
  });

  it('throws a fatal error on a malformed sentinel rather than mis-parsing it', async () => {
    await expect(azureOpenAiModule.call({
      apiKey: 'no-delimiter-here', model: 'default', messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toBeInstanceOf(VendorFatalError);
  });
});
