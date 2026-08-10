'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { HomeSection, HomeSectionHeader, homePatternStyles as styles } from '@/components/home/HomePatterns';
import { Button } from '@/components/ui';

type NewsletterStatus = 'idle' | 'sending' | 'ok' | 'error';

export interface NewsletterSignupSectionProps {
  source?: string;
}

export function NewsletterSignupSection({ source = 'builderforce-landing' }: NewsletterSignupSectionProps) {
  const t = useTranslations();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<NewsletterStatus>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;

    setStatus('sending');
    try {
      const response = await fetch('/api/auth/newsletter/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), action: 'subscribe', source }),
      });
      if (!response.ok) throw new Error('subscribe failed');
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }

  return (
    <HomeSection narrow tone="soft">
      <HomeSectionHeader
        centered
        eyebrow={t('home.beat.keepUp')}
        title={t('home.newsletterHeading')}
        lead={t('home.newsletterLead')}
      />
      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          className="ui-input"
          type="email"
          placeholder={t('home.newsletterPlaceholder')}
          aria-label={t('home.newsletterPlaceholder')}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={status === 'sending' || status === 'ok'}
        />
        <Button type="submit" disabled={status === 'sending' || status === 'ok'} variant="primary" size="lg">
          {status === 'sending'
            ? t('home.newsletterSubscribing')
            : status === 'ok'
              ? t('home.newsletterSubscribed')
              : t('home.newsletterSubscribe')}
        </Button>
      </form>
      {status === 'ok' && <p className={styles.formStatus}>{t('home.newsletterSubscribedConfirm')}</p>}
      {status === 'error' && <p className={`${styles.formStatus} ${styles.formError}`}>{t('home.newsletterError')}</p>}
    </HomeSection>
  );
}
