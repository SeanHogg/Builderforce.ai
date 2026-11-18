import { BUFFER_USAGE } from "./device";

/**
 * Pooled GPU storage. Buffers are bucketed by power-of-two size class and
 * reused on release instead of destroyed, so a training step allocates
 * nothing once the pool is warm.
 *
 * Reuse is safe without fences because the backend submits every op on the
 * one queue: a later `writeBuffer` or dispatch into a recycled buffer is queue-
 * ordered after every earlier command that read it.
 *
 * `maxBytes` is the VRAM budget: an acquire that would take live storage past
 * it first trims the idle pool, then throws `VramBudgetError`.
 * `maxPooledBytes` is the idle high-water mark: a release that takes the pool
 * past it trims the largest idle buffers back down, so the pool shrinks after
 * a peak instead of holding it forever.
 */

const STORAGE_USAGE = BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.COPY_DST;
const MIN_CLASS = 16;
/** Idle bytes the pool keeps before trimming (largest classes first). */
export const DEFAULT_MAX_POOLED_BYTES = 256 * 1024 * 1024;

export class VramBudgetError extends Error {
  constructor(requested: number, live: number, max: number) {
    super(`VRAM budget exceeded: ${requested} B requested with ${live} B live (budget ${max} B)`);
    this.name = "VramBudgetError";
  }
}

export interface PoolStats {
  liveBytes: number;
  pooledBytes: number;
  peakLiveBytes: number;
  buffersCreated: number;
}

export function sizeClass(bytes: number): number {
  let c = MIN_CLASS;
  while (c < bytes) c *= 2;
  return c;
}

export class BufferPool {
  private readonly free = new Map<number, GPUBuffer[]>();
  private liveBytes = 0;
  private pooledBytes = 0;
  private peakLiveBytes = 0;
  private buffersCreated = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly maxBytes = Number.POSITIVE_INFINITY,
    private readonly maxPooledBytes = DEFAULT_MAX_POOLED_BYTES,
  ) {}

  acquire(bytes: number): GPUBuffer {
    const size = sizeClass(Math.max(bytes, 4));
    const bucket = this.free.get(size);
    const reused = bucket?.pop();
    if (reused) {
      this.pooledBytes -= size;
      this.track(size);
      return reused;
    }
    if (this.liveBytes + this.pooledBytes + size > this.maxBytes) this.trim();
    if (this.liveBytes + size > this.maxBytes) throw new VramBudgetError(size, this.liveBytes, this.maxBytes);
    const buffer = this.device.createBuffer({ size, usage: STORAGE_USAGE });
    this.buffersCreated += 1;
    this.track(size);
    return buffer;
  }

  release(buffer: GPUBuffer): void {
    const size = buffer.size;
    this.liveBytes -= size;
    this.pooledBytes += size;
    const bucket = this.free.get(size);
    if (bucket) bucket.push(buffer);
    else this.free.set(size, [buffer]);
    if (this.pooledBytes > this.maxPooledBytes) this.trimTo(this.maxPooledBytes);
  }

  /** Destroy every idle buffer. */
  trim(): void {
    this.trimTo(0);
  }

  /**
   * High-water policy: destroy idle buffers, largest size class first, until
   * at most `cap` bytes stay pooled. Large one-off allocations go first; the
   * small classes a training step churns through stay warm.
   */
  trimTo(cap: number): void {
    const classes = [...this.free.keys()].sort((a, b) => b - a);
    for (const size of classes) {
      const bucket = this.free.get(size)!;
      while (bucket.length > 0 && this.pooledBytes > cap) {
        bucket.pop()!.destroy();
        this.pooledBytes -= size;
      }
      if (bucket.length === 0) this.free.delete(size);
      if (this.pooledBytes <= cap) return;
    }
  }

  stats(): PoolStats {
    return {
      liveBytes: this.liveBytes,
      pooledBytes: this.pooledBytes,
      peakLiveBytes: this.peakLiveBytes,
      buffersCreated: this.buffersCreated,
    };
  }

  private track(size: number): void {
    this.liveBytes += size;
    this.peakLiveBytes = Math.max(this.peakLiveBytes, this.liveBytes);
  }
}
