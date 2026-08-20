/**
 * `@builderforce/run-context` — the ONE run-context source-of-shape.
 *
 * Contract (`blocks.ts`), renderer (`render.ts`) and reconciler (`reconcile.ts`) for the
 * context an agent run receives, shared by all three prompt-assembly surfaces: the cloud
 * engine (Worker), the on-prem embedded runner (Node) and the VS Code client. The api
 * owns the DATA and serves an assembled envelope; this package owns its shape, its
 * rendering, and its reconciliation through Evermind Write-Through Cognition.
 *
 * Dependency-free and I/O-free by contract — it is imported by a Cloudflare Worker, a
 * Node CLI and a VS Code extension host, so it may not reach for node builtins, `fetch`,
 * or any package.
 */

export {
    RUN_CONTEXT_CONTRACT_VERSION,
    RUN_CONTEXT_KIND_LABELS,
    contextSubjectKey,
    sortBlocks,
} from './blocks.js';
export type {
    RunContextBlock,
    RunContextBlockKind,
    RunContextChannel,
    RunContextEnvelope,
    RunContextTrustTier,
} from './blocks.js';

export { renderRunContext, renderPlatformContextSection, summarizeBlocks } from './render.js';
export type { RenderedRunContext, PlatformSectionOptions } from './render.js';

export {
    ContextReconciler,
    REJECTED_MARKER,
    SUPERSEDED_MARKER,
    deltaEnvelope,
    trustAuthorityGatherer,
} from './reconcile.js';
export type {
    CognitionClaim,
    CognitionCommitPort,
    CognitionCommitResult,
    CognitionEvidenceContext,
    CognitionEvidenceGatherer,
    ContextVerdict,
    ReconcileOptions,
    ReconciledBlock,
    ReconciledRunContext,
} from './reconcile.js';
