# Light theme → BurnRateOS cool slate

**Scope:** light mode only. Dark `:root` tokens unchanged.
**Source of truth:** `frontend/src/app/globals.css` → `html[data-theme='light']`.
VSIX webview imports the same `globals.css` (no duplicate palette).

## Key token mappings

| Token | Before (warm stock) | After (BurnRate-inspired) |
|-------|---------------------|---------------------------|
| `--bg-deep` | `#f4f1ec` | `#F1F5F9` |
| `--bg-surface` | `#fdfcfa` | `#F8FAFC` |
| `--bg-elevated` | `#ffffff` | `#FFFFFF` |
| `--text-primary` | `#1c1917` | `#0F172A` |
| `--text-secondary` | `#4f463d` | `#475569` |
| `--text-muted` | `#736961` | `#64748B` |
| `--coral-bright` (primary CTA) | `#1d4ed8` | `#2D60FF` |
| `--coral-mid` / `--coral-dark` | `#1e40af` / `#1e3a8a` | `#1E4ED8` / `#1E3A8A` |
| `--cyan-bright` / `--cyan-mid` (secondary) | sky `#0284c7` / `#0369a1` | indigo `#6366F1` / `#4F46E5` |
| `--indigo-bright` | `#4338ca` | `#6366F1` |
| borders / shadows | warm `rgba(60,48,36,…)` | cool `rgba(15,23,42,…)` |
| `--grad-brand` | blue→indigo dark | `#2D60FF` → `#6366F1` |

Also aligned: canvas light defaults in `CreationCanvas.module.css`, docs-site Starlight light tokens in `docs-site/src/styles/custom.css`.

## How to verify

1. Frontend: open app, toggle theme to **light** (`bf-theme` / theme control).
2. Confirm page ground is pale slate (not cream), cards white, headings `#0F172A`, CTAs vivid `#2D60FF`.
3. Toggle back to **dark** — deep space / cyan glow must look unchanged.
4. Canvas board: light mode board/panels use cool slate borders (not warm beige).
5. Docs site light mode (if built): accent `#2D60FF`, bg `#F1F5F9`.
6. VSIX webview inherits frontend tokens automatically after rebuild.

Do not commit from this agent; sync via `/workspace/burnrate-light-theme.tgz`.
