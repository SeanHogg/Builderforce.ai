/**
 * One labelled group of the diagnostics. The report's text AND the Diagnostics tab are built from these (`graphDiagnostics.ts`, `surfaceDiagnostics.ts`), so the
 * words in the tab are exactly the words that get copied. English on purpose, like the text. `attention`: the group holds something a triager should look at first
 * (a failed review, failed or missing uploads, a defect flag); the tab opens it and puts it first.
 */

export type DiagnosticSectionId = 'graph' | 'review' | 'load' | 'coverage' | 'lines' | 'sync' | 'findings';


export interface DiagnosticSection {
    id: DiagnosticSectionId;
    lines: string[];
    attention: boolean;
}

/** Everything the diagnostics say, once: the sections, the instant they were taken (ISO) and the text the clipboard gets. */
export interface Diagnostics {
    sections: DiagnosticSection[];
    takenAt: string;
    text: string;
}

/** A `key: value` line split at its first colon; a continuation (indented) line or a free line has no key. */
export function splitLine(line: string): { key?: string; value: string } {
    const at = line.indexOf(': ');
    return at > 0 && !line.startsWith(' ') ? { key: line.slice(0, at), value: line.slice(at + 2) } : { value: line.trim() };
}
