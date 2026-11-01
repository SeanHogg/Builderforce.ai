import { describe, expect, it, vi } from 'vitest';
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';
import { filterChatHistory } from './useChatHistoryView';

// The bridge reaches for `acquireVsCodeApi` at load; these tests never post.
vi.mock('../vscodeBridge', () => ({ post: vi.fn() }));

const chat = (id: number, title: string): BrainChat => ({ id, title }) as BrainChat;

const live = [chat(1, 'Fix login redirect'), chat(2, 'Add dark mode'), chat(3, 'Login redirect loop')];
const archived = [chat(4, 'Old login investigation'), chat(5, 'Archived billing bug')];

describe('filterChatHistory', () => {
  it('returns the live collection by default, unfiltered', () => {
    expect(filterChatHistory(live, archived, false, '')).toEqual(live);
  });

  it('returns the archived collection when showArchived is set', () => {
    expect(filterChatHistory(live, archived, true, '')).toEqual(archived);
  });

  it('narrows the live collection by a case-insensitive title query', () => {
    const out = filterChatHistory(live, archived, false, 'LOGIN');
    expect(out.map((c) => c.id)).toEqual([1, 3]);
  });

  it('narrows the archived collection by the same query', () => {
    const out = filterChatHistory(live, archived, true, 'login');
    expect(out.map((c) => c.id)).toEqual([4]);
  });

  it('returns everything when the query is blank after trimming', () => {
    expect(filterChatHistory(live, archived, false, '   ')).toEqual(live);
  });

  it('returns an empty list when nothing matches, not the unfiltered base', () => {
    expect(filterChatHistory(live, archived, false, 'zzz-no-such-title')).toEqual([]);
  });
});
