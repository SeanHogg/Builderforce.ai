/**
 * The governance audit pipeline (PRD 08 §4.2). Model-free: step 3 (LLM triage +
 * LLM-only rules) runs through the injected `assess` seam — the orchestrator
 * supplies a `governance-auditor` role call under `useCase: "gov.policy_audit"`.
 *
 *   1. Resolve the effective ruleset (API).
 *   2. Deterministic pre-filters over the working tree (matcher registry).
 *   3. Assess (injected; default confirms every pre-filter hit).
 *   4. Start the run, POST findings + summary + gate, which finalizes it.
 */

import { createGovernanceApiClient, type GovernanceApiClient, type GovernanceApiConfig } from "./api-client.js";
import { runPrefilters } from "./prefilter.js";
import {
  summarizeFindings,
  type GovernanceAssessor,
  type GovernanceAuditOptions,
  type GovernanceAuditResult,
  type ResolvedRuleset,
} from "./types.js";
import { createWorkingTreeReader, walkWorkingTree, type WorkingTreeReader } from "./walker.js";

export interface GovernanceAuditDeps extends GovernanceApiConfig {
  /** The API seam; defaults to the HTTP client built from the config fields. */
  client?: GovernanceApiClient;
  /** Working tree to pre-filter. Defaults to `process.cwd()`. */
  workspaceDir?: string;
  /** The LLM triage seam (step 3). See {@link GovernanceAssessor}. */
  assess?: GovernanceAssessor;
  /** Test/embedded override: skip the working-tree walk and use these rel paths. */
  filesOverride?: string[];
  /** Test/embedded override for reading file contents. */
  readFile?: WorkingTreeReader;
}

/** Confirm-all assessor: deterministic-only mode (dry runs / tests / no LLM wired). */
const confirmPrefilterAssessor: GovernanceAssessor = async (ctx) => ctx.prefilterHits.map((hit) => ({ ...hit }));

function filterToPacks(ruleset: ResolvedRuleset, packIds: string[] | undefined): ResolvedRuleset {
  if (!packIds || packIds.length === 0) return ruleset;
  const allowed = new Set(packIds);
  return { ...ruleset, rules: ruleset.rules.filter((r) => r.packId === undefined || allowed.has(r.packId)) };
}

export async function runGovernanceAudit(
  deps: GovernanceAuditDeps,
  opts: GovernanceAuditOptions,
): Promise<GovernanceAuditResult> {
  const client = deps.client ?? createGovernanceApiClient(deps);
  const assess = deps.assess ?? confirmPrefilterAssessor;

  // 1. Resolve the effective ruleset (§3).
  const ruleset = filterToPacks(
    await client.resolveRuleset({ projectId: opts.projectId, repoRef: opts.repoRef }),
    opts.packIds,
  );

  // 2. Deterministic pre-filters over ONE walk of the working tree.
  const workspaceDir = deps.workspaceDir ?? process.cwd();
  const files = deps.filesOverride ?? (await walkWorkingTree(workspaceDir));
  const oversize = new Set<string>();
  const readFile = deps.readFile ?? createWorkingTreeReader(workspaceDir, (relPath) => oversize.add(relPath));
  const { hits: prefilterHits, ruleErrors } = await runPrefilters({ files, readFile }, ruleset);
  const skippedFiles = [...oversize].sort();

  // 3. LLM triage + LLM-only rules (injected; default confirms pre-filter hits).
  const findings = await assess({
    useCase: "gov.policy_audit",
    repoRef: opts.repoRef,
    ref: opts.ref,
    ruleset,
    prefilterHits,
    ruleErrors,
    files,
  });

  const { summary, gateResult } = summarizeFindings(ruleset, findings, ruleErrors);
  summary.skipped = skippedFiles.length;
  const base = {
    summary,
    gateResult,
    rulesetHash: ruleset.rulesetHash,
    packsApplied: ruleset.packsApplied,
    findings,
    ruleErrors,
    skippedFiles,
  };
  if (opts.dryRun) return { ...base, dryRun: true };

  // 4. Start the run, bulk-write findings, finalize.
  const { runId } = await client.startAudit({
    ...(opts.projectId ? { projectId: opts.projectId } : {}),
    ...(opts.repoRef ? { repoRef: opts.repoRef } : {}),
    ...(opts.ref ? { ref: opts.ref } : {}),
    trigger: "manual",
  });
  await client.finalizeAudit(runId, {
    findings,
    summary,
    gateResult,
    ...(ruleset.rulesetHash ? { rulesetHash: ruleset.rulesetHash } : {}),
    ...(ruleset.packsApplied ? { packsApplied: ruleset.packsApplied } : {}),
  });
  return { runId, ...base };
}
