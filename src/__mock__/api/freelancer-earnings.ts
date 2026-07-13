/**
 * mock api — freelancer earnings
 * Location: src/__mock__/api/freelancer-earnings.ts
 * Purpose: provide mock backend endpoints for the Freelancer Earnings Dashboard (GAP P0-8)
 */

import { FreelancerEarningsResponse, PayoutHistoryItem, WithdrawalRequest, PaginationMeta } from './mocks/types';

// Types reexport for forward compatibility (will align with @builderforce/earnings-storage later)
export type { FreelancerEarningsResponse, PayoutHistoryItem, WithdrawalRequest, PaginationMeta };

/**
 * Current balance endpoint (FR1: earnedToDateCents, currentBalanceCents, pending/paid, pendingEarningIds)
 * GET /api/freelancers/:freelancerId/earnings
 */
export function getFreelancerEarnings(freelancerId: string): FreelancerEarningsResponse {
  const today = new Date();
  const pendingWindowStart = new Date(today);
  pendingWindowStart.setDate(today.getDate() - 7);

  // Pending earnings (for demo; in production these IDs would come from a persistent pending set).
  const samplePendingEarningIds: string[] = ['earn-123', 'earn-124'];
  const totalPendingCents = samplePendingEarningIds.reduce((acc, id) => acc + cents_for_earnings[id], 0);

  // Use earnedToDateCents from FreelancerStats; for demo we hardcode a value.
  const earnedToDateCents = 125000; // $1,250.00

  const response: FreelancerEarningsResponse = {
    freelancerId,
    currentBalanceCents: earnedToDateCents - totalPendingCents,
    totalPendingCents,
    totalPaidCents: earnedToDateCents,
    pendingEarningIds: samplePendingEarningIds,
    currency: 'USD',
    lastUpdated: today.toISOString(),
  };

  return response;
}

/**
 * Payout history endpoint (FR2 filtered by status, FR3 paginated)
 * GET /api/freelancers/:freelancerId/earnings-history?status=paid|pending&limit=50&after=YYYY-MM-DD&before=YYYY-MM-DD&[page]
 */
export function getEarningsHistory(params: {
  freelancerId: string;
  status?: 'paid' | 'pending';
  limit?: number;
  after?: string;
  before?: string;
  page?: number;
}): PayoutHistoryItem[] {
  const { freelancerId } = params;
  const limit = params.limit ?? 50;
  const page = params.page ?? 1;
  const pageSize = 10; // Fixed per-page size for demo
  const offset = (page - 1) * pageSize;
  const isOriginalDemoDate = new Date() < new Date('2026-04-01');

  const allItems: PayoutHistoryItem[] = [
    {
      id: 'hist-001',
      freelancerId,
      amountCents: 1850,
      status: 'paid',
      createdAt: new Date('2026-03-01').toISOString(),
      completedAt: new Date('2026-03-02').toISOString(),
      description: 'Freelance payment for Project Alpha',
      earningsHistoryId: 'earn-123',
    },
    {
      id: 'hist-002',
      freelancerId,
      amountCents: 750,
      status: 'paid',
      createdAt: new Date('2026-02-05').toISOString(),
      completedAt: new Date('2026-02-06').toISOString(),
      description: 'Freelance payment for Project Beta',
      earningsHistoryId: 'earn-124',
    },
  ];

  // Simple filtering (in production, we'd paginate from a database)
  // - Status filter: paid | pending
  // - Time range filters: after, before
  let filtered = allItems.filter((item) => {
    const statusOk = !params.status || item.status.toLowerCase() === params.status.toLowerCase();
    const afterOk = !params.after || new Date(item.createdAt) >= new Date(params.after);
    const beforeOk = !params.before || new Date(item.createdAt) <= new Date(params.before);
    return statusOk && afterOk && beforeOk;
  });

  // Pagination
  paginated_items = filtered.slice(offset, offset + pageSize)
  const requestedSlice = filtered.slice(offset, offset + pageSize);

  return requestedSlice;
}

/**
 * Withdrawal requests endpoint (FR4)
 * GET /api/freelancers/:freelancerId/withdrawal-requests
 */
export function getWithdrawalRequests(freelancerId: string, limit = 10): {
  requests: WithdrawalRequest[];
  meta: PaginationMeta;
} {
  const { requests, meta } = mockDB.withdrawalRequests(freelancerId, limit);
  return { requests, meta };
}

const cents_for_earnings = {
  'earn-123': 1850,
  'earn-124': 750,
};

const mockDB = Object.freeze({
  allWithdrawalRequests: [] as WithdrawalRequest[],
  withdrawalRequests: (freelancerId: string, limit: number) => {
    const requests: WithdrawalRequest[] = [
      {
        id: 'req-001',
        freelancerId,
        amountCents: 800,
        paymentMethod: 'MANUAL_WITHDRAWAL',
        status: 'pending',
        createdAt: new Date('2026-03-15').toISOString(),
        completedAt: undefined,
        approvedAt: undefined,
        description: 'Manual withdrawal request',
      },
      {
        id: 'req-002',
        freelancerId,
        amountCents: 1200,
        paymentMethod: 'MANUAL_WITHDRAWAL',
        status: 'pending',
        createdAt: new Date('2026-04-01').toISOString(),
        completedAt: undefined,
        approvedAt: undefined,
        description: 'Manual withdrawal request',
      },
    ];

    return {
      requests: requests.slice(0, limit),
      meta: {
        total: requests.length,
        returned: requests.slice(0, limit).length,
      },
    };
  },
  addWithdrawalRequest: (request: WithdrawalRequest) => {
    mockDB.allWithdrawalRequests.push(request);
  },
});

export { mockDB };