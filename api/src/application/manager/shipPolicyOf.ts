/**
 * shipPolicyOf — the ONE mapper from a project's effective manager policy to the ship
 * policies its runs follow (PRD 48 §4.1). Pure, beside the fold it reads.
 *
 *   • `local` — a VS Code run: the project's `shipMode` (project → workspace → built-in
 *     `commit`), provenance `project_settings`, or `default` when no tier set it.
 *   • `cloud` — a cloud / on-prem agent-host run: ALWAYS `pull_request`, whatever
 *     `shipMode` says. The run opens its PR and ends; `repos/prMergeSweep.ts` is the single
 *     merge writer, so `merge` here only DESCRIBES what the sweep will do (the prompt says
 *     it, and the run never merges or pushes the base branch itself).
 *
 * `merge` must say exactly what the sweep does, so it takes the sweep's own gates: the sweep
 * works only a MANAGED project (`isProjectManaged` — its own enabled config row, the opt-in
 * the sweep's `mergeQueueOptInOn` join and `policy.enabled` check express in SQL), and holds
 * every merge while the project is in canary (`holdMergeForCanary`).
 *
 * No env var, no secret, no VS Code setting decides either one — only the project's rows.
 */
import { shipPolicyOf as policyForMode, type ShipPolicy } from '@builderforce/run-guards';
import type { EffectiveManagerPolicy } from './managerPolicy';

/** The two policies a project's runs follow, by host. */
export interface ProjectShipPolicies {
  local: ShipPolicy;
  cloud: ShipPolicy;
}

type MergeInputs = Pick<EffectiveManagerPolicy, 'enabled' | 'allowAutoMerge' | 'prMergePolicy' | 'canary'>;
type ShipPolicyInputs = MergeInputs & Pick<EffectiveManagerPolicy, 'shipMode' | 'shipModeSource' | 'requireSignoffToComplete'>;

/**
 * When the PR merge sweep would merge a run's pull request. `never` = a human merges: the
 * project is not managed (the sweep never visits it), it is in canary (the sweep logs instead
 * of merging), the manager is off, merge authority is withheld, or PRs queue for a person.
 * `managed` is {@link isProjectManaged}'s answer — the same predicate the sweep's SQL mirrors.
 */
export function cloudMergeOf(p: MergeInputs, managed: boolean): ShipPolicy['merge'] {
  if (!managed || p.canary || !p.enabled || !p.allowAutoMerge || p.prMergePolicy === 'queue') return 'never';
  return p.prMergePolicy === 'on_green' ? 'on_green' : 'immediate';
}

/** The local and cloud ship policies of one effective manager policy, for a project that is (or is not) managed. */
export function shipPoliciesOf(p: ShipPolicyInputs, managed: boolean): ProjectShipPolicies {
  return {
    local: policyForMode(p.shipMode, p.shipModeSource === 'default' ? 'default' : 'project_settings'),
    cloud: {
      mode: 'pull_request',
      merge: cloudMergeOf(p, managed),
      review: p.requireSignoffToComplete ? 'required' : 'none',
      source: 'project_settings',
    },
  };
}
