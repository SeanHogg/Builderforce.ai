'use client';

/**
 * Decorative, theme-aware SVG for the account-type marketing panels. Two
 * variants: `standard` renders an agent-workforce graph (a hub delegating to
 * trained specialists); `freelancer` renders a for-hire talent card. Both use
 * theme tokens so they read in light and dark, and scale to their container.
 *
 * Shared by the /register split-panel and the post-OAuth role chooser so the
 * two surfaces stay visually identical.
 */
export default function MarketingVisual({ variant }: { variant: 'standard' | 'freelancer' }) {
  const wrap: React.CSSProperties = {
    width: '100%',
    borderRadius: 16,
    marginBottom: 24,
    padding: '20px 20px 8px',
    background: 'linear-gradient(135deg, var(--surface-coral-soft), transparent 70%)',
    border: '1px solid var(--border-subtle)',
    overflow: 'hidden',
  };
  if (variant === 'freelancer') {
    return (
      <div style={wrap} aria-hidden>
        <svg viewBox="0 0 320 150" width="100%" role="presentation" style={{ display: 'block' }}>
          {/* Profile card */}
          <rect x="18" y="18" width="284" height="114" rx="14" fill="var(--bg-elevated)" stroke="var(--border-subtle)" />
          {/* Avatar */}
          <circle cx="56" cy="52" r="20" fill="var(--coral-bright)" opacity="0.9" />
          <circle cx="56" cy="46" r="7" fill="var(--bg-elevated)" />
          <path d="M42 64c2-8 26-8 28 0" fill="var(--bg-elevated)" />
          {/* Name + rate */}
          <rect x="88" y="40" width="90" height="9" rx="4.5" fill="var(--text-primary)" opacity="0.85" />
          <rect x="88" y="56" width="58" height="7" rx="3.5" fill="var(--text-muted)" opacity="0.7" />
          <rect x="214" y="38" width="72" height="26" rx="13" fill="var(--surface-coral-soft)" stroke="var(--coral-bright)" />
          <text x="250" y="55" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--coral-bright)" fontFamily="var(--font-display)">$95/hr</text>
          {/* Skill chips */}
          {[0, 1, 2].map((i) => (
            <rect key={i} x={40 + i * 76} y="92" width="64" height="20" rx="10" fill="var(--surface-card)" stroke="var(--border-subtle)" />
          ))}
          <circle cx="52" cy="102" r="3" fill="var(--coral-bright)" />
          <circle cx="128" cy="102" r="3" fill="var(--coral-bright)" />
          <circle cx="204" cy="102" r="3" fill="var(--coral-bright)" />
          {/* Play badge (hired.video résumé) */}
          <circle cx="278" cy="102" r="14" fill="var(--coral-bright)" />
          <path d="M274 96l8 6-8 6z" fill="#fff" />
        </svg>
      </div>
    );
  }
  return (
    <div style={wrap} aria-hidden>
      <svg viewBox="0 0 320 150" width="100%" role="presentation" style={{ display: 'block' }}>
        {/* Connectors hub → specialists */}
        {[[70, 40], [70, 110], [250, 40], [250, 110]].map(([x, y], i) => (
          <line key={i} x1="160" y1="75" x2={x} y2={y} stroke="var(--coral-bright)" strokeWidth="1.5" opacity="0.4" />
        ))}
        {/* Specialist nodes */}
        {[[70, 40, '🧠'], [70, 110, '🔁'], [250, 40, '🧪'], [250, 110, '▦']].map(([x, y, icon], i) => (
          <g key={i}>
            <circle cx={x as number} cy={y as number} r="20" fill="var(--bg-elevated)" stroke="var(--border-subtle)" />
            <text x={x as number} y={(y as number) + 6} textAnchor="middle" fontSize="16">{icon as string}</text>
          </g>
        ))}
        {/* Central hub (your agent) */}
        <circle cx="160" cy="75" r="30" fill="var(--coral-bright)" opacity="0.15" />
        <circle cx="160" cy="75" r="24" fill="var(--coral-bright)" />
        <text x="160" y="81" textAnchor="middle" fontSize="20">🚀</text>
      </svg>
    </div>
  );
}
