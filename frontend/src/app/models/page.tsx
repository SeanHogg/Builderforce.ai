import { pageMetadata } from '@/lib/seo';
import ModelsPageClient from './ModelsPageClient';

export const metadata = pageMetadata({
  title: 'Models — Free, Pro & the Full Live Catalog',
  description:
    'Browse every model you can route through Builderforce.ai — our free smart-routed model and Pro frontier routing first, then the full live OpenRouter catalog with up-to-date pricing and context windows. Compare up to three side by side.',
  path: '/models',
  ogTitle: 'Builderforce.ai Models — compare pricing & context windows',
});

export default function ModelsPage() {
  return <ModelsPageClient />;
}
