'use client';

/**
 * Bring-your-own MCP servers, as a settings section.
 *
 * The backend for this — three-legged OAuth with authorization-server discovery
 * and dynamic client registration, per-tool consent, AES-GCM secrets at rest, a
 * server-to-server relay so the credential never reaches a browser — has been
 * complete and mounted for some time with no caller. This is that caller: it is
 * the only way a workspace registers an external MCP server without hitting the
 * API by hand.
 *
 * Self-contained: it decides its own entitlement (owner-only, mirroring
 * `requireRole(OWNER)` on the routes), owns its data access through the typed
 * client, and takes only presentation-level props — so it drops onto a second
 * surface with no edits.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import type { McpExtension } from '@/lib/mcpExtensionsApi';
import { useMcpServers } from './useMcpServers';
import { McpServerCard } from './McpServerCard';
import { McpServerForm } from './McpServerForm';

/** Outcomes the OAuth callback appends to the return URL as `?mcp=`. */
const CALLBACK_OUTCOMES = ['connected', 'declined', 'error', 'invalid_state', 'no_pending_consent'] as const;
type CallbackOutcome = (typeof CALLBACK_OUTCOMES)[number];

const addButton: React.CSSProperties = {
  padding: '8px 14px', fontSize: 'var(--font-size-body)', fontWeight: 650, background: 'var(--coral-bright)',
  color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};

export interface McpServersGalleryProps {
  /** Free-text filter shared with the rest of the integrations page. */
  search?: string;
  viewMode?: 'card' | 'table';
  /** Where the consent screen returns to. Defaults to the settings page. */
  returnTo?: string;
}

export function McpServersGallery({ search = '', viewMode = 'card', returnTo = '/settings/integrations' }: McpServersGalleryProps) {
  const t = useTranslations('mcpServers');
  const confirm = useConfirm();
  const state = useMcpServers();
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<McpExtension | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CallbackOutcome | null>(null);

  // The consent screen returns here with `?mcp=<outcome>`; read it once and strip
  // it, so a reload does not re-announce a connection that already happened.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const value = url.searchParams.get('mcp');
    if (!value) return;
    if ((CALLBACK_OUTCOMES as readonly string[]).includes(value)) setOutcome(value as CallbackOutcome);
    url.searchParams.delete('mcp');
    window.history.replaceState({}, '', url.toString());
  }, []);

  const term = search.trim().toLowerCase();
  const visible = state.servers.filter((s) => !term || `${s.name} ${s.serverUrl} mcp tools`.toLowerCase().includes(term));
  // A search that matches nothing here belongs to another section of the page.
  if (term && visible.length === 0 && !state.loading) return null;

  const closePanel = () => { setPanelOpen(false); setEditing(null); };
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); } finally { setBusy(false); }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{t('sectionTitle')}</div>
          <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('sectionIntro')}</p>
        </div>
        <RoleGate capability="mcp.manage" variant="inline">
          <button type="button" style={addButton} onClick={() => { setEditing(null); setPanelOpen(true); }}>{t('actions.register')}</button>
        </RoleGate>
      </div>

      {outcome && (
        <p role="status" style={{ fontSize: 'var(--font-size-small)', margin: '0 0 12px', color: outcome === 'connected' ? 'var(--success)' : 'var(--warning)' }}>
          {t(`callback.${outcome}`)}
        </p>
      )}
      {state.error && <p role="alert" style={{ fontSize: 'var(--font-size-small)', color: 'var(--danger)', margin: '0 0 12px' }}>{state.error}</p>}

      {!state.allowed ? (
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('requiresRole', { role: state.requiredRole })}</p>
      ) : state.loading && state.servers.length === 0 ? (
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('loading')}</p>
      ) : visible.length === 0 ? (
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('empty')}</p>
      ) : (
        <div style={viewMode === 'card'
          ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }
          : { display: 'grid', gap: 8 }}>
          {visible.map((server) => (
            <McpServerCard
              key={server.id}
              server={server}
              busy={busy}
              layout={viewMode}
              onEdit={(s) => { setEditing(s); setPanelOpen(true); }}
              onToggleEnabled={(s) => void run(() => state.update(s.id, { enabled: !s.enabled }))}
              onConnect={(s) => void run(async () => {
                const authUrl = await state.connectUrl(s.id, returnTo);
                if (authUrl) window.location.href = authUrl;
              })}
              onDisconnect={(s) => void run(async () => {
                if (!(await confirm({ message: t('confirmDisconnect', { name: s.name }), destructive: true }))) return;
                await state.disconnect(s.id);
              })}
              onRemove={(s) => void run(async () => {
                if (!(await confirm({ message: t('confirmRemove', { name: s.name }), destructive: true }))) return;
                await state.remove(s.id);
              })}
            />
          ))}
        </div>
      )}

      <SlideOutPanel
        open={panelOpen}
        onClose={closePanel}
        title={editing ? t('panel.editTitle') : t('panel.registerTitle')}
        crumb={t('sectionTitle')}
        widthStorageKey="mcp-server-detail"
      >
        <McpServerForm
          key={editing?.id ?? 'new'}
          server={editing}
          busy={busy}
          error={state.error}
          onCancel={closePanel}
          onSubmitCreate={(input) => void run(async () => {
            const created = await state.create(input);
            if (created) closePanel();
          })}
          onSubmitUpdate={(id, input) => void run(async () => {
            const saved = await state.update(id, input);
            if (saved) closePanel();
          })}
        />
      </SlideOutPanel>
    </div>
  );
}
