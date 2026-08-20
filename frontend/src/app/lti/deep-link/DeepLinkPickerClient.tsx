'use client';

/**
 * The LTI deep-linking picker — what an instructor sees inside their LMS's
 * "add external tool content" dialog.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────────────
 * A resource-link launch answers "open this". Deep linking answers the question
 * before it: the LMS asks US what there is to add, and whatever the instructor
 * picks becomes an assignment IN THEIR COURSE, with a resource link behind it —
 * which is what later makes a launch bind to an assignment and a mark go back
 * through AGS. Without this page an instructor has to paste a target URL by
 * hand, and a hand-pasted URL carries no resource link at all.
 *
 * ── THE THREE THINGS THIS PAGE HAS TO GET RIGHT ──────────────────────────────
 *
 * 1. IT IS AUTHENTICATED BY A TOKEN, NOT A SESSION. It renders inside the LMS's
 *    iframe, where our own cookie is a blocked third-party cookie and the
 *    instructor may have no Builderforce session at all. The `token` in the URL
 *    is the short-lived signed envelope the launch minted; every call carries it
 *    and nothing else.
 *
 * 2. IT RESPECTS `accept_multiple`. The platform states whether it will take
 *    more than one item, and a picker that shows checkboxes to a platform that
 *    accepts one produces a selection the LMS rejects with a message the
 *    instructor cannot act on.
 *
 * 3. IT ENDS IN A SELF-SUBMITTING FORM. This is not a shortcut — it is the
 *    protocol. The response JWT must arrive at the platform's
 *    `deep_link_return_url` as a form POST FROM THE BROWSER, because that
 *    endpoint authenticates the instructor's own LMS session. A fetch from here,
 *    or a POST from our server, arrives with nobody signed in and is rejected.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { ltiDeepLinkApi, type LtiDeepLinkOptions } from '@/lib/builderforceApi';

type Phase = 'loading' | 'ready' | 'failed' | 'returning';

export default function DeepLinkPickerClient() {
  const t = useTranslations('ltiDeepLink');
  // The canvas already names every object kind, in all five languages. A second
  // set of labels here would be the same words maintained twice.
  const kindLabel = useTranslations('creationCanvas.object');
  const token = useSearchParams().get('token') ?? '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [options, setOptions] = useState<LtiDeepLinkOptions | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [reply, setReply] = useState<{ returnUrl: string; jwt: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!token) {
      setError(t('expired'));
      setPhase('failed');
      return;
    }
    let live = true;
    ltiDeepLinkApi.options(token)
      .then((result) => {
        if (!live) return;
        setOptions(result);
        setPhase('ready');
      })
      .catch(() => {
        if (!live) return;
        setError(t('expired'));
        setPhase('failed');
      });
    return () => { live = false; };
  }, [t, token]);

  // The moment the signed response exists, hand it to the LMS. Rendering it and
  // waiting for a click would put a second "are you sure" in front of somebody
  // who has already said yes.
  useEffect(() => {
    if (reply) formRef.current?.submit();
  }, [reply]);

  const multiple = options?.settings.acceptMultiple ?? false;

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      if (!multiple) return [id];
      return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    });
  }, [multiple]);

  const submit = useCallback(async () => {
    if (!selected.length) return;
    setPhase('returning');
    setError('');
    try {
      setReply(await ltiDeepLinkApi.respond(token, selected));
    } catch {
      setError(t('submitFailed'));
      setPhase('ready');
    }
  }, [selected, t, token]);

  const label = (kind: string): string => (kindLabel.has(kind) ? kindLabel(kind) : kind);

  return (
    <PageContainer width="readable" style={{ padding: '32px 16px' }}>
      <div
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: 'clamp(16px, 4vw, 28px)',
          maxWidth: 640,
          margin: '0 auto',
        }}
      >
        <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>
          {options?.settings.title || t('title')}
        </h1>
        <p style={{ fontSize: 'var(--font-size-body)', lineHeight: 1.6, color: 'var(--text-secondary)', margin: '0 0 18px' }}>
          {options?.settings.text || (multiple ? t('chooseMany') : t('chooseOne'))}
        </p>

        {phase === 'loading' && (
          <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', margin: 0 }}>{t('loading')}</p>
        )}

        {phase === 'failed' && (
          <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--danger-text)', margin: 0 }}>{error}</p>
        )}

        {phase !== 'loading' && phase !== 'failed' && options && options.objects.length === 0 && (
          <div style={{ border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 16 }}>
            <p style={{ fontSize: 'var(--font-size-body)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 6px' }}>
              {t('empty')}
            </p>
            <p style={{ fontSize: 'var(--font-size-small)', lineHeight: 1.6, color: 'var(--text-secondary)', margin: 0 }}>
              {t('emptyHint')}
            </p>
          </div>
        )}

        {phase !== 'loading' && phase !== 'failed' && options && options.objects.length > 0 && (
          <>
            <ul style={{ listStyle: 'none', margin: '0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {options.objects.map((object) => {
                const checked = selected.includes(object.id);
                return (
                  <li key={object.id}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-subtle)'}`,
                        background: checked ? 'var(--bg-elevated)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type={multiple ? 'checkbox' : 'radio'}
                        name="lti-deep-link-object"
                        checked={checked}
                        onChange={() => toggle(object.id)}
                        style={{ marginTop: 3, accentColor: 'var(--accent)' }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 'var(--font-size-body)', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                          {object.title}
                        </span>
                        <span style={{ display: 'block', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
                          {label(object.kind)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {error && (
              <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--danger-text)', margin: '0 0 12px' }}>{error}</p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!selected.length || phase === 'returning'}
              style={{
                padding: '10px 18px',
                fontSize: 'var(--font-size-body)',
                fontWeight: 600,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: selected.length ? 'var(--accent)' : 'var(--bg-elevated)',
                color: selected.length ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                cursor: selected.length && phase !== 'returning' ? 'pointer' : 'not-allowed',
              }}
            >
              {phase === 'returning' ? t('submitting') : t('submit')}
            </button>
          </>
        )}

        {/*
          The protocol's last step. Hidden because nobody is meant to press it:
          the effect above submits it as soon as the signed response arrives, and
          the browser navigates this frame to the LMS's return endpoint.
        */}
        {reply && (
          <form ref={formRef} method="POST" action={reply.returnUrl} style={{ display: 'none' }}>
            <input type="hidden" name="JWT" value={reply.jwt} readOnly />
          </form>
        )}
      </div>
    </PageContainer>
  );
}
