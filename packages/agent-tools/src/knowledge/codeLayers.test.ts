import { describe, expect, it } from 'vitest';
import { partitionOf } from '@seanhogg/builderforce-memory/knowledge';
import { manifestEntryPaths, readEntryPaths } from './codeEntryPoints.js';
import { CODE_LAYERS, FOLDER_LAYERS, NAME_RULES, isDefaultLayers, placeLayers, placedLayerRegistry } from './codeLayers.js';
import { loadCodePartitions } from './codePack.js';
import { textDocument } from './fsDirectorySource.js';

const PATHS = [
  'src/index.ts',
  'src/routes/orders.ts',
  'src/domain/order.ts',
  'src/db/client.ts',
  'src/app/db/x.ts',
  'apps/web/app/dashboard/page.tsx',
  'src/misc/Panel.tsx',
  'src/misc/UserService.ts',
  'src/misc/helpers.ts',
  'src/misc/a.ts',
  'src/misc/b.ts',
  'src/misc/cliTool.ts',
  'src/misc/orphan.ts',
  'src/providers/ThemeProvider.tsx',
  'src/providers/stripe.ts',
  'clients/vscode/src/panel.ts',
  'src/clients/api.ts',
  'src/hooks/useThing.ts',
  'src/misc/user.ts',
  'src/misc/useThing.ts',
];
const IMPORTS: Array<[string, string]> = [
  ['src/misc/UserService.ts', 'src/misc/helpers.ts'],
  ['src/misc/helpers.ts', 'src/misc/a.ts'],
  ['src/misc/a.ts', 'src/misc/b.ts'],
];

describe('placeLayers', () => {
  const placed = placeLayers({ paths: PATHS, imports: IMPORTS, entryPaths: new Set(['src/misc/cliTool.ts']) });
  const at = (p: string) => placed.get(p);

  it('places by folder first, nearest folder wins', () => {
    expect(at('src/routes/orders.ts')).toEqual({ layer: 'presentation', rule: 'folder' });
    expect(at('src/domain/order.ts')).toEqual({ layer: 'domain', rule: 'folder' });
    expect(at('src/db/client.ts')).toEqual({ layer: 'infrastructure', rule: 'folder' });
    expect(at('src/app/db/x.ts')).toEqual({ layer: 'infrastructure', rule: 'folder' });
    expect(at('src/providers/stripe.ts')).toEqual({ layer: 'infrastructure', rule: 'folder' });
  });

  it('places package entry points as entry, by name, even inside a presentation folder', () => {
    expect(at('src/index.ts')).toEqual({ layer: 'entry', rule: 'name' });
    expect(at('apps/web/app/dashboard/page.tsx')).toEqual({ layer: 'entry', rule: 'name' });
    expect(at('src/misc/cliTool.ts')).toEqual({ layer: 'entry', rule: 'name' });
  });

  it('places by file name when no folder says, and a component file is a view whatever folder holds it', () => {
    expect(at('src/misc/Panel.tsx')).toEqual({ layer: 'presentation', rule: 'name' });
    expect(at('src/misc/UserService.ts')).toEqual({ layer: 'application', rule: 'name' });
    expect(at('src/providers/ThemeProvider.tsx')).toEqual({ layer: 'presentation', rule: 'name' });
  });

  it('treats a top-level clients/ folder as no layer, but a nested one as application', () => {
    expect(at('clients/vscode/src/panel.ts')).toBeUndefined();
    expect(at('src/clients/api.ts')).toEqual({ layer: 'application', rule: 'folder' });
  });

  it('a hook is `use` + a capital, not any file that starts with use', () => {
    expect(at('src/misc/useThing.ts')).toEqual({ layer: 'presentation', rule: 'name' });
    expect(at('src/misc/user.ts')).toBeUndefined();
  });

  it('places the rest one layer below their importers, settling chains, clamped at the bottom', () => {
    expect(at('src/misc/helpers.ts')).toEqual({ layer: 'domain', rule: 'imports' });
    expect(at('src/misc/a.ts')).toEqual({ layer: 'infrastructure', rule: 'imports' });
    expect(at('src/misc/b.ts')).toEqual({ layer: 'infrastructure', rule: 'imports' });
  });

  it('leaves a file nothing can place unplaced', () => {
    expect(at('src/misc/orphan.ts')).toBeUndefined();
  });

  it('is deterministic whatever the input order', () => {
    const again = placeLayers({ paths: [...PATHS].reverse(), imports: [...IMPORTS].reverse(), entryPaths: new Set(['src/misc/cliTool.ts']) });
    expect([...again].sort()).toEqual([...placed].sort());
  });

  it('terminates on an import cycle and places it from its anchored importer', () => {
    const cyc = placeLayers({
      paths: ['src/routes/r.ts', 'src/x/a.ts', 'src/x/b.ts'],
      imports: [['src/routes/r.ts', 'src/x/a.ts'], ['src/x/a.ts', 'src/x/b.ts'], ['src/x/b.ts', 'src/x/a.ts']],
    });
    expect(cyc.get('src/x/a.ts')).toEqual({ layer: 'application', rule: 'imports' });
    expect(cyc.get('src/x/b.ts')).toEqual({ layer: 'domain', rule: 'imports' });
  });

  it('counts a repeated import pair once', () => {
    // One presentation importer repeated twice must not outvote two domain importers.
    const dup = placeLayers({
      paths: ['src/routes/r.ts', 'src/domain/d1.ts', 'src/domain/d2.ts', 'src/lib2/shared.ts'],
      imports: [
        ['src/routes/r.ts', 'src/lib2/shared.ts'], ['src/routes/r.ts', 'src/lib2/shared.ts'],
        ['src/domain/d1.ts', 'src/lib2/shared.ts'], ['src/domain/d2.ts', 'src/lib2/shared.ts'],
      ],
    });
    expect(dup.get('src/lib2/shared.ts')).toEqual({ layer: 'infrastructure', rule: 'imports' });
  });

  it('ignores the imports of a pure re-export barrel', () => {
    const input = { paths: ['src/routes/index.ts', 'src/lib2/util.ts'], imports: [['src/routes/index.ts', 'src/lib2/util.ts']] as Array<[string, string]> };
    expect(placeLayers(input).get('src/lib2/util.ts')).toEqual({ layer: 'presentation', rule: 'imports' });
    expect(placeLayers({ ...input, barrels: new Set(['src/routes/index.ts']) }).get('src/lib2/util.ts')).toBeUndefined();
  });
});

