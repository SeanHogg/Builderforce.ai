'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Handle, NodeResizer, Position, useStore, type Node, type NodeProps } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Avatar, evermindLearnedStatus, evermindNextAction } from '@seanhogg/builderforce-brain-ui';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';
import { creationObjectDefinition } from './creationObjectRegistry';
import { BrainActivityBar, brainActivityLine, useBrainActivity } from './BrainActivityView';
import { BrainSurfaceActions, BrainSurfaceBody } from './BrainDock';
import { useBrainSurface } from './brainSurfaceContext';
import { highlightToneFor, profileTabular, tabularFromObject, workbookSheets, type TabularCell, type TabularHighlightRule } from '@/lib/canvasTabularData';
import { outlinePaths, projectMap, sanitizeGeoBounds, sanitizeMapPoints } from '@/lib/canvasGeo';
import { creativePreviewImageUrl } from '@/lib/creationDeliverables';
import { GAME_FRAME_SANDBOX, gameDocumentFrom } from '@/lib/gameTargets';
import { controlLabels, readGameControls } from '@/lib/gamePoster';
import { canvasBuildBinding } from '@/lib/canvasBuild';
import { canvasWebPageUrl, WEB_PAGE_KINDS } from '@/lib/canvasWebPage';
import { CanvasWebPage } from './CanvasWebPage';
import {
  PITCH_MAX_SCORE, formatPitchDuration, pitchApplicationAnswers, pitchApplicationReadiness, pitchBeats,
  pitchCompetitionFor, pitchCriteria, pitchEligibility, pitchQaCoverage, pitchQaItems, pitchReadiness,
  pitchReadinessTone, pitchRuntimeSeconds, pitchSpokenSeconds, pitchTimingTone, pitchWeakestCriteria,
  type PitchLabelled,
} from '@/lib/pitchCompetition';
import { useModalityCopy } from '@/lib/useModalityCopy';
import { authoredMarkdown, canvasDiagram, canvasDocument, canvasSlides } from '@/lib/canvasDocuments';
import type { CanvasExportAction } from '@/lib/canvasExports';
import { DocumentEditor } from './DocumentEditor';
import { CanvasExportActions } from './CanvasExportActions';
import { drawioLabelLines, drawioShapePolygon, parseDrawioXml, resolveDrawioXml, type DrawioGraph } from '@/lib/drawioDiagram';
import { MermaidDiagram } from '@/components/MermaidDiagram';
import { COURSE_EXPORT_STANDARDS, courseFromNode, courseProgress } from '@/lib/courseLms';
import ToolRunnerClient from '@/app/tools/[id]/ToolRunnerClient';
import type { ToolResult } from '@/lib/tools';

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

