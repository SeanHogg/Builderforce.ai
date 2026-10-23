/** Ports of bf-index `repo_map.rs` tests, plus the streaming builder end to end. */
import { describe, expect, it } from 'vitest';
import { FileGraph, type ImportRow, type RefRow } from './graph.js';
import { CHARS_PER_TOKEN, renderRepoMap } from './render.js';
import { RepoGraph, RepoGraphBuilder, type MapSymbol } from './repoGraph.js';
import { searchRepoSymbols } from './search.js';

interface Rows { paths: string[]; symbols: MapSymbol[]; refs: RefRow[]; imports: ImportRow[] }
const rows = (): Rows => ({ paths: [], symbols: [], refs: [], imports: [] });
const sym = (name: string, path: string, line = 1): MapSymbol => ({ name, path, line, signature: `function ${name}()`, nested: false });
const uses = (rs: Rows, users: string[], name: string, def: string): void => {
  for (const u of users) rs.refs.push({ from: u, ident: name, to: def });
};
const repoOf = (rs: Rows): RepoGraph =>
  new RepoGraph(FileGraph.build([...rs.paths, ...rs.symbols.map((s) => s.path)], rs.refs, rs.imports), rs.symbols, { files: 0, bytes: 0, truncated: false });
const pos = (map: string, path: string): number => {
  const i = map.indexOf(`${path}\n`);
  if (i < 0) throw new Error(`${path} missing from map:\n${map}`);
  return i;
};
const range = (n: number, f: (i: number) => string): string[] => Array.from({ length: n }, (_, i) => f(i));

describe('renderRepoMap (mirror of bf-index repo_map.rs)', () => {
  it('ranks the core module the important files depend on above a hub util', () => {
    const rs = rows();
    for (let i = 0; i < 10; i += 1) rs.symbols.push(sym(`helper${i}`, 'src/util.ts'));
    rs.symbols.push(sym('Engine', 'src/core.ts'));
    const leaves = range(2, (i) => `scripts/leaf${i}.ts`);
    const svcs = range(4, (i) => `src/svc${i}.ts`);
    const apps = range(8, (i) => `app/page${i}.ts`);
    for (let i = 0; i < 10; i += 1) uses(rs, leaves, `helper${i}`, 'src/util.ts');
    uses(rs, svcs, 'Engine', 'src/core.ts');
    svcs.forEach((svc, i) => {
      rs.symbols.push(sym(`service${i}`, svc));
      uses(rs, apps, `service${i}`, svc);
    });
    for (const p of [...leaves, ...apps]) rs.symbols.push(sym('run', p));
    const map = renderRepoMap(repoOf(rs), { maxTokens: 4000 });
    expect(pos(map, 'src/core.ts')).toBeLessThan(pos(map, 'src/util.ts'));
  });

  it('resolves a same-name collision to the imported definer', () => {
    const rs = rows();
    rs.symbols.push(sym('Config', 'app/config.ts'), sym('Config', 'core/config.ts'));
    range(3, (i) => `core/user${i}.ts`).forEach((u, i) => {
      rs.symbols.push(sym(`user${i}`, u));
      rs.imports.push([u, 'config']);
      rs.refs.push({ from: u, ident: 'Config', to: 'app/config.ts' }, { from: u, ident: 'Config', to: 'core/config.ts' });
    });
    const map = renderRepoMap(repoOf(rs), { maxTokens: 4000 });
    expect(pos(map, 'core/config.ts')).toBeLessThan(pos(map, 'app/config.ts'));
  });

  it('orders symbols within a file by in-degree', () => {
    const rs = rows();
    rs.symbols.push(sym('rare', 'lib.ts', 1), sym('popular', 'lib.ts', 9));
    const users = range(3, (i) => `u${i}.ts`);
    uses(rs, users, 'popular', 'lib.ts');
    uses(rs, users.slice(0, 1), 'rare', 'lib.ts');
    rs.paths = users;
    const map = renderRepoMap(repoOf(rs), { maxTokens: 1000 });
    expect(map.indexOf('popular')).toBeLessThan(map.indexOf('rare'));
  });

  it('respects the budget', () => {
    const rs = rows();
    rs.symbols = range(50, (i) => `f${i}`).map((n, i) => sym(n, `dir/file${i}.ts`));
    const tiny = renderRepoMap(repoOf(rs), { maxTokens: 64 });
    expect(tiny.length).toBeLessThanOrEqual(64 * CHARS_PER_TOKEN + 80);
    expect(tiny).toContain('more files');
  });

  it('ranks focus first', () => {
    const rs = rows();
    rs.symbols = [sym('core', 'a/core.ts'), sym('leaf', 'b/leaf.ts')];
    uses(rs, range(20, (i) => `a/u${i}.ts`), 'core', 'a/core.ts');
    const map = renderRepoMap(repoOf(rs), { maxTokens: 1000, focus: ['b/'] });
    expect(pos(map, 'b/leaf.ts')).toBeLessThan(pos(map, 'a/core.ts'));
  });

  it('lifts the files a query names', () => {
    const rs = rows();
    rs.symbols = [sym('alpha', 'src/alpha.ts'), sym('billingTotals', 'src/money.ts'), sym('zeta', 'src/store.ts'), sym('omega', 'src/omega.ts')];
    rs.refs = [{ from: 'x.ts', ident: 'alpha', to: 'src/alpha.ts' }, { from: 'y.ts', ident: 'omega', to: 'src/omega.ts' }];
    const plain = renderRepoMap(repoOf(rs), { maxTokens: 1000 });
    expect(pos(plain, 'src/alpha.ts')).toBeLessThan(pos(plain, 'src/store.ts'));
    const map = renderRepoMap(repoOf(rs), { maxTokens: 1000, query: 'fix the store eviction, then check `billingTotals`' });
    expect(pos(map, 'src/store.ts')).toBeLessThan(pos(map, 'src/alpha.ts'));
    expect(pos(map, 'src/money.ts')).toBeLessThan(pos(map, 'src/omega.ts'));
  });
});

