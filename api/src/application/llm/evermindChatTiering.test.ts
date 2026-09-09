import { describe, expect, it } from 'vitest';
import { tierRecallByChat } from './evermindChatTiering';

/** A ranked candidate: `id` doubles as its rank position in these fixtures. */
const m = (id: number, chatId?: number) => (chatId == null ? { id } : { id, chatId });

describe('tierRecallByChat', () => {
  it('puts the chat\'s OWN memories first even when they ranked lower', () => {
    // Ranker order: project, project, chat. The chat's memory must still lead.
    const ranked = [m(1, 99), m(2), m(3, 7)];
    const out = tierRecallByChat(ranked, 7, 10);
    expect(out.items.map((i) => i.id)).toEqual([3, 1, 2]);
    expect(out).toMatchObject({ fromChat: 1, fromProject: 2 });
  });

  it('preserves the ranker\'s order WITHIN each tier', () => {
    const ranked = [m(1, 7), m(2, 99), m(3, 7), m(4)];
    expect(tierRecallByChat(ranked, 7, 10).items.map((i) => i.id)).toEqual([1, 3, 2, 4]);
  });

  it('treats a memory with NO chatId as project-wide, never as excluded', () => {
    // Everything learned before contributions carried provenance looks like this.
    const ranked = [m(1), m(2)];
    const out = tierRecallByChat(ranked, 7, 10);
    expect(out.items.map((i) => i.id)).toEqual([1, 2]);
    expect(out).toMatchObject({ fromChat: 0, fromProject: 2 });
  });

  it('answers a BRAND-NEW chat entirely from the project rather than emptily', () => {
    // The reason this tiers instead of filtering: a chat with no memories of its own
    // must still get the project's institutional knowledge.
    const ranked = [m(1), m(2, 42), m(3)];
    const out = tierRecallByChat(ranked, 7, 3);
    expect(out.items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(out.fromChat).toBe(0);
  });

  it('lets a chat with plenty of history crowd the project out of the budget', () => {
    const ranked = [m(1, 7), m(2, 7), m(3, 7), m(4), m(5, 99)];
    const out = tierRecallByChat(ranked, 7, 3);
    expect(out.items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(out).toMatchObject({ fromChat: 3, fromProject: 0 });
  });

  it('behaves exactly like plain rank order when there is no chat to pin to', () => {
    const ranked = [m(1, 7), m(2), m(3, 99)];
    for (const noChat of [null, undefined]) {
      const out = tierRecallByChat(ranked, noChat, 10);
      expect(out.items.map((i) => i.id)).toEqual([1, 2, 3]);
      expect(out.fromChat).toBe(0);
    }
  });

  it('caps at the limit and reports counts from what was RETURNED', () => {
    const ranked = [m(1, 7), m(2), m(3)];
    expect(tierRecallByChat(ranked, 7, 2)).toMatchObject({ fromChat: 1, fromProject: 1 });
    expect(tierRecallByChat(ranked, 7, 0).items).toEqual([]);
    expect(tierRecallByChat([], 7, 5)).toMatchObject({ items: [], fromChat: 0, fromProject: 0 });
  });
});
