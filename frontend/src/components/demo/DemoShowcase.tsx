'use client';

/**
 * DemoShowcase (migration 0360) — the "try a live demo" section for the marketing
 * landing page. Renders one card per sales persona; clicking a card mints a demo
 * session (seeded persona tenant, no signup) and navigates into the real product.
 *
 * Self-contained: owns its own copy (via the `demo.showcase` i18n namespace),
 * styles (theme-token driven, light+dark, responsive carousel), and entry logic.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [activeSlide, setActiveSlide] = useState(0);
  const [lastSlide, setLastSlide] = useState(DEMO_PERSONAS.length - 1);
  const trackRef = useRef<HTMLDivElement>(null);

  const syncCarousel = useCallback(() => {
    const track = trackRef.current;
    const firstCard = track?.firstElementChild as HTMLElement | null;
    if (!track || !firstCard) return;

    const styles = window.getComputedStyle(track);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
    const step = firstCard.offsetWidth + gap;
    const visibleCards = Math.max(1, Math.round((track.clientWidth + gap) / step));
    const maxSlide = Math.max(0, DEMO_PERSONAS.length - visibleCards);

    setLastSlide(maxSlide);
    setActiveSlide(Math.min(maxSlide, Math.max(0, Math.round(track.scrollLeft / step))));
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const resizeObserver = new ResizeObserver(syncCarousel);
    resizeObserver.observe(track);
    track.addEventListener('scroll', syncCarousel, { passive: true });
    syncCarousel();

    return () => {
      resizeObserver.disconnect();
      track.removeEventListener('scroll', syncCarousel);
    };
  }, [syncCarousel]);

  const goToSlide = (slide: number) => {
    const track = trackRef.current;
    const target = track?.children.item(slide) as HTMLElement | null;
    const firstCard = track?.firstElementChild as HTMLElement | null;
    if (!track || !target || !firstCard) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ left: target.offsetLeft - firstCard.offsetLeft, behavior: reduceMotion ? 'auto' : 'smooth' });
    setActiveSlide(slide);
  };

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
        <p className="demo-showcase-eyebrow">{t('launch')}</p>
        <h2 className="demo-showcase-heading">{t('heading')}</h2>
        <p className="demo-showcase-lead">{t('lead')}</p>

        <div
          ref={trackRef}
          className="demo-showcase-track"
          role="region"
          aria-label={t('carousel.label')}
        >
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

        <div className="demo-carousel-controls">
          <button
            type="button"
            className="demo-carousel-arrow"
            onClick={() => goToSlide(activeSlide - 1)}
            disabled={activeSlide === 0}
            aria-label={t('carousel.previous')}
          >
            <span aria-hidden>←</span>
          </button>
          <div className="demo-carousel-dots" aria-hidden="true">
            {Array.from({ length: lastSlide + 1 }, (_, slide) => (
              <span
                key={slide}
                className={`demo-carousel-dot${activeSlide === slide ? ' is-active' : ''}`}
              />
            ))}
          </div>
          <button
            type="button"
            className="demo-carousel-arrow"
            onClick={() => goToSlide(activeSlide + 1)}
            disabled={activeSlide === lastSlide}
            aria-label={t('carousel.next')}
          >
            <span aria-hidden>→</span>
          </button>
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
  .demo-showcase-inner { max-width: 1180px; margin: 0 auto; padding: clamp(72px,8vw,108px) clamp(18px,4vw,40px); }
  .demo-showcase-eyebrow { margin: 0 0 12px; color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
  .demo-showcase-heading { max-width: 760px; margin: 0; color: var(--text-primary); font-size: clamp(36px,5vw,58px); line-height: 1.03; letter-spacing: -.04em; }
  .demo-showcase-lead {
    max-width: 720px; margin: 16px 0 0; text-align: left;
    font-size: 17px; line-height: 1.65; color: var(--text-secondary);
  }
  .demo-showcase-track {
    display: flex; gap: 14px; margin-top: 36px; overflow-x: auto; padding: 3px 1px 22px;
    scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-inline: contain;
  }
  .demo-showcase-track::-webkit-scrollbar { display: none; }
  .demo-card {
    display: flex; flex-direction: column; gap: 8px; text-align: left; cursor: pointer;
    position: relative; flex: 0 0 calc((100% - 42px) / 4); min-height: 340px; overflow: hidden; padding: 26px; border-radius: var(--radius-xl); font-family: inherit;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    box-shadow: 0 1px 0 var(--surface-inset-highlight);
    scroll-snap-align: start;
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
    border-radius: var(--radius-lg); background: color-mix(in srgb, var(--card-accent) 12%, transparent);
    color: var(--card-accent); font: 750 11px/1 var(--font-mono); letter-spacing: .06em;
  }
  .demo-card-title { margin: 6px 0 0; font-size: 18px; font-weight: 750; color: var(--text-primary); }
  .demo-card-audience { margin: 0; font-size: 12.5px; font-weight: 600; letter-spacing: 0.02em; color: var(--card-accent); text-transform: uppercase; }
  .demo-card-desc { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-secondary); flex: 1 1 auto; }
  .demo-card-cta { display: inline-flex; align-items: center; margin-top: 12px; font-size: 14px; font-weight: 750; color: var(--card-accent); }
  .demo-carousel-controls { display: flex; align-items: center; justify-content: center; gap: 16px; }
  .demo-carousel-arrow {
    width: 42px; height: 42px; display: grid; place-items: center; padding: 0; border-radius: 50%;
    border: 1px solid var(--border-subtle); background: var(--bg-elevated); color: var(--text-primary);
    font: inherit; font-size: 18px; font-weight: 700; line-height: 1; cursor: pointer;
    transition: border-color .18s ease, color .18s ease, transform .18s ease;
  }
  .demo-carousel-arrow:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); transform: translateY(-1px); }
  .demo-carousel-arrow:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .demo-carousel-arrow:disabled { cursor: default; opacity: .35; }
  .demo-carousel-dots { display: flex; align-items: center; gap: 7px; }
  .demo-carousel-dot { width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--text-muted); opacity: .38; transition: width .18s ease; }
  .demo-carousel-dot.is-active { width: 22px; background: var(--accent); opacity: 1; }
  .demo-showcase-error { margin: 16px auto 0; text-align: center; color: var(--error-text); font-size: 14px; }
  .demo-showcase-note { margin: 18px auto 0; text-align: center; font-size: 13px; color: var(--text-muted); }
  @media (max-width: 1040px) {
    .demo-card { flex-basis: calc((100% - 28px) / 3); }
  }
  @media (max-width: 760px) {
    .demo-card { flex-basis: calc((100% - 14px) / 2); }
  }
  @media (max-width: 560px) {
    .demo-card { flex-basis: 100%; min-height: 330px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .demo-card, .demo-carousel-arrow, .demo-carousel-dot { transition: none; }
    .demo-showcase-track { scroll-behavior: auto; }
  }
`;
