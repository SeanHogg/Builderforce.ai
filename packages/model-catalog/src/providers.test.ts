import { describe, expect, it } from 'vitest';
import {
  LLM_PROVIDERS,
  LLM_PROVIDER_INFO,
  isLlmProvider,
  llmProviderInfo,
  supportsSubscription,
  isSubscriptionSignInUrl,
} from './index.js';

describe('LLM provider vocabulary', () => {
  it('lists every provider exactly once', () => {
    expect(new Set(LLM_PROVIDERS).size).toBe(LLM_PROVIDERS.length);
    expect(LLM_PROVIDERS).toEqual(LLM_PROVIDER_INFO.map((p) => p.id));
  });

  it('includes the self-hosted runtimes as local_runtime entries', () => {
    expect(llmProviderInfo('ollama-local').credential).toBe('local_runtime');
    expect(llmProviderInfo('freetoken').credential).toBe('local_runtime');
    expect(llmProviderInfo('ollama').credential).toBe('api_key');
  });

  it('gives every key provider a placeholder and every local runtime none', () => {
    for (const p of LLM_PROVIDER_INFO) {
      expect(p.label.trim()).not.toBe('');
      if (p.credential === 'api_key') {
        expect(p.keyPlaceholder).not.toBe('');
        expect(p.localRuntime).toBeUndefined();
      } else {
        expect(p.keyPlaceholder).toBe('');
        expect(p.subscription).toBeNull();
        expect(p.localRuntime?.defaultBaseUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it('marks the subscription connects and how they finish', () => {
    expect(LLM_PROVIDERS.filter(supportsSubscription)).toEqual(['anthropic', 'openai', 'kimi', 'xai']);
    expect(llmProviderInfo('kimi').subscription).toBe('device');
    expect(llmProviderInfo('anthropic').subscription).toBe('paste');
  });

  it('recognises provider ids and nothing else', () => {
    expect(isLlmProvider('freetoken')).toBe(true);
    expect(isLlmProvider('openrouter')).toBe(false);
    expect(isLlmProvider(undefined)).toBe(false);
  });
});

describe('isSubscriptionSignInUrl', () => {
  it('accepts each subscription provider sign-in page, on its own domain or a subdomain', () => {
    for (const url of [
      'https://claude.ai/oauth/authorize?code=true',
      'https://console.anthropic.com/oauth/authorize',
      'https://auth.openai.com/oauth/authorize?client_id=x',
      'https://auth.x.ai/oauth/authorize?state=s',
      'https://auth.kimi.com/device?user_code=AB-CD',
    ]) expect(isSubscriptionSignInUrl(url), url).toBe(true);
  });

  it('refuses anything else — another host, a lookalike, a non-https scheme, garbage', () => {
    for (const url of [
      'https://evil.example/oauth/authorize',
      'https://x.ai.evil.example/',
      'https://notclaude.ai/',
      'http://auth.x.ai/oauth/authorize',
      'command:workbench.action.terminal.new',
      'not a url',
      '',
    ]) expect(isSubscriptionSignInUrl(url), url).toBe(false);
  });
});
