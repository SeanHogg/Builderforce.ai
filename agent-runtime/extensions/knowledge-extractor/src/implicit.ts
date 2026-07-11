/**
 * Implicit Extraction Mode — Diff-Based (FR-3)
 *
 * Performs a structured diff between pre- and post-execution knowledge snapshots
 * (nodes, edges, beliefs) and converts detected changes into learning records.
 *
 * FR-3.1: Snapshot is a serialized knowledge graph / belief state.
 * FR-3.2: Three change types: ADDITION, MODIFICATION, RETRACTION.
 * FR-3.3: Each delta → candidate record with signal_type: IMPLICIT.
 * FR-3.4: Filter deltas below minSignificance threshold.
 * FR-3.5: MODIFICATION and RETRACTION preserve prior value.
 */

import type {
  KnowledgeDiff,
  KnowledgeSnapshot,
  LearningRecord,
  RunContext,
  ExtractorConfig,
} from "./types.js";

import { createLearningId, getExtractorVersion, nowISO } from "./utils.js";

// ============================================================================
// Top-level extraction function
// ============================================================================

export function extractImplicit(
  ctx: RunContext,
  config: ExtractorConfig,
): LearningRecord[] {
  const deltas = diffSnapshots(ctx.pre_snapshot, ctx.post_snapshot, config);

  return deltas.map((d) => {
    const status =
      d.magnitude >= config.acceptThreshold
        ? ("CANDIDATE" as const)
        : d.magnitude >= config.rejectThreshold
          ? ("CANDIDATE" as const)
          : ("REJECTED" as const);

    const changeType = mapDiffTypeToChangeType(d.type);

    return {
      learning_id: createLearningId(
        ctx.run_id,
        "IMPLICIT",
        `${d.type}:${d.path}:${String(d.current_value)}`,
      ),
      run_id: ctx.run_id,
      task_id: ctx.task_id,
      agent_id: ctx.agent_id,
      trigger_event: ctx.trigger_event,
      signal_type: "IMPLICIT" as const,
      change_type: changeType,
      content: formatDeltaContent(d),
      previous_value:
        d.type === "MODIFICATION" || d.type === "RETRACTION"
          ? serializeValue(d.previous_value)
          : null,
      rationale: null,
      confidence_score: 0, // Filled by confidence scoring engine (FR-6)
      extraction_timestamp: nowISO(),
      extractor_version: getExtractorVersion(),
      status: status,
    };
  });
}

// ============================================================================
// Diff algorithm
// ============================================================================

/**
 * Compare pre and post snapshots and return all deltas above the significance
 * threshold. Detects changes across three dimensions:
 *  1. Nodes (added/removed/modified attributes)
 *  2. Edges (added/removed/weight-changed)
 *  3. Beliefs (added/removed/confidence-changed)
 */
