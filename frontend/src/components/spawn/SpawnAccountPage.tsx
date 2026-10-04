'use client';

import { useTranslations } from 'next-intl';
import { useSignInDialog } from '@/components/auth/signIn/SignInDialogProvider';
import { WorkspacePicker } from '@/components/auth/WorkspacePicker';
import { useWorkspaceSession } from '@/lib/auth/useWorkspaceSession';
import { useSpawnAccount } from './useSpawnAccount';
import { SpawnAgeGate } from './SpawnAgeGate';
import { SpawnMembershipPanel } from './SpawnMembershipPanel';
import { SpawnTokensPanel } from './SpawnTokensPanel';
import { SpawnDesktopPanel } from './SpawnDesktopPanel';
import styles from './spawn.module.css';

/**
 * The Spawn account, as the steps a new player walks in order: sign in → (pick a
 * workspace) → say your age → join → get tokens → get the app. Each panel shows
 * only once the step before it is done, so the page is always "the next thing".
 */
export function SpawnAccountPage() {
  const t = useTranslations('spawn.account');
  const { requestSignIn } = useSignInDialog();
  const workspace = useWorkspaceSession();
  const ready = workspace.status === 'ready';
  const { account, errorKey, notice, busy, confirmAge, join, buy } = useSpawnAccount(ready);

  return (
    <main className={styles.account}>
      <div className={styles.sectionHead}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h1 className={styles.h2}>{t('title')}</h1>
      </div>

      {notice && <p className={styles.notice} role="status">{t(`notice.${notice}`)}</p>}
      {errorKey && <p className={styles.error} role="alert">{t(`errors.${errorKey}`)}</p>}

      {workspace.status === 'signedOut' && (
        <section className={styles.panel}>
          <p className={styles.cardBody}>{t('signInBody')}</p>
          <div className={styles.ctaRow}>
            <button type="button" className={styles.cta} onClick={requestSignIn}>{t('signIn')}</button>
          </div>
        </section>
      )}
      <WorkspacePicker state={workspace} onChoose={(tenant) => { void workspace.choose(tenant); }} />

      {ready && !account && !errorKey && <p className={styles.fine}>{t('loading')}</p>}

      {account && account.age === 'too_young' && (
        <section className={styles.panel}>
          <h2 className={styles.cardTitle}>{t('tooYoungTitle')}</h2>
          <p className={styles.cardBody}>{t('tooYoungBody', { age: account.minAge })}</p>
        </section>
      )}
      {account && account.age === 'unknown' && (
        <SpawnAgeGate minAge={account.minAge} busy={busy === 'age'} onConfirm={confirmAge} />
      )}
      {account && account.age === 'ok' && (
        <>
          <SpawnMembershipPanel status={account.membership} monthlyCents={account.monthlyCents} busy={busy === 'join'} onJoin={join} />
          <SpawnTokensPanel account={account} busyPackId={busy} onBuy={buy} />
          <SpawnDesktopPanel ready={account.canBuild} />
        </>
      )}
    </main>
  );
}
