const _e=globalThis,Jr=_e.GPUBufferUsage?.UNIFORM??64,lr=_e.GPUBufferUsage?.STORAGE??128,ur=_e.GPUBufferUsage?.COPY_SRC??4,We=_e.GPUBufferUsage?.COPY_DST??8,Zr=_e.GPUBufferUsage?.MAP_READ??1;class en{device;_free=new Map;constructor(e){this.device=e}_key(e,t){return`${e}:${t}`}acquire(e,t){return this._free.get(this._key(e,t))?.pop()??this.device.createBuffer({size:e,usage:t})}release(e,t,n){const r=this._key(t,n);let a=this._free.get(r);a||(a=[],this._free.set(r,a)),a.push(e)}get freeCount(){let e=0;for(const t of this._free.values())e+=t.length;return e}clear(){for(const e of this._free.values())for(const t of e)t.destroy();this._free.clear()}}const Lt=new WeakMap;function tn(o){let e=Lt.get(o);return e||(e=new en(o),Lt.set(o,e)),e}async function Qa(o={}){if(typeof navigator>"u"||!navigator.gpu)throw new Error("WebGPU is not available in this environment. Use Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled.");const e=await navigator.gpu.requestAdapter({powerPreference:o.powerPreference??"high-performance"});if(!e)throw new Error("Failed to acquire a GPUAdapter. Your GPU may not support WebGPU.");const t=e.limits,n=3*1024*1024*1024,r=await e.requestDevice({requiredLimits:{maxBufferSize:Math.min(n,t.maxBufferSize),maxStorageBufferBindingSize:Math.min(n,t.maxStorageBufferBindingSize),maxComputeInvocationsPerWorkgroup:Math.min(256,t.maxComputeInvocationsPerWorkgroup)}});return r.lost.then(a=>{console.error("WebGPU device lost:",a.message)}),{device:r,adapter:e}}function Q(o,e,t=!1){const n=e instanceof Float32Array||e instanceof Uint32Array?e:new Float32Array(e),r=lr|We|(t?ur:0),a=o.createBuffer({size:n.byteLength,usage:r,mappedAtCreation:!0});return n instanceof Uint32Array?new Uint32Array(a.getMappedRange()).set(n):new Float32Array(a.getMappedRange()).set(n),a.unmap(),a}function E(o,e,t=!1){const n=lr|We|(t?ur:0);return o.createBuffer({size:e,usage:n})}function z(o,e){const t=ArrayBuffer.isView(e)?e.buffer:e,n=o.createBuffer({size:t.byteLength,usage:Jr|We,mappedAtCreation:!0});return new Uint8Array(n.getMappedRange()).set(new Uint8Array(t)),n.unmap(),n}async function ie(o,e,t){const n=_e.GPUMapMode?.READ??1,r=Zr|We,a=tn(o),s=a.acquire(t,r),d=o.createCommandEncoder();d.copyBufferToBuffer(e,0,s,0,t),o.queue.submit([d.finish()]),await s.mapAsync(n);const i=new Float32Array(s.getMappedRange().slice(0));return s.unmap(),a.release(s,t,r),i}function pe(o,e,t,n=0){o.queue.writeBuffer(e,n,t.buffer,t.byteOffset,t.byteLength)}function R(o,e,t){const n=o.createShaderModule({code:e});return o.createComputePipeline({layout:"auto",compute:{module:n,entryPoint:t}})}function $(o,e,t,n=0){const r=t.map((a,s)=>({binding:s,resource:{buffer:a}}));return o.createBindGroup({layout:e.getBindGroupLayout(n),entries:r})}function I(o,e,t,n){const r=o.createCommandEncoder(),a=r.beginComputePass();a.setPipeline(e),a.setBindGroup(0,t),a.dispatchWorkgroups(...n),a.end(),o.queue.submit([r.finish()])}function F(o,e){return Math.ceil(o/e)}const St=`

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
`,Ja=`

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
`;class re{_s;constructor(e){this._s=e>>>0||1}next(){return this._s=Math.imul(1664525,this._s)+1013904223>>>0,this._s/4294967296}}let nt=Math.random;function Et(o){if(o==null)nt=Math.random;else{const e=new re(o);nt=()=>e.next()}}function rn(o=1,e=nt){const t=Math.max(e(),1e-12),n=e();return o*Math.sqrt(-2*Math.log(t))*Math.cos(2*Math.PI*n)}function be(o,e,t){const n=new Float32Array(o);for(let r=0;r<o;r++)n[r]=rn(e,t);return n}const ht=`

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
`,Za=`

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
`,Se=`

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
`,es=`

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
`,ge=`

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
`,ts=`
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
`,rs=`
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
`,ns=`

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
`,je=`
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
`,Re="col_slice";function Y(o,e,t,n,r,a,s,d){const i=z(o,new Uint32Array([r,a,s,d]).buffer),c=$(o,e,[i,t,n]);I(o,e,c,[F(r*d,256),1,1]),i.destroy()}const nn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,on=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class an{layerType="mamba1";device;config;dInner;dtRank;wInProj;bInProj;wConv;bConv;wXProj;bXProj;wDtProj;bDtProj;A_log;D_vec;wOutProj;bOutProj;normWeight;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(t.dModel/16),...t};const{dModel:n,expand:r}=this.config;this.dInner=r*n,this.dtRank=t.dtRank??Math.ceil(n/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:n}=this.config,r=this.dInner,a=t,s=n,d=this.dtRank,i=(l,h=.02)=>be(l,h),c=l=>new Float32Array(l),u=l=>new Float32Array(l).fill(1);this.wInProj=i(2*r*e),this.bInProj=c(2*r),this.wConv=i(r*s,.01),this.bConv=c(r),this.wXProj=i((d+2*a)*r,.01),this.bXProj=c(d+2*a),this.wDtProj=i(r*d,.02),this.bDtProj=c(r),this.A_log=new Float32Array(r*a);for(let l=0;l<r;l++)for(let h=0;h<a;h++)this.A_log[l*a+h]=Math.log(h+1);this.D_vec=u(r),this.wOutProj=i(e*r,.02),this.bOutProj=c(e),this.normWeight=u(e),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const e=this.device,t=n=>Q(e,n,!0);this.gpuWeights={wInProj:t(this.wInProj),bInProj:t(this.bInProj),wConv:t(this.wConv),bConv:t(this.bConv),wXProj:t(this.wXProj),bXProj:t(this.bXProj),wDtProj:t(this.wDtProj),bDtProj:t(this.bDtProj),A_log:t(this.A_log),D_vec:t(this.D_vec),wOutProj:t(this.wOutProj),bOutProj:t(this.bOutProj),normWeight:t(this.normWeight)}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,Se,"linear_forward"),conv1d:R(e,ht,"conv1d_forward"),silu:R(e,ge,"silu_forward"),rmsnorm:R(e,ge,"rmsnorm_forward"),scan_fwd:R(e,St,"forward_scan"),scan_reduce:R(e,St,"forward_reduce"),colSlice:R(e,je,Re),elMul:R(e,nn,"main"),elAdd:R(e,on,"main")}}forward(e,t,n){const r=this.device,{dModel:a,dState:s,dConv:d}=this.config,i=this.dInner,c=s,u=t,l=n,h=u*l,m=this.dtRank,f={},g=E(r,h*a*4,!0),p=E(r,h*4,!0);f.normInv=p,f.normIn=e;{const v=new ArrayBuffer(16);new Uint32Array(v,0,2).set([h,a]),new Float32Array(v,8,1).set([1e-6]);const k=z(r,v),S=$(r,this.pipelines.rmsnorm,[k,e,this.gpuWeights.normWeight,g,p]);I(r,this.pipelines.rmsnorm,S,[F(h,64),1,1])}const b=E(r,h*2*i*4,!0);f.normOut=g;{const v=new Uint32Array([h,a,2*i]).buffer,k=z(r,v),S=$(r,this.pipelines.linear,[k,g,this.gpuWeights.wInProj,this.gpuWeights.bInProj,b]);I(r,this.pipelines.linear,S,[F(h,16),F(2*i,16),1])}const y=E(r,h*i*4,!0),_=E(r,h*i*4,!0);{const v=this.pipelines.colSlice;Y(r,v,b,y,h,2*i,0,i),Y(r,v,b,_,h,2*i,i,i)}b.destroy(),f.zBuf=_,f.xConvIn=y;const w=E(r,h*i*4,!0);f.convOut=w;{const v=new Uint32Array([l,i,d,u,1]).buffer,k=z(r,v),S=$(r,this.pipelines.conv1d,[k,y,this.gpuWeights.wConv,this.gpuWeights.bConv,w]);I(r,this.pipelines.conv1d,S,[F(l,16),F(i,16),u])}const x=E(r,h*i*4,!0);f.siluOut=x;{const v=new Uint32Array([h*i]).buffer,k=z(r,v),S=$(r,this.pipelines.silu,[k,w,x]);I(r,this.pipelines.silu,S,[F(h*i,256),1,1])}const L=E(r,h*(m+2*c)*4,!0);{const v=new Uint32Array([h,i,m+2*c]).buffer,k=z(r,v),S=$(r,this.pipelines.linear,[k,x,this.gpuWeights.wXProj,this.gpuWeights.bXProj,L]);I(r,this.pipelines.linear,S,[F(h,16),F(m+2*c,16),1])}const T=E(r,h*m*4,!0),M=E(r,u*l*c*4,!0),B=E(r,u*l*c*4,!0);{const v=m+2*c,k=this.pipelines.colSlice;Y(r,k,L,T,h,v,0,m),Y(r,k,L,M,h,v,m,c),Y(r,k,L,B,h,v,m+c,c)}L.destroy(),f.B_raw=M,f.C_raw=B;const C=E(r,h*i*4,!0);f.deltaFull=C;{const v=new Uint32Array([h,m,i]).buffer,k=z(r,v),S=$(r,this.pipelines.linear,[k,T,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,C]);I(r,this.pipelines.linear,S,[F(h,16),F(i,16),1])}T.destroy();const O=E(r,u*l*i*4,!0),U=E(r,2*u*l*i*c*4,!0);f.hCache=U;{const v=new Uint32Array([l,c,i,u]).buffer,k=z(r,v),S=$(r,this.pipelines.scan_fwd,[k,x,C,this.gpuWeights.A_log,M,B,this.gpuWeights.D_vec,O,U]);I(r,this.pipelines.scan_fwd,S,[i,c,u]);const W=$(r,this.pipelines.scan_reduce,[k,x,C,this.gpuWeights.A_log,M,B,this.gpuWeights.D_vec,O,U]);I(r,this.pipelines.scan_reduce,W,[F(l,64),i,u])}const K=E(r,h*i*4,!0),j=E(r,h*i*4,!0);{const v=z(r,new Uint32Array([h*i]).buffer),k=$(r,this.pipelines.silu,[v,_,K]);I(r,this.pipelines.silu,k,[F(h*i,256),1,1]);const S=z(r,new Uint32Array([h*i]).buffer),W=$(r,this.pipelines.elMul,[O,K,j,S]);I(r,this.pipelines.elMul,W,[F(h*i,256),1,1])}K.destroy(),O.destroy();const G=E(r,h*a*4,!0);{const v=new Uint32Array([h,i,a]).buffer,k=z(r,v),S=$(r,this.pipelines.linear,[k,j,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,G]);I(r,this.pipelines.linear,S,[F(h,16),F(a,16),1])}j.destroy();const A=E(r,h*a*4,!0);{const v=z(r,new Uint32Array([h*a]).buffer),k=$(r,this.pipelines.elAdd,[G,e,A,v]);I(r,this.pipelines.elAdd,k,[F(h*a,256),1,1])}return G.destroy(),{output:A,cache:f}}parameters(){const{dModel:e,dState:t,dConv:n}=this.config,r=this.dInner,a=t,s=n,d=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*r*e,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*r,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:r*s,name:"wConv"},{buf:this.gpuWeights.bConv,numel:r,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(d+2*a)*r,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:d+2*a,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:r*d,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:r,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:r*a,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:r,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*r,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:e,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const sn=`
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
`,os=`
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
`,dn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class cn{layerType="mamba2";device;config;dInner;dHead;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...t};const{dModel:n,expand:r,nHeads:a}=this.config;if(this.dInner=r*n,this.dHead=this.dInner/a,this.dInner%a!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${a}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:n,nHeads:r,nGroups:a}=this.config,s=this.dInner,d=t,i=n,c=r,u=a,l=(p,b=.02)=>be(p,b),h=p=>new Float32Array(p),m=p=>new Float32Array(p).fill(1),f=s+2*u*d+c,g=p=>Q(this.device,p,!0);this.gpuWeights={wInProj:g(l(f*e)),wConv:g(l((s+2*u*d)*i,.01)),bConv:g(h(s+2*u*d)),A_log:g(new Float32Array(c).fill(Math.log(1))),dt_bias:g(h(c)),D_vec:g(m(c)),wOutProj:g(l(e*s,.02)),normWeight:g(m(s)),preNormWeight:g(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,Se,"linear_forward"),conv1d:R(e,ht,"conv1d_forward"),colSlice:R(e,je,Re),rmsnorm:R(e,ge,"rmsnorm_forward"),ssd_fwd:R(e,sn,"ssd_chunk_forward"),elAdd:R(e,dn,"main")}}forward(e,t,n){const r=this.device,{dModel:a,dState:s,dConv:d,nHeads:i,nGroups:c,chunkLen:u}=this.config,l=this.dInner,h=s,m=d,f=i,g=c,p=this.dHead,b=t,y=n,_=b*y,w=l+2*g*h,x=Math.ceil(y/u),L=E(r,_*a*4,!0),T=E(r,_*4,!0);{const P=new ArrayBuffer(16);new Uint32Array(P,0,2).set([_,a]),new Float32Array(P,8,1).set([1e-6]);const D=z(r,P),H=$(r,this.pipelines.rmsnorm,[D,e,this.gpuWeights.preNormWeight,L,T]);I(r,this.pipelines.rmsnorm,H,[F(_,64),1,1])}T.destroy();const M=l+2*g*h+f,B=E(r,_*M*4,!0);{const P=new Uint32Array([_,a,M]).buffer,D=z(r,P),H=Q(r,new Float32Array(M),!0),J=$(r,this.pipelines.linear,[D,L,this.gpuWeights.wInProj,H,B]);I(r,this.pipelines.linear,J,[F(_,16),F(M,16),1]),H.destroy()}L.destroy();const C=E(r,_*w*4,!0),O=E(r,_*f*4,!0);{const P=this.pipelines.colSlice,D=w+f;Y(r,P,B,C,_,D,0,w),Y(r,P,B,O,_,D,w,f)}B.destroy();const U=E(r,_*w*4,!0);{const P=new Uint32Array([y,w,m,b,1]).buffer,D=z(r,P),H=$(r,this.pipelines.conv1d,[D,C,this.gpuWeights.wConv,this.gpuWeights.bConv,U]);I(r,this.pipelines.conv1d,H,[F(y,16),F(w,16),b])}C.destroy();const K=E(r,_*l*4,!0),j=E(r,_*g*h*4,!0),G=E(r,_*g*h*4,!0);{const P=this.pipelines.colSlice;Y(r,P,U,K,_,w,0,l),Y(r,P,U,j,_,w,l,g*h),Y(r,P,U,G,_,w,l+g*h,g*h)}U.destroy();const A=E(r,(x+1)*b*f*h*p*4,!0),v=E(r,_*l*4,!0);{const P=new Uint32Array([y,l,f,p,g,h,u,x,b]).buffer,D=z(r,P),H=$(r,this.pipelines.ssd_fwd,[D,K,j,G,O,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,v,A]);I(r,this.pipelines.ssd_fwd,H,[x,f,b])}K.destroy(),j.destroy(),G.destroy(),O.destroy();const k=E(r,_*l*4,!0),S=E(r,_*4,!0);{const P=new ArrayBuffer(16);new Uint32Array(P,0,2).set([_,l]),new Float32Array(P,8,1).set([1e-6]);const D=z(r,P),H=$(r,this.pipelines.rmsnorm,[D,v,this.gpuWeights.normWeight,k,S]);I(r,this.pipelines.rmsnorm,H,[F(_,64),1,1])}v.destroy(),S.destroy();const W=E(r,_*a*4,!0);{const P=new Uint32Array([_,l,a]).buffer,D=z(r,P),H=Q(r,new Float32Array(a),!0),J=$(r,this.pipelines.linear,[D,k,this.gpuWeights.wOutProj,H,W]);I(r,this.pipelines.linear,J,[F(_,16),F(a,16),1]),H.destroy()}k.destroy();const q=E(r,_*a*4,!0);{const P=z(r,new Uint32Array([_*a]).buffer),D=$(r,this.pipelines.elAdd,[W,e,q,P]);I(r,this.pipelines.elAdd,D,[F(_*a,256),1,1])}return W.destroy(),{output:q,cache:{stateCarry:A}}}parameters(){const{dModel:e,dState:t,dConv:n,nHeads:r,nGroups:a}=this.config,s=this.dInner,d=t,i=n,c=r,u=a,l=s+2*u*d;return[{buf:this.gpuWeights.wInProj,numel:(s+2*u*d+c)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:l*i,name:"wConv"},{buf:this.gpuWeights.bConv,numel:l,name:"bConv"},{buf:this.gpuWeights.A_log,numel:c,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:c,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:c,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*s,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:s,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const ln=`
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
`,as=`
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
`,un=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class hn{layerType="mamba3";device;config;dInner;dHead;nComplex;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...t};const{dModel:n,expand:r,nHeads:a}=this.config;if(this.dInner=r*n,this.dHead=this.dInner/a,this.nComplex=this.config.dState,this.dInner%a!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${a}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dConv:t,nHeads:n,nGroups:r}=this.config,a=this.dInner,s=this.nComplex,d=t,i=n,c=r,u=a+2*c*s*2,l=(b,y=.02)=>be(b,y),h=b=>new Float32Array(b),m=b=>new Float32Array(b).fill(1),f=new Float32Array(i*2);for(let b=0;b<i;b++)f[b*2+0]=0,f[b*2+1]=2*Math.PI*b/i;const g=b=>Q(this.device,b,!0),p=a+2*c*s*2+i;this.gpuWeights={wInProj:g(l(p*e)),wConv:g(l(u*d,.01)),bConv:g(h(u)),A_log:g(f),dt_bias:g(h(i)),D_vec:g(m(i)),wOutProj:g(l(e*a,.02)),normWeight:g(m(a)),preNormWeight:g(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,Se,"linear_forward"),conv1d:R(e,ht,"conv1d_forward"),colSlice:R(e,je,Re),rmsnorm:R(e,ge,"rmsnorm_forward"),cssd_fwd:R(e,ln,"complex_ssd_forward"),elAdd:R(e,un,"main")}}forward(e,t,n){const r=this.device,{dModel:a,dConv:s,nHeads:d,nGroups:i,chunkLen:c}=this.config,u=this.dInner,l=this.nComplex,h=s,m=d,f=i,g=this.dHead,p=t,b=n,y=p*b,_=u+2*f*l*2,w=Math.ceil(b/c),x=E(r,y*a*4,!0),L=E(r,y*4,!0);{const N=new ArrayBuffer(16);new Uint32Array(N,0,2).set([y,a]),new Float32Array(N,8,1).set([1e-6]);const P=z(r,N),D=$(r,this.pipelines.rmsnorm,[P,e,this.gpuWeights.preNormWeight,x,L]);I(r,this.pipelines.rmsnorm,D,[F(y,64),1,1])}L.destroy();const T=u+2*f*l*2+m,M=E(r,y*T*4,!0);{const N=new Uint32Array([y,a,T]).buffer,P=z(r,N),D=Q(r,new Float32Array(T),!0),H=$(r,this.pipelines.linear,[P,x,this.gpuWeights.wInProj,D,M]);I(r,this.pipelines.linear,H,[F(y,16),F(T,16),1]),D.destroy()}x.destroy();const B=E(r,y*_*4,!0),C=E(r,y*m*4,!0);{const N=this.pipelines.colSlice,P=_+m;Y(r,N,M,B,y,P,0,_),Y(r,N,M,C,y,P,_,m)}M.destroy();const O=E(r,y*_*4,!0);{const N=new Uint32Array([b,_,h,p,1]).buffer,P=z(r,N),D=$(r,this.pipelines.conv1d,[P,B,this.gpuWeights.wConv,this.gpuWeights.bConv,O]);I(r,this.pipelines.conv1d,D,[F(b,16),F(_,16),p])}B.destroy();const U=E(r,y*u*4,!0),K=E(r,y*f*l*2*4,!0),j=E(r,y*f*l*2*4,!0);{const N=this.pipelines.colSlice;Y(r,N,O,U,y,_,0,u),Y(r,N,O,K,y,_,u,f*l*2),Y(r,N,O,j,y,_,u+f*l*2,f*l*2)}O.destroy();const G=E(r,(w+1)*p*m*l*2*g*4,!0),A=E(r,y*u*4,!0);{const N=new Uint32Array([b,u,m,g,f,l,c,w,p]).buffer,P=z(r,N),D=$(r,this.pipelines.cssd_fwd,[P,U,K,j,C,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,A,G]);I(r,this.pipelines.cssd_fwd,D,[w,m,p])}U.destroy(),K.destroy(),j.destroy(),C.destroy();const v=E(r,y*u*4,!0),k=E(r,y*4,!0);{const N=new ArrayBuffer(16);new Uint32Array(N,0,2).set([y,u]),new Float32Array(N,8,1).set([1e-6]);const P=z(r,N),D=$(r,this.pipelines.rmsnorm,[P,A,this.gpuWeights.normWeight,v,k]);I(r,this.pipelines.rmsnorm,D,[F(y,64),1,1])}A.destroy(),k.destroy();const S=E(r,y*a*4,!0);{const N=new Uint32Array([y,u,a]).buffer,P=z(r,N),D=Q(r,new Float32Array(a),!0),H=$(r,this.pipelines.linear,[P,v,this.gpuWeights.wOutProj,D,S]);I(r,this.pipelines.linear,H,[F(y,16),F(a,16),1]),D.destroy()}v.destroy();const W=E(r,y*a*4,!0);{const N=z(r,new Uint32Array([y*a]).buffer),P=$(r,this.pipelines.elAdd,[S,e,W,N]);I(r,this.pipelines.elAdd,P,[F(y*a,256),1,1])}return S.destroy(),{output:W,cache:{stateCarry:G}}}parameters(){const{dModel:e,dConv:t,nHeads:n,nGroups:r}=this.config,a=this.dInner,s=this.nComplex,d=t,i=n,c=r,u=a+2*c*s*2;return[{buf:this.gpuWeights.wInProj,numel:(a+2*c*s*2+i)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:u*d,name:"wConv"},{buf:this.gpuWeights.bConv,numel:u,name:"bConv"},{buf:this.gpuWeights.A_log,numel:i*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:i,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:i,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*a,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:a,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const fn=`
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
`,Bt=`
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
`,ss=`
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
`,mn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,pn=`
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
`;class gn{layerType="attention";device;config;dHead;gpuWeights;pipelines;constructor(e,t){if(this.device=e,t.dModel%t.nHeads!==0)throw new Error(`AttentionBlock: dModel (${t.dModel}) must be divisible by nHeads (${t.nHeads}).`);this.config={dHead:t.dModel/t.nHeads,hasFfn:!1,ffnMult:4,...t},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,hasFfn:t,ffnMult:n}=this.config,r=(i,c=.02)=>be(i,c),a=i=>new Float32Array(i),s=i=>new Float32Array(i).fill(1),d=i=>Q(this.device,i,!0);if(this.gpuWeights={wQKV:d(r(3*e*e)),bQKV:d(a(3*e)),wO:d(r(e*e)),bO:d(a(e)),normWeight:d(s(e))},t){const i=e*n;this.gpuWeights.wFfn1=d(r(i*e)),this.gpuWeights.bFfn1=d(a(i)),this.gpuWeights.wFfn2=d(r(e*i)),this.gpuWeights.bFfn2=d(a(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,Se,"linear_forward"),rmsnorm:R(e,ge,"rmsnorm_forward"),attn_fwd:R(e,Bt,"attention_forward"),attn_val:R(e,Bt,"attention_value"),softmax:R(e,fn,"softmax_forward"),colSlice:R(e,je,Re),elAdd:R(e,mn,"main")},this.config.hasFfn&&(this.pipelines.silu=R(e,pn,"silu_forward"))}forward(e,t,n){const r=this.device,{dModel:a,nHeads:s,hasFfn:d}=this.config,i=this.dHead,c=t,u=n,l=c*u,h=s,m=E(r,l*a*4,!0),f=E(r,l*4,!0);{const M=new ArrayBuffer(16);new Uint32Array(M,0,2).set([l,a]),new Float32Array(M,8,1).set([1e-6]);const B=z(r,M),C=$(r,this.pipelines.rmsnorm,[B,e,this.gpuWeights.normWeight,m,f]);I(r,this.pipelines.rmsnorm,C,[F(l,64),1,1])}f.destroy();const g=E(r,l*3*a*4,!0);{const M=new Uint32Array([l,a,3*a]).buffer,B=z(r,M),C=$(r,this.pipelines.linear,[B,m,this.gpuWeights.wQKV,this.gpuWeights.bQKV,g]);I(r,this.pipelines.linear,C,[F(l,16),F(3*a,16),1])}m.destroy();const p=E(r,l*a*4,!0),b=E(r,l*a*4,!0),y=E(r,l*a*4,!0);{const M=this.pipelines.colSlice;Y(r,M,g,p,l,3*a,0,a),Y(r,M,g,b,l,3*a,a,a),Y(r,M,g,y,l,3*a,2*a,a)}g.destroy();const _=E(r,c*h*u*u*4,!0);{const M=new Uint32Array([c,u,a,h,i]).buffer,B=z(r,M),C=$(r,this.pipelines.attn_fwd,[B,p,b,y,_,E(r,l*a*4,!0)]);I(r,this.pipelines.attn_fwd,C,[F(u,16),h,c])}{const M=new Uint32Array([u,u,1]).buffer,B=z(r,M),C=$(r,this.pipelines.softmax,[B,_]);I(r,this.pipelines.softmax,C,[u,h,c])}const w=E(r,l*a*4,!0);{const M=new Uint32Array([c,u,a,h,i]).buffer,B=z(r,M),C=$(r,this.pipelines.attn_val,[B,p,b,y,_,w]);I(r,this.pipelines.attn_val,C,[F(u,16),h,c])}p.destroy(),b.destroy(),y.destroy();const x=E(r,l*a*4,!0);{const M=new Uint32Array([l,a,a]).buffer,B=z(r,M),C=$(r,this.pipelines.linear,[B,w,this.gpuWeights.wO,this.gpuWeights.bO,x]);I(r,this.pipelines.linear,C,[F(l,16),F(a,16),1])}w.destroy();let L=E(r,l*a*4,!0);{const M=z(r,new Uint32Array([l*a]).buffer),B=$(r,this.pipelines.elAdd,[x,e,L,M]);I(r,this.pipelines.elAdd,B,[F(l*a,256),1,1])}if(x.destroy(),d){const{ffnMult:M}=this.config,B=a*M,C=E(r,l*B*4,!0);{const j=new Uint32Array([l,a,B]).buffer,G=z(r,j),A=$(r,this.pipelines.linear,[G,L,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,C]);I(r,this.pipelines.linear,A,[F(l,16),F(B,16),1])}const O=E(r,l*B*4,!0);{const j=z(r,new Uint32Array([l*B]).buffer),G=$(r,this.pipelines.silu,[j,C,O]);I(r,this.pipelines.silu,G,[F(l*B,256),1,1])}C.destroy();const U=E(r,l*a*4,!0);{const j=new Uint32Array([l,B,a]).buffer,G=z(r,j),A=$(r,this.pipelines.linear,[G,O,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,U]);I(r,this.pipelines.linear,A,[F(l,16),F(a,16),1])}O.destroy();const K=E(r,l*a*4,!0);{const j=z(r,new Uint32Array([l*a]).buffer),G=$(r,this.pipelines.elAdd,[U,L,K,j]);I(r,this.pipelines.elAdd,G,[F(l*a,256),1,1])}U.destroy(),L.destroy(),L=K}return{output:L,cache:{scores:_}}}parameters(){const{dModel:e,hasFfn:t,ffnMult:n}=this.config,r=[{buf:this.gpuWeights.wQKV,numel:3*e*e,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*e,name:"bQKV"},{buf:this.gpuWeights.wO,numel:e*e,name:"wO"},{buf:this.gpuWeights.bO,numel:e,name:"bO"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}];if(t){const a=e*n;r.push({buf:this.gpuWeights.wFfn1,numel:a*e,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:a,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:e*a,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:e,name:"bFfn2"})}return r}getTrainableParams(){return this.parameters()}setWSLAMode(e){}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}function Oe(o){const e=new ArrayBuffer(4),t=new Float32Array(e),n=new Uint32Array(e);t[0]=o;const r=n[0],a=r>>>31&1,s=r>>>23&255,d=r&8388607;if(s===255)return a<<15|31744|(d?512:0);const i=s-127+15;if(i>=31)return a<<15|31744;if(i<=0){if(i<-10)return a<<15;const c=14-i;return a<<15|(d|8388608)>>c}return a<<15|i<<10|d>>13}function ft(o){const e=o>>>15&1,t=o>>>10&31,n=o&1023;if(t===0){const s=n/1024*Math.pow(2,-14);return e?-s:s}if(t===31)return e?-1/0:n?NaN:1/0;const r=t-15,a=(1+n/1024)*Math.pow(2,r);return e?-a:a}function Ee(o){const e=new Uint16Array(o.length);for(let t=0;t<o.length;t++)e[t]=Oe(o[t]);return e}function Be(o){const e=new Float32Array(o.length);for(let t=0;t<o.length;t++)e[t]=ft(o[t]);return e}function _n(o){let e=0;for(let r=0;r<o.length;r++){const a=Math.abs(o[r]);a>e&&(e=a)}const t=e/127||1,n=new Int8Array(o.length);for(let r=0;r<o.length;r++)n[r]=Math.max(-128,Math.min(127,Math.round(o[r]/t)));return{data:n,scale:t}}function bn(o,e){const t=new Float32Array(o.length);for(let n=0;n<o.length;n++)t[n]=o[n]*e;return t}function is(o,e){const t=o.length/e,n=new Float32Array(e),r=new Int8Array(o.length);for(let a=0;a<e;a++){let s=0;const d=a*t;for(let i=0;i<t;i++){const c=Math.abs(o[d+i]);c>s&&(s=c)}n[a]=s/127||1;for(let i=0;i<t;i++)r[d+i]=Math.max(-128,Math.min(127,Math.round(o[d+i]/n[a])))}return{data:r,scales:n}}function ds(o,e,t){const n=o.length/t,r=new Float32Array(o.length);for(let a=0;a<t;a++){const s=a*n;for(let d=0;d<n;d++)r[s+d]=o[s+d]*e[a]}return r}function cs(o){return{fp32:o*4,fp16:o*2,int8:o*1}}const hr=1380144709,ot=8,wn=(()=>{const o=new Uint32Array(256);for(let e=0;e<256;e++){let t=e;for(let n=0;n<8;n++)t=t&1?3988292384^t>>>1:t>>>1;o[e]=t>>>0}return o})();function mt(o){let e=4294967295;for(let t=0;t<o.length;t++)e=wn[(e^o[t])&255]^e>>>8;return(e^4294967295)>>>0}function Ue(o){const e=new Uint8Array(o),t=new ArrayBuffer(e.length+ot);new Uint8Array(t).set(e,0);const r=new DataView(t);return r.setUint32(e.length,hr,!0),r.setUint32(e.length+4,mt(e),!0),t}function de(o){if(o.byteLength<ot)return{hasTrailer:!1,ok:!0,body:o};const e=new DataView(o),t=o.byteLength-ot;if(e.getUint32(t,!0)!==hr)return{hasTrailer:!1,ok:!0,body:o};const r=e.getUint32(t+4,!0),a=o.slice(0,t);return{hasTrailer:!0,ok:mt(new Uint8Array(a))===r,body:a}}const Dt=1296190035,yn={mamba1:0,mamba2:1,mamba3:2,attention:3},vn=["mamba1","mamba2","mamba3","attention"];class xn{device;config;gpuEmbedding;layers;layerSpecs;gpuFinalNorm;tiedEmbedding;gpuLMHeadBias;_lmHeadPipeline;_rmsnormPipeline;_embedPipeline;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...t},Et(this.config.seed);const n=t.layers??Array.from({length:t.numLayers},()=>({type:"mamba1"}));if(n.length!==t.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${n.length}) must equal numLayers (${t.numLayers}).`);this.layerSpecs=n;const{vocabSize:r,dModel:a}=this.config,s=be(r*a,1/Math.sqrt(a));this.gpuEmbedding=Q(e,s,!0),this.layers=n.map(d=>this._buildLayer(d)),Et(void 0),this.gpuFinalNorm=Q(e,new Float32Array(a).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=Q(e,new Float32Array(r),!0),this._lmHeadPipeline=R(e,Se,"linear_forward"),this._rmsnormPipeline=R(e,ge,"rmsnorm_forward"),this._embedPipeline=R(e,kn,"embed_lookup")}_buildLayer(e){const t=this.config;switch(e.type){case"mamba1":{const n={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,...t.defaultMamba1};return new an(this.device,{...n,...e.config??{}})}case"mamba2":{const n={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,...t.defaultMamba2};return new cn(this.device,{...n,...e.config??{}})}case"mamba3":{const n={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,mimoGroup:t.mimoGroup,...t.defaultMamba3};return new hn(this.device,{...n,...e.config??{}})}case"attention":{const n={dModel:t.dModel,nHeads:t.nHeads,...t.defaultAttention};return new gn(this.device,{...n,...e.config??{}})}}}embedTokens(e,t,n){const{dModel:r}=this.config,a=t*n,s=Q(this.device,e instanceof Uint32Array?e:new Uint32Array(e),!1),d=E(this.device,a*r*4,!0),i=z(this.device,new Uint32Array([a,r]).buffer),c=$(this.device,this._embedPipeline,[i,s,this.gpuEmbedding,d]);return I(this.device,this._embedPipeline,c,[F(a,64),1,1]),s.destroy(),i.destroy(),d}async forward(e,t,n){const{dModel:r,vocabSize:a}=this.config,s=t*n;let d=this.embedTokens(e,t,n);const i=[];for(const m of this.layers){const{output:f,cache:g}=m.forward(d,t,n);i.push(g),d.destroy(),d=f}const c=E(this.device,s*r*4,!0),u=E(this.device,s*4,!1);{const m=new ArrayBuffer(16);new Uint32Array(m,0,2).set([s,r]),new Float32Array(m,8,1).set([1e-6]);const f=z(this.device,m),g=$(this.device,this._rmsnormPipeline,[f,d,this.gpuFinalNorm,c,u]);I(this.device,this._rmsnormPipeline,g,[F(s,64),1,1])}d.destroy();const l=E(this.device,s*a*4,!0);{const m=new Uint32Array([s,r,a]).buffer,f=z(this.device,m),g=$(this.device,this._lmHeadPipeline,[f,c,this.gpuEmbedding,this.gpuLMHeadBias,l]);I(this.device,this._lmHeadPipeline,g,[F(s,16),F(a,16),1])}return c.destroy(),u.destroy(),{logits:await ie(this.device,l,s*a*4),gpuLogits:l,caches:i}}async embed(e){const{dModel:t}=this.config,n=e.length,r=1,a=r*n;if(a===0)return new Float32Array(t);let s=this.embedTokens(e,r,n);for(const h of this.layers){const{output:m}=h.forward(s,r,n);s.destroy(),s=m}const d=E(this.device,a*t*4,!0),i=E(this.device,a*4,!1);{const h=new ArrayBuffer(16);new Uint32Array(h,0,2).set([a,t]),new Float32Array(h,8,1).set([1e-6]);const m=z(this.device,h),f=$(this.device,this._rmsnormPipeline,[m,s,this.gpuFinalNorm,d,i]);I(this.device,this._rmsnormPipeline,f,[F(a,64),1,1])}s.destroy();const c=await ie(this.device,d,a*t*4);d.destroy(),i.destroy();const u=new Float32Array(t);for(let h=0;h<n;h++){const m=h*t;for(let f=0;f<t;f++)u[f]+=c[m+f]}for(let h=0;h<t;h++)u[h]/=n;let l=0;for(let h=0;h<t;h++)l+=u[h]*u[h];l=Math.sqrt(l)||1;for(let h=0;h<t;h++)u[h]/=l;return u}async generate(e,t=200,n={}){const{temperature:r=1,topK:a=50,topP:s=.9}=n,{vocabSize:d}=this.config,i=[...e];for(let c=0;c<t;c++){const{logits:u}=await this.forward(new Uint32Array(i),1,i.length),l=u.slice((i.length-1)*d,i.length*d),h=An(l,{temperature:r,topK:a,topP:s});if(i.push(h),h===this.config.eosId)break}return i}parameters(){const e=[];e.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let t=0;t<this.layers.length;t++)for(const n of this.layers[t].parameters())e.push({...n,name:`layer${t}.${n.name}`});return e.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),e}getTrainableParams(){if(!this._wslaMode)return this.parameters();const e=[];for(let t=0;t<this.layers.length;t++)for(const n of this.layers[t].getTrainableParams())e.push({...n,name:`layer${t}.${n.name}`});return e}setWSLAMode(e){for(const t of this.layers)t.setWSLAMode(e);this._wslaMode=e}async exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.length,a=this.layers.length,s=await Promise.all(n.map(g=>ie(this.device,g.buf,g.numel*4))),d=Math.ceil(a/4)*4,i=12+d+4+r*4,c=t?2:4,l=s.reduce((g,p)=>g+p.length,0)*c,h=new ArrayBuffer(i+l),m=new DataView(h);let f=0;m.setUint32(f,Dt,!0),f+=4,m.setUint32(f,t?3:2,!0),f+=4,m.setUint32(f,a,!0),f+=4;for(let g=0;g<a;g++){const p=this.layers[g].layerType;m.setUint8(f+g,yn[p])}f+=d,m.setUint32(f,r,!0),f+=4;for(const g of n)m.setUint32(f,g.numel,!0),f+=4;if(t)for(const g of s){const p=Ee(g);new Uint16Array(h,f,p.length).set(p),f+=p.length*2}else for(const g of s)new Float32Array(h,f,g.length).set(g),f+=g.byteLength;return Ue(h)}async loadWeights(e){const t=de(e);if(t.hasTrailer&&!t.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const n=new DataView(e);let r=0;const a=n.getUint32(r,!0);if(r+=4,a!==Dt)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const s=n.getUint32(r,!0);if(r+=4,s===1){const d=n.getUint32(r,!0);r+=4;const i=this.parameters();if(d!==i.length)throw new Error(`Weight file has ${d} parameters but this model has ${i.length}.`);const c=[];for(let u=0;u<d;u++)c.push(n.getUint32(r,!0)),r+=4;for(let u=0;u<d;u++){const l=i[u],h=c[u];if(h!==l.numel)throw new Error(`Parameter ${u} ("${l.name}") size mismatch: file=${h}, model=${l.numel}.`);pe(this.device,l.buf,new Float32Array(e,r,l.numel)),r+=l.numel*4}return}if(s===2||s===3){const d=s===3,i=n.getUint32(r,!0);if(r+=4,i!==this.layers.length)throw new Error(`Weight file has ${i} layers but this model has ${this.layers.length}.`);for(let m=0;m<i;m++){const f=n.getUint8(r+m),g=this.layers[m].layerType,p=vn[f]??"mamba1";if(p!==g)throw new Error(`Layer ${m} type mismatch: file="${p}", model="${g}".`)}const c=Math.ceil(i/4)*4;r+=c;const u=n.getUint32(r,!0);r+=4;const l=this.parameters();if(u!==l.length)throw new Error(`Weight file has ${u} parameters but this model has ${l.length}.`);const h=[];for(let m=0;m<u;m++)h.push(n.getUint32(r,!0)),r+=4;for(let m=0;m<u;m++){const f=l[m],g=h[m];if(g!==f.numel)throw new Error(`Parameter ${m} ("${f.name}") size mismatch: file=${g}, model=${f.numel}.`);if(d){const p=new Uint16Array(e,r,g);pe(this.device,f.buf,Be(p)),r+=g*2}else pe(this.device,f.buf,new Float32Array(e,r,f.numel)),r+=g*4}return}throw new Error(`Unsupported MBJS version: ${s}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const e of this.layers)e.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class ls extends xn{constructor(e,t){super(e,{...t,layers:Array.from({length:t.numLayers},()=>({type:"mamba1"}))})}}const kn=`
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
`;function An(o,{temperature:e=1,topK:t=50,topP:n=.9}={}){const r=o.length,a=new Float32Array(r);for(let p=0;p<r;p++)a[p]=o[p]/Math.max(e,1e-7);let s=-1/0;for(let p=0;p<r;p++)a[p]>s&&(s=a[p]);let d=0;const i=new Float32Array(r);for(let p=0;p<r;p++)i[p]=Math.exp(a[p]-s),d+=i[p];const u=Array.from({length:r},(p,b)=>b).sort((p,b)=>i[b]-i[p]).slice(0,t);let l=0;const h=[];for(const p of u)if(l+=i[p]/d,h.push(p),l>=n)break;let m=0;for(const p of h)m+=i[p];const f=Math.random()*m;let g=0;for(const p of h)if(g+=i[p],g>=f)return p;return h[h.length-1]}const Mn={modelDim:64,hiddenDim:128,numExperts:8,topK:2},Ln=1299137793,Ft=1299137840;function Sn(o){return o>0?o:0}class Ct{modelDim;hiddenDim;w1;b1;w2;b2;gW1;gB1;gW2;gB2;constructor(e,t,n){this.modelDim=e,this.hiddenDim=t,this.w1=n(t*e,Math.sqrt(2/e)),this.b1=new Float32Array(t),this.w2=n(e*t,.02),this.b2=new Float32Array(e),this.gW1=new Float32Array(this.w1.length),this.gB1=new Float32Array(this.b1.length),this.gW2=new Float32Array(this.w2.length),this.gB2=new Float32Array(this.b2.length)}forward(e){const{modelDim:t,hiddenDim:n}=this,r=new Float32Array(n),a=new Float32Array(n);for(let d=0;d<n;d++){let i=this.b1[d];const c=d*t;for(let u=0;u<t;u++)i+=this.w1[c+u]*e[u];r[d]=i,a[d]=Sn(i)}const s=new Float32Array(t);for(let d=0;d<t;d++){let i=this.b2[d];const c=d*n;for(let u=0;u<n;u++)i+=this.w2[c+u]*a[u];s[d]=i}return{y:s,pre:r,h:a}}backward(e,t,n,r){const{modelDim:a,hiddenDim:s}=this,d=new Float32Array(s);for(let c=0;c<a;c++){const u=e[c];this.gB2[c]=this.gB2[c]+u;const l=c*s;for(let h=0;h<s;h++)this.gW2[l+h]=this.gW2[l+h]+u*r[h],d[h]=d[h]+u*this.w2[l+h]}const i=new Float32Array(a);for(let c=0;c<s;c++){const u=n[c]>0?d[c]:0;this.gB1[c]=this.gB1[c]+u;const l=c*a;for(let h=0;h<a;h++)this.gW1[l+h]=this.gW1[l+h]+u*t[h],i[h]=i[h]+u*this.w1[l+h]}return i}params(){return[this.w1,this.b1,this.w2,this.b2]}grads(){return[this.gW1,this.gB1,this.gW2,this.gB2]}}class En{numExperts;counts;probSum;tokens=0;constructor(e){this.numExperts=e,this.counts=new Float32Array(e),this.probSum=new Float32Array(e)}observe(e){this.tokens++;for(const t of e.experts)this.counts[t]=this.counts[t]+1;for(let t=0;t<this.numExperts;t++)this.probSum[t]=this.probSum[t]+e.probs[t]}dispatchFractions(){const e=this.counts.reduce((t,n)=>t+n,0)||1;return Float32Array.from(this.counts,t=>t/e)}loss(){if(this.tokens===0)return 0;const e=this.dispatchFractions();let t=0;for(let n=0;n<this.numExperts;n++)t+=e[n]*(this.probSum[n]/this.tokens);return this.numExperts*t}}class fr{config;wr;gWr;shared;experts;constructor(e={}){const t={...Mn,...e};if(t.topK>t.numExperts)throw new Error(`MoE topK (${t.topK}) must be ≤ numExperts (${t.numExperts})`);if(t.topK<1)throw new Error(`MoE topK must be ≥ 1 (got ${t.topK})`);this.config=t;const n=new re((e.seed??Ln)>>>0||1),r=(a,s)=>{const d=new Float32Array(a);for(let i=0;i<a;i++){const c=Math.max(n.next(),1e-12),u=n.next();d[i]=s*Math.sqrt(-2*Math.log(c))*Math.cos(2*Math.PI*u)}return d};this.wr=r(t.numExperts*t.modelDim,.02),this.gWr=new Float32Array(this.wr.length),this.shared=new Ct(t.modelDim,t.hiddenDim,r),this.experts=Array.from({length:t.numExperts},()=>new Ct(t.modelDim,t.hiddenDim,r))}route(e){const{numExperts:t,topK:n,modelDim:r}=this.config,a=new Float32Array(t);for(let l=0;l<t;l++){let h=0;const m=l*r;for(let f=0;f<r;f++)h+=this.wr[m+f]*e[f];a[l]=h}const s=Pt(a),i=Array.from({length:t},(l,h)=>h).sort((l,h)=>a[h]-a[l]).slice(0,n),c=i.map(l=>a[l]),u=Pt(Float32Array.from(c));return{experts:i,gates:Array.from(u),probs:s}}forward(e){const{modelDim:t}=this.config,n=Float32Array.from({length:t},(u,l)=>e[l]??0),r=this.route(n),a=this.shared.forward(n),s=Float32Array.from(a.y),d=[],i=[],c=[];for(let u=0;u<r.experts.length;u++){const h=this.experts[r.experts[u]].forward(n),m=r.gates[u];for(let f=0;f<t;f++)s[f]=s[f]+m*h.y[f];d.push(h.y),i.push(h.pre),c.push(h.h)}return{output:s,route:r,cache:{x:n,route:r,sharedPre:a.pre,sharedH:a.h,expertOut:d,expertPre:i,expertH:c}}}backward(e,t){const{modelDim:n}=this.config,r=Float32Array.from({length:n},(l,h)=>e[h]??0),a=new Float32Array(n),s=this.shared.backward(r,t.x,t.sharedPre,t.sharedH);for(let l=0;l<n;l++)a[l]=a[l]+s[l];const d=t.route.experts.length,i=new Float32Array(d);for(let l=0;l<d;l++){const h=t.route.gates[l],m=new Float32Array(n);let f=0;for(let p=0;p<n;p++)m[p]=h*r[p],f+=r[p]*t.expertOut[l][p];const g=this.experts[t.route.experts[l]].backward(m,t.x,t.expertPre[l],t.expertH[l]);for(let p=0;p<n;p++)a[p]=a[p]+g[p];i[l]=f}const c=t.route.gates;let u=0;for(let l=0;l<d;l++)u+=c[l]*i[l];for(let l=0;l<d;l++){const h=c[l]*(i[l]-u),f=t.route.experts[l]*n;for(let g=0;g<n;g++)this.gWr[f+g]=this.gWr[f+g]+h*t.x[g],a[g]=a[g]+h*this.wr[f+g]}return a}auxGradStep(e,t,n,r){const{numExperts:a,modelDim:s}=this.config;let d=0;for(let i=0;i<a;i++)d+=n[i]*t[i];for(let i=0;i<a;i++){const c=r*t[i]*(n[i]-d);if(c===0)continue;const u=i*s;for(let l=0;l<s;l++)this.gWr[u+l]=this.gWr[u+l]+c*e[l]}}parameters(){const e=[{name:"wr",data:this.wr,numel:this.wr.length}],t=(n,r)=>{const a=["w1","b1","w2","b2"];r.params().forEach((s,d)=>e.push({name:`${n}.${a[d]}`,data:s,numel:s.length}))};return t("shared",this.shared),this.experts.forEach((n,r)=>t(`expert${r}`,n)),e}gradients(){const e=[{name:"wr",data:this.gWr,numel:this.gWr.length}],t=(n,r)=>{const a=["w1","b1","w2","b2"];r.grads().forEach((s,d)=>e.push({name:`${n}.${a[d]}`,data:s,numel:s.length}))};return t("shared",this.shared),this.experts.forEach((n,r)=>t(`expert${r}`,n)),e}zeroGrad(){for(const e of this.gradients())e.data.fill(0)}exportExpert(e){const t=this.experts[e];if(!t)throw new Error(`exportExpert: index ${e} out of range (0..${this.config.numExperts-1})`);const n=["w1","b1","w2","b2"];return t.params().map((r,a)=>({name:n[a],data:r,numel:r.length}))}exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.reduce((l,h)=>l+h.numel,0),a=6,s=a*4,d=new ArrayBuffer(s+(t?r*2:r*4)),i=new Uint32Array(d,0,a);i[0]=Ft,i[1]=t?2:1,i[2]=this.config.modelDim,i[3]=this.config.hiddenDim,i[4]=this.config.numExperts,i[5]=this.config.topK;const c=new Float32Array(r);let u=0;for(const l of n)c.set(l.data,u),u+=l.numel;return t?new Uint16Array(d,s,r).set(Ee(c)):new Float32Array(d,s,r).set(c),d}loadWeights(e){const t=new Uint32Array(e,0,6);if(t[0]!==Ft)throw new Error("SharedExpertMoE.loadWeights: bad magic (not an MoE0 checkpoint)");const[,n,r,a,s,d]=t;if(r!==this.config.modelDim||a!==this.config.hiddenDim||s!==this.config.numExperts||d!==this.config.topK)throw new Error("SharedExpertMoE.loadWeights: config mismatch with checkpoint");const i=this.parameters(),c=i.reduce((m,f)=>m+f.numel,0),u=24,l=n===2?Be(new Uint16Array(e,u,c)):new Float32Array(e.slice(u,u+c*4));let h=0;for(const m of i)m.data.set(l.subarray(h,h+m.numel)),h+=m.numel}}function Pt(o){let e=-1/0;for(let r=0;r<o.length;r++)o[r]>e&&(e=o[r]);const t=new Float32Array(o.length);let n=0;for(let r=0;r<o.length;r++)t[r]=Math.exp(o[r]-e),n+=t[r];for(let r=0;r<o.length;r++)t[r]=t[r]/n;return t}class pt{target;m=[];v=[];t=0;opt;shard;constructor(e,t={}){this.target=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0};const n=t.shard??null;if(n&&(n.count<=0||n.index<0||n.index>=n.count))throw new Error(`AdamW: invalid shard ${n.index}/${n.count}`);this.shard=n;const r=e.parameters();for(let a=0;a<r.length;a++)this._owns(a)?(this.m.push(new Float32Array(r[a].data.length)),this.v.push(new Float32Array(r[a].data.length))):(this.m.push(null),this.v.push(null))}_owns(e){return this.shard===null||e%this.shard.count===this.shard.index}step(){this.t++;const{lr:e,beta1:t,beta2:n,eps:r,weightDecay:a}=this.opt,s=this.target.parameters(),d=this.target.gradients(),i=1-Math.pow(t,this.t),c=1-Math.pow(n,this.t);for(let u=0;u<s.length;u++){if(!this._owns(u))continue;const l=s[u].data,h=d[u].data,m=this.m[u],f=this.v[u];for(let g=0;g<l.length;g++){const p=h[g];m[g]=t*m[g]+(1-t)*p,f[g]=n*f[g]+(1-n)*p*p;const b=m[g]/i,y=f[g]/c;l[g]=l[g]-e*(b/(Math.sqrt(y)+r)+a*l[g])}}}stateBytes(){let e=0;for(const t of this.m)t&&(e+=t.byteLength);for(const t of this.v)t&&(e+=t.byteLength);return e}}function Xe(o,e,t,n,r){const{lr:a,beta1:s,beta2:d,eps:i,weightDecay:c,beta1_t:u,beta2_t:l,maxDelta:h}=r,m=r.gradScale??1,f=1-u,g=1-l;for(let p=0;p<o.length;p++){const b=e[p]*m,y=s*t[p]+(1-s)*b,_=d*n[p]+(1-d)*b*b;t[p]=y,n[p]=_;let w=a*(y/f)/(Math.sqrt(_/g)+i);Number.isFinite(w)||(w=0),h>0&&(w=Math.min(h,Math.max(-h,w))),o[p]=o[p]*(1-a*c)-w}}class us{model;adam;opt;constructor(e,t={}){this.model=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0,auxWeight:t.auxWeight??.01,batchSize:t.batchSize??0,epochs:t.epochs??1},this.adam=new pt(e,this.opt)}fit(e){const t=[];for(let n=0;n<this.opt.epochs;n++)t.push(this.runEpoch(e));return t}runEpoch(e){const t=this.opt.batchSize>0?this.opt.batchSize:e.length,{numExperts:n,modelDim:r}=this.model.config;let a=0,s=0;for(let d=0;d<e.length;d+=t){const i=e.slice(d,d+t);this.model.zeroGrad();const c=[],u=[],l=new En(n);let h=0;for(const g of i){const p=this.model.forward(g.input),b=new Float32Array(r);for(let y=0;y<r;y++){const _=p.output[y]-(g.target[y]??0);b[y]=_,h+=.5*_*_}this.model.backward(b,p.cache),c.push(p.cache.x),u.push(p.route.probs),l.observe(p.route)}const m=l.dispatchFractions(),f=this.opt.auxWeight*n/i.length;for(let g=0;g<c.length;g++)this.model.auxGradStep(c[g],u[g],m,f);this.scaleGradients(1/i.length),this.adam.step(),a+=h,s=l.loss()}return{loss:a/Math.max(1,e.length),auxLoss:s}}scaleGradients(e){if(e!==1)for(const t of this.model.gradients())for(let n=0;n<t.data.length;n++)t.data[n]=t.data[n]*e}}let Me=[],gt=!0;class hs{data;shape;numel;requiresGrad;grad;_gradFn;constructor(e,t,n=!1){this.data=e,this.shape=t,this.numel=t.reduce((r,a)=>r*a,1),this.requiresGrad=n,this.grad=null,this._gradFn=null}get byteSize(){return this.numel*4}zeroGrad(e){this.grad&&e.queue.writeBuffer(this.grad,0,new Float32Array(this.numel))}destroy(){this.data?.destroy(),this.grad?.destroy(),this.data=null,this.grad=null}}function fs(){gt=!0}function ms(){gt=!1}function Bn(){Me=[]}function ps(o){return gt?(Me.push({backward:o}),Me.length-1):-1}async function gs(){for(let o=Me.length-1;o>=0;o--)await Me[o].backward();Bn()}function we(o,e){let t=-1/0;for(let a=0;a<o.length;a++)o[a]>t&&(t=o[a]);let n=0;for(let a=0;a<o.length;a++)n+=Math.exp(o[a]-t);return Math.log(n)+t-o[e]}function mr(o,e){let t=-1/0;for(let s=0;s<o.length;s++)o[s]>t&&(t=o[s]);let n=0;const r=new Float32Array(o.length);for(let s=0;s<o.length;s++)r[s]=Math.exp(o[s]-t),n+=r[s];const a=new Float32Array(o.length);for(let s=0;s<o.length;s++)a[s]=r[s]/n;return a[e]=(a[e]??0)-1,a}function pr(o){return ft(Oe(o))}function _s(o){const e=new Float32Array(o.length);for(let t=0;t<o.length;t++)e[t]=pr(o[t]);return e}class Dn{_scale;growthFactor;backoffFactor;growthInterval;minScale;cleanStreak=0;_overflows=0;_skipped=0;constructor(e={}){this._scale=e.initScale??16384,this.growthFactor=e.growthFactor??2,this.backoffFactor=e.backoffFactor??.5,this.growthInterval=e.growthInterval??200,this.minScale=e.minScale??1}get scale(){return this._scale}get overflows(){return this._overflows}get skipped(){return this._skipped}check(e){for(const t of e){const n=t.data;for(let r=0;r<n.length;r++){const a=n[r];if(!Number.isFinite(a))return!0}}return!1}unscale(e){const t=1/this._scale;for(const n of e){const r=n.data;for(let a=0;a<r.length;a++)r[a]=r[a]*t}}update(e){return e?(this._overflows++,this._skipped++,this._scale=Math.max(this.minScale,this._scale*this.backoffFactor),this.cleanStreak=0,!1):(++this.cleanStreak>=this.growthInterval&&(this._scale*=this.growthFactor,this.cleanStreak=0),!0)}}const gr=809784901,Fn=1;function _r(o,e,t,n=0){if(o.length!==e.length)throw new Error(`computeRowDelta: length mismatch (base ${o.length}, current ${e.length})`);if(t<=0||o.length%t!==0)throw new Error(`computeRowDelta: base length ${o.length} is not a multiple of rowSize ${t}`);const r=o.length/t,a=[];for(let d=0;d<r;d++){const i=d*t;let c=!1;for(let u=0;u<t;u++)if(Math.abs(e[i+u]-o[i+u])>n){c=!0;break}c&&a.push(d)}const s=new Float32Array(a.length*t);return a.forEach((d,i)=>s.set(e.subarray(d*t,d*t+t),i*t)),{rowSize:t,rows:a,data:s}}function br(o,e){if(o.length%e.rowSize!==0)throw new Error(`applyRowDelta: base length ${o.length} is not a multiple of rowSize ${e.rowSize}`);const t=Float32Array.from(o);return e.rows.forEach((n,r)=>{const a=n*e.rowSize;if(a+e.rowSize>t.length)throw new Error(`applyRowDelta: row ${n} out of range for base of ${t.length} elements`);t.set(e.data.subarray(r*e.rowSize,r*e.rowSize+e.rowSize),a)}),t}function _t(o){const e=o.rows.length,n=4*4,r=e*4,a=o.data.length*4,s=new ArrayBuffer(n+r+a),d=new DataView(s);d.setUint32(0,gr,!0),d.setUint32(4,Fn,!0),d.setUint32(8,o.rowSize,!0),d.setUint32(12,e,!0);let i=n;for(const c of o.rows)d.setUint32(i,c,!0),i+=4;return new Float32Array(s,i,o.data.length).set(o.data),Ue(s)}function Cn(o,e){const t=de(o);if(t.hasTrailer&&!t.ok)throw new Error("diffCheckpoints: base failed CRC integrity check");const n=de(e);if(n.hasTrailer&&!n.ok)throw new Error("diffCheckpoints: current failed CRC integrity check");if(t.body.byteLength!==n.body.byteLength)throw new Error(`diffCheckpoints: shape mismatch (base ${t.body.byteLength}B, current ${n.body.byteLength}B) — only same-config checkpoints can be diffed`);if(t.body.byteLength%4!==0)throw new Error("diffCheckpoints: checkpoint body is not 4-byte aligned (not an f32 checkpoint)");return _t(_r(new Float32Array(t.body),new Float32Array(n.body),1))}function wr(o,e){const t=de(o);if(t.hasTrailer&&!t.ok)throw new Error("applyCheckpointDiff: base failed CRC integrity check");const n=br(new Float32Array(t.body),Ge(e)),r=new ArrayBuffer(n.byteLength);return new Float32Array(r).set(n),Ue(r)}function Ge(o){const e=de(o);if(e.hasTrailer&&!e.ok)throw new Error("deserializeRowDelta: failed CRC integrity check (corrupt or truncated)");const t=e.body,n=new DataView(t);if(n.getUint32(0,!0)!==gr)throw new Error("deserializeRowDelta: bad magic (not an EVD0 delta)");const r=n.getUint32(8,!0),a=n.getUint32(12,!0);let s=16;const d=[];for(let c=0;c<a;c++)d.push(n.getUint32(s,!0)),s+=4;const i=new Float32Array(t.slice(s,s+a*r*4));return{rowSize:r,rows:d,data:i}}const ye={dModel:64,numLayers:2,convKernel:3,hiddenDim:128,numExperts:4,topK:2},Pn=1163283533,Tt=1163283504;class Ke{config;_positionsEvaluated=0;emb;gEmb;conv;gConv;nConv;gNConv;nMoe;gNMoe;moe;constructor(e){const t=e.dModel??ye.dModel,n={vocabSize:e.vocabSize,dModel:t,numLayers:e.numLayers??ye.numLayers,convKernel:e.convKernel??ye.convKernel,hiddenDim:e.hiddenDim??t*2,numExperts:e.numExperts??ye.numExperts,topK:e.topK??ye.topK};if(n.vocabSize<=0)throw new Error("EvermindLM: vocabSize must be > 0");if(n.topK>n.numExperts)throw new Error("EvermindLM: topK must be ≤ numExperts");this.config=n;const r=(e.seed??Pn)>>>0||1,a=new re(r),s=(d,i)=>{const c=new Float32Array(d);for(let u=0;u<d;u++){const l=Math.max(a.next(),1e-12),h=a.next();c[u]=i*Math.sqrt(-2*Math.log(l))*Math.cos(2*Math.PI*h)}return c};this.emb=s(n.vocabSize*n.dModel,.02),this.gEmb=new Float32Array(this.emb.length),this.conv=[],this.gConv=[],this.nConv=[],this.gNConv=[],this.nMoe=[],this.gNMoe=[],this.moe=[];for(let d=0;d<n.numLayers;d++){const i=new Float32Array(n.dModel*n.convKernel);for(let c=0;c<n.dModel;c++)i[c*n.convKernel]=1;this.conv.push(i),this.gConv.push(new Float32Array(i.length)),this.nConv.push(new Float32Array(n.dModel).fill(1)),this.gNConv.push(new Float32Array(n.dModel)),this.nMoe.push(new Float32Array(n.dModel).fill(1)),this.gNMoe.push(new Float32Array(n.dModel)),this.moe.push(new fr({modelDim:n.dModel,hiddenDim:n.hiddenDim,numExperts:n.numExperts,topK:n.topK,seed:r+1+d}))}}_embed(e){const{dModel:t}=this.config;return e.map(n=>{const r=new Float32Array(t),a=n*t;for(let s=0;s<t;s++)r[s]=this.emb[a+s];return r})}_forwardLayer(e,t){const n=t.length,r=[],a=[],s=[],d=[],i=[],c=[],u=[];for(let l=0;l<n;l++){const h=this._stepLayerPosition(e,t[l],r);a.push(h.normed),s.push(h.rmsConv),d.push(h.afterConv),i.push(h.rmsMoe),c.push(h.moeCache),u.push(h.out)}return{afterMoe:u,cache:{layerIn:t,normedConv:a,rmsConv:s,afterConv:d,rmsMoe:i,moeCache:c}}}_stepLayerPosition(e,t,n){const{dModel:r,convKernel:a}=this.config,s=this.conv[e],{y:d,r:i}=Nt(t,this.nConv[e]),c=Float32Array.from(t);for(let f=0;f<r;f++){let g=s[f*a]*d[f];for(let p=1;p<a;p++){const b=n[n.length-p];b&&(g+=s[f*a+p]*b[f])}c[f]=c[f]+g}for(n.push(d);n.length>a-1;)n.shift();const{y:u,r:l}=Nt(c,this.nMoe[e]),h=Float32Array.from(c),m=this.moe[e].forward(u);for(let f=0;f<r;f++)h[f]=h[f]+m.output[f];return this._positionsEvaluated++,{normed:d,rmsConv:i,afterConv:c,rmsMoe:l,moeCache:m.cache,out:h}}_embedOne(e){const{dModel:t}=this.config,n=new Float32Array(t),r=e*t;for(let a=0;a<t;a++)n[a]=this.emb[r+a];return n}_head(e){const{dModel:t,vocabSize:n}=this.config;return e.map(r=>{const a=new Float32Array(n);for(let s=0;s<n;s++){let d=0;const i=s*t;for(let c=0;c<t;c++)d+=r[c]*this.emb[i+c];a[s]=d}return a})}forward(e){let t=this._embed(e);const n=[];for(let r=0;r<this.config.numLayers;r++){const{afterMoe:a,cache:s}=this._forwardLayer(r,t);n.push(s),t=a}return{logits:this._head(t),cache:{tokens:e,layers:n,finalX:t}}}embed(e){const{dModel:t,numLayers:n}=this.config,r=new Float32Array(t),a=e.length;if(a===0)return r;const s=Array.from({length:n},()=>[]);for(let i=0;i<a;i++){let c=this._embedOne(e[i]);for(let u=0;u<n;u++)c=this._stepLayerPosition(u,c,s[u]).out;for(let u=0;u<t;u++)r[u]=r[u]+c[u]}for(let i=0;i<t;i++)r[i]=r[i]/a;let d=0;for(let i=0;i<t;i++)d+=r[i]*r[i];d=Math.sqrt(d)||1;for(let i=0;i<t;i++)r[i]=r[i]/d;return r}embedText(e,t){return this.embed(t.encode(e))}_headBackward(e,t,n){const{dModel:r,vocabSize:a}=this.config,s=e.length,d=s-1,i=1/d,c=Array.from({length:s},()=>new Float32Array(r));let u=0;for(let l=0;l<d;l++){const h=e[l+1];u+=we(t[l],h)*i;const m=mr(t[l],h),f=n[l];for(let g=0;g<a;g++){const p=m[g]*i;if(p===0)continue;const b=g*r;for(let y=0;y<r;y++)this.gEmb[b+y]=this.gEmb[b+y]+p*f[y],c[l][y]=c[l][y]+p*this.emb[b+y]}}return{loss:u,dX:c}}_backwardLayer(e,t,n){const{dModel:r,convKernel:a}=this.config,s=t.length,d=this.conv[e],i=this.gConv[e],c=this.nConv[e],u=this.gNConv[e],l=this.nMoe[e],h=this.gNMoe[e],m=[];for(let p=0;p<s;p++){const b=this.moe[e].backward(t[p],n.moeCache[p]),{dx:y,dgain:_}=$t(b,n.afterConv[p],n.rmsMoe[p],l);for(let x=0;x<r;x++)h[x]=h[x]+_[x];const w=Float32Array.from(t[p]);for(let x=0;x<r;x++)w[x]=w[x]+y[x];m.push(w)}const f=Array.from({length:s},()=>new Float32Array(r)),g=m.map(p=>Float32Array.from(p));for(let p=0;p<s;p++)for(let b=0;b<r;b++){const y=m[p][b];if(y!==0)for(let _=0;_<a;_++){const w=p-_;w<0||(i[b*a+_]=i[b*a+_]+y*n.normedConv[w][b],f[w][b]=f[w][b]+y*d[b*a+_])}}for(let p=0;p<s;p++){const{dx:b,dgain:y}=$t(f[p],n.layerIn[p],n.rmsConv[p],c);for(let _=0;_<r;_++)u[_]=u[_]+y[_],g[p][_]=g[p][_]+b[_]}return g}_embedBackward(e,t){const{dModel:n}=this.config;for(let r=0;r<e.length;r++){const a=e[r]*n;for(let s=0;s<n;s++)this.gEmb[a+s]=this.gEmb[a+s]+t[r][s]}}lossAndBackward(e){if(e.length<2)return 0;const{logits:t,cache:n}=this.forward(e),{loss:r,dX:a}=this._headBackward(e,t,n.finalX);let s=a;for(let d=this.config.numLayers-1;d>=0;d--)s=this._backwardLayer(d,s,n.layers[d]);return this._embedBackward(e,s),r}lossAndBackwardCheckpointed(e){if(e.length<2)return 0;let t=this._embed(e);const n=[];for(let i=0;i<this.config.numLayers;i++)n.push(t),t=this._forwardLayer(i,t).afterMoe;const r=this._head(t),{loss:a,dX:s}=this._headBackward(e,r,t);let d=s;for(let i=this.config.numLayers-1;i>=0;i--){const{cache:c}=this._forwardLayer(i,n[i]);d=this._backwardLayer(i,d,c)}return this._embedBackward(e,d),a}get positionsEvaluated(){return this._positionsEvaluated}resetStats(){this._positionsEvaluated=0}newDecodeState(){return{convWindow:Array.from({length:this.config.numLayers},()=>[]),length:0,lastLogits:null}}cloneDecodeState(e){return{convWindow:e.convWindow.map(t=>t.map(n=>Float32Array.from(n))),length:e.length,lastLogits:e.lastLogits?Float32Array.from(e.lastLogits):null}}stepDecode(e,t){const n=this.cloneDecodeState(e),r=[];for(const a of t){let s=this._embedOne(a);for(let i=0;i<this.config.numLayers;i++)s=this._stepLayerPosition(i,s,n.convWindow[i]).out;const d=this._head([s])[0];r.push(d),n.lastLogits=d,n.length++}return{logits:r,state:n}}prefixState(e){return this.stepDecode(this.newDecodeState(),e).state}scoreContinuation(e,t){if(t.length===0||!e.lastLogits)return-1/0;const{logits:n}=this.stepDecode(e,t.slice(0,-1));let r=It(e.lastLogits,t[0]);for(let a=1;a<t.length;a++)r+=It(n[a-1],t[a]);return r/t.length}generateText(e,t,n){return t.decode(this.generate(t.encode(e),n))}generate(e,t){const n=t.temperature??0,r=n>0?new re((t.seed??1)>>>0||1):null;let a=this.stepDecode(this.newDecodeState(),e.length>0?e:[0]).state;const s=[];for(let d=0;d<t.maxNewTokens;d++){const i=a.lastLogits,c=r?$n(i,n,r):Nn(i);if(s.push(c),t.stopToken!==void 0&&c===t.stopToken)break;a=this.stepDecode(a,[c]).state}return s}parameters(){const e=[{data:this.emb}];for(let t=0;t<this.config.numLayers;t++){e.push({data:this.conv[t]},{data:this.nConv[t]},{data:this.nMoe[t]});for(const n of this.moe[t].parameters())e.push({data:n.data})}return e}gradients(){const e=[{data:this.gEmb}];for(let t=0;t<this.config.numLayers;t++){e.push({data:this.gConv[t]},{data:this.gNConv[t]},{data:this.gNMoe[t]});for(const n of this.moe[t].gradients())e.push({data:n.data})}return e}zeroGrad(){this.gEmb.fill(0);for(let e=0;e<this.config.numLayers;e++)this.gConv[e].fill(0),this.gNConv[e].fill(0),this.gNMoe[e].fill(0),this.moe[e].zeroGrad()}exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.reduce((l,h)=>l+h.data.length,0),a=9,s=a*4,d=new ArrayBuffer(s+(t?r*2:r*4)),i=new Uint32Array(d,0,a);i[0]=Tt,i[1]=t?2:1,i[2]=this.config.vocabSize,i[3]=this.config.dModel,i[4]=this.config.numLayers,i[5]=this.config.convKernel,i[6]=this.config.hiddenDim,i[7]=this.config.numExperts,i[8]=this.config.topK;const c=new Float32Array(r);let u=0;for(const l of n)c.set(l.data,u),u+=l.data.length;return t?new Uint16Array(d,s,r).set(Ee(c)):new Float32Array(d,s,r).set(c),Ue(d)}loadWeights(e){this._setFlat(this._readFlat(e))}_readFlat(e){const t=de(e);if(t.hasTrailer&&!t.ok)throw new Error("EvermindLM.loadWeights: checkpoint failed CRC integrity check (corrupt or truncated)");const n=new Uint32Array(e,0,9);if(n[0]!==Tt)throw new Error("EvermindLM.loadWeights: bad magic (not an EVL0 checkpoint)");const r=n[1];if(n[2]!==this.config.vocabSize||n[3]!==this.config.dModel||n[4]!==this.config.numLayers||n[5]!==this.config.convKernel||n[6]!==this.config.hiddenDim||n[7]!==this.config.numExperts||n[8]!==this.config.topK)throw new Error("EvermindLM.loadWeights: config mismatch with checkpoint");const a=this.parameters().reduce((d,i)=>d+i.data.length,0),s=36;return r===2?Be(new Uint16Array(e,s,a)):new Float32Array(e.slice(s,s+a*4))}_flat(){const e=this.parameters(),t=e.reduce((a,s)=>a+s.data.length,0),n=new Float32Array(t);let r=0;for(const a of e)n.set(a.data,r),r+=a.data.length;return n}_setFlat(e){let t=0;for(const n of this.parameters())n.data.set(e.subarray(t,t+n.data.length)),t+=n.data.length}exportDelta(e,t={}){const n=this._readFlat(e),r=this._flat(),a=r.length%this.config.dModel===0?this.config.dModel:1;return _t(_r(n,r,a,t.eps??0))}loadDelta(e,t){const n=this._readFlat(e);this._setFlat(br(n,Ge(t)))}}class bt{model;opts;adam;scaler;grads;constructor(e,t={}){this.model=e,this.opts=t,this.adam=new pt(e,t),this.grads=e.gradients(),this.scaler=t.mixedPrecision?new Dn(typeof t.mixedPrecision=="object"?t.mixedPrecision:{}):null}get lossScaler(){return this.scaler}_backward(e){return this.opts.checkpoint?this.model.lossAndBackwardCheckpointed(e):this.model.lossAndBackward(e)}_scaleGrads(e){if(e===1)return;const t=1/e;for(const n of this.grads)for(let r=0;r<n.data.length;r++)n.data[r]=n.data[r]*t}_fp16Grads(){for(const e of this.grads)for(let t=0;t<e.data.length;t++)e.data[t]=pr(e.data[t])}_mulGrads(e){if(e!==1)for(const t of this.grads)for(let n=0;n<t.data.length;n++)t.data[n]=t.data[n]*e}fit(e){const t=this.opts.epochs??1,n=Math.max(1,this.opts.accumSteps??1),r=[];for(let a=0;a<t;a++){let s=0,d=0,i=0,c=this.scaler?this.scaler.scale:1;this.model.zeroGrad();const u=()=>{if(i!==0){if(this._scaleGrads(i),this.scaler){this._fp16Grads();const l=this.scaler.check(this.grads);this.scaler.update(l)&&(this._mulGrads(1/c),this.adam.step()),c=this.scaler.scale}else this.adam.step();this.model.zeroGrad(),i=0}};for(const l of e){if(l.length<2)continue;i===0&&this.scaler&&(c=this.scaler.scale);const h=this._backward(l);this._mulGrads(c),s+=h,d++,++i>=n&&u()}u(),r.push(d>0?s/d:0)}return r}}const Tn=1e-5;function Nt(o,e){const t=o.length;let n=0;for(let s=0;s<t;s++)n+=o[s]*o[s];const r=Math.sqrt(n/t+Tn),a=new Float32Array(t);for(let s=0;s<t;s++)a[s]=e[s]*o[s]/r;return{y:a,r}}function $t(o,e,t,n){const r=e.length;let a=0;for(let c=0;c<r;c++)a+=o[c]*n[c]*e[c];const s=new Float32Array(r),d=new Float32Array(r),i=t*t*t;for(let c=0;c<r;c++)s[c]=n[c]*o[c]/t-e[c]*a/(r*i),d[c]=o[c]*e[c]/t;return{dx:s,dgain:d}}function Nn(o){let e=0;for(let t=1;t<o.length;t++)o[t]>o[e]&&(e=t);return e}function $n(o,e,t){let n=-1/0;for(let d=0;d<o.length;d++)o[d]/e>n&&(n=o[d]/e);let r=0;const a=new Float32Array(o.length);for(let d=0;d<o.length;d++)a[d]=Math.exp(o[d]/e-n),r+=a[d];let s=t.next()*r;for(let d=0;d<a.length;d++)if(s-=a[d],s<=0)return d;return a.length-1}function It(o,e){let t=-1/0;for(let a=0;a<o.length;a++){const s=o[a];s>t&&(t=s)}if(!Number.isFinite(t))return-1/0;let n=0;for(let a=0;a<o.length;a++)n+=Math.exp(o[a]-t);return(e>=0&&e<o.length?o[e]:-1/0)-(t+Math.log(n))}const Te=0,Ye=1;class In{textVocabSize;levels;codebookSize;bosVideo;eosVideo;frameKey;frameDelta;codeBase;size;perBank;constructor(e){if(e.textVocabSize<0)throw new Error("MultimodalVocab: textVocabSize must be ≥ 0");if(e.levels<=0||e.codebookSize<=0)throw new Error("MultimodalVocab: levels and codebookSize must be > 0");this.textVocabSize=e.textVocabSize,this.levels=e.levels,this.codebookSize=e.codebookSize,this.bosVideo=e.textVocabSize,this.eosVideo=e.textVocabSize+1,this.frameKey=e.textVocabSize+2,this.frameDelta=e.textVocabSize+3,this.codeBase=e.textVocabSize+4,this.perBank=e.levels*e.codebookSize,this.size=this.codeBase+2*this.perBank}codeToken(e,t,n){return this.codeBase+e*this.perBank+t*this.codebookSize+n}isText(e){return e>=0&&e<this.textVocabSize}isCode(e){return e>=this.codeBase&&e<this.size}isVideoMarker(e){return e===this.frameKey||e===this.frameDelta}decodeCode(e){const t=e-this.codeBase,n=Math.floor(t/this.perBank),r=t-n*this.perBank,a=Math.floor(r/this.codebookSize),s=r-a*this.codebookSize;return{bank:n,level:a,code:s}}classify(e){return this.isText(e)?{kind:"text",id:e}:e===this.bosVideo?{kind:"control",control:"bosVideo"}:e===this.eosVideo?{kind:"control",control:"eosVideo"}:e===this.frameKey?{kind:"control",control:"frameKey"}:e===this.frameDelta?{kind:"control",control:"frameDelta"}:{kind:"code",...this.decodeCode(e)}}}const zt=1448235312,ce={channels:3,patch:4,levels:2,codebookSize:16,keyframeInterval:12,textVocabSize:0,seed:1448232529};class He{height;width;channels;patch;levels;codebookSize;keyframeInterval;latentDim;patchesPerFrame;tokensPerFrame;vocab;banks;constructor(e){const t=e.channels??ce.channels,n=e.patch??ce.patch;if(e.height<=0||e.width<=0)throw new Error("VideoRVQCodec: height/width must be > 0");if(e.height%n!==0||e.width%n!==0)throw new Error(`VideoRVQCodec: height/width must be divisible by patch (${n})`);this.height=e.height,this.width=e.width,this.channels=t,this.patch=n,this.levels=e.levels??ce.levels,this.codebookSize=e.codebookSize??ce.codebookSize,this.keyframeInterval=Math.max(1,e.keyframeInterval??ce.keyframeInterval),this.latentDim=n*n*t,this.patchesPerFrame=this.height/n*(this.width/n),this.tokensPerFrame=this.patchesPerFrame*this.levels,this.vocab=new In({textVocabSize:e.textVocabSize??ce.textVocabSize,levels:this.levels,codebookSize:this.codebookSize});const r=new re((e.seed??ce.seed)>>>0||1),a=()=>Array.from({length:this.levels},()=>{const s=new Float32Array(this.codebookSize*this.latentDim);for(let d=0;d<s.length;d++)s[d]=(r.next()-.5)*.1;return s});this.banks=[a(),a()];for(const s of this.banks[Te])for(let d=0;d<s.length;d++)s[d]+=.5}get vocabSize(){return this.vocab.size}serialize(){const t=2*this.levels*this.codebookSize*this.latentDim,n=new ArrayBuffer(36+t*4),r=new Uint32Array(n,0,9);r[0]=zt,r[1]=this.height,r[2]=this.width,r[3]=this.channels,r[4]=this.patch,r[5]=this.levels,r[6]=this.codebookSize,r[7]=this.keyframeInterval,r[8]=this.vocab.textVocabSize;const a=new Float32Array(n,36,t);let s=0;for(const d of this.banks)for(const i of d)a.set(i,s),s+=i.length;return n}static deserialize(e){const t=new Uint32Array(e,0,9);if(t[0]!==zt)throw new Error("VideoRVQCodec.deserialize: bad magic (not a VRQ0 blob)");const n=new He({height:t[1],width:t[2],channels:t[3],patch:t[4],levels:t[5],codebookSize:t[6],keyframeInterval:t[7],textVocabSize:t[8]}),r=2*n.levels*n.codebookSize*n.latentDim,a=new Float32Array(e.slice(36,36+r*4));let s=0;for(const d of n.banks)for(const i of d)i.set(a.subarray(s,s+i.length)),s+=i.length;return n}encode(e){this.assertShape(e);const t=[this.vocab.bosVideo];let n=null;for(let r=0;r<e.length;r++){const a=this.toPatches(e[r]),s=n===null||r%this.keyframeInterval===0,d=s?Te:Ye;t.push(s?this.vocab.frameKey:this.vocab.frameDelta);const i=[];for(let c=0;c<this.patchesPerFrame;c++){const u=s?a[c]:Wt(a[c],n[c]),{codes:l,recon:h}=this.rvqEncode(d,u);for(let m=0;m<this.levels;m++)t.push(this.vocab.codeToken(d,m,l[m]));i.push(s?h:jt(n[c],h))}n=i}return t.push(this.vocab.eosVideo),t}decode(e){const t=[];let n=null,r=0;for(;r<e.length&&!this.vocab.isVideoMarker(e[r]);){if(e[r]===this.vocab.eosVideo)return t;r++}for(;r<e.length;){const a=e[r];if(!this.vocab.isVideoMarker(a))break;r++;const s=a===this.vocab.frameKey||n===null,d=s?Te:Ye,i=[];for(;i.length<this.tokensPerFrame&&r<e.length&&this.vocab.isCode(e[r]);)i.push(e[r]),r++;const c=[];for(let u=0;u<this.patchesPerFrame;u++){const l=new Float32Array(this.latentDim);for(let h=0;h<this.levels;h++){const m=u*this.levels+h,f=m<i.length?i[m]:-1;if(f<0)continue;const{level:g,code:p}=this.vocab.decodeCode(f);zn(l,this.banks[d][g],p,this.latentDim)}c.push(s?l:jt(n[u],l))}t.push(this.fromPatches(c)),n=c}return t}fit(e,t={}){const n=t.iterations??8,r=new re((t.seed??1718187041)>>>0||1);for(const c of e)this.assertShape(c);const a=[],s=[];for(const c of e){let u=null;for(let l=0;l<c.length;l++){const h=this.toPatches(c[l]);if(u===null||l%this.keyframeInterval===0)for(const f of h)a.push(f);else for(let f=0;f<h.length;f++)s.push(Wt(h[f],u[f]));u=h}}this.fitBank(Te,a,n,r),this.fitBank(Ye,s,n,r);let d=0,i=0;for(const c of e){const u=this.decode(this.encode(c));for(let l=0;l<c.length;l++){const h=c[l],m=u[l];for(let f=0;f<h.length;f++){const g=h[f]-m[f];d+=g*g}i+=h.length}}return i>0?d/i:0}fitBank(e,t,n,r){if(t.length===0)return;let a=t.map(s=>Float32Array.from(s));for(let s=0;s<this.levels;s++){const d=jn(a,this.codebookSize,this.latentDim,n,r);this.banks[e][s]=d,a=a.map(i=>{const c=at(d,i,this.codebookSize,this.latentDim),u=Float32Array.from(i),l=c*this.latentDim;for(let h=0;h<this.latentDim;h++)u[h]=u[h]-d[l+h];return u})}}rvqEncode(e,t){const n=Float32Array.from(t),r=new Float32Array(this.latentDim),a=[];for(let s=0;s<this.levels;s++){const d=this.banks[e][s],i=at(d,n,this.codebookSize,this.latentDim);a.push(i);const c=i*this.latentDim;for(let u=0;u<this.latentDim;u++)r[u]=r[u]+d[c+u],n[u]=n[u]-d[c+u]}return{codes:a,recon:r}}toPatches(e){const{patch:t,channels:n,width:r}=this,a=this.width/t,s=this.height/t,d=[];for(let i=0;i<s;i++)for(let c=0;c<a;c++){const u=new Float32Array(this.latentDim);for(let l=0;l<t;l++)for(let h=0;h<t;h++){const m=i*t+l,f=c*t+h,g=(m*r+f)*n,p=(l*t+h)*n;for(let b=0;b<n;b++)u[p+b]=e[g+b]}d.push(u)}return d}fromPatches(e){const{patch:t,channels:n,width:r}=this,a=this.width/t,s=new Float32Array(this.height*this.width*n);for(let d=0;d<e.length;d++){const i=Math.floor(d/a),c=d-i*a,u=e[d];for(let l=0;l<t;l++)for(let h=0;h<t;h++){const m=i*t+l,f=c*t+h,g=(m*r+f)*n,p=(l*t+h)*n;for(let b=0;b<n;b++)s[g+b]=Wn(u[p+b])}}return s}assertShape(e){const t=this.height*this.width*this.channels;for(let n=0;n<e.length;n++)if(e[n].length!==t)throw new Error(`VideoRVQCodec: frame ${n} has length ${e[n].length}, expected ${t}`)}}function Wt(o,e){const t=new Float32Array(o.length);for(let n=0;n<o.length;n++)t[n]=o[n]-e[n];return t}function jt(o,e){const t=new Float32Array(o.length);for(let n=0;n<o.length;n++)t[n]=o[n]+e[n];return t}function zn(o,e,t,n){const r=t*n;for(let a=0;a<n;a++)o[a]=o[a]+e[r+a]}function Wn(o){return o<0?0:o>1?1:o}function at(o,e,t,n){let r=0,a=1/0;for(let s=0;s<t;s++){const d=s*n;let i=0;for(let c=0;c<n;c++){const u=e[c]-o[d+c];if(i+=u*u,i>=a)break}i<a&&(a=i,r=s)}return r}function jn(o,e,t,n,r){const a=new Float32Array(e*t);for(let i=0;i<e;i++){const c=o[Math.floor(r.next()*o.length)%o.length];a.set(c,i*t)}const s=new Float32Array(e*t),d=new Int32Array(e);for(let i=0;i<n;i++){s.fill(0),d.fill(0);for(const c of o){const u=at(a,c,e,t);d[u]=d[u]+1;const l=u*t;for(let h=0;h<t;h++)s[l+h]=s[l+h]+c[h]}for(let c=0;c<e;c++){const u=c*t;if(d[c]===0){const h=o[Math.floor(r.next()*o.length)%o.length];a.set(h,u);continue}const l=1/d[c];for(let h=0;h<t;h++)a[u+h]=s[u+h]*l}}return a}function Rn(){const o=new Map,e=[[33,126],[161,172],[174,255]];let t=0;for(const[n,r]of e)for(let a=n;a<=r;a++)o.set(a,String.fromCodePoint(a));for(let n=0;n<256;n++)o.has(n)||(o.set(n,String.fromCodePoint(256+t)),t++);return o}const Ie=Rn(),On=new Map([...Ie].map(([o,e])=>[e,o])),Rt=/(?:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;class De{vocab;idToToken;merges;bosToken;eosToken;padToken;unkToken;bosId;eosId;padId;constructor(){this.vocab=new Map,this.idToToken=new Map,this.merges=new Map,this.bosToken="<|im_start|>",this.eosToken="<|im_end|>",this.padToken="<|endoftext|>",this.unkToken="<unk>",this.bosId=null,this.eosId=null,this.padId=null}async load(e,t){let n;typeof e=="string"?n=await(await fetch(e)).json():n=e,this.vocab=new Map(Object.entries(n).map(([a,s])=>[a,Number(s)])),this.idToToken=new Map([...this.vocab].map(([a,s])=>[s,a]));let r;typeof t=="string"?r=(await(await fetch(t)).text()).split(`
`).filter(d=>d&&!d.startsWith("#")):r=t,this.merges=new Map,r.forEach((a,s)=>{this.merges.set(a.trim(),s)}),this.bosId=this.vocab.get(this.bosToken)??null,this.eosId=this.vocab.get(this.eosToken)??null,this.padId=this.vocab.get(this.padToken)??null}train(e,t={}){const n=t.numMerges??200,r=t.minPairFreq??2,a=Array.isArray(e)?e:[e],s=new Map;for(const l of a)for(const h of l.match(Rt)??[]){const m=new TextEncoder().encode(h),f=Array.from(m).map(g=>Ie.get(g)??"?").join("");s.set(f,(s.get(f)??0)+1)}const d=[...s].map(([l,h])=>({syms:[...l],freq:h})),i=[];for(let l=0;l<n;l++){const h=new Map;for(const{syms:_,freq:w}of d)for(let x=0;x<_.length-1;x++){const L=_[x]+" "+_[x+1];h.set(L,(h.get(L)??0)+w)}let m="",f=0;for(const[_,w]of h)w>f&&(m=_,f=w);if(f<r)break;i.push(m);const g=m.indexOf(" "),p=m.slice(0,g),b=m.slice(g+1),y=p+b;for(const _ of d){const w=[];for(let x=0;x<_.syms.length;x++)x<_.syms.length-1&&_.syms[x]===p&&_.syms[x+1]===b?(w.push(y),x++):w.push(_.syms[x]);_.syms=w}}const c={};let u=0;for(const l of[this.unkToken,this.bosToken,this.eosToken,this.padToken])l in c||(c[l]=u++);for(const l of Ie.values())l in c||(c[l]=u++);for(const l of i){const h=l.split(" ").join("");h in c||(c[h]=u++)}this.loadFromObjects(c,i)}loadFromObjects(e,t){this.vocab=new Map(Object.entries(e).map(([n,r])=>[n,Number(r)])),this.idToToken=new Map([...this.vocab].map(([n,r])=>[r,n])),this.merges=new Map(t.map((n,r)=>[n,r])),this.bosId=this.vocab.get(this.bosToken)??null,this.eosId=this.vocab.get(this.eosToken)??null,this.padId=this.vocab.get(this.padToken)??null}loadHuggingFace(e,t={}){const n=e.model??e,r=n.vocab??e.vocab,a=n.merges??e.merges;if(!r||typeof r!="object")throw new Error("loadHuggingFace: missing model.vocab (expected a Hugging Face tokenizer.json)");if(!Array.isArray(a))throw new Error("loadHuggingFace: missing model.merges (expected a BPE tokenizer.json)");const s=a.map(d=>Array.isArray(d)?`${d[0]} ${d[1]}`:String(d));t.bos&&(this.bosToken=t.bos),t.eos&&(this.eosToken=t.eos),t.pad&&(this.padToken=t.pad),t.unk&&(this.unkToken=t.unk),this.loadFromObjects(r,s)}toObject(){return{vocab:Object.fromEntries(this.vocab),merges:[...this.merges.entries()].sort((e,t)=>e[1]-t[1]).map(([e])=>e),specials:{bos:this.bosToken,eos:this.eosToken,pad:this.padToken,unk:this.unkToken}}}loadFromSpec(e){const t=e.specials;t?.bos&&(this.bosToken=t.bos),t?.eos&&(this.eosToken=t.eos),t?.pad&&(this.padToken=t.pad),t?.unk&&(this.unkToken=t.unk),this.loadFromObjects(e.vocab,e.merges)}serialize(){const e=new TextEncoder().encode(JSON.stringify(this.toObject())),t=new ArrayBuffer(e.byteLength);return new Uint8Array(t).set(e),t}static deserialize(e){const t=JSON.parse(new TextDecoder().decode(new Uint8Array(e)));if(!t||typeof t.vocab!="object"||!Array.isArray(t.merges))throw new Error("BPETokenizer.deserialize: not a serialised BPE tokenizer (expected { vocab, merges })");const n=new De;return n.loadFromSpec(t),n}async loadHuggingFaceUrl(e,t={}){const n=await fetch(e);if(!n.ok)throw new Error(`loadHuggingFaceUrl: ${n.status} fetching ${e}`);const r=await n.json();this.loadHuggingFace(r,t)}encode(e,t={}){const n=e.match(Rt)??[],r=[];t.addBos&&this.bosId!==null&&r.push(this.bosId);for(const a of n){const s=new TextEncoder().encode(a),d=Array.from(s).map(c=>Ie.get(c)??"?").join(""),i=this._bpe(d);for(const c of i){const u=this.vocab.get(c);if(u!==void 0)r.push(u);else for(const l of c){const h=this.vocab.get(l);h!==void 0&&r.push(h)}}}return t.addEos&&this.eosId!==null&&r.push(this.eosId),r}decode(e){let t="";for(const r of e){const a=this.idToToken.get(r);a!==void 0&&(t+=a)}const n=new Uint8Array([...t].map(r=>On.get(r)??r.codePointAt(0)??0));try{return new TextDecoder("utf-8").decode(n)}catch{return t}}_bpe(e){if(this.vocab.has(e))return[e];let t=[...e];for(;t.length>1;){let n=1/0,r=-1;for(let s=0;s<t.length-1;s++){const d=t[s]+" "+t[s+1],i=this.merges.get(d);i!==void 0&&i<n&&(n=i,r=s)}if(r===-1)break;const a=t[r]+t[r+1];t=[...t.slice(0,r),a,...t.slice(r+2)]}return t}padOrTruncate(e,t,n="right"){if(e.length>=t)return e.slice(0,t);const r=this.padId??0,a=new Array(t-e.length).fill(r);return n==="right"?[...e,...a]:[...a,...e]}get vocabSize(){return this.vocab.size}}const Ot=1163283761,ve=12,Un=1;function oe(o){let e=2166136261;for(let t=0;t<o.length;t++)e^=o[t],e=Math.imul(e,16777619);return e>>>0}class Z{manifest;checkpoint;codec;tokenizer;constructor(e,t,n,r){this.manifest=e,this.checkpoint=t,this.codec=n,this.tokenizer=r}static _tokenizerSection(e,t){if(!e.tokenizer)return{fields:{}};const n=e.tokenizer.vocabSize;if(t!=null&&n!==t)throw new Error(`EvermindModelPackage: tokenizer vocabSize (${n}) must equal the model's (${t}) — a mismatched pair decodes to nonsense.`);const r=e.tokenizer.serialize();return{blob:r,fields:{tokenizerFormat:"BPE0",tokenizerBytes:r.byteLength,tokenizerChecksum:oe(new Uint8Array(r)),tokenizerVocabSize:n}}}static fromModel(e,t){const n=t.fp16??!1,r=e.exportWeights({fp16:n}),a=Z._tokenizerSection(t,void 0),s={schema:"evermind.model/1",name:t.name,version:t.version,modelType:"shared-expert-moe",config:e.config,paramCount:e.parameters().reduce((d,i)=>d+i.numel,0),checkpointFormat:"MoE0",checkpointFp16:n,...a.blob?{checkpointBytes:r.byteLength}:{},checksum:oe(new Uint8Array(r)),...a.fields,card:t.card,...t.createdAt?{createdAt:t.createdAt}:{}};return new Z(s,r,void 0,a.blob)}static fromLM(e,t){const n=t.fp16??!1,r=e.exportWeights({fp16:n}),a=Z._tokenizerSection(t,e.config.vocabSize),s={schema:"evermind.model/1",name:t.name,version:t.version,modelType:"evermind-lm",config:e.config,paramCount:e.parameters().reduce((d,i)=>d+i.data.length,0),checkpointFormat:"EVL0",checkpointFp16:n,...a.blob?{checkpointBytes:r.byteLength}:{},checksum:oe(new Uint8Array(r)),...a.fields,card:t.card,...t.createdAt?{createdAt:t.createdAt}:{}};return new Z(s,r,void 0,a.blob)}static fromMediaLM(e,t,n){if(e.config.vocabSize!==t.vocabSize)throw new Error(`fromMediaLM: LM vocabSize (${e.config.vocabSize}) must equal codec.vocabSize (${t.vocabSize})`);const r=n.fp16??!1,a=e.exportWeights({fp16:r}),s=t.serialize(),d=Z._tokenizerSection(n,e.config.vocabSize),i={schema:"evermind.model/1",name:n.name,version:n.version,modelType:"evermind-lm",modality:n.modality,config:e.config,paramCount:e.parameters().reduce((c,u)=>c+u.data.length,0),checkpointFormat:"EVL0",checkpointFp16:r,checkpointBytes:a.byteLength,checksum:oe(new Uint8Array(a)),codecFormat:"VRQ0",...d.blob?{codecBytes:s.byteLength}:{},codecChecksum:oe(new Uint8Array(s)),...d.fields,card:n.card,...n.createdAt?{createdAt:n.createdAt}:{}};return new Z(i,a,s,d.blob)}toBlob(){const e=new TextEncoder().encode(JSON.stringify(this.manifest)),t=ve,n=this.codec?.byteLength??0,r=this.tokenizer?.byteLength??0,a=new ArrayBuffer(t+e.byteLength+this.checkpoint.byteLength+n+r),s=new Uint32Array(a,0,3);s[0]=Ot,s[1]=Un,s[2]=e.byteLength;let d=t;return new Uint8Array(a,d,e.byteLength).set(e),d+=e.byteLength,new Uint8Array(a,d,this.checkpoint.byteLength).set(new Uint8Array(this.checkpoint)),d+=this.checkpoint.byteLength,this.codec&&(new Uint8Array(a,d,n).set(new Uint8Array(this.codec)),d+=n),this.tokenizer&&new Uint8Array(a,d,r).set(new Uint8Array(this.tokenizer)),a}withCheckpoint(e,t=this.manifest.version){const n={...this.manifest,version:t,...this.manifest.checkpointBytes!==void 0?{checkpointBytes:e.byteLength}:{},checksum:oe(new Uint8Array(e))};return new Z(n,e,this.codec,this.tokenizer)}static manifestEnd(e){if(e.byteLength<ve)throw new Error("EvermindModelPackage: truncated (no header)");const t=new Uint32Array(e,0,3);if(t[0]!==Ot)throw new Error("EvermindModelPackage: bad magic (not an .evermind package)");return ve+t[2]}static readManifest(e){const t=Z.manifestEnd(e);if(t>e.byteLength)throw new Error("EvermindModelPackage: truncated (manifest length exceeds blob)");const n=new Uint8Array(e,ve,t-ve);return JSON.parse(new TextDecoder().decode(n))}static fromBlob(e){const t=Z.readManifest(e),n=Z.manifestEnd(e),r=t.checkpointBytes;if(r==null)return new Z(t,e.slice(n));if(n+r>e.byteLength)throw new Error("EvermindModelPackage.fromBlob: truncated (checkpointBytes exceeds blob)");const a=e.slice(n,n+r);let s=n+r;const d=t.tokenizerBytes??0;if(s+d>e.byteLength)throw new Error("EvermindModelPackage.fromBlob: truncated (tokenizerBytes exceeds blob)");const i=e.byteLength-d;let c;if(s<i){const l=t.codecBytes!=null?s+t.codecBytes:i;if(l>i)throw new Error("EvermindModelPackage.fromBlob: truncated (codecBytes overruns the tokenizer section)");c=e.slice(s,l),s=l}const u=d>0?e.slice(i):void 0;return new Z(t,a,c,u)}validate(){const e=[];this.manifest.schema!=="evermind.model/1"&&e.push(`unknown schema: ${this.manifest.schema}`);const t=this.manifest.config;this.manifest.modelType==="shared-expert-moe"?(!t||t.modelDim<=0||t.hiddenDim<=0||t.numExperts<=0||t.topK<1||t.topK>t.numExperts)&&e.push("invalid config"):this.manifest.modelType==="evermind-lm"?(!t||t.vocabSize<=0||t.dModel<=0||t.numLayers<=0||t.numExperts<=0||t.topK<1||t.topK>t.numExperts)&&e.push("invalid config"):e.push(`unsupported modelType: ${String(this.manifest.modelType)}`);const n=oe(new Uint8Array(this.checkpoint));n!==this.manifest.checksum&&e.push(`checksum mismatch (manifest ${this.manifest.checksum}, actual ${n}) — corrupt or tampered checkpoint`);const r=this.manifest.modality??"text";if(r==="video"||r==="image")if(!this.codec)e.push(`modality '${r}' package is missing its codec section`);else{const a=oe(new Uint8Array(this.codec));a!==this.manifest.codecChecksum&&e.push(`codec checksum mismatch (manifest ${this.manifest.codecChecksum}, actual ${a}) — corrupt codec`)}if(this.manifest.tokenizerFormat)if(!this.tokenizer)e.push("manifest declares an embedded tokenizer but the package has no tokenizer section");else{const a=oe(new Uint8Array(this.tokenizer));a!==this.manifest.tokenizerChecksum&&e.push(`tokenizer checksum mismatch (manifest ${this.manifest.tokenizerChecksum}, actual ${a}) - corrupt tokenizer`);const s=this.manifest.config?.vocabSize,d=this.manifest.tokenizerVocabSize;s!=null&&d!=null&&s!==d&&e.push(`tokenizer vocabSize (${d}) does not match the model's (${s})`)}return{ok:e.length===0,errors:e}}loadTokenizer(){if(!this.manifest.tokenizerFormat||!this.tokenizer)return null;const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadTokenizer: ${e.errors.join("; ")}`);return De.deserialize(this.tokenizer)}loadModel(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadModel: ${e.errors.join("; ")}`);if(this.manifest.modelType!=="shared-expert-moe")throw new Error(`loadModel: package is '${this.manifest.modelType}', use loadLM()`);const t=new fr(this.manifest.config);return t.loadWeights(this.checkpoint),t}loadLM(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadLM: ${e.errors.join("; ")}`);if(this.manifest.modelType!=="evermind-lm")throw new Error(`loadLM: package is '${this.manifest.modelType}', use loadModel()`);const t=new Ke(this.manifest.config);return t.loadWeights(this.checkpoint),t}loadMediaLM(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadMediaLM: ${e.errors.join("; ")}`);const t=this.manifest.modality??"text";if(t!=="video"&&t!=="image")throw new Error(`loadMediaLM: package modality is '${t}', use loadLM()`);return{lm:this.loadLM(),codec:He.deserialize(this.codec),modality:t}}}const Gn=Math.LN2;function Kn(o,e){const t=o.length,n=Math.max(1,Math.min(e,t)),r=[],a=new Uint8Array(t);for(let s=0;s<n;s++){let d=-1,i=-1/0;for(let c=0;c<t;c++){if(a[c])continue;const u=o[c];u>i&&(i=u,d=c)}if(d<0)break;a[d]=1,r.push(d)}return r}function Hn(o){let e=0,t=-1/0;for(let n=0;n<o.length;n++)o[n]>t&&(t=o[n],e=n);return e}function qn(o){return Math.exp(o)}function Vn(o){return o/Gn}function yr(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function vr(o,e,t,n){const r=Math.min(e.length,t.length);for(let a=0;a<r;a++){const s=t[a],d=e[a];s<0||s>=d.length||(o.ceSum+=we(d,s),Hn(d)===s&&o.top1Hits++,Kn(d,n).includes(s)&&o.topKHits++,o.tokens++)}}function wt(){const o=globalThis;return typeof o.performance?.now=="function"?o.performance.now():Date.now()}function xr(o){return o.slice(1)}function kr(o,e,t,n){const r=o.tokens>0?o.ceSum/o.tokens:0,a={sequences:e,tokens:o.tokens,crossEntropy:r,perplexity:qn(r),bitsPerToken:Vn(r),top1Accuracy:o.tokens>0?o.top1Hits/o.tokens:0,topKAccuracy:o.tokens>0?o.topKHits/o.tokens:0,topK:t};return n!==void 0&&(a.elapsedMs=n,a.tokensPerSecond=n>0?o.tokens/n*1e3:0),a}function ze(o,e,t={}){const n=t.topK??5,r=t.measureLatency??!0,a=t.now??wt,s=yr();let d=0,i=0;for(const c of e){if(c.length<2)continue;const u=r?a():0,{logits:l}=o.forward(c);r&&(i+=a()-u),vr(s,l,xr(c),n),d++}return kr(s,d,n,r?i:void 0)}async function bs(o,e,t={}){const n=t.topK??5,r=t.measureLatency??!0,a=t.now??wt,s=yr();let d=0,i=0;for(const c of e){if(c.length<2)continue;const u=r?a():0,{logits:l}=await o.forward(c);r&&(i+=a()-u),vr(s,l,xr(c),n),d++}return kr(s,d,n,r?i:void 0)}function ws(o,e,t,n={}){return Xn(ze(o,t,n),ze(e,t,n))}function Xn(o,e){const t=o.perplexity-e.perplexity,n=e.perplexity>0?o.perplexity/e.perplexity:1/0,r=o.top1Accuracy-e.top1Accuracy,a=.005;let s;Math.abs(n-1)<=a?s="tie":s=t<0?"candidate":"baseline";const d=((1-n)*100).toFixed(1),i=s==="tie"?`Tie: perplexity ${o.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)}`:s==="candidate"?`Candidate wins: ${d}% lower perplexity (${o.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(d)).toFixed(1)}% higher perplexity (${o.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`;return{candidate:o,baseline:e,perplexityDelta:t,perplexityRatio:n,top1Delta:r,winner:s,summary:i}}function Ar(o,e){return o.split(/(?<=\.)\s+/).map(t=>e.encode(t.trim())).filter(t=>t.length>=2)}function ys(o,e,t,n={}){return ze(o,Ar(t,e),n)}function Yn(o,e){for(let t=o.length-1;t>0;t--){const n=Math.floor(e.next()*(t+1)),r=o[t];o[t]=o[n],o[n]=r}return o}function vs(o,e={}){const t=e.seed??7,n=new De;n.train(o,{numMerges:e.numMerges??100});const r=Ar(o,n);if(r.length<2)throw new Error(`corpus produced ${r.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const a=Yn([...r],new re(t>>>0||1)),s=Math.min(.9,Math.max(.05,e.heldOutRatio??.25));let d=Math.round(a.length*s);d=Math.max(1,Math.min(a.length-1,d));const i=a.slice(0,d),c=a.slice(d),u=new Ke({vocabSize:n.vocabSize,dModel:e.dModel??32,numLayers:e.numLayers??2,hiddenDim:e.hiddenDim??48,seed:t}),l=e.epochs??30,h=new bt(u,{lr:e.lr??.03,epochs:l}).fit(c),m=ze(u,i,{topK:e.topK??5,measureLatency:!0}),f=u.generateText(e.prompt??"The",n,{maxNewTokens:8,temperature:0});return{...m,trainSequences:c.length,evalSequences:i.length,initialTrainLoss:h[0]??0,finalTrainLoss:h.at(-1)??0,vocabSize:n.vocabSize,sample:f}}function Mr(o,e){const t=[],n=Math.max(1,Math.floor(e));for(let r=0;r+1<o.length;r+=n){const a=o.slice(r,r+n);a.length>=2&&t.push(a)}return t}function Qn(o,e){const t=Math.min(1,Math.max(0,e));return Math.round(o*(1-t))}const Jn=["The planning loop retrieves context before generating a response.","Agents recall facts from the memory layer and act on them.","Deployment runs on Cloudflare Workers and Durable Objects.","Tools are gated by a capability registry and a policy pack.","The coordinator merges weight deltas from every contributing host.","A ticket moves through triage, execution, review and merge.","Recall is ranked by embedding cosine fused with lexical scoring.","The trainer adapts a private copy of the base checkpoint locally."].join(" ");function Zn(o){let e=0;for(const t of o.parameters())e+=t.data.length;return e}function xs(o={}){const e=o.text??Jn,t=o.windowTokens??[32,64,128],n=o.epochs??[1,2,4],r=o.skipRates??[0,.5],a=Math.max(1,o.requests??4),s=o.dModel??32,d=o.numLayers??2,i=o.hiddenDim??48,c=o.seed??7,u=o.lr??.01,l=o.now??wt,h=new De;h.train(e,{numMerges:o.numMerges??120});const m=h.encode(e),f=()=>new Ke({vocabSize:h.vocabSize,dModel:s,numLayers:d,hiddenDim:i,seed:c}),g=[];for(const p of t){const b=Mr(m,p);for(const y of n)for(const _ of r){const w=Qn(a,_),x=f();x.resetStats();const L=l();for(let C=0;C<w;C++)new bt(x,{lr:u,epochs:y,accumSteps:1}).fit(b);const T=l()-L,M=x.positionsEvaluated,B=b.length*w;g.push({windowTokens:p,epochs:y,skipRate:_,requests:a,adapted:w,sequences:B,optimizerSteps:B*y,positionsEvaluated:M,elapsedMs:T,msPerKPosition:M>0?T/M*1e3:0,msPerAdaptation:w>0?T/w:0})}}return{points:g,textTokens:m.length,vocabSize:h.vocabSize,dModel:s,numLayers:d,hiddenDim:i,paramCount:Zn(f())}}function ks(o){const e=`Evermind adaptation cost — dModel=${o.dModel} layers=${o.numLayers} hidden=${o.hiddenDim} params=${o.paramCount.toLocaleString()} vocab=${o.vocabSize} textTokens=${o.textTokens}`,t=["window","epochs","skip","adapts","seqs","steps","positions","ms","ms/adapt","ms/1k pos"],n=o.points.map(s=>[String(s.windowTokens),String(s.epochs),s.skipRate.toFixed(2),`${s.adapted}/${s.requests}`,String(s.sequences),String(s.optimizerSteps),String(s.positionsEvaluated),s.elapsedMs.toFixed(1),s.msPerAdaptation.toFixed(1),s.msPerKPosition.toFixed(3)]),r=t.map((s,d)=>Math.max(s.length,...n.map(i=>i[d].length))),a=s=>s.map((d,i)=>d.padStart(r[i])).join("  ");return[e,"",a(t),a(r.map(s=>"-".repeat(s))),...n.map(a)].join(`
`)}const eo=4e3,to=64;function ro(o,e,t,n={}){const r=n.maxChars??eo,a=n.windowTokens??to,s=Mr(e.encode(t.slice(0,r)),a);if(s.length===0)return null;const d=o.loadLM(),i=new bt(d,{epochs:n.epochs??1}).fit(s),c=i.length>0?i[i.length-1]:0;return{diff:Cn(o.checkpoint,d.exportWeights()),loss:c,sequences:s.length}}function As(o,e,t,n,r={}){const a=ro(o,e,t,r);return a?{pkg:o.withCheckpoint(wr(o.checkpoint,a.diff),n),loss:a.loss,sequences:a.sequences}:null}const Ut=32768;function no(o){const e=o instanceof Uint8Array?o:new Uint8Array(o);let t="";for(let n=0;n<e.length;n+=Ut)t+=String.fromCharCode.apply(null,Array.from(e.subarray(n,n+Ut)));return btoa(t)}function oo(o){const e=atob(o),t=new Uint8Array(e.length);for(let n=0;n<e.length;n++)t[n]=e.charCodeAt(n);return t.buffer}const Gt=8*1024*1024,Lr=800,ao=/^[A-Za-z0-9+/]+={0,2}$/;function Ms(o){const e=o&&typeof o=="object"?o:{},t=typeof e.diff=="string"?e.diff:"",n=typeof e.baseVersion=="number"?e.baseVersion:Number.NaN;if(!t||!Number.isInteger(n))return{ok:!1,reason:"invalid",error:"diff (base64) and baseVersion (integer head version the delta was taken against) are required"};if(t.length>Gt)return{ok:!1,reason:"too-large",error:`delta too large (max ${Gt} base64 characters)`};if(t.length%4!==0||!ao.test(t))return{ok:!1,reason:"invalid",error:"diff must be standard base64"};const r=typeof e.weight=="number"&&Number.isFinite(e.weight)&&e.weight>0?e.weight:void 0,a=typeof e.label=="string"&&e.label.trim()?e.label.trim().slice(0,Lr):void 0;return{ok:!0,payload:{diff:t,baseVersion:n,...r!==void 0?{weight:r}:{},...a?{label:a}:{}}}}function Ls(o,e,t,n){const r=(n??"").trim();return{diff:no(o),baseVersion:e,...typeof t=="number"&&Number.isFinite(t)&&t>0?{weight:t}:{},...r?{label:r.slice(0,Lr)}:{}}}function Ss(o){return oo(o.diff)}function Es(o,e){try{const t=Ge(o);if(t.rowSize!==1)return`expected an element-granular delta (rowSize 1), got ${t.rowSize}`;const n=de(e).body.byteLength/4;for(let r=0;r<t.rows.length;r++){const a=t.rows[r];if(!Number.isInteger(a)||a<0||a>=n)return`row index ${a} is outside the base checkpoint (${n} elements)`;if(!Number.isFinite(t.data[r]))return`non-finite value at row ${a}`}return null}catch(t){return`not a serialized RowDelta: ${t instanceof Error?t.message:String(t)}`}}function Bs(o,e,t){if(e.length===0)return{checkpoint:o,mergedRows:0,contributors:0,deltaNorm:0};if(t&&t.length!==e.length)throw new Error(`mergeCheckpointDiffs: weights length ${t.length} != diffs length ${e.length}`);const n=e.map(l=>Ge(l));for(const l of n)if(l.rowSize!==1)throw new Error(`mergeCheckpointDiffs: expected element-granular deltas (rowSize 1), got ${l.rowSize}`);const r=new Map;if(n.forEach((l,h)=>{const m=t?t[h]:1;m>0&&l.rows.forEach((f,g)=>{const p=l.data[g],b=r.get(f);b?(b.sum+=m*p,b.weight+=m):r.set(f,{sum:m*p,weight:m})})}),r.size===0)return{checkpoint:o,mergedRows:0,contributors:n.length,deltaNorm:0};const a=[...r.keys()].sort((l,h)=>l-h),s=new Float32Array(a.length);a.forEach((l,h)=>{const m=r.get(l);s[h]=m.sum/m.weight});const d=new Float32Array(de(o).body);let i=0;return a.forEach((l,h)=>{const m=s[h]-(d[l]??0);i+=m*m}),{checkpoint:wr(o,_t({rowSize:1,rows:a,data:s})),mergedRows:a.length,contributors:n.length,deltaNorm:Math.sqrt(i)}}const so=128;function io(o,e){if(e.length<2)return null;const{logits:t}=o.forward(e),n=Math.min(t.length,e.length)-1;if(n<1)return null;let r=0;for(let s=0;s<n;s++)r+=we(t[s],e[s+1]);const a=r/n;return Number.isFinite(a)&&a>=0?a:null}function Ds(o,e,t,n=so){let r=0,a=0;for(const s of t){const d=(s.prompt?`${s.prompt}
`:"")+s.text,i=io(o,e.encode(d).slice(0,n));i!=null&&(r+=i,a++)}return a>0?r/a:null}class Fs{model;codec;dimensions;fingerprint;constructor(e,t,n){this.model=e,this.codec=t,this.dimensions=e.config.dModel,this.fingerprint=n??co(e)}async embed(e){return this.embedSync(e)}embedSync(e){return this.model.embedText(e,this.codec)}}function co(o){const e=o.config,t=new Uint8Array(o.emb.buffer,o.emb.byteOffset,o.emb.byteLength);return`evermind-lm/${[e.vocabSize,e.dModel,e.numLayers,e.convKernel,e.hiddenDim,e.numExperts,e.topK].join("-")}/${mt(t).toString(16)}`}const Kt=1280266817;class Le{rows;cols;rank;alpha;scale;B;A;gB;gA;constructor(e,t,n={}){if(e<=0||t<=0)throw new Error("LoRAAdapter: rows and cols must be > 0");const r=n.rank??8;if(r<=0||r>Math.min(e,t))throw new Error(`LoRAAdapter: rank must be in [1, min(rows,cols)=${Math.min(e,t)}]`);this.rows=e,this.cols=t,this.rank=r,this.alpha=n.alpha??r,this.scale=this.alpha/r,this.B=new Float32Array(e*r),this.A=new Float32Array(r*t);const a=new re((n.seed??1282363969)>>>0||1),s=1/Math.sqrt(t);for(let d=0;d<this.A.length;d++){const i=Math.max(a.next(),1e-12),c=a.next();this.A[d]=s*Math.sqrt(-2*Math.log(i))*Math.cos(2*Math.PI*c)}this.gB=new Float32Array(this.B.length),this.gA=new Float32Array(this.A.length)}numParams(){return this.B.length+this.A.length}delta(){const{rows:e,cols:t,rank:n,scale:r}=this,a=new Float32Array(e*t);for(let s=0;s<e;s++){const d=s*n,i=s*t;for(let c=0;c<n;c++){const u=this.B[d+c]*r;if(u===0)continue;const l=c*t;for(let h=0;h<t;h++)a[i+h]=a[i+h]+u*this.A[l+h]}}return a}applyTo(e){if(e.length!==this.rows*this.cols)throw new Error("LoRAAdapter.applyTo: base length mismatch");const t=this.delta(),n=new Float32Array(e.length);for(let r=0;r<n.length;r++)n[r]=e[r]+t[r];return n}accumulateGradient(e){const{rows:t,cols:n,rank:r,scale:a}=this;if(e.length!==t*n)throw new Error("LoRAAdapter.accumulateGradient: gW length mismatch");for(let s=0;s<t;s++){const d=s*n,i=s*r;for(let c=0;c<r;c++){const u=c*n;let l=0;const h=this.B[i+c]*a;for(let m=0;m<n;m++){const f=e[d+m];l+=f*this.A[u+m],this.gA[u+m]=this.gA[u+m]+h*f}this.gB[i+c]=this.gB[i+c]+a*l}}}parameters(){return[{data:this.B},{data:this.A}]}gradients(){return[{data:this.gB},{data:this.gA}]}zeroGrad(){this.gB.fill(0),this.gA.fill(0)}serialize(){const n=new ArrayBuffer(20+(this.B.length+this.A.length)*4),r=new Uint32Array(n,0,5);r[0]=Kt,r[1]=this.rows,r[2]=this.cols,r[3]=this.rank,new Float32Array(n,16,1)[0]=this.alpha;const a=new Float32Array(n,20);return a.set(this.B,0),a.set(this.A,this.B.length),n}static deserialize(e){const t=new Uint32Array(e,0,5);if(t[0]!==Kt)throw new Error("LoRAAdapter.deserialize: bad magic");const n=t[1],r=t[2],a=t[3],s=new Float32Array(e,16,1)[0],d=new Le(n,r,{rank:a,alpha:s}),i=new Float32Array(e,20);return d.B.set(i.subarray(0,d.B.length)),d.A.set(i.subarray(d.B.length,d.B.length+d.A.length)),d}}function lo(o,e){switch(e){case"none":return{view:o,bytes:o.length*4};case"fp16":{const t=Ee(o);return{view:Be(t),bytes:t.length*2}}case"int8":{const t=_n(o);return{view:bn(t.data,t.scale),bytes:t.data.length+4}}}}class Sr{model;adapter;baseQuant;frozenBase;baseBytesStored;rows;cols;constructor(e,t={}){this.model=e,this.rows=e.config.vocabSize,this.cols=e.config.dModel,this.baseQuant=t.baseQuant??"none";const{view:n,bytes:r}=lo(Float32Array.from(e.emb),this.baseQuant);this.frozenBase=n,this.baseBytesStored=r,this.adapter=new Le(this.rows,this.cols,t)}get baseModel(){return this.model}mergedEmb(){return this.adapter.applyTo(this.frozenBase)}_accumulate(e){const t=this.mergedEmb(),n=this.model.emb;this.model.emb=t,this.model.zeroGrad();const r=this.model.lossAndBackward(e),a=this.model.gradients()[0].data;return this.adapter.accumulateGradient(a),this.model.emb=n,r}fit(e,t={}){const n=t.epochs??1,r=Math.max(1,t.accumSteps??1),a=new pt(this.adapter,t),s=this.adapter.gradients(),d=[];for(let i=0;i<n;i++){let c=0,u=0,l=0;this.adapter.zeroGrad();const h=()=>{if(l!==0){if(l!==1)for(const m of s)for(let f=0;f<m.data.length;f++)m.data[f]=m.data[f]/l;a.step(),this.adapter.zeroGrad(),l=0}};for(const m of e)m.length<2||(c+=this._accumulate(m),u++,++l>=r&&h());h(),d.push(u>0?c/u:0)}return d}generate(e,t){const n=this.model.emb;this.model.emb=this.mergedEmb();try{return this.model.generate(e,t)}finally{this.model.emb=n}}generateText(e,t,n){return t.decode(this.generate(t.encode(e),n))}serializeAdapter(){return this.adapter.serialize()}static loadAdapter(e,t,n="none"){const r=Le.deserialize(t),a=new Sr(e,{rank:r.rank,alpha:r.alpha,baseQuant:n});return a.adapter.B.set(r.B),a.adapter.A.set(r.A),a}merge(e={}){return this.model.emb.set(this.mergedEmb()),this.model.exportWeights(e)}footprint(){return{adapterBytes:this.adapter.serialize().byteLength,baseBytes:this.baseBytesStored,trainableParams:this.adapter.numParams(),baseParams:this.rows*this.cols}}}const Fe=1e-6;function Er(o){return 1/(1+Math.exp(-o))}function Ht(o){return o/(1+Math.exp(-o))}function qt(o){const e=Er(o);return e*(1+o*(1-e))}function uo(o){return Math.max(o,0)+Math.log1p(Math.exp(-Math.abs(o)))}function ke(o,e,t,n,r,a,s){for(let d=0;d<n;d++){const i=d*r,c=d*a;for(let u=0;u<a;u++){let l=t[u];const h=u*r;for(let m=0;m<r;m++)l+=o[i+m]*e[h+m];s[c+u]=l}}}function Ne(o,e,t,n,r,a,s,d,i){s.fill(0);for(let c=0;c<n;c++){const u=c*r,l=c*a;for(let h=0;h<a;h++){const m=o[l+h];if(m===0)continue;i[h]=i[h]+m;const f=h*r;for(let g=0;g<r;g++)s[u+g]=s[u+g]+m*t[f+g],d[f+g]=d[f+g]+m*e[u+g]}}}function Br(o,e,t,n,r,a,s=Fe){for(let d=0;d<t;d++){const i=d*n;let c=0;for(let l=0;l<n;l++){const h=o[i+l];c+=h*h}const u=1/Math.sqrt(c/n+s);a[d]=u;for(let l=0;l<n;l++)r[i+l]=o[i+l]*u*e[l]}}function Dr(o,e,t,n,r,a,s,d,i=Fe){for(let c=0;c<r;c++){const u=c*a,l=n[c];let h=0;for(let f=0;f<a;f++){const g=o[u+f]*t[f];h+=g*e[u+f],d[f]=d[f]+o[u+f]*e[u+f]*l}const m=l*l*l/a;for(let f=0;f<a;f++){const g=o[u+f]*t[f];s[u+f]=s[u+f]+g*l-m*h*e[u+f]}}}const yt=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],Fr=-10,Cr=5;function ho(o){const{dModel:e,dState:t,dConv:n,dInner:r,dtRank:a}=o;return{wInProj:new Float32Array(2*r*e),bInProj:new Float32Array(2*r),wConv:new Float32Array(r*n),bConv:new Float32Array(r),wXProj:new Float32Array((a+2*t)*r),bXProj:new Float32Array(a+2*t),wDtProj:new Float32Array(r*a),bDtProj:new Float32Array(r),A_log:new Float32Array(r*t),D_vec:new Float32Array(r),wOutProj:new Float32Array(e*r),bOutProj:new Float32Array(e),normWeight:new Float32Array(e)}}function Pr(o,e,t){const{dModel:n,dState:r,dConv:a,dInner:s,dtRank:d,batch:i,seqLen:c}=t,u=i*c,l=d+2*r,h=new Float32Array(u*n),m=new Float32Array(u);Br(o,e.normWeight,u,n,h,m);const f=new Float32Array(u*2*s);ke(h,e.wInProj,e.bInProj,u,n,2*s,f);const g=new Float32Array(u*s),p=new Float32Array(u*s);for(let v=0;v<u;v++)for(let k=0;k<s;k++)g[v*s+k]=f[v*2*s+k],p[v*s+k]=f[v*2*s+s+k];const b=new Float32Array(u*s);for(let v=0;v<i;v++)for(let k=0;k<c;k++){const S=(v*c+k)*s;for(let W=0;W<s;W++){let q=e.bConv[W];for(let N=0;N<a;N++)k>=N&&(q+=e.wConv[W*a+N]*g[(v*c+k-N)*s+W]);b[S+W]=q}}const y=new Float32Array(u*s);for(let v=0;v<u*s;v++)y[v]=Ht(b[v]);const _=new Float32Array(u*l);ke(y,e.wXProj,e.bXProj,u,s,l,_);const w=new Float32Array(u*d),x=new Float32Array(u*r),L=new Float32Array(u*r);for(let v=0;v<u;v++){for(let k=0;k<d;k++)w[v*d+k]=_[v*l+k];for(let k=0;k<r;k++)x[v*r+k]=_[v*l+d+k],L[v*r+k]=_[v*l+d+r+k]}const T=new Float32Array(u*s);ke(w,e.wDtProj,e.bDtProj,u,d,s,T);const M=new Float32Array(u*s);for(let v=0;v<u*s;v++)M[v]=uo(T[v]);const B=new Float32Array(s*r);for(let v=0;v<s*r;v++)B[v]=-Math.exp(Math.min(Cr,Math.max(Fr,e.A_log[v])));const C=new Float32Array(u*s*r),O=new Float32Array(u*s*r),U=new Float32Array(u*s*r),K=new Float32Array(u*s);for(let v=0;v<i;v++)for(let k=0;k<c;k++){const S=v*c+k;for(let W=0;W<s;W++){const q=M[S*s+W],N=y[S*s+W];let P=e.D_vec[W]*N;for(let D=0;D<r;D++){const H=B[W*r+D],J=Math.exp(q*H),V=(J-1)/H*x[S*r+D],X=(S*s+W)*r+D;C[X]=J,O[X]=V;const ne=k===0?0:U[((S-1)*s+W)*r+D],ue=J*ne+V*N;U[X]=ue,P+=L[S*r+D]*ue}K[S*s+W]=P}}const j=new Float32Array(u*s),G=new Float32Array(u*s);for(let v=0;v<u*s;v++)j[v]=Ht(p[v]),G[v]=K[v]*j[v];const A=new Float32Array(u*n);ke(G,e.wOutProj,e.bOutProj,u,s,n,A);for(let v=0;v<u*n;v++)A[v]=A[v]+o[v];return{output:A,cache:{x:o,normInv:m,normOut:h,xConvIn:g,z:p,convOut:b,u:y,dtRaw:w,bRaw:x,cRaw:L,deltaFull:T,dv:M,aCont:B,aBar:C,bBar:O,h:U,scanY:K,siluZ:j,gated:G}}}function fo(o,e,t,n,r){const{dModel:a,dState:s,dConv:d,dInner:i,dtRank:c,batch:u,seqLen:l}=n,h=u*l,m=c+2*s,f=new Float32Array(h*a);f.set(o);const g=new Float32Array(h*i);Ne(o,t.gated,e.wOutProj,h,i,a,g,r.wOutProj,r.bOutProj);const p=new Float32Array(h*i),b=new Float32Array(h*i);for(let A=0;A<h*i;A++)p[A]=g[A]*t.siluZ[A],b[A]=g[A]*t.scanY[A]*qt(t.z[A]);const y=new Float32Array(h*i),_=new Float32Array(h*s),w=new Float32Array(h*s),x=new Float32Array(h*i),L=new Float32Array(i*s),T=new Float32Array(i*s);for(let A=0;A<u;A++){T.fill(0);for(let v=l-1;v>=0;v--){const k=A*l+v;for(let S=0;S<i;S++){const W=p[k*i+S],q=t.u[k*i+S],N=t.dv[k*i+S];r.D_vec[S]=r.D_vec[S]+W*q,y[k*i+S]=y[k*i+S]+W*e.D_vec[S];let P=0;for(let D=0;D<s;D++){const H=(k*i+S)*s+D,J=t.h[H],V=t.aBar[H],X=t.bBar[H],ne=t.aCont[S*s+D],ue=t.cRaw[k*s+D];w[k*s+D]=w[k*s+D]+W*J;const Pe=W*ue+T[S*s+D],Qr=v===0?0:t.h[((k-1)*i+S)*s+D],At=Pe*Qr,Ve=Pe*q;y[k*i+S]=y[k*i+S]+Pe*X,T[S*s+D]=Pe*V;const Mt=t.bRaw[k*s+D];P+=At*ne*V+Ve*V*Mt,L[S*s+D]=L[S*s+D]+At*N*V+Ve*Mt*((N*V*ne-(V-1))/(ne*ne)),_[k*s+D]=_[k*s+D]+Ve*((V-1)/ne)}x[k*i+S]=x[k*i+S]+P}}}for(let A=0;A<i*s;A++){const v=e.A_log[A];v<=Fr||v>=Cr||(r.A_log[A]=r.A_log[A]+L[A]*t.aCont[A])}const M=new Float32Array(h*i);for(let A=0;A<h*i;A++)M[A]=x[A]*Er(t.deltaFull[A]);const B=new Float32Array(h*c);Ne(M,t.dtRaw,e.wDtProj,h,c,i,B,r.wDtProj,r.bDtProj);const C=new Float32Array(h*m);for(let A=0;A<h;A++){for(let v=0;v<c;v++)C[A*m+v]=B[A*c+v];for(let v=0;v<s;v++)C[A*m+c+v]=_[A*s+v],C[A*m+c+s+v]=w[A*s+v]}const O=new Float32Array(h*i);Ne(C,t.u,e.wXProj,h,i,m,O,r.wXProj,r.bXProj);for(let A=0;A<h*i;A++)y[A]=y[A]+O[A];const U=new Float32Array(h*i);for(let A=0;A<h*i;A++)U[A]=y[A]*qt(t.convOut[A]);const K=new Float32Array(h*i);for(let A=0;A<u;A++)for(let v=0;v<l;v++){const k=A*l+v;for(let S=0;S<i;S++){const W=U[k*i+S];if(W!==0){r.bConv[S]=r.bConv[S]+W;for(let q=0;q<d;q++){if(v<q)continue;const N=(A*l+v-q)*i+S;r.wConv[S*d+q]=r.wConv[S*d+q]+W*t.xConvIn[N],K[N]=K[N]+W*e.wConv[S*d+q]}}}}const j=new Float32Array(h*2*i);for(let A=0;A<h;A++)for(let v=0;v<i;v++)j[A*2*i+v]=K[A*i+v],j[A*2*i+i+v]=b[A*i+v];const G=new Float32Array(h*a);return Ne(j,t.normOut,e.wInProj,h,a,2*i,G,r.wInProj,r.bInProj),Dr(G,t.x,e.normWeight,t.normInv,h,a,f,r.normWeight,Fe),f}const Vt=["mamba1"];function mo(o){const e={dModel:o.dModel,dState:o.dState,dConv:o.dConv,dInner:o.dInner,dtRank:o.dtRank};return{embedding:new Float32Array(o.vocabSize*o.dModel),finalNorm:new Float32Array(o.dModel),lmHeadBias:new Float32Array(o.vocabSize),layers:Array.from({length:o.numLayers},()=>ho(e))}}function po(o){const e=new Map;e.set("embedding",o.embedding);for(let t=0;t<o.layers.length;t++){const n=o.layers[t];for(const r of yt)e.set(`layer${t}.${r}`,n[r])}return e.set("final_norm",o.finalNorm),e.set("lm_head_bias",o.lmHeadBias),e}function go(o){const e=new Map;e.set("embedding",o.embedding);for(let t=0;t<o.layers.length;t++){const n=o.layers[t];for(const r of yt)e.set(`layer${t}.${r}`,n[r])}return e.set("final_norm",o.finalNorm),e.set("lm_head_bias",o.lmHeadBias),e}function _o(o,e){const t=(u,l)=>{const h=o.get(u);if(!h)throw new Error(`cpuWeightsFromNamed: missing tensor "${u}"`);if(h.length!==l)throw new Error(`cpuWeightsFromNamed: "${u}" has ${h.length} elements, expected ${l}`);return h},{dModel:n,dState:r,dConv:a,dInner:s,dtRank:d}=e,i={wInProj:2*s*n,bInProj:2*s,wConv:s*a,bConv:s,wXProj:(d+2*r)*s,bXProj:d+2*r,wDtProj:s*d,bDtProj:s,A_log:s*r,D_vec:s,wOutProj:n*s,bOutProj:n,normWeight:n},c=[];for(let u=0;u<e.numLayers;u++){const l={};for(const h of yt)l[h]=t(`layer${u}.${h}`,i[h]);c.push(l)}return{embedding:t("embedding",e.vocabSize*n),finalNorm:t("final_norm",n),lmHeadBias:t("lm_head_bias",e.vocabSize),layers:c}}function Tr(o,e,t,n,r,a=!1){const{vocabSize:s,dModel:d}=t,i=n*r;let c=new Float32Array(i*d);for(let p=0;p<i;p++){const b=o[p];if(b<0||b>=s)throw new Error(`token id ${b} out of range [0, ${s})`);c.set(e.embedding.subarray(b*d,(b+1)*d),p*d)}const u={dModel:d,dState:t.dState,dConv:t.dConv,dInner:t.dInner,dtRank:t.dtRank,batch:n,seqLen:r},l=[],h=[];for(let p=0;p<t.numLayers;p++){l.push(c);const{output:b,cache:y}=Pr(c,e.layers[p],u);a||h.push(y),c=b}const m=new Float32Array(i*d),f=new Float32Array(i);Br(c,e.finalNorm,i,d,m,f,Fe);const g=new Float32Array(i*s);return ke(m,e.embedding,e.lmHeadBias,i,d,s,g),{hiddenIn:l,layer:h,lastHidden:c,normOut:m,normInv:f,logits:g}}function bo(o,e,t,n,r){return Tr(o,e,t,n,r).logits}function Cs(o,e,t,n,r,a){const s=bo(o,t,n,r,a),d=r*a,i=n.vocabSize;let c=0;for(let u=0;u<d;u++)c+=we(s.subarray(u*i,(u+1)*i),e[u]);return c/d}function wo(o,e,t,n,r,a,s={}){const{vocabSize:d,dModel:i}=n,c=r*a,u=s.activationCheckpointing??!1,l=Tr(o,t,n,r,a,u),h=mo(n);let m=0;const f=new Float32Array(c*d);for(let w=0;w<c;w++){const x=l.logits.subarray(w*d,(w+1)*d),L=e[w];m+=we(x,L);const T=mr(x,L);for(let M=0;M<d;M++)f[w*d+M]=T[M]/c}const g=m/c,p=new Float32Array(c*i);for(let w=0;w<c;w++){const x=w*d,L=w*i;for(let T=0;T<d;T++){const M=f[x+T];if(M===0)continue;h.lmHeadBias[T]=h.lmHeadBias[T]+M;const B=T*i;for(let C=0;C<i;C++)p[L+C]=p[L+C]+M*t.embedding[B+C],h.embedding[B+C]=h.embedding[B+C]+M*l.normOut[L+C]}}const b=new Float32Array(c*i);Dr(p,l.lastHidden,t.finalNorm,l.normInv,c,i,b,h.finalNorm,Fe);const y={dModel:i,dState:n.dState,dConv:n.dConv,dInner:n.dInner,dtRank:n.dtRank,batch:r,seqLen:a};let _=b;for(let w=n.numLayers-1;w>=0;w--){const x=u?Pr(l.hiddenIn[w],t.layers[w],y).cache:l.layer[w];_=fo(_,t.layers[w],x,y,h.layers[w])}for(let w=0;w<c;w++){const L=o[w]*i,T=w*i;for(let M=0;M<i;M++)h.embedding[L+M]=h.embedding[L+M]+_[T+M]}return{loss:g,grads:po(h)}}function yo(o,e){const{dModel:t,dState:n,dConv:r,dInner:a,dtRank:s}=e;if(o==="embedding")return[e.vocabSize,t];switch(o.startsWith("layer")?o.slice(o.indexOf(".")+1):o){case"wInProj":return[2*a,t];case"wConv":return[a,r];case"wXProj":return[s+2*n,a];case"wDtProj":return[a,s];case"A_log":return[a,n];case"wOutProj":return[t,a];default:return null}}const vo=["wInProj","wXProj","wDtProj","wOutProj"],xo=.05;class Ps{model;tokenizer;device;_moments;_step;_dims;_mirror;_mirrorByName;_adapters;_loraBase;_shard;constructor(e,t=null){this.model=e,this.tokenizer=t,this.device=e.device,this._moments=new Map,this._step=0,this._dims=ko(e),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const e=this.model.getTrainableParams();if(this._adapters.size===0)return e.reduce((n,r)=>n+r.numel,0);let t=0;for(const n of e){const r=this._adapters.get(n.name);r&&(t+=r.numParams())}return t}_owns(e){return this._shard===null||e%this._shard.count===this._shard.index}_installAdapters(e){if(this._adapters.size>0)return;const t=new Set(e.targets??vo),n=this._mirrorByName;for(const r of this.model.getTrainableParams()){const a=r.name.includes(".")?r.name.slice(r.name.indexOf(".")+1):r.name;if(!t.has(a))continue;const s=yo(r.name,this._dims);if(!s)continue;const[d,i]=s,c=Math.max(1,Math.min(e.rank??8,d,i));this._adapters.set(r.name,new Le(d,i,{...e,rank:c})),this._loraBase.set(r.name,Float32Array.from(n.get(r.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...t].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const e=this._mirrorByName;for(const[t,n]of this._adapters){const r=e.get(t),a=this._loraBase.get(t),s=n.delta();for(let d=0;d<r.length;d++)r[d]=a[d]+s[d]}}_momentFor(e){let t=this._moments.get(e.name);return t||(t={m:new Float32Array(e.numel),v:new Float32Array(e.numel)},this._moments.set(e.name,t)),t}async _syncMirrorFromGpu(){const e=new Map;for(const t of this.model.parameters())e.set(t.name,await ie(this.device,t.buf,t.numel*4));e.set("lm_head_bias",await ie(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=_o(e,this._dims),this._mirrorByName=go(this._mirror)}async train(e,t={}){const{learningRate:n=1e-4,epochs:r=5,batchSize:a=1,seqLen:s=512,maxGradNorm:d=1,weightDecay:i=.01,beta1:c=.9,beta2:u=.999,eps:l=1e-8,wsla:h=!1,onEpochEnd:m=null}=t,f=Math.max(1,Math.floor(t.gradientAccumulation??1));if(this._shard=t.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const g=t.maxDelta??(h?xo:0);h&&this.model.setWSLAMode(!0);let p;if(typeof e=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");p=this.tokenizer.encode(e)}else p=Array.from(e);if(p.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const b=Ao(p,s);if(b.length===0)throw new Error("Input is too short to form any training chunk.");const y=Mo(b,Math.max(1,Math.floor(a)));await this._syncMirrorFromGpu(),t.lora&&this._installAdapters(t.lora);const _=[];for(let w=0;w<r;w++){let x=0,L=0,T=0;for(let B=0;B<y.length;B+=f){const C=y.slice(B,B+f),{loss:O,gradNorm:U}=await this._trainStep(C,{learningRate:n,maxGradNorm:d,weightDecay:i,beta1:c,beta2:u,eps:l,wsla:h,maxDelta:g,...t.activationCheckpointing?{activationCheckpointing:!0}:{}});x+=O,L+=U,T++}const M=x/T;_.push(M),m&&m(w+1,M,L/T)}return h&&this.model.setWSLAMode(!1),_}async _trainStep(e,t){const{learningRate:n,maxGradNorm:r,weightDecay:a,beta1:s,beta2:d,eps:i,maxDelta:c}=t;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const u=this._mirror,l=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const h=t.activationCheckpointing?{activationCheckpointing:!0}:{};let m=0,f=new Map;for(const _ of e){const w=wo(_.inputs,_.targets,u,this._dims,_.batch,_.seqLen,h);if(m+=w.loss/e.length,f.size===0){for(const x of w.grads.values())for(let L=0;L<x.length;L++)x[L]=x[L]/e.length;f=w.grads}else for(const[x,L]of w.grads){const T=f.get(x);for(let M=0;M<L.length;M++)T[M]=T[M]+L[M]/e.length}}const g=this.model.getTrainableParams();if(this._adapters.size>0)for(const[_,w]of this._adapters){const x=f.get(_);x&&(w.zeroGrad(),w.accumulateGradient(x))}let p=0;for(const _ of g){const w=f.get(_.name);if(w)for(let x=0;x<w.length;x++)p+=w[x]*w[x]}const b=Math.sqrt(p),y=r>0&&b>r?r/b:1;return this._adamwStep(g,f,l,{learningRate:n,weightDecay:a,beta1:s,beta2:d,eps:i,beta1_t:Math.pow(s,this._step),beta2_t:Math.pow(d,this._step),maxDelta:c,gradScale:y}),{loss:m,gradNorm:b}}_adamwStep(e,t,n,r){const{learningRate:a,weightDecay:s,beta1:d,beta2:i,eps:c,beta1_t:u,beta2_t:l,maxDelta:h,gradScale:m}=r,f={lr:a,beta1:d,beta2:i,eps:c,weightDecay:s,beta1_t:u,beta2_t:l,maxDelta:h,gradScale:m};for(let g=0;g<e.length;g++){const p=e[g];if(!this._owns(g))continue;const b=this._adapters.get(p.name);if(b){const x=n.get(p.name),L=this._loraBase.get(p.name),[T,M]=[b.A,b.B],[B,C]=[b.gradients()[1].data,b.gradients()[0].data],O=this._momentNamed(`${p.name}::loraB`,M.length),U=this._momentNamed(`${p.name}::loraA`,T.length);Xe(M,C,O.m,O.v,f),Xe(T,B,U.m,U.v,f);const K=b.delta();for(let j=0;j<x.length;j++)x[j]=L[j]+K[j];pe(this.device,p.buf,x);continue}const y=t.get(p.name),_=n.get(p.name);if(!y||!_)continue;if(y.length!==p.numel||_.length!==p.numel)throw new Error(`MambaTrainer: parameter "${p.name}" is ${p.numel} elements but the gradient engine produced ${y.length} — model and CPU mirror disagree.`);const w=this._momentFor(p);Xe(_,y,w.m,w.v,f),pe(this.device,p.buf,_)}}_momentNamed(e,t){let n=this._moments.get(e);return n||(n={m:new Float32Array(t),v:new Float32Array(t)},this._moments.set(e,n)),n}optimizerStateBytes(){let e=0;for(const t of this._moments.values())e+=t.m.byteLength+t.v.byteLength;return e}async evaluate(e){let t;if(typeof e=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");t=Array.from(this.tokenizer.encode(e))}else t=Array.from(e);const n=t.length,r=this.model.config.vocabSize,{logits:a}=await this.model.forward(new Uint32Array(t.slice(0,-1)),1,n-1);let s=0;for(let i=0;i<n-1;i++){const c=i*r;s+=we(a.slice(c,c+r),t[i+1])}const d=s/(n-1);return Math.exp(d)}}function ko(o){const e=o.layerSpecs.map((a,s)=>({i:s,type:a.type})).filter(({type:a})=>!Vt.includes(a));if(e.length>0){const a=e.map(({i:s,type:d})=>`layer${s}=${d}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${Vt.join("/")} layers only, but this model has ${a}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const t=o.layers[0],n=t?.dInner??o.config.expand*o.config.dModel,r=t?.dtRank??Math.ceil(o.config.dModel/16);return{vocabSize:o.config.vocabSize,dModel:o.config.dModel,dState:o.config.dState,dConv:o.config.dConv,dInner:n,dtRank:r,numLayers:o.layers.length}}function Ao(o,e){const t=[];for(let r=0;r+e<o.length;r+=e)t.push({inputs:o.slice(r,r+e),targets:o.slice(r+1,r+e+1)});const n=o.length%e;if(n>1){const r=o.length-n;t.push({inputs:o.slice(r,-1),targets:o.slice(r+1)})}return t}function Mo(o,e){const t=[];let n=0;for(;n<o.length;){const r=o[n].inputs.length,a=[];for(;n<o.length&&a.length<e&&o[n].inputs.length===r;)a.push(o[n]),n++;t.push({inputs:a.flatMap(s=>s.inputs),targets:a.flatMap(s=>s.targets),batch:a.length,seqLen:r})}return t}class Ts{video;constructor(e){this.video=new He({...e,keyframeInterval:1})}get vocab(){return this.video.vocab}get vocabSize(){return this.video.vocabSize}get frameSize(){return this.video.height*this.video.width*this.video.channels}encode(e){return this.video.encode([e])}decode(e){return this.video.decode(e)[0]??new Float32Array(this.frameSize)}fit(e,t){return this.video.fit(e.map(n=>[n]),t)}}function Ns(o,e,t){return[...e,...o.encode(t)]}function Lo(o,e,t,n){if(o.config.vocabSize!==e.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${o.config.vocabSize}) must equal codec.vocabSize (${e.vocabSize})`);const r=o.generate(t,{...n,stopToken:n.stopToken??e.vocab.eosVideo});return{video:e.decode(r),tokens:r}}function $s(o,e,t,n){const{video:r,tokens:a}=Lo(o,e.video,t,n);return{image:r[0]??new Float32Array(e.frameSize),tokens:a}}function Ce(o){const e=o.config;return{vocabSize:e.vocabSize,dModel:e.dModel,numLayers:e.numLayers,convKernel:e.convKernel,hiddenDim:e.hiddenDim,numExperts:e.numExperts,topK:e.topK}}function Nr(o){const{vocabSize:e,dModel:t,numLayers:n,convKernel:r,hiddenDim:a,numExperts:s}=o,d=[{name:"token_embedding.weight",shape:[e,t]}],i=c=>[{name:`${c}.w1`,shape:[a,t]},{name:`${c}.b1`,shape:[a]},{name:`${c}.w2`,shape:[t,a]},{name:`${c}.b2`,shape:[t]}];for(let c=0;c<n;c++){const u=`layers.${c}`;d.push({name:`${u}.conv.weight`,shape:[t,r]}),d.push({name:`${u}.norm_conv.weight`,shape:[t]}),d.push({name:`${u}.norm_moe.weight`,shape:[t]}),d.push({name:`${u}.moe.router.weight`,shape:[s,t]}),d.push(...i(`${u}.moe.shared`));for(let l=0;l<s;l++)d.push(...i(`${u}.moe.experts.${l}`))}return d}function vt(o){const e=Nr(Ce(o)),t=o.parameters();if(e.length!==t.length)throw new Error(`export/tensors: parameter-count drift (spec ${e.length} vs model ${t.length}) — EvermindLM.parameters() order changed; update evermindTensorSpec`);return e.map((n,r)=>{const a=n.shape.reduce((d,i)=>d*i,1),s=t[r].data;if(s.length!==a)throw new Error(`export/tensors: shape mismatch for ${n.name} (expected ${a}, got ${s.length})`);return{name:n.name,shape:n.shape,data:s}})}function $r(o){return o.parameters().reduce((e,t)=>e+t.data.length,0)}function So(o,e){if(!e){const r=new Uint8Array(o.length*4),a=new DataView(r.buffer);for(let s=0;s<o.length;s++)a.setFloat32(s*4,o[s],!0);return r}const t=new Uint8Array(o.length*2),n=new DataView(t.buffer);for(let r=0;r<o.length;r++)n.setUint16(r*2,Oe(o[r]),!0);return t}function Eo(o,e={}){const t=e.fp16??!1,n=t?"F16":"F32",r=t?2:4,a={};e.metadata&&(a.__metadata__=e.metadata);const s=[];let d=0;for(const f of o){const g=f.data.length*r;a[f.name]={dtype:n,shape:f.shape,data_offsets:[d,d+g]},s.push(So(f.data,t)),d+=g}let i=JSON.stringify(a);const u=(8-new TextEncoder().encode(i).length%8)%8;u>0&&(i+=" ".repeat(u));const l=new TextEncoder().encode(i),h=new Uint8Array(8+l.length+d);new DataView(h.buffer).setBigUint64(0,BigInt(l.length),!0),h.set(l,8);let m=8+l.length;for(const f of s)h.set(f,m),m+=f.length;return h}function Xt(o,e={}){return Eo(vt(o),{...e,metadata:{format:"pt",producer:"builderforce-memory-engine",...e.metadata??{}}})}const Bo=0,Do=5,Fo=2;class ee{parts=[];byte(e){this.parts.push(e&255)}rawVarint(e){if(e<0||!Number.isFinite(e))throw new Error(`ProtoWriter: bad varint ${e}`);let t=e;for(;t>=128;)this.byte(t%128|128),t=Math.floor(t/128);this.byte(t)}tag(e,t){this.rawVarint(e*8+t)}rawBytes(e){for(let t=0;t<e.length;t++)this.byte(e[t])}varint(e,t){this.tag(e,Bo),this.rawVarint(t)}float(e,t){this.tag(e,Do);const n=new ArrayBuffer(4);new DataView(n).setFloat32(0,t,!0),this.rawBytes(new Uint8Array(n))}bytes(e,t){this.tag(e,Fo),this.rawVarint(t.length),this.rawBytes(t)}string(e,t){this.bytes(e,new TextEncoder().encode(t))}message(e,t){this.bytes(e,t.finish())}finish(){return Uint8Array.from(this.parts)}}function Co(o){const e=new Uint8Array(o.length*4),t=new DataView(e.buffer);for(let n=0;n<o.length;n++)t.setFloat32(n*4,o[n],!0);return e}const Po=18,To=8,Ir=1,zr=7,No=1,$o=2,Io=3,zo=7;class Wo{nodes=[];inits=[];uid=0;tmp(e){return`${e}_${this.uid++}`}initFloat(e,t,n){return this.inits.push({name:e,dims:t,dataType:Ir,raw:Co(n)}),e}initInt64(e,t,n){return this.inits.push({name:e,dims:t,dataType:zr,int64:n}),e}node(e,t,n,r=[]){return this.nodes.push({op:e,inputs:t,outputs:n,name:`${e}_${this.uid++}`,attrs:r}),n}op(e,t,n,r=[]){const a=this.tmp(n);return this.node(e,t,[a],r),a}}function Yt(o,e,t,n,r){const a=o.op("Mul",[e,e],"rms_sq"),s=o.op("ReduceMean",[a,r],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),d=o.op("Add",[s,n],"rms_eps"),i=o.op("Sqrt",[d],"rms_r"),c=o.op("Div",[e,i],"rms_div");return o.op("Mul",[c,t],"rms_y")}function Qt(o,e,t,n,r,a){const s=o.op("Transpose",[t],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),d=o.op("Add",[o.op("MatMul",[e,s],"ffn_mm1"),n],"ffn_pre"),i=o.op("Relu",[d],"ffn_h"),c=o.op("Transpose",[r],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return o.op("Add",[o.op("MatMul",[i,c],"ffn_mm2"),a],"ffn_y")}function Jt(o,e={}){const t=Ce(o),n=vt(o),r=new Map(n.map(_=>[_.name,_])),a=_=>{const w=r.get(_);if(!w)throw new Error(`export/onnx: missing tensor ${_}`);return w},s=new Wo,{vocabSize:d,dModel:i,numLayers:c,convKernel:u,numExperts:l,topK:h}=t,m=s.initFloat("token_embedding.weight",[d,i],a("token_embedding.weight").data),f=s.initFloat("rms_eps",[1],new Float32Array([1e-5])),g=s.initInt64("axes_last",[1],[2]),p=s.initInt64("topk_k",[1],[h]);let b=s.op("Gather",[m,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let _=0;_<c;_++){const w=`layers.${_}`,x=s.initFloat(`${w}.norm_conv.weight`,[i],a(`${w}.norm_conv.weight`).data),L=Yt(s,b,x,f,g),T=a(`${w}.conv.weight`).data,M=new Float32Array(i*u);for(let V=0;V<i;V++)for(let X=0;X<u;X++)M[V*u+(u-1-X)]=T[V*u+X];const B=s.initFloat(`${w}.conv.onnx_weight`,[i,1,u],M),C=s.op("Transpose",[L],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),O=s.op("Conv",[C,B],"conv_out",[{kind:"i",name:"group",value:i},{kind:"ints",name:"kernel_shape",value:[u]},{kind:"ints",name:"pads",value:[u-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),U=s.op("Transpose",[O],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),K=s.op("Add",[b,U],"after_conv"),j=s.initFloat(`${w}.norm_moe.weight`,[i],a(`${w}.norm_moe.weight`).data),G=Yt(s,K,j,f,g),A=s.initFloat(`${w}.moe.router.weight`,[l,i],a(`${w}.moe.router.weight`).data),v=s.op("Transpose",[A],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),k=s.op("MatMul",[G,v],"router_logits"),S=s.tmp("topk_v"),W=s.tmp("topk_i");s.node("TopK",[k,p],[S,W],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const q=s.op("Softmax",[S],"gates",[{kind:"i",name:"axis",value:2}]),N=s.op("Sub",[k,k],"zeros"),P=s.op("ScatterElements",[N,W,q],"combine",[{kind:"i",name:"axis",value:2}]),D=Qt(s,G,s.initFloat(`${w}.moe.shared.w1`,[t.hiddenDim,i],a(`${w}.moe.shared.w1`).data),s.initFloat(`${w}.moe.shared.b1`,[t.hiddenDim],a(`${w}.moe.shared.b1`).data),s.initFloat(`${w}.moe.shared.w2`,[i,t.hiddenDim],a(`${w}.moe.shared.w2`).data),s.initFloat(`${w}.moe.shared.b2`,[i],a(`${w}.moe.shared.b2`).data)),H=Array.from({length:l},(V,X)=>s.tmp(`combine_${X}`));s.node("Split",[P],H,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:l}]);let J=D;for(let V=0;V<l;V++){const X=`${w}.moe.experts.${V}`,ne=Qt(s,G,s.initFloat(`${X}.w1`,[t.hiddenDim,i],a(`${X}.w1`).data),s.initFloat(`${X}.b1`,[t.hiddenDim],a(`${X}.b1`).data),s.initFloat(`${X}.w2`,[i,t.hiddenDim],a(`${X}.w2`).data),s.initFloat(`${X}.b2`,[i],a(`${X}.b2`).data)),ue=s.op("Mul",[H[V],ne],"expert_w");J=s.op("Add",[J,ue],"moe_acc")}b=s.op("Add",[K,J],"after_moe")}const y=s.op("Transpose",[m],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return s.node("MatMul",[b,y],["logits"]),Ko(s,t,e)}function jo(o){const e=new ee;switch(e.string(1,o.name),o.kind){case"i":e.varint(20,$o),e.varint(3,o.value);break;case"ints":e.varint(20,zo);for(const t of o.value)e.varint(8,t);break;case"f":e.varint(20,No),e.float(2,o.value);break;case"s":e.varint(20,Io),e.string(4,o.value);break}return e}function Ro(o){const e=new ee;for(const t of o.inputs)e.string(1,t);for(const t of o.outputs)e.string(2,t);e.string(3,o.name),e.string(4,o.op);for(const t of o.attrs)e.message(5,jo(t));return e}function Oo(o){const e=new ee;for(const t of o.dims)e.varint(1,t);if(e.varint(2,o.dataType),e.string(8,o.name),o.int64)for(const t of o.int64)e.varint(7,t);return o.raw&&e.bytes(9,o.raw),e}function Uo(o){const e=new ee;return e.string(2,o),e}function Go(o){const e=new ee;return e.varint(1,o),e}function Zt(o,e,t){const n=new ee;for(const d of t)n.message(1,typeof d=="string"?Uo(d):Go(d));const r=new ee;r.varint(1,e),r.message(2,n);const a=new ee;a.message(1,r);const s=new ee;return s.string(1,o),s.message(2,a),s}function Ko(o,e,t){const n=new ee;for(const s of o.nodes)n.message(1,Ro(s));n.string(2,"evermind");for(const s of o.inits)n.message(5,Oo(s));n.message(11,Zt("input_ids",zr,["batch","seq"])),n.message(12,Zt("logits",Ir,["batch","seq",e.vocabSize]));const r=new ee;r.string(1,""),r.varint(2,Po);const a=new ee;return a.varint(1,To),a.string(2,t.producerName??"builderforce-memory-engine"),a.string(3,t.producerVersion??"evermind"),a.message(7,n),a.message(8,r),a.finish()}const Ho=1179993927,qo=3,xe=32,Vo=4,Xo=8,Yo=0,Qo=1;class Jo{buf=new Uint8Array(1024);len=0;ensure(e){if(this.len+e<=this.buf.length)return;let t=this.buf.length*2;for(;t<this.len+e;)t*=2;const n=new Uint8Array(t);n.set(this.buf.subarray(0,this.len)),this.buf=n}u32(e){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,e,!0),this.len+=4}u64(e){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(e),!0),this.len+=8}raw(e){this.ensure(e.length),this.buf.set(e,this.len),this.len+=e.length}alignTo(e){const t=(e-this.len%e)%e;t>0&&(this.ensure(t),this.len+=t)}string(e){const t=new TextEncoder().encode(e);this.u64(t.length),this.raw(t)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function Zo(o,e){if(!e){const r=new Uint8Array(o.length*4),a=new DataView(r.buffer);for(let s=0;s<o.length;s++)a.setFloat32(s*4,o[s],!0);return r}const t=new Uint8Array(o.length*2),n=new DataView(t.buffer);for(let r=0;r<o.length;r++)n.setUint16(r*2,Oe(o[r]),!0);return t}function er(o,e={}){const t=e.fp16??!1,n=Ce(o),r=vt(o),a=t?Qo:Yo,s=t?2:4,d=[["evermind.vocab_size",n.vocabSize],["evermind.embedding_length",n.dModel],["evermind.block_count",n.numLayers],["evermind.conv_kernel",n.convKernel],["evermind.feed_forward_length",n.hiddenDim],["evermind.expert_count",n.numExperts],["evermind.expert_used_count",n.topK],["general.alignment",xe]],i=[["general.architecture","evermind"],["general.name",e.name??"Evermind"]],c=new Jo;c.u32(Ho),c.u32(qo),c.u64(r.length),c.u64(d.length+i.length);for(const[f,g]of i)c.string(f),c.u32(Xo),c.string(g);for(const[f,g]of d)c.string(f),c.u32(Vo),c.u32(g);const u=f=>[...f.shape].reverse();let l=0;const h=[];for(const f of r){h.push(l);const g=f.data.length*s;l+=g,l+=(xe-l%xe)%xe}r.forEach((f,g)=>{c.string(f.name);const p=u(f);c.u32(p.length);for(const b of p)c.u64(b);c.u32(a),c.u64(h[g])}),c.alignTo(xe);const m=c.length;for(let f=0;f<r.length;f++){const g=m+h[f];for(;c.length<g;)c.raw(new Uint8Array(1));c.raw(Zo(r[f].data,t))}return c.bytes()}function ea(o){const e=Ce(o);return{model_type:"evermind",architectures:["EvermindForCausalLM"],vocab_size:e.vocabSize,d_model:e.dModel,hidden_size:e.dModel,num_hidden_layers:e.numLayers,conv_kernel:e.convKernel,intermediate_size:e.hiddenDim,num_experts:e.numExperts,num_experts_per_tok:e.topK,rms_norm_eps:1e-5,tie_word_embeddings:!0,torch_dtype:"float32",transformers_version:"4.0.0"}}function ta(){return{do_sample:!1,temperature:1,max_new_tokens:64}}function ra(o){const e={};for(const[r,a]of o.vocab)e[r]=a;const t=[...o.merges.keys()],n=[];for(const r of[o.unkToken,o.bosToken,o.eosToken,o.padToken]){const a=o.vocab.get(r);a!==void 0&&!n.some(s=>s.id===a)&&n.push({id:a,content:r})}return{version:"1.0",truncation:null,padding:null,added_tokens:n.map(r=>({id:r.id,content:r.content,single_word:!1,lstrip:!1,rstrip:!1,normalized:!1,special:!0})),normalizer:null,pre_tokenizer:{type:"ByteLevel",add_prefix_space:!1,trim_offsets:!0,use_regex:!0},post_processor:{type:"ByteLevel",add_prefix_space:!0,trim_offsets:!1,use_regex:!0},decoder:{type:"ByteLevel",add_prefix_space:!0,trim_offsets:!0,use_regex:!0},model:{type:"BPE",dropout:null,unk_token:null,continuing_subword_prefix:null,end_of_word_suffix:null,fuse_unk:!1,byte_fallback:!1,vocab:e,merges:t}}}function na(o,e={}){const t=Ce(o),n=$r(o),r=e.name??"Evermind",a=e.license??"mit",s=["evermind","ssm","mixture-of-experts","text-generation",...e.tags??[]],d=["---",`license: ${a}`,"library_name: builderforce-memory","pipeline_tag: text-generation","tags:",...s.map(c=>`  - ${c}`),"---"].join(`
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
${i}`}const Is=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],oa="application/json";function Qe(o,e){return{path:o,data:JSON.stringify(e,null,2),contentType:oa}}function zs(o,e,t={},n){const r=$r(o),a=()=>({format:e,files:[],paramCount:r});switch(e){case"safetensors":{const s=a();return s.files.push({path:"model.safetensors",data:Xt(o,{fp16:t.fp16}),contentType:"application/octet-stream"}),s}case"onnx":{const s=a();return s.files.push({path:"model.onnx",data:Jt(o,{producerVersion:t.version}),contentType:"application/octet-stream"}),s}case"gguf":{const s=a();return s.files.push({path:"model.gguf",data:er(o,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"}),s}case"huggingface":{if(!n)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const s=a();return s.files.push({path:"model.safetensors",data:Xt(o,{fp16:t.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:Jt(o,{producerVersion:t.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:er(o,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"},Qe("config.json",ea(o)),Qe("generation_config.json",ta()),Qe("tokenizer.json",ra(n)),{path:"README.md",data:na(o,t),contentType:"text/markdown"}),s}default:throw new Error(`exportEvermind: unknown format "${String(e)}"`)}}function Wr(o){if(o.length<8)throw new Error("safetensors: buffer too short for header length");const e=new DataView(o.buffer,o.byteOffset,o.byteLength),t=Number(e.getBigUint64(0,!0)),n=8+t;if(n>o.length)throw new Error(`safetensors: header length ${t} exceeds buffer`);const r=new TextDecoder().decode(o.subarray(8,n));let a;try{a=JSON.parse(r)}catch(i){throw new Error(`safetensors: malformed JSON header (${i instanceof Error?i.message:String(i)})`)}const s=n,d=[];for(const[i,c]of Object.entries(a)){if(i==="__metadata__")continue;const u=c;if(!u||!Array.isArray(u.shape)||!Array.isArray(u.data_offsets))throw new Error(`safetensors: malformed entry for "${i}"`);const[l,h]=u.data_offsets,m=u.shape.reduce((g,p)=>g*p,1),f=o.subarray(s+l,s+h);d.push({name:i,shape:u.shape,data:aa(f,u.dtype,m,i)})}return d}function aa(o,e,t,n){const r=new DataView(o.buffer,o.byteOffset,o.byteLength),a=new Float32Array(t),s=e.toUpperCase();if(s==="F32"||s==="FLOAT32"){if(o.length<t*4)throw new Error(`safetensors: "${n}" F32 bytes ${o.length} < ${t*4}`);for(let d=0;d<t;d++)a[d]=r.getFloat32(d*4,!0);return a}if(s==="F16"||s==="FLOAT16"){if(o.length<t*2)throw new Error(`safetensors: "${n}" F16 bytes ${o.length} < ${t*2}`);for(let d=0;d<t;d++)a[d]=ft(r.getUint16(d*2,!0));return a}if(s==="BF16"||s==="BFLOAT16"){if(o.length<t*2)throw new Error(`safetensors: "${n}" BF16 bytes ${o.length} < ${t*2}`);const d=new Uint32Array(a.buffer);for(let i=0;i<t;i++)d[i]=r.getUint16(i*2,!0)<<16;return a}throw new Error(`safetensors: unsupported dtype "${e}" for "${n}" (expected F32, F16 or BF16)`)}function sa(o,e){const t=new Map(o.map(h=>[h.name,h])),n=t.get("token_embedding.weight");if(!n||n.shape.length!==2)throw new Error("import: missing token_embedding.weight [vocab, dModel]");const[r,a]=n.shape;let s=0,d=0;for(const h of o){const m=/^layers\.(\d+)\./.exec(h.name);m&&(s=Math.max(s,Number(m[1])+1));const f=/^layers\.\d+\.moe\.experts\.(\d+)\./.exec(h.name);f&&(d=Math.max(d,Number(f[1])+1))}if(s===0)throw new Error("import: no `layers.<n>.` tensors found");const i=t.get("layers.0.conv.weight");if(!i||i.shape.length!==2)throw new Error("import: missing layers.0.conv.weight [dModel, convKernel]");const c=i.shape[1],u=t.get("layers.0.moe.shared.w1");if(!u||u.shape.length!==2)throw new Error("import: missing layers.0.moe.shared.w1 [hiddenDim, dModel]");const l=u.shape[0];return{vocabSize:r,dModel:a,numLayers:s,convKernel:c,hiddenDim:l,numExperts:d,topK:Math.min(e??2,Math.max(1,d))}}function ia(o,e={}){const t=[];for(const c of o){const u=e.rename?e.rename(c.name):c.name;u!=null&&t.push({...c,name:u})}const n=new Map(t.map(c=>[c.name,c])),r=e.arch??sa(t,e.topK),a=Nr(r),s=[];for(const c of a){const u=n.get(c.name);if(!u)throw new Error(`import: missing tensor "${c.name}" (expected shape [${c.shape.join(", ")}])`);const l=c.shape.reduce((h,m)=>h*m,1);if(u.data.length!==l)throw new Error(`import: tensor "${c.name}" has ${u.data.length} elements, expected ${l} ([${c.shape.join(", ")}])`);s.push(u.data)}const d=new Ke({vocabSize:r.vocabSize,dModel:r.dModel,numLayers:r.numLayers,convKernel:r.convKernel,hiddenDim:r.hiddenDim,numExperts:r.numExperts,topK:r.topK}),i=d.parameters();if(i.length!==s.length)throw new Error(`import: parameter-count drift (model ${i.length} vs imported ${s.length})`);for(let c=0;c<i.length;c++)i[c].data.set(s[c]);return d}function Ws(o,e={}){return ia(Wr(o),e)}function jr(o){return o.startsWith("model.")?o.slice(6):o}function da(o){return o.reduce((e,t)=>e*t,1)}function he(o){const e=o.filter(t=>t!==1);return e.length>0?e:[1]}function Je(o,e){return o.length===e.length&&o.every((t,n)=>t===e[n])}function ca(o){if(!(o>0))throw new Error(`import/foreign: softplus⁻¹ needs a positive input, got ${o}`);return o>30?o:Math.log(Math.expm1(o))}function tr(o,e){const t=da(o.shape);if(o.op.kind==="fill")return new Float32Array(t).fill(o.op.value);if(!e)throw new Error(`import/foreign: rule for "${o.target}" has no source tensor`);const n=`"${e.name}" → "${o.target}"`;switch(o.op.kind){case"copy":case"negExpToSoftplusInv":{if(!Je(he(e.shape),he(o.shape)))throw new Error(`import/foreign: ${n} shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${o.shape.join(", ")}]`);if(e.data.length!==t)throw new Error(`import/foreign: ${n} has ${e.data.length} elements, expected ${t}`);if(o.op.kind==="copy")return Float32Array.from(e.data);const r=new Float32Array(t);for(let a=0;a<t;a++)r[a]=ca(Math.exp(e.data[a]));return r}case"convTaps":{const[r,a]=he(o.shape),s=he(e.shape);if(!Je(s,[r,a]))throw new Error(`import/foreign: ${n} depthwise conv shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${o.shape.join(", ")}] (a [channels, 1, kernel] PyTorch kernel squeezes to [channels, kernel])`);const d=new Float32Array(t);for(let i=0;i<r;i++)for(let c=0;c<a;c++)d[i*a+c]=e.data[i*a+(a-1-c)];return d}case"rowSlice":{if(e.shape.length!==2)throw new Error(`import/foreign: ${n} rowSlice needs a rank-2 source, got [${e.shape.join(", ")}]`);const[r,a]=e.shape,{start:s,count:d}=o.op;if(s<0||s+d>r)throw new Error(`import/foreign: ${n} rowSlice [${s}, ${s+d}) is outside the checkpoint tensor's ${r} rows — the source layout is not what this adapter expects`);if(!Je(he(o.shape),he([d,a])))throw new Error(`import/foreign: ${n} rowSlice yields [${d}, ${a}] but this model expects [${o.shape.join(", ")}]`);return Float32Array.from(e.data.subarray(s*a,(s+d)*a))}}}function la(o,e){const t=new Map;for(const d of e){const i=jr(d.name);t.set(i,{...d,name:i})}const n=new Map,r=[],a=new Set;for(const d of o.rules){if(n.has(d.target))throw new Error(`import/foreign: plan "${o.adapter}" defines "${d.target}" twice`);if(d.from.length===0){if(d.op.kind!=="fill")throw new Error(`import/foreign: rule for "${d.target}" names no source but is not a fill rule`);n.set(d.target,tr(d,null)),r.push({target:d.target,value:d.op.value,reason:d.note??"this architecture has no corresponding tensor"});continue}const i=d.from.map(c=>t.get(c)).find(c=>c!=null);if(!i)throw new Error(`import/foreign: checkpoint is missing "${d.from[0]}" (needed for "${d.target}", expected shape [${d.shape.join(", ")}])`+(d.from.length>1?`; also tried ${d.from.slice(1).map(c=>`"${c}"`).join(", ")}`:""));a.add(i.name),n.set(d.target,tr(d,i))}const s=[...t.keys()].filter(d=>!a.has(d)).sort();return{adapter:o.adapter,weights:n,unmappedSources:s,synthesisedTargets:r,discardedSources:o.discards}}function xt(o,e){throw new Error(`import/foreign: config field "${o}" ${e}`)}function te(o,e){const t=o[e];return(typeof t!="number"||!Number.isInteger(t)||t<=0)&&xt(e,`must be a positive integer, got ${JSON.stringify(t)}`),t}function Ae(o,e){for(const t of e){const n=o[t];if(typeof n=="number"&&Number.isInteger(n)&&n>0)return n}}function Rr(o,e){const t=Ae(o,["intermediate_size"]);if(t!==void 0)return t;const n=Ae(o,["expand"]);return n===void 0&&xt("intermediate_size",'is absent and no usable "expand" was found'),n*e}function Or(o,e,t){if(o%e!==0)throw new Error(`import/foreign: ${t} has d_inner ${o} which is not a whole multiple of d_model ${e} — this engine's blocks are sized by an integer expand factor`);return o/e}function ua(o,e){const t=o.time_step_rank;if(typeof t=="number"&&Number.isInteger(t)&&t>0)return t;if(t===void 0||t==="auto")return Math.ceil(e/16);xt("time_step_rank",`must be a positive integer or "auto", got ${JSON.stringify(t)}`)}const ha=["backbone.embeddings.weight","backbone.embedding.weight"];function fa(o){const{vocabSize:e,dModel:t,numLayers:n,dInner:r,dState:a,dConv:s,dtRank:d}=o,i=[{target:"embedding",shape:[e,t],from:ha,op:{kind:"copy"}}];for(let c=0;c<n;c++){const u=`backbone.layers.${c}.mixer`,l=`layer${c}`;i.push({target:`${l}.wInProj`,shape:[2*r,t],from:[`${u}.in_proj.weight`],op:{kind:"copy"}},{target:`${l}.bInProj`,shape:[2*r],from:[],op:{kind:"fill",value:0},note:"Falcon-Mamba sets use_bias=false — in_proj ships no bias; zeros are exact"},{target:`${l}.wConv`,shape:[r,s],from:[`${u}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [d_inner, 1, d_conv] → [d_inner, d_conv] with the tap axis reversed"},{target:`${l}.bConv`,shape:[r],from:[`${u}.conv1d.bias`],op:{kind:"copy"}},{target:`${l}.wXProj`,shape:[d+2*a,r],from:[`${u}.x_proj.weight`],op:{kind:"copy"}},{target:`${l}.bXProj`,shape:[d+2*a],from:[],op:{kind:"fill",value:0},note:"x_proj is bias-free upstream; zeros are exact"},{target:`${l}.wDtProj`,shape:[r,d],from:[`${u}.dt_proj.weight`],op:{kind:"copy"}},{target:`${l}.bDtProj`,shape:[r],from:[`${u}.dt_proj.bias`],op:{kind:"copy"}},{target:`${l}.A_log`,shape:[r,a],from:[`${u}.A_log`],op:{kind:"copy"}},{target:`${l}.D_vec`,shape:[r],from:[`${u}.D`],op:{kind:"copy"}},{target:`${l}.wOutProj`,shape:[t,r],from:[`${u}.out_proj.weight`],op:{kind:"copy"}},{target:`${l}.bOutProj`,shape:[t],from:[],op:{kind:"fill",value:0},note:"out_proj is bias-free upstream; zeros are exact"},{target:`${l}.normWeight`,shape:[t],from:[`backbone.layers.${c}.norm.weight`],op:{kind:"copy"}})}return i.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),i}function Ur(o){const e=o.id;return{...o,describe(t){const n=te(t,"hidden_size"),r=te(t,"num_hidden_layers"),a=te(t,"vocab_size"),s=te(t,"state_size"),d=te(t,"conv_kernel"),i=Rr(t,n),c=Or(i,n,o.label),u=ua(t,n),l={vocabSize:a,dModel:n,numLayers:r,dState:s,dConv:d,expand:c,defaultMamba1:{dtRank:u,biasConv:!0}},h={adapter:e,rules:fa({vocabSize:a,dModel:n,numLayers:r,dInner:i,dState:s,dConv:d,dtRank:u}),discards:[]};return{modelConfig:l,plan:h}}}}const ma=Ur({id:"falcon_mamba",label:"Falcon-Mamba (Mamba-1 / S6)",modelTypes:["falcon_mamba"],architectures:["FalconMambaForCausalLM"]}),pa=Ur({id:"mamba",label:"Mamba (Mamba-1 / S6)",modelTypes:["mamba"],architectures:["MambaForCausalLM"]}),rr="codestral_mamba",ga=["backbone.embeddings.weight","backbone.embedding.weight"];function _a(o){const{vocabSize:e,dModel:t,numLayers:n,dInner:r,dState:a,dConv:s,nHeads:d,nGroups:i}=o,c=r+2*i*a,u=c+d,l=[{target:"embedding",shape:[e,t],from:ga,op:{kind:"copy"}}];for(let h=0;h<n;h++){const m=`backbone.layers.${h}.mixer`,f=`layer${h}`;l.push({target:`${f}.wInProj`,shape:[u,t],from:[`${m}.in_proj.weight`],op:{kind:"rowSlice",start:r,count:u},note:"upstream rows are [gate, x, B, C, dt]; this block has no gate branch"},{target:`${f}.wConv`,shape:[c,s],from:[`${m}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [conv_dim, 1, d_conv] → [conv_dim, d_conv] with the tap axis reversed"},{target:`${f}.bConv`,shape:[c],from:[`${m}.conv1d.bias`],op:{kind:"copy"}},{target:`${f}.A_log`,shape:[d],from:[`${m}.A_log`],op:{kind:"negExpToSoftplusInv"},note:"upstream A = -exp(A_log); this engine's SSD kernel uses A = -softplus(A_log)"},{target:`${f}.dt_bias`,shape:[d],from:[`${m}.dt_bias`],op:{kind:"copy"}},{target:`${f}.D_vec`,shape:[d],from:[`${m}.D`],op:{kind:"copy"}},{target:`${f}.wOutProj`,shape:[t,r],from:[`${m}.out_proj.weight`],op:{kind:"copy"}},{target:`${f}.normWeight`,shape:[r],from:[`${m}.norm.weight`],op:{kind:"copy"},note:"upstream this gain belongs to a GATED RMSNorm; applied ungated here"},{target:`${f}.preNormWeight`,shape:[t],from:[`backbone.layers.${h}.norm.weight`],op:{kind:"copy"}})}return l.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),l}function ba(o){const e=[];for(let t=0;t<o.numLayers;t++)e.push({source:`backbone.layers.${t}.mixer.in_proj.weight`,elements:o.dInner*o.dModel,reason:"the leading d_inner gate (z) rows — Mamba2Block computes norm(y) rather than norm(y * silu(z)), so it has no gate branch to receive them"});return e}const wa={id:rr,label:"Codestral-Mamba (Mamba-2 / SSD)",modelTypes:["mamba2"],architectures:["Mamba2ForCausalLM","MambaCodestralForCausalLM"],describe(o){const e=te(o,"hidden_size"),t=te(o,"num_hidden_layers"),n=te(o,"vocab_size"),r=te(o,"state_size"),a=te(o,"conv_kernel"),s=te(o,"num_heads"),d=Ae(o,["n_groups"])??1,i=Ae(o,["chunk_size"])??256,c=Rr(o,e),u=Or(c,e,"Codestral-Mamba"),l=Ae(o,["head_dim"]);if(c%s!==0)throw new Error(`import/foreign: Codestral-Mamba d_inner ${c} is not divisible by num_heads ${s}`);if(l!==void 0&&l*s!==c)throw new Error(`import/foreign: Codestral-Mamba config is inconsistent — head_dim ${l} × num_heads ${s} = ${l*s}, but d_inner is ${c}`);const h=Array.from({length:t},()=>({type:"mamba2"})),m={vocabSize:n,dModel:e,numLayers:t,layers:h,dState:r,dConv:a,expand:u,nHeads:s,nGroups:d,chunkLen:i},f={vocabSize:n,dModel:e,numLayers:t,dInner:c,dState:r,dConv:a,nHeads:s,nGroups:d};return{modelConfig:m,plan:{adapter:rr,rules:_a(f),discards:ba(f)}}}},st=[pa,ma,wa];function ya(o){const e=o.architectures;return Array.isArray(e)?e.filter(t=>typeof t=="string"):[]}function va(o){const e=o.model_type;return typeof e=="string"?e:void 0}function xa(o,e){const t=[...o,e??""].join(" ").toLowerCase();return t.includes("mamba")||t.includes("ssm")?!1:/llama|mistral|qwen|gpt|phi|gemma|falcon(?!_?mamba)|starcoder|deepseek|olmo|attention|forcausallm/.test(t)}function nr(){return st.map(o=>`${o.label} — architectures ${o.architectures.join(" / ")}, model_type ${o.modelTypes.join(" / ")}`).join("; ")}function ka(o){const e=ya(o),t=va(o),n=st.find(s=>e.some(d=>s.architectures.includes(d)));if(n)return n;const r=t?st.find(s=>s.modelTypes.includes(t)):void 0;if(r)return r;const a=e.length>0?`architectures [${e.join(", ")}]`:t?`model_type "${t}"`:"a config declaring neither `architectures` nor `model_type`";throw xa(e,t)?new Error(`import/foreign: ${a} is a TRANSFORMER checkpoint — its attention weights (q/k/v/o projections, positional embeddings) have no counterpart in a state-space mixer, so no weight port can exist for it at any tensor naming. Transformer coders (IQuest, NousCoder, Maincoder and the like) can only be brought across by DISTILLATION — train this engine's SSM against the transformer's outputs. Weight porting is supported only for: ${nr()}.`):new Error(`import/foreign: unsupported checkpoint — ${a}. Supported: ${nr()}. A transformer checkpoint cannot be weight-ported at all; distillation is the only route.`)}function Aa(o,e){const t=ka(o),{modelConfig:n,plan:r}=t.describe(o);return{...la(r,e),modelConfig:n}}function js(o,e){return Aa(o,Wr(e))}function Rs(o,e){const t=o.parameters(),n=new Set(t.map(a=>a.name)),r=[...e.weights.keys()].filter(a=>!n.has(a));if(r.length>0)throw new Error(`import/foreign: ported tensors ${r.slice(0,5).map(a=>`"${a}"`).join(", ")}${r.length>5?` (+${r.length-5} more)`:""} have no parameter on this model — build it from the port's modelConfig`);for(const a of t){const s=e.weights.get(a.name);if(!s)throw new Error(`import/foreign: no ported tensor for parameter "${a.name}" — the model was built from a different config than the port's modelConfig`);if(s.length!==a.numel)throw new Error(`import/foreign: parameter "${a.name}" expects ${a.numel} elements, the port produced ${s.length}`);pe(o.device,a.buf,s)}}function $e(o){throw new Error(`import/foreign: cannot read a Mamba-1 config from these tensors — ${o}`)}function Os(o){const e=new Map(o.map(p=>[jr(p.name),p])),t=p=>e.get(p)?.shape,n=t("backbone.embeddings.weight")??t("backbone.embedding.weight");(!n||n.length!==2)&&$e("no backbone.embedding(s).weight [vocab, d_model]");const[r,a]=n;let s=0;for(;e.has(`backbone.layers.${s}.mixer.in_proj.weight`);)s++;s===0&&$e("no backbone.layers.N.mixer.in_proj.weight");const d="backbone.layers.0.mixer",i=t(`${d}.in_proj.weight`),c=t(`${d}.conv1d.weight`),u=t(`${d}.A_log`),l=t(`${d}.x_proj.weight`);(!c||!u||!l)&&$e("layer 0 is missing conv1d.weight, A_log or x_proj.weight");const h=i[0]/2,m=u[1],f=c[c.length-1],g=l[0]-2*m;return(!Number.isInteger(h)||g<=0)&&$e(`inconsistent shapes (in_proj ${i.join("×")}, x_proj ${l.join("×")})`),{model_type:"mamba",architectures:["MambaForCausalLM"],vocab_size:r,hidden_size:a,num_hidden_layers:s,intermediate_size:h,state_size:m,conv_kernel:f,time_step_rank:g}}function Us(o,e,t={}){if(!Number.isInteger(e)||e<=0)throw new Error(`import/foreign: vocabulary size must be a positive integer, got ${e}`);const n=o.modelConfig.vocabSize;if(e===n)return o;const r=o.weights.get("embedding");if(!r)throw new Error('import/foreign: the port has no "embedding" to resize');const a=o.modelConfig.dModel,s=new Float32Array(e*a);s.set(r.subarray(0,Math.min(n,e)*a));const d=[...o.synthesisedTargets];if(e>n){const c=t.std??.02,u=new re(t.seed??1);s.set(be((e-n)*a,c,()=>u.next()),n*a),d.push({target:"embedding",value:c,reason:`rows ${n}..${e-1} drawn from N(0, ${c}²) to reach a ${e}-token vocabulary`})}const i=new Map(o.weights);return i.set("embedding",s),{...o,weights:i,synthesisedTargets:d,modelConfig:{...o.modelConfig,vocabSize:e}}}const Ma=`

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
`,Gs=`

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
`,Ks={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},Gr={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},Kr=8,ae=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],La=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],kt=[0,.2,.5,.5,.8,.5,.7,.5];function qe(o,e){const t=La[o];return t?Number.isNaN(e)?t[0]:Math.max(t[0],Math.min(t[1],e)):e}function Hs(o){for(let e=0;e<o.length&&e<Kr;e++)o[e]=qe(e,o[e]);return o}function Sa(){return Float32Array.from(kt)}function Hr(o){const e={};for(let t=0;t<ae.length;t++)e[ae[t]]=o[t]??0;return e}function Ea(o){const e=Sa();for(let t=0;t<ae.length;t++){const n=o[ae[t]];typeof n=="number"&&!Number.isNaN(n)&&(e[t]=qe(t,n))}return e}function se(o){return((typeof o=="number"&&!Number.isNaN(o)?Math.max(0,Math.min(100,o)):50)-50)/50}function qr(o){const e=Hr(kt);if(!o)return e;const t=se(o.openness),n=se(o.emotionality),r=se(o.conscientiousness),a=se(o.extraversion),s=se(o.regulatoryFocus),d=se(o.riskTolerance),i=se(o.grit),c=se(o.stimulation),u=(l,h)=>{e[l]=qe(Gr[l],h)};return u("driveCuriosity",.5+.35*t+.15*c),u("exploration",.4+.3*t+.25*d+.15*s),u("driveCaution",.5+.3*r-.3*d-.2*s+.15*n),u("arousal",.2+.2*n+.1*a),u("driveSocial",.5+.35*a),u("driveEffort",.8+.15*i+.1*r),u("valence",0+.1*s-.1*n),u("attention",.7+.1*r),e}function qs(o){return Ea(qr(o))}function it(o,e){return qe(Gr[o],e)}function dt(){return Hr(kt)}function Vs(o){if(o.length===0)return dt();const e=dt();for(const t of ae)e[t]=0;for(const t of o){const n=qr(t);for(const r of ae)e[r]+=n[r]}for(const t of ae)e[t]/=o.length;return e}function or(o,e){const t={...o};for(const n of ae){const r=e[n];typeof r=="number"&&!Number.isNaN(r)&&(t[n]=it(n,t[n]+r))}return t}const Ba=o=>Math.max(0,Math.min(1,o.intensity??.5));function Xs(o){const e=Ba(o);switch(o.kind){case"success":return{valence:.5*e,arousal:-.15*e,driveCaution:-.1*e,driveEffort:-.05*e};case"progress":return{valence:.25*e,arousal:.05*e,driveEffort:-.03*e};case"error":return{valence:-.45*e,arousal:.4*e,driveCaution:.3*e,attention:.15*e};case"blocked":return{valence:-.35*e,arousal:.3*e,driveEffort:-.15*e,driveSocial:.2*e};case"risk":return{arousal:.35*e,driveCaution:.4*e,attention:.2*e,exploration:-.15*e};case"feedback":{const t=Math.sign(o.sign??1)||1;return{valence:.4*e*t,arousal:.1*e,driveSocial:.1*e}}case"idle":return{arousal:-.2*e,driveEffort:.15*e};default:return{}}}function Ys(o,e,t={}){const n=t.rate??.1,r=t.fatigue??0,a={...o};for(const s of ae)a[s]=it(s,a[s]+n*(e[s]-a[s]));return r>0&&(a.driveEffort=it("driveEffort",a.driveEffort-r)),a}function Da(o,e=.5){const t=o.arousal-e,n=1-2.8*t*t;return Math.max(.1,Math.min(1,n))}function ct(o){let e=.5*o.exploration+.3*o.driveCuriosity;return e+=.15*o.valence,e-=.25*(1-o.driveEffort),e-=.2*(o.driveCaution-.5),Math.max(0,Math.min(1,e))}function Qs(o,e){if(e.length===0)return{choice:null,exploreBias:ct(o)};const t=ct(o);let n=e[0],r=-1/0;for(const a of e){const s=Math.max(0,Math.min(1,a.novelty)),d=-Math.abs(s-t);d>r&&(r=d,n=a)}return{choice:n,exploreBias:t}}const Ze=.6,et=.4;function Fa(o){const e=[],t={},n=i=>{t.thinkLevel!=="high"&&(t.thinkLevel=i)};o.valence<=-.4?(e.push("Affect (negative): recent steps have gone badly — slow down, avoid rash or destructive actions, and re-verify your assumptions before proceeding."),n("high"),t.reasoningLevel="on"):o.valence>=.4&&e.push("Affect (positive): things are going well — keep momentum, but don't get sloppy."),o.arousal>=.7?(e.push("Arousal (heightened): you are highly activated — resist the urge to rush; double-check before any irreversible step."),n("high")):o.arousal<=.15&&e.push("Arousal (low): this is routine — keep it lightweight and efficient."),o.driveCaution>=Ze?(e.push("Drive (caution): heightened — prefer reversible steps, add guardrails, and confirm risky or destructive operations."),n("medium")):o.driveCaution<=et&&e.push("Drive (caution): relaxed — bias to action on low-risk work."),o.driveCuriosity>=Ze&&e.push("Drive (curiosity): high — it is appropriate to investigate and consider alternative approaches."),o.driveEffort<=et&&e.push("Drive (effort): energy is low — keep scope tight, avoid over-engineering, checkpoint progress, and consider escalating rather than grinding."),o.driveSocial>=Ze?e.push("Drive (social): communicate proactively — surface progress and ask for input when blocked."):o.driveSocial<=et&&e.push("Drive (social): work heads-down — narrate only what matters."),Da(o)<=.5&&(e.push("Attention (degraded): your attention gate is low — re-read the task carefully and do not skip verification steps."),n("medium"));const a=ct(o);a>=.7?e.push("Action selection: lean exploratory — try a novel approach before settling on the obvious one."):a<=.3&&e.push("Action selection: lean exploitative — use the proven, known approach and avoid unnecessary detours.");let s=0;s+=.2*(o.exploration-.5)*2,s+=.06*(o.driveCuriosity-.5)*2,s+=.08*o.valence,s-=.16*(o.driveCaution-.5)*2,s-=.08*Math.max(0,o.arousal-.7);const d=Math.max(-.3,Math.min(.3,Math.round(s*100)/100));return Math.abs(d)>=.02&&(t.temperatureDelta=d),{directives:e,params:t}}const Ca="Current affective state (execute accordingly):";function Js(o){if(!o)return"";const{directives:e}=Fa(o);return e.length===0?"":[Ca,...e.map(t=>`- ${t}`)].join(`
`)}const Pa=/\b(delete|drop|truncate|destroy|wipe|prod(uction)?|migrat|secret|credential|password|payment|billing|charge|refund|deploy|force[- ]?push|rm\s+-rf|irreversible|security|auth|breaking)\b/i,Ta=/\b(refactor|rewrite|architecture|complex|large|entire|whole|across|end[- ]to[- ]end|overhaul)\b/i;function Zs(o,e=dt()){const t=o||"";let n=e;return Pa.test(t)&&(n=or(n,{driveCaution:.3,arousal:.25,attention:.15,exploration:-.1})),Ta.test(t)&&(n=or(n,{driveCuriosity:.2,arousal:.1,exploration:.1})),n}const Na={inputDim:32,hiddenDim:16,stateDim:Kr,rewardWeight:.5},ar=1280131651,$a=296863214;function Ia(o){return 1/(1+Math.exp(-o))}class ei{config;win;ws;aLogit;woutState;boutState;woutReward;boutReward;gWin;gWs;gALogit;gWoutState;gBoutState;gWoutReward;gBoutReward;constructor(e={}){const t={...Na,...e};if(t.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${t.hiddenDim})`);this.config=t;const{inputDim:n,hiddenDim:r,stateDim:a}=t,s=new re((e.seed??$a)>>>0||1),d=c=>{const u=Math.max(s.next(),1e-12),l=s.next();return c*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*l)},i=(c,u)=>{const l=new Float32Array(c);for(let h=0;h<c;h++)l[h]=d(u);return l};this.win=i(r*n,.1),this.ws=i(r*a,.1),this.aLogit=i(r,.05),this.woutState=i(a*r,.05),this.boutState=new Float32Array(a),this.woutReward=i(r,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(e,t,n){const r=this._forwardCached(e,t,n);return{hidden:r.hn,delta:r.delta,reward:r.reward}}_forwardCached(e,t,n){const{inputDim:r,hiddenDim:a,stateDim:s}=this.config,d=Float32Array.from({length:r},(g,p)=>e[p]??0),i=Float32Array.from({length:a},(g,p)=>t[p]??0),c=Float32Array.from({length:s},(g,p)=>n[p]??0),u=new Float32Array(a),l=new Float32Array(a),h=new Float32Array(a);for(let g=0;g<a;g++){let p=0;const b=g*r;for(let _=0;_<r;_++)p+=this.win[b+_]*d[_];const y=g*s;for(let _=0;_<s;_++)p+=this.ws[y+_]*c[_];u[g]=Ia(this.aLogit[g]),l[g]=Math.tanh(p),h[g]=u[g]*i[g]+(1-u[g])*l[g]}const m=new Float32Array(s);for(let g=0;g<s;g++){let p=this.boutState[g];const b=g*a;for(let y=0;y<a;y++)p+=this.woutState[b+y]*h[y];m[g]=Math.tanh(p)}let f=this.boutReward[0];for(let g=0;g<a;g++)f+=this.woutReward[g]*h[g];return{x:d,sPrev:c,hPrev:i,a:u,t:l,hn:h,delta:m,reward:f}}backwardStep(e,t,n,r,a){const{inputDim:s,hiddenDim:d,stateDim:i,rewardWeight:c}=this.config,u=this._forwardCached(e,t,n);let l=0;const h=new Float32Array(i);for(let p=0;p<i;p++){const b=u.delta[p]-(r[p]??0);l+=.5*b*b,h[p]=b}const m=u.reward-a;l+=.5*c*m*m;const f=c*m,g=new Float32Array(d);for(let p=0;p<i;p++){const b=h[p]*(1-u.delta[p]*u.delta[p]);this.gBoutState[p]=this.gBoutState[p]+b;const y=p*d;for(let _=0;_<d;_++)this.gWoutState[y+_]=this.gWoutState[y+_]+b*u.hn[_],g[_]=g[_]+b*this.woutState[y+_]}this.gBoutReward[0]=this.gBoutReward[0]+f;for(let p=0;p<d;p++)this.gWoutReward[p]=this.gWoutReward[p]+f*u.hn[p],g[p]=g[p]+f*this.woutReward[p];for(let p=0;p<d;p++){const b=u.a[p],y=u.t[p];this.gALogit[p]=this.gALogit[p]+g[p]*(u.hPrev[p]-y)*b*(1-b);const _=g[p]*(1-b)*(1-y*y),w=p*s;for(let L=0;L<s;L++)this.gWin[w+L]=this.gWin[w+L]+_*u.x[L];const x=p*i;for(let L=0;L<i;L++)this.gWs[x+L]=this.gWs[x+L]+_*u.sPrev[L]}return{loss:l,hidden:u.hn}}exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.reduce((u,l)=>u+l.numel,0),a=5,s=a*4,d=t?r*2:r*4,i=new ArrayBuffer(s+d),c=new Uint32Array(i,0,a);if(c[0]=ar,c[1]=t?2:1,c[2]=this.config.inputDim,c[3]=this.config.hiddenDim,c[4]=this.config.stateDim,t){const u=new Float32Array(r);let l=0;for(const m of n)u.set(m.data,l),l+=m.numel;const h=Ee(u);new Uint16Array(i,s,r).set(h)}else{const u=new Float32Array(i,s,r);let l=0;for(const h of n)u.set(h.data,l),l+=h.numel}return i}loadWeights(e){const t=new Uint32Array(e,0,5);if(t[0]!==ar)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const n=t[1],r=t[2],a=t[3],s=t[4];if(r!==this.config.inputDim||a!==this.config.hiddenDim||s!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${r}/${a}/${s} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const d=this.parameters(),i=d.reduce((h,m)=>h+m.numel,0),c=20;let u;n===2?u=Be(new Uint16Array(e,c,i)):u=new Float32Array(e.slice(c,c+i*4));let l=0;for(const h of d)h.data.set(u.subarray(l,l+h.numel)),l+=h.numel}}function za(o,e,t,n,r,a,s,d){const i=new ArrayBuffer(32);return new Uint32Array(i,0,1).set([o]),new Float32Array(i,4,7).set([e,t,n,r,a,s,d]),i}class ti{model;device;_moments=null;_step=0;_adamwPipeline;constructor(e,t=null){this.model=e,this.device=t,this._adamwPipeline=t?R(t,Ma,"adamw_update"):null}get gpuTraining(){return this.device!=null&&this._adamwPipeline!=null}_initMoments(){this._moments||(this._moments=this.model.parameters().map(e=>({m:new Float32Array(e.numel),v:new Float32Array(e.numel)})))}async train(e,t={}){if(e.length===0)throw new Error("LimbicTrainer.train: no samples");const{learningRate:n=.05,epochs:r=50,weightDecay:a=0,beta1:s=.9,beta2:d=.999,eps:i=1e-8,maxGradNorm:c=1,onEpochEnd:u=null}=t;this._initMoments();const l=[];for(let h=0;h<r;h++){this.model.zeroGrad();let m=0;for(const x of e){const{loss:L}=this.model.backwardStep(x.input,this.model.initHidden(),x.state,x.deltaTarget,x.reward);m+=L}const f=this.model.gradients(),g=1/e.length;for(const x of f)for(let L=0;L<x.data.length;L++)x.data[L]*=g;const p=this._clipGradients(f,c);this._step++;const b=Math.pow(s,this._step),y=Math.pow(d,this._step),_={learningRate:n,weightDecay:a,beta1:s,beta2:d,eps:i,beta1_t:b,beta2_t:y};this.gpuTraining?await this._adamwStepGpu(f,_):this._adamwStepCpu(f,_);const w=m/e.length;l.push(w),u&&u(h+1,w,p)}return l}evaluate(e){if(e.length===0)return 0;let t=0;const{rewardWeight:n}=this.model.config;for(const r of e){const a=this.model.forward(r.input,this.model.initHidden(),r.state);let s=0;for(let i=0;i<a.delta.length;i++){const c=a.delta[i]-(r.deltaTarget[i]??0);s+=.5*c*c}const d=a.reward-r.reward;s+=.5*n*d*d,t+=s}return t/e.length}_clipGradients(e,t){let n=0;for(const a of e)for(let s=0;s<a.data.length;s++)n+=a.data[s]*a.data[s];const r=Math.sqrt(n);if(r>t&&r>0){const a=t/r;for(const s of e)for(let d=0;d<s.data.length;d++)s.data[d]*=a}return r}_adamwStepCpu(e,t){const n=this.model.parameters(),{learningRate:r,weightDecay:a,beta1:s,beta2:d,eps:i,beta1_t:c,beta2_t:u}=t;for(let l=0;l<n.length;l++){const h=n[l].data,m=e[l].data,f=this._moments[l];for(let g=0;g<h.length;g++){const p=m[g];f.m[g]=s*f.m[g]+(1-s)*p,f.v[g]=d*f.v[g]+(1-d)*p*p;const b=f.m[g]/(1-c),y=f.v[g]/(1-u);h[g]=h[g]*(1-r*a)-r*b/(Math.sqrt(y)+i)}}}async _adamwStepGpu(e,t){const n=this.device,r=this._adamwPipeline,a=this.model.parameters(),{learningRate:s,weightDecay:d,beta1:i,beta2:c,eps:u,beta1_t:l,beta2_t:h}=t;for(let m=0;m<a.length;m++){const f=a[m],g=this._moments[m],p=Q(n,f.data,!0),b=Q(n,e[m].data,!1),y=Q(n,g.m,!0),_=Q(n,g.v,!0),w=z(n,za(f.numel,s,i,c,u,d,l,h)),x=$(n,r,[w,p,b,y,_]);I(n,r,x,[F(f.numel,256),1,1]),f.data.set((await ie(n,p,f.numel*4)).subarray(0,f.numel)),g.m.set((await ie(n,y,f.numel*4)).subarray(0,f.numel)),g.v.set((await ie(n,_,f.numel*4)).subarray(0,f.numel)),p.destroy(),b.destroy(),y.destroy(),_.destroy(),w.destroy()}}}const ri=`

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
`;function Wa(){const o=new Uint8Array(8);return globalThis.crypto.getRandomValues(o),Array.from(o,e=>e.toString(16).padStart(2,"0")).join("")}const ja=new Set(["send","submit","pay","purchase","buy","order","checkout","delete","remove","confirm","transfer","publish","post","sign","approve","book","cancel","erase","wipe","format","uninstall","senden","absenden","bezahlen","kaufen","bestellen","löschen","entfernen","bestätigen","überweisen","veröffentlichen","enviar","pagar","comprar","pedido","eliminar","borrar","confirmar","transferir","publicar","envoyer","payer","acheter","commander","supprimer","confirmer","virement","publier"]),Ra=["发送","提交","支付","付款","购买","下单","删除","确认","转账","发布"];function sr(o){const e=o.toLowerCase();return Ra.some(t=>e.includes(t))?!0:e.split(/[^\p{L}\p{N}]+/u).some(t=>t.length>0&&ja.has(t))}function le(o){return o?o.name.trim()||o.automationId.trim():""}function Oa(o){switch(o.kind){case"click":return sr(le(o.target));case"keys":return o.keys.toLowerCase()==="enter"&&sr(le(o.target));case"setValue":return!1}}function ni(o,e={},t=Date.now()){const n=new Set(e.removed??[]),r=new Set(e.fixed??[]),a=[],s=[];for(const d of o.steps){if(n.has(d.id))continue;const i=d.action;let c;if(i.kind==="setValue")if(!i.secret&&r.has(d.id))c={kind:"setValue",target:i.target,value:{from:"literal",text:i.value}};else{const l=ir(e.paramNames?.[d.id]??"")||ir(le(i.target))||"value",h=Ua(a,l);a.push({name:h,label:le(i.target),default:i.secret?null:i.value,secret:!!i.secret}),c={kind:"setValue",target:i.target,value:{from:"param",name:h}}}else c=i;s.push({id:d.id,action:c,requiresApproval:e.approvals?.[d.id]??Oa(i),screenshot:d.screenshot??null})}return{id:Wa(),name:e.name?.trim()||o.name,program:o.program,args:[...o.args],params:a,steps:s,sourceEpisode:o.id,createdAt:t,routine:null}}function ir(o){return o.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join("_").slice(0,40).replace(/_+$/,"")}function Ua(o,e){if(!o.some(t=>t.name===e))return e;for(let t=2;;t++){const n=`${e}_${t}`;if(!o.some(r=>r.name===n))return n}}const tt=6e4,rt=864e5;function Ga(o,e,t,n){if(o.every==="minutes"){const i=Math.max(1,o.minutes)*tt;return e==null||t-e>=i}const r=n*tt,a=t+r,d=a-(a%rt+rt)%rt+Math.min(23,Math.max(0,o.hour))*36e5+Math.min(59,Math.max(0,o.minute))*tt;return a>=d&&(e==null||e+r<d)}function oi(o,e,t){return o.filter(n=>n.routine?.enabled&&Ga(n.routine.schedule,n.routine.lastRunAt,e,t)).sort((n,r)=>(n.routine?.lastRunAt??0)-(r.routine?.lastRunAt??0))}function fe(o){const e="target"in o&&o.target?o.target.windowTitle:"";return e?` in “${e}”`:""}function Vr(o){switch(o.kind){case"click":return`Click “${le(o.target)}”${fe(o)}.`;case"keys":return o.target?`Press ${o.keys} in “${le(o.target)}”${fe(o)}.`:`Press ${o.keys}.`;case"setValue":{const e=`“${le(o.target)}”`;return typeof o.value=="string"?"secret"in o&&o.secret?`Enter the secret for ${e}${fe(o)}.`:`Set ${e} to “${o.value}”${fe(o)}.`:o.value.from==="param"?`Set ${e} to <${o.value.name}>${fe(o)}.`:`Set ${e} to “${o.value.text}”${fe(o)}.`}}}function Xr(o){return o.split(/[\\/]/).pop()??o}function Ka(o){const e=[`Task: ${o.name} (${Xr(o.program)})`];return o.steps.forEach((t,n)=>e.push(`${n+1}. ${Vr(t.action)}${t.requiresApproval?" Ask before doing this.":""}`)),e.join(`
`)}function Ha(o){const e=[`Task: ${o.name} (${Xr(o.program)})`];return o.steps.forEach((t,n)=>e.push(`${n+1}. ${Vr(t.action)}`)),e.join(`
`)}function ai(o,e){return Yr(o,e).map(t=>t.text).join(`

`)}function Yr(o,e){const t=new Set(e.map(n=>n.sourceEpisode));return[...e.map(n=>({id:n.id,text:Ka(n)})),...o.filter(n=>!t.has(n.id)).map(n=>({id:n.id,text:Ha(n)}))]}function si(o,e){const t=[];let n=[],r=0;for(const a of o){const s=n.length?a.text.length+2:a.text.length;if(n.length&&r+s>e){t.push(n),n=[],r=0,n.push(a),r=a.text.length;continue}n.push(a),r+=s}return n.length&&t.push(n),t}const qa=864e5;function dr(o,e){return new Date(o+e*6e4).toISOString().slice(0,10)}function ii(o,e){const t=m=>{const f=o.learned[m];return typeof f=="number"&&f>=1&&f<=e.modelIndex},n=Yr(o.episodes,o.skills),r=n.filter(m=>t(m.id)).length,a={running:0,succeeded:0,failed:0,stopped:0,denied:0},s={approved:0,denied:0},d=[];for(const m of o.episodes)d.push({region:"hippocampus",kind:"demonstration",id:m.id,name:m.name,at:m.startedAt});for(const m of o.skills)d.push({region:"basalGanglia",kind:"skill",id:m.id,name:m.name,at:m.createdAt});for(const m of o.runs){a[m.status]=(a[m.status]??0)+1,d.push({region:"basalGanglia",kind:"run",id:m.id,name:m.skillName,at:m.startedAt,detail:m.status});for(const f of m.steps)f.outcome!=="approved"&&f.outcome!=="denied"||(s[f.outcome]++,d.push({region:"amygdala",kind:"approval",id:m.id,name:m.skillName,at:f.at,detail:f.outcome}))}const i=o.adaptations.filter(m=>m.index<=e.modelIndex).reverse();for(const m of i)d.push({region:"neocortex",kind:"adaptation",id:m.version,name:m.version,at:m.at,detail:m.loss.toFixed(3)});const c=Math.max(1,e.days??30),u=[],l=new Map;for(let m=c-1;m>=0;m--){const f=dr(e.now-m*qa,e.utcOffsetMinutes);if(l.has(f))continue;const g={day:f,demonstrations:0,skills:0,runs:0,learned:0};l.set(f,g),u.push(g)}const h=(m,f,g=1)=>{const p=l.get(dr(m,e.utcOffsetMinutes));p&&(p[f]+=g)};for(const m of o.episodes)h(m.startedAt,"demonstrations");for(const m of o.skills)h(m.createdAt,"skills");for(const m of o.runs)h(m.startedAt,"runs");for(const m of i)h(m.at,"learned",m.learned.length);return{regions:{hippocampus:o.episodes.length,basalGanglia:o.skills.length,amygdala:s.approved+s.denied,hypothalamus:o.skills.filter(m=>m.routine?.enabled).length,neocortex:r},learned:r,pending:n.length-r,runs:a,approvals:s,adaptations:i,days:u,recent:d.sort((m,f)=>f.at-m.at).slice(0,Math.max(0,e.recent??40))}}const lt="evermind.experience/1",Va=500,Xa=200;function ut(){return{schema:lt,episodes:[],skills:[],runs:[],learned:{},adaptations:[]}}function cr(o){const e=o;return!e||e.schema!==lt?ut():{schema:lt,episodes:Array.isArray(e.episodes)?e.episodes:[],skills:Array.isArray(e.skills)?e.skills:[],runs:Array.isArray(e.runs)?e.runs:[],learned:e.learned&&typeof e.learned=="object"&&!Array.isArray(e.learned)?e.learned:{},adaptations:Array.isArray(e.adaptations)?e.adaptations:[]}}function Ya(o){return{id:o.id,name:o.name,program:o.program,startedAt:o.startedAt,steps:o.steps.length}}class me{onChange;data;constructor(e,t){this.onChange=t,this.data=e?cr(e):ut()}load(e){this.data=cr(e)}async changed(){await this.onChange?.(this.data)}static upsert(e,t){const n=e.findIndex(r=>r.id===t.id);n>=0?e[n]=t:e.push(t)}static remove(e,t){const n=e.findIndex(r=>r.id===t);return n<0?!1:(e.splice(n,1),!0)}async putEpisode(e){me.upsert(this.data.episodes,e),await this.changed()}async getEpisode(e){return this.data.episodes.find(t=>t.id===e)}async listEpisodes(){return[...this.data.episodes].sort((e,t)=>t.startedAt-e.startedAt).map(Ya)}async deleteEpisode(e){const t=me.remove(this.data.episodes,e);return delete this.data.learned[e],t&&await this.changed(),t}async putSkill(e){me.upsert(this.data.skills,e),await this.changed()}async getSkill(e){return this.data.skills.find(t=>t.id===e)}async listSkills(){return[...this.data.skills].sort((e,t)=>t.createdAt-e.createdAt)}async deleteSkill(e){const t=me.remove(this.data.skills,e);return delete this.data.learned[e],t&&await this.changed(),t}async putRun(e){me.upsert(this.data.runs,e),this.data.runs.sort((t,n)=>n.startedAt-t.startedAt),this.data.runs.length=Math.min(this.data.runs.length,Va),await this.changed()}async appendRunStep(e,t){const n=this.data.runs.find(r=>r.id===e);return n?(n.steps.push(t),await this.changed(),!0):!1}async getRun(e){return this.data.runs.find(t=>t.id===e)}async listRuns(e){return this.data.runs.slice(0,Math.max(0,e))}async recordAdaptation(e){for(const t of e.learned)this.data.learned[t]=e.index;this.data.adaptations.unshift(e),this.data.adaptations.length=Math.min(this.data.adaptations.length,Xa),await this.changed()}async snapshot(){return structuredClone(this.data)}async clear(){this.data=ut(),await this.changed()}}export{ns as ACTIVATIONS_BACKWARD_WGSL,ge as ACTIVATIONS_WGSL,ss as ATTENTION_BACKWARD_WGSL,Bt as ATTENTION_FORWARD_WGSL,Cr as A_LOG_CLAMP_HI,Fr as A_LOG_CLAMP_LO,pt as AdamW,gn as AttentionBlock,De as BPETokenizer,en as BufferPool,Re as COL_SLICE_ENTRY,je as COL_SLICE_WGSL,as as COMPLEX_SSD_BACKWARD_WGSL,ln as COMPLEX_SSD_FORWARD_WGSL,Za as CONV1D_BACKWARD_WGSL,ht as CONV1D_FORWARD_WGSL,Vt as CPU_GRADIENT_LAYER_TYPES,hr as CRC_TRAILER_MAGIC,Na as DEFAULT_LIMBIC_CONFIG,$a as DEFAULT_LIMBIC_SEED,ye as DEFAULT_LM_CONFIG,Pn as DEFAULT_LM_SEED,vo as DEFAULT_LORA_TARGETS,Mn as DEFAULT_MOE_CONFIG,Ln as DEFAULT_MOE_SEED,Dn as DynamicLossScaler,eo as EVERMIND_ADAPT_MAX_CHARS,lt as EXPERIENCE_SCHEMA,Is as EXPORT_FORMATS,Ke as EvermindLM,Sr as EvermindLMLoRA,bt as EvermindLMTrainer,Z as EvermindModelPackage,Fs as EvermindTextEmbedder,st as FOREIGN_MAMBA_ADAPTERS,Gs as GRAD_CLIP_WGSL,xn as HybridMambaModel,Ts as ImageRVQCodec,me as InMemoryExperienceStore,ri as LIMBIC_AFFECT_WGSL,Ca as LIMBIC_BLOCK_HEADER,La as LIMBIC_BOUNDS,Gr as LIMBIC_DIM,ae as LIMBIC_DIM_NAMES,Kr as LIMBIC_STATE_DIM,es as LINEAR_BACKWARD_WGSL,Se as LINEAR_FORWARD_WGSL,Gn as LN2,ei as LimbicModel,ti as LimbicTrainer,Le as LoRAAdapter,En as LoadBalanceAccumulator,yt as MAMBA1_PARAM_NAMES,Xa as MAX_ADAPTATIONS,Gt as MAX_DELTA_B64_CHARS,Va as MAX_RUNS,an as Mamba1Block,cn as Mamba2Block,hn as Mamba3Block,an as MambaBlock,ls as MambaModel,Ps as MambaTrainer,us as MoETrainer,In as MultimodalVocab,kt as NEUTRAL_STATE,ve as PACKAGE_HEADER_BYTES,Ks as REGION,Fe as RMSNORM_EPS,Ja as SELECTIVE_SCAN_BACKWARD_WGSL,St as SELECTIVE_SCAN_FORWARD_WGSL,rs as SOFTMAX_BACKWARD_WGSL,ts as SOFTMAX_FORWARD_WGSL,fn as SOFTMAX_WGSL,os as SSD_BACKWARD_WGSL,sn as SSD_FORWARD_WGSL,re as SeededRng,fr as SharedExpertMoE,hs as Tensor,Ye as VIDEO_BANK_INTER,Te as VIDEO_BANK_INTRA,He as VideoRVQCodec,Ma as WEIGHT_UPDATE_WGSL,xo as WSLA_MAX_DELTA,Xe as adamwUpdateInPlace,ro as adaptAndDiff,As as adaptPackage,Qn as adaptationsAfterSkip,Ue as appendCrcTrailer,wr as applyCheckpointDiff,or as applyLimbicDelta,Rs as applyPortedWeights,br as applyRowDelta,Xs as appraiseAmygdala,Zs as appraiseTask,Ce as archOf,gs as backward,ct as basalGangliaExploreBias,Qs as basalGangliaSelect,oo as base64ToBytes,Hn as benchArgmax,xs as benchmarkAdaptationCost,ze as benchmarkModel,bs as benchmarkModelAsync,ys as benchmarkText,Vn as bitsPerToken,Mo as buildBatches,Ao as buildChunks,Ls as buildDeltaLearnPayload,Js as buildLimbicBlock,Ns as buildVideoSequence,no as bytesToBase64,F as cdiv,qe as clampDim,it as clampLimbicDim,Hs as clampState,Bn as clearTape,wa as codestralMambaAdapter,ws as compareModels,Xn as compareReports,Fa as compileLimbicState,_r as computeRowDelta,ea as configJson,Ar as corpusToSequences,ko as cpuDimsFor,wo as cpuModelBackward,bo as cpuModelForward,Cs as cpuModelLoss,_o as cpuWeightsFromNamed,mt as crc32,$ as createBindGroup,R as createComputePipeline,E as createEmptyStorageBuffer,Q as createStorageBuffer,z as createUniformBuffer,mr as crossEntropyGrad,we as crossEntropyLoss,Ss as decodeDeltaPayload,Es as deltaUnusableReason,Be as dequantizeFp16,bn as dequantizeInt8,ds as dequantizeInt8PerChannel,Ge as deserializeRowDelta,Cn as diffCheckpoints,Y as dispatchColumnSlice,I as dispatchKernel,oi as dueSkills,le as elementLabel,ut as emptySnapshot,fs as enableGrad,cs as estimateMemory,Nr as evermindTensorSpec,la as executePortPlan,ai as experienceCorpus,Yr as experienceDocuments,ii as experienceOverview,zs as exportEvermind,er as exportGguf,Jt as exportOnnx,Xt as exportSafetensors,ma as falconMambaAdapter,Oe as floatToFp16,ka as foreignMambaAdapterFor,ks as formatAdaptationCostReport,ft as fp16ToFloat,_s as fp16View,be as gaussianArray,$s as generateImage,Lo as generateVideo,ta as generationConfigJson,Ys as homeostasis,Ws as importEvermind,ia as importEvermindTensors,sa as inferArchFromTensors,Qa as initWebGPU,Ga as isDue,sr as isIrreversibleLabel,qr as limbicSetpoints,Ne as linearBackward,ke as linearForward,It as logProbOfToken,Ur as mamba1Adapter,fo as mamba1CpuBackward,Pr as mamba1CpuForward,pa as mambaAdapter,Os as mambaConfigFromTensors,Ds as meanEvalLoss,Vs as meanLimbicSetpoints,Bs as mergeCheckpointDiffs,na as modelCardMarkdown,vt as namedTensors,go as namedWeights,Oa as needsApproval,dt as neutralLimbicState,Sa as neutralState,Wa as newExperienceId,ms as noGrad,jr as normaliseSourceName,si as packDocuments,$r as paramCount,yo as paramMatrixShape,Ms as parseDeltaLearnPayload,cr as parseSnapshot,qn as perplexity,qs as personalitySetpoint,Aa as portForeignMamba,js as portForeignMambaSafetensors,lo as quantizeBase,Ee as quantizeFp16,_n as quantizeInt8,is as quantizeInt8PerChannel,rn as randn,ie as readBuffer,ps as recordOperation,Ea as recordToState,Us as resizePortedVocab,Dr as rmsNormBackward,Br as rmsNormForward,pr as roundFp16,Wr as safetensorsToTensors,_t as serializeRowDelta,Et as setInitSeed,Er as sigmoid,Ht as silu,qt as siluGrad,ir as slug,uo as softplus,Hr as stateToRecord,Eo as tensorsToSafetensors,Da as thalamusGate,po as toNamedGrads,Mr as tokenWindows,ra as tokenizerJson,Kn as topKIndices,vs as trainAndBenchmark,ni as trainOnce,pe as uploadBuffer,de as verifyCrcTrailer,mo as zeroCpuModelGrads,ho as zeroMamba1Grads};
