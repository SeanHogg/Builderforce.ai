import{fx as E,fs as j,fF as T,fj as N,ft as z,fu as D,ed as ot,fw as J,gE as At,gy as it,dX as ne,dY as ie,ec as st,e1 as se,dn as oe,dV as Tt,ga as ct,gH as kt,gF as Et,gA as Ht,gB as Rt,gb as nt,gG as Lt,gI as de,eZ as bt,f5 as mt,eJ as le,ez as ce}from"./index.js";import{U as zt,u as Ot,k as ue,e as ht,E as he,d as _e,r as ge,L as pe,n as Kt,N as Gt,B as me,Q as fe,A as Dt,q as be,t as we,K as ve,G as ye}from"./chunk-evermind.js";const Bt=`

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
`,Hr=`

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
`,wt=`

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
`,Rr=`

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
`,dt=`

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
`,zr=`

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
`,rt=`

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
`,Or=`
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
`,Kr=`
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
`,Gr=`

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
`,_t=`
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
`,gt="col_slice";function Y(o,e,r,i,t,n,a,u){const s=E(o,new Uint32Array([t,n,a,u]).buffer),h=j(o,e,[s,r,i]);T(o,e,h,[N(t*u,256),1,1]),s.destroy()}const xe=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,Ae=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class ke{layerType="mamba1";device;config;dInner;dtRank;wInProj;bInProj;wConv;bConv;wXProj;bXProj;wDtProj;bDtProj;A_log;D_vec;wOutProj;bOutProj;normWeight;gpuWeights;pipelines;_wslaMode=!1;constructor(e,r){this.device=e,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(r.dModel/16),...r};const{dModel:i,expand:t}=this.config;this.dInner=t*i,this.dtRank=r.dtRank??Math.ceil(i/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:r,dConv:i}=this.config,t=this.dInner,n=r,a=i,u=this.dtRank,s=(c,d=.02)=>ot(c,d),h=c=>new Float32Array(c),l=c=>new Float32Array(c).fill(1);this.wInProj=s(2*t*e),this.bInProj=h(2*t),this.wConv=s(t*a,.01),this.bConv=h(t),this.wXProj=s((u+2*n)*t,.01),this.bXProj=h(u+2*n),this.wDtProj=s(t*u,.02),this.bDtProj=h(t),this.A_log=new Float32Array(t*n);for(let c=0;c<t;c++)for(let d=0;d<n;d++)this.A_log[c*n+d]=Math.log(d+1);this.D_vec=l(t),this.wOutProj=s(e*t,.02),this.bOutProj=h(e),this.normWeight=l(e),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const e=this.device,r=i=>J(e,i,!0);this.gpuWeights={wInProj:r(this.wInProj),bInProj:r(this.bInProj),wConv:r(this.wConv),bConv:r(this.bConv),wXProj:r(this.wXProj),bXProj:r(this.bXProj),wDtProj:r(this.wDtProj),bDtProj:r(this.bDtProj),A_log:r(this.A_log),D_vec:r(this.D_vec),wOutProj:r(this.wOutProj),bOutProj:r(this.bOutProj),normWeight:r(this.normWeight)}}_buildPipelines(){const e=this.device;this.pipelines={linear:z(e,dt,"linear_forward"),conv1d:z(e,wt,"conv1d_forward"),silu:z(e,rt,"silu_forward"),rmsnorm:z(e,rt,"rmsnorm_forward"),scan_fwd:z(e,Bt,"forward_scan"),scan_reduce:z(e,Bt,"forward_reduce"),colSlice:z(e,_t,gt),elMul:z(e,xe,"main"),elAdd:z(e,Ae,"main")}}forward(e,r,i){const t=this.device,{dModel:n,dState:a,dConv:u}=this.config,s=this.dInner,h=a,l=r,c=i,d=l*c,f=this.dtRank,p={},g=D(t,d*n*4,!0),_=D(t,d*4,!0);p.normInv=_,p.normIn=e;{const m=new ArrayBuffer(16);new Uint32Array(m,0,2).set([d,n]),new Float32Array(m,8,1).set([1e-6]);const x=E(t,m),L=j(t,this.pipelines.rmsnorm,[x,e,this.gpuWeights.normWeight,g,_]);T(t,this.pipelines.rmsnorm,L,[N(d,64),1,1])}const w=D(t,d*2*s*4,!0);p.normOut=g;{const m=new Uint32Array([d,n,2*s]).buffer,x=E(t,m),L=j(t,this.pipelines.linear,[x,g,this.gpuWeights.wInProj,this.gpuWeights.bInProj,w]);T(t,this.pipelines.linear,L,[N(d,16),N(2*s,16),1])}const y=D(t,d*s*4,!0),b=D(t,d*s*4,!0);{const m=this.pipelines.colSlice;Y(t,m,w,y,d,2*s,0,s),Y(t,m,w,b,d,2*s,s,s)}w.destroy(),p.zBuf=b,p.xConvIn=y;const v=D(t,d*s*4,!0);p.convOut=v;{const m=new Uint32Array([c,s,u,l,1]).buffer,x=E(t,m),L=j(t,this.pipelines.conv1d,[x,y,this.gpuWeights.wConv,this.gpuWeights.bConv,v]);T(t,this.pipelines.conv1d,L,[N(c,16),N(s,16),l])}const P=D(t,d*s*4,!0);p.siluOut=P;{const m=new Uint32Array([d*s]).buffer,x=E(t,m),L=j(t,this.pipelines.silu,[x,v,P]);T(t,this.pipelines.silu,L,[N(d*s,256),1,1])}const B=D(t,d*(f+2*h)*4,!0);{const m=new Uint32Array([d,s,f+2*h]).buffer,x=E(t,m),L=j(t,this.pipelines.linear,[x,P,this.gpuWeights.wXProj,this.gpuWeights.bXProj,B]);T(t,this.pipelines.linear,L,[N(d,16),N(f+2*h,16),1])}const F=D(t,d*f*4,!0),k=D(t,l*c*h*4,!0),W=D(t,l*c*h*4,!0);{const m=f+2*h,x=this.pipelines.colSlice;Y(t,x,B,F,d,m,0,f),Y(t,x,B,k,d,m,f,h),Y(t,x,B,W,d,m,f+h,h)}B.destroy(),p.B_raw=k,p.C_raw=W;const S=D(t,d*s*4,!0);p.deltaFull=S;{const m=new Uint32Array([d,f,s]).buffer,x=E(t,m),L=j(t,this.pipelines.linear,[x,F,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,S]);T(t,this.pipelines.linear,L,[N(d,16),N(s,16),1])}F.destroy();const O=D(t,l*c*s*4,!0),K=D(t,2*l*c*s*h*4,!0);p.hCache=K;{const m=new Uint32Array([c,h,s,l]).buffer,x=E(t,m),L=j(t,this.pipelines.scan_fwd,[x,P,S,this.gpuWeights.A_log,k,W,this.gpuWeights.D_vec,O,K]);T(t,this.pipelines.scan_fwd,L,[s,h,l]);const H=j(t,this.pipelines.scan_reduce,[x,P,S,this.gpuWeights.A_log,k,W,this.gpuWeights.D_vec,O,K]);T(t,this.pipelines.scan_reduce,H,[N(c,64),s,l])}const $=D(t,d*s*4,!0),R=D(t,d*s*4,!0);{const m=E(t,new Uint32Array([d*s]).buffer),x=j(t,this.pipelines.silu,[m,b,$]);T(t,this.pipelines.silu,x,[N(d*s,256),1,1]);const L=E(t,new Uint32Array([d*s]).buffer),H=j(t,this.pipelines.elMul,[O,$,R,L]);T(t,this.pipelines.elMul,H,[N(d*s,256),1,1])}$.destroy(),O.destroy();const G=D(t,d*n*4,!0);{const m=new Uint32Array([d,s,n]).buffer,x=E(t,m),L=j(t,this.pipelines.linear,[x,R,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,G]);T(t,this.pipelines.linear,L,[N(d,16),N(n,16),1])}R.destroy();const A=D(t,d*n*4,!0);{const m=E(t,new Uint32Array([d*n]).buffer),x=j(t,this.pipelines.elAdd,[G,e,A,m]);T(t,this.pipelines.elAdd,x,[N(d*n,256),1,1])}return G.destroy(),{output:A,cache:p}}parameters(){const{dModel:e,dState:r,dConv:i}=this.config,t=this.dInner,n=r,a=i,u=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*t*e,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*t,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:t*a,name:"wConv"},{buf:this.gpuWeights.bConv,numel:t,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(u+2*n)*t,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:u+2*n,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:t*u,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:t,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:t*n,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:t,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*t,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:e,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const Le=`
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
`,$r=`
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
`;class Be{layerType="mamba2";device;config;dInner;dHead;gpuWeights;pipelines;_wslaMode=!1;constructor(e,r){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...r};const{dModel:i,expand:t,nHeads:n}=this.config;if(this.dInner=t*i,this.dHead=this.dInner/n,this.dInner%n!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${n}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:r,dConv:i,nHeads:t,nGroups:n}=this.config,a=this.dInner,u=r,s=i,h=t,l=n,c=(_,w=.02)=>ot(_,w),d=_=>new Float32Array(_),f=_=>new Float32Array(_).fill(1),p=a+2*l*u+h,g=_=>J(this.device,_,!0);this.gpuWeights={wInProj:g(c(p*e)),wConv:g(c((a+2*l*u)*s,.01)),bConv:g(d(a+2*l*u)),A_log:g(new Float32Array(h).fill(Math.log(1))),dt_bias:g(d(h)),D_vec:g(f(h)),wOutProj:g(c(e*a,.02)),normWeight:g(f(a)),preNormWeight:g(f(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:z(e,dt,"linear_forward"),conv1d:z(e,wt,"conv1d_forward"),colSlice:z(e,_t,gt),rmsnorm:z(e,rt,"rmsnorm_forward"),ssd_fwd:z(e,Le,"ssd_chunk_forward"),elAdd:z(e,De,"main")}}forward(e,r,i){const t=this.device,{dModel:n,dState:a,dConv:u,nHeads:s,nGroups:h,chunkLen:l}=this.config,c=this.dInner,d=a,f=u,p=s,g=h,_=this.dHead,w=r,y=i,b=w*y,v=c+2*g*d,P=Math.ceil(y/l),B=D(t,b*n*4,!0),F=D(t,b*4,!0);{const C=new ArrayBuffer(16);new Uint32Array(C,0,2).set([b,n]),new Float32Array(C,8,1).set([1e-6]);const M=E(t,C),U=j(t,this.pipelines.rmsnorm,[M,e,this.gpuWeights.preNormWeight,B,F]);T(t,this.pipelines.rmsnorm,U,[N(b,64),1,1])}F.destroy();const k=c+2*g*d+p,W=D(t,b*k*4,!0);{const C=new Uint32Array([b,n,k]).buffer,M=E(t,C),U=J(t,new Float32Array(k),!0),Q=j(t,this.pipelines.linear,[M,B,this.gpuWeights.wInProj,U,W]);T(t,this.pipelines.linear,Q,[N(b,16),N(k,16),1]),U.destroy()}B.destroy();const S=D(t,b*v*4,!0),O=D(t,b*p*4,!0);{const C=this.pipelines.colSlice,M=v+p;Y(t,C,W,S,b,M,0,v),Y(t,C,W,O,b,M,v,p)}W.destroy();const K=D(t,b*v*4,!0);{const C=new Uint32Array([y,v,f,w,1]).buffer,M=E(t,C),U=j(t,this.pipelines.conv1d,[M,S,this.gpuWeights.wConv,this.gpuWeights.bConv,K]);T(t,this.pipelines.conv1d,U,[N(y,16),N(v,16),w])}S.destroy();const $=D(t,b*c*4,!0),R=D(t,b*g*d*4,!0),G=D(t,b*g*d*4,!0);{const C=this.pipelines.colSlice;Y(t,C,K,$,b,v,0,c),Y(t,C,K,R,b,v,c,g*d),Y(t,C,K,G,b,v,c+g*d,g*d)}K.destroy();const A=D(t,(P+1)*w*p*d*_*4,!0),m=D(t,b*c*4,!0);{const C=new Uint32Array([y,c,p,_,g,d,l,P,w]).buffer,M=E(t,C),U=j(t,this.pipelines.ssd_fwd,[M,$,R,G,O,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,m,A]);T(t,this.pipelines.ssd_fwd,U,[P,p,w])}$.destroy(),R.destroy(),G.destroy(),O.destroy();const x=D(t,b*c*4,!0),L=D(t,b*4,!0);{const C=new ArrayBuffer(16);new Uint32Array(C,0,2).set([b,c]),new Float32Array(C,8,1).set([1e-6]);const M=E(t,C),U=j(t,this.pipelines.rmsnorm,[M,m,this.gpuWeights.normWeight,x,L]);T(t,this.pipelines.rmsnorm,U,[N(b,64),1,1])}m.destroy(),L.destroy();const H=D(t,b*n*4,!0);{const C=new Uint32Array([b,c,n]).buffer,M=E(t,C),U=J(t,new Float32Array(n),!0),Q=j(t,this.pipelines.linear,[M,x,this.gpuWeights.wOutProj,U,H]);T(t,this.pipelines.linear,Q,[N(b,16),N(n,16),1]),U.destroy()}x.destroy();const q=D(t,b*n*4,!0);{const C=E(t,new Uint32Array([b*n]).buffer),M=j(t,this.pipelines.elAdd,[H,e,q,C]);T(t,this.pipelines.elAdd,M,[N(b*n,256),1,1])}return H.destroy(),{output:q,cache:{stateCarry:A}}}parameters(){const{dModel:e,dState:r,dConv:i,nHeads:t,nGroups:n}=this.config,a=this.dInner,u=r,s=i,h=t,l=n,c=a+2*l*u;return[{buf:this.gpuWeights.wInProj,numel:(a+2*l*u+h)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:c*s,name:"wConv"},{buf:this.gpuWeights.bConv,numel:c,name:"bConv"},{buf:this.gpuWeights.A_log,numel:h,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:h,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:h,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*a,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:a,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const Pe=`
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
`,Ur=`
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
`;class We{layerType="mamba3";device;config;dInner;dHead;nComplex;gpuWeights;pipelines;_wslaMode=!1;constructor(e,r){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...r};const{dModel:i,expand:t,nHeads:n}=this.config;if(this.dInner=t*i,this.dHead=this.dInner/n,this.nComplex=this.config.dState,this.dInner%n!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${n}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dConv:r,nHeads:i,nGroups:t}=this.config,n=this.dInner,a=this.nComplex,u=r,s=i,h=t,l=n+2*h*a*2,c=(w,y=.02)=>ot(w,y),d=w=>new Float32Array(w),f=w=>new Float32Array(w).fill(1),p=new Float32Array(s*2);for(let w=0;w<s;w++)p[w*2+0]=0,p[w*2+1]=2*Math.PI*w/s;const g=w=>J(this.device,w,!0),_=n+2*h*a*2+s;this.gpuWeights={wInProj:g(c(_*e)),wConv:g(c(l*u,.01)),bConv:g(d(l)),A_log:g(p),dt_bias:g(d(s)),D_vec:g(f(s)),wOutProj:g(c(e*n,.02)),normWeight:g(f(n)),preNormWeight:g(f(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:z(e,dt,"linear_forward"),conv1d:z(e,wt,"conv1d_forward"),colSlice:z(e,_t,gt),rmsnorm:z(e,rt,"rmsnorm_forward"),cssd_fwd:z(e,Pe,"complex_ssd_forward"),elAdd:z(e,Me,"main")}}forward(e,r,i){const t=this.device,{dModel:n,dConv:a,nHeads:u,nGroups:s,chunkLen:h}=this.config,l=this.dInner,c=this.nComplex,d=a,f=u,p=s,g=this.dHead,_=r,w=i,y=_*w,b=l+2*p*c*2,v=Math.ceil(w/h),P=D(t,y*n*4,!0),B=D(t,y*4,!0);{const I=new ArrayBuffer(16);new Uint32Array(I,0,2).set([y,n]),new Float32Array(I,8,1).set([1e-6]);const C=E(t,I),M=j(t,this.pipelines.rmsnorm,[C,e,this.gpuWeights.preNormWeight,P,B]);T(t,this.pipelines.rmsnorm,M,[N(y,64),1,1])}B.destroy();const F=l+2*p*c*2+f,k=D(t,y*F*4,!0);{const I=new Uint32Array([y,n,F]).buffer,C=E(t,I),M=J(t,new Float32Array(F),!0),U=j(t,this.pipelines.linear,[C,P,this.gpuWeights.wInProj,M,k]);T(t,this.pipelines.linear,U,[N(y,16),N(F,16),1]),M.destroy()}P.destroy();const W=D(t,y*b*4,!0),S=D(t,y*f*4,!0);{const I=this.pipelines.colSlice,C=b+f;Y(t,I,k,W,y,C,0,b),Y(t,I,k,S,y,C,b,f)}k.destroy();const O=D(t,y*b*4,!0);{const I=new Uint32Array([w,b,d,_,1]).buffer,C=E(t,I),M=j(t,this.pipelines.conv1d,[C,W,this.gpuWeights.wConv,this.gpuWeights.bConv,O]);T(t,this.pipelines.conv1d,M,[N(w,16),N(b,16),_])}W.destroy();const K=D(t,y*l*4,!0),$=D(t,y*p*c*2*4,!0),R=D(t,y*p*c*2*4,!0);{const I=this.pipelines.colSlice;Y(t,I,O,K,y,b,0,l),Y(t,I,O,$,y,b,l,p*c*2),Y(t,I,O,R,y,b,l+p*c*2,p*c*2)}O.destroy();const G=D(t,(v+1)*_*f*c*2*g*4,!0),A=D(t,y*l*4,!0);{const I=new Uint32Array([w,l,f,g,p,c,h,v,_]).buffer,C=E(t,I),M=j(t,this.pipelines.cssd_fwd,[C,K,$,R,S,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,A,G]);T(t,this.pipelines.cssd_fwd,M,[v,f,_])}K.destroy(),$.destroy(),R.destroy(),S.destroy();const m=D(t,y*l*4,!0),x=D(t,y*4,!0);{const I=new ArrayBuffer(16);new Uint32Array(I,0,2).set([y,l]),new Float32Array(I,8,1).set([1e-6]);const C=E(t,I),M=j(t,this.pipelines.rmsnorm,[C,A,this.gpuWeights.normWeight,m,x]);T(t,this.pipelines.rmsnorm,M,[N(y,64),1,1])}A.destroy(),x.destroy();const L=D(t,y*n*4,!0);{const I=new Uint32Array([y,l,n]).buffer,C=E(t,I),M=J(t,new Float32Array(n),!0),U=j(t,this.pipelines.linear,[C,m,this.gpuWeights.wOutProj,M,L]);T(t,this.pipelines.linear,U,[N(y,16),N(n,16),1]),M.destroy()}m.destroy();const H=D(t,y*n*4,!0);{const I=E(t,new Uint32Array([y*n]).buffer),C=j(t,this.pipelines.elAdd,[L,e,H,I]);T(t,this.pipelines.elAdd,C,[N(y*n,256),1,1])}return L.destroy(),{output:H,cache:{stateCarry:G}}}parameters(){const{dModel:e,dConv:r,nHeads:i,nGroups:t}=this.config,n=this.dInner,a=this.nComplex,u=r,s=i,h=t,l=n+2*h*a*2;return[{buf:this.gpuWeights.wInProj,numel:(n+2*h*a*2+s)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:l*u,name:"wConv"},{buf:this.gpuWeights.bConv,numel:l,name:"bConv"},{buf:this.gpuWeights.A_log,numel:s*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:s,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:s,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*n,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:n,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const Ne=`
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
`,Pt=`
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
`,qr=`
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
`,Ce=`
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
`;class Fe{layerType="attention";device;config;dHead;gpuWeights;pipelines;constructor(e,r){if(this.device=e,r.dModel%r.nHeads!==0)throw new Error(`AttentionBlock: dModel (${r.dModel}) must be divisible by nHeads (${r.nHeads}).`);this.config={dHead:r.dModel/r.nHeads,hasFfn:!1,ffnMult:4,...r},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,hasFfn:r,ffnMult:i}=this.config,t=(s,h=.02)=>ot(s,h),n=s=>new Float32Array(s),a=s=>new Float32Array(s).fill(1),u=s=>J(this.device,s,!0);if(this.gpuWeights={wQKV:u(t(3*e*e)),bQKV:u(n(3*e)),wO:u(t(e*e)),bO:u(n(e)),normWeight:u(a(e))},r){const s=e*i;this.gpuWeights.wFfn1=u(t(s*e)),this.gpuWeights.bFfn1=u(n(s)),this.gpuWeights.wFfn2=u(t(e*s)),this.gpuWeights.bFfn2=u(n(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:z(e,dt,"linear_forward"),rmsnorm:z(e,rt,"rmsnorm_forward"),attn_fwd:z(e,Pt,"attention_forward"),attn_val:z(e,Pt,"attention_value"),softmax:z(e,Ne,"softmax_forward"),colSlice:z(e,_t,gt),elAdd:z(e,Se,"main")},this.config.hasFfn&&(this.pipelines.silu=z(e,Ce,"silu_forward"))}forward(e,r,i){const t=this.device,{dModel:n,nHeads:a,hasFfn:u}=this.config,s=this.dHead,h=r,l=i,c=h*l,d=a,f=D(t,c*n*4,!0),p=D(t,c*4,!0);{const k=new ArrayBuffer(16);new Uint32Array(k,0,2).set([c,n]),new Float32Array(k,8,1).set([1e-6]);const W=E(t,k),S=j(t,this.pipelines.rmsnorm,[W,e,this.gpuWeights.normWeight,f,p]);T(t,this.pipelines.rmsnorm,S,[N(c,64),1,1])}p.destroy();const g=D(t,c*3*n*4,!0);{const k=new Uint32Array([c,n,3*n]).buffer,W=E(t,k),S=j(t,this.pipelines.linear,[W,f,this.gpuWeights.wQKV,this.gpuWeights.bQKV,g]);T(t,this.pipelines.linear,S,[N(c,16),N(3*n,16),1])}f.destroy();const _=D(t,c*n*4,!0),w=D(t,c*n*4,!0),y=D(t,c*n*4,!0);{const k=this.pipelines.colSlice;Y(t,k,g,_,c,3*n,0,n),Y(t,k,g,w,c,3*n,n,n),Y(t,k,g,y,c,3*n,2*n,n)}g.destroy();const b=D(t,h*d*l*l*4,!0);{const k=new Uint32Array([h,l,n,d,s]).buffer,W=E(t,k),S=j(t,this.pipelines.attn_fwd,[W,_,w,y,b,D(t,c*n*4,!0)]);T(t,this.pipelines.attn_fwd,S,[N(l,16),d,h])}{const k=new Uint32Array([l,l,1]).buffer,W=E(t,k),S=j(t,this.pipelines.softmax,[W,b]);T(t,this.pipelines.softmax,S,[l,d,h])}const v=D(t,c*n*4,!0);{const k=new Uint32Array([h,l,n,d,s]).buffer,W=E(t,k),S=j(t,this.pipelines.attn_val,[W,_,w,y,b,v]);T(t,this.pipelines.attn_val,S,[N(l,16),d,h])}_.destroy(),w.destroy(),y.destroy();const P=D(t,c*n*4,!0);{const k=new Uint32Array([c,n,n]).buffer,W=E(t,k),S=j(t,this.pipelines.linear,[W,v,this.gpuWeights.wO,this.gpuWeights.bO,P]);T(t,this.pipelines.linear,S,[N(c,16),N(n,16),1])}v.destroy();let B=D(t,c*n*4,!0);{const k=E(t,new Uint32Array([c*n]).buffer),W=j(t,this.pipelines.elAdd,[P,e,B,k]);T(t,this.pipelines.elAdd,W,[N(c*n,256),1,1])}if(P.destroy(),u){const{ffnMult:k}=this.config,W=n*k,S=D(t,c*W*4,!0);{const R=new Uint32Array([c,n,W]).buffer,G=E(t,R),A=j(t,this.pipelines.linear,[G,B,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,S]);T(t,this.pipelines.linear,A,[N(c,16),N(W,16),1])}const O=D(t,c*W*4,!0);{const R=E(t,new Uint32Array([c*W]).buffer),G=j(t,this.pipelines.silu,[R,S,O]);T(t,this.pipelines.silu,G,[N(c*W,256),1,1])}S.destroy();const K=D(t,c*n*4,!0);{const R=new Uint32Array([c,W,n]).buffer,G=E(t,R),A=j(t,this.pipelines.linear,[G,O,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,K]);T(t,this.pipelines.linear,A,[N(c,16),N(n,16),1])}O.destroy();const $=D(t,c*n*4,!0);{const R=E(t,new Uint32Array([c*n]).buffer),G=j(t,this.pipelines.elAdd,[K,B,$,R]);T(t,this.pipelines.elAdd,G,[N(c*n,256),1,1])}K.destroy(),B.destroy(),B=$}return{output:B,cache:{scores:b}}}parameters(){const{dModel:e,hasFfn:r,ffnMult:i}=this.config,t=[{buf:this.gpuWeights.wQKV,numel:3*e*e,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*e,name:"bQKV"},{buf:this.gpuWeights.wO,numel:e*e,name:"wO"},{buf:this.gpuWeights.bO,numel:e,name:"bO"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}];if(r){const n=e*i;t.push({buf:this.gpuWeights.wFfn1,numel:n*e,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:n,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:e*n,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:e,name:"bFfn2"})}return t}getTrainableParams(){return this.parameters()}setWSLAMode(e){}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const Mt=1296190035,Ie={mamba1:0,mamba2:1,mamba3:2,attention:3},je=["mamba1","mamba2","mamba3","attention"];class Te{device;config;gpuEmbedding;layers;layerSpecs;gpuFinalNorm;tiedEmbedding;gpuLMHeadBias;_lmHeadPipeline;_rmsnormPipeline;_embedPipeline;_wslaMode=!1;constructor(e,r){this.device=e,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...r},At(this.config.seed);const i=r.layers??Array.from({length:r.numLayers},()=>({type:"mamba1"}));if(i.length!==r.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${i.length}) must equal numLayers (${r.numLayers}).`);this.layerSpecs=i;const{vocabSize:t,dModel:n}=this.config,a=ot(t*n,1/Math.sqrt(n));this.gpuEmbedding=J(e,a,!0),this.layers=i.map(u=>this._buildLayer(u)),At(void 0),this.gpuFinalNorm=J(e,new Float32Array(n).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=J(e,new Float32Array(t),!0),this._lmHeadPipeline=z(e,dt,"linear_forward"),this._rmsnormPipeline=z(e,rt,"rmsnorm_forward"),this._embedPipeline=z(e,Ee,"embed_lookup")}_buildLayer(e){const r=this.config;switch(e.type){case"mamba1":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,...r.defaultMamba1};return new ke(this.device,{...i,...e.config??{}})}case"mamba2":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,nHeads:r.nHeads,nGroups:r.nGroups,chunkLen:r.chunkLen,...r.defaultMamba2};return new Be(this.device,{...i,...e.config??{}})}case"mamba3":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,nHeads:r.nHeads,nGroups:r.nGroups,chunkLen:r.chunkLen,mimoGroup:r.mimoGroup,...r.defaultMamba3};return new We(this.device,{...i,...e.config??{}})}case"attention":{const i={dModel:r.dModel,nHeads:r.nHeads,...r.defaultAttention};return new Fe(this.device,{...i,...e.config??{}})}}}embedTokens(e,r,i){const{dModel:t}=this.config,n=r*i,a=J(this.device,e instanceof Uint32Array?e:new Uint32Array(e),!1),u=D(this.device,n*t*4,!0),s=E(this.device,new Uint32Array([n,t]).buffer),h=j(this.device,this._embedPipeline,[s,a,this.gpuEmbedding,u]);return T(this.device,this._embedPipeline,h,[N(n,64),1,1]),a.destroy(),s.destroy(),u}async forward(e,r,i){const{dModel:t,vocabSize:n}=this.config,a=r*i;let u=this.embedTokens(e,r,i);const s=[];for(const f of this.layers){const{output:p,cache:g}=f.forward(u,r,i);s.push(g),u.destroy(),u=p}const h=D(this.device,a*t*4,!0),l=D(this.device,a*4,!1);{const f=new ArrayBuffer(16);new Uint32Array(f,0,2).set([a,t]),new Float32Array(f,8,1).set([1e-6]);const p=E(this.device,f),g=j(this.device,this._rmsnormPipeline,[p,u,this.gpuFinalNorm,h,l]);T(this.device,this._rmsnormPipeline,g,[N(a,64),1,1])}u.destroy();const c=D(this.device,a*n*4,!0);{const f=new Uint32Array([a,t,n]).buffer,p=E(this.device,f),g=j(this.device,this._lmHeadPipeline,[p,h,this.gpuEmbedding,this.gpuLMHeadBias,c]);T(this.device,this._lmHeadPipeline,g,[N(a,16),N(n,16),1])}return h.destroy(),l.destroy(),{logits:await it(this.device,c,a*n*4),gpuLogits:c,caches:s}}async embed(e){const{dModel:r}=this.config,i=e.length,t=1,n=t*i;if(n===0)return new Float32Array(r);let a=this.embedTokens(e,t,i);for(const d of this.layers){const{output:f}=d.forward(a,t,i);a.destroy(),a=f}const u=D(this.device,n*r*4,!0),s=D(this.device,n*4,!1);{const d=new ArrayBuffer(16);new Uint32Array(d,0,2).set([n,r]),new Float32Array(d,8,1).set([1e-6]);const f=E(this.device,d),p=j(this.device,this._rmsnormPipeline,[f,a,this.gpuFinalNorm,u,s]);T(this.device,this._rmsnormPipeline,p,[N(n,64),1,1])}a.destroy();const h=await it(this.device,u,n*r*4);u.destroy(),s.destroy();const l=new Float32Array(r);for(let d=0;d<i;d++){const f=d*r;for(let p=0;p<r;p++)l[p]+=h[f+p]}for(let d=0;d<r;d++)l[d]/=i;let c=0;for(let d=0;d<r;d++)c+=l[d]*l[d];c=Math.sqrt(c)||1;for(let d=0;d<r;d++)l[d]/=c;return l}async generate(e,r=200,i={}){const{temperature:t=1,topK:n=50,topP:a=.9}=i,{vocabSize:u}=this.config,s=[...e];for(let h=0;h<r;h++){const{logits:l}=await this.forward(new Uint32Array(s),1,s.length),c=l.slice((s.length-1)*u,s.length*u),d=He(c,{temperature:t,topK:n,topP:a});if(s.push(d),d===this.config.eosId)break}return s}parameters(){const e=[];e.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let r=0;r<this.layers.length;r++)for(const i of this.layers[r].parameters())e.push({...i,name:`layer${r}.${i.name}`});return e.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),e}getTrainableParams(){if(!this._wslaMode)return this.parameters();const e=[];for(let r=0;r<this.layers.length;r++)for(const i of this.layers[r].getTrainableParams())e.push({...i,name:`layer${r}.${i.name}`});return e}setWSLAMode(e){for(const r of this.layers)r.setWSLAMode(e);this._wslaMode=e}async exportWeights(e={}){const r=e.fp16??!1,i=this.parameters(),t=i.length,n=this.layers.length,a=await Promise.all(i.map(g=>it(this.device,g.buf,g.numel*4))),u=Math.ceil(n/4)*4,s=12+u+4+t*4,h=r?2:4,c=a.reduce((g,_)=>g+_.length,0)*h,d=new ArrayBuffer(s+c),f=new DataView(d);let p=0;f.setUint32(p,Mt,!0),p+=4,f.setUint32(p,r?3:2,!0),p+=4,f.setUint32(p,n,!0),p+=4;for(let g=0;g<n;g++){const _=this.layers[g].layerType;f.setUint8(p+g,Ie[_])}p+=u,f.setUint32(p,t,!0),p+=4;for(const g of i)f.setUint32(p,g.numel,!0),p+=4;if(r)for(const g of a){const _=zt(g);new Uint16Array(d,p,_.length).set(_),p+=_.length*2}else for(const g of a)new Float32Array(d,p,g.length).set(g),p+=g.byteLength;return ne(d)}async loadWeights(e){const r=ie(e);if(r.hasTrailer&&!r.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const i=new DataView(e);let t=0;const n=i.getUint32(t,!0);if(t+=4,n!==Mt)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const a=i.getUint32(t,!0);if(t+=4,a===1){const u=i.getUint32(t,!0);t+=4;const s=this.parameters();if(u!==s.length)throw new Error(`Weight file has ${u} parameters but this model has ${s.length}.`);const h=[];for(let l=0;l<u;l++)h.push(i.getUint32(t,!0)),t+=4;for(let l=0;l<u;l++){const c=s[l],d=h[l];if(d!==c.numel)throw new Error(`Parameter ${l} ("${c.name}") size mismatch: file=${d}, model=${c.numel}.`);st(this.device,c.buf,new Float32Array(e,t,c.numel)),t+=c.numel*4}return}if(a===2||a===3){const u=a===3,s=i.getUint32(t,!0);if(t+=4,s!==this.layers.length)throw new Error(`Weight file has ${s} layers but this model has ${this.layers.length}.`);for(let f=0;f<s;f++){const p=i.getUint8(t+f),g=this.layers[f].layerType,_=je[p]??"mamba1";if(_!==g)throw new Error(`Layer ${f} type mismatch: file="${_}", model="${g}".`)}const h=Math.ceil(s/4)*4;t+=h;const l=i.getUint32(t,!0);t+=4;const c=this.parameters();if(l!==c.length)throw new Error(`Weight file has ${l} parameters but this model has ${c.length}.`);const d=[];for(let f=0;f<l;f++)d.push(i.getUint32(t,!0)),t+=4;for(let f=0;f<l;f++){const p=c[f],g=d[f];if(g!==p.numel)throw new Error(`Parameter ${f} ("${p.name}") size mismatch: file=${g}, model=${p.numel}.`);if(u){const _=new Uint16Array(e,t,g);st(this.device,p.buf,Ot(_)),t+=g*2}else st(this.device,p.buf,new Float32Array(e,t,p.numel)),t+=g*4}return}throw new Error(`Unsupported MBJS version: ${a}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const e of this.layers)e.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class Xr extends Te{constructor(e,r){super(e,{...r,layers:Array.from({length:r.numLayers},()=>({type:"mamba1"}))})}}const Ee=`
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
`;function He(o,{temperature:e=1,topK:r=50,topP:i=.9}={}){const t=o.length,n=new Float32Array(t);for(let _=0;_<t;_++)n[_]=o[_]/Math.max(e,1e-7);let a=-1/0;for(let _=0;_<t;_++)n[_]>a&&(a=n[_]);let u=0;const s=new Float32Array(t);for(let _=0;_<t;_++)s[_]=Math.exp(n[_]-a),u+=s[_];const l=Array.from({length:t},(_,w)=>w).sort((_,w)=>s[w]-s[_]).slice(0,r);let c=0;const d=[];for(const _ of l)if(c+=s[_]/u,d.push(_),c>=i)break;let f=0;for(const _ of d)f+=s[_];const p=Math.random()*f;let g=0;for(const _ of d)if(g+=s[_],g>=p)return _;return d[d.length-1]}class Vr{model;adam;opt;constructor(e,r={}){this.model=e,this.opt={lr:r.lr??.01,beta1:r.beta1??.9,beta2:r.beta2??.999,eps:r.eps??1e-8,weightDecay:r.weightDecay??0,auxWeight:r.auxWeight??.01,batchSize:r.batchSize??0,epochs:r.epochs??1},this.adam=new se(e,this.opt)}fit(e){const r=[];for(let i=0;i<this.opt.epochs;i++)r.push(this.runEpoch(e));return r}runEpoch(e){const r=this.opt.batchSize>0?this.opt.batchSize:e.length,{numExperts:i,modelDim:t}=this.model.config;let n=0,a=0;for(let u=0;u<e.length;u+=r){const s=e.slice(u,u+r);this.model.zeroGrad();const h=[],l=[],c=new ue(i);let d=0;for(const g of s){const _=this.model.forward(g.input),w=new Float32Array(t);for(let y=0;y<t;y++){const b=_.output[y]-(g.target[y]??0);w[y]=b,d+=.5*b*b}this.model.backward(w,_.cache),h.push(_.cache.x),l.push(_.route.probs),c.observe(_.route)}const f=c.dispatchFractions(),p=this.opt.auxWeight*i/s.length;for(let g=0;g<h.length;g++)this.model.auxGradStep(h[g],l[g],f,p);this.scaleGradients(1/s.length),this.adam.step(),n+=d,a=c.loss()}return{loss:n/Math.max(1,e.length),auxLoss:a}}scaleGradients(e){if(e!==1)for(const r of this.model.gradients())for(let i=0;i<r.data.length;i++)r.data[i]=r.data[i]*e}}const Re=Math.LN2;function ze(o,e){const r=o.length,i=Math.max(1,Math.min(e,r)),t=[],n=new Uint8Array(r);for(let a=0;a<i;a++){let u=-1,s=-1/0;for(let h=0;h<r;h++){if(n[h])continue;const l=o[h];l>s&&(s=l,u=h)}if(u<0)break;n[u]=1,t.push(u)}return t}function Oe(o){let e=0,r=-1/0;for(let i=0;i<o.length;i++)o[i]>r&&(r=o[i],e=i);return e}function Ke(o){return Math.exp(o)}function Ge(o){return o/Re}function $t(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function Ut(o,e,r,i){const t=Math.min(e.length,r.length);for(let n=0;n<t;n++){const a=r[n],u=e[n];a<0||a>=u.length||(o.ceSum+=ht(u,a),Oe(u)===a&&o.top1Hits++,ze(u,i).includes(a)&&o.topKHits++,o.tokens++)}}function qt(){const o=globalThis;return typeof o.performance?.now=="function"?o.performance.now():Date.now()}function Xt(o){return o.slice(1)}function Vt(o,e,r,i){const t=o.tokens>0?o.ceSum/o.tokens:0,n={sequences:e,tokens:o.tokens,crossEntropy:t,perplexity:Ke(t),bitsPerToken:Ge(t),top1Accuracy:o.tokens>0?o.top1Hits/o.tokens:0,topKAccuracy:o.tokens>0?o.topKHits/o.tokens:0,topK:r};return i!==void 0&&(n.elapsedMs=i,n.tokensPerSecond=i>0?o.tokens/i*1e3:0),n}function ut(o,e,r={}){const i=r.topK??5,t=r.measureLatency??!0,n=r.now??qt,a=$t();let u=0,s=0;for(const h of e){if(h.length<2)continue;const l=t?n():0,{logits:c}=o.forward(h);t&&(s+=n()-l),Ut(a,c,Xt(h),i),u++}return Vt(a,u,i,t?s:void 0)}async function Yr(o,e,r={}){const i=r.topK??5,t=r.measureLatency??!0,n=r.now??qt,a=$t();let u=0,s=0;for(const h of e){if(h.length<2)continue;const l=t?n():0,{logits:c}=await o.forward(h);t&&(s+=n()-l),Ut(a,c,Xt(h),i),u++}return Vt(a,u,i,t?s:void 0)}function Qr(o,e,r,i={}){return $e(ut(o,r,i),ut(e,r,i))}function $e(o,e){const r=o.perplexity-e.perplexity,i=e.perplexity>0?o.perplexity/e.perplexity:1/0,t=o.top1Accuracy-e.top1Accuracy,n=.005;let a;Math.abs(i-1)<=n?a="tie":a=r<0?"candidate":"baseline";const u=((1-i)*100).toFixed(1),s=a==="tie"?`Tie: perplexity ${o.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)}`:a==="candidate"?`Candidate wins: ${u}% lower perplexity (${o.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(u)).toFixed(1)}% higher perplexity (${o.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`;return{candidate:o,baseline:e,perplexityDelta:r,perplexityRatio:i,top1Delta:t,winner:a,summary:s}}function Yt(o,e){return o.split(/(?<=\.)\s+/).map(r=>e.encode(r.trim())).filter(r=>r.length>=2)}function Jr(o,e,r,i={}){return ut(o,Yt(r,e),i)}function Ue(o,e){for(let r=o.length-1;r>0;r--){const i=Math.floor(e.next()*(r+1)),t=o[r];o[r]=o[i],o[i]=t}return o}function Zr(o,e={}){const r=e.seed??7,i=new oe;i.train(o,{numMerges:e.numMerges??100});const t=Yt(o,i);if(t.length<2)throw new Error(`corpus produced ${t.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const n=Ue([...t],new Tt(r>>>0||1)),a=Math.min(.9,Math.max(.05,e.heldOutRatio??.25));let u=Math.round(n.length*a);u=Math.max(1,Math.min(n.length-1,u));const s=n.slice(0,u),h=n.slice(u),l=new he({vocabSize:i.vocabSize,dModel:e.dModel??32,numLayers:e.numLayers??2,hiddenDim:e.hiddenDim??48,seed:r}),c=e.epochs??30,d=new _e(l,{lr:e.lr??.03,epochs:c}).fit(h),f=ut(l,s,{topK:e.topK??5,measureLatency:!0}),p=l.generateText(e.prompt??"The",i,{maxNewTokens:8,temperature:0});return{...f,trainSequences:h.length,evalSequences:s.length,initialTrainLoss:d[0]??0,finalTrainLoss:d.at(-1)??0,vocabSize:i.vocabSize,sample:p}}const vt=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],Qt=-10,Jt=5;function qe(o){const{dModel:e,dState:r,dConv:i,dInner:t,dtRank:n}=o;return{wInProj:new Float32Array(2*t*e),bInProj:new Float32Array(2*t),wConv:new Float32Array(t*i),bConv:new Float32Array(t),wXProj:new Float32Array((n+2*r)*t),bXProj:new Float32Array(n+2*r),wDtProj:new Float32Array(t*n),bDtProj:new Float32Array(t),A_log:new Float32Array(t*r),D_vec:new Float32Array(t),wOutProj:new Float32Array(e*t),bOutProj:new Float32Array(e),normWeight:new Float32Array(e)}}function Zt(o,e,r){const{dModel:i,dState:t,dConv:n,dInner:a,dtRank:u,batch:s,seqLen:h}=r,l=s*h,c=u+2*t,d=new Float32Array(l*i),f=new Float32Array(l);Rt(o,e.normWeight,l,i,d,f);const p=new Float32Array(l*2*a);nt(d,e.wInProj,e.bInProj,l,i,2*a,p);const g=new Float32Array(l*a),_=new Float32Array(l*a);for(let m=0;m<l;m++)for(let x=0;x<a;x++)g[m*a+x]=p[m*2*a+x],_[m*a+x]=p[m*2*a+a+x];const w=new Float32Array(l*a);for(let m=0;m<s;m++)for(let x=0;x<h;x++){const L=(m*h+x)*a;for(let H=0;H<a;H++){let q=e.bConv[H];for(let I=0;I<n;I++)x>=I&&(q+=e.wConv[H*n+I]*g[(m*h+x-I)*a+H]);w[L+H]=q}}const y=new Float32Array(l*a);for(let m=0;m<l*a;m++)y[m]=Lt(w[m]);const b=new Float32Array(l*c);nt(y,e.wXProj,e.bXProj,l,a,c,b);const v=new Float32Array(l*u),P=new Float32Array(l*t),B=new Float32Array(l*t);for(let m=0;m<l;m++){for(let x=0;x<u;x++)v[m*u+x]=b[m*c+x];for(let x=0;x<t;x++)P[m*t+x]=b[m*c+u+x],B[m*t+x]=b[m*c+u+t+x]}const F=new Float32Array(l*a);nt(v,e.wDtProj,e.bDtProj,l,u,a,F);const k=new Float32Array(l*a);for(let m=0;m<l*a;m++)k[m]=de(F[m]);const W=new Float32Array(a*t);for(let m=0;m<a*t;m++)W[m]=-Math.exp(Math.min(Jt,Math.max(Qt,e.A_log[m])));const S=new Float32Array(l*a*t),O=new Float32Array(l*a*t),K=new Float32Array(l*a*t),$=new Float32Array(l*a);for(let m=0;m<s;m++)for(let x=0;x<h;x++){const L=m*h+x;for(let H=0;H<a;H++){const q=k[L*a+H],I=y[L*a+H];let C=e.D_vec[H]*I;for(let M=0;M<t;M++){const U=W[H*t+M],Q=Math.exp(q*U),X=(Q-1)/U*P[L*t+M],V=(L*a+H)*t+M;S[V]=Q,O[V]=X;const tt=x===0?0:K[((L-1)*a+H)*t+M],et=Q*tt+X*I;K[V]=et,C+=B[L*t+M]*et}$[L*a+H]=C}}const R=new Float32Array(l*a),G=new Float32Array(l*a);for(let m=0;m<l*a;m++)R[m]=Lt(_[m]),G[m]=$[m]*R[m];const A=new Float32Array(l*i);nt(G,e.wOutProj,e.bOutProj,l,a,i,A);for(let m=0;m<l*i;m++)A[m]=A[m]+o[m];return{output:A,cache:{x:o,normInv:f,normOut:d,xConvIn:g,z:_,convOut:w,u:y,dtRaw:v,bRaw:P,cRaw:B,deltaFull:F,dv:k,aCont:W,aBar:S,bBar:O,h:K,scanY:$,siluZ:R,gated:G}}}function Xe(o,e,r,i,t){const{dModel:n,dState:a,dConv:u,dInner:s,dtRank:h,batch:l,seqLen:c}=i,d=l*c,f=h+2*a,p=new Float32Array(d*n);p.set(o);const g=new Float32Array(d*s);ct(o,r.gated,e.wOutProj,d,s,n,g,t.wOutProj,t.bOutProj);const _=new Float32Array(d*s),w=new Float32Array(d*s);for(let A=0;A<d*s;A++)_[A]=g[A]*r.siluZ[A],w[A]=g[A]*r.scanY[A]*kt(r.z[A]);const y=new Float32Array(d*s),b=new Float32Array(d*a),v=new Float32Array(d*a),P=new Float32Array(d*s),B=new Float32Array(s*a),F=new Float32Array(s*a);for(let A=0;A<l;A++){F.fill(0);for(let m=c-1;m>=0;m--){const x=A*c+m;for(let L=0;L<s;L++){const H=_[x*s+L],q=r.u[x*s+L],I=r.dv[x*s+L];t.D_vec[L]=t.D_vec[L]+H*q,y[x*s+L]=y[x*s+L]+H*e.D_vec[L];let C=0;for(let M=0;M<a;M++){const U=(x*s+L)*a+M,Q=r.h[U],X=r.aBar[U],V=r.bBar[U],tt=r.aCont[L*a+M],et=r.cRaw[x*a+M];v[x*a+M]=v[x*a+M]+H*Q;const lt=H*et+F[L*a+M],ae=m===0?0:r.h[((x-1)*s+L)*a+M],yt=lt*ae,pt=lt*q;y[x*s+L]=y[x*s+L]+lt*V,F[L*a+M]=lt*X;const xt=r.bRaw[x*a+M];C+=yt*tt*X+pt*X*xt,B[L*a+M]=B[L*a+M]+yt*I*X+pt*xt*((I*X*tt-(X-1))/(tt*tt)),b[x*a+M]=b[x*a+M]+pt*((X-1)/tt)}P[x*s+L]=P[x*s+L]+C}}}for(let A=0;A<s*a;A++){const m=e.A_log[A];m<=Qt||m>=Jt||(t.A_log[A]=t.A_log[A]+B[A]*r.aCont[A])}const k=new Float32Array(d*s);for(let A=0;A<d*s;A++)k[A]=P[A]*Et(r.deltaFull[A]);const W=new Float32Array(d*h);ct(k,r.dtRaw,e.wDtProj,d,h,s,W,t.wDtProj,t.bDtProj);const S=new Float32Array(d*f);for(let A=0;A<d;A++){for(let m=0;m<h;m++)S[A*f+m]=W[A*h+m];for(let m=0;m<a;m++)S[A*f+h+m]=b[A*a+m],S[A*f+h+a+m]=v[A*a+m]}const O=new Float32Array(d*s);ct(S,r.u,e.wXProj,d,s,f,O,t.wXProj,t.bXProj);for(let A=0;A<d*s;A++)y[A]=y[A]+O[A];const K=new Float32Array(d*s);for(let A=0;A<d*s;A++)K[A]=y[A]*kt(r.convOut[A]);const $=new Float32Array(d*s);for(let A=0;A<l;A++)for(let m=0;m<c;m++){const x=A*c+m;for(let L=0;L<s;L++){const H=K[x*s+L];if(H!==0){t.bConv[L]=t.bConv[L]+H;for(let q=0;q<u;q++){if(m<q)continue;const I=(A*c+m-q)*s+L;t.wConv[L*u+q]=t.wConv[L*u+q]+H*r.xConvIn[I],$[I]=$[I]+H*e.wConv[L*u+q]}}}}const R=new Float32Array(d*2*s);for(let A=0;A<d;A++)for(let m=0;m<s;m++)R[A*2*s+m]=$[A*s+m],R[A*2*s+s+m]=w[A*s+m];const G=new Float32Array(d*n);return ct(R,r.normOut,e.wInProj,d,n,2*s,G,t.wInProj,t.bInProj),Ht(G,r.x,e.normWeight,r.normInv,d,n,p,t.normWeight,bt),p}const Wt=["mamba1"];function Ve(o){const e={dModel:o.dModel,dState:o.dState,dConv:o.dConv,dInner:o.dInner,dtRank:o.dtRank};return{embedding:new Float32Array(o.vocabSize*o.dModel),finalNorm:new Float32Array(o.dModel),lmHeadBias:new Float32Array(o.vocabSize),layers:Array.from({length:o.numLayers},()=>qe(e))}}function Ye(o){const e=new Map;e.set("embedding",o.embedding);for(let r=0;r<o.layers.length;r++){const i=o.layers[r];for(const t of vt)e.set(`layer${r}.${t}`,i[t])}return e.set("final_norm",o.finalNorm),e.set("lm_head_bias",o.lmHeadBias),e}function Qe(o){const e=new Map;e.set("embedding",o.embedding);for(let r=0;r<o.layers.length;r++){const i=o.layers[r];for(const t of vt)e.set(`layer${r}.${t}`,i[t])}return e.set("final_norm",o.finalNorm),e.set("lm_head_bias",o.lmHeadBias),e}function Je(o,e){const r=(l,c)=>{const d=o.get(l);if(!d)throw new Error(`cpuWeightsFromNamed: missing tensor "${l}"`);if(d.length!==c)throw new Error(`cpuWeightsFromNamed: "${l}" has ${d.length} elements, expected ${c}`);return d},{dModel:i,dState:t,dConv:n,dInner:a,dtRank:u}=e,s={wInProj:2*a*i,bInProj:2*a,wConv:a*n,bConv:a,wXProj:(u+2*t)*a,bXProj:u+2*t,wDtProj:a*u,bDtProj:a,A_log:a*t,D_vec:a,wOutProj:i*a,bOutProj:i,normWeight:i},h=[];for(let l=0;l<e.numLayers;l++){const c={};for(const d of vt)c[d]=r(`layer${l}.${d}`,s[d]);h.push(c)}return{embedding:r("embedding",e.vocabSize*i),finalNorm:r("final_norm",i),lmHeadBias:r("lm_head_bias",e.vocabSize),layers:h}}function te(o,e,r,i,t,n=!1){const{vocabSize:a,dModel:u}=r,s=i*t;let h=new Float32Array(s*u);for(let _=0;_<s;_++){const w=o[_];if(w<0||w>=a)throw new Error(`token id ${w} out of range [0, ${a})`);h.set(e.embedding.subarray(w*u,(w+1)*u),_*u)}const l={dModel:u,dState:r.dState,dConv:r.dConv,dInner:r.dInner,dtRank:r.dtRank,batch:i,seqLen:t},c=[],d=[];for(let _=0;_<r.numLayers;_++){c.push(h);const{output:w,cache:y}=Zt(h,e.layers[_],l);n||d.push(y),h=w}const f=new Float32Array(s*u),p=new Float32Array(s);Rt(h,e.finalNorm,s,u,f,p,bt);const g=new Float32Array(s*a);return nt(f,e.embedding,e.lmHeadBias,s,u,a,g),{hiddenIn:c,layer:d,lastHidden:h,normOut:f,normInv:p,logits:g}}function Ze(o,e,r,i,t){return te(o,e,r,i,t).logits}function ta(o,e,r,i,t,n){const a=Ze(o,r,i,t,n),u=t*n,s=i.vocabSize;let h=0;for(let l=0;l<u;l++)h+=ht(a.subarray(l*s,(l+1)*s),e[l]);return h/u}function tr(o,e,r,i,t,n,a={}){const{vocabSize:u,dModel:s}=i,h=t*n,l=a.activationCheckpointing??!1,c=te(o,r,i,t,n,l),d=Ve(i);let f=0;const p=new Float32Array(h*u);for(let v=0;v<h;v++){const P=c.logits.subarray(v*u,(v+1)*u),B=e[v];f+=ht(P,B);const F=ge(P,B);for(let k=0;k<u;k++)p[v*u+k]=F[k]/h}const g=f/h,_=new Float32Array(h*s);for(let v=0;v<h;v++){const P=v*u,B=v*s;for(let F=0;F<u;F++){const k=p[P+F];if(k===0)continue;d.lmHeadBias[F]=d.lmHeadBias[F]+k;const W=F*s;for(let S=0;S<s;S++)_[B+S]=_[B+S]+k*r.embedding[W+S],d.embedding[W+S]=d.embedding[W+S]+k*c.normOut[B+S]}}const w=new Float32Array(h*s);Ht(_,c.lastHidden,r.finalNorm,c.normInv,h,s,w,d.finalNorm,bt);const y={dModel:s,dState:i.dState,dConv:i.dConv,dInner:i.dInner,dtRank:i.dtRank,batch:t,seqLen:n};let b=w;for(let v=i.numLayers-1;v>=0;v--){const P=l?Zt(c.hiddenIn[v],r.layers[v],y).cache:c.layer[v];b=Xe(b,r.layers[v],P,y,d.layers[v])}for(let v=0;v<h;v++){const B=o[v]*s,F=v*s;for(let k=0;k<s;k++)d.embedding[B+k]=d.embedding[B+k]+b[F+k]}return{loss:g,grads:Ye(d)}}function er(o,e){const{dModel:r,dState:i,dConv:t,dInner:n,dtRank:a}=e;if(o==="embedding")return[e.vocabSize,r];switch(o.startsWith("layer")?o.slice(o.indexOf(".")+1):o){case"wInProj":return[2*n,r];case"wConv":return[n,t];case"wXProj":return[a+2*i,n];case"wDtProj":return[n,a];case"A_log":return[n,i];case"wOutProj":return[r,n];default:return null}}const rr=["wInProj","wXProj","wDtProj","wOutProj"],ar=.05;class ea{model;tokenizer;device;_moments;_step;_dims;_mirror;_mirrorByName;_adapters;_loraBase;_shard;constructor(e,r=null){this.model=e,this.tokenizer=r,this.device=e.device,this._moments=new Map,this._step=0,this._dims=nr(e),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const e=this.model.getTrainableParams();if(this._adapters.size===0)return e.reduce((i,t)=>i+t.numel,0);let r=0;for(const i of e){const t=this._adapters.get(i.name);t&&(r+=t.numParams())}return r}_owns(e){return this._shard===null||e%this._shard.count===this._shard.index}_installAdapters(e){if(this._adapters.size>0)return;const r=new Set(e.targets??rr),i=this._mirrorByName;for(const t of this.model.getTrainableParams()){const n=t.name.includes(".")?t.name.slice(t.name.indexOf(".")+1):t.name;if(!r.has(n))continue;const a=er(t.name,this._dims);if(!a)continue;const[u,s]=a,h=Math.max(1,Math.min(e.rank??8,u,s));this._adapters.set(t.name,new pe(u,s,{...e,rank:h})),this._loraBase.set(t.name,Float32Array.from(i.get(t.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...r].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const e=this._mirrorByName;for(const[r,i]of this._adapters){const t=e.get(r),n=this._loraBase.get(r),a=i.delta();for(let u=0;u<t.length;u++)t[u]=n[u]+a[u]}}_momentFor(e){let r=this._moments.get(e.name);return r||(r={m:new Float32Array(e.numel),v:new Float32Array(e.numel)},this._moments.set(e.name,r)),r}async _syncMirrorFromGpu(){const e=new Map;for(const r of this.model.parameters())e.set(r.name,await it(this.device,r.buf,r.numel*4));e.set("lm_head_bias",await it(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=Je(e,this._dims),this._mirrorByName=Qe(this._mirror)}async train(e,r={}){const{learningRate:i=1e-4,epochs:t=5,batchSize:n=1,seqLen:a=512,maxGradNorm:u=1,weightDecay:s=.01,beta1:h=.9,beta2:l=.999,eps:c=1e-8,wsla:d=!1,onEpochEnd:f=null}=r,p=Math.max(1,Math.floor(r.gradientAccumulation??1));if(this._shard=r.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const g=r.maxDelta??(d?ar:0);d&&this.model.setWSLAMode(!0);let _;if(typeof e=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");_=this.tokenizer.encode(e)}else _=Array.from(e);if(_.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const w=ir(_,a);if(w.length===0)throw new Error("Input is too short to form any training chunk.");const y=sr(w,Math.max(1,Math.floor(n)));await this._syncMirrorFromGpu(),r.lora&&this._installAdapters(r.lora);const b=[];for(let v=0;v<t;v++){let P=0,B=0,F=0;for(let W=0;W<y.length;W+=p){const S=y.slice(W,W+p),{loss:O,gradNorm:K}=await this._trainStep(S,{learningRate:i,maxGradNorm:u,weightDecay:s,beta1:h,beta2:l,eps:c,wsla:d,maxDelta:g,...r.activationCheckpointing?{activationCheckpointing:!0}:{}});P+=O,B+=K,F++}const k=P/F;b.push(k),f&&f(v+1,k,B/F)}return d&&this.model.setWSLAMode(!1),b}async _trainStep(e,r){const{learningRate:i,maxGradNorm:t,weightDecay:n,beta1:a,beta2:u,eps:s,maxDelta:h}=r;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const l=this._mirror,c=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const d=r.activationCheckpointing?{activationCheckpointing:!0}:{};let f=0,p=new Map;for(const b of e){const v=tr(b.inputs,b.targets,l,this._dims,b.batch,b.seqLen,d);if(f+=v.loss/e.length,p.size===0){for(const P of v.grads.values())for(let B=0;B<P.length;B++)P[B]=P[B]/e.length;p=v.grads}else for(const[P,B]of v.grads){const F=p.get(P);for(let k=0;k<B.length;k++)F[k]=F[k]+B[k]/e.length}}const g=this.model.getTrainableParams();if(this._adapters.size>0)for(const[b,v]of this._adapters){const P=p.get(b);P&&(v.zeroGrad(),v.accumulateGradient(P))}let _=0;for(const b of g){const v=p.get(b.name);if(v)for(let P=0;P<v.length;P++)_+=v[P]*v[P]}const w=Math.sqrt(_),y=t>0&&w>t?t/w:1;return this._adamwStep(g,p,c,{learningRate:i,weightDecay:n,beta1:a,beta2:u,eps:s,beta1_t:Math.pow(a,this._step),beta2_t:Math.pow(u,this._step),maxDelta:h,gradScale:y}),{loss:f,gradNorm:w}}_adamwStep(e,r,i,t){const{learningRate:n,weightDecay:a,beta1:u,beta2:s,eps:h,beta1_t:l,beta2_t:c,maxDelta:d,gradScale:f}=t,p={lr:n,beta1:u,beta2:s,eps:h,weightDecay:a,beta1_t:l,beta2_t:c,maxDelta:d,gradScale:f};for(let g=0;g<e.length;g++){const _=e[g];if(!this._owns(g))continue;const w=this._adapters.get(_.name);if(w){const P=i.get(_.name),B=this._loraBase.get(_.name),[F,k]=[w.A,w.B],[W,S]=[w.gradients()[1].data,w.gradients()[0].data],O=this._momentNamed(`${_.name}::loraB`,k.length),K=this._momentNamed(`${_.name}::loraA`,F.length);mt(k,S,O.m,O.v,p),mt(F,W,K.m,K.v,p);const $=w.delta();for(let R=0;R<P.length;R++)P[R]=B[R]+$[R];st(this.device,_.buf,P);continue}const y=r.get(_.name),b=i.get(_.name);if(!y||!b)continue;if(y.length!==_.numel||b.length!==_.numel)throw new Error(`MambaTrainer: parameter "${_.name}" is ${_.numel} elements but the gradient engine produced ${y.length} — model and CPU mirror disagree.`);const v=this._momentFor(_);mt(b,y,v.m,v.v,p),st(this.device,_.buf,b)}}_momentNamed(e,r){let i=this._moments.get(e);return i||(i={m:new Float32Array(r),v:new Float32Array(r)},this._moments.set(e,i)),i}optimizerStateBytes(){let e=0;for(const r of this._moments.values())e+=r.m.byteLength+r.v.byteLength;return e}async evaluate(e){let r;if(typeof e=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");r=Array.from(this.tokenizer.encode(e))}else r=Array.from(e);const i=r.length,t=this.model.config.vocabSize,{logits:n}=await this.model.forward(new Uint32Array(r.slice(0,-1)),1,i-1);let a=0;for(let s=0;s<i-1;s++){const h=s*t;a+=ht(n.slice(h,h+t),r[s+1])}const u=a/(i-1);return Math.exp(u)}}function nr(o){const e=o.layerSpecs.map((n,a)=>({i:a,type:n.type})).filter(({type:n})=>!Wt.includes(n));if(e.length>0){const n=e.map(({i:a,type:u})=>`layer${a}=${u}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${Wt.join("/")} layers only, but this model has ${n}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const r=o.layers[0],i=r?.dInner??o.config.expand*o.config.dModel,t=r?.dtRank??Math.ceil(o.config.dModel/16);return{vocabSize:o.config.vocabSize,dModel:o.config.dModel,dState:o.config.dState,dConv:o.config.dConv,dInner:i,dtRank:t,numLayers:o.layers.length}}function ir(o,e){const r=[];for(let t=0;t+e<o.length;t+=e)r.push({inputs:o.slice(t,t+e),targets:o.slice(t+1,t+e+1)});const i=o.length%e;if(i>1){const t=o.length-i;r.push({inputs:o.slice(t,-1),targets:o.slice(t+1)})}return r}function sr(o,e){const r=[];let i=0;for(;i<o.length;){const t=o[i].inputs.length,n=[];for(;i<o.length&&n.length<e&&o[i].inputs.length===t;)n.push(o[i]),i++;r.push({inputs:n.flatMap(a=>a.inputs),targets:n.flatMap(a=>a.targets),batch:n.length,seqLen:t})}return r}function ra(o,e,r){return[...e,...o.encode(r)]}function or(o,e,r,i){if(o.config.vocabSize!==e.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${o.config.vocabSize}) must equal codec.vocabSize (${e.vocabSize})`);const t=o.generate(r,{...i,stopToken:i.stopToken??e.vocab.eosVideo});return{video:e.decode(t),tokens:t}}function aa(o,e,r,i){const{video:t,tokens:n}=or(o,e.video,r,i);return{image:t[0]??new Float32Array(e.frameSize),tokens:n}}const dr=0,lr=5,cr=2;class Z{parts=[];byte(e){this.parts.push(e&255)}rawVarint(e){if(e<0||!Number.isFinite(e))throw new Error(`ProtoWriter: bad varint ${e}`);let r=e;for(;r>=128;)this.byte(r%128|128),r=Math.floor(r/128);this.byte(r)}tag(e,r){this.rawVarint(e*8+r)}rawBytes(e){for(let r=0;r<e.length;r++)this.byte(e[r])}varint(e,r){this.tag(e,dr),this.rawVarint(r)}float(e,r){this.tag(e,lr);const i=new ArrayBuffer(4);new DataView(i).setFloat32(0,r,!0),this.rawBytes(new Uint8Array(i))}bytes(e,r){this.tag(e,cr),this.rawVarint(r.length),this.rawBytes(r)}string(e,r){this.bytes(e,new TextEncoder().encode(r))}message(e,r){this.bytes(e,r.finish())}finish(){return Uint8Array.from(this.parts)}}function ur(o){const e=new Uint8Array(o.length*4),r=new DataView(e.buffer);for(let i=0;i<o.length;i++)r.setFloat32(i*4,o[i],!0);return e}const hr=18,_r=8,ee=1,re=7,gr=1,pr=2,mr=3,fr=7;class br{nodes=[];inits=[];uid=0;tmp(e){return`${e}_${this.uid++}`}initFloat(e,r,i){return this.inits.push({name:e,dims:r,dataType:ee,raw:ur(i)}),e}initInt64(e,r,i){return this.inits.push({name:e,dims:r,dataType:re,int64:i}),e}node(e,r,i,t=[]){return this.nodes.push({op:e,inputs:r,outputs:i,name:`${e}_${this.uid++}`,attrs:t}),i}op(e,r,i,t=[]){const n=this.tmp(i);return this.node(e,r,[n],t),n}}function Nt(o,e,r,i,t){const n=o.op("Mul",[e,e],"rms_sq"),a=o.op("ReduceMean",[n,t],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),u=o.op("Add",[a,i],"rms_eps"),s=o.op("Sqrt",[u],"rms_r"),h=o.op("Div",[e,s],"rms_div");return o.op("Mul",[h,r],"rms_y")}function St(o,e,r,i,t,n){const a=o.op("Transpose",[r],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),u=o.op("Add",[o.op("MatMul",[e,a],"ffn_mm1"),i],"ffn_pre"),s=o.op("Relu",[u],"ffn_h"),h=o.op("Transpose",[t],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return o.op("Add",[o.op("MatMul",[s,h],"ffn_mm2"),n],"ffn_y")}function Ct(o,e={}){const r=Kt(o),i=Gt(o),t=new Map(i.map(b=>[b.name,b])),n=b=>{const v=t.get(b);if(!v)throw new Error(`export/onnx: missing tensor ${b}`);return v},a=new br,{vocabSize:u,dModel:s,numLayers:h,convKernel:l,numExperts:c,topK:d}=r,f=a.initFloat("token_embedding.weight",[u,s],n("token_embedding.weight").data),p=a.initFloat("rms_eps",[1],new Float32Array([1e-5])),g=a.initInt64("axes_last",[1],[2]),_=a.initInt64("topk_k",[1],[d]);let w=a.op("Gather",[f,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let b=0;b<h;b++){const v=`layers.${b}`,P=a.initFloat(`${v}.norm_conv.weight`,[s],n(`${v}.norm_conv.weight`).data),B=Nt(a,w,P,p,g),F=n(`${v}.conv.weight`).data,k=new Float32Array(s*l);for(let X=0;X<s;X++)for(let V=0;V<l;V++)k[X*l+(l-1-V)]=F[X*l+V];const W=a.initFloat(`${v}.conv.onnx_weight`,[s,1,l],k),S=a.op("Transpose",[B],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),O=a.op("Conv",[S,W],"conv_out",[{kind:"i",name:"group",value:s},{kind:"ints",name:"kernel_shape",value:[l]},{kind:"ints",name:"pads",value:[l-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),K=a.op("Transpose",[O],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),$=a.op("Add",[w,K],"after_conv"),R=a.initFloat(`${v}.norm_moe.weight`,[s],n(`${v}.norm_moe.weight`).data),G=Nt(a,$,R,p,g),A=a.initFloat(`${v}.moe.router.weight`,[c,s],n(`${v}.moe.router.weight`).data),m=a.op("Transpose",[A],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),x=a.op("MatMul",[G,m],"router_logits"),L=a.tmp("topk_v"),H=a.tmp("topk_i");a.node("TopK",[x,_],[L,H],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const q=a.op("Softmax",[L],"gates",[{kind:"i",name:"axis",value:2}]),I=a.op("Sub",[x,x],"zeros"),C=a.op("ScatterElements",[I,H,q],"combine",[{kind:"i",name:"axis",value:2}]),M=St(a,G,a.initFloat(`${v}.moe.shared.w1`,[r.hiddenDim,s],n(`${v}.moe.shared.w1`).data),a.initFloat(`${v}.moe.shared.b1`,[r.hiddenDim],n(`${v}.moe.shared.b1`).data),a.initFloat(`${v}.moe.shared.w2`,[s,r.hiddenDim],n(`${v}.moe.shared.w2`).data),a.initFloat(`${v}.moe.shared.b2`,[s],n(`${v}.moe.shared.b2`).data)),U=Array.from({length:c},(X,V)=>a.tmp(`combine_${V}`));a.node("Split",[C],U,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:c}]);let Q=M;for(let X=0;X<c;X++){const V=`${v}.moe.experts.${X}`,tt=St(a,G,a.initFloat(`${V}.w1`,[r.hiddenDim,s],n(`${V}.w1`).data),a.initFloat(`${V}.b1`,[r.hiddenDim],n(`${V}.b1`).data),a.initFloat(`${V}.w2`,[s,r.hiddenDim],n(`${V}.w2`).data),a.initFloat(`${V}.b2`,[s],n(`${V}.b2`).data)),et=a.op("Mul",[U[X],tt],"expert_w");Q=a.op("Add",[Q,et],"moe_acc")}w=a.op("Add",[$,Q],"after_moe")}const y=a.op("Transpose",[f],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return a.node("MatMul",[w,y],["logits"]),kr(a,r,e)}function wr(o){const e=new Z;switch(e.string(1,o.name),o.kind){case"i":e.varint(20,pr),e.varint(3,o.value);break;case"ints":e.varint(20,fr);for(const r of o.value)e.varint(8,r);break;case"f":e.varint(20,gr),e.float(2,o.value);break;case"s":e.varint(20,mr),e.string(4,o.value);break}return e}function vr(o){const e=new Z;for(const r of o.inputs)e.string(1,r);for(const r of o.outputs)e.string(2,r);e.string(3,o.name),e.string(4,o.op);for(const r of o.attrs)e.message(5,wr(r));return e}function yr(o){const e=new Z;for(const r of o.dims)e.varint(1,r);if(e.varint(2,o.dataType),e.string(8,o.name),o.int64)for(const r of o.int64)e.varint(7,r);return o.raw&&e.bytes(9,o.raw),e}function xr(o){const e=new Z;return e.string(2,o),e}function Ar(o){const e=new Z;return e.varint(1,o),e}function Ft(o,e,r){const i=new Z;for(const u of r)i.message(1,typeof u=="string"?xr(u):Ar(u));const t=new Z;t.varint(1,e),t.message(2,i);const n=new Z;n.message(1,t);const a=new Z;return a.string(1,o),a.message(2,n),a}function kr(o,e,r){const i=new Z;for(const a of o.nodes)i.message(1,vr(a));i.string(2,"evermind");for(const a of o.inits)i.message(5,yr(a));i.message(11,Ft("input_ids",re,["batch","seq"])),i.message(12,Ft("logits",ee,["batch","seq",e.vocabSize]));const t=new Z;t.string(1,""),t.varint(2,hr);const n=new Z;return n.varint(1,_r),n.string(2,r.producerName??"builderforce-memory-engine"),n.string(3,r.producerVersion??"evermind"),n.message(7,i),n.message(8,t),n.finish()}const Lr=1179993927,Dr=3,at=32,Br=4,Pr=8,Mr=0,Wr=1;class Nr{buf=new Uint8Array(1024);len=0;ensure(e){if(this.len+e<=this.buf.length)return;let r=this.buf.length*2;for(;r<this.len+e;)r*=2;const i=new Uint8Array(r);i.set(this.buf.subarray(0,this.len)),this.buf=i}u32(e){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,e,!0),this.len+=4}u64(e){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(e),!0),this.len+=8}raw(e){this.ensure(e.length),this.buf.set(e,this.len),this.len+=e.length}alignTo(e){const r=(e-this.len%e)%e;r>0&&(this.ensure(r),this.len+=r)}string(e){const r=new TextEncoder().encode(e);this.u64(r.length),this.raw(r)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function Sr(o,e){if(!e){const t=new Uint8Array(o.length*4),n=new DataView(t.buffer);for(let a=0;a<o.length;a++)n.setFloat32(a*4,o[a],!0);return t}const r=new Uint8Array(o.length*2),i=new DataView(r.buffer);for(let t=0;t<o.length;t++)i.setUint16(t*2,me(o[t]),!0);return r}function It(o,e={}){const r=e.fp16??!1,i=Kt(o),t=Gt(o),n=r?Wr:Mr,a=r?2:4,u=[["evermind.vocab_size",i.vocabSize],["evermind.embedding_length",i.dModel],["evermind.block_count",i.numLayers],["evermind.conv_kernel",i.convKernel],["evermind.feed_forward_length",i.hiddenDim],["evermind.expert_count",i.numExperts],["evermind.expert_used_count",i.topK],["general.alignment",at]],s=[["general.architecture","evermind"],["general.name",e.name??"Evermind"]],h=new Nr;h.u32(Lr),h.u32(Dr),h.u64(t.length),h.u64(u.length+s.length);for(const[p,g]of s)h.string(p),h.u32(Pr),h.string(g);for(const[p,g]of u)h.string(p),h.u32(Br),h.u32(g);const l=p=>[...p.shape].reverse();let c=0;const d=[];for(const p of t){d.push(c);const g=p.data.length*a;c+=g,c+=(at-c%at)%at}t.forEach((p,g)=>{h.string(p.name);const _=l(p);h.u32(_.length);for(const w of _)h.u64(w);h.u32(n),h.u64(d[g])}),h.alignTo(at);const f=h.length;for(let p=0;p<t.length;p++){const g=f+d[p];for(;h.length<g;)h.raw(new Uint8Array(1));h.raw(Sr(t[p].data,r))}return h.bytes()}const na=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],Cr="application/json";function ft(o,e){return{path:o,data:JSON.stringify(e,null,2),contentType:Cr}}function ia(o,e,r={},i){const t=fe(o),n=()=>({format:e,files:[],paramCount:t});switch(e){case"safetensors":{const a=n();return a.files.push({path:"model.safetensors",data:Dt(o,{fp16:r.fp16}),contentType:"application/octet-stream"}),a}case"onnx":{const a=n();return a.files.push({path:"model.onnx",data:Ct(o,{producerVersion:r.version}),contentType:"application/octet-stream"}),a}case"gguf":{const a=n();return a.files.push({path:"model.gguf",data:It(o,{name:r.name,fp16:r.fp16}),contentType:"application/octet-stream"}),a}case"huggingface":{if(!i)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const a=n();return a.files.push({path:"model.safetensors",data:Dt(o,{fp16:r.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:Ct(o,{producerVersion:r.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:It(o,{name:r.name,fp16:r.fp16}),contentType:"application/octet-stream"},ft("config.json",be(o)),ft("generation_config.json",ye()),ft("tokenizer.json",we(i)),{path:"README.md",data:ve(o,r),contentType:"text/markdown"}),a}default:throw new Error(`exportEvermind: unknown format "${String(e)}"`)}}const Fr={inputDim:32,hiddenDim:16,stateDim:le,rewardWeight:.5},jt=1280131651,Ir=296863214;class sa{config;win;ws;aLogit;woutState;boutState;woutReward;boutReward;gWin;gWs;gALogit;gWoutState;gBoutState;gWoutReward;gBoutReward;constructor(e={}){const r={...Fr,...e};if(r.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${r.hiddenDim})`);this.config=r;const{inputDim:i,hiddenDim:t,stateDim:n}=r,a=new Tt((e.seed??Ir)>>>0||1),u=h=>{const l=Math.max(a.next(),1e-12),c=a.next();return h*Math.sqrt(-2*Math.log(l))*Math.cos(2*Math.PI*c)},s=(h,l)=>{const c=new Float32Array(h);for(let d=0;d<h;d++)c[d]=u(l);return c};this.win=s(t*i,.1),this.ws=s(t*n,.1),this.aLogit=s(t,.05),this.woutState=s(n*t,.05),this.boutState=new Float32Array(n),this.woutReward=s(t,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(e,r,i){const t=this._forwardCached(e,r,i);return{hidden:t.hn,delta:t.delta,reward:t.reward}}_forwardCached(e,r,i){const{inputDim:t,hiddenDim:n,stateDim:a}=this.config,u=Float32Array.from({length:t},(g,_)=>e[_]??0),s=Float32Array.from({length:n},(g,_)=>r[_]??0),h=Float32Array.from({length:a},(g,_)=>i[_]??0),l=new Float32Array(n),c=new Float32Array(n),d=new Float32Array(n);for(let g=0;g<n;g++){let _=0;const w=g*t;for(let b=0;b<t;b++)_+=this.win[w+b]*u[b];const y=g*a;for(let b=0;b<a;b++)_+=this.ws[y+b]*h[b];l[g]=Et(this.aLogit[g]),c[g]=Math.tanh(_),d[g]=l[g]*s[g]+(1-l[g])*c[g]}const f=new Float32Array(a);for(let g=0;g<a;g++){let _=this.boutState[g];const w=g*n;for(let y=0;y<n;y++)_+=this.woutState[w+y]*d[y];f[g]=Math.tanh(_)}let p=this.boutReward[0];for(let g=0;g<n;g++)p+=this.woutReward[g]*d[g];return{x:u,sPrev:h,hPrev:s,a:l,t:c,hn:d,delta:f,reward:p}}backwardStep(e,r,i,t,n){const{inputDim:a,hiddenDim:u,stateDim:s,rewardWeight:h}=this.config,l=this._forwardCached(e,r,i);let c=0;const d=new Float32Array(s);for(let _=0;_<s;_++){const w=l.delta[_]-(t[_]??0);c+=.5*w*w,d[_]=w}const f=l.reward-n;c+=.5*h*f*f;const p=h*f,g=new Float32Array(u);for(let _=0;_<s;_++){const w=d[_]*(1-l.delta[_]*l.delta[_]);this.gBoutState[_]=this.gBoutState[_]+w;const y=_*u;for(let b=0;b<u;b++)this.gWoutState[y+b]=this.gWoutState[y+b]+w*l.hn[b],g[b]=g[b]+w*this.woutState[y+b]}this.gBoutReward[0]=this.gBoutReward[0]+p;for(let _=0;_<u;_++)this.gWoutReward[_]=this.gWoutReward[_]+p*l.hn[_],g[_]=g[_]+p*this.woutReward[_];for(let _=0;_<u;_++){const w=l.a[_],y=l.t[_];this.gALogit[_]=this.gALogit[_]+g[_]*(l.hPrev[_]-y)*w*(1-w);const b=g[_]*(1-w)*(1-y*y),v=_*a;for(let B=0;B<a;B++)this.gWin[v+B]=this.gWin[v+B]+b*l.x[B];const P=_*s;for(let B=0;B<s;B++)this.gWs[P+B]=this.gWs[P+B]+b*l.sPrev[B]}return{loss:c,hidden:l.hn}}exportWeights(e={}){const r=e.fp16??!1,i=this.parameters(),t=i.reduce((l,c)=>l+c.numel,0),n=5,a=n*4,u=r?t*2:t*4,s=new ArrayBuffer(a+u),h=new Uint32Array(s,0,n);if(h[0]=jt,h[1]=r?2:1,h[2]=this.config.inputDim,h[3]=this.config.hiddenDim,h[4]=this.config.stateDim,r){const l=new Float32Array(t);let c=0;for(const f of i)l.set(f.data,c),c+=f.numel;const d=zt(l);new Uint16Array(s,a,t).set(d)}else{const l=new Float32Array(s,a,t);let c=0;for(const d of i)l.set(d.data,c),c+=d.numel}return s}loadWeights(e){const r=new Uint32Array(e,0,5);if(r[0]!==jt)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const i=r[1],t=r[2],n=r[3],a=r[4];if(t!==this.config.inputDim||n!==this.config.hiddenDim||a!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${t}/${n}/${a} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const u=this.parameters(),s=u.reduce((d,f)=>d+f.numel,0),h=20;let l;i===2?l=Ot(new Uint16Array(e,h,s)):l=new Float32Array(e.slice(h,h+s*4));let c=0;for(const d of u)d.data.set(l.subarray(c,c+d.numel)),c+=d.numel}}function jr(o){return{parameters:()=>o.parameters(),gradients:()=>o.gradients(),zeroGrad:()=>o.zeroGrad(),accumulate:e=>o.backwardStep(e.input,o.initHidden(),e.state,e.deltaTarget,e.reward).loss,loss:e=>{const{rewardWeight:r}=o.config,i=o.forward(e.input,o.initHidden(),e.state);let t=0;for(let a=0;a<i.delta.length;a++){const u=i.delta[a]-(e.deltaTarget[a]??0);t+=.5*u*u}const n=i.reward-e.reward;return t+=.5*r*n*n,t}}}class oa{model;device;_trainer;constructor(e,r=null){this.model=e,this.device=r,this._trainer=new ce(jr(e),r,"LimbicTrainer")}get gpuTraining(){return this._trainer.gpuTraining}train(e,r={}){return this._trainer.train(e,r)}evaluate(e){return this._trainer.evaluate(e)}}const da=`

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
`;export{tr as $,Gr as A,Bt as B,gt as C,Fr as D,na as E,Kr as F,Or as G,Te as H,Ne as I,$r as J,Le as K,da as L,vt as M,Oe as N,ut as O,Yr as P,Jr as Q,Ge as R,Hr as S,sr as T,ir as U,ra as V,ar as W,Qr as X,$e as Y,Yt as Z,nr as _,rt as a,Ze as a0,ta as a1,Je as a2,Y as a3,ia as a4,It as a5,Ct as a6,aa as a7,or as a8,jr as a9,Xe as aa,Zt as ab,Qe as ac,er as ad,Ke as ae,Ye as af,ze as ag,Zr as ah,Ve as ai,qe as aj,qr as b,Pt as c,qt as d,Jt as e,Qt as f,Fe as g,_t as h,Ur as i,Pe as j,Rr as k,wt as l,Wt as m,Ir as n,rr as o,zr as p,dt as q,Re as r,sa as s,oa as t,ke as u,Be as v,We as w,Xr as x,ea as y,Vr as z};
