import type { BuilderForceAgentsPluginApi } from '@seanhogg/builderforce-agents/plugin-sdk';
import { emptyPluginConfigSchema } from '@seanhogg/builderforce-agents/plugin-sdk';
import plugin from './index.js';

/**
 * Plugin: Chat Relations
 *
 * Provides backend services to identify and store relationships between a user's chats.
 * Exposes tools for persisted retrievals and relationships creation/invalidation.
 */
const chatRelationsPlugin = {
  id: 'chat-relations',
  name: 'Chat Relations',
  description: 'Identify similar and subset relations between a user’s chat conversations',
  kind: 'chat-relations' as const,

  configSchema: emptyPluginConfigSchema(),

  register(api: BuilderForceAgentsPluginApi): void {
    api.registerService({
      id: 'chat-relations',
      start: () => {
        api.logger.info('chat-relations: plugin registered (no DB or API configured yet)');
      },
      stop: () => {
        // cleanup
      },
    });
  },
};

export default chatRelationsPlugin;