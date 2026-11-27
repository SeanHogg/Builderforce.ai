import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from 'next-intl';
import type { McpToolEntry } from '@seanhogg/builderforce-brain-embedded';
import en from '@/i18n/messages/en.json';
import { canvasNoticesFrom, type CanvasNoticeTranslator } from './canvasNotices';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  fetchTools: vi.fn<() => Promise<McpToolEntry[]>>(),
}));

vi.mock('@seanhogg/builderforce-brain-embedded', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seanhogg/builderforce-brain-embedded')>()),
  fetchMcpToolEntries: mocks.fetchTools,
  resolveBrainStream: () => mocks.stream,
}));
vi.mock('@/lib/brain/runtime', () => ({ brainConfig: { transport: { baseUrl: 'https://canvas.test', getToken: () => 'fixture' } } }));
vi.mock('@/lib/brain/guestRuntime', () => ({ guestBrainConfig: { transport: {} } }));
vi.mock('@/lib/guestRoomApi', () => ({ ensureGuestToken: vi.fn(async () => true) }));

const { runCreationCanvasAi } = await import('./creationCanvasAi');
const translateNotice = createTranslator({ locale: 'en', messages: en as never, namespace: 'creationCanvas.notice' as never });
const NOTICES = canvasNoticesFrom(((key, values) => translateNotice(key as never, values as never)) as CanvasNoticeTranslator);

describe('the Creation Canvas MCP model boundary', () => {
  beforeEach(() => {
    mocks.stream.mockReset();
    mocks.fetchTools.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])('checks tenant approval before a canonical relay call issues a request (%s)', async (approved) => {
    const create = { extensionId: 'builtin', tool: 'tasks.create', name: 'builtin_tasks_create', wireName: 'platform__tasks_create', description: 'Create a Platform task', parameters: { type: 'object' }, mutates: true };
    mocks.fetchTools.mockResolvedValue([create, { ...create, tool: 'runtime.preview_status', name: 'builtin_runtime_preview_status', mutates: false }]);
    mocks.stream.mockResolvedValueOnce({
      text: '', finishReason: 'tool_calls',
      toolCalls: [{ id: 'create', name: 'platform__tasks_create', args: '{"title":"Follow up"}' }],
    }).mockResolvedValue({ text: 'I handled the Platform request.', finishReason: 'stop', toolCalls: [] });
    const relay = vi.fn(async () => new Response(JSON.stringify({ result: { id: 12 } })));
    vi.stubGlobal('fetch', relay);
    const confirmAction = vi.fn(async () => approved);
    await runCreationCanvasAi({ prompt: 'File a follow-up in the Platform backlog.', canvasSnapshot: '{"objects":[]}', persistence: 'server', canvasActions: [], notices: NOTICES, confirmAction });

    const [request] = mocks.stream.mock.calls[0]!;
    expect(request.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(expect.arrayContaining(['platform__tasks_create', 'builtin_runtime_preview_status']));
    expect(confirmAction).toHaveBeenCalledExactlyOnceWith({ name: 'builtin_tasks_create', args: { title: 'Follow up' } });
    expect(relay).toHaveBeenCalledTimes(approved ? 1 : 0);
    if (approved) {
      expect(relay).toHaveBeenCalledWith('https://canvas.test/llm/v1/mcp/call', expect.objectContaining({
        method: 'POST', body: JSON.stringify({ extensionId: 'builtin', tool: 'tasks.create', arguments: { title: 'Follow up' } }),
      }));
    }
  });
});
