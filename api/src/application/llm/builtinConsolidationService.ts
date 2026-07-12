// builtinConsolidationService.ts
// Chat consolidation: assign IDs, validate ownership, and merge sub-threads into a target chat.

import { eq, and, sql } from 'drizzle-orm';
import type { Context } from '../jlora/context.js';
import { db, schema } from '@/infrastructure/database/integration.js';
import { resolveSegment } from '@/application/core/segmentService.js';
import { postChatMessage } from './ToolServices.js';

// ============================================================================
// Types
// ============================================================================

export interface ConsolidationParams {
  targetChatId: string;
  sourceChatIds: string[];
}

export interface ConsolidationError {
  message: string;
  details?: Record<string, unknown>;
}

export interface ConsolidationResult {
  success: boolean;
  message?: string;
  targetChatId: string;
  sourceChatIdsConsolidated: string[];
  linksCreated: number;
  linkIds: number[];
  errors?: ConsolidationError[];
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Resolve the segment for consolidation (tenant-scoped only).
 */
async function resolveSegmentForConsolidation(db: any, tenantId: number) {
  const segment = await resolveSegment(db, tenantId);
  if (!segment) throw new Error('Segment not found');
  return segment;
}

/**
 * Check if the user has ownership of the target chat.
 */
async function hasTargetOwnership(
  db: any,
  userId: string,
  tenantId: number,
  chatId: number
): Promise<boolean> {
  const chat = await db
    .select()
    .from(schema.brainChats)
    .where(
      and(
        eq(schema.brainChats.tenantId, tenantId),
        eq(schema.brainChats.id, chatId)
      )
    )
    .limit(1);
  return chat.length > 0 && chat[0].userId === userId;
}

/**
 * Check if the user is a member (owner or member) of each source chat.
 */
async function canAccessAllSourceChats(
  db: any,
  userId: string,
  tenantId: number,
  sourceChatIds: string[]
): Promise<{ valid: boolean; errors: ConsolidationError[]; validIds: number[] }> {
  const errors: ConsolidationError[] = [];
  const invalidIds: string[] = [];
  const validIds: number[] = [];

  const results = await db
    .select({
      id: schema.brainChats.id,
      userId: schema.brainChats.userId,
    })
    .from(schema.brainChats)
    .where(
      and(
        eq(schema.brainChats.tenantId, tenantId),
        sql`${schema.brainChats.id} = ANY(${sourceChatIds.map(Number)})`
      )
    );

  for (const row of results) {
    if (row.userId === userId) {
      validIds.push(row.id);
    } else {
      invalidIds.push(String(row.id));
      errors.push({
        message: `User does not have access to source chat ${row.id}.`,
        details: { chatId: row.id, ownedBy: row.userId },
      });
    }
  }

  if (sourceChatIds.length !== validIds.length) {
    return { valid: false, errors, validIds };
  }

  return { valid: true, errors: [], validIds };
}

/**
 * Detect and prevent duplicate consolidation.
 */
async function checkForDuplicateConsolidation(
  db: any,
  targetChatId: number,
  sourceChatIds: number[]
): Promise<{ hasDuplicates: boolean; existingLinks?: Array<{ sourceChatId: number; linkId: number } }> {
  const links = await db
    .select({
      sourceChatId: schema.chatConsolidationLinks.sourceChatId,
      id: schema.chatConsolidationLinks.id,
    })
    .from(schema.chatConsolidationLinks)
    .where(
      and(
        eq(schema.chatConsolidationLinks.consolidatedChatId, targetChatId),
        sql`${schema.chatConsolidationLinks.sourceChatId} = ANY(${sourceChatIds})`
      )
    );

  if (links.length > 0) {
    return { hasDuplicates: true, existingLinks: links };
  }

  return { hasDuplicates: false };
}

/**
 * Fetch last message order of each source chat to preserve chronological boundary.
 */
async function getLastMessageOrders(
  db: any,
  chatIds: number[]
): Promise<Map<number, number>> {
  const results = await db
    .select({
      chatId: schema.brainChatMessages.chatId,
      order: schema.brainChatMessages.order,
    })
    .from(schema.brainChatMessages)
    .where(
      sql`${schema.brainChatMessages.chatId} = ANY(${chatIds})`
    );

  const orders = new Map<number, number>();
  for (const row of results) {
    if (row.order !== null) {
      orders.set(row.chatId, row.order);
    }
  }
  return orders;
}

/**
 * Retrieve the excerpt and timestamp for the last contiguous segment from each source.
 * Returns the rightmost timestamp (or fallback) per chat.
 */
async function getLastMessageExcerpts(
  db: any,
  chatIds: number[]
): Promise<Map<number, string | Date>> {
  const results = await db
    .select({
      chatId: schema.brainChatMessages.chatId,
      message: schema.brainChatMessages.message,
      updatedAt: schema.brainChatMessages.updatedAt,
      createdAt: schema.brainChatMessages.createdAt,
    })
    .from(schema.brainChatMessages)
    .where(
      sql`${schema.brainChatMessages.chatId} = ANY(${chatIds})`
    )
    .orderBy(sql`MAX(${schema.brainChatMessages.order}) DESC, ${schema.brainChatMessages.updatedAt} DESC`)
    .limit(chatIds.length);

  const excerpts = new Map<number, string | Date>();
  for (const row of results) {
    // Use first non-null order fallback; prioritize updatedAt; treat empty messages as fallback.
    excerpts.set(row.chatId, row.updatedAt || row.createdAt || '');
  }
  return excerpts;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * consolidateSubThreads(...): assign IDs, validate ownership, and merge sub-threads into target
 */
export async function consolidateSubThreads(
  ctx: Context,
  params: ConsolidationParams,
  segment?: { id: string }
): Promise<ConsolidationResult> {
  const { targetChatId, sourceChatIds } = params;

  // Resolve keys (mcpId, userId, segment)
  const unresolvedKeys: ConsolidationError[] = [];
  const resolved = {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    segmentId: segment?.id || (await resolveSegmentForConsolidation(ctx.db, ctx.tenantId)).id,
  };

  if (!resolved.userId) {
    unresolvedKeys.push({
      message: 'User authentication required',
      details: { token: 'userId' },
    });
    return {
      success: false,
      message: 'Failed: requires authenticated user',
      targetChatId,
      sourceChatIdsConsolidated: [],
      linksCreated: 0,
      linkIds: [],
      errors: unresolvedKeys,
    };
  }

  const targetId = Number(targetChatId);
  if (isNaN(targetId)) {
    unresolvedKeys.push({
      message: 'Invalid targetChatId; must be numeric and present',
      details: { targetChatId },
    });
  }

  const resolvedSourceIds = sourceChatIds.filter(id => !isNaN(Number(id))).map(Number);
  if (resolvedSourceIds.length === 0) {
    unresolvedKeys.push({
      message: 'No valid source chat IDs',
      details: { sourceChatIds },
    });
  }

  if (unresolvedKeys.length > 0) {
    return {
      success: false,
      message: validationErrorMessage(unresolvedKeys),
      targetChatId,
      sourceChatIdsConsolidated: [],
      linksCreated: 0,
      linkIds: [],
      errors: unresolvedKeys,
    };
  }

  // Ownership validation
  const targetOwned = await hasTargetOwnership(ctx.db, resolved.userId, resolved.tenantId, targetId);
  if (!targetOwned) {
    const ownershipError: ConsolidationError = {
      message: 'User is not the owner of the target chat.',
      details: { targetChatId, userId: resolved.userId },
    };
    unresolvedKeys.push(ownershipError);
    return {
      success: false,
      message: validationErrorMessage(unresolvedKeys),
      targetChatId,
      sourceChatIdsConsolidated: [],
      linksCreated: 0,
      linkIds: [],
      errors: unresolvedKeys,
    };
  }

  // Access validation across all source chats
  const sources = await canAccessAllSourceChats(
    ctx.db,
    resolved.userId,
    resolved.tenantId,
    sourceChatIds
  );
  if (!sources.valid) {
    return {
      success: false,
      message: validationErrorMessage(sources.errors),
      targetChatId,
      sourceChatIdsConsolidated: sources.validIds.map(String),
      linksCreated: 0,
      linkIds: [],
      errors: sources.errors,
    };
  }

  // Fetch last message order per chat to preserve order
  const messageOrders = await getLastMessageOrders(ctx.db, sources.validIds);

  // Check for duplicates and retrieve existing link ids
  const dupCheck = await checkForDuplicateConsolidation(ctx.db, targetId, sources.validIds);
  if (dupCheck.hasDuplicates) {
    const duplicationError: ConsolidationError = {
      message: `One or more source chats are already linked to the target. Duplicates: ${dupCheck.existingLinks!.map(l => String(l.sourceChatId)).join(', ')}`,
      details: { existingLinks: dupCheck.existingLinks!.map(l => ({ sourceChatId: l.sourceChatId, linkId: l.id })) },
    };
    unresolvedKeys.push(duplicationError);
    return {
      success: false,
      message: validationErrorMessage(unresolvedKeys),
      targetChatId,
      sourceChatIdsConsolidated: sources.validIds.map(String),
      linksCreated: 0,
      linkIds: [],
      errors: unresolvedKeys,
    };
  }

  // Phase 1: create consolidation links
  const links = await db
    .insert(schema.chatConsolidationLinks)
    .values(
      sources.validIds.map((sourceId, i) => ({
        tenantId: resolved.tenantId,
        segmentId: resolved.segmentId,
        consolidatedChatId: targetId,
        sourceChatId: sourceId,
        displayOrder: i,
        sourceSummary: '',
      }))
    )
    .returning({
      id: schema.chatConsolidationLinks.id,
      sourceChatId: schema.chatConsolidationLinks.sourceChatId,
    });

  const linkIds = [];
  for (const link of links) {
    linkIds.push(link.id);
    // Fetch last message excerpt from source to use as sourceSummary
    const excerpts = await getLastMessageExcerpts(ctx.db, [link.sourceChatId]);
    const excerpt = excerpts.get(link.sourceChatId);
    let rawSummary = (excerpt instanceof Date ? excerpt.toISOString() : String(excerpt)).substring(0, 2000);
    if (rawSummary.length === 0) {
      rawSummary = '[No messages]';
    }
    await db
      .update(schema.chatConsolidationLinks)
      .set({ sourceSummary: rawSummary, updatedAt: new Date() })
      .where(eq(schema.chatConsolidationLinks.id, link.id));
  }

  // Phase 2: mark sources as consolidated and archive original messages in order
  for (let i = 0; i < sources.validIds.length; i++) {
    const chatId = sources.validIds[i];
    const displayOrder = i;
    const lastOrder = messageOrders.get(chatId);
    const excerptTimestamp = messageOrders.get(chatId)
      ? messageOrders.get(chatId)
      : new Date();

    // Import the helper from toolServices (ensure this module exposes it)
    await postChatMessage(
      ctx.db,
      resolved.userId,
      resolved.tenantId,
      resolved.segmentId,
      targetId,
      excerptTimestamp,
      `[Consolidated from sub-thread ${displayOrder}]`,
      null,
      lastOrder // adds a freshly-generated continuation order beyond any pre-consolidated block
    );

    // Mark source chat as consolidated
    await db
      .update(schema.brainChats)
      .set({
        subThreadOfChatId: targetId,
        consolidationStatus: 'consolidated',
        consolidatedIntoChatId: targetId,
        isArchived: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.brainChats.id, chatId));
  }

  // Phase 3: update target summary with newly inserted excerpts
  const excerpts = await getLastMessageExcerpts(ctx.db, [targetId]);
  const targetSummary excerpts.get(targetId);
  let rawTargetSummary = (targetSummary instanceof Date ? targetSummary.toISOString() : String(targetSummary)).substring(0, 2000);
  if (rawTargetSummary.length === 0) {
    rawTargetSummary = '[Consolidated sub-threads]';
  }
  await db
    .update(schema.brainChats)
    .set({
      summary: rawTargetSummary,
      updatedAt: new Date(),
    })
    .where(eq(schema.brainChats.id, targetId));

  const consolidatedSourceIds = sources.validIds.map(String);
  return {
    success: true,
    message: `Consolidated ${consolidatedSourceIds.length} chat(s) into target ${targetChatId}.`,
    targetChatId: String(targetId),
    sourceChatIdsConsolidated: consolidatedSourceIds,
    linksCreated: links.length,
    linkIds: linkIds,
  };
}

interface ConsolidationErrors extends Record<string, ConsolidationError[]> {}

function validationErrorMessage(errors: ConsolidationError[], infoMsg?: string): string {
  const portal = new Set<string>();
  for (const e of errors) {
    portal.add(e.message);
  }
  return `Validation failed: ${Array.from(portal).join('; ')}`;
}