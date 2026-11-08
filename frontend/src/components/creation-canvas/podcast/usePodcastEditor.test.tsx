import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { CreationNodeData } from '../types';

const withPublishedEnclosure = vi.hoisted(() => vi.fn());
const uploadPodcastChapters = vi.hoisted(() => vi.fn());
const measureRemoteBytes = vi.hoisted(() => vi.fn());
const recordExport = vi.hoisted(() => vi.fn());
const downloadBlob = vi.hoisted(() => vi.fn());
vi.mock('@/lib/creation/podcast/podcastPublish', () => ({ withPublishedEnclosure }));
vi.mock('@/lib/creation/podcast/podcastChaptersUpload', () => ({ uploadPodcastChapters }));
vi.mock('@/lib/creation/podcast/podcastAudioSize', () => ({ measureRemoteBytes }));
vi.mock('@/lib/creation/exportArtifact', () => ({ recordExport }));
vi.mock('@/lib/download', () => ({ downloadBlob }));
vi.mock('@/lib/canvasMediaStore', () => ({ storeCanvasMedia: vi.fn() }));

import { usePodcastEditor } from './usePodcastEditor';

const labels = { chapters: 'Chapters', notesFormat: 'Markdown', rssDetail: (count: number) => `${count} segments` };

const source = { id: 's1', kind: 'audio', captureKind: 'import', url: 'https://cdn.example/ep.mp3', fileName: 'ep.mp3', mimeType: 'audio/mpeg', durationSeconds: 30 };
const clip = { id: 'c1', sourceId: 's1', track: 'voiceover', startSeconds: 0, durationSeconds: 30, trimStartSeconds: 0, volume: 1, label: 'ep', chapterTitle: 'Intro' };
const validData = (overrides: Record<string, unknown> = {}) => ({
  kind: 'podcast', title: 'Episode One',
  podcastTimeline: { version: 1, fps: 30, width: 1280, height: 720, backgroundColor: '#000000', clips: [clip] },
  podcastSources: [source],
  podcastEpisode: { sourceBytes: { s1: 4096 } },
  podcastShow: { title: 'The Show', ownerEmail: 'a@example.com', imageUrl: 'https://example.com/a.jpg', link: 'https://example.com' },
  ...overrides,
} as unknown as CreationNodeData);

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  [withPublishedEnclosure, uploadPodcastChapters, measureRemoteBytes, recordExport, downloadBlob].forEach((mock) => mock.mockReset());
  withPublishedEnclosure.mockImplementation(async (object: unknown) => object);
  uploadPodcastChapters.mockResolvedValue('https://pub.example/chapters.json');
  recordExport.mockResolvedValue({ url: 'https://x/feed.xml', patch: {} });
});

describe('usePodcastEditor RSS export', () => {
  it('publishes the enclosure, uploads the chapters, and downloads a feed that points at both', async () => {
    const data = validData();
    const onEdit = vi.fn();
    const { result } = renderHook(() => usePodcastEditor(data, 'obj-1', onEdit, labels));
    await act(async () => { result.current.exportRss(); });
    await waitFor(() => expect(result.current.exportStatus).toBe('done'));

    expect(withPublishedEnclosure).toHaveBeenCalledWith(data);
    expect(uploadPodcastChapters).toHaveBeenCalledWith([{ startTimeSec: 0, title: 'Intro' }]);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, fileName] = downloadBlob.mock.calls[0]!;
    expect(fileName).toBe('episode-one-feed.xml');
    const xml = await readBlob(blob as Blob);
    expect(xml).toContain('<enclosure url="https://cdn.example/ep.mp3" length="4096"');
    expect(xml).toContain('https://pub.example/chapters.json');
    expect(recordExport).toHaveBeenCalledWith(data, 'podcast', expect.objectContaining({ action: 'export-rss', detail: '1 segments', inline: true }));
    expect(result.current.feedProblems).toEqual([]);
  });

  it('uses the published copy of the object for the feed', async () => {
    withPublishedEnclosure.mockImplementation(async (object: Record<string, unknown>) => ({
      ...object, podcastSources: [{ ...source, url: 'https://pub.example/signed.mp3?sig=1' }],
    }));
    const { result } = renderHook(() => usePodcastEditor(validData(), 'obj-1', vi.fn(), labels));
    await act(async () => { result.current.exportRss(); });
    await waitFor(() => expect(result.current.exportStatus).toBe('done'));
    expect(await readBlob(downloadBlob.mock.calls[0]![0] as Blob)).toContain('https://pub.example/signed.mp3?sig=1');
  });

  it('reports the standing feed problems instead of publishing when the feed is incomplete', async () => {
    const data = validData({ podcastShow: { title: 'The Show' } });
    const { result } = renderHook(() => usePodcastEditor(data, 'obj-1', vi.fn(), labels));
    await act(async () => { result.current.exportRss(); });
    expect(result.current.feedProblems).toEqual(expect.arrayContaining(['noOwnerEmail', 'noImage', 'noLink']));
    expect(withPublishedEnclosure).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(result.current.exportStatus).toBe('idle');
  });

  it('surfaces a failed export as the export problem', async () => {
    uploadPodcastChapters.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePodcastEditor(validData(), 'obj-1', vi.fn(), labels));
    await act(async () => { result.current.exportRss(); });
    await waitFor(() => expect(result.current.problem).toBe('export'));
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});

describe('usePodcastEditor master file size', () => {
  it('measures a newly typed master URL and records its size', async () => {
    measureRemoteBytes.mockResolvedValue(9000);
    const onEdit = vi.fn();
    const data = validData();
    const { result, rerender } = renderHook((props: { data: CreationNodeData }) => usePodcastEditor(props.data, 'obj-1', onEdit, labels), { initialProps: { data } });
    act(() => { result.current.patchEpisode({ audioUrl: 'https://cdn.example/master.mp3' }); });
    // The host answers for the URL the object now carries.
    rerender({ data: { ...data, podcastEpisode: { audioUrl: 'https://cdn.example/master.mp3' } } as unknown as CreationNodeData });
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith({ podcastEpisode: expect.objectContaining({ audioUrl: 'https://cdn.example/master.mp3', audioBytes: 9000 }) }));
    expect(measureRemoteBytes).toHaveBeenCalledWith('https://cdn.example/master.mp3');
  });

  it('shows the size-unknown problem when the host will not say', async () => {
    measureRemoteBytes.mockResolvedValue(null);
    const data = validData();
    const { result, rerender } = renderHook((props: { data: CreationNodeData }) => usePodcastEditor(props.data, 'obj-1', vi.fn(), labels), { initialProps: { data } });
    act(() => { result.current.patchEpisode({ audioUrl: 'https://cdn.example/master.mp3' }); });
    rerender({ data: { ...data, podcastEpisode: { audioUrl: 'https://cdn.example/master.mp3' } } as unknown as CreationNodeData });
    await waitFor(() => expect(result.current.feedProblems).toEqual(['noEnclosureLength']));
  });
});
