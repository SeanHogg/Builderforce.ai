import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CONSOLE_ENTRIES,
  clearConsoleEntries,
  formatConsoleEntry,
  matchesConsoleFilter,
  readConsoleEntries,
  recordConsoleMessage,
  subscribeConsoleEntries,
  type ConsoleLevel,
} from './previewConsole';

const WS = 4242;
const OTHER = 'local:console-other' as const;

beforeEach(() => {
  clearConsoleEntries(WS);
  clearConsoleEntries(OTHER);
});

describe('previewConsole', () => {
  it('records messages per workspace, oldest first', () => {
    recordConsoleMessage(WS, { level: 'log', text: 'first' });
    recordConsoleMessage(WS, { level: 'warn', text: 'second' });
    recordConsoleMessage(OTHER, { level: 'log', text: 'elsewhere' });
    expect(readConsoleEntries(WS).map((entry) => [entry.level, entry.text])).toEqual([['log', 'first'], ['warn', 'second']]);
    expect(readConsoleEntries(OTHER)).toHaveLength(1);
  });

  it('collapses identical consecutive lines into a count, but not across levels', () => {
    for (let i = 0; i < 5; i += 1) recordConsoleMessage(WS, { level: 'error', text: 'boom' });
    recordConsoleMessage(WS, { level: 'warn', text: 'boom' });
    recordConsoleMessage(WS, { level: 'error', text: 'boom' });
    const entries = readConsoleEntries(WS);
    expect(entries.map((entry) => [entry.level, entry.count])).toEqual([['error', 5], ['warn', 1], ['error', 1]]);
    expect(formatConsoleEntry(entries[0]!)).toBe('[error ×5] boom');
    expect(formatConsoleEntry(entries[1]!)).toBe('[warn] boom');
  });

  it('is a ring buffer: only the newest entries survive', () => {
    for (let i = 0; i < MAX_CONSOLE_ENTRIES + 25; i += 1) recordConsoleMessage(WS, { level: 'log', text: `line ${i}` });
    const entries = readConsoleEntries(WS);
    expect(entries).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(entries[0]!.text).toBe('line 25');
    expect(entries.at(-1)!.text).toBe(`line ${MAX_CONSOLE_ENTRIES + 24}`);
  });

  it('ignores blank lines and invalid workspace ids', () => {
    recordConsoleMessage(WS, { level: 'log', text: '   ' });
    recordConsoleMessage(0, { level: 'log', text: 'nope' });
    expect(readConsoleEntries(WS)).toEqual([]);
    expect(readConsoleEntries(0)).toEqual([]);
  });

  it('clears and notifies subscribers', () => {
    const listener = vi.fn();
    const stop = subscribeConsoleEntries(listener);
    recordConsoleMessage(WS, { level: 'info', text: 'hi' });
    clearConsoleEntries(WS);
    expect(readConsoleEntries(WS)).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(WS);
    stop();
    recordConsoleMessage(WS, { level: 'info', text: 'after' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('hands out copies, so a reader cannot rewrite the store', () => {
    recordConsoleMessage(WS, { level: 'log', text: 'x' });
    readConsoleEntries(WS)[0]!.text = 'tampered';
    expect(readConsoleEntries(WS)[0]!.text).toBe('x');
  });

  it('filters by level group', () => {
    expect(matchesConsoleFilter('error', 'errors')).toBe(true);
    expect(matchesConsoleFilter('warn', 'errors')).toBe(false);
    expect(matchesConsoleFilter('warn', 'warnings')).toBe(true);
    const infoLevels: ConsoleLevel[] = ['log', 'info', 'debug'];
    expect(infoLevels.every((level) => matchesConsoleFilter(level, 'info'))).toBe(true);
    expect(matchesConsoleFilter('debug', 'all')).toBe(true);
  });
});
