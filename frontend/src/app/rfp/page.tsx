import type { Metadata } from 'next';
import RfpPageClient from './RfpPageClient';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'RFP Response — Pre-Sales Proposals',
  description: 'Respond to an RFQ/RFP with a co-branded proposal grounded on your portfolio: capability roster, P&L, delivery plan and risks.',
};

export default function RfpPage() {
  return <RfpPageClient />;
}
