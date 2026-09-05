import { describe, expect, it } from 'vitest';
import { buildOpenAICodexAuthorizeUrl } from './openaiCodexOAuth';

describe('OpenAI Codex OAuth', () => {
  it('builds the PKCE authorization URL', () => {
    const url = new URL(buildOpenAICodexAuthorizeUrl({ state: 'state-1', challenge: 'challenge-1' }));
    expect(url.origin).toBe('https://auth.openai.com');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true');
  });
});
