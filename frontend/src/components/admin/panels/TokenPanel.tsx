'use client';

import { useState } from 'react';
import { getStoredWebToken } from '@/lib/auth';
import { AdminError, errText } from '../adminShared';

export default function TokenPanel() {
  const [error, setError] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [downloadedEnv, setDownloadedEnv] = useState(false);

  const webToken = getStoredWebToken();

  const copyToken = async () => {
    if (!webToken) {
      setError('No superadmin web token found for this session.');
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
      setError('No superadmin web token found for this session.');
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
      setError('No superadmin web token found for this session.');
      return;
    }
    try {
      const blob = new Blob([`${buildEnvTemplate()}\n`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'builderforce.superadmin.env';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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
        This web token grants superadmin API access for your current session. Share only with trusted tooling.
      </p>
      <div className="admin-token-actions">
        <button
          type="button"
          className="admin-tab"
          onClick={() => setShowToken(!showToken)}
        >
          {showToken ? 'Hide token' : 'Show token'}
        </button>
        <button
          type="button"
          className="admin-tab"
          onClick={copyToken}
          disabled={!webToken}
        >
          {copiedToken ? 'Copied!' : 'Copy token'}
        </button>
        <button
          type="button"
          className="admin-tab"
          onClick={copyEnvTemplate}
          disabled={!webToken}
        >
          {copiedEnv ? 'Env copied!' : 'Copy env template'}
        </button>
        <button
          type="button"
          className="admin-tab"
          onClick={downloadEnvTemplate}
          disabled={!webToken}
        >
          {downloadedEnv ? 'Downloaded!' : 'Download .env file'}
        </button>
      </div>
      {showToken ? (
        <textarea
          readOnly
          value={webToken || 'No superadmin web token found'}
          className="admin-token-textarea"
        />
      ) : (
        <div className="text-muted" style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>
          {webToken ? '••••••••••••••••••••••••••••' : 'No superadmin web token found'}
        </div>
      )}
    </div>
  );
}
