/**
 * Chunk delivery — every `REPLAY_LIMITS.flushMs` while visible, keepalive on
 * pagehide, gzip via `CompressionStream` when the browser has it, retry with
 * backoff on 5xx, honour 429 `Retry-After`, split on 413 / oversize.
 *
 * Queueing is the shared write outbox (`@builderforce/write-outbox`): events
 * and marks enter ONE ordered lane, a chunk leaves at `maxEventsPerChunk`
 * items or `flushMs` after the first, and only one chunk is on the wire at a
 * time — so chunks (and their retries) land in `seq` order. This class owns
 * only what is replay-specific: the chunk shape and the retry / split policy.
 */

import {
  parseReplayChunk,
  REPLAY_LIMITS,
  type ReplayChunk,
  type ReplayMark,
} from '@builderforce/interaction-contract';
import { createOutbox, type Outbox } from '@builderforce/write-outbox';

/** Everything a chunk carries except its seq and its payload. */
export type ChunkHeader = Omit<ReplayChunk, 'seq' | 'marks' | 'events'>;

export interface PostOptions {
  keepalive: boolean;
  gzip: boolean;
}

export interface BatchSink {
  post(url: string, body: string | ArrayBuffer, opts: PostOptions): Promise<{ status: number; retryAfterMs?: number }>;
  sleep(ms: number): Promise<void>;
}

/** gzip a JSON string; null when the browser cannot. */
export type Compressor = (json: string) => Promise<ArrayBuffer | null>;

type GzipStreamCtor = new (format: 'gzip') => TransformStream<BufferSource, Uint8Array>;

export const gzipJson: Compressor = async (json) => {
  const Gzip = (globalThis as { CompressionStream?: GzipStreamCtor }).CompressionStream;
  if (typeof Gzip !== 'function' || typeof ReadableStream === 'undefined') return null;
  const input = new TextEncoder().encode(json);
  const stream = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  }).pipeThrough(new Gzip('gzip'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out.buffer;
};

/** Browsers cap the bodies of in-flight keepalive requests at 64 KiB. */
const KEEPALIVE_MAX_BYTES = 60_000;

const defaultSink: BatchSink = {
  async post(url, body, { keepalive, gzip }) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (gzip) headers['content-encoding'] = 'gzip';
    const res = await fetch(url, { method: 'POST', body, headers, keepalive, credentials: 'omit' });
    const retryAfter = res.headers.get('retry-after');
    let retryAfterMs: number | undefined;
    if (retryAfter) {
      const seconds = Number(retryAfter);
      retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    }
    return { status: res.status, retryAfterMs };
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface BatchOptions {
  url: string;
  /** Read at send time, so keep / tags / activeMs are current. */
  header: () => ChunkHeader;
  /** The visit's next seq (persisted across page loads). */
  nextSeq: () => number;
  sink?: BatchSink;
  compress?: Compressor;
}

/** One queued entry: an rrweb event or a mark, in the order they happened. */
type ChunkItem = { event: unknown } | { mark: ReplayMark };

const VISIT_LANE = 'visit';
const MAX_ATTEMPTS = 5;

export class ChunkBatch {
  private readonly url: string;
  private readonly header: () => ChunkHeader;
  private readonly nextSeq: () => number;
  private readonly sink: BatchSink;
  private readonly compress: Compressor;
  private readonly outbox: Outbox<ChunkItem, string>;

  constructor(opts: BatchOptions) {
    this.url = opts.url;
    this.header = opts.header;
    this.nextSeq = opts.nextSeq;
    this.sink = opts.sink ?? defaultSink;
    this.compress = opts.compress ?? gzipJson;
    this.outbox = createOutbox<ChunkItem>({
      maxItems: REPLAY_LIMITS.maxEventsPerChunk,
      maxWaitMs: REPLAY_LIMITS.flushMs,
      send: (_lane, items, ctx) => this.sendItems(items, ctx.final),
    });
  }

  pushEvent(event: unknown): void {
    this.outbox.enqueue(VISIT_LANE, { event });
  }

  addMark(mark: ReplayMark): void {
    this.outbox.enqueue(VISIT_LANE, { mark });
  }

  /** Send what is queued. `final` = the page is going away. */
  flush(final: boolean): Promise<void> {
    return this.outbox.flush(VISIT_LANE, { final });
  }

  private sendItems(items: ChunkItem[], final: boolean): Promise<void> {
    const events: unknown[] = [];
    const marks: ReplayMark[] = [];
    for (const item of items) {
      if ('mark' in item) marks.push(item.mark);
      else events.push(item.event);
    }
    const header = this.header();
    const chunk: ReplayChunk = { ...header, seq: this.nextSeq(), marks };
    // Events only ever exist on a kept session; never send them otherwise.
    if (events.length > 0 && header.keep !== null) chunk.events = events;
    return this.send(chunk, final, 0);
  }

  private async send(chunk: ReplayChunk, final: boolean, attempt: number): Promise<void> {
    const parsed = parseReplayChunk(chunk);
    if (!parsed) return;
    const json = JSON.stringify(parsed);
    const gz = await this.compress(json).catch(() => null);
    const body: string | ArrayBuffer = gz ?? json;
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body).length : body.byteLength;
    if (bytes > REPLAY_LIMITS.maxChunkBytes) {
      await this.split(parsed, final, attempt);
      return;
    }
    try {
      const res = await this.sink.post(this.url, body, {
        keepalive: final && bytes <= KEEPALIVE_MAX_BYTES,
        gzip: gz !== null,
      });
      if (res.status === 413) {
        await this.split(parsed, final, attempt);
        return;
      }
      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        await this.sink.sleep(Math.max(0, res.retryAfterMs ?? 1000));
        await this.send(parsed, final, attempt + 1);
        return;
      }
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        await this.sink.sleep(Math.min(30_000, 200 * 2 ** attempt));
        await this.send(parsed, final, attempt + 1);
      }
    } catch {
      if (attempt < MAX_ATTEMPTS) {
        await this.sink.sleep(Math.min(30_000, 200 * 2 ** attempt));
        await this.send(parsed, final, attempt + 1);
      }
    }
  }

  /** Halve the events (or, with none, the marks) into two chunks; a single item too large is dropped. */
  private async split(chunk: ReplayChunk, final: boolean, attempt: number): Promise<void> {
    const events = chunk.events ?? [];
    if (events.length >= 2) {
      const mid = Math.ceil(events.length / 2);
      const left: ReplayChunk = { ...chunk, events: events.slice(0, mid), marks: [] };
      const right: ReplayChunk = { ...chunk, seq: this.nextSeq(), events: events.slice(mid) };
      await this.send(left, final, attempt);
      await this.send(right, final, attempt);
      return;
    }
    if (events.length === 0 && chunk.marks.length >= 2) {
      const mid = Math.ceil(chunk.marks.length / 2);
      await this.send({ ...chunk, marks: chunk.marks.slice(0, mid) }, final, attempt);
      await this.send({ ...chunk, seq: this.nextSeq(), marks: chunk.marks.slice(mid) }, final, attempt);
    }
  }
}
