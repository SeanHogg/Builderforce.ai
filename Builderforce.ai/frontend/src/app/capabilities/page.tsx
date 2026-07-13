import CapabilitiesList from '@/components/capabilities/CapabilitiesList';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Capabilities | Builderforce',
};

export default async function CapabilitiesPage() {
  return <CapabilitiesList />;
}