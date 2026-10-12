/**
 * Chunk flush — 5 s wait, keepalive on hide, retry/backoff, 413 split, 429 Retry-After.
 *
 * Queueing is the shared write outbox (`@builderforce/write-outbox`): events and marks
 * enter ONE ordered lane, a chunk leaves at `maxEventsPerChunk` items or
 * `flushIntervalMs` after the first, and only one chunk is on the wire at a time — so
 * chunks (and their retries) land in `seq` order. This class owns only what is
 * replay-specific: the chunk shape, its tags and the retry / split policy.
 */

import {
  parseReplayChunk,
  REPLAY_LIMITS,
  type ReplayChunk,
  type ReplayChunkEvent,
  type ReplayMark,
} from '@builderforce/interaction-contract';
import { createOutbox, type Outbox } from '@builderforce/write-outbox';

export interface BatchSink {
  post(url: string, body: string, keepalive: boolean): Promise<{ status: number; retryAfterMs?: number }>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const defaultSink: BatchSink = {
  async post(url, body, keepalive) {
    const res = await fetch(url, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      keepalive,
      credentials: 'omit',
    });
    const retryAfter = res.headers.get('retry-after');
    let retryAfterMs: number | undefined;
    if (retryAfter) {
      const seconds = Number(retryAfter);
      retryAfterMs = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(retryAfter) - Date.now();
    }
    return { status: res.status, retryAfterMs };
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface BatchOptions {
  url: string;
  visitId: string;
  sink?: BatchSink;
}

/** One queued entry: an event or a mark, in the order they happened. */
type ChunkItem = { event: ReplayChunkEvent } | { mark: ReplayMark };

/** The recording's one lane. */
const VISIT_LANE = 'visit';

export class ChunkBatch {
  private tags: Record<string, string> = {};
  private seq = 0;
  private readonly url: string;
  private readonly visitId: string;
  private readonly sink: BatchSink;
  private readonly outbox: Outbox<ChunkItem, string>;

  constructor(opts: BatchOptions) {
    this.url = opts.url;
    this.visitId = opts.visitId;
    this.sink = opts.sink ?? defaultSink;
    this.outbox = createOutbox<ChunkItem>({
      maxItems: REPLAY_LIMITS.maxEventsPerChunk,
      maxWaitMs: REPLAY_LIMITS.flushIntervalMs,
      send: (_lane, items, ctx) => this.sendItems(items, ctx.final),
    });
  }

  push(event: ReplayChunkEvent): void {
    this.outbox.enqueue(VISIT_LANE, { event });
  }

  addMark(mark: ReplayMark): void {
    this.outbox.enqueue(VISIT_LANE, { mark });
  }

  setTag(key: string, value: string): void {
    this.tags[key] = value;
  }

  /** Send what is queued. `keepalive` = the page is going away. */
  flush(keepalive: boolean): Promise<void> {
    return this.outbox.flush(VISIT_LANE, { final: keepalive });
  }

  private sendItems(items: ChunkItem[], keepalive: boolean): Promise<void> {
    const events: ReplayChunkEvent[] = [];
    const marks: ReplayMark[] = [];
    for (const item of items) {
      if ('event' in item) events.push(item.event);
      else marks.push(item.mark);
    }
    const seq = this.seq++;
    return this.send({ visitId: this.visitId, seq, events, marks, tags: { ...this.tags } }, keepalive, 0);
  }

  private async send(chunk: ReplayChunk, keepalive: boolean, attempt: number): Promise<void> {
    const parsed = parseReplayChunk(chunk);
    if (!parsed) return;
    let body = JSON.stringify(parsed);
    if (body.length > REPLAY_LIMITS.maxChunkBytes) {
      await this.split(parsed, keepalive, attempt);
      return;
    }
    try {
      const res = await this.sink.post(this.url, body, keepalive);
      if (res.status === 413) {
        await this.split(parsed, keepalive, attempt);
        return;
      }
      if (res.status === 429) {
        const wait = Math.max(0, res.retryAfterMs ?? 1000);
        await this.sink.sleep(wait);
        await this.send(parsed, keepalive, attempt + 1);
        return;
      }
      if (res.status >= 500 && attempt < 5) {
        await this.sink.sleep(Math.min(30_000, 200 * 2 ** attempt));
        await this.send(parsed, keepalive, attempt + 1);
      }
    } catch {
      if (attempt < 5) {
        await this.sink.sleep(Math.min(30_000, 200 * 2 ** attempt));
        await this.send(parsed, keepalive, attempt + 1);
      }
    }
  }

  private async split(chunk: ReplayChunk, keepalive: boolean, attempt: number): Promise<void> {
    if (chunk.events.length < 2) return;
    const mid = Math.ceil(chunk.events.length / 2);
    const left: ReplayChunk = {
      visitId: chunk.visitId,
      seq: chunk.seq,
      events: chunk.events.slice(0, mid),
    };
    const right: ReplayChunk = {
      visitId: chunk.visitId,
      seq: this.seq++,
      events: chunk.events.slice(mid),
      marks: chunk.marks,
      tags: chunk.tags,
    };
    await this.send(left, keepalive, attempt);
    await this.send(right, keepalive, attempt);
  }
}
