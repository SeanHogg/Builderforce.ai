/**
 * What the code pane is reading (PRD 43 B1a rule 9), shared by the pane and the map side (the trail's Follow, the step
 * card, the call numbers on the stage): the line on the pane's reading line and its enclosing symbols, Follow, and inside
 * the open `method` its numbered calls with the current one.
 *
 * While Follow is on, the reading line crossing into another symbol names it (`onFocusSymbol`, once per symbol, not per
 * pixel). A step chosen by Previous / Next, its number or a stage pick of its callee stays current until the reading line
 * leaves its line (two calls can share one).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SymbolRecord } from '../../types';
import { callStepsOf, codeTargetOf, stepAt, stepOfCallee, symbolAtLine, symbolChain, symbolsOfFile, type CallStep } from './codeText';

export interface CodeReading {
    follow: boolean;
    toggleFollow(): void;
    /** The open method's calls in call order (none when no method is open). */
    steps: readonly CallStep[];
    /** The open method's lines. */
    span: { startLine: number; endLine: number } | null;
    /** The index into `steps` of the current call; -1 for none. */
    current: number;
    /** The symbol on the reading line and its enclosing symbols, outermost first. */
    chain: readonly SymbolRecord[];
    /** A line a crumb or a step sent the pane to; it wins over the host's `scrollLine` until that changes. */
    jump: number | undefined;
    jumpTo(line: number): void;
    /** The pane's reading line moved (`CodeLayer.onReadingLine`). */
    onReadingLine(line: number): void;
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
    const onReadingLine = useCallback((line: number) => {
        setReading(line);
        if (pinned >= 0 && steps[pinned]?.line !== line) setPinned(-1);
        focus(symbolAtLine(fileSymbols, line));
    }, [pinned, steps, fileSymbols, focus]);
    // Follow turned back on lights the line already being read.
    useEffect(() => { if (follow && reading != null) onReadingLine(reading); }, [follow]); // eslint-disable-line react-hooks/exhaustive-deps
    const goStep = useCallback((i: number) => {
        if (!steps.length) return;
        const k = (i + steps.length) % steps.length;
        setPinned(k);
        setJump(steps[k]!.line);
    }, [steps]);
    // A callee picked on the stage: go to its call (the open method itself, or one it does not call, does nothing).
    // Keyed on the pick alone: a new method's steps must not re-run the old pick (the wiring clears it only after this effect).
    useEffect(() => { const i = stepOfCallee(steps, pick); if (i >= 0) goStep(i); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
    return { follow, toggleFollow, steps, span, current, chain, jump, jumpTo: setJump, onReadingLine, goStep };
}
