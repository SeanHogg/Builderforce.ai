import { describe, expect, it } from 'vitest';
import {
  patchForTick,
  YOUTUBE_UPLOAD_MAX_ATTEMPTS,
  youtubeRetryDelaySeconds,
  youtubeUploadView,
  type YouTubeUploadRow,
} from './youtubeUploadJobs';

/**
 * The job's state machine, without a database: what each tick outcome writes to the
 * row, and what the canvas tile and campaign row are shown.
 */

const NOW = new Date('2026-10-10T12:00:00Z');

const row = (patch: Partial<YouTubeUploadRow> = {}): YouTubeUploadRow => ({
  id: '00000000-0000-4000-8000-000000000001', tenantId: 7, userId: 'u1', connectionId: 3,
  storageKey: '7/u1/launch.mp4', sourceUrl: null, mimeType: 'video/mp4', byteSize: 1000,
  title: 'Launch', description: '', privacyStatus: 'public', uploadUrl: null, bytesSent: 0,
  videoId: null, state: 'uploading', processingStatus: null, attempts: 0, lastError: null,
  sessionId: null, objectId: null, campaignPostId: null, startedAt: NOW, completedAt: null,
  createdAt: NOW, updatedAt: NOW, ...patch,
});

describe('youtubeRetryDelaySeconds', () => {
  it('backs off exponentially from 30s and caps at 30 minutes', () => {
    expect(youtubeRetryDelaySeconds(0)).toBe(0);
    expect(youtubeRetryDelaySeconds(1)).toBe(30);
    expect(youtubeRetryDelaySeconds(2)).toBe(60);
    expect(youtubeRetryDelaySeconds(3)).toBe(120);
    expect(youtubeRetryDelaySeconds(20)).toBe(30 * 60);
  });
});

describe('patchForTick', () => {
  it('returns progress to `queued` — claimable — with Google\'s offset and a clean slate', () => {
    expect(patchForTick(row({ attempts: 2 }), { kind: 'progress', uploadUrl: 'u', bytesSent: 400, byteSize: 1000, mimeType: 'video/mp4' }, NOW))
      .toMatchObject({ state: 'queued', uploadUrl: 'u', bytesSent: 400, attempts: 0, lastError: null });
  });

  it('records the video id and completion on success', () => {
    expect(patchForTick(row(), { kind: 'succeeded', uploadUrl: 'u', bytesSent: 1000, byteSize: 1000, mimeType: 'video/mp4', videoId: 'abc', privacyStatus: 'public', processingStatus: 'uploaded' }, NOW))
      .toMatchObject({ state: 'succeeded', videoId: 'abc', completedAt: NOW, lastError: null });
  });

  it('requeues a transient failure with one more attempt, keeping the session', () => {
    expect(patchForTick(row({ attempts: 1 }), { kind: 'retry', uploadUrl: 'u', bytesSent: 256, byteSize: 1000, mimeType: 'video/mp4', error: '503' }, NOW))
      .toMatchObject({ state: 'queued', attempts: 2, uploadUrl: 'u', bytesSent: 256, lastError: '503' });
  });

  it('writes the upload off once the attempts are exhausted, so it cannot retry forever', () => {
    const patch = patchForTick(row({ attempts: YOUTUBE_UPLOAD_MAX_ATTEMPTS - 1 }), { kind: 'retry', uploadUrl: 'u', bytesSent: 0, byteSize: 1000, mimeType: 'video/mp4', error: '503' }, NOW);
    expect(patch.state).toBe('failed');
    expect(patch.lastError).toContain('gave up');
  });

  it('fails terminally with the reason', () => {
    expect(patchForTick(row(), { kind: 'failed', error: 'Quota exceeded' }, NOW)).toMatchObject({ state: 'failed', lastError: 'Quota exceeded', completedAt: NOW });
  });
});

describe('youtubeUploadView', () => {
  it('shows a between-ticks upload with progress as uploading, with its percent', () => {
    expect(youtubeUploadView(row({ state: 'queued', bytesSent: 250, uploadUrl: 'u' }))).toMatchObject({ state: 'uploading', percent: 25 });
  });

  it('shows an untouched row as queued', () => {
    expect(youtubeUploadView(row({ state: 'queued' }))).toMatchObject({ state: 'queued', percent: 0, url: null });
  });

  it('links a finished upload and only surfaces the error on failure', () => {
    expect(youtubeUploadView(row({ state: 'succeeded', videoId: 'abc', bytesSent: 1000, lastError: 'old' })))
      .toMatchObject({ state: 'succeeded', percent: 100, url: 'https://www.youtube.com/watch?v=abc', error: null });
    expect(youtubeUploadView(row({ state: 'failed', lastError: 'nope' }))).toMatchObject({ state: 'failed', error: 'nope' });
  });
});
