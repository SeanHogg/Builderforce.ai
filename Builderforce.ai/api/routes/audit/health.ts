import type { NextApiRequest, NextApiResponse } from 'next';
import type {
  IntegrationStatus,
  IntegrationType,
  IntegrationHealth,
} from '@/frontend/src/types/integration';
import { auditService } from '@/services/audit/auditService';

interface IntegrationHealthResponse {
  data?: IntegrationHealth[];
  error?: string;
  metadata?: {
    total: number;
    filtered: number;
    query: Record<string, unknown>;
  };
}

interface ValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * GET /api/v1/audit/health
 * Returns an integration health summary for a tenant segment.
 *
 * Query parameters:
 * - tenantId (string, REQUIRED): The tenant performing the audit.
 * - segmentId (string, required): The segment (e.g. project) to audit.
 * - integrationType (IntegrationType, optional): Filter by integration type.
 * - status (IntegrationStatus, optional): Filter by integration status.
 * - minScore (number, optional): Minimum completeness score filter.
 * - maxScore (number, optional): Maximum completeness score filter.
 * - includeGaps (boolean, default true): Include gap detail in the response.
 * - includeRecommendations (boolean, default true): Include recommendations.
 * - sortBy (string, default "completenessScore"): Sort column.
 * - sortOrder (string, default "asc"): Sort order.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<IntegrationHealthResponse>
) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      tenantId,
      segmentId,
      integrationType,
      status,
      minScore,
      maxScore,
      includeGaps: includeGapsRaw,
      includeRecommendations: includeRecommendationsRaw,
      sortBy = 'completenessScore',
      sortOrder = 'asc',
    } = req.query as Record<string, string>;

    // Validate tenantId
    const validationErrors: ValidationError[] = [];

    if (!tenantId || tenantId.length === 0) {
      validationErrors.push({
        field: 'tenantId',
        message: 'tenantId is required for audit queries',
        code: 'REQUIRED_FIELD_MISSING',
      });
    }

    if (!segmentId || segmentId.length === 0) {
      validationErrors.push({
        field: 'segmentId',
        message: 'segmentId is required for scoped audit queries',
        code: 'REQUIRED_FIELD_MISSING',
      });
    }

    // Validate integration type
    const validIntegrationTypes = [
      'source-control',
      'issue-tracker',
      'communication',
      'cicd',
      'monitoring',
      'calendar',
    ];

    if (
      integrationType &&
      !validIntegrationTypes.includes(integrationType)
    ) {
      validationErrors.push({
        field: 'integrationType',
        message: `Invalid integration type. Must be one of: ${validIntegrationTypes.join(', ')}`,
        code: 'INVALID_INTEGRATION_TYPE',
      });
    }

    // Validate status
    const validStatuses: IntegrationStatus[] = [
      'CONNECTED',
      'PARTIAL',
      'MISSING',
    ];
    if (status && !validStatuses.includes(status as IntegrationStatus)) {
      validationErrors.push({
        field: 'status',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        code: 'INVALID_STATUS',
      });
    }

    // Validate sortBy
    const validSortFields = [
      'completenessScore',
      'lastSync',
      'status',
      'integrationType',
    ];
    if (!validSortFields.includes(sortBy)) {
      validationErrors.push({
        field: 'sortBy',
        message: `Invalid sort field. Must be one of: ${validSortFields.join(', ')}`,
        code: 'INVALID_SORT_FIELD',
      });
    }

    // Validate sortOrder
    if (sortOrder && !['asc', 'desc'].includes(sortOrder)) {
      validationErrors.push({
        field: 'sortOrder',
        message: 'sortOrder must be "asc" or "desc"',
        code: 'INVALID_SORT_ORDER',
      });
    }

    // Validate numeric filters
    if (minScore && (Number(minScore) < 0 || Number(minScore) > 100)) {
      validationErrors.push({
        field: 'minScore',
        message: 'minScore must be between 0 and 100',
        code: 'INVALID_SCORE_RANGE',
      });
    }

    if (maxScore && (Number(maxScore) < 0 || Number(maxScore) > 100)) {
      validationErrors.push({
        field: 'maxScore',
        message: 'maxScore must be between 0 and 100',
        code: 'INVALID_SCORE_RANGE',
      });
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        metadata: {
          total: validationErrors.length,
          filtered: validationErrors.length,
          query: { validationErrors },
        },
      } as IntegrationHealthResponse);
    }

    // Perform audit
    const healthData = await auditService.getHealthSummary({
      tenantId,
      segmentId,
      integrationType: integrationType as IntegrationType,
      status: status as IntegrationStatus,
      minScore: minScore ? Number(minScore) : undefined,
      maxScore: maxScore ? Number(maxScore) : undefined,
      includeGaps: includeGapsRaw !== 'false',
      includeRecommendations: includeRecommendationsRaw !== 'false',
      sortBy,
      sortOrder: sortOrder as 'asc' | 'desc',
    });

    return res.status(200).json({
      data: healthData,
      metadata: {
        total: healthData.length,
        filtered: healthData.length,
        query: { tenantId, segmentId, integrationType, status, minScore, maxScore },
      },
    });
  } catch (error) {
    console.error('[AuditHealth] Failed to retrieve integration health:', error);
    return res.status(500).json({
      error: 'Internal server error while fetching integration health',
      metadata: {
        total: 0,
        filtered: 0,
        query: { error: error instanceof Error ? error.message : 'Unknown error' },
      },
    });
  }
}
