'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import ProjectBackendPanel from '@/components/ProjectBackendPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  challengeApi,
  realizationApi,
  type BackendStrategyKey,
  type ChallengeSetupStep,
  type ChallengeSpec,
  type HostingStrategySummary,
  type Realization,
  type RealizationBuildResult,
  type RealizationKey,
  type RealizationRecommendation,
  type RealizationTargetSummary,
} from '@/lib/builderforceApi';

/**
 * Realize — idea in, something a person can open out.
 *
 * Three acts, and the middle one is the whole point. Reading the idea is cheap;
 * BUILDING is not; and the decision between them — which proof is worth running
 * — is the most consequential choice in the first month of any idea. So the
 * picker is the centre of this page rather than a dropdown on the way to a
 * build, and every card leads with the QUESTION its proof answers rather than
 * with what it produces.
 *
 * The recommendation deliberately favours the cheapest proof that fits. A page
 * that nudged toward the impressive one would be agreeing with whatever the
 * visitor was already going to do, which is not advice.
 */

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
};

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 8,
};

const chip: React.CSSProperties = {
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: 'var(--radius-full)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-sunken, transparent)',
  color: 'var(--text-secondary)',
  fontSize: 12,
  lineHeight: 1.6,
};

const primaryButton: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  ...primaryButton,
  border: '1px solid var(--border-subtle)',
  background: 'transparent',
  color: 'var(--text-primary)',
};

const codeCell: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12.5,
  color: 'var(--text-primary)',
  background: 'var(--surface-sunken, transparent)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '3px 7px',
  wordBreak: 'break-all',
};

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div style={{ ...card, display: 'grid', gap: 12 }}>
      <div style={label}>{heading}</div>
      {children}
    </div>
  );
}

/** A five-dot meter. Fidelity and effort are the two axes the choice turns on,
 *  and a number out of five reads faster than a word. */
function Meter({ value, title }: { value: number; title: string }) {
  return (
    <span title={title} style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: n <= value ? 'var(--accent)' : 'var(--border-subtle)',
          }}
        />
      ))}
    </span>
  );
}

function TargetCard({
  target,
  recommendation,
  selected,
  onSelect,
  t,
}: {
  target: RealizationTargetSummary;
  recommendation: RealizationRecommendation | undefined;
  selected: boolean;
  onSelect: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        ...card,
        display: 'grid',
        gap: 10,
        textAlign: 'left',
        cursor: 'pointer',
        borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
        boxShadow: selected ? '0 0 0 1px var(--accent)' : 'none',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{target.name}</span>
        {recommendation?.recommended && (
          <span style={{ ...chip, borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            {t('recommended')}
          </span>
        )}
      </div>

      <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, fontStyle: 'italic' }}>
        {target.answers}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{target.summary}</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {t('fidelity')} <Meter value={target.fidelity} title={t('fidelityHint')} />
        </span>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {t('effort')} <Meter value={target.effort} title={t('effortHint')} />
        </span>
      </div>

      {recommendation && recommendation.reasons.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {recommendation.reasons[0]}
        </div>
      )}
    </button>
  );
}

