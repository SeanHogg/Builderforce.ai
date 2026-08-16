/**
 * ONE template contract for the whole product.
 *
 * ── THE PROBLEM THIS FIXES ──────────────────────────────────────────────────
 * "A packaged starting point" existed in four unrelated places, each with its
 * own shape, its own menu and its own idea of what a category is:
 *
 *   • `promptUseCases.items` — 48 localized canvas starting points, living as
 *     data inside the message catalogs, rendered by the prompt bar's picker;
 *   • `C_SUITE_CANVAS_USE_CASES` — 48 executive intents with execution
 *     contracts, hard-coded in the picker component and merged in at render;
 *   • `CREATION_TEMPLATES` — canvas object packs, with a SECOND browser inside
 *     the canvas that filters and searches them its own way;
 *   • `/api/templates` — the workspace-installable manifests: guided setup over
 *     the connector catalogue, producing workflows and board work.
 *
 * Four catalogues means four search boxes, four category vocabularies and four
 * places to add the fifth thing — and it means a customer looking for "email
 * campaign" finds a canvas prompt in one menu and a Mailchimp automation in
 * another, with no indication that both exist.
 *
 * This is the single contract they all resolve to. A source declares entries;
 * `catalog.ts` merges them; `apply.ts` decides what pressing one DOES. Adding a
 * starting point is a row in whichever source owns it, and it appears in every
 * surface at once.
 *
 * ── WHY THE ACTION IS PART OF THE ENTRY ─────────────────────────────────────
 * The four sources genuinely differ in what selecting one does — seed a prompt,
 * place objects on the board, or open a guided setup that writes rows. That
 * difference is real and must not be flattened into "it opens something". So it
 * is modelled: `action` is a discriminated union, and the applier is a registry
 * keyed on it. A fifth kind of starting point is a variant plus a handler, not
 * another menu.
 */

import type { CreationTemplate } from '@/components/creation-canvas/creationTemplates';

/**
 * Where an entry came from. Drives the badge on a card and nothing else —
 * ordering and grouping are the CATEGORY's job, because a person browsing for
 * "marketing" does not care which module shipped the row.
 */
export type TemplateSource = 'canvas' | 'executive' | 'pack' | 'workspace';

/** What selecting an entry does. */
export type TemplateAction =
  /** Put a prompt in the composer and let the person send it. The canvas's own
   *  starting points and the executive intents are both this. */
  | { kind: 'prompt'; prompt: string }
  /** Place a pack of objects on the board directly — no model call. */
  | { kind: 'pack'; template: CreationTemplate }
  /** Open the guided setup for an installable template. */
  | { kind: 'install'; templateKey: string; stepCount: number };

export interface TemplateEntry {
  /** Stable id, unique across every source. Sources prefix their own. */
  id: string;
  /** Already localized by the source — the picker never translates. */
  name: string;
  summary: string;
  /** Grouping key. Localized label rides alongside so the picker never has to
   *  own a second category vocabulary. */
  category: string;
  categoryLabel: string;
  source: TemplateSource;
  /** `Icon` name or legacy glyph. */
  icon: string;
  /** Extra words the search box matches — connector keys, object kinds, tags. */
  keywords: string[];
  action: TemplateAction;
  /** Integrations the entry needs connected, for the "works with" row. */
  connectors?: string[];
  /** How many of those the workspace already has. Only meaningful for
   *  `install` entries; absent everywhere else. */
  connectedCount?: number;
  /** Marketplace signal, when the entry has one. */
  installCount?: number;
}

/** Search one entry. Kept here so the picker and the canvas browser cannot
 *  disagree about what "matches" means — they did, and one of them ignored
 *  object kinds while the other ignored categories. */
export function matchesTemplateQuery(entry: TemplateEntry, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return [entry.id, entry.name, entry.summary, entry.categoryLabel, ...entry.keywords]
    .join(' ')
    .toLocaleLowerCase()
    .includes(q);
}

/** Group entries by category, preserving first-seen category order. */
export function groupTemplates(entries: readonly TemplateEntry[]): Array<[string, TemplateEntry[]]> {
  const groups = new Map<string, TemplateEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.category);
    if (bucket) bucket.push(entry);
    else groups.set(entry.category, [entry]);
  }
  return [...groups];
}
