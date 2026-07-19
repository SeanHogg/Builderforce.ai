'use client';

import { knowledgeApi } from '@/lib/knowledgeApi';
import { contentStorageKey } from '@/lib/marketplaceData';

/**
 * One-time client-side migration of the retired /content-manager.
 *
 * Content blocks only ever lived in the browser (`bf-content-<tenant>` in
 * localStorage), so the move into the server-backed Knowledge subsystem must run
 * client-side: read the blocks, create a `knowledge_document` for each (publishing
 * + listing where the block was), then clear the old key so the data has exactly
 * one home. Idempotent via a per-tenant migrated flag.
 */

interface LegacyContentBlock {
  id: string;
  title: string;
  type: 'page' | 'template' | 'snippet' | string;
  status: 'draft' | 'published' | string;
  body: string;
  variant?: { id: string; label: string; body: string } | null;
  tags?: string[];
  sharedToMarketplace?: boolean;
}

const migratedKey = (tenantId: string) => `bf-content-migrated-${tenantId || 'default'}`;

/** page/snippet → reference doc; template → reusable process. */
function toDocType(type: string): 'process' | 'doc' {
  return type === 'template' ? 'process' : 'doc';
}

/** Compose the knowledge body: block body + any A/B variant appended as a section. */
function toContent(block: LegacyContentBlock): string {
  const parts = [block.body ?? ''];
  if (block.variant?.body?.trim()) {
    parts.push('', '---', '', `## Variant: ${block.variant.label || 'B'}`, '', block.variant.body);
  }
  return parts.join('\n').trim();
}

function readBlocks(tenantId: string): LegacyContentBlock[] {
  try {
    const raw = localStorage.getItem(contentStorageKey(tenantId));
    return raw ? (JSON.parse(raw) as LegacyContentBlock[]) : [];
  } catch {
    return [];
  }
}

export interface MigrationResult {
  /** Number of content blocks imported into Knowledge this run. */
  migrated: number;
  /** True if there was nothing to do (already migrated, or no blocks). */
  noop: boolean;
}

/**
 * Migrate this tenant's content blocks into Knowledge. Safe to call on every
 * visit: returns `{ noop: true }` once done. Blocks that fail to import are left
 * in place (the old key is only cleared on a fully clean run) so nothing is lost.
 */
export async function migrateContentManager(tenantId: string): Promise<MigrationResult> {
  if (typeof window === 'undefined') return { migrated: 0, noop: true };
  if (localStorage.getItem(migratedKey(tenantId))) return { migrated: 0, noop: true };

  const blocks = readBlocks(tenantId);
  if (blocks.length === 0) {
    localStorage.setItem(migratedKey(tenantId), new Date().toISOString());
    return { migrated: 0, noop: true };
  }

  let migrated = 0;
  let allOk = true;
  for (const block of blocks) {
    try {
      const doc = await knowledgeApi.create({
        title: block.title || 'Untitled',
        content: toContent(block),
        docType: toDocType(block.type),
        tags: Array.isArray(block.tags) ? block.tags : [],
      });
      if (block.status === 'published') {
        await knowledgeApi.publish(doc.id, 'Migrated from Content Manager').catch(() => {});
      }
      if (block.sharedToMarketplace) {
        await knowledgeApi.publishListing(doc.id, { visibility: 'public' }).catch(() => {});
      }
      migrated++;
    } catch {
      allOk = false;
    }
  }

  if (allOk) {
    // Everything landed in Knowledge — retire the localStorage copy so there is a
    // single source of truth (and the marketplace no longer surfaces it).
    localStorage.removeItem(contentStorageKey(tenantId));
    localStorage.setItem(migratedKey(tenantId), new Date().toISOString());
  }
  return { migrated, noop: false };
}
