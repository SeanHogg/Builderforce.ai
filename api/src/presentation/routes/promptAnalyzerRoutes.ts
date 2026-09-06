/**
 * Prompt Analyzer — /api/prompt-analyzer
 *
 * Telemetry → improved prompt. Companion to the prompt library (kept in its own
 * file so promptLibraryRoutes stays a straight CRUD surface). Reads a prompt's
 * adoption stats + current body and asks the tenant's connected LLM to propose a
 * stronger revision, returned as a DRAFT the caller can review and (optionally)
 * save as a new version via POST /api/prompts/:id/versions — never auto-saved.
 *
 *   POST /:id/analyze     propose an improved prompt body (draft)   [member]
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { promptLibraryEntries, promptLibraryVersions } from '../../infrastructure/database/schema';
import { completeJson } from '../../application/llm/completeJson';
import { readProxyChoice } from '../../application/llm/LlmProxyService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

interface AnalyzerSuggestion {
  suggestion?: string;
  rationale?: string;
}

/** The model's answer as `{ suggestion, rationale }`, or null for anything that is not an object. */
function readSuggestion(value: unknown): AnalyzerSuggestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return {
    ...(typeof raw.suggestion === 'string' ? { suggestion: raw.suggestion } : {}),
    ...(typeof raw.rationale === 'string' ? { rationale: raw.rationale } : {}),
  };
}

export function createPromptAnalyzerRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.post('/:id/analyze', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const id = c.req.param('id');

    const [entry] = await db
      .select()
      .from(promptLibraryEntries)
      .where(and(eq(promptLibraryEntries.id, id), eq(promptLibraryEntries.tenantId, tenantId)));
    if (!entry) return c.json({ error: 'Prompt not found' }, 404);

    const [current] = await db
      .select()
      .from(promptLibraryVersions)
      .where(and(eq(promptLibraryVersions.entryId, id), eq(promptLibraryVersions.version, entry.currentVersion)));
    const body = current?.body?.trim();
    if (!body) return c.json({ error: 'Prompt has no current version body' }, 400);

    const stats = {
      usageCount: entry.usageCount,
      starCount: entry.starCount,
      versions: entry.currentVersion,
      category: entry.category ?? 'general',
    };

    const system = [
      'You are a prompt engineering expert. You improve a reusable prompt TEMPLATE so it',
      'is clearer, more robust, and produces higher-quality model output. Preserve every',
      '{{variable}} placeholder that appears in the original (you may add new ones only if',
      'clearly beneficial). Do not invent facts. Keep the same intent and language.',
      'Respond with STRICT JSON: {"suggestion": "<the full improved prompt body>",',
      '"rationale": "<2-4 sentences on what you changed and why>"}. No prose outside the JSON.',
    ].join(' ');

    const user = [
      `Prompt title: ${entry.title}`,
      entry.description ? `Description: ${entry.description}` : '',
      `Category: ${stats.category}`,
      `Adoption so far — uses: ${stats.usageCount}, stars: ${stats.starCount}, versions: ${stats.versions}.`,
      '',
      'Current prompt body:',
      '"""',
      body,
      '"""',
    ].filter(Boolean).join('\n');

    // The prompt asks for JSON in prose, so no response_format: the gateway's
    // conformance retry would otherwise fight a model that answers with a fenced
    // block, and the reader below tolerates one anyway.
    const out = await completeJson<AnalyzerSuggestion>(
      { kind: 'tenant', env: c.env, tenantId, opts: { meterUseCase: 'prompt_analyzer', userId: userId ?? null } },
      { system, user, temperature: 0.4, maxTokens: 4000, useCase: 'prompt_analyzer' },
      readSuggestion,
    );

    if (!out.ok && out.reason === 'gateway') {
      return c.json({ error: out.status ? `gateway ${out.status}` : 'analysis failed' }, 502);
    }

    const suggestion = out.ok ? out.value.suggestion?.trim() : undefined;
    if (!out.ok || !suggestion) {
      // No structured suggestion — return the raw text so the UI can still show it.
      const text = out.ok ? (out.result ? (await readProxyChoice(out.result)).content : '') : (out.content ?? '');
      return c.json({ suggestion: text.trim(), rationale: null, stats, basedOnVersion: entry.currentVersion });
    }
    return c.json({
      suggestion,
      rationale: out.value.rationale?.trim() ?? null,
      stats,
      basedOnVersion: entry.currentVersion,
    });
  });

  return router;
}
