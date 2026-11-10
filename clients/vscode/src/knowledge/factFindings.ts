/**
 * The knowledge view's findings, from the root's fact index (PRD 41 §B5, M5): the generic finding rules (memory
 * `KNOWLEDGE_FINDING_RULES`) and the code pack's (`CODE_FACT_RULES`) are evaluated by the root's {@link FactIndex} —
 * incrementally, behind `knowledgeInputHash` — and handed to memory's `buildGraph` as its `FindingsProvider`: memory gives
 * it the WHOLE (untruncated) graph, runs no built-in rule of the kinds it owns, and keeps every other finding (the docs
 * pack's). ONE findings path, cut view or not.
 *
 * The provider is passed only once the index has SYNCED this session: a cold (or merely restored) index would replace the
 * built-in findings with partial ones for the kinds it owns. Until then the built-in rules stand. A root without a
 * running indexer has no fact index.
 */

import { CODE_FACT_RULES } from "@builderforce/agent-tools/knowledge";
import { KNOWLEDGE_FINDING_RULES, type FindingsProvider } from "@seanhogg/builderforce-memory/knowledge";
import type { FactIndex } from "./factIndex";

const indexes = new Map<string, FactIndex>();

/** The root's fact index while its background indexer runs. */
export function registerFactIndex(rootId: string, index: FactIndex): () => void {
  indexes.set(rootId, index);
  return () => { if (indexes.get(rootId) === index) indexes.delete(rootId); };
}

export const factIndexOf = (rootId: string): FactIndex | undefined => indexes.get(rootId);

/**
 * The finding kinds the fact index's knowledge rules own. A memory knowledge rule's id IS its kind; a code rule's id is
 * `code.<kind>` (`codeFindings.ts`).
 */
export const FACT_RULE_FINDING_KINDS: readonly string[] = [
  ...KNOWLEDGE_FINDING_RULES.map((r) => r.id),
  ...CODE_FACT_RULES.map((r) => r.id.replace(/^code\./, "")),
];

/**
 * The fact index as `buildGraph`'s findings provider; undefined while there is none or it has not synced. Its findings come
 * from memory's rules (`finding()` ids), evaluated incrementally over the knowledge input memory hands in.
 */
export function factFindingsProvider(index: FactIndex | undefined): FindingsProvider | undefined {
  if (!index?.synced) return undefined;
  const owned = new Set(FACT_RULE_FINDING_KINDS);
  return {
    kinds: FACT_RULE_FINDING_KINDS,
    findings: ({ knowledge }) => index.setKnowledge(knowledge).filter((f) => owned.has(f.kind)),
  };
}
