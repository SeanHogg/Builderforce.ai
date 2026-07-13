/* Separator: AuditQueryOptions DTO for /api/v1/audit/health */

/* Nominal outline; full implementation deferred to backend. */
export interface AuditQueryOptions {
  tenantId: string;
  segmentId: string;
  integrationType?: string; // optional filter on IntegrationType
  status?: string; // optional filter on IntegrationStatus; supported values: 'CONNECTED'|'PARTIAL'|'MISSING'
  minScore?: number; // filter >= minScore (0-100)
  maxScore?: number; // filter <= maxScore (0-100)
  includeGaps: boolean; // requested inclusion of gap arrays in each entry
  includeRecommendations: boolean; // requested inclusion of recommendation arrays in each entry
  sortBy?: 'lastSync' | 'completenessScore' | 'status'; // sort field
  sortOrder?: 'asc' | 'desc'; // sort direction
}