import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityProvider, ShellResult } from '../capabilities.js';
import { dependency, duplicates, unused } from '../knowledge/codeFixtures.test-util.js';
import type { DetectedTool, PrefetchExecHost } from './contract.js';
import {
  OPEN_KNOWLEDGE_GRAPH_COMMAND, SHARED_PREFETCH_ROWS, capOutput, detectTools, forgetCodePackFindings, offeredToolIds,
  parseCodemod, sharedPrefetchExecutors, type ToolProbe,
} from './index.js';

const npm = (id: string, bin = id): DetectedTool => ({ id, via: 'dependency', command: `npm exec --no -- ${bin}` });

interface Fake {
  host: PrefetchExecHost;
  commands: string[];
  written: Record<string, string>;
}

function fakeHost(opts: {
  tools?: Record<string, DetectedTool>;
  shell?: (command: string) => ShellResult | undefined;
  files?: (path: string) => string | undefined;
  focus?: string[];
} = {}): Fake {
  const commands: string[] = [];
  const written: Record<string, string> = {};
  const caps = {
    capabilities: new Set(),
    shell: {
      run: vi.fn(async (command: string) => {
        commands.push(command);
        return opts.shell?.(command) ?? { ok: true, exitCode: 0, stdout: '' };
      }),
    },
    repoRead: {
      listFiles: async () => ({ ok: true, paths: [] }),
      searchCode: async () => ({ ok: true, query: '', matches: [] }),
      readFile: async (path: string) => {
        const content = written[path] ?? opts.files?.(path);
        return content === undefined ? { ok: false, path, error: 'file not found' } : { ok: true, path, content };
      },
    },
    repoWrite: {
      writeFile: async (path: string, content: string) => {
        written[path] = content;
        return { ok: true, change: 'created' };
      },
      deleteFile: async () => ({ ok: true, deleted: true }),
      editFile: async () => ({ ok: true }),
    },
  } as unknown as CapabilityProvider;
  const tools = new Map(Object.entries(opts.tools ?? {}));
  return {
    host: { caps, tools: () => tools, rootId: 'r', ...(opts.focus ? { focusFiles: () => opts.focus! } : {}) },
    commands,
    written,
  };
}

const signal = () => new AbortController().signal;

afterEach(() => forgetCodePackFindings());

describe('detectTools', () => {
  const probe = (files: Record<string, string>, onPath: string[]): ToolProbe => ({
    readText: async (p) => files[p],
    exists: async (p) => p in files,
    onPath: async (bin) => onPath.includes(bin),
  });

  it('reads package.json deps and devDeps, the PATH and the lockfile, and resolves the groups', async () => {
    const tools = await detectTools(probe({
      'package.json': JSON.stringify({ dependencies: { prisma: '5' }, devDependencies: { eslint: '9', prettier: '3', jscpd: '4' } }),
      'pnpm-lock.yaml': '',
    }, ['gitleaks', 'ruff']));
    expect(tools.get('eslint')).toEqual({ id: 'eslint', via: 'dependency', command: 'npm exec --no -- eslint' });
    expect(tools.get('gitleaks')).toEqual({ id: 'gitleaks', via: 'path', command: 'gitleaks' });
    expect(tools.get('npm-audit')).toEqual({ id: 'npm-audit', via: 'lockfile', command: 'pnpm audit' });
    // A group points at the first present member, in preference order.
    expect(tools.get('linter')?.id).toBe('eslint');
    expect(tools.get('formatter')?.id).toBe('prettier');
    expect(tools.get('dependency-audit')?.id).toBe('npm-audit');
    expect(tools.has('vitest')).toBe(false);
    expect(offeredToolIds(tools, ['ide-templates']).has('ide-templates')).toBe(true);
  });

  it('every shared row that needs a tool names one detection can report', () => {
    const known = new Set(['linter', 'formatter', 'dependency-audit', 'openapi-codegen', 'jscpd', 'knip', 'dependency-cruiser', 'gitleaks', 'vitest', 'plop', 'hygen', 'prisma', 'graphql-codegen', 'ast-grep', 'ide-templates']);
    for (const row of SHARED_PREFETCH_ROWS) if (row.requires) expect(known.has(row.requires.tool), row.id).toBe(true);
    // A write row is always an ANSWER (a prefetch never asks).
    for (const row of SHARED_PREFETCH_ROWS) if (row.sideEffect === 'write') expect(row.kind, row.id).toBe('answer');
  });
});

