import type { Metadata } from 'next';
import SalesCanvasLauncher from './SalesCanvasLauncher';

export const metadata: Metadata = {
  title: 'Sales Associate Hub',
  description: 'Builderforce referral and sales associate pipeline, campaigns, contacts, goals, and meetings.',
};

export default function SalesPage() {
  return <SalesCanvasLauncher />;
}
