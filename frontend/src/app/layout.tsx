import type { Metadata } from 'next';
import Script from 'next/script';
import { JetBrains_Mono } from 'next/font/google';
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
import ConditionalAppShell from '@/components/ConditionalAppShell';
import { PwaUpdateBanner } from '@/components/PwaUpdateBanner';
import { GlobalErrorHandler } from '@/components/GlobalErrorHandler';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://builderforce.ai';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Builderforce.ai — AI Agent Training Platform | Build & Deploy AI Agents',
    template: '%s | Builderforce.ai',
  },
  description:
    'Build, train, and deploy custom AI agents. WebGPU LoRA fine-tuning in the browser. Generate datasets, evaluate with AI judges, publish to the Workforce Registry. Skills marketplace, personas, and AI-native workflows.',
  keywords: [
    'AI agent training',
    'AI agents',
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
    title: 'Builderforce.ai — AI Agent Training Platform',
    description:
      'Build, train, and deploy custom AI agents. WebGPU LoRA fine-tuning, skills marketplace, personas, and AI-native workflows. Publish to the Workforce Registry.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Builderforce.ai — AI Agent Training Platform',
      },
    ],
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Builderforce.ai — AI Agent Training Platform',
    description:
      'Build, train, and deploy custom AI agents. WebGPU LoRA, skills marketplace, personas. Publish to the Workforce Registry.',
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
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={jetbrainsMono.variable}>
      <head>
        {/* Google Tag Manager — uses next/script so Next.js can manage loading strategy */}
        <Script
          id="gtm"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-5Q488PKG');`,
          }}
        />
        {/* End Google Tag Manager */}

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

        {/* Fontshare loaded via CSS @import in globals.css — no <link> needed here */}
        {/* JetBrains Mono loaded via next/font/google (see jetbrainsMono variable above) — no <link> needed */}
        {/* JSON-LD Structured Data (SEO) — homepage schema injected at layout
            level; per-page schemas are injected in individual page components */}
      </head>
      <body>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-5Q488PKG"
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
        {/* End Google Tag Manager (noscript) */}

        {/* Deep space starfield + nebula — fixed, z-index 0, behind all content */}
        <div className="stars" aria-hidden="true" />
        <div className="nebula" aria-hidden="true" />

        {/* Client island: syncs icon labels after JS hydrates */}
        <ThemeProvider />

        <ErrorBoundary homePath="/dashboard" homeLabel="Go to Dashboard">
          <AuthProvider>
            <CartProvider>
              <EmulationProvider>
                <RolePreviewProvider>
                  <PermissionDebuggerProvider>
                    <ConditionalAppShell>{children}</ConditionalAppShell>
                  </PermissionDebuggerProvider>
                </RolePreviewProvider>
              </EmulationProvider>
            </CartProvider>
          </AuthProvider>

          <GlobalErrorHandler />
        </ErrorBoundary>

        <PwaUpdateBanner />
      </body>
    </html>
  );
}
