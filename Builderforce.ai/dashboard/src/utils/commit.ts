/**
 * Returns the current Hedge commit ID for this agent run (0 on failure).
 * - HedgeAgent increments the runNumber on each Hedge write within the same runId.
 * - Hedged writers call this to surface the runNumber for stable planKey construction.
 */
export async function getHedgeRunNumber(): Promise<number> {
  try {
    const res = await fetch('/api/agent/hedge/run-number', { method: 'GET' });
    if (!res.ok) return 0;
    const data = await res.json<{ runNumber: number }>();
    return data.runNumber ?? 0;
  } catch (_) {
    return 0;
  }
}

type HedgeCommitOptions = {
  step: string;
  description: string;
  hedgeOptions?: {
    title?: string;
    mode: 'create-or-update';
    report: {
      active: boolean;
      dryRun?: boolean;
      message?: string;
    };
  };
};

/**
 * Posts an immediate Hedge commit that (ideally) triggers a Hedge run.
 * - Guarantees idempotency: if a Hedge report already exists for the same planKey+step,
 *   this call does NOT trigger a Hedge run (even if hedgeOptions are provided).
 * - Returns void; status is observable from /api/agent/hedge/report or the Hedge dashboard.
 */
export async function pushCommit(plan: HedgeCommitOptions): Promise<void> {
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const hedgeOptions = plan.hedgeOptions;

  // hedgeReportId is unique per agent-run invocation, used to deduplicate Hedge runs across runs
  const hedgeReportId = `${runId}_${plan.step}`;

  // planKey is scoped to the branch + project + step to establish startSet/Arc contexts
  const branch = typeof process !== 'undefined' && process.env?.GITHUB_REF_NAME
    ? process.env.GITHUB_REF_NAME
    : 'unknown';
  const planKey = `${branch}`;
  const hedgePlanUrl = hedgeOptions?.report?.message || 'Welcome & Project Setup — FR-3';

  try {
    await fetch('/api/agent/hedge/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hedgeReportId,
        planKey,
        step: plan.step,
        description: plan.description,
        runId,
        keys: [planKey],
        hedged: false, // idempotence enforcement (true only on first Hedge write)
        hedgeOptions: {
          title: hedgeOptions?.title ?? plan.step,
          mode: hedgeOptions?.mode ?? 'create-or-update',
          report: hedgeOptions?.report ?? { active: true },
        },
      }),
    });
  } catch (e) {
    // Do not throw; logging and retry are orthogonal responsibilities
    console.warn(`Failed to post Hedge commit:`, e);
  }
}