import { useEffect, useState } from 'react';
import { authedFetch } from './authedFetch';
import { getToken, refreshToken } from './vscodeBridge';

/**
 * EvermindStatusBadge (VS Code webview) — parity with the web app's Brain-composer
 * badge (`frontend/src/components/ide/EvermindStatusBadge.tsx`). A compact, honest
 * indicator of the current project's Evermind: whether it runs on its own
 * self-learning model, and whether it is learning.
 *
 * Honesty matters: a Brain *chat* does NOT train the Evermind — only agent TASK RUNS
 * do — so the badge reflects the project's run/learning posture and its tooltip says
 * so. Self-gating: fetches the (server-cached) head itself and renders nothing until
 * the project has a seeded Evermind. Themed via the webview `--bf-*` tokens; labels
 * come from the host bundle with English fallbacks (the webview has no i18n stack).
 */

interface HeadLite {
  version: number;
  mode: 'connected' | 'offline-frozen';
  inferenceEnabled: boolean;
}

export function EvermindStatusBadge({
  baseUrl,
  projectId,
  t,
}: {
  baseUrl: string;
  projectId: number | null;
  t: (key: string, fallback: string) => string;
}) {
  const [head, setHead] = useState<HeadLite | null>(null);

  useEffect(() => {
    if (projectId == null) { setHead(null); return; }
    let alive = true;
    const req = authedFetch(baseUrl, getToken, () => refreshToken());
    // Server-cached read (version-token keyed) — cheap to call per chat mount.
    req<HeadLite>(`/api/projects/${projectId}/evermind/head`)
      .then((h) => { if (alive) setHead(h); })
      .catch(() => { if (alive) setHead(null); });
    return () => { alive = false; };
  }, [baseUrl, projectId]);

  // Self-gate: nothing to show until the project has a seeded Evermind.
  if (!head || head.version < 1) return null;

  const posture = !head.inferenceEnabled ? 'off' : head.mode === 'connected' ? 'learning' : 'frozen';
  const stateLabel = posture === 'learning'
    ? t('ev.status.learning', 'Learning')
    : posture === 'frozen'
      ? t('ev.status.frozen', 'Frozen')
      : t('ev.status.off', 'Off');
  const tone = posture === 'learning' ? '#22c55e' : 'var(--bf-text-muted, #8a8a8a)';

  return (
    <span
      title={t(
        'ev.status.tooltip',
        `Agents on this project run on its Evermind (v${head.version}) and their runs train it. This chat does not train it — open the Evermind view to inspect what it has learned.`,
      )}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
        padding: '3px 8px', borderRadius: 999, border: '1px solid var(--bf-border, rgba(128,128,128,0.35))',
        color: 'var(--bf-text-secondary, #c3c2b7)', whiteSpace: 'nowrap', cursor: 'help',
      }}
    >
      <span aria-hidden>🧠</span>
      <span>{t('ev.status.label', 'Evermind')} v{head.version}</span>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: tone }} />
      <span style={{ color: tone }}>{stateLabel}</span>
    </span>
  );
}
