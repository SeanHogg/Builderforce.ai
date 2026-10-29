import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import { canvasNoticesFrom, type CanvasNoticeTranslator } from './canvasNotices';

/**
 * CHARACTERIZATION — what the model is handed when a canvas tool returns a big result.
 *
 * The canvas used to send every tool result uncapped. On the one agent a result is capped
 * ONCE, to a table row for the tool sized by the serving model's window, so the rows the
 * canvas's reads need (`canvas_read_snapshot`, `canvas_read_object`, `canvas_read_build_file`)
 * must be big enough for a real board, and a result that IS cut must say so in words the
 * model sees — it must never write a cut file back as if it were whole.
 */

const mocks = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  window: vi.fn((_model: string): number | undefined => undefined),
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
// The window the page knows for the serving model — the gateway catalog's, in the app.
vi.mock('@/lib/llmModelWindow', () => ({ cachedModelWindow: (model: string) => mocks.window(model) }));

const { runCreationCanvasAi } = await import('./creationCanvasAi');

const translateNotice = createTranslator({ locale: 'en', messages: en as never, namespace: 'creationCanvas.notice' as never });
const NOTICES = canvasNoticesFrom(((key, values) => translateNotice(key as never, values as never)) as CanvasNoticeTranslator);

const SERVED = 'known/model';

/** The tool row the model read on the request after its tool call. */
function toolRowOf(request: number): string {
  const messages = mocks.streamChatCompletion.mock.calls[request][0].messages as Array<{ role: string; content: string }>;
  return messages.find((row) => row.role === 'tool')!.content;
}

/** One tool call, then a plain answer — the question is informational, so no ladder fires. */
function scriptOneRead(name: string, args = '{}') {
  mocks.streamChatCompletion
    .mockResolvedValueOnce({ text: '', resolvedModel: SERVED, finishReason: 'tool_calls', toolCalls: [{ id: 'r1', name, args }] })
    .mockResolvedValueOnce({ text: 'Read it.', resolvedModel: SERVED, finishReason: 'stop', toolCalls: [] });
}

function run(actions: Array<{ name: string; run: () => unknown }>) {
  return runCreationCanvasAi({
    prompt: 'What is on the board?', canvasSnapshot: '{"objects":[]}', persistence: 'local', notices: NOTICES,
    canvasActions: actions.map((action) => ({ ...action, description: action.name, parameters: { type: 'object' } })),
  });
}

const board = { ok: true, objects: Array.from({ length: 120 }, (_, i) => ({ id: `o${i}`, title: `Object ${i}`, text: 'lorem ipsum '.repeat(10) })) };
const fileText = 'const a = 1;\n'.repeat(900);
const bigFileText = 'const a = 1;\n'.repeat(2_500);

describe('a canvas tool result over the old 6K default', () => {
  beforeEach(() => {
    mocks.streamChatCompletion.mockReset();
    mocks.window.mockReset().mockReturnValue(undefined);
  });

  it('reaches the model whole: a >6K board snapshot', async () => {
    expect(JSON.stringify(board).length).toBeGreaterThan(6_000);
    scriptOneRead('canvas_read_snapshot');

    await run([{ name: 'canvas_read_snapshot', run: () => board }]);

    expect(JSON.parse(toolRowOf(1))).toEqual(board);
  });

  it('reaches the model whole: a >6K build file', async () => {
    const file = { ok: true, path: 'src/a.js', content: fileText, truncated: false, offset: 1, totalLines: 901 };
    expect(JSON.stringify(file).length).toBeGreaterThan(6_000);
    scriptOneRead('canvas_read_build_file', '{"path":"src/a.js"}');

    await run([{ name: 'canvas_read_build_file', run: () => file }]);

    expect(JSON.parse(toolRowOf(1))).toEqual(file);
  });
});

// The window only ever SHRINKS a row. The canvas states the reply it reserves (its largest,
// the build ceiling — `budgets.reserveTokens`), so a window the canvas prompt fits in leaves
// compaction a real budget and the row under test reaches the model.
describe('a canvas tool result over the serving model’s window', () => {
  beforeEach(() => {
    mocks.streamChatCompletion.mockReset();
    // 48K tokens: a result may take 30% of it, at 4 chars a token — 57,600 chars, under the 64K row.
    mocks.window.mockReset().mockImplementation((model) => (model === SERVED ? 48_000 : undefined));
  });

  it('is cut to the window and SAYS it was cut: a board snapshot', async () => {
    const huge = { ok: true, objects: Array.from({ length: 700 }, (_, i) => ({ id: `o${i}`, title: `Object ${i}`, text: 'lorem ipsum '.repeat(10) })) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(64_000);
    scriptOneRead('canvas_read_snapshot');

    await run([{ name: 'canvas_read_snapshot', run: () => huge }]);

    const row = toolRowOf(1);
    expect(row.length).toBeLessThanOrEqual(57_600);
    expect(JSON.parse(row)).toMatchObject({ truncated: true });
    expect(JSON.parse(row).note).toContain('NOT the whole');
  });
});

// Past its table row a result IS cut — and says so, whatever the window.
describe('a canvas tool result over its table row', () => {
  beforeEach(() => {
    mocks.streamChatCompletion.mockReset();
    mocks.window.mockReset().mockReturnValue(undefined);
  });

  it('is cut to the row and SAYS it was cut: a board snapshot', async () => {
    const huge = { ok: true, objects: Array.from({ length: 700 }, (_, i) => ({ id: `o${i}`, title: `Object ${i}`, text: 'lorem ipsum '.repeat(10) })) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(64_000);
    scriptOneRead('canvas_read_snapshot');

    await run([{ name: 'canvas_read_snapshot', run: () => huge }]);

    const row = toolRowOf(1);
    expect(row.length).toBeLessThanOrEqual(64_000);
    expect(JSON.parse(row)).toMatchObject({ truncated: true });
    expect(JSON.parse(row).note).toContain('NOT the whole');
  });

  it('is paged at a line, names the tool and the offset that continues it: a >16K build file', async () => {
    const file = { ok: true, path: 'src/a.js', content: bigFileText, truncated: false, offset: 1, totalLines: 2_501 };
    scriptOneRead('canvas_read_build_file', '{"path":"src/a.js"}');

    await run([{ name: 'canvas_read_build_file', run: () => file }]);

    const served = JSON.parse(toolRowOf(1)) as { content: string; truncated: boolean; note: string; totalLines: number };
    expect(served.truncated).toBe(true);
    expect(served.content.length).toBeLessThan(bigFileText.length);
    expect(served.content.endsWith('\n')).toBe(false);
    expect(served.note).toContain('call canvas_read_build_file again with offset');
    expect(served.totalLines).toBe(2_501);
  });
});
