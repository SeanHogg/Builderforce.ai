/**
 * knowledge/codeLayers.ts — which layer a code file belongs to (PRD 38, Option B+
 * Contract 2). Five layers, `entry` above the four of {@link CODE_LAYERS}; rules tried in
 * this order, the first that places a file wins:
 *
 *   0. entry   — package entry points (`extension.ts`, `app/**\/page.tsx`, `src/index.ts`, the
 *                targets a manifest's `main` / `bin` / `exports` name — read from the `entry`
 *                badge, never from the filesystem), by name;
 *   1. folder  — the NEAREST enclosing folder with a layer meaning (`domain/`, `db/`, `routes/` …);
 *                component files (`*.tsx` …) are views whatever folder holds them, so they
 *                are placed by name before the folder is asked;
 *   2. name    — the file's name (`useX.ts`, `*Service.ts`, `*Repository.ts` …);
 *   3. imports — an unplaced file sits one layer BELOW the most common layer of the files
 *                that import it (a pair counted once; pure re-export barrels do not vote;
 *                ties go to the higher layer; bounded passes; files nothing places stay unplaced).
 *
 * FOLDER_LAYERS and NAME_RULES are the ONE table: the static {@link CODE_LAYERS} registry
 * (the folder + name globs memory can match without a file graph) is generated from them,
 * so there is no second folder list. Pure and deterministic.
 */

