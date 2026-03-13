import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/AuthContext';
import ThemeProvider from './ThemeProvider';
import ConditionalAppShell from '@/components/ConditionalAppShell';

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
    <html lang="en" data-theme="dark" suppressHydrationWarning>
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

        {/* Fontshare — Clash Display (headings) + Satoshi (body) */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=clash-display@700,600,500&f[]=satoshi@400,500,700&display=swap"
          rel="stylesheet"
        />
        {/* Task 8: JetBrains Mono — used by Monaco editor and xterm.js terminal */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        {/* JSON-LD Structured Data (SEO) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': 'Organization',
                  '@id': `${BASE_URL}/#organization`,
                  name: 'Builderforce',
                  url: BASE_URL,
                  logo: { '@type': 'ImageObject', url: `${BASE_URL}/icon.png` },
                  contactPoint: {
                    '@type': 'ContactPoint',
                    contactType: 'customer support',
                    url: BASE_URL,
                  },
                },
                {
                  '@type': 'SoftwareApplication',
                  '@id': `${BASE_URL}/#app`,
                  name: 'Builderforce.ai',
                  description:
                    'AI agent training platform. Build, train, and deploy custom AI agents with WebGPU LoRA fine-tuning in the browser, skills marketplace, personas, and publish to the Workforce Registry.',
                  url: BASE_URL,
                  applicationCategory: 'DeveloperApplication',
                  operatingSystem: 'Web',
                  author: { '@id': `${BASE_URL}/#organization` },
                },
                {
                  '@type': 'WebSite',
                  '@id': `${BASE_URL}/#website`,
                  url: BASE_URL,
                  name: 'Builderforce.ai',
                  publisher: { '@id': `${BASE_URL}/#organization` },
                },
                {
                  '@type': 'SoftwareApplication',
                  '@id': `${BASE_URL}/#pricing`,
                  offers: [
                    {
                      '@type': 'Offer',
                      name: 'Free',
                      price: '0',
                      priceCurrency: 'USD',
                      description: 'WebGPU training, public Workforce browsing, community support',
                    },
                    {
                      '@type': 'Offer',
                      name: 'Pro',
                      price: '29',
                      priceCurrency: 'USD',
                      priceSpecification: {
                        '@type': 'UnitPriceSpecification',
                        price: '29',
                        priceCurrency: 'USD',
                        unitText: 'seat/month',
                      },
                      description: 'Unlimited agents, private models, priority support',
                    },
                  ],
                },
                {
                  '@type': 'FAQPage',
                  'mainEntity': [
                    {
                      '@type': 'Question',
                      name: 'What is Builderforce.ai?',
                      acceptedAnswer: { '@type': 'Answer', text: 'Builderforce.ai is an end-to-end platform for building, training, and deploying custom AI agents entirely in the browser.' },
                    },
                    {
                      '@type': 'Question',
                      name: 'Is Builderforce free?',
                      acceptedAnswer: { '@type': 'Answer', text: 'Yes – the Free tier includes WebGPU training, dataset tools, and public Workforce browsing. The Pro plan ($29/seat) unlocks private agents, unlimited training, and priority support.' },
                    },
                    {
                      '@type': 'Question',
                      name: 'How do I train a model in my browser?',
                      acceptedAnswer: { '@type': 'Answer', text: 'Start a project, generate or upload a dataset, then launch the in‑browser LoRA training wizard. No cloud GPUs are required.' },
                    },
                    {
                      '@type': 'Question',
                      name: 'What is the Workforce Registry?',
                      acceptedAnswer: { '@type': 'Answer', text: 'The Workforce Registry is a public marketplace where trained agents can be listed, discovered, and hired by other teams or applications.' },
                    },
                  ],
                },
              ],
            }),
          }}
        />
      </head>
      <body>
        {/* Deep space starfield + nebula — fixed, z-index 0, behind all content */}
        <div className="stars" aria-hidden="true" />
        <div className="nebula" aria-hidden="true" />

        {/* Client island: syncs icon labels after JS hydrates */}
        <ThemeProvider />

        <AuthProvider>
          <ConditionalAppShell>{children}</ConditionalAppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
