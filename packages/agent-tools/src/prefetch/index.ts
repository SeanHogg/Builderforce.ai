/**
 * `@builderforce/agent-tools/prefetch` — the SHARED deterministic-first PreFetch actions
 * (docs/design/deterministic-prefetch.md): the registry rows and executors every surface
 * with a workspace and a shell runs identically — the editor (VSIX) and on-prem
 * (agent-runtime) — plus tool detection. ONE copy; a surface adds only what is its own
 * (the editor's LSP diagnostics) and its probe for detection
 * (`@builderforce/agent-tools/node-prefetch`).
 *
 * Pure: every tool runs through the host's `CapabilityProvider` (its shell and repo).
 */

import { typecheckWithTsc, archBoundaries, depsAudit, lintCheck, secretsScan, testsRelated } from './checkExecutors.js';
import { codePackExecutors } from './codePackExecutors.js';
import type { PrefetchExecHost, PrefetchRunner } from './contract.js';
import { DIAG_TYPECHECK } from './rows.js';
import { writeExecutors } from './writeExecutors.js';

export * from './contract.js';
export { AUDIT_TOOL, PREFETCH_TOOLS, TOOL_GROUPS, declaredPackages, detectTools, offeredToolIds, type ToolProbe } from './tools.js';
export { DIAG_TYPECHECK, SHARED_PREFETCH_ROWS } from './rows.js';
export { PREFETCH_LIST_CAP, PREFETCH_OUTPUT_CAP, PREFETCH_SCRATCH_DIR, capOutput, fenced, safePath } from './exec.js';
export {
    OPEN_IN_GRAPH_LABEL_KEY, OPEN_KNOWLEDGE_GRAPH_COMMAND, codePackFindings, forgetCodePackFindings, readPartitions,
} from './codePackExecutors.js';
export { parseCodemod } from './writeExecutors.js';
export {
    CHOOSE_FOLDER_LABEL_KEY, KNOWLEDGE_GRAPH, KNOWLEDGE_PREFETCH_ROWS, KNOWLEDGE_REVIEW_DIR, OPEN_KNOWLEDGE_REVIEW_COMMAND,
    graphFocusOf, knowledgeChipIntent, knowledgePrefetchExecutors, openInGraphChip, reviewInViewExecutor, reviewTargetOf,
    withKnowledgeRows,
    type KnowledgeChipIntent, type KnowledgeReviewSession, type KnowledgeRowsHost, type PortWithRows,
} from './knowledgeRows.js';
export { typecheckWithTsc };

/** One executor per {@link SHARED_PREFETCH_ROWS} row, run through `host`. */
export function sharedPrefetchExecutors(host: PrefetchExecHost): Record<string, PrefetchRunner> {
    return {
        [DIAG_TYPECHECK]: typecheckWithTsc(host),
        'lint.check': lintCheck(host),
        'arch.boundaries': archBoundaries(host),
        'deps.audit': depsAudit(host),
        'secrets.scan': secretsScan(host),
        'tests.related': testsRelated(host),
        ...codePackExecutors(host),
        ...writeExecutors(host),
    };
}
