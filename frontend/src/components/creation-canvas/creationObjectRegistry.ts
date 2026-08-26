import type { CreationNodeData, CreationObjectKind } from './types';
import { BRAND_BINDING_FIELD, CREATION_CONNECTION_KINDS, defaultConfidentialityForKind, isBrandBoundKind, emptyCanvasVideoTimeline, emptyCanvasWorldScene, emptyCanvasSceneSpec, FOUNDER_OBJECT_KINDS, type AcademicObjectKind, type CareerObjectKind, type CreationConnectionKind, type DataScienceObjectKind, type FounderObjectKind, type HiringObjectKind, type LegalObjectKind, type MarketingObjectKind, type OperationsObjectKind, type PeopleObjectKind, type SellMotionObjectKind, type SharedObjectKind } from '@builderforce/creation-canvas-contract';
import { FOUNDER_BOOKKEEPING_FIELDS, FOUNDER_FIELD_NAMES, FOUNDER_OBJECT_SPECS, founderMutableFields } from '@/lib/founderObjects';
// Importing the vocabulary registers it (see `specObjects.ts`), which is what makes the
// academic kinds resolvable everywhere else without a second list of them here.
import { ACADEMIC_OBJECT_SPECS } from '@/lib/academicObjects';
// The recruiter's funnel, and the cross-domain kinds that belong to no single family.
// Importing them registers their vocabularies for exactly the reason the academic
// import above does.
import { HIRING_OBJECT_SPECS } from '@/lib/hiringObjects';
// HR operations and the `form` collection primitive. Hiring and people operations are two
// vocabularies with two owning agents (Recruiter, HR) — see `people.ts` — so they register
// separately for the same reason the academic and founder sets do.
import { PEOPLE_OBJECT_SPECS } from '@/lib/peopleObjects';
import { SHARED_OBJECT_SPECS } from '@/lib/sharedCanvasObjects';
// The field operation — the work a vertical company sells. Imported for the same
// registration side effect as the vocabularies above.
import { OPERATIONS_OBJECT_SPECS } from '@/lib/operationsObjects';
// The commercial half of "idea to real" — quote, sequence, call, trial, trust packet,
// mutual action plan. Imported for the same registration side effect as every vocabulary
// above; see `sellMotion.ts` for why these six are not more `sales*` kinds.
import { SELL_MOTION_OBJECT_SPECS } from '@/lib/sellMotionObjects';
// The Models group. Imported for the same registration side effect as every vocabulary
// above — and it is what gives `llm` a `derive` hook, so its projected monthly cost is
// computed from its own rate card instead of typed on top of it.
import { MODEL_OBJECT_SPECS } from '@/lib/modelObjects';
import { specBookkeepingFields, specFieldNames, type SpecDeriveBoard } from '@/lib/specObjects';
import {
  ACADEMIC_MUTABLE_FIELDS, ACADEMIC_REGISTRY, FOUNDER_MUTABLE_FIELDS, FOUNDER_REGISTRY,
  CAREER_MUTABLE_FIELDS, CAREER_REGISTRY,
  HIRING_MUTABLE_FIELDS, HIRING_REGISTRY, PEOPLE_MUTABLE_FIELDS, PEOPLE_REGISTRY,
  SHARED_MUTABLE_FIELDS, SHARED_REGISTRY, SPEC_ACTIONS,
  DATA_SCIENCE_MUTABLE_FIELDS, DATA_SCIENCE_REGISTRY,
  OPERATIONS_MUTABLE_FIELDS, OPERATIONS_REGISTRY,
  LEGAL_MUTABLE_FIELDS, LEGAL_REGISTRY,
  SELL_MOTION_MUTABLE_FIELDS, SELL_MOTION_REGISTRY,
  MODEL_MUTABLE_FIELDS, MODEL_REGISTRY,
  MARKETING_MUTABLE_FIELDS, MARKETING_REGISTRY,
} from './specDerivedRegistry';
import {
  DATA_ARCHITECTURE_FIELD_NAMES, DATA_ARCHITECTURE_SPECS, dataArchitectureMutableFields, dataArchitectureSeed,
  type DataArchitectureKind,
} from '@/lib/dataArchitectureObjects';
import { MAX_TABULAR_COLUMNS } from '@/lib/canvasTabularData';
// The sticky palette. It used to be imported from the knowledge board, which owned it
// first; that board has folded into this one and the pigments moved to `authoredColors`,
// where every value a PERSON picks and the object stores verbatim already lives.
import { STICKY_COLORS } from '@/domains/canvas/domain/authoredColors';
import { DEFAULT_TIMER_MS } from './CanvasClockBody';
import { DEFAULT_MODALITY } from '@/lib/modality';
import { DEFAULT_PITCH_COMPETITION_ID } from '@/lib/pitchCompetition';
import { COURSE_EXPORT_STANDARDS, emptyCourse } from '@/lib/courseLms';
import { defaultCanvasTourDesign } from '@/lib/onboarding/canvasTourDesign';

// The union moved to `types.ts` so the derivation layer can be typed without importing
// the registry it feeds. Re-exported here because every existing consumer imports it
// from this module, and one canonical declaration with one import path is the point.
export type { CreationObjectGroup } from './types';
import type { CreationObjectGroup } from './types';

export interface CreationObjectDefinition {
  kind: CreationObjectKind;
  label: string;
  icon: string;
  group: CreationObjectGroup;
  createData: () => CreationNodeData;
  capability?: string;
  renderer: 'creation';
  inspector: 'creation';
  actions: readonly string[];
  /** Content fields Brain may author for this object kind. Common identity fields
   * (title, subtitle, status) are added automatically. */
  mutableFields: readonly string[];
  allowedConnections: readonly CreationConnectionKind[];
  /**
   * A kind that still RESOLVES but is no longer CREATABLE.
   *
   * `creationObjectDefinition()` throws on an unknown kind, so a kind that saved boards
   * still contain has to stay in the registry to be rendered, named and inspected. What
   * a legacy kind loses is the PALETTE: nothing new may author one. "Does this kind
   * exist" and "may somebody place it" were the same question while every kind was
   * both, and this is where they part.
   */
  legacy?: boolean;
  /** The AI snapshot of one object. `board` is what its COMPUTED fields read — a
   *  gradebook's mean comes from the submissions beside it — and is optional so a
   *  single-object read stays a one-argument call. See `creationObjectContext`. */
  contextAdapter: (data: CreationNodeData, board?: SpecDeriveBoard) => Record<string, unknown>;
}
type BaseCreationObjectDefinition = Pick<CreationObjectDefinition, 'kind' | 'label' | 'icon' | 'group' | 'createData'> & Partial<Pick<CreationObjectDefinition, 'legacy'>>;

