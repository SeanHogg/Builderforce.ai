import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createImportScanner, loadTypeScript } from '../../../scripts/lib/moduleImports.mjs';
import { findTsconfigProjects, resolveThroughPaths, resolvesTo } from '../../../scripts/lib/tsconfigPaths.mjs';
import { readSourcePackages } from '../../../scripts/sourcePackages.mjs';

/**
 * The source-package guard counts, as a project's sources, every file OUTSIDE its
 * `include` that it reaches by relative import (`scripts/check-source-package-graph.mjs`
 * rule 3). Before it did, `clients/vscode/webview` compiled
 * `../src/pageEngineBridgeProtocol.ts` — which imports `@builderforce/local-inference` —
 * with no `paths` entry for that package, and the guard passed because it scanned only
 * `webview/src`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const ts = loadTypeScript(repoRoot);

const fixtureRoot = mkdtempSync(join(tmpdir(), 'bf-reach-'));
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function write(relative: string, text: string): string {
  const file = join(fixtureRoot, ...relative.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

describe('reachOutside', () => {
  it('follows relative imports out of the project, transitively, and no further', async () => {
    const projectSrc = join(fixtureRoot, 'app', 'src');
    write('app/src/main.ts', "import { shared } from '../../shared/protocol';\nimport './local';\nexport const x = shared;\n");
    write('app/src/local.ts', "export const local = '../not/an/import';\n");
    const protocol = write('shared/protocol.ts', "import { helper } from './helper.js';\nexport const shared = helper;\n");
    const helper = write(
      'shared/helper.ts',
      "import type { LocalRuntimeId } from '@builderforce/local-inference';\nimport { back } from '../app/src/local';\nimport dep from '../node_modules/dep/index';\nexport const helper = back as LocalRuntimeId;\n",
    );
    write('node_modules/dep/index.ts', "import '@builderforce/agent-tools';\nexport default 1;\n");
    write('shared/unreached.ts', "import '@builderforce/agent-loop';\n");

    const scanner = createImportScanner({ ts, repoRoot: fixtureRoot });
    const reached = await scanner.reachOutside([projectSrc], '@builderforce/');
    // `.js` maps onto the `.ts` source; the import back into the project and the one into
    // `node_modules` are not followed; a sibling nothing imports is not reached.
    expect(reached).toEqual([helper, protocol].sort());

    const sites = await scanner.scan([projectSrc, ...reached], '@builderforce/');
    expect(sites.map((site) => site.specifier)).toEqual(['@builderforce/local-inference']);
  });
});

describe('the webview project', () => {
  it('reaches the page-engine bridge protocol and resolves the package it imports', async () => {
    const project = findTsconfigProjects(repoRoot).find((p) => p.relative === 'clients/vscode/webview/tsconfig.json');
    expect(project).toBeDefined();

    const scanner = createImportScanner({ ts, repoRoot });
    const reached = await scanner.reachOutside(project!.sources, '@builderforce/');
    const protocol = join(repoRoot, 'clients', 'vscode', 'src', 'pageEngineBridgeProtocol.ts');
    expect(reached).toContain(protocol);

    // Every source-only package those reached files import resolves through the
    // project's own `paths` — the gap the guard used to miss.
    const entries = new Map(readSourcePackages(repoRoot).map((pkg) => [pkg.specifier, pkg.entry]));
    const sites = await scanner.scan(reached, '@builderforce/');
    const unresolved = [...new Set(sites.map((site) => site.specifier))]
      .filter((specifier) => entries.has(specifier))
      .filter((specifier) => !resolvesTo(resolveThroughPaths(project!.paths, project!.dir, specifier), entries.get(specifier)));
    expect(sites.some((site) => site.specifier === '@builderforce/local-inference')).toBe(true);
    expect(unresolved).toEqual([]);
  });
});
