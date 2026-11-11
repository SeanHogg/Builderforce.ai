import{l as $,j as I,h as W,g as P,f as H,e as E,m as le,d as Q,s as gt,r as ie,q as Gt,n as Qr,v as Kt,u as ge,o as Ut,A as Zr,L as Jr,p as ye,B as Vt,E as Xt,w as tt,S as ve,x as Yt,y as Qt,z as en,C as tn,D as rn,F as Me,G as mt,H as xe,I as Zt,J as Jt,K as _e,M as pt,N as nn,R as rt,O as an,P as on,Q as Se,V as sn,T as er,U as tr,W as ln,X as dn,Y as _t,Z as cn,t as un,_ as hn,$ as fn,a0 as ce,a1 as We,a2 as gn,a3 as mn,a4 as pn,a5 as _n,a6 as bn,a7 as wn,a8 as De,a9 as rr,aa as nt,ab as yn,ac as nr,ad as vn,ae as xn,af as kn,ag as ar,ah as ir,ai as te,aj as An}from"./chunk-check_scheduler.js";import{ak as el,al as tl,am as rl,an as nl,ao as al,ap as il,aq as ol,ar as sl,as as ll,at as dl,au as cl,b as ul,c as hl,av as fl,aw as gl,ax as ml,ay as pl,az as _l,aA as bl,aB as wl,aC as yl,aD as vl,aE as xl,aF as kl,aG as Al,aH as Ml,aI as Ll,aJ as Sl,aK as Dl,aL as El,aM as Nl,aN as Cl,a as Fl,aO as Pl,aP as Tl,i as Bl,aQ as Il,aR as Wl,aS as jl,aT as $l,aU as Rl,aV as zl,aW as Ol,aX as Hl,aY as ql,aZ as Gl,a_ as Kl,k as Ul}from"./chunk-check_scheduler.js";const bt=`

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
`,qo=`

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
`,Go=`

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
`,ke=`

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
`,Ko=`

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
`,Uo=`
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
`,Vo=`
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
`,Xo=`

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
`,Pe="col_slice";function Y(r,e,t,a,n,i,o,l){const s=$(r,new Uint32Array([n,i,o,l]).buffer),h=I(r,e,[s,t,a]);W(r,e,h,[P(n*l,256),1,1]),s.destroy()}const Mn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
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
`;class Sn{layerType="mamba1";device;config;dInner;dtRank;wInProj;bInProj;wConv;bConv;wXProj;bXProj;wDtProj;bDtProj;A_log;D_vec;wOutProj;bOutProj;normWeight;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(t.dModel/16),...t};const{dModel:a,expand:n}=this.config;this.dInner=n*a,this.dtRank=t.dtRank??Math.ceil(a/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:a}=this.config,n=this.dInner,i=t,o=a,l=this.dtRank,s=(d,c=.02)=>le(d,c),h=d=>new Float32Array(d),u=d=>new Float32Array(d).fill(1);this.wInProj=s(2*n*e),this.bInProj=h(2*n),this.wConv=s(n*o,.01),this.bConv=h(n),this.wXProj=s((l+2*i)*n,.01),this.bXProj=h(l+2*i),this.wDtProj=s(n*l,.02),this.bDtProj=h(n),this.A_log=new Float32Array(n*i);for(let d=0;d<n;d++)for(let c=0;c<i;c++)this.A_log[d*i+c]=Math.log(c+1);this.D_vec=u(n),this.wOutProj=s(e*n,.02),this.bOutProj=h(e),this.normWeight=u(e),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const e=this.device,t=a=>Q(e,a,!0);this.gpuWeights={wInProj:t(this.wInProj),bInProj:t(this.bInProj),wConv:t(this.wConv),bConv:t(this.bConv),wXProj:t(this.wXProj),bXProj:t(this.bXProj),wDtProj:t(this.wDtProj),bDtProj:t(this.bDtProj),A_log:t(this.A_log),D_vec:t(this.D_vec),wOutProj:t(this.wOutProj),bOutProj:t(this.bOutProj),normWeight:t(this.normWeight)}}_buildPipelines(){const e=this.device;this.pipelines={linear:H(e,ke,"linear_forward"),conv1d:H(e,at,"conv1d_forward"),silu:H(e,me,"silu_forward"),rmsnorm:H(e,me,"rmsnorm_forward"),scan_fwd:H(e,bt,"forward_scan"),scan_reduce:H(e,bt,"forward_reduce"),colSlice:H(e,Fe,Pe),elMul:H(e,Mn,"main"),elAdd:H(e,Ln,"main")}}forward(e,t,a){const n=this.device,{dModel:i,dState:o,dConv:l}=this.config,s=this.dInner,h=o,u=t,d=a,c=u*d,f=this.dtRank,g={},m=E(n,c*i*4,!0),p=E(n,c*4,!0);g.normInv=p,g.normIn=e;{const y=new ArrayBuffer(16);new Uint32Array(y,0,2).set([c,i]),new Float32Array(y,8,1).set([1e-6]);const k=$(n,y),D=I(n,this.pipelines.rmsnorm,[k,e,this.gpuWeights.normWeight,m,p]);W(n,this.pipelines.rmsnorm,D,[P(c,64),1,1])}const _=E(n,c*2*s*4,!0);g.normOut=m;{const y=new Uint32Array([c,i,2*s]).buffer,k=$(n,y),D=I(n,this.pipelines.linear,[k,m,this.gpuWeights.wInProj,this.gpuWeights.bInProj,_]);W(n,this.pipelines.linear,D,[P(c,16),P(2*s,16),1])}const b=E(n,c*s*4,!0),w=E(n,c*s*4,!0);{const y=this.pipelines.colSlice;Y(n,y,_,b,c,2*s,0,s),Y(n,y,_,w,c,2*s,s,s)}_.destroy(),g.zBuf=w,g.xConvIn=b;const v=E(n,c*s*4,!0);g.convOut=v;{const y=new Uint32Array([d,s,l,u,1]).buffer,k=$(n,y),D=I(n,this.pipelines.conv1d,[k,b,this.gpuWeights.wConv,this.gpuWeights.bConv,v]);W(n,this.pipelines.conv1d,D,[P(d,16),P(s,16),u])}const L=E(n,c*s*4,!0);g.siluOut=L;{const y=new Uint32Array([c*s]).buffer,k=$(n,y),D=I(n,this.pipelines.silu,[k,v,L]);W(n,this.pipelines.silu,D,[P(c*s,256),1,1])}const S=E(n,c*(f+2*h)*4,!0);{const y=new Uint32Array([c,s,f+2*h]).buffer,k=$(n,y),D=I(n,this.pipelines.linear,[k,L,this.gpuWeights.wXProj,this.gpuWeights.bXProj,S]);W(n,this.pipelines.linear,D,[P(c,16),P(f+2*h,16),1])}const M=E(n,c*f*4,!0),x=E(n,u*d*h*4,!0),N=E(n,u*d*h*4,!0);{const y=f+2*h,k=this.pipelines.colSlice;Y(n,k,S,M,c,y,0,f),Y(n,k,S,x,c,y,f,h),Y(n,k,S,N,c,y,f+h,h)}S.destroy(),g.B_raw=x,g.C_raw=N;const C=E(n,c*s*4,!0);g.deltaFull=C;{const y=new Uint32Array([c,f,s]).buffer,k=$(n,y),D=I(n,this.pipelines.linear,[k,M,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,C]);W(n,this.pipelines.linear,D,[P(c,16),P(s,16),1])}M.destroy();const O=E(n,u*d*s*4,!0),R=E(n,2*u*d*s*h*4,!0);g.hCache=R;{const y=new Uint32Array([d,h,s,u]).buffer,k=$(n,y),D=I(n,this.pipelines.scan_fwd,[k,L,C,this.gpuWeights.A_log,x,N,this.gpuWeights.D_vec,O,R]);W(n,this.pipelines.scan_fwd,D,[s,h,u]);const z=I(n,this.pipelines.scan_reduce,[k,L,C,this.gpuWeights.A_log,x,N,this.gpuWeights.D_vec,O,R]);W(n,this.pipelines.scan_reduce,z,[P(d,64),s,u])}const G=E(n,c*s*4,!0),j=E(n,c*s*4,!0);{const y=$(n,new Uint32Array([c*s]).buffer),k=I(n,this.pipelines.silu,[y,w,G]);W(n,this.pipelines.silu,k,[P(c*s,256),1,1]);const D=$(n,new Uint32Array([c*s]).buffer),z=I(n,this.pipelines.elMul,[O,G,j,D]);W(n,this.pipelines.elMul,z,[P(c*s,256),1,1])}G.destroy(),O.destroy();const q=E(n,c*i*4,!0);{const y=new Uint32Array([c,s,i]).buffer,k=$(n,y),D=I(n,this.pipelines.linear,[k,j,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,q]);W(n,this.pipelines.linear,D,[P(c,16),P(i,16),1])}j.destroy();const A=E(n,c*i*4,!0);{const y=$(n,new Uint32Array([c*i]).buffer),k=I(n,this.pipelines.elAdd,[q,e,A,y]);W(n,this.pipelines.elAdd,k,[P(c*i,256),1,1])}return q.destroy(),{output:A,cache:g}}parameters(){const{dModel:e,dState:t,dConv:a}=this.config,n=this.dInner,i=t,o=a,l=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*n*e,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*n,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:n*o,name:"wConv"},{buf:this.gpuWeights.bConv,numel:n,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(l+2*i)*n,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:l+2*i,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:n*l,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:n,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:n*i,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:n,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*n,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:e,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const Dn=`
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
`,Yo=`
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
`;class Nn{layerType="mamba2";device;config;dInner;dHead;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...t};const{dModel:a,expand:n,nHeads:i}=this.config;if(this.dInner=n*a,this.dHead=this.dInner/i,this.dInner%i!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${i}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:a,nHeads:n,nGroups:i}=this.config,o=this.dInner,l=t,s=a,h=n,u=i,d=(p,_=.02)=>le(p,_),c=p=>new Float32Array(p),f=p=>new Float32Array(p).fill(1),g=o+2*u*l+h,m=p=>Q(this.device,p,!0);this.gpuWeights={wInProj:m(d(g*e)),wConv:m(d((o+2*u*l)*s,.01)),bConv:m(c(o+2*u*l)),A_log:m(new Float32Array(h).fill(Math.log(1))),dt_bias:m(c(h)),D_vec:m(f(h)),wOutProj:m(d(e*o,.02)),normWeight:m(f(o)),preNormWeight:m(f(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:H(e,ke,"linear_forward"),conv1d:H(e,at,"conv1d_forward"),colSlice:H(e,Fe,Pe),rmsnorm:H(e,me,"rmsnorm_forward"),ssd_fwd:H(e,Dn,"ssd_chunk_forward"),elAdd:H(e,En,"main")}}forward(e,t,a){const n=this.device,{dModel:i,dState:o,dConv:l,nHeads:s,nGroups:h,chunkLen:u}=this.config,d=this.dInner,c=o,f=l,g=s,m=h,p=this.dHead,_=t,b=a,w=_*b,v=d+2*m*c,L=Math.ceil(b/u),S=E(n,w*i*4,!0),M=E(n,w*4,!0);{const T=new ArrayBuffer(16);new Uint32Array(T,0,2).set([w,i]),new Float32Array(T,8,1).set([1e-6]);const F=$(n,T),K=I(n,this.pipelines.rmsnorm,[F,e,this.gpuWeights.preNormWeight,S,M]);W(n,this.pipelines.rmsnorm,K,[P(w,64),1,1])}M.destroy();const x=d+2*m*c+g,N=E(n,w*x*4,!0);{const T=new Uint32Array([w,i,x]).buffer,F=$(n,T),K=Q(n,new Float32Array(x),!0),Z=I(n,this.pipelines.linear,[F,S,this.gpuWeights.wInProj,K,N]);W(n,this.pipelines.linear,Z,[P(w,16),P(x,16),1]),K.destroy()}S.destroy();const C=E(n,w*v*4,!0),O=E(n,w*g*4,!0);{const T=this.pipelines.colSlice,F=v+g;Y(n,T,N,C,w,F,0,v),Y(n,T,N,O,w,F,v,g)}N.destroy();const R=E(n,w*v*4,!0);{const T=new Uint32Array([b,v,f,_,1]).buffer,F=$(n,T),K=I(n,this.pipelines.conv1d,[F,C,this.gpuWeights.wConv,this.gpuWeights.bConv,R]);W(n,this.pipelines.conv1d,K,[P(b,16),P(v,16),_])}C.destroy();const G=E(n,w*d*4,!0),j=E(n,w*m*c*4,!0),q=E(n,w*m*c*4,!0);{const T=this.pipelines.colSlice;Y(n,T,R,G,w,v,0,d),Y(n,T,R,j,w,v,d,m*c),Y(n,T,R,q,w,v,d+m*c,m*c)}R.destroy();const A=E(n,(L+1)*_*g*c*p*4,!0),y=E(n,w*d*4,!0);{const T=new Uint32Array([b,d,g,p,m,c,u,L,_]).buffer,F=$(n,T),K=I(n,this.pipelines.ssd_fwd,[F,G,j,q,O,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,y,A]);W(n,this.pipelines.ssd_fwd,K,[L,g,_])}G.destroy(),j.destroy(),q.destroy(),O.destroy();const k=E(n,w*d*4,!0),D=E(n,w*4,!0);{const T=new ArrayBuffer(16);new Uint32Array(T,0,2).set([w,d]),new Float32Array(T,8,1).set([1e-6]);const F=$(n,T),K=I(n,this.pipelines.rmsnorm,[F,y,this.gpuWeights.normWeight,k,D]);W(n,this.pipelines.rmsnorm,K,[P(w,64),1,1])}y.destroy(),D.destroy();const z=E(n,w*i*4,!0);{const T=new Uint32Array([w,d,i]).buffer,F=$(n,T),K=Q(n,new Float32Array(i),!0),Z=I(n,this.pipelines.linear,[F,k,this.gpuWeights.wOutProj,K,z]);W(n,this.pipelines.linear,Z,[P(w,16),P(i,16),1]),K.destroy()}k.destroy();const U=E(n,w*i*4,!0);{const T=$(n,new Uint32Array([w*i]).buffer),F=I(n,this.pipelines.elAdd,[z,e,U,T]);W(n,this.pipelines.elAdd,F,[P(w*i,256),1,1])}return z.destroy(),{output:U,cache:{stateCarry:A}}}parameters(){const{dModel:e,dState:t,dConv:a,nHeads:n,nGroups:i}=this.config,o=this.dInner,l=t,s=a,h=n,u=i,d=o+2*u*l;return[{buf:this.gpuWeights.wInProj,numel:(o+2*u*l+h)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:d*s,name:"wConv"},{buf:this.gpuWeights.bConv,numel:d,name:"bConv"},{buf:this.gpuWeights.A_log,numel:h,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:h,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:h,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*o,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:o,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const Cn=`
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
`,Qo=`
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
`,Fn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class Pn{layerType="mamba3";device;config;dInner;dHead;nComplex;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...t};const{dModel:a,expand:n,nHeads:i}=this.config;if(this.dInner=n*a,this.dHead=this.dInner/i,this.nComplex=this.config.dState,this.dInner%i!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${i}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dConv:t,nHeads:a,nGroups:n}=this.config,i=this.dInner,o=this.nComplex,l=t,s=a,h=n,u=i+2*h*o*2,d=(_,b=.02)=>le(_,b),c=_=>new Float32Array(_),f=_=>new Float32Array(_).fill(1),g=new Float32Array(s*2);for(let _=0;_<s;_++)g[_*2+0]=0,g[_*2+1]=2*Math.PI*_/s;const m=_=>Q(this.device,_,!0),p=i+2*h*o*2+s;this.gpuWeights={wInProj:m(d(p*e)),wConv:m(d(u*l,.01)),bConv:m(c(u)),A_log:m(g),dt_bias:m(c(s)),D_vec:m(f(s)),wOutProj:m(d(e*i,.02)),normWeight:m(f(i)),preNormWeight:m(f(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:H(e,ke,"linear_forward"),conv1d:H(e,at,"conv1d_forward"),colSlice:H(e,Fe,Pe),rmsnorm:H(e,me,"rmsnorm_forward"),cssd_fwd:H(e,Cn,"complex_ssd_forward"),elAdd:H(e,Fn,"main")}}forward(e,t,a){const n=this.device,{dModel:i,dConv:o,nHeads:l,nGroups:s,chunkLen:h}=this.config,u=this.dInner,d=this.nComplex,c=o,f=l,g=s,m=this.dHead,p=t,_=a,b=p*_,w=u+2*g*d*2,v=Math.ceil(_/h),L=E(n,b*i*4,!0),S=E(n,b*4,!0);{const B=new ArrayBuffer(16);new Uint32Array(B,0,2).set([b,i]),new Float32Array(B,8,1).set([1e-6]);const T=$(n,B),F=I(n,this.pipelines.rmsnorm,[T,e,this.gpuWeights.preNormWeight,L,S]);W(n,this.pipelines.rmsnorm,F,[P(b,64),1,1])}S.destroy();const M=u+2*g*d*2+f,x=E(n,b*M*4,!0);{const B=new Uint32Array([b,i,M]).buffer,T=$(n,B),F=Q(n,new Float32Array(M),!0),K=I(n,this.pipelines.linear,[T,L,this.gpuWeights.wInProj,F,x]);W(n,this.pipelines.linear,K,[P(b,16),P(M,16),1]),F.destroy()}L.destroy();const N=E(n,b*w*4,!0),C=E(n,b*f*4,!0);{const B=this.pipelines.colSlice,T=w+f;Y(n,B,x,N,b,T,0,w),Y(n,B,x,C,b,T,w,f)}x.destroy();const O=E(n,b*w*4,!0);{const B=new Uint32Array([_,w,c,p,1]).buffer,T=$(n,B),F=I(n,this.pipelines.conv1d,[T,N,this.gpuWeights.wConv,this.gpuWeights.bConv,O]);W(n,this.pipelines.conv1d,F,[P(_,16),P(w,16),p])}N.destroy();const R=E(n,b*u*4,!0),G=E(n,b*g*d*2*4,!0),j=E(n,b*g*d*2*4,!0);{const B=this.pipelines.colSlice;Y(n,B,O,R,b,w,0,u),Y(n,B,O,G,b,w,u,g*d*2),Y(n,B,O,j,b,w,u+g*d*2,g*d*2)}O.destroy();const q=E(n,(v+1)*p*f*d*2*m*4,!0),A=E(n,b*u*4,!0);{const B=new Uint32Array([_,u,f,m,g,d,h,v,p]).buffer,T=$(n,B),F=I(n,this.pipelines.cssd_fwd,[T,R,G,j,C,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,A,q]);W(n,this.pipelines.cssd_fwd,F,[v,f,p])}R.destroy(),G.destroy(),j.destroy(),C.destroy();const y=E(n,b*u*4,!0),k=E(n,b*4,!0);{const B=new ArrayBuffer(16);new Uint32Array(B,0,2).set([b,u]),new Float32Array(B,8,1).set([1e-6]);const T=$(n,B),F=I(n,this.pipelines.rmsnorm,[T,A,this.gpuWeights.normWeight,y,k]);W(n,this.pipelines.rmsnorm,F,[P(b,64),1,1])}A.destroy(),k.destroy();const D=E(n,b*i*4,!0);{const B=new Uint32Array([b,u,i]).buffer,T=$(n,B),F=Q(n,new Float32Array(i),!0),K=I(n,this.pipelines.linear,[T,y,this.gpuWeights.wOutProj,F,D]);W(n,this.pipelines.linear,K,[P(b,16),P(i,16),1]),F.destroy()}y.destroy();const z=E(n,b*i*4,!0);{const B=$(n,new Uint32Array([b*i]).buffer),T=I(n,this.pipelines.elAdd,[D,e,z,B]);W(n,this.pipelines.elAdd,T,[P(b*i,256),1,1])}return D.destroy(),{output:z,cache:{stateCarry:q}}}parameters(){const{dModel:e,dConv:t,nHeads:a,nGroups:n}=this.config,i=this.dInner,o=this.nComplex,l=t,s=a,h=n,u=i+2*h*o*2;return[{buf:this.gpuWeights.wInProj,numel:(i+2*h*o*2+s)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:u*l,name:"wConv"},{buf:this.gpuWeights.bConv,numel:u,name:"bConv"},{buf:this.gpuWeights.A_log,numel:s*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:s,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:s,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*i,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:i,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const Tn=`
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
`,Zo=`
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
`,Bn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,In=`
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
`;class Wn{layerType="attention";device;config;dHead;gpuWeights;pipelines;constructor(e,t){if(this.device=e,t.dModel%t.nHeads!==0)throw new Error(`AttentionBlock: dModel (${t.dModel}) must be divisible by nHeads (${t.nHeads}).`);this.config={dHead:t.dModel/t.nHeads,hasFfn:!1,ffnMult:4,...t},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,hasFfn:t,ffnMult:a}=this.config,n=(s,h=.02)=>le(s,h),i=s=>new Float32Array(s),o=s=>new Float32Array(s).fill(1),l=s=>Q(this.device,s,!0);if(this.gpuWeights={wQKV:l(n(3*e*e)),bQKV:l(i(3*e)),wO:l(n(e*e)),bO:l(i(e)),normWeight:l(o(e))},t){const s=e*a;this.gpuWeights.wFfn1=l(n(s*e)),this.gpuWeights.bFfn1=l(i(s)),this.gpuWeights.wFfn2=l(n(e*s)),this.gpuWeights.bFfn2=l(i(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:H(e,ke,"linear_forward"),rmsnorm:H(e,me,"rmsnorm_forward"),attn_fwd:H(e,wt,"attention_forward"),attn_val:H(e,wt,"attention_value"),softmax:H(e,Tn,"softmax_forward"),colSlice:H(e,Fe,Pe),elAdd:H(e,Bn,"main")},this.config.hasFfn&&(this.pipelines.silu=H(e,In,"silu_forward"))}forward(e,t,a){const n=this.device,{dModel:i,nHeads:o,hasFfn:l}=this.config,s=this.dHead,h=t,u=a,d=h*u,c=o,f=E(n,d*i*4,!0),g=E(n,d*4,!0);{const x=new ArrayBuffer(16);new Uint32Array(x,0,2).set([d,i]),new Float32Array(x,8,1).set([1e-6]);const N=$(n,x),C=I(n,this.pipelines.rmsnorm,[N,e,this.gpuWeights.normWeight,f,g]);W(n,this.pipelines.rmsnorm,C,[P(d,64),1,1])}g.destroy();const m=E(n,d*3*i*4,!0);{const x=new Uint32Array([d,i,3*i]).buffer,N=$(n,x),C=I(n,this.pipelines.linear,[N,f,this.gpuWeights.wQKV,this.gpuWeights.bQKV,m]);W(n,this.pipelines.linear,C,[P(d,16),P(3*i,16),1])}f.destroy();const p=E(n,d*i*4,!0),_=E(n,d*i*4,!0),b=E(n,d*i*4,!0);{const x=this.pipelines.colSlice;Y(n,x,m,p,d,3*i,0,i),Y(n,x,m,_,d,3*i,i,i),Y(n,x,m,b,d,3*i,2*i,i)}m.destroy();const w=E(n,h*c*u*u*4,!0);{const x=new Uint32Array([h,u,i,c,s]).buffer,N=$(n,x),C=I(n,this.pipelines.attn_fwd,[N,p,_,b,w,E(n,d*i*4,!0)]);W(n,this.pipelines.attn_fwd,C,[P(u,16),c,h])}{const x=new Uint32Array([u,u,1]).buffer,N=$(n,x),C=I(n,this.pipelines.softmax,[N,w]);W(n,this.pipelines.softmax,C,[u,c,h])}const v=E(n,d*i*4,!0);{const x=new Uint32Array([h,u,i,c,s]).buffer,N=$(n,x),C=I(n,this.pipelines.attn_val,[N,p,_,b,w,v]);W(n,this.pipelines.attn_val,C,[P(u,16),c,h])}p.destroy(),_.destroy(),b.destroy();const L=E(n,d*i*4,!0);{const x=new Uint32Array([d,i,i]).buffer,N=$(n,x),C=I(n,this.pipelines.linear,[N,v,this.gpuWeights.wO,this.gpuWeights.bO,L]);W(n,this.pipelines.linear,C,[P(d,16),P(i,16),1])}v.destroy();let S=E(n,d*i*4,!0);{const x=$(n,new Uint32Array([d*i]).buffer),N=I(n,this.pipelines.elAdd,[L,e,S,x]);W(n,this.pipelines.elAdd,N,[P(d*i,256),1,1])}if(L.destroy(),l){const{ffnMult:x}=this.config,N=i*x,C=E(n,d*N*4,!0);{const j=new Uint32Array([d,i,N]).buffer,q=$(n,j),A=I(n,this.pipelines.linear,[q,S,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,C]);W(n,this.pipelines.linear,A,[P(d,16),P(N,16),1])}const O=E(n,d*N*4,!0);{const j=$(n,new Uint32Array([d*N]).buffer),q=I(n,this.pipelines.silu,[j,C,O]);W(n,this.pipelines.silu,q,[P(d*N,256),1,1])}C.destroy();const R=E(n,d*i*4,!0);{const j=new Uint32Array([d,N,i]).buffer,q=$(n,j),A=I(n,this.pipelines.linear,[q,O,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,R]);W(n,this.pipelines.linear,A,[P(d,16),P(i,16),1])}O.destroy();const G=E(n,d*i*4,!0);{const j=$(n,new Uint32Array([d*i]).buffer),q=I(n,this.pipelines.elAdd,[R,S,G,j]);W(n,this.pipelines.elAdd,q,[P(d*i,256),1,1])}R.destroy(),S.destroy(),S=G}return{output:S,cache:{scores:w}}}parameters(){const{dModel:e,hasFfn:t,ffnMult:a}=this.config,n=[{buf:this.gpuWeights.wQKV,numel:3*e*e,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*e,name:"bQKV"},{buf:this.gpuWeights.wO,numel:e*e,name:"wO"},{buf:this.gpuWeights.bO,numel:e,name:"bO"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}];if(t){const i=e*a;n.push({buf:this.gpuWeights.wFfn1,numel:i*e,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:i,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:e*i,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:e,name:"bFfn2"})}return n}getTrainableParams(){return this.parameters()}setWSLAMode(e){}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const yt=1296190035,jn={mamba1:0,mamba2:1,mamba3:2,attention:3},$n=["mamba1","mamba2","mamba3","attention"];class Rn{device;config;gpuEmbedding;layers;layerSpecs;gpuFinalNorm;tiedEmbedding;gpuLMHeadBias;_lmHeadPipeline;_rmsnormPipeline;_embedPipeline;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...t},gt(this.config.seed);const a=t.layers??Array.from({length:t.numLayers},()=>({type:"mamba1"}));if(a.length!==t.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${a.length}) must equal numLayers (${t.numLayers}).`);this.layerSpecs=a;const{vocabSize:n,dModel:i}=this.config,o=le(n*i,1/Math.sqrt(i));this.gpuEmbedding=Q(e,o,!0),this.layers=a.map(l=>this._buildLayer(l)),gt(void 0),this.gpuFinalNorm=Q(e,new Float32Array(i).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=Q(e,new Float32Array(n),!0),this._lmHeadPipeline=H(e,ke,"linear_forward"),this._rmsnormPipeline=H(e,me,"rmsnorm_forward"),this._embedPipeline=H(e,zn,"embed_lookup")}_buildLayer(e){const t=this.config;switch(e.type){case"mamba1":{const a={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,...t.defaultMamba1};return new Sn(this.device,{...a,...e.config??{}})}case"mamba2":{const a={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,...t.defaultMamba2};return new Nn(this.device,{...a,...e.config??{}})}case"mamba3":{const a={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,mimoGroup:t.mimoGroup,...t.defaultMamba3};return new Pn(this.device,{...a,...e.config??{}})}case"attention":{const a={dModel:t.dModel,nHeads:t.nHeads,...t.defaultAttention};return new Wn(this.device,{...a,...e.config??{}})}}}embedTokens(e,t,a){const{dModel:n}=this.config,i=t*a,o=Q(this.device,e instanceof Uint32Array?e:new Uint32Array(e),!1),l=E(this.device,i*n*4,!0),s=$(this.device,new Uint32Array([i,n]).buffer),h=I(this.device,this._embedPipeline,[s,o,this.gpuEmbedding,l]);return W(this.device,this._embedPipeline,h,[P(i,64),1,1]),o.destroy(),s.destroy(),l}async forward(e,t,a){const{dModel:n,vocabSize:i}=this.config,o=t*a;let l=this.embedTokens(e,t,a);const s=[];for(const f of this.layers){const{output:g,cache:m}=f.forward(l,t,a);s.push(m),l.destroy(),l=g}const h=E(this.device,o*n*4,!0),u=E(this.device,o*4,!1);{const f=new ArrayBuffer(16);new Uint32Array(f,0,2).set([o,n]),new Float32Array(f,8,1).set([1e-6]);const g=$(this.device,f),m=I(this.device,this._rmsnormPipeline,[g,l,this.gpuFinalNorm,h,u]);W(this.device,this._rmsnormPipeline,m,[P(o,64),1,1])}l.destroy();const d=E(this.device,o*i*4,!0);{const f=new Uint32Array([o,n,i]).buffer,g=$(this.device,f),m=I(this.device,this._lmHeadPipeline,[g,h,this.gpuEmbedding,this.gpuLMHeadBias,d]);W(this.device,this._lmHeadPipeline,m,[P(o,16),P(i,16),1])}return h.destroy(),u.destroy(),{logits:await ie(this.device,d,o*i*4),gpuLogits:d,caches:s}}async embed(e){const{dModel:t}=this.config,a=e.length,n=1,i=n*a;if(i===0)return new Float32Array(t);let o=this.embedTokens(e,n,a);for(const c of this.layers){const{output:f}=c.forward(o,n,a);o.destroy(),o=f}const l=E(this.device,i*t*4,!0),s=E(this.device,i*4,!1);{const c=new ArrayBuffer(16);new Uint32Array(c,0,2).set([i,t]),new Float32Array(c,8,1).set([1e-6]);const f=$(this.device,c),g=I(this.device,this._rmsnormPipeline,[f,o,this.gpuFinalNorm,l,s]);W(this.device,this._rmsnormPipeline,g,[P(i,64),1,1])}o.destroy();const h=await ie(this.device,l,i*t*4);l.destroy(),s.destroy();const u=new Float32Array(t);for(let c=0;c<a;c++){const f=c*t;for(let g=0;g<t;g++)u[g]+=h[f+g]}for(let c=0;c<t;c++)u[c]/=a;let d=0;for(let c=0;c<t;c++)d+=u[c]*u[c];d=Math.sqrt(d)||1;for(let c=0;c<t;c++)u[c]/=d;return u}async generate(e,t=200,a={}){const{temperature:n=1,topK:i=50,topP:o=.9}=a,{vocabSize:l}=this.config,s=[...e];for(let h=0;h<t;h++){const{logits:u}=await this.forward(new Uint32Array(s),1,s.length),d=u.slice((s.length-1)*l,s.length*l),c=On(d,{temperature:n,topK:i,topP:o});if(s.push(c),c===this.config.eosId)break}return s}parameters(){const e=[];e.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let t=0;t<this.layers.length;t++)for(const a of this.layers[t].parameters())e.push({...a,name:`layer${t}.${a.name}`});return e.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),e}getTrainableParams(){if(!this._wslaMode)return this.parameters();const e=[];for(let t=0;t<this.layers.length;t++)for(const a of this.layers[t].getTrainableParams())e.push({...a,name:`layer${t}.${a.name}`});return e}setWSLAMode(e){for(const t of this.layers)t.setWSLAMode(e);this._wslaMode=e}async exportWeights(e={}){const t=e.fp16??!1,a=this.parameters(),n=a.length,i=this.layers.length,o=await Promise.all(a.map(m=>ie(this.device,m.buf,m.numel*4))),l=Math.ceil(i/4)*4,s=12+l+4+n*4,h=t?2:4,d=o.reduce((m,p)=>m+p.length,0)*h,c=new ArrayBuffer(s+d),f=new DataView(c);let g=0;f.setUint32(g,yt,!0),g+=4,f.setUint32(g,t?3:2,!0),g+=4,f.setUint32(g,i,!0),g+=4;for(let m=0;m<i;m++){const p=this.layers[m].layerType;f.setUint8(g+m,jn[p])}g+=l,f.setUint32(g,n,!0),g+=4;for(const m of a)f.setUint32(g,m.numel,!0),g+=4;if(t)for(const m of o){const p=Gt(m);new Uint16Array(c,g,p.length).set(p),g+=p.length*2}else for(const m of o)new Float32Array(c,g,m.length).set(m),g+=m.byteLength;return Qr(c)}async loadWeights(e){const t=Kt(e);if(t.hasTrailer&&!t.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const a=new DataView(e);let n=0;const i=a.getUint32(n,!0);if(n+=4,i!==yt)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const o=a.getUint32(n,!0);if(n+=4,o===1){const l=a.getUint32(n,!0);n+=4;const s=this.parameters();if(l!==s.length)throw new Error(`Weight file has ${l} parameters but this model has ${s.length}.`);const h=[];for(let u=0;u<l;u++)h.push(a.getUint32(n,!0)),n+=4;for(let u=0;u<l;u++){const d=s[u],c=h[u];if(c!==d.numel)throw new Error(`Parameter ${u} ("${d.name}") size mismatch: file=${c}, model=${d.numel}.`);ge(this.device,d.buf,new Float32Array(e,n,d.numel)),n+=d.numel*4}return}if(o===2||o===3){const l=o===3,s=a.getUint32(n,!0);if(n+=4,s!==this.layers.length)throw new Error(`Weight file has ${s} layers but this model has ${this.layers.length}.`);for(let f=0;f<s;f++){const g=a.getUint8(n+f),m=this.layers[f].layerType,p=$n[g]??"mamba1";if(p!==m)throw new Error(`Layer ${f} type mismatch: file="${p}", model="${m}".`)}const h=Math.ceil(s/4)*4;n+=h;const u=a.getUint32(n,!0);n+=4;const d=this.parameters();if(u!==d.length)throw new Error(`Weight file has ${u} parameters but this model has ${d.length}.`);const c=[];for(let f=0;f<u;f++)c.push(a.getUint32(n,!0)),n+=4;for(let f=0;f<u;f++){const g=d[f],m=c[f];if(m!==g.numel)throw new Error(`Parameter ${f} ("${g.name}") size mismatch: file=${m}, model=${g.numel}.`);if(l){const p=new Uint16Array(e,n,m);ge(this.device,g.buf,Ut(p)),n+=m*2}else ge(this.device,g.buf,new Float32Array(e,n,g.numel)),n+=m*4}return}throw new Error(`Unsupported MBJS version: ${o}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const e of this.layers)e.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class Jo extends Rn{constructor(e,t){super(e,{...t,layers:Array.from({length:t.numLayers},()=>({type:"mamba1"}))})}}const zn=`
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
`;function On(r,{temperature:e=1,topK:t=50,topP:a=.9}={}){const n=r.length,i=new Float32Array(n);for(let p=0;p<n;p++)i[p]=r[p]/Math.max(e,1e-7);let o=-1/0;for(let p=0;p<n;p++)i[p]>o&&(o=i[p]);let l=0;const s=new Float32Array(n);for(let p=0;p<n;p++)s[p]=Math.exp(i[p]-o),l+=s[p];const u=Array.from({length:n},(p,_)=>_).sort((p,_)=>s[_]-s[p]).slice(0,t);let d=0;const c=[];for(const p of u)if(d+=s[p]/l,c.push(p),d>=a)break;let f=0;for(const p of c)f+=s[p];const g=Math.random()*f;let m=0;for(const p of c)if(m+=s[p],m>=g)return p;return c[c.length-1]}class es{model;adam;opt;constructor(e,t={}){this.model=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0,auxWeight:t.auxWeight??.01,batchSize:t.batchSize??0,epochs:t.epochs??1},this.adam=new Zr(e,this.opt)}fit(e){const t=[];for(let a=0;a<this.opt.epochs;a++)t.push(this.runEpoch(e));return t}runEpoch(e){const t=this.opt.batchSize>0?this.opt.batchSize:e.length,{numExperts:a,modelDim:n}=this.model.config;let i=0,o=0;for(let l=0;l<e.length;l+=t){const s=e.slice(l,l+t);this.model.zeroGrad();const h=[],u=[],d=new Jr(a);let c=0;for(const m of s){const p=this.model.forward(m.input),_=new Float32Array(n);for(let b=0;b<n;b++){const w=p.output[b]-(m.target[b]??0);_[b]=w,c+=.5*w*w}this.model.backward(_,p.cache),h.push(p.cache.x),u.push(p.route.probs),d.observe(p.route)}const f=d.dispatchFractions(),g=this.opt.auxWeight*a/s.length;for(let m=0;m<h.length;m++)this.model.auxGradStep(h[m],u[m],f,g);this.scaleGradients(1/s.length),this.adam.step(),i+=c,o=d.loss()}return{loss:i/Math.max(1,e.length),auxLoss:o}}scaleGradients(e){if(e!==1)for(const t of this.model.gradients())for(let a=0;a<t.data.length;a++)t.data[a]=t.data[a]*e}}const Hn=Math.LN2;function qn(r,e){const t=r.length,a=Math.max(1,Math.min(e,t)),n=[],i=new Uint8Array(t);for(let o=0;o<a;o++){let l=-1,s=-1/0;for(let h=0;h<t;h++){if(i[h])continue;const u=r[h];u>s&&(s=u,l=h)}if(l<0)break;i[l]=1,n.push(l)}return n}function Gn(r){let e=0,t=-1/0;for(let a=0;a<r.length;a++)r[a]>t&&(t=r[a],e=a);return e}function Kn(r){return Math.exp(r)}function Un(r){return r/Hn}function or(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function sr(r,e,t,a){const n=Math.min(e.length,t.length);for(let i=0;i<n;i++){const o=t[i],l=e[i];o<0||o>=l.length||(r.ceSum+=ye(l,o),Gn(l)===o&&r.top1Hits++,qn(l,a).includes(o)&&r.topKHits++,r.tokens++)}}function it(){const r=globalThis;return typeof r.performance?.now=="function"?r.performance.now():Date.now()}function lr(r){return r.slice(1)}function dr(r,e,t,a){const n=r.tokens>0?r.ceSum/r.tokens:0,i={sequences:e,tokens:r.tokens,crossEntropy:n,perplexity:Kn(n),bitsPerToken:Un(n),top1Accuracy:r.tokens>0?r.top1Hits/r.tokens:0,topKAccuracy:r.tokens>0?r.topKHits/r.tokens:0,topK:t};return a!==void 0&&(i.elapsedMs=a,i.tokensPerSecond=a>0?r.tokens/a*1e3:0),i}function Ee(r,e,t={}){const a=t.topK??5,n=t.measureLatency??!0,i=t.now??it,o=or();let l=0,s=0;for(const h of e){if(h.length<2)continue;const u=n?i():0,{logits:d}=r.forward(h);n&&(s+=i()-u),sr(o,d,lr(h),a),l++}return dr(o,l,a,n?s:void 0)}async function ts(r,e,t={}){const a=t.topK??5,n=t.measureLatency??!0,i=t.now??it,o=or();let l=0,s=0;for(const h of e){if(h.length<2)continue;const u=n?i():0,{logits:d}=await r.forward(h);n&&(s+=i()-u),sr(o,d,lr(h),a),l++}return dr(o,l,a,n?s:void 0)}function rs(r,e,t,a={}){return Vn(Ee(r,t,a),Ee(e,t,a))}function Vn(r,e){const t=r.perplexity-e.perplexity,a=e.perplexity>0?r.perplexity/e.perplexity:1/0,n=r.top1Accuracy-e.top1Accuracy,i=.005;let o;Math.abs(a-1)<=i?o="tie":o=t<0?"candidate":"baseline";const l=((1-a)*100).toFixed(1),s=o==="tie"?`Tie: perplexity ${r.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)}`:o==="candidate"?`Candidate wins: ${l}% lower perplexity (${r.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(l)).toFixed(1)}% higher perplexity (${r.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`;return{candidate:r,baseline:e,perplexityDelta:t,perplexityRatio:a,top1Delta:n,winner:o,summary:s}}function cr(r,e){return r.split(/(?<=\.)\s+/).map(t=>e.encode(t.trim())).filter(t=>t.length>=2)}function ns(r,e,t,a={}){return Ee(r,cr(t,e),a)}function Xn(r,e){for(let t=r.length-1;t>0;t--){const a=Math.floor(e.next()*(t+1)),n=r[t];r[t]=r[a],r[a]=n}return r}function as(r,e={}){const t=e.seed??7,a=new Vt;a.train(r,{numMerges:e.numMerges??100});const n=cr(r,a);if(n.length<2)throw new Error(`corpus produced ${n.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const i=Xn([...n],new ve(t>>>0||1)),o=Math.min(.9,Math.max(.05,e.heldOutRatio??.25));let l=Math.round(i.length*o);l=Math.max(1,Math.min(i.length-1,l));const s=i.slice(0,l),h=i.slice(l),u=new Xt({vocabSize:a.vocabSize,dModel:e.dModel??32,numLayers:e.numLayers??2,hiddenDim:e.hiddenDim??48,seed:t}),d=e.epochs??30,c=new tt(u,{lr:e.lr??.03,epochs:d}).fit(h),f=Ee(u,s,{topK:e.topK??5,measureLatency:!0}),g=u.generateText(e.prompt??"The",a,{maxNewTokens:8,temperature:0});return{...f,trainSequences:h.length,evalSequences:s.length,initialTrainLoss:c[0]??0,finalTrainLoss:c.at(-1)??0,vocabSize:a.vocabSize,sample:g}}function ur(r,e){const t=[],a=Math.max(1,Math.floor(e));for(let n=0;n+1<r.length;n+=a){const i=r.slice(n,n+a);i.length>=2&&t.push(i)}return t}function Yn(r,e){const t=Math.min(1,Math.max(0,e));return Math.round(r*(1-t))}const Qn=["The planning loop retrieves context before generating a response.","Agents recall facts from the memory layer and act on them.","Deployment runs on Cloudflare Workers and Durable Objects.","Tools are gated by a capability registry and a policy pack.","The coordinator merges weight deltas from every contributing host.","A ticket moves through triage, execution, review and merge.","Recall is ranked by embedding cosine fused with lexical scoring.","The trainer adapts a private copy of the base checkpoint locally."].join(" ");function Zn(r){let e=0;for(const t of r.parameters())e+=t.data.length;return e}function is(r={}){const e=r.text??Qn,t=r.windowTokens??[32,64,128],a=r.epochs??[1,2,4],n=r.skipRates??[0,.5],i=Math.max(1,r.requests??4),o=r.dModel??32,l=r.numLayers??2,s=r.hiddenDim??48,h=r.seed??7,u=r.lr??.01,d=r.now??it,c=new Vt;c.train(e,{numMerges:r.numMerges??120});const f=c.encode(e),g=()=>new Xt({vocabSize:c.vocabSize,dModel:o,numLayers:l,hiddenDim:s,seed:h}),m=[];for(const p of t){const _=ur(f,p);for(const b of a)for(const w of n){const v=Yn(i,w),L=g();L.resetStats();const S=d();for(let C=0;C<v;C++)new tt(L,{lr:u,epochs:b,accumSteps:1}).fit(_);const M=d()-S,x=L.positionsEvaluated,N=_.length*v;m.push({windowTokens:p,epochs:b,skipRate:w,requests:i,adapted:v,sequences:N,optimizerSteps:N*b,positionsEvaluated:x,elapsedMs:M,msPerKPosition:x>0?M/x*1e3:0,msPerAdaptation:v>0?M/v:0})}}return{points:m,textTokens:f.length,vocabSize:c.vocabSize,dModel:o,numLayers:l,hiddenDim:s,paramCount:Zn(g())}}function os(r){const e=`Evermind adaptation cost — dModel=${r.dModel} layers=${r.numLayers} hidden=${r.hiddenDim} params=${r.paramCount.toLocaleString()} vocab=${r.vocabSize} textTokens=${r.textTokens}`,t=["window","epochs","skip","adapts","seqs","steps","positions","ms","ms/adapt","ms/1k pos"],a=r.points.map(o=>[String(o.windowTokens),String(o.epochs),o.skipRate.toFixed(2),`${o.adapted}/${o.requests}`,String(o.sequences),String(o.optimizerSteps),String(o.positionsEvaluated),o.elapsedMs.toFixed(1),o.msPerAdaptation.toFixed(1),o.msPerKPosition.toFixed(3)]),n=t.map((o,l)=>Math.max(o.length,...a.map(s=>s[l].length))),i=o=>o.map((l,s)=>l.padStart(n[s])).join("  ");return[e,"",i(t),i(n.map(o=>"-".repeat(o))),...a.map(i)].join(`
`)}const Jn=4e3,ea=64;function ta(r,e,t,a={}){const n=a.maxChars??Jn,i=a.windowTokens??ea,o=ur(e.encode(t.slice(0,n)),i);if(o.length===0)return null;const l=a.lm??r.loadLM(),s=new tt(l,{epochs:a.epochs??1}).fit(o),h=s.length>0?s[s.length-1]:0;return{diff:Yt(r.checkpoint,l.exportWeights()),loss:h,sequences:o.length}}function ss(r,e,t,a,n={}){const i=ta(r,e,t,n);return i?{pkg:r.withCheckpoint(Qt(r.checkpoint,i.diff),a),loss:i.loss,sequences:i.sequences}:null}function ra(r,e,t){if(e.length===0)return{checkpoint:r,mergedRows:0,contributors:0,deltaNorm:0};if(t&&t.length!==e.length)throw new Error(`mergeCheckpointDiffs: weights length ${t.length} != diffs length ${e.length}`);const a=e.map(d=>en(d));for(const d of a)if(d.rowSize!==1)throw new Error(`mergeCheckpointDiffs: expected element-granular deltas (rowSize 1), got ${d.rowSize}`);const n=new Map;if(a.forEach((d,c)=>{const f=t?t[c]:1;f>0&&d.rows.forEach((g,m)=>{const p=d.data[m],_=n.get(g);_?(_.sum+=f*p,_.weight+=f):n.set(g,{sum:f*p,weight:f})})}),n.size===0)return{checkpoint:r,mergedRows:0,contributors:a.length,deltaNorm:0};const i=[...n.keys()].sort((d,c)=>d-c),o=new Float32Array(i.length);i.forEach((d,c)=>{const f=n.get(d);o[c]=f.sum/f.weight});const l=new Float32Array(Kt(r).body);let s=0;return i.forEach((d,c)=>{const f=o[c]-(l[d]??0);s+=f*f}),{checkpoint:Qt(r,tn({rowSize:1,rows:i,data:o})),mergedRows:i.length,contributors:a.length,deltaNorm:Math.sqrt(s)}}function na(r,e,t,a,n={}){const i=ra(r,e,t),o=(u,d,c)=>({...i,checkpoint:r,deltaNorm:0,accepted:!1,baseLoss:d,newLoss:c,refusedReason:u});if(i.mergedRows===0)return o("nothing-merged",null,null);const l=u=>u!=null&&Number.isFinite(u)?u:null,s=l(a(r)),h=l(a(i.checkpoint));return s==null||h==null?n.requireEval?o("unscored",s,h):{...i,accepted:!0,baseLoss:s,newLoss:h}:h>s+(n.tolerance??0)?o("regressed",s,h):{...i,accepted:!0,baseLoss:s,newLoss:h}}const aa=128;function ia(r,e){if(e.length<2)return null;const{logits:t}=r.forward(e),a=Math.min(t.length,e.length)-1;if(a<1)return null;let n=0;for(let o=0;o<a;o++)n+=ye(t[o],e[o+1]);const i=n/a;return Number.isFinite(i)&&i>=0?i:null}function ls(r,e,t,a=aa){let n=0,i=0;for(const o of t){const l=(o.prompt?`${o.prompt}
`:"")+o.text,s=ia(r,e.encode(l).slice(0,a));s!=null&&(n+=s,i++)}return i>0?n/i:null}class ds{model;codec;dimensions;fingerprint;constructor(e,t,a){this.model=e,this.codec=t,this.dimensions=e.config.dModel,this.fingerprint=a??oa(e)}async embed(e){return this.embedSync(e)}embedSync(e){return this.model.embedText(e,this.codec)}}function oa(r){const e=r.config,t=new Uint8Array(r.emb.buffer,r.emb.byteOffset,r.emb.byteLength);return`evermind-lm/${[e.vocabSize,e.dModel,e.numLayers,e.convKernel,e.hiddenDim,e.numExperts,e.topK].join("-")}/${rn(t).toString(16)}`}const ot=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],hr=-10,fr=5;function sa(r){const{dModel:e,dState:t,dConv:a,dInner:n,dtRank:i}=r;return{wInProj:new Float32Array(2*n*e),bInProj:new Float32Array(2*n),wConv:new Float32Array(n*a),bConv:new Float32Array(n),wXProj:new Float32Array((i+2*t)*n),bXProj:new Float32Array(i+2*t),wDtProj:new Float32Array(n*i),bDtProj:new Float32Array(n),A_log:new Float32Array(n*t),D_vec:new Float32Array(n),wOutProj:new Float32Array(e*n),bOutProj:new Float32Array(e),normWeight:new Float32Array(e)}}function gr(r,e,t){const{dModel:a,dState:n,dConv:i,dInner:o,dtRank:l,batch:s,seqLen:h}=t,u=s*h,d=l+2*n,c=new Float32Array(u*a),f=new Float32Array(u);Jt(r,e.normWeight,u,a,c,f);const g=new Float32Array(u*2*o);_e(c,e.wInProj,e.bInProj,u,a,2*o,g);const m=new Float32Array(u*o),p=new Float32Array(u*o);for(let y=0;y<u;y++)for(let k=0;k<o;k++)m[y*o+k]=g[y*2*o+k],p[y*o+k]=g[y*2*o+o+k];const _=new Float32Array(u*o);for(let y=0;y<s;y++)for(let k=0;k<h;k++){const D=(y*h+k)*o;for(let z=0;z<o;z++){let U=e.bConv[z];for(let B=0;B<i;B++)k>=B&&(U+=e.wConv[z*i+B]*m[(y*h+k-B)*o+z]);_[D+z]=U}}const b=new Float32Array(u*o);for(let y=0;y<u*o;y++)b[y]=pt(_[y]);const w=new Float32Array(u*d);_e(b,e.wXProj,e.bXProj,u,o,d,w);const v=new Float32Array(u*l),L=new Float32Array(u*n),S=new Float32Array(u*n);for(let y=0;y<u;y++){for(let k=0;k<l;k++)v[y*l+k]=w[y*d+k];for(let k=0;k<n;k++)L[y*n+k]=w[y*d+l+k],S[y*n+k]=w[y*d+l+n+k]}const M=new Float32Array(u*o);_e(v,e.wDtProj,e.bDtProj,u,l,o,M);const x=new Float32Array(u*o);for(let y=0;y<u*o;y++)x[y]=nn(M[y]);const N=new Float32Array(o*n);for(let y=0;y<o*n;y++)N[y]=-Math.exp(Math.min(fr,Math.max(hr,e.A_log[y])));const C=new Float32Array(u*o*n),O=new Float32Array(u*o*n),R=new Float32Array(u*o*n),G=new Float32Array(u*o);for(let y=0;y<s;y++)for(let k=0;k<h;k++){const D=y*h+k;for(let z=0;z<o;z++){const U=x[D*o+z],B=b[D*o+z];let T=e.D_vec[z]*B;for(let F=0;F<n;F++){const K=N[z*n+F],Z=Math.exp(U*K),V=(Z-1)/K*L[D*n+F],X=(D*o+z)*n+F;C[X]=Z,O[X]=V;const re=k===0?0:R[((D-1)*o+z)*n+F],de=Z*re+V*B;R[X]=de,T+=S[D*n+F]*de}G[D*o+z]=T}}const j=new Float32Array(u*o),q=new Float32Array(u*o);for(let y=0;y<u*o;y++)j[y]=pt(p[y]),q[y]=G[y]*j[y];const A=new Float32Array(u*a);_e(q,e.wOutProj,e.bOutProj,u,o,a,A);for(let y=0;y<u*a;y++)A[y]=A[y]+r[y];return{output:A,cache:{x:r,normInv:f,normOut:c,xConvIn:m,z:p,convOut:_,u:b,dtRaw:v,bRaw:L,cRaw:S,deltaFull:M,dv:x,aCont:N,aBar:C,bBar:O,h:R,scanY:G,siluZ:j,gated:q}}}function la(r,e,t,a,n){const{dModel:i,dState:o,dConv:l,dInner:s,dtRank:h,batch:u,seqLen:d}=a,c=u*d,f=h+2*o,g=new Float32Array(c*i);g.set(r);const m=new Float32Array(c*s);Me(r,t.gated,e.wOutProj,c,s,i,m,n.wOutProj,n.bOutProj);const p=new Float32Array(c*s),_=new Float32Array(c*s);for(let A=0;A<c*s;A++)p[A]=m[A]*t.siluZ[A],_[A]=m[A]*t.scanY[A]*mt(t.z[A]);const b=new Float32Array(c*s),w=new Float32Array(c*o),v=new Float32Array(c*o),L=new Float32Array(c*s),S=new Float32Array(s*o),M=new Float32Array(s*o);for(let A=0;A<u;A++){M.fill(0);for(let y=d-1;y>=0;y--){const k=A*d+y;for(let D=0;D<s;D++){const z=p[k*s+D],U=t.u[k*s+D],B=t.dv[k*s+D];n.D_vec[D]=n.D_vec[D]+z*U,b[k*s+D]=b[k*s+D]+z*e.D_vec[D];let T=0;for(let F=0;F<o;F++){const K=(k*s+D)*o+F,Z=t.h[K],V=t.aBar[K],X=t.bBar[K],re=t.aCont[D*o+F],de=t.cRaw[k*o+F];v[k*o+F]=v[k*o+F]+z*Z;const Ae=z*de+M[D*o+F],Yr=y===0?0:t.h[((k-1)*s+D)*o+F],ht=Ae*Yr,Ie=Ae*U;b[k*s+D]=b[k*s+D]+Ae*X,M[D*o+F]=Ae*V;const ft=t.bRaw[k*o+F];T+=ht*re*V+Ie*V*ft,S[D*o+F]=S[D*o+F]+ht*B*V+Ie*ft*((B*V*re-(V-1))/(re*re)),w[k*o+F]=w[k*o+F]+Ie*((V-1)/re)}L[k*s+D]=L[k*s+D]+T}}}for(let A=0;A<s*o;A++){const y=e.A_log[A];y<=hr||y>=fr||(n.A_log[A]=n.A_log[A]+S[A]*t.aCont[A])}const x=new Float32Array(c*s);for(let A=0;A<c*s;A++)x[A]=L[A]*xe(t.deltaFull[A]);const N=new Float32Array(c*h);Me(x,t.dtRaw,e.wDtProj,c,h,s,N,n.wDtProj,n.bDtProj);const C=new Float32Array(c*f);for(let A=0;A<c;A++){for(let y=0;y<h;y++)C[A*f+y]=N[A*h+y];for(let y=0;y<o;y++)C[A*f+h+y]=w[A*o+y],C[A*f+h+o+y]=v[A*o+y]}const O=new Float32Array(c*s);Me(C,t.u,e.wXProj,c,s,f,O,n.wXProj,n.bXProj);for(let A=0;A<c*s;A++)b[A]=b[A]+O[A];const R=new Float32Array(c*s);for(let A=0;A<c*s;A++)R[A]=b[A]*mt(t.convOut[A]);const G=new Float32Array(c*s);for(let A=0;A<u;A++)for(let y=0;y<d;y++){const k=A*d+y;for(let D=0;D<s;D++){const z=R[k*s+D];if(z!==0){n.bConv[D]=n.bConv[D]+z;for(let U=0;U<l;U++){if(y<U)continue;const B=(A*d+y-U)*s+D;n.wConv[D*l+U]=n.wConv[D*l+U]+z*t.xConvIn[B],G[B]=G[B]+z*e.wConv[D*l+U]}}}}const j=new Float32Array(c*2*s);for(let A=0;A<c;A++)for(let y=0;y<s;y++)j[A*2*s+y]=G[A*s+y],j[A*2*s+s+y]=_[A*s+y];const q=new Float32Array(c*i);return Me(j,t.normOut,e.wInProj,c,i,2*s,q,n.wInProj,n.bInProj),Zt(q,t.x,e.normWeight,t.normInv,c,i,g,n.normWeight,rt),g}const vt=["mamba1"];function da(r){const e={dModel:r.dModel,dState:r.dState,dConv:r.dConv,dInner:r.dInner,dtRank:r.dtRank};return{embedding:new Float32Array(r.vocabSize*r.dModel),finalNorm:new Float32Array(r.dModel),lmHeadBias:new Float32Array(r.vocabSize),layers:Array.from({length:r.numLayers},()=>sa(e))}}function ca(r){const e=new Map;e.set("embedding",r.embedding);for(let t=0;t<r.layers.length;t++){const a=r.layers[t];for(const n of ot)e.set(`layer${t}.${n}`,a[n])}return e.set("final_norm",r.finalNorm),e.set("lm_head_bias",r.lmHeadBias),e}function ua(r){const e=new Map;e.set("embedding",r.embedding);for(let t=0;t<r.layers.length;t++){const a=r.layers[t];for(const n of ot)e.set(`layer${t}.${n}`,a[n])}return e.set("final_norm",r.finalNorm),e.set("lm_head_bias",r.lmHeadBias),e}function ha(r,e){const t=(u,d)=>{const c=r.get(u);if(!c)throw new Error(`cpuWeightsFromNamed: missing tensor "${u}"`);if(c.length!==d)throw new Error(`cpuWeightsFromNamed: "${u}" has ${c.length} elements, expected ${d}`);return c},{dModel:a,dState:n,dConv:i,dInner:o,dtRank:l}=e,s={wInProj:2*o*a,bInProj:2*o,wConv:o*i,bConv:o,wXProj:(l+2*n)*o,bXProj:l+2*n,wDtProj:o*l,bDtProj:o,A_log:o*n,D_vec:o,wOutProj:a*o,bOutProj:a,normWeight:a},h=[];for(let u=0;u<e.numLayers;u++){const d={};for(const c of ot)d[c]=t(`layer${u}.${c}`,s[c]);h.push(d)}return{embedding:t("embedding",e.vocabSize*a),finalNorm:t("final_norm",a),lmHeadBias:t("lm_head_bias",e.vocabSize),layers:h}}function mr(r,e,t,a,n,i=!1){const{vocabSize:o,dModel:l}=t,s=a*n;let h=new Float32Array(s*l);for(let p=0;p<s;p++){const _=r[p];if(_<0||_>=o)throw new Error(`token id ${_} out of range [0, ${o})`);h.set(e.embedding.subarray(_*l,(_+1)*l),p*l)}const u={dModel:l,dState:t.dState,dConv:t.dConv,dInner:t.dInner,dtRank:t.dtRank,batch:a,seqLen:n},d=[],c=[];for(let p=0;p<t.numLayers;p++){d.push(h);const{output:_,cache:b}=gr(h,e.layers[p],u);i||c.push(b),h=_}const f=new Float32Array(s*l),g=new Float32Array(s);Jt(h,e.finalNorm,s,l,f,g,rt);const m=new Float32Array(s*o);return _e(f,e.embedding,e.lmHeadBias,s,l,o,m),{hiddenIn:d,layer:c,lastHidden:h,normOut:f,normInv:g,logits:m}}function fa(r,e,t,a,n){return mr(r,e,t,a,n).logits}function cs(r,e,t,a,n,i){const o=fa(r,t,a,n,i),l=n*i,s=a.vocabSize;let h=0;for(let u=0;u<l;u++)h+=ye(o.subarray(u*s,(u+1)*s),e[u]);return h/l}function ga(r,e,t,a,n,i,o={}){const{vocabSize:l,dModel:s}=a,h=n*i,u=o.activationCheckpointing??!1,d=mr(r,t,a,n,i,u),c=da(a);let f=0;const g=new Float32Array(h*l);for(let v=0;v<h;v++){const L=d.logits.subarray(v*l,(v+1)*l),S=e[v];f+=ye(L,S);const M=an(L,S);for(let x=0;x<l;x++)g[v*l+x]=M[x]/h}const m=f/h,p=new Float32Array(h*s);for(let v=0;v<h;v++){const L=v*l,S=v*s;for(let M=0;M<l;M++){const x=g[L+M];if(x===0)continue;c.lmHeadBias[M]=c.lmHeadBias[M]+x;const N=M*s;for(let C=0;C<s;C++)p[S+C]=p[S+C]+x*t.embedding[N+C],c.embedding[N+C]=c.embedding[N+C]+x*d.normOut[S+C]}}const _=new Float32Array(h*s);Zt(p,d.lastHidden,t.finalNorm,d.normInv,h,s,_,c.finalNorm,rt);const b={dModel:s,dState:a.dState,dConv:a.dConv,dInner:a.dInner,dtRank:a.dtRank,batch:n,seqLen:i};let w=_;for(let v=a.numLayers-1;v>=0;v--){const L=u?gr(d.hiddenIn[v],t.layers[v],b).cache:d.layer[v];w=la(w,t.layers[v],L,b,c.layers[v])}for(let v=0;v<h;v++){const S=r[v]*s,M=v*s;for(let x=0;x<s;x++)c.embedding[S+x]=c.embedding[S+x]+w[M+x]}return{loss:m,grads:ca(c)}}function ma(r,e){const{dModel:t,dState:a,dConv:n,dInner:i,dtRank:o}=e;if(r==="embedding")return[e.vocabSize,t];switch(r.startsWith("layer")?r.slice(r.indexOf(".")+1):r){case"wInProj":return[2*i,t];case"wConv":return[i,n];case"wXProj":return[o+2*a,i];case"wDtProj":return[i,o];case"A_log":return[i,a];case"wOutProj":return[t,i];default:return null}}const pa=["wInProj","wXProj","wDtProj","wOutProj"],_a=.05;class us{model;tokenizer;device;_moments;_step;_dims;_mirror;_mirrorByName;_adapters;_loraBase;_shard;constructor(e,t=null){this.model=e,this.tokenizer=t,this.device=e.device,this._moments=new Map,this._step=0,this._dims=ba(e),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const e=this.model.getTrainableParams();if(this._adapters.size===0)return e.reduce((a,n)=>a+n.numel,0);let t=0;for(const a of e){const n=this._adapters.get(a.name);n&&(t+=n.numParams())}return t}_owns(e){return this._shard===null||e%this._shard.count===this._shard.index}_installAdapters(e){if(this._adapters.size>0)return;const t=new Set(e.targets??pa),a=this._mirrorByName;for(const n of this.model.getTrainableParams()){const i=n.name.includes(".")?n.name.slice(n.name.indexOf(".")+1):n.name;if(!t.has(i))continue;const o=ma(n.name,this._dims);if(!o)continue;const[l,s]=o,h=Math.max(1,Math.min(e.rank??8,l,s));this._adapters.set(n.name,new on(l,s,{...e,rank:h})),this._loraBase.set(n.name,Float32Array.from(a.get(n.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...t].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const e=this._mirrorByName;for(const[t,a]of this._adapters){const n=e.get(t),i=this._loraBase.get(t),o=a.delta();for(let l=0;l<n.length;l++)n[l]=i[l]+o[l]}}_momentFor(e){let t=this._moments.get(e.name);return t||(t={m:new Float32Array(e.numel),v:new Float32Array(e.numel)},this._moments.set(e.name,t)),t}async _syncMirrorFromGpu(){const e=new Map;for(const t of this.model.parameters())e.set(t.name,await ie(this.device,t.buf,t.numel*4));e.set("lm_head_bias",await ie(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=ha(e,this._dims),this._mirrorByName=ua(this._mirror)}async train(e,t={}){const{learningRate:a=1e-4,epochs:n=5,batchSize:i=1,seqLen:o=512,maxGradNorm:l=1,weightDecay:s=.01,beta1:h=.9,beta2:u=.999,eps:d=1e-8,wsla:c=!1,onEpochEnd:f=null}=t,g=Math.max(1,Math.floor(t.gradientAccumulation??1));if(this._shard=t.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const m=t.maxDelta??(c?_a:0);c&&this.model.setWSLAMode(!0);let p;if(typeof e=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");p=this.tokenizer.encode(e)}else p=Array.from(e);if(p.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const _=wa(p,o);if(_.length===0)throw new Error("Input is too short to form any training chunk.");const b=ya(_,Math.max(1,Math.floor(i)));await this._syncMirrorFromGpu(),t.lora&&this._installAdapters(t.lora);const w=[];for(let v=0;v<n;v++){let L=0,S=0,M=0;for(let N=0;N<b.length;N+=g){const C=b.slice(N,N+g),{loss:O,gradNorm:R}=await this._trainStep(C,{learningRate:a,maxGradNorm:l,weightDecay:s,beta1:h,beta2:u,eps:d,wsla:c,maxDelta:m,...t.activationCheckpointing?{activationCheckpointing:!0}:{}});L+=O,S+=R,M++}const x=L/M;w.push(x),f&&f(v+1,x,S/M)}return c&&this.model.setWSLAMode(!1),w}async _trainStep(e,t){const{learningRate:a,maxGradNorm:n,weightDecay:i,beta1:o,beta2:l,eps:s,maxDelta:h}=t;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const u=this._mirror,d=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const c=t.activationCheckpointing?{activationCheckpointing:!0}:{};let f=0,g=new Map;for(const w of e){const v=ga(w.inputs,w.targets,u,this._dims,w.batch,w.seqLen,c);if(f+=v.loss/e.length,g.size===0){for(const L of v.grads.values())for(let S=0;S<L.length;S++)L[S]=L[S]/e.length;g=v.grads}else for(const[L,S]of v.grads){const M=g.get(L);for(let x=0;x<S.length;x++)M[x]=M[x]+S[x]/e.length}}const m=this.model.getTrainableParams();if(this._adapters.size>0)for(const[w,v]of this._adapters){const L=g.get(w);L&&(v.zeroGrad(),v.accumulateGradient(L))}let p=0;for(const w of m){const v=g.get(w.name);if(v)for(let L=0;L<v.length;L++)p+=v[L]*v[L]}const _=Math.sqrt(p),b=n>0&&_>n?n/_:1;return this._adamwStep(m,g,d,{learningRate:a,weightDecay:i,beta1:o,beta2:l,eps:s,beta1_t:Math.pow(o,this._step),beta2_t:Math.pow(l,this._step),maxDelta:h,gradScale:b}),{loss:f,gradNorm:_}}_adamwStep(e,t,a,n){const{learningRate:i,weightDecay:o,beta1:l,beta2:s,eps:h,beta1_t:u,beta2_t:d,maxDelta:c,gradScale:f}=n,g={lr:i,beta1:l,beta2:s,eps:h,weightDecay:o,beta1_t:u,beta2_t:d,maxDelta:c,gradScale:f};for(let m=0;m<e.length;m++){const p=e[m];if(!this._owns(m))continue;const _=this._adapters.get(p.name);if(_){const L=a.get(p.name),S=this._loraBase.get(p.name),[M,x]=[_.A,_.B],[N,C]=[_.gradients()[1].data,_.gradients()[0].data],O=this._momentNamed(`${p.name}::loraB`,x.length),R=this._momentNamed(`${p.name}::loraA`,M.length);Se(x,C,O.m,O.v,g),Se(M,N,R.m,R.v,g);const G=_.delta();for(let j=0;j<L.length;j++)L[j]=S[j]+G[j];ge(this.device,p.buf,L);continue}const b=t.get(p.name),w=a.get(p.name);if(!b||!w)continue;if(b.length!==p.numel||w.length!==p.numel)throw new Error(`MambaTrainer: parameter "${p.name}" is ${p.numel} elements but the gradient engine produced ${b.length} — model and CPU mirror disagree.`);const v=this._momentFor(p);Se(w,b,v.m,v.v,g),ge(this.device,p.buf,w)}}_momentNamed(e,t){let a=this._moments.get(e);return a||(a={m:new Float32Array(t),v:new Float32Array(t)},this._moments.set(e,a)),a}optimizerStateBytes(){let e=0;for(const t of this._moments.values())e+=t.m.byteLength+t.v.byteLength;return e}async evaluate(e){let t;if(typeof e=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");t=Array.from(this.tokenizer.encode(e))}else t=Array.from(e);const a=t.length,n=this.model.config.vocabSize,{logits:i}=await this.model.forward(new Uint32Array(t.slice(0,-1)),1,a-1);let o=0;for(let s=0;s<a-1;s++){const h=s*n;o+=ye(i.slice(h,h+n),t[s+1])}const l=o/(a-1);return Math.exp(l)}}function ba(r){const e=r.layerSpecs.map((i,o)=>({i:o,type:i.type})).filter(({type:i})=>!vt.includes(i));if(e.length>0){const i=e.map(({i:o,type:l})=>`layer${o}=${l}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${vt.join("/")} layers only, but this model has ${i}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const t=r.layers[0],a=t?.dInner??r.config.expand*r.config.dModel,n=t?.dtRank??Math.ceil(r.config.dModel/16);return{vocabSize:r.config.vocabSize,dModel:r.config.dModel,dState:r.config.dState,dConv:r.config.dConv,dInner:a,dtRank:n,numLayers:r.layers.length}}function wa(r,e){const t=[];for(let n=0;n+e<r.length;n+=e)t.push({inputs:r.slice(n,n+e),targets:r.slice(n+1,n+e+1)});const a=r.length%e;if(a>1){const n=r.length-a;t.push({inputs:r.slice(n,-1),targets:r.slice(n+1)})}return t}function ya(r,e){const t=[];let a=0;for(;a<r.length;){const n=r[a].inputs.length,i=[];for(;a<r.length&&i.length<e&&r[a].inputs.length===n;)i.push(r[a]),a++;t.push({inputs:i.flatMap(o=>o.inputs),targets:i.flatMap(o=>o.targets),batch:i.length,seqLen:n})}return t}class hs{video;constructor(e){this.video=new sn({...e,keyframeInterval:1})}get vocab(){return this.video.vocab}get vocabSize(){return this.video.vocabSize}get frameSize(){return this.video.height*this.video.width*this.video.channels}encode(e){return this.video.encode([e])}decode(e){return this.video.decode(e)[0]??new Float32Array(this.frameSize)}fit(e,t){return this.video.fit(e.map(a=>[a]),t)}}function fs(r,e,t){return[...e,...r.encode(t)]}function va(r,e,t,a){if(r.config.vocabSize!==e.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${r.config.vocabSize}) must equal codec.vocabSize (${e.vocabSize})`);const n=r.generate(t,{...a,stopToken:a.stopToken??e.vocab.eosVideo});return{video:e.decode(n),tokens:n}}function gs(r,e,t,a){const{video:n,tokens:i}=va(r,e.video,t,a);return{image:n[0]??new Float32Array(e.frameSize),tokens:i}}const xa=0,ka=5,Aa=2;class J{parts=[];byte(e){this.parts.push(e&255)}rawVarint(e){if(e<0||!Number.isFinite(e))throw new Error(`ProtoWriter: bad varint ${e}`);let t=e;for(;t>=128;)this.byte(t%128|128),t=Math.floor(t/128);this.byte(t)}tag(e,t){this.rawVarint(e*8+t)}rawBytes(e){for(let t=0;t<e.length;t++)this.byte(e[t])}varint(e,t){this.tag(e,xa),this.rawVarint(t)}float(e,t){this.tag(e,ka);const a=new ArrayBuffer(4);new DataView(a).setFloat32(0,t,!0),this.rawBytes(new Uint8Array(a))}bytes(e,t){this.tag(e,Aa),this.rawVarint(t.length),this.rawBytes(t)}string(e,t){this.bytes(e,new TextEncoder().encode(t))}message(e,t){this.bytes(e,t.finish())}finish(){return Uint8Array.from(this.parts)}}function Ma(r){const e=new Uint8Array(r.length*4),t=new DataView(e.buffer);for(let a=0;a<r.length;a++)t.setFloat32(a*4,r[a],!0);return e}const La=18,Sa=8,pr=1,_r=7,Da=1,Ea=2,Na=3,Ca=7;class Fa{nodes=[];inits=[];uid=0;tmp(e){return`${e}_${this.uid++}`}initFloat(e,t,a){return this.inits.push({name:e,dims:t,dataType:pr,raw:Ma(a)}),e}initInt64(e,t,a){return this.inits.push({name:e,dims:t,dataType:_r,int64:a}),e}node(e,t,a,n=[]){return this.nodes.push({op:e,inputs:t,outputs:a,name:`${e}_${this.uid++}`,attrs:n}),a}op(e,t,a,n=[]){const i=this.tmp(a);return this.node(e,t,[i],n),i}}function xt(r,e,t,a,n){const i=r.op("Mul",[e,e],"rms_sq"),o=r.op("ReduceMean",[i,n],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),l=r.op("Add",[o,a],"rms_eps"),s=r.op("Sqrt",[l],"rms_r"),h=r.op("Div",[e,s],"rms_div");return r.op("Mul",[h,t],"rms_y")}function kt(r,e,t,a,n,i){const o=r.op("Transpose",[t],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),l=r.op("Add",[r.op("MatMul",[e,o],"ffn_mm1"),a],"ffn_pre"),s=r.op("Relu",[l],"ffn_h"),h=r.op("Transpose",[n],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return r.op("Add",[r.op("MatMul",[s,h],"ffn_mm2"),i],"ffn_y")}function At(r,e={}){const t=er(r),a=tr(r),n=new Map(a.map(w=>[w.name,w])),i=w=>{const v=n.get(w);if(!v)throw new Error(`export/onnx: missing tensor ${w}`);return v},o=new Fa,{vocabSize:l,dModel:s,numLayers:h,convKernel:u,numExperts:d,topK:c}=t,f=o.initFloat("token_embedding.weight",[l,s],i("token_embedding.weight").data),g=o.initFloat("rms_eps",[1],new Float32Array([1e-5])),m=o.initInt64("axes_last",[1],[2]),p=o.initInt64("topk_k",[1],[c]);let _=o.op("Gather",[f,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let w=0;w<h;w++){const v=`layers.${w}`,L=o.initFloat(`${v}.norm_conv.weight`,[s],i(`${v}.norm_conv.weight`).data),S=xt(o,_,L,g,m),M=i(`${v}.conv.weight`).data,x=new Float32Array(s*u);for(let V=0;V<s;V++)for(let X=0;X<u;X++)x[V*u+(u-1-X)]=M[V*u+X];const N=o.initFloat(`${v}.conv.onnx_weight`,[s,1,u],x),C=o.op("Transpose",[S],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),O=o.op("Conv",[C,N],"conv_out",[{kind:"i",name:"group",value:s},{kind:"ints",name:"kernel_shape",value:[u]},{kind:"ints",name:"pads",value:[u-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),R=o.op("Transpose",[O],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),G=o.op("Add",[_,R],"after_conv"),j=o.initFloat(`${v}.norm_moe.weight`,[s],i(`${v}.norm_moe.weight`).data),q=xt(o,G,j,g,m),A=o.initFloat(`${v}.moe.router.weight`,[d,s],i(`${v}.moe.router.weight`).data),y=o.op("Transpose",[A],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),k=o.op("MatMul",[q,y],"router_logits"),D=o.tmp("topk_v"),z=o.tmp("topk_i");o.node("TopK",[k,p],[D,z],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const U=o.op("Softmax",[D],"gates",[{kind:"i",name:"axis",value:2}]),B=o.op("Sub",[k,k],"zeros"),T=o.op("ScatterElements",[B,z,U],"combine",[{kind:"i",name:"axis",value:2}]),F=kt(o,q,o.initFloat(`${v}.moe.shared.w1`,[t.hiddenDim,s],i(`${v}.moe.shared.w1`).data),o.initFloat(`${v}.moe.shared.b1`,[t.hiddenDim],i(`${v}.moe.shared.b1`).data),o.initFloat(`${v}.moe.shared.w2`,[s,t.hiddenDim],i(`${v}.moe.shared.w2`).data),o.initFloat(`${v}.moe.shared.b2`,[s],i(`${v}.moe.shared.b2`).data)),K=Array.from({length:d},(V,X)=>o.tmp(`combine_${X}`));o.node("Split",[T],K,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:d}]);let Z=F;for(let V=0;V<d;V++){const X=`${v}.moe.experts.${V}`,re=kt(o,q,o.initFloat(`${X}.w1`,[t.hiddenDim,s],i(`${X}.w1`).data),o.initFloat(`${X}.b1`,[t.hiddenDim],i(`${X}.b1`).data),o.initFloat(`${X}.w2`,[s,t.hiddenDim],i(`${X}.w2`).data),o.initFloat(`${X}.b2`,[s],i(`${X}.b2`).data)),de=o.op("Mul",[K[V],re],"expert_w");Z=o.op("Add",[Z,de],"moe_acc")}_=o.op("Add",[G,Z],"after_moe")}const b=o.op("Transpose",[f],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return o.node("MatMul",[_,b],["logits"]),ja(o,t,e)}function Pa(r){const e=new J;switch(e.string(1,r.name),r.kind){case"i":e.varint(20,Ea),e.varint(3,r.value);break;case"ints":e.varint(20,Ca);for(const t of r.value)e.varint(8,t);break;case"f":e.varint(20,Da),e.float(2,r.value);break;case"s":e.varint(20,Na),e.string(4,r.value);break}return e}function Ta(r){const e=new J;for(const t of r.inputs)e.string(1,t);for(const t of r.outputs)e.string(2,t);e.string(3,r.name),e.string(4,r.op);for(const t of r.attrs)e.message(5,Pa(t));return e}function Ba(r){const e=new J;for(const t of r.dims)e.varint(1,t);if(e.varint(2,r.dataType),e.string(8,r.name),r.int64)for(const t of r.int64)e.varint(7,t);return r.raw&&e.bytes(9,r.raw),e}function Ia(r){const e=new J;return e.string(2,r),e}function Wa(r){const e=new J;return e.varint(1,r),e}function Mt(r,e,t){const a=new J;for(const l of t)a.message(1,typeof l=="string"?Ia(l):Wa(l));const n=new J;n.varint(1,e),n.message(2,a);const i=new J;i.message(1,n);const o=new J;return o.string(1,r),o.message(2,i),o}function ja(r,e,t){const a=new J;for(const o of r.nodes)a.message(1,Ta(o));a.string(2,"evermind");for(const o of r.inits)a.message(5,Ba(o));a.message(11,Mt("input_ids",_r,["batch","seq"])),a.message(12,Mt("logits",pr,["batch","seq",e.vocabSize]));const n=new J;n.string(1,""),n.varint(2,La);const i=new J;return i.varint(1,Sa),i.string(2,t.producerName??"builderforce-memory-engine"),i.string(3,t.producerVersion??"evermind"),i.message(7,a),i.message(8,n),i.finish()}const $a=1179993927,Ra=3,pe=32,za=4,Oa=8,Ha=0,qa=1;class Ga{buf=new Uint8Array(1024);len=0;ensure(e){if(this.len+e<=this.buf.length)return;let t=this.buf.length*2;for(;t<this.len+e;)t*=2;const a=new Uint8Array(t);a.set(this.buf.subarray(0,this.len)),this.buf=a}u32(e){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,e,!0),this.len+=4}u64(e){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(e),!0),this.len+=8}raw(e){this.ensure(e.length),this.buf.set(e,this.len),this.len+=e.length}alignTo(e){const t=(e-this.len%e)%e;t>0&&(this.ensure(t),this.len+=t)}string(e){const t=new TextEncoder().encode(e);this.u64(t.length),this.raw(t)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function Ka(r,e){if(!e){const n=new Uint8Array(r.length*4),i=new DataView(n.buffer);for(let o=0;o<r.length;o++)i.setFloat32(o*4,r[o],!0);return n}const t=new Uint8Array(r.length*2),a=new DataView(t.buffer);for(let n=0;n<r.length;n++)a.setUint16(n*2,ln(r[n]),!0);return t}function Lt(r,e={}){const t=e.fp16??!1,a=er(r),n=tr(r),i=t?qa:Ha,o=t?2:4,l=[["evermind.vocab_size",a.vocabSize],["evermind.embedding_length",a.dModel],["evermind.block_count",a.numLayers],["evermind.conv_kernel",a.convKernel],["evermind.feed_forward_length",a.hiddenDim],["evermind.expert_count",a.numExperts],["evermind.expert_used_count",a.topK],["general.alignment",pe]],s=[["general.architecture","evermind"],["general.name",e.name??"Evermind"]],h=new Ga;h.u32($a),h.u32(Ra),h.u64(n.length),h.u64(l.length+s.length);for(const[g,m]of s)h.string(g),h.u32(Oa),h.string(m);for(const[g,m]of l)h.string(g),h.u32(za),h.u32(m);const u=g=>[...g.shape].reverse();let d=0;const c=[];for(const g of n){c.push(d);const m=g.data.length*o;d+=m,d+=(pe-d%pe)%pe}n.forEach((g,m)=>{h.string(g.name);const p=u(g);h.u32(p.length);for(const _ of p)h.u64(_);h.u32(i),h.u64(c[m])}),h.alignTo(pe);const f=h.length;for(let g=0;g<n.length;g++){const m=f+c[g];for(;h.length<m;)h.raw(new Uint8Array(1));h.raw(Ka(n[g].data,t))}return h.bytes()}const ms=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],Ua="application/json";function je(r,e){return{path:r,data:JSON.stringify(e,null,2),contentType:Ua}}function ps(r,e,t={},a){const n=dn(r),i=()=>({format:e,files:[],paramCount:n});switch(e){case"safetensors":{const o=i();return o.files.push({path:"model.safetensors",data:_t(r,{fp16:t.fp16}),contentType:"application/octet-stream"}),o}case"onnx":{const o=i();return o.files.push({path:"model.onnx",data:At(r,{producerVersion:t.version}),contentType:"application/octet-stream"}),o}case"gguf":{const o=i();return o.files.push({path:"model.gguf",data:Lt(r,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"}),o}case"huggingface":{if(!a)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const o=i();return o.files.push({path:"model.safetensors",data:_t(r,{fp16:t.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:At(r,{producerVersion:t.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:Lt(r,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"},je("config.json",cn(r)),je("generation_config.json",fn()),je("tokenizer.json",un(a)),{path:"README.md",data:hn(r,t),contentType:"text/markdown"}),o}default:throw new Error(`exportEvermind: unknown format "${String(e)}"`)}}function br(r){return r.startsWith("model.")?r.slice(6):r}function Va(r){return r.reduce((e,t)=>e*t,1)}function ue(r){const e=r.filter(t=>t!==1);return e.length>0?e:[1]}function $e(r,e){return r.length===e.length&&r.every((t,a)=>t===e[a])}function Xa(r){if(!(r>0))throw new Error(`import/foreign: softplus⁻¹ needs a positive input, got ${r}`);return r>30?r:Math.log(Math.expm1(r))}function St(r,e){const t=Va(r.shape);if(r.op.kind==="fill")return new Float32Array(t).fill(r.op.value);if(!e)throw new Error(`import/foreign: rule for "${r.target}" has no source tensor`);const a=`"${e.name}" → "${r.target}"`;switch(r.op.kind){case"copy":case"negExpToSoftplusInv":{if(!$e(ue(e.shape),ue(r.shape)))throw new Error(`import/foreign: ${a} shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${r.shape.join(", ")}]`);if(e.data.length!==t)throw new Error(`import/foreign: ${a} has ${e.data.length} elements, expected ${t}`);if(r.op.kind==="copy")return Float32Array.from(e.data);const n=new Float32Array(t);for(let i=0;i<t;i++)n[i]=Xa(Math.exp(e.data[i]));return n}case"convTaps":{const[n,i]=ue(r.shape),o=ue(e.shape);if(!$e(o,[n,i]))throw new Error(`import/foreign: ${a} depthwise conv shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${r.shape.join(", ")}] (a [channels, 1, kernel] PyTorch kernel squeezes to [channels, kernel])`);const l=new Float32Array(t);for(let s=0;s<n;s++)for(let h=0;h<i;h++)l[s*i+h]=e.data[s*i+(i-1-h)];return l}case"rowSlice":{if(e.shape.length!==2)throw new Error(`import/foreign: ${a} rowSlice needs a rank-2 source, got [${e.shape.join(", ")}]`);const[n,i]=e.shape,{start:o,count:l}=r.op;if(o<0||o+l>n)throw new Error(`import/foreign: ${a} rowSlice [${o}, ${o+l}) is outside the checkpoint tensor's ${n} rows — the source layout is not what this adapter expects`);if(!$e(ue(r.shape),ue([l,i])))throw new Error(`import/foreign: ${a} rowSlice yields [${l}, ${i}] but this model expects [${r.shape.join(", ")}]`);return Float32Array.from(e.data.subarray(o*i,(o+l)*i))}}}function Ya(r,e){const t=new Map;for(const l of e){const s=br(l.name);t.set(s,{...l,name:s})}const a=new Map,n=[],i=new Set;for(const l of r.rules){if(a.has(l.target))throw new Error(`import/foreign: plan "${r.adapter}" defines "${l.target}" twice`);if(l.from.length===0){if(l.op.kind!=="fill")throw new Error(`import/foreign: rule for "${l.target}" names no source but is not a fill rule`);a.set(l.target,St(l,null)),n.push({target:l.target,value:l.op.value,reason:l.note??"this architecture has no corresponding tensor"});continue}const s=l.from.map(h=>t.get(h)).find(h=>h!=null);if(!s)throw new Error(`import/foreign: checkpoint is missing "${l.from[0]}" (needed for "${l.target}", expected shape [${l.shape.join(", ")}])`+(l.from.length>1?`; also tried ${l.from.slice(1).map(h=>`"${h}"`).join(", ")}`:""));i.add(s.name),a.set(l.target,St(l,s))}const o=[...t.keys()].filter(l=>!i.has(l)).sort();return{adapter:r.adapter,weights:a,unmappedSources:o,synthesisedTargets:n,discardedSources:r.discards}}const Dt="codestral_mamba",Qa=["backbone.embeddings.weight","backbone.embedding.weight"];function Za(r){const{vocabSize:e,dModel:t,numLayers:a,dInner:n,dState:i,dConv:o,nHeads:l,nGroups:s}=r,h=n+2*s*i,u=h+l,d=[{target:"embedding",shape:[e,t],from:Qa,op:{kind:"copy"}}];for(let c=0;c<a;c++){const f=`backbone.layers.${c}.mixer`,g=`layer${c}`;d.push({target:`${g}.wInProj`,shape:[u,t],from:[`${f}.in_proj.weight`],op:{kind:"rowSlice",start:n,count:u},note:"upstream rows are [gate, x, B, C, dt]; this block has no gate branch"},{target:`${g}.wConv`,shape:[h,o],from:[`${f}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [conv_dim, 1, d_conv] → [conv_dim, d_conv] with the tap axis reversed"},{target:`${g}.bConv`,shape:[h],from:[`${f}.conv1d.bias`],op:{kind:"copy"}},{target:`${g}.A_log`,shape:[l],from:[`${f}.A_log`],op:{kind:"negExpToSoftplusInv"},note:"upstream A = -exp(A_log); this engine's SSD kernel uses A = -softplus(A_log)"},{target:`${g}.dt_bias`,shape:[l],from:[`${f}.dt_bias`],op:{kind:"copy"}},{target:`${g}.D_vec`,shape:[l],from:[`${f}.D`],op:{kind:"copy"}},{target:`${g}.wOutProj`,shape:[t,n],from:[`${f}.out_proj.weight`],op:{kind:"copy"}},{target:`${g}.normWeight`,shape:[n],from:[`${f}.norm.weight`],op:{kind:"copy"},note:"upstream this gain belongs to a GATED RMSNorm; applied ungated here"},{target:`${g}.preNormWeight`,shape:[t],from:[`backbone.layers.${c}.norm.weight`],op:{kind:"copy"}})}return d.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),d}function Ja(r){const e=[];for(let t=0;t<r.numLayers;t++)e.push({source:`backbone.layers.${t}.mixer.in_proj.weight`,elements:r.dInner*r.dModel,reason:"the leading d_inner gate (z) rows — Mamba2Block computes norm(y) rather than norm(y * silu(z)), so it has no gate branch to receive them"});return e}const ei={id:Dt,label:"Codestral-Mamba (Mamba-2 / SSD)",modelTypes:["mamba2"],architectures:["Mamba2ForCausalLM","MambaCodestralForCausalLM"],describe(r){const e=ce(r,"hidden_size"),t=ce(r,"num_hidden_layers"),a=ce(r,"vocab_size"),n=ce(r,"state_size"),i=ce(r,"conv_kernel"),o=ce(r,"num_heads"),l=We(r,["n_groups"])??1,s=We(r,["chunk_size"])??256,h=gn(r,e),u=mn(h,e,"Codestral-Mamba"),d=We(r,["head_dim"]);if(h%o!==0)throw new Error(`import/foreign: Codestral-Mamba d_inner ${h} is not divisible by num_heads ${o}`);if(d!==void 0&&d*o!==h)throw new Error(`import/foreign: Codestral-Mamba config is inconsistent — head_dim ${d} × num_heads ${o} = ${d*o}, but d_inner is ${h}`);const c=Array.from({length:t},()=>({type:"mamba2"})),f={vocabSize:a,dModel:e,numLayers:t,layers:c,dState:n,dConv:i,expand:u,nHeads:o,nGroups:l,chunkLen:s},g={vocabSize:a,dModel:e,numLayers:t,dInner:h,dState:n,dConv:i,nHeads:o,nGroups:l};return{modelConfig:f,plan:{adapter:Dt,rules:Za(g),discards:Ja(g)}}}},Ke=[pn,_n,ei];function ti(r){const e=r.architectures;return Array.isArray(e)?e.filter(t=>typeof t=="string"):[]}function ri(r){const e=r.model_type;return typeof e=="string"?e:void 0}function ni(r,e){const t=[...r,e??""].join(" ").toLowerCase();return t.includes("mamba")||t.includes("ssm")?!1:/llama|mistral|qwen|gpt|phi|gemma|falcon(?!_?mamba)|starcoder|deepseek|olmo|attention|forcausallm/.test(t)}function Et(){return Ke.map(r=>`${r.label} — architectures ${r.architectures.join(" / ")}, model_type ${r.modelTypes.join(" / ")}`).join("; ")}function ai(r){const e=ti(r),t=ri(r),a=Ke.find(o=>e.some(l=>o.architectures.includes(l)));if(a)return a;const n=t?Ke.find(o=>o.modelTypes.includes(t)):void 0;if(n)return n;const i=e.length>0?`architectures [${e.join(", ")}]`:t?`model_type "${t}"`:"a config declaring neither `architectures` nor `model_type`";throw ni(e,t)?new Error(`import/foreign: ${i} is a TRANSFORMER checkpoint — its attention weights (q/k/v/o projections, positional embeddings) have no counterpart in a state-space mixer, so no weight port can exist for it at any tensor naming. Transformer coders (IQuest, NousCoder, Maincoder and the like) can only be brought across by DISTILLATION — train this engine's SSM against the transformer's outputs. Weight porting is supported only for: ${Et()}.`):new Error(`import/foreign: unsupported checkpoint — ${i}. Supported: ${Et()}. A transformer checkpoint cannot be weight-ported at all; distillation is the only route.`)}function ii(r,e){const t=ai(r),{modelConfig:a,plan:n}=t.describe(r);return{...Ya(n,e),modelConfig:a}}function _s(r,e){return ii(r,bn(e))}function bs(r,e){const t=r.parameters(),a=new Set(t.map(i=>i.name)),n=[...e.weights.keys()].filter(i=>!a.has(i));if(n.length>0)throw new Error(`import/foreign: ported tensors ${n.slice(0,5).map(i=>`"${i}"`).join(", ")}${n.length>5?` (+${n.length-5} more)`:""} have no parameter on this model — build it from the port's modelConfig`);for(const i of t){const o=e.weights.get(i.name);if(!o)throw new Error(`import/foreign: no ported tensor for parameter "${i.name}" — the model was built from a different config than the port's modelConfig`);if(o.length!==i.numel)throw new Error(`import/foreign: parameter "${i.name}" expects ${i.numel} elements, the port produced ${o.length}`);ge(r.device,i.buf,o)}}function Le(r){throw new Error(`import/foreign: cannot read a Mamba-1 config from these tensors — ${r}`)}function ws(r){const e=new Map(r.map(p=>[br(p.name),p])),t=p=>e.get(p)?.shape,a=t("backbone.embeddings.weight")??t("backbone.embedding.weight");(!a||a.length!==2)&&Le("no backbone.embedding(s).weight [vocab, d_model]");const[n,i]=a;let o=0;for(;e.has(`backbone.layers.${o}.mixer.in_proj.weight`);)o++;o===0&&Le("no backbone.layers.N.mixer.in_proj.weight");const l="backbone.layers.0.mixer",s=t(`${l}.in_proj.weight`),h=t(`${l}.conv1d.weight`),u=t(`${l}.A_log`),d=t(`${l}.x_proj.weight`);(!h||!u||!d)&&Le("layer 0 is missing conv1d.weight, A_log or x_proj.weight");const c=s[0]/2,f=u[1],g=h[h.length-1],m=d[0]-2*f;return(!Number.isInteger(c)||m<=0)&&Le(`inconsistent shapes (in_proj ${s.join("×")}, x_proj ${d.join("×")})`),{model_type:"mamba",architectures:["MambaForCausalLM"],vocab_size:n,hidden_size:i,num_hidden_layers:o,intermediate_size:c,state_size:f,conv_kernel:g,time_step_rank:m}}function ys(r,e,t={}){if(!Number.isInteger(e)||e<=0)throw new Error(`import/foreign: vocabulary size must be a positive integer, got ${e}`);const a=r.modelConfig.vocabSize;if(e===a)return r;const n=r.weights.get("embedding");if(!n)throw new Error('import/foreign: the port has no "embedding" to resize');const i=r.modelConfig.dModel,o=new Float32Array(e*i);o.set(n.subarray(0,Math.min(a,e)*i));const l=[...r.synthesisedTargets];if(e>a){const h=t.std??.02,u=new ve(t.seed??1);o.set(le((e-a)*i,h,()=>u.next()),a*i),l.push({target:"embedding",value:h,reason:`rows ${a}..${e-1} drawn from N(0, ${h}²) to reach a ${e}-token vocabulary`})}const s=new Map(r.weights);return s.set("embedding",o),{...r,weights:s,synthesisedTargets:l,modelConfig:{...r.modelConfig,vocabSize:e}}}const oi=`

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
`,vs=`

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
`,xs={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},wr={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},yr=8,ne=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],si=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],st=[0,.2,.5,.5,.8,.5,.7,.5];function Te(r,e){const t=si[r];return t?Number.isNaN(e)?t[0]:Math.max(t[0],Math.min(t[1],e)):e}function ks(r){for(let e=0;e<r.length&&e<yr;e++)r[e]=Te(e,r[e]);return r}function li(){return Float32Array.from(st)}function vr(r){const e={};for(let t=0;t<ne.length;t++)e[ne[t]]=r[t]??0;return e}function di(r){const e=li();for(let t=0;t<ne.length;t++){const a=r[ne[t]];typeof a=="number"&&!Number.isNaN(a)&&(e[t]=Te(t,a))}return e}function ae(r){return((typeof r=="number"&&!Number.isNaN(r)?Math.max(0,Math.min(100,r)):50)-50)/50}function xr(r){const e=vr(st);if(!r)return e;const t=ae(r.openness),a=ae(r.emotionality),n=ae(r.conscientiousness),i=ae(r.extraversion),o=ae(r.regulatoryFocus),l=ae(r.riskTolerance),s=ae(r.grit),h=ae(r.stimulation),u=(d,c)=>{e[d]=Te(wr[d],c)};return u("driveCuriosity",.5+.35*t+.15*h),u("exploration",.4+.3*t+.25*l+.15*o),u("driveCaution",.5+.3*n-.3*l-.2*o+.15*a),u("arousal",.2+.2*a+.1*i),u("driveSocial",.5+.35*i),u("driveEffort",.8+.15*s+.1*n),u("valence",0+.1*o-.1*a),u("attention",.7+.1*n),e}function As(r){return di(xr(r))}function Ue(r,e){return Te(wr[r],e)}function Ve(){return vr(st)}function Ms(r){if(r.length===0)return Ve();const e=Ve();for(const t of ne)e[t]=0;for(const t of r){const a=xr(t);for(const n of ne)e[n]+=a[n]}for(const t of ne)e[t]/=r.length;return e}function Nt(r,e){const t={...r};for(const a of ne){const n=e[a];typeof n=="number"&&!Number.isNaN(n)&&(t[a]=Ue(a,t[a]+n))}return t}const ci=r=>Math.max(0,Math.min(1,r.intensity??.5));function Ls(r){const e=ci(r);switch(r.kind){case"success":return{valence:.5*e,arousal:-.15*e,driveCaution:-.1*e,driveEffort:-.05*e};case"progress":return{valence:.25*e,arousal:.05*e,driveEffort:-.03*e};case"error":return{valence:-.45*e,arousal:.4*e,driveCaution:.3*e,attention:.15*e};case"blocked":return{valence:-.35*e,arousal:.3*e,driveEffort:-.15*e,driveSocial:.2*e};case"risk":return{arousal:.35*e,driveCaution:.4*e,attention:.2*e,exploration:-.15*e};case"feedback":{const t=Math.sign(r.sign??1)||1;return{valence:.4*e*t,arousal:.1*e,driveSocial:.1*e}}case"idle":return{arousal:-.2*e,driveEffort:.15*e};default:return{}}}function Ss(r,e,t={}){const a=t.rate??.1,n=t.fatigue??0,i={...r};for(const o of ne)i[o]=Ue(o,i[o]+a*(e[o]-i[o]));return n>0&&(i.driveEffort=Ue("driveEffort",i.driveEffort-n)),i}function ui(r,e=.5){const t=r.arousal-e,a=1-2.8*t*t;return Math.max(.1,Math.min(1,a))}function Xe(r){let e=.5*r.exploration+.3*r.driveCuriosity;return e+=.15*r.valence,e-=.25*(1-r.driveEffort),e-=.2*(r.driveCaution-.5),Math.max(0,Math.min(1,e))}function Ds(r,e){if(e.length===0)return{choice:null,exploreBias:Xe(r)};const t=Xe(r);let a=e[0],n=-1/0;for(const i of e){const o=Math.max(0,Math.min(1,i.novelty)),l=-Math.abs(o-t);l>n&&(n=l,a=i)}return{choice:a,exploreBias:t}}const Re=.6,ze=.4;function hi(r){const e=[],t={},a=s=>{t.thinkLevel!=="high"&&(t.thinkLevel=s)};r.valence<=-.4?(e.push("Affect (negative): recent steps have gone badly — slow down, avoid rash or destructive actions, and re-verify your assumptions before proceeding."),a("high"),t.reasoningLevel="on"):r.valence>=.4&&e.push("Affect (positive): things are going well — keep momentum, but don't get sloppy."),r.arousal>=.7?(e.push("Arousal (heightened): you are highly activated — resist the urge to rush; double-check before any irreversible step."),a("high")):r.arousal<=.15&&e.push("Arousal (low): this is routine — keep it lightweight and efficient."),r.driveCaution>=Re?(e.push("Drive (caution): heightened — prefer reversible steps, add guardrails, and confirm risky or destructive operations."),a("medium")):r.driveCaution<=ze&&e.push("Drive (caution): relaxed — bias to action on low-risk work."),r.driveCuriosity>=Re&&e.push("Drive (curiosity): high — it is appropriate to investigate and consider alternative approaches."),r.driveEffort<=ze&&e.push("Drive (effort): energy is low — keep scope tight, avoid over-engineering, checkpoint progress, and consider escalating rather than grinding."),r.driveSocial>=Re?e.push("Drive (social): communicate proactively — surface progress and ask for input when blocked."):r.driveSocial<=ze&&e.push("Drive (social): work heads-down — narrate only what matters."),ui(r)<=.5&&(e.push("Attention (degraded): your attention gate is low — re-read the task carefully and do not skip verification steps."),a("medium"));const i=Xe(r);i>=.7?e.push("Action selection: lean exploratory — try a novel approach before settling on the obvious one."):i<=.3&&e.push("Action selection: lean exploitative — use the proven, known approach and avoid unnecessary detours.");let o=0;o+=.2*(r.exploration-.5)*2,o+=.06*(r.driveCuriosity-.5)*2,o+=.08*r.valence,o-=.16*(r.driveCaution-.5)*2,o-=.08*Math.max(0,r.arousal-.7);const l=Math.max(-.3,Math.min(.3,Math.round(o*100)/100));return Math.abs(l)>=.02&&(t.temperatureDelta=l),{directives:e,params:t}}const fi="Current affective state (execute accordingly):";function Es(r){if(!r)return"";const{directives:e}=hi(r);return e.length===0?"":[fi,...e.map(t=>`- ${t}`)].join(`
`)}const gi=/\b(delete|drop|truncate|destroy|wipe|prod(uction)?|migrat|secret|credential|password|payment|billing|charge|refund|deploy|force[- ]?push|rm\s+-rf|irreversible|security|auth|breaking)\b/i,mi=/\b(refactor|rewrite|architecture|complex|large|entire|whole|across|end[- ]to[- ]end|overhaul)\b/i;function Ns(r,e=Ve()){const t=r||"";let a=e;return gi.test(t)&&(a=Nt(a,{driveCaution:.3,arousal:.25,attention:.15,exploration:-.1})),mi.test(t)&&(a=Nt(a,{driveCuriosity:.2,arousal:.1,exploration:.1})),a}const pi={inputDim:32,hiddenDim:16,stateDim:yr,rewardWeight:.5},Ct=1280131651,_i=296863214;class Cs{config;win;ws;aLogit;woutState;boutState;woutReward;boutReward;gWin;gWs;gALogit;gWoutState;gBoutState;gWoutReward;gBoutReward;constructor(e={}){const t={...pi,...e};if(t.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${t.hiddenDim})`);this.config=t;const{inputDim:a,hiddenDim:n,stateDim:i}=t,o=new ve((e.seed??_i)>>>0||1),l=h=>{const u=Math.max(o.next(),1e-12),d=o.next();return h*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*d)},s=(h,u)=>{const d=new Float32Array(h);for(let c=0;c<h;c++)d[c]=l(u);return d};this.win=s(n*a,.1),this.ws=s(n*i,.1),this.aLogit=s(n,.05),this.woutState=s(i*n,.05),this.boutState=new Float32Array(i),this.woutReward=s(n,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(e,t,a){const n=this._forwardCached(e,t,a);return{hidden:n.hn,delta:n.delta,reward:n.reward}}_forwardCached(e,t,a){const{inputDim:n,hiddenDim:i,stateDim:o}=this.config,l=Float32Array.from({length:n},(m,p)=>e[p]??0),s=Float32Array.from({length:i},(m,p)=>t[p]??0),h=Float32Array.from({length:o},(m,p)=>a[p]??0),u=new Float32Array(i),d=new Float32Array(i),c=new Float32Array(i);for(let m=0;m<i;m++){let p=0;const _=m*n;for(let w=0;w<n;w++)p+=this.win[_+w]*l[w];const b=m*o;for(let w=0;w<o;w++)p+=this.ws[b+w]*h[w];u[m]=xe(this.aLogit[m]),d[m]=Math.tanh(p),c[m]=u[m]*s[m]+(1-u[m])*d[m]}const f=new Float32Array(o);for(let m=0;m<o;m++){let p=this.boutState[m];const _=m*i;for(let b=0;b<i;b++)p+=this.woutState[_+b]*c[b];f[m]=Math.tanh(p)}let g=this.boutReward[0];for(let m=0;m<i;m++)g+=this.woutReward[m]*c[m];return{x:l,sPrev:h,hPrev:s,a:u,t:d,hn:c,delta:f,reward:g}}backwardStep(e,t,a,n,i){const{inputDim:o,hiddenDim:l,stateDim:s,rewardWeight:h}=this.config,u=this._forwardCached(e,t,a);let d=0;const c=new Float32Array(s);for(let p=0;p<s;p++){const _=u.delta[p]-(n[p]??0);d+=.5*_*_,c[p]=_}const f=u.reward-i;d+=.5*h*f*f;const g=h*f,m=new Float32Array(l);for(let p=0;p<s;p++){const _=c[p]*(1-u.delta[p]*u.delta[p]);this.gBoutState[p]=this.gBoutState[p]+_;const b=p*l;for(let w=0;w<l;w++)this.gWoutState[b+w]=this.gWoutState[b+w]+_*u.hn[w],m[w]=m[w]+_*this.woutState[b+w]}this.gBoutReward[0]=this.gBoutReward[0]+g;for(let p=0;p<l;p++)this.gWoutReward[p]=this.gWoutReward[p]+g*u.hn[p],m[p]=m[p]+g*this.woutReward[p];for(let p=0;p<l;p++){const _=u.a[p],b=u.t[p];this.gALogit[p]=this.gALogit[p]+m[p]*(u.hPrev[p]-b)*_*(1-_);const w=m[p]*(1-_)*(1-b*b),v=p*o;for(let S=0;S<o;S++)this.gWin[v+S]=this.gWin[v+S]+w*u.x[S];const L=p*s;for(let S=0;S<s;S++)this.gWs[L+S]=this.gWs[L+S]+w*u.sPrev[S]}return{loss:d,hidden:u.hn}}exportWeights(e={}){const t=e.fp16??!1,a=this.parameters(),n=a.reduce((u,d)=>u+d.numel,0),i=5,o=i*4,l=t?n*2:n*4,s=new ArrayBuffer(o+l),h=new Uint32Array(s,0,i);if(h[0]=Ct,h[1]=t?2:1,h[2]=this.config.inputDim,h[3]=this.config.hiddenDim,h[4]=this.config.stateDim,t){const u=new Float32Array(n);let d=0;for(const f of a)u.set(f.data,d),d+=f.numel;const c=Gt(u);new Uint16Array(s,o,n).set(c)}else{const u=new Float32Array(s,o,n);let d=0;for(const c of a)u.set(c.data,d),d+=c.numel}return s}loadWeights(e){const t=new Uint32Array(e,0,5);if(t[0]!==Ct)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const a=t[1],n=t[2],i=t[3],o=t[4];if(n!==this.config.inputDim||i!==this.config.hiddenDim||o!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${n}/${i}/${o} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const l=this.parameters(),s=l.reduce((c,f)=>c+f.numel,0),h=20;let u;a===2?u=Ut(new Uint16Array(e,h,s)):u=new Float32Array(e.slice(h,h+s*4));let d=0;for(const c of l)c.data.set(u.subarray(d,d+c.numel)),d+=c.numel}}const bi=48;function wi(r,e){const t=new ArrayBuffer(bi);return new Uint32Array(t,0,1).set([r]),new Float32Array(t,4,8).set([e.lr,e.beta1,e.beta2,e.eps,e.weightDecay,e.beta1_t,e.beta2_t,e.maxDelta]),t}class kr{label;head;device;_moments=null;_step=0;_skippedNonFinite=0;_adamwPipeline;constructor(e,t=null,a="HeadTrainer"){this.label=a,this.head=e,this.device=t,this._adamwPipeline=t?H(t,oi,"adamw_update"):null}get skippedNonFinite(){return this._skippedNonFinite}get diverged(){return this._skippedNonFinite>0}get gpuTraining(){return this.device!=null&&this._adamwPipeline!=null}_initMoments(){this._moments||(this._moments=this.head.parameters().map(e=>({m:new Float32Array(e.numel),v:new Float32Array(e.numel)})))}async train(e,t={}){if(e.length===0)throw new Error(`${this.label}.train: no samples`);const{learningRate:a=.05,epochs:n=50,weightDecay:i=0,beta1:o=.9,beta2:l=.999,eps:s=1e-8,maxGradNorm:h=1,onEpochEnd:u=null}=t;this._initMoments();const d=[];for(let c=0;c<n;c++){this.head.zeroGrad();let f=0;for(const L of e)f+=this.head.accumulate(L);const g=this.head.gradients(),m=1/e.length;for(const L of g)for(let S=0;S<L.data.length;S++)L.data[S]*=m;const p=vi(g,h);this._step++;const _=Math.pow(o,this._step),b=Math.pow(l,this._step),w={lr:a,weightDecay:i,beta1:o,beta2:l,eps:s,beta1_t:_,beta2_t:b,maxDelta:0};this.gpuTraining?await this._adamwStepGpu(g,w):this._adamwStepCpu(g,w);const v=f/e.length;d.push(v),u&&u(c+1,v,p)}return d}evaluate(e){if(e.length===0)return 0;let t=0;for(const a of e)t+=this.head.loss(a);return t/e.length}_adamwStepCpu(e,t){const a=this.head.parameters();for(let n=0;n<a.length;n++){const i=this._moments[n];this._skippedNonFinite+=Se(a[n].data,e[n].data,i.m,i.v,t)}}async _adamwStepGpu(e,t){const a=this.device,n=this._adamwPipeline,i=this.head.parameters();for(let o=0;o<i.length;o++){const l=i[o],s=this._moments[o];this._skippedNonFinite+=yi(e[o].data);const h=Q(a,l.data,!0),u=Q(a,e[o].data,!1),d=Q(a,s.m,!0),c=Q(a,s.v,!0),f=$(a,wi(l.numel,t)),g=I(a,n,[f,h,u,d,c]);W(a,n,g,[P(l.numel,256),1,1]),l.data.set((await ie(a,h,l.numel*4)).subarray(0,l.numel)),s.m.set((await ie(a,d,l.numel*4)).subarray(0,l.numel)),s.v.set((await ie(a,c,l.numel*4)).subarray(0,l.numel)),h.destroy(),u.destroy(),d.destroy(),c.destroy(),f.destroy()}}}function yi(r){let e=0;for(let t=0;t<r.length;t++)Number.isFinite(r[t])||e++;return e}function vi(r,e){let t=0,a=0;for(const i of r)for(let o=0;o<i.data.length;o++){const l=i.data[o]*i.data[o];t+=l,Number.isFinite(l)&&(a+=l)}const n=Math.sqrt(a);if(n>e&&n>0){const i=e/n;for(const o of r)for(let l=0;l<o.data.length;l++)o.data[l]*=i}return Math.sqrt(t)}function Ar(r){const e=new Float32Array(r.reduce((a,n)=>a+n.numel,0));let t=0;for(const a of r)e.set(a.data,t),t+=a.numel;return e}function Mr(r,e){const t=r.reduce((n,i)=>n+i.numel,0);if(e.length!==t)throw new Error(`assignParams: expected ${t} values, got ${e.length}`);let a=0;for(const n of r){for(let i=0;i<n.numel;i++)n.data[i]=e[a+i];a+=n.numel}}function xi(r){return{parameters:()=>r.parameters(),gradients:()=>r.gradients(),zeroGrad:()=>r.zeroGrad(),accumulate:e=>r.backwardStep(e.input,r.initHidden(),e.state,e.deltaTarget,e.reward).loss,loss:e=>{const{rewardWeight:t}=r.config,a=r.forward(e.input,r.initHidden(),e.state);let n=0;for(let o=0;o<a.delta.length;o++){const l=a.delta[o]-(e.deltaTarget[o]??0);n+=.5*l*l}const i=a.reward-e.reward;return n+=.5*t*i*i,n}}}class Fs{model;device;_trainer;constructor(e,t=null){this.model=e,this.device=t,this._trainer=new kr(xi(e),t,"LimbicTrainer")}get gpuTraining(){return this._trainer.gpuTraining}train(e,t={}){return this._trainer.train(e,t)}evaluate(e){return this._trainer.evaluate(e)}}const ki={kind:"regress",id:"limbic.affect",description:"How an experience moves the agent's affective state, and how rewarding it was.",features:{numeric:r=>[...Array.from(r.embedding),...Array.from(r.state)]},engines:[{tier:"local",engine:"head",head:"mlp"}],train:{minSamples:1,trainedBy:"LimbicTrainer"},output:{decode:r=>({delta:Float32Array.from(r.scores.slice(0,-1)),reward:r.scores[r.scores.length-1]??0})}};function Ps(r){const{inputDim:e,stateDim:t}=r.config;return{predict(a){if(a.length!==e+t)throw new Error(`limbic.affect: expected ${e+t} features (embedding ${e} + state ${t}), got ${a.length}`);const n=r.forward(a.subarray(0,e),r.initHidden(),a.subarray(e));return{scores:[...Array.from(n.delta),n.reward],confidence:1}},exportParams:()=>Ar(r.parameters()),importParams:a=>Mr(r.parameters(),a)}}const Ts=`

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
`;function Ai(){const r=new Uint8Array(8);return globalThis.crypto.getRandomValues(r),Array.from(r,e=>e.toString(16).padStart(2,"0")).join("")}const Mi=new Set(["send","submit","pay","purchase","buy","order","checkout","delete","remove","confirm","transfer","publish","post","sign","approve","book","cancel","erase","wipe","format","uninstall","senden","absenden","bezahlen","kaufen","bestellen","löschen","entfernen","bestätigen","überweisen","veröffentlichen","enviar","pagar","comprar","pedido","eliminar","borrar","confirmar","transferir","publicar","envoyer","payer","acheter","commander","supprimer","confirmer","virement","publier"]),Li=["发送","提交","支付","付款","购买","下单","删除","确认","转账","发布"];function Ft(r){const e=r.toLowerCase();return Li.some(t=>e.includes(t))?!0:e.split(/[^\p{L}\p{N}]+/u).some(t=>t.length>0&&Mi.has(t))}function oe(r){return r?r.name.trim()||r.automationId.trim():""}function Si(r){switch(r.kind){case"click":return Ft(oe(r.target));case"keys":return r.keys.toLowerCase()==="enter"&&Ft(oe(r.target));case"setValue":return!1}}function Bs(r,e={},t=Date.now()){const a=new Set(e.removed??[]),n=new Set(e.fixed??[]),i=[],o=[];for(const l of r.steps){if(a.has(l.id))continue;const s=l.action;let h;if(s.kind==="setValue")if(!s.secret&&n.has(l.id))h={kind:"setValue",target:s.target,value:{from:"literal",text:s.value}};else{const d=Pt(e.paramNames?.[l.id]??"")||Pt(oe(s.target))||"value",c=Di(i,d);i.push({name:c,label:oe(s.target),default:s.secret?null:s.value,secret:!!s.secret}),h={kind:"setValue",target:s.target,value:{from:"param",name:c}}}else h=s;o.push({id:l.id,action:h,requiresApproval:e.approvals?.[l.id]??Si(s),screenshot:l.screenshot??null})}return{id:Ai(),name:e.name?.trim()||r.name,program:r.program,args:[...r.args],params:i,steps:o,sourceEpisode:r.id,createdAt:t,routine:null}}function Pt(r){return r.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join("_").slice(0,40).replace(/_+$/,"")}function Di(r,e){if(!r.some(t=>t.name===e))return e;for(let t=2;;t++){const a=`${e}_${t}`;if(!r.some(n=>n.name===a))return a}}const Oe=6e4,He=864e5;function Ei(r,e,t,a){if(r.every==="minutes"){const s=Math.max(1,r.minutes)*Oe;return e==null||t-e>=s}const n=a*Oe,i=t+n,l=i-(i%He+He)%He+Math.min(23,Math.max(0,r.hour))*36e5+Math.min(59,Math.max(0,r.minute))*Oe;return i>=l&&(e==null||e+n<l)}function Is(r,e,t){return r.filter(a=>a.routine?.enabled&&Ei(a.routine.schedule,a.routine.lastRunAt,e,t)).sort((a,n)=>(a.routine?.lastRunAt??0)-(n.routine?.lastRunAt??0))}function he(r){const e="target"in r&&r.target?r.target.windowTitle:"";return e?` in “${e}”`:""}function Lr(r){switch(r.kind){case"click":return`Click “${oe(r.target)}”${he(r)}.`;case"keys":return r.target?`Press ${r.keys} in “${oe(r.target)}”${he(r)}.`:`Press ${r.keys}.`;case"setValue":{const e=`“${oe(r.target)}”`;return typeof r.value=="string"?"secret"in r&&r.secret?`Enter the secret for ${e}${he(r)}.`:`Set ${e} to “${r.value}”${he(r)}.`:r.value.from==="param"?`Set ${e} to <${r.value.name}>${he(r)}.`:`Set ${e} to “${r.value.text}”${he(r)}.`}}}function Sr(r){return r.split(/[\\/]/).pop()??r}function Ni(r){const e=[`Task: ${r.name} (${Sr(r.program)})`];return r.steps.forEach((t,a)=>e.push(`${a+1}. ${Lr(t.action)}${t.requiresApproval?" Ask before doing this.":""}`)),e.join(`
`)}function Ci(r){const e=[`Task: ${r.name} (${Sr(r.program)})`];return r.steps.forEach((t,a)=>e.push(`${a+1}. ${Lr(t.action)}`)),e.join(`
`)}function Ws(r,e){return lt(r,e).map(t=>t.text).join(`

`)}function lt(r,e){const t=new Set(e.map(a=>a.sourceEpisode));return[...e.map(a=>({id:a.id,text:Ni(a)})),...r.filter(a=>!t.has(a.id)).map(a=>({id:a.id,text:Ci(a)}))]}function js(r,e){const t=[];let a=[],n=0;for(const i of r){const o=a.length?i.text.length+2:i.text.length;if(a.length&&n+o>e){t.push(a),a=[],n=0,a.push(i),n=i.text.length;continue}a.push(i),n+=o}return a.length&&t.push(a),t}const Fi=864e5;function Tt(r,e){return new Date(r+e*6e4).toISOString().slice(0,10)}function $s(r,e){const t=f=>{const g=r.learned[f];return typeof g=="number"&&g>=1&&g<=e.modelIndex},a=lt(r.episodes,r.skills),n=a.filter(f=>t(f.id)).length,i={running:0,succeeded:0,failed:0,stopped:0,denied:0},o={approved:0,denied:0},l=[];for(const f of r.episodes)l.push({region:"hippocampus",kind:"demonstration",id:f.id,name:f.name,at:f.startedAt});for(const f of r.skills)l.push({region:"basalGanglia",kind:"skill",id:f.id,name:f.name,at:f.createdAt});for(const f of r.runs){i[f.status]=(i[f.status]??0)+1,l.push({region:"basalGanglia",kind:"run",id:f.id,name:f.skillName,at:f.startedAt,detail:f.status});for(const g of f.steps)g.outcome!=="approved"&&g.outcome!=="denied"||(o[g.outcome]++,l.push({region:"amygdala",kind:"approval",id:f.id,name:f.skillName,at:g.at,detail:g.outcome}))}const s=r.adaptations.filter(f=>f.index<=e.modelIndex).reverse();for(const f of s)l.push({region:"neocortex",kind:"adaptation",id:f.version,name:f.version,at:f.at,detail:f.loss.toFixed(3)});const h=Math.max(1,e.days??30),u=[],d=new Map;for(let f=h-1;f>=0;f--){const g=Tt(e.now-f*Fi,e.utcOffsetMinutes);if(d.has(g))continue;const m={day:g,demonstrations:0,skills:0,runs:0,learned:0};d.set(g,m),u.push(m)}const c=(f,g,m=1)=>{const p=d.get(Tt(f,e.utcOffsetMinutes));p&&(p[g]+=m)};for(const f of r.episodes)c(f.startedAt,"demonstrations");for(const f of r.skills)c(f.createdAt,"skills");for(const f of r.runs)c(f.startedAt,"runs");for(const f of s)c(f.at,"learned",f.learned.length);return{regions:{hippocampus:r.episodes.length,basalGanglia:r.skills.length,amygdala:o.approved+o.denied,hypothalamus:r.skills.filter(f=>f.routine?.enabled).length,neocortex:n},learned:n,pending:a.length-n,runs:i,approvals:o,adaptations:s,days:u,recent:l.sort((f,g)=>g.at-f.at).slice(0,Math.max(0,e.recent??40))}}const Ye="evermind.experience/1",Pi=500,Ti=200;function Qe(){return{schema:Ye,episodes:[],skills:[],runs:[],learned:{},adaptations:[],curated:{}}}function Bt(r){const e=r;return!e||e.schema!==Ye?Qe():{schema:Ye,episodes:Array.isArray(e.episodes)?e.episodes:[],skills:Array.isArray(e.skills)?e.skills:[],runs:Array.isArray(e.runs)?e.runs:[],learned:e.learned&&typeof e.learned=="object"&&!Array.isArray(e.learned)?e.learned:{},adaptations:Array.isArray(e.adaptations)?e.adaptations:[],curated:e.curated&&typeof e.curated=="object"&&!Array.isArray(e.curated)?e.curated:{}}}function Bi(r){return{id:r.id,name:r.name,program:r.program,startedAt:r.startedAt,steps:r.steps.length}}class fe{onChange;data;constructor(e,t){this.onChange=t,this.data=e?Bt(e):Qe()}load(e){this.data=Bt(e)}async changed(){await this.onChange?.(this.data)}static upsert(e,t){const a=e.findIndex(n=>n.id===t.id);a>=0?e[a]=t:e.push(t)}static remove(e,t){const a=e.findIndex(n=>n.id===t);return a<0?!1:(e.splice(a,1),!0)}async putEpisode(e){fe.upsert(this.data.episodes,e),await this.changed()}async getEpisode(e){return this.data.episodes.find(t=>t.id===e)}async listEpisodes(){return[...this.data.episodes].sort((e,t)=>t.startedAt-e.startedAt).map(Bi)}async deleteEpisode(e){const t=fe.remove(this.data.episodes,e);return delete this.data.learned[e],delete this.data.curated[e],t&&await this.changed(),t}async putSkill(e){fe.upsert(this.data.skills,e),await this.changed()}async getSkill(e){return this.data.skills.find(t=>t.id===e)}async listSkills(){return[...this.data.skills].sort((e,t)=>t.createdAt-e.createdAt)}async deleteSkill(e){const t=fe.remove(this.data.skills,e);return delete this.data.learned[e],delete this.data.curated[e],t&&await this.changed(),t}async putRun(e){fe.upsert(this.data.runs,e),this.data.runs.sort((t,a)=>a.startedAt-t.startedAt),this.data.runs.length=Math.min(this.data.runs.length,Pi),await this.changed()}async appendRunStep(e,t){const a=this.data.runs.find(n=>n.id===e);return a?(a.steps.push(t),await this.changed(),!0):!1}async getRun(e){return this.data.runs.find(t=>t.id===e)}async listRuns(e){return this.data.runs.slice(0,Math.max(0,e))}async recordAdaptation(e){for(const t of e.learned)this.data.learned[t]=e.index,delete this.data.curated[t];this.data.adaptations.unshift(e),this.data.adaptations.length=Math.min(this.data.adaptations.length,Ti),await this.changed()}async recordCuration(e){for(const t of e.kept)delete this.data.curated[t];Object.assign(this.data.curated,e.dropped),await this.changed()}async snapshot(){return structuredClone(this.data)}async clear(){this.data=Qe(),await this.changed()}}function se(r){switch(r.engine){case"classical":return`local:classical:${r.algorithm}`;case"head":return`local:head:${r.head}`;case"onnx":return`local:onnx:${r.model}`;case"workers-ai":return`cloud:workers-ai:${r.model}`}}class Dr{_tasks=new Map;register(e){if(!wn.test(e.id))throw new Error(`MlTaskRegistry: malformed task id '${e.id}'`);if(this._tasks.has(e.id))throw new Error(`MlTaskRegistry: task '${e.id}' is already registered`);if(e.engines.length===0)throw new Error(`MlTaskRegistry: task '${e.id}' lists no engine`);if(e.kind==="classify"&&!(e.output.labels&&e.output.labels.length>=2))throw new Error(`MlTaskRegistry: classify task '${e.id}' needs at least two output labels`);return this._tasks.set(e.id,e),e}get(e){return this._tasks.get(e)}require(e){const t=this.get(e);if(!t)throw new Error(`MlTaskRegistry: unknown task '${e}'`);return t}has(e){return this._tasks.has(e)}list(){return[...this._tasks.values()]}}async function Er(r,e,t){const a=[];if(r.text){if(!t)throw new Error("extractFeatures: this task embeds text but no embedder was supplied");a.push(await t.embed(r.text(e)))}if(r.numeric){const o=r.numeric(e);for(const l of o)if(!Number.isFinite(l))throw new Error(`extractFeatures: non-finite numeric feature ${l}`);a.push(o)}if(a.length===0)throw new Error("extractFeatures: the feature spec has neither text nor numeric fields");const n=new Float32Array(a.reduce((o,l)=>o+l.length,0));let i=0;for(const o of a)n.set(o,i),i+=o.length;return n}async function Ii(r,e,t){const a=[];for(const n of e)a.push(await Er(r,n,t));return a}class Wi{_m=new Map;get(e,t){return this._m.get(`${e}|${t}`)}set(e,t,a){this._m.set(`${e}|${t}`,a)}}class Rs{capacity;_d=[];constructor(e=500){this.capacity=e}record(e){this._d.push(e),this._d.length>this.capacity&&this._d.splice(0,this._d.length-this.capacity)}list(){return this._d}summary(){const e={},t={};for(const a of this._d){const n=e[a.taskId]??={runs:0,byEngine:{},unanswered:0,meanConfidence:null};if(n.runs++,a.engine==null){n.unanswered++;continue}n.byEngine[a.engine]=(n.byEngine[a.engine]??0)+1;const i=t[a.taskId]??={s:0,n:0};i.s+=a.confidence??0,i.n++,n.meanConfidence=i.s/i.n}return e}}class Nr extends Error{taskId;decision;constructor(e,t){super(`runMlTask(${e}): no engine could answer in '${t.mode}' mode (${t.skipped.map(a=>`${a.engine}: ${a.reason}${a.detail?` (${a.detail})`:""}`).join(", ")||"none allowed"})`),this.taskId=e,this.decision=t,this.name="MlEngineUnavailableError"}}function ji(r,e,t){switch(e){case"local-only":return r.engines.filter(a=>a.tier==="local");case"hybrid":return[...r.engines.filter(a=>a.tier==="local"),...r.engines.filter(a=>a.tier==="cloud")];case"specific":{if(t==null)throw new Error(`runMlTask(${r.id}): 'specific' mode needs ctx.engine`);const a=typeof t=="string"?t:se(t),n=r.engines.filter(i=>se(i)===a);if(n.length===0)throw new Error(`runMlTask(${r.id}): engine '${a}' is not one of this task's engines`);return n}default:{const a=e;throw new Error(`runMlTask(${r.id}): unknown inference mode '${String(a)}'`)}}}const qe=r=>r instanceof Error?r.message:String(r);async function $i(r,e,t){const a=t.registry.require(r),n=ji(a,t.mode,t.engine),i=[];let o=null,l=null,s=null;const h=(d,c)=>(t.decisions?.record({taskId:r,mode:t.mode,engine:se(d),tier:d.tier,confidence:c.confidence,skipped:i}),{output:a.output.decode(c),confidence:c.confidence,engine:d});for(let d=0;d<n.length;d++){const c=n[d],f=se(c);if(c.tier==="local"){const g=t.models?.get(r,f);if(!g){i.push({engine:f,reason:"unavailable"});continue}if(!o&&l==null)try{o=await Er(a.features,e,t.embedder)}catch(_){l=_}if(!o){i.push({engine:f,reason:"error",detail:`features: ${qe(l)}`});continue}let m;try{m=g.predict(o)}catch(_){i.push({engine:f,reason:"error",detail:qe(_)});continue}const p=t.mode==="hybrid"&&!!t.cloud&&n.slice(d+1).some(_=>_.tier==="cloud");if(t.minConfidence!=null&&m.confidence<t.minConfidence&&p){i.push({engine:f,reason:"low-confidence",detail:m.confidence.toFixed(3)}),s??={ref:c,p:m};continue}return h(c,m)}if(!t.cloud){i.push({engine:f,reason:"unavailable"});continue}try{return h(c,await t.cloud.run({taskId:r,engine:c,input:e}))}catch(g){i.push({engine:f,reason:"error",detail:qe(g)})}}if(s)return h(s.ref,s.p);const u={taskId:r,mode:t.mode,engine:null,tier:null,confidence:null,skipped:i};throw t.decisions?.record(u),new Nr(r,u)}function Cr(r,e){const t=Math.min(r.length,e.length);let a=0;for(let n=0;n<t;n++)a+=r[n]*e[n];return a}function It(r){return Math.sqrt(Cr(r,r))}function Ri(r,e){const t=It(r),a=It(e);return t>0&&a>0?Cr(r,e)/(t*a):0}function be(r,e){const t=Math.min(r.length,e.length);let a=0;for(let n=0;n<t;n++){const i=r[n]-e[n];a+=i*i}return a}function Wt(r){if(r.length===0)return Number.NaN;const e=[...r].sort((a,n)=>a-n),t=e.length>>1;return e.length%2?e[t]:(e[t-1]+e[t])/2}function zi(r,e){if(r.length===0)return Number.NaN;const t=[...r].sort((o,l)=>o-l),a=(t.length-1)*Math.min(1,Math.max(0,e)),n=Math.floor(a),i=Math.min(t.length-1,n+1);return t[n]+(a-n)*(t[i]-t[n])}function Ne(r){let e=0;for(const t of r){if(!Number.isInteger(t)||t<0)throw new Error(`class label must be a non-negative integer, got ${t}`);e=Math.max(e,t+1)}return Math.max(e,2)}function ee(r){if(r.length===0)throw new Error("no samples");const e=r[0].length;for(const t of r)if(t.length!==e)throw new Error(`ragged features: expected ${e}, got ${t.length}`);return e}function Ce(r){return r.length?Math.max(...r):0}function Fr(r){const e=new ve(r);return()=>e.next()}function Pr(r){return r<=1?0:r===2?1:2*(Math.log(r-1)+.5772156649)-2*(r-1)/r}class dt{k;metric;classes;_x=[];_y=[];_w=[];constructor(e,t,a){if(this.k=e,this.metric=t,this.classes=a,!(e>=1))throw new Error(`KnnModel: k must be ≥ 1 (got ${e})`)}get size(){return this._x.length}add(e,t=0,a=1){this._x.push(Float32Array.from(e)),this._y.push(t),this._w.push(a)}similarity(e,t){return this.metric==="cosine"?Ri(e,t):1/(1+Math.sqrt(be(e,t)))}neighbours(e,t=this.k,a){const n=[];for(let i=0;i<this._x.length;i++)i!==a&&n.push({index:i,similarity:this.similarity(e,this._x[i])});return n.sort((i,o)=>o.similarity-i.similarity||i.index-o.index),n.slice(0,Math.min(t,n.length))}nearest(e){return this.neighbours(e,1)[0]??null}labelOf(e){return this._y[e]}proba(e,t){const a=new Array(this.classes).fill(0);for(const i of this.neighbours(e,this.k,t)){const o=(this.metric==="cosine"?i.similarity+1:i.similarity)*this._w[i.index]+1e-9;a[this._y[i.index]]+=o}const n=a.reduce((i,o)=>i+o,0);return n>0?a.map(i=>i/n):a.map(()=>1/this.classes)}predict(e){const t=this.proba(e);return{scores:t,confidence:Ce(t)}}excluding(e){if(!(e>=0&&e<this._x.length))throw new Error(`KnnModel.excluding: no point ${e} (size ${this._x.length})`);return{predict:t=>{const a=this.proba(t,e);return{scores:a,confidence:Ce(a)}}}}}function Oi(r,e={}){ee(r.map(i=>i.x));const t=e.classes??Ne(r.map(i=>i.y)),a=e.k??Math.min(5,Math.max(1,Math.floor(Math.sqrt(r.length)))),n=new dt(Math.min(a,r.length),e.metric??"cosine",t);for(const i of r)n.add(i.x,i.y,i.weight??1);return n}class Hi{logPrior;mean;variance;constructor(e,t,a){this.logPrior=e,this.mean=t,this.variance=a}jointLogLikelihood(e){return this.mean.map((t,a)=>{const n=this.variance[a];let i=this.logPrior[a];if(i===-1/0)return i;for(let o=0;o<t.length;o++){const l=(e[o]??0)-t[o];i+=-.5*Math.log(2*Math.PI*n[o])-l*l/(2*n[o])}return i})}predict(e){const t=Array.from(De(this.jointLogLikelihood(e)));return{scores:t,confidence:Ce(t)}}}function qi(r,e={}){const t=ee(r.map(d=>d.x)),a=e.classes??Ne(r.map(d=>d.y)),n=new Float64Array(a),i=Array.from({length:a},()=>new Float64Array(t)),o=Array.from({length:a},()=>new Float64Array(t));for(const d of r){const c=d.weight??1;n[d.y]=n[d.y]+c;for(let f=0;f<t;f++)i[d.y][f]=i[d.y][f]+c*d.x[f]}for(let d=0;d<a;d++)if(n[d]>0)for(let c=0;c<t;c++)i[d][c]=i[d][c]/n[d];for(const d of r){const c=d.weight??1;for(let f=0;f<t;f++){const g=d.x[f]-i[d.y][f];o[d.y][f]=o[d.y][f]+c*g*g}}let l=0;for(let d=0;d<a;d++)for(let c=0;c<t;c++)o[d][c]=n[d]>0?o[d][c]/n[d]:0,l=Math.max(l,o[d][c]);const s=(e.varSmoothing??1e-9)*Math.max(l,1e-12)+1e-12;for(let d=0;d<a;d++)for(let c=0;c<t;c++)o[d][c]=o[d][c]+s;const h=n.reduce((d,c)=>d+c,0);if(!(h>0))throw new Error("fitNaiveBayes: the samples carry no weight");const u=Float64Array.from(n,d=>d>0?Math.log(d/h):-1/0);return new Hi(u,i,o)}function Tr(r,e,t){if(t.length===0||r!=="classify"&&r!=="regress")return null;let a=0,n=0;for(const i of t){const o=i.weight??1,l=e.predict(i.x),s=r==="classify"?-Math.log(Math.max(l.scores[i.y]??0,1e-12)):.5*(l.scores[0]-i.y)**2;a+=o*s,n+=o}return n>0?a/n:null}class jt{weights;intercept;r2;constructor(e,t,a){this.weights=e,this.intercept=t,this.r2=a}value(e){let t=this.intercept;for(let a=0;a<this.weights.length;a++)t+=this.weights[a]*(e[a]??0);return t}predict(e){return{scores:[this.value(e)],confidence:this.r2}}exportParams(){const e=new Float32Array(this.weights.length+1);return e.set(this.weights,0),e[this.weights.length]=this.intercept,e}importParams(e){if(e.length!==this.weights.length+1)throw new Error(`LinearModel.importParams: expected ${this.weights.length+1} values, got ${e.length}`);for(let t=0;t<this.weights.length;t++)this.weights[t]=e[t];this.intercept=e[this.weights.length]}}function Br(r,e,t){for(let n=0;n<t;n++){let i=n;for(let o=n+1;o<t;o++)Math.abs(r[o*t+n])>Math.abs(r[i*t+n])&&(i=o);if(Math.abs(r[i*t+n])<1e-12)throw new Error("solveLinearSystem: singular matrix");if(i!==n){for(let l=0;l<t;l++){const s=r[n*t+l];r[n*t+l]=r[i*t+l],r[i*t+l]=s}const o=e[n];e[n]=e[i],e[i]=o}for(let o=n+1;o<t;o++){const l=r[o*t+n]/r[n*t+n];if(l!==0){for(let s=n;s<t;s++)r[o*t+s]=r[o*t+s]-l*r[n*t+s];e[o]=e[o]-l*e[n]}}}const a=new Float64Array(t);for(let n=t-1;n>=0;n--){let i=e[n];for(let o=n+1;o<t;o++)i-=r[n*t+o]*a[o];a[n]=i/r[n*t+n]}return a}function Gi(r,e={}){const t=ee(r.map(m=>m.x)),a=t+1,n=new Float64Array(a*a),i=new Float64Array(a),o=new Float64Array(a);for(const m of r){const p=m.weight??1;for(let _=0;_<t;_++)o[_]=m.x[_];o[t]=1;for(let _=0;_<a;_++){i[_]=i[_]+p*o[_]*m.y;for(let b=0;b<a;b++)n[_*a+b]=n[_*a+b]+p*o[_]*o[b]}}const l=e.l2??1e-6;for(let m=0;m<t;m++)n[m*a+m]=n[m*a+m]+l;const s=Br(n,i,a),h=new jt(Float32Array.from(s.subarray(0,t)),s[t],0);let u=0,d=0;for(const m of r)u+=m.weight??1,d+=(m.weight??1)*m.y;d/=u;let c=0,f=0;for(const m of r){const p=m.weight??1;c+=p*(m.y-h.value(m.x))**2,f+=p*(m.y-d)**2}const g=f>0?Math.min(1,Math.max(0,1-c/f)):c<1e-12?1:0;return new jt(h.weights,h.intercept,g)}function Ir(r,e){return(r.weight??1)*(e?.[r.y]??1)}class Ki{dim;classes;weights;bias;constructor(e,t){this.dim=e,this.classes=t,this.weights=new Float32Array(t*e),this.bias=new Float32Array(t)}logits(e){const t=[];for(let a=0;a<this.classes;a++){let n=this.bias[a];const i=a*this.dim;for(let o=0;o<this.dim;o++)n+=this.weights[i+o]*(e[o]??0);t.push(n)}return t}proba(e){return Array.from(De(this.logits(e)))}predict(e){const t=this.proba(e);return{scores:t,confidence:Ce(t)}}loss(e){return Tr("classify",this,e)??0}step(e,t,a,n){const i=new Float64Array(this.weights.length),o=new Float64Array(this.classes);let l=0,s=0;for(const u of e){const d=Ir(u,n),c=this.proba(u.x);l+=-d*Math.log(Math.max(c[u.y],1e-12)),s+=d;for(let f=0;f<this.classes;f++){const g=d*(c[f]-(f===u.y?1:0));o[f]=o[f]+g;const m=f*this.dim;for(let p=0;p<this.dim;p++)i[m+p]=i[m+p]+g*u.x[p]}}const h=s>0?1/s:0;for(let u=0;u<this.weights.length;u++)this.weights[u]=this.weights[u]-t*(i[u]*h+a*this.weights[u]);for(let u=0;u<this.classes;u++)this.bias[u]=this.bias[u]-t*o[u]*h;return l*h}exportParams(){const e=new Float32Array(this.weights.length+this.bias.length);return e.set(this.weights,0),e.set(this.bias,this.weights.length),e}importParams(e){if(e.length!==this.weights.length+this.bias.length)throw new Error(`LogisticModel.importParams: expected ${this.weights.length+this.bias.length} values, got ${e.length}`);for(let t=0;t<this.weights.length;t++)this.weights[t]=e[t];for(let t=0;t<this.bias.length;t++)this.bias[t]=e[this.weights.length+t]}}function Ui(r,e={},t){const a=ee(r.map(d=>d.x)),n=e.classes??t?.classes??Ne(r.map(d=>d.y)),i=Ne(r.map(d=>d.y));if(i>n&&r.some(d=>d.y>=n))throw new Error(`fitLogistic: labels go up to ${i-1} but the model has ${n} classes`);const o=t??new Ki(a,n);if(o.dim!==a||o.classes!==n)throw new Error(`fitLogistic: init is ${o.dim}×${o.classes}, data is ${a}×${n}`);const l=e.l2??.001,s=e.classWeights?.findIndex(d=>!Number.isFinite(d)||d<0)??-1;if(s>=0)throw new Error(`fitLogistic: classWeights[${s}] must be a finite number ≥ 0, got ${e.classWeights[s]}`);if(e.solver==="irls"){if(n!==2)throw new Error(`fitLogistic: the irls solver fits two classes, not ${n}`);return Qi(o,r,l,e.classWeights,e.maxIterations??50),o}const h=e.learningRate??.5,u=e.epochs??300;for(let d=0;d<u;d++)o.step(r,h,l,e.classWeights);return o}const Vi=1e-9,Xi=1e-10,Yi=40;function Qi(r,e,t,a,n){const i=t/2,o=r.dim,l=o+1,s=new Float64Array(l);for(let m=0;m<o;m++)s[m]=r.weights[o+m]-r.weights[m];s[o]=r.bias[1]-r.bias[0];const h=e.map(m=>Ir(m,a)),u=h.reduce((m,p)=>m+p,0),d=u>0?1/u:0,c=(m,p)=>{let _=m[o];for(let b=0;b<o;b++)_+=m[b]*p[b];return _},f=m=>{let p=0;e.forEach((b,w)=>{const v=c(m,b.x),L=v>=0?v+Math.log1p(Math.exp(-v)):Math.log1p(Math.exp(v));p+=h[w]*(L-(b.y===1?v:0))});let _=0;for(let b=0;b<o;b++)_+=m[b]*m[b];return p*d+i/2*_};let g=f(s);for(let m=0;m<n;m++){const p=new Float64Array(l),_=new Float64Array(l*l);e.forEach((M,x)=>{const N=xe(c(s,M.x)),C=h[x]*(N-(M.y===1?1:0))*d,O=h[x]*N*(1-N)*d;for(let R=0;R<l;R++){const G=R<o?M.x[R]:1;p[R]=p[R]+C*G;for(let j=0;j<l;j++){const q=j<o?M.x[j]:1;_[R*l+j]=_[R*l+j]+O*G*q}}});for(let M=0;M<l;M++)M<o&&(p[M]=p[M]+i*s[M],_[M*l+M]=_[M*l+M]+i),_[M*l+M]=_[M*l+M]+Vi;const b=Br(_,p,l);let w=0;for(let M=0;M<l;M++)w=Math.max(w,Math.abs(b[M]));const v=w<Xi;let L=1,S=!1;for(let M=0;M<Yi;M++){const x=new Float64Array(l);for(let C=0;C<l;C++)x[C]=s[C]-L*b[C];const N=f(x);if(N<=g+1e-15){s.set(x),g=N,S=!0;break}L/=2}if(!S||v)break}r.weights.fill(0),r.bias.fill(0);for(let m=0;m<o;m++)r.weights[o+m]=s[m];r.bias[1]=s[o]}class $t{centroids;inertia;constructor(e,t){this.centroids=e,this.inertia=t}assign(e){let t=0,a=1/0,n=1/0;return this.centroids.forEach((i,o)=>{const l=be(e,i);l<a?(n=a,a=l,t=o):l<n&&(n=l)}),{cluster:t,d1:a,d2:n}}predict(e){const{cluster:t,d1:a,d2:n}=this.assign(e),i=Number.isFinite(n)&&n>0?1-Math.sqrt(a)/Math.sqrt(n):1;return{scores:[t],confidence:Math.max(0,Math.min(1,i))}}}function Zi(r,e={}){const t=r.map(f=>f.x),a=ee(t),n=Math.min(t.length,Math.max(1,e.k??Math.round(Math.sqrt(t.length/2)))),i=Fr(e.seed??27501),o=[Float32Array.from(t[Math.floor(i()*t.length)])],l=t.map(f=>be(f,o[0]));for(;o.length<n;){const f=l.reduce((p,_)=>p+_,0);let g=0;if(f>0){let p=i()*f,_=-1;for(g=0;g<t.length&&!(l[g]>0&&(_=g,p-=l[g],p<=0));g++);g>=t.length&&(g=_)}else g=o.length;const m=Float32Array.from(t[g]);o.push(m),t.forEach((p,_)=>l[_]=Math.min(l[_],be(p,m)))}const s=new Int32Array(t.length).fill(-1),h=()=>{let f=!1;const g=new $t(o,0);return t.forEach((m,p)=>{const _=g.assign(m).cluster;s[p]!==_&&(s[p]=_,f=!0)}),f},u=e.maxIterations??100;let d=!1;for(let f=0;f<u;f++){if(!h()){d=!0;break}const g=o.map(()=>new Float64Array(a)),m=new Array(n).fill(0);t.forEach((p,_)=>{const b=s[_];m[b]=m[b]+1;for(let w=0;w<a;w++)g[b][w]=g[b][w]+p[w]}),o.forEach((p,_)=>{if(m[_]>0)for(let b=0;b<a;b++)p[b]=g[_][b]/m[_]})}d||h();let c=0;return t.forEach((f,g)=>c+=be(f,o[s[g]])),new $t(o,c)}const Ji=1.4826,eo=1.2533;function Wr(r,e){return typeof r=="number"?r:r[e]??0}class to{center;scale;threshold;constructor(e,t,a){this.center=e,this.scale=t,this.threshold=a}zScores(e){return Array.from(this.center,(t,a)=>Math.abs((e[a]??0)-t)/this.scale[a])}predict(e){const t=Math.max(0,...this.zScores(e))/this.threshold;return{scores:[t],confidence:Be(t)}}}function Be(r){return Math.max(0,Math.min(1,Math.abs(r-1)))}function ct(r,e={}){const t=r.map(s=>s.x),a=ee(t),n=e.minScaleFraction??.01,i=e.minScale??0,o=new Float64Array(a),l=new Float64Array(a);for(let s=0;s<a;s++){const h=t.map(f=>f[s]),u=Wt(h),d=h.map(f=>Math.abs(f-u));let c=Ji*Wt(d);c>0||(c=eo*(d.reduce((f,g)=>f+g,0)/d.length)),o[s]=u,l[s]=Math.max(c,n*Math.abs(u)+1e-9,Wr(i,s))}return new to(o,l,e.threshold??3.5)}class ro{mean;variance;alpha;threshold;minScaleFraction;minScale;constructor(e,t,a,n,i,o=0){if(this.mean=e,this.variance=t,this.alpha=a,this.threshold=n,this.minScaleFraction=i,this.minScale=o,!(a>0&&a<=1))throw new Error(`EwmaModel: alpha must be in (0, 1] (got ${a})`)}zScores(e){return Array.from(this.mean,(t,a)=>{const n=Math.max(Math.sqrt(this.variance[a]),this.minScaleFraction*Math.abs(t)+1e-9,Wr(this.minScale,a));return Math.abs((e[a]??0)-t)/n})}update(e){for(let t=0;t<this.mean.length;t++){const a=(e[t]??0)-this.mean[t],n=this.alpha*a;this.mean[t]=this.mean[t]+n,this.variance[t]=(1-this.alpha)*(this.variance[t]+a*n)}}predict(e){const t=Math.max(0,...this.zScores(e))/this.threshold;return{scores:[t],confidence:Be(t)}}}function ut(r,e={}){const t=ee(r.map(n=>n.x)),a=new ro(Float64Array.from(r[0].x),new Float64Array(t),e.alpha??.3,e.threshold??3,e.minScaleFraction??.01,e.minScale??0);for(let n=1;n<r.length;n++)a.update(r[n].x);return a}function no(r){const e=r.length,t=r[0]?.length??0;if(e===0||t===0)return{means:new Array(t).fill(0),covariance:[],shrinkage:0};const a=new Array(t).fill(0);for(const g of r)for(let m=0;m<t;m++)a[m]+=g[m]/e;const n=r.map(g=>g.map((m,p)=>m-a[p])),i=1/e,o=[];for(let g=0;g<t;g++){o.push(new Array(t).fill(0));for(let m=0;m<t;m++){let p=0;for(let _=0;_<e;_++)p+=n[_][g]*n[_][m];o[g][m]=p*i}}const s=o.reduce((g,m,p)=>g+m[p],0)/t;let h=0;for(let g=0;g<t;g++)for(let m=0;m<t;m++){let p=0;for(let _=0;_<e;_++)p+=(n[_][g]*n[_][m]-(g===m?o[g][g]:o[g][m]))**2;h+=p/e}h*=i*i;let u=0;for(let g=0;g<t;g++)for(let m=0;m<t;m++){const p=g===m?s:0;u+=(o[g][m]-p)**2}const d=Math.min(h,u),c=u>0?d/u:0,f=o.map((g,m)=>g.map((p,_)=>(1-c)*p+(m===_?c*s:0)));return{means:a,covariance:f,shrinkage:c}}function ao(r,e){const t=new Float64Array(e*e);for(let i=0;i<e;i++)for(let o=0;o<=i;o++){let l=r[i*e+o];for(let s=0;s<o;s++)l-=t[i*e+s]*t[o*e+s];if(i===o){if(!(l>0))return null;t[i*e+i]=Math.sqrt(l)}else t[i*e+o]=l/t[o*e+o]}const a=new Float64Array(e*e);for(let i=0;i<e;i++)for(let o=i;o<e;o++){let l=o===i?1:0;for(let s=i;s<o;s++)l-=t[o*e+s]*a[s*e+i];a[o*e+i]=l/t[o*e+o]}const n=new Float64Array(e*e);for(let i=0;i<e;i++)for(let o=i;o<e;o++){let l=0;for(let s=o;s<e;s++)l+=a[s*e+i]*a[s*e+o];n[i*e+o]=l,n[o*e+i]=l}return n}const io=30,oo=.99,so=200,jr=1e-9,lo=1e-9,co=1e-12;function $r(r,e,t){const a=r.length,n=new Float64Array(e);for(const u of r)for(let d=0;d<e;d++)n[d]=n[d]+u[d];for(let u=0;u<e;u++)n[u]=n[u]/a;const i=new Float64Array(e);for(let u=0;u<e;u++){let d=0;for(const f of r)d+=(f[u]-n[u])**2;const c=Math.sqrt(d/a);i[u]=c>co*Math.max(1,Math.abs(n[u]))?c:1}const o=r.map(u=>Array.from({length:e},(d,c)=>(u[c]-n[c])/i[c])),{covariance:l}=no(o),s=new Float64Array(e*e);for(let u=0;u<e;u++)for(let d=0;d<e;d++)s[u*e+d]=l[u][d]+(u===d?t:0);const h=ao(s,e);if(!h)throw new Error("fitMahalanobis: covariance is not positive definite");return{mean:n,scale:i,precision:h}}function Rr(r,e){const t=r.mean.length,a=new Float64Array(t);for(let i=0;i<t;i++)a[i]=((e[i]??0)-r.mean[i])/r.scale[i];let n=0;for(let i=0;i<t;i++){let o=0;for(let l=0;l<t;l++)o+=r.precision[i*t+l]*a[l];n+=a[i]*o}return Math.sqrt(Math.max(0,n))}class uo{fit;threshold;constructor(e,t){this.fit=e,this.threshold=t}distance(e){return Rr(this.fit,e)}score(e){return this.distance(e)/this.threshold}}function ho(r,e={}){return Math.max(e.minSamples??io,r+2)}function fo(r,e={}){const t=ee(r),a=e.minVariance??jr,n=Math.min(r.length,Math.max(1,e.looRows??so)),i=[];for(let o=r.length-n;o<r.length;o++){const l=r.filter((s,h)=>h!==o);i.push(Rr($r(l,t,a),r[o]))}return Math.max(lo,zi(i,e.quantile??oo))}function go(r,e={}){const t=r.map(o=>o.x),a=ee(t);if(t.length<ho(a,e))return null;const n=$r(t,a,e.minVariance??jr),i=e.threshold??fo(t,e);return new uo(n,i)}class zr{population;trend;mahalanobis;constructor(e,t,a=null){this.population=e,this.trend=t,this.mahalanobis=a}featureScores(e){const t=this.population.zScores(e),a=this.trend.zScores(e);return t.map((n,i)=>({population:n/this.population.threshold,trend:a[i]/this.trend.threshold}))}mahalanobisScore(e){return this.mahalanobis?this.mahalanobis.score(e):null}observe(e){this.trend.update(e)}predict(e){let t=Math.max(this.population.predict(e).scores[0],this.trend.predict(e).scores[0]);return this.mahalanobis&&(t=Math.max(t,this.mahalanobis.score(e))),{scores:[t],confidence:Be(t)}}}function mo(r,e={}){return new zr(ct(r,e.robustZ),ut(r,e.ewma),e.mahalanobis?go(r,e.mahalanobis):null)}function Ze(r,e,t,a){if(e>=t||r.length<=1)return{size:r.length};const n=r[0].length,i=[];for(let c=0;c<n;c++){let f=1/0,g=-1/0;for(const m of r)f=Math.min(f,m[c]),g=Math.max(g,m[c]);g>f&&i.push({f:c,lo:f,hi:g})}if(i.length===0)return{size:r.length};const{f:o,lo:l,hi:s}=i[Math.floor(a()*i.length)],h=l+a()*(s-l),u=r.filter(c=>c[o]<h),d=r.filter(c=>c[o]>=h);return{feature:o,split:h,left:Ze(u,e+1,t,a),right:Ze(d,e+1,t,a)}}function Or(r,e,t=0){return"size"in r?t+Pr(r.size):Or(e[r.feature]<r.split?r.left:r.right,e,t+1)}class po{trees;sampleSize;threshold;constructor(e,t,a){this.trees=e,this.sampleSize=t,this.threshold=a}score(e){const t=Pr(this.sampleSize);if(t===0)return .5;const a=this.trees.reduce((n,i)=>n+Or(i,e),0)/this.trees.length;return Math.pow(2,-a/t)}predict(e){const t=this.score(e)/this.threshold;return{scores:[t],confidence:Be(t)}}}function _o(r,e={}){const t=r.map(l=>l.x);ee(t);const a=Fr(e.seed??5616),n=Math.min(e.sampleSize??256,t.length),i=Math.ceil(Math.log2(Math.max(n,2))),o=[];for(let l=0;l<(e.trees??100);l++){const s=t.map((h,u)=>u);for(let h=0;h<n;h++){const u=h+Math.floor(a()*(s.length-h));[s[h],s[u]]=[s[u],s[h]]}o.push(Ze(s.slice(0,n).map(h=>t[h]),0,i,a))}return new po(o,n,e.threshold??.6)}function Rt(r,e){let t=0,a=0;for(const n of r)t+=n.w*n.g,a+=n.w*n.h;return-t/(a+e)}function Ge(r,e,t){return r*r/(e+t)}function Je(r,e,t){if(e>=t.maxDepth||r.length<2)return{value:Rt(r,t.lambda)};let a=0,n=0,i=0;for(const d of r)a+=d.w*d.g,n+=d.w*d.h,i+=d.w;const o=Ge(a,n,t.lambda);let l=null;const s=r[0].x.length;for(let d=0;d<s;d++){const c=[...r].sort((p,_)=>p.x[d]-_.x[d]);let f=0,g=0,m=0;for(let p=0;p<c.length-1;p++){const _=c[p];f+=_.w*_.g,g+=_.w*_.h,m+=_.w;const b=_.x[d],w=c[p+1].x[d];if(b===w||m<t.minLeafWeight||i-m<t.minLeafWeight)continue;const v=Ge(f,g,t.lambda)+Ge(a-f,n-g,t.lambda)-o;v>1e-12&&(!l||v>l.score)&&(l={feature:d,split:(b+w)/2,score:v})}}if(!l)return{value:Rt(r,t.lambda)};const h=r.filter(d=>d.x[l.feature]<l.split),u=r.filter(d=>d.x[l.feature]>=l.split);return{feature:l.feature,split:l.split,left:Je(h,e+1,t),right:Je(u,e+1,t)}}function Hr(r,e){for(;!("value"in r);)r=e[r.feature]<r.split?r.left:r.right;return r.value}class bo{objective;base;trees;learningRate;constructor(e,t,a,n){this.objective=e,this.base=t,this.trees=a,this.learningRate=n}margin(e){let t=this.base;for(const a of this.trees)t+=this.learningRate*Hr(a,e);return t}predict(e){const t=this.margin(e);if(this.objective==="regression")return{scores:[t],confidence:1};const a=xe(t);return{scores:[1-a,a],confidence:Math.max(a,1-a)}}}function wo(r,e={}){ee(r.map(d=>d.x));const t=e.objective??"binary",a=e.learningRate??.3,n={maxDepth:e.maxDepth??2,minLeafWeight:e.minLeafWeight??1,lambda:e.lambda??1};let i=0,o=0;for(const d of r)i+=d.weight??1,o+=(d.weight??1)*d.y;const l=i>0?o/i:r.reduce((d,c)=>d+c.y,0)/r.length,s=t==="binary"?Math.log(Math.max(l,1e-6)/Math.max(1-l,1e-6)):l,h=r.map(()=>s),u=[];for(let d=0;d<(e.trees??50);d++){const c=r.map((g,m)=>{if(t==="binary"){const p=xe(h[m]);return{x:g.x,g:p-g.y,h:Math.max(p*(1-p),1e-6),w:g.weight??1}}return{x:g.x,g:h[m]-g.y,h:1,w:g.weight??1}}),f=Je(c,0,n);u.push(f),r.forEach((g,m)=>h[m]=h[m]+a*Hr(f,g.x))}return new bo(t,s,u,a)}function yo(r,e,t={}){if(e.length===0)throw new Error(`fitClassical(${r}): no samples`);switch(r){case"knn":return Oi(e,t.knn);case"naive-bayes":return qi(e,t["naive-bayes"]);case"logistic":return Ui(e,t.logistic);case"linear":return Gi(e,t.linear);case"kmeans":return Zi(e,t.kmeans);case"robust-z":return ct(e,t["robust-z"]);case"ewma":return ut(e,t.ewma);case"anomaly-composite":return mo(e,t["anomaly-composite"]);case"isolation-forest":return _o(e,t["isolation-forest"]);case"gbm-small":return wo(e,t["gbm-small"])}}class vo{config;_params;_grads;constructor(e){this.config={seed:20045,...e};const{inputDim:t,hiddenDim:a,outputDim:n,objective:i}=this.config;if(i==="mse"&&n!==1)throw new Error("DenseHead: mse objective needs outputDim 1");if(i==="softmax"&&n<2)throw new Error("DenseHead: softmax objective needs outputDim ≥ 2");const o=new ve(this.config.seed),l=()=>o.next(),s=a>0?a:t,h=[...a>0?[["w1",a*t,1/Math.sqrt(t)],["b1",a,0]]:[],["w2",n*s,1/Math.sqrt(s)],["b2",n,0]];this._params=h.map(([u,d,c])=>({name:u,numel:d,data:c>0?le(d,c,l):new Float32Array(d)})),this._grads=h.map(([u,d])=>({name:u,numel:d,data:new Float32Array(d)}))}_p(e){return this._params.find(t=>t.name===e).data}_g(e){return this._grads.find(t=>t.name===e).data}parameters(){return this._params}gradients(){return this._grads}zeroGrad(){for(const e of this._grads)e.data.fill(0)}_forward(e){const{inputDim:t,hiddenDim:a,outputDim:n}=this.config;let i;if(a>0){const h=this._p("w1"),u=this._p("b1");i=new Float32Array(a);for(let d=0;d<a;d++){let c=u[d];for(let f=0;f<t;f++)c+=h[d*t+f]*(e[f]??0);i[d]=Math.tanh(c)}}else i=Float32Array.from({length:t},(h,u)=>e[u]??0);const o=this._p("w2"),l=this._p("b2"),s=new Float32Array(n);for(let h=0;h<n;h++){let u=l[h];for(let d=0;d<i.length;d++)u+=o[h*i.length+d]*i[d];s[h]=u}return{h:i,z:s}}_lossGrad(e,t){if(this.config.objective==="mse"){const i=e[0]-t;return{loss:.5*i*i,dz:Float32Array.of(i)}}const a=De(e),n=Float32Array.from(a,(i,o)=>i-(o===t?1:0));return{loss:-Math.log(Math.max(a[t]??0,1e-12)),dz:n}}loss(e){return(e.weight??1)*this._lossGrad(this._forward(e.x).z,e.y).loss}accumulate(e){const t=e.weight??1,{inputDim:a,hiddenDim:n,outputDim:i}=this.config,{h:o,z:l}=this._forward(e.x),{loss:s,dz:h}=this._lossGrad(l,e.y),u=this._p("w2"),d=this._g("w2"),c=this._g("b2"),f=new Float32Array(o.length);for(let g=0;g<i;g++){const m=t*h[g];c[g]=c[g]+m;for(let p=0;p<o.length;p++)d[g*o.length+p]=d[g*o.length+p]+m*o[p],f[p]=f[p]+m*u[g*o.length+p]}if(n>0){const g=this._g("w1"),m=this._g("b1");for(let p=0;p<n;p++){const _=f[p]*(1-o[p]*o[p]);m[p]=m[p]+_;for(let b=0;b<a;b++)g[p*a+b]=g[p*a+b]+_*(e.x[b]??0)}}return t*s}predict(e){const{z:t}=this._forward(e);if(this.config.objective==="mse")return{scores:[t[0]],confidence:1};const a=Array.from(De(t));return{scores:a,confidence:Math.max(...a)}}exportParams(){return Ar(this._params)}importParams(e){Mr(this._params,e)}}function xo(r){const e=r.engines.find(t=>t.tier==="local"&&(t.engine==="classical"||t.engine==="head"));if(!e)throw new Error(`trainMlTask(${r.id}): no trainable local engine`);return e}async function zt(r,e,t,a){if(r.train?.fit)return{predictor:await r.train.fit(t,e),skippedNonFinite:0};if(e.engine==="classical")return{predictor:yo(e.algorithm,t,a.classical),skippedNonFinite:0};if(e.engine==="head"){const n=r.kind==="classify"?"softmax":r.kind==="regress"?"mse":null;if(!n)throw new Error(`trainMlTask(${r.id}): a head engine trains classify or regress tasks only`);const i=new vo({inputDim:t[0].x.length,hiddenDim:e.head==="linear"?0:a.head?.hiddenDim??16,outputDim:n==="softmax"?r.output.labels.length:1,objective:n,...a.head?.seed!=null?{seed:a.head.seed}:{}}),o=new kr(i,a.device??null,`trainMlTask(${r.id})`);return await o.train(t,a.head?.train),{predictor:i,skippedNonFinite:o.skippedNonFinite}}throw new Error(`trainMlTask(${r.id}): engine '${se(e)}' is not trained here`)}async function ko(r,e,t={}){const a=r.train;if(!a)throw new Error(`trainMlTask(${r.id}): task is rule-based or pre-trained only`);if(a.trainedBy)throw new Error(`trainMlTask(${r.id}): trained by ${a.trainedBy}`);if(e.length<a.minSamples)return null;const n=t.engine??xo(r),i=await Ii(r.features,e.map(c=>c.input),t.embedder),o=e.map((c,f)=>({x:i[f],y:c.label,...c.weight!=null?{weight:c.weight}:{}})),s=r.kind==="classify"||r.kind==="regress"?t.holdoutFraction??a.holdoutFraction??.2:0,h=Math.floor(o.length*s);let u=null;if(h>=1&&o.length-h>=1){const c=o.slice(0,o.length-h),f=o.slice(o.length-h),g=await zt(r,n,c,t);if(u=Tr(r.kind,g.predictor,f),t.refitOnAll===!1)return t.models?.set(r.id,se(n),g.predictor),{predictor:g.predictor,engine:n,samples:c.length,holdout:h,holdoutLoss:u,skippedNonFinite:g.skippedNonFinite}}const d=await zt(r,n,o,t);return t.models?.set(r.id,se(n),d.predictor),{predictor:d.predictor,engine:n,samples:o.length,holdout:h>=1?h:0,holdoutLoss:u,skippedNonFinite:d.skippedNonFinite}}function zs(r,e,t,a,n={},i){return{task:r,engine:e,version:t,shape:n,params:ir(rr(a)),...i!=null&&Number.isFinite(i)?{evalLoss:i}:{}}}function Os(r){return ar(nt(r.params))}function Hs(r,e){return r.manifest.mlHeads?.find(t=>t.task===e)}function qs(r,e){return r.withMlHeads([...(r.manifest.mlHeads??[]).filter(t=>t.task!==e.task),e])}function Gs(r,e,t,a){const n=Yt(nt(r.params),rr(e));return yn(n,r.version,t,a??`ml head ${r.task}`,nr(r.task))}function Ks(r,e,t,a={}){const n=nt(r.params),i=nr(r.task),o=[],l=[],s=[];e.forEach((d,c)=>{const f=vn(d.target,i);if(f)return void s.push({index:c,reason:f});if(d.baseVersion!==r.version)return void s.push({index:c,reason:`stale base version ${d.baseVersion} (head is ${r.version})`});let g;try{g=xn(d)}catch(p){return void s.push({index:c,reason:`diff is not base64: ${p instanceof Error?p.message:String(p)}`})}const m=kn(g,n);if(m)return void s.push({index:c,reason:m});o.push(g),l.push(d.weight??1)});const h=na(n,o,l,d=>t(ar(d)),{...a,requireEval:a.requireEval??!0});return h.accepted?{head:{...r,version:r.version+1,params:ir(h.checkpoint),...h.newLoss!=null?{evalLoss:h.newLoss}:{}},merge:h,rejected:s}:{head:r,merge:h,rejected:s}}const we={kind:"classify",id:"experience.quality",description:"Is this procedure worth learning from (does it run, and run well)?",features:{text:r=>r.doc.text,numeric:r=>[te(r.steps,50),te(r.runs,20)],numericNames:["steps","runs"]},engines:[{tier:"local",engine:"classical",algorithm:"knn"},{tier:"local",engine:"classical",algorithm:"logistic"}],train:{minSamples:12},output:{labels:["low","high"],decode:r=>({label:(r.scores[1]??0)>=.5?"high":"low",pHigh:r.scores[1]??0})}};function Ao(r,e,t=[]){const a=new Map([...e.map(i=>[i.id,i.steps.length]),...r.map(i=>[i.id,i.steps.length])]),n=new Map;for(const i of t){if(i.status==="running")continue;const o=n.get(i.skillId)??{runs:0,succeeded:0,failed:0};o.runs++,i.status==="succeeded"&&o.succeeded++,i.status==="failed"&&o.failed++,n.set(i.skillId,o)}return lt(r,e).map(i=>({doc:i,steps:a.get(i.id)??0,...n.get(i.id)??{runs:0,succeeded:0,failed:0}}))}function qr(r){return r.runs===0?null:r.succeeded/r.runs>=.5?1:0}const Mo=5;function Lo(r){return r.flatMap(e=>{const t=qr(e);return t==null?[]:[{input:e,label:t}]})}const Gr=.97,et={kind:"cluster",id:"experience.dedupe",description:"Is this procedure a near-copy of one already kept?",features:{text:r=>r.text},engines:[{tier:"local",engine:"classical",algorithm:"knn"}],output:{decode:r=>({nearest:r.scores[0]??-1,similarity:r.scores[1]??0,duplicate:(r.scores[2]??0)===1})}};class So{threshold;_knn=new dt(1,"cosine",2);constructor(e=Gr){this.threshold=e}get size(){return this._knn.size}add(e){this._knn.add(e)}predict(e){const t=this._knn.nearest(e);if(!t)return{scores:[-1,0,0],confidence:1};const a=t.similarity>=this.threshold;return{scores:[t.index,t.similarity,a?1:0],confidence:Math.abs(t.similarity)}}}const Ot=200;function Do(r,e,t){return{get:(a,n)=>{const i=r.get(a,n);return a===e&&i instanceof dt&&t<i.size?i.excluding(t):i},set:(a,n,i)=>r.set(a,n,i)}}function Kr(r){const e=new Map;return{dimensions:r.dimensions,fingerprint:r.fingerprint,async embed(t){let a=e.get(t);return a||e.set(t,a=await r.embed(t)),a}}}async function Eo(r,e,t){if(r.runs<=0)return null;if(r.runs>=Mo)return r.succeeded/r.runs;const a=t==null||!e.models?e:{...e,models:Do(e.models,we.id,t)};try{return(await $i(we.id,r,a)).output.pHigh}catch(n){if(!(n instanceof Nr))throw n;return null}}async function No(r,e){const t=Kr(e.embedder),a=new So(e.dedupeThreshold??Gr),n=[],i=[],o=[],l=e.quality?{...e.quality.ctx,embedder:t}:null,s=new Map((e.quality?.trainedIds??[]).map((u,d)=>[u,d])),h=u=>t.embed(et.features.text(u));for(const u of e.known??[])a.add(await h(u)),n.push(u.id);for(const u of r){if(e.exclude?.has(u.id)){o.push({id:u.id,reason:"excluded"});continue}if(e.quality&&l){const f=await Eo(e.quality.input(u),l,s.get(u.id));if(f!=null&&f<(e.quality.minPHigh??.5)){o.push({id:u.id,reason:"low-quality",score:f});continue}}const d=await h(u),c=et.output.decode(a.predict(d));if(c.duplicate){o.push({id:u.id,reason:"duplicate",of:n[c.nearest],score:c.similarity});continue}a.add(d),n.push(u.id),i.push(u)}return{kept:i,dropped:o}}function Co(r,e,t){return!r||r.status!=="curated_out"?!1:r.reason==="duplicate"?r.of!=null&&t.has(r.of):r.reason==="low-quality"?r.runs===e:!1}async function Us(r,e,t){const a=t.known?.slice(0,Ot),n=Kr(t.embedder),i=Ao(e.episodes,e.skills,e.runs),o=new Map(i.map(_=>[_.doc.id,_])),l=_=>o.get(_.id)??{doc:_,steps:0,runs:0,succeeded:0,failed:0},s=new Set((t.known??[]).map(_=>_.id)),h=[],u=[];for(const _ of r){const b=e.curated?.[_.id];b&&Co(b,l(_).runs,s)?h.push({id:_.id,reason:b.reason,...b.of!=null?{of:b.of}:{},...b.score!=null?{score:b.score}:{}}):u.push(_)}const d=[...r,...t.known??[]].map(_=>o.get(_.id)).filter(_=>_!=null&&qr(_)!=null).slice(0,Ot),c=Lo(d.reverse()),f=new Dr;f.register(we);const g=new Wi,m=await ko(we,c,{embedder:n,models:g});return{...await No(u,{embedder:n,...a?{known:a}:{},...t.dedupeThreshold!=null?{dedupeThreshold:t.dedupeThreshold}:{},quality:{ctx:{registry:f,mode:"local-only",models:g},input:l,...t.minPHigh!=null?{minPHigh:t.minPHigh}:{},...m?{trainedIds:c.map(_=>_.input.doc.id)}:{}}}),alreadyDropped:h}}function Vs(r,e,t){const a=new Map;for(const i of e.runs)i.status!=="running"&&a.set(i.skillId,(a.get(i.skillId)??0)+1);const n={};for(const i of r.dropped)n[i.id]={status:"curated_out",reason:i.reason,...i.of!=null?{of:i.of}:{},...i.score!=null?{score:i.score}:{},runs:a.get(i.id)??0,at:t};return{dropped:n,kept:r.kept.map(i=>i.id)}}const Fo=["promptTokens","contextTokens","contextFill","overflows","tools","turnIndex","attachments","priorLocalSuccessRate","codeHeavy"];function Po(r){const e=An(r.promptTokens+r.contextTokens,r.servedContextTokens,4);return[te(r.promptTokens,1e5),te(r.contextTokens,1e5),e,e>1?1:0,te(r.tools,64),te(r.turnIndex,100),te(r.attachments??0,16),Math.max(0,Math.min(1,r.priorLocalSuccessRate??.5)),r.codeHeavy?1:0]}const To={kind:"classify",id:"run.local-success",description:"Will this turn succeed on the local model?",features:{numeric:Po,numericNames:Fo},engines:[{tier:"local",engine:"classical",algorithm:"logistic"},{tier:"local",engine:"classical",algorithm:"gbm-small"}],train:{minSamples:8},output:{labels:["fails","succeeds"],decode:r=>({succeeds:(r.scores[1]??0)>=.5,probability:r.scores[1]??0})}},Bo=.5;function Io(r){return r.local?{label:r.local==="succeeded"?1:0,weight:1}:r.fellBack?{label:0,weight:1}:r.cloud==="failed"?{label:0,weight:Bo}:null}function Xs(r){return r.flatMap(e=>{const t=Io(e);return t?[{input:e.turn,label:t.label,weight:t.weight}]:[]})}const Ur=["cost","duration","toolFailures"],Vr=1e3,Xr=36e5,Wo=50;function jo(r){return[te(r.costUsd*100,Vr),te(r.durationMs,Xr),te(r.toolFailures,Wo)]}const Ht=3,qt=[Math.log(Ht)/(3*Math.log1p(Vr)),Math.log(Ht)/(3*Math.log1p(Xr)),.1];class $o extends zr{explain(e){const t=this.featureScores(e);return Ur.map((a,n)=>({metric:a,...t[n]}))}}function Ro(r,e={}){return new $o(ct(r,{...e.robustZ,minScale:e.robustZ?.minScale??qt}),ut(r,{...e.ewma,minScale:e.ewma?.minScale??qt}))}const zo={kind:"anomaly",id:"run.anomaly",description:"Did this run cost, take or fail far outside its normal range?",features:{numeric:jo,numericNames:Ur},engines:[{tier:"local",engine:"classical",algorithm:"anomaly-composite"}],train:{minSamples:5,fit:r=>Ro(r)},output:{decode:r=>({anomalous:(r.scores[0]??0)>=1,score:r.scores[0]??0})}};function Ys(r,e=0){return{costUsd:e,durationMs:r.endedAt!=null?Math.max(0,r.endedAt-r.startedAt):0,toolFailures:r.steps.filter(t=>t.outcome==="failed").length}}const Oo=[ki,we,et,zo,To];function Qs(){const r=new Dr;for(const e of Oo)r.register(e);return r}export{Xo as ACTIVATIONS_BACKWARD_WGSL,me as ACTIVATIONS_WGSL,Zo as ATTENTION_BACKWARD_WGSL,wt as ATTENTION_FORWARD_WGSL,fr as A_LOG_CLAMP_HI,hr as A_LOG_CLAMP_LO,Zr as AdamW,zr as AnomalyCompositeModel,Wn as AttentionBlock,Vt as BPETokenizer,Oo as BUILTIN_ML_TASKS,el as BufferPool,tl as CHECK_SCHEDULER_FEATURES,rl as CHECK_SCHEDULER_MODEL_CARD,nl as CHECK_SCHEDULER_TASK,Bo as CLOUD_ONLY_FAILURE_WEIGHT,Pe as COL_SLICE_ENTRY,Fe as COL_SLICE_WGSL,Qo as COMPLEX_SSD_BACKWARD_WGSL,Cn as COMPLEX_SSD_FORWARD_WGSL,Go as CONV1D_BACKWARD_WGSL,at as CONV1D_FORWARD_WGSL,vt as CPU_GRADIENT_LAYER_TYPES,al as CRC_TRAILER_MAGIC,Ot as CURATION_KNOWN_LIMIT,Gr as DEFAULT_DEDUPE_THRESHOLD,pi as DEFAULT_LIMBIC_CONFIG,_i as DEFAULT_LIMBIC_SEED,il as DEFAULT_LM_CONFIG,ol as DEFAULT_LM_SEED,pa as DEFAULT_LORA_TARGETS,sl as DEFAULT_MOE_CONFIG,ll as DEFAULT_MOE_SEED,dl as DELTA_TARGET_RE,So as DedupeIndex,vo as DenseHead,cl as DynamicLossScaler,Jn as EVERMIND_ADAPT_MAX_CHARS,et as EXPERIENCE_DEDUPE_TASK,we as EXPERIENCE_QUALITY_TASK,Ye as EXPERIENCE_SCHEMA,ms as EXPORT_FORMATS,Xt as EvermindLM,ul as EvermindLMLoRA,tt as EvermindLMTrainer,hl as EvermindModelPackage,ds as EvermindTextEmbedder,ro as EwmaModel,Ke as FOREIGN_MAMBA_ADAPTERS,vs as GRAD_CLIP_WGSL,bo as GbmModel,kr as HeadTrainer,Rn as HybridMambaModel,hs as ImageRVQCodec,fe as InMemoryExperienceStore,Wi as InMemoryMlModels,po as IsolationForestModel,$t as KMeansModel,dt as KnnModel,ki as LIMBIC_AFFECT_TASK,Ts as LIMBIC_AFFECT_WGSL,fi as LIMBIC_BLOCK_HEADER,si as LIMBIC_BOUNDS,wr as LIMBIC_DIM,ne as LIMBIC_DIM_NAMES,yr as LIMBIC_STATE_DIM,Ko as LINEAR_BACKWARD_WGSL,ke as LINEAR_FORWARD_WGSL,Hn as LN2,Fo as LOCAL_SUCCESS_FEATURES,To as LOCAL_SUCCESS_TASK,Cs as LimbicModel,Fs as LimbicTrainer,jt as LinearModel,on as LoRAAdapter,Jr as LoadBalanceAccumulator,Ki as LogisticModel,io as MAHALANOBIS_MIN_SAMPLES,ot as MAMBA1_PARAM_NAMES,Ti as MAX_ADAPTATIONS,fl as MAX_DELTA_B64_CHARS,Pi as MAX_RUNS,wn as ML_TASK_ID_RE,uo as MahalanobisDetector,Sn as Mamba1Block,Nn as Mamba2Block,Pn as Mamba3Block,Sn as MambaBlock,Jo as MambaModel,us as MambaTrainer,Rs as MlDecisionLog,Nr as MlEngineUnavailableError,Dr as MlTaskRegistry,es as MoETrainer,gl as MultimodalVocab,st as NEUTRAL_STATE,Hi as NaiveBayesModel,ml as PACKAGE_HEADER_BYTES,Mo as QUALITY_OBSERVED_MIN_RUNS,xs as REGION,rt as RMSNORM_EPS,Ht as RUN_ANOMALY_FLAG_RATIO,Ur as RUN_ANOMALY_METRICS,qt as RUN_ANOMALY_MIN_SCALE,zo as RUN_ANOMALY_TASK,to as RobustZModel,$o as RunAnomalyDetector,qo as SELECTIVE_SCAN_BACKWARD_WGSL,bt as SELECTIVE_SCAN_FORWARD_WGSL,Vo as SOFTMAX_BACKWARD_WGSL,Uo as SOFTMAX_FORWARD_WGSL,Tn as SOFTMAX_WGSL,Yo as SSD_BACKWARD_WGSL,Dn as SSD_FORWARD_WGSL,ve as SeededRng,pl as SharedExpertMoE,_l as Tensor,bl as VIDEO_BANK_INTER,wl as VIDEO_BANK_INTRA,sn as VideoRVQCodec,oi as WEIGHT_UPDATE_WGSL,_a as WSLA_MAX_DELTA,Se as adamwUpdateInPlace,ta as adaptAndDiff,ss as adaptPackage,Yn as adaptationsAfterSkip,Be as anomalyConfidence,Qr as appendCrcTrailer,Qt as applyCheckpointDiff,Nt as applyLimbicDelta,bs as applyPortedWeights,yl as applyRowDelta,Ls as appraiseAmygdala,Ns as appraiseTask,er as archOf,Mr as assignParams,vl as backward,Xe as basalGangliaExploreBias,Ds as basalGangliaSelect,nt as base64ToBytes,Gn as benchArgmax,is as benchmarkAdaptationCost,Ee as benchmarkModel,ts as benchmarkModelAsync,ns as benchmarkText,Un as bitsPerToken,ya as buildBatches,wa as buildChunks,yn as buildDeltaLearnPayload,Es as buildLimbicBlock,Gs as buildMlHeadDelta,fs as buildVideoSequence,ir as bytesToBase64,ji as candidateEngines,P as cdiv,xl as checkSchedulerFeatures,ao as choleskyInverse,Te as clampDim,Ue as clampLimbicDim,An as clampRatio,ks as clampState,kl as clearTape,ei as codestralMambaAdapter,rs as compareModels,Vn as compareReports,hi as compileLimbicState,Al as computeRowDelta,cn as configJson,cr as corpusToSequences,Ri as cosine,ba as cpuDimsFor,ga as cpuModelBackward,fa as cpuModelForward,cs as cpuModelLoss,ha as cpuWeightsFromNamed,rn as crc32,I as createBindGroup,H as createComputePipeline,E as createEmptyStorageBuffer,Qs as createMlRegistry,Q as createStorageBuffer,$ as createUniformBuffer,an as crossEntropyGrad,ye as crossEntropyLoss,No as curateExperience,Us as curatePendingExperience,Vs as curationRecords,Co as curationStands,xn as decodeDeltaPayload,vn as deltaTargetMismatch,kn as deltaUnusableReason,Ut as dequantizeFp16,Ml as dequantizeInt8,Ll as dequantizeInt8PerChannel,en as deserializeRowDelta,Yt as diffCheckpoints,Y as dispatchColumnSlice,W as dispatchKernel,Cr as dot,Is as dueSkills,oe as elementLabel,Qe as emptySnapshot,Sl as enableGrad,se as engineKey,Dl as estimateMemory,El as evermindTensorSpec,Ya as executePortPlan,Ws as experienceCorpus,lt as experienceDocuments,$s as experienceOverview,Lo as experienceQualityExamples,Ao as experienceQualityInputs,qr as experienceQualityLabel,Ys as experienceRunMetrics,ps as exportEvermind,Lt as exportGguf,At as exportOnnx,_t as exportSafetensors,Ii as extractFeatureMatrix,Er as extractFeatures,_n as falconMambaAdapter,mo as fitAnomalyComposite,yo as fitClassical,ut as fitEwma,wo as fitGbm,_o as fitIsolationForest,Zi as fitKMeans,Oi as fitKnn,Gi as fitLinear,Ui as fitLogistic,go as fitMahalanobis,qi as fitNaiveBayes,ct as fitRobustZ,Ro as fitRunAnomaly,Ar as flattenParams,ln as floatToFp16,ai as foreignMambaAdapterFor,os as formatAdaptationCostReport,Nl as fp16ToFloat,Cl as fp16View,le as gaussianArray,gs as generateImage,va as generateVideo,fn as generationConfigJson,rr as headCheckpoint,ar as headParams,Ss as homeostasis,Fl as importEvermind,Pl as importEvermindTensors,Tl as inferArchFromTensors,Bl as initWebGPU,Ei as isDue,Ft as isIrreversibleLabel,fo as leaveOneOutMahalanobisThreshold,no as ledoitWolfCovariance,Ps as limbicAffectPredictor,xi as limbicHead,xr as limbicSetpoints,Me as linearBackward,_e as linearForward,Xs as localSuccessExamples,Po as localSuccessFeatures,Io as localSuccessLabel,Il as logProbOfToken,te as logScale,ho as mahalanobisMinSamples,Wl as mamba1Adapter,la as mamba1CpuBackward,gr as mamba1CpuForward,pn as mambaAdapter,ws as mambaConfigFromTensors,ls as meanEvalLoss,Ms as meanLimbicSetpoints,ra as mergeCheckpointDiffs,na as mergeCheckpointDiffsGated,Ks as mergeMlHeadDeltas,Wr as minScaleAt,Tr as mlEvalLoss,zs as mlHeadEntry,Os as mlHeadParams,nr as mlHeadTarget,jl as mlHeadUnusableReason,hn as modelCardMarkdown,tr as namedTensors,ua as namedWeights,Si as needsApproval,Ve as neutralLimbicState,li as neutralState,Ai as newExperienceId,$l as noGrad,br as normaliseSourceName,js as packDocuments,Hs as packageMlHead,dn as paramCount,ma as paramMatrixShape,Rl as parseDeltaLearnPayload,Bt as parseSnapshot,Kn as perplexity,As as personalitySetpoint,ii as portForeignMamba,_s as portForeignMambaSafetensors,zl as quantizeBase,Gt as quantizeFp16,Ol as quantizeInt8,Hl as quantizeInt8PerChannel,ql as randn,ie as readBuffer,Gl as recordOperation,di as recordToState,ys as resizePortedVocab,Zt as rmsNormBackward,Jt as rmsNormForward,Kl as roundFp16,jo as runAnomalyFeatures,$i as runMlTask,bn as safetensorsToTensors,tn as serializeRowDelta,gt as setInitSeed,xe as sigmoid,pt as silu,mt as siluGrad,Pt as slug,De as softmax,nn as softplus,Br as solveLinearSystem,vr as stateToRecord,Ul as tensorsToSafetensors,ui as thalamusGate,ca as toNamedGrads,ur as tokenWindows,un as tokenizerJson,qn as topKIndices,as as trainAndBenchmark,ko as trainMlTask,Bs as trainOnce,ge as uploadBuffer,Kt as verifyCrcTrailer,qs as withPackageMlHead,da as zeroCpuModelGrads,sa as zeroMamba1Grads};
