/**
 * KIND → BODY, AS DATA.
 *
 * Which component draws the inside of a card is a row here, never a branch in
 * `CreationNode`: a new kind with a body of its own is one line in {@link ROWS}.
 *
 * ── WHY THIS IS NOT IN `creationObjectRegistry` ───────────────────────────────
 * `creationObjectRegistry.ts` is the same `CreationObjectKind` keyed the same way,
 * but it is a pure-data module that the AI contract, the palette, the persistence
 * layer and the tools all import without React. Putting components in it would make
 * every one of those import the whole card renderer — and close a static import cycle
 * back through this folder, which `check-frontend-architecture` refuses. So the
 * definition of a kind lives there and the drawing of it lives here, keyed alike.
 *
 * Every body is wrapped in `memo` once: its props are `{ id, data }`, and React Flow
 * replaces `data` only when the object changes, so dragging, selecting or editing a
 * neighbour no longer re-renders the inside of every card.
 */
import dynamic from 'next/dynamic';
import { memo, type ComponentType } from 'react';
import { WEB_PAGE_KINDS } from '@/lib/canvasWebPage';
import type { CreationObjectKind } from '../types';
import {
  DataContractBody,
  DataQualityBody,
  DataSourceBody,
  ErdBody,
  LineageBody,
  MetricDefinitionBody,
} from '../DataArchitectureViews';
import { DefectBody, TestCaseBody, TestPlanBody, TestRunBody } from '../QaObjectViews';
import { FlowStepBody } from '../FlowStepBody';
import { CanvasTransclusionBody } from '../CanvasTransclusionBody';
import type { CreationBodyProps } from './types';
import {
  CalendarBody, ClockBody, ComponentBody, DiagnosticsObjectBody, FrameObjectBody, LegalDocumentBody,
  ResumeBody, VideoBody, WebPageBody, WebsiteBody,
} from './adapters';
import { FeatureSummaryBody, MockupSetBody, NoteBody, RoadmapBody, StaffBody, VoiceBody } from './SimpleBodies';
import { AgentBody } from './AgentBody';
import { BrainObjectBody } from './BrainObjectBody';
import { BuildBody } from './BuildBody';
import { CourseBody } from './CourseBody';
import { CREATIVE_STUDIO_KINDS, CreativeStudioBody } from './CreativeStudioBody';
import { DashboardBody } from './DashboardBody';
import { DataGridBody } from './DataGridBody';
import { DocumentBody } from './DocumentBody';
import { DrawingBody } from './DrawingBody';
import { EmailBody } from './EmailBody';
import { EmailCampaignBody } from './EmailCampaignBody';
import { EmailTemplateBody } from './EmailTemplateBody';
import { EvaluationBody } from './EvaluationBody';
import { EvermindBody } from './EvermindBody';
import { FileBody } from './FileBody';
import { GameBody } from './GameBody';
import { GuidedTourBody } from './GuidedTourBody';
import { InboxBody } from './InboxBody';
import { KpiBody } from './KpiBody';
import { MapBody } from './MapBody';
import { MockupBody } from './MockupBody';
import { FundingRoundBody, PipelineBoardBody } from './PipelineBoardBody';
import { PitchApplicationBody } from './PitchApplicationBody';
import { PitchBody } from './PitchBody';
import { PitchQaBody } from './PitchQaBody';
import { PitchScorecardBody } from './PitchScorecardBody';
import { PracticeBody } from './PracticeBody';
import { ProjectBody } from './ProjectBody';
import { ProjectComparisonBody } from './ProjectComparisonBody';
import { ReleaseBody } from './ReleaseBody';
import { SlidesBody } from './SlidesBody';
import { SocialCampaignBody } from './SocialCampaignBody';
import { SocialFeedBody } from './SocialFeedBody';
import { SocialPostBody } from './SocialPostBody';
import { StandupBody } from './StandupBody';
import { StickyBody } from './StickyBody';
import { TaskBody } from './TaskBody';
import { WorkflowBody } from './WorkflowBody';

type CreationBody = ComponentType<CreationBodyProps>;

/**
 * Loaded on first draw rather than with the board: most boards never hold a diagram,
 * and its SVG renderer is code no other card needs. (The diagnostics tool runner is
 * deferred the same way, in `adapters.tsx`.) Bodies whose libraries `CreationCanvas`
 * already imports for its own tools — the map, the sheet, the game, the drawing, the
 * dashboard, the document — would save almost nothing by being deferred and would pop
 * in a frame late, so they stay static.
 */
const DiagramBody = dynamic(() => import('./DiagramBody').then((module) => module.DiagramBody), { ssr: false });

/** Object kinds whose body IS a document. Registry kinds, so a new document-like
 * object is a one-line addition rather than three separate lists. */
