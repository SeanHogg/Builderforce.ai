'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ConnectorConnectionManager } from '@/components/connectors/ConnectorsGallery';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { connectorsApi } from '@/lib/connectorsApi';
import { Icon } from '@/components/ui/Icon';
import styles from './TwilioCanvasSetup.module.css';

/**
 * Contextual access to the existing Twilio connection manager. Credentials,
 * tests, enable/disable, and removal still have one canonical implementation;
 * Canvas merely makes that implementation reachable at the moment it is needed.
 */
export function TwilioCanvasSetup({ active }: { active: boolean }) {
  const t = useTranslations('creationCanvas.twilioSetup');
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    if (!active) return;
    connectorsApi.listConnections('twilio')
      .then((connections) => setReady(connections.some((connection) => connection.enabled)))
      .catch(() => setReady(false));
  }, [active]);

  useEffect(() => { refresh(); }, [refresh]);
  if (!active) return null;

  return <>
    <button
      type="button"
      className={styles.trigger}
      data-ready={ready === true ? 'true' : ready === false ? 'false' : 'loading'}
      data-tour="twilio-integration"
      onClick={() => setOpen(true)}
    >
      <Icon source={ready ? '✓' : '⌘'} size={14} />
      {ready == null ? t('checking') : ready ? t('ready') : t('configure')}
    </button>
    <SlideOutPanel
      open={open}
      onClose={() => setOpen(false)}
      title={t('title')}
      crumb={t('crumb')}
      width="sheet"
      widthStorageKey="canvas-twilio-setup"
      zIndex={10010}
    >
      <section className={styles.guide} aria-label={t('guideTitle')}>
        <strong>{t('guideTitle')}</strong>
        <ol>
          <li>{t('stepCredentials')}</li>
          <li>{t('stepTest')}</li>
          <li>{t('stepReturn')}</li>
        </ol>
      </section>
      <p className={styles.status} data-ready={ready === true ? 'true' : 'false'}>
        {ready ? t('connectedStatus') : t('missingStatus')}
      </p>
      <ConnectorConnectionManager connectorKey="twilio" onChanged={refresh} />
      <section className={styles.embed} data-tour="twilio-website-embed">
        <strong>{t('embedTitle')}</strong>
        <p>{t('embedBody')}</p>
        <Link href="/embedded">{t('openEmbed')} →</Link>
      </section>
    </SlideOutPanel>
  </>;
}
