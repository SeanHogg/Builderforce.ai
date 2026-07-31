'use client';

import { useEffect } from 'react';
import { installChunkErrorRecovery } from '@/lib/chunkErrorRecovery';

/**
 * Global island: heals chunk-load errors that surface as unhandled promise
 * rejections / window errors (Next router prefetch, event-handler imports) —
 * those never reach a React error boundary. Renders nothing.
 */
export function ChunkErrorRecovery() {
  useEffect(() => installChunkErrorRecovery(), []);
  return null;
}
