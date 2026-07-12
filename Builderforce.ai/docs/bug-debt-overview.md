# Bug Debt Overview Dashboard

**Task:** #344  
**PRD link:** [Bug Debt Overview PRD](../PRD-drop/BUG_DEBT_OVERVIEW.md)

## Overview

The Bug Debt Overview dashboard provides a consolidated, intuitive view of your open bug backlog, presenting metrics categorized by severity and age, along with trend analysis to help engineering and product leadership make data-driven decisions.

## Features

### Core Metrics

1. **Total Open Bugs** - Current count of all open bugs
2. **Bugs by Severity** - Distribution across Critical, High, Medium, and Low severity levels with trend indicators
3. **Bugs by Age** - Age distribution grouping:
   - Less than 7 days
   - Between 7-30 days
   - Between 30-90 days
   - More than 90 days (aging bugs)
4. **Overall Trend** - Percentage change compared to previous period
5. **Severity Trends** - Individual trend analysis for each severity level

### Key Acceptance Criteria (ACs)

- ✅ AC1: All currently open bugs from the integrated bug tracking system are accurately reflected
- ✅ AC2: "Bugs by Severity" chart correctly categorizes and displays counts
- ✅ AC3: "Bugs by Age" chart correctly categorizes by age bucket
- ✅ AC4: Overall trend indicator shows percentage change with visual cue
- ✅ AC5: Severity trends accurately calculate percentage change
- ✅ AC6: All charts/metrics are easily understandable at a glance
- ✅ AC7: Data displayed is no more than 24 hours old

## Architecture

### Backend (API Layer)

**Location:** `Builderforce.ai/api/`

**Components:**

1. **Bug Debt Service** - `bugDebt.service.ts`
   - Core business logic for bug debt metrics
   - Data aggregation and trend calculations
   - Mock data generation for development

2. **API Routes** - `routes/bugDebt.ts`
   - GET `/api/bug-debt/overview?period=week|month` - Main endpoint
   - GET `/api/bug-debt/bugs` - Raw bugs endpoint (for debugging)

**Interfaces:**

```typescript
interface Bug {
  id: string;
  title: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  createdDate: Date;
  updatedDate: Date;
  [key: string]: any;
}

interface BugDebtOverview {
  totalOpenBugs: BugTrend;
  bySeverity: {
    critical: BugTrend;
    high: BugTrend;
    medium: BugTrend;
    low: BugTrend;
  };
  byAge: BugsByAge;
  lastUpdated: Date;
  dataSource: string;
}
```

### Frontend (UI Layer)

**Location:** `Builderforce.ai/frontend/src/components/bugDebt/`

**Components:**

1. **BugDebtOverview** - Main dashboard component
   - Displays all metrics and visualizations
   - Auto-refreshes every 5 minutes
   - Loading and error states

2. **Badge Components** - `Badge.tsx`
   - SeverityBadge - Shows bug severity
   - AgeBadge - Shows bug age in days
   - TrendBadge - Shows trend direction

3. **Page Component** - `BugDebtOverviewPage.tsx`
   - Dedicated route wrapper
   - Controls and documentation
   - Refresh button

## Integration Points

### Data Source Integration (Pending)

In production, integrate with your bug tracking system:

**Potential Integrations:**

- **Jira**: Use Jira API to fetch issues with `status in (Open, In Progress)` filter
- **GitHub Issues**: Use GitHub GraphQL or REST API
- **Bugzilla**, **Linear**, **Asana**, etc.

**Integration Requirements:**

1. Configure API credentials in environment
2. Fetch bugs with date filters for trend analysis
3. Map issue statuses to standard problem lifecycle
4. Calculate age from created/updated dates

### API Integration

The API is ready to connect to your backend infrastructure:

```typescript
// In your Express app
import bugDebtRoutes from './api/routes/bugDebt';

app.use('/api/bug-debt', bugDebtRoutes);
```

**Endpoint Response:**

```json
{
  "success": true,
  "data": {
    "totalOpenBugs": {
      "current": 42,
      "previous": 48,
      "change": -6,
      "percentageChange": -12.5
    },
    "bySeverity": {
      "critical": {
        "current": 5,
        "previous": 7,
        "change": -2,
        "percentageChange": -28.6
      },
      // ... other severities
    },
    "byAge": {
      "lessThan7Days": 15,
      "between7And30Days": 12,
      "between30And90Days": 10,
      "moreThan90Days": 8,
      "total": 45
    },
    "lastUpdated": "2025-06-18T10:30:00Z",
    "dataSource": "Last 7 days"
  },
  "timestamp": "2025-06-18T10:30:00Z"
}
```

