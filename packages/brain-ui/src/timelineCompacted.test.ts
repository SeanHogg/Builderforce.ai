import { describe, expect, it } from 'vitest';
import {
  consolidationMarkerContent,
  consolidationMetadata,
  type BrainMessage,
  type BrainTraceEvent,
} from '@seanhogg/builderforce-brain-embedded';
import { buildSettledTimeline } from './timelineModel';

const ts = '2026-10-25T10:00:00.000Z';
const autoMarker: BrainMessage = {
  id: 7, seq: 7, role: 'assistant', createdAt: ts,
  content: consolidationMarkerContent('The run read a.ts and b.ts; next: wire the meter.'),
  metadata: consolidationMetadata({ keepFromId: 4, folded: 42 }),
};
const manualMarker: BrainMessage = {
  id: 8, seq: 8, role: 'assistant', createdAt: ts,
  content: consolidationMarkerContent('A summary someone asked for.'),
  metadata: consolidationMetadata(),
};

describe('auto-compaction in the transcript', () => {
  it('renders a durable fold as ONE compaction row carrying its count and note', () => {
    const nodes = buildSettledTimeline([autoMarker], []);
    expect(nodes).toEqual([expect.objectContaining({ kind: 'compacted', count: 42, note: 'The run read a.ts and b.ts; next: wire the meter.' })]);
  });

  it('shows a fold once: from its marker when one was saved, else from its step', () => {
    const step: BrainTraceEvent = { ts, category: 'message', label: 'context.compacted', args: { droppedMessages: 42 }, result: 'Compressed…' };
    const both = buildSettledTimeline([autoMarker], [step]).filter((n) => n.kind === 'compacted');
    expect(both).toEqual([expect.objectContaining({ message: autoMarker, note: expect.stringContaining('a.ts') })]);
    expect(buildSettledTimeline([], [step])).toEqual([expect.objectContaining({ kind: 'compacted', message: null, count: 42, note: '' })]);
  });

  it('returns the same node object for an unchanged trace event', () => {
    const ev: BrainTraceEvent = { ts, category: 'tool', label: 'read_file', result: 'x' };
    const first = buildSettledTimeline([], [ev])[0];
    const again = buildSettledTimeline([], [ev, { ts, category: 'tool', label: 'edit_file', result: 'y' }])[0];
    expect(again).toBe(first);
  });

  it('keeps a manual consolidation as the reply someone asked for', () => {
    expect(buildSettledTimeline([manualMarker], [])).toEqual([expect.objectContaining({ kind: 'assistant' })]);
  });

  it('returns the same node object for an unchanged message (rows stay memoized across trace events)', () => {
    const first = buildSettledTimeline([autoMarker], [])[0];
    const again = buildSettledTimeline([autoMarker], [{ ts, category: 'tool', label: 'read_file', result: 'x' }])[0];
    expect(again).toBe(first);
  });
});
