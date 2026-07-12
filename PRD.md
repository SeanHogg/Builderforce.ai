> **PRD** — drafted by Ada (Sr. Product Mgr) · task #156
> _Each agent that updates this PRD signs its change below._

# Integration Hub - ingest data from PM/code tools

**As a PM/Leader**, I want the system to automatically ingest data from my project management and code tools during onboarding, so that the diagnostic is data-driven and not just opinion-based.

**Acceptance Criteria:**

1. Define the canonical integration set: Jira, GitHub, Linear, Slack, CI/CD (e.g. GitHub Actions), observability (e.g. Sentry, Datadog)
2. Build or reuse OAuth/token-based connectors for each
3. Ingest: task backlog, bug count/severity/trend, PR cycle time, build failure rate, deployment frequency, incident count, team velocity, resource allocation
4. Map ingested data to the diagnostic question categories (e.g. bug count → Quality & Bugs)
5. Surface ingested data in the diagnostic report and flag anomalies (e.g. "Bug count is 2x the 30-day average")
6. Allow manual override of ingested data

**Analysis Required:** Review existing platform integrations and determine what data is already available vs what needs to be built.