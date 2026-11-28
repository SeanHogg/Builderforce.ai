/**
 * The level scene's diagnostics (the copied report's "level" lines): what the Map / 3D drew, where the drill stands, how the
 * graph is counted, what is left off the map and whether the Map's top level says the same thing as the Code outline's.
 * ONE hierarchy, the outline's (`buildCodeHierarchy`), so a mismatch here is a defect, never two readings. English on purpose,
 * like the rest of the diagnostics. Pure.
 */

import type { LevelDescriptor } from '../stage/types';
import type { CodeFile } from './codeHierarchy';
import type { DrillFrame } from './transit/drillView';

export interface LevelDiagnosticsInput {
    camera: string;
    /** The ONE 3D / Flat switch. */
    flat: boolean;
    /** The placement's level descriptor (`Placement.level`); absent = the camera has none. */
    level: LevelDescriptor | undefined;
    stack: readonly Pick<DrillFrame, 'level' | 'ref' | 'name'>[];
    rootTitle: string;
    /** The outline's index (`buildCodeHierarchy`). */
    files: ReadonlyMap<string, CodeFile>;
    /** The world's stations (areas). */
    stations: number;
    /** Definitions loaded so far, by kind. */
    classes: number;
    methods: number;
}

const FIRST = 12;
const unique = (values: Iterable<string>): string[] => [...new Set(values)];
const sizeOf = (c: { w: number; d: number; h: number }): string => [c.w, c.d, c.h].map((n) => Number(n.toFixed(1))).join('x');

/** The names of the outline's top groups (system, else app, else the first group), by files held, largest first; `apps`: the app groups instead. */
export function outlineTopOf(files: ReadonlyMap<string, CodeFile>, apps = false): string[] {
    const counts = new Map<string, number>();
    for (const file of files.values()) {
        const top = file.isCode ? (apps ? file.architecture.find((g) => g.id.startsWith('app:')) : file.architecture[0])?.name : undefined;
        if (top) counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name]) => name);
}

/** The "outline vs map" verdict: the same names, or what differs. */
function verdict(outline: readonly string[], map: readonly string[], capped: boolean): string {
    const o = new Set(outline), m = new Set(map);
    const onlyOutline = capped ? [] : outline.filter((n) => !m.has(n)), onlyMap = map.filter((n) => !o.has(n));
    if (onlyOutline.length === 0 && onlyMap.length === 0) return 'match';
    return `MISMATCH: outline only [${onlyOutline.join(', ')}] · map only [${onlyMap.join(', ')}]`;
}

export function levelDiagnosticLines(i: LevelDiagnosticsInput): string[] {
    const { level } = i;
    const where = level ? (level.ref ? `${level.level}:${level.ref}` : level.level) : 'none';
    const kids = level?.children ?? [];
    const shown = kids.slice(0, FIRST).map((c) => `${c.name} [${c.kind}/${c.form} ${sizeOf(c)} files=${c.files} minis=${c.minis}]`);
    const lines = [`start: camera=${i.camera} depth=${i.flat ? 'flat' : '3d'} level=${where} drawn=${kids.length}/${level?.total ?? 0}${shown.length ? ` · ${shown.join(' · ')}` : ''}${kids.length > FIRST ? ' …' : ''}`];
    lines.push(`path: ${[i.rootTitle, ...i.stack.map((f) => f.name)].join(' › ')}${i.stack.length === 0 ? ' (top)' : ''}`);
    const first = kids[0];
    const kindOf = (c: { kind: string } | undefined): string => c?.kind ?? 'child';
    lines.push(`levels: ${level?.level ?? 'none'}=${level?.total ?? 0} ${kindOf(first)}s${first ? ` · next: ${first.name} → ${first.minis} children` : ''}`);

    const code = [...i.files.values()].filter((f) => f.isCode);
    const groupIds = (prefix: string) => unique(code.flatMap((f) => f.architecture.filter((g) => g.id.startsWith(prefix)).map((g) => g.id)));
    lines.push(`inventory: systems=${groupIds('system:').length} apps=${groupIds('app:').length} areas(stations)=${i.stations} code files=${code.length} other files=${i.files.size - code.length} classes=${i.classes} methods=${i.methods}`);

    const off = level?.notOnMap;
    lines.push(`not on the map: ${off?.stations ?? 0} stations · ${off?.files ?? 0} files${off?.examples.length ? ` (e.g. ${off.examples.join(', ')})` : ''} — in the outline's Filesystem view`);

    // The level the world actually opened on: a one-system world is opened on that system's apps (the single-child skip), so
    // those are the groups the outline is compared at. A capped level (`total` > the drawn children) can only be judged on
    // what is drawn: an outline group the map did not draw is not a mismatch then.
    const top = outlineTopOf(i.files), apps = top.length === 1 ? outlineTopOf(i.files, true) : [];
    const outline = apps.length > 0 ? apps : top;
    const atWorld = level?.level === 'world';
    const capped = kids.length < (level?.total ?? 0);
    lines.push(`outline vs map: outline top=${outline.join(', ') || '(none)'} · map top=${atWorld ? kids.map((c) => c.name).join(', ') : `(inside ${where})`} · ${atWorld ? verdict(outline, kids.map((c) => c.name), capped) : 'not compared below the top'}`);
    return lines;
}

/** The level scene's trace text for the render trace: the diagnostics lines, one per row, from the loaded definitions. */
export function levelSceneTrace(i: Omit<LevelDiagnosticsInput, 'classes' | 'methods'> & { symbols: readonly { kind: string }[] }): string {
    const { symbols, ...rest } = i;
    const classes = symbols.filter((s) => s.kind === 'class').length;
    return levelDiagnosticLines({ ...rest, classes, methods: symbols.length - classes }).map((l) => `\n  ${l}`).join('');
}

/** The placement's level as one trace tag (` level=<level>:<ref> drawn=<n>`); '' for a camera with no level scene. */
export const levelTag = (level: LevelDescriptor | undefined): string => (level ? ` level=${level.level}:${level.ref ?? ''} drawn=${level.children.length}` : '');
