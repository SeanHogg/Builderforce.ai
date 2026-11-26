/**
 * The sequence reading of a path: one lifeline per stop, one message per hop (labelled with
 * the edge kind and how many references make it), and the Mermaid text of exactly that. The
 * path is the selected line's, a pinpoint's, or a later trace's: they all feed `PathModel`.
 */

import type { PathHop, PathModel, PathStop } from './path';

export interface SequenceMessage {
    /** Lifeline indices. */
    from: number;
    to: number;
    hop: PathHop;
}

export interface Sequence {
    lifelines: PathStop[];
    messages: SequenceMessage[];
}

export function sequenceOf(path: PathModel): Sequence {
    const messages: SequenceMessage[] = [];
    path.hops.forEach((hop, i) => { if (i + 1 < path.stops.length) messages.push({ from: i, to: i + 1, hop }); });
    return { lifelines: path.stops, messages };
}

/** Mermaid breaks on these inside a name or a message. */
const safe = (text: string): string => text.replace(/[\r\n]+/g, ' ').replace(/[;#:]/g, ' ').replace(/\s+/g, ' ').trim();

/** `messageText(hop)` is the words of one message (the caller localizes the edge kind). */
export function toSequenceMermaid(seq: Sequence, messageText: (hop: PathHop) => string): string {
    const lines = ['sequenceDiagram'];
    seq.lifelines.forEach((stop, i) => lines.push(`    participant P${i + 1} as ${safe(stop.name)}`));
    for (const m of seq.messages) lines.push(`    P${m.from + 1}->>P${m.to + 1}: ${safe(messageText(m.hop))}`);
    return lines.join('\n');
}
