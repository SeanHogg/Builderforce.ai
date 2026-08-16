/**
 * One reference, as a card.
 *
 * Shared by the owner's list and the shared view, because an owner should be
 * looking at exactly what the employer will see. The two differ only in what the
 * SERVER sent — a shared view arrives with contact details already stripped when
 * the share withheld them — so the component branches on the data it has rather
 * than on a `readOnly` flag the caller would have to keep true.
 */
import type { ProfessionalReference, ReferenceStatus } from '@/lib/referencesApi';

const STATUS_COLOR: Record<ReferenceStatus, string> = {
  draft: 'var(--text-muted)',
  requested: 'var(--warning)',
  confirmed: 'var(--success)',
  declined: 'var(--error)',
};

export interface ReferenceCardProps {
  reference: ProfessionalReference;
  statusLabel: string;
  canSpeakToLabel: string;
  /** Rendered in the card's top-right — edit/remove for the owner, nothing for a viewer. */
  actions?: React.ReactNode;
}

export function ReferenceCard({ reference, statusLabel, canSpeakToLabel, actions }: ReferenceCardProps) {
  const contact = [reference.email, reference.phone].filter(Boolean);
  return (
    <article style={{
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-base)', padding: 16,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
            {reference.name}
          </h3>
          {(reference.title || reference.company) && (
            <p style={{ margin: '2px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              {[reference.title, reference.company].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <span style={{
          fontSize: 'var(--font-size-small)', fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: STATUS_COLOR[reference.status],
          border: `1px solid ${STATUS_COLOR[reference.status]}`,
          borderRadius: 'var(--radius-sm)', padding: '1px 7px', whiteSpace: 'nowrap',
        }}>
          {statusLabel}
        </span>
        {actions}
      </div>

      {reference.relationship && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
          {reference.relationship}
        </p>
      )}

      {reference.canSpeakTo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{
            fontSize: 'var(--font-size-small)', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            {canSpeakToLabel}
          </span>
          <p style={{ margin: 0, fontSize: 'var(--font-size-body)', color: 'var(--text-primary)' }}>
            {reference.canSpeakTo}
          </p>
        </div>
      )}

      {contact.length > 0 && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
          {contact.join(' · ')}
        </p>
      )}
    </article>
  );
}
