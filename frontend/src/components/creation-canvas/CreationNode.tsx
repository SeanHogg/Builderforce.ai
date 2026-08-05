'use client';

import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BrainTimeline, evermindLearnedStatus, evermindNextAction } from '@seanhogg/builderforce-brain-ui';
import '@seanhogg/builderforce-brain-ui/styles.css';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';
import { creationObjectDefinition } from './creationObjectRegistry';

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

function brainTimelineMessages(data: CreationNodeData): BrainMessage[] {
  const messages = canvasChatMessages(data);
  const visible = messages.length ? messages : [
    { role: 'user', content: data.subtitle || 'What would you like to create?' },
    { role: 'assistant', content: typeof data.aiResponse === 'string' ? data.aiResponse : 'I added your starting objects to the canvas. Keep creating freely; connect an account only when you want to collaborate or deliver the work.' },
  ];
  return visible.map((message, index) => ({ id: index + 1, seq: index + 1, role: message.role, content: message.content, metadata: null, createdAt: message.createdAt || '' }));
}

function brainTimelineTrace(data: CreationNodeData): BrainTraceEvent[] {
  if (!Array.isArray(data.trace)) return [];
  return data.trace.filter((value): value is BrainTraceEvent => !!value && typeof value === 'object' && typeof (value as { ts?: unknown }).ts === 'string' && typeof (value as { category?: unknown }).category === 'string' && typeof (value as { label?: unknown }).label === 'string');
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

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function TaskBody({ data }: { data: CreationNodeData }) {
  const agent = textValue(data.assignee, textValue(data.agentName, textValue(data.role, 'Unassigned')));
  const priority = textValue(data.priority, 'Not set');
  const prdTitle = textValue(data.prdTitle);
  const prdSummary = textValue(data.prdSummary);
  const acceptance = textValue(data.acceptanceCriteria);
  return <div className={styles.taskBody}>
    <div className={styles.taskFacts}>
      <span><small>Agent</small><b>{agent}</b></span>
      <span><small>Priority</small><b>{priority}</b></span>
    </div>
    <AuthoredContent data={data} fallback="No task description yet." />
    <div className={styles.taskContext}>
      <small>PRD</small>
      {prdTitle || prdSummary
        ? <><b>{prdTitle || 'Linked requirements'}</b>{prdSummary && <p>{prdSummary}</p>}</>
        : <p className={styles.taskEmpty}>No PRD linked</p>}
    </div>
    {acceptance && <div className={styles.taskContext}><small>Done when</small><p>{acceptance}</p></div>}
  </div>;
}

type ProjectLens = 'everything' | 'delivery' | 'metrics' | 'customer-feedback';

function projectLens(data: CreationNodeData): ProjectLens {
  return data.projectLens === 'delivery' || data.projectLens === 'metrics' || data.projectLens === 'customer-feedback'
    ? data.projectLens
    : 'everything';
}

function ProjectBody({ data }: { data: CreationNodeData }) {
  const lens = projectLens(data);
  const status = textValue(data.status, 'Active');
  const open = Number.isFinite(Number(data.open)) ? String(Number(data.open)) : '—';
  const blocked = Number.isFinite(Number(data.blocked)) ? String(Number(data.blocked)) : '—';
  const maturity = data.maturity == null ? '3.8 / 5' : String(data.maturity);
  const velocity = data.velocity == null ? '42 pts' : `${String(data.velocity)}${typeof data.velocity === 'number' ? ' pts' : ''}`;
  const health = textValue(data.health, textValue(data.healthTier, 'On track'));
  const feedback = Array.isArray(data.feedback) ? data.feedback : Array.isArray(data.items) ? data.items : [];
  const quality = <ProjectQualitySummary data={data} />;

  if (lens === 'delivery') return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectHealth}>
      <div><small>Status</small><b>{status}</b></div>
      <div><small>Open work</small><b>{open}</b></div>
      <div><small>Blocked</small><b>{blocked}</b></div>
    </div>
    <p>{textValue(data.deliverySummary, data.subtitle || 'Expand this view to see project tasks, workflows, and assigned agents.')}</p>
  </div>;

  if (lens === 'metrics') return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectHealth}>
      <div><small>Maturity</small><b>{maturity}</b></div>
      <div><small>Velocity</small><b>{velocity}</b></div>
      <div><small>Health</small><b className={styles.healthy}>{health}</b></div>
    </div>
    <p>{textValue(data.metricsSummary, 'Live delivery and project-health metrics.')}</p>
  </div>;

  if (lens === 'customer-feedback') return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectFeedback}>
      <small>Customer feedback</small>
      {feedback.length
        ? feedback.slice(0, 4).map((item, index) => <span key={`${String(item)}-${index}`}>{typeof item === 'string' ? item : String((item as Record<string, unknown>)?.title || (item as Record<string, unknown>)?.name || `Feedback ${index + 1}`)}</span>)
        : <p>{textValue(data.feedbackSummary, data.subtitle || 'Expand this view to see requested features and customer evidence.')}</p>}
    </div>
  </div>;

  return <div className={styles.projectLensBody} data-project-lens={lens}>
    {quality}
    <div className={styles.projectOverview}>
      <span><small>Status</small><b>{status}</b></span>
      <span><small>Project context</small><b>Everything</b></span>
    </div>
    <p>{data.subtitle || 'Optional project context. Expand to see related work.'}</p>
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
  const score = Number(data.qualityScore);
  const hasScore = data.qualityScore != null && Number.isFinite(score);
  const diagnosticCount = Number(data.diagnosticCount || (Array.isArray(data.diagnostics) ? data.diagnostics.length : 0));
  const gapCount = Number(data.gapCount || 0);
  return <section className={styles.projectQuality} data-tone={scoreTone(data.qualityScore)} aria-label="Project quality">
    <div className={styles.qualityGauge} style={{ '--quality-score': hasScore ? Math.max(0, Math.min(100, score)) : 0 } as React.CSSProperties}>
      <strong>{hasScore ? Math.round(score) : '—'}</strong><small>/100</small>
    </div>
    <div><small>Quality</small><b>{textValue(data.qualityLabel, hasScore ? (score >= 80 ? 'Healthy' : score >= 60 ? 'Needs attention' : 'At risk') : 'Not assessed')}</b><p>{textValue(data.qualityHeadline, diagnosticCount ? `${diagnosticCount} diagnostics analyzed` : 'Load diagnostics to establish quality.')}</p></div>
    <span><b>{diagnosticCount}</b><small>diagnostics</small></span><span><b>{gapCount}</b><small>open gaps</small></span>
  </section>;
}

