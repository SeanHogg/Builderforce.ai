import type { IntegrationType, IntegrationStatus } from '@/frontend/src/types/integration';

export interface AuditQueryOptions {
  tenantId: string;
  segmentId: string;
  integrationType?: IntegrationType;
  status?: IntegrationStatus;
  minScore?: number;
  maxScore?: number;
  includeGaps?: boolean;
  includeRecommendations?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
