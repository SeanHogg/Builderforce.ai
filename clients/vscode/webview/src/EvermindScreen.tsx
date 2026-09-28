/**
 * EvermindScreen — the VS Code sidebar host of the shared <EvermindConsole> (the
 * SAME component the web app embeds in the IDE: one inspect-and-train surface, two
 * hosts). The gateway calls are the shared `createEvermindRestAdapter` over the webview's
 * bearer fetch (CORS allows the `vscode-webview://` origin) — the same adapter Synapse
 * uses — and the host's localized bundle maps onto the labels through the shared
 * `evermindLabelsFromBundle`. What is this host's own: the clipboard and the memory
 * files, which only the extension host can touch.
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
  createEvermindRestAdapter,
  evermindLabelsFromBundle,
  loadEvermindBuilds,
  preferredEvermindBuild,
  type EvermindBuild,
  type EvermindConsoleAdapter,
  type PickedMemory,
} from '@seanhogg/builderforce-brain-ui';
import { authedFetch } from './authedFetch';
import { getToken, onRefresh, refreshToken, request, type InitData } from './vscodeBridge';

export function EvermindScreen({ init }: { init: InitData }) {
  const labels = useMemo(() => ({ ...DEFAULT_EVERMIND_LABELS, ...evermindLabelsFromBundle(init.labels) }), [init.labels]);

  // The tenant's LLM builds — each is its own Evermind. null = still loading.
  const [builds, setBuilds] = useState<EvermindBuild[] | null>(null);
  // The selected build's BACKING storage project id — the Evermind scope.
  const [storageId, setStorageId] = useState<number | null>(null);
  // Bumped by the view's title-bar refresh action (host → 'refresh' message). Re-runs
  // the build-list fetch below AND is forwarded to the console so it reloads in place —
  // this is where the header's old inline `↻` moved to (the VS Code view title bar).
  const [refreshSignal, setRefreshSignal] = useState(0);
  useEffect(() => onRefresh(() => setRefreshSignal((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    const req = authedFetch(init.baseUrl, getToken, () => refreshToken());
    const activeProjectId = init.project?.id ?? null;
    // WHICH Evermind is the active Project's is the SERVER's answer (its head names the
    // build it reads from), not a rule re-derived here — so this view opens on the very
    // model the Brain chat recalls from and badges, and the two never show different
    // versions for the same project.
    const activeHead = activeProjectId == null
      ? Promise.resolve(null)
      : req<{ inheritedFromProjectId?: number }>(`/api/projects/${activeProjectId}/evermind/head`).catch(() => null);
    Promise.all([loadEvermindBuilds(req), activeHead])
      .then(([evermindBuilds, head]) => {
        if (cancelled) return;
        setBuilds(evermindBuilds);
        // Keep a still-valid selection across refreshes; else the Evermind the server
        // resolves for the active Project, then any build grouped under it, then the first.
        setStorageId((cur) => preferredEvermindBuild(evermindBuilds, {
          current: cur,
          resolvedProjectId: head?.inheritedFromProjectId ?? null,
          activeProjectId,
        }));
      })
      .catch(() => { if (!cancelled) setBuilds([]); });
    return () => { cancelled = true; };
  }, [init.baseUrl, init.project?.id, refreshSignal]);

  const adapter = useMemo<EvermindConsoleAdapter>(() => createEvermindRestAdapter({
    request: authedFetch(init.baseUrl, getToken, () => refreshToken()),
    projectId: storageId ?? 0,
    // Diagnostics export goes through the HOST clipboard: a webview is not reliably
    // granted the Clipboard API, and `vscode.env.clipboard` always works.
    copyText: (text) => request<null>('evermind.copyText', { text }).then(() => undefined),
    // Import: the host reads the snapshot or memory folder (fs) and later compacts the
    // absorbed entries to stubs in their own files; the gateway absorbs in between.
    pickMemory: () => request<PickedMemory | null>('evermind.pickMemory'),
    compactMemory: (req) => request<{ compacted: number; bytesSaved: number }>('evermind.compactMemory', { ...req }),
  }), [init.baseUrl, storageId]);

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
    // The view scrolls itself — the shared stylesheet clips `#root` to the viewport,
    // which cut the console off below the fold with no way to reach it.
    <div className="bf-scroll-screen">
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
          // Stamped into the diagnostics export — the two surfaces fail differently, and
          // "which one was this from?" is the first question asked of a pasted report.
          host="vscode"
          // The inline `↻` moved to the VS Code view title bar; drive reloads from there.
          showHeaderRefresh={false}
          refreshSignal={refreshSignal}
          // A sidebar view sits open all day. Once a minute keeps pending/recent current
          // while learning happens (the title-bar refresh is immediate); the console also
          // pauses entirely while the view is hidden.
          refreshMs={60_000}
        />
      )}
    </div>
    </div>
  );
}
