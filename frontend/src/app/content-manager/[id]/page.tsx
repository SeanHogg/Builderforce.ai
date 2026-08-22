/**
 * Content Manager has been retired and folded into Knowledge. Individual content
 * pages no longer exist as a distinct surface — send the visitor to Knowledge,
 * where their migrated documents now live (see /content-manager, which runs the
 * one-time localStorage → knowledge_documents migration).
 */
import { retiredRoute } from '@/lib/routing/retiredRoute';

export const runtime = 'edge';

export default retiredRoute('/content-manager');
