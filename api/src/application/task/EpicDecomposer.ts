import { Task } from '../../domain/task/Task';
import { TaskPriority } from '../../domain/shared/types';
import type { Env } from '../../env';
import { ideProxy, readProxyChoice } from '../llm/LlmProxyService';

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
}

/** The producer roles a decomposed child can be routed to. Aligns with roleCatalog
 *  keys so role→capable-agent resolution is deterministic. 'unknown' ⇒ no constraint. */
const CHILD_ROLE_KEYS = ['developer', 'qa-tester', 'architect', 'tech-writer', 'designer', 'devops', 'security', 'business-analyst', 'unknown'] as const;

/** Verdict from assessing whether an agent-assigned task is really an Epic. */
export interface DecompositionPlan {
  /** True when the task is too large to execute directly and should become an Epic. */
  isEpic: boolean;
  /** The child tasks to fan out (only meaningful when `isEpic`). */
  children: ChildTaskPlan[];
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
 * fully exercised and tested today. Heuristic: a task whose description contains
 * an explicit checklist (markdown `- [ ]` / `- ` / numbered `1.` lines) is
 * treated as an Epic and each list item becomes a child task. No checklist →
 * not an Epic (the agent executes it directly).
 *
 * Replace `assess` with an LLM call (returning the same `DecompositionPlan`
 * shape) to get real BA-style scope assessment; the rest of the pipeline is
 * production-ready.
 */
export const heuristicEpicDecomposer: EpicDecomposer = {
  async assess(task: Task): Promise<DecompositionPlan> {
    const children = parseChecklist(task.description);
    return { isEpic: children.length >= 2, children };
  },
};

const DECOMP_SYSTEM_PROMPT =
  'You are a senior BA/tech-lead assessing whether a work item is too large to execute in one pass. ' +
  'If it is a single, directly-executable task, reply isEpic=false with an empty children array. ' +
  'If it is genuinely an EPIC (multiple independently-shippable pieces), reply isEpic=true with 2-8 child tasks — ' +
  'each a concrete, independently-assignable unit of work with a clear title and a one-line description. ' +
  'For each child also pick the best-fit producer ROLE (developer, qa-tester, architect, tech-writer, designer, ' +
  'devops, security, business-analyst) — use "unknown" only if genuinely unclear. ' +
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
            required: ['title', 'description', 'priority', 'roleKey'],
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
              roleKey: { type: 'string', enum: [...CHILD_ROLE_KEYS] },
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
        const children: ChildTaskPlan[] = Array.isArray(obj.children)
          ? obj.children
              .map((c) => {
                const o = c as Record<string, unknown>;
                const title = typeof o.title === 'string' ? o.title.trim().slice(0, 500) : '';
                if (!title) return null;
                const priority = typeof o.priority === 'string' && VALID_PRIORITIES.has(o.priority)
                  ? (o.priority as TaskPriority) : undefined;
                const roleKey = typeof o.roleKey === 'string' && o.roleKey !== 'unknown' && (CHILD_ROLE_KEYS as readonly string[]).includes(o.roleKey)
                  ? o.roleKey : undefined;
                return {
                  title,
                  description: typeof o.description === 'string' ? o.description.slice(0, 2000) : null,
                  ...(priority ? { priority } : {}),
                  ...(roleKey ? { roleKey } : {}),
                } as ChildTaskPlan;
              })
              .filter((c): c is ChildTaskPlan => c != null)
          : [];
        // Only treat it as an Epic when the model both says so AND gave ≥2 real children
        // (a 1-child "epic" is just a task); otherwise fall back so nothing is lost.
        if (obj.isEpic === true && children.length >= 2) return { isEpic: true, children };
        if (obj.isEpic === false) return { isEpic: false, children: [] };
        return heuristicEpicDecomposer.assess(task);
      } catch {
        return heuristicEpicDecomposer.assess(task);
      }
    },
  };
}

/** Pull checklist-style lines out of a markdown description into child plans. */
function parseChecklist(description: string | null): ChildTaskPlan[] {
  if (!description) return [];
  const out: ChildTaskPlan[] = [];
  for (const raw of description.split('\n')) {
    const line = raw.trim();
    // `- [ ] item`, `- [x] item`, `- item`, `* item`, or `1. item`
    const m = line.match(/^(?:[-*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+)$/);
    const item = m?.[1]?.trim();
    if (item) out.push({ title: item.slice(0, 500) });
  }
  return out;
}
