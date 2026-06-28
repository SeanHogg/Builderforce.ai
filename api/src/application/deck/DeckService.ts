/**
 * DeckService — the single orchestrator behind both deck entry points (the Brain
 * "generate deck" tool and the PMO download button). Resolves a template, gathers
 * the data, binds tokens, renders (generative pptxgenjs OR in-place fflate fill),
 * persists a generated_decks record + the .pptx in R2, and returns the bytes.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { generatedDecks } from '../../infrastructure/database/schema';
import { assembleDeckData, currentQuarter } from './dataSources';
import { resolveBindings } from './bindingResolver';
import { renderGenerativeDeck } from './render/GenerativeRenderer';
import { fillTemplate } from './inPlaceFiller';
import { getTemplate, getDefaultBoardTemplate, loadTemplateBytes } from './TemplateLibraryService';
import type { GenerateDeckInput, GenerateDeckResult, DeckTemplateRecord, DeckData } from './types';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'deck';
}

/** Render bytes for a resolved template + data (no persistence). Exposed for tests. */
export async function renderDeckBytes(
  env: Env,
  template: DeckTemplateRecord,
  data: DeckData,
  mode: 'generative' | 'fill',
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const resolved = resolveBindings(template.manifest, data);

  if (mode === 'fill') {
    if (!template.r2Key) throw new Error('Template has no uploaded .pptx to fill — use generative mode.');
    const bytes = await loadTemplateBytes(env, template.r2Key);
    if (!bytes) throw new Error('Template .pptx not found in storage.');
    return { bytes: fillTemplate(bytes, resolved), warnings: resolved.warnings };
  }

  // generative
  const archetype = template.archetype === 'cfo_devfinops' ? 'cfo_devfinops' : 'board';
  const bytes = await renderGenerativeDeck(data, archetype);
  return { bytes, warnings: resolved.warnings };
}

/**
 * Generate a deck end-to-end. `mode='fill'` requires a custom template with an
 * uploaded binary; `mode='generative'` renders our branded layout (works for the
 * built-in board/CFO templates with no binary). Persists + returns the bytes.
 */
export async function generateDeck(db: Db, env: Env, input: GenerateDeckInput): Promise<GenerateDeckResult> {
  const quarter = input.quarter || currentQuarter(Date.now());

  const template = input.templateId
    ? await getTemplate(db, input.tenantId, input.templateId)
    : await getDefaultBoardTemplate(db, input.tenantId);
  if (!template) throw new Error('Template not found');

  // A built-in (generative) template can't be "filled" (no binary) — coerce to
  // generative so the request still produces a deck.
  const mode = input.mode === 'fill' && !template.r2Key ? 'generative' : input.mode;

  const data = await assembleDeckData(db, env, input.tenantId, quarter);
  const { bytes, warnings } = await renderDeckBytes(env, template, data, mode);

  // Persist the record + the rendered .pptx in R2 (best-effort storage).
  const rows = (await db.insert(generatedDecks).values({
    tenantId: input.tenantId,
    templateId: template.id,
    mode,
    quarter,
    status: 'ready',
    warningsJson: warnings,
    createdBy: input.userId,
  }).returning({ id: generatedDecks.id })) as Array<{ id: string }>;
  const deckId = rows[0]?.id ?? crypto.randomUUID();

  const r2Key = `decks/${input.tenantId}/${deckId}.pptx`;
  if (env.UPLOADS) {
    try {
      await env.UPLOADS.put(r2Key, bytes, {
        httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
        customMetadata: { tenantId: String(input.tenantId), deckId },
      });
      await db.update(generatedDecks).set({ r2Key }).where(eq(generatedDecks.id, deckId));
    } catch { /* download still works from the returned bytes */ }
  }

  const filename = `${slugify(template.name)}-${quarter}.pptx`;
  return { deckId, bytes, filename, warnings };
}

/** Fetch a previously-generated deck's bytes from R2 (for the /:id/download route). */
export async function loadGeneratedDeck(db: Db, env: Env, tenantId: number, deckId: string): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const rows = await db.select().from(generatedDecks).where(eq(generatedDecks.id, deckId)).limit(1);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row || Number(row.tenantId) !== tenantId || !row.r2Key || !env.UPLOADS) return null;
  const obj = await env.UPLOADS.get(String(row.r2Key));
  if (!obj) return null;
  const bytes = new Uint8Array(await obj.arrayBuffer());
  return { bytes, filename: `deck-${String(row.quarter ?? '')}.pptx` };
}
