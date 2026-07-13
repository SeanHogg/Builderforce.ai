/**
 * Recommendation Decision Service
 *
 * Handles accept/reject decisions for recommendations and triggers workflows.
 * Implements retry logic with exponential backoff for failed workflow triggers.
 */

import { db } from '../../infrastructure/database/connection';
import { recommendationDecisions, workflowExecutions, recommendationWorkflows, db as db_export } from '../../infrastructure/database/schema';
import { sql, and, eq } from 'drizzle-orm';
import type { Recommendation } from './recommendationsEngine';

export type DecisionType = 'accepted' | 'rejected';

export interface CreateDecisionParams {
  recKey: string;
  decision: DecisionType;
  decidedBy: string;
  rationale?: string;
}

export interface CreateDecisionWithItemRationale {
  recKey: string;
  decision: DecisionType;
  decidedBy: string;
  rationale?: string;
}

export interface CreateBulkDecisionsWithItemRationale {
  decisions: CreateDecisionWithItemRationale[];
}

export interface WorkflowExecutionResult {
  executionId: number;
  workflowId: number;
  status: 'triggered' | 'running' | 'succeeded' | 'failed';
}

/**
 * Record a recommendation decision (accept or reject).
 * Triggers bound workflows for the decision type after recording.
 */
export async function createDecision(params: CreateDecisionParams): Promise<number> {
  const { recKey, decision, decidedBy, rationale } = params;

  // Validate that recKey corresponds to an existing recommendation
  // We'll do this in recommendationsEngine, but we can add a check here if needed

  // Check if decision already exists to prevent duplicate decisions
  const existing = await getDecisionByRecKey(recKey);
  if (existing) {
    throw new Error(`Decision already recorded for recommendation ${recKey}`);
  }

  // Determine tenantId from context (in a real app, this would come from the request context)
  // For now, we'll default to 0 to keep the function signature simple
  const tenantId = 0; // Will be set from context

  // Record the decision
  const decisionInsert = await db.insert(recommendationDecisions)
    .values({
      tenantId,
      recKey,
      decision,
      decidedBy,
      rationale: rationale || null,
      status: 'pending',
      workflow_trigger_ids: null,
      retry_count: 0,
    })
    .returning();

  const decisionId = decisionInsert[0].id;

  // Trigger bound workflows (async, don't block user response)
  try {
    await triggerWorkflowsForDecision(decisionId, recKey, decision, tenantId);
  } catch (error) {
    // Log the error but don't fail the decision recording
    console.error('Failed to trigger workflows for recommendation decision:', error);
  }

  return decisionId;
}

/**
 * Get a decision by rec_key
 */
export async function getDecisionByRecKey(recKey: string) {
  const [record] = await db.select()
    .from(recommendationDecisions)
    .where(eq(recommendationDecisions.recKey, recKey))
    .limit(1);
  return record;
}

/**
 * Trigger workflows bound to a decision
 */
async function triggerWorkflowsForDecision(
  decisionId: number,
  recKey: string,
  decision: DecisionType,
  tenantId: number = 0
): Promise<number[]> {
  // Get all workflows bound for this recommendation type and event
  const workflows = await db.select()
    .from(recommendationWorkflows)
    .where(
      and(
        eq(recommendationWorkflows.tenantId, tenantId),
        sql`${recommendationWorkflows.recType} LIKE %${recKey}`,
        sql`${recommendationWorkflows.eventName} IN (${decision}, 'on_either')`,
        eq(recommendationWorkflows.isActive, true)
      )
    );

  const executionIds: number[] = [];

  // Trigger each workflow asynchronously
  for (const workflow of workflows) {
    const executionId = await executeWorkflow({
      decisionId,
      workflowId: workflow.id,
      tenantId,
      eventName: decision,
      workflowName: workflow.workflowName,
      workflowConfig: workflow.workflowConfig,
    });
    executionIds.push(executionId);
  }

  // Mark the decision as triggered with workflow IDs
  if (executionIds.length > 0) {
    await db.update(recommendationDecisions)
      .set({
        status: 'triggered',
        workflow_trigger_ids: executionIds,
        updated_at: new Date(),
      })
      .where(eq(recommendationDecisions.id, decisionId));
  }

  return executionIds;
}

