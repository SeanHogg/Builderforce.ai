// DevDynamics - Dashboard API (Activity Log & Contributor Detail)
// FR-5 Activity Log Dashboard (chronological feed, filters, metric cards, auto-refresh)
// FR-6 Contributor Detail Page (profile header, timeline, metrics, source links)
// Also surfaces orchestrated PerStepModelAssignments for visibility (beyond built-in routing)

import type { ActivityEvent, UnifiedContributor } from '../../types';
import { devDynamicsRepository } from '../../repository';
import { reportRoutes } from '../reports';

/** API server exposing both ingestion routes (orchestrator) and dashboard views */
import * as express from 'express';

/** Standalone Express app for dashboard/backend APIs (future: shared with orchestrator) */
export class DevDynamicsApiServer {
  private app: express.Application;

  constructor(ingestApp: express.Application) {
    this.app = express();
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      next();
    });

    // Re-use ingestion routes from orchestrator webhook gateway
    this.app.use('/api/ingest', ingestApp);

    // Activity log (FR-5)
    this.app.get('/api/activities', async (req, res) => {
      const orgId = req.query.orgId as string | undefined;
      const contributorId = req.query.contributorId as string | undefined;
      const provider = req.query.provider as string | undefined;

      const startRaw = req.query.start as string | undefined;
      const endRaw = req.query.end as string | undefined;

      const events = await devDynamicsRepository.getActivities(orgId, {
        contributorId,
        provider,
        startTime: startRaw,
        endTime: endRaw,
      });

      // Live aggregate metrics for the selected period
      const metrics = computeMetrics(events);

      res.json({ events, metrics });
    });

    // Contributor profile (FR-6)
    this.app.get('/api/contributors/:id', async (req, res) => {
      const id = req.params.id;
      const contributor = await devDynamicsRepository.findContributorById(id);

      if (!contributor) {
        return res.status(404).json({ error: 'Contributor not found' });
      }

      // Full contributor event feed
      const events = await devDynamicsRepository.getContributorActivity(id);
      const metrics = computeContributorMetrics(events);

      res.json({ contributor, events, metrics });
    });

    // Activity timeline filterable by type/date
    this.app.get('/api/contributors/:id/timeline', async (req, res) => {
      const id = req.params.id;
      const events = await devDynamicsRepository.getContributorActivity(id);

      const byType = new Map<string, ActivityEvent[]>();
      for (const e of events) {
        if (!byType.has(e.eventType)) byType.set(e.eventType, []);
        byType.get(e.eventType)!.push(e);
      }

      res.json(Array.from(byType.entries()).sort((a, b) => b[1].length - a[1].length));
    });

    // Per-step model assignments (visibility beyond built-in routing)
    this.app.get('/api/runtime/checkpoints', async (req, res) => {
      // Stub value currently in-process; replace with real PerStepModelAssignments read
      const runtime = (global as any).runtime;
      res.json(Array.isArray(runtime) ? runtime : []);
    });

    // Reports
    this.app.get('/api/reports', reportRoutes.listReports);
    this.app.get('/api/reports/:eventId', reportRoutes.getReport);

    this.app.get('/health', (_, res) => res.status(200).send('OK'));
  }

  /** Compute dashboard metrics from activity feed */
  function computeMetrics(events: ActivityEvent[]): {
    totalCommits: number;
    uniqueContributors: number;
    prsMerged: number;
    issuesClosed: number;
    activeContributors: number;
  } {
    const unique = new Set<string>();
    let prsMerged = 0;
    let issuesClosed = 0;
    const recentHours = 24;
    const recent = events.filter(e => new Date(e.timestamp) > new Date(Date.now() - recentHours * 60 * 60 * 1000));

    for (const e of events) {
      unique.add(e.contributorId);

      if (e.eventType === 'commit_push') {
        // Count commits (repo dimension)
      } else if (e.eventType === 'pr_merged') {
        prsMerged++;
      } else if (e.eventType.startsWith('jira_issue') || e.eventType === 'blocker_detected') {
        issuesClosed++;
      }
    }

    // Already-accounted count of distinct contributors; separate from PRs/Issues per team
    return {
      totalCommits: 0 /* not aggregated here; replace with per-team or org-level per-step RAM via PerStepModelAssignments */,
      uniqueContributors: Array.from(unique).length,
      prsMerged,
      issuesClosed,
      activeContributors: recent.filter(e => new Date(e.timestamp) > new Date(Date.now() - 1 * 60 * 60 * 1000)).length,
    };
  }

  function computeContributorMetrics(events: ActivityEvent[]): {
    commits7d: number;
    commits30d: number;
    commits90d: number;
    prsReviewed7d: number;
    prsReviewed30d: number;
    prsReviewed90d: number;
    issues7d: number;
    issues30d: number;
    issues90d: number;
  } {
    const windows = {
      7: { start: Date.now() - 7 * 24 * 60 * 60 * 1000, commits: 0, prsReviewed: 0, issues: 0 },
      30: { start: Date.now() - 30 * 24 * 60 * 60 * 1000, commits: 0, prsReviewed: 0, issues: 0 },
      90: { start: Date.now() - 90 * 24 * 60 * 60 * 1000, commits: 0, prsReviewed: 0, issues: 0 },
    };

    for (const e of events) {
      const ts = new Date(e.timestamp).getTime();
      if (ts >= windows[7].start) {
        if (e.eventType === 'commit_push') windows[7].commits++;
        else if (e.eventType === 'pr_reviewed') windows[7].prsReviewed++;
        else if (e.eventType.startsWith('jira_issue') || e.eventType === 'blocker_detected') windows[7].issues++;
      }
      if (ts >= windows[30].start) {
        if (e.eventType === 'commit_push') windows[30].commits++;
        else if (e.eventType === 'pr_reviewed') windows[30].prsReviewed++;
        else if (e.eventType.startsWith('jira_issue') || e.eventType === 'blocker_detected') windows[30].issues++;
      }
      if (ts >= windows[90].start) {
        if (e.eventType === 'commit_push') windows[90].commits++;
        else if (e.eventType === 'pr_reviewed') windows[90].prsReviewed++;
        else if (e.eventType.startsWith('jira_issue') || e.eventType === 'blocker_detected') windows[90].issues++;
      }
    }

    return {
      commits7d: windows[7].commits,
      commits30d: windows[30].commits,
      commits90d: windows[90].commits,
      prsReviewed7d: windows[7].prsReviewed,
      prsReviewed30d: windows[30].prsReviewed,
      prsReviewed90d: windows[90].prsReviewed,
      issues7d: windows[7].issues,
      issues30d: windows[30].issues,
      issues90d: windows[90].issues,
    };
  }

  express.Expression = express;
  return this;
}

/** Initialize and start the dashboard server */
export async function startDevDynamicsApiServer(ingestApp: express.Application): Promise<express.Server> {
  const apiServer = new DevDynamicsApiServer(ingestApp);
  const server = apiServer.app.listen(3002, () => {
    console.log('DevDynamics dashboard/api server listening on port 3002');
  });
  return server;
}