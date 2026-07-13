# Budget & Resources Module Documentation

## Overview

The Budget & Resources module provides a unified, real-time view of budget variance, headcount planning, and AI resource consumption. It enables stakeholders to answer "Are we on track?" at any point in the project lifecycle.

## Features

### Executive Dashboard

The main dashboard displays three RAG (Red-Amber-Green) indicators:

1. **Budget Health**: Overall budget variance, EAC forecast vs. total budget, percent consumed
2. **Headcount Health**: Total planned vs. actual FTE, allocation gaps, over/under allocated roles
3. **AI Resource Health**: Monthly and weekly AI spending, quota limits, token usage

### Budget Tracking

- **Budget Plan Ingestion**: CSV, spreadsheet, or API ingestion of budget baselines
- **Actuals Tracking**: Pulls actuals from ERP, expense tools, or manual entry
- **Variance Analysis**: Period variance, EAC variance, percentage consumed vs. timeline
- **Burn Rate Forecasting**: 2-week rolling average, runway to completion
- **Category Drill-Down**: Navigate from total budget to individual cost categories and line items

### Human Resource Tracking

- **Headcount Planning**: Planned roles, FTE allocation, start/end dates
- **Capacity Gaps**: Detects over-allocated (>100%), under-allocated (<50%), and unfilled roles
- **Demand Forecast**: Projects resource needs for 2, 4, and 8 weeks
- **Contractor vs. FTE**: Tracks contractor spend separately from internal loaded costs

### AI Resource Tracking

- **AI Cost Attribution**: Tracks token consumption and API costs by provider
- **Quota & Limit Monitoring**: Monitors against monthly spend caps, token quotas, rate limits
- **Alerts**: Fire at 70% and 90% of threshold thresholds
- **Model Efficiency**: Cost-per-task and cost-per-output metrics by model

### Reporting & Export

- **Executive Dashboard**: Single-screen summary with RAG status and top 3 risks
- **Detailed Reports**: Exportable PDF/CSV for budget, resources, and AI costs
- **Audit Trail**: Logs all baseline changes and reforecast decisions

## Database Schema

### Tables

1. `budget_plan`: Approved budget baselines by category
2. `budget_actuals`: Actual spend by line item
3. `headcount_plan`: Planned roles and FTE allocations
4. `headcount_assignments`: Actual person assignments
5. `ai_usage`: API usage and cost tracking
6. `ai_quota_limits`: Monthly and daily spend/quota thresholds
7. `resource_demand_forecast`: 2/4/8 week resource projections
8. `budget_audit`: Change audit trail

### Indexes

All tables include performance indexes on common query patterns (project_id, dates).

## API Endpoints

### Dashboard Data

```
GET /api/budget/resources/dashboard?projectId=123
```

Returns:
- Budget status and RAG
- Headcount status and RAG
- AI provider usage and RAG
- Top 3 risks with severity

### Budget Baseline Ingestion

```
POST /api/budget/resources/baseline/ingest
Body: {
  projectId: string,
  budgetData: BudgetPlanItem[],
  dataSource: string (optional)
}
```

### Actuals Fetching

```
GET /api/budget/resources/actuals/:projectId
```

Returns: Array of actual spend records

## Configuration

### Alert Thresholds

Default configurable thresholds:
- Budget variance: 5%, 10%, 15%
- AI usage limits: 70%, 90% of quota
- Headcount gaps: 2 days warning, then alert

### Cost Categories

- `personnel`: Internal team costs
- `ai_cloud_services`: LLM and cloud compute
- `tooling`: Software licenses and tools
- `contractors`: Third-party resources
- `contingency`: Buffer for unexpected costs

## Acceptance Criteria Coverage

| AC | Status | Notes |
|----|--------|-------|
| AC-1 | ✅ Implemented | Integration test infrastructure ready |
| AC-2 | ✅ Implemented | EAC variance within ±0.5% calculation verified |
| AC-3 | ✅ Implemented | Cost attribution covers all providers |
| AC-4 | ✅ Implemented | Gap alerts within 15min threshold |
| AC-5 | ⚠️ Deferred | Performance requires production data |
| AC-6 | ✅ Implemented | Digest scheduled job ready |
| AC-7 | ⚠️ Tracking | Audit trail for baseline changes logged |
| AC-8 | ⚠️ Tracking | CSV export ready |
| AC-9 | ⚠️ Deferred | Admin config UI pending |
| AC-10 | ✅ Implemented | AI vs. Human comparison table ready |

## Example Usage

### Ingesting a Budget Baseline

```typescript
import { ingestBudgetBaseline, BudgetPlanItem } from '@/utils/api';

const budgetData: BudgetPlanItem[] = [
  {
    category: 'personnel',
    lineItemName: 'Senior Engineer (Q1)',
    plannedAmount: 250000,
    allocatedFte: 1.5,
    startDate: '2024-01-01',
    endDate: '2024-03-31'
  }
];

await ingestBudgetBaseline('project-123', budgetData, 'csv');
```

### Fetching Dashboard Data

```typescript
import { fetchBudgetDashboard } from '@/utils/api';

const dashboard = await fetchBudgetDashboard('project-123');
console.log(dashboard.budget.ragStatus);
console.log(dashboard.headcount.roles);
```

## Security & Permissions

- Users must be logged in to access dashboard
- RBAC determines read/write permissions:
  - **Admin**: Can ingest baselines, modify actuals, configure alerts
  - **Manager**: Can view dashboard, forecast
  - **Viewer**: Read-only access

## Future Enhancements

- Real-time messaging for Slack/email alerts
- Portfolio-level budget roll-up
- ROI/Business Value attribution
- Carbon footprint accounting
- HRIS integration for automatic headcount sync