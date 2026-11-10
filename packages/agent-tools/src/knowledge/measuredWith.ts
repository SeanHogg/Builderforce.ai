/**
 * knowledge/measuredWith.ts — what a review of a root is measured with (PRD 41 §C9): memory's `EXTRACTOR_VERSION` and,
 * when the code pack reviews the root, the bundled analyzers' pins (`analyzerPins.ts`, TypeScript included: knip and
 * dependency-cruiser resolve through it). The ONE source for both ends of the comparison:
 *   - the replica sends it with a pack that records a review digest, and the platform stores it on the root's scope;
 *   - the VSIX baseline states it for the side it measures itself, against the stored values of the platform's review.
 */

import { EXTRACTOR_VERSION } from '@seanhogg/builderforce-memory/knowledge';
import { ANALYZER_VERSIONS, TYPESCRIPT_PIN } from '../analyzerPins.js';
import { CODE_PACK_ID } from './codeNodes.js';

export interface KnowledgeMeasuredWith {
    /** The extractor version, as text (memory's `ComparabilityMeta.extractorVersion` compares it as a string). */
    extractorVersion: string;
    /** Analyzer name → pinned version; empty when the code pack does not review the root. */
    toolVersions: Record<string, string>;
}

const TYPESCRIPT_VERSION = TYPESCRIPT_PIN.slice(TYPESCRIPT_PIN.lastIndexOf('@') + 1);

/** What THIS host measures a root reviewed by `packs` with. */
export function knowledgeMeasuredWith(packs: readonly string[]): KnowledgeMeasuredWith {
    return {
        extractorVersion: String(EXTRACTOR_VERSION),
        toolVersions: packs.includes(CODE_PACK_ID) ? { ...ANALYZER_VERSIONS, typescript: TYPESCRIPT_VERSION } : {},
    };
}
