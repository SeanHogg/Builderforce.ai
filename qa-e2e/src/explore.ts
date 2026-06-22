/**
 * Agentic Tester CLI (`npm run explore`) — one-shot LOCAL/manual drain: claim a
 * queued exploration, run it, exit. The actual work lives in runExploration.ts.
 * In PRODUCTION the platform dispatches the managed container (api/qa-container)
 * instead — this CLI is for local debugging.
 *
 * Env:
 *   BF_EXPLORATION_ID  optional — claim this specific exploration
 *   BF_PROJECT_ID      optional — claim the next queued exploration for a project
 *   (plus the BF_* auth vars consumed by bf.login — BF_AGENT_TOKEN in production)
 */

import { runExploration } from './runExploration';

runExploration().catch((err) => {
  console.error('[agentic-tester] fatal:', err);
  process.exit(1);
});
