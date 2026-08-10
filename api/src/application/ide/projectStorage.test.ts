/**
 * Reclaiming a deleted project's object storage.
 *
 * The bug this closes is invisible in the product (the project is gone either
 * way) and only shows up on the bill, so the paging behaviour is asserted
 * directly rather than trusted.
 */

import { describe, expect, it, vi } from 'vitest';
import { deletePrefix } from './projectStorage';

interface ListPage { keys: string[]; truncated: boolean; cursor?: string }

function bucketWith(pages: ListPage[]) {
  const deleted: string[][] = [];
  let call = 0;
  const bucket = {
    list: vi.fn(async () => {
      const page = pages[Math.min(call++, pages.length - 1)]!;
      return {
        objects: page.keys.map((key) => ({ key })),
        truncated: page.truncated,
        cursor: page.cursor,
      };
    }),
    delete: vi.fn(async (keys: string[]) => {
      deleted.push(keys);
    }),
  };
  return { bucket: bucket as unknown as R2Bucket, deleted, list: bucket.list };
}

describe('deletePrefix', () => {
  it('deletes everything under the prefix in one call when it fits on a page', async () => {
    const { bucket, deleted } = bucketWith([{ keys: ['a', 'b'], truncated: false }]);
    await expect(deletePrefix(bucket, 'ide/projects/7/')).resolves.toBe(2);
    expect(deleted).toEqual([['a', 'b']]);
  });

  it('follows the cursor — a project with more than one page is fully reclaimed', async () => {
    const { bucket, deleted, list } = bucketWith([
      { keys: ['a'], truncated: true, cursor: 'c1' },
      { keys: ['b'], truncated: false },
    ]);
    await expect(deletePrefix(bucket, 'sites/acme/')).resolves.toBe(2);
    expect(deleted).toEqual([['a'], ['b']]);
    expect((list.mock.calls as unknown as Array<[{ cursor?: string }]>)[1]?.[0]).toMatchObject({ cursor: 'c1' });
  });

  it('stops when a truncated page reports no cursor rather than looping forever', async () => {
    const { bucket } = bucketWith([{ keys: ['a'], truncated: true }]);
    await expect(deletePrefix(bucket, 'x/')).resolves.toBe(1);
  });

  it('is a no-op on an empty prefix — deleting a never-published project must not throw', async () => {
    const { bucket, deleted } = bucketWith([{ keys: [], truncated: false }]);
    await expect(deletePrefix(bucket, 'sites/none/')).resolves.toBe(0);
    expect(deleted).toEqual([]);
  });

  it('bounds a bucket that always reports truncated', async () => {
    // Left unbounded this spins the isolate until the platform kills it, taking
    // the delete request with it.
    const { bucket, deleted } = bucketWith([{ keys: ['a'], truncated: true, cursor: 'same' }]);
    await deletePrefix(bucket, 'x/');
    expect(deleted.length).toBe(200);
  });
});
