/**
 * The pure half of the `replay_export` job: job-body validation, the video size,
 * the timeline duration and playback budget, chunk decoding and event ordering.
 * Plain `node --test` (the image has no test framework); the browser half needs
 * Chromium and is exercised by a real export, not here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import {
  decodeChunk,
  MAX_PLAYBACK_MS,
  orderEvents,
  playbackBudgetMs,
  playerPageHtml,
  timelineDurationMs,
  validateReplayExportJob,
  videoSize,
} from './replayExport.mjs';

const job = (over = {}) => ({
  kind: 'replay_export',
  exportId: 'e1',
  exportToken: 'tok',
  chunkUrls: ['https://api.test/api/replay/export-runner/e1/chunks/3'],
  statusUrl: 'https://api.test/api/replay/export-runner/e1',
  uploadUrl: 'https://api.test/api/replay/export-runner/e1/video',
  playerUrl: 'https://cdn.test/replay/r/player.abc.js',
  playerCssUrl: 'https://cdn.test/replay/r/player.def.css',
  playerGlobal: 'BuilderforceReplayPlayer',
  viewport: { w: 1280, h: 720 },
  durationMs: 60_000,
  ...over,
});

test('accepts a well-formed job', () => {
  assert.equal(validateReplayExportJob(job()), null);
});

test('refuses a job missing its token, chunks or viewport', () => {
  assert.equal(validateReplayExportJob(job({ exportToken: '' })), 'missing exportToken');
  assert.equal(validateReplayExportJob(job({ chunkUrls: [] })), 'missing chunkUrls');
  assert.equal(validateReplayExportJob(job({ viewport: null })), 'missing viewport');
  assert.equal(validateReplayExportJob(null), 'missing job body');
});

test('refuses plain-http URLs and a non-identifier player global', () => {
  assert.equal(validateReplayExportJob(job({ uploadUrl: 'http://api.test/x' })), 'uploadUrl must be https');
  assert.equal(validateReplayExportJob(job({ chunkUrls: ['http://api.test/c'] })), 'chunkUrls must be https');
  assert.equal(validateReplayExportJob(job({ playerGlobal: 'alert(1)' })), 'playerGlobal is not an identifier');
});

test('clamps the viewport and keeps both sides even', () => {
  assert.deepEqual(videoSize({ w: 1280, h: 720 }), { width: 1280, height: 720 });
  assert.deepEqual(videoSize({ w: 391, h: 845 }), { width: 390, height: 844 });
  assert.deepEqual(videoSize({ w: 4000, h: 100 }), { width: 1920, height: 320 });
  assert.deepEqual(videoSize({ w: 0, h: Number.NaN }), { width: 320, height: 320 });
});

test('measures the timeline and bounds the playback budget', () => {
  assert.equal(timelineDurationMs([{ timestamp: 1_000 }, { timestamp: 4_500 }, { timestamp: 2_000 }]), 3_500);
  assert.equal(timelineDurationMs([{ timestamp: 1_000 }]), 0);
  assert.equal(timelineDurationMs([{ type: 4 }, {}]), 0);
  assert.equal(playbackBudgetMs([{ timestamp: 0 }, { timestamp: 10_000 }]), 15_000);
  assert.equal(playbackBudgetMs([{ timestamp: 0 }, { timestamp: 3_600_000 }]), MAX_PLAYBACK_MS);
});

test('decodes a stored chunk (gzip NDJSON) into its rrweb events', () => {
  const line = JSON.stringify({ v: 1, seq: 3, marks: [], events: [{ type: 2, timestamp: 1 }, { type: 3, timestamp: 2 }] });
  const events = decodeChunk(gzipSync(Buffer.from(`${line}\n`)));
  assert.deepEqual(events, [{ type: 2, timestamp: 1 }, { type: 3, timestamp: 2 }]);
  assert.deepEqual(decodeChunk(gzipSync(Buffer.from(JSON.stringify({ v: 1, marks: [] })))), []);
});

test('orders events by timestamp, stably', () => {
  const ordered = orderEvents([{ id: 'b', timestamp: 2 }, { id: 'a', timestamp: 1 }, { id: 'c', timestamp: 2 }]);
  assert.deepEqual(ordered.map((e) => e.id), ['a', 'b', 'c']);
});

test('the player page loads the bundle and stylesheet, escaped', () => {
  const html = playerPageHtml({ playerUrl: 'https://cdn.test/p.js?a=1&b="2"', playerCssUrl: 'https://cdn.test/p.css' });
  assert.match(html, /<script src="https:\/\/cdn\.test\/p\.js\?a=1&amp;b=&quot;2&quot;"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="https:\/\/cdn\.test\/p\.css">/);
  assert.match(html, /<div id="root"><\/div>/);
});
