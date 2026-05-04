'use client';

import { useMemo, useState } from 'react';

interface Tweet {
  id: string;
  author: string;
  quote: string;
  likes: number;
  category?: string;
  images?: string[];
}

type Filter = 'coderclaw' | 'all';

function isCoderClaw(t: Tweet): boolean {
  const text = `${t.quote} ${t.author}`.toLowerCase();
  return text.includes('@coderclaw') || text.includes('#coderclaw');
}

export default function ShowcaseGrid({
  tweets,
  initialCoderclawCount,
  totalCount,
}: {
  tweets: Tweet[];
  initialCoderclawCount: number;
  totalCount: number;
}) {
  const [filter, setFilter] = useState<Filter>('coderclaw');

  const visible = useMemo(
    () => (filter === 'coderclaw' ? tweets.filter(isCoderClaw) : tweets),
    [tweets, filter]
  );

  return (
    <>
      <div className="cc-filter-bar">
        <button
          className={`cc-filter${filter === 'coderclaw' ? ' active' : ''}`}
          onClick={() => setFilter('coderclaw')}
          aria-pressed={filter === 'coderclaw'}
        >
          CoderClaw Projects ({initialCoderclawCount})
        </button>
        <button
          className={`cc-filter${filter === 'all' ? ' active' : ''}`}
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        >
          All Projects ({totalCount})
        </button>
      </div>

      <div className="cc-showcase-grid">
        {visible.map((t) => (
          <a
            key={t.id}
            href={`https://x.com/${t.author}/status/${t.id}`}
            target="_blank"
            rel="noopener"
            className="cc-tweet-card"
          >
            <div className="cc-tweet-header">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://unavatar.io/x/${t.author}`} alt={t.author} className="cc-avatar" loading="lazy" />
              <div className="cc-author-info">
                <span className="cc-author-name">@{t.author}</span>
                <span className="cc-likes">♥ {t.likes}</span>
              </div>
            </div>
            <p className="cc-tweet-quote">{t.quote}</p>
            {t.images && t.images.length > 0 && (
              <div className="cc-tweet-images">
                {t.images.map((img, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={img} alt="Screenshot" className="cc-tweet-image" loading="lazy" />
                ))}
              </div>
            )}
            <span className="cc-tweet-link">View on X →</span>
          </a>
        ))}
      </div>

      <style>{`
        .cc-filter-bar {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-bottom: 28px;
          flex-wrap: wrap;
        }
        .cc-filter {
          padding: 8px 16px;
          border-radius: 10px;
          border: 1px solid var(--border-subtle);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 0.875rem;
          transition: all 0.15s;
        }
        .cc-filter.active {
          color: var(--coral-bright);
          background: rgba(77,158,255,0.12);
          border-color: rgba(77,158,255,0.4);
        }
        .cc-showcase-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
          gap: 20px;
        }
        .cc-tweet-card {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 20px;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
          text-decoration: none;
          color: var(--text-primary);
          transition: transform 0.15s, border-color 0.15s, background 0.15s;
        }
        .cc-tweet-card:hover {
          transform: translateY(-2px);
          border-color: color-mix(in srgb, var(--coral-bright) 40%, transparent);
        }
        .cc-tweet-header {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .cc-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .cc-author-info {
          display: flex;
          flex-direction: column;
          flex: 1;
        }
        .cc-author-name {
          font-weight: 600;
          font-size: 0.9rem;
        }
        .cc-likes {
          color: var(--text-secondary);
          font-size: 0.78rem;
        }
        .cc-tweet-quote {
          color: var(--text-secondary);
          line-height: 1.55;
          margin: 0;
          white-space: pre-wrap;
          font-size: 0.92rem;
        }
        .cc-tweet-images {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }
        .cc-tweet-image {
          width: 100%;
          border-radius: 10px;
          object-fit: cover;
          max-height: 280px;
        }
        .cc-tweet-link {
          font-size: 0.82rem;
          color: var(--coral-bright);
          margin-top: auto;
        }
      `}</style>
    </>
  );
}
