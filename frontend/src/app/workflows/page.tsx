import { legacyWorkflowLibraryHref } from '@/lib/canvas/legacyCreationRoute';
import { retiredRoute } from '@/lib/routing/retiredRoute';

export const runtime = 'edge';

export default retiredRoute((search) => legacyWorkflowLibraryHref('/workflows', {
  get: (key) => search[key] ?? null,
}));
