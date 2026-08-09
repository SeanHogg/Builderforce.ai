'use client';

import PageContainer from '@/components/PageContainer';
import { EmbeddedCapabilities } from '@/components/embedded/EmbeddedCapabilities';

export default function EmbeddedPage() {
  return <PageContainer width="full" style={{ padding: '32px 40px' }}><EmbeddedCapabilities /></PageContainer>;
}
