'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import { listEvermindModels, type PublishedEvermindModel } from '@/lib/studioModelsApi';
import {
  getProjectEvermindHead,
  seedProjectEvermindFromModel,
  setProjectEvermindInference,
  setProjectEvermindMode,
  type ProjectEvermindHead,
} from '@/lib/projectEvermindApi';

/**
 * ProjectEvermindPanel — the manager control for a project's self-learning model
 * ([[evermind-learning-architecture]]). It lets a manager promote a published
 * Studio model into the project's learnable base (seed), then flip the two run
 * switches: inference (do this project's agent runs EXECUTE on it) and learning
 * mode (do runs CONTRIBUTE back). Self-gating — the write controls are wrapped in
 * <RoleGate> (rendered disabled for non-managers), and the panel hides entirely
 * until it knows the project isn't already governed elsewhere.
 *
 * Reads the cached `GET …/evermind/head`; writes go through the manager-gated
 * endpoints, then re-read the head so the UI reflects the server truth.
 */
export function ProjectEvermindPanel({ projectId }: { projectId: number }) {
  const t = useTranslations('projectEvermind');
  const { allowed: canManage } = usePermission('project.manageEvermind');

  const [head, setHead] = useState<ProjectEvermindHead | null>(null);
  const [models, setModels] = useState<PublishedEvermindModel[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const h = await getProjectEvermindHead(projectId);
      setHead(h);
    } catch {
      setHead(null);
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Only load the publishable-model list for managers who might seed.
  useEffect(() => {
    if (!canManage) return;
    listEvermindModels()
      .then((list) => {
        setModels(list);
        setSelectedSlug((cur) => cur || (list[0]?.slug ?? ''));
      })
      .catch(() => setModels([]));
  }, [canManage]);

  const run = useCallback(async (op: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await op();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }, [refresh, t]);

  // Don't render until we know the state; keeps the agent panel clean on load.
  if (!loaded) return null;

  const seeded = !!head?.seeded;
  const inferenceOn = !!head?.inferenceEnabled;
  const frozen = head?.mode === 'offline-frozen';

  return (
    <section
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
        background: 'var(--bg-surface)',
        padding: 14,
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      aria-label={t('title')}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span aria-hidden style={{ fontSize: '1.05rem' }}>🧠</span>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('title')}
        </h3>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: 999,
            border: '1px solid var(--border-subtle)',
            background: seeded ? 'var(--success-bg, var(--bg-elevated))' : 'var(--bg-elevated)',
            color: seeded ? 'var(--success-text, var(--text-secondary))' : 'var(--text-secondary)',
          }}
        >
          {seeded ? t('statusSeeded', { version: head?.version ?? 0 }) : t('statusUnseeded')}
        </span>
      </header>

      <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {t('description')}
      </p>

      {!seeded ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {models.length === 0 ? (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              {t('noModels')}
            </p>
          ) : (
            <>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {t('pickModelLabel')}
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Select
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                  disabled={busy}
                  style={{ flex: '1 1 200px', minWidth: 0 }}
                >
                  {models.map((m) => (
                    <option key={m.slug} value={m.slug}>{m.name}</option>
                  ))}
                </Select>
                <RoleGate capability="project.manageEvermind">
                  <button
                    type="button"
                    onClick={() => selectedSlug && run(() => seedProjectEvermindFromModel(projectId, selectedSlug))}
                    disabled={busy || !selectedSlug}
                    style={primaryBtn(busy || !selectedSlug)}
                  >
                    {busy ? t('working') : t('enableCta')}
                  </button>
                </RoleGate>
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Inference switch — do this project's agent runs execute ON the model. */}
          <ToggleRow
            label={t('inferenceLabel')}
            hint={t('inferenceHint')}
            on={inferenceOn}
            busy={busy}
            onToggle={() => run(() => setProjectEvermindInference(projectId, !inferenceOn))}
            onText={t('on')}
            offText={t('off')}
          />
          {/* Learning-mode switch — do runs contribute deltas back. */}
          <ToggleRow
            label={t('learningLabel')}
            hint={t('learningHint')}
            on={!frozen}
            busy={busy}
            onToggle={() => run(() => setProjectEvermindMode(projectId, frozen ? 'connected' : 'offline-frozen'))}
            onText={t('connected')}
            offText={t('frozen')}
          />
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            {t('contributions', { count: head?.contributions ?? 0 })}
          </p>
        </div>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--danger-text, #d33)' }} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    fontSize: '0.8rem',
    fontWeight: 600,
    borderRadius: 8,
    border: '1px solid transparent',
    background: disabled ? 'var(--bg-elevated)' : 'var(--coral-bright, var(--accent, #ff6b5e))',
    color: disabled ? 'var(--text-secondary)' : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  };
}

/** One labelled toggle row — self-gated to managers via RoleGate. */
function ToggleRow({
  label, hint, on, busy, onToggle, onText, offText,
}: {
  label: string; hint: string; on: boolean; busy: boolean;
  onToggle: () => void; onText: string; offText: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{hint}</div>
      </div>
      <RoleGate capability="project.manageEvermind">
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          aria-pressed={on}
          style={{
            padding: '6px 14px',
            fontSize: '0.78rem',
            fontWeight: 700,
            borderRadius: 999,
            border: `1px solid ${on ? 'var(--coral-bright, var(--accent, #ff6b5e))' : 'var(--border-subtle)'}`,
            background: on ? 'var(--coral-bright, var(--accent, #ff6b5e))' : 'var(--bg-elevated)',
            color: on ? '#fff' : 'var(--text-secondary)',
            cursor: busy ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {on ? onText : offText}
        </button>
      </RoleGate>
    </div>
  );
}
