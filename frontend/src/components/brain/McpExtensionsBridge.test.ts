import type { UseMcpExtensionsOptions } from '@seanhogg/builderforce-brain-embedded';
import { expect, it, vi } from 'vitest';
import { McpExtensionsBridge } from './McpExtensionsBridge';

const mock = vi.hoisted(() => ({ useMcpExtensions: vi.fn<(options: UseMcpExtensionsOptions) => void>() }));
vi.mock('@/lib/brain', () => mock);

it('opts the web platform relay into canonical provider names and preserves local substitutions', () => {
  McpExtensionsBridge();
  const options = mock.useMcpExtensions.mock.calls[0]![0];
  const entry = { name: 'builtin_tasks_list', wireName: 'platform__tasks_list', extensionId: 'builtin', tool: 'tasks.list', description: '', parameters: {} };

  expect(options.toolWireName?.(entry)).toBe('platform__tasks_list');
  const remote = { ...entry, extensionId: 'tenant-addon', tool: 'runtime.preview_status', wireName: 'catalog__cafe' };
  expect(options.toolWireName?.(remote)).toBe(remote.wireName);
  const local = { ...entry, tool: 'runtime.preview_status' };
  expect(options.localTools?.(local)).toBeTypeOf('function');
  expect(options.toolWireName?.(local)).toBeUndefined();
});
