import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { projectSites, runFeatures, runModelOutcomes } from '../../infrastructure/database/schema';
import { cascadeProjectDelete } from './siblingCascade';

/** With no sibling endpoint bound, the apps and operational handles ARE the core handle. */
describe('cascadeProjectDelete', () => {
  it('deletes the sites and detaches run outcomes AND PRD 41 run features from the project', async () => {
    const db = fakeDb();
    await cascadeProjectDelete(db as unknown as Db, [5, 6]);
    expect(db.calls.map((c) => [c.kind, c.args[0]])).toEqual([
      ['delete', projectSites],
      ['update', runModelOutcomes],
      ['update', runFeatures],
    ]);
    expect(db.calls[2]!.payload).toEqual({ projectId: null });
  });

  it('does nothing for no projects', async () => {
    const db = fakeDb();
    await cascadeProjectDelete(db as unknown as Db, []);
    expect(db.calls).toHaveLength(0);
  });
});
