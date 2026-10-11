/**
 * What a cloud sub-agent may TOUCH, and WHO it runs as.
 *
 * A cloud child is its own durable run with an owner pointer (`cloudChildRuns.ts`,
 * spawned by `cloudLiveOrchestration.ts`) on every surface — the durable runner, the
 * Container and the Actions runner alike. This module is the part of that which is a
 * security boundary and a staffing rule, so it is pure and tested directly:
 *
 *   • A child never gets `human`. A run pauses for a person by ending the whole
 *     execution and waiting for an answer on resume; a child that could trigger that
 *     would strand its owner mid-task with no way back.
 *   • A child spawns its own children only while it is above the depth cap — the same
 *     recursion rule the editor's children follow (`MAX_SUBAGENT_DEPTH`).
 */

import {
  type Capability,
  type ModelRole,
  type RepoWriteCapability,
  inScope,
  staffDelegation,
} from '@builderforce/agent-tools';

/** The delegation capabilities — granted to a child only while it may still spawn. */
export const DELEGATION_CAPABILITIES: readonly Capability[] = ['orchestrate', 'orchestrate.fanout', 'orchestrate.live'];

/**
 * Never handed to a child, whatever its owner holds.
 *
 * `skill.author` is withheld for the reason the tool exists at all: a skill is a
 * procedure every FUTURE run is told to follow, and the run accountable for proposing
 * one is the run a person can ask about it — not a child its owner commissioned and
 * summarised in a sentence.
 */
export const NON_DELEGABLE_CAPABILITIES: readonly Capability[] = ['human', 'skill.author'];

/**
 * Additionally withheld from a READ-ONLY child (the default). Anything that can change
 * the working tree, the ticket's PRD, the shared blackboard or durable memory — plus
 * `shell` and `process`, which are write capabilities wearing a different hat.
 */
export const MUTATING_CAPABILITIES: readonly Capability[] = [
  'repo.write', 'repo.edit', 'repo.delete', 'git.write', 'shell', 'process',
  'prd.write', 'coordinate', 'memory.forget',
];

/**
 * Withheld from a SCOPED child — one writing beside siblings in the same tree
 * (`spawn_agents`). A shell, a process or a git write reaches the whole tree whatever
 * the child's paths say, so only the file writers a scope can check are left.
 */
export const TREE_WIDE_CAPABILITIES: readonly Capability[] = ['shell', 'process', 'git.write'];

/** The child's capability set: its owner's, minus what is never delegable, minus the
 *  mutating half when the delegation is read-only, minus the tree-wide writers when it
 *  is scoped, minus delegation itself at the depth cap. */
export function childCapabilities(parent: ReadonlySet<Capability>, readOnly: boolean, scoped = false, canSpawn = false): ReadonlySet<Capability> {
  const withheld = new Set<Capability>([
    ...NON_DELEGABLE_CAPABILITIES,
    ...(readOnly ? MUTATING_CAPABILITIES : []),
    ...(scoped ? TREE_WIDE_CAPABILITIES : []),
    ...(canSpawn ? [] : DELEGATION_CAPABILITIES),
  ]);
  return new Set([...parent].filter((c) => !withheld.has(c)));
}

/** Resolves one of the WORKSPACE's agents (by id or name) to the persona a child runs as. */
export type PersonaBriefPort = (agent: string) => Promise<{ name: string; brief: string; roleKeys?: readonly string[] } | null>;

/** WHO a delegation runs as — see {@link resolveDelegatePersona}. */
export type DelegatePersona =
  | { ok: false; error: string }
  | {
    ok: true;
    persona?: { name: string; brief: string };
    /** Echoed on the result and in the report so the answer is attributable to a REAL
     *  teammate rather than to the string the owner guessed — or, for an on-demand role
     *  persona, to nobody, with the note saying why. */
    echo: { asAgent?: { ref: string; name: string }; staffing?: string };
  };

/**
 * Resolve a delegation's `asAgent`.
 *
 * A ref that resolves to nobody is a FAILED delegation, never an anonymous one: the owner
 * asked for a named teammate, and quietly substituting a generic child would produce an
 * answer attributed to expertise nobody applied. When the named agent lacks the slice's
 * delivery role (Developer for code, QA for verify) the child runs as an on-demand role
 * persona instead, and says so — the editor's children run the same rule.
 */
export async function resolveDelegatePersona(
  personaBrief: PersonaBriefPort | undefined,
  asAgent: string,
  role: ModelRole | undefined,
): Promise<DelegatePersona> {
  if (!asAgent) return { ok: true, echo: {} };
  const resolved = await personaBrief?.(asAgent);
  if (!resolved) return { ok: false, error: `no agent named "${asAgent}" in this workspace` };
  const staffed = role ? staffDelegation(resolved, role) : { kind: 'as-agent' as const };
  if (staffed.kind === 'on-demand') return { ok: true, persona: staffed.persona, echo: { staffing: staffed.note } };
  return { ok: true, persona: { name: resolved.name, brief: resolved.brief }, echo: { asAgent: { ref: asAgent, name: resolved.name } } };
}

/** A scoped child's file writers: every path outside its scope is refused before anything is sent. */
export function scopedRepoWrite(write: RepoWriteCapability, scope: readonly string[]): RepoWriteCapability {
  const outside = (path: string): { ok: false; error: string } | null =>
    inScope(path, scope)
      ? null
      : { ok: false, error: `'${path}' is outside this workstream's paths (${scope.join(', ')}) — another workstream may own it. Change only files inside your paths, and name anything else you believe must change in your answer.` };
  return {
    writeFile: async (path, content, summary) => outside(path) ?? write.writeFile(path, content, summary),
    editFile: async (path, oldString, newString, replaceAll) => outside(path) ?? write.editFile(path, oldString, newString, replaceAll),
    deleteFile: async (path, reason) => outside(path) ?? write.deleteFile(path, reason),
  };
}
