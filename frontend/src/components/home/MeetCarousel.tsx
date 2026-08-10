'use client';

import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HomeButton } from './HomePatterns';
import { observeResizeOnAnimationFrame } from '@/lib/observeResize';

type TitleDesc = { title: string; desc: string };
type RoleDesc = { role: string; desc: string };
type CanvasFeature = { title: string; desc: string };
type CanvasObject = { title: string; meta: string };

const SLIDE_COUNT = 3;
const ROTATION_MS = 7000;

/**
 * `useLayoutEffect` on the client (so the height is written before paint and the
 * transition runs from the previous value), `useEffect` on the server render —
 * React warns about the former during SSR and this component is server-rendered.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The one rotating product story: Create → Evermind → governed delivery.
 *
 * Layout contract — all three slides are stacked in the SAME grid cell and only
 * the active one is visible, so the frame is never padded out to the tallest
 * slide's height (the previous flex track was, which left a slide of whitespace
 * under the shortest slide). The frame's height is driven from the active
 * slide's measured height purely so the resize animates; without JS the active
 * slide is still the only thing in flow, so `height: auto` is already correct.
 *
 * Every slide's styling lives in this file. The first slide previously reached
 * for `.lp-create*` rules that lived in the landing page's <style> block; when
 * the hero was replaced those rules went with it and the slide rendered with no
 * CSS at all. Slide styling stays with the slide markup so that cannot recur.
 */
