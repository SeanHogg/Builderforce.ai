/**
 * Which model served each ROLE, and how the run moved from analysis to code.
 *
 * The per-model scorecard says what each model did; it cannot say that every `code`
 * turn was answered by the model that planned, or that analysis never ended. Chat #6
 * read as "MiniMax: 899 turns" while the real story was 778 `plan` turns, 262 `code`
 * turns on the same Flash model, 198 analysis→code re-asks that changed nothing and
 * zero `hand_off` calls. These lines tell that story from the recorded trace.
 *
 * Pure over the trace, like `modelScorecard.ts`, so every copy surface renders the same.
 */
import type { BrainTraceEvent } from './brainTriage';
import type { ModelTurn } from './modelScorecard';
import { FAILOVER_SEPARATOR } from './runStore/gatewayRoutingTrace';

export interface RoleRouting {
  role: string;
  turns: number;
  /** Turns per model that served this role, most first. */
  models: Array<{ model: string; turns: number }>;
  /** Gateway failovers seen on this role's turns, most first (`model:status kind`). */
  failovers: Array<{ failover: string; turns: number }>;
}

export interface RoutingByRole {
  roles: RoleRouting[];
  /** Analysis → code re-asks (`llm.role_handoff`). */
  coderReasks: number;
  /** Explicit `hand_off` calls the planner made. */
  handOffs: number;
  /** Times the analysis budget forced the hand-off turn (`loop.hand_off_due`). */
  handOffsForced: number;
  /** Times analysis ended without a hand-off once the budget was spent. */
  planBudgetsSpent: number;
}

const ranked = (counts: Map<string, number>): Array<[string, number]> =>
  [...counts.entries()].sort((a, b) => b[1] - a[1]);

export function routingByRole(turns: readonly ModelTurn[], events: readonly BrainTraceEvent[]): RoutingByRole {
  const byRole = new Map<string, { turns: number; models: Map<string, number>; failovers: Map<string, number> }>();
  for (const t of turns) {
    if (t.failed || !t.role) continue;
    const entry = byRole.get(t.role) ?? { turns: 0, models: new Map(), failovers: new Map() };
    entry.turns += 1;
    entry.models.set(t.model, (entry.models.get(t.model) ?? 0) + 1);
    for (const f of t.failovers?.split(FAILOVER_SEPARATOR) ?? []) if (f) entry.failovers.set(f, (entry.failovers.get(f) ?? 0) + 1);
    byRole.set(t.role, entry);
  }
  const count = (label: string): number => events.filter((e) => e.label === label).length;
  // One label, two events (`runPolicyTraces.ts`): the implicit re-ask names the planner it
  // left (`from`), the explicit `hand_off` names the tool it came through (`via`).
  const roleHandoffs = events.filter((e) => e.label === 'llm.role_handoff');
  const hasArg = (e: BrainTraceEvent, key: string): boolean => !!e.args && typeof e.args === 'object' && key in (e.args as Record<string, unknown>);
  return {
    roles: [...byRole.entries()].map(([role, e]) => ({
      role,
      turns: e.turns,
      models: ranked(e.models).map(([model, n]) => ({ model, turns: n })),
      failovers: ranked(e.failovers).map(([failover, n]) => ({ failover, turns: n })),
    })),
    coderReasks: roleHandoffs.filter((e) => hasArg(e, 'from')).length,
    handOffs: roleHandoffs.filter((e) => hasArg(e, 'via')).length,
    handOffsForced: count('loop.hand_off_due'),
    planBudgetsSpent: count('loop.plan_budget_spent'),
  };
}

/** `Routing by role:` lines — nothing when no turn recorded its role. */
export function formatRoutingByRole(r: RoutingByRole | undefined): string[] {
  if (!r || r.roles.length === 0) return [];
  const lines = ['Routing by role:'];
  for (const role of r.roles) {
    const models = role.models.slice(0, 3).map((m) => `${m.model} ×${m.turns}`).join(', ');
    const left = role.failovers.length
      ? ` · gateway left: ${role.failovers.slice(0, 4).map((f) => `${f.failover} ×${f.turns}`).join(', ')}`
      : '';
    lines.push(`  • ${role.role}: ${role.turns} turn(s) — ${models}${left}`);
  }
  lines.push(
    `  • analysis → code: ${r.coderReasks} re-ask(s) on a first edit · ${r.handOffs} hand_off call(s)`
      + (r.handOffsForced ? ` · ${r.handOffsForced} forced by the analysis budget` : '')
      + (r.planBudgetsSpent ? ` · ${r.planBudgetsSpent} ended analysis with no hand-off` : ''),
  );
  // The failure this section exists for: the planner re-asked a stronger coder and the
  // same model answered. Only an unpinned run re-asks, so a pin never raises it.
  const plan = r.roles.find((x) => x.role === 'plan')?.models[0]?.model;
  const code = r.roles.find((x) => x.role === 'code');
  if (r.coderReasks > 0 && plan && code && code.models.length === 1 && code.models[0]!.model === plan) {
    lines.push(`  ⚠ every code turn was answered by the planning model (${plan}) — no stronger connected coder served one. See "gateway left" above, or the connected accounts' health in the / menu.`);
  }
  return lines;
}
