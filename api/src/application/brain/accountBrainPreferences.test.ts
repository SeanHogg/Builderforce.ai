import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import { getAccountBrainPreferences, parseAccountBrainPreferences, setAccountBrainPreferences } from './accountBrainPreferences';
import type { Db } from '../../infrastructure/database/connection';
import type { UserId } from '../../domain/shared/types';

const USER = 'user-1' as UserId;

describe('account Brain preferences', () => {
  it('returns safe account defaults when no row exists', async () => {
    const db = fakeDb([[]]);
    await expect(getAccountBrainPreferences(db as unknown as Db, USER)).resolves.toEqual({
      effort: 'balanced', thinking: false, webBrowsing: false,
      modelSelection: { mode: 'auto' }, responseInstructions: '',
    });
  });

  it('normalizes untrusted input and requires an id for a pinned model', () => {
    expect(parseAccountBrainPreferences({
      effort: 'thorough', thinking: true, webBrowsing: true,
      modelSelection: { mode: 'model', model: '  plan/sonnet  ' },
      responseInstructions: '  concise, with tables  ',
    })).toEqual({
      effort: 'thorough', thinking: true, webBrowsing: true,
      modelSelection: { mode: 'model', model: 'plan/sonnet' },
      responseInstructions: 'concise, with tables',
    });
    expect(parseAccountBrainPreferences({ modelSelection: { mode: 'model' } }).modelSelection).toEqual({ mode: 'auto' });
  });

  it('upserts the authenticated account row', async () => {
    const db = fakeDb([[]]);
    const saved = await setAccountBrainPreferences(db as unknown as Db, USER, {
      effort: 'quick', modelSelection: { mode: 'byo_pool' },
    });
    expect(saved.effort).toBe('quick');
    expect(db.calls).toHaveLength(1);
    const [call] = db.calls;
    expect(call).toMatchObject({ kind: 'insert', chain: ['values', 'onConflictDoUpdate'] });
    expect(call?.payload).toMatchObject({ userId: USER, effort: 'quick', modelMode: 'byo_pool' });
  });
});
