/**
 * The decision effects are registry DATA keyed by action type; these pin that the
 * three effects the PATCH route used to branch on are registered, and that a second
 * handler for one action type is refused rather than silently shadowing the first.
 */
import { describe, expect, it } from 'vitest';
import { approvalDecisionHandlerFor, registerApprovalDecisionHandler } from './approvalDecisionHandlers';
import { WORKFLOW_RUN_ACTION_TYPE } from '../workflow/workflowRunApproval';

describe('approval decision registry', () => {
  it('registers the run, workflow and mailbox effects', () => {
    expect(approvalDecisionHandlerFor('task.execution')).toBeTypeOf('function');
    expect(approvalDecisionHandlerFor(WORKFLOW_RUN_ACTION_TYPE)).toBeTypeOf('function');
    expect(approvalDecisionHandlerFor('mailbox.reply')).toBeTypeOf('function');
  });

  it('has no effect for a plain governance approval', () => {
    expect(approvalDecisionHandlerFor('deploy')).toBeNull();
  });

  it('refuses a duplicate registration', () => {
    expect(() => registerApprovalDecisionHandler('task.execution', async () => undefined)).toThrow(/already registered/);
  });
});
