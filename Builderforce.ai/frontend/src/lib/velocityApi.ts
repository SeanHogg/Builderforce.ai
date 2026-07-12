import type {
  CurrentVelocity,
  RequiredVelocity,
  VelocityGapResult,
  VelocityPoint,
  VelocityRecommendation,
  VelocityAction,
  VelocityChartSeries,
  VelocityGapContext,
} from '@/types/velocity';

/**
 * Calculate velocity gap based on project context
 */
export async function calculateVelocityGap(
  projectId: number
): Promise<VelocityGapResult> {
  // In a real implementation, this would call the backend API
  // For now, we'll simulate the calculation
  
  try {
    const response = await fetch(`/api/velocity/gap?projectId=${projectId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to calculate velocity gap: ${response.statusText}`);
    }

    const data: VelocityGapResult = await response.json();
    return data;
  } catch (error) {
    console.error('Error calculating velocity gap:', error);
    throw error;
  }
}

/**
 * Get current velocity for a project
 */
export async function getCurrentVelocity(
  projectId: number
): Promise<CurrentVelocity> {
  const response = await fetch(`/api/velocity/current?projectId=${projectId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get current velocity: ${response.statusText}`);
  }

  const data: CurrentVelocity = await response.json();
  return data;
}

/**
 * Get required velocity based on delivery deadline
 */
export async function getRequiredVelocity(
  projectId: number,
  deadline: string
): Promise<RequiredVelocity> {
  const response = await fetch(
    `/api/velocity/required?projectId=${projectId}&deadline=${deadline}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get required velocity: ${response.statusText}`);
  }

  const data: RequiredVelocity = await response.json();
  return data;
}

/**
 * Get recommendations for addressing velocity gaps
 */
export async function getVelocityRecommendations(
  gap: VelocityGapResult
): Promise<VelocityRecommendation[]> {
  const response = await fetch('/api/velocity/recommendations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ gap }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get recommendations: ${response.statusText}`);
  }

  const data: VelocityRecommendation[] = await response.json();
  return data;
}

/**
 * Generate action plan with milestones
 */
export async function generateActionPlan(
  projectId: number,
  recommendations: VelocityRecommendation[]
): Promise<VelocityAction[]> {
  const response = await fetch('/api/velocity/action-plan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId, recommendations }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate action plan: ${response.statusText}`);
  }

  const data: VelocityAction[] = await response.json();
  return data;
}

/**
 * Get velocity chart data for visualization
 */
export async function getVelocityChartData(
  projectId: number,
  timeRange?: '1sprint' | '1month' | '3months' | '6months'
): Promise<VelocityChartSeries[]> {
  const params = new URLSearchParams({
    projectId: projectId.toString(),
  });

  if (timeRange) {
    params.append('timeRange', timeRange);
  }

  const response = await fetch(`/api/velocity/charts?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get chart data: ${response.statusText}`);
  }

  const data: VelocityChartSeries[] = await response.json();
  return data;
}

/**
 * Add manual velocity adjustment note
 */
export async function addVelocityAdjustment(
  projectId: number,
  point: VelocityPoint
): Promise<void> {
  const response = await fetch(`/api/velocity/adjustments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId, point }),
  });

  if (!response.ok) {
    throw new Error(`Failed to add velocity adjustment: ${response.statusText}`);
  }
}

/**
 * Get velocity gap context for full analysis
 */
export async function getVelocityGapContext(
  projectId: number
): Promise<VelocityGapContext> {
  const response = await fetch(`/api/velocity/context?projectId=${projectId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get context: ${response.statusText}`);
  }

  const data: VelocityGapContext = await response.json();
  return data;
}