import { Context } from '@netlify/functions/src/context';
import { jsonResponse } from '../../../utils/api';

interface RequestBody {
  projectId: number;
  recommendations: Array<{
    id: string;
    title: string;
    estimatedImpact: number;
    priority: 'high' | 'medium' | 'low';
    actionType: string;
  }>;
}

/**
 * POST /api/velocity/action-plan
 * Generate action plan with milestones for addressing velocity gaps
 */
export async function handler(
  request: Request,
  context: Context
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed. Use POST.' },
      405
    );
  }

  try {
    const body: RequestBody = await request.json();
    const { projectId, recommendations } = body;

    const actions = generateActionPlan(projectId, recommendations);

    return jsonResponse(actions, 200);

  } catch (error) {
    console.error('Error generating action plan:', error);
    return jsonResponse(
      { error: 'Failed to generate action plan' },
      500
    );
  }
}

/**
 * Generate action plan with milestones
 */
function generateActionPlan(
  projectId: number,
  recommendations: any[]
): Array<{
  id: string;
  recommendationId: string;
  title: string;
  description: string;
  status: 'planned' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  estimatedCompletion: string;
  actualCompletion?: string;
  owner?: string;
  estimatedSprintsToComplete: number;
}> {
  const actions: Array<{
    id: string;
    recommendationId: string;
    title: string;
    description: string;
    status: 'planned' | 'in_progress' | 'completed';
    priority: 'high' | 'medium' | 'low';
    estimatedCompletion: string;
    estimatedSprintsToComplete: number;
  }> = [];

  // Group recommended actions by priority
  const highPriority = recommendations.filter((r) => r.priority === 'high');
  const mediumPriority = recommendations.filter((r) => r.priority === 'medium');

  // Create action items for high priority recommendations
  highPriority.forEach((rec, index) => {
    const estimatedSprints = Math.ceil(rec.estimatedImpact / 5);
    const completionDate = new Date();
    completionDate.setDate(
      completionDate.getDate() + (estimatedSprints * 7 * (index + 1))
    );

    actions.push({
      id: `action-${rec.id}-plan`,
      recommendationId: rec.id,
      title: `Implement: ${rec.title}`,
      description: rec.description,
      status: 'planned',
      priority: rec.priority,
      estimatedCompletion: completionDate.toISOString().split('T')[0],
      estimatedSprintsToComplete,
    });
  });

  // Create action items for medium priority recommendations
  mediumPriority.forEach((rec, index) => {
    const estimatedSprints = Math.ceil(rec.estimatedImpact / 4);
    const completionDate = new Date();
    completionDate.setDate(
      completionDate.getDate() + (estimatedSprints * 7 * (index + 1))
    );

    actions.push({
      id: `action-${rec.id}-plan`,
      recommendationId: rec.id,
      title: `Plan: ${rec.title}`,
      description: rec.description,
      status: 'planned',
      priority: rec.priority,
      estimatedCompletion: completionDate.toISOString().split('T')[0],
      estimatedSprintsToComplete,
    });
  });

  // Sort actions by priority and completion date
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => {
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return new Date(a.estimatedCompletion).getTime() -
      new Date(b.estimatedCompletion).getTime();
  });

  return actions;
}