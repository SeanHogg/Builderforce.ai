/**
 * mock types — Freelancer earnings
 * Location: src/__mock__/api/mocks/types.ts
 * Purpose: provide TypeScript types for the Freelancer Earnings Dashboard backend mocks
 */

/**
 * Response payload for current balance endpoint (GET /api/freelancers/:freelancerId/earnings)
 */
export type FreelancerEarningsResponse = {
  freelancerId: string;
  currentBalanceCents: number;
  totalPendingCents: number;
  totalPaidCents: number;
  pendingEarningIds: string[];
  currency: string;
  lastUpdated: string; // ISO date string
};

/**
 * Payload for payout history item (GET /api/freelancers/:freelancerId/earnings-history)
 */
export type PayoutHistoryItem = {
  id: string;
  freelancerId: string;
  amountCents: number;
  status: 'paid' | 'pending';
  createdAt: string; // ISO date string
  completedAt?: string; // ISO date string, for paid items
  description: string;
  earningsHistoryId: string;
};

/**
 * Pagination metadata
 */
export type PaginationMeta = {
  total: number;
  returned: number;
};

/**
 * Response payload for withdrawal requests (GET /api/freelancers/:freelancerId/withdrawal-requests)
 */
export type WithdrawalRequest = {
  id: string;
  freelancerId: string;
  amountCents: number;
  paymentMethod:
    | 'MANUAL_WITHDRAWAL'
    | 'BANK_ACCOUNT_DEPOSIT_AUTO'
    | 'WITHDRAWAL_TO_BANK_CARD'
    | 'CRYPTO_WITHDRAWAL';
  status: 'pending' | 'approved' | 'denied';
  createdAt: string; // ISO date string
  completedAt?: string; // ISO date string
  approvedAt?: string; // ISO date string
  description?: string;
};

/**
 * In-memory DB for withdrawal requests (shared across mock endpoints)
 */
export type MockDB = {
  allWithdrawalRequests: WithdrawalRequest[];
  withdrawalRequests: (freelancerId: string, limit: number) => {
    requests: WithdrawalRequest[];
    meta: PaginationMeta;
  };
  addWithdrawalRequest: (request: WithdrawalRequest) => void;
};