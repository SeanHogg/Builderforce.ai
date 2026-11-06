/** 512 B, 3.2 KB, 1.4 MB, 2.0 GB: whole bytes below a kilobyte, one decimal from there up. The ONE byte formatter of the view. */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const units = ['KB', 'MB', 'GB'];
    let v = bytes / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(1)} ${units[i]}`;
}
