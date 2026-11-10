/**
 * engine/findingFacts.ts — the ONE definition of the finding predicates the engine, the verdicts, the
 * headline and the blocking policy share.
 */

import { pathOfRef } from '@seanhogg/builderforce-memory/knowledge';
import type { DeltaFinding } from '../contract.js';

/** The root-relative file a finding member names: a `src:` node ref's path, or a plain path with any `#symbol` cut. */
export const memberPath = (member: string): string => pathOfRef(member) ?? member.split('#')[0]!;

/** Introduced or changed by this run, not waived: what verdicts and blocking count. `present` never counts. */
export const isFresh = (f: DeltaFinding): boolean => !f.waiver && (f.lineage === 'introduced' || f.lineage === 'changed');

/** A finding that takes part in a verdict at all (not `present`, not waived). */
export const isOpen = (f: DeltaFinding): boolean => !f.waiver && f.lineage !== 'present';
