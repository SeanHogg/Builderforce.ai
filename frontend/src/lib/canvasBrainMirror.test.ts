import { describe, expect, it } from 'vitest';
import { BRAIN_MIRROR_FIELDS, brainMirrorData, withoutBrainMirror } from './canvasBrainMirror';

describe('the Brain object live-turn mirror', () => {
  const timeline = [
    { messageRole: 'user', body: 'fix the build', createdAt: '2026-10-12T05:04:51.304Z' },
    { messageRole: 'assistant', body: 'Fixed.', createdAt: '2026-10-12T05:07:02.890Z' },
  ];

  it('writes only the fields the checkpoint ignores', () => {
    const data = brainMirrorData({ timeline, trace: [{ label: 'canvas_read_build_file' }], running: true, runStartedAt: 1, priorAiResponse: 'old' });
    expect(Object.keys(data).every((key) => (BRAIN_MIRROR_FIELDS as readonly string[]).includes(key))).toBe(true);
    expect(data).toMatchObject({ aiResponse: 'Fixed.', brainRunning: true, brainRunStartedAt: 1 });
    expect(brainMirrorData({ timeline: [], trace: [], running: false, runStartedAt: null, priorAiResponse: 'old' }))
      .not.toHaveProperty('trace');
  });

  it('makes a mirror-only change invisible to the history checkpoint (session local-148925cf: undo depth 21 of Brain trace)', () => {
    const board = (trace: unknown[], title = 'Brain') => ({
      nodes: [
        { id: 'chat', data: { kind: 'chat', title, ...brainMirrorData({ timeline, trace, running: true, runStartedAt: 1, priorAiResponse: '' }) } },
        { id: 'email', data: { kind: 'email', title: 'Thread', messages: ['kept'] } },
      ],
      edges: [],
    });
    const key = (graph: ReturnType<typeof board>) => JSON.stringify(withoutBrainMirror(graph));
    expect(key(board([{ label: 'a' }]))).toBe(key(board([{ label: 'a' }, { label: 'b' }])));
    // A real edit to the chat object, and another kind's own `messages`, still count.
    expect(key(board([]))).not.toBe(key(board([], 'Renamed')));
    expect(key(board([]))).toContain('"kept"');
  });
});
