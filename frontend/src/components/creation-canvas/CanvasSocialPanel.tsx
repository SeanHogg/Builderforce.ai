/**
 * The workspace's social accounts, managed on the canvas.
 *
 * Three jobs, in the order a CMO actually does them: CONNECT the accounts, PUT THE
 * FEED on the board, and PUBLISH — either one post to one account, or one
 * announcement to every account as a campaign.
 *
 * Connecting reuses the CONNECTOR platform rather than introducing a second one: a
 * social account IS a connector connection, so this form is the built-in manifest's
 * own auth fields rendered inline (`connectorsApi.get` → `authFieldsFor`). That is why
 * a network's "Page ID" or "Author URN" box appears here without this component
 * knowing anything about Facebook or LinkedIn — and why a sixth network needs no
 * change to this file.
 *
 * The canvas OWNS the objects, so adding a feed or a campaign to the board is a
 * callback rather than something built here — the same helpers the `canvas_*` tools
 * call, so a tile the agent adds and a tile the person adds are the same tile.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import {
  socialApi,
  type SocialAccount,
  type SocialCampaign,
  type SocialFeedFilter,
  type SocialNetworkOption,
} from '@/lib/socialApi';
import { authFieldsFor, connectorsApi, type ConnectorAuthField } from '@/lib/connectorsApi';
import { resolvePublicMediaUrls } from '@/lib/canvasPublicMedia';
import { NETWORK_GLYPHS } from '@/lib/networkGlyph';
import { PanelTabs } from './PanelTabs';

export interface CanvasSocialPanelProps {
  /** Put a live feed tile on the board. Same helper the canvas tools use. */
  onAddFeed: (filter: SocialFeedFilter) => Promise<void> | void;
  /** Put a campaign tile on the board once it has been drafted. */
  onAddCampaign: (campaign: SocialCampaign) => void;
  /**
   * The pictures already on this board, offered as attachments.
   *
   * Passed in rather than read here because the panel does not own the canvas —
   * the same reason `onAddFeed` is a callback. What it fixes is a URL box: the
   * board's own generated image lives in a `data:` URI, so composing "post this
   * picture" meant hosting it somewhere else first and pasting the result back.
   */
  boardMedia: ReadonlyArray<{ id: string; title: string; source: string; thumbnailUrl: string | null }>;
  onClose: () => void;
}

type Mode = 'accounts' | 'compose';

