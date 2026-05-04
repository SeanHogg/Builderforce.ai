import type { ReactNode } from 'react';

export type CustomSvg = {
  viewBox: string;
  paths: { d: string; fill?: string; stroke?: string; strokeWidth?: number; strokeLinejoin?: string }[];
  defs?: { linearGradients?: { id: string; x1: string; y1: string; x2: string; y2: string; stops: { offset: string; color: string }[] }[] };
};

export type IconSpec =
  | { kind: 'simple'; path: string }
  | { kind: 'lucide'; svg: ReactNode }
  | { kind: 'custom'; svg: CustomSvg };

interface Props {
  icon: IconSpec;
  color: string;
  size?: number;
  label?: string;
}

export default function BrandIcon({ icon, color, size = 32, label }: Props) {
  if (icon.kind === 'simple') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-label={label} role={label ? 'img' : undefined}>
        <path d={icon.path} />
      </svg>
    );
  }
  if (icon.kind === 'lucide') {
    return (
      <span style={{ display: 'inline-flex', color, width: size, height: size }} aria-label={label} role={label ? 'img' : undefined}>
        {icon.svg}
      </span>
    );
  }
  // custom svg
  const c = icon.svg;
  return (
    <svg width={size} height={size} viewBox={c.viewBox} aria-label={label} role={label ? 'img' : undefined}>
      {c.defs?.linearGradients?.map((g) => (
        <defs key={g.id}>
          <linearGradient id={g.id} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
            {g.stops.map((s, i) => (
              <stop key={i} offset={s.offset} stopColor={s.color} />
            ))}
          </linearGradient>
        </defs>
      ))}
      {c.paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.fill ?? color}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          strokeLinejoin={p.strokeLinejoin as React.SVGProps<SVGPathElement>['strokeLinejoin']}
        />
      ))}
    </svg>
  );
}
