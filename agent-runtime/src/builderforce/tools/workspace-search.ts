import { buildNodeCapabilityProvider } from "../../agents/node-capability-provider.js";
import { onPremTreeSitterDir } from "../../agents/on-prem-symbol-index.js";
import { searchWorkspaceCodeIndex, workspaceCodeEmbedder } from "@seanhogg/builderforce-code-index";

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
    const embedder = extension ? undefined : await workspaceCodeEmbedder().catch(() => undefined);
    const result = await searchWorkspaceCodeIndex({
      root, files, query, limit, lexicalOnly, ...(rebuild ? { rebuild } : {}), waitForIndexMs: 5_000,
      ...(extension ? { extension } : {}), ...(embedder ? { embedder } : {}), ...(wasmDir ? { wasmDir } : {}),
    });
    return {
      query,
      ...(result.indexing ? { indexing: true } : {}),
      ...(result.partial ? { partial: true } : {}),
      ...(result.indexedFiles !== undefined ? { indexedFiles: result.indexedFiles } : {}),
      results: (result.results ?? []).map(({ path, score, symbol, snippet }) => ({
        filePath: path, score, symbols: symbol ? [symbol] : [], snippet,
      })),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Workspace search failed" };
  }
}
