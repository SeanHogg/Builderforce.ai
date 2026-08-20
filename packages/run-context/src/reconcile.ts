/**
 * ContextReconciler — run context routed through Evermind Write-Through Cognition.
 *
 * Every surface used to re-send the WHOLE context blob on every turn / every re-run.
 * That is the append-forever failure the cognition layer exists to prevent: a PRD that
 * changed between two runs arrived as a SECOND competing belief next to the first, and
 * a PRD that did not change burned the same tokens again.
 *
 * This class is the run-context adapter onto `EvermindCognition`'s published API
 * (`@seanhogg/builderforce-memory` → `cognition/EvermindCognition.ts`). It does not
 * reimplement any of it:
 *   • Canonicalize   — {@link contextSubjectKey} names the SUBJECT (scope + kind +
 *     source), so a re-assembled block collides with its incumbent.
 *   • Recall + evaluate + reconcile — `commit()` does all three and returns a
 *     {@link ContextVerdict}.
 *   • Write-through  — the store the caller injected.
 *
 * The verdict decides what the surface is told:
 *   augment    → NEW to this run — send it.
 *   confirm    → byte-identical to what the run already knows — ELIDE it (that is the
 *                delta) and name it in `unchanged` so the model knows it still holds.
 *   supersede  → it CHANGED and evidence favoured the new state — send the new body,
 *                marked as replacing the old. One belief, not two.
 *   reject     → it changed but evidence favoured the INCUMBENT (a lower-trust source
 *                trying to overwrite a higher-trust one) — send the incumbent. The
 *                contradiction is resolved, never concatenated.
 *
 * The cognition instance is injected structurally, exactly as `EvermindCognition`
 * accepts any `CognitionFactStore`: an `EvermindCognition` satisfies
 * {@link CognitionCommitPort} with no adapter, and a test can pass a fake.
 */

import {
    contextSubjectKey,
    sortBlocks,
    type RunContextBlock,
    type RunContextEnvelope,
    type RunContextTrustTier,
} from './blocks.js';

/** Mirrors `Verdict` from the cognition package (kept local so this stays dependency-free). */
export type ContextVerdict = 'augment' | 'confirm' | 'supersede' | 'reject';

/** Mirrors `Claim`. */
export interface CognitionClaim {
    subjectKey: string;
    content: string;
    tags?: string[];
    importance?: number;
    requireEvidence?: boolean;
}

/** Mirrors `CommitResult`. */
export interface CognitionCommitResult {
    verdict: ContextVerdict;
    subjectKey: string;
    content: string;
    superseded?: string;
    evidence: string[];
    version: number;
}

/** Mirrors `EvidenceContext` / `EvidenceGatherer`. */
export interface CognitionEvidenceContext {
    claim: CognitionClaim;
    incumbent?: string;
}
export type CognitionEvidenceGatherer = (
    ctx: CognitionEvidenceContext,
) => Promise<{ supportsNew: boolean; notes: string[] }>;

/**
 * The slice of `EvermindCognition` this reconciler uses. `EvermindCognition` satisfies
 * it structurally — no adapter, no wrapper, no reimplementation.
 */
export interface CognitionCommitPort {
    commit(claim: CognitionClaim, gather?: CognitionEvidenceGatherer): Promise<CognitionCommitResult>;
    readonly version: number;
}

export interface ReconciledBlock extends RunContextBlock {
    verdict: ContextVerdict;
    /** The prior body this block replaced (only on `supersede`). */
    superseded?: string;
    /** Cognition's audit trail for the decision. */
    evidence?: string[];
}

export interface ReconciledRunContext {
    scope: string;
    /** The DELTA — what this surface should actually be told this turn. */
    blocks: ReconciledBlock[];
    /** Subjects elided because the run already holds them verbatim. */
    unchanged: string[];
    /** Cognition's knowledge-generation token after reconciliation. */
    knowledgeVersion: number;
}

/**
 * Provenance header written INTO the stored belief.
 *
 * It carries the trust tier so the evidence rule can compare "who is asserting this now"
 * against "who asserted the incumbent" — the fact store's `recall` returns content only,
 * so a tier kept in `tags` would not be readable back.
 *
 * Deliberately deterministic (tier only, NO timestamp): `commit()` decides `confirm` by
 * byte-equality with the incumbent, so a clock in the header would make every block look
 * changed and no block would ever be elided — the delta would never happen.
 */
const PROVENANCE_RE = /^<!-- runctx tier=([a-z]+) -->\n/;

function stamp(tier: RunContextTrustTier, body: string): string {
    return `<!-- runctx tier=${tier} -->\n${body}`;
}

function unstamp(stored: string): { tier: RunContextTrustTier | null; body: string } {
    const m = PROVENANCE_RE.exec(stored);
    if (!m) return { tier: null, body: stored };
    return { tier: (m[1] ?? null) as RunContextTrustTier | null, body: stored.slice(m[0].length) };
}

/** Higher wins a contradiction. An unknown/unstamped incumbent scores lowest. */
const TIER_AUTHORITY: Record<RunContextTrustTier, number> = {
    operator: 3,
    tenant: 2,
    repository: 1,
    external: 0,
};

function authority(tier: RunContextTrustTier | null): number {
    return tier ? TIER_AUTHORITY[tier] : -1;
}

