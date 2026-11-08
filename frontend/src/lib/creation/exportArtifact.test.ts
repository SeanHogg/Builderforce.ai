import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasObjectData } from '@/domains/canvas/domain/canvasObject';

const upload = vi.fn();
const token = vi.fn();
vi.mock('@/lib/canvasMediaStore', () => ({ uploadCanvasFile: (file: File) => upload(file) }));
vi.mock('@/lib/auth', () => ({ getStoredTenantToken: () => token() }));

import { CreationStorageError, INLINE_MAX_BYTES, recordExport, storeCreationFile, type ExportedFile } from './exportArtifact';

const data = { kind: 'image', title: 'x' } as CanvasObjectData;
const file = (bytes: number, extra: Partial<ExportedFile> = {}): ExportedFile => ({
  blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }), fileName: 'a.png', mimeType: 'image/png', label: 'PNG', detail: 'd', ...extra,
});

beforeEach(() => { upload.mockReset(); token.mockReset(); });

describe('storeCreationFile', () => {
  it('uses the uploaded URL when the upload works', async () => {
    upload.mockResolvedValue({ url: 'https://api.example.com/api/brain/uploads/k', storageKey: 'k' });
    // The tenant-authenticated upload URL: a private export stays behind authentication.
    expect(await storeCreationFile(new File([new Uint8Array(10)], 'a.png', { type: 'image/png' }))).toBe('https://api.example.com/api/brain/uploads/k');
  });

  it('keeps a small file inline for a real guest whose upload failed', async () => {
    upload.mockResolvedValue(null);
    token.mockReturnValue(null);
    expect(await storeCreationFile(new File([new Uint8Array(10)], 'a.png', { type: 'image/png' }))).toMatch(/^data:image\/png;base64,/);
  });

  it('refuses to inline for a signed-in person whose upload failed', async () => {
    upload.mockResolvedValue(null);
    token.mockReturnValue('tenant-token');
    await expect(storeCreationFile(new File([new Uint8Array(10)], 'a.png'))).rejects.toBeInstanceOf(CreationStorageError);
  });

  it('refuses to inline a guest file over the cap', async () => {
    upload.mockResolvedValue(null);
    token.mockReturnValue(null);
    await expect(storeCreationFile(new File([new Uint8Array(INLINE_MAX_BYTES + 1)], 'a.png'))).rejects.toBeInstanceOf(CreationStorageError);
  });
});

describe('recordExport', () => {
  it('regression: records nothing when the file could not be kept (download only)', async () => {
    upload.mockResolvedValue(null);
    token.mockReturnValue('tenant-token');
    expect(await recordExport(data, 'image', file(10))).toEqual({ url: null, patch: null });
  });

  it('regression: a guest data URL is stored once, not as both the deliverable and the output', async () => {
    upload.mockResolvedValue(null);
    token.mockReturnValue(null);
    const recorded = await recordExport(data, 'image', file(10, { asOutput: true }));
    const patch = recorded.patch as Record<string, unknown>;
    expect(patch.outputUrl).toMatch(/^data:/);
    const [deliverable] = patch.deliverables as Array<{ url?: string }>;
    expect(deliverable!.url).toBeUndefined();
    expect(JSON.stringify(patch).split(patch.outputUrl as string)).toHaveLength(2);
  });

  it('keeps the deliverable URL when nothing else carries it', async () => {
    upload.mockResolvedValue({ url: 'https://api.example.com/api/brain/uploads/k', storageKey: 'k' });
    const recorded = await recordExport(data, 'image', file(10));
    expect((recorded.patch!.deliverables as Array<{ url?: string }>)[0]!.url).toBe('https://api.example.com/api/brain/uploads/k');
  });

  it('skips the upload for inline text files', async () => {
    token.mockReturnValue('tenant-token');
    const recorded = await recordExport(data, 'podcast', file(10, { inline: true }));
    expect(upload).not.toHaveBeenCalled();
    expect(recorded.url).toMatch(/^data:/);
  });
});
