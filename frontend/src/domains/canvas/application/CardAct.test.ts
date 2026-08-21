/**
 * The six steps every act used to repeat, asserted once.
 *
 * These are the behaviours that DRIFTED while there were thirteen copies: some
 * acts refused a local board and some did not, some caught their own errors and
 * two did not, and the dispatch that reached them could silently answer nothing
 * for an action a kind advertises.
 */

import { describe, expect, it, vi } from 'vitest';
import { cardActFor, runCardAct, actEdge, cardRows, cardText, type CardAct, type CardActBoard } from './CardAct';
import type { CanvasObject, CreationObjectKind } from '../domain/canvasObject';

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}:${JSON.stringify(values)}` : key);

function object(id: string, kind: string, data: Record<string, unknown> = {}): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: { kind: kind as CreationObjectKind, title: id, ...data } };
}

function board(objects: CanvasObject[]): CardActBoard {
  return { objects, create: (kind, position) => ({ id: `new-${kind}`, type: 'creation', position, data: { kind, title: '' } }) };
}

const invoice = object('inv-1', 'invoice');

describe('cardActFor', () => {
  const acts: CardAct[] = [
    { kind: 'invoice' as CreationObjectKind, actions: ['issue', 'chase'], run: () => ({ notice: 'ok' }) },
    { kind: 'poll' as CreationObjectKind, run: () => ({ notice: 'any' }) },
  ];

  it('matches on kind AND action', () => {
    expect(cardActFor(acts, 'invoice' as CreationObjectKind, 'issue')).toBe(acts[0]);
    expect(cardActFor(acts, 'invoice' as CreationObjectKind, 'delete')).toBeUndefined();
  });

  it('lets an entry claim every action on its kind', () => {
    expect(cardActFor(acts, 'poll' as CreationObjectKind, 'whatever')).toBe(acts[1]);
  });
});

describe('runCardAct', () => {
  it('returns null when nothing implements the action, so the caller can SAY so', async () => {
    // The alternative is a button that appears to work and does nothing, which is
    // what a forgotten branch in the old dispatch chain produced.
    const result = await runCardAct([], { objectId: 'inv-1', action: 'issue', board: board([invoice]), persistence: 'server', t });
    expect(result).toBeNull();
  });

  it('returns null for a card that is not on the board', async () => {
    const acts: CardAct[] = [{ kind: 'invoice' as CreationObjectKind, run: () => ({ notice: 'ran' }) }];
    expect(await runCardAct(acts, { objectId: 'gone', action: 'issue', board: board([invoice]), persistence: 'server', t })).toBeNull();
  });

  it('refuses an account-backed act on a local draft, in that act’s own words', async () => {
    const run = vi.fn();
    const acts: CardAct[] = [{ kind: 'invoice' as CreationObjectKind, accountRequired: 'noticeInvoiceNeedsAccount', run }];
    const result = await runCardAct(acts, { objectId: 'inv-1', action: 'issue', board: board([invoice]), persistence: 'local', t });
    expect(result).toEqual({ notice: 'noticeInvoiceNeedsAccount' });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs an offline-capable act on a local draft', async () => {
    const acts: CardAct[] = [{ kind: 'invoice' as CreationObjectKind, run: () => ({ notice: 'ran' }) }];
    expect(await runCardAct(acts, { objectId: 'inv-1', action: 'x', board: board([invoice]), persistence: 'local', t })).toEqual({ notice: 'ran' });
  });

  it('turns a throw into a notice rather than an unhandled rejection', async () => {
    const acts: CardAct[] = [{ kind: 'invoice' as CreationObjectKind, run: () => { throw new Error('Payload too large'); } }];
    expect(await runCardAct(acts, { objectId: 'inv-1', action: 'x', board: board([invoice]), persistence: 'server', t }))
      .toEqual({ notice: 'Payload too large' });
  });

  it('falls back to the act’s OWN failure sentence when the throw carries none', async () => {
    const acts: CardAct[] = [{
      kind: 'invoice' as CreationObjectKind,
      failureNotice: 'noticeInvoiceActionFailed',
      run: () => { throw new Error(''); },
    }];
    expect(await runCardAct(acts, { objectId: 'inv-1', action: 'x', board: board([invoice]), persistence: 'server', t }))
      .toEqual({ notice: 'noticeInvoiceActionFailed' });
  });

  it('passes the action through, so one entry can answer several', async () => {
    const seen: string[] = [];
    const acts: CardAct[] = [{
      kind: 'invoice' as CreationObjectKind,
      actions: ['issue', 'chase'],
      run: ({ action }) => { seen.push(action); return { notice: action }; },
    }];
    await runCardAct(acts, { objectId: 'inv-1', action: 'chase', board: board([invoice]), persistence: 'server', t });
    expect(seen).toEqual(['chase']);
  });
});

describe('the shared field readers', () => {
  it('trims a string field and refuses anything else', () => {
    expect(cardText({ reference: '  A-1 ' }, 'reference')).toBe('A-1');
    expect(cardText({ reference: 42 }, 'reference')).toBe('');
    expect(cardText({}, 'reference')).toBe('');
  });

  it('reads rows as an array whatever the card actually holds', () => {
    expect(cardRows({ lines: [{ a: 1 }, null, 'no'] }, 'lines')).toEqual([{ a: 1 }]);
    expect(cardRows({ lines: 'nope' }, 'lines')).toEqual([]);
  });
});

describe('actEdge', () => {
  it('always carries a connection kind', () => {
    // Without it the board's critical path and coverage figures skip the edge,
    // which is what happened to the one act that wrote the literal by hand.
    const edge = actEdge(object('a', 'offer'), object('b', 'employee'), 'hired', 'delivery');
    expect(edge).toMatchObject({ source: 'a', target: 'b', label: 'hired', data: { connectionKind: 'delivery' } });
  });
});
