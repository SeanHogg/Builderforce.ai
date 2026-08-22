'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';

export interface Testimonial {
  quote: string;
  author: string;
  url: string;
  avatar?: string;
}

export default function ShoutoutsView({ all }: { all: Testimonial[] }) {
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const t = useTranslations('agents.shoutouts');

  return (
    <>
      <header className="cc-page-header">
        <h1 className="cc-page-title"><span className="cc-agentHost-accent">⟩</span> {t('heading')}</h1>
        <p className="cc-page-subtitle">{t('subtitle')}</p>
      </header>

      <div className="cc-shoutouts-toolbar">
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {all.length === 0 ? (
        <p className="cc-page-subtitle" style={{ textAlign: 'center' }}>{t('empty')}</p>
      ) : viewMode === 'card' ? (
        <div className="cc-shoutouts-grid">
          {all.map((item, i) => (
            <a key={i} href={item.url} target="_blank" rel="noopener" className="cc-shoutout-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.avatar || `https://unavatar.io/x/${item.author}`}
                alt={item.author}
                loading="lazy"
                className="cc-shoutout-avatar"
              />
              <div className="cc-shoutout-content">
                <p className="cc-shoutout-quote">&ldquo;{item.quote}&rdquo;</p>
                <span className="cc-shoutout-author">@{item.author}</span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div style={{ ...tableWrapStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t('colAuthor')}</th>
                <th style={thStyle}>{t('colHandle')}</th>
                <th style={thStyle}>{t('colTestimonial')}</th>
              </tr>
            </thead>
            <tbody>
              {all.map((item, i) => (
                <tr key={i} style={trStyle}>
                  <td style={tdStyle}>
                    <span className="cc-shoutout-tauthor">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.avatar || `https://unavatar.io/x/${item.author}`}
                        alt={item.author}
                        loading="lazy"
                        className="cc-shoutout-tavatar"
                      />
                      {item.author}
                    </span>
                  </td>
                  <td style={tdMutedStyle}>
                    <a href={item.url} target="_blank" rel="noopener" className="cc-shoutout-thandle">@{item.author}</a>
                  </td>
                  <td style={tdMutedStyle}>&ldquo;{item.quote}&rdquo;</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
