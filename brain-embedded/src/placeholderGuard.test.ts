import { describe, expect, it } from 'vitest';
import {
  formatPlaceholderLines,
  PLACEHOLDER_GUARD_LABEL,
  placeholderAdvisory,
  placeholdersInTrace,
  placeholdersWritten,
  placeholderTraceEvent,
} from './placeholderGuard';
import type { BrainTraceEvent } from './brainTriage';

/**
 * Chat #127 committed `return undefined; // TODO: wire up the actual signal` and reported
 * the bug fixed. Every measure the run had read that edit as a success.
 */
describe('placeholdersWritten', () => {
  it('catches the stub chat #127 shipped', () => {
    const hits = placeholdersWritten('edit_file', {
      path: 'clients/vscode/src/brainRunHost.ts',
      old_string: 'const defs = await ports.tools(projectId, confirmChildWrite);',
      new_string: '      return undefined; // TODO: wire up the actual signal\n    const defs = await ports.tools(projectId);',
    });
    expect(hits).toEqual([{ path: 'clients/vscode/src/brainRunHost.ts', text: 'return undefined; // TODO: wire up the actual signal' }]);
  });

  it("catches the model's own reasoning left in the source", () => {
    const hits = placeholdersWritten('write_file', {
      path: 'src/a.ts',
      content: '// Actually, the simplest solution is a module variable. Let me use that approach instead.\nexport const a = 1;',
    });
    expect(hits).toHaveLength(1);
  });

  it('catches a stub that throws', () => {
    expect(placeholdersWritten('write_file', { path: 'src/a.ts', content: "throw new Error('not implemented');" })).toHaveLength(1);
  });

  it('does not blame the run for a TODO the replaced text already carried', () => {
    const hits = placeholdersWritten('edit_file', {
      path: 'src/a.ts',
      old_string: '// TODO: cache this\nconst x = load();',
      new_string: '// TODO: cache this\nconst x = await load();',
    });
    expect(hits).toEqual([]);
  });

  it('ignores product copy in strings — only comments are scanned', () => {
    expect(placeholdersWritten('write_file', { path: 'src/Search.tsx', content: '<input placeholder="For now, search by name" />' })).toEqual([]);
  });

  it('ignores a URL that merely contains two slashes', () => {
    expect(placeholdersWritten('write_file', { path: 'src/a.ts', content: 'const u = "https://example.com/todo";' })).toEqual([]);
  });

  it('ignores non-source files — a roadmap that lists TODO work is doing its job', () => {
    expect(placeholdersWritten('write_file', { path: 'ROADMAP.md', content: '- TODO: ship W2' })).toEqual([]);
  });

  it('ignores tools that write no code', () => {
    expect(placeholdersWritten('read_file', { path: 'src/a.ts', content: '// TODO' })).toEqual([]);
  });
});

describe('placeholderAdvisory', () => {
  it('tells the model the work is unfinished and must not be reported as done', () => {
    const advisory = placeholderAdvisory([{ path: 'src/a.ts', text: '// TODO: wire it' }])!;
    expect(advisory).toContain('src/a.ts');
    expect(advisory).toContain('Never report');
  });

  it('says nothing when there is nothing to say', () => {
    expect(placeholderAdvisory([])).toBeNull();
  });
});

describe('placeholdersInTrace', () => {
  it("reads both the parent's guard steps and a delegated child's echoed hits", () => {
    const events: BrainTraceEvent[] = [
      placeholderTraceEvent('edit_file', [{ path: 'src/a.ts', text: '// TODO' }], '2026-09-26T00:00:00Z'),
      {
        ts: '2026-09-26T00:00:01Z',
        category: 'tool',
        label: 'spawn_agent',
        args: { task: 'x' },
        result: JSON.stringify({ ok: true, placeholders: [{ path: 'src/b.ts', text: '// for now' }] }),
      } as BrainTraceEvent,
    ];
    expect(events[0]!.label).toBe(PLACEHOLDER_GUARD_LABEL);
    expect(placeholdersInTrace(events)).toEqual([
      { path: 'src/a.ts', text: '// TODO' },
      { path: 'src/b.ts', text: '// for now' },
    ]);
  });

  it('renders one diagnostics line, and none for a clean run', () => {
    expect(formatPlaceholderLines([])).toEqual([]);
    const [line] = formatPlaceholderLines([{ path: 'src/a.ts', text: '// TODO: wire it' }]);
    expect(line).toContain('Placeholders written: 1 in src/a.ts');
  });
});
