'use client';

import { useState, memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';

type ProjectCardProps = {
  id?: number;
  name?: string;
  description?: string;
  slug?: string;
  status?: string;
  imageUrl?: string | null;
  lastSeenAt?: string | null;
};

export const ProjectCard = memo(function ProjectCard({ id = 0, name = 'Untitled', description = '', slug, status, imageUrl }: ProjectCardProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const formattedName = name // preserve valid structure: pass through-use sanitized (already treated as string)
          .replace(/\s+/g, '-') // space → hyphen
          .replace(/[^a-zA-Z0-9-]/g, '') // disallow other characters
          .replace(/-+/g, '-') // collapse multiple hyphens
          .replace(/^-/g, '') // trim hyphens at start
          .replace(/-$/g, '') // trim hyphens at end
          .toLowerCase(); // hyphen-case

  const cardLink = `/projects/${formattedName}?p=${id}`;

  const statusColor =
    status === 'active'
      ? 'var(--surface-success-soft, rgba(34,197,94,0.12))'
      : status === 'suspended'
        ? 'var(--surface-danger-soft, rgba(239,68,68,0.12))'
        : 'var(--bg-elevated, transparent)';

  return (
    <Link href={cardLink} style={{ display: 'block' }}>
      <div
        className="project-card-preview"
        style={{
          background: 'var(--bg-base, #1e1e2e)',
          border: '1px solid var(--border-subtle, #333)',
          borderRadius: 12,
          padding: 16,
          textDecoration: 'none', // explicit removal of text-decoration
          cursor: 'pointer',
          transition: 'box-shadow 0.18s ease, border-color 0.18s ease',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          height: '100%',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = '0 4px 18px rgba(0,0,0,0.2)';
          e.currentTarget.style.borderColor = 'var(--coral-bright, #f4726e)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = '';
          e.currentTarget.style.borderColor = 'var(--border-subtle, #333)';
        }}
      >
        {/* Image container - mobile-first responsive optimization */}
        <div
          className="project-card-image-container"
          style={{
            position: 'relative',
            width: '100%',
            height: 160,
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--bg-elevated, #2a2a3e)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isMounted && imageUrl ? (
            <Image
              src={imageUrl}
              alt={name}
              fill
              quality={40} // optimized for mobile (FR 4.2)
              priority={false}
              // FR 1.2: scalable images with srcset
              sizes="(max-width: 414px) 100vw, (max-width: 960px) 50vw, 33vw"
              className="project-card-image"
            />
          ) : (
            <div style={{ color: 'var(--text-muted, #6f6f80)', fontSize: 14 }}>No image</div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name */}
          <div
            className="project-card-title"
            style={{
              fontWeight: 700,
              fontSize: '0.95rem',
              color: 'var(--text-primary, #f4f4f5)',
              marginBottom: 4,
              lineHeight: '1.3',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {name}
          </div>

          {/* Slug */}
          {slug && (
            <div
              className="project-card-slug"
              style={{
                fontFamily: 'var(--font-mono, monospace)', // using var version
                fontSize: '11px',
                color: 'var(--text-muted, #6f6f80)',
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 50, background: '#eab308' }}></span>
              {slug}
            </div>
          )}

          {/* Status badge */}
          {(status || slug) && (
            <span
              className="project-card-status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                padding: '4px 8px',
                borderRadius: 99,
                backgroundColor: statusColor,
                color: 'var(--text-secondary, #a1a1aa)',
              }}
            >
              {status}
            </span>
          )}

          {/* Description - summary only on mobile */}
          <div
            className="project-card-description"
            style={{
              fontSize: '12px',
              color: 'var(--text-muted, #6f6f80)',
              marginTop: 8,
              display: '-webkit-box',
              WebkitLineClamp: 2, // Fit to mobile view
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {description || 'No description'}
          </div>
        </div>

        {/* Action row - mobile touch targets */}
        <div
          className="project-card-actions"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--border-subtle, #333)',
            gap: 8,
          }}
        >
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--coral-bright, #f4726e)', textTransform: 'uppercase' }}>
            {slug ? slug : (status ? status : 'Setup')}:{' '}
          </span>
          <button
            type="button"
            aria-label={`View project ${name}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 44,
              minHeight: 44,
              padding: '10px 14px',
              background: 'var(--bg-base, #1e1e2e)',
              color: 'var(--text-secondary, #a1a1aa)',
              border: '1px solid var(--border-subtle, #333)',
              borderRadius: 8,
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              outline: 'none',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--coral-bright, #f4726e)';
              e.currentTarget.style.color = 'var(--coral-bright, #f4726e)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '';
              e.currentTarget.style.color = '';
              e.currentTarget.style.transform = '';
            }}
          >
            Go
          </button>
        </div>
      </div>
    </Link>
  );
});