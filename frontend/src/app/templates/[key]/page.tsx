'use client';

/**
 * `/templates/<key>` — one template, read before it is set up.
 *
 * This is the page the picker and the canvas link to when somebody presses an
 * installable entry from a surface that cannot run a guided setup itself. It
 * states what the template needs connected, what it will create and what
 * "working" will look like — then opens the same `GuidedSetupPanel` the gallery
 * opens, so there is one wizard rather than a second one for deep links.
 */

import { use, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { GuidedSetupPanel } from '@/components/templates/GuidedSetupPanel';
import { templatesApi, type TemplateDetail } from '@/lib/templates/api';

const sectionStyle: React.CSSProperties = {
  padding: 18,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
};

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 20px',
  fontSize: '0.875rem',
  fontWeight: 600,
  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: 'var(--text-on-accent)',
  border: 'none',
  borderRadius: 'var(--radius-lg)',
  cursor: 'pointer',
};

export default function TemplateDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const t = useTranslations('templates');
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    templatesApi
      .get(key)
      .then((res) => {
        if (cancelled) return;
        setDetail(res.template);
        setConnected(res.connectedConnectors);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [key]);

  if (error) {
    return <main style={{ padding: 32, color: 'var(--coral-bright)', fontSize: 13 }}>{error}</main>;
  }
  if (!detail) {
    return <main style={{ padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</main>;
  }

  return (
    <main style={{ padding: 'clamp(16px, 4vw, 32px)', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
      <header style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span aria-hidden><Icon source={detail.icon} size={28} /></span>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(1.25rem, 3vw, 1.5rem)', fontWeight: 700, color: 'var(--text-primary)' }}>
            {detail.name}
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {detail.description || detail.summary}
          </p>
        </div>
        <button type="button" style={primaryBtn} onClick={() => setSetupOpen(true)}>
          {t('startSetup', { count: detail.steps.length })}
        </button>
      </header>

      {detail.requiredConnectors.length > 0 && (
        <section style={sectionStyle}>
          <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t('needsConnected')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {detail.requiredConnectors.map((rc) => (
              <div key={rc.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Icon source={connected.includes(rc.key) ? 'check' : 'link'} size="1em" />
                <div>
                  <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{rc.label}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rc.why}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={sectionStyle}>
        <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t('whatItCreates')}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {detail.outputs.map((o) => (
            <li key={o.id} style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {o.name ?? o.label ?? o.id} <span style={{ color: 'var(--text-muted)' }}>· {t(`outputKind.${o.kind}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {detail.successCriteria.length > 0 && (
        <section style={sectionStyle}>
          <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t('workingMeans')}</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detail.successCriteria.map((c) => (
              <li key={c} style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <GuidedSetupPanel
        templateKey={detail.key}
        templateName={detail.name}
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
      />
    </main>
  );
}
