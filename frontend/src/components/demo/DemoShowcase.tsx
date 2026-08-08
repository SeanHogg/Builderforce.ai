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

/** Compact product-area marks — presentation only; copy comes from i18n. */
const PERSONA_META: Record<DemoPersona, { icon: string; accent: string }> = {
  'ai-team': { icon: 'AI', accent: 'var(--coral-bright)' },
  insights: { icon: 'BI', accent: 'var(--cyan-bright)' },
  pmo: { icon: 'PM', accent: 'var(--coral-bright)' },
  talent: { icon: 'HR', accent: 'var(--cyan-bright)' },
  governance: { icon: 'GV', accent: 'var(--coral-bright)' },
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
    <section className="demo-showcase" id="demos">
      <div className="demo-showcase-inner">
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
  .demo-showcase { border-top: 1px solid var(--border-subtle); }
  .demo-showcase-inner { max-width: 1160px; margin: 0 auto; padding: clamp(76px,9vw,120px) 24px; }
  .demo-showcase-lead {
    max-width: 720px; margin: 8px auto 0; text-align: center;
    font-size: 16px; line-height: 1.6; color: var(--text-secondary, #aab3c5);
  }
  .demo-showcase-grid {
    display: grid; gap: 16px; margin-top: 36px;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
  .demo-card {
    display: flex; flex-direction: column; gap: 8px; text-align: left; cursor: pointer;
    position: relative; overflow: hidden; padding: 26px; border-radius: 14px; font-family: inherit;
    background: var(--surface-card-strong);
    border: 1px solid var(--border-subtle);
    box-shadow: 0 1px 0 var(--surface-inset-highlight);
    transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  }
  .demo-card:hover:not(:disabled) {
    transform: translateY(-3px);
    border-color: var(--card-accent);
    box-shadow: 0 18px 44px var(--shadow-coral-soft);
  }
  .demo-card:focus-visible { outline: 2px solid var(--card-accent); outline-offset: 2px; }
  .demo-card:disabled { cursor: default; opacity: 0.85; }
  .demo-card-icon {
    width: 42px; height: 42px; display: grid; place-items: center; margin-bottom: 18px;
    border: 1px solid color-mix(in srgb, var(--card-accent) 35%, var(--border-subtle));
    border-radius: 10px; background: color-mix(in srgb, var(--card-accent) 12%, transparent);
    color: var(--card-accent); font: 750 11px/1 var(--font-mono); letter-spacing: .06em;
  }
  .demo-card-title { margin: 6px 0 0; font-size: 16px; font-weight: 680; color: var(--text-primary); }
  .demo-card-audience { margin: 0; font-size: 12.5px; font-weight: 600; letter-spacing: 0.02em; color: var(--card-accent); text-transform: uppercase; }
  .demo-card-desc { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-secondary); flex: 1 1 auto; }
  .demo-card-cta { margin-top: 8px; font-size: 14px; font-weight: 700; color: var(--card-accent); }
  .demo-showcase-error { margin: 16px auto 0; text-align: center; color: var(--error-text); font-size: 14px; }
  .demo-showcase-note { margin: 18px auto 0; text-align: center; font-size: 13px; color: var(--text-muted); }
`;