import { compareStr, matchGlob, type PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';

/** Top to bottom: a file imported from layer N is placed at N + 1 when only imports place it. */
export const LAYER_IDS = ['entry', 'presentation', 'application', 'domain', 'infrastructure'] as const;
export type LayerId = (typeof LAYER_IDS)[number];
export type LayerRule = 'folder' | 'name' | 'imports';
type TableLayer = Exclude<LayerId, 'entry'>;

export interface LayerPlacement {
    layer: LayerId;
    rule: LayerRule;
}

/** Folder names (any depth) that mean a layer. The nearest folder to the file wins. */
export const FOLDER_LAYERS: Readonly<Record<TableLayer, readonly string[]>> = {
    presentation: ['routes', 'components', 'app', 'pages', 'webview', 'views', 'hooks', 'handlers', 'controllers', 'ui'],
    application: ['application', 'use-cases', 'usecases', 'services', 'lib', 'clients', 'commands', 'queries'],
    domain: ['domain', 'models', 'entities', 'types'],
    infrastructure: ['infrastructure', 'db', 'adapters', 'repositories', 'providers', 'storage', 'persistence', 'migrations'],
};

/** Folder names that are a layer only below the top level (`clients/` at the repository root holds whole products, not a service layer). */
const NOT_AT_TOP_LEVEL: ReadonlySet<string> = new Set(['clients']);

export interface NameRule {
    layer: TableLayer;
    /** Globs over the file NAME (`*Service.*`). */
    globs: readonly string[];
    /** A further test on the file name, for what a glob cannot say (`use` + a capital). Guarded rules stay out of the static registry. */
    guard?: RegExp;
    /** Asked before the folder: a component file is a view wherever it sits. */
    beatsFolder?: boolean;
}

/** File-name rules, first match wins. */
export const NAME_RULES: readonly NameRule[] = [
    { layer: 'presentation', globs: ['*.tsx', '*.jsx', '*.vue', '*.svelte'], beatsFolder: true },
    { layer: 'infrastructure', globs: ['*Repository.*', '*Adapter.*', '*Provider.*', '*Storage.*', '*Gateway.*', '*Dao.*'] },
    { layer: 'domain', globs: ['*.types.*', '*.model.*', '*.entity.*', '*Model.*', '*Entity.*', '*Types.*', 'types.*', 'models.*', 'entities.*'] },
    { layer: 'application', globs: ['*Service.*', '*UseCase.*', '*Client.*', '*Command.*', '*Query.*', '*Manager.*'] },
    { layer: 'presentation', globs: ['use*.*'], guard: /^use[A-Z]/ },
    { layer: 'presentation', globs: ['*Route.*', '*Routes.*', '*Handler.*', '*Controller.*', '*Page.*', '*View.*', '*.route.*'] },
];

/** Entry-point files by path (package roots' `index`, extension / server / worker / CLI mains, Next.js app files). */
export const ENTRY_GLOBS: readonly string[] = [
    '**/extension.{ts,js}', '**/main.{ts,js}', '**/server.{ts,js}', '**/worker.{ts,js}', '**/cli.{ts,js}', '**/bin/**',
    '**/app/**/page.{ts,tsx,js,jsx}', '**/app/**/layout.{ts,tsx,js,jsx}', '**/app/**/route.{ts,js}',
    '**/src/index.{ts,tsx,js}', 'index.{ts,js}', '**/routes/index.{ts,js}',
];

/** The default registry carries this so a host can tell it from a project's own `.builderforce/partitions.json`. */
export interface DefaultLayerRegistry extends PartitionRegistry {
    readonly layerSet: 'default';
}

export const isDefaultLayers = (registry: PartitionRegistry | undefined): registry is DefaultLayerRegistry =>
    (registry as DefaultLayerRegistry | undefined)?.layerSet === 'default';

const ALLOW: Readonly<Record<TableLayer, string[]>> = {
    presentation: ['application', 'domain'],
    application: ['domain'],
    domain: [],
    infrastructure: ['domain', 'application'],
};

const TABLE_LAYERS = Object.keys(FOLDER_LAYERS) as TableLayer[];

/** The static registry: folder + name globs, generated from the tables. Entry and import direction need a file graph (see `buildCodeGraph`). */
function defaultLayerRegistry(): DefaultLayerRegistry {
    return {
        layerSet: 'default',
        partitions: TABLE_LAYERS.map((id, order) => ({
            id,
            order,
            match: [
                ...FOLDER_LAYERS[id].map((seg) => (NOT_AT_TOP_LEVEL.has(seg) ? `**/*/${seg}/**` : `**/${seg}/**`)),
                ...NAME_RULES.filter((r) => r.layer === id && !r.guard).flatMap((r) => r.globs.map((g) => `**/${g}`)),
            ],
        })),
        allow: { ...ALLOW },
    };
}

/** The N-layer default (PRD 38 §4.4). Order 0 is the top layer; first matching layer wins. */
export const CODE_LAYERS: DefaultLayerRegistry = defaultLayerRegistry();

/**
 * The registry placements are written against: `base`'s layers plus `entry` (order -1, so the
 * four others keep their orders), with NO globs — every file's `partition` is set directly,
 * so no per-file pattern is ever compiled or cached. The `allow` map is `base`'s with `entry`
 * allowed to use every layer.
 */
export function placedLayerRegistry(base: PartitionRegistry): PartitionRegistry {
    const orderOf = (id: LayerId): number => base.partitions.find((p) => p.id === id)?.order ?? LAYER_IDS.indexOf(id) - 1;
    return {
        partitions: LAYER_IDS.map((id) => ({ id, order: orderOf(id), match: [] })),
        allow: { ...base.allow, entry: LAYER_IDS.filter((id) => id !== 'entry') },
    };
}

/** The nearest folder of `path` that means a layer. */
function folderLayer(path: string): TableLayer | undefined {
    const dirs = path.split('/').slice(0, -1);
    for (let i = dirs.length - 1; i >= 0; i--) {
        if (i === 0 && NOT_AT_TOP_LEVEL.has(dirs[0]!)) continue;
        const layer = TABLE_LAYERS.find((l) => FOLDER_LAYERS[l].includes(dirs[i]!));
        if (layer) return layer;
    }
    return undefined;
}

function nameRule(file: string, early: boolean): TableLayer | undefined {
    const rule = NAME_RULES.find((r) => !!r.beatsFolder === early && (!r.guard || r.guard.test(file)) && r.globs.some((g) => matchGlob(file, g)));
    return rule?.layer;
}

const isEntry = (path: string, entryPaths: ReadonlySet<string> | undefined): boolean =>
    !!entryPaths?.has(path) || ENTRY_GLOBS.some((g) => matchGlob(path, g));

export interface LayerInput {
    /** Root-relative paths of the code files to place. */
    paths: readonly string[];
    /** Import edges between them, `from` imports `to`. Repeats are counted once. */
    imports: ReadonlyArray<readonly [from: string, to: string]>;
    /** Entry points a manifest named (the `entry` badge). */
    entryPaths?: ReadonlySet<string>;
    /** Pure re-export barrels: their imports say nothing about layering, so they do not vote. */
    barrels?: ReadonlySet<string>;
}

/** Passes of the import-direction rule: chains settle top-down, and a cycle cannot loop. */
const IMPORT_PASSES = 6;

function placeByPath(path: string, entryPaths: ReadonlySet<string> | undefined): LayerPlacement | undefined {
    if (isEntry(path, entryPaths)) return { layer: 'entry', rule: 'name' };
    const file = path.slice(path.lastIndexOf('/') + 1);
    const component = nameRule(file, true);
    if (component) return { layer: component, rule: 'name' };
    const folder = folderLayer(path);
    if (folder) return { layer: folder, rule: 'folder' };
    const name = nameRule(file, false);
    return name ? { layer: name, rule: 'name' } : undefined;
}

export function placeLayers(input: LayerInput): Map<string, LayerPlacement> {
    const placed = new Map<string, LayerPlacement>();
    const paths = [...new Set(input.paths)].sort(compareStr);
    for (const path of paths) {
        const placement = placeByPath(path, input.entryPaths);
        if (placement) placed.set(path, placement);
    }
    const importers = new Map<string, Set<string>>();
    for (const [from, to] of input.imports) {
        if (from === to || input.barrels?.has(from)) continue;
        const set = importers.get(to) ?? new Set<string>();
        set.add(from);
        importers.set(to, set);
    }
    for (let pass = 0; pass < IMPORT_PASSES; pass++) {
        const next = new Map<string, LayerPlacement>();
        for (const path of paths) {
            if (placed.has(path)) continue;
            const tally = new Array<number>(LAYER_IDS.length).fill(0);
            for (const from of importers.get(path) ?? []) {
                const layer = placed.get(from)?.layer;
                if (layer) { const at = LAYER_IDS.indexOf(layer); tally[at] = (tally[at] ?? 0) + 1; }
            }
            const top = Math.max(...tally);
            if (top === 0) continue;
            next.set(path, { layer: LAYER_IDS[Math.min(tally.indexOf(top) + 1, LAYER_IDS.length - 1)]!, rule: 'imports' });
        }
        if (next.size === 0) break;
        for (const [path, placement] of next) placed.set(path, placement);
    }
    return placed;
}
