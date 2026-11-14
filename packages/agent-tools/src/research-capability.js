/**
 * The `local.research` capability — a LOCAL model on the developer's machine that reads
 * files and answers the paid model's question about them (`local_research`).
 *
 * The surface owns everything machine-specific: which local runtime serves (the hybrid
 * local tier — Synapse native first, Ollama last), how a file is fingerprinted, and where
 * the answer cache persists. The tool (`local-research-tool.ts`) owns the policy: which
 * files to read, the excerpt budget, the time limit, and the cache key. Runtime-agnostic.
 */
export {};
//# sourceMappingURL=research-capability.js.map