'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { detectEvermindRun } from '@/lib/evermindRun';
import { getProjectEvermindHead } from '@/lib/projectEvermindApi';

/**
 * "🧠 Evermind vN · contributed" chip for a single run. Self-gating: renders nothing
 * unless the run's served-model telemetry shows it executed on the project's own
 * Evermind. The "· contributed" suffix is shown when the project's head is in the
 * `connected` (learning) posture — i.e. this run also fed a contribution back — vs a
 * frozen model that only serves. Fully localized; the surrounding run panel is legacy.
 */
export function EvermindRunChip({ models, projectId }: { models: readonly string[]; projectId: number }) {
  const t = useTranslations('evermindRun');
  const run = useMemo(() => detectEvermindRun(models), [models]);
  const [contributing, setContributing] = useState(false);

  useEffect(() => {
    if (!run) { setContributing(false); return; }
    let alive = true;
    getProjectEvermindHead(projectId)
      .then((h) => { if (alive) setContributing(h.mode === 'connected'); })
      .catch(() => { if (alive) setContributing(false); });
    return () => { alive = false; };
  }, [run, projectId]);

  if (!run) return null;
  const label = run.version > 0 ? `🧠 Evermind v${run.version}` : '🧠 Evermind';
  return (
    <span
      title={t('title')}
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--ev-personality, #9085e9)',
        padding: '2px 8px',
        borderRadius: 6,
        background: 'var(--bg-deep)',
        border: '1px solid var(--ev-personality, #9085e9)',
      }}
    >
      {label}
      {contributing && (
        <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {t('contributed')}</span>
      )}
    </span>
  );
}
