import{l as E,j,h as T,g as W,f as H,e as D,m as dt,d as Q,s as Dt,r as rt,q as zt,n as le,v as ue,u as ot,o as Ht,A as ce,L as _e,p as pt,B as he,E as ge,w as pe,S as Ot,x as ct,y as Bt,z as Gt,C as Kt,D as qt,F as st,G as Pt,H as me,R as vt,I as fe,J as be,K as _t,M as $t,N as Ut,O as we,P as ve,Q as Nt,T as ye,t as xe,U as Ae,V as ke}from"./chunk-falcon_mamba.js";const Mt=`

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
`,Zr=`

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
`,yt=`

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
`,ta=`

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
`,lt=`

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
`,ea=`

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
`,nt=`

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
`,ra=`
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
`,aa=`
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
`,na=`

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
`,mt=`
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
`,ft="col_slice";function Y(s,t,r,n,e,i,a,u){const o=E(s,new Uint32Array([e,i,a,u]).buffer),_=j(s,t,[o,r,n]);T(s,t,_,[W(e*u,256),1,1]),o.destroy()}const Le=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,De=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class Be{layerType="mamba1";device;config;dInner;dtRank;wInProj;bInProj;wConv;bConv;wXProj;bXProj;wDtProj;bDtProj;A_log;D_vec;wOutProj;bOutProj;normWeight;gpuWeights;pipelines;_wslaMode=!1;constructor(t,r){this.device=t,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(r.dModel/16),...r};const{dModel:n,expand:e}=this.config;this.dInner=e*n,this.dtRank=r.dtRank??Math.ceil(n/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,dState:r,dConv:n}=this.config,e=this.dInner,i=r,a=n,u=this.dtRank,o=(c,d=.02)=>dt(c,d),_=c=>new Float32Array(c),l=c=>new Float32Array(c).fill(1);this.wInProj=o(2*e*t),this.bInProj=_(2*e),this.wConv=o(e*a,.01),this.bConv=_(e),this.wXProj=o((u+2*i)*e,.01),this.bXProj=_(u+2*i),this.wDtProj=o(e*u,.02),this.bDtProj=_(e),this.A_log=new Float32Array(e*i);for(let c=0;c<e;c++)for(let d=0;d<i;d++)this.A_log[c*i+d]=Math.log(d+1);this.D_vec=l(e),this.wOutProj=o(t*e,.02),this.bOutProj=_(t),this.normWeight=l(t),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const t=this.device,r=n=>Q(t,n,!0);this.gpuWeights={wInProj:r(this.wInProj),bInProj:r(this.bInProj),wConv:r(this.wConv),bConv:r(this.bConv),wXProj:r(this.wXProj),bXProj:r(this.bXProj),wDtProj:r(this.wDtProj),bDtProj:r(this.bDtProj),A_log:r(this.A_log),D_vec:r(this.D_vec),wOutProj:r(this.wOutProj),bOutProj:r(this.bOutProj),normWeight:r(this.normWeight)}}_buildPipelines(){const t=this.device;this.pipelines={linear:H(t,lt,"linear_forward"),conv1d:H(t,yt,"conv1d_forward"),silu:H(t,nt,"silu_forward"),rmsnorm:H(t,nt,"rmsnorm_forward"),scan_fwd:H(t,Mt,"forward_scan"),scan_reduce:H(t,Mt,"forward_reduce"),colSlice:H(t,mt,ft),elMul:H(t,Le,"main"),elAdd:H(t,De,"main")}}forward(t,r,n){const e=this.device,{dModel:i,dState:a,dConv:u}=this.config,o=this.dInner,_=a,l=r,c=n,d=l*c,f=this.dtRank,p={},g=D(e,d*i*4,!0),h=D(e,d*4,!0);p.normInv=h,p.normIn=t;{const m=new ArrayBuffer(16);new Uint32Array(m,0,2).set([d,i]),new Float32Array(m,8,1).set([1e-6]);const x=E(e,m),L=j(e,this.pipelines.rmsnorm,[x,t,this.gpuWeights.normWeight,g,h]);T(e,this.pipelines.rmsnorm,L,[W(d,64),1,1])}const w=D(e,d*2*o*4,!0);p.normOut=g;{const m=new Uint32Array([d,i,2*o]).buffer,x=E(e,m),L=j(e,this.pipelines.linear,[x,g,this.gpuWeights.wInProj,this.gpuWeights.bInProj,w]);T(e,this.pipelines.linear,L,[W(d,16),W(2*o,16),1])}const y=D(e,d*o*4,!0),b=D(e,d*o*4,!0);{const m=this.pipelines.colSlice;Y(e,m,w,y,d,2*o,0,o),Y(e,m,w,b,d,2*o,o,o)}w.destroy(),p.zBuf=b,p.xConvIn=y;const v=D(e,d*o*4,!0);p.convOut=v;{const m=new Uint32Array([c,o,u,l,1]).buffer,x=E(e,m),L=j(e,this.pipelines.conv1d,[x,y,this.gpuWeights.wConv,this.gpuWeights.bConv,v]);T(e,this.pipelines.conv1d,L,[W(c,16),W(o,16),l])}const P=D(e,d*o*4,!0);p.siluOut=P;{const m=new Uint32Array([d*o]).buffer,x=E(e,m),L=j(e,this.pipelines.silu,[x,v,P]);T(e,this.pipelines.silu,L,[W(d*o,256),1,1])}const B=D(e,d*(f+2*_)*4,!0);{const m=new Uint32Array([d,o,f+2*_]).buffer,x=E(e,m),L=j(e,this.pipelines.linear,[x,P,this.gpuWeights.wXProj,this.gpuWeights.bXProj,B]);T(e,this.pipelines.linear,L,[W(d,16),W(f+2*_,16),1])}const F=D(e,d*f*4,!0),k=D(e,l*c*_*4,!0),M=D(e,l*c*_*4,!0);{const m=f+2*_,x=this.pipelines.colSlice;Y(e,x,B,F,d,m,0,f),Y(e,x,B,k,d,m,f,_),Y(e,x,B,M,d,m,f+_,_)}B.destroy(),p.B_raw=k,p.C_raw=M;const S=D(e,d*o*4,!0);p.deltaFull=S;{const m=new Uint32Array([d,f,o]).buffer,x=E(e,m),L=j(e,this.pipelines.linear,[x,F,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,S]);T(e,this.pipelines.linear,L,[W(d,16),W(o,16),1])}F.destroy();const O=D(e,l*c*o*4,!0),G=D(e,2*l*c*o*_*4,!0);p.hCache=G;{const m=new Uint32Array([c,_,o,l]).buffer,x=E(e,m),L=j(e,this.pipelines.scan_fwd,[x,P,S,this.gpuWeights.A_log,k,M,this.gpuWeights.D_vec,O,G]);T(e,this.pipelines.scan_fwd,L,[o,_,l]);const R=j(e,this.pipelines.scan_reduce,[x,P,S,this.gpuWeights.A_log,k,M,this.gpuWeights.D_vec,O,G]);T(e,this.pipelines.scan_reduce,R,[W(c,64),o,l])}const q=D(e,d*o*4,!0),z=D(e,d*o*4,!0);{const m=E(e,new Uint32Array([d*o]).buffer),x=j(e,this.pipelines.silu,[m,b,q]);T(e,this.pipelines.silu,x,[W(d*o,256),1,1]);const L=E(e,new Uint32Array([d*o]).buffer),R=j(e,this.pipelines.elMul,[O,q,z,L]);T(e,this.pipelines.elMul,R,[W(d*o,256),1,1])}q.destroy(),O.destroy();const K=D(e,d*i*4,!0);{const m=new Uint32Array([d,o,i]).buffer,x=E(e,m),L=j(e,this.pipelines.linear,[x,z,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,K]);T(e,this.pipelines.linear,L,[W(d,16),W(i,16),1])}z.destroy();const A=D(e,d*i*4,!0);{const m=E(e,new Uint32Array([d*i]).buffer),x=j(e,this.pipelines.elAdd,[K,t,A,m]);T(e,this.pipelines.elAdd,x,[W(d*i,256),1,1])}return K.destroy(),{output:A,cache:p}}parameters(){const{dModel:t,dState:r,dConv:n}=this.config,e=this.dInner,i=r,a=n,u=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*e*t,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*e,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:e*a,name:"wConv"},{buf:this.gpuWeights.bConv,numel:e,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(u+2*i)*e,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:u+2*i,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:e*u,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:e,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:e*i,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:e,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:t*e,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:t,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:t,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(t){this._wslaMode=t}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const Pe=`
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
`,ia=`
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
`,Ne=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class Me{layerType="mamba2";device;config;dInner;dHead;gpuWeights;pipelines;_wslaMode=!1;constructor(t,r){this.device=t,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...r};const{dModel:n,expand:e,nHeads:i}=this.config;if(this.dInner=e*n,this.dHead=this.dInner/i,this.dInner%i!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${i}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,dState:r,dConv:n,nHeads:e,nGroups:i}=this.config,a=this.dInner,u=r,o=n,_=e,l=i,c=(h,w=.02)=>dt(h,w),d=h=>new Float32Array(h),f=h=>new Float32Array(h).fill(1),p=a+2*l*u+_,g=h=>Q(this.device,h,!0);this.gpuWeights={wInProj:g(c(p*t)),wConv:g(c((a+2*l*u)*o,.01)),bConv:g(d(a+2*l*u)),A_log:g(new Float32Array(_).fill(Math.log(1))),dt_bias:g(d(_)),D_vec:g(f(_)),wOutProj:g(c(t*a,.02)),normWeight:g(f(a)),preNormWeight:g(f(t))}}_buildPipelines(){const t=this.device;this.pipelines={linear:H(t,lt,"linear_forward"),conv1d:H(t,yt,"conv1d_forward"),colSlice:H(t,mt,ft),rmsnorm:H(t,nt,"rmsnorm_forward"),ssd_fwd:H(t,Pe,"ssd_chunk_forward"),elAdd:H(t,Ne,"main")}}forward(t,r,n){const e=this.device,{dModel:i,dState:a,dConv:u,nHeads:o,nGroups:_,chunkLen:l}=this.config,c=this.dInner,d=a,f=u,p=o,g=_,h=this.dHead,w=r,y=n,b=w*y,v=c+2*g*d,P=Math.ceil(y/l),B=D(e,b*i*4,!0),F=D(e,b*4,!0);{const C=new ArrayBuffer(16);new Uint32Array(C,0,2).set([b,i]),new Float32Array(C,8,1).set([1e-6]);const N=E(e,C),$=j(e,this.pipelines.rmsnorm,[N,t,this.gpuWeights.preNormWeight,B,F]);T(e,this.pipelines.rmsnorm,$,[W(b,64),1,1])}F.destroy();const k=c+2*g*d+p,M=D(e,b*k*4,!0);{const C=new Uint32Array([b,i,k]).buffer,N=E(e,C),$=Q(e,new Float32Array(k),!0),J=j(e,this.pipelines.linear,[N,B,this.gpuWeights.wInProj,$,M]);T(e,this.pipelines.linear,J,[W(b,16),W(k,16),1]),$.destroy()}B.destroy();const S=D(e,b*v*4,!0),O=D(e,b*p*4,!0);{const C=this.pipelines.colSlice,N=v+p;Y(e,C,M,S,b,N,0,v),Y(e,C,M,O,b,N,v,p)}M.destroy();const G=D(e,b*v*4,!0);{const C=new Uint32Array([y,v,f,w,1]).buffer,N=E(e,C),$=j(e,this.pipelines.conv1d,[N,S,this.gpuWeights.wConv,this.gpuWeights.bConv,G]);T(e,this.pipelines.conv1d,$,[W(y,16),W(v,16),w])}S.destroy();const q=D(e,b*c*4,!0),z=D(e,b*g*d*4,!0),K=D(e,b*g*d*4,!0);{const C=this.pipelines.colSlice;Y(e,C,G,q,b,v,0,c),Y(e,C,G,z,b,v,c,g*d),Y(e,C,G,K,b,v,c+g*d,g*d)}G.destroy();const A=D(e,(P+1)*w*p*d*h*4,!0),m=D(e,b*c*4,!0);{const C=new Uint32Array([y,c,p,h,g,d,l,P,w]).buffer,N=E(e,C),$=j(e,this.pipelines.ssd_fwd,[N,q,z,K,O,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,m,A]);T(e,this.pipelines.ssd_fwd,$,[P,p,w])}q.destroy(),z.destroy(),K.destroy(),O.destroy();const x=D(e,b*c*4,!0),L=D(e,b*4,!0);{const C=new ArrayBuffer(16);new Uint32Array(C,0,2).set([b,c]),new Float32Array(C,8,1).set([1e-6]);const N=E(e,C),$=j(e,this.pipelines.rmsnorm,[N,m,this.gpuWeights.normWeight,x,L]);T(e,this.pipelines.rmsnorm,$,[W(b,64),1,1])}m.destroy(),L.destroy();const R=D(e,b*i*4,!0);{const C=new Uint32Array([b,c,i]).buffer,N=E(e,C),$=Q(e,new Float32Array(i),!0),J=j(e,this.pipelines.linear,[N,x,this.gpuWeights.wOutProj,$,R]);T(e,this.pipelines.linear,J,[W(b,16),W(i,16),1]),$.destroy()}x.destroy();const U=D(e,b*i*4,!0);{const C=E(e,new Uint32Array([b*i]).buffer),N=j(e,this.pipelines.elAdd,[R,t,U,C]);T(e,this.pipelines.elAdd,N,[W(b*i,256),1,1])}return R.destroy(),{output:U,cache:{stateCarry:A}}}parameters(){const{dModel:t,dState:r,dConv:n,nHeads:e,nGroups:i}=this.config,a=this.dInner,u=r,o=n,_=e,l=i,c=a+2*l*u;return[{buf:this.gpuWeights.wInProj,numel:(a+2*l*u+_)*t,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:c*o,name:"wConv"},{buf:this.gpuWeights.bConv,numel:c,name:"bConv"},{buf:this.gpuWeights.A_log,numel:_,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:_,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:_,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:t*a,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:a,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:t,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(t){this._wslaMode=t}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const We=`
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
`,sa=`
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
`,Se=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class Ce{layerType="mamba3";device;config;dInner;dHead;nComplex;gpuWeights;pipelines;_wslaMode=!1;constructor(t,r){this.device=t,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...r};const{dModel:n,expand:e,nHeads:i}=this.config;if(this.dInner=e*n,this.dHead=this.dInner/i,this.nComplex=this.config.dState,this.dInner%i!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${i}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,dConv:r,nHeads:n,nGroups:e}=this.config,i=this.dInner,a=this.nComplex,u=r,o=n,_=e,l=i+2*_*a*2,c=(w,y=.02)=>dt(w,y),d=w=>new Float32Array(w),f=w=>new Float32Array(w).fill(1),p=new Float32Array(o*2);for(let w=0;w<o;w++)p[w*2+0]=0,p[w*2+1]=2*Math.PI*w/o;const g=w=>Q(this.device,w,!0),h=i+2*_*a*2+o;this.gpuWeights={wInProj:g(c(h*t)),wConv:g(c(l*u,.01)),bConv:g(d(l)),A_log:g(p),dt_bias:g(d(o)),D_vec:g(f(o)),wOutProj:g(c(t*i,.02)),normWeight:g(f(i)),preNormWeight:g(f(t))}}_buildPipelines(){const t=this.device;this.pipelines={linear:H(t,lt,"linear_forward"),conv1d:H(t,yt,"conv1d_forward"),colSlice:H(t,mt,ft),rmsnorm:H(t,nt,"rmsnorm_forward"),cssd_fwd:H(t,We,"complex_ssd_forward"),elAdd:H(t,Se,"main")}}forward(t,r,n){const e=this.device,{dModel:i,dConv:a,nHeads:u,nGroups:o,chunkLen:_}=this.config,l=this.dInner,c=this.nComplex,d=a,f=u,p=o,g=this.dHead,h=r,w=n,y=h*w,b=l+2*p*c*2,v=Math.ceil(w/_),P=D(e,y*i*4,!0),B=D(e,y*4,!0);{const I=new ArrayBuffer(16);new Uint32Array(I,0,2).set([y,i]),new Float32Array(I,8,1).set([1e-6]);const C=E(e,I),N=j(e,this.pipelines.rmsnorm,[C,t,this.gpuWeights.preNormWeight,P,B]);T(e,this.pipelines.rmsnorm,N,[W(y,64),1,1])}B.destroy();const F=l+2*p*c*2+f,k=D(e,y*F*4,!0);{const I=new Uint32Array([y,i,F]).buffer,C=E(e,I),N=Q(e,new Float32Array(F),!0),$=j(e,this.pipelines.linear,[C,P,this.gpuWeights.wInProj,N,k]);T(e,this.pipelines.linear,$,[W(y,16),W(F,16),1]),N.destroy()}P.destroy();const M=D(e,y*b*4,!0),S=D(e,y*f*4,!0);{const I=this.pipelines.colSlice,C=b+f;Y(e,I,k,M,y,C,0,b),Y(e,I,k,S,y,C,b,f)}k.destroy();const O=D(e,y*b*4,!0);{const I=new Uint32Array([w,b,d,h,1]).buffer,C=E(e,I),N=j(e,this.pipelines.conv1d,[C,M,this.gpuWeights.wConv,this.gpuWeights.bConv,O]);T(e,this.pipelines.conv1d,N,[W(w,16),W(b,16),h])}M.destroy();const G=D(e,y*l*4,!0),q=D(e,y*p*c*2*4,!0),z=D(e,y*p*c*2*4,!0);{const I=this.pipelines.colSlice;Y(e,I,O,G,y,b,0,l),Y(e,I,O,q,y,b,l,p*c*2),Y(e,I,O,z,y,b,l+p*c*2,p*c*2)}O.destroy();const K=D(e,(v+1)*h*f*c*2*g*4,!0),A=D(e,y*l*4,!0);{const I=new Uint32Array([w,l,f,g,p,c,_,v,h]).buffer,C=E(e,I),N=j(e,this.pipelines.cssd_fwd,[C,G,q,z,S,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,A,K]);T(e,this.pipelines.cssd_fwd,N,[v,f,h])}G.destroy(),q.destroy(),z.destroy(),S.destroy();const m=D(e,y*l*4,!0),x=D(e,y*4,!0);{const I=new ArrayBuffer(16);new Uint32Array(I,0,2).set([y,l]),new Float32Array(I,8,1).set([1e-6]);const C=E(e,I),N=j(e,this.pipelines.rmsnorm,[C,A,this.gpuWeights.normWeight,m,x]);T(e,this.pipelines.rmsnorm,N,[W(y,64),1,1])}A.destroy(),x.destroy();const L=D(e,y*i*4,!0);{const I=new Uint32Array([y,l,i]).buffer,C=E(e,I),N=Q(e,new Float32Array(i),!0),$=j(e,this.pipelines.linear,[C,m,this.gpuWeights.wOutProj,N,L]);T(e,this.pipelines.linear,$,[W(y,16),W(i,16),1]),N.destroy()}m.destroy();const R=D(e,y*i*4,!0);{const I=E(e,new Uint32Array([y*i]).buffer),C=j(e,this.pipelines.elAdd,[L,t,R,I]);T(e,this.pipelines.elAdd,C,[W(y*i,256),1,1])}return L.destroy(),{output:R,cache:{stateCarry:K}}}parameters(){const{dModel:t,dConv:r,nHeads:n,nGroups:e}=this.config,i=this.dInner,a=this.nComplex,u=r,o=n,_=e,l=i+2*_*a*2;return[{buf:this.gpuWeights.wInProj,numel:(i+2*_*a*2+o)*t,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:l*u,name:"wConv"},{buf:this.gpuWeights.bConv,numel:l,name:"bConv"},{buf:this.gpuWeights.A_log,numel:o*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:o,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:o,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:t*i,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:i,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:t,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(t){this._wslaMode=t}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const Fe=`
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
`,Wt=`
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
`,oa=`
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
`,Ie=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,je=`
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
`;class Te{layerType="attention";device;config;dHead;gpuWeights;pipelines;constructor(t,r){if(this.device=t,r.dModel%r.nHeads!==0)throw new Error(`AttentionBlock: dModel (${r.dModel}) must be divisible by nHeads (${r.nHeads}).`);this.config={dHead:r.dModel/r.nHeads,hasFfn:!1,ffnMult:4,...r},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,hasFfn:r,ffnMult:n}=this.config,e=(o,_=.02)=>dt(o,_),i=o=>new Float32Array(o),a=o=>new Float32Array(o).fill(1),u=o=>Q(this.device,o,!0);if(this.gpuWeights={wQKV:u(e(3*t*t)),bQKV:u(i(3*t)),wO:u(e(t*t)),bO:u(i(t)),normWeight:u(a(t))},r){const o=t*n;this.gpuWeights.wFfn1=u(e(o*t)),this.gpuWeights.bFfn1=u(i(o)),this.gpuWeights.wFfn2=u(e(t*o)),this.gpuWeights.bFfn2=u(i(t))}}_buildPipelines(){const t=this.device;this.pipelines={linear:H(t,lt,"linear_forward"),rmsnorm:H(t,nt,"rmsnorm_forward"),attn_fwd:H(t,Wt,"attention_forward"),attn_val:H(t,Wt,"attention_value"),softmax:H(t,Fe,"softmax_forward"),colSlice:H(t,mt,ft),elAdd:H(t,Ie,"main")},this.config.hasFfn&&(this.pipelines.silu=H(t,je,"silu_forward"))}forward(t,r,n){const e=this.device,{dModel:i,nHeads:a,hasFfn:u}=this.config,o=this.dHead,_=r,l=n,c=_*l,d=a,f=D(e,c*i*4,!0),p=D(e,c*4,!0);{const k=new ArrayBuffer(16);new Uint32Array(k,0,2).set([c,i]),new Float32Array(k,8,1).set([1e-6]);const M=E(e,k),S=j(e,this.pipelines.rmsnorm,[M,t,this.gpuWeights.normWeight,f,p]);T(e,this.pipelines.rmsnorm,S,[W(c,64),1,1])}p.destroy();const g=D(e,c*3*i*4,!0);{const k=new Uint32Array([c,i,3*i]).buffer,M=E(e,k),S=j(e,this.pipelines.linear,[M,f,this.gpuWeights.wQKV,this.gpuWeights.bQKV,g]);T(e,this.pipelines.linear,S,[W(c,16),W(3*i,16),1])}f.destroy();const h=D(e,c*i*4,!0),w=D(e,c*i*4,!0),y=D(e,c*i*4,!0);{const k=this.pipelines.colSlice;Y(e,k,g,h,c,3*i,0,i),Y(e,k,g,w,c,3*i,i,i),Y(e,k,g,y,c,3*i,2*i,i)}g.destroy();const b=D(e,_*d*l*l*4,!0);{const k=new Uint32Array([_,l,i,d,o]).buffer,M=E(e,k),S=j(e,this.pipelines.attn_fwd,[M,h,w,y,b,D(e,c*i*4,!0)]);T(e,this.pipelines.attn_fwd,S,[W(l,16),d,_])}{const k=new Uint32Array([l,l,1]).buffer,M=E(e,k),S=j(e,this.pipelines.softmax,[M,b]);T(e,this.pipelines.softmax,S,[l,d,_])}const v=D(e,c*i*4,!0);{const k=new Uint32Array([_,l,i,d,o]).buffer,M=E(e,k),S=j(e,this.pipelines.attn_val,[M,h,w,y,b,v]);T(e,this.pipelines.attn_val,S,[W(l,16),d,_])}h.destroy(),w.destroy(),y.destroy();const P=D(e,c*i*4,!0);{const k=new Uint32Array([c,i,i]).buffer,M=E(e,k),S=j(e,this.pipelines.linear,[M,v,this.gpuWeights.wO,this.gpuWeights.bO,P]);T(e,this.pipelines.linear,S,[W(c,16),W(i,16),1])}v.destroy();let B=D(e,c*i*4,!0);{const k=E(e,new Uint32Array([c*i]).buffer),M=j(e,this.pipelines.elAdd,[P,t,B,k]);T(e,this.pipelines.elAdd,M,[W(c*i,256),1,1])}if(P.destroy(),u){const{ffnMult:k}=this.config,M=i*k,S=D(e,c*M*4,!0);{const z=new Uint32Array([c,i,M]).buffer,K=E(e,z),A=j(e,this.pipelines.linear,[K,B,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,S]);T(e,this.pipelines.linear,A,[W(c,16),W(M,16),1])}const O=D(e,c*M*4,!0);{const z=E(e,new Uint32Array([c*M]).buffer),K=j(e,this.pipelines.silu,[z,S,O]);T(e,this.pipelines.silu,K,[W(c*M,256),1,1])}S.destroy();const G=D(e,c*i*4,!0);{const z=new Uint32Array([c,M,i]).buffer,K=E(e,z),A=j(e,this.pipelines.linear,[K,O,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,G]);T(e,this.pipelines.linear,A,[W(c,16),W(i,16),1])}O.destroy();const q=D(e,c*i*4,!0);{const z=E(e,new Uint32Array([c*i]).buffer),K=j(e,this.pipelines.elAdd,[G,B,q,z]);T(e,this.pipelines.elAdd,K,[W(c*i,256),1,1])}G.destroy(),B.destroy(),B=q}return{output:B,cache:{scores:b}}}parameters(){const{dModel:t,hasFfn:r,ffnMult:n}=this.config,e=[{buf:this.gpuWeights.wQKV,numel:3*t*t,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*t,name:"bQKV"},{buf:this.gpuWeights.wO,numel:t*t,name:"wO"},{buf:this.gpuWeights.bO,numel:t,name:"bO"},{buf:this.gpuWeights.normWeight,numel:t,name:"normWeight"}];if(r){const i=t*n;e.push({buf:this.gpuWeights.wFfn1,numel:i*t,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:i,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:t*i,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:t,name:"bFfn2"})}return e}getTrainableParams(){return this.parameters()}setWSLAMode(t){}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const St=1296190035,Ee={mamba1:0,mamba2:1,mamba3:2,attention:3},Re=["mamba1","mamba2","mamba3","attention"];class ze{device;config;gpuEmbedding;layers;layerSpecs;gpuFinalNorm;tiedEmbedding;gpuLMHeadBias;_lmHeadPipeline;_rmsnormPipeline;_embedPipeline;_wslaMode=!1;constructor(t,r){this.device=t,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...r},Dt(this.config.seed);const n=r.layers??Array.from({length:r.numLayers},()=>({type:"mamba1"}));if(n.length!==r.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${n.length}) must equal numLayers (${r.numLayers}).`);this.layerSpecs=n;const{vocabSize:e,dModel:i}=this.config,a=dt(e*i,1/Math.sqrt(i));this.gpuEmbedding=Q(t,a,!0),this.layers=n.map(u=>this._buildLayer(u)),Dt(void 0),this.gpuFinalNorm=Q(t,new Float32Array(i).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=Q(t,new Float32Array(e),!0),this._lmHeadPipeline=H(t,lt,"linear_forward"),this._rmsnormPipeline=H(t,nt,"rmsnorm_forward"),this._embedPipeline=H(t,He,"embed_lookup")}_buildLayer(t){const r=this.config;switch(t.type){case"mamba1":{const n={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,...r.defaultMamba1};return new Be(this.device,{...n,...t.config??{}})}case"mamba2":{const n={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,nHeads:r.nHeads,nGroups:r.nGroups,chunkLen:r.chunkLen,...r.defaultMamba2};return new Me(this.device,{...n,...t.config??{}})}case"mamba3":{const n={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,nHeads:r.nHeads,nGroups:r.nGroups,chunkLen:r.chunkLen,mimoGroup:r.mimoGroup,...r.defaultMamba3};return new Ce(this.device,{...n,...t.config??{}})}case"attention":{const n={dModel:r.dModel,nHeads:r.nHeads,...r.defaultAttention};return new Te(this.device,{...n,...t.config??{}})}}}embedTokens(t,r,n){const{dModel:e}=this.config,i=r*n,a=Q(this.device,t instanceof Uint32Array?t:new Uint32Array(t),!1),u=D(this.device,i*e*4,!0),o=E(this.device,new Uint32Array([i,e]).buffer),_=j(this.device,this._embedPipeline,[o,a,this.gpuEmbedding,u]);return T(this.device,this._embedPipeline,_,[W(i,64),1,1]),a.destroy(),o.destroy(),u}async forward(t,r,n){const{dModel:e,vocabSize:i}=this.config,a=r*n;let u=this.embedTokens(t,r,n);const o=[];for(const f of this.layers){const{output:p,cache:g}=f.forward(u,r,n);o.push(g),u.destroy(),u=p}const _=D(this.device,a*e*4,!0),l=D(this.device,a*4,!1);{const f=new ArrayBuffer(16);new Uint32Array(f,0,2).set([a,e]),new Float32Array(f,8,1).set([1e-6]);const p=E(this.device,f),g=j(this.device,this._rmsnormPipeline,[p,u,this.gpuFinalNorm,_,l]);T(this.device,this._rmsnormPipeline,g,[W(a,64),1,1])}u.destroy();const c=D(this.device,a*i*4,!0);{const f=new Uint32Array([a,e,i]).buffer,p=E(this.device,f),g=j(this.device,this._lmHeadPipeline,[p,_,this.gpuEmbedding,this.gpuLMHeadBias,c]);T(this.device,this._lmHeadPipeline,g,[W(a,16),W(i,16),1])}return _.destroy(),l.destroy(),{logits:await rt(this.device,c,a*i*4),gpuLogits:c,caches:o}}async embed(t){const{dModel:r}=this.config,n=t.length,e=1,i=e*n;if(i===0)return new Float32Array(r);let a=this.embedTokens(t,e,n);for(const d of this.layers){const{output:f}=d.forward(a,e,n);a.destroy(),a=f}const u=D(this.device,i*r*4,!0),o=D(this.device,i*4,!1);{const d=new ArrayBuffer(16);new Uint32Array(d,0,2).set([i,r]),new Float32Array(d,8,1).set([1e-6]);const f=E(this.device,d),p=j(this.device,this._rmsnormPipeline,[f,a,this.gpuFinalNorm,u,o]);T(this.device,this._rmsnormPipeline,p,[W(i,64),1,1])}a.destroy();const _=await rt(this.device,u,i*r*4);u.destroy(),o.destroy();const l=new Float32Array(r);for(let d=0;d<n;d++){const f=d*r;for(let p=0;p<r;p++)l[p]+=_[f+p]}for(let d=0;d<r;d++)l[d]/=n;let c=0;for(let d=0;d<r;d++)c+=l[d]*l[d];c=Math.sqrt(c)||1;for(let d=0;d<r;d++)l[d]/=c;return l}async generate(t,r=200,n={}){const{temperature:e=1,topK:i=50,topP:a=.9}=n,{vocabSize:u}=this.config,o=[...t];for(let _=0;_<r;_++){const{logits:l}=await this.forward(new Uint32Array(o),1,o.length),c=l.slice((o.length-1)*u,o.length*u),d=Oe(c,{temperature:e,topK:i,topP:a});if(o.push(d),d===this.config.eosId)break}return o}parameters(){const t=[];t.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let r=0;r<this.layers.length;r++)for(const n of this.layers[r].parameters())t.push({...n,name:`layer${r}.${n.name}`});return t.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),t}getTrainableParams(){if(!this._wslaMode)return this.parameters();const t=[];for(let r=0;r<this.layers.length;r++)for(const n of this.layers[r].getTrainableParams())t.push({...n,name:`layer${r}.${n.name}`});return t}setWSLAMode(t){for(const r of this.layers)r.setWSLAMode(t);this._wslaMode=t}async exportWeights(t={}){const r=t.fp16??!1,n=this.parameters(),e=n.length,i=this.layers.length,a=await Promise.all(n.map(g=>rt(this.device,g.buf,g.numel*4))),u=Math.ceil(i/4)*4,o=12+u+4+e*4,_=r?2:4,c=a.reduce((g,h)=>g+h.length,0)*_,d=new ArrayBuffer(o+c),f=new DataView(d);let p=0;f.setUint32(p,St,!0),p+=4,f.setUint32(p,r?3:2,!0),p+=4,f.setUint32(p,i,!0),p+=4;for(let g=0;g<i;g++){const h=this.layers[g].layerType;f.setUint8(p+g,Ee[h])}p+=u,f.setUint32(p,e,!0),p+=4;for(const g of n)f.setUint32(p,g.numel,!0),p+=4;if(r)for(const g of a){const h=zt(g);new Uint16Array(d,p,h.length).set(h),p+=h.length*2}else for(const g of a)new Float32Array(d,p,g.length).set(g),p+=g.byteLength;return le(d)}async loadWeights(t){const r=ue(t);if(r.hasTrailer&&!r.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const n=new DataView(t);let e=0;const i=n.getUint32(e,!0);if(e+=4,i!==St)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const a=n.getUint32(e,!0);if(e+=4,a===1){const u=n.getUint32(e,!0);e+=4;const o=this.parameters();if(u!==o.length)throw new Error(`Weight file has ${u} parameters but this model has ${o.length}.`);const _=[];for(let l=0;l<u;l++)_.push(n.getUint32(e,!0)),e+=4;for(let l=0;l<u;l++){const c=o[l],d=_[l];if(d!==c.numel)throw new Error(`Parameter ${l} ("${c.name}") size mismatch: file=${d}, model=${c.numel}.`);ot(this.device,c.buf,new Float32Array(t,e,c.numel)),e+=c.numel*4}return}if(a===2||a===3){const u=a===3,o=n.getUint32(e,!0);if(e+=4,o!==this.layers.length)throw new Error(`Weight file has ${o} layers but this model has ${this.layers.length}.`);for(let f=0;f<o;f++){const p=n.getUint8(e+f),g=this.layers[f].layerType,h=Re[p]??"mamba1";if(h!==g)throw new Error(`Layer ${f} type mismatch: file="${h}", model="${g}".`)}const _=Math.ceil(o/4)*4;e+=_;const l=n.getUint32(e,!0);e+=4;const c=this.parameters();if(l!==c.length)throw new Error(`Weight file has ${l} parameters but this model has ${c.length}.`);const d=[];for(let f=0;f<l;f++)d.push(n.getUint32(e,!0)),e+=4;for(let f=0;f<l;f++){const p=c[f],g=d[f];if(g!==p.numel)throw new Error(`Parameter ${f} ("${p.name}") size mismatch: file=${g}, model=${p.numel}.`);if(u){const h=new Uint16Array(t,e,g);ot(this.device,p.buf,Ht(h)),e+=g*2}else ot(this.device,p.buf,new Float32Array(t,e,p.numel)),e+=g*4}return}throw new Error(`Unsupported MBJS version: ${a}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const t of this.layers)t.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class da extends ze{constructor(t,r){super(t,{...r,layers:Array.from({length:r.numLayers},()=>({type:"mamba1"}))})}}const He=`
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
`;function Oe(s,{temperature:t=1,topK:r=50,topP:n=.9}={}){const e=s.length,i=new Float32Array(e);for(let h=0;h<e;h++)i[h]=s[h]/Math.max(t,1e-7);let a=-1/0;for(let h=0;h<e;h++)i[h]>a&&(a=i[h]);let u=0;const o=new Float32Array(e);for(let h=0;h<e;h++)o[h]=Math.exp(i[h]-a),u+=o[h];const l=Array.from({length:e},(h,w)=>w).sort((h,w)=>o[w]-o[h]).slice(0,r);let c=0;const d=[];for(const h of l)if(c+=o[h]/u,d.push(h),c>=n)break;let f=0;for(const h of d)f+=o[h];const p=Math.random()*f;let g=0;for(const h of d)if(g+=o[h],g>=p)return h;return d[d.length-1]}class la{model;adam;opt;constructor(t,r={}){this.model=t,this.opt={lr:r.lr??.01,beta1:r.beta1??.9,beta2:r.beta2??.999,eps:r.eps??1e-8,weightDecay:r.weightDecay??0,auxWeight:r.auxWeight??.01,batchSize:r.batchSize??0,epochs:r.epochs??1},this.adam=new ce(t,this.opt)}fit(t){const r=[];for(let n=0;n<this.opt.epochs;n++)r.push(this.runEpoch(t));return r}runEpoch(t){const r=this.opt.batchSize>0?this.opt.batchSize:t.length,{numExperts:n,modelDim:e}=this.model.config;let i=0,a=0;for(let u=0;u<t.length;u+=r){const o=t.slice(u,u+r);this.model.zeroGrad();const _=[],l=[],c=new _e(n);let d=0;for(const g of o){const h=this.model.forward(g.input),w=new Float32Array(e);for(let y=0;y<e;y++){const b=h.output[y]-(g.target[y]??0);w[y]=b,d+=.5*b*b}this.model.backward(w,h.cache),_.push(h.cache.x),l.push(h.route.probs),c.observe(h.route)}const f=c.dispatchFractions(),p=this.opt.auxWeight*n/o.length;for(let g=0;g<_.length;g++)this.model.auxGradStep(_[g],l[g],f,p);this.scaleGradients(1/o.length),this.adam.step(),i+=d,a=c.loss()}return{loss:i/Math.max(1,t.length),auxLoss:a}}scaleGradients(t){if(t!==1)for(const r of this.model.gradients())for(let n=0;n<r.data.length;n++)r.data[n]=r.data[n]*t}}const Ge=Math.LN2;function Ke(s,t){const r=s.length,n=Math.max(1,Math.min(t,r)),e=[],i=new Uint8Array(r);for(let a=0;a<n;a++){let u=-1,o=-1/0;for(let _=0;_<r;_++){if(i[_])continue;const l=s[_];l>o&&(o=l,u=_)}if(u<0)break;i[u]=1,e.push(u)}return e}function qe(s){let t=0,r=-1/0;for(let n=0;n<s.length;n++)s[n]>r&&(r=s[n],t=n);return t}function $e(s){return Math.exp(s)}function Ue(s){return s/Ge}function Xt(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function Vt(s,t,r,n){const e=Math.min(t.length,r.length);for(let i=0;i<e;i++){const a=r[i],u=t[i];a<0||a>=u.length||(s.ceSum+=pt(u,a),qe(u)===a&&s.top1Hits++,Ke(u,n).includes(a)&&s.topKHits++,s.tokens++)}}function Yt(){const s=globalThis;return typeof s.performance?.now=="function"?s.performance.now():Date.now()}function Qt(s){return s.slice(1)}function Jt(s,t,r,n){const e=s.tokens>0?s.ceSum/s.tokens:0,i={sequences:t,tokens:s.tokens,crossEntropy:e,perplexity:$e(e),bitsPerToken:Ue(e),top1Accuracy:s.tokens>0?s.top1Hits/s.tokens:0,topKAccuracy:s.tokens>0?s.topKHits/s.tokens:0,topK:r};return n!==void 0&&(i.elapsedMs=n,i.tokensPerSecond=n>0?s.tokens/n*1e3:0),i}function ht(s,t,r={}){const n=r.topK??5,e=r.measureLatency??!0,i=r.now??Yt,a=Xt();let u=0,o=0;for(const _ of t){if(_.length<2)continue;const l=e?i():0,{logits:c}=s.forward(_);e&&(o+=i()-l),Vt(a,c,Qt(_),n),u++}return Jt(a,u,n,e?o:void 0)}async function ua(s,t,r={}){const n=r.topK??5,e=r.measureLatency??!0,i=r.now??Yt,a=Xt();let u=0,o=0;for(const _ of t){if(_.length<2)continue;const l=e?i():0,{logits:c}=await s.forward(_);e&&(o+=i()-l),Vt(a,c,Qt(_),n),u++}return Jt(a,u,n,e?o:void 0)}function ca(s,t,r,n={}){return Xe(ht(s,r,n),ht(t,r,n))}function Xe(s,t){const r=s.perplexity-t.perplexity,n=t.perplexity>0?s.perplexity/t.perplexity:1/0,e=s.top1Accuracy-t.top1Accuracy,i=.005;let a;Math.abs(n-1)<=i?a="tie":a=r<0?"candidate":"baseline";const u=((1-n)*100).toFixed(1),o=a==="tie"?`Tie: perplexity ${s.perplexity.toFixed(2)} vs ${t.perplexity.toFixed(2)}`:a==="candidate"?`Candidate wins: ${u}% lower perplexity (${s.perplexity.toFixed(2)} vs ${t.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(u)).toFixed(1)}% higher perplexity (${s.perplexity.toFixed(2)} vs ${t.perplexity.toFixed(2)})`;return{candidate:s,baseline:t,perplexityDelta:r,perplexityRatio:n,top1Delta:e,winner:a,summary:o}}function Zt(s,t){return s.split(/(?<=\.)\s+/).map(r=>t.encode(r.trim())).filter(r=>r.length>=2)}function _a(s,t,r,n={}){return ht(s,Zt(r,t),n)}function Ve(s,t){for(let r=s.length-1;r>0;r--){const n=Math.floor(t.next()*(r+1)),e=s[r];s[r]=s[n],s[n]=e}return s}function ha(s,t={}){const r=t.seed??7,n=new he;n.train(s,{numMerges:t.numMerges??100});const e=Zt(s,n);if(e.length<2)throw new Error(`corpus produced ${e.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const i=Ve([...e],new Ot(r>>>0||1)),a=Math.min(.9,Math.max(.05,t.heldOutRatio??.25));let u=Math.round(i.length*a);u=Math.max(1,Math.min(i.length-1,u));const o=i.slice(0,u),_=i.slice(u),l=new ge({vocabSize:n.vocabSize,dModel:t.dModel??32,numLayers:t.numLayers??2,hiddenDim:t.hiddenDim??48,seed:r}),c=t.epochs??30,d=new pe(l,{lr:t.lr??.03,epochs:c}).fit(_),f=ht(l,o,{topK:t.topK??5,measureLatency:!0}),p=l.generateText(t.prompt??"The",n,{maxNewTokens:8,temperature:0});return{...f,trainSequences:_.length,evalSequences:o.length,initialTrainLoss:d[0]??0,finalTrainLoss:d.at(-1)??0,vocabSize:n.vocabSize,sample:p}}const xt=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],te=-10,ee=5;function Ye(s){const{dModel:t,dState:r,dConv:n,dInner:e,dtRank:i}=s;return{wInProj:new Float32Array(2*e*t),bInProj:new Float32Array(2*e),wConv:new Float32Array(e*n),bConv:new Float32Array(e),wXProj:new Float32Array((i+2*r)*e),bXProj:new Float32Array(i+2*r),wDtProj:new Float32Array(e*i),bDtProj:new Float32Array(e),A_log:new Float32Array(e*r),D_vec:new Float32Array(e),wOutProj:new Float32Array(t*e),bOutProj:new Float32Array(t),normWeight:new Float32Array(t)}}function re(s,t,r){const{dModel:n,dState:e,dConv:i,dInner:a,dtRank:u,batch:o,seqLen:_}=r,l=o*_,c=u+2*e,d=new Float32Array(l*n),f=new Float32Array(l);qt(s,t.normWeight,l,n,d,f);const p=new Float32Array(l*2*a);st(d,t.wInProj,t.bInProj,l,n,2*a,p);const g=new Float32Array(l*a),h=new Float32Array(l*a);for(let m=0;m<l;m++)for(let x=0;x<a;x++)g[m*a+x]=p[m*2*a+x],h[m*a+x]=p[m*2*a+a+x];const w=new Float32Array(l*a);for(let m=0;m<o;m++)for(let x=0;x<_;x++){const L=(m*_+x)*a;for(let R=0;R<a;R++){let U=t.bConv[R];for(let I=0;I<i;I++)x>=I&&(U+=t.wConv[R*i+I]*g[(m*_+x-I)*a+R]);w[L+R]=U}}const y=new Float32Array(l*a);for(let m=0;m<l*a;m++)y[m]=Pt(w[m]);const b=new Float32Array(l*c);st(y,t.wXProj,t.bXProj,l,a,c,b);const v=new Float32Array(l*u),P=new Float32Array(l*e),B=new Float32Array(l*e);for(let m=0;m<l;m++){for(let x=0;x<u;x++)v[m*u+x]=b[m*c+x];for(let x=0;x<e;x++)P[m*e+x]=b[m*c+u+x],B[m*e+x]=b[m*c+u+e+x]}const F=new Float32Array(l*a);st(v,t.wDtProj,t.bDtProj,l,u,a,F);const k=new Float32Array(l*a);for(let m=0;m<l*a;m++)k[m]=me(F[m]);const M=new Float32Array(a*e);for(let m=0;m<a*e;m++)M[m]=-Math.exp(Math.min(ee,Math.max(te,t.A_log[m])));const S=new Float32Array(l*a*e),O=new Float32Array(l*a*e),G=new Float32Array(l*a*e),q=new Float32Array(l*a);for(let m=0;m<o;m++)for(let x=0;x<_;x++){const L=m*_+x;for(let R=0;R<a;R++){const U=k[L*a+R],I=y[L*a+R];let C=t.D_vec[R]*I;for(let N=0;N<e;N++){const $=M[R*e+N],J=Math.exp(U*$),X=(J-1)/$*P[L*e+N],V=(L*a+R)*e+N;S[V]=J,O[V]=X;const tt=x===0?0:G[((L-1)*a+R)*e+N],at=J*tt+X*I;G[V]=at,C+=B[L*e+N]*at}q[L*a+R]=C}}const z=new Float32Array(l*a),K=new Float32Array(l*a);for(let m=0;m<l*a;m++)z[m]=Pt(h[m]),K[m]=q[m]*z[m];const A=new Float32Array(l*n);st(K,t.wOutProj,t.bOutProj,l,a,n,A);for(let m=0;m<l*n;m++)A[m]=A[m]+s[m];return{output:A,cache:{x:s,normInv:f,normOut:d,xConvIn:g,z:h,convOut:w,u:y,dtRaw:v,bRaw:P,cRaw:B,deltaFull:F,dv:k,aCont:M,aBar:S,bBar:O,h:G,scanY:q,siluZ:z,gated:K}}}function Qe(s,t,r,n,e){const{dModel:i,dState:a,dConv:u,dInner:o,dtRank:_,batch:l,seqLen:c}=n,d=l*c,f=_+2*a,p=new Float32Array(d*i);p.set(s);const g=new Float32Array(d*o);ct(s,r.gated,t.wOutProj,d,o,i,g,e.wOutProj,e.bOutProj);const h=new Float32Array(d*o),w=new Float32Array(d*o);for(let A=0;A<d*o;A++)h[A]=g[A]*r.siluZ[A],w[A]=g[A]*r.scanY[A]*Bt(r.z[A]);const y=new Float32Array(d*o),b=new Float32Array(d*a),v=new Float32Array(d*a),P=new Float32Array(d*o),B=new Float32Array(o*a),F=new Float32Array(o*a);for(let A=0;A<l;A++){F.fill(0);for(let m=c-1;m>=0;m--){const x=A*c+m;for(let L=0;L<o;L++){const R=h[x*o+L],U=r.u[x*o+L],I=r.dv[x*o+L];e.D_vec[L]=e.D_vec[L]+R*U,y[x*o+L]=y[x*o+L]+R*t.D_vec[L];let C=0;for(let N=0;N<a;N++){const $=(x*o+L)*a+N,J=r.h[$],X=r.aBar[$],V=r.bBar[$],tt=r.aCont[L*a+N],at=r.cRaw[x*a+N];v[x*a+N]=v[x*a+N]+R*J;const ut=R*at+F[L*a+N],de=m===0?0:r.h[((x-1)*o+L)*a+N],kt=ut*de,bt=ut*U;y[x*o+L]=y[x*o+L]+ut*V,F[L*a+N]=ut*X;const Lt=r.bRaw[x*a+N];C+=kt*tt*X+bt*X*Lt,B[L*a+N]=B[L*a+N]+kt*I*X+bt*Lt*((I*X*tt-(X-1))/(tt*tt)),b[x*a+N]=b[x*a+N]+bt*((X-1)/tt)}P[x*o+L]=P[x*o+L]+C}}}for(let A=0;A<o*a;A++){const m=t.A_log[A];m<=te||m>=ee||(e.A_log[A]=e.A_log[A]+B[A]*r.aCont[A])}const k=new Float32Array(d*o);for(let A=0;A<d*o;A++)k[A]=P[A]*Gt(r.deltaFull[A]);const M=new Float32Array(d*_);ct(k,r.dtRaw,t.wDtProj,d,_,o,M,e.wDtProj,e.bDtProj);const S=new Float32Array(d*f);for(let A=0;A<d;A++){for(let m=0;m<_;m++)S[A*f+m]=M[A*_+m];for(let m=0;m<a;m++)S[A*f+_+m]=b[A*a+m],S[A*f+_+a+m]=v[A*a+m]}const O=new Float32Array(d*o);ct(S,r.u,t.wXProj,d,o,f,O,e.wXProj,e.bXProj);for(let A=0;A<d*o;A++)y[A]=y[A]+O[A];const G=new Float32Array(d*o);for(let A=0;A<d*o;A++)G[A]=y[A]*Bt(r.convOut[A]);const q=new Float32Array(d*o);for(let A=0;A<l;A++)for(let m=0;m<c;m++){const x=A*c+m;for(let L=0;L<o;L++){const R=G[x*o+L];if(R!==0){e.bConv[L]=e.bConv[L]+R;for(let U=0;U<u;U++){if(m<U)continue;const I=(A*c+m-U)*o+L;e.wConv[L*u+U]=e.wConv[L*u+U]+R*r.xConvIn[I],q[I]=q[I]+R*t.wConv[L*u+U]}}}}const z=new Float32Array(d*2*o);for(let A=0;A<d;A++)for(let m=0;m<o;m++)z[A*2*o+m]=q[A*o+m],z[A*2*o+o+m]=w[A*o+m];const K=new Float32Array(d*i);return ct(z,r.normOut,t.wInProj,d,i,2*o,K,e.wInProj,e.bInProj),Kt(K,r.x,t.normWeight,r.normInv,d,i,p,e.normWeight,vt),p}const Ct=["mamba1"];function Je(s){const t={dModel:s.dModel,dState:s.dState,dConv:s.dConv,dInner:s.dInner,dtRank:s.dtRank};return{embedding:new Float32Array(s.vocabSize*s.dModel),finalNorm:new Float32Array(s.dModel),lmHeadBias:new Float32Array(s.vocabSize),layers:Array.from({length:s.numLayers},()=>Ye(t))}}function Ze(s){const t=new Map;t.set("embedding",s.embedding);for(let r=0;r<s.layers.length;r++){const n=s.layers[r];for(const e of xt)t.set(`layer${r}.${e}`,n[e])}return t.set("final_norm",s.finalNorm),t.set("lm_head_bias",s.lmHeadBias),t}function tr(s){const t=new Map;t.set("embedding",s.embedding);for(let r=0;r<s.layers.length;r++){const n=s.layers[r];for(const e of xt)t.set(`layer${r}.${e}`,n[e])}return t.set("final_norm",s.finalNorm),t.set("lm_head_bias",s.lmHeadBias),t}function er(s,t){const r=(l,c)=>{const d=s.get(l);if(!d)throw new Error(`cpuWeightsFromNamed: missing tensor "${l}"`);if(d.length!==c)throw new Error(`cpuWeightsFromNamed: "${l}" has ${d.length} elements, expected ${c}`);return d},{dModel:n,dState:e,dConv:i,dInner:a,dtRank:u}=t,o={wInProj:2*a*n,bInProj:2*a,wConv:a*i,bConv:a,wXProj:(u+2*e)*a,bXProj:u+2*e,wDtProj:a*u,bDtProj:a,A_log:a*e,D_vec:a,wOutProj:n*a,bOutProj:n,normWeight:n},_=[];for(let l=0;l<t.numLayers;l++){const c={};for(const d of xt)c[d]=r(`layer${l}.${d}`,o[d]);_.push(c)}return{embedding:r("embedding",t.vocabSize*n),finalNorm:r("final_norm",n),lmHeadBias:r("lm_head_bias",t.vocabSize),layers:_}}function ae(s,t,r,n,e,i=!1){const{vocabSize:a,dModel:u}=r,o=n*e;let _=new Float32Array(o*u);for(let h=0;h<o;h++){const w=s[h];if(w<0||w>=a)throw new Error(`token id ${w} out of range [0, ${a})`);_.set(t.embedding.subarray(w*u,(w+1)*u),h*u)}const l={dModel:u,dState:r.dState,dConv:r.dConv,dInner:r.dInner,dtRank:r.dtRank,batch:n,seqLen:e},c=[],d=[];for(let h=0;h<r.numLayers;h++){c.push(_);const{output:w,cache:y}=re(_,t.layers[h],l);i||d.push(y),_=w}const f=new Float32Array(o*u),p=new Float32Array(o);qt(_,t.finalNorm,o,u,f,p,vt);const g=new Float32Array(o*a);return st(f,t.embedding,t.lmHeadBias,o,u,a,g),{hiddenIn:c,layer:d,lastHidden:_,normOut:f,normInv:p,logits:g}}function rr(s,t,r,n,e){return ae(s,t,r,n,e).logits}function ga(s,t,r,n,e,i){const a=rr(s,r,n,e,i),u=e*i,o=n.vocabSize;let _=0;for(let l=0;l<u;l++)_+=pt(a.subarray(l*o,(l+1)*o),t[l]);return _/u}function ar(s,t,r,n,e,i,a={}){const{vocabSize:u,dModel:o}=n,_=e*i,l=a.activationCheckpointing??!1,c=ae(s,r,n,e,i,l),d=Je(n);let f=0;const p=new Float32Array(_*u);for(let v=0;v<_;v++){const P=c.logits.subarray(v*u,(v+1)*u),B=t[v];f+=pt(P,B);const F=fe(P,B);for(let k=0;k<u;k++)p[v*u+k]=F[k]/_}const g=f/_,h=new Float32Array(_*o);for(let v=0;v<_;v++){const P=v*u,B=v*o;for(let F=0;F<u;F++){const k=p[P+F];if(k===0)continue;d.lmHeadBias[F]=d.lmHeadBias[F]+k;const M=F*o;for(let S=0;S<o;S++)h[B+S]=h[B+S]+k*r.embedding[M+S],d.embedding[M+S]=d.embedding[M+S]+k*c.normOut[B+S]}}const w=new Float32Array(_*o);Kt(h,c.lastHidden,r.finalNorm,c.normInv,_,o,w,d.finalNorm,vt);const y={dModel:o,dState:n.dState,dConv:n.dConv,dInner:n.dInner,dtRank:n.dtRank,batch:e,seqLen:i};let b=w;for(let v=n.numLayers-1;v>=0;v--){const P=l?re(c.hiddenIn[v],r.layers[v],y).cache:c.layer[v];b=Qe(b,r.layers[v],P,y,d.layers[v])}for(let v=0;v<_;v++){const B=s[v]*o,F=v*o;for(let k=0;k<o;k++)d.embedding[B+k]=d.embedding[B+k]+b[F+k]}return{loss:g,grads:Ze(d)}}function nr(s,t){const{dModel:r,dState:n,dConv:e,dInner:i,dtRank:a}=t;if(s==="embedding")return[t.vocabSize,r];switch(s.startsWith("layer")?s.slice(s.indexOf(".")+1):s){case"wInProj":return[2*i,r];case"wConv":return[i,e];case"wXProj":return[a+2*n,i];case"wDtProj":return[i,a];case"A_log":return[i,n];case"wOutProj":return[r,i];default:return null}}const ir=["wInProj","wXProj","wDtProj","wOutProj"],sr=.05;class pa{model;tokenizer;device;_moments;_step;_dims;_mirror;_mirrorByName;_adapters;_loraBase;_shard;constructor(t,r=null){this.model=t,this.tokenizer=r,this.device=t.device,this._moments=new Map,this._step=0,this._dims=or(t),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const t=this.model.getTrainableParams();if(this._adapters.size===0)return t.reduce((n,e)=>n+e.numel,0);let r=0;for(const n of t){const e=this._adapters.get(n.name);e&&(r+=e.numParams())}return r}_owns(t){return this._shard===null||t%this._shard.count===this._shard.index}_installAdapters(t){if(this._adapters.size>0)return;const r=new Set(t.targets??ir),n=this._mirrorByName;for(const e of this.model.getTrainableParams()){const i=e.name.includes(".")?e.name.slice(e.name.indexOf(".")+1):e.name;if(!r.has(i))continue;const a=nr(e.name,this._dims);if(!a)continue;const[u,o]=a,_=Math.max(1,Math.min(t.rank??8,u,o));this._adapters.set(e.name,new be(u,o,{...t,rank:_})),this._loraBase.set(e.name,Float32Array.from(n.get(e.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...r].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const t=this._mirrorByName;for(const[r,n]of this._adapters){const e=t.get(r),i=this._loraBase.get(r),a=n.delta();for(let u=0;u<e.length;u++)e[u]=i[u]+a[u]}}_momentFor(t){let r=this._moments.get(t.name);return r||(r={m:new Float32Array(t.numel),v:new Float32Array(t.numel)},this._moments.set(t.name,r)),r}async _syncMirrorFromGpu(){const t=new Map;for(const r of this.model.parameters())t.set(r.name,await rt(this.device,r.buf,r.numel*4));t.set("lm_head_bias",await rt(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=er(t,this._dims),this._mirrorByName=tr(this._mirror)}async train(t,r={}){const{learningRate:n=1e-4,epochs:e=5,batchSize:i=1,seqLen:a=512,maxGradNorm:u=1,weightDecay:o=.01,beta1:_=.9,beta2:l=.999,eps:c=1e-8,wsla:d=!1,onEpochEnd:f=null}=r,p=Math.max(1,Math.floor(r.gradientAccumulation??1));if(this._shard=r.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const g=r.maxDelta??(d?sr:0);d&&this.model.setWSLAMode(!0);let h;if(typeof t=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");h=this.tokenizer.encode(t)}else h=Array.from(t);if(h.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const w=dr(h,a);if(w.length===0)throw new Error("Input is too short to form any training chunk.");const y=lr(w,Math.max(1,Math.floor(i)));await this._syncMirrorFromGpu(),r.lora&&this._installAdapters(r.lora);const b=[];for(let v=0;v<e;v++){let P=0,B=0,F=0;for(let M=0;M<y.length;M+=p){const S=y.slice(M,M+p),{loss:O,gradNorm:G}=await this._trainStep(S,{learningRate:n,maxGradNorm:u,weightDecay:o,beta1:_,beta2:l,eps:c,wsla:d,maxDelta:g,...r.activationCheckpointing?{activationCheckpointing:!0}:{}});P+=O,B+=G,F++}const k=P/F;b.push(k),f&&f(v+1,k,B/F)}return d&&this.model.setWSLAMode(!1),b}async _trainStep(t,r){const{learningRate:n,maxGradNorm:e,weightDecay:i,beta1:a,beta2:u,eps:o,maxDelta:_}=r;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const l=this._mirror,c=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const d=r.activationCheckpointing?{activationCheckpointing:!0}:{};let f=0,p=new Map;for(const b of t){const v=ar(b.inputs,b.targets,l,this._dims,b.batch,b.seqLen,d);if(f+=v.loss/t.length,p.size===0){for(const P of v.grads.values())for(let B=0;B<P.length;B++)P[B]=P[B]/t.length;p=v.grads}else for(const[P,B]of v.grads){const F=p.get(P);for(let k=0;k<B.length;k++)F[k]=F[k]+B[k]/t.length}}const g=this.model.getTrainableParams();if(this._adapters.size>0)for(const[b,v]of this._adapters){const P=p.get(b);P&&(v.zeroGrad(),v.accumulateGradient(P))}let h=0;for(const b of g){const v=p.get(b.name);if(v)for(let P=0;P<v.length;P++)h+=v[P]*v[P]}const w=Math.sqrt(h),y=e>0&&w>e?e/w:1;return this._adamwStep(g,p,c,{learningRate:n,weightDecay:i,beta1:a,beta2:u,eps:o,beta1_t:Math.pow(a,this._step),beta2_t:Math.pow(u,this._step),maxDelta:_,gradScale:y}),{loss:f,gradNorm:w}}_adamwStep(t,r,n,e){const{learningRate:i,weightDecay:a,beta1:u,beta2:o,eps:_,beta1_t:l,beta2_t:c,maxDelta:d,gradScale:f}=e,p={lr:i,beta1:u,beta2:o,eps:_,weightDecay:a,beta1_t:l,beta2_t:c,maxDelta:d,gradScale:f};for(let g=0;g<t.length;g++){const h=t[g];if(!this._owns(g))continue;const w=this._adapters.get(h.name);if(w){const P=n.get(h.name),B=this._loraBase.get(h.name),[F,k]=[w.A,w.B],[M,S]=[w.gradients()[1].data,w.gradients()[0].data],O=this._momentNamed(`${h.name}::loraB`,k.length),G=this._momentNamed(`${h.name}::loraA`,F.length);_t(k,S,O.m,O.v,p),_t(F,M,G.m,G.v,p);const q=w.delta();for(let z=0;z<P.length;z++)P[z]=B[z]+q[z];ot(this.device,h.buf,P);continue}const y=r.get(h.name),b=n.get(h.name);if(!y||!b)continue;if(y.length!==h.numel||b.length!==h.numel)throw new Error(`MambaTrainer: parameter "${h.name}" is ${h.numel} elements but the gradient engine produced ${y.length} — model and CPU mirror disagree.`);const v=this._momentFor(h);_t(b,y,v.m,v.v,p),ot(this.device,h.buf,b)}}_momentNamed(t,r){let n=this._moments.get(t);return n||(n={m:new Float32Array(r),v:new Float32Array(r)},this._moments.set(t,n)),n}optimizerStateBytes(){let t=0;for(const r of this._moments.values())t+=r.m.byteLength+r.v.byteLength;return t}async evaluate(t){let r;if(typeof t=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");r=Array.from(this.tokenizer.encode(t))}else r=Array.from(t);const n=r.length,e=this.model.config.vocabSize,{logits:i}=await this.model.forward(new Uint32Array(r.slice(0,-1)),1,n-1);let a=0;for(let o=0;o<n-1;o++){const _=o*e;a+=pt(i.slice(_,_+e),r[o+1])}const u=a/(n-1);return Math.exp(u)}}function or(s){const t=s.layerSpecs.map((i,a)=>({i:a,type:i.type})).filter(({type:i})=>!Ct.includes(i));if(t.length>0){const i=t.map(({i:a,type:u})=>`layer${a}=${u}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${Ct.join("/")} layers only, but this model has ${i}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const r=s.layers[0],n=r?.dInner??s.config.expand*s.config.dModel,e=r?.dtRank??Math.ceil(s.config.dModel/16);return{vocabSize:s.config.vocabSize,dModel:s.config.dModel,dState:s.config.dState,dConv:s.config.dConv,dInner:n,dtRank:e,numLayers:s.layers.length}}function dr(s,t){const r=[];for(let e=0;e+t<s.length;e+=t)r.push({inputs:s.slice(e,e+t),targets:s.slice(e+1,e+t+1)});const n=s.length%t;if(n>1){const e=s.length-n;r.push({inputs:s.slice(e,-1),targets:s.slice(e+1)})}return r}function lr(s,t){const r=[];let n=0;for(;n<s.length;){const e=s[n].inputs.length,i=[];for(;n<s.length&&i.length<t&&s[n].inputs.length===e;)i.push(s[n]),n++;r.push({inputs:i.flatMap(a=>a.inputs),targets:i.flatMap(a=>a.targets),batch:i.length,seqLen:e})}return r}function ma(s,t,r){return[...t,...s.encode(r)]}function ur(s,t,r,n){if(s.config.vocabSize!==t.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${s.config.vocabSize}) must equal codec.vocabSize (${t.vocabSize})`);const e=s.generate(r,{...n,stopToken:n.stopToken??t.vocab.eosVideo});return{video:t.decode(e),tokens:e}}function fa(s,t,r,n){const{video:e,tokens:i}=ur(s,t.video,r,n);return{image:e[0]??new Float32Array(t.frameSize),tokens:i}}const cr=0,_r=5,hr=2;class Z{parts=[];byte(t){this.parts.push(t&255)}rawVarint(t){if(t<0||!Number.isFinite(t))throw new Error(`ProtoWriter: bad varint ${t}`);let r=t;for(;r>=128;)this.byte(r%128|128),r=Math.floor(r/128);this.byte(r)}tag(t,r){this.rawVarint(t*8+r)}rawBytes(t){for(let r=0;r<t.length;r++)this.byte(t[r])}varint(t,r){this.tag(t,cr),this.rawVarint(r)}float(t,r){this.tag(t,_r);const n=new ArrayBuffer(4);new DataView(n).setFloat32(0,r,!0),this.rawBytes(new Uint8Array(n))}bytes(t,r){this.tag(t,hr),this.rawVarint(r.length),this.rawBytes(r)}string(t,r){this.bytes(t,new TextEncoder().encode(r))}message(t,r){this.bytes(t,r.finish())}finish(){return Uint8Array.from(this.parts)}}function gr(s){const t=new Uint8Array(s.length*4),r=new DataView(t.buffer);for(let n=0;n<s.length;n++)r.setFloat32(n*4,s[n],!0);return t}const pr=18,mr=8,ne=1,ie=7,fr=1,br=2,wr=3,vr=7;class yr{nodes=[];inits=[];uid=0;tmp(t){return`${t}_${this.uid++}`}initFloat(t,r,n){return this.inits.push({name:t,dims:r,dataType:ne,raw:gr(n)}),t}initInt64(t,r,n){return this.inits.push({name:t,dims:r,dataType:ie,int64:n}),t}node(t,r,n,e=[]){return this.nodes.push({op:t,inputs:r,outputs:n,name:`${t}_${this.uid++}`,attrs:e}),n}op(t,r,n,e=[]){const i=this.tmp(n);return this.node(t,r,[i],e),i}}function Ft(s,t,r,n,e){const i=s.op("Mul",[t,t],"rms_sq"),a=s.op("ReduceMean",[i,e],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),u=s.op("Add",[a,n],"rms_eps"),o=s.op("Sqrt",[u],"rms_r"),_=s.op("Div",[t,o],"rms_div");return s.op("Mul",[_,r],"rms_y")}function It(s,t,r,n,e,i){const a=s.op("Transpose",[r],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),u=s.op("Add",[s.op("MatMul",[t,a],"ffn_mm1"),n],"ffn_pre"),o=s.op("Relu",[u],"ffn_h"),_=s.op("Transpose",[e],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return s.op("Add",[s.op("MatMul",[o,_],"ffn_mm2"),i],"ffn_y")}function jt(s,t={}){const r=$t(s),n=Ut(s),e=new Map(n.map(b=>[b.name,b])),i=b=>{const v=e.get(b);if(!v)throw new Error(`export/onnx: missing tensor ${b}`);return v},a=new yr,{vocabSize:u,dModel:o,numLayers:_,convKernel:l,numExperts:c,topK:d}=r,f=a.initFloat("token_embedding.weight",[u,o],i("token_embedding.weight").data),p=a.initFloat("rms_eps",[1],new Float32Array([1e-5])),g=a.initInt64("axes_last",[1],[2]),h=a.initInt64("topk_k",[1],[d]);let w=a.op("Gather",[f,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let b=0;b<_;b++){const v=`layers.${b}`,P=a.initFloat(`${v}.norm_conv.weight`,[o],i(`${v}.norm_conv.weight`).data),B=Ft(a,w,P,p,g),F=i(`${v}.conv.weight`).data,k=new Float32Array(o*l);for(let X=0;X<o;X++)for(let V=0;V<l;V++)k[X*l+(l-1-V)]=F[X*l+V];const M=a.initFloat(`${v}.conv.onnx_weight`,[o,1,l],k),S=a.op("Transpose",[B],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),O=a.op("Conv",[S,M],"conv_out",[{kind:"i",name:"group",value:o},{kind:"ints",name:"kernel_shape",value:[l]},{kind:"ints",name:"pads",value:[l-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),G=a.op("Transpose",[O],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),q=a.op("Add",[w,G],"after_conv"),z=a.initFloat(`${v}.norm_moe.weight`,[o],i(`${v}.norm_moe.weight`).data),K=Ft(a,q,z,p,g),A=a.initFloat(`${v}.moe.router.weight`,[c,o],i(`${v}.moe.router.weight`).data),m=a.op("Transpose",[A],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),x=a.op("MatMul",[K,m],"router_logits"),L=a.tmp("topk_v"),R=a.tmp("topk_i");a.node("TopK",[x,h],[L,R],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const U=a.op("Softmax",[L],"gates",[{kind:"i",name:"axis",value:2}]),I=a.op("Sub",[x,x],"zeros"),C=a.op("ScatterElements",[I,R,U],"combine",[{kind:"i",name:"axis",value:2}]),N=It(a,K,a.initFloat(`${v}.moe.shared.w1`,[r.hiddenDim,o],i(`${v}.moe.shared.w1`).data),a.initFloat(`${v}.moe.shared.b1`,[r.hiddenDim],i(`${v}.moe.shared.b1`).data),a.initFloat(`${v}.moe.shared.w2`,[o,r.hiddenDim],i(`${v}.moe.shared.w2`).data),a.initFloat(`${v}.moe.shared.b2`,[o],i(`${v}.moe.shared.b2`).data)),$=Array.from({length:c},(X,V)=>a.tmp(`combine_${V}`));a.node("Split",[C],$,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:c}]);let J=N;for(let X=0;X<c;X++){const V=`${v}.moe.experts.${X}`,tt=It(a,K,a.initFloat(`${V}.w1`,[r.hiddenDim,o],i(`${V}.w1`).data),a.initFloat(`${V}.b1`,[r.hiddenDim],i(`${V}.b1`).data),a.initFloat(`${V}.w2`,[o,r.hiddenDim],i(`${V}.w2`).data),a.initFloat(`${V}.b2`,[o],i(`${V}.b2`).data)),at=a.op("Mul",[$[X],tt],"expert_w");J=a.op("Add",[J,at],"moe_acc")}w=a.op("Add",[q,J],"after_moe")}const y=a.op("Transpose",[f],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return a.node("MatMul",[w,y],["logits"]),Br(a,r,t)}function xr(s){const t=new Z;switch(t.string(1,s.name),s.kind){case"i":t.varint(20,br),t.varint(3,s.value);break;case"ints":t.varint(20,vr);for(const r of s.value)t.varint(8,r);break;case"f":t.varint(20,fr),t.float(2,s.value);break;case"s":t.varint(20,wr),t.string(4,s.value);break}return t}function Ar(s){const t=new Z;for(const r of s.inputs)t.string(1,r);for(const r of s.outputs)t.string(2,r);t.string(3,s.name),t.string(4,s.op);for(const r of s.attrs)t.message(5,xr(r));return t}function kr(s){const t=new Z;for(const r of s.dims)t.varint(1,r);if(t.varint(2,s.dataType),t.string(8,s.name),s.int64)for(const r of s.int64)t.varint(7,r);return s.raw&&t.bytes(9,s.raw),t}function Lr(s){const t=new Z;return t.string(2,s),t}function Dr(s){const t=new Z;return t.varint(1,s),t}function Tt(s,t,r){const n=new Z;for(const u of r)n.message(1,typeof u=="string"?Lr(u):Dr(u));const e=new Z;e.varint(1,t),e.message(2,n);const i=new Z;i.message(1,e);const a=new Z;return a.string(1,s),a.message(2,i),a}function Br(s,t,r){const n=new Z;for(const a of s.nodes)n.message(1,Ar(a));n.string(2,"evermind");for(const a of s.inits)n.message(5,kr(a));n.message(11,Tt("input_ids",ie,["batch","seq"])),n.message(12,Tt("logits",ne,["batch","seq",t.vocabSize]));const e=new Z;e.string(1,""),e.varint(2,pr);const i=new Z;return i.varint(1,mr),i.string(2,r.producerName??"builderforce-memory-engine"),i.string(3,r.producerVersion??"evermind"),i.message(7,n),i.message(8,e),i.finish()}const Pr=1179993927,Nr=3,it=32,Mr=4,Wr=8,Sr=0,Cr=1;class Fr{buf=new Uint8Array(1024);len=0;ensure(t){if(this.len+t<=this.buf.length)return;let r=this.buf.length*2;for(;r<this.len+t;)r*=2;const n=new Uint8Array(r);n.set(this.buf.subarray(0,this.len)),this.buf=n}u32(t){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,t,!0),this.len+=4}u64(t){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(t),!0),this.len+=8}raw(t){this.ensure(t.length),this.buf.set(t,this.len),this.len+=t.length}alignTo(t){const r=(t-this.len%t)%t;r>0&&(this.ensure(r),this.len+=r)}string(t){const r=new TextEncoder().encode(t);this.u64(r.length),this.raw(r)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function Ir(s,t){if(!t){const e=new Uint8Array(s.length*4),i=new DataView(e.buffer);for(let a=0;a<s.length;a++)i.setFloat32(a*4,s[a],!0);return e}const r=new Uint8Array(s.length*2),n=new DataView(r.buffer);for(let e=0;e<s.length;e++)n.setUint16(e*2,we(s[e]),!0);return r}function Et(s,t={}){const r=t.fp16??!1,n=$t(s),e=Ut(s),i=r?Cr:Sr,a=r?2:4,u=[["evermind.vocab_size",n.vocabSize],["evermind.embedding_length",n.dModel],["evermind.block_count",n.numLayers],["evermind.conv_kernel",n.convKernel],["evermind.feed_forward_length",n.hiddenDim],["evermind.expert_count",n.numExperts],["evermind.expert_used_count",n.topK],["general.alignment",it]],o=[["general.architecture","evermind"],["general.name",t.name??"Evermind"]],_=new Fr;_.u32(Pr),_.u32(Nr),_.u64(e.length),_.u64(u.length+o.length);for(const[p,g]of o)_.string(p),_.u32(Wr),_.string(g);for(const[p,g]of u)_.string(p),_.u32(Mr),_.u32(g);const l=p=>[...p.shape].reverse();let c=0;const d=[];for(const p of e){d.push(c);const g=p.data.length*a;c+=g,c+=(it-c%it)%it}e.forEach((p,g)=>{_.string(p.name);const h=l(p);_.u32(h.length);for(const w of h)_.u64(w);_.u32(i),_.u64(d[g])}),_.alignTo(it);const f=_.length;for(let p=0;p<e.length;p++){const g=f+d[p];for(;_.length<g;)_.raw(new Uint8Array(1));_.raw(Ir(e[p].data,r))}return _.bytes()}const ba=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],jr="application/json";function wt(s,t){return{path:s,data:JSON.stringify(t,null,2),contentType:jr}}function wa(s,t,r={},n){const e=ve(s),i=()=>({format:t,files:[],paramCount:e});switch(t){case"safetensors":{const a=i();return a.files.push({path:"model.safetensors",data:Nt(s,{fp16:r.fp16}),contentType:"application/octet-stream"}),a}case"onnx":{const a=i();return a.files.push({path:"model.onnx",data:jt(s,{producerVersion:r.version}),contentType:"application/octet-stream"}),a}case"gguf":{const a=i();return a.files.push({path:"model.gguf",data:Et(s,{name:r.name,fp16:r.fp16}),contentType:"application/octet-stream"}),a}case"huggingface":{if(!n)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const a=i();return a.files.push({path:"model.safetensors",data:Nt(s,{fp16:r.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:jt(s,{producerVersion:r.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:Et(s,{name:r.name,fp16:r.fp16}),contentType:"application/octet-stream"},wt("config.json",ye(s)),wt("generation_config.json",ke()),wt("tokenizer.json",xe(n)),{path:"README.md",data:Ae(s,r),contentType:"text/markdown"}),a}default:throw new Error(`exportEvermind: unknown format "${String(t)}"`)}}const Tr=`

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
`,va=`

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
`,ya={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},Er={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},se=8,gt=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],Rr=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],oe=[0,.2,.5,.5,.8,.5,.7,.5];function At(s,t){const r=Rr[s];return r?Number.isNaN(t)?r[0]:Math.max(r[0],Math.min(r[1],t)):t}function xa(s){for(let t=0;t<s.length&&t<se;t++)s[t]=At(t,s[t]);return s}function zr(){return Float32Array.from(oe)}function Hr(s){const t={};for(let r=0;r<gt.length;r++)t[gt[r]]=s[r]??0;return t}function Or(s){const t=zr();for(let r=0;r<gt.length;r++){const n=s[gt[r]];typeof n=="number"&&!Number.isNaN(n)&&(t[r]=At(r,n))}return t}function et(s){return((typeof s=="number"&&!Number.isNaN(s)?Math.max(0,Math.min(100,s)):50)-50)/50}function Gr(s){const t=Hr(oe);if(!s)return t;const r=et(s.openness),n=et(s.emotionality),e=et(s.conscientiousness),i=et(s.extraversion),a=et(s.regulatoryFocus),u=et(s.riskTolerance),o=et(s.grit),_=et(s.stimulation),l=(c,d)=>{t[c]=At(Er[c],d)};return l("driveCuriosity",.5+.35*r+.15*_),l("exploration",.4+.3*r+.25*u+.15*a),l("driveCaution",.5+.3*e-.3*u-.2*a+.15*n),l("arousal",.2+.2*n+.1*i),l("driveSocial",.5+.35*i),l("driveEffort",.8+.15*o+.1*e),l("valence",0+.1*a-.1*n),l("attention",.7+.1*e),t}function Aa(s){return Or(Gr(s))}const Kr={inputDim:32,hiddenDim:16,stateDim:se,rewardWeight:.5},Rt=1280131651,qr=296863214;class ka{config;win;ws;aLogit;woutState;boutState;woutReward;boutReward;gWin;gWs;gALogit;gWoutState;gBoutState;gWoutReward;gBoutReward;constructor(t={}){const r={...Kr,...t};if(r.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${r.hiddenDim})`);this.config=r;const{inputDim:n,hiddenDim:e,stateDim:i}=r,a=new Ot((t.seed??qr)>>>0||1),u=_=>{const l=Math.max(a.next(),1e-12),c=a.next();return _*Math.sqrt(-2*Math.log(l))*Math.cos(2*Math.PI*c)},o=(_,l)=>{const c=new Float32Array(_);for(let d=0;d<_;d++)c[d]=u(l);return c};this.win=o(e*n,.1),this.ws=o(e*i,.1),this.aLogit=o(e,.05),this.woutState=o(i*e,.05),this.boutState=new Float32Array(i),this.woutReward=o(e,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(t,r,n){const e=this._forwardCached(t,r,n);return{hidden:e.hn,delta:e.delta,reward:e.reward}}_forwardCached(t,r,n){const{inputDim:e,hiddenDim:i,stateDim:a}=this.config,u=Float32Array.from({length:e},(g,h)=>t[h]??0),o=Float32Array.from({length:i},(g,h)=>r[h]??0),_=Float32Array.from({length:a},(g,h)=>n[h]??0),l=new Float32Array(i),c=new Float32Array(i),d=new Float32Array(i);for(let g=0;g<i;g++){let h=0;const w=g*e;for(let b=0;b<e;b++)h+=this.win[w+b]*u[b];const y=g*a;for(let b=0;b<a;b++)h+=this.ws[y+b]*_[b];l[g]=Gt(this.aLogit[g]),c[g]=Math.tanh(h),d[g]=l[g]*o[g]+(1-l[g])*c[g]}const f=new Float32Array(a);for(let g=0;g<a;g++){let h=this.boutState[g];const w=g*i;for(let y=0;y<i;y++)h+=this.woutState[w+y]*d[y];f[g]=Math.tanh(h)}let p=this.boutReward[0];for(let g=0;g<i;g++)p+=this.woutReward[g]*d[g];return{x:u,sPrev:_,hPrev:o,a:l,t:c,hn:d,delta:f,reward:p}}backwardStep(t,r,n,e,i){const{inputDim:a,hiddenDim:u,stateDim:o,rewardWeight:_}=this.config,l=this._forwardCached(t,r,n);let c=0;const d=new Float32Array(o);for(let h=0;h<o;h++){const w=l.delta[h]-(e[h]??0);c+=.5*w*w,d[h]=w}const f=l.reward-i;c+=.5*_*f*f;const p=_*f,g=new Float32Array(u);for(let h=0;h<o;h++){const w=d[h]*(1-l.delta[h]*l.delta[h]);this.gBoutState[h]=this.gBoutState[h]+w;const y=h*u;for(let b=0;b<u;b++)this.gWoutState[y+b]=this.gWoutState[y+b]+w*l.hn[b],g[b]=g[b]+w*this.woutState[y+b]}this.gBoutReward[0]=this.gBoutReward[0]+p;for(let h=0;h<u;h++)this.gWoutReward[h]=this.gWoutReward[h]+p*l.hn[h],g[h]=g[h]+p*this.woutReward[h];for(let h=0;h<u;h++){const w=l.a[h],y=l.t[h];this.gALogit[h]=this.gALogit[h]+g[h]*(l.hPrev[h]-y)*w*(1-w);const b=g[h]*(1-w)*(1-y*y),v=h*a;for(let B=0;B<a;B++)this.gWin[v+B]=this.gWin[v+B]+b*l.x[B];const P=h*o;for(let B=0;B<o;B++)this.gWs[P+B]=this.gWs[P+B]+b*l.sPrev[B]}return{loss:c,hidden:l.hn}}exportWeights(t={}){const r=t.fp16??!1,n=this.parameters(),e=n.reduce((l,c)=>l+c.numel,0),i=5,a=i*4,u=r?e*2:e*4,o=new ArrayBuffer(a+u),_=new Uint32Array(o,0,i);if(_[0]=Rt,_[1]=r?2:1,_[2]=this.config.inputDim,_[3]=this.config.hiddenDim,_[4]=this.config.stateDim,r){const l=new Float32Array(e);let c=0;for(const f of n)l.set(f.data,c),c+=f.numel;const d=zt(l);new Uint16Array(o,a,e).set(d)}else{const l=new Float32Array(o,a,e);let c=0;for(const d of n)l.set(d.data,c),c+=d.numel}return o}loadWeights(t){const r=new Uint32Array(t,0,5);if(r[0]!==Rt)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const n=r[1],e=r[2],i=r[3],a=r[4];if(e!==this.config.inputDim||i!==this.config.hiddenDim||a!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${e}/${i}/${a} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const u=this.parameters(),o=u.reduce((d,f)=>d+f.numel,0),_=20;let l;n===2?l=Ht(new Uint16Array(t,_,o)):l=new Float32Array(t.slice(_,_+o*4));let c=0;for(const d of u)d.data.set(l.subarray(c,c+d.numel)),c+=d.numel}}const $r=48;function Ur(s,t){const r=new ArrayBuffer($r);return new Uint32Array(r,0,1).set([s]),new Float32Array(r,4,8).set([t.lr,t.beta1,t.beta2,t.eps,t.weightDecay,t.beta1_t,t.beta2_t,t.maxDelta]),r}class Xr{label;head;device;_moments=null;_step=0;_skippedNonFinite=0;_adamwPipeline;constructor(t,r=null,n="HeadTrainer"){this.label=n,this.head=t,this.device=r,this._adamwPipeline=r?H(r,Tr,"adamw_update"):null}get skippedNonFinite(){return this._skippedNonFinite}get diverged(){return this._skippedNonFinite>0}get gpuTraining(){return this.device!=null&&this._adamwPipeline!=null}_initMoments(){this._moments||(this._moments=this.head.parameters().map(t=>({m:new Float32Array(t.numel),v:new Float32Array(t.numel)})))}async train(t,r={}){if(t.length===0)throw new Error(`${this.label}.train: no samples`);const{learningRate:n=.05,epochs:e=50,weightDecay:i=0,beta1:a=.9,beta2:u=.999,eps:o=1e-8,maxGradNorm:_=1,onEpochEnd:l=null}=r;this._initMoments();const c=[];for(let d=0;d<e;d++){this.head.zeroGrad();let f=0;for(const P of t)f+=this.head.accumulate(P);const p=this.head.gradients(),g=1/t.length;for(const P of p)for(let B=0;B<P.data.length;B++)P.data[B]*=g;const h=Yr(p,_);this._step++;const w=Math.pow(a,this._step),y=Math.pow(u,this._step),b={lr:n,weightDecay:i,beta1:a,beta2:u,eps:o,beta1_t:w,beta2_t:y,maxDelta:0};this.gpuTraining?await this._adamwStepGpu(p,b):this._adamwStepCpu(p,b);const v=f/t.length;c.push(v),l&&l(d+1,v,h)}return c}evaluate(t){if(t.length===0)return 0;let r=0;for(const n of t)r+=this.head.loss(n);return r/t.length}_adamwStepCpu(t,r){const n=this.head.parameters();for(let e=0;e<n.length;e++){const i=this._moments[e];this._skippedNonFinite+=_t(n[e].data,t[e].data,i.m,i.v,r)}}async _adamwStepGpu(t,r){const n=this.device,e=this._adamwPipeline,i=this.head.parameters();for(let a=0;a<i.length;a++){const u=i[a],o=this._moments[a];this._skippedNonFinite+=Vr(t[a].data);const _=Q(n,u.data,!0),l=Q(n,t[a].data,!1),c=Q(n,o.m,!0),d=Q(n,o.v,!0),f=E(n,Ur(u.numel,r)),p=j(n,e,[f,_,l,c,d]);T(n,e,p,[W(u.numel,256),1,1]),u.data.set((await rt(n,_,u.numel*4)).subarray(0,u.numel)),o.m.set((await rt(n,c,u.numel*4)).subarray(0,u.numel)),o.v.set((await rt(n,d,u.numel*4)).subarray(0,u.numel)),_.destroy(),l.destroy(),c.destroy(),d.destroy(),f.destroy()}}}function Vr(s){let t=0;for(let r=0;r<s.length;r++)Number.isFinite(s[r])||t++;return t}function Yr(s,t){let r=0,n=0;for(const i of s)for(let a=0;a<i.data.length;a++){const u=i.data[a]*i.data[a];r+=u,Number.isFinite(u)&&(n+=u)}const e=Math.sqrt(n);if(e>t&&e>0){const i=t/e;for(const a of s)for(let u=0;u<a.data.length;u++)a.data[u]*=i}return Math.sqrt(r)}function La(s){const t=new Float32Array(s.reduce((n,e)=>n+e.numel,0));let r=0;for(const n of s)t.set(n.data,r),r+=n.numel;return t}function Da(s,t){const r=s.reduce((e,i)=>e+i.numel,0);if(t.length!==r)throw new Error(`assignParams: expected ${r} values, got ${t.length}`);let n=0;for(const e of s){for(let i=0;i<e.numel;i++)e.data[i]=t[n+i];n+=e.numel}}function Qr(s){return{parameters:()=>s.parameters(),gradients:()=>s.gradients(),zeroGrad:()=>s.zeroGrad(),accumulate:t=>s.backwardStep(t.input,s.initHidden(),t.state,t.deltaTarget,t.reward).loss,loss:t=>{const{rewardWeight:r}=s.config,n=s.forward(t.input,s.initHidden(),t.state);let e=0;for(let a=0;a<n.delta.length;a++){const u=n.delta[a]-(t.deltaTarget[a]??0);e+=.5*u*u}const i=n.reward-t.reward;return e+=.5*r*i*i,e}}}class Ba{model;device;_trainer;constructor(t,r=null){this.model=t,this.device=r,this._trainer=new Xr(Qr(t),r,"LimbicTrainer")}get gpuTraining(){return this._trainer.gpuTraining}train(t,r={}){return this._trainer.train(t,r)}evaluate(t){return this._trainer.evaluate(t)}}const Pa=`

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
`;export{Tr as $,na as A,lt as B,ft as C,Kr as D,ba as E,Ge as F,va as G,Xr as H,ka as I,Ba as J,Be as K,gt as L,xt as M,oe as N,Me as O,Ce as P,da as Q,pa as R,la as S,ya as T,Zr as U,Mt as V,aa as W,ra as X,Fe as Y,ia as Z,Pe as _,Er as a,sr as a0,qe as a1,ht as a2,ua as a3,_a as a4,Ue as a5,lr as a6,dr as a7,ma as a8,xa as a9,Je as aA,Ye as aB,ca as aa,Xe as ab,Zt as ac,or as ad,ar as ae,rr as af,ga as ag,er as ah,Y as ai,wa as aj,Et as ak,jt as al,fa as am,ur as an,Qr as ao,Qe as ap,re as aq,tr as ar,zr as as,nr as at,$e as au,Aa as av,Or as aw,Ze as ax,Ke as ay,ha as az,Da as b,At as c,Yt as d,nt as e,La as f,oa as g,Wt as h,ee as i,te as j,Te as k,Gr as l,mt as m,sa as n,We as o,ta as p,yt as q,Ct as r,Hr as s,qr as t,ir as u,ze as v,Pa as w,Rr as x,se as y,ea as z};
