/** Diagnostics and Idea → Real realization targets. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { toolsApi } from '@/lib/builderforceApi';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { answersComplete, defaultInput, questionIds, type ToolResult } from '@/lib/tools';
import { createCanvasRealization, listRealizationTargets, primaryRealizationDoc, rankRealizationIdea, type RealizationView } from '@/lib/canvasRealize';
import { getStoredTenantToken } from '@/lib/auth';
import { accountGateResult } from './accountGate';
import { CANVAS_REALIZE_ACCOUNT_GATE } from '@builderforce/creation-canvas-contract';
import type { CanvasActionContext } from './context';

export function canvasRealizationActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, requireAccount, sessionId, stage, t } = ctx;
  return [  {
    /**
     * The diagnostics catalog, on the board (PRD 21 §11.4.5).
     *
     * `/tools/<id>` is the REFERENCE page for a diagnostic — where you read what
     * it measures. This pair is where you USE it: the capability reaches the
     * canvas as a tool Brain can call, not as a canvas mounted on a marketing
     * URL, which is what it used to be.
     *
     * Listed separately from `canvas_add_diagnostic` for the reason
     * `creative.capabilities` is separate from `creative.compose`: a model that
     * has to guess an id before it can see the catalog guesses, and a wrong
     * `toolId` is a 404 the user reads as "the diagnostic does not exist".
     */
    name: 'canvas_list_diagnostics',
    description: 'List the free diagnostics and calculators this platform can run (id, name, what it measures, whether it is a calculator/assessment/quiz, and whether it also has a data-driven mode). Call this BEFORE canvas_add_diagnostic whenever the exact diagnostic id is not already known — for "what can you assess?", "estimate my AI spend", "how mature is our delivery?", "check our DORA metrics", "governance readiness".',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    mutates: false,
    run: async () => {
      try {
        const catalog = await toolsApi.list();
        return { diagnostics: catalog.map((entry) => ({
          id: entry.id, name: entry.name, about: entry.tagline,
          category: entry.category, kind: entry.kind, hasDataDriven: entry.hasDataDriven === true,
          referencePage: `/tools/${entry.id}`,
        })) };
      } catch (error) {
        return { error: toolErrorMessage(error, 'The diagnostics catalog could not be read.') };
      }
    },
  },   {
    name: 'canvas_add_diagnostic',
    description: 'Put a diagnostic or calculator on the canvas as a live object the user can answer in place. Pass `answers` (question id → number, as listed by this tool when called without them) to ALSO compute the result and land the object already scored. Use this for "add the AI cost estimator", "run the maturity assessment on the board", "score our delivery". Get the id from canvas_list_diagnostics first.',
    parameters: {
      type: 'object', required: ['toolId'], additionalProperties: false,
      properties: {
        toolId: { type: 'string', description: 'Catalog id, e.g. from canvas_list_diagnostics.' },
        answers: { type: 'object', description: 'Question/input id → numeric answer. Omit to place an unanswered object for the user to fill in.', additionalProperties: { type: 'number' } },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { toolId?: string; answers?: Record<string, unknown>; x?: number; y?: number };
      const toolId = typeof args.toolId === 'string' ? args.toolId.trim() : '';
      if (!toolId) return { error: 'Say which diagnostic. Call canvas_list_diagnostics for the ids.' };

      let definition: Awaited<ReturnType<typeof toolsApi.get>>;
      try {
        definition = await toolsApi.get(toolId);
      } catch {
        const catalog = await toolsApi.list().catch(() => []);
        return { error: catalog.length
          ? `No diagnostic '${toolId}'. Available: ${catalog.map((entry) => entry.id).join(', ')}.`
          : `No diagnostic '${toolId}'.` };
      }

      // Only the questions this diagnostic actually has: a model that invents an
      // extra key would otherwise get a result scored against a shape the tool
      // does not define, which is a number that looks computed and is not.
      const accepted = new Set(questionIds(definition));
      const answers: Record<string, number> = {};
      for (const [key, value] of Object.entries(args.answers ?? {})) {
        if (accepted.has(key) && Number.isFinite(Number(value))) answers[key] = Number(value);
      }
      const input = Object.keys(answers).length ? { ...defaultInput(definition), ...answers } : {};
      const complete = Object.keys(answers).length > 0 && answersComplete(definition, input);

      let result: ToolResult | null = null;
      if (complete) {
        try {
          result = await toolsApi.compute(toolId, input);
        } catch (error) {
          return { error: toolErrorMessage(error, 'That diagnostic could not be scored.') };
        }
      }

      const node = stage.createObject('diagnostics', args);
      node.data = {
        ...node.data,
        title: definition.name,
        subtitle: definition.about,
        toolId,
        toolIcon: definition.icon,
        toolInput: input,
        ...(result ? {
          toolResult: result, result,
          status: result.scoreLabel || result.headline,
          qualityScore: result.score, qualityLabel: result.scoreLabel, qualityHeadline: result.headline,
          summary: result.summary,
          recommendations: result.recommendations,
          results: result.metrics.map((metric) => ({ title: metric.label, result: metric.value, detail: metric.hint })),
          gapCount: result.recommendations.length,
        } : { status: 'Ready to run' }),
      };
      node.style = { width: 760 };
      stage.addObject(`Add diagnostic “${definition.name}”`, node);
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'diagnostics', title: definition.name },
        toolId, kind: definition.kind, referencePage: `/tools/${toolId}`,
        // Unanswered, the model needs the question ids to be able to offer to
        // fill them in; answered, it needs the score to be able to talk about it.
        ...(result ? { result } : { questions: [...accepted], awaitingAnswers: true }),
      };
    },
  },   {
    /**
     * The catalog half of "Idea → Real" — the 8 tested proof forms `canvas_realize`
     * builds from. Static copy, no tenant — guest-safe for the same reason
     * `canvas_list_diagnostics` is.
     */
    name: 'canvas_list_realization_targets',
    description: 'List the 8 tested "Idea → Real" proof forms this platform can build — a phone line, a pilot, a smoke test, a live system, and others — with what each one answers, its fidelity and its effort. Call this BEFORE canvas_realize whenever the right targetKey is not already obvious, or to show the user their options.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    mutates: false,
    run: async () => {
      try {
        const { targets } = await listRealizationTargets();
        return { targets };
      } catch (error) {
        return { error: toolErrorMessage(error, 'The realization catalog could not be read.') };
      }
    },
  },   {
    /**
     * Turns an idea into one of the 8 tested proofs through the SAME pipeline
     * `/realize` uses (`planRealization` + `POST /api/realizations`) — never an
     * improvisation. GUEST-GATED rather than absent: see CANVAS_REALIZE_ACCOUNT_GATE
     * and the note beside this tool in the contract for the measured failure this
     * closes (2026-08-29: a signed-in board asked for a phone line got an unrunnable
     * legacy `workflow` card with zero authored steps, and a hand-typed Twilio guide
     * with the wrong webhook URLs and no WEBHOOK_SHARED_SECRET).
     *
     * Deliberately PLANS ONLY — it never calls `/api/realizations/:id/build`. That
     * second step provisions a real project, seeds a board of tickets and wires
     * external connectors, and the realization API's own contract is that a human
     * reviews the plan before any of that exists (see the docstring on
     * `POST /api/realizations/:id/build`). The plan itself lands on the board
     * immediately as the real generated document; going live is one click away.
     */
    name: 'canvas_realize',
    description: 'Turn an idea into one of the platform\'s 8 tested "Idea → Real" proofs — a phone line with real Twilio-signed routes, a pilot, a smoke test, a live production system, etc. — using the platform\'s own realization pipeline, the exact one the /realize page uses. Use this instead of canvas_add_object whenever the user asks to "stand up", "build" or "make real" something matching one of these proof forms. Call canvas_list_realization_targets first if the right targetKey is not obvious; omit it to auto-rank the idea against all 8 and use the top match.',
    parameters: {
      type: 'object', required: ['idea'], additionalProperties: false,
      properties: {
        idea: { type: 'string', description: 'What to build, in the user\'s own words — the fuller the brief, the better the generated routes, copy and tasks.' },
        targetKey: { type: 'string', description: 'One of the keys from canvas_list_realization_targets, e.g. "phone-line". Omit to auto-rank the idea and use the top recommendation.' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      if (!getStoredTenantToken()) {
        requireAccount('realize', t('gateRealizeTitle'), t('gateRealizeBody'));
        return accountGateResult('canvas_realize', CANVAS_REALIZE_ACCOUNT_GATE);
      }
      const args = raw as { idea?: string; targetKey?: string };
      const idea = typeof args.idea === 'string' ? args.idea.trim() : '';
      if (!idea) return { error: 'Say what to build.' };

      let targetKey = typeof args.targetKey === 'string' ? args.targetKey.trim() : '';
      if (!targetKey) {
        try {
          const ranked = await rankRealizationIdea(idea, sessionId);
          const top = ranked.recommendations[0];
          if (!top) return { error: 'No realization target matched that idea. Call canvas_list_realization_targets and name one with targetKey.' };
          targetKey = top.key;
        } catch (error) {
          return { error: toolErrorMessage(error, 'The idea could not be read.') };
        }
      }

      let realization: RealizationView;
      try {
        realization = (await createCanvasRealization({ idea, targetKey, sessionId })).realization;
      } catch (error) {
        return { error: toolErrorMessage(error, `That could not be planned as a "${targetKey}".`) };
      }

      const doc = primaryRealizationDoc(realization.plan.files ?? {});
      const node = stage.createObject('document');
      node.data = {
        ...node.data,
        title: `${realization.title} — ${realization.plan.blueprintName}`,
        subtitle: realization.plan.summary,
        content: doc?.content ?? realization.plan.summary,
        status: 'Plan ready',
      };
      stage.addObject(`Realize "${realization.title}"`, node);

      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'document', title: String(node.data.title), created: true },
        realizationId: realization.id, targetKey: realization.targetKey,
        summary: realization.plan.summary,
        tasks: realization.plan.tasks,
        requiredConnectors: realization.plan.requiredConnectors,
        requiredSecrets: realization.plan.requiredSecrets,
        nextStep: `The plan is on the board. Open /realize/${realization.id} to review it and build it live — that step creates the real project, publishes it and wires its connectors.`,
      };
    },
  }];
}
