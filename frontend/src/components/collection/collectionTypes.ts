import type React from 'react';

/**
 * Collection types — the shared Page/Bulk contract of PRD 47 §3.3.
 *
 * These mirror `packages/interaction-contract/src/api/collection.ts` exactly.
 * That package is NOT yet a dependency of this app (the W0 interaction-contract
 * slice lands in parallel), so this file is a LOCAL mirror. Replace this file
 * with `import … from '@builderforce/interaction-contract'` once the parallel
 * work has landed and the dependency is wired into package.json. Until then the
 * two copies must stay byte-identical with the PRD §3.3 block.
 */

export const PAGE_SIZES = [50, 100, 250] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const BULK_MAX = 1000;
export const DEFAULT_PAGE_SIZE: PageSize = 50;

export interface PageQuery {
  page: number;
  pageSize: PageSize;
  sort: string;
  dir: 'asc' | 'desc';
  archived: 'exclude' | 'only' | 'all';
  q?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: 'asc' | 'desc';
}

export type BulkAction = 'delete' | 'archive' | 'restore' | 'merge';

export interface BulkRequest {
  action: BulkAction;
  ids: string[];
  targetId?: string;
  dryRun?: boolean;
}

export type BulkSkipReason = 'not_found' | 'forbidden' | 'builtin' | 'conflict' | 'already';

export interface BulkResult {
  action: BulkAction;
  succeeded: string[];
  skipped: { id: string; reason: BulkSkipReason }[];
  preview?: Record<string, number>;
}
