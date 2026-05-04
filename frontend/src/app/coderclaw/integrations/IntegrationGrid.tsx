import BrandIcon, { type IconSpec } from '../BrandIcon';

export interface IntegrationItem {
  name: string;
  desc: string;
  docs: string;
  color: string;
  icon: IconSpec;
}

export default function IntegrationGrid({
  title,
  description,
  items,
  columns = 4,
}: {
  title: string;
  description: string;
  items: IntegrationItem[];
  columns?: 2 | 3 | 4;
}) {
  return (
    <section className="cc-int-section">
      <h2 className="cc-int-h2"><span className="cc-claw-accent">⟩</span> {title}</h2>
      <p className="cc-int-desc">{description}</p>
      <div className={`cc-int-grid cc-int-grid-${columns}`}>
        {items.map((item) => (
          <a
            key={`${item.name}-${item.docs}`}
            href={item.docs}
            target="_blank"
            rel="noopener"
            className="cc-int-card"
            style={{ ['--accent' as string]: item.color }}
          >
            <span className="cc-int-icon">
              <BrandIcon icon={item.icon} color={item.color} size={32} label={item.name} />
            </span>
            <h3 className="cc-int-name">{item.name}</h3>
            <p className="cc-int-card-desc">{item.desc}</p>
          </a>
        ))}
      </div>
      <style>{`
        .cc-int-section { margin-top: 56px; }
        .cc-int-h2 {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(1.25rem, 2.5vw, 1.75rem);
          margin: 0 0 8px;
          color: var(--text-primary);
        }
        .cc-int-desc {
          color: var(--text-secondary);
          margin: 0 0 24px;
          font-size: 0.95rem;
        }
        .cc-int-grid {
          display: grid;
          gap: 16px;
        }
        .cc-int-grid-2 { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
        .cc-int-grid-3 { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
        .cc-int-grid-4 { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
        .cc-int-card {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 18px;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
          color: var(--text-primary);
          text-decoration: none;
          transition: transform 0.15s, border-color 0.15s;
        }
        .cc-int-card:hover {
          transform: translateY(-2px);
          border-color: var(--accent);
        }
        .cc-int-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 11px;
          background: color-mix(in srgb, var(--accent) 14%, transparent);
        }
        .cc-int-name {
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 1rem;
          margin: 4px 0 0;
        }
        .cc-int-card-desc {
          color: var(--text-secondary);
          font-size: 0.85rem;
          line-height: 1.5;
          margin: 0;
        }
      `}</style>
    </section>
  );
}
