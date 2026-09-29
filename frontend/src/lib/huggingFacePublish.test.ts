import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';

const bundleZip = zipSync({
  'config.json': strToU8('{"model_type":"evermind"}'),
  'README.md': strToU8('# model card'),
  'model.safetensors': new Uint8Array([1, 2, 3]),
});

// vi.mock factories run before this module's body, so their state is hoisted too.
const hub = vi.hoisted(() => ({ createRepo: vi.fn(async () => ({})), uploadFiles: vi.fn(async () => ({})) }));
const exportFetch = vi.hoisted(() => ({ zip: null as Uint8Array | null }));

vi.mock('./studioModelsApi', () => ({
  fetchPublishedModelExport: vi.fn(async () => ({ blob: new Blob([exportFetch.zip!]), filename: 'm-evermind-hf.zip' })),
}));
vi.mock('@huggingface/hub', () => hub);
exportFetch.zip = bundleZip;
const { createRepo, uploadFiles } = hub;

import { fetchPublishedModelExport } from './studioModelsApi';
import { isHuggingFaceRepoId, publishModelToHuggingFace, unzipExportBundle } from './huggingFacePublish';

describe('isHuggingFaceRepoId', () => {
  it('accepts owner/name and rejects anything else', () => {
    expect(isHuggingFaceRepoId('builderforce/Evermind-1.2')).toBe(true);
    expect(isHuggingFaceRepoId('  me/model_x ')).toBe(true);
    expect(isHuggingFaceRepoId('model')).toBe(false);
    expect(isHuggingFaceRepoId('a/b/c')).toBe(false);
    expect(isHuggingFaceRepoId('me/ has space')).toBe(false);
  });
});

describe('unzipExportBundle', () => {
  it('unpacks the repo bundle into export files with content types', () => {
    const result = unzipExportBundle(bundleZip);
    const byPath = Object.fromEntries(result.files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual(['README.md', 'config.json', 'model.safetensors']);
    expect(byPath['config.json'].contentType).toBe('application/json');
    expect(byPath['README.md'].contentType).toBe('text/markdown');
    expect(byPath['model.safetensors'].contentType).toBe('application/octet-stream');
    expect(Array.from(byPath['model.safetensors'].data as Uint8Array)).toEqual([1, 2, 3]);
  });
});

describe('publishModelToHuggingFace', () => {
  it('pushes the huggingface export bundle to the named repo with the given token', async () => {
    const outcome = await publishModelToHuggingFace('my-model', { repoId: ' me/my-model ', token: 'hf_x', private: true });

    expect(fetchPublishedModelExport).toHaveBeenCalledWith('my-model', 'huggingface', false);
    expect(createRepo).toHaveBeenCalledWith({ repo: { type: 'model', name: 'me/my-model' }, accessToken: 'hf_x', private: true });
    const upload = uploadFiles.mock.calls[0][0] as unknown as { files: Array<{ path: string }>; accessToken: string };
    expect(upload.accessToken).toBe('hf_x');
    expect(upload.files.map((f) => f.path).sort()).toEqual(['README.md', 'config.json', 'model.safetensors']);
    expect(outcome.url).toBe('https://huggingface.co/me/my-model');
  });
});
