import type { Metadata } from 'next';
import { AdvisoryClient } from './AdvisoryClient';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: { absolute: 'Advisory — Builderforce.ai' },
  description: 'Book and continue advisory sessions with the advisor already on your account.',
  robots: { index: false, follow: true },
};

/** `/advisory` — founder booking surface for epic #2545. */
export default function AdvisoryPage() {
  return <AdvisoryClient />;
}
