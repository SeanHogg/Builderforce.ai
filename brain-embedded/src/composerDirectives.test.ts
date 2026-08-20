import { describe, expect, it } from 'vitest';
import { buildComposerDirectives, WEB_FETCH_TOOL_NAME } from './composerDirectives';
import { effortProfile } from './effort';

/**
 * These pin the three drifts that existed while this logic was copied per surface, so a
 * future copy-paste is caught rather than discovered in a transcript.
 */
describe('buildComposerDirectives', () => {
  it('adds nothing at the neutral default — a default turn must be byte-identical', () => {
    expect(buildComposerDirectives({})).toBe('');
    expect(buildComposerDirectives({ effort: 'balanced' })).toBe('');
    expect(buildComposerDirectives({ effort: 'balanced', web: false })).toBe('');
  });

  it('DERIVES the effort prose from the same table that sets max_tokens', () => {
    // Hardcoding it (as the web copy did) lets the sentence contradict the params.
    for (const effort of ['quick', 'thorough'] as const) {
      expect(buildComposerDirectives({ effort })).toBe(effortProfile(effort).directive);
    }
  });

  it('names the web-fetch tool by its ADVERTISED name', () => {
    const out = buildComposerDirectives({ web: true });
    expect(out).toContain(`\`${WEB_FETCH_TOOL_NAME}\``);
    // Both former copies named a tool the model is never given. A prompt that references
    // a tool the model cannot see gets the call NARRATED instead of made, with no error.
    expect(out).not.toContain('fetch_url');
    expect(out).not.toContain('`web.fetch`');
  });

  it('advertises the builtin_ prefixed form the gateway actually publishes', () => {
    expect(WEB_FETCH_TOOL_NAME).toBe('builtin_web_fetch');
  });

  it('emits no prose for Thinking — that is a structured reasoning.level, not a sentence', () => {
    const withEverything = buildComposerDirectives({ effort: 'thorough', web: true });
    expect(withEverything.toLowerCase()).not.toContain('step by step');
  });

  it('separates multiple directives with a blank line', () => {
    const out = buildComposerDirectives({ effort: 'quick', web: true });
    expect(out.split('\n\n')).toHaveLength(2);
    expect(out.startsWith(effortProfile('quick').directive)).toBe(true);
  });

  it('falls back to the neutral profile for an unknown effort rather than throwing', () => {
    expect(buildComposerDirectives({ effort: 'turbo' as never })).toBe('');
  });
});
