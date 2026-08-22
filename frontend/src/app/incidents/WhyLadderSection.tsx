'use client';

/**
 * WhyLadderSection — laddered 5-Why capture for an incident's RCA.
 *
 * The post-mortem form already had a "Root cause" textarea, and that is precisely
 * the problem it solves: a textarea collects a CONCLUSION, and the technique is the
 * derivation. Asking for the chain one rung at a time is not decoration — it is what
 * makes the fifth answer different from the first, and it is why the steps are stored
 * as ordered rows (`postmortem_whys`) rather than as lines in a blob.
 *
 * The whole ladder is submitted as a unit (PUT), because an intermediate state where
 * why₃ was deleted and why₄ still claims to answer it is not a chain. Reordering,
 * insertion and removal therefore all edit local state and save once.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { WhyChainChart } from '@/components/charts/WhyChainChart';
import { incidentsApi, type PostmortemWhy } from '@/lib/builderforceApi';

type T = ReturnType<typeof useTranslations>;

/** Mirrors PostmortemWhyService.MAX_WHY_STEPS — the server truncates past this. */
const MAX_STEPS = 7;
/** What "5-Why" means to the people using it; the ladder opens at one rung. */
const CONVENTIONAL_STEPS = 5;

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

interface Draft {
  statement: string;
  isRoot: boolean;
}

const toDraft = (rows: PostmortemWhy[]): Draft[] =>
  rows.map((r) => ({ statement: r.statement, isRoot: r.isRoot }));

export function WhyLadderSection({
  t, tc, canManage, incidentId, incidentTitle, onSaved,
}: {
  t: T;
  tc: T;
  canManage: boolean;
  incidentId: string;
  incidentTitle: string;
  /** The chain write can move `rootCause`, so the detail panel reloads after a save. */
  onSaved?: () => void;
}) {
  const [saved, setSaved] = useState<PostmortemWhy[]>([]);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    incidentsApi.whys(incidentId)
      .then((rows) => { setSaved(rows); setDraft(null); })
      .catch((e: Error) => setError(e.message));
  }, [incidentId]);
  useEffect(() => { load(); }, [load]);

  const editing = draft !== null;
  const steps = draft ?? toDraft(saved);

  const setStep = (i: number, patch: Partial<Draft>) =>
    setDraft((prev) => (prev ?? toDraft(saved)).map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addStep = () =>
    setDraft((prev) => {
      const next = [...(prev ?? toDraft(saved))];
      if (next.length >= MAX_STEPS) return next;
      // A new rung is never the root: the person has not answered it yet. The flag
      // rides the terminal step and the server re-seats it on save.
      return [...next.map((s) => ({ ...s, isRoot: false })), { statement: '', isRoot: false }];
    });
  const removeStep = (i: number) =>
    setDraft((prev) => (prev ?? toDraft(saved)).filter((_, idx) => idx !== i));
  const move = (i: number, delta: number) =>
    setDraft((prev) => {
      const next = [...(prev ?? toDraft(saved))];
      const j = i + delta;
      if (j < 0 || j >= next.length) return next;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const markRoot = (i: number) =>
    setDraft((prev) => (prev ?? toDraft(saved)).map((s, idx) => ({ ...s, isRoot: idx === i ? !s.isRoot : false })));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const rows = await incidentsApi.replaceWhys(incidentId, steps
        .map((s) => ({ statement: s.statement.trim(), isRoot: s.isRoot }))
        .filter((s) => s.statement.length > 0));
      setSaved(rows);
      setDraft(null);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const chartSteps = useMemo(
    () => saved.map((r) => ({ stepNo: r.stepNo, statement: r.statement, isRoot: r.isRoot })),
    [saved],
  );
  const lastIndex = steps.length - 1;

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-secondary)' }}>{t('whys.title')}</span>
        <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', flex: 1, minWidth: 120 }}>{t('whys.hint')}</span>
      </div>

      {error && (
        <div style={{ border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', padding: 8, fontSize: 'var(--font-size-small)' }}>
          {error}
        </div>
      )}

      {/* The saved chain, rendered as a chain. Hidden while editing — the editor IS
          the ladder at that point, and two ladders on screen is one too many. */}
      {!editing && (chartSteps.length > 0 ? (
        <WhyChainChart
          problem={incidentTitle}
          steps={chartSteps}
          ariaLabel={t('whys.aria', { title: incidentTitle })}
          problemLabel={t('whys.problem')}
          stepLabel={(n) => t('whys.step', { n })}
          rootLabel={t('whys.root')}
        />
      ) : (
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('whys.empty')}</span>
      ))}

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t('whys.problem')} — {incidentTitle}
          </div>
          {steps.map((s, i) => (
            <div
              key={i}
              style={{
                display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap',
                // The visible ladder: each rung steps in from the one it answers,
                // capped so a full chain still fits a 360px viewport.
                marginInlineStart: Math.min(i * 14, 70),
              }}
            >
              <span style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, color: 'var(--text-muted)', paddingTop: 10, whiteSpace: 'nowrap' }}>
                {t('whys.step', { n: i + 1 })}
              </span>
              <input
                className="input"
                style={{ flex: 1, minWidth: 140 }}
                value={s.statement}
                onChange={(e) => setStep(i, { statement: e.target.value })}
                placeholder={t('whys.placeholder')}
                aria-label={t('whys.step', { n: i + 1 })}
              />
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('whys.moveUp')}>
                  <Icon source="↑" size="1em" />
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => move(i, 1)} disabled={i === lastIndex} aria-label={t('whys.moveDown')}>
                  <Icon source="↓" size="1em" />
                </button>
                {/* Only the terminal rung can be the root — a step with an answer
                    below it has been answered, so it is not where the asking stopped. */}
                <button
                  type="button"
                  className={s.isRoot ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                  onClick={() => markRoot(i)}
                  disabled={i !== lastIndex}
                  aria-pressed={s.isRoot}
                  title={t('whys.markRoot')}
                >
                  {t('whys.root')}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeStep(i)} aria-label={t('whys.remove')}>
                  <Icon source="✕" size="1em" />
                </button>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addStep} disabled={steps.length >= MAX_STEPS}>
              {t('whys.add')}
            </button>
            <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
              {steps.length >= MAX_STEPS ? t('whys.capReached') : t('whys.cap', { conventional: CONVENTIONAL_STEPS, max: MAX_STEPS })}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !canManage}>
              {busy ? tc('saving') : t('whys.save')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setDraft(null); setError(null); }} disabled={busy}>
              {tc('cancel')}
            </button>
          </div>
        </div>
      )}

      {!editing && (
        <div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setDraft(saved.length ? toDraft(saved) : [{ statement: '', isRoot: false }])}
            disabled={!canManage}
            title={canManage ? undefined : t('needManager')}
          >
            {saved.length ? t('whys.edit') : t('whys.capture')}
          </button>
        </div>
      )}
    </div>
  );
}
