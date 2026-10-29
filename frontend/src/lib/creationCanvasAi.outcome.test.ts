import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import { canvasNoticesFrom, type CanvasNoticeTranslator } from './canvasNotices';
import { canvasOutcomeRequest } from './canvasRunOutcome';

/**
 * A canvas run hands its PRD 35 §8.2 uniform outcome row — once, `entryPoint: 'canvas'` — to
 * the host's `onOutcome` port, and does no network I/O of its own: the host owns the send
 * (`brainTurn/canvasOutcomeReporter`). The request the host builds from the row is never a
 * routing signal: a canvas turn is not evidence about coding models.
 */

const mocks = vi.hoisted(() => ({ streamChatCompletion: vi.fn(), fetch: vi.fn() }));

vi.mock('@seanhogg/builderforce-brain-embedded', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seanhogg/builderforce-brain-embedded')>()),
  fetchMcpToolEntries: vi.fn(async () => []),
  mcpActionsFrom: vi.fn(() => []),
  streamChatCompletion: mocks.streamChatCompletion,
  resolveBrainStream: (config: { stream?: unknown }) => config.stream ?? mocks.streamChatCompletion,
}));
vi.mock('@/lib/brain/runtime', () => ({ brainConfig: { transport: {} } }));
vi.mock('@/lib/brain/guestRuntime', () => ({ guestBrainConfig: { transport: {} } }));
vi.mock('@/lib/guestRoomApi', () => ({ ensureGuestToken: vi.fn(async () => true) }));

const { runCreationCanvasAi } = await import('./creationCanvasAi');

const translateNotice = createTranslator({ locale: 'en', messages: en as never, namespace: 'creationCanvas.notice' as never });
const NOTICES = canvasNoticesFrom(((key, values) => translateNotice(key as never, values as never)) as CanvasNoticeTranslator);

describe('a canvas run’s uniform outcome row', () => {
  beforeEach(() => {
    mocks.streamChatCompletion.mockReset();
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: 'The board is empty.', resolvedModel: 'known/model', finishReason: 'stop', toolCalls: [], usage: { prompt: 100, completion: 50, cacheRead: 40 } });
  });

  it('is handed to the host once, labelled canvas, with the run’s counters', async () => {
    const onOutcome = vi.fn();

    await runCreationCanvasAi({
      prompt: 'What is on the board?', canvasSnapshot: '{"objects":[]}', persistence: 'server', notices: NOTICES, canvasActions: [], onOutcome,
    });

    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({
      entryPoint: 'canvas', model: 'known/model', terminalStatus: 'finished', toolCalls: 0, toolErrors: 0, verify: 'not-run',
      // The gateway's usage report reached the run's tally.
      tokens: 150, cacheReadTokens: 40,
    }));
  });

  it('makes no request of its own — not even after the run settles and pending work flushes', async () => {
    const onOutcome = vi.fn();
    vi.stubGlobal('fetch', mocks.fetch);
    try {
      await runCreationCanvasAi({
        prompt: 'What is on the board?', canvasSnapshot: '{"objects":[]}', persistence: 'server', notices: NOTICES, canvasActions: [], onOutcome,
      });
      // The run DID settle and report (so a late send would have been due)…
      expect(onOutcome).toHaveBeenCalledTimes(1);
      // …and a report sent asynchronously (a dynamic import, a promise chain) would land by now.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mocks.fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('becomes a report that records the run and never teaches the router', () => {
    const request = canvasOutcomeRequest(
      { entryPoint: 'canvas', model: 'known/model', steps: 2, toolCalls: 1, toolErrors: 0, compactions: 0, stallRecoveries: 0, escalations: 0, verify: 'not-run', terminalStatus: 'finished' },
      { clientRunId: 'canvas:t:1', stopped: false, projectId: 12 },
    );

    expect(request).toMatchObject({ entryPoint: 'canvas', terminalStatus: 'completed', routingSignal: false, projectId: 12, source: 'external' });
  });

  it('carries the run’s tokens and cost to the door, once', () => {
    const request = canvasOutcomeRequest(
      { entryPoint: 'canvas', model: 'm', steps: 2, toolCalls: 1, toolErrors: 0, compactions: 0, stallRecoveries: 0, escalations: 0, verify: 'not-run', terminalStatus: 'finished', tokens: 5_400, cacheReadTokens: 1_200, cost: 830 },
      { clientRunId: 'canvas:t:1', stopped: false },
    );

    expect(request).toMatchObject({ tokens: 5_400, cacheReadTokens: 1_200, costMc: 830 });
    expect(request).not.toHaveProperty('cost');
  });

  it('reports a Stop as cancelled, not as a failure', () => {
    const row = { entryPoint: 'canvas', model: 'm', steps: 1, toolCalls: 0, toolErrors: 0, compactions: 0, stallRecoveries: 0, escalations: 0, verify: 'not-run' as const, terminalStatus: 'failed' };

    expect(canvasOutcomeRequest(row, { clientRunId: 'c', stopped: true })).toMatchObject({ terminalStatus: 'cancelled' });
    expect(canvasOutcomeRequest(row, { clientRunId: 'c', stopped: false })).toMatchObject({ terminalStatus: 'failed' });
  });
});