const BASE_CREATION_OBJECT_REGISTRY = [
  /**
   * THE OLD SHAPE — RESOLVABLE, NOT CREATABLE.
   *
   * A `workflow` card stood in for a graph that lived somewhere else, and the only
   * editor it ever had was a modal that has since been deleted. Placing one today would
   * mint an object nobody can author, so it is off the palette (`legacy`). The KIND
   * stays registered because every board saved before this still holds one and has to
   * render, name and inspect it; its own action is now "Open on canvas", which replaces
   * the card with the section it was always standing in for (`unpackWorkflow`).
   *
   * A flow is authored as `flowStep` objects inside a frame — the entry below.
   */
  { kind: 'workflow', label: 'Workflow', icon: '⌘', group: 'Build', legacy: true, createData: () => ({ kind: 'workflow', title: 'Untitled workflow', status: 'Draft' }) },
  // ONE executable step. It is placed from the STEP catalog rather than from this
  // palette entry — the picker offers all ~60 kinds and seeds `stepKind` (see
  // `flowStepObject.ts`) — so the entry here exists to give the kind a label, an
  // icon and a group everywhere an object is named rather than drawn. A bare one
  // defaults to the step that needs no configuration to mean something.
  { kind: 'flowStep', label: 'Step', icon: '▸', group: 'Build', createData: () => ({ kind: 'flowStep', title: 'Step', stepKind: 'agent', stepConfig: { role: 'code-creator', task: '' }, stepInputs: [], stepOutputs: [] }) },
  { kind: 'website', label: 'Website', icon: '◎', group: 'Build', createData: () => ({ kind: 'website', title: 'Website concept', status: 'Draft' }) },
  { kind: 'build', label: 'Builder', icon: '▶', group: 'Build', createData: () => ({ kind: 'build', title: 'New build', status: 'Choose a type', modality: DEFAULT_MODALITY }) },
  { kind: 'chat', label: 'Chat', icon: '●', group: 'Build', createData: () => ({ kind: 'chat', title: 'Brain' }) },
  // Data, not Build. Every object derived from a dataset — table, chart, map,
  // KPI — has always lived in the Data group; the one true ingestion object was
  // the only thing missing from the palette a data question starts in.
  { kind: 'dataset', label: 'Dataset', icon: '▤', group: 'Data', createData: () => ({ kind: 'dataset', title: 'Imported dataset.csv' }) },
  // The semantic layer: the DEFINITION of a number, which a `liveMetric` reading
  { kind: 'table', label: 'Table', icon: '▦', group: 'Data', createData: () => ({ kind: 'table', title: 'Data table', status: 'Draft' }) },
  { kind: 'spreadsheet', label: 'Spreadsheet', icon: '▤', group: 'Data', createData: () => ({ kind: 'spreadsheet', title: 'Untitled spreadsheet', status: 'Draft' }) },
  { kind: 'chart', label: 'Chart', icon: '▥', group: 'Data', createData: () => ({ kind: 'chart', title: 'Data visualization', status: 'Connect a dataset' }) },
  { kind: 'map', label: 'Map', icon: '◍', group: 'Data', createData: () => ({ kind: 'map', title: 'Map', status: 'Plot a dataset' }) },
  // 'Live' was the default status on a KPI with no value, no target and no unit — the
  // card asserted it was tracking something the moment it existed. Same defect the
  // workflow above records: an empty card that reads as a configured one. A metric is
  // Live once it HAS a number; before that it is what it is.
  { kind: 'kpi', label: 'KPI', icon: '↗', group: 'Data', createData: () => ({ kind: 'kpi', title: 'Key metric', status: 'No value yet' }) },
  { kind: 'dashboard', label: 'Dashboard', icon: '▥', group: 'Insights', createData: () => ({ kind: 'dashboard', title: 'Performance dashboard' }) },
  { kind: 'report', label: 'Report', icon: '▤', group: 'Insights', createData: () => ({ kind: 'report', title: 'Live report', status: 'Draft' }) },
  { kind: 'evaluation', label: 'Evaluation', icon: '✦', group: 'Insights', createData: () => ({ kind: 'evaluation', title: 'Canvas evaluation', status: 'AI evaluation' }) },
  { kind: 'projectComparison', label: 'Comparison', icon: '≈', group: 'Insights', createData: () => ({ kind: 'projectComparison', title: 'Project comparison', status: 'Add two projects', projects: [], sources: [] }) },
  { kind: 'roadmap', label: 'Roadmap', icon: '↗', group: 'Insights', createData: () => ({ kind: 'roadmap', title: 'Executive sales roadmap', status: 'Draft' }) },
  { kind: 'note', label: 'Note', icon: '◇', group: 'Insights', createData: () => ({ kind: 'note', title: 'Note', subtitle: 'Add context for your collaborators.' }) },
  { kind: 'prototype', label: 'WYSIWYG', icon: '▣', group: 'Build', createData: () => ({ kind: 'prototype', title: 'Interactive prototype', status: 'Draft' }) },
  { kind: 'guidedTour', label: 'Guided tour', icon: '◉', group: 'Build', createData: () => ({ kind: 'guidedTour', title: 'Product onboarding tour', status: 'Draft · 2 steps', tour: defaultCanvasTourDesign() }) },
  { kind: 'code', label: 'Code', icon: '</>', group: 'Build', createData: () => ({ kind: 'code', title: 'Code workspace', status: 'Draft' }) },
  // Browser / URL / Local service all render the SAME live page panel — they
  // differ only in where the address comes from (typed, dropped, or forwarded
  // from the VS Code host), not in what the object is once it has one.
  { kind: 'browser', label: 'Browser preview', icon: '◎', group: 'Build', createData: () => ({ kind: 'browser', title: 'Live preview', status: 'Ready', url: '', viewport: 'desktop' }) },
  { kind: 'repository', label: 'Repository', icon: '⑂', group: 'Build', createData: () => ({ kind: 'repository', title: 'Source repository', status: 'Linked from VS Code' }) },
  { kind: 'selection', label: 'Editor selection', icon: '⌗', group: 'Build', createData: () => ({ kind: 'selection', title: 'Editor selection', status: 'Referenced from VS Code' }) },
  { kind: 'diagnostics', label: 'Diagnostics', icon: '⚠', group: 'Build', createData: () => ({ kind: 'diagnostics', title: 'Editor diagnostics', status: 'Ready to run', diagnostics: [], results: [], nextSteps: [] }) },
  { kind: 'terminal', label: 'Terminal output', icon: '>_', group: 'Build', createData: () => ({ kind: 'terminal', title: 'Terminal output', status: 'Review for secrets' }) },
  { kind: 'service', label: 'Local service', icon: '◎', group: 'Build', createData: () => ({ kind: 'service', title: 'Local service', status: 'Preview from VS Code' }) },
  // The delivery lifecycle, as its own kinds rather than degrading to `note` — see
  // `MUTABLE_FIELDS` below for what each carries and `canvasKindSettings.delivery.ts`
  // for their settings. `deployment`/`ciRun` are the two with a real backing table
  // (`deployment_events`, already feeding DORA) to eventually sync from; the rest are
  // authored/referenced the same way `repository`/`release` are today.
  { kind: 'pullRequest', label: 'Pull request', icon: '⑂', group: 'Build', createData: () => ({ kind: 'pullRequest', title: 'Pull request', status: 'open' }) },
  { kind: 'ciRun', label: 'CI run', icon: '▷', group: 'Build', createData: () => ({ kind: 'ciRun', title: 'CI run', status: 'queued' }) },
  { kind: 'deployment', label: 'Deployment', icon: '▲', group: 'Build', createData: () => ({ kind: 'deployment', title: 'Deployment', status: 'pending' }) },
  // Named `productionIncident`, not `incident` — see the contract's kind-list note for
  // why (Operations already owns `incident` for a field-service/safety report).
  { kind: 'productionIncident', label: 'Production incident', icon: '⚑', group: 'Build', createData: () => ({ kind: 'productionIncident', title: 'Production incident', status: 'investigating', severity: 'medium' }) },
  // Mirrors `pmoApi.rollup()` onto the board — see the contract's kind-list note for why
  // it is `deliveryRollup` and not `delivery`. `scopeKind`/`scopeId` name WHAT it mirrors;
  // everything else is written by the `refresh` action, never authored.
  { kind: 'deliveryRollup', label: 'Delivery rollup', icon: '◈', group: 'Work', createData: () => ({ kind: 'deliveryRollup', title: 'Delivery rollup', status: 'Not loaded', scopeKind: 'workspace', scopeId: null }) },
  { kind: 'environment', label: 'Environment', icon: '◈', group: 'Build', createData: () => ({ kind: 'environment', title: 'Environment', status: 'active' }) },
  // `llm` moved to the Models VOCABULARY (`lib/modelObjects.ts`) — see its header.
  // A course knows its SUBJECT, and Brain writes the rest. It used to be created
  // as `buildLlmCourse()` — so every course object on the platform, whatever it
  // was dragged out for, arrived as the same five modules about tokenizers and
  // red-teaming and had to be deleted before anyone could study anything else.
  // The worked LLM course is still shipped, as what it always was: the example
  // behind the "LLM Builder Academy" template that advertises it.
  { kind: 'course', label: 'Course', icon: '▰', group: 'Knowledge', createData: () => ({ kind: 'course', title: 'New course', status: 'Choose a subject', subtitle: 'Name what you want to learn — Brain writes the lessons, the practice and the knowledge checks.', course: emptyCourse(), exportStandards: COURSE_EXPORT_STANDARDS }) },
  // Practice is the half of learning the canvas could not do: answer, find out,
  // try again, and have the board remember which ones you keep missing. The
  // attempt record lives on the object and is deliberately absent from
  // MUTABLE_FIELDS below — see lib/canvasPractice.ts.
  { kind: 'practice', label: 'Practice', icon: '◐', group: 'Knowledge', createData: () => ({ kind: 'practice', title: 'Practice set', status: 'Add questions', practiceMode: 'quiz', questions: [], attempts: [] }) },
  // ── Quality ──────────────────────────────────────────────────────────────
  // A plan is the INTENT and the gate; the cases are their own objects, joined to
  // it by membership, so one case can be edited, run and pointed at the thing it
  // verifies without the plan being rewritten. `status` says what the plan holds,
  // never that it passed — a gate that reports before it has evidence is the
  // failure mode `planGateVerdict` returns `pending` for.
  { kind: 'testPlan', label: 'Test plan', icon: '⛉', group: 'Quality', createData: () => ({ kind: 'testPlan', title: 'Test plan', status: 'Name a target', targetUrl: '', routes: [], exitCriteria: {}, signOffs: [] }) },
  { kind: 'testCase', label: 'Test case', icon: '✓', group: 'Quality', createData: () => ({ kind: 'testCase', title: 'Test case', status: 'Not run', steps: [], spec: '', priority: 'normal' }) },
  // Empty on purpose (see SHELL_IS_LEGITIMATE): a run is written BY a run.
  { kind: 'testRun', label: 'Test run', icon: '▷', group: 'Quality', createData: () => ({ kind: 'testRun', title: 'Test run', status: 'Not started', results: [] }) },
  { kind: 'defect', label: 'Defect', icon: '⚑', group: 'Quality', createData: () => ({ kind: 'defect', title: 'Defect', status: 'open', severity: 'medium', defectType: 'assertion', expected: '', actual: '', reproSteps: [] }) },
  { kind: 'project', label: 'Project', icon: '▦', group: 'Work', createData: () => ({ kind: 'project', title: 'BuilderForce launch', status: 'Not linked', subtitle: 'Search for a canonical project in the inspector.' }) },
  { kind: 'salesPipeline', label: 'Sales pipeline', icon: '↗', group: 'Work', createData: () => ({ kind: 'salesPipeline', title: 'Sales pipeline', status: 'Live', stages: ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won'] }) },
  { kind: 'salesCampaign', label: 'Sales campaign', icon: '◎', group: 'Work', createData: () => ({ kind: 'salesCampaign', title: 'New campaign', status: 'Draft' }) },
  { kind: 'salesContact', label: 'Sales contact', icon: '●', group: 'People', createData: () => ({ kind: 'salesContact', title: 'New contact', status: 'New', stage: 'new' }) },
  { kind: 'targetMarket', label: 'Target market', icon: '◇', group: 'Insights', createData: () => ({ kind: 'targetMarket', title: 'Target market', status: 'Researching' }) },
  { kind: 'salesGoal', label: 'Weekly sales goal', icon: '✓', group: 'Insights', createData: () => ({ kind: 'salesGoal', title: 'Weekly goals', status: 'Active', outreachTarget: 50, contactsTarget: 20, meetingsTarget: 3 }) },
  { kind: 'salesMeeting', label: 'Sales meeting', icon: '◷', group: 'Collaborate', createData: () => ({ kind: 'salesMeeting', title: 'Sales meeting', status: 'Needs scheduling', durationMinutes: 30 }) },
  // An `inbox` is a LIVE filtered view of a connected mailbox — it re-reads.
  // `messages` holds the last read so the tile is not blank while it refreshes,
  // and `filter` is what makes "show me unread mail from Acme" a persistent
  // object on the board rather than a one-off answer in chat.
  { kind: 'inbox', label: 'Inbox', icon: '✉', group: 'Integrations', createData: () => ({ kind: 'inbox', title: 'Inbox', status: 'Connect a mailbox', messages: [], filter: {} }) },
  // One message, PINNED. It stops changing, which is the point: it can be
  // annotated and connected to a task, and it is still there tomorrow after it
  // has scrolled out of the live view.
  // "Pinned from inbox" is true of an email `canvas_pin_email` created and false of one
  // dragged out of the palette or authored by a turn — which is the majority now that
  // the details panel composes and sends. A card must not claim a provenance it does
  // not have.
  { kind: 'email', label: 'Email', icon: '✉', group: 'Integrations', createData: () => ({ kind: 'email', title: 'Email', status: 'Draft' }) },
  { kind: 'emailCampaign', label: 'Email campaign', icon: '◎', group: 'Integrations', createData: () => ({ kind: 'emailCampaign', title: 'New campaign', status: 'Draft', transport: 'platform' }) },
  { kind: 'emailTemplate', label: 'Email template', icon: '▤', group: 'Integrations', createData: () => ({ kind: 'emailTemplate', title: 'Email template', status: 'Draft', mergeFields: [] }) },
  // The social trio, mirroring inbox/email/emailCampaign for the same reasons.
  // A `socialFeed` is LIVE and merged across networks — it stores the FILTER it was
  // created with, which is what makes "our LinkedIn posts this month" a reproducible
  // object on the board rather than a one-off answer in chat.
  { kind: 'socialFeed', label: 'Social feed', icon: '◈', group: 'Integrations', createData: () => ({ kind: 'socialFeed', title: 'Social feed', status: 'Connect an account', posts: [], filter: {} }) },
  // One post, PINNED. It stops changing, which is the point: it can be annotated,
  // connected to a task, and compared against what came after it.
  { kind: 'socialPost', label: 'Social post', icon: '●', group: 'Integrations', createData: () => ({ kind: 'socialPost', title: 'Social post', status: 'Pinned from feed' }) },
  { kind: 'socialCampaign', label: 'Social campaign', icon: '◎', group: 'Integrations', createData: () => ({ kind: 'socialCampaign', title: 'New social campaign', status: 'Draft', targets: [], variants: {} }) },
  { kind: 'task', label: 'Task', icon: '✓', group: 'Work', createData: () => ({ kind: 'task', title: 'Build approved mockup', status: 'Ready', role: 'Campaign Strategist' }) },
  { kind: 'prd', label: 'PRD', icon: '▤', group: 'Work', createData: () => ({ kind: 'prd', title: 'Product requirements', status: 'Draft' }) },
  { kind: 'release', label: 'Release', icon: '◆', group: 'Work', createData: () => ({ kind: 'release', title: 'Release plan', status: 'Planning' }) },
  { kind: 'mockup', label: 'Mockup', icon: '▣', group: 'Work', createData: () => ({ kind: 'mockup', title: 'Interactive feature mockup', status: 'Draft' }) },
  { kind: 'mockupSet', label: 'Mockup set', icon: '▦', group: 'Work', createData: () => ({ kind: 'mockupSet', title: 'Feature mockup set', status: 'Expandable', items: [] }) },
  { kind: 'featureSummary', label: 'Feature summary', icon: '★', group: 'Work', createData: () => ({ kind: 'featureSummary', title: 'Top 10 requested features', status: 'Synthesized' }) },
  // A pitch competition is four artifacts, not one deck: the timed story, the
  // published rubric you are scored against, the judge Q&A that follows it, and
  // the written entry that decides whether you get on stage at all. Each opens
  // pre-loaded from the competition preset in `pitchCompetition.ts`, so a blank
  // card already knows the rules it has to satisfy.
  { kind: 'pitch', label: 'Pitch', icon: '◈', group: 'Pitch', createData: () => ({ kind: 'pitch', title: 'Competition pitch', status: 'Draft', competitionId: DEFAULT_PITCH_COMPETITION_ID }) },
  { kind: 'pitchScorecard', label: 'Pitch scorecard', icon: '★', group: 'Pitch', createData: () => ({ kind: 'pitchScorecard', title: 'Judging scorecard', status: 'Not scored', competitionId: DEFAULT_PITCH_COMPETITION_ID }) },
  { kind: 'pitchQa', label: 'Judge Q&A', icon: '◷', group: 'Pitch', createData: () => ({ kind: 'pitchQa', title: 'Judge Q&A drill', status: 'Not rehearsed', competitionId: DEFAULT_PITCH_COMPETITION_ID }) },
  { kind: 'pitchApplication', label: 'Competition entry', icon: '▤', group: 'Pitch', createData: () => ({ kind: 'pitchApplication', title: 'Competition entry', status: 'Draft', competitionId: DEFAULT_PITCH_COMPETITION_ID }) },
  { kind: 'staff', label: 'Staff member', icon: '●', group: 'People', createData: () => ({ kind: 'staff', title: 'Teammate', role: 'Contributor', focus: 'Add a current focus from the inspector.', accent: 'var(--coral-bright)' }) },
  { kind: 'team', label: 'Team', icon: '◉', group: 'People', createData: () => ({ kind: 'team', title: 'Team', status: 'Gathering' }) },
  { kind: 'role', label: 'Role', icon: '◇', group: 'People', createData: () => ({ kind: 'role', title: 'Role', status: 'Unassigned' }) },
  { kind: 'standup', label: 'Stand-up', icon: '◎', group: 'People', createData: () => ({ kind: 'standup', title: 'Impromptu stand-up', status: 'Gathering', participants: [], summary: 'Add staff members and agents from this canvas. Brain will facilitate current work, blockers, and follow-ups.' }) },
  { kind: 'agent', label: 'Agent', icon: '✦', group: 'Agents', createData: () => ({ kind: 'agent', title: 'New agent', status: 'Needs setup', model: 'auto', personality: '', instructions: '', subtitle: 'Give this collaborator a personality, knowledge, model, and direction.' }) },
  { kind: 'voice', label: 'Voice', icon: '◖', group: 'Agents', createData: () => ({ kind: 'voice', title: 'Voice note' }) },
  { kind: 'video', label: 'Video', icon: '▶', group: 'Build', createData: () => ({ kind: 'video', title: 'Untitled video', status: 'Draft', mediaKind: 'video', capabilityId: 'creative.video', videoTimeline: emptyCanvasVideoTimeline(), videoSources: [] }) },
  { kind: 'image', label: 'Image', icon: '▣', group: 'Build', createData: () => ({ kind: 'image', title: 'Image studio', status: 'Draft', mediaKind: 'image', capabilityId: 'creative.image', provider: 'native', mcpServer: 'builtin', mcpTool: 'builtin_creative_compose' }) },
  { kind: 'animation', label: 'Animation', icon: '◉', group: 'Build', createData: () => ({ kind: 'animation', title: 'Animation studio', status: 'Draft', mediaKind: 'animation', capabilityId: 'creative.animation', provider: 'native', mcpServer: 'builtin', mcpTool: 'builtin_creative_compose' }) },
  { kind: 'podcast', label: 'Podcast', icon: '◖', group: 'Build', createData: () => ({ kind: 'podcast', title: 'Podcast studio', status: 'Draft', mediaKind: 'podcast', capabilityId: 'creative.podcast', provider: 'native', mcpServer: 'builtin', mcpTool: 'builtin_creative_compose' }) },
  { kind: 'comic', label: 'Comic', icon: '▦', group: 'Build', createData: () => ({ kind: 'comic', title: 'Comic studio', status: 'Draft', mediaKind: 'comic', capabilityId: 'creative.comic', provider: 'native', mcpServer: 'builtin', mcpTool: 'builtin_creative_compose' }) },
  { kind: 'game', label: 'Game', icon: '◆', group: 'Build', createData: () => ({ kind: 'game', title: 'Game studio', status: 'Draft', mediaKind: 'game', capabilityId: 'creative.game', provider: 'native', mcpServer: 'builtin', mcpTool: 'builtin_creative_compose' }) },
  { kind: 'cad', label: 'CAD', icon: '⌗', group: 'Build', createData: () => ({ kind: 'cad', title: 'CAD studio', status: 'Draft', mediaKind: 'cad', capabilityId: 'creative.cad', provider: 'native', mcpServer: 'builtin', mcpTool: 'builtin_creative_compose' }) },
  { kind: 'model3d', label: '3D model', icon: '⬡', group: 'Build', createData: () => ({ kind: 'model3d', title: '3D model studio', status: 'Draft', mediaKind: 'model3d', capabilityId: 'creative.model3d', provider: 'native', mcpServer: 'builtin', mcpTool: 'builtin_creative_compose' }) },
  // Hand-authored, not generated — no `mediaKind`/`capabilityId`/`mcpTool`, the same
  // way `website`/`document` are authored rather than composed. Opens directly into
  // the `world` surface (see `creationObjectSurfaces.ts`) where props are placed.
  { kind: 'world', label: '3D space', icon: '⬢', group: 'Build', createData: () => ({ kind: 'world', title: 'Untitled 3D space', status: 'Draft', world: emptyCanvasWorldScene() }) },
  // AI video/3D generation — opens directly into the `scene3d` surface bound to
  // itself (see `creationObjectSurfaces.ts`), where a prompt and a model produce a
  // clip via the studio engine. Distinct from `world` (hand-placed props) and from
  // `video` (a real multi-track timeline edit of imported/screen/camera clips).
  {
    kind: 'scene', label: 'AI scene', icon: '✧', group: 'Build',
    // `modelId` starts on the lightest always-available model (mirrors
    // `StudioPanel`'s own `defaultModel` default) rather than empty, so the model
    // picker never has to reconcile with a blank selection the moment the panel opens.
    createData: () => ({ kind: 'scene', title: 'Untitled AI scene', status: 'Draft', scene: { ...emptyCanvasSceneSpec(), modelId: 'lcm-tiny-sd' } }),
  },
  { kind: 'resume', label: 'Resume', icon: '▤', group: 'Knowledge', createData: () => ({ kind: 'resume', title: 'Resume builder', status: 'Draft', mediaKind: 'document', capabilityId: 'creative.resume', provider: 'native', templateId: 'resume', mcpServer: 'builtin', mcpTool: 'builtin_creative_compose' }) },
  { kind: 'template', label: 'Template', icon: '✦', group: 'Knowledge', createData: () => ({ kind: 'template', title: 'Creative template', status: 'Choose a template', mediaKind: 'template', capabilityId: 'creative.template', provider: 'native', mcpServer: 'builtin', mcpTool: 'builtin_creative_capabilities' }) },
  { kind: 'document', label: 'Document', icon: '▤', group: 'Knowledge', createData: () => ({ kind: 'document', title: 'Untitled document', status: 'Draft' }) },
  { kind: 'slides', label: 'Slides', icon: '▣', group: 'Knowledge', createData: () => ({ kind: 'slides', title: 'Executive presentation', status: 'Draft' }) },
  { kind: 'diagram', label: 'Diagram', icon: '◈', group: 'Knowledge', createData: () => ({ kind: 'diagram', title: 'Untitled diagram', status: 'Draft', diagramFormat: 'drawio' }) },
  { kind: 'knowledge', label: 'Knowledge', icon: '◇', group: 'Knowledge', createData: () => ({ kind: 'knowledge', title: 'Knowledge item' }) },
  { kind: 'file', label: 'File', icon: '□', group: 'Knowledge', createData: () => ({ kind: 'file', title: 'Attached file' }) },
  { kind: 'url', label: 'URL', icon: '↗', group: 'Knowledge', createData: () => ({ kind: 'url', title: 'Web resource', url: '', viewport: 'desktop' }) },
  { kind: 'frame', label: 'Frame', icon: '□', group: 'Collaborate', createData: () => ({ kind: 'frame', title: 'Presentation frame', status: 'Canvas frame' }) },
  // The untyped card. `title` IS the sticky's text — a sticky has no second field to
  // put a subtitle in, and giving it one would be inventing structure the object is
  // defined by not having. The pigment comes from the knowledge board's palette
  // (`canvasModel.STICKY_COLORS`) rather than a second list of the same six colours.
  { kind: 'sticky', label: 'Sticky note', icon: '▪', group: 'Collaborate', createData: () => ({ kind: 'sticky', title: '', stickyColor: STICKY_COLORS[0] }) },
  { kind: 'drawing', label: 'Drawing', icon: '⌁', group: 'Collaborate', createData: () => ({ kind: 'drawing', title: 'Sketch', subtitle: 'Draw and annotate an idea.' }) },
  { kind: 'comment', label: 'Comment', icon: '●', group: 'Collaborate', createData: () => ({ kind: 'comment', title: 'Comment thread' }) },
  // The two clocks. A `timer` counts a TIMEBOX down; a `stopwatch` answers "how long did
  // that actually take". Same shape (`startedAt` + `baseElapsedMs`, so every viewer
  // derives the same elapsed value from the shared model rather than a private local
  // clock) and opposite questions — see the contract's own note on `stopwatch`.
  //
  // The timer's status no longer carries "05:00": the length is `durationMs` and the
  // card DERIVES what it shows from it, where the string was a label nothing could run.
  { kind: 'timer', label: 'Timer', icon: '◷', group: 'Collaborate', createData: () => ({ kind: 'timer', title: 'Focus timer', durationMs: DEFAULT_TIMER_MS, startedAt: null, baseElapsedMs: 0 }) },
  { kind: 'stopwatch', label: 'Stopwatch', icon: '⏱', group: 'Collaborate', createData: () => ({ kind: 'stopwatch', title: 'Stopwatch', startedAt: null, baseElapsedMs: 0 }) },
  // Another document, shown here, live. Created with NO reference, because the reference
  // is the whole object and a seeded one would point at somebody else's document.
  { kind: 'transclusion', label: 'Transclusion', icon: '⧉', group: 'Knowledge', createData: () => ({ kind: 'transclusion', title: 'Embedded document', documentId: '' }) },
  // A live platform surface, mounted on the board. Created with NO component chosen,
  // for the same reason a transclusion is: the choice IS the object, and seeding one
  // would put somebody else's kanban on a board they have not asked for it on.
  { kind: 'component', label: 'Component', icon: '◲', group: 'Build', createData: () => ({ kind: 'component', title: 'Component', componentId: '' }) },
  { kind: 'mcp', label: 'MCP tool', icon: '⌘', group: 'Integrations', createData: () => ({ kind: 'mcp', title: 'Connected tool', status: 'Choose operation' }) },
  { kind: 'evermind', label: 'Evermind', icon: '🧠', group: 'Models', createData: () => ({ kind: 'evermind', title: 'Untitled Evermind', status: 'Blueprint', subtitle: 'Create, teach, tune, evaluate, and publish a self-learning model on this canvas.', evermindVersion: 0, contributions: 0 }) },
] as const satisfies readonly BaseCreationObjectDefinition[];

/**
 * The five spec vocabularies are lowered in `specDerivedRegistry.ts`.
 *
 * They used to be five near-identical `.map()` blocks here — same eleven lines, differing
 * only in which label map they read — which is both the duplication the DRY rule forbids
 * and what pushed this file past the 800-line ratchet. A vocabulary now costs one line
 * there and one spread below.
 */
/** The data-architecture kinds, DERIVED from `dataArchitectureObjects.ts` for the
 *  same reason the founder kinds are — see the FOUNDER_REGISTRY note above. */
const DATA_ARCHITECTURE_REGISTRY = DATA_ARCHITECTURE_SPECS.map((spec) => ({
  kind: spec.kind,
  label: spec.label,
  icon: spec.icon,
  group: 'Data' as const,
  createData: (): CreationNodeData => dataArchitectureSeed(spec),
})) satisfies readonly BaseCreationObjectDefinition[];

/**
 * The object kinds that need an ENTITLEMENT, and the capability that grants it.
 *
 * ── WHY THIS LIST SHRANK FROM SIX TO ONE ─────────────────────────────────────────
 * It used to carry `mcp: integrations`, `agent: agents`, `llm: models`, `voice: voice`
 * and `video: video` alongside `evermind`. Not one of them was an entitlement: they named
 * the product AREA a kind belongs to, which is exactly what the palette `group` already
 * says, and no plan feature had ever been decided for any of them. They were also, like
 * `evermind`, enforcing nothing — `availableCreationObjects` was the only reader and its
 * only caller was its own unit test, so the palette rendered straight from
 * `CREATION_PALETTE_GROUPS` and a card marked as needing an entitlement was placeable by
 * anybody.
 *
 * So five labels were deleted rather than assigned a plan feature nobody had chosen, and
 * the one that IS an entitlement is now wired: `evermindTraining` in `PLAN_LIMITS`, mapped
 * by `CANVAS_CAPABILITY_FEATURES` in the API domain, resolved per caller by
 * `GET /api/tenants/:id/canvas-capabilities`, and read by `creationPaletteGroupsFor`.
 * Adding a kind back is a line here and a line there, and it now means something.
 */
const CAPABILITIES: Partial<Record<CreationObjectKind, string>> = {
  evermind: 'evermind',
};
const ACTIONS: Partial<Record<CreationObjectKind, readonly string[]>> = {
  // No 'build'. A legacy card is OPENED onto the board and built as the SECTION it
  // becomes; building the card itself lowered its authored list through a second,
  // server-side compiler, which is the thing this kind's deprecation removes.
  workflow: ['edit', 'run'], flowStep: ['edit', 'run'], website: ['edit', 'preview', 'publish'], prototype: ['edit', 'preview'],
  // Opening the Builder IS the adapter: run, checks, terminal and publish all
  // happen inside the Builder surface it mounts, so they are not advertised here as
  // separate canvas-side actions that nothing implements.
  build: ['open'],
  // `classify` tags PII, `contract` declares the shape, `model` infers an ERD
  // from what was uploaded, and `refresh` re-runs the import against its origin.
  dataset: ['import', 'profile', 'visualize', 'plot', 'classify', 'contract', 'model', 'refresh'],
  chart: ['refresh', 'drill'], dashboard: ['refresh', 'drill'], map: ['refresh', 'drill'],
  // The data-architecture objects come from the same spec that declares their
  // fields, so a kind cannot advertise an action its body has no affordance for.
  ...Object.fromEntries(DATA_ARCHITECTURE_SPECS.map((spec) => [spec.kind, spec.actions])),
  project: ['expand', 'compare'], task: ['assign', 'deliver'], agent: ['inspect', 'configure', 'assign'],
  evermind: ['teach', 'train', 'evaluate', 'publish'], voice: ['record', 'play'], video: ['generate', 'capture', 'edit', 'preview', 'export'], mcp: ['authenticate', 'execute'],
  scene: ['generate', 'preview'],
  image: ['generate', 'preview', 'export', 'convert-to-diagram'], animation: ['generate', 'preview', 'export'], podcast: ['generate', 'preview', 'export'],
  comic: ['generate', 'preview', 'export'], game: ['generate', 'preview', 'export'], cad: ['generate', 'preview', 'export', 'convert-to-diagram'], model3d: ['generate', 'preview', 'export'],
  // `tailor` takes a `job` and produces a VARIANT — a second `resume` carrying
  // `tailoredFor`, rather than an edit in place. Two applications need two documents,
  // and a tailor that overwrote would leave the person unable to answer the question
  // every seeker asks in week three: which version did they actually see?
  resume: ['generate', 'preview', 'export', 'tailor'], template: ['browse', 'apply'],
  mockup: ['preview', 'deliver'], mockupSet: ['expand', 'deliver'], standup: ['start'],
  pitch: ['rehearse', 'export'], pitchScorecard: ['score', 'export'], pitchQa: ['drill', 'export'], pitchApplication: ['review', 'export'],
  document: ['export'], slides: ['present', 'export'], diagram: ['export', 'convert-to-diagram'], spreadsheet: ['export'], drawing: ['convert-to-diagram'],
  salesPipeline: ['refresh', 'review'], salesContact: ['qualify', 'advance'], salesCampaign: ['draft', 'schedule', 'execute'],
  targetMarket: ['research', 'segment'], salesGoal: ['review', 'update'], salesMeeting: ['schedule', 'invite'],
  // `refresh` re-reads the mailbox; `pin` lifts one message out as its own
  // `email` object so it survives the next refresh.
  inbox: ['refresh', 'filter', 'pin'], email: ['reply', 'open'],
  emailCampaign: ['draft', 'send'], emailTemplate: ['edit', 'apply'],
  // `refresh` re-reads every connected account; `pin` lifts one post out as its own
  // `socialPost` object so it survives the next refresh.
  socialFeed: ['refresh', 'filter', 'pin', 'connect'], socialPost: ['open', 'reshare'],
  socialCampaign: ['draft', 'schedule', 'publish'],
  course: ['learn', 'export'],
  // `practice` is the study loop itself; `reset` clears the attempt record so a
  // set can be studied again from cold before an exam.
  practice: ['practice', 'reset'],
  guidedTour: ['preview'],
  // `gate` evaluates the exit criteria against whatever evidence is on the board;
  // `export` writes the .spec.ts out (a plan writes its whole suite as one file).
  //
  // Deliberately NOT advertising `run`: the canvas has no browser to drive, and
  // `CONNECTED_CANVAS_ACTIONS` would answer every call with "no delivery adapter".
  // Running a published suite is `canvas_publish_tests` plus the CI harness, which is
  // a different surface — and an action a body cannot honour is the exact defect the
  // note above this map exists to prevent.
  testPlan: ['gate', 'export'],
  testCase: ['export'],
  testRun: ['export'],
  defect: ['export'],
  // Every spec vocabulary's actions, from the one declaration that also gives each
  // kind its fields — so a kind cannot advertise an action its body cannot perform.
  ...SPEC_ACTIONS,
};

const BASE_MUTABLE_FIELDS = {
  // NOT `steps`. Brain authored a free-form step list here while a server-side
  // compiler existed to lower it. That compiler is gone, so a list written onto a card
  // with no editor would be an instruction with no surface — Brain authors `flowStep`
  // objects instead (below), which is what "add a switch on status" should have drawn
  // all along. The two controls stay writable because a legacy card carries them onto
  // the frame when it is opened.
  workflow: ['content', 'approvalMode', 'runTarget'],
  // The step itself, its typed config, and the two declared data contracts the
  // compiler lowers into real nodes. Brain authors all five: "add a switch on
  // status" is a patch, not a modal. See `flowStepObject.ts` for each shape.
  // `content` is the same free-text note every other kind accepts, read generically
  // off `data.content` wherever a preview is shown (`objectPreviewText`).
  flowStep: ['content', 'stepKind', 'stepConfig', 'stepInputs', 'stepOutputs'],
  // `abTestKey`/`variantKey` are the SPLIT half of the `experiment` binding: an
  // experiment names the test, and the page names which arm of it this page IS. Without
  // the pair, "bind experiment to `ab_tests`" would give the card a live exposure count
  // and still leave nothing on the board that says which page a visitor was shown.
  website: ['content', 'websiteHeadline', 'websiteBody', 'websiteCta', 'websiteAccent', 'websiteTheme', 'activeWebsitePageId', 'viewport', 'pages', 'subdomain', 'url', 'siteUrl', 'pathUrl', 'abTestKey', 'variantKey'],
  // A Builder object owns a real workspace: the scaffold lives in R2 and the
  // whole Builder surface (files, editor, dev server, checks, publish) opens on
  // Canvas. `modality` picks its starter template. The `ideProjectId` field is a
  // legacy persistence name retained until that data contract is migrated.
  build: ['content', 'modality', 'template', 'ideProjectId', 'storageProjectId', 'storageProjectPublicId', 'containerProjectId', 'fileCount', 'previewUrl', 'subdomain', 'url', 'siteUrl', 'pathUrl'],
  chat: ['content', 'aiResponse', 'messages', 'trace'],
  // `classifications`, `dataContract` and `lineage` are governance state Brain
  // MAY author: a PII tag it proposes is only useful if it can be written back.
  // `fetchedAt` is what makes staleness computable rather than guessed.
  // `fixtureCases` labels each generated row with the edge it exercises, so a failing
  // fixture can say WHICH boundary broke rather than "row 14".
  // `dataUse` is the governance ENVELOPE — declared purposes, lawful basis, retention.
  // `classifications` described what the rows ARE and nothing bound that description to
  // a USE, so nothing stopped a dataset tagged as personal data becoming a fine-tune
  // corpus. `battlecard.doNotSay` already proves a restriction can travel with an
  // object; this is the same move for personal data, read by `checkDataUse`.
  //
  // `basis` and `datasetVersion` are the reproducibility half: which rows, how many of
  // them, and which version of this dataset produced everything downstream.
  dataset: ['content', 'columns', 'rows', 'sampleRows', 'rowCount', 'profile', 'summary', 'fileName', 'mimeType', 'classifications', 'dataContract', 'violations', 'fetchedAt', 'lineage', 'producedAt', 'sourceUri', 'fixtureCases', 'dataUse', 'basis', 'datasetVersion'],
  table: ['content', 'columns', 'rows', 'rowCount', 'sampleRows', 'highlightRules', 'summary', 'sourceDatasetId', 'sources', 'classifications', 'lineage', 'producedAt', 'fetchedAt', 'basis'],
  spreadsheet: ['content', 'columns', 'rows', 'formulas', 'rowCount', 'highlightRules', 'summary'],
  // `widgets` is the dashboard's own model (see lib/canvasDashboard): an ordered list
  // where the chart kind is a VALUE, so a dashboard can hold any number of charts of
  // any type. `kpis` / `chartLabels` / `chartValues` remain the flat wire format the
  // model and canvas_query_dataset author in, and are folded into widgets on read.
  // `lineage`/`producedAt` are on every derived artifact for one reason: a chart
  // that records WHICH dataset it came from but not HOW can never be recomputed,
  // and can never say it has gone stale because its source moved. The transform
  // travels with the artifact — see lib/canvasLineage.
  // `basis` and the interval fields are the uncertainty half. A board rendered a point
  // estimate with identical visual authority at n = 12 and n = 1,200,000, and a chart
  // computed over a truncated frame looked exactly like one computed over the whole
  // file. `intervals` is per-series {low, high}; `sampleSize` is the n the reader needs
  // to judge any of it.
  chart: ['content', 'chartType', 'chartTitle', 'xAxisLabel', 'yAxisLabel', 'chartLabels', 'chartValues', 'kpis', 'widgets', 'sources', 'summary', 'sourceDatasetId', 'lineage', 'producedAt', 'metricId', 'basis', 'intervals', 'sampleSize'],
  map: ['content', 'mapPoints', 'mapTitle', 'mapValueLabel', 'mapRegion', 'mapRegionName', 'mapOutline', 'mapAttribution', 'sources', 'summary', 'sourceDatasetId', 'lineage', 'producedAt'],
  kpi: ['content', 'value', 'target', 'unit', 'trend', 'sources', 'summary', 'sourceDatasetId', 'lineage', 'producedAt', 'metricId', 'basis', 'ciLow', 'ciHigh', 'sampleSize'],
  dashboard: ['content', 'kpis', 'chartLabels', 'chartValues', 'widgets', 'sources', 'fetchedAt', 'dateRange', 'chartTitle', 'xAxisLabel', 'yAxisLabel', 'summary', 'sourceDatasetId', 'lineage', 'producedAt', 'basis'],
  report: ['content', 'markdown', 'chartLabels', 'chartValues', 'widgets', 'sources', 'lineage', 'producedAt'],
  // An evaluation used to grade ONE RESPONSE: criteria in, a pass rate out. That is a
  // percentage with a denominator nobody can defend in a review, and — because nothing
  // gated on it — a number that could not stop a bad model shipping. The fields added
  // here are the difference between grading an answer and evaluating a system:
  //   • `goldenDatasetId` — the eval set it is scored against, so the cases have an
  //     origin other than the model writing its own and marking them.
  //   • `judgeModel` / `judgeVersion` — WHO scored it. An unrecorded judge makes two
  //     runs incomparable, because the scorer may have changed between them.
  //   • `slices` — per-segment results. An aggregate that hides a failing slice is the
  //     single most common way a model ships broken for a subgroup.
  //   • `baselineEvaluationId` + `gate` — what it must beat, and whether falling short
  //     blocks the publish action. `workflow.approvalMode` already proves the pattern.
  //   • `costPerCase` / `latencyMs` — quality that costs ten times as much is a
  //     different answer, and the board could not see the price.
  evaluation: ['content', 'criteria', 'verdict', 'gaps', 'recommendations', 'sources', 'testResults', 'passRate', 'runCount', 'lastRunAt', 'goldenDatasetId', 'judgeModel', 'judgeVersion', 'slices', 'baselineEvaluationId', 'baselinePassRate', 'gate', 'costPerCase', 'latencyMs', 'subjectObjectId'],
  projectComparison: ['content', 'projects', 'sources', 'fetchedAt', 'recommendations'],
  roadmap: ['content', 'items', 'milestones', 'sources'],
  note: ['content', 'markdown'],
  prototype: ['content', 'websiteHeadline', 'websiteBody', 'websiteCta', 'websiteAccent', 'websiteTheme', 'activeWebsitePageId', 'viewport', 'pages', 'abTestKey', 'variantKey'],
  code: ['content', 'code', 'language', 'path'],
  browser: ['content', 'url', 'viewport', 'pageTitle'],
  repository: ['content', 'url', 'branch'],
  pullRequest: ['content', 'url', 'number', 'branch', 'baseBranch', 'author', 'mergedAt'],
  ciRun: ['content', 'url', 'branch', 'commitSha', 'conclusion', 'startedAt', 'finishedAt'],
  deployment: ['content', 'environmentName', 'version', 'url', 'deployedAt', 'deployedBy'],
  productionIncident: ['content', 'severity', 'startedAt', 'resolvedAt', 'owner', 'postmortemUrl'],
  deliveryRollup: [
    'content', 'scopeKind', 'scopeId', 'totalTasks', 'completedCount', 'openCount',
    'avgCycleTimeHours', 'throughputPerWeek', 'agentLlmCostUsd',
    'deploymentFrequencyPerDay', 'leadTimeHours', 'changeFailureRatePct', 'mttrHours',
    'avgOkrProgress', 'fetchedAt',
  ],
  environment: ['content', 'environmentUrl', 'environmentKind', 'branch'],
  selection: ['content', 'code', 'language', 'path', 'range'],
  // `auditFindings` is the accessibility/performance verdict of a fetched page. It
  // lands on `diagnostics` rather than on a kind of its own because that is exactly
  // what a diagnostic IS here — scored findings plus next steps — and a second
  // "audit" kind would be a per-feature copy of a shape that already exists.
  diagnostics: ['content', 'diagnostics', 'findings', 'checks', 'items', 'severity', 'result', 'results', 'summary', 'verdict', 'nextSteps', 'recommendations', 'actions', 'remediation', 'path', 'qualityScore', 'qualityLabel', 'qualityHeadline', 'diagnosticCount', 'gapCount', 'auditFindings', 'auditScore', 'auditPassed', 'auditTarget'],
  terminal: ['content', 'exitCode'],
  service: ['content', 'url', 'port', 'viewport', 'pageTitle'],
  // LLM work is bought by the token, and this object had no tokens on it. The platform
  // records every one — `agent_inference_logs`, `run_model_outcomes`, `llm_usage_log` —
  // and none of it reached the surface where the architecture is CHOSEN, so the board
  // could not answer "what does this cost at a million requests a month", which is the
  // question that decides whether an LLM feature ships at all. `projectedMonthlyCost` is
  // derived from the rest rather than typed, so a card cannot quote a price that
  // disagrees with its own inputs.
  course: ['content', 'course', 'exportStandards'],
  // `attempts` is absent on purpose: it is the learner's record of what they
  // actually answered, and a model that could write it could report mastery
  // nobody demonstrated. Only the practice card appends to it.
  practice: ['content', 'practiceMode', 'questions', 'sourceObjectId', 'summary'],
  guidedTour: ['content', 'tour'],
  project: ['content', 'projectLens', 'sources', 'qualityScore', 'qualityLabel', 'qualityHeadline', 'diagnosticCount', 'gapCount', 'diagnostics', 'recommendations', 'qualityUpdatedAt'],
  salesPipeline: ['content', 'ownerUserId', 'stages', 'pipelineCounts', 'recommendations', 'sources'],
  salesContact: ['content', 'ownerUserId', 'contactId', 'email', 'company', 'market', 'stage', 'lastTouchAt'],
  salesCampaign: ['content', 'ownerUserId', 'campaignId', 'market', 'subject', 'sent', 'replies', 'scheduledAt'],
  targetMarket: ['content', 'ownerUserId', 'market', 'segments', 'channels', 'recommendations', 'sources'],
  salesGoal: ['content', 'ownerUserId', 'outreachTarget', 'contactsTarget', 'meetingsTarget', 'revenueGoalCents', 'referralLink', 'salesLink', 'progress', 'recommendations'],
  salesMeeting: ['content', 'ownerUserId', 'contactId', 'scheduledAt', 'durationMinutes', 'attendees', 'meetingUrl'],
  // `messages` is the last read, kept so the tile is not blank while it
  // refreshes; `filter` is what makes the view reproducible on the next refresh
  // and is the reason an inbox is an OBJECT rather than a chat answer.
  inbox: ['content', 'connectionId', 'accountEmail', 'provider', 'filter', 'messages', 'unreadCount', 'fetchedAt', 'summary'],
  email: ['content', 'messageId', 'connectionId', 'accountEmail', 'from', 'fromName', 'to', 'subject', 'receivedAt', 'bodyText', 'unread', 'hasAttachments', 'webUrl', 'summary'],
  // `audienceId`/`audienceName` are the BINDING, and they are the only audience fields
  // here on purpose. The size, the suppression count and the lawful basis are NOT copied
  // onto the campaign: they are read at render time off the `audience` card this binds
  // to, so nothing an LLM patch can write is able to assert that nobody unsubscribed.
  // A count the model could type is a count the model could type to zero, and zero is
  // what unblocks the send. See `marketing.ts` and `campaignSendReadiness()` below.
  emailCampaign: ['content', 'campaignId', 'audienceId', 'audienceName', 'templateId', 'subject', 'bodyHtml', 'transport', 'senderIdentityId', 'mailboxConnectionId', 'connectorConnectionId', 'fromName', 'recipients', 'sent', 'failed', 'opened', 'clicked', 'blockers'],
  emailTemplate: ['content', 'templateId', 'subject', 'bodyHtml', 'mergeFields', 'assetId', 'logoUrl'],
  // `posts` is the last read, kept so the tile is not blank while it refreshes;
  // `filter` is what makes the view reproducible on the next refresh, and
  // `engagement`/`topPost` are the insight the tile leads with rather than a raw list.
  socialFeed: ['content', 'filter', 'posts', 'accounts', 'networks', 'engagement', 'topPost', 'postCount', 'fetchedAt', 'summary'],
  socialPost: ['content', 'postId', 'connectionId', 'network', 'accountName', 'authorName', 'text', 'permalink', 'publishedAt', 'metrics', 'mediaUrls', 'thumbnailUrl', 'summary'],
  socialCampaign: ['content', 'campaignId', 'body', 'linkUrl', 'mediaUrls', 'variants', 'targets', 'posts', 'scheduledAt', 'publishedCount', 'failedCount', 'blockers'],
  // `startDate`/`dueDate`/`storyPoints`/`sprintId` mirror `tasksApi.update`'s scheduling
  // triple plus sprint assignment (see its own note on why the client type used to omit
  // them) — without these here a task's estimate/schedule was writable through the API
  // but invisible to both Brain and the inspector that edits everything else about it.
  task: ['content', 'role', 'assignee', 'agentName', 'agentRef', 'priority', 'acceptanceCriteria', 'taskKey', 'prdTitle', 'prdStatus', 'prdSummary', 'prdCount', 'startDate', 'dueDate', 'storyPoints', 'sprintId'],
  prd: ['content', 'markdown', 'requirements', 'userStories'],
  release: ['content', 'items', 'milestones', 'releaseDate'],
  mockup: ['content', 'items', 'viewport', 'sources', 'deliveryProjectRef', 'deliveryProjectName', 'mockupAgentRef', 'mockupAgentName'],
  mockupSet: ['content', 'items', 'sources'],
  featureSummary: ['content', 'items', 'sources'],
  pitch: ['content', 'competitionId', 'beats', 'sources', 'summary'],
  pitchScorecard: ['content', 'competitionId', 'criteria', 'recommendations', 'sources', 'summary'],
  pitchQa: ['content', 'competitionId', 'questions', 'sources', 'summary'],
  pitchApplication: ['content', 'competitionId', 'answers', 'eligibility', 'category', 'sources', 'summary'],
  staff: ['content', 'role', 'focus', 'accent'],
  team: ['content', 'participants', 'summary'],
  // A role had an ORG representation and no COST one, so the board could draw the
  // headcount that consumes most of a budget and could never total it. `loadedCost` is
  // salary plus employer taxes, benefits and equipment — the number a plan actually
  // spends — and `startAt` is what stops a plan overstating the year by counting a
  // month-11 hire as twelve months of cost. These are the SAME facts `headcountPlan`
  // rolls up, held once on the role rather than copied into the plan.
  role: ['content', 'role', 'responsibilities', 'currency', 'salary', 'loadedCost', 'startAt', 'level', 'team', 'headcountStatus'],
  standup: ['content', 'participants', 'summary'],
  agent: ['content', 'model', 'personality', 'instructions', 'tools', 'autonomy', 'testPrompt', 'testExpected', 'testResponse', 'testStatus', 'testHistory'],
  voice: ['content', 'transcript', 'voiceId', 'audioUrl'],
  video: ['content', 'prompt', 'videoUrl', 'duration', 'modelSlug', 'maxFrames', 'frameCount', 'videoWidth', 'videoHeight', 'generatedFrames', 'mediaKind', 'capabilityId', 'videoTimeline', 'videoSources', 'selectedVideoClipId', 'renderedVideoUrl', 'renderedVideoStorageKey', 'renderedVideoMimeType', 'youtubeVideoId', 'youtubeUrl', 'youtubePrivacyStatus',
    // A video with no captions cannot lawfully be distributed to a class (WCAG 1.2.2),
    // and until this field existed the board had nowhere to record that they exist.
    'captionsUrl',
    // A RECORDED walkthrough carries two things an imported file cannot: when each
    // sentence was said, and which seconds are worth returning to. `talktrack` holds
    // both (see `talktrack.ts`); `transcript` is the same narration flattened to
    // prose, which is what Brain reads and what a search matches — the same pairing
    // `podcast` and `voice` already have.
    'talktrack', 'transcript'],
  image: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'mcpServer', 'mcpTool', 'mcpArguments'],
  animation: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'duration', 'mcpServer', 'mcpTool', 'mcpArguments'],
  podcast: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'duration', 'transcript', 'mcpServer', 'mcpTool', 'mcpArguments'],
  comic: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'pages', 'mcpServer', 'mcpTool', 'mcpArguments'],
  game: ['content', 'prompt', 'gamePlatform', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'mcpServer', 'mcpTool', 'mcpArguments'],
  cad: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'cadState', 'units', 'mcpServer', 'mcpTool', 'mcpArguments'],
  model3d: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'modelState', 'units', 'mcpServer', 'mcpTool', 'mcpArguments'],
  // Hand-authored (see the registry entry): no `mediaKind`/`capabilityId`/`mcpTool`
  // siblings — `world` is the whole authored state, same as `website`/`document`.
  world: ['content', 'world'],
  // AI generation, not authoring: the whole `CanvasSceneSpec` (model, prompt, params,
  // Mamba state, produced clip) lives under the one `scene` field — same single-field
  // shape `world` uses, for the same reason.
  scene: ['content', 'scene'],
  // `tailoredFor` names the `job` this variant was cut for, by that card's title. It is
  // the only thing that distinguishes nine résumés from nine unlabelled files, and it is
  // a REFERENCE rather than a copy of the posting for the reason `jobApplication.jobRef`
  // is: correcting the role on the posting must not leave nine variants quoting the old
  // one. Empty on the master résumé, which is what makes the master identifiable.
  resume: ['content', 'markdown', 'resumeDocument', 'tailoredFor', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'outputFormat', 'outputUrl', 'thumbnailUrl', 'resumeId', 'fileName', 'mimeType', 'fileSize', 'mcpServer', 'mcpTool', 'mcpArguments'],
  template: ['content', 'prompt', 'mediaKind', 'capabilityId', 'provider', 'templateId', 'templateCategory', 'outputFormat', 'thumbnailUrl', 'mcpServer', 'mcpTool', 'mcpArguments'],
  document: ['content', 'markdown', 'sources'],
  slides: ['content', 'markdown', 'items', 'sources'],
  diagram: ['content', 'markdown', 'diagram', 'diagramXml', 'diagramFormat', 'sources', 'sourceImageIds', 'fileName', 'mimeType'],
  knowledge: ['content', 'markdown', 'sources'],
  file: ['content', 'fileName', 'mimeType', 'url', 'fileSize', 'summary'],
  url: ['content', 'url', 'sources', 'viewport', 'pageTitle'],
  // `presentationOrder` is authorable so a model asked to "set up a walkthrough" can
  // number the frames rather than describing the order it would like — the sequence is
  // derived from this field and from nothing else editable.
  frame: ['content', 'framePurpose', 'frameColor', 'frameBorder', 'presentationOrder', 'approvalMode', 'runTarget'],
  // `stickyShape` records what the object was on the board it came FROM — a Miro
  // `shape` imports as a sticky with its geometry remembered, so a re-export can put
  // the rectangle back and a reader can see it was never a note. It is authorable
  // because a person may legitimately turn a sticky into a rounded card.
  sticky: ['content', 'stickyColor', 'stickyShape'],
  drawing: ['content', 'points', 'drawingWidth', 'drawingHeight', 'stroke', 'strokeWidth'],
  comment: ['content', 'resolved', 'mentions'],
  // `duration`/`remaining`/`running` were three fields nothing read: the card had no
  // clock, so a model could write "running: true" onto a card that never moved. The
  // shared model is `durationMs` + `startedAt` + `baseElapsedMs`, and all three are
  // authorable so a model asked to "put a five-minute timer on this" can set the box
  // AND start it — see `CanvasClockBody` for why liveness is these two numbers.
  timer: ['content', 'durationMs', 'startedAt', 'baseElapsedMs'],
  stopwatch: ['content', 'startedAt', 'baseElapsedMs'],
  // The reference IS the object. Authorable, because "embed the onboarding SOP here" is
  // a request a model can satisfy once it has the document's id.
  transclusion: ['content', 'documentId'],
  // `componentId` is authorable so "put the hiring pipeline on this board" is a
  // request the Brain can satisfy — it resolves against the same registry the
  // picker reads, and an id nothing registers renders as unavailable rather than
  // as a blank card.
  component: ['content', 'componentId'],
  mcp: ['content', 'toolName', 'operation', 'arguments'],
  evermind: ['content', 'model', 'instructions', 'teacherModel', 'inferenceEnabled', 'evermindVersion', 'evermindSeeded', 'contributions', 'pendingContributions', 'recentLearnings', 'trainingLoss', 'learningMode', 'lastLearnedAt', 'quarantinedAt', 'quarantineReason', 'evalPoint', 'stages', 'sources'],
  // ── The QA objects ─────────────────────────────────────────────────────────
  // `gateVerdict`, `passRate` and `lastRunAt` are absent from the authorable list on
  // purpose, and it is the same rule `practice.attempts` follows: a model that could
  // write its own gate verdict could report a release as green that nothing ran. Those
  // are written by `planGateVerdict` from the runs on the board, never by a patch.
  testPlan: ['content', 'targetUrl', 'routes', 'exitCriteria', 'summary', 'sources', 'planSlug'],
  // `spec` IS authorable — a person may paste a spec they already have — but every
  // canvas path that changes `steps` re-lowers it through `relowerCase`, so the two
  // cannot drift while the board owns the case.
  testCase: ['content', 'targetUrl', 'route', 'steps', 'spec', 'priority', 'intent', 'caseId', 'summary', 'sources'],
  testRun: ['content', 'targetUrl', 'results', 'browser', 'commitSha', 'startedAt', 'finishedAt', 'summary', 'explorationId', 'planObjectId'],
  defect: ['content', 'severity', 'defectType', 'route', 'targetUrl', 'expected', 'actual', 'reproSteps', 'fingerprint', 'caseId', 'evidenceUrl', 'assignee', 'resolution', 'summary', 'journal'],
  // Every spec-driven vocabulary is excluded here because its mutable fields are DERIVED
  // from its one declaration rather than retyped — that derivation is the whole point of
  // `specObjects.ts`. The exclusion list grows by one name per vocabulary, and the
  // annotation still fails to compile for any kind that is in neither half.
} as const satisfies Record<
  Exclude<
    CreationObjectKind,
    // The data-architecture kinds belong here for the same reason as the rest: their
    // mutable fields are DERIVED from `DATA_ARCHITECTURE_SPECS` and spread in below.
    // Their omission made this annotation demand six entries the object above is not
    // supposed to carry, so the exhaustiveness check it exists to perform could not
    // compile at all — a guard that fails for every kind protects none of them.
    FounderObjectKind | AcademicObjectKind | HiringObjectKind | PeopleObjectKind | SharedObjectKind | DataArchitectureKind | DataScienceObjectKind | OperationsObjectKind | LegalObjectKind | SellMotionObjectKind | CareerObjectKind | MarketingObjectKind | 'llm'
  >,
  readonly string[]
