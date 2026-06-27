/**
 * BlogCover — an auto-generated, branded hero graphic for every blog post.
 *
 * Posts rarely ship with a bespoke image; rather than leave them text-only, this
 * renders a deterministic SVG cover from the post's own title + tags (no network,
 * no asset pipeline, SSR-safe — no Math.random / Date). The palette is chosen by
 * hashing the slug so each post gets a stable, distinct look. Posts that DO embed
 * their own diagrams still get the cover at the top; the two complement each other.
 *
 * Brand wordmark + tags are content/brand tokens (not translatable UI copy), so
 * this needs no i18n catalog entries.
 */

import { BRAND } from '@/lib/content';

// Deterministic palette set (accent pairs over the dark brand base).
const PALETTES: ReadonlyArray<{ a: string; b: string; accent: string }> = [
  { a: '#13203b', b: '#0e1525', accent: '#FF6B5C' }, // coral
  { a: '#0f2a22', b: '#0e1525', accent: '#3FE0A5' }, // green
  { a: '#1a1430', b: '#0e1525', accent: '#c084fc' }, // purple
  { a: '#0f2236', b: '#0e1525', accent: '#5aa9ff' }, // blue
  { a: '#2a1622', b: '#0e1525', accent: '#ff8fab' }, // pink
];

/** Stable non-negative hash of a string (FNV-1a). */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Greedy word-wrap into at most `maxLines` lines of ~`maxChars` characters. */
function wrap(title: string, maxChars = 26, maxLines = 3): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line.length === 0) line = w;
    else if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
    else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  // Remaining words (incl. the in-progress line) collapse into the last line.
  const used = lines.join(' ').split(/\s+/).filter(Boolean).length;
  const rest = words.slice(used).join(' ');
  if (rest) lines.push(rest.length > maxChars + 8 ? rest.slice(0, maxChars + 6) + '…' : rest);
  else if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

export default function BlogCover({
  title,
  tags = [],
  slug,
}: {
  title: string;
  tags?: string[];
  slug: string;
}) {
  const pal = PALETTES[hash(slug) % PALETTES.length]!;
  const gid = `bc-${hash(slug).toString(36)}`;
  const lines = wrap(title);
  const eyebrow = (tags[0] ?? 'Builderforce.ai').toUpperCase();
  const chips = tags.slice(0, 3);

  return (
    <svg
      className="bpost-cover"
      viewBox="0 0 1200 360"
      role="img"
      aria-label={title}
      style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 16, margin: '8px 0 28px' }}
    >
      <defs>
        <linearGradient id={`${gid}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={pal.a} />
          <stop offset="1" stopColor={pal.b} />
        </linearGradient>
        <radialGradient id={`${gid}-glow`} cx="0.82" cy="0.25" r="0.6">
          <stop offset="0" stopColor={pal.accent} stopOpacity="0.35" />
          <stop offset="1" stopColor={pal.accent} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="1200" height="360" fill={`url(#${gid}-bg)`} />
      <rect width="1200" height="360" fill={`url(#${gid}-glow)`} />

      {/* Decorative node-graph motif (the platform's neural-mesh motif). */}
      <g stroke={pal.accent} strokeOpacity="0.5" strokeWidth="1.5" fill="none">
        <path d="M905,70 L1010,130 L965,230 L1080,255 L1010,130 M905,70 L965,230" />
      </g>
      <g fill={pal.accent}>
        <circle cx="905" cy="70" r="6" />
        <circle cx="1010" cy="130" r="8" />
        <circle cx="965" cy="230" r="6" />
        <circle cx="1080" cy="255" r="5" fillOpacity="0.8" />
      </g>

      {/* Accent rule + eyebrow */}
      <rect x="64" y="70" width="46" height="5" rx="2.5" fill={pal.accent} />
      <text x="124" y="78" fill={pal.accent} fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="20" fontWeight="700" letterSpacing="2">
        {eyebrow}
      </text>

      {/* Title */}
      <g fill="#FFFFFF" fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" fontWeight="800">
        {lines.map((ln, i) => (
          <text key={i} x="64" y={150 + i * 56} fontSize="46">
            {ln}
          </text>
        ))}
      </g>

      {/* Tag chips */}
      <ChipRow chips={chips} accent={pal.accent} y={328} />

      {/* Brand wordmark */}
      <text x="1136" y="334" textAnchor="end" fill="#FFFFFF" fillOpacity="0.7" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="18" fontWeight="700">
        {BRAND.name ?? 'Builderforce.ai'}
      </text>
    </svg>
  );
}

/** Lays out tag chips left-to-right with width proportional to label length. */
function ChipRow({ chips, accent, y }: { chips: string[]; accent: string; y: number }) {
  let x = 64;
  return (
    <g fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="18">
      {chips.map((t) => {
        const w = 22 + t.length * 10;
        const cx = x;
        x += w + 12;
        return (
          <g key={t}>
            <rect x={cx} y={y - 22} width={w} height={30} rx={15} fill="#ffffff" fillOpacity="0.08" stroke={accent} strokeOpacity="0.45" />
            <text x={cx + w / 2} y={y - 2} textAnchor="middle" fill="#DCE6F7">{t}</text>
          </g>
        );
      })}
    </g>
  );
}
