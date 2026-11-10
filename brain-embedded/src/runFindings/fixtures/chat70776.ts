/**
 * A synthesized replay of VS Code chat #70776 (PRD 46 §1) — "Review the Visualizer and add a few more visualization
 * cameras", served end to end by `local/kimi-code/kimi-for-coding`. Built with {@link TraceBuilder}, so every step is
 * in its producer's shape; the turn counts, durations and token figures are the run's own turn log.
 *
 *   turns 1–20   plan, read-only (one `file_outline` fails), readiness claimed on 11/12/20 and not kept
 *   turn 21      the analysis budget forces `hand_off` (1 tool advertised, 19.7 KB of arguments, 123 s); the hand-off
 *                files 4 local tickets, each carrying the same ~5 KB "Context:" block; nobody is dispatched
 *   turns 22–42  code, same model: 13 single-write turns, ZERO checks; the 7th write (`labels.ts`) closes
 *                `SURFACE_DEFAULTS` early; the user stops the run.
 */
import { LOCAL_TICKET_CREATE_TOOL } from '../../ticketToolVocabulary';
import { HAND_OFF_MODE_LABEL } from '../../handOffParallelism';
import { TraceBuilder, type BuiltCall } from './traceBuilder';

const KG = 'packages/knowledge-graph-view/src';
const ASK = 'Review the Visualizer and add a few more visualization cameras: a 4+1 architecture view, the architecture style, and the key features.';

const PLAN_CALLS = [2, 2, 2, 2, 2, 2, 2, 3, 2, 2, 4, 3, 1, 4, 1, 2, 3, 2, 3, 3];
const PLAN_MS = [9181, 4354, 6351, 6727, 4463, 4258, 6502, 26436, 8249, 12189, 36878, 51509, 3865, 5295, 3444, 4773, 7779, 7022, 7779, 73933];
const PLAN_COMPLETION = [144, 133, 257, 254, 144, 105, 214, 1028, 284, 451, 1464, 2016, 79, 196, 61, 161, 195, 195, 215, 2831];
const CODE_MS = [18871, 43167, 14289, 14951, 25676, 6353, 12951, 13038, 9598, 7453, 33503, 21520, 18849, 7589, 7034, 18328, 12637, 6756, 20129, 11347, 16629];
const CODE_PROMPT = [90112, 91480, 92733, 93950, 95104, 96620, 97811, 99035, 100247, 101860, 102944, 104105, 105377, 106590, 107812, 108906, 109679, 96410, 97322, 97980, 98703];
const CODE_COMPLETION = [212, 1840, 1610, 980, 1125, 190, 1210, 640, 140, 230, 1904, 1677, 1580, 205, 560, 470, 180, 455, 160, 520, 150];

const READERS: Array<(i: number) => BuiltCall> = [
  (i) => ({ name: 'recall_facts', args: { query: `visualizer cameras ${i}` }, result: { ok: true, facts: [] } }),
  (i) => ({ name: 'list_files', args: { path: `${KG}/surface${i % 2 ? '/drawers' : ''}` }, result: { ok: true, paths: [] } }),
  (i) => ({ name: 'read_file', args: { path: `${KG}/surface/cameras.tsx`, offset: i * 40, limit: 120 }, result: { ok: true, content: '…' } }),
  (i) => ({ name: 'search_code', args: { query: i % 2 ? 'ViewMode' : 'registerCamera' }, result: { ok: true, matches: [] } }),
  (i) => ({ name: 'find_symbol', args: { name: i % 2 ? 'SURFACE_DEFAULTS' : 'CameraSpec' }, result: { ok: true, symbols: [] } }),
  (i) => ({ name: 'file_outline', args: { path: `${KG}/surface/${i % 2 ? 'panels' : 'registry'}.ts` }, result: { ok: true, outline: [] } }),
];

const PLAN_TEXT: Record<number, string> = {
  1: 'Let me start by recalling what I know about the Visualizer and its cameras.',
  8: 'The camera registry lives in surface/cameras.tsx. Let me look at how the drawers are wired.',
  11: 'I have a thorough map of the Visualizer now: the camera registry, the labels and the surface model.',
  12: 'Now I have the full picture of how cameras register. One more look at the features model before I implement.',
  20: 'I have a complete map. Analysis is over; time to implement the three cameras.',
};

