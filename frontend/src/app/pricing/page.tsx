import type { Metadata } from 'next';
import PricingPageClient from './PricingPageClient';

export const metadata: Metadata = {
  title: 'Pricing — Free, Pro & Teams Plans',
  description:
    'Builderforce.ai pricing: Free plan ($0/month forever), Pro ($29/seat/month), and Teams ($20/seat/month). WebGPU LoRA training, dataset generation, AI evaluation, and Workforce Registry.',
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Builderforce.ai Pricing — Free, Pro & Teams',
    description:
      'Free forever plan with WebGPU training. Pro $29/seat/month for unlimited agents. Teams $20/seat/month with shared approval inbox.',
    url: 'https://builderforce.ai/pricing',
  },
  twitter: {
    title: 'Builderforce.ai Pricing',
    description: 'Free forever. Pro $29/seat/mo. Teams $20/seat/mo. WebGPU LoRA training included.',
  },
};

export default function PricingPage() {
  return <PricingPageClient />;
}
