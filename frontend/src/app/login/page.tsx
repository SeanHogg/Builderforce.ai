import type { Metadata } from 'next';
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

export default function LoginPage() {
  return <LoginPageClient />;
}
