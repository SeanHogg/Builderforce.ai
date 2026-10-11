/**
 * A durable run's place in a delegation tree — the ONE field the cloud engine reads.
 *
 * Every durable run is an OWNER: it may spawn background children (`orchestrate.live`)
 * through the one cloud backing (`cloudLiveOrchestration.ts`). A run that is itself a
 * sub-agent additionally carries its `spec`: narrowed capabilities, scoped writes,
 * tokens billed to the run at the root of its tree, and no finalize of its own (the root
 * opens the pull request for the whole tree). A run with no delegation — a rehearsal —
 * holds no delegation capabilities at all: a dry run must not start real runs.
 */

import { MAX_SUBAGENT_DEPTH } from '@builderforce/agent-loop';
import type { Capability, CapabilityProvider } from '@builderforce/agent-tools';
import { childCapabilities, DELEGATION_CAPABILITIES, scopedRepoWrite } from './cloudSubagent';
import type { CloudChildSpec } from './cloudChildRuns';
import type { LiveParentRun } from './cloudLiveOrchestration';
import type { RuntimeService } from './RuntimeService';

export interface CloudRunDelegation {
  /** This run, as the owner its children inherit from. */
  parent: LiveParentRun;
  runtime: RuntimeService;
  /** Present when this run is itself someone's sub-agent. */
  spec?: CloudChildSpec;
}

/** The capability set a run holds, given its place in the tree. */
export function delegationCaps(base: ReadonlySet<Capability>, delegation: CloudRunDelegation | undefined): ReadonlySet<Capability> {
  if (!delegation) return new Set([...base].filter((c) => !DELEGATION_CAPABILITIES.includes(c)));
  const spec = delegation.spec;
  return spec ? childCapabilities(base, spec.readOnly, !!spec.scope?.length, spec.depth < MAX_SUBAGENT_DEPTH) : base;
}

/** A scoped child's writers refuse every path outside its scope before anything is sent. */
export function delegationProvider(provider: CapabilityProvider, delegation: CloudRunDelegation | undefined): CapabilityProvider {
  const scope = delegation?.spec?.scope;
  return scope?.length && provider.repoWrite ? { ...provider, repoWrite: scopedRepoWrite(provider.repoWrite, scope) } : provider;
}

/** The run a tree's tokens bill to — its root, so a fan-out is one run against the cap. */
export const meterExecutionIdOf = (executionId: number, delegation: CloudRunDelegation | undefined): number =>
  delegation?.spec?.rootExecutionId ?? executionId;

/** Whether this run is a sub-agent (it never finalizes; its root does). */
export const isChildDelegation = (delegation: CloudRunDelegation | undefined): boolean => !!delegation?.spec;
