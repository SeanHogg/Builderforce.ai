/**
 * The MODEL objects — the Models palette group, declared as spec DATA.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * `llm` predates the spec-object primitive. Its fields were hand-declared in
 * `MUTABLE_FIELDS.llm` inside `creationObjectRegistry.ts`, which means there was no
 * `SpecField.derive` hook to hang a computation on — and that is the structural reason
 * `frontend/src/lib/canvasLlmCost.ts` was written, tested, and imported by nothing but
 * its own test. Worse, `projectedMonthlyCost` was an AUTHORABLE field: the model could
 * assert a monthly spend with no arithmetic behind it, sitting on the same card as the
 * rate card and the volume that contradict it. That is precisely the stored-total defect
 * `SpecField.derive` exists to forbid — one fact in one place, and never a total its own
 * rows can disagree with.
 *
 * So the rate card and the volume are AUTHORED, and every number computed from them —
 * cost per request, projected monthly cost, monthly tokens, the input/output split — is
 * DERIVED. There is no longer a way to type a price into this card.
 *
 * ── WHY `evermind` IS NOT IN THIS SET ────────────────────────────────────────────
 * It shares the group and it does not share the shape. `evermind` has a bespoke node
 * body (`EvermindBody` — a knowledge map, a learning feed, a recommended next action),
 * and `SpecObjectBody` renders EVERY registered spec kind: registering `evermind` here
 * would draw a second, redundant body underneath the one that already exists. The eleven
 * render styles are a closed set on purpose, and a live SVG knowledge map is not one of
 * them. It stays hand-declared until its body is expressible as a spec; the seam the
 * roadmap named — "a Models-group kind with no derive hook" — is closed for the kind that
 * needed one.
 *
 * ── WHY `cacheHitRate` IS NEW ────────────────────────────────────────────────────
 * `projectLlmCost` has always modelled prompt caching as a discount on INPUT tokens, and
 * nothing on the card supplied the rate — so the one lever that most changes an LLM
 * architecture's price was unreachable from the surface where the architecture is chosen.
 * See [[token-cost-optimization]].
 */

import { projectLlmCost, type LlmCostInputs } from './canvasLlmCost';
import { registerSpecObjectSet, SUMMARY_FIELD, type SpecObjectSpec } from './specObjects';

/** English fallbacks the palette shows before `creationCanvas.models.label.*` resolves.
 *  PLURAL, unlike every other vocabulary namespace: `creationCanvas.model` is already a
 *  flat label string the canvas renders ("Model", on the agent panel), and next-intl
 *  cannot hold a string and a namespace at one path — the singular would have silently
 *  replaced that label with a raw dotted key. The plural is also the palette GROUP's own
 *  name, which is what this set is filed under. */
export const MODEL_LABELS: Record<string, string> = {
  llm: 'LLM',
};

/** Blank-object statuses. A model card that has not been priced is a `Blueprint`, which
 *  is what it has always said and is the state that claims the least. */
export const MODEL_STATUSES: Record<string, string> = {
  blueprint: 'Blueprint',
};

/**
 * The projection, computed once per read.
 *
 * `null` for the WHOLE projection when any input is missing, rather than a per-field
 * fallback: a cost-per-request drawn from a complete rate card next to a blank monthly
 * total reads as "this is free at volume", and a partially-computed price is the most
 * expensive kind of wrong answer this card can produce. Same refusal `projectLlmCost`
 * already documents, applied at the field boundary.
 */
function projection(data: Record<string, unknown>) {
  const result = projectLlmCost(data as LlmCostInputs);
  return result.incomplete ? null : result;
}

