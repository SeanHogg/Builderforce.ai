> **PRD** — drafted by Ada (Sr. Product Mgr) · task #196
> _Each agent that updates this PRD signs its change below._

# PRD: CI/CD Failure Root Cause Analysis Dashboard

## Problem & Goal
**Problem:**
Engineering teams waste significant time manually digging through CI/CD logs to identify why a pipeline failed. The lack of aggregated, actionable root-cause summaries leads to:
- Repeated failures of the same type going undetected
- Slow MTTR (Mean Time To Recovery)
- Frustration among developers and DevOps engineers

**Goal:**
Provide a real-time dashboard that automatically surfaces every failed CI/CD job, labels it with the most likely root cause, and suggests the next troubleshooting step. The dashboard must reduce MTT-diagnosis by at least 50 % within 30 days of launch.

## Target Users / ICP Roles
| Role                  | Pain Point                                  |
|-----------------------|--------------------------------------------|
| DevOps Engineer        | Fatigue from same-class failures re-occurring |
| Developer (IC)         | Context-switching to diagnose failures        |
| Engineering Manager    | Lack of data to drive process improvements   |
| SRE                    | Blind spots in error budget tracking         |

## Scope
### In Scope
- All GitHub Actions, GitLab CI/CD, CircleCI, and Jenkins pipelines originating from our organization’s git repos.
- Failures triggered in the last 90 days; searchable archive.
- First-class root causes: flaky tests, infra quota, syntax error, plugin mis-configuration, test data, environment drift.
- Basic trend charts (weekly rollup) and filter-by-repo-team.

### Out of Scope
- Pipelines outside the org’s git repos.
- Failures older than 90 days at GA.
- Custom root-cause taxonomies defined by individual teams (defer until v2).
- Auto-retry or auto-fix workflows (defer until v3).
- Security scanning of pipeline artifacts.

## Functional Requirements

| ID   | Requirement                                                                 | Priority |
|------|-----------------------------------------------------------------------------|----------|
| FR-1 | Ingest real-time failure events from GitHub Actions, GitLab CI/CD, CircleCI, Jenkins. | P0       |
| FR-2 | Display failures in reverse-chronological table; columns: timestamp, repo, pipeline ID, stage, root-cause label, suggested next step. | P0       |
| FR-3 | Root-cause classifier: assign one of the 6 canonical labels listed in Scope. | P0       |
| FR-4 | Tooltip exposed on root-cause label showing the classifier’s confidence score and excerpt of log lines that triggered the label. | P1       |
| FR-5 | Trend chart: time-series showing absolute failure count and % of total jobs that failed, aggregated weekly. | P1       |
| FR-6 | Filter pane: repo, team, root-cause label, time window (last 7/30/90d), stage name. | P1       |
| FR-7 | Export: copy failure record to clipboard as markdown table row; JSON bulk export for offline analysis. | P2       |

## Acceptance Criteria

| Item                          | Criteria                                                                 |
|-------------------------------|-------------------------------------------------------------------------|
| Event ingestion               | Within 5 minutes of pipeline completion, failure events appear in dashboard for all 4 supported CI/CD systems. |
| Root-cause labelling          | ≥ 90 % precision on eval set of 200 labelled failures curated by DevOps. |
| Real-time liveness            | No intervention required; failures appear at rate ≤ pipeline churn.     |
| Search & filter               | All filters listed in FR-6 work without errors.                         |
| Trend chart                   | Weekly roll-ups rendered within 10 s; updates within 1 hour of new data.|
| Export                        | Clipboard & JSON exports contain all table columns and timestamp.       |
| Performance                   | Dashboard loads ≤ 2 s on internal AWS network with < 20 % error rate.    |