describe('the one layer table', () => {
  it('generates CODE_LAYERS from FOLDER_LAYERS and the unguarded NAME_RULES', () => {
    for (const rule of CODE_LAYERS.partitions) {
      const layer = rule.id as keyof typeof FOLDER_LAYERS;
      for (const seg of FOLDER_LAYERS[layer]) {
        expect(rule.match.some((g) => g.includes(`/${seg}/`))).toBe(true);
      }
      for (const name of NAME_RULES.filter((r) => r.layer === layer && !r.guard)) {
        for (const g of name.globs) expect(rule.match).toContain(`**/${g}`);
      }
    }
    expect(partitionOf('src/routes/x.ts', CODE_LAYERS)).toBe('presentation');
    expect(partitionOf('clients/vscode/src/panel.ts', CODE_LAYERS)).toBeUndefined();
  });

  it('marks the default registry, and only it', () => {
    expect(isDefaultLayers(CODE_LAYERS)).toBe(true);
    expect(isDefaultLayers(loadCodePartitions())).toBe(true);
    expect(isDefaultLayers(loadCodePartitions({ partitions: [{ id: 'ui', order: 0, match: ['src/**'] }] }))).toBe(false);
    expect(isDefaultLayers(placedLayerRegistry(CODE_LAYERS))).toBe(false);
  });

  it('puts entry above the four layers, keeping their ids and orders, with no globs', () => {
    const reg = placedLayerRegistry(CODE_LAYERS);
    expect(reg.partitions.map((p) => [p.id, p.order, p.match.length])).toEqual([
      ['entry', -1, 0], ['presentation', 0, 0], ['application', 1, 0], ['domain', 2, 0], ['infrastructure', 3, 0],
    ]);
    expect(reg.allow?.['presentation']).toEqual(CODE_LAYERS.allow!['presentation']);
    expect(reg.allow?.['entry']).toEqual(['presentation', 'application', 'domain', 'infrastructure']);
  });
});

describe('manifest entry points', () => {
  it('collects main, bin and export targets relative to the manifest folder', () => {
    const manifests = new Map([
      ['packages/p/package.json', JSON.stringify({ main: './src/main.ts', bin: { p: './bin/p.js' }, exports: { '.': './src/index.ts', './x': { import: './src/x.ts' } } })],
      ['bad/package.json', '{nope'],
    ]);
    expect([...manifestEntryPaths(manifests)].sort()).toEqual([
      'packages/p/bin/p.js', 'packages/p/src/index.ts', 'packages/p/src/main.ts', 'packages/p/src/x.ts',
    ]);
  });

  it('readEntryPaths reads only package manifests through the source', async () => {
    const source = {
      read: async (path: string) => textDocument('r', path, path === 'package.json' ? '{"main":"./lib/start.js"}' : 'x'),
    };
    expect([...await readEntryPaths(source, ['package.json', 'src/a.ts'])]).toEqual(['lib/start.js']);
  });
});
