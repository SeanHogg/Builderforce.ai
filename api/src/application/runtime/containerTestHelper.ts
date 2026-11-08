/** The workspace helper script the container sandbox tests hand to `createSandboxBox` (the transports pass their own). */
import { fileURLToPath } from 'node:url';

export const WORKSPACE_HELPER = fileURLToPath(new URL('../../../container/workspaceAgent.mjs', import.meta.url));
