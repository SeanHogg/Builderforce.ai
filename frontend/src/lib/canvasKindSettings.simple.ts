/**
 * Kinds whose full-inspector body was already, in effect, a plain settings form —
 * one or two selects/text fields plus a couple of buttons, with no derived cross-node
 * state and no imperative side effects an `onChange(patch)` can't express. These are
 * declared as DATA rather than given a `custom.component`, per the module rule in
 * `canvasKindSettings.ts`: a kind gets a component only when it genuinely needs one.
 */

import { registerKindSettings } from './canvasKindSettings';
import { AUTHORED_FRAME_BORDER, AUTHORED_FRAME_FILL } from '@/domains/canvas/domain/authoredColors';
import { DOCUMENT_EDITOR_KINDS } from './creationObjectGroups';
import { DIAGRAM_TARGETS } from './diagramNotations';

registerKindSettings({
  kinds: ['diagram'],
  marketplace: { sellable: () => true },
  fields: [
    {
      // Notation names are the formats' own brands, never translated copy — and the
      // dedicated class is what keeps each `<option>` opaque and legible in both
      // themes (a native `<select>` does not inherit the page's dark background).
      name: 'diagramFormat', control: 'select', section: 'basic', labelKey: 'diagramFormat', surface: 'full',
      selectClassName: 'notationSelect',
      options: DIAGRAM_TARGETS.map((notation) => ({ value: notation.id, label: notation.name })),
    },
    {
      name: 'diagram', control: 'textarea', section: 'basic', labelKey: 'diagramSource', surface: 'full',
      placeholderKey: 'diagramSourcePlaceholder',
      toPatch: (value) => ({ diagram: value, content: value }),
    },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['workflow'],
  marketplace: { sellable: () => true },
  fields: [
    {
      // The runtime names ("BuilderForce.AI", "Campaign Strategist") are proper nouns,
      // never translated copy — same as the original inline `<option>` text.
      name: 'runTarget', control: 'select', section: 'basic', labelKey: 'executionTarget', surface: 'full',
      options: [{ value: 'builderforce', label: 'BuilderForce.AI' }, { value: 'campaign-strategist', label: 'Campaign Strategist' }],
    },
    {
      name: 'approvalMode', control: 'select', section: 'basic', labelKey: 'approvalMode', surface: 'full',
      options: [{ value: 'required', labelKey: 'approvalRequiredBeforePublish' }, { value: 'autonomous', labelKey: 'fullyAutonomous' }],
    },
  ],
  actions: [
    // "Open on canvas" UNPACKS the definition into real step objects inside a frame,
    // and the card is replaced by the section it was standing in for. It used to open
    // a modal that mounted a second canvas over this one; the board is the editor now,
    // so opening one means putting it ON the board. See `boardFlowFromDefinition.ts`.
    { name: 'openOnCanvas', labelKey: 'openWorkflowOnCanvas', style: 'primary', handler: 'unpackWorkflow' },
    { name: 'build', labelKey: 'buildWorkflow', style: 'primary', handler: 'buildWorkflow' },
    { name: 'run', labelKey: 'runWorkflow', style: 'primary', handler: 'run' },
  ],
});

registerKindSettings({
  kinds: ['dashboard'],
  marketplace: { sellable: () => true },
  fields: [
    {
      name: 'dateRange', control: 'select', section: 'basic', labelKey: 'dateRange', surface: 'full',
      options: [
        { value: '30d', labelKey: 'last30Days' },
        { value: '7d', labelKey: 'last7Days' },
        { value: 'qtd', labelKey: 'quarterToDate' },
      ],
    },
  ],
  actions: [{ name: 'refresh', labelKey: 'refreshLiveData', style: 'primary', handler: 'refreshDashboard' }],
});

registerKindSettings({
  kinds: ['project'],
  marketplace: { sellable: () => true },
  hintKey: 'projectContextHint',
  fields: [
    {
      name: 'projectLens', control: 'select', section: 'basic', labelKey: 'projectView', surface: 'full',
      options: [
        { value: 'everything', labelKey: 'lensEverything' },
        { value: 'delivery', labelKey: 'lensDelivery' },
        { value: 'metrics', labelKey: 'lensMetrics' },
        { value: 'customer-feedback', labelKey: 'lensFeedback' },
      ],
    },
  ],
  actions: [
    { name: 'visualizeQuality', labelKey: 'visualizeQuality', style: 'primary', handler: 'loadProjectQuality' },
    { name: 'addRelated', labelKey: 'addRelatedItems', style: 'primary', handler: 'expandProject' },
    { name: 'compare', labelKey: 'compareProjects', style: 'primary', handler: 'compareProjects' },
  ],
});

registerKindSettings({
  kinds: ['file'],
  marketplace: { sellable: () => true },
  hintKey: 'fileInspectorHint',
  fields: [
    // Falls back to the object's own title when no `fileName` was captured on import —
    // a file always has SOME name to show, even before one was authored separately.
    { name: 'fileName', control: 'text', section: 'basic', labelKey: 'fileNameLabel', surface: 'full', fallbackField: 'title' },
  ],
  actions: [],
});

registerKindSettings({
  kinds: ['standup'],
  marketplace: { sellable: () => false },
  hintKey: 'standupHint',
  fields: [],
  actions: [{ name: 'gather', labelKey: 'gatherStandup', style: 'primary', handler: 'startStandup' }],
});

registerKindSettings({
  kinds: ['mockupSet'],
  marketplace: { sellable: () => true },
  hintKey: 'mockupSetHint',
  fields: [],
  actions: [
    { name: 'expandAll', labelKey: 'expandAllMockups', style: 'primary', handler: 'expandMockupSet' },
    { name: 'deliver', labelKey: 'addToProjectAssign', style: 'primary', handler: 'deliverMockup' },
  ],
});

registerKindSettings({
  kinds: ['projectComparison'],
  marketplace: { sellable: () => false },
  hintKey: 'portfolioViewHint',
  fields: [],
  actions: [{ name: 'refresh', labelKey: 'refreshQualityComparison', style: 'primary', handler: 'compareProjects' }],
});

registerKindSettings({
  kinds: ['frame'],
  // A frame is board furniture — it groups objects, it does not become a listing.
  marketplace: { sellable: () => false },
  fields: [
    { name: 'framePurpose', control: 'text', section: 'basic', labelKey: 'purpose', surface: 'full', fallbackKey: 'arrangeObjectsHere' },
    { name: 'frameColor', control: 'color', section: 'basic', labelKey: 'fillColor', surface: 'full', defaultColor: AUTHORED_FRAME_FILL },
    { name: 'frameBorder', control: 'color', section: 'basic', labelKey: 'borderColor', surface: 'full', defaultColor: AUTHORED_FRAME_BORDER },
    // WHERE THIS FRAME COMES IN A PRESENTATION. Empty is the normal case and means
    // "wherever the board reads": `presentationSequence` walks unnumbered frames in
    // reading order, so a person only reaches for this when they want a different
    // one. Advanced rather than basic for exactly that reason — it is the field you
    // go looking for, not one you have to answer to make a frame.
    { name: 'presentationOrder', control: 'number', section: 'advanced', labelKey: 'presentationOrder', surface: 'full', min: 1, fallbackKey: 'presentationOrderHint' },
    // A section of steps IS a workflow, so it carries the two controls a workflow has
    // always needed to actually run: WHERE it runs, and whether a human gates it. They
    // are the same two the `workflow` card declares above — the same option values,
    // resolved by the same endpoint — because they are the same question asked of the
    // thing that now bounds a flow. Without them a built section saved with no runtime
    // and refused at run time, pointing at a control it did not have.
    { name: 'runTarget', control: 'select', section: 'advanced', labelKey: 'executionTarget', surface: 'full',
      options: [{ value: 'builderforce', label: 'BuilderForce.AI' }, { value: 'campaign-strategist', label: 'Campaign Strategist' }] },
    { name: 'approvalMode', control: 'select', section: 'advanced', labelKey: 'approvalMode', surface: 'full',
      options: [{ value: 'required', labelKey: 'approvalRequiredBeforePublish' }, { value: 'autonomous', labelKey: 'fullyAutonomous' }] },
  ],
  // A frame holds a SECTION, and a section of steps is a workflow — so the two
  // actions a flow needs live on the thing that bounds it. Build compiles the steps
  // inside this frame into a real definition; Run executes what was built. Neither is
  // hidden when the frame holds no steps: the compiler's own message ("this flow has
  // no steps") is a better answer than a control that silently is not there.
  actions: [
    { name: 'buildFlow', labelKey: 'buildFlow', style: 'primary', handler: 'buildFlow' },
    { name: 'runFlow', labelKey: 'runFlow', style: 'primary', handler: 'run' },
    { name: 'savePreset', labelKey: 'saveReusableFrame', style: 'primary', handler: 'saveFramePreset' },
  ],
  // What the section HOLDS, when what it holds is a flow — the step count, the
  // in-browser Evermind runner for a section of build steps, and the pipelines an
  // empty one can start from. None of it is a declarable field: every answer is
  // computed from the objects inside the frame. See `FrameFlowSection`.
  custom: { component: 'frame' },
});

// `document`/`prd`/`knowledge`/`note`/`report` share one label; `slides` is registered
// separately because its label, placeholder and the field it mirrors into read
// "deck outline" rather than "document body" — a genuinely different word, not a
// cosmetic variant, so it earns its own manifest rather than a conditional label.
const documentEditorMarkdownField = (labelKey: string, placeholderKey: string) => ({
  name: 'markdown',
  control: 'textarea' as const,
  section: 'basic' as const,
  labelKey,
  placeholderKey,
  surface: 'full' as const,
  toPatch: (value: unknown) => ({ markdown: value, content: value }),
});

registerKindSettings({
  kinds: [...DOCUMENT_EDITOR_KINDS].filter((kind) => kind !== 'slides'),
  marketplace: { sellable: () => true },
  fields: [documentEditorMarkdownField('documentBody', 'documentBodyPlaceholder')],
  actions: [],
});

registerKindSettings({
  kinds: ['slides'],
  marketplace: { sellable: () => true },
  fields: [documentEditorMarkdownField('deckOutline', 'deckOutlinePlaceholder')],
  actions: [],
});
