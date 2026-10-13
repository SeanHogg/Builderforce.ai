/**
 * `replay_export` — render one Insights recording to a video (PRD 33 D10, §8 S4b).
 *
 * A replay is a DOM reconstruction, so the video is RENDERED, never screen-captured:
 * open a static page that loads the CDN player bundle (rrweb's Replayer as the
 * `BuilderforceReplayPlayer` global) at the recording's viewport, feed it the
 * recording's chunks, play with `skipInactive`, and let Playwright's `recordVideo`
 * capture the page. WebM is transcoded to MP4 with ffmpeg when the image has it;
 * otherwise the WebM is delivered and reported as such.
 *
 * Every callback uses the export's own capability token (Bearer) — it can read this
 * export's chunks and report this export's outcome, nothing else. The job body is
 * built by `api/src/application/replay/replayVideoExport.ts` (`jobPayload`).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const REPLAY_EXPORT_JOB = 'replay_export';
/** Longest playback rendered (skipInactive already compresses idle time). */
export const MAX_PLAYBACK_MS = 15 * 60_000;
/** Grace after the timeline's end for the player to emit `finish`. */
const FINISH_SLACK_MS = 5_000;
const PLAYER_ORIGIN = 'https://replay-export.invalid';
const VIEWPORT_MIN = { w: 320, h: 320 };
const VIEWPORT_MAX = { w: 1920, h: 1080 };

/** A reason the job body is unusable, or null when it is well-formed. */
export function validateReplayExportJob(spec) {
  if (!spec || typeof spec !== 'object') return 'missing job body';
  for (const field of ['exportId', 'exportToken', 'statusUrl', 'uploadUrl', 'playerUrl', 'playerCssUrl', 'playerGlobal']) {
    if (typeof spec[field] !== 'string' || spec[field].length === 0) return `missing ${field}`;
  }
  for (const field of ['statusUrl', 'uploadUrl', 'playerUrl', 'playerCssUrl']) {
    if (!spec[field].startsWith('https://')) return `${field} must be https`;
  }
  if (!Array.isArray(spec.chunkUrls) || spec.chunkUrls.length === 0) return 'missing chunkUrls';
  if (!spec.chunkUrls.every((url) => typeof url === 'string' && url.startsWith('https://'))) return 'chunkUrls must be https';
  if (!/^[A-Za-z_$][\w$]*$/.test(spec.playerGlobal)) return 'playerGlobal is not an identifier';
  const { viewport } = spec;
  if (!viewport || !Number.isFinite(viewport.w) || !Number.isFinite(viewport.h)) return 'missing viewport';
  return null;
}

/** The recording viewport, clamped and made even (H.264 needs even dimensions). */
export function videoSize(viewport) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value) || min));
  const even = (value) => value - (value % 2);
  return {
    width: even(clamp(viewport.w, VIEWPORT_MIN.w, VIEWPORT_MAX.w)),
    height: even(clamp(viewport.h, VIEWPORT_MIN.h, VIEWPORT_MAX.h)),
  };
}

/** The rrweb timeline's length: last event timestamp minus the first (0 for fewer than two). */
export function timelineDurationMs(events) {
  let first = Infinity;
  let last = -Infinity;
  for (const event of events) {
    const at = Number(event?.timestamp);
    if (!Number.isFinite(at)) continue;
    if (at < first) first = at;
    if (at > last) last = at;
  }
  return last > first ? last - first : 0;
}

/** How long to wait for `finish` before stopping the recording anyway. */
export function playbackBudgetMs(events) {
  return Math.min(MAX_PLAYBACK_MS, timelineDurationMs(events) + FINISH_SLACK_MS);
}

/** rrweb events from one stored chunk: gzip NDJSON, each line a parsed `ReplayChunk`. */
export function decodeChunk(bytes) {
  const text = gunzipSync(bytes).toString('utf8');
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const chunk = JSON.parse(line);
    if (Array.isArray(chunk?.events)) events.push(...chunk.events);
  }
  return events;
}

/** Events in timestamp order (chunks arrive in seq order, but a split chunk may interleave). */
export function orderEvents(events) {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (Number(a.event?.timestamp) - Number(b.event?.timestamp)) || (a.index - b.index))
    .map(({ event }) => event);
}

