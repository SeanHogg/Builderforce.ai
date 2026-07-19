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
  { key: 'team-lead', name: 'Team Lead', discipline: 'engineering', icon: '🧭', color: 'cyan',
    description: 'Senior engineer who reviews implementation quality and mentors the team.', builtin: true, position: 10 },
  { key: 'validator', name: 'Validator', discipline: 'qa', icon: '✅', color: 'green',
    description: 'Confirms the delivered work meets acceptance criteria and business intent.', builtin: true, position: 11 },
  { key: 'product-owner', name: 'Product Owner', discipline: 'product', icon: '🎯', color: 'fuchsia',
    description: 'Accountable for value and acceptance — signs off that the ticket is done-done.', builtin: true, position: 12 },
  { key: 'designer', name: 'Designer', discipline: 'design', icon: '🎨', color: 'pink',
    description: 'Owns UX/UI and visual design — often a resource-assessment add for design-heavy tickets.', builtin: true, position: 13 },
];

const BY_KEY = new Map(BUILTIN_ROLES.map((r) => [r.key, r]));

/**
 * Roles whose sign-off is a JUDGEMENT ON THE CHANGE, as opposed to participation
 * in producing it.
 *
 * This is the gate for publishing a sign-off to the pull request
 * (see application/validation/publishReviewToPr.ts). Every role's sign-off is
 * recorded in the ledger for accountability, but posting all of them to the PR
 * would bury the ones a merge decision actually depends on — a business analyst
 * confirming scope is not a review of the diff.
 *
 * `security` is included because a security sign-off is a gate on merging;
 * `product-owner` because acceptance ("done-done") is precisely the judgement a
 * reviewer wants to see before shipping. `developer`, `business-analyst`,
 * `tech-writer`, `designer`, `devops` and `manager` are deliberately excluded —
 * they are contributors or coordinators on the ticket, not arbiters of the diff.
 *
 * A custom (non-builtin) role key is not a review role: nothing is known about
 * its semantics, and defaulting to "publish" would spam PRs as tenants add roles.
 */
const REVIEW_ROLE_KEYS: ReadonlySet<string> = new Set([
  'code-reviewer',
  'architect',
  'qa-tester',
  'security',
  'validator',
  'team-lead',
  'product-owner',
]);

export function isReviewRole(key: string): boolean {
  return REVIEW_ROLE_KEYS.has(key);
}

export function isBuiltinRoleKey(key: string): boolean {
  return BY_KEY.has(key);
}
