/**
 * The pin number of a finding, ONCE: its 1-based place in the graph's own findings order. The left rail's
 * stop tags and the Act rail's cards both read it, so the "2" beside a station is the "2" on its card.
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';

/** finding id → its 1-based place in `findings` (pass `graph.findings`, never a scoped or ranked copy). */
export function pinNumbers(findings: readonly Finding[]): Map<string, number> {
    return new Map(findings.map((f, i) => [f.id, i + 1] as const));
}
