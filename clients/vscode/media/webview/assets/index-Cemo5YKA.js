const xe=globalThis,so=xe.GPUBufferUsage?.UNIFORM??64,Rn=xe.GPUBufferUsage?.STORAGE??128,On=xe.GPUBufferUsage?.COPY_SRC??4,Qe=xe.GPUBufferUsage?.COPY_DST??8,ao=xe.GPUBufferUsage?.MAP_READ??1;class io{device;_free=new Map;constructor(e){this.device=e}_key(e,t){return`${e}:${t}`}acquire(e,t){return this._free.get(this._key(e,t))?.pop()??this.device.createBuffer({size:e,usage:t})}release(e,t,o){const n=this._key(t,o);let s=this._free.get(n);s||(s=[],this._free.set(n,s)),s.push(e)}get freeCount(){let e=0;for(const t of this._free.values())e+=t.length;return e}clear(){for(const e of this._free.values())for(const t of e)t.destroy();this._free.clear()}}const qt=new WeakMap;function co(r){let e=qt.get(r);return e||(e=new io(r),qt.set(r,e)),e}async function yc(r={}){if(typeof navigator>"u"||!navigator.gpu)throw new Error("WebGPU is not available in this environment. Use Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled.");const e=await navigator.gpu.requestAdapter({powerPreference:r.powerPreference??"high-performance"});if(!e)throw new Error("Failed to acquire a GPUAdapter. Your GPU may not support WebGPU.");const t=e.limits,o=3*1024*1024*1024,n=await e.requestDevice({requiredLimits:{maxBufferSize:Math.min(o,t.maxBufferSize),maxStorageBufferBindingSize:Math.min(o,t.maxStorageBufferBindingSize),maxComputeInvocationsPerWorkgroup:Math.min(256,t.maxComputeInvocationsPerWorkgroup)}});return n.lost.then(s=>{console.error("WebGPU device lost:",s.message)}),{device:n,adapter:e}}function Q(r,e,t=!1){const o=e instanceof Float32Array||e instanceof Uint32Array?e:new Float32Array(e),n=Rn|Qe|(t?On:0),s=r.createBuffer({size:o.byteLength,usage:n,mappedAtCreation:!0});return o instanceof Uint32Array?new Uint32Array(s.getMappedRange()).set(o):new Float32Array(s.getMappedRange()).set(o),s.unmap(),s}function F(r,e,t=!1){const o=Rn|Qe|(t?On:0);return r.createBuffer({size:e,usage:o})}function j(r,e){const t=ArrayBuffer.isView(e)?e.buffer:e,o=r.createBuffer({size:t.byteLength,usage:so|Qe,mappedAtCreation:!0});return new Uint8Array(o.getMappedRange()).set(new Uint8Array(t)),o.unmap(),o}async function de(r,e,t){const o=xe.GPUMapMode?.READ??1,n=ao|Qe,s=co(r),a=s.acquire(t,n),i=r.createCommandEncoder();i.copyBufferToBuffer(e,0,a,0,t),r.queue.submit([i.finish()]),await a.mapAsync(o);const c=new Float32Array(a.getMappedRange().slice(0));return a.unmap(),s.release(a,t,n),c}function we(r,e,t,o=0){r.queue.writeBuffer(e,o,t.buffer,t.byteOffset,t.byteLength)}function U(r,e,t){const o=r.createShaderModule({code:e});return r.createComputePipeline({layout:"auto",compute:{module:o,entryPoint:t}})}function $(r,e,t,o=0){const n=t.map((s,a)=>({binding:a,resource:{buffer:s}}));return r.createBindGroup({layout:e.getBindGroupLayout(o),entries:n})}function I(r,e,t,o){const n=r.createCommandEncoder(),s=n.beginComputePass();s.setPipeline(e),s.setBindGroup(0,t),s.dispatchWorkgroups(...o),s.end(),r.queue.submit([n.finish()])}function T(r,e){return Math.ceil(r/e)}const Vt=`

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
`,vc=`

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
`;class te{_s;constructor(e){this._s=e>>>0||1}next(){return this._s=Math.imul(1664525,this._s)+1013904223>>>0,this._s/4294967296}}let pt=Math.random;function Xt(r){if(r==null)pt=Math.random;else{const e=new te(r);pt=()=>e.next()}}function lo(r=1,e=pt){const t=Math.max(e(),1e-12),o=e();return r*Math.sqrt(-2*Math.log(t))*Math.cos(2*Math.PI*o)}function me(r,e,t){const o=new Float32Array(r);for(let n=0;n<r;n++)o[n]=lo(e,t);return o}const St=`

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
`,xc=`

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
`,Ne=`

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
`,kc=`

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
`,ye=`

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
`,Ac=`
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
`,Mc=`
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
`,Ec=`

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
`,Je=`
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
`,Ze="col_slice";function Y(r,e,t,o,n,s,a,i){const c=j(r,new Uint32Array([n,s,a,i]).buffer),d=$(r,e,[c,t,o]);I(r,e,d,[T(n*i,256),1,1]),c.destroy()}const ho=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,uo=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class fo{layerType="mamba1";device;config;dInner;dtRank;wInProj;bInProj;wConv;bConv;wXProj;bXProj;wDtProj;bDtProj;A_log;D_vec;wOutProj;bOutProj;normWeight;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(t.dModel/16),...t};const{dModel:o,expand:n}=this.config;this.dInner=n*o,this.dtRank=t.dtRank??Math.ceil(o/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:o}=this.config,n=this.dInner,s=t,a=o,i=this.dtRank,c=(l,u=.02)=>me(l,u),d=l=>new Float32Array(l),h=l=>new Float32Array(l).fill(1);this.wInProj=c(2*n*e),this.bInProj=d(2*n),this.wConv=c(n*a,.01),this.bConv=d(n),this.wXProj=c((i+2*s)*n,.01),this.bXProj=d(i+2*s),this.wDtProj=c(n*i,.02),this.bDtProj=d(n),this.A_log=new Float32Array(n*s);for(let l=0;l<n;l++)for(let u=0;u<s;u++)this.A_log[l*s+u]=Math.log(u+1);this.D_vec=h(n),this.wOutProj=c(e*n,.02),this.bOutProj=d(e),this.normWeight=h(e),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const e=this.device,t=o=>Q(e,o,!0);this.gpuWeights={wInProj:t(this.wInProj),bInProj:t(this.bInProj),wConv:t(this.wConv),bConv:t(this.bConv),wXProj:t(this.wXProj),bXProj:t(this.bXProj),wDtProj:t(this.wDtProj),bDtProj:t(this.bDtProj),A_log:t(this.A_log),D_vec:t(this.D_vec),wOutProj:t(this.wOutProj),bOutProj:t(this.bOutProj),normWeight:t(this.normWeight)}}_buildPipelines(){const e=this.device;this.pipelines={linear:U(e,Ne,"linear_forward"),conv1d:U(e,St,"conv1d_forward"),silu:U(e,ye,"silu_forward"),rmsnorm:U(e,ye,"rmsnorm_forward"),scan_fwd:U(e,Vt,"forward_scan"),scan_reduce:U(e,Vt,"forward_reduce"),colSlice:U(e,Je,Ze),elMul:U(e,ho,"main"),elAdd:U(e,uo,"main")}}forward(e,t,o){const n=this.device,{dModel:s,dState:a,dConv:i}=this.config,c=this.dInner,d=a,h=t,l=o,u=h*l,m=this.dtRank,f={},g=F(n,u*s*4,!0),p=F(n,u*4,!0);f.normInv=p,f.normIn=e;{const v=new ArrayBuffer(16);new Uint32Array(v,0,2).set([u,s]),new Float32Array(v,8,1).set([1e-6]);const A=j(n,v),S=$(n,this.pipelines.rmsnorm,[A,e,this.gpuWeights.normWeight,g,p]);I(n,this.pipelines.rmsnorm,S,[T(u,64),1,1])}const _=F(n,u*2*c*4,!0);f.normOut=g;{const v=new Uint32Array([u,s,2*c]).buffer,A=j(n,v),S=$(n,this.pipelines.linear,[A,g,this.gpuWeights.wInProj,this.gpuWeights.bInProj,_]);I(n,this.pipelines.linear,S,[T(u,16),T(2*c,16),1])}const b=F(n,u*c*4,!0),w=F(n,u*c*4,!0);{const v=this.pipelines.colSlice;Y(n,v,_,b,u,2*c,0,c),Y(n,v,_,w,u,2*c,c,c)}_.destroy(),f.zBuf=w,f.xConvIn=b;const y=F(n,u*c*4,!0);f.convOut=y;{const v=new Uint32Array([l,c,i,h,1]).buffer,A=j(n,v),S=$(n,this.pipelines.conv1d,[A,b,this.gpuWeights.wConv,this.gpuWeights.bConv,y]);I(n,this.pipelines.conv1d,S,[T(l,16),T(c,16),h])}const x=F(n,u*c*4,!0);f.siluOut=x;{const v=new Uint32Array([u*c]).buffer,A=j(n,v),S=$(n,this.pipelines.silu,[A,y,x]);I(n,this.pipelines.silu,S,[T(u*c,256),1,1])}const E=F(n,u*(m+2*d)*4,!0);{const v=new Uint32Array([u,c,m+2*d]).buffer,A=j(n,v),S=$(n,this.pipelines.linear,[A,x,this.gpuWeights.wXProj,this.gpuWeights.bXProj,E]);I(n,this.pipelines.linear,S,[T(u,16),T(m+2*d,16),1])}const L=F(n,u*m*4,!0),k=F(n,h*l*d*4,!0),D=F(n,h*l*d*4,!0);{const v=m+2*d,A=this.pipelines.colSlice;Y(n,A,E,L,u,v,0,m),Y(n,A,E,k,u,v,m,d),Y(n,A,E,D,u,v,m+d,d)}E.destroy(),f.B_raw=k,f.C_raw=D;const B=F(n,u*c*4,!0);f.deltaFull=B;{const v=new Uint32Array([u,m,c]).buffer,A=j(n,v),S=$(n,this.pipelines.linear,[A,L,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,B]);I(n,this.pipelines.linear,S,[T(u,16),T(c,16),1])}L.destroy();const O=F(n,h*l*c*4,!0),W=F(n,2*h*l*c*d*4,!0);f.hCache=W;{const v=new Uint32Array([l,d,c,h]).buffer,A=j(n,v),S=$(n,this.pipelines.scan_fwd,[A,x,B,this.gpuWeights.A_log,k,D,this.gpuWeights.D_vec,O,W]);I(n,this.pipelines.scan_fwd,S,[c,d,h]);const R=$(n,this.pipelines.scan_reduce,[A,x,B,this.gpuWeights.A_log,k,D,this.gpuWeights.D_vec,O,W]);I(n,this.pipelines.scan_reduce,R,[T(l,64),c,h])}const G=F(n,u*c*4,!0),z=F(n,u*c*4,!0);{const v=j(n,new Uint32Array([u*c]).buffer),A=$(n,this.pipelines.silu,[v,w,G]);I(n,this.pipelines.silu,A,[T(u*c,256),1,1]);const S=j(n,new Uint32Array([u*c]).buffer),R=$(n,this.pipelines.elMul,[O,G,z,S]);I(n,this.pipelines.elMul,R,[T(u*c,256),1,1])}G.destroy(),O.destroy();const H=F(n,u*s*4,!0);{const v=new Uint32Array([u,c,s]).buffer,A=j(n,v),S=$(n,this.pipelines.linear,[A,z,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,H]);I(n,this.pipelines.linear,S,[T(u,16),T(s,16),1])}z.destroy();const M=F(n,u*s*4,!0);{const v=j(n,new Uint32Array([u*s]).buffer),A=$(n,this.pipelines.elAdd,[H,e,M,v]);I(n,this.pipelines.elAdd,A,[T(u*s,256),1,1])}return H.destroy(),{output:M,cache:f}}parameters(){const{dModel:e,dState:t,dConv:o}=this.config,n=this.dInner,s=t,a=o,i=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*n*e,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*n,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:n*a,name:"wConv"},{buf:this.gpuWeights.bConv,numel:n,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(i+2*s)*n,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:i+2*s,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:n*i,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:n,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:n*s,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:n,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*n,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:e,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const mo=`
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
`,Lc=`
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
`,go=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class po{layerType="mamba2";device;config;dInner;dHead;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...t};const{dModel:o,expand:n,nHeads:s}=this.config;if(this.dInner=n*o,this.dHead=this.dInner/s,this.dInner%s!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${s}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:o,nHeads:n,nGroups:s}=this.config,a=this.dInner,i=t,c=o,d=n,h=s,l=(p,_=.02)=>me(p,_),u=p=>new Float32Array(p),m=p=>new Float32Array(p).fill(1),f=a+2*h*i+d,g=p=>Q(this.device,p,!0);this.gpuWeights={wInProj:g(l(f*e)),wConv:g(l((a+2*h*i)*c,.01)),bConv:g(u(a+2*h*i)),A_log:g(new Float32Array(d).fill(Math.log(1))),dt_bias:g(u(d)),D_vec:g(m(d)),wOutProj:g(l(e*a,.02)),normWeight:g(m(a)),preNormWeight:g(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:U(e,Ne,"linear_forward"),conv1d:U(e,St,"conv1d_forward"),colSlice:U(e,Je,Ze),rmsnorm:U(e,ye,"rmsnorm_forward"),ssd_fwd:U(e,mo,"ssd_chunk_forward"),elAdd:U(e,go,"main")}}forward(e,t,o){const n=this.device,{dModel:s,dState:a,dConv:i,nHeads:c,nGroups:d,chunkLen:h}=this.config,l=this.dInner,u=a,m=i,f=c,g=d,p=this.dHead,_=t,b=o,w=_*b,y=l+2*g*u,x=Math.ceil(b/h),E=F(n,w*s*4,!0),L=F(n,w*4,!0);{const N=new ArrayBuffer(16);new Uint32Array(N,0,2).set([w,s]),new Float32Array(N,8,1).set([1e-6]);const C=j(n,N),K=$(n,this.pipelines.rmsnorm,[C,e,this.gpuWeights.preNormWeight,E,L]);I(n,this.pipelines.rmsnorm,K,[T(w,64),1,1])}L.destroy();const k=l+2*g*u+f,D=F(n,w*k*4,!0);{const N=new Uint32Array([w,s,k]).buffer,C=j(n,N),K=Q(n,new Float32Array(k),!0),Z=$(n,this.pipelines.linear,[C,E,this.gpuWeights.wInProj,K,D]);I(n,this.pipelines.linear,Z,[T(w,16),T(k,16),1]),K.destroy()}E.destroy();const B=F(n,w*y*4,!0),O=F(n,w*f*4,!0);{const N=this.pipelines.colSlice,C=y+f;Y(n,N,D,B,w,C,0,y),Y(n,N,D,O,w,C,y,f)}D.destroy();const W=F(n,w*y*4,!0);{const N=new Uint32Array([b,y,m,_,1]).buffer,C=j(n,N),K=$(n,this.pipelines.conv1d,[C,B,this.gpuWeights.wConv,this.gpuWeights.bConv,W]);I(n,this.pipelines.conv1d,K,[T(b,16),T(y,16),_])}B.destroy();const G=F(n,w*l*4,!0),z=F(n,w*g*u*4,!0),H=F(n,w*g*u*4,!0);{const N=this.pipelines.colSlice;Y(n,N,W,G,w,y,0,l),Y(n,N,W,z,w,y,l,g*u),Y(n,N,W,H,w,y,l+g*u,g*u)}W.destroy();const M=F(n,(x+1)*_*f*u*p*4,!0),v=F(n,w*l*4,!0);{const N=new Uint32Array([b,l,f,p,g,u,h,x,_]).buffer,C=j(n,N),K=$(n,this.pipelines.ssd_fwd,[C,G,z,H,O,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,v,M]);I(n,this.pipelines.ssd_fwd,K,[x,f,_])}G.destroy(),z.destroy(),H.destroy(),O.destroy();const A=F(n,w*l*4,!0),S=F(n,w*4,!0);{const N=new ArrayBuffer(16);new Uint32Array(N,0,2).set([w,l]),new Float32Array(N,8,1).set([1e-6]);const C=j(n,N),K=$(n,this.pipelines.rmsnorm,[C,v,this.gpuWeights.normWeight,A,S]);I(n,this.pipelines.rmsnorm,K,[T(w,64),1,1])}v.destroy(),S.destroy();const R=F(n,w*s*4,!0);{const N=new Uint32Array([w,l,s]).buffer,C=j(n,N),K=Q(n,new Float32Array(s),!0),Z=$(n,this.pipelines.linear,[C,A,this.gpuWeights.wOutProj,K,R]);I(n,this.pipelines.linear,Z,[T(w,16),T(s,16),1]),K.destroy()}A.destroy();const q=F(n,w*s*4,!0);{const N=j(n,new Uint32Array([w*s]).buffer),C=$(n,this.pipelines.elAdd,[R,e,q,N]);I(n,this.pipelines.elAdd,C,[T(w*s,256),1,1])}return R.destroy(),{output:q,cache:{stateCarry:M}}}parameters(){const{dModel:e,dState:t,dConv:o,nHeads:n,nGroups:s}=this.config,a=this.dInner,i=t,c=o,d=n,h=s,l=a+2*h*i;return[{buf:this.gpuWeights.wInProj,numel:(a+2*h*i+d)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:l*c,name:"wConv"},{buf:this.gpuWeights.bConv,numel:l,name:"bConv"},{buf:this.gpuWeights.A_log,numel:d,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:d,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:d,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*a,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:a,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const _o=`
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
`,Sc=`
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
`,bo=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class wo{layerType="mamba3";device;config;dInner;dHead;nComplex;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...t};const{dModel:o,expand:n,nHeads:s}=this.config;if(this.dInner=n*o,this.dHead=this.dInner/s,this.nComplex=this.config.dState,this.dInner%s!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${s}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dConv:t,nHeads:o,nGroups:n}=this.config,s=this.dInner,a=this.nComplex,i=t,c=o,d=n,h=s+2*d*a*2,l=(_,b=.02)=>me(_,b),u=_=>new Float32Array(_),m=_=>new Float32Array(_).fill(1),f=new Float32Array(c*2);for(let _=0;_<c;_++)f[_*2+0]=0,f[_*2+1]=2*Math.PI*_/c;const g=_=>Q(this.device,_,!0),p=s+2*d*a*2+c;this.gpuWeights={wInProj:g(l(p*e)),wConv:g(l(h*i,.01)),bConv:g(u(h)),A_log:g(f),dt_bias:g(u(c)),D_vec:g(m(c)),wOutProj:g(l(e*s,.02)),normWeight:g(m(s)),preNormWeight:g(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:U(e,Ne,"linear_forward"),conv1d:U(e,St,"conv1d_forward"),colSlice:U(e,Je,Ze),rmsnorm:U(e,ye,"rmsnorm_forward"),cssd_fwd:U(e,_o,"complex_ssd_forward"),elAdd:U(e,bo,"main")}}forward(e,t,o){const n=this.device,{dModel:s,dConv:a,nHeads:i,nGroups:c,chunkLen:d}=this.config,h=this.dInner,l=this.nComplex,u=a,m=i,f=c,g=this.dHead,p=t,_=o,b=p*_,w=h+2*f*l*2,y=Math.ceil(_/d),x=F(n,b*s*4,!0),E=F(n,b*4,!0);{const P=new ArrayBuffer(16);new Uint32Array(P,0,2).set([b,s]),new Float32Array(P,8,1).set([1e-6]);const N=j(n,P),C=$(n,this.pipelines.rmsnorm,[N,e,this.gpuWeights.preNormWeight,x,E]);I(n,this.pipelines.rmsnorm,C,[T(b,64),1,1])}E.destroy();const L=h+2*f*l*2+m,k=F(n,b*L*4,!0);{const P=new Uint32Array([b,s,L]).buffer,N=j(n,P),C=Q(n,new Float32Array(L),!0),K=$(n,this.pipelines.linear,[N,x,this.gpuWeights.wInProj,C,k]);I(n,this.pipelines.linear,K,[T(b,16),T(L,16),1]),C.destroy()}x.destroy();const D=F(n,b*w*4,!0),B=F(n,b*m*4,!0);{const P=this.pipelines.colSlice,N=w+m;Y(n,P,k,D,b,N,0,w),Y(n,P,k,B,b,N,w,m)}k.destroy();const O=F(n,b*w*4,!0);{const P=new Uint32Array([_,w,u,p,1]).buffer,N=j(n,P),C=$(n,this.pipelines.conv1d,[N,D,this.gpuWeights.wConv,this.gpuWeights.bConv,O]);I(n,this.pipelines.conv1d,C,[T(_,16),T(w,16),p])}D.destroy();const W=F(n,b*h*4,!0),G=F(n,b*f*l*2*4,!0),z=F(n,b*f*l*2*4,!0);{const P=this.pipelines.colSlice;Y(n,P,O,W,b,w,0,h),Y(n,P,O,G,b,w,h,f*l*2),Y(n,P,O,z,b,w,h+f*l*2,f*l*2)}O.destroy();const H=F(n,(y+1)*p*m*l*2*g*4,!0),M=F(n,b*h*4,!0);{const P=new Uint32Array([_,h,m,g,f,l,d,y,p]).buffer,N=j(n,P),C=$(n,this.pipelines.cssd_fwd,[N,W,G,z,B,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,M,H]);I(n,this.pipelines.cssd_fwd,C,[y,m,p])}W.destroy(),G.destroy(),z.destroy(),B.destroy();const v=F(n,b*h*4,!0),A=F(n,b*4,!0);{const P=new ArrayBuffer(16);new Uint32Array(P,0,2).set([b,h]),new Float32Array(P,8,1).set([1e-6]);const N=j(n,P),C=$(n,this.pipelines.rmsnorm,[N,M,this.gpuWeights.normWeight,v,A]);I(n,this.pipelines.rmsnorm,C,[T(b,64),1,1])}M.destroy(),A.destroy();const S=F(n,b*s*4,!0);{const P=new Uint32Array([b,h,s]).buffer,N=j(n,P),C=Q(n,new Float32Array(s),!0),K=$(n,this.pipelines.linear,[N,v,this.gpuWeights.wOutProj,C,S]);I(n,this.pipelines.linear,K,[T(b,16),T(s,16),1]),C.destroy()}v.destroy();const R=F(n,b*s*4,!0);{const P=j(n,new Uint32Array([b*s]).buffer),N=$(n,this.pipelines.elAdd,[S,e,R,P]);I(n,this.pipelines.elAdd,N,[T(b*s,256),1,1])}return S.destroy(),{output:R,cache:{stateCarry:H}}}parameters(){const{dModel:e,dConv:t,nHeads:o,nGroups:n}=this.config,s=this.dInner,a=this.nComplex,i=t,c=o,d=n,h=s+2*d*a*2;return[{buf:this.gpuWeights.wInProj,numel:(s+2*d*a*2+c)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:h*i,name:"wConv"},{buf:this.gpuWeights.bConv,numel:h,name:"bConv"},{buf:this.gpuWeights.A_log,numel:c*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:c,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:c,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*s,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:s,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const yo=`
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
`,Yt=`
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
`,Fc=`
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
`,vo=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,xo=`
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
`;class ko{layerType="attention";device;config;dHead;gpuWeights;pipelines;constructor(e,t){if(this.device=e,t.dModel%t.nHeads!==0)throw new Error(`AttentionBlock: dModel (${t.dModel}) must be divisible by nHeads (${t.nHeads}).`);this.config={dHead:t.dModel/t.nHeads,hasFfn:!1,ffnMult:4,...t},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,hasFfn:t,ffnMult:o}=this.config,n=(c,d=.02)=>me(c,d),s=c=>new Float32Array(c),a=c=>new Float32Array(c).fill(1),i=c=>Q(this.device,c,!0);if(this.gpuWeights={wQKV:i(n(3*e*e)),bQKV:i(s(3*e)),wO:i(n(e*e)),bO:i(s(e)),normWeight:i(a(e))},t){const c=e*o;this.gpuWeights.wFfn1=i(n(c*e)),this.gpuWeights.bFfn1=i(s(c)),this.gpuWeights.wFfn2=i(n(e*c)),this.gpuWeights.bFfn2=i(s(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:U(e,Ne,"linear_forward"),rmsnorm:U(e,ye,"rmsnorm_forward"),attn_fwd:U(e,Yt,"attention_forward"),attn_val:U(e,Yt,"attention_value"),softmax:U(e,yo,"softmax_forward"),colSlice:U(e,Je,Ze),elAdd:U(e,vo,"main")},this.config.hasFfn&&(this.pipelines.silu=U(e,xo,"silu_forward"))}forward(e,t,o){const n=this.device,{dModel:s,nHeads:a,hasFfn:i}=this.config,c=this.dHead,d=t,h=o,l=d*h,u=a,m=F(n,l*s*4,!0),f=F(n,l*4,!0);{const k=new ArrayBuffer(16);new Uint32Array(k,0,2).set([l,s]),new Float32Array(k,8,1).set([1e-6]);const D=j(n,k),B=$(n,this.pipelines.rmsnorm,[D,e,this.gpuWeights.normWeight,m,f]);I(n,this.pipelines.rmsnorm,B,[T(l,64),1,1])}f.destroy();const g=F(n,l*3*s*4,!0);{const k=new Uint32Array([l,s,3*s]).buffer,D=j(n,k),B=$(n,this.pipelines.linear,[D,m,this.gpuWeights.wQKV,this.gpuWeights.bQKV,g]);I(n,this.pipelines.linear,B,[T(l,16),T(3*s,16),1])}m.destroy();const p=F(n,l*s*4,!0),_=F(n,l*s*4,!0),b=F(n,l*s*4,!0);{const k=this.pipelines.colSlice;Y(n,k,g,p,l,3*s,0,s),Y(n,k,g,_,l,3*s,s,s),Y(n,k,g,b,l,3*s,2*s,s)}g.destroy();const w=F(n,d*u*h*h*4,!0);{const k=new Uint32Array([d,h,s,u,c]).buffer,D=j(n,k),B=$(n,this.pipelines.attn_fwd,[D,p,_,b,w,F(n,l*s*4,!0)]);I(n,this.pipelines.attn_fwd,B,[T(h,16),u,d])}{const k=new Uint32Array([h,h,1]).buffer,D=j(n,k),B=$(n,this.pipelines.softmax,[D,w]);I(n,this.pipelines.softmax,B,[h,u,d])}const y=F(n,l*s*4,!0);{const k=new Uint32Array([d,h,s,u,c]).buffer,D=j(n,k),B=$(n,this.pipelines.attn_val,[D,p,_,b,w,y]);I(n,this.pipelines.attn_val,B,[T(h,16),u,d])}p.destroy(),_.destroy(),b.destroy();const x=F(n,l*s*4,!0);{const k=new Uint32Array([l,s,s]).buffer,D=j(n,k),B=$(n,this.pipelines.linear,[D,y,this.gpuWeights.wO,this.gpuWeights.bO,x]);I(n,this.pipelines.linear,B,[T(l,16),T(s,16),1])}y.destroy();let E=F(n,l*s*4,!0);{const k=j(n,new Uint32Array([l*s]).buffer),D=$(n,this.pipelines.elAdd,[x,e,E,k]);I(n,this.pipelines.elAdd,D,[T(l*s,256),1,1])}if(x.destroy(),i){const{ffnMult:k}=this.config,D=s*k,B=F(n,l*D*4,!0);{const z=new Uint32Array([l,s,D]).buffer,H=j(n,z),M=$(n,this.pipelines.linear,[H,E,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,B]);I(n,this.pipelines.linear,M,[T(l,16),T(D,16),1])}const O=F(n,l*D*4,!0);{const z=j(n,new Uint32Array([l*D]).buffer),H=$(n,this.pipelines.silu,[z,B,O]);I(n,this.pipelines.silu,H,[T(l*D,256),1,1])}B.destroy();const W=F(n,l*s*4,!0);{const z=new Uint32Array([l,D,s]).buffer,H=j(n,z),M=$(n,this.pipelines.linear,[H,O,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,W]);I(n,this.pipelines.linear,M,[T(l,16),T(s,16),1])}O.destroy();const G=F(n,l*s*4,!0);{const z=j(n,new Uint32Array([l*s]).buffer),H=$(n,this.pipelines.elAdd,[W,E,G,z]);I(n,this.pipelines.elAdd,H,[T(l*s,256),1,1])}W.destroy(),E.destroy(),E=G}return{output:E,cache:{scores:w}}}parameters(){const{dModel:e,hasFfn:t,ffnMult:o}=this.config,n=[{buf:this.gpuWeights.wQKV,numel:3*e*e,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*e,name:"bQKV"},{buf:this.gpuWeights.wO,numel:e*e,name:"wO"},{buf:this.gpuWeights.bO,numel:e,name:"bO"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}];if(t){const s=e*o;n.push({buf:this.gpuWeights.wFfn1,numel:s*e,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:s,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:e*s,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:e,name:"bFfn2"})}return n}getTrainableParams(){return this.parameters()}setWSLAMode(e){}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}function et(r){const e=new ArrayBuffer(4),t=new Float32Array(e),o=new Uint32Array(e);t[0]=r;const n=o[0],s=n>>>31&1,a=n>>>23&255,i=n&8388607;if(a===255)return s<<15|31744|(i?512:0);const c=a-127+15;if(c>=31)return s<<15|31744;if(c<=0){if(c<-10)return s<<15;const d=14-c;return s<<15|(i|8388608)>>d}return s<<15|c<<10|i>>13}function Ft(r){const e=r>>>15&1,t=r>>>10&31,o=r&1023;if(t===0){const a=o/1024*Math.pow(2,-14);return e?-a:a}if(t===31)return e?-1/0:o?NaN:1/0;const n=t-15,s=(1+o/1024)*Math.pow(2,n);return e?-s:s}function Pe(r){const e=new Uint16Array(r.length);for(let t=0;t<r.length;t++)e[t]=et(r[t]);return e}function $e(r){const e=new Float32Array(r.length);for(let t=0;t<r.length;t++)e[t]=Ft(r[t]);return e}function Ao(r){let e=0;for(let n=0;n<r.length;n++){const s=Math.abs(r[n]);s>e&&(e=s)}const t=e/127||1,o=new Int8Array(r.length);for(let n=0;n<r.length;n++)o[n]=Math.max(-128,Math.min(127,Math.round(r[n]/t)));return{data:o,scale:t}}function Mo(r,e){const t=new Float32Array(r.length);for(let o=0;o<r.length;o++)t[o]=r[o]*e;return t}function Dc(r,e){const t=r.length/e,o=new Float32Array(e),n=new Int8Array(r.length);for(let s=0;s<e;s++){let a=0;const i=s*t;for(let c=0;c<t;c++){const d=Math.abs(r[i+c]);d>a&&(a=d)}o[s]=a/127||1;for(let c=0;c<t;c++)n[i+c]=Math.max(-128,Math.min(127,Math.round(r[i+c]/o[s])))}return{data:n,scales:o}}function Bc(r,e,t){const o=r.length/t,n=new Float32Array(r.length);for(let s=0;s<t;s++){const a=s*o;for(let i=0;i<o;i++)n[a+i]=r[a+i]*e[s]}return n}function Cc(r){return{fp32:r*4,fp16:r*2,int8:r*1}}const Un=1380144709,_t=8,Eo=(()=>{const r=new Uint32Array(256);for(let e=0;e<256;e++){let t=e;for(let o=0;o<8;o++)t=t&1?3988292384^t>>>1:t>>>1;r[e]=t>>>0}return r})();function Dt(r){let e=4294967295;for(let t=0;t<r.length;t++)e=Eo[(e^r[t])&255]^e>>>8;return(e^4294967295)>>>0}function Ie(r){const e=new Uint8Array(r),t=new ArrayBuffer(e.length+_t);new Uint8Array(t).set(e,0);const n=new DataView(t);return n.setUint32(e.length,Un,!0),n.setUint32(e.length+4,Dt(e),!0),t}function se(r){if(r.byteLength<_t)return{hasTrailer:!1,ok:!0,body:r};const e=new DataView(r),t=r.byteLength-_t;if(e.getUint32(t,!0)!==Un)return{hasTrailer:!1,ok:!0,body:r};const n=e.getUint32(t+4,!0),s=r.slice(0,t);return{hasTrailer:!0,ok:Dt(new Uint8Array(s))===n,body:s}}const Qt=1296190035,Lo={mamba1:0,mamba2:1,mamba3:2,attention:3},So=["mamba1","mamba2","mamba3","attention"];class Fo{device;config;gpuEmbedding;layers;layerSpecs;gpuFinalNorm;tiedEmbedding;gpuLMHeadBias;_lmHeadPipeline;_rmsnormPipeline;_embedPipeline;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...t},Xt(this.config.seed);const o=t.layers??Array.from({length:t.numLayers},()=>({type:"mamba1"}));if(o.length!==t.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${o.length}) must equal numLayers (${t.numLayers}).`);this.layerSpecs=o;const{vocabSize:n,dModel:s}=this.config,a=me(n*s,1/Math.sqrt(s));this.gpuEmbedding=Q(e,a,!0),this.layers=o.map(i=>this._buildLayer(i)),Xt(void 0),this.gpuFinalNorm=Q(e,new Float32Array(s).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=Q(e,new Float32Array(n),!0),this._lmHeadPipeline=U(e,Ne,"linear_forward"),this._rmsnormPipeline=U(e,ye,"rmsnorm_forward"),this._embedPipeline=U(e,Do,"embed_lookup")}_buildLayer(e){const t=this.config;switch(e.type){case"mamba1":{const o={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,...t.defaultMamba1};return new fo(this.device,{...o,...e.config??{}})}case"mamba2":{const o={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,...t.defaultMamba2};return new po(this.device,{...o,...e.config??{}})}case"mamba3":{const o={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,mimoGroup:t.mimoGroup,...t.defaultMamba3};return new wo(this.device,{...o,...e.config??{}})}case"attention":{const o={dModel:t.dModel,nHeads:t.nHeads,...t.defaultAttention};return new ko(this.device,{...o,...e.config??{}})}}}embedTokens(e,t,o){const{dModel:n}=this.config,s=t*o,a=Q(this.device,e instanceof Uint32Array?e:new Uint32Array(e),!1),i=F(this.device,s*n*4,!0),c=j(this.device,new Uint32Array([s,n]).buffer),d=$(this.device,this._embedPipeline,[c,a,this.gpuEmbedding,i]);return I(this.device,this._embedPipeline,d,[T(s,64),1,1]),a.destroy(),c.destroy(),i}async forward(e,t,o){const{dModel:n,vocabSize:s}=this.config,a=t*o;let i=this.embedTokens(e,t,o);const c=[];for(const m of this.layers){const{output:f,cache:g}=m.forward(i,t,o);c.push(g),i.destroy(),i=f}const d=F(this.device,a*n*4,!0),h=F(this.device,a*4,!1);{const m=new ArrayBuffer(16);new Uint32Array(m,0,2).set([a,n]),new Float32Array(m,8,1).set([1e-6]);const f=j(this.device,m),g=$(this.device,this._rmsnormPipeline,[f,i,this.gpuFinalNorm,d,h]);I(this.device,this._rmsnormPipeline,g,[T(a,64),1,1])}i.destroy();const l=F(this.device,a*s*4,!0);{const m=new Uint32Array([a,n,s]).buffer,f=j(this.device,m),g=$(this.device,this._lmHeadPipeline,[f,d,this.gpuEmbedding,this.gpuLMHeadBias,l]);I(this.device,this._lmHeadPipeline,g,[T(a,16),T(s,16),1])}return d.destroy(),h.destroy(),{logits:await de(this.device,l,a*s*4),gpuLogits:l,caches:c}}async embed(e){const{dModel:t}=this.config,o=e.length,n=1,s=n*o;if(s===0)return new Float32Array(t);let a=this.embedTokens(e,n,o);for(const u of this.layers){const{output:m}=u.forward(a,n,o);a.destroy(),a=m}const i=F(this.device,s*t*4,!0),c=F(this.device,s*4,!1);{const u=new ArrayBuffer(16);new Uint32Array(u,0,2).set([s,t]),new Float32Array(u,8,1).set([1e-6]);const m=j(this.device,u),f=$(this.device,this._rmsnormPipeline,[m,a,this.gpuFinalNorm,i,c]);I(this.device,this._rmsnormPipeline,f,[T(s,64),1,1])}a.destroy();const d=await de(this.device,i,s*t*4);i.destroy(),c.destroy();const h=new Float32Array(t);for(let u=0;u<o;u++){const m=u*t;for(let f=0;f<t;f++)h[f]+=d[m+f]}for(let u=0;u<t;u++)h[u]/=o;let l=0;for(let u=0;u<t;u++)l+=h[u]*h[u];l=Math.sqrt(l)||1;for(let u=0;u<t;u++)h[u]/=l;return h}async generate(e,t=200,o={}){const{temperature:n=1,topK:s=50,topP:a=.9}=o,{vocabSize:i}=this.config,c=[...e];for(let d=0;d<t;d++){const{logits:h}=await this.forward(new Uint32Array(c),1,c.length),l=h.slice((c.length-1)*i,c.length*i),u=Bo(l,{temperature:n,topK:s,topP:a});if(c.push(u),u===this.config.eosId)break}return c}parameters(){const e=[];e.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let t=0;t<this.layers.length;t++)for(const o of this.layers[t].parameters())e.push({...o,name:`layer${t}.${o.name}`});return e.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),e}getTrainableParams(){if(!this._wslaMode)return this.parameters();const e=[];for(let t=0;t<this.layers.length;t++)for(const o of this.layers[t].getTrainableParams())e.push({...o,name:`layer${t}.${o.name}`});return e}setWSLAMode(e){for(const t of this.layers)t.setWSLAMode(e);this._wslaMode=e}async exportWeights(e={}){const t=e.fp16??!1,o=this.parameters(),n=o.length,s=this.layers.length,a=await Promise.all(o.map(g=>de(this.device,g.buf,g.numel*4))),i=Math.ceil(s/4)*4,c=12+i+4+n*4,d=t?2:4,l=a.reduce((g,p)=>g+p.length,0)*d,u=new ArrayBuffer(c+l),m=new DataView(u);let f=0;m.setUint32(f,Qt,!0),f+=4,m.setUint32(f,t?3:2,!0),f+=4,m.setUint32(f,s,!0),f+=4;for(let g=0;g<s;g++){const p=this.layers[g].layerType;m.setUint8(f+g,Lo[p])}f+=i,m.setUint32(f,n,!0),f+=4;for(const g of o)m.setUint32(f,g.numel,!0),f+=4;if(t)for(const g of a){const p=Pe(g);new Uint16Array(u,f,p.length).set(p),f+=p.length*2}else for(const g of a)new Float32Array(u,f,g.length).set(g),f+=g.byteLength;return Ie(u)}async loadWeights(e){const t=se(e);if(t.hasTrailer&&!t.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const o=new DataView(e);let n=0;const s=o.getUint32(n,!0);if(n+=4,s!==Qt)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const a=o.getUint32(n,!0);if(n+=4,a===1){const i=o.getUint32(n,!0);n+=4;const c=this.parameters();if(i!==c.length)throw new Error(`Weight file has ${i} parameters but this model has ${c.length}.`);const d=[];for(let h=0;h<i;h++)d.push(o.getUint32(n,!0)),n+=4;for(let h=0;h<i;h++){const l=c[h],u=d[h];if(u!==l.numel)throw new Error(`Parameter ${h} ("${l.name}") size mismatch: file=${u}, model=${l.numel}.`);we(this.device,l.buf,new Float32Array(e,n,l.numel)),n+=l.numel*4}return}if(a===2||a===3){const i=a===3,c=o.getUint32(n,!0);if(n+=4,c!==this.layers.length)throw new Error(`Weight file has ${c} layers but this model has ${this.layers.length}.`);for(let m=0;m<c;m++){const f=o.getUint8(n+m),g=this.layers[m].layerType,p=So[f]??"mamba1";if(p!==g)throw new Error(`Layer ${m} type mismatch: file="${p}", model="${g}".`)}const d=Math.ceil(c/4)*4;n+=d;const h=o.getUint32(n,!0);n+=4;const l=this.parameters();if(h!==l.length)throw new Error(`Weight file has ${h} parameters but this model has ${l.length}.`);const u=[];for(let m=0;m<h;m++)u.push(o.getUint32(n,!0)),n+=4;for(let m=0;m<h;m++){const f=l[m],g=u[m];if(g!==f.numel)throw new Error(`Parameter ${m} ("${f.name}") size mismatch: file=${g}, model=${f.numel}.`);if(i){const p=new Uint16Array(e,n,g);we(this.device,f.buf,$e(p)),n+=g*2}else we(this.device,f.buf,new Float32Array(e,n,f.numel)),n+=g*4}return}throw new Error(`Unsupported MBJS version: ${a}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const e of this.layers)e.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class Tc extends Fo{constructor(e,t){super(e,{...t,layers:Array.from({length:t.numLayers},()=>({type:"mamba1"}))})}}const Do=`
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
`;function Bo(r,{temperature:e=1,topK:t=50,topP:o=.9}={}){const n=r.length,s=new Float32Array(n);for(let p=0;p<n;p++)s[p]=r[p]/Math.max(e,1e-7);let a=-1/0;for(let p=0;p<n;p++)s[p]>a&&(a=s[p]);let i=0;const c=new Float32Array(n);for(let p=0;p<n;p++)c[p]=Math.exp(s[p]-a),i+=c[p];const h=Array.from({length:n},(p,_)=>_).sort((p,_)=>c[_]-c[p]).slice(0,t);let l=0;const u=[];for(const p of h)if(l+=c[p]/i,u.push(p),l>=o)break;let m=0;for(const p of u)m+=c[p];const f=Math.random()*m;let g=0;for(const p of u)if(g+=c[p],g>=f)return p;return u[u.length-1]}const ze=1e-6;function ke(r){return 1/(1+Math.exp(-r))}function ve(r){let e=-1/0;for(let n=0;n<r.length;n++)r[n]>e&&(e=r[n]);const t=new Float32Array(r.length);let o=0;for(let n=0;n<r.length;n++)t[n]=Math.exp(r[n]-e),o+=t[n];for(let n=0;n<r.length;n++)t[n]=t[n]/o;return t}function Jt(r){return r/(1+Math.exp(-r))}function Zt(r){const e=ke(r);return e*(1+r*(1-e))}function Co(r){return Math.max(r,0)+Math.log1p(Math.exp(-Math.abs(r)))}function Se(r,e,t,o,n,s,a){for(let i=0;i<o;i++){const c=i*n,d=i*s;for(let h=0;h<s;h++){let l=t[h];const u=h*n;for(let m=0;m<n;m++)l+=r[c+m]*e[u+m];a[d+h]=l}}}function Ue(r,e,t,o,n,s,a,i,c){a.fill(0);for(let d=0;d<o;d++){const h=d*n,l=d*s;for(let u=0;u<s;u++){const m=r[l+u];if(m===0)continue;c[u]=c[u]+m;const f=u*n;for(let g=0;g<n;g++)a[h+g]=a[h+g]+m*t[f+g],i[f+g]=i[f+g]+m*e[h+g]}}}function Hn(r,e,t,o,n,s,a=ze){for(let i=0;i<t;i++){const c=i*o;let d=0;for(let l=0;l<o;l++){const u=r[c+l];d+=u*u}const h=1/Math.sqrt(d/o+a);s[i]=h;for(let l=0;l<o;l++)n[c+l]=r[c+l]*h*e[l]}}function Gn(r,e,t,o,n,s,a,i,c=ze){for(let d=0;d<n;d++){const h=d*s,l=o[d];let u=0;for(let f=0;f<s;f++){const g=r[h+f]*t[f];u+=g*e[h+f],i[f]=i[f]+r[h+f]*e[h+f]*l}const m=l*l*l/s;for(let f=0;f<s;f++){const g=r[h+f]*t[f];a[h+f]=a[h+f]+g*l-m*u*e[h+f]}}}const To={modelDim:64,hiddenDim:128,numExperts:8,topK:2},No=1299137793,en=1299137840;function Po(r){return r>0?r:0}class tn{modelDim;hiddenDim;w1;b1;w2;b2;gW1;gB1;gW2;gB2;constructor(e,t,o){this.modelDim=e,this.hiddenDim=t,this.w1=o(t*e,Math.sqrt(2/e)),this.b1=new Float32Array(t),this.w2=o(e*t,.02),this.b2=new Float32Array(e),this.gW1=new Float32Array(this.w1.length),this.gB1=new Float32Array(this.b1.length),this.gW2=new Float32Array(this.w2.length),this.gB2=new Float32Array(this.b2.length)}forward(e){const{modelDim:t,hiddenDim:o}=this,n=new Float32Array(o),s=new Float32Array(o);for(let i=0;i<o;i++){let c=this.b1[i];const d=i*t;for(let h=0;h<t;h++)c+=this.w1[d+h]*e[h];n[i]=c,s[i]=Po(c)}const a=new Float32Array(t);for(let i=0;i<t;i++){let c=this.b2[i];const d=i*o;for(let h=0;h<o;h++)c+=this.w2[d+h]*s[h];a[i]=c}return{y:a,pre:n,h:s}}backward(e,t,o,n){const{modelDim:s,hiddenDim:a}=this,i=new Float32Array(a);for(let d=0;d<s;d++){const h=e[d];this.gB2[d]=this.gB2[d]+h;const l=d*a;for(let u=0;u<a;u++)this.gW2[l+u]=this.gW2[l+u]+h*n[u],i[u]=i[u]+h*this.w2[l+u]}const c=new Float32Array(s);for(let d=0;d<a;d++){const h=o[d]>0?i[d]:0;this.gB1[d]=this.gB1[d]+h;const l=d*s;for(let u=0;u<s;u++)this.gW1[l+u]=this.gW1[l+u]+h*t[u],c[u]=c[u]+h*this.w1[l+u]}return c}params(){return[this.w1,this.b1,this.w2,this.b2]}grads(){return[this.gW1,this.gB1,this.gW2,this.gB2]}}class $o{numExperts;counts;probSum;tokens=0;constructor(e){this.numExperts=e,this.counts=new Float32Array(e),this.probSum=new Float32Array(e)}observe(e){this.tokens++;for(const t of e.experts)this.counts[t]=this.counts[t]+1;for(let t=0;t<this.numExperts;t++)this.probSum[t]=this.probSum[t]+e.probs[t]}dispatchFractions(){const e=this.counts.reduce((t,o)=>t+o,0)||1;return Float32Array.from(this.counts,t=>t/e)}loss(){if(this.tokens===0)return 0;const e=this.dispatchFractions();let t=0;for(let o=0;o<this.numExperts;o++)t+=e[o]*(this.probSum[o]/this.tokens);return this.numExperts*t}}class Kn{config;wr;gWr;shared;experts;constructor(e={}){const t={...To,...e};if(t.topK>t.numExperts)throw new Error(`MoE topK (${t.topK}) must be ≤ numExperts (${t.numExperts})`);if(t.topK<1)throw new Error(`MoE topK must be ≥ 1 (got ${t.topK})`);this.config=t;const o=new te((e.seed??No)>>>0||1),n=(s,a)=>{const i=new Float32Array(s);for(let c=0;c<s;c++){const d=Math.max(o.next(),1e-12),h=o.next();i[c]=a*Math.sqrt(-2*Math.log(d))*Math.cos(2*Math.PI*h)}return i};this.wr=n(t.numExperts*t.modelDim,.02),this.gWr=new Float32Array(this.wr.length),this.shared=new tn(t.modelDim,t.hiddenDim,n),this.experts=Array.from({length:t.numExperts},()=>new tn(t.modelDim,t.hiddenDim,n))}route(e){const{numExperts:t,topK:o,modelDim:n}=this.config,s=new Float32Array(t);for(let l=0;l<t;l++){let u=0;const m=l*n;for(let f=0;f<n;f++)u+=this.wr[m+f]*e[f];s[l]=u}const a=ve(s),c=Array.from({length:t},(l,u)=>u).sort((l,u)=>s[u]-s[l]).slice(0,o),d=c.map(l=>s[l]),h=ve(Float32Array.from(d));return{experts:c,gates:Array.from(h),probs:a}}forward(e){const{modelDim:t}=this.config,o=Float32Array.from({length:t},(h,l)=>e[l]??0),n=this.route(o),s=this.shared.forward(o),a=Float32Array.from(s.y),i=[],c=[],d=[];for(let h=0;h<n.experts.length;h++){const u=this.experts[n.experts[h]].forward(o),m=n.gates[h];for(let f=0;f<t;f++)a[f]=a[f]+m*u.y[f];i.push(u.y),c.push(u.pre),d.push(u.h)}return{output:a,route:n,cache:{x:o,route:n,sharedPre:s.pre,sharedH:s.h,expertOut:i,expertPre:c,expertH:d}}}backward(e,t){const{modelDim:o}=this.config,n=Float32Array.from({length:o},(l,u)=>e[u]??0),s=new Float32Array(o),a=this.shared.backward(n,t.x,t.sharedPre,t.sharedH);for(let l=0;l<o;l++)s[l]=s[l]+a[l];const i=t.route.experts.length,c=new Float32Array(i);for(let l=0;l<i;l++){const u=t.route.gates[l],m=new Float32Array(o);let f=0;for(let p=0;p<o;p++)m[p]=u*n[p],f+=n[p]*t.expertOut[l][p];const g=this.experts[t.route.experts[l]].backward(m,t.x,t.expertPre[l],t.expertH[l]);for(let p=0;p<o;p++)s[p]=s[p]+g[p];c[l]=f}const d=t.route.gates;let h=0;for(let l=0;l<i;l++)h+=d[l]*c[l];for(let l=0;l<i;l++){const u=d[l]*(c[l]-h),f=t.route.experts[l]*o;for(let g=0;g<o;g++)this.gWr[f+g]=this.gWr[f+g]+u*t.x[g],s[g]=s[g]+u*this.wr[f+g]}return s}auxGradStep(e,t,o,n){const{numExperts:s,modelDim:a}=this.config;let i=0;for(let c=0;c<s;c++)i+=o[c]*t[c];for(let c=0;c<s;c++){const d=n*t[c]*(o[c]-i);if(d===0)continue;const h=c*a;for(let l=0;l<a;l++)this.gWr[h+l]=this.gWr[h+l]+d*e[l]}}parameters(){const e=[{name:"wr",data:this.wr,numel:this.wr.length}],t=(o,n)=>{const s=["w1","b1","w2","b2"];n.params().forEach((a,i)=>e.push({name:`${o}.${s[i]}`,data:a,numel:a.length}))};return t("shared",this.shared),this.experts.forEach((o,n)=>t(`expert${n}`,o)),e}gradients(){const e=[{name:"wr",data:this.gWr,numel:this.gWr.length}],t=(o,n)=>{const s=["w1","b1","w2","b2"];n.grads().forEach((a,i)=>e.push({name:`${o}.${s[i]}`,data:a,numel:a.length}))};return t("shared",this.shared),this.experts.forEach((o,n)=>t(`expert${n}`,o)),e}zeroGrad(){for(const e of this.gradients())e.data.fill(0)}exportExpert(e){const t=this.experts[e];if(!t)throw new Error(`exportExpert: index ${e} out of range (0..${this.config.numExperts-1})`);const o=["w1","b1","w2","b2"];return t.params().map((n,s)=>({name:o[s],data:n,numel:n.length}))}exportWeights(e={}){const t=e.fp16??!1,o=this.parameters(),n=o.reduce((l,u)=>l+u.numel,0),s=6,a=s*4,i=new ArrayBuffer(a+(t?n*2:n*4)),c=new Uint32Array(i,0,s);c[0]=en,c[1]=t?2:1,c[2]=this.config.modelDim,c[3]=this.config.hiddenDim,c[4]=this.config.numExperts,c[5]=this.config.topK;const d=new Float32Array(n);let h=0;for(const l of o)d.set(l.data,h),h+=l.numel;return t?new Uint16Array(i,a,n).set(Pe(d)):new Float32Array(i,a,n).set(d),i}loadWeights(e){const t=new Uint32Array(e,0,6);if(t[0]!==en)throw new Error("SharedExpertMoE.loadWeights: bad magic (not an MoE0 checkpoint)");const[,o,n,s,a,i]=t;if(n!==this.config.modelDim||s!==this.config.hiddenDim||a!==this.config.numExperts||i!==this.config.topK)throw new Error("SharedExpertMoE.loadWeights: config mismatch with checkpoint");const c=this.parameters(),d=c.reduce((m,f)=>m+f.numel,0),h=24,l=o===2?$e(new Uint16Array(e,h,d)):new Float32Array(e.slice(h,h+d*4));let u=0;for(const m of c)m.data.set(l.subarray(u,u+m.numel)),u+=m.numel}}class Bt{target;m=[];v=[];t=0;opt;shard;constructor(e,t={}){this.target=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0};const o=t.shard??null;if(o&&(o.count<=0||o.index<0||o.index>=o.count))throw new Error(`AdamW: invalid shard ${o.index}/${o.count}`);this.shard=o;const n=e.parameters();for(let s=0;s<n.length;s++)this._owns(s)?(this.m.push(new Float32Array(n[s].data.length)),this.v.push(new Float32Array(n[s].data.length))):(this.m.push(null),this.v.push(null))}_owns(e){return this.shard===null||e%this.shard.count===this.shard.index}step(){this.t++;const{lr:e,beta1:t,beta2:o,eps:n,weightDecay:s}=this.opt,a=this.target.parameters(),i=this.target.gradients(),c=1-Math.pow(t,this.t),d=1-Math.pow(o,this.t);for(let h=0;h<a.length;h++){if(!this._owns(h))continue;const l=a[h].data,u=i[h].data,m=this.m[h],f=this.v[h];for(let g=0;g<l.length;g++){const p=u[g];m[g]=t*m[g]+(1-t)*p,f[g]=o*f[g]+(1-o)*p*p;const _=m[g]/c,b=f[g]/d;l[g]=l[g]-e*(_/(Math.sqrt(b)+n)+s*l[g])}}}stateBytes(){let e=0;for(const t of this.m)t&&(e+=t.byteLength);for(const t of this.v)t&&(e+=t.byteLength);return e}}const nn=34028234663852886e22;function Ke(r,e,t,o,n){const{lr:s,beta1:a,beta2:i,eps:c,weightDecay:d,beta1_t:h,beta2_t:l,maxDelta:u}=n,m=n.gradScale??1,f=1-h,g=1-l;let p=0;for(let _=0;_<r.length;_++){const b=e[_]*m,w=a*t[_]+(1-a)*b,y=i*o[_]+(1-i)*b*b;if(!(Math.abs(w)<=nn&&y<=nn)){p++;continue}t[_]=w,o[_]=y;let x=s*(w/f)/(Math.sqrt(y/g)+c);Number.isFinite(x)||(x=0),u>0&&(x=Math.min(u,Math.max(-u,x))),r[_]=r[_]*(1-s*d)-x}return p}class Nc{model;adam;opt;constructor(e,t={}){this.model=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0,auxWeight:t.auxWeight??.01,batchSize:t.batchSize??0,epochs:t.epochs??1},this.adam=new Bt(e,this.opt)}fit(e){const t=[];for(let o=0;o<this.opt.epochs;o++)t.push(this.runEpoch(e));return t}runEpoch(e){const t=this.opt.batchSize>0?this.opt.batchSize:e.length,{numExperts:o,modelDim:n}=this.model.config;let s=0,a=0;for(let i=0;i<e.length;i+=t){const c=e.slice(i,i+t);this.model.zeroGrad();const d=[],h=[],l=new $o(o);let u=0;for(const g of c){const p=this.model.forward(g.input),_=new Float32Array(n);for(let b=0;b<n;b++){const w=p.output[b]-(g.target[b]??0);_[b]=w,u+=.5*w*w}this.model.backward(_,p.cache),d.push(p.cache.x),h.push(p.route.probs),l.observe(p.route)}const m=l.dispatchFractions(),f=this.opt.auxWeight*o/c.length;for(let g=0;g<d.length;g++)this.model.auxGradStep(d[g],h[g],m,f);this.scaleGradients(1/c.length),this.adam.step(),s+=u,a=l.loss()}return{loss:s/Math.max(1,e.length),auxLoss:a}}scaleGradients(e){if(e!==1)for(const t of this.model.gradients())for(let o=0;o<t.data.length;o++)t.data[o]=t.data[o]*e}}let Be=[],Ct=!0;class Pc{data;shape;numel;requiresGrad;grad;_gradFn;constructor(e,t,o=!1){this.data=e,this.shape=t,this.numel=t.reduce((n,s)=>n*s,1),this.requiresGrad=o,this.grad=null,this._gradFn=null}get byteSize(){return this.numel*4}zeroGrad(e){this.grad&&e.queue.writeBuffer(this.grad,0,new Float32Array(this.numel))}destroy(){this.data?.destroy(),this.grad?.destroy(),this.data=null,this.grad=null}}function $c(){Ct=!0}function Ic(){Ct=!1}function Io(){Be=[]}function zc(r){return Ct?(Be.push({backward:r}),Be.length-1):-1}async function jc(){for(let r=Be.length-1;r>=0;r--)await Be[r].backward();Io()}function Ae(r,e){let t=-1/0;for(let s=0;s<r.length;s++)r[s]>t&&(t=r[s]);let o=0;for(let s=0;s<r.length;s++)o+=Math.exp(r[s]-t);return Math.log(o)+t-r[e]}function qn(r,e){let t=-1/0;for(let a=0;a<r.length;a++)r[a]>t&&(t=r[a]);let o=0;const n=new Float32Array(r.length);for(let a=0;a<r.length;a++)n[a]=Math.exp(r[a]-t),o+=n[a];const s=new Float32Array(r.length);for(let a=0;a<r.length;a++)s[a]=n[a]/o;return s[e]=(s[e]??0)-1,s}function Vn(r){return Ft(et(r))}function Wc(r){const e=new Float32Array(r.length);for(let t=0;t<r.length;t++)e[t]=Vn(r[t]);return e}class zo{_scale;growthFactor;backoffFactor;growthInterval;minScale;cleanStreak=0;_overflows=0;_skipped=0;constructor(e={}){this._scale=e.initScale??16384,this.growthFactor=e.growthFactor??2,this.backoffFactor=e.backoffFactor??.5,this.growthInterval=e.growthInterval??200,this.minScale=e.minScale??1}get scale(){return this._scale}get overflows(){return this._overflows}get skipped(){return this._skipped}check(e){for(const t of e){const o=t.data;for(let n=0;n<o.length;n++){const s=o[n];if(!Number.isFinite(s))return!0}}return!1}unscale(e){const t=1/this._scale;for(const o of e){const n=o.data;for(let s=0;s<n.length;s++)n[s]=n[s]*t}}update(e){return e?(this._overflows++,this._skipped++,this._scale=Math.max(this.minScale,this._scale*this.backoffFactor),this.cleanStreak=0,!1):(++this.cleanStreak>=this.growthInterval&&(this._scale*=this.growthFactor,this.cleanStreak=0),!0)}}const Xn=809784901,jo=1;function Yn(r,e,t,o=0){if(r.length!==e.length)throw new Error(`computeRowDelta: length mismatch (base ${r.length}, current ${e.length})`);if(t<=0||r.length%t!==0)throw new Error(`computeRowDelta: base length ${r.length} is not a multiple of rowSize ${t}`);const n=r.length/t,s=[];for(let i=0;i<n;i++){const c=i*t;let d=!1;for(let h=0;h<t;h++)if(Math.abs(e[c+h]-r[c+h])>o){d=!0;break}d&&s.push(i)}const a=new Float32Array(s.length*t);return s.forEach((i,c)=>a.set(e.subarray(i*t,i*t+t),c*t)),{rowSize:t,rows:s,data:a}}function Qn(r,e){if(r.length%e.rowSize!==0)throw new Error(`applyRowDelta: base length ${r.length} is not a multiple of rowSize ${e.rowSize}`);const t=Float32Array.from(r);return e.rows.forEach((o,n)=>{const s=o*e.rowSize;if(s+e.rowSize>t.length)throw new Error(`applyRowDelta: row ${o} out of range for base of ${t.length} elements`);t.set(e.data.subarray(n*e.rowSize,n*e.rowSize+e.rowSize),s)}),t}function Tt(r){const e=r.rows.length,o=4*4,n=e*4,s=r.data.length*4,a=new ArrayBuffer(o+n+s),i=new DataView(a);i.setUint32(0,Xn,!0),i.setUint32(4,jo,!0),i.setUint32(8,r.rowSize,!0),i.setUint32(12,e,!0);let c=o;for(const d of r.rows)i.setUint32(c,d,!0),c+=4;return new Float32Array(a,c,r.data.length).set(r.data),Ie(a)}function Jn(r,e){const t=se(r);if(t.hasTrailer&&!t.ok)throw new Error("diffCheckpoints: base failed CRC integrity check");const o=se(e);if(o.hasTrailer&&!o.ok)throw new Error("diffCheckpoints: current failed CRC integrity check");if(t.body.byteLength!==o.body.byteLength)throw new Error(`diffCheckpoints: shape mismatch (base ${t.body.byteLength}B, current ${o.body.byteLength}B) — only same-config checkpoints can be diffed`);if(t.body.byteLength%4!==0)throw new Error("diffCheckpoints: checkpoint body is not 4-byte aligned (not an f32 checkpoint)");return Tt(Yn(new Float32Array(t.body),new Float32Array(o.body),1))}function Zn(r,e){const t=se(r);if(t.hasTrailer&&!t.ok)throw new Error("applyCheckpointDiff: base failed CRC integrity check");const o=Qn(new Float32Array(t.body),tt(e)),n=new ArrayBuffer(o.byteLength);return new Float32Array(n).set(o),Ie(n)}function tt(r){const e=se(r);if(e.hasTrailer&&!e.ok)throw new Error("deserializeRowDelta: failed CRC integrity check (corrupt or truncated)");const t=e.body,o=new DataView(t);if(o.getUint32(0,!0)!==Xn)throw new Error("deserializeRowDelta: bad magic (not an EVD0 delta)");const n=o.getUint32(8,!0),s=o.getUint32(12,!0);let a=16;const i=[];for(let d=0;d<s;d++)i.push(o.getUint32(a,!0)),a+=4;const c=new Float32Array(t.slice(a,a+s*n*4));return{rowSize:n,rows:i,data:c}}const Me={dModel:64,numLayers:2,convKernel:3,hiddenDim:128,numExperts:4,topK:2},Wo=1163283533,rn=1163283504;class nt{config;_positionsEvaluated=0;emb;gEmb;conv;gConv;nConv;gNConv;nMoe;gNMoe;moe;constructor(e){const t=e.dModel??Me.dModel,o={vocabSize:e.vocabSize,dModel:t,numLayers:e.numLayers??Me.numLayers,convKernel:e.convKernel??Me.convKernel,hiddenDim:e.hiddenDim??t*2,numExperts:e.numExperts??Me.numExperts,topK:e.topK??Me.topK};if(o.vocabSize<=0)throw new Error("EvermindLM: vocabSize must be > 0");if(o.topK>o.numExperts)throw new Error("EvermindLM: topK must be ≤ numExperts");this.config=o;const n=(e.seed??Wo)>>>0||1,s=new te(n),a=(i,c)=>{const d=new Float32Array(i);for(let h=0;h<i;h++){const l=Math.max(s.next(),1e-12),u=s.next();d[h]=c*Math.sqrt(-2*Math.log(l))*Math.cos(2*Math.PI*u)}return d};this.emb=a(o.vocabSize*o.dModel,.02),this.gEmb=new Float32Array(this.emb.length),this.conv=[],this.gConv=[],this.nConv=[],this.gNConv=[],this.nMoe=[],this.gNMoe=[],this.moe=[];for(let i=0;i<o.numLayers;i++){const c=new Float32Array(o.dModel*o.convKernel);for(let d=0;d<o.dModel;d++)c[d*o.convKernel]=1;this.conv.push(c),this.gConv.push(new Float32Array(c.length)),this.nConv.push(new Float32Array(o.dModel).fill(1)),this.gNConv.push(new Float32Array(o.dModel)),this.nMoe.push(new Float32Array(o.dModel).fill(1)),this.gNMoe.push(new Float32Array(o.dModel)),this.moe.push(new Kn({modelDim:o.dModel,hiddenDim:o.hiddenDim,numExperts:o.numExperts,topK:o.topK,seed:n+1+i}))}}_embed(e){const{dModel:t}=this.config;return e.map(o=>{const n=new Float32Array(t),s=o*t;for(let a=0;a<t;a++)n[a]=this.emb[s+a];return n})}_forwardLayer(e,t){const o=t.length,n=[],s=[],a=[],i=[],c=[],d=[],h=[];for(let l=0;l<o;l++){const u=this._stepLayerPosition(e,t[l],n);s.push(u.normed),a.push(u.rmsConv),i.push(u.afterConv),c.push(u.rmsMoe),d.push(u.moeCache),h.push(u.out)}return{afterMoe:h,cache:{layerIn:t,normedConv:s,rmsConv:a,afterConv:i,rmsMoe:c,moeCache:d}}}_stepLayerPosition(e,t,o){const{dModel:n,convKernel:s}=this.config,a=this.conv[e],{y:i,r:c}=on(t,this.nConv[e]),d=Float32Array.from(t);for(let f=0;f<n;f++){let g=a[f*s]*i[f];for(let p=1;p<s;p++){const _=o[o.length-p];_&&(g+=a[f*s+p]*_[f])}d[f]=d[f]+g}for(o.push(i);o.length>s-1;)o.shift();const{y:h,r:l}=on(d,this.nMoe[e]),u=Float32Array.from(d),m=this.moe[e].forward(h);for(let f=0;f<n;f++)u[f]=u[f]+m.output[f];return this._positionsEvaluated++,{normed:i,rmsConv:c,afterConv:d,rmsMoe:l,moeCache:m.cache,out:u}}_embedOne(e){const{dModel:t}=this.config,o=new Float32Array(t),n=e*t;for(let s=0;s<t;s++)o[s]=this.emb[n+s];return o}_head(e){const{dModel:t,vocabSize:o}=this.config;return e.map(n=>{const s=new Float32Array(o);for(let a=0;a<o;a++){let i=0;const c=a*t;for(let d=0;d<t;d++)i+=n[d]*this.emb[c+d];s[a]=i}return s})}forward(e){let t=this._embed(e);const o=[];for(let n=0;n<this.config.numLayers;n++){const{afterMoe:s,cache:a}=this._forwardLayer(n,t);o.push(a),t=s}return{logits:this._head(t),cache:{tokens:e,layers:o,finalX:t}}}embed(e){const{dModel:t,numLayers:o}=this.config,n=new Float32Array(t),s=e.length;if(s===0)return n;const a=Array.from({length:o},()=>[]);for(let c=0;c<s;c++){let d=this._embedOne(e[c]);for(let h=0;h<o;h++)d=this._stepLayerPosition(h,d,a[h]).out;for(let h=0;h<t;h++)n[h]=n[h]+d[h]}for(let c=0;c<t;c++)n[c]=n[c]/s;let i=0;for(let c=0;c<t;c++)i+=n[c]*n[c];i=Math.sqrt(i)||1;for(let c=0;c<t;c++)n[c]=n[c]/i;return n}embedText(e,t){return this.embed(t.encode(e))}_headBackward(e,t,o){const{dModel:n,vocabSize:s}=this.config,a=e.length,i=a-1,c=1/i,d=Array.from({length:a},()=>new Float32Array(n));let h=0;for(let l=0;l<i;l++){const u=e[l+1];h+=Ae(t[l],u)*c;const m=qn(t[l],u),f=o[l];for(let g=0;g<s;g++){const p=m[g]*c;if(p===0)continue;const _=g*n;for(let b=0;b<n;b++)this.gEmb[_+b]=this.gEmb[_+b]+p*f[b],d[l][b]=d[l][b]+p*this.emb[_+b]}}return{loss:h,dX:d}}_backwardLayer(e,t,o){const{dModel:n,convKernel:s}=this.config,a=t.length,i=this.conv[e],c=this.gConv[e],d=this.nConv[e],h=this.gNConv[e],l=this.nMoe[e],u=this.gNMoe[e],m=[];for(let p=0;p<a;p++){const _=this.moe[e].backward(t[p],o.moeCache[p]),{dx:b,dgain:w}=sn(_,o.afterConv[p],o.rmsMoe[p],l);for(let x=0;x<n;x++)u[x]=u[x]+w[x];const y=Float32Array.from(t[p]);for(let x=0;x<n;x++)y[x]=y[x]+b[x];m.push(y)}const f=Array.from({length:a},()=>new Float32Array(n)),g=m.map(p=>Float32Array.from(p));for(let p=0;p<a;p++)for(let _=0;_<n;_++){const b=m[p][_];if(b!==0)for(let w=0;w<s;w++){const y=p-w;y<0||(c[_*s+w]=c[_*s+w]+b*o.normedConv[y][_],f[y][_]=f[y][_]+b*i[_*s+w])}}for(let p=0;p<a;p++){const{dx:_,dgain:b}=sn(f[p],o.layerIn[p],o.rmsConv[p],d);for(let w=0;w<n;w++)h[w]=h[w]+b[w],g[p][w]=g[p][w]+_[w]}return g}_embedBackward(e,t){const{dModel:o}=this.config;for(let n=0;n<e.length;n++){const s=e[n]*o;for(let a=0;a<o;a++)this.gEmb[s+a]=this.gEmb[s+a]+t[n][a]}}lossAndBackward(e){if(e.length<2)return 0;const{logits:t,cache:o}=this.forward(e),{loss:n,dX:s}=this._headBackward(e,t,o.finalX);let a=s;for(let i=this.config.numLayers-1;i>=0;i--)a=this._backwardLayer(i,a,o.layers[i]);return this._embedBackward(e,a),n}lossAndBackwardCheckpointed(e){if(e.length<2)return 0;let t=this._embed(e);const o=[];for(let c=0;c<this.config.numLayers;c++)o.push(t),t=this._forwardLayer(c,t).afterMoe;const n=this._head(t),{loss:s,dX:a}=this._headBackward(e,n,t);let i=a;for(let c=this.config.numLayers-1;c>=0;c--){const{cache:d}=this._forwardLayer(c,o[c]);i=this._backwardLayer(c,i,d)}return this._embedBackward(e,i),s}get positionsEvaluated(){return this._positionsEvaluated}resetStats(){this._positionsEvaluated=0}newDecodeState(){return{convWindow:Array.from({length:this.config.numLayers},()=>[]),length:0,lastLogits:null}}cloneDecodeState(e){return{convWindow:e.convWindow.map(t=>t.map(o=>Float32Array.from(o))),length:e.length,lastLogits:e.lastLogits?Float32Array.from(e.lastLogits):null}}stepDecode(e,t){const o=this.cloneDecodeState(e),n=[];for(const s of t){let a=this._embedOne(s);for(let c=0;c<this.config.numLayers;c++)a=this._stepLayerPosition(c,a,o.convWindow[c]).out;const i=this._head([a])[0];n.push(i),o.lastLogits=i,o.length++}return{logits:n,state:o}}prefixState(e){return this.stepDecode(this.newDecodeState(),e).state}scoreContinuation(e,t){if(t.length===0||!e.lastLogits)return-1/0;const{logits:o}=this.stepDecode(e,t.slice(0,-1));let n=an(e.lastLogits,t[0]);for(let s=1;s<t.length;s++)n+=an(o[s-1],t[s]);return n/t.length}generateText(e,t,o){return t.decode(this.generate(t.encode(e),o))}generate(e,t){const o=t.temperature??0,n=o>0?new te((t.seed??1)>>>0||1):null;let s=this.stepDecode(this.newDecodeState(),e.length>0?e:[0]).state;const a=[];for(let i=0;i<t.maxNewTokens;i++){const c=s.lastLogits,d=n?Uo(c,o,n):Oo(c);if(a.push(d),t.stopToken!==void 0&&d===t.stopToken)break;s=this.stepDecode(s,[d]).state}return a}parameters(){const e=[{data:this.emb}];for(let t=0;t<this.config.numLayers;t++){e.push({data:this.conv[t]},{data:this.nConv[t]},{data:this.nMoe[t]});for(const o of this.moe[t].parameters())e.push({data:o.data})}return e}gradients(){const e=[{data:this.gEmb}];for(let t=0;t<this.config.numLayers;t++){e.push({data:this.gConv[t]},{data:this.gNConv[t]},{data:this.gNMoe[t]});for(const o of this.moe[t].gradients())e.push({data:o.data})}return e}zeroGrad(){this.gEmb.fill(0);for(let e=0;e<this.config.numLayers;e++)this.gConv[e].fill(0),this.gNConv[e].fill(0),this.gNMoe[e].fill(0),this.moe[e].zeroGrad()}exportWeights(e={}){const t=e.fp16??!1,o=this.parameters(),n=o.reduce((l,u)=>l+u.data.length,0),s=9,a=s*4,i=new ArrayBuffer(a+(t?n*2:n*4)),c=new Uint32Array(i,0,s);c[0]=rn,c[1]=t?2:1,c[2]=this.config.vocabSize,c[3]=this.config.dModel,c[4]=this.config.numLayers,c[5]=this.config.convKernel,c[6]=this.config.hiddenDim,c[7]=this.config.numExperts,c[8]=this.config.topK;const d=new Float32Array(n);let h=0;for(const l of o)d.set(l.data,h),h+=l.data.length;return t?new Uint16Array(i,a,n).set(Pe(d)):new Float32Array(i,a,n).set(d),Ie(i)}loadWeights(e){this._setFlat(this._readFlat(e))}_readFlat(e){const t=se(e);if(t.hasTrailer&&!t.ok)throw new Error("EvermindLM.loadWeights: checkpoint failed CRC integrity check (corrupt or truncated)");const o=new Uint32Array(e,0,9);if(o[0]!==rn)throw new Error("EvermindLM.loadWeights: bad magic (not an EVL0 checkpoint)");const n=o[1];if(o[2]!==this.config.vocabSize||o[3]!==this.config.dModel||o[4]!==this.config.numLayers||o[5]!==this.config.convKernel||o[6]!==this.config.hiddenDim||o[7]!==this.config.numExperts||o[8]!==this.config.topK)throw new Error("EvermindLM.loadWeights: config mismatch with checkpoint");const s=this.parameters().reduce((i,c)=>i+c.data.length,0),a=36;return n===2?$e(new Uint16Array(e,a,s)):new Float32Array(e.slice(a,a+s*4))}_flat(){const e=this.parameters(),t=e.reduce((s,a)=>s+a.data.length,0),o=new Float32Array(t);let n=0;for(const s of e)o.set(s.data,n),n+=s.data.length;return o}_setFlat(e){let t=0;for(const o of this.parameters())o.data.set(e.subarray(t,t+o.data.length)),t+=o.data.length}exportDelta(e,t={}){const o=this._readFlat(e),n=this._flat(),s=n.length%this.config.dModel===0?this.config.dModel:1;return Tt(Yn(o,n,s,t.eps??0))}loadDelta(e,t){const o=this._readFlat(e);this._setFlat(Qn(o,tt(t)))}}class Nt{model;opts;adam;scaler;grads;constructor(e,t={}){this.model=e,this.opts=t,this.adam=new Bt(e,t),this.grads=e.gradients(),this.scaler=t.mixedPrecision?new zo(typeof t.mixedPrecision=="object"?t.mixedPrecision:{}):null}get lossScaler(){return this.scaler}_backward(e){return this.opts.checkpoint?this.model.lossAndBackwardCheckpointed(e):this.model.lossAndBackward(e)}_scaleGrads(e){if(e===1)return;const t=1/e;for(const o of this.grads)for(let n=0;n<o.data.length;n++)o.data[n]=o.data[n]*t}_fp16Grads(){for(const e of this.grads)for(let t=0;t<e.data.length;t++)e.data[t]=Vn(e.data[t])}_mulGrads(e){if(e!==1)for(const t of this.grads)for(let o=0;o<t.data.length;o++)t.data[o]=t.data[o]*e}fit(e){const t=this.opts.epochs??1,o=Math.max(1,this.opts.accumSteps??1),n=[];for(let s=0;s<t;s++){let a=0,i=0,c=0,d=this.scaler?this.scaler.scale:1;this.model.zeroGrad();const h=()=>{if(c!==0){if(this._scaleGrads(c),this.scaler){this._fp16Grads();const l=this.scaler.check(this.grads);this.scaler.update(l)&&(this._mulGrads(1/d),this.adam.step()),d=this.scaler.scale}else this.adam.step();this.model.zeroGrad(),c=0}};for(const l of e){if(l.length<2)continue;c===0&&this.scaler&&(d=this.scaler.scale);const u=this._backward(l);this._mulGrads(d),a+=u,i++,++c>=o&&h()}h(),n.push(i>0?a/i:0)}return n}}const Ro=1e-5;function on(r,e){const t=r.length;let o=0;for(let a=0;a<t;a++)o+=r[a]*r[a];const n=Math.sqrt(o/t+Ro),s=new Float32Array(t);for(let a=0;a<t;a++)s[a]=e[a]*r[a]/n;return{y:s,r:n}}function sn(r,e,t,o){const n=e.length;let s=0;for(let d=0;d<n;d++)s+=r[d]*o[d]*e[d];const a=new Float32Array(n),i=new Float32Array(n),c=t*t*t;for(let d=0;d<n;d++)a[d]=o[d]*r[d]/t-e[d]*s/(n*c),i[d]=r[d]*e[d]/t;return{dx:a,dgain:i}}function Oo(r){let e=0;for(let t=1;t<r.length;t++)r[t]>r[e]&&(e=t);return e}function Uo(r,e,t){let o=-1/0;for(let i=0;i<r.length;i++)r[i]/e>o&&(o=r[i]/e);let n=0;const s=new Float32Array(r.length);for(let i=0;i<r.length;i++)s[i]=Math.exp(r[i]/e-o),n+=s[i];let a=t.next()*n;for(let i=0;i<s.length;i++)if(a-=s[i],a<=0)return i;return s.length-1}function an(r,e){let t=-1/0;for(let s=0;s<r.length;s++){const a=r[s];a>t&&(t=a)}if(!Number.isFinite(t))return-1/0;let o=0;for(let s=0;s<r.length;s++)o+=Math.exp(r[s]-t);return(e>=0&&e<r.length?r[e]:-1/0)-(t+Math.log(o))}const He=0,it=1;class Ho{textVocabSize;levels;codebookSize;bosVideo;eosVideo;frameKey;frameDelta;codeBase;size;perBank;constructor(e){if(e.textVocabSize<0)throw new Error("MultimodalVocab: textVocabSize must be ≥ 0");if(e.levels<=0||e.codebookSize<=0)throw new Error("MultimodalVocab: levels and codebookSize must be > 0");this.textVocabSize=e.textVocabSize,this.levels=e.levels,this.codebookSize=e.codebookSize,this.bosVideo=e.textVocabSize,this.eosVideo=e.textVocabSize+1,this.frameKey=e.textVocabSize+2,this.frameDelta=e.textVocabSize+3,this.codeBase=e.textVocabSize+4,this.perBank=e.levels*e.codebookSize,this.size=this.codeBase+2*this.perBank}codeToken(e,t,o){return this.codeBase+e*this.perBank+t*this.codebookSize+o}isText(e){return e>=0&&e<this.textVocabSize}isCode(e){return e>=this.codeBase&&e<this.size}isVideoMarker(e){return e===this.frameKey||e===this.frameDelta}decodeCode(e){const t=e-this.codeBase,o=Math.floor(t/this.perBank),n=t-o*this.perBank,s=Math.floor(n/this.codebookSize),a=n-s*this.codebookSize;return{bank:o,level:s,code:a}}classify(e){return this.isText(e)?{kind:"text",id:e}:e===this.bosVideo?{kind:"control",control:"bosVideo"}:e===this.eosVideo?{kind:"control",control:"eosVideo"}:e===this.frameKey?{kind:"control",control:"frameKey"}:e===this.frameDelta?{kind:"control",control:"frameDelta"}:{kind:"code",...this.decodeCode(e)}}}const cn=1448235312,he={channels:3,patch:4,levels:2,codebookSize:16,keyframeInterval:12,textVocabSize:0,seed:1448232529};class rt{height;width;channels;patch;levels;codebookSize;keyframeInterval;latentDim;patchesPerFrame;tokensPerFrame;vocab;banks;constructor(e){const t=e.channels??he.channels,o=e.patch??he.patch;if(e.height<=0||e.width<=0)throw new Error("VideoRVQCodec: height/width must be > 0");if(e.height%o!==0||e.width%o!==0)throw new Error(`VideoRVQCodec: height/width must be divisible by patch (${o})`);this.height=e.height,this.width=e.width,this.channels=t,this.patch=o,this.levels=e.levels??he.levels,this.codebookSize=e.codebookSize??he.codebookSize,this.keyframeInterval=Math.max(1,e.keyframeInterval??he.keyframeInterval),this.latentDim=o*o*t,this.patchesPerFrame=this.height/o*(this.width/o),this.tokensPerFrame=this.patchesPerFrame*this.levels,this.vocab=new Ho({textVocabSize:e.textVocabSize??he.textVocabSize,levels:this.levels,codebookSize:this.codebookSize});const n=new te((e.seed??he.seed)>>>0||1),s=()=>Array.from({length:this.levels},()=>{const a=new Float32Array(this.codebookSize*this.latentDim);for(let i=0;i<a.length;i++)a[i]=(n.next()-.5)*.1;return a});this.banks=[s(),s()];for(const a of this.banks[He])for(let i=0;i<a.length;i++)a[i]+=.5}get vocabSize(){return this.vocab.size}serialize(){const t=2*this.levels*this.codebookSize*this.latentDim,o=new ArrayBuffer(36+t*4),n=new Uint32Array(o,0,9);n[0]=cn,n[1]=this.height,n[2]=this.width,n[3]=this.channels,n[4]=this.patch,n[5]=this.levels,n[6]=this.codebookSize,n[7]=this.keyframeInterval,n[8]=this.vocab.textVocabSize;const s=new Float32Array(o,36,t);let a=0;for(const i of this.banks)for(const c of i)s.set(c,a),a+=c.length;return o}static deserialize(e){const t=new Uint32Array(e,0,9);if(t[0]!==cn)throw new Error("VideoRVQCodec.deserialize: bad magic (not a VRQ0 blob)");const o=new rt({height:t[1],width:t[2],channels:t[3],patch:t[4],levels:t[5],codebookSize:t[6],keyframeInterval:t[7],textVocabSize:t[8]}),n=2*o.levels*o.codebookSize*o.latentDim,s=new Float32Array(e.slice(36,36+n*4));let a=0;for(const i of o.banks)for(const c of i)c.set(s.subarray(a,a+c.length)),a+=c.length;return o}encode(e){this.assertShape(e);const t=[this.vocab.bosVideo];let o=null;for(let n=0;n<e.length;n++){const s=this.toPatches(e[n]),a=o===null||n%this.keyframeInterval===0,i=a?He:it;t.push(a?this.vocab.frameKey:this.vocab.frameDelta);const c=[];for(let d=0;d<this.patchesPerFrame;d++){const h=a?s[d]:ln(s[d],o[d]),{codes:l,recon:u}=this.rvqEncode(i,h);for(let m=0;m<this.levels;m++)t.push(this.vocab.codeToken(i,m,l[m]));c.push(a?u:dn(o[d],u))}o=c}return t.push(this.vocab.eosVideo),t}decode(e){const t=[];let o=null,n=0;for(;n<e.length&&!this.vocab.isVideoMarker(e[n]);){if(e[n]===this.vocab.eosVideo)return t;n++}for(;n<e.length;){const s=e[n];if(!this.vocab.isVideoMarker(s))break;n++;const a=s===this.vocab.frameKey||o===null,i=a?He:it,c=[];for(;c.length<this.tokensPerFrame&&n<e.length&&this.vocab.isCode(e[n]);)c.push(e[n]),n++;const d=[];for(let h=0;h<this.patchesPerFrame;h++){const l=new Float32Array(this.latentDim);for(let u=0;u<this.levels;u++){const m=h*this.levels+u,f=m<c.length?c[m]:-1;if(f<0)continue;const{level:g,code:p}=this.vocab.decodeCode(f);Go(l,this.banks[i][g],p,this.latentDim)}d.push(a?l:dn(o[h],l))}t.push(this.fromPatches(d)),o=d}return t}fit(e,t={}){const o=t.iterations??8,n=new te((t.seed??1718187041)>>>0||1);for(const d of e)this.assertShape(d);const s=[],a=[];for(const d of e){let h=null;for(let l=0;l<d.length;l++){const u=this.toPatches(d[l]);if(h===null||l%this.keyframeInterval===0)for(const f of u)s.push(f);else for(let f=0;f<u.length;f++)a.push(ln(u[f],h[f]));h=u}}this.fitBank(He,s,o,n),this.fitBank(it,a,o,n);let i=0,c=0;for(const d of e){const h=this.decode(this.encode(d));for(let l=0;l<d.length;l++){const u=d[l],m=h[l];for(let f=0;f<u.length;f++){const g=u[f]-m[f];i+=g*g}c+=u.length}}return c>0?i/c:0}fitBank(e,t,o,n){if(t.length===0)return;let s=t.map(a=>Float32Array.from(a));for(let a=0;a<this.levels;a++){const i=qo(s,this.codebookSize,this.latentDim,o,n);this.banks[e][a]=i,s=s.map(c=>{const d=bt(i,c,this.codebookSize,this.latentDim),h=Float32Array.from(c),l=d*this.latentDim;for(let u=0;u<this.latentDim;u++)h[u]=h[u]-i[l+u];return h})}}rvqEncode(e,t){const o=Float32Array.from(t),n=new Float32Array(this.latentDim),s=[];for(let a=0;a<this.levels;a++){const i=this.banks[e][a],c=bt(i,o,this.codebookSize,this.latentDim);s.push(c);const d=c*this.latentDim;for(let h=0;h<this.latentDim;h++)n[h]=n[h]+i[d+h],o[h]=o[h]-i[d+h]}return{codes:s,recon:n}}toPatches(e){const{patch:t,channels:o,width:n}=this,s=this.width/t,a=this.height/t,i=[];for(let c=0;c<a;c++)for(let d=0;d<s;d++){const h=new Float32Array(this.latentDim);for(let l=0;l<t;l++)for(let u=0;u<t;u++){const m=c*t+l,f=d*t+u,g=(m*n+f)*o,p=(l*t+u)*o;for(let _=0;_<o;_++)h[p+_]=e[g+_]}i.push(h)}return i}fromPatches(e){const{patch:t,channels:o,width:n}=this,s=this.width/t,a=new Float32Array(this.height*this.width*o);for(let i=0;i<e.length;i++){const c=Math.floor(i/s),d=i-c*s,h=e[i];for(let l=0;l<t;l++)for(let u=0;u<t;u++){const m=c*t+l,f=d*t+u,g=(m*n+f)*o,p=(l*t+u)*o;for(let _=0;_<o;_++)a[g+_]=Ko(h[p+_])}}return a}assertShape(e){const t=this.height*this.width*this.channels;for(let o=0;o<e.length;o++)if(e[o].length!==t)throw new Error(`VideoRVQCodec: frame ${o} has length ${e[o].length}, expected ${t}`)}}function ln(r,e){const t=new Float32Array(r.length);for(let o=0;o<r.length;o++)t[o]=r[o]-e[o];return t}function dn(r,e){const t=new Float32Array(r.length);for(let o=0;o<r.length;o++)t[o]=r[o]+e[o];return t}function Go(r,e,t,o){const n=t*o;for(let s=0;s<o;s++)r[s]=r[s]+e[n+s]}function Ko(r){return r<0?0:r>1?1:r}function bt(r,e,t,o){let n=0,s=1/0;for(let a=0;a<t;a++){const i=a*o;let c=0;for(let d=0;d<o;d++){const h=e[d]-r[i+d];if(c+=h*h,c>=s)break}c<s&&(s=c,n=a)}return n}function qo(r,e,t,o,n){const s=new Float32Array(e*t);for(let c=0;c<e;c++){const d=r[Math.floor(n.next()*r.length)%r.length];s.set(d,c*t)}const a=new Float32Array(e*t),i=new Int32Array(e);for(let c=0;c<o;c++){a.fill(0),i.fill(0);for(const d of r){const h=bt(s,d,e,t);i[h]=i[h]+1;const l=h*t;for(let u=0;u<t;u++)a[l+u]=a[l+u]+d[u]}for(let d=0;d<e;d++){const h=d*t;if(i[d]===0){const u=r[Math.floor(n.next()*r.length)%r.length];s.set(u,h);continue}const l=1/i[d];for(let u=0;u<t;u++)s[h+u]=a[h+u]*l}}return s}function Vo(){const r=new Map,e=[[33,126],[161,172],[174,255]];let t=0;for(const[o,n]of e)for(let s=o;s<=n;s++)r.set(s,String.fromCodePoint(s));for(let o=0;o<256;o++)r.has(o)||(r.set(o,String.fromCodePoint(256+t)),t++);return r}const qe=Vo(),Xo=new Map([...qe].map(([r,e])=>[e,r])),hn=/(?:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;class je{vocab;idToToken;merges;bosToken;eosToken;padToken;unkToken;bosId;eosId;padId;constructor(){this.vocab=new Map,this.idToToken=new Map,this.merges=new Map,this.bosToken="<|im_start|>",this.eosToken="<|im_end|>",this.padToken="<|endoftext|>",this.unkToken="<unk>",this.bosId=null,this.eosId=null,this.padId=null}async load(e,t){let o;typeof e=="string"?o=await(await fetch(e)).json():o=e,this.vocab=new Map(Object.entries(o).map(([s,a])=>[s,Number(a)])),this.idToToken=new Map([...this.vocab].map(([s,a])=>[a,s]));let n;typeof t=="string"?n=(await(await fetch(t)).text()).split(`
`).filter(i=>i&&!i.startsWith("#")):n=t,this.merges=new Map,n.forEach((s,a)=>{this.merges.set(s.trim(),a)}),this.bosId=this.vocab.get(this.bosToken)??null,this.eosId=this.vocab.get(this.eosToken)??null,this.padId=this.vocab.get(this.padToken)??null}train(e,t={}){const o=t.numMerges??200,n=t.minPairFreq??2,s=Array.isArray(e)?e:[e],a=new Map;for(const l of s)for(const u of l.match(hn)??[]){const m=new TextEncoder().encode(u),f=Array.from(m).map(g=>qe.get(g)??"?").join("");a.set(f,(a.get(f)??0)+1)}const i=[...a].map(([l,u])=>({syms:[...l],freq:u})),c=[];for(let l=0;l<o;l++){const u=new Map;for(const{syms:w,freq:y}of i)for(let x=0;x<w.length-1;x++){const E=w[x]+" "+w[x+1];u.set(E,(u.get(E)??0)+y)}let m="",f=0;for(const[w,y]of u)y>f&&(m=w,f=y);if(f<n)break;c.push(m);const g=m.indexOf(" "),p=m.slice(0,g),_=m.slice(g+1),b=p+_;for(const w of i){const y=[];for(let x=0;x<w.syms.length;x++)x<w.syms.length-1&&w.syms[x]===p&&w.syms[x+1]===_?(y.push(b),x++):y.push(w.syms[x]);w.syms=y}}const d={};let h=0;for(const l of[this.unkToken,this.bosToken,this.eosToken,this.padToken])l in d||(d[l]=h++);for(const l of qe.values())l in d||(d[l]=h++);for(const l of c){const u=l.split(" ").join("");u in d||(d[u]=h++)}this.loadFromObjects(d,c)}loadFromObjects(e,t){this.vocab=new Map(Object.entries(e).map(([o,n])=>[o,Number(n)])),this.idToToken=new Map([...this.vocab].map(([o,n])=>[n,o])),this.merges=new Map(t.map((o,n)=>[o,n])),this.bosId=this.vocab.get(this.bosToken)??null,this.eosId=this.vocab.get(this.eosToken)??null,this.padId=this.vocab.get(this.padToken)??null}loadHuggingFace(e,t={}){const o=e.model??e,n=o.vocab??e.vocab,s=o.merges??e.merges;if(!n||typeof n!="object")throw new Error("loadHuggingFace: missing model.vocab (expected a Hugging Face tokenizer.json)");if(!Array.isArray(s))throw new Error("loadHuggingFace: missing model.merges (expected a BPE tokenizer.json)");const a=s.map(i=>Array.isArray(i)?`${i[0]} ${i[1]}`:String(i));t.bos&&(this.bosToken=t.bos),t.eos&&(this.eosToken=t.eos),t.pad&&(this.padToken=t.pad),t.unk&&(this.unkToken=t.unk),this.loadFromObjects(n,a)}toObject(){return{vocab:Object.fromEntries(this.vocab),merges:[...this.merges.entries()].sort((e,t)=>e[1]-t[1]).map(([e])=>e),specials:{bos:this.bosToken,eos:this.eosToken,pad:this.padToken,unk:this.unkToken}}}loadFromSpec(e){const t=e.specials;t?.bos&&(this.bosToken=t.bos),t?.eos&&(this.eosToken=t.eos),t?.pad&&(this.padToken=t.pad),t?.unk&&(this.unkToken=t.unk),this.loadFromObjects(e.vocab,e.merges)}serialize(){const e=new TextEncoder().encode(JSON.stringify(this.toObject())),t=new ArrayBuffer(e.byteLength);return new Uint8Array(t).set(e),t}static deserialize(e){const t=JSON.parse(new TextDecoder().decode(new Uint8Array(e)));if(!t||typeof t.vocab!="object"||!Array.isArray(t.merges))throw new Error("BPETokenizer.deserialize: not a serialised BPE tokenizer (expected { vocab, merges })");const o=new je;return o.loadFromSpec(t),o}async loadHuggingFaceUrl(e,t={}){const o=await fetch(e);if(!o.ok)throw new Error(`loadHuggingFaceUrl: ${o.status} fetching ${e}`);const n=await o.json();this.loadHuggingFace(n,t)}encode(e,t={}){const o=e.match(hn)??[],n=[];t.addBos&&this.bosId!==null&&n.push(this.bosId);for(const s of o){const a=new TextEncoder().encode(s),i=Array.from(a).map(d=>qe.get(d)??"?").join(""),c=this._bpe(i);for(const d of c){const h=this.vocab.get(d);if(h!==void 0)n.push(h);else for(const l of d){const u=this.vocab.get(l);u!==void 0&&n.push(u)}}}return t.addEos&&this.eosId!==null&&n.push(this.eosId),n}decode(e){let t="";for(const n of e){const s=this.idToToken.get(n);s!==void 0&&(t+=s)}const o=new Uint8Array([...t].map(n=>Xo.get(n)??n.codePointAt(0)??0));try{return new TextDecoder("utf-8").decode(o)}catch{return t}}_bpe(e){if(this.vocab.has(e))return[e];let t=[...e];for(;t.length>1;){let o=1/0,n=-1;for(let a=0;a<t.length-1;a++){const i=t[a]+" "+t[a+1],c=this.merges.get(i);c!==void 0&&c<o&&(o=c,n=a)}if(n===-1)break;const s=t[n]+t[n+1];t=[...t.slice(0,n),s,...t.slice(n+2)]}return t}padOrTruncate(e,t,o="right"){if(e.length>=t)return e.slice(0,t);const n=this.padId??0,s=new Array(t-e.length).fill(n);return o==="right"?[...e,...s]:[...s,...e]}get vocabSize(){return this.vocab.size}}const un=32768;function Pt(r){const e=r instanceof Uint8Array?r:new Uint8Array(r);let t="";for(let o=0;o<e.length;o+=un)t+=String.fromCharCode.apply(null,Array.from(e.subarray(o,o+un)));return btoa(t)}function We(r){const e=atob(r),t=new Uint8Array(e.length);for(let o=0;o<e.length;o++)t[o]=e.charCodeAt(o);return t.buffer}const er=/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;function tr(r){const e=new ArrayBuffer(r.length*4);return new Float32Array(e).set(Array.from(r)),Ie(e)}function nr(r){const e=se(r);if(!e.ok)throw new Error("headParams: checkpoint failed its CRC check");if(e.body.byteLength%4!==0)throw new Error("headParams: checkpoint is not f32");return new Float32Array(e.body)}function Yo(r){if(!r||typeof r.task!="string"||typeof r.engine!="string")return"task and engine are required";if(!Number.isInteger(r.version)||r.version<0)return"version must be a non-negative integer";try{const e=se(We(r.params));if(!e.hasTrailer||!e.ok)return"params checkpoint failed its CRC check";if(e.body.byteLength%4!==0)return"params checkpoint is not f32"}catch{return"params is not base64"}return null}const fn=1163283761,Ee=12,Qo=1;function ie(r){let e=2166136261;for(let t=0;t<r.length;t++)e^=r[t],e=Math.imul(e,16777619);return e>>>0}class J{manifest;checkpoint;codec;tokenizer;constructor(e,t,o,n){this.manifest=e,this.checkpoint=t,this.codec=o,this.tokenizer=n}static _tokenizerSection(e,t){if(!e.tokenizer)return{fields:{}};const o=e.tokenizer.vocabSize;if(t!=null&&o!==t)throw new Error(`EvermindModelPackage: tokenizer vocabSize (${o}) must equal the model's (${t}) — a mismatched pair decodes to nonsense.`);const n=e.tokenizer.serialize();return{blob:n,fields:{tokenizerFormat:"BPE0",tokenizerBytes:n.byteLength,tokenizerChecksum:ie(new Uint8Array(n)),tokenizerVocabSize:o}}}static fromModel(e,t){const o=t.fp16??!1,n=e.exportWeights({fp16:o}),s=J._tokenizerSection(t,void 0),a={schema:"evermind.model/1",name:t.name,version:t.version,modelType:"shared-expert-moe",config:e.config,paramCount:e.parameters().reduce((i,c)=>i+c.numel,0),checkpointFormat:"MoE0",checkpointFp16:o,...s.blob?{checkpointBytes:n.byteLength}:{},checksum:ie(new Uint8Array(n)),...s.fields,card:t.card,...t.createdAt?{createdAt:t.createdAt}:{}};return new J(a,n,void 0,s.blob)}static fromLM(e,t){const o=t.fp16??!1,n=e.exportWeights({fp16:o}),s=J._tokenizerSection(t,e.config.vocabSize),a={schema:"evermind.model/1",name:t.name,version:t.version,modelType:"evermind-lm",config:e.config,paramCount:e.parameters().reduce((i,c)=>i+c.data.length,0),checkpointFormat:"EVL0",checkpointFp16:o,...s.blob?{checkpointBytes:n.byteLength}:{},checksum:ie(new Uint8Array(n)),...s.fields,card:t.card,...t.createdAt?{createdAt:t.createdAt}:{}};return new J(a,n,void 0,s.blob)}static fromMediaLM(e,t,o){if(e.config.vocabSize!==t.vocabSize)throw new Error(`fromMediaLM: LM vocabSize (${e.config.vocabSize}) must equal codec.vocabSize (${t.vocabSize})`);const n=o.fp16??!1,s=e.exportWeights({fp16:n}),a=t.serialize(),i=J._tokenizerSection(o,e.config.vocabSize),c={schema:"evermind.model/1",name:o.name,version:o.version,modelType:"evermind-lm",modality:o.modality,config:e.config,paramCount:e.parameters().reduce((d,h)=>d+h.data.length,0),checkpointFormat:"EVL0",checkpointFp16:n,checkpointBytes:s.byteLength,checksum:ie(new Uint8Array(s)),codecFormat:"VRQ0",...i.blob?{codecBytes:a.byteLength}:{},codecChecksum:ie(new Uint8Array(a)),...i.fields,card:o.card,...o.createdAt?{createdAt:o.createdAt}:{}};return new J(c,s,a,i.blob)}toBlob(){const e=new TextEncoder().encode(JSON.stringify(this.manifest)),t=Ee,o=this.codec?.byteLength??0,n=this.tokenizer?.byteLength??0,s=new ArrayBuffer(t+e.byteLength+this.checkpoint.byteLength+o+n),a=new Uint32Array(s,0,3);a[0]=fn,a[1]=Qo,a[2]=e.byteLength;let i=t;return new Uint8Array(s,i,e.byteLength).set(e),i+=e.byteLength,new Uint8Array(s,i,this.checkpoint.byteLength).set(new Uint8Array(this.checkpoint)),i+=this.checkpoint.byteLength,this.codec&&(new Uint8Array(s,i,o).set(new Uint8Array(this.codec)),i+=o),this.tokenizer&&new Uint8Array(s,i,n).set(new Uint8Array(this.tokenizer)),s}withCheckpoint(e,t=this.manifest.version){const o={...this.manifest,version:t,...this.manifest.checkpointBytes!==void 0?{checkpointBytes:e.byteLength}:{},checksum:ie(new Uint8Array(e))};return new J(o,e,this.codec,this.tokenizer)}withMlHeads(e){const t={...this.manifest};return delete t.mlHeads,e.length&&(t.mlHeads=[...e]),new J(t,this.checkpoint,this.codec,this.tokenizer)}static manifestEnd(e){if(e.byteLength<Ee)throw new Error("EvermindModelPackage: truncated (no header)");const t=new Uint32Array(e,0,3);if(t[0]!==fn)throw new Error("EvermindModelPackage: bad magic (not an .evermind package)");return Ee+t[2]}static readManifest(e){const t=J.manifestEnd(e);if(t>e.byteLength)throw new Error("EvermindModelPackage: truncated (manifest length exceeds blob)");const o=new Uint8Array(e,Ee,t-Ee);return JSON.parse(new TextDecoder().decode(o))}static fromBlob(e){const t=J.readManifest(e),o=J.manifestEnd(e),n=t.checkpointBytes;if(n==null)return new J(t,e.slice(o));if(o+n>e.byteLength)throw new Error("EvermindModelPackage.fromBlob: truncated (checkpointBytes exceeds blob)");const s=e.slice(o,o+n);let a=o+n;const i=t.tokenizerBytes??0;if(a+i>e.byteLength)throw new Error("EvermindModelPackage.fromBlob: truncated (tokenizerBytes exceeds blob)");const c=e.byteLength-i;let d;if(a<c){const l=t.codecBytes!=null?a+t.codecBytes:c;if(l>c)throw new Error("EvermindModelPackage.fromBlob: truncated (codecBytes overruns the tokenizer section)");d=e.slice(a,l),a=l}const h=i>0?e.slice(c):void 0;return new J(t,s,d,h)}validate(){const e=[];this.manifest.schema!=="evermind.model/1"&&e.push(`unknown schema: ${this.manifest.schema}`);const t=this.manifest.config;this.manifest.modelType==="shared-expert-moe"?(!t||t.modelDim<=0||t.hiddenDim<=0||t.numExperts<=0||t.topK<1||t.topK>t.numExperts)&&e.push("invalid config"):this.manifest.modelType==="evermind-lm"?(!t||t.vocabSize<=0||t.dModel<=0||t.numLayers<=0||t.numExperts<=0||t.topK<1||t.topK>t.numExperts)&&e.push("invalid config"):e.push(`unsupported modelType: ${String(this.manifest.modelType)}`);const o=ie(new Uint8Array(this.checkpoint));o!==this.manifest.checksum&&e.push(`checksum mismatch (manifest ${this.manifest.checksum}, actual ${o}) — corrupt or tampered checkpoint`);const n=this.manifest.modality??"text";if(n==="video"||n==="image")if(!this.codec)e.push(`modality '${n}' package is missing its codec section`);else{const s=ie(new Uint8Array(this.codec));s!==this.manifest.codecChecksum&&e.push(`codec checksum mismatch (manifest ${this.manifest.codecChecksum}, actual ${s}) — corrupt codec`)}if(this.manifest.tokenizerFormat)if(!this.tokenizer)e.push("manifest declares an embedded tokenizer but the package has no tokenizer section");else{const s=ie(new Uint8Array(this.tokenizer));s!==this.manifest.tokenizerChecksum&&e.push(`tokenizer checksum mismatch (manifest ${this.manifest.tokenizerChecksum}, actual ${s}) - corrupt tokenizer`);const a=this.manifest.config?.vocabSize,i=this.manifest.tokenizerVocabSize;a!=null&&i!=null&&a!==i&&e.push(`tokenizer vocabSize (${i}) does not match the model's (${a})`)}for(const s of this.manifest.mlHeads??[]){const a=Yo(s);a&&e.push(`ml head '${String(s?.task)}': ${a}`)}return new Set((this.manifest.mlHeads??[]).map(s=>s.task)).size!==(this.manifest.mlHeads??[]).length&&e.push("ml heads: a task appears more than once"),{ok:e.length===0,errors:e}}loadTokenizer(){if(!this.manifest.tokenizerFormat||!this.tokenizer)return null;const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadTokenizer: ${e.errors.join("; ")}`);return je.deserialize(this.tokenizer)}loadModel(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadModel: ${e.errors.join("; ")}`);if(this.manifest.modelType!=="shared-expert-moe")throw new Error(`loadModel: package is '${this.manifest.modelType}', use loadLM()`);const t=new Kn(this.manifest.config);return t.loadWeights(this.checkpoint),t}loadLM(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadLM: ${e.errors.join("; ")}`);if(this.manifest.modelType!=="evermind-lm")throw new Error(`loadLM: package is '${this.manifest.modelType}', use loadModel()`);const t=new nt(this.manifest.config);return t.loadWeights(this.checkpoint),t}loadMediaLM(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadMediaLM: ${e.errors.join("; ")}`);const t=this.manifest.modality??"text";if(t!=="video"&&t!=="image")throw new Error(`loadMediaLM: package modality is '${t}', use loadLM()`);return{lm:this.loadLM(),codec:rt.deserialize(this.codec),modality:t}}}const Jo=Math.LN2;function Zo(r,e){const t=r.length,o=Math.max(1,Math.min(e,t)),n=[],s=new Uint8Array(t);for(let a=0;a<o;a++){let i=-1,c=-1/0;for(let d=0;d<t;d++){if(s[d])continue;const h=r[d];h>c&&(c=h,i=d)}if(i<0)break;s[i]=1,n.push(i)}return n}function es(r){let e=0,t=-1/0;for(let o=0;o<r.length;o++)r[o]>t&&(t=r[o],e=o);return e}function ts(r){return Math.exp(r)}function ns(r){return r/Jo}function rr(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function or(r,e,t,o){const n=Math.min(e.length,t.length);for(let s=0;s<n;s++){const a=t[s],i=e[s];a<0||a>=i.length||(r.ceSum+=Ae(i,a),es(i)===a&&r.top1Hits++,Zo(i,o).includes(a)&&r.topKHits++,r.tokens++)}}function $t(){const r=globalThis;return typeof r.performance?.now=="function"?r.performance.now():Date.now()}function sr(r){return r.slice(1)}function ar(r,e,t,o){const n=r.tokens>0?r.ceSum/r.tokens:0,s={sequences:e,tokens:r.tokens,crossEntropy:n,perplexity:ts(n),bitsPerToken:ns(n),top1Accuracy:r.tokens>0?r.top1Hits/r.tokens:0,topKAccuracy:r.tokens>0?r.topKHits/r.tokens:0,topK:t};return o!==void 0&&(s.elapsedMs=o,s.tokensPerSecond=o>0?r.tokens/o*1e3:0),s}function Ve(r,e,t={}){const o=t.topK??5,n=t.measureLatency??!0,s=t.now??$t,a=rr();let i=0,c=0;for(const d of e){if(d.length<2)continue;const h=n?s():0,{logits:l}=r.forward(d);n&&(c+=s()-h),or(a,l,sr(d),o),i++}return ar(a,i,o,n?c:void 0)}async function Rc(r,e,t={}){const o=t.topK??5,n=t.measureLatency??!0,s=t.now??$t,a=rr();let i=0,c=0;for(const d of e){if(d.length<2)continue;const h=n?s():0,{logits:l}=await r.forward(d);n&&(c+=s()-h),or(a,l,sr(d),o),i++}return ar(a,i,o,n?c:void 0)}function Oc(r,e,t,o={}){return rs(Ve(r,t,o),Ve(e,t,o))}function rs(r,e){const t=r.perplexity-e.perplexity,o=e.perplexity>0?r.perplexity/e.perplexity:1/0,n=r.top1Accuracy-e.top1Accuracy,s=.005;let a;Math.abs(o-1)<=s?a="tie":a=t<0?"candidate":"baseline";const i=((1-o)*100).toFixed(1),c=a==="tie"?`Tie: perplexity ${r.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)}`:a==="candidate"?`Candidate wins: ${i}% lower perplexity (${r.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(i)).toFixed(1)}% higher perplexity (${r.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`;return{candidate:r,baseline:e,perplexityDelta:t,perplexityRatio:o,top1Delta:n,winner:a,summary:c}}function ir(r,e){return r.split(/(?<=\.)\s+/).map(t=>e.encode(t.trim())).filter(t=>t.length>=2)}function Uc(r,e,t,o={}){return Ve(r,ir(t,e),o)}function os(r,e){for(let t=r.length-1;t>0;t--){const o=Math.floor(e.next()*(t+1)),n=r[t];r[t]=r[o],r[o]=n}return r}function Hc(r,e={}){const t=e.seed??7,o=new je;o.train(r,{numMerges:e.numMerges??100});const n=ir(r,o);if(n.length<2)throw new Error(`corpus produced ${n.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const s=os([...n],new te(t>>>0||1)),a=Math.min(.9,Math.max(.05,e.heldOutRatio??.25));let i=Math.round(s.length*a);i=Math.max(1,Math.min(s.length-1,i));const c=s.slice(0,i),d=s.slice(i),h=new nt({vocabSize:o.vocabSize,dModel:e.dModel??32,numLayers:e.numLayers??2,hiddenDim:e.hiddenDim??48,seed:t}),l=e.epochs??30,u=new Nt(h,{lr:e.lr??.03,epochs:l}).fit(d),m=Ve(h,c,{topK:e.topK??5,measureLatency:!0}),f=h.generateText(e.prompt??"The",o,{maxNewTokens:8,temperature:0});return{...m,trainSequences:d.length,evalSequences:c.length,initialTrainLoss:u[0]??0,finalTrainLoss:u.at(-1)??0,vocabSize:o.vocabSize,sample:f}}function cr(r,e){const t=[],o=Math.max(1,Math.floor(e));for(let n=0;n+1<r.length;n+=o){const s=r.slice(n,n+o);s.length>=2&&t.push(s)}return t}function ss(r,e){const t=Math.min(1,Math.max(0,e));return Math.round(r*(1-t))}const as=["The planning loop retrieves context before generating a response.","Agents recall facts from the memory layer and act on them.","Deployment runs on Cloudflare Workers and Durable Objects.","Tools are gated by a capability registry and a policy pack.","The coordinator merges weight deltas from every contributing host.","A ticket moves through triage, execution, review and merge.","Recall is ranked by embedding cosine fused with lexical scoring.","The trainer adapts a private copy of the base checkpoint locally."].join(" ");function is(r){let e=0;for(const t of r.parameters())e+=t.data.length;return e}function Gc(r={}){const e=r.text??as,t=r.windowTokens??[32,64,128],o=r.epochs??[1,2,4],n=r.skipRates??[0,.5],s=Math.max(1,r.requests??4),a=r.dModel??32,i=r.numLayers??2,c=r.hiddenDim??48,d=r.seed??7,h=r.lr??.01,l=r.now??$t,u=new je;u.train(e,{numMerges:r.numMerges??120});const m=u.encode(e),f=()=>new nt({vocabSize:u.vocabSize,dModel:a,numLayers:i,hiddenDim:c,seed:d}),g=[];for(const p of t){const _=cr(m,p);for(const b of o)for(const w of n){const y=ss(s,w),x=f();x.resetStats();const E=l();for(let B=0;B<y;B++)new Nt(x,{lr:h,epochs:b,accumSteps:1}).fit(_);const L=l()-E,k=x.positionsEvaluated,D=_.length*y;g.push({windowTokens:p,epochs:b,skipRate:w,requests:s,adapted:y,sequences:D,optimizerSteps:D*b,positionsEvaluated:k,elapsedMs:L,msPerKPosition:k>0?L/k*1e3:0,msPerAdaptation:y>0?L/y:0})}}return{points:g,textTokens:m.length,vocabSize:u.vocabSize,dModel:a,numLayers:i,hiddenDim:c,paramCount:is(f())}}function Kc(r){const e=`Evermind adaptation cost — dModel=${r.dModel} layers=${r.numLayers} hidden=${r.hiddenDim} params=${r.paramCount.toLocaleString()} vocab=${r.vocabSize} textTokens=${r.textTokens}`,t=["window","epochs","skip","adapts","seqs","steps","positions","ms","ms/adapt","ms/1k pos"],o=r.points.map(a=>[String(a.windowTokens),String(a.epochs),a.skipRate.toFixed(2),`${a.adapted}/${a.requests}`,String(a.sequences),String(a.optimizerSteps),String(a.positionsEvaluated),a.elapsedMs.toFixed(1),a.msPerAdaptation.toFixed(1),a.msPerKPosition.toFixed(3)]),n=t.map((a,i)=>Math.max(a.length,...o.map(c=>c[i].length))),s=a=>a.map((i,c)=>i.padStart(n[c])).join("  ");return[e,"",s(t),s(n.map(a=>"-".repeat(a))),...o.map(s)].join(`
`)}const cs=4e3,ls=64;function ds(r,e,t,o={}){const n=o.maxChars??cs,s=o.windowTokens??ls,a=cr(e.encode(t.slice(0,n)),s);if(a.length===0)return null;const i=o.lm??r.loadLM(),c=new Nt(i,{epochs:o.epochs??1}).fit(a),d=c.length>0?c[c.length-1]:0;return{diff:Jn(r.checkpoint,i.exportWeights()),loss:d,sequences:a.length}}function qc(r,e,t,o,n={}){const s=ds(r,e,t,n);return s?{pkg:r.withCheckpoint(Zn(r.checkpoint,s.diff),o),loss:s.loss,sequences:s.sequences}:null}const mn=8*1024*1024,lr=800,dr=new RegExp(`^ml:${er.source.slice(1)}`);function hr(r){return`ml:${r}`}function ur(r,e){return r===e?null:`target ${r??"(model)"} does not belong here; this door merges into ${e??"the model checkpoint"}`}const hs=/^[A-Za-z0-9+/]+={0,2}$/;function Vc(r,e={}){const t=r&&typeof r=="object"?r:{},o=typeof t.diff=="string"?t.diff:"",n=typeof t.baseVersion=="number"?t.baseVersion:Number.NaN;if(!o||!Number.isInteger(n))return{ok:!1,reason:"invalid",error:"diff (base64) and baseVersion (integer head version the delta was taken against) are required"};if(o.length>mn)return{ok:!1,reason:"too-large",error:`delta too large (max ${mn} base64 characters)`};if(o.length%4!==0||!hs.test(o))return{ok:!1,reason:"invalid",error:"diff must be standard base64"};const s=typeof t.weight=="number"&&Number.isFinite(t.weight)&&t.weight>0?t.weight:void 0,a=typeof t.label=="string"&&t.label.trim()?t.label.trim().slice(0,lr):void 0;if(t.target!==void 0&&(typeof t.target!="string"||!dr.test(t.target)))return{ok:!1,reason:"invalid",error:"target, when present, must be ml:<task id>"};const i=t.target,c=ur(i,e.target);return c?{ok:!1,reason:"invalid",error:c}:{ok:!0,payload:{diff:o,baseVersion:n,...s!==void 0?{weight:s}:{},...a?{label:a}:{},...i?{target:i}:{}}}}function us(r,e,t,o,n){const s=(o??"").trim();if(n!==void 0&&!dr.test(n))throw new Error(`buildDeltaLearnPayload: bad target '${n}'`);return{diff:Pt(r),baseVersion:e,...typeof t=="number"&&Number.isFinite(t)&&t>0?{weight:t}:{},...s?{label:s.slice(0,lr)}:{},...n?{target:n}:{}}}function fs(r){return We(r.diff)}function ms(r,e){try{const t=tt(r);if(t.rowSize!==1)return`expected an element-granular delta (rowSize 1), got ${t.rowSize}`;const o=se(e).body.byteLength/4;for(let n=0;n<t.rows.length;n++){const s=t.rows[n];if(!Number.isInteger(s)||s<0||s>=o)return`row index ${s} is outside the base checkpoint (${o} elements)`;if(!Number.isFinite(t.data[n]))return`non-finite value at row ${s}`}return null}catch(t){return`not a serialized RowDelta: ${t instanceof Error?t.message:String(t)}`}}function gs(r,e,t){if(e.length===0)return{checkpoint:r,mergedRows:0,contributors:0,deltaNorm:0};if(t&&t.length!==e.length)throw new Error(`mergeCheckpointDiffs: weights length ${t.length} != diffs length ${e.length}`);const o=e.map(l=>tt(l));for(const l of o)if(l.rowSize!==1)throw new Error(`mergeCheckpointDiffs: expected element-granular deltas (rowSize 1), got ${l.rowSize}`);const n=new Map;if(o.forEach((l,u)=>{const m=t?t[u]:1;m>0&&l.rows.forEach((f,g)=>{const p=l.data[g],_=n.get(f);_?(_.sum+=m*p,_.weight+=m):n.set(f,{sum:m*p,weight:m})})}),n.size===0)return{checkpoint:r,mergedRows:0,contributors:o.length,deltaNorm:0};const s=[...n.keys()].sort((l,u)=>l-u),a=new Float32Array(s.length);s.forEach((l,u)=>{const m=n.get(l);a[u]=m.sum/m.weight});const i=new Float32Array(se(r).body);let c=0;return s.forEach((l,u)=>{const m=a[u]-(i[l]??0);c+=m*m}),{checkpoint:Zn(r,Tt({rowSize:1,rows:s,data:a})),mergedRows:s.length,contributors:o.length,deltaNorm:Math.sqrt(c)}}function ps(r,e,t,o,n={}){const s=gs(r,e,t),a=(h,l,u)=>({...s,checkpoint:r,deltaNorm:0,accepted:!1,baseLoss:l,newLoss:u,refusedReason:h});if(s.mergedRows===0)return a("nothing-merged",null,null);const i=h=>h!=null&&Number.isFinite(h)?h:null,c=i(o(r)),d=i(o(s.checkpoint));return c==null||d==null?n.requireEval?a("unscored",c,d):{...s,accepted:!0,baseLoss:c,newLoss:d}:d>c+(n.tolerance??0)?a("regressed",c,d):{...s,accepted:!0,baseLoss:c,newLoss:d}}const _s=128;function bs(r,e){if(e.length<2)return null;const{logits:t}=r.forward(e),o=Math.min(t.length,e.length)-1;if(o<1)return null;let n=0;for(let a=0;a<o;a++)n+=Ae(t[a],e[a+1]);const s=n/o;return Number.isFinite(s)&&s>=0?s:null}function Xc(r,e,t,o=_s){let n=0,s=0;for(const a of t){const i=(a.prompt?`${a.prompt}
`:"")+a.text,c=bs(r,e.encode(i).slice(0,o));c!=null&&(n+=c,s++)}return s>0?n/s:null}class Yc{model;codec;dimensions;fingerprint;constructor(e,t,o){this.model=e,this.codec=t,this.dimensions=e.config.dModel,this.fingerprint=o??ws(e)}async embed(e){return this.embedSync(e)}embedSync(e){return this.model.embedText(e,this.codec)}}function ws(r){const e=r.config,t=new Uint8Array(r.emb.buffer,r.emb.byteOffset,r.emb.byteLength);return`evermind-lm/${[e.vocabSize,e.dModel,e.numLayers,e.convKernel,e.hiddenDim,e.numExperts,e.topK].join("-")}/${Dt(t).toString(16)}`}const gn=1280266817;class Ce{rows;cols;rank;alpha;scale;B;A;gB;gA;constructor(e,t,o={}){if(e<=0||t<=0)throw new Error("LoRAAdapter: rows and cols must be > 0");const n=o.rank??8;if(n<=0||n>Math.min(e,t))throw new Error(`LoRAAdapter: rank must be in [1, min(rows,cols)=${Math.min(e,t)}]`);this.rows=e,this.cols=t,this.rank=n,this.alpha=o.alpha??n,this.scale=this.alpha/n,this.B=new Float32Array(e*n),this.A=new Float32Array(n*t);const s=new te((o.seed??1282363969)>>>0||1),a=1/Math.sqrt(t);for(let i=0;i<this.A.length;i++){const c=Math.max(s.next(),1e-12),d=s.next();this.A[i]=a*Math.sqrt(-2*Math.log(c))*Math.cos(2*Math.PI*d)}this.gB=new Float32Array(this.B.length),this.gA=new Float32Array(this.A.length)}numParams(){return this.B.length+this.A.length}delta(){const{rows:e,cols:t,rank:o,scale:n}=this,s=new Float32Array(e*t);for(let a=0;a<e;a++){const i=a*o,c=a*t;for(let d=0;d<o;d++){const h=this.B[i+d]*n;if(h===0)continue;const l=d*t;for(let u=0;u<t;u++)s[c+u]=s[c+u]+h*this.A[l+u]}}return s}applyTo(e){if(e.length!==this.rows*this.cols)throw new Error("LoRAAdapter.applyTo: base length mismatch");const t=this.delta(),o=new Float32Array(e.length);for(let n=0;n<o.length;n++)o[n]=e[n]+t[n];return o}accumulateGradient(e){const{rows:t,cols:o,rank:n,scale:s}=this;if(e.length!==t*o)throw new Error("LoRAAdapter.accumulateGradient: gW length mismatch");for(let a=0;a<t;a++){const i=a*o,c=a*n;for(let d=0;d<n;d++){const h=d*o;let l=0;const u=this.B[c+d]*s;for(let m=0;m<o;m++){const f=e[i+m];l+=f*this.A[h+m],this.gA[h+m]=this.gA[h+m]+u*f}this.gB[c+d]=this.gB[c+d]+s*l}}}parameters(){return[{data:this.B},{data:this.A}]}gradients(){return[{data:this.gB},{data:this.gA}]}zeroGrad(){this.gB.fill(0),this.gA.fill(0)}serialize(){const o=new ArrayBuffer(20+(this.B.length+this.A.length)*4),n=new Uint32Array(o,0,5);n[0]=gn,n[1]=this.rows,n[2]=this.cols,n[3]=this.rank,new Float32Array(o,16,1)[0]=this.alpha;const s=new Float32Array(o,20);return s.set(this.B,0),s.set(this.A,this.B.length),o}static deserialize(e){const t=new Uint32Array(e,0,5);if(t[0]!==gn)throw new Error("LoRAAdapter.deserialize: bad magic");const o=t[1],n=t[2],s=t[3],a=new Float32Array(e,16,1)[0],i=new Ce(o,n,{rank:s,alpha:a}),c=new Float32Array(e,20);return i.B.set(c.subarray(0,i.B.length)),i.A.set(c.subarray(i.B.length,i.B.length+i.A.length)),i}}function ys(r,e){switch(e){case"none":return{view:r,bytes:r.length*4};case"fp16":{const t=Pe(r);return{view:$e(t),bytes:t.length*2}}case"int8":{const t=Ao(r);return{view:Mo(t.data,t.scale),bytes:t.data.length+4}}}}class fr{model;adapter;baseQuant;frozenBase;baseBytesStored;rows;cols;constructor(e,t={}){this.model=e,this.rows=e.config.vocabSize,this.cols=e.config.dModel,this.baseQuant=t.baseQuant??"none";const{view:o,bytes:n}=ys(Float32Array.from(e.emb),this.baseQuant);this.frozenBase=o,this.baseBytesStored=n,this.adapter=new Ce(this.rows,this.cols,t)}get baseModel(){return this.model}mergedEmb(){return this.adapter.applyTo(this.frozenBase)}_accumulate(e){const t=this.mergedEmb(),o=this.model.emb;this.model.emb=t,this.model.zeroGrad();const n=this.model.lossAndBackward(e),s=this.model.gradients()[0].data;return this.adapter.accumulateGradient(s),this.model.emb=o,n}fit(e,t={}){const o=t.epochs??1,n=Math.max(1,t.accumSteps??1),s=new Bt(this.adapter,t),a=this.adapter.gradients(),i=[];for(let c=0;c<o;c++){let d=0,h=0,l=0;this.adapter.zeroGrad();const u=()=>{if(l!==0){if(l!==1)for(const m of a)for(let f=0;f<m.data.length;f++)m.data[f]=m.data[f]/l;s.step(),this.adapter.zeroGrad(),l=0}};for(const m of e)m.length<2||(d+=this._accumulate(m),h++,++l>=n&&u());u(),i.push(h>0?d/h:0)}return i}generate(e,t){const o=this.model.emb;this.model.emb=this.mergedEmb();try{return this.model.generate(e,t)}finally{this.model.emb=o}}generateText(e,t,o){return t.decode(this.generate(t.encode(e),o))}serializeAdapter(){return this.adapter.serialize()}static loadAdapter(e,t,o="none"){const n=Ce.deserialize(t),s=new fr(e,{rank:n.rank,alpha:n.alpha,baseQuant:o});return s.adapter.B.set(n.B),s.adapter.A.set(n.A),s}merge(e={}){return this.model.emb.set(this.mergedEmb()),this.model.exportWeights(e)}footprint(){return{adapterBytes:this.adapter.serialize().byteLength,baseBytes:this.baseBytesStored,trainableParams:this.adapter.numParams(),baseParams:this.rows*this.cols}}}const It=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],mr=-10,gr=5;function vs(r){const{dModel:e,dState:t,dConv:o,dInner:n,dtRank:s}=r;return{wInProj:new Float32Array(2*n*e),bInProj:new Float32Array(2*n),wConv:new Float32Array(n*o),bConv:new Float32Array(n),wXProj:new Float32Array((s+2*t)*n),bXProj:new Float32Array(s+2*t),wDtProj:new Float32Array(n*s),bDtProj:new Float32Array(n),A_log:new Float32Array(n*t),D_vec:new Float32Array(n),wOutProj:new Float32Array(e*n),bOutProj:new Float32Array(e),normWeight:new Float32Array(e)}}function pr(r,e,t){const{dModel:o,dState:n,dConv:s,dInner:a,dtRank:i,batch:c,seqLen:d}=t,h=c*d,l=i+2*n,u=new Float32Array(h*o),m=new Float32Array(h);Hn(r,e.normWeight,h,o,u,m);const f=new Float32Array(h*2*a);Se(u,e.wInProj,e.bInProj,h,o,2*a,f);const g=new Float32Array(h*a),p=new Float32Array(h*a);for(let v=0;v<h;v++)for(let A=0;A<a;A++)g[v*a+A]=f[v*2*a+A],p[v*a+A]=f[v*2*a+a+A];const _=new Float32Array(h*a);for(let v=0;v<c;v++)for(let A=0;A<d;A++){const S=(v*d+A)*a;for(let R=0;R<a;R++){let q=e.bConv[R];for(let P=0;P<s;P++)A>=P&&(q+=e.wConv[R*s+P]*g[(v*d+A-P)*a+R]);_[S+R]=q}}const b=new Float32Array(h*a);for(let v=0;v<h*a;v++)b[v]=Jt(_[v]);const w=new Float32Array(h*l);Se(b,e.wXProj,e.bXProj,h,a,l,w);const y=new Float32Array(h*i),x=new Float32Array(h*n),E=new Float32Array(h*n);for(let v=0;v<h;v++){for(let A=0;A<i;A++)y[v*i+A]=w[v*l+A];for(let A=0;A<n;A++)x[v*n+A]=w[v*l+i+A],E[v*n+A]=w[v*l+i+n+A]}const L=new Float32Array(h*a);Se(y,e.wDtProj,e.bDtProj,h,i,a,L);const k=new Float32Array(h*a);for(let v=0;v<h*a;v++)k[v]=Co(L[v]);const D=new Float32Array(a*n);for(let v=0;v<a*n;v++)D[v]=-Math.exp(Math.min(gr,Math.max(mr,e.A_log[v])));const B=new Float32Array(h*a*n),O=new Float32Array(h*a*n),W=new Float32Array(h*a*n),G=new Float32Array(h*a);for(let v=0;v<c;v++)for(let A=0;A<d;A++){const S=v*d+A;for(let R=0;R<a;R++){const q=k[S*a+R],P=b[S*a+R];let N=e.D_vec[R]*P;for(let C=0;C<n;C++){const K=D[R*n+C],Z=Math.exp(q*K),V=(Z-1)/K*x[S*n+C],X=(S*a+R)*n+C;B[X]=Z,O[X]=V;const ae=A===0?0:W[((S-1)*a+R)*n+C],ge=Z*ae+V*P;W[X]=ge,N+=E[S*n+C]*ge}G[S*a+R]=N}}const z=new Float32Array(h*a),H=new Float32Array(h*a);for(let v=0;v<h*a;v++)z[v]=Jt(p[v]),H[v]=G[v]*z[v];const M=new Float32Array(h*o);Se(H,e.wOutProj,e.bOutProj,h,a,o,M);for(let v=0;v<h*o;v++)M[v]=M[v]+r[v];return{output:M,cache:{x:r,normInv:m,normOut:u,xConvIn:g,z:p,convOut:_,u:b,dtRaw:y,bRaw:x,cRaw:E,deltaFull:L,dv:k,aCont:D,aBar:B,bBar:O,h:W,scanY:G,siluZ:z,gated:H}}}function xs(r,e,t,o,n){const{dModel:s,dState:a,dConv:i,dInner:c,dtRank:d,batch:h,seqLen:l}=o,u=h*l,m=d+2*a,f=new Float32Array(u*s);f.set(r);const g=new Float32Array(u*c);Ue(r,t.gated,e.wOutProj,u,c,s,g,n.wOutProj,n.bOutProj);const p=new Float32Array(u*c),_=new Float32Array(u*c);for(let M=0;M<u*c;M++)p[M]=g[M]*t.siluZ[M],_[M]=g[M]*t.scanY[M]*Zt(t.z[M]);const b=new Float32Array(u*c),w=new Float32Array(u*a),y=new Float32Array(u*a),x=new Float32Array(u*c),E=new Float32Array(c*a),L=new Float32Array(c*a);for(let M=0;M<h;M++){L.fill(0);for(let v=l-1;v>=0;v--){const A=M*l+v;for(let S=0;S<c;S++){const R=p[A*c+S],q=t.u[A*c+S],P=t.dv[A*c+S];n.D_vec[S]=n.D_vec[S]+R*q,b[A*c+S]=b[A*c+S]+R*e.D_vec[S];let N=0;for(let C=0;C<a;C++){const K=(A*c+S)*a+C,Z=t.h[K],V=t.aBar[K],X=t.bBar[K],ae=t.aCont[S*a+C],ge=t.cRaw[A*a+C];y[A*a+C]=y[A*a+C]+R*Z;const Oe=R*ge+L[S*a+C],oo=v===0?0:t.h[((A-1)*c+S)*a+C],Gt=Oe*oo,at=Oe*q;b[A*c+S]=b[A*c+S]+Oe*X,L[S*a+C]=Oe*V;const Kt=t.bRaw[A*a+C];N+=Gt*ae*V+at*V*Kt,E[S*a+C]=E[S*a+C]+Gt*P*V+at*Kt*((P*V*ae-(V-1))/(ae*ae)),w[A*a+C]=w[A*a+C]+at*((V-1)/ae)}x[A*c+S]=x[A*c+S]+N}}}for(let M=0;M<c*a;M++){const v=e.A_log[M];v<=mr||v>=gr||(n.A_log[M]=n.A_log[M]+E[M]*t.aCont[M])}const k=new Float32Array(u*c);for(let M=0;M<u*c;M++)k[M]=x[M]*ke(t.deltaFull[M]);const D=new Float32Array(u*d);Ue(k,t.dtRaw,e.wDtProj,u,d,c,D,n.wDtProj,n.bDtProj);const B=new Float32Array(u*m);for(let M=0;M<u;M++){for(let v=0;v<d;v++)B[M*m+v]=D[M*d+v];for(let v=0;v<a;v++)B[M*m+d+v]=w[M*a+v],B[M*m+d+a+v]=y[M*a+v]}const O=new Float32Array(u*c);Ue(B,t.u,e.wXProj,u,c,m,O,n.wXProj,n.bXProj);for(let M=0;M<u*c;M++)b[M]=b[M]+O[M];const W=new Float32Array(u*c);for(let M=0;M<u*c;M++)W[M]=b[M]*Zt(t.convOut[M]);const G=new Float32Array(u*c);for(let M=0;M<h;M++)for(let v=0;v<l;v++){const A=M*l+v;for(let S=0;S<c;S++){const R=W[A*c+S];if(R!==0){n.bConv[S]=n.bConv[S]+R;for(let q=0;q<i;q++){if(v<q)continue;const P=(M*l+v-q)*c+S;n.wConv[S*i+q]=n.wConv[S*i+q]+R*t.xConvIn[P],G[P]=G[P]+R*e.wConv[S*i+q]}}}}const z=new Float32Array(u*2*c);for(let M=0;M<u;M++)for(let v=0;v<c;v++)z[M*2*c+v]=G[M*c+v],z[M*2*c+c+v]=_[M*c+v];const H=new Float32Array(u*s);return Ue(z,t.normOut,e.wInProj,u,s,2*c,H,n.wInProj,n.bInProj),Gn(H,t.x,e.normWeight,t.normInv,u,s,f,n.normWeight,ze),f}const pn=["mamba1"];function ks(r){const e={dModel:r.dModel,dState:r.dState,dConv:r.dConv,dInner:r.dInner,dtRank:r.dtRank};return{embedding:new Float32Array(r.vocabSize*r.dModel),finalNorm:new Float32Array(r.dModel),lmHeadBias:new Float32Array(r.vocabSize),layers:Array.from({length:r.numLayers},()=>vs(e))}}function As(r){const e=new Map;e.set("embedding",r.embedding);for(let t=0;t<r.layers.length;t++){const o=r.layers[t];for(const n of It)e.set(`layer${t}.${n}`,o[n])}return e.set("final_norm",r.finalNorm),e.set("lm_head_bias",r.lmHeadBias),e}function Ms(r){const e=new Map;e.set("embedding",r.embedding);for(let t=0;t<r.layers.length;t++){const o=r.layers[t];for(const n of It)e.set(`layer${t}.${n}`,o[n])}return e.set("final_norm",r.finalNorm),e.set("lm_head_bias",r.lmHeadBias),e}function Es(r,e){const t=(h,l)=>{const u=r.get(h);if(!u)throw new Error(`cpuWeightsFromNamed: missing tensor "${h}"`);if(u.length!==l)throw new Error(`cpuWeightsFromNamed: "${h}" has ${u.length} elements, expected ${l}`);return u},{dModel:o,dState:n,dConv:s,dInner:a,dtRank:i}=e,c={wInProj:2*a*o,bInProj:2*a,wConv:a*s,bConv:a,wXProj:(i+2*n)*a,bXProj:i+2*n,wDtProj:a*i,bDtProj:a,A_log:a*n,D_vec:a,wOutProj:o*a,bOutProj:o,normWeight:o},d=[];for(let h=0;h<e.numLayers;h++){const l={};for(const u of It)l[u]=t(`layer${h}.${u}`,c[u]);d.push(l)}return{embedding:t("embedding",e.vocabSize*o),finalNorm:t("final_norm",o),lmHeadBias:t("lm_head_bias",e.vocabSize),layers:d}}function _r(r,e,t,o,n,s=!1){const{vocabSize:a,dModel:i}=t,c=o*n;let d=new Float32Array(c*i);for(let p=0;p<c;p++){const _=r[p];if(_<0||_>=a)throw new Error(`token id ${_} out of range [0, ${a})`);d.set(e.embedding.subarray(_*i,(_+1)*i),p*i)}const h={dModel:i,dState:t.dState,dConv:t.dConv,dInner:t.dInner,dtRank:t.dtRank,batch:o,seqLen:n},l=[],u=[];for(let p=0;p<t.numLayers;p++){l.push(d);const{output:_,cache:b}=pr(d,e.layers[p],h);s||u.push(b),d=_}const m=new Float32Array(c*i),f=new Float32Array(c);Hn(d,e.finalNorm,c,i,m,f,ze);const g=new Float32Array(c*a);return Se(m,e.embedding,e.lmHeadBias,c,i,a,g),{hiddenIn:l,layer:u,lastHidden:d,normOut:m,normInv:f,logits:g}}function Ls(r,e,t,o,n){return _r(r,e,t,o,n).logits}function Qc(r,e,t,o,n,s){const a=Ls(r,t,o,n,s),i=n*s,c=o.vocabSize;let d=0;for(let h=0;h<i;h++)d+=Ae(a.subarray(h*c,(h+1)*c),e[h]);return d/i}function Ss(r,e,t,o,n,s,a={}){const{vocabSize:i,dModel:c}=o,d=n*s,h=a.activationCheckpointing??!1,l=_r(r,t,o,n,s,h),u=ks(o);let m=0;const f=new Float32Array(d*i);for(let y=0;y<d;y++){const x=l.logits.subarray(y*i,(y+1)*i),E=e[y];m+=Ae(x,E);const L=qn(x,E);for(let k=0;k<i;k++)f[y*i+k]=L[k]/d}const g=m/d,p=new Float32Array(d*c);for(let y=0;y<d;y++){const x=y*i,E=y*c;for(let L=0;L<i;L++){const k=f[x+L];if(k===0)continue;u.lmHeadBias[L]=u.lmHeadBias[L]+k;const D=L*c;for(let B=0;B<c;B++)p[E+B]=p[E+B]+k*t.embedding[D+B],u.embedding[D+B]=u.embedding[D+B]+k*l.normOut[E+B]}}const _=new Float32Array(d*c);Gn(p,l.lastHidden,t.finalNorm,l.normInv,d,c,_,u.finalNorm,ze);const b={dModel:c,dState:o.dState,dConv:o.dConv,dInner:o.dInner,dtRank:o.dtRank,batch:n,seqLen:s};let w=_;for(let y=o.numLayers-1;y>=0;y--){const x=h?pr(l.hiddenIn[y],t.layers[y],b).cache:l.layer[y];w=xs(w,t.layers[y],x,b,u.layers[y])}for(let y=0;y<d;y++){const E=r[y]*c,L=y*c;for(let k=0;k<c;k++)u.embedding[E+k]=u.embedding[E+k]+w[L+k]}return{loss:g,grads:As(u)}}function Fs(r,e){const{dModel:t,dState:o,dConv:n,dInner:s,dtRank:a}=e;if(r==="embedding")return[e.vocabSize,t];switch(r.startsWith("layer")?r.slice(r.indexOf(".")+1):r){case"wInProj":return[2*s,t];case"wConv":return[s,n];case"wXProj":return[a+2*o,s];case"wDtProj":return[s,a];case"A_log":return[s,o];case"wOutProj":return[t,s];default:return null}}const Ds=["wInProj","wXProj","wDtProj","wOutProj"],Bs=.05;class Jc{model;tokenizer;device;_moments;_step;_dims;_mirror;_mirrorByName;_adapters;_loraBase;_shard;constructor(e,t=null){this.model=e,this.tokenizer=t,this.device=e.device,this._moments=new Map,this._step=0,this._dims=Cs(e),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const e=this.model.getTrainableParams();if(this._adapters.size===0)return e.reduce((o,n)=>o+n.numel,0);let t=0;for(const o of e){const n=this._adapters.get(o.name);n&&(t+=n.numParams())}return t}_owns(e){return this._shard===null||e%this._shard.count===this._shard.index}_installAdapters(e){if(this._adapters.size>0)return;const t=new Set(e.targets??Ds),o=this._mirrorByName;for(const n of this.model.getTrainableParams()){const s=n.name.includes(".")?n.name.slice(n.name.indexOf(".")+1):n.name;if(!t.has(s))continue;const a=Fs(n.name,this._dims);if(!a)continue;const[i,c]=a,d=Math.max(1,Math.min(e.rank??8,i,c));this._adapters.set(n.name,new Ce(i,c,{...e,rank:d})),this._loraBase.set(n.name,Float32Array.from(o.get(n.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...t].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const e=this._mirrorByName;for(const[t,o]of this._adapters){const n=e.get(t),s=this._loraBase.get(t),a=o.delta();for(let i=0;i<n.length;i++)n[i]=s[i]+a[i]}}_momentFor(e){let t=this._moments.get(e.name);return t||(t={m:new Float32Array(e.numel),v:new Float32Array(e.numel)},this._moments.set(e.name,t)),t}async _syncMirrorFromGpu(){const e=new Map;for(const t of this.model.parameters())e.set(t.name,await de(this.device,t.buf,t.numel*4));e.set("lm_head_bias",await de(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=Es(e,this._dims),this._mirrorByName=Ms(this._mirror)}async train(e,t={}){const{learningRate:o=1e-4,epochs:n=5,batchSize:s=1,seqLen:a=512,maxGradNorm:i=1,weightDecay:c=.01,beta1:d=.9,beta2:h=.999,eps:l=1e-8,wsla:u=!1,onEpochEnd:m=null}=t,f=Math.max(1,Math.floor(t.gradientAccumulation??1));if(this._shard=t.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const g=t.maxDelta??(u?Bs:0);u&&this.model.setWSLAMode(!0);let p;if(typeof e=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");p=this.tokenizer.encode(e)}else p=Array.from(e);if(p.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const _=Ts(p,a);if(_.length===0)throw new Error("Input is too short to form any training chunk.");const b=Ns(_,Math.max(1,Math.floor(s)));await this._syncMirrorFromGpu(),t.lora&&this._installAdapters(t.lora);const w=[];for(let y=0;y<n;y++){let x=0,E=0,L=0;for(let D=0;D<b.length;D+=f){const B=b.slice(D,D+f),{loss:O,gradNorm:W}=await this._trainStep(B,{learningRate:o,maxGradNorm:i,weightDecay:c,beta1:d,beta2:h,eps:l,wsla:u,maxDelta:g,...t.activationCheckpointing?{activationCheckpointing:!0}:{}});x+=O,E+=W,L++}const k=x/L;w.push(k),m&&m(y+1,k,E/L)}return u&&this.model.setWSLAMode(!1),w}async _trainStep(e,t){const{learningRate:o,maxGradNorm:n,weightDecay:s,beta1:a,beta2:i,eps:c,maxDelta:d}=t;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const h=this._mirror,l=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const u=t.activationCheckpointing?{activationCheckpointing:!0}:{};let m=0,f=new Map;for(const w of e){const y=Ss(w.inputs,w.targets,h,this._dims,w.batch,w.seqLen,u);if(m+=y.loss/e.length,f.size===0){for(const x of y.grads.values())for(let E=0;E<x.length;E++)x[E]=x[E]/e.length;f=y.grads}else for(const[x,E]of y.grads){const L=f.get(x);for(let k=0;k<E.length;k++)L[k]=L[k]+E[k]/e.length}}const g=this.model.getTrainableParams();if(this._adapters.size>0)for(const[w,y]of this._adapters){const x=f.get(w);x&&(y.zeroGrad(),y.accumulateGradient(x))}let p=0;for(const w of g){const y=f.get(w.name);if(y)for(let x=0;x<y.length;x++)p+=y[x]*y[x]}const _=Math.sqrt(p),b=n>0&&_>n?n/_:1;return this._adamwStep(g,f,l,{learningRate:o,weightDecay:s,beta1:a,beta2:i,eps:c,beta1_t:Math.pow(a,this._step),beta2_t:Math.pow(i,this._step),maxDelta:d,gradScale:b}),{loss:m,gradNorm:_}}_adamwStep(e,t,o,n){const{learningRate:s,weightDecay:a,beta1:i,beta2:c,eps:d,beta1_t:h,beta2_t:l,maxDelta:u,gradScale:m}=n,f={lr:s,beta1:i,beta2:c,eps:d,weightDecay:a,beta1_t:h,beta2_t:l,maxDelta:u,gradScale:m};for(let g=0;g<e.length;g++){const p=e[g];if(!this._owns(g))continue;const _=this._adapters.get(p.name);if(_){const x=o.get(p.name),E=this._loraBase.get(p.name),[L,k]=[_.A,_.B],[D,B]=[_.gradients()[1].data,_.gradients()[0].data],O=this._momentNamed(`${p.name}::loraB`,k.length),W=this._momentNamed(`${p.name}::loraA`,L.length);Ke(k,B,O.m,O.v,f),Ke(L,D,W.m,W.v,f);const G=_.delta();for(let z=0;z<x.length;z++)x[z]=E[z]+G[z];we(this.device,p.buf,x);continue}const b=t.get(p.name),w=o.get(p.name);if(!b||!w)continue;if(b.length!==p.numel||w.length!==p.numel)throw new Error(`MambaTrainer: parameter "${p.name}" is ${p.numel} elements but the gradient engine produced ${b.length} — model and CPU mirror disagree.`);const y=this._momentFor(p);Ke(w,b,y.m,y.v,f),we(this.device,p.buf,w)}}_momentNamed(e,t){let o=this._moments.get(e);return o||(o={m:new Float32Array(t),v:new Float32Array(t)},this._moments.set(e,o)),o}optimizerStateBytes(){let e=0;for(const t of this._moments.values())e+=t.m.byteLength+t.v.byteLength;return e}async evaluate(e){let t;if(typeof e=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");t=Array.from(this.tokenizer.encode(e))}else t=Array.from(e);const o=t.length,n=this.model.config.vocabSize,{logits:s}=await this.model.forward(new Uint32Array(t.slice(0,-1)),1,o-1);let a=0;for(let c=0;c<o-1;c++){const d=c*n;a+=Ae(s.slice(d,d+n),t[c+1])}const i=a/(o-1);return Math.exp(i)}}function Cs(r){const e=r.layerSpecs.map((s,a)=>({i:a,type:s.type})).filter(({type:s})=>!pn.includes(s));if(e.length>0){const s=e.map(({i:a,type:i})=>`layer${a}=${i}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${pn.join("/")} layers only, but this model has ${s}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const t=r.layers[0],o=t?.dInner??r.config.expand*r.config.dModel,n=t?.dtRank??Math.ceil(r.config.dModel/16);return{vocabSize:r.config.vocabSize,dModel:r.config.dModel,dState:r.config.dState,dConv:r.config.dConv,dInner:o,dtRank:n,numLayers:r.layers.length}}function Ts(r,e){const t=[];for(let n=0;n+e<r.length;n+=e)t.push({inputs:r.slice(n,n+e),targets:r.slice(n+1,n+e+1)});const o=r.length%e;if(o>1){const n=r.length-o;t.push({inputs:r.slice(n,-1),targets:r.slice(n+1)})}return t}function Ns(r,e){const t=[];let o=0;for(;o<r.length;){const n=r[o].inputs.length,s=[];for(;o<r.length&&s.length<e&&r[o].inputs.length===n;)s.push(r[o]),o++;t.push({inputs:s.flatMap(a=>a.inputs),targets:s.flatMap(a=>a.targets),batch:s.length,seqLen:n})}return t}class Zc{video;constructor(e){this.video=new rt({...e,keyframeInterval:1})}get vocab(){return this.video.vocab}get vocabSize(){return this.video.vocabSize}get frameSize(){return this.video.height*this.video.width*this.video.channels}encode(e){return this.video.encode([e])}decode(e){return this.video.decode(e)[0]??new Float32Array(this.frameSize)}fit(e,t){return this.video.fit(e.map(o=>[o]),t)}}function el(r,e,t){return[...e,...r.encode(t)]}function Ps(r,e,t,o){if(r.config.vocabSize!==e.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${r.config.vocabSize}) must equal codec.vocabSize (${e.vocabSize})`);const n=r.generate(t,{...o,stopToken:o.stopToken??e.vocab.eosVideo});return{video:e.decode(n),tokens:n}}function tl(r,e,t,o){const{video:n,tokens:s}=Ps(r,e.video,t,o);return{image:n[0]??new Float32Array(e.frameSize),tokens:s}}function Re(r){const e=r.config;return{vocabSize:e.vocabSize,dModel:e.dModel,numLayers:e.numLayers,convKernel:e.convKernel,hiddenDim:e.hiddenDim,numExperts:e.numExperts,topK:e.topK}}function br(r){const{vocabSize:e,dModel:t,numLayers:o,convKernel:n,hiddenDim:s,numExperts:a}=r,i=[{name:"token_embedding.weight",shape:[e,t]}],c=d=>[{name:`${d}.w1`,shape:[s,t]},{name:`${d}.b1`,shape:[s]},{name:`${d}.w2`,shape:[t,s]},{name:`${d}.b2`,shape:[t]}];for(let d=0;d<o;d++){const h=`layers.${d}`;i.push({name:`${h}.conv.weight`,shape:[t,n]}),i.push({name:`${h}.norm_conv.weight`,shape:[t]}),i.push({name:`${h}.norm_moe.weight`,shape:[t]}),i.push({name:`${h}.moe.router.weight`,shape:[a,t]}),i.push(...c(`${h}.moe.shared`));for(let l=0;l<a;l++)i.push(...c(`${h}.moe.experts.${l}`))}return i}function zt(r){const e=br(Re(r)),t=r.parameters();if(e.length!==t.length)throw new Error(`export/tensors: parameter-count drift (spec ${e.length} vs model ${t.length}) — EvermindLM.parameters() order changed; update evermindTensorSpec`);return e.map((o,n)=>{const s=o.shape.reduce((i,c)=>i*c,1),a=t[n].data;if(a.length!==s)throw new Error(`export/tensors: shape mismatch for ${o.name} (expected ${s}, got ${a.length})`);return{name:o.name,shape:o.shape,data:a}})}function wr(r){return r.parameters().reduce((e,t)=>e+t.data.length,0)}function $s(r,e){if(!e){const n=new Uint8Array(r.length*4),s=new DataView(n.buffer);for(let a=0;a<r.length;a++)s.setFloat32(a*4,r[a],!0);return n}const t=new Uint8Array(r.length*2),o=new DataView(t.buffer);for(let n=0;n<r.length;n++)o.setUint16(n*2,et(r[n]),!0);return t}function Is(r,e={}){const t=e.fp16??!1,o=t?"F16":"F32",n=t?2:4,s={};e.metadata&&(s.__metadata__=e.metadata);const a=[];let i=0;for(const f of r){const g=f.data.length*n;s[f.name]={dtype:o,shape:f.shape,data_offsets:[i,i+g]},a.push($s(f.data,t)),i+=g}let c=JSON.stringify(s);const h=(8-new TextEncoder().encode(c).length%8)%8;h>0&&(c+=" ".repeat(h));const l=new TextEncoder().encode(c),u=new Uint8Array(8+l.length+i);new DataView(u.buffer).setBigUint64(0,BigInt(l.length),!0),u.set(l,8);let m=8+l.length;for(const f of a)u.set(f,m),m+=f.length;return u}function _n(r,e={}){return Is(zt(r),{...e,metadata:{format:"pt",producer:"builderforce-memory-engine",...e.metadata??{}}})}const zs=0,js=5,Ws=2;class ee{parts=[];byte(e){this.parts.push(e&255)}rawVarint(e){if(e<0||!Number.isFinite(e))throw new Error(`ProtoWriter: bad varint ${e}`);let t=e;for(;t>=128;)this.byte(t%128|128),t=Math.floor(t/128);this.byte(t)}tag(e,t){this.rawVarint(e*8+t)}rawBytes(e){for(let t=0;t<e.length;t++)this.byte(e[t])}varint(e,t){this.tag(e,zs),this.rawVarint(t)}float(e,t){this.tag(e,js);const o=new ArrayBuffer(4);new DataView(o).setFloat32(0,t,!0),this.rawBytes(new Uint8Array(o))}bytes(e,t){this.tag(e,Ws),this.rawVarint(t.length),this.rawBytes(t)}string(e,t){this.bytes(e,new TextEncoder().encode(t))}message(e,t){this.bytes(e,t.finish())}finish(){return Uint8Array.from(this.parts)}}function Rs(r){const e=new Uint8Array(r.length*4),t=new DataView(e.buffer);for(let o=0;o<r.length;o++)t.setFloat32(o*4,r[o],!0);return e}const Os=18,Us=8,yr=1,vr=7,Hs=1,Gs=2,Ks=3,qs=7;class Vs{nodes=[];inits=[];uid=0;tmp(e){return`${e}_${this.uid++}`}initFloat(e,t,o){return this.inits.push({name:e,dims:t,dataType:yr,raw:Rs(o)}),e}initInt64(e,t,o){return this.inits.push({name:e,dims:t,dataType:vr,int64:o}),e}node(e,t,o,n=[]){return this.nodes.push({op:e,inputs:t,outputs:o,name:`${e}_${this.uid++}`,attrs:n}),o}op(e,t,o,n=[]){const s=this.tmp(o);return this.node(e,t,[s],n),s}}function bn(r,e,t,o,n){const s=r.op("Mul",[e,e],"rms_sq"),a=r.op("ReduceMean",[s,n],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),i=r.op("Add",[a,o],"rms_eps"),c=r.op("Sqrt",[i],"rms_r"),d=r.op("Div",[e,c],"rms_div");return r.op("Mul",[d,t],"rms_y")}function wn(r,e,t,o,n,s){const a=r.op("Transpose",[t],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),i=r.op("Add",[r.op("MatMul",[e,a],"ffn_mm1"),o],"ffn_pre"),c=r.op("Relu",[i],"ffn_h"),d=r.op("Transpose",[n],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return r.op("Add",[r.op("MatMul",[c,d],"ffn_mm2"),s],"ffn_y")}function yn(r,e={}){const t=Re(r),o=zt(r),n=new Map(o.map(w=>[w.name,w])),s=w=>{const y=n.get(w);if(!y)throw new Error(`export/onnx: missing tensor ${w}`);return y},a=new Vs,{vocabSize:i,dModel:c,numLayers:d,convKernel:h,numExperts:l,topK:u}=t,m=a.initFloat("token_embedding.weight",[i,c],s("token_embedding.weight").data),f=a.initFloat("rms_eps",[1],new Float32Array([1e-5])),g=a.initInt64("axes_last",[1],[2]),p=a.initInt64("topk_k",[1],[u]);let _=a.op("Gather",[m,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let w=0;w<d;w++){const y=`layers.${w}`,x=a.initFloat(`${y}.norm_conv.weight`,[c],s(`${y}.norm_conv.weight`).data),E=bn(a,_,x,f,g),L=s(`${y}.conv.weight`).data,k=new Float32Array(c*h);for(let V=0;V<c;V++)for(let X=0;X<h;X++)k[V*h+(h-1-X)]=L[V*h+X];const D=a.initFloat(`${y}.conv.onnx_weight`,[c,1,h],k),B=a.op("Transpose",[E],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),O=a.op("Conv",[B,D],"conv_out",[{kind:"i",name:"group",value:c},{kind:"ints",name:"kernel_shape",value:[h]},{kind:"ints",name:"pads",value:[h-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),W=a.op("Transpose",[O],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),G=a.op("Add",[_,W],"after_conv"),z=a.initFloat(`${y}.norm_moe.weight`,[c],s(`${y}.norm_moe.weight`).data),H=bn(a,G,z,f,g),M=a.initFloat(`${y}.moe.router.weight`,[l,c],s(`${y}.moe.router.weight`).data),v=a.op("Transpose",[M],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),A=a.op("MatMul",[H,v],"router_logits"),S=a.tmp("topk_v"),R=a.tmp("topk_i");a.node("TopK",[A,p],[S,R],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const q=a.op("Softmax",[S],"gates",[{kind:"i",name:"axis",value:2}]),P=a.op("Sub",[A,A],"zeros"),N=a.op("ScatterElements",[P,R,q],"combine",[{kind:"i",name:"axis",value:2}]),C=wn(a,H,a.initFloat(`${y}.moe.shared.w1`,[t.hiddenDim,c],s(`${y}.moe.shared.w1`).data),a.initFloat(`${y}.moe.shared.b1`,[t.hiddenDim],s(`${y}.moe.shared.b1`).data),a.initFloat(`${y}.moe.shared.w2`,[c,t.hiddenDim],s(`${y}.moe.shared.w2`).data),a.initFloat(`${y}.moe.shared.b2`,[c],s(`${y}.moe.shared.b2`).data)),K=Array.from({length:l},(V,X)=>a.tmp(`combine_${X}`));a.node("Split",[N],K,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:l}]);let Z=C;for(let V=0;V<l;V++){const X=`${y}.moe.experts.${V}`,ae=wn(a,H,a.initFloat(`${X}.w1`,[t.hiddenDim,c],s(`${X}.w1`).data),a.initFloat(`${X}.b1`,[t.hiddenDim],s(`${X}.b1`).data),a.initFloat(`${X}.w2`,[c,t.hiddenDim],s(`${X}.w2`).data),a.initFloat(`${X}.b2`,[c],s(`${X}.b2`).data)),ge=a.op("Mul",[K[V],ae],"expert_w");Z=a.op("Add",[Z,ge],"moe_acc")}_=a.op("Add",[G,Z],"after_moe")}const b=a.op("Transpose",[m],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return a.node("MatMul",[_,b],["logits"]),ea(a,t,e)}function Xs(r){const e=new ee;switch(e.string(1,r.name),r.kind){case"i":e.varint(20,Gs),e.varint(3,r.value);break;case"ints":e.varint(20,qs);for(const t of r.value)e.varint(8,t);break;case"f":e.varint(20,Hs),e.float(2,r.value);break;case"s":e.varint(20,Ks),e.string(4,r.value);break}return e}function Ys(r){const e=new ee;for(const t of r.inputs)e.string(1,t);for(const t of r.outputs)e.string(2,t);e.string(3,r.name),e.string(4,r.op);for(const t of r.attrs)e.message(5,Xs(t));return e}function Qs(r){const e=new ee;for(const t of r.dims)e.varint(1,t);if(e.varint(2,r.dataType),e.string(8,r.name),r.int64)for(const t of r.int64)e.varint(7,t);return r.raw&&e.bytes(9,r.raw),e}function Js(r){const e=new ee;return e.string(2,r),e}function Zs(r){const e=new ee;return e.varint(1,r),e}function vn(r,e,t){const o=new ee;for(const i of t)o.message(1,typeof i=="string"?Js(i):Zs(i));const n=new ee;n.varint(1,e),n.message(2,o);const s=new ee;s.message(1,n);const a=new ee;return a.string(1,r),a.message(2,s),a}function ea(r,e,t){const o=new ee;for(const a of r.nodes)o.message(1,Ys(a));o.string(2,"evermind");for(const a of r.inits)o.message(5,Qs(a));o.message(11,vn("input_ids",vr,["batch","seq"])),o.message(12,vn("logits",yr,["batch","seq",e.vocabSize]));const n=new ee;n.string(1,""),n.varint(2,Os);const s=new ee;return s.varint(1,Us),s.string(2,t.producerName??"builderforce-memory-engine"),s.string(3,t.producerVersion??"evermind"),s.message(7,o),s.message(8,n),s.finish()}const ta=1179993927,na=3,Le=32,ra=4,oa=8,sa=0,aa=1;class ia{buf=new Uint8Array(1024);len=0;ensure(e){if(this.len+e<=this.buf.length)return;let t=this.buf.length*2;for(;t<this.len+e;)t*=2;const o=new Uint8Array(t);o.set(this.buf.subarray(0,this.len)),this.buf=o}u32(e){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,e,!0),this.len+=4}u64(e){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(e),!0),this.len+=8}raw(e){this.ensure(e.length),this.buf.set(e,this.len),this.len+=e.length}alignTo(e){const t=(e-this.len%e)%e;t>0&&(this.ensure(t),this.len+=t)}string(e){const t=new TextEncoder().encode(e);this.u64(t.length),this.raw(t)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function ca(r,e){if(!e){const n=new Uint8Array(r.length*4),s=new DataView(n.buffer);for(let a=0;a<r.length;a++)s.setFloat32(a*4,r[a],!0);return n}const t=new Uint8Array(r.length*2),o=new DataView(t.buffer);for(let n=0;n<r.length;n++)o.setUint16(n*2,et(r[n]),!0);return t}function xn(r,e={}){const t=e.fp16??!1,o=Re(r),n=zt(r),s=t?aa:sa,a=t?2:4,i=[["evermind.vocab_size",o.vocabSize],["evermind.embedding_length",o.dModel],["evermind.block_count",o.numLayers],["evermind.conv_kernel",o.convKernel],["evermind.feed_forward_length",o.hiddenDim],["evermind.expert_count",o.numExperts],["evermind.expert_used_count",o.topK],["general.alignment",Le]],c=[["general.architecture","evermind"],["general.name",e.name??"Evermind"]],d=new ia;d.u32(ta),d.u32(na),d.u64(n.length),d.u64(i.length+c.length);for(const[f,g]of c)d.string(f),d.u32(oa),d.string(g);for(const[f,g]of i)d.string(f),d.u32(ra),d.u32(g);const h=f=>[...f.shape].reverse();let l=0;const u=[];for(const f of n){u.push(l);const g=f.data.length*a;l+=g,l+=(Le-l%Le)%Le}n.forEach((f,g)=>{d.string(f.name);const p=h(f);d.u32(p.length);for(const _ of p)d.u64(_);d.u32(s),d.u64(u[g])}),d.alignTo(Le);const m=d.length;for(let f=0;f<n.length;f++){const g=m+u[f];for(;d.length<g;)d.raw(new Uint8Array(1));d.raw(ca(n[f].data,t))}return d.bytes()}function la(r){const e=Re(r);return{model_type:"evermind",architectures:["EvermindForCausalLM"],vocab_size:e.vocabSize,d_model:e.dModel,hidden_size:e.dModel,num_hidden_layers:e.numLayers,conv_kernel:e.convKernel,intermediate_size:e.hiddenDim,num_experts:e.numExperts,num_experts_per_tok:e.topK,rms_norm_eps:1e-5,tie_word_embeddings:!0,torch_dtype:"float32",transformers_version:"4.0.0"}}function da(){return{do_sample:!1,temperature:1,max_new_tokens:64}}function ha(r){const e={};for(const[n,s]of r.vocab)e[n]=s;const t=[...r.merges.keys()],o=[];for(const n of[r.unkToken,r.bosToken,r.eosToken,r.padToken]){const s=r.vocab.get(n);s!==void 0&&!o.some(a=>a.id===s)&&o.push({id:s,content:n})}return{version:"1.0",truncation:null,padding:null,added_tokens:o.map(n=>({id:n.id,content:n.content,single_word:!1,lstrip:!1,rstrip:!1,normalized:!1,special:!0})),normalizer:null,pre_tokenizer:{type:"ByteLevel",add_prefix_space:!1,trim_offsets:!0,use_regex:!0},post_processor:{type:"ByteLevel",add_prefix_space:!0,trim_offsets:!1,use_regex:!0},decoder:{type:"ByteLevel",add_prefix_space:!0,trim_offsets:!0,use_regex:!0},model:{type:"BPE",dropout:null,unk_token:null,continuing_subword_prefix:null,end_of_word_suffix:null,fuse_unk:!1,byte_fallback:!1,vocab:e,merges:t}}}function ua(r,e={}){const t=Re(r),o=wr(r),n=e.name??"Evermind",s=e.license??"mit",a=["evermind","ssm","mixture-of-experts","text-generation",...e.tags??[]],i=["---",`license: ${s}`,"library_name: builderforce-memory","pipeline_tag: text-generation","tags:",...a.map(d=>`  - ${d}`),"---"].join(`
`),c=`
# ${n}

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
| parameters | ${o.toLocaleString("en-US")} |

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
`:""}`;return`${i}
${c}`}const nl=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],fa="application/json";function ct(r,e){return{path:r,data:JSON.stringify(e,null,2),contentType:fa}}function rl(r,e,t={},o){const n=wr(r),s=()=>({format:e,files:[],paramCount:n});switch(e){case"safetensors":{const a=s();return a.files.push({path:"model.safetensors",data:_n(r,{fp16:t.fp16}),contentType:"application/octet-stream"}),a}case"onnx":{const a=s();return a.files.push({path:"model.onnx",data:yn(r,{producerVersion:t.version}),contentType:"application/octet-stream"}),a}case"gguf":{const a=s();return a.files.push({path:"model.gguf",data:xn(r,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"}),a}case"huggingface":{if(!o)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const a=s();return a.files.push({path:"model.safetensors",data:_n(r,{fp16:t.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:yn(r,{producerVersion:t.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:xn(r,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"},ct("config.json",la(r)),ct("generation_config.json",da()),ct("tokenizer.json",ha(o)),{path:"README.md",data:ua(r,t),contentType:"text/markdown"}),a}default:throw new Error(`exportEvermind: unknown format "${String(e)}"`)}}function xr(r){if(r.length<8)throw new Error("safetensors: buffer too short for header length");const e=new DataView(r.buffer,r.byteOffset,r.byteLength),t=Number(e.getBigUint64(0,!0)),o=8+t;if(o>r.length)throw new Error(`safetensors: header length ${t} exceeds buffer`);const n=new TextDecoder().decode(r.subarray(8,o));let s;try{s=JSON.parse(n)}catch(c){throw new Error(`safetensors: malformed JSON header (${c instanceof Error?c.message:String(c)})`)}const a=o,i=[];for(const[c,d]of Object.entries(s)){if(c==="__metadata__")continue;const h=d;if(!h||!Array.isArray(h.shape)||!Array.isArray(h.data_offsets))throw new Error(`safetensors: malformed entry for "${c}"`);const[l,u]=h.data_offsets,m=h.shape.reduce((g,p)=>g*p,1),f=r.subarray(a+l,a+u);i.push({name:c,shape:h.shape,data:ma(f,h.dtype,m,c)})}return i}function ma(r,e,t,o){const n=new DataView(r.buffer,r.byteOffset,r.byteLength),s=new Float32Array(t),a=e.toUpperCase();if(a==="F32"||a==="FLOAT32"){if(r.length<t*4)throw new Error(`safetensors: "${o}" F32 bytes ${r.length} < ${t*4}`);for(let i=0;i<t;i++)s[i]=n.getFloat32(i*4,!0);return s}if(a==="F16"||a==="FLOAT16"){if(r.length<t*2)throw new Error(`safetensors: "${o}" F16 bytes ${r.length} < ${t*2}`);for(let i=0;i<t;i++)s[i]=Ft(n.getUint16(i*2,!0));return s}if(a==="BF16"||a==="BFLOAT16"){if(r.length<t*2)throw new Error(`safetensors: "${o}" BF16 bytes ${r.length} < ${t*2}`);const i=new Uint32Array(s.buffer);for(let c=0;c<t;c++)i[c]=n.getUint16(c*2,!0)<<16;return s}throw new Error(`safetensors: unsupported dtype "${e}" for "${o}" (expected F32, F16 or BF16)`)}function ga(r,e){const t=new Map(r.map(u=>[u.name,u])),o=t.get("token_embedding.weight");if(!o||o.shape.length!==2)throw new Error("import: missing token_embedding.weight [vocab, dModel]");const[n,s]=o.shape;let a=0,i=0;for(const u of r){const m=/^layers\.(\d+)\./.exec(u.name);m&&(a=Math.max(a,Number(m[1])+1));const f=/^layers\.\d+\.moe\.experts\.(\d+)\./.exec(u.name);f&&(i=Math.max(i,Number(f[1])+1))}if(a===0)throw new Error("import: no `layers.<n>.` tensors found");const c=t.get("layers.0.conv.weight");if(!c||c.shape.length!==2)throw new Error("import: missing layers.0.conv.weight [dModel, convKernel]");const d=c.shape[1],h=t.get("layers.0.moe.shared.w1");if(!h||h.shape.length!==2)throw new Error("import: missing layers.0.moe.shared.w1 [hiddenDim, dModel]");const l=h.shape[0];return{vocabSize:n,dModel:s,numLayers:a,convKernel:d,hiddenDim:l,numExperts:i,topK:Math.min(e??2,Math.max(1,i))}}function pa(r,e={}){const t=[];for(const d of r){const h=e.rename?e.rename(d.name):d.name;h!=null&&t.push({...d,name:h})}const o=new Map(t.map(d=>[d.name,d])),n=e.arch??ga(t,e.topK),s=br(n),a=[];for(const d of s){const h=o.get(d.name);if(!h)throw new Error(`import: missing tensor "${d.name}" (expected shape [${d.shape.join(", ")}])`);const l=d.shape.reduce((u,m)=>u*m,1);if(h.data.length!==l)throw new Error(`import: tensor "${d.name}" has ${h.data.length} elements, expected ${l} ([${d.shape.join(", ")}])`);a.push(h.data)}const i=new nt({vocabSize:n.vocabSize,dModel:n.dModel,numLayers:n.numLayers,convKernel:n.convKernel,hiddenDim:n.hiddenDim,numExperts:n.numExperts,topK:n.topK}),c=i.parameters();if(c.length!==a.length)throw new Error(`import: parameter-count drift (model ${c.length} vs imported ${a.length})`);for(let d=0;d<c.length;d++)c[d].data.set(a[d]);return i}function ol(r,e={}){return pa(xr(r),e)}function kr(r){return r.startsWith("model.")?r.slice(6):r}function _a(r){return r.reduce((e,t)=>e*t,1)}function pe(r){const e=r.filter(t=>t!==1);return e.length>0?e:[1]}function lt(r,e){return r.length===e.length&&r.every((t,o)=>t===e[o])}function ba(r){if(!(r>0))throw new Error(`import/foreign: softplus⁻¹ needs a positive input, got ${r}`);return r>30?r:Math.log(Math.expm1(r))}function kn(r,e){const t=_a(r.shape);if(r.op.kind==="fill")return new Float32Array(t).fill(r.op.value);if(!e)throw new Error(`import/foreign: rule for "${r.target}" has no source tensor`);const o=`"${e.name}" → "${r.target}"`;switch(r.op.kind){case"copy":case"negExpToSoftplusInv":{if(!lt(pe(e.shape),pe(r.shape)))throw new Error(`import/foreign: ${o} shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${r.shape.join(", ")}]`);if(e.data.length!==t)throw new Error(`import/foreign: ${o} has ${e.data.length} elements, expected ${t}`);if(r.op.kind==="copy")return Float32Array.from(e.data);const n=new Float32Array(t);for(let s=0;s<t;s++)n[s]=ba(Math.exp(e.data[s]));return n}case"convTaps":{const[n,s]=pe(r.shape),a=pe(e.shape);if(!lt(a,[n,s]))throw new Error(`import/foreign: ${o} depthwise conv shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${r.shape.join(", ")}] (a [channels, 1, kernel] PyTorch kernel squeezes to [channels, kernel])`);const i=new Float32Array(t);for(let c=0;c<n;c++)for(let d=0;d<s;d++)i[c*s+d]=e.data[c*s+(s-1-d)];return i}case"rowSlice":{if(e.shape.length!==2)throw new Error(`import/foreign: ${o} rowSlice needs a rank-2 source, got [${e.shape.join(", ")}]`);const[n,s]=e.shape,{start:a,count:i}=r.op;if(a<0||a+i>n)throw new Error(`import/foreign: ${o} rowSlice [${a}, ${a+i}) is outside the checkpoint tensor's ${n} rows — the source layout is not what this adapter expects`);if(!lt(pe(r.shape),pe([i,s])))throw new Error(`import/foreign: ${o} rowSlice yields [${i}, ${s}] but this model expects [${r.shape.join(", ")}]`);return Float32Array.from(e.data.subarray(a*s,(a+i)*s))}}}function wa(r,e){const t=new Map;for(const i of e){const c=kr(i.name);t.set(c,{...i,name:c})}const o=new Map,n=[],s=new Set;for(const i of r.rules){if(o.has(i.target))throw new Error(`import/foreign: plan "${r.adapter}" defines "${i.target}" twice`);if(i.from.length===0){if(i.op.kind!=="fill")throw new Error(`import/foreign: rule for "${i.target}" names no source but is not a fill rule`);o.set(i.target,kn(i,null)),n.push({target:i.target,value:i.op.value,reason:i.note??"this architecture has no corresponding tensor"});continue}const c=i.from.map(d=>t.get(d)).find(d=>d!=null);if(!c)throw new Error(`import/foreign: checkpoint is missing "${i.from[0]}" (needed for "${i.target}", expected shape [${i.shape.join(", ")}])`+(i.from.length>1?`; also tried ${i.from.slice(1).map(d=>`"${d}"`).join(", ")}`:""));s.add(c.name),o.set(i.target,kn(i,c))}const a=[...t.keys()].filter(i=>!s.has(i)).sort();return{adapter:r.adapter,weights:o,unmappedSources:a,synthesisedTargets:n,discardedSources:r.discards}}function jt(r,e){throw new Error(`import/foreign: config field "${r}" ${e}`)}function ne(r,e){const t=r[e];return(typeof t!="number"||!Number.isInteger(t)||t<=0)&&jt(e,`must be a positive integer, got ${JSON.stringify(t)}`),t}function Fe(r,e){for(const t of e){const o=r[t];if(typeof o=="number"&&Number.isInteger(o)&&o>0)return o}}function Ar(r,e){const t=Fe(r,["intermediate_size"]);if(t!==void 0)return t;const o=Fe(r,["expand"]);return o===void 0&&jt("intermediate_size",'is absent and no usable "expand" was found'),o*e}function Mr(r,e,t){if(r%e!==0)throw new Error(`import/foreign: ${t} has d_inner ${r} which is not a whole multiple of d_model ${e} — this engine's blocks are sized by an integer expand factor`);return r/e}function ya(r,e){const t=r.time_step_rank;if(typeof t=="number"&&Number.isInteger(t)&&t>0)return t;if(t===void 0||t==="auto")return Math.ceil(e/16);jt("time_step_rank",`must be a positive integer or "auto", got ${JSON.stringify(t)}`)}const va=["backbone.embeddings.weight","backbone.embedding.weight"];function xa(r){const{vocabSize:e,dModel:t,numLayers:o,dInner:n,dState:s,dConv:a,dtRank:i}=r,c=[{target:"embedding",shape:[e,t],from:va,op:{kind:"copy"}}];for(let d=0;d<o;d++){const h=`backbone.layers.${d}.mixer`,l=`layer${d}`;c.push({target:`${l}.wInProj`,shape:[2*n,t],from:[`${h}.in_proj.weight`],op:{kind:"copy"}},{target:`${l}.bInProj`,shape:[2*n],from:[],op:{kind:"fill",value:0},note:"Falcon-Mamba sets use_bias=false — in_proj ships no bias; zeros are exact"},{target:`${l}.wConv`,shape:[n,a],from:[`${h}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [d_inner, 1, d_conv] → [d_inner, d_conv] with the tap axis reversed"},{target:`${l}.bConv`,shape:[n],from:[`${h}.conv1d.bias`],op:{kind:"copy"}},{target:`${l}.wXProj`,shape:[i+2*s,n],from:[`${h}.x_proj.weight`],op:{kind:"copy"}},{target:`${l}.bXProj`,shape:[i+2*s],from:[],op:{kind:"fill",value:0},note:"x_proj is bias-free upstream; zeros are exact"},{target:`${l}.wDtProj`,shape:[n,i],from:[`${h}.dt_proj.weight`],op:{kind:"copy"}},{target:`${l}.bDtProj`,shape:[n],from:[`${h}.dt_proj.bias`],op:{kind:"copy"}},{target:`${l}.A_log`,shape:[n,s],from:[`${h}.A_log`],op:{kind:"copy"}},{target:`${l}.D_vec`,shape:[n],from:[`${h}.D`],op:{kind:"copy"}},{target:`${l}.wOutProj`,shape:[t,n],from:[`${h}.out_proj.weight`],op:{kind:"copy"}},{target:`${l}.bOutProj`,shape:[t],from:[],op:{kind:"fill",value:0},note:"out_proj is bias-free upstream; zeros are exact"},{target:`${l}.normWeight`,shape:[t],from:[`backbone.layers.${d}.norm.weight`],op:{kind:"copy"}})}return c.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),c}function Er(r){const e=r.id;return{...r,describe(t){const o=ne(t,"hidden_size"),n=ne(t,"num_hidden_layers"),s=ne(t,"vocab_size"),a=ne(t,"state_size"),i=ne(t,"conv_kernel"),c=Ar(t,o),d=Mr(c,o,r.label),h=ya(t,o),l={vocabSize:s,dModel:o,numLayers:n,dState:a,dConv:i,expand:d,defaultMamba1:{dtRank:h,biasConv:!0}},u={adapter:e,rules:xa({vocabSize:s,dModel:o,numLayers:n,dInner:c,dState:a,dConv:i,dtRank:h}),discards:[]};return{modelConfig:l,plan:u}}}}const ka=Er({id:"falcon_mamba",label:"Falcon-Mamba (Mamba-1 / S6)",modelTypes:["falcon_mamba"],architectures:["FalconMambaForCausalLM"]}),Aa=Er({id:"mamba",label:"Mamba (Mamba-1 / S6)",modelTypes:["mamba"],architectures:["MambaForCausalLM"]}),An="codestral_mamba",Ma=["backbone.embeddings.weight","backbone.embedding.weight"];function Ea(r){const{vocabSize:e,dModel:t,numLayers:o,dInner:n,dState:s,dConv:a,nHeads:i,nGroups:c}=r,d=n+2*c*s,h=d+i,l=[{target:"embedding",shape:[e,t],from:Ma,op:{kind:"copy"}}];for(let u=0;u<o;u++){const m=`backbone.layers.${u}.mixer`,f=`layer${u}`;l.push({target:`${f}.wInProj`,shape:[h,t],from:[`${m}.in_proj.weight`],op:{kind:"rowSlice",start:n,count:h},note:"upstream rows are [gate, x, B, C, dt]; this block has no gate branch"},{target:`${f}.wConv`,shape:[d,a],from:[`${m}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [conv_dim, 1, d_conv] → [conv_dim, d_conv] with the tap axis reversed"},{target:`${f}.bConv`,shape:[d],from:[`${m}.conv1d.bias`],op:{kind:"copy"}},{target:`${f}.A_log`,shape:[i],from:[`${m}.A_log`],op:{kind:"negExpToSoftplusInv"},note:"upstream A = -exp(A_log); this engine's SSD kernel uses A = -softplus(A_log)"},{target:`${f}.dt_bias`,shape:[i],from:[`${m}.dt_bias`],op:{kind:"copy"}},{target:`${f}.D_vec`,shape:[i],from:[`${m}.D`],op:{kind:"copy"}},{target:`${f}.wOutProj`,shape:[t,n],from:[`${m}.out_proj.weight`],op:{kind:"copy"}},{target:`${f}.normWeight`,shape:[n],from:[`${m}.norm.weight`],op:{kind:"copy"},note:"upstream this gain belongs to a GATED RMSNorm; applied ungated here"},{target:`${f}.preNormWeight`,shape:[t],from:[`backbone.layers.${u}.norm.weight`],op:{kind:"copy"}})}return l.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),l}function La(r){const e=[];for(let t=0;t<r.numLayers;t++)e.push({source:`backbone.layers.${t}.mixer.in_proj.weight`,elements:r.dInner*r.dModel,reason:"the leading d_inner gate (z) rows — Mamba2Block computes norm(y) rather than norm(y * silu(z)), so it has no gate branch to receive them"});return e}const Sa={id:An,label:"Codestral-Mamba (Mamba-2 / SSD)",modelTypes:["mamba2"],architectures:["Mamba2ForCausalLM","MambaCodestralForCausalLM"],describe(r){const e=ne(r,"hidden_size"),t=ne(r,"num_hidden_layers"),o=ne(r,"vocab_size"),n=ne(r,"state_size"),s=ne(r,"conv_kernel"),a=ne(r,"num_heads"),i=Fe(r,["n_groups"])??1,c=Fe(r,["chunk_size"])??256,d=Ar(r,e),h=Mr(d,e,"Codestral-Mamba"),l=Fe(r,["head_dim"]);if(d%a!==0)throw new Error(`import/foreign: Codestral-Mamba d_inner ${d} is not divisible by num_heads ${a}`);if(l!==void 0&&l*a!==d)throw new Error(`import/foreign: Codestral-Mamba config is inconsistent — head_dim ${l} × num_heads ${a} = ${l*a}, but d_inner is ${d}`);const u=Array.from({length:t},()=>({type:"mamba2"})),m={vocabSize:o,dModel:e,numLayers:t,layers:u,dState:n,dConv:s,expand:h,nHeads:a,nGroups:i,chunkLen:c},f={vocabSize:o,dModel:e,numLayers:t,dInner:d,dState:n,dConv:s,nHeads:a,nGroups:i};return{modelConfig:m,plan:{adapter:An,rules:Ea(f),discards:La(f)}}}},wt=[Aa,ka,Sa];function Fa(r){const e=r.architectures;return Array.isArray(e)?e.filter(t=>typeof t=="string"):[]}function Da(r){const e=r.model_type;return typeof e=="string"?e:void 0}function Ba(r,e){const t=[...r,e??""].join(" ").toLowerCase();return t.includes("mamba")||t.includes("ssm")?!1:/llama|mistral|qwen|gpt|phi|gemma|falcon(?!_?mamba)|starcoder|deepseek|olmo|attention|forcausallm/.test(t)}function Mn(){return wt.map(r=>`${r.label} — architectures ${r.architectures.join(" / ")}, model_type ${r.modelTypes.join(" / ")}`).join("; ")}function Ca(r){const e=Fa(r),t=Da(r),o=wt.find(a=>e.some(i=>a.architectures.includes(i)));if(o)return o;const n=t?wt.find(a=>a.modelTypes.includes(t)):void 0;if(n)return n;const s=e.length>0?`architectures [${e.join(", ")}]`:t?`model_type "${t}"`:"a config declaring neither `architectures` nor `model_type`";throw Ba(e,t)?new Error(`import/foreign: ${s} is a TRANSFORMER checkpoint — its attention weights (q/k/v/o projections, positional embeddings) have no counterpart in a state-space mixer, so no weight port can exist for it at any tensor naming. Transformer coders (IQuest, NousCoder, Maincoder and the like) can only be brought across by DISTILLATION — train this engine's SSM against the transformer's outputs. Weight porting is supported only for: ${Mn()}.`):new Error(`import/foreign: unsupported checkpoint — ${s}. Supported: ${Mn()}. A transformer checkpoint cannot be weight-ported at all; distillation is the only route.`)}function Ta(r,e){const t=Ca(r),{modelConfig:o,plan:n}=t.describe(r);return{...wa(n,e),modelConfig:o}}function sl(r,e){return Ta(r,xr(e))}function al(r,e){const t=r.parameters(),o=new Set(t.map(s=>s.name)),n=[...e.weights.keys()].filter(s=>!o.has(s));if(n.length>0)throw new Error(`import/foreign: ported tensors ${n.slice(0,5).map(s=>`"${s}"`).join(", ")}${n.length>5?` (+${n.length-5} more)`:""} have no parameter on this model — build it from the port's modelConfig`);for(const s of t){const a=e.weights.get(s.name);if(!a)throw new Error(`import/foreign: no ported tensor for parameter "${s.name}" — the model was built from a different config than the port's modelConfig`);if(a.length!==s.numel)throw new Error(`import/foreign: parameter "${s.name}" expects ${s.numel} elements, the port produced ${a.length}`);we(r.device,s.buf,a)}}function Ge(r){throw new Error(`import/foreign: cannot read a Mamba-1 config from these tensors — ${r}`)}function il(r){const e=new Map(r.map(p=>[kr(p.name),p])),t=p=>e.get(p)?.shape,o=t("backbone.embeddings.weight")??t("backbone.embedding.weight");(!o||o.length!==2)&&Ge("no backbone.embedding(s).weight [vocab, d_model]");const[n,s]=o;let a=0;for(;e.has(`backbone.layers.${a}.mixer.in_proj.weight`);)a++;a===0&&Ge("no backbone.layers.N.mixer.in_proj.weight");const i="backbone.layers.0.mixer",c=t(`${i}.in_proj.weight`),d=t(`${i}.conv1d.weight`),h=t(`${i}.A_log`),l=t(`${i}.x_proj.weight`);(!d||!h||!l)&&Ge("layer 0 is missing conv1d.weight, A_log or x_proj.weight");const u=c[0]/2,m=h[1],f=d[d.length-1],g=l[0]-2*m;return(!Number.isInteger(u)||g<=0)&&Ge(`inconsistent shapes (in_proj ${c.join("×")}, x_proj ${l.join("×")})`),{model_type:"mamba",architectures:["MambaForCausalLM"],vocab_size:n,hidden_size:s,num_hidden_layers:a,intermediate_size:u,state_size:m,conv_kernel:f,time_step_rank:g}}function cl(r,e,t={}){if(!Number.isInteger(e)||e<=0)throw new Error(`import/foreign: vocabulary size must be a positive integer, got ${e}`);const o=r.modelConfig.vocabSize;if(e===o)return r;const n=r.weights.get("embedding");if(!n)throw new Error('import/foreign: the port has no "embedding" to resize');const s=r.modelConfig.dModel,a=new Float32Array(e*s);a.set(n.subarray(0,Math.min(o,e)*s));const i=[...r.synthesisedTargets];if(e>o){const d=t.std??.02,h=new te(t.seed??1);a.set(me((e-o)*s,d,()=>h.next()),o*s),i.push({target:"embedding",value:d,reason:`rows ${o}..${e-1} drawn from N(0, ${d}²) to reach a ${e}-token vocabulary`})}const c=new Map(r.weights);return c.set("embedding",a),{...r,weights:c,synthesisedTargets:i,modelConfig:{...r.modelConfig,vocabSize:e}}}const Na=`

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
`,ll=`

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
`,dl={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},Lr={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},Sr=8,ce=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],Pa=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],Wt=[0,.2,.5,.5,.8,.5,.7,.5];function ot(r,e){const t=Pa[r];return t?Number.isNaN(e)?t[0]:Math.max(t[0],Math.min(t[1],e)):e}function hl(r){for(let e=0;e<r.length&&e<Sr;e++)r[e]=ot(e,r[e]);return r}function $a(){return Float32Array.from(Wt)}function Fr(r){const e={};for(let t=0;t<ce.length;t++)e[ce[t]]=r[t]??0;return e}function Ia(r){const e=$a();for(let t=0;t<ce.length;t++){const o=r[ce[t]];typeof o=="number"&&!Number.isNaN(o)&&(e[t]=ot(t,o))}return e}function le(r){return((typeof r=="number"&&!Number.isNaN(r)?Math.max(0,Math.min(100,r)):50)-50)/50}function Dr(r){const e=Fr(Wt);if(!r)return e;const t=le(r.openness),o=le(r.emotionality),n=le(r.conscientiousness),s=le(r.extraversion),a=le(r.regulatoryFocus),i=le(r.riskTolerance),c=le(r.grit),d=le(r.stimulation),h=(l,u)=>{e[l]=ot(Lr[l],u)};return h("driveCuriosity",.5+.35*t+.15*d),h("exploration",.4+.3*t+.25*i+.15*a),h("driveCaution",.5+.3*n-.3*i-.2*a+.15*o),h("arousal",.2+.2*o+.1*s),h("driveSocial",.5+.35*s),h("driveEffort",.8+.15*c+.1*n),h("valence",0+.1*a-.1*o),h("attention",.7+.1*n),e}function ul(r){return Ia(Dr(r))}function yt(r,e){return ot(Lr[r],e)}function vt(){return Fr(Wt)}function fl(r){if(r.length===0)return vt();const e=vt();for(const t of ce)e[t]=0;for(const t of r){const o=Dr(t);for(const n of ce)e[n]+=o[n]}for(const t of ce)e[t]/=r.length;return e}function En(r,e){const t={...r};for(const o of ce){const n=e[o];typeof n=="number"&&!Number.isNaN(n)&&(t[o]=yt(o,t[o]+n))}return t}const za=r=>Math.max(0,Math.min(1,r.intensity??.5));function ml(r){const e=za(r);switch(r.kind){case"success":return{valence:.5*e,arousal:-.15*e,driveCaution:-.1*e,driveEffort:-.05*e};case"progress":return{valence:.25*e,arousal:.05*e,driveEffort:-.03*e};case"error":return{valence:-.45*e,arousal:.4*e,driveCaution:.3*e,attention:.15*e};case"blocked":return{valence:-.35*e,arousal:.3*e,driveEffort:-.15*e,driveSocial:.2*e};case"risk":return{arousal:.35*e,driveCaution:.4*e,attention:.2*e,exploration:-.15*e};case"feedback":{const t=Math.sign(r.sign??1)||1;return{valence:.4*e*t,arousal:.1*e,driveSocial:.1*e}}case"idle":return{arousal:-.2*e,driveEffort:.15*e};default:return{}}}function gl(r,e,t={}){const o=t.rate??.1,n=t.fatigue??0,s={...r};for(const a of ce)s[a]=yt(a,s[a]+o*(e[a]-s[a]));return n>0&&(s.driveEffort=yt("driveEffort",s.driveEffort-n)),s}function ja(r,e=.5){const t=r.arousal-e,o=1-2.8*t*t;return Math.max(.1,Math.min(1,o))}function xt(r){let e=.5*r.exploration+.3*r.driveCuriosity;return e+=.15*r.valence,e-=.25*(1-r.driveEffort),e-=.2*(r.driveCaution-.5),Math.max(0,Math.min(1,e))}function pl(r,e){if(e.length===0)return{choice:null,exploreBias:xt(r)};const t=xt(r);let o=e[0],n=-1/0;for(const s of e){const a=Math.max(0,Math.min(1,s.novelty)),i=-Math.abs(a-t);i>n&&(n=i,o=s)}return{choice:o,exploreBias:t}}const dt=.6,ht=.4;function Wa(r){const e=[],t={},o=c=>{t.thinkLevel!=="high"&&(t.thinkLevel=c)};r.valence<=-.4?(e.push("Affect (negative): recent steps have gone badly — slow down, avoid rash or destructive actions, and re-verify your assumptions before proceeding."),o("high"),t.reasoningLevel="on"):r.valence>=.4&&e.push("Affect (positive): things are going well — keep momentum, but don't get sloppy."),r.arousal>=.7?(e.push("Arousal (heightened): you are highly activated — resist the urge to rush; double-check before any irreversible step."),o("high")):r.arousal<=.15&&e.push("Arousal (low): this is routine — keep it lightweight and efficient."),r.driveCaution>=dt?(e.push("Drive (caution): heightened — prefer reversible steps, add guardrails, and confirm risky or destructive operations."),o("medium")):r.driveCaution<=ht&&e.push("Drive (caution): relaxed — bias to action on low-risk work."),r.driveCuriosity>=dt&&e.push("Drive (curiosity): high — it is appropriate to investigate and consider alternative approaches."),r.driveEffort<=ht&&e.push("Drive (effort): energy is low — keep scope tight, avoid over-engineering, checkpoint progress, and consider escalating rather than grinding."),r.driveSocial>=dt?e.push("Drive (social): communicate proactively — surface progress and ask for input when blocked."):r.driveSocial<=ht&&e.push("Drive (social): work heads-down — narrate only what matters."),ja(r)<=.5&&(e.push("Attention (degraded): your attention gate is low — re-read the task carefully and do not skip verification steps."),o("medium"));const s=xt(r);s>=.7?e.push("Action selection: lean exploratory — try a novel approach before settling on the obvious one."):s<=.3&&e.push("Action selection: lean exploitative — use the proven, known approach and avoid unnecessary detours.");let a=0;a+=.2*(r.exploration-.5)*2,a+=.06*(r.driveCuriosity-.5)*2,a+=.08*r.valence,a-=.16*(r.driveCaution-.5)*2,a-=.08*Math.max(0,r.arousal-.7);const i=Math.max(-.3,Math.min(.3,Math.round(a*100)/100));return Math.abs(i)>=.02&&(t.temperatureDelta=i),{directives:e,params:t}}const Ra="Current affective state (execute accordingly):";function _l(r){if(!r)return"";const{directives:e}=Wa(r);return e.length===0?"":[Ra,...e.map(t=>`- ${t}`)].join(`
`)}const Oa=/\b(delete|drop|truncate|destroy|wipe|prod(uction)?|migrat|secret|credential|password|payment|billing|charge|refund|deploy|force[- ]?push|rm\s+-rf|irreversible|security|auth|breaking)\b/i,Ua=/\b(refactor|rewrite|architecture|complex|large|entire|whole|across|end[- ]to[- ]end|overhaul)\b/i;function bl(r,e=vt()){const t=r||"";let o=e;return Oa.test(t)&&(o=En(o,{driveCaution:.3,arousal:.25,attention:.15,exploration:-.1})),Ua.test(t)&&(o=En(o,{driveCuriosity:.2,arousal:.1,exploration:.1})),o}const Ha={inputDim:32,hiddenDim:16,stateDim:Sr,rewardWeight:.5},Ln=1280131651,Ga=296863214;class wl{config;win;ws;aLogit;woutState;boutState;woutReward;boutReward;gWin;gWs;gALogit;gWoutState;gBoutState;gWoutReward;gBoutReward;constructor(e={}){const t={...Ha,...e};if(t.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${t.hiddenDim})`);this.config=t;const{inputDim:o,hiddenDim:n,stateDim:s}=t,a=new te((e.seed??Ga)>>>0||1),i=d=>{const h=Math.max(a.next(),1e-12),l=a.next();return d*Math.sqrt(-2*Math.log(h))*Math.cos(2*Math.PI*l)},c=(d,h)=>{const l=new Float32Array(d);for(let u=0;u<d;u++)l[u]=i(h);return l};this.win=c(n*o,.1),this.ws=c(n*s,.1),this.aLogit=c(n,.05),this.woutState=c(s*n,.05),this.boutState=new Float32Array(s),this.woutReward=c(n,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(e,t,o){const n=this._forwardCached(e,t,o);return{hidden:n.hn,delta:n.delta,reward:n.reward}}_forwardCached(e,t,o){const{inputDim:n,hiddenDim:s,stateDim:a}=this.config,i=Float32Array.from({length:n},(g,p)=>e[p]??0),c=Float32Array.from({length:s},(g,p)=>t[p]??0),d=Float32Array.from({length:a},(g,p)=>o[p]??0),h=new Float32Array(s),l=new Float32Array(s),u=new Float32Array(s);for(let g=0;g<s;g++){let p=0;const _=g*n;for(let w=0;w<n;w++)p+=this.win[_+w]*i[w];const b=g*a;for(let w=0;w<a;w++)p+=this.ws[b+w]*d[w];h[g]=ke(this.aLogit[g]),l[g]=Math.tanh(p),u[g]=h[g]*c[g]+(1-h[g])*l[g]}const m=new Float32Array(a);for(let g=0;g<a;g++){let p=this.boutState[g];const _=g*s;for(let b=0;b<s;b++)p+=this.woutState[_+b]*u[b];m[g]=Math.tanh(p)}let f=this.boutReward[0];for(let g=0;g<s;g++)f+=this.woutReward[g]*u[g];return{x:i,sPrev:d,hPrev:c,a:h,t:l,hn:u,delta:m,reward:f}}backwardStep(e,t,o,n,s){const{inputDim:a,hiddenDim:i,stateDim:c,rewardWeight:d}=this.config,h=this._forwardCached(e,t,o);let l=0;const u=new Float32Array(c);for(let p=0;p<c;p++){const _=h.delta[p]-(n[p]??0);l+=.5*_*_,u[p]=_}const m=h.reward-s;l+=.5*d*m*m;const f=d*m,g=new Float32Array(i);for(let p=0;p<c;p++){const _=u[p]*(1-h.delta[p]*h.delta[p]);this.gBoutState[p]=this.gBoutState[p]+_;const b=p*i;for(let w=0;w<i;w++)this.gWoutState[b+w]=this.gWoutState[b+w]+_*h.hn[w],g[w]=g[w]+_*this.woutState[b+w]}this.gBoutReward[0]=this.gBoutReward[0]+f;for(let p=0;p<i;p++)this.gWoutReward[p]=this.gWoutReward[p]+f*h.hn[p],g[p]=g[p]+f*this.woutReward[p];for(let p=0;p<i;p++){const _=h.a[p],b=h.t[p];this.gALogit[p]=this.gALogit[p]+g[p]*(h.hPrev[p]-b)*_*(1-_);const w=g[p]*(1-_)*(1-b*b),y=p*a;for(let E=0;E<a;E++)this.gWin[y+E]=this.gWin[y+E]+w*h.x[E];const x=p*c;for(let E=0;E<c;E++)this.gWs[x+E]=this.gWs[x+E]+w*h.sPrev[E]}return{loss:l,hidden:h.hn}}exportWeights(e={}){const t=e.fp16??!1,o=this.parameters(),n=o.reduce((h,l)=>h+l.numel,0),s=5,a=s*4,i=t?n*2:n*4,c=new ArrayBuffer(a+i),d=new Uint32Array(c,0,s);if(d[0]=Ln,d[1]=t?2:1,d[2]=this.config.inputDim,d[3]=this.config.hiddenDim,d[4]=this.config.stateDim,t){const h=new Float32Array(n);let l=0;for(const m of o)h.set(m.data,l),l+=m.numel;const u=Pe(h);new Uint16Array(c,a,n).set(u)}else{const h=new Float32Array(c,a,n);let l=0;for(const u of o)h.set(u.data,l),l+=u.numel}return c}loadWeights(e){const t=new Uint32Array(e,0,5);if(t[0]!==Ln)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const o=t[1],n=t[2],s=t[3],a=t[4];if(n!==this.config.inputDim||s!==this.config.hiddenDim||a!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${n}/${s}/${a} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const i=this.parameters(),c=i.reduce((u,m)=>u+m.numel,0),d=20;let h;o===2?h=$e(new Uint16Array(e,d,c)):h=new Float32Array(e.slice(d,d+c*4));let l=0;for(const u of i)u.data.set(h.subarray(l,l+u.numel)),l+=u.numel}}const Ka=48;function qa(r,e){const t=new ArrayBuffer(Ka);return new Uint32Array(t,0,1).set([r]),new Float32Array(t,4,8).set([e.lr,e.beta1,e.beta2,e.eps,e.weightDecay,e.beta1_t,e.beta2_t,e.maxDelta]),t}class Br{label;head;device;_moments=null;_step=0;_skippedNonFinite=0;_adamwPipeline;constructor(e,t=null,o="HeadTrainer"){this.label=o,this.head=e,this.device=t,this._adamwPipeline=t?U(t,Na,"adamw_update"):null}get skippedNonFinite(){return this._skippedNonFinite}get diverged(){return this._skippedNonFinite>0}get gpuTraining(){return this.device!=null&&this._adamwPipeline!=null}_initMoments(){this._moments||(this._moments=this.head.parameters().map(e=>({m:new Float32Array(e.numel),v:new Float32Array(e.numel)})))}async train(e,t={}){if(e.length===0)throw new Error(`${this.label}.train: no samples`);const{learningRate:o=.05,epochs:n=50,weightDecay:s=0,beta1:a=.9,beta2:i=.999,eps:c=1e-8,maxGradNorm:d=1,onEpochEnd:h=null}=t;this._initMoments();const l=[];for(let u=0;u<n;u++){this.head.zeroGrad();let m=0;for(const x of e)m+=this.head.accumulate(x);const f=this.head.gradients(),g=1/e.length;for(const x of f)for(let E=0;E<x.data.length;E++)x.data[E]*=g;const p=Xa(f,d);this._step++;const _=Math.pow(a,this._step),b=Math.pow(i,this._step),w={lr:o,weightDecay:s,beta1:a,beta2:i,eps:c,beta1_t:_,beta2_t:b,maxDelta:0};this.gpuTraining?await this._adamwStepGpu(f,w):this._adamwStepCpu(f,w);const y=m/e.length;l.push(y),h&&h(u+1,y,p)}return l}evaluate(e){if(e.length===0)return 0;let t=0;for(const o of e)t+=this.head.loss(o);return t/e.length}_adamwStepCpu(e,t){const o=this.head.parameters();for(let n=0;n<o.length;n++){const s=this._moments[n];this._skippedNonFinite+=Ke(o[n].data,e[n].data,s.m,s.v,t)}}async _adamwStepGpu(e,t){const o=this.device,n=this._adamwPipeline,s=this.head.parameters();for(let a=0;a<s.length;a++){const i=s[a],c=this._moments[a];this._skippedNonFinite+=Va(e[a].data);const d=Q(o,i.data,!0),h=Q(o,e[a].data,!1),l=Q(o,c.m,!0),u=Q(o,c.v,!0),m=j(o,qa(i.numel,t)),f=$(o,n,[m,d,h,l,u]);I(o,n,f,[T(i.numel,256),1,1]),i.data.set((await de(o,d,i.numel*4)).subarray(0,i.numel)),c.m.set((await de(o,l,i.numel*4)).subarray(0,i.numel)),c.v.set((await de(o,u,i.numel*4)).subarray(0,i.numel)),d.destroy(),h.destroy(),l.destroy(),u.destroy(),m.destroy()}}}function Va(r){let e=0;for(let t=0;t<r.length;t++)Number.isFinite(r[t])||e++;return e}function Xa(r,e){let t=0,o=0;for(const s of r)for(let a=0;a<s.data.length;a++){const i=s.data[a]*s.data[a];t+=i,Number.isFinite(i)&&(o+=i)}const n=Math.sqrt(o);if(n>e&&n>0){const s=e/n;for(const a of r)for(let i=0;i<a.data.length;i++)a.data[i]*=s}return Math.sqrt(t)}function Cr(r){const e=new Float32Array(r.reduce((o,n)=>o+n.numel,0));let t=0;for(const o of r)e.set(o.data,t),t+=o.numel;return e}function Tr(r,e){const t=r.reduce((n,s)=>n+s.numel,0);if(e.length!==t)throw new Error(`assignParams: expected ${t} values, got ${e.length}`);let o=0;for(const n of r){for(let s=0;s<n.numel;s++)n.data[s]=e[o+s];o+=n.numel}}function Ya(r){return{parameters:()=>r.parameters(),gradients:()=>r.gradients(),zeroGrad:()=>r.zeroGrad(),accumulate:e=>r.backwardStep(e.input,r.initHidden(),e.state,e.deltaTarget,e.reward).loss,loss:e=>{const{rewardWeight:t}=r.config,o=r.forward(e.input,r.initHidden(),e.state);let n=0;for(let a=0;a<o.delta.length;a++){const i=o.delta[a]-(e.deltaTarget[a]??0);n+=.5*i*i}const s=o.reward-e.reward;return n+=.5*t*s*s,n}}}class yl{model;device;_trainer;constructor(e,t=null){this.model=e,this.device=t,this._trainer=new Br(Ya(e),t,"LimbicTrainer")}get gpuTraining(){return this._trainer.gpuTraining}train(e,t={}){return this._trainer.train(e,t)}evaluate(e){return this._trainer.evaluate(e)}}const Qa={kind:"regress",id:"limbic.affect",description:"How an experience moves the agent's affective state, and how rewarding it was.",features:{numeric:r=>[...Array.from(r.embedding),...Array.from(r.state)]},engines:[{tier:"local",engine:"head",head:"mlp"}],train:{minSamples:1,trainedBy:"LimbicTrainer"},output:{decode:r=>({delta:Float32Array.from(r.scores.slice(0,-1)),reward:r.scores[r.scores.length-1]??0})}};function vl(r){const{inputDim:e,stateDim:t}=r.config;return{predict(o){if(o.length!==e+t)throw new Error(`limbic.affect: expected ${e+t} features (embedding ${e} + state ${t}), got ${o.length}`);const n=r.forward(o.subarray(0,e),r.initHidden(),o.subarray(e));return{scores:[...Array.from(n.delta),n.reward],confidence:1}},exportParams:()=>Cr(r.parameters()),importParams:o=>Tr(r.parameters(),o)}}const xl=`

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
`;function Ja(){const r=new Uint8Array(8);return globalThis.crypto.getRandomValues(r),Array.from(r,e=>e.toString(16).padStart(2,"0")).join("")}const Za=new Set(["send","submit","pay","purchase","buy","order","checkout","delete","remove","confirm","transfer","publish","post","sign","approve","book","cancel","erase","wipe","format","uninstall","senden","absenden","bezahlen","kaufen","bestellen","löschen","entfernen","bestätigen","überweisen","veröffentlichen","enviar","pagar","comprar","pedido","eliminar","borrar","confirmar","transferir","publicar","envoyer","payer","acheter","commander","supprimer","confirmer","virement","publier"]),ei=["发送","提交","支付","付款","购买","下单","删除","确认","转账","发布"];function Sn(r){const e=r.toLowerCase();return ei.some(t=>e.includes(t))?!0:e.split(/[^\p{L}\p{N}]+/u).some(t=>t.length>0&&Za.has(t))}function ue(r){return r?r.name.trim()||r.automationId.trim():""}function ti(r){switch(r.kind){case"click":return Sn(ue(r.target));case"keys":return r.keys.toLowerCase()==="enter"&&Sn(ue(r.target));case"setValue":return!1}}function kl(r,e={},t=Date.now()){const o=new Set(e.removed??[]),n=new Set(e.fixed??[]),s=[],a=[];for(const i of r.steps){if(o.has(i.id))continue;const c=i.action;let d;if(c.kind==="setValue")if(!c.secret&&n.has(i.id))d={kind:"setValue",target:c.target,value:{from:"literal",text:c.value}};else{const l=Fn(e.paramNames?.[i.id]??"")||Fn(ue(c.target))||"value",u=ni(s,l);s.push({name:u,label:ue(c.target),default:c.secret?null:c.value,secret:!!c.secret}),d={kind:"setValue",target:c.target,value:{from:"param",name:u}}}else d=c;a.push({id:i.id,action:d,requiresApproval:e.approvals?.[i.id]??ti(c),screenshot:i.screenshot??null})}return{id:Ja(),name:e.name?.trim()||r.name,program:r.program,args:[...r.args],params:s,steps:a,sourceEpisode:r.id,createdAt:t,routine:null}}function Fn(r){return r.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join("_").slice(0,40).replace(/_+$/,"")}function ni(r,e){if(!r.some(t=>t.name===e))return e;for(let t=2;;t++){const o=`${e}_${t}`;if(!r.some(n=>n.name===o))return o}}const ut=6e4,ft=864e5;function ri(r,e,t,o){if(r.every==="minutes"){const c=Math.max(1,r.minutes)*ut;return e==null||t-e>=c}const n=o*ut,s=t+n,i=s-(s%ft+ft)%ft+Math.min(23,Math.max(0,r.hour))*36e5+Math.min(59,Math.max(0,r.minute))*ut;return s>=i&&(e==null||e+n<i)}function Al(r,e,t){return r.filter(o=>o.routine?.enabled&&ri(o.routine.schedule,o.routine.lastRunAt,e,t)).sort((o,n)=>(o.routine?.lastRunAt??0)-(n.routine?.lastRunAt??0))}function _e(r){const e="target"in r&&r.target?r.target.windowTitle:"";return e?` in “${e}”`:""}function Nr(r){switch(r.kind){case"click":return`Click “${ue(r.target)}”${_e(r)}.`;case"keys":return r.target?`Press ${r.keys} in “${ue(r.target)}”${_e(r)}.`:`Press ${r.keys}.`;case"setValue":{const e=`“${ue(r.target)}”`;return typeof r.value=="string"?"secret"in r&&r.secret?`Enter the secret for ${e}${_e(r)}.`:`Set ${e} to “${r.value}”${_e(r)}.`:r.value.from==="param"?`Set ${e} to <${r.value.name}>${_e(r)}.`:`Set ${e} to “${r.value.text}”${_e(r)}.`}}}function Pr(r){return r.split(/[\\/]/).pop()??r}function oi(r){const e=[`Task: ${r.name} (${Pr(r.program)})`];return r.steps.forEach((t,o)=>e.push(`${o+1}. ${Nr(t.action)}${t.requiresApproval?" Ask before doing this.":""}`)),e.join(`
`)}function si(r){const e=[`Task: ${r.name} (${Pr(r.program)})`];return r.steps.forEach((t,o)=>e.push(`${o+1}. ${Nr(t.action)}`)),e.join(`
`)}function Ml(r,e){return Rt(r,e).map(t=>t.text).join(`

`)}function Rt(r,e){const t=new Set(e.map(o=>o.sourceEpisode));return[...e.map(o=>({id:o.id,text:oi(o)})),...r.filter(o=>!t.has(o.id)).map(o=>({id:o.id,text:si(o)}))]}function El(r,e){const t=[];let o=[],n=0;for(const s of r){const a=o.length?s.text.length+2:s.text.length;if(o.length&&n+a>e){t.push(o),o=[],n=0,o.push(s),n=s.text.length;continue}o.push(s),n+=a}return o.length&&t.push(o),t}const ai=864e5;function Dn(r,e){return new Date(r+e*6e4).toISOString().slice(0,10)}function Ll(r,e){const t=m=>{const f=r.learned[m];return typeof f=="number"&&f>=1&&f<=e.modelIndex},o=Rt(r.episodes,r.skills),n=o.filter(m=>t(m.id)).length,s={running:0,succeeded:0,failed:0,stopped:0,denied:0},a={approved:0,denied:0},i=[];for(const m of r.episodes)i.push({region:"hippocampus",kind:"demonstration",id:m.id,name:m.name,at:m.startedAt});for(const m of r.skills)i.push({region:"basalGanglia",kind:"skill",id:m.id,name:m.name,at:m.createdAt});for(const m of r.runs){s[m.status]=(s[m.status]??0)+1,i.push({region:"basalGanglia",kind:"run",id:m.id,name:m.skillName,at:m.startedAt,detail:m.status});for(const f of m.steps)f.outcome!=="approved"&&f.outcome!=="denied"||(a[f.outcome]++,i.push({region:"amygdala",kind:"approval",id:m.id,name:m.skillName,at:f.at,detail:f.outcome}))}const c=r.adaptations.filter(m=>m.index<=e.modelIndex).reverse();for(const m of c)i.push({region:"neocortex",kind:"adaptation",id:m.version,name:m.version,at:m.at,detail:m.loss.toFixed(3)});const d=Math.max(1,e.days??30),h=[],l=new Map;for(let m=d-1;m>=0;m--){const f=Dn(e.now-m*ai,e.utcOffsetMinutes);if(l.has(f))continue;const g={day:f,demonstrations:0,skills:0,runs:0,learned:0};l.set(f,g),h.push(g)}const u=(m,f,g=1)=>{const p=l.get(Dn(m,e.utcOffsetMinutes));p&&(p[f]+=g)};for(const m of r.episodes)u(m.startedAt,"demonstrations");for(const m of r.skills)u(m.createdAt,"skills");for(const m of r.runs)u(m.startedAt,"runs");for(const m of c)u(m.at,"learned",m.learned.length);return{regions:{hippocampus:r.episodes.length,basalGanglia:r.skills.length,amygdala:a.approved+a.denied,hypothalamus:r.skills.filter(m=>m.routine?.enabled).length,neocortex:n},learned:n,pending:o.length-n,runs:s,approvals:a,adaptations:c,days:h,recent:i.sort((m,f)=>f.at-m.at).slice(0,Math.max(0,e.recent??40))}}const kt="evermind.experience/1",ii=500,ci=200;function At(){return{schema:kt,episodes:[],skills:[],runs:[],learned:{},adaptations:[],curated:{}}}function Bn(r){const e=r;return!e||e.schema!==kt?At():{schema:kt,episodes:Array.isArray(e.episodes)?e.episodes:[],skills:Array.isArray(e.skills)?e.skills:[],runs:Array.isArray(e.runs)?e.runs:[],learned:e.learned&&typeof e.learned=="object"&&!Array.isArray(e.learned)?e.learned:{},adaptations:Array.isArray(e.adaptations)?e.adaptations:[],curated:e.curated&&typeof e.curated=="object"&&!Array.isArray(e.curated)?e.curated:{}}}function li(r){return{id:r.id,name:r.name,program:r.program,startedAt:r.startedAt,steps:r.steps.length}}class be{onChange;data;constructor(e,t){this.onChange=t,this.data=e?Bn(e):At()}load(e){this.data=Bn(e)}async changed(){await this.onChange?.(this.data)}static upsert(e,t){const o=e.findIndex(n=>n.id===t.id);o>=0?e[o]=t:e.push(t)}static remove(e,t){const o=e.findIndex(n=>n.id===t);return o<0?!1:(e.splice(o,1),!0)}async putEpisode(e){be.upsert(this.data.episodes,e),await this.changed()}async getEpisode(e){return this.data.episodes.find(t=>t.id===e)}async listEpisodes(){return[...this.data.episodes].sort((e,t)=>t.startedAt-e.startedAt).map(li)}async deleteEpisode(e){const t=be.remove(this.data.episodes,e);return delete this.data.learned[e],delete this.data.curated[e],t&&await this.changed(),t}async putSkill(e){be.upsert(this.data.skills,e),await this.changed()}async getSkill(e){return this.data.skills.find(t=>t.id===e)}async listSkills(){return[...this.data.skills].sort((e,t)=>t.createdAt-e.createdAt)}async deleteSkill(e){const t=be.remove(this.data.skills,e);return delete this.data.learned[e],delete this.data.curated[e],t&&await this.changed(),t}async putRun(e){be.upsert(this.data.runs,e),this.data.runs.sort((t,o)=>o.startedAt-t.startedAt),this.data.runs.length=Math.min(this.data.runs.length,ii),await this.changed()}async appendRunStep(e,t){const o=this.data.runs.find(n=>n.id===e);return o?(o.steps.push(t),await this.changed(),!0):!1}async getRun(e){return this.data.runs.find(t=>t.id===e)}async listRuns(e){return this.data.runs.slice(0,Math.max(0,e))}async recordAdaptation(e){for(const t of e.learned)this.data.learned[t]=e.index,delete this.data.curated[t];this.data.adaptations.unshift(e),this.data.adaptations.length=Math.min(this.data.adaptations.length,ci),await this.changed()}async recordCuration(e){for(const t of e.kept)delete this.data.curated[t];Object.assign(this.data.curated,e.dropped),await this.changed()}async snapshot(){return structuredClone(this.data)}async clear(){this.data=At(),await this.changed()}}function fe(r){switch(r.engine){case"classical":return`local:classical:${r.algorithm}`;case"head":return`local:head:${r.head}`;case"onnx":return`local:onnx:${r.model}`;case"workers-ai":return`cloud:workers-ai:${r.model}`}}class $r{_tasks=new Map;register(e){if(!er.test(e.id))throw new Error(`MlTaskRegistry: malformed task id '${e.id}'`);if(this._tasks.has(e.id))throw new Error(`MlTaskRegistry: task '${e.id}' is already registered`);if(e.engines.length===0)throw new Error(`MlTaskRegistry: task '${e.id}' lists no engine`);if(e.kind==="classify"&&!(e.output.labels&&e.output.labels.length>=2))throw new Error(`MlTaskRegistry: classify task '${e.id}' needs at least two output labels`);return this._tasks.set(e.id,e),e}get(e){return this._tasks.get(e)}require(e){const t=this.get(e);if(!t)throw new Error(`MlTaskRegistry: unknown task '${e}'`);return t}has(e){return this._tasks.has(e)}list(){return[...this._tasks.values()]}}function re(r,e){return Math.log1p(Math.max(0,r))/Math.log1p(Math.max(e,1))}function di(r,e,t=4){return e>0?Math.max(0,Math.min(t,r/e)):0}async function Ir(r,e,t){const o=[];if(r.text){if(!t)throw new Error("extractFeatures: this task embeds text but no embedder was supplied");o.push(await t.embed(r.text(e)))}if(r.numeric){const a=r.numeric(e);for(const i of a)if(!Number.isFinite(i))throw new Error(`extractFeatures: non-finite numeric feature ${i}`);o.push(a)}if(o.length===0)throw new Error("extractFeatures: the feature spec has neither text nor numeric fields");const n=new Float32Array(o.reduce((a,i)=>a+i.length,0));let s=0;for(const a of o)n.set(a,s),s+=a.length;return n}async function hi(r,e,t){const o=[];for(const n of e)o.push(await Ir(r,n,t));return o}class ui{_m=new Map;get(e,t){return this._m.get(`${e}|${t}`)}set(e,t,o){this._m.set(`${e}|${t}`,o)}}class Sl{capacity;_d=[];constructor(e=500){this.capacity=e}record(e){this._d.push(e),this._d.length>this.capacity&&this._d.splice(0,this._d.length-this.capacity)}list(){return this._d}summary(){const e={},t={};for(const o of this._d){const n=e[o.taskId]??={runs:0,byEngine:{},unanswered:0,meanConfidence:null};if(n.runs++,o.engine==null){n.unanswered++;continue}n.byEngine[o.engine]=(n.byEngine[o.engine]??0)+1;const s=t[o.taskId]??={s:0,n:0};s.s+=o.confidence??0,s.n++,n.meanConfidence=s.s/s.n}return e}}class zr extends Error{taskId;decision;constructor(e,t){super(`runMlTask(${e}): no engine could answer in '${t.mode}' mode (${t.skipped.map(o=>`${o.engine}: ${o.reason}${o.detail?` (${o.detail})`:""}`).join(", ")||"none allowed"})`),this.taskId=e,this.decision=t,this.name="MlEngineUnavailableError"}}function fi(r,e,t){switch(e){case"local-only":return r.engines.filter(o=>o.tier==="local");case"hybrid":return[...r.engines.filter(o=>o.tier==="local"),...r.engines.filter(o=>o.tier==="cloud")];case"specific":{if(t==null)throw new Error(`runMlTask(${r.id}): 'specific' mode needs ctx.engine`);const o=typeof t=="string"?t:fe(t),n=r.engines.filter(s=>fe(s)===o);if(n.length===0)throw new Error(`runMlTask(${r.id}): engine '${o}' is not one of this task's engines`);return n}default:{const o=e;throw new Error(`runMlTask(${r.id}): unknown inference mode '${String(o)}'`)}}}const mt=r=>r instanceof Error?r.message:String(r);async function mi(r,e,t){const o=t.registry.require(r),n=fi(o,t.mode,t.engine),s=[];let a=null,i=null,c=null;const d=(l,u)=>(t.decisions?.record({taskId:r,mode:t.mode,engine:fe(l),tier:l.tier,confidence:u.confidence,skipped:s}),{output:o.output.decode(u),confidence:u.confidence,engine:l});for(let l=0;l<n.length;l++){const u=n[l],m=fe(u);if(u.tier==="local"){const f=t.models?.get(r,m);if(!f){s.push({engine:m,reason:"unavailable"});continue}if(!a&&i==null)try{a=await Ir(o.features,e,t.embedder)}catch(_){i=_}if(!a){s.push({engine:m,reason:"error",detail:`features: ${mt(i)}`});continue}let g;try{g=f.predict(a)}catch(_){s.push({engine:m,reason:"error",detail:mt(_)});continue}const p=t.mode==="hybrid"&&!!t.cloud&&n.slice(l+1).some(_=>_.tier==="cloud");if(t.minConfidence!=null&&g.confidence<t.minConfidence&&p){s.push({engine:m,reason:"low-confidence",detail:g.confidence.toFixed(3)}),c??={ref:u,p:g};continue}return d(u,g)}if(!t.cloud){s.push({engine:m,reason:"unavailable"});continue}try{return d(u,await t.cloud.run({taskId:r,engine:u,input:e}))}catch(f){s.push({engine:m,reason:"error",detail:mt(f)})}}if(c)return d(c.ref,c.p);const h={taskId:r,mode:t.mode,engine:null,tier:null,confidence:null,skipped:s};throw t.decisions?.record(h),new zr(r,h)}function jr(r,e){const t=Math.min(r.length,e.length);let o=0;for(let n=0;n<t;n++)o+=r[n]*e[n];return o}function Cn(r){return Math.sqrt(jr(r,r))}function gi(r,e){const t=Cn(r),o=Cn(e);return t>0&&o>0?jr(r,e)/(t*o):0}function De(r,e){const t=Math.min(r.length,e.length);let o=0;for(let n=0;n<t;n++){const s=r[n]-e[n];o+=s*s}return o}function Tn(r){if(r.length===0)return Number.NaN;const e=[...r].sort((o,n)=>o-n),t=e.length>>1;return e.length%2?e[t]:(e[t-1]+e[t])/2}function pi(r,e){if(r.length===0)return Number.NaN;const t=[...r].sort((a,i)=>a-i),o=(t.length-1)*Math.min(1,Math.max(0,e)),n=Math.floor(o),s=Math.min(t.length-1,n+1);return t[n]+(o-n)*(t[s]-t[n])}function Xe(r){let e=0;for(const t of r){if(!Number.isInteger(t)||t<0)throw new Error(`class label must be a non-negative integer, got ${t}`);e=Math.max(e,t+1)}return Math.max(e,2)}function oe(r){if(r.length===0)throw new Error("no samples");const e=r[0].length;for(const t of r)if(t.length!==e)throw new Error(`ragged features: expected ${e}, got ${t.length}`);return e}function Ye(r){return r.length?Math.max(...r):0}function Wr(r){const e=new te(r);return()=>e.next()}function Rr(r){return r<=1?0:r===2?1:2*(Math.log(r-1)+.5772156649)-2*(r-1)/r}class Ot{k;metric;classes;_x=[];_y=[];_w=[];constructor(e,t,o){if(this.k=e,this.metric=t,this.classes=o,!(e>=1))throw new Error(`KnnModel: k must be ≥ 1 (got ${e})`)}get size(){return this._x.length}add(e,t=0,o=1){this._x.push(Float32Array.from(e)),this._y.push(t),this._w.push(o)}similarity(e,t){return this.metric==="cosine"?gi(e,t):1/(1+Math.sqrt(De(e,t)))}neighbours(e,t=this.k,o){const n=[];for(let s=0;s<this._x.length;s++)s!==o&&n.push({index:s,similarity:this.similarity(e,this._x[s])});return n.sort((s,a)=>a.similarity-s.similarity||s.index-a.index),n.slice(0,Math.min(t,n.length))}nearest(e){return this.neighbours(e,1)[0]??null}labelOf(e){return this._y[e]}proba(e,t){const o=new Array(this.classes).fill(0);for(const s of this.neighbours(e,this.k,t)){const a=(this.metric==="cosine"?s.similarity+1:s.similarity)*this._w[s.index]+1e-9;o[this._y[s.index]]+=a}const n=o.reduce((s,a)=>s+a,0);return n>0?o.map(s=>s/n):o.map(()=>1/this.classes)}predict(e){const t=this.proba(e);return{scores:t,confidence:Ye(t)}}excluding(e){if(!(e>=0&&e<this._x.length))throw new Error(`KnnModel.excluding: no point ${e} (size ${this._x.length})`);return{predict:t=>{const o=this.proba(t,e);return{scores:o,confidence:Ye(o)}}}}}function _i(r,e={}){oe(r.map(s=>s.x));const t=e.classes??Xe(r.map(s=>s.y)),o=e.k??Math.min(5,Math.max(1,Math.floor(Math.sqrt(r.length)))),n=new Ot(Math.min(o,r.length),e.metric??"cosine",t);for(const s of r)n.add(s.x,s.y,s.weight??1);return n}class bi{logPrior;mean;variance;constructor(e,t,o){this.logPrior=e,this.mean=t,this.variance=o}jointLogLikelihood(e){return this.mean.map((t,o)=>{const n=this.variance[o];let s=this.logPrior[o];if(s===-1/0)return s;for(let a=0;a<t.length;a++){const i=(e[a]??0)-t[a];s+=-.5*Math.log(2*Math.PI*n[a])-i*i/(2*n[a])}return s})}predict(e){const t=Array.from(ve(this.jointLogLikelihood(e)));return{scores:t,confidence:Ye(t)}}}function wi(r,e={}){const t=oe(r.map(l=>l.x)),o=e.classes??Xe(r.map(l=>l.y)),n=new Float64Array(o),s=Array.from({length:o},()=>new Float64Array(t)),a=Array.from({length:o},()=>new Float64Array(t));for(const l of r){const u=l.weight??1;n[l.y]=n[l.y]+u;for(let m=0;m<t;m++)s[l.y][m]=s[l.y][m]+u*l.x[m]}for(let l=0;l<o;l++)if(n[l]>0)for(let u=0;u<t;u++)s[l][u]=s[l][u]/n[l];for(const l of r){const u=l.weight??1;for(let m=0;m<t;m++){const f=l.x[m]-s[l.y][m];a[l.y][m]=a[l.y][m]+u*f*f}}let i=0;for(let l=0;l<o;l++)for(let u=0;u<t;u++)a[l][u]=n[l]>0?a[l][u]/n[l]:0,i=Math.max(i,a[l][u]);const c=(e.varSmoothing??1e-9)*Math.max(i,1e-12)+1e-12;for(let l=0;l<o;l++)for(let u=0;u<t;u++)a[l][u]=a[l][u]+c;const d=n.reduce((l,u)=>l+u,0);if(!(d>0))throw new Error("fitNaiveBayes: the samples carry no weight");const h=Float64Array.from(n,l=>l>0?Math.log(l/d):-1/0);return new bi(h,s,a)}function Or(r,e,t){if(t.length===0||r!=="classify"&&r!=="regress")return null;let o=0,n=0;for(const s of t){const a=s.weight??1,i=e.predict(s.x),c=r==="classify"?-Math.log(Math.max(i.scores[s.y]??0,1e-12)):.5*(i.scores[0]-s.y)**2;o+=a*c,n+=a}return n>0?o/n:null}class Nn{weights;intercept;r2;constructor(e,t,o){this.weights=e,this.intercept=t,this.r2=o}value(e){let t=this.intercept;for(let o=0;o<this.weights.length;o++)t+=this.weights[o]*(e[o]??0);return t}predict(e){return{scores:[this.value(e)],confidence:this.r2}}exportParams(){const e=new Float32Array(this.weights.length+1);return e.set(this.weights,0),e[this.weights.length]=this.intercept,e}importParams(e){if(e.length!==this.weights.length+1)throw new Error(`LinearModel.importParams: expected ${this.weights.length+1} values, got ${e.length}`);for(let t=0;t<this.weights.length;t++)this.weights[t]=e[t];this.intercept=e[this.weights.length]}}function Ur(r,e,t){for(let n=0;n<t;n++){let s=n;for(let a=n+1;a<t;a++)Math.abs(r[a*t+n])>Math.abs(r[s*t+n])&&(s=a);if(Math.abs(r[s*t+n])<1e-12)throw new Error("solveLinearSystem: singular matrix");if(s!==n){for(let i=0;i<t;i++){const c=r[n*t+i];r[n*t+i]=r[s*t+i],r[s*t+i]=c}const a=e[n];e[n]=e[s],e[s]=a}for(let a=n+1;a<t;a++){const i=r[a*t+n]/r[n*t+n];if(i!==0){for(let c=n;c<t;c++)r[a*t+c]=r[a*t+c]-i*r[n*t+c];e[a]=e[a]-i*e[n]}}}const o=new Float64Array(t);for(let n=t-1;n>=0;n--){let s=e[n];for(let a=n+1;a<t;a++)s-=r[n*t+a]*o[a];o[n]=s/r[n*t+n]}return o}function yi(r,e={}){const t=oe(r.map(g=>g.x)),o=t+1,n=new Float64Array(o*o),s=new Float64Array(o),a=new Float64Array(o);for(const g of r){const p=g.weight??1;for(let _=0;_<t;_++)a[_]=g.x[_];a[t]=1;for(let _=0;_<o;_++){s[_]=s[_]+p*a[_]*g.y;for(let b=0;b<o;b++)n[_*o+b]=n[_*o+b]+p*a[_]*a[b]}}const i=e.l2??1e-6;for(let g=0;g<t;g++)n[g*o+g]=n[g*o+g]+i;const c=Ur(n,s,o),d=new Nn(Float32Array.from(c.subarray(0,t)),c[t],0);let h=0,l=0;for(const g of r)h+=g.weight??1,l+=(g.weight??1)*g.y;l/=h;let u=0,m=0;for(const g of r){const p=g.weight??1;u+=p*(g.y-d.value(g.x))**2,m+=p*(g.y-l)**2}const f=m>0?Math.min(1,Math.max(0,1-u/m)):u<1e-12?1:0;return new Nn(d.weights,d.intercept,f)}function Hr(r,e){return(r.weight??1)*(e?.[r.y]??1)}class vi{dim;classes;weights;bias;constructor(e,t){this.dim=e,this.classes=t,this.weights=new Float32Array(t*e),this.bias=new Float32Array(t)}logits(e){const t=[];for(let o=0;o<this.classes;o++){let n=this.bias[o];const s=o*this.dim;for(let a=0;a<this.dim;a++)n+=this.weights[s+a]*(e[a]??0);t.push(n)}return t}proba(e){return Array.from(ve(this.logits(e)))}predict(e){const t=this.proba(e);return{scores:t,confidence:Ye(t)}}loss(e){return Or("classify",this,e)??0}step(e,t,o,n){const s=new Float64Array(this.weights.length),a=new Float64Array(this.classes);let i=0,c=0;for(const h of e){const l=Hr(h,n),u=this.proba(h.x);i+=-l*Math.log(Math.max(u[h.y],1e-12)),c+=l;for(let m=0;m<this.classes;m++){const f=l*(u[m]-(m===h.y?1:0));a[m]=a[m]+f;const g=m*this.dim;for(let p=0;p<this.dim;p++)s[g+p]=s[g+p]+f*h.x[p]}}const d=c>0?1/c:0;for(let h=0;h<this.weights.length;h++)this.weights[h]=this.weights[h]-t*(s[h]*d+o*this.weights[h]);for(let h=0;h<this.classes;h++)this.bias[h]=this.bias[h]-t*a[h]*d;return i*d}exportParams(){const e=new Float32Array(this.weights.length+this.bias.length);return e.set(this.weights,0),e.set(this.bias,this.weights.length),e}importParams(e){if(e.length!==this.weights.length+this.bias.length)throw new Error(`LogisticModel.importParams: expected ${this.weights.length+this.bias.length} values, got ${e.length}`);for(let t=0;t<this.weights.length;t++)this.weights[t]=e[t];for(let t=0;t<this.bias.length;t++)this.bias[t]=e[this.weights.length+t]}}function xi(r,e={},t){const o=oe(r.map(l=>l.x)),n=e.classes??t?.classes??Xe(r.map(l=>l.y)),s=Xe(r.map(l=>l.y));if(s>n&&r.some(l=>l.y>=n))throw new Error(`fitLogistic: labels go up to ${s-1} but the model has ${n} classes`);const a=t??new vi(o,n);if(a.dim!==o||a.classes!==n)throw new Error(`fitLogistic: init is ${a.dim}×${a.classes}, data is ${o}×${n}`);const i=e.l2??.001,c=e.classWeights?.findIndex(l=>!Number.isFinite(l)||l<0)??-1;if(c>=0)throw new Error(`fitLogistic: classWeights[${c}] must be a finite number ≥ 0, got ${e.classWeights[c]}`);if(e.solver==="irls"){if(n!==2)throw new Error(`fitLogistic: the irls solver fits two classes, not ${n}`);return Ei(a,r,i,e.classWeights,e.maxIterations??50),a}const d=e.learningRate??.5,h=e.epochs??300;for(let l=0;l<h;l++)a.step(r,d,i,e.classWeights);return a}const ki=1e-9,Ai=1e-10,Mi=40;function Ei(r,e,t,o,n){const s=t/2,a=r.dim,i=a+1,c=new Float64Array(i);for(let g=0;g<a;g++)c[g]=r.weights[a+g]-r.weights[g];c[a]=r.bias[1]-r.bias[0];const d=e.map(g=>Hr(g,o)),h=d.reduce((g,p)=>g+p,0),l=h>0?1/h:0,u=(g,p)=>{let _=g[a];for(let b=0;b<a;b++)_+=g[b]*p[b];return _},m=g=>{let p=0;e.forEach((b,w)=>{const y=u(g,b.x),x=y>=0?y+Math.log1p(Math.exp(-y)):Math.log1p(Math.exp(y));p+=d[w]*(x-(b.y===1?y:0))});let _=0;for(let b=0;b<a;b++)_+=g[b]*g[b];return p*l+s/2*_};let f=m(c);for(let g=0;g<n;g++){const p=new Float64Array(i),_=new Float64Array(i*i);e.forEach((L,k)=>{const D=ke(u(c,L.x)),B=d[k]*(D-(L.y===1?1:0))*l,O=d[k]*D*(1-D)*l;for(let W=0;W<i;W++){const G=W<a?L.x[W]:1;p[W]=p[W]+B*G;for(let z=0;z<i;z++){const H=z<a?L.x[z]:1;_[W*i+z]=_[W*i+z]+O*G*H}}});for(let L=0;L<i;L++)L<a&&(p[L]=p[L]+s*c[L],_[L*i+L]=_[L*i+L]+s),_[L*i+L]=_[L*i+L]+ki;const b=Ur(_,p,i);let w=0;for(let L=0;L<i;L++)w=Math.max(w,Math.abs(b[L]));const y=w<Ai;let x=1,E=!1;for(let L=0;L<Mi;L++){const k=new Float64Array(i);for(let B=0;B<i;B++)k[B]=c[B]-x*b[B];const D=m(k);if(D<=f+1e-15){c.set(k),f=D,E=!0;break}x/=2}if(!E||y)break}r.weights.fill(0),r.bias.fill(0);for(let g=0;g<a;g++)r.weights[a+g]=c[g];r.bias[1]=c[a]}class Pn{centroids;inertia;constructor(e,t){this.centroids=e,this.inertia=t}assign(e){let t=0,o=1/0,n=1/0;return this.centroids.forEach((s,a)=>{const i=De(e,s);i<o?(n=o,o=i,t=a):i<n&&(n=i)}),{cluster:t,d1:o,d2:n}}predict(e){const{cluster:t,d1:o,d2:n}=this.assign(e),s=Number.isFinite(n)&&n>0?1-Math.sqrt(o)/Math.sqrt(n):1;return{scores:[t],confidence:Math.max(0,Math.min(1,s))}}}function Li(r,e={}){const t=r.map(m=>m.x),o=oe(t),n=Math.min(t.length,Math.max(1,e.k??Math.round(Math.sqrt(t.length/2)))),s=Wr(e.seed??27501),a=[Float32Array.from(t[Math.floor(s()*t.length)])],i=t.map(m=>De(m,a[0]));for(;a.length<n;){const m=i.reduce((p,_)=>p+_,0);let f=0;if(m>0){let p=s()*m,_=-1;for(f=0;f<t.length&&!(i[f]>0&&(_=f,p-=i[f],p<=0));f++);f>=t.length&&(f=_)}else f=a.length;const g=Float32Array.from(t[f]);a.push(g),t.forEach((p,_)=>i[_]=Math.min(i[_],De(p,g)))}const c=new Int32Array(t.length).fill(-1),d=()=>{let m=!1;const f=new Pn(a,0);return t.forEach((g,p)=>{const _=f.assign(g).cluster;c[p]!==_&&(c[p]=_,m=!0)}),m},h=e.maxIterations??100;let l=!1;for(let m=0;m<h;m++){if(!d()){l=!0;break}const f=a.map(()=>new Float64Array(o)),g=new Array(n).fill(0);t.forEach((p,_)=>{const b=c[_];g[b]=g[b]+1;for(let w=0;w<o;w++)f[b][w]=f[b][w]+p[w]}),a.forEach((p,_)=>{if(g[_]>0)for(let b=0;b<o;b++)p[b]=f[_][b]/g[_]})}l||d();let u=0;return t.forEach((m,f)=>u+=De(m,a[c[f]])),new Pn(a,u)}const Si=1.4826,Fi=1.2533;function Gr(r,e){return typeof r=="number"?r:r[e]??0}class Di{center;scale;threshold;constructor(e,t,o){this.center=e,this.scale=t,this.threshold=o}zScores(e){return Array.from(this.center,(t,o)=>Math.abs((e[o]??0)-t)/this.scale[o])}predict(e){const t=Math.max(0,...this.zScores(e))/this.threshold;return{scores:[t],confidence:st(t)}}}function st(r){return Math.max(0,Math.min(1,Math.abs(r-1)))}function Ut(r,e={}){const t=r.map(c=>c.x),o=oe(t),n=e.minScaleFraction??.01,s=e.minScale??0,a=new Float64Array(o),i=new Float64Array(o);for(let c=0;c<o;c++){const d=t.map(m=>m[c]),h=Tn(d),l=d.map(m=>Math.abs(m-h));let u=Si*Tn(l);u>0||(u=Fi*(l.reduce((m,f)=>m+f,0)/l.length)),a[c]=h,i[c]=Math.max(u,n*Math.abs(h)+1e-9,Gr(s,c))}return new Di(a,i,e.threshold??3.5)}class Bi{mean;variance;alpha;threshold;minScaleFraction;minScale;constructor(e,t,o,n,s,a=0){if(this.mean=e,this.variance=t,this.alpha=o,this.threshold=n,this.minScaleFraction=s,this.minScale=a,!(o>0&&o<=1))throw new Error(`EwmaModel: alpha must be in (0, 1] (got ${o})`)}zScores(e){return Array.from(this.mean,(t,o)=>{const n=Math.max(Math.sqrt(this.variance[o]),this.minScaleFraction*Math.abs(t)+1e-9,Gr(this.minScale,o));return Math.abs((e[o]??0)-t)/n})}update(e){for(let t=0;t<this.mean.length;t++){const o=(e[t]??0)-this.mean[t],n=this.alpha*o;this.mean[t]=this.mean[t]+n,this.variance[t]=(1-this.alpha)*(this.variance[t]+o*n)}}predict(e){const t=Math.max(0,...this.zScores(e))/this.threshold;return{scores:[t],confidence:st(t)}}}function Ht(r,e={}){const t=oe(r.map(n=>n.x)),o=new Bi(Float64Array.from(r[0].x),new Float64Array(t),e.alpha??.3,e.threshold??3,e.minScaleFraction??.01,e.minScale??0);for(let n=1;n<r.length;n++)o.update(r[n].x);return o}function Ci(r){const e=r.length,t=r[0]?.length??0;if(e===0||t===0)return{means:new Array(t).fill(0),covariance:[],shrinkage:0};const o=new Array(t).fill(0);for(const f of r)for(let g=0;g<t;g++)o[g]+=f[g]/e;const n=r.map(f=>f.map((g,p)=>g-o[p])),s=1/e,a=[];for(let f=0;f<t;f++){a.push(new Array(t).fill(0));for(let g=0;g<t;g++){let p=0;for(let _=0;_<e;_++)p+=n[_][f]*n[_][g];a[f][g]=p*s}}const c=a.reduce((f,g,p)=>f+g[p],0)/t;let d=0;for(let f=0;f<t;f++)for(let g=0;g<t;g++){let p=0;for(let _=0;_<e;_++)p+=(n[_][f]*n[_][g]-(f===g?a[f][f]:a[f][g]))**2;d+=p/e}d*=s*s;let h=0;for(let f=0;f<t;f++)for(let g=0;g<t;g++){const p=f===g?c:0;h+=(a[f][g]-p)**2}const l=Math.min(d,h),u=h>0?l/h:0,m=a.map((f,g)=>f.map((p,_)=>(1-u)*p+(g===_?u*c:0)));return{means:o,covariance:m,shrinkage:u}}function Ti(r,e){const t=new Float64Array(e*e);for(let s=0;s<e;s++)for(let a=0;a<=s;a++){let i=r[s*e+a];for(let c=0;c<a;c++)i-=t[s*e+c]*t[a*e+c];if(s===a){if(!(i>0))return null;t[s*e+s]=Math.sqrt(i)}else t[s*e+a]=i/t[a*e+a]}const o=new Float64Array(e*e);for(let s=0;s<e;s++)for(let a=s;a<e;a++){let i=a===s?1:0;for(let c=s;c<a;c++)i-=t[a*e+c]*o[c*e+s];o[a*e+s]=i/t[a*e+a]}const n=new Float64Array(e*e);for(let s=0;s<e;s++)for(let a=s;a<e;a++){let i=0;for(let c=a;c<e;c++)i+=o[c*e+s]*o[c*e+a];n[s*e+a]=i,n[a*e+s]=i}return n}const Ni=30,Pi=.99,$i=200,Kr=1e-9,Ii=1e-9,zi=1e-12;function qr(r,e,t){const o=r.length,n=new Float64Array(e);for(const h of r)for(let l=0;l<e;l++)n[l]=n[l]+h[l];for(let h=0;h<e;h++)n[h]=n[h]/o;const s=new Float64Array(e);for(let h=0;h<e;h++){let l=0;for(const m of r)l+=(m[h]-n[h])**2;const u=Math.sqrt(l/o);s[h]=u>zi*Math.max(1,Math.abs(n[h]))?u:1}const a=r.map(h=>Array.from({length:e},(l,u)=>(h[u]-n[u])/s[u])),{covariance:i}=Ci(a),c=new Float64Array(e*e);for(let h=0;h<e;h++)for(let l=0;l<e;l++)c[h*e+l]=i[h][l]+(h===l?t:0);const d=Ti(c,e);if(!d)throw new Error("fitMahalanobis: covariance is not positive definite");return{mean:n,scale:s,precision:d}}function Vr(r,e){const t=r.mean.length,o=new Float64Array(t);for(let s=0;s<t;s++)o[s]=((e[s]??0)-r.mean[s])/r.scale[s];let n=0;for(let s=0;s<t;s++){let a=0;for(let i=0;i<t;i++)a+=r.precision[s*t+i]*o[i];n+=o[s]*a}return Math.sqrt(Math.max(0,n))}class ji{fit;threshold;constructor(e,t){this.fit=e,this.threshold=t}distance(e){return Vr(this.fit,e)}score(e){return this.distance(e)/this.threshold}}function Wi(r,e={}){return Math.max(e.minSamples??Ni,r+2)}function Ri(r,e={}){const t=oe(r),o=e.minVariance??Kr,n=Math.min(r.length,Math.max(1,e.looRows??$i)),s=[];for(let a=r.length-n;a<r.length;a++){const i=r.filter((c,d)=>d!==a);s.push(Vr(qr(i,t,o),r[a]))}return Math.max(Ii,pi(s,e.quantile??Pi))}function Oi(r,e={}){const t=r.map(a=>a.x),o=oe(t);if(t.length<Wi(o,e))return null;const n=qr(t,o,e.minVariance??Kr),s=e.threshold??Ri(t,e);return new ji(n,s)}class Xr{population;trend;mahalanobis;constructor(e,t,o=null){this.population=e,this.trend=t,this.mahalanobis=o}featureScores(e){const t=this.population.zScores(e),o=this.trend.zScores(e);return t.map((n,s)=>({population:n/this.population.threshold,trend:o[s]/this.trend.threshold}))}mahalanobisScore(e){return this.mahalanobis?this.mahalanobis.score(e):null}observe(e){this.trend.update(e)}predict(e){let t=Math.max(this.population.predict(e).scores[0],this.trend.predict(e).scores[0]);return this.mahalanobis&&(t=Math.max(t,this.mahalanobis.score(e))),{scores:[t],confidence:st(t)}}}function Ui(r,e={}){return new Xr(Ut(r,e.robustZ),Ht(r,e.ewma),e.mahalanobis?Oi(r,e.mahalanobis):null)}function Mt(r,e,t,o){if(e>=t||r.length<=1)return{size:r.length};const n=r[0].length,s=[];for(let u=0;u<n;u++){let m=1/0,f=-1/0;for(const g of r)m=Math.min(m,g[u]),f=Math.max(f,g[u]);f>m&&s.push({f:u,lo:m,hi:f})}if(s.length===0)return{size:r.length};const{f:a,lo:i,hi:c}=s[Math.floor(o()*s.length)],d=i+o()*(c-i),h=r.filter(u=>u[a]<d),l=r.filter(u=>u[a]>=d);return{feature:a,split:d,left:Mt(h,e+1,t,o),right:Mt(l,e+1,t,o)}}function Yr(r,e,t=0){return"size"in r?t+Rr(r.size):Yr(e[r.feature]<r.split?r.left:r.right,e,t+1)}class Hi{trees;sampleSize;threshold;constructor(e,t,o){this.trees=e,this.sampleSize=t,this.threshold=o}score(e){const t=Rr(this.sampleSize);if(t===0)return .5;const o=this.trees.reduce((n,s)=>n+Yr(s,e),0)/this.trees.length;return Math.pow(2,-o/t)}predict(e){const t=this.score(e)/this.threshold;return{scores:[t],confidence:st(t)}}}function Gi(r,e={}){const t=r.map(i=>i.x);oe(t);const o=Wr(e.seed??5616),n=Math.min(e.sampleSize??256,t.length),s=Math.ceil(Math.log2(Math.max(n,2))),a=[];for(let i=0;i<(e.trees??100);i++){const c=t.map((d,h)=>h);for(let d=0;d<n;d++){const h=d+Math.floor(o()*(c.length-d));[c[d],c[h]]=[c[h],c[d]]}a.push(Mt(c.slice(0,n).map(d=>t[d]),0,s,o))}return new Hi(a,n,e.threshold??.6)}function $n(r,e){let t=0,o=0;for(const n of r)t+=n.w*n.g,o+=n.w*n.h;return-t/(o+e)}function gt(r,e,t){return r*r/(e+t)}function Et(r,e,t){if(e>=t.maxDepth||r.length<2)return{value:$n(r,t.lambda)};let o=0,n=0,s=0;for(const l of r)o+=l.w*l.g,n+=l.w*l.h,s+=l.w;const a=gt(o,n,t.lambda);let i=null;const c=r[0].x.length;for(let l=0;l<c;l++){const u=[...r].sort((p,_)=>p.x[l]-_.x[l]);let m=0,f=0,g=0;for(let p=0;p<u.length-1;p++){const _=u[p];m+=_.w*_.g,f+=_.w*_.h,g+=_.w;const b=_.x[l],w=u[p+1].x[l];if(b===w||g<t.minLeafWeight||s-g<t.minLeafWeight)continue;const y=gt(m,f,t.lambda)+gt(o-m,n-f,t.lambda)-a;y>1e-12&&(!i||y>i.score)&&(i={feature:l,split:(b+w)/2,score:y})}}if(!i)return{value:$n(r,t.lambda)};const d=r.filter(l=>l.x[i.feature]<i.split),h=r.filter(l=>l.x[i.feature]>=i.split);return{feature:i.feature,split:i.split,left:Et(d,e+1,t),right:Et(h,e+1,t)}}function Qr(r,e){for(;!("value"in r);)r=e[r.feature]<r.split?r.left:r.right;return r.value}class Ki{objective;base;trees;learningRate;constructor(e,t,o,n){this.objective=e,this.base=t,this.trees=o,this.learningRate=n}margin(e){let t=this.base;for(const o of this.trees)t+=this.learningRate*Qr(o,e);return t}predict(e){const t=this.margin(e);if(this.objective==="regression")return{scores:[t],confidence:1};const o=ke(t);return{scores:[1-o,o],confidence:Math.max(o,1-o)}}}function qi(r,e={}){oe(r.map(l=>l.x));const t=e.objective??"binary",o=e.learningRate??.3,n={maxDepth:e.maxDepth??2,minLeafWeight:e.minLeafWeight??1,lambda:e.lambda??1};let s=0,a=0;for(const l of r)s+=l.weight??1,a+=(l.weight??1)*l.y;const i=s>0?a/s:r.reduce((l,u)=>l+u.y,0)/r.length,c=t==="binary"?Math.log(Math.max(i,1e-6)/Math.max(1-i,1e-6)):i,d=r.map(()=>c),h=[];for(let l=0;l<(e.trees??50);l++){const u=r.map((f,g)=>{if(t==="binary"){const p=ke(d[g]);return{x:f.x,g:p-f.y,h:Math.max(p*(1-p),1e-6),w:f.weight??1}}return{x:f.x,g:d[g]-f.y,h:1,w:f.weight??1}}),m=Et(u,0,n);h.push(m),r.forEach((f,g)=>d[g]=d[g]+o*Qr(m,f.x))}return new Ki(t,c,h,o)}function Vi(r,e,t={}){if(e.length===0)throw new Error(`fitClassical(${r}): no samples`);switch(r){case"knn":return _i(e,t.knn);case"naive-bayes":return wi(e,t["naive-bayes"]);case"logistic":return xi(e,t.logistic);case"linear":return yi(e,t.linear);case"kmeans":return Li(e,t.kmeans);case"robust-z":return Ut(e,t["robust-z"]);case"ewma":return Ht(e,t.ewma);case"anomaly-composite":return Ui(e,t["anomaly-composite"]);case"isolation-forest":return Gi(e,t["isolation-forest"]);case"gbm-small":return qi(e,t["gbm-small"])}}class Xi{config;_params;_grads;constructor(e){this.config={seed:20045,...e};const{inputDim:t,hiddenDim:o,outputDim:n,objective:s}=this.config;if(s==="mse"&&n!==1)throw new Error("DenseHead: mse objective needs outputDim 1");if(s==="softmax"&&n<2)throw new Error("DenseHead: softmax objective needs outputDim ≥ 2");const a=new te(this.config.seed),i=()=>a.next(),c=o>0?o:t,d=[...o>0?[["w1",o*t,1/Math.sqrt(t)],["b1",o,0]]:[],["w2",n*c,1/Math.sqrt(c)],["b2",n,0]];this._params=d.map(([h,l,u])=>({name:h,numel:l,data:u>0?me(l,u,i):new Float32Array(l)})),this._grads=d.map(([h,l])=>({name:h,numel:l,data:new Float32Array(l)}))}_p(e){return this._params.find(t=>t.name===e).data}_g(e){return this._grads.find(t=>t.name===e).data}parameters(){return this._params}gradients(){return this._grads}zeroGrad(){for(const e of this._grads)e.data.fill(0)}_forward(e){const{inputDim:t,hiddenDim:o,outputDim:n}=this.config;let s;if(o>0){const d=this._p("w1"),h=this._p("b1");s=new Float32Array(o);for(let l=0;l<o;l++){let u=h[l];for(let m=0;m<t;m++)u+=d[l*t+m]*(e[m]??0);s[l]=Math.tanh(u)}}else s=Float32Array.from({length:t},(d,h)=>e[h]??0);const a=this._p("w2"),i=this._p("b2"),c=new Float32Array(n);for(let d=0;d<n;d++){let h=i[d];for(let l=0;l<s.length;l++)h+=a[d*s.length+l]*s[l];c[d]=h}return{h:s,z:c}}_lossGrad(e,t){if(this.config.objective==="mse"){const s=e[0]-t;return{loss:.5*s*s,dz:Float32Array.of(s)}}const o=ve(e),n=Float32Array.from(o,(s,a)=>s-(a===t?1:0));return{loss:-Math.log(Math.max(o[t]??0,1e-12)),dz:n}}loss(e){return(e.weight??1)*this._lossGrad(this._forward(e.x).z,e.y).loss}accumulate(e){const t=e.weight??1,{inputDim:o,hiddenDim:n,outputDim:s}=this.config,{h:a,z:i}=this._forward(e.x),{loss:c,dz:d}=this._lossGrad(i,e.y),h=this._p("w2"),l=this._g("w2"),u=this._g("b2"),m=new Float32Array(a.length);for(let f=0;f<s;f++){const g=t*d[f];u[f]=u[f]+g;for(let p=0;p<a.length;p++)l[f*a.length+p]=l[f*a.length+p]+g*a[p],m[p]=m[p]+g*h[f*a.length+p]}if(n>0){const f=this._g("w1"),g=this._g("b1");for(let p=0;p<n;p++){const _=m[p]*(1-a[p]*a[p]);g[p]=g[p]+_;for(let b=0;b<o;b++)f[p*o+b]=f[p*o+b]+_*(e.x[b]??0)}}return t*c}predict(e){const{z:t}=this._forward(e);if(this.config.objective==="mse")return{scores:[t[0]],confidence:1};const o=Array.from(ve(t));return{scores:o,confidence:Math.max(...o)}}exportParams(){return Cr(this._params)}importParams(e){Tr(this._params,e)}}function Yi(r){const e=r.engines.find(t=>t.tier==="local"&&(t.engine==="classical"||t.engine==="head"));if(!e)throw new Error(`trainMlTask(${r.id}): no trainable local engine`);return e}async function In(r,e,t,o){if(r.train?.fit)return{predictor:await r.train.fit(t,e),skippedNonFinite:0};if(e.engine==="classical")return{predictor:Vi(e.algorithm,t,o.classical),skippedNonFinite:0};if(e.engine==="head"){const n=r.kind==="classify"?"softmax":r.kind==="regress"?"mse":null;if(!n)throw new Error(`trainMlTask(${r.id}): a head engine trains classify or regress tasks only`);const s=new Xi({inputDim:t[0].x.length,hiddenDim:e.head==="linear"?0:o.head?.hiddenDim??16,outputDim:n==="softmax"?r.output.labels.length:1,objective:n,...o.head?.seed!=null?{seed:o.head.seed}:{}}),a=new Br(s,o.device??null,`trainMlTask(${r.id})`);return await a.train(t,o.head?.train),{predictor:s,skippedNonFinite:a.skippedNonFinite}}throw new Error(`trainMlTask(${r.id}): engine '${fe(e)}' is not trained here`)}async function Qi(r,e,t={}){const o=r.train;if(!o)throw new Error(`trainMlTask(${r.id}): task is rule-based or pre-trained only`);if(o.trainedBy)throw new Error(`trainMlTask(${r.id}): trained by ${o.trainedBy}`);if(e.length<o.minSamples)return null;const n=t.engine??Yi(r),s=await hi(r.features,e.map(u=>u.input),t.embedder),a=e.map((u,m)=>({x:s[m],y:u.label,...u.weight!=null?{weight:u.weight}:{}})),c=r.kind==="classify"||r.kind==="regress"?t.holdoutFraction??o.holdoutFraction??.2:0,d=Math.floor(a.length*c);let h=null;if(d>=1&&a.length-d>=1){const u=a.slice(0,a.length-d),m=a.slice(a.length-d),f=await In(r,n,u,t);if(h=Or(r.kind,f.predictor,m),t.refitOnAll===!1)return t.models?.set(r.id,fe(n),f.predictor),{predictor:f.predictor,engine:n,samples:u.length,holdout:d,holdoutLoss:h,skippedNonFinite:f.skippedNonFinite}}const l=await In(r,n,a,t);return t.models?.set(r.id,fe(n),l.predictor),{predictor:l.predictor,engine:n,samples:a.length,holdout:d>=1?d:0,holdoutLoss:h,skippedNonFinite:l.skippedNonFinite}}function Fl(r,e,t,o,n={},s){return{task:r,engine:e,version:t,shape:n,params:Pt(tr(o)),...s!=null&&Number.isFinite(s)?{evalLoss:s}:{}}}function Dl(r){return nr(We(r.params))}function Bl(r,e){return r.manifest.mlHeads?.find(t=>t.task===e)}function Cl(r,e){return r.withMlHeads([...(r.manifest.mlHeads??[]).filter(t=>t.task!==e.task),e])}function Tl(r,e,t,o){const n=Jn(We(r.params),tr(e));return us(n,r.version,t,o??`ml head ${r.task}`,hr(r.task))}function Nl(r,e,t,o={}){const n=We(r.params),s=hr(r.task),a=[],i=[],c=[];e.forEach((l,u)=>{const m=ur(l.target,s);if(m)return void c.push({index:u,reason:m});if(l.baseVersion!==r.version)return void c.push({index:u,reason:`stale base version ${l.baseVersion} (head is ${r.version})`});let f;try{f=fs(l)}catch(p){return void c.push({index:u,reason:`diff is not base64: ${p instanceof Error?p.message:String(p)}`})}const g=ms(f,n);if(g)return void c.push({index:u,reason:g});a.push(f),i.push(l.weight??1)});const d=ps(n,a,i,l=>t(nr(l)),{...o,requireEval:o.requireEval??!0});return d.accepted?{head:{...r,version:r.version+1,params:Pt(d.checkpoint),...d.newLoss!=null?{evalLoss:d.newLoss}:{}},merge:d,rejected:c}:{head:r,merge:d,rejected:c}}const Te={kind:"classify",id:"experience.quality",description:"Is this procedure worth learning from (does it run, and run well)?",features:{text:r=>r.doc.text,numeric:r=>[re(r.steps,50),re(r.runs,20)],numericNames:["steps","runs"]},engines:[{tier:"local",engine:"classical",algorithm:"knn"},{tier:"local",engine:"classical",algorithm:"logistic"}],train:{minSamples:12},output:{labels:["low","high"],decode:r=>({label:(r.scores[1]??0)>=.5?"high":"low",pHigh:r.scores[1]??0})}};function Ji(r,e,t=[]){const o=new Map([...e.map(s=>[s.id,s.steps.length]),...r.map(s=>[s.id,s.steps.length])]),n=new Map;for(const s of t){if(s.status==="running")continue;const a=n.get(s.skillId)??{runs:0,succeeded:0,failed:0};a.runs++,s.status==="succeeded"&&a.succeeded++,s.status==="failed"&&a.failed++,n.set(s.skillId,a)}return Rt(r,e).map(s=>({doc:s,steps:o.get(s.id)??0,...n.get(s.id)??{runs:0,succeeded:0,failed:0}}))}function Jr(r){return r.runs===0?null:r.succeeded/r.runs>=.5?1:0}const Zi=5;function ec(r){return r.flatMap(e=>{const t=Jr(e);return t==null?[]:[{input:e,label:t}]})}const Zr=.97,Lt={kind:"cluster",id:"experience.dedupe",description:"Is this procedure a near-copy of one already kept?",features:{text:r=>r.text},engines:[{tier:"local",engine:"classical",algorithm:"knn"}],output:{decode:r=>({nearest:r.scores[0]??-1,similarity:r.scores[1]??0,duplicate:(r.scores[2]??0)===1})}};class tc{threshold;_knn=new Ot(1,"cosine",2);constructor(e=Zr){this.threshold=e}get size(){return this._knn.size}add(e){this._knn.add(e)}predict(e){const t=this._knn.nearest(e);if(!t)return{scores:[-1,0,0],confidence:1};const o=t.similarity>=this.threshold;return{scores:[t.index,t.similarity,o?1:0],confidence:Math.abs(t.similarity)}}}const zn=200;function nc(r,e,t){return{get:(o,n)=>{const s=r.get(o,n);return o===e&&s instanceof Ot&&t<s.size?s.excluding(t):s},set:(o,n,s)=>r.set(o,n,s)}}function eo(r){const e=new Map;return{dimensions:r.dimensions,fingerprint:r.fingerprint,async embed(t){let o=e.get(t);return o||e.set(t,o=await r.embed(t)),o}}}async function rc(r,e,t){if(r.runs<=0)return null;if(r.runs>=Zi)return r.succeeded/r.runs;const o=t==null||!e.models?e:{...e,models:nc(e.models,Te.id,t)};try{return(await mi(Te.id,r,o)).output.pHigh}catch(n){if(!(n instanceof zr))throw n;return null}}async function oc(r,e){const t=eo(e.embedder),o=new tc(e.dedupeThreshold??Zr),n=[],s=[],a=[],i=e.quality?{...e.quality.ctx,embedder:t}:null,c=new Map((e.quality?.trainedIds??[]).map((h,l)=>[h,l])),d=h=>t.embed(Lt.features.text(h));for(const h of e.known??[])o.add(await d(h)),n.push(h.id);for(const h of r){if(e.exclude?.has(h.id)){a.push({id:h.id,reason:"excluded"});continue}if(e.quality&&i){const m=await rc(e.quality.input(h),i,c.get(h.id));if(m!=null&&m<(e.quality.minPHigh??.5)){a.push({id:h.id,reason:"low-quality",score:m});continue}}const l=await d(h),u=Lt.output.decode(o.predict(l));if(u.duplicate){a.push({id:h.id,reason:"duplicate",of:n[u.nearest],score:u.similarity});continue}o.add(l),n.push(h.id),s.push(h)}return{kept:s,dropped:a}}function sc(r,e,t){return!r||r.status!=="curated_out"?!1:r.reason==="duplicate"?r.of!=null&&t.has(r.of):r.reason==="low-quality"?r.runs===e:!1}async function Pl(r,e,t){const o=t.known?.slice(0,zn),n=eo(t.embedder),s=Ji(e.episodes,e.skills,e.runs),a=new Map(s.map(_=>[_.doc.id,_])),i=_=>a.get(_.id)??{doc:_,steps:0,runs:0,succeeded:0,failed:0},c=new Set((t.known??[]).map(_=>_.id)),d=[],h=[];for(const _ of r){const b=e.curated?.[_.id];b&&sc(b,i(_).runs,c)?d.push({id:_.id,reason:b.reason,...b.of!=null?{of:b.of}:{},...b.score!=null?{score:b.score}:{}}):h.push(_)}const l=[...r,...t.known??[]].map(_=>a.get(_.id)).filter(_=>_!=null&&Jr(_)!=null).slice(0,zn),u=ec(l.reverse()),m=new $r;m.register(Te);const f=new ui,g=await Qi(Te,u,{embedder:n,models:f});return{...await oc(h,{embedder:n,...o?{known:o}:{},...t.dedupeThreshold!=null?{dedupeThreshold:t.dedupeThreshold}:{},quality:{ctx:{registry:m,mode:"local-only",models:f},input:i,...t.minPHigh!=null?{minPHigh:t.minPHigh}:{},...g?{trainedIds:u.map(_=>_.input.doc.id)}:{}}}),alreadyDropped:d}}function $l(r,e,t){const o=new Map;for(const s of e.runs)s.status!=="running"&&o.set(s.skillId,(o.get(s.skillId)??0)+1);const n={};for(const s of r.dropped)n[s.id]={status:"curated_out",reason:s.reason,...s.of!=null?{of:s.of}:{},...s.score!=null?{score:s.score}:{},runs:o.get(s.id)??0,at:t};return{dropped:n,kept:r.kept.map(s=>s.id)}}const ac=["promptTokens","contextTokens","contextFill","overflows","tools","turnIndex","attachments","priorLocalSuccessRate","codeHeavy"];function ic(r){const e=di(r.promptTokens+r.contextTokens,r.servedContextTokens,4);return[re(r.promptTokens,1e5),re(r.contextTokens,1e5),e,e>1?1:0,re(r.tools,64),re(r.turnIndex,100),re(r.attachments??0,16),Math.max(0,Math.min(1,r.priorLocalSuccessRate??.5)),r.codeHeavy?1:0]}const cc={kind:"classify",id:"run.local-success",description:"Will this turn succeed on the local model?",features:{numeric:ic,numericNames:ac},engines:[{tier:"local",engine:"classical",algorithm:"logistic"},{tier:"local",engine:"classical",algorithm:"gbm-small"}],train:{minSamples:8},output:{labels:["fails","succeeds"],decode:r=>({succeeds:(r.scores[1]??0)>=.5,probability:r.scores[1]??0})}},lc=.5;function dc(r){return r.local?{label:r.local==="succeeded"?1:0,weight:1}:r.fellBack?{label:0,weight:1}:r.cloud==="failed"?{label:0,weight:lc}:null}function Il(r){return r.flatMap(e=>{const t=dc(e);return t?[{input:e.turn,label:t.label,weight:t.weight}]:[]})}const to=["cost","duration","toolFailures"],no=1e3,ro=36e5,hc=50;function uc(r){return[re(r.costUsd*100,no),re(r.durationMs,ro),re(r.toolFailures,hc)]}const jn=3,Wn=[Math.log(jn)/(3*Math.log1p(no)),Math.log(jn)/(3*Math.log1p(ro)),.1];class fc extends Xr{explain(e){const t=this.featureScores(e);return to.map((o,n)=>({metric:o,...t[n]}))}}function mc(r,e={}){return new fc(Ut(r,{...e.robustZ,minScale:e.robustZ?.minScale??Wn}),Ht(r,{...e.ewma,minScale:e.ewma?.minScale??Wn}))}const gc={kind:"anomaly",id:"run.anomaly",description:"Did this run cost, take or fail far outside its normal range?",features:{numeric:uc,numericNames:to},engines:[{tier:"local",engine:"classical",algorithm:"anomaly-composite"}],train:{minSamples:5,fit:r=>mc(r)},output:{decode:r=>({anomalous:(r.scores[0]??0)>=1,score:r.scores[0]??0})}};function zl(r,e=0){return{costUsd:e,durationMs:r.endedAt!=null?Math.max(0,r.endedAt-r.startedAt):0,toolFailures:r.steps.filter(t=>t.outcome==="failed").length}}const pc=["check.benchmark","check.diffCoverage","check.mutation","touched.security","touched.performance","touched.quality","touched.other","blast.medium","blast.high","risk","changedFiles"];function _c(r){const e=new Set(r.dimensionsTouched),t=[...e].some(o=>o!=="security"&&o!=="performance"&&o!=="quality");return[r.check==="benchmark"?1:0,r.check==="diff-coverage"?1:0,r.check==="mutation"?1:0,e.has("security")?1:0,e.has("performance")?1:0,e.has("quality")?1:0,t?1:0,r.blastRadiusBand==="medium"?1:0,r.blastRadiusBand==="high"?1:0,Math.max(0,Math.min(1,r.risk??.5)),re(r.changedFiles,1e3)]}const bc={kind:"classify",id:"run.check-scheduler",description:"Will running this optional check be decisive for a verdict of the run?",features:{numeric:_c,numericNames:pc},engines:[{tier:"local",engine:"classical",algorithm:"logistic"}],train:{minSamples:2e3},output:{labels:["not-decisive","decisive"],decode:r=>({decisive:(r.scores[1]??0)>=.5,probability:r.scores[1]??0})}},jl={taskId:bc.id,modelVersion:"beta-cell.1",intendedUse:"Decide whether an opted-in, optional dynamic check runs; never a verdict (D0).",dataWindow:"The newest 500 runs of one repository, on the device.",minObservations:20,explorationShare:.1,label:"Leave-one-out: the check changed a dimension's verdict, not counting a move out of not_measured.",knownLimits:["Context is the dimensions-touched cell only; risk, blast radius and files changed wait for the pooled logistic upgrade.","Per-device history: a new repository runs on the opt-in default until 20 observations.","Upgrade features: a run without a risk model has its risk imputed at 0.5 (risk ?? 0.5), which reads as 'average', not 'unknown'."]},wc=[Qa,Te,Lt,gc,cc];function Wl(){const r=new $r;for(const e of wc)r.register(e);return r}export{Ec as ACTIVATIONS_BACKWARD_WGSL,ye as ACTIVATIONS_WGSL,Fc as ATTENTION_BACKWARD_WGSL,Yt as ATTENTION_FORWARD_WGSL,gr as A_LOG_CLAMP_HI,mr as A_LOG_CLAMP_LO,Bt as AdamW,Xr as AnomalyCompositeModel,ko as AttentionBlock,je as BPETokenizer,wc as BUILTIN_ML_TASKS,io as BufferPool,pc as CHECK_SCHEDULER_FEATURES,jl as CHECK_SCHEDULER_MODEL_CARD,bc as CHECK_SCHEDULER_TASK,lc as CLOUD_ONLY_FAILURE_WEIGHT,Ze as COL_SLICE_ENTRY,Je as COL_SLICE_WGSL,Sc as COMPLEX_SSD_BACKWARD_WGSL,_o as COMPLEX_SSD_FORWARD_WGSL,xc as CONV1D_BACKWARD_WGSL,St as CONV1D_FORWARD_WGSL,pn as CPU_GRADIENT_LAYER_TYPES,Un as CRC_TRAILER_MAGIC,zn as CURATION_KNOWN_LIMIT,Zr as DEFAULT_DEDUPE_THRESHOLD,Ha as DEFAULT_LIMBIC_CONFIG,Ga as DEFAULT_LIMBIC_SEED,Me as DEFAULT_LM_CONFIG,Wo as DEFAULT_LM_SEED,Ds as DEFAULT_LORA_TARGETS,To as DEFAULT_MOE_CONFIG,No as DEFAULT_MOE_SEED,dr as DELTA_TARGET_RE,tc as DedupeIndex,Xi as DenseHead,zo as DynamicLossScaler,cs as EVERMIND_ADAPT_MAX_CHARS,Lt as EXPERIENCE_DEDUPE_TASK,Te as EXPERIENCE_QUALITY_TASK,kt as EXPERIENCE_SCHEMA,nl as EXPORT_FORMATS,nt as EvermindLM,fr as EvermindLMLoRA,Nt as EvermindLMTrainer,J as EvermindModelPackage,Yc as EvermindTextEmbedder,Bi as EwmaModel,wt as FOREIGN_MAMBA_ADAPTERS,ll as GRAD_CLIP_WGSL,Ki as GbmModel,Br as HeadTrainer,Fo as HybridMambaModel,Zc as ImageRVQCodec,be as InMemoryExperienceStore,ui as InMemoryMlModels,Hi as IsolationForestModel,Pn as KMeansModel,Ot as KnnModel,Qa as LIMBIC_AFFECT_TASK,xl as LIMBIC_AFFECT_WGSL,Ra as LIMBIC_BLOCK_HEADER,Pa as LIMBIC_BOUNDS,Lr as LIMBIC_DIM,ce as LIMBIC_DIM_NAMES,Sr as LIMBIC_STATE_DIM,kc as LINEAR_BACKWARD_WGSL,Ne as LINEAR_FORWARD_WGSL,Jo as LN2,ac as LOCAL_SUCCESS_FEATURES,cc as LOCAL_SUCCESS_TASK,wl as LimbicModel,yl as LimbicTrainer,Nn as LinearModel,Ce as LoRAAdapter,$o as LoadBalanceAccumulator,vi as LogisticModel,Ni as MAHALANOBIS_MIN_SAMPLES,It as MAMBA1_PARAM_NAMES,ci as MAX_ADAPTATIONS,mn as MAX_DELTA_B64_CHARS,ii as MAX_RUNS,er as ML_TASK_ID_RE,ji as MahalanobisDetector,fo as Mamba1Block,po as Mamba2Block,wo as Mamba3Block,fo as MambaBlock,Tc as MambaModel,Jc as MambaTrainer,Sl as MlDecisionLog,zr as MlEngineUnavailableError,$r as MlTaskRegistry,Nc as MoETrainer,Ho as MultimodalVocab,Wt as NEUTRAL_STATE,bi as NaiveBayesModel,Ee as PACKAGE_HEADER_BYTES,Zi as QUALITY_OBSERVED_MIN_RUNS,dl as REGION,ze as RMSNORM_EPS,jn as RUN_ANOMALY_FLAG_RATIO,to as RUN_ANOMALY_METRICS,Wn as RUN_ANOMALY_MIN_SCALE,gc as RUN_ANOMALY_TASK,Di as RobustZModel,fc as RunAnomalyDetector,vc as SELECTIVE_SCAN_BACKWARD_WGSL,Vt as SELECTIVE_SCAN_FORWARD_WGSL,Mc as SOFTMAX_BACKWARD_WGSL,Ac as SOFTMAX_FORWARD_WGSL,yo as SOFTMAX_WGSL,Lc as SSD_BACKWARD_WGSL,mo as SSD_FORWARD_WGSL,te as SeededRng,Kn as SharedExpertMoE,Pc as Tensor,it as VIDEO_BANK_INTER,He as VIDEO_BANK_INTRA,rt as VideoRVQCodec,Na as WEIGHT_UPDATE_WGSL,Bs as WSLA_MAX_DELTA,Ke as adamwUpdateInPlace,ds as adaptAndDiff,qc as adaptPackage,ss as adaptationsAfterSkip,st as anomalyConfidence,Ie as appendCrcTrailer,Zn as applyCheckpointDiff,En as applyLimbicDelta,al as applyPortedWeights,Qn as applyRowDelta,ml as appraiseAmygdala,bl as appraiseTask,Re as archOf,Tr as assignParams,jc as backward,xt as basalGangliaExploreBias,pl as basalGangliaSelect,We as base64ToBytes,es as benchArgmax,Gc as benchmarkAdaptationCost,Ve as benchmarkModel,Rc as benchmarkModelAsync,Uc as benchmarkText,ns as bitsPerToken,Ns as buildBatches,Ts as buildChunks,us as buildDeltaLearnPayload,_l as buildLimbicBlock,Tl as buildMlHeadDelta,el as buildVideoSequence,Pt as bytesToBase64,fi as candidateEngines,T as cdiv,_c as checkSchedulerFeatures,Ti as choleskyInverse,ot as clampDim,yt as clampLimbicDim,di as clampRatio,hl as clampState,Io as clearTape,Sa as codestralMambaAdapter,Oc as compareModels,rs as compareReports,Wa as compileLimbicState,Yn as computeRowDelta,la as configJson,ir as corpusToSequences,gi as cosine,Cs as cpuDimsFor,Ss as cpuModelBackward,Ls as cpuModelForward,Qc as cpuModelLoss,Es as cpuWeightsFromNamed,Dt as crc32,$ as createBindGroup,U as createComputePipeline,F as createEmptyStorageBuffer,Wl as createMlRegistry,Q as createStorageBuffer,j as createUniformBuffer,qn as crossEntropyGrad,Ae as crossEntropyLoss,oc as curateExperience,Pl as curatePendingExperience,$l as curationRecords,sc as curationStands,fs as decodeDeltaPayload,ur as deltaTargetMismatch,ms as deltaUnusableReason,$e as dequantizeFp16,Mo as dequantizeInt8,Bc as dequantizeInt8PerChannel,tt as deserializeRowDelta,Jn as diffCheckpoints,Y as dispatchColumnSlice,I as dispatchKernel,jr as dot,Al as dueSkills,ue as elementLabel,At as emptySnapshot,$c as enableGrad,fe as engineKey,Cc as estimateMemory,br as evermindTensorSpec,wa as executePortPlan,Ml as experienceCorpus,Rt as experienceDocuments,Ll as experienceOverview,ec as experienceQualityExamples,Ji as experienceQualityInputs,Jr as experienceQualityLabel,zl as experienceRunMetrics,rl as exportEvermind,xn as exportGguf,yn as exportOnnx,_n as exportSafetensors,hi as extractFeatureMatrix,Ir as extractFeatures,ka as falconMambaAdapter,Ui as fitAnomalyComposite,Vi as fitClassical,Ht as fitEwma,qi as fitGbm,Gi as fitIsolationForest,Li as fitKMeans,_i as fitKnn,yi as fitLinear,xi as fitLogistic,Oi as fitMahalanobis,wi as fitNaiveBayes,Ut as fitRobustZ,mc as fitRunAnomaly,Cr as flattenParams,et as floatToFp16,Ca as foreignMambaAdapterFor,Kc as formatAdaptationCostReport,Ft as fp16ToFloat,Wc as fp16View,me as gaussianArray,tl as generateImage,Ps as generateVideo,da as generationConfigJson,tr as headCheckpoint,nr as headParams,gl as homeostasis,ol as importEvermind,pa as importEvermindTensors,ga as inferArchFromTensors,yc as initWebGPU,ri as isDue,Sn as isIrreversibleLabel,Ri as leaveOneOutMahalanobisThreshold,Ci as ledoitWolfCovariance,vl as limbicAffectPredictor,Ya as limbicHead,Dr as limbicSetpoints,Ue as linearBackward,Se as linearForward,Il as localSuccessExamples,ic as localSuccessFeatures,dc as localSuccessLabel,an as logProbOfToken,re as logScale,Wi as mahalanobisMinSamples,Er as mamba1Adapter,xs as mamba1CpuBackward,pr as mamba1CpuForward,Aa as mambaAdapter,il as mambaConfigFromTensors,Xc as meanEvalLoss,fl as meanLimbicSetpoints,gs as mergeCheckpointDiffs,ps as mergeCheckpointDiffsGated,Nl as mergeMlHeadDeltas,Gr as minScaleAt,Or as mlEvalLoss,Fl as mlHeadEntry,Dl as mlHeadParams,hr as mlHeadTarget,Yo as mlHeadUnusableReason,ua as modelCardMarkdown,zt as namedTensors,Ms as namedWeights,ti as needsApproval,vt as neutralLimbicState,$a as neutralState,Ja as newExperienceId,Ic as noGrad,kr as normaliseSourceName,El as packDocuments,Bl as packageMlHead,wr as paramCount,Fs as paramMatrixShape,Vc as parseDeltaLearnPayload,Bn as parseSnapshot,ts as perplexity,ul as personalitySetpoint,Ta as portForeignMamba,sl as portForeignMambaSafetensors,ys as quantizeBase,Pe as quantizeFp16,Ao as quantizeInt8,Dc as quantizeInt8PerChannel,lo as randn,de as readBuffer,zc as recordOperation,Ia as recordToState,cl as resizePortedVocab,Gn as rmsNormBackward,Hn as rmsNormForward,Vn as roundFp16,uc as runAnomalyFeatures,mi as runMlTask,xr as safetensorsToTensors,Tt as serializeRowDelta,Xt as setInitSeed,ke as sigmoid,Jt as silu,Zt as siluGrad,Fn as slug,ve as softmax,Co as softplus,Ur as solveLinearSystem,Fr as stateToRecord,Is as tensorsToSafetensors,ja as thalamusGate,As as toNamedGrads,cr as tokenWindows,ha as tokenizerJson,Zo as topKIndices,Hc as trainAndBenchmark,Qi as trainMlTask,kl as trainOnce,we as uploadBuffer,se as verifyCrcTrailer,Cl as withPackageMlHead,ks as zeroCpuModelGrads,vs as zeroMamba1Grads};
