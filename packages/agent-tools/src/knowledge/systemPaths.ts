/**
 * knowledge/systemPaths.ts — the root-relative path helpers systems detection and copy
 * detection share (PRD 41 A9). Paths are `/`-separated, with no leading or trailing slash.
 */

export const slash = (p: string): string => p.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
export const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
export const joinPath = (a: string, b: string): string => (a ? `${a}/${b}` : b);
/** Whether `path` is `folder` or inside it ('' is every path's folder). */
export const within = (path: string, folder: string): boolean => folder === '' || path === folder || path.startsWith(`${folder}/`);
export const rel = (path: string, folder: string): string => (folder === '' ? path : path.slice(folder.length + 1));
export const depth = (p: string): number => (p === '' ? 0 : p.split('/').length);
export const byDepthThenPath = (a: string, b: string): number => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0);
