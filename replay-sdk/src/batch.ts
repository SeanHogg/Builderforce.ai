/**
 * Chunk flush — 5 s timer, sendBeacon on hide, retry/backoff, 413 split, 429 Retry-After.
 */

import {
  parseReplayChunk,
  REPLAY_LIMITS,
  type ReplayChunk,
  type ReplayChunkEvent,
  type ReplayMark,
} from '@builderforce/interaction-contract';

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

export class ChunkBatch {
  private events: ReplayChunkEvent[] = [];
  private marks: ReplayMark[] = [];
  private tags: Record<string, string> = {};
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly url: string;
  private readonly visitId: string;
  private readonly sink: BatchSink;
  private inflight = false;

  constructor(opts: BatchOptions) {
    this.url = opts.url;
    this.visitId = opts.visitId;
    this.sink = opts.sink ?? defaultSink;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush(false);
    }, REPLAY_LIMITS.flushIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  push(event: ReplayChunkEvent): void {
    this.events.push(event);
    if (this.events.length >= REPLAY_LIMITS.maxEventsPerChunk) void this.flush(false);
  }

  addMark(mark: ReplayMark): void {
    this.marks.push(mark);
  }

  setTag(key: string, value: string): void {
    this.tags[key] = value;
  }

  async flush(keepalive: boolean): Promise<void> {
    if (this.inflight || (this.events.length === 0 && this.marks.length === 0)) return;
    const events = this.events.splice(0, this.events.length);
    const marks = this.marks.splice(0, this.marks.length);
    const tags = { ...this.tags };
    const seq = this.seq++;
    await this.send({ visitId: this.visitId, seq, events, marks, tags }, keepalive, 0);
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
