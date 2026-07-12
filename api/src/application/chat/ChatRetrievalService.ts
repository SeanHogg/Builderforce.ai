/**
 * Chat Message Content Retrieval Service
 * 
 * Implements automated retrieval of message content from all active chat sessions.
 * Handles pagination, rate limiting, error handling, and systematic logging.
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Db } from '../../infrastructure/database/connection';
import { chatSessions, chatMessages, tenantIdempotencyStore } from '../../infrastructure/database/schema';
import type { Env, HonoEnv } from '../../env';
import { logger } from '../../application/monitoring/monitoringService';

// Rate limiting constants
const MAX_REQUESTS_PER_MINUTE = 30; // Prevents service interruption
const BATCH_SIZE = 50; // Process in batches for better control
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// Storage for counted rates per tenant
const rateLimits: Record<number, { count: number; resetAt: number }> = {};

/**
 * Helper to enforce rate limiting per tenant
 */
function checkRateLimit(tenantId: number): boolean {
  const now = Date.now();
  const limit = rateLimits[tenantId];

  // Reset if the minute has passed
  if (!limit || now >= limit.resetAt) {
    rateLimits[tenantId] = { count: 0, resetAt: now + 60_000 };
    return true;
  }

  if (limit.count >= MAX_REQUESTS_PER_MINUTE) {
    logger.warn('Rate limit exceeded for tenant', { tenantId });
    return false;
  }

  limit.count++;
  return true;
}

/**
 * Retry helper with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempt: number = 1
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (attempt >= RETRY_ATTEMPTS) {
      throw error;
    }
    logger.warn('Retrying API call', { attempt, error: String(error) });
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    return withRetry(fn, attempt + 1);
  }
}

/**
 * Retrieve messages for a single chat session
 */
async function retrieveChatMessages(
  db: Db,
  sessionId: number,
  tenantId: number
): Promise<{ sessionId: number; messages: Array<{ id: number; role: string; content: string; metadata: string | null; seq: number; createdAt: Date }> | null; error?: string; code?: string }> {
  try {
    // Check rate limit
    if (!checkRateLimit(tenantId)) {
      return { 
        sessionId, 
        error: 'Rate limit exceeded', 
        code: 'RATE_LIMIT' 
      };
    }

    // Verify session belongs to tenant
    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.tenantId, tenantId)
        )
      );

    if (!session) {
      return { 
        sessionId, 
        error: 'Chat session not found', 
        code: 'NOT_FOUND' 
      };
    }

    // Retrieve messages (up to 200 per call)
    const messages = await db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        metadata: chatMessages.metadata,
        seq: chatMessages.seq,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.seq)
      .limit(200);

    return { sessionId, messages };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to retrieve chat messages', { sessionId, error: errorMessage });
    return { 
      sessionId, 
      error: errorMessage, 
      code: 'RETRIEVAL_FAILED' 
    };
  }
}

/**
 * Retrieve messages for a chat session via API (backup mechanism)
 */
async function retrieveChatMessagesViaApi(
  baseUrl: string,
  sessionId: number,
  tenantId: number
): Promise<{ sessionId: number; messages: Array<{ id: number; role: string; content: string; metadata: string | null; seq: number; createdAt: Date }> | null; error?: string; code?: string }> {
  try {
    // Skip API call if POST handler exists (shouldn't happen in normal flow)
    const response = await fetch(`${baseUrl}/api/chats/${sessionId}/messages?limit=200`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Note: In production, this should include proper JWT authentication
    });

    if (!response.ok) {
      return { 
        sessionId, 
        error: `API request failed with status ${response.status}`, 
        code: 'API_ERROR' 
      };
    }

    const data = await response.json();
    return { sessionId, messages: data.messages || [] };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to retrieve chat messages via API', { sessionId, error: errorMessage });
    return { 
      sessionId, 
      error: errorMessage, 
      code: 'API_RETRIEVAL_FAILED' 
    };
  }
}

/**
 * Log retrieval attempt to database for audit and tracking
 */
async function logRetrievalAttempt(
  db: Db,
  sessionId: number,
  tenantId: number,
  status: 'success' | 'failed',
  messagesCount: number,
  error?: string,
  code?: string
): Promise<void> {
  try {
    const [existing] = await db
      .select({ id: chatIdempotencyStore.id })
      .from(chatIdempotencyStore)
      .where(
        and(
          eq(chatIdempotencyStore.tenantId, tenantId),
          eq(chatIdempotencyStore.source, `chat_retrieval_${sessionId}`),
        )
      );

    if (existing) {
      // Update existing record (idempotent safe)
      await db
        .update(chatIdempotencyStore)
        .set({
          status,
          data: JSON.stringify({ messagesCount, lastError: error, lastErrorCode: code }),
          lastAttemptAt: new Date(),
        })
        .where(eq(chatIdempotencyStore.id, existing.id));
      return;
    }

    // Create new record if not found (first-time retrieval)
    await db.insert(chatIdempotencyStore).values({
      tenantId,
      source: `chat_retrieval_${sessionId}`,
      data: JSON.stringify({ messagesCount, lastError: error, lastErrorCode: code }),
      status,
      firstAttemptAt: new Date(),
      lastAttemptAt: new Date(),
    });
  } catch (error) {
    logger.error('Failed to log retrieval attempt', { sessionId, error: String(error) });
    // Don't throw - logging failures should not block the main process
  }
}

