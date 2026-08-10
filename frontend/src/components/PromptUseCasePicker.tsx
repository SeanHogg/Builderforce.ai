'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './PromptUseCasePicker.module.css';
import { Icon } from '@/components/ui/Icon';

export type PromptUseCase = { id?: string; category: string; label: string; prompt: string; categoryLabel?: string };

/**
 * BurnRateOS' 48 executive "tools" were starting-point intents: each one asked
 * the assistant to assemble or amend a management view.  Creation Canvas already
 * owns the durable primitives for those views, so the migration maps every intent
 * to an existing Canvas object instead of adding parallel APIs, object kinds, or
 * database tables.  Keeping the legacy dotted id makes the migration auditable and
 * lets an operator find an item by its old contract name.
 */
export const C_SUITE_CANVAS_USE_CASES: readonly PromptUseCase[] = [
  { id: 'agile.sprint.current', category: 'executiveDelivery', categoryLabel: 'Delivery', label: 'Current sprint', prompt: 'Create a current-sprint dashboard from the available project and task evidence, showing the sprint goal, dates, capacity, progress, blockers, and open work. Do not invent missing values.' },
  { id: 'agile.velocity.summary', category: 'executiveDelivery', categoryLabel: 'Delivery', label: 'Velocity summary', prompt: 'Create a verified velocity chart and concise delivery report from the available sprint history, including committed versus completed work and trend.' },
  { id: 'agile.bottlenecks.list', category: 'executiveDelivery', categoryLabel: 'Delivery', label: 'Delivery bottlenecks', prompt: 'Create a prioritized bottleneck report and table from current delivery evidence, including severity, affected stage, impact, owner, and recommended next action.' },
  { id: 'agile.technical_debt.list', category: 'executiveDelivery', categoryLabel: 'Delivery', label: 'Technical debt', prompt: 'Create a technical-debt register from existing project work, grouped by priority and type, and connect it to a remediation roadmap. Do not create duplicate canonical tasks.' },
  { id: 'agile.deployments.recent', category: 'executiveDelivery', categoryLabel: 'Delivery', label: 'Recent deployments', prompt: 'Create a recent-deployments table and release-health summary from available project evidence, including environment, status, failures, and recovery time.' },

  { id: 'crm.pipeline.summary', category: 'executiveRevenue', categoryLabel: 'Revenue', label: 'Pipeline summary', prompt: 'Create or refresh a sales-pipeline object and executive dashboard using the canonical sales workspace, with stage value, deal count, weighted value, and movement.' },
  { id: 'crm.deals.at_risk', category: 'executiveRevenue', categoryLabel: 'Revenue', label: 'Deals at risk', prompt: 'Create a deals-at-risk table from the canonical sales workspace, ranked by value and risk evidence with owner and next action.' },
  { id: 'crm.conversion_rates.list', category: 'executiveRevenue', categoryLabel: 'Revenue', label: 'Conversion rates', prompt: 'Create a sales conversion funnel chart and KPI set from canonical pipeline evidence, labeling the period and calculation basis.' },
  { id: 'crm.quota.attainment', category: 'executiveRevenue', categoryLabel: 'Revenue', label: 'Quota attainment', prompt: 'Create a quota-attainment dashboard with target, actual, attainment percentage, gap, period, and owner using available canonical sales metrics.' },
  { id: 'cross.risks.aggregate', category: 'executiveOverview', categoryLabel: 'Executive overview', label: 'Enterprise risk rollup', prompt: 'Create an enterprise risk dashboard that consolidates delivery, revenue, finance, security, and people risks already available on the canvas or in connected project evidence. Cite each source and do not invent scores.' },

  { id: 'finance.runway.snapshot', category: 'executiveFinance', categoryLabel: 'Finance', label: 'Runway snapshot', prompt: 'Create a runway KPI and finance dashboard from available balances, burn, and revenue evidence, clearly showing the as-of date and assumptions.' },
  { id: 'finance.transactions.summary', category: 'executiveFinance', categoryLabel: 'Finance', label: 'Transaction summary', prompt: 'Create a transaction summary table and chart for the requested period from available finance data, grouped by account or category with totals.' },
  { id: 'finance.forecast_scenarios.list', category: 'executiveFinance', categoryLabel: 'Finance', label: 'Forecast scenarios', prompt: 'Create a scenario-comparison table and chart from available best-case, base-case, worst-case, and custom forecasts, preserving their assumptions.' },
  { id: 'finance.breakeven.list', category: 'executiveFinance', categoryLabel: 'Finance', label: 'Break-even analysis', prompt: 'Create a break-even chart and decision report from available scenario evidence, including fixed assumptions, variable assumptions, horizon, and break-even point.' },
  { id: 'finance.arr_projections.list', category: 'executiveFinance', categoryLabel: 'Finance', label: 'ARR projections', prompt: 'Create an ARR projection chart and KPI summary from available recurring-revenue metrics, with period, scenario, growth, and source evidence.' },

  { id: 'governance.soc_controls.list', category: 'executiveGovernance', categoryLabel: 'Governance', label: 'SOC controls', prompt: 'Create a SOC controls table and readiness report from available governance evidence, grouped by category and status with owners and evidence gaps.' },
  { id: 'governance.security_incidents.list', category: 'executiveGovernance', categoryLabel: 'Governance', label: 'Security incidents', prompt: 'Create a security-incident table and risk dashboard from available incident evidence, including severity, status, age, owner, and containment state.' },
  { id: 'governance.compliance_events.upcoming', category: 'executiveGovernance', categoryLabel: 'Governance', label: 'Upcoming compliance events', prompt: 'Create a compliance calendar roadmap and table from available governance events, including overdue items, framework, due date, owner, and status.' },
  { id: 'governance.snapshot', category: 'executiveGovernance', categoryLabel: 'Governance', label: 'Governance snapshot', prompt: 'Create an executive governance dashboard from available controls, incidents, compliance events, vendors, training, and evidence. Show coverage and gaps without inventing values.' },
  { id: 'governance.vendors.list', category: 'executiveGovernance', categoryLabel: 'Governance', label: 'Security vendors', prompt: 'Create a vendor and subprocessor register from available governance evidence, including risk, DPA status, review date, owner, and open actions.' },

  { id: 'investor.market.get', category: 'executiveInvestor', categoryLabel: 'Investor', label: 'Market analysis', prompt: 'Create a target-market object and investor report from the current company analysis, including industry, TAM, SAM, SOM, growth, assumptions, and sources.' },
  { id: 'investor.market.upsert_analysis', category: 'executiveInvestor', categoryLabel: 'Investor', label: 'Update market analysis', prompt: 'Create or update the selected target-market object with an authored industry, TAM, SAM, SOM, growth, assumptions, and cited source notes. Preserve fields that are not being changed.' },
  { id: 'investor.market.add_peers', category: 'executiveInvestor', categoryLabel: 'Investor', label: 'Add market peers', prompt: 'Add researched peer companies to the selected comparison dataset, with one sourced row per peer and comparable revenue, valuation, multiple, growth, stage, and notes where available.' },
  { id: 'investor.market.update_peer', category: 'executiveInvestor', categoryLabel: 'Investor', label: 'Update market peer', prompt: 'Update the identified peer row in the selected comparison dataset using sourced evidence. Preserve other peer rows and unchanged fields.' },
  { id: 'investor.market.delete_peer', category: 'executiveInvestor', categoryLabel: 'Investor', label: 'Remove market peer', prompt: 'Remove the specifically identified peer from the selected comparison dataset only after confirming the target row; leave every other row unchanged.' },

  { id: 'marketing.heatmaps.list', category: 'executiveMarketing', categoryLabel: 'Marketing', label: 'Page heatmaps', prompt: 'Create a page-heatmap inventory table and dashboard from available marketing evidence, including path, sample size, period, click concentration, and scroll depth.' },
  { id: 'marketing.heatmaps.analyze', category: 'executiveMarketing', categoryLabel: 'Marketing', label: 'Analyze heatmap', prompt: 'Create a heatmap analysis report for the identified page using available click and scroll evidence, with findings, confidence limits, and prioritized experiments.' },
  { id: 'marketing.campaigns.list', category: 'executiveMarketing', categoryLabel: 'Marketing', label: 'Marketing campaigns', prompt: 'Create a campaign portfolio table from available email and marketing campaign evidence, with channel, audience, status, schedule, delivery, engagement, and outcome.' },
  { id: 'marketing.channel_performance.summary', category: 'executiveMarketing', categoryLabel: 'Marketing', label: 'Channel performance', prompt: 'Create a channel-performance dashboard and chart from available metrics, comparing spend, reach, leads, conversion, revenue, CAC, and return for the same period.' },
  { id: 'marketing.ab_tests.list', category: 'executiveMarketing', categoryLabel: 'Marketing', label: 'A/B tests', prompt: 'Create an experiment register and evaluation view from available A/B tests, including hypothesis, variants, sample, primary metric, status, winner, and conclusion.' },

  { id: 'ops.employees.summary', category: 'executivePeople', categoryLabel: 'People', label: 'Employee summary', prompt: 'Create a people dashboard from available employee evidence, showing active headcount by department, employment type, location, manager coverage, starts, and departures.' },
  { id: 'ops.hiring_forecast.list', category: 'executivePeople', categoryLabel: 'People', label: 'Hiring forecast', prompt: 'Create a hiring forecast roadmap and chart from available headcount plans and hiring impacts, including timing, department, head delta, cost, and status.' },
  { id: 'ops.headcount_plan.list', category: 'executivePeople', categoryLabel: 'People', label: 'Headcount plan', prompt: 'Create a headcount planning spreadsheet and dashboard from available plans, comparing planned versus actual heads and budget by period and department.' },
  { id: 'ops.performance_reviews.summary', category: 'executivePeople', categoryLabel: 'People', label: 'Performance reviews', prompt: 'Create an aggregate performance-review dashboard from available objective outcomes, showing completion, rating distribution, periods, and overdue gaps without exposing unnecessary personal detail.' },
  { id: 'ops.one_on_ones.cadence', category: 'executivePeople', categoryLabel: 'People', label: 'One-on-one cadence', prompt: 'Create a one-on-one cadence report from available meeting evidence, showing recent and overdue conversations by team and manager with follow-up actions.' },

  { id: 'product.ideas.list', category: 'executiveProduct', categoryLabel: 'Product', label: 'Product ideas', prompt: 'Create a product-ideas table and feature summary from available product evidence, grouped by status, priority, and type without duplicating canonical ideas.' },
  { id: 'product.ideas.get', category: 'executiveProduct', categoryLabel: 'Product', label: 'Product idea brief', prompt: 'Create a decision-ready product idea brief for the identified idea using its problem, evidence, hypothesis, status, and linked delivery work.' },
  { id: 'product.company.snapshot', category: 'executiveProduct', categoryLabel: 'Product', label: 'Company snapshot', prompt: 'Create a company snapshot dashboard and report from available company evidence, including stage, sector, headcount, ARR, valuation, market, and current priorities.' },
  { id: 'product.company.list', category: 'executiveProduct', categoryLabel: 'Product', label: 'Company portfolio', prompt: 'Create a company portfolio table from available company records, with stage, sector, location, headcount, ARR, valuation, ownership status, and last update.' },
  { id: 'product.company.update', category: 'executiveProduct', categoryLabel: 'Product', label: 'Update company profile', prompt: 'Create or update the selected company profile as a target-market and company brief on the canvas. Preserve unchanged fields and clearly mark any assumption that lacks canonical evidence.' },

  { id: 'research.web_search', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Web research', prompt: 'Research the requested executive question from cited web sources, create a supporting dataset with one row per finding, and synthesize it into a decision report. Do not answer from memory.' },
  { id: 'scratchpad.read', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Open working notes', prompt: 'Create or open a document that consolidates the working notes already present on this canvas, preserving page titles, order, and content.' },
  { id: 'scratchpad.add_page', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Add notes page', prompt: 'Add a new, fully authored document page to the current executive working notes using the requested title and content.' },
  { id: 'scratchpad.append_to_page', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Append to notes page', prompt: 'Append the requested markdown to the identified document page without replacing or summarizing its existing content.' },
  { id: 'scratchpad.update_page', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Update notes page', prompt: 'Update the identified document page with the requested complete content and optional title, leaving other pages unchanged.' },
  { id: 'scratchpad.rename_page', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Rename notes page', prompt: 'Rename the identified document page and preserve all of its content and the rest of the working notes.' },
  { id: 'scratchpad.set_title', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Rename working notes', prompt: 'Update the title of the selected working-notes document without changing its pages or content.' },
  { id: 'scratchpad.create_deck', category: 'executiveResearch', categoryLabel: 'Research & notes', label: 'Create executive deck', prompt: 'Create a polished slides object from the supplied deck title and slide content, preserving the requested slide order and authoring a clear executive narrative.' },
];

export function PromptUseCasePicker({ placement, align = 'center', onSelect }: {
  placement: 'top' | 'bottom';
  align?: 'center' | 'end';
  onSelect: (prompt: string, useCase: PromptUseCase) => void;
}) {
  const t = useTranslations('promptUseCases');
  // Some embedded/test translation adapters intentionally expose only the
  // string translator. Keep the prompt usable there even without rich arrays.
  const localizedItems = typeof t.raw === 'function' ? t.raw('items') : [];
  const items = [
    ...(Array.isArray(localizedItems) ? localizedItems as PromptUseCase[] : []),
    ...C_SUITE_CANVAS_USE_CASES,
  ];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !normalizedQuery || `${item.id ?? ''} ${item.label} ${item.categoryLabel ?? t(`categories.${item.category}`)} ${item.prompt}`.toLocaleLowerCase().includes(normalizedQuery));
    return [...filtered.reduce((result, entry) => {
      const group = result.get(entry.item.category) ?? [];
      group.push(entry);
      result.set(entry.item.category, group);
      return result;
    }, new Map<string, Array<{ item: PromptUseCase; index: number }>>())];
  }, [items, query, t]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const tab = (
    <button type="button" className={styles.tab} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>
      <span>{t('tabLabel')}</span>
      <span className={styles.arrow} aria-hidden="true">⌃</span>
    </button>
  );
  const panel = (
    <div className={styles.reveal} data-open={open ? 'true' : 'false'}>
      <div id={panelId} className={styles.panel} aria-hidden={!open}>
        <div className={styles.panelHeader}>
          <div className={styles.heading}>{t('heading')}</div>
          <input
            type="search"
            className={styles.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            tabIndex={open ? 0 : -1}
          />
        </div>
        <div className={styles.catalog}>
          {groups.map(([category, entries]) => (
            <section key={category} className={styles.group}>
              <div className={styles.category}>{entries[0]?.item.categoryLabel ?? t(`categories.${category}`)}</div>
              <div className={styles.grid}>
                {entries.map(({ item, index }) => (
                  <button key={item.id || item.label} type="button" className={styles.item} tabIndex={open ? 0 : -1} onClick={() => { onSelect(item.prompt, item); setOpen(false); setQuery(''); }}>
                    <span className={styles.icon} aria-hidden="true"><Icon source={USE_CASE_ICONS[index % USE_CASE_ICONS.length]} size={18} /></span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && <div className={styles.empty}>{t('noResults')}</div>}
        </div>
      </div>
    </div>
  );

  return <div ref={rootRef} className={styles.root} data-open={open ? 'true' : 'false'} data-placement={placement} data-align={align}>{placement === 'top' ? <>{panel}{tab}</> : <>{tab}{panel}</>}</div>;
}

const USE_CASE_ICONS = ['□', '◎', '▶', '▣', '◇', '⌘', '◖', '✉', '▤', '▥', '↗', '✦', '🧠', '▷', '◉', '▦', '◆', '⌗', '⬡', '◈'];
