'use client';

/**
 * ONE share sheet with ONE revocation path (PRD 20 §7.1).
 *
 * `share_links` absorbs 24 tables. The line in §7.1 is worth keeping in view
 * while reading this file: *there are three API-key revocation paths in this
 * repo alone today*. Three paths means three places a revoked token can keep
 * working because somebody fixed the other two. This component and
 * `revokeObjectShare` are the single path that replaces them.
 *
 * THE TOKEN IS SHOWN EXACTLY ONCE. The server stores only its SHA-256 hash, so
 * there is no "show again" — the UI has to say so plainly rather than let
 * somebody close the panel expecting to come back for it.
 *
 * DECIDES ITS OWN VISIBILITY: no object, no render.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  createObjectShare,
  getObjectShares,
  revokeObjectShare,
  type ShareLink,
} from '@/lib/kernel/kernelApi';
import { useFormat } from "@/i18n/useFormat";

const SCOPES: ShareLink['scope'][] = ['view', 'comment', 'edit'];

export function ObjectShareSheet({
  objectId,
  locale = 'en',
}: {
  objectId?: string;
  locale?: string;
}) {
  const fmt = useFormat();
  const t = useTranslations('kernel.share');
  const [rows, setRows] = useState<ShareLink[] | null>(null);
  const [scope, setScope] = useState<ShareLink['scope']>('view');
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!objectId) return;
    try {
      setRows(await getObjectShares(objectId));
    } catch {
      setRows([]);
    }
  }, [objectId]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!objectId || busy) return;
    setBusy(true);
    try {
      const { token } = await createObjectShare(objectId, { scope });
      setIssued(token);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (shareId: string) => {
    if (!objectId) return;
    await revokeObjectShare(objectId, shareId);
    await load();
  };

  if (!objectId) return null;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="kernel-share-scope" className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('scopeLabel')}
        </label>
        <select
          id="kernel-share-scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as ShareLink['scope'])}
          className="rounded-md px-2 py-1.5 text-sm"
          style={{
            // A native <option> does not inherit the control's background in
            // every browser, so both the select AND its options carry an opaque
            // pair — otherwise the list reads as white-on-white in one theme.
            background: 'var(--surface)',
            color: 'var(--text-primary, var(--text-primary))',
            border: '1px solid var(--border-subtle, rgba(136,146,176,0.25))',
          }}
        >
          {SCOPES.map((s) => (
            <option
              key={s}
              value={s}
              style={{ background: 'var(--surface)', color: 'var(--text-primary, var(--text-primary))' }}
            >
              {t(`scope.${s}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
        >
          {busy ? t('creating') : t('create')}
        </button>
      </div>

      {issued ? (
        <div
          className="rounded-md p-3 flex flex-col gap-2"
          style={{
            background: 'var(--warning-bg, rgba(217,119,6,0.14))',
            border: '1px solid var(--warning-border, rgba(217,119,6,0.4))',
          }}
        >
          <p className="text-xs m-0" style={{ color: 'var(--warning-text, var(--text-primary))' }}>
            {t('shownOnce')}
          </p>
          <code
            className="text-xs break-all rounded px-2 py-1.5"
            style={{ background: 'var(--surface-2, rgba(255,255,255,0.08))', color: 'var(--text-primary)' }}
          >
            {issued}
          </code>
        </div>
      ) : null}

      {rows === null ? (
        <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-0 m-0 p-0 list-none">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-2 py-2"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <span
                className="text-[0.65rem] uppercase tracking-wider rounded px-1.5 py-0.5"
                style={{ background: 'var(--surface-2, rgba(255,255,255,0.08))', color: 'var(--text-secondary)' }}
              >
                {t(`scope.${row.scope}`)}
              </span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {t('uses', { count: row.useCount })}
                {row.expiresAt ? ` · ${t('expires', { date: fmt.date(row.expiresAt) })}` : ''}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => void revoke(row.id)}
                className="rounded-md px-2 py-1 text-xs font-medium"
                style={{
                  background: 'transparent',
                  color: 'var(--danger-text, var(--error-text))',
                  border: '1px solid var(--danger-border, var(--error-border))',
                }}
              >
                {t('revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
