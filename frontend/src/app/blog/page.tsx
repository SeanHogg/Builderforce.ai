import type { Metadata } from 'next';
import BlogPageClient from './BlogPageClient';

export const metadata: Metadata = {
  title: 'Blog — AI Agent Guides, Tutorials & Tool Comparisons',
  description:
    'Deep dives, tutorials, and honest comparisons for building and deploying AI agents — autonomous Kanban execution, semantic caching, WebGPU LoRA training, multi-agent orchestration, and how Builderforce.ai stacks up against Copilot, Cursor, Claude Code and Devin.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'Builderforce Blog — AI Agent Guides & Tool Comparisons',
    description:
      'Tutorials, deep dives, and head-to-head comparisons: multi-agent orchestration, semantic caching, WebGPU LoRA training, and Builderforce.ai vs Copilot, Cursor, Claude Code and Devin.',
    url: 'https://builderforce.ai/blog',
    type: 'website',
  },
  twitter: {
    title: 'Builderforce Blog — AI Agent Guides & Tool Comparisons',
    description:
      'Multi-agent orchestration, semantic caching, WebGPU LoRA training, and Builderforce.ai vs Copilot, Cursor, Claude Code and Devin.',
  },
};

export default function BlogPage() {
  return <BlogPageClient />;
}
