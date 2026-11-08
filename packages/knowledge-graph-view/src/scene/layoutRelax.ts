/**
 * The relaxation passes of the 3D layout as a steppable object, so a host can run a few passes per idle
 * callback instead of blocking the UI thread for all of them. One `step()` is one pass; the arithmetic is
 * the same whether the passes run together or spread out, so chunking never changes the coordinates.
 */

export interface RelaxInput {
    x: Float64Array;
    z: Float64Array;
    home: ReadonlyArray<readonly [number, number]>;
    /** Node indices per area: repulsion acts inside a group only. */
    groups: ReadonlyArray<readonly number[]>;
    springs: ReadonlyArray<readonly [number, number]>;
    iterations: number;
}

export interface Relaxation {
    /**
     * Runs the next slice of the current pass (a no-op once done); true when every pass has run. A pass is split only when its
     * repulsion work is large (one slice is at most {@link PAIR_BUDGET} pair interactions), so small layouts still take one step per pass.
     */
    step(): boolean;
}

/** Pair interactions per step: about 4 ms of repulsion. */
export const PAIR_BUDGET = 400_000;

export function createRelaxation({ x, z, home, groups, springs, iterations }: RelaxInput): Relaxation {
    const n = x.length;
    const homeX = new Float64Array(n), homeZ = new Float64Array(n);
    for (let i = 0; i < n; i++) { homeX[i] = home[i]![0]; homeZ[i] = home[i]![1]; }
    const from = new Int32Array(springs.length), to = new Int32Array(springs.length);
    springs.forEach(([i, j], k) => { from[k] = i; to[k] = j; });
    const dx = new Float64Array(n);
    const dz = new Float64Array(n);
    let at = 0;
    // Where the repulsion of the current pass stands: group `g`, row `row`.
    let g = 0, row = 0;
    return {
        step() {
            if (at >= iterations) return true;
            let work = 0;
            while (g < groups.length) {
                const group = groups[g]!;
                while (row < group.length) {
                    const i = group[row]!;
                    const xi = x[i]!, zi = z[i]!;
                    for (let b = row + 1; b < group.length; b++) {
                        const j = group[b]!;
                        const ddx = xi - x[j]!, ddz = zi - z[j]!;
                        const d2 = Math.max(ddx * ddx + ddz * ddz, 0.01);
                        const f = 0.6 / d2;
                        dx[i]! += ddx * f; dz[i]! += ddz * f;
                        dx[j]! -= ddx * f; dz[j]! -= ddz * f;
                    }
                    work += group.length - row - 1;
                    row++;
                    if (work >= PAIR_BUDGET) return false;
                }
                g++; row = 0;
            }
            const cool = 1 - at / iterations;
            at++;
            for (let k = 0; k < from.length; k++) {
                const i = from[k]!, j = to[k]!;
                const ddx = x[j]! - x[i]!, ddz = z[j]! - z[i]!;
                dx[i]! += ddx * 0.02; dz[i]! += ddz * 0.02;
                dx[j]! -= ddx * 0.02; dz[j]! -= ddz * 0.02;
            }
            for (let i = 0; i < n; i++) {
                dx[i]! += (homeX[i]! - x[i]!) * 0.05;
                dz[i]! += (homeZ[i]! - z[i]!) * 0.05;
                const len = Math.hypot(dx[i]!, dz[i]!);
                const cap = 0.8 * cool + 0.05;
                const s = len > cap ? cap / len : 1;
                x[i] = x[i]! + dx[i]! * s;
                z[i] = z[i]! + dz[i]! * s;
            }
            dx.fill(0); dz.fill(0);
            g = 0; row = 0;
            return at >= iterations;
        },
    };
}
