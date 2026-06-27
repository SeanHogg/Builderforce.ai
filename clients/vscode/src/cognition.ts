/**
 * Evermind Write-Through Cognition for the IDE agent.
 *
 * Gives the in-editor agent the same self-updating memory the cloud/on-prem
 * agents have: relevant facts are recalled into the prompt, and a fact the agent
 * remembers SUPERSEDES its incumbent (replace-on-write under a stable key)
 * instead of accumulating. Backed by `EvermindCognition` from the published
 * `@seanhogg/builderforce-memory`, over a small disk-backed fact store at
 * `<workspace>/.builderforce/cognition.json` (no IndexedDB/GPU needed).
 *
 * The extension is bundled with esbuild, so this ESM-only package is imported
 * normally — no dynamic-import workaround.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { EvermindCognition, type CognitionFactStore } from "@seanhogg/builderforce-memory";
import type { ChatMessage } from "./gateway";
import type { ToolDef } from "./fileTools";

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/\W+/).filter(Boolean));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = new Set([...a, ...b]).size || 1;
  return inter / union;
}

/**
 * Disk-backed {@link CognitionFactStore} (+ lexical `recallSimilar`). Satisfies
 * the store interface `EvermindCognition` expects without IndexedDB or an SSM
 * runtime — the IDE host has neither. `recallSimilar` lets cognition's recall
 * rank facts; absent a GPU embedder it's lexical (Jaccard), same graceful
 * fallback the runtime's `MemoryStore` uses.
 */
class DiskFactStore implements CognitionFactStore {
  private readonly facts = new Map<string, string>();
  private loaded = false;
  constructor(private readonly file: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const obj = JSON.parse(await fs.readFile(this.file, "utf-8")) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) this.facts.set(k, String(v));
    } catch {
      /* fresh store */
    }
    this.loaded = true;
  }
  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(Object.fromEntries(this.facts), null, 2), "utf-8");
  }
  async remember(key: string, content: string): Promise<void> {
    await this.load();
    this.facts.set(key, content);
    await this.persist();
  }
  async recall(key: string): Promise<{ content: string } | undefined> {
    await this.load();
    const c = this.facts.get(key);
    return c === undefined ? undefined : { content: c };
  }
  async forget(key: string): Promise<void> {
    await this.load();
    this.facts.delete(key);
    await this.persist();
  }
  async recallSimilar(query: string, topK: number): Promise<Array<{ key: string; content: string }>> {
    await this.load();
    const q = tokenize(query);
    const scored = [...this.facts.entries()].map(([key, content]) => ({
      key,
      content,
      score: jaccard(q, tokenize(content)),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ key, content }) => ({ key, content }));
  }
}

let cached: { root: string; cog: EvermindCognition } | null = null;

/** Lazily builds Evermind cognition for a workspace (memoised per root). */
function getCognition(root: string): EvermindCognition {
  if (cached && cached.root === root) return cached.cog;
  const store = new DiskFactStore(path.join(root, ".builderforce", "cognition.json"));
  const cog = new EvermindCognition({ store });
  cached = { root, cog };
  return cog;
}

/** A `system` message of facts relevant to `query`, or null when none/unavailable. */
export async function recallSystemMessage(
  root: string | undefined,
  query: string,
): Promise<ChatMessage | null> {
  if (!root || !query.trim()) return null;
  try {
    const facts = await getCognition(root).recall(query, 5);
    if (facts.length === 0) return null;
    return {
      role: "system",
      content: `[Evermind memory — facts recalled for this request]\n${facts.map((f) => `- ${f}`).join("\n")}`,
    };
  } catch {
    return null;
  }
}

/** Commit a belief write-through (replace-on-write). Returns the verdict, or null. */
async function rememberFact(
  root: string | undefined,
  key: string,
  content: string,
): Promise<string | null> {
  if (!root || !key || !content) return null;
  try {
    const r = await getCognition(root).commit({ subjectKey: key, content });
    return r.verdict;
  } catch {
    return null;
  }
}

/**
 * The agent's write side: a `remember_fact` tool routed through Write-Through
 * Cognition, so a fact about the same key supersedes its incumbent. Mirrors the
 * cloud/on-prem `memory_remember` tool. Non-mutating to the user's source — it
 * only writes the `.builderforce/cognition.json` memory file.
 */
export function cognitionToolDefs(): ToolDef[] {
  return [
    {
      name: "remember_fact",
      description:
        "Persist a durable fact about this project under a STABLE key (e.g. 'auth-flow', 'pkg:foo'). A new fact for the same key supersedes the old one (write-through, replace-on-write) instead of duplicating. Use for decisions, conventions, and locations worth recalling next session.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Stable subject key identifying what the fact is about." },
          content: { type: "string", description: "The fact to remember." },
        },
        required: ["key", "content"],
      },
      mutating: false,
      execute: async (args, root) => {
        const verdict = await rememberFact(root, String(args.key ?? ""), String(args.content ?? ""));
        return verdict
          ? `Remembered '${String(args.key)}' (${verdict}).`
          : "Memory is unavailable in this workspace.";
      },
    },
  ];
}
