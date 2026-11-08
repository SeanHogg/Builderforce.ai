import{l as $,j as I,h as W,g as P,f as z,e as S,m as de,d as Q,s as gt,r as ie,q as Gt,n as Kr,v as Kt,u as ge,o as Ut,A as Ur,L as Vr,p as ye,B as Vt,E as Xt,w as tt,S as ve,x as Yt,y as Qt,z as Xr,C as Yr,D as Qr,F as Ae,G as mt,H as Pe,I as Zt,J as Jt,K as _e,M as pt,N as Zr,R as rt,O as Jr,P as en,Q as Le,V as tn,T as er,U as tr,W as rn,X as nn,Y as _t,Z as an,t as on,_ as sn,$ as dn,a0 as ce,a1 as We,a2 as ln,a3 as cn,a4 as un,a5 as hn,a6 as fn,a7 as gn,a8 as Se,a9 as rr,aa as nt,ab as mn,ac as nr,ad as pn,ae as _n,af as bn,ag as ar,ah as ir}from"./chunk-falcon_mamba.js";import{ai as Ts,aj as Bs,ak as Is,al as Ws,am as $s,an as js,ao as Rs,ap as zs,b as Os,c as Hs,aq as qs,ar as Gs,as as Ks,at as Us,au as Vs,av as Xs,aw as Ys,ax as Qs,ay as Zs,az as Js,aA as ed,aB as td,aC as rd,aD as nd,aE as ad,aF as id,aG as od,aH as sd,a as dd,aI as ld,aJ as cd,i as ud,aK as hd,aL as fd,aM as gd,aN as md,aO as pd,aP as _d,aQ as bd,aR as wd,aS as yd,aT as vd,aU as xd,k as kd}from"./chunk-falcon_mamba.js";const bt=`

// ---- Binding layout ----
// group 0: sequence data
// group 1: SSM parameters

struct ScanParams {
    seq_len   : u32,   // L  – sequence length
    d_state   : u32,   // N  – state dimension
    d_inner   : u32,   // D  – inner (expanded) channel dimension
    batch     : u32,   // B  – batch size
};

@group(0) @binding(0) var<uniform>             params   : ScanParams;
// u (B, L, D)  – projected input after conv
@group(0) @binding(1) var<storage, read>       u        : array<f32>;
// delta (B, L, D) – time-step (Δ) after softplus
@group(0) @binding(2) var<storage, read>       delta    : array<f32>;
// A (D, N)  – log-space diagonal state matrix (fixed, learned)
@group(0) @binding(3) var<storage, read>       A        : array<f32>;
// B (B, L, N) – input projection (selective)
@group(0) @binding(4) var<storage, read>       B        : array<f32>;
// C (B, L, N) – output projection (selective)
@group(0) @binding(5) var<storage, read>       C        : array<f32>;
// D (D,) – skip-connection scale
@group(0) @binding(6) var<storage, read>       D_vec    : array<f32>;
// y (B, L, D) – output (written by this kernel)
@group(0) @binding(7) var<storage, read_write> y        : array<f32>;
// h_cache (B, L, D*N) – hidden states cache (for backward pass)
@group(0) @binding(8) var<storage, read_write> h_cache  : array<f32>;

// ---- Workgroup shared memory ----
// Each workgroup processes one (batch, channel) slice across all time steps.
// We store the associative pair (a_bar, bu_bar) per time step so we can run
// a Kogge-Stone scan across the workgroup tile.
var<workgroup> wg_a  : array<f32, 256>;   // discretised A values
var<workgroup> wg_bu : array<f32, 256>;   // B*u values

// ---- Helpers ----

// Softplus: numerically stable softplus(x) = log(1 + exp(x))
fn softplus(x: f32) -> f32 {
    // Numerically stable: max(x,0) + log1p(exp(-|x|)). The naive log(1+exp(x))
    // overflows to +Inf for x ≳ 88 (f32 exp range); this form never does. (EVM-8)
    return max(x, 0.0) + log(1.0 + exp(-abs(x)));
}

// ZerO-Order Hold discretisation of continuous A, Δ:
//   A_bar = exp(Δ * A)
//   B_bar = (A_bar - 1) / A * B  ≈  Δ * B  (first-order for simplicity)
fn discretise_A(delta_val: f32, a_log: f32) -> f32 {
    // A is stored as -exp(a_log) to ensure A_bar < 1 (stable)
    // Clamp log-decay so -exp(a_log) can't overflow to -Inf (A_bar→0, state
    // death) nor collapse toward 0 (A_bar→1, no decay). Keeps A_bar strictly in
    // (0,1) across repeated adapts. Belt-and-suspenders: WSLA also freezes A_log.
    let a_cont = -exp(clamp(a_log, -10.0, 5.0));
    return exp(delta_val * a_cont);
}

fn discretise_B(delta_val: f32, a_log: f32, b_val: f32) -> f32 {
    let a_cont  = -exp(clamp(a_log, -10.0, 5.0));
    let a_bar   = exp(delta_val * a_cont);
    // (A_bar - 1) / A_cont * B
    let b_bar   = (a_bar - 1.0) / a_cont * b_val;
    return b_bar;
}

// ---- Main kernel ----
// Dispatch: (ceil(D/8), ceil(N/8), B)
// Each invocation is responsible for one (d, n, batch) triplet and scans
// the entire sequence using a two-pass Kogge-Stone scan within workgroup tiles.

@compute @workgroup_size(64, 1, 1)
fn forward_scan(
    @builtin(global_invocation_id)   gid  : vec3<u32>,
    @builtin(local_invocation_index) lid  : u32,
    @builtin(workgroup_id)           wgid : vec3<u32>,
) {
    let L = params.seq_len;
    let N = params.d_state;
    let D = params.d_inner;
    let B = params.batch;

    // Each workgroup handles one (batch b, channel d, state n) combination.
    // We pack d and n into the x dimension: global d = wgid.x, global n = wgid.y
    let d = wgid.x;
    let n = wgid.y;
    let b = gid.z;

    if (d >= D || n >= N || b >= B) { return; }

    // Tile size equals workgroup size (64).  We process TILE_SIZE steps at once.
    let TILE: u32 = 64u;

    // Running state h for this (b, d, n)
    var h: f32 = 0.0;

    var tile_start: u32 = 0u;
    loop {
        if (tile_start >= L) { break; }

        let t = tile_start + lid;      // absolute time step handled by this lane
        var a_bar: f32 = 1.0;
        var bu:    f32 = 0.0;

        if (t < L) {
            // Indices
            let delta_idx = b * L * D + t * D + d;
            let u_idx     = b * L * D + t * D + d;
            let A_idx     = d * N + n;
            let B_idx     = b * L * N + t * N + n;

            let dv = softplus(delta[delta_idx]);
            a_bar  = discretise_A(dv, A[A_idx]);
            bu     = discretise_B(dv, A[A_idx], B[B_idx]) * u[u_idx];
        }

        wg_a[lid]  = a_bar;
        wg_bu[lid] = bu;
        workgroupBarrier();

        // ---- Kogge-Stone inclusive prefix scan within tile ----
        // Associative operator: (a1, b1) ∘ (a2, b2) = (a1*a2, a1*b2 + b1)
        // This computes cumulative state recurrence in log2(TILE) steps.
        // NOTE the barrier placement. Both barriers MUST sit in uniform control
        // flow — every invocation in the workgroup has to reach them. The earlier
        // version put the first workgroupBarrier() INSIDE the if (lid >= stride)
        // branch, which is a WGSL uniformity violation: shader creation fails on a
        // conformant implementation. Computing into locals first, then writing
        // back after a uniform barrier, is the correct read-then-write split.
        var stride: u32 = 1u;
        loop {
            if (stride >= TILE) { break; }
            var new_a  = wg_a[lid];
            var new_bu = wg_bu[lid];
            if (lid >= stride) {
                // Combine: new_a  = prev_a * cur_a (product of A_bars)
                //          new_bu = prev_a * cur_bu + prev_bu
                new_a  = wg_a[lid - stride] * new_a;
                new_bu = wg_a[lid - stride] * new_bu + wg_bu[lid - stride];
            }
            workgroupBarrier();
            wg_a[lid]  = new_a;
            wg_bu[lid] = new_bu;
            workgroupBarrier();
            stride = stride << 1u;
        }

        // Incorporate the carry-in state from the previous tile.
        // After the scan wg_bu[lid] holds the intra-tile inclusive sum.
        // The actual h at position t = h_carry * wg_a[lid] + wg_bu[lid]
        let h_t = h * wg_a[lid] + wg_bu[lid];

        if (t < L) {
            // Cache hidden state for backward pass
            let h_idx = b * L * D * N + t * D * N + d * N + n;
            h_cache[h_idx] = h_t;

            // Accumulate y contribution: y_t += C_t[n] * h_t  (over all n)
            // We use an atomic-style accumulation: each (d, n) lane adds its
            // contribution to the same y[b, t, d].  This races without atomics,
            // so we instead write to a full h_cache and reduce in a second pass.
            // Here we perform direct accumulation using atomicAdd approximation:
            // (safe because each lane writes a unique n, which is stride 1 in mem)
            let C_idx = b * L * N + t * N + n;
            let y_idx = b * L * D + t * D + d;

            // Direct write for n == 0 (first state dim), add for the rest.
            // Since all workgroups for the same (b,d) run concurrently we must
            // accumulate safely: we write each partial into h_cache and reduce
            // in a subsequent lightweight kernel (forward_reduce).
            // (For simplicity and correctness here we directly atomically add via
            //  f32 emulation – real deployment uses atomicAdd on f32 with spirv ext.)
            // We store C*h contribution separately so forward_reduce can sum them.
            // Layout: y_partial (B, L, D, N) – one slot per state dim
            // y reused as y_partial in this kernel; forward_reduce collapses N dim.
            let y_partial_idx = b * L * D * N + t * D * N + d * N + n;
            // Reuse h_cache second half as y_partial (offset by B*L*D*N)
            let offset = B * L * D * N;
            h_cache[offset + y_partial_idx] = C[C_idx] * h_t;
        }

        // Update carry: last lane's h_t is the tile's final state
        let last = min(TILE, L - tile_start) - 1u;
        h = wg_a[last] * h + wg_bu[last];   // recombine carry

        workgroupBarrier();
        tile_start = tile_start + TILE;
    }
}

// ---- Reduction kernel ----
// Collapses the N (d_state) dimension of y_partial into y.
// Adds the D (skip connection) term: y_t[d] += D_vec[d] * u_t[d]
// Dispatch: (ceil(L/64), D, B)

@compute @workgroup_size(64, 1, 1)
fn forward_reduce(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let L = params.seq_len;
    let N = params.d_state;
    let D = params.d_inner;
    let B = params.batch;

    let t = gid.x;
    let d = gid.y;
    let b = gid.z;

    if (t >= L || d >= D || b >= B) { return; }

    let offset    = B * L * D * N;
    var sum: f32  = 0.0;
    for (var n: u32 = 0u; n < N; n = n + 1u) {
        let idx = offset + b * L * D * N + t * D * N + d * N + n;
        sum = sum + h_cache[idx];
    }

    // Add skip connection
    let u_idx = b * L * D + t * D + d;
    sum = sum + D_vec[d] * u[u_idx];

    let y_idx = b * L * D + t * D + d;
    y[y_idx] = sum;
}
`,Ao=`

struct ScanParams {
    seq_len  : u32,
    d_state  : u32,
    d_inner  : u32,
    batch    : u32,
};

@group(0) @binding(0) var<uniform>             params    : ScanParams;
@group(0) @binding(1) var<storage, read>       u         : array<f32>;
@group(0) @binding(2) var<storage, read>       delta     : array<f32>;
@group(0) @binding(3) var<storage, read>       A         : array<f32>;
@group(0) @binding(4) var<storage, read>       B         : array<f32>;
@group(0) @binding(5) var<storage, read>       C         : array<f32>;
@group(0) @binding(6) var<storage, read>       h_cache   : array<f32>;
@group(0) @binding(7) var<storage, read>       dy        : array<f32>;  // upstream gradient
@group(0) @binding(8) var<storage, read_write> dA        : array<f32>;
@group(0) @binding(9) var<storage, read_write> dB        : array<f32>;
@group(0) @binding(10) var<storage, read_write> dC       : array<f32>;
@group(0) @binding(11) var<storage, read_write> dDelta   : array<f32>;
@group(0) @binding(12) var<storage, read_write> du       : array<f32>;

fn softplus(x: f32) -> f32 {
    // Numerically stable: max(x,0) + log1p(exp(-|x|)). The naive log(1+exp(x))
    // overflows to +Inf for x ≳ 88 (f32 exp range); this form never does. (EVM-8)
    return max(x, 0.0) + log(1.0 + exp(-abs(x)));
}

fn softplus_grad(x: f32) -> f32 {
    // d/dx softplus(x) = sigmoid(x)
    return 1.0 / (1.0 + exp(-x));
}

fn discretise_A(delta_val: f32, a_log: f32) -> f32 {
    // Clamp log-decay so -exp(a_log) can't overflow to -Inf (A_bar→0, state
    // death) nor collapse toward 0 (A_bar→1, no decay). Keeps A_bar strictly in
    // (0,1) across repeated adapts. Belt-and-suspenders: WSLA also freezes A_log.
    let a_cont = -exp(clamp(a_log, -10.0, 5.0));
    return exp(delta_val * a_cont);
}

// Reverse scan (backward pass) – processes time from T-1 down to 0.
// Dispatch: (D, N, B)
@compute @workgroup_size(1, 1, 1)
fn backward_scan(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let L = params.seq_len;
    let N = params.d_state;
    let D = params.d_inner;
    let B = params.batch;

    let d = gid.x;
    let n = gid.y;
    let b = gid.z;

    if (d >= D || n >= N || b >= B) { return; }

    var dh: f32 = 0.0;   // gradient of loss w.r.t. h_t, accumulated backwards

    var t: u32 = L;
    loop {
        if (t == 0u) { break; }
        t = t - 1u;

        let delta_raw_idx = b * L * D + t * D + d;
        let A_idx         = d * N + n;
        let B_idx         = b * L * N + t * N + n;
        let C_idx         = b * L * N + t * N + n;
        let u_idx         = b * L * D + t * D + d;
        let h_idx         = b * L * D * N + t * D * N + d * N + n;

        let delta_raw = delta[delta_raw_idx];
        let dv        = softplus(delta_raw);
        let a_log     = A[A_idx];
        let a_cont    = -exp(a_log);
        let a_bar     = exp(dv * a_cont);
        let b_val     = B[B_idx];
        let c_val     = C[C_idx];
        let u_val     = u[u_idx];
        let h_t       = h_cache[h_idx];

        // dy_t contribution to dh (from C * h_t in the output)
        // y_t[d] = sum_n C[n] * h_t[n] + D * u   =>  dh_t[n] += C[n] * dy_t[d]
        let dy_val = dy[b * L * D + t * D + d];
        dh = dh + c_val * dy_val;

        // dC[b, t, n] += dy_t[d] * h_t
        dC[C_idx] = dC[C_idx] + dy_val * h_t;

        // h_t = a_bar * h_{t-1} + b_bar * u_t
        // b_bar = (a_bar - 1) / a_cont * b_val
        let b_bar  = (a_bar - 1.0) / a_cont * b_val;
        let h_prev = (t > 0u) ? h_cache[b * L * D * N + (t - 1u) * D * N + d * N + n] : 0.0;

        // dh_{t-1} += a_bar * dh_t
        // (accumulated in next iteration; here dh already contains upstream)
        let dh_cur = dh;

        // dA[d,n] += dh_t * (d a_bar/d a_cont) * (d a_cont/d a_log) * h_{t-1}
        //          + dh_t * (d b_bar/d a_cont) * ... * b_val * u_val
        // d(a_bar)/d(a_log) = a_bar * (-exp(a_log)) * dv = a_bar * a_cont * dv
        let da_bar_da_log = a_bar * a_cont * dv;
        dA[A_idx] = dA[A_idx] + dh_cur * (da_bar_da_log * h_prev);

        // dB[b,t,n] += dh_t * b_bar / b_val * u_val  (since b_bar is linear in b)
        dB[B_idx] = dB[B_idx] + dh_cur * ((a_bar - 1.0) / a_cont) * u_val;

        // du[b,t,d] += dh_t * b_bar  (accumulate over n in separate kernel)
        du[u_idx] = du[u_idx] + dh_cur * b_bar;

        // dDelta[b,t,d]: chain rule through softplus and discretisation
        // d(b_bar)/d(dv) = d/d(dv)[(a_bar-1)/a_cont * b] = a_bar * b / (a_cont ... )
        //  actually: d(a_bar)/d(dv) = a_bar * a_cont,  d(b_bar)/d(dv) = a_bar * b_val
        let da_bar_ddv  = a_bar * a_cont;
        let db_bar_ddv  = a_bar * b_val;
        let dLoss_ddv   = dh_cur * (da_bar_ddv * h_prev + db_bar_ddv * u_val);
        let ddv_ddelta  = softplus_grad(delta_raw);
        dDelta[delta_raw_idx] = dDelta[delta_raw_idx] + dLoss_ddv * ddv_ddelta;

        // Propagate dh to previous timestep
        dh = a_bar * dh_cur;
    }
}
`,at=`

struct ConvParams {
    seq_len     : u32,   // L
    d_channels  : u32,   // D (number of depthwise channels in this call)
    kernel_size : u32,   // K (typically 4)
    batch       : u32,   // B
    groups      : u32,   // number of channel groups (1 = standard depthwise)
};

@group(0) @binding(0) var<uniform>             params   : ConvParams;
// x      (B, L, D) – input
@group(0) @binding(1) var<storage, read>       x        : array<f32>;
// weight (D, K)    – depthwise conv weights
@group(0) @binding(2) var<storage, read>       weight   : array<f32>;
// bias   (D,)      – optional bias (zeros if unused)
@group(0) @binding(3) var<storage, read>       bias     : array<f32>;
// y      (B, L, D) – output
@group(0) @binding(4) var<storage, read_write> y        : array<f32>;

// Dispatch: (ceil(L/16), ceil(D/16), B)
@compute @workgroup_size(16, 16, 1)
fn conv1d_forward(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let L  = params.seq_len;
    let D  = params.d_channels;
    let K  = params.kernel_size;
    let B  = params.batch;

    let t  = gid.x;   // time position
    let d  = gid.y;   // channel
    let b  = gid.z;   // batch

    if (t >= L || d >= D || b >= B) { return; }

    var acc: f32 = 0.0;

    // Causal: convolve over k = 0..K-1, reading position (t - k)
    for (var k: u32 = 0u; k < K; k = k + 1u) {
        let w_idx = d * K + k;
        let w_val = weight[w_idx];

        // t - k: use causal zero-padding for t < k
        if (t >= k) {
            let src = b * L * D + (t - k) * D + d;
            acc = acc + w_val * x[src];
        }
        // else: zero-padding contributes 0
    }

    acc = acc + bias[d];

    let out = b * L * D + t * D + d;
    y[out] = acc;
}
`,Mo=`

struct ConvParams {
    seq_len     : u32,
    d_channels  : u32,
    kernel_size : u32,
    batch       : u32,
};

@group(0) @binding(0) var<uniform>              params   : ConvParams;
@group(0) @binding(1) var<storage, read>        x        : array<f32>;
@group(0) @binding(2) var<storage, read>        weight   : array<f32>;
@group(0) @binding(3) var<storage, read>        dy       : array<f32>;
@group(0) @binding(4) var<storage, read_write>  dx       : array<f32>;
@group(0) @binding(5) var<storage, read_write>  dweight  : array<f32>;
@group(0) @binding(6) var<storage, read_write>  dbias    : array<f32>;

// Dispatch: (ceil(L/16), ceil(D/16), B) – computes dx
@compute @workgroup_size(16, 16, 1)
fn conv1d_backward_dx(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let L  = params.seq_len;
    let D  = params.d_channels;
    let K  = params.kernel_size;
    let B  = params.batch;

    let t  = gid.x;
    let d  = gid.y;
    let b  = gid.z;

    if (t >= L || d >= D || b >= B) { return; }

    var grad: f32 = 0.0;

    // dx[b, t, d] = sum_{k=0}^{K-1} dy[b, t+k, d] * weight[d, k]
    for (var k: u32 = 0u; k < K; k = k + 1u) {
        let tp = t + k;
        if (tp < L) {
            let dy_idx = b * L * D + tp * D + d;
            let w_idx  = d * K + k;
            grad = grad + dy[dy_idx] * weight[w_idx];
        }
    }

    let dx_idx = b * L * D + t * D + d;
    dx[dx_idx] = grad;
}

// Dispatch: (K, D, 1) – accumulates dweight over (B, L)
@compute @workgroup_size(1, 1, 1)
fn conv1d_backward_dw(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let L  = params.seq_len;
    let D  = params.d_channels;
    let K  = params.kernel_size;
    let B  = params.batch;

    let k  = gid.x;
    let d  = gid.y;

    if (k >= K || d >= D) { return; }

    var grad_w: f32 = 0.0;
    var grad_b: f32 = 0.0;

    for (var b: u32 = 0u; b < B; b = b + 1u) {
        for (var t: u32 = 0u; t < L; t = t + 1u) {
            let dy_idx = b * L * D + t * D + d;
            let dy_val = dy[dy_idx];
            if (t >= k) {
                let x_idx = b * L * D + (t - k) * D + d;
                grad_w = grad_w + dy_val * x[x_idx];
            }
            if (k == 0u) {
                grad_b = grad_b + dy_val;
            }
        }
    }

    dweight[d * K + k] = grad_w;
    if (k == 0u) {
        dbias[d] = grad_b;
    }
}
`,xe=`

struct LinearParams {
    M : u32,   // number of rows    (batch * seq_len)
    K : u32,   // in_features
    N : u32,   // out_features
};

@group(0) @binding(0) var<uniform>             params : LinearParams;
@group(0) @binding(1) var<storage, read>       X      : array<f32>;   // (M, K)
@group(0) @binding(2) var<storage, read>       W      : array<f32>;   // (N, K)
@group(0) @binding(3) var<storage, read>       bias   : array<f32>;   // (N,)
@group(0) @binding(4) var<storage, read_write> Y      : array<f32>;   // (M, N)

// Tiled matmul using workgroup shared memory (16x16 tiles)
var<workgroup> tile_X : array<f32, 256>;  // 16 * 16
var<workgroup> tile_W : array<f32, 256>;

@compute @workgroup_size(16, 16, 1)
fn linear_forward(
    @builtin(global_invocation_id)   gid : vec3<u32>,
    @builtin(local_invocation_id)    lid : vec3<u32>,
    @builtin(workgroup_id)           wid : vec3<u32>,
) {
    let M = params.M;
    let K = params.K;
    let N = params.N;

    let row = gid.x;   // output row (M dimension)
    let col = gid.y;   // output col (N dimension)

    var acc: f32 = 0.0;
    let TILE: u32 = 16u;
    let num_tiles = (K + TILE - 1u) / TILE;

    for (var tile_idx: u32 = 0u; tile_idx < num_tiles; tile_idx = tile_idx + 1u) {
        // Load X tile: shape (TILE_M, TILE_K)
        let x_col = tile_idx * TILE + lid.y;
        let x_row = wid.x * TILE + lid.x;
        if (x_row < M && x_col < K) {
            tile_X[lid.x * TILE + lid.y] = X[x_row * K + x_col];
        } else {
            tile_X[lid.x * TILE + lid.y] = 0.0;
        }

        // Load W tile: shape (TILE_N, TILE_K)  — W is (N, K)
        let w_col = tile_idx * TILE + lid.x;  // K dimension
        let w_row = wid.y * TILE + lid.y;     // N dimension
        if (w_row < N && w_col < K) {
            tile_W[lid.y * TILE + lid.x] = W[w_row * K + w_col];
        } else {
            tile_W[lid.y * TILE + lid.x] = 0.0;
        }

        workgroupBarrier();

        // Dot product within tile
        for (var k: u32 = 0u; k < TILE; k = k + 1u) {
            acc = acc + tile_X[lid.x * TILE + k] * tile_W[lid.y * TILE + k];
        }
        workgroupBarrier();
    }

    if (row < M && col < N) {
        Y[row * N + col] = acc + bias[col];
    }
}
`,Lo=`

struct LinearParams {
    M : u32,
    K : u32,
    N : u32,
};

@group(0) @binding(0) var<uniform>             params : LinearParams;
@group(0) @binding(1) var<storage, read>       X      : array<f32>;   // (M, K)
@group(0) @binding(2) var<storage, read>       W      : array<f32>;   // (N, K)
@group(0) @binding(3) var<storage, read>       dY     : array<f32>;   // (M, N)
@group(0) @binding(4) var<storage, read_write> dX     : array<f32>;   // (M, K)
@group(0) @binding(5) var<storage, read_write> dW     : array<f32>;   // (N, K)
@group(0) @binding(6) var<storage, read_write> db     : array<f32>;   // (N,)

// Dispatch: (ceil(M/16), ceil(K/16), 1)  – computes dX = dY @ W
var<workgroup> tile_dY : array<f32, 256>;
var<workgroup> tile_W  : array<f32, 256>;

@compute @workgroup_size(16, 16, 1)
fn linear_backward_dX(
    @builtin(global_invocation_id) gid : vec3<u32>,
    @builtin(local_invocation_id)  lid : vec3<u32>,
    @builtin(workgroup_id)         wid : vec3<u32>,
) {
    let M = params.M;
    let K = params.K;
    let N = params.N;

    let row = gid.x;   // M
    let col = gid.y;   // K

    var acc: f32 = 0.0;
    let TILE: u32 = 16u;
    let num_tiles = (N + TILE - 1u) / TILE;

    for (var tile_idx: u32 = 0u; tile_idx < num_tiles; tile_idx = tile_idx + 1u) {
        // tile_dY: (M, TILE_N) slice
        let dy_col = tile_idx * TILE + lid.y;
        let dy_row = wid.x * TILE + lid.x;
        if (dy_row < M && dy_col < N) {
            tile_dY[lid.x * TILE + lid.y] = dY[dy_row * N + dy_col];
        } else {
            tile_dY[lid.x * TILE + lid.y] = 0.0;
        }

        // tile_W: (TILE_N, K) slice  — W[n, k]
        let w_row = tile_idx * TILE + lid.x;   // N
        let w_col = wid.y * TILE + lid.y;      // K
        if (w_row < N && w_col < K) {
            tile_W[lid.x * TILE + lid.y] = W[w_row * K + w_col];
        } else {
            tile_W[lid.x * TILE + lid.y] = 0.0;
        }

        workgroupBarrier();

        for (var n: u32 = 0u; n < TILE; n = n + 1u) {
            acc = acc + tile_dY[lid.x * TILE + n] * tile_W[n * TILE + lid.y];
        }
        workgroupBarrier();
    }

    if (row < M && col < K) {
        dX[row * K + col] = acc;
    }
}

// Dispatch: (ceil(N/16), ceil(K/16), 1)  – computes dW = dY^T @ X
var<workgroup> tile_dY2 : array<f32, 256>;
var<workgroup> tile_X2  : array<f32, 256>;

@compute @workgroup_size(16, 16, 1)
fn linear_backward_dW(
    @builtin(global_invocation_id) gid : vec3<u32>,
    @builtin(local_invocation_id)  lid : vec3<u32>,
    @builtin(workgroup_id)         wid : vec3<u32>,
) {
    let M = params.M;
    let K = params.K;
    let N = params.N;

    let row = gid.x;   // N
    let col = gid.y;   // K

    var acc: f32 = 0.0;
    let TILE: u32 = 16u;
    let num_tiles = (M + TILE - 1u) / TILE;

    for (var tile_idx: u32 = 0u; tile_idx < num_tiles; tile_idx = tile_idx + 1u) {
        // dY^T tile: [N, M] accessed as dY[m, n]
        let m_idx = tile_idx * TILE + lid.y;
        let n_idx = wid.x * TILE + lid.x;
        if (n_idx < N && m_idx < M) {
            tile_dY2[lid.x * TILE + lid.y] = dY[m_idx * N + n_idx];
        } else {
            tile_dY2[lid.x * TILE + lid.y] = 0.0;
        }

        // X tile: [M, K]
        let xm = tile_idx * TILE + lid.x;
        let xk = wid.y * TILE + lid.y;
        if (xm < M && xk < K) {
            tile_X2[lid.x * TILE + lid.y] = X[xm * K + xk];
        } else {
            tile_X2[lid.x * TILE + lid.y] = 0.0;
        }

        workgroupBarrier();

        for (var m: u32 = 0u; m < TILE; m = m + 1u) {
            acc = acc + tile_dY2[lid.x * TILE + m] * tile_X2[m * TILE + lid.y];
        }
        workgroupBarrier();
    }

    if (row < N && col < K) {
        dW[row * K + col] = acc;
    }
}

// Dispatch: (N, 1, 1) – accumulates db = sum_M dY
@compute @workgroup_size(64, 1, 1)
fn linear_backward_db(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let M = params.M;
    let N = params.N;

    let n = gid.x;
    if (n >= N) { return; }

    var acc: f32 = 0.0;
    for (var m: u32 = 0u; m < M; m = m + 1u) {
        acc = acc + dY[m * N + n];
    }
    db[n] = acc;
}
`,me=`

struct ActParams {
    num_elements : u32,
};

@group(0) @binding(0) var<uniform>             p    : ActParams;
@group(0) @binding(1) var<storage, read>       x    : array<f32>;
@group(0) @binding(2) var<storage, read_write> y    : array<f32>;

// SiLU(x) = x * sigmoid(x)
@compute @workgroup_size(256, 1, 1)
fn silu_forward(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let i = gid.x;
    if (i >= p.num_elements) { return; }
    let v = x[i];
    y[i] = v / (1.0 + exp(-v));
}

// RMSNorm forward:  y = x / rms(x) * weight
// Requires separate uniform for rms norm params.
struct RMSNormParams {
    num_rows  : u32,   // number of vectors (batch * seq_len)
    dim       : u32,   // feature dimension
    eps       : f32,
};

@group(0) @binding(0) var<uniform>             rms_p    : RMSNormParams;
@group(0) @binding(1) var<storage, read>       rms_x    : array<f32>;
@group(0) @binding(2) var<storage, read>       rms_w    : array<f32>;   // scale (dim,)
@group(0) @binding(3) var<storage, read_write> rms_y    : array<f32>;
@group(0) @binding(4) var<storage, read_write> rms_inv  : array<f32>;   // cache 1/rms per row

@compute @workgroup_size(64, 1, 1)
fn rmsnorm_forward(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let row = gid.x;
    if (row >= rms_p.num_rows) { return; }

    let D = rms_p.dim;
    let base = row * D;

    var sq_sum: f32 = 0.0;
    for (var i: u32 = 0u; i < D; i = i + 1u) {
        let v = rms_x[base + i];
        sq_sum = sq_sum + v * v;
    }
    let inv_rms = 1.0 / sqrt(sq_sum / f32(D) + rms_p.eps);
    rms_inv[row] = inv_rms;

    for (var i: u32 = 0u; i < D; i = i + 1u) {
        rms_y[base + i] = rms_x[base + i] * inv_rms * rms_w[i];
    }
}
`,So=`
struct SoftmaxParams {
    rows    : u32,   // L
    cols    : u32,   // L
    causal  : u32,   // 1 = apply causal mask, 0 = full softmax
};

@group(0) @binding(0) var<uniform>             sp   : SoftmaxParams;
@group(0) @binding(1) var<storage, read_write> data : array<f32>;

@compute @workgroup_size(1, 1, 1)
fn softmax_forward_simple(@builtin(global_invocation_id) gid: vec3<u32>) {
    let row  = gid.x;
    let head = gid.y;
    let bat  = gid.z;

    if (row >= sp.rows) { return; }

    let L    = sp.cols;
    let base = bat * sp.rows * L + head * L * L + row * L;
    let lim  = select(L, row + 1u, sp.causal == 1u);

    var max_val = -1e38;
    for (var c = 0u; c < lim; c = c + 1u) {
        if (data[base + c] > max_val) { max_val = data[base + c]; }
    }

    var sum_exp = 0.0;
    for (var c = 0u; c < lim; c = c + 1u) {
        let e = exp(data[base + c] - max_val);
        data[base + c] = e;
        sum_exp = sum_exp + e;
    }

    let inv = 1.0 / (sum_exp + 1e-12);
    for (var c = 0u; c < lim; c = c + 1u) {
        data[base + c] = data[base + c] * inv;
    }
    // Zero out masked positions
    for (var c = lim; c < L; c = c + 1u) {
        data[base + c] = 0.0;
    }
}
`,Do=`
struct SoftmaxParams {
    rows    : u32,
    cols    : u32,
    causal  : u32,
};

@group(0) @binding(0) var<uniform>            sp  : SoftmaxParams;
@group(0) @binding(1) var<storage, read>      p   : array<f32>;   // post-softmax probs
@group(0) @binding(2) var<storage, read>      dp  : array<f32>;   // upstream gradient
@group(0) @binding(3) var<storage, read_write> dx : array<f32>;   // output gradient

@compute @workgroup_size(1, 1, 1)
fn softmax_backward(@builtin(global_invocation_id) gid: vec3<u32>) {
    let row  = gid.x;
    let head = gid.y;
    let bat  = gid.z;

    if (row >= sp.rows) { return; }

    let L    = sp.cols;
    let base = bat * sp.rows * L + head * L * L + row * L;
    let lim  = select(L, row + 1u, sp.causal == 1u);

    // dot = sum_i p[i] * dp[i]
    var dot = 0.0;
    for (var i = 0u; i < lim; i = i + 1u) {
        dot = dot + p[base + i] * dp[base + i];
    }

    for (var i = 0u; i < lim; i = i + 1u) {
        dx[base + i] = p[base + i] * (dp[base + i] - dot);
    }
}
`,Eo=`

struct ActParams {
    num_elements : u32,
};

@group(0) @binding(0) var<uniform>            p   : ActParams;
@group(0) @binding(1) var<storage, read>      x   : array<f32>;
@group(0) @binding(2) var<storage, read>      dy  : array<f32>;
@group(0) @binding(3) var<storage, read_write> dx : array<f32>;

// d/dx [x * sigmoid(x)] = sigmoid(x) + x * sigmoid(x) * (1 - sigmoid(x))
//                        = silu(x)/x  + sigmoid(x) * (1 - sigmoid(x)) * x
//                        simplified:  sigmoid(x) * (1 + x*(1 - sigmoid(x)))
@compute @workgroup_size(256, 1, 1)
fn silu_backward(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let i = gid.x;
    if (i >= p.num_elements) { return; }
    let v   = x[i];
    let sig = 1.0 / (1.0 + exp(-v));
    dx[i] = dy[i] * sig * (1.0 + v * (1.0 - sig));
}
`,Ce=`
struct SliceParams {
    rows   : u32,
    stride : u32,   // source row width
    offset : u32,   // first column to take
    width  : u32,   // number of columns to take
};
@group(0) @binding(0) var<uniform>             p   : SliceParams;
@group(0) @binding(1) var<storage, read>       src : array<f32>;
@group(0) @binding(2) var<storage, read_write> dst : array<f32>;

// Dispatch: (ceil(rows * width / 256), 1, 1)
@compute @workgroup_size(256)
fn col_slice(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= p.rows * p.width) { return; }
    let r = i / p.width;
    let c = i % p.width;
    dst[i] = src[r * p.stride + p.offset + c];
}
`,Fe="col_slice";function Y(r,e,t,a,n,i,o,d){const s=$(r,new Uint32Array([n,i,o,d]).buffer),u=I(r,e,[s,t,a]);W(r,e,u,[P(n*d,256),1,1]),s.destroy()}const wn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,yn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class vn{layerType="mamba1";device;config;dInner;dtRank;wInProj;bInProj;wConv;bConv;wXProj;bXProj;wDtProj;bDtProj;A_log;D_vec;wOutProj;bOutProj;normWeight;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(t.dModel/16),...t};const{dModel:a,expand:n}=this.config;this.dInner=n*a,this.dtRank=t.dtRank??Math.ceil(a/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:a}=this.config,n=this.dInner,i=t,o=a,d=this.dtRank,s=(l,c=.02)=>de(l,c),u=l=>new Float32Array(l),h=l=>new Float32Array(l).fill(1);this.wInProj=s(2*n*e),this.bInProj=u(2*n),this.wConv=s(n*o,.01),this.bConv=u(n),this.wXProj=s((d+2*i)*n,.01),this.bXProj=u(d+2*i),this.wDtProj=s(n*d,.02),this.bDtProj=u(n),this.A_log=new Float32Array(n*i);for(let l=0;l<n;l++)for(let c=0;c<i;c++)this.A_log[l*i+c]=Math.log(c+1);this.D_vec=h(n),this.wOutProj=s(e*n,.02),this.bOutProj=u(e),this.normWeight=h(e),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const e=this.device,t=a=>Q(e,a,!0);this.gpuWeights={wInProj:t(this.wInProj),bInProj:t(this.bInProj),wConv:t(this.wConv),bConv:t(this.bConv),wXProj:t(this.wXProj),bXProj:t(this.bXProj),wDtProj:t(this.wDtProj),bDtProj:t(this.bDtProj),A_log:t(this.A_log),D_vec:t(this.D_vec),wOutProj:t(this.wOutProj),bOutProj:t(this.bOutProj),normWeight:t(this.normWeight)}}_buildPipelines(){const e=this.device;this.pipelines={linear:z(e,xe,"linear_forward"),conv1d:z(e,at,"conv1d_forward"),silu:z(e,me,"silu_forward"),rmsnorm:z(e,me,"rmsnorm_forward"),scan_fwd:z(e,bt,"forward_scan"),scan_reduce:z(e,bt,"forward_reduce"),colSlice:z(e,Ce,Fe),elMul:z(e,wn,"main"),elAdd:z(e,yn,"main")}}forward(e,t,a){const n=this.device,{dModel:i,dState:o,dConv:d}=this.config,s=this.dInner,u=o,h=t,l=a,c=h*l,f=this.dtRank,g={},p=S(n,c*i*4,!0),m=S(n,c*4,!0);g.normInv=m,g.normIn=e;{const y=new ArrayBuffer(16);new Uint32Array(y,0,2).set([c,i]),new Float32Array(y,8,1).set([1e-6]);const x=$(n,y),L=I(n,this.pipelines.rmsnorm,[x,e,this.gpuWeights.normWeight,p,m]);W(n,this.pipelines.rmsnorm,L,[P(c,64),1,1])}const _=S(n,c*2*s*4,!0);g.normOut=p;{const y=new Uint32Array([c,i,2*s]).buffer,x=$(n,y),L=I(n,this.pipelines.linear,[x,p,this.gpuWeights.wInProj,this.gpuWeights.bInProj,_]);W(n,this.pipelines.linear,L,[P(c,16),P(2*s,16),1])}const b=S(n,c*s*4,!0),w=S(n,c*s*4,!0);{const y=this.pipelines.colSlice;Y(n,y,_,b,c,2*s,0,s),Y(n,y,_,w,c,2*s,s,s)}_.destroy(),g.zBuf=w,g.xConvIn=b;const v=S(n,c*s*4,!0);g.convOut=v;{const y=new Uint32Array([l,s,d,h,1]).buffer,x=$(n,y),L=I(n,this.pipelines.conv1d,[x,b,this.gpuWeights.wConv,this.gpuWeights.bConv,v]);W(n,this.pipelines.conv1d,L,[P(l,16),P(s,16),h])}const D=S(n,c*s*4,!0);g.siluOut=D;{const y=new Uint32Array([c*s]).buffer,x=$(n,y),L=I(n,this.pipelines.silu,[x,v,D]);W(n,this.pipelines.silu,L,[P(c*s,256),1,1])}const M=S(n,c*(f+2*u)*4,!0);{const y=new Uint32Array([c,s,f+2*u]).buffer,x=$(n,y),L=I(n,this.pipelines.linear,[x,D,this.gpuWeights.wXProj,this.gpuWeights.bXProj,M]);W(n,this.pipelines.linear,L,[P(c,16),P(f+2*u,16),1])}const T=S(n,c*f*4,!0),A=S(n,h*l*u*4,!0),E=S(n,h*l*u*4,!0);{const y=f+2*u,x=this.pipelines.colSlice;Y(n,x,M,T,c,y,0,f),Y(n,x,M,A,c,y,f,u),Y(n,x,M,E,c,y,f+u,u)}M.destroy(),g.B_raw=A,g.C_raw=E;const C=S(n,c*s*4,!0);g.deltaFull=C;{const y=new Uint32Array([c,f,s]).buffer,x=$(n,y),L=I(n,this.pipelines.linear,[x,T,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,C]);W(n,this.pipelines.linear,L,[P(c,16),P(s,16),1])}T.destroy();const O=S(n,h*l*s*4,!0),H=S(n,2*h*l*s*u*4,!0);g.hCache=H;{const y=new Uint32Array([l,u,s,h]).buffer,x=$(n,y),L=I(n,this.pipelines.scan_fwd,[x,D,C,this.gpuWeights.A_log,A,E,this.gpuWeights.D_vec,O,H]);W(n,this.pipelines.scan_fwd,L,[s,u,h]);const j=I(n,this.pipelines.scan_reduce,[x,D,C,this.gpuWeights.A_log,A,E,this.gpuWeights.D_vec,O,H]);W(n,this.pipelines.scan_reduce,j,[P(l,64),s,h])}const G=S(n,c*s*4,!0),R=S(n,c*s*4,!0);{const y=$(n,new Uint32Array([c*s]).buffer),x=I(n,this.pipelines.silu,[y,w,G]);W(n,this.pipelines.silu,x,[P(c*s,256),1,1]);const L=$(n,new Uint32Array([c*s]).buffer),j=I(n,this.pipelines.elMul,[O,G,R,L]);W(n,this.pipelines.elMul,j,[P(c*s,256),1,1])}G.destroy(),O.destroy();const q=S(n,c*i*4,!0);{const y=new Uint32Array([c,s,i]).buffer,x=$(n,y),L=I(n,this.pipelines.linear,[x,R,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,q]);W(n,this.pipelines.linear,L,[P(c,16),P(i,16),1])}R.destroy();const k=S(n,c*i*4,!0);{const y=$(n,new Uint32Array([c*i]).buffer),x=I(n,this.pipelines.elAdd,[q,e,k,y]);W(n,this.pipelines.elAdd,x,[P(c*i,256),1,1])}return q.destroy(),{output:k,cache:g}}parameters(){const{dModel:e,dState:t,dConv:a}=this.config,n=this.dInner,i=t,o=a,d=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*n*e,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*n,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:n*o,name:"wConv"},{buf:this.gpuWeights.bConv,numel:n,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(d+2*i)*n,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:d+2*i,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:n*d,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:n,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:n*i,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:n,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*n,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:e,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const xn=`
struct SsdParams {
    seq_len    : u32,
    d_inner    : u32,
    n_heads    : u32,
    d_head     : u32,   // d_inner / n_heads
    n_groups   : u32,
    d_state    : u32,   // N
    chunk_len  : u32,
    n_chunks   : u32,
    batch      : u32,
};

@group(0) @binding(0) var<uniform>             params      : SsdParams;
@group(0) @binding(1) var<storage, read>       x_in        : array<f32>; // [B,L,D_inner]
@group(0) @binding(2) var<storage, read>       B_proj      : array<f32>; // [B,L,n_groups,N]
@group(0) @binding(3) var<storage, read>       C_proj      : array<f32>; // [B,L,n_groups,N]
@group(0) @binding(4) var<storage, read>       dt_in       : array<f32>; // [B,L,H]
@group(0) @binding(5) var<storage, read>       A_log       : array<f32>; // [H]
@group(0) @binding(6) var<storage, read>       dt_bias     : array<f32>; // [H]
@group(0) @binding(7) var<storage, read>       D_vec       : array<f32>; // [H]
@group(0) @binding(8) var<storage, read_write> out_buf     : array<f32>; // [B,L,D_inner]
@group(0) @binding(9) var<storage, read_write> state_carry : array<f32>; // [n_chunks+1,B,H,N,d_head]

fn softplus(x: f32) -> f32 {
    // Numerically stable: max(x,0) + log1p(exp(-|x|)). The naive log(1+exp(x))
    // overflows to +Inf for x ≳ 88 (f32 exp range) — and a downstream
    // exp(-Inf*0) then yields NaN, poisoning the state. This form never overflows.
    return max(x, 0.0) + log(1.0 + exp(-abs(x)));
}

// Workgroup: one chunk × one head × one batch item
@compute @workgroup_size(1, 1, 1)
fn ssd_chunk_forward(@builtin(global_invocation_id) gid: vec3<u32>) {
    let chunk_id = gid.x;
    let head_id  = gid.y;
    let batch_id = gid.z;

    let L  = params.seq_len;
    let D  = params.d_inner;
    let H  = params.n_heads;
    let dh = params.d_head;
    let G  = params.n_groups;
    let N  = params.d_state;
    let CL = params.chunk_len;
    let NC = params.n_chunks;
    let B  = params.batch;

    let t_start = chunk_id * CL;
    let t_end   = min(t_start + CL, L);

    // Group index: heads are partitioned across groups
    let group_id = head_id * G / H;

    // A scalar for this head
    let neg_A = softplus(A_log[head_id]);  // A_log stores log(-A) positive
    let db    = dt_bias[head_id];
    let d_skip = D_vec[head_id];

    // Load carry-in state: h[N, dh] (stored flat as N*dh floats)
    // state_carry layout: [NC+1, B, H, N*dh]
    let state_stride_chunk = B * H * N * dh;
    let state_base_in = chunk_id * state_stride_chunk
                      + batch_id * H * N * dh
                      + head_id  * N * dh;

    // We maintain h as a local array (N * dh floats).
    // WebGPU WGSL does not support variable-length arrays in function scope,
    // so we use a fixed maximum. Max N*dh = 64*64 = 4096. Here we use dynamic
    // indexing into state_carry which is shared storage.

    // Write carry-in into temporary positions — use state_carry directly for
    // the running state (overwrite in-place from carry-in slot).
    // Copy carry-in to working slot (chunk_id+1 slot, updated each step).
    let state_base_out = (chunk_id + 1u) * state_stride_chunk
                       + batch_id * H * N * dh
                       + head_id  * N * dh;

    // Initialise working state from carry-in
    for (var s: u32 = 0u; s < N * dh; s = s + 1u) {
        state_carry[state_base_out + s] = state_carry[state_base_in + s];
    }

    // Sequential scan over the chunk
    for (var t: u32 = t_start; t < t_end; t = t + 1u) {
        // dt scalar for this head at time t
        let dt_idx = batch_id * L * H + t * H + head_id;
        let dt_val = softplus(dt_in[dt_idx] + db);

        // A_bar = exp(-neg_A * dt_val)
        let a_bar = exp(-neg_A * dt_val);

        // Head slice of x: x[batch, t, head*dh .. (head+1)*dh]
        let x_base = batch_id * L * D + t * D + head_id * dh;

        // B at this time step: B_proj[batch, t, group_id, *] shape [N]
        let b_base = batch_id * L * G * N + t * G * N + group_id * N;

        // C at this time step: C_proj[batch, t, group_id, *] shape [N]
        let c_base = batch_id * L * G * N + t * G * N + group_id * N;

        // y accumulator for this head at time t
        var y_acc: f32 = 0.0;

        for (var n: u32 = 0u; n < N; n = n + 1u) {
            let b_val = B_proj[b_base + n];
            let c_val = C_proj[c_base + n];

            for (var i: u32 = 0u; i < dh; i = i + 1u) {
                let s_idx = state_base_out + n * dh + i;
                let x_val = x_in[x_base + i];

                // h_t = A_bar * h_{t-1} + B * x
                let h_new = a_bar * state_carry[s_idx] + b_val * x_val;
                state_carry[s_idx] = h_new;

                // y += C * h (summed over n dimension per output channel i)
                y_acc = y_acc + c_val * h_new;
            }
        }

        // Write y + skip (D * x, averaged over dh for the skip scalar)
        // out[batch, t, head*dh .. (head+1)*dh]
        for (var i: u32 = 0u; i < dh; i = i + 1u) {
            let out_idx = batch_id * L * D + t * D + head_id * dh + i;
            let x_val   = x_in[x_base + i];
            out_buf[out_idx] = y_acc + d_skip * x_val;
        }
    }
}
`,No=`
struct SsdParams {
    seq_len    : u32,
    d_inner    : u32,
    n_heads    : u32,
    d_head     : u32,
    n_groups   : u32,
    d_state    : u32,
    chunk_len  : u32,
    n_chunks   : u32,
    batch      : u32,
};

@group(0) @binding(0) var<uniform>             params      : SsdParams;
@group(0) @binding(1) var<storage, read>       x_in        : array<f32>;
@group(0) @binding(2) var<storage, read>       B_proj      : array<f32>;
@group(0) @binding(3) var<storage, read>       C_proj      : array<f32>;
@group(0) @binding(4) var<storage, read>       dt_in       : array<f32>;
@group(0) @binding(5) var<storage, read>       A_log       : array<f32>;
@group(0) @binding(6) var<storage, read>       dt_bias     : array<f32>;
@group(0) @binding(7) var<storage, read>       state_carry : array<f32>; // forward states
@group(0) @binding(8) var<storage, read>       dy          : array<f32>; // upstream grad
@group(0) @binding(9) var<storage, read_write> dx          : array<f32>;
@group(0) @binding(10) var<storage, read_write> dB         : array<f32>;
@group(0) @binding(11) var<storage, read_write> dC         : array<f32>;
@group(0) @binding(12) var<storage, read_write> ddt        : array<f32>;
@group(0) @binding(13) var<storage, read_write> dA_log     : array<f32>;
@group(0) @binding(14) var<storage, read_write> dD_vec     : array<f32>;

fn softplus(x: f32) -> f32 {
    // Numerically stable: max(x,0) + log1p(exp(-|x|)). The naive log(1+exp(x))
    // overflows to +Inf for x ≳ 88 (f32 exp range) — and a downstream
    // exp(-Inf*0) then yields NaN, poisoning the state. This form never overflows.
    return max(x, 0.0) + log(1.0 + exp(-abs(x)));
}
fn d_softplus(x: f32) -> f32 {
    return 1.0 / (1.0 + exp(-x));
}

@compute @workgroup_size(1, 1, 1)
fn ssd_chunk_backward(@builtin(global_invocation_id) gid: vec3<u32>) {
    let chunk_id = gid.x;
    let head_id  = gid.y;
    let batch_id = gid.z;

    let L  = params.seq_len;
    let D  = params.d_inner;
    let H  = params.n_heads;
    let dh = params.d_head;
    let G  = params.n_groups;
    let N  = params.d_state;
    let CL = params.chunk_len;
    let NC = params.n_chunks;
    let B  = params.batch;

    let t_start = chunk_id * CL;
    let t_end   = min(t_start + CL, L);
    let group_id = head_id * G / H;

    let neg_A  = softplus(A_log[head_id]);
    let db     = dt_bias[head_id];

    let state_stride = B * H * N * dh;
    let state_base   = chunk_id * state_stride
                     + batch_id * H * N * dh
                     + head_id  * N * dh;

    // Backward: iterate time steps in reverse within the chunk
    // dh_next starts at zero (or propagated from future chunks — simplified here)
    for (var t_rev: u32 = 0u; t_rev < t_end - t_start; t_rev = t_rev + 1u) {
        let t = t_end - 1u - t_rev;

        let dt_idx = batch_id * L * H + t * H + head_id;
        let dt_raw = dt_in[dt_idx] + db;
        let dt_val = softplus(dt_raw);
        let a_bar  = exp(-neg_A * dt_val);

        let x_base = batch_id * L * D + t * D + head_id * dh;
        let b_base = batch_id * L * G * N + t * G * N + group_id * N;
        let c_base = b_base;

        for (var i: u32 = 0u; i < dh; i = i + 1u) {
            let dy_val  = dy[batch_id * L * D + t * D + head_id * dh + i];
            let x_val   = x_in[x_base + i];

            // dD_vec
            dD_vec[head_id] = dD_vec[head_id] + dy_val * x_val;
            // dx from skip
            dx[x_base + i] = dx[x_base + i] + dy_val * /* D */ 1.0;

            for (var n: u32 = 0u; n < N; n = n + 1u) {
                let s_idx = state_base + n * dh + i;
                let h_val = state_carry[(chunk_id + 1u) * state_stride
                                       + batch_id * H * N * dh
                                       + head_id * N * dh + n * dh + i];
                let c_val = C_proj[c_base + n];
                let b_val = B_proj[b_base + n];

                // dC += dy * h
                dC[b_base + n] = dC[b_base + n] + dy_val * h_val;

                // dh = C * dy
                let dh_val = c_val * dy_val;

                // dB += dh * x
                dB[b_base + n] = dB[b_base + n] + dh_val * x_val;

                // dx += dh * B
                dx[x_base + i] = dx[x_base + i] + dh_val * b_val;

                // ddt += dh * h_prev * (-neg_A) * d_softplus(dt_raw)
                let h_prev = state_carry[s_idx];
                ddt[dt_idx] = ddt[dt_idx]
                    + dh_val * h_prev * (-neg_A) * d_softplus(dt_raw);

                // dA_log += dh * h_prev * a_bar * (-dt_val) * d_softplus(A_log[head])
                dA_log[head_id] = dA_log[head_id]
                    + dh_val * h_prev * a_bar * (-dt_val) * d_softplus(A_log[head_id]);
            }
        }
    }
}
`,kn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class An{layerType="mamba2";device;config;dInner;dHead;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...t};const{dModel:a,expand:n,nHeads:i}=this.config;if(this.dInner=n*a,this.dHead=this.dInner/i,this.dInner%i!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${i}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:a,nHeads:n,nGroups:i}=this.config,o=this.dInner,d=t,s=a,u=n,h=i,l=(m,_=.02)=>de(m,_),c=m=>new Float32Array(m),f=m=>new Float32Array(m).fill(1),g=o+2*h*d+u,p=m=>Q(this.device,m,!0);this.gpuWeights={wInProj:p(l(g*e)),wConv:p(l((o+2*h*d)*s,.01)),bConv:p(c(o+2*h*d)),A_log:p(new Float32Array(u).fill(Math.log(1))),dt_bias:p(c(u)),D_vec:p(f(u)),wOutProj:p(l(e*o,.02)),normWeight:p(f(o)),preNormWeight:p(f(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:z(e,xe,"linear_forward"),conv1d:z(e,at,"conv1d_forward"),colSlice:z(e,Ce,Fe),rmsnorm:z(e,me,"rmsnorm_forward"),ssd_fwd:z(e,xn,"ssd_chunk_forward"),elAdd:z(e,kn,"main")}}forward(e,t,a){const n=this.device,{dModel:i,dState:o,dConv:d,nHeads:s,nGroups:u,chunkLen:h}=this.config,l=this.dInner,c=o,f=d,g=s,p=u,m=this.dHead,_=t,b=a,w=_*b,v=l+2*p*c,D=Math.ceil(b/h),M=S(n,w*i*4,!0),T=S(n,w*4,!0);{const F=new ArrayBuffer(16);new Uint32Array(F,0,2).set([w,i]),new Float32Array(F,8,1).set([1e-6]);const N=$(n,F),K=I(n,this.pipelines.rmsnorm,[N,e,this.gpuWeights.preNormWeight,M,T]);W(n,this.pipelines.rmsnorm,K,[P(w,64),1,1])}T.destroy();const A=l+2*p*c+g,E=S(n,w*A*4,!0);{const F=new Uint32Array([w,i,A]).buffer,N=$(n,F),K=Q(n,new Float32Array(A),!0),Z=I(n,this.pipelines.linear,[N,M,this.gpuWeights.wInProj,K,E]);W(n,this.pipelines.linear,Z,[P(w,16),P(A,16),1]),K.destroy()}M.destroy();const C=S(n,w*v*4,!0),O=S(n,w*g*4,!0);{const F=this.pipelines.colSlice,N=v+g;Y(n,F,E,C,w,N,0,v),Y(n,F,E,O,w,N,v,g)}E.destroy();const H=S(n,w*v*4,!0);{const F=new Uint32Array([b,v,f,_,1]).buffer,N=$(n,F),K=I(n,this.pipelines.conv1d,[N,C,this.gpuWeights.wConv,this.gpuWeights.bConv,H]);W(n,this.pipelines.conv1d,K,[P(b,16),P(v,16),_])}C.destroy();const G=S(n,w*l*4,!0),R=S(n,w*p*c*4,!0),q=S(n,w*p*c*4,!0);{const F=this.pipelines.colSlice;Y(n,F,H,G,w,v,0,l),Y(n,F,H,R,w,v,l,p*c),Y(n,F,H,q,w,v,l+p*c,p*c)}H.destroy();const k=S(n,(D+1)*_*g*c*m*4,!0),y=S(n,w*l*4,!0);{const F=new Uint32Array([b,l,g,m,p,c,h,D,_]).buffer,N=$(n,F),K=I(n,this.pipelines.ssd_fwd,[N,G,R,q,O,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,y,k]);W(n,this.pipelines.ssd_fwd,K,[D,g,_])}G.destroy(),R.destroy(),q.destroy(),O.destroy();const x=S(n,w*l*4,!0),L=S(n,w*4,!0);{const F=new ArrayBuffer(16);new Uint32Array(F,0,2).set([w,l]),new Float32Array(F,8,1).set([1e-6]);const N=$(n,F),K=I(n,this.pipelines.rmsnorm,[N,y,this.gpuWeights.normWeight,x,L]);W(n,this.pipelines.rmsnorm,K,[P(w,64),1,1])}y.destroy(),L.destroy();const j=S(n,w*i*4,!0);{const F=new Uint32Array([w,l,i]).buffer,N=$(n,F),K=Q(n,new Float32Array(i),!0),Z=I(n,this.pipelines.linear,[N,x,this.gpuWeights.wOutProj,K,j]);W(n,this.pipelines.linear,Z,[P(w,16),P(i,16),1]),K.destroy()}x.destroy();const U=S(n,w*i*4,!0);{const F=$(n,new Uint32Array([w*i]).buffer),N=I(n,this.pipelines.elAdd,[j,e,U,F]);W(n,this.pipelines.elAdd,N,[P(w*i,256),1,1])}return j.destroy(),{output:U,cache:{stateCarry:k}}}parameters(){const{dModel:e,dState:t,dConv:a,nHeads:n,nGroups:i}=this.config,o=this.dInner,d=t,s=a,u=n,h=i,l=o+2*h*d;return[{buf:this.gpuWeights.wInProj,numel:(o+2*h*d+u)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:l*s,name:"wConv"},{buf:this.gpuWeights.bConv,numel:l,name:"bConv"},{buf:this.gpuWeights.A_log,numel:u,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:u,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:u,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*o,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:o,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const Mn=`
struct CssdParams {
    seq_len    : u32,
    d_inner    : u32,
    n_heads    : u32,
    d_head     : u32,
    n_groups   : u32,
    n_complex  : u32,   // N/2 – number of complex state components
    chunk_len  : u32,
    n_chunks   : u32,
    batch      : u32,
};

@group(0) @binding(0) var<uniform>             params      : CssdParams;
@group(0) @binding(1) var<storage, read>       x_in        : array<f32>;
@group(0) @binding(2) var<storage, read>       B_proj      : array<f32>; // complex: N_c*2 per token
@group(0) @binding(3) var<storage, read>       C_proj      : array<f32>;
@group(0) @binding(4) var<storage, read>       dt_in       : array<f32>;
@group(0) @binding(5) var<storage, read>       A_log       : array<f32>; // [H, 2]
@group(0) @binding(6) var<storage, read>       dt_bias     : array<f32>;
@group(0) @binding(7) var<storage, read>       D_vec       : array<f32>;
@group(0) @binding(8) var<storage, read_write> out_buf     : array<f32>;
@group(0) @binding(9) var<storage, read_write> state_carry : array<f32>; // complex states

fn softplus(v: f32) -> f32 { return log(1.0 + exp(v)); }

// Complex multiply: (ar + i·ai) * (br + i·bi)
fn cmul_re(ar: f32, ai: f32, br: f32, bi: f32) -> f32 { return ar*br - ai*bi; }
fn cmul_im(ar: f32, ai: f32, br: f32, bi: f32) -> f32 { return ar*bi + ai*br; }

// Complex exp: exp(x + i·y) = exp(x)*(cos(y) + i*sin(y))
fn cexp_re(x: f32, y: f32) -> f32 { return exp(x) * cos(y); }
fn cexp_im(x: f32, y: f32) -> f32 { return exp(x) * sin(y); }

// ET discretisation B_bar = (A_bar - 1) * A^-1 * B
// A^-1 = 1/A = conj(A)/|A|^2.  Here A = exp(log_mag)*exp(i*phase).
// |A| = exp(log_mag),  A^-1 = exp(-log_mag)*exp(-i*phase)
// (A_bar - 1) * A^-1 = scalar complex product computed below.
fn et_bbar_re(a_bar_re: f32, a_bar_im: f32, log_mag: f32, phase: f32) -> f32 {
    // (A_bar - 1)
    let num_re = a_bar_re - 1.0;
    let num_im = a_bar_im;
    // A^-1 = exp(-log_mag - i*phase)
    let inv_re = cexp_re(-log_mag, -phase);
    let inv_im = cexp_im(-log_mag, -phase);
    return cmul_re(num_re, num_im, inv_re, inv_im);
}
fn et_bbar_im(a_bar_re: f32, a_bar_im: f32, log_mag: f32, phase: f32) -> f32 {
    let num_re = a_bar_re - 1.0;
    let num_im = a_bar_im;
    let inv_re = cexp_re(-log_mag, -phase);
    let inv_im = cexp_im(-log_mag, -phase);
    return cmul_im(num_re, num_im, inv_re, inv_im);
}

@compute @workgroup_size(1, 1, 1)
fn complex_ssd_forward(@builtin(global_invocation_id) gid: vec3<u32>) {
    let chunk_id = gid.x;
    let head_id  = gid.y;
    let batch_id = gid.z;

    let L  = params.seq_len;
    let D  = params.d_inner;
    let H  = params.n_heads;
    let dh = params.d_head;
    let G  = params.n_groups;
    let Nc = params.n_complex;   // complex state count
    let N2 = Nc * 2u;            // float pairs
    let CL = params.chunk_len;
    let B  = params.batch;

    let t_start  = chunk_id * CL;
    let t_end    = min(t_start + CL, L);
    let group_id = head_id * G / H;

    // Load A for this head: A = exp(log_mag) * exp(i*phase)
    let log_mag = A_log[head_id * 2u + 0u];
    let phase   = A_log[head_id * 2u + 1u];
    let db      = dt_bias[head_id];
    let d_skip  = D_vec[head_id];

    // State buffer strides (complex: N2*dh floats per head)
    let state_stride = B * H * N2 * dh;
    let state_base_in  = chunk_id * state_stride
                       + batch_id * H * N2 * dh
                       + head_id  * N2 * dh;
    let state_base_out = (chunk_id + 1u) * state_stride
                       + batch_id * H * N2 * dh
                       + head_id  * N2 * dh;

    // Copy carry-in to working slot
    for (var s: u32 = 0u; s < N2 * dh; s = s + 1u) {
        state_carry[state_base_out + s] = state_carry[state_base_in + s];
    }

    for (var t: u32 = t_start; t < t_end; t = t + 1u) {
        let dt_idx = batch_id * L * H + t * H + head_id;
        let dt_val = softplus(dt_in[dt_idx] + db);

        // A_bar = exp(dt * A) = exp(dt*log_mag + i*dt*phase)
        let a_bar_re = cexp_re(dt_val * log_mag, dt_val * phase);
        let a_bar_im = cexp_im(dt_val * log_mag, dt_val * phase);

        // ET B_bar scalar factor (applied per B_proj element)
        let bbar_factor_re = et_bbar_re(a_bar_re, a_bar_im, log_mag, phase);
        let bbar_factor_im = et_bbar_im(a_bar_re, a_bar_im, log_mag, phase);

        let x_base = batch_id * L * D + t * D + head_id * dh;
        // B_proj / C_proj: [B, L, G, N*2] — interleaved re/im
        let bc_base = batch_id * L * G * N2 + t * G * N2 + group_id * N2;

        for (var i: u32 = 0u; i < dh; i = i + 1u) {
            let x_val   = x_in[x_base + i];
            var y_re    = 0.0;

            for (var nc: u32 = 0u; nc < Nc; nc = nc + 1u) {
                let b_re = B_proj[bc_base + nc * 2u + 0u];
                let b_im = B_proj[bc_base + nc * 2u + 1u];
                let c_re = C_proj[bc_base + nc * 2u + 0u];
                let c_im = C_proj[bc_base + nc * 2u + 1u];

                // B_bar · x  (complex * real = complex scale)
                let inp_re = cmul_re(bbar_factor_re, bbar_factor_im, b_re, b_im) * x_val;
                let inp_im = cmul_im(bbar_factor_re, bbar_factor_im, b_re, b_im) * x_val;

                let s_re_idx = state_base_out + nc * 2u * dh + 0u * dh + i;
                let s_im_idx = state_base_out + nc * 2u * dh + 1u * dh + i;

                // h_t = A_bar * h_{t-1} + B_bar * x
                let h_prev_re = state_carry[s_re_idx];
                let h_prev_im = state_carry[s_im_idx];
                let h_new_re  = cmul_re(a_bar_re, a_bar_im, h_prev_re, h_prev_im) + inp_re;
                let h_new_im  = cmul_im(a_bar_re, a_bar_im, h_prev_re, h_prev_im) + inp_im;
                state_carry[s_re_idx] = h_new_re;
                state_carry[s_im_idx] = h_new_im;

                // y += Re(C · h)
                y_re = y_re + cmul_re(c_re, -c_im, h_new_re, h_new_im); // C·h real part
            }

            let out_idx = batch_id * L * D + t * D + head_id * dh + i;
            out_buf[out_idx] = y_re + d_skip * x_val;
        }
    }
}
`,Po=`
struct CssdParams {
    seq_len    : u32,
    d_inner    : u32,
    n_heads    : u32,
    d_head     : u32,
    n_groups   : u32,
    n_complex  : u32,
    chunk_len  : u32,
    n_chunks   : u32,
    batch      : u32,
};

@group(0) @binding(0) var<uniform>             params      : CssdParams;
@group(0) @binding(1) var<storage, read>       x_in        : array<f32>;
@group(0) @binding(2) var<storage, read>       B_proj      : array<f32>;
@group(0) @binding(3) var<storage, read>       C_proj      : array<f32>;
@group(0) @binding(4) var<storage, read>       dt_in       : array<f32>;
@group(0) @binding(5) var<storage, read>       A_log       : array<f32>;
@group(0) @binding(6) var<storage, read>       dt_bias     : array<f32>;
@group(0) @binding(7) var<storage, read>       state_carry : array<f32>;
@group(0) @binding(8) var<storage, read>       dy          : array<f32>;
@group(0) @binding(9)  var<storage, read_write> dx         : array<f32>;
@group(0) @binding(10) var<storage, read_write> dB         : array<f32>;
@group(0) @binding(11) var<storage, read_write> dC         : array<f32>;
@group(0) @binding(12) var<storage, read_write> ddt        : array<f32>;
@group(0) @binding(13) var<storage, read_write> dA_log     : array<f32>;
@group(0) @binding(14) var<storage, read_write> dD_vec     : array<f32>;

fn softplus(v: f32) -> f32 { return log(1.0 + exp(v)); }
fn d_softplus(v: f32) -> f32 { return 1.0 / (1.0 + exp(-v)); }
fn cmul_re(ar: f32, ai: f32, br: f32, bi: f32) -> f32 { return ar*br - ai*bi; }
fn cmul_im(ar: f32, ai: f32, br: f32, bi: f32) -> f32 { return ar*bi + ai*br; }
fn cexp_re(x: f32, y: f32) -> f32 { return exp(x) * cos(y); }
fn cexp_im(x: f32, y: f32) -> f32 { return exp(x) * sin(y); }

@compute @workgroup_size(1, 1, 1)
fn complex_ssd_backward(@builtin(global_invocation_id) gid: vec3<u32>) {
    let chunk_id = gid.x;
    let head_id  = gid.y;
    let batch_id = gid.z;

    let L  = params.seq_len;
    let D  = params.d_inner;
    let H  = params.n_heads;
    let dh = params.d_head;
    let G  = params.n_groups;
    let Nc = params.n_complex;
    let N2 = Nc * 2u;
    let CL = params.chunk_len;
    let B  = params.batch;

    let t_start  = chunk_id * CL;
    let t_end    = min(t_start + CL, L);
    let group_id = head_id * G / H;

    let log_mag = A_log[head_id * 2u + 0u];
    let phase   = A_log[head_id * 2u + 1u];
    let db      = dt_bias[head_id];

    let state_stride = B * H * N2 * dh;

    for (var t_rev: u32 = 0u; t_rev < t_end - t_start; t_rev = t_rev + 1u) {
        let t = t_end - 1u - t_rev;

        let dt_idx  = batch_id * L * H + t * H + head_id;
        let dt_raw  = dt_in[dt_idx] + db;
        let dt_val  = softplus(dt_raw);
        let a_bar_re = cexp_re(dt_val * log_mag, dt_val * phase);
        let a_bar_im = cexp_im(dt_val * log_mag, dt_val * phase);

        let x_base  = batch_id * L * D + t * D + head_id * dh;
        let bc_base = batch_id * L * G * N2 + t * G * N2 + group_id * N2;
        let state_base = (chunk_id + 1u) * state_stride
                        + batch_id * H * N2 * dh
                        + head_id * N2 * dh;
        let state_prev = chunk_id * state_stride
                        + batch_id * H * N2 * dh
                        + head_id * N2 * dh;

        for (var i: u32 = 0u; i < dh; i = i + 1u) {
            let dy_val = dy[batch_id * L * D + t * D + head_id * dh + i];
            let x_val  = x_in[x_base + i];

            dD_vec[head_id] = dD_vec[head_id] + dy_val * x_val;
            dx[x_base + i]  = dx[x_base + i]  + dy_val;

            for (var nc: u32 = 0u; nc < Nc; nc = nc + 1u) {
                let c_re = C_proj[bc_base + nc * 2u + 0u];
                let c_im = C_proj[bc_base + nc * 2u + 1u];
                let b_re = B_proj[bc_base + nc * 2u + 0u];
                let b_im = B_proj[bc_base + nc * 2u + 1u];

                let h_re = state_carry[state_base + nc * 2u * dh + 0u * dh + i];
                let h_im = state_carry[state_base + nc * 2u * dh + 1u * dh + i];

                // dC from Re(C · h) output — gradient of Re(C·h) w.r.t. C is Re(h)
                dC[bc_base + nc * 2u + 0u] = dC[bc_base + nc * 2u + 0u] + dy_val * h_re;
                dC[bc_base + nc * 2u + 1u] = dC[bc_base + nc * 2u + 1u] - dy_val * h_im;

                // dh from upstream: dh_re = c_re * dy, dh_im = -c_im * dy (Re(C·h) gradient)
                let dh_re = c_re * dy_val;
                let dh_im = -c_im * dy_val;

                // dB: B_bar · x contributed h_new; gradient flows through B_bar
                // simplified: dB += dh * x  (ignoring complex B_bar Jacobian)
                dB[bc_base + nc * 2u + 0u] = dB[bc_base + nc * 2u + 0u] + dh_re * x_val;
                dB[bc_base + nc * 2u + 1u] = dB[bc_base + nc * 2u + 1u] + dh_im * x_val;

                // dx += Re(B_bar* · dh) (simplified)
                dx[x_base + i] = dx[x_base + i] + cmul_re(b_re, -b_im, dh_re, dh_im);

                // ddt: from A_bar and B_bar dependence on dt
                let h_prev_re = state_carry[state_prev + nc * 2u * dh + 0u * dh + i];
                let h_prev_im = state_carry[state_prev + nc * 2u * dh + 1u * dh + i];
                // dA_bar/ddt = A * A_bar
                let da_bar_re = cmul_re(cexp_re(log_mag, phase), cexp_im(log_mag, phase), a_bar_re, a_bar_im);
                let da_bar_im = cmul_im(cexp_re(log_mag, phase), cexp_im(log_mag, phase), a_bar_re, a_bar_im);
                ddt[dt_idx] = ddt[dt_idx]
                    + (cmul_re(da_bar_re, da_bar_im, h_prev_re, h_prev_im) * dh_re
                    -  cmul_im(da_bar_re, da_bar_im, h_prev_re, h_prev_im) * dh_im)
                    * d_softplus(dt_raw);
            }
        }
    }
}
`,Ln=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class Sn{layerType="mamba3";device;config;dInner;dHead;nComplex;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...t};const{dModel:a,expand:n,nHeads:i}=this.config;if(this.dInner=n*a,this.dHead=this.dInner/i,this.nComplex=this.config.dState,this.dInner%i!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${i}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dConv:t,nHeads:a,nGroups:n}=this.config,i=this.dInner,o=this.nComplex,d=t,s=a,u=n,h=i+2*u*o*2,l=(_,b=.02)=>de(_,b),c=_=>new Float32Array(_),f=_=>new Float32Array(_).fill(1),g=new Float32Array(s*2);for(let _=0;_<s;_++)g[_*2+0]=0,g[_*2+1]=2*Math.PI*_/s;const p=_=>Q(this.device,_,!0),m=i+2*u*o*2+s;this.gpuWeights={wInProj:p(l(m*e)),wConv:p(l(h*d,.01)),bConv:p(c(h)),A_log:p(g),dt_bias:p(c(s)),D_vec:p(f(s)),wOutProj:p(l(e*i,.02)),normWeight:p(f(i)),preNormWeight:p(f(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:z(e,xe,"linear_forward"),conv1d:z(e,at,"conv1d_forward"),colSlice:z(e,Ce,Fe),rmsnorm:z(e,me,"rmsnorm_forward"),cssd_fwd:z(e,Mn,"complex_ssd_forward"),elAdd:z(e,Ln,"main")}}forward(e,t,a){const n=this.device,{dModel:i,dConv:o,nHeads:d,nGroups:s,chunkLen:u}=this.config,h=this.dInner,l=this.nComplex,c=o,f=d,g=s,p=this.dHead,m=t,_=a,b=m*_,w=h+2*g*l*2,v=Math.ceil(_/u),D=S(n,b*i*4,!0),M=S(n,b*4,!0);{const B=new ArrayBuffer(16);new Uint32Array(B,0,2).set([b,i]),new Float32Array(B,8,1).set([1e-6]);const F=$(n,B),N=I(n,this.pipelines.rmsnorm,[F,e,this.gpuWeights.preNormWeight,D,M]);W(n,this.pipelines.rmsnorm,N,[P(b,64),1,1])}M.destroy();const T=h+2*g*l*2+f,A=S(n,b*T*4,!0);{const B=new Uint32Array([b,i,T]).buffer,F=$(n,B),N=Q(n,new Float32Array(T),!0),K=I(n,this.pipelines.linear,[F,D,this.gpuWeights.wInProj,N,A]);W(n,this.pipelines.linear,K,[P(b,16),P(T,16),1]),N.destroy()}D.destroy();const E=S(n,b*w*4,!0),C=S(n,b*f*4,!0);{const B=this.pipelines.colSlice,F=w+f;Y(n,B,A,E,b,F,0,w),Y(n,B,A,C,b,F,w,f)}A.destroy();const O=S(n,b*w*4,!0);{const B=new Uint32Array([_,w,c,m,1]).buffer,F=$(n,B),N=I(n,this.pipelines.conv1d,[F,E,this.gpuWeights.wConv,this.gpuWeights.bConv,O]);W(n,this.pipelines.conv1d,N,[P(_,16),P(w,16),m])}E.destroy();const H=S(n,b*h*4,!0),G=S(n,b*g*l*2*4,!0),R=S(n,b*g*l*2*4,!0);{const B=this.pipelines.colSlice;Y(n,B,O,H,b,w,0,h),Y(n,B,O,G,b,w,h,g*l*2),Y(n,B,O,R,b,w,h+g*l*2,g*l*2)}O.destroy();const q=S(n,(v+1)*m*f*l*2*p*4,!0),k=S(n,b*h*4,!0);{const B=new Uint32Array([_,h,f,p,g,l,u,v,m]).buffer,F=$(n,B),N=I(n,this.pipelines.cssd_fwd,[F,H,G,R,C,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,k,q]);W(n,this.pipelines.cssd_fwd,N,[v,f,m])}H.destroy(),G.destroy(),R.destroy(),C.destroy();const y=S(n,b*h*4,!0),x=S(n,b*4,!0);{const B=new ArrayBuffer(16);new Uint32Array(B,0,2).set([b,h]),new Float32Array(B,8,1).set([1e-6]);const F=$(n,B),N=I(n,this.pipelines.rmsnorm,[F,k,this.gpuWeights.normWeight,y,x]);W(n,this.pipelines.rmsnorm,N,[P(b,64),1,1])}k.destroy(),x.destroy();const L=S(n,b*i*4,!0);{const B=new Uint32Array([b,h,i]).buffer,F=$(n,B),N=Q(n,new Float32Array(i),!0),K=I(n,this.pipelines.linear,[F,y,this.gpuWeights.wOutProj,N,L]);W(n,this.pipelines.linear,K,[P(b,16),P(i,16),1]),N.destroy()}y.destroy();const j=S(n,b*i*4,!0);{const B=$(n,new Uint32Array([b*i]).buffer),F=I(n,this.pipelines.elAdd,[L,e,j,B]);W(n,this.pipelines.elAdd,F,[P(b*i,256),1,1])}return L.destroy(),{output:j,cache:{stateCarry:q}}}parameters(){const{dModel:e,dConv:t,nHeads:a,nGroups:n}=this.config,i=this.dInner,o=this.nComplex,d=t,s=a,u=n,h=i+2*u*o*2;return[{buf:this.gpuWeights.wInProj,numel:(i+2*u*o*2+s)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:h*d,name:"wConv"},{buf:this.gpuWeights.bConv,numel:h,name:"bConv"},{buf:this.gpuWeights.A_log,numel:s*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:s,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:s,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*i,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:i,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const Dn=`
struct SoftmaxParams {
    rows : u32,   // L
    cols : u32,   // L (score matrix is L×L per head)
};

@group(0) @binding(0) var<uniform>             params : SoftmaxParams;
@group(0) @binding(1) var<storage, read_write> data   : array<f32>;

// One workgroup per row; each invocation handles one element within the row.
// Workgroup size 64 – cooperative reduction for max and sum.
var<workgroup> wg_max : array<f32, 64>;
var<workgroup> wg_sum : array<f32, 64>;

@compute @workgroup_size(64, 1, 1)
fn softmax_forward(@builtin(global_invocation_id) gid: vec3<u32>,
                   @builtin(local_invocation_id)  lid: vec3<u32>,
                   @builtin(workgroup_id)          wid: vec3<u32>) {
    let row  = wid.x;   // L row index
    let head = wid.y;
    let bat  = wid.z;
    let cols = params.cols;

    if (row >= params.rows) { return; }

    let base = (bat * params.rows * cols * /* nHeads from outer dispatch */ 1u)
             + row * cols;

    // Step 1: find row max (with causal mask: positions > row are -inf)
    var local_max = -1e38;
    for (var c = lid.x; c < cols; c = c + 64u) {
        var v = -1e38;
        if (c <= row) { v = data[base + c]; }
        if (v > local_max) { local_max = v; }
    }
    wg_max[lid.x] = local_max;
    workgroupBarrier();
    for (var s = 32u; s >= 1u; s = s >> 1u) {
        if (lid.x < s) {
            if (wg_max[lid.x + s] > wg_max[lid.x]) {
                wg_max[lid.x] = wg_max[lid.x + s];
            }
        }
        workgroupBarrier();
    }
    let row_max = wg_max[0u];

    // Step 2: exp and sum
    var local_sum = 0.0;
    for (var c = lid.x; c < cols; c = c + 64u) {
        if (c <= row) {
            let e = exp(data[base + c] - row_max);
            data[base + c] = e;
            local_sum = local_sum + e;
        } else {
            data[base + c] = 0.0;
        }
    }
    wg_sum[lid.x] = local_sum;
    workgroupBarrier();
    for (var s = 32u; s >= 1u; s = s >> 1u) {
        if (lid.x < s) { wg_sum[lid.x] = wg_sum[lid.x] + wg_sum[lid.x + s]; }
        workgroupBarrier();
    }
    let inv_sum = 1.0 / (wg_sum[0u] + 1e-12);

    // Step 3: normalise
    for (var c = lid.x; c <= row; c = c + 64u) {
        data[base + c] = data[base + c] * inv_sum;
    }
}
`,wt=`
struct AttnParams {
    batch    : u32,
    seq_len  : u32,
    d_model  : u32,
    n_heads  : u32,
    d_head   : u32,
};

@group(0) @binding(0) var<uniform>             params  : AttnParams;
// Q, K, V packed: [B, L, 3, H, d_head]  (after projection split)
@group(0) @binding(1) var<storage, read>       Q       : array<f32>; // [B,L,H,dh]
@group(0) @binding(2) var<storage, read>       K       : array<f32>; // [B,L,H,dh]
@group(0) @binding(3) var<storage, read>       V       : array<f32>; // [B,L,H,dh]
@group(0) @binding(4) var<storage, read_write> scores  : array<f32>; // [B,H,L,L]
@group(0) @binding(5) var<storage, read_write> out_buf : array<f32>; // [B,L,H,dh]

// Tiled 16×16 shared memory for Q row and K col
var<workgroup> tile_q : array<f32, 256>;  // 16 tokens × 16 d_head
var<workgroup> tile_k : array<f32, 256>;

@compute @workgroup_size(16, 16, 1)
fn attention_forward(@builtin(global_invocation_id) gid: vec3<u32>,
                     @builtin(local_invocation_id)  lid: vec3<u32>,
                     @builtin(workgroup_id)          wid: vec3<u32>) {
    let q_tile = wid.x;     // tile index along query (row) dimension
    let head   = wid.y;
    let batch  = wid.z;

    let B  = params.batch;
    let L  = params.seq_len;
    let H  = params.n_heads;
    let dh = params.d_head;
    let inv_sqrt = 1.0 / sqrt(f32(dh));

    let row = q_tile * 16u + lid.x;   // query token index
    let col = lid.y;                   // key token index offset within tile

    if (row >= L) { return; }

    // ── Phase 1: Compute raw attention scores for all K positions ──────────
    // scores[batch, head, row, k] = Q[row] · K[k] / sqrt(dh)
    // We iterate over K tiles
    let q_base = batch * L * H * dh + row * H * dh + head * dh;

    for (var k_start: u32 = 0u; k_start <= row; k_start = k_start + 16u) {
        let k_tok = k_start + lid.y;

        // Load Q row tile into shared memory (lid.y = 0..15 element index)
        if (lid.y < dh && lid.y < 16u) {
            tile_q[lid.x * 16u + lid.y] = Q[q_base + lid.y];
        }
        // Load K col tile
        if (k_tok < L && lid.x < dh && lid.x < 16u) {
            let k_base = batch * L * H * dh + k_tok * H * dh + head * dh;
            tile_k[lid.y * 16u + lid.x] = K[k_base + lid.x];
        } else if (lid.x < 16u) {
            tile_k[lid.y * 16u + lid.x] = 0.0;
        }
        workgroupBarrier();

        // Dot product: accumulate over dh
        if (k_tok <= row) {
            var acc = 0.0;
            for (var d = 0u; d < min(dh, 16u); d = d + 1u) {
                acc = acc + tile_q[lid.x * 16u + d] * tile_k[lid.y * 16u + d];
            }
            let score_idx = batch * H * L * L + head * L * L + row * L + k_tok;
            scores[score_idx] = acc * inv_sqrt;
        }
        workgroupBarrier();
    }
}

// Phase 2: softmax is dispatched separately via softmax_forward kernel.

// Phase 3: weighted sum of V
@compute @workgroup_size(16, 16, 1)
fn attention_value(@builtin(global_invocation_id) gid: vec3<u32>,
                   @builtin(local_invocation_id)  lid: vec3<u32>,
                   @builtin(workgroup_id)          wid: vec3<u32>) {
    let q_tile = wid.x;
    let head   = wid.y;
    let batch  = wid.z;

    let L  = params.seq_len;
    let H  = params.n_heads;
    let dh = params.d_head;

    let row = q_tile * 16u + lid.x;
    let d   = lid.y;   // d_head dimension

    if (row >= L || d >= dh) { return; }

    var acc = 0.0;
    for (var k: u32 = 0u; k <= row; k = k + 1u) {
        let score_idx = batch * H * L * L + head * L * L + row * L + k;
        let v_idx     = batch * L * H * dh + k * H * dh + head * dh + d;
        acc = acc + scores[score_idx] * V[v_idx];
    }

    let out_idx = batch * L * H * dh + row * H * dh + head * dh + d;
    out_buf[out_idx] = acc;
}
`,Co=`
struct AttnParams {
    batch    : u32,
    seq_len  : u32,
    d_model  : u32,
    n_heads  : u32,
    d_head   : u32,
};

@group(0) @binding(0) var<uniform>             params    : AttnParams;
@group(0) @binding(1) var<storage, read>       Q         : array<f32>;
@group(0) @binding(2) var<storage, read>       K         : array<f32>;
@group(0) @binding(3) var<storage, read>       V         : array<f32>;
@group(0) @binding(4) var<storage, read>       scores    : array<f32>; // post-softmax
@group(0) @binding(5) var<storage, read>       dy        : array<f32>; // [B,L,H,dh]
@group(0) @binding(6) var<storage, read_write> dQ        : array<f32>;
@group(0) @binding(7) var<storage, read_write> dK        : array<f32>;
@group(0) @binding(8) var<storage, read_write> dV        : array<f32>;
@group(0) @binding(9) var<storage, read_write> dscores   : array<f32>;

@compute @workgroup_size(16, 16, 1)
fn attention_backward(@builtin(global_invocation_id) gid: vec3<u32>,
                      @builtin(local_invocation_id)  lid: vec3<u32>,
                      @builtin(workgroup_id)          wid: vec3<u32>) {
    let q_tile = wid.x;
    let head   = wid.y;
    let batch  = wid.z;

    let L  = params.seq_len;
    let H  = params.n_heads;
    let dh = params.d_head;
    let inv_sqrt = 1.0 / sqrt(f32(dh));

    let row = q_tile * 16u + lid.x;
    let d   = lid.y;

    if (row >= L || d >= dh) { return; }

    // dV[k, d] += score[row, k] * dy[row, d]
    // dscores[row, k] += dy[row, d] * V[k, d]  (before softmax backward)
    for (var k: u32 = 0u; k <= row; k = k + 1u) {
        let s_idx = batch * H * L * L + head * L * L + row * L + k;
        let v_idx = batch * L * H * dh + k * H * dh + head * dh + d;
        let dy_idx = batch * L * H * dh + row * H * dh + head * dh + d;

        dV[v_idx] = dV[v_idx] + scores[s_idx] * dy[dy_idx];
        dscores[s_idx] = dscores[s_idx] + dy[dy_idx] * V[v_idx];
    }

    // dQ[row, d] += sum_k dscores_post_softmax[row, k] * K[k, d] * inv_sqrt
    var dq_acc = 0.0;
    for (var k: u32 = 0u; k <= row; k = k + 1u) {
        let ds_idx = batch * H * L * L + head * L * L + row * L + k;
        let k_idx  = batch * L * H * dh + k * H * dh + head * dh + d;
        dq_acc = dq_acc + dscores[ds_idx] * K[k_idx];
    }
    let q_idx = batch * L * H * dh + row * H * dh + head * dh + d;
    dQ[q_idx] = dQ[q_idx] + dq_acc * inv_sqrt;

    // dK[k, d] += dscores[row, k] * Q[row, d] * inv_sqrt  (for all rows >= k)
    for (var k: u32 = 0u; k <= row; k = k + 1u) {
        let ds_idx = batch * H * L * L + head * L * L + row * L + k;
        let k_idx  = batch * L * H * dh + k * H * dh + head * dh + d;
        dK[k_idx] = dK[k_idx] + dscores[ds_idx] * Q[q_idx] * inv_sqrt;
    }
}
`,En=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,Nn=`
struct ActParams { num_elements: u32; };
@group(0) @binding(0) var<uniform>             p : ActParams;
@group(0) @binding(1) var<storage, read>       x : array<f32>;
@group(0) @binding(2) var<storage, read_write> y : array<f32>;
@compute @workgroup_size(256, 1, 1)
fn silu_forward(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= p.num_elements) { return; }
    let v = x[i];
    y[i] = v / (1.0 + exp(-v));
}
`;class Pn{layerType="attention";device;config;dHead;gpuWeights;pipelines;constructor(e,t){if(this.device=e,t.dModel%t.nHeads!==0)throw new Error(`AttentionBlock: dModel (${t.dModel}) must be divisible by nHeads (${t.nHeads}).`);this.config={dHead:t.dModel/t.nHeads,hasFfn:!1,ffnMult:4,...t},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,hasFfn:t,ffnMult:a}=this.config,n=(s,u=.02)=>de(s,u),i=s=>new Float32Array(s),o=s=>new Float32Array(s).fill(1),d=s=>Q(this.device,s,!0);if(this.gpuWeights={wQKV:d(n(3*e*e)),bQKV:d(i(3*e)),wO:d(n(e*e)),bO:d(i(e)),normWeight:d(o(e))},t){const s=e*a;this.gpuWeights.wFfn1=d(n(s*e)),this.gpuWeights.bFfn1=d(i(s)),this.gpuWeights.wFfn2=d(n(e*s)),this.gpuWeights.bFfn2=d(i(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:z(e,xe,"linear_forward"),rmsnorm:z(e,me,"rmsnorm_forward"),attn_fwd:z(e,wt,"attention_forward"),attn_val:z(e,wt,"attention_value"),softmax:z(e,Dn,"softmax_forward"),colSlice:z(e,Ce,Fe),elAdd:z(e,En,"main")},this.config.hasFfn&&(this.pipelines.silu=z(e,Nn,"silu_forward"))}forward(e,t,a){const n=this.device,{dModel:i,nHeads:o,hasFfn:d}=this.config,s=this.dHead,u=t,h=a,l=u*h,c=o,f=S(n,l*i*4,!0),g=S(n,l*4,!0);{const A=new ArrayBuffer(16);new Uint32Array(A,0,2).set([l,i]),new Float32Array(A,8,1).set([1e-6]);const E=$(n,A),C=I(n,this.pipelines.rmsnorm,[E,e,this.gpuWeights.normWeight,f,g]);W(n,this.pipelines.rmsnorm,C,[P(l,64),1,1])}g.destroy();const p=S(n,l*3*i*4,!0);{const A=new Uint32Array([l,i,3*i]).buffer,E=$(n,A),C=I(n,this.pipelines.linear,[E,f,this.gpuWeights.wQKV,this.gpuWeights.bQKV,p]);W(n,this.pipelines.linear,C,[P(l,16),P(3*i,16),1])}f.destroy();const m=S(n,l*i*4,!0),_=S(n,l*i*4,!0),b=S(n,l*i*4,!0);{const A=this.pipelines.colSlice;Y(n,A,p,m,l,3*i,0,i),Y(n,A,p,_,l,3*i,i,i),Y(n,A,p,b,l,3*i,2*i,i)}p.destroy();const w=S(n,u*c*h*h*4,!0);{const A=new Uint32Array([u,h,i,c,s]).buffer,E=$(n,A),C=I(n,this.pipelines.attn_fwd,[E,m,_,b,w,S(n,l*i*4,!0)]);W(n,this.pipelines.attn_fwd,C,[P(h,16),c,u])}{const A=new Uint32Array([h,h,1]).buffer,E=$(n,A),C=I(n,this.pipelines.softmax,[E,w]);W(n,this.pipelines.softmax,C,[h,c,u])}const v=S(n,l*i*4,!0);{const A=new Uint32Array([u,h,i,c,s]).buffer,E=$(n,A),C=I(n,this.pipelines.attn_val,[E,m,_,b,w,v]);W(n,this.pipelines.attn_val,C,[P(h,16),c,u])}m.destroy(),_.destroy(),b.destroy();const D=S(n,l*i*4,!0);{const A=new Uint32Array([l,i,i]).buffer,E=$(n,A),C=I(n,this.pipelines.linear,[E,v,this.gpuWeights.wO,this.gpuWeights.bO,D]);W(n,this.pipelines.linear,C,[P(l,16),P(i,16),1])}v.destroy();let M=S(n,l*i*4,!0);{const A=$(n,new Uint32Array([l*i]).buffer),E=I(n,this.pipelines.elAdd,[D,e,M,A]);W(n,this.pipelines.elAdd,E,[P(l*i,256),1,1])}if(D.destroy(),d){const{ffnMult:A}=this.config,E=i*A,C=S(n,l*E*4,!0);{const R=new Uint32Array([l,i,E]).buffer,q=$(n,R),k=I(n,this.pipelines.linear,[q,M,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,C]);W(n,this.pipelines.linear,k,[P(l,16),P(E,16),1])}const O=S(n,l*E*4,!0);{const R=$(n,new Uint32Array([l*E]).buffer),q=I(n,this.pipelines.silu,[R,C,O]);W(n,this.pipelines.silu,q,[P(l*E,256),1,1])}C.destroy();const H=S(n,l*i*4,!0);{const R=new Uint32Array([l,E,i]).buffer,q=$(n,R),k=I(n,this.pipelines.linear,[q,O,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,H]);W(n,this.pipelines.linear,k,[P(l,16),P(i,16),1])}O.destroy();const G=S(n,l*i*4,!0);{const R=$(n,new Uint32Array([l*i]).buffer),q=I(n,this.pipelines.elAdd,[H,M,G,R]);W(n,this.pipelines.elAdd,q,[P(l*i,256),1,1])}H.destroy(),M.destroy(),M=G}return{output:M,cache:{scores:w}}}parameters(){const{dModel:e,hasFfn:t,ffnMult:a}=this.config,n=[{buf:this.gpuWeights.wQKV,numel:3*e*e,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*e,name:"bQKV"},{buf:this.gpuWeights.wO,numel:e*e,name:"wO"},{buf:this.gpuWeights.bO,numel:e,name:"bO"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}];if(t){const i=e*a;n.push({buf:this.gpuWeights.wFfn1,numel:i*e,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:i,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:e*i,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:e,name:"bFfn2"})}return n}getTrainableParams(){return this.parameters()}setWSLAMode(e){}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const yt=1296190035,Cn={mamba1:0,mamba2:1,mamba3:2,attention:3},Fn=["mamba1","mamba2","mamba3","attention"];class Tn{device;config;gpuEmbedding;layers;layerSpecs;gpuFinalNorm;tiedEmbedding;gpuLMHeadBias;_lmHeadPipeline;_rmsnormPipeline;_embedPipeline;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...t},gt(this.config.seed);const a=t.layers??Array.from({length:t.numLayers},()=>({type:"mamba1"}));if(a.length!==t.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${a.length}) must equal numLayers (${t.numLayers}).`);this.layerSpecs=a;const{vocabSize:n,dModel:i}=this.config,o=de(n*i,1/Math.sqrt(i));this.gpuEmbedding=Q(e,o,!0),this.layers=a.map(d=>this._buildLayer(d)),gt(void 0),this.gpuFinalNorm=Q(e,new Float32Array(i).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=Q(e,new Float32Array(n),!0),this._lmHeadPipeline=z(e,xe,"linear_forward"),this._rmsnormPipeline=z(e,me,"rmsnorm_forward"),this._embedPipeline=z(e,Bn,"embed_lookup")}_buildLayer(e){const t=this.config;switch(e.type){case"mamba1":{const a={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,...t.defaultMamba1};return new vn(this.device,{...a,...e.config??{}})}case"mamba2":{const a={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,...t.defaultMamba2};return new An(this.device,{...a,...e.config??{}})}case"mamba3":{const a={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,mimoGroup:t.mimoGroup,...t.defaultMamba3};return new Sn(this.device,{...a,...e.config??{}})}case"attention":{const a={dModel:t.dModel,nHeads:t.nHeads,...t.defaultAttention};return new Pn(this.device,{...a,...e.config??{}})}}}embedTokens(e,t,a){const{dModel:n}=this.config,i=t*a,o=Q(this.device,e instanceof Uint32Array?e:new Uint32Array(e),!1),d=S(this.device,i*n*4,!0),s=$(this.device,new Uint32Array([i,n]).buffer),u=I(this.device,this._embedPipeline,[s,o,this.gpuEmbedding,d]);return W(this.device,this._embedPipeline,u,[P(i,64),1,1]),o.destroy(),s.destroy(),d}async forward(e,t,a){const{dModel:n,vocabSize:i}=this.config,o=t*a;let d=this.embedTokens(e,t,a);const s=[];for(const f of this.layers){const{output:g,cache:p}=f.forward(d,t,a);s.push(p),d.destroy(),d=g}const u=S(this.device,o*n*4,!0),h=S(this.device,o*4,!1);{const f=new ArrayBuffer(16);new Uint32Array(f,0,2).set([o,n]),new Float32Array(f,8,1).set([1e-6]);const g=$(this.device,f),p=I(this.device,this._rmsnormPipeline,[g,d,this.gpuFinalNorm,u,h]);W(this.device,this._rmsnormPipeline,p,[P(o,64),1,1])}d.destroy();const l=S(this.device,o*i*4,!0);{const f=new Uint32Array([o,n,i]).buffer,g=$(this.device,f),p=I(this.device,this._lmHeadPipeline,[g,u,this.gpuEmbedding,this.gpuLMHeadBias,l]);W(this.device,this._lmHeadPipeline,p,[P(o,16),P(i,16),1])}return u.destroy(),h.destroy(),{logits:await ie(this.device,l,o*i*4),gpuLogits:l,caches:s}}async embed(e){const{dModel:t}=this.config,a=e.length,n=1,i=n*a;if(i===0)return new Float32Array(t);let o=this.embedTokens(e,n,a);for(const c of this.layers){const{output:f}=c.forward(o,n,a);o.destroy(),o=f}const d=S(this.device,i*t*4,!0),s=S(this.device,i*4,!1);{const c=new ArrayBuffer(16);new Uint32Array(c,0,2).set([i,t]),new Float32Array(c,8,1).set([1e-6]);const f=$(this.device,c),g=I(this.device,this._rmsnormPipeline,[f,o,this.gpuFinalNorm,d,s]);W(this.device,this._rmsnormPipeline,g,[P(i,64),1,1])}o.destroy();const u=await ie(this.device,d,i*t*4);d.destroy(),s.destroy();const h=new Float32Array(t);for(let c=0;c<a;c++){const f=c*t;for(let g=0;g<t;g++)h[g]+=u[f+g]}for(let c=0;c<t;c++)h[c]/=a;let l=0;for(let c=0;c<t;c++)l+=h[c]*h[c];l=Math.sqrt(l)||1;for(let c=0;c<t;c++)h[c]/=l;return h}async generate(e,t=200,a={}){const{temperature:n=1,topK:i=50,topP:o=.9}=a,{vocabSize:d}=this.config,s=[...e];for(let u=0;u<t;u++){const{logits:h}=await this.forward(new Uint32Array(s),1,s.length),l=h.slice((s.length-1)*d,s.length*d),c=In(l,{temperature:n,topK:i,topP:o});if(s.push(c),c===this.config.eosId)break}return s}parameters(){const e=[];e.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let t=0;t<this.layers.length;t++)for(const a of this.layers[t].parameters())e.push({...a,name:`layer${t}.${a.name}`});return e.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),e}getTrainableParams(){if(!this._wslaMode)return this.parameters();const e=[];for(let t=0;t<this.layers.length;t++)for(const a of this.layers[t].getTrainableParams())e.push({...a,name:`layer${t}.${a.name}`});return e}setWSLAMode(e){for(const t of this.layers)t.setWSLAMode(e);this._wslaMode=e}async exportWeights(e={}){const t=e.fp16??!1,a=this.parameters(),n=a.length,i=this.layers.length,o=await Promise.all(a.map(p=>ie(this.device,p.buf,p.numel*4))),d=Math.ceil(i/4)*4,s=12+d+4+n*4,u=t?2:4,l=o.reduce((p,m)=>p+m.length,0)*u,c=new ArrayBuffer(s+l),f=new DataView(c);let g=0;f.setUint32(g,yt,!0),g+=4,f.setUint32(g,t?3:2,!0),g+=4,f.setUint32(g,i,!0),g+=4;for(let p=0;p<i;p++){const m=this.layers[p].layerType;f.setUint8(g+p,Cn[m])}g+=d,f.setUint32(g,n,!0),g+=4;for(const p of a)f.setUint32(g,p.numel,!0),g+=4;if(t)for(const p of o){const m=Gt(p);new Uint16Array(c,g,m.length).set(m),g+=m.length*2}else for(const p of o)new Float32Array(c,g,p.length).set(p),g+=p.byteLength;return Kr(c)}async loadWeights(e){const t=Kt(e);if(t.hasTrailer&&!t.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const a=new DataView(e);let n=0;const i=a.getUint32(n,!0);if(n+=4,i!==yt)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const o=a.getUint32(n,!0);if(n+=4,o===1){const d=a.getUint32(n,!0);n+=4;const s=this.parameters();if(d!==s.length)throw new Error(`Weight file has ${d} parameters but this model has ${s.length}.`);const u=[];for(let h=0;h<d;h++)u.push(a.getUint32(n,!0)),n+=4;for(let h=0;h<d;h++){const l=s[h],c=u[h];if(c!==l.numel)throw new Error(`Parameter ${h} ("${l.name}") size mismatch: file=${c}, model=${l.numel}.`);ge(this.device,l.buf,new Float32Array(e,n,l.numel)),n+=l.numel*4}return}if(o===2||o===3){const d=o===3,s=a.getUint32(n,!0);if(n+=4,s!==this.layers.length)throw new Error(`Weight file has ${s} layers but this model has ${this.layers.length}.`);for(let f=0;f<s;f++){const g=a.getUint8(n+f),p=this.layers[f].layerType,m=Fn[g]??"mamba1";if(m!==p)throw new Error(`Layer ${f} type mismatch: file="${m}", model="${p}".`)}const u=Math.ceil(s/4)*4;n+=u;const h=a.getUint32(n,!0);n+=4;const l=this.parameters();if(h!==l.length)throw new Error(`Weight file has ${h} parameters but this model has ${l.length}.`);const c=[];for(let f=0;f<h;f++)c.push(a.getUint32(n,!0)),n+=4;for(let f=0;f<h;f++){const g=l[f],p=c[f];if(p!==g.numel)throw new Error(`Parameter ${f} ("${g.name}") size mismatch: file=${p}, model=${g.numel}.`);if(d){const m=new Uint16Array(e,n,p);ge(this.device,g.buf,Ut(m)),n+=p*2}else ge(this.device,g.buf,new Float32Array(e,n,g.numel)),n+=p*4}return}throw new Error(`Unsupported MBJS version: ${o}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const e of this.layers)e.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class Fo extends Tn{constructor(e,t){super(e,{...t,layers:Array.from({length:t.numLayers},()=>({type:"mamba1"}))})}}const Bn=`
struct EmbedParams {
    num_tokens : u32,
    d_model    : u32,
};

@group(0) @binding(0) var<uniform>            params  : EmbedParams;
@group(0) @binding(1) var<storage, read>      ids     : array<u32>;
@group(0) @binding(2) var<storage, read>      table   : array<f32>;
@group(0) @binding(3) var<storage, read_write> out    : array<f32>;

@compute @workgroup_size(64, 1, 1)
fn embed_lookup(@builtin(global_invocation_id) gid: vec3<u32>) {
    let token_idx = gid.x;
    if (token_idx >= params.num_tokens) { return; }

    let D   = params.d_model;
    let tok = ids[token_idx];
    let src = tok * D;
    let dst = token_idx * D;

    for (var i: u32 = 0u; i < D; i = i + 1u) {
        out[dst + i] = table[src + i];
    }
}
`;function In(r,{temperature:e=1,topK:t=50,topP:a=.9}={}){const n=r.length,i=new Float32Array(n);for(let m=0;m<n;m++)i[m]=r[m]/Math.max(e,1e-7);let o=-1/0;for(let m=0;m<n;m++)i[m]>o&&(o=i[m]);let d=0;const s=new Float32Array(n);for(let m=0;m<n;m++)s[m]=Math.exp(i[m]-o),d+=s[m];const h=Array.from({length:n},(m,_)=>_).sort((m,_)=>s[_]-s[m]).slice(0,t);let l=0;const c=[];for(const m of h)if(l+=s[m]/d,c.push(m),l>=a)break;let f=0;for(const m of c)f+=s[m];const g=Math.random()*f;let p=0;for(const m of c)if(p+=s[m],p>=g)return m;return c[c.length-1]}class To{model;adam;opt;constructor(e,t={}){this.model=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0,auxWeight:t.auxWeight??.01,batchSize:t.batchSize??0,epochs:t.epochs??1},this.adam=new Ur(e,this.opt)}fit(e){const t=[];for(let a=0;a<this.opt.epochs;a++)t.push(this.runEpoch(e));return t}runEpoch(e){const t=this.opt.batchSize>0?this.opt.batchSize:e.length,{numExperts:a,modelDim:n}=this.model.config;let i=0,o=0;for(let d=0;d<e.length;d+=t){const s=e.slice(d,d+t);this.model.zeroGrad();const u=[],h=[],l=new Vr(a);let c=0;for(const p of s){const m=this.model.forward(p.input),_=new Float32Array(n);for(let b=0;b<n;b++){const w=m.output[b]-(p.target[b]??0);_[b]=w,c+=.5*w*w}this.model.backward(_,m.cache),u.push(m.cache.x),h.push(m.route.probs),l.observe(m.route)}const f=l.dispatchFractions(),g=this.opt.auxWeight*a/s.length;for(let p=0;p<u.length;p++)this.model.auxGradStep(u[p],h[p],f,g);this.scaleGradients(1/s.length),this.adam.step(),i+=c,o=l.loss()}return{loss:i/Math.max(1,e.length),auxLoss:o}}scaleGradients(e){if(e!==1)for(const t of this.model.gradients())for(let a=0;a<t.data.length;a++)t.data[a]=t.data[a]*e}}const Wn=Math.LN2;function $n(r,e){const t=r.length,a=Math.max(1,Math.min(e,t)),n=[],i=new Uint8Array(t);for(let o=0;o<a;o++){let d=-1,s=-1/0;for(let u=0;u<t;u++){if(i[u])continue;const h=r[u];h>s&&(s=h,d=u)}if(d<0)break;i[d]=1,n.push(d)}return n}function jn(r){let e=0,t=-1/0;for(let a=0;a<r.length;a++)r[a]>t&&(t=r[a],e=a);return e}function Rn(r){return Math.exp(r)}function zn(r){return r/Wn}function or(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function sr(r,e,t,a){const n=Math.min(e.length,t.length);for(let i=0;i<n;i++){const o=t[i],d=e[i];o<0||o>=d.length||(r.ceSum+=ye(d,o),jn(d)===o&&r.top1Hits++,$n(d,a).includes(o)&&r.topKHits++,r.tokens++)}}function it(){const r=globalThis;return typeof r.performance?.now=="function"?r.performance.now():Date.now()}function dr(r){return r.slice(1)}function lr(r,e,t,a){const n=r.tokens>0?r.ceSum/r.tokens:0,i={sequences:e,tokens:r.tokens,crossEntropy:n,perplexity:Rn(n),bitsPerToken:zn(n),top1Accuracy:r.tokens>0?r.top1Hits/r.tokens:0,topKAccuracy:r.tokens>0?r.topKHits/r.tokens:0,topK:t};return a!==void 0&&(i.elapsedMs=a,i.tokensPerSecond=a>0?r.tokens/a*1e3:0),i}function De(r,e,t={}){const a=t.topK??5,n=t.measureLatency??!0,i=t.now??it,o=or();let d=0,s=0;for(const u of e){if(u.length<2)continue;const h=n?i():0,{logits:l}=r.forward(u);n&&(s+=i()-h),sr(o,l,dr(u),a),d++}return lr(o,d,a,n?s:void 0)}async function Bo(r,e,t={}){const a=t.topK??5,n=t.measureLatency??!0,i=t.now??it,o=or();let d=0,s=0;for(const u of e){if(u.length<2)continue;const h=n?i():0,{logits:l}=await r.forward(u);n&&(s+=i()-h),sr(o,l,dr(u),a),d++}return lr(o,d,a,n?s:void 0)}function Io(r,e,t,a={}){return On(De(r,t,a),De(e,t,a))}function On(r,e){const t=r.perplexity-e.perplexity,a=e.perplexity>0?r.perplexity/e.perplexity:1/0,n=r.top1Accuracy-e.top1Accuracy,i=.005;let o;Math.abs(a-1)<=i?o="tie":o=t<0?"candidate":"baseline";const d=((1-a)*100).toFixed(1),s=o==="tie"?`Tie: perplexity ${r.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)}`:o==="candidate"?`Candidate wins: ${d}% lower perplexity (${r.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(d)).toFixed(1)}% higher perplexity (${r.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`;return{candidate:r,baseline:e,perplexityDelta:t,perplexityRatio:a,top1Delta:n,winner:o,summary:s}}function cr(r,e){return r.split(/(?<=\.)\s+/).map(t=>e.encode(t.trim())).filter(t=>t.length>=2)}function Wo(r,e,t,a={}){return De(r,cr(t,e),a)}function Hn(r,e){for(let t=r.length-1;t>0;t--){const a=Math.floor(e.next()*(t+1)),n=r[t];r[t]=r[a],r[a]=n}return r}function $o(r,e={}){const t=e.seed??7,a=new Vt;a.train(r,{numMerges:e.numMerges??100});const n=cr(r,a);if(n.length<2)throw new Error(`corpus produced ${n.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const i=Hn([...n],new ve(t>>>0||1)),o=Math.min(.9,Math.max(.05,e.heldOutRatio??.25));let d=Math.round(i.length*o);d=Math.max(1,Math.min(i.length-1,d));const s=i.slice(0,d),u=i.slice(d),h=new Xt({vocabSize:a.vocabSize,dModel:e.dModel??32,numLayers:e.numLayers??2,hiddenDim:e.hiddenDim??48,seed:t}),l=e.epochs??30,c=new tt(h,{lr:e.lr??.03,epochs:l}).fit(u),f=De(h,s,{topK:e.topK??5,measureLatency:!0}),g=h.generateText(e.prompt??"The",a,{maxNewTokens:8,temperature:0});return{...f,trainSequences:u.length,evalSequences:s.length,initialTrainLoss:c[0]??0,finalTrainLoss:c.at(-1)??0,vocabSize:a.vocabSize,sample:g}}function ur(r,e){const t=[],a=Math.max(1,Math.floor(e));for(let n=0;n+1<r.length;n+=a){const i=r.slice(n,n+a);i.length>=2&&t.push(i)}return t}function qn(r,e){const t=Math.min(1,Math.max(0,e));return Math.round(r*(1-t))}const Gn=["The planning loop retrieves context before generating a response.","Agents recall facts from the memory layer and act on them.","Deployment runs on Cloudflare Workers and Durable Objects.","Tools are gated by a capability registry and a policy pack.","The coordinator merges weight deltas from every contributing host.","A ticket moves through triage, execution, review and merge.","Recall is ranked by embedding cosine fused with lexical scoring.","The trainer adapts a private copy of the base checkpoint locally."].join(" ");function Kn(r){let e=0;for(const t of r.parameters())e+=t.data.length;return e}function jo(r={}){const e=r.text??Gn,t=r.windowTokens??[32,64,128],a=r.epochs??[1,2,4],n=r.skipRates??[0,.5],i=Math.max(1,r.requests??4),o=r.dModel??32,d=r.numLayers??2,s=r.hiddenDim??48,u=r.seed??7,h=r.lr??.01,l=r.now??it,c=new Vt;c.train(e,{numMerges:r.numMerges??120});const f=c.encode(e),g=()=>new Xt({vocabSize:c.vocabSize,dModel:o,numLayers:d,hiddenDim:s,seed:u}),p=[];for(const m of t){const _=ur(f,m);for(const b of a)for(const w of n){const v=qn(i,w),D=g();D.resetStats();const M=l();for(let C=0;C<v;C++)new tt(D,{lr:h,epochs:b,accumSteps:1}).fit(_);const T=l()-M,A=D.positionsEvaluated,E=_.length*v;p.push({windowTokens:m,epochs:b,skipRate:w,requests:i,adapted:v,sequences:E,optimizerSteps:E*b,positionsEvaluated:A,elapsedMs:T,msPerKPosition:A>0?T/A*1e3:0,msPerAdaptation:v>0?T/v:0})}}return{points:p,textTokens:f.length,vocabSize:c.vocabSize,dModel:o,numLayers:d,hiddenDim:s,paramCount:Kn(g())}}function Ro(r){const e=`Evermind adaptation cost — dModel=${r.dModel} layers=${r.numLayers} hidden=${r.hiddenDim} params=${r.paramCount.toLocaleString()} vocab=${r.vocabSize} textTokens=${r.textTokens}`,t=["window","epochs","skip","adapts","seqs","steps","positions","ms","ms/adapt","ms/1k pos"],a=r.points.map(o=>[String(o.windowTokens),String(o.epochs),o.skipRate.toFixed(2),`${o.adapted}/${o.requests}`,String(o.sequences),String(o.optimizerSteps),String(o.positionsEvaluated),o.elapsedMs.toFixed(1),o.msPerAdaptation.toFixed(1),o.msPerKPosition.toFixed(3)]),n=t.map((o,d)=>Math.max(o.length,...a.map(s=>s[d].length))),i=o=>o.map((d,s)=>d.padStart(n[s])).join("  ");return[e,"",i(t),i(n.map(o=>"-".repeat(o))),...a.map(i)].join(`
`)}const Un=4e3,Vn=64;function Xn(r,e,t,a={}){const n=a.maxChars??Un,i=a.windowTokens??Vn,o=ur(e.encode(t.slice(0,n)),i);if(o.length===0)return null;const d=a.lm??r.loadLM(),s=new tt(d,{epochs:a.epochs??1}).fit(o),u=s.length>0?s[s.length-1]:0;return{diff:Yt(r.checkpoint,d.exportWeights()),loss:u,sequences:o.length}}function zo(r,e,t,a,n={}){const i=Xn(r,e,t,n);return i?{pkg:r.withCheckpoint(Qt(r.checkpoint,i.diff),a),loss:i.loss,sequences:i.sequences}:null}function Yn(r,e,t){if(e.length===0)return{checkpoint:r,mergedRows:0,contributors:0,deltaNorm:0};if(t&&t.length!==e.length)throw new Error(`mergeCheckpointDiffs: weights length ${t.length} != diffs length ${e.length}`);const a=e.map(l=>Xr(l));for(const l of a)if(l.rowSize!==1)throw new Error(`mergeCheckpointDiffs: expected element-granular deltas (rowSize 1), got ${l.rowSize}`);const n=new Map;if(a.forEach((l,c)=>{const f=t?t[c]:1;f>0&&l.rows.forEach((g,p)=>{const m=l.data[p],_=n.get(g);_?(_.sum+=f*m,_.weight+=f):n.set(g,{sum:f*m,weight:f})})}),n.size===0)return{checkpoint:r,mergedRows:0,contributors:a.length,deltaNorm:0};const i=[...n.keys()].sort((l,c)=>l-c),o=new Float32Array(i.length);i.forEach((l,c)=>{const f=n.get(l);o[c]=f.sum/f.weight});const d=new Float32Array(Kt(r).body);let s=0;return i.forEach((l,c)=>{const f=o[c]-(d[l]??0);s+=f*f}),{checkpoint:Qt(r,Yr({rowSize:1,rows:i,data:o})),mergedRows:i.length,contributors:a.length,deltaNorm:Math.sqrt(s)}}function Qn(r,e,t,a,n={}){const i=Yn(r,e,t),o=(h,l,c)=>({...i,checkpoint:r,deltaNorm:0,accepted:!1,baseLoss:l,newLoss:c,refusedReason:h});if(i.mergedRows===0)return o("nothing-merged",null,null);const d=h=>h!=null&&Number.isFinite(h)?h:null,s=d(a(r)),u=d(a(i.checkpoint));return s==null||u==null?n.requireEval?o("unscored",s,u):{...i,accepted:!0,baseLoss:s,newLoss:u}:u>s+(n.tolerance??0)?o("regressed",s,u):{...i,accepted:!0,baseLoss:s,newLoss:u}}const Zn=128;function Jn(r,e){if(e.length<2)return null;const{logits:t}=r.forward(e),a=Math.min(t.length,e.length)-1;if(a<1)return null;let n=0;for(let o=0;o<a;o++)n+=ye(t[o],e[o+1]);const i=n/a;return Number.isFinite(i)&&i>=0?i:null}function Oo(r,e,t,a=Zn){let n=0,i=0;for(const o of t){const d=(o.prompt?`${o.prompt}
`:"")+o.text,s=Jn(r,e.encode(d).slice(0,a));s!=null&&(n+=s,i++)}return i>0?n/i:null}class Ho{model;codec;dimensions;fingerprint;constructor(e,t,a){this.model=e,this.codec=t,this.dimensions=e.config.dModel,this.fingerprint=a??ea(e)}async embed(e){return this.embedSync(e)}embedSync(e){return this.model.embedText(e,this.codec)}}function ea(r){const e=r.config,t=new Uint8Array(r.emb.buffer,r.emb.byteOffset,r.emb.byteLength);return`evermind-lm/${[e.vocabSize,e.dModel,e.numLayers,e.convKernel,e.hiddenDim,e.numExperts,e.topK].join("-")}/${Qr(t).toString(16)}`}const ot=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],hr=-10,fr=5;function ta(r){const{dModel:e,dState:t,dConv:a,dInner:n,dtRank:i}=r;return{wInProj:new Float32Array(2*n*e),bInProj:new Float32Array(2*n),wConv:new Float32Array(n*a),bConv:new Float32Array(n),wXProj:new Float32Array((i+2*t)*n),bXProj:new Float32Array(i+2*t),wDtProj:new Float32Array(n*i),bDtProj:new Float32Array(n),A_log:new Float32Array(n*t),D_vec:new Float32Array(n),wOutProj:new Float32Array(e*n),bOutProj:new Float32Array(e),normWeight:new Float32Array(e)}}function gr(r,e,t){const{dModel:a,dState:n,dConv:i,dInner:o,dtRank:d,batch:s,seqLen:u}=t,h=s*u,l=d+2*n,c=new Float32Array(h*a),f=new Float32Array(h);Jt(r,e.normWeight,h,a,c,f);const g=new Float32Array(h*2*o);_e(c,e.wInProj,e.bInProj,h,a,2*o,g);const p=new Float32Array(h*o),m=new Float32Array(h*o);for(let y=0;y<h;y++)for(let x=0;x<o;x++)p[y*o+x]=g[y*2*o+x],m[y*o+x]=g[y*2*o+o+x];const _=new Float32Array(h*o);for(let y=0;y<s;y++)for(let x=0;x<u;x++){const L=(y*u+x)*o;for(let j=0;j<o;j++){let U=e.bConv[j];for(let B=0;B<i;B++)x>=B&&(U+=e.wConv[j*i+B]*p[(y*u+x-B)*o+j]);_[L+j]=U}}const b=new Float32Array(h*o);for(let y=0;y<h*o;y++)b[y]=pt(_[y]);const w=new Float32Array(h*l);_e(b,e.wXProj,e.bXProj,h,o,l,w);const v=new Float32Array(h*d),D=new Float32Array(h*n),M=new Float32Array(h*n);for(let y=0;y<h;y++){for(let x=0;x<d;x++)v[y*d+x]=w[y*l+x];for(let x=0;x<n;x++)D[y*n+x]=w[y*l+d+x],M[y*n+x]=w[y*l+d+n+x]}const T=new Float32Array(h*o);_e(v,e.wDtProj,e.bDtProj,h,d,o,T);const A=new Float32Array(h*o);for(let y=0;y<h*o;y++)A[y]=Zr(T[y]);const E=new Float32Array(o*n);for(let y=0;y<o*n;y++)E[y]=-Math.exp(Math.min(fr,Math.max(hr,e.A_log[y])));const C=new Float32Array(h*o*n),O=new Float32Array(h*o*n),H=new Float32Array(h*o*n),G=new Float32Array(h*o);for(let y=0;y<s;y++)for(let x=0;x<u;x++){const L=y*u+x;for(let j=0;j<o;j++){const U=A[L*o+j],B=b[L*o+j];let F=e.D_vec[j]*B;for(let N=0;N<n;N++){const K=E[j*n+N],Z=Math.exp(U*K),V=(Z-1)/K*D[L*n+N],X=(L*o+j)*n+N;C[X]=Z,O[X]=V;const te=x===0?0:H[((L-1)*o+j)*n+N],le=Z*te+V*B;H[X]=le,F+=M[L*n+N]*le}G[L*o+j]=F}}const R=new Float32Array(h*o),q=new Float32Array(h*o);for(let y=0;y<h*o;y++)R[y]=pt(m[y]),q[y]=G[y]*R[y];const k=new Float32Array(h*a);_e(q,e.wOutProj,e.bOutProj,h,o,a,k);for(let y=0;y<h*a;y++)k[y]=k[y]+r[y];return{output:k,cache:{x:r,normInv:f,normOut:c,xConvIn:p,z:m,convOut:_,u:b,dtRaw:v,bRaw:D,cRaw:M,deltaFull:T,dv:A,aCont:E,aBar:C,bBar:O,h:H,scanY:G,siluZ:R,gated:q}}}function ra(r,e,t,a,n){const{dModel:i,dState:o,dConv:d,dInner:s,dtRank:u,batch:h,seqLen:l}=a,c=h*l,f=u+2*o,g=new Float32Array(c*i);g.set(r);const p=new Float32Array(c*s);Ae(r,t.gated,e.wOutProj,c,s,i,p,n.wOutProj,n.bOutProj);const m=new Float32Array(c*s),_=new Float32Array(c*s);for(let k=0;k<c*s;k++)m[k]=p[k]*t.siluZ[k],_[k]=p[k]*t.scanY[k]*mt(t.z[k]);const b=new Float32Array(c*s),w=new Float32Array(c*o),v=new Float32Array(c*o),D=new Float32Array(c*s),M=new Float32Array(s*o),T=new Float32Array(s*o);for(let k=0;k<h;k++){T.fill(0);for(let y=l-1;y>=0;y--){const x=k*l+y;for(let L=0;L<s;L++){const j=m[x*s+L],U=t.u[x*s+L],B=t.dv[x*s+L];n.D_vec[L]=n.D_vec[L]+j*U,b[x*s+L]=b[x*s+L]+j*e.D_vec[L];let F=0;for(let N=0;N<o;N++){const K=(x*s+L)*o+N,Z=t.h[K],V=t.aBar[K],X=t.bBar[K],te=t.aCont[L*o+N],le=t.cRaw[x*o+N];v[x*o+N]=v[x*o+N]+j*Z;const ke=j*le+T[L*o+N],Gr=y===0?0:t.h[((x-1)*s+L)*o+N],ht=ke*Gr,Ie=ke*U;b[x*s+L]=b[x*s+L]+ke*X,T[L*o+N]=ke*V;const ft=t.bRaw[x*o+N];F+=ht*te*V+Ie*V*ft,M[L*o+N]=M[L*o+N]+ht*B*V+Ie*ft*((B*V*te-(V-1))/(te*te)),w[x*o+N]=w[x*o+N]+Ie*((V-1)/te)}D[x*s+L]=D[x*s+L]+F}}}for(let k=0;k<s*o;k++){const y=e.A_log[k];y<=hr||y>=fr||(n.A_log[k]=n.A_log[k]+M[k]*t.aCont[k])}const A=new Float32Array(c*s);for(let k=0;k<c*s;k++)A[k]=D[k]*Pe(t.deltaFull[k]);const E=new Float32Array(c*u);Ae(A,t.dtRaw,e.wDtProj,c,u,s,E,n.wDtProj,n.bDtProj);const C=new Float32Array(c*f);for(let k=0;k<c;k++){for(let y=0;y<u;y++)C[k*f+y]=E[k*u+y];for(let y=0;y<o;y++)C[k*f+u+y]=w[k*o+y],C[k*f+u+o+y]=v[k*o+y]}const O=new Float32Array(c*s);Ae(C,t.u,e.wXProj,c,s,f,O,n.wXProj,n.bXProj);for(let k=0;k<c*s;k++)b[k]=b[k]+O[k];const H=new Float32Array(c*s);for(let k=0;k<c*s;k++)H[k]=b[k]*mt(t.convOut[k]);const G=new Float32Array(c*s);for(let k=0;k<h;k++)for(let y=0;y<l;y++){const x=k*l+y;for(let L=0;L<s;L++){const j=H[x*s+L];if(j!==0){n.bConv[L]=n.bConv[L]+j;for(let U=0;U<d;U++){if(y<U)continue;const B=(k*l+y-U)*s+L;n.wConv[L*d+U]=n.wConv[L*d+U]+j*t.xConvIn[B],G[B]=G[B]+j*e.wConv[L*d+U]}}}}const R=new Float32Array(c*2*s);for(let k=0;k<c;k++)for(let y=0;y<s;y++)R[k*2*s+y]=G[k*s+y],R[k*2*s+s+y]=_[k*s+y];const q=new Float32Array(c*i);return Ae(R,t.normOut,e.wInProj,c,i,2*s,q,n.wInProj,n.bInProj),Zt(q,t.x,e.normWeight,t.normInv,c,i,g,n.normWeight,rt),g}const vt=["mamba1"];function na(r){const e={dModel:r.dModel,dState:r.dState,dConv:r.dConv,dInner:r.dInner,dtRank:r.dtRank};return{embedding:new Float32Array(r.vocabSize*r.dModel),finalNorm:new Float32Array(r.dModel),lmHeadBias:new Float32Array(r.vocabSize),layers:Array.from({length:r.numLayers},()=>ta(e))}}function aa(r){const e=new Map;e.set("embedding",r.embedding);for(let t=0;t<r.layers.length;t++){const a=r.layers[t];for(const n of ot)e.set(`layer${t}.${n}`,a[n])}return e.set("final_norm",r.finalNorm),e.set("lm_head_bias",r.lmHeadBias),e}function ia(r){const e=new Map;e.set("embedding",r.embedding);for(let t=0;t<r.layers.length;t++){const a=r.layers[t];for(const n of ot)e.set(`layer${t}.${n}`,a[n])}return e.set("final_norm",r.finalNorm),e.set("lm_head_bias",r.lmHeadBias),e}function oa(r,e){const t=(h,l)=>{const c=r.get(h);if(!c)throw new Error(`cpuWeightsFromNamed: missing tensor "${h}"`);if(c.length!==l)throw new Error(`cpuWeightsFromNamed: "${h}" has ${c.length} elements, expected ${l}`);return c},{dModel:a,dState:n,dConv:i,dInner:o,dtRank:d}=e,s={wInProj:2*o*a,bInProj:2*o,wConv:o*i,bConv:o,wXProj:(d+2*n)*o,bXProj:d+2*n,wDtProj:o*d,bDtProj:o,A_log:o*n,D_vec:o,wOutProj:a*o,bOutProj:a,normWeight:a},u=[];for(let h=0;h<e.numLayers;h++){const l={};for(const c of ot)l[c]=t(`layer${h}.${c}`,s[c]);u.push(l)}return{embedding:t("embedding",e.vocabSize*a),finalNorm:t("final_norm",a),lmHeadBias:t("lm_head_bias",e.vocabSize),layers:u}}function mr(r,e,t,a,n,i=!1){const{vocabSize:o,dModel:d}=t,s=a*n;let u=new Float32Array(s*d);for(let m=0;m<s;m++){const _=r[m];if(_<0||_>=o)throw new Error(`token id ${_} out of range [0, ${o})`);u.set(e.embedding.subarray(_*d,(_+1)*d),m*d)}const h={dModel:d,dState:t.dState,dConv:t.dConv,dInner:t.dInner,dtRank:t.dtRank,batch:a,seqLen:n},l=[],c=[];for(let m=0;m<t.numLayers;m++){l.push(u);const{output:_,cache:b}=gr(u,e.layers[m],h);i||c.push(b),u=_}const f=new Float32Array(s*d),g=new Float32Array(s);Jt(u,e.finalNorm,s,d,f,g,rt);const p=new Float32Array(s*o);return _e(f,e.embedding,e.lmHeadBias,s,d,o,p),{hiddenIn:l,layer:c,lastHidden:u,normOut:f,normInv:g,logits:p}}function sa(r,e,t,a,n){return mr(r,e,t,a,n).logits}function qo(r,e,t,a,n,i){const o=sa(r,t,a,n,i),d=n*i,s=a.vocabSize;let u=0;for(let h=0;h<d;h++)u+=ye(o.subarray(h*s,(h+1)*s),e[h]);return u/d}function da(r,e,t,a,n,i,o={}){const{vocabSize:d,dModel:s}=a,u=n*i,h=o.activationCheckpointing??!1,l=mr(r,t,a,n,i,h),c=na(a);let f=0;const g=new Float32Array(u*d);for(let v=0;v<u;v++){const D=l.logits.subarray(v*d,(v+1)*d),M=e[v];f+=ye(D,M);const T=Jr(D,M);for(let A=0;A<d;A++)g[v*d+A]=T[A]/u}const p=f/u,m=new Float32Array(u*s);for(let v=0;v<u;v++){const D=v*d,M=v*s;for(let T=0;T<d;T++){const A=g[D+T];if(A===0)continue;c.lmHeadBias[T]=c.lmHeadBias[T]+A;const E=T*s;for(let C=0;C<s;C++)m[M+C]=m[M+C]+A*t.embedding[E+C],c.embedding[E+C]=c.embedding[E+C]+A*l.normOut[M+C]}}const _=new Float32Array(u*s);Zt(m,l.lastHidden,t.finalNorm,l.normInv,u,s,_,c.finalNorm,rt);const b={dModel:s,dState:a.dState,dConv:a.dConv,dInner:a.dInner,dtRank:a.dtRank,batch:n,seqLen:i};let w=_;for(let v=a.numLayers-1;v>=0;v--){const D=h?gr(l.hiddenIn[v],t.layers[v],b).cache:l.layer[v];w=ra(w,t.layers[v],D,b,c.layers[v])}for(let v=0;v<u;v++){const M=r[v]*s,T=v*s;for(let A=0;A<s;A++)c.embedding[M+A]=c.embedding[M+A]+w[T+A]}return{loss:p,grads:aa(c)}}function la(r,e){const{dModel:t,dState:a,dConv:n,dInner:i,dtRank:o}=e;if(r==="embedding")return[e.vocabSize,t];switch(r.startsWith("layer")?r.slice(r.indexOf(".")+1):r){case"wInProj":return[2*i,t];case"wConv":return[i,n];case"wXProj":return[o+2*a,i];case"wDtProj":return[i,o];case"A_log":return[i,a];case"wOutProj":return[t,i];default:return null}}const ca=["wInProj","wXProj","wDtProj","wOutProj"],ua=.05;class Go{model;tokenizer;device;_moments;_step;_dims;_mirror;_mirrorByName;_adapters;_loraBase;_shard;constructor(e,t=null){this.model=e,this.tokenizer=t,this.device=e.device,this._moments=new Map,this._step=0,this._dims=ha(e),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const e=this.model.getTrainableParams();if(this._adapters.size===0)return e.reduce((a,n)=>a+n.numel,0);let t=0;for(const a of e){const n=this._adapters.get(a.name);n&&(t+=n.numParams())}return t}_owns(e){return this._shard===null||e%this._shard.count===this._shard.index}_installAdapters(e){if(this._adapters.size>0)return;const t=new Set(e.targets??ca),a=this._mirrorByName;for(const n of this.model.getTrainableParams()){const i=n.name.includes(".")?n.name.slice(n.name.indexOf(".")+1):n.name;if(!t.has(i))continue;const o=la(n.name,this._dims);if(!o)continue;const[d,s]=o,u=Math.max(1,Math.min(e.rank??8,d,s));this._adapters.set(n.name,new en(d,s,{...e,rank:u})),this._loraBase.set(n.name,Float32Array.from(a.get(n.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...t].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const e=this._mirrorByName;for(const[t,a]of this._adapters){const n=e.get(t),i=this._loraBase.get(t),o=a.delta();for(let d=0;d<n.length;d++)n[d]=i[d]+o[d]}}_momentFor(e){let t=this._moments.get(e.name);return t||(t={m:new Float32Array(e.numel),v:new Float32Array(e.numel)},this._moments.set(e.name,t)),t}async _syncMirrorFromGpu(){const e=new Map;for(const t of this.model.parameters())e.set(t.name,await ie(this.device,t.buf,t.numel*4));e.set("lm_head_bias",await ie(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=oa(e,this._dims),this._mirrorByName=ia(this._mirror)}async train(e,t={}){const{learningRate:a=1e-4,epochs:n=5,batchSize:i=1,seqLen:o=512,maxGradNorm:d=1,weightDecay:s=.01,beta1:u=.9,beta2:h=.999,eps:l=1e-8,wsla:c=!1,onEpochEnd:f=null}=t,g=Math.max(1,Math.floor(t.gradientAccumulation??1));if(this._shard=t.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const p=t.maxDelta??(c?ua:0);c&&this.model.setWSLAMode(!0);let m;if(typeof e=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");m=this.tokenizer.encode(e)}else m=Array.from(e);if(m.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const _=fa(m,o);if(_.length===0)throw new Error("Input is too short to form any training chunk.");const b=ga(_,Math.max(1,Math.floor(i)));await this._syncMirrorFromGpu(),t.lora&&this._installAdapters(t.lora);const w=[];for(let v=0;v<n;v++){let D=0,M=0,T=0;for(let E=0;E<b.length;E+=g){const C=b.slice(E,E+g),{loss:O,gradNorm:H}=await this._trainStep(C,{learningRate:a,maxGradNorm:d,weightDecay:s,beta1:u,beta2:h,eps:l,wsla:c,maxDelta:p,...t.activationCheckpointing?{activationCheckpointing:!0}:{}});D+=O,M+=H,T++}const A=D/T;w.push(A),f&&f(v+1,A,M/T)}return c&&this.model.setWSLAMode(!1),w}async _trainStep(e,t){const{learningRate:a,maxGradNorm:n,weightDecay:i,beta1:o,beta2:d,eps:s,maxDelta:u}=t;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const h=this._mirror,l=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const c=t.activationCheckpointing?{activationCheckpointing:!0}:{};let f=0,g=new Map;for(const w of e){const v=da(w.inputs,w.targets,h,this._dims,w.batch,w.seqLen,c);if(f+=v.loss/e.length,g.size===0){for(const D of v.grads.values())for(let M=0;M<D.length;M++)D[M]=D[M]/e.length;g=v.grads}else for(const[D,M]of v.grads){const T=g.get(D);for(let A=0;A<M.length;A++)T[A]=T[A]+M[A]/e.length}}const p=this.model.getTrainableParams();if(this._adapters.size>0)for(const[w,v]of this._adapters){const D=g.get(w);D&&(v.zeroGrad(),v.accumulateGradient(D))}let m=0;for(const w of p){const v=g.get(w.name);if(v)for(let D=0;D<v.length;D++)m+=v[D]*v[D]}const _=Math.sqrt(m),b=n>0&&_>n?n/_:1;return this._adamwStep(p,g,l,{learningRate:a,weightDecay:i,beta1:o,beta2:d,eps:s,beta1_t:Math.pow(o,this._step),beta2_t:Math.pow(d,this._step),maxDelta:u,gradScale:b}),{loss:f,gradNorm:_}}_adamwStep(e,t,a,n){const{learningRate:i,weightDecay:o,beta1:d,beta2:s,eps:u,beta1_t:h,beta2_t:l,maxDelta:c,gradScale:f}=n,g={lr:i,beta1:d,beta2:s,eps:u,weightDecay:o,beta1_t:h,beta2_t:l,maxDelta:c,gradScale:f};for(let p=0;p<e.length;p++){const m=e[p];if(!this._owns(p))continue;const _=this._adapters.get(m.name);if(_){const D=a.get(m.name),M=this._loraBase.get(m.name),[T,A]=[_.A,_.B],[E,C]=[_.gradients()[1].data,_.gradients()[0].data],O=this._momentNamed(`${m.name}::loraB`,A.length),H=this._momentNamed(`${m.name}::loraA`,T.length);Le(A,C,O.m,O.v,g),Le(T,E,H.m,H.v,g);const G=_.delta();for(let R=0;R<D.length;R++)D[R]=M[R]+G[R];ge(this.device,m.buf,D);continue}const b=t.get(m.name),w=a.get(m.name);if(!b||!w)continue;if(b.length!==m.numel||w.length!==m.numel)throw new Error(`MambaTrainer: parameter "${m.name}" is ${m.numel} elements but the gradient engine produced ${b.length} — model and CPU mirror disagree.`);const v=this._momentFor(m);Le(w,b,v.m,v.v,g),ge(this.device,m.buf,w)}}_momentNamed(e,t){let a=this._moments.get(e);return a||(a={m:new Float32Array(t),v:new Float32Array(t)},this._moments.set(e,a)),a}optimizerStateBytes(){let e=0;for(const t of this._moments.values())e+=t.m.byteLength+t.v.byteLength;return e}async evaluate(e){let t;if(typeof e=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");t=Array.from(this.tokenizer.encode(e))}else t=Array.from(e);const a=t.length,n=this.model.config.vocabSize,{logits:i}=await this.model.forward(new Uint32Array(t.slice(0,-1)),1,a-1);let o=0;for(let s=0;s<a-1;s++){const u=s*n;o+=ye(i.slice(u,u+n),t[s+1])}const d=o/(a-1);return Math.exp(d)}}function ha(r){const e=r.layerSpecs.map((i,o)=>({i:o,type:i.type})).filter(({type:i})=>!vt.includes(i));if(e.length>0){const i=e.map(({i:o,type:d})=>`layer${o}=${d}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${vt.join("/")} layers only, but this model has ${i}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const t=r.layers[0],a=t?.dInner??r.config.expand*r.config.dModel,n=t?.dtRank??Math.ceil(r.config.dModel/16);return{vocabSize:r.config.vocabSize,dModel:r.config.dModel,dState:r.config.dState,dConv:r.config.dConv,dInner:a,dtRank:n,numLayers:r.layers.length}}function fa(r,e){const t=[];for(let n=0;n+e<r.length;n+=e)t.push({inputs:r.slice(n,n+e),targets:r.slice(n+1,n+e+1)});const a=r.length%e;if(a>1){const n=r.length-a;t.push({inputs:r.slice(n,-1),targets:r.slice(n+1)})}return t}function ga(r,e){const t=[];let a=0;for(;a<r.length;){const n=r[a].inputs.length,i=[];for(;a<r.length&&i.length<e&&r[a].inputs.length===n;)i.push(r[a]),a++;t.push({inputs:i.flatMap(o=>o.inputs),targets:i.flatMap(o=>o.targets),batch:i.length,seqLen:n})}return t}class Ko{video;constructor(e){this.video=new tn({...e,keyframeInterval:1})}get vocab(){return this.video.vocab}get vocabSize(){return this.video.vocabSize}get frameSize(){return this.video.height*this.video.width*this.video.channels}encode(e){return this.video.encode([e])}decode(e){return this.video.decode(e)[0]??new Float32Array(this.frameSize)}fit(e,t){return this.video.fit(e.map(a=>[a]),t)}}function Uo(r,e,t){return[...e,...r.encode(t)]}function ma(r,e,t,a){if(r.config.vocabSize!==e.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${r.config.vocabSize}) must equal codec.vocabSize (${e.vocabSize})`);const n=r.generate(t,{...a,stopToken:a.stopToken??e.vocab.eosVideo});return{video:e.decode(n),tokens:n}}function Vo(r,e,t,a){const{video:n,tokens:i}=ma(r,e.video,t,a);return{image:n[0]??new Float32Array(e.frameSize),tokens:i}}const pa=0,_a=5,ba=2;class J{parts=[];byte(e){this.parts.push(e&255)}rawVarint(e){if(e<0||!Number.isFinite(e))throw new Error(`ProtoWriter: bad varint ${e}`);let t=e;for(;t>=128;)this.byte(t%128|128),t=Math.floor(t/128);this.byte(t)}tag(e,t){this.rawVarint(e*8+t)}rawBytes(e){for(let t=0;t<e.length;t++)this.byte(e[t])}varint(e,t){this.tag(e,pa),this.rawVarint(t)}float(e,t){this.tag(e,_a);const a=new ArrayBuffer(4);new DataView(a).setFloat32(0,t,!0),this.rawBytes(new Uint8Array(a))}bytes(e,t){this.tag(e,ba),this.rawVarint(t.length),this.rawBytes(t)}string(e,t){this.bytes(e,new TextEncoder().encode(t))}message(e,t){this.bytes(e,t.finish())}finish(){return Uint8Array.from(this.parts)}}function wa(r){const e=new Uint8Array(r.length*4),t=new DataView(e.buffer);for(let a=0;a<r.length;a++)t.setFloat32(a*4,r[a],!0);return e}const ya=18,va=8,pr=1,_r=7,xa=1,ka=2,Aa=3,Ma=7;class La{nodes=[];inits=[];uid=0;tmp(e){return`${e}_${this.uid++}`}initFloat(e,t,a){return this.inits.push({name:e,dims:t,dataType:pr,raw:wa(a)}),e}initInt64(e,t,a){return this.inits.push({name:e,dims:t,dataType:_r,int64:a}),e}node(e,t,a,n=[]){return this.nodes.push({op:e,inputs:t,outputs:a,name:`${e}_${this.uid++}`,attrs:n}),a}op(e,t,a,n=[]){const i=this.tmp(a);return this.node(e,t,[i],n),i}}function xt(r,e,t,a,n){const i=r.op("Mul",[e,e],"rms_sq"),o=r.op("ReduceMean",[i,n],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),d=r.op("Add",[o,a],"rms_eps"),s=r.op("Sqrt",[d],"rms_r"),u=r.op("Div",[e,s],"rms_div");return r.op("Mul",[u,t],"rms_y")}function kt(r,e,t,a,n,i){const o=r.op("Transpose",[t],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),d=r.op("Add",[r.op("MatMul",[e,o],"ffn_mm1"),a],"ffn_pre"),s=r.op("Relu",[d],"ffn_h"),u=r.op("Transpose",[n],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return r.op("Add",[r.op("MatMul",[s,u],"ffn_mm2"),i],"ffn_y")}function At(r,e={}){const t=er(r),a=tr(r),n=new Map(a.map(w=>[w.name,w])),i=w=>{const v=n.get(w);if(!v)throw new Error(`export/onnx: missing tensor ${w}`);return v},o=new La,{vocabSize:d,dModel:s,numLayers:u,convKernel:h,numExperts:l,topK:c}=t,f=o.initFloat("token_embedding.weight",[d,s],i("token_embedding.weight").data),g=o.initFloat("rms_eps",[1],new Float32Array([1e-5])),p=o.initInt64("axes_last",[1],[2]),m=o.initInt64("topk_k",[1],[c]);let _=o.op("Gather",[f,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let w=0;w<u;w++){const v=`layers.${w}`,D=o.initFloat(`${v}.norm_conv.weight`,[s],i(`${v}.norm_conv.weight`).data),M=xt(o,_,D,g,p),T=i(`${v}.conv.weight`).data,A=new Float32Array(s*h);for(let V=0;V<s;V++)for(let X=0;X<h;X++)A[V*h+(h-1-X)]=T[V*h+X];const E=o.initFloat(`${v}.conv.onnx_weight`,[s,1,h],A),C=o.op("Transpose",[M],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),O=o.op("Conv",[C,E],"conv_out",[{kind:"i",name:"group",value:s},{kind:"ints",name:"kernel_shape",value:[h]},{kind:"ints",name:"pads",value:[h-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),H=o.op("Transpose",[O],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),G=o.op("Add",[_,H],"after_conv"),R=o.initFloat(`${v}.norm_moe.weight`,[s],i(`${v}.norm_moe.weight`).data),q=xt(o,G,R,g,p),k=o.initFloat(`${v}.moe.router.weight`,[l,s],i(`${v}.moe.router.weight`).data),y=o.op("Transpose",[k],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),x=o.op("MatMul",[q,y],"router_logits"),L=o.tmp("topk_v"),j=o.tmp("topk_i");o.node("TopK",[x,m],[L,j],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const U=o.op("Softmax",[L],"gates",[{kind:"i",name:"axis",value:2}]),B=o.op("Sub",[x,x],"zeros"),F=o.op("ScatterElements",[B,j,U],"combine",[{kind:"i",name:"axis",value:2}]),N=kt(o,q,o.initFloat(`${v}.moe.shared.w1`,[t.hiddenDim,s],i(`${v}.moe.shared.w1`).data),o.initFloat(`${v}.moe.shared.b1`,[t.hiddenDim],i(`${v}.moe.shared.b1`).data),o.initFloat(`${v}.moe.shared.w2`,[s,t.hiddenDim],i(`${v}.moe.shared.w2`).data),o.initFloat(`${v}.moe.shared.b2`,[s],i(`${v}.moe.shared.b2`).data)),K=Array.from({length:l},(V,X)=>o.tmp(`combine_${X}`));o.node("Split",[F],K,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:l}]);let Z=N;for(let V=0;V<l;V++){const X=`${v}.moe.experts.${V}`,te=kt(o,q,o.initFloat(`${X}.w1`,[t.hiddenDim,s],i(`${X}.w1`).data),o.initFloat(`${X}.b1`,[t.hiddenDim],i(`${X}.b1`).data),o.initFloat(`${X}.w2`,[s,t.hiddenDim],i(`${X}.w2`).data),o.initFloat(`${X}.b2`,[s],i(`${X}.b2`).data)),le=o.op("Mul",[K[V],te],"expert_w");Z=o.op("Add",[Z,le],"moe_acc")}_=o.op("Add",[G,Z],"after_moe")}const b=o.op("Transpose",[f],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return o.node("MatMul",[_,b],["logits"]),Ca(o,t,e)}function Sa(r){const e=new J;switch(e.string(1,r.name),r.kind){case"i":e.varint(20,ka),e.varint(3,r.value);break;case"ints":e.varint(20,Ma);for(const t of r.value)e.varint(8,t);break;case"f":e.varint(20,xa),e.float(2,r.value);break;case"s":e.varint(20,Aa),e.string(4,r.value);break}return e}function Da(r){const e=new J;for(const t of r.inputs)e.string(1,t);for(const t of r.outputs)e.string(2,t);e.string(3,r.name),e.string(4,r.op);for(const t of r.attrs)e.message(5,Sa(t));return e}function Ea(r){const e=new J;for(const t of r.dims)e.varint(1,t);if(e.varint(2,r.dataType),e.string(8,r.name),r.int64)for(const t of r.int64)e.varint(7,t);return r.raw&&e.bytes(9,r.raw),e}function Na(r){const e=new J;return e.string(2,r),e}function Pa(r){const e=new J;return e.varint(1,r),e}function Mt(r,e,t){const a=new J;for(const d of t)a.message(1,typeof d=="string"?Na(d):Pa(d));const n=new J;n.varint(1,e),n.message(2,a);const i=new J;i.message(1,n);const o=new J;return o.string(1,r),o.message(2,i),o}function Ca(r,e,t){const a=new J;for(const o of r.nodes)a.message(1,Da(o));a.string(2,"evermind");for(const o of r.inits)a.message(5,Ea(o));a.message(11,Mt("input_ids",_r,["batch","seq"])),a.message(12,Mt("logits",pr,["batch","seq",e.vocabSize]));const n=new J;n.string(1,""),n.varint(2,ya);const i=new J;return i.varint(1,va),i.string(2,t.producerName??"builderforce-memory-engine"),i.string(3,t.producerVersion??"evermind"),i.message(7,a),i.message(8,n),i.finish()}const Fa=1179993927,Ta=3,pe=32,Ba=4,Ia=8,Wa=0,$a=1;class ja{buf=new Uint8Array(1024);len=0;ensure(e){if(this.len+e<=this.buf.length)return;let t=this.buf.length*2;for(;t<this.len+e;)t*=2;const a=new Uint8Array(t);a.set(this.buf.subarray(0,this.len)),this.buf=a}u32(e){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,e,!0),this.len+=4}u64(e){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(e),!0),this.len+=8}raw(e){this.ensure(e.length),this.buf.set(e,this.len),this.len+=e.length}alignTo(e){const t=(e-this.len%e)%e;t>0&&(this.ensure(t),this.len+=t)}string(e){const t=new TextEncoder().encode(e);this.u64(t.length),this.raw(t)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function Ra(r,e){if(!e){const n=new Uint8Array(r.length*4),i=new DataView(n.buffer);for(let o=0;o<r.length;o++)i.setFloat32(o*4,r[o],!0);return n}const t=new Uint8Array(r.length*2),a=new DataView(t.buffer);for(let n=0;n<r.length;n++)a.setUint16(n*2,rn(r[n]),!0);return t}function Lt(r,e={}){const t=e.fp16??!1,a=er(r),n=tr(r),i=t?$a:Wa,o=t?2:4,d=[["evermind.vocab_size",a.vocabSize],["evermind.embedding_length",a.dModel],["evermind.block_count",a.numLayers],["evermind.conv_kernel",a.convKernel],["evermind.feed_forward_length",a.hiddenDim],["evermind.expert_count",a.numExperts],["evermind.expert_used_count",a.topK],["general.alignment",pe]],s=[["general.architecture","evermind"],["general.name",e.name??"Evermind"]],u=new ja;u.u32(Fa),u.u32(Ta),u.u64(n.length),u.u64(d.length+s.length);for(const[g,p]of s)u.string(g),u.u32(Ia),u.string(p);for(const[g,p]of d)u.string(g),u.u32(Ba),u.u32(p);const h=g=>[...g.shape].reverse();let l=0;const c=[];for(const g of n){c.push(l);const p=g.data.length*o;l+=p,l+=(pe-l%pe)%pe}n.forEach((g,p)=>{u.string(g.name);const m=h(g);u.u32(m.length);for(const _ of m)u.u64(_);u.u32(i),u.u64(c[p])}),u.alignTo(pe);const f=u.length;for(let g=0;g<n.length;g++){const p=f+c[g];for(;u.length<p;)u.raw(new Uint8Array(1));u.raw(Ra(n[g].data,t))}return u.bytes()}const Xo=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],za="application/json";function $e(r,e){return{path:r,data:JSON.stringify(e,null,2),contentType:za}}function Yo(r,e,t={},a){const n=nn(r),i=()=>({format:e,files:[],paramCount:n});switch(e){case"safetensors":{const o=i();return o.files.push({path:"model.safetensors",data:_t(r,{fp16:t.fp16}),contentType:"application/octet-stream"}),o}case"onnx":{const o=i();return o.files.push({path:"model.onnx",data:At(r,{producerVersion:t.version}),contentType:"application/octet-stream"}),o}case"gguf":{const o=i();return o.files.push({path:"model.gguf",data:Lt(r,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"}),o}case"huggingface":{if(!a)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const o=i();return o.files.push({path:"model.safetensors",data:_t(r,{fp16:t.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:At(r,{producerVersion:t.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:Lt(r,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"},$e("config.json",an(r)),$e("generation_config.json",dn()),$e("tokenizer.json",on(a)),{path:"README.md",data:sn(r,t),contentType:"text/markdown"}),o}default:throw new Error(`exportEvermind: unknown format "${String(e)}"`)}}function br(r){return r.startsWith("model.")?r.slice(6):r}function Oa(r){return r.reduce((e,t)=>e*t,1)}function ue(r){const e=r.filter(t=>t!==1);return e.length>0?e:[1]}function je(r,e){return r.length===e.length&&r.every((t,a)=>t===e[a])}function Ha(r){if(!(r>0))throw new Error(`import/foreign: softplus⁻¹ needs a positive input, got ${r}`);return r>30?r:Math.log(Math.expm1(r))}function St(r,e){const t=Oa(r.shape);if(r.op.kind==="fill")return new Float32Array(t).fill(r.op.value);if(!e)throw new Error(`import/foreign: rule for "${r.target}" has no source tensor`);const a=`"${e.name}" → "${r.target}"`;switch(r.op.kind){case"copy":case"negExpToSoftplusInv":{if(!je(ue(e.shape),ue(r.shape)))throw new Error(`import/foreign: ${a} shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${r.shape.join(", ")}]`);if(e.data.length!==t)throw new Error(`import/foreign: ${a} has ${e.data.length} elements, expected ${t}`);if(r.op.kind==="copy")return Float32Array.from(e.data);const n=new Float32Array(t);for(let i=0;i<t;i++)n[i]=Ha(Math.exp(e.data[i]));return n}case"convTaps":{const[n,i]=ue(r.shape),o=ue(e.shape);if(!je(o,[n,i]))throw new Error(`import/foreign: ${a} depthwise conv shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${r.shape.join(", ")}] (a [channels, 1, kernel] PyTorch kernel squeezes to [channels, kernel])`);const d=new Float32Array(t);for(let s=0;s<n;s++)for(let u=0;u<i;u++)d[s*i+u]=e.data[s*i+(i-1-u)];return d}case"rowSlice":{if(e.shape.length!==2)throw new Error(`import/foreign: ${a} rowSlice needs a rank-2 source, got [${e.shape.join(", ")}]`);const[n,i]=e.shape,{start:o,count:d}=r.op;if(o<0||o+d>n)throw new Error(`import/foreign: ${a} rowSlice [${o}, ${o+d}) is outside the checkpoint tensor's ${n} rows — the source layout is not what this adapter expects`);if(!je(ue(r.shape),ue([d,i])))throw new Error(`import/foreign: ${a} rowSlice yields [${d}, ${i}] but this model expects [${r.shape.join(", ")}]`);return Float32Array.from(e.data.subarray(o*i,(o+d)*i))}}}function qa(r,e){const t=new Map;for(const d of e){const s=br(d.name);t.set(s,{...d,name:s})}const a=new Map,n=[],i=new Set;for(const d of r.rules){if(a.has(d.target))throw new Error(`import/foreign: plan "${r.adapter}" defines "${d.target}" twice`);if(d.from.length===0){if(d.op.kind!=="fill")throw new Error(`import/foreign: rule for "${d.target}" names no source but is not a fill rule`);a.set(d.target,St(d,null)),n.push({target:d.target,value:d.op.value,reason:d.note??"this architecture has no corresponding tensor"});continue}const s=d.from.map(u=>t.get(u)).find(u=>u!=null);if(!s)throw new Error(`import/foreign: checkpoint is missing "${d.from[0]}" (needed for "${d.target}", expected shape [${d.shape.join(", ")}])`+(d.from.length>1?`; also tried ${d.from.slice(1).map(u=>`"${u}"`).join(", ")}`:""));i.add(s.name),a.set(d.target,St(d,s))}const o=[...t.keys()].filter(d=>!i.has(d)).sort();return{adapter:r.adapter,weights:a,unmappedSources:o,synthesisedTargets:n,discardedSources:r.discards}}const Dt="codestral_mamba",Ga=["backbone.embeddings.weight","backbone.embedding.weight"];function Ka(r){const{vocabSize:e,dModel:t,numLayers:a,dInner:n,dState:i,dConv:o,nHeads:d,nGroups:s}=r,u=n+2*s*i,h=u+d,l=[{target:"embedding",shape:[e,t],from:Ga,op:{kind:"copy"}}];for(let c=0;c<a;c++){const f=`backbone.layers.${c}.mixer`,g=`layer${c}`;l.push({target:`${g}.wInProj`,shape:[h,t],from:[`${f}.in_proj.weight`],op:{kind:"rowSlice",start:n,count:h},note:"upstream rows are [gate, x, B, C, dt]; this block has no gate branch"},{target:`${g}.wConv`,shape:[u,o],from:[`${f}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [conv_dim, 1, d_conv] → [conv_dim, d_conv] with the tap axis reversed"},{target:`${g}.bConv`,shape:[u],from:[`${f}.conv1d.bias`],op:{kind:"copy"}},{target:`${g}.A_log`,shape:[d],from:[`${f}.A_log`],op:{kind:"negExpToSoftplusInv"},note:"upstream A = -exp(A_log); this engine's SSD kernel uses A = -softplus(A_log)"},{target:`${g}.dt_bias`,shape:[d],from:[`${f}.dt_bias`],op:{kind:"copy"}},{target:`${g}.D_vec`,shape:[d],from:[`${f}.D`],op:{kind:"copy"}},{target:`${g}.wOutProj`,shape:[t,n],from:[`${f}.out_proj.weight`],op:{kind:"copy"}},{target:`${g}.normWeight`,shape:[n],from:[`${f}.norm.weight`],op:{kind:"copy"},note:"upstream this gain belongs to a GATED RMSNorm; applied ungated here"},{target:`${g}.preNormWeight`,shape:[t],from:[`backbone.layers.${c}.norm.weight`],op:{kind:"copy"}})}return l.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),l}function Ua(r){const e=[];for(let t=0;t<r.numLayers;t++)e.push({source:`backbone.layers.${t}.mixer.in_proj.weight`,elements:r.dInner*r.dModel,reason:"the leading d_inner gate (z) rows — Mamba2Block computes norm(y) rather than norm(y * silu(z)), so it has no gate branch to receive them"});return e}const Va={id:Dt,label:"Codestral-Mamba (Mamba-2 / SSD)",modelTypes:["mamba2"],architectures:["Mamba2ForCausalLM","MambaCodestralForCausalLM"],describe(r){const e=ce(r,"hidden_size"),t=ce(r,"num_hidden_layers"),a=ce(r,"vocab_size"),n=ce(r,"state_size"),i=ce(r,"conv_kernel"),o=ce(r,"num_heads"),d=We(r,["n_groups"])??1,s=We(r,["chunk_size"])??256,u=ln(r,e),h=cn(u,e,"Codestral-Mamba"),l=We(r,["head_dim"]);if(u%o!==0)throw new Error(`import/foreign: Codestral-Mamba d_inner ${u} is not divisible by num_heads ${o}`);if(l!==void 0&&l*o!==u)throw new Error(`import/foreign: Codestral-Mamba config is inconsistent — head_dim ${l} × num_heads ${o} = ${l*o}, but d_inner is ${u}`);const c=Array.from({length:t},()=>({type:"mamba2"})),f={vocabSize:a,dModel:e,numLayers:t,layers:c,dState:n,dConv:i,expand:h,nHeads:o,nGroups:d,chunkLen:s},g={vocabSize:a,dModel:e,numLayers:t,dInner:u,dState:n,dConv:i,nHeads:o,nGroups:d};return{modelConfig:f,plan:{adapter:Dt,rules:Ka(g),discards:Ua(g)}}}},Ke=[un,hn,Va];function Xa(r){const e=r.architectures;return Array.isArray(e)?e.filter(t=>typeof t=="string"):[]}function Ya(r){const e=r.model_type;return typeof e=="string"?e:void 0}function Qa(r,e){const t=[...r,e??""].join(" ").toLowerCase();return t.includes("mamba")||t.includes("ssm")?!1:/llama|mistral|qwen|gpt|phi|gemma|falcon(?!_?mamba)|starcoder|deepseek|olmo|attention|forcausallm/.test(t)}function Et(){return Ke.map(r=>`${r.label} — architectures ${r.architectures.join(" / ")}, model_type ${r.modelTypes.join(" / ")}`).join("; ")}function Za(r){const e=Xa(r),t=Ya(r),a=Ke.find(o=>e.some(d=>o.architectures.includes(d)));if(a)return a;const n=t?Ke.find(o=>o.modelTypes.includes(t)):void 0;if(n)return n;const i=e.length>0?`architectures [${e.join(", ")}]`:t?`model_type "${t}"`:"a config declaring neither `architectures` nor `model_type`";throw Qa(e,t)?new Error(`import/foreign: ${i} is a TRANSFORMER checkpoint — its attention weights (q/k/v/o projections, positional embeddings) have no counterpart in a state-space mixer, so no weight port can exist for it at any tensor naming. Transformer coders (IQuest, NousCoder, Maincoder and the like) can only be brought across by DISTILLATION — train this engine's SSM against the transformer's outputs. Weight porting is supported only for: ${Et()}.`):new Error(`import/foreign: unsupported checkpoint — ${i}. Supported: ${Et()}. A transformer checkpoint cannot be weight-ported at all; distillation is the only route.`)}function Ja(r,e){const t=Za(r),{modelConfig:a,plan:n}=t.describe(r);return{...qa(n,e),modelConfig:a}}function Qo(r,e){return Ja(r,fn(e))}function Zo(r,e){const t=r.parameters(),a=new Set(t.map(i=>i.name)),n=[...e.weights.keys()].filter(i=>!a.has(i));if(n.length>0)throw new Error(`import/foreign: ported tensors ${n.slice(0,5).map(i=>`"${i}"`).join(", ")}${n.length>5?` (+${n.length-5} more)`:""} have no parameter on this model — build it from the port's modelConfig`);for(const i of t){const o=e.weights.get(i.name);if(!o)throw new Error(`import/foreign: no ported tensor for parameter "${i.name}" — the model was built from a different config than the port's modelConfig`);if(o.length!==i.numel)throw new Error(`import/foreign: parameter "${i.name}" expects ${i.numel} elements, the port produced ${o.length}`);ge(r.device,i.buf,o)}}function Me(r){throw new Error(`import/foreign: cannot read a Mamba-1 config from these tensors — ${r}`)}function Jo(r){const e=new Map(r.map(m=>[br(m.name),m])),t=m=>e.get(m)?.shape,a=t("backbone.embeddings.weight")??t("backbone.embedding.weight");(!a||a.length!==2)&&Me("no backbone.embedding(s).weight [vocab, d_model]");const[n,i]=a;let o=0;for(;e.has(`backbone.layers.${o}.mixer.in_proj.weight`);)o++;o===0&&Me("no backbone.layers.N.mixer.in_proj.weight");const d="backbone.layers.0.mixer",s=t(`${d}.in_proj.weight`),u=t(`${d}.conv1d.weight`),h=t(`${d}.A_log`),l=t(`${d}.x_proj.weight`);(!u||!h||!l)&&Me("layer 0 is missing conv1d.weight, A_log or x_proj.weight");const c=s[0]/2,f=h[1],g=u[u.length-1],p=l[0]-2*f;return(!Number.isInteger(c)||p<=0)&&Me(`inconsistent shapes (in_proj ${s.join("×")}, x_proj ${l.join("×")})`),{model_type:"mamba",architectures:["MambaForCausalLM"],vocab_size:n,hidden_size:i,num_hidden_layers:o,intermediate_size:c,state_size:f,conv_kernel:g,time_step_rank:p}}function es(r,e,t={}){if(!Number.isInteger(e)||e<=0)throw new Error(`import/foreign: vocabulary size must be a positive integer, got ${e}`);const a=r.modelConfig.vocabSize;if(e===a)return r;const n=r.weights.get("embedding");if(!n)throw new Error('import/foreign: the port has no "embedding" to resize');const i=r.modelConfig.dModel,o=new Float32Array(e*i);o.set(n.subarray(0,Math.min(a,e)*i));const d=[...r.synthesisedTargets];if(e>a){const u=t.std??.02,h=new ve(t.seed??1);o.set(de((e-a)*i,u,()=>h.next()),a*i),d.push({target:"embedding",value:u,reason:`rows ${a}..${e-1} drawn from N(0, ${u}²) to reach a ${e}-token vocabulary`})}const s=new Map(r.weights);return s.set("embedding",o),{...r,weights:s,synthesisedTargets:d,modelConfig:{...r.modelConfig,vocabSize:e}}}const ei=`

struct AdamParams {
    num_elements   : u32,
    lr             : f32,   // learning rate
    beta1          : f32,   // default 0.9
    beta2          : f32,   // default 0.999
    eps            : f32,   // default 1e-8
    weight_decay   : f32,   // default 0.01
    beta1_t        : f32,   // beta1^t  (precomputed bias correction term)
    beta2_t        : f32,   // beta2^t
    max_delta      : f32,   // trust region: max |Δθ| per step (0 ⇒ unbounded)
    _pad0          : f32,   // pad struct to a 16-byte multiple (uniform layout)
    _pad1          : f32,
    _pad2          : f32,
};

@group(0) @binding(0) var<uniform>             adam     : AdamParams;
// param (N,)   – weight tensor (read-write: updated in-place)
@group(0) @binding(1) var<storage, read_write> param    : array<f32>;
// grad  (N,)   – gradient
@group(0) @binding(2) var<storage, read>       grad     : array<f32>;
// m     (N,)   – first moment
@group(0) @binding(3) var<storage, read_write> m_state  : array<f32>;
// v     (N,)   – second moment
@group(0) @binding(4) var<storage, read_write> v_state  : array<f32>;

// NaN or ±Inf, read from the IEEE-754 exponent bits (all ones) — immune to a
// compiler that assumes finite floats and folds "x != x" away.
fn non_finite(x : f32) -> bool {
    return (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u;
}

// Dispatch: (ceil(N / 256), 1, 1)
@compute @workgroup_size(256, 1, 1)
fn adamw_update(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let i = gid.x;
    if (i >= adam.num_elements) { return; }

    let g = grad[i];
    let p = param[i];

    // Moment updates
    let m_new = adam.beta1 * m_state[i] + (1.0 - adam.beta1) * g;
    let v_new = adam.beta2 * v_state[i] + (1.0 - adam.beta2) * g * g;

    // Non-finite gradient (or moments that overflowed): skip this element ENTIRELY —
    // m, v and the weight keep their values. Storing a NaN moment and dropping only
    // the step froze the weight forever (every later step read the NaN back).
    // Mirrors adamwUpdateInPlace (optim/adamw.ts), which counts the skips.
    if (non_finite(g) || non_finite(m_new) || non_finite(v_new)) { return; }
    m_state[i] = m_new;
    v_state[i] = v_new;

    // Bias-corrected estimates
    let m_hat = m_new / (1.0 - adam.beta1_t);
    let v_hat = v_new / (1.0 - adam.beta2_t);

    // Adam step.
    var step = adam.lr * m_hat / (sqrt(v_hat) + adam.eps);

    // Numerical guard: never write a non-finite step into a weight. A NaN or Inf
    // here (from a bad gradient, a zero v_hat, an overflow) would permanently
    // poison the parameter and every future forward — the "model dies" failure.
    // NaN fails self-comparison; treat ±Inf-magnitude as non-finite too.
    if (step != step || step > 3.4e38 || step < -3.4e38) { step = 0.0; }

    // Trust region: bound how far ONE step can move a weight. With write-through
    // adaptation running repeatedly, an unbounded step (even from a noisy
    // gradient) compounds across executions and blows the weights up; clamping
    // the per-element delta keeps every adapt small and reversible. max_delta==0
    // disables the bound (full-training callers that don't set it).
    if (adam.max_delta > 0.0) { step = clamp(step, -adam.max_delta, adam.max_delta); }

    // Weight decay (decoupled) + bounded gradient step
    param[i] = p * (1.0 - adam.lr * adam.weight_decay) - step;
}
`,ts=`

struct ClipParams {
    num_elements : u32,
    max_norm_sq  : f32,   // max_norm^2
};

@group(0) @binding(0) var<uniform>             clip_p  : ClipParams;
@group(0) @binding(1) var<storage, read_write> grad    : array<f32>;
// size 1 – the f32 bit pattern of the accumulated sum of squares, updated
// atomically. Zero-initialise it by writing 0.0f (bit pattern 0x00000000).
@group(0) @binding(2) var<storage, read_write> norm_sq : array<atomic<u32>>;

var<workgroup> local_sq : array<f32, 256>;

// Portable atomic add on an f32 stored as its u32 bit pattern.
fn atomic_add_f32(value: f32) {
    var old_bits : u32 = atomicLoad(&norm_sq[0]);
    loop {
        let new_bits = bitcast<u32>(bitcast<f32>(old_bits) + value);
        let res = atomicCompareExchangeWeak(&norm_sq[0], old_bits, new_bits);
        if (res.exchanged) { break; }
        old_bits = res.old_value;
    }
}

// Pass 1: reduce sum of squares into norm_sq[0]
@compute @workgroup_size(256, 1, 1)
fn grad_norm_reduce(
    @builtin(global_invocation_id)   gid : vec3<u32>,
    @builtin(local_invocation_index) lid : u32,
) {
    let i = gid.x;
    local_sq[lid] = 0.0;
    if (i < clip_p.num_elements) {
        local_sq[lid] = grad[i] * grad[i];
    }
    workgroupBarrier();

    // Parallel reduction within workgroup
    var s: u32 = 128u;
    loop {
        if (s == 0u) { break; }
        if (lid < s) {
            local_sq[lid] = local_sq[lid] + local_sq[lid + s];
        }
        workgroupBarrier();
        s = s >> 1u;
    }

    if (lid == 0u) {
        atomic_add_f32(local_sq[0]);
    }
}

// Pass 2: scale gradients if norm exceeds max_norm
@compute @workgroup_size(256, 1, 1)
fn grad_clip_scale(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let i = gid.x;
    if (i >= clip_p.num_elements) { return; }

    let ns = bitcast<f32>(atomicLoad(&norm_sq[0]));
    if (ns > clip_p.max_norm_sq) {
        let scale = sqrt(clip_p.max_norm_sq / ns);
        grad[i] = grad[i] * scale;
    }
}
`,rs={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},wr={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},yr=8,re=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],ti=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],st=[0,.2,.5,.5,.8,.5,.7,.5];function Te(r,e){const t=ti[r];return t?Number.isNaN(e)?t[0]:Math.max(t[0],Math.min(t[1],e)):e}function ns(r){for(let e=0;e<r.length&&e<yr;e++)r[e]=Te(e,r[e]);return r}function ri(){return Float32Array.from(st)}function vr(r){const e={};for(let t=0;t<re.length;t++)e[re[t]]=r[t]??0;return e}function ni(r){const e=ri();for(let t=0;t<re.length;t++){const a=r[re[t]];typeof a=="number"&&!Number.isNaN(a)&&(e[t]=Te(t,a))}return e}function ae(r){return((typeof r=="number"&&!Number.isNaN(r)?Math.max(0,Math.min(100,r)):50)-50)/50}function xr(r){const e=vr(st);if(!r)return e;const t=ae(r.openness),a=ae(r.emotionality),n=ae(r.conscientiousness),i=ae(r.extraversion),o=ae(r.regulatoryFocus),d=ae(r.riskTolerance),s=ae(r.grit),u=ae(r.stimulation),h=(l,c)=>{e[l]=Te(wr[l],c)};return h("driveCuriosity",.5+.35*t+.15*u),h("exploration",.4+.3*t+.25*d+.15*o),h("driveCaution",.5+.3*n-.3*d-.2*o+.15*a),h("arousal",.2+.2*a+.1*i),h("driveSocial",.5+.35*i),h("driveEffort",.8+.15*s+.1*n),h("valence",0+.1*o-.1*a),h("attention",.7+.1*n),e}function as(r){return ni(xr(r))}function Ue(r,e){return Te(wr[r],e)}function Ve(){return vr(st)}function is(r){if(r.length===0)return Ve();const e=Ve();for(const t of re)e[t]=0;for(const t of r){const a=xr(t);for(const n of re)e[n]+=a[n]}for(const t of re)e[t]/=r.length;return e}function Nt(r,e){const t={...r};for(const a of re){const n=e[a];typeof n=="number"&&!Number.isNaN(n)&&(t[a]=Ue(a,t[a]+n))}return t}const ai=r=>Math.max(0,Math.min(1,r.intensity??.5));function os(r){const e=ai(r);switch(r.kind){case"success":return{valence:.5*e,arousal:-.15*e,driveCaution:-.1*e,driveEffort:-.05*e};case"progress":return{valence:.25*e,arousal:.05*e,driveEffort:-.03*e};case"error":return{valence:-.45*e,arousal:.4*e,driveCaution:.3*e,attention:.15*e};case"blocked":return{valence:-.35*e,arousal:.3*e,driveEffort:-.15*e,driveSocial:.2*e};case"risk":return{arousal:.35*e,driveCaution:.4*e,attention:.2*e,exploration:-.15*e};case"feedback":{const t=Math.sign(r.sign??1)||1;return{valence:.4*e*t,arousal:.1*e,driveSocial:.1*e}}case"idle":return{arousal:-.2*e,driveEffort:.15*e};default:return{}}}function ss(r,e,t={}){const a=t.rate??.1,n=t.fatigue??0,i={...r};for(const o of re)i[o]=Ue(o,i[o]+a*(e[o]-i[o]));return n>0&&(i.driveEffort=Ue("driveEffort",i.driveEffort-n)),i}function ii(r,e=.5){const t=r.arousal-e,a=1-2.8*t*t;return Math.max(.1,Math.min(1,a))}function Xe(r){let e=.5*r.exploration+.3*r.driveCuriosity;return e+=.15*r.valence,e-=.25*(1-r.driveEffort),e-=.2*(r.driveCaution-.5),Math.max(0,Math.min(1,e))}function ds(r,e){if(e.length===0)return{choice:null,exploreBias:Xe(r)};const t=Xe(r);let a=e[0],n=-1/0;for(const i of e){const o=Math.max(0,Math.min(1,i.novelty)),d=-Math.abs(o-t);d>n&&(n=d,a=i)}return{choice:a,exploreBias:t}}const Re=.6,ze=.4;function oi(r){const e=[],t={},a=s=>{t.thinkLevel!=="high"&&(t.thinkLevel=s)};r.valence<=-.4?(e.push("Affect (negative): recent steps have gone badly — slow down, avoid rash or destructive actions, and re-verify your assumptions before proceeding."),a("high"),t.reasoningLevel="on"):r.valence>=.4&&e.push("Affect (positive): things are going well — keep momentum, but don't get sloppy."),r.arousal>=.7?(e.push("Arousal (heightened): you are highly activated — resist the urge to rush; double-check before any irreversible step."),a("high")):r.arousal<=.15&&e.push("Arousal (low): this is routine — keep it lightweight and efficient."),r.driveCaution>=Re?(e.push("Drive (caution): heightened — prefer reversible steps, add guardrails, and confirm risky or destructive operations."),a("medium")):r.driveCaution<=ze&&e.push("Drive (caution): relaxed — bias to action on low-risk work."),r.driveCuriosity>=Re&&e.push("Drive (curiosity): high — it is appropriate to investigate and consider alternative approaches."),r.driveEffort<=ze&&e.push("Drive (effort): energy is low — keep scope tight, avoid over-engineering, checkpoint progress, and consider escalating rather than grinding."),r.driveSocial>=Re?e.push("Drive (social): communicate proactively — surface progress and ask for input when blocked."):r.driveSocial<=ze&&e.push("Drive (social): work heads-down — narrate only what matters."),ii(r)<=.5&&(e.push("Attention (degraded): your attention gate is low — re-read the task carefully and do not skip verification steps."),a("medium"));const i=Xe(r);i>=.7?e.push("Action selection: lean exploratory — try a novel approach before settling on the obvious one."):i<=.3&&e.push("Action selection: lean exploitative — use the proven, known approach and avoid unnecessary detours.");let o=0;o+=.2*(r.exploration-.5)*2,o+=.06*(r.driveCuriosity-.5)*2,o+=.08*r.valence,o-=.16*(r.driveCaution-.5)*2,o-=.08*Math.max(0,r.arousal-.7);const d=Math.max(-.3,Math.min(.3,Math.round(o*100)/100));return Math.abs(d)>=.02&&(t.temperatureDelta=d),{directives:e,params:t}}const si="Current affective state (execute accordingly):";function ls(r){if(!r)return"";const{directives:e}=oi(r);return e.length===0?"":[si,...e.map(t=>`- ${t}`)].join(`
`)}const di=/\b(delete|drop|truncate|destroy|wipe|prod(uction)?|migrat|secret|credential|password|payment|billing|charge|refund|deploy|force[- ]?push|rm\s+-rf|irreversible|security|auth|breaking)\b/i,li=/\b(refactor|rewrite|architecture|complex|large|entire|whole|across|end[- ]to[- ]end|overhaul)\b/i;function cs(r,e=Ve()){const t=r||"";let a=e;return di.test(t)&&(a=Nt(a,{driveCaution:.3,arousal:.25,attention:.15,exploration:-.1})),li.test(t)&&(a=Nt(a,{driveCuriosity:.2,arousal:.1,exploration:.1})),a}const ci={inputDim:32,hiddenDim:16,stateDim:yr,rewardWeight:.5},Pt=1280131651,ui=296863214;class us{config;win;ws;aLogit;woutState;boutState;woutReward;boutReward;gWin;gWs;gALogit;gWoutState;gBoutState;gWoutReward;gBoutReward;constructor(e={}){const t={...ci,...e};if(t.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${t.hiddenDim})`);this.config=t;const{inputDim:a,hiddenDim:n,stateDim:i}=t,o=new ve((e.seed??ui)>>>0||1),d=u=>{const h=Math.max(o.next(),1e-12),l=o.next();return u*Math.sqrt(-2*Math.log(h))*Math.cos(2*Math.PI*l)},s=(u,h)=>{const l=new Float32Array(u);for(let c=0;c<u;c++)l[c]=d(h);return l};this.win=s(n*a,.1),this.ws=s(n*i,.1),this.aLogit=s(n,.05),this.woutState=s(i*n,.05),this.boutState=new Float32Array(i),this.woutReward=s(n,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(e,t,a){const n=this._forwardCached(e,t,a);return{hidden:n.hn,delta:n.delta,reward:n.reward}}_forwardCached(e,t,a){const{inputDim:n,hiddenDim:i,stateDim:o}=this.config,d=Float32Array.from({length:n},(p,m)=>e[m]??0),s=Float32Array.from({length:i},(p,m)=>t[m]??0),u=Float32Array.from({length:o},(p,m)=>a[m]??0),h=new Float32Array(i),l=new Float32Array(i),c=new Float32Array(i);for(let p=0;p<i;p++){let m=0;const _=p*n;for(let w=0;w<n;w++)m+=this.win[_+w]*d[w];const b=p*o;for(let w=0;w<o;w++)m+=this.ws[b+w]*u[w];h[p]=Pe(this.aLogit[p]),l[p]=Math.tanh(m),c[p]=h[p]*s[p]+(1-h[p])*l[p]}const f=new Float32Array(o);for(let p=0;p<o;p++){let m=this.boutState[p];const _=p*i;for(let b=0;b<i;b++)m+=this.woutState[_+b]*c[b];f[p]=Math.tanh(m)}let g=this.boutReward[0];for(let p=0;p<i;p++)g+=this.woutReward[p]*c[p];return{x:d,sPrev:u,hPrev:s,a:h,t:l,hn:c,delta:f,reward:g}}backwardStep(e,t,a,n,i){const{inputDim:o,hiddenDim:d,stateDim:s,rewardWeight:u}=this.config,h=this._forwardCached(e,t,a);let l=0;const c=new Float32Array(s);for(let m=0;m<s;m++){const _=h.delta[m]-(n[m]??0);l+=.5*_*_,c[m]=_}const f=h.reward-i;l+=.5*u*f*f;const g=u*f,p=new Float32Array(d);for(let m=0;m<s;m++){const _=c[m]*(1-h.delta[m]*h.delta[m]);this.gBoutState[m]=this.gBoutState[m]+_;const b=m*d;for(let w=0;w<d;w++)this.gWoutState[b+w]=this.gWoutState[b+w]+_*h.hn[w],p[w]=p[w]+_*this.woutState[b+w]}this.gBoutReward[0]=this.gBoutReward[0]+g;for(let m=0;m<d;m++)this.gWoutReward[m]=this.gWoutReward[m]+g*h.hn[m],p[m]=p[m]+g*this.woutReward[m];for(let m=0;m<d;m++){const _=h.a[m],b=h.t[m];this.gALogit[m]=this.gALogit[m]+p[m]*(h.hPrev[m]-b)*_*(1-_);const w=p[m]*(1-_)*(1-b*b),v=m*o;for(let M=0;M<o;M++)this.gWin[v+M]=this.gWin[v+M]+w*h.x[M];const D=m*s;for(let M=0;M<s;M++)this.gWs[D+M]=this.gWs[D+M]+w*h.sPrev[M]}return{loss:l,hidden:h.hn}}exportWeights(e={}){const t=e.fp16??!1,a=this.parameters(),n=a.reduce((h,l)=>h+l.numel,0),i=5,o=i*4,d=t?n*2:n*4,s=new ArrayBuffer(o+d),u=new Uint32Array(s,0,i);if(u[0]=Pt,u[1]=t?2:1,u[2]=this.config.inputDim,u[3]=this.config.hiddenDim,u[4]=this.config.stateDim,t){const h=new Float32Array(n);let l=0;for(const f of a)h.set(f.data,l),l+=f.numel;const c=Gt(h);new Uint16Array(s,o,n).set(c)}else{const h=new Float32Array(s,o,n);let l=0;for(const c of a)h.set(c.data,l),l+=c.numel}return s}loadWeights(e){const t=new Uint32Array(e,0,5);if(t[0]!==Pt)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const a=t[1],n=t[2],i=t[3],o=t[4];if(n!==this.config.inputDim||i!==this.config.hiddenDim||o!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${n}/${i}/${o} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const d=this.parameters(),s=d.reduce((c,f)=>c+f.numel,0),u=20;let h;a===2?h=Ut(new Uint16Array(e,u,s)):h=new Float32Array(e.slice(u,u+s*4));let l=0;for(const c of d)c.data.set(h.subarray(l,l+c.numel)),l+=c.numel}}const hi=48;function fi(r,e){const t=new ArrayBuffer(hi);return new Uint32Array(t,0,1).set([r]),new Float32Array(t,4,8).set([e.lr,e.beta1,e.beta2,e.eps,e.weightDecay,e.beta1_t,e.beta2_t,e.maxDelta]),t}class kr{label;head;device;_moments=null;_step=0;_skippedNonFinite=0;_adamwPipeline;constructor(e,t=null,a="HeadTrainer"){this.label=a,this.head=e,this.device=t,this._adamwPipeline=t?z(t,ei,"adamw_update"):null}get skippedNonFinite(){return this._skippedNonFinite}get diverged(){return this._skippedNonFinite>0}get gpuTraining(){return this.device!=null&&this._adamwPipeline!=null}_initMoments(){this._moments||(this._moments=this.head.parameters().map(e=>({m:new Float32Array(e.numel),v:new Float32Array(e.numel)})))}async train(e,t={}){if(e.length===0)throw new Error(`${this.label}.train: no samples`);const{learningRate:a=.05,epochs:n=50,weightDecay:i=0,beta1:o=.9,beta2:d=.999,eps:s=1e-8,maxGradNorm:u=1,onEpochEnd:h=null}=t;this._initMoments();const l=[];for(let c=0;c<n;c++){this.head.zeroGrad();let f=0;for(const D of e)f+=this.head.accumulate(D);const g=this.head.gradients(),p=1/e.length;for(const D of g)for(let M=0;M<D.data.length;M++)D.data[M]*=p;const m=mi(g,u);this._step++;const _=Math.pow(o,this._step),b=Math.pow(d,this._step),w={lr:a,weightDecay:i,beta1:o,beta2:d,eps:s,beta1_t:_,beta2_t:b,maxDelta:0};this.gpuTraining?await this._adamwStepGpu(g,w):this._adamwStepCpu(g,w);const v=f/e.length;l.push(v),h&&h(c+1,v,m)}return l}evaluate(e){if(e.length===0)return 0;let t=0;for(const a of e)t+=this.head.loss(a);return t/e.length}_adamwStepCpu(e,t){const a=this.head.parameters();for(let n=0;n<a.length;n++){const i=this._moments[n];this._skippedNonFinite+=Le(a[n].data,e[n].data,i.m,i.v,t)}}async _adamwStepGpu(e,t){const a=this.device,n=this._adamwPipeline,i=this.head.parameters();for(let o=0;o<i.length;o++){const d=i[o],s=this._moments[o];this._skippedNonFinite+=gi(e[o].data);const u=Q(a,d.data,!0),h=Q(a,e[o].data,!1),l=Q(a,s.m,!0),c=Q(a,s.v,!0),f=$(a,fi(d.numel,t)),g=I(a,n,[f,u,h,l,c]);W(a,n,g,[P(d.numel,256),1,1]),d.data.set((await ie(a,u,d.numel*4)).subarray(0,d.numel)),s.m.set((await ie(a,l,d.numel*4)).subarray(0,d.numel)),s.v.set((await ie(a,c,d.numel*4)).subarray(0,d.numel)),u.destroy(),h.destroy(),l.destroy(),c.destroy(),f.destroy()}}}function gi(r){let e=0;for(let t=0;t<r.length;t++)Number.isFinite(r[t])||e++;return e}function mi(r,e){let t=0,a=0;for(const i of r)for(let o=0;o<i.data.length;o++){const d=i.data[o]*i.data[o];t+=d,Number.isFinite(d)&&(a+=d)}const n=Math.sqrt(a);if(n>e&&n>0){const i=e/n;for(const o of r)for(let d=0;d<o.data.length;d++)o.data[d]*=i}return Math.sqrt(t)}function Ar(r){const e=new Float32Array(r.reduce((a,n)=>a+n.numel,0));let t=0;for(const a of r)e.set(a.data,t),t+=a.numel;return e}function Mr(r,e){const t=r.reduce((n,i)=>n+i.numel,0);if(e.length!==t)throw new Error(`assignParams: expected ${t} values, got ${e.length}`);let a=0;for(const n of r){for(let i=0;i<n.numel;i++)n.data[i]=e[a+i];a+=n.numel}}function pi(r){return{parameters:()=>r.parameters(),gradients:()=>r.gradients(),zeroGrad:()=>r.zeroGrad(),accumulate:e=>r.backwardStep(e.input,r.initHidden(),e.state,e.deltaTarget,e.reward).loss,loss:e=>{const{rewardWeight:t}=r.config,a=r.forward(e.input,r.initHidden(),e.state);let n=0;for(let o=0;o<a.delta.length;o++){const d=a.delta[o]-(e.deltaTarget[o]??0);n+=.5*d*d}const i=a.reward-e.reward;return n+=.5*t*i*i,n}}}class hs{model;device;_trainer;constructor(e,t=null){this.model=e,this.device=t,this._trainer=new kr(pi(e),t,"LimbicTrainer")}get gpuTraining(){return this._trainer.gpuTraining}train(e,t={}){return this._trainer.train(e,t)}evaluate(e){return this._trainer.evaluate(e)}}const _i={kind:"regress",id:"limbic.affect",description:"How an experience moves the agent's affective state, and how rewarding it was.",features:{numeric:r=>[...Array.from(r.embedding),...Array.from(r.state)]},engines:[{tier:"local",engine:"head",head:"mlp"}],train:{minSamples:1,trainedBy:"LimbicTrainer"},output:{decode:r=>({delta:Float32Array.from(r.scores.slice(0,-1)),reward:r.scores[r.scores.length-1]??0})}};function fs(r){const{inputDim:e,stateDim:t}=r.config;return{predict(a){if(a.length!==e+t)throw new Error(`limbic.affect: expected ${e+t} features (embedding ${e} + state ${t}), got ${a.length}`);const n=r.forward(a.subarray(0,e),r.initHidden(),a.subarray(e));return{scores:[...Array.from(n.delta),n.reward],confidence:1}},exportParams:()=>Ar(r.parameters()),importParams:a=>Mr(r.parameters(),a)}}const gs=`

struct Dims {
    input_dim  : u32,
    hidden_dim : u32,
    state_dim  : u32,
    _pad       : u32,
};

@group(0) @binding(0)  var<uniform>             dims        : Dims;
@group(0) @binding(1)  var<storage, read>       win         : array<f32>;  // hidden*input
@group(0) @binding(2)  var<storage, read>       ws          : array<f32>;  // hidden*state
@group(0) @binding(3)  var<storage, read>       a_logit     : array<f32>;  // hidden
@group(0) @binding(4)  var<storage, read>       wout_state  : array<f32>;  // state*hidden
@group(0) @binding(5)  var<storage, read>       bout_state  : array<f32>;  // state
@group(0) @binding(6)  var<storage, read>       x_in        : array<f32>;  // input
@group(0) @binding(7)  var<storage, read>       h_prev      : array<f32>;  // hidden
@group(0) @binding(8)  var<storage, read>       s_prev      : array<f32>;  // state
@group(0) @binding(9)  var<storage, read_write> h_out       : array<f32>;  // hidden
@group(0) @binding(10) var<storage, read_write> delta_out   : array<f32>;  // state

var<workgroup> hbuf : array<f32, 64>;

// Single-workgroup dispatch: (1, 1, 1) with workgroup_size 64.
@compute @workgroup_size(64, 1, 1)
fn affect_step(
    @builtin(local_invocation_id) lid : vec3<u32>,
) {
    let j = lid.x;

    // Pass 1: recurrent hidden update (one thread per hidden channel).
    if (j < dims.hidden_dim) {
        var pre : f32 = 0.0;
        for (var i : u32 = 0u; i < dims.input_dim; i = i + 1u) {
            pre = pre + win[j * dims.input_dim + i] * x_in[i];
        }
        for (var k : u32 = 0u; k < dims.state_dim; k = k + 1u) {
            pre = pre + ws[j * dims.state_dim + k] * s_prev[k];
        }
        let a  = 1.0 / (1.0 + exp(-a_logit[j]));
        let hn = a * h_prev[j] + (1.0 - a) * tanh(pre);
        hbuf[j]  = hn;
        h_out[j] = hn;
    }

    workgroupBarrier();

    // Pass 2: bounded affect delta (one thread per state dim).
    if (j < dims.state_dim) {
        var acc : f32 = bout_state[j];
        for (var m : u32 = 0u; m < dims.hidden_dim; m = m + 1u) {
            acc = acc + wout_state[j * dims.hidden_dim + m] * hbuf[m];
        }
        delta_out[j] = tanh(acc);
    }
}
`;function bi(){const r=new Uint8Array(8);return globalThis.crypto.getRandomValues(r),Array.from(r,e=>e.toString(16).padStart(2,"0")).join("")}const wi=new Set(["send","submit","pay","purchase","buy","order","checkout","delete","remove","confirm","transfer","publish","post","sign","approve","book","cancel","erase","wipe","format","uninstall","senden","absenden","bezahlen","kaufen","bestellen","löschen","entfernen","bestätigen","überweisen","veröffentlichen","enviar","pagar","comprar","pedido","eliminar","borrar","confirmar","transferir","publicar","envoyer","payer","acheter","commander","supprimer","confirmer","virement","publier"]),yi=["发送","提交","支付","付款","购买","下单","删除","确认","转账","发布"];function Ct(r){const e=r.toLowerCase();return yi.some(t=>e.includes(t))?!0:e.split(/[^\p{L}\p{N}]+/u).some(t=>t.length>0&&wi.has(t))}function oe(r){return r?r.name.trim()||r.automationId.trim():""}function vi(r){switch(r.kind){case"click":return Ct(oe(r.target));case"keys":return r.keys.toLowerCase()==="enter"&&Ct(oe(r.target));case"setValue":return!1}}function ms(r,e={},t=Date.now()){const a=new Set(e.removed??[]),n=new Set(e.fixed??[]),i=[],o=[];for(const d of r.steps){if(a.has(d.id))continue;const s=d.action;let u;if(s.kind==="setValue")if(!s.secret&&n.has(d.id))u={kind:"setValue",target:s.target,value:{from:"literal",text:s.value}};else{const l=Ft(e.paramNames?.[d.id]??"")||Ft(oe(s.target))||"value",c=xi(i,l);i.push({name:c,label:oe(s.target),default:s.secret?null:s.value,secret:!!s.secret}),u={kind:"setValue",target:s.target,value:{from:"param",name:c}}}else u=s;o.push({id:d.id,action:u,requiresApproval:e.approvals?.[d.id]??vi(s),screenshot:d.screenshot??null})}return{id:bi(),name:e.name?.trim()||r.name,program:r.program,args:[...r.args],params:i,steps:o,sourceEpisode:r.id,createdAt:t,routine:null}}function Ft(r){return r.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join("_").slice(0,40).replace(/_+$/,"")}function xi(r,e){if(!r.some(t=>t.name===e))return e;for(let t=2;;t++){const a=`${e}_${t}`;if(!r.some(n=>n.name===a))return a}}const Oe=6e4,He=864e5;function ki(r,e,t,a){if(r.every==="minutes"){const s=Math.max(1,r.minutes)*Oe;return e==null||t-e>=s}const n=a*Oe,i=t+n,d=i-(i%He+He)%He+Math.min(23,Math.max(0,r.hour))*36e5+Math.min(59,Math.max(0,r.minute))*Oe;return i>=d&&(e==null||e+n<d)}function ps(r,e,t){return r.filter(a=>a.routine?.enabled&&ki(a.routine.schedule,a.routine.lastRunAt,e,t)).sort((a,n)=>(a.routine?.lastRunAt??0)-(n.routine?.lastRunAt??0))}function he(r){const e="target"in r&&r.target?r.target.windowTitle:"";return e?` in “${e}”`:""}function Lr(r){switch(r.kind){case"click":return`Click “${oe(r.target)}”${he(r)}.`;case"keys":return r.target?`Press ${r.keys} in “${oe(r.target)}”${he(r)}.`:`Press ${r.keys}.`;case"setValue":{const e=`“${oe(r.target)}”`;return typeof r.value=="string"?"secret"in r&&r.secret?`Enter the secret for ${e}${he(r)}.`:`Set ${e} to “${r.value}”${he(r)}.`:r.value.from==="param"?`Set ${e} to <${r.value.name}>${he(r)}.`:`Set ${e} to “${r.value.text}”${he(r)}.`}}}function Sr(r){return r.split(/[\\/]/).pop()??r}function Ai(r){const e=[`Task: ${r.name} (${Sr(r.program)})`];return r.steps.forEach((t,a)=>e.push(`${a+1}. ${Lr(t.action)}${t.requiresApproval?" Ask before doing this.":""}`)),e.join(`
`)}function Mi(r){const e=[`Task: ${r.name} (${Sr(r.program)})`];return r.steps.forEach((t,a)=>e.push(`${a+1}. ${Lr(t.action)}`)),e.join(`
`)}function _s(r,e){return dt(r,e).map(t=>t.text).join(`

`)}function dt(r,e){const t=new Set(e.map(a=>a.sourceEpisode));return[...e.map(a=>({id:a.id,text:Ai(a)})),...r.filter(a=>!t.has(a.id)).map(a=>({id:a.id,text:Mi(a)}))]}function bs(r,e){const t=[];let a=[],n=0;for(const i of r){const o=a.length?i.text.length+2:i.text.length;if(a.length&&n+o>e){t.push(a),a=[],n=0,a.push(i),n=i.text.length;continue}a.push(i),n+=o}return a.length&&t.push(a),t}const Li=864e5;function Tt(r,e){return new Date(r+e*6e4).toISOString().slice(0,10)}function ws(r,e){const t=f=>{const g=r.learned[f];return typeof g=="number"&&g>=1&&g<=e.modelIndex},a=dt(r.episodes,r.skills),n=a.filter(f=>t(f.id)).length,i={running:0,succeeded:0,failed:0,stopped:0,denied:0},o={approved:0,denied:0},d=[];for(const f of r.episodes)d.push({region:"hippocampus",kind:"demonstration",id:f.id,name:f.name,at:f.startedAt});for(const f of r.skills)d.push({region:"basalGanglia",kind:"skill",id:f.id,name:f.name,at:f.createdAt});for(const f of r.runs){i[f.status]=(i[f.status]??0)+1,d.push({region:"basalGanglia",kind:"run",id:f.id,name:f.skillName,at:f.startedAt,detail:f.status});for(const g of f.steps)g.outcome!=="approved"&&g.outcome!=="denied"||(o[g.outcome]++,d.push({region:"amygdala",kind:"approval",id:f.id,name:f.skillName,at:g.at,detail:g.outcome}))}const s=r.adaptations.filter(f=>f.index<=e.modelIndex).reverse();for(const f of s)d.push({region:"neocortex",kind:"adaptation",id:f.version,name:f.version,at:f.at,detail:f.loss.toFixed(3)});const u=Math.max(1,e.days??30),h=[],l=new Map;for(let f=u-1;f>=0;f--){const g=Tt(e.now-f*Li,e.utcOffsetMinutes);if(l.has(g))continue;const p={day:g,demonstrations:0,skills:0,runs:0,learned:0};l.set(g,p),h.push(p)}const c=(f,g,p=1)=>{const m=l.get(Tt(f,e.utcOffsetMinutes));m&&(m[g]+=p)};for(const f of r.episodes)c(f.startedAt,"demonstrations");for(const f of r.skills)c(f.createdAt,"skills");for(const f of r.runs)c(f.startedAt,"runs");for(const f of s)c(f.at,"learned",f.learned.length);return{regions:{hippocampus:r.episodes.length,basalGanglia:r.skills.length,amygdala:o.approved+o.denied,hypothalamus:r.skills.filter(f=>f.routine?.enabled).length,neocortex:n},learned:n,pending:a.length-n,runs:i,approvals:o,adaptations:s,days:h,recent:d.sort((f,g)=>g.at-f.at).slice(0,Math.max(0,e.recent??40))}}const Ye="evermind.experience/1",Si=500,Di=200;function Qe(){return{schema:Ye,episodes:[],skills:[],runs:[],learned:{},adaptations:[],curated:{}}}function Bt(r){const e=r;return!e||e.schema!==Ye?Qe():{schema:Ye,episodes:Array.isArray(e.episodes)?e.episodes:[],skills:Array.isArray(e.skills)?e.skills:[],runs:Array.isArray(e.runs)?e.runs:[],learned:e.learned&&typeof e.learned=="object"&&!Array.isArray(e.learned)?e.learned:{},adaptations:Array.isArray(e.adaptations)?e.adaptations:[],curated:e.curated&&typeof e.curated=="object"&&!Array.isArray(e.curated)?e.curated:{}}}function Ei(r){return{id:r.id,name:r.name,program:r.program,startedAt:r.startedAt,steps:r.steps.length}}class fe{onChange;data;constructor(e,t){this.onChange=t,this.data=e?Bt(e):Qe()}load(e){this.data=Bt(e)}async changed(){await this.onChange?.(this.data)}static upsert(e,t){const a=e.findIndex(n=>n.id===t.id);a>=0?e[a]=t:e.push(t)}static remove(e,t){const a=e.findIndex(n=>n.id===t);return a<0?!1:(e.splice(a,1),!0)}async putEpisode(e){fe.upsert(this.data.episodes,e),await this.changed()}async getEpisode(e){return this.data.episodes.find(t=>t.id===e)}async listEpisodes(){return[...this.data.episodes].sort((e,t)=>t.startedAt-e.startedAt).map(Ei)}async deleteEpisode(e){const t=fe.remove(this.data.episodes,e);return delete this.data.learned[e],delete this.data.curated[e],t&&await this.changed(),t}async putSkill(e){fe.upsert(this.data.skills,e),await this.changed()}async getSkill(e){return this.data.skills.find(t=>t.id===e)}async listSkills(){return[...this.data.skills].sort((e,t)=>t.createdAt-e.createdAt)}async deleteSkill(e){const t=fe.remove(this.data.skills,e);return delete this.data.learned[e],delete this.data.curated[e],t&&await this.changed(),t}async putRun(e){fe.upsert(this.data.runs,e),this.data.runs.sort((t,a)=>a.startedAt-t.startedAt),this.data.runs.length=Math.min(this.data.runs.length,Si),await this.changed()}async appendRunStep(e,t){const a=this.data.runs.find(n=>n.id===e);return a?(a.steps.push(t),await this.changed(),!0):!1}async getRun(e){return this.data.runs.find(t=>t.id===e)}async listRuns(e){return this.data.runs.slice(0,Math.max(0,e))}async recordAdaptation(e){for(const t of e.learned)this.data.learned[t]=e.index,delete this.data.curated[t];this.data.adaptations.unshift(e),this.data.adaptations.length=Math.min(this.data.adaptations.length,Di),await this.changed()}async recordCuration(e){for(const t of e.kept)delete this.data.curated[t];Object.assign(this.data.curated,e.dropped),await this.changed()}async snapshot(){return structuredClone(this.data)}async clear(){this.data=Qe(),await this.changed()}}function se(r){switch(r.engine){case"classical":return`local:classical:${r.algorithm}`;case"head":return`local:head:${r.head}`;case"onnx":return`local:onnx:${r.model}`;case"workers-ai":return`cloud:workers-ai:${r.model}`}}class Dr{_tasks=new Map;register(e){if(!gn.test(e.id))throw new Error(`MlTaskRegistry: malformed task id '${e.id}'`);if(this._tasks.has(e.id))throw new Error(`MlTaskRegistry: task '${e.id}' is already registered`);if(e.engines.length===0)throw new Error(`MlTaskRegistry: task '${e.id}' lists no engine`);if(e.kind==="classify"&&!(e.output.labels&&e.output.labels.length>=2))throw new Error(`MlTaskRegistry: classify task '${e.id}' needs at least two output labels`);return this._tasks.set(e.id,e),e}get(e){return this._tasks.get(e)}require(e){const t=this.get(e);if(!t)throw new Error(`MlTaskRegistry: unknown task '${e}'`);return t}has(e){return this._tasks.has(e)}list(){return[...this._tasks.values()]}}async function Er(r,e,t){const a=[];if(r.text){if(!t)throw new Error("extractFeatures: this task embeds text but no embedder was supplied");a.push(await t.embed(r.text(e)))}if(r.numeric){const o=r.numeric(e);for(const d of o)if(!Number.isFinite(d))throw new Error(`extractFeatures: non-finite numeric feature ${d}`);a.push(o)}if(a.length===0)throw new Error("extractFeatures: the feature spec has neither text nor numeric fields");const n=new Float32Array(a.reduce((o,d)=>o+d.length,0));let i=0;for(const o of a)n.set(o,i),i+=o.length;return n}async function Ni(r,e,t){const a=[];for(const n of e)a.push(await Er(r,n,t));return a}function ee(r,e){return Math.log1p(Math.max(0,r))/Math.log1p(Math.max(e,1))}function Pi(r,e,t=4){return e>0?Math.max(0,Math.min(t,r/e)):0}class Ci{_m=new Map;get(e,t){return this._m.get(`${e}|${t}`)}set(e,t,a){this._m.set(`${e}|${t}`,a)}}class ys{capacity;_d=[];constructor(e=500){this.capacity=e}record(e){this._d.push(e),this._d.length>this.capacity&&this._d.splice(0,this._d.length-this.capacity)}list(){return this._d}summary(){const e={},t={};for(const a of this._d){const n=e[a.taskId]??={runs:0,byEngine:{},unanswered:0,meanConfidence:null};if(n.runs++,a.engine==null){n.unanswered++;continue}n.byEngine[a.engine]=(n.byEngine[a.engine]??0)+1;const i=t[a.taskId]??={s:0,n:0};i.s+=a.confidence??0,i.n++,n.meanConfidence=i.s/i.n}return e}}class Nr extends Error{taskId;decision;constructor(e,t){super(`runMlTask(${e}): no engine could answer in '${t.mode}' mode (${t.skipped.map(a=>`${a.engine}: ${a.reason}${a.detail?` (${a.detail})`:""}`).join(", ")||"none allowed"})`),this.taskId=e,this.decision=t,this.name="MlEngineUnavailableError"}}function Fi(r,e,t){switch(e){case"local-only":return r.engines.filter(a=>a.tier==="local");case"hybrid":return[...r.engines.filter(a=>a.tier==="local"),...r.engines.filter(a=>a.tier==="cloud")];case"specific":{if(t==null)throw new Error(`runMlTask(${r.id}): 'specific' mode needs ctx.engine`);const a=typeof t=="string"?t:se(t),n=r.engines.filter(i=>se(i)===a);if(n.length===0)throw new Error(`runMlTask(${r.id}): engine '${a}' is not one of this task's engines`);return n}default:{const a=e;throw new Error(`runMlTask(${r.id}): unknown inference mode '${String(a)}'`)}}}const qe=r=>r instanceof Error?r.message:String(r);async function Ti(r,e,t){const a=t.registry.require(r),n=Fi(a,t.mode,t.engine),i=[];let o=null,d=null,s=null;const u=(l,c)=>(t.decisions?.record({taskId:r,mode:t.mode,engine:se(l),tier:l.tier,confidence:c.confidence,skipped:i}),{output:a.output.decode(c),confidence:c.confidence,engine:l});for(let l=0;l<n.length;l++){const c=n[l],f=se(c);if(c.tier==="local"){const g=t.models?.get(r,f);if(!g){i.push({engine:f,reason:"unavailable"});continue}if(!o&&d==null)try{o=await Er(a.features,e,t.embedder)}catch(_){d=_}if(!o){i.push({engine:f,reason:"error",detail:`features: ${qe(d)}`});continue}let p;try{p=g.predict(o)}catch(_){i.push({engine:f,reason:"error",detail:qe(_)});continue}const m=t.mode==="hybrid"&&!!t.cloud&&n.slice(l+1).some(_=>_.tier==="cloud");if(t.minConfidence!=null&&p.confidence<t.minConfidence&&m){i.push({engine:f,reason:"low-confidence",detail:p.confidence.toFixed(3)}),s??={ref:c,p};continue}return u(c,p)}if(!t.cloud){i.push({engine:f,reason:"unavailable"});continue}try{return u(c,await t.cloud.run({taskId:r,engine:c,input:e}))}catch(g){i.push({engine:f,reason:"error",detail:qe(g)})}}if(s)return u(s.ref,s.p);const h={taskId:r,mode:t.mode,engine:null,tier:null,confidence:null,skipped:i};throw t.decisions?.record(h),new Nr(r,h)}function Pr(r,e){const t=Math.min(r.length,e.length);let a=0;for(let n=0;n<t;n++)a+=r[n]*e[n];return a}function It(r){return Math.sqrt(Pr(r,r))}function Bi(r,e){const t=It(r),a=It(e);return t>0&&a>0?Pr(r,e)/(t*a):0}function be(r,e){const t=Math.min(r.length,e.length);let a=0;for(let n=0;n<t;n++){const i=r[n]-e[n];a+=i*i}return a}function Wt(r){if(r.length===0)return Number.NaN;const e=[...r].sort((a,n)=>a-n),t=e.length>>1;return e.length%2?e[t]:(e[t-1]+e[t])/2}function Ee(r){let e=0;for(const t of r){if(!Number.isInteger(t)||t<0)throw new Error(`class label must be a non-negative integer, got ${t}`);e=Math.max(e,t+1)}return Math.max(e,2)}function ne(r){if(r.length===0)throw new Error("no samples");const e=r[0].length;for(const t of r)if(t.length!==e)throw new Error(`ragged features: expected ${e}, got ${t.length}`);return e}function Ne(r){return r.length?Math.max(...r):0}function Cr(r){const e=new ve(r);return()=>e.next()}function Fr(r){return r<=1?0:r===2?1:2*(Math.log(r-1)+.5772156649)-2*(r-1)/r}class lt{k;metric;classes;_x=[];_y=[];_w=[];constructor(e,t,a){if(this.k=e,this.metric=t,this.classes=a,!(e>=1))throw new Error(`KnnModel: k must be ≥ 1 (got ${e})`)}get size(){return this._x.length}add(e,t=0,a=1){this._x.push(Float32Array.from(e)),this._y.push(t),this._w.push(a)}similarity(e,t){return this.metric==="cosine"?Bi(e,t):1/(1+Math.sqrt(be(e,t)))}neighbours(e,t=this.k,a){const n=[];for(let i=0;i<this._x.length;i++)i!==a&&n.push({index:i,similarity:this.similarity(e,this._x[i])});return n.sort((i,o)=>o.similarity-i.similarity||i.index-o.index),n.slice(0,Math.min(t,n.length))}nearest(e){return this.neighbours(e,1)[0]??null}labelOf(e){return this._y[e]}proba(e,t){const a=new Array(this.classes).fill(0);for(const i of this.neighbours(e,this.k,t)){const o=(this.metric==="cosine"?i.similarity+1:i.similarity)*this._w[i.index]+1e-9;a[this._y[i.index]]+=o}const n=a.reduce((i,o)=>i+o,0);return n>0?a.map(i=>i/n):a.map(()=>1/this.classes)}predict(e){const t=this.proba(e);return{scores:t,confidence:Ne(t)}}excluding(e){if(!(e>=0&&e<this._x.length))throw new Error(`KnnModel.excluding: no point ${e} (size ${this._x.length})`);return{predict:t=>{const a=this.proba(t,e);return{scores:a,confidence:Ne(a)}}}}}function Ii(r,e={}){ne(r.map(i=>i.x));const t=e.classes??Ee(r.map(i=>i.y)),a=e.k??Math.min(5,Math.max(1,Math.floor(Math.sqrt(r.length)))),n=new lt(Math.min(a,r.length),e.metric??"cosine",t);for(const i of r)n.add(i.x,i.y,i.weight??1);return n}class Wi{logPrior;mean;variance;constructor(e,t,a){this.logPrior=e,this.mean=t,this.variance=a}jointLogLikelihood(e){return this.mean.map((t,a)=>{const n=this.variance[a];let i=this.logPrior[a];if(i===-1/0)return i;for(let o=0;o<t.length;o++){const d=(e[o]??0)-t[o];i+=-.5*Math.log(2*Math.PI*n[o])-d*d/(2*n[o])}return i})}predict(e){const t=Array.from(Se(this.jointLogLikelihood(e)));return{scores:t,confidence:Ne(t)}}}function $i(r,e={}){const t=ne(r.map(l=>l.x)),a=e.classes??Ee(r.map(l=>l.y)),n=new Float64Array(a),i=Array.from({length:a},()=>new Float64Array(t)),o=Array.from({length:a},()=>new Float64Array(t));for(const l of r){const c=l.weight??1;n[l.y]=n[l.y]+c;for(let f=0;f<t;f++)i[l.y][f]=i[l.y][f]+c*l.x[f]}for(let l=0;l<a;l++)if(n[l]>0)for(let c=0;c<t;c++)i[l][c]=i[l][c]/n[l];for(const l of r){const c=l.weight??1;for(let f=0;f<t;f++){const g=l.x[f]-i[l.y][f];o[l.y][f]=o[l.y][f]+c*g*g}}let d=0;for(let l=0;l<a;l++)for(let c=0;c<t;c++)o[l][c]=n[l]>0?o[l][c]/n[l]:0,d=Math.max(d,o[l][c]);const s=(e.varSmoothing??1e-9)*Math.max(d,1e-12)+1e-12;for(let l=0;l<a;l++)for(let c=0;c<t;c++)o[l][c]=o[l][c]+s;const u=n.reduce((l,c)=>l+c,0);if(!(u>0))throw new Error("fitNaiveBayes: the samples carry no weight");const h=Float64Array.from(n,l=>l>0?Math.log(l/u):-1/0);return new Wi(h,i,o)}function Tr(r,e,t){if(t.length===0||r!=="classify"&&r!=="regress")return null;let a=0,n=0;for(const i of t){const o=i.weight??1,d=e.predict(i.x),s=r==="classify"?-Math.log(Math.max(d.scores[i.y]??0,1e-12)):.5*(d.scores[0]-i.y)**2;a+=o*s,n+=o}return n>0?a/n:null}class ji{dim;classes;weights;bias;constructor(e,t){this.dim=e,this.classes=t,this.weights=new Float32Array(t*e),this.bias=new Float32Array(t)}logits(e){const t=[];for(let a=0;a<this.classes;a++){let n=this.bias[a];const i=a*this.dim;for(let o=0;o<this.dim;o++)n+=this.weights[i+o]*(e[o]??0);t.push(n)}return t}proba(e){return Array.from(Se(this.logits(e)))}predict(e){const t=this.proba(e);return{scores:t,confidence:Ne(t)}}loss(e){return Tr("classify",this,e)??0}step(e,t,a){const n=new Float64Array(this.weights.length),i=new Float64Array(this.classes);let o=0,d=0;for(const u of e){const h=u.weight??1,l=this.proba(u.x);o+=-h*Math.log(Math.max(l[u.y],1e-12)),d+=h;for(let c=0;c<this.classes;c++){const f=h*(l[c]-(c===u.y?1:0));i[c]=i[c]+f;const g=c*this.dim;for(let p=0;p<this.dim;p++)n[g+p]=n[g+p]+f*u.x[p]}}const s=d>0?1/d:0;for(let u=0;u<this.weights.length;u++)this.weights[u]=this.weights[u]-t*(n[u]*s+a*this.weights[u]);for(let u=0;u<this.classes;u++)this.bias[u]=this.bias[u]-t*i[u]*s;return o*s}exportParams(){const e=new Float32Array(this.weights.length+this.bias.length);return e.set(this.weights,0),e.set(this.bias,this.weights.length),e}importParams(e){if(e.length!==this.weights.length+this.bias.length)throw new Error(`LogisticModel.importParams: expected ${this.weights.length+this.bias.length} values, got ${e.length}`);for(let t=0;t<this.weights.length;t++)this.weights[t]=e[t];for(let t=0;t<this.bias.length;t++)this.bias[t]=e[this.weights.length+t]}}function Ri(r,e={},t){const a=ne(r.map(h=>h.x)),n=e.classes??t?.classes??Ee(r.map(h=>h.y)),i=Ee(r.map(h=>h.y));if(i>n&&r.some(h=>h.y>=n))throw new Error(`fitLogistic: labels go up to ${i-1} but the model has ${n} classes`);const o=t??new ji(a,n);if(o.dim!==a||o.classes!==n)throw new Error(`fitLogistic: init is ${o.dim}×${o.classes}, data is ${a}×${n}`);const d=e.learningRate??.5,s=e.l2??.001,u=e.epochs??300;for(let h=0;h<u;h++)o.step(r,d,s);return o}class $t{weights;intercept;r2;constructor(e,t,a){this.weights=e,this.intercept=t,this.r2=a}value(e){let t=this.intercept;for(let a=0;a<this.weights.length;a++)t+=this.weights[a]*(e[a]??0);return t}predict(e){return{scores:[this.value(e)],confidence:this.r2}}exportParams(){const e=new Float32Array(this.weights.length+1);return e.set(this.weights,0),e[this.weights.length]=this.intercept,e}importParams(e){if(e.length!==this.weights.length+1)throw new Error(`LinearModel.importParams: expected ${this.weights.length+1} values, got ${e.length}`);for(let t=0;t<this.weights.length;t++)this.weights[t]=e[t];this.intercept=e[this.weights.length]}}function zi(r,e,t){for(let n=0;n<t;n++){let i=n;for(let o=n+1;o<t;o++)Math.abs(r[o*t+n])>Math.abs(r[i*t+n])&&(i=o);if(Math.abs(r[i*t+n])<1e-12)throw new Error("solveLinearSystem: singular matrix");if(i!==n){for(let d=0;d<t;d++){const s=r[n*t+d];r[n*t+d]=r[i*t+d],r[i*t+d]=s}const o=e[n];e[n]=e[i],e[i]=o}for(let o=n+1;o<t;o++){const d=r[o*t+n]/r[n*t+n];if(d!==0){for(let s=n;s<t;s++)r[o*t+s]=r[o*t+s]-d*r[n*t+s];e[o]=e[o]-d*e[n]}}}const a=new Float64Array(t);for(let n=t-1;n>=0;n--){let i=e[n];for(let o=n+1;o<t;o++)i-=r[n*t+o]*a[o];a[n]=i/r[n*t+n]}return a}function Oi(r,e={}){const t=ne(r.map(p=>p.x)),a=t+1,n=new Float64Array(a*a),i=new Float64Array(a),o=new Float64Array(a);for(const p of r){const m=p.weight??1;for(let _=0;_<t;_++)o[_]=p.x[_];o[t]=1;for(let _=0;_<a;_++){i[_]=i[_]+m*o[_]*p.y;for(let b=0;b<a;b++)n[_*a+b]=n[_*a+b]+m*o[_]*o[b]}}const d=e.l2??1e-6;for(let p=0;p<t;p++)n[p*a+p]=n[p*a+p]+d;const s=zi(n,i,a),u=new $t(Float32Array.from(s.subarray(0,t)),s[t],0);let h=0,l=0;for(const p of r)h+=p.weight??1,l+=(p.weight??1)*p.y;l/=h;let c=0,f=0;for(const p of r){const m=p.weight??1;c+=m*(p.y-u.value(p.x))**2,f+=m*(p.y-l)**2}const g=f>0?Math.min(1,Math.max(0,1-c/f)):c<1e-12?1:0;return new $t(u.weights,u.intercept,g)}class jt{centroids;inertia;constructor(e,t){this.centroids=e,this.inertia=t}assign(e){let t=0,a=1/0,n=1/0;return this.centroids.forEach((i,o)=>{const d=be(e,i);d<a?(n=a,a=d,t=o):d<n&&(n=d)}),{cluster:t,d1:a,d2:n}}predict(e){const{cluster:t,d1:a,d2:n}=this.assign(e),i=Number.isFinite(n)&&n>0?1-Math.sqrt(a)/Math.sqrt(n):1;return{scores:[t],confidence:Math.max(0,Math.min(1,i))}}}function Hi(r,e={}){const t=r.map(f=>f.x),a=ne(t),n=Math.min(t.length,Math.max(1,e.k??Math.round(Math.sqrt(t.length/2)))),i=Cr(e.seed??27501),o=[Float32Array.from(t[Math.floor(i()*t.length)])],d=t.map(f=>be(f,o[0]));for(;o.length<n;){const f=d.reduce((m,_)=>m+_,0);let g=0;if(f>0){let m=i()*f,_=-1;for(g=0;g<t.length&&!(d[g]>0&&(_=g,m-=d[g],m<=0));g++);g>=t.length&&(g=_)}else g=o.length;const p=Float32Array.from(t[g]);o.push(p),t.forEach((m,_)=>d[_]=Math.min(d[_],be(m,p)))}const s=new Int32Array(t.length).fill(-1),u=()=>{let f=!1;const g=new jt(o,0);return t.forEach((p,m)=>{const _=g.assign(p).cluster;s[m]!==_&&(s[m]=_,f=!0)}),f},h=e.maxIterations??100;let l=!1;for(let f=0;f<h;f++){if(!u()){l=!0;break}const g=o.map(()=>new Float64Array(a)),p=new Array(n).fill(0);t.forEach((m,_)=>{const b=s[_];p[b]=p[b]+1;for(let w=0;w<a;w++)g[b][w]=g[b][w]+m[w]}),o.forEach((m,_)=>{if(p[_]>0)for(let b=0;b<a;b++)m[b]=g[_][b]/p[_]})}l||u();let c=0;return t.forEach((f,g)=>c+=be(f,o[s[g]])),new jt(o,c)}const qi=1.4826,Gi=1.2533;function Br(r,e){return typeof r=="number"?r:r[e]??0}class Ki{center;scale;threshold;constructor(e,t,a){this.center=e,this.scale=t,this.threshold=a}zScores(e){return Array.from(this.center,(t,a)=>Math.abs((e[a]??0)-t)/this.scale[a])}predict(e){const t=Math.max(0,...this.zScores(e))/this.threshold;return{scores:[t],confidence:Be(t)}}}function Be(r){return Math.max(0,Math.min(1,Math.abs(r-1)))}function ct(r,e={}){const t=r.map(s=>s.x),a=ne(t),n=e.minScaleFraction??.01,i=e.minScale??0,o=new Float64Array(a),d=new Float64Array(a);for(let s=0;s<a;s++){const u=t.map(f=>f[s]),h=Wt(u),l=u.map(f=>Math.abs(f-h));let c=qi*Wt(l);c>0||(c=Gi*(l.reduce((f,g)=>f+g,0)/l.length)),o[s]=h,d[s]=Math.max(c,n*Math.abs(h)+1e-9,Br(i,s))}return new Ki(o,d,e.threshold??3.5)}class Ui{mean;variance;alpha;threshold;minScaleFraction;minScale;constructor(e,t,a,n,i,o=0){if(this.mean=e,this.variance=t,this.alpha=a,this.threshold=n,this.minScaleFraction=i,this.minScale=o,!(a>0&&a<=1))throw new Error(`EwmaModel: alpha must be in (0, 1] (got ${a})`)}zScores(e){return Array.from(this.mean,(t,a)=>{const n=Math.max(Math.sqrt(this.variance[a]),this.minScaleFraction*Math.abs(t)+1e-9,Br(this.minScale,a));return Math.abs((e[a]??0)-t)/n})}update(e){for(let t=0;t<this.mean.length;t++){const a=(e[t]??0)-this.mean[t],n=this.alpha*a;this.mean[t]=this.mean[t]+n,this.variance[t]=(1-this.alpha)*(this.variance[t]+a*n)}}predict(e){const t=Math.max(0,...this.zScores(e))/this.threshold;return{scores:[t],confidence:Be(t)}}}function ut(r,e={}){const t=ne(r.map(n=>n.x)),a=new Ui(Float64Array.from(r[0].x),new Float64Array(t),e.alpha??.3,e.threshold??3,e.minScaleFraction??.01,e.minScale??0);for(let n=1;n<r.length;n++)a.update(r[n].x);return a}class Ir{population;trend;constructor(e,t){this.population=e,this.trend=t}featureScores(e){const t=this.population.zScores(e),a=this.trend.zScores(e);return t.map((n,i)=>({population:n/this.population.threshold,trend:a[i]/this.trend.threshold}))}observe(e){this.trend.update(e)}predict(e){const t=Math.max(this.population.predict(e).scores[0],this.trend.predict(e).scores[0]);return{scores:[t],confidence:Be(t)}}}function Vi(r,e={}){return new Ir(ct(r,e.robustZ),ut(r,e.ewma))}function Ze(r,e,t,a){if(e>=t||r.length<=1)return{size:r.length};const n=r[0].length,i=[];for(let c=0;c<n;c++){let f=1/0,g=-1/0;for(const p of r)f=Math.min(f,p[c]),g=Math.max(g,p[c]);g>f&&i.push({f:c,lo:f,hi:g})}if(i.length===0)return{size:r.length};const{f:o,lo:d,hi:s}=i[Math.floor(a()*i.length)],u=d+a()*(s-d),h=r.filter(c=>c[o]<u),l=r.filter(c=>c[o]>=u);return{feature:o,split:u,left:Ze(h,e+1,t,a),right:Ze(l,e+1,t,a)}}function Wr(r,e,t=0){return"size"in r?t+Fr(r.size):Wr(e[r.feature]<r.split?r.left:r.right,e,t+1)}class Xi{trees;sampleSize;threshold;constructor(e,t,a){this.trees=e,this.sampleSize=t,this.threshold=a}score(e){const t=Fr(this.sampleSize);if(t===0)return .5;const a=this.trees.reduce((n,i)=>n+Wr(i,e),0)/this.trees.length;return Math.pow(2,-a/t)}predict(e){const t=this.score(e)/this.threshold;return{scores:[t],confidence:Be(t)}}}function Yi(r,e={}){const t=r.map(d=>d.x);ne(t);const a=Cr(e.seed??5616),n=Math.min(e.sampleSize??256,t.length),i=Math.ceil(Math.log2(Math.max(n,2))),o=[];for(let d=0;d<(e.trees??100);d++){const s=t.map((u,h)=>h);for(let u=0;u<n;u++){const h=u+Math.floor(a()*(s.length-u));[s[u],s[h]]=[s[h],s[u]]}o.push(Ze(s.slice(0,n).map(u=>t[u]),0,i,a))}return new Xi(o,n,e.threshold??.6)}function Rt(r,e){let t=0,a=0;for(const n of r)t+=n.w*n.g,a+=n.w*n.h;return-t/(a+e)}function Ge(r,e,t){return r*r/(e+t)}function Je(r,e,t){if(e>=t.maxDepth||r.length<2)return{value:Rt(r,t.lambda)};let a=0,n=0,i=0;for(const l of r)a+=l.w*l.g,n+=l.w*l.h,i+=l.w;const o=Ge(a,n,t.lambda);let d=null;const s=r[0].x.length;for(let l=0;l<s;l++){const c=[...r].sort((m,_)=>m.x[l]-_.x[l]);let f=0,g=0,p=0;for(let m=0;m<c.length-1;m++){const _=c[m];f+=_.w*_.g,g+=_.w*_.h,p+=_.w;const b=_.x[l],w=c[m+1].x[l];if(b===w||p<t.minLeafWeight||i-p<t.minLeafWeight)continue;const v=Ge(f,g,t.lambda)+Ge(a-f,n-g,t.lambda)-o;v>1e-12&&(!d||v>d.score)&&(d={feature:l,split:(b+w)/2,score:v})}}if(!d)return{value:Rt(r,t.lambda)};const u=r.filter(l=>l.x[d.feature]<d.split),h=r.filter(l=>l.x[d.feature]>=d.split);return{feature:d.feature,split:d.split,left:Je(u,e+1,t),right:Je(h,e+1,t)}}function $r(r,e){for(;!("value"in r);)r=e[r.feature]<r.split?r.left:r.right;return r.value}class Qi{objective;base;trees;learningRate;constructor(e,t,a,n){this.objective=e,this.base=t,this.trees=a,this.learningRate=n}margin(e){let t=this.base;for(const a of this.trees)t+=this.learningRate*$r(a,e);return t}predict(e){const t=this.margin(e);if(this.objective==="regression")return{scores:[t],confidence:1};const a=Pe(t);return{scores:[1-a,a],confidence:Math.max(a,1-a)}}}function Zi(r,e={}){ne(r.map(l=>l.x));const t=e.objective??"binary",a=e.learningRate??.3,n={maxDepth:e.maxDepth??2,minLeafWeight:e.minLeafWeight??1,lambda:e.lambda??1};let i=0,o=0;for(const l of r)i+=l.weight??1,o+=(l.weight??1)*l.y;const d=i>0?o/i:r.reduce((l,c)=>l+c.y,0)/r.length,s=t==="binary"?Math.log(Math.max(d,1e-6)/Math.max(1-d,1e-6)):d,u=r.map(()=>s),h=[];for(let l=0;l<(e.trees??50);l++){const c=r.map((g,p)=>{if(t==="binary"){const m=Pe(u[p]);return{x:g.x,g:m-g.y,h:Math.max(m*(1-m),1e-6),w:g.weight??1}}return{x:g.x,g:u[p]-g.y,h:1,w:g.weight??1}}),f=Je(c,0,n);h.push(f),r.forEach((g,p)=>u[p]=u[p]+a*$r(f,g.x))}return new Qi(t,s,h,a)}function Ji(r,e,t={}){if(e.length===0)throw new Error(`fitClassical(${r}): no samples`);switch(r){case"knn":return Ii(e,t.knn);case"naive-bayes":return $i(e,t["naive-bayes"]);case"logistic":return Ri(e,t.logistic);case"linear":return Oi(e,t.linear);case"kmeans":return Hi(e,t.kmeans);case"robust-z":return ct(e,t["robust-z"]);case"ewma":return ut(e,t.ewma);case"anomaly-composite":return Vi(e,t["anomaly-composite"]);case"isolation-forest":return Yi(e,t["isolation-forest"]);case"gbm-small":return Zi(e,t["gbm-small"])}}class eo{config;_params;_grads;constructor(e){this.config={seed:20045,...e};const{inputDim:t,hiddenDim:a,outputDim:n,objective:i}=this.config;if(i==="mse"&&n!==1)throw new Error("DenseHead: mse objective needs outputDim 1");if(i==="softmax"&&n<2)throw new Error("DenseHead: softmax objective needs outputDim ≥ 2");const o=new ve(this.config.seed),d=()=>o.next(),s=a>0?a:t,u=[...a>0?[["w1",a*t,1/Math.sqrt(t)],["b1",a,0]]:[],["w2",n*s,1/Math.sqrt(s)],["b2",n,0]];this._params=u.map(([h,l,c])=>({name:h,numel:l,data:c>0?de(l,c,d):new Float32Array(l)})),this._grads=u.map(([h,l])=>({name:h,numel:l,data:new Float32Array(l)}))}_p(e){return this._params.find(t=>t.name===e).data}_g(e){return this._grads.find(t=>t.name===e).data}parameters(){return this._params}gradients(){return this._grads}zeroGrad(){for(const e of this._grads)e.data.fill(0)}_forward(e){const{inputDim:t,hiddenDim:a,outputDim:n}=this.config;let i;if(a>0){const u=this._p("w1"),h=this._p("b1");i=new Float32Array(a);for(let l=0;l<a;l++){let c=h[l];for(let f=0;f<t;f++)c+=u[l*t+f]*(e[f]??0);i[l]=Math.tanh(c)}}else i=Float32Array.from({length:t},(u,h)=>e[h]??0);const o=this._p("w2"),d=this._p("b2"),s=new Float32Array(n);for(let u=0;u<n;u++){let h=d[u];for(let l=0;l<i.length;l++)h+=o[u*i.length+l]*i[l];s[u]=h}return{h:i,z:s}}_lossGrad(e,t){if(this.config.objective==="mse"){const i=e[0]-t;return{loss:.5*i*i,dz:Float32Array.of(i)}}const a=Se(e),n=Float32Array.from(a,(i,o)=>i-(o===t?1:0));return{loss:-Math.log(Math.max(a[t]??0,1e-12)),dz:n}}loss(e){return(e.weight??1)*this._lossGrad(this._forward(e.x).z,e.y).loss}accumulate(e){const t=e.weight??1,{inputDim:a,hiddenDim:n,outputDim:i}=this.config,{h:o,z:d}=this._forward(e.x),{loss:s,dz:u}=this._lossGrad(d,e.y),h=this._p("w2"),l=this._g("w2"),c=this._g("b2"),f=new Float32Array(o.length);for(let g=0;g<i;g++){const p=t*u[g];c[g]=c[g]+p;for(let m=0;m<o.length;m++)l[g*o.length+m]=l[g*o.length+m]+p*o[m],f[m]=f[m]+p*h[g*o.length+m]}if(n>0){const g=this._g("w1"),p=this._g("b1");for(let m=0;m<n;m++){const _=f[m]*(1-o[m]*o[m]);p[m]=p[m]+_;for(let b=0;b<a;b++)g[m*a+b]=g[m*a+b]+_*(e.x[b]??0)}}return t*s}predict(e){const{z:t}=this._forward(e);if(this.config.objective==="mse")return{scores:[t[0]],confidence:1};const a=Array.from(Se(t));return{scores:a,confidence:Math.max(...a)}}exportParams(){return Ar(this._params)}importParams(e){Mr(this._params,e)}}function to(r){const e=r.engines.find(t=>t.tier==="local"&&(t.engine==="classical"||t.engine==="head"));if(!e)throw new Error(`trainMlTask(${r.id}): no trainable local engine`);return e}async function zt(r,e,t,a){if(r.train?.fit)return{predictor:await r.train.fit(t,e),skippedNonFinite:0};if(e.engine==="classical")return{predictor:Ji(e.algorithm,t,a.classical),skippedNonFinite:0};if(e.engine==="head"){const n=r.kind==="classify"?"softmax":r.kind==="regress"?"mse":null;if(!n)throw new Error(`trainMlTask(${r.id}): a head engine trains classify or regress tasks only`);const i=new eo({inputDim:t[0].x.length,hiddenDim:e.head==="linear"?0:a.head?.hiddenDim??16,outputDim:n==="softmax"?r.output.labels.length:1,objective:n,...a.head?.seed!=null?{seed:a.head.seed}:{}}),o=new kr(i,a.device??null,`trainMlTask(${r.id})`);return await o.train(t,a.head?.train),{predictor:i,skippedNonFinite:o.skippedNonFinite}}throw new Error(`trainMlTask(${r.id}): engine '${se(e)}' is not trained here`)}async function ro(r,e,t={}){const a=r.train;if(!a)throw new Error(`trainMlTask(${r.id}): task is rule-based or pre-trained only`);if(a.trainedBy)throw new Error(`trainMlTask(${r.id}): trained by ${a.trainedBy}`);if(e.length<a.minSamples)return null;const n=t.engine??to(r),i=await Ni(r.features,e.map(c=>c.input),t.embedder),o=e.map((c,f)=>({x:i[f],y:c.label,...c.weight!=null?{weight:c.weight}:{}})),s=r.kind==="classify"||r.kind==="regress"?t.holdoutFraction??a.holdoutFraction??.2:0,u=Math.floor(o.length*s);let h=null;if(u>=1&&o.length-u>=1){const c=o.slice(0,o.length-u),f=o.slice(o.length-u),g=await zt(r,n,c,t);if(h=Tr(r.kind,g.predictor,f),t.refitOnAll===!1)return t.models?.set(r.id,se(n),g.predictor),{predictor:g.predictor,engine:n,samples:c.length,holdout:u,holdoutLoss:h,skippedNonFinite:g.skippedNonFinite}}const l=await zt(r,n,o,t);return t.models?.set(r.id,se(n),l.predictor),{predictor:l.predictor,engine:n,samples:o.length,holdout:u>=1?u:0,holdoutLoss:h,skippedNonFinite:l.skippedNonFinite}}function vs(r,e,t,a,n={},i){return{task:r,engine:e,version:t,shape:n,params:ir(rr(a)),...i!=null&&Number.isFinite(i)?{evalLoss:i}:{}}}function xs(r){return ar(nt(r.params))}function ks(r,e){return r.manifest.mlHeads?.find(t=>t.task===e)}function As(r,e){return r.withMlHeads([...(r.manifest.mlHeads??[]).filter(t=>t.task!==e.task),e])}function Ms(r,e,t,a){const n=Yt(nt(r.params),rr(e));return mn(n,r.version,t,a??`ml head ${r.task}`,nr(r.task))}function Ls(r,e,t,a={}){const n=nt(r.params),i=nr(r.task),o=[],d=[],s=[];e.forEach((l,c)=>{const f=pn(l.target,i);if(f)return void s.push({index:c,reason:f});if(l.baseVersion!==r.version)return void s.push({index:c,reason:`stale base version ${l.baseVersion} (head is ${r.version})`});let g;try{g=_n(l)}catch(m){return void s.push({index:c,reason:`diff is not base64: ${m instanceof Error?m.message:String(m)}`})}const p=bn(g,n);if(p)return void s.push({index:c,reason:p});o.push(g),d.push(l.weight??1)});const u=Qn(n,o,d,l=>t(ar(l)),{...a,requireEval:a.requireEval??!0});return u.accepted?{head:{...r,version:r.version+1,params:ir(u.checkpoint),...u.newLoss!=null?{evalLoss:u.newLoss}:{}},merge:u,rejected:s}:{head:r,merge:u,rejected:s}}const we={kind:"classify",id:"experience.quality",description:"Is this procedure worth learning from (does it run, and run well)?",features:{text:r=>r.doc.text,numeric:r=>[ee(r.steps,50),ee(r.runs,20)],numericNames:["steps","runs"]},engines:[{tier:"local",engine:"classical",algorithm:"knn"},{tier:"local",engine:"classical",algorithm:"logistic"}],train:{minSamples:12},output:{labels:["low","high"],decode:r=>({label:(r.scores[1]??0)>=.5?"high":"low",pHigh:r.scores[1]??0})}};function no(r,e,t=[]){const a=new Map([...e.map(i=>[i.id,i.steps.length]),...r.map(i=>[i.id,i.steps.length])]),n=new Map;for(const i of t){if(i.status==="running")continue;const o=n.get(i.skillId)??{runs:0,succeeded:0,failed:0};o.runs++,i.status==="succeeded"&&o.succeeded++,i.status==="failed"&&o.failed++,n.set(i.skillId,o)}return dt(r,e).map(i=>({doc:i,steps:a.get(i.id)??0,...n.get(i.id)??{runs:0,succeeded:0,failed:0}}))}function jr(r){return r.runs===0?null:r.succeeded/r.runs>=.5?1:0}const ao=5;function io(r){return r.flatMap(e=>{const t=jr(e);return t==null?[]:[{input:e,label:t}]})}const Rr=.97,et={kind:"cluster",id:"experience.dedupe",description:"Is this procedure a near-copy of one already kept?",features:{text:r=>r.text},engines:[{tier:"local",engine:"classical",algorithm:"knn"}],output:{decode:r=>({nearest:r.scores[0]??-1,similarity:r.scores[1]??0,duplicate:(r.scores[2]??0)===1})}};class oo{threshold;_knn=new lt(1,"cosine",2);constructor(e=Rr){this.threshold=e}get size(){return this._knn.size}add(e){this._knn.add(e)}predict(e){const t=this._knn.nearest(e);if(!t)return{scores:[-1,0,0],confidence:1};const a=t.similarity>=this.threshold;return{scores:[t.index,t.similarity,a?1:0],confidence:Math.abs(t.similarity)}}}const Ot=200;function so(r,e,t){return{get:(a,n)=>{const i=r.get(a,n);return a===e&&i instanceof lt&&t<i.size?i.excluding(t):i},set:(a,n,i)=>r.set(a,n,i)}}function zr(r){const e=new Map;return{dimensions:r.dimensions,fingerprint:r.fingerprint,async embed(t){let a=e.get(t);return a||e.set(t,a=await r.embed(t)),a}}}async function lo(r,e,t){if(r.runs<=0)return null;if(r.runs>=ao)return r.succeeded/r.runs;const a=t==null||!e.models?e:{...e,models:so(e.models,we.id,t)};try{return(await Ti(we.id,r,a)).output.pHigh}catch(n){if(!(n instanceof Nr))throw n;return null}}async function co(r,e){const t=zr(e.embedder),a=new oo(e.dedupeThreshold??Rr),n=[],i=[],o=[],d=e.quality?{...e.quality.ctx,embedder:t}:null,s=new Map((e.quality?.trainedIds??[]).map((h,l)=>[h,l])),u=h=>t.embed(et.features.text(h));for(const h of e.known??[])a.add(await u(h)),n.push(h.id);for(const h of r){if(e.exclude?.has(h.id)){o.push({id:h.id,reason:"excluded"});continue}if(e.quality&&d){const f=await lo(e.quality.input(h),d,s.get(h.id));if(f!=null&&f<(e.quality.minPHigh??.5)){o.push({id:h.id,reason:"low-quality",score:f});continue}}const l=await u(h),c=et.output.decode(a.predict(l));if(c.duplicate){o.push({id:h.id,reason:"duplicate",of:n[c.nearest],score:c.similarity});continue}a.add(l),n.push(h.id),i.push(h)}return{kept:i,dropped:o}}function uo(r,e,t){return!r||r.status!=="curated_out"?!1:r.reason==="duplicate"?r.of!=null&&t.has(r.of):r.reason==="low-quality"?r.runs===e:!1}async function Ss(r,e,t){const a=t.known?.slice(0,Ot),n=zr(t.embedder),i=no(e.episodes,e.skills,e.runs),o=new Map(i.map(_=>[_.doc.id,_])),d=_=>o.get(_.id)??{doc:_,steps:0,runs:0,succeeded:0,failed:0},s=new Set((t.known??[]).map(_=>_.id)),u=[],h=[];for(const _ of r){const b=e.curated?.[_.id];b&&uo(b,d(_).runs,s)?u.push({id:_.id,reason:b.reason,...b.of!=null?{of:b.of}:{},...b.score!=null?{score:b.score}:{}}):h.push(_)}const l=[...r,...t.known??[]].map(_=>o.get(_.id)).filter(_=>_!=null&&jr(_)!=null).slice(0,Ot),c=io(l.reverse()),f=new Dr;f.register(we);const g=new Ci,p=await ro(we,c,{embedder:n,models:g});return{...await co(h,{embedder:n,...a?{known:a}:{},...t.dedupeThreshold!=null?{dedupeThreshold:t.dedupeThreshold}:{},quality:{ctx:{registry:f,mode:"local-only",models:g},input:d,...t.minPHigh!=null?{minPHigh:t.minPHigh}:{},...p?{trainedIds:c.map(_=>_.input.doc.id)}:{}}}),alreadyDropped:u}}function Ds(r,e,t){const a=new Map;for(const i of e.runs)i.status!=="running"&&a.set(i.skillId,(a.get(i.skillId)??0)+1);const n={};for(const i of r.dropped)n[i.id]={status:"curated_out",reason:i.reason,...i.of!=null?{of:i.of}:{},...i.score!=null?{score:i.score}:{},runs:a.get(i.id)??0,at:t};return{dropped:n,kept:r.kept.map(i=>i.id)}}const ho=["promptTokens","contextTokens","contextFill","overflows","tools","turnIndex","attachments","priorLocalSuccessRate","codeHeavy"];function fo(r){const e=Pi(r.promptTokens+r.contextTokens,r.servedContextTokens,4);return[ee(r.promptTokens,1e5),ee(r.contextTokens,1e5),e,e>1?1:0,ee(r.tools,64),ee(r.turnIndex,100),ee(r.attachments??0,16),Math.max(0,Math.min(1,r.priorLocalSuccessRate??.5)),r.codeHeavy?1:0]}const go={kind:"classify",id:"run.local-success",description:"Will this turn succeed on the local model?",features:{numeric:fo,numericNames:ho},engines:[{tier:"local",engine:"classical",algorithm:"logistic"},{tier:"local",engine:"classical",algorithm:"gbm-small"}],train:{minSamples:8},output:{labels:["fails","succeeds"],decode:r=>({succeeds:(r.scores[1]??0)>=.5,probability:r.scores[1]??0})}},mo=.5;function po(r){return r.local?{label:r.local==="succeeded"?1:0,weight:1}:r.fellBack?{label:0,weight:1}:r.cloud==="failed"?{label:0,weight:mo}:null}function Es(r){return r.flatMap(e=>{const t=po(e);return t?[{input:e.turn,label:t.label,weight:t.weight}]:[]})}const Or=["cost","duration","toolFailures"],Hr=1e3,qr=36e5,_o=50;function bo(r){return[ee(r.costUsd*100,Hr),ee(r.durationMs,qr),ee(r.toolFailures,_o)]}const Ht=3,qt=[Math.log(Ht)/(3*Math.log1p(Hr)),Math.log(Ht)/(3*Math.log1p(qr)),.1];class wo extends Ir{explain(e){const t=this.featureScores(e);return Or.map((a,n)=>({metric:a,...t[n]}))}}function yo(r,e={}){return new wo(ct(r,{...e.robustZ,minScale:e.robustZ?.minScale??qt}),ut(r,{...e.ewma,minScale:e.ewma?.minScale??qt}))}const vo={kind:"anomaly",id:"run.anomaly",description:"Did this run cost, take or fail far outside its normal range?",features:{numeric:bo,numericNames:Or},engines:[{tier:"local",engine:"classical",algorithm:"anomaly-composite"}],train:{minSamples:5,fit:r=>yo(r)},output:{decode:r=>({anomalous:(r.scores[0]??0)>=1,score:r.scores[0]??0})}};function Ns(r,e=0){return{costUsd:e,durationMs:r.endedAt!=null?Math.max(0,r.endedAt-r.startedAt):0,toolFailures:r.steps.filter(t=>t.outcome==="failed").length}}const xo=[_i,we,et,vo,go];function Ps(){const r=new Dr;for(const e of xo)r.register(e);return r}export{Eo as ACTIVATIONS_BACKWARD_WGSL,me as ACTIVATIONS_WGSL,Co as ATTENTION_BACKWARD_WGSL,wt as ATTENTION_FORWARD_WGSL,fr as A_LOG_CLAMP_HI,hr as A_LOG_CLAMP_LO,Ur as AdamW,Ir as AnomalyCompositeModel,Pn as AttentionBlock,Vt as BPETokenizer,xo as BUILTIN_ML_TASKS,Ts as BufferPool,mo as CLOUD_ONLY_FAILURE_WEIGHT,Fe as COL_SLICE_ENTRY,Ce as COL_SLICE_WGSL,Po as COMPLEX_SSD_BACKWARD_WGSL,Mn as COMPLEX_SSD_FORWARD_WGSL,Mo as CONV1D_BACKWARD_WGSL,at as CONV1D_FORWARD_WGSL,vt as CPU_GRADIENT_LAYER_TYPES,Bs as CRC_TRAILER_MAGIC,Ot as CURATION_KNOWN_LIMIT,Rr as DEFAULT_DEDUPE_THRESHOLD,ci as DEFAULT_LIMBIC_CONFIG,ui as DEFAULT_LIMBIC_SEED,Is as DEFAULT_LM_CONFIG,Ws as DEFAULT_LM_SEED,ca as DEFAULT_LORA_TARGETS,$s as DEFAULT_MOE_CONFIG,js as DEFAULT_MOE_SEED,Rs as DELTA_TARGET_RE,oo as DedupeIndex,eo as DenseHead,zs as DynamicLossScaler,Un as EVERMIND_ADAPT_MAX_CHARS,et as EXPERIENCE_DEDUPE_TASK,we as EXPERIENCE_QUALITY_TASK,Ye as EXPERIENCE_SCHEMA,Xo as EXPORT_FORMATS,Xt as EvermindLM,Os as EvermindLMLoRA,tt as EvermindLMTrainer,Hs as EvermindModelPackage,Ho as EvermindTextEmbedder,Ui as EwmaModel,Ke as FOREIGN_MAMBA_ADAPTERS,ts as GRAD_CLIP_WGSL,Qi as GbmModel,kr as HeadTrainer,Tn as HybridMambaModel,Ko as ImageRVQCodec,fe as InMemoryExperienceStore,Ci as InMemoryMlModels,Xi as IsolationForestModel,jt as KMeansModel,lt as KnnModel,_i as LIMBIC_AFFECT_TASK,gs as LIMBIC_AFFECT_WGSL,si as LIMBIC_BLOCK_HEADER,ti as LIMBIC_BOUNDS,wr as LIMBIC_DIM,re as LIMBIC_DIM_NAMES,yr as LIMBIC_STATE_DIM,Lo as LINEAR_BACKWARD_WGSL,xe as LINEAR_FORWARD_WGSL,Wn as LN2,ho as LOCAL_SUCCESS_FEATURES,go as LOCAL_SUCCESS_TASK,us as LimbicModel,hs as LimbicTrainer,$t as LinearModel,en as LoRAAdapter,Vr as LoadBalanceAccumulator,ji as LogisticModel,ot as MAMBA1_PARAM_NAMES,Di as MAX_ADAPTATIONS,qs as MAX_DELTA_B64_CHARS,Si as MAX_RUNS,gn as ML_TASK_ID_RE,vn as Mamba1Block,An as Mamba2Block,Sn as Mamba3Block,vn as MambaBlock,Fo as MambaModel,Go as MambaTrainer,ys as MlDecisionLog,Nr as MlEngineUnavailableError,Dr as MlTaskRegistry,To as MoETrainer,Gs as MultimodalVocab,st as NEUTRAL_STATE,Wi as NaiveBayesModel,Ks as PACKAGE_HEADER_BYTES,ao as QUALITY_OBSERVED_MIN_RUNS,rs as REGION,rt as RMSNORM_EPS,Ht as RUN_ANOMALY_FLAG_RATIO,Or as RUN_ANOMALY_METRICS,qt as RUN_ANOMALY_MIN_SCALE,vo as RUN_ANOMALY_TASK,Ki as RobustZModel,wo as RunAnomalyDetector,Ao as SELECTIVE_SCAN_BACKWARD_WGSL,bt as SELECTIVE_SCAN_FORWARD_WGSL,Do as SOFTMAX_BACKWARD_WGSL,So as SOFTMAX_FORWARD_WGSL,Dn as SOFTMAX_WGSL,No as SSD_BACKWARD_WGSL,xn as SSD_FORWARD_WGSL,ve as SeededRng,Us as SharedExpertMoE,Vs as Tensor,Xs as VIDEO_BANK_INTER,Ys as VIDEO_BANK_INTRA,tn as VideoRVQCodec,ei as WEIGHT_UPDATE_WGSL,ua as WSLA_MAX_DELTA,Le as adamwUpdateInPlace,Xn as adaptAndDiff,zo as adaptPackage,qn as adaptationsAfterSkip,Be as anomalyConfidence,Kr as appendCrcTrailer,Qt as applyCheckpointDiff,Nt as applyLimbicDelta,Zo as applyPortedWeights,Qs as applyRowDelta,os as appraiseAmygdala,cs as appraiseTask,er as archOf,Mr as assignParams,Zs as backward,Xe as basalGangliaExploreBias,ds as basalGangliaSelect,nt as base64ToBytes,jn as benchArgmax,jo as benchmarkAdaptationCost,De as benchmarkModel,Bo as benchmarkModelAsync,Wo as benchmarkText,zn as bitsPerToken,ga as buildBatches,fa as buildChunks,mn as buildDeltaLearnPayload,ls as buildLimbicBlock,Ms as buildMlHeadDelta,Uo as buildVideoSequence,ir as bytesToBase64,Fi as candidateEngines,P as cdiv,Te as clampDim,Ue as clampLimbicDim,Pi as clampRatio,ns as clampState,Js as clearTape,Va as codestralMambaAdapter,Io as compareModels,On as compareReports,oi as compileLimbicState,ed as computeRowDelta,an as configJson,cr as corpusToSequences,Bi as cosine,ha as cpuDimsFor,da as cpuModelBackward,sa as cpuModelForward,qo as cpuModelLoss,oa as cpuWeightsFromNamed,Qr as crc32,I as createBindGroup,z as createComputePipeline,S as createEmptyStorageBuffer,Ps as createMlRegistry,Q as createStorageBuffer,$ as createUniformBuffer,Jr as crossEntropyGrad,ye as crossEntropyLoss,co as curateExperience,Ss as curatePendingExperience,Ds as curationRecords,uo as curationStands,_n as decodeDeltaPayload,pn as deltaTargetMismatch,bn as deltaUnusableReason,Ut as dequantizeFp16,td as dequantizeInt8,rd as dequantizeInt8PerChannel,Xr as deserializeRowDelta,Yt as diffCheckpoints,Y as dispatchColumnSlice,W as dispatchKernel,Pr as dot,ps as dueSkills,oe as elementLabel,Qe as emptySnapshot,nd as enableGrad,se as engineKey,ad as estimateMemory,id as evermindTensorSpec,qa as executePortPlan,_s as experienceCorpus,dt as experienceDocuments,ws as experienceOverview,io as experienceQualityExamples,no as experienceQualityInputs,jr as experienceQualityLabel,Ns as experienceRunMetrics,Yo as exportEvermind,Lt as exportGguf,At as exportOnnx,_t as exportSafetensors,Ni as extractFeatureMatrix,Er as extractFeatures,hn as falconMambaAdapter,Vi as fitAnomalyComposite,Ji as fitClassical,ut as fitEwma,Zi as fitGbm,Yi as fitIsolationForest,Hi as fitKMeans,Ii as fitKnn,Oi as fitLinear,Ri as fitLogistic,$i as fitNaiveBayes,ct as fitRobustZ,yo as fitRunAnomaly,Ar as flattenParams,rn as floatToFp16,Za as foreignMambaAdapterFor,Ro as formatAdaptationCostReport,od as fp16ToFloat,sd as fp16View,de as gaussianArray,Vo as generateImage,ma as generateVideo,dn as generationConfigJson,rr as headCheckpoint,ar as headParams,ss as homeostasis,dd as importEvermind,ld as importEvermindTensors,cd as inferArchFromTensors,ud as initWebGPU,ki as isDue,Ct as isIrreversibleLabel,fs as limbicAffectPredictor,pi as limbicHead,xr as limbicSetpoints,Ae as linearBackward,_e as linearForward,Es as localSuccessExamples,fo as localSuccessFeatures,po as localSuccessLabel,hd as logProbOfToken,ee as logScale,fd as mamba1Adapter,ra as mamba1CpuBackward,gr as mamba1CpuForward,un as mambaAdapter,Jo as mambaConfigFromTensors,Oo as meanEvalLoss,is as meanLimbicSetpoints,Yn as mergeCheckpointDiffs,Qn as mergeCheckpointDiffsGated,Ls as mergeMlHeadDeltas,Br as minScaleAt,Tr as mlEvalLoss,vs as mlHeadEntry,xs as mlHeadParams,nr as mlHeadTarget,gd as mlHeadUnusableReason,sn as modelCardMarkdown,tr as namedTensors,ia as namedWeights,vi as needsApproval,Ve as neutralLimbicState,ri as neutralState,bi as newExperienceId,md as noGrad,br as normaliseSourceName,bs as packDocuments,ks as packageMlHead,nn as paramCount,la as paramMatrixShape,pd as parseDeltaLearnPayload,Bt as parseSnapshot,Rn as perplexity,as as personalitySetpoint,Ja as portForeignMamba,Qo as portForeignMambaSafetensors,_d as quantizeBase,Gt as quantizeFp16,bd as quantizeInt8,wd as quantizeInt8PerChannel,yd as randn,ie as readBuffer,vd as recordOperation,ni as recordToState,es as resizePortedVocab,Zt as rmsNormBackward,Jt as rmsNormForward,xd as roundFp16,bo as runAnomalyFeatures,Ti as runMlTask,fn as safetensorsToTensors,Yr as serializeRowDelta,gt as setInitSeed,Pe as sigmoid,pt as silu,mt as siluGrad,Ft as slug,Se as softmax,Zr as softplus,zi as solveLinearSystem,vr as stateToRecord,kd as tensorsToSafetensors,ii as thalamusGate,aa as toNamedGrads,ur as tokenWindows,on as tokenizerJson,$n as topKIndices,$o as trainAndBenchmark,ro as trainMlTask,ms as trainOnce,ge as uploadBuffer,Kt as verifyCrcTrailer,As as withPackageMlHead,na as zeroCpuModelGrads,ta as zeroMamba1Grads};
