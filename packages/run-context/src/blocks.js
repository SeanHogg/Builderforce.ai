/**
 * The run-context CONTRACT — one definition of the context blocks a run can receive.
 *
 * Before this package the same question ("what does an agent run get told?") had three
 * different answers, one per surface:
 *
 *   • cloud   — `api/src/application/runtime/cloudAgentEngine.ts` → `prepareCloudRun`
 *   • on-prem — `agent-runtime/src/agents/embedded-runner/system-prompt.ts`
 *   • VS Code — `clients/vscode/src/prompt.ts`
 *
 * …and only the cloud one carried PRD / governance / project memory / lessons. This file
 * is the single taxonomy all three now assemble against. It is deliberately free of I/O,
 * node builtins, and dependencies: the api OWNS the data and serves an assembled
 * {@link RunContextEnvelope} over HTTP; every surface renders the SAME blocks.
 */
export const RUN_CONTEXT_CONTRACT_VERSION = 1;
/** Kind → section heading used when a surface renders blocks it did not author. */
export const RUN_CONTEXT_KIND_LABELS = {
    directive: 'Directive',
    strategy: 'Strategy',
    prd: 'PRD',
    governance: 'Governance',
    workspace: 'Workspace',
    prior_changes: 'Prior changes',
    task: 'Task',
    memory: 'Project memory',
    lessons: 'Lessons',
    capabilities: 'Capabilities',
    tooling: 'Tooling',
};
/** Sort blocks into their stable render order (channel-independent). */
export function sortBlocks(blocks) {
    return [...blocks].sort((a, b) => a.order - b.order || a.subject.localeCompare(b.subject));
}
/**
 * A block's canonical Evermind subject key. Scope-qualified so two projects (or two
 * sessions) never collide on one incumbent, and prefixed so run-context beliefs are
 * distinguishable from every other fact in the same store.
 */
export function contextSubjectKey(scope, block) {
    return `runctx:${scope}:${block.kind}:${block.subject}`;
}
//# sourceMappingURL=blocks.js.map