import type { Metadata } from 'next';
import BookDemoPageClient from './BookDemoPageClient';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Book a Demo — Builderforce.ai',
  description: 'Schedule a personalized walkthrough of Builderforce with our team, or explore a self-serve live demo right now.',
  alternates: { canonical: '/book-demo' },
};

export default function BookDemoPage() {
  return <BookDemoPageClient />;
}
