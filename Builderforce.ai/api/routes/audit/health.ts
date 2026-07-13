import { NextRequest, NextResponse } from 'next/server';
import { auditService } from '@/services/audit/auditService';

interface AuditHealthRequest {
  segmentId: string;
  integrationType?: string;
  status?: 'CONNECTED' | 'PARTIAL' | 'MISSING';
  minScore?: number;
  maxScore?: number;
  includeGaps?: boolean;
  includeRecommendations?: boolean;
  sortBy?: 'lastSync' | 'completenessScore' | 'status';
  sortOrder?: 'asc' | 'desc';
}

/**
 * GET /api/v1/audit/health
 *
 * Returns a filtered/sorted list of integration health summaries.
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const segmentId = searchParams.get('segmentId');

    if (!segmentId) {
      return NextResponse.json(
        { error: 'segmentId is required' },
        { status: 400 }
      );
    }

    const request: AuditHealthRequest = {
      segmentId,
      integrationType: searchParams.get('integrationType') || undefined,
      status: (searchParams.get('status') as any) || undefined,
      minScore: searchParams.get('minScore')
        ? parseInt(searchParams.get('minScore')!, 10)
        : undefined,
      maxScore: searchParams.get('maxScore')
        ? parseInt(searchParams.get('maxScore')!, 10)
        : undefined,
      includeGaps: searchParams.get('includeGaps') === 'true',
      includeRecommendations: searchParams.get('includeRecommendations') === 'true',
      sortBy: (searchParams.get('sortBy') as any) || undefined,
      sortOrder: (searchParams.get('sortOrder') as any) || undefined,
    };

    const healthData = await auditService.getHealthSummary(request);

    return NextResponse.json(healthData, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch audit data:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}