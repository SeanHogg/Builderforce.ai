import { describe, expect, it } from 'vitest';
import { projectMediaView } from './projectMedia';

const BASE = {
  id: '6b7eed6e-0000-4000-8000-000000000001',
  tenantId: 1,
  objectId: '6b7eed6e-0000-4000-8000-0000000000aa',
  kind: 'video',
  title: 'steam rising off bread',
  mime: 'video/mp4',
  storageKey: '1/media/clip.mp4',
  byteSize: null,
  checksum: null,
  width: null,
  height: null,
  durationMs: 5_000,
  language: null,
  status: 'ready',
  derivedFromId: null,
  attrs: { prompt: 'steam rising off fresh bread, slow push-in', url: 'https://api/api/assets/1/media/clip.mp4', model: 'pollinations/wan-2.2-fast', usedAt: '2026-10-04T20:00:00.000Z' },
  createdBy: 'u1',
  createdAt: new Date('2026-10-04T19:00:00.000Z'),
  updatedAt: new Date('2026-10-04T19:00:00.000Z'),
};

describe('projectMediaView', () => {
  it('reads the stored facts back as the client shape', () => {
    expect(projectMediaView(BASE)).toEqual({
      id: BASE.id,
      kind: 'video',
      status: 'ready',
      prompt: 'steam rising off fresh bread, slow push-in',
      url: 'https://api/api/assets/1/media/clip.mp4',
      storageKey: '1/media/clip.mp4',
      mimeType: 'video/mp4',
      width: null,
      height: null,
      durationSeconds: 5,
      model: 'pollinations/wan-2.2-fast',
      jobId: null,
      error: null,
      usedAt: '2026-10-04T20:00:00.000Z',
      createdAt: '2026-10-04T19:00:00.000Z',
    });
  });

  it('falls back to the title for the prompt and to safe values for unknown kinds and statuses', () => {
    const view = projectMediaView({ ...BASE, kind: 'document', status: 'archived', attrs: null, durationMs: null });
    expect(view).toMatchObject({ kind: 'image', status: 'ready', prompt: BASE.title, url: null, durationSeconds: null });
  });
});
