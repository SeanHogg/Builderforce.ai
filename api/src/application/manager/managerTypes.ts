/**
 * managerTypes — the catalog of AI Manager DOMAIN TYPES.
 *
 * One tenant may want very different managers: a Development manager that shepherds
 * code + PRs, a QA manager that drives defects + coverage, an IT Service Desk manager
 * that triages support/incidents by SLA, a DevOps manager that guards reliability +
 * deploys. They all run the SAME mechanical pass (value → rank → assign → PR →
 * dispatch → audit); the TYPE only changes the JUDGEMENT — what the manager values
 * and prioritizes. That judgement is an LLM concern, so each type is expressed as a
 * `directive` folded into the manager's scoring/prioritization persona (alongside the
 * designated agent's persona and any human coaching directives — see ManagerService).
 *
 * THE single source of the type list: the API pass reads `directive` here; the UI
 * renders `label`/`description` (localized in the frontend by the SAME `id`). Adding a
 * type = one entry here + its five i18n strings; nothing else branches on the id.
 */

export type ManagerTypeId = 'general' | 'delivery' | 'qa' | 'service_desk' | 'devops';

export interface ManagerType {
  id: ManagerTypeId;
  /** English fallback label (the UI localizes by id via `managerType.<id>.label`). */
  label: string;
  /** English fallback description (localized by `managerType.<id>.description`). */
  description: string;
  /** Domain framing folded into the manager's AI scoring/prioritization persona.
   *  Prompt text (fed to the model), so it is NOT user-facing copy and stays here. */
  directive: string;
}

export const MANAGER_TYPES: ManagerType[] = [
  {
    id: 'general',
    label: 'General manager',
    description: 'Domain-neutral backlog management — value, rank, assign, and shepherd PRs across all work.',
    directive:
      'You manage a general delivery backlog. Weigh each ticket by its business value, urgency, and dependencies without a specific domain bias.',
  },
  {
    id: 'delivery',
    label: 'Development manager',
    description: 'Ships features. Prioritizes code work, unblocking dependencies, and getting pull requests reviewed and merged.',
    directive:
      'You are a software Development manager. Prioritize feature and engineering work that moves the product forward: value tickets that ship user-facing capability, unblock other work, or clear review-ready pull requests highest. Favor momentum — keep code flowing from in-progress to merged.',
  },
  {
    id: 'qa',
    label: 'QA manager',
    description: 'Owns quality. Prioritizes defects, test coverage gaps, flaky tests, and release-blocking bugs.',
    directive:
      'You are a QA manager. Prioritize quality work: defects, regressions, release-blocking bugs, test-coverage gaps, and flaky/failing tests. Value tickets that reduce escaped defects and raise the release confidence signal highest; treat unverified "done" work as risk.',
  },
  {
    id: 'service_desk',
    label: 'IT Service Desk manager',
    description: 'Runs support. Triages incidents, requests, and outages by SLA and customer impact first.',
    directive:
      'You are an IT Service Desk manager. Prioritize by customer impact and SLA: active incidents and outages first, then time-sensitive support requests, then routine service requests. Value tickets that restore service or unblock a waiting user highest; escalate anything breaching or near an SLA.',
  },
  {
    id: 'devops',
    label: 'DevOps / IT Operations manager',
    description: 'Guards reliability. Prioritizes deploys, infrastructure, monitoring, and operational risk.',
    directive:
      'You are a DevOps / IT Operations manager. Prioritize reliability, security, and operational readiness: deploys, infrastructure and pipeline work, monitoring/alerting gaps, and toil reduction. Value tickets that reduce production risk, remove single points of failure, or unblock a release highest.',
  },
];

export const DEFAULT_MANAGER_TYPE: ManagerTypeId = 'general';

const BY_ID = new Map<string, ManagerType>(MANAGER_TYPES.map((t) => [t.id, t]));

/** Normalize an arbitrary stored/submitted type id to a known one (fallback general). */
export function normalizeManagerType(v: unknown): ManagerTypeId {
  return typeof v === 'string' && BY_ID.has(v) ? (v as ManagerTypeId) : DEFAULT_MANAGER_TYPE;
}

/** Resolve a type id to its definition (never null — falls back to 'general'). */
export function resolveManagerType(id: string | null | undefined): ManagerType {
  return BY_ID.get(normalizeManagerType(id))!;
}
