import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriveItem, DriveListing } from '@/lib/driveApi';
import { metadataHash } from '@builderforce/knowledge-browser';

const drive = vi.hoisted(() => ({ list: vi.fn(), fetchFile: vi.fn() }));
vi.mock('@/lib/driveApi', () => ({ driveApi: drive }));
vi.mock('./webHost', async () => {
  const { hostRootId } = await import('@builderforce/knowledge-browser');
  return { WEB_HOST: 'web', webRootId: (kind: string, ...parts: Array<string | number>) => hostRootId('web', kind, ...parts) };
});

import { createDriveDirectorySource, DRIVE_WALK_LIMITS } from './cloudDriveDirectorySource';

const CONNECTION = { id: 3, displayName: 'Legal drive', accountEmail: 'legal@example.com' };

const file = (id: string, name: string, extra: Partial<DriveItem> = {}): DriveItem => ({ id, name, kind: 'file', mimeType: 'text/markdown', ...extra });
const folder = (id: string, name: string): DriveItem => ({ id, name, kind: 'folder', mimeType: 'application/vnd.folder' });

/** A drive as pages by folder id (`root` for the top) and cursor. */
function serve(tree: Record<string, DriveListing[]>) {
  drive.list.mockImplementation(async (_connection: number, folderId: string | null | undefined, cursor?: string): Promise<DriveListing> => {
    const pages = tree[folderId ?? 'root'] ?? [{ items: [] }];
    return pages[cursor ? Number(cursor) : 0]!;
  });
}

async function listed(source: ReturnType<typeof createDriveDirectorySource>) {
  const out: Array<{ path: string; hash: string; size: number }> = [];
  for await (const entry of source.list()) out.push(entry);
  return out;
}

beforeEach(() => {
  drive.list.mockReset();
  drive.fetchFile.mockReset();
});

describe('Cloud Drive directory source', () => {
  it('walks folder by folder, paging, and lists root-relative paths sorted', async () => {
    serve({
      root: [{ items: [file('f2', 'b.md', { modifiedAt: '2026-10-02', sizeBytes: 20 }), folder('d1', 'sub')], nextCursor: '1' }, { items: [file('f1', 'a.md', { modifiedAt: '2026-10-01', sizeBytes: 10 })] }],
      d1: [{ items: [file('f3', 'c.md')] }],
    });
    const source = createDriveDirectorySource(CONNECTION);
    const entries = await listed(source);
    expect(entries.map((e) => e.path)).toEqual(['a.md', 'b.md', 'sub/c.md']);
    expect(drive.list).toHaveBeenCalledWith(3, null, undefined);
    expect(drive.list).toHaveBeenCalledWith(3, null, '1');
    expect(drive.list).toHaveBeenCalledWith(3, 'd1', undefined);
  });

  it('hashes by metadata (id, modified time, size) — a changed file gets a new hash, a size defaults to 0', async () => {
    serve({ root: [{ items: [file('f1', 'a.md', { modifiedAt: '2026-10-01', sizeBytes: 10 }), file('f2', 'b.md')] }] });
    const entries = await listed(createDriveDirectorySource(CONNECTION));
    expect(entries[0]).toEqual({ path: 'a.md', hash: metadataHash('f1', '2026-10-01', 10), size: 10 });
    expect(entries[1]).toEqual({ path: 'b.md', hash: metadataHash('f2', undefined, undefined), size: 0 });
    expect(entries[0]!.hash).not.toBe(metadataHash('f1', '2026-10-02', 10));
  });

  it('walks once, however many times it is listed and read', async () => {
    serve({ root: [{ items: [file('f1', 'a.md')] }] });
    drive.fetchFile.mockResolvedValue({ text: async () => 'hello' });
    const source = createDriveDirectorySource(CONNECTION);
    await listed(source);
    await listed(source);
    await source.read('a.md');
    expect(drive.list).toHaveBeenCalledTimes(1);
  });

  it('reads a file through the drive client as a text document', async () => {
    serve({ root: [{ items: [file('f1', 'a.md')] }] });
    drive.fetchFile.mockResolvedValue({ text: async () => '# Hello' });
    const source = createDriveDirectorySource(CONNECTION);
    const doc = await source.read('a.md');
    expect(drive.fetchFile).toHaveBeenCalledWith(3, expect.objectContaining({ id: 'f1' }));
    expect(doc.id).toBe('a.md');
    expect(doc.content).toMatchObject({ kind: 'text', text: '# Hello' });
  });

  it('reads a path the drive does not have as empty text, without a download', async () => {
    serve({ root: [{ items: [] }] });
    const doc = await createDriveDirectorySource(CONNECTION).read('missing.md');
    expect(doc.content).toMatchObject({ text: '' });
    expect(drive.fetchFile).not.toHaveBeenCalled();
  });

  it('is bounded: no deeper than maxDepth, no more than maxFiles', async () => {
    serve({
      root: [{ items: [folder('d1', 'one'), file('f1', 'a.md'), file('f2', 'b.md'), file('f3', 'c.md')] }],
      d1: [{ items: [folder('d2', 'two'), file('f4', 'd.md')] }],
      d2: [{ items: [file('f5', 'e.md')] }],
    });
    const shallow = await listed(createDriveDirectorySource(CONNECTION, null, { maxFiles: 100, maxDepth: 2 }));
    expect(shallow.map((e) => e.path)).toEqual(['a.md', 'b.md', 'c.md', 'one/d.md']);

    const capped = await listed(createDriveDirectorySource(CONNECTION, null, { maxFiles: 2, maxDepth: 8 }));
    expect(capped).toHaveLength(2);
  });

  it('has real default bounds', () => {
    expect(DRIVE_WALK_LIMITS.maxFiles).toBeGreaterThan(0);
    expect(DRIVE_WALK_LIMITS.maxDepth).toBeGreaterThan(0);
  });

  it('names the root for its account, or for the folder it was pointed at', async () => {
    serve({ f9: [{ items: [file('f1', 'a.md')] }] });
    const account = createDriveDirectorySource(CONNECTION);
    expect(account.title).toBe('Legal drive');
    expect(createDriveDirectorySource({ ...CONNECTION, displayName: '' }).title).toBe('legal@example.com');

    const sub = createDriveDirectorySource(CONNECTION, { id: 'f9', name: 'Contracts' });
    expect(sub.title).toBe('Contracts');
    expect(sub.rootId).not.toBe(account.rootId);
    expect(sub.rootId.startsWith('web:')).toBe(true);
    await listed(sub);
    expect(drive.list).toHaveBeenCalledWith(3, 'f9', undefined);
  });
});
