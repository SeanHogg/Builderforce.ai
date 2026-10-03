import { describe, expect, it } from 'vitest';
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from './workspaceCheckpoints';
import { deleteWorkspaceFile, readWorkspaceFile, writeWorkspaceFile } from './workspaceStore';

/** An in-memory R2 with the slice of behaviour the workspace store and checkpoints use. The etag is the content itself: equal bytes, equal tag. */
function memoryBucket(): R2Bucket {
  const objects = new Map<string, { body: string; customMetadata?: Record<string, string> }>();
  const asObject = (key: string) => {
    const entry = objects.get(key)!;
    return { key, size: entry.body.length, etag: entry.body, customMetadata: entry.customMetadata, body: entry.body, text: async () => entry.body };
  };
  return {
    async get(key: string) { return objects.has(key) ? asObject(key) : null; },
    async put(key: string, value: unknown, options?: { customMetadata?: Record<string, string> }) {
      const body = typeof value === 'string' ? value : String(value);
      objects.set(key, { body, customMetadata: options?.customMetadata });
    },
    async delete(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
    async list({ prefix }: { prefix: string }) {
      return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).sort().map(asObject) };
    },
  } as unknown as R2Bucket;
}

const P = 7;

describe('workspace checkpoints', () => {
  it('restores changed, deleted and created files to the version', async () => {
    const bucket = memoryBucket();
    await writeWorkspaceFile(bucket, P, 'src/App.tsx', 'export const v = 1;');
    await writeWorkspaceFile(bucket, P, 'src/old.ts', 'export const old = true;');
    const version = await createCheckpoint(bucket, P, { kind: 'baseline' });

    await writeWorkspaceFile(bucket, P, 'src/App.tsx', 'export const v = 2;');
    await deleteWorkspaceFile(bucket, P, 'src/old.ts');
    await writeWorkspaceFile(bucket, P, 'src/new.ts', 'export const fresh = true;');

    const outcome = await restoreCheckpoint(bucket, P, version.id);
    expect(outcome).toEqual({ restored: ['src/App.tsx', 'src/old.ts'], removed: ['src/new.ts'], missing: [] });
    expect(await readWorkspaceFile(bucket, P, 'src/App.tsx')).toBe('export const v = 1;');
    expect(await readWorkspaceFile(bucket, P, 'src/old.ts')).toBe('export const old = true;');
    expect(await readWorkspaceFile(bucket, P, 'src/new.ts')).toBeNull();
  });

  it('saves the current state before a restore, so the restore can be undone', async () => {
    const bucket = memoryBucket();
    await writeWorkspaceFile(bucket, P, 'a.ts', 'export const a = 1;');
    const first = await createCheckpoint(bucket, P, { kind: 'baseline' });
    await writeWorkspaceFile(bucket, P, 'a.ts', 'export const a = 2;');
    await restoreCheckpoint(bucket, P, first.id);

    const versions = await listCheckpoints(bucket, P);
    expect(versions[0]!.kind).toBe('beforeRestore');
    await restoreCheckpoint(bucket, P, versions[0]!.id);
    expect(await readWorkspaceFile(bucket, P, 'a.ts')).toBe('export const a = 2;');
  });

  it('lists versions newest first with their metadata from one list call', async () => {
    const bucket = memoryBucket();
    await writeWorkspaceFile(bucket, P, 'a.ts', 'export const a = 1;');
    await createCheckpoint(bucket, P, { kind: 'baseline' });
    await createCheckpoint(bucket, P, { kind: 'manual', name: '  Before redesign  ' });
    await createCheckpoint(bucket, P, { kind: 'auto', changed: ['1', '2', '3', '4', '5', '6'] });

    const [auto, manual, baseline] = await listCheckpoints(bucket, P);
    expect(auto!.changed).toEqual(['1', '2', '3', '4', '5']);
    expect(manual!.name).toBe('Before redesign');
    expect(baseline!.kind).toBe('baseline');
    expect(baseline!.fileCount).toBe(1);
  });

  it('answers null for a version that does not exist', async () => {
    expect(await restoreCheckpoint(memoryBucket(), P, 123)).toBeNull();
  });
});
