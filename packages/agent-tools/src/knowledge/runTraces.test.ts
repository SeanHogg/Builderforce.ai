import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRunTraceMemo, MAX_STEPS_PER_RUN, MAX_TOTAL_STEPS, readRunTraces, traceSourceState } from './runTraces.js';
import { memoryKnowledgeFs } from './memoryKnowledgeFs.test-util.js';

const line = (o: Record<string, unknown>): string => JSON.stringify(o);

describe('readRunTraces / traceSourceState', () => {
  beforeEach(() => clearRunTraceMemo());

  it('a missing trace folder is absent, not an error', async () => {
    const fs = memoryKnowledgeFs({ '/repo/src/a.ts': 'x' });
    expect(await readRunTraces({ fs, rootPath: '/repo' })).toEqual({ runs: [], skippedLines: 0 });
    expect(await traceSourceState({ fs, rootPath: '/repo' })).toEqual({ state: 'absent' });
  });

  it('files with no parsable run are absent with the unparsed line count (at least 1)', async () => {
    const fs = memoryKnowledgeFs({ '/repo/.builderforce/traces/r.jsonl': ['{nope', 'also not json'].join('\n') });
    expect(await traceSourceState({ fs, rootPath: '/repo' })).toEqual({ state: 'absent', unparsed: 2 });
    const empty = memoryKnowledgeFs({ '/repo/.builderforce/traces/r.jsonl': { text: '', size: 0 } });
    expect(await traceSourceState({ fs: empty, rootPath: '/repo' })).toEqual({ state: 'absent', unparsed: 1 });
  });

  it('makes an absolute file under the root root-relative, accepts file:// URLs, and skips absolute files outside it', async () => {
    const fs = memoryKnowledgeFs({
      '/repo/.builderforce/traces/r.jsonl': [
        line({ run: 'r', at: '2026-11-27T10:00:00Z', file: '/repo/src/in.ts' }),
        line({ run: 'r', at: '2026-11-27T10:00:01Z', file: 'file:///repo/src/url%20x.ts' }),
        line({ run: 'r', at: '2026-11-27T10:00:02Z', file: '/other/out.ts' }),
        line({ run: 'r', at: '2026-11-27T10:00:03Z', file: '/repo/../etc/x.ts' }),
      ].join('\n'),
    });
    const traces = await readRunTraces({ fs, rootPath: '/repo' });
    expect(traces.runs[0]!.steps.map((s) => s.path)).toEqual(['src/in.ts', 'src/url x.ts']);
    expect(traces.skippedLines).toBe(2);
  });

  it('compares a Windows drive root case-insensitively', async () => {
    const fs = memoryKnowledgeFs({
      'C:/Repo/.builderforce/traces/r.jsonl': [
        line({ run: 'r', at: '2026-11-27T10:00:00Z', file: 'c:\\repo\\src\\a.ts' }),
        line({ run: 'r', at: '2026-11-27T10:00:01Z', file: 'file:///c:/repo/src/b.ts' }),
      ].join('\n'),
    });
    const traces = await readRunTraces({ fs, rootPath: 'C:\\Repo' });
    expect(traces.runs[0]!.steps.map((s) => s.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('caps the steps kept across all files and counts the rest as skipped', async () => {
    const files: Record<string, { text: string; mtime: number }> = {};
    const perFile = MAX_STEPS_PER_RUN;
    const fileCount = Math.ceil(MAX_TOTAL_STEPS / perFile) + 1;
    for (let f = 0; f < fileCount; f++) {
      files[`/repo/.builderforce/traces/f${f}.jsonl`] = {
        text: Array.from({ length: perFile }, (_, i) => line({ run: `run${f}`, at: '2026-11-27T10:00:00Z', file: `src/f${i}.ts` })).join('\n'),
        mtime: f,
      };
    }
    const traces = await readRunTraces({ fs: memoryKnowledgeFs(files), rootPath: '/repo' });
    expect(traces.runs.reduce((n, r) => n + r.steps.length, 0)).toBe(MAX_TOTAL_STEPS);
    expect(traces.skippedLines).toBe(fileCount * perFile - MAX_TOTAL_STEPS);
  });

  it('parses an unchanged file once, and again when its size or mtime changes', async () => {
    const files: Record<string, { text: string; mtime: number }> = {
      '/repo/.builderforce/traces/r.jsonl': { text: line({ run: 'r', at: '2026-11-27T10:00:00Z', file: 'a.ts' }), mtime: 5 },
    };
    const fs = memoryKnowledgeFs(files);
    const read = vi.spyOn(fs, 'readFile');
    await readRunTraces({ fs, rootPath: '/repo' });
    await traceSourceState({ fs, rootPath: '/repo' });
    expect(read).toHaveBeenCalledTimes(1);
    files['/repo/.builderforce/traces/r.jsonl']!.mtime = 6;
    await readRunTraces({ fs, rootPath: '/repo' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reports a read error that is not "missing"', async () => {
    const fs = memoryKnowledgeFs({});
    fs.readDirectory = async () => { throw new Error('EACCES: permission denied'); };
    await expect(readRunTraces({ fs, rootPath: '/repo' })).rejects.toThrow(/EACCES/);
  });

  it('groups lines by run, keeps call order, and orders runs oldest first', async () => {
    const fs = memoryKnowledgeFs({
      '/repo/.builderforce/traces/b.jsonl': { text: [
        line({ run: 'r2', at: '2026-11-27T10:00:00Z', file: 'src/b.ts', fn: 'second', line: 4, args: { n: '1' }, ret: '2' }),
        line({ run: 'r2', at: '2026-11-27T10:00:01Z', file: 'src/c.ts' }),
      ].join('\n'), mtime: 20 },
      '/repo/.builderforce/traces/a.jsonl': { text: [
        line({ run: 'r1', at: '2026-11-26T09:00:00Z', file: 'src/a.ts', fn: 'first' }),
        line({ run: 'r1', at: '2026-11-26T09:00:02Z', file: 'src/b.ts' }),
      ].join('\n'), mtime: 10 },
      '/repo/.builderforce/traces/notes.txt': 'ignored',
    });
    const traces = await readRunTraces({ fs, rootPath: '/repo' });
    expect(traces.skippedLines).toBe(0);
    expect(traces.runs.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(traces.runs[0]!.steps.map((s) => s.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(traces.runs[1]!.steps[0]).toEqual({ path: 'src/b.ts', fn: 'second', line: 4, args: { n: '1' }, ret: '2' });
    expect(await traceSourceState({ fs, rootPath: '/repo' })).toEqual({ state: 'collected', runs: 2, latest: '2026-11-27T10:00:00Z' });
  });

  it('drops and counts malformed lines and files outside the root', async () => {
    const fs = memoryKnowledgeFs({
      '/repo/.builderforce/traces/r.jsonl': [
        line({ run: 'r', at: '2026-11-27T10:00:00Z', file: 'src/ok.ts' }),
        '{nope',
        line({ run: 'r', at: '2026-11-27T10:00:00Z', file: '/etc/passwd' }),
        line({ run: 'r', at: '2026-11-27T10:00:00Z', file: 'C:\\x\\y.ts' }),
        line({ run: 'r', at: '2026-11-27T10:00:00Z', file: '../outside.ts' }),
        line({ run: 'r', at: '2026-11-27T10:00:00Z', file: 'a/../../outside.ts' }),
        line({ at: '2026-11-27T10:00:00Z', file: 'src/norun.ts' }),
        '',
      ].join('\n'),
    });
    const traces = await readRunTraces({ fs, rootPath: '/repo' });
    expect(traces.skippedLines).toBe(6);
    expect(traces.runs).toHaveLength(1);
    expect(traces.runs[0]!.steps.map((s) => s.path)).toEqual(['src/ok.ts']);
  });

  it('skips and reports a file over 2 MB, and caps the steps of a run', async () => {
    const many = Array.from({ length: MAX_STEPS_PER_RUN + 3 }, (_, i) => line({ run: 'big', at: '2026-11-27T10:00:00Z', file: `src/f${i}.ts` })).join('\n');
    const fs = memoryKnowledgeFs({
      '/repo/.builderforce/traces/huge.jsonl': { text: 'x', size: 2 * 1024 * 1024 + 1 },
      '/repo/.builderforce/traces/big.jsonl': many,
    });
    const report = vi.fn();
    const traces = await readRunTraces({ fs, rootPath: '/repo' }, report);
    expect(report).toHaveBeenCalledWith('huge.jsonl', 'too-large');
    expect(traces.runs).toHaveLength(1);
    expect(traces.runs[0]!.steps).toHaveLength(MAX_STEPS_PER_RUN);
    expect(traces.skippedLines).toBe(3);
  });

  it('reads only the newest 20 files', async () => {
    const files: Record<string, { text: string; mtime: number }> = {};
    for (let i = 0; i < 25; i++) files[`/repo/.builderforce/traces/r${i}.jsonl`] = { text: line({ run: `r${i}`, at: `2026-11-27T10:00:${String(i).padStart(2, '0')}Z`, file: 'a.ts' }), mtime: i };
    const traces = await readRunTraces({ fs: memoryKnowledgeFs(files), rootPath: '/repo' });
    expect(traces.runs).toHaveLength(20);
    expect(traces.runs.map((r) => r.id)).not.toContain('r0');
  });
});
