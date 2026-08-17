import { afterEach, describe, expect, it, vi } from 'vitest';
import { amazonBedrockModule } from './amazonBedrock';
import { VendorFatalError, VendorRetryableError, type VendorEnv } from './types';
import { dispatchVendor, parseVendorPrefix, vendorForModel } from './registry';

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

const MODEL = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

describe('amazonBedrockModule.apiKeyFrom', () => {
  it('composes a <accessKeyId>::<secretAccessKey>::<region> sentinel when all three are bound', () => {
    const env = {
      AWS_BEDROCK_ACCESS_KEY_ID: 'AKID', AWS_BEDROCK_SECRET_ACCESS_KEY: 'secret', AWS_BEDROCK_REGION: 'us-east-1',
    } as VendorEnv;
    expect(amazonBedrockModule.apiKeyFrom(env)).toBe('AKID::secret::us-east-1');
  });

  it('is null when any of the three is missing', () => {
    expect(amazonBedrockModule.apiKeyFrom({ AWS_BEDROCK_ACCESS_KEY_ID: 'AKID' } as VendorEnv)).toBeNull();
    expect(amazonBedrockModule.apiKeyFrom({} as VendorEnv)).toBeNull();
  });
});

describe('direct/amazon-bedrock/ prefix routing', () => {
  it('routes to the amazon-bedrock vendor, preserving the model id including its colons', () => {
    expect(parseVendorPrefix(`direct/amazon-bedrock/${MODEL}`)).toEqual({ vendor: 'amazon-bedrock', modelId: MODEL });
    expect(vendorForModel(`direct/amazon-bedrock/${MODEL}`)).toBe('amazon-bedrock');
  });
});

describe('amazonBedrockModule.call', () => {
  it('POSTs a Converse-shaped body to the model/converse path with a SigV4 Authorization header', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init: init ?? {} });
      return new Response(JSON.stringify({
        output: { message: { content: [{ text: 'hello from bedrock' }] } },
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const result = await dispatchVendor({
      env: { AWS_BEDROCK_ACCESS_KEY_ID: 'AKID', AWS_BEDROCK_SECRET_ACCESS_KEY: 'secret', AWS_BEDROCK_REGION: 'us-east-1' } as VendorEnv,
      modelChain: [`direct/amazon-bedrock/${MODEL}`],
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
    });

    expect(result.vendorUsed).toBe('amazon-bedrock');
    expect(result.content).toBe('hello from bedrock');
    expect(result.usage).toEqual({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });

    expect(calls).toHaveLength(1);
    // The actual HTTP request uses the RAW model id (`:` is a legal path
    // character per RFC 3986); only the SigV4 signature computation uses the
    // percent-encoded canonical form — see `awsSigV4.ts`'s `canonicalUri`.
    expect(calls[0]!.url).toBe(`https://bedrock-runtime.us-east-1.amazonaws.com/model/${MODEL}/converse`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//);

    const sentBody = JSON.parse(calls[0]!.init.body as string) as { system?: unknown; messages: unknown[] };
    expect(sentBody.system).toEqual([{ text: 'be terse' }]);
    expect(sentBody.messages).toEqual([{ role: 'user', content: [{ text: 'hi' }] }]);
  });

  it('classifies a 5xx as retryable and a 4xx as fatal', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      new Response('service unavailable', { status: 503 })) as unknown as typeof fetch;
    await expect(amazonBedrockModule.call({
      apiKey: 'AKID::secret::us-east-1', model: MODEL, messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toBeInstanceOf(VendorRetryableError);

    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      new Response('bad request', { status: 400 })) as unknown as typeof fetch;
    await expect(amazonBedrockModule.call({
      apiKey: 'AKID::secret::us-east-1', model: MODEL, messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toBeInstanceOf(VendorFatalError);
  });

  it('throws a fatal error on a malformed sentinel rather than mis-parsing it', async () => {
    await expect(amazonBedrockModule.call({
      apiKey: 'only-one-part', model: MODEL, messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toBeInstanceOf(VendorFatalError);
  });
});
