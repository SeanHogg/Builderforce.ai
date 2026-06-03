import { ImageResponse } from 'next/og';

/**
 * Shared dynamic OG-image renderer. Every route's `opengraph-image.tsx` calls
 * this so social/link previews share one branded template — no per-route image
 * markup to drift. Satori (next/og) only supports inline flexbox styles, so
 * keep everything here explicit and font/gradient-light.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

export function renderBrandOg({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: 'linear-gradient(135deg, #0a0f1a 0%, #131a2b 58%, #0a0f1a 100%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 13,
              background: 'linear-gradient(135deg, #ff6b5e, #e23b2e)',
              display: 'flex',
            }}
          />
          <div style={{ fontSize: 32, fontWeight: 700, color: '#ffffff' }}>Builderforce.ai</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {eyebrow ? (
            <div
              style={{
                fontSize: 26,
                fontWeight: 600,
                color: '#ff8a7e',
                letterSpacing: 3,
                textTransform: 'uppercase',
                marginBottom: 18,
              }}
            >
              {eyebrow}
            </div>
          ) : null}
          <div style={{ fontSize: 66, fontWeight: 800, color: '#ffffff', lineHeight: 1.08, maxWidth: 980 }}>
            {title}
          </div>
        </div>

        <div style={{ fontSize: 25, color: '#9aa6c2' }}>Your AI CTO, CIO & Security Officer</div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
