'use client';

/**
 * Catalog surfaces (Skills, Personas, Prompts, Models) decomposed into pinnable
 * widgets — the rollout of the "insights everywhere" standard onto the catalog
 * pages that previously showed their engagement metrics (installs, likes, usage,
 * ratings) only as TEXT badges.
 *
 * Each card reads its catalog list through a shared, deduped source
 * ({@link useSharedSource} → one request per catalog regardless of how many of
 * its widgets are pinned), renders ONLY its body via the shared chart primitives,
 * and drills back to its source page. Mirrors coreWidgets.tsx / aiImpactWidgets.tsx.
 */

import { useTranslations } from 'next-intl';
import {
  listMarketplaceSkills,
  marketplaceStats,
  personasApi,
  promptLibraryApi,
  type ArtifactStats,
  type PromptSummary,
  type PublicPersona,
} from '@/lib/builderforceApi';
import { getModelCatalog, type ModelRecord } from '@/lib/modelCatalog';
import { listAgents } from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';
import { toolsApi } from '@/lib/builderforceApi';
import type { ToolSummary } from '@/lib/tools';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { colorAt } from '@/components/charts/chartColors';
import { int } from '@/components/insights/format';

// ── Shared, deduped catalog reads (one request per catalog) ────────────────────

interface SkillStat { slug: string; name: string; category: string | null; installs: number; likes: number; }

/** Marketplace skills joined with their like/install stats (two-step, one shared read). */
function useSkills() {
  return useSharedSource<SkillStat[]>('catalog:skills', async () => {
    const { skills } = await listMarketplaceSkills({ limit: 100 });
    const slugs = skills.map((s) => s.slug);
    const stats: Record<string, ArtifactStats> = slugs.length
      ? await marketplaceStats.getStats('skill', slugs).catch(() => ({} as Record<string, ArtifactStats>))
      : {};
    return skills.map((s) => ({
      slug: s.slug,
      name: s.name,
      category: s.category ?? null,
      installs: stats[s.slug]?.installs ?? 0,
      likes: stats[s.slug]?.likes ?? 0,
    }));
  });
}

function usePersonas() {
  return useSharedSource<PublicPersona[]>('catalog:personas', () => personasApi.listPublic());
}

function usePrompts() {
  return useSharedSource<PromptSummary[]>('catalog:prompts', () => promptLibraryApi.browsePublic({ sort: 'popular', limit: 50 }));
}

function useModels() {
  return useSharedSource<ModelRecord[]>('catalog:models', () => getModelCatalog());
}

function useMarketplaceAgents() {
  return useSharedSource<PublishedAgent[]>('catalog:mkt-agents', () => listAgents());
}

function useTools() {
  return useSharedSource<ToolSummary[]>('catalog:tools', () => toolsApi.list());
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Top-N descending bars over a value accessor, dropping zero/empty values. */
function topBars<T>(items: T[], value: (t: T) => number, label: (t: T) => string, key: (t: T) => string, n = 8): BarDatum[] {
  return items
    .filter((it) => value(it) > 0)
    .sort((a, b) => value(b) - value(a))
    .slice(0, n)
    .map((it, i) => ({ key: key(it), label: label(it), value: value(it), color: colorAt(i) }));
}

// ── Skills (group: 'skills') ───────────────────────────────────────────────────

function SkillsTopInstallsCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useSkills();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const bars = topBars(data, (s) => s.installs, (s) => s.name, (s) => s.slug);
  if (!bars.length) return <Muted>{t('catalog.noInstalls')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('title.catalogSkillsTopInstalls')} />;
}

function SkillsByCategoryCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useSkills();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.length === 0) return <Muted>{t('catalog.noData')}</Muted>;
  const counts = new Map<string, number>();
  for (const s of data) {
    const c = s.category || t('catalog.uncategorized');
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const segments = [...counts.entries()].map(([k, v], i) => ({ key: k, label: k, value: v, color: colorAt(i) }));
  return (
    <DonutChart
      segments={segments}
      centerValue={int(data.length)}
      centerLabel={t('catalog.skills')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.catalogSkillsByCategory')}
    />
  );
}

// ── Personas (group: 'personas') ───────────────────────────────────────────────

function PersonasTopInstallsCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = usePersonas();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const bars = topBars(data, (p) => p.installCount ?? 0, (p) => p.name, (p) => p.slug);
  if (!bars.length) return <Muted>{t('catalog.noInstalls')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('title.catalogPersonasTopInstalls')} />;
}

// ── Prompts (group: 'prompts') ─────────────────────────────────────────────────

function PromptsMostUsedCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = usePrompts();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const bars = topBars(data, (p) => p.usageCount, (p) => p.title, (p) => p.slug);
  if (!bars.length) return <Muted>{t('catalog.noUsage')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('title.catalogPromptsMostUsed')} />;
}

function PromptsTopRatedCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = usePrompts();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const bars = topBars(data, (p) => p.starCount, (p) => p.title, (p) => p.slug);
  if (!bars.length) return <Muted>{t('catalog.noRatings')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('title.catalogPromptsTopRated')} />;
}

// ── Models (group: 'models') ───────────────────────────────────────────────────

function ModelsByProviderCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useModels();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.length === 0) return <Muted>{t('catalog.noData')}</Muted>;
  const counts = new Map<string, number>();
  for (const m of data) {
    const p = m.provider || t('catalog.unknownProvider');
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const segments = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ key: k, label: k, value: v, color: colorAt(i) }));
  return (
    <DonutChart
      segments={segments}
      centerValue={int(data.length)}
      centerLabel={t('catalog.models')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.catalogModelsByProvider')}
    />
  );
}

// ── Marketplace (group: 'marketplace') ─────────────────────────────────────────

/** Top marketplace agents by cumulative hires. */
function MarketplaceTopHiredCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useMarketplaceAgents();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const bars = topBars(data, (a) => a.hire_count ?? 0, (a) => a.name, (a) => a.id);
  if (!bars.length) return <Muted>{t('catalog.noHires')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('title.catalogMarketplaceTopHired')} />;
}

/** Best-evaluated marketplace agent (0-100 gauge from the AI eval score). */
function MarketplaceTopEvalCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useMarketplaceAgents();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const scored = data
    .map((a) => ({ name: a.name, score: a.evalScore ?? a.eval_score ?? null }))
    .filter((a): a is { name: string; score: number } => a.score != null);
  if (!scored.length) return <Muted>{t('catalog.noEval')}</Muted>;
  const best = scored.sort((a, b) => b.score - a.score)[0];
  const pct = Math.round(best.score * 100);
  return (
    <GaugeChart
      value={pct}
      min={0}
      max={100}
      color={colorAt(2)}
      centerValue={`${pct}`}
      centerLabel={best.name}
      ariaLabel={t('title.catalogMarketplaceTopEval')}
    />
  );
}

// ── Tools (group: 'tools') ─────────────────────────────────────────────────────

/** Diagnostics & tools split by category — catalog composition at a glance. */
function ToolsByCategoryCard(_props: WidgetCardProps) {
  const t = useTranslations('widgets');
  const { data, error } = useTools();
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.length === 0) return <Muted>{t('catalog.noData')}</Muted>;
  const counts = new Map<string, number>();
  for (const tool of data) counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
  const segments = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ key: k, label: t(`catalog.toolCat.${k}`), value: v, color: colorAt(i) }));
  return (
    <DonutChart
      segments={segments}
      centerValue={int(data.length)}
      centerLabel={t('catalog.tools')}
      formatValue={(v) => int(v)}
      ariaLabel={t('title.catalogToolsByCategory')}
    />
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

const SKILLS_DRILL: WidgetDrill = { kind: 'route', href: '/skills' };
const PERSONAS_DRILL: WidgetDrill = { kind: 'route', href: '/personas' };
const PROMPTS_DRILL: WidgetDrill = { kind: 'route', href: '/prompts' };
const MODELS_DRILL: WidgetDrill = { kind: 'route', href: '/models' };
const MARKETPLACE_DRILL: WidgetDrill = { kind: 'route', href: '/marketplace' };
const TOOLS_DRILL: WidgetDrill = { kind: 'route', href: '/tools' };

export const CATALOG_WIDGETS: WidgetDef[] = [
  // ── Skills (`/skills`) ──
  { id: 'catalog.skills-top-installs', group: 'skills', titleKey: 'catalogSkillsTopInstalls', size: 'md', Card: SkillsTopInstallsCard, drill: SKILLS_DRILL },
  { id: 'catalog.skills-by-category', group: 'skills', titleKey: 'catalogSkillsByCategory', size: 'md', Card: SkillsByCategoryCard, drill: SKILLS_DRILL },

  // ── Personas (`/personas`) ──
  { id: 'catalog.personas-top-installs', group: 'personas', titleKey: 'catalogPersonasTopInstalls', size: 'md', Card: PersonasTopInstallsCard, drill: PERSONAS_DRILL },

  // ── Prompts (`/prompts`) ──
  { id: 'catalog.prompts-most-used', group: 'prompts', titleKey: 'catalogPromptsMostUsed', size: 'md', Card: PromptsMostUsedCard, drill: PROMPTS_DRILL },
  { id: 'catalog.prompts-top-rated', group: 'prompts', titleKey: 'catalogPromptsTopRated', size: 'md', Card: PromptsTopRatedCard, drill: PROMPTS_DRILL },

  // ── Models (`/models`) ──
  { id: 'catalog.models-by-provider', group: 'models', titleKey: 'catalogModelsByProvider', size: 'md', Card: ModelsByProviderCard, drill: MODELS_DRILL },

  // ── Marketplace (`/marketplace`) ──
  { id: 'catalog.marketplace-top-hired', group: 'marketplace', titleKey: 'catalogMarketplaceTopHired', size: 'md', Card: MarketplaceTopHiredCard, drill: MARKETPLACE_DRILL },
  { id: 'catalog.marketplace-top-eval', group: 'marketplace', titleKey: 'catalogMarketplaceTopEval', size: 'sm', Card: MarketplaceTopEvalCard, drill: MARKETPLACE_DRILL },

  // ── Tools (`/tools`) ──
  { id: 'catalog.tools-by-category', group: 'tools', titleKey: 'catalogToolsByCategory', size: 'md', Card: ToolsByCategoryCard, drill: TOOLS_DRILL },
];
