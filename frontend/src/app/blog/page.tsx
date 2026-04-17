import type { Metadata } from 'next';
import BlogPageClient from './BlogPageClient';

export const metadata: Metadata = {
  title: 'Blog — AI Agent Training Guides & Tutorials',
  description:
    'Deep dives, tutorials, and best practices for building and deploying AI agents. WebGPU LoRA training, dataset generation, multi-agent orchestration, and more.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'Builderforce Blog — AI Agent Training Guides',
    description:
      'Tutorials and best practices for building AI agents with WebGPU LoRA training, dataset generation, and multi-agent orchestration.',
    url: 'https://builderforce.ai/blog',
    type: 'website',
  },
  twitter: {
    title: 'Builderforce Blog — AI Agent Training Guides',
    description:
      'Tutorials and best practices for building AI agents with WebGPU LoRA, dataset generation, and orchestration.',
  },
};

export default function BlogPage() {
  return <BlogPageClient />;
}
