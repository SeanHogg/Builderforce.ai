'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getStoredWebToken } from '@/lib/auth';
import { downloadText } from '@/lib/download';
import { AdminError, errText } from '../adminShared';

export default function TokenPanel() {
  const t = useTranslations('admin');
  const [error, setError] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [downloadedEnv, setDownloadedEnv] = useState(false);

  const webToken = getStoredWebToken();

  const copyToken = async () => {
    if (!webToken) {
      setError(t('token.noTokenSession'));
      return;
    }
    try {
      await navigator.clipboard.writeText(webToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } catch (err) {
      setError(errText(err));
    }
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
    try {
      await navigator.clipboard.writeText(buildEnvTemplate());
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 2000);
    } catch (err) {
      setError(errText(err));
    }
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
          {copiedToken ? t('common.copied') : t('token.copyToken')}
        </button>
        <button
          type="button"
          className="admin-tab"
          onClick={copyEnvTemplate}
          disabled={!webToken}
        >
          {copiedEnv ? t('token.envCopied') : t('token.copyEnvTemplate')}
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
