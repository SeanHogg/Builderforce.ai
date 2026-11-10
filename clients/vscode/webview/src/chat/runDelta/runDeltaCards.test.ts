import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RUN_DELTA_LABELS } from '@builderforce/knowledge-graph-view/delta';
import { RUN_DELTA_RELEASE, cardKey, cardsFromAnswer, mergeCards, placeCards, safeRepoPath, type RunDeltaCardPayload } from './runDeltaCards';
import { releaseRun } from './useRunDeltaRelease';

// Hoisted: the release hook's module imports the confirm provider and the bridge, neither of which a unit test needs.
vi.mock('@/components/confirmContext', () => ({ useConfirm: () => async () => true }));
vi.mock('../../vscodeBridge', () => ({ request: vi.fn(), onHostMessage: vi.fn() }));

const card = (runId: string, repo = '/repo', headline: 'worse' | 'same' = 'same', at?: number): RunDeltaCardPayload =>
  ({ chatId: 7, runId, repo, root: repo, ...(at !== undefined ? { at } : {}), delta: { runId, headline, dimensions: [] } }) as unknown as RunDeltaCardPayload;
const progress = (runId: string, status: 'pending' | 'failed', at?: number): RunDeltaCardPayload =>
  ({ chatId: 7, runId, status, ...(at !== undefined ? { at } : {}) });

describe('run delta cards of a chat', () => {
  it('replaces a re-posted card and keeps one card per run and repository', () => {
    const merged = mergeCards([card('a'), card('b')], [card('a', '/repo', 'worse'), card('a', '/other')]);
    expect(merged.map(cardKey)).toEqual([cardKey(card('a')), cardKey(card('b')), cardKey(card('a', '/other'))]);
    expect((merged[0] as { delta: { headline: string } }).delta.headline).toBe('worse');
  });

  it('shows "Measuring…" until a computed card replaces it, and never lets a late pending card replace a computed one', () => {
    let cards = mergeCards([], [progress('a', 'pending', 10)]);
    expect(cards).toEqual([progress('a', 'pending', 10)]);
    cards = mergeCards(cards, [card('a', '/repo', 'worse', 10)]);
    expect(cards.map((c) => c.status ?? 'computed')).toEqual(['computed']);
    expect(mergeCards(cards, [progress('a', 'pending', 10)])).toEqual(cards);
    expect(mergeCards(cards, [progress('a', 'failed', 10)])).toEqual(cards);
  });

  it('replaces a pending card with the failed one, so it never sits pending', () => {
    expect(mergeCards([progress('a', 'pending')], [progress('a', 'failed')])).toEqual([progress('a', 'failed')]);
  });

  it('keeps only well-formed rows from a run-delta/get answer, progress rows included', () => {
    expect(cardsFromAnswer(null)).toEqual([]);
    expect(cardsFromAnswer({ error: 'x' })).toEqual([]);
    expect(cardsFromAnswer([card('a'), { runId: 'b' }, 3, progress('c', 'pending'), { ...progress('d', 'pending'), at: 'x' }]))
      .toEqual([card('a'), progress('c', 'pending')]);
  });

  it('places a card after the reply the host named (`at`), else after the last reply', () => {
    const placed = placeCards([card('a', '/repo', 'same', 10), card('b'), card('gone', '/repo', 'same', 99), progress('p', 'pending', 20)], [10, 20, 30]);
    expect(placed.get(10)!.map((c) => c.runId)).toEqual(['a']);
    expect(placed.get(20)!.map((c) => c.runId)).toEqual(['p']);
    expect(placed.get(30)!.map((c) => c.runId)).toEqual(['b', 'gone']);
    expect(placeCards([card('a')], []).size).toBe(0);
  });

  it('asks the host to open repo-relative paths only, refusing absolute paths and .. segments', () => {
    expect(safeRepoPath('api/routes.ts')).toBe('api/routes.ts');
    expect(safeRepoPath('api\\routes.ts')).toBe('api/routes.ts');
    for (const bad of ['/etc/passwd', 'C:\\Windows\\win.ini', 'c:/x', '\\\\server\\share\\x', '../secret', 'a/../../b', 'a\\..\\b', '']) {
      expect(safeRepoPath(bad), bad).toBeUndefined();
    }
  });
});

describe('Release run', () => {
  const L = DEFAULT_RUN_DELTA_LABELS;

  it('asks for confirmation naming the rules, then posts run-delta/release with the run id', async () => {
    const confirm = vi.fn(async () => true);
    const send = vi.fn(async () => true);
    expect(await releaseRun('run-1', ['guard-removed'], L, confirm, send)).toBe('released');
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: L.releaseConfirmTitle, confirmLabel: L.releaseConfirmLabel, destructive: true, message: expect.stringContaining(L.rules.guardRemoved!),
    }));
    expect(send).toHaveBeenCalledWith(RUN_DELTA_RELEASE, { runId: 'run-1' });
  });

  it('posts nothing when the person cancels', async () => {
    const send = vi.fn(async () => true);
    expect(await releaseRun('run-1', ['guard-removed'], L, async () => false, send)).toBe('cancelled');
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a refusal (run_delta_release_refused) as refused', async () => {
    const send = vi.fn(async () => { throw new Error('run_delta_release_refused'); });
    expect(await releaseRun('run-1', ['guard-removed'], L, async () => true, send)).toBe('refused');
  });
});
