import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JetBrains_Mono } from 'next/font/google';
import { LocaleProvider } from './LocaleProvider';
import './globals.css';
import { AuthProvider } from '@/lib/AuthContext';
import { CartProvider } from '@/lib/CartContext';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});
import { EmulationProvider } from '@/lib/EmulationContext';
import { RolePreviewProvider } from '@/lib/RolePreviewContext';
import { PermissionDebuggerProvider } from '@/lib/PermissionDebuggerContext';
import ThemeProvider from './ThemeProvider';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { ToastProvider } from '@/components/ToastProvider';
import { DemoModeProvider } from '@/components/demo/DemoModeProvider';
import ConditionalAppShell from '@/components/ConditionalAppShell';
import { PwaUpdateBanner } from '@/components/PwaUpdateBanner';
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt';
import { GlobalErrorHandler } from '@/components/GlobalErrorHandler';
import { QualityErrorReporter } from '@/components/QualityErrorReporter';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';
import { ChunkErrorRecovery } from '@/components/ChunkErrorRecovery';
import { EMBED_ERROR_REPORTER } from '@/lib/embed/embedErrorReporter';
import { AUTH_API_URL } from '@/lib/auth';
import { DiscountCodeCapture } from '@/components/DiscountCodeCapture';
import { CookieConsentManager } from '@/components/privacy/CookieConsentManager';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://builderforce.ai';

// Dogfood: our own web errors flow to the Product Quality pillar. The public
// bfq_ ingest key is read server-side (no NEXT_PUBLIC_ needed) and handed to the
// client island; the endpoint tracks whatever API origin auth uses.
const QUALITY_ERROR_KEY = process.env.NEXT_BUILDERFORCE_ERROR_API_KEY || '';
const QUALITY_ENDPOINT = `${AUTH_API_URL}/api/quality-ingest`;
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

        {/* Fontshare loaded via CSS @import in globals.css — no <link> needed here */}
        {/* JetBrains Mono loaded via next/font/google (see jetbrainsMono variable above) — no <link> needed */}
        {/* JSON-LD Structured Data (SEO) — homepage schema injected at layout
            level; per-page schemas are injected in individual page components */}
      </head>
      <body>
        <a className="skip-to-content" href="#main-content">Skip to main content</a>
        <Suspense fallback={null}><DiscountCodeCapture /></Suspense>
        <CookieConsentManager />

        {/* Deep space starfield + nebula — fixed, z-index 0, behind all content */}
        <div className="stars" aria-hidden="true" />
        <div className="nebula" aria-hidden="true" />

        {/* Client island: syncs icon labels after JS hydrates */}
        <ThemeProvider />

        {/* Default-locale messages render statically; LocaleProvider swaps to the
            user's cookie locale on the client after hydration. */}
        <LocaleProvider>
          <ErrorBoundary homePath="/dashboard" homeLabel="Go to Dashboard">
            {/* Chunk-load crashes self-heal (purge stale SW cache + reload onto
                the current build) instead of hitting the generic crash page; any
                non-chunk error re-throws up to ErrorBoundary above. */}
            <ChunkErrorBoundary>
              <AuthProvider>
                <CartProvider>
                  <EmulationProvider>
                    <RolePreviewProvider>
                      <PermissionDebuggerProvider>
                        <ConfirmProvider>
                          <ToastProvider>
                            <DemoModeProvider>
                              <ConditionalAppShell>{children}</ConditionalAppShell>
                            </DemoModeProvider>
                          </ToastProvider>
                        </ConfirmProvider>
                      </PermissionDebuggerProvider>
                    </RolePreviewProvider>
                  </EmulationProvider>
                </CartProvider>
              </AuthProvider>
            </ChunkErrorBoundary>

            <GlobalErrorHandler />
            {QUALITY_ERROR_KEY && (
              <QualityErrorReporter
                apiKey={QUALITY_ERROR_KEY}
                endpoint={QUALITY_ENDPOINT}
                environment={QUALITY_ENVIRONMENT}
              />
            )}
          </ErrorBoundary>

          <ChunkErrorRecovery />
          <PwaUpdateBanner />
          <PwaInstallPrompt />
        </LocaleProvider>
      </body>
    </html>
  );
}
