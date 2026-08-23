'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Handle, NodeResizer, Position, useStore, type NodeProps } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import ReactMarkdown from 'react-markdown';
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS } from '@/lib/markdownPipeline';
import { Avatar, evermindLearnedStatus, evermindNextAction } from '@seanhogg/builderforce-brain-ui';
import type { CreationNodeData, CreationObjectKind } from './types';
import {
  EMPTY_SPEC_BOARD, makeSpecDeriveBoard, specKindReadsBoard, type SpecDeriveBoard,
} from '@/lib/specObjects';
import { AUTHORED_FRAME_BORDER, AUTHORED_FRAME_FILL, STICKY_COLORS } from '@/domains/canvas/domain/authoredColors';
import { frameMemberIds, type FrameBox } from '@/domains/canvas/domain/canvasFrame';
import { FlowStepBody, FlowStepOutletRail, flowStepHasNamedOutlets } from './FlowStepBody';
import { FrameBody } from './FrameBody';
import { CanvasClockBody } from './CanvasClockBody';
import { CanvasTransclusionBody } from './CanvasTransclusionBody';
import { CanvasComponentBody } from './CanvasComponentBody';
import styles from './CreationCanvas.module.css';
import { creationObjectDefinition, emptyShellProblem } from './creationObjectRegistry';
import {
  canvasNodeMessages,
  canvasNodeSchedule,
  canvasNodeSettingsPanel,
  canvasNodeWorstSeverity,
  type CanvasNodePanelId,
} from '@/lib/canvasNodeAffordances';
import { canvasNodeDensity, canvasNodeDensityActionKey, nextCanvasNodeDensity, type CanvasNodeDensity } from '@/lib/canvasNodeDensity';
import { BrainActivityBar, brainActivityLine, useBrainActivity } from './BrainActivityView';
import { BrainSurfaceActions, BrainSurfaceBody } from './BrainDock';
import { useBrainSurface } from './brainSurfaceContext';
import { Icon } from '@/components/ui/Icon';
import { networkGlyph } from '@/lib/networkGlyph';
import { highlightToneFor, profileTabular, tabularFromObject, workbookSheets, type TabularCell, type TabularHighlightRule } from '@/lib/canvasTabularData';
import { recalculateSheet } from '@/lib/canvasSheet';
import { columnLetters } from '@/lib/canvasFormula';
import { maskCell, maskPlan, normalizeClassifications } from '@/lib/canvasDataGovernance';
import {
  MAP_ZOOM_RANGE, boundsCenter, geoBoundsFor, mapViewportBounds, outlinePaths, panCenter, projectMap,
  sanitizeGeoBounds, sanitizeMapCenter, sanitizeMapPoints, sanitizeMapZoom,
} from '@/lib/canvasGeo';
import { creativePreviewImageUrl } from '@/lib/creationDeliverables';
// The consent state a send is gated on, read off the bound `audience` card rather than
// copied onto the campaign — see `canvasMarketing.ts`.
import { campaignSendReadiness } from '@/lib/canvasMarketing';
import { GAME_FRAME_SANDBOX, gameDocumentFrom, gameRuntimeFor } from '@/lib/gameTargets';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { CanvasObjectSurfaceButton } from './CanvasObjectSurfaceButton';
import { controlLabels, readGameControls } from '@/lib/gamePoster';
import { canvasBuildBinding } from '@/lib/canvasBuild';
import { canvasWebPageUrl, WEB_PAGE_KINDS } from '@/lib/canvasWebPage';
import { canvasViewport } from '@builderforce/creation-canvas-contract';
import { dashboardWidgetsPatch, readDashboardWidgets } from '@/lib/canvasDashboard';
import { PIPELINE_MAX_CARDS_PER_CELL, cardProbabilityPercent, cardsAt, pipelineTotals, readPipelineModel, stageTotals } from '@/lib/canvasSalesPipeline';
import {
  DataContractBody,
  DataQualityBody,
  DataSourceBody,
  ErdBody,
  LineageBody,
  MetricDefinitionBody,
} from './DataArchitectureViews';
import { DefectBody, PageAuditFindings, TestCaseBody, TestPlanBody, TestRunBody } from './QaObjectViews';
import { CanvasWebPage } from './CanvasWebPage';
import { DashboardWidgetGrid } from './DashboardWidgetView';
import { DashboardStructuredEditor } from './DashboardStructuredEditor';
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
import { diagramLabelLines, diagramShapePolygon, type DiagramGraph } from '@/lib/diagramGraph';
import { diagramNotation, readDiagramSource } from '@/lib/diagramNotations';
import { MermaidDiagram } from '@/components/MermaidDiagram';
import { COURSE_EXPORT_STANDARDS, courseAssessmentQuestions, courseFromNode, courseProgress, courseScore } from '@/lib/courseLms';
import { practiceAttempts, practiceMode, practiceQuestions, practiceProgress, recordPracticeAttempt } from '@/lib/canvasPractice';
import { canvasStrokes, HIGHLIGHTER_OPACITY, HIGHLIGHTER_WIDTH_FACTOR, strokePathD, strokeRect } from '@/lib/canvasDrawing';
import { PracticeRunner } from './PracticeRunner';
import { ReadAloud } from '@/components/ReadAloud';
import { canvasProseText } from '@/lib/canvasProse';
import ToolRunner from '@/components/tools/ToolRunner';
import type { ToolResult } from '@/lib/tools';
import { canvasTourDesignFromNode } from '@/lib/onboarding/canvasTourDesign';
import { WebsiteFrame } from './WebsiteCanvas';
import { CanvasVideoEditor } from './CanvasVideoEditor';
import { CanvasResumeEditor } from './CanvasResumeEditor';
import { CanvasLegalDocumentUpload } from './CanvasLegalDocumentUpload';
import { SpecObjectBody } from './SpecObjectBody';
import { CalendarObjectBody } from './CalendarObjectBody';
// One provenance line and one gate badge, rendered by every body that shows a derived
// number — see the header there for why a truncated number is worse than a blank one.
import { BasisNotice, EvaluationGateBadge } from './DerivedProvenance';
import { allSpecObjectSpecs } from '@/lib/specObjects';
// Importing a vocabulary registers it with the spec primitive, which is what makes its
// kinds resolvable here — and in the palette, the AI contract and the empty-shell rule —
// without a second list of them anywhere.
import '@/lib/academicObjects';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import { useFormat } from "@/i18n/useFormat";

/** The historical name for `CanvasObject`, which the canvas domain now owns.
 *  Aliased rather than re-declared: two structurally identical declarations of
 *  one type is the duplication that lets them drift apart later. Imported AND
 *  exported because this file uses the name itself — `export … from` re-exports
 *  without binding anything in local scope. */
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import { resourceIdOfType } from '@/domains/canvas/domain/resourceRef';
import { CeremonyOutcome } from '@/components/ceremony/CeremonyOutcome';
export type CreationFlowNode = CanvasObject;

/**
 * Spec kinds whose body renders a table or a grid, and therefore needs the wide card.
 *
 * Derived from every registered vocabulary rather than from the founder set alone, so a
 * kind that gains a `rows` or `matrix` field gains the width in the same edit. `matrix`
 * is included for the reason it exists: a rubric's levels and a gradebook's assessments
 * are COLUMNS, and those are the widest bodies on the board.
 */
const SPEC_WIDE_KINDS: ReadonlySet<string> = new Set(
  allSpecObjectSpecs()
    .filter((spec) => spec.fields.some((field) => field.render === 'rows' || field.render === 'matrix'))
    .map((spec) => spec.kind),
);

/** Every spec-declared kind — one entry in the `specialized` set below, so none of them
 *  renders its own body AND the generic fallback underneath it. */
const SPEC_KINDS: readonly string[] = allSpecObjectSpecs().map((spec) => spec.kind);

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

/**
 * A sticky note: its text, on its pigment, and nothing else.
 *
 * The text lives in `title` rather than `content` because a sticky HAS no second
 * field — see the kind's note in the contract. The header is hidden by
 * `.node_sticky` in CSS rather than branched around here, so the card keeps one
 * structure and the sticky just declines to draw the chrome.
 *
 * `nodrag`/`nowheel` are what let a person select and scroll text inside a node
 * React Flow would otherwise pan the board with.
 */
