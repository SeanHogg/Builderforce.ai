import { describe, expect, it } from 'vitest';
import type { ReplayChunk } from '@builderforce/interaction-contract';
import { foldVisit, IDLE_GAP_MS } from './visitSummary';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function chunk(events: ReplayChunk['events'], marks: ReplayChunk['marks'] = []): ReplayChunk {
  return { visitId: 'v1', seq: 0, events, marks };
}

describe('foldVisit', () => {
  it('opens a visit from the first chunk', () => {
    const row = foldVisit(
      null,
      chunk([
        { t: 0, kind: 'pageview', path: '/home' },
        { t: 1_000, kind: 'click' },
        { t: 2_000, kind: 'pageview', path: '/pricing' },
      ]),
      NOW,
    );
    expect(row.visitId).toBe('v1');
    expect(row.startedAt).toEqual(new Date(NOW.getTime() - 2_000));
    expect(row.lastEventAt).toEqual(NOW);
    expect(row.endedAt).toBeNull();
    expect(row.durationMs).toBe(2_000);
    expect(row.entryPath).toBe('/home');
    expect(row.exitPath).toBe('/pricing');
    expect(row.pageCount).toBe(2);
    expect(row.clickCount).toBe(1);
    expect(row.chunkCount).toBe(1);
    expect(row.activeMs).toBe(0);
  });

  it('counts two clicks a second apart as 1000ms of active time', () => {
    const row = foldVisit(
      null,
      chunk([
        { t: 0, kind: 'click' },
        { t: 1_000, kind: 'click' },
      ]),
      NOW,
    );
    expect(row.activeMs).toBe(1_000);
    expect(row.clickCount).toBe(2);
  });

  it('excludes idle gaps longer than 30s from active_ms', () => {
    const row = foldVisit(
      null,
      chunk([
        { t: 0, kind: 'click' },
        { t: IDLE_GAP_MS + 1, kind: 'click' },
      ]),
      NOW,
    );
    expect(row.activeMs).toBe(0);
  });

  it('adds the next chunk onto the previous row', () => {
    const first = foldVisit(
      null,
      chunk([{ t: 0, kind: 'pageview', path: '/home' }, { t: 500, kind: 'click' }]),
      NOW,
    );
    const second = foldVisit(
      first,
      { visitId: 'v1', seq: 1, events: [{ t: 3_000, kind: 'pageview', path: '/docs' }], marks: [{ kind: 'rage', key: 'a', atMs: 3_100 }] },
      NOW,
    );
    expect(second.entryPath).toBe('/home');
    expect(second.exitPath).toBe('/docs');
    expect(second.pageCount).toBe(2);
    expect(second.clickCount).toBe(1);
    expect(second.rageCount).toBe(1);
    expect(second.chunkCount).toBe(2);
    expect(second.startedAt).toEqual(first.startedAt);
  });

  it('sets the end marker from a visibility-hidden / end event', () => {
    const row = foldVisit(
      null,
      chunk([
        { t: 0, kind: 'pageview', path: '/' },
        { t: 800, kind: 'visibility', state: 'hidden' },
      ]),
      NOW,
    );
    expect(row.endedAt).toEqual(NOW);
  });

  it('prefers marks over events for frustration counts so ingest does not double-count', () => {
    const row = foldVisit(
      null,
      chunk(
        [{ t: 10, kind: 'rage' }, { t: 11, kind: 'click' }],
        [{ kind: 'rage', key: 'btn', atMs: 10 }],
      ),
      NOW,
    );
    expect(row.rageCount).toBe(1);
    expect(row.clickCount).toBe(1);
  });

  it('marks the visit converted when a goal event arrives', () => {
    const row = foldVisit(null, chunk([{ t: 50, kind: 'goal' }]), NOW);
    expect(row.converted).toBe(true);
  });
});
