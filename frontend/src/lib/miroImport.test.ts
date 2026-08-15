import { describe, expect, it } from 'vitest';
import { miroBoardToCanvas, miroStickyColor, miroTextToPlain, type MiroConnector, type MiroItem } from './miroImport';
import { STICKY_COLORS } from '@/components/canvas/canvasModel';

/** Deterministic ids, so a test can assert on the graph rather than on a uuid. */
function ids(): () => string {
  let n = 0;
  return () => `n${(n += 1)}`;
}

describe('miroTextToPlain', () => {
  it('turns a Miro HTML fragment into the text a sticky shows', () => {
    expect(miroTextToPlain('<p>Ship the <b>import</b><br>then the panel</p>')).toBe('Ship the import\nthen the panel');
  });

  it('decodes the ampersand last, so a doubly-escaped tag survives as text', () => {
    // `&amp;lt;` is a literal `&lt;` a person typed. Decoding `&` first would make
    // it `&lt;` and the next pass would turn it into `<` — text the author never wrote.
    expect(miroTextToPlain('<p>&amp;lt;p&amp;gt;</p>')).toBe('&lt;p&gt;');
  });

  it('renders list items as bullets rather than running them together', () => {
    expect(miroTextToPlain('<ul><li>one</li><li>two</li></ul>')).toBe('• one\n• two');
  });

  it('is empty for empty input rather than throwing', () => {
    expect(miroTextToPlain(undefined)).toBe('');
  });
});

describe('miroStickyColor', () => {
  it('maps a Miro palette name onto a board pigment', () => {
    expect(STICKY_COLORS).toContain(miroStickyColor('light_green'));
  });

  it('keeps a literal hex, because that was the author choosing a colour', () => {
    expect(miroStickyColor('#AABBCC')).toBe('#aabbcc');
  });

  it('falls back to the first pigment for a colour Miro adds after we shipped', () => {
    expect(miroStickyColor('chartreuse_supreme')).toBe(STICKY_COLORS[0]);
  });
});

