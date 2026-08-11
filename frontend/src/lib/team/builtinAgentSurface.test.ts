import { describe, expect, it } from 'vitest';
import { builtinAgentSurfaceHref } from './builtinAgentSurface';

describe('builtinAgentSurfaceHref', () => {
  it('opens Manager in its operational tab and diagnostics view', () => {
    expect(builtinAgentSurfaceHref('delivery', 'Manager', 'execute')).toBe('/projects?tab=manager');
    expect(builtinAgentSurfaceHref('delivery', 'Manager', 'diagnostics')).toBe('/projects?tab=manager&sub=stuck');
  });

  it('uses each other built-in seat native registered destination', () => {
    expect(builtinAgentSurfaceHref('growth', 'CMO', 'execute')).toBe('/growth');
    expect(builtinAgentSurfaceHref('finance', 'CFO', 'execute')).toBe('/seat/finance');
    expect(builtinAgentSurfaceHref('support', 'Support', 'diagnostics')).toBe('/seat/support');
  });

  it('does not turn custom agents into built-ins', () => {
    expect(builtinAgentSurfaceHref(null, null, 'execute')).toBeNull();
    expect(builtinAgentSurfaceHref('not-a-domain', 'Manager', 'execute')).toBeNull();
  });
});