>;

/** The annotation is the exhaustiveness check: a kind added to the contract and to
 *  neither half below fails to compile here rather than rendering as an empty card. */
const MUTABLE_FIELDS: Record<CreationObjectKind, readonly string[]> = {
  ...BASE_MUTABLE_FIELDS,
  ...FOUNDER_MUTABLE_FIELDS,
  ...ACADEMIC_MUTABLE_FIELDS,
  ...HIRING_MUTABLE_FIELDS,
  ...CAREER_MUTABLE_FIELDS,
  ...PEOPLE_MUTABLE_FIELDS,
  ...SHARED_MUTABLE_FIELDS,
  ...DATA_SCIENCE_MUTABLE_FIELDS,
  ...OPERATIONS_MUTABLE_FIELDS,
  ...LEGAL_MUTABLE_FIELDS,
  ...SELL_MOTION_MUTABLE_FIELDS,
  ...MODEL_MUTABLE_FIELDS,
  ...MARKETING_MUTABLE_FIELDS,
  // Cast to the named kind union rather than left as an index signature: an
  // index-signature map satisfies ANY key, so spreading one silently switched the
  // exhaustiveness annotation below off for these six kinds.
  ...(Object.fromEntries(
    DATA_ARCHITECTURE_SPECS.map((spec) => [spec.kind, dataArchitectureMutableFields(spec.kind)]),
  ) as Record<DataArchitectureKind, readonly string[]>),
};