export function CanvasSocialPanel({ onAddFeed, onAddCampaign, boardMedia, onClose }: CanvasSocialPanelProps) {
  const t = useTranslations('creationCanvas.social');
  const [mode, setMode] = useState<Mode>('accounts');
  const [networks, setNetworks] = useState<SocialNetworkOption[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Connect form
  const [connecting, setConnecting] = useState<SocialNetworkOption | null>(null);
  const [fields, setFields] = useState<ConnectorAuthField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [connectionName, setConnectionName] = useState('');

  // Compose form
  const [text, setText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  /** Board objects whose picture rides along. Ids, not URLs — the URL is minted
   *  at publish time by the shared resolver, so it is never stale in this form. */
  const [mediaObjectIds, setMediaObjectIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [networkList, accountList] = await Promise.all([
        socialApi.networks().catch(() => ({ networks: [] as SocialNetworkOption[] })),
        socialApi.accounts().catch(() => ({ accounts: [] as SocialAccount[] })),
      ]);
      setNetworks(networkList.networks);
      setAccounts(accountList.accounts);
      // Selecting every ready account by default is the common intent — "post it
      // everywhere" — and unticking is cheaper than ticking five boxes.
      setSelected(accountList.accounts.filter((a) => a.ready).map((a) => a.id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const ready = useMemo(() => accounts.filter((a) => a.ready), [accounts]);

  const beginConnect = useCallback(async (option: SocialNetworkOption) => {
    setConnecting(option);
    setError(null);
    setValues({});
    setConnectionName(option.label);
    try {
      const detail = await connectorsApi.get(option.connectorKey);
      setFields(authFieldsFor(detail.manifest));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('loadFailed'));
      setFields([]);
    }
  }, [t]);

  const submitConnect = useCallback(async () => {
    if (!connecting) return;
    setBusy(true);
    setError(null);
    try {
      await connectorsApi.createConnection({
        connectorKey: connecting.connectorKey,
        name: connectionName.trim() || connecting.label,
        credentials: values,
      });
      setConnecting(null);
      setNotice(t('connected', { network: connecting.label }));
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('connectFailed'));
    } finally {
      setBusy(false);
    }
  }, [connecting, connectionName, load, t, values]);

  const disconnect = useCallback(async (account: SocialAccount) => {
    setBusy(true);
    setError(null);
    try {
      await connectorsApi.removeConnection(account.id);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('disconnectFailed'));
    } finally {
      setBusy(false);
    }
  }, [load, t]);

  const addFeed = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onAddFeed({});
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('feedFailed'));
    } finally {
      setBusy(false);
    }
  }, [onAddFeed, onClose, t]);

  /**
   * One account and no schedule publishes IMMEDIATELY; anything else becomes a
   * campaign. The split is not a preference — a campaign is what carries the
   * per-account ledger and the idempotency that makes "post it everywhere" safe to
   * retry, and it is overkill for a single tweet.
   */
  const publish = useCallback(async () => {
    const copy = text.trim();
    if (!copy) { setError(t('needsText')); return; }
    if (selected.length === 0) { setError(t('needsAccount')); return; }
    setBusy(true);
    setError(null);
    try {
      // The SAME resolver `canvas_create_social_campaign` uses, so a post a person
      // composes and one a model drafts attach the identical URL. A picked board
      // object contributes its own source; the URL box still works for something
      // already hosted elsewhere.
      const resolved = await resolvePublicMediaUrls([
        ...mediaObjectIds.map((id) => boardMedia.find((item) => item.id === id)?.source ?? ''),
        ...(mediaUrl.trim() ? [mediaUrl.trim()] : []),
      ], { name: copy.slice(0, 60) });
      if (resolved.problems.length && resolved.urls.length === 0) {
        setError(resolved.problems[0]!.reason);
        return;
      }
      if (resolved.problems.length) setNotice(resolved.problems[0]!.reason);
      const media = resolved.urls;
      if (selected.length === 1 && !scheduledAt) {
        const result = await socialApi.publish({
          text: copy,
          connectionId: selected[0]!,
          ...(linkUrl.trim() ? { linkUrl: linkUrl.trim() } : {}),
          ...(media.length ? { mediaUrls: media } : {}),
        });
        setNotice(result.pending ? t('publishPending') : t('published'));
      } else {
        const { campaign } = await socialApi.createCampaign({
          name: copy.slice(0, 60),
          body: copy,
          connectionIds: selected,
          ...(linkUrl.trim() ? { linkUrl: linkUrl.trim() } : {}),
          ...(media.length ? { mediaUrls: media } : {}),
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        });
        onAddCampaign(campaign);
        if (!scheduledAt) {
          const batch = await socialApi.publishCampaign(campaign.id);
          if (batch.campaign) onAddCampaign(batch.campaign);
          setNotice(t('campaignPublished', { published: batch.published, targets: campaign.targets }));
        } else {
          setNotice(t('campaignScheduled', { count: campaign.targets }));
        }
      }
      setText('');
      setLinkUrl('');
      setMediaUrl('');
      setMediaObjectIds([]);
      setScheduledAt('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('publishFailed'));
    } finally {
      setBusy(false);
    }
  }, [boardMedia, linkUrl, mediaObjectIds, mediaUrl, onAddCampaign, scheduledAt, selected, t, text]);

  const toggleAccount = useCallback((id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }, []);

  const toggleMedia = useCallback((id: string) => {
    setMediaObjectIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }, []);

  /** Networks that still need media are named up front — Instagram silently
   *  refusing a text post at publish time is the failure this prevents. */
  const mediaBlocked = useMemo(
    () => accounts.filter((a) => selected.includes(a.id) && a.publishMode === 'media' && !mediaUrl.trim() && mediaObjectIds.length === 0),
    [accounts, mediaObjectIds, mediaUrl, selected],
  );

  /** Selected accounts that can never be published to at all. Distinct from
   *  `mediaBlocked`, which attaching an image fixes — this one nothing fixes. */
  const publishBlocked = useMemo(
    () => accounts.filter((a) => selected.includes(a.id) && a.publishMode === 'none'),
    [accounts, selected],
  );

  return (
    <aside className={styles.drivePanel} aria-label={t('title')}>
      <header>
        <strong>{t('title')}</strong>
        <button type="button" aria-label={t('close')} title={t('close')} onClick={onClose}>×</button>
      </header>

      <PanelTabs<Mode>
        label={t('title')}
        value={mode}
        onChange={setMode}
        tabs={[
          { id: 'accounts', label: t('tabAccounts') },
          { id: 'compose', label: t('tabCompose') },
        ]}
      />

      {error && <p className={styles.driveNotice} role="alert">{error}</p>}
      {notice && <p className={styles.driveNotice} role="status">{notice}</p>}

      {mode === 'accounts' && <>
        <div className={styles.driveList} role="list">
          {loading && <p className={styles.driveEmpty}>{t('loading')}</p>}
          {!loading && accounts.length === 0 && <p className={styles.driveEmpty}>{t('noAccounts')}</p>}
          {accounts.map((account) => <div key={account.id} className={styles.socialAccountRow} role="listitem">
            <span className={styles.driveRowMain}>
              <span aria-hidden>{NETWORK_GLYPHS[account.network]}</span>
              <span className={styles.driveRowName}>{`${account.networkLabel} · ${account.name}`}</span>
              <small>{account.ready
                ? t('ready')
                : t('missing', { fields: account.missingFields.map((f) => f.label).join(', ') })}</small>
            </span>
            <button type="button" disabled={busy} onClick={() => void disconnect(account)}>{t('disconnect')}</button>
          </div>)}
        </div>

        {!connecting && <div className={styles.driveConnect}>
          {networks.map((option) => <button key={option.network} type="button" disabled={busy} onClick={() => void beginConnect(option)}>
            {t('connect', { network: option.label })}
          </button>)}
        </div>}

        {connecting && <form
          className={styles.socialForm}
          onSubmit={(event) => { event.preventDefault(); void submitConnect(); }}
        >
          <label>
            <span>{t('connectionName')}</span>
            <input value={connectionName} onChange={(event) => setConnectionName(event.target.value)} required />
          </label>
          {fields.map((field) => <label key={field.key}>
            <span>{field.label}{field.required ? ' *' : ''}</span>
            <input
              type={field.secret ? 'password' : 'text'}
              value={values[field.key] ?? ''}
              placeholder={field.placeholder ?? ''}
              required={field.required}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
            {field.help && <small>{field.help}</small>}
          </label>)}
          <div className={styles.socialFormActions}>
            <button type="submit" disabled={busy}>{busy ? t('connecting') : t('saveConnection')}</button>
            <button type="button" disabled={busy} onClick={() => setConnecting(null)}>{t('cancel')}</button>
          </div>
        </form>}

        <button type="button" className={styles.driveMore} disabled={busy || ready.length === 0} onClick={() => void addFeed()}>
          {t('addFeed')}
        </button>
      </>}

      {mode === 'compose' && <form
        className={styles.socialForm}
        onSubmit={(event) => { event.preventDefault(); void publish(); }}
      >
        <label>
          <span>{t('copy')}</span>
          <textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} placeholder={t('copyPlaceholder')} />
        </label>
        <label>
          <span>{t('link')}</span>
          <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://" />
        </label>
        {boardMedia.length > 0 && <fieldset className={styles.socialTargetPicker}>
          <legend>{t('boardMedia')}</legend>
          {boardMedia.map((item) => <label key={item.id}>
            <input type="checkbox" checked={mediaObjectIds.includes(item.id)} onChange={() => toggleMedia(item.id)} />
            {/* The thumbnail is the point of a picker — a list of titles is a list
                of guesses about which picture is which. `alt` is empty because the
                label beside it already names the object; announcing it twice is
                noise to a screen reader. */}
            {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className={styles.socialMediaThumb} />}
            <span>{item.title}</span>
          </label>)}
          <small>{t('boardMediaHelp')}</small>
        </fieldset>}
        <label>
          <span>{t('media')}</span>
          <input value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://" />
          <small>{t('mediaHelp')}</small>
        </label>
        <label>
          <span>{t('schedule')}</span>
          <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
        </label>
        <fieldset className={styles.socialTargetPicker}>
          <legend>{t('targets')}</legend>
          {ready.length === 0 && <p className={styles.driveEmpty}>{t('noReadyAccounts')}</p>}
          {ready.map((account) => <label key={account.id}>
            <input type="checkbox" checked={selected.includes(account.id)} onChange={() => toggleAccount(account.id)} />
            <span>{`${NETWORK_GLYPHS[account.network]} ${account.networkLabel} · ${account.name}`}</span>
          </label>)}
        </fieldset>
        {mediaBlocked.length > 0 && <p className={styles.driveNotice} role="status">
          {t('mediaRequired', { networks: mediaBlocked.map((a) => a.networkLabel).join(', ') })}
        </p>}
        {publishBlocked.length > 0 && <p className={styles.driveNotice} role="status">
          {t('cannotPublish', { networks: publishBlocked.map((a) => a.networkLabel).join(', ') })}
        </p>}
        <div className={styles.socialFormActions}>
          <button type="submit" disabled={busy || ready.length === 0 || publishBlocked.length > 0}>
            {busy ? t('publishing') : scheduledAt ? t('scheduleAction') : selected.length > 1 ? t('publishAll', { count: selected.length }) : t('publishAction')}
          </button>
        </div>
      </form>}
    </aside>
  );
}
