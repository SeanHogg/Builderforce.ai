import * as memory from "@seanhogg/builderforce-memory";
import * as engine from "@seanhogg/builderforce-memory-engine";
import type { ExperienceEngine, ExperienceHost } from "@seanhogg/builderforce-memory-mcp/experience";
import { IDBFactory } from "fake-indexeddb";

/**
 * The experience host (Teach-once episodes, skills, runs, the private model) and the
 * one way this feature remembers a fact.
 *
 * ## Where the files live
 *
 * The extension keeps no memory file of its own: its durable memory is the machine-wide
 * store every builderforce-memory client shares (`~/.builderforce-memory/memory.json`,
 * resolved by memory-mcp's ONE `resolveMemoryFile`, honouring `BUILDERFORCE_MEMORY_FILE`).
 * Experience sits BESIDE that file (`experience.json`, `episodes/`), exactly where the
 * memory MCP server's own experience tools keep it, so both see the same skills.
 *
 * ## Remembering
 *
 * A fact goes through memory-mcp's store backend (`createLocalMemoryStoreBackend`), the
 * same code the MCP server's `memory_remember` runs — this module never writes
 * `memory.json` itself.
 */

export interface ExperienceHostProviderOptions {
  /** The configured private model file (`builderforce.agents.modelFile`), or undefined. */
  modelFile(): string | undefined;
}

export interface ExperienceHostProvider {
  /** The host, opened on first use and re-opened when the model file setting changed. Rejects (naming why) when the engine peer is missing. */
  get(): Promise<ExperienceHost>;
  /** Remember one fact in the shared memory file. */
  remember(fact: { key: string; content: string; tags: string[]; importance?: number }): Promise<void>;
}

export function createExperienceHostProvider(opts: ExperienceHostProviderOptions): ExperienceHostProvider {
  let opened: { modelFile: string | undefined; host: Promise<ExperienceHost> } | undefined;
  let backend: Promise<{ remember?: (input: { key: string; content: string; tags?: string[]; importance?: number }) => Promise<void> }> | undefined;

  const memoryFile = async (): Promise<string> => {
    const { resolveMemoryFile } = await import("@seanhogg/builderforce-memory-mcp");
    return resolveMemoryFile(process.env);
  };

  return {
    get() {
      const modelFile = opts.modelFile();
      if (!opened || opened.modelFile !== modelFile) {
        const host = (async () => {
          const { openExperienceHost } = await import("@seanhogg/builderforce-memory-mcp/experience");
          // The bundled engine is handed in: memory-mcp's own indirect import cannot see a bundle.
          return openExperienceHost({ memoryFile: await memoryFile(), engine: engine as unknown as ExperienceEngine, ...(modelFile ? { modelFile } : {}) });
        })();
        opened = { modelFile, host };
        // A failed open must not be cached: the next call tries again.
        host.catch(() => {
          if (opened?.host === host) opened = undefined;
        });
      }
      return opened.host;
    },
    async remember(fact) {
      backend ??= (async () => {
        const { createLocalMemoryStoreBackend } = await import("@seanhogg/builderforce-memory-mcp");
        // The bundled memory module and an in-memory IndexedDB are handed in (nothing is imported by name at run time).
        return createLocalMemoryStoreBackend({ persistFile: await memoryFile(), semanticRecall: false, memory, idbFactory: new IDBFactory() });
      })();
      try {
        const b = await backend;
        if (!b.remember) throw new Error("the memory backend is read-only");
        await b.remember(fact);
      } catch (error) {
        backend = undefined;
        throw error;
      }
    },
  };
}
