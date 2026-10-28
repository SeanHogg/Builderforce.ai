/**
 * @builderforce/agent-tools — the runtime-agnostic agent tool contract shared by the
 * cloud (Cloudflare Worker `api`) and on-prem (Node `agent-runtime`) engines.
 *
 * One {@link ToolDefinition} shape, capability-gated by a {@link CapabilityProvider},
 * collected in a {@link ToolRegistry}, driven by an injectable {@link AgentEngine}.
 * Import this package — never duplicate the contract per runtime.
 */

export * from "./capabilities.js";
export * from "./modelRoles.js";
export * from "./edit.js";
// Path overlap — the rule a planner's hand-off uses to decide which tasks may run side
// by side in one working tree.
export * from "./workstreamScope.js";
export * from "./jsonKeyRead.js";
export * from "./glob.js";
export * from "./tool.js";
export * from "./registry.js";
export * from "./toolAliases.js";
export * from "./engine.js";
export * from "./spec.js";
export * from "./core-tools.js";
export * from "./writeOverwriteGuard.js";
export * from "./psychometric-dims.js";
export * from "./psychometrics.js";
export * from "./knowledge-notes.js";
export * from "./run-knowledge.js";
export * from "./skill-tools.js";
export * from "./subagent-tools.js";
export * from "./live-subagent-tools.js";
export * from "./git-tools.js";
// The run's default checkout in a folder that CONTAINS checkouts (pure resolver).
export * from "./defaultRepo.js";
export * from "./symbols.js";
export * from "./symbol-tools.js";
export * from "./semantic-tools.js";
export * from "./stableStringify.js";
export * from './codeAnalysis.js';
export { savedCodeAnalysisSummary } from './codeAnalysisTool.js';
// The code pack for memory's knowledge graph (PRD 38); also the `./knowledge` subpath.
export * from './knowledge/index.js';
// The ONE lexical scorer (tool_search / skill ranking) + the deferred-tool meta tool.
export * from "./toolSearch.js";
// LLMLingua-2 compression policy for oversized prose (cost lever C8); the compressor is
// injected and fenced code is never sent.
export * from "./compress.js";
// Adaptive retrieval depth (cost lever C4): start at 3, widen only on a flat score field.
export * from "./retrievalK.js";
// Prose-only compression (`compressProse`, code never) + the `read_compressed` tool (C8).
export * from "./proseCompress.js";
export * from "./read-compressed-tool.js";
// Deterministic pre-search (identifiers → symbol index + text search, no model call) and
// the model-free "where is X defined" answer.
export * from "./preSearch.js";
export * from "./symbolAnswer.js";
// The paths a text names — the context pack's focus and run-end memory's file anchors.
export * from "./focusPaths.js";
// `local_research`: a local model reads files and answers; its (question, file set) cache.
export * from "./researchCache.js";
export * from "./local-research-tool.js";
// `repo_map` from the local definition index when Builderforce Desktop is absent.
export * from "./symbolRepoMap.js";
