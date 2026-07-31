// inference.ts — implicit dependency inference (FR-1.3, FR-1.4)

import type { TaskInput } from "./types";

/**
 * Configuration for implicit dependency inference.
 */
export interface InferenceConfig {
  /** Enable/disable implicit inference (FR-1.4). Default: true. */
  enabled: boolean;
  /** Minimum token overlap score (0–1) to consider tasks dependent. Default: 0.5. */
  threshold: number;
}

const DEFAULT_CONFIG: InferenceConfig = { enabled: true, threshold: 0.5 };

/**
 * Infer implicit dependencies between tasks based on shared output/input tokens
 * in task names and descriptions.
 *
 * NEVER overrides explicit `depends_on` declarations (FR-1.4).
 *
 * Strategy:
 *  1. Tokenize each task's name + description into word bigrams.
 *  2. For each pair (A, B) where A ≠ B, compute a Jaccard-like overlap score.
 *  3. If A's description mentions producing something B's description mentions
 *     consuming (detected via keyword heuristics), add A → B dependency.
 *  4. Otherwise, if overlap score exceeds threshold, add the dependency
 *     in lexical order (earlier ID depends on later ID if they share terms).
 */
export function inferDependencies(
  tasks: TaskInput[],
  config: Partial<InferenceConfig> = {},
): TaskInput[] {
  const cfg: InferenceConfig = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled) return tasks;

  const ids = new Set(tasks.map((t) => t.id));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Gather explicit deps so we never override
  const explicitDeps = new Map<string, Set<string>>();
  for (const t of tasks) {
    explicitDeps.set(t.id, new Set(t.depends_on ?? []));
  }

  // Tokenize each task
  const tokens = new Map<string, Set<string>>();
  for (const t of tasks) {
    const text = `${t.name} ${t.description ?? ""}`.toLowerCase();
    const words = text
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
      .filter((w) => !STOP_WORDS.has(w));
    // Bigrams for context
    const bigrams = new Set<string>();
    for (let i = 0; i < words.length - 1; i++) {
      bigrams.add(`${words[i]}:${words[i + 1]}`);
    }
    // Also include individual meaningful words
    for (const w of words) {
      bigrams.add(w);
    }
    tokens.set(t.id, bigrams);
  }

  // Keyword patterns for output/input relationships
  const outputPatterns = [
    /\b(produce|output|generate|create|build|write|emit|export|publish)s?\b/i,
    /\b(generate|produce)s?\s+(?:a|an|the)\s+/i,
  ];
  const inputPatterns = [
    /\b(consume|input|read|receive|import|ingest|load|fetch|parse)s?\b/i,
    /\bdepends\s+on\b/i,
    /\brequires?\s+(?:a|an|the)\s+/i,
  ];

  const producesOutput = (t: TaskInput): boolean =>
    outputPatterns.some((p) => p.test(`${t.name} ${t.description ?? ""}`));
  const consumesInput = (t: TaskInput): boolean =>
    inputPatterns.some((p) => p.test(`${t.name} ${t.description ?? ""}`));

  // Sort tasks for deterministic results
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (a.id === b.id) continue;

      const aTokens = tokens.get(a.id)!;
      const bTokens = tokens.get(b.id)!;

      // Jaccard similarity
      const intersection = [...aTokens].filter((t) => bTokens.has(t)).length;
      const union = new Set([...aTokens, ...bTokens]).size;
      const score = union > 0 ? intersection / union : 0;

      // Skip if below threshold
      if (score < cfg.threshold) continue;

      // Determine direction based on output/input heuristics
      const aProduces = producesOutput(a);
      const bProduces = producesOutput(b);
      const aConsumes = consumesInput(a);
      const bConsumes = consumesInput(b);

      let from: string | null = null;
      let to: string | null = null;

      if (aProduces && bConsumes) {
        from = a.id;
        to = b.id;
      } else if (bProduces && aConsumes) {
        from = b.id;
        to = a.id;
      } else if (aProduces && !bProduces) {
        from = a.id;
        to = b.id;
      } else if (bProduces && !aProduces) {
        from = b.id;
        to = a.id;
      } else if (score >= 0.8) {
        // Very high overlap: earlier ID → later ID (lexicographic)
        from = a.id;
        to = b.id;
      }

      if (from && to) {
        // NEVER override explicit deps
        const existing = explicitDeps.get(to) ?? new Set();
        if (!existing.has(from)) {
          const t = taskMap.get(to)!;
          t.depends_on = [...(t.depends_on ?? []), from];
          explicitDeps.set(to, new Set(t.depends_on));
        }
      }
    }
  }

  return tasks;
}

/**
 * Common English stop words to filter during tokenization.
 */
const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "are",
  "was", "will", "can", "not", "but", "all", "has", "been", "its",
  "our", "you", "your", "their", "they", "each", "more", "some",
  "into", "over", "than", "then", "also", "just", "about", "what",
  "when", "where", "which", "there", "other", "only", "most", "one",
  "two", "new", "use", "used", "using", "make", "made", "does",
]);
