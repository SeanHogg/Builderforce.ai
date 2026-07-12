/**
 * Helper to export integration gaps via integrationGapsRoutes.
 *
 * This builds upon the integrationGapsRoutes helper to surface gap data under
 * the providers' APIs without duplication.
 */

import { createIntegrationGapsRoutes } from './integrationGapsRoutes';
import { db } from '../../infrastructure/database/connection';
import { encryptionSecret } from '../../env';

/**
 * Attach gap summary routes to the provider integration routes with mocked stub implementation.
 *
 * stubbed: The routes are gated and return a minimal implementation designed to be extended
 * to real gap evaluation with a scheduler and provider queries.
 */
export function createIntegrationGapsSummaryRoutes(): import('hono').Hono<'dev'> {
  const router = createIntegrationGapsRoutes(db.getDb()!, encryptionSecret);
  return router;
}