import { describe, expect, it } from 'vitest';
import {
  generatePkce,
  generateState,
  buildAuthorizeUrl,
  parsePastedCode,
  withClaudeCodeSystemPrompt,
  CLAUDE_CODE_SYSTEM_PROMPT,
} from './anthropicOAuth';

describe('generatePkce', () => {
  it('produces a url-safe verifier + matching S256 challenge', async () => {
    const { verifier, challenge } = await generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier).not.toContain('=');
    expect(challenge).not.toContain('=');
    // Distinct verifiers each call (random).
    const again = await generatePkce();
    expect(again.verifier).not.toBe(verifier);
  });
});

describe('generateState', () => {
  it('is random and url-safe', () => {
    expect(generateState()).not.toBe(generateState());
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('buildAuthorizeUrl', () => {
  it('targets Claude.ai with PKCE + the Claude Code client and manual-code redirect', () => {
    const url = new URL(buildAuthorizeUrl({ state: 'st8', challenge: 'chal' }));
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize');
    expect(url.searchParams.get('code')).toBe('true');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st8');
    expect(url.searchParams.get('redirect_uri')).toBe('https://console.anthropic.com/oauth/code/callback');
    expect(url.searchParams.get('scope')).toContain('user:inference');
    // The public Claude Code client id (uuid) — not a secret, but pinned.
    expect(url.searchParams.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
  });
});

describe('parsePastedCode', () => {
  it('splits the code#state form the consent page renders', () => {
    expect(parsePastedCode('  abc123#xyz789 ')).toEqual({ code: 'abc123', state: 'xyz789' });
  });
  it('returns a null state when only a bare code is pasted', () => {
    expect(parsePastedCode('justacode')).toEqual({ code: 'justacode', state: null });
  });
});

describe('withClaudeCodeSystemPrompt', () => {
  it('prepends the Claude Code identity block when system is absent', () => {
    const out = withClaudeCodeSystemPrompt({ messages: [] });
    expect(Array.isArray(out.system)).toBe(true);
    expect((out.system as Array<{ text: string }>)[0]!.text).toBe(CLAUDE_CODE_SYSTEM_PROMPT);
  });

  it('normalises a string system into an array with the identity first', () => {
    const out = withClaudeCodeSystemPrompt({ system: 'Be terse.' });
    const blocks = out.system as Array<{ type: string; text: string }>;
    expect(blocks[0]!.text).toBe(CLAUDE_CODE_SYSTEM_PROMPT);
    expect(blocks[1]!.text).toBe('Be terse.');
  });

  it('does not double-inject when the identity is already first (string)', () => {
    const original = `${CLAUDE_CODE_SYSTEM_PROMPT}\nExtra.`;
    const out = withClaudeCodeSystemPrompt({ system: original });
    expect(out.system).toBe(original);
  });

  it('does not double-inject when the identity is already the first block (array)', () => {
    const system = [{ type: 'text', text: CLAUDE_CODE_SYSTEM_PROMPT }, { type: 'text', text: 'more' }];
    const out = withClaudeCodeSystemPrompt({ system });
    expect(out.system).toBe(system);
  });
});
