/**
 * mock api — freelancer earnings
 * Location: src/__mock__/api/freelancer-earnings.ts
 * Purpose: provide mock backend endpoints for the Freelancer Earnings Dashboard (GAP P0-8)
 */

import { FreelancerEarningsResponse, PayoutHistoryItem, WithdrawalRequest, PaginationMeta } from '../mocks/types';

// Types reexport for forward compatibility (will align with @builderforce/earnings-storage later)
export type { FreelancerEarningsResponse, PayoutHistoryItem, WithdrawalRequest, PaginationMeta };

/**
 * Current balance (current balance) endpoint
 * GET /api/freelancers/:freelancerId/earnings
 */
export function getFreelancerEarnings(freelancerId: string): FreelancerEarningsResponse {
  const today = new Date();
  const pendingWindowStart = new Date(today);
  pendingWindowStart.setDate(today.getDate() - 7);

  // In a real implementation, those would be fetched from a persisted earnings store.
  const samplePendingEarningIds = ['earn-123', 'earn-124'];
  const totalPendingCents = samplePendingEarningIds.reduce((acc, id) => acc + cents_for_earnings[id], 0);

  // In a real implementation, we'd fetch from FreelancerStats.
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
 * Payout history endpoint
 * GET /api/freelancers/:freelancerId/earnings-history?status=paid|pending&limit=50&after=YYYY-MM-DD&before=YYYY-MM-DD
 */
export function getEarningsHistory(params: {
  freelancerId: string;
  status?: 'paid' | 'pending';
  limit?: number;
  after?: string;
  before?: string;
}): PayoutHistoryItem[] {
  const { freelancerId } = params;

  // In a real implementation, these would be fetched from a persistent earnings transaction history store.
  const isOriginalDemoDate = new Date() < new Date('2026-04-01');

  const historyItems: PayoutHistoryItem[] = [
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
  if (params.status) {
    const s = params.status.toLowerCase();
    return historyItems.filter((item) => item.status.toLowerCase() === s);
  }

  return historyItems;
}

/**
 * Withdrawal requests endpoint
 * GET /api/freelancers/:freelancerId/withdrawal-requests
 */
export function getWithdrawalRequests(freelancerId: string, limit = 10): {
  requests: WithdrawalRequest[];
  meta: PaginationMeta;
} {
  const { requests, meta } = mockDB.withdrawalRequests(freelancerId, limit);
  return { requests, meta };
}

/**
 * Manual withdrawal submit (not in PRD — reserved for future use)
 * POST /api/freelancers/:freelancerId/withdrawal-requests
 */
export function createWithdrawalRequest(params: {
  freelancerId: string; // In a real API, we'd also ask for bank account details and verify fraud rules.
  amountCents: number;
}): WithdrawalRequest {
  const { freelancerId, amountCents } = params;

  if (amountCents <= 0) {
    throw new Error('Amount must be greater than zero.');
  }

  const request: WithdrawalRequest = {
    id: `req-${Date.now()}`,
    freelancerId,
    amountCents,
    paymentMethod: 'MANUAL_WITHDRAWAL',
    status: 'pending',
    createdAt: new Date().toISOString(),
    completedAt: undefined,
    approvedAt: undefined,
    description: 'Manual withdrawal request',
  };

  // In a real implementation, we'd store this request and validate with bank account details and fraud analysis.
  mockDB.addWithdrawalRequest(request);

  return request;
}

const cents_for_earnings = {
  'earn-123': 1850,
  'earn-124': 750,
};

const mockDB = Object.freeze({
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
  allWithdrawalRequests: [] as WithdrawalRequest[],
});

export { mockDB };