# Velocity Gap Feature

## Overview

The Velocity Gap feature helps teams and stakeholders identify, understand, and address velocity gaps to ensure timely project completion. It compares current team velocity against the velocity needed to hit delivery deadlines and provides actionable recommendations.

## Problem Statement

Teams often struggle with:
- Unclear understanding of project velocity
- Misalignment between planned velocity and delivery timelines
- Lack of visibility into potential delivery risks
- Difficulty in identifying actionable improvements

## Solution

The Velocity Gap feature provides:
1. **Velocity Gap Definition**: Clear explanation of velocity gap concepts
2. **Velocity Calculation**: Automated calculation of current vs. required velocity
3. **Visualizations**: Charts and metrics for easy understanding
4. **Recommendations**: AI-generated suggestions for improvement
5. **Action Plans**: Structured milestones and timelines

## Architecture

### Frontend Components

```
frontend/src/components/velocity/
├── VelocityModule.tsx         # Main integration module
├── VelocityGapDashboard.tsx   # Primary dashboard view
├── VelocityRecommendations.tsx # AI recommendations component
├── VelocityActionPlan.tsx     # Action plan with milestones
└── index.ts                   # Re-exports

frontend/src/lib/
└── velocityApi.ts             # API client functions

frontend/src/types/
└── velocity.ts                # TypeScript type definitions
```

### Backend Routes

```
worker/api/routes/velocity/
├── gap.ts                     # Velocity gap calculation endpoint
├── current.ts                 # Current velocity endpoint
├── recommendations.ts         # Recommendations generation endpoint
└── action-plan.ts             # Action plan generation endpoint
```

## Usage

### Basic Integration

```typescript
import { VelocityModule } from '@/components/velocity';

// In your page/component:
<VelocityModule projectId={123} />
```

### Advanced Integration

```typescript
const { gapResult, recommendations, actions } = await calculateVelocityGap(123);
<VelocityModule
  projectId={123}
  initialContext={{ gapResult, recommendations, actions }}
/>
```

## API Endpoints

### GET /api/velocity/gap?projectId={id}
Calculate velocity gap between current and required velocity.

**Response:**
```typescript
{
  gap: number;              // Required - Current
  percentage: number;       // Gap as percentage
  isAhead: boolean;         // Is team ahead?
  explanation: string;      // Human-readable explanation
  severity: 'critical'|'high'|'medium'|'low';
}
```

### GET /api/velocity/current?projectId={id}
Get current team velocity from completed sprints.

**Response:**
```typescript
{
  value: number;
  unit: 'points';
  calculatedOn: string;     // ISO date
  history: VelocityPoint[];
}
```

### POST /api/velocity/recommendations
Generate AI-powered recommendations for addressing velocity gaps.

**Request Body:**
```typescript
{
  gap: {
    gap: number;
    percentage: number;
    isAhead: boolean;
    severity: string;
  }
}
```

**Response:**
```typescript
Array<{
  id: string;
  title: string;
  description: string;
  priority: 'high'|'medium'|'low';
  effects: {
    current: string;
    projected: string;
  };
  actionType: string;
  estimatedImpact: number;
}>
```

### POST /api/velocity/action-plan
Generate action plan with milestones.

**Request Body:**
```typescript
{
  projectId: number;
  recommendations: Array<{
    id: string;
    title: string;
    estimatedImpact: number;
    priority: string;
    actionType: string;
  }>;
}
```

**Response:**
```typescript
Array<{
  id: string;
  recommendationId: string;
  title: string;
  description: string;
  status: 'planned'|'in_progress'|'completed';
  priority: string;
  estimatedCompletion: string;  // ISO date
  estimatedSprintsToComplete: number;
}>
```

## Data Models

### VelocityGapResult
```typescript
interface VelocityGapResult {
  gap: number;              // Required - Current
  percentage: number;       // Gap as percentage
  isAhead: boolean;         // Positive = ahead
  explanation: string;      // Detailed explanation
  severity: string;         // Critical, High, Medium, Low
}
```

### CurrentVelocity
```typescript
interface CurrentVelocity {
  value: number;            // Points per sprint
  unit: 'points';           // Current: points
  calculatedOn: string;     // ISO date
  history: VelocityPoint[]; // Recent sprints
}
```

### RequiredVelocity
```typescript
interface RequiredVelocity {
  value: number;            // Points per sprint
  unit: 'points';
  deadline: string;         // Project deadline
  timeRemaining: number;    // Time in days/sprints
}
```

### VelocityRecommendation
```typescript
interface VelocityRecommendation {
  id: string;
  title: string;
  description: string;
  priority: 'high'|'medium'|'low';
  effects: {
    current: string;        // Current values
    projected: string;      // Projected values
  };
  actionType: string;
  estimatedImpact: number;  // Points improvement
}
```

### VelocityAction
```typescript
interface VelocityAction {
  id: string;
  recommendationId: string;
  title: string;
  description: string;
  status: 'planned'|'in_progress'|'completed';
  priority: 'high'|'medium'|'low';
  estimatedCompletion: string;
  actualCompletion?: string;
  owner?: string;
  estimatedSprintsToComplete: number;
}
```

## Workflow

1. **Initialization**: User loads Velocity Module with projectId
2. **Calculate Gap**: API calculates velocity gap and severity
3. **Visualize**: Dashboard displays gap metrics and explanations
4. **Recommendations**: If behind schedule, generate recommendations
5. **Action Plan**: Create structured action plan with milestones
6. **Track Progress**: Monitor action completion and adjust as needed

## Customization

### Severity Thresholds

Modify severity calculation in `worker/api/routes/velocity/gap.ts`:

```typescript
function calculateSeverity(percentage: number): 'critical' | 'high' | 'medium' | 'low' {
  if (percentage >= 30) return 'critical';   // Major gap
  if (percentage >= 15) return 'high';       // Significant gap
  if (percentage >= 5) return 'medium';      // Moderate gap
  return 'low';                              // Minor gap
}
```

### Recommendation Logic

Customize recommendations in `worker/api/routes/velocity/recommendations.ts` based on your team's context and patterns.

### Translation

Add translations in `frontend/messages/en/velocity.json` and other locale files.

## Testing Checklist

- [ ] Test gap calculation with various scenarios
- [ ] Verify severity levels are appropriate
- [ ] Test recommendation generation
- [ ] Validate action plan structure
- [ ] Check visualizations render correctly
- [ ] Verify responsive design
- [ ] Test error handling for missing data
- [ ] Confirm dark mode compatibility

## Future Enhancements

- Sprint-by-sprint velocity charts (interactive)
- Multi-project comparison views
- historical trend analysis
- integration with project management tools
- custom severity thresholds per project
- team capacity planning
- burn-down chart integration

## Support

For implementation questions or issues:
- Check this documentation
- Review code comments in components
- Consult backend API documentation
- Contact development team

## Related Documentation

- [Velocity Gap PRD](../../docs/VELOCITY_GAP_PRD.md)
- [API Reference](../api/README.md)
- [Component Library](../components/README.md)