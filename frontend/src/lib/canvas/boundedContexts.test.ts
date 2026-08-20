import { describe, expect, it } from 'vitest';
import {
  BACKEND_CONTEXTS,
  CANVAS_BOARD_INVARIANTS,
  FRONTEND_CONTEXTS,
  broadcastableCanvasChange,
  canvasGlossary,
  type CanvasEvent,
} from './boundedContexts';

describe('frontend context map', () => {
  it('gives every context a relationship, and every relationship a real counterpart', () => {
    const known = new Set<string>([
      ...FRONTEND_CONTEXTS.map((context) => context.id),
      ...BACKEND_CONTEXTS,
    ]);
    for (const context of FRONTEND_CONTEXTS) {
      expect(context.relationships.length, context.id).toBeGreaterThan(0);
      for (const relationship of context.relationships) {
        expect(known.has(relationship.with), `${context.id} -> ${relationship.with}`).toBe(true);
        // A relationship with no stated reason is a label, which is the exact
        // failure this map exists to replace.
        expect(relationship.why.length, `${context.id} -> ${relationship.with}`).toBeGreaterThan(20);
      }
    }
  });

  it('names exactly one aggregate root, and states its invariants', () => {
    const roots = FRONTEND_CONTEXTS.filter((context) => context.aggregate);
    expect(roots.map((context) => context.aggregate)).toEqual(['CanvasBoard']);
    expect(CANVAS_BOARD_INVARIANTS.length).toBeGreaterThanOrEqual(5);
  });

  it('claims each term for exactly one context', () => {
    const glossary = canvasGlossary();
    expect(new Set(glossary).size).toBe(glossary.length);
  });

  it('lets an EVENT cross the wire', () => {
    const moved: CanvasEvent<'object.moved', { id: string }> = {
      fact: 'object.moved', payload: { id: 'o1' }, sequence: 7, at: '2026-08-20T00:00:00.000Z',
    };
    expect(broadcastableCanvasChange(moved)).toBe(moved);
  });

  it('refuses a COMMAND at the type level', () => {
    // A command carries `intent` + `actor` and no `sequence`, so it cannot
    // satisfy `CanvasEvent`. This is the §3.7 proposal — broadcast the intent
    // and let every peer re-validate it — failing to compile instead of
    // shipping and letting two peers legitimately disagree about what happened.
    // @ts-expect-error a CanvasCommand is not broadcastable
    broadcastableCanvasChange({ intent: 'object.move', payload: { id: 'o1' }, actor: { kind: 'user', id: 'u1' } });
  });
});
