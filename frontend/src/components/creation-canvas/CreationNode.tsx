'use client';

import { useEffect, useRef } from 'react';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Avatar, evermindLearnedStatus, evermindNextAction } from '@seanhogg/builderforce-brain-ui';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';
import { creationObjectDefinition } from './creationObjectRegistry';
import { BrainActivityBar, useBrainActivity } from './BrainActivityView';
import { BrainSurfaceActions, BrainSurfaceBody } from './BrainDock';
import { useBrainSurface } from './brainSurfaceContext';
import { highlightToneFor, tabularFromObject, type TabularHighlightRule } from '@/lib/canvasTabularData';
import { creativePreviewImageUrl } from '@/lib/creationDeliverables';

export type CreationFlowNode = Node<CreationNodeData, 'creation'>;

type CanvasChatMessage = { role: string; content: string; createdAt?: string };

function canvasChatMessages(data: CreationNodeData): CanvasChatMessage[] {
  if (!Array.isArray(data.messages)) return [];
  return data.messages.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const message = value as Record<string, unknown>;
    if (typeof message.content !== 'string' || !message.content.trim()) return [];
    return [{
      role: typeof message.role === 'string' ? message.role : 'assistant',
      content: message.content,
      ...(typeof message.createdAt === 'string' ? { createdAt: message.createdAt } : {}),
    }];
  });
}

function authoredText(data: CreationNodeData): string | null {
  const value = [data.content, data.markdown, data.code, data.transcript, data.subtitle].find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value : null;
}

function asRecord(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fallback;
}

function AuthoredContent({ data, fallback }: { data: CreationNodeData; fallback: string }) {
  return <p className={styles.authoredContent}>{authoredText(data) || fallback}</p>;
}

const CREATIVE_STUDIO_KINDS = new Set(['image', 'animation', 'podcast', 'comic', 'game', 'cad', 'model3d', 'resume', 'template']);

/** Product name — never translated, so it stays out of the message catalogs. */
const EVERMIND_BRAND = 'Evermind';

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function CreativeStudioBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const mediaKind = textValue(data.mediaKind, data.kind === 'model3d' ? 'cad_3d' : data.kind);
  const template = textValue(data.templateId, data.kind === 'template' ? t('browseCatalog') : t('blankCanvas'));
  const output = textValue(data.outputFormat, data.kind === 'resume' ? 'PDF / DOCX' : t('chooseOnExport'));
  const thumbnail = creativePreviewImageUrl(data);
  return <div className={styles.creativeStudioBody}>
    {thumbnail ? <img src={thumbnail} alt={t('previewAlt', { title: data.title })} /> : <div className={styles.creativeStudioPreview} aria-hidden="true"><span>{creationObjectDefinition(data.kind).icon}</span><i /><i /><i /></div>}
    <AuthoredContent data={data} fallback={t('creativeFallback')} />
    <div className={styles.widgetSettings}>
      <span><small>{t('studio')}</small><b>{mediaKind.replaceAll('_', ' ')}</b></span>
      <span><small>{t('template')}</small><b>{template.replaceAll('_', ' ')}</b></span>
      <span><small>{t('output')}</small><b>{output}</b></span>
    </div>
    <div className={styles.pills}><span>{textValue(data.capabilityId, `creative.${data.kind}`)}</span><span>{`MCP · ${textValue(data.mcpServer, 'builtin')}`}</span></div>
  </div>;
}

function TaskBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const agent = textValue(data.assignee, textValue(data.agentName, textValue(data.role, t('unassigned'))));
  const priority = textValue(data.priority, t('notSet'));
  const prdTitle = textValue(data.prdTitle);
  const prdSummary = textValue(data.prdSummary);
  const acceptance = textValue(data.acceptanceCriteria);
  return <div className={styles.taskBody}>
    <div className={styles.taskFacts}>
      <span><small>{t('agent')}</small><b>{agent}</b></span>
      <span><small>{t('priority')}</small><b>{priority}</b></span>
    </div>
    <AuthoredContent data={data} fallback={t('noTaskDescription')} />
    <div className={styles.taskContext}>
      <small>{t('prd')}</small>
      {prdTitle || prdSummary
        ? <><b>{prdTitle || t('linkedRequirements')}</b>{prdSummary && <p>{prdSummary}</p>}</>
        : <p className={styles.taskEmpty}>{t('noPrdLinked')}</p>}
    </div>
    {acceptance && <div className={styles.taskContext}><small>{t('doneWhen')}</small><p>{acceptance}</p></div>}
  </div>;
}

type ProjectLens = 'everything' | 'delivery' | 'metrics' | 'customer-feedback';

function projectLens(data: CreationNodeData): ProjectLens {
  return data.projectLens === 'delivery' || data.projectLens === 'metrics' || data.projectLens === 'customer-feedback'
    ? data.projectLens
    : 'everything';
}

function ProjectBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const lens = projectLens(data);
  const status = textValue(data.status, t('active'));
  const open = Number.isFinite(Number(data.open)) ? String(Number(data.open)) : '—';
  const blocked = Number.isFinite(Number(data.blocked)) ? String(Number(data.blocked)) : '—';
  const maturity = data.maturity == null ? '3.8 / 5' : String(data.maturity);
  const velocity = data.velocity == null ? '42 pts' : `${String(data.velocity)}${typeof data.velocity === 'number' ? ' pts' : ''}`;
  const health = textValue(data.health, textValue(data.healthTier, t('onTrack')));
  const feedback = Array.isArray(data.feedback) ? data.feedback : Array.isArray(data.items) ? data.items : [];
  const quality = <ProjectQualitySummary data={data} />;

  if (lens === 'delivery') return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectHealth}>
      <div><small>{t('status')}</small><b>{status}</b></div>
      <div><small>{t('openWork')}</small><b>{open}</b></div>
      <div><small>{t('blocked')}</small><b>{blocked}</b></div>
    </div>
    <p>{textValue(data.deliverySummary, data.subtitle || t('deliveryFallback'))}</p>
  </div>;

  if (lens === 'metrics') return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectHealth}>
      <div><small>{t('maturity')}</small><b>{maturity}</b></div>
      <div><small>{t('velocity')}</small><b>{velocity}</b></div>
      <div><small>{t('health')}</small><b className={styles.healthy}>{health}</b></div>
    </div>
    <p>{textValue(data.metricsSummary, t('metricsFallback'))}</p>
  </div>;

  if (lens === 'customer-feedback') return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectFeedback}>
      <small>{t('customerFeedback')}</small>
      {feedback.length
        ? feedback.slice(0, 4).map((item, index) => <span key={`${String(item)}-${index}`}>{typeof item === 'string' ? item : String((item as Record<string, unknown>)?.title || (item as Record<string, unknown>)?.name || t('feedbackIndex', { index: index + 1 }))}</span>)
        : <p>{textValue(data.feedbackSummary, data.subtitle || t('feedbackFallback'))}</p>}
    </div>
  </div>;

  return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectOverview}>
      <span><small>{t('status')}</small><b>{status}</b></span>
      <span><small>{t('projectContext')}</small><b>{t('everything')}</b></span>
    </div>
    <p>{data.subtitle || t('projectFallback')}</p>
  </div>;
}

