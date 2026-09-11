/**
 * The canvas's PROMPT-LIBRARY vocabulary: read a prompt with its history, save the
 * next version.
 *
 * ── WHAT THIS CLOSES ────────────────────────────────────────────────────────────
 * The `prompt` kind was declared as "the prompt as a VERSIONED artifact, backed by the
 * prompt library the platform already stores" (`creation-canvas-contract/src/
 * dataScience.ts`), and nothing on the canvas could reach that library. The fine-tune
 * loop has `canvas_read_training_run` over `ide_training_jobs`, and the forecast has
 * `canvas_forecast_series`. `prompt_library_entries` / `prompt_library_versions` had
 * nothing, so the daily work of prompt engineering (change it, look at the delta, keep
 * the winner) stayed behind the /prompts tab. The card's `save` action named a binding
 * (`entryId`) that no code wrote.
 *
 * ── TWO TOOLS, NOT ONE ──────────────────────────────────────────────────────────
 * Unlike `canvas_sync_job_posting`, the two directions here are different acts with
 * different consequences. READING puts history on the board and changes nothing
 * anywhere else. SAVING appends a row to the library that the /prompts page, the
 * analyzer and (for a public entry) the public gallery all serve from. A model that has
 * to pass a flag to choose between them will one day pass the wrong one, and a
 * version saved by accident is permanent history.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────────
 *   • It never overwrites an unsaved draft. Refreshing a card whose `body` differs from
 *     the library's current version keeps the board's text and says so. The draft is the
 *     work in progress, and a read that silently reverts it destroys the thing being
 *     iterated on.
 *   • It never saves a version that changes nothing. A history padded with identical
 *     rows is how "what changed in v7" stops having an answer.
 *   • It never re-points a card by title. A card whose `entryId` no longer resolves is
 *     reported, never re-created, because a second entry for the same prompt splits its
 *     history, its usage count and its stars.
 *   • It never changes what the public gallery serves without being told to. A new
 *     version of a PUBLIC entry is what every visitor who uses it gets next, which is an
 *     outbound act, so it needs `publishPublicly: true`, set only on the user's word.
 *   • It never writes a score. `versions.evalScore` stays empty until an evaluation
 *     produces one: the library stores no score, and inventing one is the defect the
 *     data-science vocabulary exists to refuse.
 *
 * ── WHY A MODULE AND NOT MORE OF CreationCanvas.tsx ─────────────────────────────
 * The same argument `canvasFounderOpsTools.ts` makes: pure functions over the injected
 * board context, so the projection and both tools unit-test without React or a board.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { promptLibraryApi, type PromptEntry, type PromptVariable, type PromptVersion } from '@/lib/builderforceApi';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';
import type { CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';

/** Cap on how many entries one listing returns. The library page is where the whole
 *  catalogue belongs; a turn needs enough to pick one. */
const MAX_LISTED = 25;
/** How much of each historical body goes back to the model. Enough to diff a real
 *  prompt, and bounded so a long history cannot take over the context window. */
const BODY_PREVIEW_CHARS = 4000;
/** How many of the newest versions carry their body in a read result. */
const RECENT_BODIES = 5;

/**
 * The browser read-through cache namespace for library reads.
 *
 * Keyed by canvas session as well as by entry. A board belongs to exactly one tenant,
 * so the session id stands in for the tenant, and a workspace switch can never be
 * answered from the previous workspace's library. Short-lived, because the /prompts
 * page writes through the same API without clearing this cache. Every write made HERE
 * clears the whole namespace, so a read straight after a save is never stale.
 */
export const PROMPT_LIBRARY_CACHE_PREFIX = 'prompt-library:';
const CACHE_TTL_MS = 60_000;
const listKey = (sessionId: string): string => `${PROMPT_LIBRARY_CACHE_PREFIX}${sessionId}:list`;
const entryKey = (sessionId: string, entryId: string): string => `${PROMPT_LIBRARY_CACHE_PREFIX}${sessionId}:entry:${entryId}`;

const text = (value: unknown, max = 200): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** A prompt body is kept whole: truncating what is saved would ship half a prompt. */
const bodyOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const VARIABLE_NAME = /^[A-Za-z_][\w.-]{0,63}$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.-]{0,63})\s*\}\}/g;

