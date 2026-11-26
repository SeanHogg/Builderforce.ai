/**
 * The folder slots' paint (PRD 43 B1a rule 1; the Mind map is the camera that draws them). Two facts derived from what
 * sits beneath a folder, never from where it is placed:
 *
 *  - its TONE: the worst finding on any FILE under it — the SVG mind map's own folder tree settles it (`buildDirs`), and
 *    its `severityTone` names the tone — else a quiet tone
 *    that still reads on the background in both themes. (The area tone, `--bf-border-strong`, is an area BACKGROUND:
 *    as a mark it was a near-black square, darker still when dimmed.)
 *  - whether a question LIGHTS it: a lit node beneath it, or a lit station with a member file beneath it (a question
 *    answers in stations, whose members need not be drawn nodes — otherwise every folder dimmed).
 *
 * Pure; runs in the worker.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { buildDirs, walkDirs, worstSeverity } from '../../map/folderTree';
import { severityTone, type Severity } from '../../map/mindMapModel';
import type { ThemeTone } from '../../scene/themeTokens';
import { toneIndex } from '../../stage/tones';
import { FLAG, SLOT_FOLDER, SLOT_NODE, type MarkSet } from '../../stage/types';
import type { StationModel } from '../../surface/stations';
import { dirSlotsOf, fileFolderSlot } from './markSet';

/** A folder with nothing found beneath it: muted text, legible on `bg` in light and dark. */
export const FOLDER_QUIET_TONE: ThemeTone = 'muted';

type FolderMarks = Pick<MarkSet, 'keys' | 'slotKind' | 'parentFolder'>;

/** Per graph: each folder path's worst finding, as the SVG mind map's folder tree settles it (`buildDirs`). */
const FOLDER_SEVERITY = new WeakMap<object, Map<string, Severity>>();

function folderSeverities(g: Pick<KnowledgeGraph, 'nodes' | 'findings'>): Map<string, Severity> {
    let out = FOLDER_SEVERITY.get(g);
    if (!out) {
        out = new Map();
        for (const d of walkDirs(buildDirs(g.nodes, worstSeverity(g.findings)))) if (d.severity) out.set(d.path, d.severity);
        FOLDER_SEVERITY.set(g, out);
    }
    return out;
}

/** Every folder slot's tone (its worst finding beneath, else {@link FOLDER_QUIET_TONE}) and flags (selectable). */
export function paintFolders(g: Pick<KnowledgeGraph, 'nodes' | 'findings'>, marks: FolderMarks, tone: Uint8Array, flags: Uint16Array): void {
    const severity = folderSeverities(g);
    for (let i = 0; i < marks.keys.length; i++) {
        if (marks.slotKind[i] !== SLOT_FOLDER) continue;
        tone[i] = toneIndex(severityTone(severity.get(marks.keys[i]!.slice(4)), FOLDER_QUIET_TONE));
        flags[i] = FLAG.SELECTABLE;
    }
}

/**
 * Lights (`on[f] = 1`) every folder holding a lit node, or a member file of a lit station, and the folders above it.
 * `stationSlot` is the model's station id → slot.
 */
export function lightFolders(on: Uint8Array, marks: FolderMarks, stations: Pick<StationModel, 'stations'>, stationSlot: ReadonlyMap<string, number>): void {
    const up = (from: number) => { for (let f = from; f >= 0 && !on[f]; f = marks.parentFolder[f]!) on[f] = 1; };
    for (let i = 0; i < marks.keys.length; i++) if (on[i] && marks.slotKind[i] === SLOT_NODE) up(marks.parentFolder[i]!);
    let dirAt: Map<string, number> | null = null;
    for (const s of stations.stations) {
        const slot = stationSlot.get(s.id);
        if (slot === undefined || !on[slot]) continue;
        dirAt ??= dirSlotsOf(marks.keys);
        for (const ref of s.refs) up(fileFolderSlot(ref, dirAt));
    }
}
