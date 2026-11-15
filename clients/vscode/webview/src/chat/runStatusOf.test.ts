import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runStatusOf, hasPendingAskUser } from './useVsCodeChats';

// Importing the module pulls the VS Code bridge (`useVsCodeChats` posts through it) and
// the host persistence (`createHostPersistence` → `bridgeTransport`), which grabs
// `acquireVsCodeApi()` at module load. Stub the transport so it never runs, exactly like
// attachmentUpload.test.ts does; these tests never post.
vi.mock('../bridgeTransport', () => ({ request: vi.fn(() => Promise.resolve(undefined)), post: vi.fn() }));
vi.mock('../vscodeBridge', () => ({ post: vi.fn() }));

// The precedence a history row's marker relies on: a chat paused on a question/
// answer ('awaiting' -> the amber '?' marker) wins over one that is merely running
// (the accent-colored dot), and a chat in neither set shows no marker at all (null).
describe('runStatusOf', () => {
  it('is awaiting when the chat is in the awaiting set only', () => {
    expect(runStatusOf(new Set([7]), new Set(), 7)).toBe('awaiting');
  });

  it('is awaiting when the chat is in both sets (awaiting wins over running)', () => {
    expect(runStatusOf(new Set([7]), new Set([7]), 7)).toBe('awaiting');
  });

  it('is running when the chat is in the running set only', () => {
    expect(runStatusOf(new Set(), new Set([7]), 7)).toBe('running');
  });

  it('is null when the chat is in neither set (no marker)', () => {
    expect(runStatusOf(new Set([1]), new Set([2]), 7)).toBe(null);
  });
});

// The durable half of the marker: a chat whose PERSISTED transcript tail ends on an
// unanswered `ask_user` is 'awaiting' even when the live run-state sets are empty (after
// a reload/reopen). This pins the predicate the history list now consults alongside the
// live sets, so a chat paused on a question keeps its '?' — the exact case the live-only
// marker dropped.
describe('hasPendingAskUser', () => {
  const askBlock = (question: string) =>
    ['```ask-user', JSON.stringify({
      question,
      options: [{ label: 'Yes' }, { label: 'No' }],
    }), '```'].join('\n');

  it('is true when the newest assistant turn carries an unanswered ask-user block', () => {
    expect(
      hasPendingAskUser([
        { id: 1, role: 'user', content: 'build it' },
        { id: 2, role: 'assistant', content: `Before I continue:\n${askBlock('Which target?')}` },
      ]),
    ).toBe(true);
  });

  it('is false when a user turn after the ask-user means it was already answered', () => {
    expect(
      hasPendingAskUser([
        { id: 1, role: 'user', content: 'build it' },
        { id: 2, role: 'assistant', content: askBlock('Which target?') },
        { id: 3, role: 'user', content: 'Yes' },
      ]),
    ).toBe(false);
  });

  it('is false when the tail has no ask-user block at all', () => {
    expect(
      hasPendingAskUser([
        { id: 1, role: 'user', content: 'hi' },
        { id: 2, role: 'assistant', content: 'Done — anything else?' },
      ]),
    ).toBe(false);
  });

  it('skips non-string content when mapping to the predicate', () => {
    expect(
      hasPendingAskUser([
        { id: 1, role: 'user', content: 'build it' },
        { id: 2, role: 'assistant', content: { not: 'a string' } as unknown as string },
        { id: 3, role: 'assistant', content: askBlock('Proceed?') },
      ]),
    ).toBe(true);
  });
});

// The marker's two halves are a '?' glyph for awaiting and a dot for running, and each
// status gets its OWN color token. This pins the color half of the requirement (the
// orb/dot color changes) so a CSS refactor cannot silently collapse both onto one token.
describe('run-marker color classes', () => {
  const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

  it('gives the awaiting marker its own warning color', () => {
    expect(css).toMatch(/\.bf-run-marker--awaiting\s*\{[^}]*var\(--bf-warning\)/);
  });

  it('gives the running marker the accent color', () => {
    expect(css).toMatch(/\.bf-run-marker--running\s*\{[^}]*var\(--bf-accent\)/);
  });

  it('does not style the two statuses with the same token', () => {
    const awaiting = css.match(/\.bf-run-marker--awaiting\s*\{([^}]*)\}/)?.[1] ?? '';
    const running = css.match(/\.bf-run-marker--running\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(awaiting).toContain('--bf-warning');
    expect(running).toContain('--bf-accent');
    expect(awaiting).not.toContain('--bf-accent');
    expect(running).not.toContain('--bf-warning');
  });
});
