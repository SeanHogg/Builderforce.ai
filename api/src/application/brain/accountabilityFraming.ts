/**
 * The AI Manager's accountability-chat framing (0376). Split out of
 * `BrainService.ts`, which re-exports both symbols.
 */

/**
 * The manager-tool ids {@link accountabilityFraming} instructs the agent to call.
 *
 * Exported so a test can assert that every one of them is actually ADVERTISED to the
 * model. That assertion is the regression guard for the defect this list documents: the
 * framing named tools by catalog id, the ids matched nothing in the model's tool list,
 * and the manager answered three consecutive accountability questions by describing the
 * calls it had never made. Nothing failed loudly — there is no error for "the prompt
 * referenced a tool that does not exist", which is exactly why it needs a test.
 */
export const ACCOUNTABILITY_TOOL_IDS: readonly string[] = [
  'manager.digest', 'manager.decisions', 'manager.census', 'manager.policy',
  'autonomy.wiring_audit', 'tickets.lifecycle',
];

/**
 * The standard the AI Manager is held to in its own accountability chat (0376).
 *
 * A person opens this chat to ask one thing — "what did you and the team get done, and
 * why not more?" — and the failure mode of an agent facing that question is well known:
 * it apologises, promises to do better, and says nothing checkable. Three instructions
 * are what turn that into an answer.
 *
 *   1. READ THE RECORD FIRST. The tools exist and are on the allowlist; an agent that
 *      does not call them is guessing about its own work.
 *   2. NAME THE GATE. The true cause of a dead board is almost never "I didn't try" —
 *      it is a withheld merge authority, an unstaffed lane, an exhausted token budget,
 *      a sign-off nobody gave. Those live in `manager.policy` and the census, and every
 *      one of them is actionable by the person asking.
 *   3. NEVER DRESS A ZERO AS PROGRESS. The digest reports yesterday alongside today
 *      precisely so a quiet day and a stopped board are distinguishable; a manager that
 *      blurs them has destroyed the only signal the page exists to carry.
 *
 * `projectId` is interpolated because every manager tool takes it and the model has no
 * other way to learn it.
 *
 * ── TOOLS ARE NAMED BY THEIR ADVERTISED NAME, NEVER THEIR CATALOG ID ─────────────
 * This is not a style point; it is the bug this function shipped with. The catalog id is
 * `manager.digest`, but a model is advertised `builtin_manager_digest` — so a prompt
 * naming the dotted id points at a tool that appears nowhere in the model's tool list.
 * The observed result was exactly what you would expect and nothing like an error: the
 * manager DESCRIBED the calls it could not make ("The tools required are manager.digest,
 * manager.decisions and manager.census") and reported having no data, three questions in
 * a row. `nameFor` resolves each id against the tools ACTUALLY advertised on this turn
 * and omits any that are missing — so the prompt cannot reference a tool the model does
 * not have, whatever changes to the allowlist come later.
 */
export function accountabilityFraming(projectId: number, nameFor: (toolId: string) => string | null): string {
  const digest = nameFor('manager.digest');
  const decisions = nameFor('manager.decisions');
  const census = nameFor('manager.census');
  const policy = nameFor('manager.policy');
  const wiring = nameFor('autonomy.wiring_audit');
  const lifecycle = nameFor('tickets.lifecycle');
  const call = (name: string | null, what: string) => (name ? `${name}(projectId=${projectId}) ${what}` : null);
  const record = [
    call(digest, 'for what finished today and yesterday'),
    call(decisions, 'for what you actually decided'),
    call(census, 'for what is stuck across every ticket'),
    call(policy, 'for what you were PERMITTED to do and whether autonomy was paused'),
  ].filter(Boolean).join(', ');

  return [
    `This is the AI MANAGER's accountability chat for project #${projectId}: the user is asking you to account for what the team — and you — actually got done, and why more did not. `,
    record
      ? `Before answering ANY question about outcomes you MUST actually CALL these tools — do not describe them, do not list them, do not say what they would return: ${record}. `
      : '',
    wiring ? `Call ${wiring}() when the question is whether work can complete unattended at all. ` : '',
    lifecycle ? `Call ${lifecycle}(taskId) for why one specific ticket is stuck. ` : '',
    `Answer with those numbers and cite the tickets by key. Never claim work you cannot point at, and never report that a tool "has not returned results" — if you have not called it, call it now. `,
    `If little or nothing got done, say so plainly in the first sentence, then name the SPECIFIC gate that held the work (an unstaffed lane, merge authority withheld from you, an exhausted token budget, a sign-off nobody gave, a failure breaker) and the ONE change that would unblock it. Do not apologise instead of explaining, and never describe a stalled board as progress. `,
  ].join('');
}
