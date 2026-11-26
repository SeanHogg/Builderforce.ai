/**
 * What the code pane is reading (PRD 43 B1a rule 9), shared by the pane and the map side (the trail's Follow, the step
 * card, the call numbers on the stage): the line on the pane's reading line and its enclosing symbols, Follow, and inside
 * the open `method` its numbered calls with the current one.
 *
 * While Follow is on, the reading line crossing into another symbol names it (`onFocusSymbol`, once per symbol, not per
 * pixel), and the symbols on screen (`inView`) stay lit on the stage. A step chosen by Previous / Next, its number or a
 * stage pick of its callee stays current until the reading line leaves its line (two calls can share one). A clicked
 * line (`pickLine`) is read instead of the reading line until the code scrolls again.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SourceText, SymbolRecord } from '../../types';
import { callStepsOf, codeTargetOf, refsInView, stepAt, stepOfCallee, symbolAtLine, symbolChain, symbolsOfFile, type CallStep } from './codeText';

export interface CodeReading {
    follow: boolean;
    toggleFollow(): void;
    /** The open method's calls in call order (none when no method is open). */
    steps: readonly CallStep[];
    /** The open method's lines. */
    span: { startLine: number; endLine: number } | null;
    /** The index into `steps` of the current call; -1 for none. */
    current: number;
    /** The line being read: a clicked line (`cursor`), else the pane's reading line; null before the pane reads. */
    line: number | null;
    /** The symbol on the reading line and its enclosing symbols, outermost first. */
    chain: readonly SymbolRecord[];
    /** The file's loaded symbols by line (`symbolsOfFile`) and every record by ref: the outline, the rails, the lenses. */
    fileSymbols: readonly SymbolRecord[];
    byRef: ReadonlyMap<string, SymbolRecord>;
    /** A line a crumb or a step sent the pane to; it wins over the host's `scrollLine` until that changes. */
    jump: number | undefined;
    jumpTo(line: number): void;
    /** The pane's reading line moved (`CodeLayer.onReadingLine`); a scroll drops a clicked line. */
    onReadingLine(line: number): void;
    /** A line clicked in the code: read it (the step unpinned) until the code scrolls. */
    cursor: number | null;
    pickLine(line: number): void;
    /** The source lines on screen (`CodeLayer.onViewport`). */
    onViewport(first: number, last: number): void;
    /** While Follow is on, the symbols on screen and their files (`refsInView`), the same array while they stay the same; null when Follow is off. */
    inView: readonly string[] | null;
    /** The pane read its text (`CodeLayer.onText`). */
    onText(text: SourceText): void;
    /** A line of the text read; undefined before it is read, outside it, or with no `readSource`. */
    lineText(line: number): string | undefined;
    /** Make step `index` current (wrapping around) and send the pane to its line. */
    goStep(index: number): void;
}

export interface CodeReadingInput {
    /** The file on show; none while the pane is closed. */
    path: string | undefined;
    records: readonly SymbolRecord[];
    /** The method open at the code level. */
    method: string | null;
    /** The host's line for the pane (selection, the journey step, a drilled method's start). */
    scrollLine: number | undefined;
    /** A ref picked on the stage: a callee of `method` makes its call current. */
    pick: string | null;
    onFocusSymbol?: ((ref: string) => void) | undefined;
}

export function useCodeReading({ path, records, method, scrollLine, pick, onFocusSymbol }: CodeReadingInput): CodeReading {
    const fileSymbols = useMemo(() => path ? symbolsOfFile(records, path) : [], [records, path]);
    const byRef = useMemo(() => new Map(records.map((r) => [r.ref, r])), [records]);
    const steps = useMemo(() => method ? callStepsOf(method, records) : [], [method, records]);
    const span = useMemo(() => method ? codeTargetOf(method, records) : null, [method, records]);
    const [reading, setReading] = useState<number | null>(null);
    const [cursor, setCursor] = useState<number | null>(null);
    const [follow, setFollow] = useState(true);
    const toggleFollow = useCallback(() => setFollow((f) => !f), []);
    const [jump, setJump] = useState<number | undefined>(undefined);
    useEffect(() => { setJump(undefined); }, [scrollLine]);
    const [pinned, setPinned] = useState(-1);
    useEffect(() => { setPinned(-1); }, [method]);
    const current = pinned >= 0 ? pinned : reading == null ? -1 : stepAt(steps, reading, span);
    const chain = useMemo(() => symbolChain(reading == null ? null : symbolAtLine(fileSymbols, reading), byRef), [reading, fileSymbols, byRef]);
    // Only a reading line crossing into another symbol reaches the stage, not every pixel.
    const last = useRef<string | null>(null);
    useEffect(() => { last.current = null; }, [path, follow]);
    const focus = useCallback((ref: string | null) => {
        if (!follow || !ref || ref === last.current) return;
        last.current = ref;
        onFocusSymbol?.(ref);
    }, [follow, onFocusSymbol]);
    const read = useCallback((line: number, unpin: boolean) => {
        setReading(line);
        if (unpin || (pinned >= 0 && steps[pinned]?.line !== line)) setPinned(-1);
        focus(symbolAtLine(fileSymbols, line));
    }, [pinned, steps, fileSymbols, focus]);
    const onReadingLine = useCallback((line: number) => { setCursor(null); read(line, false); }, [read]);
    const pickLine = useCallback((line: number) => { setCursor(line); read(line, true); }, [read]);
    // Follow turned back on lights the line already being read.
    useEffect(() => { if (follow && reading != null) read(reading, false); }, [follow]); // eslint-disable-line react-hooks/exhaustive-deps
    const goStep = useCallback((i: number) => {
        if (!steps.length) return;
        const k = (i + steps.length) % steps.length;
        setPinned(k);
        setJump(steps[k]!.line);
    }, [steps]);
    // A callee picked on the stage: go to its call (the open method itself, or one it does not call, does nothing).
    // Keyed on the pick alone: a new method's steps must not re-run the old pick (the wiring clears it only after this effect).
    useEffect(() => { const i = stepOfCallee(steps, pick); if (i >= 0) goStep(i); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps

    // The lines on screen, and the text read: both belong to the file on show.
    const [view, setView] = useState<{ first: number; last: number } | null>(null);
    const [text, setText] = useState<SourceText | null>(null);
    useEffect(() => { setView(null); setText(null); setCursor(null); }, [path]);
    const onViewport = useCallback((first: number, lastLine: number) => {
        setView((v) => v && v.first === first && v.last === lastLine ? v : { first, last: lastLine });
    }, []);
    const lit = useMemo(() => follow && view ? refsInView(fileSymbols, records, view.first, view.last) : null, [follow, view, fileSymbols, records]);
    // The stage repaints on a new array: keep the old one while the same symbols are on screen.
    const litKey = lit?.join('\n') ?? null;
    const inView = useMemo(() => lit, [litKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const lineText = useCallback((line: number) => text?.lines[line - text.startLine], [text]);

    return {
        follow, toggleFollow, steps, span, current, line: reading, chain, fileSymbols, byRef, jump, jumpTo: setJump, onReadingLine,
        cursor, pickLine, onViewport, inView, onText: setText, lineText, goStep,
    };
}
