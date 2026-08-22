'use client';

import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { PhoneBalanceCard } from './PhoneBalanceCard';
import { TopUpPanel } from './TopUpPanel';
import { PhoneNumbersCard } from './PhoneNumbersCard';
import { NumberSearchPanel } from './NumberSearchPanel';
import { SmsComposer } from './SmsComposer';
import { SmsLogList } from './SmsLogList';
import { CallLogList } from './CallLogList';
import { CommsStatementList } from './CommsStatementList';
import { PhoneRatesCard } from './PhoneRatesCard';
import styles from './phone.module.css';

/**
 * The composed Business Phone console — nine self-contained cards on one grid.
 *
 * It is COMPOSITION and nothing else: no state, no fetch, no branching. Each card
 * reads the shared snapshot itself and returns null when it has nothing to say —
 * the composer and the number search hide themselves without an active
 * subscription, the logs hide without a session — so this file never grows a
 * condition when a card is added, and any one card can be dropped onto another
 * surface on its own.
 *
 * That self-gating is also why there is no "is the add-on active?" check here.
 * Putting one in would be the first branch, and the first branch is how a
 * composition root becomes the file everyone edits.
 */
export function PhoneConsole() {
  const t = useTranslations('phone');

  return (
    <div>
      <p className={styles.cardHint}>{t('console.intro')}</p>
      <div className={styles.grid}>
        <PhoneBalanceCard />
        {/* `TopUpPanel` reads `?topup=` to settle a returning payment, and
            `useSearchParams` needs a Suspense boundary. It is HERE rather than
            around the whole console so one card suspending cannot blank the
            balance and the logs beside it. */}
        <Suspense fallback={null}><TopUpPanel /></Suspense>
        <PhoneNumbersCard />
        <NumberSearchPanel />
        <SmsComposer />
        <SmsLogList />
        <CallLogList />
        <CommsStatementList />
        <PhoneRatesCard />
      </div>
    </div>
  );
}
