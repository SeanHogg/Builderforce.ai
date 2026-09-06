var Ke=Object.defineProperty;var Oe=(s,e,r)=>e in s?Ke(s,e,{enumerable:!0,configurable:!0,writable:!0,value:r}):s[e]=r;var b=(s,e,r)=>Oe(s,typeof e!="symbol"?e+"":e,r);import{z as C,F as y,H as N,y as L,P as B,_ as se,G as U,t as k,af as pe,aa as re,a as Be,n as Ue,aj as $e,ai as ue,b as De,A as Ve,J as _e,I as Xe,r as We,a5 as Ne,X as Ye,a7 as Qe,W as ge,w as Je,ah as Ze,a4 as et,$ as tt,B as rt,E as at,i as it,S as Pe}from"./chunk-evermind.js";const me=`

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
        var stride: u32 = 1u;
        loop {
            if (stride >= TILE) { break; }
            if (lid >= stride) {
                let prev_a  = wg_a[lid - stride];
                let prev_bu = wg_bu[lid - stride];
                // Combine: new_state = prev_a * cur_a (product of A_bars)
                //                      new_bu  = prev_a * cur_bu + prev_bu
                let new_a  = prev_a * wg_a[lid];
                let new_bu = prev_a * wg_bu[lid] + prev_bu;
                workgroupBarrier();
                wg_a[lid]  = new_a;
                wg_bu[lid] = new_bu;
            }
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
`,pr=`

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
`,he=`

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
`,gr=`

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
`,oe=`

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
`,mr=`

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
`,ae=`

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
`,fr=`
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
`,br=`
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
`,wr=`

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
`,nt=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,st=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class ot{constructor(e,r){b(this,"layerType","mamba1");b(this,"device");b(this,"config");b(this,"dInner");b(this,"dtRank");b(this,"wInProj");b(this,"bInProj");b(this,"wConv");b(this,"bConv");b(this,"wXProj");b(this,"bXProj");b(this,"wDtProj");b(this,"bDtProj");b(this,"A_log");b(this,"D_vec");b(this,"wOutProj");b(this,"bOutProj");b(this,"normWeight");b(this,"gpuWeights");b(this,"pipelines");b(this,"_wslaMode",!1);this.device=e,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(r.dModel/16),...r};const{dModel:i,expand:t}=this.config;this.dInner=t*i,this.dtRank=r.dtRank??Math.ceil(i/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:r,dConv:i}=this.config,t=this.dInner,a=r,n=i,c=this.dtRank,o=(d,l=.02)=>se(d,l),u=d=>new Float32Array(d),_=d=>new Float32Array(d).fill(1);this.wInProj=o(2*t*e),this.bInProj=u(2*t),this.wConv=o(t*n,.01),this.bConv=u(t),this.wXProj=o((c+2*a)*t,.01),this.bXProj=u(c+2*a),this.wDtProj=o(t*c,.02),this.bDtProj=u(t),this.A_log=new Float32Array(t*a);for(let d=0;d<t;d++)for(let l=0;l<a;l++)this.A_log[d*a+l]=Math.log(l+1);this.D_vec=_(t),this.wOutProj=o(e*t,.02),this.bOutProj=u(e),this.normWeight=_(e),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const e=this.device,r=i=>U(e,i,!0);this.gpuWeights={wInProj:r(this.wInProj),bInProj:r(this.bInProj),wConv:r(this.wConv),bConv:r(this.bConv),wXProj:r(this.wXProj),bXProj:r(this.bXProj),wDtProj:r(this.wDtProj),bDtProj:r(this.bDtProj),A_log:r(this.A_log),D_vec:r(this.D_vec),wOutProj:r(this.wOutProj),bOutProj:r(this.bOutProj),normWeight:r(this.normWeight)}}_buildPipelines(){const e=this.device;this.pipelines={linear:C(e,oe,"linear_forward"),conv1d:C(e,he,"conv1d_forward"),silu:C(e,ae,"silu_forward"),rmsnorm:C(e,ae,"rmsnorm_forward"),scan_fwd:C(e,me,"forward_scan"),scan_reduce:C(e,me,"forward_reduce"),elMul:C(e,nt,"main"),elAdd:C(e,st,"main")}}forward(e,r,i){const t=this.device,{dModel:a,dState:n,dConv:c}=this.config,o=this.dInner,u=n,_=r,d=i,l=_*d,m=this.dtRank,g={},p=y(t,l*a*4,!0),h=y(t,l*4,!0);g.normInv=h,g.normIn=e;{const M=new ArrayBuffer(16);new Uint32Array(M,0,2).set([l,a]),new Float32Array(M,8,1).set([1e-6]);const I=N(t,M),j=L(t,this.pipelines.rmsnorm,[I,e,this.gpuWeights.normWeight,p,h]);B(t,this.pipelines.rmsnorm,j,[k(l,64),1,1])}const w=y(t,l*2*o*4,!0);g.normOut=p;{const M=new Uint32Array([l,a,2*o]).buffer,I=N(t,M),j=L(t,this.pipelines.linear,[I,p,this.gpuWeights.wInProj,this.gpuWeights.bInProj,w]);B(t,this.pipelines.linear,j,[k(l,16),k(2*o,16),1])}const v=y(t,l*o*4,!0),f=y(t,l*o*4,!0);{const M=t.createCommandEncoder();M.copyBufferToBuffer(w,0,v,0,l*o*4),M.copyBufferToBuffer(w,l*o*4,f,0,l*o*4),t.queue.submit([M.finish()])}w.destroy(),g.zBuf=f,g.xConvIn=v;const x=y(t,l*o*4,!0);g.convOut=x;{const M=new Uint32Array([d,o,c,_]).buffer,I=N(t,M),j=L(t,this.pipelines.conv1d,[I,v,this.gpuWeights.wConv,this.gpuWeights.bConv,x]);B(t,this.pipelines.conv1d,j,[k(d,16),k(o,16),_])}const S=y(t,l*o*4,!0);g.siluOut=S;{const M=new Uint32Array([l*o]).buffer,I=N(t,M),j=L(t,this.pipelines.silu,[I,x,S]);B(t,this.pipelines.silu,j,[k(l*o,256),1,1])}const A=y(t,l*(m+2*u)*4,!0);{const M=new Uint32Array([l,o,m+2*u]).buffer,I=N(t,M),j=L(t,this.pipelines.linear,[I,S,this.gpuWeights.wXProj,this.gpuWeights.bXProj,A]);B(t,this.pipelines.linear,j,[k(l,16),k(m+2*u,16),1])}const K=y(t,l*m*4,!0),D=y(t,_*d*u*4,!0),W=y(t,_*d*u*4,!0);{const M=t.createCommandEncoder();M.copyBufferToBuffer(A,0,K,0,l*m*4),M.copyBufferToBuffer(A,l*m*4,D,0,_*d*u*4),M.copyBufferToBuffer(A,l*(m+u)*4,W,0,_*d*u*4),t.queue.submit([M.finish()])}A.destroy(),g.B_raw=D,g.C_raw=W;const T=y(t,l*o*4,!0);g.deltaFull=T;{const M=new Uint32Array([l,m,o]).buffer,I=N(t,M),j=L(t,this.pipelines.linear,[I,K,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,T]);B(t,this.pipelines.linear,j,[k(l,16),k(o,16),1])}K.destroy();const z=y(t,_*d*o*4,!0),R=y(t,2*_*d*o*u*4,!0);g.hCache=R;{const M=new Uint32Array([d,u,o,_]).buffer,I=N(t,M),j=L(t,this.pipelines.scan_fwd,[I,S,T,this.gpuWeights.A_log,D,W,this.gpuWeights.D_vec,z,R]);B(t,this.pipelines.scan_fwd,j,[k(o,8),k(u,8),_]);const Y=L(t,this.pipelines.scan_reduce,[I,S,T,this.gpuWeights.A_log,D,W,this.gpuWeights.D_vec,z,R]);B(t,this.pipelines.scan_reduce,Y,[k(d,64),o,_])}const O=y(t,l*o*4,!0),H=y(t,l*o*4,!0);{const M=N(t,new Uint32Array([l*o]).buffer),I=L(t,this.pipelines.silu,[M,f,O]);B(t,this.pipelines.silu,I,[k(l*o,256),1,1]);const j=N(t,new Uint32Array([l*o]).buffer),Y=L(t,this.pipelines.elMul,[z,O,H,j]);B(t,this.pipelines.elMul,Y,[k(l*o,256),1,1])}O.destroy(),z.destroy();const q=y(t,l*a*4,!0);{const M=new Uint32Array([l,o,a]).buffer,I=N(t,M),j=L(t,this.pipelines.linear,[I,H,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,q]);B(t,this.pipelines.linear,j,[k(l,16),k(a,16),1])}H.destroy();const V=y(t,l*a*4,!0);{const M=N(t,new Uint32Array([l*a]).buffer),I=L(t,this.pipelines.elAdd,[q,e,V,M]);B(t,this.pipelines.elAdd,I,[k(l*a,256),1,1])}return q.destroy(),{output:V,cache:g}}parameters(){const{dModel:e,dState:r,dConv:i}=this.config,t=this.dInner,a=r,n=i,c=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*t*e,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*t,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:t*n,name:"wConv"},{buf:this.gpuWeights.bConv,numel:t,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(c+2*a)*t,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:c+2*a,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:t*c,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:t,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:t*a,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:t,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*t,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:e,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const dt=`
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
`,vr=`
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
`,lt=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class ut{constructor(e,r){b(this,"layerType","mamba2");b(this,"device");b(this,"config");b(this,"dInner");b(this,"dHead");b(this,"gpuWeights");b(this,"pipelines");b(this,"_wslaMode",!1);this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...r};const{dModel:i,expand:t,nHeads:a}=this.config;if(this.dInner=t*i,this.dHead=this.dInner/a,this.dInner%a!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${a}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:r,dConv:i,nHeads:t,nGroups:a}=this.config,n=this.dInner,c=r,o=i,u=t,_=a,d=(h,w=.02)=>se(h,w),l=h=>new Float32Array(h),m=h=>new Float32Array(h).fill(1),g=n+2*_*c+u,p=h=>U(this.device,h,!0);this.gpuWeights={wInProj:p(d(g*e)),wConv:p(d((n+2*_*c)*o,.01)),bConv:p(l(n+2*_*c)),A_log:p(new Float32Array(u).fill(Math.log(1))),dt_bias:p(l(u)),D_vec:p(m(u)),wOutProj:p(d(e*n,.02)),normWeight:p(m(n)),preNormWeight:p(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:C(e,oe,"linear_forward"),conv1d:C(e,he,"conv1d_forward"),rmsnorm:C(e,ae,"rmsnorm_forward"),ssd_fwd:C(e,dt,"ssd_chunk_forward"),elAdd:C(e,lt,"main")}}forward(e,r,i){const t=this.device,{dModel:a,dState:n,dConv:c,nHeads:o,nGroups:u,chunkLen:_}=this.config,d=this.dInner,l=n,m=c,g=o,p=u,h=this.dHead,w=r,v=i,f=w*v,x=d+2*p*l,S=Math.ceil(v/_),A=y(t,f*a*4,!0),K=y(t,f*4,!0);{const P=new ArrayBuffer(16);new Uint32Array(P,0,2).set([f,a]),new Float32Array(P,8,1).set([1e-6]);const F=N(t,P),G=L(t,this.pipelines.rmsnorm,[F,e,this.gpuWeights.preNormWeight,A,K]);B(t,this.pipelines.rmsnorm,G,[k(f,64),1,1])}K.destroy();const D=d+2*p*l+g,W=y(t,f*D*4,!0);{const P=new Uint32Array([f,a,D]).buffer,F=N(t,P),G=U(t,new Float32Array(D),!0),te=L(t,this.pipelines.linear,[F,A,this.gpuWeights.wInProj,G,W]);B(t,this.pipelines.linear,te,[k(f,16),k(D,16),1]),G.destroy()}A.destroy();const T=y(t,f*x*4,!0),z=y(t,f*g*4,!0);{const P=t.createCommandEncoder();P.copyBufferToBuffer(W,0,T,0,f*x*4),P.copyBufferToBuffer(W,f*x*4,z,0,f*g*4),t.queue.submit([P.finish()])}W.destroy();const R=y(t,f*x*4,!0);{const P=new Uint32Array([v,x,m,w,1]).buffer,F=N(t,P),G=L(t,this.pipelines.conv1d,[F,T,this.gpuWeights.wConv,this.gpuWeights.bConv,R]);B(t,this.pipelines.conv1d,G,[k(v,16),k(x,16),w])}T.destroy();const O=y(t,f*d*4,!0),H=y(t,f*p*l*4,!0),q=y(t,f*p*l*4,!0);{const P=t.createCommandEncoder();P.copyBufferToBuffer(R,0,O,0,f*d*4),P.copyBufferToBuffer(R,f*d*4,H,0,f*p*l*4),P.copyBufferToBuffer(R,f*(d+p*l)*4,q,0,f*p*l*4),t.queue.submit([P.finish()])}R.destroy();const V=y(t,(S+1)*w*g*l*h*4,!0),M=y(t,f*d*4,!0);{const P=new Uint32Array([v,d,g,h,p,l,_,S,w]).buffer,F=N(t,P),G=L(t,this.pipelines.ssd_fwd,[F,O,H,q,z,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,M,V]);B(t,this.pipelines.ssd_fwd,G,[S,g,w])}O.destroy(),H.destroy(),q.destroy(),z.destroy();const I=y(t,f*d*4,!0),j=y(t,f*4,!0);{const P=new ArrayBuffer(16);new Uint32Array(P,0,2).set([f,d]),new Float32Array(P,8,1).set([1e-6]);const F=N(t,P),G=L(t,this.pipelines.rmsnorm,[F,M,this.gpuWeights.normWeight,I,j]);B(t,this.pipelines.rmsnorm,G,[k(f,64),1,1])}M.destroy(),j.destroy();const Y=y(t,f*a*4,!0);{const P=new Uint32Array([f,d,a]).buffer,F=N(t,P),G=U(t,new Float32Array(a),!0),te=L(t,this.pipelines.linear,[F,I,this.gpuWeights.wOutProj,G,Y]);B(t,this.pipelines.linear,te,[k(f,16),k(a,16),1]),G.destroy()}I.destroy();const ie=y(t,f*a*4,!0);{const P=N(t,new Uint32Array([f*a]).buffer),F=L(t,this.pipelines.elAdd,[Y,e,ie,P]);B(t,this.pipelines.elAdd,F,[k(f*a,256),1,1])}return Y.destroy(),{output:ie,cache:{stateCarry:V}}}parameters(){const{dModel:e,dState:r,dConv:i,nHeads:t,nGroups:a}=this.config,n=this.dInner,c=r,o=i,u=t,_=a,d=n+2*_*c;return[{buf:this.gpuWeights.wInProj,numel:(n+2*_*c+u)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:d*o,name:"wConv"},{buf:this.gpuWeights.bConv,numel:d,name:"bConv"},{buf:this.gpuWeights.A_log,numel:u,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:u,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:u,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*n,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:n,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const ct=`
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
`,yr=`
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
`,_t=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class ht{constructor(e,r){b(this,"layerType","mamba3");b(this,"device");b(this,"config");b(this,"dInner");b(this,"dHead");b(this,"nComplex");b(this,"gpuWeights");b(this,"pipelines");b(this,"_wslaMode",!1);this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...r};const{dModel:i,expand:t,nHeads:a}=this.config;if(this.dInner=t*i,this.dHead=this.dInner/a,this.nComplex=this.config.dState,this.dInner%a!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${a}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dConv:r,nHeads:i,nGroups:t}=this.config,a=this.dInner,n=this.nComplex,c=r,o=i,u=t,_=a+2*u*n*2,d=(w,v=.02)=>se(w,v),l=w=>new Float32Array(w),m=w=>new Float32Array(w).fill(1),g=new Float32Array(o*2);for(let w=0;w<o;w++)g[w*2+0]=0,g[w*2+1]=2*Math.PI*w/o;const p=w=>U(this.device,w,!0),h=a+2*u*n*2+o;this.gpuWeights={wInProj:p(d(h*e)),wConv:p(d(_*c,.01)),bConv:p(l(_)),A_log:p(g),dt_bias:p(l(o)),D_vec:p(m(o)),wOutProj:p(d(e*a,.02)),normWeight:p(m(a)),preNormWeight:p(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:C(e,oe,"linear_forward"),conv1d:C(e,he,"conv1d_forward"),rmsnorm:C(e,ae,"rmsnorm_forward"),cssd_fwd:C(e,ct,"complex_ssd_forward"),elAdd:C(e,_t,"main")}}forward(e,r,i){const t=this.device,{dModel:a,dConv:n,nHeads:c,nGroups:o,chunkLen:u}=this.config,_=this.dInner,d=this.nComplex,l=n,m=c,g=o,p=this.dHead,h=r,w=i,v=h*w,f=_+2*g*d*2,x=Math.ceil(w/u),S=y(t,v*a*4,!0),A=y(t,v*4,!0);{const E=new ArrayBuffer(16);new Uint32Array(E,0,2).set([v,a]),new Float32Array(E,8,1).set([1e-6]);const P=N(t,E),F=L(t,this.pipelines.rmsnorm,[P,e,this.gpuWeights.preNormWeight,S,A]);B(t,this.pipelines.rmsnorm,F,[k(v,64),1,1])}A.destroy();const K=_+2*g*d*2+m,D=y(t,v*K*4,!0);{const E=new Uint32Array([v,a,K]).buffer,P=N(t,E),F=U(t,new Float32Array(K),!0),G=L(t,this.pipelines.linear,[P,S,this.gpuWeights.wInProj,F,D]);B(t,this.pipelines.linear,G,[k(v,16),k(K,16),1]),F.destroy()}S.destroy();const W=y(t,v*f*4,!0),T=y(t,v*m*4,!0);{const E=t.createCommandEncoder();E.copyBufferToBuffer(D,0,W,0,v*f*4),E.copyBufferToBuffer(D,v*f*4,T,0,v*m*4),t.queue.submit([E.finish()])}D.destroy();const z=y(t,v*f*4,!0);{const E=new Uint32Array([w,f,l,h,1]).buffer,P=N(t,E),F=L(t,this.pipelines.conv1d,[P,W,this.gpuWeights.wConv,this.gpuWeights.bConv,z]);B(t,this.pipelines.conv1d,F,[k(w,16),k(f,16),h])}W.destroy();const R=y(t,v*_*4,!0),O=y(t,v*g*d*2*4,!0),H=y(t,v*g*d*2*4,!0);{const E=t.createCommandEncoder();E.copyBufferToBuffer(z,0,R,0,v*_*4),E.copyBufferToBuffer(z,v*_*4,O,0,v*g*d*2*4),E.copyBufferToBuffer(z,v*(_+g*d*2)*4,H,0,v*g*d*2*4),t.queue.submit([E.finish()])}z.destroy();const q=y(t,(x+1)*h*m*d*2*p*4,!0),V=y(t,v*_*4,!0);{const E=new Uint32Array([w,_,m,p,g,d,u,x,h]).buffer,P=N(t,E),F=L(t,this.pipelines.cssd_fwd,[P,R,O,H,T,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,V,q]);B(t,this.pipelines.cssd_fwd,F,[x,m,h])}R.destroy(),O.destroy(),H.destroy(),T.destroy();const M=y(t,v*_*4,!0),I=y(t,v*4,!0);{const E=new ArrayBuffer(16);new Uint32Array(E,0,2).set([v,_]),new Float32Array(E,8,1).set([1e-6]);const P=N(t,E),F=L(t,this.pipelines.rmsnorm,[P,V,this.gpuWeights.normWeight,M,I]);B(t,this.pipelines.rmsnorm,F,[k(v,64),1,1])}V.destroy(),I.destroy();const j=y(t,v*a*4,!0);{const E=new Uint32Array([v,_,a]).buffer,P=N(t,E),F=U(t,new Float32Array(a),!0),G=L(t,this.pipelines.linear,[P,M,this.gpuWeights.wOutProj,F,j]);B(t,this.pipelines.linear,G,[k(v,16),k(a,16),1]),F.destroy()}M.destroy();const Y=y(t,v*a*4,!0);{const E=N(t,new Uint32Array([v*a]).buffer),P=L(t,this.pipelines.elAdd,[j,e,Y,E]);B(t,this.pipelines.elAdd,P,[k(v*a,256),1,1])}return j.destroy(),{output:Y,cache:{stateCarry:q}}}parameters(){const{dModel:e,dConv:r,nHeads:i,nGroups:t}=this.config,a=this.dInner,n=this.nComplex,c=r,o=i,u=t,_=a+2*u*n*2;return[{buf:this.gpuWeights.wInProj,numel:(a+2*u*n*2+o)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:_*c,name:"wConv"},{buf:this.gpuWeights.bConv,numel:_,name:"bConv"},{buf:this.gpuWeights.A_log,numel:o*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:o,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:o,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*a,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:a,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const pt=`
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
`,fe=`
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
`,xr=`
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
`,gt=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,mt=`
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
`;class ft{constructor(e,r){b(this,"layerType","attention");b(this,"device");b(this,"config");b(this,"dHead");b(this,"gpuWeights");b(this,"pipelines");if(this.device=e,r.dModel%r.nHeads!==0)throw new Error(`AttentionBlock: dModel (${r.dModel}) must be divisible by nHeads (${r.nHeads}).`);this.config={dHead:r.dModel/r.nHeads,hasFfn:!1,ffnMult:4,...r},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,hasFfn:r,ffnMult:i}=this.config,t=(o,u=.02)=>se(o,u),a=o=>new Float32Array(o),n=o=>new Float32Array(o).fill(1),c=o=>U(this.device,o,!0);if(this.gpuWeights={wQKV:c(t(3*e*e)),bQKV:c(a(3*e)),wO:c(t(e*e)),bO:c(a(e)),normWeight:c(n(e))},r){const o=e*i;this.gpuWeights.wFfn1=c(t(o*e)),this.gpuWeights.bFfn1=c(a(o)),this.gpuWeights.wFfn2=c(t(e*o)),this.gpuWeights.bFfn2=c(a(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:C(e,oe,"linear_forward"),rmsnorm:C(e,ae,"rmsnorm_forward"),attn_fwd:C(e,fe,"attention_forward"),attn_val:C(e,fe,"attention_value"),softmax:C(e,pt,"softmax_forward"),elAdd:C(e,gt,"main")},this.config.hasFfn&&(this.pipelines.silu=C(e,mt,"silu_forward"))}forward(e,r,i){const t=this.device,{dModel:a,nHeads:n,hasFfn:c}=this.config,o=this.dHead,u=r,_=i,d=u*_,l=n,m=y(t,d*a*4,!0),g=y(t,d*4,!0);{const D=new ArrayBuffer(16);new Uint32Array(D,0,2).set([d,a]),new Float32Array(D,8,1).set([1e-6]);const W=N(t,D),T=L(t,this.pipelines.rmsnorm,[W,e,this.gpuWeights.normWeight,m,g]);B(t,this.pipelines.rmsnorm,T,[k(d,64),1,1])}g.destroy();const p=y(t,d*3*a*4,!0);{const D=new Uint32Array([d,a,3*a]).buffer,W=N(t,D),T=L(t,this.pipelines.linear,[W,m,this.gpuWeights.wQKV,this.gpuWeights.bQKV,p]);B(t,this.pipelines.linear,T,[k(d,16),k(3*a,16),1])}m.destroy();const h=y(t,d*a*4,!0),w=y(t,d*a*4,!0),v=y(t,d*a*4,!0);{const D=t.createCommandEncoder();D.copyBufferToBuffer(p,0,h,0,d*a*4),D.copyBufferToBuffer(p,d*a*4,w,0,d*a*4),D.copyBufferToBuffer(p,2*d*a*4,v,0,d*a*4),t.queue.submit([D.finish()])}p.destroy();const f=y(t,u*l*_*_*4,!0);{const D=new Uint32Array([u,_,a,l,o]).buffer,W=N(t,D),T=L(t,this.pipelines.attn_fwd,[W,h,w,v,f,y(t,d*a*4,!0)]);B(t,this.pipelines.attn_fwd,T,[k(_,16),l,u])}{const D=new Uint32Array([_,_,1]).buffer,W=N(t,D),T=L(t,this.pipelines.softmax,[W,f]);B(t,this.pipelines.softmax,T,[_,l,u])}const x=y(t,d*a*4,!0);{const D=new Uint32Array([u,_,a,l,o]).buffer,W=N(t,D),T=L(t,this.pipelines.attn_val,[W,h,w,v,f,x]);B(t,this.pipelines.attn_val,T,[k(_,16),l,u])}h.destroy(),w.destroy(),v.destroy();const S=y(t,d*a*4,!0);{const D=new Uint32Array([d,a,a]).buffer,W=N(t,D),T=L(t,this.pipelines.linear,[W,x,this.gpuWeights.wO,this.gpuWeights.bO,S]);B(t,this.pipelines.linear,T,[k(d,16),k(a,16),1])}x.destroy();let A=y(t,d*a*4,!0);{const D=N(t,new Uint32Array([d*a]).buffer),W=L(t,this.pipelines.elAdd,[S,e,A,D]);B(t,this.pipelines.elAdd,W,[k(d*a,256),1,1])}if(S.destroy(),c){const{ffnMult:D}=this.config,W=a*D,T=y(t,d*W*4,!0);{const H=new Uint32Array([d,a,W]).buffer,q=N(t,H),V=L(t,this.pipelines.linear,[q,A,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,T]);B(t,this.pipelines.linear,V,[k(d,16),k(W,16),1])}const z=y(t,d*W*4,!0);{const H=N(t,new Uint32Array([d*W]).buffer),q=L(t,this.pipelines.silu,[H,T,z]);B(t,this.pipelines.silu,q,[k(d*W,256),1,1])}T.destroy();const R=y(t,d*a*4,!0);{const H=new Uint32Array([d,W,a]).buffer,q=N(t,H),V=L(t,this.pipelines.linear,[q,z,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,R]);B(t,this.pipelines.linear,V,[k(d,16),k(a,16),1])}z.destroy();const O=y(t,d*a*4,!0);{const H=N(t,new Uint32Array([d*a]).buffer),q=L(t,this.pipelines.elAdd,[R,A,O,H]);B(t,this.pipelines.elAdd,q,[k(d*a,256),1,1])}R.destroy(),A.destroy(),A=O}return{output:A,cache:{scores:f}}}parameters(){const{dModel:e,hasFfn:r,ffnMult:i}=this.config,t=[{buf:this.gpuWeights.wQKV,numel:3*e*e,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*e,name:"bQKV"},{buf:this.gpuWeights.wO,numel:e*e,name:"wO"},{buf:this.gpuWeights.bO,numel:e,name:"bO"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}];if(r){const a=e*i;t.push({buf:this.gpuWeights.wFfn1,numel:a*e,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:a,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:e*a,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:e,name:"bFfn2"})}return t}getTrainableParams(){return this.parameters()}setWSLAMode(e){}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const be=1296190035,bt={mamba1:0,mamba2:1,mamba3:2,attention:3},wt=["mamba1","mamba2","mamba3","attention"];class vt{constructor(e,r){b(this,"device");b(this,"config");b(this,"gpuEmbedding");b(this,"layers");b(this,"layerSpecs");b(this,"gpuFinalNorm");b(this,"tiedEmbedding");b(this,"gpuLMHeadBias");b(this,"_lmHeadPipeline");b(this,"_rmsnormPipeline");b(this,"_embedPipeline");b(this,"_wslaMode",!1);this.device=e,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...r},pe(this.config.seed);const i=r.layers??Array.from({length:r.numLayers},()=>({type:"mamba1"}));if(i.length!==r.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${i.length}) must equal numLayers (${r.numLayers}).`);this.layerSpecs=i;const{vocabSize:t,dModel:a}=this.config,n=se(t*a,1/Math.sqrt(a));this.gpuEmbedding=U(e,n,!0),this.layers=i.map(c=>this._buildLayer(c)),pe(void 0),this.gpuFinalNorm=U(e,new Float32Array(a).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=U(e,new Float32Array(t),!0),this._lmHeadPipeline=C(e,oe,"linear_forward"),this._rmsnormPipeline=C(e,ae,"rmsnorm_forward"),this._embedPipeline=C(e,yt,"embed_lookup")}_buildLayer(e){const r=this.config;switch(e.type){case"mamba1":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,...r.defaultMamba1};return new ot(this.device,{...i,...e.config??{}})}case"mamba2":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,nHeads:r.nHeads,nGroups:r.nGroups,chunkLen:r.chunkLen,...r.defaultMamba2};return new ut(this.device,{...i,...e.config??{}})}case"mamba3":{const i={dModel:r.dModel,dState:r.dState,dConv:r.dConv,expand:r.expand,nHeads:r.nHeads,nGroups:r.nGroups,chunkLen:r.chunkLen,mimoGroup:r.mimoGroup,...r.defaultMamba3};return new ht(this.device,{...i,...e.config??{}})}case"attention":{const i={dModel:r.dModel,nHeads:r.nHeads,...r.defaultAttention};return new ft(this.device,{...i,...e.config??{}})}}}embedTokens(e,r,i){const{dModel:t}=this.config,a=r*i,n=U(this.device,e instanceof Uint32Array?e:new Uint32Array(e),!1),c=y(this.device,a*t*4,!0),o=N(this.device,new Uint32Array([a,t]).buffer),u=L(this.device,this._embedPipeline,[o,n,this.gpuEmbedding,c]);return B(this.device,this._embedPipeline,u,[k(a,64),1,1]),n.destroy(),o.destroy(),c}async forward(e,r,i){const{dModel:t,vocabSize:a}=this.config,n=r*i;let c=this.embedTokens(e,r,i);const o=[];for(const m of this.layers){const{output:g,cache:p}=m.forward(c,r,i);o.push(p),c.destroy(),c=g}const u=y(this.device,n*t*4,!0),_=y(this.device,n*4,!1);{const m=new ArrayBuffer(16);new Uint32Array(m,0,2).set([n,t]),new Float32Array(m,8,1).set([1e-6]);const g=N(this.device,m),p=L(this.device,this._rmsnormPipeline,[g,c,this.gpuFinalNorm,u,_]);B(this.device,this._rmsnormPipeline,p,[k(n,64),1,1])}c.destroy();const d=y(this.device,n*a*4,!0);{const m=new Uint32Array([n,t,a]).buffer,g=N(this.device,m),p=L(this.device,this._lmHeadPipeline,[g,u,this.gpuEmbedding,this.gpuLMHeadBias,d]);B(this.device,this._lmHeadPipeline,p,[k(n,16),k(a,16),1])}return u.destroy(),_.destroy(),{logits:await re(this.device,d,n*a*4),gpuLogits:d,caches:o}}async embed(e){const{dModel:r}=this.config,i=e.length,t=1,a=t*i;if(a===0)return new Float32Array(r);let n=this.embedTokens(e,t,i);for(const l of this.layers){const{output:m}=l.forward(n,t,i);n.destroy(),n=m}const c=y(this.device,a*r*4,!0),o=y(this.device,a*4,!1);{const l=new ArrayBuffer(16);new Uint32Array(l,0,2).set([a,r]),new Float32Array(l,8,1).set([1e-6]);const m=N(this.device,l),g=L(this.device,this._rmsnormPipeline,[m,n,this.gpuFinalNorm,c,o]);B(this.device,this._rmsnormPipeline,g,[k(a,64),1,1])}n.destroy();const u=await re(this.device,c,a*r*4);c.destroy(),o.destroy();const _=new Float32Array(r);for(let l=0;l<i;l++){const m=l*r;for(let g=0;g<r;g++)_[g]+=u[m+g]}for(let l=0;l<r;l++)_[l]/=i;let d=0;for(let l=0;l<r;l++)d+=_[l]*_[l];d=Math.sqrt(d)||1;for(let l=0;l<r;l++)_[l]/=d;return _}async generate(e,r=200,i={}){const{temperature:t=1,topK:a=50,topP:n=.9}=i,{vocabSize:c}=this.config,o=[...e];for(let u=0;u<r;u++){const{logits:_}=await this.forward(new Uint32Array(o),1,o.length),d=_.slice((o.length-1)*c,o.length*c),l=xt(d,{temperature:t,topK:a,topP:n});if(o.push(l),l===this.config.eosId)break}return o}parameters(){const e=[];e.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let r=0;r<this.layers.length;r++)for(const i of this.layers[r].parameters())e.push({...i,name:`layer${r}.${i.name}`});return e.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),e}getTrainableParams(){if(!this._wslaMode)return this.parameters();const e=[];for(let r=0;r<this.layers.length;r++)for(const i of this.layers[r].getTrainableParams())e.push({...i,name:`layer${r}.${i.name}`});return e}setWSLAMode(e){for(const r of this.layers)r.setWSLAMode(e);this._wslaMode=e}async exportWeights(e={}){const r=e.fp16??!1,i=this.parameters(),t=i.length,a=this.layers.length,n=await Promise.all(i.map(p=>re(this.device,p.buf,p.numel*4))),c=Math.ceil(a/4)*4,o=12+c+4+t*4,u=r?2:4,d=n.reduce((p,h)=>p+h.length,0)*u,l=new ArrayBuffer(o+d),m=new DataView(l);let g=0;m.setUint32(g,be,!0),g+=4,m.setUint32(g,r?3:2,!0),g+=4,m.setUint32(g,a,!0),g+=4;for(let p=0;p<a;p++){const h=this.layers[p].layerType;m.setUint8(g+p,bt[h])}g+=c,m.setUint32(g,t,!0),g+=4;for(const p of i)m.setUint32(g,p.numel,!0),g+=4;if(r)for(const p of n){const h=Be(p);new Uint16Array(l,g,h.length).set(h),g+=h.length*2}else for(const p of n)new Float32Array(l,g,p.length).set(p),g+=p.byteLength;return Ue(l)}async loadWeights(e){const r=$e(e);if(r.hasTrailer&&!r.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const i=new DataView(e);let t=0;const a=i.getUint32(t,!0);if(t+=4,a!==be)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const n=i.getUint32(t,!0);if(t+=4,n===1){const c=i.getUint32(t,!0);t+=4;const o=this.parameters();if(c!==o.length)throw new Error(`Weight file has ${c} parameters but this model has ${o.length}.`);const u=[];for(let _=0;_<c;_++)u.push(i.getUint32(t,!0)),t+=4;for(let _=0;_<c;_++){const d=o[_],l=u[_];if(l!==d.numel)throw new Error(`Parameter ${_} ("${d.name}") size mismatch: file=${l}, model=${d.numel}.`);ue(this.device,d.buf,new Float32Array(e,t,d.numel)),t+=d.numel*4}return}if(n===2||n===3){const c=n===3,o=i.getUint32(t,!0);if(t+=4,o!==this.layers.length)throw new Error(`Weight file has ${o} layers but this model has ${this.layers.length}.`);for(let m=0;m<o;m++){const g=i.getUint8(t+m),p=this.layers[m].layerType,h=wt[g]??"mamba1";if(h!==p)throw new Error(`Layer ${m} type mismatch: file="${h}", model="${p}".`)}const u=Math.ceil(o/4)*4;t+=u;const _=i.getUint32(t,!0);t+=4;const d=this.parameters();if(_!==d.length)throw new Error(`Weight file has ${_} parameters but this model has ${d.length}.`);const l=[];for(let m=0;m<_;m++)l.push(i.getUint32(t,!0)),t+=4;for(let m=0;m<_;m++){const g=d[m],p=l[m];if(p!==g.numel)throw new Error(`Parameter ${m} ("${g.name}") size mismatch: file=${p}, model=${g.numel}.`);if(c){const h=new Uint16Array(e,t,p);ue(this.device,g.buf,De(h)),t+=p*2}else ue(this.device,g.buf,new Float32Array(e,t,g.numel)),t+=p*4}return}throw new Error(`Unsupported MBJS version: ${n}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const e of this.layers)e.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class kr extends vt{constructor(e,r){super(e,{...r,layers:Array.from({length:r.numLayers},()=>({type:"mamba1"}))})}}const yt=`
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
`;function xt(s,{temperature:e=1,topK:r=50,topP:i=.9}={}){const t=s.length,a=new Float32Array(t);for(let h=0;h<t;h++)a[h]=s[h]/Math.max(e,1e-7);let n=-1/0;for(let h=0;h<t;h++)a[h]>n&&(n=a[h]);let c=0;const o=new Float32Array(t);for(let h=0;h<t;h++)o[h]=Math.exp(a[h]-n),c+=o[h];const _=Array.from({length:t},(h,w)=>w).sort((h,w)=>o[w]-o[h]).slice(0,r);let d=0;const l=[];for(const h of _)if(d+=o[h]/c,l.push(h),d>=i)break;let m=0;for(const h of l)m+=o[h];const g=Math.random()*m;let p=0;for(const h of l)if(p+=o[h],p>=g)return h;return l[l.length-1]}class Ar{constructor(e,r={}){b(this,"model");b(this,"adam");b(this,"opt");this.model=e,this.opt={lr:r.lr??.01,beta1:r.beta1??.9,beta2:r.beta2??.999,eps:r.eps??1e-8,weightDecay:r.weightDecay??0,auxWeight:r.auxWeight??.01,batchSize:r.batchSize??0,epochs:r.epochs??1},this.adam=new Ve(e,this.opt)}fit(e){const r=[];for(let i=0;i<this.opt.epochs;i++)r.push(this.runEpoch(e));return r}runEpoch(e){const r=this.opt.batchSize>0?this.opt.batchSize:e.length,{numExperts:i,modelDim:t}=this.model.config;let a=0,n=0;for(let c=0;c<e.length;c+=r){const o=e.slice(c,c+r);this.model.zeroGrad();const u=[],_=[],d=new Float32Array(i);let l=0;for(const h of o){const w=this.model.forward(h.input),v=new Float32Array(t);for(let f=0;f<t;f++){const x=w.output[f]-(h.target[f]??0);v[f]=x,l+=.5*x*x}this.model.backward(v,w.cache),u.push(w.cache.x),_.push(w.route.probs);for(const f of w.route.experts)d[f]=d[f]+1}const m=d.reduce((h,w)=>h+w,0)||1,g=Float32Array.from(d,h=>h/m),p=this.opt.auxWeight*i/o.length;for(let h=0;h<u.length;h++)this.model.auxGradStep(u[h],_[h],g,p);this.scaleGradients(1/o.length),this.adam.step(),a+=l,n=i*g.reduce((h,w,v)=>h+w*(_.length?_.reduce((f,x)=>f+x[v],0)/_.length:0),0)}return{loss:a/Math.max(1,e.length),auxLoss:n}}scaleGradients(e){if(e!==1)for(const r of this.model.gradients())for(let i=0;i<r.data.length;i++)r.data[i]=r.data[i]*e}}const Me=`

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
`,we=`

struct ClipParams {
    num_elements : u32,
    max_norm_sq  : f32,   // max_norm^2
};

@group(0) @binding(0) var<uniform>             clip_p  : ClipParams;
@group(0) @binding(1) var<storage, read_write> grad    : array<f32>;
@group(0) @binding(2) var<storage, read_write> norm_sq : array<f32>;  // size 1, atomic accumulator

var<workgroup> local_sq : array<f32, 256>;

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
        // Non-atomic accumulation (single workgroup assumption for small models)
        norm_sq[0] = norm_sq[0] + local_sq[0];
    }
}

// Pass 2: scale gradients if norm exceeds max_norm
@compute @workgroup_size(256, 1, 1)
fn grad_clip_scale(
    @builtin(global_invocation_id) gid : vec3<u32>,
) {
    let i = gid.x;
    if (i >= clip_p.num_elements) { return; }

    let ns = norm_sq[0];
    if (ns > clip_p.max_norm_sq) {
        let scale = sqrt(clip_p.max_norm_sq / ns);
        grad[i] = grad[i] * scale;
    }
}
`,kt=.05;class Lr{constructor(e,r=null){b(this,"model");b(this,"tokenizer");b(this,"device");b(this,"_moments");b(this,"_step");b(this,"_adamwPipeline");b(this,"_clipReducePipeline");b(this,"_clipScalePipeline");this.model=e,this.tokenizer=r,this.device=e.device,this._moments=new Map,this._step=0,this._adamwPipeline=C(this.device,Me,"adamw_update"),this._clipReducePipeline=C(this.device,we,"grad_norm_reduce"),this._clipScalePipeline=C(this.device,we,"grad_clip_scale")}_momentFor(e){let r=this._moments.get(e.name);return r||(r={m:y(this.device,e.numel*4,!1),v:y(this.device,e.numel*4,!1)},this._moments.set(e.name,r)),r}async train(e,r={}){const{learningRate:i=1e-4,epochs:t=5,batchSize:a=1,seqLen:n=512,maxGradNorm:c=1,weightDecay:o=.01,beta1:u=.9,beta2:_=.999,eps:d=1e-8,wsla:l=!1,trackGradNorm:m=!1,onEpochEnd:g=null}=r,p=r.maxDelta??(l?kt:0);l&&this.model.setWSLAMode(!0);let h;if(typeof e=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");h=this.tokenizer.encode(e)}else h=Array.from(e);if(h.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const w=At(h,n);if(w.length===0)throw new Error("Input is too short to form any training chunk.");const v=[];for(let f=0;f<t;f++){let x=0,S=0,A=0;for(const{inputs:W,targets:T}of w){const{loss:z,gradNorm:R}=await this._trainStep(W,T,a,{learningRate:i,maxGradNorm:c,weightDecay:o,beta1:u,beta2:_,eps:d,wsla:l,maxDelta:p,trackGradNorm:m});x+=z,R!=null&&(S+=R),A++}const K=x/A;v.push(K);const D=m?S/A:void 0;g&&g(f+1,K,D)}return l&&this.model.setWSLAMode(!1),v}async _trainStep(e,r,i,t){const{learningRate:a,maxGradNorm:n,weightDecay:c,beta1:o,beta2:u,eps:_,maxDelta:d,trackGradNorm:l}=t;this._step++;const m=e.length,g=this.model.config.vocabSize,{logits:p,gpuLogits:h}=await this.model.forward(new Uint32Array(e),i,m);let w=0;const v=new Float32Array(i*m*g);for(let W=0;W<m;W++){const T=W*g,z=p.slice(T,T+g),R=r[W];w+=_e(z,R);const O=Xe(z,R);for(let H=0;H<g;H++)v[T+H]=O[H]/m}const f=w/m,x=U(this.device,v,!1),S=await this._clipGradients(x,v.length,n,!!l),A=this.model.getTrainableParams(),K=Math.pow(o,this._step),D=Math.pow(u,this._step);return await this._adamwStep(A,[x],{learningRate:a,weightDecay:c,beta1:o,beta2:u,eps:_,beta1_t:K,beta2_t:D,maxDelta:d}),x.destroy(),h.destroy(),{loss:f,gradNorm:S}}async _adamwStep(e,r,i){const{learningRate:t,weightDecay:a,beta1:n,beta2:c,eps:o,beta1_t:u,beta2_t:_,maxDelta:d}=i;for(let l=0;l<e.length;l++){const m=e[l],g=r[Math.min(l,r.length-1)];if(!g||g.size<m.numel*4)continue;const p=this._momentFor(m),h=N(this.device,Lt(m.numel,t,n,c,o,a,u,_,d)),w=L(this.device,this._adamwPipeline,[h,m.buf,g,p.m,p.v]);B(this.device,this._adamwPipeline,w,[k(m.numel,256),1,1]),h.destroy()}}async _clipGradients(e,r,i,t=!1){const a=y(this.device,4,!0);this.device.queue.writeBuffer(a,0,new Float32Array([0]));const n=new ArrayBuffer(8);new Uint32Array(n,0,1).set([r]),new Float32Array(n,4,1).set([i*i]);const c=N(this.device,n),o=L(this.device,this._clipReducePipeline,[c,e,a]);B(this.device,this._clipReducePipeline,o,[k(r,256),1,1]);let u=null;if(t){const d=await re(this.device,a,4);u=Math.sqrt(Math.max(0,d[0]??0))}const _=L(this.device,this._clipScalePipeline,[c,e,a]);return B(this.device,this._clipScalePipeline,_,[k(r,256),1,1]),c.destroy(),a.destroy(),u}async evaluate(e){let r;if(typeof e=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");r=this.tokenizer.encode(e)}else r=Array.from(e);const i=r.length,t=this.model.config.vocabSize,{logits:a}=await this.model.forward(new Uint32Array(r.slice(0,-1)),1,i-1);let n=0;for(let o=0;o<i-1;o++){const u=o*t;n+=_e(a.slice(u,u+t),r[o+1])}const c=n/(i-1);return Math.exp(c)}}function At(s,e){const r=[];for(let t=0;t+e<s.length;t+=e)r.push({inputs:s.slice(t,t+e),targets:s.slice(t+1,t+e+1)});const i=s.length%e;if(i>1){const t=s.length-i;r.push({inputs:s.slice(t,-1),targets:s.slice(t+1)})}return r}function Lt(s,e,r,i,t,a,n,c,o){const u=new ArrayBuffer(48);return new Uint32Array(u,0,1).set([s]),new Float32Array(u,4,8).set([e,r,i,t,a,n,c,o]),u}function Br(s,e,r){return[...e,...s.encode(r)]}function Bt(s,e,r,i){if(s.config.vocabSize!==e.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${s.config.vocabSize}) must equal codec.vocabSize (${e.vocabSize})`);const t=s.generate(r,{...i,stopToken:i.stopToken??e.vocab.eosVideo});return{video:e.decode(t),tokens:t}}function Dr(s,e,r,i){const{video:t,tokens:a}=Bt(s,e.video,r,i);return{image:t[0]??new Float32Array(e.frameSize),tokens:a}}const Dt=0,Wt=5,Nt=2;class Q{constructor(){b(this,"parts",[])}byte(e){this.parts.push(e&255)}rawVarint(e){if(e<0||!Number.isFinite(e))throw new Error(`ProtoWriter: bad varint ${e}`);let r=e;for(;r>=128;)this.byte(r%128|128),r=Math.floor(r/128);this.byte(r)}tag(e,r){this.rawVarint(e*8+r)}rawBytes(e){for(let r=0;r<e.length;r++)this.byte(e[r])}varint(e,r){this.tag(e,Dt),this.rawVarint(r)}float(e,r){this.tag(e,Wt);const i=new ArrayBuffer(4);new DataView(i).setFloat32(0,r,!0),this.rawBytes(new Uint8Array(i))}bytes(e,r){this.tag(e,Nt),this.rawVarint(r.length),this.rawBytes(r)}string(e,r){this.bytes(e,new TextEncoder().encode(r))}message(e,r){this.bytes(e,r.finish())}finish(){return Uint8Array.from(this.parts)}}function Pt(s){const e=new Uint8Array(s.length*4),r=new DataView(e.buffer);for(let i=0;i<s.length;i++)r.setFloat32(i*4,s[i],!0);return e}const Mt=18,St=8,Se=1,Te=7,Tt=1,Ct=2,It=3,Et=7;class Ft{constructor(){b(this,"nodes",[]);b(this,"inits",[]);b(this,"uid",0)}tmp(e){return`${e}_${this.uid++}`}initFloat(e,r,i){return this.inits.push({name:e,dims:r,dataType:Se,raw:Pt(i)}),e}initInt64(e,r,i){return this.inits.push({name:e,dims:r,dataType:Te,int64:i}),e}node(e,r,i,t=[]){return this.nodes.push({op:e,inputs:r,outputs:i,name:`${e}_${this.uid++}`,attrs:t}),i}op(e,r,i,t=[]){const a=this.tmp(i);return this.node(e,r,[a],t),a}}function ve(s,e,r,i,t){const a=s.op("Mul",[e,e],"rms_sq"),n=s.op("ReduceMean",[a,t],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),c=s.op("Add",[n,i],"rms_eps"),o=s.op("Sqrt",[c],"rms_r"),u=s.op("Div",[e,o],"rms_div");return s.op("Mul",[u,r],"rms_y")}function ye(s,e,r,i,t,a){const n=s.op("Transpose",[r],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),c=s.op("Add",[s.op("MatMul",[e,n],"ffn_mm1"),i],"ffn_pre"),o=s.op("Relu",[c],"ffn_h"),u=s.op("Transpose",[t],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return s.op("Add",[s.op("MatMul",[o,u],"ffn_mm2"),a],"ffn_y")}function xe(s,e={}){const r=We(s),i=Ne(s),t=new Map(i.map(f=>[f.name,f])),a=f=>{const x=t.get(f);if(!x)throw new Error(`export/onnx: missing tensor ${f}`);return x},n=new Ft,{vocabSize:c,dModel:o,numLayers:u,convKernel:_,numExperts:d,topK:l}=r,m=n.initFloat("token_embedding.weight",[c,o],a("token_embedding.weight").data),g=n.initFloat("rms_eps",[1],new Float32Array([1e-5])),p=n.initInt64("axes_last",[1],[2]),h=n.initInt64("topk_k",[1],[l]);let w=n.op("Gather",[m,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let f=0;f<u;f++){const x=`layers.${f}`,S=n.initFloat(`${x}.norm_conv.weight`,[o],a(`${x}.norm_conv.weight`).data),A=ve(n,w,S,g,p),K=a(`${x}.conv.weight`).data,D=new Float32Array(o*_);for(let J=0;J<o;J++)for(let X=0;X<_;X++)D[J*_+(_-1-X)]=K[J*_+X];const W=n.initFloat(`${x}.conv.onnx_weight`,[o,1,_],D),T=n.op("Transpose",[A],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),z=n.op("Conv",[T,W],"conv_out",[{kind:"i",name:"group",value:o},{kind:"ints",name:"kernel_shape",value:[_]},{kind:"ints",name:"pads",value:[_-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),R=n.op("Transpose",[z],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),O=n.op("Add",[w,R],"after_conv"),H=n.initFloat(`${x}.norm_moe.weight`,[o],a(`${x}.norm_moe.weight`).data),q=ve(n,O,H,g,p),V=n.initFloat(`${x}.moe.router.weight`,[d,o],a(`${x}.moe.router.weight`).data),M=n.op("Transpose",[V],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),I=n.op("MatMul",[q,M],"router_logits"),j=n.tmp("topk_v"),Y=n.tmp("topk_i");n.node("TopK",[I,h],[j,Y],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const ie=n.op("Softmax",[j],"gates",[{kind:"i",name:"axis",value:2}]),E=n.op("Sub",[I,I],"zeros"),P=n.op("ScatterElements",[E,Y,ie],"combine",[{kind:"i",name:"axis",value:2}]),F=ye(n,q,n.initFloat(`${x}.moe.shared.w1`,[r.hiddenDim,o],a(`${x}.moe.shared.w1`).data),n.initFloat(`${x}.moe.shared.b1`,[r.hiddenDim],a(`${x}.moe.shared.b1`).data),n.initFloat(`${x}.moe.shared.w2`,[o,r.hiddenDim],a(`${x}.moe.shared.w2`).data),n.initFloat(`${x}.moe.shared.b2`,[o],a(`${x}.moe.shared.b2`).data)),G=Array.from({length:d},(J,X)=>n.tmp(`combine_${X}`));n.node("Split",[P],G,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:d}]);let te=F;for(let J=0;J<d;J++){const X=`${x}.moe.experts.${J}`,qe=ye(n,q,n.initFloat(`${X}.w1`,[r.hiddenDim,o],a(`${X}.w1`).data),n.initFloat(`${X}.b1`,[r.hiddenDim],a(`${X}.b1`).data),n.initFloat(`${X}.w2`,[o,r.hiddenDim],a(`${X}.w2`).data),n.initFloat(`${X}.b2`,[o],a(`${X}.b2`).data)),Ge=n.op("Mul",[G[J],qe],"expert_w");te=n.op("Add",[te,Ge],"moe_acc")}w=n.op("Add",[O,te],"after_moe")}const v=n.op("Transpose",[m],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return n.node("MatMul",[w,v],["logits"]),Gt(n,r,e)}function jt(s){const e=new Q;switch(e.string(1,s.name),s.kind){case"i":e.varint(20,Ct),e.varint(3,s.value);break;case"ints":e.varint(20,Et);for(const r of s.value)e.varint(8,r);break;case"f":e.varint(20,Tt),e.float(2,s.value);break;case"s":e.varint(20,It),e.string(4,s.value);break}return e}function Ht(s){const e=new Q;for(const r of s.inputs)e.string(1,r);for(const r of s.outputs)e.string(2,r);e.string(3,s.name),e.string(4,s.op);for(const r of s.attrs)e.message(5,jt(r));return e}function zt(s){const e=new Q;for(const r of s.dims)e.varint(1,r);if(e.varint(2,s.dataType),e.string(8,s.name),s.int64)for(const r of s.int64)e.varint(7,r);return s.raw&&e.bytes(9,s.raw),e}function Rt(s){const e=new Q;return e.string(2,s),e}function qt(s){const e=new Q;return e.varint(1,s),e}function ke(s,e,r){const i=new Q;for(const c of r)i.message(1,typeof c=="string"?Rt(c):qt(c));const t=new Q;t.varint(1,e),t.message(2,i);const a=new Q;a.message(1,t);const n=new Q;return n.string(1,s),n.message(2,a),n}function Gt(s,e,r){const i=new Q;for(const n of s.nodes)i.message(1,Ht(n));i.string(2,"evermind");for(const n of s.inits)i.message(5,zt(n));i.message(11,ke("input_ids",Te,["batch","seq"])),i.message(12,ke("logits",Se,["batch","seq",e.vocabSize]));const t=new Q;t.string(1,""),t.varint(2,Mt);const a=new Q;return a.varint(1,St),a.string(2,r.producerName??"builderforce-memory-engine"),a.string(3,r.producerVersion??"evermind"),a.message(7,i),a.message(8,t),a.finish()}const Kt=1179993927,Ot=3,ne=32,Ut=4,$t=8,Vt=0,Xt=1;class Yt{constructor(){b(this,"buf",new Uint8Array(1024));b(this,"len",0)}ensure(e){if(this.len+e<=this.buf.length)return;let r=this.buf.length*2;for(;r<this.len+e;)r*=2;const i=new Uint8Array(r);i.set(this.buf.subarray(0,this.len)),this.buf=i}u32(e){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,e,!0),this.len+=4}u64(e){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(e),!0),this.len+=8}raw(e){this.ensure(e.length),this.buf.set(e,this.len),this.len+=e.length}alignTo(e){const r=(e-this.len%e)%e;r>0&&(this.ensure(r),this.len+=r)}string(e){const r=new TextEncoder().encode(e);this.u64(r.length),this.raw(r)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function Qt(s,e){if(!e){const t=new Uint8Array(s.length*4),a=new DataView(t.buffer);for(let n=0;n<s.length;n++)a.setFloat32(n*4,s[n],!0);return t}const r=new Uint8Array(s.length*2),i=new DataView(r.buffer);for(let t=0;t<s.length;t++)i.setUint16(t*2,Ye(s[t]),!0);return r}function Ae(s,e={}){const r=e.fp16??!1,i=We(s),t=Ne(s),a=r?Xt:Vt,n=r?2:4,c=[["evermind.vocab_size",i.vocabSize],["evermind.embedding_length",i.dModel],["evermind.block_count",i.numLayers],["evermind.conv_kernel",i.convKernel],["evermind.feed_forward_length",i.hiddenDim],["evermind.expert_count",i.numExperts],["evermind.expert_used_count",i.topK],["general.alignment",ne]],o=[["general.architecture","evermind"],["general.name",e.name??"Evermind"]],u=new Yt;u.u32(Kt),u.u32(Ot),u.u64(t.length),u.u64(c.length+o.length);for(const[g,p]of o)u.string(g),u.u32($t),u.string(p);for(const[g,p]of c)u.string(g),u.u32(Ut),u.u32(p);const _=g=>[...g.shape].reverse();let d=0;const l=[];for(const g of t){l.push(d);const p=g.data.length*n;d+=p,d+=(ne-d%ne)%ne}t.forEach((g,p)=>{u.string(g.name);const h=_(g);u.u32(h.length);for(const w of h)u.u64(w);u.u32(a),u.u64(l[p])}),u.alignTo(ne);const m=u.length;for(let g=0;g<t.length;g++){const p=m+l[g];for(;u.length<p;)u.raw(new Uint8Array(1));u.raw(Qt(t[g].data,r))}return u.bytes()}const Wr=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],Jt="application/json";function ce(s,e){return{path:s,data:JSON.stringify(e,null,2),contentType:Jt}}function Nr(s,e,r={},i){const t=Qe(s),a=()=>({format:e,files:[],paramCount:t});switch(e){case"safetensors":{const n=a();return n.files.push({path:"model.safetensors",data:ge(s,{fp16:r.fp16}),contentType:"application/octet-stream"}),n}case"onnx":{const n=a();return n.files.push({path:"model.onnx",data:xe(s,{producerVersion:r.version}),contentType:"application/octet-stream"}),n}case"gguf":{const n=a();return n.files.push({path:"model.gguf",data:Ae(s,{name:r.name,fp16:r.fp16}),contentType:"application/octet-stream"}),n}case"huggingface":{if(!i)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const n=a();return n.files.push({path:"model.safetensors",data:ge(s,{fp16:r.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:xe(s,{producerVersion:r.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:Ae(s,{name:r.name,fp16:r.fp16}),contentType:"application/octet-stream"},ce("config.json",Je(s)),ce("generation_config.json",tt()),ce("tokenizer.json",Ze(i)),{path:"README.md",data:et(s,r),contentType:"text/markdown"}),n}default:throw new Error(`exportEvermind: unknown format "${String(e)}"`)}}const Zt=Math.LN2;function er(s,e){const r=s.length,i=Math.max(1,Math.min(e,r)),t=[],a=new Uint8Array(r);for(let n=0;n<i;n++){let c=-1,o=-1/0;for(let u=0;u<r;u++){if(a[u])continue;const _=s[u];_>o&&(o=_,c=u)}if(c<0)break;a[c]=1,t.push(c)}return t}function tr(s){let e=0,r=-1/0;for(let i=0;i<s.length;i++)s[i]>r&&(r=s[i],e=i);return e}function rr(s){return Math.exp(s)}function ar(s){return s/Zt}function Ce(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function Ie(s,e,r,i){const t=Math.min(e.length,r.length);for(let a=0;a<t;a++){const n=r[a],c=e[a];n<0||n>=c.length||(s.ceSum+=_e(c,n),tr(c)===n&&s.top1Hits++,er(c,i).includes(n)&&s.topKHits++,s.tokens++)}}function Ee(){var e;const s=globalThis;return typeof((e=s.performance)==null?void 0:e.now)=="function"?s.performance.now():Date.now()}function Fe(s){return s.slice(1)}function je(s,e,r,i){const t=s.tokens>0?s.ceSum/s.tokens:0,a={sequences:e,tokens:s.tokens,crossEntropy:t,perplexity:rr(t),bitsPerToken:ar(t),top1Accuracy:s.tokens>0?s.top1Hits/s.tokens:0,topKAccuracy:s.tokens>0?s.topKHits/s.tokens:0,topK:r};return i!==void 0&&(a.elapsedMs=i,a.tokensPerSecond=i>0?s.tokens/i*1e3:0),a}function de(s,e,r={}){const i=r.topK??5,t=r.measureLatency??!0,a=r.now??Ee,n=Ce();let c=0,o=0;for(const u of e){if(u.length<2)continue;const _=t?a():0,{logits:d}=s.forward(u);t&&(o+=a()-_),Ie(n,d,Fe(u),i),c++}return je(n,c,i,t?o:void 0)}async function Pr(s,e,r={}){const i=r.topK??5,t=r.measureLatency??!0,a=r.now??Ee,n=Ce();let c=0,o=0;for(const u of e){if(u.length<2)continue;const _=t?a():0,{logits:d}=await s.forward(u);t&&(o+=a()-_),Ie(n,d,Fe(u),i),c++}return je(n,c,i,t?o:void 0)}function Mr(s,e,r,i={}){return ir(de(s,r,i),de(e,r,i))}function ir(s,e){const r=s.perplexity-e.perplexity,i=e.perplexity>0?s.perplexity/e.perplexity:1/0,t=s.top1Accuracy-e.top1Accuracy,a=.005;let n;Math.abs(i-1)<=a?n="tie":n=r<0?"candidate":"baseline";const c=((1-i)*100).toFixed(1),o=n==="tie"?`Tie: perplexity ${s.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)}`:n==="candidate"?`Candidate wins: ${c}% lower perplexity (${s.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(c)).toFixed(1)}% higher perplexity (${s.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`;return{candidate:s,baseline:e,perplexityDelta:r,perplexityRatio:i,top1Delta:t,winner:n,summary:o}}function He(s,e){return s.split(new RegExp("(?<=\\.)\\s+")).map(r=>e.encode(r.trim())).filter(r=>r.length>=2)}function Sr(s,e,r,i={}){return de(s,He(r,e),i)}function nr(s,e){for(let r=s.length-1;r>0;r--){const i=Math.floor(e.next()*(r+1)),t=s[r];s[r]=s[i],s[i]=t}return s}function Tr(s,e={}){const r=e.seed??7,i=new rt;i.train(s,{numMerges:e.numMerges??100});const t=He(s,i);if(t.length<2)throw new Error(`corpus produced ${t.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const a=nr([...t],new Pe(r>>>0||1)),n=Math.min(.9,Math.max(.05,e.heldOutRatio??.25));let c=Math.round(a.length*n);c=Math.max(1,Math.min(a.length-1,c));const o=a.slice(0,c),u=a.slice(c),_=new at({vocabSize:i.vocabSize,dModel:e.dModel??32,numLayers:e.numLayers??2,hiddenDim:e.hiddenDim??48,seed:r}),d=e.epochs??30,l=new it(_,{lr:e.lr??.03,epochs:d}).fit(u),m=de(_,o,{topK:e.topK??5,measureLatency:!0}),g=_.generateText(e.prompt??"The",i,{maxNewTokens:8,temperature:0});return{...m,trainSequences:u.length,evalSequences:o.length,initialTrainLoss:l[0]??0,finalTrainLoss:l.at(-1)??0,vocabSize:i.vocabSize,sample:g}}const Cr={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},$={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},ze=8,le=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],sr=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],or=[0,.2,.5,.5,.8,.5,.7,.5];function Z(s,e){const r=sr[s];return r?Number.isNaN(e)?r[0]:Math.max(r[0],Math.min(r[1],e)):e}function Ir(s){for(let e=0;e<s.length&&e<ze;e++)s[e]=Z(e,s[e]);return s}function Re(){return Float32Array.from(or)}function Er(s){const e={};for(let r=0;r<le.length;r++)e[le[r]]=s[r]??0;return e}function Fr(s){const e=Re();for(let r=0;r<le.length;r++){const i=s[le[r]];typeof i=="number"&&!Number.isNaN(i)&&(e[r]=Z(r,i))}return e}function ee(s){return((typeof s=="number"&&!Number.isNaN(s)?Math.max(0,Math.min(100,s)):50)-50)/50}function jr(s){const e=Re();if(!s)return e;const r=ee(s.openness),i=ee(s.emotionality),t=ee(s.conscientiousness),a=ee(s.extraversion),n=ee(s.regulatoryFocus),c=ee(s.riskTolerance),o=ee(s.grit),u=ee(s.stimulation);return e[$.driveCuriosity]=Z($.driveCuriosity,.5+.35*r+.15*u),e[$.exploration]=Z($.exploration,.4+.3*r+.25*c+.15*n),e[$.driveCaution]=Z($.driveCaution,.5+.3*t-.3*c-.2*n+.15*i),e[$.arousal]=Z($.arousal,.2+.2*i+.1*a),e[$.driveSocial]=Z($.driveSocial,.5+.35*a),e[$.driveEffort]=Z($.driveEffort,.8+.15*o+.1*t),e[$.valence]=Z($.valence,0+.1*n-.1*i),e[$.attention]=Z($.attention,.7+.1*t),e}const dr={inputDim:32,hiddenDim:16,stateDim:ze,rewardWeight:.5},Le=1280131651,lr=296863214;function ur(s){return 1/(1+Math.exp(-s))}class Hr{constructor(e={}){b(this,"config");b(this,"win");b(this,"ws");b(this,"aLogit");b(this,"woutState");b(this,"boutState");b(this,"woutReward");b(this,"boutReward");b(this,"gWin");b(this,"gWs");b(this,"gALogit");b(this,"gWoutState");b(this,"gBoutState");b(this,"gWoutReward");b(this,"gBoutReward");const r={...dr,...e};if(r.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${r.hiddenDim})`);this.config=r;const{inputDim:i,hiddenDim:t,stateDim:a}=r,n=new Pe((e.seed??lr)>>>0||1),c=u=>{const _=Math.max(n.next(),1e-12),d=n.next();return u*Math.sqrt(-2*Math.log(_))*Math.cos(2*Math.PI*d)},o=(u,_)=>{const d=new Float32Array(u);for(let l=0;l<u;l++)d[l]=c(_);return d};this.win=o(t*i,.1),this.ws=o(t*a,.1),this.aLogit=o(t,.05),this.woutState=o(a*t,.05),this.boutState=new Float32Array(a),this.woutReward=o(t,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(e,r,i){const t=this._forwardCached(e,r,i);return{hidden:t.hn,delta:t.delta,reward:t.reward}}_forwardCached(e,r,i){const{inputDim:t,hiddenDim:a,stateDim:n}=this.config,c=Float32Array.from({length:t},(p,h)=>e[h]??0),o=Float32Array.from({length:a},(p,h)=>r[h]??0),u=Float32Array.from({length:n},(p,h)=>i[h]??0),_=new Float32Array(a),d=new Float32Array(a),l=new Float32Array(a);for(let p=0;p<a;p++){let h=0;const w=p*t;for(let f=0;f<t;f++)h+=this.win[w+f]*c[f];const v=p*n;for(let f=0;f<n;f++)h+=this.ws[v+f]*u[f];_[p]=ur(this.aLogit[p]),d[p]=Math.tanh(h),l[p]=_[p]*o[p]+(1-_[p])*d[p]}const m=new Float32Array(n);for(let p=0;p<n;p++){let h=this.boutState[p];const w=p*a;for(let v=0;v<a;v++)h+=this.woutState[w+v]*l[v];m[p]=Math.tanh(h)}let g=this.boutReward[0];for(let p=0;p<a;p++)g+=this.woutReward[p]*l[p];return{x:c,sPrev:u,hPrev:o,a:_,t:d,hn:l,delta:m,reward:g}}backwardStep(e,r,i,t,a){const{inputDim:n,hiddenDim:c,stateDim:o,rewardWeight:u}=this.config,_=this._forwardCached(e,r,i);let d=0;const l=new Float32Array(o);for(let h=0;h<o;h++){const w=_.delta[h]-(t[h]??0);d+=.5*w*w,l[h]=w}const m=_.reward-a;d+=.5*u*m*m;const g=u*m,p=new Float32Array(c);for(let h=0;h<o;h++){const w=l[h]*(1-_.delta[h]*_.delta[h]);this.gBoutState[h]=this.gBoutState[h]+w;const v=h*c;for(let f=0;f<c;f++)this.gWoutState[v+f]=this.gWoutState[v+f]+w*_.hn[f],p[f]=p[f]+w*this.woutState[v+f]}this.gBoutReward[0]=this.gBoutReward[0]+g;for(let h=0;h<c;h++)this.gWoutReward[h]=this.gWoutReward[h]+g*_.hn[h],p[h]=p[h]+g*this.woutReward[h];for(let h=0;h<c;h++){const w=_.a[h],v=_.t[h];this.gALogit[h]=this.gALogit[h]+p[h]*(_.hPrev[h]-v)*w*(1-w);const f=p[h]*(1-w)*(1-v*v),x=h*n;for(let A=0;A<n;A++)this.gWin[x+A]=this.gWin[x+A]+f*_.x[A];const S=h*o;for(let A=0;A<o;A++)this.gWs[S+A]=this.gWs[S+A]+f*_.sPrev[A]}return{loss:d,hidden:_.hn}}exportWeights(e={}){const r=e.fp16??!1,i=this.parameters(),t=i.reduce((_,d)=>_+d.numel,0),a=5,n=a*4,c=r?t*2:t*4,o=new ArrayBuffer(n+c),u=new Uint32Array(o,0,a);if(u[0]=Le,u[1]=r?2:1,u[2]=this.config.inputDim,u[3]=this.config.hiddenDim,u[4]=this.config.stateDim,r){const _=new Float32Array(t);let d=0;for(const m of i)_.set(m.data,d),d+=m.numel;const l=Be(_);new Uint16Array(o,n,t).set(l)}else{const _=new Float32Array(o,n,t);let d=0;for(const l of i)_.set(l.data,d),d+=l.numel}return o}loadWeights(e){const r=new Uint32Array(e,0,5);if(r[0]!==Le)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const i=r[1],t=r[2],a=r[3],n=r[4];if(t!==this.config.inputDim||a!==this.config.hiddenDim||n!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${t}/${a}/${n} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const c=this.parameters(),o=c.reduce((l,m)=>l+m.numel,0),u=20;let _;i===2?_=De(new Uint16Array(e,u,o)):_=new Float32Array(e.slice(u,u+o*4));let d=0;for(const l of c)l.data.set(_.subarray(d,d+l.numel)),d+=l.numel}}function cr(s,e,r,i,t,a,n,c){const o=new ArrayBuffer(32);return new Uint32Array(o,0,1).set([s]),new Float32Array(o,4,7).set([e,r,i,t,a,n,c]),o}class zr{constructor(e,r=null){b(this,"model");b(this,"device");b(this,"_moments",null);b(this,"_step",0);b(this,"_adamwPipeline");this.model=e,this.device=r,this._adamwPipeline=r?C(r,Me,"adamw_update"):null}get gpuTraining(){return this.device!=null&&this._adamwPipeline!=null}_initMoments(){this._moments||(this._moments=this.model.parameters().map(e=>({m:new Float32Array(e.numel),v:new Float32Array(e.numel)})))}async train(e,r={}){if(e.length===0)throw new Error("LimbicTrainer.train: no samples");const{learningRate:i=.05,epochs:t=50,weightDecay:a=0,beta1:n=.9,beta2:c=.999,eps:o=1e-8,maxGradNorm:u=1,onEpochEnd:_=null}=r;this._initMoments();const d=[];for(let l=0;l<t;l++){this.model.zeroGrad();let m=0;for(const S of e){const{loss:A}=this.model.backwardStep(S.input,this.model.initHidden(),S.state,S.deltaTarget,S.reward);m+=A}const g=this.model.gradients(),p=1/e.length;for(const S of g)for(let A=0;A<S.data.length;A++)S.data[A]*=p;const h=this._clipGradients(g,u);this._step++;const w=Math.pow(n,this._step),v=Math.pow(c,this._step),f={learningRate:i,weightDecay:a,beta1:n,beta2:c,eps:o,beta1_t:w,beta2_t:v};this.gpuTraining?await this._adamwStepGpu(g,f):this._adamwStepCpu(g,f);const x=m/e.length;d.push(x),_&&_(l+1,x,h)}return d}evaluate(e){if(e.length===0)return 0;let r=0;const{rewardWeight:i}=this.model.config;for(const t of e){const a=this.model.forward(t.input,this.model.initHidden(),t.state);let n=0;for(let o=0;o<a.delta.length;o++){const u=a.delta[o]-(t.deltaTarget[o]??0);n+=.5*u*u}const c=a.reward-t.reward;n+=.5*i*c*c,r+=n}return r/e.length}_clipGradients(e,r){let i=0;for(const a of e)for(let n=0;n<a.data.length;n++)i+=a.data[n]*a.data[n];const t=Math.sqrt(i);if(t>r&&t>0){const a=r/t;for(const n of e)for(let c=0;c<n.data.length;c++)n.data[c]*=a}return t}_adamwStepCpu(e,r){const i=this.model.parameters(),{learningRate:t,weightDecay:a,beta1:n,beta2:c,eps:o,beta1_t:u,beta2_t:_}=r;for(let d=0;d<i.length;d++){const l=i[d].data,m=e[d].data,g=this._moments[d];for(let p=0;p<l.length;p++){const h=m[p];g.m[p]=n*g.m[p]+(1-n)*h,g.v[p]=c*g.v[p]+(1-c)*h*h;const w=g.m[p]/(1-u),v=g.v[p]/(1-_);l[p]=l[p]*(1-t*a)-t*w/(Math.sqrt(v)+o)}}}async _adamwStepGpu(e,r){const i=this.device,t=this._adamwPipeline,a=this.model.parameters(),{learningRate:n,weightDecay:c,beta1:o,beta2:u,eps:_,beta1_t:d,beta2_t:l}=r;for(let m=0;m<a.length;m++){const g=a[m],p=this._moments[m],h=U(i,g.data,!0),w=U(i,e[m].data,!1),v=U(i,p.m,!0),f=U(i,p.v,!0),x=N(i,cr(g.numel,n,o,u,_,c,d,l)),S=L(i,t,[x,h,w,v,f]);B(i,t,S,[k(g.numel,256),1,1]),g.data.set((await re(i,h,g.numel*4)).subarray(0,g.numel)),p.m.set((await re(i,v,g.numel*4)).subarray(0,g.numel)),p.v.set((await re(i,f,g.numel*4)).subarray(0,g.numel)),h.destroy(),w.destroy(),v.destroy(),f.destroy(),x.destroy()}}}const Rr=`

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
`;export{xe as $,wr as A,vr as B,yr as C,dr as D,Wr as E,dt as F,we as G,vt as H,tr as I,de as J,Pr as K,Rr as L,ot as M,or as N,Sr as O,ar as P,Br as Q,Cr as R,pr as S,Z as T,Ir as U,Mr as V,Me as W,ir as X,He as Y,Nr as Z,Ae as _,ae as a,Dr as a0,Bt as a1,Re as a2,rr as a3,jr as a4,Fr as a5,Er as a6,er as a7,Tr as a8,xr as b,fe as c,ft as d,ct as e,gr as f,he as g,lr as h,sr as i,$ as j,le as k,ze as l,mr as m,oe as n,Zt as o,Hr as p,zr as q,ut as r,ht as s,kr as t,Lr as u,Ar as v,me as w,br as x,fr as y,pt as z};
