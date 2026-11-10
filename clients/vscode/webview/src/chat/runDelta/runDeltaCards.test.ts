import { describe, expect, it } from 'vitest';
import { cardKey, cardsFromAnswer, codePathOf, mergeCards, placeCards, type RunDeltaCardPayload } from './runDeltaCards';

const card = (runId: string, repo = '/repo', headline: 'worse' | 'same' = 'same'): RunDeltaCardPayload =>
  ({ chatId: 7, runId, repo, root: repo, delta: { runId, headline, dimensions: [] } }) as unknown as RunDeltaCardPayload;

describe('run delta cards of a chat', () => {
  it('replaces a re-posted card and keeps one card per run and repository', () => {
    const merged = mergeCards([card('a'), card('b')], [card('a', '/repo', 'worse'), card('a', '/other')]);
    expect(merged.map(cardKey)).toEqual([cardKey(card('a')), cardKey(card('b')), cardKey(card('a', '/other'))]);
    expect(merged[0]!.delta.headline).toBe('worse');
  });

  it('keeps only well-formed rows from a run-delta/get answer', () => {
    expect(cardsFromAnswer(null)).toEqual([]);
    expect(cardsFromAnswer({ error: 'x' })).toEqual([]);
    expect(cardsFromAnswer([card('a'), { runId: 'b' }, 3])).toEqual([card('a')]);
  });

  it('places a card after its remembered reply, else after the last reply', () => {
    const anchors: Record<string, number> = { a: 10, gone: 99 };
    const placed = placeCards([card('a'), card('b'), card('gone')], [10, 20, 30], (runId) => anchors[runId]);
    expect(placed.get(10)!.map((c) => c.runId)).toEqual(['a']);
    expect(placed.get(30)!.map((c) => c.runId)).toEqual(['b', 'gone']);
    expect(placeCards([card('a')], [], () => undefined).size).toBe(0);
  });

  it('opens code at root + path whenever the host names a root, even when the repo identity is a remote URL', () => {
    const remote = { repo: 'git@github.com:org/repo.git', root: 'C:\\work\\repo\\' };
    expect(codePathOf(remote, 'api/routes.ts')).toBe('C:\\work\\repo/api/routes.ts');
    expect(codePathOf({ repo: '/home/me/repo', root: '/home/me/repo' }, 'a.ts')).toBe('/home/me/repo/a.ts');
    // An older host sent no root: a local repo identity still opens, a remote one cannot.
    expect(codePathOf({ repo: '/home/me/repo' } as { repo: string; root: string }, 'a.ts')).toBe('/home/me/repo/a.ts');
    expect(codePathOf({ repo: 'https://x/y.git' } as { repo: string; root: string }, 'a.ts')).toBeUndefined();
  });
});
