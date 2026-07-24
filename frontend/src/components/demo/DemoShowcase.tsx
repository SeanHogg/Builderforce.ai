'use client';

/**
 * DemoShowcase (migration 0360) — the "try a live demo" section for the marketing
 * landing page. Renders one card per sales persona; clicking a card mints a demo
 * session (seeded persona tenant, no signup) and navigates into the real product.
 *
 * Self-contained: owns its own copy (via the `demo.showcase` i18n namespace),
 * styles (theme-token driven, light+dark, responsive grid), and entry logic.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { startDemoSession, DEMO_PERSONAS, type DemoPersona } from '@/lib/demoApi';

/** Per-persona accent + emoji — presentation only; copy comes from i18n. */
const PERSONA_META: Record<DemoPersona, { icon: string; accent: string }> = {
  'ai-team': { icon: '🤖', accent: 'var(--accent, #4d9eff)' },
  insights: { icon: '📊', accent: 'var(--cyan-bright, #00e5cc)' },
  pmo: { icon: '🗂️', accent: '#a78bfa' },
  talent: { icon: '🧑‍💻', accent: '#f59e0b' },
  governance: { icon: '🛡️', accent: '#34d399' },
};

export function DemoShowcase() {
  const t = useTranslations('demo.showcase');
  const [loading, setLoading] = useState<DemoPersona | null>(null);
  const [error, setError] = useState(false);

  const enter = async (persona: DemoPersona) => {
    if (loading) return;
    setError(false);
    setLoading(persona);
    try {
      const { entryPath } = await startDemoSession(persona);
      // Full navigation so AuthProvider rehydrates the signed-in demo session.
      window.location.assign(entryPath);
    } catch {
      setError(true);
      setLoading(null);
    }
  };

  return (
    <section className="lp-section demo-showcase" id="demos">
      <div className="lp-features">
        <h2 className="section-title">
          <span className="agentHost-accent">⟩</span> {t('heading')}
        </h2>
        <p className="demo-showcase-lead">{t('lead')}</p>

        <div className="demo-showcase-grid">
          {DEMO_PERSONAS.map((persona) => {
            const meta = PERSONA_META[persona];
            const isLoading = loading === persona;
            return (
              <button
                key={persona}
                type="button"
                className="demo-card"
                onClick={() => enter(persona)}
                disabled={loading != null}
                aria-busy={isLoading}
                style={{ ['--card-accent' as string]: meta.accent }}
              >
                <span className="demo-card-icon" aria-hidden>{meta.icon}</span>
                <h3 className="demo-card-title">{t(`personas.${persona}.title`)}</h3>
                <p className="demo-card-audience">{t(`personas.${persona}.audience`)}</p>
                <p className="demo-card-desc">{t(`personas.${persona}.desc`)}</p>
                <span className="demo-card-cta">
                  {isLoading ? t('launching') : t('launch')}
                  {!isLoading && <span aria-hidden> →</span>}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p className="demo-showcase-error" role="alert">{t('error')}</p>}
        <p className="demo-showcase-note">{t('note')}</p>
      </div>

      <style>{styles}</style>
    </section>
  );
}

const styles = `
  .demo-showcase-lead {
    max-width: 720px; margin: 8px auto 0; text-align: center;
    font-size: 16px; line-height: 1.6; color: var(--text-secondary, #aab3c5);
  }
  .demo-showcase-grid {
    display: grid; gap: 18px; margin-top: 28px;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
  .demo-card {
    display: flex; flex-direction: column; gap: 8px; text-align: left; cursor: pointer;
    padding: 22px; border-radius: 16px; font-family: inherit;
    background: var(--surface-card, rgba(255,255,255,0.03));
    border: 1px solid var(--border, rgba(255,255,255,0.12));
    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .demo-card:hover:not(:disabled) {
    transform: translateY(-3px);
    border-color: var(--card-accent);
    box-shadow: 0 12px 32px rgba(0,0,0,0.25);
  }
  .demo-card:focus-visible { outline: 2px solid var(--card-accent); outline-offset: 2px; }
  .demo-card:disabled { cursor: default; opacity: 0.85; }
  .demo-card-icon {
    width: 46px; height: 46px; display: grid; place-items: center; font-size: 24px;
    border-radius: 12px; background: color-mix(in srgb, var(--card-accent) 16%, transparent);
  }
  .demo-card-title { margin: 6px 0 0; font-size: 17px; font-weight: 700; color: var(--text-primary, #f0f4ff); }
  .demo-card-audience { margin: 0; font-size: 12.5px; font-weight: 600; letter-spacing: 0.02em; color: var(--card-accent); text-transform: uppercase; }
  .demo-card-desc { margin: 0; font-size: 14px; line-height: 1.5; color: var(--text-secondary, #aab3c5); flex: 1 1 auto; }
  .demo-card-cta { margin-top: 8px; font-size: 14px; font-weight: 700; color: var(--card-accent); }
  .demo-showcase-error { margin: 16px auto 0; text-align: center; color: #ff6b6b; font-size: 14px; }
  .demo-showcase-note { margin: 18px auto 0; text-align: center; font-size: 13px; color: var(--text-tertiary, #7c869c); }
`;