export function diffSnapshots(
  pre: KnowledgeSnapshot,
  post: KnowledgeSnapshot,
  config: ExtractorConfig,
): KnowledgeDiff[] {
  const deltas: KnowledgeDiff[] = [];

  // --- Node diffs ---
  const preNodes = new Map(pre.nodes.map((n) => [n.id, n]));
  const postNodes = new Map(post.nodes.map((n) => [n.id, n]));

  for (const node of post.nodes) {
    const existing = preNodes.get(node.id);
    if (!existing) {
      // ADDITION: new node in post that wasn't in pre
      deltas.push({
        type: "ADDITION",
        path: `nodes.${node.id}`,
        previous_value: null,
        current_value: { label: node.label, attributes: node.attributes },
        magnitude: 1.0,
      });
    } else {
      // MODIFICATION: check label and attributes changes
      const labelDelta = computeMagnitude(existing.label, node.label);
      const attrDelta = diffAttributes(existing.attributes, node.attributes);
      const combined = Math.min(1.0, (labelDelta + attrDelta) / 2);
      if (combined >= config.minSignificance) {
        deltas.push({
          type: "MODIFICATION",
          path: `nodes.${node.id}`,
          previous_value: { label: existing.label, attributes: existing.attributes },
          current_value: { label: node.label, attributes: node.attributes },
          magnitude: combined,
        });
      }
    }
  }

  // RETRACTION: nodes in pre but not in post
  for (const node of pre.nodes) {
    if (!postNodes.has(node.id)) {
      deltas.push({
        type: "RETRACTION",
        path: `nodes.${node.id}`,
        previous_value: { label: node.label, attributes: node.attributes },
        current_value: null,
        magnitude: 1.0,
      });
    }
  }

  // --- Edge diffs ---
  const edgeKey = (e: { source: string; target: string; label?: string }): string =>
    `${e.source}→${e.target}${e.label ? `:${e.label}` : ""}`;

  const preEdges = new Map(pre.edges.map((e) => [edgeKey(e), e]));
  const postEdges = new Map(post.edges.map((e) => [edgeKey(e), e]));

  for (const edge of post.edges) {
    const key = edgeKey(edge);
    const existing = preEdges.get(key);
    if (!existing) {
      deltas.push({
        type: "ADDITION",
        path: `edges.${key}`,
        previous_value: null,
        current_value: edge,
        magnitude: 1.0,
      });
    } else if (Math.abs(existing.weight - edge.weight) >= config.minSignificance) {
      deltas.push({
        type: "MODIFICATION",
        path: `edges.${key}.weight`,
        previous_value: existing.weight,
        current_value: edge.weight,
        magnitude: Math.abs(existing.weight - edge.weight),
      });
    }
  }

  for (const edge of pre.edges) {
    const key = edgeKey(edge);
    if (!postEdges.has(key)) {
      deltas.push({
        type: "RETRACTION",
        path: `edges.${key}`,
        previous_value: edge,
        current_value: null,
        magnitude: 1.0,
      });
    }
  }

  // --- Belief diffs ---
  const preBeliefs = new Map(pre.beliefs.map((b) => [b.statement, b]));
  const postBeliefs = new Map(post.beliefs.map((b) => [b.statement, b]));

  for (const belief of post.beliefs) {
    const existing = preBeliefs.get(belief.statement);
    if (!existing) {
      deltas.push({
        type: "ADDITION",
        path: `beliefs.${belief.statement}`,
        previous_value: null,
        current_value: { confidence: belief.confidence, source: belief.source },
        magnitude: 1.0,
      });
    } else if (Math.abs(existing.confidence - belief.confidence) >= config.minSignificance) {
      deltas.push({
        type: "MODIFICATION",
        path: `beliefs.${belief.statement}.confidence`,
        previous_value: existing.confidence,
        current_value: belief.confidence,
        magnitude: Math.abs(existing.confidence - belief.confidence),
      });
    }
  }

  for (const belief of pre.beliefs) {
    if (!postBeliefs.has(belief.statement)) {
      deltas.push({
        type: "RETRACTION",
        path: `beliefs.${belief.statement}`,
        previous_value: { confidence: belief.confidence, source: belief.source },
        current_value: null,
        magnitude: 1.0,
      });
    }
  }

  return deltas;
}

// ============================================================================
// Helpers
// ============================================================================

function mapDiffTypeToChangeType(diffType: KnowledgeDiff["type"]): LearningRecord["change_type"] {
  switch (diffType) {
    case "ADDITION":
      return "ADDITION";
    case "MODIFICATION":
      return "MODIFICATION";
    case "RETRACTION":
      return "RETRACTION";
  }
}

function computeMagnitude(prev: string, curr: string): number {
  if (prev === curr) return 0;
  // Simple character-level Levenshtein-like ratio
  const maxLen = Math.max(prev.length, curr.length);
  if (maxLen === 0) return 0;
  const edits = simpleEditDistance(prev, curr);
  return Math.min(1.0, edits / maxLen);
}

function simpleEditDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
    }
  }
  return dp[m][n];
}

function diffAttributes(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
): number {
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  if (allKeys.size === 0) return 0;

  let changed = 0;
  for (const key of allKeys) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(curr[key])) {
      changed++;
    }
  }
  return changed / allKeys.size;
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatDeltaContent(d: KnowledgeDiff): string {
  const label = d.path;
  switch (d.type) {
    case "ADDITION":
      return `New knowledge added: ${label} = ${serializeValue(d.current_value)}`;
    case "MODIFICATION":
      return `Knowledge modified: ${label} changed from ${serializeValue(d.previous_value)} to ${serializeValue(d.current_value)}`;
    case "RETRACTION":
      return `Knowledge retracted: ${label} removed (was ${serializeValue(d.previous_value)})`;
  }
}