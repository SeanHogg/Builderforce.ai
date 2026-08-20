import { Task } from '../../domain/task/Task';
import { TaskPriority } from '../../domain/shared/types';
import type { Env } from '../../env';
import { ideProxy, readProxyChoice } from '../llm/LlmProxyService';
import { normalizeEstimateDays } from '../planning/scheduleWork';

/**
 * One planned child task produced by decomposing an Epic. The decomposer only
 * decides the *shape* of the work (title/description/priority + optional
 * fan-out assignee); TaskService is responsible for materialising these into
 * real `tasks` rows linked back to the Epic.
 *
 * Assignee fields mirror the mutual-exclusion rule on a task: a child is fanned
 * out to EITHER a human (`assignedUserId`) OR an agent (host / cloud ref), never
 * more than one. All three are optional — an unassigned child lands in the
 * backlog for a human to triage.
 */
export interface ChildTaskPlan {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedUserId?: string | null;
  assignedAgentHostId?: number | null;
  assignedAgentRef?: string | null;
  /** Best-fit producer role for this child (developer, qa-tester, …) — drives
   *  role-aware auto-assignment of the fanned-out child. Undefined = no constraint. */
  roleKey?: string | null;
  /**
   * Working-day size estimate. Consumed by `scheduleWork.scheduleItems` at fan-out
   * so the child lands with a real start/due window instead of the nulls every
   * decomposed child used to carry. Absent → the shared default estimate.
   */
  estimateDays?: number | null;
  /**
   * Index of the SIBLING in this same plan that must finish before this child
   * starts (finish-to-start). Null/absent = can start with the parent. Materialised
   * as a real `task_dependencies` edge at fan-out, which is what puts sequence on
   * the planning spine. Must reference an EARLIER index — a forward or self
   * reference is dropped, so a plan can never encode a cycle.
   */
  dependsOnIndex?: number | null;
}

/** The producer roles a decomposed child can be routed to. Aligns with roleCatalog
 *  keys so role→capable-agent resolution is deterministic. 'unknown' ⇒ no constraint. */
const CHILD_ROLE_KEYS = ['developer', 'qa-tester', 'architect', 'tech-writer', 'designer', 'devops', 'security', 'business-analyst', 'unknown'] as const;

/** Which reasoning step actually produced a plan. Persisted on the Epic so a human
 *  can tell a real BA assessment from the degraded text-parsing fallback. */
export type DecompositionSource = 'llm' | 'heuristic' | 'manual';

/** Verdict from assessing whether an agent-assigned task is really an Epic. */
export interface DecompositionPlan {
  /** True when the task is too large to execute directly and should become an Epic. */
  isEpic: boolean;
  /** The child tasks to fan out (only meaningful when `isEpic`). */
  children: ChildTaskPlan[];
  /** Who produced this plan — the LLM assessment or the deterministic fallback. */
  source: DecompositionSource;
}

/**
 * Port for the agent reasoning step that runs when a task is assigned to an
 * agent: a BA-style agent assesses scope and, if the item is really an Epic,
 * returns the child breakdown. Swap a real LLM-backed implementation in here
 * (e.g. an `ideProxy(env)` completion that returns a structured plan) without
 * touching the TaskService fan-out machinery.
 */
export interface EpicDecomposer {
  assess(task: Task): Promise<DecompositionPlan>;
}

/**
 * MINIMAL IMPLEMENTATION (deterministic, no LLM).
 *
 * Stands in for the agent reasoning step so the data-model + fan-out path is
 * fully exercised and tested today, and it is what {@link llmEpicDecomposer}
 * degrades to on ANY model failure — so its output quality is a production
 * concern, not a test convenience.
 *
 * Heuristic: a task whose description contains an explicit checklist (markdown
 * `- [ ]` / `- ` / numbered `1.` lines) is treated as an Epic and each list item
 * that survives {@link checklistItemTitle} becomes a child task. Markdown
 * sub-headers, label-only lines and one-word categories are NOT work and are
 * rejected; a description that yields more than {@link MAX_HEURISTIC_CHILDREN}
 * bullets is a document rather than a checklist and is not decomposed at all.
 * No checklist → not an Epic (the agent executes it directly).
 *
 * It infers no estimates or sequence (a bare bullet carries neither), so its
 * children fall back to the shared default estimate and schedule in parallel —
 * dated, but flat. That difference is exactly why the producing decomposer is
 * recorded on the Epic (`decompositionSource`).
 */