/** The planner's research summary: one ~5 KB paragraph, the block every hand-off ticket repeats. */
const SUMMARY = Array.from({ length: 24 }, (_, i) =>
  `Finding ${i + 1}: the Visualizer registers each camera in surface/cameras.tsx with a ViewMode in types.ts, labels in labels/surface.*.ts and a pure model under surface/<camera>/; camera ${i + 1} reuses the shared scene graph.`).join(' ');

const TASKS = [
  { title: '4+1 architecture camera', brief: 'Add the 4+1 view camera. '.repeat(60), paths: [`${KG}/surface/FourPlusOneCamera.tsx`] },
  { title: 'Architecture style camera', brief: 'Add the architecture style camera and its style model. '.repeat(40), paths: [`${KG}/surface/style`] },
  { title: 'Key features camera', brief: 'Add the key features camera and its features model. '.repeat(55), paths: [`${KG}/surface/features`] },
  { title: 'Register the cameras and labels', brief: 'Register the three cameras in the ViewMode union and the label catalogs. '.repeat(48), paths: [`${KG}/labels.ts`, `${KG}/types.ts`] },
];

/** A balanced module body of roughly `lines` lines. */
function moduleBody(name: string, lines: number): string {
  const rows = Array.from({ length: lines }, (_, i) => `  ${name}Row${i}: { id: '${name}-${i}', weight: ${i}, tags: ['${name}', "row"] },`);
  return `export const ${name} = {\n${rows.join('\n')}\n};\n\nexport function ${name}Of(id: string): number {\n  return Object.keys(${name}).indexOf(id);\n}\n`;
}

const component = (name: string): string =>
  `import { useMemo } from 'react';\n\nexport function ${name}({ graph }: { graph: unknown }) {\n  const model = useMemo(() => ({ graph }), [graph]);\n  return <svg data-camera="${name}">{String(!!model)}</svg>;\n}\n`;

const write = (path: string, content: string): BuiltCall => ({ name: 'write_file', args: { path: `${KG}/${path}`, content }, result: { ok: true, bytes: content.length } });
const edit = (path: string, old_string: string, new_string: string): BuiltCall =>
  ({ name: 'edit_file', args: { path: `${KG}/${path}`, old_string, new_string }, result: { ok: true, replacements: 1 } });
const read = (path: string): BuiltCall => ({ name: 'read_file', args: { path: `${KG}/${path}` }, result: { ok: true, content: '…' } });
const search = (query: string): BuiltCall => ({ name: 'search_code', args: { query }, result: { ok: true, matches: [] } });

const LABELS_OLD = 'export const SURFACE_DEFAULTS = {\n  ...CORE_DEFAULTS,\n  ...RESOLVE_DEFAULTS,';
/** The edit that broke `labels.ts`: the spreads were appended and the object closed early. */
const LABELS_BROKEN = `${LABELS_OLD}\n  ...FOUR_PLUS_ONE_DEFAULTS,\n  ...STYLE_DEFAULTS,\n  ...FEATURES_DEFAULTS,\n};`;

