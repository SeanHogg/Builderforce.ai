/**
 * knowledgePrivacy — the application layer's adapter onto the knowledge graph's privacy
 * bound (PRD 38 §5.2): the platform stores a model's JUDGEMENT about a source, never the
 * source. The bound itself — how many lines and characters a claim may quote, what makes a
 * label one line — is stated ONCE, in builderforce-memory (`clampQuote`, `MAX_QUOTE_LINES`,
 * `MAX_QUOTE_CHARS`, `oneLineLabel`); this file only applies it to what a host uploads, so a
 * host that sends a whole file body as a "claim" cannot park it in project memory or R2.
 */
import { clampQuote, oneLineLabel, type Extracted } from '@seanhogg/builderforce-memory/knowledge';

/** A model's claim as it may be stored: memory's line AND character bound on a quote. */
export const clampClaim = (content: string): string => clampQuote(content);

/** Extracted output with every node label reduced to one bounded line. */
export function clampExtracted(extracted: readonly Extracted[]): Extracted[] {
  return extracted.map((e) => ({ ...e, nodes: e.nodes.map((n) => ({ ...n, label: oneLineLabel(n.label) })) }));
}
