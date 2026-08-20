import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Shared task-PRD helpers — the single source of truth for drafting a task's
 * PRD and linking PRDs to tasks. Used by BOTH the cloud-execution path
 * (`runtimeRoutes.ensureTaskPrd`) and the swimlane auto-PRD gate
 * (`DrizzlePrdEnsurer`) so PRD generation + linking is never duplicated.
 *
 * Task <-> PRD is many-to-many via `task_specs` (0098); each task has at most one
 * primary PRD (the canonical one the agent reads/writes for that task).
 */
import { and, desc, eq } from 'drizzle-orm';
import { completeForTenant } from '../llm/tenantProxy';
import { readProxyChoice } from '../llm/LlmProxyService';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { specs, taskSpecs } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

const PRD_SYSTEM_PROMPT =
  'You are a senior product architect drafting the WIP Product Requirements Document (PRD) that every ' +
  'downstream agent on this task will share. Write a concise, well-structured PRD in GitHub-flavored ' +
  'markdown covering: Problem & Goal, Target users / ICP roles (if relevant), Scope, Functional ' +
  'requirements, Acceptance criteria, and Out of scope. Output ONLY the PRD markdown — no preamble and ' +
  'no bracketed placeholders.';

/**
 * Despite the "Output ONLY the PRD markdown" instruction, models sometimes wrap
 * the whole document in a ```markdown … ``` fence. Stored verbatim, that renders
 * as a single raw "MARKDOWN" code box instead of formatted prose. Normalize on
 * WRITE here so every consumer (render, export, repo commit, Copy) gets clean
 * markdown — the frontend `unwrapMarkdownFence` stays the render-time safety net
 * for rows written before this. Idempotent: clean markdown passes through.
 */
export function stripPrdMarkdownFence(content: string): string {
  const text = content.trim();
  // Whole-document fence: ```[markdown|md] … ``` with nothing but the block.
  const m = /^```[ \t]*(markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(text);
  return m ? (m[2] ?? '').trim() : text;
}

/** Draft a PRD body for a task via the gateway, on the tenant's connected BYO account
 *  when they have one (the compiled/agent `model` is honored only when it preempts the
 *  BYO seed). Returns trimmed markdown, or '' on failure. Never throws. */
export async function draftTaskPrd(
  env: Env,
  tenantId: number,
  task: { title: string; description: string | null },
  model?: string,
): Promise<string> {
  try {
    const gen = await completeForTenant(env, tenantId, {
      messages: [
        { role: 'system', content: PRD_SYSTEM_PROMPT },
        { role: 'user', content: `Task: ${task.title}\n\n${task.description ?? ''}`.trim() },
      ],
      useCase: 'prd_generation',
    }, { meterUseCase: 'prd_generation', explicitModel: model });
    if (gen.response.status < 400) {
      return stripPrdMarkdownFence((await readProxyChoice(gen)).content);
    }
  } catch (error) { /* generation failed — caller treats '' as "no PRD" */ 
    reportCaughtError(error, { source: "application/prd/taskPrd.ts", operation: "draftTaskPrd" });
  }
  return '';
}

/** Prepend the agent-attribution header so PRD authorship is auditable. */
export function buildPrdWithAttribution(prdBody: string, agentLabel: string, taskId: number): string {
  return `> **PRD** — drafted by ${agentLabel} · task #${taskId}\n> _Each agent that updates this PRD signs its change below._\n\n${prdBody}`;
}

/**
 * Append a signed revision block to a PRD body — the "Each agent that updates this
 * PRD signs its change below" contract, made real. `isoTimestamp` is passed in
 * (callers stamp `new Date().toISOString()`) so this stays a pure, testable string
 * builder. The new directive lands as its own dated, attributed section so the PRD
 * evolves per run instead of being frozen at first draft.
 */
export function appendPrdRevision(
  currentPrd: string,
  args: { agentLabel: string; directive: string; executionId?: number | null; isoTimestamp: string },
): string {
  const ref = args.executionId != null ? ` · execution #${args.executionId}` : '';
  const block = `### Update — ${args.agentLabel} · ${args.isoTimestamp}${ref}\n\n${args.directive.trim()}`;
  return `${currentPrd.trimEnd()}\n\n---\n\n${block}`;
}

/** A PRD's own section headings are `## ` (see {@link scaffoldPrdSections}); a signed
 *  revision block is `### ` under a `---` rule. Both are boundaries for a section edit. */
