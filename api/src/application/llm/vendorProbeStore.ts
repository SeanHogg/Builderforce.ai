/**
 * The vendor health-probe write model — one row per probe run.
 *
 * WHY IT IS IN THE APPLICATION LAYER. It lived in `presentation/routes/adminRoutes`
 * and `application/llm/vendorHealthCron` imported it from there, which made an HTTP
 * adapter load-bearing for a cron sweep (see `check-application-layering`). The
 * manual admin route and the cron handler now both write through here, so the two
 * triggers cannot drift on what a probe row contains.
 */
import { llmHealthProbes } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { VendorProbeResult } from './vendorHealthProbe';

/** Persist one health-probe run. Shared by the manual route and the cron handler.
 *  `modelsJson` is a JSONB column ([1449]) — pass the JS array; Drizzle encodes it. */
export async function persistProbe(
  db: Db,
  result: VendorProbeResult,
  trigger: 'manual' | 'cron',
): Promise<void> {
  await db.insert(llmHealthProbes).values({
    vendor:       result.vendor,
    status:       result.status,
    probedCount:  result.probedCount,
    okCount:      result.okCount,
    failedCount:  result.failedCount,
    latencyMs:    result.latencyMs,
    modelsJson:   result.models,
    trigger,
  });
}
