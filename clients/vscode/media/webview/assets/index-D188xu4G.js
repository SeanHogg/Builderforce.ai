import{c as z,a as I,d as W,b as C,e as R,f as S,g as fe,h as Z,s as pt,r as we,i as Xt,v as et,u as he,S as ae,j as gt,A as tt,k as Yt,l as Cr,m as Pr,n as Qt,o as Nr,B as rt,p as Jt,q as Zt,t as Tr,w as Se,x as _t,y as er,z as tr,C as rr,D as be,E as bt,F as Ir,R as nt,G as ze,H as de,I as $e,J as Wr,K as zr,L as $r,M as jr,N as Rr,O as wt,P as Or,Q as Kr,T as nr,U as at,V as Hr,W as ar,X as Gr,Y as Ur,Z as qr,_ as or,$ as sr}from"./mamba.worker-BKvstjPu.js";import{a0 as Ns,a1 as Ts,a2 as Is,a3 as Ws,a4 as zs,a5 as $s,a6 as js,a7 as Rs,a8 as Os,a9 as Ks,aa as Hs,ab as Gs,ac as Us,ad as qs,ae as Vs,af as Xs,ag as Ys,ah as Qs,ai as Js,aj as Zs,ak as ei,al as ti,am as ri,an as ni,ao as ai,ap as oi,aq as si,ar as ii,as as di,at as ci,au as li,av as hi,aw as ui,ax as fi,ay as mi,az as pi,aA as gi,aB as _i,aC as bi,aD as wi,aE as yi,aF as vi,aG as xi,aH as ki,aI as Ai,aJ as Mi,aK as Li,aL as Si,aM as Ei,aN as Di,aO as Bi,aP as Fi,aQ as Ci,aR as Pi,aS as Ni,aT as Ti,aU as Ii,aV as Wi,aW as zi,aX as $i,aY as ji,aZ as Ri,a_ as Oi,a$ as Ki,b0 as Hi,b1 as Gi,b2 as Ui,b3 as qi,b4 as Vi,b5 as Xi,b6 as Yi,b7 as Qi,b8 as Ji,b9 as Zi,ba as ed,bb as td,bc as rd,bd as nd,be as ad,bf as od,bg as sd,bh as id,bi as dd,bj as cd,bk as ld,bl as hd,bm as ud,bn as fd,bo as md,bp as pd,bq as gd,br as _d,bs as bd,bt as wd,bu as yd,bv as vd,bw as xd,bx as kd}from"./mamba.worker-BKvstjPu.js";const yt=`

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
`,ot=`

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
`,ue=`

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
`,Eo=`
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
`,Do=`

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
`,Fe=`
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
`,Ce="col_slice";function Y(a,e,t,n,r,o,s,d){const i=z(a,new Uint32Array([r,o,s,d]).buffer),c=I(a,e,[i,t,n]);W(a,e,c,[C(r*d,256),1,1]),i.destroy()}const Vr=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,Xr=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class Yr{layerType="mamba1";device;config;dInner;dtRank;wInProj;bInProj;wConv;bConv;wXProj;bXProj;wDtProj;bDtProj;A_log;D_vec;wOutProj;bOutProj;normWeight;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(t.dModel/16),...t};const{dModel:n,expand:r}=this.config;this.dInner=r*n,this.dtRank=t.dtRank??Math.ceil(n/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:n}=this.config,r=this.dInner,o=t,s=n,d=this.dtRank,i=(l,u=.02)=>fe(l,u),c=l=>new Float32Array(l),h=l=>new Float32Array(l).fill(1);this.wInProj=i(2*r*e),this.bInProj=c(2*r),this.wConv=i(r*s,.01),this.bConv=c(r),this.wXProj=i((d+2*o)*r,.01),this.bXProj=c(d+2*o),this.wDtProj=i(r*d,.02),this.bDtProj=c(r),this.A_log=new Float32Array(r*o);for(let l=0;l<r;l++)for(let u=0;u<o;u++)this.A_log[l*o+u]=Math.log(u+1);this.D_vec=h(r),this.wOutProj=i(e*r,.02),this.bOutProj=c(e),this.normWeight=h(e),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const e=this.device,t=n=>Z(e,n,!0);this.gpuWeights={wInProj:t(this.wInProj),bInProj:t(this.bInProj),wConv:t(this.wConv),bConv:t(this.bConv),wXProj:t(this.wXProj),bXProj:t(this.bXProj),wDtProj:t(this.wDtProj),bDtProj:t(this.bDtProj),A_log:t(this.A_log),D_vec:t(this.D_vec),wOutProj:t(this.wOutProj),bOutProj:t(this.bOutProj),normWeight:t(this.normWeight)}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,xe,"linear_forward"),conv1d:R(e,ot,"conv1d_forward"),silu:R(e,ue,"silu_forward"),rmsnorm:R(e,ue,"rmsnorm_forward"),scan_fwd:R(e,yt,"forward_scan"),scan_reduce:R(e,yt,"forward_reduce"),colSlice:R(e,Fe,Ce),elMul:R(e,Vr,"main"),elAdd:R(e,Xr,"main")}}forward(e,t,n){const r=this.device,{dModel:o,dState:s,dConv:d}=this.config,i=this.dInner,c=s,h=t,l=n,u=h*l,m=this.dtRank,f={},g=S(r,u*o*4,!0),p=S(r,u*4,!0);f.normInv=p,f.normIn=e;{const w=new ArrayBuffer(16);new Uint32Array(w,0,2).set([u,o]),new Float32Array(w,8,1).set([1e-6]);const x=z(r,w),L=I(r,this.pipelines.rmsnorm,[x,e,this.gpuWeights.normWeight,g,p]);W(r,this.pipelines.rmsnorm,L,[C(u,64),1,1])}const _=S(r,u*2*i*4,!0);f.normOut=g;{const w=new Uint32Array([u,o,2*i]).buffer,x=z(r,w),L=I(r,this.pipelines.linear,[x,g,this.gpuWeights.wInProj,this.gpuWeights.bInProj,_]);W(r,this.pipelines.linear,L,[C(u,16),C(2*i,16),1])}const y=S(r,u*i*4,!0),b=S(r,u*i*4,!0);{const w=this.pipelines.colSlice;Y(r,w,_,y,u,2*i,0,i),Y(r,w,_,b,u,2*i,i,i)}_.destroy(),f.zBuf=b,f.xConvIn=y;const v=S(r,u*i*4,!0);f.convOut=v;{const w=new Uint32Array([l,i,d,h,1]).buffer,x=z(r,w),L=I(r,this.pipelines.conv1d,[x,y,this.gpuWeights.wConv,this.gpuWeights.bConv,v]);W(r,this.pipelines.conv1d,L,[C(l,16),C(i,16),h])}const M=S(r,u*i*4,!0);f.siluOut=M;{const w=new Uint32Array([u*i]).buffer,x=z(r,w),L=I(r,this.pipelines.silu,[x,v,M]);W(r,this.pipelines.silu,L,[C(u*i,256),1,1])}const E=S(r,u*(m+2*c)*4,!0);{const w=new Uint32Array([u,i,m+2*c]).buffer,x=z(r,w),L=I(r,this.pipelines.linear,[x,M,this.gpuWeights.wXProj,this.gpuWeights.bXProj,E]);W(r,this.pipelines.linear,L,[C(u,16),C(m+2*c,16),1])}const N=S(r,u*m*4,!0),A=S(r,h*l*c*4,!0),D=S(r,h*l*c*4,!0);{const w=m+2*c,x=this.pipelines.colSlice;Y(r,x,E,N,u,w,0,m),Y(r,x,E,A,u,w,m,c),Y(r,x,E,D,u,w,m+c,c)}E.destroy(),f.B_raw=A,f.C_raw=D;const F=S(r,u*i*4,!0);f.deltaFull=F;{const w=new Uint32Array([u,m,i]).buffer,x=z(r,w),L=I(r,this.pipelines.linear,[x,N,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,F]);W(r,this.pipelines.linear,L,[C(u,16),C(i,16),1])}N.destroy();const O=S(r,h*l*i*4,!0),K=S(r,2*h*l*i*c*4,!0);f.hCache=K;{const w=new Uint32Array([l,c,i,h]).buffer,x=z(r,w),L=I(r,this.pipelines.scan_fwd,[x,M,F,this.gpuWeights.A_log,A,D,this.gpuWeights.D_vec,O,K]);W(r,this.pipelines.scan_fwd,L,[i,c,h]);const $=I(r,this.pipelines.scan_reduce,[x,M,F,this.gpuWeights.A_log,A,D,this.gpuWeights.D_vec,O,K]);W(r,this.pipelines.scan_reduce,$,[C(l,64),i,h])}const G=S(r,u*i*4,!0),j=S(r,u*i*4,!0);{const w=z(r,new Uint32Array([u*i]).buffer),x=I(r,this.pipelines.silu,[w,b,G]);W(r,this.pipelines.silu,x,[C(u*i,256),1,1]);const L=z(r,new Uint32Array([u*i]).buffer),$=I(r,this.pipelines.elMul,[O,G,j,L]);W(r,this.pipelines.elMul,$,[C(u*i,256),1,1])}G.destroy(),O.destroy();const H=S(r,u*o*4,!0);{const w=new Uint32Array([u,i,o]).buffer,x=z(r,w),L=I(r,this.pipelines.linear,[x,j,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,H]);W(r,this.pipelines.linear,L,[C(u,16),C(o,16),1])}j.destroy();const k=S(r,u*o*4,!0);{const w=z(r,new Uint32Array([u*o]).buffer),x=I(r,this.pipelines.elAdd,[H,e,k,w]);W(r,this.pipelines.elAdd,x,[C(u*o,256),1,1])}return H.destroy(),{output:k,cache:f}}parameters(){const{dModel:e,dState:t,dConv:n}=this.config,r=this.dInner,o=t,s=n,d=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*r*e,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*r,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:r*s,name:"wConv"},{buf:this.gpuWeights.bConv,numel:r,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(d+2*o)*r,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:d+2*o,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:r*d,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:r,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:r*o,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:r,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*r,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:e,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const Qr=`
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
`,Bo=`
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
`,Jr=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class Zr{layerType="mamba2";device;config;dInner;dHead;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...t};const{dModel:n,expand:r,nHeads:o}=this.config;if(this.dInner=r*n,this.dHead=this.dInner/o,this.dInner%o!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${o}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:n,nHeads:r,nGroups:o}=this.config,s=this.dInner,d=t,i=n,c=r,h=o,l=(p,_=.02)=>fe(p,_),u=p=>new Float32Array(p),m=p=>new Float32Array(p).fill(1),f=s+2*h*d+c,g=p=>Z(this.device,p,!0);this.gpuWeights={wInProj:g(l(f*e)),wConv:g(l((s+2*h*d)*i,.01)),bConv:g(u(s+2*h*d)),A_log:g(new Float32Array(c).fill(Math.log(1))),dt_bias:g(u(c)),D_vec:g(m(c)),wOutProj:g(l(e*s,.02)),normWeight:g(m(s)),preNormWeight:g(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,xe,"linear_forward"),conv1d:R(e,ot,"conv1d_forward"),colSlice:R(e,Fe,Ce),rmsnorm:R(e,ue,"rmsnorm_forward"),ssd_fwd:R(e,Qr,"ssd_chunk_forward"),elAdd:R(e,Jr,"main")}}forward(e,t,n){const r=this.device,{dModel:o,dState:s,dConv:d,nHeads:i,nGroups:c,chunkLen:h}=this.config,l=this.dInner,u=s,m=d,f=i,g=c,p=this.dHead,_=t,y=n,b=_*y,v=l+2*g*u,M=Math.ceil(y/h),E=S(r,b*o*4,!0),N=S(r,b*4,!0);{const P=new ArrayBuffer(16);new Uint32Array(P,0,2).set([b,o]),new Float32Array(P,8,1).set([1e-6]);const B=z(r,P),U=I(r,this.pipelines.rmsnorm,[B,e,this.gpuWeights.preNormWeight,E,N]);W(r,this.pipelines.rmsnorm,U,[C(b,64),1,1])}N.destroy();const A=l+2*g*u+f,D=S(r,b*A*4,!0);{const P=new Uint32Array([b,o,A]).buffer,B=z(r,P),U=Z(r,new Float32Array(A),!0),J=I(r,this.pipelines.linear,[B,E,this.gpuWeights.wInProj,U,D]);W(r,this.pipelines.linear,J,[C(b,16),C(A,16),1]),U.destroy()}E.destroy();const F=S(r,b*v*4,!0),O=S(r,b*f*4,!0);{const P=this.pipelines.colSlice,B=v+f;Y(r,P,D,F,b,B,0,v),Y(r,P,D,O,b,B,v,f)}D.destroy();const K=S(r,b*v*4,!0);{const P=new Uint32Array([y,v,m,_,1]).buffer,B=z(r,P),U=I(r,this.pipelines.conv1d,[B,F,this.gpuWeights.wConv,this.gpuWeights.bConv,K]);W(r,this.pipelines.conv1d,U,[C(y,16),C(v,16),_])}F.destroy();const G=S(r,b*l*4,!0),j=S(r,b*g*u*4,!0),H=S(r,b*g*u*4,!0);{const P=this.pipelines.colSlice;Y(r,P,K,G,b,v,0,l),Y(r,P,K,j,b,v,l,g*u),Y(r,P,K,H,b,v,l+g*u,g*u)}K.destroy();const k=S(r,(M+1)*_*f*u*p*4,!0),w=S(r,b*l*4,!0);{const P=new Uint32Array([y,l,f,p,g,u,h,M,_]).buffer,B=z(r,P),U=I(r,this.pipelines.ssd_fwd,[B,G,j,H,O,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,w,k]);W(r,this.pipelines.ssd_fwd,U,[M,f,_])}G.destroy(),j.destroy(),H.destroy(),O.destroy();const x=S(r,b*l*4,!0),L=S(r,b*4,!0);{const P=new ArrayBuffer(16);new Uint32Array(P,0,2).set([b,l]),new Float32Array(P,8,1).set([1e-6]);const B=z(r,P),U=I(r,this.pipelines.rmsnorm,[B,w,this.gpuWeights.normWeight,x,L]);W(r,this.pipelines.rmsnorm,U,[C(b,64),1,1])}w.destroy(),L.destroy();const $=S(r,b*o*4,!0);{const P=new Uint32Array([b,l,o]).buffer,B=z(r,P),U=Z(r,new Float32Array(o),!0),J=I(r,this.pipelines.linear,[B,x,this.gpuWeights.wOutProj,U,$]);W(r,this.pipelines.linear,J,[C(b,16),C(o,16),1]),U.destroy()}x.destroy();const q=S(r,b*o*4,!0);{const P=z(r,new Uint32Array([b*o]).buffer),B=I(r,this.pipelines.elAdd,[$,e,q,P]);W(r,this.pipelines.elAdd,B,[C(b*o,256),1,1])}return $.destroy(),{output:q,cache:{stateCarry:k}}}parameters(){const{dModel:e,dState:t,dConv:n,nHeads:r,nGroups:o}=this.config,s=this.dInner,d=t,i=n,c=r,h=o,l=s+2*h*d;return[{buf:this.gpuWeights.wInProj,numel:(s+2*h*d+c)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:l*i,name:"wConv"},{buf:this.gpuWeights.bConv,numel:l,name:"bConv"},{buf:this.gpuWeights.A_log,numel:c,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:c,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:c,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*s,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:s,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const en=`
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
`,Fo=`
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
`,tn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class rn{layerType="mamba3";device;config;dInner;dHead;nComplex;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...t};const{dModel:n,expand:r,nHeads:o}=this.config;if(this.dInner=r*n,this.dHead=this.dInner/o,this.nComplex=this.config.dState,this.dInner%o!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${o}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dConv:t,nHeads:n,nGroups:r}=this.config,o=this.dInner,s=this.nComplex,d=t,i=n,c=r,h=o+2*c*s*2,l=(_,y=.02)=>fe(_,y),u=_=>new Float32Array(_),m=_=>new Float32Array(_).fill(1),f=new Float32Array(i*2);for(let _=0;_<i;_++)f[_*2+0]=0,f[_*2+1]=2*Math.PI*_/i;const g=_=>Z(this.device,_,!0),p=o+2*c*s*2+i;this.gpuWeights={wInProj:g(l(p*e)),wConv:g(l(h*d,.01)),bConv:g(u(h)),A_log:g(f),dt_bias:g(u(i)),D_vec:g(m(i)),wOutProj:g(l(e*o,.02)),normWeight:g(m(o)),preNormWeight:g(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,xe,"linear_forward"),conv1d:R(e,ot,"conv1d_forward"),colSlice:R(e,Fe,Ce),rmsnorm:R(e,ue,"rmsnorm_forward"),cssd_fwd:R(e,en,"complex_ssd_forward"),elAdd:R(e,tn,"main")}}forward(e,t,n){const r=this.device,{dModel:o,dConv:s,nHeads:d,nGroups:i,chunkLen:c}=this.config,h=this.dInner,l=this.nComplex,u=s,m=d,f=i,g=this.dHead,p=t,_=n,y=p*_,b=h+2*f*l*2,v=Math.ceil(_/c),M=S(r,y*o*4,!0),E=S(r,y*4,!0);{const T=new ArrayBuffer(16);new Uint32Array(T,0,2).set([y,o]),new Float32Array(T,8,1).set([1e-6]);const P=z(r,T),B=I(r,this.pipelines.rmsnorm,[P,e,this.gpuWeights.preNormWeight,M,E]);W(r,this.pipelines.rmsnorm,B,[C(y,64),1,1])}E.destroy();const N=h+2*f*l*2+m,A=S(r,y*N*4,!0);{const T=new Uint32Array([y,o,N]).buffer,P=z(r,T),B=Z(r,new Float32Array(N),!0),U=I(r,this.pipelines.linear,[P,M,this.gpuWeights.wInProj,B,A]);W(r,this.pipelines.linear,U,[C(y,16),C(N,16),1]),B.destroy()}M.destroy();const D=S(r,y*b*4,!0),F=S(r,y*m*4,!0);{const T=this.pipelines.colSlice,P=b+m;Y(r,T,A,D,y,P,0,b),Y(r,T,A,F,y,P,b,m)}A.destroy();const O=S(r,y*b*4,!0);{const T=new Uint32Array([_,b,u,p,1]).buffer,P=z(r,T),B=I(r,this.pipelines.conv1d,[P,D,this.gpuWeights.wConv,this.gpuWeights.bConv,O]);W(r,this.pipelines.conv1d,B,[C(_,16),C(b,16),p])}D.destroy();const K=S(r,y*h*4,!0),G=S(r,y*f*l*2*4,!0),j=S(r,y*f*l*2*4,!0);{const T=this.pipelines.colSlice;Y(r,T,O,K,y,b,0,h),Y(r,T,O,G,y,b,h,f*l*2),Y(r,T,O,j,y,b,h+f*l*2,f*l*2)}O.destroy();const H=S(r,(v+1)*p*m*l*2*g*4,!0),k=S(r,y*h*4,!0);{const T=new Uint32Array([_,h,m,g,f,l,c,v,p]).buffer,P=z(r,T),B=I(r,this.pipelines.cssd_fwd,[P,K,G,j,F,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,k,H]);W(r,this.pipelines.cssd_fwd,B,[v,m,p])}K.destroy(),G.destroy(),j.destroy(),F.destroy();const w=S(r,y*h*4,!0),x=S(r,y*4,!0);{const T=new ArrayBuffer(16);new Uint32Array(T,0,2).set([y,h]),new Float32Array(T,8,1).set([1e-6]);const P=z(r,T),B=I(r,this.pipelines.rmsnorm,[P,k,this.gpuWeights.normWeight,w,x]);W(r,this.pipelines.rmsnorm,B,[C(y,64),1,1])}k.destroy(),x.destroy();const L=S(r,y*o*4,!0);{const T=new Uint32Array([y,h,o]).buffer,P=z(r,T),B=Z(r,new Float32Array(o),!0),U=I(r,this.pipelines.linear,[P,w,this.gpuWeights.wOutProj,B,L]);W(r,this.pipelines.linear,U,[C(y,16),C(o,16),1]),B.destroy()}w.destroy();const $=S(r,y*o*4,!0);{const T=z(r,new Uint32Array([y*o]).buffer),P=I(r,this.pipelines.elAdd,[L,e,$,T]);W(r,this.pipelines.elAdd,P,[C(y*o,256),1,1])}return L.destroy(),{output:$,cache:{stateCarry:H}}}parameters(){const{dModel:e,dConv:t,nHeads:n,nGroups:r}=this.config,o=this.dInner,s=this.nComplex,d=t,i=n,c=r,h=o+2*c*s*2;return[{buf:this.gpuWeights.wInProj,numel:(o+2*c*s*2+i)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:h*d,name:"wConv"},{buf:this.gpuWeights.bConv,numel:h,name:"bConv"},{buf:this.gpuWeights.A_log,numel:i*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:i,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:i,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*o,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:o,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const nn=`
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
`,vt=`
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
`,an=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,on=`
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
`;class sn{layerType="attention";device;config;dHead;gpuWeights;pipelines;constructor(e,t){if(this.device=e,t.dModel%t.nHeads!==0)throw new Error(`AttentionBlock: dModel (${t.dModel}) must be divisible by nHeads (${t.nHeads}).`);this.config={dHead:t.dModel/t.nHeads,hasFfn:!1,ffnMult:4,...t},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,hasFfn:t,ffnMult:n}=this.config,r=(i,c=.02)=>fe(i,c),o=i=>new Float32Array(i),s=i=>new Float32Array(i).fill(1),d=i=>Z(this.device,i,!0);if(this.gpuWeights={wQKV:d(r(3*e*e)),bQKV:d(o(3*e)),wO:d(r(e*e)),bO:d(o(e)),normWeight:d(s(e))},t){const i=e*n;this.gpuWeights.wFfn1=d(r(i*e)),this.gpuWeights.bFfn1=d(o(i)),this.gpuWeights.wFfn2=d(r(e*i)),this.gpuWeights.bFfn2=d(o(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,xe,"linear_forward"),rmsnorm:R(e,ue,"rmsnorm_forward"),attn_fwd:R(e,vt,"attention_forward"),attn_val:R(e,vt,"attention_value"),softmax:R(e,nn,"softmax_forward"),colSlice:R(e,Fe,Ce),elAdd:R(e,an,"main")},this.config.hasFfn&&(this.pipelines.silu=R(e,on,"silu_forward"))}forward(e,t,n){const r=this.device,{dModel:o,nHeads:s,hasFfn:d}=this.config,i=this.dHead,c=t,h=n,l=c*h,u=s,m=S(r,l*o*4,!0),f=S(r,l*4,!0);{const A=new ArrayBuffer(16);new Uint32Array(A,0,2).set([l,o]),new Float32Array(A,8,1).set([1e-6]);const D=z(r,A),F=I(r,this.pipelines.rmsnorm,[D,e,this.gpuWeights.normWeight,m,f]);W(r,this.pipelines.rmsnorm,F,[C(l,64),1,1])}f.destroy();const g=S(r,l*3*o*4,!0);{const A=new Uint32Array([l,o,3*o]).buffer,D=z(r,A),F=I(r,this.pipelines.linear,[D,m,this.gpuWeights.wQKV,this.gpuWeights.bQKV,g]);W(r,this.pipelines.linear,F,[C(l,16),C(3*o,16),1])}m.destroy();const p=S(r,l*o*4,!0),_=S(r,l*o*4,!0),y=S(r,l*o*4,!0);{const A=this.pipelines.colSlice;Y(r,A,g,p,l,3*o,0,o),Y(r,A,g,_,l,3*o,o,o),Y(r,A,g,y,l,3*o,2*o,o)}g.destroy();const b=S(r,c*u*h*h*4,!0);{const A=new Uint32Array([c,h,o,u,i]).buffer,D=z(r,A),F=I(r,this.pipelines.attn_fwd,[D,p,_,y,b,S(r,l*o*4,!0)]);W(r,this.pipelines.attn_fwd,F,[C(h,16),u,c])}{const A=new Uint32Array([h,h,1]).buffer,D=z(r,A),F=I(r,this.pipelines.softmax,[D,b]);W(r,this.pipelines.softmax,F,[h,u,c])}const v=S(r,l*o*4,!0);{const A=new Uint32Array([c,h,o,u,i]).buffer,D=z(r,A),F=I(r,this.pipelines.attn_val,[D,p,_,y,b,v]);W(r,this.pipelines.attn_val,F,[C(h,16),u,c])}p.destroy(),_.destroy(),y.destroy();const M=S(r,l*o*4,!0);{const A=new Uint32Array([l,o,o]).buffer,D=z(r,A),F=I(r,this.pipelines.linear,[D,v,this.gpuWeights.wO,this.gpuWeights.bO,M]);W(r,this.pipelines.linear,F,[C(l,16),C(o,16),1])}v.destroy();let E=S(r,l*o*4,!0);{const A=z(r,new Uint32Array([l*o]).buffer),D=I(r,this.pipelines.elAdd,[M,e,E,A]);W(r,this.pipelines.elAdd,D,[C(l*o,256),1,1])}if(M.destroy(),d){const{ffnMult:A}=this.config,D=o*A,F=S(r,l*D*4,!0);{const j=new Uint32Array([l,o,D]).buffer,H=z(r,j),k=I(r,this.pipelines.linear,[H,E,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,F]);W(r,this.pipelines.linear,k,[C(l,16),C(D,16),1])}const O=S(r,l*D*4,!0);{const j=z(r,new Uint32Array([l*D]).buffer),H=I(r,this.pipelines.silu,[j,F,O]);W(r,this.pipelines.silu,H,[C(l*D,256),1,1])}F.destroy();const K=S(r,l*o*4,!0);{const j=new Uint32Array([l,D,o]).buffer,H=z(r,j),k=I(r,this.pipelines.linear,[H,O,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,K]);W(r,this.pipelines.linear,k,[C(l,16),C(o,16),1])}O.destroy();const G=S(r,l*o*4,!0);{const j=z(r,new Uint32Array([l*o]).buffer),H=I(r,this.pipelines.elAdd,[K,E,G,j]);W(r,this.pipelines.elAdd,H,[C(l*o,256),1,1])}K.destroy(),E.destroy(),E=G}return{output:E,cache:{scores:b}}}parameters(){const{dModel:e,hasFfn:t,ffnMult:n}=this.config,r=[{buf:this.gpuWeights.wQKV,numel:3*e*e,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*e,name:"bQKV"},{buf:this.gpuWeights.wO,numel:e*e,name:"wO"},{buf:this.gpuWeights.bO,numel:e,name:"bO"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}];if(t){const o=e*n;r.push({buf:this.gpuWeights.wFfn1,numel:o*e,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:o,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:e*o,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:e,name:"bFfn2"})}return r}getTrainableParams(){return this.parameters()}setWSLAMode(e){}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}function Pe(a){const e=new ArrayBuffer(4),t=new Float32Array(e),n=new Uint32Array(e);t[0]=a;const r=n[0],o=r>>>31&1,s=r>>>23&255,d=r&8388607;if(s===255)return o<<15|31744|(d?512:0);const i=s-127+15;if(i>=31)return o<<15|31744;if(i<=0){if(i<-10)return o<<15;const c=14-i;return o<<15|(d|8388608)>>c}return o<<15|i<<10|d>>13}function st(a){const e=a>>>15&1,t=a>>>10&31,n=a&1023;if(t===0){const s=n/1024*Math.pow(2,-14);return e?-s:s}if(t===31)return e?-1/0:n?NaN:1/0;const r=t-15,o=(1+n/1024)*Math.pow(2,r);return e?-o:o}function ke(a){const e=new Uint16Array(a.length);for(let t=0;t<a.length;t++)e[t]=Pe(a[t]);return e}function Ae(a){const e=new Float32Array(a.length);for(let t=0;t<a.length;t++)e[t]=st(a[t]);return e}function dn(a){let e=0;for(let r=0;r<a.length;r++){const o=Math.abs(a[r]);o>e&&(e=o)}const t=e/127||1,n=new Int8Array(a.length);for(let r=0;r<a.length;r++)n[r]=Math.max(-128,Math.min(127,Math.round(a[r]/t)));return{data:n,scale:t}}function cn(a,e){const t=new Float32Array(a.length);for(let n=0;n<a.length;n++)t[n]=a[n]*e;return t}function Po(a,e){const t=a.length/e,n=new Float32Array(e),r=new Int8Array(a.length);for(let o=0;o<e;o++){let s=0;const d=o*t;for(let i=0;i<t;i++){const c=Math.abs(a[d+i]);c>s&&(s=c)}n[o]=s/127||1;for(let i=0;i<t;i++)r[d+i]=Math.max(-128,Math.min(127,Math.round(a[d+i]/n[o])))}return{data:r,scales:n}}function No(a,e,t){const n=a.length/t,r=new Float32Array(a.length);for(let o=0;o<t;o++){const s=o*n;for(let d=0;d<n;d++)r[s+d]=a[s+d]*e[o]}return r}function To(a){return{fp32:a*4,fp16:a*2,int8:a*1}}const xt=1296190035,ln={mamba1:0,mamba2:1,mamba3:2,attention:3},hn=["mamba1","mamba2","mamba3","attention"];class un{device;config;gpuEmbedding;layers;layerSpecs;gpuFinalNorm;tiedEmbedding;gpuLMHeadBias;_lmHeadPipeline;_rmsnormPipeline;_embedPipeline;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...t},pt(this.config.seed);const n=t.layers??Array.from({length:t.numLayers},()=>({type:"mamba1"}));if(n.length!==t.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${n.length}) must equal numLayers (${t.numLayers}).`);this.layerSpecs=n;const{vocabSize:r,dModel:o}=this.config,s=fe(r*o,1/Math.sqrt(o));this.gpuEmbedding=Z(e,s,!0),this.layers=n.map(d=>this._buildLayer(d)),pt(void 0),this.gpuFinalNorm=Z(e,new Float32Array(o).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=Z(e,new Float32Array(r),!0),this._lmHeadPipeline=R(e,xe,"linear_forward"),this._rmsnormPipeline=R(e,ue,"rmsnorm_forward"),this._embedPipeline=R(e,fn,"embed_lookup")}_buildLayer(e){const t=this.config;switch(e.type){case"mamba1":{const n={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,...t.defaultMamba1};return new Yr(this.device,{...n,...e.config??{}})}case"mamba2":{const n={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,...t.defaultMamba2};return new Zr(this.device,{...n,...e.config??{}})}case"mamba3":{const n={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,mimoGroup:t.mimoGroup,...t.defaultMamba3};return new rn(this.device,{...n,...e.config??{}})}case"attention":{const n={dModel:t.dModel,nHeads:t.nHeads,...t.defaultAttention};return new sn(this.device,{...n,...e.config??{}})}}}embedTokens(e,t,n){const{dModel:r}=this.config,o=t*n,s=Z(this.device,e instanceof Uint32Array?e:new Uint32Array(e),!1),d=S(this.device,o*r*4,!0),i=z(this.device,new Uint32Array([o,r]).buffer),c=I(this.device,this._embedPipeline,[i,s,this.gpuEmbedding,d]);return W(this.device,this._embedPipeline,c,[C(o,64),1,1]),s.destroy(),i.destroy(),d}async forward(e,t,n){const{dModel:r,vocabSize:o}=this.config,s=t*n;let d=this.embedTokens(e,t,n);const i=[];for(const m of this.layers){const{output:f,cache:g}=m.forward(d,t,n);i.push(g),d.destroy(),d=f}const c=S(this.device,s*r*4,!0),h=S(this.device,s*4,!1);{const m=new ArrayBuffer(16);new Uint32Array(m,0,2).set([s,r]),new Float32Array(m,8,1).set([1e-6]);const f=z(this.device,m),g=I(this.device,this._rmsnormPipeline,[f,d,this.gpuFinalNorm,c,h]);W(this.device,this._rmsnormPipeline,g,[C(s,64),1,1])}d.destroy();const l=S(this.device,s*o*4,!0);{const m=new Uint32Array([s,r,o]).buffer,f=z(this.device,m),g=I(this.device,this._lmHeadPipeline,[f,c,this.gpuEmbedding,this.gpuLMHeadBias,l]);W(this.device,this._lmHeadPipeline,g,[C(s,16),C(o,16),1])}return c.destroy(),h.destroy(),{logits:await we(this.device,l,s*o*4),gpuLogits:l,caches:i}}async embed(e){const{dModel:t}=this.config,n=e.length,r=1,o=r*n;if(o===0)return new Float32Array(t);let s=this.embedTokens(e,r,n);for(const u of this.layers){const{output:m}=u.forward(s,r,n);s.destroy(),s=m}const d=S(this.device,o*t*4,!0),i=S(this.device,o*4,!1);{const u=new ArrayBuffer(16);new Uint32Array(u,0,2).set([o,t]),new Float32Array(u,8,1).set([1e-6]);const m=z(this.device,u),f=I(this.device,this._rmsnormPipeline,[m,s,this.gpuFinalNorm,d,i]);W(this.device,this._rmsnormPipeline,f,[C(o,64),1,1])}s.destroy();const c=await we(this.device,d,o*t*4);d.destroy(),i.destroy();const h=new Float32Array(t);for(let u=0;u<n;u++){const m=u*t;for(let f=0;f<t;f++)h[f]+=c[m+f]}for(let u=0;u<t;u++)h[u]/=n;let l=0;for(let u=0;u<t;u++)l+=h[u]*h[u];l=Math.sqrt(l)||1;for(let u=0;u<t;u++)h[u]/=l;return h}async generate(e,t=200,n={}){const{temperature:r=1,topK:o=50,topP:s=.9}=n,{vocabSize:d}=this.config,i=[...e];for(let c=0;c<t;c++){const{logits:h}=await this.forward(new Uint32Array(i),1,i.length),l=h.slice((i.length-1)*d,i.length*d),u=mn(l,{temperature:r,topK:o,topP:s});if(i.push(u),u===this.config.eosId)break}return i}parameters(){const e=[];e.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let t=0;t<this.layers.length;t++)for(const n of this.layers[t].parameters())e.push({...n,name:`layer${t}.${n.name}`});return e.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),e}getTrainableParams(){if(!this._wslaMode)return this.parameters();const e=[];for(let t=0;t<this.layers.length;t++)for(const n of this.layers[t].getTrainableParams())e.push({...n,name:`layer${t}.${n.name}`});return e}setWSLAMode(e){for(const t of this.layers)t.setWSLAMode(e);this._wslaMode=e}async exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.length,o=this.layers.length,s=await Promise.all(n.map(g=>we(this.device,g.buf,g.numel*4))),d=Math.ceil(o/4)*4,i=12+d+4+r*4,c=t?2:4,l=s.reduce((g,p)=>g+p.length,0)*c,u=new ArrayBuffer(i+l),m=new DataView(u);let f=0;m.setUint32(f,xt,!0),f+=4,m.setUint32(f,t?3:2,!0),f+=4,m.setUint32(f,o,!0),f+=4;for(let g=0;g<o;g++){const p=this.layers[g].layerType;m.setUint8(f+g,ln[p])}f+=d,m.setUint32(f,r,!0),f+=4;for(const g of n)m.setUint32(f,g.numel,!0),f+=4;if(t)for(const g of s){const p=ke(g);new Uint16Array(u,f,p.length).set(p),f+=p.length*2}else for(const g of s)new Float32Array(u,f,g.length).set(g),f+=g.byteLength;return Xt(u)}async loadWeights(e){const t=et(e);if(t.hasTrailer&&!t.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const n=new DataView(e);let r=0;const o=n.getUint32(r,!0);if(r+=4,o!==xt)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const s=n.getUint32(r,!0);if(r+=4,s===1){const d=n.getUint32(r,!0);r+=4;const i=this.parameters();if(d!==i.length)throw new Error(`Weight file has ${d} parameters but this model has ${i.length}.`);const c=[];for(let h=0;h<d;h++)c.push(n.getUint32(r,!0)),r+=4;for(let h=0;h<d;h++){const l=i[h],u=c[h];if(u!==l.numel)throw new Error(`Parameter ${h} ("${l.name}") size mismatch: file=${u}, model=${l.numel}.`);he(this.device,l.buf,new Float32Array(e,r,l.numel)),r+=l.numel*4}return}if(s===2||s===3){const d=s===3,i=n.getUint32(r,!0);if(r+=4,i!==this.layers.length)throw new Error(`Weight file has ${i} layers but this model has ${this.layers.length}.`);for(let m=0;m<i;m++){const f=n.getUint8(r+m),g=this.layers[m].layerType,p=hn[f]??"mamba1";if(p!==g)throw new Error(`Layer ${m} type mismatch: file="${p}", model="${g}".`)}const c=Math.ceil(i/4)*4;r+=c;const h=n.getUint32(r,!0);r+=4;const l=this.parameters();if(h!==l.length)throw new Error(`Weight file has ${h} parameters but this model has ${l.length}.`);const u=[];for(let m=0;m<h;m++)u.push(n.getUint32(r,!0)),r+=4;for(let m=0;m<h;m++){const f=l[m],g=u[m];if(g!==f.numel)throw new Error(`Parameter ${m} ("${f.name}") size mismatch: file=${g}, model=${f.numel}.`);if(d){const p=new Uint16Array(e,r,g);he(this.device,f.buf,Ae(p)),r+=g*2}else he(this.device,f.buf,new Float32Array(e,r,f.numel)),r+=g*4}return}throw new Error(`Unsupported MBJS version: ${s}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const e of this.layers)e.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class Io extends un{constructor(e,t){super(e,{...t,layers:Array.from({length:t.numLayers},()=>({type:"mamba1"}))})}}const fn=`
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
`;function mn(a,{temperature:e=1,topK:t=50,topP:n=.9}={}){const r=a.length,o=new Float32Array(r);for(let p=0;p<r;p++)o[p]=a[p]/Math.max(e,1e-7);let s=-1/0;for(let p=0;p<r;p++)o[p]>s&&(s=o[p]);let d=0;const i=new Float32Array(r);for(let p=0;p<r;p++)i[p]=Math.exp(o[p]-s),d+=i[p];const h=Array.from({length:r},(p,_)=>_).sort((p,_)=>i[_]-i[p]).slice(0,t);let l=0;const u=[];for(const p of h)if(l+=i[p]/d,u.push(p),l>=n)break;let m=0;for(const p of u)m+=i[p];const f=Math.random()*m;let g=0;for(const p of u)if(g+=i[p],g>=f)return p;return u[u.length-1]}const pn={modelDim:64,hiddenDim:128,numExperts:8,topK:2},gn=1299137793,kt=1299137840;function _n(a){return a>0?a:0}class At{modelDim;hiddenDim;w1;b1;w2;b2;gW1;gB1;gW2;gB2;constructor(e,t,n){this.modelDim=e,this.hiddenDim=t,this.w1=n(t*e,Math.sqrt(2/e)),this.b1=new Float32Array(t),this.w2=n(e*t,.02),this.b2=new Float32Array(e),this.gW1=new Float32Array(this.w1.length),this.gB1=new Float32Array(this.b1.length),this.gW2=new Float32Array(this.w2.length),this.gB2=new Float32Array(this.b2.length)}forward(e){const{modelDim:t,hiddenDim:n}=this,r=new Float32Array(n),o=new Float32Array(n);for(let d=0;d<n;d++){let i=this.b1[d];const c=d*t;for(let h=0;h<t;h++)i+=this.w1[c+h]*e[h];r[d]=i,o[d]=_n(i)}const s=new Float32Array(t);for(let d=0;d<t;d++){let i=this.b2[d];const c=d*n;for(let h=0;h<n;h++)i+=this.w2[c+h]*o[h];s[d]=i}return{y:s,pre:r,h:o}}backward(e,t,n,r){const{modelDim:o,hiddenDim:s}=this,d=new Float32Array(s);for(let c=0;c<o;c++){const h=e[c];this.gB2[c]=this.gB2[c]+h;const l=c*s;for(let u=0;u<s;u++)this.gW2[l+u]=this.gW2[l+u]+h*r[u],d[u]=d[u]+h*this.w2[l+u]}const i=new Float32Array(o);for(let c=0;c<s;c++){const h=n[c]>0?d[c]:0;this.gB1[c]=this.gB1[c]+h;const l=c*o;for(let u=0;u<o;u++)this.gW1[l+u]=this.gW1[l+u]+h*t[u],i[u]=i[u]+h*this.w1[l+u]}return i}params(){return[this.w1,this.b1,this.w2,this.b2]}grads(){return[this.gW1,this.gB1,this.gW2,this.gB2]}}class bn{numExperts;counts;probSum;tokens=0;constructor(e){this.numExperts=e,this.counts=new Float32Array(e),this.probSum=new Float32Array(e)}observe(e){this.tokens++;for(const t of e.experts)this.counts[t]=this.counts[t]+1;for(let t=0;t<this.numExperts;t++)this.probSum[t]=this.probSum[t]+e.probs[t]}dispatchFractions(){const e=this.counts.reduce((t,n)=>t+n,0)||1;return Float32Array.from(this.counts,t=>t/e)}loss(){if(this.tokens===0)return 0;const e=this.dispatchFractions();let t=0;for(let n=0;n<this.numExperts;n++)t+=e[n]*(this.probSum[n]/this.tokens);return this.numExperts*t}}class ir{config;wr;gWr;shared;experts;constructor(e={}){const t={...pn,...e};if(t.topK>t.numExperts)throw new Error(`MoE topK (${t.topK}) must be ≤ numExperts (${t.numExperts})`);if(t.topK<1)throw new Error(`MoE topK must be ≥ 1 (got ${t.topK})`);this.config=t;const n=new ae((e.seed??gn)>>>0||1),r=(o,s)=>{const d=new Float32Array(o);for(let i=0;i<o;i++){const c=Math.max(n.next(),1e-12),h=n.next();d[i]=s*Math.sqrt(-2*Math.log(c))*Math.cos(2*Math.PI*h)}return d};this.wr=r(t.numExperts*t.modelDim,.02),this.gWr=new Float32Array(this.wr.length),this.shared=new At(t.modelDim,t.hiddenDim,r),this.experts=Array.from({length:t.numExperts},()=>new At(t.modelDim,t.hiddenDim,r))}route(e){const{numExperts:t,topK:n,modelDim:r}=this.config,o=new Float32Array(t);for(let l=0;l<t;l++){let u=0;const m=l*r;for(let f=0;f<r;f++)u+=this.wr[m+f]*e[f];o[l]=u}const s=gt(o),i=Array.from({length:t},(l,u)=>u).sort((l,u)=>o[u]-o[l]).slice(0,n),c=i.map(l=>o[l]),h=gt(Float32Array.from(c));return{experts:i,gates:Array.from(h),probs:s}}forward(e){const{modelDim:t}=this.config,n=Float32Array.from({length:t},(h,l)=>e[l]??0),r=this.route(n),o=this.shared.forward(n),s=Float32Array.from(o.y),d=[],i=[],c=[];for(let h=0;h<r.experts.length;h++){const u=this.experts[r.experts[h]].forward(n),m=r.gates[h];for(let f=0;f<t;f++)s[f]=s[f]+m*u.y[f];d.push(u.y),i.push(u.pre),c.push(u.h)}return{output:s,route:r,cache:{x:n,route:r,sharedPre:o.pre,sharedH:o.h,expertOut:d,expertPre:i,expertH:c}}}backward(e,t){const{modelDim:n}=this.config,r=Float32Array.from({length:n},(l,u)=>e[u]??0),o=new Float32Array(n),s=this.shared.backward(r,t.x,t.sharedPre,t.sharedH);for(let l=0;l<n;l++)o[l]=o[l]+s[l];const d=t.route.experts.length,i=new Float32Array(d);for(let l=0;l<d;l++){const u=t.route.gates[l],m=new Float32Array(n);let f=0;for(let p=0;p<n;p++)m[p]=u*r[p],f+=r[p]*t.expertOut[l][p];const g=this.experts[t.route.experts[l]].backward(m,t.x,t.expertPre[l],t.expertH[l]);for(let p=0;p<n;p++)o[p]=o[p]+g[p];i[l]=f}const c=t.route.gates;let h=0;for(let l=0;l<d;l++)h+=c[l]*i[l];for(let l=0;l<d;l++){const u=c[l]*(i[l]-h),f=t.route.experts[l]*n;for(let g=0;g<n;g++)this.gWr[f+g]=this.gWr[f+g]+u*t.x[g],o[g]=o[g]+u*this.wr[f+g]}return o}auxGradStep(e,t,n,r){const{numExperts:o,modelDim:s}=this.config;let d=0;for(let i=0;i<o;i++)d+=n[i]*t[i];for(let i=0;i<o;i++){const c=r*t[i]*(n[i]-d);if(c===0)continue;const h=i*s;for(let l=0;l<s;l++)this.gWr[h+l]=this.gWr[h+l]+c*e[l]}}parameters(){const e=[{name:"wr",data:this.wr,numel:this.wr.length}],t=(n,r)=>{const o=["w1","b1","w2","b2"];r.params().forEach((s,d)=>e.push({name:`${n}.${o[d]}`,data:s,numel:s.length}))};return t("shared",this.shared),this.experts.forEach((n,r)=>t(`expert${r}`,n)),e}gradients(){const e=[{name:"wr",data:this.gWr,numel:this.gWr.length}],t=(n,r)=>{const o=["w1","b1","w2","b2"];r.grads().forEach((s,d)=>e.push({name:`${n}.${o[d]}`,data:s,numel:s.length}))};return t("shared",this.shared),this.experts.forEach((n,r)=>t(`expert${r}`,n)),e}zeroGrad(){for(const e of this.gradients())e.data.fill(0)}exportExpert(e){const t=this.experts[e];if(!t)throw new Error(`exportExpert: index ${e} out of range (0..${this.config.numExperts-1})`);const n=["w1","b1","w2","b2"];return t.params().map((r,o)=>({name:n[o],data:r,numel:r.length}))}exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.reduce((l,u)=>l+u.numel,0),o=6,s=o*4,d=new ArrayBuffer(s+(t?r*2:r*4)),i=new Uint32Array(d,0,o);i[0]=kt,i[1]=t?2:1,i[2]=this.config.modelDim,i[3]=this.config.hiddenDim,i[4]=this.config.numExperts,i[5]=this.config.topK;const c=new Float32Array(r);let h=0;for(const l of n)c.set(l.data,h),h+=l.numel;return t?new Uint16Array(d,s,r).set(ke(c)):new Float32Array(d,s,r).set(c),d}loadWeights(e){const t=new Uint32Array(e,0,6);if(t[0]!==kt)throw new Error("SharedExpertMoE.loadWeights: bad magic (not an MoE0 checkpoint)");const[,n,r,o,s,d]=t;if(r!==this.config.modelDim||o!==this.config.hiddenDim||s!==this.config.numExperts||d!==this.config.topK)throw new Error("SharedExpertMoE.loadWeights: config mismatch with checkpoint");const i=this.parameters(),c=i.reduce((m,f)=>m+f.numel,0),h=24,l=n===2?Ae(new Uint16Array(e,h,c)):new Float32Array(e.slice(h,h+c*4));let u=0;for(const m of i)m.data.set(l.subarray(u,u+m.numel)),u+=m.numel}}class Wo{model;adam;opt;constructor(e,t={}){this.model=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0,auxWeight:t.auxWeight??.01,batchSize:t.batchSize??0,epochs:t.epochs??1},this.adam=new tt(e,this.opt)}fit(e){const t=[];for(let n=0;n<this.opt.epochs;n++)t.push(this.runEpoch(e));return t}runEpoch(e){const t=this.opt.batchSize>0?this.opt.batchSize:e.length,{numExperts:n,modelDim:r}=this.model.config;let o=0,s=0;for(let d=0;d<e.length;d+=t){const i=e.slice(d,d+t);this.model.zeroGrad();const c=[],h=[],l=new bn(n);let u=0;for(const g of i){const p=this.model.forward(g.input),_=new Float32Array(r);for(let y=0;y<r;y++){const b=p.output[y]-(g.target[y]??0);_[y]=b,u+=.5*b*b}this.model.backward(_,p.cache),c.push(p.cache.x),h.push(p.route.probs),l.observe(p.route)}const m=l.dispatchFractions(),f=this.opt.auxWeight*n/i.length;for(let g=0;g<c.length;g++)this.model.auxGradStep(c[g],h[g],m,f);this.scaleGradients(1/i.length),this.adam.step(),o+=u,s=l.loss()}return{loss:o/Math.max(1,e.length),auxLoss:s}}scaleGradients(e){if(e!==1)for(const t of this.model.gradients())for(let n=0;n<t.data.length;n++)t.data[n]=t.data[n]*e}}let ye=[],it=!0;class zo{data;shape;numel;requiresGrad;grad;_gradFn;constructor(e,t,n=!1){this.data=e,this.shape=t,this.numel=t.reduce((r,o)=>r*o,1),this.requiresGrad=n,this.grad=null,this._gradFn=null}get byteSize(){return this.numel*4}zeroGrad(e){this.grad&&e.queue.writeBuffer(this.grad,0,new Float32Array(this.numel))}destroy(){this.data?.destroy(),this.grad?.destroy(),this.data=null,this.grad=null}}function $o(){it=!0}function jo(){it=!1}function wn(){ye=[]}function Ro(a){return it?(ye.push({backward:a}),ye.length-1):-1}async function Oo(){for(let a=ye.length-1;a>=0;a--)await ye[a].backward();wn()}function me(a,e){let t=-1/0;for(let o=0;o<a.length;o++)a[o]>t&&(t=a[o]);let n=0;for(let o=0;o<a.length;o++)n+=Math.exp(a[o]-t);return Math.log(n)+t-a[e]}function dr(a,e){let t=-1/0;for(let s=0;s<a.length;s++)a[s]>t&&(t=a[s]);let n=0;const r=new Float32Array(a.length);for(let s=0;s<a.length;s++)r[s]=Math.exp(a[s]-t),n+=r[s];const o=new Float32Array(a.length);for(let s=0;s<a.length;s++)o[s]=r[s]/n;return o[e]=(o[e]??0)-1,o}function cr(a){return st(Pe(a))}function Ko(a){const e=new Float32Array(a.length);for(let t=0;t<a.length;t++)e[t]=cr(a[t]);return e}class yn{_scale;growthFactor;backoffFactor;growthInterval;minScale;cleanStreak=0;_overflows=0;_skipped=0;constructor(e={}){this._scale=e.initScale??16384,this.growthFactor=e.growthFactor??2,this.backoffFactor=e.backoffFactor??.5,this.growthInterval=e.growthInterval??200,this.minScale=e.minScale??1}get scale(){return this._scale}get overflows(){return this._overflows}get skipped(){return this._skipped}check(e){for(const t of e){const n=t.data;for(let r=0;r<n.length;r++){const o=n[r];if(!Number.isFinite(o))return!0}}return!1}unscale(e){const t=1/this._scale;for(const n of e){const r=n.data;for(let o=0;o<r.length;o++)r[o]=r[o]*t}}update(e){return e?(this._overflows++,this._skipped++,this._scale=Math.max(this.minScale,this._scale*this.backoffFactor),this.cleanStreak=0,!1):(++this.cleanStreak>=this.growthInterval&&(this._scale*=this.growthFactor,this.cleanStreak=0),!0)}}const pe={dModel:64,numLayers:2,convKernel:3,hiddenDim:128,numExperts:4,topK:2},vn=1163283533,Mt=1163283504;class Ne{config;_positionsEvaluated=0;emb;gEmb;conv;gConv;nConv;gNConv;nMoe;gNMoe;moe;constructor(e){const t=e.dModel??pe.dModel,n={vocabSize:e.vocabSize,dModel:t,numLayers:e.numLayers??pe.numLayers,convKernel:e.convKernel??pe.convKernel,hiddenDim:e.hiddenDim??t*2,numExperts:e.numExperts??pe.numExperts,topK:e.topK??pe.topK};if(n.vocabSize<=0)throw new Error("EvermindLM: vocabSize must be > 0");if(n.topK>n.numExperts)throw new Error("EvermindLM: topK must be ≤ numExperts");this.config=n;const r=(e.seed??vn)>>>0||1,o=new ae(r),s=(d,i)=>{const c=new Float32Array(d);for(let h=0;h<d;h++){const l=Math.max(o.next(),1e-12),u=o.next();c[h]=i*Math.sqrt(-2*Math.log(l))*Math.cos(2*Math.PI*u)}return c};this.emb=s(n.vocabSize*n.dModel,.02),this.gEmb=new Float32Array(this.emb.length),this.conv=[],this.gConv=[],this.nConv=[],this.gNConv=[],this.nMoe=[],this.gNMoe=[],this.moe=[];for(let d=0;d<n.numLayers;d++){const i=new Float32Array(n.dModel*n.convKernel);for(let c=0;c<n.dModel;c++)i[c*n.convKernel]=1;this.conv.push(i),this.gConv.push(new Float32Array(i.length)),this.nConv.push(new Float32Array(n.dModel).fill(1)),this.gNConv.push(new Float32Array(n.dModel)),this.nMoe.push(new Float32Array(n.dModel).fill(1)),this.gNMoe.push(new Float32Array(n.dModel)),this.moe.push(new ir({modelDim:n.dModel,hiddenDim:n.hiddenDim,numExperts:n.numExperts,topK:n.topK,seed:r+1+d}))}}_embed(e){const{dModel:t}=this.config;return e.map(n=>{const r=new Float32Array(t),o=n*t;for(let s=0;s<t;s++)r[s]=this.emb[o+s];return r})}_forwardLayer(e,t){const n=t.length,r=[],o=[],s=[],d=[],i=[],c=[],h=[];for(let l=0;l<n;l++){const u=this._stepLayerPosition(e,t[l],r);o.push(u.normed),s.push(u.rmsConv),d.push(u.afterConv),i.push(u.rmsMoe),c.push(u.moeCache),h.push(u.out)}return{afterMoe:h,cache:{layerIn:t,normedConv:o,rmsConv:s,afterConv:d,rmsMoe:i,moeCache:c}}}_stepLayerPosition(e,t,n){const{dModel:r,convKernel:o}=this.config,s=this.conv[e],{y:d,r:i}=Lt(t,this.nConv[e]),c=Float32Array.from(t);for(let f=0;f<r;f++){let g=s[f*o]*d[f];for(let p=1;p<o;p++){const _=n[n.length-p];_&&(g+=s[f*o+p]*_[f])}c[f]=c[f]+g}for(n.push(d);n.length>o-1;)n.shift();const{y:h,r:l}=Lt(c,this.nMoe[e]),u=Float32Array.from(c),m=this.moe[e].forward(h);for(let f=0;f<r;f++)u[f]=u[f]+m.output[f];return this._positionsEvaluated++,{normed:d,rmsConv:i,afterConv:c,rmsMoe:l,moeCache:m.cache,out:u}}_embedOne(e){const{dModel:t}=this.config,n=new Float32Array(t),r=e*t;for(let o=0;o<t;o++)n[o]=this.emb[r+o];return n}_head(e){const{dModel:t,vocabSize:n}=this.config;return e.map(r=>{const o=new Float32Array(n);for(let s=0;s<n;s++){let d=0;const i=s*t;for(let c=0;c<t;c++)d+=r[c]*this.emb[i+c];o[s]=d}return o})}forward(e){let t=this._embed(e);const n=[];for(let r=0;r<this.config.numLayers;r++){const{afterMoe:o,cache:s}=this._forwardLayer(r,t);n.push(s),t=o}return{logits:this._head(t),cache:{tokens:e,layers:n,finalX:t}}}embed(e){const{dModel:t,numLayers:n}=this.config,r=new Float32Array(t),o=e.length;if(o===0)return r;const s=Array.from({length:n},()=>[]);for(let i=0;i<o;i++){let c=this._embedOne(e[i]);for(let h=0;h<n;h++)c=this._stepLayerPosition(h,c,s[h]).out;for(let h=0;h<t;h++)r[h]=r[h]+c[h]}for(let i=0;i<t;i++)r[i]=r[i]/o;let d=0;for(let i=0;i<t;i++)d+=r[i]*r[i];d=Math.sqrt(d)||1;for(let i=0;i<t;i++)r[i]=r[i]/d;return r}embedText(e,t){return this.embed(t.encode(e))}_headBackward(e,t,n){const{dModel:r,vocabSize:o}=this.config,s=e.length,d=s-1,i=1/d,c=Array.from({length:s},()=>new Float32Array(r));let h=0;for(let l=0;l<d;l++){const u=e[l+1];h+=me(t[l],u)*i;const m=dr(t[l],u),f=n[l];for(let g=0;g<o;g++){const p=m[g]*i;if(p===0)continue;const _=g*r;for(let y=0;y<r;y++)this.gEmb[_+y]=this.gEmb[_+y]+p*f[y],c[l][y]=c[l][y]+p*this.emb[_+y]}}return{loss:h,dX:c}}_backwardLayer(e,t,n){const{dModel:r,convKernel:o}=this.config,s=t.length,d=this.conv[e],i=this.gConv[e],c=this.nConv[e],h=this.gNConv[e],l=this.nMoe[e],u=this.gNMoe[e],m=[];for(let p=0;p<s;p++){const _=this.moe[e].backward(t[p],n.moeCache[p]),{dx:y,dgain:b}=St(_,n.afterConv[p],n.rmsMoe[p],l);for(let M=0;M<r;M++)u[M]=u[M]+b[M];const v=Float32Array.from(t[p]);for(let M=0;M<r;M++)v[M]=v[M]+y[M];m.push(v)}const f=Array.from({length:s},()=>new Float32Array(r)),g=m.map(p=>Float32Array.from(p));for(let p=0;p<s;p++)for(let _=0;_<r;_++){const y=m[p][_];if(y!==0)for(let b=0;b<o;b++){const v=p-b;v<0||(i[_*o+b]=i[_*o+b]+y*n.normedConv[v][_],f[v][_]=f[v][_]+y*d[_*o+b])}}for(let p=0;p<s;p++){const{dx:_,dgain:y}=St(f[p],n.layerIn[p],n.rmsConv[p],c);for(let b=0;b<r;b++)h[b]=h[b]+y[b],g[p][b]=g[p][b]+_[b]}return g}_embedBackward(e,t){const{dModel:n}=this.config;for(let r=0;r<e.length;r++){const o=e[r]*n;for(let s=0;s<n;s++)this.gEmb[o+s]=this.gEmb[o+s]+t[r][s]}}lossAndBackward(e){if(e.length<2)return 0;const{logits:t,cache:n}=this.forward(e),{loss:r,dX:o}=this._headBackward(e,t,n.finalX);let s=o;for(let d=this.config.numLayers-1;d>=0;d--)s=this._backwardLayer(d,s,n.layers[d]);return this._embedBackward(e,s),r}lossAndBackwardCheckpointed(e){if(e.length<2)return 0;let t=this._embed(e);const n=[];for(let i=0;i<this.config.numLayers;i++)n.push(t),t=this._forwardLayer(i,t).afterMoe;const r=this._head(t),{loss:o,dX:s}=this._headBackward(e,r,t);let d=s;for(let i=this.config.numLayers-1;i>=0;i--){const{cache:c}=this._forwardLayer(i,n[i]);d=this._backwardLayer(i,d,c)}return this._embedBackward(e,d),o}get positionsEvaluated(){return this._positionsEvaluated}resetStats(){this._positionsEvaluated=0}newDecodeState(){return{convWindow:Array.from({length:this.config.numLayers},()=>[]),length:0,lastLogits:null}}cloneDecodeState(e){return{convWindow:e.convWindow.map(t=>t.map(n=>Float32Array.from(n))),length:e.length,lastLogits:e.lastLogits?Float32Array.from(e.lastLogits):null}}stepDecode(e,t){const n=this.cloneDecodeState(e),r=[];for(const o of t){let s=this._embedOne(o);for(let i=0;i<this.config.numLayers;i++)s=this._stepLayerPosition(i,s,n.convWindow[i]).out;const d=this._head([s])[0];r.push(d),n.lastLogits=d,n.length++}return{logits:r,state:n}}prefixState(e){return this.stepDecode(this.newDecodeState(),e).state}scoreContinuation(e,t){if(t.length===0||!e.lastLogits)return-1/0;const{logits:n}=this.stepDecode(e,t.slice(0,-1));let r=Et(e.lastLogits,t[0]);for(let o=1;o<t.length;o++)r+=Et(n[o-1],t[o]);return r/t.length}generateText(e,t,n){return t.decode(this.generate(t.encode(e),n))}generate(e,t){const n=t.temperature??0,r=n>0?new ae((t.seed??1)>>>0||1):null;let o=this.stepDecode(this.newDecodeState(),e.length>0?e:[0]).state;const s=[];for(let d=0;d<t.maxNewTokens;d++){const i=o.lastLogits,c=r?An(i,n,r):kn(i);if(s.push(c),t.stopToken!==void 0&&c===t.stopToken)break;o=this.stepDecode(o,[c]).state}return s}parameters(){const e=[{data:this.emb}];for(let t=0;t<this.config.numLayers;t++){e.push({data:this.conv[t]},{data:this.nConv[t]},{data:this.nMoe[t]});for(const n of this.moe[t].parameters())e.push({data:n.data})}return e}gradients(){const e=[{data:this.gEmb}];for(let t=0;t<this.config.numLayers;t++){e.push({data:this.gConv[t]},{data:this.gNConv[t]},{data:this.gNMoe[t]});for(const n of this.moe[t].gradients())e.push({data:n.data})}return e}zeroGrad(){this.gEmb.fill(0);for(let e=0;e<this.config.numLayers;e++)this.gConv[e].fill(0),this.gNConv[e].fill(0),this.gNMoe[e].fill(0),this.moe[e].zeroGrad()}exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.reduce((l,u)=>l+u.data.length,0),o=9,s=o*4,d=new ArrayBuffer(s+(t?r*2:r*4)),i=new Uint32Array(d,0,o);i[0]=Mt,i[1]=t?2:1,i[2]=this.config.vocabSize,i[3]=this.config.dModel,i[4]=this.config.numLayers,i[5]=this.config.convKernel,i[6]=this.config.hiddenDim,i[7]=this.config.numExperts,i[8]=this.config.topK;const c=new Float32Array(r);let h=0;for(const l of n)c.set(l.data,h),h+=l.data.length;return t?new Uint16Array(d,s,r).set(ke(c)):new Float32Array(d,s,r).set(c),Xt(d)}loadWeights(e){this._setFlat(this._readFlat(e))}_readFlat(e){const t=et(e);if(t.hasTrailer&&!t.ok)throw new Error("EvermindLM.loadWeights: checkpoint failed CRC integrity check (corrupt or truncated)");const n=new Uint32Array(e,0,9);if(n[0]!==Mt)throw new Error("EvermindLM.loadWeights: bad magic (not an EVL0 checkpoint)");const r=n[1];if(n[2]!==this.config.vocabSize||n[3]!==this.config.dModel||n[4]!==this.config.numLayers||n[5]!==this.config.convKernel||n[6]!==this.config.hiddenDim||n[7]!==this.config.numExperts||n[8]!==this.config.topK)throw new Error("EvermindLM.loadWeights: config mismatch with checkpoint");const o=this.parameters().reduce((d,i)=>d+i.data.length,0),s=36;return r===2?Ae(new Uint16Array(e,s,o)):new Float32Array(e.slice(s,s+o*4))}_flat(){const e=this.parameters(),t=e.reduce((o,s)=>o+s.data.length,0),n=new Float32Array(t);let r=0;for(const o of e)n.set(o.data,r),r+=o.data.length;return n}_setFlat(e){let t=0;for(const n of this.parameters())n.data.set(e.subarray(t,t+n.data.length)),t+=n.data.length}exportDelta(e,t={}){const n=this._readFlat(e),r=this._flat(),o=r.length%this.config.dModel===0?this.config.dModel:1;return Yt(Cr(n,r,o,t.eps??0))}loadDelta(e,t){const n=this._readFlat(e);this._setFlat(Pr(n,Qt(t)))}}class dt{model;opts;adam;scaler;grads;constructor(e,t={}){this.model=e,this.opts=t,this.adam=new tt(e,t),this.grads=e.gradients(),this.scaler=t.mixedPrecision?new yn(typeof t.mixedPrecision=="object"?t.mixedPrecision:{}):null}get lossScaler(){return this.scaler}_backward(e){return this.opts.checkpoint?this.model.lossAndBackwardCheckpointed(e):this.model.lossAndBackward(e)}_scaleGrads(e){if(e===1)return;const t=1/e;for(const n of this.grads)for(let r=0;r<n.data.length;r++)n.data[r]=n.data[r]*t}_fp16Grads(){for(const e of this.grads)for(let t=0;t<e.data.length;t++)e.data[t]=cr(e.data[t])}_mulGrads(e){if(e!==1)for(const t of this.grads)for(let n=0;n<t.data.length;n++)t.data[n]=t.data[n]*e}fit(e){const t=this.opts.epochs??1,n=Math.max(1,this.opts.accumSteps??1),r=[];for(let o=0;o<t;o++){let s=0,d=0,i=0,c=this.scaler?this.scaler.scale:1;this.model.zeroGrad();const h=()=>{if(i!==0){if(this._scaleGrads(i),this.scaler){this._fp16Grads();const l=this.scaler.check(this.grads);this.scaler.update(l)&&(this._mulGrads(1/c),this.adam.step()),c=this.scaler.scale}else this.adam.step();this.model.zeroGrad(),i=0}};for(const l of e){if(l.length<2)continue;i===0&&this.scaler&&(c=this.scaler.scale);const u=this._backward(l);this._mulGrads(c),s+=u,d++,++i>=n&&h()}h(),r.push(d>0?s/d:0)}return r}}const xn=1e-5;function Lt(a,e){const t=a.length;let n=0;for(let s=0;s<t;s++)n+=a[s]*a[s];const r=Math.sqrt(n/t+xn),o=new Float32Array(t);for(let s=0;s<t;s++)o[s]=e[s]*a[s]/r;return{y:o,r}}function St(a,e,t,n){const r=e.length;let o=0;for(let c=0;c<r;c++)o+=a[c]*n[c]*e[c];const s=new Float32Array(r),d=new Float32Array(r),i=t*t*t;for(let c=0;c<r;c++)s[c]=n[c]*a[c]/t-e[c]*o/(r*i),d[c]=a[c]*e[c]/t;return{dx:s,dgain:d}}function kn(a){let e=0;for(let t=1;t<a.length;t++)a[t]>a[e]&&(e=t);return e}function An(a,e,t){let n=-1/0;for(let d=0;d<a.length;d++)a[d]/e>n&&(n=a[d]/e);let r=0;const o=new Float32Array(a.length);for(let d=0;d<a.length;d++)o[d]=Math.exp(a[d]/e-n),r+=o[d];let s=t.next()*r;for(let d=0;d<o.length;d++)if(s-=o[d],s<=0)return d;return o.length-1}function Et(a,e){let t=-1/0;for(let o=0;o<a.length;o++){const s=a[o];s>t&&(t=s)}if(!Number.isFinite(t))return-1/0;let n=0;for(let o=0;o<a.length;o++)n+=Math.exp(a[o]-t);return(e>=0&&e<a.length?a[e]:-1/0)-(t+Math.log(n))}const Ee=0,je=1;class Mn{textVocabSize;levels;codebookSize;bosVideo;eosVideo;frameKey;frameDelta;codeBase;size;perBank;constructor(e){if(e.textVocabSize<0)throw new Error("MultimodalVocab: textVocabSize must be ≥ 0");if(e.levels<=0||e.codebookSize<=0)throw new Error("MultimodalVocab: levels and codebookSize must be > 0");this.textVocabSize=e.textVocabSize,this.levels=e.levels,this.codebookSize=e.codebookSize,this.bosVideo=e.textVocabSize,this.eosVideo=e.textVocabSize+1,this.frameKey=e.textVocabSize+2,this.frameDelta=e.textVocabSize+3,this.codeBase=e.textVocabSize+4,this.perBank=e.levels*e.codebookSize,this.size=this.codeBase+2*this.perBank}codeToken(e,t,n){return this.codeBase+e*this.perBank+t*this.codebookSize+n}isText(e){return e>=0&&e<this.textVocabSize}isCode(e){return e>=this.codeBase&&e<this.size}isVideoMarker(e){return e===this.frameKey||e===this.frameDelta}decodeCode(e){const t=e-this.codeBase,n=Math.floor(t/this.perBank),r=t-n*this.perBank,o=Math.floor(r/this.codebookSize),s=r-o*this.codebookSize;return{bank:n,level:o,code:s}}classify(e){return this.isText(e)?{kind:"text",id:e}:e===this.bosVideo?{kind:"control",control:"bosVideo"}:e===this.eosVideo?{kind:"control",control:"eosVideo"}:e===this.frameKey?{kind:"control",control:"frameKey"}:e===this.frameDelta?{kind:"control",control:"frameDelta"}:{kind:"code",...this.decodeCode(e)}}}const Dt=1448235312,se={channels:3,patch:4,levels:2,codebookSize:16,keyframeInterval:12,textVocabSize:0,seed:1448232529};class Te{height;width;channels;patch;levels;codebookSize;keyframeInterval;latentDim;patchesPerFrame;tokensPerFrame;vocab;banks;constructor(e){const t=e.channels??se.channels,n=e.patch??se.patch;if(e.height<=0||e.width<=0)throw new Error("VideoRVQCodec: height/width must be > 0");if(e.height%n!==0||e.width%n!==0)throw new Error(`VideoRVQCodec: height/width must be divisible by patch (${n})`);this.height=e.height,this.width=e.width,this.channels=t,this.patch=n,this.levels=e.levels??se.levels,this.codebookSize=e.codebookSize??se.codebookSize,this.keyframeInterval=Math.max(1,e.keyframeInterval??se.keyframeInterval),this.latentDim=n*n*t,this.patchesPerFrame=this.height/n*(this.width/n),this.tokensPerFrame=this.patchesPerFrame*this.levels,this.vocab=new Mn({textVocabSize:e.textVocabSize??se.textVocabSize,levels:this.levels,codebookSize:this.codebookSize});const r=new ae((e.seed??se.seed)>>>0||1),o=()=>Array.from({length:this.levels},()=>{const s=new Float32Array(this.codebookSize*this.latentDim);for(let d=0;d<s.length;d++)s[d]=(r.next()-.5)*.1;return s});this.banks=[o(),o()];for(const s of this.banks[Ee])for(let d=0;d<s.length;d++)s[d]+=.5}get vocabSize(){return this.vocab.size}serialize(){const t=2*this.levels*this.codebookSize*this.latentDim,n=new ArrayBuffer(36+t*4),r=new Uint32Array(n,0,9);r[0]=Dt,r[1]=this.height,r[2]=this.width,r[3]=this.channels,r[4]=this.patch,r[5]=this.levels,r[6]=this.codebookSize,r[7]=this.keyframeInterval,r[8]=this.vocab.textVocabSize;const o=new Float32Array(n,36,t);let s=0;for(const d of this.banks)for(const i of d)o.set(i,s),s+=i.length;return n}static deserialize(e){const t=new Uint32Array(e,0,9);if(t[0]!==Dt)throw new Error("VideoRVQCodec.deserialize: bad magic (not a VRQ0 blob)");const n=new Te({height:t[1],width:t[2],channels:t[3],patch:t[4],levels:t[5],codebookSize:t[6],keyframeInterval:t[7],textVocabSize:t[8]}),r=2*n.levels*n.codebookSize*n.latentDim,o=new Float32Array(e.slice(36,36+r*4));let s=0;for(const d of n.banks)for(const i of d)i.set(o.subarray(s,s+i.length)),s+=i.length;return n}encode(e){this.assertShape(e);const t=[this.vocab.bosVideo];let n=null;for(let r=0;r<e.length;r++){const o=this.toPatches(e[r]),s=n===null||r%this.keyframeInterval===0,d=s?Ee:je;t.push(s?this.vocab.frameKey:this.vocab.frameDelta);const i=[];for(let c=0;c<this.patchesPerFrame;c++){const h=s?o[c]:Bt(o[c],n[c]),{codes:l,recon:u}=this.rvqEncode(d,h);for(let m=0;m<this.levels;m++)t.push(this.vocab.codeToken(d,m,l[m]));i.push(s?u:Ft(n[c],u))}n=i}return t.push(this.vocab.eosVideo),t}decode(e){const t=[];let n=null,r=0;for(;r<e.length&&!this.vocab.isVideoMarker(e[r]);){if(e[r]===this.vocab.eosVideo)return t;r++}for(;r<e.length;){const o=e[r];if(!this.vocab.isVideoMarker(o))break;r++;const s=o===this.vocab.frameKey||n===null,d=s?Ee:je,i=[];for(;i.length<this.tokensPerFrame&&r<e.length&&this.vocab.isCode(e[r]);)i.push(e[r]),r++;const c=[];for(let h=0;h<this.patchesPerFrame;h++){const l=new Float32Array(this.latentDim);for(let u=0;u<this.levels;u++){const m=h*this.levels+u,f=m<i.length?i[m]:-1;if(f<0)continue;const{level:g,code:p}=this.vocab.decodeCode(f);Ln(l,this.banks[d][g],p,this.latentDim)}c.push(s?l:Ft(n[h],l))}t.push(this.fromPatches(c)),n=c}return t}fit(e,t={}){const n=t.iterations??8,r=new ae((t.seed??1718187041)>>>0||1);for(const c of e)this.assertShape(c);const o=[],s=[];for(const c of e){let h=null;for(let l=0;l<c.length;l++){const u=this.toPatches(c[l]);if(h===null||l%this.keyframeInterval===0)for(const f of u)o.push(f);else for(let f=0;f<u.length;f++)s.push(Bt(u[f],h[f]));h=u}}this.fitBank(Ee,o,n,r),this.fitBank(je,s,n,r);let d=0,i=0;for(const c of e){const h=this.decode(this.encode(c));for(let l=0;l<c.length;l++){const u=c[l],m=h[l];for(let f=0;f<u.length;f++){const g=u[f]-m[f];d+=g*g}i+=u.length}}return i>0?d/i:0}fitBank(e,t,n,r){if(t.length===0)return;let o=t.map(s=>Float32Array.from(s));for(let s=0;s<this.levels;s++){const d=En(o,this.codebookSize,this.latentDim,n,r);this.banks[e][s]=d,o=o.map(i=>{const c=qe(d,i,this.codebookSize,this.latentDim),h=Float32Array.from(i),l=c*this.latentDim;for(let u=0;u<this.latentDim;u++)h[u]=h[u]-d[l+u];return h})}}rvqEncode(e,t){const n=Float32Array.from(t),r=new Float32Array(this.latentDim),o=[];for(let s=0;s<this.levels;s++){const d=this.banks[e][s],i=qe(d,n,this.codebookSize,this.latentDim);o.push(i);const c=i*this.latentDim;for(let h=0;h<this.latentDim;h++)r[h]=r[h]+d[c+h],n[h]=n[h]-d[c+h]}return{codes:o,recon:r}}toPatches(e){const{patch:t,channels:n,width:r}=this,o=this.width/t,s=this.height/t,d=[];for(let i=0;i<s;i++)for(let c=0;c<o;c++){const h=new Float32Array(this.latentDim);for(let l=0;l<t;l++)for(let u=0;u<t;u++){const m=i*t+l,f=c*t+u,g=(m*r+f)*n,p=(l*t+u)*n;for(let _=0;_<n;_++)h[p+_]=e[g+_]}d.push(h)}return d}fromPatches(e){const{patch:t,channels:n,width:r}=this,o=this.width/t,s=new Float32Array(this.height*this.width*n);for(let d=0;d<e.length;d++){const i=Math.floor(d/o),c=d-i*o,h=e[d];for(let l=0;l<t;l++)for(let u=0;u<t;u++){const m=i*t+l,f=c*t+u,g=(m*r+f)*n,p=(l*t+u)*n;for(let _=0;_<n;_++)s[g+_]=Sn(h[p+_])}}return s}assertShape(e){const t=this.height*this.width*this.channels;for(let n=0;n<e.length;n++)if(e[n].length!==t)throw new Error(`VideoRVQCodec: frame ${n} has length ${e[n].length}, expected ${t}`)}}function Bt(a,e){const t=new Float32Array(a.length);for(let n=0;n<a.length;n++)t[n]=a[n]-e[n];return t}function Ft(a,e){const t=new Float32Array(a.length);for(let n=0;n<a.length;n++)t[n]=a[n]+e[n];return t}function Ln(a,e,t,n){const r=t*n;for(let o=0;o<n;o++)a[o]=a[o]+e[r+o]}function Sn(a){return a<0?0:a>1?1:a}function qe(a,e,t,n){let r=0,o=1/0;for(let s=0;s<t;s++){const d=s*n;let i=0;for(let c=0;c<n;c++){const h=e[c]-a[d+c];if(i+=h*h,i>=o)break}i<o&&(o=i,r=s)}return r}function En(a,e,t,n,r){const o=new Float32Array(e*t);for(let i=0;i<e;i++){const c=a[Math.floor(r.next()*a.length)%a.length];o.set(c,i*t)}const s=new Float32Array(e*t),d=new Int32Array(e);for(let i=0;i<n;i++){s.fill(0),d.fill(0);for(const c of a){const h=qe(o,c,e,t);d[h]=d[h]+1;const l=h*t;for(let u=0;u<t;u++)s[l+u]=s[l+u]+c[u]}for(let c=0;c<e;c++){const h=c*t;if(d[c]===0){const u=a[Math.floor(r.next()*a.length)%a.length];o.set(u,h);continue}const l=1/d[c];for(let u=0;u<t;u++)o[h+u]=s[h+u]*l}}return o}const Ct=1163283761,ge=12,Dn=1;function re(a){let e=2166136261;for(let t=0;t<a.length;t++)e^=a[t],e=Math.imul(e,16777619);return e>>>0}class Q{manifest;checkpoint;codec;tokenizer;constructor(e,t,n,r){this.manifest=e,this.checkpoint=t,this.codec=n,this.tokenizer=r}static _tokenizerSection(e,t){if(!e.tokenizer)return{fields:{}};const n=e.tokenizer.vocabSize;if(t!=null&&n!==t)throw new Error(`EvermindModelPackage: tokenizer vocabSize (${n}) must equal the model's (${t}) — a mismatched pair decodes to nonsense.`);const r=e.tokenizer.serialize();return{blob:r,fields:{tokenizerFormat:"BPE0",tokenizerBytes:r.byteLength,tokenizerChecksum:re(new Uint8Array(r)),tokenizerVocabSize:n}}}static fromModel(e,t){const n=t.fp16??!1,r=e.exportWeights({fp16:n}),o=Q._tokenizerSection(t,void 0),s={schema:"evermind.model/1",name:t.name,version:t.version,modelType:"shared-expert-moe",config:e.config,paramCount:e.parameters().reduce((d,i)=>d+i.numel,0),checkpointFormat:"MoE0",checkpointFp16:n,...o.blob?{checkpointBytes:r.byteLength}:{},checksum:re(new Uint8Array(r)),...o.fields,card:t.card,...t.createdAt?{createdAt:t.createdAt}:{}};return new Q(s,r,void 0,o.blob)}static fromLM(e,t){const n=t.fp16??!1,r=e.exportWeights({fp16:n}),o=Q._tokenizerSection(t,e.config.vocabSize),s={schema:"evermind.model/1",name:t.name,version:t.version,modelType:"evermind-lm",config:e.config,paramCount:e.parameters().reduce((d,i)=>d+i.data.length,0),checkpointFormat:"EVL0",checkpointFp16:n,...o.blob?{checkpointBytes:r.byteLength}:{},checksum:re(new Uint8Array(r)),...o.fields,card:t.card,...t.createdAt?{createdAt:t.createdAt}:{}};return new Q(s,r,void 0,o.blob)}static fromMediaLM(e,t,n){if(e.config.vocabSize!==t.vocabSize)throw new Error(`fromMediaLM: LM vocabSize (${e.config.vocabSize}) must equal codec.vocabSize (${t.vocabSize})`);const r=n.fp16??!1,o=e.exportWeights({fp16:r}),s=t.serialize(),d=Q._tokenizerSection(n,e.config.vocabSize),i={schema:"evermind.model/1",name:n.name,version:n.version,modelType:"evermind-lm",modality:n.modality,config:e.config,paramCount:e.parameters().reduce((c,h)=>c+h.data.length,0),checkpointFormat:"EVL0",checkpointFp16:r,checkpointBytes:o.byteLength,checksum:re(new Uint8Array(o)),codecFormat:"VRQ0",...d.blob?{codecBytes:s.byteLength}:{},codecChecksum:re(new Uint8Array(s)),...d.fields,card:n.card,...n.createdAt?{createdAt:n.createdAt}:{}};return new Q(i,o,s,d.blob)}toBlob(){const e=new TextEncoder().encode(JSON.stringify(this.manifest)),t=ge,n=this.codec?.byteLength??0,r=this.tokenizer?.byteLength??0,o=new ArrayBuffer(t+e.byteLength+this.checkpoint.byteLength+n+r),s=new Uint32Array(o,0,3);s[0]=Ct,s[1]=Dn,s[2]=e.byteLength;let d=t;return new Uint8Array(o,d,e.byteLength).set(e),d+=e.byteLength,new Uint8Array(o,d,this.checkpoint.byteLength).set(new Uint8Array(this.checkpoint)),d+=this.checkpoint.byteLength,this.codec&&(new Uint8Array(o,d,n).set(new Uint8Array(this.codec)),d+=n),this.tokenizer&&new Uint8Array(o,d,r).set(new Uint8Array(this.tokenizer)),o}withCheckpoint(e,t=this.manifest.version){const n={...this.manifest,version:t,...this.manifest.checkpointBytes!==void 0?{checkpointBytes:e.byteLength}:{},checksum:re(new Uint8Array(e))};return new Q(n,e,this.codec,this.tokenizer)}withMlHeads(e){const t={...this.manifest};return delete t.mlHeads,e.length&&(t.mlHeads=[...e]),new Q(t,this.checkpoint,this.codec,this.tokenizer)}static manifestEnd(e){if(e.byteLength<ge)throw new Error("EvermindModelPackage: truncated (no header)");const t=new Uint32Array(e,0,3);if(t[0]!==Ct)throw new Error("EvermindModelPackage: bad magic (not an .evermind package)");return ge+t[2]}static readManifest(e){const t=Q.manifestEnd(e);if(t>e.byteLength)throw new Error("EvermindModelPackage: truncated (manifest length exceeds blob)");const n=new Uint8Array(e,ge,t-ge);return JSON.parse(new TextDecoder().decode(n))}static fromBlob(e){const t=Q.readManifest(e),n=Q.manifestEnd(e),r=t.checkpointBytes;if(r==null)return new Q(t,e.slice(n));if(n+r>e.byteLength)throw new Error("EvermindModelPackage.fromBlob: truncated (checkpointBytes exceeds blob)");const o=e.slice(n,n+r);let s=n+r;const d=t.tokenizerBytes??0;if(s+d>e.byteLength)throw new Error("EvermindModelPackage.fromBlob: truncated (tokenizerBytes exceeds blob)");const i=e.byteLength-d;let c;if(s<i){const l=t.codecBytes!=null?s+t.codecBytes:i;if(l>i)throw new Error("EvermindModelPackage.fromBlob: truncated (codecBytes overruns the tokenizer section)");c=e.slice(s,l),s=l}const h=d>0?e.slice(i):void 0;return new Q(t,o,c,h)}validate(){const e=[];this.manifest.schema!=="evermind.model/1"&&e.push(`unknown schema: ${this.manifest.schema}`);const t=this.manifest.config;this.manifest.modelType==="shared-expert-moe"?(!t||t.modelDim<=0||t.hiddenDim<=0||t.numExperts<=0||t.topK<1||t.topK>t.numExperts)&&e.push("invalid config"):this.manifest.modelType==="evermind-lm"?(!t||t.vocabSize<=0||t.dModel<=0||t.numLayers<=0||t.numExperts<=0||t.topK<1||t.topK>t.numExperts)&&e.push("invalid config"):e.push(`unsupported modelType: ${String(this.manifest.modelType)}`);const n=re(new Uint8Array(this.checkpoint));n!==this.manifest.checksum&&e.push(`checksum mismatch (manifest ${this.manifest.checksum}, actual ${n}) — corrupt or tampered checkpoint`);const r=this.manifest.modality??"text";if(r==="video"||r==="image")if(!this.codec)e.push(`modality '${r}' package is missing its codec section`);else{const o=re(new Uint8Array(this.codec));o!==this.manifest.codecChecksum&&e.push(`codec checksum mismatch (manifest ${this.manifest.codecChecksum}, actual ${o}) — corrupt codec`)}if(this.manifest.tokenizerFormat)if(!this.tokenizer)e.push("manifest declares an embedded tokenizer but the package has no tokenizer section");else{const o=re(new Uint8Array(this.tokenizer));o!==this.manifest.tokenizerChecksum&&e.push(`tokenizer checksum mismatch (manifest ${this.manifest.tokenizerChecksum}, actual ${o}) - corrupt tokenizer`);const s=this.manifest.config?.vocabSize,d=this.manifest.tokenizerVocabSize;s!=null&&d!=null&&s!==d&&e.push(`tokenizer vocabSize (${d}) does not match the model's (${s})`)}for(const o of this.manifest.mlHeads??[]){const s=Nr(o);s&&e.push(`ml head '${String(o?.task)}': ${s}`)}return new Set((this.manifest.mlHeads??[]).map(o=>o.task)).size!==(this.manifest.mlHeads??[]).length&&e.push("ml heads: a task appears more than once"),{ok:e.length===0,errors:e}}loadTokenizer(){if(!this.manifest.tokenizerFormat||!this.tokenizer)return null;const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadTokenizer: ${e.errors.join("; ")}`);return rt.deserialize(this.tokenizer)}loadModel(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadModel: ${e.errors.join("; ")}`);if(this.manifest.modelType!=="shared-expert-moe")throw new Error(`loadModel: package is '${this.manifest.modelType}', use loadLM()`);const t=new ir(this.manifest.config);return t.loadWeights(this.checkpoint),t}loadLM(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadLM: ${e.errors.join("; ")}`);if(this.manifest.modelType!=="evermind-lm")throw new Error(`loadLM: package is '${this.manifest.modelType}', use loadModel()`);const t=new Ne(this.manifest.config);return t.loadWeights(this.checkpoint),t}loadMediaLM(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadMediaLM: ${e.errors.join("; ")}`);const t=this.manifest.modality??"text";if(t!=="video"&&t!=="image")throw new Error(`loadMediaLM: package modality is '${t}', use loadLM()`);return{lm:this.loadLM(),codec:Te.deserialize(this.codec),modality:t}}}const Bn=Math.LN2;function Fn(a,e){const t=a.length,n=Math.max(1,Math.min(e,t)),r=[],o=new Uint8Array(t);for(let s=0;s<n;s++){let d=-1,i=-1/0;for(let c=0;c<t;c++){if(o[c])continue;const h=a[c];h>i&&(i=h,d=c)}if(d<0)break;o[d]=1,r.push(d)}return r}function Cn(a){let e=0,t=-1/0;for(let n=0;n<a.length;n++)a[n]>t&&(t=a[n],e=n);return e}function Pn(a){return Math.exp(a)}function Nn(a){return a/Bn}function lr(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function hr(a,e,t,n){const r=Math.min(e.length,t.length);for(let o=0;o<r;o++){const s=t[o],d=e[o];s<0||s>=d.length||(a.ceSum+=me(d,s),Cn(d)===s&&a.top1Hits++,Fn(d,n).includes(s)&&a.topKHits++,a.tokens++)}}function ct(){const a=globalThis;return typeof a.performance?.now=="function"?a.performance.now():Date.now()}function ur(a){return a.slice(1)}function fr(a,e,t,n){const r=a.tokens>0?a.ceSum/a.tokens:0,o={sequences:e,tokens:a.tokens,crossEntropy:r,perplexity:Pn(r),bitsPerToken:Nn(r),top1Accuracy:a.tokens>0?a.top1Hits/a.tokens:0,topKAccuracy:a.tokens>0?a.topKHits/a.tokens:0,topK:t};return n!==void 0&&(o.elapsedMs=n,o.tokensPerSecond=n>0?a.tokens/n*1e3:0),o}function Be(a,e,t={}){const n=t.topK??5,r=t.measureLatency??!0,o=t.now??ct,s=lr();let d=0,i=0;for(const c of e){if(c.length<2)continue;const h=r?o():0,{logits:l}=a.forward(c);r&&(i+=o()-h),hr(s,l,ur(c),n),d++}return fr(s,d,n,r?i:void 0)}async function Ho(a,e,t={}){const n=t.topK??5,r=t.measureLatency??!0,o=t.now??ct,s=lr();let d=0,i=0;for(const c of e){if(c.length<2)continue;const h=r?o():0,{logits:l}=await a.forward(c);r&&(i+=o()-h),hr(s,l,ur(c),n),d++}return fr(s,d,n,r?i:void 0)}function Go(a,e,t,n={}){return Tn(Be(a,t,n),Be(e,t,n))}function Tn(a,e){const t=a.perplexity-e.perplexity,n=e.perplexity>0?a.perplexity/e.perplexity:1/0,r=a.top1Accuracy-e.top1Accuracy,o=.005;let s;Math.abs(n-1)<=o?s="tie":s=t<0?"candidate":"baseline";const d=((1-n)*100).toFixed(1),i=s==="tie"?`Tie: perplexity ${a.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)}`:s==="candidate"?`Candidate wins: ${d}% lower perplexity (${a.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(d)).toFixed(1)}% higher perplexity (${a.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`;return{candidate:a,baseline:e,perplexityDelta:t,perplexityRatio:n,top1Delta:r,winner:s,summary:i}}function mr(a,e){return a.split(/(?<=\.)\s+/).map(t=>e.encode(t.trim())).filter(t=>t.length>=2)}function Uo(a,e,t,n={}){return Be(a,mr(t,e),n)}function In(a,e){for(let t=a.length-1;t>0;t--){const n=Math.floor(e.next()*(t+1)),r=a[t];a[t]=a[n],a[n]=r}return a}function qo(a,e={}){const t=e.seed??7,n=new rt;n.train(a,{numMerges:e.numMerges??100});const r=mr(a,n);if(r.length<2)throw new Error(`corpus produced ${r.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const o=In([...r],new ae(t>>>0||1)),s=Math.min(.9,Math.max(.05,e.heldOutRatio??.25));let d=Math.round(o.length*s);d=Math.max(1,Math.min(o.length-1,d));const i=o.slice(0,d),c=o.slice(d),h=new Ne({vocabSize:n.vocabSize,dModel:e.dModel??32,numLayers:e.numLayers??2,hiddenDim:e.hiddenDim??48,seed:t}),l=e.epochs??30,u=new dt(h,{lr:e.lr??.03,epochs:l}).fit(c),m=Be(h,i,{topK:e.topK??5,measureLatency:!0}),f=h.generateText(e.prompt??"The",n,{maxNewTokens:8,temperature:0});return{...m,trainSequences:c.length,evalSequences:i.length,initialTrainLoss:u[0]??0,finalTrainLoss:u.at(-1)??0,vocabSize:n.vocabSize,sample:f}}function pr(a,e){const t=[],n=Math.max(1,Math.floor(e));for(let r=0;r+1<a.length;r+=n){const o=a.slice(r,r+n);o.length>=2&&t.push(o)}return t}function Wn(a,e){const t=Math.min(1,Math.max(0,e));return Math.round(a*(1-t))}const zn=["The planning loop retrieves context before generating a response.","Agents recall facts from the memory layer and act on them.","Deployment runs on Cloudflare Workers and Durable Objects.","Tools are gated by a capability registry and a policy pack.","The coordinator merges weight deltas from every contributing host.","A ticket moves through triage, execution, review and merge.","Recall is ranked by embedding cosine fused with lexical scoring.","The trainer adapts a private copy of the base checkpoint locally."].join(" ");function $n(a){let e=0;for(const t of a.parameters())e+=t.data.length;return e}function Vo(a={}){const e=a.text??zn,t=a.windowTokens??[32,64,128],n=a.epochs??[1,2,4],r=a.skipRates??[0,.5],o=Math.max(1,a.requests??4),s=a.dModel??32,d=a.numLayers??2,i=a.hiddenDim??48,c=a.seed??7,h=a.lr??.01,l=a.now??ct,u=new rt;u.train(e,{numMerges:a.numMerges??120});const m=u.encode(e),f=()=>new Ne({vocabSize:u.vocabSize,dModel:s,numLayers:d,hiddenDim:i,seed:c}),g=[];for(const p of t){const _=pr(m,p);for(const y of n)for(const b of r){const v=Wn(o,b),M=f();M.resetStats();const E=l();for(let F=0;F<v;F++)new dt(M,{lr:h,epochs:y,accumSteps:1}).fit(_);const N=l()-E,A=M.positionsEvaluated,D=_.length*v;g.push({windowTokens:p,epochs:y,skipRate:b,requests:o,adapted:v,sequences:D,optimizerSteps:D*y,positionsEvaluated:A,elapsedMs:N,msPerKPosition:A>0?N/A*1e3:0,msPerAdaptation:v>0?N/v:0})}}return{points:g,textTokens:m.length,vocabSize:u.vocabSize,dModel:s,numLayers:d,hiddenDim:i,paramCount:$n(f())}}function Xo(a){const e=`Evermind adaptation cost — dModel=${a.dModel} layers=${a.numLayers} hidden=${a.hiddenDim} params=${a.paramCount.toLocaleString()} vocab=${a.vocabSize} textTokens=${a.textTokens}`,t=["window","epochs","skip","adapts","seqs","steps","positions","ms","ms/adapt","ms/1k pos"],n=a.points.map(s=>[String(s.windowTokens),String(s.epochs),s.skipRate.toFixed(2),`${s.adapted}/${s.requests}`,String(s.sequences),String(s.optimizerSteps),String(s.positionsEvaluated),s.elapsedMs.toFixed(1),s.msPerAdaptation.toFixed(1),s.msPerKPosition.toFixed(3)]),r=t.map((s,d)=>Math.max(s.length,...n.map(i=>i[d].length))),o=s=>s.map((d,i)=>d.padStart(r[i])).join("  ");return[e,"",o(t),o(r.map(s=>"-".repeat(s))),...n.map(o)].join(`
`)}const jn=4e3,Rn=64;function On(a,e,t,n={}){const r=n.maxChars??jn,o=n.windowTokens??Rn,s=pr(e.encode(t.slice(0,r)),o);if(s.length===0)return null;const d=n.lm??a.loadLM(),i=new dt(d,{epochs:n.epochs??1}).fit(s),c=i.length>0?i[i.length-1]:0;return{diff:Jt(a.checkpoint,d.exportWeights()),loss:c,sequences:s.length}}function Yo(a,e,t,n,r={}){const o=On(a,e,t,r);return o?{pkg:a.withCheckpoint(Zt(a.checkpoint,o.diff),n),loss:o.loss,sequences:o.sequences}:null}function Kn(a,e,t){if(e.length===0)return{checkpoint:a,mergedRows:0,contributors:0,deltaNorm:0};if(t&&t.length!==e.length)throw new Error(`mergeCheckpointDiffs: weights length ${t.length} != diffs length ${e.length}`);const n=e.map(l=>Qt(l));for(const l of n)if(l.rowSize!==1)throw new Error(`mergeCheckpointDiffs: expected element-granular deltas (rowSize 1), got ${l.rowSize}`);const r=new Map;if(n.forEach((l,u)=>{const m=t?t[u]:1;m>0&&l.rows.forEach((f,g)=>{const p=l.data[g],_=r.get(f);_?(_.sum+=m*p,_.weight+=m):r.set(f,{sum:m*p,weight:m})})}),r.size===0)return{checkpoint:a,mergedRows:0,contributors:n.length,deltaNorm:0};const o=[...r.keys()].sort((l,u)=>l-u),s=new Float32Array(o.length);o.forEach((l,u)=>{const m=r.get(l);s[u]=m.sum/m.weight});const d=new Float32Array(et(a).body);let i=0;return o.forEach((l,u)=>{const m=s[u]-(d[l]??0);i+=m*m}),{checkpoint:Zt(a,Yt({rowSize:1,rows:o,data:s})),mergedRows:o.length,contributors:n.length,deltaNorm:Math.sqrt(i)}}function Hn(a,e,t,n,r={}){const o=Kn(a,e,t),s=(h,l,u)=>({...o,checkpoint:a,deltaNorm:0,accepted:!1,baseLoss:l,newLoss:u,refusedReason:h});if(o.mergedRows===0)return s("nothing-merged",null,null);const d=h=>h!=null&&Number.isFinite(h)?h:null,i=d(n(a)),c=d(n(o.checkpoint));return i==null||c==null?r.requireEval?s("unscored",i,c):{...o,accepted:!0,baseLoss:i,newLoss:c}:c>i+(r.tolerance??0)?s("regressed",i,c):{...o,accepted:!0,baseLoss:i,newLoss:c}}const Gn=128;function Un(a,e){if(e.length<2)return null;const{logits:t}=a.forward(e),n=Math.min(t.length,e.length)-1;if(n<1)return null;let r=0;for(let s=0;s<n;s++)r+=me(t[s],e[s+1]);const o=r/n;return Number.isFinite(o)&&o>=0?o:null}function Qo(a,e,t,n=Gn){let r=0,o=0;for(const s of t){const d=(s.prompt?`${s.prompt}
`:"")+s.text,i=Un(a,e.encode(d).slice(0,n));i!=null&&(r+=i,o++)}return o>0?r/o:null}class Jo{model;codec;dimensions;fingerprint;constructor(e,t,n){this.model=e,this.codec=t,this.dimensions=e.config.dModel,this.fingerprint=n??qn(e)}async embed(e){return this.embedSync(e)}embedSync(e){return this.model.embedText(e,this.codec)}}function qn(a){const e=a.config,t=new Uint8Array(a.emb.buffer,a.emb.byteOffset,a.emb.byteLength);return`evermind-lm/${[e.vocabSize,e.dModel,e.numLayers,e.convKernel,e.hiddenDim,e.numExperts,e.topK].join("-")}/${Tr(t).toString(16)}`}const Pt=1280266817;class ve{rows;cols;rank;alpha;scale;B;A;gB;gA;constructor(e,t,n={}){if(e<=0||t<=0)throw new Error("LoRAAdapter: rows and cols must be > 0");const r=n.rank??8;if(r<=0||r>Math.min(e,t))throw new Error(`LoRAAdapter: rank must be in [1, min(rows,cols)=${Math.min(e,t)}]`);this.rows=e,this.cols=t,this.rank=r,this.alpha=n.alpha??r,this.scale=this.alpha/r,this.B=new Float32Array(e*r),this.A=new Float32Array(r*t);const o=new ae((n.seed??1282363969)>>>0||1),s=1/Math.sqrt(t);for(let d=0;d<this.A.length;d++){const i=Math.max(o.next(),1e-12),c=o.next();this.A[d]=s*Math.sqrt(-2*Math.log(i))*Math.cos(2*Math.PI*c)}this.gB=new Float32Array(this.B.length),this.gA=new Float32Array(this.A.length)}numParams(){return this.B.length+this.A.length}delta(){const{rows:e,cols:t,rank:n,scale:r}=this,o=new Float32Array(e*t);for(let s=0;s<e;s++){const d=s*n,i=s*t;for(let c=0;c<n;c++){const h=this.B[d+c]*r;if(h===0)continue;const l=c*t;for(let u=0;u<t;u++)o[i+u]=o[i+u]+h*this.A[l+u]}}return o}applyTo(e){if(e.length!==this.rows*this.cols)throw new Error("LoRAAdapter.applyTo: base length mismatch");const t=this.delta(),n=new Float32Array(e.length);for(let r=0;r<n.length;r++)n[r]=e[r]+t[r];return n}accumulateGradient(e){const{rows:t,cols:n,rank:r,scale:o}=this;if(e.length!==t*n)throw new Error("LoRAAdapter.accumulateGradient: gW length mismatch");for(let s=0;s<t;s++){const d=s*n,i=s*r;for(let c=0;c<r;c++){const h=c*n;let l=0;const u=this.B[i+c]*o;for(let m=0;m<n;m++){const f=e[d+m];l+=f*this.A[h+m],this.gA[h+m]=this.gA[h+m]+u*f}this.gB[i+c]=this.gB[i+c]+o*l}}}parameters(){return[{data:this.B},{data:this.A}]}gradients(){return[{data:this.gB},{data:this.gA}]}zeroGrad(){this.gB.fill(0),this.gA.fill(0)}serialize(){const n=new ArrayBuffer(20+(this.B.length+this.A.length)*4),r=new Uint32Array(n,0,5);r[0]=Pt,r[1]=this.rows,r[2]=this.cols,r[3]=this.rank,new Float32Array(n,16,1)[0]=this.alpha;const o=new Float32Array(n,20);return o.set(this.B,0),o.set(this.A,this.B.length),n}static deserialize(e){const t=new Uint32Array(e,0,5);if(t[0]!==Pt)throw new Error("LoRAAdapter.deserialize: bad magic");const n=t[1],r=t[2],o=t[3],s=new Float32Array(e,16,1)[0],d=new ve(n,r,{rank:o,alpha:s}),i=new Float32Array(e,20);return d.B.set(i.subarray(0,d.B.length)),d.A.set(i.subarray(d.B.length,d.B.length+d.A.length)),d}}function Vn(a,e){switch(e){case"none":return{view:a,bytes:a.length*4};case"fp16":{const t=ke(a);return{view:Ae(t),bytes:t.length*2}}case"int8":{const t=dn(a);return{view:cn(t.data,t.scale),bytes:t.data.length+4}}}}class gr{model;adapter;baseQuant;frozenBase;baseBytesStored;rows;cols;constructor(e,t={}){this.model=e,this.rows=e.config.vocabSize,this.cols=e.config.dModel,this.baseQuant=t.baseQuant??"none";const{view:n,bytes:r}=Vn(Float32Array.from(e.emb),this.baseQuant);this.frozenBase=n,this.baseBytesStored=r,this.adapter=new ve(this.rows,this.cols,t)}get baseModel(){return this.model}mergedEmb(){return this.adapter.applyTo(this.frozenBase)}_accumulate(e){const t=this.mergedEmb(),n=this.model.emb;this.model.emb=t,this.model.zeroGrad();const r=this.model.lossAndBackward(e),o=this.model.gradients()[0].data;return this.adapter.accumulateGradient(o),this.model.emb=n,r}fit(e,t={}){const n=t.epochs??1,r=Math.max(1,t.accumSteps??1),o=new tt(this.adapter,t),s=this.adapter.gradients(),d=[];for(let i=0;i<n;i++){let c=0,h=0,l=0;this.adapter.zeroGrad();const u=()=>{if(l!==0){if(l!==1)for(const m of s)for(let f=0;f<m.data.length;f++)m.data[f]=m.data[f]/l;o.step(),this.adapter.zeroGrad(),l=0}};for(const m of e)m.length<2||(c+=this._accumulate(m),h++,++l>=r&&u());u(),d.push(h>0?c/h:0)}return d}generate(e,t){const n=this.model.emb;this.model.emb=this.mergedEmb();try{return this.model.generate(e,t)}finally{this.model.emb=n}}generateText(e,t,n){return t.decode(this.generate(t.encode(e),n))}serializeAdapter(){return this.adapter.serialize()}static loadAdapter(e,t,n="none"){const r=ve.deserialize(t),o=new gr(e,{rank:r.rank,alpha:r.alpha,baseQuant:n});return o.adapter.B.set(r.B),o.adapter.A.set(r.A),o}merge(e={}){return this.model.emb.set(this.mergedEmb()),this.model.exportWeights(e)}footprint(){return{adapterBytes:this.adapter.serialize().byteLength,baseBytes:this.baseBytesStored,trainableParams:this.adapter.numParams(),baseParams:this.rows*this.cols}}}const lt=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],_r=-10,br=5;function Xn(a){const{dModel:e,dState:t,dConv:n,dInner:r,dtRank:o}=a;return{wInProj:new Float32Array(2*r*e),bInProj:new Float32Array(2*r),wConv:new Float32Array(r*n),bConv:new Float32Array(r),wXProj:new Float32Array((o+2*t)*r),bXProj:new Float32Array(o+2*t),wDtProj:new Float32Array(r*o),bDtProj:new Float32Array(r),A_log:new Float32Array(r*t),D_vec:new Float32Array(r),wOutProj:new Float32Array(e*r),bOutProj:new Float32Array(e),normWeight:new Float32Array(e)}}function wr(a,e,t){const{dModel:n,dState:r,dConv:o,dInner:s,dtRank:d,batch:i,seqLen:c}=t,h=i*c,l=d+2*r,u=new Float32Array(h*n),m=new Float32Array(h);rr(a,e.normWeight,h,n,u,m);const f=new Float32Array(h*2*s);be(u,e.wInProj,e.bInProj,h,n,2*s,f);const g=new Float32Array(h*s),p=new Float32Array(h*s);for(let w=0;w<h;w++)for(let x=0;x<s;x++)g[w*s+x]=f[w*2*s+x],p[w*s+x]=f[w*2*s+s+x];const _=new Float32Array(h*s);for(let w=0;w<i;w++)for(let x=0;x<c;x++){const L=(w*c+x)*s;for(let $=0;$<s;$++){let q=e.bConv[$];for(let T=0;T<o;T++)x>=T&&(q+=e.wConv[$*o+T]*g[(w*c+x-T)*s+$]);_[L+$]=q}}const y=new Float32Array(h*s);for(let w=0;w<h*s;w++)y[w]=bt(_[w]);const b=new Float32Array(h*l);be(y,e.wXProj,e.bXProj,h,s,l,b);const v=new Float32Array(h*d),M=new Float32Array(h*r),E=new Float32Array(h*r);for(let w=0;w<h;w++){for(let x=0;x<d;x++)v[w*d+x]=b[w*l+x];for(let x=0;x<r;x++)M[w*r+x]=b[w*l+d+x],E[w*r+x]=b[w*l+d+r+x]}const N=new Float32Array(h*s);be(v,e.wDtProj,e.bDtProj,h,d,s,N);const A=new Float32Array(h*s);for(let w=0;w<h*s;w++)A[w]=Ir(N[w]);const D=new Float32Array(s*r);for(let w=0;w<s*r;w++)D[w]=-Math.exp(Math.min(br,Math.max(_r,e.A_log[w])));const F=new Float32Array(h*s*r),O=new Float32Array(h*s*r),K=new Float32Array(h*s*r),G=new Float32Array(h*s);for(let w=0;w<i;w++)for(let x=0;x<c;x++){const L=w*c+x;for(let $=0;$<s;$++){const q=A[L*s+$],T=y[L*s+$];let P=e.D_vec[$]*T;for(let B=0;B<r;B++){const U=D[$*r+B],J=Math.exp(q*U),V=(J-1)/U*M[L*r+B],X=(L*s+$)*r+B;F[X]=J,O[X]=V;const te=x===0?0:K[((L-1)*s+$)*r+B],ie=J*te+V*T;K[X]=ie,P+=E[L*r+B]*ie}G[L*s+$]=P}}const j=new Float32Array(h*s),H=new Float32Array(h*s);for(let w=0;w<h*s;w++)j[w]=bt(p[w]),H[w]=G[w]*j[w];const k=new Float32Array(h*n);be(H,e.wOutProj,e.bOutProj,h,s,n,k);for(let w=0;w<h*n;w++)k[w]=k[w]+a[w];return{output:k,cache:{x:a,normInv:m,normOut:u,xConvIn:g,z:p,convOut:_,u:y,dtRaw:v,bRaw:M,cRaw:E,deltaFull:N,dv:A,aCont:D,aBar:F,bBar:O,h:K,scanY:G,siluZ:j,gated:H}}}function Yn(a,e,t,n,r){const{dModel:o,dState:s,dConv:d,dInner:i,dtRank:c,batch:h,seqLen:l}=n,u=h*l,m=c+2*s,f=new Float32Array(u*o);f.set(a);const g=new Float32Array(u*i);Se(a,t.gated,e.wOutProj,u,i,o,g,r.wOutProj,r.bOutProj);const p=new Float32Array(u*i),_=new Float32Array(u*i);for(let k=0;k<u*i;k++)p[k]=g[k]*t.siluZ[k],_[k]=g[k]*t.scanY[k]*_t(t.z[k]);const y=new Float32Array(u*i),b=new Float32Array(u*s),v=new Float32Array(u*s),M=new Float32Array(u*i),E=new Float32Array(i*s),N=new Float32Array(i*s);for(let k=0;k<h;k++){N.fill(0);for(let w=l-1;w>=0;w--){const x=k*l+w;for(let L=0;L<i;L++){const $=p[x*i+L],q=t.u[x*i+L],T=t.dv[x*i+L];r.D_vec[L]=r.D_vec[L]+$*q,y[x*i+L]=y[x*i+L]+$*e.D_vec[L];let P=0;for(let B=0;B<s;B++){const U=(x*i+L)*s+B,J=t.h[U],V=t.aBar[U],X=t.bBar[U],te=t.aCont[L*s+B],ie=t.cRaw[x*s+B];v[x*s+B]=v[x*s+B]+$*J;const Le=$*ie+N[L*s+B],Fr=w===0?0:t.h[((x-1)*i+L)*s+B],ft=Le*Fr,We=Le*q;y[x*i+L]=y[x*i+L]+Le*X,N[L*s+B]=Le*V;const mt=t.bRaw[x*s+B];P+=ft*te*V+We*V*mt,E[L*s+B]=E[L*s+B]+ft*T*V+We*mt*((T*V*te-(V-1))/(te*te)),b[x*s+B]=b[x*s+B]+We*((V-1)/te)}M[x*i+L]=M[x*i+L]+P}}}for(let k=0;k<i*s;k++){const w=e.A_log[k];w<=_r||w>=br||(r.A_log[k]=r.A_log[k]+E[k]*t.aCont[k])}const A=new Float32Array(u*i);for(let k=0;k<u*i;k++)A[k]=M[k]*er(t.deltaFull[k]);const D=new Float32Array(u*c);Se(A,t.dtRaw,e.wDtProj,u,c,i,D,r.wDtProj,r.bDtProj);const F=new Float32Array(u*m);for(let k=0;k<u;k++){for(let w=0;w<c;w++)F[k*m+w]=D[k*c+w];for(let w=0;w<s;w++)F[k*m+c+w]=b[k*s+w],F[k*m+c+s+w]=v[k*s+w]}const O=new Float32Array(u*i);Se(F,t.u,e.wXProj,u,i,m,O,r.wXProj,r.bXProj);for(let k=0;k<u*i;k++)y[k]=y[k]+O[k];const K=new Float32Array(u*i);for(let k=0;k<u*i;k++)K[k]=y[k]*_t(t.convOut[k]);const G=new Float32Array(u*i);for(let k=0;k<h;k++)for(let w=0;w<l;w++){const x=k*l+w;for(let L=0;L<i;L++){const $=K[x*i+L];if($!==0){r.bConv[L]=r.bConv[L]+$;for(let q=0;q<d;q++){if(w<q)continue;const T=(k*l+w-q)*i+L;r.wConv[L*d+q]=r.wConv[L*d+q]+$*t.xConvIn[T],G[T]=G[T]+$*e.wConv[L*d+q]}}}}const j=new Float32Array(u*2*i);for(let k=0;k<u;k++)for(let w=0;w<i;w++)j[k*2*i+w]=G[k*i+w],j[k*2*i+i+w]=_[k*i+w];const H=new Float32Array(u*o);return Se(j,t.normOut,e.wInProj,u,o,2*i,H,r.wInProj,r.bInProj),tr(H,t.x,e.normWeight,t.normInv,u,o,f,r.normWeight,nt),f}const Nt=["mamba1"];function Qn(a){const e={dModel:a.dModel,dState:a.dState,dConv:a.dConv,dInner:a.dInner,dtRank:a.dtRank};return{embedding:new Float32Array(a.vocabSize*a.dModel),finalNorm:new Float32Array(a.dModel),lmHeadBias:new Float32Array(a.vocabSize),layers:Array.from({length:a.numLayers},()=>Xn(e))}}function Jn(a){const e=new Map;e.set("embedding",a.embedding);for(let t=0;t<a.layers.length;t++){const n=a.layers[t];for(const r of lt)e.set(`layer${t}.${r}`,n[r])}return e.set("final_norm",a.finalNorm),e.set("lm_head_bias",a.lmHeadBias),e}function Zn(a){const e=new Map;e.set("embedding",a.embedding);for(let t=0;t<a.layers.length;t++){const n=a.layers[t];for(const r of lt)e.set(`layer${t}.${r}`,n[r])}return e.set("final_norm",a.finalNorm),e.set("lm_head_bias",a.lmHeadBias),e}function ea(a,e){const t=(h,l)=>{const u=a.get(h);if(!u)throw new Error(`cpuWeightsFromNamed: missing tensor "${h}"`);if(u.length!==l)throw new Error(`cpuWeightsFromNamed: "${h}" has ${u.length} elements, expected ${l}`);return u},{dModel:n,dState:r,dConv:o,dInner:s,dtRank:d}=e,i={wInProj:2*s*n,bInProj:2*s,wConv:s*o,bConv:s,wXProj:(d+2*r)*s,bXProj:d+2*r,wDtProj:s*d,bDtProj:s,A_log:s*r,D_vec:s,wOutProj:n*s,bOutProj:n,normWeight:n},c=[];for(let h=0;h<e.numLayers;h++){const l={};for(const u of lt)l[u]=t(`layer${h}.${u}`,i[u]);c.push(l)}return{embedding:t("embedding",e.vocabSize*n),finalNorm:t("final_norm",n),lmHeadBias:t("lm_head_bias",e.vocabSize),layers:c}}function yr(a,e,t,n,r,o=!1){const{vocabSize:s,dModel:d}=t,i=n*r;let c=new Float32Array(i*d);for(let p=0;p<i;p++){const _=a[p];if(_<0||_>=s)throw new Error(`token id ${_} out of range [0, ${s})`);c.set(e.embedding.subarray(_*d,(_+1)*d),p*d)}const h={dModel:d,dState:t.dState,dConv:t.dConv,dInner:t.dInner,dtRank:t.dtRank,batch:n,seqLen:r},l=[],u=[];for(let p=0;p<t.numLayers;p++){l.push(c);const{output:_,cache:y}=wr(c,e.layers[p],h);o||u.push(y),c=_}const m=new Float32Array(i*d),f=new Float32Array(i);rr(c,e.finalNorm,i,d,m,f,nt);const g=new Float32Array(i*s);return be(m,e.embedding,e.lmHeadBias,i,d,s,g),{hiddenIn:l,layer:u,lastHidden:c,normOut:m,normInv:f,logits:g}}function ta(a,e,t,n,r){return yr(a,e,t,n,r).logits}function Zo(a,e,t,n,r,o){const s=ta(a,t,n,r,o),d=r*o,i=n.vocabSize;let c=0;for(let h=0;h<d;h++)c+=me(s.subarray(h*i,(h+1)*i),e[h]);return c/d}function ra(a,e,t,n,r,o,s={}){const{vocabSize:d,dModel:i}=n,c=r*o,h=s.activationCheckpointing??!1,l=yr(a,t,n,r,o,h),u=Qn(n);let m=0;const f=new Float32Array(c*d);for(let v=0;v<c;v++){const M=l.logits.subarray(v*d,(v+1)*d),E=e[v];m+=me(M,E);const N=dr(M,E);for(let A=0;A<d;A++)f[v*d+A]=N[A]/c}const g=m/c,p=new Float32Array(c*i);for(let v=0;v<c;v++){const M=v*d,E=v*i;for(let N=0;N<d;N++){const A=f[M+N];if(A===0)continue;u.lmHeadBias[N]=u.lmHeadBias[N]+A;const D=N*i;for(let F=0;F<i;F++)p[E+F]=p[E+F]+A*t.embedding[D+F],u.embedding[D+F]=u.embedding[D+F]+A*l.normOut[E+F]}}const _=new Float32Array(c*i);tr(p,l.lastHidden,t.finalNorm,l.normInv,c,i,_,u.finalNorm,nt);const y={dModel:i,dState:n.dState,dConv:n.dConv,dInner:n.dInner,dtRank:n.dtRank,batch:r,seqLen:o};let b=_;for(let v=n.numLayers-1;v>=0;v--){const M=h?wr(l.hiddenIn[v],t.layers[v],y).cache:l.layer[v];b=Yn(b,t.layers[v],M,y,u.layers[v])}for(let v=0;v<c;v++){const E=a[v]*i,N=v*i;for(let A=0;A<i;A++)u.embedding[E+A]=u.embedding[E+A]+b[N+A]}return{loss:g,grads:Jn(u)}}function na(a,e){const{dModel:t,dState:n,dConv:r,dInner:o,dtRank:s}=e;if(a==="embedding")return[e.vocabSize,t];switch(a.startsWith("layer")?a.slice(a.indexOf(".")+1):a){case"wInProj":return[2*o,t];case"wConv":return[o,r];case"wXProj":return[s+2*n,o];case"wDtProj":return[o,s];case"A_log":return[o,n];case"wOutProj":return[t,o];default:return null}}const aa=["wInProj","wXProj","wDtProj","wOutProj"],oa=.05;class es{model;tokenizer;device;_moments;_step;_dims;_mirror;_mirrorByName;_adapters;_loraBase;_shard;constructor(e,t=null){this.model=e,this.tokenizer=t,this.device=e.device,this._moments=new Map,this._step=0,this._dims=sa(e),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const e=this.model.getTrainableParams();if(this._adapters.size===0)return e.reduce((n,r)=>n+r.numel,0);let t=0;for(const n of e){const r=this._adapters.get(n.name);r&&(t+=r.numParams())}return t}_owns(e){return this._shard===null||e%this._shard.count===this._shard.index}_installAdapters(e){if(this._adapters.size>0)return;const t=new Set(e.targets??aa),n=this._mirrorByName;for(const r of this.model.getTrainableParams()){const o=r.name.includes(".")?r.name.slice(r.name.indexOf(".")+1):r.name;if(!t.has(o))continue;const s=na(r.name,this._dims);if(!s)continue;const[d,i]=s,c=Math.max(1,Math.min(e.rank??8,d,i));this._adapters.set(r.name,new ve(d,i,{...e,rank:c})),this._loraBase.set(r.name,Float32Array.from(n.get(r.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...t].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const e=this._mirrorByName;for(const[t,n]of this._adapters){const r=e.get(t),o=this._loraBase.get(t),s=n.delta();for(let d=0;d<r.length;d++)r[d]=o[d]+s[d]}}_momentFor(e){let t=this._moments.get(e.name);return t||(t={m:new Float32Array(e.numel),v:new Float32Array(e.numel)},this._moments.set(e.name,t)),t}async _syncMirrorFromGpu(){const e=new Map;for(const t of this.model.parameters())e.set(t.name,await we(this.device,t.buf,t.numel*4));e.set("lm_head_bias",await we(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=ea(e,this._dims),this._mirrorByName=Zn(this._mirror)}async train(e,t={}){const{learningRate:n=1e-4,epochs:r=5,batchSize:o=1,seqLen:s=512,maxGradNorm:d=1,weightDecay:i=.01,beta1:c=.9,beta2:h=.999,eps:l=1e-8,wsla:u=!1,onEpochEnd:m=null}=t,f=Math.max(1,Math.floor(t.gradientAccumulation??1));if(this._shard=t.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const g=t.maxDelta??(u?oa:0);u&&this.model.setWSLAMode(!0);let p;if(typeof e=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");p=this.tokenizer.encode(e)}else p=Array.from(e);if(p.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const _=ia(p,s);if(_.length===0)throw new Error("Input is too short to form any training chunk.");const y=da(_,Math.max(1,Math.floor(o)));await this._syncMirrorFromGpu(),t.lora&&this._installAdapters(t.lora);const b=[];for(let v=0;v<r;v++){let M=0,E=0,N=0;for(let D=0;D<y.length;D+=f){const F=y.slice(D,D+f),{loss:O,gradNorm:K}=await this._trainStep(F,{learningRate:n,maxGradNorm:d,weightDecay:i,beta1:c,beta2:h,eps:l,wsla:u,maxDelta:g,...t.activationCheckpointing?{activationCheckpointing:!0}:{}});M+=O,E+=K,N++}const A=M/N;b.push(A),m&&m(v+1,A,E/N)}return u&&this.model.setWSLAMode(!1),b}async _trainStep(e,t){const{learningRate:n,maxGradNorm:r,weightDecay:o,beta1:s,beta2:d,eps:i,maxDelta:c}=t;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const h=this._mirror,l=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const u=t.activationCheckpointing?{activationCheckpointing:!0}:{};let m=0,f=new Map;for(const b of e){const v=ra(b.inputs,b.targets,h,this._dims,b.batch,b.seqLen,u);if(m+=v.loss/e.length,f.size===0){for(const M of v.grads.values())for(let E=0;E<M.length;E++)M[E]=M[E]/e.length;f=v.grads}else for(const[M,E]of v.grads){const N=f.get(M);for(let A=0;A<E.length;A++)N[A]=N[A]+E[A]/e.length}}const g=this.model.getTrainableParams();if(this._adapters.size>0)for(const[b,v]of this._adapters){const M=f.get(b);M&&(v.zeroGrad(),v.accumulateGradient(M))}let p=0;for(const b of g){const v=f.get(b.name);if(v)for(let M=0;M<v.length;M++)p+=v[M]*v[M]}const _=Math.sqrt(p),y=r>0&&_>r?r/_:1;return this._adamwStep(g,f,l,{learningRate:n,weightDecay:o,beta1:s,beta2:d,eps:i,beta1_t:Math.pow(s,this._step),beta2_t:Math.pow(d,this._step),maxDelta:c,gradScale:y}),{loss:m,gradNorm:_}}_adamwStep(e,t,n,r){const{learningRate:o,weightDecay:s,beta1:d,beta2:i,eps:c,beta1_t:h,beta2_t:l,maxDelta:u,gradScale:m}=r,f={lr:o,beta1:d,beta2:i,eps:c,weightDecay:s,beta1_t:h,beta2_t:l,maxDelta:u,gradScale:m};for(let g=0;g<e.length;g++){const p=e[g];if(!this._owns(g))continue;const _=this._adapters.get(p.name);if(_){const M=n.get(p.name),E=this._loraBase.get(p.name),[N,A]=[_.A,_.B],[D,F]=[_.gradients()[1].data,_.gradients()[0].data],O=this._momentNamed(`${p.name}::loraB`,A.length),K=this._momentNamed(`${p.name}::loraA`,N.length);ze(A,F,O.m,O.v,f),ze(N,D,K.m,K.v,f);const G=_.delta();for(let j=0;j<M.length;j++)M[j]=E[j]+G[j];he(this.device,p.buf,M);continue}const y=t.get(p.name),b=n.get(p.name);if(!y||!b)continue;if(y.length!==p.numel||b.length!==p.numel)throw new Error(`MambaTrainer: parameter "${p.name}" is ${p.numel} elements but the gradient engine produced ${y.length} — model and CPU mirror disagree.`);const v=this._momentFor(p);ze(b,y,v.m,v.v,f),he(this.device,p.buf,b)}}_momentNamed(e,t){let n=this._moments.get(e);return n||(n={m:new Float32Array(t),v:new Float32Array(t)},this._moments.set(e,n)),n}optimizerStateBytes(){let e=0;for(const t of this._moments.values())e+=t.m.byteLength+t.v.byteLength;return e}async evaluate(e){let t;if(typeof e=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");t=Array.from(this.tokenizer.encode(e))}else t=Array.from(e);const n=t.length,r=this.model.config.vocabSize,{logits:o}=await this.model.forward(new Uint32Array(t.slice(0,-1)),1,n-1);let s=0;for(let i=0;i<n-1;i++){const c=i*r;s+=me(o.slice(c,c+r),t[i+1])}const d=s/(n-1);return Math.exp(d)}}function sa(a){const e=a.layerSpecs.map((o,s)=>({i:s,type:o.type})).filter(({type:o})=>!Nt.includes(o));if(e.length>0){const o=e.map(({i:s,type:d})=>`layer${s}=${d}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${Nt.join("/")} layers only, but this model has ${o}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const t=a.layers[0],n=t?.dInner??a.config.expand*a.config.dModel,r=t?.dtRank??Math.ceil(a.config.dModel/16);return{vocabSize:a.config.vocabSize,dModel:a.config.dModel,dState:a.config.dState,dConv:a.config.dConv,dInner:n,dtRank:r,numLayers:a.layers.length}}function ia(a,e){const t=[];for(let r=0;r+e<a.length;r+=e)t.push({inputs:a.slice(r,r+e),targets:a.slice(r+1,r+e+1)});const n=a.length%e;if(n>1){const r=a.length-n;t.push({inputs:a.slice(r,-1),targets:a.slice(r+1)})}return t}function da(a,e){const t=[];let n=0;for(;n<a.length;){const r=a[n].inputs.length,o=[];for(;n<a.length&&o.length<e&&a[n].inputs.length===r;)o.push(a[n]),n++;t.push({inputs:o.flatMap(s=>s.inputs),targets:o.flatMap(s=>s.targets),batch:o.length,seqLen:r})}return t}class ts{video;constructor(e){this.video=new Te({...e,keyframeInterval:1})}get vocab(){return this.video.vocab}get vocabSize(){return this.video.vocabSize}get frameSize(){return this.video.height*this.video.width*this.video.channels}encode(e){return this.video.encode([e])}decode(e){return this.video.decode(e)[0]??new Float32Array(this.frameSize)}fit(e,t){return this.video.fit(e.map(n=>[n]),t)}}function rs(a,e,t){return[...e,...a.encode(t)]}function ca(a,e,t,n){if(a.config.vocabSize!==e.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${a.config.vocabSize}) must equal codec.vocabSize (${e.vocabSize})`);const r=a.generate(t,{...n,stopToken:n.stopToken??e.vocab.eosVideo});return{video:e.decode(r),tokens:r}}function ns(a,e,t,n){const{video:r,tokens:o}=ca(a,e.video,t,n);return{image:r[0]??new Float32Array(e.frameSize),tokens:o}}function Me(a){const e=a.config;return{vocabSize:e.vocabSize,dModel:e.dModel,numLayers:e.numLayers,convKernel:e.convKernel,hiddenDim:e.hiddenDim,numExperts:e.numExperts,topK:e.topK}}function vr(a){const{vocabSize:e,dModel:t,numLayers:n,convKernel:r,hiddenDim:o,numExperts:s}=a,d=[{name:"token_embedding.weight",shape:[e,t]}],i=c=>[{name:`${c}.w1`,shape:[o,t]},{name:`${c}.b1`,shape:[o]},{name:`${c}.w2`,shape:[t,o]},{name:`${c}.b2`,shape:[t]}];for(let c=0;c<n;c++){const h=`layers.${c}`;d.push({name:`${h}.conv.weight`,shape:[t,r]}),d.push({name:`${h}.norm_conv.weight`,shape:[t]}),d.push({name:`${h}.norm_moe.weight`,shape:[t]}),d.push({name:`${h}.moe.router.weight`,shape:[s,t]}),d.push(...i(`${h}.moe.shared`));for(let l=0;l<s;l++)d.push(...i(`${h}.moe.experts.${l}`))}return d}function ht(a){const e=vr(Me(a)),t=a.parameters();if(e.length!==t.length)throw new Error(`export/tensors: parameter-count drift (spec ${e.length} vs model ${t.length}) — EvermindLM.parameters() order changed; update evermindTensorSpec`);return e.map((n,r)=>{const o=n.shape.reduce((d,i)=>d*i,1),s=t[r].data;if(s.length!==o)throw new Error(`export/tensors: shape mismatch for ${n.name} (expected ${o}, got ${s.length})`);return{name:n.name,shape:n.shape,data:s}})}function xr(a){return a.parameters().reduce((e,t)=>e+t.data.length,0)}function la(a,e){if(!e){const r=new Uint8Array(a.length*4),o=new DataView(r.buffer);for(let s=0;s<a.length;s++)o.setFloat32(s*4,a[s],!0);return r}const t=new Uint8Array(a.length*2),n=new DataView(t.buffer);for(let r=0;r<a.length;r++)n.setUint16(r*2,Pe(a[r]),!0);return t}function ha(a,e={}){const t=e.fp16??!1,n=t?"F16":"F32",r=t?2:4,o={};e.metadata&&(o.__metadata__=e.metadata);const s=[];let d=0;for(const f of a){const g=f.data.length*r;o[f.name]={dtype:n,shape:f.shape,data_offsets:[d,d+g]},s.push(la(f.data,t)),d+=g}let i=JSON.stringify(o);const h=(8-new TextEncoder().encode(i).length%8)%8;h>0&&(i+=" ".repeat(h));const l=new TextEncoder().encode(i),u=new Uint8Array(8+l.length+d);new DataView(u.buffer).setBigUint64(0,BigInt(l.length),!0),u.set(l,8);let m=8+l.length;for(const f of s)u.set(f,m),m+=f.length;return u}function Tt(a,e={}){return ha(ht(a),{...e,metadata:{format:"pt",producer:"builderforce-memory-engine",...e.metadata??{}}})}const ua=0,fa=5,ma=2;class ee{parts=[];byte(e){this.parts.push(e&255)}rawVarint(e){if(e<0||!Number.isFinite(e))throw new Error(`ProtoWriter: bad varint ${e}`);let t=e;for(;t>=128;)this.byte(t%128|128),t=Math.floor(t/128);this.byte(t)}tag(e,t){this.rawVarint(e*8+t)}rawBytes(e){for(let t=0;t<e.length;t++)this.byte(e[t])}varint(e,t){this.tag(e,ua),this.rawVarint(t)}float(e,t){this.tag(e,fa);const n=new ArrayBuffer(4);new DataView(n).setFloat32(0,t,!0),this.rawBytes(new Uint8Array(n))}bytes(e,t){this.tag(e,ma),this.rawVarint(t.length),this.rawBytes(t)}string(e,t){this.bytes(e,new TextEncoder().encode(t))}message(e,t){this.bytes(e,t.finish())}finish(){return Uint8Array.from(this.parts)}}function pa(a){const e=new Uint8Array(a.length*4),t=new DataView(e.buffer);for(let n=0;n<a.length;n++)t.setFloat32(n*4,a[n],!0);return e}const ga=18,_a=8,kr=1,Ar=7,ba=1,wa=2,ya=3,va=7;class xa{nodes=[];inits=[];uid=0;tmp(e){return`${e}_${this.uid++}`}initFloat(e,t,n){return this.inits.push({name:e,dims:t,dataType:kr,raw:pa(n)}),e}initInt64(e,t,n){return this.inits.push({name:e,dims:t,dataType:Ar,int64:n}),e}node(e,t,n,r=[]){return this.nodes.push({op:e,inputs:t,outputs:n,name:`${e}_${this.uid++}`,attrs:r}),n}op(e,t,n,r=[]){const o=this.tmp(n);return this.node(e,t,[o],r),o}}function It(a,e,t,n,r){const o=a.op("Mul",[e,e],"rms_sq"),s=a.op("ReduceMean",[o,r],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),d=a.op("Add",[s,n],"rms_eps"),i=a.op("Sqrt",[d],"rms_r"),c=a.op("Div",[e,i],"rms_div");return a.op("Mul",[c,t],"rms_y")}function Wt(a,e,t,n,r,o){const s=a.op("Transpose",[t],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),d=a.op("Add",[a.op("MatMul",[e,s],"ffn_mm1"),n],"ffn_pre"),i=a.op("Relu",[d],"ffn_h"),c=a.op("Transpose",[r],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return a.op("Add",[a.op("MatMul",[i,c],"ffn_mm2"),o],"ffn_y")}function zt(a,e={}){const t=Me(a),n=ht(a),r=new Map(n.map(b=>[b.name,b])),o=b=>{const v=r.get(b);if(!v)throw new Error(`export/onnx: missing tensor ${b}`);return v},s=new xa,{vocabSize:d,dModel:i,numLayers:c,convKernel:h,numExperts:l,topK:u}=t,m=s.initFloat("token_embedding.weight",[d,i],o("token_embedding.weight").data),f=s.initFloat("rms_eps",[1],new Float32Array([1e-5])),g=s.initInt64("axes_last",[1],[2]),p=s.initInt64("topk_k",[1],[u]);let _=s.op("Gather",[m,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let b=0;b<c;b++){const v=`layers.${b}`,M=s.initFloat(`${v}.norm_conv.weight`,[i],o(`${v}.norm_conv.weight`).data),E=It(s,_,M,f,g),N=o(`${v}.conv.weight`).data,A=new Float32Array(i*h);for(let V=0;V<i;V++)for(let X=0;X<h;X++)A[V*h+(h-1-X)]=N[V*h+X];const D=s.initFloat(`${v}.conv.onnx_weight`,[i,1,h],A),F=s.op("Transpose",[E],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),O=s.op("Conv",[F,D],"conv_out",[{kind:"i",name:"group",value:i},{kind:"ints",name:"kernel_shape",value:[h]},{kind:"ints",name:"pads",value:[h-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),K=s.op("Transpose",[O],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),G=s.op("Add",[_,K],"after_conv"),j=s.initFloat(`${v}.norm_moe.weight`,[i],o(`${v}.norm_moe.weight`).data),H=It(s,G,j,f,g),k=s.initFloat(`${v}.moe.router.weight`,[l,i],o(`${v}.moe.router.weight`).data),w=s.op("Transpose",[k],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),x=s.op("MatMul",[H,w],"router_logits"),L=s.tmp("topk_v"),$=s.tmp("topk_i");s.node("TopK",[x,p],[L,$],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const q=s.op("Softmax",[L],"gates",[{kind:"i",name:"axis",value:2}]),T=s.op("Sub",[x,x],"zeros"),P=s.op("ScatterElements",[T,$,q],"combine",[{kind:"i",name:"axis",value:2}]),B=Wt(s,H,s.initFloat(`${v}.moe.shared.w1`,[t.hiddenDim,i],o(`${v}.moe.shared.w1`).data),s.initFloat(`${v}.moe.shared.b1`,[t.hiddenDim],o(`${v}.moe.shared.b1`).data),s.initFloat(`${v}.moe.shared.w2`,[i,t.hiddenDim],o(`${v}.moe.shared.w2`).data),s.initFloat(`${v}.moe.shared.b2`,[i],o(`${v}.moe.shared.b2`).data)),U=Array.from({length:l},(V,X)=>s.tmp(`combine_${X}`));s.node("Split",[P],U,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:l}]);let J=B;for(let V=0;V<l;V++){const X=`${v}.moe.experts.${V}`,te=Wt(s,H,s.initFloat(`${X}.w1`,[t.hiddenDim,i],o(`${X}.w1`).data),s.initFloat(`${X}.b1`,[t.hiddenDim],o(`${X}.b1`).data),s.initFloat(`${X}.w2`,[i,t.hiddenDim],o(`${X}.w2`).data),s.initFloat(`${X}.b2`,[i],o(`${X}.b2`).data)),ie=s.op("Mul",[U[V],te],"expert_w");J=s.op("Add",[J,ie],"moe_acc")}_=s.op("Add",[G,J],"after_moe")}const y=s.op("Transpose",[m],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return s.node("MatMul",[_,y],["logits"]),Ea(s,t,e)}function ka(a){const e=new ee;switch(e.string(1,a.name),a.kind){case"i":e.varint(20,wa),e.varint(3,a.value);break;case"ints":e.varint(20,va);for(const t of a.value)e.varint(8,t);break;case"f":e.varint(20,ba),e.float(2,a.value);break;case"s":e.varint(20,ya),e.string(4,a.value);break}return e}function Aa(a){const e=new ee;for(const t of a.inputs)e.string(1,t);for(const t of a.outputs)e.string(2,t);e.string(3,a.name),e.string(4,a.op);for(const t of a.attrs)e.message(5,ka(t));return e}function Ma(a){const e=new ee;for(const t of a.dims)e.varint(1,t);if(e.varint(2,a.dataType),e.string(8,a.name),a.int64)for(const t of a.int64)e.varint(7,t);return a.raw&&e.bytes(9,a.raw),e}function La(a){const e=new ee;return e.string(2,a),e}function Sa(a){const e=new ee;return e.varint(1,a),e}function $t(a,e,t){const n=new ee;for(const d of t)n.message(1,typeof d=="string"?La(d):Sa(d));const r=new ee;r.varint(1,e),r.message(2,n);const o=new ee;o.message(1,r);const s=new ee;return s.string(1,a),s.message(2,o),s}function Ea(a,e,t){const n=new ee;for(const s of a.nodes)n.message(1,Aa(s));n.string(2,"evermind");for(const s of a.inits)n.message(5,Ma(s));n.message(11,$t("input_ids",Ar,["batch","seq"])),n.message(12,$t("logits",kr,["batch","seq",e.vocabSize]));const r=new ee;r.string(1,""),r.varint(2,ga);const o=new ee;return o.varint(1,_a),o.string(2,t.producerName??"builderforce-memory-engine"),o.string(3,t.producerVersion??"evermind"),o.message(7,n),o.message(8,r),o.finish()}const Da=1179993927,Ba=3,_e=32,Fa=4,Ca=8,Pa=0,Na=1;class Ta{buf=new Uint8Array(1024);len=0;ensure(e){if(this.len+e<=this.buf.length)return;let t=this.buf.length*2;for(;t<this.len+e;)t*=2;const n=new Uint8Array(t);n.set(this.buf.subarray(0,this.len)),this.buf=n}u32(e){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,e,!0),this.len+=4}u64(e){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(e),!0),this.len+=8}raw(e){this.ensure(e.length),this.buf.set(e,this.len),this.len+=e.length}alignTo(e){const t=(e-this.len%e)%e;t>0&&(this.ensure(t),this.len+=t)}string(e){const t=new TextEncoder().encode(e);this.u64(t.length),this.raw(t)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function Ia(a,e){if(!e){const r=new Uint8Array(a.length*4),o=new DataView(r.buffer);for(let s=0;s<a.length;s++)o.setFloat32(s*4,a[s],!0);return r}const t=new Uint8Array(a.length*2),n=new DataView(t.buffer);for(let r=0;r<a.length;r++)n.setUint16(r*2,Pe(a[r]),!0);return t}function jt(a,e={}){const t=e.fp16??!1,n=Me(a),r=ht(a),o=t?Na:Pa,s=t?2:4,d=[["evermind.vocab_size",n.vocabSize],["evermind.embedding_length",n.dModel],["evermind.block_count",n.numLayers],["evermind.conv_kernel",n.convKernel],["evermind.feed_forward_length",n.hiddenDim],["evermind.expert_count",n.numExperts],["evermind.expert_used_count",n.topK],["general.alignment",_e]],i=[["general.architecture","evermind"],["general.name",e.name??"Evermind"]],c=new Ta;c.u32(Da),c.u32(Ba),c.u64(r.length),c.u64(d.length+i.length);for(const[f,g]of i)c.string(f),c.u32(Ca),c.string(g);for(const[f,g]of d)c.string(f),c.u32(Fa),c.u32(g);const h=f=>[...f.shape].reverse();let l=0;const u=[];for(const f of r){u.push(l);const g=f.data.length*s;l+=g,l+=(_e-l%_e)%_e}r.forEach((f,g)=>{c.string(f.name);const p=h(f);c.u32(p.length);for(const _ of p)c.u64(_);c.u32(o),c.u64(u[g])}),c.alignTo(_e);const m=c.length;for(let f=0;f<r.length;f++){const g=m+u[f];for(;c.length<g;)c.raw(new Uint8Array(1));c.raw(Ia(r[f].data,t))}return c.bytes()}function Wa(a){const e=Me(a);return{model_type:"evermind",architectures:["EvermindForCausalLM"],vocab_size:e.vocabSize,d_model:e.dModel,hidden_size:e.dModel,num_hidden_layers:e.numLayers,conv_kernel:e.convKernel,intermediate_size:e.hiddenDim,num_experts:e.numExperts,num_experts_per_tok:e.topK,rms_norm_eps:1e-5,tie_word_embeddings:!0,torch_dtype:"float32",transformers_version:"4.0.0"}}function za(){return{do_sample:!1,temperature:1,max_new_tokens:64}}function $a(a){const e={};for(const[r,o]of a.vocab)e[r]=o;const t=[...a.merges.keys()],n=[];for(const r of[a.unkToken,a.bosToken,a.eosToken,a.padToken]){const o=a.vocab.get(r);o!==void 0&&!n.some(s=>s.id===o)&&n.push({id:o,content:r})}return{version:"1.0",truncation:null,padding:null,added_tokens:n.map(r=>({id:r.id,content:r.content,single_word:!1,lstrip:!1,rstrip:!1,normalized:!1,special:!0})),normalizer:null,pre_tokenizer:{type:"ByteLevel",add_prefix_space:!1,trim_offsets:!0,use_regex:!0},post_processor:{type:"ByteLevel",add_prefix_space:!0,trim_offsets:!1,use_regex:!0},decoder:{type:"ByteLevel",add_prefix_space:!0,trim_offsets:!0,use_regex:!0},model:{type:"BPE",dropout:null,unk_token:null,continuing_subword_prefix:null,end_of_word_suffix:null,fuse_unk:!1,byte_fallback:!1,vocab:e,merges:t}}}function ja(a,e={}){const t=Me(a),n=xr(a),r=e.name??"Evermind",o=e.license??"mit",s=["evermind","ssm","mixture-of-experts","text-generation",...e.tags??[]],d=["---",`license: ${o}`,"library_name: builderforce-memory","pipeline_tag: text-generation","tags:",...s.map(c=>`  - ${c}`),"---"].join(`
`),i=`
# ${r}

${e.description??"A self-updating SSM language model built with the BuilderForce Evermind engine."}

An **Evermind** model: a shared-expert hybrid SSM (depthwise causal conv token-mixer
+ top-k Mixture-of-Experts channel-mixer, tied embeddings). Trained and run natively
in TypeScript/WebGPU; this repository is an export for the Hugging Face ecosystem.

## Architecture

| field | value |
| --- | --- |
| vocab size | ${t.vocabSize} |
| d_model | ${t.dModel} |
| layers | ${t.numLayers} |
| conv kernel | ${t.convKernel} |
| FFN hidden | ${t.hiddenDim} |
| experts (top-k) | ${t.numExperts} (${t.topK}) |
| parameters | ${n.toLocaleString("en-US")} |

## Files

- \`model.safetensors\` — weights (HF-native, F32).
- \`model.onnx\` — runnable graph (\`input_ids\` → \`logits\`); load with onnxruntime / transformers.js.
- \`config.json\`, \`generation_config.json\`, \`tokenizer.json\` — HF sidecars.
- \`model.gguf\` — GGUF container (custom architecture; for GGUF tooling).
- \`model.evermind\` — the native package; runs in \`@seanhogg/builderforce-memory\` (full self-update).

## Usage (ONNX, no KV-cache — re-run full context per step)

\`\`\`js
import * as ort from "onnxruntime-web";
const session = await ort.InferenceSession.create("model.onnx");
const ids = BigInt64Array.from([/* token ids */].map(BigInt));
const input_ids = new ort.Tensor("int64", ids, [1, ids.length]);
const { logits } = await session.run({ input_ids });
\`\`\`
${e.author?`
## Author

${e.author}
`:""}`;return`${d}
${i}`}const as=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],Ra="application/json";function Re(a,e){return{path:a,data:JSON.stringify(e,null,2),contentType:Ra}}function os(a,e,t={},n){const r=xr(a),o=()=>({format:e,files:[],paramCount:r});switch(e){case"safetensors":{const s=o();return s.files.push({path:"model.safetensors",data:Tt(a,{fp16:t.fp16}),contentType:"application/octet-stream"}),s}case"onnx":{const s=o();return s.files.push({path:"model.onnx",data:zt(a,{producerVersion:t.version}),contentType:"application/octet-stream"}),s}case"gguf":{const s=o();return s.files.push({path:"model.gguf",data:jt(a,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"}),s}case"huggingface":{if(!n)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const s=o();return s.files.push({path:"model.safetensors",data:Tt(a,{fp16:t.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:zt(a,{producerVersion:t.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:jt(a,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"},Re("config.json",Wa(a)),Re("generation_config.json",za()),Re("tokenizer.json",$a(n)),{path:"README.md",data:ja(a,t),contentType:"text/markdown"}),s}default:throw new Error(`exportEvermind: unknown format "${String(e)}"`)}}function Mr(a){if(a.length<8)throw new Error("safetensors: buffer too short for header length");const e=new DataView(a.buffer,a.byteOffset,a.byteLength),t=Number(e.getBigUint64(0,!0)),n=8+t;if(n>a.length)throw new Error(`safetensors: header length ${t} exceeds buffer`);const r=new TextDecoder().decode(a.subarray(8,n));let o;try{o=JSON.parse(r)}catch(i){throw new Error(`safetensors: malformed JSON header (${i instanceof Error?i.message:String(i)})`)}const s=n,d=[];for(const[i,c]of Object.entries(o)){if(i==="__metadata__")continue;const h=c;if(!h||!Array.isArray(h.shape)||!Array.isArray(h.data_offsets))throw new Error(`safetensors: malformed entry for "${i}"`);const[l,u]=h.data_offsets,m=h.shape.reduce((g,p)=>g*p,1),f=a.subarray(s+l,s+u);d.push({name:i,shape:h.shape,data:Oa(f,h.dtype,m,i)})}return d}function Oa(a,e,t,n){const r=new DataView(a.buffer,a.byteOffset,a.byteLength),o=new Float32Array(t),s=e.toUpperCase();if(s==="F32"||s==="FLOAT32"){if(a.length<t*4)throw new Error(`safetensors: "${n}" F32 bytes ${a.length} < ${t*4}`);for(let d=0;d<t;d++)o[d]=r.getFloat32(d*4,!0);return o}if(s==="F16"||s==="FLOAT16"){if(a.length<t*2)throw new Error(`safetensors: "${n}" F16 bytes ${a.length} < ${t*2}`);for(let d=0;d<t;d++)o[d]=st(r.getUint16(d*2,!0));return o}if(s==="BF16"||s==="BFLOAT16"){if(a.length<t*2)throw new Error(`safetensors: "${n}" BF16 bytes ${a.length} < ${t*2}`);const d=new Uint32Array(o.buffer);for(let i=0;i<t;i++)d[i]=r.getUint16(i*2,!0)<<16;return o}throw new Error(`safetensors: unsupported dtype "${e}" for "${n}" (expected F32, F16 or BF16)`)}function Ka(a,e){const t=new Map(a.map(u=>[u.name,u])),n=t.get("token_embedding.weight");if(!n||n.shape.length!==2)throw new Error("import: missing token_embedding.weight [vocab, dModel]");const[r,o]=n.shape;let s=0,d=0;for(const u of a){const m=/^layers\.(\d+)\./.exec(u.name);m&&(s=Math.max(s,Number(m[1])+1));const f=/^layers\.\d+\.moe\.experts\.(\d+)\./.exec(u.name);f&&(d=Math.max(d,Number(f[1])+1))}if(s===0)throw new Error("import: no `layers.<n>.` tensors found");const i=t.get("layers.0.conv.weight");if(!i||i.shape.length!==2)throw new Error("import: missing layers.0.conv.weight [dModel, convKernel]");const c=i.shape[1],h=t.get("layers.0.moe.shared.w1");if(!h||h.shape.length!==2)throw new Error("import: missing layers.0.moe.shared.w1 [hiddenDim, dModel]");const l=h.shape[0];return{vocabSize:r,dModel:o,numLayers:s,convKernel:c,hiddenDim:l,numExperts:d,topK:Math.min(e??2,Math.max(1,d))}}function Ha(a,e={}){const t=[];for(const c of a){const h=e.rename?e.rename(c.name):c.name;h!=null&&t.push({...c,name:h})}const n=new Map(t.map(c=>[c.name,c])),r=e.arch??Ka(t,e.topK),o=vr(r),s=[];for(const c of o){const h=n.get(c.name);if(!h)throw new Error(`import: missing tensor "${c.name}" (expected shape [${c.shape.join(", ")}])`);const l=c.shape.reduce((u,m)=>u*m,1);if(h.data.length!==l)throw new Error(`import: tensor "${c.name}" has ${h.data.length} elements, expected ${l} ([${c.shape.join(", ")}])`);s.push(h.data)}const d=new Ne({vocabSize:r.vocabSize,dModel:r.dModel,numLayers:r.numLayers,convKernel:r.convKernel,hiddenDim:r.hiddenDim,numExperts:r.numExperts,topK:r.topK}),i=d.parameters();if(i.length!==s.length)throw new Error(`import: parameter-count drift (model ${i.length} vs imported ${s.length})`);for(let c=0;c<i.length;c++)i[c].data.set(s[c]);return d}function ss(a,e={}){return Ha(Mr(a),e)}function Lr(a){return a.startsWith("model.")?a.slice(6):a}function Ga(a){return a.reduce((e,t)=>e*t,1)}function ce(a){const e=a.filter(t=>t!==1);return e.length>0?e:[1]}function Oe(a,e){return a.length===e.length&&a.every((t,n)=>t===e[n])}function Ua(a){if(!(a>0))throw new Error(`import/foreign: softplus⁻¹ needs a positive input, got ${a}`);return a>30?a:Math.log(Math.expm1(a))}function Rt(a,e){const t=Ga(a.shape);if(a.op.kind==="fill")return new Float32Array(t).fill(a.op.value);if(!e)throw new Error(`import/foreign: rule for "${a.target}" has no source tensor`);const n=`"${e.name}" → "${a.target}"`;switch(a.op.kind){case"copy":case"negExpToSoftplusInv":{if(!Oe(ce(e.shape),ce(a.shape)))throw new Error(`import/foreign: ${n} shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${a.shape.join(", ")}]`);if(e.data.length!==t)throw new Error(`import/foreign: ${n} has ${e.data.length} elements, expected ${t}`);if(a.op.kind==="copy")return Float32Array.from(e.data);const r=new Float32Array(t);for(let o=0;o<t;o++)r[o]=Ua(Math.exp(e.data[o]));return r}case"convTaps":{const[r,o]=ce(a.shape),s=ce(e.shape);if(!Oe(s,[r,o]))throw new Error(`import/foreign: ${n} depthwise conv shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${a.shape.join(", ")}] (a [channels, 1, kernel] PyTorch kernel squeezes to [channels, kernel])`);const d=new Float32Array(t);for(let i=0;i<r;i++)for(let c=0;c<o;c++)d[i*o+c]=e.data[i*o+(o-1-c)];return d}case"rowSlice":{if(e.shape.length!==2)throw new Error(`import/foreign: ${n} rowSlice needs a rank-2 source, got [${e.shape.join(", ")}]`);const[r,o]=e.shape,{start:s,count:d}=a.op;if(s<0||s+d>r)throw new Error(`import/foreign: ${n} rowSlice [${s}, ${s+d}) is outside the checkpoint tensor's ${r} rows — the source layout is not what this adapter expects`);if(!Oe(ce(a.shape),ce([d,o])))throw new Error(`import/foreign: ${n} rowSlice yields [${d}, ${o}] but this model expects [${a.shape.join(", ")}]`);return Float32Array.from(e.data.subarray(s*o,(s+d)*o))}}}function qa(a,e){const t=new Map;for(const d of e){const i=Lr(d.name);t.set(i,{...d,name:i})}const n=new Map,r=[],o=new Set;for(const d of a.rules){if(n.has(d.target))throw new Error(`import/foreign: plan "${a.adapter}" defines "${d.target}" twice`);if(d.from.length===0){if(d.op.kind!=="fill")throw new Error(`import/foreign: rule for "${d.target}" names no source but is not a fill rule`);n.set(d.target,Rt(d,null)),r.push({target:d.target,value:d.op.value,reason:d.note??"this architecture has no corresponding tensor"});continue}const i=d.from.map(c=>t.get(c)).find(c=>c!=null);if(!i)throw new Error(`import/foreign: checkpoint is missing "${d.from[0]}" (needed for "${d.target}", expected shape [${d.shape.join(", ")}])`+(d.from.length>1?`; also tried ${d.from.slice(1).map(c=>`"${c}"`).join(", ")}`:""));o.add(i.name),n.set(d.target,Rt(d,i))}const s=[...t.keys()].filter(d=>!o.has(d)).sort();return{adapter:a.adapter,weights:n,unmappedSources:s,synthesisedTargets:r,discardedSources:a.discards}}const Ot="codestral_mamba",Va=["backbone.embeddings.weight","backbone.embedding.weight"];function Xa(a){const{vocabSize:e,dModel:t,numLayers:n,dInner:r,dState:o,dConv:s,nHeads:d,nGroups:i}=a,c=r+2*i*o,h=c+d,l=[{target:"embedding",shape:[e,t],from:Va,op:{kind:"copy"}}];for(let u=0;u<n;u++){const m=`backbone.layers.${u}.mixer`,f=`layer${u}`;l.push({target:`${f}.wInProj`,shape:[h,t],from:[`${m}.in_proj.weight`],op:{kind:"rowSlice",start:r,count:h},note:"upstream rows are [gate, x, B, C, dt]; this block has no gate branch"},{target:`${f}.wConv`,shape:[c,s],from:[`${m}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [conv_dim, 1, d_conv] → [conv_dim, d_conv] with the tap axis reversed"},{target:`${f}.bConv`,shape:[c],from:[`${m}.conv1d.bias`],op:{kind:"copy"}},{target:`${f}.A_log`,shape:[d],from:[`${m}.A_log`],op:{kind:"negExpToSoftplusInv"},note:"upstream A = -exp(A_log); this engine's SSD kernel uses A = -softplus(A_log)"},{target:`${f}.dt_bias`,shape:[d],from:[`${m}.dt_bias`],op:{kind:"copy"}},{target:`${f}.D_vec`,shape:[d],from:[`${m}.D`],op:{kind:"copy"}},{target:`${f}.wOutProj`,shape:[t,r],from:[`${m}.out_proj.weight`],op:{kind:"copy"}},{target:`${f}.normWeight`,shape:[r],from:[`${m}.norm.weight`],op:{kind:"copy"},note:"upstream this gain belongs to a GATED RMSNorm; applied ungated here"},{target:`${f}.preNormWeight`,shape:[t],from:[`backbone.layers.${u}.norm.weight`],op:{kind:"copy"}})}return l.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),l}function Ya(a){const e=[];for(let t=0;t<a.numLayers;t++)e.push({source:`backbone.layers.${t}.mixer.in_proj.weight`,elements:a.dInner*a.dModel,reason:"the leading d_inner gate (z) rows — Mamba2Block computes norm(y) rather than norm(y * silu(z)), so it has no gate branch to receive them"});return e}const Qa={id:Ot,label:"Codestral-Mamba (Mamba-2 / SSD)",modelTypes:["mamba2"],architectures:["Mamba2ForCausalLM","MambaCodestralForCausalLM"],describe(a){const e=de(a,"hidden_size"),t=de(a,"num_hidden_layers"),n=de(a,"vocab_size"),r=de(a,"state_size"),o=de(a,"conv_kernel"),s=de(a,"num_heads"),d=$e(a,["n_groups"])??1,i=$e(a,["chunk_size"])??256,c=Wr(a,e),h=zr(c,e,"Codestral-Mamba"),l=$e(a,["head_dim"]);if(c%s!==0)throw new Error(`import/foreign: Codestral-Mamba d_inner ${c} is not divisible by num_heads ${s}`);if(l!==void 0&&l*s!==c)throw new Error(`import/foreign: Codestral-Mamba config is inconsistent — head_dim ${l} × num_heads ${s} = ${l*s}, but d_inner is ${c}`);const u=Array.from({length:t},()=>({type:"mamba2"})),m={vocabSize:n,dModel:e,numLayers:t,layers:u,dState:r,dConv:o,expand:h,nHeads:s,nGroups:d,chunkLen:i},f={vocabSize:n,dModel:e,numLayers:t,dInner:c,dState:r,dConv:o,nHeads:s,nGroups:d};return{modelConfig:m,plan:{adapter:Ot,rules:Xa(f),discards:Ya(f)}}}},Ve=[$r,jr,Qa];function Ja(a){const e=a.architectures;return Array.isArray(e)?e.filter(t=>typeof t=="string"):[]}function Za(a){const e=a.model_type;return typeof e=="string"?e:void 0}function eo(a,e){const t=[...a,e??""].join(" ").toLowerCase();return t.includes("mamba")||t.includes("ssm")?!1:/llama|mistral|qwen|gpt|phi|gemma|falcon(?!_?mamba)|starcoder|deepseek|olmo|attention|forcausallm/.test(t)}function Kt(){return Ve.map(a=>`${a.label} — architectures ${a.architectures.join(" / ")}, model_type ${a.modelTypes.join(" / ")}`).join("; ")}function to(a){const e=Ja(a),t=Za(a),n=Ve.find(s=>e.some(d=>s.architectures.includes(d)));if(n)return n;const r=t?Ve.find(s=>s.modelTypes.includes(t)):void 0;if(r)return r;const o=e.length>0?`architectures [${e.join(", ")}]`:t?`model_type "${t}"`:"a config declaring neither `architectures` nor `model_type`";throw eo(e,t)?new Error(`import/foreign: ${o} is a TRANSFORMER checkpoint — its attention weights (q/k/v/o projections, positional embeddings) have no counterpart in a state-space mixer, so no weight port can exist for it at any tensor naming. Transformer coders (IQuest, NousCoder, Maincoder and the like) can only be brought across by DISTILLATION — train this engine's SSM against the transformer's outputs. Weight porting is supported only for: ${Kt()}.`):new Error(`import/foreign: unsupported checkpoint — ${o}. Supported: ${Kt()}. A transformer checkpoint cannot be weight-ported at all; distillation is the only route.`)}function ro(a,e){const t=to(a),{modelConfig:n,plan:r}=t.describe(a);return{...qa(r,e),modelConfig:n}}function is(a,e){return ro(a,Mr(e))}function ds(a,e){const t=a.parameters(),n=new Set(t.map(o=>o.name)),r=[...e.weights.keys()].filter(o=>!n.has(o));if(r.length>0)throw new Error(`import/foreign: ported tensors ${r.slice(0,5).map(o=>`"${o}"`).join(", ")}${r.length>5?` (+${r.length-5} more)`:""} have no parameter on this model — build it from the port's modelConfig`);for(const o of t){const s=e.weights.get(o.name);if(!s)throw new Error(`import/foreign: no ported tensor for parameter "${o.name}" — the model was built from a different config than the port's modelConfig`);if(s.length!==o.numel)throw new Error(`import/foreign: parameter "${o.name}" expects ${o.numel} elements, the port produced ${s.length}`);he(a.device,o.buf,s)}}function De(a){throw new Error(`import/foreign: cannot read a Mamba-1 config from these tensors — ${a}`)}function cs(a){const e=new Map(a.map(p=>[Lr(p.name),p])),t=p=>e.get(p)?.shape,n=t("backbone.embeddings.weight")??t("backbone.embedding.weight");(!n||n.length!==2)&&De("no backbone.embedding(s).weight [vocab, d_model]");const[r,o]=n;let s=0;for(;e.has(`backbone.layers.${s}.mixer.in_proj.weight`);)s++;s===0&&De("no backbone.layers.N.mixer.in_proj.weight");const d="backbone.layers.0.mixer",i=t(`${d}.in_proj.weight`),c=t(`${d}.conv1d.weight`),h=t(`${d}.A_log`),l=t(`${d}.x_proj.weight`);(!c||!h||!l)&&De("layer 0 is missing conv1d.weight, A_log or x_proj.weight");const u=i[0]/2,m=h[1],f=c[c.length-1],g=l[0]-2*m;return(!Number.isInteger(u)||g<=0)&&De(`inconsistent shapes (in_proj ${i.join("×")}, x_proj ${l.join("×")})`),{model_type:"mamba",architectures:["MambaForCausalLM"],vocab_size:r,hidden_size:o,num_hidden_layers:s,intermediate_size:u,state_size:m,conv_kernel:f,time_step_rank:g}}function ls(a,e,t={}){if(!Number.isInteger(e)||e<=0)throw new Error(`import/foreign: vocabulary size must be a positive integer, got ${e}`);const n=a.modelConfig.vocabSize;if(e===n)return a;const r=a.weights.get("embedding");if(!r)throw new Error('import/foreign: the port has no "embedding" to resize');const o=a.modelConfig.dModel,s=new Float32Array(e*o);s.set(r.subarray(0,Math.min(n,e)*o));const d=[...a.synthesisedTargets];if(e>n){const c=t.std??.02,h=new ae(t.seed??1);s.set(fe((e-n)*o,c,()=>h.next()),n*o),d.push({target:"embedding",value:c,reason:`rows ${n}..${e-1} drawn from N(0, ${c}²) to reach a ${e}-token vocabulary`})}const i=new Map(a.weights);return i.set("embedding",s),{...a,weights:i,synthesisedTargets:d,modelConfig:{...a.modelConfig,vocabSize:e}}}const hs={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},Sr={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},Er=8,ne=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],no=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],ut=[0,.2,.5,.5,.8,.5,.7,.5];function Ie(a,e){const t=no[a];return t?Number.isNaN(e)?t[0]:Math.max(t[0],Math.min(t[1],e)):e}function us(a){for(let e=0;e<a.length&&e<Er;e++)a[e]=Ie(e,a[e]);return a}function ao(){return Float32Array.from(ut)}function Dr(a){const e={};for(let t=0;t<ne.length;t++)e[ne[t]]=a[t]??0;return e}function oo(a){const e=ao();for(let t=0;t<ne.length;t++){const n=a[ne[t]];typeof n=="number"&&!Number.isNaN(n)&&(e[t]=Ie(t,n))}return e}function oe(a){return((typeof a=="number"&&!Number.isNaN(a)?Math.max(0,Math.min(100,a)):50)-50)/50}function Br(a){const e=Dr(ut);if(!a)return e;const t=oe(a.openness),n=oe(a.emotionality),r=oe(a.conscientiousness),o=oe(a.extraversion),s=oe(a.regulatoryFocus),d=oe(a.riskTolerance),i=oe(a.grit),c=oe(a.stimulation),h=(l,u)=>{e[l]=Ie(Sr[l],u)};return h("driveCuriosity",.5+.35*t+.15*c),h("exploration",.4+.3*t+.25*d+.15*s),h("driveCaution",.5+.3*r-.3*d-.2*s+.15*n),h("arousal",.2+.2*n+.1*o),h("driveSocial",.5+.35*o),h("driveEffort",.8+.15*i+.1*r),h("valence",0+.1*s-.1*n),h("attention",.7+.1*r),e}function fs(a){return oo(Br(a))}function Xe(a,e){return Ie(Sr[a],e)}function Ye(){return Dr(ut)}function ms(a){if(a.length===0)return Ye();const e=Ye();for(const t of ne)e[t]=0;for(const t of a){const n=Br(t);for(const r of ne)e[r]+=n[r]}for(const t of ne)e[t]/=a.length;return e}function Ht(a,e){const t={...a};for(const n of ne){const r=e[n];typeof r=="number"&&!Number.isNaN(r)&&(t[n]=Xe(n,t[n]+r))}return t}const so=a=>Math.max(0,Math.min(1,a.intensity??.5));function ps(a){const e=so(a);switch(a.kind){case"success":return{valence:.5*e,arousal:-.15*e,driveCaution:-.1*e,driveEffort:-.05*e};case"progress":return{valence:.25*e,arousal:.05*e,driveEffort:-.03*e};case"error":return{valence:-.45*e,arousal:.4*e,driveCaution:.3*e,attention:.15*e};case"blocked":return{valence:-.35*e,arousal:.3*e,driveEffort:-.15*e,driveSocial:.2*e};case"risk":return{arousal:.35*e,driveCaution:.4*e,attention:.2*e,exploration:-.15*e};case"feedback":{const t=Math.sign(a.sign??1)||1;return{valence:.4*e*t,arousal:.1*e,driveSocial:.1*e}}case"idle":return{arousal:-.2*e,driveEffort:.15*e};default:return{}}}function gs(a,e,t={}){const n=t.rate??.1,r=t.fatigue??0,o={...a};for(const s of ne)o[s]=Xe(s,o[s]+n*(e[s]-o[s]));return r>0&&(o.driveEffort=Xe("driveEffort",o.driveEffort-r)),o}function io(a,e=.5){const t=a.arousal-e,n=1-2.8*t*t;return Math.max(.1,Math.min(1,n))}function Qe(a){let e=.5*a.exploration+.3*a.driveCuriosity;return e+=.15*a.valence,e-=.25*(1-a.driveEffort),e-=.2*(a.driveCaution-.5),Math.max(0,Math.min(1,e))}function _s(a,e){if(e.length===0)return{choice:null,exploreBias:Qe(a)};const t=Qe(a);let n=e[0],r=-1/0;for(const o of e){const s=Math.max(0,Math.min(1,o.novelty)),d=-Math.abs(s-t);d>r&&(r=d,n=o)}return{choice:n,exploreBias:t}}const Ke=.6,He=.4;function co(a){const e=[],t={},n=i=>{t.thinkLevel!=="high"&&(t.thinkLevel=i)};a.valence<=-.4?(e.push("Affect (negative): recent steps have gone badly — slow down, avoid rash or destructive actions, and re-verify your assumptions before proceeding."),n("high"),t.reasoningLevel="on"):a.valence>=.4&&e.push("Affect (positive): things are going well — keep momentum, but don't get sloppy."),a.arousal>=.7?(e.push("Arousal (heightened): you are highly activated — resist the urge to rush; double-check before any irreversible step."),n("high")):a.arousal<=.15&&e.push("Arousal (low): this is routine — keep it lightweight and efficient."),a.driveCaution>=Ke?(e.push("Drive (caution): heightened — prefer reversible steps, add guardrails, and confirm risky or destructive operations."),n("medium")):a.driveCaution<=He&&e.push("Drive (caution): relaxed — bias to action on low-risk work."),a.driveCuriosity>=Ke&&e.push("Drive (curiosity): high — it is appropriate to investigate and consider alternative approaches."),a.driveEffort<=He&&e.push("Drive (effort): energy is low — keep scope tight, avoid over-engineering, checkpoint progress, and consider escalating rather than grinding."),a.driveSocial>=Ke?e.push("Drive (social): communicate proactively — surface progress and ask for input when blocked."):a.driveSocial<=He&&e.push("Drive (social): work heads-down — narrate only what matters."),io(a)<=.5&&(e.push("Attention (degraded): your attention gate is low — re-read the task carefully and do not skip verification steps."),n("medium"));const o=Qe(a);o>=.7?e.push("Action selection: lean exploratory — try a novel approach before settling on the obvious one."):o<=.3&&e.push("Action selection: lean exploitative — use the proven, known approach and avoid unnecessary detours.");let s=0;s+=.2*(a.exploration-.5)*2,s+=.06*(a.driveCuriosity-.5)*2,s+=.08*a.valence,s-=.16*(a.driveCaution-.5)*2,s-=.08*Math.max(0,a.arousal-.7);const d=Math.max(-.3,Math.min(.3,Math.round(s*100)/100));return Math.abs(d)>=.02&&(t.temperatureDelta=d),{directives:e,params:t}}const lo="Current affective state (execute accordingly):";function bs(a){if(!a)return"";const{directives:e}=co(a);return e.length===0?"":[lo,...e.map(t=>`- ${t}`)].join(`
`)}const ho=/\b(delete|drop|truncate|destroy|wipe|prod(uction)?|migrat|secret|credential|password|payment|billing|charge|refund|deploy|force[- ]?push|rm\s+-rf|irreversible|security|auth|breaking)\b/i,uo=/\b(refactor|rewrite|architecture|complex|large|entire|whole|across|end[- ]to[- ]end|overhaul)\b/i;function ws(a,e=Ye()){const t=a||"";let n=e;return ho.test(t)&&(n=Ht(n,{driveCaution:.3,arousal:.25,attention:.15,exploration:-.1})),uo.test(t)&&(n=Ht(n,{driveCuriosity:.2,arousal:.1,exploration:.1})),n}const fo={inputDim:32,hiddenDim:16,stateDim:Er,rewardWeight:.5},Gt=1280131651,mo=296863214;class ys{config;win;ws;aLogit;woutState;boutState;woutReward;boutReward;gWin;gWs;gALogit;gWoutState;gBoutState;gWoutReward;gBoutReward;constructor(e={}){const t={...fo,...e};if(t.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${t.hiddenDim})`);this.config=t;const{inputDim:n,hiddenDim:r,stateDim:o}=t,s=new ae((e.seed??mo)>>>0||1),d=c=>{const h=Math.max(s.next(),1e-12),l=s.next();return c*Math.sqrt(-2*Math.log(h))*Math.cos(2*Math.PI*l)},i=(c,h)=>{const l=new Float32Array(c);for(let u=0;u<c;u++)l[u]=d(h);return l};this.win=i(r*n,.1),this.ws=i(r*o,.1),this.aLogit=i(r,.05),this.woutState=i(o*r,.05),this.boutState=new Float32Array(o),this.woutReward=i(r,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(e,t,n){const r=this._forwardCached(e,t,n);return{hidden:r.hn,delta:r.delta,reward:r.reward}}_forwardCached(e,t,n){const{inputDim:r,hiddenDim:o,stateDim:s}=this.config,d=Float32Array.from({length:r},(g,p)=>e[p]??0),i=Float32Array.from({length:o},(g,p)=>t[p]??0),c=Float32Array.from({length:s},(g,p)=>n[p]??0),h=new Float32Array(o),l=new Float32Array(o),u=new Float32Array(o);for(let g=0;g<o;g++){let p=0;const _=g*r;for(let b=0;b<r;b++)p+=this.win[_+b]*d[b];const y=g*s;for(let b=0;b<s;b++)p+=this.ws[y+b]*c[b];h[g]=er(this.aLogit[g]),l[g]=Math.tanh(p),u[g]=h[g]*i[g]+(1-h[g])*l[g]}const m=new Float32Array(s);for(let g=0;g<s;g++){let p=this.boutState[g];const _=g*o;for(let y=0;y<o;y++)p+=this.woutState[_+y]*u[y];m[g]=Math.tanh(p)}let f=this.boutReward[0];for(let g=0;g<o;g++)f+=this.woutReward[g]*u[g];return{x:d,sPrev:c,hPrev:i,a:h,t:l,hn:u,delta:m,reward:f}}backwardStep(e,t,n,r,o){const{inputDim:s,hiddenDim:d,stateDim:i,rewardWeight:c}=this.config,h=this._forwardCached(e,t,n);let l=0;const u=new Float32Array(i);for(let p=0;p<i;p++){const _=h.delta[p]-(r[p]??0);l+=.5*_*_,u[p]=_}const m=h.reward-o;l+=.5*c*m*m;const f=c*m,g=new Float32Array(d);for(let p=0;p<i;p++){const _=u[p]*(1-h.delta[p]*h.delta[p]);this.gBoutState[p]=this.gBoutState[p]+_;const y=p*d;for(let b=0;b<d;b++)this.gWoutState[y+b]=this.gWoutState[y+b]+_*h.hn[b],g[b]=g[b]+_*this.woutState[y+b]}this.gBoutReward[0]=this.gBoutReward[0]+f;for(let p=0;p<d;p++)this.gWoutReward[p]=this.gWoutReward[p]+f*h.hn[p],g[p]=g[p]+f*this.woutReward[p];for(let p=0;p<d;p++){const _=h.a[p],y=h.t[p];this.gALogit[p]=this.gALogit[p]+g[p]*(h.hPrev[p]-y)*_*(1-_);const b=g[p]*(1-_)*(1-y*y),v=p*s;for(let E=0;E<s;E++)this.gWin[v+E]=this.gWin[v+E]+b*h.x[E];const M=p*i;for(let E=0;E<i;E++)this.gWs[M+E]=this.gWs[M+E]+b*h.sPrev[E]}return{loss:l,hidden:h.hn}}exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.reduce((h,l)=>h+l.numel,0),o=5,s=o*4,d=t?r*2:r*4,i=new ArrayBuffer(s+d),c=new Uint32Array(i,0,o);if(c[0]=Gt,c[1]=t?2:1,c[2]=this.config.inputDim,c[3]=this.config.hiddenDim,c[4]=this.config.stateDim,t){const h=new Float32Array(r);let l=0;for(const m of n)h.set(m.data,l),l+=m.numel;const u=ke(h);new Uint16Array(i,s,r).set(u)}else{const h=new Float32Array(i,s,r);let l=0;for(const u of n)h.set(u.data,l),l+=u.numel}return i}loadWeights(e){const t=new Uint32Array(e,0,5);if(t[0]!==Gt)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const n=t[1],r=t[2],o=t[3],s=t[4];if(r!==this.config.inputDim||o!==this.config.hiddenDim||s!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${r}/${o}/${s} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const d=this.parameters(),i=d.reduce((u,m)=>u+m.numel,0),c=20;let h;n===2?h=Ae(new Uint16Array(e,c,i)):h=new Float32Array(e.slice(c,c+i*4));let l=0;for(const u of d)u.data.set(h.subarray(l,l+u.numel)),l+=u.numel}}function po(a){return{parameters:()=>a.parameters(),gradients:()=>a.gradients(),zeroGrad:()=>a.zeroGrad(),accumulate:e=>a.backwardStep(e.input,a.initHidden(),e.state,e.deltaTarget,e.reward).loss,loss:e=>{const{rewardWeight:t}=a.config,n=a.forward(e.input,a.initHidden(),e.state);let r=0;for(let s=0;s<n.delta.length;s++){const d=n.delta[s]-(e.deltaTarget[s]??0);r+=.5*d*d}const o=n.reward-e.reward;return r+=.5*t*o*o,r}}}class vs{model;device;_trainer;constructor(e,t=null){this.model=e,this.device=t,this._trainer=new Rr(po(e),t,"LimbicTrainer")}get gpuTraining(){return this._trainer.gpuTraining}train(e,t={}){return this._trainer.train(e,t)}evaluate(e){return this._trainer.evaluate(e)}}const xs=`

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
`;function go(){const a=new Uint8Array(8);return globalThis.crypto.getRandomValues(a),Array.from(a,e=>e.toString(16).padStart(2,"0")).join("")}function ks(a,e={},t=Date.now()){const n=new Set(e.removed??[]),r=new Set(e.fixed??[]),o=[],s=[];for(const d of a.steps){if(n.has(d.id))continue;const i=d.action;let c;if(i.kind==="setValue")if(!i.secret&&r.has(d.id))c={kind:"setValue",target:i.target,value:{from:"literal",text:i.value}};else{const l=Ut(e.paramNames?.[d.id]??"")||Ut(wt(i.target))||"value",u=_o(o,l);o.push({name:u,label:wt(i.target),default:i.secret?null:i.value,secret:!!i.secret}),c={kind:"setValue",target:i.target,value:{from:"param",name:u}}}else c=i;s.push({id:d.id,action:c,requiresApproval:e.approvals?.[d.id]??Or(i),screenshot:d.screenshot??null})}return{id:go(),name:e.name?.trim()||a.name,program:a.program,args:[...a.args],params:o,steps:s,sourceEpisode:a.id,createdAt:t,routine:null}}function Ut(a){return a.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join("_").slice(0,40).replace(/_+$/,"")}function _o(a,e){if(!a.some(t=>t.name===e))return e;for(let t=2;;t++){const n=`${e}_${t}`;if(!a.some(r=>r.name===n))return n}}const Ge=6e4,Ue=864e5;function bo(a,e,t,n){if(a.every==="minutes"){const i=Math.max(1,a.minutes)*Ge;return e==null||t-e>=i}const r=n*Ge,o=t+r,d=o-(o%Ue+Ue)%Ue+Math.min(23,Math.max(0,a.hour))*36e5+Math.min(59,Math.max(0,a.minute))*Ge;return o>=d&&(e==null||e+r<d)}function As(a,e,t){return a.filter(n=>n.routine?.enabled&&bo(n.routine.schedule,n.routine.lastRunAt,e,t)).sort((n,r)=>(n.routine?.lastRunAt??0)-(r.routine?.lastRunAt??0))}const wo=864e5;function qt(a,e){return new Date(a+e*6e4).toISOString().slice(0,10)}function Ms(a,e){const t=m=>{const f=a.learned[m];return typeof f=="number"&&f>=1&&f<=e.modelIndex},n=Kr(a.episodes,a.skills),r=n.filter(m=>t(m.id)).length,o={running:0,succeeded:0,failed:0,stopped:0,denied:0},s={approved:0,denied:0},d=[];for(const m of a.episodes)d.push({region:"hippocampus",kind:"demonstration",id:m.id,name:m.name,at:m.startedAt});for(const m of a.skills)d.push({region:"basalGanglia",kind:"skill",id:m.id,name:m.name,at:m.createdAt});for(const m of a.runs){o[m.status]=(o[m.status]??0)+1,d.push({region:"basalGanglia",kind:"run",id:m.id,name:m.skillName,at:m.startedAt,detail:m.status});for(const f of m.steps)f.outcome!=="approved"&&f.outcome!=="denied"||(s[f.outcome]++,d.push({region:"amygdala",kind:"approval",id:m.id,name:m.skillName,at:f.at,detail:f.outcome}))}const i=a.adaptations.filter(m=>m.index<=e.modelIndex).reverse();for(const m of i)d.push({region:"neocortex",kind:"adaptation",id:m.version,name:m.version,at:m.at,detail:m.loss.toFixed(3)});const c=Math.max(1,e.days??30),h=[],l=new Map;for(let m=c-1;m>=0;m--){const f=qt(e.now-m*wo,e.utcOffsetMinutes);if(l.has(f))continue;const g={day:f,demonstrations:0,skills:0,runs:0,learned:0};l.set(f,g),h.push(g)}const u=(m,f,g=1)=>{const p=l.get(qt(m,e.utcOffsetMinutes));p&&(p[f]+=g)};for(const m of a.episodes)u(m.startedAt,"demonstrations");for(const m of a.skills)u(m.createdAt,"skills");for(const m of a.runs)u(m.startedAt,"runs");for(const m of i)u(m.at,"learned",m.learned.length);return{regions:{hippocampus:a.episodes.length,basalGanglia:a.skills.length,amygdala:s.approved+s.denied,hypothalamus:a.skills.filter(m=>m.routine?.enabled).length,neocortex:r},learned:r,pending:n.length-r,runs:o,approvals:s,adaptations:i,days:h,recent:d.sort((m,f)=>f.at-m.at).slice(0,Math.max(0,e.recent??40))}}const Je="evermind.experience/1",yo=500,vo=200;function Ze(){return{schema:Je,episodes:[],skills:[],runs:[],learned:{},adaptations:[],curated:{}}}function Vt(a){const e=a;return!e||e.schema!==Je?Ze():{schema:Je,episodes:Array.isArray(e.episodes)?e.episodes:[],skills:Array.isArray(e.skills)?e.skills:[],runs:Array.isArray(e.runs)?e.runs:[],learned:e.learned&&typeof e.learned=="object"&&!Array.isArray(e.learned)?e.learned:{},adaptations:Array.isArray(e.adaptations)?e.adaptations:[],curated:e.curated&&typeof e.curated=="object"&&!Array.isArray(e.curated)?e.curated:{}}}function xo(a){return{id:a.id,name:a.name,program:a.program,startedAt:a.startedAt,steps:a.steps.length}}class le{onChange;data;constructor(e,t){this.onChange=t,this.data=e?Vt(e):Ze()}load(e){this.data=Vt(e)}async changed(){await this.onChange?.(this.data)}static upsert(e,t){const n=e.findIndex(r=>r.id===t.id);n>=0?e[n]=t:e.push(t)}static remove(e,t){const n=e.findIndex(r=>r.id===t);return n<0?!1:(e.splice(n,1),!0)}async putEpisode(e){le.upsert(this.data.episodes,e),await this.changed()}async getEpisode(e){return this.data.episodes.find(t=>t.id===e)}async listEpisodes(){return[...this.data.episodes].sort((e,t)=>t.startedAt-e.startedAt).map(xo)}async deleteEpisode(e){const t=le.remove(this.data.episodes,e);return delete this.data.learned[e],delete this.data.curated[e],t&&await this.changed(),t}async putSkill(e){le.upsert(this.data.skills,e),await this.changed()}async getSkill(e){return this.data.skills.find(t=>t.id===e)}async listSkills(){return[...this.data.skills].sort((e,t)=>t.createdAt-e.createdAt)}async deleteSkill(e){const t=le.remove(this.data.skills,e);return delete this.data.learned[e],delete this.data.curated[e],t&&await this.changed(),t}async putRun(e){le.upsert(this.data.runs,e),this.data.runs.sort((t,n)=>n.startedAt-t.startedAt),this.data.runs.length=Math.min(this.data.runs.length,yo),await this.changed()}async appendRunStep(e,t){const n=this.data.runs.find(r=>r.id===e);return n?(n.steps.push(t),await this.changed(),!0):!1}async getRun(e){return this.data.runs.find(t=>t.id===e)}async listRuns(e){return this.data.runs.slice(0,Math.max(0,e))}async recordAdaptation(e){for(const t of e.learned)this.data.learned[t]=e.index,delete this.data.curated[t];this.data.adaptations.unshift(e),this.data.adaptations.length=Math.min(this.data.adaptations.length,vo),await this.changed()}async recordCuration(e){for(const t of e.kept)delete this.data.curated[t];Object.assign(this.data.curated,e.dropped),await this.changed()}async snapshot(){return structuredClone(this.data)}async clear(){this.data=Ze(),await this.changed()}}function Ls(a,e,t,n,r={},o){return{task:a,engine:e,version:t,shape:r,params:sr(nr(n)),...o!=null&&Number.isFinite(o)?{evalLoss:o}:{}}}function Ss(a){return or(at(a.params))}function Es(a,e){return a.manifest.mlHeads?.find(t=>t.task===e)}function Ds(a,e){return a.withMlHeads([...(a.manifest.mlHeads??[]).filter(t=>t.task!==e.task),e])}function Bs(a,e,t,n){const r=Jt(at(a.params),nr(e));return Hr(r,a.version,t,n??`ml head ${a.task}`,ar(a.task))}function Fs(a,e,t,n={}){const r=at(a.params),o=ar(a.task),s=[],d=[],i=[];e.forEach((l,u)=>{const m=Gr(l.target,o);if(m)return void i.push({index:u,reason:m});if(l.baseVersion!==a.version)return void i.push({index:u,reason:`stale base version ${l.baseVersion} (head is ${a.version})`});let f;try{f=Ur(l)}catch(p){return void i.push({index:u,reason:`diff is not base64: ${p instanceof Error?p.message:String(p)}`})}const g=qr(f,r);if(g)return void i.push({index:u,reason:g});s.push(f),d.push(l.weight??1)});const c=Hn(r,s,d,l=>t(or(l)),{...n,requireEval:n.requireEval??!0});return c.accepted?{head:{...a,version:a.version+1,params:sr(c.checkpoint),...c.newLoss!=null?{evalLoss:c.newLoss}:{}},merge:c,rejected:i}:{head:a,merge:c,rejected:i}}export{Do as ACTIVATIONS_BACKWARD_WGSL,ue as ACTIVATIONS_WGSL,Co as ATTENTION_BACKWARD_WGSL,vt as ATTENTION_FORWARD_WGSL,br as A_LOG_CLAMP_HI,_r as A_LOG_CLAMP_LO,tt as AdamW,Ns as AnomalyCompositeModel,sn as AttentionBlock,rt as BPETokenizer,Ts as BUILTIN_ML_TASKS,Is as BufferPool,Ws as CHECK_SCHEDULER_FEATURES,zs as CHECK_SCHEDULER_MODEL_CARD,$s as CHECK_SCHEDULER_TASK,js as CLOUD_ONLY_FAILURE_WEIGHT,Ce as COL_SLICE_ENTRY,Fe as COL_SLICE_WGSL,Fo as COMPLEX_SSD_BACKWARD_WGSL,en as COMPLEX_SSD_FORWARD_WGSL,Mo as CONV1D_BACKWARD_WGSL,ot as CONV1D_FORWARD_WGSL,Nt as CPU_GRADIENT_LAYER_TYPES,Rs as CRC_TRAILER_MAGIC,Os as CURATION_KNOWN_LIMIT,Ks as DEFAULT_DEDUPE_THRESHOLD,fo as DEFAULT_LIMBIC_CONFIG,mo as DEFAULT_LIMBIC_SEED,pe as DEFAULT_LM_CONFIG,vn as DEFAULT_LM_SEED,aa as DEFAULT_LORA_TARGETS,pn as DEFAULT_MOE_CONFIG,gn as DEFAULT_MOE_SEED,Hs as DELTA_TARGET_RE,Gs as DedupeIndex,Us as DenseHead,yn as DynamicLossScaler,jn as EVERMIND_ADAPT_MAX_CHARS,qs as EXPERIENCE_DEDUPE_TASK,Vs as EXPERIENCE_QUALITY_TASK,Je as EXPERIENCE_SCHEMA,as as EXPORT_FORMATS,Ne as EvermindLM,gr as EvermindLMLoRA,dt as EvermindLMTrainer,Q as EvermindModelPackage,Jo as EvermindTextEmbedder,Xs as EwmaModel,Ve as FOREIGN_MAMBA_ADAPTERS,Ys as GRAD_CLIP_WGSL,Qs as GbmModel,Rr as HeadTrainer,un as HybridMambaModel,ts as ImageRVQCodec,le as InMemoryExperienceStore,Js as InMemoryMlModels,Zs as IsolationForestModel,ei as KMeansModel,ti as KnnModel,ri as LIMBIC_AFFECT_TASK,xs as LIMBIC_AFFECT_WGSL,lo as LIMBIC_BLOCK_HEADER,no as LIMBIC_BOUNDS,Sr as LIMBIC_DIM,ne as LIMBIC_DIM_NAMES,Er as LIMBIC_STATE_DIM,Lo as LINEAR_BACKWARD_WGSL,xe as LINEAR_FORWARD_WGSL,Bn as LN2,ni as LOCAL_SUCCESS_FEATURES,ai as LOCAL_SUCCESS_TASK,ys as LimbicModel,vs as LimbicTrainer,oi as LinearModel,ve as LoRAAdapter,bn as LoadBalanceAccumulator,si as LogisticModel,ii as MAHALANOBIS_MIN_SAMPLES,lt as MAMBA1_PARAM_NAMES,vo as MAX_ADAPTATIONS,di as MAX_DELTA_B64_CHARS,yo as MAX_RUNS,ci as ML_TASK_ID_RE,li as MahalanobisDetector,Yr as Mamba1Block,Zr as Mamba2Block,rn as Mamba3Block,Yr as MambaBlock,Io as MambaModel,es as MambaTrainer,hi as MlDecisionLog,ui as MlEngineUnavailableError,fi as MlTaskRegistry,Wo as MoETrainer,Mn as MultimodalVocab,ut as NEUTRAL_STATE,mi as NaiveBayesModel,ge as PACKAGE_HEADER_BYTES,pi as QUALITY_OBSERVED_MIN_RUNS,hs as REGION,nt as RMSNORM_EPS,gi as RUN_ANOMALY_FLAG_RATIO,_i as RUN_ANOMALY_METRICS,bi as RUN_ANOMALY_MIN_SCALE,wi as RUN_ANOMALY_TASK,yi as RobustZModel,vi as RunAnomalyDetector,Ao as SELECTIVE_SCAN_BACKWARD_WGSL,yt as SELECTIVE_SCAN_FORWARD_WGSL,Eo as SOFTMAX_BACKWARD_WGSL,So as SOFTMAX_FORWARD_WGSL,nn as SOFTMAX_WGSL,Bo as SSD_BACKWARD_WGSL,Qr as SSD_FORWARD_WGSL,ae as SeededRng,ir as SharedExpertMoE,zo as Tensor,je as VIDEO_BANK_INTER,Ee as VIDEO_BANK_INTRA,Te as VideoRVQCodec,xi as WEIGHT_UPDATE_WGSL,oa as WSLA_MAX_DELTA,ze as adamwUpdateInPlace,On as adaptAndDiff,Yo as adaptPackage,Wn as adaptationsAfterSkip,ki as anomalyConfidence,Xt as appendCrcTrailer,Zt as applyCheckpointDiff,Ht as applyLimbicDelta,ds as applyPortedWeights,Pr as applyRowDelta,ps as appraiseAmygdala,ws as appraiseTask,Me as archOf,Ai as assignParams,Oo as backward,Qe as basalGangliaExploreBias,_s as basalGangliaSelect,at as base64ToBytes,Cn as benchArgmax,Vo as benchmarkAdaptationCost,Be as benchmarkModel,Ho as benchmarkModelAsync,Uo as benchmarkText,Nn as bitsPerToken,da as buildBatches,ia as buildChunks,Hr as buildDeltaLearnPayload,bs as buildLimbicBlock,Bs as buildMlHeadDelta,rs as buildVideoSequence,sr as bytesToBase64,Mi as candidateEngines,C as cdiv,Li as checkSchedulerFeatures,Si as choleskyInverse,Ie as clampDim,Xe as clampLimbicDim,Ei as clampRatio,us as clampState,wn as clearTape,Qa as codestralMambaAdapter,Go as compareModels,Tn as compareReports,co as compileLimbicState,Cr as computeRowDelta,Wa as configJson,mr as corpusToSequences,Di as cosine,sa as cpuDimsFor,ra as cpuModelBackward,ta as cpuModelForward,Zo as cpuModelLoss,ea as cpuWeightsFromNamed,Tr as crc32,I as createBindGroup,R as createComputePipeline,S as createEmptyStorageBuffer,Bi as createMlRegistry,Z as createStorageBuffer,z as createUniformBuffer,dr as crossEntropyGrad,me as crossEntropyLoss,Fi as curateExperience,Ci as curatePendingExperience,Pi as curationRecords,Ni as curationStands,Ur as decodeDeltaPayload,Gr as deltaTargetMismatch,qr as deltaUnusableReason,Ae as dequantizeFp16,cn as dequantizeInt8,No as dequantizeInt8PerChannel,Qt as deserializeRowDelta,Jt as diffCheckpoints,Y as dispatchColumnSlice,W as dispatchKernel,Ti as dot,As as dueSkills,wt as elementLabel,Ze as emptySnapshot,$o as enableGrad,Ii as engineKey,To as estimateMemory,vr as evermindTensorSpec,qa as executePortPlan,Wi as experienceCorpus,Kr as experienceDocuments,Ms as experienceOverview,zi as experienceQualityExamples,$i as experienceQualityInputs,ji as experienceQualityLabel,Ri as experienceRunMetrics,os as exportEvermind,jt as exportGguf,zt as exportOnnx,Tt as exportSafetensors,Oi as extractFeatureMatrix,Ki as extractFeatures,jr as falconMambaAdapter,Hi as fitAnomalyComposite,Gi as fitClassical,Ui as fitEwma,qi as fitGbm,Vi as fitIsolationForest,Xi as fitKMeans,Yi as fitKnn,Qi as fitLinear,Ji as fitLogistic,Zi as fitMahalanobis,ed as fitNaiveBayes,td as fitRobustZ,rd as fitRunAnomaly,nd as flattenParams,Pe as floatToFp16,to as foreignMambaAdapterFor,Xo as formatAdaptationCostReport,st as fp16ToFloat,Ko as fp16View,fe as gaussianArray,ns as generateImage,ca as generateVideo,za as generationConfigJson,nr as headCheckpoint,or as headParams,gs as homeostasis,ss as importEvermind,Ha as importEvermindTensors,Ka as inferArchFromTensors,ad as initWebGPU,bo as isDue,od as isIrreversibleLabel,sd as leaveOneOutMahalanobisThreshold,id as ledoitWolfCovariance,dd as limbicAffectPredictor,po as limbicHead,Br as limbicSetpoints,Se as linearBackward,be as linearForward,cd as localSuccessExamples,ld as localSuccessFeatures,hd as localSuccessLabel,Et as logProbOfToken,ud as logScale,fd as mahalanobisMinSamples,md as mamba1Adapter,Yn as mamba1CpuBackward,wr as mamba1CpuForward,$r as mambaAdapter,cs as mambaConfigFromTensors,Qo as meanEvalLoss,ms as meanLimbicSetpoints,Kn as mergeCheckpointDiffs,Hn as mergeCheckpointDiffsGated,Fs as mergeMlHeadDeltas,pd as minScaleAt,gd as mlEvalLoss,Ls as mlHeadEntry,Ss as mlHeadParams,ar as mlHeadTarget,Nr as mlHeadUnusableReason,ja as modelCardMarkdown,ht as namedTensors,Zn as namedWeights,Or as needsApproval,Ye as neutralLimbicState,ao as neutralState,go as newExperienceId,jo as noGrad,Lr as normaliseSourceName,_d as packDocuments,Es as packageMlHead,xr as paramCount,na as paramMatrixShape,bd as parseDeltaLearnPayload,Vt as parseSnapshot,Pn as perplexity,fs as personalitySetpoint,ro as portForeignMamba,is as portForeignMambaSafetensors,Vn as quantizeBase,ke as quantizeFp16,dn as quantizeInt8,Po as quantizeInt8PerChannel,wd as randn,we as readBuffer,Ro as recordOperation,oo as recordToState,ls as resizePortedVocab,tr as rmsNormBackward,rr as rmsNormForward,cr as roundFp16,yd as runAnomalyFeatures,vd as runMlTask,Mr as safetensorsToTensors,Yt as serializeRowDelta,pt as setInitSeed,er as sigmoid,bt as silu,_t as siluGrad,Ut as slug,gt as softmax,Ir as softplus,xd as solveLinearSystem,Dr as stateToRecord,ha as tensorsToSafetensors,io as thalamusGate,Jn as toNamedGrads,pr as tokenWindows,$a as tokenizerJson,Fn as topKIndices,qo as trainAndBenchmark,kd as trainMlTask,ks as trainOnce,he as uploadBuffer,et as verifyCrcTrailer,Ds as withPackageMlHead,Qn as zeroCpuModelGrads,Xn as zeroMamba1Grads};
