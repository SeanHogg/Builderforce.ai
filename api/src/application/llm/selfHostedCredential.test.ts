import { describe, expect, it } from 'vitest';
import { composeSelfHostedCredential, isLocalRuntimeProvider } from './selfHostedCredential';
import { splitSelfHostedSentinel } from './vendors/selfHostedSentinel';

describe('self-hosted credential writer', () => {
  it('treats exactly the shared local_runtime providers as self-hosted', () => {
    expect(isLocalRuntimeProvider('ollama-local')).toBe(true);
    expect(isLocalRuntimeProvider('freetoken')).toBe(true);
    expect(isLocalRuntimeProvider('ollama')).toBe(false);
    expect(isLocalRuntimeProvider('anthropic')).toBe(false);
  });

  it('composes what the vendor splits back apart', () => {
    const result = composeSelfHostedCredential({ baseUrl: ' http://127.0.0.1:1919 ', model: 'qwen3:8b', apiKey: 'tok' });
    expect(result).toEqual({ ok: true, value: 'tok::http://127.0.0.1:1919::qwen3:8b' });
    if (!result.ok) return;
    expect(splitSelfHostedSentinel('freetoken', result.value)).toEqual({
      apiKey: 'tok', baseUrl: 'http://127.0.0.1:1919', model: 'qwen3:8b',
    });
  });

  it('leaves apiKey empty when omitted', () => {
    expect(composeSelfHostedCredential({ baseUrl: 'http://h:11434', model: 'm' })).toEqual({ ok: true, value: '::http://h:11434::m' });
  });

  it.each([
    [{ model: 'm' }, 'baseUrl is required'],
    [{ baseUrl: 'http://h' }, 'model is required'],
    [{ baseUrl: 'nope', model: 'm' }, 'baseUrl must be a valid URL'],
    [{ baseUrl: 'ftp://h', model: 'm' }, 'baseUrl must be http or https'],
    [{ baseUrl: 'http://h', model: 'a::b' }, 'baseUrl, model, and apiKey may not contain "::"'],
  ])('refuses %o', (input, error) => {
    expect(composeSelfHostedCredential(input)).toEqual({ ok: false, error });
  });
});
