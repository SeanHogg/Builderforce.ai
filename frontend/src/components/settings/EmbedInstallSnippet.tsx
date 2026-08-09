'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  EMBED_VIEWS,
  EMBED_VIEW_KEYS,
  capabilityForView,
  type EmbedCapability,
  type EmbedView,
} from '@seanhogg/builderforce-embedded';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

/**
 * Copy-paste install block for a host developer wiring BuilderForce into their
 * app. Derives the list of mountable views from the enabled capabilities (DRY —
 * the view↔capability mapping is the package's single source of truth), so this
 * never drifts from what the host is actually entitled to surface.
 *
 * This is the "snippet" a host obtains: install the package, then render
 * <BuilderForceEmbed view=… token={sso} /> per thin-shell page.
 */

const EMBED_ORIGIN = 'https://app.builderforce.ai';

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 12, marginBottom: 4,
};

const codeBox: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 12, padding: '10px 12px',
  background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  whiteSpace: 'pre-wrap', margin: 0, overflowX: 'auto',
};

const button: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600,
  background: 'var(--surface-interactive)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};

const INSTALL_CMD = 'npm install @seanhogg/builderforce-embedded';

/** A representative starter view per capability for the usage example. */
const SAMPLE_VIEW: Record<EmbedCapability, EmbedView> = {
  product: 'ideas',
  agile: 'kanban',
  security: 'soc2',
};

interface Props {
  capabilities: EmbedCapability[];
}

export function EmbedInstallSnippet({ capabilities }: Props) {
  const t = useTranslations('embedInstall');
  // Two independent buttons → two hook instances, so confirming one does not light up
  // the other; both keep the previous 1500ms window. The old single `.then()` had no
  // rejection handler, so a refused clipboard (insecure context / permission policy)
  // raised an unhandled rejection instead of just leaving the label alone — the shared
  // write reports failure as a value, which is why that path is gone.
  const installCopy = useCopyToClipboard(1500);
  const usageCopy = useCopyToClipboard(1500);

  // Views the host may mount, filtered to the enabled capabilities only.
  const enabledViews = useMemo(
    () => EMBED_VIEW_KEYS.filter((v) => capabilities.includes(capabilityForView(v))),
    [capabilities],
  );

  const sampleView = useMemo<EmbedView>(() => {
    const firstCap = capabilities[0];
    return firstCap ? SAMPLE_VIEW[firstCap] : 'kanban';
  }, [capabilities]);

  const usage = `import { BuilderForceEmbed } from '@seanhogg/builderforce-embedded';

// One thin-shell page per surface — parameterized by \`view\`.
export default function ProductPage() {
  return (
    <BuilderForceEmbed
      view="${sampleView}"
      token={getSsoToken}            // () => string | Promise<string> — your signed SSO/tenant JWT
      baseUrl="${EMBED_ORIGIN}"
      accountId={currentAccountId}   // federated segment coordinates (segmented tenants)
      companyId={currentCompanyId}
    />
  );
}`;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        {t('heading')}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {t.rich('intro', { code: (chunks) => <code>{chunks}</code> })}
      </div>

      <div style={labelStyle}>{t('stepInstall')}</div>
      <pre style={codeBox}>{INSTALL_CMD}</pre>

      <div style={labelStyle}>{t('stepMount')}</div>
      <pre style={codeBox}>{usage}</pre>

      <div style={labelStyle}>{t('mountableViews', { count: enabledViews.length })}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {enabledViews.map((v) => (
          <span
            key={v}
            title={EMBED_VIEWS[v].label}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, padding: '2px 8px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
            }}
          >
            {v}
          </span>
        ))}
        {enabledViews.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('noCapabilities')}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void installCopy.copy(INSTALL_CMD)} style={button}>
          {installCopy.copied ? t('copiedFlash') : t('copyInstall')}
        </button>
        <button type="button" onClick={() => void usageCopy.copy(usage)} style={button}>
          {usageCopy.copied ? t('copiedFlash') : t('copySnippet')}
        </button>
      </div>
    </div>
  );
}
