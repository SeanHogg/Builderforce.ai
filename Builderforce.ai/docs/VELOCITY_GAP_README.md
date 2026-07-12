# Velocity Gap Tracking Feature

## 📊 What is this?

A comprehensive velocity gap analysis tool that helps teams identify delays, understand risks, and take action to meet project deadlines.

## 🎯 Problem Solved

**"We're behind schedule?"** → No more guessing. The Velocity Gap feature tells you exactly how far behind you are, why it matters, and what to do about it.

**Features:**
- ✅ Automated velocity calculation
- ✅ Visual gap analysis
- ✅ AI-powered recommendations
- ✅ Action plans with milestones
- ✅ Historical trend tracking
- ✅ Severity-based risk assessment

## 🚀 Quick Start

```tsx
import { VelocityModule } from '@/components/velocity';

// In your project detail page:
<VelocityModule projectId={123} />
```

See [Quick Start Guide](./VELOCITY_GAP_QUICKSTART.md) for more details.

## 📁 Project Structure

```
Builderforce.ai/
├── frontend/
│   ├── src/
│   │   ├── components/velocity/
│   │   │   ├── VelocityModule.tsx           # Main integration
│   │   │   ├── VelocityGapDashboard.tsx     # Primary view
│   │   │   ├── VelocityRecommendations.tsx  # AI suggestions
│   │   │   ├── VelocityActionPlan.tsx       # Action milestones
│   │   │   └── index.ts
│   │   ├── lib/
│   │   │   └── velocityApi.ts                # API client
│   │   ├── types/
│   │   │   └── velocity.ts                   # Type definitions
│   │   ├── styles/
│   │   │   └── velocity.css                 # Component styles
│   │   └── app/
│   │       └── velocity-demo/
│   │           └── page.tsx                  # Demo page
│   └── messages/
│       └── en/
│           └── velocity.json                # Translations
├── worker/api/routes/velocity/
│   ├── gap.ts                               # Calculation endpoint
│   ├── current.ts                           # Current velocity
│   ├── recommendations.ts                   # AI recommendations
│   └── action-plan.ts                       # Action plan
└── docs/
    ├── VELOCITY_GAP_FEATURE.md              # Full documentation
    ├── VELOCITY_GAP_QUICKSTART.md           # Quick start
    └── VELOCITY_GAP_PRD.md                  # Product requirements
```

## 📋 Acceptance Criteria Met

Per PRD task #343:

1. ✅ **Velocity Gap Definition**: Clear explanations included in documentation and UI
2. ✅ **Understanding Velocity Gap**: Dashboard explains current vs. required velocity with context
3. ✅ **Identifying Velocity Gap**: Visual metrics, gap percentages, severity levels
4. ✅ **Calculating Velocity Gap**: Automatic calculation with explanations
5. ✅ **Addressing Velocity Gap**: AI-generated recommendations with actionable items
6. ✅ **Recommendations and Actions**: Milestones, progress tracking, Gantt-style timelines (via milestones)

## 🎨 Customization

### Severity Thresholds
Edit `worker/api/routes/velocity/gap.ts` to adjust gap severity:
- Critical: ≥30% gap
- High: 15-30% gap
- Medium: 5-15% gap
- Low: <5% gap

### Recommendations Logic
Customize in `worker/api/routes/velocity/recommendations.ts` based on your team's needs.

### Visual Styling
All component styles in `frontend/src/styles/velocity.css` - themes automatically adapt to dark mode.

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/velocity/gap?projectId={id}` | Calculate velocity gap |
| GET | `/api/velocity/current?projectId={id}` | Get current velocity |
| POST | `/api/velocity/recommendations` | Generate AI recommendations |
| POST | `/api/velocity/action-plan` | Create action plan |

See [VELOCITY_GAP_FEATURE.md](./VELOCITY_GAP_FEATURE.md) for full API spec.

## 📝 Usage Examples

### Basic Integration
```tsx
<VelocityModule projectId={123} />
```

### With Initial Data
```tsx
<VelocityModule
  projectId={123}
  initialContext={{
    gapResult: { gap: -5, percentage: 25, severity: 'high' },
    recommendations: [],
    actions: []
  }}
/>
```

### Accessing Data Directly
```typescript
import {
  calculateVelocityGap,
  getVelocityRecommendations,
  generateActionPlan
} from '@/lib/velocityApi';

// Calculate gap
const gap = await calculateVelocityGap(123);

// Generate recommendations
const recs = await getVelocityRecommendations(gap);

// Create action plan
const actions = await generateActionPlan(123, recs);
```

## 🎯 Business Value

**For Product Owners:**
- Early visibility into delivery risks
- Data-driven decisions about scope/resource changes
- Clear communication with stakeholders

**For Teams:**
- Understanding of where they stand
- Actionable improvement suggestions
- Progress tracking through action items

**For Project Managers:**
- Timeline prediction
- Resource planning
- Stakeholder reporting

## 🔄 Workflow

```
1. User loads Velocity Module → 2. Calculates gaps → 3. Visualizes results
                                                ↓
                    4. Generates recommendations (if needed)
                                                ↓
                    5. Creates action plan with milestones
                                                ↓
                    6. User tracks and completes actions
                                                ↓
                    7. Monitor progress and recalculate
```

## 🌐 Internationalization

Language files: `frontend/messages/{locale}/velocity.json`

Supported translations currently for English (`en`).

## 🧪 Testing

To test the feature:

```bash
# In project detail page:
# 1. Load the VelocityModule component
# 2. Verify gap calculation shows correct values
# 3. Check severity badges display appropriately
# 4. Test recommendation generation
# 5. Validate action plan structure
```

## 📚 Additional Documentation

- [Full Feature Documentation](./VELOCITY_GAP_FEATURE.md)
- [Quick Start Guide](./VELOCITY_GAP_QUICKSTART.md)
- [Product Requirements (PRD)](./VELOCITY_GAP_PRD.md)

## 🤝 Integration with Your System

1. **Project Management**: Store project deadlines and planned velocities
2. **Sprint Tracking**: Track story points completed per sprint
3. **User Management**: Connect velocity data to user accounts
4. **Reporting**: Export velocity metrics for stakeholder reports

## ✅ Implementation Checklist

- [x] API routes for gap calculation
- [x] API routes for recommendations
- [x] API routes for action plans
- [x] Frontend components (Dashboard, Recommendations, Action Plan)
- [x] Type definitions
- [x] API client functions
- [x] Translation files
- [x] Styling (responsive, dark mode)
- [x] Documentation
- [x] Example integration pages
- [ ] Backend database schema (to be defined)
- [ ] Connection to actual project data (to be connected)

## 🚧 Out of Scope

Per PRD, the following are outside this release:
- ❌ Velocity simulation
- ❌ Advanced analytics/statistical modeling
- ❌ Third-party tool integrations

## 💡 Tips for Success

1. **Accurate Story Points**: Ensure team estimates are realistic and consistent
2. **Regular Updates**: Recalculate velocity after each sprint
3. **Team Buy-In**: Educate team members on velocity concepts
4. **Contextual Recommendations**: Customize recommendations for your methodology
5. **Progress Tracking**: Review and adjust action plans regularly

## 📞 Support & Questions

For implementation support:
- See [VELOCITY_GAP_FEATURE.md](./VELOCITY_GAP_FEATURE.md) for technical details
- Review code documentation in source files
- Check [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines

---

**Package Version:** 1.0.0
**Last Updated:** 2026-01-XX
**Status:** ⚠️ Backend needs integration with project data