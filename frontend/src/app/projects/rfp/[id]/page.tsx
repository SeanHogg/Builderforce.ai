import type { Metadata } from 'next';
import RfpDetailClient from './RfpDetailClient';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'RFP Response',
  description: 'A co-branded pre-sales proposal: capability roster, P&L, delivery plan, risks and a branded document.',
};

export default function RfpDetailPage() {
  return <RfpDetailClient />;
}
