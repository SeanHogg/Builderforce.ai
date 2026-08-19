'use client';

/**
 * One brand-colour editor, for BOTH halves of the co-branding.
 *
 * The asking organisation's palette and the responder tenant's own palette are
 * the same object edited the same way, so they are the same component rather
 * than two forms that drift. It also owns the two ways of NOT typing hex codes
 * by hand, which is what the capture used to require:
 *
 *   • from a website — the server reads the site's declared brand (meta
 *     theme-color, `--brand`/`--primary` custom properties, then colour usage
 *     ranked by chroma), because a browser cannot fetch a third-party origin's
 *     stylesheet.
 *   • from a logo — the browser reads the image's own pixels, because only a
 *     browser has a decoder for PNG/JPEG/WebP/SVG.
 *
 * Neither ever silently replaces what someone typed without showing what it
 * found: the candidates it surfaced stay on screen as swatches, so a wrong first
 * guess costs one click rather than a re-run.
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { rfpApi, type BrandPalette } from '@/lib/builderforceApi';
import { extractPaletteFromImage } from '@/lib/brandPalette';

export interface BrandPaletteEditorProps {
  value: BrandPalette;
  onChange: (patch: Partial<BrandPalette>) => void;
  /** Shown above the fields. The two halves need different wording. */
  hint?: string;
  disabled?: boolean;
}

const swatch: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)',
  padding: 0, cursor: 'pointer',
};

export function BrandPaletteEditor({ value, onChange, hint, disabled }: BrandPaletteEditorProps) {
  const t = useTranslations('rfpPage');
  const [siteUrl, setSiteUrl] = useState('');
  const [busy, setBusy] = useState<'site' | 'logo' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((palette: Partial<BrandPalette>, found: string[]) => {
    onChange(palette);
    setCandidates(found.slice(0, 10));
  }, [onChange]);

  const readSite = async () => {
    if (!siteUrl.trim()) return;
    setBusy('site');
    setNotice(null);
    try {
      const result = await rfpApi.extractBrand(siteUrl.trim());
      apply({
        primary: result.palette.primary,
        secondary: result.palette.secondary,
        accent: result.palette.accent,
        ...(result.palette.logoUrl ? { logoUrl: result.palette.logoUrl } : {}),
      }, result.candidates);
      setNotice(t('brand.readFromSiteDone'));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t('brand.readFailed'));
    } finally {
      setBusy(null);
    }
  };

  const readLogo = async (file: File) => {
    setBusy('logo');
    setNotice(null);
    const palette = await extractPaletteFromImage(file).catch(() => null);
    if (!palette) {
      setNotice(t('brand.readFailed'));
      setBusy(null);
      return;
    }
    apply({ primary: palette.primary, secondary: palette.secondary, accent: palette.accent }, palette.candidates);
    setNotice(t('brand.readFromLogoDone'));
    setBusy(null);
  };

  return (
    <div>
      {hint && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 8px' }}>{hint}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 10 }}>
        <ColorField label={t('field.primary')} value={value.primary} disabled={disabled} onChange={(v) => onChange({ primary: v })} />
        <ColorField label={t('field.secondary')} value={value.secondary} disabled={disabled} onChange={(v) => onChange({ secondary: v })} />
        <ColorField label={t('field.accent')} value={value.accent} disabled={disabled} onChange={(v) => onChange({ accent: v })} />
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('field.logoUrl')}</span>
        <input className="input" disabled={disabled} value={value.logoUrl ?? ''} onChange={(e) => onChange({ logoUrl: e.target.value })} placeholder="https://…/logo.png" />
      </label>

      {/* The two ways of not typing hex by hand. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px', minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('brand.fromSite')}</span>
          <input
            className="input"
            disabled={disabled || busy !== null}
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void readSite(); } }}
            placeholder={t('brand.sitePlaceholder')}
          />
        </label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={readSite} disabled={disabled || busy !== null || !siteUrl.trim()}>
          {busy === 'site' ? t('brand.reading') : t('brand.read')}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={disabled || busy !== null}>
          {busy === 'logo' ? t('brand.reading') : t('brand.fromLogo')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void readLogo(file);
          }}
        />
      </div>

      {notice && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>{notice}</p>}

      {candidates.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 4px' }}>{t('brand.candidates')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {candidates.map((hex) => (
              <button
                key={hex}
                type="button"
                title={hex}
                aria-label={hex}
                onClick={() => onChange({ primary: hex })}
                disabled={disabled}
                style={{ ...swatch, background: hex }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 34, height: 34, padding: 0, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'transparent' }}
          aria-label={label}
        />
        <input className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 0 }} />
      </div>
    </label>
  );
}
