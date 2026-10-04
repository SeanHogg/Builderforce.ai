/**
 * Media Render — the long-lived process behind MediaRenderContainerDO.
 *
 * POST /render  (body = MovieRenderRequest from api/src/application/llm/video/mediaJob.ts)
 *   1. download every item's URL into a scratch directory
 *   2. probe which video files carry an audio stream
 *   3. composite with ONE ffmpeg run:
 *        - a solid background of the timeline's colour and size
 *        - each visual item scaled to fit (letterboxed, like the browser
 *          renderer's drawContained), shifted to its start, overlaid for its span
 *        - each caption drawn with drawtext while its clip is on screen
 *        - every audio source (music, voiceover, sfx, and a video's own sound)
 *          delayed to its start, trimmed, gain-adjusted and mixed
 *   4. answer with the MP4 (H.264 + AAC, faststart)
 *
 * The request carries fetchable URLs only — the Worker resolved them from the
 * tenant's own storage — so this process holds no credentials.
 *
 * Plain Node ESM, no dependencies: it mirrors the browser renderer
 * (frontend/src/lib/canvasVideoRender.ts) in ffmpeg terms. Keep the two in step
 * when the timeline model changes.
 */
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PORT = Number(process.env.PORT || 8080);
const MAX_RENDER_MS = 12 * 60_000;
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const extFor = (kind, contentType) => {
  if (kind === 'image') return contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  if (kind === 'audio') return contentType.includes('wav') ? '.wav' : contentType.includes('ogg') ? '.ogg' : contentType.includes('webm') ? '.webm' : '.mp3';
  return contentType.includes('webm') ? '.webm' : '.mp4';
};

async function download(item, dir, index) {
  const res = await fetch(item.url);
  if (!res.ok) throw new Error(`could not download clip ${index + 1} (${res.status})`);
  const path = join(dir, `item-${index}${extFor(item.kind, res.headers.get('content-type') ?? '')}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

async function hasAudio(path) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', path]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

const fixed = (n) => Number(n).toFixed(3);

/**
 * Build ffmpeg arguments for a render. Pure: `files[i]` is the local path of
 * `request.items[i]`, `audible[i]` whether it has an audio stream.
 */
export function buildFfmpegArgs(request, files, audible, captionFiles, outPath) {
  const { width, height, fps, backgroundColor, items } = request;
  const total = items.reduce((end, item) => Math.max(end, item.startSeconds + item.durationSeconds), 0);
  const color = /^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor.replace('#', '0x') : '0x000000';
  const args = ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${width}x${height}:r=${fps}:d=${fixed(total)}`];
  const filters = [];
  const audioLabels = [];
  let base = '[0:v]';
  let input = 1;

  items.forEach((item, i) => {
    const span = `between(t,${fixed(item.startSeconds)},${fixed(item.startSeconds + item.durationSeconds)})`;
    if (item.kind === 'image') {
      args.push('-loop', '1', '-t', fixed(item.durationSeconds), '-i', files[i]);
    } else {
      args.push('-ss', fixed(item.trimStartSeconds), '-t', fixed(item.durationSeconds), '-i', files[i]);
    }
    const k = input++;
    if (item.track === 'visual' && item.kind !== 'audio') {
      filters.push(
        `[${k}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${color},fps=${fps},` +
        `setpts=PTS-STARTPTS+${fixed(item.startSeconds)}/TB[v${i}]`,
      );
      filters.push(`${base}[v${i}]overlay=enable='${span}':eof_action=pass[o${i}]`);
      base = `[o${i}]`;
      if (captionFiles[i]) {
        const size = Math.max(22, Math.round(height * 0.038));
        filters.push(
          `${base}drawtext=fontfile=${FONT}:textfile=${captionFiles[i]}:fontcolor=white:fontsize=${size}:` +
          `box=1:boxcolor=black@0.72:boxborderw=${Math.round(height * 0.018)}:x=(w-text_w)/2:y=h-text_h-${Math.round(height * 0.05)}:` +
          `enable='${span}'[c${i}]`,
        );
        base = `[c${i}]`;
      }
    }
    if (audible[i]) {
      const delay = Math.round(item.startSeconds * 1000);
      filters.push(`[${k}:a]atrim=0:${fixed(item.durationSeconds)},asetpts=PTS-STARTPTS,adelay=${delay}|${delay},volume=${Math.max(0, Math.min(2, item.volume))}[a${i}]`);
      audioLabels.push(`[a${i}]`);
    }
  });

  filters.push(`${base}null[vout]`);
  if (audioLabels.length > 0) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest[aout]`);
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (audioLabels.length > 0) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
  args.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-r', String(fps), '-t', fixed(total), '-movflags', '+faststart', outPath,
  );
  return args;
}

function validRequest(body) {
  return body
    && Number.isFinite(body.width) && Number.isFinite(body.height) && Number.isFinite(body.fps)
    && Array.isArray(body.items) && body.items.length > 0
    && body.items.every((item) => typeof item?.url === 'string' && /^https:\/\//.test(item.url));
}

async function render(request) {
  const dir = await mkdtemp(join(tmpdir(), 'render-'));
  try {
    const files = await Promise.all(request.items.map((item, i) => download(item, dir, i)));
    const audible = await Promise.all(request.items.map((item, i) => (item.kind === 'image' ? false : hasAudio(files[i]))));
    const captionFiles = await Promise.all(request.items.map(async (item, i) => {
      if (!item.captions?.trim()) return null;
      const path = join(dir, `caption-${i}.txt`);
      await writeFile(path, item.captions.trim());
      return path;
    }));
    const out = join(dir, 'movie.mp4');
    await run('ffmpeg', buildFfmpegArgs(request, files, audible, captionFiles, out), { timeout: MAX_RENDER_MS, maxBuffer: 16 * 1024 * 1024 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200).end('ok'); return; }
  if (req.method !== 'POST' || req.url !== '/render') { res.writeHead(404).end('not found'); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
  if (!validRequest(body)) { res.writeHead(400).end('invalid render request'); return; }
  try {
    const mp4 = await render(body);
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(mp4.length) }).end(mp4);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[media-render] render failed', message);
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(message.split('\n').slice(-3).join(' ').slice(0, 300));
  }
}).listen(PORT, () => console.log(`[media-render] listening on ${PORT}`));
