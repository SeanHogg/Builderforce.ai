import { Context } from '@netlify/functions/src/context';
import { jsonResponse } from '../../../utils/api';

interface RequestBody {
  gap: {
    gap: number;
    percentage: number;
    isAhead: boolean;
    severity: 'critical' | 'high' | 'medium' | 'low';
  };
}

/**
 * POST /api/velocity/recommendations
 * Generate AI-powered recommendations for addressing velocity gaps
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
    const { gap } = body;

    const recommendations = generateVelocityRecommendations(gap);

    return jsonResponse(recommendations, 200);

  } catch (error) {
    console.error('Error generating recommendations:', error);
    return jsonResponse(
      { error: 'Failed to generate recommendations' },
      500
    );
  }
}

/**
 * Generate velocity recommendations based on gap severity
 */
function generateVelocityRecommendations(gap: {
  gap: number;
  percentage: number;
  isAhead: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
}): Array<{
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  effects: {
    current: string;
    projected: string;
  };
  actionType: 'adjust_schedule' | 'hold_stories' | 'split_stories' | 'add_capacity' | 'reprioritize' | 'other';
  estimatedImpact: number;
}> {
  const recommendations: Array<{
    id: string;
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    effects: {
      current: string;
      projected: string;
    };
    actionType: 'adjust_schedule' | 'hold_stories' | 'split_stories' | 'add_capacity' | 'reprioritize' | 'other';
    estimatedImpact: number;
  }> = [];

  // High severity/gap: Critical recommendations
  if (gap.severity === 'critical' || (gap.gap >= 15 && !gap.isAhead)) {
    recommendations.push({
      id: 'recommendation-high-1',
      title: 'Increase Sprint Velocity Through Story Splitting',
      description: 'Break down large user stories into smaller, more manageable chunks. This approach can improve team flow and reduce context switching overhead.',
      priority: 'high',
      effects: {
        current: 'Current velocity: 15 points/sprint',
        projected: 'Project velocity: 18-20 points/sprint after splitting large stories',
      },
      actionType: 'split_stories',
      estimatedImpact: 3,
    });

    recommendations.push({
      id: 'recommendation-high-2',
      title: 'Implement Rigorous Story Refinement',
      description: 'Conduct detailed story refinement sessions before sprint planning to ensure stories are properly sized and estimations are accurate.',
      priority: 'high',
      effects: {
        current: 'Estimation variance: ±25%',
        projected: 'Estimation variance: ±10% after refinement',
      },
      actionType: 'adjust_schedule',
      estimatedImpact: 4,
    });

    recommendations.push({
      id: 'recommendation-high-3',
      title: 'Add Capacity or Adjust Scope',
      description: 'Consider adding team members, contractors, or adjusting the project scope to bridge the significant velocity gap.',
      priority: 'high',
      effects: {
        current: 'Current capacity: 5 team members',
        projected: 'Additional capacity: 1-2 FTEs or equivalent contractors',
      },
      actionType: 'add_capacity',
      estimatedImpact: 8,
    });
  }

  // Medium severity/gap: Important recommendations
  if (gap.severity === 'high' || (gap.gap >= 8 && gap.gap < 15 && !gap.isAhead)) {
    recommendations.push({
      id: 'recommendation-medium-1',
      title: 'Review and Simplify Backlog',
      description: 'Identify and deprioritize low-value requirements to focus on high-impact features, improving overall throughput.',
      priority: 'medium',
      effects: {
        current: 'Backlog: 40 stories',
        projected: 'Reduced to 32 stories focused on high priority',
      },
      actionType: 'reprioritize',
      estimatedImpact: 3,
    });

    recommendations.push({
      id: 'recommendation-medium-2',
      title: 'Optimize Development Environment',
      description: 'Streamline development setups, reduce unnecessary tooling, and eliminate technical debt to improve velocity.',
      priority: 'medium',
      effects: {
        current: 'Daily setup time: ~1 hour',
        projected: 'Daily setup time: ~30 minutes after optimization',
      },
      actionType: 'adjust_schedule',
      estimatedImpact: 2,
    });

    recommendations.push({
      id: 'recommendation-medium-3',
      title: 'Bi-Weekly Velocity Reviews',
      description: 'Implement regular velocity reviews with the team to identify bottlenecks, celebrate improvements, and course-correct quickly.',
      priority: 'medium',
      effects: {
        current: 'Velocity reviews: Monthly',
        projected: 'Velocity reviews: Every 2 weeks (or daily)',
      },
      actionType: 'hold_stories',
      estimatedImpact: 2,
    });
  }

  // Low severity/gap: Maintenance recommendations
  if (gap.severity === 'medium' || gap.gap >= 5 && gap.gap < 8 && !gap.isAhead) {
    recommendations.push({
      id: 'recommendation-low-1',
      title: 'Monitor Story Completion Rates',
      description: 'Track story completion rates closely to identify and address potential issues before they impact velocity significantly.',
      priority: 'medium', // Still important even if low severity
      effects: {
        current: 'Completion rate: 85%',
        projected: 'Maintenance focus to sustain 85-90% completion',
      },
      actionType: 'other',
      estimatedImpact: 1,
    });
  }

  // If no recommendations generated yet for this gap, provide general ones
  if (recommendations.length === 0) {
    recommendations.push({
      id: 'recommendation-default-1',
      title: 'Establish Robust Velocity Metrics',
      description: 'Implement consistent velocity tracking and analysis to make data-driven decisions about project trajectory.',
      priority: 'medium',
      effects: {
        current: 'Velocity tracking: Basic',
        projected: 'Comprehensive velocity metrics with trend analysis',
      },
      actionType: 'adjust_schedule',
      estimatedImpact: 2,
    });
  }

  return recommendations;
}