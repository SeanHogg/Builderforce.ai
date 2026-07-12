'use client';

import { useTranslations } from 'next-intl';

/**
 * The small "type" chip shown beside a BUILT-IN agent's name (Validator, Security, …).
 *
 * Built-in agents can be renamed so they feel like part of the team ("Alice" rather
 * than "Validator"); this badge keeps their TYPE legible next to whatever name the
 * team chose. It reads the stable `ide_agents.builtin_kind` marker — NOT the display
 * name — so it survives a rename.
 *
 * Self-deciding visibility (per the shared-component rule): renders null for an
 * ordinary agent (no `kind`), so callers can drop it in unconditionally.
 *
 * A distinct violet palette (translucent bg + saturated text, readable in BOTH
 * themes, mirroring the eval-score chip) sets it apart from the Cloud / Marketplace
 * runtime pill — this is a role/specialty marker, a different axis.
 */

/** Built-in kinds we ship a localized label for; others fall back to a title-cased slug. */
const KNOWN_KINDS = new Set(['validator', 'security', 'product_manager', 'designer', 'incident_manager', 'cloud_security', 'generalist_coder']);

export function BuiltinKindBadge({ kind }: { kind?: string | null }) {
  const t = useTranslations('workforce.builtinKind');
  const k = kind?.trim().toLowerCase();
  if (!k) return null;

  const label = KNOWN_KINDS.has(k) ? t(k) : k.charAt(0).toUpperCase() + k.slice(1);

  return (
    <span
      title={label}
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 6,
        background: 'rgba(139,92,246,0.15)',
        color: '#7c3aed',
        border: '1px solid rgba(139,92,246,0.3)',
        verticalAlign: 'middle',
      }}
    >
      {label}
    </span>
  );
}
