/** Portable analyzer artifacts consumed by every audit surface. No filesystem or UI dependencies. */
export interface AnalysisLocation { path: string; startLine: number; endLine: number }
export interface AnalysisIssue { id: string; kind: 'duplicate' | 'unused-file' | 'unused-export' | 'unused-dependency'; locations: AnalysisLocation[]; symbol?: string; snippet?: string }
export interface CodeAnalysisSnapshot {
  version: 1;
  id: string;
  capturedAt: string;
  source: { commit: string | null; branch: string | null; dirty: boolean | null; repository?: string; scope?: string };
  tools: Array<{ name: string; version: string; status: 'complete' | 'failed'; error?: string }>;
  nodes: string[];
  edges: Array<{ from: string; to: string; circular: boolean }>;
  issues: AnalysisIssue[];
}
export interface CodeAnalysisComparison { current: CodeAnalysisSnapshot; baseline?: CodeAnalysisSnapshot }
const record = (v: unknown): Record<string, any> => v && typeof v === 'object' ? v as Record<string, any> : {};
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const path = (v: unknown) => String(v ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const line = (v: unknown) => Math.max(1, Number(v) || 1);
const hash = (value: string) => { let n = BigInt('14695981039346656037'); const prime = BigInt('1099511628211'); for (let i = 0; i < value.length; i++) n = BigInt.asUintN(64, (n ^ BigInt(value.charCodeAt(i))) * prime); return n.toString(16); };

export function normalizeAnalysis(dependencies: unknown, duplicates: unknown, unused: unknown, scope = '.'): Pick<CodeAnalysisSnapshot, 'nodes' | 'edges' | 'issues'> {
  const unusedPath = (value: unknown) => { const file = path(value); return scope === '.' || file.startsWith(`${scope}/`) ? file : `${scope}/${file}`; };
  const nodes = new Set<string>();
  const edges = new Map<string, { from: string; to: string; circular: boolean }>();
  for (const module of list(record(dependencies).modules)) {
    const from = path(module.source); if (!from) continue;
    nodes.add(from);
    for (const dependency of list(module.dependencies)) {
      if (dependency.couldNotResolve || dependency.coreModule || dependency.dependencyTypes?.some((t: string) => t.startsWith('npm'))) continue;
      const to = path(dependency.resolved); if (!to || to.includes('node_modules/')) continue;
      nodes.add(to); edges.set(JSON.stringify([from, to]), { from, to, circular: !!dependency.circular });
    }
  }
  const issues: AnalysisIssue[] = [];
  for (const clone of list(record(duplicates).duplicates)) {
    const locations = [clone.firstFile, clone.secondFile].map((raw) => {
      const file = record(raw); return { path: path(file.name), startLine: line(file.start), endLine: line(file.end) };
    });
    // jscpd's fragment survives line movement. Range identity is a fallback for reporters without fragments.
    locations.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.startLine - b.startLine);
    const identity = typeof clone.fragment === 'string' ? clone.fragment.replace(/\r\n/g, '\n') : locations.map((l) => `${l.path}:${l.startLine}-${l.endLine}`).sort().join('|');
    issues.push({ id: `duplicate:${hash(JSON.stringify([locations.map((l) => l.path).sort(), identity]))}`, kind: 'duplicate', locations,
      ...(typeof clone.fragment === 'string' ? { snippet: clone.fragment.slice(0, 4000) } : {}) });
  }
  for (const file of list(record(unused).files)) issues.push({ id: `unused-file:${unusedPath(file)}`, kind: 'unused-file', locations: [{ path: unusedPath(file), startLine: 1, endLine: 1 }] });
  for (const issue of list(record(unused).issues)) {
    const file = unusedPath(issue.file);
    for (const field of ['exports', 'types', 'dependencies', 'devDependencies', 'unlisted']) {
      for (const raw of list(issue[field])) {
        const item = typeof raw === 'string' ? { name: raw } : record(raw);
        const kind = field === 'exports' || field === 'types' ? 'unused-export' : 'unused-dependency';
        if (field === 'unlisted') continue; // Missing dependencies are not unused dependencies.
        issues.push({ id: `${kind}:${file}:${item.name}`, kind, symbol: String(item.name), locations: [{ path: file, startLine: line(item.line), endLine: line(item.line) }] });
      }
    }
  }
  return { nodes: [...nodes].sort(), edges: [...edges.values()], issues: [...new Map(issues.map((i) => [i.id, i])).values()] };
}

export function compareAnalysis(current: CodeAnalysisSnapshot, baseline?: CodeAnalysisSnapshot) {
  const before = new Set(baseline?.issues.map((i) => i.id) ?? []);
  const after = new Set(current.issues.map((i) => i.id));
  const complete = !!baseline && baseline.source.scope === current.source.scope && baseline.source.repository === current.source.repository && baseline.source.branch === current.source.branch && current.tools.length === 3 && baseline.tools.length === 3 && current.tools.every((tool) => tool.status === 'complete' && baseline.tools.some((old) => old.name === tool.name && old.version === tool.version && old.status === 'complete'));
  return {
    comparable: complete,
    added: complete ? current.issues.filter((i) => !before.has(i.id)) : [],
    unchanged: current.issues.filter((i) => before.has(i.id)),
    // Missing analyzer output must never be presented as a fix.
    resolved: complete ? baseline!.issues.filter((i) => !after.has(i.id)) : [],
  };
}
