'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import ProjectBackendPanel from '@/components/ProjectBackendPanel';
import {
  challengeApi,
  type Challenge,
  type ChallengeBuildResult,
  type ChallengeSetupStep,
} from '@/lib/builderforceApi';

/**
 * Challenges — paste a brief, get a working system.
 *
 * The page is deliberately two acts, mirroring the pipeline. Reading a brief is
 * a model's interpretation of what winning requires, and that interpretation is
 * what a human should check BEFORE a project, a canvas full of files and a board
 * of tickets exist. So "Read the brief" produces something to argue with, and
 * "Build it" is a separate, explicit decision.
 *
 * The readiness list after a build is the honest part: a built system is not a
 * working one until the integrations are connected, the secrets are stored and
 * the provider is pointed at the webhook URL. Showing those as outstanding work
 * beats claiming success and letting the customer discover a 403 in Twilio's
 * console.
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
  padding: '10px 18px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

/** Monospace URL/paths that must scroll rather than widen the page on a phone. */
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

function Bullets({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.55 }}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function PlanView({ challenge, t }: { challenge: Challenge; t: ReturnType<typeof useTranslations> }) {
  const { spec, plan } = challenge;
  const handlerNames = Object.keys(plan.handlers ?? {});

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Section heading={t('goalHeading')}>
        <p style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.55 }}>{spec.goal}</p>
        {spec.capabilities?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {spec.capabilities.map((c) => (
              <span key={c} style={chip}>{c}</span>
            ))}
          </div>
        )}
      </Section>

      <Section heading={t('approachHeading')}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{plan.blueprintName}</div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{plan.summary}</p>
        {plan.matchReasons?.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('matchScore', { score: plan.matchScore })} — {plan.matchReasons.join('; ')}
          </div>
        )}
      </Section>

      {handlerNames.length > 0 && (
        <Section heading={t('endpointsHeading')}>
          <div style={{ display: 'grid', gap: 8 }}>
            {handlerNames.map((name) => {
              const h = plan.handlers[name] as { route?: string; method?: string; verify?: string; description?: string };
              return (
                <div key={name} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                  <span style={codeCell}>{h.method ?? 'POST'} {h.route ?? `/${name}`}</span>
                  <span style={chip}>{h.verify === 'none' ? t('unverified') : t('verifiedVia', { kind: h.verify ?? '' })}</span>
                  {h.description && (
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{h.description}</span>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {plan.requiredConnectors?.length > 0 && (
        <Section heading={t('integrationsHeading')}>
          <div style={{ display: 'grid', gap: 10 }}>
            {plan.requiredConnectors.map((c) => (
              <div key={c.key}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{c.label}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{c.why}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {plan.requiredSecrets?.length > 0 && (
        <Section heading={t('secretsHeading')}>
          <div style={{ display: 'grid', gap: 10 }}>
            {plan.requiredSecrets.map((s) => (
              <div key={s.name}>
                <span style={codeCell}>{s.name}</span>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 4 }}>{s.where}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {spec.constraints?.length > 0 && (
        <Section heading={t('constraintsHeading')}>
          <Bullets items={spec.constraints} />
        </Section>
      )}

      {plan.successCriteria?.length > 0 && (
        <Section heading={t('successHeading')}>
          <Bullets items={plan.successCriteria} />
        </Section>
      )}

      {plan.tasks?.length > 0 && (
        <Section heading={t('ticketsHeading', { count: plan.tasks.length })}>
          <div style={{ display: 'grid', gap: 10 }}>
            {plan.tasks.map((task, i) => (
              <div key={i}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{task.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{task.description}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {plan.handlerWarnings?.length > 0 && (
        <Section heading={t('warningsHeading')}>
          <Bullets items={plan.handlerWarnings} />
        </Section>
      )}
    </div>
  );
}

function ReadinessView({
  result,
  t,
}: {
  result: ChallengeBuildResult;
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
        <a
          href={step.url}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 13, color: 'var(--accent)' }}
        >
          {t('openConsole')}
        </a>
      )}
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Section heading={t('builtHeading')}>
        <div style={{ display: 'grid', gap: 8, fontSize: 14, color: 'var(--text-primary)' }}>
          <div>{t('builtFiles', { files: result.filesWritten.length, handlers: result.handlersWritten.length })}</div>
          <div>{t('builtTickets', { created: result.tasksCreated, skipped: result.tasksSkipped })}</div>
          {result.tasksDispatched > 0 && (
            <div style={{ color: 'var(--success)' }}>
              {t('builtDispatched', { count: result.tasksDispatched })}
            </div>
          )}
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: 'var(--text-secondary)' }}>{t('ingressLabel')}</span>
            <span style={codeCell}>{result.ingressUrl}</span>
          </div>
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
          <Bullets items={result.warnings} />
        </Section>
      )}
    </div>
  );
}

export default function ChallengesPage() {
  const t = useTranslations('challenges');

  const [brief, setBrief] = useState('');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selected, setSelected] = useState<Challenge | null>(null);
  const [buildResult, setBuildResult] = useState<ChallengeBuildResult | null>(null);
  const [reading, setReading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setChallenges(await challengeApi.list());
    } catch {
      // A failed history load must not block the primary action — the paste box
      // and the read button work with no history at all.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const read = async () => {
    if (!brief.trim() || reading) return;
    setReading(true);
    setError(null);
    setBuildResult(null);
    try {
      const challenge = await challengeApi.create(brief.trim());
      setSelected(challenge);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('readFailed'));
    } finally {
      setReading(false);
    }
  };

  const build = async () => {
    if (!selected || building) return;
    setBuilding(true);
    setError(null);
    try {
      const { challenge, result } = await challengeApi.build(selected.id);
      if (challenge) setSelected(challenge);
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
      const challenge = await challengeApi.get(id);
      setSelected(challenge);
      setBrief(challenge.brief);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('readFailed'));
    }
  };

  const canBuild = useMemo(
    () => !!selected?.plan?.blueprintKey && !building,
    [selected, building],
  );

  return (
    <PageContainer>
      <div style={{ display: 'grid', gap: 20, maxWidth: 980 }}>
        <div>
          <h1 style={{ fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>
            {t('title')}
          </h1>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            {t('subtitle')}
          </p>
        </div>

        <div style={{ ...card, display: 'grid', gap: 12 }}>
          <label htmlFor="challenge-brief" style={label}>{t('briefLabel')}</label>
          <textarea
            id="challenge-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={t('briefPlaceholder')}
            rows={10}
            style={{
              width: '100%',
              minHeight: 180,
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
            <button type="button" onClick={read} disabled={reading || !brief.trim()} style={{ ...primaryButton, opacity: reading || !brief.trim() ? 0.6 : 1 }}>
              {reading ? t('reading') : t('readBtn')}
            </button>
            {selected && (
              <button type="button" onClick={build} disabled={!canBuild} style={{ ...secondaryButton, opacity: canBuild ? 1 : 0.6 }}>
                {building ? t('building') : t('buildBtn')}
              </button>
            )}
            {selected?.projectId && (
              <a href={`/projects/${selected.projectId}`} style={{ fontSize: 14, color: 'var(--accent)' }}>
                {t('openProject')}
              </a>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {t('twoStepNote')}
          </p>
        </div>

        {error && (
          <div style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)', fontSize: 14 }}>
            {error}
          </div>
        )}

        {buildResult && <ReadinessView result={buildResult} t={t} />}
        {/* Once a project exists the panel is the live view: the endpoints that
            are actually serving, the secret they fail closed without, and what
            has reached them. It sits ABOVE the plan, because after a build the
            operator's question is "is it working?", not "what was planned?". */}
        {selected?.projectId && <ProjectBackendPanel projectId={selected.projectId} />}
        {selected && !buildResult && <PlanView challenge={selected} t={t} />}

        {challenges.length > 0 && (
          <Section heading={t('historyHeading')}>
            <div style={{ display: 'grid', gap: 8 }}>
              {challenges.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void open(c.id)}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    background: selected?.id === c.id ? 'var(--bg-elevated, transparent)' : 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: 14,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{c.title}</span>
                  <span style={chip}>{t(`status.${c.status}`)}</span>
                </button>
              ))}
            </div>
          </Section>
        )}
      </div>
    </PageContainer>
  );
}
