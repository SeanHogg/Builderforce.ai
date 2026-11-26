/**
 * What the code pane reads while a comparison is open (PRD 43 Part C8): the file on the chosen side, and the lines that
 * side has that the other lacks. Today's side reads through `readSource`; a side with a revision (a baseline's or a
 * snapshot's `rev`, a picked commit's sha) reads through `readSourceAt`. The shown text comes back through `onText` (the
 * pane reads it once); only the OTHER side is read here, then `markLines` (an LCS) marks the difference.
 *
 * Before is always an earlier version: with no revision for it, or no `readSourceAt` on the host, the pane keeps today's
 * file and `unavailable` is set, so it says the earlier one cannot be read here. A failed read of the other side marks
 * nothing and says so too; nothing is skipped silently. A restructure has no file at a revision: its caller passes no
 * `compare`, and the pane is as it was.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { movedMarks, movedModules, type MovedSpan } from '../../compute/compare';
import { pathOf } from '../../graphModel';
import type { CompareRevs } from '../../surface/compareModel';
import type { SourceReader, SourceReaderAt, SourceText } from '../../types';
import { markLines, type CodeMarks } from './codeDiff';

const NO_SPANS: readonly MovedSpan[] = [];

/** What the pane needs of an open comparison of files: the side on show, and the revision each side reads (null After = today's file). */
export interface CodeCompare {
    side: 'before' | 'after';
    revs: CompareRevs;
    /** A restructure (no revisions): the definitions that leave the file, by ref, to the module ref each lands in. */
    moved?: ReadonlyMap<string, string> | undefined;
    /** The lines of those definitions, derived when the proposal was made (the pane loads no symbols of its own). */
    spans?: readonly MovedSpan[] | undefined;
}

export interface CodeDiff {
    /** A restructure: the file names of the new modules this file's definitions move to (the pane says it on both sides). */
    movedTo: readonly string[];
    /** The reader for the shown side (today's `readSource`, or `readSourceAt` bound to the side's revision). */
    reader: SourceReader | undefined;
    /** The pane's text, once read: hand it to `CodeLayer.onText` alongside the reading's (it is one read, shared). */
    onText(text: SourceText): void;
    marks: CodeMarks | null;
    /** The earlier version cannot be read here: today's file is shown instead. */
    unavailable: boolean;
}

/** How many lines past the shown text the other side is read (it may be the longer one). */
const SLACK = 400;
const NO_TEXT = (): void => undefined;
const EMPTY: SourceText = { startLine: 1, lines: [], truncated: false };

const bound = (readAt: SourceReaderAt, rev: string): SourceReader => (path, range) => readAt(path, rev, range);

/** Before is always an earlier version; After is one only when it has a revision of its own (a snapshot's). */
const isOld = (side: 'before' | 'after', rev: string | null): boolean => rev !== null || side === 'before';

const NO_MODULES: readonly string[] = [];
const fileName = (ref: string): string => { const p = pathOf(ref as NodeRef) ?? ref; return p.slice(p.lastIndexOf('/') + 1); };

export function useCodeDiff(compare: CodeCompare | undefined, reader: SourceReader | undefined, readAt: SourceReaderAt | undefined, path: string | undefined): CodeDiff {
    const moved = compare?.moved, spans = compare?.spans ?? NO_SPANS;
    const comparing = !!compare && !moved;
    const side = compare?.side ?? 'after', other = side === 'after' ? 'before' : 'after';
    const shownRev = compare?.revs[side] ?? null, otherRev = compare?.revs[other] ?? null;
    const shownOld = isOld(side, shownRev), otherOld = isOld(other, otherRev);
    const shownReadable = !shownOld || (shownRev !== null && !!readAt), otherReadable = !otherOld || (otherRev !== null && !!readAt);
    // A side that is an old version the host cannot read falls back to today's file, and the pane says so.
    const shown = useMemo(() => (comparing && shownOld && shownRev !== null && readAt ? bound(readAt, shownRev) : reader), [comparing, shownOld, shownRev, readAt, reader]);
    const against = useMemo(
        () => (!otherReadable ? null : otherOld && otherRev !== null && readAt ? bound(readAt, otherRev) : reader ?? null),
        [otherReadable, otherOld, otherRev, readAt, reader],
    );

    const [text, setText] = useState<SourceText | null>(null);
    const [read, setRead] = useState<{ marks: CodeMarks | null; failed: boolean }>({ marks: null, failed: false });
    const onText = useCallback((t: SourceText) => setText(t), []);
    // The text belongs to the file and side that read it.
    useEffect(() => { setText(null); }, [shown, path]);

    const ready = comparing && shownReadable && !!text && !!path && !!against;
    useEffect(() => {
        if (!ready || !text || !path || !against) { setRead({ marks: null, failed: false }); return undefined; }
        let live = true;
        against(path, { startLine: text.startLine, endLine: text.startLine + text.lines.length + SLACK - 1 }).then(
            // A file the other side does not have reads as empty: every line of this side is then its own.
            (theirs) => { if (live) setRead({ marks: markLines(side, text, theirs ?? EMPTY), failed: false }); },
            // A read that FAILED is not a file that was absent: it is reported, marks nothing, and the pane says the earlier version is unavailable.
            (error: unknown) => { console.error('knowledge-graph-view: the other side of a code comparison could not be read', error); if (live) setRead({ marks: null, failed: true }); },
        );
        return () => { live = false; };
    }, [ready, text, path, against, side]);

    // A restructure reads today's file on both sides; the lines of the definitions that leave it are its `removed` marks (the same CodeMarks every comparison draws).
    const restructure = useMemo(
        () => (moved && text && path ? { marks: movedMarks(path, spans, text), modules: movedModules(path, spans).map(fileName) } : null),
        [moved, text, path, spans],
    );
    if (moved) return { reader, onText, marks: restructure?.marks ?? null, unavailable: false, movedTo: restructure?.modules ?? NO_MODULES };
    if (!comparing) return { reader, onText: NO_TEXT, marks: null, unavailable: false, movedTo: NO_MODULES };
    return { reader: shown, onText, marks: read.marks, unavailable: !shownReadable || !otherReadable || read.failed, movedTo: NO_MODULES };
}
