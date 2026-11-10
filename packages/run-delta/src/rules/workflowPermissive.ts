/**
 * rules/workflowPermissive.ts — `workflow-permissive` (security, warn; C5.6): a GitHub workflow that
 * triggers on `pull_request_target` (fork code with the base repo's secrets) or grants
 * `permissions: write-all`. Patterns are the `insecureConfig['workflow-permissive']` registry row.
 */

import { configPatternRule, isWorkflowPath } from './support/configRule.js';

export const workflowPermissive = configPatternRule({ id: 'workflow-permissive', severity: 'warn', files: isWorkflowPath });
