/**
 * Agentic Tester CLI (`npm run explore`) — one-shot: claim a queued exploration,
 * run it, exit. The actual work lives in runExploration.ts (shared with the
 * container server in server.ts).
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