function BuiltView({
  result,
  t,
}: {
  result: RealizationBuildResult;
  t: ReturnType<typeof useTranslations>;
}) {
  const blocking = result.readiness.filter((s) => s.blocking);
  const optional = result.readiness.filter((s) => !s.blocking);

  const Step = ({ step }: { step: ChallengeSetupStep }) => (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{step.label}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        {step.detail}
      </div>
      {step.url && (
        <a href={step.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)' }}>
          {t('openConsole')}
        </a>
      )}
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Section heading={t('itIsRealHeading')}>
        {result.liveUrl ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('liveAt')}</span>
            <a
              href={result.liveUrl}
              target="_blank"
              rel="noreferrer"
              style={{ ...codeCell, color: 'var(--accent)', fontSize: 14 }}
            >
              {result.liveUrl}
            </a>
          </div>
        ) : (
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{t('noPagesPublished')}</div>
        )}

        <div style={{ display: 'grid', gap: 6, fontSize: 14, color: 'var(--text-primary)' }}>
          <div>{t('builtFiles', { files: result.filesWritten.length, handlers: result.handlersWritten.length })}</div>
          <div>{t('builtPublished', { count: result.publishedAssets })}</div>
          <div>{t('builtTickets', { created: result.tasksCreated, skipped: result.tasksSkipped })}</div>
          {result.tasksDispatched > 0 && (
            <div style={{ color: 'var(--success)' }}>{t('builtDispatched', { count: result.tasksDispatched })}</div>
          )}
          {result.collections.length > 0 && (
            <div>{t('builtCollections', { names: result.collections.join(', ') })}</div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('ingressLabel')}</span>
          <span style={codeCell}>{result.ingressUrl}</span>
        </div>
      </Section>

      {blocking.length > 0 && (
        <Section heading={t('blockingHeading', { count: blocking.length })}>
          <div style={{ display: 'grid', gap: 14 }}>
            {blocking.map((s) => <Step key={s.key} step={s} />)}
          </div>
        </Section>
      )}

      {optional.length > 0 && (
        <Section heading={t('nextHeading')}>
          <div style={{ display: 'grid', gap: 14 }}>
            {optional.map((s) => <Step key={s.key} step={s} />)}
          </div>
        </Section>
      )}

      {result.warnings.length > 0 && (
        <Section heading={t('warningsHeading')}>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
            {result.warnings.map((w, i) => (
              <li key={i} style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.55 }}>{w}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

const verdictColor: Record<'met' | 'missed' | 'abandoned', string> = {
  met: 'var(--success)',
  missed: 'var(--danger)',
  abandoned: 'var(--text-secondary)',
};

/**
 * What the success criteria decided — or the prompt to go find out.
 *
 * `verdict` is never typed here. `met`/`missed` arrive already decided,
 * rolled up server-side from the number the proof's own console recorded;
 * this only renders what it is handed and offers the one call that IS a
 * person's to make.
 */
function VerdictCard({
  realization,
  onAbandon,
  abandoning,
  t,
}: {
  realization: Realization;
  onAbandon: () => void;
  abandoning: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const { verdict, verdictMetric, decidedAt } = realization;

  if (!verdict) {
    if (realization.status !== 'built') return null;
    return (
      <Section heading={t('verdictHeading')}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {t('verdictNoneYet')}
        </p>
        <div>
          <button
            type="button"
            onClick={onAbandon}
            disabled={abandoning}
            style={{ ...secondaryButton, opacity: abandoning ? 0.6 : 1, fontSize: 13, padding: '8px 14px' }}
          >
            {abandoning ? t('abandoning') : t('markAbandoned')}
          </button>
        </div>
      </Section>
    );
  }

  const rawValue = typeof verdictMetric?.metricValue === 'number' ? verdictMetric.metricValue : null;
  const rawTarget = typeof verdictMetric?.target === 'number' ? verdictMetric.target : null;
  const metricLabel = typeof verdictMetric?.metricLabel === 'string' ? verdictMetric.metricLabel : null;
  // A rate (0–1, e.g. the POC harness's pass rate) reads as a percentage; a
  // count (e.g. signups) reads as itself. Both fields are fractional together
  // or whole together, so testing one decides the other.
  const isRate = rawValue !== null && rawTarget !== null && rawValue <= 1 && rawTarget <= 1;
  const format = (n: number) => (isRate ? `${Math.round(n * 100)}%` : String(n));
  const metricValue = rawValue === null ? null : format(rawValue);
  const target = rawTarget === null ? null : format(rawTarget);

  return (
    <Section heading={t('verdictHeading')}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <span style={{ ...chip, borderColor: verdictColor[verdict], color: verdictColor[verdict], fontWeight: 700 }}>
          {t(`verdictValue.${verdict}`)}
        </span>
        {decidedAt && (
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('decidedOn', { date: new Date(decidedAt).toLocaleDateString() })}
          </span>
        )}
      </div>
      {metricLabel && metricValue !== null && (
        <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
          {target !== null
            ? t('verdictMetricAgainstTarget', { label: metricLabel, value: metricValue, target })
            : t('verdictMetric', { label: metricLabel, value: metricValue })}
        </div>
      )}
      {verdict === 'abandoned' && typeof verdictMetric?.note === 'string' && verdictMetric.note && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{verdictMetric.note}</p>
      )}
      {verdict !== 'abandoned' && (
        <button
          type="button"
          onClick={onAbandon}
          disabled={abandoning}
          style={{ ...secondaryButton, opacity: abandoning ? 0.6 : 1, fontSize: 13, padding: '8px 14px', alignSelf: 'start' }}
        >
          {abandoning ? t('abandoning') : t('markAbandoned')}
        </button>
      )}
    </Section>
  );
}

export default function RealizePage() {
  const t = useTranslations('realize');

  const [idea, setIdea] = useState('');
  const [spec, setSpec] = useState<ChallengeSpec | null>(null);
  const [targets, setTargets] = useState<RealizationTargetSummary[]>([]);
  const [strategies, setStrategies] = useState<HostingStrategySummary[]>([]);
  const [recommendations, setRecommendations] = useState<RealizationRecommendation[]>([]);
  const [chosen, setChosen] = useState<RealizationKey | null>(null);
  const [strategy, setStrategy] = useState<BackendStrategyKey>('declarative');
  const [realization, setRealization] = useState<Realization | null>(null);
  /**
   * Set when this page was opened from a challenge. The proof is then planned
   * from the spec the brief was ALREADY read into rather than from a re-reading
   * of the same words — cheaper, and it cannot disagree with the plan the
   * challenge page is showing next to it.
   */
  const [challengeId, setChallengeId] = useState<string | null>(null);
  /**
   * Set when this page was opened FROM a Creation Session ("make this real").
   *
   * It is what makes the loop measurable: the outcome ledger's grain is the
   * session, so a proof that names its board records Read, Prove, Build and
   * Measure against it, and the platform's north-star metric — the share of
   * ideas that reached a graded proof — has something to count. A proof started
   * without one still works; it simply never enters the ledger.
   */
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [buildResult, setBuildResult] = useState<RealizationBuildResult | null>(null);
  const [history, setHistory] = useState<Realization[]>([]);
  const [reading, setReading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const refresh = useCallback(async () => {
    try {
      setHistory(await realizationApi.list());
    } catch {
      // A failed history load must not block the primary action — the idea box
      // and the Read button work with no history at all.
    }
  }, []);

  useEffect(() => {
    void refresh();
    // The catalog is static and worth having before the first idea is typed, so
    // the eight cards can be shown as soon as there is something to rank.
    realizationApi
      .targets()
      .then(({ targets: list, strategies: hosting }) => {
        setTargets(list);
        setStrategies(hosting);
      })
      .catch(() => undefined);
  }, [refresh]);

  // Opened from a Creation Session: prove that board's idea, and record the
  // loop against it. The idea text is seeded from the board so the visitor
  // lands on a filled box rather than retyping what they already wrote.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    if (session) setSessionId(session);
    const seeded = params.get('idea');
    if (seeded) setIdea(seeded.slice(0, 20_000));
  }, []);

  // Opened from a challenge: reuse the spec the brief was already read into.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('challenge');
    if (!id) return;
    challengeApi
      .get(id)
      .then((challenge) => {
        setChallengeId(challenge.id);
        setSpec(challenge.spec);
        setIdea(challenge.brief);
      })
      .catch(() => undefined);
  }, []);

  const chosenTarget = useMemo(
    () => targets.find((target) => target.key === chosen) ?? null,
    [targets, chosen],
  );

  const read = async () => {
    if (!idea.trim() || reading) return;
    setReading(true);
    setError(null);
    setBuildResult(null);
    setRealization(null);
    // Re-reading edited text means this is no longer the challenge's spec — the
    // words on screen are now the source, and silently planning against the old
    // reading would ignore the edit.
    setChallengeId(null);
    try {
      const result = await realizationApi.plan(idea.trim(), sessionId);
      setSpec(result.spec);
      setTargets(result.targets);
      setRecommendations(result.recommendations);
      setChosen(result.recommendations.find((r) => r.recommended)?.key ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('readFailed'));
    } finally {
      setReading(false);
    }
  };

  const build = async () => {
    if (!chosen || building) return;
    setBuilding(true);
    setError(null);
    try {
      // Planning and building are two calls on the API too. Doing both here on
      // one press is right for this surface: the visitor has already made the
      // decision that matters by choosing a target.
      const planned = realization?.targetKey === chosen
        ? realization
        : await realizationApi.create({
            // A challenge id wins: its spec has already been read and reviewed,
            // and re-reading the same words would risk a proof planned against a
            // different interpretation than the one on screen.
            ...(challengeId ? { challengeId } : { idea: idea.trim() }),
            ...(sessionId ? { sessionId } : {}),
            targetKey: chosen,
            ...(chosenTarget?.allowsStrategyChoice ? { strategy } : {}),
          });
      setRealization(planned);

      const { realization: updated, result } = await realizationApi.build(planned.id);
      if (updated) setRealization(updated);
      setBuildResult(result);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('buildFailed'));
    } finally {
      setBuilding(false);
    }
  };

  const open = async (id: string) => {
    setError(null);
    setBuildResult(null);
    try {
      const found = await realizationApi.get(id);
      setRealization(found);
      setSpec(found.spec);
      setChosen(found.targetKey);
      setStrategy(found.strategy);
      setChallengeId(found.challengeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('readFailed'));
    }
  };

  const abandon = async () => {
    if (!realization || abandoning) return;
    if (!(await confirm({ message: t('abandonConfirm'), confirmLabel: t('markAbandoned'), destructive: true }))) return;
    setAbandoning(true);
    setError(null);
    try {
      const updated = await realizationApi.abandon(realization.id);
      setRealization(updated);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('abandonFailed'));
    } finally {
      setAbandoning(false);
    }
  };

  return (
    <PageContainer>
      <div style={{ display: 'grid', gap: 20, maxWidth: 1080 }}>
        <div>
          <h1 style={{ fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>
            {t('title')}
          </h1>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            {t('subtitle')}
          </p>
        </div>

        <div style={{ ...card, display: 'grid', gap: 12 }}>
          <label htmlFor="realize-idea" style={label}>{t('ideaLabel')}</label>
          <textarea
            id="realize-idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder={t('ideaPlaceholder')}
            rows={6}
            style={{
              width: '100%',
              minHeight: 130,
              resize: 'vertical',
              padding: 12,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated, transparent)',
              color: 'var(--text-primary)',
              fontSize: 14,
              lineHeight: 1.5,
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              onClick={read}
              disabled={reading || !idea.trim()}
              style={{ ...primaryButton, opacity: reading || !idea.trim() ? 0.6 : 1 }}
            >
              {reading ? t('reading') : t('readBtn')}
            </button>
            {realization?.projectId && (
              <a href={`/projects/${realization.projectId}`} style={{ fontSize: 14, color: 'var(--accent)' }}>
                {t('openProject')}
              </a>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {t('twoStepNote')}
          </p>
        </div>

        {error && (
          <div style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)', fontSize: 14 }}>{error}</div>
        )}

        {spec && (
          <Section heading={t('readAsHeading')}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{spec.title}</div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{spec.goal}</p>
            {spec.capabilities?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {spec.capabilities.map((c) => <span key={c} style={chip}>{c}</span>)}
              </div>
            )}
          </Section>
        )}

        {targets.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={label}>{t('pickHeading')}</div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, maxWidth: 720 }}>
              {t('pickHint')}
            </p>
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
              }}
            >
              {targets.map((target) => (
                <TargetCard
                  key={target.key}
                  target={target}
                  recommendation={recommendations.find((r) => r.key === target.key)}
                  selected={chosen === target.key}
                  onSelect={() => setChosen(target.key)}
                  t={t}
                />
              ))}
            </div>
          </div>
        )}

        {chosenTarget?.allowsStrategyChoice && strategies.length > 0 && (
          <Section heading={t('whereHeading')}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {t('whereHint')}
            </p>
            <label htmlFor="realize-strategy" style={{ ...label, marginBottom: 0 }}>{t('strategyLabel')}</label>
            <select
              id="realize-strategy"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as BackendStrategyKey)}
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated, transparent)',
                color: 'var(--text-primary)',
                fontSize: 14,
                maxWidth: 460,
              }}
            >
              {strategies.map((s) => (
                // A native option inherits neither the page background nor its
                // colour in every browser — both are set so it is legible in dark.
                <option
                  key={s.key}
                  value={s.key}
                  style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
                >
                  {s.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {strategies.find((s) => s.key === strategy)?.summary}
            </div>
          </Section>
        )}

        {chosen && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              onClick={build}
              disabled={building || !spec}
              style={{ ...primaryButton, opacity: building || !spec ? 0.6 : 1 }}
            >
              {building ? t('building') : t('buildBtn', { name: chosenTarget?.name ?? '' })}
            </button>
            {!spec && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('readFirst')}</span>}
          </div>
        )}

        {buildResult && <BuiltView result={buildResult} t={t} />}

        {realization?.status === 'built' && (
          <VerdictCard realization={realization} onAbandon={() => void abandon()} abandoning={abandoning} t={t} />
        )}

        {/* Once a project exists the panel is the live view: which endpoints are
            actually serving, the secret they fail closed without, and what has
            reached them. */}
        {realization?.projectId && <ProjectBackendPanel projectId={realization.projectId} />}

        {history.length > 0 && (
          <Section heading={t('historyHeading')}>
            <div style={{ display: 'grid', gap: 8 }}>
              {history.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => void open(r.id)}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    background: realization?.id === r.id ? 'var(--bg-elevated, transparent)' : 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: 14,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{r.title}</span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <span style={chip}>{targets.find((x) => x.key === r.targetKey)?.name ?? r.targetKey}</span>
                    <span style={chip}>{t(`status.${r.status}`)}</span>
                    {r.verdict && (
                      <span style={{ ...chip, borderColor: verdictColor[r.verdict], color: verdictColor[r.verdict] }}>
                        {t(`verdictValue.${r.verdict}`)}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </Section>
        )}
      </div>
    </PageContainer>
  );
}
