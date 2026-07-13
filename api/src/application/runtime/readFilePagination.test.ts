import { describe, expect, it } from 'vitest';
import {
  buildCoreToolRegistry,
  windowFileContent,
  READ_DEFAULT_LINE_LIMIT,
  type CapabilityProvider,
  type RepoReadResult,
} from '@builderforce/agent-tools';

// ---------------------------------------------------------------------------
// read_file pagination — a large file (the 712KB ROADMAP.md that hard-failed the
// VS Code Brain) must come back as a bounded, paginated line window with a
// "read the next chunk" note, NEVER a "file too large" dead end. The windowing
// lives once in the shared tool, so this pins it for every surface at once.
// ---------------------------------------------------------------------------

/** A stub provider whose readFile returns a fixed file body, so we exercise the
 *  tool's windowing independent of any disk/git backend. */
function providerWith(content: string): CapabilityProvider {
  return {
    capabilities: new Set(['repo.read']),
    repoRead: {
      async listFiles(): Promise<never> {
        throw new Error('not used');
      },
      async readFile(path: string): Promise<RepoReadResult> {
        return { ok: true, path, content };
      },
      async searchCode(): Promise<never> {
        throw new Error('not used');
      },
    },
  };
}

async function readFile(content: string, args: Record<string, unknown>): Promise<RepoReadResult> {
  const registry = buildCoreToolRegistry();
  const r = await registry.dispatch('read_file', { path: 'ROADMAP.md', ...args }, { caps: providerWith(content) });
  return r.data as unknown as RepoReadResult;
}

describe('windowFileContent', () => {
  it('returns the whole file when it fits in one window', () => {
    const w = windowFileContent('a\nb\nc');
    expect(w.content).toBe('a\nb\nc');
    expect(w.truncated).toBe(false);
    expect(w.totalLines).toBe(3);
    expect(w.offset).toBe(1);
  });

  it('slices to the default window and flags truncation for a long file', () => {
    const lines = Array.from({ length: READ_DEFAULT_LINE_LIMIT + 500 }, (_, i) => `line ${i + 1}`);
    const w = windowFileContent(lines.join('\n'));
    expect(w.returnedLines).toBe(READ_DEFAULT_LINE_LIMIT);
    expect(w.truncated).toBe(true);
    expect(w.totalLines).toBe(READ_DEFAULT_LINE_LIMIT + 500);
    expect(w.content.split('\n')[0]).toBe('line 1');
  });

  it('pages from an offset without dropping or duplicating lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `L${i + 1}`);
    const first = windowFileContent(lines.join('\n'), { offset: 1, limit: 4 });
    const second = windowFileContent(lines.join('\n'), { offset: first.offset + first.returnedLines, limit: 4 });
    expect(first.content).toBe('L1\nL2\nL3\nL4');
    expect(second.offset).toBe(5);
    expect(second.content).toBe('L5\nL6\nL7\nL8');
    expect(second.truncated).toBe(true);
    const third = windowFileContent(lines.join('\n'), { offset: 9, limit: 4 });
    expect(third.content).toBe('L9\nL10');
    expect(third.truncated).toBe(false);
  });
});

describe('read_file tool — large-file pagination', () => {
  it('never hard-fails a large file; returns the first window + a paging note', async () => {
    const body = Array.from({ length: 5000 }, (_, i) => `roadmap item ${i + 1}`).join('\n');
    const r = await readFile(body, {});
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.totalLines).toBe(5000);
    expect(r.offset).toBe(1);
    expect(r.content!.split('\n')).toHaveLength(READ_DEFAULT_LINE_LIMIT);
    expect(r.note).toMatch(/offset 2001/); // tells the model exactly how to continue
  });

  it('honors offset so the model can walk to the end of the file', async () => {
    const body = Array.from({ length: 5000 }, (_, i) => `item ${i + 1}`).join('\n');
    const r = await readFile(body, { offset: 4001 });
    expect(r.ok).toBe(true);
    expect(r.offset).toBe(4001);
    expect(r.truncated).toBe(false); // 1000 lines left, fits in one window
    expect(r.content!.split('\n')[0]).toBe('item 4001');
    expect(r.note).toBeUndefined();
  });

  it('reads a small file whole with no truncation', async () => {
    const r = await readFile('only\ntwo lines', {});
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.content).toBe('only\ntwo lines');
    expect(r.note).toBeUndefined();
  });
});