const DOCUMENT_BODY_KINDS: readonly CreationObjectKind[] = ['document', 'prd', 'knowledge'];

const ROWS: ReadonlyArray<readonly [Iterable<CreationObjectKind>, CreationBody]> = [
  [['workflow'], WorkflowBody],
  [['website', 'prototype'], WebsiteBody],
  [['guidedTour'], GuidedTourBody],
  [['build'], BuildBody],
  [WEB_PAGE_KINDS, WebPageBody],
  [['dashboard', 'chart', 'report'], DashboardBody],
  [['salesPipeline'], PipelineBoardBody],
  [['fundingRound'], FundingRoundBody],
  [['map'], MapBody],
  [['evaluation'], EvaluationBody],
  [['diagnostics'], DiagnosticsObjectBody],
  [['agent'], AgentBody],
  [['staff'], StaffBody],
  [['chat'], BrainObjectBody],
  [['dataset', 'table', 'spreadsheet'], DataGridBody],
  [DOCUMENT_BODY_KINDS, DocumentBody],
  [['slides'], SlidesBody],
  [['diagram'], DiagramBody],
  [['file'], FileBody],
  [['kpi'], KpiBody],
  [['erd'], ErdBody],
  [['datasource'], DataSourceBody],
  [['dataContract'], DataContractBody],
  [['dataQuality'], DataQualityBody],
  [['metric'], MetricDefinitionBody],
  [['lineage'], LineageBody],
  [['testPlan'], TestPlanBody],
  [['testCase'], TestCaseBody],
  [['testRun'], TestRunBody],
  [['defect'], DefectBody],
  [['voice'], VoiceBody],
  [['video'], VideoBody],
  [['resume'], ResumeBody],
  [CREATIVE_STUDIO_KINDS, CreativeStudioBody],
  [['game'], GameBody],
  [['note'], NoteBody],
  [['sticky'], StickyBody],
  [['project'], ProjectBody],
  [['roadmap'], RoadmapBody],
  [['inbox'], InboxBody],
  [['email'], EmailBody],
  [['emailCampaign'], EmailCampaignBody],
  [['emailTemplate'], EmailTemplateBody],
  [['socialFeed'], SocialFeedBody],
  [['socialPost'], SocialPostBody],
  [['socialCampaign'], SocialCampaignBody],
  [['task'], TaskBody],
  [['mockup'], MockupBody],
  [['mockupSet'], MockupSetBody],
  [['featureSummary'], FeatureSummaryBody],
  [['evermind'], EvermindBody],
  [['course'], CourseBody],
  [['practice'], PracticeBody],
  [['projectComparison'], ProjectComparisonBody],
  [['pitch'], PitchBody],
  [['pitchScorecard'], PitchScorecardBody],
  [['pitchQa'], PitchQaBody],
  [['pitchApplication'], PitchApplicationBody],
  [['standup'], StandupBody],
  [['drawing'], DrawingBody],
  [['frame'], FrameObjectBody],
  [['flowStep'], FlowStepBody],
  [['timer', 'stopwatch'], ClockBody],
  // Another document, shown here, LIVE — the knowledge board's `embed` block, and
  // the second primitive that surface had and this one did not.
  [['transclusion'], CanvasTransclusionBody],
  [['component'], ComponentBody],
  [['release'], ReleaseBody],
  [['calendar'], CalendarBody],
  [['legalDocument'], LegalDocumentBody],
];

function bodyTable(rows: typeof ROWS): Partial<Record<CreationObjectKind, CreationBody>> {
  const memoized = new Map<CreationBody, CreationBody>();
  const table: Partial<Record<CreationObjectKind, CreationBody>> = {};
  for (const [kinds, body] of rows) {
    let drawn = memoized.get(body);
    if (!drawn) { drawn = memo(body); memoized.set(body, drawn); }
    for (const kind of kinds) table[kind] = drawn;
  }
  return table;
}

export const CREATION_BODIES: Partial<Record<CreationObjectKind, CreationBody>> = bodyTable(ROWS);

/**
 * Kinds that draw their own body AND the generic authored-text fallback beneath it.
 *
 * A kind with a body normally replaces the fallback — the bug where all nine creative
 * kinds drew a studio tile followed by a redundant block repeating the same text is
 * what that rule ended. These kinds were never folded into it, so they still draw both,
 * exactly as before this table existed. (Spec kinds are excluded upstream either way.)
 */
export const KEEPS_GENERIC_FALLBACK: ReadonlySet<CreationObjectKind> = new Set([
  'inbox', 'email', 'emailCampaign', 'emailTemplate', 'salesPipeline', 'fundingRound', 'calendar', 'legalDocument',
]);
