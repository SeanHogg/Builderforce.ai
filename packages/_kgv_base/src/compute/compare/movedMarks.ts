/**
 * The code pane's marks for a restructure (PRD 43 Part C8), pure. A proposal carries no line spans of its own, so they are
 * derived from the file's `SymbolRecord`s AT PROPOSAL TIME (the symbols the proposer already holds, so the pane never has
 * to load them again): a definition starts on its `line` and runs to the line before the next top-level definition (the
 * last one to the end of the text; a comment above a definition stays with the one before it). The spans of every
 * definition the proposal moves out (`Proposal.moved`) travel with the proposal (`Proposal.spans`); `movedMarks` turns them
 * into the file's `removed` lines, in the one `CodeMarks` shape the baseline and commit marks use.
 */

import { fileRefOf, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';
import type { CodeMarks } from '../../stage/drill/codeDiff';
import type { SourceText, SymbolRecord } from '../../types';

/** One moved top-level definition: its file's root-relative `path`, 1-based lines (`to` is Infinity for the file's last), and the module it lands in. */
export interface MovedSpan { path: string; from: number; to: number; module: string }

/** The spans of the top-level definitions of `symbols` that `moved` sends elsewhere (a member moves with its definition). */
export function movedSpans(symbols: readonly SymbolRecord[], moved: ReadonlyMap<string, string>): MovedSpan[] {
    const byFile = new Map<string, SymbolRecord[]>();
    for (const s of symbols) {
        const file = fileRefOf(s.ref as NodeRef);
        if (s.parent === file) byFile.set(file, [...(byFile.get(file) ?? []), s]);
    }
    const spans: MovedSpan[] = [];
    for (const [file, top] of byFile) {
        const path = pathOf(file as NodeRef);
        if (path === undefined) continue;
        top.sort((a, b) => a.line - b.line).forEach((s, i) => {
            const module = moved.get(s.ref);
            if (module !== undefined) spans.push({ path, from: s.line, to: i + 1 < top.length ? top[i + 1]!.line - 1 : Infinity, module });
        });
    }
    return spans;
}

/** The marks for `text` (the file `path` as read): the moved definitions' lines are `removed`; `null` when nothing in this file moves. */
export function movedMarks(path: string, spans: readonly MovedSpan[], text: SourceText): CodeMarks | null {
    const mine = spans.filter((s) => s.path === path);
    if (mine.length === 0) return null;
    const removed = new Set<number>();
    text.lines.forEach((_, i) => {
        const line = text.startLine + i;
        if (mine.some((s) => line >= s.from && line <= s.to)) removed.add(line);
    });
    return { added: new Set<number>(), removed };
}

/** The modules this file's definitions move to, each once, in file order. */
export function movedModules(path: string, spans: readonly MovedSpan[]): string[] {
    return [...new Set(spans.filter((s) => s.path === path).map((s) => s.module))];
}
