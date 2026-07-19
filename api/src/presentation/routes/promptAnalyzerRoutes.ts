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
import { completeForTenant } from '../../application/llm/tenantProxy';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Pull the JSON object out of an LLM completion that may be fenced / prosey. */
function extractJson(raw: string): { suggestion?: string; rationale?: string } | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  try {
    const parsed = JSON.parse(candidate);
    return typeof parsed === 'object' && parsed ? parsed : null;
  } catch {
    // A brace-delimited slice is the last resort before giving up.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* fall through */ }
    }
    return null;
  }
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

    let result;
    try {
      result = await completeForTenant(
        c.env,
        tenantId,
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.4,
        },
        { meterUseCase: 'prompt_analyzer', userId: userId ?? null },
      );
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'analysis failed' }, 502);
    }

    if (result.response.status >= 400) {
      return c.json({ error: `gateway ${result.response.status}` }, 502);
    }
    const raw = (await result.response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: unknown } }> }
      | null;
    const content = raw?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : '';
    const parsed = extractJson(text);

    const suggestion = parsed?.suggestion?.trim();
    if (!suggestion) {
      // No structured suggestion — return the raw text so the UI can still show it.
      return c.json({ suggestion: text.trim(), rationale: null, stats, basedOnVersion: entry.currentVersion });
    }
    return c.json({
      suggestion,
      rationale: parsed?.rationale?.trim() ?? null,
      stats,
      basedOnVersion: entry.currentVersion,
    });
  });

  return router;
}
