/**
 * The Sync drawer's readings beyond the pipeline (`syncModel.ts`): the delta feed (commits
 * since the last review), the real excluded folders (the review recorded them in the same
 * `skipped` list as skipped files; they are told apart by reason), the rejected-upload count
 * the scene banner names, and the action a data source offers. Pure over what the host
 * reported; nothing is invented.
 */

import { fillTemplate } from '../../template';
import type { Commit, SkippedFile, SyncStatus } from '../../types';

export type DeltaState = 'pending' | 'applied';

export interface DeltaRow {
    sha: string;
    title: string;
    at: string;
    files: number;
    author?: string;
    /** `pending` = after the last review (not in the picture yet); `applied` = at or before it. */
    state: DeltaState;
}

export const MAX_DELTA_ROWS = 8;

/** A commit time as an instant (any offset, any spelling); an unreadable one sorts oldest. */
const instant = (iso: string): number => { const n = Date.parse(iso); return Number.isFinite(n) ? n : 0; };

/** The newest commits first, each marked against the last review. No review time ⇒ nothing is called applied. */
export function deltaFeed(commits: readonly Commit[], lastReviewedAt: string | undefined): DeltaRow[] {
    const reviewed = lastReviewedAt ? Date.parse(lastReviewedAt) : Number.NaN;
    return [...commits]
        .sort((a, b) => instant(b.at) - instant(a.at))
        .slice(0, MAX_DELTA_ROWS)
        .map((c) => ({
            sha: c.sha, title: c.title, at: c.at, files: c.refs.length,
            ...(c.author ? { author: c.author } : {}),
            state: Number.isFinite(reviewed) && instant(c.at) <= reviewed ? 'applied' as const : 'pending' as const,
        }));
}

/** How many commits are after the last review. */
export const pendingCount = (rows: readonly DeltaRow[]): number => rows.filter((r) => r.state === 'pending').length;

/** The recorded reason of a folder the walk left out (agent-tools `SkippedFolderReason`) and the label key naming it. */
export const FOLDER_REASONS = {
    'nested-checkout': 'nested',
    worktrees: 'worktrees',
    'local-state': 'local',
    'vendored-src': 'vendored',
} as const;
export type FolderKind = (typeof FOLDER_REASONS)[keyof typeof FOLDER_REASONS];

export interface ExcludedFolder { path: string; kind: FolderKind }

export interface SkippedSplit {
    files: SkippedFile[];
    folders: ExcludedFolder[];
}

/** A binary file stored as an asset node is stored, not skipped: a host that still records it in the skipped list does not make it "not stored". */
export const isAssetSkip = (s: SkippedFile): boolean => s.reason === 'asset' || s.reason === 'binary';

/** The skipped list without the stored assets: what is really not stored. */
export const notStored = (skipped: readonly SkippedFile[]): SkippedFile[] => skipped.filter((s) => !isAssetSkip(s));

/** The review's one skipped list, split into skipped files and the folders it never read. Stored assets are in neither. */
export function splitSkipped(skipped: readonly SkippedFile[]): SkippedSplit {
    const out: SkippedSplit = { files: [], folders: [] };
    for (const s of notStored(skipped)) {
        const kind = (FOLDER_REASONS as Record<string, FolderKind | undefined>)[s.reason];
        if (kind) out.folders.push({ path: s.path, kind }); else out.files.push(s);
    }
    return out;
}

export type SourceRow = SyncStatus['sources'][number];

/** What a data source offers when it is not fully collected. `panel` opens a drawer; `compose` asks the agent. */
export type SourceAction =
    | { kind: 'compose'; label: 'actionSetUpV8' | 'actionTurnOn'; request: 'setUpV8Request' | 'turnOnRequest' }
    | { kind: 'panel'; label: 'actionGenerate'; panel: 'api' }
    | { kind: 'none' };

/** What a source row says under its name: the traces row from its structured fields (runs, newest, unreadable lines), any other row its host `note`. */
export function sourceNote(src: SourceRow, t: Record<'tracesRunsOne' | 'tracesRunsOther' | 'tracesUnparsed', string>): string | undefined {
    if (src.id !== 'traces') return src.note;
    if (src.state === 'absent') return src.unparsed ? fillTemplate(t.tracesUnparsed, { count: src.unparsed.toLocaleString() }) : undefined;
    if (!src.runs) return undefined;
    const at = src.latest ? new Date(src.latest) : null;
    const when = at && !Number.isNaN(at.getTime()) ? at.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
    return fillTemplate(src.runs === 1 ? t.tracesRunsOne : t.tracesRunsOther, { count: src.runs.toLocaleString(), when });
}

export function sourceAction(src: SourceRow): SourceAction {
    if (src.id === 'coverage' && src.state !== 'collected') return { kind: 'compose', label: 'actionSetUpV8', request: 'setUpV8Request' };
    // Files that exist but could not be read are not "off": turning tracing on again would not fix them.
    if (src.id === 'traces' && src.state === 'absent' && !src.unparsed) return { kind: 'compose', label: 'actionTurnOn', request: 'turnOnRequest' };
    if (src.id === 'openapi' && src.state !== 'collected') return { kind: 'panel', label: 'actionGenerate', panel: 'api' };
    return { kind: 'none' };
}
