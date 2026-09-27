import { describe, expect, it } from 'vitest';
import { scopeChangesToChat } from './chatChangeScope';

const changes = [
  { id: 'C:\\repo\\src\\a.ts', path: 'src/a.ts' },
  { id: 'C:\\repo\\src\\data.ts', path: 'src/data.ts' },
  { id: '/home/me/other/README.md', path: 'README.md' },
];

describe('scopeChangesToChat', () => {
  it('keeps every change when the chat files are unknown or empty', () => {
    expect(scopeChangesToChat(changes, null)).toEqual(changes);
    expect(scopeChangesToChat(changes, [])).toEqual(changes);
  });

  it('matches a recorded repo-relative path exactly', () => {
    expect(scopeChangesToChat(changes, ['src/a.ts']).map((c) => c.path)).toEqual(['src/a.ts']);
  });

  it('never matches on a bare suffix', () => {
    expect(scopeChangesToChat(changes, ['a.ts'])).toEqual([]);
  });

  it('matches absolute paths across separators and case', () => {
    expect(scopeChangesToChat(changes, ['c:/REPO/src/data.ts']).map((c) => c.path)).toEqual(['src/data.ts']);
    expect(scopeChangesToChat(changes, ['other/README.md']).map((c) => c.path)).toEqual(['README.md']);
  });
});
