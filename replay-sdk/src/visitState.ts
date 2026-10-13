/**
 * Per-visit recorder state that must survive page loads of the same visit.
 *
 * A visit spans page loads, so `seq` continues (ingest counts a session on
 * `seq 0` and stores chunks by `seq`), the keep decision holds, the mark cap
 * is per visit, quick back sees the previous page, and active time adds up.
 */

import type { KeepReason, PageSample } from '@builderforce/interaction-contract';
import { readStored, writeStored } from './ids';

export interface VisitState {
  visitId: string;
  /** Visit start, epoch ms. */
  startedAt: number;
  /** Next chunk seq. */
  seq: number;
  keep: KeepReason | null;
  /** Head-sample decision; null until made. */
  sampled: boolean | null;
  /** 1 / keepRate for a sampled recording, else 1. */
  sampleWeight: number;
  /** Marks sent so far this visit. */
  marks: number;
  /** Last three page entries (visit-relative ms). */
  pages: PageSample[];
  activeMs: number;
  /** Epoch ms of the last activity, or null. */
  lastActiveAt: number | null;
}

function fresh(visitId: string, now: number): VisitState {
  return {
    visitId,
    startedAt: now,
    seq: 0,
    keep: null,
    sampled: null,
    sampleWeight: 1,
    marks: 0,
    pages: [],
    activeMs: 0,
    lastActiveAt: null,
  };
}

function isState(value: unknown, visitId: string): value is VisitState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<VisitState>;
  return (
    v.visitId === visitId &&
    typeof v.startedAt === 'number' &&
    typeof v.seq === 'number' &&
    typeof v.marks === 'number' &&
    Array.isArray(v.pages) &&
    typeof v.sampleWeight === 'number' &&
    typeof v.activeMs === 'number'
  );
}

export class VisitStore {
  readonly state: VisitState;
  private readonly key: string;

  constructor(key: string, visitId: string, now: number) {
    this.key = key;
    let loaded: unknown = null;
    try {
      const raw = readStored(key);
      loaded = raw ? JSON.parse(raw) : null;
    } catch {
      loaded = null;
    }
    this.state = isState(loaded, visitId) ? loaded : fresh(visitId, now);
    this.save();
  }

  /** The next chunk seq, persisted before it is used. */
  nextSeq(): number {
    const seq = this.state.seq;
    this.state.seq = seq + 1;
    this.save();
    return seq;
  }

  save(): void {
    writeStored(this.key, JSON.stringify(this.state));
  }
}