const escapeAttr = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The static player page: the CDN bundle + stylesheet and a full-bleed root. */
export function playerPageHtml({ playerUrl, playerCssUrl }) {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<link rel="stylesheet" href="${escapeAttr(playerCssUrl)}">`,
    '<style>html,body{margin:0;padding:0;overflow:hidden;background:#fff}#root{position:relative}</style>',
    `<script src="${escapeAttr(playerUrl)}"></script>`,
    '</head><body><div id="root"></div></body></html>',
  ].join('');
}

function errMsg(err) {
  return (err instanceof Error ? err.message : String(err)).slice(0, 380);
}

function makeClient(spec) {
  const auth = { Authorization: `Bearer ${spec.exportToken}` };
  return {
    async report(status, error = null) {
      const res = await fetch(spec.statusUrl, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, error }),
      });
      if (!res.ok) throw new Error(`PATCH status → ${res.status}`);
    },
    async chunk(url) {
      const res = await fetch(url, { headers: auth });
      if (!res.ok) throw new Error(`GET chunk → ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async upload(bytes, contentType) {
      const res = await fetch(spec.uploadUrl, { method: 'POST', headers: { ...auth, 'Content-Type': contentType }, body: bytes });
      if (!res.ok) throw new Error(`POST video → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },
  };
}

/** WebM → MP4 with ffmpeg; null when ffmpeg is absent or fails (the WebM is kept). */
function transcodeToMp4(input, output) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', output]);
    } catch {
      resolve(null);
      return;
    }
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? output : null));
  });
}

/** Play the events in the page and resolve when the player finishes (or the budget runs out). */
async function play(page, spec, budgetMs) {
  const finished = page.evaluate(async ({ global }) => {
    const events = await (await fetch('/events.json')).json();
    const Player = window[global]?.Replayer;
    if (!Player) throw new Error('player bundle did not load');
    const replayer = new Player(events, {
      root: document.getElementById('root'),
      skipInactive: true,
      speed: 1,
      mouseTail: false,
      showWarning: false,
      UNSAFE_replayCanvas: true,
    });
    return new Promise((resolve) => {
      replayer.on('finish', () => resolve(true));
      replayer.play(0);
    });
  }, { global: spec.playerGlobal }).catch((err) => {
    // Closing the context mid-play rejects the evaluation; a missing bundle rejects it early.
    if (/player bundle/.test(String(err))) throw err;
    return false;
  });
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), budgetMs); });
  try {
    return await Promise.race([finished, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Run one export job end to end. Reports `failed` on any error; never throws past it. */
export async function runReplayExport(spec) {
  const client = makeClient(spec);
  const workDir = await mkdtemp(join(tmpdir(), 'replay-export-'));
  let browser;
  try {
    await client.report('running');
    const events = [];
    for (const url of spec.chunkUrls) events.push(...decodeChunk(await client.chunk(url)));
    const ordered = orderEvents(events);
    if (ordered.length < 2) throw new Error('recording has no replayable events');

    const size = videoSize(spec.viewport);
    // Imported here so the pure helpers above load (and test) without a browser install.
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: size, recordVideo: { dir: workDir, size } });
    await context.route(`${PLAYER_ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/events.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ordered) });
      return route.fulfill({ contentType: 'text/html', body: playerPageHtml(spec) });
    });
    const page = await context.newPage();
    await page.goto(`${PLAYER_ORIGIN}/`, { waitUntil: 'load' });
    const completed = await play(page, spec, playbackBudgetMs(ordered));
    if (!completed) console.warn(`[qa-runner] replay_export ${spec.exportId}: playback budget reached; delivering what played`);

    const video = page.video();
    await context.close(); // flushes the WebM
    const webm = await video.path();
    const mp4 = await transcodeToMp4(webm, join(workDir, `${spec.exportId}.mp4`));
    const file = mp4 ?? webm;
    await client.upload(await readFile(file), mp4 ? 'video/mp4' : 'video/webm');
    console.log(`[qa-runner] replay_export ${spec.exportId}: delivered ${mp4 ? 'mp4' : 'webm'}`);
  } catch (err) {
    console.error(`[qa-runner] replay_export ${spec.exportId} failed`, errMsg(err));
    await client.report('failed', errMsg(err)).catch(() => {});
  } finally {
    await browser?.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
