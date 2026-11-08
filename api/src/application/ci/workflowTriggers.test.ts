import { describe, expect, it } from 'vitest';
import { workflowTriggersOnPullRequest } from './workflowTriggers';

describe('workflowTriggersOnPullRequest', () => {
  it('reads the scalar form', () => {
    expect(workflowTriggersOnPullRequest('name: CI\non: pull_request\njobs: {}')).toBe(true);
    expect(workflowTriggersOnPullRequest('on: push\n')).toBe(false);
  });
  it('reads the flow and block list forms', () => {
    expect(workflowTriggersOnPullRequest('on: [push, pull_request]\n')).toBe(true);
    expect(workflowTriggersOnPullRequest('on:\n  - push\n  - pull_request\n')).toBe(true);
    expect(workflowTriggersOnPullRequest('on: [push, workflow_dispatch]\n')).toBe(false);
  });
  it('reads the map form, with filters', () => {
    expect(workflowTriggersOnPullRequest('on:\n  pull_request:\n    branches: [main]\n  push:\n    branches: [main]\njobs: {}')).toBe(true);
    expect(workflowTriggersOnPullRequest('on:\n  push:\n    branches: [main]\njobs:\n  pull_request:\n    runs-on: x')).toBe(false);
  });
  it('reads a block list at column 0 and the flow-map form', () => {
    expect(workflowTriggersOnPullRequest('on:\n- push\n- pull_request\njobs: {}')).toBe(true);
    expect(workflowTriggersOnPullRequest('on:\n- push\njobs:\n  - pull_request\n')).toBe(false);
    expect(workflowTriggersOnPullRequest('on: { pull_request: { branches: [main] }, push: {} }\n')).toBe(true);
    expect(workflowTriggersOnPullRequest('on: { push: { branches: [pull_request] } }\n')).toBe(false);
  });
  it('is false for push-only workflows, comments and files with no trigger', () => {
    expect(workflowTriggersOnPullRequest('on:\n  push:\n    branches: [main]\n  # pull_request:\n')).toBe(false);
    expect(workflowTriggersOnPullRequest('name: x\n')).toBe(false);
    expect(workflowTriggersOnPullRequest('')).toBe(false);
  });
});

describe('workflowTriggersOnPullRequest - branch and path filters', () => {
  const on = (filters: string) => `on:\n  pull_request:\n${filters}\njobs: {}\n`;
  it('regression: Minor 6 - a `branches` filter is checked against the base branch', () => {
    expect(workflowTriggersOnPullRequest(on('    branches: [main]'), 'main')).toBe(true);
    expect(workflowTriggersOnPullRequest(on('    branches: [release/*]'), 'main')).toBe(false);
    expect(workflowTriggersOnPullRequest(on('    branches: [release/*]'), 'release/1.2')).toBe(true);
    expect(workflowTriggersOnPullRequest(on('    branches: [release/*]'), 'release/1/2')).toBe(false);
    expect(workflowTriggersOnPullRequest(on('    branches:\n      - "feature/**"'), 'feature/a/b')).toBe(true);
  });
  it('regression: Minor 6 - `branches-ignore` and `!` patterns exclude the base branch', () => {
    expect(workflowTriggersOnPullRequest(on('    branches-ignore: [main]'), 'main')).toBe(false);
    expect(workflowTriggersOnPullRequest(on('    branches-ignore: [main]'), 'develop')).toBe(true);
    expect(workflowTriggersOnPullRequest(on('    branches: ["**", "!docs/**"]'), 'docs/x')).toBe(false);
  });
  it('regression: Minor 6 - a `paths` filter is unknown (the workflow may not fire), which is not "will fire"', () => {
    expect(workflowTriggersOnPullRequest(on('    paths: ["src/**"]'), 'main')).toBe(false);
    expect(workflowTriggersOnPullRequest(on('    paths-ignore:\n      - "docs/**"'), 'main')).toBe(false);
    expect(workflowTriggersOnPullRequest('on: { pull_request: { branches: [main], paths: [a] } }\n', 'main')).toBe(false);
  });
  it('reads the filters of the inline map form, and applies none without a base branch', () => {
    expect(workflowTriggersOnPullRequest('on: { pull_request: { branches: [main] } }\n', 'main')).toBe(true);
    expect(workflowTriggersOnPullRequest('on: { pull_request: { branches: [main] } }\n', 'dev')).toBe(false);
    expect(workflowTriggersOnPullRequest(on('    branches: [release]'))).toBe(true);
  });
});
