import { describe, expect, it } from 'vitest';
import type { ReplayRecordingDto, ReplayRecordingStatusDto } from '@builderforce/interaction-contract';
import { applyRecordingStatus } from './useReplayPlayback';

/** Live follow folds the light status read into the held row instead of re-reading it whole. */
const ROW = {
  id: 'rec-1', durationMs: 1_000, activeMs: 400, pageCount: 1, exitPath: '/', chunkCount: 2, chunkSeqs: [3, 4],
  counts: { clicks: 1, rage: 0, dead: 0, errors: 0, quickbacks: 0, excessiveScrolls: 0 },
  marks: [{ kind: 'page', key: '/', atMs: 0 }],
} as unknown as ReplayRecordingDto;

const STATUS: ReplayRecordingStatusDto = {
  durationMs: 2_000, activeMs: 900, pageCount: 2, exitPath: '/pricing', chunkCount: 3, chunkSeqs: [5],
  counts: { clicks: 4, rage: 1, dead: 0, errors: 0, quickbacks: 0, excessiveScrolls: 0 },
  markCount: 1, ended: false,
};

describe('applyRecordingStatus', () => {
  it('appends the new seqs and takes the facts that grow', () => {
    const next = applyRecordingStatus(ROW, STATUS);
    expect(next.chunkSeqs).toEqual([3, 4, 5]);
    expect(next).toMatchObject({ durationMs: 2_000, activeMs: 900, pageCount: 2, exitPath: '/pricing', chunkCount: 3, ended: false });
    expect(next.counts.clicks).toBe(4);
    // Marks were not resent: the held timeline stands.
    expect(next.marks).toBe(ROW.marks);
  });

  it('never re-adds a seq it already holds, and replaces marks when sent', () => {
    const marks = [{ kind: 'page', key: '/', atMs: 0 }, { kind: 'page', key: '/pricing', atMs: 900 }] as ReplayRecordingDto['marks'];
    const next = applyRecordingStatus(ROW, { ...STATUS, chunkSeqs: [4, 5], markCount: 2, marks, ended: true });
    expect(next.chunkSeqs).toEqual([3, 4, 5]);
    expect(next.marks).toEqual(marks);
    expect(next.ended).toBe(true);
  });
});
