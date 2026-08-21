import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_KINDS } from '@builderforce/creation-canvas-contract';
import { canInvokeCreationObjectAction, canvasChangesCanAutoApply, CONNECTED_CANVAS_ACTIONS } from './canvasChange';
import type { ProposedCanvasChange } from './canvasChange';
import type { CanvasObject, CreationObjectKind } from './canvasObject';

function object(id: string, data: Record<string, unknown> = {}): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: { kind: 'website' as CreationObjectKind, title: id, ...data } };
}

describe('canvasChangesCanAutoApply', () => {
  const change = (partial: Partial<ProposedCanvasChange> & { type: ProposedCanvasChange['type'] }) =>
    ({ id: 'c', label: 'change', ...partial } as ProposedCanvasChange);

  it('auto-applies reversible canvas-local authoring', () => {
    expect(canvasChangesCanAutoApply([
      change({ type: 'object.add', node: object('a') } as never),
      change({ type: 'object.update', objectId: 'a', patch: {} } as never),
      change({ type: 'object.layout', objectId: 'a' } as never),
      change({ type: 'connection.add', edge: { id: 'e', source: 'a', target: 'b' } } as never),
      change({ type: 'connection.update', connectionId: 'e', patch: {} } as never),
    ])).toBe(true);
  });

  it('holds a DELETE for review — it can remove data', () => {
    expect(canvasChangesCanAutoApply([change({ type: 'object.delete', objectId: 'a' } as never)])).toBe(false);
  });

  it('holds an ACTION for review — it can trigger work', () => {
    expect(canvasChangesCanAutoApply([change({ type: 'object.action', objectId: 'a', action: 'publish' } as never)])).toBe(false);
  });

  it('holds a connection DELETE for review', () => {
    expect(canvasChangesCanAutoApply([change({ type: 'connection.delete', connectionId: 'e' } as never)])).toBe(false);
  });

  it('holds an add that would persist a canonical PRD — it writes outside the canvas', () => {
    expect(canvasChangesCanAutoApply([change({ type: 'object.add', node: object('a', { canonicalPrdPending: true }) } as never)])).toBe(false);
  });

  it('refuses an EMPTY change set, which is nothing to apply rather than a trivial yes', () => {
    expect(canvasChangesCanAutoApply([])).toBe(false);
  });

  it('is all-or-nothing: one reviewable change holds the whole set', () => {
    expect(canvasChangesCanAutoApply([
      change({ type: 'object.update', objectId: 'a', patch: {} } as never),
      change({ type: 'object.delete', objectId: 'b' } as never),
    ])).toBe(false);
  });
});

describe('canInvokeCreationObjectAction', () => {
  it('allows inspect and edit on every kind — a property of being on the board', () => {
    for (const kind of ['website', 'sticky', 'defect'] as CreationObjectKind[]) {
      expect(canInvokeCreationObjectAction(kind, 'inspect')).toBe(true);
      expect(canInvokeCreationObjectAction(kind, 'edit')).toBe(true);
    }
  });

  it('allows an act the kind actually has an adapter for', () => {
    for (const [kind, action] of [['website', 'publish'], ['video', 'generate'], ['workflow', 'run'], ['mockup', 'deliver'], ['poll', 'reveal']] as const) {
      expect(canInvokeCreationObjectAction(kind as CreationObjectKind, action), `${kind}.${action}`).toBe(true);
    }
    // THE HANDOVER. Advertised by the `offer` spec AND connected here — the pairing that
    // was missing for the whole life of the hiring vocabulary, which is why an accepted
    // offer stayed an accepted offer and somebody re-typed the person into an `employee`.
    expect(canInvokeCreationObjectAction('offer' as CreationObjectKind, 'hire')).toBe(true);
  });

  it('refuses an act the kind has no adapter for, rather than promising it', () => {
    expect(canInvokeCreationObjectAction('website' as CreationObjectKind, 'train')).toBe(false);
    expect(canInvokeCreationObjectAction('testPlan' as CreationObjectKind, 'run')).toBe(false);
  });

  it('refuses every act on a kind that declares none', () => {
    expect(canInvokeCreationObjectAction('sticky' as CreationObjectKind, 'publish')).toBe(false);
  });
});

describe('CONNECTED_CANVAS_ACTIONS', () => {
  it('only names kinds the contract declares — a typo here silently disables an act', () => {
    const declared = new Set<string>(CREATION_OBJECT_KINDS as readonly string[]);
    expect(Object.keys(CONNECTED_CANVAS_ACTIONS).filter((kind) => !declared.has(kind))).toEqual([]);
  });

  it('never lists an act twice for one kind', () => {
    for (const [kind, actions] of Object.entries(CONNECTED_CANVAS_ACTIONS)) {
      expect(new Set(actions).size, kind).toBe(actions!.length);
    }
  });

  it('never re-declares inspect or edit, which are unconditional', () => {
    for (const [kind, actions] of Object.entries(CONNECTED_CANVAS_ACTIONS)) {
      expect(actions!.includes('inspect'), kind).toBe(false);
      expect(actions!.includes('edit'), kind).toBe(false);
    }
  });
});
