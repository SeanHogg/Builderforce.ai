import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import { canvasNoticesFrom, type CanvasNoticeTranslator } from './canvasNotices';
import type { RunEvent } from '@builderforce/agent-run';

/**
 * The Creation Canvas under the ONE scripted task (PRD 35 §3.3). `runCreationCanvasAi` builds the canvas's own ports (its
 * model stream, board tools, delivery ledger) and calls `runAgent`; this reads the trace the agent emitted through the
 * canvas's event port by wrapping that one call, and holds it to the shared `RunEvent` trace (less the one closed-catalog difference) and answer
 * (`@builderforce/agent-run` `conformanceTask.ts`) that the cloud, on-prem, channel and Brain adapters are held to.
 */

const mocks = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  events: [] as RunEvent[],
}));

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
// The one call every adapter makes: the agent runs exactly as it would, with the adapter's own event sink wrapped to copy what
// it is told into `mocks.events`.
vi.mock('@builderforce/agent-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@builderforce/agent-run')>();
  return {
    ...actual,
    runAgent: (input: Parameters<typeof actual.runAgent>[0]) =>
      actual.runAgent({ ...input, ports: { ...input.ports, events: actual.teeEvents(input.ports.events, mocks.events) } }),
  };
});

const { runCreationCanvasAi } = await import('./creationCanvasAi');
const { CONFORMANCE_ANSWER, CONFORMANCE_PROMPT, CONFORMANCE_SCRIPT, CONFORMANCE_TRACE_CLOSED_CATALOG, conformanceTrace } = await import('@builderforce/agent-run');

const translateNotice = createTranslator({ locale: 'en', messages: en as never, namespace: 'creationCanvas.notice' as never });
const NOTICES = canvasNoticesFrom(((key, values) => translateNotice(key as never, values as never)) as CanvasNoticeTranslator);

describe('the Creation Canvas under the shared scripted task', () => {
  beforeEach(() => {
    mocks.streamChatCompletion.mockReset();
    mocks.events.length = 0;
  });

  it('emits the shared RunEvent trace and the shared answer', async () => {
    for (const c of CONFORMANCE_SCRIPT) {
      mocks.streamChatCompletion.mockResolvedValueOnce({
        text: c.content,
        toolCalls: (c.toolCalls ?? []).map((call) => ({ id: call.id, name: call.name, args: call.arguments })),
        ...(c.model ? { resolvedModel: c.model } : {}),
      });
    }

    const answer = await runCreationCanvasAi({ prompt: CONFORMANCE_PROMPT, canvasSnapshot: '{"objects":[]}', persistence: 'local', canvasActions: [], notices: NOTICES });

    // FINDING (reported, not masked): the canvas's catalog is closed to the board's tools and has no `finish`, so the scripted
    // `finish` is refused and the run ends on the next prose turn (CONFORMANCE_TRACE_CLOSED_CATALOG). Everything else is the shared trace.
    expect(conformanceTrace(mocks.events)).toEqual(CONFORMANCE_TRACE_CLOSED_CATALOG);
    expect(answer).toBe(CONFORMANCE_ANSWER);
  });
});
