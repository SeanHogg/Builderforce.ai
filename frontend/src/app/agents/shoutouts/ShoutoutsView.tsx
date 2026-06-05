'use client';

import { useState } from 'react';
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

  return (
    <>
      <header className="cc-page-header">
        <h1 className="cc-page-title"><span className="cc-agentHost-accent">⟩</span> Shoutouts</h1>
        <p className="cc-page-subtitle">What the community is saying about BuilderForce Agents.</p>
      </header>

      <div className="cc-shoutouts-toolbar">
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {all.length === 0 ? (
        <p className="cc-page-subtitle" style={{ textAlign: 'center' }}>No shoutouts yet.</p>
      ) : viewMode === 'card' ? (
        <div className="cc-shoutouts-grid">
          {all.map((t, i) => (
            <a key={i} href={t.url} target="_blank" rel="noopener" className="cc-shoutout-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={t.avatar || `https://unavatar.io/x/${t.author}`}
                alt={t.author}
                loading="lazy"
                className="cc-shoutout-avatar"
              />
              <div className="cc-shoutout-content">
                <p className="cc-shoutout-quote">&ldquo;{t.quote}&rdquo;</p>
                <span className="cc-shoutout-author">@{t.author}</span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div style={{ ...tableWrapStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>Author</th>
                <th style={thStyle}>Handle</th>
                <th style={thStyle}>Testimonial</th>
              </tr>
            </thead>
            <tbody>
              {all.map((t, i) => (
                <tr key={i} style={trStyle}>
                  <td style={tdStyle}>
                    <span className="cc-shoutout-tauthor">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={t.avatar || `https://unavatar.io/x/${t.author}`}
                        alt={t.author}
                        loading="lazy"
                        className="cc-shoutout-tavatar"
                      />
                      {t.author}
                    </span>
                  </td>
                  <td style={tdMutedStyle}>
                    <a href={t.url} target="_blank" rel="noopener" className="cc-shoutout-thandle">@{t.author}</a>
                  </td>
                  <td style={tdMutedStyle}>&ldquo;{t.quote}&rdquo;</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
