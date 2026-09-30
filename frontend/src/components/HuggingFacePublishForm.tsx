/**
 * HuggingFacePublishForm — push one published Evermind model to a Hugging Face repo
 * with the person's own write token (see `lib/huggingFacePublish.ts`). Owns its fields,
 * validation, busy/error/success states; the token lives only in this form's state and
 * goes straight to huggingface.co. The host mounts it with the model and precision.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { usePanelTask } from '@/hooks/usePanelTask';
import { isHuggingFaceRepoId, publishModelToHuggingFace } from '@/lib/huggingFacePublish';
import type { PublishOutcome } from '@seanhogg/builderforce-memory';

const fieldStyle = {
  width: '100%', boxSizing: 'border-box' as const, background: 'var(--bg-deep)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '8px 10px', fontSize: 'var(--font-size-small)',
};
const labelStyle = { display: 'block', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)', marginBottom: 4 };

export function HuggingFacePublishForm({ slug, fp16 }: { slug: string; fp16: boolean }) {
  const t = useTranslations('modelExport.hub');
  const [repoId, setRepoId] = useState('');
  const [token, setToken] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [published, setPublished] = useState<PublishOutcome | null>(null);
  const task = usePanelTask();

  const publish = async () => {
    setPublished(null);
    if (!isHuggingFaceRepoId(repoId)) {
      task.fail(t('invalidRepo'));
      return;
    }
    const outcome = await task.run(
      () => publishModelToHuggingFace(slug, { repoId, token: token.trim(), private: isPrivate }, fp16),
      { failure: t('error') },
    );
    if (outcome) setPublished(outcome);
  };

  const disabled = task.busy || !slug || !repoId.trim() || !token.trim();

  return (
    <section
      aria-labelledby="hf-publish-heading"
      style={{
        display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)',
      }}
    >
      <h4 id="hf-publish-heading" style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>
        {t('heading')}
      </h4>
      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('intro')}</p>

      <div>
        <label htmlFor="hf-publish-repo" style={labelStyle}>{t('repoLabel')}</label>
        <input
          id="hf-publish-repo"
          value={repoId}
          onChange={(e) => setRepoId(e.target.value)}
          placeholder={t('repoPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          style={fieldStyle}
        />
      </div>

      <div>
        <label htmlFor="hf-publish-token" style={labelStyle}>{t('tokenLabel')}</label>
        <input
          id="hf-publish-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t('tokenPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          style={fieldStyle}
        />
        <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 4 }}>{t('tokenHelp')}</div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        {t('privateLabel')}
      </label>

      <div>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={disabled}
          style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--font-size-small)', minHeight: 36,
            background: task.busy ? 'var(--bg-deep)' : 'var(--coral-bright)',
            color: task.busy ? 'var(--text-muted)' : 'var(--text-on-accent)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '8px 16px',
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
          }}
        >
          {task.busy ? t('publishing') : t('publish')}
        </button>
      </div>

      {task.error && (
        <div
          role="alert"
          style={{
            background: 'var(--warning-bg, rgba(239,68,68,0.12))', border: '1px solid var(--error)', color: 'var(--error-text)',
            borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere',
          }}
        >
          <Icon source="⚠" size="1em" /> {task.error}
        </div>
      )}

      {published && (
        <div
          role="status"
          style={{
            background: 'var(--success-bg, rgba(34,197,94,0.12))', border: '1px solid var(--success)', color: 'var(--text-primary)',
            borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere',
          }}
        >
          <Icon source="✅" size="1em" /> {t('done', { count: published.files.length })}{' '}
          <a href={published.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent, var(--coral-bright))' }}>
            {published.repoId}
          </a>
        </div>
      )}
    </section>
  );
}
