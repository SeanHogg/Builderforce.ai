import { NAV_GROUPS } from '@/lib/navGroups';
import { isDomain, type Domain } from '@/lib/kernel/kernelApi';

export type BuiltinAgentSurfaceIntent = 'execute' | 'diagnostics';

/**
 * The native product surface for an always-on agent.
 *
 * Navigation remains registry-driven: the footer seat and the destination use
 * the same owner/domain identity. Manager is the one richer specialization —
 * its operational UI is the Manager tab rather than the generic Delivery seat.
 */
export function builtinAgentSurfaceHref(
  domainValue: unknown,
  seatValue: unknown,
  intent: BuiltinAgentSurfaceIntent,
): string | null {
  if (typeof domainValue !== 'string' || !isDomain(domainValue) || typeof seatValue !== 'string' || !seatValue) return null;
  const domain: Domain = domainValue;

  if (domain === 'delivery' && seatValue === 'Manager') {
    return intent === 'diagnostics'
      ? '/projects?tab=manager&sub=stuck'
      : '/projects?tab=manager';
  }

  const destination = NAV_GROUPS.find((entry) => (
    entry.seat === seatValue
    && (entry.id === domain || entry.href === `/seat/${domain}`)
  ));
  return destination?.href ?? `/seat/${domain}`;
}
