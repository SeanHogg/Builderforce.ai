'use client';

import { useState } from 'react';

const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://api.builderforce.ai';

type Status = 'idle' | 'sending' | 'ok' | 'error';

export default function NewsletterForm({ source = 'coderclaw' }: { source?: string }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    try {
      const res = await fetch(`${AUTH_API_URL}/api/auth/newsletter/subscribers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), action: 'subscribe', source }),
      });
      if (!res.ok) throw new Error('failed');
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }

  return (
    <section className="cc-newsletter">
      <h2 className="cc-h2"><span className="cc-claw-accent">⟩</span> Stay in the Loop</h2>
      <p className="cc-prose">Get updates on new features, integrations, and lobster wisdom. No spam, unsubscribe anytime.</p>
      <form className="cc-nl-form" onSubmit={handleSubmit}>
        <input
          type="email"
          required
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === 'sending' || status === 'ok'}
          aria-label="Email address"
          className="cc-nl-input"
        />
        <button
          type="submit"
          className="cc-nl-btn"
          disabled={status === 'sending' || status === 'ok'}
        >
          {status === 'ok' ? 'Subscribed ✓' : status === 'sending' ? 'Subscribing…' : 'Subscribe'}
        </button>
      </form>
      {status === 'error' && <p className="cc-nl-status cc-error">Unable to subscribe right now. Please try again.</p>}
      {status === 'ok' && <p className="cc-nl-status cc-ok">Thanks — you&apos;re on the list.</p>}
      <style>{`
        .cc-newsletter {
          max-width: 720px;
          margin: 64px auto 0;
          padding: 32px;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
        }
        .cc-nl-form {
          display: flex;
          gap: 8px;
          margin-top: 16px;
          flex-wrap: wrap;
        }
        .cc-nl-input {
          flex: 1;
          min-width: 220px;
          padding: 12px 14px;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 0.95rem;
        }
        .cc-nl-input:focus {
          outline: none;
          border-color: var(--coral-bright);
        }
        .cc-nl-btn {
          padding: 12px 20px;
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark, var(--coral-bright)));
          color: white;
          border: none;
          border-radius: 10px;
          font-family: var(--font-display);
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.15s, opacity 0.2s;
        }
        .cc-nl-btn:hover:not(:disabled) {
          transform: translateY(-1px);
        }
        .cc-nl-btn:disabled {
          cursor: not-allowed;
          opacity: 0.7;
        }
        .cc-nl-status {
          margin: 12px 0 0;
          font-size: 0.875rem;
        }
        .cc-error { color: #ff6b6b; }
        .cc-ok { color: var(--cyan-bright); }
      `}</style>
    </section>
  );
}
