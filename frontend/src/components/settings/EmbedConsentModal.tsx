'use client';

/**
 * Consent moment shown before a host first enables (or re-enables after a
 * consent-version bump) the embedded integration. Agreeing records the
 * acknowledged version server-side (`tenants.settings.embed.consentVersion`) so
 * the opt-in is auditable — same legal posture as the host-side embed consent.
 */

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
};

const dialog: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 12, padding: 24, maxWidth: 520, width: '100%',
};

const button: React.CSSProperties = {
  padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
};

interface Props {
  version: number;
  onAgree: () => void;
  onCancel: () => void;
}

export function EmbedConsentModal({ version, onAgree, onCancel }: Props) {
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="embed-consent-title">
      <div style={dialog}>
        <div id="embed-consent-title" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
          Enable embedded integration
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            Enabling this integration lets the host application (e.g. BurnRateOS) frame BuilderForce
            surfaces and pass a signed SSO token so each end-client&apos;s workspace resolves to its own
            isolated Segment. The host renders these surfaces inside a sandboxed iframe; the token is
            delivered over <code>postMessage</code> to the embed origin only and is never placed in a URL.
          </p>
          <p>
            By enabling, you confirm you are authorized to share these capability areas with the host
            and that end-client data surfaced through the embed remains governed by your existing data
            processing terms. You can disable embedding at any time from this page.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ ...button, background: 'none', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAgree}
            style={{ ...button, background: 'var(--accent, #2563eb)', color: '#fff', border: 'none' }}
          >
            I agree &amp; enable
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'right' }}>
          Consent version {version}
        </div>
      </div>
    </div>
  );
}
