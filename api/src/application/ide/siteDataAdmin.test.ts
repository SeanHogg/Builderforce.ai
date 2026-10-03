import { describe, expect, it } from 'vitest';
import { collectionInProject, deleteCollection, deleteRecord } from './siteDataAdmin';
import { fakeDb, whereColumns } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;

describe('collectionInProject', () => {
  it('scopes the lookup by tenant AND project, not tenant alone', async () => {
    const db = fakeDb([[{ id: 3 }]]);
    expect(await collectionInProject(asDb(db), 7, 11, 3)).toBe(true);
    expect(whereColumns(db.calls[0]!.where)).toEqual(expect.arrayContaining(['id', 'tenant_id', 'project_id']));
  });

  it('is false for another project\'s collection', async () => {
    expect(await collectionInProject(asDb(fakeDb([[]])), 7, 11, 3)).toBe(false);
  });
});

describe('deleteCollection', () => {
  it('reports whether anything was removed', async () => {
    expect(await deleteCollection(asDb(fakeDb([[{ id: 3 }]])), 7, 11, 3)).toBe(true);
    expect(await deleteCollection(asDb(fakeDb([[]])), 7, 11, 3)).toBe(false);
  });
});

describe('deleteRecord', () => {
  it('refuses a collection outside the project without touching records', async () => {
    const db = fakeDb([[]]);
    expect(await deleteRecord(asDb(db), 7, 11, 3, 40)).toBe(false);
    expect(db.calls.map((c) => c.kind)).toEqual(['select']);
  });

  it('decrements the collection tally after removing the row', async () => {
    const db = fakeDb([[{ id: 3 }], [{ id: 40 }], []]);
    expect(await deleteRecord(asDb(db), 7, 11, 3, 40)).toBe(true);
    expect(db.calls.map((c) => c.kind)).toEqual(['select', 'delete', 'update']);
  });

  it('leaves the tally alone when the record was not there', async () => {
    const db = fakeDb([[{ id: 3 }], []]);
    expect(await deleteRecord(asDb(db), 7, 11, 3, 40)).toBe(false);
    expect(db.calls.map((c) => c.kind)).toEqual(['select', 'delete']);
  });
});