function scoreTone(score: unknown): 'good' | 'watch' | 'risk' | 'empty' {
  if (score == null || score === '') return 'empty';
  const value = Number(score);
  if (!Number.isFinite(value)) return 'empty';
  if (value >= 80) return 'good';
  if (value >= 60) return 'watch';
  return 'risk';
}

function ProjectQualitySummary({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const score = Number(data.qualityScore);
  const hasScore = data.qualityScore != null && Number.isFinite(score);
  const diagnosticCount = Number(data.diagnosticCount || (Array.isArray(data.diagnostics) ? data.diagnostics.length : 0));
  const gapCount = Number(data.gapCount || 0);
  return <section className={styles.projectQuality} data-tone={scoreTone(data.qualityScore)} aria-label={t('projectQuality')}>
    <div className={styles.qualityGauge} style={{ '--quality-score': hasScore ? Math.max(0, Math.min(100, score)) : 0 } as React.CSSProperties}>
      <strong>{hasScore ? Math.round(score) : '—'}</strong><small>{t('perHundred')}</small>
    </div>
    <div><small>{t('quality')}</small><b>{textValue(data.qualityLabel, hasScore ? (score >= 80 ? t('healthy') : score >= 60 ? t('needsAttention') : t('atRisk')) : t('notAssessed'))}</b><p>{textValue(data.qualityHeadline, diagnosticCount ? t('diagnosticsAnalyzed', { count: diagnosticCount }) : t('loadDiagnostics'))}</p></div>
    <span><b>{diagnosticCount}</b><small>{t('diagnosticsCount')}</small></span><span><b>{gapCount}</b><small>{t('openGaps')}</small></span>
  </section>;
}

function optionLabel(value: unknown, labels: Record<string, string>, fallback: string): string {
  return typeof value === 'string' && labels[value] ? labels[value] : fallback;
}

function AgentBody({ data, onOpen }: { data: CreationNodeData; onOpen?: (focus: 'knowledge' | 'test') => void }) {
  const t = useTranslations('creationCanvas.node');
  const tools = Array.isArray(data.tools) ? data.tools.map(String) : ['Audience Analyzer', 'Copy Optimizer'];
  const autonomy = optionLabel(data.autonomy, { low: t('lowAutonomy'), medium: t('mediumAutonomy'), high: t('highAutonomy') }, t('mediumAutonomy'));
  const existing = typeof data.resourceId === 'string' && data.resourceId.startsWith('agent:');
  const thinking = data.collaborationState === 'thinking' || data.testStatus === 'Running';
  const latestReply = textValue(data.collaborationReply, textValue(data.testResponse));
  return <>
    <div className={styles.agentIdentity}>
      <Avatar name={data.title} kind="agent" size={34} />
      <span><b>{existing ? t('configuredAgent') : t('newAgent')}</b><small>{textValue(data.role, data.status || t('online'))}</small></span>
      <em>{data.model === 'auto' || !data.model ? t('autoModel') : data.model}</em>
    </div>
    {thinking && <div className={styles.agentThinking} role="status"><i aria-hidden>✦</i><b>{data.testStatus === 'Running' ? t('testing') : t('thinking')}</b><span>{t('contributing')}</span></div>}
    {!thinking && latestReply && <div className={styles.agentLatestReply}><small>{t('latestResponse')}</small><p>{latestReply}</p></div>}
    {!latestReply && !thinking && <p>{textValue(data.personality, textValue(data.instructions, data.subtitle || ''))}</p>}
    <div className={styles.pills}>{tools.map((tool) => <span key={tool}>{tool}</span>)}<span>{autonomy}</span>{typeof data.testStatus === 'string' && data.testStatus && <span>{data.testStatus}</span>}</div>
    <div className={`${styles.nodeActionBar} nodrag nowheel`}><button type="button" onClick={(event) => { event.stopPropagation(); onOpen?.('knowledge'); }}>{t('addKnowledgeStep')}</button><button type="button" onClick={(event) => { event.stopPropagation(); onOpen?.('test'); }}>{t('testAgentStep')}</button></div>
  </>;
}

function WorkflowBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const authoredSteps = Array.isArray(data.steps) ? data.steps.slice(0, 12).map((step, index) => asRecord(step, { title: typeof step === 'string' ? step : t('stepIndex', { index: index + 1 }) })) : [];
  const steps: Record<string, unknown>[] = authoredSteps.length ? authoredSteps : ['Audience', 'Create campaign', 'Approve', 'Publish'].map((title) => ({ title }));
  const target = optionLabel(data.runTarget, { builderforce: 'BuilderForce.AI', 'campaign-strategist': 'Campaign Strategist' }, 'BuilderForce.AI');
  const approval = optionLabel(data.approvalMode, { required: t('approvalRequired'), autonomous: t('fullyAutonomous') }, t('approvalRequired'));
  return (
    <div className={styles.configurableBody}>
      <div className={styles.widgetSettings}><span><small>{t('executionTarget')}</small><b>{target}</b></span><span><small>{t('approvalMode')}</small><b>{approval}</b></span></div>
      <div className={styles.workflowSteps}>{steps.map((step, index) => (
          <div className={styles.workflowStep} key={`${String(step.title || 'step')}-${index}`}>
            <span className={index === 0 ? styles.doneDot : index === 1 ? styles.liveDot : styles.idleDot} />
            <strong>{String(step.title || step.name || t('stepIndex', { index: index + 1 }))}</strong>
            <small>{String(step.status || (data.status === 'Running' && index === 1 ? t('stepRunning') : index === 0 ? t('stepDefined') : index === 1 ? t('stepInProgress') : t('stepPending')))}</small>
          </div>
        ))}</div>
    </div>
  );
}

function WebsiteBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const headline = typeof data.websiteHeadline === 'string' ? data.websiteHeadline : t('websiteHeadline');
  const description = typeof data.websiteBody === 'string' ? data.websiteBody : t('websiteBody');
  const cta = typeof data.websiteCta === 'string' ? data.websiteCta : t('websiteCta');
  const accent = typeof data.websiteAccent === 'string' ? data.websiteAccent : '#3978f6';
  const viewport = data.viewport === 'mobile' || data.viewport === 'tablet' ? data.viewport : 'desktop';
  return (
    <div className={styles.websitePreview} data-viewport={viewport}>
      <div className={styles.siteNav}><strong>{data.title}</strong><span>{t('siteNav')}</span><button style={{ background: accent }}>{t('getStarted')}</button></div>
      <div className={styles.siteHero}>
        <div><h3>{headline}</h3><div className={styles.websiteMarkdown}><ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown></div><button style={{ background: accent }}>{cta}</button></div>
        <div className={styles.heroArt} style={{ color: accent }}>{data.title.slice(0, 2).toUpperCase()}</div>
      </div>
      <div className={styles.siteBenefits}><span>{t('freeShipping')}</span><span>{t('easyReturns')}</span><span>{t('secureCheckout')}</span></div>
    </div>
  );
}

function DashboardBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const labels = Array.isArray(data.chartLabels) ? data.chartLabels.map(String).slice(0, 8) : [];
  const values = Array.isArray(data.chartValues) ? data.chartValues.map(Number).slice(0, 8) : [];
  const max = Math.max(1, ...values.filter(Number.isFinite));
  const dateRange = optionLabel(data.dateRange, { '30d': t('last30Days'), '7d': t('last7Days'), qtd: t('quarterToDate') }, t('last30Days'));
  const authoredKpis = Array.isArray(data.kpis) ? data.kpis.slice(0, 6) : [];
  const kpis = authoredKpis.length ? authoredKpis : data.kind === 'dashboard' ? [{ label: 'Reach', value: '212K', trend: '↑ 18.4%' }, { label: 'CTR', value: '3.6%', trend: '↑ 0.6pp' }, { label: 'Conversion', value: '2.1%', trend: '↑ 0.3pp' }] : [];
  const palette = ['#3978f6', '#25b7a3', '#7657df', '#f4a126', '#e85d75', '#46a4d9', '#9b6ad6', '#68b36b'];
  const positiveValues = values.map((value) => Number.isFinite(value) ? Math.max(0, value) : 0);
  const total = positiveValues.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  const donutStops = positiveValues.map((value, index) => {
    const start = total ? cursor / total * 100 : 0;
    cursor += value;
    const end = total ? cursor / total * 100 : 0;
    return `${palette[index % palette.length]} ${start}% ${end}%`;
  }).join(', ');
  return (
    <>
      {data.kind === 'dashboard' && <div className={styles.widgetContext}><span><small>{t('dateRange')}</small><b>{dateRange}</b></span>{typeof data.fetchedAt === 'string' && <span><small>{t('refreshed')}</small><b>{new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></span>}</div>}
      {kpis.length > 0 && <div className={styles.kpis}>{kpis.map((raw, index) => { const item = asRecord(raw, { label: t('metricIndex', { index: index + 1 }), value: raw }); return <div key={`${String(item.label)}-${index}`}><small>{String(item.label || t('metricIndex', { index: index + 1 }))}</small><strong>{String(item.value ?? '—')}</strong><em>{String(item.trend || '')}</em></div>; })}</div>}
      {typeof data.chartTitle === 'string' && data.chartTitle.trim() && <strong className={styles.chartTitle}>{data.chartTitle}</strong>}
      <div className={styles.charts}>
        <div><small>{typeof data.yAxisLabel === 'string' && data.yAxisLabel.trim() ? data.yAxisLabel : labels.length ? t('taskCountByStatus') : t('funnel')}</small>{labels.length ? <><div style={{ display: 'grid', gap: 5, marginTop: 7 }}>{labels.map((label, index) => <div key={`${label}-${index}`} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 38px', alignItems: 'center', gap: 5, fontSize: 9 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span><i style={{ display: 'block', height: 7, borderRadius: 5, background: '#08b59d', width: `${Math.max(4, (values[index] || 0) / max * 100)}%` }} /><b>{Number.isFinite(values[index]) ? values[index] : 0}</b></div>)}</div>{typeof data.xAxisLabel === 'string' && data.xAxisLabel.trim() && <small className={styles.axisLabel}>{data.xAxisLabel}</small>}</> : <div className={styles.funnel}><i /><i /><i /><i /></div>}</div>
        <div><small>{labels.length ? t('distribution') : t('channelMix')}</small>{labels.length && total > 0 ? <div className={styles.donutChart}><div className={styles.donut} role="img" aria-label={labels.map((label, index) => `${label}: ${positiveValues[index] ?? 0}`).join(', ')} style={{ background: `conic-gradient(${donutStops})` }} /><div className={styles.donutLegend}>{labels.map((label, index) => <span key={`${label}-legend-${index}`} title={`${label}: ${positiveValues[index] ?? 0}`}><i style={{ background: palette[index % palette.length] }} /><b>{label}</b><em>{positiveValues[index] ?? 0}</em></span>)}</div></div> : <div className={styles.donut} />}</div>
      </div>
    </>
  );
}

function MockupBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const project = textValue(data.deliveryProjectName, 'BuilderForce launch');
  const agent = textValue(data.mockupAgentName, 'Campaign Strategist');
  return <>
    <div className={styles.mockupGrid}><i /><i /><i /></div>
    <p>{data.subtitle || t('mockupFallback')}</p>
    <div className={styles.pills}><span>{data.status || t('draft')}</span><span>{t('projectPrefix', { name: project })}</span><span>{t('agentPrefix', { name: agent })}</span></div>
  </>;
}

/** Rows and columns rendered inside a Table/Dataset card before it scrolls. */
const DATA_GRID_VISIBLE_ROWS = 40;
const DATA_GRID_VISIBLE_COLUMNS = 10;

function DataGridBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const source = tabularFromObject(data as Record<string, unknown>);
  const highlightRules = Array.isArray(data.highlightRules)
    ? (data.highlightRules as unknown[]).flatMap((value) => {
      const rule = asRecord(value, {});
      return typeof rule.column === 'string' && typeof rule.tone === 'string'
        ? [{ column: rule.column, op: rule.op, value: rule.value, tone: rule.tone } as TabularHighlightRule]
        : [];
    })
    : [];
  if (!source.columns.length && !source.rows.length) return <AuthoredContent data={data} fallback={t('dataFallback')} />;
  const columns = source.columns.slice(0, DATA_GRID_VISIBLE_COLUMNS);
  const rows = source.rows.slice(0, DATA_GRID_VISIBLE_ROWS);
  const totalRows = typeof data.rowCount === 'number' ? data.rowCount : source.rows.length;
  const toneCounts = highlightRules.length
    ? source.rows.reduce<Record<string, number>>((counts, row) => {
      const tone = highlightToneFor(row, highlightRules);
      if (tone) counts[tone] = (counts[tone] ?? 0) + 1;
      return counts;
    }, {})
    : {};
  return <div className={styles.dataGridBody}>
    <p className={styles.fileMeta}>
      {t('rowsColumns', { rows: totalRows, columns: source.columns.length })}
      {source.columns.length > columns.length ? ` · ${t('columnsHidden', { hidden: source.columns.length - columns.length })}` : ''}
    </p>
    {!!Object.keys(toneCounts).length && <div className={styles.dataGridTones}>
      {Object.entries(toneCounts).map(([tone, count]) => <span key={tone} data-tone={tone}><i />{t(`tone_${tone}` as 'tone_success')}<b>{count.toLocaleString()}</b></span>)}
    </div>}
    <div className={`${styles.dataGridScroll} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
      <div className={styles.miniTable} style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(84px, 1fr))` }}>
        {columns.map((column) => <b key={column}>{column}</b>)}
        {rows.flatMap((row, rowIndex) => {
          const tone = highlightToneFor(row, highlightRules);
          return columns.map((column) => <span key={`${rowIndex}-${column}`} data-tone={tone ?? undefined}>{String(row[column] ?? '')}</span>);
        })}
      </div>
    </div>
    {totalRows > rows.length && <small className={styles.dataGridFooter}>{t('rowsShown', { shown: rows.length, total: totalRows })}</small>}
  </div>;
}

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

function formatFileSize(bytes: number): string {
  const unit = Math.min(FILE_SIZE_UNITS.length - 1, Math.max(0, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024))));
  const value = bytes / 1024 ** unit;
  const fractional = unit !== 0 && value < 10;
  const rounded = fractional ? value.toFixed(1) : String(Math.round(value));
  return `${rounded} ${FILE_SIZE_UNITS[unit]}`;
}

/** Non-tabular attachments. Tabular uploads become Dataset objects instead, so
 * this card only has to make an opaque file legible. */
function FileBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const name = textValue(data.fileName, data.title);
  const mimeType = textValue(data.mimeType, t('fileGeneric'));
  const size = Number(data.fileSize);
  const preview = textValue(data.content, textValue(data.markdown));
  const image = creativePreviewImageUrl(data);
  return <div className={styles.fileBody}>
    <div className={styles.widgetSettings}>
      <span><small>{t('fileType')}</small><b>{mimeType}</b></span>
      {Number.isFinite(size) && size > 0 && <span><small>{t('fileSize')}</small><b>{formatFileSize(size)}</b></span>}
    </div>
    {image
      ? <img className={styles.filePreviewImage} src={image} alt={t('filePreviewAlt', { name })} />
      : preview
        ? <pre className={`${styles.filePreview} nowheel nodrag`} tabIndex={0}>{preview.slice(0, 4_000)}</pre>
        : <p className={styles.filePreviewEmpty}>{t('filePreviewUnavailable')}</p>}
  </div>;
}

function KpiBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  return <div className={styles.kpis}><div><small>{data.title}</small><strong>{String(data.value ?? '—')}{data.unit ? ` ${String(data.unit)}` : ''}</strong><em>{data.trend ? String(data.trend) : data.target != null ? t('targetValue', { value: String(data.target) }) : ''}</em></div></div>;
}

function EvaluationBody({ data, onOpen }: { data: CreationNodeData; onOpen?: () => void }) {
  const t = useTranslations('creationCanvas.node');
  const gaps = Array.isArray(data.gaps) ? data.gaps.slice(0, 3).map(String) : [];
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations.slice(0, 3).map(String) : [];
  return (
    <div className={styles.evaluationBody}>
      <div className={styles.verdict}>{String(data.verdict || t('evaluationReady'))}</div>
      {(gaps.length ? gaps : [t('gapMessageMatch'), t('gapPrimaryAction'), t('gapDeliveryTiming')]).map((gap, index) => <div key={`${gap}-${index}`}><b>{index ? '△' : '✓'} {gap}</b><p>{recommendations[index] || (index ? t('askBrainResolution') : authoredText(data) || t('evidenceOnCanvas'))}</p></div>)}
      <button type="button" className="nodrag nowheel" onClick={(event) => { event.stopPropagation(); onOpen?.(); }}>{Array.isArray(data.testResults) && data.testResults.length ? t('reviewTestResults') : t('reviewEvaluationStep')}</button>
    </div>
  );
}

function ReleaseBody({ data, onOpen }: { data: CreationNodeData; onOpen?: () => void }) {
  const t = useTranslations('creationCanvas.node');
  return <div className={styles.releaseBody}>
    <p>{authoredText(data) || t('releaseFallback')}</p>
    <div className={`${styles.nodeActionBar} nodrag nowheel`}><button type="button" onClick={(event) => { event.stopPropagation(); onOpen?.(); }}>{t('deliveryChecklistStep')}</button></div>
  </div>;
}

type CanvasDiagnostic = {
  id: string;
  title: string;
  detail: string;
  severity: string;
  result: string;
  nextStep: string;
  location: string;
};

function diagnosticText(item: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function diagnosticItems(data: CreationNodeData, fallbackTitle: (index: number) => string, locationLine: (line: string) => string): CanvasDiagnostic[] {
  const source = [data.diagnostics, data.findings, data.checks, data.items]
    .flatMap((value) => Array.isArray(value) ? value : []);
  const normalized = source.map((value, index) => {
    const item = asRecord(value, { message: typeof value === 'string' ? value : fallbackTitle(index + 1) });
    const line = diagnosticText(item, ['line']);
    const path = diagnosticText(item, ['path', 'file', 'source']);
    return {
      id: diagnosticText(item, ['id', 'checkId', 'code']) || String(index),
      title: diagnosticText(item, ['title', 'message', 'issue', 'name', 'check', 'label']) || fallbackTitle(index + 1),
      detail: diagnosticText(item, ['detail', 'description', 'evidence', 'content']),
      severity: diagnosticText(item, ['severity', 'level', 'type']) || 'info',
      result: diagnosticText(item, ['result', 'outcome', 'status', 'actual']),
      nextStep: diagnosticText(item, ['nextStep', 'recommendation', 'remediation', 'action', 'fix']),
      location: [path, line ? locationLine(line) : ''].filter(Boolean).join(' · '),
    };
  });
  return normalized.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id && candidate.title === item.title && candidate.detail === item.detail) === index);
}

function diagnosticList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    const record = asRecord(item, {});
    const text = diagnosticText(record, ['title', 'message', 'step', 'action', 'recommendation', 'result', 'status']);
    return text ? [text] : [];
  });
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function DiagnosticsBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const diagnostics = diagnosticItems(data, (index) => t('diagnosticIndex', { index }), (line) => t('atLine', { line }));
  const explicitResults = diagnosticList(data.results);
  const topResult = textValue(data.result, textValue(data.summary, textValue(data.verdict, authoredText(data) || '')));
  const results = [...(topResult ? [topResult] : []), ...explicitResults];
  const nextSteps = [
    ...diagnosticList(data.nextSteps),
    ...diagnosticList(data.recommendations),
    ...diagnosticList(data.actions),
    ...diagnosticList(data.remediation),
    ...diagnostics.map((item) => item.nextStep).filter(Boolean),
    ...(Array.isArray(data.diagnostics) ? data.diagnostics.flatMap((value) => {
      const item = asRecord(value, {});
      return diagnosticList(item.recommendations);
    }) : []),
  ].filter((step, index, all) => all.indexOf(step) === index);
  const issueCount = data.gapCount == null ? diagnostics.filter((item) => !/^(hint|info|information|passed|pass|success|ok)$/i.test(item.severity) && !/^(passed|pass|success|ok)$/i.test(item.result)).length : Number(data.gapCount);
  const hasResults = results.length > 0 || diagnostics.some((item) => item.result);

  return <div className={styles.canvasDiagnosticsBody}>
    {data.qualityScore != null && <ProjectQualitySummary data={data} />}
    <div className={styles.diagnosticOverview}>
      <span><small>{t('checks')}</small><b>{diagnostics.length}</b></span>
      <span><small>{t('issues')}</small><b>{issueCount}</b></span>
      <span><small>{t('nextSteps')}</small><b>{nextSteps.length}</b></span>
    </div>
    <div className={styles.diagnosticColumns}>
      <section aria-label={t('diagnosticsFindings')}>
        <h4>{t('diagnosticsHeading')}</h4>
        <div className={styles.diagnosticList}>{diagnostics.length ? diagnostics.map((item) => <article key={item.id} data-severity={item.severity.toLowerCase()}>
          <span aria-hidden>{/^(error|critical|high)$/i.test(item.severity) ? '×' : /^(warning|warn|medium)$/i.test(item.severity) ? '!' : /^(passed|pass|success|ok)$/i.test(item.severity) ? '✓' : 'i'}</span>
          <div><b>{item.title}</b>{item.detail && <p>{item.detail}</p>}{item.location && <small>{item.location}</small>}</div>
        </article>) : <p className={styles.diagnosticEmpty}>{t('noDiagnosticsRecorded')}</p>}</div>
      </section>
      <section aria-label={t('diagnosticResults')}>
        <h4>{t('resultsHeading')}</h4>
        <div className={styles.diagnosticList}>{hasResults ? <>
          {results.map((result, index) => <article key={`${result}-${index}`} data-severity="result"><span aria-hidden>✓</span><div><b>{result}</b></div></article>)}
          {diagnostics.filter((item) => item.result).map((item) => <article key={`result-${item.id}`} data-severity="result"><span aria-hidden>→</span><div><b>{item.title}</b><p>{item.result}</p></div></article>)}
        </> : <p className={styles.diagnosticEmpty}>{t('runDiagnostics')}</p>}</div>
      </section>
      <section aria-label={t('diagnosticNextSteps')}>
        <h4>{t('nextSteps')}</h4>
        <ol className={styles.diagnosticSteps}>{nextSteps.length ? nextSteps.map((step, index) => <li key={`${step}-${index}`}><span>{index + 1}</span><p>{step}</p></li>) : <li className={styles.diagnosticEmpty}>{t('noFollowUp')}</li>}</ol>
      </section>
    </div>
  </div>;
}

function EvermindBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const version = typeof data.evermindVersion === 'number' ? data.evermindVersion : 0;
  const contributions = typeof data.contributions === 'number' ? data.contributions : 0;
  const loss = typeof data.trainingLoss === 'number' ? data.trainingLoss : null;
  const pending = typeof data.pendingContributions === 'number' ? data.pendingContributions : 0;
  if (data.evermindLoading === true) return <div className={styles.evermindSyncing} role="status"><span>◌</span><b>{t('evermindSyncing')}</b><p>{t('evermindSyncingDetail')}</p></div>;
  const recent = Array.isArray(data.recentLearnings)
    ? data.recentLearnings.flatMap((value, index) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      return [{
        id: String(item.id ?? index),
        kind: item.kind === 'delta' ? 'delta' as const : 'text' as const,
        version: typeof item.version === 'number' ? item.version : version,
        prompt: textValue(item.prompt),
        text: textValue(item.text),
        teacher: textValue(item.teacherModel),
        distilled: item.distilled === true,
        fitted: item.fitted !== false,
        weight: typeof item.weight === 'number' ? item.weight : 1,
        at: typeof item.at === 'number' ? item.at : 0,
        skipReason: textValue(item.skipReason),
        skipDetail: textValue(item.skipDetail),
        attemptedTeacherModel: textValue(item.attemptedTeacherModel),
      }];
    }).slice(0, 12)
    : [];
  const textLearnings = recent.filter((item) => item.kind === 'text');
  const fittedLearnings = recent.filter((item) => item.fitted);
  const teacherModel = textValue(data.teacherModel);
  const connected = data.learningMode !== 'offline-frozen' && data.status !== 'Blueprint';
  const inference = data.inferenceEnabled === true;
  const notYet = t('notYet');
  const lastLearned = typeof data.lastLearnedAt === 'string' && !Number.isNaN(Date.parse(data.lastLearnedAt))
    ? new Date(data.lastLearnedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : notYet;
  const nextAction = evermindNextAction({
    seeded: data.evermindSeeded === true || version > 0,
    inferenceEnabled: inference,
    mode: data.learningMode === 'offline-frozen' ? 'offline-frozen' : 'connected',
    pending,
    teacherModel: teacherModel || null,
    quarantinedAt: textValue(data.quarantinedAt) || null,
    recent,
    eval: data.evalPoint && typeof data.evalPoint === 'object' && typeof (data.evalPoint as Record<string, unknown>).delta === 'number' ? { delta: Number((data.evalPoint as Record<string, unknown>).delta) } : null,
  });
  return <div className={styles.evermindBody}>
    <div className={styles.evermindMetrics}>
      <span><small>{t('model')}</small><b>{version ? `v${version}` : t('blueprint')}</b></span>
      <span><small>{t('learned')}</small><b>{contributions}</b></span>
      <span><small>{t('queued')}</small><b>{pending}</b></span>
      <span><small>{t('trainingLoss')}</small><b>{loss == null ? '—' : loss.toFixed(3)}</b></span>
    </div>
    <div className={styles.evermindKnowledge}>
      <section className={styles.evermindMap} aria-label={t('knowledgeMapAria', { count: contributions })}>
        <div className={styles.evermindMapHeading}><b>{t('knowledgeMap')}</b><span className={connected ? styles.evermindLearning : styles.evermindFrozen}>{connected ? `● ${t('learning')}` : `○ ${t('waiting')}`}</span></div>
        <svg className={styles.evermindBrain} viewBox="0 0 320 172" role="img" aria-label={t('evermindBrainAria')}>
          <g className={styles.evermindMapEdges}>
            {[[160,28],[264,62],[54,73],[88,143],[155,148],[220,140],[272,112]].map(([x,y], index) => <line key={index} x1="160" y1="88" x2={x} y2={y} />)}
            <line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="88" y2="143" /><line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="155" y2="148" /><line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="220" y2="140" /><line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="272" y2="112" />
          </g>
          {teacherModel && <g className={styles.evermindTeacherFlow}><rect x="222" y="3" width="91" height="18" rx="9" /><text x="267" y="15" textAnchor="middle">{t('teacherPrefix', { model: teacherModel.slice(0, 13) })}</text><path d="M267 22 L265 36 L264 40" /><text x="285" y="35">{t('distils')}</text></g>}
          <EvermindRegion x={160} y={28} r={22} className={styles.regionNeocortex} label={t('regionNeocortex')} count={fittedLearnings.length} />
          <EvermindRegion x={264} y={62} r={21} className={styles.regionHippocampus} label={t('regionHippocampus')} count={textLearnings.length} />
          <EvermindRegion x={54} y={73} r={18} className={styles.regionPersonality} label={t('regionPersonality')} />
          <EvermindRegion x={88} y={143} r={13} className={styles.regionAmygdala} label={t('regionAmygdala')} small />
          <EvermindRegion x={155} y={148} r={13} className={styles.regionHypothalamus} label={t('regionHypothalamus')} small />
          <EvermindRegion x={220} y={140} r={13} className={styles.regionThalamus} label={t('regionThalamus')} small />
          <EvermindRegion x={272} y={112} r={13} className={styles.regionBasal} label={t('regionBasal')} small />
          <g className={styles.evermindCore}><circle cx="160" cy="88" r="25" /><circle cx="160" cy="88" r="19" /><text x="160" y="86" textAnchor="middle">🧠</text><text x="160" y="99" textAnchor="middle">{EVERMIND_BRAND}</text></g>
          {fittedLearnings.map((item, index) => <circle key={`neo-${item.id}`} className={styles.evermindKnowledgeNode} cx={122 + (index % 3) * 17} cy={18 + Math.floor(index / 3) * 12} r={3 + Math.min(item.weight, 3) / 2}><title>{item.kind === 'delta' ? t('weightDelta') : item.prompt || t('fittedLearning')}</title></circle>)}
          {textLearnings.map((item, index) => <circle key={`hip-${item.id}`} className={styles.evermindMemoryNode} cx={280 + (index % 2) * 11} cy={43 + Math.floor(index / 2) * 13} r={3 + Math.min(item.weight, 3) / 2}><title>{item.prompt || item.text || t('learnedTextTitle')}</title></circle>)}
          {!recent.length && <text className={styles.evermindDormantLabel} x="160" y="123" textAnchor="middle">{t('growMap')}</text>}
        </svg>
        <div className={styles.evermindLegend}><span><i data-kind="delta" /> {t('reasoningWeights')}</span><span><i data-kind="text" /> {t('learnedTextLegend')}</span><span><i data-kind="affect" /> {t('liveAffect')}</span></div>
      </section>
      <section className={styles.evermindRecent} aria-label={t('recentlyLearned')}>
        <div className={styles.evermindMapHeading}><b>{t('recentlyLearned')}</b><span>{recent.length ? t('shownCount', { count: Math.min(recent.length, 3) }) : t('empty')}</span></div>
        {recent.length ? recent.slice(0, 3).map((item) => {
          const learnedStatus = evermindLearnedStatus(item);
          const faulted = learnedStatus.state === 'fault';
          return <article key={item.id} data-learning-state={learnedStatus.state}>
            <i data-kind={item.kind} />
            <div><b>{item.prompt || (item.kind === 'delta' ? t('agentModelUpdate') : t('untitledLearning'))}</b><p>{faulted ? `${t('teacherNoAnswer')}${learnedStatus.reason ? ` · ${learnedStatus.reason.replaceAll('_', ' ')}` : ''}` : item.text || (item.kind === 'delta' ? t('weightsAdapted') : t('noReadableText'))}</p></div>
            <small>v{item.version}<strong>{learnedStatus.state === 'distilled' ? t('viaTeacher', { teacher: learnedStatus.teacherModel || t('teacher') }) : learnedStatus.state === 'fault' ? t('notDistilled') : learnedStatus.state === 'self' ? t('selfLearned') : t('weightDelta')}</strong></small>
          </article>;
        }) : <div className={styles.evermindEmpty}><span>◇</span><b>{t('nothingLearned')}</b><p>{t('nothingLearnedDetail')}</p></div>}
      </section>
    </div>
    <section className={styles.evermindNextAction} data-tone={nextAction.tone} aria-label={t('recommendedNextAction')}><span>{t('recommendedNextAction')}</span><div><b>{nextAction.title}</b><p>{nextAction.detail}</p></div><strong>{t('openDetails', { destination: nextAction.destination })}</strong></section>
    <div className={styles.evermindSignals}>
      <span><i className={connected ? styles.signalOn : styles.signalOff} /><small>{t('learning')}</small><b>{connected ? t('connected') : t('waiting')}</b></span>
      <span><i className={inference ? styles.signalOn : styles.signalOff} /><small>{t('replies')}</small><b>{inference ? t('onEvermind') : t('off')}</b></span>
      <span><i className={lastLearned === notYet ? styles.signalOff : styles.signalOn} /><small>{t('lastLearned')}</small><b>{lastLearned}</b></span>
    </div>
  </div>;
}

