/**
 * EvermindScreen — the VS Code sidebar host of the shared <EvermindConsole> (the
 * SAME component the web app embeds in the IDE: one inspect-and-train surface, two
 * hosts). It wires the console's data + mutations to the gateway over the webview's
 * bearer fetch (CORS allows the `vscode-webview://` origin), and maps the host's
 * localized label bundle onto the console's labels.
 *
 * A Project can group MANY IDE builds, and each LLM build is its OWN Evermind — the
 * model lives on the build's BACKING storage project (`storageProjectId`), which is
 * exactly the id `/api/projects/:id/evermind` operates on. So this screen lists the
 * tenant's LLM builds and lets you PICK which one to inspect (defaulting to one under
 * the sidebar's active Project), rather than being pinned to the container project —
 * which has no Evermind of its own. See [[evermind-learning-architecture]],
 * [[ide-projects-child-entity]].
 */
import { useEffect, useMemo, useState } from 'react';
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

/** One row from GET /api/ide-projects — an IDE build. An LLM build's Evermind lives
 *  on its backing `storageProjectId`; `containerProjectId` is the Project it's grouped under. */
interface IdeProjectRow {
  id: number;
  name: string;
  modality: string;
  storageProjectId: number;
  containerProjectId: number | null;
  containerName: string | null;
}

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

  // The tenant's LLM builds — each is its own Evermind. null = still loading.
  const [builds, setBuilds] = useState<IdeProjectRow[] | null>(null);
  // The selected build's BACKING storage project id — the Evermind scope.
  const [storageId, setStorageId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const req = authedFetch(init.baseUrl, getToken, () => refreshToken());
    req<IdeProjectRow[]>('/api/ide-projects')
      .then((rows) => {
        if (cancelled) return;
        const llm = (rows ?? []).filter((r) => r.modality === 'llm');
        setBuilds(llm);
        setStorageId((cur) => {
          // Keep a still-valid selection across refreshes; else prefer a build grouped
          // under the sidebar's active Project, falling back to the first available.
          if (cur != null && llm.some((r) => r.storageProjectId === cur)) return cur;
          const preferred = llm.find((r) => r.containerProjectId === init.project?.id) ?? llm[0];
          return preferred?.storageProjectId ?? null;
        });
      })
      .catch(() => { if (!cancelled) setBuilds([]); });
    return () => { cancelled = true; };
  }, [init.baseUrl, init.project?.id]);

  const adapter = useMemo<EvermindConsoleAdapter>(() => {
    const req = authedFetch(init.baseUrl, getToken, () => refreshToken());
    const base = `/api/projects/${storageId}/evermind`;
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
  }, [init.baseUrl, storageId]);

  // Still loading the build list.
  if (builds == null) {
    return <div className="bf-center"><p>{init.labels['ev.loadingBuilds'] ?? 'Loading models…'}</p></div>;
  }
  // No LLM builds anywhere — nothing to inspect until one is created.
  if (builds.length === 0) {
    return (
      <div className="bf-center">
        <p>{init.labels['ev.noBuilds'] ?? 'No LLM models yet. Create one in the LLM Studio, then it will appear here.'}</p>
      </div>
    );
  }

  const selected = builds.find((r) => r.storageProjectId === storageId) ?? null;
  // Disambiguate the picker with the parent Project only when builds span more than one.
  const multiContainer = new Set(builds.map((b) => b.containerProjectId ?? 0)).size > 1;
  const ungrouped = init.labels['ev.ungrouped'] ?? 'Ungrouped';

  return (
    <div style={{ padding: 12, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Build picker — only meaningful with more than one LLM build. */}
      {builds.length > 1 && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--vscode-descriptionForeground)' }}>{init.labels['ev.buildLabel'] ?? 'Model'}</span>
          <select
            value={storageId ?? ''}
            onChange={(e) => setStorageId(Number(e.target.value))}
            style={{
              padding: '4px 6px', borderRadius: 4, fontSize: '0.82rem',
              background: 'var(--vscode-dropdown-background)',
              color: 'var(--vscode-dropdown-foreground)',
              border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))',
            }}
          >
            {builds.map((b) => (
              <option key={b.storageProjectId} value={b.storageProjectId}>
                {multiContainer ? `${b.name} — ${b.containerName ?? ungrouped}` : b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {storageId != null && (
        // Remount on selection so the console's internal load/seed state resets cleanly.
        <EvermindConsole
          key={storageId}
          adapter={adapter}
          canManage={!!init.canManage}
          projectName={selected?.name}
          labels={labels}
        />
      )}
    </div>
  );
}