function optionLabel(value: unknown, labels: Record<string, string>, fallback: string): string {
  return typeof value === 'string' && labels[value] ? labels[value] : fallback;
}

function AgentBody({ data }: { data: CreationNodeData }) {
  const tools = Array.isArray(data.tools) ? data.tools.map(String) : ['Audience Analyzer', 'Copy Optimizer'];
  const autonomy = optionLabel(data.autonomy, { low: 'Low autonomy', medium: 'Medium autonomy', high: 'High autonomy' }, 'Medium autonomy');
  return <>
    <div className={styles.personRow}><span className={styles.presence} /><b>{data.status || 'Online'}</b><span>{data.model || 'gpt-4o'}</span></div>
    <p>{textValue(data.instructions, data.subtitle || '')}</p>
    <div className={styles.pills}>{tools.map((tool) => <span key={tool}>{tool}</span>)}<span>{autonomy}</span>{typeof data.testStatus === 'string' && data.testStatus && <span>{data.testStatus}</span>}</div>
  </>;
}

function WorkflowBody({ data }: { data: CreationNodeData }) {
  const authoredSteps = Array.isArray(data.steps) ? data.steps.slice(0, 12).map((step, index) => asRecord(step, { title: typeof step === 'string' ? step : `Step ${index + 1}` })) : [];
  const steps: Record<string, unknown>[] = authoredSteps.length ? authoredSteps : ['Audience', 'Create campaign', 'Approve', 'Publish'].map((title) => ({ title }));
  const target = optionLabel(data.runTarget, { builderforce: 'BuilderForce.AI', 'campaign-strategist': 'Campaign Strategist' }, 'BuilderForce.AI');
  const approval = optionLabel(data.approvalMode, { required: 'Approval required', autonomous: 'Fully autonomous' }, 'Approval required');
  return (
    <div className={styles.configurableBody}>
      <div className={styles.widgetSettings}><span><small>Execution target</small><b>{target}</b></span><span><small>Approval mode</small><b>{approval}</b></span></div>
      <div className={styles.workflowSteps}>{steps.map((step, index) => (
          <div className={styles.workflowStep} key={`${String(step.title || 'Step')}-${index}`}>
            <span className={index === 0 ? styles.doneDot : index === 1 ? styles.liveDot : styles.idleDot} />
            <strong>{String(step.title || step.name || `Step ${index + 1}`)}</strong>
            <small>{String(step.status || (data.status === 'Running' && index === 1 ? 'Running…' : index === 0 ? 'Defined' : index === 1 ? 'In progress' : 'Pending'))}</small>
          </div>
        ))}</div>
    </div>
  );
}

function WebsiteBody({ data }: { data: CreationNodeData }) {
  const headline = typeof data.websiteHeadline === 'string' ? data.websiteHeadline : 'Fall in love with every look';
  const description = typeof data.websiteBody === 'string' ? data.websiteBody : 'New arrivals for the season ahead.';
  const cta = typeof data.websiteCta === 'string' ? data.websiteCta : 'Shop the collection';
  const accent = typeof data.websiteAccent === 'string' ? data.websiteAccent : '#3978f6';
  const viewport = data.viewport === 'mobile' || data.viewport === 'tablet' ? data.viewport : 'desktop';
  return (
    <div className={styles.websitePreview} data-viewport={viewport}>
      <div className={styles.siteNav}><strong>{data.title}</strong><span>Product&nbsp;&nbsp; Solutions&nbsp;&nbsp; About</span><button style={{ background: accent }}>Get started</button></div>
      <div className={styles.siteHero}>
        <div><h3>{headline}</h3><div className={styles.websiteMarkdown}><ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown></div><button style={{ background: accent }}>{cta}</button></div>
        <div className={styles.heroArt} style={{ color: accent }}>{data.title.slice(0, 2).toUpperCase()}</div>
      </div>
      <div className={styles.siteBenefits}><span>Free shipping</span><span>Easy returns</span><span>Secure checkout</span></div>
    </div>
  );
}