function EvermindRegion({ x, y, r, className, label, count, small = false }: { x: number; y: number; r: number; className: string; label: string; count?: number; small?: boolean }) {
  return <g className={`${styles.evermindRegion} ${className}`}><circle cx={x} cy={y} r={r + 4} /><circle cx={x} cy={y} r={r} /><text x={x} y={y + (small ? 2 : 3)} textAnchor="middle">{label}</text>{count != null && count > 0 && <g className={styles.evermindRegionCount}><circle cx={x + r - 1} cy={y - r + 1} r="7" /><text x={x + r - 1} y={y - r + 3} textAnchor="middle">{count}</text></g>}</g>;
}

function ProjectComparisonBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const projects = Array.isArray(data.projects) ? data.projects as Array<Record<string, unknown>> : [];
  const scored = projects.filter((project) => project.qualityScore != null && Number.isFinite(Number(project.qualityScore)));
  const portfolioScore = scored.length ? Math.round(scored.reduce((sum, project) => sum + Number(project.qualityScore), 0) / scored.length) : null;
  const totalGaps = projects.reduce((sum, project) => sum + Number(project.gapCount || 0), 0);
  const recommendations: Array<Record<string, unknown> & { project: string }> = projects.flatMap((project) => Array.isArray(project.recommendations)
    ? project.recommendations.map((item) => ({ project: String(project.name || t('project')), ...asRecord(item, {}) }))
    : []).sort((a, b) => Number((a as Record<string, unknown>).score ?? 101) - Number((b as Record<string, unknown>).score ?? 101)).slice(0, 5);
  return <div className={styles.comparisonBody}>
    <section className={styles.portfolioQuality} data-tone={scoreTone(portfolioScore)} aria-label={t('portfolioQualityAria')}>
      <div><small>{t('portfolioQuality')}</small><strong>{portfolioScore == null ? '—' : portfolioScore}<em>{t('perHundred')}</em></strong><span>{t('projectsAssessed', { scored: scored.length, total: projects.length })}</span></div>
      <div><small>{t('qualityCoverage')}</small><strong>{projects.reduce((sum, project) => sum + Number(project.diagnosticCount || 0), 0)}</strong><span>{t('diagnosticResultsCount')}</span></div>
      <div><small>{t('attentionNeeded')}</small><strong>{totalGaps}</strong><span>{t('openQualityGaps')}</span></div>
    </section>
    <div className={styles.comparisonTable}>
      <b>{t('project')}</b><b>{t('quality')}</b><b>{t('diagnosticsHeading')}</b><b>{t('delivery')}</b><b>{t('openBlocked')}</b>
      {projects.flatMap((project, index) => [
        <strong key={`${index}-name`}><i data-tone={scoreTone(project.qualityScore)} />{String(project.name || t('projectIndex', { index: index + 1 }))}<small>{String(project.status || t('active'))}</small></strong>,
        <span className={styles.comparisonScore} key={`${index}-quality`}><b>{project.qualityScore == null ? '—' : Math.round(Number(project.qualityScore))}</b><i><em style={{ width: `${Math.max(0, Math.min(100, Number(project.qualityScore || 0)))}%` }} /></i><small>{String(project.qualityLabel || t('notAssessed'))}</small></span>,
        <span key={`${index}-diagnostics`}><b>{t('resultsCount', { count: Number(project.diagnosticCount || 0) })}</b><small>{t('gapsCount', { count: Number(project.gapCount || 0) })}</small></span>,
        <span key={`${index}-delivery`}><b>{Number(project.progress || 0)}%</b><small>{project.velocity == null ? t('noVelocity') : t('ptsVelocity', { points: Number(project.velocity) })}</small></span>,
        <span key={`${index}-work`}>{Number(project.open || 0)} / {Number(project.blocked || 0)}</span>,
      ])}
    </div>
    <div className={styles.diagnosticMatrix}>
      {projects.map((project, index) => <section key={`${index}-diagnostics`}><header><b>{String(project.name)}</b><span>{t('gapsCount', { count: Number(project.gapCount || 0) })}</span></header>{Array.isArray(project.diagnostics) && project.diagnostics.length ? project.diagnostics.slice(0, 5).map((raw, diagnosticIndex) => { const diagnostic = asRecord(raw, {}); return <div key={`${String(diagnostic.toolId)}-${diagnosticIndex}`}><span>{String(diagnostic.icon || '◆')} {String(diagnostic.name || t('diagnostic'))}</span><b data-tone={scoreTone(diagnostic.score)}>{diagnostic.score == null ? '—' : Math.round(Number(diagnostic.score))}</b><small>{t('gapsCount', { count: Number(diagnostic.gapCount || 0) })}</small></div>; }) : <p>{t('noDiagnosticsRun')}</p>}</section>)}
    </div>
    <section className={styles.qualityRecommendations} aria-label={t('prioritizedRecommendations')}><header><b>{t('recommendedNextActions')}</b><span>{t('lowestScoringFirst')}</span></header>{recommendations.length ? recommendations.map((recommendation, index) => <article key={`${recommendation.project}-${String(recommendation.title)}-${index}`}><i>{index + 1}</i><div><b>{String(recommendation.title || t('reviewDiagnosticFinding'))}</b><p>{String(recommendation.detail || recommendation.diagnostic || '')}</p></div><span>{recommendation.project}<small>{String(recommendation.diagnostic || '')}</small></span></article>) : <p>{t('runQualityDiagnostics')}</p>}</section>
    <small>{t('freshness', { at: typeof data.fetchedAt === 'string' ? new Date(data.fetchedAt).toLocaleString() : t('draft') })}</small>
  </div>;
}

function StandupBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const participants = Array.isArray(data.participants) ? data.participants as Array<Record<string, unknown>> : [];
  return <div className={styles.standupBody}>
    <div className={styles.standupRoster}>{participants.length ? participants.map((person, index) => <span key={`${person.ref}-${index}`}><i>{String(person.name || '?').slice(0, 1)}</i><b>{String(person.name || t('participant'))}</b><small>{String(person.kind || t('human'))}</small></span>) : <p>{t('standupFallback')}</p>}</div>
    {typeof data.summary === 'string' && <div className={styles.standupSummary}><b>{t('brainFacilitator')}</b><p>{data.summary}</p></div>}
  </div>;
}

function DrawingBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const points = Array.isArray(data.points)
    ? data.points.filter((point): point is { x: number; y: number } => !!point && typeof point === 'object' && typeof (point as { x?: unknown }).x === 'number' && typeof (point as { y?: unknown }).y === 'number')
    : [];
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const stroke = String(data.stroke || '#5b5ce2');
  const strokeWidth = Number(data.strokeWidth) || 3;
  return <div className={styles.drawingBody}>
    <div className={styles.widgetContext}><span><small>{t('stroke')}</small><b><i className={styles.strokeSwatch} style={{ background: stroke }} />{t('strokePx', { width: strokeWidth })}</b></span></div>
    <svg className={styles.drawingSurface} style={{ color: stroke }} viewBox={`0 0 ${Number(data.drawingWidth) || 240} ${Number(data.drawingHeight) || 120}`} role="img" aria-label={data.title} preserveAspectRatio="none">
      {path ? <path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" /> : <text x="12" y="28" fill="currentColor">{t('drawHint')}</text>}
    </svg>
  </div>;
}

/**
 * The Brain Object — either the conversation itself, or an anchor pointing at it.
 *
 * There is exactly ONE Brain transcript on the canvas at a time. Where it renders is
 * the user's placement choice: docked to an edge, or right here in the graph. When it
 * is docked this Object is an anchor (latest exchange + a way back to the dock); when
 * it is inline the Object IS the chat, because a small chat card hovering over a board
 * that already carries a Brain Object was two live views of one conversation — the
 * "which one am I actually talking to?" confusion this canvas exists to avoid.
 *
 * Reading the placement from context rather than a prop is deliberate: `nodeTypes` has
 * to keep a stable identity or React Flow remounts the whole board, and consuming the
 * context HERE (not in CreationNode) means a streaming reply re-renders this node
 * alone rather than every Object on the canvas.
 */
function BrainObjectBody({ nodeId, data }: { nodeId: string; data: CreationNodeData }) {
  const t = useTranslations('creationCanvas');
  const surface = useBrainSurface();

  if (!surface || !surface.open || surface.mode !== 'inline') {
    // No handler while presenting: nothing can reveal Brain there, and an anchor that
    // offers a way in and then does nothing is worse than an anchor that stays quiet.
    return <BrainAnchorBody data={data} onOpen={surface?.canOpen ? () => surface.onOpen(nodeId) : undefined} />;
  }

  return (
    // Clicks are contained here on purpose. Selecting the Brain Object reveals the
    // conversation, so without this every control inside the conversation would also
    // re-reveal it — closing Brain would reopen it on the way back up. The Object's
    // header is outside this section and still selects the node normally.
    <section
      className={`${styles.brainObjectChat} nodrag nowheel`}
      aria-label={t('brainDock')}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={styles.brainObjectChatBar}>
        <BrainSurfaceActions
          mode={surface.mode}
          showExecutionDetail={surface.showExecutionDetail}
          onModeChange={surface.onModeChange}
          onExecutionDetailChange={surface.onExecutionDetailChange}
          onClose={surface.onClose}
        />
      </div>
      <BrainSurfaceBody
        showExecutionDetail={surface.showExecutionDetail}
        messages={surface.messages}
        trace={surface.trace}
        running={surface.running}
        runStartedAt={surface.runStartedAt}
        node={surface.nodes.find((candidate) => candidate.id === nodeId) ?? null}
        nodes={surface.nodes}
        edges={surface.edges}
        collaborators={surface.collaborators}
        joinedCollaborator={surface.joinedCollaborator}
      />
    </section>
  );
}

/**
 * The anchor: Brain's place in the graph (its connections are what scope a prompt)
 * plus the latest exchange, shown while the conversation itself lives in the dock.
 *
 * It narrates a running turn with the SAME signal as the dock — a Brain that is
 * clearly working on the board, not a card frozen on a stale reply — and keeps the
 * newest exchange scrolled into view, since the anchor is short and the reply that
 * just landed is the only one worth reading.
 */
function BrainAnchorBody({ data, onOpen }: { data: CreationNodeData; onOpen?: () => void }) {
  const t = useTranslations('creationCanvas.node');
  const messages = canvasChatMessages(data);
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const lastAssistant = [...messages].reverse().find((message) => message.role !== 'user');
  const reply = lastAssistant?.content || (typeof data.aiResponse === 'string' ? data.aiResponse : '');
  const running = data.brainRunning === true;
  const trace = Array.isArray(data.trace) ? data.trace as BrainTraceEvent[] : [];
  const activity = useBrainActivity(running, trace, typeof data.brainRunStartedAt === 'number' ? data.brainRunStartedAt : null);
  // The live phase is narrated ONCE, by the bar below — a turn with no reply yet
  // shows the invitation rather than repeating "Churning…" twice in one card.
  const brainText = reply || t('brainAnchorReplyFallback');

  const exchangeRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const scroller = exchangeRef.current;
    const latest = latestRef.current;
    if (!scroller || !latest) return;
    const top = latest.offsetTop - scroller.offsetTop;
    // Scroll WITHIN the anchor only — scrollIntoView would drag the board viewport.
    scroller.scrollTop = Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight));
  }, [brainText, lastUser?.content]);

  return <div className={styles.brainAnchorBody}>
    <div className={`${styles.brainAnchorExchange} nowheel`} ref={exchangeRef}>
      <span><small>{t('brainAnchorYou')}</small><p>{lastUser?.content || data.subtitle || t('brainAnchorPromptFallback')}</p></span>
      <span ref={latestRef}><small>{t('brainAnchorBrain')}</small><p>{brainText}</p></span>
    </div>
    <BrainActivityBar state={activity} variant="inline" />
    {onOpen && <div className={`${styles.nodeActionBar} nodrag nowheel`}><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(); }}>{t('openBrainChat')}</button></div>}
  </div>;
}

