'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { promptLibraryApi } from '@/lib/builderforceApi';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';

/**
 * The interactive half of `/prompts/[slug]`: take the prompt, and start with it.
 *
 * "Use" is the same two-step the prompt library index performs — `POST
 * /api/prompts/public/:slug/use` records the use and returns the CURRENT body,
 * then that body goes to the clipboard. Re-fetching rather than copying the
 * server-rendered string matters: the page may have been cached for an hour and
 * the prompt may have gained a version since, so the copy a reader takes is the
 * one the author last published, not the one that happened to be in the HTML.
 *
 * The count shown updates from the same response, so the number a reader sees
 * after using it is the server's, not a local guess.
 */
export default function PromptUseActions({ slug, initialUsageCount }: {
  slug: string;
  initialUsageCount: number | null;
}) {
  const t = useTranslations('promptDetail');
  const [state, setState] = useState<'idle' | 'working' | 'copied' | 'failed'>('idle');
  const [usageCount, setUsageCount] = useState(initialUsageCount);

  const use = async () => {
    setState('working');
    try {
      const fresh = await promptLibraryApi.usePublic(slug);
      // A refused clipboard resolves false rather than throwing, so the count
      // still updates for a reader whose browser blocked the write.
      const copied = await copyTextToClipboard(fresh.body);
      setUsageCount(fresh.usageCount);
      setState(copied ? 'copied' : 'failed');
    } catch {
      setState('failed');
    }
  };

  return (
    <>
      <button type="button" className="pdl-btn pdl-btn-primary" onClick={use} disabled={state === 'working'}>
        {state === 'working' ? t('working')
          : state === 'copied' ? t('copied')
          : state === 'failed' ? t('useFailed')
          : t('useCta')}
      </button>
      <Link className="pdl-btn pdl-btn-ghost" href="/prompts">{t('browseCta')}</Link>
      {typeof usageCount === 'number' ? (
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
          {t('uses', { count: usageCount })}
        </span>
      ) : null}
    </>
  );
}
