import { useMemo, type MouseEvent } from 'react';
import { NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { CanvasNodeHandle } from '@/components/canvas/CanvasNodeHandle';
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from './types';
import { AUTHORED_FRAME_BORDER, AUTHORED_FRAME_FILL, STICKY_COLORS } from '@/domains/canvas/domain/authoredColors';
import { FlowStepOutletRail, flowStepHasNamedOutlets } from './FlowStepBody';
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
import { Icon, type IconName } from '@/components/ui/Icon';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { CanvasObjectSurfaceButton } from './CanvasObjectSurfaceButton';
import { CanvasNodeDeleteButton } from './CanvasNodeDeleteButton';
import { WEB_PAGE_KINDS } from '@/lib/canvasWebPage';
import { CanvasWidgetNodeBody } from '@/components/canvas-widgets/CanvasWidgetHost';
import type { CanvasExportAction } from '@/lib/canvasExports';
import { CanvasExportActions } from './CanvasExportActions';
import { ReadAloud } from '@/components/ReadAloud';
import { canvasProseText } from '@/lib/canvasProse';
import { SpecObjectBody } from './SpecObjectBody';
import { allSpecObjectSpecs } from '@/lib/specObjects';
// Importing a vocabulary registers it with the spec primitive, which is what makes its
// kinds resolvable here — and in the palette, the AI contract and the empty-shell rule —
// without a second list of them anywhere.
import '@/lib/academicObjects';
// What draws the inside of a card is DATA — kind → body — in `bodies/registry.ts`; this
// file is the card's chrome around it. See the registry's header for why that table is
// not in `creationObjectRegistry`.
import { CREATION_BODIES, KEEPS_GENERIC_FALLBACK } from './bodies/registry';
import { CreationNodeActionsContext } from './bodies/nodeActions';
import type { CreationNodeActions } from './bodies/types';
import { AuthoredContent } from './bodies/shared';
import { useAuthoredNodeSize, useSpecDeriveBoard } from './bodies/boardSubscriptions';

/** The historical name for `CanvasObject`, which the canvas domain now owns.
 *  Aliased rather than re-declared: two structurally identical declarations of
 *  one type is the duplication that lets them drift apart later. Imported AND
 *  exported because this file uses the name itself — `export … from` re-exports
 *  without binding anything in local scope. */
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
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

/** Every spec-declared kind. `SpecObjectBody` draws all of them, so none of them also
 *  renders the generic fallback underneath it. */
const SPEC_KINDS: ReadonlySet<string> = new Set(allSpecObjectSpecs().map((spec) => spec.kind));

/** Kinds read across rather than down, which get the wide card. Built once rather than
 *  per render — every card on the board asks it on every render. */
const WIDE_KINDS: ReadonlySet<string> = new Set(['workflow', 'website', 'prototype', 'guidedTour', 'dashboard', 'chart', 'map', 'report', 'evaluation', 'diagnostics', 'roadmap', 'slides', 'document', 'diagram', 'prd', 'knowledge', 'code', 'table', 'spreadsheet', 'featureSummary', 'mockupSet', 'evermind', 'projectComparison', 'frame', 'pitch', 'pitchScorecard', 'pitchQa', 'pitchApplication', 'course',
  // A model, a lineage flow and a check suite are all read across, not down.
  'erd', 'lineage', 'dataQuality', 'dataContract', 'datasource',
  // A step list beside a generated spec, and a per-case result table, are read
  // across the same way a check suite is.
  'testPlan', 'testCase', 'testRun', 'defect',
  // A game is played in its own body, so it needs the width a game needs.
  'game', 'resume',
  // Seven columns of day cells. A month at 240px is a grid of ellipses.
  'calendar']);

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
   * Take the object OFF the board, from the card itself.
   *
   * Until this existed, removal was reachable only by selecting an object and pressing
   * Delete — nothing on the board said a card could be removed at all. Absent on a
   * read-only or lock-blocked board, which is what makes the trash absent there rather
   * than present and silently inert. See `CanvasNodeDeleteButton`.
   */
  onDeleteNode?: (nodeId: string) => void;
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

/**
 * The density toggle's glyph, which reports the CURRENT reading rather than the next one.
 *
 * A single chevron would have been cheaper and wrong: this is a three-position control, so
 * the mark has to say which of the three you are in — full rows, one row plus a rule, or a
 * dot — or the only way to know is to press it and watch.
 */
const DENSITY_ICON: Record<CanvasNodeDensity, IconName> = {
  minimized: 'density-minimized',
  preview: 'density-preview',
  expanded: 'density-expanded',
};

/** The schedule badge's clock sits INSIDE a 26px circle that already carries a fill, so
 *  it takes a heavier stroke than the set's general-purpose 1.8 to survive at that size on
 *  a tinted plate. */
const CLOCK_BADGE_STROKE = 2.2;

export function CreationNode({ id, data, selected, canRun = true, onRun, onOpenDetails, onOpenBuiltinAgent, onEditData, onExport, onOpenPanel, onInsertFrom, onOpenSurface, onRevealObject, onMoveDeal, onOpenFrame, onDeleteNode }: CreationNodeProps) {
  const t = useTranslations('creationCanvas.node');
  const specBoard = useSpecDeriveBoard(data.kind);
  const isWide = WIDE_KINDS.has(data.kind)
    || WEB_PAGE_KINDS.has(data.kind)
    // Every founder object that declares a `rows` field renders a table, and a table in
    // a 240px card is unreadable. Derived from the spec rather than listed, so a kind
    // that gains a table gains the width with it.
    || SPEC_WIDE_KINDS.has(data.kind);
  const Body = CREATION_BODIES[data.kind];
  // Every kind with a body of its own replaces the generic fallback. A kind that drew
  // its own body AND the fallback underneath it is what all nine creative kinds did: a
  // studio tile followed by a second, redundant block repeating the same authored text.
  // Having a registry row is what opts a kind out, so a new kind cannot reintroduce the
  // same bug — `KEEPS_GENERIC_FALLBACK` names the few that still draw both.
  const showsGenericFallback = !SPEC_KINDS.has(data.kind) && (!Body || KEEPS_GENERIC_FALLBACK.has(data.kind));
  // What the body may do to the board, bound to THIS object once. Each field is absent
  // exactly when its handler is, which is what a body renders an editing control from.
  const actions = useMemo<CreationNodeActions>(() => ({
    ...(onEditData ? { edit: (patch: Partial<CreationNodeData>) => onEditData(id, patch), editObject: onEditData } : {}),
    ...(onMoveDeal ? { moveDeal: (dealId: number, stage: string) => onMoveDeal(id, dealId, stage) } : {}),
    ...(onOpenDetails ? { openDetails: (focus?: 'knowledge' | 'test' | 'evaluation' | 'delivery') => onOpenDetails(id, focus) } : {}),
    ...(onOpenBuiltinAgent ? { openBuiltinAgent: (intent: 'execute' | 'diagnostics') => onOpenBuiltinAgent(id, intent) } : {}),
    ...(onOpenSurface ? { openSurface: (surface: CanvasSurfaceId) => onOpenSurface(id, surface) } : {}),
    ...(onRevealObject ? { revealObject: onRevealObject } : {}),
    ...(onOpenFrame ? { openFrame: () => onOpenFrame(id) } : {}),
  }), [id, onEditData, onMoveDeal, onOpenDetails, onOpenBuiltinAgent, onOpenSurface, onRevealObject, onOpenFrame]);
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
    ><Icon name="clock" size={14} strokeWidth={CLOCK_BADGE_STROKE} /></button>
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
  ><Icon name={DENSITY_ICON[density]} size={14} /></button> : null;

  // Built once and drawn on BOTH the card and the orb, for the same reason the badges
  // are: a folded board is exactly where someone reaches for "get rid of this", and an
  // affordance that only exists at full size is one you have to unfold a card to find.
  const deleteButton = <CanvasNodeDeleteButton
    nodeId={id}
    data={data}
    {...(onDeleteNode ? { onDelete: onDeleteNode } : {})}
    className={`${styles.densityToggle} ${styles.nodeDelete} nodrag`}
  />;

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
      <CanvasNodeHandle type="target" position={Position.Left} className={styles.handle} />
      <span className={styles.nodeOrbMark} style={data.accent ? { background: String(data.accent) } : undefined}>
        <Icon source={typeof data.toolIcon === 'string' ? data.toolIcon : creationObjectDefinition(data.kind).icon} size={30} />
      </span>
      {densityToggle}
      {deleteButton}
      {affordances}
      {insertButton}
      <span className={styles.nodeOrbName}><b>{data.title}</b>{data.status && <small>{data.status}</small>}</span>
      {/* A step that DECIDES draws its continuations along the bottom, one per named
          outlet (see `FlowStepOutletRail`). It gets no right-hand handle at all, because
          it has no unconditional "and then" — offering one would let an author draw an
          arm the executor can never take, which is the failure outlets exist to end. */}
      {flowStepHasNamedOutlets(data)
        ? <FlowStepOutletRail data={data} />
        : <CanvasNodeHandle type="source" position={Position.Right} className={styles.handle} />}
    </article>
  );

  return (
    <article style={cardStyle} data-testid={`canvas-node-${data.kind}`} data-node-id={id} data-node-kind={data.kind} data-viewport={data.viewport} data-density={density} className={`${styles.node} ${styles[`node_${data.kind}`]} ${selected ? styles.selected : ''} ${isWide ? styles.wideNode : ''}`}>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={130} lineClassName={styles.resizeLine} handleClassName={styles.resizeHandle} />
      <CanvasNodeHandle type="target" position={Position.Left} className={styles.handle} />
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
        {deleteButton}
        {/* "Everything about this object" — the wide inspector. It carried an accessible
            name and no handler for as long as it has existed, which is a control that
            announces itself to a screen reader and then does nothing when pressed. It
            opens what its label promises now; the gear beside it still opens the SHORT
            settings list, which is the narrower of the two readings, not the same one. */}
        {onOpenDetails && <button
          type="button"
          className={`${styles.moreButton} nodrag`}
          data-testid={`canvas-node-more-${id}`}
          aria-label={t('moreOptions', { title: data.title })}
          title={t('moreOptions', { title: data.title })}
          onClick={(event) => { event.stopPropagation(); onOpenDetails(id); }}
        >•••</button>}
      </header>
      {insertButton}
      <div className={styles.nodeBody}>
        {typeof data.pipelineStep === 'number' && <div className={styles.pipelineNodeGuide} data-start={data.pipelineStart === true ? 'true' : 'false'}><b>{data.pipelineStart === true ? t('startHere') : t('stepOfFive', { step: data.pipelineStep })}</b><span>{String(data.pipelineInstruction || t('pipelineFallback'))}</span></div>}
        {/* The kind's own body, from the registry. The actions are provided once, here,
            rather than threaded into each body as its own set of optional props. */}
        {Body && <CreationNodeActionsContext.Provider value={actions}><Body id={id} data={data} /></CreationNodeActionsContext.Provider>}
        <CanvasWidgetNodeBody objectId={id} resourceId={data.resourceId} />
        {/* All seventeen founder kinds, from the one spec that declares their fields.
            See SpecObjectBody for why this is one branch and not forty-seven. */}
        <SpecObjectBody data={data} board={specBoard} />
        {showsGenericFallback && <><AuthoredContent data={data} fallback={t('objectReady', { label: creationObjectDefinition(data.kind).label })} /><div className={styles.pills}><span>{data.status || t('canvasObject')}</span><span>{t('liveSessionContext')}</span></div></>}
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
        : <CanvasNodeHandle type="source" position={Position.Right} className={styles.handle} />}
    </article>
  );
}