const PRD_SECTION_HEADING = /^##\s+(.+?)\s*$/;

/** The `## ` headings a PRD body carries, in document order. Pure. */
export function listPrdSections(prd: string): string[] {
  const out: string[] = [];
  for (const line of prd.split(/\r?\n/)) {
    const m = PRD_SECTION_HEADING.exec(line);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

/**
 * Replace the BODY of one `## <heading>` section, leaving the heading and the rest of
 * the document untouched. Pure → unit-testable, and deliberately NOT a fuzzy match: an
 * unknown heading returns the headings that exist rather than guessing which section
 * the caller meant, because guessing here silently overwrites the wrong requirement.
 *
 * The section ends at the next `#`/`##` heading OR the next `---` rule — the rule
 * matters, because {@link appendPrdRevision} parks the signed revision blocks after one.
 * Without that boundary, editing the LAST `##` section would swallow every revision
 * signature on the document.
 */
export function replacePrdSection(
  prd: string,
  heading: string,
  body: string,
): { ok: true; prd: string; section: string } | { ok: false; sections: string[] } {
  const want = heading.trim().replace(/^#+\s*/, '').toLowerCase();
  const lines = prd.split(/\r?\n/);
  let start = -1;
  let canonical = '';
  for (let i = 0; i < lines.length; i++) {
    const m = PRD_SECTION_HEADING.exec(lines[i] ?? '');
    const name = m?.[1]?.trim();
    if (name && name.toLowerCase() === want) { start = i; canonical = name; break; }
  }
  if (start < 0) return { ok: false, sections: listPrdSections(prd) };

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^#{1,2}\s/.test(line) || /^---\s*$/.test(line)) { end = i; break; }
  }
  const tail = lines.slice(end);
  while (tail.length && !(tail[0] ?? '').trim()) tail.shift();
  const next = [...lines.slice(0, start + 1), '', body.trim(), ...(tail.length ? ['', ...tail] : [])];
  return { ok: true, prd: next.join('\n').trimEnd(), section: canonical };
}

/** Resolve the task's canonical PRD: the primary link, else the most recent. Null if none. */
export async function findTaskPrimarySpec(
  db: Db,
  taskId: number,
): Promise<{ id: string; prd: string | null } | null> {
  try {
    const [row] = await db
      .select({ id: specs.id, prd: specs.prd })
      .from(taskSpecs)
      .innerJoin(specs, eq(specs.id, taskSpecs.specId))
      .where(eq(taskSpecs.taskId, taskId))
      .orderBy(desc(taskSpecs.isPrimary), desc(taskSpecs.createdAt))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Link a PRD to a task (idempotent upsert on the task_specs junction). When
 * `isPrimary`, demote any existing primary first so the one-primary-per-task
 * invariant (partial unique index) holds. Best-effort — never throws.
 */
export async function linkSpecToTask(
  db: Db,
  params: { taskId: number; specId: string; tenantId: number; isPrimary?: boolean },
): Promise<void> {
  const { taskId, specId, tenantId, isPrimary = false } = params;
  const upsert = db
    .insert(taskSpecs)
    .values({ taskId, specId, tenantId, isPrimary })
    .onConflictDoUpdate({ target: [taskSpecs.taskId, taskSpecs.specId], set: { isPrimary } });
  try {
    if (isPrimary) {
      // Atomic demote-then-upsert in ONE transaction (db.batch — the neon-http
      // driver's transaction primitive) so a racing concurrent set-primary
      // can't slip between the two writes and silently lose its primary intent
      // to the partial-unique `uq_task_specs_primary` index [1278].
      const demote = db
        .update(taskSpecs)
        .set({ isPrimary: false })
        .where(scopedToTenant(taskSpecs, tenantId, eq(taskSpecs.taskId, taskId), eq(taskSpecs.isPrimary, true)));
      await db.batch([demote, upsert]);
    } else {
      await upsert;
    }
  } catch (error) { /* best-effort */ 
    reportCaughtError(error, { source: "application/prd/taskPrd.ts", operation: "linkSpecToTask" });
  }
}

export type EnsureTaskPrdResult = { specId: string; prd: string; status: 'reused' | 'created' | 'updated' };

/**
 * Ensure a task has a PRD: reuse the task's primary PRD if it already has body
 * text, otherwise draft one, persist it at PROJECT level (so it shows on the
 * project PRD tab), and link it to the task as primary. Returns null when
 * generation produced nothing. The single generate→persist→link path shared by
 * the cloud-execution wrapper, the on-demand "Generate PRD" endpoint, and the
 * swimlane auto-PRD gate. Never throws.
 */
/** The anchored per-role hand-off sections of a task PRD (PRD §5.7). Each role authors
 *  its section; a section's presence is part of verifying that role participated. */
export const PRD_ROLE_SECTIONS: ReadonlyArray<{ heading: string; role: string }> = [
  { heading: 'Requirements', role: 'business-analyst' },
  { heading: 'Design', role: 'architect' },
  { heading: 'Implementation Notes', role: 'developer' },
  { heading: 'Review', role: 'code-reviewer' },
  { heading: 'Test Evidence', role: 'qa-tester' },
  { heading: 'Acceptance', role: 'validator' },
];

/** Ensure the PRD carries the per-role hand-off sections. Idempotent — only appends a
 *  section header that's missing, so re-running never duplicates or clobbers content. */
export function scaffoldPrdSections(prd: string): string {
  let out = prd.trimEnd();
  for (const s of PRD_ROLE_SECTIONS) {
    const re = new RegExp(`^##\s+${s.heading}\b`, 'im');
    if (!re.test(out)) out += `

## ${s.heading}

${placeholderFor(s.role)}`;
  }
  return out;
}

/** The body {@link scaffoldPrdSections} writes for an UNAUTHORED section. Emitted from
 *  one place so {@link authoredPrdRoleSections} can recognise it verbatim. */
export function placeholderFor(role: string): string {
  return `_Owned by the ${role} — to be authored._`;
}

/**
 * WHICH ROLES HAVE ACTUALLY AUTHORED their PRD section. PURE.
 *
 * Every task PRD is scaffolded with the anchored per-role sections above, and until now
 * nothing read them back: the audit verified a role participated via sign-offs, a pull
 * request and child tasks, so a Business Analyst or Architect whose entire deliverable IS
 * the written section could satisfy nothing by writing it. This closes that — a
 * non-empty section is first-class producer evidence for the SPEC roles.
 *
 * "Authored" means the section body contains something other than the scaffold's own
 * placeholder and whitespace. The placeholder is generated by {@link placeholderFor}, so
 * a scaffold that is reworded cannot silently start counting as authored content.
 */
export function authoredPrdRoleSections(prd: string | null | undefined): string[] {
  if (!prd || !prd.trim()) return [];
  const authored: string[] = [];
  for (const section of PRD_ROLE_SECTIONS) {
    // Body = everything between this `## <heading>` and the next `## ` (or the end).
    const re = new RegExp(`^##\s+${section.heading}\b[^\n]*\n([\s\S]*?)(?=^##\s|\s*$)`, 'im');
    const body = re.exec(prd)?.[1] ?? '';
    const stripped = body.replace(placeholderFor(section.role), '').trim();
    if (stripped.length > 0) authored.push(section.role);
  }
  return authored;
}

export async function ensureTaskPrdRecord(
  db: Db,
  env: Env,
  args: {
    taskId: number;
    tenantId: number;
    projectId: number;
    title: string;
    description: string | null;
    agentLabel: string;
    model?: string;
  },
): Promise<EnsureTaskPrdResult | null> {
  const existing = await findTaskPrimarySpec(db, args.taskId);
  if (existing?.prd?.trim()) return { specId: existing.id, prd: existing.prd.trim(), status: 'reused' };

  const body = await draftTaskPrd(env, args.tenantId, { title: args.title, description: args.description }, args.model);
  if (!body) return null;
  // Scaffold the per-role hand-off sections so every task PRD carries the role
  // structure each participant fills (§5.7) — the shared hand-off contract.
  const prd = scaffoldPrdSections(buildPrdWithAttribution(body, args.agentLabel, args.taskId));

  const specId = existing?.id ?? crypto.randomUUID();
  const now = new Date();
  try {
    await db
      .insert(specs)
      .values({ id: specId, tenantId: args.tenantId, projectId: args.projectId, goal: args.title, status: 'draft', prd, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [specs.id], set: { prd, goal: args.title, updatedAt: now } });
  } catch (error) { /* persistence failed — still return the PRD for use as context */ 
    reportCaughtError(error, { source: "application/prd/taskPrd.ts", operation: "ensureTaskPrdRecord" });
  }

  await linkSpecToTask(db, { taskId: args.taskId, specId, tenantId: args.tenantId, isPrimary: true });
  return { specId, prd, status: existing?.id ? 'updated' : 'created' };
}

export interface AppendPrdRevisionResult { specId: string; prd: string }

/**
 * Append a signed directive revision to a task's PRD and persist it — closing the
 * "PRD is never updated per run" gap. A steer or follow-up directive becomes a
 * dated, attributed section on the task's primary PRD, so the spec evolves with the
 * work instead of being frozen at first draft. Creates a PRD shell if the task has
 * none yet (a directive before any draft still gets recorded). Never throws —
 * returns null only if persistence is impossible. Pure string assembly lives in
 * {@link appendPrdRevision}; this owns the DB read/write.
 */
export async function appendTaskPrdRevision(
  db: Db,
  args: {
    taskId: number;
    tenantId: number;
    projectId: number;
    agentLabel: string;
    directive: string;
    executionId?: number | null;
    isoTimestamp: string;
  },
): Promise<AppendPrdRevisionResult | null> {
  const directive = args.directive.trim();
  if (!directive) return null;
  const existing = await findTaskPrimarySpec(db, args.taskId);
  const base = existing?.prd?.trim()
    ? existing.prd.trim()
    : buildPrdWithAttribution('_(PRD drafted from a follow-up directive — see the revisions below.)_', args.agentLabel, args.taskId);
  const prd = appendPrdRevision(base, { agentLabel: args.agentLabel, directive, executionId: args.executionId ?? null, isoTimestamp: args.isoTimestamp });

  const specId = existing?.id ?? crypto.randomUUID();
  const now = new Date();
  try {
    await db
      .insert(specs)
      .values({ id: specId, tenantId: args.tenantId, projectId: args.projectId, goal: 'Task PRD', status: 'draft', prd, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [specs.id], set: { prd, updatedAt: now } });
  } catch {
    return null;
  }
  if (!existing?.id) {
    await linkSpecToTask(db, { taskId: args.taskId, specId, tenantId: args.tenantId, isPrimary: true });
  }
  return { specId, prd };
}

/** Why a section edit could not be applied. Typed so the tool can tell the model what
 *  to do next — retry a real heading, or append instead of editing. */
export type EditPrdSectionFailure = 'no_prd' | 'section_not_found' | 'persist_failed';

export type EditPrdSectionResult =
  | { ok: true; specId: string; prd: string; section: string }
  | { ok: false; reason: EditPrdSectionFailure; sections?: string[] };

/**
 * Rewrite ONE `## ` section of a task's PRD and persist it — the correcting twin of
 * {@link appendTaskPrdRevision}. Pure string surgery lives in {@link replacePrdSection};
 * this owns the DB read/write, so `specs` still has exactly ONE writer for a task PRD.
 *
 * Deliberately refuses to CREATE a PRD (unlike the append path, which records a
 * directive that arrived before any draft): a section edit says "this part of the spec
 * is wrong", which is meaningless against a spec that does not exist. The run's PRD-first
 * prep is what creates one. Never throws.
 */
export async function editTaskPrdSection(
  db: Db,
  args: {
    taskId: number;
    tenantId: number;
    agentLabel: string;
    heading: string;
    body: string;
    isoTimestamp: string;
  },
): Promise<EditPrdSectionResult> {
  const existing = await findTaskPrimarySpec(db, args.taskId);
  const current = existing?.prd?.trim();
  if (!existing?.id || !current) return { ok: false, reason: 'no_prd' };

  // Sign the rewritten section in place. A later edit replaces the whole body, so the
  // signature is refreshed rather than accumulated — the section always says who last
  // owned it, which is the "each agent signs its change" contract applied to a rewrite.
  const signed = `${args.body.trim()}\n\n_— rewritten by ${args.agentLabel} · ${args.isoTimestamp}_`;
  const edit = replacePrdSection(current, args.heading, signed);
  if (!edit.ok) return { ok: false, reason: 'section_not_found', sections: edit.sections };

  try {
    await db
      .update(specs)
      .set({ prd: edit.prd, updatedAt: new Date() })
      .where(scopedToTenant(specs, args.tenantId, eq(specs.id, existing.id)));
  } catch (error) {
    reportCaughtError(error, { source: 'application/prd/taskPrd.ts', operation: 'editTaskPrdSection' });
    return { ok: false, reason: 'persist_failed' };
  }
  return { ok: true, specId: existing.id, prd: edit.prd, section: edit.section };
}
