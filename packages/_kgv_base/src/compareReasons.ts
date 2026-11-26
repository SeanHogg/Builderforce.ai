/**
 * Why Compare's two sides do not compare, in words (PRD 41 §C9). Pure: memory's `comparable()` reason codes in (as the
 * host's baseline states them), the view's catalog templates out. A pack reaches `tools` as `pack:<id>` (agent-tools
 * `knowledgeSideMeta`), so `tool-missing:pack:docs` reads as the pack, not an analyzer. An unknown code (a reason added
 * after this build) reads as the code itself, never blank.
 */

import { fillTemplate, type KnowledgeGraphLabels } from './labels';

/**
 * agent-tools `PACK_TOOL_PREFIX` (this package does not depend on agent-tools; agent-tools `measuredWith.test.ts` pins this
 * literal and the `measured-unknown` code to its own constants).
 */
export const PACK = 'pack:';
const FIXED: Record<string, keyof KnowledgeGraphLabels> = {
    'extractor-version-changed': 'compareReasonExtractorVersion',
    'measured-unknown': 'compareReasonMeasuredUnknown',
    'extractor-mismatch': 'compareReasonExtractorMismatch',
    'content-hash-rule-changed': 'compareReasonContentHashRule',
    'scope-changed': 'compareReasonScope',
    'repo-changed': 'compareReasonRepo',
    'branch-changed': 'compareReasonBranch',
    truncated: 'compareReasonTruncated',
};

/** One reason code as a sentence. */
export function compareReasonText(labels: KnowledgeGraphLabels, code: string): string {
    const fixed = FIXED[code];
    if (fixed) return labels[fixed] as string;
    const colon = code.indexOf(':');
    const prefix = colon > 0 ? code.slice(0, colon) : code;
    const subject = colon > 0 ? code.slice(colon + 1) : '';
    if (prefix === 'tool-missing' && subject.startsWith(PACK)) {
        const pack = subject.slice(PACK.length);
        return fillTemplate(labels.compareReasonPackMissing, { pack: labels.packs[pack] ?? pack });
    }
    if (prefix === 'tool-missing') return fillTemplate(labels.compareReasonToolMissing, { tool: subject });
    if (prefix === 'tool-version-changed') return fillTemplate(labels.compareReasonToolVersion, { tool: subject });
    if (prefix === 'analyzer-failed') return fillTemplate(labels.compareReasonAnalyzerFailed, { tool: subject });
    return code;
}

/** A version or tool drifted, or a side recorded none (not the folder, repo or branch): a new review measures both sides alike. */
export const reviewAgainFixes = (codes: readonly string[]): boolean =>
    codes.some((c) => c === 'extractor-version-changed' || c === 'measured-unknown' || c.startsWith('tool-') || c === 'content-hash-rule-changed');
