import { describe, expect, it } from 'vitest';
import { destinationHref } from './useDestinations';
import type { GatedDestination } from './useDestinations';

const base: GatedDestination = {
  id: 'settings.persona', labelKey: 'tab.persona', groupLabelKey: 'group.settings',
  href: '/settings/persona', icon: '🎯', feature: 'psychometricPersona', locked: false,
};

describe('destinationHref', () => {
  it('goes to the page when the tenant is entitled', () => {
    expect(destinationHref(base)).toBe('/settings/persona');
  });

  it('sends a locked destination to pricing rather than into a 402', () => {
    expect(destinationHref({ ...base, locked: true })).toBe('/pricing?feature=psychometricPersona');
  });

  it('still reaches pricing when a locked destination names no feature', () => {
    // Defensive: a lock with no feature should degrade to the pricing page, not
    // to a malformed URL.
    expect(destinationHref({ ...base, locked: true, feature: undefined })).toBe('/pricing?feature=');
  });
});