/**
 * `altText` is COMMON, on every kind, for the same reason `title` is.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * The canvas can generate an image, a comic, an animation, a 3D model, a chart and a
 * map, and not one of them had a field for a text alternative. That is not a missing
 * nicety: an artifact distributed to enrolled students without one fails WCAG 1.1.1,
 * and a university that publishes it has broken the law. The accessibility audit
 * (`lib/academic/accessibility.ts`) is what reports it — and an audit that reports a
 * problem the data model gives you no way to fix would be worse than none.
 *
 * Universal rather than listed per kind, because "does this object need a text
 * alternative" is a question about the RENDERED artifact, not about the kind: a `note`
 * holding an ASCII diagram needs one and a `chart` with a written summary does not.
 * The audit decides; the field is always available. It sits with the identity fields
 * so `NON_SUBSTANTIVE_FIELDS` picks it up — an image whose only authored field is its
 * own alt text is still an empty shell.
 */
const COMMON_MUTABLE_FIELDS = ['title', 'subtitle', 'status', 'deliverables', 'altText'] as const;
const SENSITIVE_MUTATION_KEY = /(?:secret|token|password|credential|authorization|api.?key|cookie)/i;

/**
 * How deep an LLM-authored patch may nest before the rest is dropped.
 *
 * This was 4, which silently truncated the deepest object the registry actually
 * advertises as authorable. A `course` payload nests
 * `course → modules[] → module → lessons[] → lesson`, so the lesson objects sat
 * at depth 4 and every one of them was discarded — a canvas Course arrived with
 * titled modules and NO lessons, and its `assessment.choices` (also depth 4) came
 * back answer-less. Nothing reported the loss: the object rendered, just empty,
 * so a generated LMS looked like the model had refused to write the content.
 *
 * Breadth is what actually bounds the payload (500 array items, 100 object keys,
 * 40k-character strings, all still enforced below); depth only has to clear the
 * deepest legitimate shape, with headroom for the next one.
 */
