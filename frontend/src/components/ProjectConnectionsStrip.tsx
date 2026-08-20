'use client';

import { useTranslations } from 'next-intl';
import type {
  ProjectBuildStatus,
  ProjectConnection,
  ProjectConnectionHealth,
  ProjectConnectionReason,
} from '@/lib/projectConnections';
import { useFormat } from "@/i18n/useFormat";

/**
 * ProjectConnectionsStrip — the SINGLE surface for "what is this project wired
 * to, and is that wiring healthy": the connected repo(s) and external board(s),
 * each with a live health dot, the latest build verdict, and the open-PR count.
 *
 * Shared by the project card and the project list row so the chips, colours and
 * wording can't drift between them. Decides its own visibility: a project with
 * nothing connected renders nothing, so callers never gate on a `hasX` boolean.
 *
 * Every colour is a theme token (light + dark) and the row wraps, so a card at
 * 360px shows the same information stacked rather than overflowing.
 */
export interface ProjectConnectionsStripProps {
  connections: ProjectConnection[] | undefined;
  /** Open the project's Integrations tab — used by chips that have no external
   *  link of their own (boards), and as the "fix this" affordance on a broken
   *  connection. Omit to render those chips as plain text. */
  onManage?: () => void;
  /** Cap the rendered connections; the remainder collapses into a "+N" pill. */
  max?: number;
}

type Tone = 'good' | 'bad' | 'warn' | 'info' | 'muted';

/** Tone → theme tokens. Border uses the solid token, background the translucent
 *  one, so each tone reads correctly in BOTH themes without a hardcoded hex. */
const TONE: Record<Tone, { fg: string; bg: string; border: string }> = {
  good: { fg: 'var(--success)', bg: 'var(--success-bg)', border: 'var(--success)' },
  bad: { fg: 'var(--error)', bg: 'var(--error-bg)', border: 'var(--error-border)' },
  warn: { fg: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
  info: { fg: 'var(--info)', bg: 'var(--info-bg)', border: 'var(--info-border)' },
  muted: { fg: 'var(--text-muted)', bg: 'var(--bg-base)', border: 'var(--border-subtle)' },
};

const HEALTH_TONE: Record<ProjectConnectionHealth, Tone> = {
  ok: 'good',
  degraded: 'warn',
  error: 'bad',
  unknown: 'muted',
};

const BUILD_TONE: Record<Exclude<ProjectBuildStatus, null>, Tone> = {
  success: 'good',
  failure: 'bad',
  pending: 'info',
  cancelled: 'muted',
};

/** Provider-neutral glyphs: one per connection kind, so a new provider needs no
 *  new artwork. The provider name itself rides in the chip's tooltip. */
function KindIcon({ kind }: { kind: ProjectConnection['kind'] }) {
  const common = { width: 12, height: 12, viewBox: '0 0 24 24', stroke: 'currentColor', fill: 'none', strokeWidth: 2.2 } as const;
  return kind === 'source_control' ? (
    <svg {...common} aria-hidden style={{ flexShrink: 0 }}>
      <circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7M8.5 6.6C12 6 15.5 6.6 15.5 10c0 3-3 3.5-6 4" />
    </svg>
  ) : (
    <svg {...common} aria-hidden style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="10" rx="1" />
      <rect x="17" y="4" width="4" height="13" rx="1" />
    </svg>
  );
}

/** Provider-correct pull-request listing URL for a repo's web page. */
function pullsUrl(url: string | null, provider: string): string | null {
  if (!url) return null;
  return `${url}/${provider === 'bitbucket' ? 'pull-requests' : provider === 'gitlab' ? '-/merge_requests' : 'pulls'}`;
}

const chipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 11,
  lineHeight: 1.2,
  borderRadius: 'var(--radius-full)',
  padding: '4px 9px',
  maxWidth: '100%',
  textDecoration: 'none',
  background: 'transparent',
};

/** One chip, rendered as an external link, a button, or plain text depending on
 *  what the caller can actually offer — the three variants share one style. */