export const heuristicEpicDecomposer: EpicDecomposer = {
  async assess(task: Task): Promise<DecompositionPlan> {
    const children = parseChecklist(task.description);
    // A description that parses into a LOT of bullets is a document (a PRD, a spec,
    // a design note), not a checklist — shredding it line-by-line is exactly how the
    // board filled with markdown fragments. Past the cap we decline to call it an
    // Epic at all and leave the item for a real assessment.
    if (children.length > MAX_HEURISTIC_CHILDREN) return { isEpic: false, children: [], source: 'heuristic' };
    return { isEpic: children.length >= 2, children, source: 'heuristic' };
  },
};

const DECOMP_SYSTEM_PROMPT =
  'You are a senior BA/tech-lead assessing whether a work item is too large to execute in one pass. ' +
  'If it is a single, directly-executable task, reply isEpic=false with an empty children array. ' +
  'If it is genuinely an EPIC (multiple independently-shippable pieces), reply isEpic=true with 2-8 child tasks — ' +
  'each a concrete, independently-assignable unit of work with a clear title and a one-line description. ' +
  'For each child also pick the best-fit producer ROLE (developer, qa-tester, architect, tech-writer, designer, ' +
  'devops, security, business-analyst) — use "unknown" only if genuinely unclear. ' +
  'PLAN THE WORK IN TIME, not just in pieces: give every child an estimateDays (whole WORKING days, 1-20) ' +
  'sized to that child alone, and set dependsOnIndex to the 0-based index of the EARLIER sibling that must ' +
  'finish before it can start (use -1 when it can start immediately, in parallel with the others). ' +
  'dependsOnIndex must always be smaller than the child\'s own index. Only claim a dependency that is real — ' +
  'work that can genuinely run in parallel should say -1 so the plan is not needlessly serialised. ' +
  'Prefer FEWER, larger children over micro-tasks. Reply with JSON only.';

const DECOMP_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'epic_decomposition',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['isEpic', 'children'],
      properties: {
        isEpic: { type: 'boolean' },
        children: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'description', 'priority', 'roleKey', 'estimateDays', 'dependsOnIndex'],
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
              roleKey: { type: 'string', enum: [...CHILD_ROLE_KEYS] },
              /** Whole working days for THIS child alone. */
              estimateDays: { type: 'integer', minimum: 1, maximum: 20 },
              /** 0-based index of the earlier sibling that must finish first; -1 = none. */
              dependsOnIndex: { type: 'integer', minimum: -1 },
            },
          },
        },
      },
    },
  },
};

const VALID_PRIORITIES = new Set<string>(['low', 'medium', 'high', 'urgent']);

/**
 * LLM-backed decomposer — real BA-style scope assessment via the FREE model pool
 * (`ideProxy`, so it spends nothing on paid vendors). Returns the same
 * {@link DecompositionPlan} shape as the heuristic. Best-effort by contract: ANY
 * failure (kill switch, malformed reply, no LLM) falls back to
 * {@link heuristicEpicDecomposer} so on-assign decomposition ALWAYS produces a
 * defensible answer and never blocks task creation on model availability.
 */
