'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

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
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
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
            <span aria-hidden="true">{manualPaused ? '▶' : 'Ⅱ'}</span>
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
                    <Link href="/create/new" className="lp-btn-primary">{t('home.createCanvas.startCta')} →</Link>
                    <Link href="/creation-canvas" className="lp-btn-secondary">{t('home.createCanvas.exploreCta')}</Link>
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
                <div className="meet-evermind-list">
                  {(t.raw('evermind.architecture.pillars') as TitleDesc[]).map((pillar, index) => (
                    <div className="meet-evermind-item" key={pillar.title}>
                      <span>0{index + 1}</span>
                      <div><h3>{pillar.title}</h3><p>{pillar.desc}</p></div>
                    </div>
                  ))}
                </div>
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
        .meet-carousel { max-width: 1320px; margin: 0 auto; padding: 0 24px 86px; scroll-margin-top: 90px; }
        .meet-carousel-kicker { display:flex; justify-content:space-between; align-items:center; gap:16px; margin:0 64px 14px; color:var(--text-muted); font:600 .68rem/1 var(--font-display); letter-spacing:.16em; text-transform:uppercase; }
        .meet-carousel-kicker > span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .meet-carousel-status { display:flex; align-items:center; gap:12px; flex:none; }
        .meet-carousel-status button { display:grid; width:26px; height:26px; place-items:center; padding:0; border:1px solid var(--border-subtle); border-radius:50%; background:var(--surface-card); color:var(--text-secondary); font-size:.58rem; cursor:pointer; transition:color .2s,border-color .2s; }
        .meet-carousel-status button:hover { color:var(--text-primary); border-color:var(--border-accent); }
        .meet-carousel-frame { position:relative; padding:0 64px; }

        /*
         * The stack: every slide occupies the same grid cell, so the frame is the
         * height of the ACTIVE slide (JS animates the change; without JS the
         * inactive slides are simply invisible and the cell still sizes to the
         * tallest — acceptable, and never broken).
         */
        .meet-carousel-viewport { position:relative; display:grid; overflow:hidden; border-radius:24px; transition:height .5s cubic-bezier(.22,.78,.25,1); }
        .meet-slide { grid-area:1/1; min-width:0; align-self:start; opacity:0; visibility:hidden; transform:translateY(14px) scale(.985); transform-origin:50% 0; transition:opacity .42s ease, transform .42s cubic-bezier(.22,.78,.25,1), visibility 0s .42s; }
        .meet-slide.is-active { opacity:1; visibility:visible; transform:none; pointer-events:auto; transition:opacity .42s ease, transform .42s cubic-bezier(.22,.78,.25,1), visibility 0s 0s; }
        .meet-slide:not(.is-active) { pointer-events:none; }
        .meet-slide .section-title { margin:0; }
        .meet-slide-lead { margin:0; color:var(--text-secondary); font-size:.92rem; line-height:1.65; }

        .meet-eyebrow { display:block; margin-bottom:10px; color:var(--coral-bright); font:600 .68rem/1 var(--font-display); letter-spacing:.16em; text-transform:uppercase; }
        .meet-eyebrow.is-cyan { color:var(--cyan-bright); }

        .meet-carousel-arrow { position:absolute; z-index:3; top:50%; width:46px; height:46px; display:grid; place-items:center; transform:translateY(-50%); border:1px solid var(--border-subtle); border-radius:50%; background:var(--surface-card); color:var(--text-secondary); font-size:1.15rem; cursor:pointer; backdrop-filter:blur(12px); transition:color .2s,border-color .2s,box-shadow .2s; }
        .meet-carousel-arrow:hover { color:var(--text-primary); border-color:var(--border-accent); box-shadow:0 10px 26px var(--shadow-coral-soft); }
        .meet-carousel-arrow.is-prev { left:6px; }
        .meet-carousel-arrow.is-next { right:6px; }

        /* ── Shared panel frame for all three slides ── */
        .meet-panel { position:relative; overflow:hidden; display:flex; flex-direction:column; gap:26px; padding:40px clamp(20px,3vw,44px) 36px; border:1px solid var(--border-accent); border-radius:24px; background:var(--surface-card); box-shadow:inset 0 1px 0 var(--surface-inset-highlight); }
        .meet-panel::before { content:''; position:absolute; top:0; left:clamp(20px,3vw,44px); width:96px; height:3px; background:var(--coral-bright); }
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
        .meet-create-feature p { margin:0; font-size:.8rem; line-height:1.6; }
        .meet-create-actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:22px; }
        .meet-create-board { display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid var(--border-subtle); border-radius:18px; background-color:var(--bg-surface); background-image:radial-gradient(var(--border-subtle) 1px, transparent 1px); background-size:20px 20px; box-shadow:inset 0 1px 0 var(--surface-inset-highlight); }
        .meet-create-toolbar { display:flex; align-items:center; gap:6px; padding-bottom:11px; border-bottom:1px solid var(--border-subtle); color:var(--text-muted); font:600 .64rem/1 var(--font-display); letter-spacing:.04em; }
        .meet-create-toolbar i { width:7px; height:7px; border-radius:50%; background:var(--border-accent); }
        .meet-create-toolbar span { margin-left:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .meet-create-objects { display:grid; gap:9px; }
        .meet-create-object { display:grid; grid-template-columns:auto 1fr; gap:2px 9px; padding:11px 13px; border:1px solid var(--border-subtle); border-radius:12px; background:var(--bg-elevated); box-shadow:0 8px 20px var(--shadow-coral-soft); }
        .meet-create-object strong { color:var(--text-primary); font:650 .82rem/1.3 var(--font-display); }
        .meet-create-object small { grid-column:2; color:var(--text-muted); font-size:.72rem; line-height:1.45; }
        .meet-object-index { grid-row:span 2; color:var(--coral-bright); font:600 .64rem/1.4 var(--font-display); letter-spacing:.08em; }
        .meet-create-flow { display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px; padding-top:22px; border-top:1px solid var(--border-subtle); color:var(--text-secondary); font:600 .74rem/1 var(--font-display); letter-spacing:.04em; }
        .meet-create-flow > span { display:inline-flex; align-items:center; gap:10px; }
        .meet-create-flow b { color:var(--coral-bright); font-weight:600; }

        /* ── 02 · Meet Evermind ── */
        .meet-evermind-panel { background:linear-gradient(120deg,var(--surface-card-strong),color-mix(in srgb,var(--surface-card-strong) 88%,var(--cyan-bright))); }
        .meet-evermind-panel::before { background:var(--cyan-bright); }
        .meet-evermind-panel::after { content:'EM'; position:absolute; right:30px; bottom:-60px; color:color-mix(in srgb,var(--cyan-bright) 6%,transparent); font:800 17rem/1 var(--font-display); letter-spacing:-.09em; pointer-events:none; }
        .meet-evermind-body { position:relative; z-index:1; display:grid; grid-template-columns:minmax(0,1.45fr) minmax(240px,.55fr); gap:clamp(24px,3vw,44px); align-items:start; }
        .meet-evermind-list { display:grid; grid-template-columns:1fr 1fr; border-top:1px solid var(--border-subtle); border-left:1px solid var(--border-subtle); }
        .meet-evermind-item { display:grid; grid-template-columns:34px 1fr; gap:14px; padding:20px 18px; border-right:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle); }
        .meet-evermind-item > span,.meet-principle > span,.meet-role > span { color:var(--cyan-bright); font:600 .66rem/1.5 var(--font-display); letter-spacing:.08em; }
        .meet-evermind-item p,.meet-principle p { margin:0; font-size:.78rem; line-height:1.55; }
        .meet-evermind-aside { padding-left:24px; border-left:1px solid var(--border-subtle); }
        .meet-aside-label { display:block; margin-bottom:10px; color:var(--text-muted); font:600 .64rem/1 var(--font-display); letter-spacing:.14em; text-transform:uppercase; }
        .meet-edge { padding:14px 0; border-bottom:1px solid var(--border-subtle); }
        .meet-edge strong { display:block; margin-bottom:4px; color:var(--text-primary); font:650 .82rem/1.3 var(--font-display); }
        .meet-edge span { color:var(--text-secondary); font-size:.75rem; line-height:1.45; }
        .meet-text-link { display:flex; justify-content:space-between; margin-top:20px; padding-top:14px; border-top:1px solid var(--coral-bright); color:var(--text-primary); font:650 .82rem/1 var(--font-display); text-decoration:none; }
        .meet-text-link:hover { color:var(--coral-bright); }

        /* ── 03 · Create freely. Deliver with control. ── */
        .meet-delivery-panel { background:linear-gradient(135deg,color-mix(in srgb,var(--surface-card-strong) 91%,var(--coral-bright)),var(--surface-card-strong) 62%,color-mix(in srgb,var(--surface-card-strong) 88%,var(--cyan-bright))); }
        .meet-delivery-body { display:grid; grid-template-columns:minmax(240px,.72fr) minmax(0,1.28fr); gap:clamp(24px,3vw,44px); align-items:start; }
        .meet-principles { display:grid; align-content:start; }
        .meet-principle { display:grid; grid-template-columns:32px 1fr; gap:12px; padding:18px 0; border-top:1px solid var(--border-subtle); }
        .meet-principle:first-child { border-top:0; padding-top:0; }
        .meet-role-view { padding:22px 24px; background:color-mix(in srgb,var(--bg-surface) 55%,transparent); border:1px solid var(--border-subtle); border-radius:2px 18px 18px 18px; }
        .meet-role-heading { display:grid; grid-template-columns:.8fr 1.2fr; gap:24px; margin-bottom:16px; }
        .meet-role-heading h3 { margin:0; color:var(--text-primary); font:650 1rem/1.25 var(--font-display); }
        .meet-role-heading p { margin:0; font-size:.74rem; line-height:1.5; }
        .meet-role-list { border-top:1px solid var(--border-subtle); }
        .meet-role { display:grid; grid-template-columns:28px minmax(110px,.55fr) 1.45fr; gap:10px; align-items:baseline; padding:10px 0; border-bottom:1px solid var(--border-subtle); }
        .meet-role:last-child { border-bottom:0; }
        .meet-role strong { color:var(--text-primary); font:600 .76rem/1.3 var(--font-display); }
        .meet-role p { margin:0; font-size:.7rem; line-height:1.45; }

        /* ── Tabs ── */
        .meet-carousel-nav { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin:18px 64px 0; }
        .meet-carousel-nav button { display:grid; grid-template-columns:28px 1fr; gap:7px; padding:8px 0 0; border:0; background:transparent; color:var(--text-muted); text-align:left; cursor:pointer; transition:color .2s; }
        .meet-carousel-nav button:hover { color:var(--text-secondary); }
        .meet-carousel-nav button > span { font:500 .62rem/1 var(--font-display); }
        .meet-carousel-nav button > strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 .72rem/1 var(--font-display); letter-spacing:.05em; text-transform:uppercase; }
        .meet-carousel-nav button > i { grid-column:1/-1; height:2px; overflow:hidden; border-radius:999px; background:var(--border-subtle); }
        .meet-carousel-nav button > i b { display:block; width:100%; height:100%; border-radius:999px; background:var(--coral-bright); transform-origin:left; animation:meet-progress ${ROTATION_MS}ms linear; }
        .meet-carousel-nav button.is-active { color:var(--text-primary); }
        .meet-carousel.is-paused .meet-carousel-nav button > i b { animation-play-state:paused; }
        @keyframes meet-progress { from{transform:scaleX(0)} to{transform:scaleX(1)} }

        /* ── Tablet: one column inside every panel ── */
        @media (max-width:1000px) {
          .meet-carousel { padding:0 20px 86px; }
          .meet-carousel-kicker,.meet-carousel-nav { margin-left:0; margin-right:0; }
          .meet-carousel-frame { padding:0; }
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
          .meet-carousel { padding:0 14px 74px; scroll-margin-top:72px; }
          .meet-carousel-kicker { margin-bottom:10px; font-size:.62rem; letter-spacing:.12em; }
          .meet-carousel-viewport { border-radius:18px; }
          .meet-panel { gap:20px; padding:28px 18px 74px; border-radius:18px; }
          .meet-panel::before { left:18px; width:64px; }
          .meet-slide .section-title { font-size:1.28rem; line-height:1.25; }
          .meet-slide-lead { font-size:.86rem; }
          .meet-create-actions { margin-top:18px; }
          .meet-create-actions .lp-btn-primary,.meet-create-actions .lp-btn-secondary { flex:1 1 100%; justify-content:center; padding:13px 20px; }
          .meet-create-board { padding:13px; }
          .meet-create-flow { gap:6px 8px; font-size:.68rem; }
          .meet-evermind-list { grid-template-columns:1fr; border-left:0; }
          .meet-evermind-item { padding:16px 0; border-right:0; }
          .meet-role-heading,.meet-role { grid-template-columns:1fr; gap:4px; }
          .meet-role > span { display:none; }
          .meet-role-view { padding:18px 16px; }
          .meet-carousel-arrow { bottom:14px; width:40px; height:40px; font-size:1rem; }
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
        }
      `}</style>
    </section>
  );
}