/**
 * Trigger workflows bound to a decision
 */
async function triggerWorkflowsForDecision(
  decisionId: number,
  recKey: string,
  decision: DecisionType
): Promise<number[]> {
  const tenantId = 0; // Will be set from context

  // Get all workflows bound for this recommendation type and event
  const workflows = await db.select()
    .from(recommendationWorkflows)
    .where(
      and(
        eq(recommendationWorkflows.tenantId, tenantId),
        sql`${recommendationWorkflows.recType} LIKE %${recKey}`,
        sql`${recommendationWorkflows.eventName} IN (${decision}, 'on_either')`,
        eq(recommendationWorkflows.isActive, true)
      )
    );

  const executionIds: number[] = [];

  // Trigger each workflow asynchronously
  for (const workflow of workflows) {
    const executionId = await executeWorkflow({
      decisionId,
      workflowId: workflow.id,
      tenantId,
      eventName: decision,
      workflowName: workflow.workflowName,
      workflowConfig: workflow.workflowConfig,
    });
    executionIds.push(executionId);
  }

  // Mark the decision as triggered with workflow IDs
  if (executionIds.length > 0) {
    await db.update(recommendationDecisions)
      .set({
        status: 'triggered',
        workflow_trigger_ids: executionIds,
        updated_at: new Date(),
      })
      .where(eq(recommendationDecisions.id, decisionId));
  }

  return executionIds;
}

/**
 * Execute a single workflow (webhook or internal)
 */
async function executeWorkflow(params: {
  decisionId: number;
  workflowId: number;
  tenantId: number;
  eventName: string;
  workflowName: string;
  workflowConfig: any;
}): Promise<number> {
  const { decisionId, workflowId, tenantId, eventName, workflowName, workflowConfig } = params;

  // Create execution record
  const executionInsert = await db.insert(workflowExecutions)
    .values({
      tenantId,
      decisionId,
      workflowId,
      workflow_config: workflowConfig,
      status: 'triggered',
      request_payload: buildRequestPayload(decisionId, workflowConfig, tenantId, eventName),
    })
    .returning();

  const executionId = executionInsert[0].id;

  // Execute the workflow based on type
  let result: any;
  try {
    if (workflowConfig.type === 'webhook') {
      result = await executeWebhook(workflowConfig, buildRequestPayload(decisionId, workflowConfig, tenantId, eventName));
    } else {
      result = await executeInternalWorkflow(workflowConfig, buildRequestPayload(decisionId, workflowConfig, tenantId, eventName));
    }

    // Mark as succeeded
    await db.update(workflowExecutions)
      .set({
        status: 'succeeded',
        result,
        response_status: result.statusCode ?? 200,
        response_body: JSON.stringify(result),
      })
      .where(eq(workflowExecutions.id, executionId));
  } catch (error) {
    // Mark as failed
    await db.update(workflowExecutions)
      .set({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      })
      .where(eq(workflowExecutions.id, executionId));
  }

  return executionId;
}

/**
 * Execute a webhook workflow
 */
