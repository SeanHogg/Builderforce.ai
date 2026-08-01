'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getStoredWebToken } from '@/lib/auth';
import { downloadText } from '@/lib/download';
import { AdminError, errText } from '../adminShared';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

export default function TokenPanel() {
  const t = useTranslations('admin');
  const [error, setError] = useState('');
  const [showToken, setShowToken] = useState(false);
  // Two independent buttons → two hook instances, so confirming one does not light
  // up the other. Both keep the previous 2000ms window (the hook's default).
  const tokenCopy = useCopyToClipboard();
  const envCopy = useCopyToClipboard();
  const [downloadedEnv, setDownloadedEnv] = useState(false);

  const webToken = getStoredWebToken();

  const copyToken = async () => {
    if (!webToken) {
      setError(t('token.noTokenSession'));
      return;
    }
    // The old catch surfaced the raw DOMException text; the shared write reports
    // failure as `false`, so the user now gets a localized message instead.
    if (!await tokenCopy.copy(webToken)) setError(t('common.copyFailed'));
  };

  const buildEnvTemplate = () => {
    const base = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai') : 'https://api.builderforce.ai';
    const apiUrl = base.replace(/\/+$/, '');
    return [
      `BUILDERFORCE_API_URL=${apiUrl}`,
      `BUILDERFORCE_WEB_TOKEN=${webToken ?? ''}`,
      'BUILDERFORCE_TENANT_TOKEN=',
      'BUILDERFORCE_TENANT_ID=',
    ].join('\n');
  };

  const copyEnvTemplate = async () => {
    if (!webToken) {
      setError(t('token.noTokenSession'));
      return;
    }
    // Thunk form: the template is built on click, not on every render.
    if (!await envCopy.copy(buildEnvTemplate)) setError(t('common.copyFailed'));
  };

  const downloadEnvTemplate = () => {
    if (!webToken) {
      setError(t('token.noTokenSession'));
      return;
    }
    try {
      downloadText(`${buildEnvTemplate()}\n`, 'builderforce.superadmin.env');
      setDownloadedEnv(true);
      setTimeout(() => setDownloadedEnv(false), 2000);
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <div className="admin-token-card">
      <AdminError message={error} />
      <p className="page-sub" style={{ marginBottom: 12 }}>
        {t('token.shareWarning')}
      </p>
      <div className="admin-token-actions">
        <button
          type="button"
          className="admin-tab"
          onClick={() => setShowToken(!showToken)}
        >
          {showToken ? t('token.hideToken') : t('token.showToken')}
        </button>
        <button
          type="button"
          className="admin-tab"
          onClick={copyToken}
          disabled={!webToken}
        >
          {tokenCopy.copied ? t('common.copied') : t('token.copyToken')}
        </button>
        <button
          type="button"
          className="admin-tab"
          onClick={copyEnvTemplate}
          disabled={!webToken}
        >
          {envCopy.copied ? t('token.envCopied') : t('token.copyEnvTemplate')}
        </button>
        <button
          type="button"
          className="admin-tab"
          onClick={downloadEnvTemplate}
          disabled={!webToken}
        >
          {downloadedEnv ? t('token.downloaded') : t('token.downloadEnvFile')}
        </button>
      </div>
      {showToken ? (
        <textarea
          readOnly
          value={webToken || t('token.noTokenFound')}
          className="admin-token-textarea"
        />
      ) : (
        <div className="text-muted" style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>
          {webToken ? '••••••••••••••••••••••••••••' : t('token.noTokenFound')}
        </div>
      )}
    </div>
  );
}
