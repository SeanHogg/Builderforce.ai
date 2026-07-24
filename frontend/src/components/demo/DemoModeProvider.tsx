'use client';

/**
 * DemoModeProvider (migration 0360) — the conversion layer around a demo session.
 *
 * Self-deciding: renders nothing extra when the visit is NOT a demo session, so
 * it can wrap the whole app unconditionally. Inside a demo it adds:
 *   1. A persistent floating banner ("you're exploring a live demo") with Exit /
 *      Create account / Book a demo actions.
 *   2. A timed CONVERT prompt (SlideOutPanel) triggered by engagement — whichever
 *      comes first of ~3 min in-demo or 4 meaningful interactions (route views).
 *      Shown once per session.
 *   3. EXIT-INTENT capture — mouse leaving toward the top (desktop) or the tab
 *      being hidden (mobile) → a lighter prompt offering newsletter / book-a-demo.
 *      Shown once per session.
 *   4. Anonymous funnel telemetry for every step (demo_start is emitted server-side
 *      on session mint; the rest here).
 *
 * All colors come from theme tokens; layout is fluid + mobile-safe.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { BookDemoForm } from './BookDemoForm';
import { DemoTour } from './DemoTour';
import {
  getDemoState,
  clearDemoMode,
  hasExitPrompted,
  markExitPrompted,
  hasTourSeen,
  markTourSeen,
  queueDemoEvent,
  flushDemoEvents,
  trackDemoEvent,
  type DemoPersona,
} from '@/lib/demoApi';
import { clearSession } from '@/lib/auth';

const ENGAGE_TIME_MS = 3 * 60 * 1000; // 3 minutes in-demo
const ENGAGE_VIEWS = 4;               // or 4 route views, whichever first

type Prompt = 'none' | 'convert' | 'exit';

export function DemoModeProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('demo');
  const router = useRouter();
  const pathname = usePathname();

  const [active, setActive] = useState(false);
  const [persona, setPersona] = useState<DemoPersona | null>(null);
  const [tenantName, setTenantName] = useState('');
  const [prompt, setPrompt] = useState<Prompt>('none');
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  const viewsRef = useRef(0);
  const convertShownRef = useRef(false);
  const startedRef = useRef(0);
  // Read synchronously inside event callbacks so the auto convert/exit prompts
  // stay suppressed while the guided tour owns the screen.
  const tourOpenRef = useRef(false);

  const openTour = useCallback(() => {
    if (!persona) return;
    tourOpenRef.current = true;
    setTourOpen(true);
  }, [persona]);

  const closeTour = useCallback(() => {
    tourOpenRef.current = false;
    setTourOpen(false);
    markTourSeen();
  }, []);

  // Detect demo mode on mount (sessionStorage is client-only).
  useEffect(() => {
    const state = getDemoState();
    if (state) {
      setActive(true);
      setPersona(state.persona);
      setTenantName(state.tenantName);
      startedRef.current = state.startedAt;
    }
  }, []);

  // Flush queued funnel events when the tab hides.
  useEffect(() => {
    if (!active) return;
    const onHide = () => flushDemoEvents();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDemoEvents(); });
    return () => window.removeEventListener('pagehide', onHide);
  }, [active]);

  // Auto-start the product tour shortly after landing (once per demo session).
  // Mark it seen the moment it fires so a mid-tour reload doesn't relaunch it —
  // the banner's "Take the tour" button remains available to replay it.
  useEffect(() => {
    if (!active || !persona || hasTourSeen()) return;
    const timer = setTimeout(() => { markTourSeen(); openTour(); }, 1400);
    return () => clearTimeout(timer);
  }, [active, persona, openTour]);

  const openConvert = useCallback(() => {
    if (convertShownRef.current || tourOpenRef.current) return;
    convertShownRef.current = true;
    setPrompt('convert');
    trackDemoEvent({ kind: 'convert_prompt_shown', persona, path: pathname });
  }, [persona, pathname]);

  // Count route views as engagement + fire the convert prompt at the threshold.
  useEffect(() => {
    if (!active) return;
    viewsRef.current += 1;
    queueDemoEvent({ kind: 'page_view', persona, path: pathname });
    if (!convertShownRef.current && viewsRef.current >= ENGAGE_VIEWS) openConvert();
  }, [active, pathname, persona, openConvert]);

  // Time-based engagement trigger.
  useEffect(() => {
    if (!active) return;
    const elapsed = Date.now() - (startedRef.current || Date.now());
    const remaining = Math.max(0, ENGAGE_TIME_MS - elapsed);
    const timer = setTimeout(() => { if (!convertShownRef.current) openConvert(); }, remaining);
    return () => clearTimeout(timer);
  }, [active, openConvert]);

  // Exit-intent: desktop mouse-to-top, plus a hidden-tab fallback for mobile.
  useEffect(() => {
    if (!active) return;
    const trigger = () => {
      if (hasExitPrompted() || convertShownRef.current || tourOpenRef.current) return;
      markExitPrompted();
      setPrompt('exit');
      trackDemoEvent({ kind: 'exit_prompt_shown', persona, path: pathname });
    };
    const onMouseOut = (e: MouseEvent) => {
      if (e.clientY <= 0 && !e.relatedTarget) trigger();
    };
    document.addEventListener('mouseout', onMouseOut);
    return () => document.removeEventListener('mouseout', onMouseOut);
  }, [active, persona, pathname]);

  const closePrompt = useCallback(() => {
    setPrompt('none');
    setShowLeadForm(false);
  }, []);

  const goRegister = useCallback((from: 'banner' | 'convert' | 'exit') => {
    trackDemoEvent({ kind: 'convert_clicked', persona, path: pathname, metadata: { from } });
    flushDemoEvents();
    clearDemoMode();
    clearSession();
    window.location.assign('/register?src=demo');
  }, [persona, pathname]);

  const exitDemo = useCallback(() => {
    trackDemoEvent({ kind: 'demo_exit', persona, path: pathname });
    flushDemoEvents();
    clearDemoMode();
    clearSession();
    window.location.assign('/');
  }, [persona, pathname]);

  if (!active) return <>{children}</>;

  const personaLabel = persona ? t(`personas.${persona}`) : '';

  return (
    <>
      {children}

      {/* Persistent floating demo banner. */}
      <div className="demo-banner" role="region" aria-label={t('bannerAria')}>
        <div className="demo-banner-inner">
          <span className="demo-badge">{t('badge')}</span>
          <span className="demo-banner-text">{t('bannerText', { name: tenantName })}</span>
          <div className="demo-banner-actions">
            <button className="demo-btn demo-btn-ghost" onClick={openTour}>{t('tour.takeTour')}</button>
            <button className="demo-btn demo-btn-ghost" onClick={() => setPrompt('convert')}>{t('bookOrJoin')}</button>
            <button className="demo-btn demo-btn-primary" onClick={() => goRegister('banner')}>{t('createAccount')}</button>
            <button className="demo-btn demo-btn-exit" onClick={exitDemo} aria-label={t('exit')}>✕</button>
          </div>
        </div>
      </div>

      {/* Persona-aware product tour — auto-starts once per session, re-openable
          from the banner. Suppresses the auto convert/exit prompts while open. */}
      {persona && (
        <DemoTour
          persona={persona}
          open={tourOpen}
          onClose={closeTour}
          onRequestConvert={() => setPrompt('convert')}
        />
      )}

      {/* Convert prompt. */}
      <SlideOutPanel open={prompt === 'convert'} onClose={closePrompt} title={t('convertTitle')} width="min(480px, 96vw)">
        <div className="demo-panel">
          <p className="demo-panel-lead">{t('convertLead', { persona: personaLabel })}</p>
          <ul className="demo-benefits">
            <li>{t('benefit1')}</li>
            <li>{t('benefit2')}</li>
            <li>{t('benefit3')}</li>
          </ul>
          {!showLeadForm ? (
            <div className="demo-cta-col">
              <button className="demo-btn demo-btn-primary demo-btn-lg" onClick={() => goRegister('convert')}>{t('createAccountFree')}</button>
              <button className="demo-btn demo-btn-outline demo-btn-lg" onClick={() => { setShowLeadForm(true); trackDemoEvent({ kind: 'book_demo_opened', persona, path: pathname }); }}>{t('talkToSales')}</button>
            </div>
          ) : (
            <div className="demo-lead-wrap">
              <p className="demo-lead-title">{t('bookLead')}</p>
              <BookDemoForm source="demo-convert" defaultInterest={persona ?? undefined} compact onSuccess={() => trackDemoEvent({ kind: 'lead_submitted', persona, path: pathname, metadata: { from: 'convert' } })} />
            </div>
          )}
          <style>{panelStyles}</style>
        </div>
      </SlideOutPanel>

      {/* Exit-intent prompt. */}
      <SlideOutPanel open={prompt === 'exit'} onClose={closePrompt} title={t('exitTitle')} width="min(460px, 96vw)">
        <div className="demo-panel">
          <p className="demo-panel-lead">{t('exitLead')}</p>
          <div className="demo-cta-col">
            <button className="demo-btn demo-btn-primary demo-btn-lg" onClick={() => goRegister('exit')}>{t('createAccountFree')}</button>
          </div>
          <div className="demo-lead-wrap">
            <p className="demo-lead-title">{t('exitBookLead')}</p>
            <BookDemoForm source="demo-exit" defaultInterest={persona ?? undefined} compact onSuccess={() => trackDemoEvent({ kind: 'lead_submitted', persona, path: pathname, metadata: { from: 'exit' } })} />
          </div>
          <style>{panelStyles}</style>
        </div>
      </SlideOutPanel>

      <style>{bannerStyles}</style>
    </>
  );
}

