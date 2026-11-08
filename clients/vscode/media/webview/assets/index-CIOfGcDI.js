const xe=globalThis,eo=xe.GPUBufferUsage?.UNIFORM??64,Wr=xe.GPUBufferUsage?.STORAGE??128,Rr=xe.GPUBufferUsage?.COPY_SRC??4,Qe=xe.GPUBufferUsage?.COPY_DST??8,to=xe.GPUBufferUsage?.MAP_READ??1;class ro{device;_free=new Map;constructor(e){this.device=e}_key(e,t){return`${e}:${t}`}acquire(e,t){return this._free.get(this._key(e,t))?.pop()??this.device.createBuffer({size:e,usage:t})}release(e,t,o){const r=this._key(t,o);let s=this._free.get(r);s||(s=[],this._free.set(r,s)),s.push(e)}get freeCount(){let e=0;for(const t of this._free.values())e+=t.length;return e}clear(){for(const e of this._free.values())for(const t of e)t.destroy();this._free.clear()}}const qt=new WeakMap;function no(n){let e=qt.get(n);return e||(e=new ro(n),qt.set(n,e)),e}async function Qi(n={}){if(typeof navigator>"u"||!navigator.gpu)throw new Error("WebGPU is not available in this environment. Use Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled.");const e=await navigator.gpu.requestAdapter({powerPreference:n.powerPreference??"high-performance"});if(!e)throw new Error("Failed to acquire a GPUAdapter. Your GPU may not support WebGPU.");const t=e.limits,o=3*1024*1024*1024,r=await e.requestDevice({requiredLimits:{maxBufferSize:Math.min(o,t.maxBufferSize),maxStorageBufferBindingSize:Math.min(o,t.maxStorageBufferBindingSize),maxComputeInvocationsPerWorkgroup:Math.min(256,t.maxComputeInvocationsPerWorkgroup)}});return r.lost.then(s=>{console.error("WebGPU device lost:",s.message)}),{device:r,adapter:e}}function Q(n,e,t=!1){const o=e instanceof Float32Array||e instanceof Uint32Array?e:new Float32Array(e),r=Wr|Qe|(t?Rr:0),s=n.createBuffer({size:o.byteLength,usage:r,mappedAtCreation:!0});return o instanceof Uint32Array?new Uint32Array(s.getMappedRange()).set(o):new Float32Array(s.getMappedRange()).set(o),s.unmap(),s}function S(n,e,t=!1){const o=Wr|Qe|(t?Rr:0);return n.createBuffer({size:e,usage:o})}function z(n,e){const t=ArrayBuffer.isView(e)?e.buffer:e,o=n.createBuffer({size:t.byteLength,usage:eo|Qe,mappedAtCreation:!0});return new Uint8Array(o.getMappedRange()).set(new Uint8Array(t)),o.unmap(),o}async function de(n,e,t){const o=xe.GPUMapMode?.READ??1,r=to|Qe,s=no(n),a=s.acquire(t,r),i=n.createCommandEncoder();i.copyBufferToBuffer(e,0,a,0,t),n.queue.submit([i.finish()]),await a.mapAsync(o);const c=new Float32Array(a.getMappedRange().slice(0));return a.unmap(),s.release(a,t,r),c}function we(n,e,t,o=0){n.queue.writeBuffer(e,o,t.buffer,t.byteOffset,t.byteLength)}function R(n,e,t){const o=n.createShaderModule({code:e});return n.createComputePipeline({layout:"auto",compute:{module:o,entryPoint:t}})}function $(n,e,t,o=0){const r=t.map((s,a)=>({binding:a,resource:{buffer:s}}));return n.createBindGroup({layout:e.getBindGroupLayout(o),entries:r})}function I(n,e,t,o){const r=n.createCommandEncoder(),s=r.beginComputePass();s.setPipeline(e),s.setBindGroup(0,t),s.dispatchWorkgroups(...o),s.end(),n.queue.submit([r.finish()])}function B(n,e){return Math.ceil(n/e)}const Vt=`

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
`,Ji=`

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
`;class te{_s;constructor(e){this._s=e>>>0||1}next(){return this._s=Math.imul(1664525,this._s)+1013904223>>>0,this._s/4294967296}}let pt=Math.random;function Xt(n){if(n==null)pt=Math.random;else{const e=new te(n);pt=()=>e.next()}}function oo(n=1,e=pt){const t=Math.max(e(),1e-12),o=e();return n*Math.sqrt(-2*Math.log(t))*Math.cos(2*Math.PI*o)}function me(n,e,t){const o=new Float32Array(n);for(let r=0;r<n;r++)o[r]=oo(e,t);return o}const St=`

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
`,Zi=`

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
`,Te=`

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
`,ec=`

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
`,tc=`
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
`,rc=`
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
`,nc=`

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
`,Ze="col_slice";function Y(n,e,t,o,r,s,a,i){const c=z(n,new Uint32Array([r,s,a,i]).buffer),l=$(n,e,[c,t,o]);I(n,e,l,[B(r*i,256),1,1]),c.destroy()}const so=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,ao=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class io{layerType="mamba1";device;config;dInner;dtRank;wInProj;bInProj;wConv;bConv;wXProj;bXProj;wDtProj;bDtProj;A_log;D_vec;wOutProj;bOutProj;normWeight;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(t.dModel/16),...t};const{dModel:o,expand:r}=this.config;this.dInner=r*o,this.dtRank=t.dtRank??Math.ceil(o/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:o}=this.config,r=this.dInner,s=t,a=o,i=this.dtRank,c=(d,h=.02)=>me(d,h),l=d=>new Float32Array(d),u=d=>new Float32Array(d).fill(1);this.wInProj=c(2*r*e),this.bInProj=l(2*r),this.wConv=c(r*a,.01),this.bConv=l(r),this.wXProj=c((i+2*s)*r,.01),this.bXProj=l(i+2*s),this.wDtProj=c(r*i,.02),this.bDtProj=l(r),this.A_log=new Float32Array(r*s);for(let d=0;d<r;d++)for(let h=0;h<s;h++)this.A_log[d*s+h]=Math.log(h+1);this.D_vec=u(r),this.wOutProj=c(e*r,.02),this.bOutProj=l(e),this.normWeight=u(e),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const e=this.device,t=o=>Q(e,o,!0);this.gpuWeights={wInProj:t(this.wInProj),bInProj:t(this.bInProj),wConv:t(this.wConv),bConv:t(this.bConv),wXProj:t(this.wXProj),bXProj:t(this.bXProj),wDtProj:t(this.wDtProj),bDtProj:t(this.bDtProj),A_log:t(this.A_log),D_vec:t(this.D_vec),wOutProj:t(this.wOutProj),bOutProj:t(this.bOutProj),normWeight:t(this.normWeight)}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,Te,"linear_forward"),conv1d:R(e,St,"conv1d_forward"),silu:R(e,ye,"silu_forward"),rmsnorm:R(e,ye,"rmsnorm_forward"),scan_fwd:R(e,Vt,"forward_scan"),scan_reduce:R(e,Vt,"forward_reduce"),colSlice:R(e,Je,Ze),elMul:R(e,so,"main"),elAdd:R(e,ao,"main")}}forward(e,t,o){const r=this.device,{dModel:s,dState:a,dConv:i}=this.config,c=this.dInner,l=a,u=t,d=o,h=u*d,m=this.dtRank,f={},g=S(r,h*s*4,!0),p=S(r,h*4,!0);f.normInv=p,f.normIn=e;{const v=new ArrayBuffer(16);new Uint32Array(v,0,2).set([h,s]),new Float32Array(v,8,1).set([1e-6]);const k=z(r,v),E=$(r,this.pipelines.rmsnorm,[k,e,this.gpuWeights.normWeight,g,p]);I(r,this.pipelines.rmsnorm,E,[B(h,64),1,1])}const _=S(r,h*2*c*4,!0);f.normOut=g;{const v=new Uint32Array([h,s,2*c]).buffer,k=z(r,v),E=$(r,this.pipelines.linear,[k,g,this.gpuWeights.wInProj,this.gpuWeights.bInProj,_]);I(r,this.pipelines.linear,E,[B(h,16),B(2*c,16),1])}const w=S(r,h*c*4,!0),b=S(r,h*c*4,!0);{const v=this.pipelines.colSlice;Y(r,v,_,w,h,2*c,0,c),Y(r,v,_,b,h,2*c,c,c)}_.destroy(),f.zBuf=b,f.xConvIn=w;const y=S(r,h*c*4,!0);f.convOut=y;{const v=new Uint32Array([d,c,i,u,1]).buffer,k=z(r,v),E=$(r,this.pipelines.conv1d,[k,w,this.gpuWeights.wConv,this.gpuWeights.bConv,y]);I(r,this.pipelines.conv1d,E,[B(d,16),B(c,16),u])}const x=S(r,h*c*4,!0);f.siluOut=x;{const v=new Uint32Array([h*c]).buffer,k=z(r,v),E=$(r,this.pipelines.silu,[k,y,x]);I(r,this.pipelines.silu,E,[B(h*c,256),1,1])}const L=S(r,h*(m+2*l)*4,!0);{const v=new Uint32Array([h,c,m+2*l]).buffer,k=z(r,v),E=$(r,this.pipelines.linear,[k,x,this.gpuWeights.wXProj,this.gpuWeights.bXProj,L]);I(r,this.pipelines.linear,E,[B(h,16),B(m+2*l,16),1])}const P=S(r,h*m*4,!0),M=S(r,u*d*l*4,!0),F=S(r,u*d*l*4,!0);{const v=m+2*l,k=this.pipelines.colSlice;Y(r,k,L,P,h,v,0,m),Y(r,k,L,M,h,v,m,l),Y(r,k,L,F,h,v,m+l,l)}L.destroy(),f.B_raw=M,f.C_raw=F;const C=S(r,h*c*4,!0);f.deltaFull=C;{const v=new Uint32Array([h,m,c]).buffer,k=z(r,v),E=$(r,this.pipelines.linear,[k,P,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,C]);I(r,this.pipelines.linear,E,[B(h,16),B(c,16),1])}P.destroy();const O=S(r,u*d*c*4,!0),U=S(r,2*u*d*c*l*4,!0);f.hCache=U;{const v=new Uint32Array([d,l,c,u]).buffer,k=z(r,v),E=$(r,this.pipelines.scan_fwd,[k,x,C,this.gpuWeights.A_log,M,F,this.gpuWeights.D_vec,O,U]);I(r,this.pipelines.scan_fwd,E,[c,l,u]);const j=$(r,this.pipelines.scan_reduce,[k,x,C,this.gpuWeights.A_log,M,F,this.gpuWeights.D_vec,O,U]);I(r,this.pipelines.scan_reduce,j,[B(d,64),c,u])}const G=S(r,h*c*4,!0),W=S(r,h*c*4,!0);{const v=z(r,new Uint32Array([h*c]).buffer),k=$(r,this.pipelines.silu,[v,b,G]);I(r,this.pipelines.silu,k,[B(h*c,256),1,1]);const E=z(r,new Uint32Array([h*c]).buffer),j=$(r,this.pipelines.elMul,[O,G,W,E]);I(r,this.pipelines.elMul,j,[B(h*c,256),1,1])}G.destroy(),O.destroy();const H=S(r,h*s*4,!0);{const v=new Uint32Array([h,c,s]).buffer,k=z(r,v),E=$(r,this.pipelines.linear,[k,W,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,H]);I(r,this.pipelines.linear,E,[B(h,16),B(s,16),1])}W.destroy();const A=S(r,h*s*4,!0);{const v=z(r,new Uint32Array([h*s]).buffer),k=$(r,this.pipelines.elAdd,[H,e,A,v]);I(r,this.pipelines.elAdd,k,[B(h*s,256),1,1])}return H.destroy(),{output:A,cache:f}}parameters(){const{dModel:e,dState:t,dConv:o}=this.config,r=this.dInner,s=t,a=o,i=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*r*e,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*r,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:r*a,name:"wConv"},{buf:this.gpuWeights.bConv,numel:r,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(i+2*s)*r,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:i+2*s,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:r*i,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:r,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:r*s,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:r,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*r,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:e,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const co=`
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
`,oc=`
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
`,lo=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class uo{layerType="mamba2";device;config;dInner;dHead;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...t};const{dModel:o,expand:r,nHeads:s}=this.config;if(this.dInner=r*o,this.dHead=this.dInner/s,this.dInner%s!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${s}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:o,nHeads:r,nGroups:s}=this.config,a=this.dInner,i=t,c=o,l=r,u=s,d=(p,_=.02)=>me(p,_),h=p=>new Float32Array(p),m=p=>new Float32Array(p).fill(1),f=a+2*u*i+l,g=p=>Q(this.device,p,!0);this.gpuWeights={wInProj:g(d(f*e)),wConv:g(d((a+2*u*i)*c,.01)),bConv:g(h(a+2*u*i)),A_log:g(new Float32Array(l).fill(Math.log(1))),dt_bias:g(h(l)),D_vec:g(m(l)),wOutProj:g(d(e*a,.02)),normWeight:g(m(a)),preNormWeight:g(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,Te,"linear_forward"),conv1d:R(e,St,"conv1d_forward"),colSlice:R(e,Je,Ze),rmsnorm:R(e,ye,"rmsnorm_forward"),ssd_fwd:R(e,co,"ssd_chunk_forward"),elAdd:R(e,lo,"main")}}forward(e,t,o){const r=this.device,{dModel:s,dState:a,dConv:i,nHeads:c,nGroups:l,chunkLen:u}=this.config,d=this.dInner,h=a,m=i,f=c,g=l,p=this.dHead,_=t,w=o,b=_*w,y=d+2*g*h,x=Math.ceil(w/u),L=S(r,b*s*4,!0),P=S(r,b*4,!0);{const T=new ArrayBuffer(16);new Uint32Array(T,0,2).set([b,s]),new Float32Array(T,8,1).set([1e-6]);const D=z(r,T),K=$(r,this.pipelines.rmsnorm,[D,e,this.gpuWeights.preNormWeight,L,P]);I(r,this.pipelines.rmsnorm,K,[B(b,64),1,1])}P.destroy();const M=d+2*g*h+f,F=S(r,b*M*4,!0);{const T=new Uint32Array([b,s,M]).buffer,D=z(r,T),K=Q(r,new Float32Array(M),!0),Z=$(r,this.pipelines.linear,[D,L,this.gpuWeights.wInProj,K,F]);I(r,this.pipelines.linear,Z,[B(b,16),B(M,16),1]),K.destroy()}L.destroy();const C=S(r,b*y*4,!0),O=S(r,b*f*4,!0);{const T=this.pipelines.colSlice,D=y+f;Y(r,T,F,C,b,D,0,y),Y(r,T,F,O,b,D,y,f)}F.destroy();const U=S(r,b*y*4,!0);{const T=new Uint32Array([w,y,m,_,1]).buffer,D=z(r,T),K=$(r,this.pipelines.conv1d,[D,C,this.gpuWeights.wConv,this.gpuWeights.bConv,U]);I(r,this.pipelines.conv1d,K,[B(w,16),B(y,16),_])}C.destroy();const G=S(r,b*d*4,!0),W=S(r,b*g*h*4,!0),H=S(r,b*g*h*4,!0);{const T=this.pipelines.colSlice;Y(r,T,U,G,b,y,0,d),Y(r,T,U,W,b,y,d,g*h),Y(r,T,U,H,b,y,d+g*h,g*h)}U.destroy();const A=S(r,(x+1)*_*f*h*p*4,!0),v=S(r,b*d*4,!0);{const T=new Uint32Array([w,d,f,p,g,h,u,x,_]).buffer,D=z(r,T),K=$(r,this.pipelines.ssd_fwd,[D,G,W,H,O,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,v,A]);I(r,this.pipelines.ssd_fwd,K,[x,f,_])}G.destroy(),W.destroy(),H.destroy(),O.destroy();const k=S(r,b*d*4,!0),E=S(r,b*4,!0);{const T=new ArrayBuffer(16);new Uint32Array(T,0,2).set([b,d]),new Float32Array(T,8,1).set([1e-6]);const D=z(r,T),K=$(r,this.pipelines.rmsnorm,[D,v,this.gpuWeights.normWeight,k,E]);I(r,this.pipelines.rmsnorm,K,[B(b,64),1,1])}v.destroy(),E.destroy();const j=S(r,b*s*4,!0);{const T=new Uint32Array([b,d,s]).buffer,D=z(r,T),K=Q(r,new Float32Array(s),!0),Z=$(r,this.pipelines.linear,[D,k,this.gpuWeights.wOutProj,K,j]);I(r,this.pipelines.linear,Z,[B(b,16),B(s,16),1]),K.destroy()}k.destroy();const q=S(r,b*s*4,!0);{const T=z(r,new Uint32Array([b*s]).buffer),D=$(r,this.pipelines.elAdd,[j,e,q,T]);I(r,this.pipelines.elAdd,D,[B(b*s,256),1,1])}return j.destroy(),{output:q,cache:{stateCarry:A}}}parameters(){const{dModel:e,dState:t,dConv:o,nHeads:r,nGroups:s}=this.config,a=this.dInner,i=t,c=o,l=r,u=s,d=a+2*u*i;return[{buf:this.gpuWeights.wInProj,numel:(a+2*u*i+l)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:d*c,name:"wConv"},{buf:this.gpuWeights.bConv,numel:d,name:"bConv"},{buf:this.gpuWeights.A_log,numel:l,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:l,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:l,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*a,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:a,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const ho=`
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
`,sc=`
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
`,fo=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class mo{layerType="mamba3";device;config;dInner;dHead;nComplex;gpuWeights;pipelines;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...t};const{dModel:o,expand:r,nHeads:s}=this.config;if(this.dInner=r*o,this.dHead=this.dInner/s,this.nComplex=this.config.dState,this.dInner%s!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${s}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dConv:t,nHeads:o,nGroups:r}=this.config,s=this.dInner,a=this.nComplex,i=t,c=o,l=r,u=s+2*l*a*2,d=(_,w=.02)=>me(_,w),h=_=>new Float32Array(_),m=_=>new Float32Array(_).fill(1),f=new Float32Array(c*2);for(let _=0;_<c;_++)f[_*2+0]=0,f[_*2+1]=2*Math.PI*_/c;const g=_=>Q(this.device,_,!0),p=s+2*l*a*2+c;this.gpuWeights={wInProj:g(d(p*e)),wConv:g(d(u*i,.01)),bConv:g(h(u)),A_log:g(f),dt_bias:g(h(c)),D_vec:g(m(c)),wOutProj:g(d(e*s,.02)),normWeight:g(m(s)),preNormWeight:g(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,Te,"linear_forward"),conv1d:R(e,St,"conv1d_forward"),colSlice:R(e,Je,Ze),rmsnorm:R(e,ye,"rmsnorm_forward"),cssd_fwd:R(e,ho,"complex_ssd_forward"),elAdd:R(e,fo,"main")}}forward(e,t,o){const r=this.device,{dModel:s,dConv:a,nHeads:i,nGroups:c,chunkLen:l}=this.config,u=this.dInner,d=this.nComplex,h=a,m=i,f=c,g=this.dHead,p=t,_=o,w=p*_,b=u+2*f*d*2,y=Math.ceil(_/l),x=S(r,w*s*4,!0),L=S(r,w*4,!0);{const N=new ArrayBuffer(16);new Uint32Array(N,0,2).set([w,s]),new Float32Array(N,8,1).set([1e-6]);const T=z(r,N),D=$(r,this.pipelines.rmsnorm,[T,e,this.gpuWeights.preNormWeight,x,L]);I(r,this.pipelines.rmsnorm,D,[B(w,64),1,1])}L.destroy();const P=u+2*f*d*2+m,M=S(r,w*P*4,!0);{const N=new Uint32Array([w,s,P]).buffer,T=z(r,N),D=Q(r,new Float32Array(P),!0),K=$(r,this.pipelines.linear,[T,x,this.gpuWeights.wInProj,D,M]);I(r,this.pipelines.linear,K,[B(w,16),B(P,16),1]),D.destroy()}x.destroy();const F=S(r,w*b*4,!0),C=S(r,w*m*4,!0);{const N=this.pipelines.colSlice,T=b+m;Y(r,N,M,F,w,T,0,b),Y(r,N,M,C,w,T,b,m)}M.destroy();const O=S(r,w*b*4,!0);{const N=new Uint32Array([_,b,h,p,1]).buffer,T=z(r,N),D=$(r,this.pipelines.conv1d,[T,F,this.gpuWeights.wConv,this.gpuWeights.bConv,O]);I(r,this.pipelines.conv1d,D,[B(_,16),B(b,16),p])}F.destroy();const U=S(r,w*u*4,!0),G=S(r,w*f*d*2*4,!0),W=S(r,w*f*d*2*4,!0);{const N=this.pipelines.colSlice;Y(r,N,O,U,w,b,0,u),Y(r,N,O,G,w,b,u,f*d*2),Y(r,N,O,W,w,b,u+f*d*2,f*d*2)}O.destroy();const H=S(r,(y+1)*p*m*d*2*g*4,!0),A=S(r,w*u*4,!0);{const N=new Uint32Array([_,u,m,g,f,d,l,y,p]).buffer,T=z(r,N),D=$(r,this.pipelines.cssd_fwd,[T,U,G,W,C,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,A,H]);I(r,this.pipelines.cssd_fwd,D,[y,m,p])}U.destroy(),G.destroy(),W.destroy(),C.destroy();const v=S(r,w*u*4,!0),k=S(r,w*4,!0);{const N=new ArrayBuffer(16);new Uint32Array(N,0,2).set([w,u]),new Float32Array(N,8,1).set([1e-6]);const T=z(r,N),D=$(r,this.pipelines.rmsnorm,[T,A,this.gpuWeights.normWeight,v,k]);I(r,this.pipelines.rmsnorm,D,[B(w,64),1,1])}A.destroy(),k.destroy();const E=S(r,w*s*4,!0);{const N=new Uint32Array([w,u,s]).buffer,T=z(r,N),D=Q(r,new Float32Array(s),!0),K=$(r,this.pipelines.linear,[T,v,this.gpuWeights.wOutProj,D,E]);I(r,this.pipelines.linear,K,[B(w,16),B(s,16),1]),D.destroy()}v.destroy();const j=S(r,w*s*4,!0);{const N=z(r,new Uint32Array([w*s]).buffer),T=$(r,this.pipelines.elAdd,[E,e,j,N]);I(r,this.pipelines.elAdd,T,[B(w*s,256),1,1])}return E.destroy(),{output:j,cache:{stateCarry:H}}}parameters(){const{dModel:e,dConv:t,nHeads:o,nGroups:r}=this.config,s=this.dInner,a=this.nComplex,i=t,c=o,l=r,u=s+2*l*a*2;return[{buf:this.gpuWeights.wInProj,numel:(s+2*l*a*2+c)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:u*i,name:"wConv"},{buf:this.gpuWeights.bConv,numel:u,name:"bConv"},{buf:this.gpuWeights.A_log,numel:c*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:c,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:c,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*s,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:s,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const go=`
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
`,ac=`
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
`,po=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,_o=`
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
`;class bo{layerType="attention";device;config;dHead;gpuWeights;pipelines;constructor(e,t){if(this.device=e,t.dModel%t.nHeads!==0)throw new Error(`AttentionBlock: dModel (${t.dModel}) must be divisible by nHeads (${t.nHeads}).`);this.config={dHead:t.dModel/t.nHeads,hasFfn:!1,ffnMult:4,...t},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,hasFfn:t,ffnMult:o}=this.config,r=(c,l=.02)=>me(c,l),s=c=>new Float32Array(c),a=c=>new Float32Array(c).fill(1),i=c=>Q(this.device,c,!0);if(this.gpuWeights={wQKV:i(r(3*e*e)),bQKV:i(s(3*e)),wO:i(r(e*e)),bO:i(s(e)),normWeight:i(a(e))},t){const c=e*o;this.gpuWeights.wFfn1=i(r(c*e)),this.gpuWeights.bFfn1=i(s(c)),this.gpuWeights.wFfn2=i(r(e*c)),this.gpuWeights.bFfn2=i(s(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:R(e,Te,"linear_forward"),rmsnorm:R(e,ye,"rmsnorm_forward"),attn_fwd:R(e,Yt,"attention_forward"),attn_val:R(e,Yt,"attention_value"),softmax:R(e,go,"softmax_forward"),colSlice:R(e,Je,Ze),elAdd:R(e,po,"main")},this.config.hasFfn&&(this.pipelines.silu=R(e,_o,"silu_forward"))}forward(e,t,o){const r=this.device,{dModel:s,nHeads:a,hasFfn:i}=this.config,c=this.dHead,l=t,u=o,d=l*u,h=a,m=S(r,d*s*4,!0),f=S(r,d*4,!0);{const M=new ArrayBuffer(16);new Uint32Array(M,0,2).set([d,s]),new Float32Array(M,8,1).set([1e-6]);const F=z(r,M),C=$(r,this.pipelines.rmsnorm,[F,e,this.gpuWeights.normWeight,m,f]);I(r,this.pipelines.rmsnorm,C,[B(d,64),1,1])}f.destroy();const g=S(r,d*3*s*4,!0);{const M=new Uint32Array([d,s,3*s]).buffer,F=z(r,M),C=$(r,this.pipelines.linear,[F,m,this.gpuWeights.wQKV,this.gpuWeights.bQKV,g]);I(r,this.pipelines.linear,C,[B(d,16),B(3*s,16),1])}m.destroy();const p=S(r,d*s*4,!0),_=S(r,d*s*4,!0),w=S(r,d*s*4,!0);{const M=this.pipelines.colSlice;Y(r,M,g,p,d,3*s,0,s),Y(r,M,g,_,d,3*s,s,s),Y(r,M,g,w,d,3*s,2*s,s)}g.destroy();const b=S(r,l*h*u*u*4,!0);{const M=new Uint32Array([l,u,s,h,c]).buffer,F=z(r,M),C=$(r,this.pipelines.attn_fwd,[F,p,_,w,b,S(r,d*s*4,!0)]);I(r,this.pipelines.attn_fwd,C,[B(u,16),h,l])}{const M=new Uint32Array([u,u,1]).buffer,F=z(r,M),C=$(r,this.pipelines.softmax,[F,b]);I(r,this.pipelines.softmax,C,[u,h,l])}const y=S(r,d*s*4,!0);{const M=new Uint32Array([l,u,s,h,c]).buffer,F=z(r,M),C=$(r,this.pipelines.attn_val,[F,p,_,w,b,y]);I(r,this.pipelines.attn_val,C,[B(u,16),h,l])}p.destroy(),_.destroy(),w.destroy();const x=S(r,d*s*4,!0);{const M=new Uint32Array([d,s,s]).buffer,F=z(r,M),C=$(r,this.pipelines.linear,[F,y,this.gpuWeights.wO,this.gpuWeights.bO,x]);I(r,this.pipelines.linear,C,[B(d,16),B(s,16),1])}y.destroy();let L=S(r,d*s*4,!0);{const M=z(r,new Uint32Array([d*s]).buffer),F=$(r,this.pipelines.elAdd,[x,e,L,M]);I(r,this.pipelines.elAdd,F,[B(d*s,256),1,1])}if(x.destroy(),i){const{ffnMult:M}=this.config,F=s*M,C=S(r,d*F*4,!0);{const W=new Uint32Array([d,s,F]).buffer,H=z(r,W),A=$(r,this.pipelines.linear,[H,L,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,C]);I(r,this.pipelines.linear,A,[B(d,16),B(F,16),1])}const O=S(r,d*F*4,!0);{const W=z(r,new Uint32Array([d*F]).buffer),H=$(r,this.pipelines.silu,[W,C,O]);I(r,this.pipelines.silu,H,[B(d*F,256),1,1])}C.destroy();const U=S(r,d*s*4,!0);{const W=new Uint32Array([d,F,s]).buffer,H=z(r,W),A=$(r,this.pipelines.linear,[H,O,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,U]);I(r,this.pipelines.linear,A,[B(d,16),B(s,16),1])}O.destroy();const G=S(r,d*s*4,!0);{const W=z(r,new Uint32Array([d*s]).buffer),H=$(r,this.pipelines.elAdd,[U,L,G,W]);I(r,this.pipelines.elAdd,H,[B(d*s,256),1,1])}U.destroy(),L.destroy(),L=G}return{output:L,cache:{scores:b}}}parameters(){const{dModel:e,hasFfn:t,ffnMult:o}=this.config,r=[{buf:this.gpuWeights.wQKV,numel:3*e*e,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*e,name:"bQKV"},{buf:this.gpuWeights.wO,numel:e*e,name:"wO"},{buf:this.gpuWeights.bO,numel:e,name:"bO"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}];if(t){const s=e*o;r.push({buf:this.gpuWeights.wFfn1,numel:s*e,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:s,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:e*s,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:e,name:"bFfn2"})}return r}getTrainableParams(){return this.parameters()}setWSLAMode(e){}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}function et(n){const e=new ArrayBuffer(4),t=new Float32Array(e),o=new Uint32Array(e);t[0]=n;const r=o[0],s=r>>>31&1,a=r>>>23&255,i=r&8388607;if(a===255)return s<<15|31744|(i?512:0);const c=a-127+15;if(c>=31)return s<<15|31744;if(c<=0){if(c<-10)return s<<15;const l=14-c;return s<<15|(i|8388608)>>l}return s<<15|c<<10|i>>13}function Ft(n){const e=n>>>15&1,t=n>>>10&31,o=n&1023;if(t===0){const a=o/1024*Math.pow(2,-14);return e?-a:a}if(t===31)return e?-1/0:o?NaN:1/0;const r=t-15,s=(1+o/1024)*Math.pow(2,r);return e?-s:s}function Pe(n){const e=new Uint16Array(n.length);for(let t=0;t<n.length;t++)e[t]=et(n[t]);return e}function Ne(n){const e=new Float32Array(n.length);for(let t=0;t<n.length;t++)e[t]=Ft(n[t]);return e}function wo(n){let e=0;for(let r=0;r<n.length;r++){const s=Math.abs(n[r]);s>e&&(e=s)}const t=e/127||1,o=new Int8Array(n.length);for(let r=0;r<n.length;r++)o[r]=Math.max(-128,Math.min(127,Math.round(n[r]/t)));return{data:o,scale:t}}function yo(n,e){const t=new Float32Array(n.length);for(let o=0;o<n.length;o++)t[o]=n[o]*e;return t}function ic(n,e){const t=n.length/e,o=new Float32Array(e),r=new Int8Array(n.length);for(let s=0;s<e;s++){let a=0;const i=s*t;for(let c=0;c<t;c++){const l=Math.abs(n[i+c]);l>a&&(a=l)}o[s]=a/127||1;for(let c=0;c<t;c++)r[i+c]=Math.max(-128,Math.min(127,Math.round(n[i+c]/o[s])))}return{data:r,scales:o}}function cc(n,e,t){const o=n.length/t,r=new Float32Array(n.length);for(let s=0;s<t;s++){const a=s*o;for(let i=0;i<o;i++)r[a+i]=n[a+i]*e[s]}return r}function lc(n){return{fp32:n*4,fp16:n*2,int8:n*1}}const Or=1380144709,_t=8,vo=(()=>{const n=new Uint32Array(256);for(let e=0;e<256;e++){let t=e;for(let o=0;o<8;o++)t=t&1?3988292384^t>>>1:t>>>1;n[e]=t>>>0}return n})();function Dt(n){let e=4294967295;for(let t=0;t<n.length;t++)e=vo[(e^n[t])&255]^e>>>8;return(e^4294967295)>>>0}function $e(n){const e=new Uint8Array(n),t=new ArrayBuffer(e.length+_t);new Uint8Array(t).set(e,0);const r=new DataView(t);return r.setUint32(e.length,Or,!0),r.setUint32(e.length+4,Dt(e),!0),t}function oe(n){if(n.byteLength<_t)return{hasTrailer:!1,ok:!0,body:n};const e=new DataView(n),t=n.byteLength-_t;if(e.getUint32(t,!0)!==Or)return{hasTrailer:!1,ok:!0,body:n};const r=e.getUint32(t+4,!0),s=n.slice(0,t);return{hasTrailer:!0,ok:Dt(new Uint8Array(s))===r,body:s}}const Qt=1296190035,xo={mamba1:0,mamba2:1,mamba3:2,attention:3},ko=["mamba1","mamba2","mamba3","attention"];class Ao{device;config;gpuEmbedding;layers;layerSpecs;gpuFinalNorm;tiedEmbedding;gpuLMHeadBias;_lmHeadPipeline;_rmsnormPipeline;_embedPipeline;_wslaMode=!1;constructor(e,t){this.device=e,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...t},Xt(this.config.seed);const o=t.layers??Array.from({length:t.numLayers},()=>({type:"mamba1"}));if(o.length!==t.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${o.length}) must equal numLayers (${t.numLayers}).`);this.layerSpecs=o;const{vocabSize:r,dModel:s}=this.config,a=me(r*s,1/Math.sqrt(s));this.gpuEmbedding=Q(e,a,!0),this.layers=o.map(i=>this._buildLayer(i)),Xt(void 0),this.gpuFinalNorm=Q(e,new Float32Array(s).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=Q(e,new Float32Array(r),!0),this._lmHeadPipeline=R(e,Te,"linear_forward"),this._rmsnormPipeline=R(e,ye,"rmsnorm_forward"),this._embedPipeline=R(e,Mo,"embed_lookup")}_buildLayer(e){const t=this.config;switch(e.type){case"mamba1":{const o={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,...t.defaultMamba1};return new io(this.device,{...o,...e.config??{}})}case"mamba2":{const o={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,...t.defaultMamba2};return new uo(this.device,{...o,...e.config??{}})}case"mamba3":{const o={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,mimoGroup:t.mimoGroup,...t.defaultMamba3};return new mo(this.device,{...o,...e.config??{}})}case"attention":{const o={dModel:t.dModel,nHeads:t.nHeads,...t.defaultAttention};return new bo(this.device,{...o,...e.config??{}})}}}embedTokens(e,t,o){const{dModel:r}=this.config,s=t*o,a=Q(this.device,e instanceof Uint32Array?e:new Uint32Array(e),!1),i=S(this.device,s*r*4,!0),c=z(this.device,new Uint32Array([s,r]).buffer),l=$(this.device,this._embedPipeline,[c,a,this.gpuEmbedding,i]);return I(this.device,this._embedPipeline,l,[B(s,64),1,1]),a.destroy(),c.destroy(),i}async forward(e,t,o){const{dModel:r,vocabSize:s}=this.config,a=t*o;let i=this.embedTokens(e,t,o);const c=[];for(const m of this.layers){const{output:f,cache:g}=m.forward(i,t,o);c.push(g),i.destroy(),i=f}const l=S(this.device,a*r*4,!0),u=S(this.device,a*4,!1);{const m=new ArrayBuffer(16);new Uint32Array(m,0,2).set([a,r]),new Float32Array(m,8,1).set([1e-6]);const f=z(this.device,m),g=$(this.device,this._rmsnormPipeline,[f,i,this.gpuFinalNorm,l,u]);I(this.device,this._rmsnormPipeline,g,[B(a,64),1,1])}i.destroy();const d=S(this.device,a*s*4,!0);{const m=new Uint32Array([a,r,s]).buffer,f=z(this.device,m),g=$(this.device,this._lmHeadPipeline,[f,l,this.gpuEmbedding,this.gpuLMHeadBias,d]);I(this.device,this._lmHeadPipeline,g,[B(a,16),B(s,16),1])}return l.destroy(),u.destroy(),{logits:await de(this.device,d,a*s*4),gpuLogits:d,caches:c}}async embed(e){const{dModel:t}=this.config,o=e.length,r=1,s=r*o;if(s===0)return new Float32Array(t);let a=this.embedTokens(e,r,o);for(const h of this.layers){const{output:m}=h.forward(a,r,o);a.destroy(),a=m}const i=S(this.device,s*t*4,!0),c=S(this.device,s*4,!1);{const h=new ArrayBuffer(16);new Uint32Array(h,0,2).set([s,t]),new Float32Array(h,8,1).set([1e-6]);const m=z(this.device,h),f=$(this.device,this._rmsnormPipeline,[m,a,this.gpuFinalNorm,i,c]);I(this.device,this._rmsnormPipeline,f,[B(s,64),1,1])}a.destroy();const l=await de(this.device,i,s*t*4);i.destroy(),c.destroy();const u=new Float32Array(t);for(let h=0;h<o;h++){const m=h*t;for(let f=0;f<t;f++)u[f]+=l[m+f]}for(let h=0;h<t;h++)u[h]/=o;let d=0;for(let h=0;h<t;h++)d+=u[h]*u[h];d=Math.sqrt(d)||1;for(let h=0;h<t;h++)u[h]/=d;return u}async generate(e,t=200,o={}){const{temperature:r=1,topK:s=50,topP:a=.9}=o,{vocabSize:i}=this.config,c=[...e];for(let l=0;l<t;l++){const{logits:u}=await this.forward(new Uint32Array(c),1,c.length),d=u.slice((c.length-1)*i,c.length*i),h=Lo(d,{temperature:r,topK:s,topP:a});if(c.push(h),h===this.config.eosId)break}return c}parameters(){const e=[];e.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let t=0;t<this.layers.length;t++)for(const o of this.layers[t].parameters())e.push({...o,name:`layer${t}.${o.name}`});return e.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),e}getTrainableParams(){if(!this._wslaMode)return this.parameters();const e=[];for(let t=0;t<this.layers.length;t++)for(const o of this.layers[t].getTrainableParams())e.push({...o,name:`layer${t}.${o.name}`});return e}setWSLAMode(e){for(const t of this.layers)t.setWSLAMode(e);this._wslaMode=e}async exportWeights(e={}){const t=e.fp16??!1,o=this.parameters(),r=o.length,s=this.layers.length,a=await Promise.all(o.map(g=>de(this.device,g.buf,g.numel*4))),i=Math.ceil(s/4)*4,c=12+i+4+r*4,l=t?2:4,d=a.reduce((g,p)=>g+p.length,0)*l,h=new ArrayBuffer(c+d),m=new DataView(h);let f=0;m.setUint32(f,Qt,!0),f+=4,m.setUint32(f,t?3:2,!0),f+=4,m.setUint32(f,s,!0),f+=4;for(let g=0;g<s;g++){const p=this.layers[g].layerType;m.setUint8(f+g,xo[p])}f+=i,m.setUint32(f,r,!0),f+=4;for(const g of o)m.setUint32(f,g.numel,!0),f+=4;if(t)for(const g of a){const p=Pe(g);new Uint16Array(h,f,p.length).set(p),f+=p.length*2}else for(const g of a)new Float32Array(h,f,g.length).set(g),f+=g.byteLength;return $e(h)}async loadWeights(e){const t=oe(e);if(t.hasTrailer&&!t.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const o=new DataView(e);let r=0;const s=o.getUint32(r,!0);if(r+=4,s!==Qt)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const a=o.getUint32(r,!0);if(r+=4,a===1){const i=o.getUint32(r,!0);r+=4;const c=this.parameters();if(i!==c.length)throw new Error(`Weight file has ${i} parameters but this model has ${c.length}.`);const l=[];for(let u=0;u<i;u++)l.push(o.getUint32(r,!0)),r+=4;for(let u=0;u<i;u++){const d=c[u],h=l[u];if(h!==d.numel)throw new Error(`Parameter ${u} ("${d.name}") size mismatch: file=${h}, model=${d.numel}.`);we(this.device,d.buf,new Float32Array(e,r,d.numel)),r+=d.numel*4}return}if(a===2||a===3){const i=a===3,c=o.getUint32(r,!0);if(r+=4,c!==this.layers.length)throw new Error(`Weight file has ${c} layers but this model has ${this.layers.length}.`);for(let m=0;m<c;m++){const f=o.getUint8(r+m),g=this.layers[m].layerType,p=ko[f]??"mamba1";if(p!==g)throw new Error(`Layer ${m} type mismatch: file="${p}", model="${g}".`)}const l=Math.ceil(c/4)*4;r+=l;const u=o.getUint32(r,!0);r+=4;const d=this.parameters();if(u!==d.length)throw new Error(`Weight file has ${u} parameters but this model has ${d.length}.`);const h=[];for(let m=0;m<u;m++)h.push(o.getUint32(r,!0)),r+=4;for(let m=0;m<u;m++){const f=d[m],g=h[m];if(g!==f.numel)throw new Error(`Parameter ${m} ("${f.name}") size mismatch: file=${g}, model=${f.numel}.`);if(i){const p=new Uint16Array(e,r,g);we(this.device,f.buf,Ne(p)),r+=g*2}else we(this.device,f.buf,new Float32Array(e,r,f.numel)),r+=g*4}return}throw new Error(`Unsupported MBJS version: ${a}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const e of this.layers)e.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class dc extends Ao{constructor(e,t){super(e,{...t,layers:Array.from({length:t.numLayers},()=>({type:"mamba1"}))})}}const Mo=`
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
`;function Lo(n,{temperature:e=1,topK:t=50,topP:o=.9}={}){const r=n.length,s=new Float32Array(r);for(let p=0;p<r;p++)s[p]=n[p]/Math.max(e,1e-7);let a=-1/0;for(let p=0;p<r;p++)s[p]>a&&(a=s[p]);let i=0;const c=new Float32Array(r);for(let p=0;p<r;p++)c[p]=Math.exp(s[p]-a),i+=c[p];const u=Array.from({length:r},(p,_)=>_).sort((p,_)=>c[_]-c[p]).slice(0,t);let d=0;const h=[];for(const p of u)if(d+=c[p]/i,h.push(p),d>=o)break;let m=0;for(const p of h)m+=c[p];const f=Math.random()*m;let g=0;for(const p of h)if(g+=c[p],g>=f)return p;return h[h.length-1]}const Ie=1e-6;function ze(n){return 1/(1+Math.exp(-n))}function ve(n){let e=-1/0;for(let r=0;r<n.length;r++)n[r]>e&&(e=n[r]);const t=new Float32Array(n.length);let o=0;for(let r=0;r<n.length;r++)t[r]=Math.exp(n[r]-e),o+=t[r];for(let r=0;r<n.length;r++)t[r]=t[r]/o;return t}function Jt(n){return n/(1+Math.exp(-n))}function Zt(n){const e=ze(n);return e*(1+n*(1-e))}function Eo(n){return Math.max(n,0)+Math.log1p(Math.exp(-Math.abs(n)))}function Ee(n,e,t,o,r,s,a){for(let i=0;i<o;i++){const c=i*r,l=i*s;for(let u=0;u<s;u++){let d=t[u];const h=u*r;for(let m=0;m<r;m++)d+=n[c+m]*e[h+m];a[l+u]=d}}}function Ue(n,e,t,o,r,s,a,i,c){a.fill(0);for(let l=0;l<o;l++){const u=l*r,d=l*s;for(let h=0;h<s;h++){const m=n[d+h];if(m===0)continue;c[h]=c[h]+m;const f=h*r;for(let g=0;g<r;g++)a[u+g]=a[u+g]+m*t[f+g],i[f+g]=i[f+g]+m*e[u+g]}}}function Ur(n,e,t,o,r,s,a=Ie){for(let i=0;i<t;i++){const c=i*o;let l=0;for(let d=0;d<o;d++){const h=n[c+d];l+=h*h}const u=1/Math.sqrt(l/o+a);s[i]=u;for(let d=0;d<o;d++)r[c+d]=n[c+d]*u*e[d]}}function Hr(n,e,t,o,r,s,a,i,c=Ie){for(let l=0;l<r;l++){const u=l*s,d=o[l];let h=0;for(let f=0;f<s;f++){const g=n[u+f]*t[f];h+=g*e[u+f],i[f]=i[f]+n[u+f]*e[u+f]*d}const m=d*d*d/s;for(let f=0;f<s;f++){const g=n[u+f]*t[f];a[u+f]=a[u+f]+g*d-m*h*e[u+f]}}}const So={modelDim:64,hiddenDim:128,numExperts:8,topK:2},Fo=1299137793,er=1299137840;function Do(n){return n>0?n:0}class tr{modelDim;hiddenDim;w1;b1;w2;b2;gW1;gB1;gW2;gB2;constructor(e,t,o){this.modelDim=e,this.hiddenDim=t,this.w1=o(t*e,Math.sqrt(2/e)),this.b1=new Float32Array(t),this.w2=o(e*t,.02),this.b2=new Float32Array(e),this.gW1=new Float32Array(this.w1.length),this.gB1=new Float32Array(this.b1.length),this.gW2=new Float32Array(this.w2.length),this.gB2=new Float32Array(this.b2.length)}forward(e){const{modelDim:t,hiddenDim:o}=this,r=new Float32Array(o),s=new Float32Array(o);for(let i=0;i<o;i++){let c=this.b1[i];const l=i*t;for(let u=0;u<t;u++)c+=this.w1[l+u]*e[u];r[i]=c,s[i]=Do(c)}const a=new Float32Array(t);for(let i=0;i<t;i++){let c=this.b2[i];const l=i*o;for(let u=0;u<o;u++)c+=this.w2[l+u]*s[u];a[i]=c}return{y:a,pre:r,h:s}}backward(e,t,o,r){const{modelDim:s,hiddenDim:a}=this,i=new Float32Array(a);for(let l=0;l<s;l++){const u=e[l];this.gB2[l]=this.gB2[l]+u;const d=l*a;for(let h=0;h<a;h++)this.gW2[d+h]=this.gW2[d+h]+u*r[h],i[h]=i[h]+u*this.w2[d+h]}const c=new Float32Array(s);for(let l=0;l<a;l++){const u=o[l]>0?i[l]:0;this.gB1[l]=this.gB1[l]+u;const d=l*s;for(let h=0;h<s;h++)this.gW1[d+h]=this.gW1[d+h]+u*t[h],c[h]=c[h]+u*this.w1[d+h]}return c}params(){return[this.w1,this.b1,this.w2,this.b2]}grads(){return[this.gW1,this.gB1,this.gW2,this.gB2]}}class Bo{numExperts;counts;probSum;tokens=0;constructor(e){this.numExperts=e,this.counts=new Float32Array(e),this.probSum=new Float32Array(e)}observe(e){this.tokens++;for(const t of e.experts)this.counts[t]=this.counts[t]+1;for(let t=0;t<this.numExperts;t++)this.probSum[t]=this.probSum[t]+e.probs[t]}dispatchFractions(){const e=this.counts.reduce((t,o)=>t+o,0)||1;return Float32Array.from(this.counts,t=>t/e)}loss(){if(this.tokens===0)return 0;const e=this.dispatchFractions();let t=0;for(let o=0;o<this.numExperts;o++)t+=e[o]*(this.probSum[o]/this.tokens);return this.numExperts*t}}class Gr{config;wr;gWr;shared;experts;constructor(e={}){const t={...So,...e};if(t.topK>t.numExperts)throw new Error(`MoE topK (${t.topK}) must be ≤ numExperts (${t.numExperts})`);if(t.topK<1)throw new Error(`MoE topK must be ≥ 1 (got ${t.topK})`);this.config=t;const o=new te((e.seed??Fo)>>>0||1),r=(s,a)=>{const i=new Float32Array(s);for(let c=0;c<s;c++){const l=Math.max(o.next(),1e-12),u=o.next();i[c]=a*Math.sqrt(-2*Math.log(l))*Math.cos(2*Math.PI*u)}return i};this.wr=r(t.numExperts*t.modelDim,.02),this.gWr=new Float32Array(this.wr.length),this.shared=new tr(t.modelDim,t.hiddenDim,r),this.experts=Array.from({length:t.numExperts},()=>new tr(t.modelDim,t.hiddenDim,r))}route(e){const{numExperts:t,topK:o,modelDim:r}=this.config,s=new Float32Array(t);for(let d=0;d<t;d++){let h=0;const m=d*r;for(let f=0;f<r;f++)h+=this.wr[m+f]*e[f];s[d]=h}const a=ve(s),c=Array.from({length:t},(d,h)=>h).sort((d,h)=>s[h]-s[d]).slice(0,o),l=c.map(d=>s[d]),u=ve(Float32Array.from(l));return{experts:c,gates:Array.from(u),probs:a}}forward(e){const{modelDim:t}=this.config,o=Float32Array.from({length:t},(u,d)=>e[d]??0),r=this.route(o),s=this.shared.forward(o),a=Float32Array.from(s.y),i=[],c=[],l=[];for(let u=0;u<r.experts.length;u++){const h=this.experts[r.experts[u]].forward(o),m=r.gates[u];for(let f=0;f<t;f++)a[f]=a[f]+m*h.y[f];i.push(h.y),c.push(h.pre),l.push(h.h)}return{output:a,route:r,cache:{x:o,route:r,sharedPre:s.pre,sharedH:s.h,expertOut:i,expertPre:c,expertH:l}}}backward(e,t){const{modelDim:o}=this.config,r=Float32Array.from({length:o},(d,h)=>e[h]??0),s=new Float32Array(o),a=this.shared.backward(r,t.x,t.sharedPre,t.sharedH);for(let d=0;d<o;d++)s[d]=s[d]+a[d];const i=t.route.experts.length,c=new Float32Array(i);for(let d=0;d<i;d++){const h=t.route.gates[d],m=new Float32Array(o);let f=0;for(let p=0;p<o;p++)m[p]=h*r[p],f+=r[p]*t.expertOut[d][p];const g=this.experts[t.route.experts[d]].backward(m,t.x,t.expertPre[d],t.expertH[d]);for(let p=0;p<o;p++)s[p]=s[p]+g[p];c[d]=f}const l=t.route.gates;let u=0;for(let d=0;d<i;d++)u+=l[d]*c[d];for(let d=0;d<i;d++){const h=l[d]*(c[d]-u),f=t.route.experts[d]*o;for(let g=0;g<o;g++)this.gWr[f+g]=this.gWr[f+g]+h*t.x[g],s[g]=s[g]+h*this.wr[f+g]}return s}auxGradStep(e,t,o,r){const{numExperts:s,modelDim:a}=this.config;let i=0;for(let c=0;c<s;c++)i+=o[c]*t[c];for(let c=0;c<s;c++){const l=r*t[c]*(o[c]-i);if(l===0)continue;const u=c*a;for(let d=0;d<a;d++)this.gWr[u+d]=this.gWr[u+d]+l*e[d]}}parameters(){const e=[{name:"wr",data:this.wr,numel:this.wr.length}],t=(o,r)=>{const s=["w1","b1","w2","b2"];r.params().forEach((a,i)=>e.push({name:`${o}.${s[i]}`,data:a,numel:a.length}))};return t("shared",this.shared),this.experts.forEach((o,r)=>t(`expert${r}`,o)),e}gradients(){const e=[{name:"wr",data:this.gWr,numel:this.gWr.length}],t=(o,r)=>{const s=["w1","b1","w2","b2"];r.grads().forEach((a,i)=>e.push({name:`${o}.${s[i]}`,data:a,numel:a.length}))};return t("shared",this.shared),this.experts.forEach((o,r)=>t(`expert${r}`,o)),e}zeroGrad(){for(const e of this.gradients())e.data.fill(0)}exportExpert(e){const t=this.experts[e];if(!t)throw new Error(`exportExpert: index ${e} out of range (0..${this.config.numExperts-1})`);const o=["w1","b1","w2","b2"];return t.params().map((r,s)=>({name:o[s],data:r,numel:r.length}))}exportWeights(e={}){const t=e.fp16??!1,o=this.parameters(),r=o.reduce((d,h)=>d+h.numel,0),s=6,a=s*4,i=new ArrayBuffer(a+(t?r*2:r*4)),c=new Uint32Array(i,0,s);c[0]=er,c[1]=t?2:1,c[2]=this.config.modelDim,c[3]=this.config.hiddenDim,c[4]=this.config.numExperts,c[5]=this.config.topK;const l=new Float32Array(r);let u=0;for(const d of o)l.set(d.data,u),u+=d.numel;return t?new Uint16Array(i,a,r).set(Pe(l)):new Float32Array(i,a,r).set(l),i}loadWeights(e){const t=new Uint32Array(e,0,6);if(t[0]!==er)throw new Error("SharedExpertMoE.loadWeights: bad magic (not an MoE0 checkpoint)");const[,o,r,s,a,i]=t;if(r!==this.config.modelDim||s!==this.config.hiddenDim||a!==this.config.numExperts||i!==this.config.topK)throw new Error("SharedExpertMoE.loadWeights: config mismatch with checkpoint");const c=this.parameters(),l=c.reduce((m,f)=>m+f.numel,0),u=24,d=o===2?Ne(new Uint16Array(e,u,l)):new Float32Array(e.slice(u,u+l*4));let h=0;for(const m of c)m.data.set(d.subarray(h,h+m.numel)),h+=m.numel}}class Bt{target;m=[];v=[];t=0;opt;shard;constructor(e,t={}){this.target=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0};const o=t.shard??null;if(o&&(o.count<=0||o.index<0||o.index>=o.count))throw new Error(`AdamW: invalid shard ${o.index}/${o.count}`);this.shard=o;const r=e.parameters();for(let s=0;s<r.length;s++)this._owns(s)?(this.m.push(new Float32Array(r[s].data.length)),this.v.push(new Float32Array(r[s].data.length))):(this.m.push(null),this.v.push(null))}_owns(e){return this.shard===null||e%this.shard.count===this.shard.index}step(){this.t++;const{lr:e,beta1:t,beta2:o,eps:r,weightDecay:s}=this.opt,a=this.target.parameters(),i=this.target.gradients(),c=1-Math.pow(t,this.t),l=1-Math.pow(o,this.t);for(let u=0;u<a.length;u++){if(!this._owns(u))continue;const d=a[u].data,h=i[u].data,m=this.m[u],f=this.v[u];for(let g=0;g<d.length;g++){const p=h[g];m[g]=t*m[g]+(1-t)*p,f[g]=o*f[g]+(1-o)*p*p;const _=m[g]/c,w=f[g]/l;d[g]=d[g]-e*(_/(Math.sqrt(w)+r)+s*d[g])}}}stateBytes(){let e=0;for(const t of this.m)t&&(e+=t.byteLength);for(const t of this.v)t&&(e+=t.byteLength);return e}}const rr=34028234663852886e22;function Ke(n,e,t,o,r){const{lr:s,beta1:a,beta2:i,eps:c,weightDecay:l,beta1_t:u,beta2_t:d,maxDelta:h}=r,m=r.gradScale??1,f=1-u,g=1-d;let p=0;for(let _=0;_<n.length;_++){const w=e[_]*m,b=a*t[_]+(1-a)*w,y=i*o[_]+(1-i)*w*w;if(!(Math.abs(b)<=rr&&y<=rr)){p++;continue}t[_]=b,o[_]=y;let x=s*(b/f)/(Math.sqrt(y/g)+c);Number.isFinite(x)||(x=0),h>0&&(x=Math.min(h,Math.max(-h,x))),n[_]=n[_]*(1-s*l)-x}return p}class uc{model;adam;opt;constructor(e,t={}){this.model=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0,auxWeight:t.auxWeight??.01,batchSize:t.batchSize??0,epochs:t.epochs??1},this.adam=new Bt(e,this.opt)}fit(e){const t=[];for(let o=0;o<this.opt.epochs;o++)t.push(this.runEpoch(e));return t}runEpoch(e){const t=this.opt.batchSize>0?this.opt.batchSize:e.length,{numExperts:o,modelDim:r}=this.model.config;let s=0,a=0;for(let i=0;i<e.length;i+=t){const c=e.slice(i,i+t);this.model.zeroGrad();const l=[],u=[],d=new Bo(o);let h=0;for(const g of c){const p=this.model.forward(g.input),_=new Float32Array(r);for(let w=0;w<r;w++){const b=p.output[w]-(g.target[w]??0);_[w]=b,h+=.5*b*b}this.model.backward(_,p.cache),l.push(p.cache.x),u.push(p.route.probs),d.observe(p.route)}const m=d.dispatchFractions(),f=this.opt.auxWeight*o/c.length;for(let g=0;g<l.length;g++)this.model.auxGradStep(l[g],u[g],m,f);this.scaleGradients(1/c.length),this.adam.step(),s+=h,a=d.loss()}return{loss:s/Math.max(1,e.length),auxLoss:a}}scaleGradients(e){if(e!==1)for(const t of this.model.gradients())for(let o=0;o<t.data.length;o++)t.data[o]=t.data[o]*e}}let De=[],Ct=!0;class hc{data;shape;numel;requiresGrad;grad;_gradFn;constructor(e,t,o=!1){this.data=e,this.shape=t,this.numel=t.reduce((r,s)=>r*s,1),this.requiresGrad=o,this.grad=null,this._gradFn=null}get byteSize(){return this.numel*4}zeroGrad(e){this.grad&&e.queue.writeBuffer(this.grad,0,new Float32Array(this.numel))}destroy(){this.data?.destroy(),this.grad?.destroy(),this.data=null,this.grad=null}}function fc(){Ct=!0}function mc(){Ct=!1}function Co(){De=[]}function gc(n){return Ct?(De.push({backward:n}),De.length-1):-1}async function pc(){for(let n=De.length-1;n>=0;n--)await De[n].backward();Co()}function ke(n,e){let t=-1/0;for(let s=0;s<n.length;s++)n[s]>t&&(t=n[s]);let o=0;for(let s=0;s<n.length;s++)o+=Math.exp(n[s]-t);return Math.log(o)+t-n[e]}function Kr(n,e){let t=-1/0;for(let a=0;a<n.length;a++)n[a]>t&&(t=n[a]);let o=0;const r=new Float32Array(n.length);for(let a=0;a<n.length;a++)r[a]=Math.exp(n[a]-t),o+=r[a];const s=new Float32Array(n.length);for(let a=0;a<n.length;a++)s[a]=r[a]/o;return s[e]=(s[e]??0)-1,s}function qr(n){return Ft(et(n))}function _c(n){const e=new Float32Array(n.length);for(let t=0;t<n.length;t++)e[t]=qr(n[t]);return e}class To{_scale;growthFactor;backoffFactor;growthInterval;minScale;cleanStreak=0;_overflows=0;_skipped=0;constructor(e={}){this._scale=e.initScale??16384,this.growthFactor=e.growthFactor??2,this.backoffFactor=e.backoffFactor??.5,this.growthInterval=e.growthInterval??200,this.minScale=e.minScale??1}get scale(){return this._scale}get overflows(){return this._overflows}get skipped(){return this._skipped}check(e){for(const t of e){const o=t.data;for(let r=0;r<o.length;r++){const s=o[r];if(!Number.isFinite(s))return!0}}return!1}unscale(e){const t=1/this._scale;for(const o of e){const r=o.data;for(let s=0;s<r.length;s++)r[s]=r[s]*t}}update(e){return e?(this._overflows++,this._skipped++,this._scale=Math.max(this.minScale,this._scale*this.backoffFactor),this.cleanStreak=0,!1):(++this.cleanStreak>=this.growthInterval&&(this._scale*=this.growthFactor,this.cleanStreak=0),!0)}}const Vr=809784901,Po=1;function Xr(n,e,t,o=0){if(n.length!==e.length)throw new Error(`computeRowDelta: length mismatch (base ${n.length}, current ${e.length})`);if(t<=0||n.length%t!==0)throw new Error(`computeRowDelta: base length ${n.length} is not a multiple of rowSize ${t}`);const r=n.length/t,s=[];for(let i=0;i<r;i++){const c=i*t;let l=!1;for(let u=0;u<t;u++)if(Math.abs(e[c+u]-n[c+u])>o){l=!0;break}l&&s.push(i)}const a=new Float32Array(s.length*t);return s.forEach((i,c)=>a.set(e.subarray(i*t,i*t+t),c*t)),{rowSize:t,rows:s,data:a}}function Yr(n,e){if(n.length%e.rowSize!==0)throw new Error(`applyRowDelta: base length ${n.length} is not a multiple of rowSize ${e.rowSize}`);const t=Float32Array.from(n);return e.rows.forEach((o,r)=>{const s=o*e.rowSize;if(s+e.rowSize>t.length)throw new Error(`applyRowDelta: row ${o} out of range for base of ${t.length} elements`);t.set(e.data.subarray(r*e.rowSize,r*e.rowSize+e.rowSize),s)}),t}function Tt(n){const e=n.rows.length,o=4*4,r=e*4,s=n.data.length*4,a=new ArrayBuffer(o+r+s),i=new DataView(a);i.setUint32(0,Vr,!0),i.setUint32(4,Po,!0),i.setUint32(8,n.rowSize,!0),i.setUint32(12,e,!0);let c=o;for(const l of n.rows)i.setUint32(c,l,!0),c+=4;return new Float32Array(a,c,n.data.length).set(n.data),$e(a)}function Qr(n,e){const t=oe(n);if(t.hasTrailer&&!t.ok)throw new Error("diffCheckpoints: base failed CRC integrity check");const o=oe(e);if(o.hasTrailer&&!o.ok)throw new Error("diffCheckpoints: current failed CRC integrity check");if(t.body.byteLength!==o.body.byteLength)throw new Error(`diffCheckpoints: shape mismatch (base ${t.body.byteLength}B, current ${o.body.byteLength}B) — only same-config checkpoints can be diffed`);if(t.body.byteLength%4!==0)throw new Error("diffCheckpoints: checkpoint body is not 4-byte aligned (not an f32 checkpoint)");return Tt(Xr(new Float32Array(t.body),new Float32Array(o.body),1))}function Jr(n,e){const t=oe(n);if(t.hasTrailer&&!t.ok)throw new Error("applyCheckpointDiff: base failed CRC integrity check");const o=Yr(new Float32Array(t.body),tt(e)),r=new ArrayBuffer(o.byteLength);return new Float32Array(r).set(o),$e(r)}function tt(n){const e=oe(n);if(e.hasTrailer&&!e.ok)throw new Error("deserializeRowDelta: failed CRC integrity check (corrupt or truncated)");const t=e.body,o=new DataView(t);if(o.getUint32(0,!0)!==Vr)throw new Error("deserializeRowDelta: bad magic (not an EVD0 delta)");const r=o.getUint32(8,!0),s=o.getUint32(12,!0);let a=16;const i=[];for(let l=0;l<s;l++)i.push(o.getUint32(a,!0)),a+=4;const c=new Float32Array(t.slice(a,a+s*r*4));return{rowSize:r,rows:i,data:c}}const Ae={dModel:64,numLayers:2,convKernel:3,hiddenDim:128,numExperts:4,topK:2},No=1163283533,nr=1163283504;class rt{config;_positionsEvaluated=0;emb;gEmb;conv;gConv;nConv;gNConv;nMoe;gNMoe;moe;constructor(e){const t=e.dModel??Ae.dModel,o={vocabSize:e.vocabSize,dModel:t,numLayers:e.numLayers??Ae.numLayers,convKernel:e.convKernel??Ae.convKernel,hiddenDim:e.hiddenDim??t*2,numExperts:e.numExperts??Ae.numExperts,topK:e.topK??Ae.topK};if(o.vocabSize<=0)throw new Error("EvermindLM: vocabSize must be > 0");if(o.topK>o.numExperts)throw new Error("EvermindLM: topK must be ≤ numExperts");this.config=o;const r=(e.seed??No)>>>0||1,s=new te(r),a=(i,c)=>{const l=new Float32Array(i);for(let u=0;u<i;u++){const d=Math.max(s.next(),1e-12),h=s.next();l[u]=c*Math.sqrt(-2*Math.log(d))*Math.cos(2*Math.PI*h)}return l};this.emb=a(o.vocabSize*o.dModel,.02),this.gEmb=new Float32Array(this.emb.length),this.conv=[],this.gConv=[],this.nConv=[],this.gNConv=[],this.nMoe=[],this.gNMoe=[],this.moe=[];for(let i=0;i<o.numLayers;i++){const c=new Float32Array(o.dModel*o.convKernel);for(let l=0;l<o.dModel;l++)c[l*o.convKernel]=1;this.conv.push(c),this.gConv.push(new Float32Array(c.length)),this.nConv.push(new Float32Array(o.dModel).fill(1)),this.gNConv.push(new Float32Array(o.dModel)),this.nMoe.push(new Float32Array(o.dModel).fill(1)),this.gNMoe.push(new Float32Array(o.dModel)),this.moe.push(new Gr({modelDim:o.dModel,hiddenDim:o.hiddenDim,numExperts:o.numExperts,topK:o.topK,seed:r+1+i}))}}_embed(e){const{dModel:t}=this.config;return e.map(o=>{const r=new Float32Array(t),s=o*t;for(let a=0;a<t;a++)r[a]=this.emb[s+a];return r})}_forwardLayer(e,t){const o=t.length,r=[],s=[],a=[],i=[],c=[],l=[],u=[];for(let d=0;d<o;d++){const h=this._stepLayerPosition(e,t[d],r);s.push(h.normed),a.push(h.rmsConv),i.push(h.afterConv),c.push(h.rmsMoe),l.push(h.moeCache),u.push(h.out)}return{afterMoe:u,cache:{layerIn:t,normedConv:s,rmsConv:a,afterConv:i,rmsMoe:c,moeCache:l}}}_stepLayerPosition(e,t,o){const{dModel:r,convKernel:s}=this.config,a=this.conv[e],{y:i,r:c}=or(t,this.nConv[e]),l=Float32Array.from(t);for(let f=0;f<r;f++){let g=a[f*s]*i[f];for(let p=1;p<s;p++){const _=o[o.length-p];_&&(g+=a[f*s+p]*_[f])}l[f]=l[f]+g}for(o.push(i);o.length>s-1;)o.shift();const{y:u,r:d}=or(l,this.nMoe[e]),h=Float32Array.from(l),m=this.moe[e].forward(u);for(let f=0;f<r;f++)h[f]=h[f]+m.output[f];return this._positionsEvaluated++,{normed:i,rmsConv:c,afterConv:l,rmsMoe:d,moeCache:m.cache,out:h}}_embedOne(e){const{dModel:t}=this.config,o=new Float32Array(t),r=e*t;for(let s=0;s<t;s++)o[s]=this.emb[r+s];return o}_head(e){const{dModel:t,vocabSize:o}=this.config;return e.map(r=>{const s=new Float32Array(o);for(let a=0;a<o;a++){let i=0;const c=a*t;for(let l=0;l<t;l++)i+=r[l]*this.emb[c+l];s[a]=i}return s})}forward(e){let t=this._embed(e);const o=[];for(let r=0;r<this.config.numLayers;r++){const{afterMoe:s,cache:a}=this._forwardLayer(r,t);o.push(a),t=s}return{logits:this._head(t),cache:{tokens:e,layers:o,finalX:t}}}embed(e){const{dModel:t,numLayers:o}=this.config,r=new Float32Array(t),s=e.length;if(s===0)return r;const a=Array.from({length:o},()=>[]);for(let c=0;c<s;c++){let l=this._embedOne(e[c]);for(let u=0;u<o;u++)l=this._stepLayerPosition(u,l,a[u]).out;for(let u=0;u<t;u++)r[u]=r[u]+l[u]}for(let c=0;c<t;c++)r[c]=r[c]/s;let i=0;for(let c=0;c<t;c++)i+=r[c]*r[c];i=Math.sqrt(i)||1;for(let c=0;c<t;c++)r[c]=r[c]/i;return r}embedText(e,t){return this.embed(t.encode(e))}_headBackward(e,t,o){const{dModel:r,vocabSize:s}=this.config,a=e.length,i=a-1,c=1/i,l=Array.from({length:a},()=>new Float32Array(r));let u=0;for(let d=0;d<i;d++){const h=e[d+1];u+=ke(t[d],h)*c;const m=Kr(t[d],h),f=o[d];for(let g=0;g<s;g++){const p=m[g]*c;if(p===0)continue;const _=g*r;for(let w=0;w<r;w++)this.gEmb[_+w]=this.gEmb[_+w]+p*f[w],l[d][w]=l[d][w]+p*this.emb[_+w]}}return{loss:u,dX:l}}_backwardLayer(e,t,o){const{dModel:r,convKernel:s}=this.config,a=t.length,i=this.conv[e],c=this.gConv[e],l=this.nConv[e],u=this.gNConv[e],d=this.nMoe[e],h=this.gNMoe[e],m=[];for(let p=0;p<a;p++){const _=this.moe[e].backward(t[p],o.moeCache[p]),{dx:w,dgain:b}=sr(_,o.afterConv[p],o.rmsMoe[p],d);for(let x=0;x<r;x++)h[x]=h[x]+b[x];const y=Float32Array.from(t[p]);for(let x=0;x<r;x++)y[x]=y[x]+w[x];m.push(y)}const f=Array.from({length:a},()=>new Float32Array(r)),g=m.map(p=>Float32Array.from(p));for(let p=0;p<a;p++)for(let _=0;_<r;_++){const w=m[p][_];if(w!==0)for(let b=0;b<s;b++){const y=p-b;y<0||(c[_*s+b]=c[_*s+b]+w*o.normedConv[y][_],f[y][_]=f[y][_]+w*i[_*s+b])}}for(let p=0;p<a;p++){const{dx:_,dgain:w}=sr(f[p],o.layerIn[p],o.rmsConv[p],l);for(let b=0;b<r;b++)u[b]=u[b]+w[b],g[p][b]=g[p][b]+_[b]}return g}_embedBackward(e,t){const{dModel:o}=this.config;for(let r=0;r<e.length;r++){const s=e[r]*o;for(let a=0;a<o;a++)this.gEmb[s+a]=this.gEmb[s+a]+t[r][a]}}lossAndBackward(e){if(e.length<2)return 0;const{logits:t,cache:o}=this.forward(e),{loss:r,dX:s}=this._headBackward(e,t,o.finalX);let a=s;for(let i=this.config.numLayers-1;i>=0;i--)a=this._backwardLayer(i,a,o.layers[i]);return this._embedBackward(e,a),r}lossAndBackwardCheckpointed(e){if(e.length<2)return 0;let t=this._embed(e);const o=[];for(let c=0;c<this.config.numLayers;c++)o.push(t),t=this._forwardLayer(c,t).afterMoe;const r=this._head(t),{loss:s,dX:a}=this._headBackward(e,r,t);let i=a;for(let c=this.config.numLayers-1;c>=0;c--){const{cache:l}=this._forwardLayer(c,o[c]);i=this._backwardLayer(c,i,l)}return this._embedBackward(e,i),s}get positionsEvaluated(){return this._positionsEvaluated}resetStats(){this._positionsEvaluated=0}newDecodeState(){return{convWindow:Array.from({length:this.config.numLayers},()=>[]),length:0,lastLogits:null}}cloneDecodeState(e){return{convWindow:e.convWindow.map(t=>t.map(o=>Float32Array.from(o))),length:e.length,lastLogits:e.lastLogits?Float32Array.from(e.lastLogits):null}}stepDecode(e,t){const o=this.cloneDecodeState(e),r=[];for(const s of t){let a=this._embedOne(s);for(let c=0;c<this.config.numLayers;c++)a=this._stepLayerPosition(c,a,o.convWindow[c]).out;const i=this._head([a])[0];r.push(i),o.lastLogits=i,o.length++}return{logits:r,state:o}}prefixState(e){return this.stepDecode(this.newDecodeState(),e).state}scoreContinuation(e,t){if(t.length===0||!e.lastLogits)return-1/0;const{logits:o}=this.stepDecode(e,t.slice(0,-1));let r=ar(e.lastLogits,t[0]);for(let s=1;s<t.length;s++)r+=ar(o[s-1],t[s]);return r/t.length}generateText(e,t,o){return t.decode(this.generate(t.encode(e),o))}generate(e,t){const o=t.temperature??0,r=o>0?new te((t.seed??1)>>>0||1):null;let s=this.stepDecode(this.newDecodeState(),e.length>0?e:[0]).state;const a=[];for(let i=0;i<t.maxNewTokens;i++){const c=s.lastLogits,l=r?zo(c,o,r):Io(c);if(a.push(l),t.stopToken!==void 0&&l===t.stopToken)break;s=this.stepDecode(s,[l]).state}return a}parameters(){const e=[{data:this.emb}];for(let t=0;t<this.config.numLayers;t++){e.push({data:this.conv[t]},{data:this.nConv[t]},{data:this.nMoe[t]});for(const o of this.moe[t].parameters())e.push({data:o.data})}return e}gradients(){const e=[{data:this.gEmb}];for(let t=0;t<this.config.numLayers;t++){e.push({data:this.gConv[t]},{data:this.gNConv[t]},{data:this.gNMoe[t]});for(const o of this.moe[t].gradients())e.push({data:o.data})}return e}zeroGrad(){this.gEmb.fill(0);for(let e=0;e<this.config.numLayers;e++)this.gConv[e].fill(0),this.gNConv[e].fill(0),this.gNMoe[e].fill(0),this.moe[e].zeroGrad()}exportWeights(e={}){const t=e.fp16??!1,o=this.parameters(),r=o.reduce((d,h)=>d+h.data.length,0),s=9,a=s*4,i=new ArrayBuffer(a+(t?r*2:r*4)),c=new Uint32Array(i,0,s);c[0]=nr,c[1]=t?2:1,c[2]=this.config.vocabSize,c[3]=this.config.dModel,c[4]=this.config.numLayers,c[5]=this.config.convKernel,c[6]=this.config.hiddenDim,c[7]=this.config.numExperts,c[8]=this.config.topK;const l=new Float32Array(r);let u=0;for(const d of o)l.set(d.data,u),u+=d.data.length;return t?new Uint16Array(i,a,r).set(Pe(l)):new Float32Array(i,a,r).set(l),$e(i)}loadWeights(e){this._setFlat(this._readFlat(e))}_readFlat(e){const t=oe(e);if(t.hasTrailer&&!t.ok)throw new Error("EvermindLM.loadWeights: checkpoint failed CRC integrity check (corrupt or truncated)");const o=new Uint32Array(e,0,9);if(o[0]!==nr)throw new Error("EvermindLM.loadWeights: bad magic (not an EVL0 checkpoint)");const r=o[1];if(o[2]!==this.config.vocabSize||o[3]!==this.config.dModel||o[4]!==this.config.numLayers||o[5]!==this.config.convKernel||o[6]!==this.config.hiddenDim||o[7]!==this.config.numExperts||o[8]!==this.config.topK)throw new Error("EvermindLM.loadWeights: config mismatch with checkpoint");const s=this.parameters().reduce((i,c)=>i+c.data.length,0),a=36;return r===2?Ne(new Uint16Array(e,a,s)):new Float32Array(e.slice(a,a+s*4))}_flat(){const e=this.parameters(),t=e.reduce((s,a)=>s+a.data.length,0),o=new Float32Array(t);let r=0;for(const s of e)o.set(s.data,r),r+=s.data.length;return o}_setFlat(e){let t=0;for(const o of this.parameters())o.data.set(e.subarray(t,t+o.data.length)),t+=o.data.length}exportDelta(e,t={}){const o=this._readFlat(e),r=this._flat(),s=r.length%this.config.dModel===0?this.config.dModel:1;return Tt(Xr(o,r,s,t.eps??0))}loadDelta(e,t){const o=this._readFlat(e);this._setFlat(Yr(o,tt(t)))}}class Pt{model;opts;adam;scaler;grads;constructor(e,t={}){this.model=e,this.opts=t,this.adam=new Bt(e,t),this.grads=e.gradients(),this.scaler=t.mixedPrecision?new To(typeof t.mixedPrecision=="object"?t.mixedPrecision:{}):null}get lossScaler(){return this.scaler}_backward(e){return this.opts.checkpoint?this.model.lossAndBackwardCheckpointed(e):this.model.lossAndBackward(e)}_scaleGrads(e){if(e===1)return;const t=1/e;for(const o of this.grads)for(let r=0;r<o.data.length;r++)o.data[r]=o.data[r]*t}_fp16Grads(){for(const e of this.grads)for(let t=0;t<e.data.length;t++)e.data[t]=qr(e.data[t])}_mulGrads(e){if(e!==1)for(const t of this.grads)for(let o=0;o<t.data.length;o++)t.data[o]=t.data[o]*e}fit(e){const t=this.opts.epochs??1,o=Math.max(1,this.opts.accumSteps??1),r=[];for(let s=0;s<t;s++){let a=0,i=0,c=0,l=this.scaler?this.scaler.scale:1;this.model.zeroGrad();const u=()=>{if(c!==0){if(this._scaleGrads(c),this.scaler){this._fp16Grads();const d=this.scaler.check(this.grads);this.scaler.update(d)&&(this._mulGrads(1/l),this.adam.step()),l=this.scaler.scale}else this.adam.step();this.model.zeroGrad(),c=0}};for(const d of e){if(d.length<2)continue;c===0&&this.scaler&&(l=this.scaler.scale);const h=this._backward(d);this._mulGrads(l),a+=h,i++,++c>=o&&u()}u(),r.push(i>0?a/i:0)}return r}}const $o=1e-5;function or(n,e){const t=n.length;let o=0;for(let a=0;a<t;a++)o+=n[a]*n[a];const r=Math.sqrt(o/t+$o),s=new Float32Array(t);for(let a=0;a<t;a++)s[a]=e[a]*n[a]/r;return{y:s,r}}function sr(n,e,t,o){const r=e.length;let s=0;for(let l=0;l<r;l++)s+=n[l]*o[l]*e[l];const a=new Float32Array(r),i=new Float32Array(r),c=t*t*t;for(let l=0;l<r;l++)a[l]=o[l]*n[l]/t-e[l]*s/(r*c),i[l]=n[l]*e[l]/t;return{dx:a,dgain:i}}function Io(n){let e=0;for(let t=1;t<n.length;t++)n[t]>n[e]&&(e=t);return e}function zo(n,e,t){let o=-1/0;for(let i=0;i<n.length;i++)n[i]/e>o&&(o=n[i]/e);let r=0;const s=new Float32Array(n.length);for(let i=0;i<n.length;i++)s[i]=Math.exp(n[i]/e-o),r+=s[i];let a=t.next()*r;for(let i=0;i<s.length;i++)if(a-=s[i],a<=0)return i;return s.length-1}function ar(n,e){let t=-1/0;for(let s=0;s<n.length;s++){const a=n[s];a>t&&(t=a)}if(!Number.isFinite(t))return-1/0;let o=0;for(let s=0;s<n.length;s++)o+=Math.exp(n[s]-t);return(e>=0&&e<n.length?n[e]:-1/0)-(t+Math.log(o))}const He=0,it=1;class jo{textVocabSize;levels;codebookSize;bosVideo;eosVideo;frameKey;frameDelta;codeBase;size;perBank;constructor(e){if(e.textVocabSize<0)throw new Error("MultimodalVocab: textVocabSize must be ≥ 0");if(e.levels<=0||e.codebookSize<=0)throw new Error("MultimodalVocab: levels and codebookSize must be > 0");this.textVocabSize=e.textVocabSize,this.levels=e.levels,this.codebookSize=e.codebookSize,this.bosVideo=e.textVocabSize,this.eosVideo=e.textVocabSize+1,this.frameKey=e.textVocabSize+2,this.frameDelta=e.textVocabSize+3,this.codeBase=e.textVocabSize+4,this.perBank=e.levels*e.codebookSize,this.size=this.codeBase+2*this.perBank}codeToken(e,t,o){return this.codeBase+e*this.perBank+t*this.codebookSize+o}isText(e){return e>=0&&e<this.textVocabSize}isCode(e){return e>=this.codeBase&&e<this.size}isVideoMarker(e){return e===this.frameKey||e===this.frameDelta}decodeCode(e){const t=e-this.codeBase,o=Math.floor(t/this.perBank),r=t-o*this.perBank,s=Math.floor(r/this.codebookSize),a=r-s*this.codebookSize;return{bank:o,level:s,code:a}}classify(e){return this.isText(e)?{kind:"text",id:e}:e===this.bosVideo?{kind:"control",control:"bosVideo"}:e===this.eosVideo?{kind:"control",control:"eosVideo"}:e===this.frameKey?{kind:"control",control:"frameKey"}:e===this.frameDelta?{kind:"control",control:"frameDelta"}:{kind:"code",...this.decodeCode(e)}}}const ir=1448235312,ue={channels:3,patch:4,levels:2,codebookSize:16,keyframeInterval:12,textVocabSize:0,seed:1448232529};class nt{height;width;channels;patch;levels;codebookSize;keyframeInterval;latentDim;patchesPerFrame;tokensPerFrame;vocab;banks;constructor(e){const t=e.channels??ue.channels,o=e.patch??ue.patch;if(e.height<=0||e.width<=0)throw new Error("VideoRVQCodec: height/width must be > 0");if(e.height%o!==0||e.width%o!==0)throw new Error(`VideoRVQCodec: height/width must be divisible by patch (${o})`);this.height=e.height,this.width=e.width,this.channels=t,this.patch=o,this.levels=e.levels??ue.levels,this.codebookSize=e.codebookSize??ue.codebookSize,this.keyframeInterval=Math.max(1,e.keyframeInterval??ue.keyframeInterval),this.latentDim=o*o*t,this.patchesPerFrame=this.height/o*(this.width/o),this.tokensPerFrame=this.patchesPerFrame*this.levels,this.vocab=new jo({textVocabSize:e.textVocabSize??ue.textVocabSize,levels:this.levels,codebookSize:this.codebookSize});const r=new te((e.seed??ue.seed)>>>0||1),s=()=>Array.from({length:this.levels},()=>{const a=new Float32Array(this.codebookSize*this.latentDim);for(let i=0;i<a.length;i++)a[i]=(r.next()-.5)*.1;return a});this.banks=[s(),s()];for(const a of this.banks[He])for(let i=0;i<a.length;i++)a[i]+=.5}get vocabSize(){return this.vocab.size}serialize(){const t=2*this.levels*this.codebookSize*this.latentDim,o=new ArrayBuffer(36+t*4),r=new Uint32Array(o,0,9);r[0]=ir,r[1]=this.height,r[2]=this.width,r[3]=this.channels,r[4]=this.patch,r[5]=this.levels,r[6]=this.codebookSize,r[7]=this.keyframeInterval,r[8]=this.vocab.textVocabSize;const s=new Float32Array(o,36,t);let a=0;for(const i of this.banks)for(const c of i)s.set(c,a),a+=c.length;return o}static deserialize(e){const t=new Uint32Array(e,0,9);if(t[0]!==ir)throw new Error("VideoRVQCodec.deserialize: bad magic (not a VRQ0 blob)");const o=new nt({height:t[1],width:t[2],channels:t[3],patch:t[4],levels:t[5],codebookSize:t[6],keyframeInterval:t[7],textVocabSize:t[8]}),r=2*o.levels*o.codebookSize*o.latentDim,s=new Float32Array(e.slice(36,36+r*4));let a=0;for(const i of o.banks)for(const c of i)c.set(s.subarray(a,a+c.length)),a+=c.length;return o}encode(e){this.assertShape(e);const t=[this.vocab.bosVideo];let o=null;for(let r=0;r<e.length;r++){const s=this.toPatches(e[r]),a=o===null||r%this.keyframeInterval===0,i=a?He:it;t.push(a?this.vocab.frameKey:this.vocab.frameDelta);const c=[];for(let l=0;l<this.patchesPerFrame;l++){const u=a?s[l]:cr(s[l],o[l]),{codes:d,recon:h}=this.rvqEncode(i,u);for(let m=0;m<this.levels;m++)t.push(this.vocab.codeToken(i,m,d[m]));c.push(a?h:lr(o[l],h))}o=c}return t.push(this.vocab.eosVideo),t}decode(e){const t=[];let o=null,r=0;for(;r<e.length&&!this.vocab.isVideoMarker(e[r]);){if(e[r]===this.vocab.eosVideo)return t;r++}for(;r<e.length;){const s=e[r];if(!this.vocab.isVideoMarker(s))break;r++;const a=s===this.vocab.frameKey||o===null,i=a?He:it,c=[];for(;c.length<this.tokensPerFrame&&r<e.length&&this.vocab.isCode(e[r]);)c.push(e[r]),r++;const l=[];for(let u=0;u<this.patchesPerFrame;u++){const d=new Float32Array(this.latentDim);for(let h=0;h<this.levels;h++){const m=u*this.levels+h,f=m<c.length?c[m]:-1;if(f<0)continue;const{level:g,code:p}=this.vocab.decodeCode(f);Wo(d,this.banks[i][g],p,this.latentDim)}l.push(a?d:lr(o[u],d))}t.push(this.fromPatches(l)),o=l}return t}fit(e,t={}){const o=t.iterations??8,r=new te((t.seed??1718187041)>>>0||1);for(const l of e)this.assertShape(l);const s=[],a=[];for(const l of e){let u=null;for(let d=0;d<l.length;d++){const h=this.toPatches(l[d]);if(u===null||d%this.keyframeInterval===0)for(const f of h)s.push(f);else for(let f=0;f<h.length;f++)a.push(cr(h[f],u[f]));u=h}}this.fitBank(He,s,o,r),this.fitBank(it,a,o,r);let i=0,c=0;for(const l of e){const u=this.decode(this.encode(l));for(let d=0;d<l.length;d++){const h=l[d],m=u[d];for(let f=0;f<h.length;f++){const g=h[f]-m[f];i+=g*g}c+=h.length}}return c>0?i/c:0}fitBank(e,t,o,r){if(t.length===0)return;let s=t.map(a=>Float32Array.from(a));for(let a=0;a<this.levels;a++){const i=Oo(s,this.codebookSize,this.latentDim,o,r);this.banks[e][a]=i,s=s.map(c=>{const l=bt(i,c,this.codebookSize,this.latentDim),u=Float32Array.from(c),d=l*this.latentDim;for(let h=0;h<this.latentDim;h++)u[h]=u[h]-i[d+h];return u})}}rvqEncode(e,t){const o=Float32Array.from(t),r=new Float32Array(this.latentDim),s=[];for(let a=0;a<this.levels;a++){const i=this.banks[e][a],c=bt(i,o,this.codebookSize,this.latentDim);s.push(c);const l=c*this.latentDim;for(let u=0;u<this.latentDim;u++)r[u]=r[u]+i[l+u],o[u]=o[u]-i[l+u]}return{codes:s,recon:r}}toPatches(e){const{patch:t,channels:o,width:r}=this,s=this.width/t,a=this.height/t,i=[];for(let c=0;c<a;c++)for(let l=0;l<s;l++){const u=new Float32Array(this.latentDim);for(let d=0;d<t;d++)for(let h=0;h<t;h++){const m=c*t+d,f=l*t+h,g=(m*r+f)*o,p=(d*t+h)*o;for(let _=0;_<o;_++)u[p+_]=e[g+_]}i.push(u)}return i}fromPatches(e){const{patch:t,channels:o,width:r}=this,s=this.width/t,a=new Float32Array(this.height*this.width*o);for(let i=0;i<e.length;i++){const c=Math.floor(i/s),l=i-c*s,u=e[i];for(let d=0;d<t;d++)for(let h=0;h<t;h++){const m=c*t+d,f=l*t+h,g=(m*r+f)*o,p=(d*t+h)*o;for(let _=0;_<o;_++)a[g+_]=Ro(u[p+_])}}return a}assertShape(e){const t=this.height*this.width*this.channels;for(let o=0;o<e.length;o++)if(e[o].length!==t)throw new Error(`VideoRVQCodec: frame ${o} has length ${e[o].length}, expected ${t}`)}}function cr(n,e){const t=new Float32Array(n.length);for(let o=0;o<n.length;o++)t[o]=n[o]-e[o];return t}function lr(n,e){const t=new Float32Array(n.length);for(let o=0;o<n.length;o++)t[o]=n[o]+e[o];return t}function Wo(n,e,t,o){const r=t*o;for(let s=0;s<o;s++)n[s]=n[s]+e[r+s]}function Ro(n){return n<0?0:n>1?1:n}function bt(n,e,t,o){let r=0,s=1/0;for(let a=0;a<t;a++){const i=a*o;let c=0;for(let l=0;l<o;l++){const u=e[l]-n[i+l];if(c+=u*u,c>=s)break}c<s&&(s=c,r=a)}return r}function Oo(n,e,t,o,r){const s=new Float32Array(e*t);for(let c=0;c<e;c++){const l=n[Math.floor(r.next()*n.length)%n.length];s.set(l,c*t)}const a=new Float32Array(e*t),i=new Int32Array(e);for(let c=0;c<o;c++){a.fill(0),i.fill(0);for(const l of n){const u=bt(s,l,e,t);i[u]=i[u]+1;const d=u*t;for(let h=0;h<t;h++)a[d+h]=a[d+h]+l[h]}for(let l=0;l<e;l++){const u=l*t;if(i[l]===0){const h=n[Math.floor(r.next()*n.length)%n.length];s.set(h,u);continue}const d=1/i[l];for(let h=0;h<t;h++)s[u+h]=a[u+h]*d}}return s}function Uo(){const n=new Map,e=[[33,126],[161,172],[174,255]];let t=0;for(const[o,r]of e)for(let s=o;s<=r;s++)n.set(s,String.fromCodePoint(s));for(let o=0;o<256;o++)n.has(o)||(n.set(o,String.fromCodePoint(256+t)),t++);return n}const qe=Uo(),Ho=new Map([...qe].map(([n,e])=>[e,n])),dr=/(?:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;class je{vocab;idToToken;merges;bosToken;eosToken;padToken;unkToken;bosId;eosId;padId;constructor(){this.vocab=new Map,this.idToToken=new Map,this.merges=new Map,this.bosToken="<|im_start|>",this.eosToken="<|im_end|>",this.padToken="<|endoftext|>",this.unkToken="<unk>",this.bosId=null,this.eosId=null,this.padId=null}async load(e,t){let o;typeof e=="string"?o=await(await fetch(e)).json():o=e,this.vocab=new Map(Object.entries(o).map(([s,a])=>[s,Number(a)])),this.idToToken=new Map([...this.vocab].map(([s,a])=>[a,s]));let r;typeof t=="string"?r=(await(await fetch(t)).text()).split(`
`).filter(i=>i&&!i.startsWith("#")):r=t,this.merges=new Map,r.forEach((s,a)=>{this.merges.set(s.trim(),a)}),this.bosId=this.vocab.get(this.bosToken)??null,this.eosId=this.vocab.get(this.eosToken)??null,this.padId=this.vocab.get(this.padToken)??null}train(e,t={}){const o=t.numMerges??200,r=t.minPairFreq??2,s=Array.isArray(e)?e:[e],a=new Map;for(const d of s)for(const h of d.match(dr)??[]){const m=new TextEncoder().encode(h),f=Array.from(m).map(g=>qe.get(g)??"?").join("");a.set(f,(a.get(f)??0)+1)}const i=[...a].map(([d,h])=>({syms:[...d],freq:h})),c=[];for(let d=0;d<o;d++){const h=new Map;for(const{syms:b,freq:y}of i)for(let x=0;x<b.length-1;x++){const L=b[x]+" "+b[x+1];h.set(L,(h.get(L)??0)+y)}let m="",f=0;for(const[b,y]of h)y>f&&(m=b,f=y);if(f<r)break;c.push(m);const g=m.indexOf(" "),p=m.slice(0,g),_=m.slice(g+1),w=p+_;for(const b of i){const y=[];for(let x=0;x<b.syms.length;x++)x<b.syms.length-1&&b.syms[x]===p&&b.syms[x+1]===_?(y.push(w),x++):y.push(b.syms[x]);b.syms=y}}const l={};let u=0;for(const d of[this.unkToken,this.bosToken,this.eosToken,this.padToken])d in l||(l[d]=u++);for(const d of qe.values())d in l||(l[d]=u++);for(const d of c){const h=d.split(" ").join("");h in l||(l[h]=u++)}this.loadFromObjects(l,c)}loadFromObjects(e,t){this.vocab=new Map(Object.entries(e).map(([o,r])=>[o,Number(r)])),this.idToToken=new Map([...this.vocab].map(([o,r])=>[r,o])),this.merges=new Map(t.map((o,r)=>[o,r])),this.bosId=this.vocab.get(this.bosToken)??null,this.eosId=this.vocab.get(this.eosToken)??null,this.padId=this.vocab.get(this.padToken)??null}loadHuggingFace(e,t={}){const o=e.model??e,r=o.vocab??e.vocab,s=o.merges??e.merges;if(!r||typeof r!="object")throw new Error("loadHuggingFace: missing model.vocab (expected a Hugging Face tokenizer.json)");if(!Array.isArray(s))throw new Error("loadHuggingFace: missing model.merges (expected a BPE tokenizer.json)");const a=s.map(i=>Array.isArray(i)?`${i[0]} ${i[1]}`:String(i));t.bos&&(this.bosToken=t.bos),t.eos&&(this.eosToken=t.eos),t.pad&&(this.padToken=t.pad),t.unk&&(this.unkToken=t.unk),this.loadFromObjects(r,a)}toObject(){return{vocab:Object.fromEntries(this.vocab),merges:[...this.merges.entries()].sort((e,t)=>e[1]-t[1]).map(([e])=>e),specials:{bos:this.bosToken,eos:this.eosToken,pad:this.padToken,unk:this.unkToken}}}loadFromSpec(e){const t=e.specials;t?.bos&&(this.bosToken=t.bos),t?.eos&&(this.eosToken=t.eos),t?.pad&&(this.padToken=t.pad),t?.unk&&(this.unkToken=t.unk),this.loadFromObjects(e.vocab,e.merges)}serialize(){const e=new TextEncoder().encode(JSON.stringify(this.toObject())),t=new ArrayBuffer(e.byteLength);return new Uint8Array(t).set(e),t}static deserialize(e){const t=JSON.parse(new TextDecoder().decode(new Uint8Array(e)));if(!t||typeof t.vocab!="object"||!Array.isArray(t.merges))throw new Error("BPETokenizer.deserialize: not a serialised BPE tokenizer (expected { vocab, merges })");const o=new je;return o.loadFromSpec(t),o}async loadHuggingFaceUrl(e,t={}){const o=await fetch(e);if(!o.ok)throw new Error(`loadHuggingFaceUrl: ${o.status} fetching ${e}`);const r=await o.json();this.loadHuggingFace(r,t)}encode(e,t={}){const o=e.match(dr)??[],r=[];t.addBos&&this.bosId!==null&&r.push(this.bosId);for(const s of o){const a=new TextEncoder().encode(s),i=Array.from(a).map(l=>qe.get(l)??"?").join(""),c=this._bpe(i);for(const l of c){const u=this.vocab.get(l);if(u!==void 0)r.push(u);else for(const d of l){const h=this.vocab.get(d);h!==void 0&&r.push(h)}}}return t.addEos&&this.eosId!==null&&r.push(this.eosId),r}decode(e){let t="";for(const r of e){const s=this.idToToken.get(r);s!==void 0&&(t+=s)}const o=new Uint8Array([...t].map(r=>Ho.get(r)??r.codePointAt(0)??0));try{return new TextDecoder("utf-8").decode(o)}catch{return t}}_bpe(e){if(this.vocab.has(e))return[e];let t=[...e];for(;t.length>1;){let o=1/0,r=-1;for(let a=0;a<t.length-1;a++){const i=t[a]+" "+t[a+1],c=this.merges.get(i);c!==void 0&&c<o&&(o=c,r=a)}if(r===-1)break;const s=t[r]+t[r+1];t=[...t.slice(0,r),s,...t.slice(r+2)]}return t}padOrTruncate(e,t,o="right"){if(e.length>=t)return e.slice(0,t);const r=this.padId??0,s=new Array(t-e.length).fill(r);return o==="right"?[...e,...s]:[...s,...e]}get vocabSize(){return this.vocab.size}}const ur=32768;function Nt(n){const e=n instanceof Uint8Array?n:new Uint8Array(n);let t="";for(let o=0;o<e.length;o+=ur)t+=String.fromCharCode.apply(null,Array.from(e.subarray(o,o+ur)));return btoa(t)}function We(n){const e=atob(n),t=new Uint8Array(e.length);for(let o=0;o<e.length;o++)t[o]=e.charCodeAt(o);return t.buffer}const Zr=/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;function en(n){const e=new ArrayBuffer(n.length*4);return new Float32Array(e).set(Array.from(n)),$e(e)}function tn(n){const e=oe(n);if(!e.ok)throw new Error("headParams: checkpoint failed its CRC check");if(e.body.byteLength%4!==0)throw new Error("headParams: checkpoint is not f32");return new Float32Array(e.body)}function Go(n){if(!n||typeof n.task!="string"||typeof n.engine!="string")return"task and engine are required";if(!Number.isInteger(n.version)||n.version<0)return"version must be a non-negative integer";try{const e=oe(We(n.params));if(!e.hasTrailer||!e.ok)return"params checkpoint failed its CRC check";if(e.body.byteLength%4!==0)return"params checkpoint is not f32"}catch{return"params is not base64"}return null}const hr=1163283761,Me=12,Ko=1;function ae(n){let e=2166136261;for(let t=0;t<n.length;t++)e^=n[t],e=Math.imul(e,16777619);return e>>>0}class J{manifest;checkpoint;codec;tokenizer;constructor(e,t,o,r){this.manifest=e,this.checkpoint=t,this.codec=o,this.tokenizer=r}static _tokenizerSection(e,t){if(!e.tokenizer)return{fields:{}};const o=e.tokenizer.vocabSize;if(t!=null&&o!==t)throw new Error(`EvermindModelPackage: tokenizer vocabSize (${o}) must equal the model's (${t}) — a mismatched pair decodes to nonsense.`);const r=e.tokenizer.serialize();return{blob:r,fields:{tokenizerFormat:"BPE0",tokenizerBytes:r.byteLength,tokenizerChecksum:ae(new Uint8Array(r)),tokenizerVocabSize:o}}}static fromModel(e,t){const o=t.fp16??!1,r=e.exportWeights({fp16:o}),s=J._tokenizerSection(t,void 0),a={schema:"evermind.model/1",name:t.name,version:t.version,modelType:"shared-expert-moe",config:e.config,paramCount:e.parameters().reduce((i,c)=>i+c.numel,0),checkpointFormat:"MoE0",checkpointFp16:o,...s.blob?{checkpointBytes:r.byteLength}:{},checksum:ae(new Uint8Array(r)),...s.fields,card:t.card,...t.createdAt?{createdAt:t.createdAt}:{}};return new J(a,r,void 0,s.blob)}static fromLM(e,t){const o=t.fp16??!1,r=e.exportWeights({fp16:o}),s=J._tokenizerSection(t,e.config.vocabSize),a={schema:"evermind.model/1",name:t.name,version:t.version,modelType:"evermind-lm",config:e.config,paramCount:e.parameters().reduce((i,c)=>i+c.data.length,0),checkpointFormat:"EVL0",checkpointFp16:o,...s.blob?{checkpointBytes:r.byteLength}:{},checksum:ae(new Uint8Array(r)),...s.fields,card:t.card,...t.createdAt?{createdAt:t.createdAt}:{}};return new J(a,r,void 0,s.blob)}static fromMediaLM(e,t,o){if(e.config.vocabSize!==t.vocabSize)throw new Error(`fromMediaLM: LM vocabSize (${e.config.vocabSize}) must equal codec.vocabSize (${t.vocabSize})`);const r=o.fp16??!1,s=e.exportWeights({fp16:r}),a=t.serialize(),i=J._tokenizerSection(o,e.config.vocabSize),c={schema:"evermind.model/1",name:o.name,version:o.version,modelType:"evermind-lm",modality:o.modality,config:e.config,paramCount:e.parameters().reduce((l,u)=>l+u.data.length,0),checkpointFormat:"EVL0",checkpointFp16:r,checkpointBytes:s.byteLength,checksum:ae(new Uint8Array(s)),codecFormat:"VRQ0",...i.blob?{codecBytes:a.byteLength}:{},codecChecksum:ae(new Uint8Array(a)),...i.fields,card:o.card,...o.createdAt?{createdAt:o.createdAt}:{}};return new J(c,s,a,i.blob)}toBlob(){const e=new TextEncoder().encode(JSON.stringify(this.manifest)),t=Me,o=this.codec?.byteLength??0,r=this.tokenizer?.byteLength??0,s=new ArrayBuffer(t+e.byteLength+this.checkpoint.byteLength+o+r),a=new Uint32Array(s,0,3);a[0]=hr,a[1]=Ko,a[2]=e.byteLength;let i=t;return new Uint8Array(s,i,e.byteLength).set(e),i+=e.byteLength,new Uint8Array(s,i,this.checkpoint.byteLength).set(new Uint8Array(this.checkpoint)),i+=this.checkpoint.byteLength,this.codec&&(new Uint8Array(s,i,o).set(new Uint8Array(this.codec)),i+=o),this.tokenizer&&new Uint8Array(s,i,r).set(new Uint8Array(this.tokenizer)),s}withCheckpoint(e,t=this.manifest.version){const o={...this.manifest,version:t,...this.manifest.checkpointBytes!==void 0?{checkpointBytes:e.byteLength}:{},checksum:ae(new Uint8Array(e))};return new J(o,e,this.codec,this.tokenizer)}withMlHeads(e){const t={...this.manifest};return delete t.mlHeads,e.length&&(t.mlHeads=[...e]),new J(t,this.checkpoint,this.codec,this.tokenizer)}static manifestEnd(e){if(e.byteLength<Me)throw new Error("EvermindModelPackage: truncated (no header)");const t=new Uint32Array(e,0,3);if(t[0]!==hr)throw new Error("EvermindModelPackage: bad magic (not an .evermind package)");return Me+t[2]}static readManifest(e){const t=J.manifestEnd(e);if(t>e.byteLength)throw new Error("EvermindModelPackage: truncated (manifest length exceeds blob)");const o=new Uint8Array(e,Me,t-Me);return JSON.parse(new TextDecoder().decode(o))}static fromBlob(e){const t=J.readManifest(e),o=J.manifestEnd(e),r=t.checkpointBytes;if(r==null)return new J(t,e.slice(o));if(o+r>e.byteLength)throw new Error("EvermindModelPackage.fromBlob: truncated (checkpointBytes exceeds blob)");const s=e.slice(o,o+r);let a=o+r;const i=t.tokenizerBytes??0;if(a+i>e.byteLength)throw new Error("EvermindModelPackage.fromBlob: truncated (tokenizerBytes exceeds blob)");const c=e.byteLength-i;let l;if(a<c){const d=t.codecBytes!=null?a+t.codecBytes:c;if(d>c)throw new Error("EvermindModelPackage.fromBlob: truncated (codecBytes overruns the tokenizer section)");l=e.slice(a,d),a=d}const u=i>0?e.slice(c):void 0;return new J(t,s,l,u)}validate(){const e=[];this.manifest.schema!=="evermind.model/1"&&e.push(`unknown schema: ${this.manifest.schema}`);const t=this.manifest.config;this.manifest.modelType==="shared-expert-moe"?(!t||t.modelDim<=0||t.hiddenDim<=0||t.numExperts<=0||t.topK<1||t.topK>t.numExperts)&&e.push("invalid config"):this.manifest.modelType==="evermind-lm"?(!t||t.vocabSize<=0||t.dModel<=0||t.numLayers<=0||t.numExperts<=0||t.topK<1||t.topK>t.numExperts)&&e.push("invalid config"):e.push(`unsupported modelType: ${String(this.manifest.modelType)}`);const o=ae(new Uint8Array(this.checkpoint));o!==this.manifest.checksum&&e.push(`checksum mismatch (manifest ${this.manifest.checksum}, actual ${o}) — corrupt or tampered checkpoint`);const r=this.manifest.modality??"text";if(r==="video"||r==="image")if(!this.codec)e.push(`modality '${r}' package is missing its codec section`);else{const s=ae(new Uint8Array(this.codec));s!==this.manifest.codecChecksum&&e.push(`codec checksum mismatch (manifest ${this.manifest.codecChecksum}, actual ${s}) — corrupt codec`)}if(this.manifest.tokenizerFormat)if(!this.tokenizer)e.push("manifest declares an embedded tokenizer but the package has no tokenizer section");else{const s=ae(new Uint8Array(this.tokenizer));s!==this.manifest.tokenizerChecksum&&e.push(`tokenizer checksum mismatch (manifest ${this.manifest.tokenizerChecksum}, actual ${s}) - corrupt tokenizer`);const a=this.manifest.config?.vocabSize,i=this.manifest.tokenizerVocabSize;a!=null&&i!=null&&a!==i&&e.push(`tokenizer vocabSize (${i}) does not match the model's (${a})`)}for(const s of this.manifest.mlHeads??[]){const a=Go(s);a&&e.push(`ml head '${String(s?.task)}': ${a}`)}return new Set((this.manifest.mlHeads??[]).map(s=>s.task)).size!==(this.manifest.mlHeads??[]).length&&e.push("ml heads: a task appears more than once"),{ok:e.length===0,errors:e}}loadTokenizer(){if(!this.manifest.tokenizerFormat||!this.tokenizer)return null;const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadTokenizer: ${e.errors.join("; ")}`);return je.deserialize(this.tokenizer)}loadModel(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadModel: ${e.errors.join("; ")}`);if(this.manifest.modelType!=="shared-expert-moe")throw new Error(`loadModel: package is '${this.manifest.modelType}', use loadLM()`);const t=new Gr(this.manifest.config);return t.loadWeights(this.checkpoint),t}loadLM(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadLM: ${e.errors.join("; ")}`);if(this.manifest.modelType!=="evermind-lm")throw new Error(`loadLM: package is '${this.manifest.modelType}', use loadModel()`);const t=new rt(this.manifest.config);return t.loadWeights(this.checkpoint),t}loadMediaLM(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadMediaLM: ${e.errors.join("; ")}`);const t=this.manifest.modality??"text";if(t!=="video"&&t!=="image")throw new Error(`loadMediaLM: package modality is '${t}', use loadLM()`);return{lm:this.loadLM(),codec:nt.deserialize(this.codec),modality:t}}}const qo=Math.LN2;function Vo(n,e){const t=n.length,o=Math.max(1,Math.min(e,t)),r=[],s=new Uint8Array(t);for(let a=0;a<o;a++){let i=-1,c=-1/0;for(let l=0;l<t;l++){if(s[l])continue;const u=n[l];u>c&&(c=u,i=l)}if(i<0)break;s[i]=1,r.push(i)}return r}function Xo(n){let e=0,t=-1/0;for(let o=0;o<n.length;o++)n[o]>t&&(t=n[o],e=o);return e}function Yo(n){return Math.exp(n)}function Qo(n){return n/qo}function rn(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function nn(n,e,t,o){const r=Math.min(e.length,t.length);for(let s=0;s<r;s++){const a=t[s],i=e[s];a<0||a>=i.length||(n.ceSum+=ke(i,a),Xo(i)===a&&n.top1Hits++,Vo(i,o).includes(a)&&n.topKHits++,n.tokens++)}}function $t(){const n=globalThis;return typeof n.performance?.now=="function"?n.performance.now():Date.now()}function on(n){return n.slice(1)}function sn(n,e,t,o){const r=n.tokens>0?n.ceSum/n.tokens:0,s={sequences:e,tokens:n.tokens,crossEntropy:r,perplexity:Yo(r),bitsPerToken:Qo(r),top1Accuracy:n.tokens>0?n.top1Hits/n.tokens:0,topKAccuracy:n.tokens>0?n.topKHits/n.tokens:0,topK:t};return o!==void 0&&(s.elapsedMs=o,s.tokensPerSecond=o>0?n.tokens/o*1e3:0),s}function Ve(n,e,t={}){const o=t.topK??5,r=t.measureLatency??!0,s=t.now??$t,a=rn();let i=0,c=0;for(const l of e){if(l.length<2)continue;const u=r?s():0,{logits:d}=n.forward(l);r&&(c+=s()-u),nn(a,d,on(l),o),i++}return sn(a,i,o,r?c:void 0)}async function bc(n,e,t={}){const o=t.topK??5,r=t.measureLatency??!0,s=t.now??$t,a=rn();let i=0,c=0;for(const l of e){if(l.length<2)continue;const u=r?s():0,{logits:d}=await n.forward(l);r&&(c+=s()-u),nn(a,d,on(l),o),i++}return sn(a,i,o,r?c:void 0)}function wc(n,e,t,o={}){return Jo(Ve(n,t,o),Ve(e,t,o))}function Jo(n,e){const t=n.perplexity-e.perplexity,o=e.perplexity>0?n.perplexity/e.perplexity:1/0,r=n.top1Accuracy-e.top1Accuracy,s=.005;let a;Math.abs(o-1)<=s?a="tie":a=t<0?"candidate":"baseline";const i=((1-o)*100).toFixed(1),c=a==="tie"?`Tie: perplexity ${n.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)}`:a==="candidate"?`Candidate wins: ${i}% lower perplexity (${n.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(i)).toFixed(1)}% higher perplexity (${n.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`;return{candidate:n,baseline:e,perplexityDelta:t,perplexityRatio:o,top1Delta:r,winner:a,summary:c}}function an(n,e){return n.split(/(?<=\.)\s+/).map(t=>e.encode(t.trim())).filter(t=>t.length>=2)}function yc(n,e,t,o={}){return Ve(n,an(t,e),o)}function Zo(n,e){for(let t=n.length-1;t>0;t--){const o=Math.floor(e.next()*(t+1)),r=n[t];n[t]=n[o],n[o]=r}return n}function vc(n,e={}){const t=e.seed??7,o=new je;o.train(n,{numMerges:e.numMerges??100});const r=an(n,o);if(r.length<2)throw new Error(`corpus produced ${r.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const s=Zo([...r],new te(t>>>0||1)),a=Math.min(.9,Math.max(.05,e.heldOutRatio??.25));let i=Math.round(s.length*a);i=Math.max(1,Math.min(s.length-1,i));const c=s.slice(0,i),l=s.slice(i),u=new rt({vocabSize:o.vocabSize,dModel:e.dModel??32,numLayers:e.numLayers??2,hiddenDim:e.hiddenDim??48,seed:t}),d=e.epochs??30,h=new Pt(u,{lr:e.lr??.03,epochs:d}).fit(l),m=Ve(u,c,{topK:e.topK??5,measureLatency:!0}),f=u.generateText(e.prompt??"The",o,{maxNewTokens:8,temperature:0});return{...m,trainSequences:l.length,evalSequences:c.length,initialTrainLoss:h[0]??0,finalTrainLoss:h.at(-1)??0,vocabSize:o.vocabSize,sample:f}}function cn(n,e){const t=[],o=Math.max(1,Math.floor(e));for(let r=0;r+1<n.length;r+=o){const s=n.slice(r,r+o);s.length>=2&&t.push(s)}return t}function es(n,e){const t=Math.min(1,Math.max(0,e));return Math.round(n*(1-t))}const ts=["The planning loop retrieves context before generating a response.","Agents recall facts from the memory layer and act on them.","Deployment runs on Cloudflare Workers and Durable Objects.","Tools are gated by a capability registry and a policy pack.","The coordinator merges weight deltas from every contributing host.","A ticket moves through triage, execution, review and merge.","Recall is ranked by embedding cosine fused with lexical scoring.","The trainer adapts a private copy of the base checkpoint locally."].join(" ");function rs(n){let e=0;for(const t of n.parameters())e+=t.data.length;return e}function xc(n={}){const e=n.text??ts,t=n.windowTokens??[32,64,128],o=n.epochs??[1,2,4],r=n.skipRates??[0,.5],s=Math.max(1,n.requests??4),a=n.dModel??32,i=n.numLayers??2,c=n.hiddenDim??48,l=n.seed??7,u=n.lr??.01,d=n.now??$t,h=new je;h.train(e,{numMerges:n.numMerges??120});const m=h.encode(e),f=()=>new rt({vocabSize:h.vocabSize,dModel:a,numLayers:i,hiddenDim:c,seed:l}),g=[];for(const p of t){const _=cn(m,p);for(const w of o)for(const b of r){const y=es(s,b),x=f();x.resetStats();const L=d();for(let C=0;C<y;C++)new Pt(x,{lr:u,epochs:w,accumSteps:1}).fit(_);const P=d()-L,M=x.positionsEvaluated,F=_.length*y;g.push({windowTokens:p,epochs:w,skipRate:b,requests:s,adapted:y,sequences:F,optimizerSteps:F*w,positionsEvaluated:M,elapsedMs:P,msPerKPosition:M>0?P/M*1e3:0,msPerAdaptation:y>0?P/y:0})}}return{points:g,textTokens:m.length,vocabSize:h.vocabSize,dModel:a,numLayers:i,hiddenDim:c,paramCount:rs(f())}}function kc(n){const e=`Evermind adaptation cost — dModel=${n.dModel} layers=${n.numLayers} hidden=${n.hiddenDim} params=${n.paramCount.toLocaleString()} vocab=${n.vocabSize} textTokens=${n.textTokens}`,t=["window","epochs","skip","adapts","seqs","steps","positions","ms","ms/adapt","ms/1k pos"],o=n.points.map(a=>[String(a.windowTokens),String(a.epochs),a.skipRate.toFixed(2),`${a.adapted}/${a.requests}`,String(a.sequences),String(a.optimizerSteps),String(a.positionsEvaluated),a.elapsedMs.toFixed(1),a.msPerAdaptation.toFixed(1),a.msPerKPosition.toFixed(3)]),r=t.map((a,i)=>Math.max(a.length,...o.map(c=>c[i].length))),s=a=>a.map((i,c)=>i.padStart(r[c])).join("  ");return[e,"",s(t),s(r.map(a=>"-".repeat(a))),...o.map(s)].join(`
`)}const ns=4e3,os=64;function ss(n,e,t,o={}){const r=o.maxChars??ns,s=o.windowTokens??os,a=cn(e.encode(t.slice(0,r)),s);if(a.length===0)return null;const i=o.lm??n.loadLM(),c=new Pt(i,{epochs:o.epochs??1}).fit(a),l=c.length>0?c[c.length-1]:0;return{diff:Qr(n.checkpoint,i.exportWeights()),loss:l,sequences:a.length}}function Ac(n,e,t,o,r={}){const s=ss(n,e,t,r);return s?{pkg:n.withCheckpoint(Jr(n.checkpoint,s.diff),o),loss:s.loss,sequences:s.sequences}:null}const fr=8*1024*1024,ln=800,dn=new RegExp(`^ml:${Zr.source.slice(1)}`);function un(n){return`ml:${n}`}function hn(n,e){return n===e?null:`target ${n??"(model)"} does not belong here; this door merges into ${e??"the model checkpoint"}`}const as=/^[A-Za-z0-9+/]+={0,2}$/;function Mc(n,e={}){const t=n&&typeof n=="object"?n:{},o=typeof t.diff=="string"?t.diff:"",r=typeof t.baseVersion=="number"?t.baseVersion:Number.NaN;if(!o||!Number.isInteger(r))return{ok:!1,reason:"invalid",error:"diff (base64) and baseVersion (integer head version the delta was taken against) are required"};if(o.length>fr)return{ok:!1,reason:"too-large",error:`delta too large (max ${fr} base64 characters)`};if(o.length%4!==0||!as.test(o))return{ok:!1,reason:"invalid",error:"diff must be standard base64"};const s=typeof t.weight=="number"&&Number.isFinite(t.weight)&&t.weight>0?t.weight:void 0,a=typeof t.label=="string"&&t.label.trim()?t.label.trim().slice(0,ln):void 0;if(t.target!==void 0&&(typeof t.target!="string"||!dn.test(t.target)))return{ok:!1,reason:"invalid",error:"target, when present, must be ml:<task id>"};const i=t.target,c=hn(i,e.target);return c?{ok:!1,reason:"invalid",error:c}:{ok:!0,payload:{diff:o,baseVersion:r,...s!==void 0?{weight:s}:{},...a?{label:a}:{},...i?{target:i}:{}}}}function is(n,e,t,o,r){const s=(o??"").trim();if(r!==void 0&&!dn.test(r))throw new Error(`buildDeltaLearnPayload: bad target '${r}'`);return{diff:Nt(n),baseVersion:e,...typeof t=="number"&&Number.isFinite(t)&&t>0?{weight:t}:{},...s?{label:s.slice(0,ln)}:{},...r?{target:r}:{}}}function cs(n){return We(n.diff)}function ls(n,e){try{const t=tt(n);if(t.rowSize!==1)return`expected an element-granular delta (rowSize 1), got ${t.rowSize}`;const o=oe(e).body.byteLength/4;for(let r=0;r<t.rows.length;r++){const s=t.rows[r];if(!Number.isInteger(s)||s<0||s>=o)return`row index ${s} is outside the base checkpoint (${o} elements)`;if(!Number.isFinite(t.data[r]))return`non-finite value at row ${s}`}return null}catch(t){return`not a serialized RowDelta: ${t instanceof Error?t.message:String(t)}`}}function ds(n,e,t){if(e.length===0)return{checkpoint:n,mergedRows:0,contributors:0,deltaNorm:0};if(t&&t.length!==e.length)throw new Error(`mergeCheckpointDiffs: weights length ${t.length} != diffs length ${e.length}`);const o=e.map(d=>tt(d));for(const d of o)if(d.rowSize!==1)throw new Error(`mergeCheckpointDiffs: expected element-granular deltas (rowSize 1), got ${d.rowSize}`);const r=new Map;if(o.forEach((d,h)=>{const m=t?t[h]:1;m>0&&d.rows.forEach((f,g)=>{const p=d.data[g],_=r.get(f);_?(_.sum+=m*p,_.weight+=m):r.set(f,{sum:m*p,weight:m})})}),r.size===0)return{checkpoint:n,mergedRows:0,contributors:o.length,deltaNorm:0};const s=[...r.keys()].sort((d,h)=>d-h),a=new Float32Array(s.length);s.forEach((d,h)=>{const m=r.get(d);a[h]=m.sum/m.weight});const i=new Float32Array(oe(n).body);let c=0;return s.forEach((d,h)=>{const m=a[h]-(i[d]??0);c+=m*m}),{checkpoint:Jr(n,Tt({rowSize:1,rows:s,data:a})),mergedRows:s.length,contributors:o.length,deltaNorm:Math.sqrt(c)}}function us(n,e,t,o,r={}){const s=ds(n,e,t),a=(u,d,h)=>({...s,checkpoint:n,deltaNorm:0,accepted:!1,baseLoss:d,newLoss:h,refusedReason:u});if(s.mergedRows===0)return a("nothing-merged",null,null);const i=u=>u!=null&&Number.isFinite(u)?u:null,c=i(o(n)),l=i(o(s.checkpoint));return c==null||l==null?r.requireEval?a("unscored",c,l):{...s,accepted:!0,baseLoss:c,newLoss:l}:l>c+(r.tolerance??0)?a("regressed",c,l):{...s,accepted:!0,baseLoss:c,newLoss:l}}const hs=128;function fs(n,e){if(e.length<2)return null;const{logits:t}=n.forward(e),o=Math.min(t.length,e.length)-1;if(o<1)return null;let r=0;for(let a=0;a<o;a++)r+=ke(t[a],e[a+1]);const s=r/o;return Number.isFinite(s)&&s>=0?s:null}function Lc(n,e,t,o=hs){let r=0,s=0;for(const a of t){const i=(a.prompt?`${a.prompt}
`:"")+a.text,c=fs(n,e.encode(i).slice(0,o));c!=null&&(r+=c,s++)}return s>0?r/s:null}class Ec{model;codec;dimensions;fingerprint;constructor(e,t,o){this.model=e,this.codec=t,this.dimensions=e.config.dModel,this.fingerprint=o??ms(e)}async embed(e){return this.embedSync(e)}embedSync(e){return this.model.embedText(e,this.codec)}}function ms(n){const e=n.config,t=new Uint8Array(n.emb.buffer,n.emb.byteOffset,n.emb.byteLength);return`evermind-lm/${[e.vocabSize,e.dModel,e.numLayers,e.convKernel,e.hiddenDim,e.numExperts,e.topK].join("-")}/${Dt(t).toString(16)}`}const mr=1280266817;class Be{rows;cols;rank;alpha;scale;B;A;gB;gA;constructor(e,t,o={}){if(e<=0||t<=0)throw new Error("LoRAAdapter: rows and cols must be > 0");const r=o.rank??8;if(r<=0||r>Math.min(e,t))throw new Error(`LoRAAdapter: rank must be in [1, min(rows,cols)=${Math.min(e,t)}]`);this.rows=e,this.cols=t,this.rank=r,this.alpha=o.alpha??r,this.scale=this.alpha/r,this.B=new Float32Array(e*r),this.A=new Float32Array(r*t);const s=new te((o.seed??1282363969)>>>0||1),a=1/Math.sqrt(t);for(let i=0;i<this.A.length;i++){const c=Math.max(s.next(),1e-12),l=s.next();this.A[i]=a*Math.sqrt(-2*Math.log(c))*Math.cos(2*Math.PI*l)}this.gB=new Float32Array(this.B.length),this.gA=new Float32Array(this.A.length)}numParams(){return this.B.length+this.A.length}delta(){const{rows:e,cols:t,rank:o,scale:r}=this,s=new Float32Array(e*t);for(let a=0;a<e;a++){const i=a*o,c=a*t;for(let l=0;l<o;l++){const u=this.B[i+l]*r;if(u===0)continue;const d=l*t;for(let h=0;h<t;h++)s[c+h]=s[c+h]+u*this.A[d+h]}}return s}applyTo(e){if(e.length!==this.rows*this.cols)throw new Error("LoRAAdapter.applyTo: base length mismatch");const t=this.delta(),o=new Float32Array(e.length);for(let r=0;r<o.length;r++)o[r]=e[r]+t[r];return o}accumulateGradient(e){const{rows:t,cols:o,rank:r,scale:s}=this;if(e.length!==t*o)throw new Error("LoRAAdapter.accumulateGradient: gW length mismatch");for(let a=0;a<t;a++){const i=a*o,c=a*r;for(let l=0;l<r;l++){const u=l*o;let d=0;const h=this.B[c+l]*s;for(let m=0;m<o;m++){const f=e[i+m];d+=f*this.A[u+m],this.gA[u+m]=this.gA[u+m]+h*f}this.gB[c+l]=this.gB[c+l]+s*d}}}parameters(){return[{data:this.B},{data:this.A}]}gradients(){return[{data:this.gB},{data:this.gA}]}zeroGrad(){this.gB.fill(0),this.gA.fill(0)}serialize(){const o=new ArrayBuffer(20+(this.B.length+this.A.length)*4),r=new Uint32Array(o,0,5);r[0]=mr,r[1]=this.rows,r[2]=this.cols,r[3]=this.rank,new Float32Array(o,16,1)[0]=this.alpha;const s=new Float32Array(o,20);return s.set(this.B,0),s.set(this.A,this.B.length),o}static deserialize(e){const t=new Uint32Array(e,0,5);if(t[0]!==mr)throw new Error("LoRAAdapter.deserialize: bad magic");const o=t[1],r=t[2],s=t[3],a=new Float32Array(e,16,1)[0],i=new Be(o,r,{rank:s,alpha:a}),c=new Float32Array(e,20);return i.B.set(c.subarray(0,i.B.length)),i.A.set(c.subarray(i.B.length,i.B.length+i.A.length)),i}}function gs(n,e){switch(e){case"none":return{view:n,bytes:n.length*4};case"fp16":{const t=Pe(n);return{view:Ne(t),bytes:t.length*2}}case"int8":{const t=wo(n);return{view:yo(t.data,t.scale),bytes:t.data.length+4}}}}class fn{model;adapter;baseQuant;frozenBase;baseBytesStored;rows;cols;constructor(e,t={}){this.model=e,this.rows=e.config.vocabSize,this.cols=e.config.dModel,this.baseQuant=t.baseQuant??"none";const{view:o,bytes:r}=gs(Float32Array.from(e.emb),this.baseQuant);this.frozenBase=o,this.baseBytesStored=r,this.adapter=new Be(this.rows,this.cols,t)}get baseModel(){return this.model}mergedEmb(){return this.adapter.applyTo(this.frozenBase)}_accumulate(e){const t=this.mergedEmb(),o=this.model.emb;this.model.emb=t,this.model.zeroGrad();const r=this.model.lossAndBackward(e),s=this.model.gradients()[0].data;return this.adapter.accumulateGradient(s),this.model.emb=o,r}fit(e,t={}){const o=t.epochs??1,r=Math.max(1,t.accumSteps??1),s=new Bt(this.adapter,t),a=this.adapter.gradients(),i=[];for(let c=0;c<o;c++){let l=0,u=0,d=0;this.adapter.zeroGrad();const h=()=>{if(d!==0){if(d!==1)for(const m of a)for(let f=0;f<m.data.length;f++)m.data[f]=m.data[f]/d;s.step(),this.adapter.zeroGrad(),d=0}};for(const m of e)m.length<2||(l+=this._accumulate(m),u++,++d>=r&&h());h(),i.push(u>0?l/u:0)}return i}generate(e,t){const o=this.model.emb;this.model.emb=this.mergedEmb();try{return this.model.generate(e,t)}finally{this.model.emb=o}}generateText(e,t,o){return t.decode(this.generate(t.encode(e),o))}serializeAdapter(){return this.adapter.serialize()}static loadAdapter(e,t,o="none"){const r=Be.deserialize(t),s=new fn(e,{rank:r.rank,alpha:r.alpha,baseQuant:o});return s.adapter.B.set(r.B),s.adapter.A.set(r.A),s}merge(e={}){return this.model.emb.set(this.mergedEmb()),this.model.exportWeights(e)}footprint(){return{adapterBytes:this.adapter.serialize().byteLength,baseBytes:this.baseBytesStored,trainableParams:this.adapter.numParams(),baseParams:this.rows*this.cols}}}const It=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],mn=-10,gn=5;function ps(n){const{dModel:e,dState:t,dConv:o,dInner:r,dtRank:s}=n;return{wInProj:new Float32Array(2*r*e),bInProj:new Float32Array(2*r),wConv:new Float32Array(r*o),bConv:new Float32Array(r),wXProj:new Float32Array((s+2*t)*r),bXProj:new Float32Array(s+2*t),wDtProj:new Float32Array(r*s),bDtProj:new Float32Array(r),A_log:new Float32Array(r*t),D_vec:new Float32Array(r),wOutProj:new Float32Array(e*r),bOutProj:new Float32Array(e),normWeight:new Float32Array(e)}}function pn(n,e,t){const{dModel:o,dState:r,dConv:s,dInner:a,dtRank:i,batch:c,seqLen:l}=t,u=c*l,d=i+2*r,h=new Float32Array(u*o),m=new Float32Array(u);Ur(n,e.normWeight,u,o,h,m);const f=new Float32Array(u*2*a);Ee(h,e.wInProj,e.bInProj,u,o,2*a,f);const g=new Float32Array(u*a),p=new Float32Array(u*a);for(let v=0;v<u;v++)for(let k=0;k<a;k++)g[v*a+k]=f[v*2*a+k],p[v*a+k]=f[v*2*a+a+k];const _=new Float32Array(u*a);for(let v=0;v<c;v++)for(let k=0;k<l;k++){const E=(v*l+k)*a;for(let j=0;j<a;j++){let q=e.bConv[j];for(let N=0;N<s;N++)k>=N&&(q+=e.wConv[j*s+N]*g[(v*l+k-N)*a+j]);_[E+j]=q}}const w=new Float32Array(u*a);for(let v=0;v<u*a;v++)w[v]=Jt(_[v]);const b=new Float32Array(u*d);Ee(w,e.wXProj,e.bXProj,u,a,d,b);const y=new Float32Array(u*i),x=new Float32Array(u*r),L=new Float32Array(u*r);for(let v=0;v<u;v++){for(let k=0;k<i;k++)y[v*i+k]=b[v*d+k];for(let k=0;k<r;k++)x[v*r+k]=b[v*d+i+k],L[v*r+k]=b[v*d+i+r+k]}const P=new Float32Array(u*a);Ee(y,e.wDtProj,e.bDtProj,u,i,a,P);const M=new Float32Array(u*a);for(let v=0;v<u*a;v++)M[v]=Eo(P[v]);const F=new Float32Array(a*r);for(let v=0;v<a*r;v++)F[v]=-Math.exp(Math.min(gn,Math.max(mn,e.A_log[v])));const C=new Float32Array(u*a*r),O=new Float32Array(u*a*r),U=new Float32Array(u*a*r),G=new Float32Array(u*a);for(let v=0;v<c;v++)for(let k=0;k<l;k++){const E=v*l+k;for(let j=0;j<a;j++){const q=M[E*a+j],N=w[E*a+j];let T=e.D_vec[j]*N;for(let D=0;D<r;D++){const K=F[j*r+D],Z=Math.exp(q*K),V=(Z-1)/K*x[E*r+D],X=(E*a+j)*r+D;C[X]=Z,O[X]=V;const se=k===0?0:U[((E-1)*a+j)*r+D],ge=Z*se+V*N;U[X]=ge,T+=L[E*r+D]*ge}G[E*a+j]=T}}const W=new Float32Array(u*a),H=new Float32Array(u*a);for(let v=0;v<u*a;v++)W[v]=Jt(p[v]),H[v]=G[v]*W[v];const A=new Float32Array(u*o);Ee(H,e.wOutProj,e.bOutProj,u,a,o,A);for(let v=0;v<u*o;v++)A[v]=A[v]+n[v];return{output:A,cache:{x:n,normInv:m,normOut:h,xConvIn:g,z:p,convOut:_,u:w,dtRaw:y,bRaw:x,cRaw:L,deltaFull:P,dv:M,aCont:F,aBar:C,bBar:O,h:U,scanY:G,siluZ:W,gated:H}}}function _s(n,e,t,o,r){const{dModel:s,dState:a,dConv:i,dInner:c,dtRank:l,batch:u,seqLen:d}=o,h=u*d,m=l+2*a,f=new Float32Array(h*s);f.set(n);const g=new Float32Array(h*c);Ue(n,t.gated,e.wOutProj,h,c,s,g,r.wOutProj,r.bOutProj);const p=new Float32Array(h*c),_=new Float32Array(h*c);for(let A=0;A<h*c;A++)p[A]=g[A]*t.siluZ[A],_[A]=g[A]*t.scanY[A]*Zt(t.z[A]);const w=new Float32Array(h*c),b=new Float32Array(h*a),y=new Float32Array(h*a),x=new Float32Array(h*c),L=new Float32Array(c*a),P=new Float32Array(c*a);for(let A=0;A<u;A++){P.fill(0);for(let v=d-1;v>=0;v--){const k=A*d+v;for(let E=0;E<c;E++){const j=p[k*c+E],q=t.u[k*c+E],N=t.dv[k*c+E];r.D_vec[E]=r.D_vec[E]+j*q,w[k*c+E]=w[k*c+E]+j*e.D_vec[E];let T=0;for(let D=0;D<a;D++){const K=(k*c+E)*a+D,Z=t.h[K],V=t.aBar[K],X=t.bBar[K],se=t.aCont[E*a+D],ge=t.cRaw[k*a+D];y[k*a+D]=y[k*a+D]+j*Z;const Oe=j*ge+P[E*a+D],Zn=v===0?0:t.h[((k-1)*c+E)*a+D],Gt=Oe*Zn,at=Oe*q;w[k*c+E]=w[k*c+E]+Oe*X,P[E*a+D]=Oe*V;const Kt=t.bRaw[k*a+D];T+=Gt*se*V+at*V*Kt,L[E*a+D]=L[E*a+D]+Gt*N*V+at*Kt*((N*V*se-(V-1))/(se*se)),b[k*a+D]=b[k*a+D]+at*((V-1)/se)}x[k*c+E]=x[k*c+E]+T}}}for(let A=0;A<c*a;A++){const v=e.A_log[A];v<=mn||v>=gn||(r.A_log[A]=r.A_log[A]+L[A]*t.aCont[A])}const M=new Float32Array(h*c);for(let A=0;A<h*c;A++)M[A]=x[A]*ze(t.deltaFull[A]);const F=new Float32Array(h*l);Ue(M,t.dtRaw,e.wDtProj,h,l,c,F,r.wDtProj,r.bDtProj);const C=new Float32Array(h*m);for(let A=0;A<h;A++){for(let v=0;v<l;v++)C[A*m+v]=F[A*l+v];for(let v=0;v<a;v++)C[A*m+l+v]=b[A*a+v],C[A*m+l+a+v]=y[A*a+v]}const O=new Float32Array(h*c);Ue(C,t.u,e.wXProj,h,c,m,O,r.wXProj,r.bXProj);for(let A=0;A<h*c;A++)w[A]=w[A]+O[A];const U=new Float32Array(h*c);for(let A=0;A<h*c;A++)U[A]=w[A]*Zt(t.convOut[A]);const G=new Float32Array(h*c);for(let A=0;A<u;A++)for(let v=0;v<d;v++){const k=A*d+v;for(let E=0;E<c;E++){const j=U[k*c+E];if(j!==0){r.bConv[E]=r.bConv[E]+j;for(let q=0;q<i;q++){if(v<q)continue;const N=(A*d+v-q)*c+E;r.wConv[E*i+q]=r.wConv[E*i+q]+j*t.xConvIn[N],G[N]=G[N]+j*e.wConv[E*i+q]}}}}const W=new Float32Array(h*2*c);for(let A=0;A<h;A++)for(let v=0;v<c;v++)W[A*2*c+v]=G[A*c+v],W[A*2*c+c+v]=_[A*c+v];const H=new Float32Array(h*s);return Ue(W,t.normOut,e.wInProj,h,s,2*c,H,r.wInProj,r.bInProj),Hr(H,t.x,e.normWeight,t.normInv,h,s,f,r.normWeight,Ie),f}const gr=["mamba1"];function bs(n){const e={dModel:n.dModel,dState:n.dState,dConv:n.dConv,dInner:n.dInner,dtRank:n.dtRank};return{embedding:new Float32Array(n.vocabSize*n.dModel),finalNorm:new Float32Array(n.dModel),lmHeadBias:new Float32Array(n.vocabSize),layers:Array.from({length:n.numLayers},()=>ps(e))}}function ws(n){const e=new Map;e.set("embedding",n.embedding);for(let t=0;t<n.layers.length;t++){const o=n.layers[t];for(const r of It)e.set(`layer${t}.${r}`,o[r])}return e.set("final_norm",n.finalNorm),e.set("lm_head_bias",n.lmHeadBias),e}function ys(n){const e=new Map;e.set("embedding",n.embedding);for(let t=0;t<n.layers.length;t++){const o=n.layers[t];for(const r of It)e.set(`layer${t}.${r}`,o[r])}return e.set("final_norm",n.finalNorm),e.set("lm_head_bias",n.lmHeadBias),e}function vs(n,e){const t=(u,d)=>{const h=n.get(u);if(!h)throw new Error(`cpuWeightsFromNamed: missing tensor "${u}"`);if(h.length!==d)throw new Error(`cpuWeightsFromNamed: "${u}" has ${h.length} elements, expected ${d}`);return h},{dModel:o,dState:r,dConv:s,dInner:a,dtRank:i}=e,c={wInProj:2*a*o,bInProj:2*a,wConv:a*s,bConv:a,wXProj:(i+2*r)*a,bXProj:i+2*r,wDtProj:a*i,bDtProj:a,A_log:a*r,D_vec:a,wOutProj:o*a,bOutProj:o,normWeight:o},l=[];for(let u=0;u<e.numLayers;u++){const d={};for(const h of It)d[h]=t(`layer${u}.${h}`,c[h]);l.push(d)}return{embedding:t("embedding",e.vocabSize*o),finalNorm:t("final_norm",o),lmHeadBias:t("lm_head_bias",e.vocabSize),layers:l}}function _n(n,e,t,o,r,s=!1){const{vocabSize:a,dModel:i}=t,c=o*r;let l=new Float32Array(c*i);for(let p=0;p<c;p++){const _=n[p];if(_<0||_>=a)throw new Error(`token id ${_} out of range [0, ${a})`);l.set(e.embedding.subarray(_*i,(_+1)*i),p*i)}const u={dModel:i,dState:t.dState,dConv:t.dConv,dInner:t.dInner,dtRank:t.dtRank,batch:o,seqLen:r},d=[],h=[];for(let p=0;p<t.numLayers;p++){d.push(l);const{output:_,cache:w}=pn(l,e.layers[p],u);s||h.push(w),l=_}const m=new Float32Array(c*i),f=new Float32Array(c);Ur(l,e.finalNorm,c,i,m,f,Ie);const g=new Float32Array(c*a);return Ee(m,e.embedding,e.lmHeadBias,c,i,a,g),{hiddenIn:d,layer:h,lastHidden:l,normOut:m,normInv:f,logits:g}}function xs(n,e,t,o,r){return _n(n,e,t,o,r).logits}function Sc(n,e,t,o,r,s){const a=xs(n,t,o,r,s),i=r*s,c=o.vocabSize;let l=0;for(let u=0;u<i;u++)l+=ke(a.subarray(u*c,(u+1)*c),e[u]);return l/i}function ks(n,e,t,o,r,s,a={}){const{vocabSize:i,dModel:c}=o,l=r*s,u=a.activationCheckpointing??!1,d=_n(n,t,o,r,s,u),h=bs(o);let m=0;const f=new Float32Array(l*i);for(let y=0;y<l;y++){const x=d.logits.subarray(y*i,(y+1)*i),L=e[y];m+=ke(x,L);const P=Kr(x,L);for(let M=0;M<i;M++)f[y*i+M]=P[M]/l}const g=m/l,p=new Float32Array(l*c);for(let y=0;y<l;y++){const x=y*i,L=y*c;for(let P=0;P<i;P++){const M=f[x+P];if(M===0)continue;h.lmHeadBias[P]=h.lmHeadBias[P]+M;const F=P*c;for(let C=0;C<c;C++)p[L+C]=p[L+C]+M*t.embedding[F+C],h.embedding[F+C]=h.embedding[F+C]+M*d.normOut[L+C]}}const _=new Float32Array(l*c);Hr(p,d.lastHidden,t.finalNorm,d.normInv,l,c,_,h.finalNorm,Ie);const w={dModel:c,dState:o.dState,dConv:o.dConv,dInner:o.dInner,dtRank:o.dtRank,batch:r,seqLen:s};let b=_;for(let y=o.numLayers-1;y>=0;y--){const x=u?pn(d.hiddenIn[y],t.layers[y],w).cache:d.layer[y];b=_s(b,t.layers[y],x,w,h.layers[y])}for(let y=0;y<l;y++){const L=n[y]*c,P=y*c;for(let M=0;M<c;M++)h.embedding[L+M]=h.embedding[L+M]+b[P+M]}return{loss:g,grads:ws(h)}}function As(n,e){const{dModel:t,dState:o,dConv:r,dInner:s,dtRank:a}=e;if(n==="embedding")return[e.vocabSize,t];switch(n.startsWith("layer")?n.slice(n.indexOf(".")+1):n){case"wInProj":return[2*s,t];case"wConv":return[s,r];case"wXProj":return[a+2*o,s];case"wDtProj":return[s,a];case"A_log":return[s,o];case"wOutProj":return[t,s];default:return null}}const Ms=["wInProj","wXProj","wDtProj","wOutProj"],Ls=.05;class Fc{model;tokenizer;device;_moments;_step;_dims;_mirror;_mirrorByName;_adapters;_loraBase;_shard;constructor(e,t=null){this.model=e,this.tokenizer=t,this.device=e.device,this._moments=new Map,this._step=0,this._dims=Es(e),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const e=this.model.getTrainableParams();if(this._adapters.size===0)return e.reduce((o,r)=>o+r.numel,0);let t=0;for(const o of e){const r=this._adapters.get(o.name);r&&(t+=r.numParams())}return t}_owns(e){return this._shard===null||e%this._shard.count===this._shard.index}_installAdapters(e){if(this._adapters.size>0)return;const t=new Set(e.targets??Ms),o=this._mirrorByName;for(const r of this.model.getTrainableParams()){const s=r.name.includes(".")?r.name.slice(r.name.indexOf(".")+1):r.name;if(!t.has(s))continue;const a=As(r.name,this._dims);if(!a)continue;const[i,c]=a,l=Math.max(1,Math.min(e.rank??8,i,c));this._adapters.set(r.name,new Be(i,c,{...e,rank:l})),this._loraBase.set(r.name,Float32Array.from(o.get(r.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...t].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const e=this._mirrorByName;for(const[t,o]of this._adapters){const r=e.get(t),s=this._loraBase.get(t),a=o.delta();for(let i=0;i<r.length;i++)r[i]=s[i]+a[i]}}_momentFor(e){let t=this._moments.get(e.name);return t||(t={m:new Float32Array(e.numel),v:new Float32Array(e.numel)},this._moments.set(e.name,t)),t}async _syncMirrorFromGpu(){const e=new Map;for(const t of this.model.parameters())e.set(t.name,await de(this.device,t.buf,t.numel*4));e.set("lm_head_bias",await de(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=vs(e,this._dims),this._mirrorByName=ys(this._mirror)}async train(e,t={}){const{learningRate:o=1e-4,epochs:r=5,batchSize:s=1,seqLen:a=512,maxGradNorm:i=1,weightDecay:c=.01,beta1:l=.9,beta2:u=.999,eps:d=1e-8,wsla:h=!1,onEpochEnd:m=null}=t,f=Math.max(1,Math.floor(t.gradientAccumulation??1));if(this._shard=t.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const g=t.maxDelta??(h?Ls:0);h&&this.model.setWSLAMode(!0);let p;if(typeof e=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");p=this.tokenizer.encode(e)}else p=Array.from(e);if(p.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const _=Ss(p,a);if(_.length===0)throw new Error("Input is too short to form any training chunk.");const w=Fs(_,Math.max(1,Math.floor(s)));await this._syncMirrorFromGpu(),t.lora&&this._installAdapters(t.lora);const b=[];for(let y=0;y<r;y++){let x=0,L=0,P=0;for(let F=0;F<w.length;F+=f){const C=w.slice(F,F+f),{loss:O,gradNorm:U}=await this._trainStep(C,{learningRate:o,maxGradNorm:i,weightDecay:c,beta1:l,beta2:u,eps:d,wsla:h,maxDelta:g,...t.activationCheckpointing?{activationCheckpointing:!0}:{}});x+=O,L+=U,P++}const M=x/P;b.push(M),m&&m(y+1,M,L/P)}return h&&this.model.setWSLAMode(!1),b}async _trainStep(e,t){const{learningRate:o,maxGradNorm:r,weightDecay:s,beta1:a,beta2:i,eps:c,maxDelta:l}=t;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const u=this._mirror,d=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const h=t.activationCheckpointing?{activationCheckpointing:!0}:{};let m=0,f=new Map;for(const b of e){const y=ks(b.inputs,b.targets,u,this._dims,b.batch,b.seqLen,h);if(m+=y.loss/e.length,f.size===0){for(const x of y.grads.values())for(let L=0;L<x.length;L++)x[L]=x[L]/e.length;f=y.grads}else for(const[x,L]of y.grads){const P=f.get(x);for(let M=0;M<L.length;M++)P[M]=P[M]+L[M]/e.length}}const g=this.model.getTrainableParams();if(this._adapters.size>0)for(const[b,y]of this._adapters){const x=f.get(b);x&&(y.zeroGrad(),y.accumulateGradient(x))}let p=0;for(const b of g){const y=f.get(b.name);if(y)for(let x=0;x<y.length;x++)p+=y[x]*y[x]}const _=Math.sqrt(p),w=r>0&&_>r?r/_:1;return this._adamwStep(g,f,d,{learningRate:o,weightDecay:s,beta1:a,beta2:i,eps:c,beta1_t:Math.pow(a,this._step),beta2_t:Math.pow(i,this._step),maxDelta:l,gradScale:w}),{loss:m,gradNorm:_}}_adamwStep(e,t,o,r){const{learningRate:s,weightDecay:a,beta1:i,beta2:c,eps:l,beta1_t:u,beta2_t:d,maxDelta:h,gradScale:m}=r,f={lr:s,beta1:i,beta2:c,eps:l,weightDecay:a,beta1_t:u,beta2_t:d,maxDelta:h,gradScale:m};for(let g=0;g<e.length;g++){const p=e[g];if(!this._owns(g))continue;const _=this._adapters.get(p.name);if(_){const x=o.get(p.name),L=this._loraBase.get(p.name),[P,M]=[_.A,_.B],[F,C]=[_.gradients()[1].data,_.gradients()[0].data],O=this._momentNamed(`${p.name}::loraB`,M.length),U=this._momentNamed(`${p.name}::loraA`,P.length);Ke(M,C,O.m,O.v,f),Ke(P,F,U.m,U.v,f);const G=_.delta();for(let W=0;W<x.length;W++)x[W]=L[W]+G[W];we(this.device,p.buf,x);continue}const w=t.get(p.name),b=o.get(p.name);if(!w||!b)continue;if(w.length!==p.numel||b.length!==p.numel)throw new Error(`MambaTrainer: parameter "${p.name}" is ${p.numel} elements but the gradient engine produced ${w.length} — model and CPU mirror disagree.`);const y=this._momentFor(p);Ke(b,w,y.m,y.v,f),we(this.device,p.buf,b)}}_momentNamed(e,t){let o=this._moments.get(e);return o||(o={m:new Float32Array(t),v:new Float32Array(t)},this._moments.set(e,o)),o}optimizerStateBytes(){let e=0;for(const t of this._moments.values())e+=t.m.byteLength+t.v.byteLength;return e}async evaluate(e){let t;if(typeof e=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");t=Array.from(this.tokenizer.encode(e))}else t=Array.from(e);const o=t.length,r=this.model.config.vocabSize,{logits:s}=await this.model.forward(new Uint32Array(t.slice(0,-1)),1,o-1);let a=0;for(let c=0;c<o-1;c++){const l=c*r;a+=ke(s.slice(l,l+r),t[c+1])}const i=a/(o-1);return Math.exp(i)}}function Es(n){const e=n.layerSpecs.map((s,a)=>({i:a,type:s.type})).filter(({type:s})=>!gr.includes(s));if(e.length>0){const s=e.map(({i:a,type:i})=>`layer${a}=${i}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${gr.join("/")} layers only, but this model has ${s}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const t=n.layers[0],o=t?.dInner??n.config.expand*n.config.dModel,r=t?.dtRank??Math.ceil(n.config.dModel/16);return{vocabSize:n.config.vocabSize,dModel:n.config.dModel,dState:n.config.dState,dConv:n.config.dConv,dInner:o,dtRank:r,numLayers:n.layers.length}}function Ss(n,e){const t=[];for(let r=0;r+e<n.length;r+=e)t.push({inputs:n.slice(r,r+e),targets:n.slice(r+1,r+e+1)});const o=n.length%e;if(o>1){const r=n.length-o;t.push({inputs:n.slice(r,-1),targets:n.slice(r+1)})}return t}function Fs(n,e){const t=[];let o=0;for(;o<n.length;){const r=n[o].inputs.length,s=[];for(;o<n.length&&s.length<e&&n[o].inputs.length===r;)s.push(n[o]),o++;t.push({inputs:s.flatMap(a=>a.inputs),targets:s.flatMap(a=>a.targets),batch:s.length,seqLen:r})}return t}class Dc{video;constructor(e){this.video=new nt({...e,keyframeInterval:1})}get vocab(){return this.video.vocab}get vocabSize(){return this.video.vocabSize}get frameSize(){return this.video.height*this.video.width*this.video.channels}encode(e){return this.video.encode([e])}decode(e){return this.video.decode(e)[0]??new Float32Array(this.frameSize)}fit(e,t){return this.video.fit(e.map(o=>[o]),t)}}function Bc(n,e,t){return[...e,...n.encode(t)]}function Ds(n,e,t,o){if(n.config.vocabSize!==e.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${n.config.vocabSize}) must equal codec.vocabSize (${e.vocabSize})`);const r=n.generate(t,{...o,stopToken:o.stopToken??e.vocab.eosVideo});return{video:e.decode(r),tokens:r}}function Cc(n,e,t,o){const{video:r,tokens:s}=Ds(n,e.video,t,o);return{image:r[0]??new Float32Array(e.frameSize),tokens:s}}function Re(n){const e=n.config;return{vocabSize:e.vocabSize,dModel:e.dModel,numLayers:e.numLayers,convKernel:e.convKernel,hiddenDim:e.hiddenDim,numExperts:e.numExperts,topK:e.topK}}function bn(n){const{vocabSize:e,dModel:t,numLayers:o,convKernel:r,hiddenDim:s,numExperts:a}=n,i=[{name:"token_embedding.weight",shape:[e,t]}],c=l=>[{name:`${l}.w1`,shape:[s,t]},{name:`${l}.b1`,shape:[s]},{name:`${l}.w2`,shape:[t,s]},{name:`${l}.b2`,shape:[t]}];for(let l=0;l<o;l++){const u=`layers.${l}`;i.push({name:`${u}.conv.weight`,shape:[t,r]}),i.push({name:`${u}.norm_conv.weight`,shape:[t]}),i.push({name:`${u}.norm_moe.weight`,shape:[t]}),i.push({name:`${u}.moe.router.weight`,shape:[a,t]}),i.push(...c(`${u}.moe.shared`));for(let d=0;d<a;d++)i.push(...c(`${u}.moe.experts.${d}`))}return i}function zt(n){const e=bn(Re(n)),t=n.parameters();if(e.length!==t.length)throw new Error(`export/tensors: parameter-count drift (spec ${e.length} vs model ${t.length}) — EvermindLM.parameters() order changed; update evermindTensorSpec`);return e.map((o,r)=>{const s=o.shape.reduce((i,c)=>i*c,1),a=t[r].data;if(a.length!==s)throw new Error(`export/tensors: shape mismatch for ${o.name} (expected ${s}, got ${a.length})`);return{name:o.name,shape:o.shape,data:a}})}function wn(n){return n.parameters().reduce((e,t)=>e+t.data.length,0)}function Bs(n,e){if(!e){const r=new Uint8Array(n.length*4),s=new DataView(r.buffer);for(let a=0;a<n.length;a++)s.setFloat32(a*4,n[a],!0);return r}const t=new Uint8Array(n.length*2),o=new DataView(t.buffer);for(let r=0;r<n.length;r++)o.setUint16(r*2,et(n[r]),!0);return t}function Cs(n,e={}){const t=e.fp16??!1,o=t?"F16":"F32",r=t?2:4,s={};e.metadata&&(s.__metadata__=e.metadata);const a=[];let i=0;for(const f of n){const g=f.data.length*r;s[f.name]={dtype:o,shape:f.shape,data_offsets:[i,i+g]},a.push(Bs(f.data,t)),i+=g}let c=JSON.stringify(s);const u=(8-new TextEncoder().encode(c).length%8)%8;u>0&&(c+=" ".repeat(u));const d=new TextEncoder().encode(c),h=new Uint8Array(8+d.length+i);new DataView(h.buffer).setBigUint64(0,BigInt(d.length),!0),h.set(d,8);let m=8+d.length;for(const f of a)h.set(f,m),m+=f.length;return h}function pr(n,e={}){return Cs(zt(n),{...e,metadata:{format:"pt",producer:"builderforce-memory-engine",...e.metadata??{}}})}const Ts=0,Ps=5,Ns=2;class ee{parts=[];byte(e){this.parts.push(e&255)}rawVarint(e){if(e<0||!Number.isFinite(e))throw new Error(`ProtoWriter: bad varint ${e}`);let t=e;for(;t>=128;)this.byte(t%128|128),t=Math.floor(t/128);this.byte(t)}tag(e,t){this.rawVarint(e*8+t)}rawBytes(e){for(let t=0;t<e.length;t++)this.byte(e[t])}varint(e,t){this.tag(e,Ts),this.rawVarint(t)}float(e,t){this.tag(e,Ps);const o=new ArrayBuffer(4);new DataView(o).setFloat32(0,t,!0),this.rawBytes(new Uint8Array(o))}bytes(e,t){this.tag(e,Ns),this.rawVarint(t.length),this.rawBytes(t)}string(e,t){this.bytes(e,new TextEncoder().encode(t))}message(e,t){this.bytes(e,t.finish())}finish(){return Uint8Array.from(this.parts)}}function $s(n){const e=new Uint8Array(n.length*4),t=new DataView(e.buffer);for(let o=0;o<n.length;o++)t.setFloat32(o*4,n[o],!0);return e}const Is=18,zs=8,yn=1,vn=7,js=1,Ws=2,Rs=3,Os=7;class Us{nodes=[];inits=[];uid=0;tmp(e){return`${e}_${this.uid++}`}initFloat(e,t,o){return this.inits.push({name:e,dims:t,dataType:yn,raw:$s(o)}),e}initInt64(e,t,o){return this.inits.push({name:e,dims:t,dataType:vn,int64:o}),e}node(e,t,o,r=[]){return this.nodes.push({op:e,inputs:t,outputs:o,name:`${e}_${this.uid++}`,attrs:r}),o}op(e,t,o,r=[]){const s=this.tmp(o);return this.node(e,t,[s],r),s}}function _r(n,e,t,o,r){const s=n.op("Mul",[e,e],"rms_sq"),a=n.op("ReduceMean",[s,r],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),i=n.op("Add",[a,o],"rms_eps"),c=n.op("Sqrt",[i],"rms_r"),l=n.op("Div",[e,c],"rms_div");return n.op("Mul",[l,t],"rms_y")}function br(n,e,t,o,r,s){const a=n.op("Transpose",[t],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),i=n.op("Add",[n.op("MatMul",[e,a],"ffn_mm1"),o],"ffn_pre"),c=n.op("Relu",[i],"ffn_h"),l=n.op("Transpose",[r],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return n.op("Add",[n.op("MatMul",[c,l],"ffn_mm2"),s],"ffn_y")}function wr(n,e={}){const t=Re(n),o=zt(n),r=new Map(o.map(b=>[b.name,b])),s=b=>{const y=r.get(b);if(!y)throw new Error(`export/onnx: missing tensor ${b}`);return y},a=new Us,{vocabSize:i,dModel:c,numLayers:l,convKernel:u,numExperts:d,topK:h}=t,m=a.initFloat("token_embedding.weight",[i,c],s("token_embedding.weight").data),f=a.initFloat("rms_eps",[1],new Float32Array([1e-5])),g=a.initInt64("axes_last",[1],[2]),p=a.initInt64("topk_k",[1],[h]);let _=a.op("Gather",[m,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let b=0;b<l;b++){const y=`layers.${b}`,x=a.initFloat(`${y}.norm_conv.weight`,[c],s(`${y}.norm_conv.weight`).data),L=_r(a,_,x,f,g),P=s(`${y}.conv.weight`).data,M=new Float32Array(c*u);for(let V=0;V<c;V++)for(let X=0;X<u;X++)M[V*u+(u-1-X)]=P[V*u+X];const F=a.initFloat(`${y}.conv.onnx_weight`,[c,1,u],M),C=a.op("Transpose",[L],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),O=a.op("Conv",[C,F],"conv_out",[{kind:"i",name:"group",value:c},{kind:"ints",name:"kernel_shape",value:[u]},{kind:"ints",name:"pads",value:[u-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),U=a.op("Transpose",[O],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),G=a.op("Add",[_,U],"after_conv"),W=a.initFloat(`${y}.norm_moe.weight`,[c],s(`${y}.norm_moe.weight`).data),H=_r(a,G,W,f,g),A=a.initFloat(`${y}.moe.router.weight`,[d,c],s(`${y}.moe.router.weight`).data),v=a.op("Transpose",[A],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),k=a.op("MatMul",[H,v],"router_logits"),E=a.tmp("topk_v"),j=a.tmp("topk_i");a.node("TopK",[k,p],[E,j],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const q=a.op("Softmax",[E],"gates",[{kind:"i",name:"axis",value:2}]),N=a.op("Sub",[k,k],"zeros"),T=a.op("ScatterElements",[N,j,q],"combine",[{kind:"i",name:"axis",value:2}]),D=br(a,H,a.initFloat(`${y}.moe.shared.w1`,[t.hiddenDim,c],s(`${y}.moe.shared.w1`).data),a.initFloat(`${y}.moe.shared.b1`,[t.hiddenDim],s(`${y}.moe.shared.b1`).data),a.initFloat(`${y}.moe.shared.w2`,[c,t.hiddenDim],s(`${y}.moe.shared.w2`).data),a.initFloat(`${y}.moe.shared.b2`,[c],s(`${y}.moe.shared.b2`).data)),K=Array.from({length:d},(V,X)=>a.tmp(`combine_${X}`));a.node("Split",[T],K,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:d}]);let Z=D;for(let V=0;V<d;V++){const X=`${y}.moe.experts.${V}`,se=br(a,H,a.initFloat(`${X}.w1`,[t.hiddenDim,c],s(`${X}.w1`).data),a.initFloat(`${X}.b1`,[t.hiddenDim],s(`${X}.b1`).data),a.initFloat(`${X}.w2`,[c,t.hiddenDim],s(`${X}.w2`).data),a.initFloat(`${X}.b2`,[c],s(`${X}.b2`).data)),ge=a.op("Mul",[K[V],se],"expert_w");Z=a.op("Add",[Z,ge],"moe_acc")}_=a.op("Add",[G,Z],"after_moe")}const w=a.op("Transpose",[m],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return a.node("MatMul",[_,w],["logits"]),Xs(a,t,e)}function Hs(n){const e=new ee;switch(e.string(1,n.name),n.kind){case"i":e.varint(20,Ws),e.varint(3,n.value);break;case"ints":e.varint(20,Os);for(const t of n.value)e.varint(8,t);break;case"f":e.varint(20,js),e.float(2,n.value);break;case"s":e.varint(20,Rs),e.string(4,n.value);break}return e}function Gs(n){const e=new ee;for(const t of n.inputs)e.string(1,t);for(const t of n.outputs)e.string(2,t);e.string(3,n.name),e.string(4,n.op);for(const t of n.attrs)e.message(5,Hs(t));return e}function Ks(n){const e=new ee;for(const t of n.dims)e.varint(1,t);if(e.varint(2,n.dataType),e.string(8,n.name),n.int64)for(const t of n.int64)e.varint(7,t);return n.raw&&e.bytes(9,n.raw),e}function qs(n){const e=new ee;return e.string(2,n),e}function Vs(n){const e=new ee;return e.varint(1,n),e}function yr(n,e,t){const o=new ee;for(const i of t)o.message(1,typeof i=="string"?qs(i):Vs(i));const r=new ee;r.varint(1,e),r.message(2,o);const s=new ee;s.message(1,r);const a=new ee;return a.string(1,n),a.message(2,s),a}function Xs(n,e,t){const o=new ee;for(const a of n.nodes)o.message(1,Gs(a));o.string(2,"evermind");for(const a of n.inits)o.message(5,Ks(a));o.message(11,yr("input_ids",vn,["batch","seq"])),o.message(12,yr("logits",yn,["batch","seq",e.vocabSize]));const r=new ee;r.string(1,""),r.varint(2,Is);const s=new ee;return s.varint(1,zs),s.string(2,t.producerName??"builderforce-memory-engine"),s.string(3,t.producerVersion??"evermind"),s.message(7,o),s.message(8,r),s.finish()}const Ys=1179993927,Qs=3,Le=32,Js=4,Zs=8,ea=0,ta=1;class ra{buf=new Uint8Array(1024);len=0;ensure(e){if(this.len+e<=this.buf.length)return;let t=this.buf.length*2;for(;t<this.len+e;)t*=2;const o=new Uint8Array(t);o.set(this.buf.subarray(0,this.len)),this.buf=o}u32(e){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,e,!0),this.len+=4}u64(e){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(e),!0),this.len+=8}raw(e){this.ensure(e.length),this.buf.set(e,this.len),this.len+=e.length}alignTo(e){const t=(e-this.len%e)%e;t>0&&(this.ensure(t),this.len+=t)}string(e){const t=new TextEncoder().encode(e);this.u64(t.length),this.raw(t)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function na(n,e){if(!e){const r=new Uint8Array(n.length*4),s=new DataView(r.buffer);for(let a=0;a<n.length;a++)s.setFloat32(a*4,n[a],!0);return r}const t=new Uint8Array(n.length*2),o=new DataView(t.buffer);for(let r=0;r<n.length;r++)o.setUint16(r*2,et(n[r]),!0);return t}function vr(n,e={}){const t=e.fp16??!1,o=Re(n),r=zt(n),s=t?ta:ea,a=t?2:4,i=[["evermind.vocab_size",o.vocabSize],["evermind.embedding_length",o.dModel],["evermind.block_count",o.numLayers],["evermind.conv_kernel",o.convKernel],["evermind.feed_forward_length",o.hiddenDim],["evermind.expert_count",o.numExperts],["evermind.expert_used_count",o.topK],["general.alignment",Le]],c=[["general.architecture","evermind"],["general.name",e.name??"Evermind"]],l=new ra;l.u32(Ys),l.u32(Qs),l.u64(r.length),l.u64(i.length+c.length);for(const[f,g]of c)l.string(f),l.u32(Zs),l.string(g);for(const[f,g]of i)l.string(f),l.u32(Js),l.u32(g);const u=f=>[...f.shape].reverse();let d=0;const h=[];for(const f of r){h.push(d);const g=f.data.length*a;d+=g,d+=(Le-d%Le)%Le}r.forEach((f,g)=>{l.string(f.name);const p=u(f);l.u32(p.length);for(const _ of p)l.u64(_);l.u32(s),l.u64(h[g])}),l.alignTo(Le);const m=l.length;for(let f=0;f<r.length;f++){const g=m+h[f];for(;l.length<g;)l.raw(new Uint8Array(1));l.raw(na(r[f].data,t))}return l.bytes()}function oa(n){const e=Re(n);return{model_type:"evermind",architectures:["EvermindForCausalLM"],vocab_size:e.vocabSize,d_model:e.dModel,hidden_size:e.dModel,num_hidden_layers:e.numLayers,conv_kernel:e.convKernel,intermediate_size:e.hiddenDim,num_experts:e.numExperts,num_experts_per_tok:e.topK,rms_norm_eps:1e-5,tie_word_embeddings:!0,torch_dtype:"float32",transformers_version:"4.0.0"}}function sa(){return{do_sample:!1,temperature:1,max_new_tokens:64}}function aa(n){const e={};for(const[r,s]of n.vocab)e[r]=s;const t=[...n.merges.keys()],o=[];for(const r of[n.unkToken,n.bosToken,n.eosToken,n.padToken]){const s=n.vocab.get(r);s!==void 0&&!o.some(a=>a.id===s)&&o.push({id:s,content:r})}return{version:"1.0",truncation:null,padding:null,added_tokens:o.map(r=>({id:r.id,content:r.content,single_word:!1,lstrip:!1,rstrip:!1,normalized:!1,special:!0})),normalizer:null,pre_tokenizer:{type:"ByteLevel",add_prefix_space:!1,trim_offsets:!0,use_regex:!0},post_processor:{type:"ByteLevel",add_prefix_space:!0,trim_offsets:!1,use_regex:!0},decoder:{type:"ByteLevel",add_prefix_space:!0,trim_offsets:!0,use_regex:!0},model:{type:"BPE",dropout:null,unk_token:null,continuing_subword_prefix:null,end_of_word_suffix:null,fuse_unk:!1,byte_fallback:!1,vocab:e,merges:t}}}function ia(n,e={}){const t=Re(n),o=wn(n),r=e.name??"Evermind",s=e.license??"mit",a=["evermind","ssm","mixture-of-experts","text-generation",...e.tags??[]],i=["---",`license: ${s}`,"library_name: builderforce-memory","pipeline_tag: text-generation","tags:",...a.map(l=>`  - ${l}`),"---"].join(`
`),c=`
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
${c}`}const Tc=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],ca="application/json";function ct(n,e){return{path:n,data:JSON.stringify(e,null,2),contentType:ca}}function Pc(n,e,t={},o){const r=wn(n),s=()=>({format:e,files:[],paramCount:r});switch(e){case"safetensors":{const a=s();return a.files.push({path:"model.safetensors",data:pr(n,{fp16:t.fp16}),contentType:"application/octet-stream"}),a}case"onnx":{const a=s();return a.files.push({path:"model.onnx",data:wr(n,{producerVersion:t.version}),contentType:"application/octet-stream"}),a}case"gguf":{const a=s();return a.files.push({path:"model.gguf",data:vr(n,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"}),a}case"huggingface":{if(!o)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const a=s();return a.files.push({path:"model.safetensors",data:pr(n,{fp16:t.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:wr(n,{producerVersion:t.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:vr(n,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"},ct("config.json",oa(n)),ct("generation_config.json",sa()),ct("tokenizer.json",aa(o)),{path:"README.md",data:ia(n,t),contentType:"text/markdown"}),a}default:throw new Error(`exportEvermind: unknown format "${String(e)}"`)}}function xn(n){if(n.length<8)throw new Error("safetensors: buffer too short for header length");const e=new DataView(n.buffer,n.byteOffset,n.byteLength),t=Number(e.getBigUint64(0,!0)),o=8+t;if(o>n.length)throw new Error(`safetensors: header length ${t} exceeds buffer`);const r=new TextDecoder().decode(n.subarray(8,o));let s;try{s=JSON.parse(r)}catch(c){throw new Error(`safetensors: malformed JSON header (${c instanceof Error?c.message:String(c)})`)}const a=o,i=[];for(const[c,l]of Object.entries(s)){if(c==="__metadata__")continue;const u=l;if(!u||!Array.isArray(u.shape)||!Array.isArray(u.data_offsets))throw new Error(`safetensors: malformed entry for "${c}"`);const[d,h]=u.data_offsets,m=u.shape.reduce((g,p)=>g*p,1),f=n.subarray(a+d,a+h);i.push({name:c,shape:u.shape,data:la(f,u.dtype,m,c)})}return i}function la(n,e,t,o){const r=new DataView(n.buffer,n.byteOffset,n.byteLength),s=new Float32Array(t),a=e.toUpperCase();if(a==="F32"||a==="FLOAT32"){if(n.length<t*4)throw new Error(`safetensors: "${o}" F32 bytes ${n.length} < ${t*4}`);for(let i=0;i<t;i++)s[i]=r.getFloat32(i*4,!0);return s}if(a==="F16"||a==="FLOAT16"){if(n.length<t*2)throw new Error(`safetensors: "${o}" F16 bytes ${n.length} < ${t*2}`);for(let i=0;i<t;i++)s[i]=Ft(r.getUint16(i*2,!0));return s}if(a==="BF16"||a==="BFLOAT16"){if(n.length<t*2)throw new Error(`safetensors: "${o}" BF16 bytes ${n.length} < ${t*2}`);const i=new Uint32Array(s.buffer);for(let c=0;c<t;c++)i[c]=r.getUint16(c*2,!0)<<16;return s}throw new Error(`safetensors: unsupported dtype "${e}" for "${o}" (expected F32, F16 or BF16)`)}function da(n,e){const t=new Map(n.map(h=>[h.name,h])),o=t.get("token_embedding.weight");if(!o||o.shape.length!==2)throw new Error("import: missing token_embedding.weight [vocab, dModel]");const[r,s]=o.shape;let a=0,i=0;for(const h of n){const m=/^layers\.(\d+)\./.exec(h.name);m&&(a=Math.max(a,Number(m[1])+1));const f=/^layers\.\d+\.moe\.experts\.(\d+)\./.exec(h.name);f&&(i=Math.max(i,Number(f[1])+1))}if(a===0)throw new Error("import: no `layers.<n>.` tensors found");const c=t.get("layers.0.conv.weight");if(!c||c.shape.length!==2)throw new Error("import: missing layers.0.conv.weight [dModel, convKernel]");const l=c.shape[1],u=t.get("layers.0.moe.shared.w1");if(!u||u.shape.length!==2)throw new Error("import: missing layers.0.moe.shared.w1 [hiddenDim, dModel]");const d=u.shape[0];return{vocabSize:r,dModel:s,numLayers:a,convKernel:l,hiddenDim:d,numExperts:i,topK:Math.min(e??2,Math.max(1,i))}}function ua(n,e={}){const t=[];for(const l of n){const u=e.rename?e.rename(l.name):l.name;u!=null&&t.push({...l,name:u})}const o=new Map(t.map(l=>[l.name,l])),r=e.arch??da(t,e.topK),s=bn(r),a=[];for(const l of s){const u=o.get(l.name);if(!u)throw new Error(`import: missing tensor "${l.name}" (expected shape [${l.shape.join(", ")}])`);const d=l.shape.reduce((h,m)=>h*m,1);if(u.data.length!==d)throw new Error(`import: tensor "${l.name}" has ${u.data.length} elements, expected ${d} ([${l.shape.join(", ")}])`);a.push(u.data)}const i=new rt({vocabSize:r.vocabSize,dModel:r.dModel,numLayers:r.numLayers,convKernel:r.convKernel,hiddenDim:r.hiddenDim,numExperts:r.numExperts,topK:r.topK}),c=i.parameters();if(c.length!==a.length)throw new Error(`import: parameter-count drift (model ${c.length} vs imported ${a.length})`);for(let l=0;l<c.length;l++)c[l].data.set(a[l]);return i}function Nc(n,e={}){return ua(xn(n),e)}function kn(n){return n.startsWith("model.")?n.slice(6):n}function ha(n){return n.reduce((e,t)=>e*t,1)}function pe(n){const e=n.filter(t=>t!==1);return e.length>0?e:[1]}function lt(n,e){return n.length===e.length&&n.every((t,o)=>t===e[o])}function fa(n){if(!(n>0))throw new Error(`import/foreign: softplus⁻¹ needs a positive input, got ${n}`);return n>30?n:Math.log(Math.expm1(n))}function xr(n,e){const t=ha(n.shape);if(n.op.kind==="fill")return new Float32Array(t).fill(n.op.value);if(!e)throw new Error(`import/foreign: rule for "${n.target}" has no source tensor`);const o=`"${e.name}" → "${n.target}"`;switch(n.op.kind){case"copy":case"negExpToSoftplusInv":{if(!lt(pe(e.shape),pe(n.shape)))throw new Error(`import/foreign: ${o} shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${n.shape.join(", ")}]`);if(e.data.length!==t)throw new Error(`import/foreign: ${o} has ${e.data.length} elements, expected ${t}`);if(n.op.kind==="copy")return Float32Array.from(e.data);const r=new Float32Array(t);for(let s=0;s<t;s++)r[s]=fa(Math.exp(e.data[s]));return r}case"convTaps":{const[r,s]=pe(n.shape),a=pe(e.shape);if(!lt(a,[r,s]))throw new Error(`import/foreign: ${o} depthwise conv shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${n.shape.join(", ")}] (a [channels, 1, kernel] PyTorch kernel squeezes to [channels, kernel])`);const i=new Float32Array(t);for(let c=0;c<r;c++)for(let l=0;l<s;l++)i[c*s+l]=e.data[c*s+(s-1-l)];return i}case"rowSlice":{if(e.shape.length!==2)throw new Error(`import/foreign: ${o} rowSlice needs a rank-2 source, got [${e.shape.join(", ")}]`);const[r,s]=e.shape,{start:a,count:i}=n.op;if(a<0||a+i>r)throw new Error(`import/foreign: ${o} rowSlice [${a}, ${a+i}) is outside the checkpoint tensor's ${r} rows — the source layout is not what this adapter expects`);if(!lt(pe(n.shape),pe([i,s])))throw new Error(`import/foreign: ${o} rowSlice yields [${i}, ${s}] but this model expects [${n.shape.join(", ")}]`);return Float32Array.from(e.data.subarray(a*s,(a+i)*s))}}}function ma(n,e){const t=new Map;for(const i of e){const c=kn(i.name);t.set(c,{...i,name:c})}const o=new Map,r=[],s=new Set;for(const i of n.rules){if(o.has(i.target))throw new Error(`import/foreign: plan "${n.adapter}" defines "${i.target}" twice`);if(i.from.length===0){if(i.op.kind!=="fill")throw new Error(`import/foreign: rule for "${i.target}" names no source but is not a fill rule`);o.set(i.target,xr(i,null)),r.push({target:i.target,value:i.op.value,reason:i.note??"this architecture has no corresponding tensor"});continue}const c=i.from.map(l=>t.get(l)).find(l=>l!=null);if(!c)throw new Error(`import/foreign: checkpoint is missing "${i.from[0]}" (needed for "${i.target}", expected shape [${i.shape.join(", ")}])`+(i.from.length>1?`; also tried ${i.from.slice(1).map(l=>`"${l}"`).join(", ")}`:""));s.add(c.name),o.set(i.target,xr(i,c))}const a=[...t.keys()].filter(i=>!s.has(i)).sort();return{adapter:n.adapter,weights:o,unmappedSources:a,synthesisedTargets:r,discardedSources:n.discards}}function jt(n,e){throw new Error(`import/foreign: config field "${n}" ${e}`)}function re(n,e){const t=n[e];return(typeof t!="number"||!Number.isInteger(t)||t<=0)&&jt(e,`must be a positive integer, got ${JSON.stringify(t)}`),t}function Se(n,e){for(const t of e){const o=n[t];if(typeof o=="number"&&Number.isInteger(o)&&o>0)return o}}function An(n,e){const t=Se(n,["intermediate_size"]);if(t!==void 0)return t;const o=Se(n,["expand"]);return o===void 0&&jt("intermediate_size",'is absent and no usable "expand" was found'),o*e}function Mn(n,e,t){if(n%e!==0)throw new Error(`import/foreign: ${t} has d_inner ${n} which is not a whole multiple of d_model ${e} — this engine's blocks are sized by an integer expand factor`);return n/e}function ga(n,e){const t=n.time_step_rank;if(typeof t=="number"&&Number.isInteger(t)&&t>0)return t;if(t===void 0||t==="auto")return Math.ceil(e/16);jt("time_step_rank",`must be a positive integer or "auto", got ${JSON.stringify(t)}`)}const pa=["backbone.embeddings.weight","backbone.embedding.weight"];function _a(n){const{vocabSize:e,dModel:t,numLayers:o,dInner:r,dState:s,dConv:a,dtRank:i}=n,c=[{target:"embedding",shape:[e,t],from:pa,op:{kind:"copy"}}];for(let l=0;l<o;l++){const u=`backbone.layers.${l}.mixer`,d=`layer${l}`;c.push({target:`${d}.wInProj`,shape:[2*r,t],from:[`${u}.in_proj.weight`],op:{kind:"copy"}},{target:`${d}.bInProj`,shape:[2*r],from:[],op:{kind:"fill",value:0},note:"Falcon-Mamba sets use_bias=false — in_proj ships no bias; zeros are exact"},{target:`${d}.wConv`,shape:[r,a],from:[`${u}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [d_inner, 1, d_conv] → [d_inner, d_conv] with the tap axis reversed"},{target:`${d}.bConv`,shape:[r],from:[`${u}.conv1d.bias`],op:{kind:"copy"}},{target:`${d}.wXProj`,shape:[i+2*s,r],from:[`${u}.x_proj.weight`],op:{kind:"copy"}},{target:`${d}.bXProj`,shape:[i+2*s],from:[],op:{kind:"fill",value:0},note:"x_proj is bias-free upstream; zeros are exact"},{target:`${d}.wDtProj`,shape:[r,i],from:[`${u}.dt_proj.weight`],op:{kind:"copy"}},{target:`${d}.bDtProj`,shape:[r],from:[`${u}.dt_proj.bias`],op:{kind:"copy"}},{target:`${d}.A_log`,shape:[r,s],from:[`${u}.A_log`],op:{kind:"copy"}},{target:`${d}.D_vec`,shape:[r],from:[`${u}.D`],op:{kind:"copy"}},{target:`${d}.wOutProj`,shape:[t,r],from:[`${u}.out_proj.weight`],op:{kind:"copy"}},{target:`${d}.bOutProj`,shape:[t],from:[],op:{kind:"fill",value:0},note:"out_proj is bias-free upstream; zeros are exact"},{target:`${d}.normWeight`,shape:[t],from:[`backbone.layers.${l}.norm.weight`],op:{kind:"copy"}})}return c.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),c}function Ln(n){const e=n.id;return{...n,describe(t){const o=re(t,"hidden_size"),r=re(t,"num_hidden_layers"),s=re(t,"vocab_size"),a=re(t,"state_size"),i=re(t,"conv_kernel"),c=An(t,o),l=Mn(c,o,n.label),u=ga(t,o),d={vocabSize:s,dModel:o,numLayers:r,dState:a,dConv:i,expand:l,defaultMamba1:{dtRank:u,biasConv:!0}},h={adapter:e,rules:_a({vocabSize:s,dModel:o,numLayers:r,dInner:c,dState:a,dConv:i,dtRank:u}),discards:[]};return{modelConfig:d,plan:h}}}}const ba=Ln({id:"falcon_mamba",label:"Falcon-Mamba (Mamba-1 / S6)",modelTypes:["falcon_mamba"],architectures:["FalconMambaForCausalLM"]}),wa=Ln({id:"mamba",label:"Mamba (Mamba-1 / S6)",modelTypes:["mamba"],architectures:["MambaForCausalLM"]}),kr="codestral_mamba",ya=["backbone.embeddings.weight","backbone.embedding.weight"];function va(n){const{vocabSize:e,dModel:t,numLayers:o,dInner:r,dState:s,dConv:a,nHeads:i,nGroups:c}=n,l=r+2*c*s,u=l+i,d=[{target:"embedding",shape:[e,t],from:ya,op:{kind:"copy"}}];for(let h=0;h<o;h++){const m=`backbone.layers.${h}.mixer`,f=`layer${h}`;d.push({target:`${f}.wInProj`,shape:[u,t],from:[`${m}.in_proj.weight`],op:{kind:"rowSlice",start:r,count:u},note:"upstream rows are [gate, x, B, C, dt]; this block has no gate branch"},{target:`${f}.wConv`,shape:[l,a],from:[`${m}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [conv_dim, 1, d_conv] → [conv_dim, d_conv] with the tap axis reversed"},{target:`${f}.bConv`,shape:[l],from:[`${m}.conv1d.bias`],op:{kind:"copy"}},{target:`${f}.A_log`,shape:[i],from:[`${m}.A_log`],op:{kind:"negExpToSoftplusInv"},note:"upstream A = -exp(A_log); this engine's SSD kernel uses A = -softplus(A_log)"},{target:`${f}.dt_bias`,shape:[i],from:[`${m}.dt_bias`],op:{kind:"copy"}},{target:`${f}.D_vec`,shape:[i],from:[`${m}.D`],op:{kind:"copy"}},{target:`${f}.wOutProj`,shape:[t,r],from:[`${m}.out_proj.weight`],op:{kind:"copy"}},{target:`${f}.normWeight`,shape:[r],from:[`${m}.norm.weight`],op:{kind:"copy"},note:"upstream this gain belongs to a GATED RMSNorm; applied ungated here"},{target:`${f}.preNormWeight`,shape:[t],from:[`backbone.layers.${h}.norm.weight`],op:{kind:"copy"}})}return d.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),d}function xa(n){const e=[];for(let t=0;t<n.numLayers;t++)e.push({source:`backbone.layers.${t}.mixer.in_proj.weight`,elements:n.dInner*n.dModel,reason:"the leading d_inner gate (z) rows — Mamba2Block computes norm(y) rather than norm(y * silu(z)), so it has no gate branch to receive them"});return e}const ka={id:kr,label:"Codestral-Mamba (Mamba-2 / SSD)",modelTypes:["mamba2"],architectures:["Mamba2ForCausalLM","MambaCodestralForCausalLM"],describe(n){const e=re(n,"hidden_size"),t=re(n,"num_hidden_layers"),o=re(n,"vocab_size"),r=re(n,"state_size"),s=re(n,"conv_kernel"),a=re(n,"num_heads"),i=Se(n,["n_groups"])??1,c=Se(n,["chunk_size"])??256,l=An(n,e),u=Mn(l,e,"Codestral-Mamba"),d=Se(n,["head_dim"]);if(l%a!==0)throw new Error(`import/foreign: Codestral-Mamba d_inner ${l} is not divisible by num_heads ${a}`);if(d!==void 0&&d*a!==l)throw new Error(`import/foreign: Codestral-Mamba config is inconsistent — head_dim ${d} × num_heads ${a} = ${d*a}, but d_inner is ${l}`);const h=Array.from({length:t},()=>({type:"mamba2"})),m={vocabSize:o,dModel:e,numLayers:t,layers:h,dState:r,dConv:s,expand:u,nHeads:a,nGroups:i,chunkLen:c},f={vocabSize:o,dModel:e,numLayers:t,dInner:l,dState:r,dConv:s,nHeads:a,nGroups:i};return{modelConfig:m,plan:{adapter:kr,rules:va(f),discards:xa(f)}}}},wt=[wa,ba,ka];function Aa(n){const e=n.architectures;return Array.isArray(e)?e.filter(t=>typeof t=="string"):[]}function Ma(n){const e=n.model_type;return typeof e=="string"?e:void 0}function La(n,e){const t=[...n,e??""].join(" ").toLowerCase();return t.includes("mamba")||t.includes("ssm")?!1:/llama|mistral|qwen|gpt|phi|gemma|falcon(?!_?mamba)|starcoder|deepseek|olmo|attention|forcausallm/.test(t)}function Ar(){return wt.map(n=>`${n.label} — architectures ${n.architectures.join(" / ")}, model_type ${n.modelTypes.join(" / ")}`).join("; ")}function Ea(n){const e=Aa(n),t=Ma(n),o=wt.find(a=>e.some(i=>a.architectures.includes(i)));if(o)return o;const r=t?wt.find(a=>a.modelTypes.includes(t)):void 0;if(r)return r;const s=e.length>0?`architectures [${e.join(", ")}]`:t?`model_type "${t}"`:"a config declaring neither `architectures` nor `model_type`";throw La(e,t)?new Error(`import/foreign: ${s} is a TRANSFORMER checkpoint — its attention weights (q/k/v/o projections, positional embeddings) have no counterpart in a state-space mixer, so no weight port can exist for it at any tensor naming. Transformer coders (IQuest, NousCoder, Maincoder and the like) can only be brought across by DISTILLATION — train this engine's SSM against the transformer's outputs. Weight porting is supported only for: ${Ar()}.`):new Error(`import/foreign: unsupported checkpoint — ${s}. Supported: ${Ar()}. A transformer checkpoint cannot be weight-ported at all; distillation is the only route.`)}function Sa(n,e){const t=Ea(n),{modelConfig:o,plan:r}=t.describe(n);return{...ma(r,e),modelConfig:o}}function $c(n,e){return Sa(n,xn(e))}function Ic(n,e){const t=n.parameters(),o=new Set(t.map(s=>s.name)),r=[...e.weights.keys()].filter(s=>!o.has(s));if(r.length>0)throw new Error(`import/foreign: ported tensors ${r.slice(0,5).map(s=>`"${s}"`).join(", ")}${r.length>5?` (+${r.length-5} more)`:""} have no parameter on this model — build it from the port's modelConfig`);for(const s of t){const a=e.weights.get(s.name);if(!a)throw new Error(`import/foreign: no ported tensor for parameter "${s.name}" — the model was built from a different config than the port's modelConfig`);if(a.length!==s.numel)throw new Error(`import/foreign: parameter "${s.name}" expects ${s.numel} elements, the port produced ${a.length}`);we(n.device,s.buf,a)}}function Ge(n){throw new Error(`import/foreign: cannot read a Mamba-1 config from these tensors — ${n}`)}function zc(n){const e=new Map(n.map(p=>[kn(p.name),p])),t=p=>e.get(p)?.shape,o=t("backbone.embeddings.weight")??t("backbone.embedding.weight");(!o||o.length!==2)&&Ge("no backbone.embedding(s).weight [vocab, d_model]");const[r,s]=o;let a=0;for(;e.has(`backbone.layers.${a}.mixer.in_proj.weight`);)a++;a===0&&Ge("no backbone.layers.N.mixer.in_proj.weight");const i="backbone.layers.0.mixer",c=t(`${i}.in_proj.weight`),l=t(`${i}.conv1d.weight`),u=t(`${i}.A_log`),d=t(`${i}.x_proj.weight`);(!l||!u||!d)&&Ge("layer 0 is missing conv1d.weight, A_log or x_proj.weight");const h=c[0]/2,m=u[1],f=l[l.length-1],g=d[0]-2*m;return(!Number.isInteger(h)||g<=0)&&Ge(`inconsistent shapes (in_proj ${c.join("×")}, x_proj ${d.join("×")})`),{model_type:"mamba",architectures:["MambaForCausalLM"],vocab_size:r,hidden_size:s,num_hidden_layers:a,intermediate_size:h,state_size:m,conv_kernel:f,time_step_rank:g}}function jc(n,e,t={}){if(!Number.isInteger(e)||e<=0)throw new Error(`import/foreign: vocabulary size must be a positive integer, got ${e}`);const o=n.modelConfig.vocabSize;if(e===o)return n;const r=n.weights.get("embedding");if(!r)throw new Error('import/foreign: the port has no "embedding" to resize');const s=n.modelConfig.dModel,a=new Float32Array(e*s);a.set(r.subarray(0,Math.min(o,e)*s));const i=[...n.synthesisedTargets];if(e>o){const l=t.std??.02,u=new te(t.seed??1);a.set(me((e-o)*s,l,()=>u.next()),o*s),i.push({target:"embedding",value:l,reason:`rows ${o}..${e-1} drawn from N(0, ${l}²) to reach a ${e}-token vocabulary`})}const c=new Map(n.weights);return c.set("embedding",a),{...n,weights:c,synthesisedTargets:i,modelConfig:{...n.modelConfig,vocabSize:e}}}const Fa=`

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
`,Wc=`

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
`,Rc={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},En={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},Sn=8,ie=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],Da=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],Wt=[0,.2,.5,.5,.8,.5,.7,.5];function ot(n,e){const t=Da[n];return t?Number.isNaN(e)?t[0]:Math.max(t[0],Math.min(t[1],e)):e}function Oc(n){for(let e=0;e<n.length&&e<Sn;e++)n[e]=ot(e,n[e]);return n}function Ba(){return Float32Array.from(Wt)}function Fn(n){const e={};for(let t=0;t<ie.length;t++)e[ie[t]]=n[t]??0;return e}function Ca(n){const e=Ba();for(let t=0;t<ie.length;t++){const o=n[ie[t]];typeof o=="number"&&!Number.isNaN(o)&&(e[t]=ot(t,o))}return e}function le(n){return((typeof n=="number"&&!Number.isNaN(n)?Math.max(0,Math.min(100,n)):50)-50)/50}function Dn(n){const e=Fn(Wt);if(!n)return e;const t=le(n.openness),o=le(n.emotionality),r=le(n.conscientiousness),s=le(n.extraversion),a=le(n.regulatoryFocus),i=le(n.riskTolerance),c=le(n.grit),l=le(n.stimulation),u=(d,h)=>{e[d]=ot(En[d],h)};return u("driveCuriosity",.5+.35*t+.15*l),u("exploration",.4+.3*t+.25*i+.15*a),u("driveCaution",.5+.3*r-.3*i-.2*a+.15*o),u("arousal",.2+.2*o+.1*s),u("driveSocial",.5+.35*s),u("driveEffort",.8+.15*c+.1*r),u("valence",0+.1*a-.1*o),u("attention",.7+.1*r),e}function Uc(n){return Ca(Dn(n))}function yt(n,e){return ot(En[n],e)}function vt(){return Fn(Wt)}function Hc(n){if(n.length===0)return vt();const e=vt();for(const t of ie)e[t]=0;for(const t of n){const o=Dn(t);for(const r of ie)e[r]+=o[r]}for(const t of ie)e[t]/=n.length;return e}function Mr(n,e){const t={...n};for(const o of ie){const r=e[o];typeof r=="number"&&!Number.isNaN(r)&&(t[o]=yt(o,t[o]+r))}return t}const Ta=n=>Math.max(0,Math.min(1,n.intensity??.5));function Gc(n){const e=Ta(n);switch(n.kind){case"success":return{valence:.5*e,arousal:-.15*e,driveCaution:-.1*e,driveEffort:-.05*e};case"progress":return{valence:.25*e,arousal:.05*e,driveEffort:-.03*e};case"error":return{valence:-.45*e,arousal:.4*e,driveCaution:.3*e,attention:.15*e};case"blocked":return{valence:-.35*e,arousal:.3*e,driveEffort:-.15*e,driveSocial:.2*e};case"risk":return{arousal:.35*e,driveCaution:.4*e,attention:.2*e,exploration:-.15*e};case"feedback":{const t=Math.sign(n.sign??1)||1;return{valence:.4*e*t,arousal:.1*e,driveSocial:.1*e}}case"idle":return{arousal:-.2*e,driveEffort:.15*e};default:return{}}}function Kc(n,e,t={}){const o=t.rate??.1,r=t.fatigue??0,s={...n};for(const a of ie)s[a]=yt(a,s[a]+o*(e[a]-s[a]));return r>0&&(s.driveEffort=yt("driveEffort",s.driveEffort-r)),s}function Pa(n,e=.5){const t=n.arousal-e,o=1-2.8*t*t;return Math.max(.1,Math.min(1,o))}function xt(n){let e=.5*n.exploration+.3*n.driveCuriosity;return e+=.15*n.valence,e-=.25*(1-n.driveEffort),e-=.2*(n.driveCaution-.5),Math.max(0,Math.min(1,e))}function qc(n,e){if(e.length===0)return{choice:null,exploreBias:xt(n)};const t=xt(n);let o=e[0],r=-1/0;for(const s of e){const a=Math.max(0,Math.min(1,s.novelty)),i=-Math.abs(a-t);i>r&&(r=i,o=s)}return{choice:o,exploreBias:t}}const dt=.6,ut=.4;function Na(n){const e=[],t={},o=c=>{t.thinkLevel!=="high"&&(t.thinkLevel=c)};n.valence<=-.4?(e.push("Affect (negative): recent steps have gone badly — slow down, avoid rash or destructive actions, and re-verify your assumptions before proceeding."),o("high"),t.reasoningLevel="on"):n.valence>=.4&&e.push("Affect (positive): things are going well — keep momentum, but don't get sloppy."),n.arousal>=.7?(e.push("Arousal (heightened): you are highly activated — resist the urge to rush; double-check before any irreversible step."),o("high")):n.arousal<=.15&&e.push("Arousal (low): this is routine — keep it lightweight and efficient."),n.driveCaution>=dt?(e.push("Drive (caution): heightened — prefer reversible steps, add guardrails, and confirm risky or destructive operations."),o("medium")):n.driveCaution<=ut&&e.push("Drive (caution): relaxed — bias to action on low-risk work."),n.driveCuriosity>=dt&&e.push("Drive (curiosity): high — it is appropriate to investigate and consider alternative approaches."),n.driveEffort<=ut&&e.push("Drive (effort): energy is low — keep scope tight, avoid over-engineering, checkpoint progress, and consider escalating rather than grinding."),n.driveSocial>=dt?e.push("Drive (social): communicate proactively — surface progress and ask for input when blocked."):n.driveSocial<=ut&&e.push("Drive (social): work heads-down — narrate only what matters."),Pa(n)<=.5&&(e.push("Attention (degraded): your attention gate is low — re-read the task carefully and do not skip verification steps."),o("medium"));const s=xt(n);s>=.7?e.push("Action selection: lean exploratory — try a novel approach before settling on the obvious one."):s<=.3&&e.push("Action selection: lean exploitative — use the proven, known approach and avoid unnecessary detours.");let a=0;a+=.2*(n.exploration-.5)*2,a+=.06*(n.driveCuriosity-.5)*2,a+=.08*n.valence,a-=.16*(n.driveCaution-.5)*2,a-=.08*Math.max(0,n.arousal-.7);const i=Math.max(-.3,Math.min(.3,Math.round(a*100)/100));return Math.abs(i)>=.02&&(t.temperatureDelta=i),{directives:e,params:t}}const $a="Current affective state (execute accordingly):";function Vc(n){if(!n)return"";const{directives:e}=Na(n);return e.length===0?"":[$a,...e.map(t=>`- ${t}`)].join(`
`)}const Ia=/\b(delete|drop|truncate|destroy|wipe|prod(uction)?|migrat|secret|credential|password|payment|billing|charge|refund|deploy|force[- ]?push|rm\s+-rf|irreversible|security|auth|breaking)\b/i,za=/\b(refactor|rewrite|architecture|complex|large|entire|whole|across|end[- ]to[- ]end|overhaul)\b/i;function Xc(n,e=vt()){const t=n||"";let o=e;return Ia.test(t)&&(o=Mr(o,{driveCaution:.3,arousal:.25,attention:.15,exploration:-.1})),za.test(t)&&(o=Mr(o,{driveCuriosity:.2,arousal:.1,exploration:.1})),o}const ja={inputDim:32,hiddenDim:16,stateDim:Sn,rewardWeight:.5},Lr=1280131651,Wa=296863214;class Yc{config;win;ws;aLogit;woutState;boutState;woutReward;boutReward;gWin;gWs;gALogit;gWoutState;gBoutState;gWoutReward;gBoutReward;constructor(e={}){const t={...ja,...e};if(t.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${t.hiddenDim})`);this.config=t;const{inputDim:o,hiddenDim:r,stateDim:s}=t,a=new te((e.seed??Wa)>>>0||1),i=l=>{const u=Math.max(a.next(),1e-12),d=a.next();return l*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*d)},c=(l,u)=>{const d=new Float32Array(l);for(let h=0;h<l;h++)d[h]=i(u);return d};this.win=c(r*o,.1),this.ws=c(r*s,.1),this.aLogit=c(r,.05),this.woutState=c(s*r,.05),this.boutState=new Float32Array(s),this.woutReward=c(r,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(e,t,o){const r=this._forwardCached(e,t,o);return{hidden:r.hn,delta:r.delta,reward:r.reward}}_forwardCached(e,t,o){const{inputDim:r,hiddenDim:s,stateDim:a}=this.config,i=Float32Array.from({length:r},(g,p)=>e[p]??0),c=Float32Array.from({length:s},(g,p)=>t[p]??0),l=Float32Array.from({length:a},(g,p)=>o[p]??0),u=new Float32Array(s),d=new Float32Array(s),h=new Float32Array(s);for(let g=0;g<s;g++){let p=0;const _=g*r;for(let b=0;b<r;b++)p+=this.win[_+b]*i[b];const w=g*a;for(let b=0;b<a;b++)p+=this.ws[w+b]*l[b];u[g]=ze(this.aLogit[g]),d[g]=Math.tanh(p),h[g]=u[g]*c[g]+(1-u[g])*d[g]}const m=new Float32Array(a);for(let g=0;g<a;g++){let p=this.boutState[g];const _=g*s;for(let w=0;w<s;w++)p+=this.woutState[_+w]*h[w];m[g]=Math.tanh(p)}let f=this.boutReward[0];for(let g=0;g<s;g++)f+=this.woutReward[g]*h[g];return{x:i,sPrev:l,hPrev:c,a:u,t:d,hn:h,delta:m,reward:f}}backwardStep(e,t,o,r,s){const{inputDim:a,hiddenDim:i,stateDim:c,rewardWeight:l}=this.config,u=this._forwardCached(e,t,o);let d=0;const h=new Float32Array(c);for(let p=0;p<c;p++){const _=u.delta[p]-(r[p]??0);d+=.5*_*_,h[p]=_}const m=u.reward-s;d+=.5*l*m*m;const f=l*m,g=new Float32Array(i);for(let p=0;p<c;p++){const _=h[p]*(1-u.delta[p]*u.delta[p]);this.gBoutState[p]=this.gBoutState[p]+_;const w=p*i;for(let b=0;b<i;b++)this.gWoutState[w+b]=this.gWoutState[w+b]+_*u.hn[b],g[b]=g[b]+_*this.woutState[w+b]}this.gBoutReward[0]=this.gBoutReward[0]+f;for(let p=0;p<i;p++)this.gWoutReward[p]=this.gWoutReward[p]+f*u.hn[p],g[p]=g[p]+f*this.woutReward[p];for(let p=0;p<i;p++){const _=u.a[p],w=u.t[p];this.gALogit[p]=this.gALogit[p]+g[p]*(u.hPrev[p]-w)*_*(1-_);const b=g[p]*(1-_)*(1-w*w),y=p*a;for(let L=0;L<a;L++)this.gWin[y+L]=this.gWin[y+L]+b*u.x[L];const x=p*c;for(let L=0;L<c;L++)this.gWs[x+L]=this.gWs[x+L]+b*u.sPrev[L]}return{loss:d,hidden:u.hn}}exportWeights(e={}){const t=e.fp16??!1,o=this.parameters(),r=o.reduce((u,d)=>u+d.numel,0),s=5,a=s*4,i=t?r*2:r*4,c=new ArrayBuffer(a+i),l=new Uint32Array(c,0,s);if(l[0]=Lr,l[1]=t?2:1,l[2]=this.config.inputDim,l[3]=this.config.hiddenDim,l[4]=this.config.stateDim,t){const u=new Float32Array(r);let d=0;for(const m of o)u.set(m.data,d),d+=m.numel;const h=Pe(u);new Uint16Array(c,a,r).set(h)}else{const u=new Float32Array(c,a,r);let d=0;for(const h of o)u.set(h.data,d),d+=h.numel}return c}loadWeights(e){const t=new Uint32Array(e,0,5);if(t[0]!==Lr)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const o=t[1],r=t[2],s=t[3],a=t[4];if(r!==this.config.inputDim||s!==this.config.hiddenDim||a!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${r}/${s}/${a} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const i=this.parameters(),c=i.reduce((h,m)=>h+m.numel,0),l=20;let u;o===2?u=Ne(new Uint16Array(e,l,c)):u=new Float32Array(e.slice(l,l+c*4));let d=0;for(const h of i)h.data.set(u.subarray(d,d+h.numel)),d+=h.numel}}const Ra=48;function Oa(n,e){const t=new ArrayBuffer(Ra);return new Uint32Array(t,0,1).set([n]),new Float32Array(t,4,8).set([e.lr,e.beta1,e.beta2,e.eps,e.weightDecay,e.beta1_t,e.beta2_t,e.maxDelta]),t}class Bn{label;head;device;_moments=null;_step=0;_skippedNonFinite=0;_adamwPipeline;constructor(e,t=null,o="HeadTrainer"){this.label=o,this.head=e,this.device=t,this._adamwPipeline=t?R(t,Fa,"adamw_update"):null}get skippedNonFinite(){return this._skippedNonFinite}get diverged(){return this._skippedNonFinite>0}get gpuTraining(){return this.device!=null&&this._adamwPipeline!=null}_initMoments(){this._moments||(this._moments=this.head.parameters().map(e=>({m:new Float32Array(e.numel),v:new Float32Array(e.numel)})))}async train(e,t={}){if(e.length===0)throw new Error(`${this.label}.train: no samples`);const{learningRate:o=.05,epochs:r=50,weightDecay:s=0,beta1:a=.9,beta2:i=.999,eps:c=1e-8,maxGradNorm:l=1,onEpochEnd:u=null}=t;this._initMoments();const d=[];for(let h=0;h<r;h++){this.head.zeroGrad();let m=0;for(const x of e)m+=this.head.accumulate(x);const f=this.head.gradients(),g=1/e.length;for(const x of f)for(let L=0;L<x.data.length;L++)x.data[L]*=g;const p=Ha(f,l);this._step++;const _=Math.pow(a,this._step),w=Math.pow(i,this._step),b={lr:o,weightDecay:s,beta1:a,beta2:i,eps:c,beta1_t:_,beta2_t:w,maxDelta:0};this.gpuTraining?await this._adamwStepGpu(f,b):this._adamwStepCpu(f,b);const y=m/e.length;d.push(y),u&&u(h+1,y,p)}return d}evaluate(e){if(e.length===0)return 0;let t=0;for(const o of e)t+=this.head.loss(o);return t/e.length}_adamwStepCpu(e,t){const o=this.head.parameters();for(let r=0;r<o.length;r++){const s=this._moments[r];this._skippedNonFinite+=Ke(o[r].data,e[r].data,s.m,s.v,t)}}async _adamwStepGpu(e,t){const o=this.device,r=this._adamwPipeline,s=this.head.parameters();for(let a=0;a<s.length;a++){const i=s[a],c=this._moments[a];this._skippedNonFinite+=Ua(e[a].data);const l=Q(o,i.data,!0),u=Q(o,e[a].data,!1),d=Q(o,c.m,!0),h=Q(o,c.v,!0),m=z(o,Oa(i.numel,t)),f=$(o,r,[m,l,u,d,h]);I(o,r,f,[B(i.numel,256),1,1]),i.data.set((await de(o,l,i.numel*4)).subarray(0,i.numel)),c.m.set((await de(o,d,i.numel*4)).subarray(0,i.numel)),c.v.set((await de(o,h,i.numel*4)).subarray(0,i.numel)),l.destroy(),u.destroy(),d.destroy(),h.destroy(),m.destroy()}}}function Ua(n){let e=0;for(let t=0;t<n.length;t++)Number.isFinite(n[t])||e++;return e}function Ha(n,e){let t=0,o=0;for(const s of n)for(let a=0;a<s.data.length;a++){const i=s.data[a]*s.data[a];t+=i,Number.isFinite(i)&&(o+=i)}const r=Math.sqrt(o);if(r>e&&r>0){const s=e/r;for(const a of n)for(let i=0;i<a.data.length;i++)a.data[i]*=s}return Math.sqrt(t)}function Cn(n){const e=new Float32Array(n.reduce((o,r)=>o+r.numel,0));let t=0;for(const o of n)e.set(o.data,t),t+=o.numel;return e}function Tn(n,e){const t=n.reduce((r,s)=>r+s.numel,0);if(e.length!==t)throw new Error(`assignParams: expected ${t} values, got ${e.length}`);let o=0;for(const r of n){for(let s=0;s<r.numel;s++)r.data[s]=e[o+s];o+=r.numel}}function Ga(n){return{parameters:()=>n.parameters(),gradients:()=>n.gradients(),zeroGrad:()=>n.zeroGrad(),accumulate:e=>n.backwardStep(e.input,n.initHidden(),e.state,e.deltaTarget,e.reward).loss,loss:e=>{const{rewardWeight:t}=n.config,o=n.forward(e.input,n.initHidden(),e.state);let r=0;for(let a=0;a<o.delta.length;a++){const i=o.delta[a]-(e.deltaTarget[a]??0);r+=.5*i*i}const s=o.reward-e.reward;return r+=.5*t*s*s,r}}}class Qc{model;device;_trainer;constructor(e,t=null){this.model=e,this.device=t,this._trainer=new Bn(Ga(e),t,"LimbicTrainer")}get gpuTraining(){return this._trainer.gpuTraining}train(e,t={}){return this._trainer.train(e,t)}evaluate(e){return this._trainer.evaluate(e)}}const Ka={kind:"regress",id:"limbic.affect",description:"How an experience moves the agent's affective state, and how rewarding it was.",features:{numeric:n=>[...Array.from(n.embedding),...Array.from(n.state)]},engines:[{tier:"local",engine:"head",head:"mlp"}],train:{minSamples:1,trainedBy:"LimbicTrainer"},output:{decode:n=>({delta:Float32Array.from(n.scores.slice(0,-1)),reward:n.scores[n.scores.length-1]??0})}};function Jc(n){const{inputDim:e,stateDim:t}=n.config;return{predict(o){if(o.length!==e+t)throw new Error(`limbic.affect: expected ${e+t} features (embedding ${e} + state ${t}), got ${o.length}`);const r=n.forward(o.subarray(0,e),n.initHidden(),o.subarray(e));return{scores:[...Array.from(r.delta),r.reward],confidence:1}},exportParams:()=>Cn(n.parameters()),importParams:o=>Tn(n.parameters(),o)}}const Zc=`

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
`;function qa(){const n=new Uint8Array(8);return globalThis.crypto.getRandomValues(n),Array.from(n,e=>e.toString(16).padStart(2,"0")).join("")}const Va=new Set(["send","submit","pay","purchase","buy","order","checkout","delete","remove","confirm","transfer","publish","post","sign","approve","book","cancel","erase","wipe","format","uninstall","senden","absenden","bezahlen","kaufen","bestellen","löschen","entfernen","bestätigen","überweisen","veröffentlichen","enviar","pagar","comprar","pedido","eliminar","borrar","confirmar","transferir","publicar","envoyer","payer","acheter","commander","supprimer","confirmer","virement","publier"]),Xa=["发送","提交","支付","付款","购买","下单","删除","确认","转账","发布"];function Er(n){const e=n.toLowerCase();return Xa.some(t=>e.includes(t))?!0:e.split(/[^\p{L}\p{N}]+/u).some(t=>t.length>0&&Va.has(t))}function he(n){return n?n.name.trim()||n.automationId.trim():""}function Ya(n){switch(n.kind){case"click":return Er(he(n.target));case"keys":return n.keys.toLowerCase()==="enter"&&Er(he(n.target));case"setValue":return!1}}function el(n,e={},t=Date.now()){const o=new Set(e.removed??[]),r=new Set(e.fixed??[]),s=[],a=[];for(const i of n.steps){if(o.has(i.id))continue;const c=i.action;let l;if(c.kind==="setValue")if(!c.secret&&r.has(i.id))l={kind:"setValue",target:c.target,value:{from:"literal",text:c.value}};else{const d=Sr(e.paramNames?.[i.id]??"")||Sr(he(c.target))||"value",h=Qa(s,d);s.push({name:h,label:he(c.target),default:c.secret?null:c.value,secret:!!c.secret}),l={kind:"setValue",target:c.target,value:{from:"param",name:h}}}else l=c;a.push({id:i.id,action:l,requiresApproval:e.approvals?.[i.id]??Ya(c),screenshot:i.screenshot??null})}return{id:qa(),name:e.name?.trim()||n.name,program:n.program,args:[...n.args],params:s,steps:a,sourceEpisode:n.id,createdAt:t,routine:null}}function Sr(n){return n.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join("_").slice(0,40).replace(/_+$/,"")}function Qa(n,e){if(!n.some(t=>t.name===e))return e;for(let t=2;;t++){const o=`${e}_${t}`;if(!n.some(r=>r.name===o))return o}}const ht=6e4,ft=864e5;function Ja(n,e,t,o){if(n.every==="minutes"){const c=Math.max(1,n.minutes)*ht;return e==null||t-e>=c}const r=o*ht,s=t+r,i=s-(s%ft+ft)%ft+Math.min(23,Math.max(0,n.hour))*36e5+Math.min(59,Math.max(0,n.minute))*ht;return s>=i&&(e==null||e+r<i)}function tl(n,e,t){return n.filter(o=>o.routine?.enabled&&Ja(o.routine.schedule,o.routine.lastRunAt,e,t)).sort((o,r)=>(o.routine?.lastRunAt??0)-(r.routine?.lastRunAt??0))}function _e(n){const e="target"in n&&n.target?n.target.windowTitle:"";return e?` in “${e}”`:""}function Pn(n){switch(n.kind){case"click":return`Click “${he(n.target)}”${_e(n)}.`;case"keys":return n.target?`Press ${n.keys} in “${he(n.target)}”${_e(n)}.`:`Press ${n.keys}.`;case"setValue":{const e=`“${he(n.target)}”`;return typeof n.value=="string"?"secret"in n&&n.secret?`Enter the secret for ${e}${_e(n)}.`:`Set ${e} to “${n.value}”${_e(n)}.`:n.value.from==="param"?`Set ${e} to <${n.value.name}>${_e(n)}.`:`Set ${e} to “${n.value.text}”${_e(n)}.`}}}function Nn(n){return n.split(/[\\/]/).pop()??n}function Za(n){const e=[`Task: ${n.name} (${Nn(n.program)})`];return n.steps.forEach((t,o)=>e.push(`${o+1}. ${Pn(t.action)}${t.requiresApproval?" Ask before doing this.":""}`)),e.join(`
`)}function ei(n){const e=[`Task: ${n.name} (${Nn(n.program)})`];return n.steps.forEach((t,o)=>e.push(`${o+1}. ${Pn(t.action)}`)),e.join(`
`)}function rl(n,e){return Rt(n,e).map(t=>t.text).join(`

`)}function Rt(n,e){const t=new Set(e.map(o=>o.sourceEpisode));return[...e.map(o=>({id:o.id,text:Za(o)})),...n.filter(o=>!t.has(o.id)).map(o=>({id:o.id,text:ei(o)}))]}function nl(n,e){const t=[];let o=[],r=0;for(const s of n){const a=o.length?s.text.length+2:s.text.length;if(o.length&&r+a>e){t.push(o),o=[],r=0,o.push(s),r=s.text.length;continue}o.push(s),r+=a}return o.length&&t.push(o),t}const ti=864e5;function Fr(n,e){return new Date(n+e*6e4).toISOString().slice(0,10)}function ol(n,e){const t=m=>{const f=n.learned[m];return typeof f=="number"&&f>=1&&f<=e.modelIndex},o=Rt(n.episodes,n.skills),r=o.filter(m=>t(m.id)).length,s={running:0,succeeded:0,failed:0,stopped:0,denied:0},a={approved:0,denied:0},i=[];for(const m of n.episodes)i.push({region:"hippocampus",kind:"demonstration",id:m.id,name:m.name,at:m.startedAt});for(const m of n.skills)i.push({region:"basalGanglia",kind:"skill",id:m.id,name:m.name,at:m.createdAt});for(const m of n.runs){s[m.status]=(s[m.status]??0)+1,i.push({region:"basalGanglia",kind:"run",id:m.id,name:m.skillName,at:m.startedAt,detail:m.status});for(const f of m.steps)f.outcome!=="approved"&&f.outcome!=="denied"||(a[f.outcome]++,i.push({region:"amygdala",kind:"approval",id:m.id,name:m.skillName,at:f.at,detail:f.outcome}))}const c=n.adaptations.filter(m=>m.index<=e.modelIndex).reverse();for(const m of c)i.push({region:"neocortex",kind:"adaptation",id:m.version,name:m.version,at:m.at,detail:m.loss.toFixed(3)});const l=Math.max(1,e.days??30),u=[],d=new Map;for(let m=l-1;m>=0;m--){const f=Fr(e.now-m*ti,e.utcOffsetMinutes);if(d.has(f))continue;const g={day:f,demonstrations:0,skills:0,runs:0,learned:0};d.set(f,g),u.push(g)}const h=(m,f,g=1)=>{const p=d.get(Fr(m,e.utcOffsetMinutes));p&&(p[f]+=g)};for(const m of n.episodes)h(m.startedAt,"demonstrations");for(const m of n.skills)h(m.createdAt,"skills");for(const m of n.runs)h(m.startedAt,"runs");for(const m of c)h(m.at,"learned",m.learned.length);return{regions:{hippocampus:n.episodes.length,basalGanglia:n.skills.length,amygdala:a.approved+a.denied,hypothalamus:n.skills.filter(m=>m.routine?.enabled).length,neocortex:r},learned:r,pending:o.length-r,runs:s,approvals:a,adaptations:c,days:u,recent:i.sort((m,f)=>f.at-m.at).slice(0,Math.max(0,e.recent??40))}}const kt="evermind.experience/1",ri=500,ni=200;function At(){return{schema:kt,episodes:[],skills:[],runs:[],learned:{},adaptations:[],curated:{}}}function Dr(n){const e=n;return!e||e.schema!==kt?At():{schema:kt,episodes:Array.isArray(e.episodes)?e.episodes:[],skills:Array.isArray(e.skills)?e.skills:[],runs:Array.isArray(e.runs)?e.runs:[],learned:e.learned&&typeof e.learned=="object"&&!Array.isArray(e.learned)?e.learned:{},adaptations:Array.isArray(e.adaptations)?e.adaptations:[],curated:e.curated&&typeof e.curated=="object"&&!Array.isArray(e.curated)?e.curated:{}}}function oi(n){return{id:n.id,name:n.name,program:n.program,startedAt:n.startedAt,steps:n.steps.length}}class be{onChange;data;constructor(e,t){this.onChange=t,this.data=e?Dr(e):At()}load(e){this.data=Dr(e)}async changed(){await this.onChange?.(this.data)}static upsert(e,t){const o=e.findIndex(r=>r.id===t.id);o>=0?e[o]=t:e.push(t)}static remove(e,t){const o=e.findIndex(r=>r.id===t);return o<0?!1:(e.splice(o,1),!0)}async putEpisode(e){be.upsert(this.data.episodes,e),await this.changed()}async getEpisode(e){return this.data.episodes.find(t=>t.id===e)}async listEpisodes(){return[...this.data.episodes].sort((e,t)=>t.startedAt-e.startedAt).map(oi)}async deleteEpisode(e){const t=be.remove(this.data.episodes,e);return delete this.data.learned[e],delete this.data.curated[e],t&&await this.changed(),t}async putSkill(e){be.upsert(this.data.skills,e),await this.changed()}async getSkill(e){return this.data.skills.find(t=>t.id===e)}async listSkills(){return[...this.data.skills].sort((e,t)=>t.createdAt-e.createdAt)}async deleteSkill(e){const t=be.remove(this.data.skills,e);return delete this.data.learned[e],delete this.data.curated[e],t&&await this.changed(),t}async putRun(e){be.upsert(this.data.runs,e),this.data.runs.sort((t,o)=>o.startedAt-t.startedAt),this.data.runs.length=Math.min(this.data.runs.length,ri),await this.changed()}async appendRunStep(e,t){const o=this.data.runs.find(r=>r.id===e);return o?(o.steps.push(t),await this.changed(),!0):!1}async getRun(e){return this.data.runs.find(t=>t.id===e)}async listRuns(e){return this.data.runs.slice(0,Math.max(0,e))}async recordAdaptation(e){for(const t of e.learned)this.data.learned[t]=e.index,delete this.data.curated[t];this.data.adaptations.unshift(e),this.data.adaptations.length=Math.min(this.data.adaptations.length,ni),await this.changed()}async recordCuration(e){for(const t of e.kept)delete this.data.curated[t];Object.assign(this.data.curated,e.dropped),await this.changed()}async snapshot(){return structuredClone(this.data)}async clear(){this.data=At(),await this.changed()}}function fe(n){switch(n.engine){case"classical":return`local:classical:${n.algorithm}`;case"head":return`local:head:${n.head}`;case"onnx":return`local:onnx:${n.model}`;case"workers-ai":return`cloud:workers-ai:${n.model}`}}class $n{_tasks=new Map;register(e){if(!Zr.test(e.id))throw new Error(`MlTaskRegistry: malformed task id '${e.id}'`);if(this._tasks.has(e.id))throw new Error(`MlTaskRegistry: task '${e.id}' is already registered`);if(e.engines.length===0)throw new Error(`MlTaskRegistry: task '${e.id}' lists no engine`);if(e.kind==="classify"&&!(e.output.labels&&e.output.labels.length>=2))throw new Error(`MlTaskRegistry: classify task '${e.id}' needs at least two output labels`);return this._tasks.set(e.id,e),e}get(e){return this._tasks.get(e)}require(e){const t=this.get(e);if(!t)throw new Error(`MlTaskRegistry: unknown task '${e}'`);return t}has(e){return this._tasks.has(e)}list(){return[...this._tasks.values()]}}async function In(n,e,t){const o=[];if(n.text){if(!t)throw new Error("extractFeatures: this task embeds text but no embedder was supplied");o.push(await t.embed(n.text(e)))}if(n.numeric){const a=n.numeric(e);for(const i of a)if(!Number.isFinite(i))throw new Error(`extractFeatures: non-finite numeric feature ${i}`);o.push(a)}if(o.length===0)throw new Error("extractFeatures: the feature spec has neither text nor numeric fields");const r=new Float32Array(o.reduce((a,i)=>a+i.length,0));let s=0;for(const a of o)r.set(a,s),s+=a.length;return r}async function si(n,e,t){const o=[];for(const r of e)o.push(await In(n,r,t));return o}function ne(n,e){return Math.log1p(Math.max(0,n))/Math.log1p(Math.max(e,1))}function ai(n,e,t=4){return e>0?Math.max(0,Math.min(t,n/e)):0}class ii{_m=new Map;get(e,t){return this._m.get(`${e}|${t}`)}set(e,t,o){this._m.set(`${e}|${t}`,o)}}class sl{capacity;_d=[];constructor(e=500){this.capacity=e}record(e){this._d.push(e),this._d.length>this.capacity&&this._d.splice(0,this._d.length-this.capacity)}list(){return this._d}summary(){const e={},t={};for(const o of this._d){const r=e[o.taskId]??={runs:0,byEngine:{},unanswered:0,meanConfidence:null};if(r.runs++,o.engine==null){r.unanswered++;continue}r.byEngine[o.engine]=(r.byEngine[o.engine]??0)+1;const s=t[o.taskId]??={s:0,n:0};s.s+=o.confidence??0,s.n++,r.meanConfidence=s.s/s.n}return e}}class zn extends Error{taskId;decision;constructor(e,t){super(`runMlTask(${e}): no engine could answer in '${t.mode}' mode (${t.skipped.map(o=>`${o.engine}: ${o.reason}${o.detail?` (${o.detail})`:""}`).join(", ")||"none allowed"})`),this.taskId=e,this.decision=t,this.name="MlEngineUnavailableError"}}function ci(n,e,t){switch(e){case"local-only":return n.engines.filter(o=>o.tier==="local");case"hybrid":return[...n.engines.filter(o=>o.tier==="local"),...n.engines.filter(o=>o.tier==="cloud")];case"specific":{if(t==null)throw new Error(`runMlTask(${n.id}): 'specific' mode needs ctx.engine`);const o=typeof t=="string"?t:fe(t),r=n.engines.filter(s=>fe(s)===o);if(r.length===0)throw new Error(`runMlTask(${n.id}): engine '${o}' is not one of this task's engines`);return r}default:{const o=e;throw new Error(`runMlTask(${n.id}): unknown inference mode '${String(o)}'`)}}}const mt=n=>n instanceof Error?n.message:String(n);async function li(n,e,t){const o=t.registry.require(n),r=ci(o,t.mode,t.engine),s=[];let a=null,i=null,c=null;const l=(d,h)=>(t.decisions?.record({taskId:n,mode:t.mode,engine:fe(d),tier:d.tier,confidence:h.confidence,skipped:s}),{output:o.output.decode(h),confidence:h.confidence,engine:d});for(let d=0;d<r.length;d++){const h=r[d],m=fe(h);if(h.tier==="local"){const f=t.models?.get(n,m);if(!f){s.push({engine:m,reason:"unavailable"});continue}if(!a&&i==null)try{a=await In(o.features,e,t.embedder)}catch(_){i=_}if(!a){s.push({engine:m,reason:"error",detail:`features: ${mt(i)}`});continue}let g;try{g=f.predict(a)}catch(_){s.push({engine:m,reason:"error",detail:mt(_)});continue}const p=t.mode==="hybrid"&&!!t.cloud&&r.slice(d+1).some(_=>_.tier==="cloud");if(t.minConfidence!=null&&g.confidence<t.minConfidence&&p){s.push({engine:m,reason:"low-confidence",detail:g.confidence.toFixed(3)}),c??={ref:h,p:g};continue}return l(h,g)}if(!t.cloud){s.push({engine:m,reason:"unavailable"});continue}try{return l(h,await t.cloud.run({taskId:n,engine:h,input:e}))}catch(f){s.push({engine:m,reason:"error",detail:mt(f)})}}if(c)return l(c.ref,c.p);const u={taskId:n,mode:t.mode,engine:null,tier:null,confidence:null,skipped:s};throw t.decisions?.record(u),new zn(n,u)}function jn(n,e){const t=Math.min(n.length,e.length);let o=0;for(let r=0;r<t;r++)o+=n[r]*e[r];return o}function Br(n){return Math.sqrt(jn(n,n))}function di(n,e){const t=Br(n),o=Br(e);return t>0&&o>0?jn(n,e)/(t*o):0}function Fe(n,e){const t=Math.min(n.length,e.length);let o=0;for(let r=0;r<t;r++){const s=n[r]-e[r];o+=s*s}return o}function Cr(n){if(n.length===0)return Number.NaN;const e=[...n].sort((o,r)=>o-r),t=e.length>>1;return e.length%2?e[t]:(e[t-1]+e[t])/2}function Xe(n){let e=0;for(const t of n){if(!Number.isInteger(t)||t<0)throw new Error(`class label must be a non-negative integer, got ${t}`);e=Math.max(e,t+1)}return Math.max(e,2)}function ce(n){if(n.length===0)throw new Error("no samples");const e=n[0].length;for(const t of n)if(t.length!==e)throw new Error(`ragged features: expected ${e}, got ${t.length}`);return e}function Ye(n){return n.length?Math.max(...n):0}function Wn(n){const e=new te(n);return()=>e.next()}function Rn(n){return n<=1?0:n===2?1:2*(Math.log(n-1)+.5772156649)-2*(n-1)/n}class Ot{k;metric;classes;_x=[];_y=[];_w=[];constructor(e,t,o){if(this.k=e,this.metric=t,this.classes=o,!(e>=1))throw new Error(`KnnModel: k must be ≥ 1 (got ${e})`)}get size(){return this._x.length}add(e,t=0,o=1){this._x.push(Float32Array.from(e)),this._y.push(t),this._w.push(o)}similarity(e,t){return this.metric==="cosine"?di(e,t):1/(1+Math.sqrt(Fe(e,t)))}neighbours(e,t=this.k,o){const r=[];for(let s=0;s<this._x.length;s++)s!==o&&r.push({index:s,similarity:this.similarity(e,this._x[s])});return r.sort((s,a)=>a.similarity-s.similarity||s.index-a.index),r.slice(0,Math.min(t,r.length))}nearest(e){return this.neighbours(e,1)[0]??null}labelOf(e){return this._y[e]}proba(e,t){const o=new Array(this.classes).fill(0);for(const s of this.neighbours(e,this.k,t)){const a=(this.metric==="cosine"?s.similarity+1:s.similarity)*this._w[s.index]+1e-9;o[this._y[s.index]]+=a}const r=o.reduce((s,a)=>s+a,0);return r>0?o.map(s=>s/r):o.map(()=>1/this.classes)}predict(e){const t=this.proba(e);return{scores:t,confidence:Ye(t)}}excluding(e){if(!(e>=0&&e<this._x.length))throw new Error(`KnnModel.excluding: no point ${e} (size ${this._x.length})`);return{predict:t=>{const o=this.proba(t,e);return{scores:o,confidence:Ye(o)}}}}}function ui(n,e={}){ce(n.map(s=>s.x));const t=e.classes??Xe(n.map(s=>s.y)),o=e.k??Math.min(5,Math.max(1,Math.floor(Math.sqrt(n.length)))),r=new Ot(Math.min(o,n.length),e.metric??"cosine",t);for(const s of n)r.add(s.x,s.y,s.weight??1);return r}class hi{logPrior;mean;variance;constructor(e,t,o){this.logPrior=e,this.mean=t,this.variance=o}jointLogLikelihood(e){return this.mean.map((t,o)=>{const r=this.variance[o];let s=this.logPrior[o];if(s===-1/0)return s;for(let a=0;a<t.length;a++){const i=(e[a]??0)-t[a];s+=-.5*Math.log(2*Math.PI*r[a])-i*i/(2*r[a])}return s})}predict(e){const t=Array.from(ve(this.jointLogLikelihood(e)));return{scores:t,confidence:Ye(t)}}}function fi(n,e={}){const t=ce(n.map(d=>d.x)),o=e.classes??Xe(n.map(d=>d.y)),r=new Float64Array(o),s=Array.from({length:o},()=>new Float64Array(t)),a=Array.from({length:o},()=>new Float64Array(t));for(const d of n){const h=d.weight??1;r[d.y]=r[d.y]+h;for(let m=0;m<t;m++)s[d.y][m]=s[d.y][m]+h*d.x[m]}for(let d=0;d<o;d++)if(r[d]>0)for(let h=0;h<t;h++)s[d][h]=s[d][h]/r[d];for(const d of n){const h=d.weight??1;for(let m=0;m<t;m++){const f=d.x[m]-s[d.y][m];a[d.y][m]=a[d.y][m]+h*f*f}}let i=0;for(let d=0;d<o;d++)for(let h=0;h<t;h++)a[d][h]=r[d]>0?a[d][h]/r[d]:0,i=Math.max(i,a[d][h]);const c=(e.varSmoothing??1e-9)*Math.max(i,1e-12)+1e-12;for(let d=0;d<o;d++)for(let h=0;h<t;h++)a[d][h]=a[d][h]+c;const l=r.reduce((d,h)=>d+h,0);if(!(l>0))throw new Error("fitNaiveBayes: the samples carry no weight");const u=Float64Array.from(r,d=>d>0?Math.log(d/l):-1/0);return new hi(u,s,a)}function On(n,e,t){if(t.length===0||n!=="classify"&&n!=="regress")return null;let o=0,r=0;for(const s of t){const a=s.weight??1,i=e.predict(s.x),c=n==="classify"?-Math.log(Math.max(i.scores[s.y]??0,1e-12)):.5*(i.scores[0]-s.y)**2;o+=a*c,r+=a}return r>0?o/r:null}class mi{dim;classes;weights;bias;constructor(e,t){this.dim=e,this.classes=t,this.weights=new Float32Array(t*e),this.bias=new Float32Array(t)}logits(e){const t=[];for(let o=0;o<this.classes;o++){let r=this.bias[o];const s=o*this.dim;for(let a=0;a<this.dim;a++)r+=this.weights[s+a]*(e[a]??0);t.push(r)}return t}proba(e){return Array.from(ve(this.logits(e)))}predict(e){const t=this.proba(e);return{scores:t,confidence:Ye(t)}}loss(e){return On("classify",this,e)??0}step(e,t,o){const r=new Float64Array(this.weights.length),s=new Float64Array(this.classes);let a=0,i=0;for(const l of e){const u=l.weight??1,d=this.proba(l.x);a+=-u*Math.log(Math.max(d[l.y],1e-12)),i+=u;for(let h=0;h<this.classes;h++){const m=u*(d[h]-(h===l.y?1:0));s[h]=s[h]+m;const f=h*this.dim;for(let g=0;g<this.dim;g++)r[f+g]=r[f+g]+m*l.x[g]}}const c=i>0?1/i:0;for(let l=0;l<this.weights.length;l++)this.weights[l]=this.weights[l]-t*(r[l]*c+o*this.weights[l]);for(let l=0;l<this.classes;l++)this.bias[l]=this.bias[l]-t*s[l]*c;return a*c}exportParams(){const e=new Float32Array(this.weights.length+this.bias.length);return e.set(this.weights,0),e.set(this.bias,this.weights.length),e}importParams(e){if(e.length!==this.weights.length+this.bias.length)throw new Error(`LogisticModel.importParams: expected ${this.weights.length+this.bias.length} values, got ${e.length}`);for(let t=0;t<this.weights.length;t++)this.weights[t]=e[t];for(let t=0;t<this.bias.length;t++)this.bias[t]=e[this.weights.length+t]}}function gi(n,e={},t){const o=ce(n.map(u=>u.x)),r=e.classes??t?.classes??Xe(n.map(u=>u.y)),s=Xe(n.map(u=>u.y));if(s>r&&n.some(u=>u.y>=r))throw new Error(`fitLogistic: labels go up to ${s-1} but the model has ${r} classes`);const a=t??new mi(o,r);if(a.dim!==o||a.classes!==r)throw new Error(`fitLogistic: init is ${a.dim}×${a.classes}, data is ${o}×${r}`);const i=e.learningRate??.5,c=e.l2??.001,l=e.epochs??300;for(let u=0;u<l;u++)a.step(n,i,c);return a}class Tr{weights;intercept;r2;constructor(e,t,o){this.weights=e,this.intercept=t,this.r2=o}value(e){let t=this.intercept;for(let o=0;o<this.weights.length;o++)t+=this.weights[o]*(e[o]??0);return t}predict(e){return{scores:[this.value(e)],confidence:this.r2}}exportParams(){const e=new Float32Array(this.weights.length+1);return e.set(this.weights,0),e[this.weights.length]=this.intercept,e}importParams(e){if(e.length!==this.weights.length+1)throw new Error(`LinearModel.importParams: expected ${this.weights.length+1} values, got ${e.length}`);for(let t=0;t<this.weights.length;t++)this.weights[t]=e[t];this.intercept=e[this.weights.length]}}function pi(n,e,t){for(let r=0;r<t;r++){let s=r;for(let a=r+1;a<t;a++)Math.abs(n[a*t+r])>Math.abs(n[s*t+r])&&(s=a);if(Math.abs(n[s*t+r])<1e-12)throw new Error("solveLinearSystem: singular matrix");if(s!==r){for(let i=0;i<t;i++){const c=n[r*t+i];n[r*t+i]=n[s*t+i],n[s*t+i]=c}const a=e[r];e[r]=e[s],e[s]=a}for(let a=r+1;a<t;a++){const i=n[a*t+r]/n[r*t+r];if(i!==0){for(let c=r;c<t;c++)n[a*t+c]=n[a*t+c]-i*n[r*t+c];e[a]=e[a]-i*e[r]}}}const o=new Float64Array(t);for(let r=t-1;r>=0;r--){let s=e[r];for(let a=r+1;a<t;a++)s-=n[r*t+a]*o[a];o[r]=s/n[r*t+r]}return o}function _i(n,e={}){const t=ce(n.map(g=>g.x)),o=t+1,r=new Float64Array(o*o),s=new Float64Array(o),a=new Float64Array(o);for(const g of n){const p=g.weight??1;for(let _=0;_<t;_++)a[_]=g.x[_];a[t]=1;for(let _=0;_<o;_++){s[_]=s[_]+p*a[_]*g.y;for(let w=0;w<o;w++)r[_*o+w]=r[_*o+w]+p*a[_]*a[w]}}const i=e.l2??1e-6;for(let g=0;g<t;g++)r[g*o+g]=r[g*o+g]+i;const c=pi(r,s,o),l=new Tr(Float32Array.from(c.subarray(0,t)),c[t],0);let u=0,d=0;for(const g of n)u+=g.weight??1,d+=(g.weight??1)*g.y;d/=u;let h=0,m=0;for(const g of n){const p=g.weight??1;h+=p*(g.y-l.value(g.x))**2,m+=p*(g.y-d)**2}const f=m>0?Math.min(1,Math.max(0,1-h/m)):h<1e-12?1:0;return new Tr(l.weights,l.intercept,f)}class Pr{centroids;inertia;constructor(e,t){this.centroids=e,this.inertia=t}assign(e){let t=0,o=1/0,r=1/0;return this.centroids.forEach((s,a)=>{const i=Fe(e,s);i<o?(r=o,o=i,t=a):i<r&&(r=i)}),{cluster:t,d1:o,d2:r}}predict(e){const{cluster:t,d1:o,d2:r}=this.assign(e),s=Number.isFinite(r)&&r>0?1-Math.sqrt(o)/Math.sqrt(r):1;return{scores:[t],confidence:Math.max(0,Math.min(1,s))}}}function bi(n,e={}){const t=n.map(m=>m.x),o=ce(t),r=Math.min(t.length,Math.max(1,e.k??Math.round(Math.sqrt(t.length/2)))),s=Wn(e.seed??27501),a=[Float32Array.from(t[Math.floor(s()*t.length)])],i=t.map(m=>Fe(m,a[0]));for(;a.length<r;){const m=i.reduce((p,_)=>p+_,0);let f=0;if(m>0){let p=s()*m,_=-1;for(f=0;f<t.length&&!(i[f]>0&&(_=f,p-=i[f],p<=0));f++);f>=t.length&&(f=_)}else f=a.length;const g=Float32Array.from(t[f]);a.push(g),t.forEach((p,_)=>i[_]=Math.min(i[_],Fe(p,g)))}const c=new Int32Array(t.length).fill(-1),l=()=>{let m=!1;const f=new Pr(a,0);return t.forEach((g,p)=>{const _=f.assign(g).cluster;c[p]!==_&&(c[p]=_,m=!0)}),m},u=e.maxIterations??100;let d=!1;for(let m=0;m<u;m++){if(!l()){d=!0;break}const f=a.map(()=>new Float64Array(o)),g=new Array(r).fill(0);t.forEach((p,_)=>{const w=c[_];g[w]=g[w]+1;for(let b=0;b<o;b++)f[w][b]=f[w][b]+p[b]}),a.forEach((p,_)=>{if(g[_]>0)for(let w=0;w<o;w++)p[w]=f[_][w]/g[_]})}d||l();let h=0;return t.forEach((m,f)=>h+=Fe(m,a[c[f]])),new Pr(a,h)}const wi=1.4826,yi=1.2533;function Un(n,e){return typeof n=="number"?n:n[e]??0}class vi{center;scale;threshold;constructor(e,t,o){this.center=e,this.scale=t,this.threshold=o}zScores(e){return Array.from(this.center,(t,o)=>Math.abs((e[o]??0)-t)/this.scale[o])}predict(e){const t=Math.max(0,...this.zScores(e))/this.threshold;return{scores:[t],confidence:st(t)}}}function st(n){return Math.max(0,Math.min(1,Math.abs(n-1)))}function Ut(n,e={}){const t=n.map(c=>c.x),o=ce(t),r=e.minScaleFraction??.01,s=e.minScale??0,a=new Float64Array(o),i=new Float64Array(o);for(let c=0;c<o;c++){const l=t.map(m=>m[c]),u=Cr(l),d=l.map(m=>Math.abs(m-u));let h=wi*Cr(d);h>0||(h=yi*(d.reduce((m,f)=>m+f,0)/d.length)),a[c]=u,i[c]=Math.max(h,r*Math.abs(u)+1e-9,Un(s,c))}return new vi(a,i,e.threshold??3.5)}class xi{mean;variance;alpha;threshold;minScaleFraction;minScale;constructor(e,t,o,r,s,a=0){if(this.mean=e,this.variance=t,this.alpha=o,this.threshold=r,this.minScaleFraction=s,this.minScale=a,!(o>0&&o<=1))throw new Error(`EwmaModel: alpha must be in (0, 1] (got ${o})`)}zScores(e){return Array.from(this.mean,(t,o)=>{const r=Math.max(Math.sqrt(this.variance[o]),this.minScaleFraction*Math.abs(t)+1e-9,Un(this.minScale,o));return Math.abs((e[o]??0)-t)/r})}update(e){for(let t=0;t<this.mean.length;t++){const o=(e[t]??0)-this.mean[t],r=this.alpha*o;this.mean[t]=this.mean[t]+r,this.variance[t]=(1-this.alpha)*(this.variance[t]+o*r)}}predict(e){const t=Math.max(0,...this.zScores(e))/this.threshold;return{scores:[t],confidence:st(t)}}}function Ht(n,e={}){const t=ce(n.map(r=>r.x)),o=new xi(Float64Array.from(n[0].x),new Float64Array(t),e.alpha??.3,e.threshold??3,e.minScaleFraction??.01,e.minScale??0);for(let r=1;r<n.length;r++)o.update(n[r].x);return o}class Hn{population;trend;constructor(e,t){this.population=e,this.trend=t}featureScores(e){const t=this.population.zScores(e),o=this.trend.zScores(e);return t.map((r,s)=>({population:r/this.population.threshold,trend:o[s]/this.trend.threshold}))}observe(e){this.trend.update(e)}predict(e){const t=Math.max(this.population.predict(e).scores[0],this.trend.predict(e).scores[0]);return{scores:[t],confidence:st(t)}}}function ki(n,e={}){return new Hn(Ut(n,e.robustZ),Ht(n,e.ewma))}function Mt(n,e,t,o){if(e>=t||n.length<=1)return{size:n.length};const r=n[0].length,s=[];for(let h=0;h<r;h++){let m=1/0,f=-1/0;for(const g of n)m=Math.min(m,g[h]),f=Math.max(f,g[h]);f>m&&s.push({f:h,lo:m,hi:f})}if(s.length===0)return{size:n.length};const{f:a,lo:i,hi:c}=s[Math.floor(o()*s.length)],l=i+o()*(c-i),u=n.filter(h=>h[a]<l),d=n.filter(h=>h[a]>=l);return{feature:a,split:l,left:Mt(u,e+1,t,o),right:Mt(d,e+1,t,o)}}function Gn(n,e,t=0){return"size"in n?t+Rn(n.size):Gn(e[n.feature]<n.split?n.left:n.right,e,t+1)}class Ai{trees;sampleSize;threshold;constructor(e,t,o){this.trees=e,this.sampleSize=t,this.threshold=o}score(e){const t=Rn(this.sampleSize);if(t===0)return .5;const o=this.trees.reduce((r,s)=>r+Gn(s,e),0)/this.trees.length;return Math.pow(2,-o/t)}predict(e){const t=this.score(e)/this.threshold;return{scores:[t],confidence:st(t)}}}function Mi(n,e={}){const t=n.map(i=>i.x);ce(t);const o=Wn(e.seed??5616),r=Math.min(e.sampleSize??256,t.length),s=Math.ceil(Math.log2(Math.max(r,2))),a=[];for(let i=0;i<(e.trees??100);i++){const c=t.map((l,u)=>u);for(let l=0;l<r;l++){const u=l+Math.floor(o()*(c.length-l));[c[l],c[u]]=[c[u],c[l]]}a.push(Mt(c.slice(0,r).map(l=>t[l]),0,s,o))}return new Ai(a,r,e.threshold??.6)}function Nr(n,e){let t=0,o=0;for(const r of n)t+=r.w*r.g,o+=r.w*r.h;return-t/(o+e)}function gt(n,e,t){return n*n/(e+t)}function Lt(n,e,t){if(e>=t.maxDepth||n.length<2)return{value:Nr(n,t.lambda)};let o=0,r=0,s=0;for(const d of n)o+=d.w*d.g,r+=d.w*d.h,s+=d.w;const a=gt(o,r,t.lambda);let i=null;const c=n[0].x.length;for(let d=0;d<c;d++){const h=[...n].sort((p,_)=>p.x[d]-_.x[d]);let m=0,f=0,g=0;for(let p=0;p<h.length-1;p++){const _=h[p];m+=_.w*_.g,f+=_.w*_.h,g+=_.w;const w=_.x[d],b=h[p+1].x[d];if(w===b||g<t.minLeafWeight||s-g<t.minLeafWeight)continue;const y=gt(m,f,t.lambda)+gt(o-m,r-f,t.lambda)-a;y>1e-12&&(!i||y>i.score)&&(i={feature:d,split:(w+b)/2,score:y})}}if(!i)return{value:Nr(n,t.lambda)};const l=n.filter(d=>d.x[i.feature]<i.split),u=n.filter(d=>d.x[i.feature]>=i.split);return{feature:i.feature,split:i.split,left:Lt(l,e+1,t),right:Lt(u,e+1,t)}}function Kn(n,e){for(;!("value"in n);)n=e[n.feature]<n.split?n.left:n.right;return n.value}class Li{objective;base;trees;learningRate;constructor(e,t,o,r){this.objective=e,this.base=t,this.trees=o,this.learningRate=r}margin(e){let t=this.base;for(const o of this.trees)t+=this.learningRate*Kn(o,e);return t}predict(e){const t=this.margin(e);if(this.objective==="regression")return{scores:[t],confidence:1};const o=ze(t);return{scores:[1-o,o],confidence:Math.max(o,1-o)}}}function Ei(n,e={}){ce(n.map(d=>d.x));const t=e.objective??"binary",o=e.learningRate??.3,r={maxDepth:e.maxDepth??2,minLeafWeight:e.minLeafWeight??1,lambda:e.lambda??1};let s=0,a=0;for(const d of n)s+=d.weight??1,a+=(d.weight??1)*d.y;const i=s>0?a/s:n.reduce((d,h)=>d+h.y,0)/n.length,c=t==="binary"?Math.log(Math.max(i,1e-6)/Math.max(1-i,1e-6)):i,l=n.map(()=>c),u=[];for(let d=0;d<(e.trees??50);d++){const h=n.map((f,g)=>{if(t==="binary"){const p=ze(l[g]);return{x:f.x,g:p-f.y,h:Math.max(p*(1-p),1e-6),w:f.weight??1}}return{x:f.x,g:l[g]-f.y,h:1,w:f.weight??1}}),m=Lt(h,0,r);u.push(m),n.forEach((f,g)=>l[g]=l[g]+o*Kn(m,f.x))}return new Li(t,c,u,o)}function Si(n,e,t={}){if(e.length===0)throw new Error(`fitClassical(${n}): no samples`);switch(n){case"knn":return ui(e,t.knn);case"naive-bayes":return fi(e,t["naive-bayes"]);case"logistic":return gi(e,t.logistic);case"linear":return _i(e,t.linear);case"kmeans":return bi(e,t.kmeans);case"robust-z":return Ut(e,t["robust-z"]);case"ewma":return Ht(e,t.ewma);case"anomaly-composite":return ki(e,t["anomaly-composite"]);case"isolation-forest":return Mi(e,t["isolation-forest"]);case"gbm-small":return Ei(e,t["gbm-small"])}}class Fi{config;_params;_grads;constructor(e){this.config={seed:20045,...e};const{inputDim:t,hiddenDim:o,outputDim:r,objective:s}=this.config;if(s==="mse"&&r!==1)throw new Error("DenseHead: mse objective needs outputDim 1");if(s==="softmax"&&r<2)throw new Error("DenseHead: softmax objective needs outputDim ≥ 2");const a=new te(this.config.seed),i=()=>a.next(),c=o>0?o:t,l=[...o>0?[["w1",o*t,1/Math.sqrt(t)],["b1",o,0]]:[],["w2",r*c,1/Math.sqrt(c)],["b2",r,0]];this._params=l.map(([u,d,h])=>({name:u,numel:d,data:h>0?me(d,h,i):new Float32Array(d)})),this._grads=l.map(([u,d])=>({name:u,numel:d,data:new Float32Array(d)}))}_p(e){return this._params.find(t=>t.name===e).data}_g(e){return this._grads.find(t=>t.name===e).data}parameters(){return this._params}gradients(){return this._grads}zeroGrad(){for(const e of this._grads)e.data.fill(0)}_forward(e){const{inputDim:t,hiddenDim:o,outputDim:r}=this.config;let s;if(o>0){const l=this._p("w1"),u=this._p("b1");s=new Float32Array(o);for(let d=0;d<o;d++){let h=u[d];for(let m=0;m<t;m++)h+=l[d*t+m]*(e[m]??0);s[d]=Math.tanh(h)}}else s=Float32Array.from({length:t},(l,u)=>e[u]??0);const a=this._p("w2"),i=this._p("b2"),c=new Float32Array(r);for(let l=0;l<r;l++){let u=i[l];for(let d=0;d<s.length;d++)u+=a[l*s.length+d]*s[d];c[l]=u}return{h:s,z:c}}_lossGrad(e,t){if(this.config.objective==="mse"){const s=e[0]-t;return{loss:.5*s*s,dz:Float32Array.of(s)}}const o=ve(e),r=Float32Array.from(o,(s,a)=>s-(a===t?1:0));return{loss:-Math.log(Math.max(o[t]??0,1e-12)),dz:r}}loss(e){return(e.weight??1)*this._lossGrad(this._forward(e.x).z,e.y).loss}accumulate(e){const t=e.weight??1,{inputDim:o,hiddenDim:r,outputDim:s}=this.config,{h:a,z:i}=this._forward(e.x),{loss:c,dz:l}=this._lossGrad(i,e.y),u=this._p("w2"),d=this._g("w2"),h=this._g("b2"),m=new Float32Array(a.length);for(let f=0;f<s;f++){const g=t*l[f];h[f]=h[f]+g;for(let p=0;p<a.length;p++)d[f*a.length+p]=d[f*a.length+p]+g*a[p],m[p]=m[p]+g*u[f*a.length+p]}if(r>0){const f=this._g("w1"),g=this._g("b1");for(let p=0;p<r;p++){const _=m[p]*(1-a[p]*a[p]);g[p]=g[p]+_;for(let w=0;w<o;w++)f[p*o+w]=f[p*o+w]+_*(e.x[w]??0)}}return t*c}predict(e){const{z:t}=this._forward(e);if(this.config.objective==="mse")return{scores:[t[0]],confidence:1};const o=Array.from(ve(t));return{scores:o,confidence:Math.max(...o)}}exportParams(){return Cn(this._params)}importParams(e){Tn(this._params,e)}}function Di(n){const e=n.engines.find(t=>t.tier==="local"&&(t.engine==="classical"||t.engine==="head"));if(!e)throw new Error(`trainMlTask(${n.id}): no trainable local engine`);return e}async function $r(n,e,t,o){if(n.train?.fit)return{predictor:await n.train.fit(t,e),skippedNonFinite:0};if(e.engine==="classical")return{predictor:Si(e.algorithm,t,o.classical),skippedNonFinite:0};if(e.engine==="head"){const r=n.kind==="classify"?"softmax":n.kind==="regress"?"mse":null;if(!r)throw new Error(`trainMlTask(${n.id}): a head engine trains classify or regress tasks only`);const s=new Fi({inputDim:t[0].x.length,hiddenDim:e.head==="linear"?0:o.head?.hiddenDim??16,outputDim:r==="softmax"?n.output.labels.length:1,objective:r,...o.head?.seed!=null?{seed:o.head.seed}:{}}),a=new Bn(s,o.device??null,`trainMlTask(${n.id})`);return await a.train(t,o.head?.train),{predictor:s,skippedNonFinite:a.skippedNonFinite}}throw new Error(`trainMlTask(${n.id}): engine '${fe(e)}' is not trained here`)}async function Bi(n,e,t={}){const o=n.train;if(!o)throw new Error(`trainMlTask(${n.id}): task is rule-based or pre-trained only`);if(o.trainedBy)throw new Error(`trainMlTask(${n.id}): trained by ${o.trainedBy}`);if(e.length<o.minSamples)return null;const r=t.engine??Di(n),s=await si(n.features,e.map(h=>h.input),t.embedder),a=e.map((h,m)=>({x:s[m],y:h.label,...h.weight!=null?{weight:h.weight}:{}})),c=n.kind==="classify"||n.kind==="regress"?t.holdoutFraction??o.holdoutFraction??.2:0,l=Math.floor(a.length*c);let u=null;if(l>=1&&a.length-l>=1){const h=a.slice(0,a.length-l),m=a.slice(a.length-l),f=await $r(n,r,h,t);if(u=On(n.kind,f.predictor,m),t.refitOnAll===!1)return t.models?.set(n.id,fe(r),f.predictor),{predictor:f.predictor,engine:r,samples:h.length,holdout:l,holdoutLoss:u,skippedNonFinite:f.skippedNonFinite}}const d=await $r(n,r,a,t);return t.models?.set(n.id,fe(r),d.predictor),{predictor:d.predictor,engine:r,samples:a.length,holdout:l>=1?l:0,holdoutLoss:u,skippedNonFinite:d.skippedNonFinite}}function al(n,e,t,o,r={},s){return{task:n,engine:e,version:t,shape:r,params:Nt(en(o)),...s!=null&&Number.isFinite(s)?{evalLoss:s}:{}}}function il(n){return tn(We(n.params))}function cl(n,e){return n.manifest.mlHeads?.find(t=>t.task===e)}function ll(n,e){return n.withMlHeads([...(n.manifest.mlHeads??[]).filter(t=>t.task!==e.task),e])}function dl(n,e,t,o){const r=Qr(We(n.params),en(e));return is(r,n.version,t,o??`ml head ${n.task}`,un(n.task))}function ul(n,e,t,o={}){const r=We(n.params),s=un(n.task),a=[],i=[],c=[];e.forEach((d,h)=>{const m=hn(d.target,s);if(m)return void c.push({index:h,reason:m});if(d.baseVersion!==n.version)return void c.push({index:h,reason:`stale base version ${d.baseVersion} (head is ${n.version})`});let f;try{f=cs(d)}catch(p){return void c.push({index:h,reason:`diff is not base64: ${p instanceof Error?p.message:String(p)}`})}const g=ls(f,r);if(g)return void c.push({index:h,reason:g});a.push(f),i.push(d.weight??1)});const l=us(r,a,i,d=>t(tn(d)),{...o,requireEval:o.requireEval??!0});return l.accepted?{head:{...n,version:n.version+1,params:Nt(l.checkpoint),...l.newLoss!=null?{evalLoss:l.newLoss}:{}},merge:l,rejected:c}:{head:n,merge:l,rejected:c}}const Ce={kind:"classify",id:"experience.quality",description:"Is this procedure worth learning from (does it run, and run well)?",features:{text:n=>n.doc.text,numeric:n=>[ne(n.steps,50),ne(n.runs,20)],numericNames:["steps","runs"]},engines:[{tier:"local",engine:"classical",algorithm:"knn"},{tier:"local",engine:"classical",algorithm:"logistic"}],train:{minSamples:12},output:{labels:["low","high"],decode:n=>({label:(n.scores[1]??0)>=.5?"high":"low",pHigh:n.scores[1]??0})}};function Ci(n,e,t=[]){const o=new Map([...e.map(s=>[s.id,s.steps.length]),...n.map(s=>[s.id,s.steps.length])]),r=new Map;for(const s of t){if(s.status==="running")continue;const a=r.get(s.skillId)??{runs:0,succeeded:0,failed:0};a.runs++,s.status==="succeeded"&&a.succeeded++,s.status==="failed"&&a.failed++,r.set(s.skillId,a)}return Rt(n,e).map(s=>({doc:s,steps:o.get(s.id)??0,...r.get(s.id)??{runs:0,succeeded:0,failed:0}}))}function qn(n){return n.runs===0?null:n.succeeded/n.runs>=.5?1:0}const Ti=5;function Pi(n){return n.flatMap(e=>{const t=qn(e);return t==null?[]:[{input:e,label:t}]})}const Vn=.97,Et={kind:"cluster",id:"experience.dedupe",description:"Is this procedure a near-copy of one already kept?",features:{text:n=>n.text},engines:[{tier:"local",engine:"classical",algorithm:"knn"}],output:{decode:n=>({nearest:n.scores[0]??-1,similarity:n.scores[1]??0,duplicate:(n.scores[2]??0)===1})}};class Ni{threshold;_knn=new Ot(1,"cosine",2);constructor(e=Vn){this.threshold=e}get size(){return this._knn.size}add(e){this._knn.add(e)}predict(e){const t=this._knn.nearest(e);if(!t)return{scores:[-1,0,0],confidence:1};const o=t.similarity>=this.threshold;return{scores:[t.index,t.similarity,o?1:0],confidence:Math.abs(t.similarity)}}}const Ir=200;function $i(n,e,t){return{get:(o,r)=>{const s=n.get(o,r);return o===e&&s instanceof Ot&&t<s.size?s.excluding(t):s},set:(o,r,s)=>n.set(o,r,s)}}function Xn(n){const e=new Map;return{dimensions:n.dimensions,fingerprint:n.fingerprint,async embed(t){let o=e.get(t);return o||e.set(t,o=await n.embed(t)),o}}}async function Ii(n,e,t){if(n.runs<=0)return null;if(n.runs>=Ti)return n.succeeded/n.runs;const o=t==null||!e.models?e:{...e,models:$i(e.models,Ce.id,t)};try{return(await li(Ce.id,n,o)).output.pHigh}catch(r){if(!(r instanceof zn))throw r;return null}}async function zi(n,e){const t=Xn(e.embedder),o=new Ni(e.dedupeThreshold??Vn),r=[],s=[],a=[],i=e.quality?{...e.quality.ctx,embedder:t}:null,c=new Map((e.quality?.trainedIds??[]).map((u,d)=>[u,d])),l=u=>t.embed(Et.features.text(u));for(const u of e.known??[])o.add(await l(u)),r.push(u.id);for(const u of n){if(e.exclude?.has(u.id)){a.push({id:u.id,reason:"excluded"});continue}if(e.quality&&i){const m=await Ii(e.quality.input(u),i,c.get(u.id));if(m!=null&&m<(e.quality.minPHigh??.5)){a.push({id:u.id,reason:"low-quality",score:m});continue}}const d=await l(u),h=Et.output.decode(o.predict(d));if(h.duplicate){a.push({id:u.id,reason:"duplicate",of:r[h.nearest],score:h.similarity});continue}o.add(d),r.push(u.id),s.push(u)}return{kept:s,dropped:a}}function ji(n,e,t){return!n||n.status!=="curated_out"?!1:n.reason==="duplicate"?n.of!=null&&t.has(n.of):n.reason==="low-quality"?n.runs===e:!1}async function hl(n,e,t){const o=t.known?.slice(0,Ir),r=Xn(t.embedder),s=Ci(e.episodes,e.skills,e.runs),a=new Map(s.map(_=>[_.doc.id,_])),i=_=>a.get(_.id)??{doc:_,steps:0,runs:0,succeeded:0,failed:0},c=new Set((t.known??[]).map(_=>_.id)),l=[],u=[];for(const _ of n){const w=e.curated?.[_.id];w&&ji(w,i(_).runs,c)?l.push({id:_.id,reason:w.reason,...w.of!=null?{of:w.of}:{},...w.score!=null?{score:w.score}:{}}):u.push(_)}const d=[...n,...t.known??[]].map(_=>a.get(_.id)).filter(_=>_!=null&&qn(_)!=null).slice(0,Ir),h=Pi(d.reverse()),m=new $n;m.register(Ce);const f=new ii,g=await Bi(Ce,h,{embedder:r,models:f});return{...await zi(u,{embedder:r,...o?{known:o}:{},...t.dedupeThreshold!=null?{dedupeThreshold:t.dedupeThreshold}:{},quality:{ctx:{registry:m,mode:"local-only",models:f},input:i,...t.minPHigh!=null?{minPHigh:t.minPHigh}:{},...g?{trainedIds:h.map(_=>_.input.doc.id)}:{}}}),alreadyDropped:l}}function fl(n,e,t){const o=new Map;for(const s of e.runs)s.status!=="running"&&o.set(s.skillId,(o.get(s.skillId)??0)+1);const r={};for(const s of n.dropped)r[s.id]={status:"curated_out",reason:s.reason,...s.of!=null?{of:s.of}:{},...s.score!=null?{score:s.score}:{},runs:o.get(s.id)??0,at:t};return{dropped:r,kept:n.kept.map(s=>s.id)}}const Wi=["promptTokens","contextTokens","contextFill","overflows","tools","turnIndex","attachments","priorLocalSuccessRate","codeHeavy"];function Ri(n){const e=ai(n.promptTokens+n.contextTokens,n.servedContextTokens,4);return[ne(n.promptTokens,1e5),ne(n.contextTokens,1e5),e,e>1?1:0,ne(n.tools,64),ne(n.turnIndex,100),ne(n.attachments??0,16),Math.max(0,Math.min(1,n.priorLocalSuccessRate??.5)),n.codeHeavy?1:0]}const Oi={kind:"classify",id:"run.local-success",description:"Will this turn succeed on the local model?",features:{numeric:Ri,numericNames:Wi},engines:[{tier:"local",engine:"classical",algorithm:"logistic"},{tier:"local",engine:"classical",algorithm:"gbm-small"}],train:{minSamples:8},output:{labels:["fails","succeeds"],decode:n=>({succeeds:(n.scores[1]??0)>=.5,probability:n.scores[1]??0})}},Ui=.5;function Hi(n){return n.local?{label:n.local==="succeeded"?1:0,weight:1}:n.fellBack?{label:0,weight:1}:n.cloud==="failed"?{label:0,weight:Ui}:null}function ml(n){return n.flatMap(e=>{const t=Hi(e);return t?[{input:e.turn,label:t.label,weight:t.weight}]:[]})}const Yn=["cost","duration","toolFailures"],Qn=1e3,Jn=36e5,Gi=50;function Ki(n){return[ne(n.costUsd*100,Qn),ne(n.durationMs,Jn),ne(n.toolFailures,Gi)]}const zr=3,jr=[Math.log(zr)/(3*Math.log1p(Qn)),Math.log(zr)/(3*Math.log1p(Jn)),.1];class qi extends Hn{explain(e){const t=this.featureScores(e);return Yn.map((o,r)=>({metric:o,...t[r]}))}}function Vi(n,e={}){return new qi(Ut(n,{...e.robustZ,minScale:e.robustZ?.minScale??jr}),Ht(n,{...e.ewma,minScale:e.ewma?.minScale??jr}))}const Xi={kind:"anomaly",id:"run.anomaly",description:"Did this run cost, take or fail far outside its normal range?",features:{numeric:Ki,numericNames:Yn},engines:[{tier:"local",engine:"classical",algorithm:"anomaly-composite"}],train:{minSamples:5,fit:n=>Vi(n)},output:{decode:n=>({anomalous:(n.scores[0]??0)>=1,score:n.scores[0]??0})}};function gl(n,e=0){return{costUsd:e,durationMs:n.endedAt!=null?Math.max(0,n.endedAt-n.startedAt):0,toolFailures:n.steps.filter(t=>t.outcome==="failed").length}}const Yi=[Ka,Ce,Et,Xi,Oi];function pl(){const n=new $n;for(const e of Yi)n.register(e);return n}export{nc as ACTIVATIONS_BACKWARD_WGSL,ye as ACTIVATIONS_WGSL,ac as ATTENTION_BACKWARD_WGSL,Yt as ATTENTION_FORWARD_WGSL,gn as A_LOG_CLAMP_HI,mn as A_LOG_CLAMP_LO,Bt as AdamW,Hn as AnomalyCompositeModel,bo as AttentionBlock,je as BPETokenizer,Yi as BUILTIN_ML_TASKS,ro as BufferPool,Ui as CLOUD_ONLY_FAILURE_WEIGHT,Ze as COL_SLICE_ENTRY,Je as COL_SLICE_WGSL,sc as COMPLEX_SSD_BACKWARD_WGSL,ho as COMPLEX_SSD_FORWARD_WGSL,Zi as CONV1D_BACKWARD_WGSL,St as CONV1D_FORWARD_WGSL,gr as CPU_GRADIENT_LAYER_TYPES,Or as CRC_TRAILER_MAGIC,Ir as CURATION_KNOWN_LIMIT,Vn as DEFAULT_DEDUPE_THRESHOLD,ja as DEFAULT_LIMBIC_CONFIG,Wa as DEFAULT_LIMBIC_SEED,Ae as DEFAULT_LM_CONFIG,No as DEFAULT_LM_SEED,Ms as DEFAULT_LORA_TARGETS,So as DEFAULT_MOE_CONFIG,Fo as DEFAULT_MOE_SEED,dn as DELTA_TARGET_RE,Ni as DedupeIndex,Fi as DenseHead,To as DynamicLossScaler,ns as EVERMIND_ADAPT_MAX_CHARS,Et as EXPERIENCE_DEDUPE_TASK,Ce as EXPERIENCE_QUALITY_TASK,kt as EXPERIENCE_SCHEMA,Tc as EXPORT_FORMATS,rt as EvermindLM,fn as EvermindLMLoRA,Pt as EvermindLMTrainer,J as EvermindModelPackage,Ec as EvermindTextEmbedder,xi as EwmaModel,wt as FOREIGN_MAMBA_ADAPTERS,Wc as GRAD_CLIP_WGSL,Li as GbmModel,Bn as HeadTrainer,Ao as HybridMambaModel,Dc as ImageRVQCodec,be as InMemoryExperienceStore,ii as InMemoryMlModels,Ai as IsolationForestModel,Pr as KMeansModel,Ot as KnnModel,Ka as LIMBIC_AFFECT_TASK,Zc as LIMBIC_AFFECT_WGSL,$a as LIMBIC_BLOCK_HEADER,Da as LIMBIC_BOUNDS,En as LIMBIC_DIM,ie as LIMBIC_DIM_NAMES,Sn as LIMBIC_STATE_DIM,ec as LINEAR_BACKWARD_WGSL,Te as LINEAR_FORWARD_WGSL,qo as LN2,Wi as LOCAL_SUCCESS_FEATURES,Oi as LOCAL_SUCCESS_TASK,Yc as LimbicModel,Qc as LimbicTrainer,Tr as LinearModel,Be as LoRAAdapter,Bo as LoadBalanceAccumulator,mi as LogisticModel,It as MAMBA1_PARAM_NAMES,ni as MAX_ADAPTATIONS,fr as MAX_DELTA_B64_CHARS,ri as MAX_RUNS,Zr as ML_TASK_ID_RE,io as Mamba1Block,uo as Mamba2Block,mo as Mamba3Block,io as MambaBlock,dc as MambaModel,Fc as MambaTrainer,sl as MlDecisionLog,zn as MlEngineUnavailableError,$n as MlTaskRegistry,uc as MoETrainer,jo as MultimodalVocab,Wt as NEUTRAL_STATE,hi as NaiveBayesModel,Me as PACKAGE_HEADER_BYTES,Ti as QUALITY_OBSERVED_MIN_RUNS,Rc as REGION,Ie as RMSNORM_EPS,zr as RUN_ANOMALY_FLAG_RATIO,Yn as RUN_ANOMALY_METRICS,jr as RUN_ANOMALY_MIN_SCALE,Xi as RUN_ANOMALY_TASK,vi as RobustZModel,qi as RunAnomalyDetector,Ji as SELECTIVE_SCAN_BACKWARD_WGSL,Vt as SELECTIVE_SCAN_FORWARD_WGSL,rc as SOFTMAX_BACKWARD_WGSL,tc as SOFTMAX_FORWARD_WGSL,go as SOFTMAX_WGSL,oc as SSD_BACKWARD_WGSL,co as SSD_FORWARD_WGSL,te as SeededRng,Gr as SharedExpertMoE,hc as Tensor,it as VIDEO_BANK_INTER,He as VIDEO_BANK_INTRA,nt as VideoRVQCodec,Fa as WEIGHT_UPDATE_WGSL,Ls as WSLA_MAX_DELTA,Ke as adamwUpdateInPlace,ss as adaptAndDiff,Ac as adaptPackage,es as adaptationsAfterSkip,st as anomalyConfidence,$e as appendCrcTrailer,Jr as applyCheckpointDiff,Mr as applyLimbicDelta,Ic as applyPortedWeights,Yr as applyRowDelta,Gc as appraiseAmygdala,Xc as appraiseTask,Re as archOf,Tn as assignParams,pc as backward,xt as basalGangliaExploreBias,qc as basalGangliaSelect,We as base64ToBytes,Xo as benchArgmax,xc as benchmarkAdaptationCost,Ve as benchmarkModel,bc as benchmarkModelAsync,yc as benchmarkText,Qo as bitsPerToken,Fs as buildBatches,Ss as buildChunks,is as buildDeltaLearnPayload,Vc as buildLimbicBlock,dl as buildMlHeadDelta,Bc as buildVideoSequence,Nt as bytesToBase64,ci as candidateEngines,B as cdiv,ot as clampDim,yt as clampLimbicDim,ai as clampRatio,Oc as clampState,Co as clearTape,ka as codestralMambaAdapter,wc as compareModels,Jo as compareReports,Na as compileLimbicState,Xr as computeRowDelta,oa as configJson,an as corpusToSequences,di as cosine,Es as cpuDimsFor,ks as cpuModelBackward,xs as cpuModelForward,Sc as cpuModelLoss,vs as cpuWeightsFromNamed,Dt as crc32,$ as createBindGroup,R as createComputePipeline,S as createEmptyStorageBuffer,pl as createMlRegistry,Q as createStorageBuffer,z as createUniformBuffer,Kr as crossEntropyGrad,ke as crossEntropyLoss,zi as curateExperience,hl as curatePendingExperience,fl as curationRecords,ji as curationStands,cs as decodeDeltaPayload,hn as deltaTargetMismatch,ls as deltaUnusableReason,Ne as dequantizeFp16,yo as dequantizeInt8,cc as dequantizeInt8PerChannel,tt as deserializeRowDelta,Qr as diffCheckpoints,Y as dispatchColumnSlice,I as dispatchKernel,jn as dot,tl as dueSkills,he as elementLabel,At as emptySnapshot,fc as enableGrad,fe as engineKey,lc as estimateMemory,bn as evermindTensorSpec,ma as executePortPlan,rl as experienceCorpus,Rt as experienceDocuments,ol as experienceOverview,Pi as experienceQualityExamples,Ci as experienceQualityInputs,qn as experienceQualityLabel,gl as experienceRunMetrics,Pc as exportEvermind,vr as exportGguf,wr as exportOnnx,pr as exportSafetensors,si as extractFeatureMatrix,In as extractFeatures,ba as falconMambaAdapter,ki as fitAnomalyComposite,Si as fitClassical,Ht as fitEwma,Ei as fitGbm,Mi as fitIsolationForest,bi as fitKMeans,ui as fitKnn,_i as fitLinear,gi as fitLogistic,fi as fitNaiveBayes,Ut as fitRobustZ,Vi as fitRunAnomaly,Cn as flattenParams,et as floatToFp16,Ea as foreignMambaAdapterFor,kc as formatAdaptationCostReport,Ft as fp16ToFloat,_c as fp16View,me as gaussianArray,Cc as generateImage,Ds as generateVideo,sa as generationConfigJson,en as headCheckpoint,tn as headParams,Kc as homeostasis,Nc as importEvermind,ua as importEvermindTensors,da as inferArchFromTensors,Qi as initWebGPU,Ja as isDue,Er as isIrreversibleLabel,Jc as limbicAffectPredictor,Ga as limbicHead,Dn as limbicSetpoints,Ue as linearBackward,Ee as linearForward,ml as localSuccessExamples,Ri as localSuccessFeatures,Hi as localSuccessLabel,ar as logProbOfToken,ne as logScale,Ln as mamba1Adapter,_s as mamba1CpuBackward,pn as mamba1CpuForward,wa as mambaAdapter,zc as mambaConfigFromTensors,Lc as meanEvalLoss,Hc as meanLimbicSetpoints,ds as mergeCheckpointDiffs,us as mergeCheckpointDiffsGated,ul as mergeMlHeadDeltas,Un as minScaleAt,On as mlEvalLoss,al as mlHeadEntry,il as mlHeadParams,un as mlHeadTarget,Go as mlHeadUnusableReason,ia as modelCardMarkdown,zt as namedTensors,ys as namedWeights,Ya as needsApproval,vt as neutralLimbicState,Ba as neutralState,qa as newExperienceId,mc as noGrad,kn as normaliseSourceName,nl as packDocuments,cl as packageMlHead,wn as paramCount,As as paramMatrixShape,Mc as parseDeltaLearnPayload,Dr as parseSnapshot,Yo as perplexity,Uc as personalitySetpoint,Sa as portForeignMamba,$c as portForeignMambaSafetensors,gs as quantizeBase,Pe as quantizeFp16,wo as quantizeInt8,ic as quantizeInt8PerChannel,oo as randn,de as readBuffer,gc as recordOperation,Ca as recordToState,jc as resizePortedVocab,Hr as rmsNormBackward,Ur as rmsNormForward,qr as roundFp16,Ki as runAnomalyFeatures,li as runMlTask,xn as safetensorsToTensors,Tt as serializeRowDelta,Xt as setInitSeed,ze as sigmoid,Jt as silu,Zt as siluGrad,Sr as slug,ve as softmax,Eo as softplus,pi as solveLinearSystem,Fn as stateToRecord,Cs as tensorsToSafetensors,Pa as thalamusGate,ws as toNamedGrads,cn as tokenWindows,aa as tokenizerJson,Vo as topKIndices,vc as trainAndBenchmark,Bi as trainMlTask,el as trainOnce,we as uploadBuffer,oe as verifyCrcTrailer,ll as withPackageMlHead,bs as zeroCpuModelGrads,ps as zeroMamba1Grads};
