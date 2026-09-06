/**
 * Discard an RFP request outright.
 *
 * A ROW delete, not a soft one: `rfp_responses.request_id` and
 * `rfp_risks.response_id` both cascade, so the responses and their register
 * entries leave with the request and nothing needs a sweep of its own. The
 * register used to carry a `clearRegisterFor` for a soft delete that was never
 * built; this is the delete that was.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { rfpRequests } from '../../infrastructure/database/schema';

export async function discardRfpRequest(db: Db, tenantId: number, id: string): Promise<boolean> {
  const deleted = await db
    .delete(rfpRequests)
    .where(and(eq(rfpRequests.id, id), eq(rfpRequests.tenantId, tenantId)))
    .returning({ id: rfpRequests.id });
  return deleted.length > 0;
}
