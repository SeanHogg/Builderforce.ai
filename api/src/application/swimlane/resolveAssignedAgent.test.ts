import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { AssignedAgentNotFoundError, resolveAssignedAgent } from './resolveAssignedAgent';

describe('resolveAssignedAgent', () => {
  it('rejects a registered legacy id that cannot fit in Postgres int4 without querying', async () => {
    const db = fakeDb();
    await expect(resolveAssignedAgent(db as unknown as Db, 7, {
      agentKind: 'registered',
      agentRef: '2147483648',
    })).rejects.toBeInstanceOf(AssignedAgentNotFoundError);
    expect(db.calls).toHaveLength(0);
  });

  it('rejects a 20-digit registered ref without overflowing int4', async () => {
    const db = fakeDb();
    await expect(resolveAssignedAgent(db as unknown as Db, 7, {
      agentKind: 'registered',
      agentRef: '9999999999999999999',
    })).rejects.toBeInstanceOf(AssignedAgentNotFoundError);
    expect(db.calls).toHaveLength(0);
  });

  it('looks up an int4-safe legacy id on agent_registrations', async () => {
    const db = fakeDb([[{ name: 'Claude' }]]);
    const resolved = await resolveAssignedAgent(db as unknown as Db, 7, {
      agentKind: 'registered',
      agentRef: '42',
    });
    expect(resolved).toMatchObject({ role: 'Claude', name: 'Claude', runtime: 'cloud' });
    expect(db.calls).toHaveLength(1);
  });
});
