'use client';

import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';
import { creationObjectDefinition } from './creationObjectRegistry';

export type CreationFlowNode = Node<CreationNodeData, 'creation'>;

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

function WorkflowBody({ data }: { data: CreationNodeData }) {
  const authoredSteps = Array.isArray(data.steps) ? data.steps.slice(0, 12).map((step, index) => asRecord(step, { title: typeof step === 'string' ? step : `Step ${index + 1}` })) : [];
  const steps: Record<string, unknown>[] = authoredSteps.length ? authoredSteps : ['Audience', 'Create campaign', 'Approve', 'Publish'].map((title) => ({ title }));
  return (
    <div className={styles.workflowSteps}>
      {steps.map((step, index) => (
        <div className={styles.workflowStep} key={`${String(step.title || 'Step')}-${index}`}>
          <span className={index === 0 ? styles.doneDot : index === 1 ? styles.liveDot : styles.idleDot} />
          <strong>{String(step.title || step.name || `Step ${index + 1}`)}</strong>
          <small>{String(step.status || (data.status === 'Running' && index === 1 ? 'Running…' : index === 0 ? 'Defined' : index === 1 ? 'In progress' : 'Pending'))}</small>
        </div>
      ))}
    </div>
  );
}

function WebsiteBody({ data }: { data: CreationNodeData }) {
  const headline = typeof data.websiteHeadline === 'string' ? data.websiteHeadline : 'Fall in love with every look';
  const description = typeof data.websiteBody === 'string' ? data.websiteBody : 'New arrivals for the season ahead.';
  const cta = typeof data.websiteCta === 'string' ? data.websiteCta : 'Shop the collection';
  const accent = typeof data.websiteAccent === 'string' ? data.websiteAccent : '#3978f6';
  return (
    <div className={styles.websitePreview}>
      <div className={styles.siteNav}><strong>{data.title}</strong><span>Product&nbsp;&nbsp; Solutions&nbsp;&nbsp; About</span><button style={{ background: accent }}>Get started</button></div>
      <div className={styles.siteHero}>
        <div><h3>{headline}</h3><p>{description}</p><button style={{ background: accent }}>{cta}</button></div>
        <div className={styles.heroArt} style={{ color: accent }}>{data.title.slice(0, 2).toUpperCase()}</div>
      </div>
      <div className={styles.siteBenefits}><span>Free shipping</span><span>Easy returns</span><span>Secure checkout</span></div>
    </div>
  );
}

