import { describe, expect, it } from 'vitest';
import { resolveRunGate } from './runGate';

/**
 * Pins the host-capability contract for run dispatch. The regression this guards
 * is a viewer seeing a live-looking ▶ Run button that only refuses at CLICK time
 * with a role error — every other dispatch control in the product disables and
 * explains instead.
 */
describe('resolveRunGate', () => {
  it('permits dispatch when the host does not implement the probe', () => {
    // The VS Code webview has no tenant-role context at all. Defaulting to DENIED
    // there would disable the button in a surface that cannot answer, so an absent
    // probe must mean "permitted", not "unknown → refuse".
    expect(resolveRunGate({})).toEqual({ allowed: true });
  });

  it('permits dispatch when the host says the role allows it', () => {
    expect(resolveRunGate({ canRunTicket: () => ({ allowed: true }) })).toEqual({ allowed: true, reason: undefined });
  });

  it('denies dispatch and carries the host reason through for the tooltip', () => {
    const gate = resolveRunGate({ canRunTicket: () => ({ allowed: false, reason: 'Requires Developer role' }) });
    expect(gate.allowed).toBe(false);
    // The reason is host-LOCALIZED — the package must pass it through verbatim
    // rather than substituting English of its own.
    expect(gate.reason).toBe('Requires Developer role');
  });

  it('denies without a reason rather than falling open', () => {
    // A host that answers `allowed: false` but supplies no copy must still gate;
    // the panel falls back to its generic run label for the tooltip.
    expect(resolveRunGate({ canRunTicket: () => ({ allowed: false }) })).toEqual({ allowed: false, reason: undefined });
  });
});