/**
 * The evidence rule for run context: ground truth favours the NEW assertion unless a
 * strictly LOWER-trust source is trying to overwrite a higher-trust incumbent.
 *
 * This is what makes reconciliation real rather than "newest wins". Platform-owned
 * blocks (strategy, PRD, governance) are read from the system of record on every
 * assembly, so they always supersede. A `repository`- or `external`-tier block — a repo
 * tree listing, a scraped page — does NOT get to silently overwrite what the tenant's
 * own records say.
 */
export function trustAuthorityGatherer(tier: RunContextTrustTier): CognitionEvidenceGatherer {
    return async (ctx) => {
        const incumbent = unstamp(ctx.incumbent ?? '');
        const mine = authority(tier);
        const theirs = authority(incumbent.tier);
        const supportsNew = mine >= theirs;
        return {
            supportsNew,
            notes: [
                `new assertion trust=${tier} (authority ${mine})`,
                `incumbent trust=${incumbent.tier ?? 'unknown'} (authority ${theirs})`,
                supportsNew
                    ? 'evidence favours the new assertion — superseding the incumbent'
                    : 'a lower-trust source may not overwrite a higher-trust belief — incumbent stands',
            ],
        };
    };
}

/** Prefix that makes a reconciled CHANGE visible to the model rather than silent. */
export const SUPERSEDED_MARKER =
    '> ⚠ CHANGED since the last pass on this work — what follows REPLACES what an earlier run was told about it.';
/** Prefix used when the higher-trust record won a contradiction. */
export const REJECTED_MARKER =
    '> ⚠ A lower-trust source asserted something different about this; the higher-trust record below stands.';

export interface ReconcileOptions {
    /**
     * Override the evidence rule (a surface with real ground-truth probes — the IDE's
     * `list_files`, say — can pass `workspacePresenceGatherer` from the cognition
     * package instead). Defaults to {@link trustAuthorityGatherer}.
     */
    gather?: (block: RunContextBlock) => CognitionEvidenceGatherer;
    /**
     * Drop `confirm`ed blocks from the delta (the default — that is what makes this a
     * DELTA rather than the whole blob).
     *
     * Pass `false` when the consuming surface REBUILDS its prompt every turn instead of
     * appending to a retained conversation. All three of today's surfaces do exactly
     * that — a system prompt is replaced, not accumulated — so eliding a block the
     * model can no longer see would starve the run rather than save tokens. Those
     * callers still get the two things reconciliation is really for: a contradiction
     * resolved to ONE belief, and a CHANGE made visible via {@link SUPERSEDED_MARKER}.
     */
    elideUnchanged?: boolean;
}

/**
 * Routes assembled blocks through cognition and returns the DELTA a surface should send.
 *
 * Never throws: a store/cognition failure degrades to "send the whole block, unreconciled",
 * because context assembly must not be able to fail a run.
 */
export class ContextReconciler {
    constructor(
        private readonly cognition: CognitionCommitPort,
        private readonly opts: ReconcileOptions = {},
    ) {}

    async reconcile(envelope: RunContextEnvelope): Promise<ReconciledRunContext> {
        const blocks = sortBlocks(envelope.blocks).filter((b) => b.body.trim().length > 0);
        const out: ReconciledBlock[] = [];
        const unchanged: string[] = [];

        for (const block of blocks) {
            const tier: RunContextTrustTier = block.trustTier ?? 'operator';
            const gather = this.opts.gather?.(block) ?? trustAuthorityGatherer(tier);
            let result: CognitionCommitResult | null = null;
            try {
                result = await this.cognition.commit(
                    {
                        subjectKey: contextSubjectKey(envelope.scope, block),
                        content: stamp(tier, block.body),
                        tags: ['runctx', block.kind, tier],
                        // A pinned block is the run's GOAL — weight it above ambient context
                        // so a similarity-ranked recall can never bury it.
                        importance: block.pinned ? 0.95 : 0.7,
                    },
                    gather,
                );
            } catch {
                // Cognition unavailable → no delta is better than no context.
                out.push({ ...block, verdict: 'augment' });
                continue;
            }

            if (result.verdict === 'confirm' && !block.pinned) {
                unchanged.push(block.subject);
                if (this.opts.elideUnchanged !== false) continue;
            }
            const body = result.verdict === 'supersede'
                ? `${SUPERSEDED_MARKER}

${block.body}`
                : result.verdict === 'reject'
                    ? `${REJECTED_MARKER}

${unstamp(result.content).body}`
                    : block.body;
            out.push({
                ...block,
                body,
                verdict: result.verdict,
                ...(result.superseded ? { superseded: unstamp(result.superseded).body } : {}),
                ...(result.evidence.length ? { evidence: result.evidence } : {}),
            });
        }

        return {
            scope: envelope.scope,
            blocks: out,
            unchanged,
            knowledgeVersion: this.cognition.version,
        };
    }
}

/** The reconciled delta as a plain envelope, for a surface that only wants to render. */
export function deltaEnvelope(
    envelope: RunContextEnvelope,
    reconciled: ReconciledRunContext,
): RunContextEnvelope {
    return { ...envelope, blocks: reconciled.blocks };
}
