/**
 * knowledge/facts/fileFactsOf.ts — ONE parse tree → memory's RAW `FileFacts` v3 (PRD 41 §B3, §4), per language family:
 * JS/TS (`typescript`, `tsx`, `javascript`) and Python. Pure and Worker-safe: the Node host parses (node-file-facts.ts)
 * and stamps the extractor tag; the Worker's regex extractor will converge on the same shape (WS5).
 *
 * RAW: imports carry specifiers and guard chains carry the guards' specifiers; `resolveFileFacts` resolves both against
 * a listing. JS/TS files carry their router model (`uses`, `mounts`, a registration `order` on every entry point): a
 * consumer reads route guards through memory's `effectiveGuards`, never `entryPoints[].guards` alone. Lists are deduped
 * here (a capability reached twice is one fact) and canonicalized by memory, which throws `file_facts_invalid_order` for a
 * bad order — an extract failure of that file.
 *
 * A file past the parse cap gets CAPPED facts ({@link cappedFileFacts}): every list empty and an extractor tag of its own,
 * so it is present (never read as deleted) and never compared with parsed facts (C9: the tags differ) — growth past the
 * cap never reads as "its entry points were removed".
 */

import { canonicalFileFacts, canonicalJson, FACTS_EXTRACTOR_VERSION, type FileFacts } from '@seanhogg/builderforce-memory/knowledge';
import { jsCapabilities, pythonCapabilities } from './capabilities.js';
import type { FactNode } from './factsAst.js';
import { jsBody } from './jsBody.js';
import { jsEntryPoints } from './jsEntryPoints.js';
import { jsStructure } from './jsStructure.js';
import { jsTestFacts } from './jsTestFacts.js';
import { pythonFacts } from './pythonFacts.js';

/** The tree-sitter languages FileFacts are extracted for. */
export const FILE_FACTS_LANGUAGES: readonly string[] = ['javascript', 'python', 'tsx', 'typescript'];
const JS_FAMILY = new Set(['javascript', 'tsx', 'typescript']);

/** The extractor family of capped facts (the file was too large to parse). */
export const CAPPED_EXTRACTOR = 'capped';

const unique = <T>(xs: readonly T[]): T[] => [...new Map(xs.map((x) => [canonicalJson(x), x] as const)).values()];

export interface FileFactsInput {
    language: string;
    /** Root-relative POSIX path. */
    path: string;
    root: FactNode;
    /** memory `contentHash` of the file's bytes. */
    contentHash: string;
    /** `factsExtractorTag(stamp, language)`. */
    extractor: string;
}

/** The raw facts of one parsed file; undefined for a language without a fact extractor. */
export function fileFactsOf(input: FileFactsInput): FileFacts | undefined {
    const { language, path, root } = input;
    const header = { factsVersion: FACTS_EXTRACTOR_VERSION, extractor: input.extractor, language, contentHash: input.contentHash };
    if (JS_FAMILY.has(language)) {
        const s = jsStructure(root);
        const b = jsBody(root);
        const specifiers = s.imports.map((i) => i.specifier);
        const tests = jsTestFacts(root, path, specifiers);
        const routing = jsEntryPoints(root, s.bindings);
        return canonicalFileFacts({
            ...header,
            symbols: unique(s.symbols), imports: unique(s.imports), exports: unique(s.exports),
            entryPoints: routing.entryPoints, uses: routing.uses, mounts: routing.mounts,
            calls: b.calls, complexity: b.complexity,
            capabilityImports: unique(jsCapabilities(root, specifiers)),
            ...(tests ? { testFacts: tests } : {}),
        });
    }
    if (language === 'python') {
        const p = pythonFacts(root, path);
        return canonicalFileFacts({
            ...header,
            symbols: unique(p.symbols), imports: unique(p.imports), exports: unique(p.exports), entryPoints: unique(p.entryPoints),
            calls: p.calls, complexity: p.complexity,
            capabilityImports: unique(pythonCapabilities(root, p.modules)),
            ...(p.testFacts ? { testFacts: p.testFacts } : {}),
        });
    }
    return undefined;
}

/** Facts of a file too large to parse: present, empty, and tagged `capped@<revision>` (never comparable with parsed facts). */
export function cappedFileFacts(language: string, contentHash: string, revision: number): FileFacts {
    return canonicalFileFacts({
        factsVersion: FACTS_EXTRACTOR_VERSION, extractor: `${CAPPED_EXTRACTOR}@${FACTS_EXTRACTOR_VERSION}.${revision}`, language, contentHash,
        symbols: [], imports: [], exports: [], entryPoints: [], calls: [], complexity: [], capabilityImports: [],
    });
}

/** Whether facts are {@link cappedFileFacts}. */
export const isCappedFacts = (f: Pick<FileFacts, 'extractor'>): boolean => f.extractor.startsWith(`${CAPPED_EXTRACTOR}@`);
