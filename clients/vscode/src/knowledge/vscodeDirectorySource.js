/**
 * The editor's `DirectorySource` (PRD 38 §4.7, VS Code row): a workspace folder, or any
 * folder inside one, as memory's review reads it — the ONE filesystem walker
 * (`@builderforce/agent-tools/knowledge` `createFsDirectorySource`: SHA-256 per file,
 * skipped by the stat manifest when unchanged; `.builderforce/` state never listed) over `vscode.workspace.fs`
 * (`knowledgeFs.ts`), skipping the ONE list every host's review skips (`KNOWLEDGE_SKIP_DIRS`).
 *
 * This host hashes natively (`node:crypto`, the same lowercase-hex SHA-256) and never reads a
 * file the plan skips as too large (it needs the size only).
 */
import { createFsDirectorySource } from "@builderforce/agent-tools/knowledge";
import { CONTENT_HASH_RULE, DEFAULT_MAX_FILE_BYTES } from "@seanhogg/builderforce-memory/knowledge";
import { nodeContentHash } from "./nodeSha256";
/** Files listed between event-loop yields on the extension host (a UI thread must keep ticking). */
export const EVENT_LOOP_YIELD_EVERY = 250;
/** The yield's event-loop hand-off: a macrotask, so pending UI work (and timers) run before the walk continues. */
export const eventLoopYield = () => new Promise((resolve) => setTimeout(resolve, 0));
/**
 * Wraps a source's `list()` so the walk hands the event loop a macrotask every `every` files. Every
 * other member (read, watch, the skipped/git folders) passes through untouched. Pure decoration, so
 * a test walks a source synchronously by passing `yieldEvery: 0`.
 */
export function withEventLoopYield(source, every = EVENT_LOOP_YIELD_EVERY, yieldDelay = eventLoopYield) {
    if (every <= 0)
        return source;
    return {
        ...source,
        async *list() {
            let listed = 0;
            for await (const file of source.list()) {
                yield file;
                if (++listed % every === 0)
                    await yieldDelay();
            }
        },
    };
}
export function createDirectorySource(opts) {
    const { yieldEvery, yieldDelay, ...rest } = opts;
    return withEventLoopYield(
    // The hash and its rule go together: the stat manifest never reuses a hash made under another rule.
    createFsDirectorySource({ ...rest, hash: nodeContentHash, hashRule: CONTENT_HASH_RULE, skipHashAbove: DEFAULT_MAX_FILE_BYTES }), yieldEvery ?? EVENT_LOOP_YIELD_EVERY, yieldDelay ?? eventLoopYield);
}
//# sourceMappingURL=vscodeDirectorySource.js.map