function DashboardBody({ data }: { data: CreationNodeData }) {
  const labels = Array.isArray(data.chartLabels) ? data.chartLabels.map(String).slice(0, 8) : [];
  const values = Array.isArray(data.chartValues) ? data.chartValues.map(Number).slice(0, 8) : [];
  const max = Math.max(1, ...values.filter(Number.isFinite));
  const dateRange = optionLabel(data.dateRange, { '30d': 'Last 30 days', '7d': 'Last 7 days', qtd: 'Quarter to date' }, 'Last 30 days');
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
      {data.kind === 'dashboard' && <div className={styles.widgetContext}><span><small>Date range</small><b>{dateRange}</b></span>{typeof data.fetchedAt === 'string' && <span><small>Refreshed</small><b>{new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></span>}</div>}
      {kpis.length > 0 && <div className={styles.kpis}>{kpis.map((raw, index) => { const item = asRecord(raw, { label: `Metric ${index + 1}`, value: raw }); return <div key={`${String(item.label)}-${index}`}><small>{String(item.label || `Metric ${index + 1}`)}</small><strong>{String(item.value ?? '—')}</strong><em>{String(item.trend || '')}</em></div>; })}</div>}
      {typeof data.chartTitle === 'string' && data.chartTitle.trim() && <strong className={styles.chartTitle}>{data.chartTitle}</strong>}
      <div className={styles.charts}>
        <div><small>{typeof data.yAxisLabel === 'string' && data.yAxisLabel.trim() ? data.yAxisLabel : labels.length ? 'Task count by status' : 'Funnel'}</small>{labels.length ? <><div style={{ display: 'grid', gap: 5, marginTop: 7 }}>{labels.map((label, index) => <div key={`${label}-${index}`} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 38px', alignItems: 'center', gap: 5, fontSize: 9 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span><i style={{ display: 'block', height: 7, borderRadius: 5, background: '#08b59d', width: `${Math.max(4, (values[index] || 0) / max * 100)}%` }} /><b>{Number.isFinite(values[index]) ? values[index] : 0}</b></div>)}</div>{typeof data.xAxisLabel === 'string' && data.xAxisLabel.trim() && <small className={styles.axisLabel}>{data.xAxisLabel}</small>}</> : <div className={styles.funnel}><i /><i /><i /><i /></div>}</div>
        <div><small>{labels.length ? 'Distribution' : 'Channel mix'}</small>{labels.length && total > 0 ? <div className={styles.donutChart}><div className={styles.donut} role="img" aria-label={labels.map((label, index) => `${label}: ${positiveValues[index] ?? 0}`).join(', ')} style={{ background: `conic-gradient(${donutStops})` }} /><div className={styles.donutLegend}>{labels.map((label, index) => <span key={`${label}-legend-${index}`} title={`${label}: ${positiveValues[index] ?? 0}`}><i style={{ background: palette[index % palette.length] }} /><b>{label}</b><em>{positiveValues[index] ?? 0}</em></span>)}</div></div> : <div className={styles.donut} />}</div>
      </div>
    </>
  );
}

function MockupBody({ data }: { data: CreationNodeData }) {
  const project = textValue(data.deliveryProjectName, 'BuilderForce launch');
  const agent = textValue(data.mockupAgentName, 'Campaign Strategist');
  return <>
    <div className={styles.mockupGrid}><i /><i /><i /></div>
    <p>{data.subtitle || 'High-fidelity interactive concept ready for review.'}</p>
    <div className={styles.pills}><span>{data.status || 'Draft'}</span><span>Project: {project}</span><span>Agent: {agent}</span></div>
  </>;
}

function DataGridBody({ data }: { data: CreationNodeData }) {
  const columns = Array.isArray(data.columns) ? data.columns.map((column) => typeof column === 'string' ? column : String((column as Record<string, unknown>)?.name || (column as Record<string, unknown>)?.key || 'Column')).slice(0, 6) : [];
  const rows = Array.isArray(data.rows) ? data.rows.slice(0, 4) : Array.isArray(data.sampleRows) ? data.sampleRows.slice(0, 4) : [];
  if (!columns.length && !rows.length) return <AuthoredContent data={data} fallback="Add or import data, then ask Brain to analyze or visualize it." />;
  const resolvedColumns = columns.length ? columns : Object.keys(asRecord(rows[0], {})).slice(0, 6);
  return <><p className={styles.fileMeta}>{typeof data.rowCount === 'number' ? data.rowCount : rows.length} rows · {resolvedColumns.length} columns</p><div className={styles.miniTable} style={{ gridTemplateColumns: `repeat(${Math.max(1, resolvedColumns.length)}, minmax(70px, 1fr))` }}>{resolvedColumns.map((column) => <b key={column}>{column}</b>)}{rows.flatMap((row, rowIndex) => { const record = asRecord(row, {}); const values = Array.isArray(row) ? row : resolvedColumns.map((column) => record[column]); return values.slice(0, resolvedColumns.length).map((value, columnIndex) => <span key={`${rowIndex}-${resolvedColumns[columnIndex]}`}>{String(value ?? '')}</span>); })}</div></>;
}

function KpiBody({ data }: { data: CreationNodeData }) {
  return <div className={styles.kpis}><div><small>{data.title}</small><strong>{String(data.value ?? '—')}{data.unit ? ` ${String(data.unit)}` : ''}</strong><em>{data.trend ? String(data.trend) : data.target != null ? `Target ${String(data.target)}` : ''}</em></div></div>;
}

function EvaluationBody({ data }: { data: CreationNodeData }) {
  const gaps = Array.isArray(data.gaps) ? data.gaps.slice(0, 3).map(String) : [];
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations.slice(0, 3).map(String) : [];
  return (
    <div className={styles.evaluationBody}>
      <div className={styles.verdict}>{String(data.verdict || 'Evaluation ready')}</div>
      {(gaps.length ? gaps : ['Message match needs review', 'Validate the primary action', 'Confirm delivery timing']).map((gap, index) => <div key={`${gap}-${index}`}><b>{index ? '△' : '✓'} {gap}</b><p>{recommendations[index] || (index ? 'Ask Brain to propose a resolution.' : authoredText(data) || 'Evidence is available on the canvas.')}</p></div>)}
      <button>Apply recommendations</button>
    </div>
  );
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

function diagnosticItems(data: CreationNodeData): CanvasDiagnostic[] {
  const source = [data.diagnostics, data.findings, data.checks, data.items]
    .flatMap((value) => Array.isArray(value) ? value : []);
  const normalized = source.map((value, index) => {
    const item = asRecord(value, { message: typeof value === 'string' ? value : `Diagnostic ${index + 1}` });
    const line = diagnosticText(item, ['line']);
    const path = diagnosticText(item, ['path', 'file', 'source']);
    return {
      id: diagnosticText(item, ['id', 'checkId', 'code']) || String(index),
      title: diagnosticText(item, ['title', 'message', 'issue', 'name', 'check', 'label']) || `Diagnostic ${index + 1}`,
      detail: diagnosticText(item, ['detail', 'description', 'evidence', 'content']),
      severity: diagnosticText(item, ['severity', 'level', 'type']) || 'info',
      result: diagnosticText(item, ['result', 'outcome', 'status', 'actual']),
      nextStep: diagnosticText(item, ['nextStep', 'recommendation', 'remediation', 'action', 'fix']),
      location: [path, line ? `line ${line}` : ''].filter(Boolean).join(' · '),
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
  const diagnostics = diagnosticItems(data);
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

  return <div className={styles.canvasDiagnosticsBody}>
    {data.qualityScore != null && <ProjectQualitySummary data={data} />}
    <div className={styles.diagnosticOverview}>
      <span><small>Checks</small><b>{diagnostics.length}</b></span>
      <span><small>Issues</small><b>{issueCount}</b></span>
      <span><small>Next steps</small><b>{nextSteps.length}</b></span>
    </div>
    <div className={styles.diagnosticColumns}>
      <section aria-label="Diagnostics findings">
        <h4>Diagnostics</h4>
        <div className={styles.diagnosticList}>{diagnostics.length ? diagnostics.map((item) => <article key={item.id} data-severity={item.severity.toLowerCase()}>
          <span aria-hidden>{/^(error|critical|high)$/i.test(item.severity) ? '×' : /^(warning|warn|medium)$/i.test(item.severity) ? '!' : /^(passed|pass|success|ok)$/i.test(item.severity) ? '✓' : 'i'}</span>
          <div><b>{item.title}</b>{item.detail && <p>{item.detail}</p>}{item.location && <small>{item.location}</small>}</div>
        </article>) : <p className={styles.diagnosticEmpty}>No individual diagnostics recorded.</p>}</div>
      </section>
      <section aria-label="Diagnostic results">
        <h4>Results</h4>
        <div className={styles.diagnosticList}>{results.length || diagnostics.some((item) => item.result) ? <>
          {results.map((result, index) => <article key={`${result}-${index}`} data-severity="result"><span aria-hidden>✓</span><div><b>{result}</b></div></article>)}
          {diagnostics.filter((item) => item.result).map((item) => <article key={`result-${item.id}`} data-severity="result"><span aria-hidden>→</span><div><b>{item.title}</b><p>{item.result}</p></div></article>)}
        </> : <p className={styles.diagnosticEmpty}>Run the diagnostics to capture results.</p>}</div>
      </section>
      <section aria-label="Diagnostic next steps">
        <h4>Next steps</h4>
        <ol className={styles.diagnosticSteps}>{nextSteps.length ? nextSteps.map((step, index) => <li key={`${step}-${index}`}><span>{index + 1}</span><p>{step}</p></li>) : <li className={styles.diagnosticEmpty}>No follow-up action recorded.</li>}</ol>
      </section>
    </div>
  </div>;
}

function EvermindBody({ data }: { data: CreationNodeData }) {
  const version = typeof data.evermindVersion === 'number' ? data.evermindVersion : 0;
  const contributions = typeof data.contributions === 'number' ? data.contributions : 0;
  const loss = typeof data.trainingLoss === 'number' ? data.trainingLoss : null;
  const pending = typeof data.pendingContributions === 'number' ? data.pendingContributions : 0;
  if (data.evermindLoading === true) return <div className={styles.evermindSyncing} role="status"><span>◌</span><b>Syncing active project Evermind…</b><p>Loading the current version, learning activity, readiness, and recent contributions.</p></div>;
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
  const lastLearned = typeof data.lastLearnedAt === 'string' && !Number.isNaN(Date.parse(data.lastLearnedAt))
    ? new Date(data.lastLearnedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : 'Not yet';
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
      <span><small>Model</small><b>{version ? `v${version}` : 'Blueprint'}</b></span>
      <span><small>Learned</small><b>{contributions}</b></span>
      <span><small>Queued</small><b>{pending}</b></span>
      <span><small>Training loss</small><b>{loss == null ? '—' : loss.toFixed(3)}</b></span>
    </div>
    <div className={styles.evermindKnowledge}>
      <section className={styles.evermindMap} aria-label={`Knowledge map with ${contributions} learned contributions`}>
        <div className={styles.evermindMapHeading}><b>Knowledge map</b><span className={connected ? styles.evermindLearning : styles.evermindFrozen}>{connected ? '● Learning' : '○ Waiting'}</span></div>
        <svg className={styles.evermindBrain} viewBox="0 0 320 172" role="img" aria-label="Evermind cognitive regions and learned knowledge">
          <g className={styles.evermindMapEdges}>
            {[[160,28],[264,62],[54,73],[88,143],[155,148],[220,140],[272,112]].map(([x,y], index) => <line key={index} x1="160" y1="88" x2={x} y2={y} />)}
            <line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="88" y2="143" /><line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="155" y2="148" /><line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="220" y2="140" /><line className={styles.evermindSetpointEdge} x1="54" y1="73" x2="272" y2="112" />
          </g>
          {teacherModel && <g className={styles.evermindTeacherFlow}><rect x="222" y="3" width="91" height="18" rx="9" /><text x="267" y="15" textAnchor="middle">Teacher · {teacherModel.slice(0, 13)}</text><path d="M267 22 L265 36 L264 40" /><text x="285" y="35">distils</text></g>}
          <EvermindRegion x={160} y={28} r={22} className={styles.regionNeocortex} label="Neocortex" count={fittedLearnings.length} />
          <EvermindRegion x={264} y={62} r={21} className={styles.regionHippocampus} label="Hippocampus" count={textLearnings.length} />
          <EvermindRegion x={54} y={73} r={18} className={styles.regionPersonality} label="Personality" />
          <EvermindRegion x={88} y={143} r={13} className={styles.regionAmygdala} label="Amygdala" small />
          <EvermindRegion x={155} y={148} r={13} className={styles.regionHypothalamus} label="Hypothalamus" small />
          <EvermindRegion x={220} y={140} r={13} className={styles.regionThalamus} label="Thalamus" small />
          <EvermindRegion x={272} y={112} r={13} className={styles.regionBasal} label="Basal ganglia" small />
          <g className={styles.evermindCore}><circle cx="160" cy="88" r="25" /><circle cx="160" cy="88" r="19" /><text x="160" y="86" textAnchor="middle">🧠</text><text x="160" y="99" textAnchor="middle">Evermind</text></g>
          {fittedLearnings.map((item, index) => <circle key={`neo-${item.id}`} className={styles.evermindKnowledgeNode} cx={122 + (index % 3) * 17} cy={18 + Math.floor(index / 3) * 12} r={3 + Math.min(item.weight, 3) / 2}><title>{item.kind === 'delta' ? 'Weight delta' : item.prompt || 'Fitted learning'}</title></circle>)}
          {textLearnings.map((item, index) => <circle key={`hip-${item.id}`} className={styles.evermindMemoryNode} cx={280 + (index % 2) * 11} cy={43 + Math.floor(index / 2) * 13} r={3 + Math.min(item.weight, 3) / 2}><title>{item.prompt || item.text || 'Learned text'}</title></circle>)}
          {!recent.length && <text className={styles.evermindDormantLabel} x="160" y="123" textAnchor="middle">Teach or run work to grow this map</text>}
        </svg>
        <div className={styles.evermindLegend}><span><i data-kind="delta" /> Reasoning weights</span><span><i data-kind="text" /> Learned text</span><span><i data-kind="affect" /> Live affect</span></div>
      </section>
      <section className={styles.evermindRecent} aria-label="Recently learned">
        <div className={styles.evermindMapHeading}><b>Recently learned</b><span>{recent.length ? `${Math.min(recent.length, 3)} shown` : 'Empty'}</span></div>
        {recent.length ? recent.slice(0, 3).map((item) => {
          const learnedStatus = evermindLearnedStatus(item);
          const faulted = learnedStatus.state === 'fault';
          return <article key={item.id} data-learning-state={learnedStatus.state}>
            <i data-kind={item.kind} />
            <div><b>{item.prompt || (item.kind === 'delta' ? 'Agent model update' : 'Untitled learning')}</b><p>{faulted ? `Teacher produced no usable answer${learnedStatus.reason ? ` · ${learnedStatus.reason.replaceAll('_', ' ')}` : ''}` : item.text || (item.kind === 'delta' ? 'Weights adapted from an agent run.' : 'No readable learning text was retained.')}</p></div>
            <small>v{item.version}<strong>{learnedStatus.state === 'distilled' ? `via ${learnedStatus.teacherModel || 'teacher'}` : learnedStatus.state === 'fault' ? 'Not distilled' : learnedStatus.state === 'self' ? 'Self-learned' : 'Weight delta'}</strong></small>
          </article>;
        }) : <div className={styles.evermindEmpty}><span>◇</span><b>Nothing learned yet</b><p>Teach an example or complete agent work. Each learning will show what changed and where it came from.</p></div>}
      </section>
    </div>
    <section className={styles.evermindNextAction} data-tone={nextAction.tone} aria-label="Recommended next action"><span>Recommended next action</span><div><b>{nextAction.title}</b><p>{nextAction.detail}</p></div><strong>Open Details → {nextAction.destination}</strong></section>
    <div className={styles.evermindSignals}>
      <span><i className={connected ? styles.signalOn : styles.signalOff} /><small>Learning</small><b>{connected ? 'Connected' : 'Waiting'}</b></span>
      <span><i className={inference ? styles.signalOn : styles.signalOff} /><small>Replies</small><b>{inference ? 'On Evermind' : 'Off'}</b></span>
      <span><i className={lastLearned === 'Not yet' ? styles.signalOff : styles.signalOn} /><small>Last learned</small><b>{lastLearned}</b></span>
    </div>
  </div>;
}

function EvermindRegion({ x, y, r, className, label, count, small = false }: { x: number; y: number; r: number; className: string; label: string; count?: number; small?: boolean }) {
  return <g className={`${styles.evermindRegion} ${className}`}><circle cx={x} cy={y} r={r + 4} /><circle cx={x} cy={y} r={r} /><text x={x} y={y + (small ? 2 : 3)} textAnchor="middle">{label}</text>{count != null && count > 0 && <g className={styles.evermindRegionCount}><circle cx={x + r - 1} cy={y - r + 1} r="7" /><text x={x + r - 1} y={y - r + 3} textAnchor="middle">{count}</text></g>}</g>;
}

function ProjectComparisonBody({ data }: { data: CreationNodeData }) {
  const projects = Array.isArray(data.projects) ? data.projects as Array<Record<string, unknown>> : [];
  const scored = projects.filter((project) => project.qualityScore != null && Number.isFinite(Number(project.qualityScore)));
  const portfolioScore = scored.length ? Math.round(scored.reduce((sum, project) => sum + Number(project.qualityScore), 0) / scored.length) : null;
  const totalGaps = projects.reduce((sum, project) => sum + Number(project.gapCount || 0), 0);
  const recommendations: Array<Record<string, unknown> & { project: string }> = projects.flatMap((project) => Array.isArray(project.recommendations)
    ? project.recommendations.map((item) => ({ project: String(project.name || 'Project'), ...asRecord(item, {}) }))
    : []).sort((a, b) => Number((a as Record<string, unknown>).score ?? 101) - Number((b as Record<string, unknown>).score ?? 101)).slice(0, 5);
  return <div className={styles.comparisonBody}>
    <section className={styles.portfolioQuality} data-tone={scoreTone(portfolioScore)} aria-label="Portfolio quality summary">
      <div><small>Portfolio quality</small><strong>{portfolioScore == null ? '—' : portfolioScore}<em>/100</em></strong><span>{scored.length} of {projects.length} projects assessed</span></div>
      <div><small>Quality coverage</small><strong>{projects.reduce((sum, project) => sum + Number(project.diagnosticCount || 0), 0)}</strong><span>diagnostic results</span></div>
      <div><small>Attention needed</small><strong>{totalGaps}</strong><span>open quality gaps</span></div>
    </section>
    <div className={styles.comparisonTable}>
      <b>Project</b><b>Quality</b><b>Diagnostics</b><b>Delivery</b><b>Open / blocked</b>
      {projects.flatMap((project, index) => [
        <strong key={`${index}-name`}><i data-tone={scoreTone(project.qualityScore)} />{String(project.name || `Project ${index + 1}`)}<small>{String(project.status || 'active')}</small></strong>,
        <span className={styles.comparisonScore} key={`${index}-quality`}><b>{project.qualityScore == null ? '—' : Math.round(Number(project.qualityScore))}</b><i><em style={{ width: `${Math.max(0, Math.min(100, Number(project.qualityScore || 0)))}%` }} /></i><small>{String(project.qualityLabel || 'Not assessed')}</small></span>,
        <span key={`${index}-diagnostics`}><b>{Number(project.diagnosticCount || 0)} results</b><small>{Number(project.gapCount || 0)} gaps</small></span>,
        <span key={`${index}-delivery`}><b>{Number(project.progress || 0)}%</b><small>{project.velocity == null ? 'No velocity' : `${Number(project.velocity)} pts velocity`}</small></span>,
        <span key={`${index}-work`}>{Number(project.open || 0)} / {Number(project.blocked || 0)}</span>,
      ])}
    </div>
    <div className={styles.diagnosticMatrix}>
      {projects.map((project, index) => <section key={`${index}-diagnostics`}><header><b>{String(project.name)}</b><span>{Number(project.gapCount || 0)} gaps</span></header>{Array.isArray(project.diagnostics) && project.diagnostics.length ? project.diagnostics.slice(0, 5).map((raw, diagnosticIndex) => { const diagnostic = asRecord(raw, {}); return <div key={`${String(diagnostic.toolId)}-${diagnosticIndex}`}><span>{String(diagnostic.icon || '◆')} {String(diagnostic.name || 'Diagnostic')}</span><b data-tone={scoreTone(diagnostic.score)}>{diagnostic.score == null ? '—' : Math.round(Number(diagnostic.score))}</b><small>{Number(diagnostic.gapCount || 0)} gaps</small></div>; }) : <p>No diagnostics run yet</p>}</section>)}
    </div>
    <section className={styles.qualityRecommendations} aria-label="Prioritized recommendations"><header><b>Recommended next actions</b><span>Lowest-scoring evidence first</span></header>{recommendations.length ? recommendations.map((recommendation, index) => <article key={`${recommendation.project}-${String(recommendation.title)}-${index}`}><i>{index + 1}</i><div><b>{String(recommendation.title || 'Review diagnostic finding')}</b><p>{String(recommendation.detail || recommendation.diagnostic || '')}</p></div><span>{recommendation.project}<small>{String(recommendation.diagnostic || '')}</small></span></article>) : <p>Run quality diagnostics on a project to generate evidence-backed recommendations.</p>}</section>
    <small>Freshness: {typeof data.fetchedAt === 'string' ? new Date(data.fetchedAt).toLocaleString() : 'Draft'} · Sources attached</small>
  </div>;
}

function StandupBody({ data }: { data: CreationNodeData }) {
  const participants = Array.isArray(data.participants) ? data.participants as Array<Record<string, unknown>> : [];
  return <div className={styles.standupBody}>
    <div className={styles.standupRoster}>{participants.length ? participants.map((person, index) => <span key={`${person.ref}-${index}`}><i>{String(person.name || '?').slice(0, 1)}</i><b>{String(person.name || 'Participant')}</b><small>{String(person.kind || 'human')}</small></span>) : <p>Drag staff and agents onto the canvas, then gather the stand-up.</p>}</div>
    {typeof data.summary === 'string' && <div className={styles.standupSummary}><b>Brain facilitator</b><p>{data.summary}</p></div>}
  </div>;
}

function DrawingBody({ data }: { data: CreationNodeData }) {
  const points = Array.isArray(data.points)
    ? data.points.filter((point): point is { x: number; y: number } => !!point && typeof point === 'object' && typeof (point as { x?: unknown }).x === 'number' && typeof (point as { y?: unknown }).y === 'number')
    : [];
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const stroke = String(data.stroke || '#5b5ce2');
  const strokeWidth = Number(data.strokeWidth) || 3;
  return <div className={styles.drawingBody}>
    <div className={styles.widgetContext}><span><small>Stroke</small><b><i className={styles.strokeSwatch} style={{ background: stroke }} />{strokeWidth} px</b></span></div>
    <svg className={styles.drawingSurface} style={{ color: stroke }} viewBox={`0 0 ${Number(data.drawingWidth) || 240} ${Number(data.drawingHeight) || 120}`} role="img" aria-label={data.title} preserveAspectRatio="none">
      {path ? <path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" /> : <text x="12" y="28" fill="currentColor">Select Draw, then sketch on the canvas</text>}
    </svg>
  </div>;
}

type CreationNodeProps = NodeProps<CreationFlowNode> & {
  canRun?: boolean;
  onRun?: (nodeId: string) => void;
};

export function CreationNode({ id, data, selected, width, height, canRun = true, onRun }: CreationNodeProps) {
  const isWide = ['workflow', 'website', 'prototype', 'dashboard', 'chart', 'report', 'evaluation', 'diagnostics', 'roadmap', 'slides', 'document', 'prd', 'code', 'table', 'spreadsheet', 'featureSummary', 'mockupSet', 'evermind', 'projectComparison', 'frame'].includes(data.kind);
  const specialized = new Set(['workflow','website','prototype','dashboard','chart','report','evaluation','diagnostics','agent','staff','chat','dataset','table','spreadsheet','kpi','voice','note','project','roadmap','task','mockup','mockupSet','featureSummary','evermind','projectComparison','standup','drawing','frame']);
  const frameStyle = data.kind === 'frame' ? { background: String(data.frameColor || '#f8f6ff'), borderColor: String(data.frameBorder || '#9d8bea') } : undefined;
  const measuredStyle = { ...frameStyle, ...(typeof width === 'number' && width > 0 ? { width } : {}), ...(typeof height === 'number' && height > 0 ? { height } : {}) };
  const chatMessages = data.kind === 'chat' ? brainTimelineMessages(data) : [];
  const chatTrace = data.kind === 'chat' ? brainTimelineTrace(data) : [];
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
          aria-label={`Run ${data.title}`}
          onClick={(event) => { event.stopPropagation(); onRun(id); }}
        >▶ Run</button>}
        <button className={styles.moreButton} aria-label={`More options for ${data.title}`}>•••</button>
      </header>
      <div className={styles.nodeBody}>
        {typeof data.pipelineStep === 'number' && <div className={styles.pipelineNodeGuide} data-start={data.pipelineStart === true ? 'true' : 'false'}><b>{data.pipelineStart === true ? 'Start here' : `Step ${data.pipelineStep} of 5`}</b><span>{String(data.pipelineInstruction || 'Select this card to see the next action in Details.')}</span></div>}
        {data.kind === 'workflow' && <WorkflowBody data={data} />}
        {(data.kind === 'website' || data.kind === 'prototype') && <WebsiteBody data={data} />}
        {(data.kind === 'dashboard' || data.kind === 'chart' || data.kind === 'report') && <DashboardBody data={data} />}
        {data.kind === 'evaluation' && <EvaluationBody data={data} />}
        {data.kind === 'diagnostics' && <DiagnosticsBody data={data} />}
        {data.kind === 'agent' && <AgentBody data={data} />}
        {data.kind === 'staff' && <><div className={styles.personRow}><span className={styles.avatar} style={{ background: data.accent }}>{data.title.slice(0, 1)}</span><b>{data.role}</b><span className={styles.presence} /></div><small>Current focus</small><p>{data.focus}</p></>}
        {data.kind === 'chat' && <div className={`${styles.chatHistory} nowheel nodrag`} role="log" aria-label="Brain chat history" tabIndex={0}>
          <BrainTimeline messages={chatMessages} trace={chatTrace} streamingText="" isRunning={false} assistantName="Brain" labels={{ you: 'You', assistant: 'Brain' }} />
        </div>}
        {(data.kind === 'dataset' || data.kind === 'table' || data.kind === 'spreadsheet') && <DataGridBody data={data} />}
        {data.kind === 'kpi' && <KpiBody data={data} />}
        {data.kind === 'voice' && <><div className={styles.waveform}>▂▅▃▆▂▇▅▃▆▂▅▇▃▆▂▅</div><AuthoredContent data={data} fallback="Record or generate a voice note." /></>}
        {data.kind === 'note' && <AuthoredContent data={data} fallback="Double-click to add a thought." />}
        {data.kind === 'project' && <ProjectBody data={data} />}
        {data.kind === 'roadmap' && <div className={styles.roadmap}>{(Array.isArray(data.items) && data.items.length ? data.items.slice(0, 12) : [{ title: 'Validate narrative', phase: 'Now' }, { title: 'Executive review', phase: 'Next' }, { title: 'Measure adoption', phase: 'Later' }]).map((raw, index) => { const item = asRecord(raw, { title: raw, phase: index < 2 ? 'Now' : 'Next' }); return <div key={`${String(item.title)}-${index}`}><b>{String(item.phase || item.status || `Phase ${index + 1}`)}</b><span>{String(item.title || item.name || `Item ${index + 1}`)}</span>{item.description ? <span>{String(item.description)}</span> : null}</div>; })}</div>}
        {data.kind === 'task' && <TaskBody data={data} />}
        {data.kind === 'mockup' && <MockupBody data={data} />}
        {data.kind === 'mockupSet' && <><div className={styles.mockupGrid}><i /><i /><i /></div><p>{Array.isArray(data.items) && data.items.length ? `${data.items.length} linked concepts` : 'A reviewable collection of feature concepts. Ask Brain to expand every item.'}</p><div className={styles.pills}><span>Expandable</span><span>Citations retained</span></div></>}
        {data.kind === 'featureSummary' && <div className={styles.featureGrid}>{(Array.isArray(data.items) && data.items.length ? data.items.map((item) => typeof item === 'string' ? item : String((item as Record<string, unknown>)?.title || (item as Record<string, unknown>)?.name || 'Feature')).slice(0, 20) : ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration']).map((feature, index) => <span key={`${feature}-${index}`}><b>{index + 1}</b>{feature}</span>)}</div>}
        {data.kind === 'evermind' && <EvermindBody data={data} />}
        {data.kind === 'projectComparison' && <ProjectComparisonBody data={data} />}
        {data.kind === 'standup' && <StandupBody data={data} />}
        {data.kind === 'drawing' && <DrawingBody data={data} />}
        {data.kind === 'frame' && <div className={styles.frameBody}><strong>{String(data.framePurpose || 'Arrange related objects here')}</strong><p>{data.subtitle || 'A reusable spatial section for presentation, facilitation, or review.'}</p></div>}
        {!specialized.has(data.kind) && <><AuthoredContent data={data} fallback={`${creationObjectDefinition(data.kind).label} is ready to connect, edit, and use as Brain context.`} /><div className={styles.pills}><span>{data.status || 'Canvas object'}</span><span>Live session context</span></div></>}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </article>
  );
}
