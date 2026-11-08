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
    /** Runs one pass (a no-op once done); true when every pass has run. */
    step(): boolean;
}

export function createRelaxation({ x, z, home, groups, springs, iterations }: RelaxInput): Relaxation {
    const n = x.length;
    let at = 0;
    return {
        step() {
            if (at >= iterations) return true;
            const cool = 1 - at / iterations;
            at++;
            const dx = new Float64Array(n);
            const dz = new Float64Array(n);
            for (const group of groups) {
                for (let a = 0; a < group.length; a++) {
                    for (let b = a + 1; b < group.length; b++) {
                        const i = group[a]!, j = group[b]!;
                        const ddx = x[i]! - x[j]!, ddz = z[i]! - z[j]!;
                        const d2 = Math.max(ddx * ddx + ddz * ddz, 0.01);
                        const f = 0.6 / d2;
                        dx[i]! += ddx * f; dz[i]! += ddz * f;
                        dx[j]! -= ddx * f; dz[j]! -= ddz * f;
                    }
                }
            }
            for (const [i, j] of springs) {
                const ddx = x[j]! - x[i]!, ddz = z[j]! - z[i]!;
                dx[i]! += ddx * 0.02; dz[i]! += ddz * 0.02;
                dx[j]! -= ddx * 0.02; dz[j]! -= ddz * 0.02;
            }
            for (let i = 0; i < n; i++) {
                const [hx, hz] = home[i]!;
                dx[i]! += (hx - x[i]!) * 0.05;
                dz[i]! += (hz - z[i]!) * 0.05;
                const len = Math.hypot(dx[i]!, dz[i]!);
                const cap = 0.8 * cool + 0.05;
                const s = len > cap ? cap / len : 1;
                x[i] = x[i]! + dx[i]! * s;
                z[i] = z[i]! + dz[i]! * s;
            }
            return at >= iterations;
        },
    };
}
