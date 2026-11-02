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

/**
 * The bound the graph's `NodeRef` column carries (PRD 38 §4.8): a ref is at most 512
 * characters. A producer can still emit a longer one (a deep path plus a long section
 * slug), so the WRITER drops what would not round-trip instead of rejecting the whole
 * upload — one over-long ref must never 400 an entire review's extracted output.
 */
export const MAX_REF_CHARS = 512;

/** Extracted output with every node label reduced to one bounded line. */
export function clampExtracted(extracted: readonly Extracted[]): Extracted[] {
  return extracted.map((e) => ({ ...e, nodes: e.nodes.map((n) => ({ ...n, label: oneLineLabel(n.label) })) }));
}

export interface SanitizedExtracted { entries: Extracted[]; skippedRefs: number }

/**
 * Extracted output with every over-long ref dropped, and how many were dropped. A node
 * whose ref exceeds the bound, an edge touching one at either endpoint, and a key whose
 * ref exceeds it are dropped individually; an entry whose own `sourceRef` exceeds it is
 * dropped whole (its nodes/edges/keys cannot be traced to a source the server knows).
 */
export function sanitizeExtracted(extracted: readonly Extracted[]): SanitizedExtracted {
  let skippedRefs = 0;
  const entries: Extracted[] = [];
  for (const e of extracted) {
    if (e.sourceRef.length > MAX_REF_CHARS) {
      skippedRefs += 1 + e.nodes.length + e.edges.length + e.keys.length;
      continue;
    }
    const nodes = e.nodes.filter((n) => {
      const keep = n.ref.length <= MAX_REF_CHARS;
      if (!keep) skippedRefs += 1;
      return keep;
    });
    const edges = e.edges.filter((ed) => {
      const keep = ed.from.length <= MAX_REF_CHARS && ed.to.length <= MAX_REF_CHARS;
      if (!keep) skippedRefs += 1;
      return keep;
    });
    const keys = e.keys.filter((k) => {
      const keep = k.ref.length <= MAX_REF_CHARS;
      if (!keep) skippedRefs += 1;
      return keep;
    });
    entries.push({ ...e, nodes, edges, keys });
  }
  return { entries, skippedRefs };
}
