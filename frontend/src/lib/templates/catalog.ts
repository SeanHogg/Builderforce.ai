/**
 * The ONE merge — every starting point the product offers, in one list.
 *
 * Four sources, resolved to `TemplateEntry` (see `contract.ts` for why they were
 * four in the first place):
 *
 *   canvas     — the localized prompt starting points, from the message catalogs;
 *   executive  — the 48 executive intents, with their execution contracts;
 *   pack       — the canvas object packs, placed directly with no model call;
 *   workspace  — the installable manifests from `/api/templates`.
 *
 * ORDER IS THE PRODUCT DECISION HERE. `Start` first (a blank canvas is the
 * fastest thing anyone can want), then the canvas starting points, then the
 * installable templates, then the packs, then the executive intents. The
 * installable ones sit high deliberately: they are the only entries that produce
 * something which keeps running after the person closes the tab, and burying
 * them under 48 prompts is how the marketplace stays undiscovered.
 *
 * The workspace source is ASYNCHRONOUS and optional. A signed-out visitor on the
 * landing canvas has no workspace to install into, and the picker must render
 * instantly rather than waiting on a fetch that will 401 — so `mergeTemplates`
 * takes whatever has arrived and the caller loads the rest when it can.
 */

import { CREATION_TEMPLATES, type CreationTemplate } from '@/components/creation-canvas/creationTemplates';
import { C_SUITE_CANVAS_USE_CASES, executiveCanvasPrompt, type PromptUseCase } from './promptUseCases';
import type { TemplateEntry } from './contract';
import type { TemplateSummary } from './api';

/** Translator shape both callers already hold — `useTranslations(ns)`. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Icons cycle so no entry is iconless; the sequence is stable per id so a card
 *  does not change its glyph when the list is filtered. */
const ENTRY_ICONS = ['□', '◎', '▶', '▣', '◇', '⌘', '◖', '✉', '▤', '▥', '↗', '✦', '🧠', '▷', '◉', '▦', '◆', '⌗', '⬡', '◈'];

function iconFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ENTRY_ICONS[hash % ENTRY_ICONS.length]!;
}

/**
 * The localized prompt starting points and the executive intents.
 *
 * They arrive as the same `PromptUseCase` shape and become the same entry kind —
 * the only difference is that an executive intent composes its execution
 * contract into the prompt, which is what `executiveCanvasPrompt` already did at
 * the moment of selection. Doing it HERE instead means the contract travels with
 * the entry, so any surface that offers the entry runs the same prompt.
 */
export function promptEntries(t: Translate, tRaw: (key: string) => unknown): TemplateEntry[] {
  const localized = tRaw('items');
  const items: PromptUseCase[] = [
    ...(Array.isArray(localized) ? (localized as PromptUseCase[]) : []),
    ...C_SUITE_CANVAS_USE_CASES,
  ];
  return items.map((item) => {
    const id = item.id ?? `canvas:${item.label}`;
    return {
      id,
      name: item.label,
      summary: item.prompt,
      category: item.category,
      categoryLabel: item.categoryLabel ?? t(`categories.${item.category}`),
      source: item.id && item.id.includes('.') ? 'executive' : 'canvas',
      icon: iconFor(id),
      keywords: [item.category],
      action: { kind: 'prompt', prompt: executiveCanvasPrompt(item) ?? item.prompt },
    } satisfies TemplateEntry;
  });
}

/**
 * The canvas object packs.
 *
 * `templateText` used to live inside the canvas as a local helper; the same
 * fallback rule is applied here so a pack reads identically in the prompt picker
 * and in the canvas browser — which is the drift this merge exists to end.
 */
export function packEntries(tCanvas: Translate): TemplateEntry[] {
  const text = (template: CreationTemplate, field: 'name' | 'description'): string => {
    const key = `template.${template.id}.${field === 'name' ? 'name' : 'description'}`;
    const translated = tCanvas(key);
    // next-intl returns the key itself when a message is missing; the English
    // source on the pack is the documented fallback.
    return translated === key || translated.endsWith(key) ? template[field] : translated;
  };
  return CREATION_TEMPLATES.map((template) => ({
    id: `pack:${template.id}`,
    name: text(template, 'name'),
    summary: text(template, 'description'),
    category: 'pack',
    categoryLabel: tCanvas('templateCategoryMarketplace'),
    source: 'pack' as const,
    icon: iconFor(template.id),
    keywords: [...new Set(template.objects.map((o) => o.kind))],
    action: { kind: 'pack' as const, template },
  }));
}

/** The installable manifests. */
export function workspaceEntries(summaries: readonly TemplateSummary[], t: Translate): TemplateEntry[] {
  return summaries.map((s) => ({
    id: `template:${s.key}`,
    name: s.name,
    summary: s.summary,
    category: `template:${s.category}`,
    categoryLabel: t(`category.${s.category}`),
    source: 'workspace' as const,
    icon: s.icon,
    keywords: [...s.tags, ...s.connectors, s.origin],
    action: { kind: 'install' as const, templateKey: s.key, stepCount: s.stepCount },
    connectors: s.connectors,
    connectedCount: s.connectedCount,
    installCount: s.installCount,
  }));
}

/**
 * Merge every source into the one ordered catalogue.
 *
 * Ids are unique per source by construction (each prefixes its own), so the
 * dedupe below is a guard rather than a routine step — but it is the guard that
 * keeps a `key` collision from crashing a React list, which is a worse failure
 * than a duplicate row.
 */
export function mergeTemplates(...groups: readonly TemplateEntry[][]): TemplateEntry[] {
  const seen = new Set<string>();
  const out: TemplateEntry[] = [];
  for (const group of groups) {
    for (const entry of group) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
  }
  return out;
}

/**
 * Catalogue order — see the header. `start` leads, installables sit above the
 * long tail of prompts, and the executive intents come last because they are the
 * most specialised and the least likely thing a new person is looking for.
 */
const CATEGORY_RANK: Record<string, number> = {
  start: 0,
  pack: 30,
};

export function orderTemplates(entries: readonly TemplateEntry[]): TemplateEntry[] {
  const rank = (entry: TemplateEntry): number => {
    if (CATEGORY_RANK[entry.category] !== undefined) return CATEGORY_RANK[entry.category]!;
    if (entry.source === 'workspace') return 10;
    if (entry.source === 'canvas') return 20;
    return 40; // executive
  };
  return [...entries].sort((a, b) => rank(a) - rank(b));
}
