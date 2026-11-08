import { fullBucket, takeToken, type BucketRate, type TokenBucket } from './tokenBucket';

/**
 * Per-socket frame budget. Every frame fans out to the whole room, so one flooding
 * client is an N× amplifier without it. Deep enough for a y-websocket handshake burst
 * and fast typing with a moving cursor.
 */
export const COLLAB_FRAME_RATE: BucketRate = { framesPerSecond: 60, burst: 240 };

/** Close code for a socket that exceeded its budget on a frame that may not be dropped. */
export const CLOSE_RATE_LIMITED = 1008;

/**
 * Frame budgets, in memory on purpose: unlike a session, a budget that resets on
 * hibernation is correct — the object only hibernates after going idle, and an idle
 * bucket would have refilled to full anyway.
 */
export class FrameBudgets {
  private readonly budgets = new WeakMap<object, TokenBucket>();

  /** Spend one frame from this socket's budget. */
  take(ws: object): boolean {
    const now = Date.now();
    let bucket = this.budgets.get(ws);
    if (!bucket) {
      bucket = fullBucket(COLLAB_FRAME_RATE, now);
      this.budgets.set(ws, bucket);
    }
    return takeToken(bucket, COLLAB_FRAME_RATE, now);
  }
}
