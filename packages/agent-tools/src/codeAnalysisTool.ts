import type { PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';
import { defineTool, type ToolDefinition } from './tool.js';
import { normalizeAnalysis, type CodeAnalysisSnapshot } from './codeAnalysis.js';
import { toDependencyCruiserRules } from './knowledge/dependencyCruiserRules.js';

export const ANALYZERS = [
  { name: 'dependency-cruiser', version: '16.10.4', command: 'npm exec --yes --package=dependency-cruiser@16.10.4 --package=typescript@5.6.3 --call="depcruise --config=.builderforce/code-analysis/dependencies.json --output-type=json ."' },
  { name: 'jscpd', version: '4.0.5', command: 'npm exec --yes --package=jscpd@4.0.5 --call="jscpd --silent --reporters=json --min-lines=5 --min-tokens=50 --ignore=**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.builderforce/** --output=.builderforce/code-analysis ."' },
  { name: 'knip', version: '5.30.0', command: 'npm exec --yes --package=knip@5.30.0 --package=typescript@5.6.3 --call="knip --reporter=json --no-progress"' },
] as const;

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
}

export function createAnalyzeCodebaseTool(options: AnalyzeCodebaseOptions = {}): ToolDefinition {
  const configBase64 = base64Utf8(JSON.stringify(dependencyCruiserConfig(options.partitions)));
  return defineTool({
    name: 'analyze_codebase',
    description: 'Measure JS/TS dependency edges and cycles with dependency-cruiser, duplicate code with jscpd, and unused-file/export/dependency candidates with Knip. Downloads pinned analyzer packages through npm cache on first use. Writes per-scan artifacts under .builderforce/code-analysis. The audit host saves the full snapshot for the visualizer; cloud images return a bounded summary after upload. Report findings normally after this tool. Preserve failed-tool coverage; do not claim missing results are clean.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative project/package directory; use a smaller package for large monorepos. Defaults to repository root.' } } },
    requires: ['shell', 'repo.read'],
    async execute(args, ctx) {
      const scope = typeof args.path === 'string' ? args.path : '.';
      if (!/^[a-zA-Z0-9_.][a-zA-Z0-9_./-]*$/.test(scope) || scope.split('/').includes('..')) return { data: { error: 'path must be a relative project directory without traversal or shell syntax' } };
      const tools: CodeAnalysisSnapshot['tools'] = [];
      const id = crypto.randomUUID();
      const outputDir = `.builderforce/code-analysis/${id}`;
      const outputs: unknown[] = [];
      for (const analyzer of ANALYZERS) {
        try {
          if (analyzer.name === 'dependency-cruiser') {
            const config = await ctx.caps.shell!.run(`node -e "const f=require('fs');f.mkdirSync('${outputDir}',{recursive:true});f.writeFileSync('${outputDir}/dependencies.json',Buffer.from('${configBase64}','base64'))"`);
            if (!config.ok) throw new Error('Could not create dependency analysis configuration');
          }
          // Unique output directories prevent stale artifacts and cross-run interference.
          if (analyzer.name === 'jscpd') {
            const cleanup = await ctx.caps.shell!.run(`node -e "require('fs').mkdirSync('${outputDir}',{recursive:true})"`);
            if (!cleanup.ok) throw new Error('Could not clear the previous duplication artifact');
          }
          const command = analyzer.name === 'knip'
            ? (scope === '.' ? analyzer.command : analyzer.command.replace('knip --reporter', `cd ${scope} && knip --reporter`))
            : analyzer.command.replace(/ \."$/, ` ${scope}"`);
          const result = await ctx.caps.shell!.run(command.replaceAll('.builderforce/code-analysis', outputDir));
          const artifact = analyzer.name === 'jscpd' ? await ctx.caps.repoRead!.readFile(`${outputDir}/jscpd-report.json`) : undefined;
          const text = artifact ? artifact.content : result.stdout;
          if (!text || artifact?.truncated) throw new Error('Analyzer output is empty or truncated; scan a smaller project');
          const value = parseAnalyzerJson(text);
          if (analyzer.name === 'dependency-cruiser' && !Array.isArray(value.modules)) throw new Error('Invalid dependency report');
          if (analyzer.name === 'jscpd' && !Array.isArray(value.duplicates)) throw new Error('Invalid duplication report');
          if (analyzer.name === 'knip' && (!Array.isArray(value.files) || !Array.isArray(value.issues))) throw new Error('Invalid unused-code report');
          const unresolved = analyzer.name === 'dependency-cruiser' ? value.modules.flatMap((m: { dependencies?: Array<{ couldNotResolve?: boolean }> }) => m.dependencies ?? []).filter((d: { couldNotResolve?: boolean }) => d.couldNotResolve).length : 0;
          outputs.push(value); tools.push({ name: analyzer.name, version: analyzer.version, status: unresolved ? 'failed' : 'complete', ...(unresolved ? { error: `${unresolved} imports could not be resolved; graph coverage is incomplete.` } : {}) });
        } catch (error) {
          outputs.push(null); tools.push({ name: analyzer.name, version: analyzer.version, status: 'failed', error: String(error).slice(0, 1000) });
        }
      }
      const git = async (command: string) => {
        try { const r = await ctx.caps.shell!.run(command); return r.exitCode === 0 ? (r.stdout ?? '').trim() : null; } catch { return null; }
      };
      const commit = await git('git rev-parse HEAD');
      const branch = await git('git branch --show-current');
      const dirty = await git('git status --porcelain --untracked-files=all');
      const sourceChanges = dirty?.split('\n').filter((line) => line.trim() && !line.slice(3).replace(/^"|"$/g, '').startsWith('.builderforce/code-analysis/'));
      const remote = (await git('git remote get-url origin'))?.replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '');
      const repository = remote && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(remote) ? remote : undefined;
      const snapshot: CodeAnalysisSnapshot = { version: 1, id, capturedAt: new Date().toISOString(),
        source: { commit, branch, scope, dirty: dirty === null ? null : !!sourceChanges?.length, ...(repository ? { repository } : {}) }, tools,
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

