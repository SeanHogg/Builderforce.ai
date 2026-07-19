'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { Select } from '@/components/Select';
import {
  compileApi,
  type CompiledAgentSpec,
  type CompileSurface,
  type DeployPlan,
} from '@/lib/builderforceApi';

/**
 * The plain-language front door to the compile primitive: type a need in prose,
 * the platform compiles it into an `AgentSpec`, resolves the deploy plan for the
 * chosen surface, and (on Run) drives a real first turn through the gateway. This
 * is "any human defines a need, the agentic system solves it" made literal — see
 * `PRD-agent-compile-primitive.md`.
 */

const SURFACES: CompileSurface[] = ['cloud-durable', 'ide', 'workflow-node', 'cloud-container', 'desktop'];

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
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

function SpecView({ spec, t }: { spec: CompiledAgentSpec; t: ReturnType<typeof useTranslations> }) {
  const skills = Array.isArray(spec.identity.skills) ? spec.identity.skills : spec.identity.skills ? [String(spec.identity.skills)] : [];
  return (
    <div style={{ ...card, display: 'grid', gap: 12 }}>
      <div style={label}>{t('specHeading')}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{spec.identity.name}</div>
      {spec.identity.title && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{spec.identity.title}</div>}
      {spec.identity.bio && <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>{spec.identity.bio}</p>}
      {skills.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {skills.map((s) => (
            <span key={s} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>{s}</span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>{t('specModel')}: <strong style={{ color: 'var(--text-primary)' }}>{spec.model?.ref ?? (spec.model?.autoRoute ? t('autoRouted') : '—')}</strong></span>
        {spec.persona?.directives?.length ? <span>{t('specPersona')}: <strong style={{ color: 'var(--text-primary)' }}>{spec.persona.directives.length}</strong></span> : null}
        {spec.memory?.recalledContext ? <span>{t('specMemory')}</span> : null}
        {spec.policy?.gates?.length ? <span>{t('specPolicy')}: <strong style={{ color: 'var(--text-primary)' }}>{spec.policy.gates.length}</strong></span> : null}
        {spec.steps?.length ? <span>{t('specSteps')}: <strong style={{ color: 'var(--text-primary)' }}>{spec.steps.length}</strong></span> : null}
      </div>
    </div>
  );
}

function PlanView({ plan, t }: { plan: DeployPlan; t: ReturnType<typeof useTranslations> }) {
  return (
    <div style={{ ...card, display: 'grid', gap: 10 }}>
      <div style={label}>{t('planHeading')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, color: 'var(--text-primary)' }}>
        <span>{t('planSurface')}: <strong>{plan.surface}</strong></span>
        <span>{t('planEngine')}: <strong>{plan.engineId}</strong></span>
        <span>{t('planTransport')}: <strong>{plan.transport}</strong></span>
      </div>
    </div>
  );
}

export default function CompilePage() {
  const t = useTranslations('compile');
  const [text, setText] = useState('');
  const [surface, setSurface] = useState<CompileSurface>('cloud-durable');
  const [spec, setSpec] = useState<CompiledAgentSpec | null>(null);
  const [plan, setPlan] = useState<DeployPlan | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState<'compile' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const need = () => ({ modality: 'prose' as const, text });

  async function onCompile() {
    if (!text.trim() || busy) return;
    setBusy('compile'); setError(null); setOutput(null);
    try {
      const res = await compileApi.compile(need(), surface);
      setSpec(res.spec);
      setPlan(res.plan ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setBusy(null);
    }
  }

  async function onRun() {
    if (!text.trim() || busy) return;
    setBusy('run'); setError(null);
    try {
      const res = await compileApi.run(need());
      setSpec(res.spec);
      setPlan(res.plan);
      setOutput(res.output ?? '');
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageContainer>
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'grid', gap: 20, padding: '8px 0 48px' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>{t('title')}</h1>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>{t('subtitle')}</p>
        </div>

        <div style={{ ...card, display: 'grid', gap: 14 }}>
          <div>
            <div style={label}>{t('needLabel')}</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('needPlaceholder')}
              rows={4}
              style={{
                width: '100%', resize: 'vertical', fontSize: 15, lineHeight: 1.5,
                padding: 12, borderRadius: 10, boxSizing: 'border-box',
                background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('surfaceLabel')}
              <Select
                value={surface}
                onChange={(e) => setSurface(e.target.value as CompileSurface)}
                style={{ fontSize: 13, padding: '6px 10px', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
              >
                {SURFACES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </label>
            <div style={{ flex: 1 }} />
            <button
              onClick={onCompile}
              disabled={!text.trim() || !!busy}
              style={{
                fontSize: 14, fontWeight: 700, padding: '9px 18px', borderRadius: 9, cursor: text.trim() && !busy ? 'pointer' : 'not-allowed',
                background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', opacity: !text.trim() || busy ? 0.6 : 1,
              }}
            >
              {busy === 'compile' ? t('compiling') : t('compileBtn')}
            </button>
            <button
              onClick={onRun}
              disabled={!text.trim() || !!busy}
              style={{
                fontSize: 14, fontWeight: 700, padding: '9px 18px', borderRadius: 9, cursor: text.trim() && !busy ? 'pointer' : 'not-allowed',
                background: 'var(--accent, #e2603f)', color: '#fff', border: '1px solid transparent', opacity: !text.trim() || busy ? 0.6 : 1,
              }}
            >
              {busy === 'run' ? t('running') : t('runBtn')}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ ...card, borderColor: 'var(--warning-border, #b45309)', color: 'var(--warning-text, #b45309)', fontSize: 14 }}>{error}</div>
        )}

        {spec && <SpecView spec={spec} t={t} />}
        {plan && <PlanView plan={plan} t={t} />}

        {output != null && (
          <div style={{ ...card, display: 'grid', gap: 8 }}>
            <div style={label}>{t('outputHeading')}</div>
            <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: 0, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{output || t('outputEmpty')}</p>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