const MAX_MUTATION_DEPTH = 8;

function sanitizeMutationValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, 40_000);
  if (depth >= MAX_MUTATION_DEPTH) return undefined;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeMutationValue(item, depth + 1)).filter((item) => item !== undefined);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).flatMap(([key, item]) => {
    if (SENSITIVE_MUTATION_KEY.test(key)) return [];
    const safe = sanitizeMutationValue(item, depth + 1);
    return safe === undefined ? [] : [[key, safe]];
  }));
  return undefined;
}

export function creationObjectMutableFields(kind: CreationObjectKind): readonly string[] {
  return [
    ...COMMON_MUTABLE_FIELDS,
    ...MUTABLE_FIELDS[kind],
    // ── THE BRAND BINDING, ADDED IN ONE PLACE ──────────────────────────────────
    // Seventeen kinds compose an artifact somebody's customers will see, and every one
    // of them reached `builtin_creative_compose` or its authoring fields with no brand
    // binding at all — no palette, no logo, no typography, no voice, no claim list. The
    // list of which kinds those are lives in the CONTRACT (`BRAND_BOUND_KINDS`) rather
    // than being spelled onto seventeen entries above, because seventeen hand-edits is
    // seventeen chances to forget the eighteenth. A kind added to that list gains the
    // field here, and `resolveBrandBinding` reads it, without either side being touched.
    ...(isBrandBoundKind(kind) ? [BRAND_BINDING_FIELD] : []),
  ];
}

