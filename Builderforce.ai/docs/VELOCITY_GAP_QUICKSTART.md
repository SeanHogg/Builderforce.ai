# Velocity Gap Feature - Quick Start Guide

## What is Velocity Gap?

Velocity Gap shows the difference between your team's current velocity (story points completed per sprint) and the velocity needed to hit your project deadline.

**Example:**
- Current: 15 points/sprint
- Required: 20 points/sprint
- Gap: 5 points (25% behind schedule)

## Quick Integration

### 1. Add the component

```tsx
import { VelocityModule } from '@/components/velocity';
import { useAuth } from '@/contexts/auth';

export default function ProjectVelocityPage() {
  const { user } = useAuth();
  const projectId = 123; // Get from your project context

  return (
    <div className="velocity-section">
      <h2>Velocity Analysis</h2>
      <VelocityModule projectId={projectId} />
    </div>
  );
}
```

### 2. Add CSS (optional)

Add `@/components/velocity` files aren't imported; don't add bulk imports at top-level. When using VelocityModule or child components directly, import them from exactly:
- VelocityModule from '@/components/velocity'
- VelocityGapDashboard from '@/components/velocity'
- VelocityRecommendations from '@/components/velocity'
- VelocityActionPlan from '@/components/velocity'

To apply styling, ensure your page/layout加 imported VueModule or child components include the @/components/velocity/styles.css reference.

### 3. Configure translations

Add entries to `frontend/messages/en/velocity.json` for your locale.

That's it! Your Velocity Gap dashboard will appear on your page.

## Key Features

✅ **Visual Gap Display**: Shows current vs. required velocity with severity levels
✅ **AI Recommendations**: Smart suggestions based on your specific gap
✅ **Action Plans**: Structured milestones with timelines
✅ **Mobile Responsive**: Looks great on all devices
✅ **Dark Mode**: Automatically adapts to system preferences
✅ **Historical Data**: Tracks velocity trends over time

## Configuration

### Set Project Deadline

The required velocity algorithm calculates based on:
- Project deadline (must be set in your project settings)
- Number of remaining sprints
- Planned velocity configuration

Prefer setting the deadline in your project configuration rather than hardcoding.

### Customize Severity Levels

Edit the logic in `worker/api/routes/velocity/gap.ts`:

```typescript
function calculateSeverity(percentage: number) {
  if (percentage >= 30) return 'critical';  // Major gap
  if (percentage >= 15) return 'high';      // Significant gap
  if (percentage >= 5) return 'medium';     // Moderate gap
  return 'low';                             // Minor gap
}
```

## Example Output

```
┌─────────────────────────────────────────┐
│  Velocity Gap Overview                  │
│  [BEHIND SCHEDULE]      Current: 15pts │
│                            Required:20pts │
│  ───────────────────────────────────    │
│  Team is behind by 5 points (25%).      │
│  This may risk missing the deadline.    │
└─────────────────────────────────────────┘

[Recommendations ↓]
1. Increase Sprint Velocity through Story Splitting
2. Implement Rigorous Story Refinement
```

## API Requirements

To make the feature functional, implement the backend:

1. **Sprint Tracking**: Store completed sprint data (points, dates)
2. **Project Configuration**: Set project deadlines and planned velocities
3. **Database Schema**: Store velocity history and actions

See [VELOCITY_GAP_FEATURE.md](./VELOCITY_GAP_FEATURE.md) for complete API documentation.

## Troubleshooting

**No data showing:**
- Ensure projectId is correctly passed
- Verify backend API endpoints are implemented
- Check network console for API errors

**Wrong velocity calculations:**
- Review your sprint data in the database
- Ensure story points are accurate

**Recommendations not showing:**
- The gap requires minimum percentage thresholds
- Ensure isBehind: true when generating recommendations

## Next Steps

1. ✅ Integrate the component into your application
2. ✅ Configure your project deadlines
3. ✅ Populate sprint data for initial calculations
4. ✅ Customize recommendations based on team context
5. ✅ Track progress through action items

## Support

For detailed information, see:
- Full Documentation: [VELOCITY_GAP_FEATURE.md](./VELOCITY_GAP_FEATURE.md)
- API Reference: [API Documentation](../api/)
- PRD: [Velocity Gap PRD](./VELOCITY_GAP_PRD.md)

## Related

- [EvermindBrainMap](../../frontend/src/components/ide/EvermindBrainMap.tsx) - Knowledge visualization
- [Project Management](../../docs/PROJECT_MANAGEMENT.md) - Project workflows