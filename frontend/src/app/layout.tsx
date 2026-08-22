import type { Metadata } from 'next';
import { Suspense } from 'react';
import localFont from 'next/font/local';
import { LocaleProvider } from './LocaleProvider';
import './globals.css';
// KaTeX's own stylesheet. Loaded once, at the root, because mathematics can
// appear in any markdown on the platform (see lib/markdownPipeline.ts) and an
// un-styled `.katex` tree renders as a column of stacked fragments rather than
// an equation. The theme rules that adapt it live in globals.css.
import 'katex/dist/katex.min.css';
import { AuthProvider } from '@/lib/AuthContext';

// Self-hosted via `@fontsource/jetbrains-mono` rather than `next/font/google`:
// the Google variant fetches the font FILES from Google Fonts at BUILD time, so
// a CI runner with no route to fonts.googleapis.com (or a rate-limited one)
// fails the whole deploy on a font, not a defect in this codebase (observed
// 2026-08-17, Deploy frontend). `next/font/local` gets the same zero-layout-
// shift self-hosting, preloading and generated `--font-jetbrains-mono` variable
// `next/font/google` gave us, from files already on disk — no network involved
// at build OR request time.
const jetbrainsMono = localFont({
  src: [
    { path: '../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});
import ThemeProvider from './ThemeProvider';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { ToastProvider } from '@/components/ToastProvider';
import ConditionalAppShell from '@/components/ConditionalAppShell';
import { PwaUpdateBanner } from '@/components/PwaUpdateBanner';
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt';
import { GlobalErrorHandler } from '@/components/GlobalErrorHandler';
import { QualityErrorReporter } from '@/components/QualityErrorReporter';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';
import { ChunkErrorRecovery } from '@/components/ChunkErrorRecovery';
import { EMBED_ERROR_REPORTER } from '@/lib/embed/embedErrorReporter';
import { QUALITY_INGEST_ENDPOINT } from '@/lib/reportError';
import { VisitorJourneyTracker } from '@/components/VisitorJourneyTracker';
import { DiscountCodeCapture } from '@/components/DiscountCodeCapture';
import { CookieConsentManager } from '@/components/privacy/CookieConsentManager';
import { SkipToContent } from '@/components/SkipToContent';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://builderforce.ai';

// Dogfood: our own web errors flow to the Product Quality pillar. The public
// bfq_ ingest key is read server-side (no NEXT_PUBLIC_ needed) and handed to the
// client island; the endpoint tracks whatever API origin auth uses.
const QUALITY_ERROR_KEY = process.env.NEXT_BUILDERFORCE_ERROR_API_KEY || '';
const QUALITY_ENVIRONMENT = process.env.NODE_ENV === 'production' ? 'production' : 'development';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Builderforce.ai — The Creative Canvas for Humans and AI Agents',
    template: '%s | Builderforce.ai',
  },
  description:
    'Turn any idea into something real in one visual workspace where your team and AI agents design, build, review, and deliver websites, workflows, models, data stories, and products.',
  keywords: [
    'AI creative canvas',
    'visual AI workspace',
    'human AI collaboration',
    'AI product creation',
    'AI agent training',
    'AI agents',
    'human-in-the-loop AI',
    'agentic cloud',
    'Kanban board',
    'project management',
    'VS Code extension',
    'WebGPU',
    'LoRA fine-tuning',
    'AI workforce',
    'agent orchestration',
    'Builderforce',
    'AI coding',
    'skills marketplace',
    'AI personas',
  ],
  authors: [{ name: 'Builderforce', url: BASE_URL }],
  creator: 'Builderforce',
  publisher: 'Builderforce',
  robots: 'index, follow',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: BASE_URL,
    siteName: 'Builderforce.ai',
    title: 'Builderforce.ai — Turn Any Idea Into Something Real',
    // Front-loaded for chat/link unfurls, which truncate after ~1–2 lines on mobile.
    description:
      'One creative canvas where your team and AI agents design, build, review, and deliver—without the tool sprawl.',
    // Static branded PNG (the B-logo lockup). We do NOT use a next/og ImageResponse
    // route here: on the Cloudflare edge runtime it returns an empty 0-byte image, so
    // iMessage/SMS/Slack unfurl a stale cached preview. See lib/seo.ts → OG_IMAGE.
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Builderforce.ai' }],
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Builderforce.ai — The Creative Canvas for Humans and AI Agents',
    description:
      'Turn ideas into websites, workflows, models, data stories, and products with your team and AI agents in one visual workspace.',
    images: ['/og-image.png'],
  },
  manifest: '/manifest.json',
  applicationName: 'Builderforce.ai',
  appleWebApp: {
    capable: true,
    title: 'Builderforce.ai',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [{ url: '/icon.png', type: 'image/png', sizes: '32x32' }, { url: '/icon-192.png', type: 'image/png', sizes: '192x192' }],
    shortcut: '/icon.png',
    apple: [{ url: '/apple-touch-icon.png', type: 'image/png', sizes: '180x180' }],
  },
  other: {
    'color-scheme': 'dark light',
  },
};

export const viewport = {
  // The browser chrome reads `theme-color` from the document HEAD before a
  // stylesheet exists, so these two are literals by necessity — a `var()` here
  // is simply dropped, which had left the light-mode address bar unthemed.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f0f14' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Static-rendered shell in the default locale; the client LocaleProvider swaps
  // to the user's cookie locale after hydration (see LocaleProvider). This keeps
  // marketing/public pages statically prerendered (SEO) instead of forcing every
  // route dynamic via a server-side cookie read.
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={jetbrainsMono.variable}>
      <head>
        {/*
          Anti-FOUC: runs synchronously before any paint.
          Reads saved theme from localStorage; defaults to "dark".
          suppressHydrationWarning on <html> allows React to skip reconciling
          the data-theme / style.colorScheme attributes that this script mutates.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('bf-theme');var th=t==='light'?'light':'dark';document.documentElement.dataset.theme=th;document.documentElement.style.colorScheme=th;}catch(e){}})();`,
          }}
        />

        {/*
          Framed-only embed crash reporter. Runs before any route bundle (raw
          inline <head> script — the reliable "beforeInteractive", which a nested
          layout can't provide). No-ops on the top-level app; when framed, it
          relays render/hydration throws to the host so an embed failure is
          diagnosable instead of a silent 15s timeout. See embedErrorReporter.ts.
        */}
        <script dangerouslySetInnerHTML={{ __html: EMBED_ERROR_REPORTER }} />

        {/* JetBrains Mono self-hosted via next/font/local (see jetbrainsMono variable above) — no <link> needed.
            Body/display text uses the system stack in globals.css (--font-sans), so no font origin
            beyond 'self' is loaded and the CSP font-src/style-src stay at 'self'. */}
        {/* JSON-LD Structured Data (SEO) — homepage schema injected at layout
            level; per-page schemas are injected in individual page components */}
      </head>
      <body>
        <Suspense fallback={null}><DiscountCodeCapture /></Suspense>

        {/* Deep space starfield + nebula — fixed, z-index 0, behind all content */}
        <div className="stars" aria-hidden="true" />
        <div className="nebula" aria-hidden="true" />

        {/* Client island: syncs icon labels after JS hydrates */}
        <ThemeProvider />

        {/* Default-locale messages render statically; LocaleProvider swaps to the
            user's cookie locale on the client after hydration. */}
        <LocaleProvider>
          {/* Both are translated, so both must sit INSIDE the locale provider —
              the skip link first, so nothing focusable precedes it. */}
          <SkipToContent />
          <CookieConsentManager />

          <ErrorBoundary homePath="/dashboard" homeLabel="Go to Dashboard">
            {/* Chunk-load crashes self-heal (purge stale SW cache + reload onto
                the current build) instead of hitting the generic crash page; any
                non-chunk error re-throws up to ErrorBoundary above. */}
            <ChunkErrorBoundary>
              <AuthProvider>
                {/*
                  What is left at the ROOT is what EVERY route needs: the session,
                  the confirm/toast primitives any surface may call, and the locale
                  above them all.

                  The cart, the message hub, and the three emulation/role-preview/
                  permission-debugger contexts were here too, and none of them was
                  ever a root concern — their only consumers are app-shell chrome
                  and a handful of app routes. Sitting at the root they were mounted
                  for `/embed/*` as well, the one surface documented as hostile to
                  app-wide effects, and every one of their state changes re-rendered
                  from above the router's page slot. They now live in
                  `ConditionalAppShell`'s non-embed branch, which is still above the
                  page slot (so an open cart or conversation still survives a
                  navigation) and still below the shell switch. See PRD 22 §3.14.
                */}
                <ConfirmProvider>
                  <ToastProvider>
                    <ConditionalAppShell>
                      {/*
                        ONE CSR-bailout boundary for the page slot.

                        51 client components call `useSearchParams()`, and a
                        statically prerendered page that reads it without a
                        Suspense boundary above it fails the build outright
                        ("should be wrapped in a suspense boundary"). Nothing had
                        ever hit that, because `AuthProvider` returned null on the
                        server and no page below it rendered far enough to read
                        anything — the blank server render was masking the missing
                        boundaries as well as emptying the HTML. It goes HERE,
                        around the page slot only: the shell chrome still
                        prerenders, and a page that does not read search params is
                        unaffected, since Suspense costs nothing until something
                        below it actually bails. One boundary, not 51.
                      */}
                      <Suspense fallback={null}>{children}</Suspense>
                    </ConditionalAppShell>
                  </ToastProvider>
                </ConfirmProvider>
              </AuthProvider>
            </ChunkErrorBoundary>

            <GlobalErrorHandler />
            <QualityErrorReporter
              apiKey={QUALITY_ERROR_KEY}
              endpoint={QUALITY_INGEST_ENDPOINT}
              environment={QUALITY_ENVIRONMENT}
            />
            {/* The third of the three anonymous recorders, next to the error
                reporter above and the prompt capture on the composer: where the
                visitor WENT. It decides for itself that a signed-in session is
                not its business. */}
            <VisitorJourneyTracker />
          </ErrorBoundary>

          <ChunkErrorRecovery />
          <PwaUpdateBanner />
          <PwaInstallPrompt />
        </LocaleProvider>
      </body>
    </html>
  );
}