function CourseBody({ data, onEdit }: { data: CreationNodeData; onEdit?: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.course');
  const course = courseFromNode(data);
  const [activeId, setActiveId] = useState(course.modules[0]?.id ?? '');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const active = course.modules.find((module) => module.id === activeId) ?? course.modules[0];
  const progress = courseProgress(course);
  const completed = new Set(course.completedLessonIds);
  const toggleLesson = (lessonId: string) => {
    if (!onEdit) return;
    const next = new Set(course.completedLessonIds);
    if (next.has(lessonId)) next.delete(lessonId); else next.add(lessonId);
    onEdit({ course: { ...course, completedLessonIds: [...next] }, status: next.size === progress.total ? t('completed') : t('inProgress') });
  };
  if (!active) return <p>{t('empty')}</p>;
  return <div className={`${styles.courseShell} nodrag nowheel`}>
    <div className={styles.courseSummary}>
      <div><b>{t('progress', { percent: progress.percent })}</b><span>{t('lessonCount', { completed: progress.completed, total: progress.total })}</span></div>
      <div className={styles.courseProgress} role="progressbar" aria-label={t('progressLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><i style={{ width: `${progress.percent}%` }} /></div>
      <small>{t('duration', { minutes: course.estimatedMinutes })} · {COURSE_EXPORT_STANDARDS.join(' · ')}</small>
    </div>
    <div className={styles.courseWorkspace}>
      <nav aria-label={t('modules')}>
        {course.modules.map((module) => {
          const moduleDone = module.lessons.every((item) => completed.has(item.id));
          return <button key={module.id} type="button" aria-current={module.id === active.id ? 'step' : undefined} onClick={(event) => { event.stopPropagation(); setActiveId(module.id); }}><span>{moduleDone ? '✓' : String(course.modules.indexOf(module) + 1)}</span><b>{module.title.replace(/^\d+\.\s*/, '')}</b></button>;
        })}
      </nav>
      <section>
        <header><small>{t('module')}</small><h3>{active.title}</h3><p>{active.description}</p></header>
        {active.lessons.map((item) => <details key={item.id} open={!completed.has(item.id)}>
          <summary><span>{completed.has(item.id) ? '✓' : '○'}</span><b>{item.title}</b><small>{t('minutes', { count: item.durationMinutes })}</small></summary>
          <div className={styles.courseLesson}><strong>{t('objective')}</strong><p>{item.objective}</p><p>{item.content}</p><strong>{t('practice')}</strong><p>{item.activity}</p><button type="button" disabled={!onEdit} onClick={(event) => { event.stopPropagation(); toggleLesson(item.id); }}>{completed.has(item.id) ? t('markIncomplete') : t('markComplete')}</button></div>
        </details>)}
        <div className={styles.courseQuiz}>
          <strong>{t('knowledgeCheck')}</strong><p>{active.assessment.question}</p>
          {active.assessment.choices.map((choice, index) => <button key={choice} type="button" data-selected={answers[active.id] === index || undefined} onClick={(event) => { event.stopPropagation(); setAnswers((current) => ({ ...current, [active.id]: index })); }}><span>{String.fromCharCode(65 + index)}</span>{choice}</button>)}
          {answers[active.id] != null && <p role="status" data-correct={answers[active.id] === active.assessment.answer || undefined}><b>{answers[active.id] === active.assessment.answer ? t('correct') : t('tryAgain')}</b> {active.assessment.explanation}</p>}
        </div>
      </section>
    </div>
  </div>;
}

// `game` is deliberately absent: a game is the one creative kind whose artifact
// can be USED in place, so it gets a body that plays it rather than a tile that
// describes it. See GameBody.
const CREATIVE_STUDIO_KINDS = new Set(['image', 'animation', 'podcast', 'comic', 'cad', 'model3d', 'resume', 'template']);

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

/**
 * A live inbox tile.
 *
 * Two things are non-negotiable here and both are honesty about what is on
 * screen: the FILTER is shown (a tile reading "3 messages" with no visible
 * filter tells the reader they have three emails, which is false), and the read
 * TIME is shown (a live view with no freshness marker is a screenshot claiming
 * to be live).
 */
function InboxBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const account = textValue(data.accountEmail);
  const fetchedAt = typeof data.fetchedAt === 'string' ? new Date(data.fetchedAt) : null;
  const unread = Number(data.unreadCount) || 0;

  if (!account) {
    return <div className={styles.taskContext}><p className={styles.taskEmpty}>{t('inboxNotConnected')}</p></div>;
  }
  return <div className={styles.inboxBody}>
    <div className={styles.inboxMeta}>
      <span title={account}>{account}</span>
      {unread > 0 && <b className={styles.inboxUnreadBadge}>{t('inboxUnread', { count: unread })}</b>}
      {fetchedAt && <small>{t('inboxReadAt', { time: fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</small>}
    </div>
    {messages.length === 0
      ? <p className={styles.taskEmpty}>{t('inboxEmpty')}</p>
      : <ul className={styles.inboxList}>
        {messages.slice(0, 12).map((raw, index) => {
          const message = asRecord(raw, {});
          const isUnread = message.unread === true;
          return <li key={String(message.id ?? index)} className={isUnread ? styles.inboxUnread : undefined}>
            <div className={styles.inboxRowTop}>
              <b>{String(message.fromName || message.from || t('inboxUnknownSender'))}</b>
              <small>{message.receivedAtISO
                ? new Date(String(message.receivedAtISO)).toLocaleDateString([], { month: 'short', day: 'numeric' })
                : ''}</small>
            </div>
            <span className={styles.inboxSubject}>{String(message.subject || t('inboxNoSubject'))}</span>
            <p>{String(message.excerpt || '')}</p>
          </li>;
        })}
      </ul>}
    {messages.length > 12 && <small className={styles.inboxMore}>{t('inboxMore', { count: messages.length - 12 })}</small>}
  </div>;
}

/** One pinned message. Unlike the inbox tile this does NOT change — that is the
 *  reason it exists — so it shows the full body rather than an excerpt. */
function EmailBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const body = textValue(data.bodyText);
  const to = Array.isArray(data.to) ? data.to.map(String) : [];
  const webUrl = textValue(data.webUrl);
  return <div className={styles.taskBody}>
    <div className={styles.taskFacts}>
      <span><small>{t('emailFrom')}</small><b>{textValue(data.from, t('inboxUnknownSender'))}</b></span>
      <span><small>{t('emailTo')}</small><b>{to.join(', ') || '—'}</b></span>
    </div>
    <div className={styles.taskContext}>
      <small>{t('emailBody')}</small>
      {body ? <p className={styles.emailBodyText}>{body}</p> : <p className={styles.taskEmpty}>{t('emailNoBody')}</p>}
    </div>
    {webUrl && <a className={styles.inboxOpenLink} href={webUrl} target="_blank" rel="noreferrer noopener">{t('emailOpenInProvider')}</a>}
  </div>;
}

/**
 * A campaign tile. The counters lead, because "did it go out and did anyone
 * read it?" is the only question a campaign object is ever asked, and
 * `blockers` says plainly why a draft cannot send yet.
 */
function EmailCampaignBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const blockers = Array.isArray(data.blockers) ? data.blockers.map(String) : [];
  const stat = (value: unknown) => String(Number(value) || 0);
  return <div className={styles.taskBody}>
    <div className={styles.campaignStats}>
      <span><small>{t('campaignSent')}</small><b>{stat(data.sent)}/{stat(data.recipients)}</b></span>
      <span><small>{t('campaignOpened')}</small><b>{stat(data.opened)}</b></span>
      <span><small>{t('campaignClicked')}</small><b>{stat(data.clicked)}</b></span>
    </div>
    <div className={styles.taskFacts}>
      <span><small>{t('campaignAudience')}</small><b>{textValue(data.audienceName, '—')}</b></span>
      <span><small>{t('campaignVia')}</small><b>{textValue(data.transport, 'platform')}</b></span>
    </div>
    {textValue(data.subject) && <div className={styles.taskContext}><small>{t('campaignSubject')}</small><b>{String(data.subject)}</b></div>}
    {blockers.length > 0 && <div className={styles.taskContext}><small>{t('campaignBlocked')}</small><p>{blockers.join(' · ')}</p></div>}
  </div>;
}

/** A template tile. `mergeFields` is the load-bearing part: it is the contract
 *  the audience has to satisfy, and seeing it here is what stops a send that
 *  renders `{{company}}` as a gap in four thousand inboxes. */
function EmailTemplateBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const fields = Array.isArray(data.mergeFields) ? data.mergeFields.map(String) : [];
  const logoUrl = textValue(data.logoUrl);
  return <div className={styles.taskBody}>
    {logoUrl && <img className={styles.templateLogo} src={logoUrl} alt="" />}
    <div className={styles.taskContext}>
      <small>{t('templateSubject')}</small>
      <b>{textValue(data.subject, t('templateNoSubject'))}</b>
    </div>
    <div className={styles.taskContext}>
      <small>{t('templateMergeFields')}</small>
      {fields.length
        ? <div className={styles.pills}>{fields.slice(0, 8).map((field) => <span key={field}>{`{{${field}}}`}</span>)}</div>
        : <p className={styles.taskEmpty}>{t('templateNoMergeFields')}</p>}
    </div>
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

/**
 * What one authored step actually CALLS, in one line — "twilio → send_sms".
 * A step with no call to make returns null, and the body says so rather than
 * letting a bare title imply the step is configured.
 */
function stepCall(step: Record<string, unknown>): string | null {
  const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const connector = str(step.connector);
  if (connector) return `${connector} → ${str(step.action) || str(step.actionKey) || '?'}`;
  const model = str(step.model) || str(step.provider);
  if (model || str(step.prompt)) return model ? `LLM · ${model}` : 'LLM';
  const role = str(step.role);
  if (role) return `agent · ${role}`;
  return null;
}

function WorkflowBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const steps = Array.isArray(data.steps)
    ? data.steps.slice(0, 12).map((step, index) => asRecord(step, { title: typeof step === 'string' ? step : t('stepIndex', { index: index + 1 }) }))
    : [];
  const target = optionLabel(data.runTarget, { builderforce: 'BuilderForce.AI', 'campaign-strategist': 'Campaign Strategist' }, 'BuilderForce.AI');
  const approval = optionLabel(data.approvalMode, { required: t('approvalRequired'), autonomous: t('fullyAutonomous') }, t('approvalRequired'));
  // Compile issues from the last build attempt, surfaced on the card itself so
  // "why will this not run" is answered where the Run button is.
  const issues = Array.isArray(data.workflowIssues) ? data.workflowIssues.slice(0, 4) : [];
  const linked = typeof data.resourceId === 'string' && data.resourceId.startsWith('workflow:');
  return (
    <div className={styles.configurableBody}>
      <div className={styles.widgetSettings}><span><small>{t('executionTarget')}</small><b>{target}</b></span><span><small>{t('approvalMode')}</small><b>{approval}</b></span></div>
      {steps.length === 0 ? (
        // No invented stages. An empty workflow states that it is empty and what
        // it needs — the placeholder list that used to render here read as real
        // configuration and was the reason a Twilio request showed campaign steps.
        <div className={styles.workflowEmpty}>
          <strong>{t('workflowNoSteps')}</strong>
          <small>{t('workflowNoStepsHint')}</small>
        </div>
      ) : (
        <div className={styles.workflowSteps}>{steps.map((step, index) => {
          const call = stepCall(step);
          const status = typeof step.status === 'string' && step.status ? step.status : '';
          const normalized = status.toLowerCase();
          // Status comes from the step, never from its POSITION. The old body
          // drew step 1 green and step 2 blue on every workflow, so a card that
          // had never run looked half-complete.
          const dot = normalized.startsWith('fail') || normalized.startsWith('error') ? styles.failDot
            : normalized.startsWith('complete') || normalized.startsWith('done') || normalized === 'delivered' ? styles.doneDot
            : normalized.startsWith('run') || normalized.startsWith('progress') ? styles.liveDot
            : styles.idleDot;
          return (
            <div className={styles.workflowStep} key={`${String(step.title || 'step')}-${index}`}>
              <span className={dot} />
              <strong>{String(step.title || step.name || t('stepIndex', { index: index + 1 }))}</strong>
              {call ? <code>{call}</code> : <small>{t('stepNotConfigured')}</small>}
              <small>{status || (linked ? t('stepPending') : t('stepNotBuilt'))}</small>
            </div>
          );
        })}</div>
      )}
      {issues.length > 0 && (
        <div className={styles.workflowIssues} role="status">
          {issues.map((issue, index) => {
            const record = asRecord(issue, {});
            return <small key={index}>{`${record.title ? `${String(record.title)}: ` : ''}${String(record.message ?? issue)}`}</small>;
          })}
        </div>
      )}
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

/**
 * Builder tile — the canvas face of a real IDE project. It reports the binding
 * (type, workspace state, published URL) and leaves every capability to the IDE
 * surface the inspector opens, so nothing here duplicates the builder itself.
 */
function BuildBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.build');
  const modality = useModalityCopy()(typeof data.modality === 'string' ? data.modality : null);
  const binding = canvasBuildBinding(data);
  const siteUrl = canvasWebPageUrl(data);
  return (
    <div className={styles.buildBody}>
      <div className={styles.buildType}>
        <span aria-hidden>{modality.icon}</span>
        <strong>{modality.label}</strong>
        <em data-bound={binding ? 'true' : 'false'}>{binding ? t('tileReady') : t('tileNotCreated')}</em>
      </div>
      <p>{binding ? t('tileBoundHint') : t('tileUnboundHint')}</p>
      <div className={styles.pills}>
        {modality.showRunButton && <span>{t('pillDevServer')}</span>}
        {modality.showChecks && <span>{t('pillChecks')}</span>}
        <span>{t('pillPublish')}</span>
      </div>
      {siteUrl && <a className={styles.buildLink} href={siteUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{siteUrl}</a>}
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

/**
 * The Map Object — places plotted where they actually are.
 *
 * The card draws its own geography (see `lib/canvasGeo`): a graticule, an optional
 * boundary the object carries with it, and one marker per plotted row. There is no tile
 * layer, so the map renders identically online, offline, and in an export, and a private
 * canvas never announces what it is plotting to a third-party raster host.
 *
 * Everything geometric is computed by the pure projection helper and rendered here as a
 * flat `map()`, so the maths is unit-tested rather than eyeballed at card size.
 */
function MapBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const points = useMemo(() => sanitizeMapPoints(data.mapPoints), [data.mapPoints]);
  const region = useMemo(() => sanitizeGeoBounds(data.mapRegion), [data.mapRegion]);
  const projection = useMemo(() => projectMap(points, { width: 320, height: 190, region }), [points, region]);
  const outline = useMemo(
    () => (projection && data.mapOutline ? outlinePaths(data.mapOutline, projection.project) : []),
    [projection, data.mapOutline],
  );

  if (!projection) {
    return <div className={styles.mapBody}>
      <p className={styles.mapEmpty}>{t('mapEmpty')}</p>
      <div className={styles.pills}><span>{data.status || t('mapEmptyStatus')}</span></div>
    </div>;
  }

  const valueLabel = typeof data.mapValueLabel === 'string' && data.mapValueLabel.trim() ? data.mapValueLabel.trim() : '';
  const valued = projection.points.filter((point) => typeof point.value === 'number');
  // Only the largest few carry a printed name — at card size every label collides, and
  // a legible map of the top places beats an illegible one of all of them. The rest stay
  // readable through the marker's own title/aria text.
  const labelled = new Set([...valued].sort((first, second) => (second.value ?? 0) - (first.value ?? 0)).slice(0, 5).map((point) => point.label));
  const [south, north, west, east] = projection.bounds;
  const ariaLabel = t('mapAria', {
    count: projection.points.length,
    places: projection.points.slice(0, 12).map((point) => point.value != null ? `${point.label} (${point.value.toLocaleString()})` : point.label).join(', '),
  });

  return (
    <div className={styles.mapBody}>
      <div className={styles.widgetContext}>
        <span><small>{t('mapPlaces')}</small><b>{projection.points.length.toLocaleString()}</b></span>
        {typeof data.mapRegionName === 'string' && data.mapRegionName.trim() && <span><small>{t('mapRegion')}</small><b>{data.mapRegionName}</b></span>}
        {valueLabel && valued.length > 0 && <span><small>{t('mapSizedBy')}</small><b>{valueLabel}</b></span>}
      </div>
      <svg className={styles.mapSurface} viewBox={`0 0 ${projection.width} ${projection.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={ariaLabel}>
        <rect className={styles.mapPlate} x="0" y="0" width={projection.width} height={projection.height} rx="8" />
        <g className={styles.mapGraticule}>
          {projection.graticule.verticals.map((line) => <line key={`v${line.lng}`} x1={line.x} y1="0" x2={line.x} y2={projection.height} />)}
          {projection.graticule.horizontals.map((line) => <line key={`h${line.lat}`} x1="0" y1={line.y} x2={projection.width} y2={line.y} />)}
        </g>
        {outline.length > 0 && <g className={styles.mapOutline}>{outline.map((path, index) => <path key={`outline-${index}`} d={path} />)}</g>}
        <g className={styles.mapMarkers}>
          {projection.points.map((point, index) => (
            <circle key={`${point.label}-${index}`} cx={point.x} cy={point.y} r={point.radius} data-tone={point.tone ?? undefined}>
              <title>{point.value != null ? `${point.label} — ${point.value.toLocaleString()}${valueLabel ? ` ${valueLabel}` : ''}` : point.label}</title>
            </circle>
          ))}
        </g>
        <g className={styles.mapLabels}>
          {projection.points.filter((point) => labelled.has(point.label)).map((point, index) => (
            <text key={`label-${point.label}-${index}`} x={point.x} y={point.y - point.radius - 2.5} textAnchor="middle">{point.label.slice(0, 22)}</text>
          ))}
        </g>
      </svg>
      <div className={styles.mapFooter}>
        <small>{t('mapExtent', { south: south.toFixed(1), north: north.toFixed(1), west: west.toFixed(1), east: east.toFixed(1) })}</small>
        {typeof data.mapAttribution === 'string' && data.mapAttribution.trim() && <small>{data.mapAttribution}</small>}
      </div>
    </div>
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

/**
 * Rows, columns, and — for authored Table and Spreadsheet objects — direct
 * editing. A sheet a person can only look at is a screenshot; this one takes a
 * value, a renamed header, a new row, or a new column straight back into the
 * object, so the canvas holds a working sheet rather than a picture of one.
 */
function DataGridBody({ data, onEdit }: { data: CreationNodeData; onEdit?: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.node');
  // A card re-renders on selection, drag, and every neighbouring edit. Normalizing
  // an imported workbook's rows is O(rows × columns) per sheet, so doing it inline
  // would re-walk a 50,000-row import on each of those renders.
  const source = useMemo(() => tabularFromObject(data as Record<string, unknown>), [data]);
  const editable = !!onEdit && Array.isArray(data.rows) && (data.kind === 'spreadsheet' || data.kind === 'table');
  const [draft, setDraft] = useState<{ row: number; column: string; value: string } | null>(null);
  const sheets = useMemo(() => workbookSheets(data as Record<string, unknown>), [data]);
  const activeSheet = textValue(data.activeSheet, sheets[0]?.name ?? '');
  const writeRows = (rows: Array<Record<string, TabularCell>>, columns = source.columns) => {
    onEdit?.({
      columns, rows, rowCount: rows.length, sampleRows: rows.slice(0, 25), profile: profileTabular({ columns, rows }),
      // An edit belongs to the tab it was made on. Without writing it back into
      // the workbook, switching sheets and returning would discard it.
      ...(sheets.length ? { sheets: sheets.map((sheet) => sheet.name === activeSheet ? { name: sheet.name, columns, rows } : sheet) } : {}),
    });
  };
  const selectSheet = (name: string) => {
    const sheet = sheets.find((item) => item.name === name);
    if (!sheet || name === activeSheet) return;
    onEdit?.({
      activeSheet: name, columns: sheet.columns, rows: sheet.rows, rowCount: sheet.rows.length,
      sampleRows: sheet.rows.slice(0, 25), profile: profileTabular(sheet),
      subtitle: t('rowsColumns', { rows: sheet.rows.length, columns: sheet.columns.length }),
    });
  };
  const commitDraft = () => {
    if (!draft) { return; }
    const value = draft.value;
    if (draft.row < 0) {
      const name = value.trim() || draft.column;
      if (name !== draft.column && !source.columns.includes(name)) {
        writeRows(
          source.rows.map((row) => Object.fromEntries(source.columns.map((column) => [column === draft.column ? name : column, row[column] ?? ''])) as Record<string, TabularCell>),
          source.columns.map((column) => column === draft.column ? name : column),
        );
      }
    } else if (String(source.rows[draft.row]?.[draft.column] ?? '') !== value) {
      writeRows(source.rows.map((row, index) => index === draft.row ? { ...row, [draft.column]: value } : row));
    }
    setDraft(null);
  };
  const editorProps = (row: number, column: string) => ({
    className: styles.dataGridEditor,
    autoFocus: true,
    value: draft?.value ?? '',
    'aria-label': row < 0 ? t('editColumnName', { column }) : t('editCell', { column, row: row + 1 }),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft({ row, column, value: event.target.value }),
    onBlur: commitDraft,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') { event.preventDefault(); commitDraft(); }
      if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
    },
  });
  const highlightRules = Array.isArray(data.highlightRules)
    ? (data.highlightRules as unknown[]).flatMap((value) => {
      const rule = asRecord(value, {});
      return typeof rule.column === 'string' && typeof rule.tone === 'string'
        ? [{ column: rule.column, op: rule.op, value: rule.value, tone: rule.tone } as TabularHighlightRule]
        : [];
    })
    : [];
  if (!source.columns.length && !source.rows.length && !editable) return <AuthoredContent data={data} fallback={t('dataFallback')} />;
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
    {sheets.length > 1 && <div className={`${styles.sheetTabs} nodrag nowheel`} role="tablist" aria-label={t('workbookSheets')}>
      {sheets.map((sheet) => <button
        key={sheet.name}
        type="button"
        role="tab"
        aria-selected={sheet.name === activeSheet}
        disabled={!onEdit}
        title={t('sheetShape', { name: sheet.name, rows: sheet.rows.length, columns: sheet.columns.length })}
        onClick={(event) => { event.stopPropagation(); selectSheet(sheet.name); }}
      >{sheet.name}</button>)}
    </div>}
    <p className={styles.fileMeta}>
      {t('rowsColumns', { rows: totalRows, columns: source.columns.length })}
      {source.columns.length > columns.length ? ` · ${t('columnsHidden', { hidden: source.columns.length - columns.length })}` : ''}
    </p>
    {!!Object.keys(toneCounts).length && <div className={styles.dataGridTones}>
      {Object.entries(toneCounts).map(([tone, count]) => <span key={tone} data-tone={tone}><i />{t(`tone_${tone}` as 'tone_success')}<b>{count.toLocaleString()}</b></span>)}
    </div>}
    <div className={`${styles.dataGridScroll} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
      <div className={styles.miniTable} data-editable={editable ? 'true' : undefined} style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(84px, 1fr))` }}>
        {columns.map((column) => <b key={column}>
          {editable && draft?.row === -1 && draft.column === column
            ? <input {...editorProps(-1, column)} />
            : editable
              ? <button type="button" className={styles.dataGridCellButton} onClick={() => setDraft({ row: -1, column, value: column })}>{column}</button>
              : column}
        </b>)}
        {rows.flatMap((row, rowIndex) => {
          const tone = highlightToneFor(row, highlightRules);
          return columns.map((column) => {
            const value = String(row[column] ?? '');
            return <span key={`${rowIndex}-${column}`} data-tone={tone ?? undefined}>
              {editable && draft?.row === rowIndex && draft.column === column
                ? <input {...editorProps(rowIndex, column)} />
                : editable
                  ? <button type="button" className={styles.dataGridCellButton} onClick={() => setDraft({ row: rowIndex, column, value })}>{value || ' '}</button>
                  : value}
            </span>;
          });
        })}
      </div>
    </div>
    {editable && <div className={`${styles.dataGridActions} nodrag nowheel`}>
      <button type="button" onClick={() => writeRows([...source.rows, Object.fromEntries(source.columns.map((column) => [column, ''])) as Record<string, TabularCell>])}>{t('addRow')}</button>
      <button type="button" onClick={() => {
        const name = t('columnName', { index: source.columns.length + 1 });
        const column = source.columns.includes(name) ? `${name}-${source.columns.length + 1}` : name;
        writeRows(source.rows.map((row) => ({ ...row, [column]: '' })), [...source.columns, column]);
      }}>{t('addColumn')}</button>
    </div>}
    {totalRows > rows.length && <small className={styles.dataGridFooter}>{t('rowsShown', { shown: rows.length, total: totalRows })}</small>}
  </div>;
}

/**
 * A document object rendered AS a document — the pages, headings, tables and
 * lists that were written — instead of the first paragraph of its source text.
 * Pages are turned, not scrolled past: a file imported from Word or PDF keeps
 * the breaks its author declared, so the page on the card is the page in the
 * source file, and a twenty-page market analysis is readable on the board
 * without opening anything.
 *
 * The card is also where the document is WORKED ON. Asking for a document and
 * then being sent to a markdown box in a side panel to fix one sentence — or to
 * a different surface again to get a file out of it — is three places to learn
 * for one document. Write it here, take it away from here.
 */
function DocumentBody({ data, onEdit }: {
  data: CreationNodeData;
  /** Absent on a board this person cannot edit, which is what removes the Edit
   * control rather than leaving an inert one behind. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('creationCanvas.node');
  const [requested, setRequested] = useState(0);
  const [editing, setEditing] = useState(false);
  // Paginating re-splits the whole body; a twenty-page import would do that on
  // every re-render of a card that is only being dragged.
  const document = useMemo(() => canvasDocument(data), [data]);
  // The editor works on the RAW body, not the paginated read of it: the page
  // breaks a Word or PDF import declared are markers inside that body, and
  // saving the flattened version back would collapse the file to one page.
  const source = authoredMarkdown(data) ?? '';
  const pages = document?.pages ?? [];
  // Editing can shorten a document under a reader who has turned past the new
  // last page, so the rendered page is always clamped to what exists.
  const page = Math.min(Math.max(requested, 0), Math.max(0, pages.length - 1));
  const paginated = !editing && pages.length > 1;

  // Only the Edit toggle lives here. Downloads are the shared export row that
  // every artifact card carries, so a document and a deck offer their formats
  // in the same place and neither list can drift from the other.
  const actions = onEdit ? <div className={`${styles.cardActions} nodrag nowheel`}>
    <button
      type="button"
      data-active={editing ? 'true' : undefined}
      aria-pressed={editing}
      onClick={(event) => { event.stopPropagation(); setEditing(!editing); }}
    >{editing ? t('documentDone') : t('documentEdit')}</button>
  </div> : null;

  if (editing && onEdit) return <div className={styles.documentBody}>
    {actions}
    <DocumentEditor markdown={source} label={data.title} onCommit={(markdown) => onEdit({ markdown, content: markdown })} />
  </div>;

  if (!document) return <>{actions}<AuthoredContent data={data} fallback={t('documentFallback')} /></>;

  return <div className={styles.documentBody}>
    <div className={styles.documentMeta}>
      <span>{t('documentPages', { count: document.pageCount })}</span>
      <span>{t('documentWords', { count: document.wordCount })}</span>
      <span>{t('documentReading', { minutes: document.readingMinutes })}</span>
      {typeof data.sourceFormat === 'string' && <span>{String(data.sourceFormat)}</span>}
    </div>
    {actions}
    <div className={`${styles.documentSheet} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
      <div className={styles.documentPage} data-paginated={paginated ? 'true' : undefined}>
        <div className={styles.documentMarkdown}><ReactMarkdown remarkPlugins={[remarkGfm]}>{pages[page] ?? document.markdown}</ReactMarkdown></div>
        {paginated && <span className={styles.documentPageNumber} aria-hidden>{page + 1}</span>}
      </div>
    </div>
    {paginated && <div className={`${styles.documentPager} nodrag nowheel`}>
      <button
        type="button"
        disabled={page === 0}
        aria-label={t('previousPage')}
        title={t('previousPage')}
        onClick={(event) => { event.stopPropagation(); setRequested(page - 1); }}
      >‹</button>
      <span aria-live="polite">{t('pageOfPages', { page: page + 1, total: pages.length })}</span>
      <button
        type="button"
        disabled={page >= pages.length - 1}
        aria-label={t('nextPage')}
        title={t('nextPage')}
        onClick={(event) => { event.stopPropagation(); setRequested(page + 1); }}
      >›</button>
    </div>}
  </div>;
}

/** A deck rendered as slides. Authored slide items win; a deck written as
 * markdown is split on rules, then on headings. */
function SlidesBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const slides = canvasSlides(data);
  if (!slides.length) return <AuthoredContent data={data} fallback={t('slidesFallback')} />;
  return <div className={styles.slidesBody}>
    <div className={styles.documentMeta}>
      <span>{t('slideCount', { count: slides.length })}</span>
      <span>{textValue(data.outputFormat, 'PPTX')}</span>
    </div>
    <div className={`${styles.slideDeck} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
      {slides.map((slide, index) => <article key={`${slide.title}-${index}`} className={styles.slideThumb}>
        <span className={styles.slideNumber}>{index + 1}</span>
        <b>{slide.title || t('slideUntitled', { index: index + 1 })}</b>
        {!!slide.bullets.length && <ul>{slide.bullets.slice(0, 5).map((bullet, bulletIndex) => <li key={`${bullet}-${bulletIndex}`}>{bullet}</li>)}</ul>}
      </article>)}
    </div>
  </div>;
}

/** Ink that stays readable on a fill the diagram file chose, in either theme. */
function readableInk(fill: string | undefined): string {
  const hex = fill?.trim().replace('#', '');
  if (!hex || (hex.length !== 3 && hex.length !== 6)) return 'var(--canvas-ink, #142234)';
  const expanded = hex.length === 3 ? hex.split('').map((character) => character + character).join('') : hex;
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16) / 255);
  const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  return luminance > 0.55 ? '#10203a' : '#f7faff';
}

function DrawioCanvas({ graph, title }: { graph: DrawioGraph; title: string }) {
  const markerId = `arrow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return <svg
    className={styles.diagramCanvas}
    viewBox={`${graph.x} ${graph.y} ${graph.width} ${graph.height}`}
    preserveAspectRatio="xMidYMid meet"
    role="img"
    aria-label={title}
  >
    <defs>
      <marker id={markerId} markerWidth="10" markerHeight="10" refX="9" refY="3.2" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L9,3.2 L0,6.4 z" fill="currentColor" />
      </marker>
    </defs>
    {graph.edges.map((edge) => <g key={edge.id} style={{ color: edge.stroke ?? 'var(--canvas-muted, #5c6e88)' }}>
      <polyline
        points={edge.points.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        {...(edge.dashed ? { strokeDasharray: '6 4' } : {})}
        {...(edge.arrow ? { markerEnd: `url(#${markerId})` } : {})}
      />
      {edge.label && <text
        x={(edge.points[0]!.x + edge.points[edge.points.length - 1]!.x) / 2}
        y={(edge.points[0]!.y + edge.points[edge.points.length - 1]!.y) / 2 - 4}
        textAnchor="middle"
        fontSize={11}
        fill="var(--canvas-muted, #5c6e88)"
      >{edge.label}</text>}
    </g>)}
    {graph.vertices.map((vertex) => {
      const polygon = drawioShapePolygon(vertex);
      const fill = vertex.fill ?? 'var(--canvas-widget-surface, #fff)';
      const stroke = vertex.stroke ?? 'var(--canvas-widget-border, #ccd8e7)';
      const ink = vertex.fontColor ?? (vertex.fill ? readableInk(vertex.fill) : 'var(--canvas-ink, #142234)');
      const lines = drawioLabelLines(vertex.label, vertex.width, vertex.fontSize);
      const shapeProps = { fill: vertex.shape === 'text' ? 'none' : fill, stroke: vertex.shape === 'text' ? 'none' : stroke, strokeWidth: 1.4, ...(vertex.dashed ? { strokeDasharray: '6 4' } : {}) };
      return <g key={vertex.id}>
        {vertex.imageUrl
          ? <image href={vertex.imageUrl} x={vertex.x} y={vertex.y} width={vertex.width} height={vertex.height} preserveAspectRatio="xMidYMid meet" />
          : polygon
          ? <polygon points={polygon} {...shapeProps} />
          : vertex.shape === 'ellipse'
            ? <ellipse cx={vertex.x + vertex.width / 2} cy={vertex.y + vertex.height / 2} rx={vertex.width / 2} ry={vertex.height / 2} {...shapeProps} />
            : vertex.shape === 'cylinder'
              ? <g {...shapeProps}><rect x={vertex.x} y={vertex.y + 8} width={vertex.width} height={Math.max(vertex.height - 16, 1)} /><ellipse cx={vertex.x + vertex.width / 2} cy={vertex.y + 8} rx={vertex.width / 2} ry={8} /><ellipse cx={vertex.x + vertex.width / 2} cy={vertex.y + vertex.height - 8} rx={vertex.width / 2} ry={8} /></g>
              : <rect x={vertex.x} y={vertex.y} width={vertex.width} height={vertex.height} rx={vertex.shape === 'rounded' ? 10 : 0} {...shapeProps} />}
        {!vertex.imageUrl && lines.map((line, index) => <text
          key={`${vertex.id}-${index}`}
          x={vertex.x + vertex.width / 2}
          y={vertex.y + vertex.height / 2 + (index - (lines.length - 1) / 2) * (vertex.fontSize * 1.25) + vertex.fontSize * 0.35}
          textAnchor="middle"
          fontSize={vertex.fontSize}
          fill={ink}
        >{line}</text>)}
      </g>;
    })}
  </svg>;
}

/**
 * A diagram object rendered as a diagram. Draw.io scenes are drawn from their
 * own geometry — no editor embed, no network — and Mermaid goes through the
 * shared renderer, so both notations land on the board as pictures.
 */
function DiagramBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const diagram = canvasDiagram(data);
  const source = diagram?.source ?? '';
  const format = diagram?.format;
  const [graph, setGraph] = useState<DrawioGraph | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => {
    if (format !== 'drawio') { setGraph(null); setUnreadable(false); return; }
    let cancelled = false;
    void resolveDrawioXml(source).then((xml) => {
      if (cancelled) return;
      const parsed = xml ? parseDrawioXml(xml) : null;
      setGraph(parsed);
      setUnreadable(!parsed);
    });
    return () => { cancelled = true; };
  }, [format, source]);
  if (!diagram) return <AuthoredContent data={data} fallback={t('diagramFallback')} />;
  return <div className={styles.diagramBody}>
    <div className={styles.documentMeta}>
      <span>{diagram.format === 'drawio' ? t('diagramDrawio') : t('diagramMermaid')}</span>
      {graph && <span>{t('diagramShapes', { count: graph.vertices.length, connections: graph.edges.length })}</span>}
    </div>
    <div className={`${styles.diagramSurface} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
      {diagram.format === 'mermaid'
        ? <MermaidDiagram code={diagram.source} />
        : graph
          ? <DrawioCanvas graph={graph} title={data.title} />
          : <p className={styles.filePreviewEmpty}>{unreadable ? t('diagramUnreadable') : t('diagramLoading')}</p>}
    </div>
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
/**
 * The card a dropped file gets BEFORE it has been read.
 *
 * Reading a document is synchronous CPU that can hold the main thread for
 * seconds, so the artifact cannot appear at the moment of the drop — but the
 * CARD can, and it says which file it is standing in for. Rendered by
 * {@link FileBody} because every import begins life as a `file` object and
 * becomes its real kind in place, so the stub and the thing it turns into are
 * one card that fills in rather than two that swap.
 */
function ImportPendingBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const size = Number(data.fileSize);
  return <div className={styles.importPending} role="status" aria-live="polite">
    <span className={styles.importSpinner} aria-hidden />
    <div>
      <b>{t('importReading')}</b>
      <small>{textValue(data.fileName, data.title)}{Number.isFinite(size) && size > 0 ? ` · ${formatFileSize(size)}` : ''}</small>
    </div>
    {/* Three lines of the page that is coming, so the wait reads as a document
        arriving rather than as a card that failed to render. */}
    <div className={styles.importSkeleton} aria-hidden><i /><i /><i /></div>
  </div>;
}

function FileBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const name = textValue(data.fileName, data.title);
  const mimeType = textValue(data.mimeType, t('fileGeneric'));
  const size = Number(data.fileSize);
  if (data.importPending === true) return <ImportPendingBody data={data} />;
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

function CanvasToolBody({ id, data, onEditData }: { id: string; data: CreationNodeData; onEditData?: (nodeId: string, patch: Partial<CreationNodeData>) => void }) {
  const toolId = typeof data.toolId === 'string' ? data.toolId : '';
  const initialInput = asRecord(data.toolInput, {}) as Record<string, number>;
  const initialResult = data.toolResult && typeof data.toolResult === 'object' ? data.toolResult as ToolResult : null;
  if (!toolId) return null;

  return <ToolRunnerClient
    toolId={toolId}
    embedded
    initialInput={initialInput}
    initialResult={initialResult}
    onInputChange={(input) => onEditData?.(id, { toolInput: input, toolResult: null })}
    onRunComplete={(input, result) => onEditData?.(id, {
      toolInput: input,
      toolResult: result,
      result,
      status: result.scoreLabel || result.headline,
      qualityScore: result.score,
      qualityLabel: result.scoreLabel,
      qualityHeadline: result.headline,
      summary: result.summary,
      recommendations: result.recommendations,
      results: result.metrics.map((metric) => ({ title: metric.label, result: metric.value, detail: metric.hint })),
      gapCount: result.recommendations.length,
    })}
  />;
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

/**
 * The pitch cards.
 *
 * Every one of them answers the only question that matters before the room:
 * "am I ready, and what is the next thing that would cost me the win". The
 * verdict leads — runtime against the limit, weighted readiness, rehearsal
 * coverage, whether the entry can actually be submitted — and the detail follows
 * it. Nothing here decides a rule; `pitchCompetition.ts` does, and these read it.
 */
function PitchLabel({ item }: { item: PitchLabelled }) {
  const t = useTranslations('creationCanvas.pitch');
  return <>{item.labelKey && t.has(item.labelKey) ? t(item.labelKey) : item.label}</>;
}

function PitchBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.pitch');
  const competition = pitchCompetitionFor(data);
  const beats = pitchBeats(data);
  const budget = pitchRuntimeSeconds(beats);
  const spoken = pitchSpokenSeconds(beats);
  const written = beats.filter((beat) => beat.written).length;
  return <div className={styles.pitchBody}>
    <div className={styles.pitchClock} data-tone={pitchTimingTone(spoken || budget, competition.pitchSeconds)}>
      <div><small>{t('runtime')}</small><strong>{formatPitchDuration(spoken || budget)}</strong><span>{t('ofLimit', { limit: formatPitchDuration(competition.pitchSeconds) })}</span></div>
      <div><small>{t('budget')}</small><b>{formatPitchDuration(budget)}</b><span>{t('beatsWritten', { written, total: beats.length })}</span></div>
      <div><small>{t('judgeQa')}</small><b>{formatPitchDuration(competition.qaSeconds)}</b><span>{competition.name}</span></div>
    </div>
    <ol className={styles.pitchBeats}>
      {beats.map((beat) => <li key={beat.id} data-written={beat.written ? 'true' : 'false'}>
        <i style={{ '--pitch-beat-share': `${competition.pitchSeconds ? Math.round((beat.seconds / competition.pitchSeconds) * 100) : 0}%` } as CSSProperties} />
        <b><PitchLabel item={beat} /></b>
        <small>{formatPitchDuration(beat.seconds)}</small>
        <p>{beat.script || beat.prompt || t('beatEmpty')}</p>
      </li>)}
    </ol>
  </div>;
}

function PitchScoreRow({ score }: { score: number }) {
  return <span className={styles.pitchScore} aria-hidden>
    {Array.from({ length: PITCH_MAX_SCORE }, (_, index) => <i key={index} data-filled={index < score ? 'true' : 'false'} />)}
  </span>;
}

function PitchScorecardBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.pitch');
  const competition = pitchCompetitionFor(data);
  const criteria = pitchCriteria(data);
  const readiness = pitchReadiness(criteria);
  const weakest = pitchWeakestCriteria(criteria);
  return <div className={styles.pitchBody}>
    <div className={styles.pitchReadiness} data-tone={pitchReadinessTone(readiness)} style={{ '--pitch-readiness': readiness } as CSSProperties}>
      <div className={styles.pitchGauge}><strong>{readiness}%</strong><small>{t('ready')}</small></div>
      <div><small>{t('scoredAgainst')}</small><b>{competition.name}</b><p>{t('criteriaCount', { count: criteria.length })}</p></div>
      <span><b>{criteria.filter((criterion) => criterion.score > 0).length}/{criteria.length}</b><small>{t('scored')}</small></span>
    </div>
    <div className={styles.pitchCriteria}>
      {criteria.map((criterion) => <div key={criterion.id}>
        <b><PitchLabel item={criterion} /></b>
        <PitchScoreRow score={criterion.score} />
        <p>{criterion.evidence || criterion.prompt}</p>
        {criterion.gap && <small>{t('gapPrefix', { gap: criterion.gap })}</small>}
      </div>)}
    </div>
    {weakest.length > 0 && <p className={styles.pitchNextUp}>
      <b>{t('marksLostHere')}</b>
      {weakest.map((criterion) => <span key={criterion.id}><PitchLabel item={criterion} /></span>)}
    </p>}
  </div>;
}

function PitchQaBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.pitch');
  const competition = pitchCompetitionFor(data);
  const items = pitchQaItems(data);
  const coverage = pitchQaCoverage(items);
  return <div className={styles.pitchBody}>
    <div className={styles.pitchReadiness} data-tone={pitchReadinessTone(coverage.percent)} style={{ '--pitch-readiness': coverage.percent } as CSSProperties}>
      <div className={styles.pitchGauge}><strong>{coverage.percent}%</strong><small>{t('rehearsed')}</small></div>
      <div><small>{t('qaWindow')}</small><b>{formatPitchDuration(competition.qaSeconds)}</b><p>{t('answeredCount', { answered: coverage.answered, total: coverage.total })}</p></div>
    </div>
    <div className={styles.pitchQaList}>
      {items.map((item) => <div key={item.id} data-answered={item.answered ? 'true' : 'false'}>
        <b>{item.question}</b>
        <PitchScoreRow score={item.strength} />
        <p>{item.answer || t('answerEmpty')}</p>
      </div>)}
    </div>
  </div>;
}

function PitchApplicationBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.pitch');
  const competition = pitchCompetitionFor(data);
  const answers = pitchApplicationAnswers(data);
  const eligibility = pitchEligibility(data);
  const readiness = pitchApplicationReadiness(answers, eligibility);
  const tone = readiness.submittable ? 'good' : readiness.unmetRules.length || readiness.overLimit.length ? 'risk' : 'watch';
  return <div className={styles.pitchBody}>
    <div className={styles.pitchReadiness} data-tone={tone} style={{ '--pitch-readiness': readiness.percent } as CSSProperties}>
      <div className={styles.pitchGauge}><strong>{readiness.percent}%</strong><small>{t('complete')}</small></div>
      <div><small>{t('entryFor')}</small><b>{competition.name}</b><p>{readiness.submittable ? t('readyToSubmit') : t('blockedCount', { count: readiness.unmetRules.length + readiness.overLimit.length })}</p></div>
    </div>
    {eligibility.length > 0 && <div className={styles.pitchEligibility}>
      {eligibility.map((rule) => <span key={rule.id} data-met={rule.met ? 'true' : 'false'}>{rule.met ? '✓' : '○'} <PitchLabel item={rule} /></span>)}
    </div>}
    <div className={styles.pitchAnswers}>
      {answers.map((answer) => <div key={answer.id} data-over={answer.over ? 'true' : 'false'} data-answered={answer.answered ? 'true' : 'false'}>
        <b><PitchLabel item={answer} /></b>
        {answer.maxChars > 0 && <small>{t('charCount', { chars: answer.chars, max: answer.maxChars })}</small>}
        <p>{answer.answer || t('answerEmpty')}</p>
      </div>)}
    </div>
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
 * The Brain Object — the conversation itself, its mark, or an anchor pointing at it.
 *
 * There is exactly ONE Brain transcript on the canvas at a time. Where it renders is
 * the user's placement choice: docked to an edge, or right here in the graph. When it
 * is inline the Object IS the chat, because a small chat card hovering over a board
 * that already carries a Brain Object was two live views of one conversation — the
 * "which one am I actually talking to?" confusion this canvas exists to avoid.
 *
 * When it is docked the Object collapses to Brain's MARK. A full card repeating the
 * latest exchange beside a full-height dock showing that same exchange is the same
 * confusion in a quieter form: two frames of reference for one Brain. Docked, the
 * board keeps Brain's place in the graph (its edges are what scope a prompt), shows
 * that it is working, and sends every reading of the conversation to the dock.
 *
 * The anchor — the latest exchange — survives for the cases where there is no visible
 * surface to defer to: presenting, and a Brain the user has closed. There the Object
 * is the only reading of the conversation left, so it keeps showing one.
 *
 * Reading the placement from context rather than a prop is deliberate: `nodeTypes` has
 * to keep a stable identity or React Flow remounts the whole board, and consuming the
 * context HERE (not in CreationNode) means a streaming reply re-renders this node
 * alone rather than every Object on the canvas.
 */
function BrainObjectBody({ nodeId, data }: { nodeId: string; data: CreationNodeData }) {
  const t = useTranslations('creationCanvas');
  const surface = useBrainSurface();

  // `open` already excludes presenting, so the mark only ever stands in for a dock
  // the user can actually see and get back to.
  if (surface && surface.open && surface.mode === 'docked') {
    return <BrainMarkerBody data={data} onOpen={() => surface.onOpen(nodeId)} />;
  }

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
 * A game object: the game itself, playable on the board.
 *
 * Every other creative kind shows a picture of its artifact because that is the
 * most you can do with a DXF or an MP3 on a canvas. A game is a program, and the
 * only honest preview of a program is running it — so this body IS the game,
 * and "does the thing the model just wrote actually work" is answered by playing
 * it rather than by opening a tab and coming back.
 *
 * ── THE SANDBOX IS LOad-BEARING ─────────────────────────────────────────────
 * The document is model-authored code from a free-text brief. It runs with
 * `allow-scripts` and DELIBERATELY WITHOUT `allow-same-origin`: that combination
 * gives the frame an opaque origin, so the game cannot reach this page's cookies,
 * `localStorage`, session token or DOM. Adding `allow-same-origin` alongside
 * `allow-scripts` would let the frame remove its own sandbox attribute and is
 * equivalent to no sandbox at all.
 *
 * For the same reason the document goes in through `srcDoc` rather than a blob
 * URL — a blob inherits the creating page's origin, which would quietly undo the
 * isolation. `srcDoc` with no `allow-same-origin` cannot.
 *
 * The frame starts inert. It is mounted only once the player asks for it, so a
 * board with a dozen games is not a dozen animation loops competing with the
 * canvas for frames; `nodrag`/`nowheel` keep the pointer inside the game instead
 * of panning the board underneath it.
 */
function GameBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const [playing, setPlaying] = useState(false);
  const document = useMemo(() => gameDocumentFrom(data), [data]);
  const poster = creativePreviewImageUrl(data);
  const controls = useMemo(() => (document ? controlLabels(readGameControls(document)) : []), [document]);

  // Regenerating replaces the document; the running frame must be torn down or
  // the board keeps playing the previous game under the new title.
  useEffect(() => setPlaying(false), [document]);

  if (!document) {
    return <div className={styles.creativeStudioBody}>
      {poster
        ? <img src={poster} alt={t('previewAlt', { title: data.title })} />
        : <div className={styles.creativeStudioPreview} aria-hidden="true"><span>{creationObjectDefinition(data.kind).icon}</span><i /><i /><i /></div>}
      <AuthoredContent data={data} fallback={t('gameNotGenerated')} />
      <div className={styles.pills}><span>{t('gameGenerateFirst')}</span></div>
    </div>;
  }

  return <div className={`${styles.creativeStudioBody} ${styles.gameBody ?? ''}`}>
    <div className={styles.gameStage}>
      {playing
        ? <iframe
          className={styles.gameFrame}
          title={t('gamePlayingAlt', { title: String(data.title ?? '') })}
          srcDoc={document}
          // No `allow-same-origin`. See the note above — with `allow-scripts`
          // it would let the frame escape the sandbox entirely.
          sandbox={GAME_FRAME_SANDBOX}
          loading="lazy"
        />
        : <button
          type="button"
          className={styles.gamePoster}
          onClick={(event) => { event.stopPropagation(); setPlaying(true); }}
          style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
        >
          <span className={styles.gamePlayBadge} aria-hidden="true">▶</span>
          <span className={styles.srOnly}>{t('gamePlay')}</span>
        </button>}
    </div>
    <div className={styles.pills}>
      {playing
        ? <button type="button" onClick={(event) => { event.stopPropagation(); setPlaying(false); }}>{t('gameStop')}</button>
        : <span>{t('gameReady')}</span>}
      {controls.map((control) => <span key={control}>{t(control === 'keys' ? 'gameControlKeys' : 'gameControlTouch')}</span>)}
    </div>
  </div>;
}

/**
 * The run, read off the Object's own data. The mark and the anchor narrate the same
 * turn from the same three fields, so they derive it once and can never disagree.
 */
function useBrainNodeActivity(data: CreationNodeData) {
  return useBrainActivity(
    data.brainRunning === true,
    Array.isArray(data.trace) ? data.trace as BrainTraceEvent[] : [],
    typeof data.brainRunStartedAt === 'number' ? data.brainRunStartedAt : null,
  );
}

/**
 * The mark: Brain reduced to a single object on the board while the conversation
 * lives in the edge dock.
 *
 * It carries the SAME `✦` as the dock header, so the mark on the board and the panel
 * it opens are visibly one Brain rather than two things that both say "Brain". It
 * animates from the same activity state every other surface narrates from, so a
 * working Brain is legible on the board without repeating the dock's words next to
 * it — the phase is the accessible name and the tooltip, not a second strip of copy.
 *
 * The mark is deliberately NOT marked `nodrag`: collapsed, it is the whole Object, so
 * refusing a drag on it would mean the Brain Object could no longer be moved at all.
 */
function BrainMarkerBody({ data, onOpen }: { data: CreationNodeData; onOpen: () => void }) {
  const t = useTranslations('creationCanvas.node');
  const activity = useBrainNodeActivity(data);
  const phase = brainActivityLine(activity.live);
  const label = phase ? t('brainMarkerBusy', { phase }) : t('openBrainChat');

  return <button
    type="button"
    className={styles.brainMarker}
    data-state={activity.live ? 'running' : 'idle'}
    aria-label={label}
    title={label}
    onClick={onOpen}
  >
    <span className={styles.brainMarkerPulse} aria-hidden />
    <span className={styles.brainMarkerMark} aria-hidden>✦</span>
  </button>;
}

/**
 * The anchor: Brain's place in the graph (its connections are what scope a prompt)
 * plus the latest exchange — the reading shown when the board is the ONLY surface
 * left. That is presenting, where nothing can reveal Brain, and an inline Brain the
 * user closed, where the Object is where the conversation would come back.
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
  const activity = useBrainNodeActivity(data);
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
  /** Direct edits made on the card itself — a spreadsheet cell, a renamed
   * column, a rewritten paragraph — written back through the same path the
   * inspector uses. Absent when the board is read-only or lock-blocked, so an
   * editing control is never rendered where it would do nothing. */
  onEditData?: (nodeId: string, patch: Partial<CreationNodeData>) => void;
  /** Take the object away as a file, from the card that holds it. */
  onExport?: (nodeId: string, action: CanvasExportAction) => void;
};

/** Object kinds whose body IS a document. Registry kinds, so a new document-like
 * object is a one-line addition rather than three separate lists. */
const DOCUMENT_BODY_KINDS = new Set(['document', 'prd', 'knowledge']);

/**
 * The size the USER gave this Object — a resize drag, or an authored width and
 * height — and nothing else.
 *
 * React Flow hands a custom node its MEASURED width and height. Writing those
 * straight back onto the card is a latch: the card can then only ever be the
 * size it happened to be measured at, because that measurement is what pins it.
 * The Brain Object made this visible — it is a 74px mark while the conversation
 * is docked and a 390px chat inline, so the first placement it rendered in froze
 * the other one into a sliver, and every edge into it stayed anchored to the box
 * that sliver reported. Any card whose content grows after it first rendered had
 * the quieter version of the same bug: it kept the old height and scrolled.
 *
 * An authored size is different — React Flow already puts it on the node wrapper,
 * so passing it down here just lets the card fill the box the user dragged.
 */
function useAuthoredNodeSize(id: string): { width?: number; height?: number } {
  // Packed into a string so the store subscription compares by value: returning a
  // fresh object from the selector would re-render this node on every store tick.
  const authored = useStore((state) => {
    const node = state.nodeLookup.get(id);
    if (!node) return '';
    const width = node.width ?? (typeof node.style?.width === 'number' ? node.style.width : undefined);
    const height = node.height ?? (typeof node.style?.height === 'number' ? node.style.height : undefined);
    return `${width ?? ''}:${height ?? ''}`;
  });
  return useMemo(() => {
    const [width, height] = authored.split(':');
    return {
      ...(width ? { width: Number(width) } : {}),
      ...(height ? { height: Number(height) } : {}),
    };
  }, [authored]);
}

export function CreationNode({ id, data, selected, canRun = true, onRun, onOpenDetails, onEditData, onExport }: CreationNodeProps) {
  const t = useTranslations('creationCanvas.node');
  const isWide = ['workflow', 'website', 'prototype', 'dashboard', 'chart', 'map', 'report', 'evaluation', 'diagnostics', 'roadmap', 'slides', 'document', 'diagram', 'prd', 'knowledge', 'code', 'table', 'spreadsheet', 'featureSummary', 'mockupSet', 'evermind', 'projectComparison', 'frame', 'pitch', 'pitchScorecard', 'pitchQa', 'pitchApplication', 'course',
    // A game is played in its own body, so it needs the width a game needs.
    'game'].includes(data.kind) || WEB_PAGE_KINDS.has(data.kind);
  // Every kind with a body of its own. A kind missing from here renders its own
  // body AND the generic fallback underneath it — which is what all nine
  // creative kinds did: a studio tile followed by a second, redundant block
  // repeating the same authored text. They are folded in from the one set that
  // already lists them, so a new creative kind cannot reintroduce the same bug.
  const specialized = new Set(['workflow','website','build','prototype','dashboard','chart','map','report','evaluation','diagnostics','agent','staff','chat','dataset','table','spreadsheet','kpi','voice','note','project','roadmap','task','mockup','mockupSet','featureSummary','evermind','projectComparison','standup','drawing','frame','release','file','document','prd','knowledge','slides','diagram','pitch','pitchScorecard','pitchQa','pitchApplication','course','game', ...CREATIVE_STUDIO_KINDS, ...WEB_PAGE_KINDS]);
  const authoredSize = useAuthoredNodeSize(id);
  const frameStyle = data.kind === 'frame' ? { background: String(data.frameColor || '#f8f6ff'), borderColor: String(data.frameBorder || '#9d8bea') } : undefined;
  const cardStyle = { ...frameStyle, ...authoredSize };
  return (
    <article style={cardStyle} data-viewport={data.viewport} className={`${styles.node} ${styles[`node_${data.kind}`]} ${selected ? styles.selected : ''} ${isWide ? styles.wideNode : ''}`}>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={130} lineClassName={styles.resizeLine} handleClassName={styles.resizeHandle} />
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <header className={styles.nodeHeader}>
        {typeof data.pipelineStep === 'number' && <span className={styles.pipelineStepBadge}>{data.pipelineStep}</span>}
        <span className={styles.nodeIcon}>{typeof data.toolIcon === 'string' ? data.toolIcon : creationObjectDefinition(data.kind).icon}</span>
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
        {data.kind === 'build' && <BuildBody data={data} />}
        {WEB_PAGE_KINDS.has(data.kind) && <CanvasWebPage
          data={data}
          {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})}
        />}
        {(data.kind === 'dashboard' || data.kind === 'chart' || data.kind === 'report') && <DashboardBody data={data} />}
        {data.kind === 'map' && <MapBody data={data} />}
        {data.kind === 'evaluation' && <EvaluationBody data={data} onOpen={() => onOpenDetails?.(id, 'evaluation')} />}
        {data.kind === 'diagnostics' && (typeof data.toolId === 'string'
          ? <CanvasToolBody id={id} data={data} onEditData={onEditData} />
          : <DiagnosticsBody data={data} />)}
        {data.kind === 'agent' && <AgentBody data={data} onOpen={(focus) => onOpenDetails?.(id, focus)} />}
        {data.kind === 'staff' && <><div className={styles.personRow}><span className={styles.avatar} style={{ background: data.accent }}>{data.title.slice(0, 1)}</span><b>{data.role}</b><span className={styles.presence} /></div><small>{t('currentFocus')}</small><p>{data.focus}</p></>}
        {data.kind === 'chat' && <BrainObjectBody nodeId={id} data={data} />}
        {(data.kind === 'dataset' || data.kind === 'table' || data.kind === 'spreadsheet') && <DataGridBody data={data} {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})} />}
        {DOCUMENT_BODY_KINDS.has(data.kind) && <DocumentBody
          data={data}
          {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})}
        />}
        {data.kind === 'slides' && <SlidesBody data={data} />}
        {data.kind === 'diagram' && <DiagramBody data={data} />}
        {data.kind === 'file' && <FileBody data={data} />}
        {data.kind === 'kpi' && <KpiBody data={data} />}
        {data.kind === 'voice' && <><div className={styles.waveform}>▂▅▃▆▂▇▅▃▆▂▅▇▃▆▂▅</div><AuthoredContent data={data} fallback={t('voiceFallback')} /></>}
        {CREATIVE_STUDIO_KINDS.has(data.kind) && <CreativeStudioBody data={data} />}
        {data.kind === 'game' && <GameBody data={data} />}
        {data.kind === 'note' && <AuthoredContent data={data} fallback={t('noteFallback')} />}
        {data.kind === 'project' && <ProjectBody data={data} />}
        {data.kind === 'roadmap' && <div className={styles.roadmap}>{(Array.isArray(data.items) && data.items.length ? data.items.slice(0, 12) : [{ title: 'Validate narrative', phase: 'Now' }, { title: 'Executive review', phase: 'Next' }, { title: 'Measure adoption', phase: 'Later' }]).map((raw, index) => { const item = asRecord(raw, { title: raw, phase: index < 2 ? 'Now' : 'Next' }); return <div key={`${String(item.title)}-${index}`}><b>{String(item.phase || item.status || t('phaseIndex', { index: index + 1 }))}</b><span>{String(item.title || item.name || t('itemIndex', { index: index + 1 }))}</span>{item.description ? <span>{String(item.description)}</span> : null}</div>; })}</div>}
        {data.kind === 'inbox' && <InboxBody data={data} />}
        {data.kind === 'email' && <EmailBody data={data} />}
        {data.kind === 'emailCampaign' && <EmailCampaignBody data={data} />}
        {data.kind === 'emailTemplate' && <EmailTemplateBody data={data} />}
        {data.kind === 'task' && <TaskBody data={data} />}
        {data.kind === 'mockup' && <MockupBody data={data} />}
        {data.kind === 'mockupSet' && <><div className={styles.mockupGrid}><i /><i /><i /></div><p>{Array.isArray(data.items) && data.items.length ? t('linkedConcepts', { count: data.items.length }) : t('mockupSetFallback')}</p><div className={styles.pills}><span>{t('expandable')}</span><span>{t('citationsRetained')}</span></div></>}
        {data.kind === 'featureSummary' && <div className={styles.featureGrid}>{(Array.isArray(data.items) && data.items.length ? data.items.map((item) => typeof item === 'string' ? item : String((item as Record<string, unknown>)?.title || (item as Record<string, unknown>)?.name || t('feature'))).slice(0, 20) : ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration']).map((feature, index) => <span key={`${feature}-${index}`}><b>{index + 1}</b>{feature}</span>)}</div>}
        {data.kind === 'evermind' && <EvermindBody data={data} />}
        {data.kind === 'course' && <CourseBody data={data} {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})} />}
        {data.kind === 'projectComparison' && <ProjectComparisonBody data={data} />}
        {data.kind === 'pitch' && <PitchBody data={data} />}
        {data.kind === 'pitchScorecard' && <PitchScorecardBody data={data} />}
        {data.kind === 'pitchQa' && <PitchQaBody data={data} />}
        {data.kind === 'pitchApplication' && <PitchApplicationBody data={data} />}
        {data.kind === 'standup' && <StandupBody data={data} />}
        {data.kind === 'drawing' && <DrawingBody data={data} />}
        {data.kind === 'frame' && <div className={styles.frameBody}><strong>{String(data.framePurpose || t('arrangeObjects'))}</strong><p>{data.subtitle || t('frameFallback')}</p></div>}
        {data.kind === 'release' && <ReleaseBody data={data} onOpen={() => onOpenDetails?.(id, 'delivery')} />}
        {!specialized.has(data.kind) && <><AuthoredContent data={data} fallback={t('objectReady', { label: creationObjectDefinition(data.kind).label })} /><div className={styles.pills}><span>{data.status || t('canvasObject')}</span><span>{t('liveSessionContext')}</span></div></>}
        {/* Every artifact leaves the board from the same place, in its own
            native formats. The row renders nothing for an object that is not a
            file — an agent, a frame, a timer — so it is safe to place once here
            rather than threaded into each body that happens to produce one. */}
        {onExport && <CanvasExportActions data={data} onExport={(action) => onExport(id, action)} />}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </article>
  );
}
