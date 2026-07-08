/**
 * EvermindScreen — the VS Code sidebar host of the shared <EvermindConsole> (the
 * SAME component the web app embeds in the IDE agent panel: one inspect-and-train
 * surface, two hosts). It wires the console's data + mutations to the gateway over
 * the webview's bearer fetch (CORS allows the `vscode-webview://` origin), and maps
 * the host's localized label bundle onto the console's labels. Scoped to the
 * sidebar's active project (the host re-posts `init` on project switch, remounting
 * this screen). See [[evermind-learning-architecture]].
 */
import { useMemo } from 'react';
import {
  EvermindConsole,
  DEFAULT_EVERMIND_LABELS,
  type EvermindConsoleAdapter,
  type EvermindConsoleLabels,
} from '@seanhogg/builderforce-brain-ui';
import { authedFetch } from './authedFetch';
import { getToken, refreshToken, type InitData, type LabelBundle } from './vscodeBridge';

interface TenantModelRow { slug?: string; name?: string; baseModel?: string | null }
interface LlmModelsResponse { codingModels?: string[]; premium?: boolean; effectivePlan?: string }

/** Read a localized string from the host bundle (`ev.*` keys), else the English default. */
function evLabels(labels: LabelBundle): Partial<EvermindConsoleLabels> {
  const s = (key: string): string | undefined => labels[`ev.${key}`];
  // Only map the static strings from the bundle; parametric ones keep their English
  // defaults unless the host provides a template we interpolate below.
  const out: Partial<EvermindConsoleLabels> = {};
  const keys: string[] = [
    'title', 'description', 'loading', 'managerOnlyHint', 'statusUnseeded', 'pickModelLabel',
    'noModels', 'notSetUp', 'enableCta', 'working', 'versionLabel', 'contributionsLabel',
    'pendingLabel', 'lastLearnedLabel', 'neverLearned', 'inferenceLabel', 'inferenceHint',
    'learningLabel', 'learningHint', 'on', 'off', 'connected', 'frozen', 'teacherLabel',
    'teacherHint', 'teacherNone', 'teacherPaidOnly', 'teachTitle', 'teachHint',
    'teachPromptPlaceholder', 'teachTextPlaceholder', 'teachCta', 'teaching', 'taught',
    'flushCta', 'flushing', 'flushedNone', 'inspectTitle', 'inspectEmpty', 'kindText',
    'kindDelta', 'deltaEntry', 'refresh', 'errorGeneric',
  ];
  for (const k of keys) {
    const v = s(k);
    if (v != null) (out as Record<string, unknown>)[k] = v;
  }
  // Parametric strings: interpolate the host template when present.
  const seeded = s('statusSeeded');
  if (seeded) out.statusSeeded = (version) => seeded.replace('{version}', String(version));
  const flushedN = s('flushedN');
  if (flushedN) out.flushedN = (merged, version) => flushedN.replace('{merged}', String(merged)).replace('{version}', String(version));
  return out;
}

export function EvermindScreen({ init }: { init: InitData }) {
  const labels = useMemo(() => ({ ...DEFAULT_EVERMIND_LABELS, ...evLabels(init.labels) }), [init.labels]);

  const adapter = useMemo<EvermindConsoleAdapter>(() => {
    const req = authedFetch(init.baseUrl, getToken, () => refreshToken());
    const pid = init.project?.id;
    const base = `/api/projects/${pid}/evermind`;
    return {
      loadData: () => req(`${base}/contributions`),
      loadSeedModels: async () => {
        const r = await req<{ models?: TenantModelRow[] }>('/api/llm/models');
        return (r.models ?? [])
          .filter((m): m is TenantModelRow & { slug: string } => typeof m.slug === 'string' && !!m.baseModel?.startsWith('evermind/'))
          .map((m) => ({ slug: m.slug, name: m.name?.trim() || m.slug }));
      },
      loadTeacherOptions: async () => {
        const r = await req<LlmModelsResponse>('/llm/v1/models');
        return { models: r.codingModels ?? [], isPaid: r.premium === true || (r.effectivePlan != null && r.effectivePlan !== 'free') };
      },
      seedFromModel: (slug) => req(`${base}/seed-from-model`, { method: 'POST', body: JSON.stringify({ slug }) }).then(() => undefined),
      setInference: (enabled) => req(`${base}/inference`, { method: 'PATCH', body: JSON.stringify({ enabled }) }).then(() => undefined),
      setMode: (mode) => req(`${base}/mode`, { method: 'PATCH', body: JSON.stringify({ mode }) }).then(() => undefined),
      setTeacher: (model) => req(`${base}/teacher`, { method: 'PATCH', body: JSON.stringify({ model }) }).then(() => undefined),
      teach: (text, prompt) => req(`${base}/learn-text`, { method: 'POST', body: JSON.stringify({ text, ...(prompt ? { prompt } : {}) }) }).then(() => undefined),
      flush: () => req<{ merged?: number; version?: number }>(`${base}/flush`, { method: 'POST' }).then((r) => ({ merged: r.merged ?? 0, version: r.version ?? 0 })),
    };
  }, [init.baseUrl, init.project?.id]);

  // Evermind is per-project: without an active project there's nothing to inspect.
  if (init.project?.id == null) {
    return (
      <div className="bf-center">
        <p>{init.labels['ev.noProject'] ?? 'Select a project in the sidebar to inspect its Evermind.'}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, boxSizing: 'border-box' }}>
      <EvermindConsole adapter={adapter} canManage={!!init.canManage} projectName={init.project?.name} labels={labels} />
    </div>
  );
}
