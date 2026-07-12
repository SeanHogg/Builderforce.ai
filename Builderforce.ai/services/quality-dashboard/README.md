# Quality & Bugs Dashboard

A web-based dashboard for tracking bug metrics, severity distribution, and trends across connected issue trackers (Jira, GitHub Issues).

## Feature Overview

- **Bug Count Summary**: Real-time totals, deltas (opened vs. closed), and severity breakdown
- **Severity Distribution**: Donut/stacked-bar chart showing bug distribution across Critical/High/Medium/Low tiers
- **Trend Analysis**: Time-series line charts for open bugs, new opens, and closures
- **Filtering & Segmentation**: Filter by project, team, component, assignee, severity
- **Export**: CSV and PDF report generation
- **Data Source Integration**: Support for Jira and GitHub Issues
- **Access Control**: Respects project-level permissions from source systems

## Architecture

```
quality-dashboard/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   └── main.py           # FastAPI REST API
│   └── requirements.txt      # Python dependencies
├── frontend/
│   └── src/
│       ├── components/
│       │   └── QualityDashboard/
│       │       ├── index.tsx          # Main dashboard component
│       │       ├── BugCountWidget.tsx # Total open, newly opened, resolved counts
│       │       ├── SeverityDonutChart.tsx
│       │       ├── TrendLineChart.tsx
│       │       ├── FiltersBar.tsx
│       │       └── BugTable.tsx
│       ├── hooks/
│       │   └── useQualityData.ts     # React hooks for API calls
│       ├── utils/
│       │   ├── apiClient.ts          # API client utilities
│       │   ├── filters.ts            # Filter serialization/deserialization
│       │   └── exports.ts            # PDF/CSV export utilities
│       └── types/
│           └── quality.ts            # TypeScript interfaces
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## Backend API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/bugs/count-summary` | Returns bug count summary and severity breakdown |
| GET | `/api/v1/bugs/trend-data` | Returns time-series trend data |
| GET | `/api/v1/bugs/severity-breakdown` | Returns severity distribution |
| GET | `/api/v1/bugs/list` | List all bugs with pagination |
| POST | `/api/v1/sync/jira` | Manually trigger Jira sync |
| POST | `/api/v1/sync/github` | Manually trigger GitHub sync |
| GET | `/api/v1/export/csv` | Export filtered bugs to CSV |
| GET | `/api/v1/export/pdf` | Export filtered bugs summary to PDF |
| GET | `/api/v1/health` | Health check |

## Frontend Components

| Component | Description |
|-----------|-------------|
| `QualityDashboard` | Main container component integrating all widgets |
| `BugCountWidget` | Displays total open, newly opened, resolved counts |
| `SeverityDonutChart` | Visualizes severity distribution |
| `TrendLineChart` | Shows time-series trends (30d, 7d, 90d, custom) |
| `FiltersBar` | Filter controls for project, team, component, assignee, severity |
| `BugTable` | Paginated bug list with export options |

## Deployment

### Local Development

```bash
# Start backend
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001

# Start frontend
cd frontend
npm install
npm run dev
```

### Docker

```bash
docker-compose up -d
```

## Acceptance Criteria

- AC-01: The count summary accurately reflects connected Jira/GitHub data
- AC-02: Severity donut chart renders correctly with all four tiers
- AC-03: Trend chart displays 30 days by default and re-renders within 2 seconds
- AC-04: Applying filters updates all widgets simultaneously without reload
- AC-05: URL with filter parameters loads dashboard in filtered state
- AC-06: CSV export contains: Bug ID, Title, Severity, Status, Assignee, Created Date, Resolved Date
- AC-07: PDF export includes summary counts, severity chart, and trend chart
- AC-08: Users without project access see no bug data for that project
- AC-09: Data staleness indicator shows last-synced timestamp
- AC-10: Dashboard loads to interactive state under 3 seconds (10k bugs)

## Future Enhancements

- Root-cause analysis and automatic triage
- Custom severity tier creation
- SLA/SLO breach alerting
- Mobile-responsive design
- Real-time push notifications
- Integration with test management tools (TestRail, Xray)