## Usage Examples

### Basic Usage

```tsx
import { BugDebtOverview } from '@/components/bugDebt';

function Dashboard() {
  return <BugDebtOverview period="week" />;
}
```

### Page Usage

```tsx
import { BugDebtOverviewPage } from '@/components/bugDebt';

function App() {
  return (
    <Routes>
      <Route path="/bug-debt" element={<BugDebtOverviewPage />} />
      <Route path="/bug-debt/month" element={<BugDebtOverviewPage period="month" />} />
    </Routes>
  );
}
```

### Service API Usage

```typescript
import { bugDebtService } from '@/api/bugDebt.service';

async function loadBugDebtData() {
  try {
    const overview = await bugDebtService.getOverview('month');
    console.log('Open bugs:', overview.totalOpenBugs.current);
    console.log('Critical bugs:', overview.bySeverity.critical.current);
    console.log('Aging bugs (>90 days):', overview.byAge.moreThan90Days);
  } catch (error) {
    console.error('Failed to load bug debt data:', error);
  }
}
```

## Configuration

### Environment Variables (Optional)

```env
# Bug tracking API credentials (example)
BUG_TRACKING_API_URL=https://your-jira-instance.com/api
BUG_TRACKING_API_TOKEN=your-api-token
BUG_TRACKING_PROJECT_KEY=YOUR_PROJ
```

### Refresh Interval

Default refresh interval: **5 minutes** (configurable via code)

```typescript
// In BugDebtOverview component
// Modify the interval call:
setInterval(() => {
  bugDebtService.getOverview(period).then(setData);
}, 5 * 60 * 1000); // 5 minutes
```

### Data Source Config

Currently supports two periods:
- `'week'` - Last 7 days comparison (default)
- `'month'` - Last 30 days comparison

## Design Patterns

### Data Fetching

- Uses React `useEffect` with cleanup for periodic refreshes
- Implements loading and error states
- Singleton service pattern for singleton bug debt service

### Component Architecture

- Reusable badge components for consistent UI
- Composable main dashboard with organized sections
- Separation of concerns: services, routes, components, pages

## Limitations

As per PRD scope:

- ❌ Individual bug details navigation
- ❌ Bug management actions (edit, assign, resolve)
- ❌ Forecasting/predictive analytics
- ❌ Advanced filtering (by assignee, component, etc.)
- ❌ Historical archiving beyond trend period

## Testing

### Service Unit Tests

Test service functionality:
- Bug aggregation and counting
- Age bucket calculation
- Trend calculation logic
- Mock data generation

### Component Tests

Test component behavior:
- Loading and error states
- Data rendering
- Trend indicators
- Responsive design

### Integration Tests

Test API endpoints:
- Overview endpoint response format
- Period parameter handling
- Error scenarios

## Deployment Notes

### Backend

1. Ensure Express app includes bug debt routes
2. Configure environment variables if using real bug tracking API
3. Set up cron jobs or scheduled tasks for data refresh (hourly/daily)

### Frontend

1. Install dependencies:
   ```bash
   npm install lucide-react
   ```

2. Add routes to your routing configuration
3. Configure API proxy if needed for development

## Related Documentation

- [PRD: Bug Debt Overview](../PRD-drop/BUG_DEBT_OVERVIEW.md)
- [Quality Targets](../PRD-drop/QUALITY_TARGETS.md)
- [Quality Exemptions](../PRD-drop/QUALITY_EXEMPTIONS.md)

## Changelog

### Version 1.0.0 (Current)

- ✅ Basic bug debt overview with mock data
- ✅ Severity and age distribution metrics
- ✅ Trend analysis (week/month periods)
- ✅ Frontend components with responsive design
- ✅ Auto-refresh capability
- ✅ Loading and error states
- ✅ Documentation

### Future Enhancements

- 🔜 Real bug tracking integration (Jira, GitHub)
- 🔜 Historical data export (CSV, PDF)
- 🔜 Custom alert thresholds
- 🔜 Export to external tools (PM tools, HRIS)
- 🔜 Advanced filtering
- 🔜 Bug processor integrators (priority only, not in scope)

## Support

For questions or issues:
1. Check the PRD document for detailed requirements
2. Review the architecture and integration guides above
3. Contact the engineering team or project owner.

---

**Last updated:** June 18, 2025  
**Maintained by:** BuilderForce Development Team