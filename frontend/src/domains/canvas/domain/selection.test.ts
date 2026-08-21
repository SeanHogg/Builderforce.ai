import { describe, expect, it } from 'vitest';
import { duplicateAddUpdateTarget, selectionViolations, selectionWithinBoard, shouldAcquireCanvasObjectLock } from './selection';
import type { CanvasObject, CreationObjectKind } from './canvasObject';

function object(id: string, kind: string): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: { kind: kind as CreationObjectKind, title: id } };
}

describe('selectionWithinBoard', () => {
  it('drops ids the board no longer holds', () => {
    expect(selectionWithinBoard(['a', 'gone', 'b'], [object('a', 'website'), object('b', 'dashboard')])).toEqual(['a', 'b']);
  });

  it('leaves a selection that is already valid untouched', () => {
    expect(selectionWithinBoard(['a'], [object('a', 'website')])).toEqual(['a']);
  });

  it('empties a selection when the board is empty', () => {
    expect(selectionWithinBoard(['a', 'b'], [])).toEqual([]);
  });

  it('reports the violation, naming the id, for a caller that wants to assert', () => {
    const [violation] = selectionViolations(['ghost'], [object('a', 'website')]);
    expect(violation).toContain('ghost');
    expect(violation).toContain('selection only ever names objects');
  });
});

describe('shouldAcquireCanvasObjectLock', () => {
  const persisted = new Set(['saved']);

  it('locks a saved object on a server board when the user may edit', () => {
    expect(shouldAcquireCanvasObjectLock('server', 'saved', true, persisted)).toBe(true);
  });

  it('never locks on a local board — there is no row to lock', () => {
    expect(shouldAcquireCanvasObjectLock('local', 'saved', true, persisted)).toBe(false);
  });

  it('never locks for a viewer, who could not use the lock', () => {
    expect(shouldAcquireCanvasObjectLock('server', 'saved', false, persisted)).toBe(false);
  });

  it('never locks an object that has not been persisted yet', () => {
    expect(shouldAcquireCanvasObjectLock('server', 'unsaved', true, persisted)).toBe(false);
  });

  it('never locks when nothing is selected', () => {
    expect(shouldAcquireCanvasObjectLock('server', null, true, persisted)).toBe(false);
  });
});

describe('duplicateAddUpdateTarget', () => {
  const nodes = [object('chart-1', 'dashboard')];
  const selected = ['chart-1'];

  it('treats a follow-up as an EDIT of the selected object', () => {
    expect(duplicateAddUpdateTarget('make the bars blue', 'dashboard' as CreationObjectKind, nodes, selected)?.id).toBe('chart-1');
  });

  it('is not fooled by "add" applied to something OTHER than the object', () => {
    // "Add labels to the chart" begins with a creation verb and names the kind, so
    // a looser rule reads it as "make a second chart" and the person watches their
    // selected chart stay unchanged while a duplicate appears beside it.
    expect(duplicateAddUpdateTarget('Add labels to the chart', 'dashboard' as CreationObjectKind, nodes, selected)?.id).toBe('chart-1');
    expect(duplicateAddUpdateTarget('What do you mean by Reach? Change those labels.', 'dashboard' as CreationObjectKind, nodes, selected)?.id).toBe('chart-1');
  });

  it('yields to a prompt that explicitly asks for another one', () => {
    expect(duplicateAddUpdateTarget('add another dashboard', 'dashboard' as CreationObjectKind, nodes, selected)).toBeUndefined();
    expect(duplicateAddUpdateTarget('create a dashboard', 'dashboard' as CreationObjectKind, nodes, selected)).toBeUndefined();
  });

  it('yields when the determiners STACK — "a new", which is how people actually ask', () => {
    for (const prompt of ['create a new dashboard', 'add another new dashboard', 'create one more dashboard']) {
      expect(duplicateAddUpdateTarget(prompt, 'dashboard' as CreationObjectKind, nodes, selected), prompt).toBeUndefined();
    }
  });

  it('yields to "another visual" even though the kind is not named', () => {
    expect(duplicateAddUpdateTarget('give me another visual', 'dashboard' as CreationObjectKind, nodes, selected)).toBeUndefined();
  });

  it('returns nothing when the selection is a different kind', () => {
    expect(duplicateAddUpdateTarget('make it blue', 'website' as CreationObjectKind, nodes, selected)).toBeUndefined();
  });

  it('never targets the chat object — a follow-up is not an edit of the conversation', () => {
    const chat = [object('chat-1', 'chat')];
    expect(duplicateAddUpdateTarget('make it blue', 'chat' as CreationObjectKind, chat, ['chat-1'])).toBeUndefined();
  });

  it('returns nothing when nothing is selected', () => {
    expect(duplicateAddUpdateTarget('make it blue', 'dashboard' as CreationObjectKind, nodes, [])).toBeUndefined();
  });
});
