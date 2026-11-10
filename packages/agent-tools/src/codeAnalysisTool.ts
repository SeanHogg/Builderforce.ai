import type { PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';
import { defineTool, type ToolDefinition } from './tool.js';
import { shellRunWithStop } from './git-repo-scope.js';
import { normalizeAnalysis, type CodeAnalysisSnapshot } from './codeAnalysis.js';
import { toDependencyCruiserRules } from './knowledge/dependencyCruiserRules.js';
import { ANALYZER_VERSIONS, TYPESCRIPT_PIN } from './analyzerPins.js';
import { GIT, gitText, workspaceFingerprint } from './knowledge/workspaceFingerprint.js';

/** The ONE place the analyzer versions are pinned (reported in every analysis record; comparability checks them). */
export { TYPESCRIPT_PIN };
export type AnalyzerName = 'dependency-cruiser' | 'jscpd' | 'knip';
export interface AnalyzerSpec {
  name: AnalyzerName;
  version: string;
  /** npm packages the fallback `npm exec` downloads (hosts without bundled analyzers: cloud images, on-prem). */
  packages: readonly string[];
  bin: string;
  /** Arguments after the binary; `{scope}` is the directory it analyses. */
  args: string;
  /** The `npm exec` form. Never used on a host that bundles its analyzers (see {@link setBundledAnalyzers}). */
  command: string;
}

function spec(name: AnalyzerName, version: string, extraPackages: readonly string[], bin: string, args: string): AnalyzerSpec {
  const packages = [`${name}@${version}`, ...extraPackages];
  return { name, version, packages, bin, args, command: analyzerCommand({ packages, bin, args }, '.') };
}

export const ANALYZERS: readonly AnalyzerSpec[] = [
  spec('dependency-cruiser', ANALYZER_VERSIONS['dependency-cruiser'], [TYPESCRIPT_PIN], 'depcruise', '--config=.builderforce/code-analysis/dependencies.json --output-type=json {scope}'),
  spec('jscpd', ANALYZER_VERSIONS.jscpd, [], 'jscpd', '--silent --reporters=json --min-lines=5 --min-tokens=50 --ignore=**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.builderforce/** --output=.builderforce/code-analysis {scope}'),
  spec('knip', ANALYZER_VERSIONS.knip, [TYPESCRIPT_PIN], 'knip', '--reporter=json --no-progress'),
];

/** The entry script of each analyzer a host bundles (absolute path, forward slashes). */
export type BundledAnalyzerEntries = Partial<Record<AnalyzerName, string>>;
let bundled: BundledAnalyzerEntries | undefined;

/**
 * A host that SHIPS the analyzers (the VSIX, PRD 41 A3) registers their entry scripts once. From then on
 * every analyzer launch on this host is `node <entry> …`; `npm exec` and its download are never used, and
 * an analyzer with no entry (or one that fails to start) is `not_measured` / `analyzer-unavailable`.
 */
export function setBundledAnalyzers(entries: BundledAnalyzerEntries | undefined): void {
  bundled = entries;
}
export function bundledAnalyzers(): BundledAnalyzerEntries | undefined {
  return bundled;
}

/** The launch command for an analyzer over `scope`: the bundled entry when given, else the pinned `npm exec`. */
export function analyzerCommand(a: Pick<AnalyzerSpec, 'packages' | 'bin' | 'args'>, scope: string, entry?: string): string {
  // A replacer function: a scope containing `$&` or `$1` is taken literally, never as a replacement pattern.
  const args = a.args.replace('{scope}', () => scope);
  return entry ? `node "${entry}" ${args}` : `npm exec --yes ${a.packages.map((p) => `--package=${p}`).join(' ')} --call="${a.bin} ${args}"`;
}

const knipSpec = (): AnalyzerSpec => ANALYZERS.find((a) => a.name === 'knip')!;

/** The pinned knip invocation that only REPORTS (JSON on stdout) and changes nothing: what a re-scan and a fix preview read. */
export function knipReportCommand(): string {
  return analyzerCommand(knipSpec(), '.', bundled?.knip);
}

/**
 * The pinned knip invocation that DELETES the project's unused files (`--fix --fix-type files`).
 * Unused exports are never fixed through knip (it removes every unused export of a file at once);
 * that fix is the per-export remover (`removeExportFromSource`, `./node-symbols`).
 */
export function knipRemoveFilesCommand(): string {
  return knipReportCommand().replace('--reporter=json --no-progress', '--fix --fix-type files --allow-remove-files --no-progress');
}

/** npm diagnostics may surround JSON in a shell's combined stdout/stderr stream. */
export function parseAnalyzerJson(text: string): any {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('No JSON report in analyzer output');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('Truncated analyzer JSON report');
}

/** The dependency-cruiser configuration the runner writes: the exclusions, plus the layer
 *  rules generated from `partitions` (PRD 38 §4.4) when a registry is passed. */
export function dependencyCruiserConfig(partitions?: PartitionRegistry): Record<string, unknown> {
  const forbidden = partitions ? toDependencyCruiserRules(partitions) : [];
  return {
    ...(forbidden.length ? { forbidden } : {}),
    options: { exclude: { path: '(^|/)(node_modules|[.]git|[.]builderforce|dist|out|build)(/|$)' } },
  };
}

/** UTF-8 → base64, so generated JSON (regexes, quotes, `$`) crosses the shell untouched. */
function base64Utf8(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface AnalyzeCodebaseOptions {
  /** Layer registry whose disallowed pairs become dependency-cruiser `forbidden` rules. */
  partitions?: PartitionRegistry;
  /** Told each time one analyzer tool has settled (complete, failed or not measured), in order: the run's progress. */
  onToolSettled?(): void;
}

export function createAnalyzeCodebaseTool(options: AnalyzeCodebaseOptions = {}): ToolDefinition {
  const configBase64 = base64Utf8(JSON.stringify(dependencyCruiserConfig(options.partitions)));
  return defineTool({
    name: 'analyze_codebase',
    description: 'Measure JS/TS dependency edges and cycles with dependency-cruiser, duplicate code with jscpd, and unused-file/export/dependency candidates with Knip. Runs the analyzers bundled with the host when it ships them, else downloads the pinned packages through npm cache on first use; an analyzer that cannot start is reported not_measured, never as zero findings. Writes per-scan artifacts under .builderforce/code-analysis. The audit host saves the full snapshot for the visualizer; cloud images return a bounded summary after upload. Report findings normally after this tool. Preserve failed-tool coverage; do not claim missing results are clean.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative project/package directory; use a smaller package for large monorepos. Defaults to repository root.' } } },
    requires: ['shell', 'repo.read'],
    async execute(args, ctx) {
      const scope = typeof args.path === 'string' ? args.path : '.';
      if (!/^[a-zA-Z0-9_.][a-zA-Z0-9_./-]*$/.test(scope) || scope.split('/').includes('..')) return { data: { error: 'path must be a relative project directory without traversal or shell syntax' } };
      const tools: CodeAnalysisSnapshot['tools'] = [];
      const id = crypto.randomUUID();
      const outputDir = `.builderforce/code-analysis/${id}`;
      const outputs: unknown[] = [];
      const entries = bundledAnalyzers();
      // Every analyzer leaves exactly one entry in `tools` (many paths `continue`), so a settled one is seen as the next starts and after the loop.
      let settledTold = 0;
      const tellSettled = () => { while (settledTold < tools.length) { settledTold++; options.onToolSettled?.(); } };
      for (const analyzer of ANALYZERS) {
        tellSettled();
        const entry = entries?.[analyzer.name];
        // A host that bundles its analyzers never downloads one: a missing entry is "not measured", never zero findings.
        if (entries && !entry) {
          outputs.push(null); tools.push({ name: analyzer.name, version: analyzer.version, status: 'not_measured', reason: 'analyzer-unavailable' });
          continue;
        }
        let launched = false;
        try {
          // A bundled analyzer whose host cannot even run `node` for setup did not start: not measured, not a failure.
          const setupFailed = (message: string) => {
            if (entry) return 'unavailable' as const;
            throw new Error(message);
          };
          let unavailable: 'unavailable' | undefined;
          if (analyzer.name === 'dependency-cruiser') {
            const config = await shellRunWithStop(ctx, `node -e "const f=require('fs');f.mkdirSync('${outputDir}',{recursive:true});f.writeFileSync('${outputDir}/dependencies.json',Buffer.from('${configBase64}','base64'))"`);
            if (!config.ok) unavailable = setupFailed('Could not create dependency analysis configuration');
          }
          // Unique output directories prevent stale artifacts and cross-run interference.
          if (analyzer.name === 'jscpd') {
            const cleanup = await shellRunWithStop(ctx, `node -e "require('fs').mkdirSync('${outputDir}',{recursive:true})"`);
            if (!cleanup.ok) unavailable = setupFailed('Could not clear the previous duplication artifact');
          }
          if (unavailable) {
            outputs.push(null); tools.push({ name: analyzer.name, version: analyzer.version, status: 'not_measured', reason: 'analyzer-unavailable' });
            continue;
          }
          // Knip analyses the directory it RUNS in, so the scope is its working directory (the shell's
          // `cwd`) rather than a `cd` written into the command; the others take the scope as an argument.
          const command = analyzerCommand(analyzer, scope, entry);
          const result = await shellRunWithStop(ctx, command.replaceAll('.builderforce/code-analysis', outputDir), analyzer.name === 'knip' && scope !== '.' ? scope : undefined);
          launched = true;
          const artifact = analyzer.name === 'jscpd' ? await ctx.caps.repoRead!.readFile(`${outputDir}/jscpd-report.json`) : undefined;
          const text = artifact ? artifact.content : result.stdout;
          // A bundled analyzer that produced nothing did not start (a broken install), which is not "no findings".
          if (entry && !text) {
            outputs.push(null); tools.push({ name: analyzer.name, version: analyzer.version, status: 'not_measured', reason: 'analyzer-unavailable' });
            continue;
          }
          if (!text || artifact?.truncated) throw new Error('Analyzer output is empty or truncated; scan a smaller project');
          const value = parseAnalyzerJson(text);
          if (analyzer.name === 'dependency-cruiser' && !Array.isArray(value.modules)) throw new Error('Invalid dependency report');
          if (analyzer.name === 'jscpd' && !Array.isArray(value.duplicates)) throw new Error('Invalid duplication report');
          if (analyzer.name === 'knip' && (!Array.isArray(value.files) || !Array.isArray(value.issues))) throw new Error('Invalid unused-code report');
          const unresolved = analyzer.name === 'dependency-cruiser' ? value.modules.flatMap((m: { dependencies?: Array<{ couldNotResolve?: boolean }> }) => m.dependencies ?? []).filter((d: { couldNotResolve?: boolean }) => d.couldNotResolve).length : 0;
          outputs.push(value); tools.push({ name: analyzer.name, version: analyzer.version, status: unresolved ? 'failed' : 'complete', ...(unresolved ? { error: `${unresolved} imports could not be resolved; graph coverage is incomplete.` } : {}) });
        } catch (error) {
          // A bundled analyzer whose setup or spawn threw never started: not measured (like one that prints nothing), not failed.
          if (entry && !launched) {
            outputs.push(null); tools.push({ name: analyzer.name, version: analyzer.version, status: 'not_measured', reason: 'analyzer-unavailable' });
            continue;
          }
          outputs.push(null); tools.push({ name: analyzer.name, version: analyzer.version, status: 'failed', error: String(error).slice(0, 1000) });
        }
      }
      tellSettled();
      const { commit, branch, dirty, dirtyHash } = await workspaceFingerprint(ctx);
      const remote = (await gitText(ctx, `${GIT} remote get-url origin`))?.trim().replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '');
      const repository = remote && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(remote) ? remote : undefined;
      const snapshot: CodeAnalysisSnapshot = { version: 1, id, capturedAt: new Date().toISOString(),
        source: { commit, branch, scope, dirty, ...(dirtyHash ? { dirtyHash } : {}), ...(repository ? { repository } : {}) }, tools,
        ...normalizeAnalysis(outputs[0], outputs[1], outputs[2], scope),
      };
      return { data: { snapshot } };
    },
  });
}

/** The runner with no layer rules — the `analyze_codebase` tool every surface registers. */
export const analyzeCodebaseTool = createAnalyzeCodebaseTool();

/** What the model reads once the full snapshot is saved for the visualizer — a bounded
 *  summary, never the whole graph. */
export function savedCodeAnalysisSummary(snapshot: CodeAnalysisSnapshot) {
  return { ok: true, artifactSaved: true, snapshotId: snapshot.id, tools: snapshot.tools,
    files: snapshot.nodes.length, dependencies: snapshot.edges.length, findings: snapshot.issues.length };
}

