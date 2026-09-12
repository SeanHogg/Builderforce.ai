import type { Metadata } from 'next';
import JsonLd from '@/components/JsonLd';
import { defaultCopy } from '@/lib/content/defaultCopy';
import { registerSchema } from '@/lib/structured-data';
import RegisterPageClient from './RegisterPageClient';

export const metadata: Metadata = {
  title: 'Create Account — Start Building AI Agents Free',
  description:
    'Create a free Builderforce.ai account. Build, train, and deploy custom AI agents with WebGPU LoRA fine-tuning in the browser. No credit card required, 14-day Pro trial included.',
  alternates: { canonical: '/register' },
  openGraph: {
    title: 'Create Your Builderforce.ai Account — Free Forever',
    description:
      'Start building AI agents for free. WebGPU LoRA training, dataset generation, AI evaluation, and Workforce Registry access. No credit card required.',
    url: 'https://builderforce.ai/register',
  },
  twitter: {
    title: 'Create Your Builderforce.ai Account',
    description: 'Build AI agents free. WebGPU LoRA training, datasets, evaluation. No credit card.',
  },
};

/** JSON-LD on the server, out of the client bundle — see `app/login/page.tsx`. */
export default function RegisterPage() {
  return (
    <>
      <JsonLd data={registerSchema(defaultCopy)} />
      <RegisterPageClient />
    </>
  );
}