/**
 * The variables a save sends, from the card's `variables` chips.
 *
 * The card holds NAMES (it renders as chips). The library holds `{name, description,
 * default}`. A name that survives keeps the description and default the library
 * already had, so a save made on the board does not erase documentation written on
 * the /prompts page. A card that declares none falls back to the `{{placeholders}}` in
 * the body, because a prompt saved with its placeholders undeclared cannot be filled
 * from a dataset column by the evaluation that is supposed to score it.
 */
export function promptVariablesFrom(cardVariables: unknown, body: string, previous: readonly PromptVariable[] = []): PromptVariable[] {
  const declared = Array.isArray(cardVariables)
    ? cardVariables.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') return (item as { name: string }).name;
      return '';
    })
    : [];
  const names = declared
    .map((name) => name.trim().replace(/^\{\{\s*|\s*\}\}$/g, ''))
    .filter((name) => VARIABLE_NAME.test(name));
  const source = names.length ? names : [...body.matchAll(PLACEHOLDER)].map((match) => match[1]!);
  const known = new Map(previous.map((variable) => [variable.name, variable]));
  return [...new Set(source)].slice(0, 50).map((name) => known.get(name) ?? { name });
}

/** The library's current version, or the newest one when `currentVersion` names a row
 *  the list does not hold. */
export function currentVersionOf(entry: PromptEntry): PromptVersion | undefined {
  const versions = entry.versions ?? [];
  return versions.find((version) => version.version === entry.currentVersion)
    ?? [...versions].sort((a, b) => b.version - a.version)[0];
}

/**
 * Lines added and removed between two bodies, counted as a multiset so a moved line
 * is neither. A size for the change, not a diff: the model has both bodies, and what
 * the user needs in one sentence is how big the edit was.
 */
export function lineDelta(previous: string, next: string): { added: number; removed: number } {
  const count = (body: string): Map<string, number> => {
    const lines = new Map<string, number>();
    for (const line of body.split(/\r?\n/)) lines.set(line, (lines.get(line) ?? 0) + 1);
    return lines;
  };
  const before = count(previous);
  const after = count(next);
  let added = 0;
  let removed = 0;
  for (const [line, n] of after) added += Math.max(0, n - (before.get(line) ?? 0));
  for (const [line, n] of before) removed += Math.max(0, n - (after.get(line) ?? 0));
  return { added, removed };
}

/**
 * The canvas `prompt` fields one library entry writes.
 *
 * The library OWNS `entryId`, `versions` and `activeVersion`, so those always come
 * from it. `body` and `variables` come from it too, unless `keepDraft` is set: that is
 * a card whose text differs from the library's current version, meaning unsaved work.
 * The board keeps it, for the reason the module note gives. `evalScore` is never
 * written (see the module note).
 */
export function promptCardFieldsFrom(entry: PromptEntry, at: string, options: { keepDraft?: boolean } = {}): Record<string, unknown> {
  const current = currentVersionOf(entry);
  const versions = [...(entry.versions ?? [])]
    .sort((a, b) => b.version - a.version)
    .map((version) => ({ version: version.version, savedAt: version.createdAt, notes: version.notes ?? '' }));
  const when = at.slice(0, 16).replace('T', ' ');
  const count = versions.length;
  return {
    entryId: entry.id,
    ...(options.keepDraft || !current ? {} : {
      body: current.body,
      variables: (current.variables ?? []).map((variable) => variable.name).filter(Boolean),
    }),
    versions,
    activeVersion: entry.currentVersion,
    status: options.keepDraft ? `Unsaved changes · library at v${entry.currentVersion}` : `v${entry.currentVersion} · ${count} saved`,
    summary: `${count} version${count === 1 ? '' : 's'} in the prompt library, v${entry.currentVersion} current`
      + `${entry.visibility === 'public' ? ', published in the public gallery' : ''}. `
      + `Read from the library at ${when}. This card is a handle on the entry, not a copy of it, so its history refreshes rather than being typed.`,
  };
}

/** What a read hands back to the MODEL: the history, newest first, with the bodies of
 *  the recent versions so it can compare them without a second call. */
