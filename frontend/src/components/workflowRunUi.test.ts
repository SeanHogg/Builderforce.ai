import { describe, it, expect } from 'vitest';
import { isLiveWorkflowStatus } from './workflowRunUi';

describe('isLiveWorkflowStatus', () => {
  it('is true only while a run is still in flight', () => {
    expect(isLiveWorkflowStatus('pending')).toBe(true);
    expect(isLiveWorkflowStatus('running')).toBe(true);
    expect(isLiveWorkflowStatus('completed')).toBe(false);
    expect(isLiveWorkflowStatus('failed')).toBe(false);
    expect(isLiveWorkflowStatus('cancelled')).toBe(false);
    expect(isLiveWorkflowStatus(undefined)).toBe(false);
  });
});
