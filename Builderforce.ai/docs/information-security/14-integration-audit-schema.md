# Integration Audit & Health Dashboard — Schema Model

This document defines the database schema for the integration audit and health dashboard feature. It includes models for integration connections, health data, gaps, and score calculations.

## Data Model Overview

The primary audit tables:

1. `IntegrationConnections` — Tracks which integrations are connected to the system
2. `IntegrationChecks` — Individual validation checks per integration
3. `IntegrationGaps` — Identified issues and gaps
4. `IntegrationCompletenessScores` — Calculated data completeness scores
5. `ServiceTierWeights` — Service tier-specific weight configurations for scoring

---

## Schema Definitions

### IntegrationConnections

Represents a connected third-party service integration (GitHub, Jira, Slack, etc.).

```prisma
model IntegrationConnection {
  id                String   @id @default(uuid())
  tenantId          String
  segmentId         String

  // Integration identity
  type              IntegrationType  @default(SOURCE_CONTROL)
  provider          IntegrationProvider
  externalId        String                    // provider-specific ID
  name              String

  // Connection metadata
  connectedAt       DateTime? @default(now())
  lastSync          DateTime?
  enabled           Boolean   @default(true)
  isPrimary         Boolean   @default(false)

  // Configuration (stored by provider)
  configuration     IntegrationConfiguration

  // Audit tracking
  healthCheckFailed Boolean  @default(false)
  healthCheckFailedAt DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([tenantId, segmentId])
  @@index([tenantId, segmentId, type])
  @@index([tenantId, segmentId, connectedAt])
  @@map("integration_connections")
}

enum IntegrationType {
  SOURCE_CONTROL
  ISSUE_TRACKER
  COMMUNICATION
  CI_CD
  MONITORING
  CALENDAR
}

enum IntegrationProvider {
  GITHUB
  GITLAB
  BITBUCKET
  JIRA
  LINEAR
  SLACK
  MICROSOFT_TEAMS
  GITHUB_ACTIONS
  JENKINS
  CIRCLECI
  DATADOG
  PAGERDUTY
  GOOGLE_CALENDAR
  OUTLOOK
  ASANA
}

model IntegrationConfiguration {
  id              String   @id @default(uuid())
  integrationId   String   @unique
  tenantId        String
  segmentId       String

  // Structured by provider
  webhooks        Json?    // { github: { repo_id: ..., events: [...] } }
  channelLinks    Json?    // { slack: { channels: [...] } }
  repoRefs        Json?    // { id, fullName, defaultBranch } for source controls
  issueFilters    Json?    // { statuses: [...], priority: ... }
  deploymentHooks Json?    // { events: [...], targetEnvironment: ... }
  incidentAlerts  Json?    // { channels, thresholds }
  calendarSync    Json?    // { eventTypes: [...], filters: ... }

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([tenantId, segmentId])
  @@map("integration_configurations")
}
```

---

### IntegrationChecks

Individual validation checks performed on each integration (e.g., webhook trigger test, data flow verification).

```prisma
model IntegrationCheck {
  id        String   @id @default(uuid())
  tenantId  String
  segmentId String
  integrationId String

  checkType  String  // e.g., 'webhook_trigger', 'data_flow', 'recent_activity'
  name       String
  passed     Boolean @default(true)
  details    Json?
  occurredAt DateTime @default(now())

  @@index([tenantId, segmentId, integrationId])
  @@index([tenantId, segmentId, occurredAt])
  @@map("integration_checks")
}
```

---

### IntegrationGaps

Captures identified issues with lower severity gaps.

```prisma
model IntegrationGap {
  id           String   @id @default(uuid())
  tenantId     String
  segmentId    String
  integrationId String

  severity     GapSeverity  @default(MEDIUM)
  category     GapCategory
  description  String
  recommendation String

  detectedAt   DateTime @default(now())
  resolvedAt   DateTime?
  resolvedBy   String?  // userId or resolved_at

  @@index([tenantId, segmentId, integrationId])
  @@index([tenantId, segmentId, severity])
  @@index([tenantId, segmentId, detectedAt])
  @@map("integration_gaps")
}

enum GapSeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum GapCategory {
  WEBHOOK
  DATA_COMPLETENESS
  RATE_LIMIT
  CONFIGURATION
  STALE_DATA
  MISCONFIGURATION
}
```

---

### IntegrationCompletenessScores

Stores calculated data completeness scores (0-100) with component breakdown.

```prisma
model IntegrationCompletenessScore {
  id                  String   @id @default(uuid())
  tenantId            String
  segmentId           String
  integrationId       String   @unique

  totalWeightedScore  Decimal  @db.Decimal(5,2)  // 0-100
  maxPossibleScore    Decimal  @db.Decimal(5,2)  // 100

  breakdown           ScoreBreakdown

  lastCalculated      DateTime @default(now())
  calculatedBy        String   // 'system' or userId

  @@map("integration_completeness_scores")
}

model ScoreBreakdown {
  id   String            @id @default(uuid())
  scoreId  String        @unique

  expectedObjectsWeight  Decimal  @db.Decimal(5,2)
  expectedObjectsMatched Decimal @db.Decimal(5,2)
  recencyWeight          Decimal  @db.Decimal(5,2)
  recencyScore           Decimal  @db.Decimal(5,2)
  criticalityWeight      Decimal  @db.Decimal(5,2)
  criticalityScore       Decimal  @db.Decimal(5,2)

  lastModified           DateTime @updatedAt
  createdBy              String

  @@map("score_breakdowns")
}
```

---

### ServiceTierWeights

Stores weight configurations per service tier for calculating different criticality impact across integrations.

```prisma
model ServiceTierWeights {
  id          String   @id @default(uuid())
  tenantId    String   @unique
  tier        String   // 'FREE' | 'PRO' | 'ENTERPRISE'

  sourceControlWeight  Decimal @db.Decimal(5,4)  // e.g., 0.15
  issueTrackerWeight   Decimal @db.Decimal(5,4)  // e.g., 0.20
  communicationWeight  Decimal @db.Decimal(5,4)  // e.g., 0.10
  cicdWeight           Decimal @db.Decimal(5,4)  // e.g., 0.25
  monitoringWeight     Decimal @db.Decimal(5,4)  // e.g., 0.20
  calendarWeight       Decimal @db.Decimal(5,4)  // e.g., 0.10

  updatedAt DateTime @updatedAt

  @@map("service_tier_weights")
}
```

---

## Relations Summary

```
ServiceTierWeights 1──* IntegrationConnection (via tier and weights)
IntegrationConnection 1──* IntegrationChecks (one-to-many)
IntegrationConnection 1──* IntegrationGaps (one-to-many)
IntegrationConnection 1──* IntegrationCompletenessScore (one-to-one, unique)
IntegrationCompletenessScore 1──* ScoreBreakdown (one-to-one, unique)
```

---

## Default Weight Configurations (examples)

| Tier  | Source Control | Issue Tracker | Communication | CI/CD | Monitoring | Calendar |
|-------|----------------|--------------|--------------|-------|------------|----------|
| FREE  | 0.10           | 0.15         | 0.05         | 0.10  | 0.20       | 0.05     |
| PRO   | 0.15           | 0.20         | 0.10         | 0.25  | 0.15       | 0.10     |
| ENTERPRISE  | 0.15 | 0.20 | 0.10 | 0.25 | 0.15 | 0.10 |

These weights can be adjusted per tenant via the `ServiceTierWeights` model or immutable defaults in service code.