describe('shared executors', () => {
  it('skip when their tool is missing — nothing runs', async () => {
    const { host, commands } = fakeHost();
    const ex = sharedPrefetchExecutors(host);
    for (const id of ['lint.check', 'deps.audit', 'secrets.scan', 'tests.related', 'lint.fix', 'format.apply', 'codegen.prisma']) {
      expect(await ex[id]!.run('x', signal()), id).toBeUndefined();
    }
    expect(commands).toEqual([]);
  });

  it('never start a command once the deadline or Stop fired', async () => {
    const { host, commands } = fakeHost({ tools: { linter: npm('eslint') } });
    const ctl = new AbortController();
    ctl.abort();
    expect(await sharedPrefetchExecutors(host)['lint.check']!.run('lint errors', ctl.signal)).toBeUndefined();
    expect(commands).toEqual([]);
  });

  it('lint.check reports ESLint findings for the focus files, capped', async () => {
    const report = [{ filePath: 'src/a.ts', messages: [{ line: 3, column: 1, severity: 2, message: 'no-unused', ruleId: 'no-unused-vars' }] }];
    const { host, commands } = fakeHost({ tools: { linter: npm('eslint') }, focus: ['src/a.ts', 'README.md'], shell: () => ({ ok: false, exitCode: 1, stdout: JSON.stringify(report) }) });
    const out = await sharedPrefetchExecutors(host)['lint.check']!.run('lint errors', signal());
    expect(commands).toEqual(['npm exec --no -- eslint --format json "src/a.ts"']);
    expect(out?.text).toContain('1 error(s)');
    expect(out?.text).toContain('src/a.ts:3:1 error no-unused (no-unused-vars)');
    expect(capOutput('x'.repeat(20_000)).length).toBeLessThan(8_100);
  });

  it('secrets.scan names rule, file and line only — never the value', async () => {
    const leak = [{ RuleID: 'aws-key', File: 'src/env.ts', StartLine: 4, Secret: 'AKIASECRETVALUE', Match: 'AKIASECRETVALUE' }];
    const { host } = fakeHost({ tools: { gitleaks: { id: 'gitleaks', via: 'path', command: 'gitleaks' } }, files: (p) => (p.endsWith('gitleaks.json') ? JSON.stringify(leak) : undefined) });
    const out = await sharedPrefetchExecutors(host)['secrets.scan']!.run('/secrets', signal());
    expect(out?.text).toContain('src/env.ts:4 aws-key');
    expect(out?.text).not.toContain('AKIASECRETVALUE');
  });

  it('codemod patterns travel in a rule file, not on the command line', async () => {
    expect(parseCodemod('console.log($A) => logger.info($A)')).toEqual({ pattern: 'console.log($A)', rewrite: 'logger.info($A)', language: 'TypeScript' });
    const { host, commands, written } = fakeHost({ tools: { 'ast-grep': npm('ast-grep') } });
    await sharedPrefetchExecutors(host)['codemod.pattern']!.run('/codemod foo("$(rm -rf /)") => bar()', signal());
    expect(commands).toEqual(['npm exec --no -- ast-grep scan --rule .builderforce/code-analysis/codemod-rule.yml --update-all .']);
    expect(written['.builderforce/code-analysis/codemod-rule.yml']).toContain('pattern: "foo(\\"$(rm -rf /)\\")"');
  });
});

describe('code-pack actions', () => {
  /** The analyzers' outputs as the runner reads them: depcruise and knip on stdout, jscpd as its report file. */
  const analyzers = (opts: { jscpdFails?: boolean } = {}) => fakeHost({
    tools: { jscpd: npm('jscpd'), knip: npm('knip'), 'dependency-cruiser': npm('dependency-cruiser', 'depcruise') },
    shell: (command) => {
      if (command.includes('depcruise')) return { ok: true, exitCode: 0, stdout: JSON.stringify(dependency) };
      if (command.includes('knip')) return { ok: true, exitCode: 0, stdout: JSON.stringify(unused) };
      if (command.startsWith('git ')) return { ok: false, exitCode: 128, stdout: '' };
      return undefined;
    },
    files: (p) => (p.endsWith('jscpd-report.json') && !opts.jscpdFails ? JSON.stringify(duplicates) : undefined),
  });

  it('/dup counts the code pack\'s clone-group findings and offers Open in graph', async () => {
    const { host } = analyzers();
    const out = await sharedPrefetchExecutors(host)['dup.check']!.run('/dup', signal());
    expect(out?.text).toContain('1 duplicate-code group(s)');
    expect(out?.chips).toEqual([{ labelKey: 'prefetch.chip.openInGraph', command: OPEN_KNOWLEDGE_GRAPH_COMMAND, args: { focus: ['src:r::src/a.ts', 'src:r::src/b.ts'] } }]);
    expect(out?.data).toMatchObject({ findings: 1 });
  });

  it('one analysis answers the next code-pack question, and cycles + dead code read the same graph', async () => {
    const { host, commands } = analyzers();
    const ex = sharedPrefetchExecutors(host);
    await ex['dup.check']!.run('/dup', signal());
    const ran = commands.length;
    expect((await ex['deps.cycles']!.run('/cycles', signal()))?.text).toContain('1 import cycle(s)');
    expect((await ex['deadcode.check']!.run('/deadcode', signal()))?.text).toContain('unused-code finding(s)');
    expect(commands.length).toBe(ran);
  });

  it('a failed analyzer answers nothing — missing output is never reported clean', async () => {
    const { host } = analyzers({ jscpdFails: true });
    expect(await sharedPrefetchExecutors(host)['dup.check']!.run('/dup', signal())).toBeUndefined();
  });
});
