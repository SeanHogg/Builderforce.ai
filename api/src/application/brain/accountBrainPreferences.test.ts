import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import { getAccountBrainPreferences, parseAccountBrainPreferences, setAccountBrainPreferences } from './accountBrainPreferences';
import type { Db } from '../../infrastructure/database/connection';
import type { UserId } from '../../domain/shared/types';

// A distinct user per test: the read goes through the read-through cache, whose
// in-isolate layer would otherwise hand one test another test's value.
const user = (n: number) => `user-${n}` as UserId;
const TENANT = 7;

describe('account Brain preferences', () => {
  it('returns safe account defaults when no row exists', async () => {
    const db = fakeDb([[]]);
    await expect(getAccountBrainPreferences(undefined, db as unknown as Db, TENANT, user(1))).resolves.toEqual({
      effort: 'balanced', thinking: false, webBrowsing: false,
      modelSelection: { mode: 'auto' }, responseInstructions: '', cloudOrder: 'inferred',
    });
  });

  it('normalizes untrusted input and requires an id for a pinned model', () => {
    expect(parseAccountBrainPreferences({
      effort: 'thorough', thinking: true, webBrowsing: true,
      modelSelection: { mode: 'model', model: '  plan/sonnet  ' },
      responseInstructions: '  concise, with tables  ',
      cloudOrder: 'free_first',
    })).toEqual({
      effort: 'thorough', thinking: true, webBrowsing: true,
      modelSelection: { mode: 'model', model: 'plan/sonnet' },
      responseInstructions: 'concise, with tables',
      cloudOrder: 'free_first',
    });
    expect(parseAccountBrainPreferences({ modelSelection: { mode: 'model' } }).modelSelection).toEqual({ mode: 'auto' });
    expect(parseAccountBrainPreferences({ cloudOrder: 'cheapest' }).cloudOrder).toBe('inferred');
  });

  it('upserts the authenticated account row', async () => {
    const db = fakeDb([[], []]);
    const saved = await setAccountBrainPreferences(undefined, db as unknown as Db, TENANT, user(2), {
      effort: 'quick', modelSelection: { mode: 'byo_pool' },
    });
    expect(saved.effort).toBe('quick');
    expect(db.calls).toHaveLength(2);
    const call = db.calls[1];
    expect(call).toMatchObject({ kind: 'insert', chain: ['values', 'onConflictDoUpdate'] });
    expect(call?.payload).toMatchObject({
      tenantId: TENANT,
      scope: 'user',
      scopeRef: user(2),
      feature: 'brain',
      value: { effort: 'quick', modelSelection: { mode: 'byo_pool' } },
      updatedBy: user(2),
    });
  });

  it('keeps stored fields a partial save omits', async () => {
    const db = fakeDb([[{ value: { effort: 'thorough', cloudOrder: 'free_first' } }], []]);
    const saved = await setAccountBrainPreferences(undefined, db as unknown as Db, TENANT, user(3), { thinking: true });
    expect(saved).toMatchObject({ effort: 'thorough', thinking: true, cloudOrder: 'free_first' });
  });
});
