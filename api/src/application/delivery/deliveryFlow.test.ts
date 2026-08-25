/**
 * Delivery-flow invariants (PRD 19 §9 — action items, estimates, sprint cost,
 * approval chains).
 *
 * Each of these is a rule that fails a TEAM rather than a build:
 *
 *   - promotion must be one-way, or a retro claims credit for work that was
 *     already tracked somewhere else;
 *   - `is_current` must be maintained by exactly one writer, or two estimates
 *     both claim to be the estimate;
 *   - approval steps must be sequential, or Legal signs before Finance has
 *     changed what Legal is reviewing;
 *   - a rejection must end the chain, or somebody approves step 3 of a request
 *     that was rejected at step 1.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTION_STATUSES, ActionItemError, isActionStatus } from './actionItems';
import { AgileCostError, ESTIMATE_UNITS, isEstimateUnit } from './agileCost';
import { APPROVAL_STATES, ApprovalChainError } from '../approval/approvalChain';

const read = (p: string) => readFileSync(p, 'utf8').split(String.fromCharCode(13)).join('');
const actions = read(resolve(__dirname, 'actionItems.ts'));
const cost = read(resolve(__dirname, 'agileCost.ts'));
const chain = read(resolve(__dirname, '..', 'approval', 'approvalChain.ts'));
const routes = read(resolve(__dirname, '..', '..', 'presentation', 'routes', 'deliveryFlowRoutes.ts'));

const fn = (src: string, name: string): string => {
  const at = src.indexOf(`export async function ${name}`);
  expect(at, `${name} should exist`).toBeGreaterThan(-1);
  const rest = src.slice(at + 10);
  const end = rest.indexOf('\nexport ');
  return end === -1 ? rest : rest.slice(0, end);
};

describe('vocabularies are closed', () => {
  it('keeps dropped distinct from done', () => {
    expect([...ACTION_STATUSES]).toEqual(['open', 'in_progress', 'done', 'dropped']);
    expect(isActionStatus('dropped')).toBe(true);
    expect(isActionStatus('cancelled')).toBe(false);
  });

  it('declares the estimate units and rejects anything else', () => {
    expect([...ESTIMATE_UNITS]).toEqual(['points', 'hours', 'days', 'tshirt']);
    expect(isEstimateUnit('points')).toBe(true);
    expect(isEstimateUnit('story-points')).toBe(false);
  });

  it('declares the four approval states', () => {
    expect([...APPROVAL_STATES]).toEqual(['waiting', 'active', 'done', 'skipped']);
  });

  it('gives every error a status the route can return', () => {
    expect(new ActionItemError('x').status).toBe(400);
    expect(new AgileCostError('x', 404).status).toBe(404);
    expect(new ApprovalChainError('x', 409).status).toBe(409);
  });
});

describe('promotion is a one-way door', () => {
  const body = fn(actions, 'promoteToWorkItem');

  it('only sets the pointer when it is currently null', () => {
    expect(body).toContain('isNull(actionItems.promotedWorkItemRef)');
  });

  it('distinguishes not-found from already-promoted', () => {
    expect(body).toContain("throw new ActionItemError('action item not found', 404)");
    expect(body).toContain('already promoted to');
  });
});

describe('follow-through reports dropped separately from done', () => {
  it('counts them as different outcomes', () => {
    const body = fn(actions, 'sourceFollowThrough');
    expect(body).toContain("filter (where ${actionItems.status} = 'done')");
    expect(body).toContain("filter (where ${actionItems.status} = 'dropped')");
  });

  it('counts overdue against open items only', () => {
    const body = fn(actions, 'sourceFollowThrough');
    expect(body).toContain("in ('open','in_progress') and ${actionItems.dueAt} < now()");
  });
});

describe('an estimate is a history, not a field', () => {
  const body = fn(cost, 'recordEstimate');

  it('demotes the previous current estimate and inserts in one transaction', () => {
    expect(body).toContain('db.transaction');
    expect(body).toContain('.set({ isCurrent: false })');
    expect(body).toContain('isCurrent: true');
  });

  it('requires a value for numeric units and a size for tshirt', () => {
    expect(body).toContain('a tshirt estimate needs a tshirt size');
    expect(body).toContain('estimate needs a numeric value');
  });

  it('excludes tshirt rows from the accuracy rollup rather than coercing them', () => {
    expect(fn(cost, 'estimateAccuracy')).toContain("unit} <> 'tshirt'");
  });

  it('groups accuracy by estimator kind, which is the question worth asking', () => {
    expect(fn(cost, 'estimateAccuracy')).toContain('groupBy(taskEffortEstimates.estimatorKind');
  });
});

describe('sprint cost is stamped, not derived on read', () => {
  it('moves computed_at forward on every stamp', () => {
    expect(fn(cost, 'stampSprintCost')).toContain('computedAt: new Date()');
  });

  it('reads back what was stamped rather than recomputing', () => {
    const body = fn(cost, 'sprintEconomics');
    expect(body).toContain('.from(sprintFinancialImpact)');
    expect(body).not.toContain('db.transaction');
  });

  it('returns a null value ratio when nothing was priced, never zero', () => {
    const body = fn(cost, 'sprintEconomics');
    expect(body).toContain('valueRatio: delivered === null || total === 0 ? null :');
  });
});

describe('approval steps are sequential and enforced', () => {
  it('activates only the lowest waiting step', () => {
    expect(chain).toContain('min(${approvalActions.step})');
  });

  it('refuses a decision from an approver who is not active', () => {
    const body = fn(chain, 'act');
    expect(body).toContain("eq(approvalActions.state, 'active')");
    expect(body).toContain("it is not this approver's turn");
  });

  it('ends the chain on a rejection instead of leaving rows waiting', () => {
    const body = fn(chain, 'act');
    expect(body).toContain("inArray(approvalActions.state, ['waiting', 'active'])");
  });

  it('advances only once every approver on the active step has acted', () => {
    expect(fn(chain, 'act')).toContain('if ((remaining?.n ?? 0) === 0) await activateNextStep');
  });

  it('derives the outcome from the rows rather than storing it', () => {
    const body = fn(chain, 'chainState');
    expect(body).toContain("outcome = skipped ? ('rejected' as const)");
    expect(body).not.toContain('.set({ outcome');
  });

  it('never erases a decision already made when cancelling', () => {
    expect(fn(chain, 'cancelChain')).toContain("ne(approvalActions.state, 'done')");
  });

  it('enrols idempotently, so re-applying a policy is a no-op', () => {
    expect(fn(chain, 'openChain')).toContain('.onConflictDoNothing({');
  });
});

describe('the routes keep the merge honest', () => {
  it('registers literal action-item paths before the :id route', () => {
    expect(routes.indexOf("'/action-items/overdue'")).toBeLessThan(routes.indexOf("'/action-items/:id'"));
    expect(routes.indexOf("'/action-items/follow-through'")).toBeLessThan(routes.indexOf("'/action-items/:id'"));
  });

  it('keeps capture and approval at member, and assertions about others at MANAGER', () => {
    expect(routes).toContain("router.post('/action-items', (c)");
    expect(routes).toContain("router.post('/approvals/:kind/:ref/act', (c)");
    expect(routes).toContain("router.put('/sprints/:sprintRef/cost', manager");
    expect(routes).toContain("router.post('/approvals/:kind/:ref', manager");
  });

  it('requires an explicit boolean verdict rather than defaulting to approve', () => {
    expect(routes).toContain("if (typeof body.approved !== 'boolean')");
  });
});

describe('the merge added no schema', () => {
  it('touches only tables that already existed', () => {
    expect(actions).toContain('actionItems');
    expect(cost).toContain('taskEffortEstimates');
    expect(cost).toContain('sprintFinancialImpact');
    expect(chain).toContain('approvalActions');
  });

  it('does not resurrect kanban_columns or release_plans', () => {
    // Both are duplicates of a richer Builderforce owner and are `transform`
    // rather than `build` — giving either a feature path would create a second
    // answer to a question the platform already answers.
    for (const src of [actions, cost, chain, routes]) {
      expect(src).not.toContain('kanbanColumns');
      expect(src).not.toContain('releasePlans');
    }
  });
});