/**
 * Kinds whose `title` IS their content rather than a name for it.
 *
 * Every other object on the board is a named thing with a body: a `prd` is called
 * something and then says something. A sticky is only its words, so it has one
 * field and that field starts blank — a sticky that arrives reading "New note" is
 * a card whose first interaction is deleting the text on it, which is the same
 * defect as the workflow that used to arrive saying "Ready".
 *
 * Exported because the registry's "every kind arrives named" invariant is real and
 * has exactly this exception; asserting it needs one place to read the exception
 * from, rather than each consumer spelling `kind === 'sticky'` and drifting.
 */
export const TITLE_IS_CONTENT_KINDS: ReadonlySet<CreationObjectKind> = new Set<CreationObjectKind>(['sticky']);

/**
 * Kinds whose object is legitimately created EMPTY, with a reason each.
 *
 * The shell is the point for these: a Builder workspace is seeded from a starter
 * project rather than authored, a Dataset is filled by an import, a Chat holds the
 * conversation itself, and a Frame or Comment is pure canvas furniture. Everything
 * NOT listed here is an artifact whose whole value is its content.
 */
const SHELL_IS_LEGITIMATE: ReadonlySet<CreationObjectKind> = new Set<CreationObjectKind>([
  // A sticky is created empty BY DESIGN — you drag one out and then type on it, which
  // is the entire interaction. It is the purest member of the "canvas furniture" set
  // this exemption was written for.
  'sticky',
  'build', 'chat', 'dataset', 'frame', 'comment', 'selection', 'timer', 'terminal',
  'browser', 'url', 'file', 'repository', 'service', 'diagnostics', 'inbox',
  // A social feed and a pinned post are READ from connected accounts, exactly as an
  // inbox is — their content arrives from the network, never from an authored patch.
  'socialFeed', 'socialPost',
  //
  // `email` is deliberately NOT here any more. It was, on the same read-from-the-network
  // reasoning — but a pinned message is built by `canvas_pin_email` from what the
  // mailbox returned and never passes through this guard at all. The only path that
  // does is `canvas_add_object`, which is the AUTHORED one: "write an email to my boss
  // asking for a raise". The exemption therefore protected nothing and excused the one
  // case it should have caught (measured 2026-08-14, ui 2026.8.15: an email tile whose
  // body read "No body").
  // A run is written BY a run. An empty one is the honest state of a suite that has
  // been dispatched and has not reported yet — the one case where a shell is the
  // truth rather than work handed back to the user.
  'testRun',
  // A `legalDocument` is FILLED BY AN UPLOAD, exactly as a `dataset` is filled by an
  // import — every field on it is `bookkeeping: true` (see `legalObjects.ts`), so a
  // freshly authored card legitimately has nothing else to show until a real file
  // lands on it.
  'legalDocument',
  // The three legal RECORD kinds, for the same reason one axis over: every field on
  // each is a projection of a `legal_entities`, `intellectual_property` or
  // `legal_matters` row that `canvas_sync_legal` writes. A card placed from the palette
  // before the sync runs is legitimately empty — and the alternative, letting the model
  // fill it to satisfy the shell rule, is the invented record `legalObjects.ts` refuses.
  'legalEntity', 'ipAsset', 'legalMatter',
]);

