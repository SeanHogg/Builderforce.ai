export const runtime = 'edge';

import { WebContainerConnect } from '@/components/webcontainer/WebContainerConnect';

/**
 * WebContainer "connect" page for a preview opened in a new tab: that tab redirects
 * here (e.g. /webcontainer/connect/61636aac) and runs the same handshake as the bare
 * route, so it can talk to the parent IDE. Must be served with
 * Cross-Origin-Embedder-Policy: unsafe-none (see next.config.js).
 */
export default function WebContainerConnectIdPage() {
  return <WebContainerConnect />;
}