describe('miroBoardToCanvas', () => {
  const sticky: MiroItem = {
    id: 'm1', type: 'sticky_note',
    data: { content: '<p>Onboarding is confusing</p>' },
    style: { fillColor: 'light_yellow' },
    position: { x: 1000, y: 2000 },
    geometry: { width: 200, height: 200 },
  };

  it('maps a sticky note to a sticky whose title is its whole text', () => {
    const { nodes } = miroBoardToCanvas([sticky], [], ids());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.data.kind).toBe('sticky');
    expect(nodes[0]!.data.title).toBe('Onboarding is confusing');
    expect(nodes[0]!.data.stickyShape).toBeUndefined();
  });

  it('converts centre-origin coordinates and translates the board to the canvas origin', () => {
    // Miro centres the item at (1000, 2000) and it is 200 wide, so its top-left is
    // (900, 1900). A single-item board then normalises to the fixed margin.
    const { nodes } = miroBoardToCanvas([sticky], [], ids());
    expect(nodes[0]!.position).toEqual({ x: 80, y: 80 });
  });

  it('keeps relative layout when it translates', () => {
    const second: MiroItem = { ...sticky, id: 'm2', position: { x: 1400, y: 2000 } };
    const { nodes } = miroBoardToCanvas([sticky, second], [], ids());
    expect(nodes[1]!.position.x - nodes[0]!.position.x).toBe(400);
    expect(nodes[1]!.position.y).toBe(nodes[0]!.position.y);
  });

  it('remembers what a shape was, so an ellipse does not silently become a note', () => {
    const shape: MiroItem = { id: 'm3', type: 'shape', data: { content: '<p>Decision</p>', shape: 'ellipse' }, position: { x: 0, y: 0 } };
    const { nodes } = miroBoardToCanvas([shape], [], ids());
    expect(nodes[0]!.data.stickyShape).toBe('ellipse');
  });

  it('sizes an item Miro never sent geometry for at the size its kind renders at', () => {
    const unsized: MiroItem = { id: 'm4', type: 'sticky_note', data: { content: '<p>x</p>' }, position: { x: 0, y: 0 } };
    const { nodes } = miroBoardToCanvas([unsized], [], ids());
    expect(nodes[0]!.style).toEqual({ width: 190, height: 170 });
  });

  it('maps a Miro card to a task and keeps the body under the title', () => {
    const card: MiroItem = {
      id: 'm5', type: 'card',
      data: { title: '<p>Fix the signup flow</p>', description: '<p>Three steps too many.</p>', dueDate: '2026-09-01T00:00:00Z' },
      position: { x: 0, y: 0 },
    };
    const { nodes } = miroBoardToCanvas([card], [], ids());
    expect(nodes[0]!.data.kind).toBe('task');
    expect(nodes[0]!.data.title).toBe('Fix the signup flow');
    expect(nodes[0]!.data.dueDate).toBe('2026-09-01T00:00:00Z');
  });

  it('turns a connector into a reference edge, never a data edge', () => {
    // A drawn arrow asserts a relationship and nothing about a value moving, so
    // importing it as `data` would let a lineage rollup read a doodle as a pipeline.
    const other: MiroItem = { ...sticky, id: 'm2' };
    const connector: MiroConnector = { id: 'c1', startItem: { id: 'm1' }, endItem: { id: 'm2' }, captions: [{ content: '<p>causes</p>' }] };
    const { edges } = miroBoardToCanvas([sticky, other], [connector], ids());
    const drawn = edges.find((edge) => edge.label === 'causes');
    expect(drawn).toBeDefined();
    expect(drawn!.data).toEqual({ connectionKind: 'reference' });
  });

  it('drops a connector whose endpoint was not imported instead of dangling it', () => {
    const connector: MiroConnector = { id: 'c1', startItem: { id: 'm1' }, endItem: { id: 'gone' } };
    const { edges } = miroBoardToCanvas([sticky], [connector], ids());
    expect(edges).toHaveLength(0);
  });

  it('links a frame child by membership', () => {
    const frame: MiroItem = { id: 'f1', type: 'frame', data: { title: 'Discovery' }, position: { x: 0, y: 0 } };
    const child: MiroItem = { ...sticky, id: 'm1', parent: { id: 'f1' } };
    const { edges } = miroBoardToCanvas([frame, child], [], ids());
    expect(edges).toHaveLength(1);
    expect(edges[0]!.data).toEqual({ connectionKind: 'membership' });
  });

  it('reports the types it could not place instead of silently losing them', () => {
    const unsupported: MiroItem = { id: 'm9', type: 'unsupported', position: { x: 0, y: 0 } };
    const { nodes, skipped, counts } = miroBoardToCanvas([sticky, unsupported], [], ids());
    expect(nodes).toHaveLength(1);
    expect(skipped).toEqual(['unsupported']);
    expect(counts).toEqual({ sticky: 1 });
  });

  it('drops an empty sticky, which is scaffolding rather than content', () => {
    const blank: MiroItem = { id: 'm8', type: 'sticky_note', data: { content: '<p></p>' }, position: { x: 0, y: 0 } };
    const { nodes } = miroBoardToCanvas([blank], [], ids());
    expect(nodes).toHaveLength(0);
  });

  it('keeps an untitled frame, because a region is worth having even unnamed', () => {
    const frame: MiroItem = { id: 'f2', type: 'frame', position: { x: 0, y: 0 } };
    const { nodes } = miroBoardToCanvas([frame], [], ids());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.data.kind).toBe('frame');
  });

  it('returns an empty graph for an empty board rather than throwing on the origin walk', () => {
    expect(miroBoardToCanvas([], [], ids())).toEqual({ nodes: [], edges: [], counts: {}, skipped: [] });
  });
});