function Chip({
  tone, href, onClick, title, ariaLabel, children,
}: {
  tone: Tone;
  href?: string | null;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const t = TONE[tone];
  const style: React.CSSProperties = {
    ...chipBase,
    color: t.fg,
    background: t.bg,
    border: `1px solid ${t.border}`,
  };
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={stop} title={title} aria-label={ariaLabel} style={style}>
        {children}
      </a>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        title={title}
        aria-label={ariaLabel}
        style={{ ...style, cursor: 'pointer' }}
      >
        {children}
      </button>
    );
  }
  return <span title={title} aria-label={ariaLabel} style={style}>{children}</span>;
}

export function ProjectConnectionsStrip({ connections, onManage, max = 3 }: ProjectConnectionsStripProps) {
  const fmt = useFormat();
  const t = useTranslations('projectConnections');
  if (!connections || connections.length === 0) return null;

  const shown = connections.slice(0, max);
  const overflow = connections.length - shown.length;

  const healthText = (health: ProjectConnectionHealth, reason: ProjectConnectionReason): string =>
    reason ? t(`reason.${reason}`) : t(`health.${health}`);

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
      aria-label={t('title')}
    >
      {shown.map((c) => {
        const tone = HEALTH_TONE[c.health];
        const status = healthText(c.health, c.reason);
        const syncedTitle = c.lastSyncedAt ? ` · ${t('lastSynced', { date: fmt.dateTime(c.lastSyncedAt) })}` : '';
        const prs = c.openPullRequests;
        const prHref = pullsUrl(c.url, c.provider);
        return (
          <span key={`${c.kind}:${c.provider}:${c.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', maxWidth: '100%' }}>
            {/* The connection itself: provider + target + health. */}
            <Chip
              tone={tone}
              href={c.url}
              onClick={c.url ? undefined : onManage}
              title={`${c.provider} · ${c.label} — ${status}${c.isDefault ? ` · ${t('defaultRepo')}` : ''}${syncedTitle}`}
              ariaLabel={t('connectionAria', { provider: c.provider, label: c.label, status })}
            >
              <KindIcon kind={c.kind} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                {c.label}
              </span>
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: 'var(--radius-full)', background: TONE[tone].fg, flexShrink: 0 }}
              />
            </Chip>

            {/* Latest CI verdict on the connected repo's default branch. */}
            {c.buildStatus && (
              <Chip
                tone={BUILD_TONE[c.buildStatus]}
                href={c.buildUrl}
                title={`${t('buildTitle', {
                  status: t(`build.${c.buildStatus}`),
                  branch: c.buildBranch ?? '—',
                  date: c.buildAt ? fmt.dateTime(c.buildAt) : '—',
                })}${
                  // The verdict comes from a scheduled sweep, not from this page load.
                  // Naming when it was read is what stops a stale green reading as live.
                  c.buildProbedAt ? ` · ${t('buildChecked', { date: fmt.dateTime(c.buildProbedAt) })}` : ''
                }`}
                ariaLabel={t('buildAria', { status: t(`build.${c.buildStatus}`), branch: c.buildBranch ?? '—' })}
              >
                <span aria-hidden style={{ fontWeight: 700 }}>
                  {c.buildStatus === 'success' ? '✓' : c.buildStatus === 'failure' ? '✕' : c.buildStatus === 'pending' ? '◐' : '⊘'}
                </span>
                <span>{t(`build.${c.buildStatus}`)}</span>
              </Chip>
            )}

            {/* Open pull/merge requests. */}
            {prs != null && prs > 0 && (
              <Chip
                tone="info"
                href={prHref}
                title={c.openPullRequestsRecordedOnly ? t('openPrsRecordedTitle', { count: prs }) : t('openPrsTitle', { count: prs })}
                ariaLabel={t('openPrs', { count: prs })}
              >
                <span aria-hidden>⑂</span>
                <span>{t('openPrs', { count: prs })}</span>
              </Chip>
            )}
          </span>
        );
      })}
      {overflow > 0 && (
        <Chip tone="muted" onClick={onManage} title={t('moreTitle', { count: overflow })}>
          {t('more', { count: overflow })}
        </Chip>
      )}
    </div>
  );
}