/** Identity and bookkeeping — present on an empty object, so authoring one of these
 *  is not evidence that anything was actually written. */
const NON_SUBSTANTIVE_FIELDS: ReadonlySet<string> = new Set<string>([
  ...COMMON_MUTABLE_FIELDS, 'sources', 'fetchedAt', 'sourceDatasetId',
  // A practice set whose only authored field is its MODE is still an empty
  // shell — the questions are the work.
  'practiceMode',
  // The founder half of the same idea, declared with the fields it describes.
  ...FOUNDER_BOOKKEEPING_FIELDS,
  /**
   * Every spec field flagged `bookkeeping` or `derived`, across every registered
   * vocabulary.
   *
   * `derived` matters most here: a `submission` whose only populated fields are the
   * `integrity` ledger and a `lateBy` the board computed was NOT authored by anybody,
   * and must still count as the empty shell it is. Without this, the canvas writing its
   * own evidence onto a card would be mistaken for a learner handing work in.
   */
  ...specBookkeepingFields(),
]);

/** The fields that, for this kind, carry the actual work. */
export function creationObjectContentFields(kind: CreationObjectKind): readonly string[] {
  return MUTABLE_FIELDS[kind].filter((field) => !NON_SUBSTANTIVE_FIELDS.has(field));
}

/**
 * Fields that ARE the work for their kind: at least one must be written, however much
 * else the patch carries.
 *
 * The rule below passes an object as soon as ANY one content field is populated, which
 * is right for a kpi (a `value` is the point) and wrong for a message, where the field a
 * model reliably fills is the SUBJECT — the envelope, not the letter. Measured
 * 2026-08-14 (ui 2026.8.15): "help me write an email to my boss asking for a raise"
 * produced an email tile rendering "No body", because `subject` alone cleared the guard.
 * The same shape is already on the record one kind over — the 2026-08-12 sweep listed
 * "an emailTemplate with no body" among its eight title-only objects.
 *
 * Registry DATA, like everything else here: a kind is covered by being listed, not by a
 * branch in the checker.
 */
const ESSENTIAL_CONTENT_FIELDS: Partial<Record<CreationObjectKind, readonly string[]>> = {
  email: ['bodyText'],
  emailTemplate: ['bodyHtml'],
  // A campaign may carry its own copy or reference an authored template, but it cannot
  // have neither and still be something anyone could send.
  emailCampaign: ['bodyHtml', 'templateId'],
};

/** Written, as opposed to present-but-blank. Shared by both checks below so "authored"
 *  means one thing. */
