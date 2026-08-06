'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type TitleDesc = { title: string; desc: string };
type RoleDesc = { role: string; desc: string };
type CanvasFeature = { title: string; desc: string };
type CanvasObject = { title: string; meta: string };

const SLIDE_COUNT = 3;
const ROTATION_MS = 7000;

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

  const move = (direction: -1 | 1) => {
    setActiveSlide((current) => (current + direction + SLIDE_COUNT) % SLIDE_COUNT);
  };

  return (
    <section
      className={`meet-carousel${paused ? ' is-paused' : ''}`}
      id="create"
      aria-roledescription="carousel"
      aria-label={`${slideNames[0]}, ${slideNames[1]}, ${slideNames[2]}`}
      onMouseEnter={() => setInteractionPaused(true)}
      onMouseLeave={() => setInteractionPaused(false)}
      onFocusCapture={() => setInteractionPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInteractionPaused(false);
      }}
    >
      <div className="meet-carousel-kicker">
        <span>BuilderForce / Platform</span>
        <span className="meet-carousel-status">
          <span aria-live="polite">0{activeSlide + 1} / 0{SLIDE_COUNT}</span>
          <button
            type="button"
            onClick={() => setManualPaused((value) => !value)}
            aria-label={manualPaused ? 'Resume automatic slide rotation' : 'Pause automatic slide rotation'}
          >
            <span aria-hidden="true">{manualPaused ? '▶' : 'Ⅱ'}</span>
          </button>
        </span>
      </div>

      <div className="meet-carousel-frame">
        <button className="meet-carousel-arrow is-prev" type="button" onClick={() => move(-1)} aria-label="Previous slide">
          <span aria-hidden="true">←</span>
        </button>

        <div className="meet-carousel-viewport">
          <div className="meet-carousel-track" style={{ transform: `translateX(-${activeSlide * 100}%)` }}>
            <article className="meet-slide" aria-hidden={activeSlide !== 0} aria-label={slideNames[0]}>
              <div className="lp-create">
                <div className="lp-create-head">
                  <span className="lp-create-eyebrow">01 / {t('home.createCanvas.eyebrow')}</span>
                  <h2 className="section-title"><span className="agentHost-accent">⟩</span> {t('home.createCanvas.heading')}</h2>
                  <p className="meet-slide-lead">{t('home.createCanvas.blurb')}</p>
                </div>
                <div className="lp-create-layout">
                  <div className="lp-create-features">
                    {(t.raw('home.createCanvas.features') as CanvasFeature[]).map((feature) => (
                      <div className="lp-create-feature" key={feature.title}>
                        <strong>{feature.title}</strong>
                        <span>{feature.desc}</span>
                      </div>
                    ))}
                    <div className="lp-actions meet-slide-actions">
                      <Link href="/create/new" className="lp-btn-primary">{t('home.createCanvas.startCta')} →</Link>
                      <Link href="/creation-canvas" className="lp-btn-secondary">{t('home.createCanvas.exploreCta')}</Link>
                    </div>
                  </div>
                  <div className="lp-create-board" aria-label={t('home.createCanvas.previewAria')}>
                    <div className="lp-create-toolbar"><i /><i /><i /><span>{t('home.createCanvas.sessionLabel')}</span></div>
                    {(t.raw('home.createCanvas.objects') as CanvasObject[]).map((object, index) => (
                      <div className="lp-create-object" key={object.title}>
                        <strong><span className="meet-object-index">0{index + 1}</span>{object.title}</strong>
                        <small>{object.meta}</small>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="lp-create-flow">
                  {(t.raw('home.createCanvas.flow') as string[]).map((step, index, steps) => (
                    <span key={step}>{step}{index < steps.length - 1 && <b> &nbsp;→</b>}</span>
                  ))}
                </div>
              </div>
            </article>

            <article className="meet-slide" id="evermind" aria-hidden={activeSlide !== 1} aria-label={slideNames[1]}>
              <div className="meet-panel meet-evermind-panel">
                <div className="meet-panel-head">
                  <div>
                    <span className="lp-evermind-eyebrow">02 / {t('evermind.eyebrow')}</span>
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
                    <span className="meet-aside-label">Evermind / Difference</span>
                    {(t.raw('evermind.edges.items') as { label: string; desc: string }[]).map((edge) => (
                      <div className="meet-edge" key={edge.label}>
                        <strong>{edge.label}</strong>
                        <span>{edge.desc}</span>
                      </div>
                    ))}
                    <Link href="/evermind" className="meet-text-link">{t('evermind.exploreCta')} <span>→</span></Link>
                  </aside>
                </div>
              </div>
            </article>

            <article className="meet-slide" aria-hidden={activeSlide !== 2} aria-label={slideNames[2]}>
              <div className="meet-panel meet-delivery-panel">
                <div className="meet-panel-head">
                  <div>
                    <span className="lp-create-eyebrow">03 / {t('home.rolesHeading')}</span>
                    <h2 className="section-title"><span className="agentHost-accent">⟩</span> {t('home.pillarsHeading')}</h2>
                  </div>
                  <p className="meet-slide-lead">{t('home.pillarsLead')}</p>
                </div>

                <div className="meet-delivery-body">
                  <div className="meet-principles">
                    {(t.raw('home.pillars') as TitleDesc[]).map((pillar, index) => (
                      <div className="meet-principle" key={pillar.title}>
                        <span>0{index + 1}</span>
                        <h3>{pillar.title}</h3>
                        <p>{pillar.desc}</p>
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
        </div>

        <button className="meet-carousel-arrow is-next" type="button" onClick={() => move(1)} aria-label="Next slide">
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="meet-carousel-nav" role="tablist" aria-label="Choose a slide">
        {slideNames.map((name, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeSlide === index}
            className={activeSlide === index ? 'is-active' : ''}
            onClick={() => setActiveSlide(index)}
            key={name}
          >
            <span>0{index + 1}</span>
            <strong>{name}</strong>
            <i>{activeSlide === index && <b key={activeSlide} />}</i>
          </button>
        ))}
      </div>

      <style>{`
        .meet-carousel { max-width: 1320px; margin: 0 auto; padding: 0 24px 86px; scroll-margin-top: 90px; }
        .meet-carousel-kicker { display:flex; justify-content:space-between; margin:0 64px 14px; color:var(--text-muted); font:600 .68rem/1 var(--font-display); letter-spacing:.16em; text-transform:uppercase; }
        .meet-carousel-status { display:flex; align-items:center; gap:12px; }
        .meet-carousel-status button { display:grid; width:24px; height:24px; place-items:center; padding:0; border:1px solid var(--border-subtle); border-radius:50%; background:transparent; color:var(--text-secondary); font-size:.58rem; cursor:pointer; }
        .meet-carousel-frame { position:relative; padding:0 64px; }
        .meet-carousel-viewport { overflow:hidden; border-radius:24px; }
        .meet-carousel-track { display:flex; align-items:stretch; transition:transform .72s cubic-bezier(.22,.78,.25,1); }
        .meet-slide { flex:0 0 100%; min-width:0; }
        .meet-slide[aria-hidden="true"] { visibility:hidden; pointer-events:none; }
        .meet-slide > * { height:100%; }
        .meet-slide .section-title { margin:0 0 8px; }
        .meet-slide-lead { margin:0; color:var(--text-secondary); line-height:1.65; }
        .meet-slide-actions { justify-content:flex-start; margin-top:8px; }
        .meet-object-index { margin-right:8px; color:var(--coral-bright); font:500 .64rem/1 var(--font-display); letter-spacing:.08em; }
        .meet-carousel-arrow { position:absolute; z-index:3; top:50%; width:44px; height:72px; display:grid; place-items:center; transform:translateY(-50%); border:0; border-top:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle); background:transparent; color:var(--text-secondary); font-size:1.35rem; cursor:pointer; transition:color .2s,border-color .2s,transform .2s; }
        .meet-carousel-arrow:hover { color:var(--text-primary); border-color:var(--coral-bright); transform:translateY(-50%) translateX(var(--arrow-shift)); }
        .meet-carousel-arrow.is-prev { left:0; --arrow-shift:-3px; }
        .meet-carousel-arrow.is-next { right:0; --arrow-shift:3px; }
        .meet-panel { position:relative; overflow:hidden; min-height:650px; padding:44px; border:1px solid var(--border-accent); border-radius:24px; background:var(--surface-card); box-shadow:inset 0 1px 0 var(--surface-inset-highlight),0 24px 70px rgba(0,0,0,.12); }
        .meet-panel::before { content:''; position:absolute; top:0; left:44px; width:96px; height:3px; background:var(--coral-bright); }
        .meet-panel-head { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(280px,.9fr); gap:56px; align-items:end; padding-bottom:30px; border-bottom:1px solid var(--border-subtle); }
        .meet-evermind-panel { background:linear-gradient(120deg,rgba(5,11,24,.98),rgba(6,23,31,.93)); }
        .meet-evermind-panel::after { content:'EM'; position:absolute; right:30px; bottom:-60px; color:rgba(95,220,255,.035); font:800 17rem/1 var(--font-display); letter-spacing:-.09em; pointer-events:none; }
        .meet-evermind-body { position:relative; z-index:1; display:grid; grid-template-columns:minmax(0,1.45fr) minmax(260px,.55fr); gap:44px; padding-top:30px; }
        .meet-evermind-list { display:grid; grid-template-columns:1fr 1fr; border-top:1px solid var(--border-subtle); border-left:1px solid var(--border-subtle); }
        .meet-evermind-item { display:grid; grid-template-columns:34px 1fr; gap:14px; padding:22px 20px; border-right:1px solid var(--border-subtle); border-bottom:1px solid var(--border-subtle); }
        .meet-evermind-item > span,.meet-principle > span,.meet-role > span { color:var(--cyan-bright); font:600 .66rem/1 var(--font-display); letter-spacing:.08em; }
        .meet-evermind-item h3,.meet-principle h3 { margin:0 0 7px; color:var(--text-primary); font:650 .92rem/1.3 var(--font-display); }
        .meet-evermind-item p,.meet-principle p { margin:0; color:var(--text-secondary); font-size:.78rem; line-height:1.55; }
        .meet-evermind-aside { padding-left:24px; border-left:1px solid var(--border-subtle); }
        .meet-aside-label { display:block; margin-bottom:10px; color:var(--text-muted); font:600 .64rem/1 var(--font-display); letter-spacing:.14em; text-transform:uppercase; }
        .meet-edge { padding:15px 0; border-bottom:1px solid var(--border-subtle); }
        .meet-edge strong { display:block; margin-bottom:4px; color:var(--text-primary); font:650 .82rem/1.3 var(--font-display); }
        .meet-edge span { color:var(--text-secondary); font-size:.75rem; line-height:1.45; }
        .meet-text-link { display:flex; justify-content:space-between; margin-top:22px; padding-top:14px; border-top:1px solid var(--coral-bright); color:var(--text-primary); font:650 .82rem/1 var(--font-display); text-decoration:none; }
        .meet-delivery-panel { background:linear-gradient(135deg,rgba(18,14,27,.98),rgba(6,16,28,.96) 62%,rgba(5,27,29,.9)); }
        .meet-delivery-body { display:grid; grid-template-columns:minmax(250px,.72fr) minmax(0,1.28fr); gap:44px; padding-top:30px; }
        .meet-principles { display:grid; gap:0; align-content:start; }
        .meet-principle { display:grid; grid-template-columns:32px 1fr; padding:19px 0; border-top:1px solid var(--border-subtle); }
        .meet-principle h3,.meet-principle p { grid-column:2; }
        .meet-role-view { padding:24px 26px; background:rgba(3,8,18,.38); border:1px solid var(--border-subtle); border-radius:2px 18px 18px 18px; }
        .meet-role-heading { display:grid; grid-template-columns:.8fr 1.2fr; gap:24px; margin-bottom:18px; }
        .meet-role-heading h3 { margin:0; color:var(--text-primary); font:650 1rem/1.25 var(--font-display); }
        .meet-role-heading p { margin:0; color:var(--text-secondary); font-size:.74rem; line-height:1.5; }
        .meet-role-list { border-top:1px solid var(--border-subtle); }
        .meet-role { display:grid; grid-template-columns:28px minmax(110px,.55fr) 1.45fr; gap:10px; align-items:baseline; padding:10px 0; border-bottom:1px solid var(--border-subtle); }
        .meet-role strong { color:var(--text-primary); font:600 .76rem/1.3 var(--font-display); }
        .meet-role p { margin:0; color:var(--text-secondary); font-size:.7rem; line-height:1.4; }
        .meet-carousel-nav { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin:18px 64px 0; }
        .meet-carousel-nav button { display:grid; grid-template-columns:28px 1fr; gap:7px; padding:8px 0 0; border:0; background:transparent; color:var(--text-muted); text-align:left; cursor:pointer; }
        .meet-carousel-nav button > span { font:500 .62rem/1 var(--font-display); }
        .meet-carousel-nav button > strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 .72rem/1 var(--font-display); letter-spacing:.05em; text-transform:uppercase; }
        .meet-carousel-nav button > i { grid-column:1/-1; height:2px; overflow:hidden; background:var(--border-subtle); }
        .meet-carousel-nav button > i b { display:block; width:100%; height:100%; background:var(--coral-bright); transform-origin:left; animation:meet-progress ${ROTATION_MS}ms linear; }
        .meet-carousel-nav button.is-active { color:var(--text-primary); }
        .meet-carousel.is-paused .meet-carousel-nav button > i b { animation-play-state:paused; }
        @keyframes meet-progress { from{transform:scaleX(0)} to{transform:scaleX(1)} }
        @media (max-width:1000px) {
          .meet-panel-head,.meet-evermind-body,.meet-delivery-body { grid-template-columns:1fr; gap:24px; }
          .meet-panel { min-height:780px; }
          .meet-evermind-aside { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; padding:0; border-left:0; }
          .meet-aside-label,.meet-text-link { grid-column:1/-1; }
          .meet-edge { padding:12px 0; }
        }
        @media (max-width:700px) {
          .meet-carousel { padding:0 16px 64px; }
          .meet-carousel-kicker { margin:0 0 12px; }
          .meet-carousel-frame { padding:0; }
          .meet-panel { min-height:0; padding:28px 20px; }
          .meet-panel::before { left:20px; }
          .meet-evermind-list { grid-template-columns:1fr; }
          .meet-evermind-aside { grid-template-columns:1fr; }
          .meet-delivery-body { gap:12px; }
          .meet-role-heading,.meet-role { grid-template-columns:1fr; }
          .meet-role > span { display:none; }
          .meet-carousel-arrow { top:auto; bottom:-58px; width:44px; height:38px; transform:none; }
          .meet-carousel-arrow:hover { transform:translateX(var(--arrow-shift)); }
          .meet-carousel-arrow.is-prev { left:0; }
          .meet-carousel-arrow.is-next { right:0; }
          .meet-carousel-nav { margin:16px 56px 0; gap:8px; }
          .meet-carousel-nav button { grid-template-columns:1fr; }
          .meet-carousel-nav button > span { display:none; }
          .meet-carousel-nav button > strong { font-size:.58rem; }
          .meet-carousel-nav button > i { grid-column:1; }
        }
        @media (prefers-reduced-motion:reduce) {
          .meet-carousel-track { transition:none; }
          .meet-carousel-nav button > i b { animation:none; }
        }
      `}</style>
    </section>
  );
}
