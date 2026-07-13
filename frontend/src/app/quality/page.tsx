import { pageMetadata } from '@/lib/seo';
import QualityClient from '@/components/quality/QualityClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Product Quality',
  description:
    'One place for the full quality of your product: ingest errors from your SDK, OpenTelemetry, Sentry, PostHog and LogRocket, group them, and dispatch an agent to fix them.',
  path: '/quality',
});

export default function QualityPage() {
  return <QualityClient />;
}