export function MeetCarousel() {
  const t = useTranslations();
  const [activeSlide, setActiveSlide] = useState(0);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [manualPaused, setManualPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const paused = interactionPaused || manualPaused || reducedMotion;

  const slideNames = [
    t('home.createCanvas.eyebrow'),
    t('evermind.eyebrow'),
    t('home.pillarsHeading'),
  ];

  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const [frameHeight, setFrameHeight] = useState<number>();

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % SLIDE_COUNT);
    }, ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [activeSlide, paused]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotionPreference = () => setReducedMotion(media.matches);
    const syncHash = () => {
      if (window.location.hash === '#evermind') setActiveSlide(1);
      if (window.location.hash === '#create') setActiveSlide(0);
    };
    syncMotionPreference();
    syncHash();
    media.addEventListener('change', syncMotionPreference);
    window.addEventListener('hashchange', syncHash);
    return () => {
      media.removeEventListener('change', syncMotionPreference);
      window.removeEventListener('hashchange', syncHash);
    };
  }, []);

  // Track the active slide's height so the frame can animate between slides of
  // different lengths instead of snapping. ResizeObserver keeps it honest when
  // the copy reflows (locale change, viewport resize, font swap).
  useIsomorphicLayoutEffect(() => {
    const node = slideRefs.current[activeSlide];
    if (!node) return;
    const sync = () => setFrameHeight(node.offsetHeight);
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    return observeResizeOnAnimationFrame(node, sync);
  }, [activeSlide]);

  const move = (direction: -1 | 1) => {
    setActiveSlide((current) => (current + direction + SLIDE_COUNT) % SLIDE_COUNT);
  };

  /** Shared per-slide wiring: stacking state, tab/panel association, measurement. */
  const slideProps = (index: number) => ({
    ref: (node: HTMLElement | null) => { slideRefs.current[index] = node; },
    className: `meet-slide${activeSlide === index ? ' is-active' : ''}`,
    role: 'tabpanel' as const,
    id: `meet-panel-${index}`,
    'aria-labelledby': `meet-tab-${index}`,
    'aria-hidden': activeSlide !== index,
  });

  return (
    <section
      className={`meet-carousel${paused ? ' is-paused' : ''}`}
      id="create"
      aria-roledescription="carousel"
      aria-label={t('home.carousel.label')}
      onMouseEnter={() => setInteractionPaused(true)}
      onMouseLeave={() => setInteractionPaused(false)}
      onFocusCapture={() => setInteractionPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInteractionPaused(false);
      }}
    >
      <div className="meet-carousel-kicker">
        <span>{t('home.carousel.kicker')}</span>
        <span className="meet-carousel-status">
          <span aria-live="polite">0{activeSlide + 1} / 0{SLIDE_COUNT}</span>
          <button
            type="button"
            onClick={() => setManualPaused((value) => !value)}
            aria-label={manualPaused ? t('home.carousel.resume') : t('home.carousel.pause')}
          >
            <span aria-hidden="true">{manualPaused ? <Icon source="▶" size="1em" /> : 'Ⅱ'}</span>
          </button>
        </span>
      </div>

      <div className="meet-carousel-frame">
        <button className="meet-carousel-arrow is-prev" type="button" onClick={() => move(-1)} aria-label={t('home.carousel.previous')}>
          <span aria-hidden="true">←</span>
        </button>

        <div className="meet-carousel-viewport" style={frameHeight ? { height: frameHeight } : undefined}>
          <article {...slideProps(0)}>
            <div className="meet-panel meet-create-panel">
              <div className="meet-panel-head">
                <div>
                  <span className="meet-eyebrow">01 / {t('home.createCanvas.eyebrow')}</span>
                  <h2 className="section-title"><span className="agentHost-accent">⟩</span> {t('home.createCanvas.heading')}</h2>
                </div>
                <p className="meet-slide-lead">{t('home.createCanvas.blurb')}</p>
              </div>

              <div className="meet-create-body">
                <div className="meet-create-features">
                  {(t.raw('home.createCanvas.features') as CanvasFeature[]).map((feature, index) => (
                    <div className="meet-create-feature" key={feature.title}>
                      <span>0{index + 1}</span>
                      <div>
                        <h3>{feature.title}</h3>
                        <p>{feature.desc}</p>
                      </div>
                    </div>
                  ))}
                  <div className="meet-create-actions">
                    <HomeButton href="/create/new" primary arrow>{t('home.createCanvas.startCta')}</HomeButton>
                    <HomeButton href="/creation-canvas">{t('home.createCanvas.exploreCta')}</HomeButton>
                  </div>
                </div>

                <div className="meet-create-board" aria-label={t('home.createCanvas.previewAria')}>
                  <div className="meet-create-toolbar">
                    <i /><i /><i />
                    <span>{t('home.createCanvas.sessionLabel')}</span>
                  </div>
                  <div className="meet-create-objects">
                    {(t.raw('home.createCanvas.objects') as CanvasObject[]).map((object, index) => (
                      <div className="meet-create-object" key={object.title}>
                        <span className="meet-object-index">0{index + 1}</span>
                        <strong>{object.title}</strong>
                        <small>{object.meta}</small>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="meet-create-flow">
                {(t.raw('home.createCanvas.flow') as string[]).map((step, index, steps) => (
                  <span key={step}>
                    {step}
                    {index < steps.length - 1 && <b aria-hidden="true">→</b>}
                  </span>
                ))}
              </div>
            </div>
          </article>

          <article {...slideProps(1)}>
            {/* `#evermind` rides the panel, not the <article> — the article's id
                is what the tab's aria-controls points at. */}
            <div className="meet-panel meet-evermind-panel" id="evermind">
              <div className="meet-panel-head">
                <div>
                  <span className="meet-eyebrow is-cyan">02 / {t('evermind.eyebrow')}</span>
                  <h2 className="section-title"><span className="agentHost-accent">⟩</span> Evermind — {t('evermind.tagline')}</h2>
                </div>
                <p className="meet-slide-lead">{t('evermind.blurb')}</p>
              </div>

              <div className="meet-evermind-body">
                <figure className="meet-evermind-visual" aria-label={t('evermind.visual.aria')}>
                  <figcaption className="meet-evermind-visual-head">
                    <span><i aria-hidden="true" /> {t('evermind.visual.kicker')}</span>
                    <strong>{t('evermind.visual.runtime')}</strong>
                  </figcaption>

                  <div className="meet-evermind-map">
                    <svg className="meet-evermind-connections" viewBox="0 0 720 320" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M184 160 C238 160 254 160 292 160" />
                      <path d="M360 84 C360 111 360 119 360 132" />
                      <path d="M360 236 C360 218 360 207 360 190" />
                      <path d="M536 160 C486 160 468 160 428 160" />
                    </svg>

                    {(t.raw('evermind.architecture.pillars') as TitleDesc[]).map((pillar, index) => (
                      <div className={`meet-evermind-pod is-pod-${index + 1}`} key={pillar.title}>
                        <span>0{index + 1}</span>
                        <strong>{pillar.title}</strong>
                      </div>
                    ))}

                    <div className="meet-evermind-core">
                      <div className="meet-evermind-orbits" aria-hidden="true"><i /><i /><i /></div>
                      <div className="meet-evermind-core-copy">
                        <small>{t('evermind.visual.system')}</small>
                        <strong>Evermind</strong>
                        <span>{t('evermind.visual.core')}</span>
                      </div>
                    </div>
                  </div>

                  <div className="meet-evermind-write">
                    <span className="meet-evermind-write-status"><i aria-hidden="true" /> {t('evermind.visual.status')}</span>
                    <code>{t('evermind.visual.key')}</code>
                    <span className="meet-evermind-old"><small>{t('evermind.visual.previous')}</small> {t('evermind.visual.previousValue')}</span>
                    <b aria-hidden="true">→</b>
                    <span className="meet-evermind-new"><small>{t('evermind.visual.current')}</small> {t('evermind.visual.currentValue')}</span>
                  </div>
                </figure>
                <aside className="meet-evermind-aside">
                  <span className="meet-aside-label">{t('home.carousel.evermindDifference')}</span>
                  {(t.raw('evermind.edges.items') as { label: string; desc: string }[]).map((edge) => (
                    <div className="meet-edge" key={edge.label}>
                      <strong>{edge.label}</strong>
                      <span>{edge.desc}</span>
                    </div>
                  ))}
                  <Link href="/evermind" className="meet-text-link">{t('evermind.exploreCta')} <span aria-hidden="true">→</span></Link>
                </aside>
              </div>
            </div>
          </article>

          <article {...slideProps(2)}>
            <div className="meet-panel meet-delivery-panel">
              <div className="meet-panel-head">
                <div>
                  <span className="meet-eyebrow">03 / {t('home.carousel.deliveryEyebrow')}</span>
                  <h2 className="section-title"><span className="agentHost-accent">⟩</span> {t('home.pillarsHeading')}</h2>
                </div>
                <p className="meet-slide-lead">{t('home.pillarsLead')}</p>
              </div>

              <div className="meet-delivery-body">
                <div className="meet-principles">
                  {(t.raw('home.pillars') as TitleDesc[]).map((pillar, index) => (
                    <div className="meet-principle" key={pillar.title}>
                      <span>0{index + 1}</span>
                      <div><h3>{pillar.title}</h3><p>{pillar.desc}</p></div>
                    </div>
                  ))}
                </div>
                <div className="meet-role-view">
                  <div className="meet-role-heading">
                    <h3>{t('home.rolesHeading')}</h3>
                    <p>{t('home.rolesLead')}</p>
                  </div>
                  <div className="meet-role-list">
                    {(t.raw('home.roles') as RoleDesc[]).map((item, index) => (
                      <div className="meet-role" key={item.role}>
                        <span>0{index + 1}</span>
                        <strong>{item.role}</strong>
                        <p>{item.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>

        <button className="meet-carousel-arrow is-next" type="button" onClick={() => move(1)} aria-label={t('home.carousel.next')}>
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="meet-carousel-nav" role="tablist" aria-label={t('home.carousel.chooseSlide')}>
        {slideNames.map((name, index) => (
          <button
            type="button"
            role="tab"
            id={`meet-tab-${index}`}
            aria-controls={`meet-panel-${index}`}
            aria-selected={activeSlide === index}
            className={activeSlide === index ? 'is-active' : ''}
            onClick={() => setActiveSlide(index)}
            key={name}
          >
            <span aria-hidden="true">0{index + 1}</span>
            <strong>{name}</strong>
            <i aria-hidden="true">{activeSlide === index && <b key={activeSlide} />}</i>
          </button>
        ))}
      </div>

      <style>{`
        /* This is a full homepage section, so it needs the same breathing room
           above and below its content as the shared HomeSection pattern. */
        .meet-carousel { max-width: var(--marketing-max); margin: 0 auto; padding: var(--marketing-section-padding) var(--marketing-gutter); scroll-margin-top: 90px; }
        .meet-carousel-kicker { display:flex; justify-content:space-between; align-items:center; gap:16px; margin:0 64px 14px; color:var(--text-muted); font:600 .68rem/1 var(--font-display); letter-spacing:.16em; text-transform:uppercase; }
        .meet-carousel-kicker > span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .meet-carousel-status { display:flex; align-items:center; gap:12px; flex:none; }
        .meet-carousel-status button { display:grid; width:26px; height:26px; place-items:center; padding:0; border:1px solid var(--border-subtle); border-radius:50%; background:var(--surface-card); color:var(--text-secondary); font-size:var(--font-size-field-label); cursor:pointer; transition:color .2s,border-color .2s; }
        .meet-carousel-status button:hover { color:var(--text-primary); border-color:var(--border-accent); }
        /* The card fills the marketing column and the arrows ride ON it, inset
           from its edges. They used to sit in 64px of side padding OUTSIDE the
           card, which pulled the card 128px narrower than every other band —
           so the one component people look at longest was the one that did not
           line up with the header. */
        .meet-carousel-frame { position:relative; --meet-panel-gutter:clamp(44px,5vw,76px); }

        /*
         * The stack: every slide occupies the same grid cell, so the frame is the
         * height of the ACTIVE slide (JS animates the change; without JS the
         * inactive slides are simply invisible and the cell still sizes to the
         * tallest — acceptable, and never broken).
         */
        .meet-carousel-viewport { position:relative; display:grid; overflow:hidden; border-radius:var(--radius-xl); transition:height .5s cubic-bezier(.22,.78,.25,1); }
        .meet-slide { grid-area:1/1; min-width:0; align-self:start; opacity:0; visibility:hidden; transform:translateY(14px) scale(.985); transform-origin:50% 0; transition:opacity .42s ease, transform .42s cubic-bezier(.22,.78,.25,1), visibility 0s .42s; }
        .meet-slide.is-active { opacity:1; visibility:visible; transform:none; pointer-events:auto; transition:opacity .42s ease, transform .42s cubic-bezier(.22,.78,.25,1), visibility 0s 0s; }
        .meet-slide:not(.is-active) { pointer-events:none; }
        .meet-slide .section-title { margin:0; }
        .meet-slide-lead { margin:0; color:var(--text-secondary); font-size:var(--font-size-body); line-height:1.65; }

        .meet-eyebrow { display:block; margin-bottom:10px; color:var(--coral-bright); font:600 .68rem/1 var(--font-display); letter-spacing:.16em; text-transform:uppercase; }
        .meet-eyebrow.is-cyan { color:var(--cyan-bright); }

        .meet-carousel-arrow { position:absolute; z-index:3; top:50%; width:46px; height:46px; display:grid; place-items:center; transform:translateY(-50%); border:1px solid var(--border-subtle); border-radius:50%; background:var(--surface-card); color:var(--text-secondary); font-size:var(--font-size-card-title); cursor:pointer; backdrop-filter:blur(12px); transition:color .2s,border-color .2s,box-shadow .2s; }
        .meet-carousel-arrow:hover { color:var(--text-primary); border-color:var(--border-accent); box-shadow:0 10px 26px var(--shadow-coral-soft); }
        .meet-carousel-arrow.is-prev { left:14px; }
        .meet-carousel-arrow.is-next { right:14px; }

        /* ── Shared panel frame for all three slides ── */
        .meet-panel { position:relative; overflow:hidden; display:flex; flex-direction:column; gap:26px; padding:40px var(--meet-panel-gutter) 36px; border:1px solid var(--border-accent); border-radius:var(--radius-xl); background:var(--surface-card); box-shadow:inset 0 1px 0 var(--surface-inset-highlight); }
        .meet-panel::before { content:''; position:absolute; top:0; left:var(--meet-panel-gutter); width:96px; height:3px; background:var(--coral-bright); }
        .meet-panel-head { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(280px,.9fr); gap:clamp(24px,4vw,56px); align-items:end; padding-bottom:26px; border-bottom:1px solid var(--border-subtle); }
        .meet-panel h3 { margin:0 0 7px; color:var(--text-primary); font:650 .92rem/1.3 var(--font-display); }
        .meet-panel p { color:var(--text-secondary); }

        /* ── 01 · Meet Create ── */
        .meet-create-panel { background:linear-gradient(140deg,color-mix(in srgb,var(--surface-card-strong) 92%,var(--coral-bright)),var(--surface-card-strong)); }
        .meet-create-body { display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,.85fr); gap:clamp(24px,3vw,44px); align-items:start; }
        .meet-create-features { display:grid; align-content:start; }
        .meet-create-feature { display:grid; grid-template-columns:34px 1fr; gap:14px; padding:18px 0; border-top:1px solid var(--border-subtle); }
        .meet-create-feature:first-child { border-top:0; padding-top:0; }
        .meet-create-feature > span { color:var(--coral-bright); font:600 .66rem/1.5 var(--font-display); letter-spacing:.08em; }
        .meet-create-feature p { margin:0; font-size:var(--font-size-small); line-height:1.6; }
        .meet-create-actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:22px; }
        .meet-create-board { display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); background-color:var(--bg-surface); background-image:radial-gradient(var(--border-subtle) 1px, transparent 1px); background-size:20px 20px; box-shadow:inset 0 1px 0 var(--surface-inset-highlight); }
        .meet-create-toolbar { display:flex; align-items:center; gap:6px; padding-bottom:11px; border-bottom:1px solid var(--border-subtle); color:var(--text-muted); font:600 .64rem/1 var(--font-display); letter-spacing:.04em; }
        .meet-create-toolbar i { width:7px; height:7px; border-radius:50%; background:var(--border-accent); }
        .meet-create-toolbar span { margin-left:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .meet-create-objects { display:grid; gap:9px; }
        .meet-create-object { display:grid; grid-template-columns:auto 1fr; gap:2px 9px; padding:11px 13px; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--bg-elevated); box-shadow:0 8px 20px var(--shadow-coral-soft); }
        .meet-create-object strong { color:var(--text-primary); font:650 .82rem/1.3 var(--font-display); }
        .meet-create-object small { grid-column:2; color:var(--text-muted); font-size:var(--font-size-eyebrow); line-height:1.45; }
        .meet-object-index { grid-row:span 2; color:var(--coral-bright); font:600 .64rem/1.4 var(--font-display); letter-spacing:.08em; }
        .meet-create-flow { display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px; padding-top:22px; border-top:1px solid var(--border-subtle); color:var(--text-secondary); font:600 .74rem/1 var(--font-display); letter-spacing:.04em; }
        .meet-create-flow > span { display:inline-flex; align-items:center; gap:10px; }
        .meet-create-flow b { color:var(--coral-bright); font-weight:600; }

        /* ── 02 · Meet Evermind ── */
        .meet-evermind-panel { background:linear-gradient(120deg,var(--surface-card-strong),color-mix(in srgb,var(--surface-card-strong) 88%,var(--cyan-bright))); }
        .meet-evermind-panel::before { background:var(--cyan-bright); }
        .meet-evermind-panel::after { content:'EM'; position:absolute; right:30px; bottom:-60px; color:color-mix(in srgb,var(--cyan-bright) 6%,transparent); font:800 17rem/1 var(--font-display); letter-spacing:-.09em; pointer-events:none; }
        .meet-evermind-body { position:relative; z-index:1; display:grid; grid-template-columns:minmax(0,1.55fr) minmax(220px,.45fr); gap:clamp(24px,3vw,44px); align-items:start; }
        .meet-evermind-visual { min-width:0; margin:0; overflow:hidden; border:1px solid var(--border-subtle); border-radius:var(--radius-xl); background:color-mix(in srgb,var(--bg-surface) 72%,transparent); box-shadow:inset 0 1px 0 var(--surface-inset-highlight),0 20px 50px color-mix(in srgb,var(--cyan-bright) 8%,transparent); }
        .meet-evermind-visual-head { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:13px 16px; border-bottom:1px solid var(--border-subtle); color:var(--text-muted); font:600 .61rem/1 var(--font-display); letter-spacing:.13em; }
        .meet-evermind-visual-head span { display:flex; align-items:center; gap:8px; }
        .meet-evermind-visual-head i,.meet-evermind-write-status i { width:6px; height:6px; border-radius:50%; background:var(--cyan-bright); box-shadow:0 0 0 4px color-mix(in srgb,var(--cyan-bright) 14%,transparent),0 0 16px var(--cyan-bright); animation:evermind-live 2.2s ease-in-out infinite; }
        .meet-evermind-visual-head strong { color:var(--cyan-bright); font:inherit; white-space:nowrap; }
        .meet-evermind-map { position:relative; height:320px; background-image:linear-gradient(color-mix(in srgb,var(--cyan-bright) 5%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--cyan-bright) 5%,transparent) 1px,transparent 1px); background-size:28px 28px; }
        .meet-evermind-connections { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
        .meet-evermind-connections path { fill:none; stroke:color-mix(in srgb,var(--cyan-bright) 42%,var(--border-subtle)); stroke-width:1.2; stroke-dasharray:5 7; animation:evermind-flow 9s linear infinite; }
        .meet-evermind-pod { position:absolute; z-index:2; display:grid; grid-template-columns:24px 1fr; align-items:center; gap:8px; width:164px; min-height:54px; padding:10px 12px; border:1px solid color-mix(in srgb,var(--cyan-bright) 28%,var(--border-subtle)); border-radius:var(--radius-lg); background:color-mix(in srgb,var(--surface-card-strong) 92%,transparent); box-shadow:0 10px 28px color-mix(in srgb,var(--cyan-bright) 8%,transparent); }
        .meet-evermind-pod > span,.meet-principle > span,.meet-role > span { color:var(--cyan-bright); font:600 .61rem/1.5 var(--font-display); letter-spacing:.08em; }
        .meet-evermind-pod > strong { color:var(--text-primary); font:600 .69rem/1.35 var(--font-display); }
        .meet-evermind-pod::after { content:''; position:absolute; width:5px; height:5px; border:2px solid var(--cyan-bright); border-radius:50%; background:var(--bg-surface); }
        .meet-evermind-pod.is-pod-1 { left:18px; top:133px; }
        .meet-evermind-pod.is-pod-1::after { right:-4px; top:50%; transform:translateY(-50%); }
        .meet-evermind-pod.is-pod-2 { left:50%; top:18px; transform:translateX(-50%); }
        .meet-evermind-pod.is-pod-2::after { left:50%; bottom:-4px; transform:translateX(-50%); }
        .meet-evermind-pod.is-pod-3 { left:50%; bottom:18px; transform:translateX(-50%); }
        .meet-evermind-pod.is-pod-3::after { left:50%; top:-4px; transform:translateX(-50%); }
        .meet-evermind-pod.is-pod-4 { right:18px; top:133px; }
        .meet-evermind-pod.is-pod-4::after { left:-4px; top:50%; transform:translateY(-50%); }
        .meet-evermind-core { position:absolute; z-index:3; left:50%; top:50%; width:126px; height:126px; display:grid; place-items:center; transform:translate(-50%,-50%); }
        .meet-evermind-orbits,.meet-evermind-orbits i { position:absolute; inset:0; border:1px solid color-mix(in srgb,var(--cyan-bright) 32%,transparent); border-radius:50%; }
        .meet-evermind-orbits { animation:evermind-spin 18s linear infinite; box-shadow:inset 0 0 38px color-mix(in srgb,var(--cyan-bright) 11%,transparent),0 0 35px color-mix(in srgb,var(--cyan-bright) 10%,transparent); }
        .meet-evermind-orbits::before,.meet-evermind-orbits::after { content:''; position:absolute; width:8px; height:8px; border-radius:50%; background:var(--cyan-bright); box-shadow:0 0 14px var(--cyan-bright); }
        .meet-evermind-orbits::before { left:12px; top:18px; }
        .meet-evermind-orbits::after { right:8px; bottom:28px; }
        .meet-evermind-orbits i:nth-child(1) { inset:9px; border-style:dashed; }
        .meet-evermind-orbits i:nth-child(2) { inset:20px; background:radial-gradient(circle,color-mix(in srgb,var(--cyan-bright) 20%,transparent),transparent 68%); }
        .meet-evermind-orbits i:nth-child(3) { inset:36px; border:0; background:var(--cyan-bright); box-shadow:0 0 32px color-mix(in srgb,var(--cyan-bright) 55%,transparent); opacity:.14; }
        .meet-evermind-core-copy { position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; text-align:center; }
        .meet-evermind-core-copy small { color:var(--cyan-bright); font:600 .5rem/1 var(--font-display); letter-spacing:.1em; }
        .meet-evermind-core-copy strong { margin:7px 0 4px; color:var(--text-primary); font:700 1.05rem/1 var(--font-display); letter-spacing:-.025em; }
        .meet-evermind-core-copy span { max-width:76px; color:var(--text-muted); font:500 .55rem/1.25 var(--font-display); }
        .meet-evermind-write { display:grid; grid-template-columns:auto minmax(110px,1fr) auto 14px auto; gap:12px; align-items:center; padding:13px 16px; border-top:1px solid var(--border-subtle); background:color-mix(in srgb,var(--cyan-bright) 5%,transparent); }
        .meet-evermind-write-status { display:flex; align-items:center; gap:8px; color:var(--cyan-bright); font:650 .57rem/1 var(--font-display); letter-spacing:.08em; white-space:nowrap; }
        .meet-evermind-write code { overflow:hidden; color:var(--text-muted); font-size:var(--font-size-eyebrow); text-overflow:ellipsis; white-space:nowrap; }
        .meet-evermind-write > b { color:var(--cyan-bright); font-weight:500; }
        .meet-evermind-old,.meet-evermind-new { display:grid; gap:3px; color:var(--text-secondary); font:600 .65rem/1 var(--font-display); }
        .meet-evermind-old { text-decoration:line-through; opacity:.55; }
        .meet-evermind-new { color:var(--text-primary); }
        .meet-evermind-old small,.meet-evermind-new small { color:var(--text-muted); font-size:var(--font-size-field-label); letter-spacing:.1em; text-decoration:none; text-transform:uppercase; }
        @keyframes evermind-flow { to { stroke-dashoffset:-120; } }
        @keyframes evermind-spin { to { transform:rotate(360deg); } }
        @keyframes evermind-live { 50% { opacity:.45; box-shadow:0 0 0 7px transparent,0 0 8px var(--cyan-bright); } }
        .meet-evermind-aside { padding-left:24px; border-left:1px solid var(--border-subtle); }
        .meet-aside-label { display:block; margin-bottom:10px; color:var(--text-muted); font:600 .64rem/1 var(--font-display); letter-spacing:.14em; text-transform:uppercase; }
        .meet-edge { padding:14px 0; border-bottom:1px solid var(--border-subtle); }
        .meet-edge strong { display:block; margin-bottom:4px; color:var(--text-primary); font:650 .82rem/1.3 var(--font-display); }
        .meet-edge span { color:var(--text-secondary); font-size:var(--font-size-small); line-height:1.45; }
        .meet-text-link { display:flex; justify-content:space-between; margin-top:20px; padding-top:14px; border-top:1px solid var(--coral-bright); color:var(--text-primary); font:650 .82rem/1 var(--font-display); text-decoration:none; }
        .meet-text-link:hover { color:var(--coral-bright); }

        /* ── 03 · Create freely. Deliver with control. ── */
        .meet-delivery-panel { background:linear-gradient(135deg,color-mix(in srgb,var(--surface-card-strong) 91%,var(--coral-bright)),var(--surface-card-strong) 62%,color-mix(in srgb,var(--surface-card-strong) 88%,var(--cyan-bright))); }
        .meet-delivery-body { display:grid; grid-template-columns:minmax(240px,.72fr) minmax(0,1.28fr); gap:clamp(24px,3vw,44px); align-items:start; }
        .meet-principles { display:grid; align-content:start; }
        .meet-principle { display:grid; grid-template-columns:32px 1fr; gap:12px; padding:18px 0; border-top:1px solid var(--border-subtle); }
        .meet-principle:first-child { border-top:0; padding-top:0; }
        .meet-role-view { padding:22px 24px; background:color-mix(in srgb,var(--bg-surface) 55%,transparent); border:1px solid var(--border-subtle); border-radius:var(--radius-sm) var(--radius-xl) var(--radius-xl) var(--radius-xl); }
        .meet-role-heading { display:grid; grid-template-columns:.8fr 1.2fr; gap:24px; margin-bottom:16px; }
        .meet-role-heading h3 { margin:0; color:var(--text-primary); font:650 1rem/1.25 var(--font-display); }
        .meet-role-heading p { margin:0; font-size:var(--font-size-eyebrow); line-height:1.5; }
        .meet-role-list { border-top:1px solid var(--border-subtle); }
        .meet-role { display:grid; grid-template-columns:28px minmax(110px,.55fr) 1.45fr; gap:10px; align-items:baseline; padding:10px 0; border-bottom:1px solid var(--border-subtle); }
        .meet-role:last-child { border-bottom:0; }
        .meet-role strong { color:var(--text-primary); font:600 .76rem/1.3 var(--font-display); }
        .meet-role p { margin:0; font-size:var(--font-size-eyebrow); line-height:1.45; }

        /* ── Tabs ── */
        .meet-carousel-nav { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin:18px 64px 0; }
        .meet-carousel-nav button { display:grid; grid-template-columns:28px 1fr; gap:7px; padding:8px 0 0; border:0; background:transparent; color:var(--text-muted); text-align:left; cursor:pointer; transition:color .2s; }
        .meet-carousel-nav button:hover { color:var(--text-secondary); }
        .meet-carousel-nav button > span { font:500 .62rem/1 var(--font-display); }
        .meet-carousel-nav button > strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 .72rem/1 var(--font-display); letter-spacing:.05em; text-transform:uppercase; }
        .meet-carousel-nav button > i { grid-column:1/-1; height:2px; overflow:hidden; border-radius:var(--radius-full); background:var(--border-subtle); }
        .meet-carousel-nav button > i b { display:block; width:100%; height:100%; border-radius:var(--radius-full); background:var(--coral-bright); transform-origin:left; animation:meet-progress ${ROTATION_MS}ms linear; }
        .meet-carousel-nav button.is-active { color:var(--text-primary); }
        .meet-carousel.is-paused .meet-carousel-nav button > i b { animation-play-state:paused; }
        @keyframes meet-progress { from{transform:scaleX(0)} to{transform:scaleX(1)} }

        /* ── Tablet: one column inside every panel ── */
        @media (max-width:1000px) {
          .meet-carousel { padding-inline:20px; }
          .meet-carousel-kicker,.meet-carousel-nav { margin-left:0; margin-right:0; }
          .meet-carousel-frame { --meet-panel-gutter:clamp(20px,3vw,44px); }
          .meet-carousel-arrow { top:auto; bottom:16px; }
          .meet-carousel-arrow.is-prev { left:18px; }
          .meet-carousel-arrow.is-next { right:18px; }
          .meet-panel-head,.meet-create-body,.meet-evermind-body,.meet-delivery-body { grid-template-columns:1fr; gap:24px; }
          .meet-panel-head { align-items:start; }
          .meet-panel { padding-bottom:78px; }
          .meet-evermind-aside { padding:0; border-left:0; border-top:1px solid var(--border-subtle); padding-top:18px; }
          .meet-evermind-panel::after { display:none; }
        }

        /* ── Phone ── */
        @media (max-width:700px) {
          .meet-carousel { padding-inline:14px; scroll-margin-top:72px; }
          .meet-carousel-kicker { margin-bottom:10px; font-size:var(--font-size-field-label); letter-spacing:.12em; }
          .meet-carousel-viewport { border-radius:var(--radius-xl); }
          .meet-panel { gap:20px; padding:28px 18px 74px; border-radius:var(--radius-xl); }
          .meet-panel::before { left:18px; width:64px; }
          .meet-slide .section-title { font-size:var(--font-size-section); line-height:1.25; }
          .meet-slide-lead { font-size:var(--font-size-small); }
          .meet-create-actions { margin-top:18px; }
          .meet-create-actions a { flex:1 1 100%; }
          .meet-create-board { padding:13px; }
          .meet-create-flow { gap:6px 8px; font-size:var(--font-size-eyebrow); }
          .meet-evermind-map { height:auto; display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:18px; }
          .meet-evermind-connections { display:none; }
          .meet-evermind-core { position:relative; left:auto; top:auto; order:-1; grid-column:1/-1; width:126px; height:126px; margin:2px auto 8px; transform:none; }
          .meet-evermind-pod { position:relative; inset:auto!important; width:auto; min-height:62px; transform:none!important; }
          .meet-evermind-pod::after { display:none; }
          .meet-evermind-write { grid-template-columns:1fr auto 14px auto; }
          .meet-evermind-write-status { grid-column:1/-1; }
          .meet-evermind-write code { min-width:0; }
          .meet-role-heading,.meet-role { grid-template-columns:1fr; gap:4px; }
          .meet-role > span { display:none; }
          .meet-role-view { padding:18px 16px; }
          .meet-carousel-arrow { bottom:14px; width:40px; height:40px; font-size:var(--font-size-card-title); }
          .meet-carousel-arrow.is-prev { left:14px; }
          .meet-carousel-arrow.is-next { right:14px; }
          /* Labels cannot survive three-up at this width, so the tabs become dots
             and the slide's own heading carries the name. */
          .meet-carousel-nav { grid-template-columns:repeat(3,1fr); max-width:220px; margin:14px auto 0; gap:10px; }
          .meet-carousel-nav button { grid-template-columns:1fr; padding:10px 0; }
          .meet-carousel-nav button > span,.meet-carousel-nav button > strong { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
          .meet-carousel-nav button > i { grid-column:1; height:4px; }
        }

        @media (prefers-reduced-motion:reduce) {
          .meet-carousel-viewport { transition:none; }
          .meet-slide { transition:opacity .01s, visibility 0s .01s; transform:none; }
          .meet-slide.is-active { transition:opacity .01s, visibility 0s 0s; }
          .meet-carousel-nav button > i b { animation:none; }
          .meet-evermind-connections path,.meet-evermind-orbits,.meet-evermind-visual-head i,.meet-evermind-write-status i { animation:none; }
        }
      `}</style>
    </section>
  );
}
