import type { ChannelPlugin } from '@seanhogg/builderforce-agents/plugin-sdk';
import { getJiraLinearRuntime } from './runtime.js';

export const jiraLinearPlugin: ChannelPlugin = {
  id: 'jira-linear',
  meta: {
    id: 'jira-linear',
    label: 'Jira & Linear Integration',
  },
};