'use client';

/**
 * ModelApiSamples — copy-ready code samples for calling a Builderforce.ai model.
 *
 * Shows BOTH supported call patterns so the answer to "does it use the OpenAI
 * standard?" is concrete:
 *   1. OpenAI-compatible gateway (`/v1/chat/completions`) — works with the stock
 *      OpenAI SDKs by pointing `base_url` at the gateway (cURL / Python / JS).
 *   2. The dedicated Workforce-model endpoint (`/api/ide/agents/{id}/chat`) — the
 *      same OpenAI chat message/stream shape, addressed by model id.
 *
 * Reused by the publish panel (post-validate) and the /evermind landing page, so
 * there is ONE source of call examples. Labels are localized; code stays literal.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';

type Lang = 'curl' | 'python' | 'javascript';
const LANGS: Lang[] = ['curl', 'python', 'javascript'];
const LANG_LABEL: Record<Lang, string> = { curl: 'cURL', python: 'Python', javascript: 'JavaScript' };

const API_BASE = 'https://api.builderforce.ai';

function openAiSample(lang: Lang, modelRef: string): string {
  switch (lang) {
    case 'curl':
      return `curl ${API_BASE}/v1/chat/completions \\
  -H "Authorization: Bearer $BUILDERFORCE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelRef}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
    case 'python':
      return `from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE}/v1",
    api_key="$BUILDERFORCE_API_KEY",
)

resp = client.chat.completions.create(
    model="${modelRef}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(resp.choices[0].message.content)`;
    case 'javascript':
      return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${API_BASE}/v1",
  apiKey: process.env.BUILDERFORCE_API_KEY,
});

const resp = await client.chat.completions.create({
  model: "${modelRef}",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(resp.choices[0].message.content);`;
  }
}

function workforceSample(lang: Lang, agentId: string): string {
  const url = `${API_BASE}/api/ide/agents/${agentId}/chat`;
  switch (lang) {
    case 'curl':
      return `curl ${url} \\
  -H "Authorization: Bearer $BUILDERFORCE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"messages": [{"role": "user", "content": "Hello!"}], "stream": false}'`;
    case 'python':
      return `import requests

r = requests.post(
    "${url}",
    headers={"Authorization": "Bearer $BUILDERFORCE_API_KEY"},
    json={"messages": [{"role": "user", "content": "Hello!"}], "stream": False},
)
print(r.json())`;
    case 'javascript':
      return `const r = await fetch("${url}", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${process.env.BUILDERFORCE_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ messages: [{ role: "user", content: "Hello!" }], stream: false }),
});
console.log(await r.json());`;
  }
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const t = useTranslations('modelApiSamples');
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div style={{ position: 'relative', marginTop: 10 }}>
      <button
        type="button"
        onClick={copy}
        aria-label={t('copy')}
        style={{
          position: 'absolute', top: 8, right: 8, fontSize: 12, padding: '4px 10px', borderRadius: 8,
          background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', cursor: 'pointer',
        }}
      >
        {copied ? t('copied') : t('copy')}
      </button>
      <pre style={{
        margin: 0, padding: '16px 18px', borderRadius: 12, overflowX: 'auto',
        background: '#0e1525', border: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 13, lineHeight: 1.6, color: '#dce6f7',
      }}>
        <code aria-label={label}>{code}</code>
      </pre>
    </div>
  );
}

export default function ModelApiSamples({
  modelRef = 'builderforce/workforce-<your-model-id>',
  agentId = '<your-model-id>',
}: {
  modelRef?: string;
  agentId?: string;
}) {
  const t = useTranslations('modelApiSamples');
  const [lang, setLang] = useState<Lang>('curl');

  return (
    <div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: 14 }}>{t('intro')}</p>

      {/* Language tabs */}
      <div role="tablist" aria-label={t('langTablist')} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {LANGS.map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={lang === l}
            onClick={() => setLang(l)}
            style={{
              fontSize: 13, padding: '6px 14px', borderRadius: 9, cursor: 'pointer', fontWeight: 600,
              border: '1px solid var(--border-subtle)',
              background: lang === l ? 'var(--coral-bright)' : 'transparent',
              color: lang === l ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {LANG_LABEL[l]}
          </button>
        ))}
      </div>

      {/* Pattern 1 — OpenAI standard */}
      <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', margin: '16px 0 0', color: 'var(--text-primary)' }}>
        {t('openaiTitle')}
      </h4>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>{t('openaiDesc')}</p>
      <CodeBlock code={openAiSample(lang, modelRef)} label={t('openaiTitle')} />

      {/* Pattern 2 — dedicated workforce endpoint */}
      <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', margin: '20px 0 0', color: 'var(--text-primary)' }}>
        {t('workforceTitle')}
      </h4>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>{t('workforceDesc')}</p>
      <CodeBlock code={workforceSample(lang, agentId)} label={t('workforceTitle')} />
    </div>
  );
}
