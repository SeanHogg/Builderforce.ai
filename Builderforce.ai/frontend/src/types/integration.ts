export type IntegrationStatus = 'CONNECTED' | 'PARTIAL' | 'MISSING';

export type IntegrationType =
  | 'source-control'
  | 'issue-tracker'
  | 'communication'
  | 'cicd'
  | 'monitoring'
  | 'calendar';

/** Maps integration type to human-readable labels. */
export const IntegrationTypeLabels: Record<IntegrationType, string> = {
  'source-control': 'Source Control',
  'issue-tracker': 'Issue Tracker',
  'communication': 'Communication',
  'cicd': 'CI/CD',
  'monitoring': 'Monitoring',
  'calendar': 'Calendar & PM',
};

export interface IntegrationConnection {
  id: string;
  tenantId: string;
  segmentId: string;
  name: string;
  type: IntegrationType;
  url?: string;
  status: IntegrationStatus;
  lastSync?: Date | null;
  createdAt: string;
  updatedAt: string;
  configuration: Record<string, unknown>;
}

export interface IntegrationGap {
  id: string;
  tenantId: string;
  segmentId: string;
  integrationId: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  description: string;
  recommendation: string;
  detectedAt: string;
  resolvedAt?: string | null;
}

export interface IntegrationHealth {
  id: string;
  integrationId: string;
  connection: IntegrationConnection;
  type: string;
  name: string;
  lastSync: string | null;
  status: IntegrationStatus;
  completenessScore: number;
  gaps: {
    description: string;
    recommendation: string;
    severity: string;
    category: string;
    detectedAt: string;
  }[];
  recommendations: string[];
}

export interface CompletenessScore {
  integrationId: string;
  tenantId: string;
  segmentId: string;
  totalWeightedScore: number;
  maxPossibleScore: number;
  breakdown: {
    expectedObjectsCount: number;
    expectedObjectsMatched: number;
    recencyWeight: number;
    recencyScore: number;
    criticalityWeight: number;
    criticalityScore: number;
  };
  lastCalculated: string;
}

export interface AuditSegment {
  segmentId: string;
  tenantId: string;
  name: string;
  totalIntegrations: number;
  connectedCount: number;
  partialCount: number;
  missingCount: number;
  averageScore: number;
}