export const MODEL_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  {
    kind: 'llm',
    icon: '◉',
    group: 'Models',
    defaultStatus: 'blueprint',
    actions: [],
    seed: { model: 'gpt-4o' },
    fields: [
      { name: 'model', render: 'stat', label: 'model', hint: 'The exact model slug this design calls, e.g. "claude-sonnet-5" or "gpt-4o-mini". Name the version — "the fast one" cannot be priced and cannot be reproduced.' },
      { name: 'instructions', render: 'text', label: 'instructions', hint: 'The system prompt this design sends. Write the real one, not a description of it: its length is an input to the cost below.' },
      {
        name: 'parameters',
        render: 'rows',
        label: 'parameters',
        columns: ['name', 'value'],
        hint: 'Decoding settings that change the answer or the bill: {name, value}. Temperature, top_p, max_tokens, stop sequences. `max_tokens` in particular is a spend cap, not a formatting preference.',
      },
      { name: 'promptObjectId', render: 'stat', label: 'promptObjectId', hint: 'Canvas id of the versioned `prompt` object this design sends. Bind it rather than pasting the text twice — two copies of a prompt is two prompts.' },
      // ── THE RATE CARD ────────────────────────────────────────────────────────
      { name: 'costPerMillionInput', render: 'stat', label: 'costPerMillionInput', hint: 'Published price per MILLION input tokens, in your billing currency. Take it from the provider current price list — a stale rate produces a confident wrong budget.' },
      { name: 'costPerMillionOutput', render: 'stat', label: 'costPerMillionOutput', hint: 'Published price per MILLION output tokens. Almost always several times the input rate, which is why the split below decides what is worth optimising.' },
      // ── THE VOLUME ───────────────────────────────────────────────────────────
      { name: 'tokensPerRequestIn', render: 'stat', label: 'tokensPerRequestIn', hint: 'Average input tokens per request, INCLUDING the system prompt and any retrieved context. Measure it on a real transcript; the estimate given from memory is habitually low by a factor of two.' },
      { name: 'tokensPerRequestOut', render: 'stat', label: 'tokensPerRequestOut', hint: 'Average output tokens per request. Cap it with `max_tokens` if this number is what makes the design unaffordable.' },
      { name: 'monthlyRequests', render: 'stat', label: 'monthlyRequests', hint: 'Requests per month at the volume you are designing FOR, not the volume you have today. The question this card answers is "what does this cost at scale".' },
      {
        name: 'cacheHitRate',
        render: 'stat',
        label: 'cacheHitRate',
        hint: 'Share of requests served from the provider prompt cache, 0–1 (0.8 = 80%). Discounts INPUT tokens only — the output is generated fresh every time, so a design that assumes caching discounts the whole request underestimates by roughly the output share.',
      },
      // ── LATENCY: authored, because it is measured and not computed ────────────
      { name: 'latencyP50Ms', render: 'stat', label: 'latencyP50Ms', hint: 'Median end-to-end latency in milliseconds, measured against this model at this prompt length.' },
      { name: 'latencyP95Ms', render: 'stat', label: 'latencyP95Ms', hint: 'p95 latency in milliseconds. This is the number a user experiences as "it is slow", not the median.' },
      // ── THE ARITHMETIC ───────────────────────────────────────────────────────
      {
        name: 'costPerRequest',
        render: 'stat',
        label: 'costPerRequest',
        hint: 'What one request costs at the rate card and token counts above. READ-ONLY: computed by the canvas, never authored.',
        derive: (data) => projection(data)?.costPerRequest,
      },
      {
        name: 'projectedMonthlyCost',
        render: 'stat',
        label: 'projectedMonthlyCost',
        hint: 'Cost per request × monthly requests. READ-ONLY: computed from the fields above and never authored — a price that can disagree with its own inputs will eventually be the one somebody quotes in a meeting.',
        derive: (data) => projection(data)?.monthlyCost,
      },
      {
        name: 'monthlyTokens',
        render: 'stat',
        label: 'monthlyTokens',
        hint: 'Total tokens per month, for the quota conversation that always follows the budget one. READ-ONLY: computed.',
        derive: (data) => projection(data)?.monthlyTokens,
      },
      {
        name: 'outputShare',
        render: 'meter',
        label: 'outputShare',
        hint: 'Share of the bill that is OUTPUT tokens, 0–100. Above roughly 70 the lever is shorter answers; below it, the lever is a shorter prompt or a higher cache hit rate. READ-ONLY: computed.',
        derive: (data) => {
          const result = projection(data);
          return result ? Math.round(result.outputShare * 100) : undefined;
        },
      },
      SUMMARY_FIELD,
    ],
  },
];

registerSpecObjectSet({ id: 'model', namespace: 'creationCanvas.models', specs: MODEL_OBJECT_SPECS });
