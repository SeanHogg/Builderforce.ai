/**
 * Shared field styling for the for-hire (talent) surfaces — the profile editor
 * page and the onboarding wizard steps render the SAME fields, so the styles
 * live here once instead of being re-declared per file. All colors come from
 * theme tokens, so every consumer works in light and dark.
 */

export const talentCard: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};

export const talentLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6,
};

export const talentInput: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '9px 12px', fontSize: 14, outline: 'none',
};

export const talentSoftBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', fontSize: 13, fontWeight: 600,
};

export const talentPrimaryBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', fontWeight: 700, fontSize: 14,
};
