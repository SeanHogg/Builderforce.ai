/**
 * Canonical built-in job-function roles — the source of truth for the role
 * taxonomy (mirrors BUILTIN_PERSONAS / DEFAULT_SWIMLANES). Tenants extend this set
 * via the job_roles table; jobRoleService merges builtins + tenant rows on read.
 *
 * Keys align with the runtime agent-roles taxonomy (agent-runtime agent-roles.ts)
 * so a lane that requires role 'code-reviewer' maps cleanly to the reviewer agent.
 */
import type { JobRole } from './types';

export const BUILTIN_ROLES: JobRole[] = [
  { key: 'product-manager', name: 'Product Manager', discipline: 'product', icon: '🧭', color: 'indigo',
    description: 'Owns the why and the what — scope, priority, acceptance criteria.', builtin: true, position: 0 },
  { key: 'business-analyst', name: 'Business Analyst', discipline: 'product', icon: '📋', color: 'sky',
    description: 'Turns needs into clear, testable requirements and PRDs.', builtin: true, position: 1 },
  { key: 'architect', name: 'Architect', discipline: 'engineering', icon: '📐', color: 'violet',
    description: 'Reviews approach and implementation against the PRD; guards system design.', builtin: true, position: 2 },
  { key: 'developer', name: 'Developer', discipline: 'engineering', icon: '⚙️', color: 'blue',
    description: 'Implements the ticket and resolves review feedback.', builtin: true, position: 3 },
  { key: 'code-reviewer', name: 'Code Reviewer', discipline: 'engineering', icon: '🔍', color: 'teal',
    description: 'Reviews the diff for correctness, quality, and standards.', builtin: true, position: 4 },
  { key: 'qa-tester', name: 'QA / Tester', discipline: 'qa', icon: '🧪', color: 'amber',
    description: 'Verifies acceptance criteria and guards against regressions.', builtin: true, position: 5 },
  { key: 'devops', name: 'DevOps', discipline: 'devops', icon: '🚀', color: 'orange',
    description: 'Owns CI/CD, environments, and safe delivery to production.', builtin: true, position: 6 },
  { key: 'security', name: 'Security', discipline: 'security', icon: '🛡️', color: 'rose',
    description: 'Reviews for vulnerabilities, secrets, and compliance.', builtin: true, position: 7 },
  { key: 'tech-writer', name: 'Technical Writer', discipline: 'other', icon: '✍️', color: 'lime',
    description: 'Documents the change for users and the team.', builtin: true, position: 8 },
  { key: 'manager', name: 'Delivery Manager', discipline: 'other', icon: '🧑‍💼', color: 'slate',
    description: 'Coordinates the roster, unblocks work, and audits ticket coverage.', builtin: true, position: 9 },
];

const BY_KEY = new Map(BUILTIN_ROLES.map((r) => [r.key, r]));

export function isBuiltinRoleKey(key: string): boolean {
  return BY_KEY.has(key);
}