function isAuthored(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/**
 * Why this authored patch would land as an EMPTY SHELL, or null when it carries work.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * `canvas_add_object` accepted `{kind, title}` and answered `ok: true`. The Canvas
 * system prompt has always said "do not create an empty shell", and three kinds
 * enforced it (website, course, drawing) with a bespoke branch each — every other kind
 * took a title and reported success.
 *
 * Measured 2026-08-12 (ui 2026.7.213): a marketing-campaign turn created nine objects
 * and EIGHT of them were title-only — a targetMarket with no segments, an emailTemplate
 * with no body, a dashboard with no KPIs, and four KPIs with no value, target or unit,
 * each stamped "Live". Brain then reported success and told the operator "you can now
 * populate these KPIs with your actual data" — the product had handed the work back and
 * called it done. (Its sibling cause was a 700-token output ceiling on guest turns that
 * truncated any call large enough to carry real content; see GUEST_CHAT_LIMITS.)
 *
 * Registry DATA rather than another branch per kind: the fields already exist in
 * MUTABLE_FIELDS, so a new object kind is covered the moment it is declared.
 */
export function emptyShellProblem(kind: CreationObjectKind, authored: Record<string, unknown>): string | null {
  if (SHELL_IS_LEGITIMATE.has(kind)) return null;
  const essential = ESSENTIAL_CONTENT_FIELDS[kind];
  if (essential && !essential.some((field) => isAuthored(authored[field]))) {
    return `A ${kind} without ${essential.join(' or ')} is an empty shell — a subject line is the envelope, not the letter, and the user cannot send or keep what was never written. Send the full authored message in fields.${essential[0]}.`;
  }
  const contentFields = creationObjectContentFields(kind);
  if (contentFields.length === 0) return null;
  if (contentFields.some((field) => isAuthored(authored[field]))) return null;
  return `A ${kind} with only a title is an empty shell — it hands the work back to the user instead of doing it. Send the authored content in fields: ${contentFields.slice(0, 12).join(', ')}.`;
}

/** Drop unknown and sensitive values before an LLM-authored patch reaches state. */
export function sanitizeCreationObjectPatch(kind: CreationObjectKind, value: unknown): Partial<CreationNodeData> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set(creationObjectMutableFields(kind));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (!allowed.has(key) || SENSITIVE_MUTATION_KEY.test(key)) return [];
    const safe = sanitizeMutationValue(item);
    return safe === undefined ? [] : [[key, safe]];
  })) as Partial<CreationNodeData>;
}
/**
 * Explicit, content-safe fields Brain may receive from a Canvas Object.
 * Imported rows, prompts, credentials, tokens, and arbitrary inspector state are
 * intentionally absent. Structured evidence is retained so comparisons,
 * evaluations, roadmaps, and charts can be grounded rather than title-only.
 */
/**
 * The AI-context layer — `CONTEXT_FIELDS`, its per-field budgets and
 * `creationObjectAiContext` — lives in `creationObjectContext.ts`.
 *
 * A different question from this module's ("what exists, what may be written"), with
 * different safety properties, and 300 lines of it. Re-exported so every existing
 * consumer keeps its import path.
 */
export { creationObjectAiContext } from './creationObjectContext';
import { creationObjectAiContext } from './creationObjectContext';

export const CREATION_OBJECT_REGISTRY: readonly CreationObjectDefinition[] = [
  ...BASE_CREATION_OBJECT_REGISTRY,
  ...FOUNDER_REGISTRY,
  ...ACADEMIC_REGISTRY,
  ...HIRING_REGISTRY,
  ...CAREER_REGISTRY,
  ...PEOPLE_REGISTRY,
  ...SHARED_REGISTRY,
  ...DATA_SCIENCE_REGISTRY,
  ...DATA_ARCHITECTURE_REGISTRY,
  ...OPERATIONS_REGISTRY,
  ...LEGAL_REGISTRY,
  ...SELL_MOTION_REGISTRY,
  ...MODEL_REGISTRY,
  ...MARKETING_REGISTRY,
].map((definition) => ({
  ...definition,
  ...(CAPABILITIES[definition.kind] ? { capability: CAPABILITIES[definition.kind] } : {}),
  renderer: 'creation' as const,
  inspector: 'creation' as const,
  actions: [...new Set(['inspect', 'edit', ...(ACTIONS[definition.kind] ?? [])])],
  mutableFields: creationObjectMutableFields(definition.kind),
  allowedConnections: CREATION_CONNECTION_KINDS,
  contextAdapter: creationObjectAiContext,
}));

const byKind = new Map(CREATION_OBJECT_REGISTRY.map((definition) => [definition.kind, definition]));

export function creationObjectDefinition(kind: CreationObjectKind): CreationObjectDefinition {
  const definition = byKind.get(kind);
  if (!definition) throw new Error(`Unregistered creation object: ${kind}`);
  return definition;
}

export function createDefaultCreationData(kind: CreationObjectKind): CreationNodeData {
  return creationObjectDefinition(kind).createData();
}

/**
 * What to CALL an object anywhere it is referred to rather than drawn — the accessible
 * outline, a preview chip, the Brain's roster of connected work.
 *
 * Most kinds mint a default title, but the `TITLE_IS_CONTENT_KINDS` above deliberately
 * do not: a sticky's text IS its title, so prefilling it would make every new note
 * something to clear before typing. That is right on the board and wrong everywhere
 * else — the outline rendered `aria-label="Focus "` for one, an unnamed control with
 * nothing to distinguish it from the next blank note, and the Brain's roster of
 * connected work drew an empty line. So a name is the title when there is one and the
 * kind's label when there is not, decided HERE rather than by each consumer inventing
 * its own fallback (or, as all three did, not inventing one).
 */
export function creationObjectName(data: Pick<CreationNodeData, 'kind' | 'title'>): string {
  return data.title?.trim() || creationObjectDefinition(data.kind).label;
}

export function availableCreationObjects(
  capabilities: ReadonlySet<string>,
  options?: { signedIn?: boolean },
): readonly CreationObjectDefinition[] {
  const signedIn = options?.signedIn ?? true;
  return CREATION_OBJECT_REGISTRY.filter((definition) => (
    // A LEGACY kind is not on offer at all. Not an entitlement and not a guest rule:
    // the kind has no editor left, so there is nothing to unlock and nothing to
    // upgrade to — which is why it is filtered here rather than locked below.
    !definition.legacy
    && (!definition.capability || capabilities.has(definition.capability))
    // The same guest rule `creationPaletteGroupsFor` applies, asked from the contract
    // rather than copied, so the palette and the capability set cannot disagree about
    // what a signed-out visitor may author.
    && (signedIn || defaultConfidentialityForKind(definition.kind) !== 'restricted')
  ));
}

/**
 * Palette order. The annotation is the point: a group added to `CreationObjectGroup` and
 * forgotten here would hide every one of its kinds from the palette — the object would
 * exist, be authorable by Brain, and be unreachable by a person — so the list is required
 * to be exhaustive rather than merely correct on the day it was written.
 */
export const CREATION_PALETTE_GROUPS = ([
  'Build', 'Data', 'Knowledge', 'Insights', 'Work', 'Quality', 'Teaching', 'Research',
  'Pitch', 'People', 'Hiring', 'Career', 'Operations', 'Revenue', 'Agents', 'Models', 'Collaborate', 'Integrations',
] as const satisfies readonly CreationObjectGroup[])
  .map((group) => ({ group, items: CREATION_OBJECT_REGISTRY.filter((definition) => definition.group === group && !definition.legacy) }));

/** A palette entry, plus whether this caller may actually place it. `locked` is set only
 *  by {@link creationPaletteGroupsFor}; the raw groups never carry it. */
export type CreationPaletteItem = CreationObjectDefinition & { locked?: boolean };

export interface CreationPaletteGroup {
  group: CreationObjectGroup;
  items: readonly CreationPaletteItem[];
}

/**
 * The palette a SIGNED-OUT board advertises.
 *
 * ── WHY THE GUEST PALETTE IS NOT THE FULL PALETTE ───────────────────────────────
 * A guest board is stored on the device, belongs to no tenant, and has no access control
 * of any kind — which makes it the one surface where `restricted` cannot mean anything,
 * because there is no audience to name. Offering a visitor "Grievance case", "Comp band",
 * "Employee", "Candidate", "Offer" or "Incident" invites them to type the most sensitive
 * category of record the product models onto the least protected surface it has, and the
 * card would then carry a `restricted` label enforcing nothing.
 *
 * So the guest palette is the full palette minus the kinds whose DEFAULT confidentiality
 * is `restricted` — the same list, read from the same contract, that classifies them on a
 * tenant board. Derived rather than hand-listed: a kind added to
 * `RESTRICTED_BY_DEFAULT_KINDS` next quarter drops out of the guest palette without
 * anybody remembering this function exists, which is the only way a second list stays
 * true.
 *
 * Empty groups are dropped, so the guest never sees a category heading with nothing under
 * it — a heading over an empty list reads as a loading failure.
 */
/**
 * The palette for one caller.
 *
 * ── `capabilities` MAY BE NULL, AND THAT IS NOT "NONE" ──────────────────────────
 * `null` means the entitlement set is UNKNOWN — a guest board with no workspace to be
 * entitled through, the first render before the fetch lands, or a fetch that failed. An
 * unknown answer must not lock: a loading state is not a refusal, and a network blip that
 * greyed out a card somebody is paying for would be a worse failure than the one this
 * gate closes. The palette is DISCOVERY; the API is the boundary, and it refuses on its
 * own regardless of what this list drew.
 *
 * An empty SET is a different statement — "asked, and entitled to nothing" — and locks.
 */
/** The "not asked yet" answer: a set that contains everything, so an unresolved
 *  entitlement locks nothing. See `creationPaletteGroupsFor` for why unknown is not none. */
const ALL_CAPABILITIES: ReadonlySet<string> = Object.freeze({
  has: () => true,
} as unknown as Set<string>) as ReadonlySet<string>;

export function creationPaletteGroupsFor(
  signedIn: boolean,
  capabilities: ReadonlySet<string> | null = null,
): readonly CreationPaletteGroup[] {
  // ONE predicate, asked once. The guest rule and the entitlement rule used to be asked in
  // two places — this function filtered on confidentiality and `availableCreationObjects`
  // filtered on capability — and the second was called by nothing, so a card marked as
  // needing an entitlement was placeable by anybody. Both questions now go through the same
  // function, which is what stops them diverging again.
  const allowed = new Set(availableCreationObjects(capabilities ?? ALL_CAPABILITIES, { signedIn }).map((definition) => definition.kind));
  return CREATION_PALETTE_GROUPS
    .map((entry) => ({
      ...entry,
      items: entry.items.flatMap((item) => {
        if (allowed.has(item.kind)) return [item];
        // ── HIDE OR DISABLE, AND WHY IT IS BOTH ────────────────────────────────
        // A GUEST kind is hidden. A guest board is stored on the device, belongs to no
        // tenant and has no access control, so offering "Grievance case" invites somebody
        // to type the most sensitive record the product models onto the least protected
        // surface it has — and there is no upgrade that changes that, because the board
        // itself is the problem.
        //
        // An ENTITLED kind is DISABLED, not hidden, which is the rule the rest of the
        // product already follows (`<RoleGate>` disables and never hides). Hiding a paid
        // feature means nobody can discover it, and a person who cannot see the card
        // cannot understand why the documentation mentions it. The button is rendered,
        // named, and refuses — which is a boundary, where an absence is just a smaller
        // product.
        return item.capability ? [{ ...item, locked: true as const }] : [];
      }),
    }))
    .filter((entry) => entry.items.length > 0);
}

