import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { CreationNodeData } from '../types';

const recordExport = vi.hoisted(() => vi.fn());
const downloadBlob = vi.hoisted(() => vi.fn());
vi.mock('@/lib/creation/exportArtifact', () => ({ recordExport }));
vi.mock('@/lib/download', () => ({ downloadBlob }));

import { useExportArtifact } from './useExportArtifact';

const data = { kind: 'animation', title: 'Loop' } as CreationNodeData;
const file = { blob: new Blob(['x']), fileName: 'loop.gif', mimeType: 'image/gif', label: 'GIF', detail: '1 frames' };

beforeEach(() => { recordExport.mockReset(); downloadBlob.mockReset(); });

describe('useExportArtifact', () => {
  it('renders, records on the object, downloads, and ends done', async () => {
    recordExport.mockResolvedValue({ url: 'https://x/y', patch: { outputUrl: 'https://x/y' } });
    const onEdit = vi.fn();
    const render = vi.fn().mockResolvedValue({ ...file, patch: { extra: 1 } });
    const { result } = renderHook(() => useExportArtifact<'gif'>({ data, artifactKind: 'animation', onEdit, render }));
    expect(result.current.status).toBe('idle');
    await act(async () => { await result.current.run('gif'); });
    expect(render).toHaveBeenCalledWith('gif', data);
    expect(recordExport).toHaveBeenCalledWith(data, 'animation', expect.objectContaining({ fileName: 'loop.gif' }));
    expect(onEdit).toHaveBeenCalledWith({ outputUrl: 'https://x/y', extra: 1 });
    expect(downloadBlob).toHaveBeenCalledWith(file.blob, 'loop.gif');
    expect(result.current).toMatchObject({ status: 'done', format: 'gif', error: null });
  });

  it('downloads without recording on a read-only view', async () => {
    const render = vi.fn().mockResolvedValue(file);
    const { result } = renderHook(() => useExportArtifact<'gif'>({ data, artifactKind: 'animation', render }));
    await act(async () => { await result.current.run('gif'); });
    expect(recordExport).not.toHaveBeenCalled();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('done');
  });

  it('reports unsaved when the file could not be kept, but still downloads', async () => {
    recordExport.mockResolvedValue({ url: null, patch: null });
    const onEdit = vi.fn();
    const { result } = renderHook(() => useExportArtifact<'gif'>({ data, artifactKind: 'animation', onEdit, render: async () => file }));
    await act(async () => { await result.current.run('gif'); });
    expect(onEdit).not.toHaveBeenCalled();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('unsaved');
  });

  it('fails with the thrown error and downloads nothing', async () => {
    const boom = new Error('render failed');
    const { result } = renderHook(() => useExportArtifact<'gif'>({ data, artifactKind: 'animation', render: async () => { throw boom; } }));
    await act(async () => { await result.current.run('gif'); });
    expect(result.current).toMatchObject({ status: 'failed', error: boom });
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('records against the latest options, not the ones from the first render', async () => {
    recordExport.mockResolvedValue({ url: 'u', patch: {} });
    const fresh = { kind: 'animation', title: 'Newer' } as CreationNodeData;
    const render = vi.fn().mockResolvedValue(file);
    const { result, rerender } = renderHook((props: { data: CreationNodeData }) => useExportArtifact<'gif'>({ data: props.data, artifactKind: 'animation', onEdit: vi.fn(), render }), { initialProps: { data } });
    rerender({ data: fresh });
    await act(async () => { await result.current.run('gif'); });
    expect(render).toHaveBeenCalledWith('gif', fresh);
  });
});