export function promptHistoryForModel(entry: PromptEntry): Array<{ version: number; savedAt: string; notes: string | null; model: string | null; body?: string; truncated?: boolean }> {
  return [...(entry.versions ?? [])]
    .sort((a, b) => b.version - a.version)
    .map((version, index) => ({
      version: version.version,
      savedAt: version.createdAt,
      notes: version.notes,
      model: version.model,
      ...(index < RECENT_BODIES ? {
        body: version.body.slice(0, BODY_PREVIEW_CHARS),
        ...(version.body.length > BODY_PREVIEW_CHARS ? { truncated: true } : {}),
      } : {}),
    }));
}

/** True when a listing entry matches every word of a free-text query. The list route
 *  takes no `q` (only the public gallery does), so the tenant's own library is filtered
 *  here, over the one bounded page the route returns. */
export function promptMatchesQuery(entry: PromptEntry, query: string): boolean {
  const haystack = [entry.title, entry.slug, entry.description ?? '', entry.category ?? '', ...(entry.tags ?? [])]
    .join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

const NO_TENANT = 'This needs a signed-in, saved canvas session: the prompt library is a workspace record and an anonymous board has no workspace behind it. Say so in one sentence, and author the prompt on the board as a `prompt` card with canvas_add_object so it is ready to save. Never claim it was saved.';
const NO_EDIT = 'The current session role cannot edit this canvas';

export function canvasPromptLibraryActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const readEntry = (entryId: string): Promise<PromptEntry> =>
    getOrSetClientCached(entryKey(ctx.sessionId, entryId), () => promptLibraryApi.get(entryId), { ttlMs: CACHE_TTL_MS });
  const readList = (): Promise<PromptEntry[]> =>
    getOrSetClientCached(listKey(ctx.sessionId), () => promptLibraryApi.list(), { ttlMs: CACHE_TTL_MS });
  const promptCards = () => ctx.objects().filter((object) => object.kind === 'prompt');

  return [
    {
      name: 'canvas_read_prompt',
      description:
        'Read this workspace\'s PROMPT LIBRARY: the versioned prompts saved on the /prompts page. Call it with no entryId to LIST the library (optionally filtered by `query`). Call it with an entryId to put that prompt on the board as a `prompt` card holding its current body, its variables and every saved version, and to get each recent version\'s full text back so you can compare them. Use it before changing a prompt that already exists: iterating on a copy with no history is how an improvement becomes a regression nobody can trace. A card already bound to the entry is refreshed rather than duplicated, and a card with unsaved edits keeps them.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          entryId: { type: 'string', description: 'Library entry to place on the board (the `entryId` a listing returns). Omit to list the library instead.' },
          query: { type: 'string', description: 'Only list entries whose title, description, category or tags contain every one of these words. Ignored when entryId is given.' },
          limit: { type: 'number', minimum: 1, maximum: MAX_LISTED },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: (raw: unknown) => typeof (raw as { entryId?: unknown })?.entryId === 'string',
      run: async (raw: unknown) => {
        if (!ctx.hasTenant) return { error: NO_TENANT };
        const args = raw as { entryId?: string; query?: string; limit?: number; x?: number; y?: number };
        const entryId = text(args.entryId, 64);

        // ── List ────────────────────────────────────────────────────────────────
        if (!entryId) {
          let entries: PromptEntry[];
          try {
            entries = await readList();
          } catch (error) {
            return { promptsFound: false, error: error instanceof Error ? error.message : 'The prompt library could not be read.' };
          }
          const query = text(args.query, 200);
          const matching = query ? entries.filter((entry) => promptMatchesQuery(entry, query)) : entries;
          if (!matching.length) {
            return {
              promptsFound: false,
              reason: query && entries.length ? 'no-match' : 'empty-library',
              instruction: query && entries.length
                ? `No prompt in this workspace's library matches "${query}". Say so, and offer to list the whole library or to start a new prompt on the board.`
                : 'This workspace has no saved prompts yet. Author the prompt on the board as a `prompt` card (the whole body, and its variables), then call canvas_save_prompt_version to save it as version 1.',
            };
          }
          const limit = Math.max(1, Math.min(Math.round(args.limit ?? MAX_LISTED), MAX_LISTED));
          return {
            promptsFound: true,
            prompts: matching.slice(0, limit).map((entry) => ({
              entryId: entry.id,
              title: entry.title,
              category: entry.category,
              tags: entry.tags,
              visibility: entry.visibility,
              currentVersion: entry.currentVersion,
              usageCount: entry.usageCount,
              updatedAt: entry.updatedAt,
            })),
            ...(matching.length > limit ? { moreAvailable: matching.length - limit } : {}),
            instruction: 'To work on one of these, call canvas_read_prompt again with its entryId. That puts it on the board with its history.',
          };
        }

        // ── Place one entry on the board ─────────────────────────────────────────
        if (!ctx.canEdit) return { error: NO_EDIT };
        let entry: PromptEntry;
        try {
          entry = await readEntry(entryId);
        } catch (error) {
          return { error: error instanceof Error ? error.message : `No prompt with id ${entryId} is readable from this workspace.` };
        }
        const at = new Date().toISOString();
        const current = currentVersionOf(entry);
        const existing = promptCards().find((object) => text(object.data.entryId, 64) === entry.id);
        const draft = existing ? bodyOf(existing.data.body) : '';
        const keepDraft = Boolean(existing && draft && current && draft !== current.body.trim());
        const fields = promptCardFieldsFrom(entry, at, { keepDraft });
        let objectId: string;
        if (existing) {
          ctx.updateObject(existing.id, fields, `Refreshed ${entry.title}`);
          objectId = existing.id;
        } else {
          const place = { ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}) };
          objectId = ctx.addObject('prompt', { title: entry.title, ...fields }, place).objectId;
        }
        return {
          ok: true, proposed: true,
          objectId,
          entryId: entry.id,
          title: entry.title,
          visibility: entry.visibility,
          activeVersion: entry.currentVersion,
          versions: promptHistoryForModel(entry),
          ...(keepDraft ? { unsavedDraft: true, draftDelta: lineDelta(current?.body ?? '', draft) } : {}),
          instruction: keepDraft
            ? 'The card holds edits the library does not have yet, and they were kept. Say so, and offer to save them with canvas_save_prompt_version. Do not describe the card as matching the library.'
            : 'Edit the card\'s `body` to iterate, then call canvas_save_prompt_version with a note saying what changed and why. A change is an improvement only once an evaluation says so, so attach one with the card\'s `evaluationId` before calling a version better.',
        };
      },
    },
    {
      name: 'canvas_save_prompt_version',
      description:
        'Save a `prompt` card on this board to the workspace prompt library as its NEXT VERSION. The card\'s current `body` and `variables` become the new version and the card\'s history refreshes. A card that is not yet in the library (no `entryId`) is created there as version 1 and bound to the card. Always pass `notes` saying what changed and why: a version history without reasons cannot be learned from. It refuses a save that changes nothing, and refuses to change a prompt published in the PUBLIC gallery unless `publishPublicly` is true, because every visitor who uses it gets the new version. Set that only when the user has explicitly said to update the public prompt.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['notes'],
        properties: {
          objectId: { type: 'string', description: 'The `prompt` card to save. Omit when the board has exactly one.' },
          notes: { type: 'string', description: 'What changed in this version and why, in one or two sentences. Stored with the version.' },
          model: { type: 'string', description: 'The model this version is written for, when it is model-specific.' },
          publishPublicly: { type: 'boolean', description: 'Required to save a new version of a prompt that is PUBLIC in the gallery. Only set it when the user explicitly asked for the public version to change.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        if (!ctx.hasTenant) return { error: NO_TENANT };
        if (!ctx.canEdit) return { error: NO_EDIT };
        const args = raw as { objectId?: string; notes?: string; model?: string; publishPublicly?: boolean };

        const cards = promptCards();
        const card = args.objectId ? cards.find((object) => object.id === args.objectId) : cards.length === 1 ? cards[0] : undefined;
        if (!card) {
          return { error: args.objectId
            ? 'objectId must name a `prompt` object on this canvas.'
            : cards.length
              ? `Specify which prompt to save. Prompt cards on this canvas: ${cards.map((object) => `${object.id} (${object.title})`).join(', ')}`
              : 'There is no `prompt` card on this canvas. Put one on the board with canvas_read_prompt (an existing library prompt) or canvas_add_object (a new one), then save it.' };
        }
        const body = bodyOf(card.data.body);
        if (!body) return { error: `${card.title || 'This prompt'} has no body. Write the whole prompt into the card's \`body\` first: a description of a prompt cannot be versioned.` };
        const notes = text(args.notes, 1000);
        if (!notes) return { error: 'Say what changed in this version in `notes`. A version saved without a reason is history nobody can learn from.' };
        const model = text(args.model, 120);
        const title = text(card.title, 200) || 'Untitled prompt';
        const existingId = text(card.data.entryId, 64);

        // ── A card with no library row: create one, as version 1 ───────────────────
        if (!existingId) {
          const variables = promptVariablesFrom(card.data.variables, body);
          let created: PromptEntry;
          try {
            created = await promptLibraryApi.create({ title, body, variables, notes, ...(model ? { model } : {}), visibility: 'private' });
          } catch (error) {
            return { versionSaved: false, error: error instanceof Error ? error.message : 'The prompt could not be saved to the library.' };
          }
          invalidateClientCache(PROMPT_LIBRARY_CACHE_PREFIX);
          const entry = await promptLibraryApi.get(created.id).catch(() => ({ ...created, versions: [] as PromptVersion[] }));
          ctx.updateObject(card.id, promptCardFieldsFrom(entry, new Date().toISOString()), `Saved ${title} to the prompt library`);
          return {
            ok: true, proposed: true, versionSaved: true, created: true,
            objectId: card.id, entryId: created.id, version: 1,
            instruction: 'This prompt is now in the workspace library as version 1, private to the workspace, and the card is bound to it. Say so. The next change is saved with this same tool, which appends version 2 rather than creating a second entry.',
          };
        }

        // ── A bound card: append the next version ──────────────────────────────────
        // Read FRESH, not through the cache: whether this save changes anything, and
        // whether the entry is public, must be decided against what the library holds
        // now rather than what it held a minute ago.
        let entry: PromptEntry;
        try {
          entry = await promptLibraryApi.get(existingId);
        } catch (error) {
          return {
            versionSaved: false,
            error: error instanceof Error ? error.message : 'That prompt could not be read from the library.',
            instruction: `This card names library entry ${existingId}, which this workspace does not have. Say so and ask whether it was deleted or belongs to another workspace. Do NOT clear the id and save it as a new prompt: that would split its history from the original.`,
          };
        }
        if (entry.visibility === 'public' && args.publishPublicly !== true) {
          return {
            versionSaved: false,
            reason: 'public-entry',
            instruction: `"${entry.title}" is published in the public prompt gallery, so a new version is what every visitor who uses it gets next. Ask the user whether to update the public prompt. Call again with publishPublicly: true only if they say yes. Nothing was saved.`,
          };
        }
        const current = currentVersionOf(entry);
        const variables = promptVariablesFrom(card.data.variables, body, current?.variables ?? []);
        const sameVariables = JSON.stringify(variables.map((variable) => variable.name)) === JSON.stringify((current?.variables ?? []).map((variable) => variable.name));
        if (current && current.body.trim() === body && sameVariables && (!model || model === current.model)) {
          return {
            versionSaved: false,
            reason: 'unchanged',
            instruction: `The card is identical to version ${current.version}, the library's current version, so nothing was saved. Edit the body first. A history of identical versions cannot answer "what changed".`,
          };
        }
        let saved: { version: number };
        try {
          saved = await promptLibraryApi.addVersion(existingId, { body, variables, notes, ...(model ? { model } : {}) });
        } catch (error) {
          return { versionSaved: false, error: error instanceof Error ? error.message : 'The new version could not be saved.' };
        }
        invalidateClientCache(PROMPT_LIBRARY_CACHE_PREFIX);
        const at = new Date().toISOString();
        const refreshed = await promptLibraryApi.get(existingId).catch(() => null);
        ctx.updateObject(
          card.id,
          refreshed ? promptCardFieldsFrom(refreshed, at) : { activeVersion: saved.version, status: `v${saved.version} saved` },
          `Saved ${title} v${saved.version}`,
        );
        return {
          ok: true, proposed: true, versionSaved: true, created: false,
          objectId: card.id, entryId: existingId,
          version: saved.version,
          previousVersion: current?.version ?? null,
          delta: lineDelta(current?.body ?? '', body),
          ...(entry.visibility === 'public' ? { publishedPublicly: true } : {}),
          instruction: `Version ${saved.version} is saved to the library${entry.visibility === 'public' ? ' and is now what the public gallery serves' : ''}. Say which version it is and what the note says changed. Do not call it better than version ${current?.version ?? saved.version - 1} until an evaluation has scored both.`,
        };
      },
    },
  ];
}