/** Code turns 22–42: `null` is a three-call read turn; anything else is the turn's one call and its narration. */
const CODE_STEPS: Array<{ call: BuiltCall; text: string } | null> = [
  null,
  { call: write('surface/style/styleModel.ts', moduleBody('styleModel', 40)), text: "I've written the plan into tasks. Continuing with styleModel.ts for the style camera." },
  { call: write('surface/features/featuresModel.ts', moduleBody('featuresModel', 36)), text: "I've written styleModel.ts. Continuing with featuresModel.ts for the features camera." },
  { call: write('labels/surface.4plus1.ts', moduleBody('fourPlusOneLabels', 18)), text: "I've written featuresModel.ts. Continuing with the 4+1 labels for the camera." },
  { call: write('labels/surface.style.ts', moduleBody('styleLabels', 20)), text: "I've written the 4+1 labels. Continuing with the style labels for the camera." },
  null,
  { call: write('labels/surface.features.ts', moduleBody('featuresLabels', 22)), text: "I've written the style labels. Continuing with the features labels for the camera." },
  { call: edit('labels.ts', LABELS_OLD, LABELS_BROKEN), text: 'Continuing the wiring: the new label defaults go into labels.ts.' },
  { call: read('labels.ts'), text: 'Continuing the wiring: checking labels.ts.' },
  null,
  { call: write('surface/FourPlusOneCamera.tsx', component('FourPlusOneCamera')), text: 'Continuing the wiring with the 4+1 camera component.' },
  { call: write('surface/ArchitectureStyleCamera.tsx', component('ArchitectureStyleCamera')), text: 'Continuing the wiring with the architecture style camera component.' },
  { call: write('surface/KeyFeaturesCamera.tsx', component('KeyFeaturesCamera')), text: 'Continuing the wiring with the key features camera component.' },
  null,
  { call: edit('types.ts', "export type ViewMode = 'graph' | 'tower';", "export type ViewMode = 'graph' | 'tower' | 'fourPlusOne' | 'style' | 'features';"), text: 'Continuing the wiring: the ViewMode union in types.ts.' },
  { call: edit('surface/style/styleModel.ts', 'weight: 0,', 'weight: 1,'), text: 'Continuing the wiring: the style model weights.' },
  { call: read('surface/style/styleModel.ts'), text: 'Continuing the wiring: checking the style model.' },
  { call: edit('surface/style/styleModel.ts', "tags: ['styleModel', \"row\"]", "tags: ['styleModel', 'layer']"), text: 'Continuing the wiring: the style model tags.' },
  { call: read('labels.ts'), text: 'Continuing the wiring: checking labels.ts again.' },
  { call: edit('labels.ts', '  ...FEATURES_DEFAULTS,', '  ...FEATURES_DEFAULTS,\n  ...AGENT_DEFAULTS,'), text: 'Continuing the wiring: one more label default.' },
  { call: read('surface/cameras.tsx'), text: 'Continuing the wiring: registering the cameras.' },
];

/** The trace and journal of chat #70776, as `traceWithPersistedSteps(messages(), [])` will read them back. */
export function buildChat70776(): TraceBuilder {
  const b = new TraceBuilder(ASK, '2026-11-08T14:02:11.000Z');
  let reader = 0;
  PLAN_CALLS.forEach((n, i) => {
    const calls = Array.from({ length: n }, () => READERS[reader++ % READERS.length]!(i));
    // Turn 8's outline asked for a file that does not exist.
    if (i === 7) calls[calls.length - 1] = { name: 'file_outline', args: { path: `${KG}/surface/camerasRegistry.ts` }, result: { ok: false, error: 'file not found' } };
    b.turn({
      role: 'plan', calls, durationMs: PLAN_MS[i], completion: PLAN_COMPLETION[i],
      prompt: Math.round(20_000 + (i * 75_000) / 19), ...(PLAN_TEXT[i + 1] ? { text: PLAN_TEXT[i + 1] } : {}),
    });
  });
  // Turn 21: the budget forces the hand-off — `hand_off` alone is offered and required.
  b.marker('loop.hand_off_due', { planTurns: 20 }, '20 analysis turn(s) with no change and no hand-off — this turn offers hand_off alone and requires the call.');
  b.turn({
    role: 'plan', advertisedTools: 1, durationMs: 123_123, completion: 4887, prompt: 96_204, argBytes: 19_700,
    loopAnswered: [{ name: 'hand_off', args: { summary: SUMMARY, tasks: TASKS } }],
  });
  b.marker('llm.role_handoff', { tasks: TASKS.length, via: 'hand_off' }, `Planning handed off ${TASKS.length} tasks to the coding model.`);
  TASKS.forEach((t, i) => b.tool({
    name: LOCAL_TICKET_CREATE_TOOL,
    args: {
      projectId: '12', title: t.title, taskType: 'task', auto: true, reason: 'hand_off',
      description: [t.brief.trim(), `Paths: ${t.paths.join(', ')}`, `Context: ${SUMMARY}`].join('\n\n'),
    },
    result: { ok: true, id: `0b7c9e2a-70776-4c1d-9f00-00000000000${i + 1}` },
  }));
  b.marker(HAND_OFF_MODE_LABEL, { mode: 'inline', parallelTasks: [], inlineTasks: TASKS.map((t) => t.title), clash: null }, 'All 4 tasks run inline.');
  CODE_STEPS.forEach((s, i) => {
    const calls = s ? [s.call] : [read('surface/cameras.tsx'), search('ViewMode'), read('labels.ts')];
    b.turn({
      role: 'code', calls, durationMs: CODE_MS[i], prompt: CODE_PROMPT[i], completion: CODE_COMPLETION[i],
      ...(s ? { text: s.text } : {}),
    });
  });
  return b.stop('local/kimi-code/kimi-for-coding', 142);
}
