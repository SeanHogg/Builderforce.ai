/**
 * Run every enabled rule's deterministic check (PRD 08 §4.2 step 2) through the
 * matcher registry. A rule whose check cannot compile or run is returned as a
 * {@link GovernanceRuleError} — never dropped, so it can never read as passed.
 */

import { logWarn } from "../../../logger.js";
import { LLM_ONLY_CHECK_KINDS, RULE_MATCHERS, RuleCompileError, type MatcherContext } from "./matchers.js";
import type { GovernancePrefilterHit, GovernancePrefilterResult, GovernanceRuleError, ResolvedRuleset } from "./types.js";

export async function runPrefilters(ctx: MatcherContext, ruleset: ResolvedRuleset): Promise<GovernancePrefilterResult> {
  const hits: GovernancePrefilterHit[] = [];
  const ruleErrors: GovernanceRuleError[] = [];
  for (const rule of ruleset.rules) {
    if (rule.enabled === false) continue;
    const check = rule.check;
    if (!check || typeof check !== "object") continue; // LLM-only rule
    if (LLM_ONLY_CHECK_KINDS.has(check.kind)) continue; // explicitly LLM-only
    const matcher = RULE_MATCHERS[check.kind];
    try {
      if (!matcher) throw new RuleCompileError(`unknown check kind ${JSON.stringify(check.kind)}`);
      hits.push(...(await matcher(rule, check, ctx)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`[governance_audit] rule ${rule.ruleRef} (${check.kind}) failed: ${message}`);
      ruleErrors.push({
        ruleId: rule.id,
        ruleRef: rule.ruleRef,
        title: rule.title,
        severity: rule.severity,
        kind: check.kind,
        error: message,
      });
    }
  }
  return { hits, ruleErrors };
}
