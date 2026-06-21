/**
 * Single source of truth for classifying an `llm_usage_log` row by WHO produced
 * it, from the agent-attribution columns added in migration 0096:
 *   - `agent_host_id`  set  → an ON-PREM self-hosted host executed the call
 *   - `cloud_agent_ref`/`execution_id` set → a CLOUD agent run produced it
 *   - otherwise → a raw WEB / SDK gateway call (chat/image, no agent context)
 *
 * Both the manager dashboard (`/api/dashboard/usage`) and the public gateway
 * usage endpoint (`/v1/usage`) classify the SAME way — keep this the only
 * definition so the two surfaces can never disagree (DRY).
 */

import { sql } from 'drizzle-orm';
import { llmUsageLog } from '../../infrastructure/database/schema';

export type UsageSourceKind = 'cloud' | 'on-prem' | 'web';

/** Drizzle SQL CASE expression — embeddable in both the query-builder and raw
 *  `db.execute(sql\`…\`)` queries (it renders fully-qualified column refs). */
export const USAGE_KIND = sql<UsageSourceKind>`
  case
    when ${llmUsageLog.agentHostId} is not null then 'on-prem'
    when ${llmUsageLog.cloudAgentRef} is not null or ${llmUsageLog.executionId} is not null then 'cloud'
    else 'web'
  end`;
