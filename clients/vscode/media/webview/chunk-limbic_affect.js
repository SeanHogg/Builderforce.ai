var ue=Object.defineProperty;var _e=(o,t,r)=>t in o?ue(o,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):o[t]=r;var x=(o,t,r)=>_e(o,typeof t!="symbol"?t+"":t,r);import{a4 as R,j as T,h as E,g as S,f as O,e as M,F as ut,d as Z,aw as Pt,r as it,aq as Ot,Z as he,v as ge,u as ct,a6 as Gt,G as pe,P as me,p as bt,B as fe,E as be,l as we,S as qt,a5 as ve,O as ye,Y as xt,$ as Kt,am as $t,ad as xe,ao as Ae,ac as Mt,a3 as ke,t as Le,al as De,ag as Be}from"./chunk-falcon_mamba.js";const Wt=`

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
`,Yr=`

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
`,kt=`

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
`,Qr=`

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
`,_t=`

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
`,Jr=`

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
`,st=`

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
`,Zr=`
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
`,ta=`
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
`,ea=`

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
`,wt=`
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
`,vt="col_slice";function Q(o,t,r,i,e,n,a,u){const s=R(o,new Uint32Array([e,n,a,u]).buffer),_=T(o,t,[s,r,i]);E(o,t,_,[S(e*u,256),1,1]),s.destroy()}const Pe=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,Me=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class We{constructor(t,r){x(this,"layerType","mamba1");x(this,"device");x(this,"config");x(this,"dInner");x(this,"dtRank");x(this,"wInProj");x(this,"bInProj");x(this,"wConv");x(this,"bConv");x(this,"wXProj");x(this,"bXProj");x(this,"wDtProj");x(this,"bDtProj");x(this,"A_log");x(this,"D_vec");x(this,"wOutProj");x(this,"bOutProj");x(this,"normWeight");x(this,"gpuWeights");x(this,"pipelines");x(this,"_wslaMode",!1);this.device=t,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(r.dModel/16),...r};const{dModel:i,expand:e}=this.config;this.dInner=e*i,this.dtRank=r.dtRank??Math.ceil(i/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,dState:r,dConv:i}=this.config,e=this.dInner,n=r,a=i,u=this.dtRank,s=(c,d=.02)=>ut(c,d),_=c=>new Float32Array(c),l=c=>new Float32Array(c).fill(1);this.wInProj=s(2*e*t),this.bInProj=_(2*e),this.wConv=s(e*a,.01),this.bConv=_(e),this.wXProj=s((u+2*n)*e,.01),this.bXProj=_(u+2*n),this.wDtProj=s(e*u,.02),this.bDtProj=_(e),this.A_log=new Float32Array(e*n);for(let c=0;c<e;c++)for(let d=0;d<n;d++)this.A_log[c*n+d]=Math.log(d+1);this.D_vec=l(e),this.wOutProj=s(t*e,.02),this.bOutProj=_(t),this.normWeight=l(t),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const t=this.device,r=i=>Z(t,i,!0);this.gpuWeights={wInProj:r(this.wInProj),bInProj:r(this.bInProj),wConv:r(this.wConv),bConv:r(this.bConv),wXProj:r(this.wXProj),bXProj:r(this.bXProj),wDtProj:r(this.wDtProj),bDtProj:r(this.bDtProj),A_log:r(this.A_log),D_vec:r(this.D_vec),wOutProj:r(this.wOutProj),bOutProj:r(this.bOutProj),normWeight:r(this.normWeight)}}_buildPipelines(){const t=this.device;this.pipelines={linear:O(t,_t,"linear_forward"),conv1d:O(t,kt,"conv1d_forward"),silu:O(t,st,"silu_forward"),rmsnorm:O(t,st,"rmsnorm_forward"),scan_fwd:O(t,Wt,"forward_scan"),scan_reduce:O(t,Wt,"forward_reduce"),colSlice:O(t,wt,vt),elMul:O(t,Pe,"main"),elAdd:O(t,Me,"main")}}forward(t,r,i){const e=this.device,{dModel:n,dState:a,dConv:u}=this.config,s=this.dInner,_=a,l=r,c=i,d=l*c,m=this.dtRank,g={},h=M(e,d*n*4,!0),p=M(e,d*4,!0);g.normInv=p,g.normIn=t;{const f=new ArrayBuffer(16);new Uint32Array(f,0,2).set([d,n]),new Float32Array(f,8,1).set([1e-6]);const A=R(e,f),P=T(e,this.pipelines.rmsnorm,[A,t,this.gpuWeights.normWeight,h,p]);E(e,this.pipelines.rmsnorm,P,[S(d,64),1,1])}const w=M(e,d*2*s*4,!0);g.normOut=h;{const f=new Uint32Array([d,n,2*s]).buffer,A=R(e,f),P=T(e,this.pipelines.linear,[A,h,this.gpuWeights.wInProj,this.gpuWeights.bInProj,w]);E(e,this.pipelines.linear,P,[S(d,16),S(2*s,16),1])}const v=M(e,d*s*4,!0),b=M(e,d*s*4,!0);{const f=this.pipelines.colSlice;Q(e,f,w,v,d,2*s,0,s),Q(e,f,w,b,d,2*s,s,s)}w.destroy(),g.zBuf=b,g.xConvIn=v;const y=M(e,d*s*4,!0);g.convOut=y;{const f=new Uint32Array([c,s,u,l,1]).buffer,A=R(e,f),P=T(e,this.pipelines.conv1d,[A,v,this.gpuWeights.wConv,this.gpuWeights.bConv,y]);E(e,this.pipelines.conv1d,P,[S(c,16),S(s,16),l])}const B=M(e,d*s*4,!0);g.siluOut=B;{const f=new Uint32Array([d*s]).buffer,A=R(e,f),P=T(e,this.pipelines.silu,[A,y,B]);E(e,this.pipelines.silu,P,[S(d*s,256),1,1])}const D=M(e,d*(m+2*_)*4,!0);{const f=new Uint32Array([d,s,m+2*_]).buffer,A=R(e,f),P=T(e,this.pipelines.linear,[A,B,this.gpuWeights.wXProj,this.gpuWeights.bXProj,D]);E(e,this.pipelines.linear,P,[S(d,16),S(m+2*_,16),1])}const I=M(e,d*m*4,!0),L=M(e,l*c*_*4,!0),N=M(e,l*c*_*4,!0);{const f=m+2*_,A=this.pipelines.colSlice;Q(e,A,D,I,d,f,0,m),Q(e,A,D,L,d,f,m,_),Q(e,A,D,N,d,f,m+_,_)}D.destroy(),g.B_raw=L,g.C_raw=N;const C=M(e,d*s*4,!0);g.deltaFull=C;{const f=new Uint32Array([d,m,s]).buffer,A=R(e,f),P=T(e,this.pipelines.linear,[A,I,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,C]);E(e,this.pipelines.linear,P,[S(d,16),S(s,16),1])}I.destroy();const G=M(e,l*c*s*4,!0),q=M(e,2*l*c*s*_*4,!0);g.hCache=q;{const f=new Uint32Array([c,_,s,l]).buffer,A=R(e,f),P=T(e,this.pipelines.scan_fwd,[A,B,C,this.gpuWeights.A_log,L,N,this.gpuWeights.D_vec,G,q]);E(e,this.pipelines.scan_fwd,P,[s,_,l]);const H=T(e,this.pipelines.scan_reduce,[A,B,C,this.gpuWeights.A_log,L,N,this.gpuWeights.D_vec,G,q]);E(e,this.pipelines.scan_reduce,H,[S(c,64),s,l])}const $=M(e,d*s*4,!0),z=M(e,d*s*4,!0);{const f=R(e,new Uint32Array([d*s]).buffer),A=T(e,this.pipelines.silu,[f,b,$]);E(e,this.pipelines.silu,A,[S(d*s,256),1,1]);const P=R(e,new Uint32Array([d*s]).buffer),H=T(e,this.pipelines.elMul,[G,$,z,P]);E(e,this.pipelines.elMul,H,[S(d*s,256),1,1])}$.destroy(),G.destroy();const K=M(e,d*n*4,!0);{const f=new Uint32Array([d,s,n]).buffer,A=R(e,f),P=T(e,this.pipelines.linear,[A,z,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,K]);E(e,this.pipelines.linear,P,[S(d,16),S(n,16),1])}z.destroy();const k=M(e,d*n*4,!0);{const f=R(e,new Uint32Array([d*n]).buffer),A=T(e,this.pipelines.elAdd,[K,t,k,f]);E(e,this.pipelines.elAdd,A,[S(d*n,256),1,1])}return K.destroy(),{output:k,cache:g}}parameters(){const{dModel:t,dState:r,dConv:i}=this.config,e=this.dInner,n=r,a=i,u=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*e*t,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*e,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:e*a,name:"wConv"},{buf:this.gpuWeights.bConv,numel:e,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(u+2*n)*e,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:u+2*n,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:e*u,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:e,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:e*n,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:e,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:t*e,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:t,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:t,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(t){this._wslaMode=t}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const Ne=`
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
`,ra=`
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
`;class Ce{constructor(t,r){x(this,"layerType","mamba2");x(this,"device");x(this,"config");x(this,"dInner");x(this,"dHead");x(this,"gpuWeights");x(this,"pipelines");x(this,"_wslaMode",!1);this.device=t,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...r};const{dModel:i,expand:e,nHeads:n}=this.config;if(this.dInner=e*i,this.dHead=this.dInner/n,this.dInner%n!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${n}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,dState:r,dConv:i,nHeads:e,nGroups:n}=this.config,a=this.dInner,u=r,s=i,_=e,l=n,c=(p,w=.02)=>ut(p,w),d=p=>new Float32Array(p),m=p=>new Float32Array(p).fill(1),g=a+2*l*u+_,h=p=>Z(this.device,p,!0);this.gpuWeights={wInProj:h(c(g*t)),wConv:h(c((a+2*l*u)*s,.01)),bConv:h(d(a+2*l*u)),A_log:h(new Float32Array(_).fill(Math.log(1))),dt_bias:h(d(_)),D_vec:h(m(_)),wOutProj:h(c(t*a,.02)),normWeight:h(m(a)),preNormWeight:h(m(t))}}_buildPipelines(){const t=this.device;this.pipelines={linear:O(t,_t,"linear_forward"),conv1d:O(t,kt,"conv1d_forward"),colSlice:O(t,wt,vt),rmsnorm:O(t,st,"rmsnorm_forward"),ssd_fwd:O(t,Ne,"ssd_chunk_forward"),elAdd:O(t,Se,"main")}}forward(t,r,i){const e=this.device,{dModel:n,dState:a,dConv:u,nHeads:s,nGroups:_,chunkLen:l}=this.config,c=this.dInner,d=a,m=u,g=s,h=_,p=this.dHead,w=r,v=i,b=w*v,y=c+2*h*d,B=Math.ceil(v/l),D=M(e,b*n*4,!0),I=M(e,b*4,!0);{const F=new ArrayBuffer(16);new Uint32Array(F,0,2).set([b,n]),new Float32Array(F,8,1).set([1e-6]);const W=R(e,F),U=T(e,this.pipelines.rmsnorm,[W,t,this.gpuWeights.preNormWeight,D,I]);E(e,this.pipelines.rmsnorm,U,[S(b,64),1,1])}I.destroy();const L=c+2*h*d+g,N=M(e,b*L*4,!0);{const F=new Uint32Array([b,n,L]).buffer,W=R(e,F),U=Z(e,new Float32Array(L),!0),tt=T(e,this.pipelines.linear,[W,D,this.gpuWeights.wInProj,U,N]);E(e,this.pipelines.linear,tt,[S(b,16),S(L,16),1]),U.destroy()}D.destroy();const C=M(e,b*y*4,!0),G=M(e,b*g*4,!0);{const F=this.pipelines.colSlice,W=y+g;Q(e,F,N,C,b,W,0,y),Q(e,F,N,G,b,W,y,g)}N.destroy();const q=M(e,b*y*4,!0);{const F=new Uint32Array([v,y,m,w,1]).buffer,W=R(e,F),U=T(e,this.pipelines.conv1d,[W,C,this.gpuWeights.wConv,this.gpuWeights.bConv,q]);E(e,this.pipelines.conv1d,U,[S(v,16),S(y,16),w])}C.destroy();const $=M(e,b*c*4,!0),z=M(e,b*h*d*4,!0),K=M(e,b*h*d*4,!0);{const F=this.pipelines.colSlice;Q(e,F,q,$,b,y,0,c),Q(e,F,q,z,b,y,c,h*d),Q(e,F,q,K,b,y,c+h*d,h*d)}q.destroy();const k=M(e,(B+1)*w*g*d*p*4,!0),f=M(e,b*c*4,!0);{const F=new Uint32Array([v,c,g,p,h,d,l,B,w]).buffer,W=R(e,F),U=T(e,this.pipelines.ssd_fwd,[W,$,z,K,G,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,f,k]);E(e,this.pipelines.ssd_fwd,U,[B,g,w])}$.destroy(),z.destroy(),K.destroy(),G.destroy();const A=M(e,b*c*4,!0),P=M(e,b*4,!0);{const F=new ArrayBuffer(16);new Uint32Array(F,0,2).set([b,c]),new Float32Array(F,8,1).set([1e-6]);const W=R(e,F),U=T(e,this.pipelines.rmsnorm,[W,f,this.gpuWeights.normWeight,A,P]);E(e,this.pipelines.rmsnorm,U,[S(b,64),1,1])}f.destroy(),P.destroy();const H=M(e,b*n*4,!0);{const F=new Uint32Array([b,c,n]).buffer,W=R(e,F),U=Z(e,new Float32Array(n),!0),tt=T(e,this.pipelines.linear,[W,A,this.gpuWeights.wOutProj,U,H]);E(e,this.pipelines.linear,tt,[S(b,16),S(n,16),1]),U.destroy()}A.destroy();const X=M(e,b*n*4,!0);{const F=R(e,new Uint32Array([b*n]).buffer),W=T(e,this.pipelines.elAdd,[H,t,X,F]);E(e,this.pipelines.elAdd,W,[S(b*n,256),1,1])}return H.destroy(),{output:X,cache:{stateCarry:k}}}parameters(){const{dModel:t,dState:r,dConv:i,nHeads:e,nGroups:n}=this.config,a=this.dInner,u=r,s=i,_=e,l=n,c=a+2*l*u;return[{buf:this.gpuWeights.wInProj,numel:(a+2*l*u+_)*t,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:c*s,name:"wConv"},{buf:this.gpuWeights.bConv,numel:c,name:"bConv"},{buf:this.gpuWeights.A_log,numel:_,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:_,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:_,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:t*a,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:a,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:t,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(t){this._wslaMode=t}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const Fe=`
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
`,aa=`
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
`;class je{constructor(t,r){x(this,"layerType","mamba3");x(this,"device");x(this,"config");x(this,"dInner");x(this,"dHead");x(this,"nComplex");x(this,"gpuWeights");x(this,"pipelines");x(this,"_wslaMode",!1);this.device=t,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...r};const{dModel:i,expand:e,nHeads:n}=this.config;if(this.dInner=e*i,this.dHead=this.dInner/n,this.nComplex=this.config.dState,this.dInner%n!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${n}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,dConv:r,nHeads:i,nGroups:e}=this.config,n=this.dInner,a=this.nComplex,u=r,s=i,_=e,l=n+2*_*a*2,c=(w,v=.02)=>ut(w,v),d=w=>new Float32Array(w),m=w=>new Float32Array(w).fill(1),g=new Float32Array(s*2);for(let w=0;w<s;w++)g[w*2+0]=0,g[w*2+1]=2*Math.PI*w/s;const h=w=>Z(this.device,w,!0),p=n+2*_*a*2+s;this.gpuWeights={wInProj:h(c(p*t)),wConv:h(c(l*u,.01)),bConv:h(d(l)),A_log:h(g),dt_bias:h(d(s)),D_vec:h(m(s)),wOutProj:h(c(t*n,.02)),normWeight:h(m(n)),preNormWeight:h(m(t))}}_buildPipelines(){const t=this.device;this.pipelines={linear:O(t,_t,"linear_forward"),conv1d:O(t,kt,"conv1d_forward"),colSlice:O(t,wt,vt),rmsnorm:O(t,st,"rmsnorm_forward"),cssd_fwd:O(t,Fe,"complex_ssd_forward"),elAdd:O(t,Ie,"main")}}forward(t,r,i){const e=this.device,{dModel:n,dConv:a,nHeads:u,nGroups:s,chunkLen:_}=this.config,l=this.dInner,c=this.nComplex,d=a,m=u,g=s,h=this.dHead,p=r,w=i,v=p*w,b=l+2*g*c*2,y=Math.ceil(w/_),B=M(e,v*n*4,!0),D=M(e,v*4,!0);{const j=new ArrayBuffer(16);new Uint32Array(j,0,2).set([v,n]),new Float32Array(j,8,1).set([1e-6]);const F=R(e,j),W=T(e,this.pipelines.rmsnorm,[F,t,this.gpuWeights.preNormWeight,B,D]);E(e,this.pipelines.rmsnorm,W,[S(v,64),1,1])}D.destroy();const I=l+2*g*c*2+m,L=M(e,v*I*4,!0);{const j=new Uint32Array([v,n,I]).buffer,F=R(e,j),W=Z(e,new Float32Array(I),!0),U=T(e,this.pipelines.linear,[F,B,this.gpuWeights.wInProj,W,L]);E(e,this.pipelines.linear,U,[S(v,16),S(I,16),1]),W.destroy()}B.destroy();const N=M(e,v*b*4,!0),C=M(e,v*m*4,!0);{const j=this.pipelines.colSlice,F=b+m;Q(e,j,L,N,v,F,0,b),Q(e,j,L,C,v,F,b,m)}L.destroy();const G=M(e,v*b*4,!0);{const j=new Uint32Array([w,b,d,p,1]).buffer,F=R(e,j),W=T(e,this.pipelines.conv1d,[F,N,this.gpuWeights.wConv,this.gpuWeights.bConv,G]);E(e,this.pipelines.conv1d,W,[S(w,16),S(b,16),p])}N.destroy();const q=M(e,v*l*4,!0),$=M(e,v*g*c*2*4,!0),z=M(e,v*g*c*2*4,!0);{const j=this.pipelines.colSlice;Q(e,j,G,q,v,b,0,l),Q(e,j,G,$,v,b,l,g*c*2),Q(e,j,G,z,v,b,l+g*c*2,g*c*2)}G.destroy();const K=M(e,(y+1)*p*m*c*2*h*4,!0),k=M(e,v*l*4,!0);{const j=new Uint32Array([w,l,m,h,g,c,_,y,p]).buffer,F=R(e,j),W=T(e,this.pipelines.cssd_fwd,[F,q,$,z,C,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,k,K]);E(e,this.pipelines.cssd_fwd,W,[y,m,p])}q.destroy(),$.destroy(),z.destroy(),C.destroy();const f=M(e,v*l*4,!0),A=M(e,v*4,!0);{const j=new ArrayBuffer(16);new Uint32Array(j,0,2).set([v,l]),new Float32Array(j,8,1).set([1e-6]);const F=R(e,j),W=T(e,this.pipelines.rmsnorm,[F,k,this.gpuWeights.normWeight,f,A]);E(e,this.pipelines.rmsnorm,W,[S(v,64),1,1])}k.destroy(),A.destroy();const P=M(e,v*n*4,!0);{const j=new Uint32Array([v,l,n]).buffer,F=R(e,j),W=Z(e,new Float32Array(n),!0),U=T(e,this.pipelines.linear,[F,f,this.gpuWeights.wOutProj,W,P]);E(e,this.pipelines.linear,U,[S(v,16),S(n,16),1]),W.destroy()}f.destroy();const H=M(e,v*n*4,!0);{const j=R(e,new Uint32Array([v*n]).buffer),F=T(e,this.pipelines.elAdd,[P,t,H,j]);E(e,this.pipelines.elAdd,F,[S(v*n,256),1,1])}return P.destroy(),{output:H,cache:{stateCarry:K}}}parameters(){const{dModel:t,dConv:r,nHeads:i,nGroups:e}=this.config,n=this.dInner,a=this.nComplex,u=r,s=i,_=e,l=n+2*_*a*2;return[{buf:this.gpuWeights.wInProj,numel:(n+2*_*a*2+s)*t,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:l*u,name:"wConv"},{buf:this.gpuWeights.bConv,numel:l,name:"bConv"},{buf:this.gpuWeights.A_log,numel:s*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:s,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:s,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:t*n,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:n,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:t,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(t){this._wslaMode=t}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const Te=`
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
`,Nt=`
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
`,na=`
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
`,Ee=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,Re=`
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
`;class He{constructor(t,r){x(this,"layerType","attention");x(this,"device");x(this,"config");x(this,"dHead");x(this,"gpuWeights");x(this,"pipelines");if(this.device=t,r.dModel%r.nHeads!==0)throw new Error(`AttentionBlock: dModel (${r.dModel}) must be divisible by nHeads (${r.nHeads}).`);this.config={dHead:r.dModel/r.nHeads,hasFfn:!1,ffnMult:4,...r},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:t,hasFfn:r,ffnMult:i}=this.config,e=(s,_=.02)=>ut(s,_),n=s=>new Float32Array(s),a=s=>new Float32Array(s).fill(1),u=s=>Z(this.device,s,!0);if(this.gpuWeights={wQKV:u(e(3*t*t)),bQKV:u(n(3*t)),wO:u(e(t*t)),bO:u(n(t)),normWeight:u(a(t))},r){const s=t*i;this.gpuWeights.wFfn1=u(e(s*t)),this.gpuWeights.bFfn1=u(n(s)),this.gpuWeights.wFfn2=u(e(t*s)),this.gpuWeights.bFfn2=u(n(t))}}_buildPipelines(){const t=this.device;this.pipelines={linear:O(t,_t,"linear_forward"),rmsnorm:O(t,st,"rmsnorm_forward"),attn_fwd:O(t,Nt,"attention_forward"),attn_val:O(t,Nt,"attention_value"),softmax:O(t,Te,"softmax_forward"),colSlice:O(t,wt,vt),elAdd:O(t,Ee,"main")},this.config.hasFfn&&(this.pipelines.silu=O(t,Re,"silu_forward"))}forward(t,r,i){const e=this.device,{dModel:n,nHeads:a,hasFfn:u}=this.config,s=this.dHead,_=r,l=i,c=_*l,d=a,m=M(e,c*n*4,!0),g=M(e,c*4,!0);{const L=new ArrayBuffer(16);new Uint32Array(L,0,2).set([c,n]),new Float32Array(L,8,1).set([1e-6]);const N=R(e,L),C=T(e,this.pipelines.rmsnorm,[N,t,this.gpuWeights.normWeight,m,g]);E(e,this.pipelines.rmsnorm,C,[S(c,64),1,1])}g.destroy();const h=M(e,c*3*n*4,!0);{const L=new Uint32Array([c,n,3*n]).buffer,N=R(e,L),C=T(e,this.pipelines.linear,[N,m,this.gpuWeights.wQKV,this.gpuWeights.bQKV,h]);E(e,this.pipelines.linear,C,[S(c,16),S(3*n,16),1])}m.destroy();const p=M(e,c*n*4,!0),w=M(e,c*n*4,!0),v=M(e,c*n*4,!0);{const L=this.pipelines.colSlice;Q(e,L,h,p,c,3*n,0,n),Q(e,L,h,w,c,3*n,n,n),Q(e,L,h,v,c,3*n,2*n,n)}h.destroy();const b=M(e,_*d*l*l*4,!0);{const L=new Uint32Array([_,l,n,d,s]).buffer,N=R(e,L),C=T(e,this.pipelines.attn_fwd,[N,p,w,v,b,M(e,c*n*4,!0)]);E(e,this.pipelines.attn_fwd,C,[S(l,16),d,_])}{const L=new Uint32Array([l,l,1]).buffer,N=R(e,L),C=T(e,this.pipelines.softmax,[N,b]);E(e,this.pipelines.softmax,C,[l,d,_])}const y=M(e,c*n*4,!0);{const L=new Uint32Array([_,l,n,d,s]).buffer,N=R(e,L),C=T(e,this.pipelines.attn_val,[N,p,w,v,b,y]);E(e,this.pipelines.attn_val,C,[S(l,16),d,_])}p.destroy(),w.destroy(),v.destroy();const B=M(e,c*n*4,!0);{const L=new Uint32Array([c,n,n]).buffer,N=R(e,L),C=T(e,this.pipelines.linear,[N,y,this.gpuWeights.wO,this.gpuWeights.bO,B]);E(e,this.pipelines.linear,C,[S(c,16),S(n,16),1])}y.destroy();let D=M(e,c*n*4,!0);{const L=R(e,new Uint32Array([c*n]).buffer),N=T(e,this.pipelines.elAdd,[B,t,D,L]);E(e,this.pipelines.elAdd,N,[S(c*n,256),1,1])}if(B.destroy(),u){const{ffnMult:L}=this.config,N=n*L,C=M(e,c*N*4,!0);{const z=new Uint32Array([c,n,N]).buffer,K=R(e,z),k=T(e,this.pipelines.linear,[K,D,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,C]);E(e,this.pipelines.linear,k,[S(c,16),S(N,16),1])}const G=M(e,c*N*4,!0);{const z=R(e,new Uint32Array([c*N]).buffer),K=T(e,this.pipelines.silu,[z,C,G]);E(e,this.pipelines.silu,K,[S(c*N,256),1,1])}C.destroy();const q=M(e,c*n*4,!0);{const z=new Uint32Array([c,N,n]).buffer,K=R(e,z),k=T(e,this.pipelines.linear,[K,G,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,q]);E(e,this.pipelines.linear,k,[S(c,16),S(n,16),1])}G.destroy();const $=M(e,c*n*4,!0);{const z=R(e,new Uint32Array([c*n]).buffer),K=T(e,this.pipelines.elAdd,[q,D,$,z]);E(e,this.pipelines.elAdd,K,[S(c*n,256),1,1])}q.destroy(),D.destroy(),D=$}return{output:D,cache:{scores:b}}}parameters(){const{dModel:t,hasFfn:r,ffnMult:i}=this.config,e=[{buf:this.gpuWeights.wQKV,numel:3*t*t,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*t,name:"bQKV"},{buf:this.gpuWeights.wO,numel:t*t,name:"wO"},{buf:this.gpuWeights.bO,numel:t,name:"bO"},{buf:this.gpuWeights.normWeight,numel:t,name:"normWeight"}];if(r){const n=t*i;e.push({buf:this.gpuWeights.wFfn1,numel:n*t,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:n,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:t*n,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:t,name:"bFfn2"})}return e}getTrainableParams(){return this.parameters()}setWSLAMode(t){}destroy(){for(const t of Object.values(this.gpuWeights))t.destroy();this.gpuWeights={}}}const St=1296190035,ze={mamba1:0,mamba2:1,mamba3:2,attention:3},Oe=["mamba1","mamba2","mamba3","attention"];class Ge{constructor(t,r){x(this,"device");x(this,"config");x(this,"gpuEmbedding");x(this,"layers");x(this,"layerSpecs");x(this,"gpuFinalNorm");x(this,"tiedEmbedding");x(this,"gpuLMHeadBias");x(this,"_lmHeadPipeline");x(this,"_rmsnormPipeline");x(this,"_embedPipeline");x(this,"_wslaMode",!1);this.device=t,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...r},Pt(this.config.seed);const i=r.layers??Array.from({length:r.numLayers},()=>({type:"mamba1"}));if(i.length!==r.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${i.length}) must equal numLayers (${r.numLayers}).`);this.layerSpecs=i;const{vocabSize:e,dModel:n}=this.config,a=ut(e*n,1/Math.sqrt(n));this.gpuEmbedding=Z(t,a,!0),this.layers=i.map(u=>this._buildLayer(u)),Pt(void 0),this.gpuFinalNorm=Z(t,new Float32Array(n).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=Z(t,new Float32Array(e),!0),this._lmHeadPipeline=O(t,_t,"linear_forward"),this._rmsnormPipeline=O(t,st,"rmsnorm_forward"),this._embedPipeline=O(t,qe,"embed_lookup")}_buildLayer(t){const r=this.config;switch(t.type){case"mamba1":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,...r.defaultMamba1};return new We(this.device,{...i,...t.config??{}})}case"mamba2":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,nHeads:r.nHeads,nGroups:r.nGroups,chunkLen:r.chunkLen,...r.defaultMamba2};return new Ce(this.device,{...i,...t.config??{}})}case"mamba3":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,nHeads:r.nHeads,nGroups:r.nGroups,chunkLen:r.chunkLen,mimoGroup:r.mimoGroup,...r.defaultMamba3};return new je(this.device,{...i,...t.config??{}})}case"attention":{const i={dModel:r.dModel,nHeads:r.nHeads,...r.defaultAttention};return new He(this.device,{...i,...t.config??{}})}}}embedTokens(t,r,i){const{dModel:e}=this.config,n=r*i,a=Z(this.device,t instanceof Uint32Array?t:new Uint32Array(t),!1),u=M(this.device,n*e*4,!0),s=R(this.device,new Uint32Array([n,e]).buffer),_=T(this.device,this._embedPipeline,[s,a,this.gpuEmbedding,u]);return E(this.device,this._embedPipeline,_,[S(n,64),1,1]),a.destroy(),s.destroy(),u}async forward(t,r,i){const{dModel:e,vocabSize:n}=this.config,a=r*i;let u=this.embedTokens(t,r,i);const s=[];for(const m of this.layers){const{output:g,cache:h}=m.forward(u,r,i);s.push(h),u.destroy(),u=g}const _=M(this.device,a*e*4,!0),l=M(this.device,a*4,!1);{const m=new ArrayBuffer(16);new Uint32Array(m,0,2).set([a,e]),new Float32Array(m,8,1).set([1e-6]);const g=R(this.device,m),h=T(this.device,this._rmsnormPipeline,[g,u,this.gpuFinalNorm,_,l]);E(this.device,this._rmsnormPipeline,h,[S(a,64),1,1])}u.destroy();const c=M(this.device,a*n*4,!0);{const m=new Uint32Array([a,e,n]).buffer,g=R(this.device,m),h=T(this.device,this._lmHeadPipeline,[g,_,this.gpuEmbedding,this.gpuLMHeadBias,c]);E(this.device,this._lmHeadPipeline,h,[S(a,16),S(n,16),1])}return _.destroy(),l.destroy(),{logits:await it(this.device,c,a*n*4),gpuLogits:c,caches:s}}async embed(t){const{dModel:r}=this.config,i=t.length,e=1,n=e*i;if(n===0)return new Float32Array(r);let a=this.embedTokens(t,e,i);for(const d of this.layers){const{output:m}=d.forward(a,e,i);a.destroy(),a=m}const u=M(this.device,n*r*4,!0),s=M(this.device,n*4,!1);{const d=new ArrayBuffer(16);new Uint32Array(d,0,2).set([n,r]),new Float32Array(d,8,1).set([1e-6]);const m=R(this.device,d),g=T(this.device,this._rmsnormPipeline,[m,a,this.gpuFinalNorm,u,s]);E(this.device,this._rmsnormPipeline,g,[S(n,64),1,1])}a.destroy();const _=await it(this.device,u,n*r*4);u.destroy(),s.destroy();const l=new Float32Array(r);for(let d=0;d<i;d++){const m=d*r;for(let g=0;g<r;g++)l[g]+=_[m+g]}for(let d=0;d<r;d++)l[d]/=i;let c=0;for(let d=0;d<r;d++)c+=l[d]*l[d];c=Math.sqrt(c)||1;for(let d=0;d<r;d++)l[d]/=c;return l}async generate(t,r=200,i={}){const{temperature:e=1,topK:n=50,topP:a=.9}=i,{vocabSize:u}=this.config,s=[...t];for(let _=0;_<r;_++){const{logits:l}=await this.forward(new Uint32Array(s),1,s.length),c=l.slice((s.length-1)*u,s.length*u),d=Ke(c,{temperature:e,topK:n,topP:a});if(s.push(d),d===this.config.eosId)break}return s}parameters(){const t=[];t.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let r=0;r<this.layers.length;r++)for(const i of this.layers[r].parameters())t.push({...i,name:`layer${r}.${i.name}`});return t.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),t}getTrainableParams(){if(!this._wslaMode)return this.parameters();const t=[];for(let r=0;r<this.layers.length;r++)for(const i of this.layers[r].getTrainableParams())t.push({...i,name:`layer${r}.${i.name}`});return t}setWSLAMode(t){for(const r of this.layers)r.setWSLAMode(t);this._wslaMode=t}async exportWeights(t={}){const r=t.fp16??!1,i=this.parameters(),e=i.length,n=this.layers.length,a=await Promise.all(i.map(h=>it(this.device,h.buf,h.numel*4))),u=Math.ceil(n/4)*4,s=12+u+4+e*4,_=r?2:4,c=a.reduce((h,p)=>h+p.length,0)*_,d=new ArrayBuffer(s+c),m=new DataView(d);let g=0;m.setUint32(g,St,!0),g+=4,m.setUint32(g,r?3:2,!0),g+=4,m.setUint32(g,n,!0),g+=4;for(let h=0;h<n;h++){const p=this.layers[h].layerType;m.setUint8(g+h,ze[p])}g+=u,m.setUint32(g,e,!0),g+=4;for(const h of i)m.setUint32(g,h.numel,!0),g+=4;if(r)for(const h of a){const p=Ot(h);new Uint16Array(d,g,p.length).set(p),g+=p.length*2}else for(const h of a)new Float32Array(d,g,h.length).set(h),g+=h.byteLength;return he(d)}async loadWeights(t){const r=ge(t);if(r.hasTrailer&&!r.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const i=new DataView(t);let e=0;const n=i.getUint32(e,!0);if(e+=4,n!==St)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const a=i.getUint32(e,!0);if(e+=4,a===1){const u=i.getUint32(e,!0);e+=4;const s=this.parameters();if(u!==s.length)throw new Error(`Weight file has ${u} parameters but this model has ${s.length}.`);const _=[];for(let l=0;l<u;l++)_.push(i.getUint32(e,!0)),e+=4;for(let l=0;l<u;l++){const c=s[l],d=_[l];if(d!==c.numel)throw new Error(`Parameter ${l} ("${c.name}") size mismatch: file=${d}, model=${c.numel}.`);ct(this.device,c.buf,new Float32Array(t,e,c.numel)),e+=c.numel*4}return}if(a===2||a===3){const u=a===3,s=i.getUint32(e,!0);if(e+=4,s!==this.layers.length)throw new Error(`Weight file has ${s} layers but this model has ${this.layers.length}.`);for(let m=0;m<s;m++){const g=i.getUint8(e+m),h=this.layers[m].layerType,p=Oe[g]??"mamba1";if(p!==h)throw new Error(`Layer ${m} type mismatch: file="${p}", model="${h}".`)}const _=Math.ceil(s/4)*4;e+=_;const l=i.getUint32(e,!0);e+=4;const c=this.parameters();if(l!==c.length)throw new Error(`Weight file has ${l} parameters but this model has ${c.length}.`);const d=[];for(let m=0;m<l;m++)d.push(i.getUint32(e,!0)),e+=4;for(let m=0;m<l;m++){const g=c[m],h=d[m];if(h!==g.numel)throw new Error(`Parameter ${m} ("${g.name}") size mismatch: file=${h}, model=${g.numel}.`);if(u){const p=new Uint16Array(t,e,h);ct(this.device,g.buf,Gt(p)),e+=h*2}else ct(this.device,g.buf,new Float32Array(t,e,g.numel)),e+=h*4}return}throw new Error(`Unsupported MBJS version: ${a}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const t of this.layers)t.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class ia extends Ge{constructor(t,r){super(t,{...r,layers:Array.from({length:r.numLayers},()=>({type:"mamba1"}))})}}const qe=`
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
`;function Ke(o,{temperature:t=1,topK:r=50,topP:i=.9}={}){const e=o.length,n=new Float32Array(e);for(let p=0;p<e;p++)n[p]=o[p]/Math.max(t,1e-7);let a=-1/0;for(let p=0;p<e;p++)n[p]>a&&(a=n[p]);let u=0;const s=new Float32Array(e);for(let p=0;p<e;p++)s[p]=Math.exp(n[p]-a),u+=s[p];const l=Array.from({length:e},(p,w)=>w).sort((p,w)=>s[w]-s[p]).slice(0,r);let c=0;const d=[];for(const p of l)if(c+=s[p]/u,d.push(p),c>=i)break;let m=0;for(const p of d)m+=s[p];const g=Math.random()*m;let h=0;for(const p of d)if(h+=s[p],h>=g)return p;return d[d.length-1]}class oa{constructor(t,r={}){x(this,"model");x(this,"adam");x(this,"opt");this.model=t,this.opt={lr:r.lr??.01,beta1:r.beta1??.9,beta2:r.beta2??.999,eps:r.eps??1e-8,weightDecay:r.weightDecay??0,auxWeight:r.auxWeight??.01,batchSize:r.batchSize??0,epochs:r.epochs??1},this.adam=new pe(t,this.opt)}fit(t){const r=[];for(let i=0;i<this.opt.epochs;i++)r.push(this.runEpoch(t));return r}runEpoch(t){const r=this.opt.batchSize>0?this.opt.batchSize:t.length,{numExperts:i,modelDim:e}=this.model.config;let n=0,a=0;for(let u=0;u<t.length;u+=r){const s=t.slice(u,u+r);this.model.zeroGrad();const _=[],l=[],c=new me(i);let d=0;for(const h of s){const p=this.model.forward(h.input),w=new Float32Array(e);for(let v=0;v<e;v++){const b=p.output[v]-(h.target[v]??0);w[v]=b,d+=.5*b*b}this.model.backward(w,p.cache),_.push(p.cache.x),l.push(p.route.probs),c.observe(p.route)}const m=c.dispatchFractions(),g=this.opt.auxWeight*i/s.length;for(let h=0;h<_.length;h++)this.model.auxGradStep(_[h],l[h],m,g);this.scaleGradients(1/s.length),this.adam.step(),n+=d,a=c.loss()}return{loss:n/Math.max(1,t.length),auxLoss:a}}scaleGradients(t){if(t!==1)for(const r of this.model.gradients())for(let i=0;i<r.data.length;i++)r.data[i]=r.data[i]*t}}const $e=Math.LN2;function Ue(o,t){const r=o.length,i=Math.max(1,Math.min(t,r)),e=[],n=new Uint8Array(r);for(let a=0;a<i;a++){let u=-1,s=-1/0;for(let _=0;_<r;_++){if(n[_])continue;const l=o[_];l>s&&(s=l,u=_)}if(u<0)break;n[u]=1,e.push(u)}return e}function Xe(o){let t=0,r=-1/0;for(let i=0;i<o.length;i++)o[i]>r&&(r=o[i],t=i);return t}function Ve(o){return Math.exp(o)}function Ye(o){return o/$e}function Ut(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function Xt(o,t,r,i){const e=Math.min(t.length,r.length);for(let n=0;n<e;n++){const a=r[n],u=t[n];a<0||a>=u.length||(o.ceSum+=bt(u,a),Xe(u)===a&&o.top1Hits++,Ue(u,i).includes(a)&&o.topKHits++,o.tokens++)}}function Vt(){var t;const o=globalThis;return typeof((t=o.performance)==null?void 0:t.now)=="function"?o.performance.now():Date.now()}function Yt(o){return o.slice(1)}function Qt(o,t,r,i){const e=o.tokens>0?o.ceSum/o.tokens:0,n={sequences:t,tokens:o.tokens,crossEntropy:e,perplexity:Ve(e),bitsPerToken:Ye(e),top1Accuracy:o.tokens>0?o.top1Hits/o.tokens:0,topKAccuracy:o.tokens>0?o.topKHits/o.tokens:0,topK:r};return i!==void 0&&(n.elapsedMs=i,n.tokensPerSecond=i>0?o.tokens/i*1e3:0),n}function mt(o,t,r={}){const i=r.topK??5,e=r.measureLatency??!0,n=r.now??Vt,a=Ut();let u=0,s=0;for(const _ of t){if(_.length<2)continue;const l=e?n():0,{logits:c}=o.forward(_);e&&(s+=n()-l),Xt(a,c,Yt(_),i),u++}return Qt(a,u,i,e?s:void 0)}async function sa(o,t,r={}){const i=r.topK??5,e=r.measureLatency??!0,n=r.now??Vt,a=Ut();let u=0,s=0;for(const _ of t){if(_.length<2)continue;const l=e?n():0,{logits:c}=await o.forward(_);e&&(s+=n()-l),Xt(a,c,Yt(_),i),u++}return Qt(a,u,i,e?s:void 0)}function da(o,t,r,i={}){return Qe(mt(o,r,i),mt(t,r,i))}function Qe(o,t){const r=o.perplexity-t.perplexity,i=t.perplexity>0?o.perplexity/t.perplexity:1/0,e=o.top1Accuracy-t.top1Accuracy,n=.005;let a;Math.abs(i-1)<=n?a="tie":a=r<0?"candidate":"baseline";const u=((1-i)*100).toFixed(1),s=a==="tie"?`Tie: perplexity ${o.perplexity.toFixed(2)} vs ${t.perplexity.toFixed(2)}`:a==="candidate"?`Candidate wins: ${u}% lower perplexity (${o.perplexity.toFixed(2)} vs ${t.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(u)).toFixed(1)}% higher perplexity (${o.perplexity.toFixed(2)} vs ${t.perplexity.toFixed(2)})`;return{candidate:o,baseline:t,perplexityDelta:r,perplexityRatio:i,top1Delta:e,winner:a,summary:s}}function Jt(o,t){return o.split(new RegExp("(?<=\\.)\\s+")).map(r=>t.encode(r.trim())).filter(r=>r.length>=2)}function la(o,t,r,i={}){return mt(o,Jt(r,t),i)}function Je(o,t){for(let r=o.length-1;r>0;r--){const i=Math.floor(t.next()*(r+1)),e=o[r];o[r]=o[i],o[i]=e}return o}function ca(o,t={}){const r=t.seed??7,i=new fe;i.train(o,{numMerges:t.numMerges??100});const e=Jt(o,i);if(e.length<2)throw new Error(`corpus produced ${e.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const n=Je([...e],new qt(r>>>0||1)),a=Math.min(.9,Math.max(.05,t.heldOutRatio??.25));let u=Math.round(n.length*a);u=Math.max(1,Math.min(n.length-1,u));const s=n.slice(0,u),_=n.slice(u),l=new be({vocabSize:i.vocabSize,dModel:t.dModel??32,numLayers:t.numLayers??2,hiddenDim:t.hiddenDim??48,seed:r}),c=t.epochs??30,d=new we(l,{lr:t.lr??.03,epochs:c}).fit(_),m=mt(l,s,{topK:t.topK??5,measureLatency:!0}),g=l.generateText(t.prompt??"The",i,{maxNewTokens:8,temperature:0});return{...m,trainSequences:_.length,evalSequences:s.length,initialTrainLoss:d[0]??0,finalTrainLoss:d.at(-1)??0,vocabSize:i.vocabSize,sample:g}}const ht=1e-6;function Zt(o){return 1/(1+Math.exp(-o))}function Ct(o){return o/(1+Math.exp(-o))}function Ft(o){const t=Zt(o);return t*(1+o*(1-t))}function Ze(o){return Math.max(o,0)+Math.log1p(Math.exp(-Math.abs(o)))}function lt(o,t,r,i,e,n,a){for(let u=0;u<i;u++){const s=u*e,_=u*n;for(let l=0;l<n;l++){let c=r[l];const d=l*e;for(let m=0;m<e;m++)c+=o[s+m]*t[d+m];a[_+l]=c}}}function pt(o,t,r,i,e,n,a,u,s){a.fill(0);for(let _=0;_<i;_++){const l=_*e,c=_*n;for(let d=0;d<n;d++){const m=o[c+d];if(m===0)continue;s[d]=s[d]+m;const g=d*e;for(let h=0;h<e;h++)a[l+h]=a[l+h]+m*r[g+h],u[g+h]=u[g+h]+m*t[l+h]}}}function te(o,t,r,i,e,n,a=ht){for(let u=0;u<r;u++){const s=u*i;let _=0;for(let c=0;c<i;c++){const d=o[s+c];_+=d*d}const l=1/Math.sqrt(_/i+a);n[u]=l;for(let c=0;c<i;c++)e[s+c]=o[s+c]*l*t[c]}}function ee(o,t,r,i,e,n,a,u,s=ht){for(let _=0;_<e;_++){const l=_*n,c=i[_];let d=0;for(let g=0;g<n;g++){const h=o[l+g]*r[g];d+=h*t[l+g],u[g]=u[g]+o[l+g]*t[l+g]*c}const m=c*c*c/n;for(let g=0;g<n;g++){const h=o[l+g]*r[g];a[l+g]=a[l+g]+h*c-m*d*t[l+g]}}}const Lt=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],re=-10,ae=5;function tr(o){const{dModel:t,dState:r,dConv:i,dInner:e,dtRank:n}=o;return{wInProj:new Float32Array(2*e*t),bInProj:new Float32Array(2*e),wConv:new Float32Array(e*i),bConv:new Float32Array(e),wXProj:new Float32Array((n+2*r)*e),bXProj:new Float32Array(n+2*r),wDtProj:new Float32Array(e*n),bDtProj:new Float32Array(e),A_log:new Float32Array(e*r),D_vec:new Float32Array(e),wOutProj:new Float32Array(t*e),bOutProj:new Float32Array(t),normWeight:new Float32Array(t)}}function ne(o,t,r){const{dModel:i,dState:e,dConv:n,dInner:a,dtRank:u,batch:s,seqLen:_}=r,l=s*_,c=u+2*e,d=new Float32Array(l*i),m=new Float32Array(l);te(o,t.normWeight,l,i,d,m);const g=new Float32Array(l*2*a);lt(d,t.wInProj,t.bInProj,l,i,2*a,g);const h=new Float32Array(l*a),p=new Float32Array(l*a);for(let f=0;f<l;f++)for(let A=0;A<a;A++)h[f*a+A]=g[f*2*a+A],p[f*a+A]=g[f*2*a+a+A];const w=new Float32Array(l*a);for(let f=0;f<s;f++)for(let A=0;A<_;A++){const P=(f*_+A)*a;for(let H=0;H<a;H++){let X=t.bConv[H];for(let j=0;j<n;j++)A>=j&&(X+=t.wConv[H*n+j]*h[(f*_+A-j)*a+H]);w[P+H]=X}}const v=new Float32Array(l*a);for(let f=0;f<l*a;f++)v[f]=Ct(w[f]);const b=new Float32Array(l*c);lt(v,t.wXProj,t.bXProj,l,a,c,b);const y=new Float32Array(l*u),B=new Float32Array(l*e),D=new Float32Array(l*e);for(let f=0;f<l;f++){for(let A=0;A<u;A++)y[f*u+A]=b[f*c+A];for(let A=0;A<e;A++)B[f*e+A]=b[f*c+u+A],D[f*e+A]=b[f*c+u+e+A]}const I=new Float32Array(l*a);lt(y,t.wDtProj,t.bDtProj,l,u,a,I);const L=new Float32Array(l*a);for(let f=0;f<l*a;f++)L[f]=Ze(I[f]);const N=new Float32Array(a*e);for(let f=0;f<a*e;f++)N[f]=-Math.exp(Math.min(ae,Math.max(re,t.A_log[f])));const C=new Float32Array(l*a*e),G=new Float32Array(l*a*e),q=new Float32Array(l*a*e),$=new Float32Array(l*a);for(let f=0;f<s;f++)for(let A=0;A<_;A++){const P=f*_+A;for(let H=0;H<a;H++){const X=L[P*a+H],j=v[P*a+H];let F=t.D_vec[H]*j;for(let W=0;W<e;W++){const U=N[H*e+W],tt=Math.exp(X*U),V=(tt-1)/U*B[P*e+W],Y=(P*a+H)*e+W;C[Y]=tt,G[Y]=V;const at=A===0?0:q[((P-1)*a+H)*e+W],ot=tt*at+V*j;q[Y]=ot,F+=D[P*e+W]*ot}$[P*a+H]=F}}const z=new Float32Array(l*a),K=new Float32Array(l*a);for(let f=0;f<l*a;f++)z[f]=Ct(p[f]),K[f]=$[f]*z[f];const k=new Float32Array(l*i);lt(K,t.wOutProj,t.bOutProj,l,a,i,k);for(let f=0;f<l*i;f++)k[f]=k[f]+o[f];return{output:k,cache:{x:o,normInv:m,normOut:d,xConvIn:h,z:p,convOut:w,u:v,dtRaw:y,bRaw:B,cRaw:D,deltaFull:I,dv:L,aCont:N,aBar:C,bBar:G,h:q,scanY:$,siluZ:z,gated:K}}}function er(o,t,r,i,e){const{dModel:n,dState:a,dConv:u,dInner:s,dtRank:_,batch:l,seqLen:c}=i,d=l*c,m=_+2*a,g=new Float32Array(d*n);g.set(o);const h=new Float32Array(d*s);pt(o,r.gated,t.wOutProj,d,s,n,h,e.wOutProj,e.bOutProj);const p=new Float32Array(d*s),w=new Float32Array(d*s);for(let k=0;k<d*s;k++)p[k]=h[k]*r.siluZ[k],w[k]=h[k]*r.scanY[k]*Ft(r.z[k]);const v=new Float32Array(d*s),b=new Float32Array(d*a),y=new Float32Array(d*a),B=new Float32Array(d*s),D=new Float32Array(s*a),I=new Float32Array(s*a);for(let k=0;k<l;k++){I.fill(0);for(let f=c-1;f>=0;f--){const A=k*c+f;for(let P=0;P<s;P++){const H=p[A*s+P],X=r.u[A*s+P],j=r.dv[A*s+P];e.D_vec[P]=e.D_vec[P]+H*X,v[A*s+P]=v[A*s+P]+H*t.D_vec[P];let F=0;for(let W=0;W<a;W++){const U=(A*s+P)*a+W,tt=r.h[U],V=r.aBar[U],Y=r.bBar[U],at=r.aCont[P*a+W],ot=r.cRaw[A*a+W];y[A*a+W]=y[A*a+W]+H*tt;const gt=H*ot+I[P*a+W],ce=f===0?0:r.h[((A-1)*s+P)*a+W],Dt=gt*ce,yt=gt*X;v[A*s+P]=v[A*s+P]+gt*Y,I[P*a+W]=gt*V;const Bt=r.bRaw[A*a+W];F+=Dt*at*V+yt*V*Bt,D[P*a+W]=D[P*a+W]+Dt*j*V+yt*Bt*((j*V*at-(V-1))/(at*at)),b[A*a+W]=b[A*a+W]+yt*((V-1)/at)}B[A*s+P]=B[A*s+P]+F}}}for(let k=0;k<s*a;k++){const f=t.A_log[k];f<=re||f>=ae||(e.A_log[k]=e.A_log[k]+D[k]*r.aCont[k])}const L=new Float32Array(d*s);for(let k=0;k<d*s;k++)L[k]=B[k]*Zt(r.deltaFull[k]);const N=new Float32Array(d*_);pt(L,r.dtRaw,t.wDtProj,d,_,s,N,e.wDtProj,e.bDtProj);const C=new Float32Array(d*m);for(let k=0;k<d;k++){for(let f=0;f<_;f++)C[k*m+f]=N[k*_+f];for(let f=0;f<a;f++)C[k*m+_+f]=b[k*a+f],C[k*m+_+a+f]=y[k*a+f]}const G=new Float32Array(d*s);pt(C,r.u,t.wXProj,d,s,m,G,e.wXProj,e.bXProj);for(let k=0;k<d*s;k++)v[k]=v[k]+G[k];const q=new Float32Array(d*s);for(let k=0;k<d*s;k++)q[k]=v[k]*Ft(r.convOut[k]);const $=new Float32Array(d*s);for(let k=0;k<l;k++)for(let f=0;f<c;f++){const A=k*c+f;for(let P=0;P<s;P++){const H=q[A*s+P];if(H!==0){e.bConv[P]=e.bConv[P]+H;for(let X=0;X<u;X++){if(f<X)continue;const j=(k*c+f-X)*s+P;e.wConv[P*u+X]=e.wConv[P*u+X]+H*r.xConvIn[j],$[j]=$[j]+H*t.wConv[P*u+X]}}}}const z=new Float32Array(d*2*s);for(let k=0;k<d;k++)for(let f=0;f<s;f++)z[k*2*s+f]=$[k*s+f],z[k*2*s+s+f]=w[k*s+f];const K=new Float32Array(d*n);return pt(z,r.normOut,t.wInProj,d,n,2*s,K,e.wInProj,e.bInProj),ee(K,r.x,t.normWeight,r.normInv,d,n,g,e.normWeight,ht),g}const It=["mamba1"];function rr(o){const t={dModel:o.dModel,dState:o.dState,dConv:o.dConv,dInner:o.dInner,dtRank:o.dtRank};return{embedding:new Float32Array(o.vocabSize*o.dModel),finalNorm:new Float32Array(o.dModel),lmHeadBias:new Float32Array(o.vocabSize),layers:Array.from({length:o.numLayers},()=>tr(t))}}function ar(o){const t=new Map;t.set("embedding",o.embedding);for(let r=0;r<o.layers.length;r++){const i=o.layers[r];for(const e of Lt)t.set(`layer${r}.${e}`,i[e])}return t.set("final_norm",o.finalNorm),t.set("lm_head_bias",o.lmHeadBias),t}function nr(o){const t=new Map;t.set("embedding",o.embedding);for(let r=0;r<o.layers.length;r++){const i=o.layers[r];for(const e of Lt)t.set(`layer${r}.${e}`,i[e])}return t.set("final_norm",o.finalNorm),t.set("lm_head_bias",o.lmHeadBias),t}function ir(o,t){const r=(l,c)=>{const d=o.get(l);if(!d)throw new Error(`cpuWeightsFromNamed: missing tensor "${l}"`);if(d.length!==c)throw new Error(`cpuWeightsFromNamed: "${l}" has ${d.length} elements, expected ${c}`);return d},{dModel:i,dState:e,dConv:n,dInner:a,dtRank:u}=t,s={wInProj:2*a*i,bInProj:2*a,wConv:a*n,bConv:a,wXProj:(u+2*e)*a,bXProj:u+2*e,wDtProj:a*u,bDtProj:a,A_log:a*e,D_vec:a,wOutProj:i*a,bOutProj:i,normWeight:i},_=[];for(let l=0;l<t.numLayers;l++){const c={};for(const d of Lt)c[d]=r(`layer${l}.${d}`,s[d]);_.push(c)}return{embedding:r("embedding",t.vocabSize*i),finalNorm:r("final_norm",i),lmHeadBias:r("lm_head_bias",t.vocabSize),layers:_}}function ie(o,t,r,i,e,n=!1){const{vocabSize:a,dModel:u}=r,s=i*e;let _=new Float32Array(s*u);for(let p=0;p<s;p++){const w=o[p];if(w<0||w>=a)throw new Error(`token id ${w} out of range [0, ${a})`);_.set(t.embedding.subarray(w*u,(w+1)*u),p*u)}const l={dModel:u,dState:r.dState,dConv:r.dConv,dInner:r.dInner,dtRank:r.dtRank,batch:i,seqLen:e},c=[],d=[];for(let p=0;p<r.numLayers;p++){c.push(_);const{output:w,cache:v}=ne(_,t.layers[p],l);n||d.push(v),_=w}const m=new Float32Array(s*u),g=new Float32Array(s);te(_,t.finalNorm,s,u,m,g,ht);const h=new Float32Array(s*a);return lt(m,t.embedding,t.lmHeadBias,s,u,a,h),{hiddenIn:c,layer:d,lastHidden:_,normOut:m,normInv:g,logits:h}}function or(o,t,r,i,e){return ie(o,t,r,i,e).logits}function ua(o,t,r,i,e,n){const a=or(o,r,i,e,n),u=e*n,s=i.vocabSize;let _=0;for(let l=0;l<u;l++)_+=bt(a.subarray(l*s,(l+1)*s),t[l]);return _/u}function sr(o,t,r,i,e,n,a={}){const{vocabSize:u,dModel:s}=i,_=e*n,l=a.activationCheckpointing??!1,c=ie(o,r,i,e,n,l),d=rr(i);let m=0;const g=new Float32Array(_*u);for(let y=0;y<_;y++){const B=c.logits.subarray(y*u,(y+1)*u),D=t[y];m+=bt(B,D);const I=ve(B,D);for(let L=0;L<u;L++)g[y*u+L]=I[L]/_}const h=m/_,p=new Float32Array(_*s);for(let y=0;y<_;y++){const B=y*u,D=y*s;for(let I=0;I<u;I++){const L=g[B+I];if(L===0)continue;d.lmHeadBias[I]=d.lmHeadBias[I]+L;const N=I*s;for(let C=0;C<s;C++)p[D+C]=p[D+C]+L*r.embedding[N+C],d.embedding[N+C]=d.embedding[N+C]+L*c.normOut[D+C]}}const w=new Float32Array(_*s);ee(p,c.lastHidden,r.finalNorm,c.normInv,_,s,w,d.finalNorm,ht);const v={dModel:s,dState:i.dState,dConv:i.dConv,dInner:i.dInner,dtRank:i.dtRank,batch:e,seqLen:n};let b=w;for(let y=i.numLayers-1;y>=0;y--){const B=l?ne(c.hiddenIn[y],r.layers[y],v).cache:c.layer[y];b=er(b,r.layers[y],B,v,d.layers[y])}for(let y=0;y<_;y++){const D=o[y]*s,I=y*s;for(let L=0;L<s;L++)d.embedding[D+L]=d.embedding[D+L]+b[I+L]}return{loss:h,grads:ar(d)}}function dr(o,t){const{dModel:r,dState:i,dConv:e,dInner:n,dtRank:a}=t;if(o==="embedding")return[t.vocabSize,r];switch(o.startsWith("layer")?o.slice(o.indexOf(".")+1):o){case"wInProj":return[2*n,r];case"wConv":return[n,e];case"wXProj":return[a+2*i,n];case"wDtProj":return[n,a];case"A_log":return[n,i];case"wOutProj":return[r,n];default:return null}}const lr=["wInProj","wXProj","wDtProj","wOutProj"],cr=.05;class _a{constructor(t,r=null){x(this,"model");x(this,"tokenizer");x(this,"device");x(this,"_moments");x(this,"_step");x(this,"_dims");x(this,"_mirror");x(this,"_mirrorByName");x(this,"_adapters");x(this,"_loraBase");x(this,"_shard");this.model=t,this.tokenizer=r,this.device=t.device,this._moments=new Map,this._step=0,this._dims=ur(t),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const t=this.model.getTrainableParams();if(this._adapters.size===0)return t.reduce((i,e)=>i+e.numel,0);let r=0;for(const i of t){const e=this._adapters.get(i.name);e&&(r+=e.numParams())}return r}_owns(t){return this._shard===null||t%this._shard.count===this._shard.index}_installAdapters(t){if(this._adapters.size>0)return;const r=new Set(t.targets??lr),i=this._mirrorByName;for(const e of this.model.getTrainableParams()){const n=e.name.includes(".")?e.name.slice(e.name.indexOf(".")+1):e.name;if(!r.has(n))continue;const a=dr(e.name,this._dims);if(!a)continue;const[u,s]=a,_=Math.max(1,Math.min(t.rank??8,u,s));this._adapters.set(e.name,new ye(u,s,{...t,rank:_})),this._loraBase.set(e.name,Float32Array.from(i.get(e.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...r].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const t=this._mirrorByName;for(const[r,i]of this._adapters){const e=t.get(r),n=this._loraBase.get(r),a=i.delta();for(let u=0;u<e.length;u++)e[u]=n[u]+a[u]}}_momentFor(t){let r=this._moments.get(t.name);return r||(r={m:new Float32Array(t.numel),v:new Float32Array(t.numel)},this._moments.set(t.name,r)),r}async _syncMirrorFromGpu(){const t=new Map;for(const r of this.model.parameters())t.set(r.name,await it(this.device,r.buf,r.numel*4));t.set("lm_head_bias",await it(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=ir(t,this._dims),this._mirrorByName=nr(this._mirror)}async train(t,r={}){const{learningRate:i=1e-4,epochs:e=5,batchSize:n=1,seqLen:a=512,maxGradNorm:u=1,weightDecay:s=.01,beta1:_=.9,beta2:l=.999,eps:c=1e-8,wsla:d=!1,onEpochEnd:m=null}=r,g=Math.max(1,Math.floor(r.gradientAccumulation??1));if(this._shard=r.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const h=r.maxDelta??(d?cr:0);d&&this.model.setWSLAMode(!0);let p;if(typeof t=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");p=this.tokenizer.encode(t)}else p=Array.from(t);if(p.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const w=_r(p,a);if(w.length===0)throw new Error("Input is too short to form any training chunk.");const v=hr(w,Math.max(1,Math.floor(n)));await this._syncMirrorFromGpu(),r.lora&&this._installAdapters(r.lora);const b=[];for(let y=0;y<e;y++){let B=0,D=0,I=0;for(let N=0;N<v.length;N+=g){const C=v.slice(N,N+g),{loss:G,gradNorm:q}=await this._trainStep(C,{learningRate:i,maxGradNorm:u,weightDecay:s,beta1:_,beta2:l,eps:c,wsla:d,maxDelta:h,...r.activationCheckpointing?{activationCheckpointing:!0}:{}});B+=G,D+=q,I++}const L=B/I;b.push(L),m&&m(y+1,L,D/I)}return d&&this.model.setWSLAMode(!1),b}async _trainStep(t,r){const{learningRate:i,maxGradNorm:e,weightDecay:n,beta1:a,beta2:u,eps:s,maxDelta:_}=r;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const l=this._mirror,c=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const d=r.activationCheckpointing?{activationCheckpointing:!0}:{};let m=0,g=new Map;for(const b of t){const y=sr(b.inputs,b.targets,l,this._dims,b.batch,b.seqLen,d);if(m+=y.loss/t.length,g.size===0){for(const B of y.grads.values())for(let D=0;D<B.length;D++)B[D]=B[D]/t.length;g=y.grads}else for(const[B,D]of y.grads){const I=g.get(B);for(let L=0;L<D.length;L++)I[L]=I[L]+D[L]/t.length}}const h=this.model.getTrainableParams();if(this._adapters.size>0)for(const[b,y]of this._adapters){const B=g.get(b);B&&(y.zeroGrad(),y.accumulateGradient(B))}let p=0;for(const b of h){const y=g.get(b.name);if(y)for(let B=0;B<y.length;B++)p+=y[B]*y[B]}const w=Math.sqrt(p),v=e>0&&w>e?e/w:1;return this._adamwStep(h,g,c,{learningRate:i,weightDecay:n,beta1:a,beta2:u,eps:s,beta1_t:Math.pow(a,this._step),beta2_t:Math.pow(u,this._step),maxDelta:_,gradScale:v}),{loss:m,gradNorm:w}}_adamwStep(t,r,i,e){const{learningRate:n,weightDecay:a,beta1:u,beta2:s,eps:_,beta1_t:l,beta2_t:c,maxDelta:d,gradScale:m}=e,g={lr:n,beta1:u,beta2:s,eps:_,weightDecay:a,beta1_t:l,beta2_t:c,maxDelta:d,gradScale:m};for(let h=0;h<t.length;h++){const p=t[h];if(!this._owns(h))continue;const w=this._adapters.get(p.name);if(w){const B=i.get(p.name),D=this._loraBase.get(p.name),[I,L]=[w.A,w.B],[N,C]=[w.gradients()[1].data,w.gradients()[0].data],G=this._momentNamed(`${p.name}::loraB`,L.length),q=this._momentNamed(`${p.name}::loraA`,I.length);xt(L,C,G.m,G.v,g),xt(I,N,q.m,q.v,g);const $=w.delta();for(let z=0;z<B.length;z++)B[z]=D[z]+$[z];ct(this.device,p.buf,B);continue}const v=r.get(p.name),b=i.get(p.name);if(!v||!b)continue;if(v.length!==p.numel||b.length!==p.numel)throw new Error(`MambaTrainer: parameter "${p.name}" is ${p.numel} elements but the gradient engine produced ${v.length} — model and CPU mirror disagree.`);const y=this._momentFor(p);xt(b,v,y.m,y.v,g),ct(this.device,p.buf,b)}}_momentNamed(t,r){let i=this._moments.get(t);return i||(i={m:new Float32Array(r),v:new Float32Array(r)},this._moments.set(t,i)),i}optimizerStateBytes(){let t=0;for(const r of this._moments.values())t+=r.m.byteLength+r.v.byteLength;return t}async evaluate(t){let r;if(typeof t=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");r=Array.from(this.tokenizer.encode(t))}else r=Array.from(t);const i=r.length,e=this.model.config.vocabSize,{logits:n}=await this.model.forward(new Uint32Array(r.slice(0,-1)),1,i-1);let a=0;for(let s=0;s<i-1;s++){const _=s*e;a+=bt(n.slice(_,_+e),r[s+1])}const u=a/(i-1);return Math.exp(u)}}function ur(o){const t=o.layerSpecs.map((n,a)=>({i:a,type:n.type})).filter(({type:n})=>!It.includes(n));if(t.length>0){const n=t.map(({i:a,type:u})=>`layer${a}=${u}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${It.join("/")} layers only, but this model has ${n}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const r=o.layers[0],i=(r==null?void 0:r.dInner)??o.config.expand*o.config.dModel,e=(r==null?void 0:r.dtRank)??Math.ceil(o.config.dModel/16);return{vocabSize:o.config.vocabSize,dModel:o.config.dModel,dState:o.config.dState,dConv:o.config.dConv,dInner:i,dtRank:e,numLayers:o.layers.length}}function _r(o,t){const r=[];for(let e=0;e+t<o.length;e+=t)r.push({inputs:o.slice(e,e+t),targets:o.slice(e+1,e+t+1)});const i=o.length%t;if(i>1){const e=o.length-i;r.push({inputs:o.slice(e,-1),targets:o.slice(e+1)})}return r}function hr(o,t){const r=[];let i=0;for(;i<o.length;){const e=o[i].inputs.length,n=[];for(;i<o.length&&n.length<t&&o[i].inputs.length===e;)n.push(o[i]),i++;r.push({inputs:n.flatMap(a=>a.inputs),targets:n.flatMap(a=>a.targets),batch:n.length,seqLen:e})}return r}function ha(o,t,r){return[...t,...o.encode(r)]}function gr(o,t,r,i){if(o.config.vocabSize!==t.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${o.config.vocabSize}) must equal codec.vocabSize (${t.vocabSize})`);const e=o.generate(r,{...i,stopToken:i.stopToken??t.vocab.eosVideo});return{video:t.decode(e),tokens:e}}function ga(o,t,r,i){const{video:e,tokens:n}=gr(o,t.video,r,i);return{image:e[0]??new Float32Array(t.frameSize),tokens:n}}const pr=0,mr=5,fr=2;class et{constructor(){x(this,"parts",[])}byte(t){this.parts.push(t&255)}rawVarint(t){if(t<0||!Number.isFinite(t))throw new Error(`ProtoWriter: bad varint ${t}`);let r=t;for(;r>=128;)this.byte(r%128|128),r=Math.floor(r/128);this.byte(r)}tag(t,r){this.rawVarint(t*8+r)}rawBytes(t){for(let r=0;r<t.length;r++)this.byte(t[r])}varint(t,r){this.tag(t,pr),this.rawVarint(r)}float(t,r){this.tag(t,mr);const i=new ArrayBuffer(4);new DataView(i).setFloat32(0,r,!0),this.rawBytes(new Uint8Array(i))}bytes(t,r){this.tag(t,fr),this.rawVarint(r.length),this.rawBytes(r)}string(t,r){this.bytes(t,new TextEncoder().encode(r))}message(t,r){this.bytes(t,r.finish())}finish(){return Uint8Array.from(this.parts)}}function br(o){const t=new Uint8Array(o.length*4),r=new DataView(t.buffer);for(let i=0;i<o.length;i++)r.setFloat32(i*4,o[i],!0);return t}const wr=18,vr=8,oe=1,se=7,yr=1,xr=2,Ar=3,kr=7;class Lr{constructor(){x(this,"nodes",[]);x(this,"inits",[]);x(this,"uid",0)}tmp(t){return`${t}_${this.uid++}`}initFloat(t,r,i){return this.inits.push({name:t,dims:r,dataType:oe,raw:br(i)}),t}initInt64(t,r,i){return this.inits.push({name:t,dims:r,dataType:se,int64:i}),t}node(t,r,i,e=[]){return this.nodes.push({op:t,inputs:r,outputs:i,name:`${t}_${this.uid++}`,attrs:e}),i}op(t,r,i,e=[]){const n=this.tmp(i);return this.node(t,r,[n],e),n}}function jt(o,t,r,i,e){const n=o.op("Mul",[t,t],"rms_sq"),a=o.op("ReduceMean",[n,e],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),u=o.op("Add",[a,i],"rms_eps"),s=o.op("Sqrt",[u],"rms_r"),_=o.op("Div",[t,s],"rms_div");return o.op("Mul",[_,r],"rms_y")}function Tt(o,t,r,i,e,n){const a=o.op("Transpose",[r],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),u=o.op("Add",[o.op("MatMul",[t,a],"ffn_mm1"),i],"ffn_pre"),s=o.op("Relu",[u],"ffn_h"),_=o.op("Transpose",[e],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return o.op("Add",[o.op("MatMul",[s,_],"ffn_mm2"),n],"ffn_y")}function Et(o,t={}){const r=Kt(o),i=$t(o),e=new Map(i.map(b=>[b.name,b])),n=b=>{const y=e.get(b);if(!y)throw new Error(`export/onnx: missing tensor ${b}`);return y},a=new Lr,{vocabSize:u,dModel:s,numLayers:_,convKernel:l,numExperts:c,topK:d}=r,m=a.initFloat("token_embedding.weight",[u,s],n("token_embedding.weight").data),g=a.initFloat("rms_eps",[1],new Float32Array([1e-5])),h=a.initInt64("axes_last",[1],[2]),p=a.initInt64("topk_k",[1],[d]);let w=a.op("Gather",[m,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let b=0;b<_;b++){const y=`layers.${b}`,B=a.initFloat(`${y}.norm_conv.weight`,[s],n(`${y}.norm_conv.weight`).data),D=jt(a,w,B,g,h),I=n(`${y}.conv.weight`).data,L=new Float32Array(s*l);for(let V=0;V<s;V++)for(let Y=0;Y<l;Y++)L[V*l+(l-1-Y)]=I[V*l+Y];const N=a.initFloat(`${y}.conv.onnx_weight`,[s,1,l],L),C=a.op("Transpose",[D],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),G=a.op("Conv",[C,N],"conv_out",[{kind:"i",name:"group",value:s},{kind:"ints",name:"kernel_shape",value:[l]},{kind:"ints",name:"pads",value:[l-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),q=a.op("Transpose",[G],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),$=a.op("Add",[w,q],"after_conv"),z=a.initFloat(`${y}.norm_moe.weight`,[s],n(`${y}.norm_moe.weight`).data),K=jt(a,$,z,g,h),k=a.initFloat(`${y}.moe.router.weight`,[c,s],n(`${y}.moe.router.weight`).data),f=a.op("Transpose",[k],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),A=a.op("MatMul",[K,f],"router_logits"),P=a.tmp("topk_v"),H=a.tmp("topk_i");a.node("TopK",[A,p],[P,H],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const X=a.op("Softmax",[P],"gates",[{kind:"i",name:"axis",value:2}]),j=a.op("Sub",[A,A],"zeros"),F=a.op("ScatterElements",[j,H,X],"combine",[{kind:"i",name:"axis",value:2}]),W=Tt(a,K,a.initFloat(`${y}.moe.shared.w1`,[r.hiddenDim,s],n(`${y}.moe.shared.w1`).data),a.initFloat(`${y}.moe.shared.b1`,[r.hiddenDim],n(`${y}.moe.shared.b1`).data),a.initFloat(`${y}.moe.shared.w2`,[s,r.hiddenDim],n(`${y}.moe.shared.w2`).data),a.initFloat(`${y}.moe.shared.b2`,[s],n(`${y}.moe.shared.b2`).data)),U=Array.from({length:c},(V,Y)=>a.tmp(`combine_${Y}`));a.node("Split",[F],U,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:c}]);let tt=W;for(let V=0;V<c;V++){const Y=`${y}.moe.experts.${V}`,at=Tt(a,K,a.initFloat(`${Y}.w1`,[r.hiddenDim,s],n(`${Y}.w1`).data),a.initFloat(`${Y}.b1`,[r.hiddenDim],n(`${Y}.b1`).data),a.initFloat(`${Y}.w2`,[s,r.hiddenDim],n(`${Y}.w2`).data),a.initFloat(`${Y}.b2`,[s],n(`${Y}.b2`).data)),ot=a.op("Mul",[U[V],at],"expert_w");tt=a.op("Add",[tt,ot],"moe_acc")}w=a.op("Add",[$,tt],"after_moe")}const v=a.op("Transpose",[m],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return a.node("MatMul",[w,v],["logits"]),Nr(a,r,t)}function Dr(o){const t=new et;switch(t.string(1,o.name),o.kind){case"i":t.varint(20,xr),t.varint(3,o.value);break;case"ints":t.varint(20,kr);for(const r of o.value)t.varint(8,r);break;case"f":t.varint(20,yr),t.float(2,o.value);break;case"s":t.varint(20,Ar),t.string(4,o.value);break}return t}function Br(o){const t=new et;for(const r of o.inputs)t.string(1,r);for(const r of o.outputs)t.string(2,r);t.string(3,o.name),t.string(4,o.op);for(const r of o.attrs)t.message(5,Dr(r));return t}function Pr(o){const t=new et;for(const r of o.dims)t.varint(1,r);if(t.varint(2,o.dataType),t.string(8,o.name),o.int64)for(const r of o.int64)t.varint(7,r);return o.raw&&t.bytes(9,o.raw),t}function Mr(o){const t=new et;return t.string(2,o),t}function Wr(o){const t=new et;return t.varint(1,o),t}function Rt(o,t,r){const i=new et;for(const u of r)i.message(1,typeof u=="string"?Mr(u):Wr(u));const e=new et;e.varint(1,t),e.message(2,i);const n=new et;n.message(1,e);const a=new et;return a.string(1,o),a.message(2,n),a}function Nr(o,t,r){const i=new et;for(const a of o.nodes)i.message(1,Br(a));i.string(2,"evermind");for(const a of o.inits)i.message(5,Pr(a));i.message(11,Rt("input_ids",se,["batch","seq"])),i.message(12,Rt("logits",oe,["batch","seq",t.vocabSize]));const e=new et;e.string(1,""),e.varint(2,wr);const n=new et;return n.varint(1,vr),n.string(2,r.producerName??"builderforce-memory-engine"),n.string(3,r.producerVersion??"evermind"),n.message(7,i),n.message(8,e),n.finish()}const Sr=1179993927,Cr=3,dt=32,Fr=4,Ir=8,jr=0,Tr=1;class Er{constructor(){x(this,"buf",new Uint8Array(1024));x(this,"len",0)}ensure(t){if(this.len+t<=this.buf.length)return;let r=this.buf.length*2;for(;r<this.len+t;)r*=2;const i=new Uint8Array(r);i.set(this.buf.subarray(0,this.len)),this.buf=i}u32(t){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,t,!0),this.len+=4}u64(t){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(t),!0),this.len+=8}raw(t){this.ensure(t.length),this.buf.set(t,this.len),this.len+=t.length}alignTo(t){const r=(t-this.len%t)%t;r>0&&(this.ensure(r),this.len+=r)}string(t){const r=new TextEncoder().encode(t);this.u64(r.length),this.raw(r)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function Rr(o,t){if(!t){const e=new Uint8Array(o.length*4),n=new DataView(e.buffer);for(let a=0;a<o.length;a++)n.setFloat32(a*4,o[a],!0);return e}const r=new Uint8Array(o.length*2),i=new DataView(r.buffer);for(let e=0;e<o.length;e++)i.setUint16(e*2,xe(o[e]),!0);return r}function Ht(o,t={}){const r=t.fp16??!1,i=Kt(o),e=$t(o),n=r?Tr:jr,a=r?2:4,u=[["evermind.vocab_size",i.vocabSize],["evermind.embedding_length",i.dModel],["evermind.block_count",i.numLayers],["evermind.conv_kernel",i.convKernel],["evermind.feed_forward_length",i.hiddenDim],["evermind.expert_count",i.numExperts],["evermind.expert_used_count",i.topK],["general.alignment",dt]],s=[["general.architecture","evermind"],["general.name",t.name??"Evermind"]],_=new Er;_.u32(Sr),_.u32(Cr),_.u64(e.length),_.u64(u.length+s.length);for(const[g,h]of s)_.string(g),_.u32(Ir),_.string(h);for(const[g,h]of u)_.string(g),_.u32(Fr),_.u32(h);const l=g=>[...g.shape].reverse();let c=0;const d=[];for(const g of e){d.push(c);const h=g.data.length*a;c+=h,c+=(dt-c%dt)%dt}e.forEach((g,h)=>{_.string(g.name);const p=l(g);_.u32(p.length);for(const w of p)_.u64(w);_.u32(n),_.u64(d[h])}),_.alignTo(dt);const m=_.length;for(let g=0;g<e.length;g++){const h=m+d[g];for(;_.length<h;)_.raw(new Uint8Array(1));_.raw(Rr(e[g].data,r))}return _.bytes()}const pa=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],Hr="application/json";function At(o,t){return{path:o,data:JSON.stringify(t,null,2),contentType:Hr}}function ma(o,t,r={},i){const e=Ae(o),n=()=>({format:t,files:[],paramCount:e});switch(t){case"safetensors":{const a=n();return a.files.push({path:"model.safetensors",data:Mt(o,{fp16:r.fp16}),contentType:"application/octet-stream"}),a}case"onnx":{const a=n();return a.files.push({path:"model.onnx",data:Et(o,{producerVersion:r.version}),contentType:"application/octet-stream"}),a}case"gguf":{const a=n();return a.files.push({path:"model.gguf",data:Ht(o,{name:r.name,fp16:r.fp16}),contentType:"application/octet-stream"}),a}case"huggingface":{if(!i)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const a=n();return a.files.push({path:"model.safetensors",data:Mt(o,{fp16:r.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:Et(o,{producerVersion:r.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:Ht(o,{name:r.name,fp16:r.fp16}),contentType:"application/octet-stream"},At("config.json",ke(o)),At("generation_config.json",Be()),At("tokenizer.json",Le(i)),{path:"README.md",data:De(o,r),contentType:"text/markdown"}),a}default:throw new Error(`exportEvermind: unknown format "${String(t)}"`)}}const zr=`

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
`,fa=`

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
`,ba={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},J={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},de=8,ft=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],Or=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],Gr=[0,.2,.5,.5,.8,.5,.7,.5];function rt(o,t){const r=Or[o];return r?Number.isNaN(t)?r[0]:Math.max(r[0],Math.min(r[1],t)):t}function wa(o){for(let t=0;t<o.length&&t<de;t++)o[t]=rt(t,o[t]);return o}function le(){return Float32Array.from(Gr)}function va(o){const t={};for(let r=0;r<ft.length;r++)t[ft[r]]=o[r]??0;return t}function ya(o){const t=le();for(let r=0;r<ft.length;r++){const i=o[ft[r]];typeof i=="number"&&!Number.isNaN(i)&&(t[r]=rt(r,i))}return t}function nt(o){return((typeof o=="number"&&!Number.isNaN(o)?Math.max(0,Math.min(100,o)):50)-50)/50}function xa(o){const t=le();if(!o)return t;const r=nt(o.openness),i=nt(o.emotionality),e=nt(o.conscientiousness),n=nt(o.extraversion),a=nt(o.regulatoryFocus),u=nt(o.riskTolerance),s=nt(o.grit),_=nt(o.stimulation);return t[J.driveCuriosity]=rt(J.driveCuriosity,.5+.35*r+.15*_),t[J.exploration]=rt(J.exploration,.4+.3*r+.25*u+.15*a),t[J.driveCaution]=rt(J.driveCaution,.5+.3*e-.3*u-.2*a+.15*i),t[J.arousal]=rt(J.arousal,.2+.2*i+.1*n),t[J.driveSocial]=rt(J.driveSocial,.5+.35*n),t[J.driveEffort]=rt(J.driveEffort,.8+.15*s+.1*e),t[J.valence]=rt(J.valence,0+.1*a-.1*i),t[J.attention]=rt(J.attention,.7+.1*e),t}const qr={inputDim:32,hiddenDim:16,stateDim:de,rewardWeight:.5},zt=1280131651,Kr=296863214;function $r(o){return 1/(1+Math.exp(-o))}class Aa{constructor(t={}){x(this,"config");x(this,"win");x(this,"ws");x(this,"aLogit");x(this,"woutState");x(this,"boutState");x(this,"woutReward");x(this,"boutReward");x(this,"gWin");x(this,"gWs");x(this,"gALogit");x(this,"gWoutState");x(this,"gBoutState");x(this,"gWoutReward");x(this,"gBoutReward");const r={...qr,...t};if(r.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${r.hiddenDim})`);this.config=r;const{inputDim:i,hiddenDim:e,stateDim:n}=r,a=new qt((t.seed??Kr)>>>0||1),u=_=>{const l=Math.max(a.next(),1e-12),c=a.next();return _*Math.sqrt(-2*Math.log(l))*Math.cos(2*Math.PI*c)},s=(_,l)=>{const c=new Float32Array(_);for(let d=0;d<_;d++)c[d]=u(l);return c};this.win=s(e*i,.1),this.ws=s(e*n,.1),this.aLogit=s(e,.05),this.woutState=s(n*e,.05),this.boutState=new Float32Array(n),this.woutReward=s(e,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(t,r,i){const e=this._forwardCached(t,r,i);return{hidden:e.hn,delta:e.delta,reward:e.reward}}_forwardCached(t,r,i){const{inputDim:e,hiddenDim:n,stateDim:a}=this.config,u=Float32Array.from({length:e},(h,p)=>t[p]??0),s=Float32Array.from({length:n},(h,p)=>r[p]??0),_=Float32Array.from({length:a},(h,p)=>i[p]??0),l=new Float32Array(n),c=new Float32Array(n),d=new Float32Array(n);for(let h=0;h<n;h++){let p=0;const w=h*e;for(let b=0;b<e;b++)p+=this.win[w+b]*u[b];const v=h*a;for(let b=0;b<a;b++)p+=this.ws[v+b]*_[b];l[h]=$r(this.aLogit[h]),c[h]=Math.tanh(p),d[h]=l[h]*s[h]+(1-l[h])*c[h]}const m=new Float32Array(a);for(let h=0;h<a;h++){let p=this.boutState[h];const w=h*n;for(let v=0;v<n;v++)p+=this.woutState[w+v]*d[v];m[h]=Math.tanh(p)}let g=this.boutReward[0];for(let h=0;h<n;h++)g+=this.woutReward[h]*d[h];return{x:u,sPrev:_,hPrev:s,a:l,t:c,hn:d,delta:m,reward:g}}backwardStep(t,r,i,e,n){const{inputDim:a,hiddenDim:u,stateDim:s,rewardWeight:_}=this.config,l=this._forwardCached(t,r,i);let c=0;const d=new Float32Array(s);for(let p=0;p<s;p++){const w=l.delta[p]-(e[p]??0);c+=.5*w*w,d[p]=w}const m=l.reward-n;c+=.5*_*m*m;const g=_*m,h=new Float32Array(u);for(let p=0;p<s;p++){const w=d[p]*(1-l.delta[p]*l.delta[p]);this.gBoutState[p]=this.gBoutState[p]+w;const v=p*u;for(let b=0;b<u;b++)this.gWoutState[v+b]=this.gWoutState[v+b]+w*l.hn[b],h[b]=h[b]+w*this.woutState[v+b]}this.gBoutReward[0]=this.gBoutReward[0]+g;for(let p=0;p<u;p++)this.gWoutReward[p]=this.gWoutReward[p]+g*l.hn[p],h[p]=h[p]+g*this.woutReward[p];for(let p=0;p<u;p++){const w=l.a[p],v=l.t[p];this.gALogit[p]=this.gALogit[p]+h[p]*(l.hPrev[p]-v)*w*(1-w);const b=h[p]*(1-w)*(1-v*v),y=p*a;for(let D=0;D<a;D++)this.gWin[y+D]=this.gWin[y+D]+b*l.x[D];const B=p*s;for(let D=0;D<s;D++)this.gWs[B+D]=this.gWs[B+D]+b*l.sPrev[D]}return{loss:c,hidden:l.hn}}exportWeights(t={}){const r=t.fp16??!1,i=this.parameters(),e=i.reduce((l,c)=>l+c.numel,0),n=5,a=n*4,u=r?e*2:e*4,s=new ArrayBuffer(a+u),_=new Uint32Array(s,0,n);if(_[0]=zt,_[1]=r?2:1,_[2]=this.config.inputDim,_[3]=this.config.hiddenDim,_[4]=this.config.stateDim,r){const l=new Float32Array(e);let c=0;for(const m of i)l.set(m.data,c),c+=m.numel;const d=Ot(l);new Uint16Array(s,a,e).set(d)}else{const l=new Float32Array(s,a,e);let c=0;for(const d of i)l.set(d.data,c),c+=d.numel}return s}loadWeights(t){const r=new Uint32Array(t,0,5);if(r[0]!==zt)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const i=r[1],e=r[2],n=r[3],a=r[4];if(e!==this.config.inputDim||n!==this.config.hiddenDim||a!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${e}/${n}/${a} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const u=this.parameters(),s=u.reduce((d,m)=>d+m.numel,0),_=20;let l;i===2?l=Gt(new Uint16Array(t,_,s)):l=new Float32Array(t.slice(_,_+s*4));let c=0;for(const d of u)d.data.set(l.subarray(c,c+d.numel)),c+=d.numel}}function Ur(o,t,r,i,e,n,a,u){const s=new ArrayBuffer(32);return new Uint32Array(s,0,1).set([o]),new Float32Array(s,4,7).set([t,r,i,e,n,a,u]),s}class ka{constructor(t,r=null){x(this,"model");x(this,"device");x(this,"_moments",null);x(this,"_step",0);x(this,"_adamwPipeline");this.model=t,this.device=r,this._adamwPipeline=r?O(r,zr,"adamw_update"):null}get gpuTraining(){return this.device!=null&&this._adamwPipeline!=null}_initMoments(){this._moments||(this._moments=this.model.parameters().map(t=>({m:new Float32Array(t.numel),v:new Float32Array(t.numel)})))}async train(t,r={}){if(t.length===0)throw new Error("LimbicTrainer.train: no samples");const{learningRate:i=.05,epochs:e=50,weightDecay:n=0,beta1:a=.9,beta2:u=.999,eps:s=1e-8,maxGradNorm:_=1,onEpochEnd:l=null}=r;this._initMoments();const c=[];for(let d=0;d<e;d++){this.model.zeroGrad();let m=0;for(const B of t){const{loss:D}=this.model.backwardStep(B.input,this.model.initHidden(),B.state,B.deltaTarget,B.reward);m+=D}const g=this.model.gradients(),h=1/t.length;for(const B of g)for(let D=0;D<B.data.length;D++)B.data[D]*=h;const p=this._clipGradients(g,_);this._step++;const w=Math.pow(a,this._step),v=Math.pow(u,this._step),b={learningRate:i,weightDecay:n,beta1:a,beta2:u,eps:s,beta1_t:w,beta2_t:v};this.gpuTraining?await this._adamwStepGpu(g,b):this._adamwStepCpu(g,b);const y=m/t.length;c.push(y),l&&l(d+1,y,p)}return c}evaluate(t){if(t.length===0)return 0;let r=0;const{rewardWeight:i}=this.model.config;for(const e of t){const n=this.model.forward(e.input,this.model.initHidden(),e.state);let a=0;for(let s=0;s<n.delta.length;s++){const _=n.delta[s]-(e.deltaTarget[s]??0);a+=.5*_*_}const u=n.reward-e.reward;a+=.5*i*u*u,r+=a}return r/t.length}_clipGradients(t,r){let i=0;for(const n of t)for(let a=0;a<n.data.length;a++)i+=n.data[a]*n.data[a];const e=Math.sqrt(i);if(e>r&&e>0){const n=r/e;for(const a of t)for(let u=0;u<a.data.length;u++)a.data[u]*=n}return e}_adamwStepCpu(t,r){const i=this.model.parameters(),{learningRate:e,weightDecay:n,beta1:a,beta2:u,eps:s,beta1_t:_,beta2_t:l}=r;for(let c=0;c<i.length;c++){const d=i[c].data,m=t[c].data,g=this._moments[c];for(let h=0;h<d.length;h++){const p=m[h];g.m[h]=a*g.m[h]+(1-a)*p,g.v[h]=u*g.v[h]+(1-u)*p*p;const w=g.m[h]/(1-_),v=g.v[h]/(1-l);d[h]=d[h]*(1-e*n)-e*w/(Math.sqrt(v)+s)}}}async _adamwStepGpu(t,r){const i=this.device,e=this._adamwPipeline,n=this.model.parameters(),{learningRate:a,weightDecay:u,beta1:s,beta2:_,eps:l,beta1_t:c,beta2_t:d}=r;for(let m=0;m<n.length;m++){const g=n[m],h=this._moments[m],p=Z(i,g.data,!0),w=Z(i,t[m].data,!1),v=Z(i,h.m,!0),b=Z(i,h.v,!0),y=R(i,Ur(g.numel,a,s,_,l,u,c,d)),B=T(i,e,[y,p,w,v,b]);E(i,e,B,[S(g.numel,256),1,1]),g.data.set((await it(i,p,g.numel*4)).subarray(0,g.numel)),h.m.set((await it(i,v,g.numel*4)).subarray(0,g.numel)),h.v.set((await it(i,b,g.numel*4)).subarray(0,g.numel)),p.destroy(),w.destroy(),v.destroy(),b.destroy(),y.destroy()}}}const La=`

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
`;export{la as $,ea as A,je as B,vt as C,qr as D,pa as E,ia as F,fa as G,Ge as H,_a as I,oa as J,ht as K,La as L,Lt as M,Gr as N,Wt as O,ta as P,Zr as Q,ba as R,Yr as S,Te as T,ra as U,Ne as V,zr as W,cr as X,Xe as Y,mt as Z,sa as _,st as a,Ye as a0,hr as a1,_r as a2,ha as a3,rt as a4,wa as a5,da as a6,Qe as a7,Jt as a8,ur as a9,va as aA,ar as aB,Ue as aC,ca as aD,rr as aE,tr as aF,sr as aa,or as ab,ua as ac,ir as ad,Q as ae,ma as af,Ht as ag,Et as ah,ga as ai,gr as aj,pt as ak,lt as al,er as am,ne as an,nr as ao,le as ap,dr as aq,Ve as ar,xa as as,ya as at,ee as au,te as av,Zt as aw,Ct as ax,Ft as ay,Ze as az,na as b,Nt as c,Vt as d,ae as e,re as f,He as g,wt as h,aa as i,Fe as j,Qr as k,kt as l,It as m,Kr as n,lr as o,Or as p,J as q,ft as r,de as s,Jr as t,_t as u,$e as v,Aa as w,ka as x,We as y,Ce as z};
