import { buildNodeCapabilityProvider } from "../../agents/node-capability-provider.js";
import { onPremTreeSitterDir } from "../../agents/on-prem-symbol-index.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { searchWorkspaceCodeIndex, workspaceCodeEmbedder } from "@seanhogg/builderforce-code-index";

const log = createSubsystemLogger("workspace/code-search");

interface SearchOptions {
  projectRoot: string;
  query: string;
  topK?: number;
  language?: string;
  rebuild?: boolean;
}

/** The old search tool shapes remain callable against the Workspace index. */
export async function searchWorkspace(options: SearchOptions, lexicalOnly: boolean): Promise<Record<string, unknown>> {
  const query = options.query.trim();
  if (!query) return { error: "query is required" };
  const { projectRoot: root, rebuild } = options;
  const extension = options.language?.trim().replace(/^\./, "");
  const topK = options.topK;
  const limit = typeof topK === "number" && Number.isFinite(topK) ? Math.min(20, Math.max(1, Math.floor(topK))) : 10;
  try {
    const wasmDir = onPremTreeSitterDir();
    const files = buildNodeCapabilityProvider({ workspaceRoot: root }).repoRead!;
    const embedder = extension ? undefined : await workspaceCodeEmbedder().catch(() => {
      log.debug("Workspace embedder unavailable, using lexical search");
      return undefined;
    });
    const result = await searchWorkspaceCodeIndex({
      root, files, query, limit: 3 * limit, lexicalOnly, ...(rebuild ? { rebuild } : {}), waitForIndexMs: 5_000,
      ...(extension ? { extension } : {}), ...(embedder ? { embedder } : {}), ...(wasmDir ? { wasmDir } : {}),
    });
    const filesByPath = new Map<string, { filePath: string; score: number; symbols: string[]; snippet: string }>();
    for (const { path, score, symbol, snippet } of result.results ?? []) {
      const existing = filesByPath.get(path);
      if (!existing) {
        if (filesByPath.size >= limit) continue;
        filesByPath.set(path, { filePath: path, score: score ?? 0, symbols: symbol ? [symbol] : [], snippet });
      } else if (symbol && existing.symbols.length < 8 && !existing.symbols.includes(symbol)) {
        existing.symbols.push(symbol);
      }
    }
    return {
      query,
      ...(result.indexing ? { indexing: true } : {}),
      ...(result.partial ? { partial: true } : {}),
      ...(result.indexedFiles !== undefined ? { indexedFiles: result.indexedFiles } : {}),
      results: [...filesByPath.values()],
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Workspace search failed" };
  }
}