const bannerStyles = `
  .demo-banner {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: max(12px, env(safe-area-inset-bottom)); z-index: 9985;
    width: min(720px, calc(100vw - 24px));
  }
  .demo-banner-inner {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center;
    padding: 10px 14px; border-radius: 14px;
    background: var(--surface-card-strong, rgba(20,24,33,0.96));
    border: 1px solid var(--border, rgba(255,255,255,0.14));
    box-shadow: 0 10px 40px rgba(0,0,0,0.35);
    backdrop-filter: blur(8px);
  }
  .demo-badge {
    font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 3px 8px; border-radius: 999px;
    background: var(--surface-cyan-soft, rgba(0,229,204,0.16)); color: var(--cyan-bright, #00e5cc);
  }
  .demo-banner-text { font-size: 13.5px; color: var(--text-primary, #f0f4ff); flex: 1 1 auto; min-width: 160px; }
  .demo-banner-actions { display: flex; align-items: center; gap: 8px; }
  .demo-btn { font-family: inherit; font-size: 13px; font-weight: 700; border-radius: 9px; cursor: pointer; border: 1px solid transparent; padding: 8px 12px; }
  .demo-btn-primary { background: var(--accent, #4d9eff); color: #fff; }
  .demo-btn-ghost { background: transparent; color: var(--text-primary, #f0f4ff); border-color: var(--border, rgba(255,255,255,0.18)); }
  .demo-btn-exit { background: transparent; color: var(--text-secondary, #aab3c5); padding: 8px 10px; }
  .demo-btn-exit:hover { color: var(--text-primary, #f0f4ff); }
  @media (max-width: 520px) { .demo-banner-text { flex-basis: 100%; text-align: center; } }
`;

const panelStyles = `
  .demo-panel { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
  .demo-panel-lead { margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-primary, #f0f4ff); }
  .demo-benefits { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
  .demo-benefits li { font-size: 14px; color: var(--text-secondary, #aab3c5); }
  .demo-cta-col { display: flex; flex-direction: column; gap: 10px; }
  .demo-btn-lg { padding: 12px 16px; font-size: 15px; }
  .demo-btn-outline { background: transparent; color: var(--text-primary, #f0f4ff); border: 1px solid var(--border, rgba(255,255,255,0.2)); }
  .demo-lead-wrap { border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); padding-top: 14px; }
  .demo-lead-title { margin: 0 0 10px; font-size: 13px; font-weight: 700; color: var(--text-secondary, #aab3c5); }
`;
