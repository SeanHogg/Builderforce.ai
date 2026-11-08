import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadCanvasFile = vi.hoisted(() => vi.fn());
const isGuestSession = vi.hoisted(() => vi.fn());
const publishUrl = vi.hoisted(() => vi.fn());
vi.mock('@/lib/canvasMediaStore', () => ({ uploadCanvasFile }));
vi.mock('../exportArtifact', () => ({ isGuestSession }));
vi.mock('./podcastPublish', () => ({ publishUrl }));

import { CHAPTERS_MIME, uploadPodcastChapters } from './podcastChaptersUpload';

const chapters = [{ startTimeSec: 0, title: 'Intro' }, { startTimeSec: 60, title: 'Main' }];

beforeEach(() => {
  uploadCanvasFile.mockReset(); publishUrl.mockReset(); isGuestSession.mockReset();
  isGuestSession.mockReturnValue(false);
});

describe('uploadPodcastChapters', () => {
  it('uploads the chapters JSON and returns its public URL', async () => {
    uploadCanvasFile.mockResolvedValue({ storageKey: 'k/chapters.json' });
    publishUrl.mockResolvedValue('https://api.test/pub');
    await expect(uploadPodcastChapters(chapters)).resolves.toBe('https://api.test/pub');
    const file = uploadCanvasFile.mock.calls[0]![0] as File;
    expect(file.name).toBe('chapters.json');
    expect(file.type).toBe(CHAPTERS_MIME);
    expect(JSON.parse(await file.text())).toMatchObject({ version: '1.2.0', chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 60, title: 'Main' }] });
    expect(publishUrl).toHaveBeenCalledWith('k/chapters.json');
  });

  it('gives nothing, and uploads nothing, for no chapters or a guest', async () => {
    expect(await uploadPodcastChapters([])).toBeUndefined();
    isGuestSession.mockReturnValue(true);
    expect(await uploadPodcastChapters(chapters)).toBeUndefined();
    expect(uploadCanvasFile).not.toHaveBeenCalled();
  });

  it('gives nothing when the upload returns nothing or anything fails', async () => {
    uploadCanvasFile.mockResolvedValueOnce(null);
    expect(await uploadPodcastChapters(chapters)).toBeUndefined();
    uploadCanvasFile.mockResolvedValueOnce({ storageKey: 'k' });
    publishUrl.mockRejectedValueOnce(new Error('sign'));
    expect(await uploadPodcastChapters(chapters)).toBeUndefined();
    uploadCanvasFile.mockRejectedValueOnce(new Error('network'));
    expect(await uploadPodcastChapters(chapters)).toBeUndefined();
  });
});
