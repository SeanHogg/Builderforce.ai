import { beforeEach, describe, expect, it } from 'vitest';
import { canvasBuildActions, type BoundCanvasBuild } from './canvasBuildTools';
import { clearConsoleEntries, recordConsoleMessage } from './previewConsole';
import { serverFileStore } from './workspace/workspaceFileStore';
import { DEFAULT_CONSOLE_LINES } from './canvasPreviewConsoleAction';

const PROJECT = 931;

const builds: BoundCanvasBuild[] = [{ objectId: 'b1', title: 'Shop', modality: 'designer', store: serverFileStore(PROJECT) }];

async function readConsole(args: Record<string, unknown> = {}) {
  const action = canvasBuildActions({ builds: () => builds, createBuild: async () => { throw new Error('unused'); } })
    .find((candidate) => candidate.name === 'canvas_read_preview_console');
  if (!action) throw new Error('canvas_read_preview_console is not registered');
  return action.run(args as never) as Promise<Record<string, unknown>>;
}

beforeEach(() => clearConsoleEntries(PROJECT));

describe('canvas_read_preview_console', () => {
  it('says plainly when the preview has printed nothing', async () => {
    expect(await readConsole()).toMatchObject({ ok: true, lines: 0, note: expect.stringContaining('nothing') });
  });

  it('returns the console newest last, repeats collapsed', async () => {
    recordConsoleMessage(PROJECT, { level: 'log', text: 'mounted' });
    recordConsoleMessage(PROJECT, { level: 'warn', text: 'Each child in a list should have a unique "key" prop.' });
    recordConsoleMessage(PROJECT, { level: 'warn', text: 'Each child in a list should have a unique "key" prop.' });
    recordConsoleMessage(PROJECT, { level: 'error', text: 'Failed to fetch /api/cart' });
    expect(await readConsole()).toEqual({
      ok: true,
      lines: 3,
      console: '[log] mounted\n[warn ×2] Each child in a list should have a unique "key" prop.\n[error] Failed to fetch /api/cart',
    });
  });

  it('filters by level and keeps the most recent `limit` lines', async () => {
    for (let i = 0; i < 5; i += 1) recordConsoleMessage(PROJECT, { level: 'error', text: `e${i}` });
    recordConsoleMessage(PROJECT, { level: 'log', text: 'noise' });
    expect(await readConsole({ level: 'errors', limit: 2 })).toEqual({ ok: true, lines: 2, omitted: 3, console: '[error] e3\n[error] e4' });
    expect(await readConsole({ level: 'warnings' })).toMatchObject({ ok: true, lines: 0 });
  });

  it('defaults to the last 100 lines and ignores a nonsense level or limit', async () => {
    for (let i = 0; i < DEFAULT_CONSOLE_LINES + 10; i += 1) recordConsoleMessage(PROJECT, { level: 'log', text: `l${i}` });
    const result = await readConsole({ level: 'shouting', limit: -4 });
    expect(result).toMatchObject({ ok: true, lines: DEFAULT_CONSOLE_LINES, omitted: 10 });
    expect(String(result.console).split('\n').at(-1)).toBe(`[log] l${DEFAULT_CONSOLE_LINES + 9}`);
  });

  it('asks which app when the board has several and none is named', async () => {
    builds.push({ objectId: 'b2', title: 'Blog', modality: 'designer', store: serverFileStore(932) });
    try {
      expect(await readConsole()).toHaveProperty('error');
    } finally {
      builds.pop();
    }
  });
});
