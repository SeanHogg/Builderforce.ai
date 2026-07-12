import { Context } from '@netlify/functions/src/context';
import { jsonResponse } from '../../../utils/api';

/**
 * GET /api/velocity/gap
 * Calculate the velocity gap between current and required velocity
 */
export async function handler(
  request: Request,
  context: Context
): Promise<Response> {
  const url = new URL(request.url);
  const projectId = parseInt(url.searchParams.get('projectId') || '0', 10);

  if (!projectId) {
    return jsonResponse(
      { error: 'Project ID is required' },
      400
    );
  }

  try {
    // Get required velocity from project configuration
    const projectSchema = await getProjectSchema(projectId);
    
    // Calculate current velocity from sprint history
    const currentVelocity = await calculateCurrentVelocity(projectId);
    
    // Calculate required velocity based on deadline
    const requiredVelocity = calculateRequiredVelocity(projectSchema.deadline);
    
    // Compute the gap
    const gap = requiredVelocity.value - currentVelocity.value;
    
    // Determine if team is ahead or behind
    const isAhead = gap <= 0;
    
    // Calculate percentage
    const percentage = isAhead ? 0 : Math.abs((gap / requiredVelocity.value) * 100);
    
    // Generate explanation
    const explanation = generateGapExplanation(currentVelocity, requiredVelocity, gap);
    
    // Determine severity
    const severity = calculateSeverity(percentage);
    
    const result = {
      gap,
      percentage: Math.abs(percentage),
      isAhead,
      explanation,
      severity,
    };

    return jsonResponse(result, 200);

  } catch (error) {
    console.error('Error calculating velocity gap:', error);
    return jsonResponse(
      { error: 'Failed to calculate velocity gap' },
      500
    );
  }
}

/**
 * Example implementation - replace with actual DB queries
 */
async function getProjectSchema(projectId: number) {
  // TODO: Fetch project deadline and velocity config from database
  // Example:
  return {
    id: projectId,
    name: 'Project Demo',
    deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days from now
    plannedVelocity: 20, // Story points per sprint
  };
}

/**
 * Calculate current team velocity from completed sprints
 */
async function calculateCurrentVelocity(projectId: number): Promise<{ value: number; unit: 'points' }> {
  // TODO: Query actual sprint completion data from database
  // For example, average of last 3 sprints
  return {
    value: 15,
    unit: 'points',
  };
}

/**
 * Calculate required velocity based on deadline
 */
function calculateRequiredVelocity(deadline: string): { value: number; unit: 'points' } {
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const remainingDays = Math.max(1, Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  
  // Assume 2 sprints per month
  const sprintsRemaining = Math.ceil(remainingDays / 15);
  
  // Default required velocity (configurable per project)
  const plannedVelocity = 20;
  
  return {
    value: plannedVelocity,
    unit: 'points',
  };
}

/**
 * Generate human-readable explanation for the gap
 */
function generateGapExplanation(
  current: { value: number },
  required: { value: number },
  gap: number
): string {
  const gapPercentage = Math.abs((gap / required.value) * 100);
  
  if (gapPercentage <= 5) {
    return `The team is performing at ${current.value} points per sprint, which is very close to the required ${required.value} points. A ${gapPercentage.toFixed(1)}% variation is within normal estimation tolerance.`;
  }
  
  if (gapPercentage <= 15) {
    return `The team's current velocity of ${current.value} points per sprint is about ${gapPercentage.toFixed(1)}% below the required ${required.value} points. Consider examining recent story completions for blockers.`;
  }
  
  if (gapPercentage <= 30) {
    return `The team's current velocity of ${current.value} points per sprint is ${gapPercentage.toFixed(1)}% below the required ${required.value} points. This gap may risk missing the ${required.deadline} deadline without intervention.`;
  }
  
  return `The team's current velocity of ${current.value} points per sprint is ${gapPercentage.toFixed(1)}% below the required ${required.value} points. This significant gap requires immediate attention to the ${required.deadline} deadline.`;
}

/**
 * Calculate severity based on gap percentage
 */
function calculateSeverity(percentage: number): 'critical' | 'high' | 'medium' | 'low' {
  if (percentage >= 30) return 'critical';
  if (percentage >= 15) return 'high';
  if (percentage >= 5) return 'medium';
  return 'low';
}