/**
 * `@builderforce/agent-tools/knowledge-index` — a local host's knowledge index
 * (`knowledge/index/`): see that barrel. A root-level file so the subpath resolves the
 * same under every toolchain (the `exports` alias, and `@builderforce/agent-tools/*` →
 * `src/*` path maps).
 */

export * from './knowledge/index/index.js';
