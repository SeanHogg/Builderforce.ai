import { describe, expect, it } from 'vitest';
import { SERVER_TICKET_TOOLS, ticketStatusMove, ticketToolVocabulary } from './ticketToolVocabulary';
import { entityIdsOf } from './toolResultRecord';

const UUID = '0b1c2d3e-0000-4000-8000-0000000000aa';
const LOCAL = ticketToolVocabulary(['ticket-create']);

describe('entityIdsOf — THE reader of a tool result\'s entity ids', () => {
  it('regression: reads `taskId` off from_delta\'s answer (chat #61651, 17 duplicate tickets)', () => {
    expect(entityIdsOf({ deltaId: 1161, kind: 'improvement', taskId: 6523, deduped: false })).toEqual({ localId: null, syncId: 6523 });
    expect(entityIdsOf(JSON.stringify({ deltaId: 1, taskId: '6523' }))).toEqual({ localId: null, syncId: 6523 });
  });

  it('prefers `syncId`, then `taskId`, then a numeric `id`', () => {
    expect(entityIdsOf({ syncId: 7, taskId: 8, id: 9 }).syncId).toBe(7);
    expect(entityIdsOf({ taskId: 8, id: 9 }).syncId).toBe(8);
    expect(entityIdsOf({ id: 9 }).syncId).toBe(9);
    expect(entityIdsOf({ id: '9' }).syncId).toBe(9);
  });

  it('regression: a UUID `id` is a LocalId, never a number', () => {
    expect(entityIdsOf({ kind: 'local', id: UUID })).toEqual({ localId: UUID, syncId: null });
    expect(entityIdsOf(JSON.stringify({ id: UUID, localId: UUID, syncId: 41 }))).toEqual({ localId: UUID, syncId: 41 });
  });

  it('reads nothing from a non-id, an error or a non-record', () => {
    for (const bad of [{ id: 0 }, { id: -3 }, { id: '1e3' }, { id: 'local-1' }, { ok: false, error: 'x' }, 'not json', null, 42]) {
      expect(entityIdsOf(bad)).toEqual({ localId: null, syncId: null });
    }
  });
});

describe('ticketStatusMove routes by the EntityRef', () => {
  it('regression: a LocalId moves through ticket-move whatever the vocabulary', () => {
    expect(ticketStatusMove({ local: UUID } as never, 'done', SERVER_TICKET_TOOLS)).toEqual({ tool: 'ticket-move', args: { id: UUID, status: 'done' } });
    expect(ticketStatusMove(UUID, 'done', LOCAL)).toEqual({ tool: 'ticket-move', args: { id: UUID, status: 'done' } });
  });

  it('a SyncId moves through the filing vocabulary\'s tool', () => {
    expect(ticketStatusMove({ sync: 41 } as never, 'in_progress', SERVER_TICKET_TOOLS)).toEqual({ tool: 'builtin_tasks_update', args: { id: 41, status: 'in_progress' } });
    expect(ticketStatusMove(41, 'in_progress', LOCAL)).toEqual({ tool: 'ticket-move', args: { id: '41', status: 'in_progress' } });
  });

  it('a planning-tier ref has no task status to move', () => {
    expect(ticketStatusMove('spec:5', 'done', SERVER_TICKET_TOOLS)).toBeNull();
    expect(ticketStatusMove({ tier: { kind: 'objective', ref: 'q3' } }, 'done', LOCAL)).toBeNull();
  });
});