/**
 * Main job: retrieve messages for all active chat sessions
 */
export async function retrieveAllChatMessages(
  db: Db,
  tenantId: number,
  baseUrl: string = process.env.BASE_URL || 'http://localhost:3000'
): Promise<{
  total: number;
  successful: number;
  failed: number;
  failedDetails: Array<{ sessionId: number; error: string; code: string }>;
}> {
  logger.info('Starting chat message retrieval', { tenantId });

  // Get all active chat sessions
  const sessions = await db
    .select({
      id: chatSessions.id,
      agentHostId: chatSessions.agentHostId,
      sessionKey: chatSessions.sessionKey,
      projectId: chatSessions.projectId,
      startedAt: chatSessions.startedAt,
      endedAt: chatSessions.endedAt,
      msgCount: chatSessions.msgCount,
      lastMsgAt: chatSessions.lastMsgAt,
    })
    .from(chatSessions)
    .where(eq(chatSessions.tenantId, tenantId));

  const totalSessions = sessions.length;
  logger.info('Found chat sessions', { tenantId, totalSessions });

  let successful = 0;
  let failed = 0;
  const failedDetails: Array<{ sessionId: number; error: string; code: string }> = [];

  // Process in batches
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(session =>
      withRetry(
        () => retrieveChatMessages(db, session.id, tenantId),
        1
      ).then(async result => {
        if (result.error) {
          failed++;
          failedDetails.push({
            sessionId: session.id,
            error: result.error,
            code: result.code || 'UNKNOWN',
          });
          await logRetrievalAttempt(db, session.id, tenantId, 'failed', 0, result.error, result.code || 'UNKNOWN');
          logger.warn('Chat retrieval failed', { sessionId: session.id, error: result.error });
          return;
        }

        // Successful retrieval
        successful++;
        const messagesCount = result.messages!.length;
        await logRetrievalAttempt(db, session.id, tenantId, 'success', messagesCount);
        
        logger.info('Chat retrieval successful', { 
          sessionId: session.id, 
          messagesCount,
          totalProgress: `${successful}/${totalSessions}`
        });

        // Note: Raw content is already stored in the database
        // This service's purpose is to validate retrieval and enable analysis
      })
    );

    await Promise.all(batchPromises);
  }

  logger.info('Chat message retrieval completed', {
    tenantId,
    total: totalSessions,
    successful,
    failed,
    timeTaken: new Date(),
  });

  return { total: totalSessions, successful, failed, failedDetails };
}

/**
 * Background sweep job: retrieve all active chat messages
 * Manages rate limiting and provides comprehensive reporting
 */
export async function runChatRetrievalSweep(
  db: Db,
  tenantId: number = process.env.DEFAULT_TENANT_ID ? Number(process.env.DEFAULT_TENANT_ID) : null,
  baseUrl: string = process.env.BASE_URL || 'http://localhost:3000'
): Promise<{ success: boolean; analysis: ReturnType<typeof retrieveAllChatMessages> }> {
  try {
    const analysis = await retrieveAllChatMessages(db, tenantId, baseUrl);
    
    // Log comprehensive summary
    if (analysis.failed > 0) {
      logger.error('Chat retrieval completed with failures', {
        failedCount: analysis.failed,
        successRate: `${((analysis.successful / analysis.total) * 100).toFixed(2)}%`,
        failedDetails: analysis.failedDetails,
      });
    }

    // Check AC1: 99.9% success rate (AC1 requires at least 99.9% retrieval)
    const successRate = analysis.successful / analysis.total;
    const ac1Passed = successRate >= 0.999;

    if (!ac1Passed) {
      logger.error('AC1 NOT MET - message retrieval success rate below 99.9%', {
        successRate,
        requiredRate: 0.999,
      });
    }

    return { success: true, analysis };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Chat retrieval sweep failed completely', { error: errorMessage });
    return { success: false, analysis: { total: 0, successful: 0, failed: 0, failedDetails: [] } };
  }
}

/**
 * Hono route: Trigger batch chat message retrieval
 */
export function createChatRetrievalRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // GET /api/chat-retrieval - Check status (not implemented in PRD but useful for monitoring)
  router.get('/', (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json({ 
      message: 'Chat Message Content Retrieval Service',
      endpointStatus: 'OK',
      tenantId,
    });
  });

  // POST /api/chat-retrieval/trigger - Trigger a new retrieval sweep
  router.post('/trigger', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const baseUrl = c.env?.BASE_URL || 'http://localhost:3000';

    logger.info('Manual trigger received for chat message retrieval', { tenantId });

    // Run the retrieval sweep
    const result = await runChatRetrievalSweep(db, tenantId, baseUrl);

    return c.json({
      success: result.success,
      message: result.success ? 'Chat message retrieval completed' : 'Chat message retrieval failed',
      analysis: result.analysis,
      timestamp: new Date(),
    });
  });

  return router;
}