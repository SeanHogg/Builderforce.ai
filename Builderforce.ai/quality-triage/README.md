# Quality Improvement - Bug-Driven Triage & Remediation

This module provides automatic analysis of bug distribution and surfaces prioritized recommendations for focused testing, code review, or agent-assisted refactoring when bug counts exceed configured thresholds.

## Overview

The Quality Improvement system ingests bug data from issue trackers, computes defect density scores per module, identifies hotspots, and generates actionable recommendations prioritized by impact and effort. It integrates with AI coding agents for refactoring and delivers insights via web dashboard, Slack/Teams notifications, and PR comments.

## Components

### Core Services

- **BugIngestionService**: Connects to GitHub Issues, Jira, Linear, Azure DevOps APIs
- **BugAnalysisService**: Computes defect density scores, identifies hotspots, detects recurrence patterns
- **RecommendationEngine**: Generates prioritized recommendations (testing, review, refactoring)
- **HumanApprovalGate**: Blocks agent commits without explicit approval

### Data Models

- `Bug`: Issue from tracker with severity, file references, stack traces
- `Module`: Directory or file path with lines-of-code metrics
- `DefectDensityScore`: Defects per unit metric (weight × bugs / complexity/LOC)
- `Hotspot`: High-impact area requiring intervention
- `Recommendation`: Actionable suggestion with rationale, owner, effort tier
- `RecommendationAction`: Tracking of completed/refined recommendations

### Configuration

- `quality.yml`: Thresholds, weights, integration settings
- Environment variables for tracker credentials

### API Endpoints

- `POST /quality/ingest`: Manually trigger bug ingestion
- `GET /quality/recommendations`: Return prioritized recommendations
- `GET /quality/recommendations/:id`: Full recommendation details
- `POST /quality/trigger`: On-demand analysis
- `GET /quality/digest`: Weekly digest summary
- `PATCH /quality/recommendations/:id/action`: Mark as actioned

### Integrations

- **Slack/Teams**: Notifications when thresholds breached
- **Issue Trackers**: GitHub Issues, Jira, Linear, Azure DevOps
- **AI Coding Agents**: Structured task payloads for refactoring

## Usage

```typescript
// Trigger automatic analysis
POST /quality/trigger

// Get recommendations for a module
GET /quality/recommendations?module=src/services/auth

// Get weekly digest
GET /quality/digest

// Schedule agent refactoring task
POST /quality/recommendations/:id/refactor
```

## Configuration Example

```yaml
thresholds:
  repository: 50
  module: 15
  file: 3

weights:
  critical: 3
  major: 2
  minor: 1

metrics:
  defectDensity:
    formula: (weighted_bugs) / (cyclomatic_complexity or lines_of_code)
    use_complexity: true

recommendation:
  top_n: 5
  effort_tiers:
    S: "Lines < 100, complexity low"
    M: "Lines 100-300, medium complexity"
    L: "Lines > 300, high complexity"
    XL: "Critical paths, cross-cutting concerns"

integrations:
  slack:
    webhook_url: ${SLACK_WEBHOOK}
  teams:
    webhook_url: ${TEAMS_WEBHOOK}
  issue_trackers:
    github:
      api_token: ${GITHUB_TOKEN}
    jira:
      api_token: ${JIRA_TOKEN}
```

## Support

For issues or questions, refer to the main Builderforce.ai documentation or open an issue in the repository.