function DashboardBody({ data }: { data: CreationNodeData }) {
  const labels = Array.isArray(data.chartLabels) ? data.chartLabels.map(String).slice(0, 6) : [];
  const values = Array.isArray(data.chartValues) ? data.chartValues.map(Number).slice(0, 6) : [];
  const max = Math.max(1, ...values.filter(Number.isFinite));
  return (
    <>
      <div className={styles.kpis}>{(Array.isArray(data.kpis) && data.kpis.length ? data.kpis.slice(0, 6) : [{ label: 'Reach', value: '212K', trend: '↑ 18.4%' }, { label: 'CTR', value: '3.6%', trend: '↑ 0.6pp' }, { label: 'Conversion', value: '2.1%', trend: '↑ 0.3pp' }]).map((raw, index) => { const item = asRecord(raw, { label: `Metric ${index + 1}`, value: raw }); return <div key={`${String(item.label)}-${index}`}><small>{String(item.label || `Metric ${index + 1}`)}</small><strong>{String(item.value ?? '—')}</strong><em>{String(item.trend || '')}</em></div>; })}</div>
      <div className={styles.charts}>
        <div><small>{labels.length ? 'Imported data' : 'Funnel'}</small>{labels.length ? <div style={{ display: 'grid', gap: 5, marginTop: 7 }}>{labels.map((label, index) => <div key={`${label}-${index}`} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 38px', alignItems: 'center', gap: 5, fontSize: 9 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span><i style={{ display: 'block', height: 7, borderRadius: 5, background: '#08b59d', width: `${Math.max(4, (values[index] || 0) / max * 100)}%` }} /><b>{Number.isFinite(values[index]) ? values[index] : 0}</b></div>)}</div> : <div className={styles.funnel}><i /><i /><i /><i /></div>}</div>
        <div><small>Channel mix</small><div className={styles.donut} /></div>
      </div>
    </>
  );
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

function EvermindBody({ data }: { data: CreationNodeData }) {
  const version = typeof data.evermindVersion === 'number' ? data.evermindVersion : 0;
  const contributions = typeof data.contributions === 'number' ? data.contributions : 0;
  const loss = typeof data.trainingLoss === 'number' ? data.trainingLoss : null;
  const stages = ['Dataset', 'Tokenize', 'Train', 'Evaluate', 'Publish'];
  return <div className={styles.evermindBody}>
    <div className={styles.evermindMetrics}><span><small>Version</small><b>{version ? `v${version}` : 'Draft'}</b></span><span><small>Learnings</small><b>{contributions}</b></span><span><small>Loss</small><b>{loss == null ? '—' : loss.toFixed(3)}</b></span></div>
    <div className={styles.evermindStages}>{stages.map((stage, index) => <span key={stage} className={index <= (version ? 4 : 1) ? styles.evermindStageActive : ''}>{stage}</span>)}</div>
    <p>{data.subtitle || 'A self-learning model blueprint. Attach project context to seed, teach, tune, evaluate, and deploy it.'}</p>
  </div>;
}

function ProjectComparisonBody({ data }: { data: CreationNodeData }) {
  const projects = Array.isArray(data.projects) ? data.projects as Array<Record<string, unknown>> : [];
  return <div className={styles.comparisonBody}>
    <div className={styles.comparisonTable}>
      <b>Project</b><b>Progress</b><b>Health</b><b>Velocity</b><b>Open / blocked</b>
      {projects.flatMap((project, index) => [
        <strong key={`${index}-name`}>{String(project.name || `Project ${index + 1}`)}</strong>,
        <span key={`${index}-progress`}>{Number(project.progress || 0)}%</span>,
        <span key={`${index}-health`}>{project.health == null ? 'No data' : `${Number(project.health)}/100`}</span>,
        <span key={`${index}-velocity`}>{project.velocity == null ? '—' : `${Number(project.velocity)} pts`}</span>,
        <span key={`${index}-work`}>{Number(project.open || 0)} / {Number(project.blocked || 0)}</span>,
      ])}
    </div>
    {projects.map((project, index) => <p key={`${index}-features`}><b>{String(project.name)}:</b> {Array.isArray(project.features) && project.features.length ? project.features.map(String).join(' · ') : 'No feature/task evidence available'}</p>)}
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
  return <svg className={styles.drawingSurface} viewBox={`0 0 ${Number(data.drawingWidth) || 240} ${Number(data.drawingHeight) || 120}`} role="img" aria-label={data.title} preserveAspectRatio="none">
    {path ? <path d={path} fill="none" stroke={String(data.stroke || '#5b5ce2')} strokeWidth={Number(data.strokeWidth) || 3} strokeLinecap="round" strokeLinejoin="round" /> : <text x="12" y="28">Select Draw, then sketch on the canvas</text>}
  </svg>;
}

export function CreationNode({ data, selected }: NodeProps<CreationFlowNode>) {
  const isWide = ['workflow', 'website', 'prototype', 'dashboard', 'chart', 'report', 'evaluation', 'roadmap', 'slides', 'document', 'prd', 'code', 'table', 'spreadsheet', 'featureSummary', 'mockupSet', 'evermind', 'projectComparison', 'frame'].includes(data.kind);
  const specialized = new Set(['workflow','website','prototype','dashboard','chart','report','evaluation','agent','staff','chat','dataset','table','spreadsheet','kpi','voice','note','project','roadmap','task','mockup','mockupSet','featureSummary','evermind','projectComparison','standup','drawing','frame']);
  const frameStyle = data.kind === 'frame' ? { background: String(data.frameColor || '#f8f6ff'), borderColor: String(data.frameBorder || '#9d8bea') } : undefined;
  return (
    <article style={frameStyle} className={`${styles.node} ${styles[`node_${data.kind}`]} ${selected ? styles.selected : ''} ${isWide ? styles.wideNode : ''}`}>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={130} lineClassName={styles.resizeLine} handleClassName={styles.resizeHandle} />
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <header className={styles.nodeHeader}>
        <span className={styles.nodeIcon}>{creationObjectDefinition(data.kind).icon}</span>
        <strong>{data.title}</strong>
        {data.status && <span className={styles.status}>{data.status}</span>}
        <button className={styles.moreButton} aria-label={`More options for ${data.title}`}>•••</button>
      </header>
      <div className={styles.nodeBody}>
        {data.kind === 'workflow' && <WorkflowBody data={data} />}
        {(data.kind === 'website' || data.kind === 'prototype') && <WebsiteBody data={data} />}
        {(data.kind === 'dashboard' || data.kind === 'chart' || data.kind === 'report') && <DashboardBody data={data} />}
        {data.kind === 'evaluation' && <EvaluationBody data={data} />}
        {data.kind === 'agent' && <><div className={styles.personRow}><span className={styles.presence} /><b>{data.status || 'Online'}</b><span>{data.model || 'gpt-4o'}</span></div><p>{data.subtitle}</p><div className={styles.pills}><span>Audience Analyzer</span><span>Copy Optimizer</span><span>Autonomy: Medium</span></div></>}
        {data.kind === 'staff' && <><div className={styles.personRow}><span className={styles.avatar} style={{ background: data.accent }}>{data.title.slice(0, 1)}</span><b>{data.role}</b><span className={styles.presence} /></div><small>Current focus</small><p>{data.focus}</p></>}
        {data.kind === 'chat' && <><div className={styles.message}><b>You</b><p>{data.subtitle || 'What would you like to create?'}</p></div><div className={styles.aiMessage}><b>Brain</b><p>{typeof data.aiResponse === 'string' ? data.aiResponse : 'I added your starting objects to the canvas. Keep creating freely; connect an account only when you want to collaborate or deliver the work.'}</p></div></>}
        {(data.kind === 'dataset' || data.kind === 'table' || data.kind === 'spreadsheet') && <DataGridBody data={data} />}
        {data.kind === 'kpi' && <KpiBody data={data} />}
        {data.kind === 'voice' && <><div className={styles.waveform}>▂▅▃▆▂▇▅▃▆▂▅▇▃▆▂▅</div><AuthoredContent data={data} fallback="Record or generate a voice note." /></>}
        {data.kind === 'note' && <AuthoredContent data={data} fallback="Double-click to add a thought." />}
        {data.kind === 'project' && <><div className={styles.projectHealth}><div><small>Maturity</small><b>3.8 / 5</b></div><div><small>Velocity</small><b>42 pts</b></div><div><small>Health</small><b className={styles.healthy}>On track</b></div></div><p>{data.subtitle || 'Optional project context. Expand to see related work.'}</p></>}
        {data.kind === 'roadmap' && <div className={styles.roadmap}>{(Array.isArray(data.items) && data.items.length ? data.items.slice(0, 12) : [{ title: 'Validate narrative', phase: 'Now' }, { title: 'Executive review', phase: 'Next' }, { title: 'Measure adoption', phase: 'Later' }]).map((raw, index) => { const item = asRecord(raw, { title: raw, phase: index < 2 ? 'Now' : 'Next' }); return <div key={`${String(item.title)}-${index}`}><b>{String(item.phase || item.status || `Phase ${index + 1}`)}</b><span>{String(item.title || item.name || `Item ${index + 1}`)}</span>{item.description ? <span>{String(item.description)}</span> : null}</div>; })}</div>}
        {data.kind === 'task' && <><div className={styles.personRow}><span className={styles.liveDot} /><b>{data.status || 'Ready'}</b><span>{String(data.assignee || data.role || 'Unassigned')}</span></div><AuthoredContent data={data} fallback="Build the approved mockup and deliver it to the project." /></>}
        {data.kind === 'mockup' && <><div className={styles.mockupGrid}><i /><i /><i /></div><p>{data.subtitle || 'High-fidelity interactive concept ready for review.'}</p><div className={styles.pills}><span>{data.status || 'Draft'}</span><span>Desktop + mobile</span></div></>}
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
