import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
import { analyzeCodebaseTool } from './codeAnalysisTool.js';
import { compareAnalysis, type CodeAnalysisSnapshot } from './codeAnalysis.js';
const execAsync = promisify(exec);

it.skipIf(process.env.BF_RUN_ANALYZERS !== '1')('measures actual before/after analyzer output on a disposable repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'builderforce-analyzer-test-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module', exports: './src/index.ts' }));
    await writeFile(join(root, 'knip.json'), JSON.stringify({ entry: ['src/index.ts'], project: ['src/**/*.ts'] }));
    const body = ['const a = input + 1;', 'const b = a * 2;', 'const c = b + 3;', 'const d = c * 4;', 'const e = d + 5;', 'const f = e * 6;', 'return f + 7;'].join('\n');
    await writeFile(join(root, 'src/index.ts'), `import { other } from './other.js';\nexport function run(input: number) {\n${body}\n}\nconsole.log(other(2));`);
    await writeFile(join(root, 'src/other.ts'), `export function other(input: number) {\n${body}\n}\nexport const unusedExport = 1;`);
    await writeFile(join(root, 'src/unused.ts'), 'export const unusedFile = 1;');
    const context = { caps: {
      shell: { run: async (command: string) => {
        try { const r = await execAsync(command, { cwd: root, maxBuffer: 2_000_000, windowsHide: true }); return { ok: true, exitCode: 0, stdout: r.stdout }; }
        catch (error) { const e = error as { stdout?: string; code?: number }; return { ok: false, exitCode: e.code ?? 1, stdout: e.stdout ?? '' }; }
      } },
      repoRead: { readFile: async (path: string) => ({ ok: true, content: await readFile(join(root, path), 'utf8') }) },
    } };
    const scan = async () => (await analyzeCodebaseTool.execute({}, context as never)).data.snapshot as CodeAnalysisSnapshot;
    const before = await scan();
    expect(before.tools, JSON.stringify(before.tools)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'knip', status: 'complete' })]));
    expect(before.tools.every((t) => t.status === 'complete'), JSON.stringify(before.tools)).toBe(true);
    expect(before.nodes).toHaveLength(3);
    expect(before.issues.some((i) => i.kind === 'duplicate')).toBe(true);
    expect(before.issues.some((i) => i.kind === 'unused-file')).toBe(true);
    expect(before.issues.some((i) => i.kind === 'unused-export')).toBe(true);
    await writeFile(join(root, 'src/index.ts'), "import { other } from './other.js';\nexport const run = other;\n");
    await writeFile(join(root, 'src/other.ts'), `export function other(input: number) {\n${body}\n}\n`);
    await unlink(join(root, 'src/unused.ts'));
    const after = await scan();
    expect(after.tools.every((t) => t.status === 'complete'), JSON.stringify(after.tools)).toBe(true);
    expect(after.nodes).toHaveLength(2);
    const diff = compareAnalysis(after, before);
    expect(diff.comparable).toBe(true);
    expect(diff.resolved.length).toBeGreaterThanOrEqual(3);
    expect(diff.added).toEqual([]);
  } finally {
    // Resolve and verify the exact generated temp directory before recursive cleanup.
    const absolute = resolve(root);
    if (absolute.startsWith(resolve(tmpdir()) + sep) && absolute.includes('builderforce-analyzer-test-')) await rm(absolute, { recursive: true, force: true });
  }
}, 180_000);
