import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import { loginSchema } from '@/lib/structured-data';
import LoginPageClient from './LoginPageClient';

export const metadata: Metadata = {
  title: 'Sign In',
  description:
    'Sign in to Builderforce.ai — the AI agent training platform. Access your projects, datasets, trained models, and the Workforce Registry.',
  alternates: { canonical: '/login' },
  openGraph: {
    title: 'Sign In to Builderforce.ai',
    description:
      'Sign in to access your AI agent workspace. WebGPU LoRA training, dataset generation, and the Workforce Registry.',
    url: 'https://builderforce.ai/login',
  },
  twitter: {
    title: 'Sign In to Builderforce.ai',
    description: 'Access your AI agent workspace — LoRA training, datasets, and the Workforce Registry.',
  },
};

/** The JSON-LD is rendered HERE, on the server, so the FAQPage a crawler receives is
 *  already in the visitor's locale — the client island only renders the form. */
export default async function LoginPage() {
  const t = await getTranslations();
  return (
    <>
      <JsonLd data={loginSchema(t)} />
      <LoginPageClient />
    </>
  );
}
