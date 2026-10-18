import{a4 as E,j,h as T,g as N,f as z,e as P,F as dt,d as Q,aw as Dt,r as rt,aq as Ht,Z as le,v as ce,u as st,a6 as zt,G as ue,P as _e,p as pt,B as he,E as ge,l as pe,S as Ot,a5 as me,O as fe,Y as wt,$ as Gt,am as qt,ad as be,ao as we,ac as Bt,a3 as ve,t as ye,al as xe,ag as Ae}from"./chunk-falcon_mamba.js";const Pt=`

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
`,Vr=`

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
`,Yr=`

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
`,Qr=`

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
`,Jr=`
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
`,Zr=`
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
`,ta=`

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
`,ft="col_slice";function Y(o,t,r,i,e,n,a,u){const s=E(o,new Uint32Array([e,n,a,u]).buffer),_=j(o,t,[s,r,i]);T(o,t,_,[N(e*u,256),1,1]),s.destroy()}const ke=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,Le=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class De{layerType="mamba1";device;config;dInner;dtRank;wInProj;bInProj;wConv;bConv;wXProj;bXProj;wDtProj;bDtProj;A_log;D_vec;wOutProj;bOutProj;normWeight;gpuWeights;pipelines;_wslaMode=!1;constructor(t,r){this.device=t,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(r.dModel/16),...r};const{dModel:i,expand:e}=this.config;this.dInner=e*i,this.dtRank=r.dtRank??Math.ceil(i/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,dState:r,dConv:i}=this.config,e=this.dInner,n=r,a=i,u=this.dtRank,s=(c,l=.02)=>dt(c,l),_=c=>new Float32Array(c),d=c=>new Float32Array(c).fill(1);this.wInProj=s(2*e*t),this.bInProj=_(2*e),this.wConv=s(e*a,.01),this.bConv=_(e),this.wXProj=s((u+2*n)*e,.01),this.bXProj=_(u+2*n),this.wDtProj=s(e*u,.02),this.bDtProj=_(e),this.A_log=new Float32Array(e*n);for(let c=0;c<e;c++)for(let l=0;l<n;l++)this.A_log[c*n+l]=Math.log(l+1);this.D_vec=d(e),this.wOutProj=s(t*e,.02),this.bOutProj=_(t),this.normWeight=d(t),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const t=this.device,r=i=>Q(t,i,!0);this.gpuWeights={wInProj:r(this.wInProj),bInProj:r(this.bInProj),wConv:r(this.wConv),bConv:r(this.bConv),wXProj:r(this.wXProj),bXProj:r(this.bXProj),wDtProj:r(this.wDtProj),bDtProj:r(this.bDtProj),A_log:r(this.A_log),D_vec:r(this.D_vec),wOutProj:r(this.wOutProj),bOutProj:r(this.bOutProj),normWeight:r(this.normWeight)}}_buildPipelines(){const t=this.device;this.pipelines={linear:z(t,lt,"linear_forward"),conv1d:z(t,yt,"conv1d_forward"),silu:z(t,nt,"silu_forward"),rmsnorm:z(t,nt,"rmsnorm_forward"),scan_fwd:z(t,Pt,"forward_scan"),scan_reduce:z(t,Pt,"forward_reduce"),colSlice:z(t,mt,ft),elMul:z(t,ke,"main"),elAdd:z(t,Le,"main")}}forward(t,r,i){const e=this.device,{dModel:n,dState:a,dConv:u}=this.config,s=this.dInner,_=a,d=r,c=i,l=d*c,m=this.dtRank,g={},h=P(e,l*n*4,!0),p=P(e,l*4,!0);g.normInv=p,g.normIn=t;{const f=new ArrayBuffer(16);new Uint32Array(f,0,2).set([l,n]),new Float32Array(f,8,1).set([1e-6]);const x=E(e,f),B=j(e,this.pipelines.rmsnorm,[x,t,this.gpuWeights.normWeight,h,p]);T(e,this.pipelines.rmsnorm,B,[N(l,64),1,1])}const w=P(e,l*2*s*4,!0);g.normOut=h;{const f=new Uint32Array([l,n,2*s]).buffer,x=E(e,f),B=j(e,this.pipelines.linear,[x,h,this.gpuWeights.wInProj,this.gpuWeights.bInProj,w]);T(e,this.pipelines.linear,B,[N(l,16),N(2*s,16),1])}const v=P(e,l*s*4,!0),b=P(e,l*s*4,!0);{const f=this.pipelines.colSlice;Y(e,f,w,v,l,2*s,0,s),Y(e,f,w,b,l,2*s,s,s)}w.destroy(),g.zBuf=b,g.xConvIn=v;const y=P(e,l*s*4,!0);g.convOut=y;{const f=new Uint32Array([c,s,u,d,1]).buffer,x=E(e,f),B=j(e,this.pipelines.conv1d,[x,v,this.gpuWeights.wConv,this.gpuWeights.bConv,y]);T(e,this.pipelines.conv1d,B,[N(c,16),N(s,16),d])}const D=P(e,l*s*4,!0);g.siluOut=D;{const f=new Uint32Array([l*s]).buffer,x=E(e,f),B=j(e,this.pipelines.silu,[x,y,D]);T(e,this.pipelines.silu,B,[N(l*s,256),1,1])}const L=P(e,l*(m+2*_)*4,!0);{const f=new Uint32Array([l,s,m+2*_]).buffer,x=E(e,f),B=j(e,this.pipelines.linear,[x,D,this.gpuWeights.wXProj,this.gpuWeights.bXProj,L]);T(e,this.pipelines.linear,B,[N(l,16),N(m+2*_,16),1])}const F=P(e,l*m*4,!0),k=P(e,d*c*_*4,!0),W=P(e,d*c*_*4,!0);{const f=m+2*_,x=this.pipelines.colSlice;Y(e,x,L,F,l,f,0,m),Y(e,x,L,k,l,f,m,_),Y(e,x,L,W,l,f,m+_,_)}L.destroy(),g.B_raw=k,g.C_raw=W;const S=P(e,l*s*4,!0);g.deltaFull=S;{const f=new Uint32Array([l,m,s]).buffer,x=E(e,f),B=j(e,this.pipelines.linear,[x,F,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,S]);T(e,this.pipelines.linear,B,[N(l,16),N(s,16),1])}F.destroy();const O=P(e,d*c*s*4,!0),G=P(e,2*d*c*s*_*4,!0);g.hCache=G;{const f=new Uint32Array([c,_,s,d]).buffer,x=E(e,f),B=j(e,this.pipelines.scan_fwd,[x,D,S,this.gpuWeights.A_log,k,W,this.gpuWeights.D_vec,O,G]);T(e,this.pipelines.scan_fwd,B,[s,_,d]);const R=j(e,this.pipelines.scan_reduce,[x,D,S,this.gpuWeights.A_log,k,W,this.gpuWeights.D_vec,O,G]);T(e,this.pipelines.scan_reduce,R,[N(c,64),s,d])}const K=P(e,l*s*4,!0),H=P(e,l*s*4,!0);{const f=E(e,new Uint32Array([l*s]).buffer),x=j(e,this.pipelines.silu,[f,b,K]);T(e,this.pipelines.silu,x,[N(l*s,256),1,1]);const B=E(e,new Uint32Array([l*s]).buffer),R=j(e,this.pipelines.elMul,[O,K,H,B]);T(e,this.pipelines.elMul,R,[N(l*s,256),1,1])}K.destroy(),O.destroy();const q=P(e,l*n*4,!0);{const f=new Uint32Array([l,s,n]).buffer,x=E(e,f),B=j(e,this.pipelines.linear,[x,H,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,q]);T(e,this.pipelines.linear,B,[N(l,16),N(n,16),1])}H.destroy();const A=P(e,l*n*4,!0);{const f=E(e,new Uint32Array([l*n]).buffer),x=j(e,this.pipelines.elAdd,[q,t,A,f]);T(e,this.pipelines.elAdd,x,[N(l*n,256),1,1])}return q.destroy(),{output:A,cache:g}}parameters(){const{dModel:t,dState:r,dConv:i}=this.config,e=this.dInner,n=r,a=i,u=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*e*t,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*e,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:e*a,name:"wConv"},{buf:this.gpuWeights.bConv,numel:e,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(u+2*n)*e,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:u+2*n,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:e*u,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:e,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:e*n,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:e,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:t*e,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:t,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:t,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(t){this._wslaMode=t}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const Be=`
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
`,ea=`
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
`,Pe=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class Me{layerType="mamba2";device;config;dInner;dHead;gpuWeights;pipelines;_wslaMode=!1;constructor(t,r){this.device=t,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...r};const{dModel:i,expand:e,nHeads:n}=this.config;if(this.dInner=e*i,this.dHead=this.dInner/n,this.dInner%n!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${n}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,dState:r,dConv:i,nHeads:e,nGroups:n}=this.config,a=this.dInner,u=r,s=i,_=e,d=n,c=(p,w=.02)=>dt(p,w),l=p=>new Float32Array(p),m=p=>new Float32Array(p).fill(1),g=a+2*d*u+_,h=p=>Q(this.device,p,!0);this.gpuWeights={wInProj:h(c(g*t)),wConv:h(c((a+2*d*u)*s,.01)),bConv:h(l(a+2*d*u)),A_log:h(new Float32Array(_).fill(Math.log(1))),dt_bias:h(l(_)),D_vec:h(m(_)),wOutProj:h(c(t*a,.02)),normWeight:h(m(a)),preNormWeight:h(m(t))}}_buildPipelines(){const t=this.device;this.pipelines={linear:z(t,lt,"linear_forward"),conv1d:z(t,yt,"conv1d_forward"),colSlice:z(t,mt,ft),rmsnorm:z(t,nt,"rmsnorm_forward"),ssd_fwd:z(t,Be,"ssd_chunk_forward"),elAdd:z(t,Pe,"main")}}forward(t,r,i){const e=this.device,{dModel:n,dState:a,dConv:u,nHeads:s,nGroups:_,chunkLen:d}=this.config,c=this.dInner,l=a,m=u,g=s,h=_,p=this.dHead,w=r,v=i,b=w*v,y=c+2*h*l,D=Math.ceil(v/d),L=P(e,b*n*4,!0),F=P(e,b*4,!0);{const C=new ArrayBuffer(16);new Uint32Array(C,0,2).set([b,n]),new Float32Array(C,8,1).set([1e-6]);const M=E(e,C),$=j(e,this.pipelines.rmsnorm,[M,t,this.gpuWeights.preNormWeight,L,F]);T(e,this.pipelines.rmsnorm,$,[N(b,64),1,1])}F.destroy();const k=c+2*h*l+g,W=P(e,b*k*4,!0);{const C=new Uint32Array([b,n,k]).buffer,M=E(e,C),$=Q(e,new Float32Array(k),!0),J=j(e,this.pipelines.linear,[M,L,this.gpuWeights.wInProj,$,W]);T(e,this.pipelines.linear,J,[N(b,16),N(k,16),1]),$.destroy()}L.destroy();const S=P(e,b*y*4,!0),O=P(e,b*g*4,!0);{const C=this.pipelines.colSlice,M=y+g;Y(e,C,W,S,b,M,0,y),Y(e,C,W,O,b,M,y,g)}W.destroy();const G=P(e,b*y*4,!0);{const C=new Uint32Array([v,y,m,w,1]).buffer,M=E(e,C),$=j(e,this.pipelines.conv1d,[M,S,this.gpuWeights.wConv,this.gpuWeights.bConv,G]);T(e,this.pipelines.conv1d,$,[N(v,16),N(y,16),w])}S.destroy();const K=P(e,b*c*4,!0),H=P(e,b*h*l*4,!0),q=P(e,b*h*l*4,!0);{const C=this.pipelines.colSlice;Y(e,C,G,K,b,y,0,c),Y(e,C,G,H,b,y,c,h*l),Y(e,C,G,q,b,y,c+h*l,h*l)}G.destroy();const A=P(e,(D+1)*w*g*l*p*4,!0),f=P(e,b*c*4,!0);{const C=new Uint32Array([v,c,g,p,h,l,d,D,w]).buffer,M=E(e,C),$=j(e,this.pipelines.ssd_fwd,[M,K,H,q,O,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,f,A]);T(e,this.pipelines.ssd_fwd,$,[D,g,w])}K.destroy(),H.destroy(),q.destroy(),O.destroy();const x=P(e,b*c*4,!0),B=P(e,b*4,!0);{const C=new ArrayBuffer(16);new Uint32Array(C,0,2).set([b,c]),new Float32Array(C,8,1).set([1e-6]);const M=E(e,C),$=j(e,this.pipelines.rmsnorm,[M,f,this.gpuWeights.normWeight,x,B]);T(e,this.pipelines.rmsnorm,$,[N(b,64),1,1])}f.destroy(),B.destroy();const R=P(e,b*n*4,!0);{const C=new Uint32Array([b,c,n]).buffer,M=E(e,C),$=Q(e,new Float32Array(n),!0),J=j(e,this.pipelines.linear,[M,x,this.gpuWeights.wOutProj,$,R]);T(e,this.pipelines.linear,J,[N(b,16),N(n,16),1]),$.destroy()}x.destroy();const U=P(e,b*n*4,!0);{const C=E(e,new Uint32Array([b*n]).buffer),M=j(e,this.pipelines.elAdd,[R,t,U,C]);T(e,this.pipelines.elAdd,M,[N(b*n,256),1,1])}return R.destroy(),{output:U,cache:{stateCarry:A}}}parameters(){const{dModel:t,dState:r,dConv:i,nHeads:e,nGroups:n}=this.config,a=this.dInner,u=r,s=i,_=e,d=n,c=a+2*d*u;return[{buf:this.gpuWeights.wInProj,numel:(a+2*d*u+_)*t,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:c*s,name:"wConv"},{buf:this.gpuWeights.bConv,numel:c,name:"bConv"},{buf:this.gpuWeights.A_log,numel:_,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:_,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:_,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:t*a,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:a,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:t,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(t){this._wslaMode=t}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const We=`
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
`,ra=`
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
`;class Se{layerType="mamba3";device;config;dInner;dHead;nComplex;gpuWeights;pipelines;_wslaMode=!1;constructor(t,r){this.device=t,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...r};const{dModel:i,expand:e,nHeads:n}=this.config;if(this.dInner=e*i,this.dHead=this.dInner/n,this.nComplex=this.config.dState,this.dInner%n!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${n}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,dConv:r,nHeads:i,nGroups:e}=this.config,n=this.dInner,a=this.nComplex,u=r,s=i,_=e,d=n+2*_*a*2,c=(w,v=.02)=>dt(w,v),l=w=>new Float32Array(w),m=w=>new Float32Array(w).fill(1),g=new Float32Array(s*2);for(let w=0;w<s;w++)g[w*2+0]=0,g[w*2+1]=2*Math.PI*w/s;const h=w=>Q(this.device,w,!0),p=n+2*_*a*2+s;this.gpuWeights={wInProj:h(c(p*t)),wConv:h(c(d*u,.01)),bConv:h(l(d)),A_log:h(g),dt_bias:h(l(s)),D_vec:h(m(s)),wOutProj:h(c(t*n,.02)),normWeight:h(m(n)),preNormWeight:h(m(t))}}_buildPipelines(){const t=this.device;this.pipelines={linear:z(t,lt,"linear_forward"),conv1d:z(t,yt,"conv1d_forward"),colSlice:z(t,mt,ft),rmsnorm:z(t,nt,"rmsnorm_forward"),cssd_fwd:z(t,We,"complex_ssd_forward"),elAdd:z(t,Ne,"main")}}forward(t,r,i){const e=this.device,{dModel:n,dConv:a,nHeads:u,nGroups:s,chunkLen:_}=this.config,d=this.dInner,c=this.nComplex,l=a,m=u,g=s,h=this.dHead,p=r,w=i,v=p*w,b=d+2*g*c*2,y=Math.ceil(w/_),D=P(e,v*n*4,!0),L=P(e,v*4,!0);{const I=new ArrayBuffer(16);new Uint32Array(I,0,2).set([v,n]),new Float32Array(I,8,1).set([1e-6]);const C=E(e,I),M=j(e,this.pipelines.rmsnorm,[C,t,this.gpuWeights.preNormWeight,D,L]);T(e,this.pipelines.rmsnorm,M,[N(v,64),1,1])}L.destroy();const F=d+2*g*c*2+m,k=P(e,v*F*4,!0);{const I=new Uint32Array([v,n,F]).buffer,C=E(e,I),M=Q(e,new Float32Array(F),!0),$=j(e,this.pipelines.linear,[C,D,this.gpuWeights.wInProj,M,k]);T(e,this.pipelines.linear,$,[N(v,16),N(F,16),1]),M.destroy()}D.destroy();const W=P(e,v*b*4,!0),S=P(e,v*m*4,!0);{const I=this.pipelines.colSlice,C=b+m;Y(e,I,k,W,v,C,0,b),Y(e,I,k,S,v,C,b,m)}k.destroy();const O=P(e,v*b*4,!0);{const I=new Uint32Array([w,b,l,p,1]).buffer,C=E(e,I),M=j(e,this.pipelines.conv1d,[C,W,this.gpuWeights.wConv,this.gpuWeights.bConv,O]);T(e,this.pipelines.conv1d,M,[N(w,16),N(b,16),p])}W.destroy();const G=P(e,v*d*4,!0),K=P(e,v*g*c*2*4,!0),H=P(e,v*g*c*2*4,!0);{const I=this.pipelines.colSlice;Y(e,I,O,G,v,b,0,d),Y(e,I,O,K,v,b,d,g*c*2),Y(e,I,O,H,v,b,d+g*c*2,g*c*2)}O.destroy();const q=P(e,(y+1)*p*m*c*2*h*4,!0),A=P(e,v*d*4,!0);{const I=new Uint32Array([w,d,m,h,g,c,_,y,p]).buffer,C=E(e,I),M=j(e,this.pipelines.cssd_fwd,[C,G,K,H,S,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,A,q]);T(e,this.pipelines.cssd_fwd,M,[y,m,p])}G.destroy(),K.destroy(),H.destroy(),S.destroy();const f=P(e,v*d*4,!0),x=P(e,v*4,!0);{const I=new ArrayBuffer(16);new Uint32Array(I,0,2).set([v,d]),new Float32Array(I,8,1).set([1e-6]);const C=E(e,I),M=j(e,this.pipelines.rmsnorm,[C,A,this.gpuWeights.normWeight,f,x]);T(e,this.pipelines.rmsnorm,M,[N(v,64),1,1])}A.destroy(),x.destroy();const B=P(e,v*n*4,!0);{const I=new Uint32Array([v,d,n]).buffer,C=E(e,I),M=Q(e,new Float32Array(n),!0),$=j(e,this.pipelines.linear,[C,f,this.gpuWeights.wOutProj,M,B]);T(e,this.pipelines.linear,$,[N(v,16),N(n,16),1]),M.destroy()}f.destroy();const R=P(e,v*n*4,!0);{const I=E(e,new Uint32Array([v*n]).buffer),C=j(e,this.pipelines.elAdd,[B,t,R,I]);T(e,this.pipelines.elAdd,C,[N(v*n,256),1,1])}return B.destroy(),{output:R,cache:{stateCarry:q}}}parameters(){const{dModel:t,dConv:r,nHeads:i,nGroups:e}=this.config,n=this.dInner,a=this.nComplex,u=r,s=i,_=e,d=n+2*_*a*2;return[{buf:this.gpuWeights.wInProj,numel:(n+2*_*a*2+s)*t,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:d*u,name:"wConv"},{buf:this.gpuWeights.bConv,numel:d,name:"bConv"},{buf:this.gpuWeights.A_log,numel:s*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:s,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:s,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:t*n,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:n,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:t,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(t){this._wslaMode=t}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const Ce=`
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
`,Mt=`
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
`,aa=`
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
`,Fe=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,Ie=`
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
`;class je{layerType="attention";device;config;dHead;gpuWeights;pipelines;constructor(t,r){if(this.device=t,r.dModel%r.nHeads!==0)throw new Error(`AttentionBlock: dModel (${r.dModel}) must be divisible by nHeads (${r.nHeads}).`);this.config={dHead:r.dModel/r.nHeads,hasFfn:!1,ffnMult:4,...r},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,hasFfn:r,ffnMult:i}=this.config,e=(s,_=.02)=>dt(s,_),n=s=>new Float32Array(s),a=s=>new Float32Array(s).fill(1),u=s=>Q(this.device,s,!0);if(this.gpuWeights={wQKV:u(e(3*t*t)),bQKV:u(n(3*t)),wO:u(e(t*t)),bO:u(n(t)),normWeight:u(a(t))},r){const s=t*i;this.gpuWeights.wFfn1=u(e(s*t)),this.gpuWeights.bFfn1=u(n(s)),this.gpuWeights.wFfn2=u(e(t*s)),this.gpuWeights.bFfn2=u(n(t))}}_buildPipelines(){const t=this.device;this.pipelines={linear:z(t,lt,"linear_forward"),rmsnorm:z(t,nt,"rmsnorm_forward"),attn_fwd:z(t,Mt,"attention_forward"),attn_val:z(t,Mt,"attention_value"),softmax:z(t,Ce,"softmax_forward"),colSlice:z(t,mt,ft),elAdd:z(t,Fe,"main")},this.config.hasFfn&&(this.pipelines.silu=z(t,Ie,"silu_forward"))}forward(t,r,i){const e=this.device,{dModel:n,nHeads:a,hasFfn:u}=this.config,s=this.dHead,_=r,d=i,c=_*d,l=a,m=P(e,c*n*4,!0),g=P(e,c*4,!0);{const k=new ArrayBuffer(16);new Uint32Array(k,0,2).set([c,n]),new Float32Array(k,8,1).set([1e-6]);const W=E(e,k),S=j(e,this.pipelines.rmsnorm,[W,t,this.gpuWeights.normWeight,m,g]);T(e,this.pipelines.rmsnorm,S,[N(c,64),1,1])}g.destroy();const h=P(e,c*3*n*4,!0);{const k=new Uint32Array([c,n,3*n]).buffer,W=E(e,k),S=j(e,this.pipelines.linear,[W,m,this.gpuWeights.wQKV,this.gpuWeights.bQKV,h]);T(e,this.pipelines.linear,S,[N(c,16),N(3*n,16),1])}m.destroy();const p=P(e,c*n*4,!0),w=P(e,c*n*4,!0),v=P(e,c*n*4,!0);{const k=this.pipelines.colSlice;Y(e,k,h,p,c,3*n,0,n),Y(e,k,h,w,c,3*n,n,n),Y(e,k,h,v,c,3*n,2*n,n)}h.destroy();const b=P(e,_*l*d*d*4,!0);{const k=new Uint32Array([_,d,n,l,s]).buffer,W=E(e,k),S=j(e,this.pipelines.attn_fwd,[W,p,w,v,b,P(e,c*n*4,!0)]);T(e,this.pipelines.attn_fwd,S,[N(d,16),l,_])}{const k=new Uint32Array([d,d,1]).buffer,W=E(e,k),S=j(e,this.pipelines.softmax,[W,b]);T(e,this.pipelines.softmax,S,[d,l,_])}const y=P(e,c*n*4,!0);{const k=new Uint32Array([_,d,n,l,s]).buffer,W=E(e,k),S=j(e,this.pipelines.attn_val,[W,p,w,v,b,y]);T(e,this.pipelines.attn_val,S,[N(d,16),l,_])}p.destroy(),w.destroy(),v.destroy();const D=P(e,c*n*4,!0);{const k=new Uint32Array([c,n,n]).buffer,W=E(e,k),S=j(e,this.pipelines.linear,[W,y,this.gpuWeights.wO,this.gpuWeights.bO,D]);T(e,this.pipelines.linear,S,[N(c,16),N(n,16),1])}y.destroy();let L=P(e,c*n*4,!0);{const k=E(e,new Uint32Array([c*n]).buffer),W=j(e,this.pipelines.elAdd,[D,t,L,k]);T(e,this.pipelines.elAdd,W,[N(c*n,256),1,1])}if(D.destroy(),u){const{ffnMult:k}=this.config,W=n*k,S=P(e,c*W*4,!0);{const H=new Uint32Array([c,n,W]).buffer,q=E(e,H),A=j(e,this.pipelines.linear,[q,L,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,S]);T(e,this.pipelines.linear,A,[N(c,16),N(W,16),1])}const O=P(e,c*W*4,!0);{const H=E(e,new Uint32Array([c*W]).buffer),q=j(e,this.pipelines.silu,[H,S,O]);T(e,this.pipelines.silu,q,[N(c*W,256),1,1])}S.destroy();const G=P(e,c*n*4,!0);{const H=new Uint32Array([c,W,n]).buffer,q=E(e,H),A=j(e,this.pipelines.linear,[q,O,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,G]);T(e,this.pipelines.linear,A,[N(c,16),N(n,16),1])}O.destroy();const K=P(e,c*n*4,!0);{const H=E(e,new Uint32Array([c*n]).buffer),q=j(e,this.pipelines.elAdd,[G,L,K,H]);T(e,this.pipelines.elAdd,q,[N(c*n,256),1,1])}G.destroy(),L.destroy(),L=K}return{output:L,cache:{scores:b}}}parameters(){const{dModel:t,hasFfn:r,ffnMult:i}=this.config,e=[{buf:this.gpuWeights.wQKV,numel:3*t*t,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*t,name:"bQKV"},{buf:this.gpuWeights.wO,numel:t*t,name:"wO"},{buf:this.gpuWeights.bO,numel:t,name:"bO"},{buf:this.gpuWeights.normWeight,numel:t,name:"normWeight"}];if(r){const n=t*i;e.push({buf:this.gpuWeights.wFfn1,numel:n*t,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:n,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:t*n,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:t,name:"bFfn2"})}return e}getTrainableParams(){return this.parameters()}setWSLAMode(t){}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const Wt=1296190035,Te={mamba1:0,mamba2:1,mamba3:2,attention:3},Ee=["mamba1","mamba2","mamba3","attention"];class Re{device;config;gpuEmbedding;layers;layerSpecs;gpuFinalNorm;tiedEmbedding;gpuLMHeadBias;_lmHeadPipeline;_rmsnormPipeline;_embedPipeline;_wslaMode=!1;constructor(t,r){this.device=t,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...r},Dt(this.config.seed);const i=r.layers??Array.from({length:r.numLayers},()=>({type:"mamba1"}));if(i.length!==r.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${i.length}) must equal numLayers (${r.numLayers}).`);this.layerSpecs=i;const{vocabSize:e,dModel:n}=this.config,a=dt(e*n,1/Math.sqrt(n));this.gpuEmbedding=Q(t,a,!0),this.layers=i.map(u=>this._buildLayer(u)),Dt(void 0),this.gpuFinalNorm=Q(t,new Float32Array(n).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=Q(t,new Float32Array(e),!0),this._lmHeadPipeline=z(t,lt,"linear_forward"),this._rmsnormPipeline=z(t,nt,"rmsnorm_forward"),this._embedPipeline=z(t,He,"embed_lookup")}_buildLayer(t){const r=this.config;switch(t.type){case"mamba1":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,...r.defaultMamba1};return new De(this.device,{...i,...t.config??{}})}case"mamba2":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,nHeads:r.nHeads,nGroups:r.nGroups,chunkLen:r.chunkLen,...r.defaultMamba2};return new Me(this.device,{...i,...t.config??{}})}case"mamba3":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,nHeads:r.nHeads,nGroups:r.nGroups,chunkLen:r.chunkLen,mimoGroup:r.mimoGroup,...r.defaultMamba3};return new Se(this.device,{...i,...t.config??{}})}case"attention":{const i={dModel:r.dModel,nHeads:r.nHeads,...r.defaultAttention};return new je(this.device,{...i,...t.config??{}})}}}embedTokens(t,r,i){const{dModel:e}=this.config,n=r*i,a=Q(this.device,t instanceof Uint32Array?t:new Uint32Array(t),!1),u=P(this.device,n*e*4,!0),s=E(this.device,new Uint32Array([n,e]).buffer),_=j(this.device,this._embedPipeline,[s,a,this.gpuEmbedding,u]);return T(this.device,this._embedPipeline,_,[N(n,64),1,1]),a.destroy(),s.destroy(),u}async forward(t,r,i){const{dModel:e,vocabSize:n}=this.config,a=r*i;let u=this.embedTokens(t,r,i);const s=[];for(const m of this.layers){const{output:g,cache:h}=m.forward(u,r,i);s.push(h),u.destroy(),u=g}const _=P(this.device,a*e*4,!0),d=P(this.device,a*4,!1);{const m=new ArrayBuffer(16);new Uint32Array(m,0,2).set([a,e]),new Float32Array(m,8,1).set([1e-6]);const g=E(this.device,m),h=j(this.device,this._rmsnormPipeline,[g,u,this.gpuFinalNorm,_,d]);T(this.device,this._rmsnormPipeline,h,[N(a,64),1,1])}u.destroy();const c=P(this.device,a*n*4,!0);{const m=new Uint32Array([a,e,n]).buffer,g=E(this.device,m),h=j(this.device,this._lmHeadPipeline,[g,_,this.gpuEmbedding,this.gpuLMHeadBias,c]);T(this.device,this._lmHeadPipeline,h,[N(a,16),N(n,16),1])}return _.destroy(),d.destroy(),{logits:await rt(this.device,c,a*n*4),gpuLogits:c,caches:s}}async embed(t){const{dModel:r}=this.config,i=t.length,e=1,n=e*i;if(n===0)return new Float32Array(r);let a=this.embedTokens(t,e,i);for(const l of this.layers){const{output:m}=l.forward(a,e,i);a.destroy(),a=m}const u=P(this.device,n*r*4,!0),s=P(this.device,n*4,!1);{const l=new ArrayBuffer(16);new Uint32Array(l,0,2).set([n,r]),new Float32Array(l,8,1).set([1e-6]);const m=E(this.device,l),g=j(this.device,this._rmsnormPipeline,[m,a,this.gpuFinalNorm,u,s]);T(this.device,this._rmsnormPipeline,g,[N(n,64),1,1])}a.destroy();const _=await rt(this.device,u,n*r*4);u.destroy(),s.destroy();const d=new Float32Array(r);for(let l=0;l<i;l++){const m=l*r;for(let g=0;g<r;g++)d[g]+=_[m+g]}for(let l=0;l<r;l++)d[l]/=i;let c=0;for(let l=0;l<r;l++)c+=d[l]*d[l];c=Math.sqrt(c)||1;for(let l=0;l<r;l++)d[l]/=c;return d}async generate(t,r=200,i={}){const{temperature:e=1,topK:n=50,topP:a=.9}=i,{vocabSize:u}=this.config,s=[...t];for(let _=0;_<r;_++){const{logits:d}=await this.forward(new Uint32Array(s),1,s.length),c=d.slice((s.length-1)*u,s.length*u),l=ze(c,{temperature:e,topK:n,topP:a});if(s.push(l),l===this.config.eosId)break}return s}parameters(){const t=[];t.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let r=0;r<this.layers.length;r++)for(const i of this.layers[r].parameters())t.push({...i,name:`layer${r}.${i.name}`});return t.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),t}getTrainableParams(){if(!this._wslaMode)return this.parameters();const t=[];for(let r=0;r<this.layers.length;r++)for(const i of this.layers[r].getTrainableParams())t.push({...i,name:`layer${r}.${i.name}`});return t}setWSLAMode(t){for(const r of this.layers)r.setWSLAMode(t);this._wslaMode=t}async exportWeights(t={}){const r=t.fp16??!1,i=this.parameters(),e=i.length,n=this.layers.length,a=await Promise.all(i.map(h=>rt(this.device,h.buf,h.numel*4))),u=Math.ceil(n/4)*4,s=12+u+4+e*4,_=r?2:4,c=a.reduce((h,p)=>h+p.length,0)*_,l=new ArrayBuffer(s+c),m=new DataView(l);let g=0;m.setUint32(g,Wt,!0),g+=4,m.setUint32(g,r?3:2,!0),g+=4,m.setUint32(g,n,!0),g+=4;for(let h=0;h<n;h++){const p=this.layers[h].layerType;m.setUint8(g+h,Te[p])}g+=u,m.setUint32(g,e,!0),g+=4;for(const h of i)m.setUint32(g,h.numel,!0),g+=4;if(r)for(const h of a){const p=Ht(h);new Uint16Array(l,g,p.length).set(p),g+=p.length*2}else for(const h of a)new Float32Array(l,g,h.length).set(h),g+=h.byteLength;return le(l)}async loadWeights(t){const r=ce(t);if(r.hasTrailer&&!r.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const i=new DataView(t);let e=0;const n=i.getUint32(e,!0);if(e+=4,n!==Wt)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const a=i.getUint32(e,!0);if(e+=4,a===1){const u=i.getUint32(e,!0);e+=4;const s=this.parameters();if(u!==s.length)throw new Error(`Weight file has ${u} parameters but this model has ${s.length}.`);const _=[];for(let d=0;d<u;d++)_.push(i.getUint32(e,!0)),e+=4;for(let d=0;d<u;d++){const c=s[d],l=_[d];if(l!==c.numel)throw new Error(`Parameter ${d} ("${c.name}") size mismatch: file=${l}, model=${c.numel}.`);st(this.device,c.buf,new Float32Array(t,e,c.numel)),e+=c.numel*4}return}if(a===2||a===3){const u=a===3,s=i.getUint32(e,!0);if(e+=4,s!==this.layers.length)throw new Error(`Weight file has ${s} layers but this model has ${this.layers.length}.`);for(let m=0;m<s;m++){const g=i.getUint8(e+m),h=this.layers[m].layerType,p=Ee[g]??"mamba1";if(p!==h)throw new Error(`Layer ${m} type mismatch: file="${p}", model="${h}".`)}const _=Math.ceil(s/4)*4;e+=_;const d=i.getUint32(e,!0);e+=4;const c=this.parameters();if(d!==c.length)throw new Error(`Weight file has ${d} parameters but this model has ${c.length}.`);const l=[];for(let m=0;m<d;m++)l.push(i.getUint32(e,!0)),e+=4;for(let m=0;m<d;m++){const g=c[m],h=l[m];if(h!==g.numel)throw new Error(`Parameter ${m} ("${g.name}") size mismatch: file=${h}, model=${g.numel}.`);if(u){const p=new Uint16Array(t,e,h);st(this.device,g.buf,zt(p)),e+=h*2}else st(this.device,g.buf,new Float32Array(t,e,g.numel)),e+=h*4}return}throw new Error(`Unsupported MBJS version: ${a}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const t of this.layers)t.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class na extends Re{constructor(t,r){super(t,{...r,layers:Array.from({length:r.numLayers},()=>({type:"mamba1"}))})}}const He=`
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
`;function ze(o,{temperature:t=1,topK:r=50,topP:i=.9}={}){const e=o.length,n=new Float32Array(e);for(let p=0;p<e;p++)n[p]=o[p]/Math.max(t,1e-7);let a=-1/0;for(let p=0;p<e;p++)n[p]>a&&(a=n[p]);let u=0;const s=new Float32Array(e);for(let p=0;p<e;p++)s[p]=Math.exp(n[p]-a),u+=s[p];const d=Array.from({length:e},(p,w)=>w).sort((p,w)=>s[w]-s[p]).slice(0,r);let c=0;const l=[];for(const p of d)if(c+=s[p]/u,l.push(p),c>=i)break;let m=0;for(const p of l)m+=s[p];const g=Math.random()*m;let h=0;for(const p of l)if(h+=s[p],h>=g)return p;return l[l.length-1]}class ia{model;adam;opt;constructor(t,r={}){this.model=t,this.opt={lr:r.lr??.01,beta1:r.beta1??.9,beta2:r.beta2??.999,eps:r.eps??1e-8,weightDecay:r.weightDecay??0,auxWeight:r.auxWeight??.01,batchSize:r.batchSize??0,epochs:r.epochs??1},this.adam=new ue(t,this.opt)}fit(t){const r=[];for(let i=0;i<this.opt.epochs;i++)r.push(this.runEpoch(t));return r}runEpoch(t){const r=this.opt.batchSize>0?this.opt.batchSize:t.length,{numExperts:i,modelDim:e}=this.model.config;let n=0,a=0;for(let u=0;u<t.length;u+=r){const s=t.slice(u,u+r);this.model.zeroGrad();const _=[],d=[],c=new _e(i);let l=0;for(const h of s){const p=this.model.forward(h.input),w=new Float32Array(e);for(let v=0;v<e;v++){const b=p.output[v]-(h.target[v]??0);w[v]=b,l+=.5*b*b}this.model.backward(w,p.cache),_.push(p.cache.x),d.push(p.route.probs),c.observe(p.route)}const m=c.dispatchFractions(),g=this.opt.auxWeight*i/s.length;for(let h=0;h<_.length;h++)this.model.auxGradStep(_[h],d[h],m,g);this.scaleGradients(1/s.length),this.adam.step(),n+=l,a=c.loss()}return{loss:n/Math.max(1,t.length),auxLoss:a}}scaleGradients(t){if(t!==1)for(const r of this.model.gradients())for(let i=0;i<r.data.length;i++)r.data[i]=r.data[i]*t}}const Oe=Math.LN2;function Ge(o,t){const r=o.length,i=Math.max(1,Math.min(t,r)),e=[],n=new Uint8Array(r);for(let a=0;a<i;a++){let u=-1,s=-1/0;for(let _=0;_<r;_++){if(n[_])continue;const d=o[_];d>s&&(s=d,u=_)}if(u<0)break;n[u]=1,e.push(u)}return e}function qe(o){let t=0,r=-1/0;for(let i=0;i<o.length;i++)o[i]>r&&(r=o[i],t=i);return t}function Ke(o){return Math.exp(o)}function $e(o){return o/Oe}function Kt(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function $t(o,t,r,i){const e=Math.min(t.length,r.length);for(let n=0;n<e;n++){const a=r[n],u=t[n];a<0||a>=u.length||(o.ceSum+=pt(u,a),qe(u)===a&&o.top1Hits++,Ge(u,i).includes(a)&&o.topKHits++,o.tokens++)}}function Ut(){const o=globalThis;return typeof o.performance?.now=="function"?o.performance.now():Date.now()}function Xt(o){return o.slice(1)}function Vt(o,t,r,i){const e=o.tokens>0?o.ceSum/o.tokens:0,n={sequences:t,tokens:o.tokens,crossEntropy:e,perplexity:Ke(e),bitsPerToken:$e(e),top1Accuracy:o.tokens>0?o.top1Hits/o.tokens:0,topKAccuracy:o.tokens>0?o.topKHits/o.tokens:0,topK:r};return i!==void 0&&(n.elapsedMs=i,n.tokensPerSecond=i>0?o.tokens/i*1e3:0),n}function ht(o,t,r={}){const i=r.topK??5,e=r.measureLatency??!0,n=r.now??Ut,a=Kt();let u=0,s=0;for(const _ of t){if(_.length<2)continue;const d=e?n():0,{logits:c}=o.forward(_);e&&(s+=n()-d),$t(a,c,Xt(_),i),u++}return Vt(a,u,i,e?s:void 0)}async function oa(o,t,r={}){const i=r.topK??5,e=r.measureLatency??!0,n=r.now??Ut,a=Kt();let u=0,s=0;for(const _ of t){if(_.length<2)continue;const d=e?n():0,{logits:c}=await o.forward(_);e&&(s+=n()-d),$t(a,c,Xt(_),i),u++}return Vt(a,u,i,e?s:void 0)}function sa(o,t,r,i={}){return Ue(ht(o,r,i),ht(t,r,i))}function Ue(o,t){const r=o.perplexity-t.perplexity,i=t.perplexity>0?o.perplexity/t.perplexity:1/0,e=o.top1Accuracy-t.top1Accuracy,n=.005;let a;Math.abs(i-1)<=n?a="tie":a=r<0?"candidate":"baseline";const u=((1-i)*100).toFixed(1),s=a==="tie"?`Tie: perplexity ${o.perplexity.toFixed(2)} vs ${t.perplexity.toFixed(2)}`:a==="candidate"?`Candidate wins: ${u}% lower perplexity (${o.perplexity.toFixed(2)} vs ${t.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(u)).toFixed(1)}% higher perplexity (${o.perplexity.toFixed(2)} vs ${t.perplexity.toFixed(2)})`;return{candidate:o,baseline:t,perplexityDelta:r,perplexityRatio:i,top1Delta:e,winner:a,summary:s}}function Yt(o,t){return o.split(/(?<=\.)\s+/).map(r=>t.encode(r.trim())).filter(r=>r.length>=2)}function da(o,t,r,i={}){return ht(o,Yt(r,t),i)}function Xe(o,t){for(let r=o.length-1;r>0;r--){const i=Math.floor(t.next()*(r+1)),e=o[r];o[r]=o[i],o[i]=e}return o}function la(o,t={}){const r=t.seed??7,i=new he;i.train(o,{numMerges:t.numMerges??100});const e=Yt(o,i);if(e.length<2)throw new Error(`corpus produced ${e.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const n=Xe([...e],new Ot(r>>>0||1)),a=Math.min(.9,Math.max(.05,t.heldOutRatio??.25));let u=Math.round(n.length*a);u=Math.max(1,Math.min(n.length-1,u));const s=n.slice(0,u),_=n.slice(u),d=new ge({vocabSize:i.vocabSize,dModel:t.dModel??32,numLayers:t.numLayers??2,hiddenDim:t.hiddenDim??48,seed:r}),c=t.epochs??30,l=new pe(d,{lr:t.lr??.03,epochs:c}).fit(_),m=ht(d,s,{topK:t.topK??5,measureLatency:!0}),g=d.generateText(t.prompt??"The",i,{maxNewTokens:8,temperature:0});return{...m,trainSequences:_.length,evalSequences:s.length,initialTrainLoss:l[0]??0,finalTrainLoss:l.at(-1)??0,vocabSize:i.vocabSize,sample:g}}const ct=1e-6;function Qt(o){return 1/(1+Math.exp(-o))}function Nt(o){return o/(1+Math.exp(-o))}function St(o){const t=Qt(o);return t*(1+o*(1-t))}function Ve(o){return Math.max(o,0)+Math.log1p(Math.exp(-Math.abs(o)))}function ot(o,t,r,i,e,n,a){for(let u=0;u<i;u++){const s=u*e,_=u*n;for(let d=0;d<n;d++){let c=r[d];const l=d*e;for(let m=0;m<e;m++)c+=o[s+m]*t[l+m];a[_+d]=c}}}function _t(o,t,r,i,e,n,a,u,s){a.fill(0);for(let _=0;_<i;_++){const d=_*e,c=_*n;for(let l=0;l<n;l++){const m=o[c+l];if(m===0)continue;s[l]=s[l]+m;const g=l*e;for(let h=0;h<e;h++)a[d+h]=a[d+h]+m*r[g+h],u[g+h]=u[g+h]+m*t[d+h]}}}function Jt(o,t,r,i,e,n,a=ct){for(let u=0;u<r;u++){const s=u*i;let _=0;for(let c=0;c<i;c++){const l=o[s+c];_+=l*l}const d=1/Math.sqrt(_/i+a);n[u]=d;for(let c=0;c<i;c++)e[s+c]=o[s+c]*d*t[c]}}function Zt(o,t,r,i,e,n,a,u,s=ct){for(let _=0;_<e;_++){const d=_*n,c=i[_];let l=0;for(let g=0;g<n;g++){const h=o[d+g]*r[g];l+=h*t[d+g],u[g]=u[g]+o[d+g]*t[d+g]*c}const m=c*c*c/n;for(let g=0;g<n;g++){const h=o[d+g]*r[g];a[d+g]=a[d+g]+h*c-m*l*t[d+g]}}}const xt=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],te=-10,ee=5;function Ye(o){const{dModel:t,dState:r,dConv:i,dInner:e,dtRank:n}=o;return{wInProj:new Float32Array(2*e*t),bInProj:new Float32Array(2*e),wConv:new Float32Array(e*i),bConv:new Float32Array(e),wXProj:new Float32Array((n+2*r)*e),bXProj:new Float32Array(n+2*r),wDtProj:new Float32Array(e*n),bDtProj:new Float32Array(e),A_log:new Float32Array(e*r),D_vec:new Float32Array(e),wOutProj:new Float32Array(t*e),bOutProj:new Float32Array(t),normWeight:new Float32Array(t)}}function re(o,t,r){const{dModel:i,dState:e,dConv:n,dInner:a,dtRank:u,batch:s,seqLen:_}=r,d=s*_,c=u+2*e,l=new Float32Array(d*i),m=new Float32Array(d);Jt(o,t.normWeight,d,i,l,m);const g=new Float32Array(d*2*a);ot(l,t.wInProj,t.bInProj,d,i,2*a,g);const h=new Float32Array(d*a),p=new Float32Array(d*a);for(let f=0;f<d;f++)for(let x=0;x<a;x++)h[f*a+x]=g[f*2*a+x],p[f*a+x]=g[f*2*a+a+x];const w=new Float32Array(d*a);for(let f=0;f<s;f++)for(let x=0;x<_;x++){const B=(f*_+x)*a;for(let R=0;R<a;R++){let U=t.bConv[R];for(let I=0;I<n;I++)x>=I&&(U+=t.wConv[R*n+I]*h[(f*_+x-I)*a+R]);w[B+R]=U}}const v=new Float32Array(d*a);for(let f=0;f<d*a;f++)v[f]=Nt(w[f]);const b=new Float32Array(d*c);ot(v,t.wXProj,t.bXProj,d,a,c,b);const y=new Float32Array(d*u),D=new Float32Array(d*e),L=new Float32Array(d*e);for(let f=0;f<d;f++){for(let x=0;x<u;x++)y[f*u+x]=b[f*c+x];for(let x=0;x<e;x++)D[f*e+x]=b[f*c+u+x],L[f*e+x]=b[f*c+u+e+x]}const F=new Float32Array(d*a);ot(y,t.wDtProj,t.bDtProj,d,u,a,F);const k=new Float32Array(d*a);for(let f=0;f<d*a;f++)k[f]=Ve(F[f]);const W=new Float32Array(a*e);for(let f=0;f<a*e;f++)W[f]=-Math.exp(Math.min(ee,Math.max(te,t.A_log[f])));const S=new Float32Array(d*a*e),O=new Float32Array(d*a*e),G=new Float32Array(d*a*e),K=new Float32Array(d*a);for(let f=0;f<s;f++)for(let x=0;x<_;x++){const B=f*_+x;for(let R=0;R<a;R++){const U=k[B*a+R],I=v[B*a+R];let C=t.D_vec[R]*I;for(let M=0;M<e;M++){const $=W[R*e+M],J=Math.exp(U*$),X=(J-1)/$*D[B*e+M],V=(B*a+R)*e+M;S[V]=J,O[V]=X;const tt=x===0?0:G[((B-1)*a+R)*e+M],at=J*tt+X*I;G[V]=at,C+=L[B*e+M]*at}K[B*a+R]=C}}const H=new Float32Array(d*a),q=new Float32Array(d*a);for(let f=0;f<d*a;f++)H[f]=Nt(p[f]),q[f]=K[f]*H[f];const A=new Float32Array(d*i);ot(q,t.wOutProj,t.bOutProj,d,a,i,A);for(let f=0;f<d*i;f++)A[f]=A[f]+o[f];return{output:A,cache:{x:o,normInv:m,normOut:l,xConvIn:h,z:p,convOut:w,u:v,dtRaw:y,bRaw:D,cRaw:L,deltaFull:F,dv:k,aCont:W,aBar:S,bBar:O,h:G,scanY:K,siluZ:H,gated:q}}}function Qe(o,t,r,i,e){const{dModel:n,dState:a,dConv:u,dInner:s,dtRank:_,batch:d,seqLen:c}=i,l=d*c,m=_+2*a,g=new Float32Array(l*n);g.set(o);const h=new Float32Array(l*s);_t(o,r.gated,t.wOutProj,l,s,n,h,e.wOutProj,e.bOutProj);const p=new Float32Array(l*s),w=new Float32Array(l*s);for(let A=0;A<l*s;A++)p[A]=h[A]*r.siluZ[A],w[A]=h[A]*r.scanY[A]*St(r.z[A]);const v=new Float32Array(l*s),b=new Float32Array(l*a),y=new Float32Array(l*a),D=new Float32Array(l*s),L=new Float32Array(s*a),F=new Float32Array(s*a);for(let A=0;A<d;A++){F.fill(0);for(let f=c-1;f>=0;f--){const x=A*c+f;for(let B=0;B<s;B++){const R=p[x*s+B],U=r.u[x*s+B],I=r.dv[x*s+B];e.D_vec[B]=e.D_vec[B]+R*U,v[x*s+B]=v[x*s+B]+R*t.D_vec[B];let C=0;for(let M=0;M<a;M++){const $=(x*s+B)*a+M,J=r.h[$],X=r.aBar[$],V=r.bBar[$],tt=r.aCont[B*a+M],at=r.cRaw[x*a+M];y[x*a+M]=y[x*a+M]+R*J;const ut=R*at+F[B*a+M],de=f===0?0:r.h[((x-1)*s+B)*a+M],kt=ut*de,bt=ut*U;v[x*s+B]=v[x*s+B]+ut*V,F[B*a+M]=ut*X;const Lt=r.bRaw[x*a+M];C+=kt*tt*X+bt*X*Lt,L[B*a+M]=L[B*a+M]+kt*I*X+bt*Lt*((I*X*tt-(X-1))/(tt*tt)),b[x*a+M]=b[x*a+M]+bt*((X-1)/tt)}D[x*s+B]=D[x*s+B]+C}}}for(let A=0;A<s*a;A++){const f=t.A_log[A];f<=te||f>=ee||(e.A_log[A]=e.A_log[A]+L[A]*r.aCont[A])}const k=new Float32Array(l*s);for(let A=0;A<l*s;A++)k[A]=D[A]*Qt(r.deltaFull[A]);const W=new Float32Array(l*_);_t(k,r.dtRaw,t.wDtProj,l,_,s,W,e.wDtProj,e.bDtProj);const S=new Float32Array(l*m);for(let A=0;A<l;A++){for(let f=0;f<_;f++)S[A*m+f]=W[A*_+f];for(let f=0;f<a;f++)S[A*m+_+f]=b[A*a+f],S[A*m+_+a+f]=y[A*a+f]}const O=new Float32Array(l*s);_t(S,r.u,t.wXProj,l,s,m,O,e.wXProj,e.bXProj);for(let A=0;A<l*s;A++)v[A]=v[A]+O[A];const G=new Float32Array(l*s);for(let A=0;A<l*s;A++)G[A]=v[A]*St(r.convOut[A]);const K=new Float32Array(l*s);for(let A=0;A<d;A++)for(let f=0;f<c;f++){const x=A*c+f;for(let B=0;B<s;B++){const R=G[x*s+B];if(R!==0){e.bConv[B]=e.bConv[B]+R;for(let U=0;U<u;U++){if(f<U)continue;const I=(A*c+f-U)*s+B;e.wConv[B*u+U]=e.wConv[B*u+U]+R*r.xConvIn[I],K[I]=K[I]+R*t.wConv[B*u+U]}}}}const H=new Float32Array(l*2*s);for(let A=0;A<l;A++)for(let f=0;f<s;f++)H[A*2*s+f]=K[A*s+f],H[A*2*s+s+f]=w[A*s+f];const q=new Float32Array(l*n);return _t(H,r.normOut,t.wInProj,l,n,2*s,q,e.wInProj,e.bInProj),Zt(q,r.x,t.normWeight,r.normInv,l,n,g,e.normWeight,ct),g}const Ct=["mamba1"];function Je(o){const t={dModel:o.dModel,dState:o.dState,dConv:o.dConv,dInner:o.dInner,dtRank:o.dtRank};return{embedding:new Float32Array(o.vocabSize*o.dModel),finalNorm:new Float32Array(o.dModel),lmHeadBias:new Float32Array(o.vocabSize),layers:Array.from({length:o.numLayers},()=>Ye(t))}}function Ze(o){const t=new Map;t.set("embedding",o.embedding);for(let r=0;r<o.layers.length;r++){const i=o.layers[r];for(const e of xt)t.set(`layer${r}.${e}`,i[e])}return t.set("final_norm",o.finalNorm),t.set("lm_head_bias",o.lmHeadBias),t}function tr(o){const t=new Map;t.set("embedding",o.embedding);for(let r=0;r<o.layers.length;r++){const i=o.layers[r];for(const e of xt)t.set(`layer${r}.${e}`,i[e])}return t.set("final_norm",o.finalNorm),t.set("lm_head_bias",o.lmHeadBias),t}function er(o,t){const r=(d,c)=>{const l=o.get(d);if(!l)throw new Error(`cpuWeightsFromNamed: missing tensor "${d}"`);if(l.length!==c)throw new Error(`cpuWeightsFromNamed: "${d}" has ${l.length} elements, expected ${c}`);return l},{dModel:i,dState:e,dConv:n,dInner:a,dtRank:u}=t,s={wInProj:2*a*i,bInProj:2*a,wConv:a*n,bConv:a,wXProj:(u+2*e)*a,bXProj:u+2*e,wDtProj:a*u,bDtProj:a,A_log:a*e,D_vec:a,wOutProj:i*a,bOutProj:i,normWeight:i},_=[];for(let d=0;d<t.numLayers;d++){const c={};for(const l of xt)c[l]=r(`layer${d}.${l}`,s[l]);_.push(c)}return{embedding:r("embedding",t.vocabSize*i),finalNorm:r("final_norm",i),lmHeadBias:r("lm_head_bias",t.vocabSize),layers:_}}function ae(o,t,r,i,e,n=!1){const{vocabSize:a,dModel:u}=r,s=i*e;let _=new Float32Array(s*u);for(let p=0;p<s;p++){const w=o[p];if(w<0||w>=a)throw new Error(`token id ${w} out of range [0, ${a})`);_.set(t.embedding.subarray(w*u,(w+1)*u),p*u)}const d={dModel:u,dState:r.dState,dConv:r.dConv,dInner:r.dInner,dtRank:r.dtRank,batch:i,seqLen:e},c=[],l=[];for(let p=0;p<r.numLayers;p++){c.push(_);const{output:w,cache:v}=re(_,t.layers[p],d);n||l.push(v),_=w}const m=new Float32Array(s*u),g=new Float32Array(s);Jt(_,t.finalNorm,s,u,m,g,ct);const h=new Float32Array(s*a);return ot(m,t.embedding,t.lmHeadBias,s,u,a,h),{hiddenIn:c,layer:l,lastHidden:_,normOut:m,normInv:g,logits:h}}function rr(o,t,r,i,e){return ae(o,t,r,i,e).logits}function ca(o,t,r,i,e,n){const a=rr(o,r,i,e,n),u=e*n,s=i.vocabSize;let _=0;for(let d=0;d<u;d++)_+=pt(a.subarray(d*s,(d+1)*s),t[d]);return _/u}function ar(o,t,r,i,e,n,a={}){const{vocabSize:u,dModel:s}=i,_=e*n,d=a.activationCheckpointing??!1,c=ae(o,r,i,e,n,d),l=Je(i);let m=0;const g=new Float32Array(_*u);for(let y=0;y<_;y++){const D=c.logits.subarray(y*u,(y+1)*u),L=t[y];m+=pt(D,L);const F=me(D,L);for(let k=0;k<u;k++)g[y*u+k]=F[k]/_}const h=m/_,p=new Float32Array(_*s);for(let y=0;y<_;y++){const D=y*u,L=y*s;for(let F=0;F<u;F++){const k=g[D+F];if(k===0)continue;l.lmHeadBias[F]=l.lmHeadBias[F]+k;const W=F*s;for(let S=0;S<s;S++)p[L+S]=p[L+S]+k*r.embedding[W+S],l.embedding[W+S]=l.embedding[W+S]+k*c.normOut[L+S]}}const w=new Float32Array(_*s);Zt(p,c.lastHidden,r.finalNorm,c.normInv,_,s,w,l.finalNorm,ct);const v={dModel:s,dState:i.dState,dConv:i.dConv,dInner:i.dInner,dtRank:i.dtRank,batch:e,seqLen:n};let b=w;for(let y=i.numLayers-1;y>=0;y--){const D=d?re(c.hiddenIn[y],r.layers[y],v).cache:c.layer[y];b=Qe(b,r.layers[y],D,v,l.layers[y])}for(let y=0;y<_;y++){const L=o[y]*s,F=y*s;for(let k=0;k<s;k++)l.embedding[L+k]=l.embedding[L+k]+b[F+k]}return{loss:h,grads:Ze(l)}}function nr(o,t){const{dModel:r,dState:i,dConv:e,dInner:n,dtRank:a}=t;if(o==="embedding")return[t.vocabSize,r];switch(o.startsWith("layer")?o.slice(o.indexOf(".")+1):o){case"wInProj":return[2*n,r];case"wConv":return[n,e];case"wXProj":return[a+2*i,n];case"wDtProj":return[n,a];case"A_log":return[n,i];case"wOutProj":return[r,n];default:return null}}const ir=["wInProj","wXProj","wDtProj","wOutProj"],or=.05;class ua{model;tokenizer;device;_moments;_step;_dims;_mirror;_mirrorByName;_adapters;_loraBase;_shard;constructor(t,r=null){this.model=t,this.tokenizer=r,this.device=t.device,this._moments=new Map,this._step=0,this._dims=sr(t),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const t=this.model.getTrainableParams();if(this._adapters.size===0)return t.reduce((i,e)=>i+e.numel,0);let r=0;for(const i of t){const e=this._adapters.get(i.name);e&&(r+=e.numParams())}return r}_owns(t){return this._shard===null||t%this._shard.count===this._shard.index}_installAdapters(t){if(this._adapters.size>0)return;const r=new Set(t.targets??ir),i=this._mirrorByName;for(const e of this.model.getTrainableParams()){const n=e.name.includes(".")?e.name.slice(e.name.indexOf(".")+1):e.name;if(!r.has(n))continue;const a=nr(e.name,this._dims);if(!a)continue;const[u,s]=a,_=Math.max(1,Math.min(t.rank??8,u,s));this._adapters.set(e.name,new fe(u,s,{...t,rank:_})),this._loraBase.set(e.name,Float32Array.from(i.get(e.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...r].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const t=this._mirrorByName;for(const[r,i]of this._adapters){const e=t.get(r),n=this._loraBase.get(r),a=i.delta();for(let u=0;u<e.length;u++)e[u]=n[u]+a[u]}}_momentFor(t){let r=this._moments.get(t.name);return r||(r={m:new Float32Array(t.numel),v:new Float32Array(t.numel)},this._moments.set(t.name,r)),r}async _syncMirrorFromGpu(){const t=new Map;for(const r of this.model.parameters())t.set(r.name,await rt(this.device,r.buf,r.numel*4));t.set("lm_head_bias",await rt(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=er(t,this._dims),this._mirrorByName=tr(this._mirror)}async train(t,r={}){const{learningRate:i=1e-4,epochs:e=5,batchSize:n=1,seqLen:a=512,maxGradNorm:u=1,weightDecay:s=.01,beta1:_=.9,beta2:d=.999,eps:c=1e-8,wsla:l=!1,onEpochEnd:m=null}=r,g=Math.max(1,Math.floor(r.gradientAccumulation??1));if(this._shard=r.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const h=r.maxDelta??(l?or:0);l&&this.model.setWSLAMode(!0);let p;if(typeof t=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");p=this.tokenizer.encode(t)}else p=Array.from(t);if(p.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const w=dr(p,a);if(w.length===0)throw new Error("Input is too short to form any training chunk.");const v=lr(w,Math.max(1,Math.floor(n)));await this._syncMirrorFromGpu(),r.lora&&this._installAdapters(r.lora);const b=[];for(let y=0;y<e;y++){let D=0,L=0,F=0;for(let W=0;W<v.length;W+=g){const S=v.slice(W,W+g),{loss:O,gradNorm:G}=await this._trainStep(S,{learningRate:i,maxGradNorm:u,weightDecay:s,beta1:_,beta2:d,eps:c,wsla:l,maxDelta:h,...r.activationCheckpointing?{activationCheckpointing:!0}:{}});D+=O,L+=G,F++}const k=D/F;b.push(k),m&&m(y+1,k,L/F)}return l&&this.model.setWSLAMode(!1),b}async _trainStep(t,r){const{learningRate:i,maxGradNorm:e,weightDecay:n,beta1:a,beta2:u,eps:s,maxDelta:_}=r;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const d=this._mirror,c=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const l=r.activationCheckpointing?{activationCheckpointing:!0}:{};let m=0,g=new Map;for(const b of t){const y=ar(b.inputs,b.targets,d,this._dims,b.batch,b.seqLen,l);if(m+=y.loss/t.length,g.size===0){for(const D of y.grads.values())for(let L=0;L<D.length;L++)D[L]=D[L]/t.length;g=y.grads}else for(const[D,L]of y.grads){const F=g.get(D);for(let k=0;k<L.length;k++)F[k]=F[k]+L[k]/t.length}}const h=this.model.getTrainableParams();if(this._adapters.size>0)for(const[b,y]of this._adapters){const D=g.get(b);D&&(y.zeroGrad(),y.accumulateGradient(D))}let p=0;for(const b of h){const y=g.get(b.name);if(y)for(let D=0;D<y.length;D++)p+=y[D]*y[D]}const w=Math.sqrt(p),v=e>0&&w>e?e/w:1;return this._adamwStep(h,g,c,{learningRate:i,weightDecay:n,beta1:a,beta2:u,eps:s,beta1_t:Math.pow(a,this._step),beta2_t:Math.pow(u,this._step),maxDelta:_,gradScale:v}),{loss:m,gradNorm:w}}_adamwStep(t,r,i,e){const{learningRate:n,weightDecay:a,beta1:u,beta2:s,eps:_,beta1_t:d,beta2_t:c,maxDelta:l,gradScale:m}=e,g={lr:n,beta1:u,beta2:s,eps:_,weightDecay:a,beta1_t:d,beta2_t:c,maxDelta:l,gradScale:m};for(let h=0;h<t.length;h++){const p=t[h];if(!this._owns(h))continue;const w=this._adapters.get(p.name);if(w){const D=i.get(p.name),L=this._loraBase.get(p.name),[F,k]=[w.A,w.B],[W,S]=[w.gradients()[1].data,w.gradients()[0].data],O=this._momentNamed(`${p.name}::loraB`,k.length),G=this._momentNamed(`${p.name}::loraA`,F.length);wt(k,S,O.m,O.v,g),wt(F,W,G.m,G.v,g);const K=w.delta();for(let H=0;H<D.length;H++)D[H]=L[H]+K[H];st(this.device,p.buf,D);continue}const v=r.get(p.name),b=i.get(p.name);if(!v||!b)continue;if(v.length!==p.numel||b.length!==p.numel)throw new Error(`MambaTrainer: parameter "${p.name}" is ${p.numel} elements but the gradient engine produced ${v.length} — model and CPU mirror disagree.`);const y=this._momentFor(p);wt(b,v,y.m,y.v,g),st(this.device,p.buf,b)}}_momentNamed(t,r){let i=this._moments.get(t);return i||(i={m:new Float32Array(r),v:new Float32Array(r)},this._moments.set(t,i)),i}optimizerStateBytes(){let t=0;for(const r of this._moments.values())t+=r.m.byteLength+r.v.byteLength;return t}async evaluate(t){let r;if(typeof t=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");r=Array.from(this.tokenizer.encode(t))}else r=Array.from(t);const i=r.length,e=this.model.config.vocabSize,{logits:n}=await this.model.forward(new Uint32Array(r.slice(0,-1)),1,i-1);let a=0;for(let s=0;s<i-1;s++){const _=s*e;a+=pt(n.slice(_,_+e),r[s+1])}const u=a/(i-1);return Math.exp(u)}}function sr(o){const t=o.layerSpecs.map((n,a)=>({i:a,type:n.type})).filter(({type:n})=>!Ct.includes(n));if(t.length>0){const n=t.map(({i:a,type:u})=>`layer${a}=${u}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${Ct.join("/")} layers only, but this model has ${n}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const r=o.layers[0],i=r?.dInner??o.config.expand*o.config.dModel,e=r?.dtRank??Math.ceil(o.config.dModel/16);return{vocabSize:o.config.vocabSize,dModel:o.config.dModel,dState:o.config.dState,dConv:o.config.dConv,dInner:i,dtRank:e,numLayers:o.layers.length}}function dr(o,t){const r=[];for(let e=0;e+t<o.length;e+=t)r.push({inputs:o.slice(e,e+t),targets:o.slice(e+1,e+t+1)});const i=o.length%t;if(i>1){const e=o.length-i;r.push({inputs:o.slice(e,-1),targets:o.slice(e+1)})}return r}function lr(o,t){const r=[];let i=0;for(;i<o.length;){const e=o[i].inputs.length,n=[];for(;i<o.length&&n.length<t&&o[i].inputs.length===e;)n.push(o[i]),i++;r.push({inputs:n.flatMap(a=>a.inputs),targets:n.flatMap(a=>a.targets),batch:n.length,seqLen:e})}return r}function _a(o,t,r){return[...t,...o.encode(r)]}function cr(o,t,r,i){if(o.config.vocabSize!==t.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${o.config.vocabSize}) must equal codec.vocabSize (${t.vocabSize})`);const e=o.generate(r,{...i,stopToken:i.stopToken??t.vocab.eosVideo});return{video:t.decode(e),tokens:e}}function ha(o,t,r,i){const{video:e,tokens:n}=cr(o,t.video,r,i);return{image:e[0]??new Float32Array(t.frameSize),tokens:n}}const ur=0,_r=5,hr=2;class Z{parts=[];byte(t){this.parts.push(t&255)}rawVarint(t){if(t<0||!Number.isFinite(t))throw new Error(`ProtoWriter: bad varint ${t}`);let r=t;for(;r>=128;)this.byte(r%128|128),r=Math.floor(r/128);this.byte(r)}tag(t,r){this.rawVarint(t*8+r)}rawBytes(t){for(let r=0;r<t.length;r++)this.byte(t[r])}varint(t,r){this.tag(t,ur),this.rawVarint(r)}float(t,r){this.tag(t,_r);const i=new ArrayBuffer(4);new DataView(i).setFloat32(0,r,!0),this.rawBytes(new Uint8Array(i))}bytes(t,r){this.tag(t,hr),this.rawVarint(r.length),this.rawBytes(r)}string(t,r){this.bytes(t,new TextEncoder().encode(r))}message(t,r){this.bytes(t,r.finish())}finish(){return Uint8Array.from(this.parts)}}function gr(o){const t=new Uint8Array(o.length*4),r=new DataView(t.buffer);for(let i=0;i<o.length;i++)r.setFloat32(i*4,o[i],!0);return t}const pr=18,mr=8,ne=1,ie=7,fr=1,br=2,wr=3,vr=7;class yr{nodes=[];inits=[];uid=0;tmp(t){return`${t}_${this.uid++}`}initFloat(t,r,i){return this.inits.push({name:t,dims:r,dataType:ne,raw:gr(i)}),t}initInt64(t,r,i){return this.inits.push({name:t,dims:r,dataType:ie,int64:i}),t}node(t,r,i,e=[]){return this.nodes.push({op:t,inputs:r,outputs:i,name:`${t}_${this.uid++}`,attrs:e}),i}op(t,r,i,e=[]){const n=this.tmp(i);return this.node(t,r,[n],e),n}}function Ft(o,t,r,i,e){const n=o.op("Mul",[t,t],"rms_sq"),a=o.op("ReduceMean",[n,e],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),u=o.op("Add",[a,i],"rms_eps"),s=o.op("Sqrt",[u],"rms_r"),_=o.op("Div",[t,s],"rms_div");return o.op("Mul",[_,r],"rms_y")}function It(o,t,r,i,e,n){const a=o.op("Transpose",[r],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),u=o.op("Add",[o.op("MatMul",[t,a],"ffn_mm1"),i],"ffn_pre"),s=o.op("Relu",[u],"ffn_h"),_=o.op("Transpose",[e],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return o.op("Add",[o.op("MatMul",[s,_],"ffn_mm2"),n],"ffn_y")}function jt(o,t={}){const r=Gt(o),i=qt(o),e=new Map(i.map(b=>[b.name,b])),n=b=>{const y=e.get(b);if(!y)throw new Error(`export/onnx: missing tensor ${b}`);return y},a=new yr,{vocabSize:u,dModel:s,numLayers:_,convKernel:d,numExperts:c,topK:l}=r,m=a.initFloat("token_embedding.weight",[u,s],n("token_embedding.weight").data),g=a.initFloat("rms_eps",[1],new Float32Array([1e-5])),h=a.initInt64("axes_last",[1],[2]),p=a.initInt64("topk_k",[1],[l]);let w=a.op("Gather",[m,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let b=0;b<_;b++){const y=`layers.${b}`,D=a.initFloat(`${y}.norm_conv.weight`,[s],n(`${y}.norm_conv.weight`).data),L=Ft(a,w,D,g,h),F=n(`${y}.conv.weight`).data,k=new Float32Array(s*d);for(let X=0;X<s;X++)for(let V=0;V<d;V++)k[X*d+(d-1-V)]=F[X*d+V];const W=a.initFloat(`${y}.conv.onnx_weight`,[s,1,d],k),S=a.op("Transpose",[L],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),O=a.op("Conv",[S,W],"conv_out",[{kind:"i",name:"group",value:s},{kind:"ints",name:"kernel_shape",value:[d]},{kind:"ints",name:"pads",value:[d-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),G=a.op("Transpose",[O],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),K=a.op("Add",[w,G],"after_conv"),H=a.initFloat(`${y}.norm_moe.weight`,[s],n(`${y}.norm_moe.weight`).data),q=Ft(a,K,H,g,h),A=a.initFloat(`${y}.moe.router.weight`,[c,s],n(`${y}.moe.router.weight`).data),f=a.op("Transpose",[A],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),x=a.op("MatMul",[q,f],"router_logits"),B=a.tmp("topk_v"),R=a.tmp("topk_i");a.node("TopK",[x,p],[B,R],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const U=a.op("Softmax",[B],"gates",[{kind:"i",name:"axis",value:2}]),I=a.op("Sub",[x,x],"zeros"),C=a.op("ScatterElements",[I,R,U],"combine",[{kind:"i",name:"axis",value:2}]),M=It(a,q,a.initFloat(`${y}.moe.shared.w1`,[r.hiddenDim,s],n(`${y}.moe.shared.w1`).data),a.initFloat(`${y}.moe.shared.b1`,[r.hiddenDim],n(`${y}.moe.shared.b1`).data),a.initFloat(`${y}.moe.shared.w2`,[s,r.hiddenDim],n(`${y}.moe.shared.w2`).data),a.initFloat(`${y}.moe.shared.b2`,[s],n(`${y}.moe.shared.b2`).data)),$=Array.from({length:c},(X,V)=>a.tmp(`combine_${V}`));a.node("Split",[C],$,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:c}]);let J=M;for(let X=0;X<c;X++){const V=`${y}.moe.experts.${X}`,tt=It(a,q,a.initFloat(`${V}.w1`,[r.hiddenDim,s],n(`${V}.w1`).data),a.initFloat(`${V}.b1`,[r.hiddenDim],n(`${V}.b1`).data),a.initFloat(`${V}.w2`,[s,r.hiddenDim],n(`${V}.w2`).data),a.initFloat(`${V}.b2`,[s],n(`${V}.b2`).data)),at=a.op("Mul",[$[X],tt],"expert_w");J=a.op("Add",[J,at],"moe_acc")}w=a.op("Add",[K,J],"after_moe")}const v=a.op("Transpose",[m],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return a.node("MatMul",[w,v],["logits"]),Br(a,r,t)}function xr(o){const t=new Z;switch(t.string(1,o.name),o.kind){case"i":t.varint(20,br),t.varint(3,o.value);break;case"ints":t.varint(20,vr);for(const r of o.value)t.varint(8,r);break;case"f":t.varint(20,fr),t.float(2,o.value);break;case"s":t.varint(20,wr),t.string(4,o.value);break}return t}function Ar(o){const t=new Z;for(const r of o.inputs)t.string(1,r);for(const r of o.outputs)t.string(2,r);t.string(3,o.name),t.string(4,o.op);for(const r of o.attrs)t.message(5,xr(r));return t}function kr(o){const t=new Z;for(const r of o.dims)t.varint(1,r);if(t.varint(2,o.dataType),t.string(8,o.name),o.int64)for(const r of o.int64)t.varint(7,r);return o.raw&&t.bytes(9,o.raw),t}function Lr(o){const t=new Z;return t.string(2,o),t}function Dr(o){const t=new Z;return t.varint(1,o),t}function Tt(o,t,r){const i=new Z;for(const u of r)i.message(1,typeof u=="string"?Lr(u):Dr(u));const e=new Z;e.varint(1,t),e.message(2,i);const n=new Z;n.message(1,e);const a=new Z;return a.string(1,o),a.message(2,n),a}function Br(o,t,r){const i=new Z;for(const a of o.nodes)i.message(1,Ar(a));i.string(2,"evermind");for(const a of o.inits)i.message(5,kr(a));i.message(11,Tt("input_ids",ie,["batch","seq"])),i.message(12,Tt("logits",ne,["batch","seq",t.vocabSize]));const e=new Z;e.string(1,""),e.varint(2,pr);const n=new Z;return n.varint(1,mr),n.string(2,r.producerName??"builderforce-memory-engine"),n.string(3,r.producerVersion??"evermind"),n.message(7,i),n.message(8,e),n.finish()}const Pr=1179993927,Mr=3,it=32,Wr=4,Nr=8,Sr=0,Cr=1;class Fr{buf=new Uint8Array(1024);len=0;ensure(t){if(this.len+t<=this.buf.length)return;let r=this.buf.length*2;for(;r<this.len+t;)r*=2;const i=new Uint8Array(r);i.set(this.buf.subarray(0,this.len)),this.buf=i}u32(t){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,t,!0),this.len+=4}u64(t){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(t),!0),this.len+=8}raw(t){this.ensure(t.length),this.buf.set(t,this.len),this.len+=t.length}alignTo(t){const r=(t-this.len%t)%t;r>0&&(this.ensure(r),this.len+=r)}string(t){const r=new TextEncoder().encode(t);this.u64(r.length),this.raw(r)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function Ir(o,t){if(!t){const e=new Uint8Array(o.length*4),n=new DataView(e.buffer);for(let a=0;a<o.length;a++)n.setFloat32(a*4,o[a],!0);return e}const r=new Uint8Array(o.length*2),i=new DataView(r.buffer);for(let e=0;e<o.length;e++)i.setUint16(e*2,be(o[e]),!0);return r}function Et(o,t={}){const r=t.fp16??!1,i=Gt(o),e=qt(o),n=r?Cr:Sr,a=r?2:4,u=[["evermind.vocab_size",i.vocabSize],["evermind.embedding_length",i.dModel],["evermind.block_count",i.numLayers],["evermind.conv_kernel",i.convKernel],["evermind.feed_forward_length",i.hiddenDim],["evermind.expert_count",i.numExperts],["evermind.expert_used_count",i.topK],["general.alignment",it]],s=[["general.architecture","evermind"],["general.name",t.name??"Evermind"]],_=new Fr;_.u32(Pr),_.u32(Mr),_.u64(e.length),_.u64(u.length+s.length);for(const[g,h]of s)_.string(g),_.u32(Nr),_.string(h);for(const[g,h]of u)_.string(g),_.u32(Wr),_.u32(h);const d=g=>[...g.shape].reverse();let c=0;const l=[];for(const g of e){l.push(c);const h=g.data.length*a;c+=h,c+=(it-c%it)%it}e.forEach((g,h)=>{_.string(g.name);const p=d(g);_.u32(p.length);for(const w of p)_.u64(w);_.u32(n),_.u64(l[h])}),_.alignTo(it);const m=_.length;for(let g=0;g<e.length;g++){const h=m+l[g];for(;_.length<h;)_.raw(new Uint8Array(1));_.raw(Ir(e[g].data,r))}return _.bytes()}const ga=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],jr="application/json";function vt(o,t){return{path:o,data:JSON.stringify(t,null,2),contentType:jr}}function pa(o,t,r={},i){const e=we(o),n=()=>({format:t,files:[],paramCount:e});switch(t){case"safetensors":{const a=n();return a.files.push({path:"model.safetensors",data:Bt(o,{fp16:r.fp16}),contentType:"application/octet-stream"}),a}case"onnx":{const a=n();return a.files.push({path:"model.onnx",data:jt(o,{producerVersion:r.version}),contentType:"application/octet-stream"}),a}case"gguf":{const a=n();return a.files.push({path:"model.gguf",data:Et(o,{name:r.name,fp16:r.fp16}),contentType:"application/octet-stream"}),a}case"huggingface":{if(!i)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const a=n();return a.files.push({path:"model.safetensors",data:Bt(o,{fp16:r.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:jt(o,{producerVersion:r.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:Et(o,{name:r.name,fp16:r.fp16}),contentType:"application/octet-stream"},vt("config.json",ve(o)),vt("generation_config.json",Ae()),vt("tokenizer.json",ye(i)),{path:"README.md",data:xe(o,r),contentType:"text/markdown"}),a}default:throw new Error(`exportEvermind: unknown format "${String(t)}"`)}}const Tr=`

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
`,ma=`

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
`,fa={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},Er={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},oe=8,gt=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],Rr=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],se=[0,.2,.5,.5,.8,.5,.7,.5];function At(o,t){const r=Rr[o];return r?Number.isNaN(t)?r[0]:Math.max(r[0],Math.min(r[1],t)):t}function ba(o){for(let t=0;t<o.length&&t<oe;t++)o[t]=At(t,o[t]);return o}function Hr(){return Float32Array.from(se)}function zr(o){const t={};for(let r=0;r<gt.length;r++)t[gt[r]]=o[r]??0;return t}function Or(o){const t=Hr();for(let r=0;r<gt.length;r++){const i=o[gt[r]];typeof i=="number"&&!Number.isNaN(i)&&(t[r]=At(r,i))}return t}function et(o){return((typeof o=="number"&&!Number.isNaN(o)?Math.max(0,Math.min(100,o)):50)-50)/50}function Gr(o){const t=zr(se);if(!o)return t;const r=et(o.openness),i=et(o.emotionality),e=et(o.conscientiousness),n=et(o.extraversion),a=et(o.regulatoryFocus),u=et(o.riskTolerance),s=et(o.grit),_=et(o.stimulation),d=(c,l)=>{t[c]=At(Er[c],l)};return d("driveCuriosity",.5+.35*r+.15*_),d("exploration",.4+.3*r+.25*u+.15*a),d("driveCaution",.5+.3*e-.3*u-.2*a+.15*i),d("arousal",.2+.2*i+.1*n),d("driveSocial",.5+.35*n),d("driveEffort",.8+.15*s+.1*e),d("valence",0+.1*a-.1*i),d("attention",.7+.1*e),t}function wa(o){return Or(Gr(o))}const qr={inputDim:32,hiddenDim:16,stateDim:oe,rewardWeight:.5},Rt=1280131651,Kr=296863214;function $r(o){return 1/(1+Math.exp(-o))}class va{config;win;ws;aLogit;woutState;boutState;woutReward;boutReward;gWin;gWs;gALogit;gWoutState;gBoutState;gWoutReward;gBoutReward;constructor(t={}){const r={...qr,...t};if(r.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${r.hiddenDim})`);this.config=r;const{inputDim:i,hiddenDim:e,stateDim:n}=r,a=new Ot((t.seed??Kr)>>>0||1),u=_=>{const d=Math.max(a.next(),1e-12),c=a.next();return _*Math.sqrt(-2*Math.log(d))*Math.cos(2*Math.PI*c)},s=(_,d)=>{const c=new Float32Array(_);for(let l=0;l<_;l++)c[l]=u(d);return c};this.win=s(e*i,.1),this.ws=s(e*n,.1),this.aLogit=s(e,.05),this.woutState=s(n*e,.05),this.boutState=new Float32Array(n),this.woutReward=s(e,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(t,r,i){const e=this._forwardCached(t,r,i);return{hidden:e.hn,delta:e.delta,reward:e.reward}}_forwardCached(t,r,i){const{inputDim:e,hiddenDim:n,stateDim:a}=this.config,u=Float32Array.from({length:e},(h,p)=>t[p]??0),s=Float32Array.from({length:n},(h,p)=>r[p]??0),_=Float32Array.from({length:a},(h,p)=>i[p]??0),d=new Float32Array(n),c=new Float32Array(n),l=new Float32Array(n);for(let h=0;h<n;h++){let p=0;const w=h*e;for(let b=0;b<e;b++)p+=this.win[w+b]*u[b];const v=h*a;for(let b=0;b<a;b++)p+=this.ws[v+b]*_[b];d[h]=$r(this.aLogit[h]),c[h]=Math.tanh(p),l[h]=d[h]*s[h]+(1-d[h])*c[h]}const m=new Float32Array(a);for(let h=0;h<a;h++){let p=this.boutState[h];const w=h*n;for(let v=0;v<n;v++)p+=this.woutState[w+v]*l[v];m[h]=Math.tanh(p)}let g=this.boutReward[0];for(let h=0;h<n;h++)g+=this.woutReward[h]*l[h];return{x:u,sPrev:_,hPrev:s,a:d,t:c,hn:l,delta:m,reward:g}}backwardStep(t,r,i,e,n){const{inputDim:a,hiddenDim:u,stateDim:s,rewardWeight:_}=this.config,d=this._forwardCached(t,r,i);let c=0;const l=new Float32Array(s);for(let p=0;p<s;p++){const w=d.delta[p]-(e[p]??0);c+=.5*w*w,l[p]=w}const m=d.reward-n;c+=.5*_*m*m;const g=_*m,h=new Float32Array(u);for(let p=0;p<s;p++){const w=l[p]*(1-d.delta[p]*d.delta[p]);this.gBoutState[p]=this.gBoutState[p]+w;const v=p*u;for(let b=0;b<u;b++)this.gWoutState[v+b]=this.gWoutState[v+b]+w*d.hn[b],h[b]=h[b]+w*this.woutState[v+b]}this.gBoutReward[0]=this.gBoutReward[0]+g;for(let p=0;p<u;p++)this.gWoutReward[p]=this.gWoutReward[p]+g*d.hn[p],h[p]=h[p]+g*this.woutReward[p];for(let p=0;p<u;p++){const w=d.a[p],v=d.t[p];this.gALogit[p]=this.gALogit[p]+h[p]*(d.hPrev[p]-v)*w*(1-w);const b=h[p]*(1-w)*(1-v*v),y=p*a;for(let L=0;L<a;L++)this.gWin[y+L]=this.gWin[y+L]+b*d.x[L];const D=p*s;for(let L=0;L<s;L++)this.gWs[D+L]=this.gWs[D+L]+b*d.sPrev[L]}return{loss:c,hidden:d.hn}}exportWeights(t={}){const r=t.fp16??!1,i=this.parameters(),e=i.reduce((d,c)=>d+c.numel,0),n=5,a=n*4,u=r?e*2:e*4,s=new ArrayBuffer(a+u),_=new Uint32Array(s,0,n);if(_[0]=Rt,_[1]=r?2:1,_[2]=this.config.inputDim,_[3]=this.config.hiddenDim,_[4]=this.config.stateDim,r){const d=new Float32Array(e);let c=0;for(const m of i)d.set(m.data,c),c+=m.numel;const l=Ht(d);new Uint16Array(s,a,e).set(l)}else{const d=new Float32Array(s,a,e);let c=0;for(const l of i)d.set(l.data,c),c+=l.numel}return s}loadWeights(t){const r=new Uint32Array(t,0,5);if(r[0]!==Rt)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const i=r[1],e=r[2],n=r[3],a=r[4];if(e!==this.config.inputDim||n!==this.config.hiddenDim||a!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${e}/${n}/${a} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const u=this.parameters(),s=u.reduce((l,m)=>l+m.numel,0),_=20;let d;i===2?d=zt(new Uint16Array(t,_,s)):d=new Float32Array(t.slice(_,_+s*4));let c=0;for(const l of u)l.data.set(d.subarray(c,c+l.numel)),c+=l.numel}}function Ur(o,t,r,i,e,n,a,u){const s=new ArrayBuffer(32);return new Uint32Array(s,0,1).set([o]),new Float32Array(s,4,7).set([t,r,i,e,n,a,u]),s}class ya{model;device;_moments=null;_step=0;_adamwPipeline;constructor(t,r=null){this.model=t,this.device=r,this._adamwPipeline=r?z(r,Tr,"adamw_update"):null}get gpuTraining(){return this.device!=null&&this._adamwPipeline!=null}_initMoments(){this._moments||(this._moments=this.model.parameters().map(t=>({m:new Float32Array(t.numel),v:new Float32Array(t.numel)})))}async train(t,r={}){if(t.length===0)throw new Error("LimbicTrainer.train: no samples");const{learningRate:i=.05,epochs:e=50,weightDecay:n=0,beta1:a=.9,beta2:u=.999,eps:s=1e-8,maxGradNorm:_=1,onEpochEnd:d=null}=r;this._initMoments();const c=[];for(let l=0;l<e;l++){this.model.zeroGrad();let m=0;for(const D of t){const{loss:L}=this.model.backwardStep(D.input,this.model.initHidden(),D.state,D.deltaTarget,D.reward);m+=L}const g=this.model.gradients(),h=1/t.length;for(const D of g)for(let L=0;L<D.data.length;L++)D.data[L]*=h;const p=this._clipGradients(g,_);this._step++;const w=Math.pow(a,this._step),v=Math.pow(u,this._step),b={learningRate:i,weightDecay:n,beta1:a,beta2:u,eps:s,beta1_t:w,beta2_t:v};this.gpuTraining?await this._adamwStepGpu(g,b):this._adamwStepCpu(g,b);const y=m/t.length;c.push(y),d&&d(l+1,y,p)}return c}evaluate(t){if(t.length===0)return 0;let r=0;const{rewardWeight:i}=this.model.config;for(const e of t){const n=this.model.forward(e.input,this.model.initHidden(),e.state);let a=0;for(let s=0;s<n.delta.length;s++){const _=n.delta[s]-(e.deltaTarget[s]??0);a+=.5*_*_}const u=n.reward-e.reward;a+=.5*i*u*u,r+=a}return r/t.length}_clipGradients(t,r){let i=0;for(const n of t)for(let a=0;a<n.data.length;a++)i+=n.data[a]*n.data[a];const e=Math.sqrt(i);if(e>r&&e>0){const n=r/e;for(const a of t)for(let u=0;u<a.data.length;u++)a.data[u]*=n}return e}_adamwStepCpu(t,r){const i=this.model.parameters(),{learningRate:e,weightDecay:n,beta1:a,beta2:u,eps:s,beta1_t:_,beta2_t:d}=r;for(let c=0;c<i.length;c++){const l=i[c].data,m=t[c].data,g=this._moments[c];for(let h=0;h<l.length;h++){const p=m[h];g.m[h]=a*g.m[h]+(1-a)*p,g.v[h]=u*g.v[h]+(1-u)*p*p;const w=g.m[h]/(1-_),v=g.v[h]/(1-d);l[h]=l[h]*(1-e*n)-e*w/(Math.sqrt(v)+s)}}}async _adamwStepGpu(t,r){const i=this.device,e=this._adamwPipeline,n=this.model.parameters(),{learningRate:a,weightDecay:u,beta1:s,beta2:_,eps:d,beta1_t:c,beta2_t:l}=r;for(let m=0;m<n.length;m++){const g=n[m],h=this._moments[m],p=Q(i,g.data,!0),w=Q(i,t[m].data,!1),v=Q(i,h.m,!0),b=Q(i,h.v,!0),y=E(i,Ur(g.numel,a,s,_,d,u,c,l)),D=j(i,e,[y,p,w,v,b]);T(i,e,D,[N(g.numel,256),1,1]),g.data.set((await rt(i,p,g.numel*4)).subarray(0,g.numel)),h.m.set((await rt(i,v,g.numel*4)).subarray(0,g.numel)),h.v.set((await rt(i,b,g.numel*4)).subarray(0,g.numel)),p.destroy(),w.destroy(),v.destroy(),b.destroy(),y.destroy()}}}const xa=`

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
`;export{qe as $,ta as A,ya as B,ft as C,qr as D,ga as E,De as F,ma as G,Re as H,Me as I,Se as J,na as K,gt as L,xt as M,se as N,ua as O,ia as P,ct as Q,fa as R,Vr as S,Pt as T,Zr as U,Jr as V,Ce as W,ea as X,Be as Y,Tr as Z,or as _,Er as a,ht as a0,oa as a1,da as a2,$e as a3,lr as a4,dr as a5,_a as a6,ba as a7,sa as a8,Ue as a9,St as aA,Ve as aB,Ze as aC,Ge as aD,la as aE,Je as aF,Ye as aG,Yt as aa,sr as ab,ar as ac,rr as ad,ca as ae,er as af,Y as ag,pa as ah,Et as ai,jt as aj,ha as ak,cr as al,_t as am,ot as an,Qe as ao,re as ap,tr as aq,Hr as ar,nr as as,Ke as at,wa as au,Or as av,Zt as aw,Jt as ax,Qt as ay,Nt as az,nt as b,At as c,Ut as d,aa as e,Mt as f,ee as g,te as h,je as i,mt as j,ra as k,Gr as l,We as m,Yr as n,yt as o,Ct as p,Kr as q,ir as r,zr as s,xa as t,Rr as u,oe as v,Qr as w,lt as x,Oe as y,va as z};
