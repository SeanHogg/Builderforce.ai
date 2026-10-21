/**
 * The cloud FUNDING ORDER for one gateway request — read once, the same way, by every
 * completion surface (`/v1/chat/completions` and `/v1/messages`).
 *
 * The rule itself is `resolveFundingOrder` (`fundingOrder.ts`): the turn's explicit
 * `routingMode`, else the person's account preference (`cloudOrder`), else inferred from
 * whether a BYO provider is configured. This is only the request half — reading the
 * preference, which happens only when the turn did not choose for itself and there is a
 * person behind the call. A failed read never fails the completion: it falls back to the
 * inference (no preference) and the failure is reported.
 */
import { reportCaughtError } from '../../../application/observability/caughtErrorReporter';
import { requestDb, type RequestDbContext } from '../../../application/shared/dbHandle';
import { getAccountBrainPreferences } from '../../../application/brain/accountBrainPreferences';
import { resolveFundingOrder, type FundingOrder, type RequestedRoutingMode } from '../../../application/llm/fundingOrder';
import type { UserId } from '../../../domain/shared/types';
import type { TenantAccess } from './access';

export interface RequestFundingOrderInput {
  /** The turn's explicit `routingMode`, when the client sent a valid one. */
  requested?: RequestedRoutingMode;
  /** At least one BYO provider is configured for the tenant. */
  byoConfigured: boolean;
  /** The calling route, for the failure report. */
  source: string;
}

export async function requestFundingOrder(
  c: RequestDbContext,
  access: Pick<TenantAccess, 'tenantId' | 'userId'>,
  { requested, byoConfigured, source }: RequestFundingOrderInput,
): Promise<FundingOrder> {
  const userId = access.userId;
  // Inside the promise chain, so even a db handle that fails to build is a caught read.
  const cloudOrder = requested == null && userId
    ? await Promise.resolve()
      .then(() => getAccountBrainPreferences(c.env, requestDb(c), access.tenantId, userId as UserId))
      .then((preferences) => preferences.cloudOrder)
      .catch((error: unknown) => {
        reportCaughtError(error, { source, operation: 'readCloudOrderPreference' });
        return undefined;
      })
    : undefined;
  return resolveFundingOrder({
    ...(requested ? { requested } : {}),
    ...(cloudOrder ? { preference: cloudOrder } : {}),
    byoConfigured,
  });
}