type CreationNodeProps = NodeProps<CreationFlowNode> & {
  canRun?: boolean;
  onRun?: (nodeId: string) => void;
  onOpenDetails?: (nodeId: string, focus?: 'knowledge' | 'test' | 'evaluation' | 'delivery') => void;
};

export function CreationNode({ id, data, selected, width, height, canRun = true, onRun, onOpenDetails }: CreationNodeProps) {
  const t = useTranslations('creationCanvas.node');
  const isWide = ['workflow', 'website', 'prototype', 'dashboard', 'chart', 'report', 'evaluation', 'diagnostics', 'roadmap', 'slides', 'document', 'prd', 'code', 'table', 'spreadsheet', 'featureSummary', 'mockupSet', 'evermind', 'projectComparison', 'frame'].includes(data.kind);
  const specialized = new Set(['workflow','website','prototype','dashboard','chart','report','evaluation','diagnostics','agent','staff','chat','dataset','table','spreadsheet','kpi','voice','note','project','roadmap','task','mockup','mockupSet','featureSummary','evermind','projectComparison','standup','drawing','frame','release','file']);
  const frameStyle = data.kind === 'frame' ? { background: String(data.frameColor || '#f8f6ff'), borderColor: String(data.frameBorder || '#9d8bea') } : undefined;
  const measuredStyle = { ...frameStyle, ...(typeof width === 'number' && width > 0 ? { width } : {}), ...(typeof height === 'number' && height > 0 ? { height } : {}) };
  return (
    <article style={measuredStyle} data-viewport={data.viewport} className={`${styles.node} ${styles[`node_${data.kind}`]} ${selected ? styles.selected : ''} ${isWide ? styles.wideNode : ''}`}>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={130} lineClassName={styles.resizeLine} handleClassName={styles.resizeHandle} />
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <header className={styles.nodeHeader}>
        {typeof data.pipelineStep === 'number' && <span className={styles.pipelineStepBadge}>{data.pipelineStep}</span>}
        <span className={styles.nodeIcon}>{creationObjectDefinition(data.kind).icon}</span>
        <strong>{data.title}</strong>
        {data.status && <span className={styles.status}>{data.status}</span>}
        {data.kind === 'workflow' && onRun && <button
          type="button"
          className={`${styles.workflowRunButton} nodrag nowheel`}
          disabled={!canRun}
          aria-label={t('runObject', { title: data.title })}
          onClick={(event) => { event.stopPropagation(); onRun(id); }}
        >{`▶ ${t('run')}`}</button>}
        <button className={styles.moreButton} aria-label={t('moreOptions', { title: data.title })}>•••</button>
      </header>
      <div className={styles.nodeBody}>
        {typeof data.pipelineStep === 'number' && <div className={styles.pipelineNodeGuide} data-start={data.pipelineStart === true ? 'true' : 'false'}><b>{data.pipelineStart === true ? t('startHere') : t('stepOfFive', { step: data.pipelineStep })}</b><span>{String(data.pipelineInstruction || t('pipelineFallback'))}</span></div>}
        {data.kind === 'workflow' && <WorkflowBody data={data} />}
        {(data.kind === 'website' || data.kind === 'prototype') && <WebsiteBody data={data} />}
        {(data.kind === 'dashboard' || data.kind === 'chart' || data.kind === 'report') && <DashboardBody data={data} />}
        {data.kind === 'evaluation' && <EvaluationBody data={data} onOpen={() => onOpenDetails?.(id, 'evaluation')} />}
        {data.kind === 'diagnostics' && <DiagnosticsBody data={data} />}
        {data.kind === 'agent' && <AgentBody data={data} onOpen={(focus) => onOpenDetails?.(id, focus)} />}
        {data.kind === 'staff' && <><div className={styles.personRow}><span className={styles.avatar} style={{ background: data.accent }}>{data.title.slice(0, 1)}</span><b>{data.role}</b><span className={styles.presence} /></div><small>{t('currentFocus')}</small><p>{data.focus}</p></>}
        {data.kind === 'chat' && <BrainObjectBody nodeId={id} data={data} />}
        {(data.kind === 'dataset' || data.kind === 'table' || data.kind === 'spreadsheet') && <DataGridBody data={data} />}
        {data.kind === 'file' && <FileBody data={data} />}
        {data.kind === 'kpi' && <KpiBody data={data} />}
        {data.kind === 'voice' && <><div className={styles.waveform}>▂▅▃▆▂▇▅▃▆▂▅▇▃▆▂▅</div><AuthoredContent data={data} fallback={t('voiceFallback')} /></>}
        {CREATIVE_STUDIO_KINDS.has(data.kind) && <CreativeStudioBody data={data} />}
        {data.kind === 'note' && <AuthoredContent data={data} fallback={t('noteFallback')} />}
        {data.kind === 'project' && <ProjectBody data={data} />}
        {data.kind === 'roadmap' && <div className={styles.roadmap}>{(Array.isArray(data.items) && data.items.length ? data.items.slice(0, 12) : [{ title: 'Validate narrative', phase: 'Now' }, { title: 'Executive review', phase: 'Next' }, { title: 'Measure adoption', phase: 'Later' }]).map((raw, index) => { const item = asRecord(raw, { title: raw, phase: index < 2 ? 'Now' : 'Next' }); return <div key={`${String(item.title)}-${index}`}><b>{String(item.phase || item.status || t('phaseIndex', { index: index + 1 }))}</b><span>{String(item.title || item.name || t('itemIndex', { index: index + 1 }))}</span>{item.description ? <span>{String(item.description)}</span> : null}</div>; })}</div>}
        {data.kind === 'task' && <TaskBody data={data} />}
        {data.kind === 'mockup' && <MockupBody data={data} />}
        {data.kind === 'mockupSet' && <><div className={styles.mockupGrid}><i /><i /><i /></div><p>{Array.isArray(data.items) && data.items.length ? t('linkedConcepts', { count: data.items.length }) : t('mockupSetFallback')}</p><div className={styles.pills}><span>{t('expandable')}</span><span>{t('citationsRetained')}</span></div></>}
        {data.kind === 'featureSummary' && <div className={styles.featureGrid}>{(Array.isArray(data.items) && data.items.length ? data.items.map((item) => typeof item === 'string' ? item : String((item as Record<string, unknown>)?.title || (item as Record<string, unknown>)?.name || t('feature'))).slice(0, 20) : ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration']).map((feature, index) => <span key={`${feature}-${index}`}><b>{index + 1}</b>{feature}</span>)}</div>}
        {data.kind === 'evermind' && <EvermindBody data={data} />}
        {data.kind === 'projectComparison' && <ProjectComparisonBody data={data} />}
        {data.kind === 'standup' && <StandupBody data={data} />}
        {data.kind === 'drawing' && <DrawingBody data={data} />}
        {data.kind === 'frame' && <div className={styles.frameBody}><strong>{String(data.framePurpose || t('arrangeObjects'))}</strong><p>{data.subtitle || t('frameFallback')}</p></div>}
        {data.kind === 'release' && <ReleaseBody data={data} onOpen={() => onOpenDetails?.(id, 'delivery')} />}
        {!specialized.has(data.kind) && <><AuthoredContent data={data} fallback={t('objectReady', { label: creationObjectDefinition(data.kind).label })} /><div className={styles.pills}><span>{data.status || t('canvasObject')}</span><span>{t('liveSessionContext')}</span></div></>}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </article>
  );
}
