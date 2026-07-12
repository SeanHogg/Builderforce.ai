# BuilderForce Dashboard Backend

Backend API for the Stakeholder Alignment Dashboard and Weekly Digest system.

## Features

### Reporting Dashboard
- **Summary View**: Shows total approved priorities, open/pending/overdue sign-offs, active conflicts, and overdue escalations
- **Data Filtering**: Filter by project, time period (last 7/30/90 days, last year, custom), and stakeholder
- **Data Caching**: Dashboard metrics cached for ~60 seconds to optimize performance
- **API Endpoints**: RESTful endpoints for fetching dashboard data

### Weekly Digest
- **Auto-Generation**: Daily cron-based digest generation worker
- **Lightweight Content**: ~600 character limit per digest
- **Distribution**: Sends digests to configured channels (email, Slack)
- **Full Content**: Top 2 active conflicts/overdue items, count summary, and urgent action items
- **Retry and History**: App-level digest storage with paging capability

## Project Structure

```
backend/
├── src/
│   ├── DashboardService.ts          # Main dashboard metrics aggregation service
│   ├── WeeklyDigestWorker.ts       # Digest generation worker
│   ├── WeeklyDigestScheduler.ts    # Schedules digest workers via cron
│   ├── routes/
│   │   ├── dashboard.ts            # Dashboard API endpoints
│   │   └── digest.ts               # Weekly digest API endpoints
│   └── index.ts                    # Express server entry point
├── package.json
└── README.md
```

## Installation

```bash
npm install
```

## Running the Server

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm build
npm start
```

## API Endpoints

### Dashboard API

#### POST /api/dashboard
Fetch dashboard metrics with filtering.

**Request Body:**
```json
{
  "projectIds": ["proj_001"],
  "timePeriod": "last_30_days",
  "timeRange": { "start": "2025-06-01", "end": "2025-06-17" },
  "stakeholderIds": ["stakeholder_001"]
}
```

**Response:**
```json
{
  "summary": {
    "totalApprovedPriorities": 47,
    "openSignOffs": 23,
    "pendingSignOffs": 14,
    "overdueSignOffs": 5,
    "activeConflicts": 8,
    "overdueEscalations": 2,
    "lastUpdated": "2025-06-17T14:30:00Z"
  },
  "projects": [...]
}
```

#### POST /api/dashboard/cache/invalidate
Manually invalidate the cache.

### Weekly Digest API

#### GET /api/digest/latest
Get the most recent digest.

**Response:**
```json
{
  "digestId": "digest_1700000000000",
  "generatedAt": "2025-06-17T00:00:00Z",
  "recipients": ["user@example.com"],
  "content": "...",
  "metrics": {...}
}
```

#### GET /api/digest/history?limit=10&offset=0
Get digest history with pagination.

#### POST /api/digest/generate
Manually trigger digest generation (useful for testing).

#### GET /api/digest/config
Get current digest configuration.

#### POST /api/digest/config
Update digest configuration.

## Configuration

The weekly digest configuration includes:

- **Digest Window**: Start and end day for digest generation
- **Distribution List**: Required approvers, informed parties, and Slack channels
- **Content Template**: Subject, body format, and section headers
- **Maximum Length**: ~600 characters per digest

## Data Models

### DashboardFilters
```typescript
{
  projectIds?: string[];
  timePeriod: 'last_7_days' | 'last_30_days' | 'last_90_days' | 'last_year' | 'custom';
  timeRange?: { start: string; end: string };
  stakeholderIds?: string[];
}
```

### WeeklyDigestConfig
```typescript
{
  enabled: boolean;
  digestWindow: { start: string; end: string; windowName: string };
  distributionList: {
    requiredApprovers: string[];
    informedPartyEmails: string[];
    slackChannels: string[];
  };
  template: { subject: string; bodyFormat: string; sections: {...} };
  maxLength: number;
}
```

## Integration with Existing Infrastructure

The implementation reuses existing notification/corpus infrastructure where possible:

- **Email**: Uses configured email service (SendGrid, AWS SES, etc.)
- **Slack**: Posts to configured Slack channels
- **Cron**: Scheduled digest generation via cron scheduler
- **Storage**: Digests stored for retrieval and paging

## Security Notes

- Implement authentication (JWT or session-based)
- Add input validation for all query parameters
- Rate limit API endpoints
- Use HTTPS in production
- Sanitize all user inputs

## Future Enhancements

- Real-time conflict detection alerts
- Advanced filter combinations
- Custom alert thresholds
- Digest localization for different regions
- Integration with existing communication platform APIs

## License

MIT