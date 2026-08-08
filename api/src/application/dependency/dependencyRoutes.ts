/**
 * Dependency Resolution API Routes
 *
 * Provides endpoints for dependency analysis, blocker detection, and resolution suggestions.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/postgres-js/http';
import { getDependencyResolutionService } from './DependencyResolutionService';
import {
  DependencyReport,
  CriticalPath,
  DependencyBlocker,
} from './types';

// Health check route
export function healthCheck(_req: Request, res: Response): void {
  res.json({ status: 'ok', service: 'dependency-resolution' });
}

// Get dependency report
export function getDependencyReport(req: Request, res: Response): void {
  const projectId = z.coerce.number().parse(req.params.projectId);
  const stalenessDays = req.query.stalenessDays
    ? z.coerce.number().min(1).parse(req.query.stalenessDays)
    : 3;

  const db = drizzle((req as any).db); // Using shared db instance
  const service = getDependencyResolutionService(db);

  service.generateReport(projectId, stalenessDays)
    .then((report: DependencyReport) => {
      res.json(report);
    })
    .catch((err: Error) => {
      res.status(500).json({ error: err.message });
    });
}

// Get critical path only
export function getCriticalPath(req: Request, res: Response): void {
  const projectId = z.coerce.number().parse(req.params.projectId);

  const db = drizzle((req as any).db);
  const service = getDependencyResolutionService(db);

  service.computeCriticalPath(projectId)
    .then((criticalPath: CriticalPath | null) => {
      if (!criticalPath) {
        res.status(404).json({ error: 'No critical path found' });
        return;
      }
      res.json(criticalPath);
    })
    .catch((err: Error) => {
      res.status(500).json({ error: err.message });
    });
}

// Detect blockers (public helper, not tied to critical path)
export function detectBlockers(req: Request, res: Response): void {
  const projectId = z.coerce.number().parse(req.params.projectId);
  const stalenessDays = req.query.stalenessDays
    ? z.coerce.number().min(1).parse(req.query.stalenessDays)
    : 3;

  const db = drizzle((req as any).db);
  const service = getDependencyResolutionService(db);

  // Compute and pass critical path for the request; detectBlockers will use it
  service.computeCriticalPath(projectId)
    .then((criticalPath: CriticalPath | null) => {
      if (!criticalPath) {
        res.status(404).json({ error: 'No critical path found' });
        return;
      }

      return service.detectBlockers(projectId, criticalPath, stalenessDays);
    })
    .then((blockers: DependencyBlocker[]) => {
      res.json({
        projectId,
        totalBlockers: blockers.length,
        blockers,
      });
    })
    .catch((err: Error) => {
      res.status(500).json({ error: err.message });
    });
}

// Record resolution
export function recordResolution(req: Request, res: Response): void {
  const taskId = z.coerce.number().parse(req.params.taskId);
  const blockerTaskId = z.coerce.number().parse(req.params.blockerTaskId);

  const body = z.object({
    solutionEffortMinutes: z.coerce.number().min(0),
    confidence: z.enum(['low', 'medium', 'high']),
    resolutionDurationMinutes: z.coerce.number().min(0).optional(),
    notes: z.string().optional(),
  }).parse(req.body);

  const db = drizzle((req as any).db);
  const service = getDependencyResolutionService(db);

  service.recordResolution(
    taskId,
    blockerTaskId,
    body.solutionEffortMinutes,
    body.confidence,
    body.resolutionDurationMinutes ?? 0
  )
    .then(() => {
      res.status(204).send();
    })
    .catch((err: Error) => {
      res.status(500).json({ error: err.message });
    });
}

// Clear expired cache
export function clearCache(req: Request, res: Response): void {
  const db = drizzle((req as any).db);
  const service = getDependencyResolutionService(db);

  service.clearExpiredCache()
    .then((deletedCount: number) => {
      res.json({ deletedCount });
    })
    .catch((err: Error) => {
      res.status(500).json({ error: err.message });
    });
}

// Simple error middleware (no pre-existing error-middleware.ts in this branch)
export function dependencyErrorMiddleware(err: Error, _req: Request, res: Response, _next: Function): void {
  console.error('[dependencyRoutes Error]:', err);
  res.status(500).json({ error: err.message });
}

// Route definitions
export function createDependencyRoutes(): Router {
  const router = Router();

  router.get('/health', healthCheck);

  router.get('/projects/:projectId/report', getDependencyReport);
  router.get('/projects/:projectId/critical-path', getCriticalPath);
  router.get('/projects/:projectId/blockers', detectBlockers);

  router.post('/record/:taskId/:blockerTaskId', recordResolution);
  router.post('/cache/clear', clearCache);

  // CORS support (shared middleware requirement)
  router((req: Request, res: Response, next: Function): void => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  return router;
}