describe('RepoGraphBuilder end to end', () => {
  const files: Record<string, string> = {
    'src/core/engine.ts': 'export class Engine {\n  start() {\n    return 1;\n  }\n}\n',
    'src/svc/a.ts': "import { Engine } from '../core/engine';\nexport function serviceA() { return new Engine(); }\n",
    'src/svc/b.ts': "import { Engine } from '../core/engine';\n// Engine in a comment only counts once\nexport function serviceB() { return new Engine(); }\n",
    'app/page.ts': "import { serviceA } from '../src/svc/a';\nimport { serviceB } from '../src/svc/b';\nexport const page = () => serviceA() && serviceB();\n",
    'README.md': '# Engine\n',
  };

  const build = (): RepoGraph => {
    const b = new RepoGraphBuilder();
    for (const [path, content] of Object.entries(files)) b.addFile(path, content);
    return RepoGraph.fromJSON(JSON.parse(JSON.stringify(b.build())));
  };

  it('ranks the shared dependency first and renders bf-index format', () => {
    const map = renderRepoMap(build(), { maxTokens: 1000 });
    expect(map.startsWith('src/core/engine.ts\n  1: export class Engine {\n    2: start() {\n')).toBe(true);
    expect(map).not.toContain('README.md');
  });

  it('keyword-searches definitions by identifier parts', () => {
    const hits = searchRepoSymbols(build(), 'where is serviceB', { limit: 3 });
    expect(hits[0]).toMatchObject({ path: 'src/svc/b.ts', symbol: 'serviceB', line: 3 });
    expect(searchRepoSymbols(build(), 'engine', { limit: 5, scope: 'app' })).toEqual([]);
  });
});