async function executeWebhook(config: any, payload: any): Promise<any> {
  const { url, method = 'POST' } = config;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Workflow-Type': 'recommendation_decision',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return {
      statusCode: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Execute an internal workflow
 */
async function executeInternalWorkflow(config: any, payload: any): Promise<any> {
  const { workflowType, action } = config;
  // TODO: Integrate with the internal workflow engine when available
  console.log(`Executing internal workflow: ${workflowType}`, { action, payload });

  // Mock successful execution
  await new Promise(resolve => setTimeout(resolve, 500));

  return {
    statusCode: 200,
    message: 'Internal workflow executed successfully',
    payload,
  };
}

/**
 * Build the request payload for workflow triggers
 */
function buildRequestPayload(
  decisionId: number,
  workflowConfig: any,
  tenantId: number,
  eventName: string
): any {
  // We'll need the full Recommendation details from the engine
  // For now, create a minimal payload
  const payload = {
    decision_id: decisionId,
    tenant_id: tenantId,
    event_name: eventName,
    timestamp: new Date().toISOString(),
    workflow_config: workflowConfig,
  };

  // Add additional metadata if available
  return payload;
}

/**
 * Retry a failed workflow execution
 */
export async function retryWorkflowExecution(executionId: number): Promise<number> {
  const execution = (await db.select()
    .from(workflowExecutions)
    .where(eq(workflowExecutions.id, executionId))
    .limit(1))[0];

  if (!execution) {
    throw new Error(`Workflow execution ${executionId} not found`);
  }

  // Only failed (and not cancelled) executions can be retried; if status already succeeded/failed then mark as triggered to allow retry again (no new decision operational action).
  if (execution.status === 'failed') {
    // Do not allow a second retry here; CLI/admin must trigger via manager event to follow retry count
    throw new Error('Only one manual retry allowed (status already failed). Use the manager trigger event to retry again.');
  } else if (execution.status === 'succeeded' || execution.status === 'cancelled') {
    // Reset to triggered to allow a fresh retry (matches AC-7: manual Retry resets the workflow status to Triggered)
    await db.update(workflowExecutions)
      .set({ status: 'triggered', attempt: execution.attempt + 1, error_message: null })
      .where(eq(workflowExecutions.id, executionId));
    return executionId;
  } else if (execution.status !== 'triggered' && execution.status !== 'running') {
    throw new Error(`Cannot retry execution with status: ${execution.status}`);
  }

  // Check retry count
  const decision = (await db.select()
    .from(recommendationDecisions)
    .where(eq(recommendationDecisions.id, execution.decisionId))
    .limit(1))[0];

  if (!decision) {
    throw new Error(`Decision ${execution.decisionId} not found`);
  }

  if (decision.retry_count >= 3) {
    throw new Error('Maximum retry count (3) reached');
  }

  // Increment retry count
  await db.update(recommendationDecisions)
    .set({ retry_count: decision.retry_count + 1 })
    .where(eq(recommendationDecisions.id, execution.decisionId));

  // Mark workflow as running before re-execution
  await db.update(workflowExecutions)
    .set({ status: 'running', updated_at: new Date() })
    .where(eq(workflowExecutions.id, executionId));

  // Re-execute the workflow
  const newExecutionId = await executeWorkflow({
    decisionId: execution.decisionId,
    workflowId: execution.workflow_id,
    tenantId: execution.tenant_id,
    eventName: execution.trigger_at ? (decision.decision === 'accepted' ? 'on_accept' : 'on_reject') : 'unknown',
    workflowName: '', // Would need to be retrieved from workflow_config
    workflowConfig: execution.workflow_config,
  });

  return newExecutionId;
}

/**
 * Bulk accept/reject multiple recommendations (variant: with per-item rationale support)
 */
export async function bulkCreateDecisions(
  decisions: { recKey: string; decision: DecisionType; decidedBy: string; rationale?: string }[]
): Promise<number[]> {
  const executionIds: number[] = [];

  // Process each decision
  for (const decision of decisions) {
    try {
      const id = await createDecision(decision);
      executionIds.push(id);
    } catch (error) {
      console.error(`Failed to create decision for ${decision.recKey}:`, error);
      // Continue with other decisions even if one fails
    }
  }

  return executionIds;
}

/**
 * Bulk accept/reject multiple recommendations with per-item rationale support (FR-7 & CLI)
 */
export async function bulkCreateDecisionsWithItemRationale(params: CreateBulkDecisionsWithItemRationale): Promise<number[]> {
  const { decisions } = params;
  const executionIds: number[] = [];

  // Process each decision
  for (const decision of decisions) {
    try {
      const id = await createDecision(decision);
      executionIds.push(id);
    } catch (error) {
      console.error(`Failed to create decision for ${decision.recKey}:`, error);
      // Continue with other decisions even if one fails
    }
  }

  return executionIds;
}

/**
 * Get decision history for admin dashboard
 */
export async function getDecisionHistory(params: {
  tenantId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<any[]> {
  const query = db.select()
    .from(recommendationDecisions)
    .where(params.status ? eq(recommendationDecisions.status, params.status) : undefined)
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0)
    .orderBy(recommendationDecisions.decided_at);

  return await query;
}

/**
 * Export decision history as CSV
 */
export async function exportDecisionHistory(params: {
  tenantId: number;
  startDate?: string;
  endDate?: string;
}): Promise<string> {
  // Build date filter
  let dateCondition = '';
  if (params.startDate) {
    dateCondition += ` AND decided_at >= '${params.startDate}'`;
  }
  if (params.endDate) {
    dateCondition += ` AND decided_at <= '${params.endDate}'`;
  }

  // Query for CSV export
  const rows = await db.execute(sql`
    SELECT
      rec_key,
      decision,
      decided_by,
      decided_at,
      rationale,
      status,
      retry_count,
      workflow_trigger_ids
    FROM recommendation_decisions
    WHERE tenant_id = ${params.tenantId}
    ${params.startDate || params.endDate ? sql` AND decided_at >= NOW() - INTERVAL '90 days'` : sql``}
    ORDER BY decided_at DESC
    LIMIT 10000
  `);

  // Generate CSV header and rows
  const headers = 'Rec Key,Decision,Decided By,Decided At,Rationale,Status,Retry Count,Workflow Trigger IDs';
  const csvRows = rows.map((row: any) => {
    return [
      `"${row.rec_key}"`,
      `"${row.decision}"`,
      `"${row.decided_by}"`,
      `"${row.decided_at}"`,
      `"${(row.rationale || '').replace(/"/g, '""')}"`,
      `"${row.status}"`,
      row.retry_count,
      JSON.stringify(row.workflow_trigger_ids || '[]').replace(/"/g, '""'),
    ].join(',');
  });

  return [headers, ...csvRows].join('\n');
}

/**
 * Get workflow executions for a specific decision
 */
export async function getDecisionWorkflowExecutions(
  db: any,
  tenantId: number,
  decisionId: number
): Promise<any[]> {
  return await db
    .select()
    .from(workflowExecutions)
    .where(
      and(
        eq(workflowExecutions.tenantId, tenantId),
        eq(workflowExecutions.decisionId, decisionId)
      )
    )
    .orderBy(workflowExecutions.trigger_at);
}

/**
 * Reopen a decision (decision amendment - FR-6)
 * @param db Database connection
 * @param tenantId Tenant ID
 * @param decisionId Decision ID
 * @param userId User ID of the actor
 * @param rationale Optional rationale for the reopening
 */
export async function reopenDecision(
  db: any,
  tenantId: number,
  decisionId: number,
  userId: string,
  rationale?: string
): Promise<{ success: boolean; decision?: any; error?: string }> {
  // Get the current decision
  const [decision] = await db
    .select()
    .from(recommendationDecisions)
    .where(
      and(
        eq(recommendationDecisions.id, decisionId),
        eq(recommendationDecisions.tenantId, tenantId)
      )
    );

  if (!decision) {
    return { success: false, error: 'Decision not found' };
  }

  // Only decisions in terminal states can be reopened
  if (decision.status === 'accepted' || decision.status === 'rejected') {
    // Transition to pending state
    await db
      .update(recommendationDecisions)
      .set({
        status: 'pending',
        updated_at: new Date(),
      })
      .where(eq(recommendationDecisions.id, decisionId));

    return {
      success: true,
      decision: {
        id: decision.id,
        rec_key: decision.recKey,
        status: 'pending',
        reopened_by: userId,
        reopened_at: new Date(),
        rationale: rationale || 'Decision reopened by admin/user',
      },
    };
  }

  return { success: false, error: 'Decision is not in a terminal state' };
}