function StickyBody({ data, onEdit }: { data: CreationNodeData; onEdit?: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.sticky');
  const text = typeof data.title === 'string' ? data.title : '';
  if (!onEdit) return <p className={styles.stickyText}>{text || t('empty')}</p>;
  return <textarea
    className={`${styles.stickyInput} nodrag nowheel`}
    value={text}
    aria-label={t('label')}
    placeholder={t('placeholder')}
    onChange={(event) => onEdit({ title: event.target.value })}
  />;
}

function CourseBody({ data, onEdit }: { data: CreationNodeData; onEdit?: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.course');
  const course = courseFromNode(data);
  const attempts = practiceAttempts(data.attempts);
  const [activeId, setActiveId] = useState(course.modules[0]?.id ?? '');
  const active = course.modules.find((module) => module.id === activeId) ?? course.modules[0];
  const progress = courseProgress(course);
  const score = courseScore(course, attempts);
  const completed = new Set(course.completedLessonIds);
  const toggleLesson = (lessonId: string) => {
    if (!onEdit) return;
    const next = new Set(course.completedLessonIds);
    if (next.has(lessonId)) next.delete(lessonId); else next.add(lessonId);
    onEdit({ course: { ...course, completedLessonIds: [...next] }, status: next.size === progress.total ? t('completed') : t('inProgress') });
  };
  /**
   * A course with no modules is a course waiting for its SUBJECT — the state
   * every new course object now starts in. It used to be impossible to reach,
   * because an empty course silently became the shipped LLM curriculum; the
   * price of that was every learner on every other subject starting by deleting
   * six modules about tokenizers.
   */
  if (!active) return <div className={`${styles.courseEmpty} nodrag nowheel`} onClick={(event) => event.stopPropagation()}>
    <strong>{t('subjectTitle')}</strong>
    <input
      value={course.subject}
      disabled={!onEdit}
      placeholder={t('subjectPlaceholder')}
      aria-label={t('subjectTitle')}
      onChange={(event) => onEdit?.({ course: { ...course, subject: event.target.value }, status: event.target.value.trim() ? t('subjectReady') : t('subjectPending') })}
    />
    <p>{t('subjectHint')}</p>
  </div>;
  return <div className={`${styles.courseShell} nodrag nowheel`}>
    <div className={styles.courseSummary}>
      <div><b>{t('progress', { percent: progress.percent })}</b><span>{t('lessonCount', { completed: progress.completed, total: progress.total })}</span></div>
      <div className={styles.courseProgress} role="progressbar" aria-label={t('progressLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><i style={{ width: `${progress.percent}%` }} /></div>
      {/* The knowledge-check score, which now survives closing the card. */}
      <small>{t('duration', { minutes: course.estimatedMinutes })} · {t('checkScore', { percent: score.percent, answered: score.answered, total: score.total })}{score.passed ? ` · ${t('passed', { score: course.passingScore })}` : ''} · {COURSE_EXPORT_STANDARDS.join(' · ')}</small>
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
        {/* The knowledge check is a one-question practice set, run by the SAME
            component the Practice object uses — so the answer is graded once,
            recorded once, and is still there tomorrow. It used to live in
            `useState`, which is why a course could never tell you your score. */}
        <div className={styles.courseQuiz}>
          <strong>{t('knowledgeCheck')}</strong>
          <PracticeRunner
            questions={courseAssessmentQuestions(course).filter((question) => question.id === active.id)}
            attempts={attempts}
            editable={!!onEdit}
            compact
            onRecord={(attempt) => onEdit?.({ attempts: recordPracticeAttempt(attempts, attempt) })}
          />
        </div>
      </section>
    </div>
  </div>;
}

/**
 * The Practice object — a set of questions and the record of answering them.
 *
 * The card IS the study session (the inspector only authors), because the point
 * of practice on a canvas is that it sits next to the notes it came from and can
 * be done in the ten seconds a person actually has. Mode is a value, not a second
 * object kind: a flashcard and a multiple-choice question are the same question
 * asked two ways, and both are graded and recorded by the same model.
 */
function PracticeBody({ data, onEdit }: { data: CreationNodeData; onEdit?: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.practice');
  const questions = practiceQuestions(data.questions);
  const attempts = practiceAttempts(data.attempts);
  const mode = practiceMode(data.practiceMode);
  const progress = practiceProgress(questions, attempts);
  return <div className={styles.practiceShell}>
    {questions.length > 1 && <div className={`${styles.practiceModes} nodrag`} role="group" aria-label={t('modeLabel')}>
      <button type="button" aria-pressed={mode === 'quiz'} disabled={!onEdit} onClick={(event) => { event.stopPropagation(); onEdit?.({ practiceMode: 'quiz' }); }}>{t('modeQuiz')}</button>
      <button type="button" aria-pressed={mode === 'flashcards'} disabled={!onEdit} onClick={(event) => { event.stopPropagation(); onEdit?.({ practiceMode: 'flashcards' }); }}>{t('modeFlashcards')}</button>
    </div>}
    <PracticeRunner
      questions={questions}
      attempts={attempts}
      mode={mode}
      editable={!!onEdit}
      onRecord={(attempt) => onEdit?.({
        attempts: recordPracticeAttempt(attempts, attempt),
        status: t('statusStudied', { mastered: practiceProgress(questions, recordPracticeAttempt(attempts, attempt)).mastered, total: questions.length }),
      })}
      {...(onEdit && attempts.length ? { onReset: () => onEdit({ attempts: [], status: t('statusReset') }) } : {})}
    />
    {progress.weak > 0 && <p className={styles.practiceStudyList}>{t('studyList', { count: progress.weak })}</p>}
  </div>;
}

function GuidedTourBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.tourBuilder');
  const tour = canvasTourDesignFromNode(data);
  const [previewStep, setPreviewStep] = useState(-1);
  const active = previewStep >= 0 ? tour.steps[previewStep] : null;
  const stop = (event: MouseEvent) => event.stopPropagation();
  return <div className={`${styles.tourDesign} nodrag nowheel`} onClick={stop}>
    <div className={styles.tourPreview} data-blur={tour.blurBackground ? 'true' : 'false'}>
      <div className={styles.tourPreviewChrome} aria-hidden><i /><i /><i /></div>
      <div className={styles.tourPreviewCard}>
        <button type="button" aria-label={t('closePreview')} onClick={() => setPreviewStep(-1)}>×</button>
        {active ? <>
          <small>{t('stepOf', { current: previewStep + 1, total: tour.steps.length })}</small>
          <strong>{active.title}</strong>
          <p>{active.body}</p>
          <span>{active.targetObjectId ? t('targetConnected') : t('targetNeeded')}</span>
          <div><button type="button" disabled={previewStep === 0} onClick={() => setPreviewStep((value) => Math.max(0, value - 1))}>{t('back')}</button><button type="button" onClick={() => setPreviewStep((value) => value >= tour.steps.length - 1 ? -1 : value + 1)}>{previewStep >= tour.steps.length - 1 ? t('finish') : t('next')}</button></div>
        </> : <>
          <small>{t('offer')}</small>
          <strong>{tour.offerTitle}</strong>
          <p>{tour.offerBody}</p>
          <div><button type="button">{tour.cancelLabel}</button><button type="button" onClick={() => setPreviewStep(0)}>{tour.startLabel}</button></div>
        </>}
      </div>
    </div>
    <div className={styles.tourDesignMeta}><span>{t('stepCount', { count: tour.steps.length })}</span><span>{t('visitCount', { count: tour.minimumVisits })}</span>{tour.escapeHatch && <span>{t('escapeEnabled')}</span>}</div>
  </div>;
}

// `game` is deliberately absent: a game is the one creative kind whose artifact
// can be USED in place, so it gets a body that plays it rather than a tile that
// describes it. See GameBody.
const CREATIVE_STUDIO_KINDS = new Set(['image', 'animation', 'podcast', 'comic', 'cad', 'model3d', 'template']);

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
    {thumbnail ? <img src={thumbnail} alt={t('previewAlt', { title: data.title })} /> : <div className={styles.creativeStudioPreview} aria-hidden="true"><span><Icon source={creationObjectDefinition(data.kind).icon} size={24} /></span><i /><i /><i /></div>}
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
  const fmt = useFormat();
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
      {fetchedAt && <small>{t('inboxReadAt', { time: fmt.time(fetchedAt) })}</small>}
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
                ? fmt.dateWith(String(message.receivedAtISO), { month: 'short', day: 'numeric' })
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
  // ── THE CONSENT STATE, AT THE POINT OF SEND ─────────────────────────────────────
  // A campaign could be authored and fired from this board with no visible consent or
  // unsubscribe state at all, which is a CAN-SPAM/GDPR exposure created by the surface
  // rather than by the sender. So the card reads the bound `audience` — never a copy of
  // its numbers, which an LLM patch could write to zero — and says out loud how many may
  // lawfully be mailed and what is stopping the send.
  const neighbours = useBoardNeighbours(true);
  const readiness = campaignSendReadiness({ data }, neighbours.map((entry) => ({ data: entry })));
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
    <div className={styles.taskFacts}>
      <span><small>{t('campaignSendable')}</small><b>{readiness.sendable === undefined ? '—' : String(readiness.sendable)}</b></span>
      <span><small>{t('campaignConsent')}</small><b>{readiness.ready ? t('campaignConsentOk') : t('campaignConsentBlocked')}</b></span>
    </div>
    {textValue(data.subject) && <div className={styles.taskContext}><small>{t('campaignSubject')}</small><b>{String(data.subject)}</b></div>}
    {readiness.blockers.length > 0 && <div className={styles.taskContext}>
      <small>{t('campaignConsentBlocked')}</small>
      <p>{readiness.blockers.map((blocker) => t(`campaignBlocker.${blocker}`)).join(' · ')}</p>
    </div>}
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

/** Compact engagement numbers: 12400 reads as 12.4k on a 460px tile. */
function compactCount(value: unknown): string {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * A live social feed tile, merged across every connected account.
 *
 * Same two non-negotiables as the inbox, for the same reason — honesty about what is
 * on screen: the FILTER is shown (a tile reading "12 posts" with no visible filter
 * claims those are all of them), and the read TIME is shown (a live view with no
 * freshness marker is a screenshot claiming to be live). It leads with ENGAGEMENT and
 * the best-performing post rather than a raw list, because "what worked?" is the
 * question a feed on a CMO's board is actually asked.
 */
function SocialFeedBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const fmt = useFormat();
  const posts = Array.isArray(data.posts) ? data.posts : [];
  const engagement = asRecord(data.engagement, {});
  const top = asRecord(data.topPost, {});
  const accounts = Array.isArray(data.accounts) ? data.accounts.map(String) : [];
  const fetchedAt = typeof data.fetchedAt === 'string' ? new Date(data.fetchedAt) : null;

  if (accounts.length === 0 && posts.length === 0) {
    return <div className={styles.taskContext}><p className={styles.taskEmpty}>{t('socialNotConnected')}</p></div>;
  }
  return <div className={styles.inboxBody}>
    <div className={styles.inboxMeta}>
      <span title={accounts.join(', ')}>{accounts.join(' · ') || t('socialAllAccounts')}</span>
      {fetchedAt && <small>{t('inboxReadAt', { time: fmt.time(fetchedAt) })}</small>}
    </div>
    <div className={styles.campaignStats}>
      <span><small>{t('socialLikes')}</small><b>{compactCount(engagement.likes)}</b></span>
      <span><small>{t('socialComments')}</small><b>{compactCount(engagement.comments)}</b></span>
      <span><small>{t('socialShares')}</small><b>{compactCount(engagement.shares)}</b></span>
    </div>
    {posts.length === 0
      ? <p className={styles.taskEmpty}>{t('socialEmpty')}</p>
      : <ul className={styles.inboxList}>
        {posts.slice(0, 10).map((raw, index) => {
          const post = asRecord(raw, {});
          const metrics = asRecord(post.metrics, {});
          return <li key={String(post.id ?? index)}>
            <div className={styles.inboxRowTop}>
              <b><span className={styles.socialGlyph} aria-hidden>{networkGlyph(post.network)}</span>{String(post.authorName || post.accountName || '')}</b>
              <small>{post.publishedAtISO
                ? fmt.dateWith(String(post.publishedAtISO), { month: 'short', day: 'numeric' })
                : ''}</small>
            </div>
            <p>{String(post.text || '')}</p>
            <div className={styles.socialMetrics}>
              <span>{t('socialLikeCount', { count: Number(metrics.likes) || 0 })}</span>
              <span>{t('socialCommentCount', { count: Number(metrics.comments) || 0 })}</span>
              <span>{t('socialShareCount', { count: Number(metrics.shares) || 0 })}</span>
            </div>
          </li>;
        })}
      </ul>}
    {top.text ? <div className={styles.taskContext}>
      <small>{t('socialTopPost')}</small>
      <p>{String(top.text)}</p>
    </div> : null}
    {posts.length > 10 && <small className={styles.inboxMore}>{t('inboxMore', { count: posts.length - 10 })}</small>}
  </div>;
}

/** One pinned post. Unlike the feed tile this does NOT change — that is the reason
 *  it exists — so it shows the full text and its engagement at the time it was read. */
function SocialPostBody({ data }: { data: CreationNodeData }) {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas.node');
  const metrics = asRecord(data.metrics, {});
  const permalink = textValue(data.permalink);
  const thumbnail = textValue(data.thumbnailUrl);
  return <div className={styles.taskBody}>
    <div className={styles.taskFacts}>
      <span><small>{t('socialAccount')}</small><b>{`${networkGlyph(data.network)} ${textValue(data.accountName, '—')}`}</b></span>
      <span><small>{t('socialPublished')}</small><b>{data.publishedAt ? fmt.date(String(data.publishedAt)) : '—'}</b></span>
    </div>
    {thumbnail && <img className={styles.socialMedia} src={thumbnail} alt="" />}
    <div className={styles.taskContext}>
      <small>{t('socialPostText')}</small>
      {textValue(data.text)
        ? <p className={styles.emailBodyText}>{String(data.text)}</p>
        : <p className={styles.taskEmpty}>{t('socialNoText')}</p>}
    </div>
    <div className={styles.campaignStats}>
      <span><small>{t('socialLikes')}</small><b>{compactCount(metrics.likes)}</b></span>
      <span><small>{t('socialComments')}</small><b>{compactCount(metrics.comments)}</b></span>
      <span><small>{t('socialShares')}</small><b>{compactCount(metrics.shares)}</b></span>
    </div>
    {permalink && <a className={styles.inboxOpenLink} href={permalink} target="_blank" rel="noreferrer noopener">{t('socialOpenPost')}</a>}
  </div>;
}

/**
 * A social campaign tile. Counters lead for the same reason the email campaign's do —
 * "did it go out, and where?" is the only question it is asked — and each target shows
 * its own outcome, because "3 of 5 published" without saying WHICH three is unusable.
 */
function SocialCampaignBody({ data }: { data: CreationNodeData }) {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas.node');
  const posts = Array.isArray(data.posts) ? data.posts : [];
  // Blockers arrive as CODES so they can be read in the viewer's language. A legacy
  // string (an older saved board, or an email campaign's flat list) is shown as-is
  // rather than dropped — an unreadable reason still beats a silent one.
  const blockers = (Array.isArray(data.blockers) ? data.blockers : []).map((raw) => {
    if (typeof raw === 'string') return raw;
    const blocker = asRecord(raw, {});
    const code = String(blocker.code ?? '');
    return code
      ? t(`socialBlocker.${code}` as never, {
        network: String(blocker.network ?? ''),
        account: String(blocker.account ?? ''),
        fields: String(blocker.fields ?? ''),
      } as never)
      : '';
  }).filter(Boolean);
  const stat = (value: unknown) => String(Number(value) || 0);
  const scheduledAt = textValue(data.scheduledAt);
  return <div className={styles.taskBody}>
    <div className={styles.campaignStats}>
      <span><small>{t('socialPublishedCount')}</small><b>{stat(data.publishedCount)}/{stat(data.targets ?? posts.length)}</b></span>
      <span><small>{t('campaignFailed')}</small><b>{stat(data.failedCount)}</b></span>
      <span><small>{t('socialScheduled')}</small><b>{scheduledAt ? fmt.date(scheduledAt) : '—'}</b></span>
    </div>
    {textValue(data.body) && <div className={styles.taskContext}><small>{t('socialCopy')}</small><p>{String(data.body)}</p></div>}
    {posts.length > 0 && <ul className={styles.socialTargets}>
      {posts.slice(0, 8).map((raw, index) => {
        const post = asRecord(raw, {});
        const status = String(post.status ?? 'queued');
        return <li key={String(post.id ?? index)} data-status={status}>
          <span aria-hidden>{networkGlyph(post.network)}</span>
          <b>{String(post.accountName || post.network || '')}</b>
          {post.permalink
            ? <a href={String(post.permalink)} target="_blank" rel="noreferrer noopener">{t(`socialStatus.${status}`)}</a>
            : <small>{t(`socialStatus.${status}`)}</small>}
        </li>;
      })}
    </ul>}
    {blockers.length > 0 && <div className={styles.taskContext}><small>{t('campaignBlocked')}</small><p>{blockers.join(' · ')}</p></div>}
  </div>;
}

/**
 * A pipeline, as a kanban with swimlanes — and a deal you can actually drag.
 *
 * Stages across, segments down, a deal at the intersection — because "qualified"
 * is different work for a founder and for an enterprise buyer, and one column of
 * both is a list nobody can act on. The model (`canvasSalesPipeline`) does the
 * normalising; this only draws it.
 *
 * ── WHY THE DRAG IS THE POINT ────────────────────────────────────────────────
 * FO-F1 made the board a PROJECTION and gave every card its `dealId`, and named
 * itself after "a deal dragged on the board" — which was then possible through the
 * MODEL (`canvas_move_deal`) and not through a pointer, because this component had
 * no drag handler. Everything the gesture needs already existed: the card carries
 * the canonical id, and ONE call both moves the deal and returns the redrawn
 * board. So this is an affordance over an existing write, and it is deliberately
 * not a second write path — `onMoveDeal` reaches exactly the same `moveDeal` the
 * tool does, and the card is redrawn from that call's own response.
 *
 * A card with no `dealId` is NOT draggable, and that is the honest rendering: a
 * hand-authored card has no row behind it to move, and letting it slide into
 * another column would show a change the CRM never made.
 *
 * `nowheel`/`nodrag` on the scroller: the board owns the wheel for zoom, so
 * without them scrolling to a later stage zooms the canvas instead, and a pointer
 * drag on a card would pan the board rather than move the deal.
 */
function PipelineBoardBody({ data, onMoveDeal }: { data: CreationNodeData; onMoveDeal?: (dealId: number, stage: string) => void }) {
  const { formatCents } = useMoneyFormat();
  const t = useTranslations('creationCanvas.node');
  const model = useMemo(() => readPipelineModel(data as unknown as Record<string, unknown>), [data]);
  const stageLabel = (stage: string) => (t.has(`pipelineStage.${stage}`) ? t(`pipelineStage.${stage}`) : stage);
  // ONE cents formatter, shared with every other money surface in the product. The private
  // `$${cents / 100}` this used to carry rendered US dollars with no decimals whatever the
  // board's currency was, and was the twenty-first copy of the same three lines — see
  // `formatCents`.
  const money = (cents: number) => formatCents(cents, { maximumFractionDigits: 0 });
  // The whole board's OPEN pipeline, weighted. This is what makes the object answer the
  // question it exists for — "will I hit my number" — rather than only "how many cards".
  const totals = useMemo(() => pipelineTotals(model), [model]);

  /** The deal under the pointer, and the column it is over. Local because it is
   *  pure gesture state — nothing outside this card needs to know a drag is in
   *  flight, and putting it on the node would make a hover a board mutation. */
  const [dragging, setDragging] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const canMove = Boolean(onMoveDeal);
  const endDrag = () => { setDragging(null); setOverStage(null); };

  const drop = (stage: string) => (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const dealId = Number(event.dataTransfer.getData('application/x-builderforce-deal') || dragging || 0);
    endDrag();
    // A drop back into the column it came from is not a move. Refused here rather
    // than at the API, so an accidental nudge costs nothing and writes no touch.
    if (!dealId || !onMoveDeal) return;
    const card = model.cards.find((row) => row.dealId === dealId);
    if (card && card.stage === stage) return;
    onMoveDeal(dealId, stage);
  };

  return (
    <div
      className={`${styles.pipelineBoard} nodrag nowheel`}
      // The column count is DATA, so the grid template reads it rather than the
      // stylesheet hard-coding seven and breaking on a six-stage pipeline.
      style={{ ['--pipeline-stages' as string]: String(model.stages.length) }}
    >
      <div className={styles.pipelineHead}>
        {/* The lane gutter's header cell — empty, so the stage columns line up. */}
        <span aria-hidden="true" />
        {model.stages.map((stage) => {
          const column = stageTotals(model, stage);
          return (
            <span key={stage} className={styles.pipelineStageHead}>
              <b>{stageLabel(stage)}</b>
              <small>{column.valueCents > 0 ? `${column.count} · ${money(column.valueCents)}` : String(column.count)}</small>
            </span>
          );
        })}
      </div>
      {/* The line a pipeline is actually read for. Shown only once there is money on the
          board: a weighted total of zero would read as a dead quarter when what it means
          is that nobody has priced anything yet — and the unpriced count says exactly that
          instead. */}
      {totals.openCount > 0 && (
        <p className={styles.pipelineTotals}>
          <span>{t('pipelineWeighted', { amount: money(totals.weightedCents) })}</span>
          <span>{t('pipelineOpen', { count: totals.openCount, amount: money(totals.openValueCents) })}</span>
          {totals.unpricedCount > 0 && <span>{t('pipelineUnpriced', { count: totals.unpricedCount })}</span>}
        </p>
      )}
      {model.lanes.map((lane, laneIndex) => (
        <div key={lane.id} className={styles.pipelineLane}>
          <span className={styles.pipelineLaneHead}>
            <b>{lane.title || t('pipelineAllSegments')}</b>
            {lane.hint && <small>{lane.hint}</small>}
          </span>
          {model.stages.map((stage) => {
            const cards = cardsAt(model, laneIndex, stage);
            const shown = cards.slice(0, PIPELINE_MAX_CARDS_PER_CELL);
            return (
              <span
                key={stage}
                className={styles.pipelineCell}
                data-drop={canMove && dragging != null && overStage === stage ? 'true' : undefined}
                // `preventDefault` on drag-over is what MAKES an element a drop
                // target in the HTML drag protocol — without it the drop event
                // never fires and the card silently springs back.
                onDragOver={canMove ? (event) => { event.preventDefault(); setOverStage(stage); } : undefined}
                onDrop={canMove ? drop(stage) : undefined}
              >
                {shown.map((card) => {
                  const draggable = canMove && card.dealId != null;
                  return (
                    <article
                      key={card.id}
                      className={styles.pipelineCard}
                      draggable={draggable}
                      data-draggable={draggable ? 'true' : undefined}
                      data-dragging={dragging != null && dragging === card.dealId ? 'true' : undefined}
                      // Named so a screen reader is told the card is movable and
                      // where it currently sits — a drag affordance nobody can
                      // perceive is a drag affordance for one kind of user.
                      aria-grabbed={draggable ? (dragging === card.dealId) : undefined}
                      title={draggable ? t('pipelineDragHint', { stage: stageLabel(card.stage) }) : undefined}
                      onDragStart={draggable ? (event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('application/x-builderforce-deal', String(card.dealId));
                        setDragging(card.dealId);
                      } : undefined}
                      onDragEnd={draggable ? endDrag : undefined}
                    >
                      <b>{card.title}</b>
                      {card.note && <p>{card.note}</p>}
                      {card.valueCents != null && (
                        <em>{money(card.valueCents)} · {t('pipelineOdds', { percent: cardProbabilityPercent(card) })}</em>
                      )}
                    </article>
                  );
                })}
                {cards.length > shown.length && <small>{t('pipelineMore', { count: cards.length - shown.length })}</small>}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TaskBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const agent = textValue(data.assignee, textValue(data.agentName, textValue(data.role, t('unassigned'))));
  const priority = textValue(data.priority, t('notSet'));
  const prdTitle = textValue(data.prdTitle);
  const prdSummary = textValue(data.prdSummary);
  const acceptance = textValue(data.acceptanceCriteria);
  return <div className={styles.taskBody}>
    {data.isBlocked === true && <p role="status" style={{ margin: 0, padding: '3px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--tone-warning-bg)', color: 'var(--tone-warning-ink)', fontSize: 'var(--font-size-eyebrow)', fontWeight: 600 }}>{t('blockedByDependency')}</p>}
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

function AgentBody({ data, onOpen, onOpenBuiltin }: { data: CreationNodeData; onOpen?: (focus: 'knowledge' | 'test') => void; onOpenBuiltin?: (intent: 'execute' | 'diagnostics') => void }) {
  const t = useTranslations('creationCanvas.node');
  const tools = Array.isArray(data.tools) ? data.tools.map(String) : ['Audience Analyzer', 'Copy Optimizer'];
  const autonomy = optionLabel(data.autonomy, { low: t('lowAutonomy'), medium: t('mediumAutonomy'), high: t('highAutonomy') }, t('mediumAutonomy'));
  const existing = typeof data.resourceId === 'string' && data.resourceId.startsWith('agent:');
  const builtin = typeof data.agentDomain === 'string' && typeof data.agentSeat === 'string';
  const managerBuiltin = builtin && data.agentDomain === 'delivery' && data.agentSeat === 'Manager';
  const thinking = data.collaborationState === 'thinking' || data.testStatus === 'Running';
  const latestReply = textValue(data.collaborationReply, textValue(data.testResponse));
  return <>
    <div className={styles.agentIdentity}>
      <Avatar name={data.title} kind="agent" size={34} />
      <span><b>{existing || builtin ? t('configuredAgent') : t('newAgent')}</b><small>{textValue(data.role, data.status || t('online'))}</small></span>
      <em>{data.model === 'auto' || !data.model ? t('autoModel') : data.model}</em>
    </div>
    {thinking && <div className={styles.agentThinking} role="status"><i aria-hidden><Icon source="✦" size="1em" /></i><b>{data.testStatus === 'Running' ? t('testing') : t('thinking')}</b><span>{t('contributing')}</span></div>}
    {!thinking && latestReply && <div className={styles.agentLatestReply}><small>{t('latestResponse')}</small><p>{latestReply}</p></div>}
    {!latestReply && !thinking && <p>{textValue(data.personality, textValue(data.instructions, data.subtitle || ''))}</p>}
    <div className={styles.pills}>{tools.map((tool) => <span key={tool}>{tool}</span>)}<span>{autonomy}</span>{typeof data.testStatus === 'string' && data.testStatus && <span>{data.testStatus}</span>}</div>
    <div className={`${styles.nodeActionBar} nodrag nowheel`}>{builtin ? <>
      <button type="button" onClick={(event) => { event.stopPropagation(); onOpenBuiltin?.('execute'); }}>{t('executeBuiltin')}</button>
      {managerBuiltin && <button type="button" onClick={(event) => { event.stopPropagation(); onOpenBuiltin?.('diagnostics'); }}>{t('builtinDiagnostics')}</button>}
    </> : <>
      <button type="button" onClick={(event) => { event.stopPropagation(); onOpen?.('knowledge'); }}>{t('addKnowledgeStep')}</button>
      <button type="button" onClick={(event) => { event.stopPropagation(); onOpen?.('test'); }}>{t('testAgentStep')}</button>
    </>}</div>
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
    </div>
  );
}

/**
 * Builder tile — the Canvas face of a real build. It reports the binding
 * (type, workspace state, published URL) and leaves every capability to Builder
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
        <span aria-hidden><Icon source={modality.icon} size={18} /></span>
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

/**
 * The Dashboard / Chart / Report card.
 *
 * The card used to BE the layout: one bar list, one donut, and — when nothing was
 * authored — three invented KPIs ("Reach 212K") that made an empty object look like a
 * finished marketing dashboard. It is now a grid of authored widgets read through
 * {@link readDashboardWidgets}, so what a dashboard shows is data the author owns and
 * can add to, reorder, retype and delete. An unauthored dashboard says so instead of
 * inventing numbers.
 *
 * Editing happens BESIDE the drawing rather than instead of it: the grid stays mounted
 * while the editor is open and both render from the same array, which is what makes the
 * surface WYSIWYG.
 */
function DashboardBody({ data, onEdit }: { data: CreationNodeData; onEdit?: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.node');
  const fmt = useFormat();
  const [editing, setEditing] = useState(false);
  const widgets = useMemo(() => readDashboardWidgets(data as Record<string, unknown>), [data]);
  const dateRange = optionLabel(data.dateRange, { '30d': t('last30Days'), '7d': t('last7Days'), qtd: t('quarterToDate') }, t('last30Days'));
  return (
    <>
      {data.kind === 'dashboard' && <div className={styles.widgetContext}><span><small>{t('dateRange')}</small><b>{dateRange}</b></span>{typeof data.fetchedAt === 'string' && <span><small>{t('refreshed')}</small><b>{fmt.time(data.fetchedAt)}</b></span>}</div>}
      {widgets.length > 0
        ? <DashboardWidgetGrid widgets={widgets} />
        : <p className={styles.dwEmpty}>{onEdit ? t('dashboardEmptyEditable') : t('dashboardEmpty')}</p>}
      {typeof data.xAxisLabel === 'string' && data.xAxisLabel.trim() && <small className={styles.axisLabel}>{data.xAxisLabel}</small>}
      {onEdit && <div className={`${styles.cardActions} nodrag nowheel`}>
        <button
          type="button"
          data-active={editing ? 'true' : undefined}
          aria-pressed={editing}
          onClick={(event) => { event.stopPropagation(); setEditing(!editing); }}
        >{editing ? t('dashboardDone') : t('dashboardEdit')}</button>
      </div>}
      {onEdit && editing && <div className="nodrag nowheel" onClick={(event) => event.stopPropagation()}>
        <DashboardStructuredEditor
          widgets={widgets}
          onChange={(next) => onEdit(dashboardWidgetsPatch(next) as Partial<CreationNodeData>)}
        />
      </div>}
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
/**
 * A map you can INTERROGATE, not only look at.
 *
 * It used to render one projection fitted to the data and stop there: a marker's
 * only affordance was its `<title>` tooltip, so a plot of every district in one
 * metro was a smudge that could be admired and not read, and clicking a place
 * did nothing at all.
 *
 * Three things changed, and each is deliberate about WHERE its state lives:
 *
 *  · **Zoom and pan are on the OBJECT** (`mapZoom` / `mapCenter`), not in this
 *    component. A reading a person worked for has to survive a re-render, ride
 *    the session snapshot, and be something Brain can read and set — component
 *    state would lose all three. The maths is `mapViewportBounds`, which is pure
 *    and tested away from React.
 *  · **The board keeps its own gestures.** The surface carries `nodrag nowheel`,
 *    which is how React Flow is told a wheel or a drag inside this element is
 *    not a canvas pan. Without them, zooming the map would zoom the board.
 *  · **A marker click SELECTS**, writing `mapSelectedLabel` back to the object,
 *    and — where the map was built from a dataset on the board — offers the row
 *    it came from through the `sourceDatasetId` link that already existed.
 */
function MapBody({ data, onEdit, onReveal }: {
  data: CreationNodeData;
  onEdit?: (patch: Partial<CreationNodeData>) => void;
  /** Put the reader in front of another object — the dataset this map came from. */
  onReveal?: (nodeId: string) => void;
}) {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas.node');
  const points = useMemo(() => sanitizeMapPoints(data.mapPoints), [data.mapPoints]);
  const region = useMemo(() => sanitizeGeoBounds(data.mapRegion), [data.mapRegion]);
  /** The extent the data occupies — the reading nothing has touched. */
  const base = useMemo(() => geoBoundsFor(points, region), [points, region]);
  const zoom = sanitizeMapZoom(data.mapZoom);
  const view = useMemo(() => (base ? mapViewportBounds(base, zoom, data.mapCenter) : null), [base, zoom, data.mapCenter]);
  const projection = useMemo(
    () => projectMap(points, { width: 320, height: 190, region: view }),
    [points, view],
  );
  const outline = useMemo(
    () => (projection && data.mapOutline ? outlinePaths(data.mapOutline, projection.project) : []),
    [projection, data.mapOutline],
  );
  const surfaceRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const interactive = !!onEdit && !!base && !!view;
  const selectedLabel = typeof data.mapSelectedLabel === 'string' ? data.mapSelectedLabel : '';
  const sourceId = typeof data.sourceDatasetId === 'string' && data.sourceDatasetId.trim() ? data.sourceDatasetId.trim() : '';

  /** Zoom about the pointer, so the thing under the cursor stays under it. */
  const zoomBy = useCallback((factor: number, at?: { x: number; y: number }) => {
    if (!onEdit || !base || !view) return;
    const next = sanitizeMapZoom(zoom * factor);
    if (next === zoom) return;
    const centre = sanitizeMapCenter(data.mapCenter) ?? boundsCenter(base);
    if (!at) {
      onEdit({ mapZoom: next, mapCenter: centre });
      return;
    }
    // Keep the pointer's coordinate fixed: move the centre a fraction of the way
    // towards it, equal to how much of the window the zoom step removes.
    const [south, north, west, east] = view;
    const lat = north - (at.y * (north - south));
    const lng = west + (at.x * (east - west));
    const share = 1 - zoom / next;
    onEdit({ mapZoom: next, mapCenter: [centre[0] + (lat - centre[0]) * share, centre[1] + (lng - centre[1]) * share] });
  }, [onEdit, base, view, zoom, data.mapCenter]);

  const resetView = useCallback(() => {
    onEdit?.({ mapZoom: 1, mapCenter: null, mapSelectedLabel: '' });
  }, [onEdit]);

  if (!projection || !base || !view) {
    return <div className={styles.mapBody}>
      <p className={styles.mapEmpty}>{t('mapEmpty')}</p>
      <div className={styles.pills}><span>{data.status || t('mapEmptyStatus')}</span></div>
    </div>;
  }

  const valueLabel = typeof data.mapValueLabel === 'string' && data.mapValueLabel.trim() ? data.mapValueLabel.trim() : '';
  const valued = projection.points.filter((point) => typeof point.value === 'number');
  // Only the largest few carry a printed name — at card size every label collides, and
  // a legible map of the top places beats an illegible one of all of them. The rest stay
  // readable through the marker's own title/aria text. Zooming in re-runs this over
  // whatever is still in frame, which is how a cluster becomes readable.
  const labelled = new Set([...valued].sort((first, second) => (second.value ?? 0) - (first.value ?? 0)).slice(0, 5).map((point) => point.label));
  const [south, north, west, east] = projection.bounds;
  const selected = projection.points.find((point) => point.label === selectedLabel) ?? null;
  const ariaLabel = t('mapAria', {
    count: projection.points.length,
    places: projection.points.slice(0, 12).map((point) => point.value != null ? `${point.label} (${fmt.number(point.value)})` : point.label).join(', '),
  });

  /** Pointer position as a 0..1 fraction of the surface, for pointer-anchored zoom. */
  const fractionOf = (event: { clientX: number; clientY: number }) => {
    const box = surfaceRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return undefined;
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };

  return (
    <div className={styles.mapBody}>
      <div className={styles.widgetContext}>
        <span><small>{t('mapPlaces')}</small><b>{fmt.number(projection.points.length)}</b></span>
        {typeof data.mapRegionName === 'string' && data.mapRegionName.trim() && <span><small>{t('mapRegion')}</small><b>{data.mapRegionName}</b></span>}
        {valueLabel && valued.length > 0 && <span><small>{t('mapSizedBy')}</small><b>{valueLabel}</b></span>}
      </div>
      <svg
        ref={surfaceRef}
        // `nodrag nowheel` is how React Flow is told this element owns its own
        // gestures. Without them a wheel here zooms the BOARD and a drag pans it.
        className={`${styles.mapSurface}${interactive ? ` ${styles.mapSurfaceLive} nodrag nowheel` : ''}`}
        viewBox={`0 0 ${projection.width} ${projection.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
        data-zoomed={zoom > 1 ? 'true' : undefined}
        {...(interactive ? {
          onWheel: (event: React.WheelEvent<SVGSVGElement>) => {
            event.preventDefault();
            event.stopPropagation();
            zoomBy(event.deltaY < 0 ? 1.25 : 1 / 1.25, fractionOf(event));
          },
          onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            drag.current = { x: event.clientX, y: event.clientY, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          },
          onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => {
            const from = drag.current;
            if (!from) return;
            const dx = event.clientX - from.x;
            const dy = event.clientY - from.y;
            // A few pixels of travel is a click with a shaky hand, not a pan.
            if (!from.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            from.moved = true;
            const box = surfaceRef.current?.getBoundingClientRect();
            if (!box) return;
            const centre = sanitizeMapCenter(data.mapCenter) ?? boundsCenter(base);
            onEdit?.({ mapZoom: zoom, mapCenter: panCenter(view, centre, dx, dy, { width: box.width, height: box.height }) });
            drag.current = { x: event.clientX, y: event.clientY, moved: true };
          },
          onPointerUp: (event: React.PointerEvent<SVGSVGElement>) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            drag.current = null;
          },
          onPointerCancel: () => { drag.current = null; },
          onDoubleClick: (event: React.MouseEvent<SVGSVGElement>) => { event.stopPropagation(); resetView(); },
        } : {})}
      >
        <rect className={styles.mapPlate} x="0" y="0" width={projection.width} height={projection.height} rx="8" />
        <g className={styles.mapGraticule}>
          {projection.graticule.verticals.map((line) => <line key={`v${line.lng}`} x1={line.x} y1="0" x2={line.x} y2={projection.height} />)}
          {projection.graticule.horizontals.map((line) => <line key={`h${line.lat}`} x1="0" y1={line.y} x2={projection.width} y2={line.y} />)}
        </g>
        {outline.length > 0 && <g className={styles.mapOutline}>{outline.map((path, index) => <path key={`outline-${index}`} d={path} />)}</g>}
        <g className={styles.mapMarkers}>
          {projection.points.map((point, index) => (
            <circle
              key={`${point.label}-${index}`}
              cx={point.x}
              cy={point.y}
              r={point.radius}
              data-tone={point.tone ?? undefined}
              data-selected={point.label === selectedLabel ? 'true' : undefined}
              {...(interactive ? {
                onClick: (event: React.MouseEvent<SVGCircleElement>) => {
                  event.stopPropagation();
                  // A pan that ended on a marker is a pan, not a selection.
                  if (drag.current?.moved) return;
                  onEdit?.({ mapSelectedLabel: point.label === selectedLabel ? '' : point.label });
                },
              } : {})}
            >
              <title>{point.value != null ? `${point.label} — ${fmt.number(point.value)}${valueLabel ? ` ${valueLabel}` : ''}` : point.label}</title>
            </circle>
          ))}
        </g>
        <g className={styles.mapLabels}>
          {projection.points.filter((point) => labelled.has(point.label) || point.label === selectedLabel).map((point, index) => (
            <text key={`label-${point.label}-${index}`} x={point.x} y={point.y - point.radius - 2.5} textAnchor="middle">{point.label.slice(0, 22)}</text>
          ))}
        </g>
      </svg>

      {interactive && <div className={`${styles.mapControls} nodrag`}>
        <button type="button" onClick={(event) => { event.stopPropagation(); zoomBy(1.6); }} aria-label={t('mapZoomIn')} disabled={zoom >= MAP_ZOOM_RANGE.max}>+</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); zoomBy(1 / 1.6); }} aria-label={t('mapZoomOut')} disabled={zoom <= MAP_ZOOM_RANGE.min}>−</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); resetView(); }} disabled={zoom <= MAP_ZOOM_RANGE.min && !selectedLabel}>{t('mapReset')}</button>
      </div>}

      {selected && <div className={`${styles.mapSelection} nodrag`}>
        <b>{selected.label}</b>
        {selected.value != null && <span>{fmt.number(selected.value)}{valueLabel ? ` ${valueLabel}` : ''}</span>}
        <span>{t('mapAt', { lat: selected.lat.toFixed(3), lng: selected.lng.toFixed(3) })}</span>
        {sourceId && onReveal && (
          <button type="button" onClick={(event) => { event.stopPropagation(); onReveal(sourceId); }}>{t('mapOpenSource')}</button>
        )}
      </div>}

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
  const fmt = useFormat();
  const t = useTranslations('creationCanvas.node');
  // A card re-renders on selection, drag, and every neighbouring edit. Normalizing
  // an imported workbook's rows is O(rows × columns) per sheet, so doing it inline
  // would re-walk a 50,000-row import on each of those renders.
  const stored = useMemo(() => tabularFromObject(data as Record<string, unknown>), [data]);
  /**
   * THE RECALCULATION.
   *
   * `formulas` was a declared mutable field with no reader anywhere in the frontend, so
   * a sheet could store `=SUM(C1:C12)` and render that literal string. Everything below
   * this line reads `source`, so a formula cell now shows its VALUE — and a broken one
   * shows `#REF!`/`#CYCLE!` rather than a stale literal that looks like a real number.
   *
   * Memoized on the same dependency the normalization above uses: recalculation is
   * O(cells) with a topological sort, and a card re-renders on selection, drag and every
   * neighbouring edit.
   */
  const recalc = useMemo(
    () => (data.formulas ? recalculateSheet({ columns: stored.columns, rows: stored.rows, formulas: data.formulas }) : null),
    [stored, data.formulas],
  );
  const source = recalc ? { columns: stored.columns, rows: recalc.rows } : stored;
  // A computed cell is NOT editable: typing over it would replace the formula's output
  // with a literal and silently break every cell downstream of it — the sheet would keep
  // rendering a number, and it would stop being the number the formula says.
  const computedCells = useMemo(
    () => new Set(recalc ? Object.keys(recalc.cells) : []),
    [recalc],
  );
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
  // Restricted columns are masked HERE, on the render path, not by rewriting the
  // stored rows: the analysis must still run over the real values (a masked join
  // key matches nothing), while a card on a shared board must never paint a card
  // number or a national id in the clear. `maskCell` preserves the shape a
  // reviewer needs — the domain of an email, the last four of a card — because a
  // column of identical dots says nothing about whether the data is right.
  const masking = maskPlan(normalizeClassifications(data.classifications));
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
      {Object.entries(toneCounts).map(([tone, count]) => <span key={tone} data-tone={tone}><i />{t(`tone_${tone}` as 'tone_success')}<b>{fmt.number(count)}</b></span>)}
    </div>}
    {/* A formula that failed is reported on the card rather than only inside the cell:
        one `#REF!` in a 500-row sheet is invisible, and every total downstream of it is
        wrong by exactly that cell. */}
    {!!recalc?.errors.length && <p className={styles.dataGridFormulaErrors} role="status">
      {t('formulaErrors', { count: recalc.errors.length, first: `${recalc.errors[0].ref} ${recalc.errors[0].text}` })}
    </p>}
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
            const pii = masking.get(column);
            const value = String((pii ? maskCell(row[column], pii) : row[column]) ?? '');
            // A COMPUTED cell is not editable either, and for a sharper reason than a
            // masked one: typing over it replaces the formula's output with a literal,
            // the cell keeps rendering a number, and it silently stops being the number
            // the formula says — while everything downstream still computes from it.
            const computed = computedCells.has(`${columnLetters(source.columns.indexOf(column))}${rowIndex + 1}`);
            return <span key={`${rowIndex}-${column}`} data-tone={tone ?? undefined} data-masked={pii ? 'true' : undefined} data-computed={computed ? 'true' : undefined}>
              {/* A masked cell is NOT editable: the visible text IS the mask, so
                  committing it would overwrite the real value with dots. */}
              {editable && !pii && !computed && draft?.row === rowIndex && draft.column === column
                ? <input {...editorProps(rowIndex, column)} />
                : editable && !pii && !computed
                  ? <button type="button" className={styles.dataGridCellButton} onClick={() => setDraft({ row: rowIndex, column, value })}>{value || ' '}</button>
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
        <div className={styles.documentMarkdown}><ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>{pages[page] ?? document.markdown}</ReactMarkdown></div>
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
  if (!hex || (hex.length !== 3 && hex.length !== 6)) return 'var(--canvas-ink)';
  const expanded = hex.length === 3 ? hex.split('').map((character) => character + character).join('') : hex;
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16) / 255);
  const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  return luminance > 0.55 ? 'var(--canvas-ink-on-light)' : 'var(--canvas-ink-on-dark)';
}

function DiagramCanvas({ graph, title }: { graph: DiagramGraph; title: string }) {
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
    {graph.edges.map((edge) => <g key={edge.id} style={{ color: edge.stroke ?? 'var(--canvas-muted)' }}>
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
        fill="var(--canvas-muted)"
      >{edge.label}</text>}
    </g>)}
    {graph.vertices.map((vertex) => {
      const polygon = diagramShapePolygon(vertex);
      const fill = vertex.fill ?? 'var(--canvas-widget-surface)';
      const stroke = vertex.stroke ?? 'var(--canvas-widget-border)';
      const ink = vertex.fontColor ?? (vertex.fill ? readableInk(vertex.fill) : 'var(--canvas-ink)');
      const lines = diagramLabelLines(vertex.label, vertex.width, vertex.fontSize);
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
 * A diagram object rendered as a diagram.
 *
 * Every notation but one is drawn from the shared graph — the SAME renderer for
 * a draw.io scene, a Visio import, a BPMN process, a DOT graph and a PlantUML
 * component diagram, because by the time it reaches here they are all the same
 * geometry. Mermaid keeps its own renderer: its output is better than anything
 * derived from a parse of it, and reimplementing it is not the job.
 *
 * No editor embed and no network in either path.
 */
function DiagramBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const diagram = canvasDiagram(data);
  const source = diagram?.source ?? '';
  const format = diagram?.format;
  const notation = diagramNotation(format);
  const [graph, setGraph] = useState<DiagramGraph | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => {
    if (!format || notation?.renderer !== 'graph') { setGraph(null); setUnreadable(false); return; }
    let cancelled = false;
    void readDiagramSource(format, source).then((parsed) => {
      if (cancelled) return;
      setGraph(parsed);
      setUnreadable(!parsed);
    });
    return () => { cancelled = true; };
  }, [format, notation?.renderer, source]);
  if (!diagram || !notation) return <AuthoredContent data={data} fallback={t('diagramFallback')} />;
  return <div className={styles.diagramBody}>
    <div className={styles.documentMeta}>
      <span>{notation.name}</span>
      {graph && <span>{t('diagramShapes', { count: graph.vertices.length, connections: graph.edges.length })}</span>}
    </div>
    <div className={`${styles.diagramSurface} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
      {notation.renderer === 'mermaid'
        ? <MermaidDiagram code={diagram.source} />
        : graph
          ? <DiagramCanvas graph={graph} title={data.title} />
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
  // The interval renders WITH the value rather than under it: a point estimate and its
  // uncertainty read as one number or the reader takes the first and leaves.
  const low = typeof data.ciLow === 'number' ? data.ciLow : null;
  const high = typeof data.ciHigh === 'number' ? data.ciHigh : null;
  const interval = low != null && high != null ? `${low} – ${high}` : null;
  const sampleSize = typeof data.sampleSize === 'number' ? data.sampleSize : null;
  return (
    <div className={styles.kpis}>
      <div>
        <small>{data.title}</small>
        <strong>{String(data.value ?? '—')}{data.unit ? ` ${String(data.unit)}` : ''}</strong>
        {interval && <em>{t('confidenceInterval', { interval })}</em>}
        <em>{data.trend ? String(data.trend) : data.target != null ? t('targetValue', { value: String(data.target) }) : ''}</em>
        {sampleSize != null && <em>{t('sampleSize', { count: sampleSize })}</em>}
      </div>
      <BasisNotice basis={data.basis} />
    </div>
  );
}

function EvaluationBody({ data, onOpen }: { data: CreationNodeData; onOpen?: () => void }) {
  const t = useTranslations('creationCanvas.node');
  const gaps = Array.isArray(data.gaps) ? data.gaps.slice(0, 3).map(String) : [];
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations.slice(0, 3).map(String) : [];
  return (
    <div className={styles.evaluationBody}>
      <div className={styles.verdict}>{String(data.verdict || t('evaluationReady'))}</div>
      {/* The gate reads the same fields the tool handlers refuse on, so what a person
          sees on the card and what the model is told when it tries to publish cannot
          disagree — one evaluator, three consumers. */}
      <EvaluationGateBadge data={data as Record<string, unknown>} />
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
    {/* Decides its own visibility — null when this diagnostic carries no page audit. */}
    <PageAuditFindings data={data} />
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
          {results.map((result, index) => <article key={`${result}-${index}`} data-severity="result"><span aria-hidden><Icon source="✓" size="1em" /></span><div><b>{result}</b></div></article>)}
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

  return <ToolRunner
    toolId={toolId}
    surface="canvas"
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
  const fmt = useFormat();
  const version = typeof data.evermindVersion === 'number' ? data.evermindVersion : 0;
  const contributions = typeof data.contributions === 'number' ? data.contributions : 0;
  const loss = typeof data.trainingLoss === 'number' ? data.trainingLoss : null;
  const pending = typeof data.pendingContributions === 'number' ? data.pendingContributions : 0;
  if (data.evermindLoading === true) return <div className={styles.evermindSyncing} role="status"><span><Icon source="◌" size="1em" /></span><b>{t('evermindSyncing')}</b><p>{t('evermindSyncingDetail')}</p></div>;
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
    ? fmt.dateWith(data.lastLearnedAt, { month: 'short', day: 'numeric' })
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
      <span><small>{t('adapterVersion')}</small><b>{version ? `v${version}` : t('blueprint')}</b></span>
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
          <g className={styles.evermindCore}><circle cx="160" cy="88" r="25" /><circle cx="160" cy="88" r="19" /><text x="160" y="86" textAnchor="middle"></text><text x="160" y="99" textAnchor="middle">{EVERMIND_BRAND}</text></g>
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
        }) : <div className={styles.evermindEmpty}><span><Icon source="◇" size="1em" /></span><b>{t('nothingLearned')}</b><p>{t('nothingLearnedDetail')}</p></div>}
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
  const fmt = useFormat();
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
      {projects.map((project, index) => <section key={`${index}-diagnostics`}><header><b>{String(project.name)}</b><span>{t('gapsCount', { count: Number(project.gapCount || 0) })}</span></header>{Array.isArray(project.diagnostics) && project.diagnostics.length ? project.diagnostics.slice(0, 5).map((raw, diagnosticIndex) => { const diagnostic = asRecord(raw, {}); return <div key={`${String(diagnostic.toolId)}-${diagnosticIndex}`}><span><Icon source={String(diagnostic.icon || 'apps')} size={14} /> {String(diagnostic.name || t('diagnostic'))}</span><b data-tone={scoreTone(diagnostic.score)}>{diagnostic.score == null ? '—' : Math.round(Number(diagnostic.score))}</b><small>{t('gapsCount', { count: Number(diagnostic.gapCount || 0) })}</small></div>; }) : <p>{t('noDiagnosticsRun')}</p>}</section>)}
    </div>
    <section className={styles.qualityRecommendations} aria-label={t('prioritizedRecommendations')}><header><b>{t('recommendedNextActions')}</b><span>{t('lowestScoringFirst')}</span></header>{recommendations.length ? recommendations.map((recommendation, index) => <article key={`${recommendation.project}-${String(recommendation.title)}-${index}`}><i>{index + 1}</i><div><b>{String(recommendation.title || t('reviewDiagnosticFinding'))}</b><p>{String(recommendation.detail || recommendation.diagnostic || '')}</p></div><span>{recommendation.project}<small>{String(recommendation.diagnostic || '')}</small></span></article>) : <p>{t('runQualityDiagnostics')}</p>}</section>
    <small>{t('freshness', { at: typeof data.fetchedAt === 'string' ? fmt.dateTime(data.fetchedAt) : t('draft') })}</small>
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

/**
 * A stand-up card: who is seated, and — once it has actually been held — what came of it.
 *
 * The card used to show `data.summary` unconditionally, and `data.summary` on a convened
 * stand-up is the sentence stamped on at CONVENING time ("Brain will ask each person for
 * progress, blockers and next actions"). It survived the meeting unchanged, so the board
 * went on promising a stand-up that had already happened. Once a ceremony exists the
 * OUTCOME replaces it, read live from the ceremony and its companion meeting rather than
 * copied onto the card — attendance is correctable afterwards, and a copy is exactly what
 * a correction leaves behind.
 */
function StandupBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.node');
  const participants = Array.isArray(data.participants) ? data.participants as Array<Record<string, unknown>> : [];
  const ceremonyId = resourceIdOfType(data.resourceId, 'ceremony');
  return <div className={styles.standupBody}>
    <div className={styles.standupRoster}>{participants.length ? participants.map((person, index) => <span key={`${person.ref}-${index}`}><i>{String(person.name || '?').slice(0, 1)}</i><b>{String(person.name || t('participant'))}</b><small>{String(person.kind || t('human'))}</small></span>) : <p>{t('standupFallback')}</p>}</div>
    {ceremonyId
      // The outcome decides its own visibility: nothing at all while the stand-up is
      // still running, which is when the round table is the surface to be looking at.
      ? <div className={styles.standupSummary}><CeremonyOutcome ceremonyId={ceremonyId} showTranscript={false} /></div>
      : typeof data.summary === 'string' && <div className={styles.standupSummary}><b>{t('brainFacilitator')}</b><p>{data.summary}</p></div>}
  </div>;
}

/**
 * A drawing: every stroke that was made on it, in the tool that made it.
 *
 * It renders as live SVG rather than an image because the marks are data now —
 * a highlighter is a wide translucent pen, a shape is a shape, and a text
 * annotation is text that can still be corrected without redrawing it.
 */
function DrawingBody({ data, onEdit }: { data: CreationNodeData; onEdit?: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.node');
  const strokes = canvasStrokes(data);
  const width = Number(data.drawingWidth) || 240;
  const height = Number(data.drawingHeight) || 120;
  const annotating = typeof data.annotatesId === 'string' && data.annotatesId.length > 0;
  const texts = strokes.map((stroke, index) => ({ stroke, index })).filter((entry) => entry.stroke.tool === 'text');
  const editText = (index: number, text: string) => onEdit?.({ strokes: strokes.map((stroke, at) => at === index ? { ...stroke, text } : stroke) } as Partial<CreationNodeData>);

  return <div className={styles.drawingBody} data-annotation={annotating || undefined}>
    {!annotating && <div className={styles.widgetContext}><span><small>{t('stroke')}</small><b>{t('strokeCount', { count: strokes.length })}</b></span></div>}
    <svg className={styles.drawingSurface} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={data.title} preserveAspectRatio="xMidYMid meet">
      {strokes.length ? strokes.map((stroke, index) => {
        const key = `${stroke.tool}-${index}`;
        const common = {
          stroke: stroke.stroke,
          strokeWidth: stroke.tool === 'highlighter' ? stroke.strokeWidth * HIGHLIGHTER_WIDTH_FACTOR : stroke.strokeWidth,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
          fill: 'none',
          ...(stroke.tool === 'highlighter' ? { opacity: HIGHLIGHTER_OPACITY } : {}),
        };
        if (stroke.tool === 'text') return <text key={key} x={stroke.points[0]!.x} y={stroke.points[0]!.y} fill={stroke.stroke} fontSize={Math.max(12, stroke.strokeWidth * 5)}>{stroke.text || ''}</text>;
        if (stroke.tool === 'rect') { const box = strokeRect(stroke); return <rect key={key} x={box.x} y={box.y} width={box.width} height={box.height} {...common} />; }
        if (stroke.tool === 'ellipse') { const box = strokeRect(stroke); return <ellipse key={key} cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} {...common} />; }
        return <path key={key} d={strokePathD(stroke)} {...common} />;
      }) : <text x="12" y="28" fill="currentColor">{t('drawHint')}</text>}
    </svg>
    {/* Text annotations are corrected here rather than by redrawing them. The
        row exists only when there is text AND the board is editable. */}
    {!!texts.length && onEdit && <div className={`${styles.drawingTexts} nodrag nowheel`} onClick={(event) => event.stopPropagation()}>
      {texts.map((entry) => <input
        key={`text-${entry.index}`}
        value={entry.stroke.text || ''}
        aria-label={t('annotationText')}
        placeholder={t('annotationPlaceholder')}
        onChange={(event) => editText(entry.index, event.target.value)}
      />)}
    </div>}
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
        onReplayMessage={surface.onReplayMessage}
        onRateMessage={surface.onRateMessage}
        ratings={surface.ratings}
        guestSignup={surface.guestSignup}
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
function GameBody({ data, onPlayFull }: { data: CreationNodeData; onPlayFull?: () => void }) {
  const t = useTranslations('creationCanvas.node');
  const [playing, setPlaying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const document = useMemo(() => gameDocumentFrom(data), [data]);
  const runtime = useMemo(() => gameRuntimeFor(data), [data]);
  const poster = creativePreviewImageUrl(data);
  const controls = useMemo(() => (document ? controlLabels(readGameControls(document)) : []), [document]);

  // Regenerating replaces the artifact; the running frame must be torn down or
  // the board keeps playing the previous game under the new title.
  useEffect(() => { setPlaying(false); setShowDetails(false); }, [runtime, document]);

  if (!runtime) {
    return <div className={styles.creativeStudioBody}>
      {poster
        ? <img src={poster} alt={t('previewAlt', { title: data.title })} />
        : <div className={styles.creativeStudioPreview} aria-hidden="true"><span><Icon source={creationObjectDefinition(data.kind).icon} size={24} /></span><i /><i /><i /></div>}
      <AuthoredContent data={data} fallback={t('gameNotGenerated')} />
      <div className={styles.pills}><span>{t('gameGenerateFirst')}</span></div>
    </div>;
  }

  /**
   * A place is played in the 3D runtime, and that does not fit in a card.
   *
   * A `.rbxlx` is a world of positioned parts. The canvas can walk one — but not
   * in 340px through a WebGL context per board object, so the big control here
   * OPENS the play surface rather than mounting an engine in a tile. It is still
   * the same gesture and the same button; only where it lands differs.
   */
  const opensSurface = runtime === 'world';
  const playLabel = opensSurface ? t('gamePlayIn3d') : t('gamePlay');

  const play = () => {
    if (opensSurface) { onPlayFull?.(); return; }
    setPlaying(true);
  };

  return <div className={`${styles.creativeStudioBody} ${styles.gameBody ?? ''}`}>
    <div className={styles.gameStage}>
      {playing && document
        ? <iframe
          className={styles.gameFrame}
          title={t('gamePlayingAlt', { title: String(data.title ?? '') })}
          srcDoc={document}
          // No `allow-same-origin`. See the note above — with `allow-scripts`
          // it would let the frame escape the sandbox entirely.
          sandbox={GAME_FRAME_SANDBOX}
          loading="lazy"
        />
        // THE control on the card, not a badge in the corner of one. A game is a
        // thing you press play on; everything else about it is a detail behind
        // the button, which is why the description moved under a toggle.
        : <button
          type="button"
          className={styles.gamePoster}
          disabled={opensSurface && !onPlayFull}
          onClick={(event) => { event.stopPropagation(); play(); }}
          style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
        >
          <span className={styles.gamePlayBadge} aria-hidden="true"><Icon source="▶" size="1em" /></span>
          <span className={styles.gamePlayLabel}>{playLabel}</span>
        </button>}
    </div>
    <div className={styles.pills}>
      {playing
        ? <button type="button" onClick={(event) => { event.stopPropagation(); setPlaying(false); }}>{t('gameStop')}</button>
        : <button
          type="button"
          aria-expanded={showDetails}
          onClick={(event) => { event.stopPropagation(); setShowDetails((value) => !value); }}
        >{showDetails ? t('gameHideDetails') : t('gameDetails')}</button>}
      {opensSurface
        ? <span>{t('gameRobloxFormat')}</span>
        : controls.map((control) => <span key={control}>{t(control === 'keys' ? 'gameControlKeys' : 'gameControlTouch')}</span>)}
    </div>
    {showDetails && <div className={styles.gameDetails}>
      <AuthoredContent data={data} fallback={opensSurface ? t('gameRobloxReady') : t('gameReady')} />
      {opensSurface && <div className={styles.pills}><span>{t('gameRobloxOpenIn')}</span></div>}
    </div>}
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
    <span className={styles.brainMarkerMark} aria-hidden><Icon source="✦" size="1em" /></span>
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
  onOpenBuiltinAgent?: (nodeId: string, intent: 'execute' | 'diagnostics') => void;
  /** Direct edits made on the card itself — a spreadsheet cell, a renamed
   * column, a rewritten paragraph — written back through the same path the
   * inspector uses. Absent when the board is read-only or lock-blocked, so an
   * editing control is never rendered where it would do nothing. */
  onEditData?: (nodeId: string, patch: Partial<CreationNodeData>) => void;
  /** Take the object away as a file, from the card that holds it. */
  onExport?: (nodeId: string, action: CanvasExportAction) => void;
  /**
   * Open one of the card's own panels BESIDE it. The anchor is a screen rect, not a
   * board coordinate: the panel is a fixed overlay, so it never has to be re-projected
   * through the viewport transform and it lands where the badge is regardless of zoom.
   */
  onOpenPanel?: (nodeId: string, panel: CanvasNodePanelId, anchor: DOMRect) => void;
  /** The `+`: choose what comes after this object, connected to it. */
  onInsertFrom?: (nodeId: string, anchor: DOMRect) => void;
  /** "Open this at full size" — reachable from the card's own header, not only from
   *  the object panel's. `CanvasObjectSurfaceButton` decides for itself whether this
   *  kind even has a surface, so a note or a task simply draws nothing here. */
  onOpenSurface?: (nodeId: string, surface: CanvasSurfaceId) => void;
  /** Put the reader in front of ANOTHER object — a drill-through, where a card
   *  can name the object it was derived from (a map marker → its source dataset).
   *  Selecting, clearing the inspector and flying the viewport are one call, so a
   *  card never spells out three of the four and forget the fourth. */
  onRevealObject?: (nodeId: string) => void;
  /**
   * A deal dragged into another stage on a pipeline card.
   *
   * Deliberately NOT `onEditData`: this does not patch the card, it moves the DEAL
   * and redraws the card from the same response — which is the whole mechanism
   * FO-F1 put in place of the mirroring instruction. Absent on a read-only board or
   * on one with no workspace behind it, which is what makes every card
   * non-draggable there rather than draggable-and-silently-inert.
   */
  onMoveDeal?: (nodeId: string, dealId: number, stage: string) => void;
  /**
   * Show ONE frame's section on its own — a canvas within a canvas.
   *
   * Deliberately not `onOpenSurface`: a surface is a different READING of the whole
   * board (a calendar, an app, a 3D space), and this is the same reading of less of
   * it. It is what replaced the modal workflow editor, which was a second canvas
   * over a board that already was one.
   */
  onOpenFrame?: (nodeId: string) => void;
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

/**
 * The neighbours a CROSS-OBJECT derivation reads — a gradebook's mean over the
 * submissions beside it, a submission's lateness against its assignment's deadline.
 *
 * ── WHY THIS IS GATED, AND HOW ──────────────────────────────────────────────────
 * Subscribing every card to every other card's data would re-render the whole board on
 * every keystroke, which is the fan-out the platform rejects in a request handler and is
 * no more acceptable here. So the selector returns a STABLE EMPTY ARRAY for any kind
 * whose spec declares no board-reading derivation — the overwhelming majority — and
 * those nodes never re-render for a neighbour's change at all.
 *
 * For the kinds that do read it, the comparison is per-element REFERENCE equality rather
 * than a serialisation: React Flow replaces a node's `data` object when it changes, so
 * identity is exactly the signal, and an O(N) reference scan is cheap where a
 * `JSON.stringify` of two hundred submissions on every store tick is not.
 */
const NO_NEIGHBOURS: readonly CreationNodeData[] = [];

function useBoardNeighbours(reads: boolean): readonly CreationNodeData[] {
  return useStore(
    (state) => {
      if (!reads) return NO_NEIGHBOURS;
      const out: CreationNodeData[] = [];
      for (const node of state.nodeLookup.values()) out.push(node.data as CreationNodeData);
      return out;
    },
    (left, right) => left === right || (left.length === right.length && left.every((item, index) => item === right[index])),
  );
}

/**
 * The board as a list of {id, data} — what a `calendar` card bound to the `board` source
 * projects into events.
 *
 * Gated exactly like {@link useBoardNeighbours} above and for the same reason: this is a
 * subscription to every node on the canvas, so a card that is not a board-bound calendar
 * must never take it. `enabled` is false for every other kind and for a calendar reading
 * any other source, and the stable empty array is what keeps those nodes out of the
 * re-render entirely.
 */
const NO_BOARD_OBJECTS: readonly { id: string; data: CreationNodeData }[] = [];

function useCalendarBoardObjects(enabled: boolean): readonly { id: string; data: CreationNodeData }[] {
  return useStore(
    (state) => {
      if (!enabled) return NO_BOARD_OBJECTS;
      const out: { id: string; data: CreationNodeData }[] = [];
      for (const node of state.nodeLookup.values()) out.push({ id: node.id, data: node.data as CreationNodeData });
      return out;
    },
    (left, right) => left === right
      || (left.length === right.length && left.every((item, index) => item.id === right[index]!.id && item.data === right[index]!.data)),
  );
}

/**
 * How many objects a frame currently holds.
 *
 * Gated exactly like {@link useBoardNeighbours} and {@link useCalendarBoardObjects}, and
 * for the same reason — this is a subscription to every node on the board, so every
 * card that is not a frame must never take it. It returns a NUMBER rather than the ids,
 * which is what keeps the comparison a primitive one: a frame re-renders when its count
 * changes and not when anything inside it is edited.
 *
 * A collapsed frame is measured at the size it was BEFORE it was put away
 * (`frameExpandedWidth/Height`). Measuring the chip instead would find nothing inside
 * it, and the count would read zero for exactly the state where it is the only thing
 * the card can say.
 */
function useFrameMemberCount(id: string, enabled: boolean): number {
  return useStore((state) => {
    if (!enabled) return 0;
    const boxes: FrameBox[] = [];
    for (const node of state.nodeLookup.values()) {
      // A store entry mid-transition (and a test double) can be missing `data`
      // entirely. A card that throws while COUNTING what a frame holds would take
      // the whole board down over a number, so an unreadable entry is simply not a
      // member — the count is a reading, not an invariant.
      const data = (node.data ?? {}) as CreationNodeData;
      if (typeof data.kind !== 'string') continue;
      const collapsed = data.kind === 'frame' && data.frameCollapsed === true;
      const expandedWidth = Number(data.frameExpandedWidth);
      const expandedHeight = Number(data.frameExpandedHeight);
      boxes.push({
        id: node.id,
        kind: data.kind,
        position: node.position,
        size: {
          width: collapsed && expandedWidth > 0 ? expandedWidth : (node.measured?.width ?? node.width ?? 260),
          height: collapsed && expandedHeight > 0 ? expandedHeight : (node.measured?.height ?? node.height ?? 150),
        },
        data: data as unknown as Record<string, unknown>,
      });
    }
    return frameMemberIds(id, boxes).length;
  });
}

function useSpecDeriveBoard(kind: CreationObjectKind): SpecDeriveBoard {
  const neighbours = useBoardNeighbours(specKindReadsBoard(kind));
  return useMemo(
    () => (neighbours.length ? makeSpecDeriveBoard(neighbours as unknown as Record<string, unknown>[]) : EMPTY_SPEC_BOARD),
    [neighbours],
  );
}

/**
 * The density toggle's glyph, which reports the CURRENT reading rather than the next one.
 *
 * A single chevron would have been cheaper and wrong: this is a three-position control, so
 * the mark has to say which of the three you are in — full rows, one row plus a rule, or a
 * dot — or the only way to know is to press it and watch.
 */
/** A clock, drawn at badge size. Not `Icon name="clock"` — this sits INSIDE a 26px
 *  circle that already carries a fill, so it needs a heavier stroke than the icon set's
 *  general-purpose glyph to survive at that size on a tinted plate. */
function ClockBadgeIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.9V8l2.2 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function DensityIcon({ density }: { density: CanvasNodeDensity }) {
  if (density === 'minimized') return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="3.1" fill="currentColor" />
  </svg>;
  if (density === 'preview') return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2.6" y="3.4" width="10.8" height="3" rx="1" fill="currentColor" />
    <path d="M2.6 9.6h10.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2.6" y="3" width="10.8" height="2.6" rx="1" fill="currentColor" />
    <rect x="2.6" y="6.8" width="10.8" height="2.6" rx="1" fill="currentColor" opacity=".55" />
    <rect x="2.6" y="10.6" width="10.8" height="2.6" rx="1" fill="currentColor" opacity=".3" />
  </svg>;
}

export function CreationNode({ id, data, selected, canRun = true, onRun, onOpenDetails, onOpenBuiltinAgent, onEditData, onExport, onOpenPanel, onInsertFrom, onOpenSurface, onRevealObject, onMoveDeal, onOpenFrame }: CreationNodeProps) {
  const t = useTranslations('creationCanvas.node');
  const specBoard = useSpecDeriveBoard(data.kind);
  const calendarBoard = useCalendarBoardObjects(data.kind === 'calendar' && data.source === 'board');
  const frameMemberCount = useFrameMemberCount(id, data.kind === 'frame');
  const isWide = ['workflow', 'website', 'prototype', 'guidedTour', 'dashboard', 'chart', 'map', 'report', 'evaluation', 'diagnostics', 'roadmap', 'slides', 'document', 'diagram', 'prd', 'knowledge', 'code', 'table', 'spreadsheet', 'featureSummary', 'mockupSet', 'evermind', 'projectComparison', 'frame', 'pitch', 'pitchScorecard', 'pitchQa', 'pitchApplication', 'course',
    // A model, a lineage flow and a check suite are all read across, not down.
    'erd', 'lineage', 'dataQuality', 'dataContract', 'datasource',
    // A step list beside a generated spec, and a per-case result table, are read
    // across the same way a check suite is.
    'testPlan', 'testCase', 'testRun', 'defect',
    // A game is played in its own body, so it needs the width a game needs.
    'game', 'resume',
    // Seven columns of day cells. A month at 240px is a grid of ellipses.
    'calendar'].includes(data.kind)
    || WEB_PAGE_KINDS.has(data.kind)
    // Every founder object that declares a `rows` field renders a table, and a table in
    // a 240px card is unreadable. Derived from the spec rather than listed, so a kind
    // that gains a table gains the width with it.
    || SPEC_WIDE_KINDS.has(data.kind);
  // Every kind with a body of its own. A kind missing from here renders its own
  // body AND the generic fallback underneath it — which is what all nine
  // creative kinds did: a studio tile followed by a second, redundant block
  // repeating the same authored text. They are folded in from the one set that
  // already lists them, so a new creative kind cannot reintroduce the same bug.
  const specialized = new Set(['workflow','website','build','prototype','guidedTour','dashboard','chart','map','report','evaluation','diagnostics','agent','staff','chat','dataset','table','spreadsheet','kpi','voice','video','note','project','roadmap','task','mockup','mockupSet','featureSummary','evermind','projectComparison','standup','drawing','frame','release','file','document','prd','knowledge','slides','diagram','pitch','pitchScorecard','pitchQa','pitchApplication','course','practice','game','resume','socialFeed','socialPost','socialCampaign','erd','datasource','dataContract','dataQuality','metric','lineage','testPlan','testCase','testRun','defect','sticky','timer','stopwatch','transclusion','component','flowStep', ...SPEC_KINDS, ...CREATIVE_STUDIO_KINDS, ...WEB_PAGE_KINDS]);
  const authoredSize = useAuthoredNodeSize(id);
  const frameStyle = data.kind === 'frame' ? { background: String(data.frameColor || AUTHORED_FRAME_FILL), borderColor: String(data.frameBorder || AUTHORED_FRAME_BORDER) } : undefined;
  // The author's pigment, applied the same way the frame's is. Both are colours a
  // PERSON chose and the board stores, which is why they arrive as inline style and
  // not as a theme token — see `authoredColors.ts`.
  const stickyStyle = data.kind === 'sticky' ? { background: String(data.stickyColor || STICKY_COLORS[0]) } : undefined;
  const cardStyle = { ...frameStyle, ...stickyStyle, ...authoredSize };
  // `data-testid` is per KIND, not per instance: a test asks for "the testCase card",
  // and an id built from the node's uuid would change every run. The instance is
  // addressed by `data-node-id` when a test needs a specific one, and both are what
  // `QaHeatZone.selector` finally has to key an element-level hot zone on — see the
  // seam note in CreationCanvas.
  /**
   * HOW MUCH OF THIS OBJECT TO DRAW.
   *
   * A board of fifteen cards each rendering four hundred words is a wall of documents
   * with the shape of the work invisible underneath it. `minimized` is the reading that
   * turns it back into a graph: the object's mark, its name, its badges and its
   * connectors, and no body at all.
   *
   * The rule lives in `lib/canvasNodeDensity.ts`; this only draws it.
   */
  /**
   * THE CARD'S OWN AFFORDANCES — schedule, messages, and what comes next.
   *
   * Built once and drawn on BOTH the card and the orb, because a minimised node is where
   * they matter most: an orb with a red badge is the only thing on a folded board that
   * says where the problem is. Everything about which badges exist and when is decided in
   * `lib/canvasNodeAffordances.ts`; this only draws them.
   */
  const messages = canvasNodeMessages(data, { emptyShell: emptyShellProblem(data.kind, data as Record<string, unknown>) !== null });
  const worstSeverity = canvasNodeWorstSeverity(messages);
  const schedule = canvasNodeSchedule(data);
  const openPanel = (panel: CanvasNodePanelId) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onOpenPanel?.(id, panel, event.currentTarget.getBoundingClientRect());
  };
  const affordances = onOpenPanel ? <span className={styles.nodeAffordances}>
    {/* The clock is on every step, lit when it is armed. Not conditional on there being
        a schedule: "this can run on its own" is a fact about every step, and hiding the
        control until a schedule exists is how a feature stays undiscovered. */}
    <button
      type="button"
      className={`${styles.nodeBadge} nodrag`}
      data-kind="schedule"
      data-on={schedule.enabled ? 'true' : 'false'}
      data-testid={`canvas-node-schedule-${id}`}
      aria-label={schedule.enabled ? t('scheduledEvery', { minutes: schedule.everyMinutes }) : t('scheduleThis')}
      title={schedule.enabled ? t('scheduledEvery', { minutes: schedule.everyMinutes }) : t('scheduleThis')}
      onClick={openPanel('schedule')}
    ><ClockBadgeIcon /></button>
    {/* Severity-coloured and COUNTED. A badge that says "2" without saying how bad is a
        badge you have to open to triage, which defeats putting it on the card. */}
    {worstSeverity && <button
      type="button"
      className={`${styles.nodeBadge} nodrag`}
      data-kind="messages"
      data-severity={worstSeverity}
      data-testid={`canvas-node-messages-${id}`}
      aria-label={t('messageCount', { count: messages.length })}
      title={t('messageCount', { count: messages.length })}
      onClick={openPanel('messages')}
    >{messages.length}</button>}
  </span> : null;

  // What comes AFTER this object. The board could only ever be built by prompting: there
  // was no way to say "and then this" without describing it in words and hoping.
  const insertButton = onInsertFrom ? <button
    type="button"
    className={`${styles.nodeInsert} nodrag`}
    data-testid={`canvas-node-insert-${id}`}
    aria-label={t('insertAfter', { title: data.title })}
    title={t('insertAfter', { title: data.title })}
    onClick={(event) => { event.stopPropagation(); onInsertFrom(id, event.currentTarget.getBoundingClientRect()); }}
  ><Icon name="plus" size={15} /></button> : null;

  const density = canvasNodeDensity(data);
  const densityAction = t(canvasNodeDensityActionKey(density) as 'toPreview');
  const densityToggle = onEditData ? <button
    type="button"
    className={`${styles.densityToggle} nodrag`}
    data-testid={`canvas-node-density-${id}`}
    aria-label={densityAction}
    title={densityAction}
    onClick={(event) => { event.stopPropagation(); onEditData(id, { density: nextCanvasNodeDensity(density) }); }}
  ><DensityIcon density={density} /></button> : null;

  // The mark, the name, the badges, the connectors. Drawn as its own element rather than
  // as a CSS treatment of the card, because a circle is not a small rectangle: the header
  // row, the resizer, the body and the status chip all have to be ABSENT, not hidden, or
  // React Flow keeps measuring a node the size of the card it is standing in for.
  if (density === 'minimized') return (
    <article
      data-testid={`canvas-node-${data.kind}`}
      data-node-id={id}
      data-node-kind={data.kind}
      data-density="minimized"
      className={`${styles.nodeOrb} ${selected ? styles.selected : ''}`}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <span className={styles.nodeOrbMark} style={data.accent ? { background: String(data.accent) } : undefined}>
        <Icon source={typeof data.toolIcon === 'string' ? data.toolIcon : creationObjectDefinition(data.kind).icon} size={30} />
      </span>
      {densityToggle}
      {affordances}
      {insertButton}
      <span className={styles.nodeOrbName}><b>{data.title}</b>{data.status && <small>{data.status}</small>}</span>
      {/* A step that DECIDES draws its continuations along the bottom, one per named
          outlet (see `FlowStepOutletRail`). It gets no right-hand handle at all, because
          it has no unconditional "and then" — offering one would let an author draw an
          arm the executor can never take, which is the failure outlets exist to end. */}
      {flowStepHasNamedOutlets(data)
        ? <FlowStepOutletRail data={data} />
        : <Handle type="source" position={Position.Right} className={styles.handle} />}
    </article>
  );

  return (
    <article style={cardStyle} data-testid={`canvas-node-${data.kind}`} data-node-id={id} data-node-kind={data.kind} data-viewport={data.viewport} data-density={density} className={`${styles.node} ${styles[`node_${data.kind}`]} ${selected ? styles.selected : ''} ${isWide ? styles.wideNode : ''}`}>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={130} lineClassName={styles.resizeLine} handleClassName={styles.resizeHandle} />
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <header className={styles.nodeHeader}>
        {typeof data.pipelineStep === 'number' && <span className={styles.pipelineStepBadge}>{data.pipelineStep}</span>}
        <span className={styles.nodeIcon}><Icon source={typeof data.toolIcon === 'string' ? data.toolIcon : creationObjectDefinition(data.kind).icon} size={18} /></span>
        <strong>{data.title}</strong>
        {data.status && <span className={styles.status}>{data.status}</span>}
        {affordances}
        {densityToggle}
        {onOpenPanel && <button
          type="button"
          className={`${styles.densityToggle} nodrag`}
          data-testid={`canvas-node-settings-${id}`}
          aria-label={t('openSettings', { title: data.title })}
          title={t('openSettings', { title: data.title })}
          onClick={openPanel(canvasNodeSettingsPanel(data.kind))}
        ><Icon name="settings" size={14} /></button>}
        {data.kind === 'workflow' && onRun && <button
          type="button"
          className={`${styles.workflowRunButton} nodrag nowheel`}
          disabled={!canRun}
          aria-label={t('runObject', { title: data.title })}
          onClick={(event) => { event.stopPropagation(); onRun(id); }}
        >{`${t('run')}`}</button>}
        {onOpenSurface && <CanvasObjectSurfaceButton
          data={data}
          onOpen={(surface) => onOpenSurface(id, surface)}
          className={`${styles.densityToggle} nodrag`}
        />}
        <button className={styles.moreButton} aria-label={t('moreOptions', { title: data.title })}>•••</button>
      </header>
      {insertButton}
      <div className={styles.nodeBody}>
        {typeof data.pipelineStep === 'number' && <div className={styles.pipelineNodeGuide} data-start={data.pipelineStart === true ? 'true' : 'false'}><b>{data.pipelineStart === true ? t('startHere') : t('stepOfFive', { step: data.pipelineStep })}</b><span>{String(data.pipelineInstruction || t('pipelineFallback'))}</span></div>}
        {data.kind === 'workflow' && <WorkflowBody data={data} />}
        {/* The REAL document, framed — not the board's own approximation of it. See
            `WebsiteFrame`: a card drawn as React inherited the app's tokens and theme, so
            a landing page turned dark when the operator toggled the canvas. `light` is
            pinned here because a thumbnail has no room for a mode control; the `site`
            surface is where the author checks the other one. */}
        {(data.kind === 'website' || data.kind === 'prototype') && <WebsiteFrame
          data={data}
          viewport={canvasViewport(data.viewport)}
          colorScheme="light"
          {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})}
        />}
        {data.kind === 'guidedTour' && <GuidedTourBody data={data} />}
        {data.kind === 'build' && <BuildBody data={data} />}
        {WEB_PAGE_KINDS.has(data.kind) && <CanvasWebPage
          data={data}
          {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})}
        />}
        {(data.kind === 'dashboard' || data.kind === 'chart' || data.kind === 'report') && <DashboardBody data={data} {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})} />}
        {/* One renderer for BOTH boards. A `fundingRound` whose `cards` were written by
            the raise projection (FO-E1) is a pipeline in every sense the kanban cares
            about — stages across, a deal at each intersection — and giving it a second
            component would be two answers to "how is a pipeline drawn". A round nobody
            has synced has no `cards` and falls through to its spec fields, unchanged. */}
        {(data.kind === 'salesPipeline' || (data.kind === 'fundingRound' && Array.isArray(data.cards) && data.cards.length > 0)) && <PipelineBoardBody
          data={data}
          {...(onMoveDeal ? { onMoveDeal: (dealId: number, stage: string) => onMoveDeal(id, dealId, stage) } : {})}
        />}
        {data.kind === 'map' && <MapBody
          data={data}
          {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})}
          {...(onRevealObject ? { onReveal: onRevealObject } : {})}
        />}
        {data.kind === 'evaluation' && <EvaluationBody data={data} onOpen={() => onOpenDetails?.(id, 'evaluation')} />}
        {data.kind === 'diagnostics' && (typeof data.toolId === 'string'
          ? <CanvasToolBody id={id} data={data} onEditData={onEditData} />
          : <DiagnosticsBody data={data} />)}
        {data.kind === 'agent' && <AgentBody data={data} onOpen={(focus) => onOpenDetails?.(id, focus)} onOpenBuiltin={(intent) => onOpenBuiltinAgent?.(id, intent)} />}
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
        {data.kind === 'erd' && <ErdBody data={data} />}
        {data.kind === 'datasource' && <DataSourceBody data={data} />}
        {data.kind === 'dataContract' && <DataContractBody data={data} />}
        {data.kind === 'dataQuality' && <DataQualityBody data={data} />}
        {data.kind === 'metric' && <MetricDefinitionBody data={data} />}
        {data.kind === 'lineage' && <LineageBody data={data} />}
        {data.kind === 'testPlan' && <TestPlanBody data={data} />}
        {data.kind === 'testCase' && <TestCaseBody data={data} />}
        {data.kind === 'testRun' && <TestRunBody data={data} />}
        {data.kind === 'defect' && <DefectBody data={data} />}
        {data.kind === 'voice' && <><div className={styles.waveform}>▂▅▃▆▂▇▅▃▆▂▅▇▃▆▂▅</div><AuthoredContent data={data} fallback={t('voiceFallback')} /></>}
        {data.kind === 'video' && <CanvasVideoEditor data={data} {...(onEditData ? { onEdit: (patch) => onEditData(id, patch) } : {})} />}
        {/* variant="card": the document only. Version, privacy, template, page setup and
            the AI tools all moved to the inspector's résumé section (opened by clicking
            this card — see `onNodeClick` and `ResumeInspectorSection` in
            CreationCanvas.tsx), so this no longer needs the tailor/detach/share
            callbacks that section uses instead. */}
        {data.kind === 'resume' && <CanvasResumeEditor variant="card" data={data} {...(onEditData ? { onEdit: (patch) => onEditData(id, patch) } : {})} />}
        {CREATIVE_STUDIO_KINDS.has(data.kind) && <CreativeStudioBody data={data} />}
        {data.kind === 'game' && <GameBody data={data} {...(onOpenSurface ? { onPlayFull: () => onOpenSurface(id, 'play') } : {})} />}
        {data.kind === 'note' && <AuthoredContent data={data} fallback={t('noteFallback')} />}
        {data.kind === 'sticky' && <StickyBody data={data} {...(onEditData ? { onEdit: (patch) => onEditData(id, patch) } : {})} />}
        {data.kind === 'project' && <ProjectBody data={data} />}
        {data.kind === 'roadmap' && <div className={styles.roadmap}>{(Array.isArray(data.items) && data.items.length ? data.items.slice(0, 12) : [{ title: 'Validate narrative', phase: 'Now' }, { title: 'Executive review', phase: 'Next' }, { title: 'Measure adoption', phase: 'Later' }]).map((raw, index) => { const item = asRecord(raw, { title: raw, phase: index < 2 ? 'Now' : 'Next' }); return <div key={`${String(item.title)}-${index}`}><b>{String(item.phase || item.status || t('phaseIndex', { index: index + 1 }))}</b><span>{String(item.title || item.name || t('itemIndex', { index: index + 1 }))}</span>{item.description ? <span>{String(item.description)}</span> : null}</div>; })}</div>}
        {data.kind === 'inbox' && <InboxBody data={data} />}
        {data.kind === 'email' && <EmailBody data={data} />}
        {data.kind === 'emailCampaign' && <EmailCampaignBody data={data} />}
        {data.kind === 'emailTemplate' && <EmailTemplateBody data={data} />}
        {data.kind === 'socialFeed' && <SocialFeedBody data={data} />}
        {data.kind === 'socialPost' && <SocialPostBody data={data} />}
        {data.kind === 'socialCampaign' && <SocialCampaignBody data={data} />}
        {data.kind === 'task' && <TaskBody data={data} />}
        {data.kind === 'mockup' && <MockupBody data={data} />}
        {data.kind === 'mockupSet' && <><div className={styles.mockupGrid}><i /><i /><i /></div><p>{Array.isArray(data.items) && data.items.length ? t('linkedConcepts', { count: data.items.length }) : t('mockupSetFallback')}</p><div className={styles.pills}><span>{t('expandable')}</span><span>{t('citationsRetained')}</span></div></>}
        {data.kind === 'featureSummary' && <div className={styles.featureGrid}>{(Array.isArray(data.items) && data.items.length ? data.items.map((item) => typeof item === 'string' ? item : String((item as Record<string, unknown>)?.title || (item as Record<string, unknown>)?.name || t('feature'))).slice(0, 20) : ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration']).map((feature, index) => <span key={`${feature}-${index}`}><b>{index + 1}</b>{feature}</span>)}</div>}
        {data.kind === 'evermind' && <EvermindBody data={data} />}
        {data.kind === 'course' && <CourseBody data={data} {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})} />}
        {data.kind === 'practice' && <PracticeBody data={data} {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})} />}
        {data.kind === 'projectComparison' && <ProjectComparisonBody data={data} />}
        {data.kind === 'pitch' && <PitchBody data={data} />}
        {data.kind === 'pitchScorecard' && <PitchScorecardBody data={data} />}
        {data.kind === 'pitchQa' && <PitchQaBody data={data} />}
        {data.kind === 'pitchApplication' && <PitchApplicationBody data={data} />}
        {data.kind === 'standup' && <StandupBody data={data} />}
        {data.kind === 'drawing' && <DrawingBody data={data} {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})} />}
        {data.kind === 'frame' && <FrameBody
          data={data}
          memberCount={frameMemberCount}
          {...(onEditData ? { onToggleCollapsed: () => onEditData(id, { frameCollapsed: data.frameCollapsed !== true }) } : {})}
          {...(onOpenFrame ? { onOpen: () => onOpenFrame(id) } : {})}
        />}
        {data.kind === 'flowStep' && <FlowStepBody data={data} />}
        {/* The two clocks, from ONE component: a countdown and a count-up are the same
            machine read from opposite ends. The `timer` kind shipped as a card with the
            string "05:00" in its status and no way to start it; this is the running
            clock the knowledge board had, on the canvas that is the front door. */}
        {(data.kind === 'timer' || data.kind === 'stopwatch') && <CanvasClockBody data={data} {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})} />}
        {/* Another document, shown here, LIVE — the knowledge board's `embed` block, and
            the second primitive that surface had and this one did not. */}
        {data.kind === 'transclusion' && <CanvasTransclusionBody data={data} />}
        {data.kind === 'component' && <CanvasComponentBody data={data} {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})} />}
        {data.kind === 'release' && <ReleaseBody data={data} onOpen={() => onOpenDetails?.(id, 'delivery')} />}
        {/* The month, at card size — the SAME component the full-screen surface mounts,
            with a different `variant`. There is no second calendar in this codebase to
            keep in step, which is the whole reason the rail modality became an object. */}
        {data.kind === 'calendar' && <CalendarObjectBody
          data={data}
          board={calendarBoard}
          {...(onEditData ? {
            onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch),
            onEditObject: onEditData,
          } : {})}
          {...(onRevealObject ? { onOpenObject: onRevealObject } : {})}
        />}
        {/* The one real UI control `legalDocument` needs beyond the stat rows
            SpecObjectBody already draws for it — see the component's own header
            for why this is a direct upload and not a BrainAction. */}
        {data.kind === 'legalDocument' && <CanvasLegalDocumentUpload objectId={id} data={data} {...(onEditData ? { onEdit: (patch: Partial<CreationNodeData>) => onEditData(id, patch) } : {})} />}
        {/* All seventeen founder kinds, from the one spec that declares their fields.
            See SpecObjectBody for why this is one branch and not forty-seven. */}
        <SpecObjectBody data={data} board={specBoard} />
        {!specialized.has(data.kind) && <><AuthoredContent data={data} fallback={t('objectReady', { label: creationObjectDefinition(data.kind).label })} /><div className={styles.pills}><span>{data.status || t('canvasObject')}</span><span>{t('liveSessionContext')}</span></div></>}
        {/* Every artifact leaves the board from the same place, in its own
            native formats. The row renders nothing for an object that is not a
            file — an agent, a frame, a timer — so it is safe to place once here
            rather than threaded into each body that happens to produce one. */}
        {onExport && <CanvasExportActions data={data} onExport={(action) => onExport(id, action)} />}
        {/* Listening to a card is placed exactly where taking it away is, and for
            the same reason: it belongs to any object that HAS words, so it is
            mounted once rather than threaded into each body. The control renders
            nothing when there is no prose to read. */}
        <ReadAloud text={canvasProseText(data)} className={styles.readAloudButton} />
      </div>
      {/* A step that DECIDES draws its continuations along the bottom, one per named
          outlet (see `FlowStepOutletRail`). It gets no right-hand handle at all, because
          it has no unconditional "and then" — offering one would let an author draw an
          arm the executor can never take, which is the failure outlets exist to end. */}
      {flowStepHasNamedOutlets(data)
        ? <FlowStepOutletRail data={data} />
        : <Handle type="source" position={Position.Right} className={styles.handle} />}
    </article>
  );
}
