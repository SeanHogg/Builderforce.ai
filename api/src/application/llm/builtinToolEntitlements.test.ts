import { beforeEach, describe, expect, it, vi } from 'vitest';

const isOperator = vi.fn();
const hasFeature = vi.fn();
vi.mock('../tenant/platformOperator', () => ({ isPlatformOperator: (...a: unknown[]) => isOperator(...a) }));
vi.mock('../tenant/featureEntitlements', () => ({ tenantHasFeature: (...a: unknown[]) => hasFeature(...a) }));

import { entitledBuiltinTools } from './builtinToolEntitlements';
import type { Env } from '../../env';

const env = {} as Env;
const TOOLS = [{ tool: 'tasks.list' }, { tool: 'deploy.status' }];

beforeEach(() => { isOperator.mockReset(); hasFeature.mockReset(); });

describe('entitledBuiltinTools — platform-operator tools', () => {
  it('hides deploy.status from a workspace that is not the platform operator', async () => {
    isOperator.mockResolvedValue(false);
    expect((await entitledBuiltinTools(env, 42, null, TOOLS)).map((t) => t.tool)).toEqual(['tasks.list']);
    expect(isOperator).toHaveBeenCalledWith(env, 42, null);
  });

  it('shows deploy.status to the platform operator', async () => {
    isOperator.mockResolvedValue(true);
    expect((await entitledBuiltinTools(env, 1, 'u-sa', TOOLS)).map((t) => t.tool)).toEqual(['tasks.list', 'deploy.status']);
  });

  it('does not resolve the operator when no gated tool is in the list', async () => {
    expect(await entitledBuiltinTools(env, 42, null, [{ tool: 'tasks.list' }])).toEqual([{ tool: 'tasks.list' }]);
    expect(isOperator).not.toHaveBeenCalled();
  });
});
