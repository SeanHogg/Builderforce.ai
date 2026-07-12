import { Context } from '@netlify/functions/src/context';
import { jsonResponse } from '../../../utils/api';

/**
 * GET /api/velocity/current
 * Get current team velocity from project sprints
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
    const sprints = await getSprintsForProject(projectId);
    const velocity = calculateAverageVelocity(sprints);
    
    return jsonResponse(velocity, 200);

  } catch (error) {
    console.error('Error getting current velocity:', error);
    return jsonResponse(
      { error: 'Failed to get current velocity' },
      500
    );
  }
}

/**
 * Calculate average velocity from completed sprints
 */
function calculateAverageVelocity(sprints: any[]): { value: number; unit: 'points'; calculatedOn: string; history: any[] } {
  const recentSprints = sprints.filter(s => s.status === 'completed').slice(0, 3);
  
  if (recentSprints.length === 0) {
    return {
      value: 0,
      unit: 'points',
      calculatedOn: new Date().toISOString(),
      history: [],
    };
  }

  const totalPoints = recentSprints.reduce((sum, sprint) => sum + sprint.points, 0);
  const average = totalPoints / recentSprints.length;
  
  return {
    value: Math.round(average),
    unit: 'points',
    calculatedOn: new Date().toISOString(),
    history: recentSprints.map(s => ({
      sprint: s.id || s.name,
      points: s.points,
      date: s.completedAt || new Date().toISOString(),
      notes: s.notes,
    })),
  };
}

/**
 * Example: Fetch sprints from database
 * TODO: Replace with actual database query
 */
async function getSprintsForProject(projectId: number): Promise<any[]> {
  // TODO: Query actual sprint data from database
  return [
    {
      id: 'sprint-1',
      name: 'Sprint 1',
      status: 'completed',
      points: 18,
      completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'sprint-2',
      name: 'Sprint 2',
      status: 'completed',
      points: 16,
      completedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'sprint-3',
      name: 'Sprint 3',
      status: 'completed',
      points: 15,
      completedAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}