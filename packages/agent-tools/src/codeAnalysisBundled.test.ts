import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodeAnalysisSnapshot } from './codeAnalysis.js';
import { analyzeCodebaseTool, analyzerCommand, ANALYZERS, knipFixCommand, knipReportCommand, setBundledAnalyzers, TYPESCRIPT_PIN } from './codeAnalysisTool.js';

const dependency = { modules: [{ source: 'src/a.ts', dependencies: [] }] };
const duplicates = { duplicates: [] };
const unused = { files: [], issues: [] };
const ENTRIES = { 'dependency-cruiser': '/ext/dc/bin/dc.mjs', jscpd: '/ext/jscpd/bin/jscpd', knip: '/ext/knip/bin/knip.js' };

afterEach(() => setBundledAnalyzers(undefined));

describe('bundled analyzers (PRD 41 A3)', () => {
  it('pins typescript@5.6.3 and the analyzer versions in one place', () => {
    expect(TYPESCRIPT_PIN).toBe('typescript@5.6.3');
    expect(ANALYZERS.map((a) => `${a.name}@${a.version}`)).toEqual(['dependency-cruiser@16.10.4', 'jscpd@4.0.5', 'knip@5.30.0']);
  });

  it('keeps the npm exec form for hosts that do not bundle', () => {
    expect(ANALYZERS.find((a) => a.name === 'knip')!.command).toBe('npm exec --yes --package=knip@5.30.0 --package=typescript@5.6.3 --call="knip --reporter=json --no-progress"');
    expect(knipReportCommand()).toContain('npm exec');
  });

  it('launches the bundled entry with node and never npm exec', async () => {
    setBundledAnalyzers(ENTRIES);
    const commands: string[] = [];
    const run = async (command: string) => {
      commands.push(command);
      return { ok: true, exitCode: 0, stdout: command.includes('/dc/') ? JSON.stringify(dependency) : command.includes('/knip/') ? JSON.stringify(unused) : '' };
    };
    const result = await analyzeCodebaseTool.execute({ path: 'src' }, { caps: { shell: { run }, repoRead: { readFile: async () => ({ ok: true, content: JSON.stringify(duplicates) }) } } } as never);
    const snapshot = result.data.snapshot as CodeAnalysisSnapshot;
    expect(snapshot.tools.map((t) => t.status)).toEqual(['complete', 'complete', 'complete']);
    expect(commands.some((c) => c.startsWith('node "/ext/dc/bin/dc.mjs" --config='))).toBe(true);
    expect(commands.some((c) => c.startsWith('node "/ext/jscpd/bin/jscpd" ') && c.endsWith(' src'))).toBe(true);
    expect(commands.some((c) => c.includes('npm exec') || c.includes('npm '))).toBe(false);
    // Fix preview and re-scan read the same bundled knip.
    expect(knipReportCommand()).toBe('node "/ext/knip/bin/knip.js" --reporter=json --no-progress');
    expect(knipFixCommand(['exports'])).toBe('node "/ext/knip/bin/knip.js" --fix --fix-type exports --no-progress');
  });

  it('marks an analyzer with no bundled entry not_measured / analyzer-unavailable, never a clean zero', async () => {
    setBundledAnalyzers({ 'dependency-cruiser': ENTRIES['dependency-cruiser'] });
    const run = vi.fn(async (command: string) => ({ ok: true, exitCode: 0, stdout: command.includes('/dc/') ? JSON.stringify(dependency) : '' }));
    const result = await analyzeCodebaseTool.execute({}, { caps: { shell: { run }, repoRead: { readFile: async () => ({ ok: true, content: '' }) } } } as never);
    const tools = (result.data.snapshot as CodeAnalysisSnapshot).tools;
    expect(tools.find((t) => t.name === 'jscpd')).toMatchObject({ status: 'not_measured', reason: 'analyzer-unavailable' });
    expect(tools.find((t) => t.name === 'knip')).toMatchObject({ status: 'not_measured', reason: 'analyzer-unavailable' });
    expect(run.mock.calls.some(([c]) => /jscpd|knip/.test(c as string))).toBe(false);
  });

  it('marks a bundled analyzer that starts but prints nothing not_measured', async () => {
    setBundledAnalyzers(ENTRIES);
    const run = async () => ({ ok: false, exitCode: 1, stdout: '' });
    const result = await analyzeCodebaseTool.execute({}, { caps: { shell: { run }, repoRead: { readFile: async () => ({ ok: false, content: '' }) } } } as never);
    expect((result.data.snapshot as CodeAnalysisSnapshot).tools.every((t) => t.status === 'not_measured' && t.reason === 'analyzer-unavailable')).toBe(true);
  });

  it('marks a bundled analyzer whose spawn or setup throws not_measured / analyzer-unavailable, not failed', async () => {
    setBundledAnalyzers(ENTRIES);
    const run = async (command: string) => {
      if (command.startsWith('node')) throw new Error('spawn node ENOENT');
      return { ok: true, exitCode: 0, stdout: '' };
    };
    const result = await analyzeCodebaseTool.execute({}, { caps: { shell: { run }, repoRead: { readFile: async () => ({ ok: false, content: '' }) } } } as never);
    const tools = (result.data.snapshot as CodeAnalysisSnapshot).tools;
    expect(tools.map((t) => t.status)).toEqual(['not_measured', 'not_measured', 'not_measured']);
    expect(tools.every((t) => t.reason === 'analyzer-unavailable')).toBe(true);
  });

  it('takes a scope containing replacement patterns literally', () => {
    const dc = ANALYZERS[0]!;
    expect(analyzerCommand(dc, 'a$&b$1', '/e.mjs')).toContain('--output-type=json a$&b$1');
  });

  it('builds the scope into the arguments', () => {
    const dc = ANALYZERS[0]!;
    expect(analyzerCommand(dc, 'packages/x', '/e.mjs')).toBe('node "/e.mjs" --config=.builderforce/code-analysis/dependencies.json --output-type=json packages/x');
  });
});
