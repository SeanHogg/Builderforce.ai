'use client';

export const runtime = 'edge';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { isEmbedView, EMBED_VIEWS, capabilityForView, type EmbedCapability } from '@seanhogg/builderforce-embedded';
import { useEmbedFrame } from '../../../lib/embed/useEmbedFrame';
import { embedApi } from '../../../lib/builderforceApi';
import { getComponentForMount } from '@/lib/components/registry';

/**
 * The framed BuilderForce surface — `/embed/<id>`, the APP MOUNT.
 *
 * ── WHAT THIS ROUTE IS NOW ───────────────────────────────────────────────────
 * A transport and a gate, and nothing else. It completes the postMessage
 * handshake (token, resize, deep links) via `useEmbedFrame`, SELF-GATES on the
 * host's enabled embed capabilities, and then renders whatever the component
 * registry says `<id>` is.
 *
 * It used to also BE the resolver: a 13-branch `switch` over ~20 hand-written
 * imports, with a `default:` that guessed at `TRACKER_CONFIGS` and returned null
 * when it guessed wrong — which is exactly how `feature-roi` shipped as a blank
 * frame while its metadata said `available: true`. Resolution is now
 * `getComponentForMount(id, 'app')`: a component that has not opted into the app
 * mount is not reachable here, and one that has cannot be missing a branch.
 *
 * ── WHY THE WIRE CONTRACT STAYS IN THE SDK ───────────────────────────────────
 * `EMBED_VIEWS` (`@seanhogg/builderforce-embedded`) keeps the key → label →
 * pillar metadata because a HOST needs it to build its own nav, in a package with
 * no React in it. What it no longer holds is any claim about whether a surface
 * exists — `available` is now answered by the registry, and `appSurfaces.test.tsx`
 * asserts the two lists name the same set so neither can drift.
 */
export default function EmbedViewPage() {
  const params = useParams<{ view: string }>();
  const view = params?.view ?? '';
  const t = useTranslations('embed');
  const frame = useEmbedFrame();
  const [config, setConfig] = useState<{ enabled: boolean; capabilities: EmbedCapability[] } | null>(null);
  const [configError, setConfigError] = useState(false);

  // Drive the APP theme from the host-provided embed theme so mounted components
  // — which read `var(--*)` tokens keyed off `document.documentElement[data-theme]`
  // (set by the root anti-FOUC script from localStorage) — honour the host's
  // light/dark instead of the default. The wrapper div's own `data-theme` only
  // themes the embed chrome; this themes the document root the app's CSS
  // variables actually read.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = frame.theme;
    root.style.colorScheme = frame.theme;
    return () => {
      // Restore on unmount so leaving the embed surface doesn't strand the
      // host-imposed theme on a same-tab navigation.
      if (prev) root.dataset.theme = prev;
    };
  }, [frame.theme]);

  useEffect(() => {
    if (!frame.ready) return;
    // First-party (VS Code extension) sessions skip the host-integration gate
    // entirely — there is no host tenant to enable capabilities; the surface is
    // authorized by the tenant's own JWT. Don't fetch (or block on) /embed/config.
    if (frame.firstParty) return;
    let cancelled = false;
    embedApi
      .getConfig()
      .then((cfg) => !cancelled && setConfig({ enabled: cfg.enabled, capabilities: cfg.capabilities }))
      .catch(() => !cancelled && setConfigError(true));
    return () => {
      cancelled = true;
    };
  }, [frame.ready, frame.firstParty]);

  const wrap = (children: React.ReactNode) => (
    <div
      data-theme={frame.theme}
      style={{
        minHeight: '100vh',
        padding: 16,
        font: '14px system-ui, -apple-system, sans-serif',
        // The effect above puts the host's theme on <html>, which is what the
        // token declarations key off — so the chrome can just READ the tokens
        // instead of re-deciding light/dark for itself.
        background: 'var(--bg-deep)',
        color: 'var(--text-primary)',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );

  const notice = (msg: string, tone: 'muted' | 'error' = 'muted') => (
    <div style={{ color: tone === 'error' ? 'var(--error)' : 'var(--text-secondary)', padding: 8 }} role={tone === 'error' ? 'alert' : undefined}>
      {msg}
    </div>
  );

  if (!isEmbedView(view)) {
    frame.reportError(`Unknown embed view: ${view}`);
    return wrap(notice(t('unknownView', { view }), 'error'));
  }

  const meta = EMBED_VIEWS[view];

  if (!frame.ready) return wrap(notice(t('connecting', { label: meta.label })));

  // Host-integration gate: only third-party hosts (e.g. BurnRateOS) must enable
  // the embed + the view's capability. The first-party VS Code extension is the
  // tenant itself (authed with its own JWT) — it bypasses the gate entirely so
  // "Open Board / Open Page…" renders the real surface instead of a "not enabled"
  // notice (which read as a blank page).
  if (!frame.firstParty) {
    if (configError) return wrap(notice(t('configError'), 'error'));
    if (!config) return wrap(notice(t('loading')));

    // Self-gating: the surface decides its own visibility from the host's enabled
    // capabilities — no prop-drilled flags. governance views ⇒ 'security' capability.
    const capability = capabilityForView(view);
    if (!config.enabled) return wrap(notice(t('notEnabled')));
    if (!config.capabilities.includes(capability)) {
      return wrap(notice(t('capabilityMissing', { capability })));
    }
  }

  // ONE resolution, and it is the same registry the board palette reads.
  const def = getComponentForMount(view, 'app');
  if (!def) {
    return wrap(
      <div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{meta.label}</div>
        <div style={{ color: 'var(--text-secondary)', marginTop: 6 }}>{t('comingSoon', { label: meta.label })}</div>
      </div>,
    );
  }

  const { Surface } = def;
  return wrap(<Surface days={EMBED_WINDOW_DAYS} />);
}

/** The window a framed surface reads over. A host frames a surface without a
 *  range picker, so the mount picks the same default the dashboard opens on. */
const EMBED_WINDOW_DAYS = 30;
