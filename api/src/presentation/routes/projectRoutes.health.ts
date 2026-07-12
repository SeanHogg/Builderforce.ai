import express, { Request, Response } from 'express';
import { logger } from 'shared';
import { NO_SESSION_FAIL } from '/api/src/auth/sessionAuth';
import { ProjectsService } from '/api/src/application/project/ProjectService';
import { computeCompositeHealthScore } from '/api/src/lib/compositeHealth';
import { sleep } from '/api/src/lib/promise';
import type { SubMetricRecord } from '/api/src/lib/compositeHealth';

const router = express.Router();

// ------------------------------------------------------------------
// GET /projects/:id/health
// ------------------------------------------------------------------
router.get('/projects/:id/health', async (req: Request, res: Response): Promise<void> => {
  if (NO_SESSION_FAIL(req, res)) return;
  const projectKey = req.params.id;
  const forceFresh = req.query.forceFresh === 'true';
  const tenantId = (req as any).tenantId as number | undefined;
  if (!tenantId) {
    res.status(401).json({ error: 'Missing tenantId' });
    return;
  }

  try {
    await sleep(10); // simulate async background processing
    // FIXME: implement a provider to fetch current sub-metrics from integrations (e.g., GitHub, Jira, PagerDuty, SonarQube, Snyk, Datadog)
    // Example mock:
    const subMetrics: SubMetricRecord[] = [];
    const result = computeCompositeHealthScore(subMetrics, (_) => false, undefined, undefined, [], null);
    res.json({
      score: Math.round(result.score),
      status: result.status,
      color: result.color,
      lastUpdatedAt: result.lastUpdatedAt,
      subMetrics: result.subMetrics,
      trend: result.trend,
    });
  } catch (e) {
    logger.error({ err: e as Error }, 'Failed to fetch project health for ' + projectKey);
    res.status(500).json({ error: 'Failed to fetch project health' });
  }
});

export { router };