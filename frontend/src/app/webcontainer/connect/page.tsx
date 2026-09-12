export const runtime = 'edge';

import { WebContainerConnect } from '@/components/webcontainer/WebContainerConnect';

/**
 * WebContainer "connect" page. Must be at exactly /webcontainer/connect (no trailing
 * segment) so that @webcontainer/api's setupConnect() recognises the pathname. Served
 * without COOP: same-origin (see next.config.js). The handshake itself is the shared
 * `WebContainerConnect` client leaf, so this route stays a Server Component.
 */
export default function WebContainerConnectPage() {
  return <WebContainerConnect />;
}
