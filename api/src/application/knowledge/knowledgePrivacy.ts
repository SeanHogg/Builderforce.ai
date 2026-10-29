/**
 * knowledgePrivacy — the application layer's adapter onto the knowledge graph's privacy
 * bound (PRD 38 §5.2): the platform stores a model's JUDGEMENT about a source, never the
 * source. The bound itself — how many lines and characters a claim may quote and say
 * (`clampClaim`, `MAX_CLAIM_TEXT_CHARS`, `clampQuote`), what makes a label one line
 * (`oneLineLabel`) — is stated ONCE, in builderforce-memory. The writer applies `clampClaim`
 * to a model's fact straight from memory; this file applies the label bound to what a host
 * uploads, so a host that sends a whole file body as a node label cannot park it in R2.
 */
import { oneLineLabel, type Extracted } from '@seanhogg/builderforce-memory/knowledge';

/** Extracted output with every node label reduced to one bounded line. */
export function clampExtracted(extracted: readonly Extracted[]): Extracted[] {
  return extracted.map((e) => ({ ...e, nodes: e.nodes.map((n) => ({ ...n, label: oneLineLabel(n.label) })) }));
}
