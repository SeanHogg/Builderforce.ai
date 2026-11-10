/**
 * knowledge/measuredWith.ts — what a review of a root is measured with, and whether two reviews compare (PRD 41 §C9).
 *
 * `knowledgeMeasuredWith` — memory's `EXTRACTOR_VERSION` and, when the code pack reviews the root WITH analyzers, the bundled
 * analyzers' pins (`analyzerPins.ts`, TypeScript included: knip and dependency-cruiser resolve through it). A review records
 * it on its scope when it RUNS (`reviewDirectoryArgs.ts` → memory `ReviewArgs.measured` → `ScopeRecord.measured`), the BFKP
 * pack carries that record, and the platform stores it — so a review queued offline across an upgrade keeps its versions.
 *
 * `knowledgeComparability` — the ONE rule every Compare applies (the VSIX baseline, the web baseline): memory's
 * `comparable()` over each side's root, packs, extractor version, analyzer versions and content-hash rule, with its reasons.
 *
 * Packs and analyzers share `ComparabilityMeta.tools`, so packs go in as `pack:<id>` (an analyzer name never holds a colon):
 * a pack and an analyzer of the same name can never read as the same tool. A side with no `measured` is UNKNOWN: memory
 * compares an absent extractor version equal only to an absent one, so it is never comparable to a measured side.
 */

import {
    comparable, EXTRACTOR_VERSION, type ComparabilityMeta, type ComparabilityReason, type MeasuredWith,
} from '@seanhogg/builderforce-memory/knowledge';
import { ANALYZER_VERSIONS, TYPESCRIPT_PIN } from '../analyzerPins.js';
import { CODE_PACK_ID } from './codeNodes.js';

const TYPESCRIPT_VERSION = TYPESCRIPT_PIN.slice(TYPESCRIPT_PIN.lastIndexOf('@') + 1);

/** The `tools` key of a pack (kept apart from analyzer names). */
export const PACK_TOOL_PREFIX = 'pack:';

/**
 * What THIS host measures a root reviewed by `packs` with. `analyzers: false` — a host whose code pack runs no analyzers
 * (the browser) — states none, so its review never reads as measured by knip & co.
 */
export function knowledgeMeasuredWith(packs: readonly string[], opts: { analyzers?: boolean } = {}): MeasuredWith {
    const analyzed = packs.includes(CODE_PACK_ID) && opts.analyzers !== false;
    return {
        extractorVersion: String(EXTRACTOR_VERSION),
        toolVersions: analyzed ? { ...ANALYZER_VERSIONS, typescript: TYPESCRIPT_VERSION } : {},
    };
}

/** One side of a Compare: its root, the packs that reviewed it, what it was measured with (absent = unknown) and its hash rule. */
export interface KnowledgeSide {
    rootId: string;
    packs: readonly string[];
    measured?: MeasuredWith | undefined;
    /** Absent ⇒ memory's baseline rule. */
    contentHashRule?: string | undefined;
}

/** A side's `ComparabilityMeta`. */
export function knowledgeSideMeta(side: KnowledgeSide): ComparabilityMeta {
    return {
        scope: side.rootId,
        tools: {
            ...Object.fromEntries([...new Set(side.packs)].map((pack) => [`${PACK_TOOL_PREFIX}${pack}`, ''])),
            ...side.measured?.toolVersions,
        },
        ...(side.measured ? { extractorVersion: side.measured.extractorVersion } : {}),
        ...(side.contentHashRule ? { contentHashRule: side.contentHashRule } : {}),
    };
}

/**
 * A side that recorded no `measured` (a review stored before versions were recorded, or synced by a client that did not
 * carry them): UNKNOWN. Memory compares absent equal to absent, so two unknown sides would read as alike — C9 never
 * presents an unknown producer as the same one.
 */
export const MEASURED_UNKNOWN = 'measured-unknown';

/** Whether `before` and `after` compare, and every reason they do not (memory's codes plus {@link MEASURED_UNKNOWN}, sorted). */
export function knowledgeComparability(before: KnowledgeSide, after: KnowledgeSide): { comparable: boolean; reasons: ComparabilityReason[] } {
    const verdict = comparable(knowledgeSideMeta(before), knowledgeSideMeta(after));
    if (before.measured && after.measured) return verdict;
    const reasons = [...new Set([...verdict.reasons, MEASURED_UNKNOWN])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return { comparable: false, reasons };
}
