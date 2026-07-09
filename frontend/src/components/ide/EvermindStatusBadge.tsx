'use client';

/**
 * EvermindStatusBadge — a compact, honest indicator of a project's Evermind state,
 * shown in the Brain composer so the user can see, from the chat, whether the project
 * runs on its own self-learning model and whether it is learning.
 *
 * The honesty matters: a project-scoped Brain chat now RECALLS the project's learned
 * memories before answering and, when the project is connected, CONTRIBUTES the turn
 * back (see brain-embedded's run loop + api `learnFromBrainTurn`) — each surfaced as a
 * recall/learn/reconcile step in the transcript. This badge reflects the project's
 * run/learning posture; the recall/contribution happen per-turn in the timeline.
 * Self-gating per the DRY rule: it fetches the (server-cached) head itself and renders
 * nothing until the project has a seeded Evermind. Themed + localized.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getProjectEvermindHead, type ProjectEvermindHead } from '@/lib/projectEvermindApi';

type Posture = 'learning' | 'frozen' | 'off';

export function EvermindStatusBadge({ projectId }: { projectId: number | null }) {
  const t = useTranslations('evermindStatus');
  const [head, setHead] = useState<ProjectEvermindHead | null>(null);

  useEffect(() => {
    if (projectId == null) { setHead(null); return; }
    let alive = true;
    // Server-cached read (version-token keyed) — cheap to call per Brain mount.
    getProjectEvermindHead(projectId).then((h) => { if (alive) setHead(h); }).catch(() => { if (alive) setHead(null); });
    return () => { alive = false; };
  }, [projectId]);

  // Self-gate: nothing to show until the project has a seeded Evermind.
  if (!head || head.version < 1) return null;

  const posture: Posture = !head.inferenceEnabled ? 'off' : head.mode === 'connected' ? 'learning' : 'frozen';
  const stateLabel = posture === 'learning' ? t('learning') : posture === 'frozen' ? t('frozen') : t('off');
  const tone = posture === 'learning' ? '#22c55e' : 'var(--text-muted)';

  return (
    <span
      title={t('tooltip', { version: head.version })}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
        padding: '3px 8px', borderRadius: 999, border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)', color: 'var(--text-secondary)', whiteSpace: 'nowrap', cursor: 'help',
      }}
    >
      <span aria-hidden>🧠</span>
      <span>{t('label')} v{head.version}</span>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: tone }} />
      <span style={{ color: tone }}>{stateLabel}</span>
    </span>
  );
}