export function llmEpicDecomposer(env: Env): EpicDecomposer {
  return {
    async assess(task: Task): Promise<DecompositionPlan> {
      try {
        const plain = task.toPlain();
        const userPrompt =
          `Title: ${plain.title}\n` +
          (plain.description ? `Description: ${String(plain.description).slice(0, 4000)}\n` : '') +
          '\nAssess this work item.';
        const result = await ideProxy(env).complete({
          messages: [
            { role: 'system', content: DECOMP_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0,
          max_tokens: 900,
          response_format: DECOMP_SCHEMA,
          useCase: 'epic_decomposition',
        });
        if (result.response.status >= 400) return heuristicEpicDecomposer.assess(task);
        const { content } = await readProxyChoice(result);
        if (!content) return heuristicEpicDecomposer.assess(task);
        const obj = JSON.parse(content) as { isEpic?: unknown; children?: unknown };
        // Index-mapped, THEN filtered: dependsOnIndex refers to the model's own
        // numbering, so dropping an invalid child first would silently re-point every
        // later dependency at the wrong sibling. Positions are remapped after the drop.
        const raw = Array.isArray(obj.children) ? obj.children : [];
        const mapped = raw.map((c) => {
          const o = c as Record<string, unknown>;
          const title = typeof o.title === 'string' ? o.title.trim().slice(0, 500) : '';
          if (!title) return null;
          const priority = typeof o.priority === 'string' && VALID_PRIORITIES.has(o.priority)
            ? (o.priority as TaskPriority) : undefined;
          const roleKey = typeof o.roleKey === 'string' && o.roleKey !== 'unknown' && (CHILD_ROLE_KEYS as readonly string[]).includes(o.roleKey)
            ? o.roleKey : undefined;
          const estimateDays = typeof o.estimateDays === 'number' && Number.isFinite(o.estimateDays)
            ? normalizeEstimateDays(o.estimateDays) : undefined;
          const rawDep = typeof o.dependsOnIndex === 'number' && Number.isFinite(o.dependsOnIndex)
            ? Math.trunc(o.dependsOnIndex) : -1;
          return {
            plan: {
              title,
              description: typeof o.description === 'string' ? o.description.slice(0, 2000) : null,
              ...(priority ? { priority } : {}),
              ...(roleKey ? { roleKey } : {}),
              ...(estimateDays ? { estimateDays } : {}),
            } as ChildTaskPlan,
            rawDep,
          };
        });
        // Old index → new index, so surviving dependencies still point at the sibling
        // the model meant. A dependency on a dropped child becomes "no dependency".
        const remap = new Map<number, number>();
        const kept: Array<{ plan: ChildTaskPlan; rawDep: number }> = [];
        mapped.forEach((entry, oldIndex) => {
          if (!entry) return;
          remap.set(oldIndex, kept.length);
          kept.push(entry);
        });
        const children: ChildTaskPlan[] = kept.map((entry, newIndex) => {
          const target = entry.rawDep >= 0 ? remap.get(entry.rawDep) : undefined;
          // Only a strictly EARLIER sibling is a legal predecessor — that invariant is
          // what makes a decomposed plan acyclic by construction.
          const dependsOnIndex = target !== undefined && target < newIndex ? target : null;
          return { ...entry.plan, dependsOnIndex };
        });
        // Only treat it as an Epic when the model both says so AND gave ≥2 real children
        // (a 1-child "epic" is just a task); otherwise fall back so nothing is lost.
        if (obj.isEpic === true && children.length >= 2) return { isEpic: true, children, source: 'llm' };
        if (obj.isEpic === false) return { isEpic: false, children: [], source: 'llm' };
        return heuristicEpicDecomposer.assess(task);
      } catch {
        return heuristicEpicDecomposer.assess(task);
      }
    },
  };
}

/**
 * Beyond this many parsed bullets, the description is a DOCUMENT, not a checklist —
 * see {@link heuristicEpicDecomposer}.
 */
const MAX_HEURISTIC_CHILDREN = 12;

/** `- `, `* `, `- [ ] `, `- [x] `, `1. `, `1) ` — the bullet forms we accept. */
const BULLET_RE = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+)$/;
/** A markdown ATX heading (`## Data model`) is structure, never a work item. */
const HEADING_RE = /^#{1,6}\s/;
/**
 * A leading emphasised LABEL introducing a clause — `**Data Model**: create the …`.
 * The label is section structure; the clause after it is the actual work, so we keep
 * the clause and drop the label rather than titling a ticket `**Data Model**: …`.
 */
const LEADING_LABEL_RE = /^(?:\*\*|__)[^*_]{1,60}(?:\*\*|__)\s*[:—-]\s*(.+)$/;

/**
 * Turn ONE markdown line into a child title, or null when the line is not work.
 *
 * This is the fix for boards filling with markdown fragments: the old parser took
 * every bullet verbatim, so a spec's `- **API Endpoints**:` sub-header became a
 * ticket titled `**API Endpoints**:` with no content and no owner.
 */
export function checklistItemTitle(rawLine: string): string | null {
  const line = rawLine.trim();
  if (!line || HEADING_RE.test(line)) return null;

  const bullet = line.match(BULLET_RE)?.[1]?.trim();
  if (!bullet) return null;

  return workItemTitle(bullet);
}

/**
 * The WORK test itself, applied to bullet-free text: is this a title somebody
 * could be assigned, or is it structure?
 *
 * Split out of {@link checklistItemTitle} so the exact same rule can be asked of a
 * title that already exists as a row (see {@link isWorkItemTitle}). The two must
 * never diverge: a cleanup review that flagged a different set than the parser
 * rejects would be offering to delete tickets the parser would happily re-create.
 */
export function workItemTitle(text: string): string | null {
  const content = text.trim();
  // A heading is structure whether it arrived as a bullet or as a stored title.
  if (!content || HEADING_RE.test(content)) return null;

  // `**Data Model**: Create a Capability entity` → `Create a Capability entity`.
  const item = (content.match(LEADING_LABEL_RE)?.[1] ?? content).trim();

  // Compare on the de-emphasised text so `**API Endpoints**:` is judged as
  // `API Endpoints:` — a label, not an instruction.
  const bare = item.replace(/[*_`~]/g, '').trim();
  if (!bare) return null;
  // A trailing colon means the line INTRODUCES content rather than being content.
  if (bare.endsWith(':')) return null;
  // A single word is a category, not an assignable unit of work.
  if (bare.split(/\s+/).filter(Boolean).length < 2) return null;

  return item.slice(0, 500);
}

/** Pull checklist-style lines out of a markdown description into child plans. */
function parseChecklist(description: string | null): ChildTaskPlan[] {
  if (!description) return [];
  const out: ChildTaskPlan[] = [];
  for (const raw of description.split('\n')) {
    const title = checklistItemTitle(raw);
    // No estimate/sequence is inferable from a bare bullet — the fan-out applies the
    // shared default and leaves the items parallel.
    if (title) out.push({ title });
  }
  return out;
}

/**
 * Identity key for a child title — case/whitespace-insensitive.
 *
 * The ONE definition, because two places have to agree on it or they create the
 * bug between them: {@link TaskService.decomposeEpic} reconciles a re-decomposition
 * against existing children by this key, and the decomposition-cleanup review finds
 * DUPLICATE siblings by it. If those two ever normalised differently, re-planning
 * would create the very duplicates the cleanup review then offered to merge.
 */
export function normalizeChildTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Does this stored task TITLE describe a unit of work?
 *
 * {@link checklistItemTitle} answers that for a markdown LINE at parse time. This is
 * the same question asked of a row that already exists — the tickets the pre-guard
 * decomposer created (`**API Endpoints**:`, one-word categories, `## Data model`)
 * are still live on the board, and finding them has to use the same rule that now
 * rejects them, or the review would flag a different set than the parser would.
 */
export function isWorkItemTitle(title: string): boolean {
  return workItemTitle(title) != null;
}
