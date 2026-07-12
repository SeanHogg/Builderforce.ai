import type { BuilderForceAgentsPluginApi } from '@seanhogg/builderforce-agents/plugin-sdk';
import { emptyPluginConfigSchema } from '@seanhogg/builderforce-agents/plugin-sdk';
import { registerIntegrationCardCommand } from './src/card-command.js';
import { jiraLinearPlugin } from './src/integration.js';
import { setJiraLinearRuntime } from './src/runtime.js';

const plugin = {
  id: 'jira-linear',
  name: 'Jira & Linear Integration',
  description: 'Project management integration layer for Jira and Linear with OAuth, issue import, and status synchronization',
  configSchema: emptyPluginConfigSchema(),
  register(api: BuilderForceAgentsPluginApi) {
    setJiraLinearRuntime(api.runtime);
    api.registerChannel({ plugin: jiraLinearPlugin });
    registerIntegrationCardCommand(api);
  },
};

export default plugin;