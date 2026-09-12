/**
 * A token bucket — the per-socket frame budget every relay spends.
 *
 * Pure: the caller owns where a bucket lives. {@link PeerRelay} keeps it on the peer;
 * `CollaborationRoomDO` keeps it in memory beside a hibernatable socket, which is correct
 * there because the object only hibernates after going idle, and an idle bucket would
 * have refilled to full anyway.
 */

export interface TokenBucket {
  tokens: number;
  refilledAtMs: number;
}

export interface BucketRate {
  /** Sustained frames per second. */
  framesPerSecond: number;
  /** Bucket depth, so a legitimate burst is not clipped. */
  burst: number;
}

export function fullBucket(rate: BucketRate, nowMs: number): TokenBucket {
  return { tokens: rate.burst, refilledAtMs: nowMs };
}

/** Refill by elapsed time, then take one. False when the bucket is empty. */
export function takeToken(bucket: TokenBucket, rate: BucketRate, nowMs: number): boolean {
  const elapsed = Math.max(0, nowMs - bucket.refilledAtMs);
  bucket.refilledAtMs = nowMs;
  bucket.tokens = Math.min(rate.burst, bucket.tokens + (elapsed / 1_000) * rate.framesPerSecond);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
