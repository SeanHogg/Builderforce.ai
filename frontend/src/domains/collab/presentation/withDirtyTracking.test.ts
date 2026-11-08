import { describe, it, expect, vi } from 'vitest';
import { withDirtyTracking } from './withDirtyTracking';
import type { BlockDocument } from './useBlockDocument';

function stubDoc(): BlockDocument {
  const noop = () => undefined;
  return {
    enabled: true, connected: true, blocks: [], peers: [], markdown: '',
    setText: noop, setAttrs: noop, appendStrokes: noop, removeStrokes: noop, updateStroke: noop, clearStrokes: noop,
    insertAfter: (_after, block) => block.id, remove: noop, move: noop, replaceAll: noop, setFocusedBlock: noop,
  } as BlockDocument;
}

describe('withDirtyTracking', () => {
  it('marks dirty for a stroke-only edit, so it autosaves', () => {
    const markDirty = vi.fn();
    const doc = withDirtyTracking(stubDoc(), markDirty);
    doc.appendStrokes('b', []);
    doc.removeStrokes('b', []);
    doc.updateStroke('b', 's', {});
    doc.clearStrokes('b');
    expect(markDirty).toHaveBeenCalledTimes(4);
  });

  it('marks dirty for every content operation and passes arguments and results through', () => {
    const markDirty = vi.fn();
    const base = stubDoc();
    const insertAfter = vi.fn(base.insertAfter);
    const doc = withDirtyTracking({ ...base, insertAfter }, markDirty);
    expect(doc.insertAfter(null, { id: 'x', type: 'text', text: '', attrs: {} })).toBe('x');
    expect(insertAfter).toHaveBeenCalledWith(null, expect.objectContaining({ id: 'x' }));
    doc.setText('b', 't'); doc.setAttrs('b', {}); doc.remove('b'); doc.move('b', 1); doc.replaceAll([]);
    expect(markDirty).toHaveBeenCalledTimes(6);
  });

  it('does not mark dirty for focus changes or for reading', () => {
    const markDirty = vi.fn();
    const doc = withDirtyTracking(stubDoc(), markDirty);
    doc.setFocusedBlock('b');
    expect(doc.blocks).toEqual([]);
    expect(markDirty).not.toHaveBeenCalled();
  });
});
