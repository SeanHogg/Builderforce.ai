var on=Object.defineProperty;var an=(o,e,t)=>e in o?on(o,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):o[e]=t;var _=(o,e,t)=>an(o,typeof e!="symbol"?e+"":e,t);const be=globalThis;var ur;const sn=((ur=be.GPUBufferUsage)==null?void 0:ur.UNIFORM)??64;var hr;const gr=((hr=be.GPUBufferUsage)==null?void 0:hr.STORAGE)??128;var fr;const _r=((fr=be.GPUBufferUsage)==null?void 0:fr.COPY_SRC)??4;var mr;const je=((mr=be.GPUBufferUsage)==null?void 0:mr.COPY_DST)??8;var pr;const dn=((pr=be.GPUBufferUsage)==null?void 0:pr.MAP_READ)??1;class cn{constructor(e){_(this,"device");_(this,"_free",new Map);this.device=e}_key(e,t){return`${e}:${t}`}acquire(e,t){const n=this._free.get(this._key(e,t));return(n==null?void 0:n.pop())??this.device.createBuffer({size:e,usage:t})}release(e,t,n){const r=this._key(t,n);let a=this._free.get(r);a||(a=[],this._free.set(r,a)),a.push(e)}get freeCount(){let e=0;for(const t of this._free.values())e+=t.length;return e}clear(){for(const e of this._free.values())for(const t of e)t.destroy();this._free.clear()}}const St=new WeakMap;function ln(o){let e=St.get(o);return e||(e=new cn(o),St.set(o,e)),e}async function ss(o={}){if(typeof navigator>"u"||!navigator.gpu)throw new Error("WebGPU is not available in this environment. Use Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled.");const e=await navigator.gpu.requestAdapter({powerPreference:o.powerPreference??"high-performance"});if(!e)throw new Error("Failed to acquire a GPUAdapter. Your GPU may not support WebGPU.");const t=e.limits,n=3*1024*1024*1024,r=await e.requestDevice({requiredLimits:{maxBufferSize:Math.min(n,t.maxBufferSize),maxStorageBufferBindingSize:Math.min(n,t.maxStorageBufferBindingSize),maxComputeInvocationsPerWorkgroup:Math.min(256,t.maxComputeInvocationsPerWorkgroup)}});return r.lost.then(a=>{console.error("WebGPU device lost:",a.message)}),{device:r,adapter:e}}function J(o,e,t=!1){const n=e instanceof Float32Array||e instanceof Uint32Array?e:new Float32Array(e),r=gr|je|(t?_r:0),a=o.createBuffer({size:n.byteLength,usage:r,mappedAtCreation:!0});return n instanceof Uint32Array?new Uint32Array(a.getMappedRange()).set(n):new Float32Array(a.getMappedRange()).set(n),a.unmap(),a}function B(o,e,t=!1){const n=gr|je|(t?_r:0);return o.createBuffer({size:e,usage:n})}function W(o,e){const t=ArrayBuffer.isView(e)?e.buffer:e,n=o.createBuffer({size:t.byteLength,usage:sn|je,mappedAtCreation:!0});return new Uint8Array(n.getMappedRange()).set(new Uint8Array(t)),n.unmap(),n}async function de(o,e,t){var c;const n=((c=be.GPUMapMode)==null?void 0:c.READ)??1,r=dn|je,a=ln(o),s=a.acquire(t,r),d=o.createCommandEncoder();d.copyBufferToBuffer(e,0,s,0,t),o.queue.submit([d.finish()]),await s.mapAsync(n);const i=new Float32Array(s.getMappedRange().slice(0));return s.unmap(),a.release(s,t,r),i}function ge(o,e,t,n=0){o.queue.writeBuffer(e,n,t.buffer,t.byteOffset,t.byteLength)}function O(o,e,t){const n=o.createShaderModule({code:e});return o.createComputePipeline({layout:"auto",compute:{module:n,entryPoint:t}})}function I(o,e,t,n=0){const r=t.map((a,s)=>({binding:s,resource:{buffer:a}}));return o.createBindGroup({layout:e.getBindGroupLayout(n),entries:r})}function z(o,e,t,n){const r=o.createCommandEncoder(),a=r.beginComputePass();a.setPipeline(e),a.setBindGroup(0,t),a.dispatchWorkgroups(...n),a.end(),o.queue.submit([r.finish()])}function C(o,e){return Math.ceil(o/e)}const Et=`

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
`,is=`

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
`;class ne{constructor(e){_(this,"_s");this._s=e>>>0||1}next(){return this._s=Math.imul(1664525,this._s)+1013904223>>>0,this._s/4294967296}}let ot=Math.random;function Bt(o){if(o==null)ot=Math.random;else{const e=new ne(o);ot=()=>e.next()}}function un(o=1,e=ot){const t=Math.max(e(),1e-12),n=e();return o*Math.sqrt(-2*Math.log(t))*Math.cos(2*Math.PI*n)}function we(o,e,t){const n=new Float32Array(o);for(let r=0;r<o;r++)n[r]=un(e,t);return n}const ft=`

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
`,ds=`

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
`,Ee=`

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
`,cs=`

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
`,_e=`

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
`,ls=`
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
`,us=`
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
`,hs=`

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
`,Re=`
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
`,Oe="col_slice";function Q(o,e,t,n,r,a,s,d){const i=W(o,new Uint32Array([r,a,s,d]).buffer),c=I(o,e,[i,t,n]);z(o,e,c,[C(r*d,256),1,1]),i.destroy()}const hn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] * b[i]; }
}
`,fn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class mn{constructor(e,t){_(this,"layerType","mamba1");_(this,"device");_(this,"config");_(this,"dInner");_(this,"dtRank");_(this,"wInProj");_(this,"bInProj");_(this,"wConv");_(this,"bConv");_(this,"wXProj");_(this,"bXProj");_(this,"wDtProj");_(this,"bDtProj");_(this,"A_log");_(this,"D_vec");_(this,"wOutProj");_(this,"bOutProj");_(this,"normWeight");_(this,"gpuWeights");_(this,"pipelines");_(this,"_wslaMode",!1);this.device=e,this.config={dState:16,dConv:4,expand:2,biasConv:!0,dtRank:Math.ceil(t.dModel/16),...t};const{dModel:n,expand:r}=this.config;this.dInner=r*n,this.dtRank=t.dtRank??Math.ceil(n/16),this.wInProj=new Float32Array(0),this.bInProj=new Float32Array(0),this.wConv=new Float32Array(0),this.bConv=new Float32Array(0),this.wXProj=new Float32Array(0),this.bXProj=new Float32Array(0),this.wDtProj=new Float32Array(0),this.bDtProj=new Float32Array(0),this.A_log=new Float32Array(0),this.D_vec=new Float32Array(0),this.wOutProj=new Float32Array(0),this.bOutProj=new Float32Array(0),this.normWeight=new Float32Array(0),this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:n}=this.config,r=this.dInner,a=t,s=n,d=this.dtRank,i=(l,h=.02)=>we(l,h),c=l=>new Float32Array(l),u=l=>new Float32Array(l).fill(1);this.wInProj=i(2*r*e),this.bInProj=c(2*r),this.wConv=i(r*s,.01),this.bConv=c(r),this.wXProj=i((d+2*a)*r,.01),this.bXProj=c(d+2*a),this.wDtProj=i(r*d,.02),this.bDtProj=c(r),this.A_log=new Float32Array(r*a);for(let l=0;l<r;l++)for(let h=0;h<a;h++)this.A_log[l*a+h]=Math.log(h+1);this.D_vec=u(r),this.wOutProj=i(e*r,.02),this.bOutProj=c(e),this.normWeight=u(e),this._uploadWeightsToGPU()}_uploadWeightsToGPU(){const e=this.device,t=n=>J(e,n,!0);this.gpuWeights={wInProj:t(this.wInProj),bInProj:t(this.bInProj),wConv:t(this.wConv),bConv:t(this.bConv),wXProj:t(this.wXProj),bXProj:t(this.bXProj),wDtProj:t(this.wDtProj),bDtProj:t(this.bDtProj),A_log:t(this.A_log),D_vec:t(this.D_vec),wOutProj:t(this.wOutProj),bOutProj:t(this.bOutProj),normWeight:t(this.normWeight)}}_buildPipelines(){const e=this.device;this.pipelines={linear:O(e,Ee,"linear_forward"),conv1d:O(e,ft,"conv1d_forward"),silu:O(e,_e,"silu_forward"),rmsnorm:O(e,_e,"rmsnorm_forward"),scan_fwd:O(e,Et,"forward_scan"),scan_reduce:O(e,Et,"forward_reduce"),colSlice:O(e,Re,Oe),elMul:O(e,hn,"main"),elAdd:O(e,fn,"main")}}forward(e,t,n){const r=this.device,{dModel:a,dState:s,dConv:d}=this.config,i=this.dInner,c=s,u=t,l=n,h=u*l,m=this.dtRank,f={},g=B(r,h*a*4,!0),p=B(r,h*4,!0);f.normInv=p,f.normIn=e;{const x=new ArrayBuffer(16);new Uint32Array(x,0,2).set([h,a]),new Float32Array(x,8,1).set([1e-6]);const A=W(r,x),E=I(r,this.pipelines.rmsnorm,[A,e,this.gpuWeights.normWeight,g,p]);z(r,this.pipelines.rmsnorm,E,[C(h,64),1,1])}const w=B(r,h*2*i*4,!0);f.normOut=g;{const x=new Uint32Array([h,a,2*i]).buffer,A=W(r,x),E=I(r,this.pipelines.linear,[A,g,this.gpuWeights.wInProj,this.gpuWeights.bInProj,w]);z(r,this.pipelines.linear,E,[C(h,16),C(2*i,16),1])}const v=B(r,h*i*4,!0),b=B(r,h*i*4,!0);{const x=this.pipelines.colSlice;Q(r,x,w,v,h,2*i,0,i),Q(r,x,w,b,h,2*i,i,i)}w.destroy(),f.zBuf=b,f.xConvIn=v;const y=B(r,h*i*4,!0);f.convOut=y;{const x=new Uint32Array([l,i,d,u,1]).buffer,A=W(r,x),E=I(r,this.pipelines.conv1d,[A,v,this.gpuWeights.wConv,this.gpuWeights.bConv,y]);z(r,this.pipelines.conv1d,E,[C(l,16),C(i,16),u])}const k=B(r,h*i*4,!0);f.siluOut=k;{const x=new Uint32Array([h*i]).buffer,A=W(r,x),E=I(r,this.pipelines.silu,[A,y,k]);z(r,this.pipelines.silu,E,[C(h*i,256),1,1])}const S=B(r,h*(m+2*c)*4,!0);{const x=new Uint32Array([h,i,m+2*c]).buffer,A=W(r,x),E=I(r,this.pipelines.linear,[A,k,this.gpuWeights.wXProj,this.gpuWeights.bXProj,S]);z(r,this.pipelines.linear,E,[C(h,16),C(m+2*c,16),1])}const N=B(r,h*m*4,!0),L=B(r,u*l*c*4,!0),D=B(r,u*l*c*4,!0);{const x=m+2*c,A=this.pipelines.colSlice;Q(r,A,S,N,h,x,0,m),Q(r,A,S,L,h,x,m,c),Q(r,A,S,D,h,x,m+c,c)}S.destroy(),f.B_raw=L,f.C_raw=D;const P=B(r,h*i*4,!0);f.deltaFull=P;{const x=new Uint32Array([h,m,i]).buffer,A=W(r,x),E=I(r,this.pipelines.linear,[A,N,this.gpuWeights.wDtProj,this.gpuWeights.bDtProj,P]);z(r,this.pipelines.linear,E,[C(h,16),C(i,16),1])}N.destroy();const U=B(r,u*l*i*4,!0),G=B(r,2*u*l*i*c*4,!0);f.hCache=G;{const x=new Uint32Array([l,c,i,u]).buffer,A=W(r,x),E=I(r,this.pipelines.scan_fwd,[A,k,P,this.gpuWeights.A_log,L,D,this.gpuWeights.D_vec,U,G]);z(r,this.pipelines.scan_fwd,E,[i,c,u]);const j=I(r,this.pipelines.scan_reduce,[A,k,P,this.gpuWeights.A_log,L,D,this.gpuWeights.D_vec,U,G]);z(r,this.pipelines.scan_reduce,j,[C(l,64),i,u])}const H=B(r,h*i*4,!0),R=B(r,h*i*4,!0);{const x=W(r,new Uint32Array([h*i]).buffer),A=I(r,this.pipelines.silu,[x,b,H]);z(r,this.pipelines.silu,A,[C(h*i,256),1,1]);const E=W(r,new Uint32Array([h*i]).buffer),j=I(r,this.pipelines.elMul,[U,H,R,E]);z(r,this.pipelines.elMul,j,[C(h*i,256),1,1])}H.destroy(),U.destroy();const K=B(r,h*a*4,!0);{const x=new Uint32Array([h,i,a]).buffer,A=W(r,x),E=I(r,this.pipelines.linear,[A,R,this.gpuWeights.wOutProj,this.gpuWeights.bOutProj,K]);z(r,this.pipelines.linear,E,[C(h,16),C(a,16),1])}R.destroy();const M=B(r,h*a*4,!0);{const x=W(r,new Uint32Array([h*a]).buffer),A=I(r,this.pipelines.elAdd,[K,e,M,x]);z(r,this.pipelines.elAdd,A,[C(h*a,256),1,1])}return K.destroy(),{output:M,cache:f}}parameters(){const{dModel:e,dState:t,dConv:n}=this.config,r=this.dInner,a=t,s=n,d=this.dtRank;return[{buf:this.gpuWeights.wInProj,numel:2*r*e,name:"wInProj"},{buf:this.gpuWeights.bInProj,numel:2*r,name:"bInProj"},{buf:this.gpuWeights.wConv,numel:r*s,name:"wConv"},{buf:this.gpuWeights.bConv,numel:r,name:"bConv"},{buf:this.gpuWeights.wXProj,numel:(d+2*a)*r,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:d+2*a,name:"bXProj"},{buf:this.gpuWeights.wDtProj,numel:r*d,name:"wDtProj"},{buf:this.gpuWeights.bDtProj,numel:r,name:"bDtProj"},{buf:this.gpuWeights.A_log,numel:r*a,name:"A_log"},{buf:this.gpuWeights.D_vec,numel:r,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*r,name:"wOutProj"},{buf:this.gpuWeights.bOutProj,numel:e,name:"bOutProj"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wXProj,numel:this.wXProj.length,name:"wXProj"},{buf:this.gpuWeights.bXProj,numel:this.bXProj.length,name:"bXProj"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const pn=`
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
`,fs=`
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
`,gn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class _n{constructor(e,t){_(this,"layerType","mamba2");_(this,"device");_(this,"config");_(this,"dInner");_(this,"dHead");_(this,"gpuWeights");_(this,"pipelines");_(this,"_wslaMode",!1);this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,...t};const{dModel:n,expand:r,nHeads:a}=this.config;if(this.dInner=r*n,this.dHead=this.dInner/a,this.dInner%a!==0)throw new Error(`Mamba2Block: dInner (${this.dInner}) must be divisible by nHeads (${a}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dState:t,dConv:n,nHeads:r,nGroups:a}=this.config,s=this.dInner,d=t,i=n,c=r,u=a,l=(p,w=.02)=>we(p,w),h=p=>new Float32Array(p),m=p=>new Float32Array(p).fill(1),f=s+2*u*d+c,g=p=>J(this.device,p,!0);this.gpuWeights={wInProj:g(l(f*e)),wConv:g(l((s+2*u*d)*i,.01)),bConv:g(h(s+2*u*d)),A_log:g(new Float32Array(c).fill(Math.log(1))),dt_bias:g(h(c)),D_vec:g(m(c)),wOutProj:g(l(e*s,.02)),normWeight:g(m(s)),preNormWeight:g(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:O(e,Ee,"linear_forward"),conv1d:O(e,ft,"conv1d_forward"),colSlice:O(e,Re,Oe),rmsnorm:O(e,_e,"rmsnorm_forward"),ssd_fwd:O(e,pn,"ssd_chunk_forward"),elAdd:O(e,gn,"main")}}forward(e,t,n){const r=this.device,{dModel:a,dState:s,dConv:d,nHeads:i,nGroups:c,chunkLen:u}=this.config,l=this.dInner,h=s,m=d,f=i,g=c,p=this.dHead,w=t,v=n,b=w*v,y=l+2*g*h,k=Math.ceil(v/u),S=B(r,b*a*4,!0),N=B(r,b*4,!0);{const T=new ArrayBuffer(16);new Uint32Array(T,0,2).set([b,a]),new Float32Array(T,8,1).set([1e-6]);const F=W(r,T),q=I(r,this.pipelines.rmsnorm,[F,e,this.gpuWeights.preNormWeight,S,N]);z(r,this.pipelines.rmsnorm,q,[C(b,64),1,1])}N.destroy();const L=l+2*g*h+f,D=B(r,b*L*4,!0);{const T=new Uint32Array([b,a,L]).buffer,F=W(r,T),q=J(r,new Float32Array(L),!0),Z=I(r,this.pipelines.linear,[F,S,this.gpuWeights.wInProj,q,D]);z(r,this.pipelines.linear,Z,[C(b,16),C(L,16),1]),q.destroy()}S.destroy();const P=B(r,b*y*4,!0),U=B(r,b*f*4,!0);{const T=this.pipelines.colSlice,F=y+f;Q(r,T,D,P,b,F,0,y),Q(r,T,D,U,b,F,y,f)}D.destroy();const G=B(r,b*y*4,!0);{const T=new Uint32Array([v,y,m,w,1]).buffer,F=W(r,T),q=I(r,this.pipelines.conv1d,[F,P,this.gpuWeights.wConv,this.gpuWeights.bConv,G]);z(r,this.pipelines.conv1d,q,[C(v,16),C(y,16),w])}P.destroy();const H=B(r,b*l*4,!0),R=B(r,b*g*h*4,!0),K=B(r,b*g*h*4,!0);{const T=this.pipelines.colSlice;Q(r,T,G,H,b,y,0,l),Q(r,T,G,R,b,y,l,g*h),Q(r,T,G,K,b,y,l+g*h,g*h)}G.destroy();const M=B(r,(k+1)*w*f*h*p*4,!0),x=B(r,b*l*4,!0);{const T=new Uint32Array([v,l,f,p,g,h,u,k,w]).buffer,F=W(r,T),q=I(r,this.pipelines.ssd_fwd,[F,H,R,K,U,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,x,M]);z(r,this.pipelines.ssd_fwd,q,[k,f,w])}H.destroy(),R.destroy(),K.destroy(),U.destroy();const A=B(r,b*l*4,!0),E=B(r,b*4,!0);{const T=new ArrayBuffer(16);new Uint32Array(T,0,2).set([b,l]),new Float32Array(T,8,1).set([1e-6]);const F=W(r,T),q=I(r,this.pipelines.rmsnorm,[F,x,this.gpuWeights.normWeight,A,E]);z(r,this.pipelines.rmsnorm,q,[C(b,64),1,1])}x.destroy(),E.destroy();const j=B(r,b*a*4,!0);{const T=new Uint32Array([b,l,a]).buffer,F=W(r,T),q=J(r,new Float32Array(a),!0),Z=I(r,this.pipelines.linear,[F,A,this.gpuWeights.wOutProj,q,j]);z(r,this.pipelines.linear,Z,[C(b,16),C(a,16),1]),q.destroy()}A.destroy();const V=B(r,b*a*4,!0);{const T=W(r,new Uint32Array([b*a]).buffer),F=I(r,this.pipelines.elAdd,[j,e,V,T]);z(r,this.pipelines.elAdd,F,[C(b*a,256),1,1])}return j.destroy(),{output:V,cache:{stateCarry:M}}}parameters(){const{dModel:e,dState:t,dConv:n,nHeads:r,nGroups:a}=this.config,s=this.dInner,d=t,i=n,c=r,u=a,l=s+2*u*d;return[{buf:this.gpuWeights.wInProj,numel:(s+2*u*d+c)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:l*i,name:"wConv"},{buf:this.gpuWeights.bConv,numel:l,name:"bConv"},{buf:this.gpuWeights.A_log,numel:c,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:c,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:c,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*s,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:s,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.config.dState*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const bn=`
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
`,ms=`
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
`,wn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`;class yn{constructor(e,t){_(this,"layerType","mamba3");_(this,"device");_(this,"config");_(this,"dInner");_(this,"dHead");_(this,"nComplex");_(this,"gpuWeights");_(this,"pipelines");_(this,"_wslaMode",!1);this.device=e,this.config={dState:16,dConv:4,expand:2,nGroups:1,chunkLen:256,mimoGroup:1,...t};const{dModel:n,expand:r,nHeads:a}=this.config;if(this.dInner=r*n,this.dHead=this.dInner/a,this.nComplex=this.config.dState,this.dInner%a!==0)throw new Error(`Mamba3Block: dInner (${this.dInner}) must be divisible by nHeads (${a}).`);this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,dConv:t,nHeads:n,nGroups:r}=this.config,a=this.dInner,s=this.nComplex,d=t,i=n,c=r,u=a+2*c*s*2,l=(w,v=.02)=>we(w,v),h=w=>new Float32Array(w),m=w=>new Float32Array(w).fill(1),f=new Float32Array(i*2);for(let w=0;w<i;w++)f[w*2+0]=0,f[w*2+1]=2*Math.PI*w/i;const g=w=>J(this.device,w,!0),p=a+2*c*s*2+i;this.gpuWeights={wInProj:g(l(p*e)),wConv:g(l(u*d,.01)),bConv:g(h(u)),A_log:g(f),dt_bias:g(h(i)),D_vec:g(m(i)),wOutProj:g(l(e*a,.02)),normWeight:g(m(a)),preNormWeight:g(m(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:O(e,Ee,"linear_forward"),conv1d:O(e,ft,"conv1d_forward"),colSlice:O(e,Re,Oe),rmsnorm:O(e,_e,"rmsnorm_forward"),cssd_fwd:O(e,bn,"complex_ssd_forward"),elAdd:O(e,wn,"main")}}forward(e,t,n){const r=this.device,{dModel:a,dConv:s,nHeads:d,nGroups:i,chunkLen:c}=this.config,u=this.dInner,l=this.nComplex,h=s,m=d,f=i,g=this.dHead,p=t,w=n,v=p*w,b=u+2*f*l*2,y=Math.ceil(w/c),k=B(r,v*a*4,!0),S=B(r,v*4,!0);{const $=new ArrayBuffer(16);new Uint32Array($,0,2).set([v,a]),new Float32Array($,8,1).set([1e-6]);const T=W(r,$),F=I(r,this.pipelines.rmsnorm,[T,e,this.gpuWeights.preNormWeight,k,S]);z(r,this.pipelines.rmsnorm,F,[C(v,64),1,1])}S.destroy();const N=u+2*f*l*2+m,L=B(r,v*N*4,!0);{const $=new Uint32Array([v,a,N]).buffer,T=W(r,$),F=J(r,new Float32Array(N),!0),q=I(r,this.pipelines.linear,[T,k,this.gpuWeights.wInProj,F,L]);z(r,this.pipelines.linear,q,[C(v,16),C(N,16),1]),F.destroy()}k.destroy();const D=B(r,v*b*4,!0),P=B(r,v*m*4,!0);{const $=this.pipelines.colSlice,T=b+m;Q(r,$,L,D,v,T,0,b),Q(r,$,L,P,v,T,b,m)}L.destroy();const U=B(r,v*b*4,!0);{const $=new Uint32Array([w,b,h,p,1]).buffer,T=W(r,$),F=I(r,this.pipelines.conv1d,[T,D,this.gpuWeights.wConv,this.gpuWeights.bConv,U]);z(r,this.pipelines.conv1d,F,[C(w,16),C(b,16),p])}D.destroy();const G=B(r,v*u*4,!0),H=B(r,v*f*l*2*4,!0),R=B(r,v*f*l*2*4,!0);{const $=this.pipelines.colSlice;Q(r,$,U,G,v,b,0,u),Q(r,$,U,H,v,b,u,f*l*2),Q(r,$,U,R,v,b,u+f*l*2,f*l*2)}U.destroy();const K=B(r,(y+1)*p*m*l*2*g*4,!0),M=B(r,v*u*4,!0);{const $=new Uint32Array([w,u,m,g,f,l,c,y,p]).buffer,T=W(r,$),F=I(r,this.pipelines.cssd_fwd,[T,G,H,R,P,this.gpuWeights.A_log,this.gpuWeights.dt_bias,this.gpuWeights.D_vec,M,K]);z(r,this.pipelines.cssd_fwd,F,[y,m,p])}G.destroy(),H.destroy(),R.destroy(),P.destroy();const x=B(r,v*u*4,!0),A=B(r,v*4,!0);{const $=new ArrayBuffer(16);new Uint32Array($,0,2).set([v,u]),new Float32Array($,8,1).set([1e-6]);const T=W(r,$),F=I(r,this.pipelines.rmsnorm,[T,M,this.gpuWeights.normWeight,x,A]);z(r,this.pipelines.rmsnorm,F,[C(v,64),1,1])}M.destroy(),A.destroy();const E=B(r,v*a*4,!0);{const $=new Uint32Array([v,u,a]).buffer,T=W(r,$),F=J(r,new Float32Array(a),!0),q=I(r,this.pipelines.linear,[T,x,this.gpuWeights.wOutProj,F,E]);z(r,this.pipelines.linear,q,[C(v,16),C(a,16),1]),F.destroy()}x.destroy();const j=B(r,v*a*4,!0);{const $=W(r,new Uint32Array([v*a]).buffer),T=I(r,this.pipelines.elAdd,[E,e,j,$]);z(r,this.pipelines.elAdd,T,[C(v*a,256),1,1])}return E.destroy(),{output:j,cache:{stateCarry:K}}}parameters(){const{dModel:e,dConv:t,nHeads:n,nGroups:r}=this.config,a=this.dInner,s=this.nComplex,d=t,i=n,c=r,u=a+2*c*s*2;return[{buf:this.gpuWeights.wInProj,numel:(a+2*c*s*2+i)*e,name:"wInProj"},{buf:this.gpuWeights.wConv,numel:u*d,name:"wConv"},{buf:this.gpuWeights.bConv,numel:u,name:"bConv"},{buf:this.gpuWeights.A_log,numel:i*2,name:"A_log"},{buf:this.gpuWeights.dt_bias,numel:i,name:"dt_bias"},{buf:this.gpuWeights.D_vec,numel:i,name:"D_vec"},{buf:this.gpuWeights.wOutProj,numel:e*a,name:"wOutProj"},{buf:this.gpuWeights.normWeight,numel:a,name:"normWeight"},{buf:this.gpuWeights.preNormWeight,numel:e,name:"preNormWeight"}]}getTrainableParams(){return this._wslaMode?[{buf:this.gpuWeights.wInProj,numel:this.config.nGroups*this.nComplex*2*2*this.config.dModel,name:"wInProj_BC"}]:this.parameters()}setWSLAMode(e){this._wslaMode=e}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}const vn=`
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
`,Dt=`
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
`,ps=`
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
`,xn=`
@group(0) @binding(0) var<storage, read>       a : array<f32>;
@group(0) @binding(1) var<storage, read>       b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;
@group(0) @binding(3) var<uniform>             n : u32;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i < n) { c[i] = a[i] + b[i]; }
}
`,kn=`
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
`;class An{constructor(e,t){_(this,"layerType","attention");_(this,"device");_(this,"config");_(this,"dHead");_(this,"gpuWeights");_(this,"pipelines");if(this.device=e,t.dModel%t.nHeads!==0)throw new Error(`AttentionBlock: dModel (${t.dModel}) must be divisible by nHeads (${t.nHeads}).`);this.config={dHead:t.dModel/t.nHeads,hasFfn:!1,ffnMult:4,...t},this.dHead=this.config.dHead,this.gpuWeights={},this.pipelines={},this._initWeights(),this._buildPipelines()}_initWeights(){const{dModel:e,hasFfn:t,ffnMult:n}=this.config,r=(i,c=.02)=>we(i,c),a=i=>new Float32Array(i),s=i=>new Float32Array(i).fill(1),d=i=>J(this.device,i,!0);if(this.gpuWeights={wQKV:d(r(3*e*e)),bQKV:d(a(3*e)),wO:d(r(e*e)),bO:d(a(e)),normWeight:d(s(e))},t){const i=e*n;this.gpuWeights.wFfn1=d(r(i*e)),this.gpuWeights.bFfn1=d(a(i)),this.gpuWeights.wFfn2=d(r(e*i)),this.gpuWeights.bFfn2=d(a(e))}}_buildPipelines(){const e=this.device;this.pipelines={linear:O(e,Ee,"linear_forward"),rmsnorm:O(e,_e,"rmsnorm_forward"),attn_fwd:O(e,Dt,"attention_forward"),attn_val:O(e,Dt,"attention_value"),softmax:O(e,vn,"softmax_forward"),colSlice:O(e,Re,Oe),elAdd:O(e,xn,"main")},this.config.hasFfn&&(this.pipelines.silu=O(e,kn,"silu_forward"))}forward(e,t,n){const r=this.device,{dModel:a,nHeads:s,hasFfn:d}=this.config,i=this.dHead,c=t,u=n,l=c*u,h=s,m=B(r,l*a*4,!0),f=B(r,l*4,!0);{const L=new ArrayBuffer(16);new Uint32Array(L,0,2).set([l,a]),new Float32Array(L,8,1).set([1e-6]);const D=W(r,L),P=I(r,this.pipelines.rmsnorm,[D,e,this.gpuWeights.normWeight,m,f]);z(r,this.pipelines.rmsnorm,P,[C(l,64),1,1])}f.destroy();const g=B(r,l*3*a*4,!0);{const L=new Uint32Array([l,a,3*a]).buffer,D=W(r,L),P=I(r,this.pipelines.linear,[D,m,this.gpuWeights.wQKV,this.gpuWeights.bQKV,g]);z(r,this.pipelines.linear,P,[C(l,16),C(3*a,16),1])}m.destroy();const p=B(r,l*a*4,!0),w=B(r,l*a*4,!0),v=B(r,l*a*4,!0);{const L=this.pipelines.colSlice;Q(r,L,g,p,l,3*a,0,a),Q(r,L,g,w,l,3*a,a,a),Q(r,L,g,v,l,3*a,2*a,a)}g.destroy();const b=B(r,c*h*u*u*4,!0);{const L=new Uint32Array([c,u,a,h,i]).buffer,D=W(r,L),P=I(r,this.pipelines.attn_fwd,[D,p,w,v,b,B(r,l*a*4,!0)]);z(r,this.pipelines.attn_fwd,P,[C(u,16),h,c])}{const L=new Uint32Array([u,u,1]).buffer,D=W(r,L),P=I(r,this.pipelines.softmax,[D,b]);z(r,this.pipelines.softmax,P,[u,h,c])}const y=B(r,l*a*4,!0);{const L=new Uint32Array([c,u,a,h,i]).buffer,D=W(r,L),P=I(r,this.pipelines.attn_val,[D,p,w,v,b,y]);z(r,this.pipelines.attn_val,P,[C(u,16),h,c])}p.destroy(),w.destroy(),v.destroy();const k=B(r,l*a*4,!0);{const L=new Uint32Array([l,a,a]).buffer,D=W(r,L),P=I(r,this.pipelines.linear,[D,y,this.gpuWeights.wO,this.gpuWeights.bO,k]);z(r,this.pipelines.linear,P,[C(l,16),C(a,16),1])}y.destroy();let S=B(r,l*a*4,!0);{const L=W(r,new Uint32Array([l*a]).buffer),D=I(r,this.pipelines.elAdd,[k,e,S,L]);z(r,this.pipelines.elAdd,D,[C(l*a,256),1,1])}if(k.destroy(),d){const{ffnMult:L}=this.config,D=a*L,P=B(r,l*D*4,!0);{const R=new Uint32Array([l,a,D]).buffer,K=W(r,R),M=I(r,this.pipelines.linear,[K,S,this.gpuWeights.wFfn1,this.gpuWeights.bFfn1,P]);z(r,this.pipelines.linear,M,[C(l,16),C(D,16),1])}const U=B(r,l*D*4,!0);{const R=W(r,new Uint32Array([l*D]).buffer),K=I(r,this.pipelines.silu,[R,P,U]);z(r,this.pipelines.silu,K,[C(l*D,256),1,1])}P.destroy();const G=B(r,l*a*4,!0);{const R=new Uint32Array([l,D,a]).buffer,K=W(r,R),M=I(r,this.pipelines.linear,[K,U,this.gpuWeights.wFfn2,this.gpuWeights.bFfn2,G]);z(r,this.pipelines.linear,M,[C(l,16),C(a,16),1])}U.destroy();const H=B(r,l*a*4,!0);{const R=W(r,new Uint32Array([l*a]).buffer),K=I(r,this.pipelines.elAdd,[G,S,H,R]);z(r,this.pipelines.elAdd,K,[C(l*a,256),1,1])}G.destroy(),S.destroy(),S=H}return{output:S,cache:{scores:b}}}parameters(){const{dModel:e,hasFfn:t,ffnMult:n}=this.config,r=[{buf:this.gpuWeights.wQKV,numel:3*e*e,name:"wQKV"},{buf:this.gpuWeights.bQKV,numel:3*e,name:"bQKV"},{buf:this.gpuWeights.wO,numel:e*e,name:"wO"},{buf:this.gpuWeights.bO,numel:e,name:"bO"},{buf:this.gpuWeights.normWeight,numel:e,name:"normWeight"}];if(t){const a=e*n;r.push({buf:this.gpuWeights.wFfn1,numel:a*e,name:"wFfn1"},{buf:this.gpuWeights.bFfn1,numel:a,name:"bFfn1"},{buf:this.gpuWeights.wFfn2,numel:e*a,name:"wFfn2"},{buf:this.gpuWeights.bFfn2,numel:e,name:"bFfn2"})}return r}getTrainableParams(){return this.parameters()}setWSLAMode(e){}destroy(){for(const e of Object.values(this.gpuWeights))e.destroy();this.gpuWeights={}}}function Ue(o){const e=new ArrayBuffer(4),t=new Float32Array(e),n=new Uint32Array(e);t[0]=o;const r=n[0],a=r>>>31&1,s=r>>>23&255,d=r&8388607;if(s===255)return a<<15|31744|(d?512:0);const i=s-127+15;if(i>=31)return a<<15|31744;if(i<=0){if(i<-10)return a<<15;const c=14-i;return a<<15|(d|8388608)>>c}return a<<15|i<<10|d>>13}function mt(o){const e=o>>>15&1,t=o>>>10&31,n=o&1023;if(t===0){const s=n/1024*Math.pow(2,-14);return e?-s:s}if(t===31)return e?-1/0:n?NaN:1/0;const r=t-15,a=(1+n/1024)*Math.pow(2,r);return e?-a:a}function Be(o){const e=new Uint16Array(o.length);for(let t=0;t<o.length;t++)e[t]=Ue(o[t]);return e}function De(o){const e=new Float32Array(o.length);for(let t=0;t<o.length;t++)e[t]=mt(o[t]);return e}function Mn(o){let e=0;for(let r=0;r<o.length;r++){const a=Math.abs(o[r]);a>e&&(e=a)}const t=e/127||1,n=new Int8Array(o.length);for(let r=0;r<o.length;r++)n[r]=Math.max(-128,Math.min(127,Math.round(o[r]/t)));return{data:n,scale:t}}function Ln(o,e){const t=new Float32Array(o.length);for(let n=0;n<o.length;n++)t[n]=o[n]*e;return t}function gs(o,e){const t=o.length/e,n=new Float32Array(e),r=new Int8Array(o.length);for(let a=0;a<e;a++){let s=0;const d=a*t;for(let i=0;i<t;i++){const c=Math.abs(o[d+i]);c>s&&(s=c)}n[a]=s/127||1;for(let i=0;i<t;i++)r[d+i]=Math.max(-128,Math.min(127,Math.round(o[d+i]/n[a])))}return{data:r,scales:n}}function _s(o,e,t){const n=o.length/t,r=new Float32Array(o.length);for(let a=0;a<t;a++){const s=a*n;for(let d=0;d<n;d++)r[s+d]=o[s+d]*e[a]}return r}function bs(o){return{fp32:o*4,fp16:o*2,int8:o*1}}const br=1380144709,at=8,Sn=(()=>{const o=new Uint32Array(256);for(let e=0;e<256;e++){let t=e;for(let n=0;n<8;n++)t=t&1?3988292384^t>>>1:t>>>1;o[e]=t>>>0}return o})();function pt(o){let e=4294967295;for(let t=0;t<o.length;t++)e=Sn[(e^o[t])&255]^e>>>8;return(e^4294967295)>>>0}function Ge(o){const e=new Uint8Array(o),t=new ArrayBuffer(e.length+at);new Uint8Array(t).set(e,0);const r=new DataView(t);return r.setUint32(e.length,br,!0),r.setUint32(e.length+4,pt(e),!0),t}function ce(o){if(o.byteLength<at)return{hasTrailer:!1,ok:!0,body:o};const e=new DataView(o),t=o.byteLength-at;if(e.getUint32(t,!0)!==br)return{hasTrailer:!1,ok:!0,body:o};const r=e.getUint32(t+4,!0),a=o.slice(0,t);return{hasTrailer:!0,ok:pt(new Uint8Array(a))===r,body:a}}const Ft=1296190035,En={mamba1:0,mamba2:1,mamba3:2,attention:3},Bn=["mamba1","mamba2","mamba3","attention"];class Dn{constructor(e,t){_(this,"device");_(this,"config");_(this,"gpuEmbedding");_(this,"layers");_(this,"layerSpecs");_(this,"gpuFinalNorm");_(this,"tiedEmbedding");_(this,"gpuLMHeadBias");_(this,"_lmHeadPipeline");_(this,"_rmsnormPipeline");_(this,"_embedPipeline");_(this,"_wslaMode",!1);this.device=e,this.config={dState:16,dConv:4,expand:2,nHeads:4,nGroups:1,chunkLen:256,mimoGroup:1,eosId:-1,defaultMamba1:{},defaultMamba2:{},defaultMamba3:{},defaultAttention:{},layers:void 0,seed:void 0,...t},Bt(this.config.seed);const n=t.layers??Array.from({length:t.numLayers},()=>({type:"mamba1"}));if(n.length!==t.numLayers)throw new Error(`HybridMambaModel: layers schedule length (${n.length}) must equal numLayers (${t.numLayers}).`);this.layerSpecs=n;const{vocabSize:r,dModel:a}=this.config,s=we(r*a,1/Math.sqrt(a));this.gpuEmbedding=J(e,s,!0),this.layers=n.map(d=>this._buildLayer(d)),Bt(void 0),this.gpuFinalNorm=J(e,new Float32Array(a).fill(1),!0),this.tiedEmbedding=!0,this.gpuLMHeadBias=J(e,new Float32Array(r),!0),this._lmHeadPipeline=O(e,Ee,"linear_forward"),this._rmsnormPipeline=O(e,_e,"rmsnorm_forward"),this._embedPipeline=O(e,Fn,"embed_lookup")}_buildLayer(e){const t=this.config;switch(e.type){case"mamba1":{const n={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,...t.defaultMamba1};return new mn(this.device,{...n,...e.config??{}})}case"mamba2":{const n={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,...t.defaultMamba2};return new _n(this.device,{...n,...e.config??{}})}case"mamba3":{const n={dModel:t.dModel,dState:t.dState,dConv:t.dConv,expand:t.expand,nHeads:t.nHeads,nGroups:t.nGroups,chunkLen:t.chunkLen,mimoGroup:t.mimoGroup,...t.defaultMamba3};return new yn(this.device,{...n,...e.config??{}})}case"attention":{const n={dModel:t.dModel,nHeads:t.nHeads,...t.defaultAttention};return new An(this.device,{...n,...e.config??{}})}}}embedTokens(e,t,n){const{dModel:r}=this.config,a=t*n,s=J(this.device,e instanceof Uint32Array?e:new Uint32Array(e),!1),d=B(this.device,a*r*4,!0),i=W(this.device,new Uint32Array([a,r]).buffer),c=I(this.device,this._embedPipeline,[i,s,this.gpuEmbedding,d]);return z(this.device,this._embedPipeline,c,[C(a,64),1,1]),s.destroy(),i.destroy(),d}async forward(e,t,n){const{dModel:r,vocabSize:a}=this.config,s=t*n;let d=this.embedTokens(e,t,n);const i=[];for(const m of this.layers){const{output:f,cache:g}=m.forward(d,t,n);i.push(g),d.destroy(),d=f}const c=B(this.device,s*r*4,!0),u=B(this.device,s*4,!1);{const m=new ArrayBuffer(16);new Uint32Array(m,0,2).set([s,r]),new Float32Array(m,8,1).set([1e-6]);const f=W(this.device,m),g=I(this.device,this._rmsnormPipeline,[f,d,this.gpuFinalNorm,c,u]);z(this.device,this._rmsnormPipeline,g,[C(s,64),1,1])}d.destroy();const l=B(this.device,s*a*4,!0);{const m=new Uint32Array([s,r,a]).buffer,f=W(this.device,m),g=I(this.device,this._lmHeadPipeline,[f,c,this.gpuEmbedding,this.gpuLMHeadBias,l]);z(this.device,this._lmHeadPipeline,g,[C(s,16),C(a,16),1])}return c.destroy(),u.destroy(),{logits:await de(this.device,l,s*a*4),gpuLogits:l,caches:i}}async embed(e){const{dModel:t}=this.config,n=e.length,r=1,a=r*n;if(a===0)return new Float32Array(t);let s=this.embedTokens(e,r,n);for(const h of this.layers){const{output:m}=h.forward(s,r,n);s.destroy(),s=m}const d=B(this.device,a*t*4,!0),i=B(this.device,a*4,!1);{const h=new ArrayBuffer(16);new Uint32Array(h,0,2).set([a,t]),new Float32Array(h,8,1).set([1e-6]);const m=W(this.device,h),f=I(this.device,this._rmsnormPipeline,[m,s,this.gpuFinalNorm,d,i]);z(this.device,this._rmsnormPipeline,f,[C(a,64),1,1])}s.destroy();const c=await de(this.device,d,a*t*4);d.destroy(),i.destroy();const u=new Float32Array(t);for(let h=0;h<n;h++){const m=h*t;for(let f=0;f<t;f++)u[f]+=c[m+f]}for(let h=0;h<t;h++)u[h]/=n;let l=0;for(let h=0;h<t;h++)l+=u[h]*u[h];l=Math.sqrt(l)||1;for(let h=0;h<t;h++)u[h]/=l;return u}async generate(e,t=200,n={}){const{temperature:r=1,topK:a=50,topP:s=.9}=n,{vocabSize:d}=this.config,i=[...e];for(let c=0;c<t;c++){const{logits:u}=await this.forward(new Uint32Array(i),1,i.length),l=u.slice((i.length-1)*d,i.length*d),h=Cn(l,{temperature:r,topK:a,topP:s});if(i.push(h),h===this.config.eosId)break}return i}parameters(){const e=[];e.push({buf:this.gpuEmbedding,numel:this.config.vocabSize*this.config.dModel,name:"embedding"});for(let t=0;t<this.layers.length;t++)for(const n of this.layers[t].parameters())e.push({...n,name:`layer${t}.${n.name}`});return e.push({buf:this.gpuFinalNorm,numel:this.config.dModel,name:"final_norm"}),e}getTrainableParams(){if(!this._wslaMode)return this.parameters();const e=[];for(let t=0;t<this.layers.length;t++)for(const n of this.layers[t].getTrainableParams())e.push({...n,name:`layer${t}.${n.name}`});return e}setWSLAMode(e){for(const t of this.layers)t.setWSLAMode(e);this._wslaMode=e}async exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.length,a=this.layers.length,s=await Promise.all(n.map(g=>de(this.device,g.buf,g.numel*4))),d=Math.ceil(a/4)*4,i=12+d+4+r*4,c=t?2:4,l=s.reduce((g,p)=>g+p.length,0)*c,h=new ArrayBuffer(i+l),m=new DataView(h);let f=0;m.setUint32(f,Ft,!0),f+=4,m.setUint32(f,t?3:2,!0),f+=4,m.setUint32(f,a,!0),f+=4;for(let g=0;g<a;g++){const p=this.layers[g].layerType;m.setUint8(f+g,En[p])}f+=d,m.setUint32(f,r,!0),f+=4;for(const g of n)m.setUint32(f,g.numel,!0),f+=4;if(t)for(const g of s){const p=Be(g);new Uint16Array(h,f,p.length).set(p),f+=p.length*2}else for(const g of s)new Float32Array(h,f,g.length).set(g),f+=g.byteLength;return Ge(h)}async loadWeights(e){const t=ce(e);if(t.hasTrailer&&!t.ok)throw new Error("Invalid weight file: failed CRC integrity check (corrupt or truncated).");const n=new DataView(e);let r=0;const a=n.getUint32(r,!0);if(r+=4,a!==Ft)throw new Error("Invalid weight file: bad magic number. Expected MBJS file.");const s=n.getUint32(r,!0);if(r+=4,s===1){const d=n.getUint32(r,!0);r+=4;const i=this.parameters();if(d!==i.length)throw new Error(`Weight file has ${d} parameters but this model has ${i.length}.`);const c=[];for(let u=0;u<d;u++)c.push(n.getUint32(r,!0)),r+=4;for(let u=0;u<d;u++){const l=i[u],h=c[u];if(h!==l.numel)throw new Error(`Parameter ${u} ("${l.name}") size mismatch: file=${h}, model=${l.numel}.`);ge(this.device,l.buf,new Float32Array(e,r,l.numel)),r+=l.numel*4}return}if(s===2||s===3){const d=s===3,i=n.getUint32(r,!0);if(r+=4,i!==this.layers.length)throw new Error(`Weight file has ${i} layers but this model has ${this.layers.length}.`);for(let m=0;m<i;m++){const f=n.getUint8(r+m),g=this.layers[m].layerType,p=Bn[f]??"mamba1";if(p!==g)throw new Error(`Layer ${m} type mismatch: file="${p}", model="${g}".`)}const c=Math.ceil(i/4)*4;r+=c;const u=n.getUint32(r,!0);r+=4;const l=this.parameters();if(u!==l.length)throw new Error(`Weight file has ${u} parameters but this model has ${l.length}.`);const h=[];for(let m=0;m<u;m++)h.push(n.getUint32(r,!0)),r+=4;for(let m=0;m<u;m++){const f=l[m],g=h[m];if(g!==f.numel)throw new Error(`Parameter ${m} ("${f.name}") size mismatch: file=${g}, model=${f.numel}.`);if(d){const p=new Uint16Array(e,r,g);ge(this.device,f.buf,De(p)),r+=g*2}else ge(this.device,f.buf,new Float32Array(e,r,f.numel)),r+=g*4}return}throw new Error(`Unsupported MBJS version: ${s}. Expected 1, 2, or 3.`)}destroy(){this.gpuEmbedding.destroy();for(const e of this.layers)e.destroy();this.gpuFinalNorm.destroy(),this.gpuLMHeadBias.destroy()}}class ws extends Dn{constructor(e,t){super(e,{...t,layers:Array.from({length:t.numLayers},()=>({type:"mamba1"}))})}}const Fn=`
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
`;function Cn(o,{temperature:e=1,topK:t=50,topP:n=.9}={}){const r=o.length,a=new Float32Array(r);for(let p=0;p<r;p++)a[p]=o[p]/Math.max(e,1e-7);let s=-1/0;for(let p=0;p<r;p++)a[p]>s&&(s=a[p]);let d=0;const i=new Float32Array(r);for(let p=0;p<r;p++)i[p]=Math.exp(a[p]-s),d+=i[p];const u=Array.from({length:r},(p,w)=>w).sort((p,w)=>i[w]-i[p]).slice(0,t);let l=0;const h=[];for(const p of u)if(l+=i[p]/d,h.push(p),l>=n)break;let m=0;for(const p of h)m+=i[p];const f=Math.random()*m;let g=0;for(const p of h)if(g+=i[p],g>=f)return p;return h[h.length-1]}const Pn={modelDim:64,hiddenDim:128,numExperts:8,topK:2},Tn=1299137793,Ct=1299137840;function Nn(o){return o>0?o:0}class Pt{constructor(e,t,n){_(this,"modelDim");_(this,"hiddenDim");_(this,"w1");_(this,"b1");_(this,"w2");_(this,"b2");_(this,"gW1");_(this,"gB1");_(this,"gW2");_(this,"gB2");this.modelDim=e,this.hiddenDim=t,this.w1=n(t*e,Math.sqrt(2/e)),this.b1=new Float32Array(t),this.w2=n(e*t,.02),this.b2=new Float32Array(e),this.gW1=new Float32Array(this.w1.length),this.gB1=new Float32Array(this.b1.length),this.gW2=new Float32Array(this.w2.length),this.gB2=new Float32Array(this.b2.length)}forward(e){const{modelDim:t,hiddenDim:n}=this,r=new Float32Array(n),a=new Float32Array(n);for(let d=0;d<n;d++){let i=this.b1[d];const c=d*t;for(let u=0;u<t;u++)i+=this.w1[c+u]*e[u];r[d]=i,a[d]=Nn(i)}const s=new Float32Array(t);for(let d=0;d<t;d++){let i=this.b2[d];const c=d*n;for(let u=0;u<n;u++)i+=this.w2[c+u]*a[u];s[d]=i}return{y:s,pre:r,h:a}}backward(e,t,n,r){const{modelDim:a,hiddenDim:s}=this,d=new Float32Array(s);for(let c=0;c<a;c++){const u=e[c];this.gB2[c]=this.gB2[c]+u;const l=c*s;for(let h=0;h<s;h++)this.gW2[l+h]=this.gW2[l+h]+u*r[h],d[h]=d[h]+u*this.w2[l+h]}const i=new Float32Array(a);for(let c=0;c<s;c++){const u=n[c]>0?d[c]:0;this.gB1[c]=this.gB1[c]+u;const l=c*a;for(let h=0;h<a;h++)this.gW1[l+h]=this.gW1[l+h]+u*t[h],i[h]=i[h]+u*this.w1[l+h]}return i}params(){return[this.w1,this.b1,this.w2,this.b2]}grads(){return[this.gW1,this.gB1,this.gW2,this.gB2]}}class $n{constructor(e){_(this,"numExperts");_(this,"counts");_(this,"probSum");_(this,"tokens",0);this.numExperts=e,this.counts=new Float32Array(e),this.probSum=new Float32Array(e)}observe(e){this.tokens++;for(const t of e.experts)this.counts[t]=this.counts[t]+1;for(let t=0;t<this.numExperts;t++)this.probSum[t]=this.probSum[t]+e.probs[t]}dispatchFractions(){const e=this.counts.reduce((t,n)=>t+n,0)||1;return Float32Array.from(this.counts,t=>t/e)}loss(){if(this.tokens===0)return 0;const e=this.dispatchFractions();let t=0;for(let n=0;n<this.numExperts;n++)t+=e[n]*(this.probSum[n]/this.tokens);return this.numExperts*t}}class wr{constructor(e={}){_(this,"config");_(this,"wr");_(this,"gWr");_(this,"shared");_(this,"experts");const t={...Pn,...e};if(t.topK>t.numExperts)throw new Error(`MoE topK (${t.topK}) must be ≤ numExperts (${t.numExperts})`);if(t.topK<1)throw new Error(`MoE topK must be ≥ 1 (got ${t.topK})`);this.config=t;const n=new ne((e.seed??Tn)>>>0||1),r=(a,s)=>{const d=new Float32Array(a);for(let i=0;i<a;i++){const c=Math.max(n.next(),1e-12),u=n.next();d[i]=s*Math.sqrt(-2*Math.log(c))*Math.cos(2*Math.PI*u)}return d};this.wr=r(t.numExperts*t.modelDim,.02),this.gWr=new Float32Array(this.wr.length),this.shared=new Pt(t.modelDim,t.hiddenDim,r),this.experts=Array.from({length:t.numExperts},()=>new Pt(t.modelDim,t.hiddenDim,r))}route(e){const{numExperts:t,topK:n,modelDim:r}=this.config,a=new Float32Array(t);for(let l=0;l<t;l++){let h=0;const m=l*r;for(let f=0;f<r;f++)h+=this.wr[m+f]*e[f];a[l]=h}const s=Tt(a),i=Array.from({length:t},(l,h)=>h).sort((l,h)=>a[h]-a[l]).slice(0,n),c=i.map(l=>a[l]),u=Tt(Float32Array.from(c));return{experts:i,gates:Array.from(u),probs:s}}forward(e){const{modelDim:t}=this.config,n=Float32Array.from({length:t},(u,l)=>e[l]??0),r=this.route(n),a=this.shared.forward(n),s=Float32Array.from(a.y),d=[],i=[],c=[];for(let u=0;u<r.experts.length;u++){const h=this.experts[r.experts[u]].forward(n),m=r.gates[u];for(let f=0;f<t;f++)s[f]=s[f]+m*h.y[f];d.push(h.y),i.push(h.pre),c.push(h.h)}return{output:s,route:r,cache:{x:n,route:r,sharedPre:a.pre,sharedH:a.h,expertOut:d,expertPre:i,expertH:c}}}backward(e,t){const{modelDim:n}=this.config,r=Float32Array.from({length:n},(l,h)=>e[h]??0),a=new Float32Array(n),s=this.shared.backward(r,t.x,t.sharedPre,t.sharedH);for(let l=0;l<n;l++)a[l]=a[l]+s[l];const d=t.route.experts.length,i=new Float32Array(d);for(let l=0;l<d;l++){const h=t.route.gates[l],m=new Float32Array(n);let f=0;for(let p=0;p<n;p++)m[p]=h*r[p],f+=r[p]*t.expertOut[l][p];const g=this.experts[t.route.experts[l]].backward(m,t.x,t.expertPre[l],t.expertH[l]);for(let p=0;p<n;p++)a[p]=a[p]+g[p];i[l]=f}const c=t.route.gates;let u=0;for(let l=0;l<d;l++)u+=c[l]*i[l];for(let l=0;l<d;l++){const h=c[l]*(i[l]-u),f=t.route.experts[l]*n;for(let g=0;g<n;g++)this.gWr[f+g]=this.gWr[f+g]+h*t.x[g],a[g]=a[g]+h*this.wr[f+g]}return a}auxGradStep(e,t,n,r){const{numExperts:a,modelDim:s}=this.config;let d=0;for(let i=0;i<a;i++)d+=n[i]*t[i];for(let i=0;i<a;i++){const c=r*t[i]*(n[i]-d);if(c===0)continue;const u=i*s;for(let l=0;l<s;l++)this.gWr[u+l]=this.gWr[u+l]+c*e[l]}}parameters(){const e=[{name:"wr",data:this.wr,numel:this.wr.length}],t=(n,r)=>{const a=["w1","b1","w2","b2"];r.params().forEach((s,d)=>e.push({name:`${n}.${a[d]}`,data:s,numel:s.length}))};return t("shared",this.shared),this.experts.forEach((n,r)=>t(`expert${r}`,n)),e}gradients(){const e=[{name:"wr",data:this.gWr,numel:this.gWr.length}],t=(n,r)=>{const a=["w1","b1","w2","b2"];r.grads().forEach((s,d)=>e.push({name:`${n}.${a[d]}`,data:s,numel:s.length}))};return t("shared",this.shared),this.experts.forEach((n,r)=>t(`expert${r}`,n)),e}zeroGrad(){for(const e of this.gradients())e.data.fill(0)}exportExpert(e){const t=this.experts[e];if(!t)throw new Error(`exportExpert: index ${e} out of range (0..${this.config.numExperts-1})`);const n=["w1","b1","w2","b2"];return t.params().map((r,a)=>({name:n[a],data:r,numel:r.length}))}exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.reduce((l,h)=>l+h.numel,0),a=6,s=a*4,d=new ArrayBuffer(s+(t?r*2:r*4)),i=new Uint32Array(d,0,a);i[0]=Ct,i[1]=t?2:1,i[2]=this.config.modelDim,i[3]=this.config.hiddenDim,i[4]=this.config.numExperts,i[5]=this.config.topK;const c=new Float32Array(r);let u=0;for(const l of n)c.set(l.data,u),u+=l.numel;return t?new Uint16Array(d,s,r).set(Be(c)):new Float32Array(d,s,r).set(c),d}loadWeights(e){const t=new Uint32Array(e,0,6);if(t[0]!==Ct)throw new Error("SharedExpertMoE.loadWeights: bad magic (not an MoE0 checkpoint)");const[,n,r,a,s,d]=t;if(r!==this.config.modelDim||a!==this.config.hiddenDim||s!==this.config.numExperts||d!==this.config.topK)throw new Error("SharedExpertMoE.loadWeights: config mismatch with checkpoint");const i=this.parameters(),c=i.reduce((m,f)=>m+f.numel,0),u=24,l=n===2?De(new Uint16Array(e,u,c)):new Float32Array(e.slice(u,u+c*4));let h=0;for(const m of i)m.data.set(l.subarray(h,h+m.numel)),h+=m.numel}}function Tt(o){let e=-1/0;for(let r=0;r<o.length;r++)o[r]>e&&(e=o[r]);const t=new Float32Array(o.length);let n=0;for(let r=0;r<o.length;r++)t[r]=Math.exp(o[r]-e),n+=t[r];for(let r=0;r<o.length;r++)t[r]=t[r]/n;return t}class gt{constructor(e,t={}){_(this,"target");_(this,"m",[]);_(this,"v",[]);_(this,"t",0);_(this,"opt");_(this,"shard");this.target=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0};const n=t.shard??null;if(n&&(n.count<=0||n.index<0||n.index>=n.count))throw new Error(`AdamW: invalid shard ${n.index}/${n.count}`);this.shard=n;const r=e.parameters();for(let a=0;a<r.length;a++)this._owns(a)?(this.m.push(new Float32Array(r[a].data.length)),this.v.push(new Float32Array(r[a].data.length))):(this.m.push(null),this.v.push(null))}_owns(e){return this.shard===null||e%this.shard.count===this.shard.index}step(){this.t++;const{lr:e,beta1:t,beta2:n,eps:r,weightDecay:a}=this.opt,s=this.target.parameters(),d=this.target.gradients(),i=1-Math.pow(t,this.t),c=1-Math.pow(n,this.t);for(let u=0;u<s.length;u++){if(!this._owns(u))continue;const l=s[u].data,h=d[u].data,m=this.m[u],f=this.v[u];for(let g=0;g<l.length;g++){const p=h[g];m[g]=t*m[g]+(1-t)*p,f[g]=n*f[g]+(1-n)*p*p;const w=m[g]/i,v=f[g]/c;l[g]=l[g]-e*(w/(Math.sqrt(v)+r)+a*l[g])}}}stateBytes(){let e=0;for(const t of this.m)t&&(e+=t.byteLength);for(const t of this.v)t&&(e+=t.byteLength);return e}}function Ye(o,e,t,n,r){const{lr:a,beta1:s,beta2:d,eps:i,weightDecay:c,beta1_t:u,beta2_t:l,maxDelta:h}=r,m=r.gradScale??1,f=1-u,g=1-l;for(let p=0;p<o.length;p++){const w=e[p]*m,v=s*t[p]+(1-s)*w,b=d*n[p]+(1-d)*w*w;t[p]=v,n[p]=b;let y=a*(v/f)/(Math.sqrt(b/g)+i);Number.isFinite(y)||(y=0),h>0&&(y=Math.min(h,Math.max(-h,y))),o[p]=o[p]*(1-a*c)-y}}class ys{constructor(e,t={}){_(this,"model");_(this,"adam");_(this,"opt");this.model=e,this.opt={lr:t.lr??.01,beta1:t.beta1??.9,beta2:t.beta2??.999,eps:t.eps??1e-8,weightDecay:t.weightDecay??0,auxWeight:t.auxWeight??.01,batchSize:t.batchSize??0,epochs:t.epochs??1},this.adam=new gt(e,this.opt)}fit(e){const t=[];for(let n=0;n<this.opt.epochs;n++)t.push(this.runEpoch(e));return t}runEpoch(e){const t=this.opt.batchSize>0?this.opt.batchSize:e.length,{numExperts:n,modelDim:r}=this.model.config;let a=0,s=0;for(let d=0;d<e.length;d+=t){const i=e.slice(d,d+t);this.model.zeroGrad();const c=[],u=[],l=new $n(n);let h=0;for(const g of i){const p=this.model.forward(g.input),w=new Float32Array(r);for(let v=0;v<r;v++){const b=p.output[v]-(g.target[v]??0);w[v]=b,h+=.5*b*b}this.model.backward(w,p.cache),c.push(p.cache.x),u.push(p.route.probs),l.observe(p.route)}const m=l.dispatchFractions(),f=this.opt.auxWeight*n/i.length;for(let g=0;g<c.length;g++)this.model.auxGradStep(c[g],u[g],m,f);this.scaleGradients(1/i.length),this.adam.step(),a+=h,s=l.loss()}return{loss:a/Math.max(1,e.length),auxLoss:s}}scaleGradients(e){if(e!==1)for(const t of this.model.gradients())for(let n=0;n<t.data.length;n++)t.data[n]=t.data[n]*e}}let Le=[],_t=!0;class vs{constructor(e,t,n=!1){_(this,"data");_(this,"shape");_(this,"numel");_(this,"requiresGrad");_(this,"grad");_(this,"_gradFn");this.data=e,this.shape=t,this.numel=t.reduce((r,a)=>r*a,1),this.requiresGrad=n,this.grad=null,this._gradFn=null}get byteSize(){return this.numel*4}zeroGrad(e){this.grad&&e.queue.writeBuffer(this.grad,0,new Float32Array(this.numel))}destroy(){var e,t;(e=this.data)==null||e.destroy(),(t=this.grad)==null||t.destroy(),this.data=null,this.grad=null}}function xs(){_t=!0}function ks(){_t=!1}function In(){Le=[]}function As(o){return _t?(Le.push({backward:o}),Le.length-1):-1}async function Ms(){for(let o=Le.length-1;o>=0;o--)await Le[o].backward();In()}function ye(o,e){let t=-1/0;for(let a=0;a<o.length;a++)o[a]>t&&(t=o[a]);let n=0;for(let a=0;a<o.length;a++)n+=Math.exp(o[a]-t);return Math.log(n)+t-o[e]}function yr(o,e){let t=-1/0;for(let s=0;s<o.length;s++)o[s]>t&&(t=o[s]);let n=0;const r=new Float32Array(o.length);for(let s=0;s<o.length;s++)r[s]=Math.exp(o[s]-t),n+=r[s];const a=new Float32Array(o.length);for(let s=0;s<o.length;s++)a[s]=r[s]/n;return a[e]=(a[e]??0)-1,a}function vr(o){return mt(Ue(o))}function Ls(o){const e=new Float32Array(o.length);for(let t=0;t<o.length;t++)e[t]=vr(o[t]);return e}class zn{constructor(e={}){_(this,"_scale");_(this,"growthFactor");_(this,"backoffFactor");_(this,"growthInterval");_(this,"minScale");_(this,"cleanStreak",0);_(this,"_overflows",0);_(this,"_skipped",0);this._scale=e.initScale??16384,this.growthFactor=e.growthFactor??2,this.backoffFactor=e.backoffFactor??.5,this.growthInterval=e.growthInterval??200,this.minScale=e.minScale??1}get scale(){return this._scale}get overflows(){return this._overflows}get skipped(){return this._skipped}check(e){for(const t of e){const n=t.data;for(let r=0;r<n.length;r++){const a=n[r];if(!Number.isFinite(a))return!0}}return!1}unscale(e){const t=1/this._scale;for(const n of e){const r=n.data;for(let a=0;a<r.length;a++)r[a]=r[a]*t}}update(e){return e?(this._overflows++,this._skipped++,this._scale=Math.max(this.minScale,this._scale*this.backoffFactor),this.cleanStreak=0,!1):(++this.cleanStreak>=this.growthInterval&&(this._scale*=this.growthFactor,this.cleanStreak=0),!0)}}const xr=809784901,Wn=1;function kr(o,e,t,n=0){if(o.length!==e.length)throw new Error(`computeRowDelta: length mismatch (base ${o.length}, current ${e.length})`);if(t<=0||o.length%t!==0)throw new Error(`computeRowDelta: base length ${o.length} is not a multiple of rowSize ${t}`);const r=o.length/t,a=[];for(let d=0;d<r;d++){const i=d*t;let c=!1;for(let u=0;u<t;u++)if(Math.abs(e[i+u]-o[i+u])>n){c=!0;break}c&&a.push(d)}const s=new Float32Array(a.length*t);return a.forEach((d,i)=>s.set(e.subarray(d*t,d*t+t),i*t)),{rowSize:t,rows:a,data:s}}function Ar(o,e){if(o.length%e.rowSize!==0)throw new Error(`applyRowDelta: base length ${o.length} is not a multiple of rowSize ${e.rowSize}`);const t=Float32Array.from(o);return e.rows.forEach((n,r)=>{const a=n*e.rowSize;if(a+e.rowSize>t.length)throw new Error(`applyRowDelta: row ${n} out of range for base of ${t.length} elements`);t.set(e.data.subarray(r*e.rowSize,r*e.rowSize+e.rowSize),a)}),t}function bt(o){const e=o.rows.length,n=4*4,r=e*4,a=o.data.length*4,s=new ArrayBuffer(n+r+a),d=new DataView(s);d.setUint32(0,xr,!0),d.setUint32(4,Wn,!0),d.setUint32(8,o.rowSize,!0),d.setUint32(12,e,!0);let i=n;for(const c of o.rows)d.setUint32(i,c,!0),i+=4;return new Float32Array(s,i,o.data.length).set(o.data),Ge(s)}function jn(o,e){const t=ce(o);if(t.hasTrailer&&!t.ok)throw new Error("diffCheckpoints: base failed CRC integrity check");const n=ce(e);if(n.hasTrailer&&!n.ok)throw new Error("diffCheckpoints: current failed CRC integrity check");if(t.body.byteLength!==n.body.byteLength)throw new Error(`diffCheckpoints: shape mismatch (base ${t.body.byteLength}B, current ${n.body.byteLength}B) — only same-config checkpoints can be diffed`);if(t.body.byteLength%4!==0)throw new Error("diffCheckpoints: checkpoint body is not 4-byte aligned (not an f32 checkpoint)");return bt(kr(new Float32Array(t.body),new Float32Array(n.body),1))}function Mr(o,e){const t=ce(o);if(t.hasTrailer&&!t.ok)throw new Error("applyCheckpointDiff: base failed CRC integrity check");const n=Ar(new Float32Array(t.body),Ke(e)),r=new ArrayBuffer(n.byteLength);return new Float32Array(r).set(n),Ge(r)}function Ke(o){const e=ce(o);if(e.hasTrailer&&!e.ok)throw new Error("deserializeRowDelta: failed CRC integrity check (corrupt or truncated)");const t=e.body,n=new DataView(t);if(n.getUint32(0,!0)!==xr)throw new Error("deserializeRowDelta: bad magic (not an EVD0 delta)");const r=n.getUint32(8,!0),a=n.getUint32(12,!0);let s=16;const d=[];for(let c=0;c<a;c++)d.push(n.getUint32(s,!0)),s+=4;const i=new Float32Array(t.slice(s,s+a*r*4));return{rowSize:r,rows:d,data:i}}const ve={dModel:64,numLayers:2,convKernel:3,hiddenDim:128,numExperts:4,topK:2},Rn=1163283533,Nt=1163283504;class He{constructor(e){_(this,"config");_(this,"_positionsEvaluated",0);_(this,"emb");_(this,"gEmb");_(this,"conv");_(this,"gConv");_(this,"nConv");_(this,"gNConv");_(this,"nMoe");_(this,"gNMoe");_(this,"moe");const t=e.dModel??ve.dModel,n={vocabSize:e.vocabSize,dModel:t,numLayers:e.numLayers??ve.numLayers,convKernel:e.convKernel??ve.convKernel,hiddenDim:e.hiddenDim??t*2,numExperts:e.numExperts??ve.numExperts,topK:e.topK??ve.topK};if(n.vocabSize<=0)throw new Error("EvermindLM: vocabSize must be > 0");if(n.topK>n.numExperts)throw new Error("EvermindLM: topK must be ≤ numExperts");this.config=n;const r=(e.seed??Rn)>>>0||1,a=new ne(r),s=(d,i)=>{const c=new Float32Array(d);for(let u=0;u<d;u++){const l=Math.max(a.next(),1e-12),h=a.next();c[u]=i*Math.sqrt(-2*Math.log(l))*Math.cos(2*Math.PI*h)}return c};this.emb=s(n.vocabSize*n.dModel,.02),this.gEmb=new Float32Array(this.emb.length),this.conv=[],this.gConv=[],this.nConv=[],this.gNConv=[],this.nMoe=[],this.gNMoe=[],this.moe=[];for(let d=0;d<n.numLayers;d++){const i=new Float32Array(n.dModel*n.convKernel);for(let c=0;c<n.dModel;c++)i[c*n.convKernel]=1;this.conv.push(i),this.gConv.push(new Float32Array(i.length)),this.nConv.push(new Float32Array(n.dModel).fill(1)),this.gNConv.push(new Float32Array(n.dModel)),this.nMoe.push(new Float32Array(n.dModel).fill(1)),this.gNMoe.push(new Float32Array(n.dModel)),this.moe.push(new wr({modelDim:n.dModel,hiddenDim:n.hiddenDim,numExperts:n.numExperts,topK:n.topK,seed:r+1+d}))}}_embed(e){const{dModel:t}=this.config;return e.map(n=>{const r=new Float32Array(t),a=n*t;for(let s=0;s<t;s++)r[s]=this.emb[a+s];return r})}_forwardLayer(e,t){const n=t.length,r=[],a=[],s=[],d=[],i=[],c=[],u=[];for(let l=0;l<n;l++){const h=this._stepLayerPosition(e,t[l],r);a.push(h.normed),s.push(h.rmsConv),d.push(h.afterConv),i.push(h.rmsMoe),c.push(h.moeCache),u.push(h.out)}return{afterMoe:u,cache:{layerIn:t,normedConv:a,rmsConv:s,afterConv:d,rmsMoe:i,moeCache:c}}}_stepLayerPosition(e,t,n){const{dModel:r,convKernel:a}=this.config,s=this.conv[e],{y:d,r:i}=$t(t,this.nConv[e]),c=Float32Array.from(t);for(let f=0;f<r;f++){let g=s[f*a]*d[f];for(let p=1;p<a;p++){const w=n[n.length-p];w&&(g+=s[f*a+p]*w[f])}c[f]=c[f]+g}for(n.push(d);n.length>a-1;)n.shift();const{y:u,r:l}=$t(c,this.nMoe[e]),h=Float32Array.from(c),m=this.moe[e].forward(u);for(let f=0;f<r;f++)h[f]=h[f]+m.output[f];return this._positionsEvaluated++,{normed:d,rmsConv:i,afterConv:c,rmsMoe:l,moeCache:m.cache,out:h}}_embedOne(e){const{dModel:t}=this.config,n=new Float32Array(t),r=e*t;for(let a=0;a<t;a++)n[a]=this.emb[r+a];return n}_head(e){const{dModel:t,vocabSize:n}=this.config;return e.map(r=>{const a=new Float32Array(n);for(let s=0;s<n;s++){let d=0;const i=s*t;for(let c=0;c<t;c++)d+=r[c]*this.emb[i+c];a[s]=d}return a})}forward(e){let t=this._embed(e);const n=[];for(let r=0;r<this.config.numLayers;r++){const{afterMoe:a,cache:s}=this._forwardLayer(r,t);n.push(s),t=a}return{logits:this._head(t),cache:{tokens:e,layers:n,finalX:t}}}embed(e){const{dModel:t,numLayers:n}=this.config,r=new Float32Array(t),a=e.length;if(a===0)return r;const s=Array.from({length:n},()=>[]);for(let i=0;i<a;i++){let c=this._embedOne(e[i]);for(let u=0;u<n;u++)c=this._stepLayerPosition(u,c,s[u]).out;for(let u=0;u<t;u++)r[u]=r[u]+c[u]}for(let i=0;i<t;i++)r[i]=r[i]/a;let d=0;for(let i=0;i<t;i++)d+=r[i]*r[i];d=Math.sqrt(d)||1;for(let i=0;i<t;i++)r[i]=r[i]/d;return r}embedText(e,t){return this.embed(t.encode(e))}_headBackward(e,t,n){const{dModel:r,vocabSize:a}=this.config,s=e.length,d=s-1,i=1/d,c=Array.from({length:s},()=>new Float32Array(r));let u=0;for(let l=0;l<d;l++){const h=e[l+1];u+=ye(t[l],h)*i;const m=yr(t[l],h),f=n[l];for(let g=0;g<a;g++){const p=m[g]*i;if(p===0)continue;const w=g*r;for(let v=0;v<r;v++)this.gEmb[w+v]=this.gEmb[w+v]+p*f[v],c[l][v]=c[l][v]+p*this.emb[w+v]}}return{loss:u,dX:c}}_backwardLayer(e,t,n){const{dModel:r,convKernel:a}=this.config,s=t.length,d=this.conv[e],i=this.gConv[e],c=this.nConv[e],u=this.gNConv[e],l=this.nMoe[e],h=this.gNMoe[e],m=[];for(let p=0;p<s;p++){const w=this.moe[e].backward(t[p],n.moeCache[p]),{dx:v,dgain:b}=It(w,n.afterConv[p],n.rmsMoe[p],l);for(let k=0;k<r;k++)h[k]=h[k]+b[k];const y=Float32Array.from(t[p]);for(let k=0;k<r;k++)y[k]=y[k]+v[k];m.push(y)}const f=Array.from({length:s},()=>new Float32Array(r)),g=m.map(p=>Float32Array.from(p));for(let p=0;p<s;p++)for(let w=0;w<r;w++){const v=m[p][w];if(v!==0)for(let b=0;b<a;b++){const y=p-b;y<0||(i[w*a+b]=i[w*a+b]+v*n.normedConv[y][w],f[y][w]=f[y][w]+v*d[w*a+b])}}for(let p=0;p<s;p++){const{dx:w,dgain:v}=It(f[p],n.layerIn[p],n.rmsConv[p],c);for(let b=0;b<r;b++)u[b]=u[b]+v[b],g[p][b]=g[p][b]+w[b]}return g}_embedBackward(e,t){const{dModel:n}=this.config;for(let r=0;r<e.length;r++){const a=e[r]*n;for(let s=0;s<n;s++)this.gEmb[a+s]=this.gEmb[a+s]+t[r][s]}}lossAndBackward(e){if(e.length<2)return 0;const{logits:t,cache:n}=this.forward(e),{loss:r,dX:a}=this._headBackward(e,t,n.finalX);let s=a;for(let d=this.config.numLayers-1;d>=0;d--)s=this._backwardLayer(d,s,n.layers[d]);return this._embedBackward(e,s),r}lossAndBackwardCheckpointed(e){if(e.length<2)return 0;let t=this._embed(e);const n=[];for(let i=0;i<this.config.numLayers;i++)n.push(t),t=this._forwardLayer(i,t).afterMoe;const r=this._head(t),{loss:a,dX:s}=this._headBackward(e,r,t);let d=s;for(let i=this.config.numLayers-1;i>=0;i--){const{cache:c}=this._forwardLayer(i,n[i]);d=this._backwardLayer(i,d,c)}return this._embedBackward(e,d),a}get positionsEvaluated(){return this._positionsEvaluated}resetStats(){this._positionsEvaluated=0}newDecodeState(){return{convWindow:Array.from({length:this.config.numLayers},()=>[]),length:0,lastLogits:null}}cloneDecodeState(e){return{convWindow:e.convWindow.map(t=>t.map(n=>Float32Array.from(n))),length:e.length,lastLogits:e.lastLogits?Float32Array.from(e.lastLogits):null}}stepDecode(e,t){const n=this.cloneDecodeState(e),r=[];for(const a of t){let s=this._embedOne(a);for(let i=0;i<this.config.numLayers;i++)s=this._stepLayerPosition(i,s,n.convWindow[i]).out;const d=this._head([s])[0];r.push(d),n.lastLogits=d,n.length++}return{logits:r,state:n}}prefixState(e){return this.stepDecode(this.newDecodeState(),e).state}scoreContinuation(e,t){if(t.length===0||!e.lastLogits)return-1/0;const{logits:n}=this.stepDecode(e,t.slice(0,-1));let r=zt(e.lastLogits,t[0]);for(let a=1;a<t.length;a++)r+=zt(n[a-1],t[a]);return r/t.length}generateText(e,t,n){return t.decode(this.generate(t.encode(e),n))}generate(e,t){const n=t.temperature??0,r=n>0?new ne((t.seed??1)>>>0||1):null;let a=this.stepDecode(this.newDecodeState(),e.length>0?e:[0]).state;const s=[];for(let d=0;d<t.maxNewTokens;d++){const i=a.lastLogits,c=r?Gn(i,n,r):Un(i);if(s.push(c),t.stopToken!==void 0&&c===t.stopToken)break;a=this.stepDecode(a,[c]).state}return s}parameters(){const e=[{data:this.emb}];for(let t=0;t<this.config.numLayers;t++){e.push({data:this.conv[t]},{data:this.nConv[t]},{data:this.nMoe[t]});for(const n of this.moe[t].parameters())e.push({data:n.data})}return e}gradients(){const e=[{data:this.gEmb}];for(let t=0;t<this.config.numLayers;t++){e.push({data:this.gConv[t]},{data:this.gNConv[t]},{data:this.gNMoe[t]});for(const n of this.moe[t].gradients())e.push({data:n.data})}return e}zeroGrad(){this.gEmb.fill(0);for(let e=0;e<this.config.numLayers;e++)this.gConv[e].fill(0),this.gNConv[e].fill(0),this.gNMoe[e].fill(0),this.moe[e].zeroGrad()}exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.reduce((l,h)=>l+h.data.length,0),a=9,s=a*4,d=new ArrayBuffer(s+(t?r*2:r*4)),i=new Uint32Array(d,0,a);i[0]=Nt,i[1]=t?2:1,i[2]=this.config.vocabSize,i[3]=this.config.dModel,i[4]=this.config.numLayers,i[5]=this.config.convKernel,i[6]=this.config.hiddenDim,i[7]=this.config.numExperts,i[8]=this.config.topK;const c=new Float32Array(r);let u=0;for(const l of n)c.set(l.data,u),u+=l.data.length;return t?new Uint16Array(d,s,r).set(Be(c)):new Float32Array(d,s,r).set(c),Ge(d)}loadWeights(e){this._setFlat(this._readFlat(e))}_readFlat(e){const t=ce(e);if(t.hasTrailer&&!t.ok)throw new Error("EvermindLM.loadWeights: checkpoint failed CRC integrity check (corrupt or truncated)");const n=new Uint32Array(e,0,9);if(n[0]!==Nt)throw new Error("EvermindLM.loadWeights: bad magic (not an EVL0 checkpoint)");const r=n[1];if(n[2]!==this.config.vocabSize||n[3]!==this.config.dModel||n[4]!==this.config.numLayers||n[5]!==this.config.convKernel||n[6]!==this.config.hiddenDim||n[7]!==this.config.numExperts||n[8]!==this.config.topK)throw new Error("EvermindLM.loadWeights: config mismatch with checkpoint");const a=this.parameters().reduce((d,i)=>d+i.data.length,0),s=36;return r===2?De(new Uint16Array(e,s,a)):new Float32Array(e.slice(s,s+a*4))}_flat(){const e=this.parameters(),t=e.reduce((a,s)=>a+s.data.length,0),n=new Float32Array(t);let r=0;for(const a of e)n.set(a.data,r),r+=a.data.length;return n}_setFlat(e){let t=0;for(const n of this.parameters())n.data.set(e.subarray(t,t+n.data.length)),t+=n.data.length}exportDelta(e,t={}){const n=this._readFlat(e),r=this._flat(),a=r.length%this.config.dModel===0?this.config.dModel:1;return bt(kr(n,r,a,t.eps??0))}loadDelta(e,t){const n=this._readFlat(e);this._setFlat(Ar(n,Ke(t)))}}class wt{constructor(e,t={}){_(this,"model");_(this,"opts");_(this,"adam");_(this,"scaler");_(this,"grads");this.model=e,this.opts=t,this.adam=new gt(e,t),this.grads=e.gradients(),this.scaler=t.mixedPrecision?new zn(typeof t.mixedPrecision=="object"?t.mixedPrecision:{}):null}get lossScaler(){return this.scaler}_backward(e){return this.opts.checkpoint?this.model.lossAndBackwardCheckpointed(e):this.model.lossAndBackward(e)}_scaleGrads(e){if(e===1)return;const t=1/e;for(const n of this.grads)for(let r=0;r<n.data.length;r++)n.data[r]=n.data[r]*t}_fp16Grads(){for(const e of this.grads)for(let t=0;t<e.data.length;t++)e.data[t]=vr(e.data[t])}_mulGrads(e){if(e!==1)for(const t of this.grads)for(let n=0;n<t.data.length;n++)t.data[n]=t.data[n]*e}fit(e){const t=this.opts.epochs??1,n=Math.max(1,this.opts.accumSteps??1),r=[];for(let a=0;a<t;a++){let s=0,d=0,i=0,c=this.scaler?this.scaler.scale:1;this.model.zeroGrad();const u=()=>{if(i!==0){if(this._scaleGrads(i),this.scaler){this._fp16Grads();const l=this.scaler.check(this.grads);this.scaler.update(l)&&(this._mulGrads(1/c),this.adam.step()),c=this.scaler.scale}else this.adam.step();this.model.zeroGrad(),i=0}};for(const l of e){if(l.length<2)continue;i===0&&this.scaler&&(c=this.scaler.scale);const h=this._backward(l);this._mulGrads(c),s+=h,d++,++i>=n&&u()}u(),r.push(d>0?s/d:0)}return r}}const On=1e-5;function $t(o,e){const t=o.length;let n=0;for(let s=0;s<t;s++)n+=o[s]*o[s];const r=Math.sqrt(n/t+On),a=new Float32Array(t);for(let s=0;s<t;s++)a[s]=e[s]*o[s]/r;return{y:a,r}}function It(o,e,t,n){const r=e.length;let a=0;for(let c=0;c<r;c++)a+=o[c]*n[c]*e[c];const s=new Float32Array(r),d=new Float32Array(r),i=t*t*t;for(let c=0;c<r;c++)s[c]=n[c]*o[c]/t-e[c]*a/(r*i),d[c]=o[c]*e[c]/t;return{dx:s,dgain:d}}function Un(o){let e=0;for(let t=1;t<o.length;t++)o[t]>o[e]&&(e=t);return e}function Gn(o,e,t){let n=-1/0;for(let d=0;d<o.length;d++)o[d]/e>n&&(n=o[d]/e);let r=0;const a=new Float32Array(o.length);for(let d=0;d<o.length;d++)a[d]=Math.exp(o[d]/e-n),r+=a[d];let s=t.next()*r;for(let d=0;d<a.length;d++)if(s-=a[d],s<=0)return d;return a.length-1}function zt(o,e){let t=-1/0;for(let a=0;a<o.length;a++){const s=o[a];s>t&&(t=s)}if(!Number.isFinite(t))return-1/0;let n=0;for(let a=0;a<o.length;a++)n+=Math.exp(o[a]-t);return(e>=0&&e<o.length?o[e]:-1/0)-(t+Math.log(n))}const Ne=0,Qe=1;class Kn{constructor(e){_(this,"textVocabSize");_(this,"levels");_(this,"codebookSize");_(this,"bosVideo");_(this,"eosVideo");_(this,"frameKey");_(this,"frameDelta");_(this,"codeBase");_(this,"size");_(this,"perBank");if(e.textVocabSize<0)throw new Error("MultimodalVocab: textVocabSize must be ≥ 0");if(e.levels<=0||e.codebookSize<=0)throw new Error("MultimodalVocab: levels and codebookSize must be > 0");this.textVocabSize=e.textVocabSize,this.levels=e.levels,this.codebookSize=e.codebookSize,this.bosVideo=e.textVocabSize,this.eosVideo=e.textVocabSize+1,this.frameKey=e.textVocabSize+2,this.frameDelta=e.textVocabSize+3,this.codeBase=e.textVocabSize+4,this.perBank=e.levels*e.codebookSize,this.size=this.codeBase+2*this.perBank}codeToken(e,t,n){return this.codeBase+e*this.perBank+t*this.codebookSize+n}isText(e){return e>=0&&e<this.textVocabSize}isCode(e){return e>=this.codeBase&&e<this.size}isVideoMarker(e){return e===this.frameKey||e===this.frameDelta}decodeCode(e){const t=e-this.codeBase,n=Math.floor(t/this.perBank),r=t-n*this.perBank,a=Math.floor(r/this.codebookSize),s=r-a*this.codebookSize;return{bank:n,level:a,code:s}}classify(e){return this.isText(e)?{kind:"text",id:e}:e===this.bosVideo?{kind:"control",control:"bosVideo"}:e===this.eosVideo?{kind:"control",control:"eosVideo"}:e===this.frameKey?{kind:"control",control:"frameKey"}:e===this.frameDelta?{kind:"control",control:"frameDelta"}:{kind:"code",...this.decodeCode(e)}}}const Wt=1448235312,le={channels:3,patch:4,levels:2,codebookSize:16,keyframeInterval:12,textVocabSize:0,seed:1448232529};class qe{constructor(e){_(this,"height");_(this,"width");_(this,"channels");_(this,"patch");_(this,"levels");_(this,"codebookSize");_(this,"keyframeInterval");_(this,"latentDim");_(this,"patchesPerFrame");_(this,"tokensPerFrame");_(this,"vocab");_(this,"banks");const t=e.channels??le.channels,n=e.patch??le.patch;if(e.height<=0||e.width<=0)throw new Error("VideoRVQCodec: height/width must be > 0");if(e.height%n!==0||e.width%n!==0)throw new Error(`VideoRVQCodec: height/width must be divisible by patch (${n})`);this.height=e.height,this.width=e.width,this.channels=t,this.patch=n,this.levels=e.levels??le.levels,this.codebookSize=e.codebookSize??le.codebookSize,this.keyframeInterval=Math.max(1,e.keyframeInterval??le.keyframeInterval),this.latentDim=n*n*t,this.patchesPerFrame=this.height/n*(this.width/n),this.tokensPerFrame=this.patchesPerFrame*this.levels,this.vocab=new Kn({textVocabSize:e.textVocabSize??le.textVocabSize,levels:this.levels,codebookSize:this.codebookSize});const r=new ne((e.seed??le.seed)>>>0||1),a=()=>Array.from({length:this.levels},()=>{const s=new Float32Array(this.codebookSize*this.latentDim);for(let d=0;d<s.length;d++)s[d]=(r.next()-.5)*.1;return s});this.banks=[a(),a()];for(const s of this.banks[Ne])for(let d=0;d<s.length;d++)s[d]+=.5}get vocabSize(){return this.vocab.size}serialize(){const t=2*this.levels*this.codebookSize*this.latentDim,n=new ArrayBuffer(36+t*4),r=new Uint32Array(n,0,9);r[0]=Wt,r[1]=this.height,r[2]=this.width,r[3]=this.channels,r[4]=this.patch,r[5]=this.levels,r[6]=this.codebookSize,r[7]=this.keyframeInterval,r[8]=this.vocab.textVocabSize;const a=new Float32Array(n,36,t);let s=0;for(const d of this.banks)for(const i of d)a.set(i,s),s+=i.length;return n}static deserialize(e){const t=new Uint32Array(e,0,9);if(t[0]!==Wt)throw new Error("VideoRVQCodec.deserialize: bad magic (not a VRQ0 blob)");const n=new qe({height:t[1],width:t[2],channels:t[3],patch:t[4],levels:t[5],codebookSize:t[6],keyframeInterval:t[7],textVocabSize:t[8]}),r=2*n.levels*n.codebookSize*n.latentDim,a=new Float32Array(e.slice(36,36+r*4));let s=0;for(const d of n.banks)for(const i of d)i.set(a.subarray(s,s+i.length)),s+=i.length;return n}encode(e){this.assertShape(e);const t=[this.vocab.bosVideo];let n=null;for(let r=0;r<e.length;r++){const a=this.toPatches(e[r]),s=n===null||r%this.keyframeInterval===0,d=s?Ne:Qe;t.push(s?this.vocab.frameKey:this.vocab.frameDelta);const i=[];for(let c=0;c<this.patchesPerFrame;c++){const u=s?a[c]:jt(a[c],n[c]),{codes:l,recon:h}=this.rvqEncode(d,u);for(let m=0;m<this.levels;m++)t.push(this.vocab.codeToken(d,m,l[m]));i.push(s?h:Rt(n[c],h))}n=i}return t.push(this.vocab.eosVideo),t}decode(e){const t=[];let n=null,r=0;for(;r<e.length&&!this.vocab.isVideoMarker(e[r]);){if(e[r]===this.vocab.eosVideo)return t;r++}for(;r<e.length;){const a=e[r];if(!this.vocab.isVideoMarker(a))break;r++;const s=a===this.vocab.frameKey||n===null,d=s?Ne:Qe,i=[];for(;i.length<this.tokensPerFrame&&r<e.length&&this.vocab.isCode(e[r]);)i.push(e[r]),r++;const c=[];for(let u=0;u<this.patchesPerFrame;u++){const l=new Float32Array(this.latentDim);for(let h=0;h<this.levels;h++){const m=u*this.levels+h,f=m<i.length?i[m]:-1;if(f<0)continue;const{level:g,code:p}=this.vocab.decodeCode(f);Hn(l,this.banks[d][g],p,this.latentDim)}c.push(s?l:Rt(n[u],l))}t.push(this.fromPatches(c)),n=c}return t}fit(e,t={}){const n=t.iterations??8,r=new ne((t.seed??1718187041)>>>0||1);for(const c of e)this.assertShape(c);const a=[],s=[];for(const c of e){let u=null;for(let l=0;l<c.length;l++){const h=this.toPatches(c[l]);if(u===null||l%this.keyframeInterval===0)for(const f of h)a.push(f);else for(let f=0;f<h.length;f++)s.push(jt(h[f],u[f]));u=h}}this.fitBank(Ne,a,n,r),this.fitBank(Qe,s,n,r);let d=0,i=0;for(const c of e){const u=this.decode(this.encode(c));for(let l=0;l<c.length;l++){const h=c[l],m=u[l];for(let f=0;f<h.length;f++){const g=h[f]-m[f];d+=g*g}i+=h.length}}return i>0?d/i:0}fitBank(e,t,n,r){if(t.length===0)return;let a=t.map(s=>Float32Array.from(s));for(let s=0;s<this.levels;s++){const d=Vn(a,this.codebookSize,this.latentDim,n,r);this.banks[e][s]=d,a=a.map(i=>{const c=st(d,i,this.codebookSize,this.latentDim),u=Float32Array.from(i),l=c*this.latentDim;for(let h=0;h<this.latentDim;h++)u[h]=u[h]-d[l+h];return u})}}rvqEncode(e,t){const n=Float32Array.from(t),r=new Float32Array(this.latentDim),a=[];for(let s=0;s<this.levels;s++){const d=this.banks[e][s],i=st(d,n,this.codebookSize,this.latentDim);a.push(i);const c=i*this.latentDim;for(let u=0;u<this.latentDim;u++)r[u]=r[u]+d[c+u],n[u]=n[u]-d[c+u]}return{codes:a,recon:r}}toPatches(e){const{patch:t,channels:n,width:r}=this,a=this.width/t,s=this.height/t,d=[];for(let i=0;i<s;i++)for(let c=0;c<a;c++){const u=new Float32Array(this.latentDim);for(let l=0;l<t;l++)for(let h=0;h<t;h++){const m=i*t+l,f=c*t+h,g=(m*r+f)*n,p=(l*t+h)*n;for(let w=0;w<n;w++)u[p+w]=e[g+w]}d.push(u)}return d}fromPatches(e){const{patch:t,channels:n,width:r}=this,a=this.width/t,s=new Float32Array(this.height*this.width*n);for(let d=0;d<e.length;d++){const i=Math.floor(d/a),c=d-i*a,u=e[d];for(let l=0;l<t;l++)for(let h=0;h<t;h++){const m=i*t+l,f=c*t+h,g=(m*r+f)*n,p=(l*t+h)*n;for(let w=0;w<n;w++)s[g+w]=qn(u[p+w])}}return s}assertShape(e){const t=this.height*this.width*this.channels;for(let n=0;n<e.length;n++)if(e[n].length!==t)throw new Error(`VideoRVQCodec: frame ${n} has length ${e[n].length}, expected ${t}`)}}function jt(o,e){const t=new Float32Array(o.length);for(let n=0;n<o.length;n++)t[n]=o[n]-e[n];return t}function Rt(o,e){const t=new Float32Array(o.length);for(let n=0;n<o.length;n++)t[n]=o[n]+e[n];return t}function Hn(o,e,t,n){const r=t*n;for(let a=0;a<n;a++)o[a]=o[a]+e[r+a]}function qn(o){return o<0?0:o>1?1:o}function st(o,e,t,n){let r=0,a=1/0;for(let s=0;s<t;s++){const d=s*n;let i=0;for(let c=0;c<n;c++){const u=e[c]-o[d+c];if(i+=u*u,i>=a)break}i<a&&(a=i,r=s)}return r}function Vn(o,e,t,n,r){const a=new Float32Array(e*t);for(let i=0;i<e;i++){const c=o[Math.floor(r.next()*o.length)%o.length];a.set(c,i*t)}const s=new Float32Array(e*t),d=new Int32Array(e);for(let i=0;i<n;i++){s.fill(0),d.fill(0);for(const c of o){const u=st(a,c,e,t);d[u]=d[u]+1;const l=u*t;for(let h=0;h<t;h++)s[l+h]=s[l+h]+c[h]}for(let c=0;c<e;c++){const u=c*t;if(d[c]===0){const h=o[Math.floor(r.next()*o.length)%o.length];a.set(h,u);continue}const l=1/d[c];for(let h=0;h<t;h++)a[u+h]=s[u+h]*l}}return a}function Xn(){const o=new Map,e=[[33,126],[161,172],[174,255]];let t=0;for(const[n,r]of e)for(let a=n;a<=r;a++)o.set(a,String.fromCodePoint(a));for(let n=0;n<256;n++)o.has(n)||(o.set(n,String.fromCodePoint(256+t)),t++);return o}const ze=Xn(),Yn=new Map([...ze].map(([o,e])=>[e,o])),Ot=new RegExp("(?:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}{1,3}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+","gu");class Fe{constructor(){_(this,"vocab");_(this,"idToToken");_(this,"merges");_(this,"bosToken");_(this,"eosToken");_(this,"padToken");_(this,"unkToken");_(this,"bosId");_(this,"eosId");_(this,"padId");this.vocab=new Map,this.idToToken=new Map,this.merges=new Map,this.bosToken="<|im_start|>",this.eosToken="<|im_end|>",this.padToken="<|endoftext|>",this.unkToken="<unk>",this.bosId=null,this.eosId=null,this.padId=null}async load(e,t){let n;typeof e=="string"?n=await(await fetch(e)).json():n=e,this.vocab=new Map(Object.entries(n).map(([a,s])=>[a,Number(s)])),this.idToToken=new Map([...this.vocab].map(([a,s])=>[s,a]));let r;typeof t=="string"?r=(await(await fetch(t)).text()).split(`
`).filter(d=>d&&!d.startsWith("#")):r=t,this.merges=new Map,r.forEach((a,s)=>{this.merges.set(a.trim(),s)}),this.bosId=this.vocab.get(this.bosToken)??null,this.eosId=this.vocab.get(this.eosToken)??null,this.padId=this.vocab.get(this.padToken)??null}train(e,t={}){const n=t.numMerges??200,r=t.minPairFreq??2,a=Array.isArray(e)?e:[e],s=new Map;for(const l of a)for(const h of l.match(Ot)??[]){const m=new TextEncoder().encode(h),f=Array.from(m).map(g=>ze.get(g)??"?").join("");s.set(f,(s.get(f)??0)+1)}const d=[...s].map(([l,h])=>({syms:[...l],freq:h})),i=[];for(let l=0;l<n;l++){const h=new Map;for(const{syms:b,freq:y}of d)for(let k=0;k<b.length-1;k++){const S=b[k]+" "+b[k+1];h.set(S,(h.get(S)??0)+y)}let m="",f=0;for(const[b,y]of h)y>f&&(m=b,f=y);if(f<r)break;i.push(m);const g=m.indexOf(" "),p=m.slice(0,g),w=m.slice(g+1),v=p+w;for(const b of d){const y=[];for(let k=0;k<b.syms.length;k++)k<b.syms.length-1&&b.syms[k]===p&&b.syms[k+1]===w?(y.push(v),k++):y.push(b.syms[k]);b.syms=y}}const c={};let u=0;for(const l of[this.unkToken,this.bosToken,this.eosToken,this.padToken])l in c||(c[l]=u++);for(const l of ze.values())l in c||(c[l]=u++);for(const l of i){const h=l.split(" ").join("");h in c||(c[h]=u++)}this.loadFromObjects(c,i)}loadFromObjects(e,t){this.vocab=new Map(Object.entries(e).map(([n,r])=>[n,Number(r)])),this.idToToken=new Map([...this.vocab].map(([n,r])=>[r,n])),this.merges=new Map(t.map((n,r)=>[n,r])),this.bosId=this.vocab.get(this.bosToken)??null,this.eosId=this.vocab.get(this.eosToken)??null,this.padId=this.vocab.get(this.padToken)??null}loadHuggingFace(e,t={}){const n=e.model??e,r=n.vocab??e.vocab,a=n.merges??e.merges;if(!r||typeof r!="object")throw new Error("loadHuggingFace: missing model.vocab (expected a Hugging Face tokenizer.json)");if(!Array.isArray(a))throw new Error("loadHuggingFace: missing model.merges (expected a BPE tokenizer.json)");const s=a.map(d=>Array.isArray(d)?`${d[0]} ${d[1]}`:String(d));t.bos&&(this.bosToken=t.bos),t.eos&&(this.eosToken=t.eos),t.pad&&(this.padToken=t.pad),t.unk&&(this.unkToken=t.unk),this.loadFromObjects(r,s)}toObject(){return{vocab:Object.fromEntries(this.vocab),merges:[...this.merges.entries()].sort((e,t)=>e[1]-t[1]).map(([e])=>e),specials:{bos:this.bosToken,eos:this.eosToken,pad:this.padToken,unk:this.unkToken}}}loadFromSpec(e){const t=e.specials;t!=null&&t.bos&&(this.bosToken=t.bos),t!=null&&t.eos&&(this.eosToken=t.eos),t!=null&&t.pad&&(this.padToken=t.pad),t!=null&&t.unk&&(this.unkToken=t.unk),this.loadFromObjects(e.vocab,e.merges)}serialize(){const e=new TextEncoder().encode(JSON.stringify(this.toObject())),t=new ArrayBuffer(e.byteLength);return new Uint8Array(t).set(e),t}static deserialize(e){const t=JSON.parse(new TextDecoder().decode(new Uint8Array(e)));if(!t||typeof t.vocab!="object"||!Array.isArray(t.merges))throw new Error("BPETokenizer.deserialize: not a serialised BPE tokenizer (expected { vocab, merges })");const n=new Fe;return n.loadFromSpec(t),n}async loadHuggingFaceUrl(e,t={}){const n=await fetch(e);if(!n.ok)throw new Error(`loadHuggingFaceUrl: ${n.status} fetching ${e}`);const r=await n.json();this.loadHuggingFace(r,t)}encode(e,t={}){const n=e.match(Ot)??[],r=[];t.addBos&&this.bosId!==null&&r.push(this.bosId);for(const a of n){const s=new TextEncoder().encode(a),d=Array.from(s).map(c=>ze.get(c)??"?").join(""),i=this._bpe(d);for(const c of i){const u=this.vocab.get(c);if(u!==void 0)r.push(u);else for(const l of c){const h=this.vocab.get(l);h!==void 0&&r.push(h)}}}return t.addEos&&this.eosId!==null&&r.push(this.eosId),r}decode(e){let t="";for(const r of e){const a=this.idToToken.get(r);a!==void 0&&(t+=a)}const n=new Uint8Array([...t].map(r=>Yn.get(r)??r.codePointAt(0)??0));try{return new TextDecoder("utf-8").decode(n)}catch{return t}}_bpe(e){if(this.vocab.has(e))return[e];let t=[...e];for(;t.length>1;){let n=1/0,r=-1;for(let s=0;s<t.length-1;s++){const d=t[s]+" "+t[s+1],i=this.merges.get(d);i!==void 0&&i<n&&(n=i,r=s)}if(r===-1)break;const a=t[r]+t[r+1];t=[...t.slice(0,r),a,...t.slice(r+2)]}return t}padOrTruncate(e,t,n="right"){if(e.length>=t)return e.slice(0,t);const r=this.padId??0,a=new Array(t-e.length).fill(r);return n==="right"?[...e,...a]:[...a,...e]}get vocabSize(){return this.vocab.size}}const Ut=1163283761,xe=12,Qn=1;function ae(o){let e=2166136261;for(let t=0;t<o.length;t++)e^=o[t],e=Math.imul(e,16777619);return e>>>0}class ee{constructor(e,t,n,r){_(this,"manifest");_(this,"checkpoint");_(this,"codec");_(this,"tokenizer");this.manifest=e,this.checkpoint=t,this.codec=n,this.tokenizer=r}static _tokenizerSection(e,t){if(!e.tokenizer)return{fields:{}};const n=e.tokenizer.vocabSize;if(t!=null&&n!==t)throw new Error(`EvermindModelPackage: tokenizer vocabSize (${n}) must equal the model's (${t}) — a mismatched pair decodes to nonsense.`);const r=e.tokenizer.serialize();return{blob:r,fields:{tokenizerFormat:"BPE0",tokenizerBytes:r.byteLength,tokenizerChecksum:ae(new Uint8Array(r)),tokenizerVocabSize:n}}}static fromModel(e,t){const n=t.fp16??!1,r=e.exportWeights({fp16:n}),a=ee._tokenizerSection(t,void 0),s={schema:"evermind.model/1",name:t.name,version:t.version,modelType:"shared-expert-moe",config:e.config,paramCount:e.parameters().reduce((d,i)=>d+i.numel,0),checkpointFormat:"MoE0",checkpointFp16:n,...a.blob?{checkpointBytes:r.byteLength}:{},checksum:ae(new Uint8Array(r)),...a.fields,card:t.card,...t.createdAt?{createdAt:t.createdAt}:{}};return new ee(s,r,void 0,a.blob)}static fromLM(e,t){const n=t.fp16??!1,r=e.exportWeights({fp16:n}),a=ee._tokenizerSection(t,e.config.vocabSize),s={schema:"evermind.model/1",name:t.name,version:t.version,modelType:"evermind-lm",config:e.config,paramCount:e.parameters().reduce((d,i)=>d+i.data.length,0),checkpointFormat:"EVL0",checkpointFp16:n,...a.blob?{checkpointBytes:r.byteLength}:{},checksum:ae(new Uint8Array(r)),...a.fields,card:t.card,...t.createdAt?{createdAt:t.createdAt}:{}};return new ee(s,r,void 0,a.blob)}static fromMediaLM(e,t,n){if(e.config.vocabSize!==t.vocabSize)throw new Error(`fromMediaLM: LM vocabSize (${e.config.vocabSize}) must equal codec.vocabSize (${t.vocabSize})`);const r=n.fp16??!1,a=e.exportWeights({fp16:r}),s=t.serialize(),d=ee._tokenizerSection(n,e.config.vocabSize),i={schema:"evermind.model/1",name:n.name,version:n.version,modelType:"evermind-lm",modality:n.modality,config:e.config,paramCount:e.parameters().reduce((c,u)=>c+u.data.length,0),checkpointFormat:"EVL0",checkpointFp16:r,checkpointBytes:a.byteLength,checksum:ae(new Uint8Array(a)),codecFormat:"VRQ0",...d.blob?{codecBytes:s.byteLength}:{},codecChecksum:ae(new Uint8Array(s)),...d.fields,card:n.card,...n.createdAt?{createdAt:n.createdAt}:{}};return new ee(i,a,s,d.blob)}toBlob(){var i,c;const e=new TextEncoder().encode(JSON.stringify(this.manifest)),t=xe,n=((i=this.codec)==null?void 0:i.byteLength)??0,r=((c=this.tokenizer)==null?void 0:c.byteLength)??0,a=new ArrayBuffer(t+e.byteLength+this.checkpoint.byteLength+n+r),s=new Uint32Array(a,0,3);s[0]=Ut,s[1]=Qn,s[2]=e.byteLength;let d=t;return new Uint8Array(a,d,e.byteLength).set(e),d+=e.byteLength,new Uint8Array(a,d,this.checkpoint.byteLength).set(new Uint8Array(this.checkpoint)),d+=this.checkpoint.byteLength,this.codec&&(new Uint8Array(a,d,n).set(new Uint8Array(this.codec)),d+=n),this.tokenizer&&new Uint8Array(a,d,r).set(new Uint8Array(this.tokenizer)),a}withCheckpoint(e,t=this.manifest.version){const n={...this.manifest,version:t,...this.manifest.checkpointBytes!==void 0?{checkpointBytes:e.byteLength}:{},checksum:ae(new Uint8Array(e))};return new ee(n,e,this.codec,this.tokenizer)}static manifestEnd(e){if(e.byteLength<xe)throw new Error("EvermindModelPackage: truncated (no header)");const t=new Uint32Array(e,0,3);if(t[0]!==Ut)throw new Error("EvermindModelPackage: bad magic (not an .evermind package)");return xe+t[2]}static readManifest(e){const t=ee.manifestEnd(e);if(t>e.byteLength)throw new Error("EvermindModelPackage: truncated (manifest length exceeds blob)");const n=new Uint8Array(e,xe,t-xe);return JSON.parse(new TextDecoder().decode(n))}static fromBlob(e){const t=ee.readManifest(e),n=ee.manifestEnd(e),r=t.checkpointBytes;if(r==null)return new ee(t,e.slice(n));if(n+r>e.byteLength)throw new Error("EvermindModelPackage.fromBlob: truncated (checkpointBytes exceeds blob)");const a=e.slice(n,n+r);let s=n+r;const d=t.tokenizerBytes??0;if(s+d>e.byteLength)throw new Error("EvermindModelPackage.fromBlob: truncated (tokenizerBytes exceeds blob)");const i=e.byteLength-d;let c;if(s<i){const l=t.codecBytes!=null?s+t.codecBytes:i;if(l>i)throw new Error("EvermindModelPackage.fromBlob: truncated (codecBytes overruns the tokenizer section)");c=e.slice(s,l),s=l}const u=d>0?e.slice(i):void 0;return new ee(t,a,c,u)}validate(){var a;const e=[];this.manifest.schema!=="evermind.model/1"&&e.push(`unknown schema: ${this.manifest.schema}`);const t=this.manifest.config;this.manifest.modelType==="shared-expert-moe"?(!t||t.modelDim<=0||t.hiddenDim<=0||t.numExperts<=0||t.topK<1||t.topK>t.numExperts)&&e.push("invalid config"):this.manifest.modelType==="evermind-lm"?(!t||t.vocabSize<=0||t.dModel<=0||t.numLayers<=0||t.numExperts<=0||t.topK<1||t.topK>t.numExperts)&&e.push("invalid config"):e.push(`unsupported modelType: ${String(this.manifest.modelType)}`);const n=ae(new Uint8Array(this.checkpoint));n!==this.manifest.checksum&&e.push(`checksum mismatch (manifest ${this.manifest.checksum}, actual ${n}) — corrupt or tampered checkpoint`);const r=this.manifest.modality??"text";if(r==="video"||r==="image")if(!this.codec)e.push(`modality '${r}' package is missing its codec section`);else{const s=ae(new Uint8Array(this.codec));s!==this.manifest.codecChecksum&&e.push(`codec checksum mismatch (manifest ${this.manifest.codecChecksum}, actual ${s}) — corrupt codec`)}if(this.manifest.tokenizerFormat)if(!this.tokenizer)e.push("manifest declares an embedded tokenizer but the package has no tokenizer section");else{const s=ae(new Uint8Array(this.tokenizer));s!==this.manifest.tokenizerChecksum&&e.push(`tokenizer checksum mismatch (manifest ${this.manifest.tokenizerChecksum}, actual ${s}) - corrupt tokenizer`);const d=(a=this.manifest.config)==null?void 0:a.vocabSize,i=this.manifest.tokenizerVocabSize;d!=null&&i!=null&&d!==i&&e.push(`tokenizer vocabSize (${i}) does not match the model's (${d})`)}return{ok:e.length===0,errors:e}}loadTokenizer(){if(!this.manifest.tokenizerFormat||!this.tokenizer)return null;const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadTokenizer: ${e.errors.join("; ")}`);return Fe.deserialize(this.tokenizer)}loadModel(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadModel: ${e.errors.join("; ")}`);if(this.manifest.modelType!=="shared-expert-moe")throw new Error(`loadModel: package is '${this.manifest.modelType}', use loadLM()`);const t=new wr(this.manifest.config);return t.loadWeights(this.checkpoint),t}loadLM(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadLM: ${e.errors.join("; ")}`);if(this.manifest.modelType!=="evermind-lm")throw new Error(`loadLM: package is '${this.manifest.modelType}', use loadModel()`);const t=new He(this.manifest.config);return t.loadWeights(this.checkpoint),t}loadMediaLM(){const e=this.validate();if(!e.ok)throw new Error(`EvermindModelPackage.loadMediaLM: ${e.errors.join("; ")}`);const t=this.manifest.modality??"text";if(t!=="video"&&t!=="image")throw new Error(`loadMediaLM: package modality is '${t}', use loadLM()`);return{lm:this.loadLM(),codec:qe.deserialize(this.codec),modality:t}}}const Jn=Math.LN2;function Zn(o,e){const t=o.length,n=Math.max(1,Math.min(e,t)),r=[],a=new Uint8Array(t);for(let s=0;s<n;s++){let d=-1,i=-1/0;for(let c=0;c<t;c++){if(a[c])continue;const u=o[c];u>i&&(i=u,d=c)}if(d<0)break;a[d]=1,r.push(d)}return r}function eo(o){let e=0,t=-1/0;for(let n=0;n<o.length;n++)o[n]>t&&(t=o[n],e=n);return e}function to(o){return Math.exp(o)}function ro(o){return o/Jn}function Lr(){return{tokens:0,ceSum:0,top1Hits:0,topKHits:0}}function Sr(o,e,t,n){const r=Math.min(e.length,t.length);for(let a=0;a<r;a++){const s=t[a],d=e[a];s<0||s>=d.length||(o.ceSum+=ye(d,s),eo(d)===s&&o.top1Hits++,Zn(d,n).includes(s)&&o.topKHits++,o.tokens++)}}function yt(){var e;const o=globalThis;return typeof((e=o.performance)==null?void 0:e.now)=="function"?o.performance.now():Date.now()}function Er(o){return o.slice(1)}function Br(o,e,t,n){const r=o.tokens>0?o.ceSum/o.tokens:0,a={sequences:e,tokens:o.tokens,crossEntropy:r,perplexity:to(r),bitsPerToken:ro(r),top1Accuracy:o.tokens>0?o.top1Hits/o.tokens:0,topKAccuracy:o.tokens>0?o.topKHits/o.tokens:0,topK:t};return n!==void 0&&(a.elapsedMs=n,a.tokensPerSecond=n>0?o.tokens/n*1e3:0),a}function We(o,e,t={}){const n=t.topK??5,r=t.measureLatency??!0,a=t.now??yt,s=Lr();let d=0,i=0;for(const c of e){if(c.length<2)continue;const u=r?a():0,{logits:l}=o.forward(c);r&&(i+=a()-u),Sr(s,l,Er(c),n),d++}return Br(s,d,n,r?i:void 0)}async function Ss(o,e,t={}){const n=t.topK??5,r=t.measureLatency??!0,a=t.now??yt,s=Lr();let d=0,i=0;for(const c of e){if(c.length<2)continue;const u=r?a():0,{logits:l}=await o.forward(c);r&&(i+=a()-u),Sr(s,l,Er(c),n),d++}return Br(s,d,n,r?i:void 0)}function Es(o,e,t,n={}){return no(We(o,t,n),We(e,t,n))}function no(o,e){const t=o.perplexity-e.perplexity,n=e.perplexity>0?o.perplexity/e.perplexity:1/0,r=o.top1Accuracy-e.top1Accuracy,a=.005;let s;Math.abs(n-1)<=a?s="tie":s=t<0?"candidate":"baseline";const d=((1-n)*100).toFixed(1),i=s==="tie"?`Tie: perplexity ${o.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)}`:s==="candidate"?`Candidate wins: ${d}% lower perplexity (${o.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`:`Baseline wins: candidate ${(-Number(d)).toFixed(1)}% higher perplexity (${o.perplexity.toFixed(2)} vs ${e.perplexity.toFixed(2)})`;return{candidate:o,baseline:e,perplexityDelta:t,perplexityRatio:n,top1Delta:r,winner:s,summary:i}}function Dr(o,e){return o.split(new RegExp("(?<=\\.)\\s+")).map(t=>e.encode(t.trim())).filter(t=>t.length>=2)}function Bs(o,e,t,n={}){return We(o,Dr(t,e),n)}function oo(o,e){for(let t=o.length-1;t>0;t--){const n=Math.floor(e.next()*(t+1)),r=o[t];o[t]=o[n],o[n]=r}return o}function Ds(o,e={}){const t=e.seed??7,n=new Fe;n.train(o,{numMerges:e.numMerges??100});const r=Dr(o,n);if(r.length<2)throw new Error(`corpus produced ${r.length} trainable sequence(s); need at least 2 to hold out an eval split (add more sentences)`);const a=oo([...r],new ne(t>>>0||1)),s=Math.min(.9,Math.max(.05,e.heldOutRatio??.25));let d=Math.round(a.length*s);d=Math.max(1,Math.min(a.length-1,d));const i=a.slice(0,d),c=a.slice(d),u=new He({vocabSize:n.vocabSize,dModel:e.dModel??32,numLayers:e.numLayers??2,hiddenDim:e.hiddenDim??48,seed:t}),l=e.epochs??30,h=new wt(u,{lr:e.lr??.03,epochs:l}).fit(c),m=We(u,i,{topK:e.topK??5,measureLatency:!0}),f=u.generateText(e.prompt??"The",n,{maxNewTokens:8,temperature:0});return{...m,trainSequences:c.length,evalSequences:i.length,initialTrainLoss:h[0]??0,finalTrainLoss:h.at(-1)??0,vocabSize:n.vocabSize,sample:f}}function Fr(o,e){const t=[],n=Math.max(1,Math.floor(e));for(let r=0;r+1<o.length;r+=n){const a=o.slice(r,r+n);a.length>=2&&t.push(a)}return t}function ao(o,e){const t=Math.min(1,Math.max(0,e));return Math.round(o*(1-t))}const so=["The planning loop retrieves context before generating a response.","Agents recall facts from the memory layer and act on them.","Deployment runs on Cloudflare Workers and Durable Objects.","Tools are gated by a capability registry and a policy pack.","The coordinator merges weight deltas from every contributing host.","A ticket moves through triage, execution, review and merge.","Recall is ranked by embedding cosine fused with lexical scoring.","The trainer adapts a private copy of the base checkpoint locally."].join(" ");function io(o){let e=0;for(const t of o.parameters())e+=t.data.length;return e}function Fs(o={}){const e=o.text??so,t=o.windowTokens??[32,64,128],n=o.epochs??[1,2,4],r=o.skipRates??[0,.5],a=Math.max(1,o.requests??4),s=o.dModel??32,d=o.numLayers??2,i=o.hiddenDim??48,c=o.seed??7,u=o.lr??.01,l=o.now??yt,h=new Fe;h.train(e,{numMerges:o.numMerges??120});const m=h.encode(e),f=()=>new He({vocabSize:h.vocabSize,dModel:s,numLayers:d,hiddenDim:i,seed:c}),g=[];for(const p of t){const w=Fr(m,p);for(const v of n)for(const b of r){const y=ao(a,b),k=f();k.resetStats();const S=l();for(let P=0;P<y;P++)new wt(k,{lr:u,epochs:v,accumSteps:1}).fit(w);const N=l()-S,L=k.positionsEvaluated,D=w.length*y;g.push({windowTokens:p,epochs:v,skipRate:b,requests:a,adapted:y,sequences:D,optimizerSteps:D*v,positionsEvaluated:L,elapsedMs:N,msPerKPosition:L>0?N/L*1e3:0,msPerAdaptation:y>0?N/y:0})}}return{points:g,textTokens:m.length,vocabSize:h.vocabSize,dModel:s,numLayers:d,hiddenDim:i,paramCount:io(f())}}function Cs(o){const e=`Evermind adaptation cost — dModel=${o.dModel} layers=${o.numLayers} hidden=${o.hiddenDim} params=${o.paramCount.toLocaleString()} vocab=${o.vocabSize} textTokens=${o.textTokens}`,t=["window","epochs","skip","adapts","seqs","steps","positions","ms","ms/adapt","ms/1k pos"],n=o.points.map(s=>[String(s.windowTokens),String(s.epochs),s.skipRate.toFixed(2),`${s.adapted}/${s.requests}`,String(s.sequences),String(s.optimizerSteps),String(s.positionsEvaluated),s.elapsedMs.toFixed(1),s.msPerAdaptation.toFixed(1),s.msPerKPosition.toFixed(3)]),r=t.map((s,d)=>Math.max(s.length,...n.map(i=>i[d].length))),a=s=>s.map((d,i)=>d.padStart(r[i])).join("  ");return[e,"",a(t),a(r.map(s=>"-".repeat(s))),...n.map(a)].join(`
`)}const co=4e3,lo=64;function uo(o,e,t,n={}){const r=n.maxChars??co,a=n.windowTokens??lo,s=Fr(e.encode(t.slice(0,r)),a);if(s.length===0)return null;const d=o.loadLM(),i=new wt(d,{epochs:n.epochs??1}).fit(s),c=i.length>0?i[i.length-1]:0;return{diff:jn(o.checkpoint,d.exportWeights()),loss:c,sequences:s.length}}function Ps(o,e,t,n,r={}){const a=uo(o,e,t,r);return a?{pkg:o.withCheckpoint(Mr(o.checkpoint,a.diff),n),loss:a.loss,sequences:a.sequences}:null}const Gt=32768;function ho(o){const e=o instanceof Uint8Array?o:new Uint8Array(o);let t="";for(let n=0;n<e.length;n+=Gt)t+=String.fromCharCode.apply(null,Array.from(e.subarray(n,n+Gt)));return btoa(t)}function fo(o){const e=atob(o),t=new Uint8Array(e.length);for(let n=0;n<e.length;n++)t[n]=e.charCodeAt(n);return t.buffer}const Kt=8*1024*1024,Cr=800,mo=/^[A-Za-z0-9+/]+={0,2}$/;function Ts(o){const e=o&&typeof o=="object"?o:{},t=typeof e.diff=="string"?e.diff:"",n=typeof e.baseVersion=="number"?e.baseVersion:Number.NaN;if(!t||!Number.isInteger(n))return{ok:!1,reason:"invalid",error:"diff (base64) and baseVersion (integer head version the delta was taken against) are required"};if(t.length>Kt)return{ok:!1,reason:"too-large",error:`delta too large (max ${Kt} base64 characters)`};if(t.length%4!==0||!mo.test(t))return{ok:!1,reason:"invalid",error:"diff must be standard base64"};const r=typeof e.weight=="number"&&Number.isFinite(e.weight)&&e.weight>0?e.weight:void 0,a=typeof e.label=="string"&&e.label.trim()?e.label.trim().slice(0,Cr):void 0;return{ok:!0,payload:{diff:t,baseVersion:n,...r!==void 0?{weight:r}:{},...a?{label:a}:{}}}}function Ns(o,e,t,n){const r=(n??"").trim();return{diff:ho(o),baseVersion:e,...typeof t=="number"&&Number.isFinite(t)&&t>0?{weight:t}:{},...r?{label:r.slice(0,Cr)}:{}}}function $s(o){return fo(o.diff)}function Is(o,e){try{const t=Ke(o);if(t.rowSize!==1)return`expected an element-granular delta (rowSize 1), got ${t.rowSize}`;const n=ce(e).body.byteLength/4;for(let r=0;r<t.rows.length;r++){const a=t.rows[r];if(!Number.isInteger(a)||a<0||a>=n)return`row index ${a} is outside the base checkpoint (${n} elements)`;if(!Number.isFinite(t.data[r]))return`non-finite value at row ${a}`}return null}catch(t){return`not a serialized RowDelta: ${t instanceof Error?t.message:String(t)}`}}function zs(o,e,t){if(e.length===0)return{checkpoint:o,mergedRows:0,contributors:0,deltaNorm:0};if(t&&t.length!==e.length)throw new Error(`mergeCheckpointDiffs: weights length ${t.length} != diffs length ${e.length}`);const n=e.map(l=>Ke(l));for(const l of n)if(l.rowSize!==1)throw new Error(`mergeCheckpointDiffs: expected element-granular deltas (rowSize 1), got ${l.rowSize}`);const r=new Map;if(n.forEach((l,h)=>{const m=t?t[h]:1;m>0&&l.rows.forEach((f,g)=>{const p=l.data[g],w=r.get(f);w?(w.sum+=m*p,w.weight+=m):r.set(f,{sum:m*p,weight:m})})}),r.size===0)return{checkpoint:o,mergedRows:0,contributors:n.length,deltaNorm:0};const a=[...r.keys()].sort((l,h)=>l-h),s=new Float32Array(a.length);a.forEach((l,h)=>{const m=r.get(l);s[h]=m.sum/m.weight});const d=new Float32Array(ce(o).body);let i=0;return a.forEach((l,h)=>{const m=s[h]-(d[l]??0);i+=m*m}),{checkpoint:Mr(o,bt({rowSize:1,rows:a,data:s})),mergedRows:a.length,contributors:n.length,deltaNorm:Math.sqrt(i)}}const po=128;function go(o,e){if(e.length<2)return null;const{logits:t}=o.forward(e),n=Math.min(t.length,e.length)-1;if(n<1)return null;let r=0;for(let s=0;s<n;s++)r+=ye(t[s],e[s+1]);const a=r/n;return Number.isFinite(a)&&a>=0?a:null}function Ws(o,e,t,n=po){let r=0,a=0;for(const s of t){const d=(s.prompt?`${s.prompt}
`:"")+s.text,i=go(o,e.encode(d).slice(0,n));i!=null&&(r+=i,a++)}return a>0?r/a:null}class js{constructor(e,t,n){_(this,"model");_(this,"codec");_(this,"dimensions");_(this,"fingerprint");this.model=e,this.codec=t,this.dimensions=e.config.dModel,this.fingerprint=n??_o(e)}async embed(e){return this.embedSync(e)}embedSync(e){return this.model.embedText(e,this.codec)}}function _o(o){const e=o.config,t=new Uint8Array(o.emb.buffer,o.emb.byteOffset,o.emb.byteLength);return`evermind-lm/${[e.vocabSize,e.dModel,e.numLayers,e.convKernel,e.hiddenDim,e.numExperts,e.topK].join("-")}/${pt(t).toString(16)}`}const Ht=1280266817;class Se{constructor(e,t,n={}){_(this,"rows");_(this,"cols");_(this,"rank");_(this,"alpha");_(this,"scale");_(this,"B");_(this,"A");_(this,"gB");_(this,"gA");if(e<=0||t<=0)throw new Error("LoRAAdapter: rows and cols must be > 0");const r=n.rank??8;if(r<=0||r>Math.min(e,t))throw new Error(`LoRAAdapter: rank must be in [1, min(rows,cols)=${Math.min(e,t)}]`);this.rows=e,this.cols=t,this.rank=r,this.alpha=n.alpha??r,this.scale=this.alpha/r,this.B=new Float32Array(e*r),this.A=new Float32Array(r*t);const a=new ne((n.seed??1282363969)>>>0||1),s=1/Math.sqrt(t);for(let d=0;d<this.A.length;d++){const i=Math.max(a.next(),1e-12),c=a.next();this.A[d]=s*Math.sqrt(-2*Math.log(i))*Math.cos(2*Math.PI*c)}this.gB=new Float32Array(this.B.length),this.gA=new Float32Array(this.A.length)}numParams(){return this.B.length+this.A.length}delta(){const{rows:e,cols:t,rank:n,scale:r}=this,a=new Float32Array(e*t);for(let s=0;s<e;s++){const d=s*n,i=s*t;for(let c=0;c<n;c++){const u=this.B[d+c]*r;if(u===0)continue;const l=c*t;for(let h=0;h<t;h++)a[i+h]=a[i+h]+u*this.A[l+h]}}return a}applyTo(e){if(e.length!==this.rows*this.cols)throw new Error("LoRAAdapter.applyTo: base length mismatch");const t=this.delta(),n=new Float32Array(e.length);for(let r=0;r<n.length;r++)n[r]=e[r]+t[r];return n}accumulateGradient(e){const{rows:t,cols:n,rank:r,scale:a}=this;if(e.length!==t*n)throw new Error("LoRAAdapter.accumulateGradient: gW length mismatch");for(let s=0;s<t;s++){const d=s*n,i=s*r;for(let c=0;c<r;c++){const u=c*n;let l=0;const h=this.B[i+c]*a;for(let m=0;m<n;m++){const f=e[d+m];l+=f*this.A[u+m],this.gA[u+m]=this.gA[u+m]+h*f}this.gB[i+c]=this.gB[i+c]+a*l}}}parameters(){return[{data:this.B},{data:this.A}]}gradients(){return[{data:this.gB},{data:this.gA}]}zeroGrad(){this.gB.fill(0),this.gA.fill(0)}serialize(){const n=new ArrayBuffer(20+(this.B.length+this.A.length)*4),r=new Uint32Array(n,0,5);r[0]=Ht,r[1]=this.rows,r[2]=this.cols,r[3]=this.rank,new Float32Array(n,16,1)[0]=this.alpha;const a=new Float32Array(n,20);return a.set(this.B,0),a.set(this.A,this.B.length),n}static deserialize(e){const t=new Uint32Array(e,0,5);if(t[0]!==Ht)throw new Error("LoRAAdapter.deserialize: bad magic");const n=t[1],r=t[2],a=t[3],s=new Float32Array(e,16,1)[0],d=new Se(n,r,{rank:a,alpha:s}),i=new Float32Array(e,20);return d.B.set(i.subarray(0,d.B.length)),d.A.set(i.subarray(d.B.length,d.B.length+d.A.length)),d}}function bo(o,e){switch(e){case"none":return{view:o,bytes:o.length*4};case"fp16":{const t=Be(o);return{view:De(t),bytes:t.length*2}}case"int8":{const t=Mn(o);return{view:Ln(t.data,t.scale),bytes:t.data.length+4}}}}class Pr{constructor(e,t={}){_(this,"model");_(this,"adapter");_(this,"baseQuant");_(this,"frozenBase");_(this,"baseBytesStored");_(this,"rows");_(this,"cols");this.model=e,this.rows=e.config.vocabSize,this.cols=e.config.dModel,this.baseQuant=t.baseQuant??"none";const{view:n,bytes:r}=bo(Float32Array.from(e.emb),this.baseQuant);this.frozenBase=n,this.baseBytesStored=r,this.adapter=new Se(this.rows,this.cols,t)}get baseModel(){return this.model}mergedEmb(){return this.adapter.applyTo(this.frozenBase)}_accumulate(e){const t=this.mergedEmb(),n=this.model.emb;this.model.emb=t,this.model.zeroGrad();const r=this.model.lossAndBackward(e),a=this.model.gradients()[0].data;return this.adapter.accumulateGradient(a),this.model.emb=n,r}fit(e,t={}){const n=t.epochs??1,r=Math.max(1,t.accumSteps??1),a=new gt(this.adapter,t),s=this.adapter.gradients(),d=[];for(let i=0;i<n;i++){let c=0,u=0,l=0;this.adapter.zeroGrad();const h=()=>{if(l!==0){if(l!==1)for(const m of s)for(let f=0;f<m.data.length;f++)m.data[f]=m.data[f]/l;a.step(),this.adapter.zeroGrad(),l=0}};for(const m of e)m.length<2||(c+=this._accumulate(m),u++,++l>=r&&h());h(),d.push(u>0?c/u:0)}return d}generate(e,t){const n=this.model.emb;this.model.emb=this.mergedEmb();try{return this.model.generate(e,t)}finally{this.model.emb=n}}generateText(e,t,n){return t.decode(this.generate(t.encode(e),n))}serializeAdapter(){return this.adapter.serialize()}static loadAdapter(e,t,n="none"){const r=Se.deserialize(t),a=new Pr(e,{rank:r.rank,alpha:r.alpha,baseQuant:n});return a.adapter.B.set(r.B),a.adapter.A.set(r.A),a}merge(e={}){return this.model.emb.set(this.mergedEmb()),this.model.exportWeights(e)}footprint(){return{adapterBytes:this.adapter.serialize().byteLength,baseBytes:this.baseBytesStored,trainableParams:this.adapter.numParams(),baseParams:this.rows*this.cols}}}const Ce=1e-6;function Tr(o){return 1/(1+Math.exp(-o))}function qt(o){return o/(1+Math.exp(-o))}function Vt(o){const e=Tr(o);return e*(1+o*(1-e))}function wo(o){return Math.max(o,0)+Math.log1p(Math.exp(-Math.abs(o)))}function Ae(o,e,t,n,r,a,s){for(let d=0;d<n;d++){const i=d*r,c=d*a;for(let u=0;u<a;u++){let l=t[u];const h=u*r;for(let m=0;m<r;m++)l+=o[i+m]*e[h+m];s[c+u]=l}}}function $e(o,e,t,n,r,a,s,d,i){s.fill(0);for(let c=0;c<n;c++){const u=c*r,l=c*a;for(let h=0;h<a;h++){const m=o[l+h];if(m===0)continue;i[h]=i[h]+m;const f=h*r;for(let g=0;g<r;g++)s[u+g]=s[u+g]+m*t[f+g],d[f+g]=d[f+g]+m*e[u+g]}}}function Nr(o,e,t,n,r,a,s=Ce){for(let d=0;d<t;d++){const i=d*n;let c=0;for(let l=0;l<n;l++){const h=o[i+l];c+=h*h}const u=1/Math.sqrt(c/n+s);a[d]=u;for(let l=0;l<n;l++)r[i+l]=o[i+l]*u*e[l]}}function $r(o,e,t,n,r,a,s,d,i=Ce){for(let c=0;c<r;c++){const u=c*a,l=n[c];let h=0;for(let f=0;f<a;f++){const g=o[u+f]*t[f];h+=g*e[u+f],d[f]=d[f]+o[u+f]*e[u+f]*l}const m=l*l*l/a;for(let f=0;f<a;f++){const g=o[u+f]*t[f];s[u+f]=s[u+f]+g*l-m*h*e[u+f]}}}const vt=["wInProj","bInProj","wConv","bConv","wXProj","bXProj","wDtProj","bDtProj","A_log","D_vec","wOutProj","bOutProj","normWeight"],Ir=-10,zr=5;function yo(o){const{dModel:e,dState:t,dConv:n,dInner:r,dtRank:a}=o;return{wInProj:new Float32Array(2*r*e),bInProj:new Float32Array(2*r),wConv:new Float32Array(r*n),bConv:new Float32Array(r),wXProj:new Float32Array((a+2*t)*r),bXProj:new Float32Array(a+2*t),wDtProj:new Float32Array(r*a),bDtProj:new Float32Array(r),A_log:new Float32Array(r*t),D_vec:new Float32Array(r),wOutProj:new Float32Array(e*r),bOutProj:new Float32Array(e),normWeight:new Float32Array(e)}}function Wr(o,e,t){const{dModel:n,dState:r,dConv:a,dInner:s,dtRank:d,batch:i,seqLen:c}=t,u=i*c,l=d+2*r,h=new Float32Array(u*n),m=new Float32Array(u);Nr(o,e.normWeight,u,n,h,m);const f=new Float32Array(u*2*s);Ae(h,e.wInProj,e.bInProj,u,n,2*s,f);const g=new Float32Array(u*s),p=new Float32Array(u*s);for(let x=0;x<u;x++)for(let A=0;A<s;A++)g[x*s+A]=f[x*2*s+A],p[x*s+A]=f[x*2*s+s+A];const w=new Float32Array(u*s);for(let x=0;x<i;x++)for(let A=0;A<c;A++){const E=(x*c+A)*s;for(let j=0;j<s;j++){let V=e.bConv[j];for(let $=0;$<a;$++)A>=$&&(V+=e.wConv[j*a+$]*g[(x*c+A-$)*s+j]);w[E+j]=V}}const v=new Float32Array(u*s);for(let x=0;x<u*s;x++)v[x]=qt(w[x]);const b=new Float32Array(u*l);Ae(v,e.wXProj,e.bXProj,u,s,l,b);const y=new Float32Array(u*d),k=new Float32Array(u*r),S=new Float32Array(u*r);for(let x=0;x<u;x++){for(let A=0;A<d;A++)y[x*d+A]=b[x*l+A];for(let A=0;A<r;A++)k[x*r+A]=b[x*l+d+A],S[x*r+A]=b[x*l+d+r+A]}const N=new Float32Array(u*s);Ae(y,e.wDtProj,e.bDtProj,u,d,s,N);const L=new Float32Array(u*s);for(let x=0;x<u*s;x++)L[x]=wo(N[x]);const D=new Float32Array(s*r);for(let x=0;x<s*r;x++)D[x]=-Math.exp(Math.min(zr,Math.max(Ir,e.A_log[x])));const P=new Float32Array(u*s*r),U=new Float32Array(u*s*r),G=new Float32Array(u*s*r),H=new Float32Array(u*s);for(let x=0;x<i;x++)for(let A=0;A<c;A++){const E=x*c+A;for(let j=0;j<s;j++){const V=L[E*s+j],$=v[E*s+j];let T=e.D_vec[j]*$;for(let F=0;F<r;F++){const q=D[j*r+F],Z=Math.exp(V*q),X=(Z-1)/q*k[E*r+F],Y=(E*s+j)*r+F;P[Y]=Z,U[Y]=X;const oe=A===0?0:G[((E-1)*s+j)*r+F],he=Z*oe+X*$;G[Y]=he,T+=S[E*r+F]*he}H[E*s+j]=T}}const R=new Float32Array(u*s),K=new Float32Array(u*s);for(let x=0;x<u*s;x++)R[x]=qt(p[x]),K[x]=H[x]*R[x];const M=new Float32Array(u*n);Ae(K,e.wOutProj,e.bOutProj,u,s,n,M);for(let x=0;x<u*n;x++)M[x]=M[x]+o[x];return{output:M,cache:{x:o,normInv:m,normOut:h,xConvIn:g,z:p,convOut:w,u:v,dtRaw:y,bRaw:k,cRaw:S,deltaFull:N,dv:L,aCont:D,aBar:P,bBar:U,h:G,scanY:H,siluZ:R,gated:K}}}function vo(o,e,t,n,r){const{dModel:a,dState:s,dConv:d,dInner:i,dtRank:c,batch:u,seqLen:l}=n,h=u*l,m=c+2*s,f=new Float32Array(h*a);f.set(o);const g=new Float32Array(h*i);$e(o,t.gated,e.wOutProj,h,i,a,g,r.wOutProj,r.bOutProj);const p=new Float32Array(h*i),w=new Float32Array(h*i);for(let M=0;M<h*i;M++)p[M]=g[M]*t.siluZ[M],w[M]=g[M]*t.scanY[M]*Vt(t.z[M]);const v=new Float32Array(h*i),b=new Float32Array(h*s),y=new Float32Array(h*s),k=new Float32Array(h*i),S=new Float32Array(i*s),N=new Float32Array(i*s);for(let M=0;M<u;M++){N.fill(0);for(let x=l-1;x>=0;x--){const A=M*l+x;for(let E=0;E<i;E++){const j=p[A*i+E],V=t.u[A*i+E],$=t.dv[A*i+E];r.D_vec[E]=r.D_vec[E]+j*V,v[A*i+E]=v[A*i+E]+j*e.D_vec[E];let T=0;for(let F=0;F<s;F++){const q=(A*i+E)*s+F,Z=t.h[q],X=t.aBar[q],Y=t.bBar[q],oe=t.aCont[E*s+F],he=t.cRaw[A*s+F];y[A*s+F]=y[A*s+F]+j*Z;const Te=j*he+N[E*s+F],nn=x===0?0:t.h[((A-1)*i+E)*s+F],Mt=Te*nn,Xe=Te*V;v[A*i+E]=v[A*i+E]+Te*Y,N[E*s+F]=Te*X;const Lt=t.bRaw[A*s+F];T+=Mt*oe*X+Xe*X*Lt,S[E*s+F]=S[E*s+F]+Mt*$*X+Xe*Lt*(($*X*oe-(X-1))/(oe*oe)),b[A*s+F]=b[A*s+F]+Xe*((X-1)/oe)}k[A*i+E]=k[A*i+E]+T}}}for(let M=0;M<i*s;M++){const x=e.A_log[M];x<=Ir||x>=zr||(r.A_log[M]=r.A_log[M]+S[M]*t.aCont[M])}const L=new Float32Array(h*i);for(let M=0;M<h*i;M++)L[M]=k[M]*Tr(t.deltaFull[M]);const D=new Float32Array(h*c);$e(L,t.dtRaw,e.wDtProj,h,c,i,D,r.wDtProj,r.bDtProj);const P=new Float32Array(h*m);for(let M=0;M<h;M++){for(let x=0;x<c;x++)P[M*m+x]=D[M*c+x];for(let x=0;x<s;x++)P[M*m+c+x]=b[M*s+x],P[M*m+c+s+x]=y[M*s+x]}const U=new Float32Array(h*i);$e(P,t.u,e.wXProj,h,i,m,U,r.wXProj,r.bXProj);for(let M=0;M<h*i;M++)v[M]=v[M]+U[M];const G=new Float32Array(h*i);for(let M=0;M<h*i;M++)G[M]=v[M]*Vt(t.convOut[M]);const H=new Float32Array(h*i);for(let M=0;M<u;M++)for(let x=0;x<l;x++){const A=M*l+x;for(let E=0;E<i;E++){const j=G[A*i+E];if(j!==0){r.bConv[E]=r.bConv[E]+j;for(let V=0;V<d;V++){if(x<V)continue;const $=(M*l+x-V)*i+E;r.wConv[E*d+V]=r.wConv[E*d+V]+j*t.xConvIn[$],H[$]=H[$]+j*e.wConv[E*d+V]}}}}const R=new Float32Array(h*2*i);for(let M=0;M<h;M++)for(let x=0;x<i;x++)R[M*2*i+x]=H[M*i+x],R[M*2*i+i+x]=w[M*i+x];const K=new Float32Array(h*a);return $e(R,t.normOut,e.wInProj,h,a,2*i,K,r.wInProj,r.bInProj),$r(K,t.x,e.normWeight,t.normInv,h,a,f,r.normWeight,Ce),f}const Xt=["mamba1"];function xo(o){const e={dModel:o.dModel,dState:o.dState,dConv:o.dConv,dInner:o.dInner,dtRank:o.dtRank};return{embedding:new Float32Array(o.vocabSize*o.dModel),finalNorm:new Float32Array(o.dModel),lmHeadBias:new Float32Array(o.vocabSize),layers:Array.from({length:o.numLayers},()=>yo(e))}}function ko(o){const e=new Map;e.set("embedding",o.embedding);for(let t=0;t<o.layers.length;t++){const n=o.layers[t];for(const r of vt)e.set(`layer${t}.${r}`,n[r])}return e.set("final_norm",o.finalNorm),e.set("lm_head_bias",o.lmHeadBias),e}function Ao(o){const e=new Map;e.set("embedding",o.embedding);for(let t=0;t<o.layers.length;t++){const n=o.layers[t];for(const r of vt)e.set(`layer${t}.${r}`,n[r])}return e.set("final_norm",o.finalNorm),e.set("lm_head_bias",o.lmHeadBias),e}function Mo(o,e){const t=(u,l)=>{const h=o.get(u);if(!h)throw new Error(`cpuWeightsFromNamed: missing tensor "${u}"`);if(h.length!==l)throw new Error(`cpuWeightsFromNamed: "${u}" has ${h.length} elements, expected ${l}`);return h},{dModel:n,dState:r,dConv:a,dInner:s,dtRank:d}=e,i={wInProj:2*s*n,bInProj:2*s,wConv:s*a,bConv:s,wXProj:(d+2*r)*s,bXProj:d+2*r,wDtProj:s*d,bDtProj:s,A_log:s*r,D_vec:s,wOutProj:n*s,bOutProj:n,normWeight:n},c=[];for(let u=0;u<e.numLayers;u++){const l={};for(const h of vt)l[h]=t(`layer${u}.${h}`,i[h]);c.push(l)}return{embedding:t("embedding",e.vocabSize*n),finalNorm:t("final_norm",n),lmHeadBias:t("lm_head_bias",e.vocabSize),layers:c}}function jr(o,e,t,n,r,a=!1){const{vocabSize:s,dModel:d}=t,i=n*r;let c=new Float32Array(i*d);for(let p=0;p<i;p++){const w=o[p];if(w<0||w>=s)throw new Error(`token id ${w} out of range [0, ${s})`);c.set(e.embedding.subarray(w*d,(w+1)*d),p*d)}const u={dModel:d,dState:t.dState,dConv:t.dConv,dInner:t.dInner,dtRank:t.dtRank,batch:n,seqLen:r},l=[],h=[];for(let p=0;p<t.numLayers;p++){l.push(c);const{output:w,cache:v}=Wr(c,e.layers[p],u);a||h.push(v),c=w}const m=new Float32Array(i*d),f=new Float32Array(i);Nr(c,e.finalNorm,i,d,m,f,Ce);const g=new Float32Array(i*s);return Ae(m,e.embedding,e.lmHeadBias,i,d,s,g),{hiddenIn:l,layer:h,lastHidden:c,normOut:m,normInv:f,logits:g}}function Lo(o,e,t,n,r){return jr(o,e,t,n,r).logits}function Rs(o,e,t,n,r,a){const s=Lo(o,t,n,r,a),d=r*a,i=n.vocabSize;let c=0;for(let u=0;u<d;u++)c+=ye(s.subarray(u*i,(u+1)*i),e[u]);return c/d}function So(o,e,t,n,r,a,s={}){const{vocabSize:d,dModel:i}=n,c=r*a,u=s.activationCheckpointing??!1,l=jr(o,t,n,r,a,u),h=xo(n);let m=0;const f=new Float32Array(c*d);for(let y=0;y<c;y++){const k=l.logits.subarray(y*d,(y+1)*d),S=e[y];m+=ye(k,S);const N=yr(k,S);for(let L=0;L<d;L++)f[y*d+L]=N[L]/c}const g=m/c,p=new Float32Array(c*i);for(let y=0;y<c;y++){const k=y*d,S=y*i;for(let N=0;N<d;N++){const L=f[k+N];if(L===0)continue;h.lmHeadBias[N]=h.lmHeadBias[N]+L;const D=N*i;for(let P=0;P<i;P++)p[S+P]=p[S+P]+L*t.embedding[D+P],h.embedding[D+P]=h.embedding[D+P]+L*l.normOut[S+P]}}const w=new Float32Array(c*i);$r(p,l.lastHidden,t.finalNorm,l.normInv,c,i,w,h.finalNorm,Ce);const v={dModel:i,dState:n.dState,dConv:n.dConv,dInner:n.dInner,dtRank:n.dtRank,batch:r,seqLen:a};let b=w;for(let y=n.numLayers-1;y>=0;y--){const k=u?Wr(l.hiddenIn[y],t.layers[y],v).cache:l.layer[y];b=vo(b,t.layers[y],k,v,h.layers[y])}for(let y=0;y<c;y++){const S=o[y]*i,N=y*i;for(let L=0;L<i;L++)h.embedding[S+L]=h.embedding[S+L]+b[N+L]}return{loss:g,grads:ko(h)}}function Eo(o,e){const{dModel:t,dState:n,dConv:r,dInner:a,dtRank:s}=e;if(o==="embedding")return[e.vocabSize,t];switch(o.startsWith("layer")?o.slice(o.indexOf(".")+1):o){case"wInProj":return[2*a,t];case"wConv":return[a,r];case"wXProj":return[s+2*n,a];case"wDtProj":return[a,s];case"A_log":return[a,n];case"wOutProj":return[t,a];default:return null}}const Bo=["wInProj","wXProj","wDtProj","wOutProj"],Do=.05;class Os{constructor(e,t=null){_(this,"model");_(this,"tokenizer");_(this,"device");_(this,"_moments");_(this,"_step");_(this,"_dims");_(this,"_mirror");_(this,"_mirrorByName");_(this,"_adapters");_(this,"_loraBase");_(this,"_shard");this.model=e,this.tokenizer=t,this.device=e.device,this._moments=new Map,this._step=0,this._dims=Fo(e),this._mirror=null,this._mirrorByName=null,this._adapters=new Map,this._loraBase=new Map,this._shard=null}get adapters(){return this._adapters}trainableParamCount(){const e=this.model.getTrainableParams();if(this._adapters.size===0)return e.reduce((n,r)=>n+r.numel,0);let t=0;for(const n of e){const r=this._adapters.get(n.name);r&&(t+=r.numParams())}return t}_owns(e){return this._shard===null||e%this._shard.count===this._shard.index}_installAdapters(e){if(this._adapters.size>0)return;const t=new Set(e.targets??Bo),n=this._mirrorByName;for(const r of this.model.getTrainableParams()){const a=r.name.includes(".")?r.name.slice(r.name.indexOf(".")+1):r.name;if(!t.has(a))continue;const s=Eo(r.name,this._dims);if(!s)continue;const[d,i]=s,c=Math.max(1,Math.min(e.rank??8,d,i));this._adapters.set(r.name,new Se(d,i,{...e,rank:c})),this._loraBase.set(r.name,Float32Array.from(n.get(r.name)))}if(this._adapters.size===0)throw new Error(`MambaTrainer: lora was requested but no trainable parameter matched targets [${[...t].join(", ")}]. Valid targets: wInProj, wXProj, wDtProj, wOutProj, wConv, A_log, embedding.`)}_materialiseAdapters(){const e=this._mirrorByName;for(const[t,n]of this._adapters){const r=e.get(t),a=this._loraBase.get(t),s=n.delta();for(let d=0;d<r.length;d++)r[d]=a[d]+s[d]}}_momentFor(e){let t=this._moments.get(e.name);return t||(t={m:new Float32Array(e.numel),v:new Float32Array(e.numel)},this._moments.set(e.name,t)),t}async _syncMirrorFromGpu(){const e=new Map;for(const t of this.model.parameters())e.set(t.name,await de(this.device,t.buf,t.numel*4));e.set("lm_head_bias",await de(this.device,this.model.gpuLMHeadBias,this._dims.vocabSize*4)),this._mirror=Mo(e,this._dims),this._mirrorByName=Ao(this._mirror)}async train(e,t={}){const{learningRate:n=1e-4,epochs:r=5,batchSize:a=1,seqLen:s=512,maxGradNorm:d=1,weightDecay:i=.01,beta1:c=.9,beta2:u=.999,eps:l=1e-8,wsla:h=!1,onEpochEnd:m=null}=t,f=Math.max(1,Math.floor(t.gradientAccumulation??1));if(this._shard=t.shard??null,this._shard&&(this._shard.count<=0||this._shard.index<0||this._shard.index>=this._shard.count))throw new Error(`MambaTrainer: invalid shard ${this._shard.index}/${this._shard.count}`);const g=t.maxDelta??(h?Do:0);h&&this.model.setWSLAMode(!0);let p;if(typeof e=="string"){if(!this.tokenizer)throw new Error("MambaTrainer requires a tokenizer when input is a string. Pass a BPETokenizer instance as the second constructor argument.");p=this.tokenizer.encode(e)}else p=Array.from(e);if(p.length<2)throw new Error("Input must contain at least 2 tokens to form a training pair.");const w=Co(p,s);if(w.length===0)throw new Error("Input is too short to form any training chunk.");const v=Po(w,Math.max(1,Math.floor(a)));await this._syncMirrorFromGpu(),t.lora&&this._installAdapters(t.lora);const b=[];for(let y=0;y<r;y++){let k=0,S=0,N=0;for(let D=0;D<v.length;D+=f){const P=v.slice(D,D+f),{loss:U,gradNorm:G}=await this._trainStep(P,{learningRate:n,maxGradNorm:d,weightDecay:i,beta1:c,beta2:u,eps:l,wsla:h,maxDelta:g,...t.activationCheckpointing?{activationCheckpointing:!0}:{}});k+=U,S+=G,N++}const L=k/N;b.push(L),m&&m(y+1,L,S/N)}return h&&this.model.setWSLAMode(!1),b}async _trainStep(e,t){const{learningRate:n,maxGradNorm:r,weightDecay:a,beta1:s,beta2:d,eps:i,maxDelta:c}=t;(!this._mirror||!this._mirrorByName)&&await this._syncMirrorFromGpu();const u=this._mirror,l=this._mirrorByName;this._step++,this._adapters.size>0&&this._materialiseAdapters();const h=t.activationCheckpointing?{activationCheckpointing:!0}:{};let m=0,f=new Map;for(const b of e){const y=So(b.inputs,b.targets,u,this._dims,b.batch,b.seqLen,h);if(m+=y.loss/e.length,f.size===0){for(const k of y.grads.values())for(let S=0;S<k.length;S++)k[S]=k[S]/e.length;f=y.grads}else for(const[k,S]of y.grads){const N=f.get(k);for(let L=0;L<S.length;L++)N[L]=N[L]+S[L]/e.length}}const g=this.model.getTrainableParams();if(this._adapters.size>0)for(const[b,y]of this._adapters){const k=f.get(b);k&&(y.zeroGrad(),y.accumulateGradient(k))}let p=0;for(const b of g){const y=f.get(b.name);if(y)for(let k=0;k<y.length;k++)p+=y[k]*y[k]}const w=Math.sqrt(p),v=r>0&&w>r?r/w:1;return this._adamwStep(g,f,l,{learningRate:n,weightDecay:a,beta1:s,beta2:d,eps:i,beta1_t:Math.pow(s,this._step),beta2_t:Math.pow(d,this._step),maxDelta:c,gradScale:v}),{loss:m,gradNorm:w}}_adamwStep(e,t,n,r){const{learningRate:a,weightDecay:s,beta1:d,beta2:i,eps:c,beta1_t:u,beta2_t:l,maxDelta:h,gradScale:m}=r,f={lr:a,beta1:d,beta2:i,eps:c,weightDecay:s,beta1_t:u,beta2_t:l,maxDelta:h,gradScale:m};for(let g=0;g<e.length;g++){const p=e[g];if(!this._owns(g))continue;const w=this._adapters.get(p.name);if(w){const k=n.get(p.name),S=this._loraBase.get(p.name),[N,L]=[w.A,w.B],[D,P]=[w.gradients()[1].data,w.gradients()[0].data],U=this._momentNamed(`${p.name}::loraB`,L.length),G=this._momentNamed(`${p.name}::loraA`,N.length);Ye(L,P,U.m,U.v,f),Ye(N,D,G.m,G.v,f);const H=w.delta();for(let R=0;R<k.length;R++)k[R]=S[R]+H[R];ge(this.device,p.buf,k);continue}const v=t.get(p.name),b=n.get(p.name);if(!v||!b)continue;if(v.length!==p.numel||b.length!==p.numel)throw new Error(`MambaTrainer: parameter "${p.name}" is ${p.numel} elements but the gradient engine produced ${v.length} — model and CPU mirror disagree.`);const y=this._momentFor(p);Ye(b,v,y.m,y.v,f),ge(this.device,p.buf,b)}}_momentNamed(e,t){let n=this._moments.get(e);return n||(n={m:new Float32Array(t),v:new Float32Array(t)},this._moments.set(e,n)),n}optimizerStateBytes(){let e=0;for(const t of this._moments.values())e+=t.m.byteLength+t.v.byteLength;return e}async evaluate(e){let t;if(typeof e=="string"){if(!this.tokenizer)throw new Error("Tokenizer required for string input.");t=Array.from(this.tokenizer.encode(e))}else t=Array.from(e);const n=t.length,r=this.model.config.vocabSize,{logits:a}=await this.model.forward(new Uint32Array(t.slice(0,-1)),1,n-1);let s=0;for(let i=0;i<n-1;i++){const c=i*r;s+=ye(a.slice(c,c+r),t[i+1])}const d=s/(n-1);return Math.exp(d)}}function Fo(o){const e=o.layerSpecs.map((a,s)=>({i:s,type:a.type})).filter(({type:a})=>!Xt.includes(a));if(e.length>0){const a=e.map(({i:s,type:d})=>`layer${s}=${d}`).join(", ");throw new Error(`MambaTrainer: the gradient engine differentiates ${Xt.join("/")} layers only, but this model has ${a}. Build the model with the default mamba1 schedule to train it, or extend the CPU reference to cover those blocks.`)}const t=o.layers[0],n=(t==null?void 0:t.dInner)??o.config.expand*o.config.dModel,r=(t==null?void 0:t.dtRank)??Math.ceil(o.config.dModel/16);return{vocabSize:o.config.vocabSize,dModel:o.config.dModel,dState:o.config.dState,dConv:o.config.dConv,dInner:n,dtRank:r,numLayers:o.layers.length}}function Co(o,e){const t=[];for(let r=0;r+e<o.length;r+=e)t.push({inputs:o.slice(r,r+e),targets:o.slice(r+1,r+e+1)});const n=o.length%e;if(n>1){const r=o.length-n;t.push({inputs:o.slice(r,-1),targets:o.slice(r+1)})}return t}function Po(o,e){const t=[];let n=0;for(;n<o.length;){const r=o[n].inputs.length,a=[];for(;n<o.length&&a.length<e&&o[n].inputs.length===r;)a.push(o[n]),n++;t.push({inputs:a.flatMap(s=>s.inputs),targets:a.flatMap(s=>s.targets),batch:a.length,seqLen:r})}return t}class Us{constructor(e){_(this,"video");this.video=new qe({...e,keyframeInterval:1})}get vocab(){return this.video.vocab}get vocabSize(){return this.video.vocabSize}get frameSize(){return this.video.height*this.video.width*this.video.channels}encode(e){return this.video.encode([e])}decode(e){return this.video.decode(e)[0]??new Float32Array(this.frameSize)}fit(e,t){return this.video.fit(e.map(n=>[n]),t)}}function Gs(o,e,t){return[...e,...o.encode(t)]}function To(o,e,t,n){if(o.config.vocabSize!==e.vocabSize)throw new Error(`generateVideo: EvermindLM vocabSize (${o.config.vocabSize}) must equal codec.vocabSize (${e.vocabSize})`);const r=o.generate(t,{...n,stopToken:n.stopToken??e.vocab.eosVideo});return{video:e.decode(r),tokens:r}}function Ks(o,e,t,n){const{video:r,tokens:a}=To(o,e.video,t,n);return{image:r[0]??new Float32Array(e.frameSize),tokens:a}}function Pe(o){const e=o.config;return{vocabSize:e.vocabSize,dModel:e.dModel,numLayers:e.numLayers,convKernel:e.convKernel,hiddenDim:e.hiddenDim,numExperts:e.numExperts,topK:e.topK}}function Rr(o){const{vocabSize:e,dModel:t,numLayers:n,convKernel:r,hiddenDim:a,numExperts:s}=o,d=[{name:"token_embedding.weight",shape:[e,t]}],i=c=>[{name:`${c}.w1`,shape:[a,t]},{name:`${c}.b1`,shape:[a]},{name:`${c}.w2`,shape:[t,a]},{name:`${c}.b2`,shape:[t]}];for(let c=0;c<n;c++){const u=`layers.${c}`;d.push({name:`${u}.conv.weight`,shape:[t,r]}),d.push({name:`${u}.norm_conv.weight`,shape:[t]}),d.push({name:`${u}.norm_moe.weight`,shape:[t]}),d.push({name:`${u}.moe.router.weight`,shape:[s,t]}),d.push(...i(`${u}.moe.shared`));for(let l=0;l<s;l++)d.push(...i(`${u}.moe.experts.${l}`))}return d}function xt(o){const e=Rr(Pe(o)),t=o.parameters();if(e.length!==t.length)throw new Error(`export/tensors: parameter-count drift (spec ${e.length} vs model ${t.length}) — EvermindLM.parameters() order changed; update evermindTensorSpec`);return e.map((n,r)=>{const a=n.shape.reduce((d,i)=>d*i,1),s=t[r].data;if(s.length!==a)throw new Error(`export/tensors: shape mismatch for ${n.name} (expected ${a}, got ${s.length})`);return{name:n.name,shape:n.shape,data:s}})}function Or(o){return o.parameters().reduce((e,t)=>e+t.data.length,0)}function No(o,e){if(!e){const r=new Uint8Array(o.length*4),a=new DataView(r.buffer);for(let s=0;s<o.length;s++)a.setFloat32(s*4,o[s],!0);return r}const t=new Uint8Array(o.length*2),n=new DataView(t.buffer);for(let r=0;r<o.length;r++)n.setUint16(r*2,Ue(o[r]),!0);return t}function $o(o,e={}){const t=e.fp16??!1,n=t?"F16":"F32",r=t?2:4,a={};e.metadata&&(a.__metadata__=e.metadata);const s=[];let d=0;for(const f of o){const g=f.data.length*r;a[f.name]={dtype:n,shape:f.shape,data_offsets:[d,d+g]},s.push(No(f.data,t)),d+=g}let i=JSON.stringify(a);const u=(8-new TextEncoder().encode(i).length%8)%8;u>0&&(i+=" ".repeat(u));const l=new TextEncoder().encode(i),h=new Uint8Array(8+l.length+d);new DataView(h.buffer).setBigUint64(0,BigInt(l.length),!0),h.set(l,8);let m=8+l.length;for(const f of s)h.set(f,m),m+=f.length;return h}function Yt(o,e={}){return $o(xt(o),{...e,metadata:{format:"pt",producer:"builderforce-memory-engine",...e.metadata??{}}})}const Io=0,zo=5,Wo=2;class te{constructor(){_(this,"parts",[])}byte(e){this.parts.push(e&255)}rawVarint(e){if(e<0||!Number.isFinite(e))throw new Error(`ProtoWriter: bad varint ${e}`);let t=e;for(;t>=128;)this.byte(t%128|128),t=Math.floor(t/128);this.byte(t)}tag(e,t){this.rawVarint(e*8+t)}rawBytes(e){for(let t=0;t<e.length;t++)this.byte(e[t])}varint(e,t){this.tag(e,Io),this.rawVarint(t)}float(e,t){this.tag(e,zo);const n=new ArrayBuffer(4);new DataView(n).setFloat32(0,t,!0),this.rawBytes(new Uint8Array(n))}bytes(e,t){this.tag(e,Wo),this.rawVarint(t.length),this.rawBytes(t)}string(e,t){this.bytes(e,new TextEncoder().encode(t))}message(e,t){this.bytes(e,t.finish())}finish(){return Uint8Array.from(this.parts)}}function jo(o){const e=new Uint8Array(o.length*4),t=new DataView(e.buffer);for(let n=0;n<o.length;n++)t.setFloat32(n*4,o[n],!0);return e}const Ro=18,Oo=8,Ur=1,Gr=7,Uo=1,Go=2,Ko=3,Ho=7;class qo{constructor(){_(this,"nodes",[]);_(this,"inits",[]);_(this,"uid",0)}tmp(e){return`${e}_${this.uid++}`}initFloat(e,t,n){return this.inits.push({name:e,dims:t,dataType:Ur,raw:jo(n)}),e}initInt64(e,t,n){return this.inits.push({name:e,dims:t,dataType:Gr,int64:n}),e}node(e,t,n,r=[]){return this.nodes.push({op:e,inputs:t,outputs:n,name:`${e}_${this.uid++}`,attrs:r}),n}op(e,t,n,r=[]){const a=this.tmp(n);return this.node(e,t,[a],r),a}}function Qt(o,e,t,n,r){const a=o.op("Mul",[e,e],"rms_sq"),s=o.op("ReduceMean",[a,r],"rms_mean",[{kind:"i",name:"keepdims",value:1}]),d=o.op("Add",[s,n],"rms_eps"),i=o.op("Sqrt",[d],"rms_r"),c=o.op("Div",[e,i],"rms_div");return o.op("Mul",[c,t],"rms_y")}function Jt(o,e,t,n,r,a){const s=o.op("Transpose",[t],"w1t",[{kind:"ints",name:"perm",value:[1,0]}]),d=o.op("Add",[o.op("MatMul",[e,s],"ffn_mm1"),n],"ffn_pre"),i=o.op("Relu",[d],"ffn_h"),c=o.op("Transpose",[r],"w2t",[{kind:"ints",name:"perm",value:[1,0]}]);return o.op("Add",[o.op("MatMul",[i,c],"ffn_mm2"),a],"ffn_y")}function Zt(o,e={}){const t=Pe(o),n=xt(o),r=new Map(n.map(b=>[b.name,b])),a=b=>{const y=r.get(b);if(!y)throw new Error(`export/onnx: missing tensor ${b}`);return y},s=new qo,{vocabSize:d,dModel:i,numLayers:c,convKernel:u,numExperts:l,topK:h}=t,m=s.initFloat("token_embedding.weight",[d,i],a("token_embedding.weight").data),f=s.initFloat("rms_eps",[1],new Float32Array([1e-5])),g=s.initInt64("axes_last",[1],[2]),p=s.initInt64("topk_k",[1],[h]);let w=s.op("Gather",[m,"input_ids"],"embedded",[{kind:"i",name:"axis",value:0}]);for(let b=0;b<c;b++){const y=`layers.${b}`,k=s.initFloat(`${y}.norm_conv.weight`,[i],a(`${y}.norm_conv.weight`).data),S=Qt(s,w,k,f,g),N=a(`${y}.conv.weight`).data,L=new Float32Array(i*u);for(let X=0;X<i;X++)for(let Y=0;Y<u;Y++)L[X*u+(u-1-Y)]=N[X*u+Y];const D=s.initFloat(`${y}.conv.onnx_weight`,[i,1,u],L),P=s.op("Transpose",[S],"conv_in",[{kind:"ints",name:"perm",value:[0,2,1]}]),U=s.op("Conv",[P,D],"conv_out",[{kind:"i",name:"group",value:i},{kind:"ints",name:"kernel_shape",value:[u]},{kind:"ints",name:"pads",value:[u-1,0]},{kind:"ints",name:"strides",value:[1]},{kind:"ints",name:"dilations",value:[1]}]),G=s.op("Transpose",[U],"conv_back",[{kind:"ints",name:"perm",value:[0,2,1]}]),H=s.op("Add",[w,G],"after_conv"),R=s.initFloat(`${y}.norm_moe.weight`,[i],a(`${y}.norm_moe.weight`).data),K=Qt(s,H,R,f,g),M=s.initFloat(`${y}.moe.router.weight`,[l,i],a(`${y}.moe.router.weight`).data),x=s.op("Transpose",[M],"router_t",[{kind:"ints",name:"perm",value:[1,0]}]),A=s.op("MatMul",[K,x],"router_logits"),E=s.tmp("topk_v"),j=s.tmp("topk_i");s.node("TopK",[A,p],[E,j],[{kind:"i",name:"axis",value:2},{kind:"i",name:"largest",value:1},{kind:"i",name:"sorted",value:1}]);const V=s.op("Softmax",[E],"gates",[{kind:"i",name:"axis",value:2}]),$=s.op("Sub",[A,A],"zeros"),T=s.op("ScatterElements",[$,j,V],"combine",[{kind:"i",name:"axis",value:2}]),F=Jt(s,K,s.initFloat(`${y}.moe.shared.w1`,[t.hiddenDim,i],a(`${y}.moe.shared.w1`).data),s.initFloat(`${y}.moe.shared.b1`,[t.hiddenDim],a(`${y}.moe.shared.b1`).data),s.initFloat(`${y}.moe.shared.w2`,[i,t.hiddenDim],a(`${y}.moe.shared.w2`).data),s.initFloat(`${y}.moe.shared.b2`,[i],a(`${y}.moe.shared.b2`).data)),q=Array.from({length:l},(X,Y)=>s.tmp(`combine_${Y}`));s.node("Split",[T],q,[{kind:"i",name:"axis",value:2},{kind:"i",name:"num_outputs",value:l}]);let Z=F;for(let X=0;X<l;X++){const Y=`${y}.moe.experts.${X}`,oe=Jt(s,K,s.initFloat(`${Y}.w1`,[t.hiddenDim,i],a(`${Y}.w1`).data),s.initFloat(`${Y}.b1`,[t.hiddenDim],a(`${Y}.b1`).data),s.initFloat(`${Y}.w2`,[i,t.hiddenDim],a(`${Y}.w2`).data),s.initFloat(`${Y}.b2`,[i],a(`${Y}.b2`).data)),he=s.op("Mul",[q[X],oe],"expert_w");Z=s.op("Add",[Z,he],"moe_acc")}w=s.op("Add",[H,Z],"after_moe")}const v=s.op("Transpose",[m],"emb_t",[{kind:"ints",name:"perm",value:[1,0]}]);return s.node("MatMul",[w,v],["logits"]),Zo(s,t,e)}function Vo(o){const e=new te;switch(e.string(1,o.name),o.kind){case"i":e.varint(20,Go),e.varint(3,o.value);break;case"ints":e.varint(20,Ho);for(const t of o.value)e.varint(8,t);break;case"f":e.varint(20,Uo),e.float(2,o.value);break;case"s":e.varint(20,Ko),e.string(4,o.value);break}return e}function Xo(o){const e=new te;for(const t of o.inputs)e.string(1,t);for(const t of o.outputs)e.string(2,t);e.string(3,o.name),e.string(4,o.op);for(const t of o.attrs)e.message(5,Vo(t));return e}function Yo(o){const e=new te;for(const t of o.dims)e.varint(1,t);if(e.varint(2,o.dataType),e.string(8,o.name),o.int64)for(const t of o.int64)e.varint(7,t);return o.raw&&e.bytes(9,o.raw),e}function Qo(o){const e=new te;return e.string(2,o),e}function Jo(o){const e=new te;return e.varint(1,o),e}function er(o,e,t){const n=new te;for(const d of t)n.message(1,typeof d=="string"?Qo(d):Jo(d));const r=new te;r.varint(1,e),r.message(2,n);const a=new te;a.message(1,r);const s=new te;return s.string(1,o),s.message(2,a),s}function Zo(o,e,t){const n=new te;for(const s of o.nodes)n.message(1,Xo(s));n.string(2,"evermind");for(const s of o.inits)n.message(5,Yo(s));n.message(11,er("input_ids",Gr,["batch","seq"])),n.message(12,er("logits",Ur,["batch","seq",e.vocabSize]));const r=new te;r.string(1,""),r.varint(2,Ro);const a=new te;return a.varint(1,Oo),a.string(2,t.producerName??"builderforce-memory-engine"),a.string(3,t.producerVersion??"evermind"),a.message(7,n),a.message(8,r),a.finish()}const ea=1179993927,ta=3,ke=32,ra=4,na=8,oa=0,aa=1;class sa{constructor(){_(this,"buf",new Uint8Array(1024));_(this,"len",0)}ensure(e){if(this.len+e<=this.buf.length)return;let t=this.buf.length*2;for(;t<this.len+e;)t*=2;const n=new Uint8Array(t);n.set(this.buf.subarray(0,this.len)),this.buf=n}u32(e){this.ensure(4),new DataView(this.buf.buffer).setUint32(this.len,e,!0),this.len+=4}u64(e){this.ensure(8),new DataView(this.buf.buffer).setBigUint64(this.len,BigInt(e),!0),this.len+=8}raw(e){this.ensure(e.length),this.buf.set(e,this.len),this.len+=e.length}alignTo(e){const t=(e-this.len%e)%e;t>0&&(this.ensure(t),this.len+=t)}string(e){const t=new TextEncoder().encode(e);this.u64(t.length),this.raw(t)}get length(){return this.len}bytes(){return this.buf.subarray(0,this.len)}}function ia(o,e){if(!e){const r=new Uint8Array(o.length*4),a=new DataView(r.buffer);for(let s=0;s<o.length;s++)a.setFloat32(s*4,o[s],!0);return r}const t=new Uint8Array(o.length*2),n=new DataView(t.buffer);for(let r=0;r<o.length;r++)n.setUint16(r*2,Ue(o[r]),!0);return t}function tr(o,e={}){const t=e.fp16??!1,n=Pe(o),r=xt(o),a=t?aa:oa,s=t?2:4,d=[["evermind.vocab_size",n.vocabSize],["evermind.embedding_length",n.dModel],["evermind.block_count",n.numLayers],["evermind.conv_kernel",n.convKernel],["evermind.feed_forward_length",n.hiddenDim],["evermind.expert_count",n.numExperts],["evermind.expert_used_count",n.topK],["general.alignment",ke]],i=[["general.architecture","evermind"],["general.name",e.name??"Evermind"]],c=new sa;c.u32(ea),c.u32(ta),c.u64(r.length),c.u64(d.length+i.length);for(const[f,g]of i)c.string(f),c.u32(na),c.string(g);for(const[f,g]of d)c.string(f),c.u32(ra),c.u32(g);const u=f=>[...f.shape].reverse();let l=0;const h=[];for(const f of r){h.push(l);const g=f.data.length*s;l+=g,l+=(ke-l%ke)%ke}r.forEach((f,g)=>{c.string(f.name);const p=u(f);c.u32(p.length);for(const w of p)c.u64(w);c.u32(a),c.u64(h[g])}),c.alignTo(ke);const m=c.length;for(let f=0;f<r.length;f++){const g=m+h[f];for(;c.length<g;)c.raw(new Uint8Array(1));c.raw(ia(r[f].data,t))}return c.bytes()}function da(o){const e=Pe(o);return{model_type:"evermind",architectures:["EvermindForCausalLM"],vocab_size:e.vocabSize,d_model:e.dModel,hidden_size:e.dModel,num_hidden_layers:e.numLayers,conv_kernel:e.convKernel,intermediate_size:e.hiddenDim,num_experts:e.numExperts,num_experts_per_tok:e.topK,rms_norm_eps:1e-5,tie_word_embeddings:!0,torch_dtype:"float32",transformers_version:"4.0.0"}}function ca(){return{do_sample:!1,temperature:1,max_new_tokens:64}}function la(o){const e={};for(const[r,a]of o.vocab)e[r]=a;const t=[...o.merges.keys()],n=[];for(const r of[o.unkToken,o.bosToken,o.eosToken,o.padToken]){const a=o.vocab.get(r);a!==void 0&&!n.some(s=>s.id===a)&&n.push({id:a,content:r})}return{version:"1.0",truncation:null,padding:null,added_tokens:n.map(r=>({id:r.id,content:r.content,single_word:!1,lstrip:!1,rstrip:!1,normalized:!1,special:!0})),normalizer:null,pre_tokenizer:{type:"ByteLevel",add_prefix_space:!1,trim_offsets:!0,use_regex:!0},post_processor:{type:"ByteLevel",add_prefix_space:!0,trim_offsets:!1,use_regex:!0},decoder:{type:"ByteLevel",add_prefix_space:!0,trim_offsets:!0,use_regex:!0},model:{type:"BPE",dropout:null,unk_token:null,continuing_subword_prefix:null,end_of_word_suffix:null,fuse_unk:!1,byte_fallback:!1,vocab:e,merges:t}}}function ua(o,e={}){const t=Pe(o),n=Or(o),r=e.name??"Evermind",a=e.license??"mit",s=["evermind","ssm","mixture-of-experts","text-generation",...e.tags??[]],d=["---",`license: ${a}`,"library_name: builderforce-memory","pipeline_tag: text-generation","tags:",...s.map(c=>`  - ${c}`),"---"].join(`
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
${i}`}const Hs=[{id:"huggingface",label:"Hugging Face repo",description:"Full publishable repo: safetensors + ONNX + GGUF + config + tokenizer + model card",ext:"/"},{id:"onnx",label:"ONNX",description:"Runnable graph for onnxruntime / transformers.js (input_ids → logits)",ext:".onnx"},{id:"safetensors",label:"Safetensors",description:"HF-native weight format (lossless F32 / half-size F16)",ext:".safetensors"},{id:"gguf",label:"GGUF",description:"llama.cpp container (custom architecture; for GGUF tooling)",ext:".gguf"}],ha="application/json";function Je(o,e){return{path:o,data:JSON.stringify(e,null,2),contentType:ha}}function qs(o,e,t={},n){const r=Or(o),a=()=>({format:e,files:[],paramCount:r});switch(e){case"safetensors":{const s=a();return s.files.push({path:"model.safetensors",data:Yt(o,{fp16:t.fp16}),contentType:"application/octet-stream"}),s}case"onnx":{const s=a();return s.files.push({path:"model.onnx",data:Zt(o,{producerVersion:t.version}),contentType:"application/octet-stream"}),s}case"gguf":{const s=a();return s.files.push({path:"model.gguf",data:tr(o,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"}),s}case"huggingface":{if(!n)throw new Error("exportEvermind('huggingface'): a tokenizer is required for tokenizer.json");const s=a();return s.files.push({path:"model.safetensors",data:Yt(o,{fp16:t.fp16}),contentType:"application/octet-stream"},{path:"model.onnx",data:Zt(o,{producerVersion:t.version}),contentType:"application/octet-stream"},{path:"model.gguf",data:tr(o,{name:t.name,fp16:t.fp16}),contentType:"application/octet-stream"},Je("config.json",da(o)),Je("generation_config.json",ca()),Je("tokenizer.json",la(n)),{path:"README.md",data:ua(o,t),contentType:"text/markdown"}),s}default:throw new Error(`exportEvermind: unknown format "${String(e)}"`)}}function Kr(o){if(o.length<8)throw new Error("safetensors: buffer too short for header length");const e=new DataView(o.buffer,o.byteOffset,o.byteLength),t=Number(e.getBigUint64(0,!0)),n=8+t;if(n>o.length)throw new Error(`safetensors: header length ${t} exceeds buffer`);const r=new TextDecoder().decode(o.subarray(8,n));let a;try{a=JSON.parse(r)}catch(i){throw new Error(`safetensors: malformed JSON header (${i instanceof Error?i.message:String(i)})`)}const s=n,d=[];for(const[i,c]of Object.entries(a)){if(i==="__metadata__")continue;const u=c;if(!u||!Array.isArray(u.shape)||!Array.isArray(u.data_offsets))throw new Error(`safetensors: malformed entry for "${i}"`);const[l,h]=u.data_offsets,m=u.shape.reduce((g,p)=>g*p,1),f=o.subarray(s+l,s+h);d.push({name:i,shape:u.shape,data:fa(f,u.dtype,m,i)})}return d}function fa(o,e,t,n){const r=new DataView(o.buffer,o.byteOffset,o.byteLength),a=new Float32Array(t),s=e.toUpperCase();if(s==="F32"||s==="FLOAT32"){if(o.length<t*4)throw new Error(`safetensors: "${n}" F32 bytes ${o.length} < ${t*4}`);for(let d=0;d<t;d++)a[d]=r.getFloat32(d*4,!0);return a}if(s==="F16"||s==="FLOAT16"){if(o.length<t*2)throw new Error(`safetensors: "${n}" F16 bytes ${o.length} < ${t*2}`);for(let d=0;d<t;d++)a[d]=mt(r.getUint16(d*2,!0));return a}if(s==="BF16"||s==="BFLOAT16"){if(o.length<t*2)throw new Error(`safetensors: "${n}" BF16 bytes ${o.length} < ${t*2}`);const d=new Uint32Array(a.buffer);for(let i=0;i<t;i++)d[i]=r.getUint16(i*2,!0)<<16;return a}throw new Error(`safetensors: unsupported dtype "${e}" for "${n}" (expected F32, F16 or BF16)`)}function ma(o,e){const t=new Map(o.map(h=>[h.name,h])),n=t.get("token_embedding.weight");if(!n||n.shape.length!==2)throw new Error("import: missing token_embedding.weight [vocab, dModel]");const[r,a]=n.shape;let s=0,d=0;for(const h of o){const m=/^layers\.(\d+)\./.exec(h.name);m&&(s=Math.max(s,Number(m[1])+1));const f=/^layers\.\d+\.moe\.experts\.(\d+)\./.exec(h.name);f&&(d=Math.max(d,Number(f[1])+1))}if(s===0)throw new Error("import: no `layers.<n>.` tensors found");const i=t.get("layers.0.conv.weight");if(!i||i.shape.length!==2)throw new Error("import: missing layers.0.conv.weight [dModel, convKernel]");const c=i.shape[1],u=t.get("layers.0.moe.shared.w1");if(!u||u.shape.length!==2)throw new Error("import: missing layers.0.moe.shared.w1 [hiddenDim, dModel]");const l=u.shape[0];return{vocabSize:r,dModel:a,numLayers:s,convKernel:c,hiddenDim:l,numExperts:d,topK:Math.min(e??2,Math.max(1,d))}}function pa(o,e={}){const t=[];for(const c of o){const u=e.rename?e.rename(c.name):c.name;u!=null&&t.push({...c,name:u})}const n=new Map(t.map(c=>[c.name,c])),r=e.arch??ma(t,e.topK),a=Rr(r),s=[];for(const c of a){const u=n.get(c.name);if(!u)throw new Error(`import: missing tensor "${c.name}" (expected shape [${c.shape.join(", ")}])`);const l=c.shape.reduce((h,m)=>h*m,1);if(u.data.length!==l)throw new Error(`import: tensor "${c.name}" has ${u.data.length} elements, expected ${l} ([${c.shape.join(", ")}])`);s.push(u.data)}const d=new He({vocabSize:r.vocabSize,dModel:r.dModel,numLayers:r.numLayers,convKernel:r.convKernel,hiddenDim:r.hiddenDim,numExperts:r.numExperts,topK:r.topK}),i=d.parameters();if(i.length!==s.length)throw new Error(`import: parameter-count drift (model ${i.length} vs imported ${s.length})`);for(let c=0;c<i.length;c++)i[c].data.set(s[c]);return d}function Vs(o,e={}){return pa(Kr(o),e)}function Hr(o){return o.startsWith("model.")?o.slice(6):o}function ga(o){return o.reduce((e,t)=>e*t,1)}function fe(o){const e=o.filter(t=>t!==1);return e.length>0?e:[1]}function Ze(o,e){return o.length===e.length&&o.every((t,n)=>t===e[n])}function _a(o){if(!(o>0))throw new Error(`import/foreign: softplus⁻¹ needs a positive input, got ${o}`);return o>30?o:Math.log(Math.expm1(o))}function rr(o,e){const t=ga(o.shape);if(o.op.kind==="fill")return new Float32Array(t).fill(o.op.value);if(!e)throw new Error(`import/foreign: rule for "${o.target}" has no source tensor`);const n=`"${e.name}" → "${o.target}"`;switch(o.op.kind){case"copy":case"negExpToSoftplusInv":{if(!Ze(fe(e.shape),fe(o.shape)))throw new Error(`import/foreign: ${n} shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${o.shape.join(", ")}]`);if(e.data.length!==t)throw new Error(`import/foreign: ${n} has ${e.data.length} elements, expected ${t}`);if(o.op.kind==="copy")return Float32Array.from(e.data);const r=new Float32Array(t);for(let a=0;a<t;a++)r[a]=_a(Math.exp(e.data[a]));return r}case"convTaps":{const[r,a]=fe(o.shape),s=fe(e.shape);if(!Ze(s,[r,a]))throw new Error(`import/foreign: ${n} depthwise conv shape mismatch — checkpoint has [${e.shape.join(", ")}], this model expects [${o.shape.join(", ")}] (a [channels, 1, kernel] PyTorch kernel squeezes to [channels, kernel])`);const d=new Float32Array(t);for(let i=0;i<r;i++)for(let c=0;c<a;c++)d[i*a+c]=e.data[i*a+(a-1-c)];return d}case"rowSlice":{if(e.shape.length!==2)throw new Error(`import/foreign: ${n} rowSlice needs a rank-2 source, got [${e.shape.join(", ")}]`);const[r,a]=e.shape,{start:s,count:d}=o.op;if(s<0||s+d>r)throw new Error(`import/foreign: ${n} rowSlice [${s}, ${s+d}) is outside the checkpoint tensor's ${r} rows — the source layout is not what this adapter expects`);if(!Ze(fe(o.shape),fe([d,a])))throw new Error(`import/foreign: ${n} rowSlice yields [${d}, ${a}] but this model expects [${o.shape.join(", ")}]`);return Float32Array.from(e.data.subarray(s*a,(s+d)*a))}}}function ba(o,e){const t=new Map;for(const d of e){const i=Hr(d.name);t.set(i,{...d,name:i})}const n=new Map,r=[],a=new Set;for(const d of o.rules){if(n.has(d.target))throw new Error(`import/foreign: plan "${o.adapter}" defines "${d.target}" twice`);if(d.from.length===0){if(d.op.kind!=="fill")throw new Error(`import/foreign: rule for "${d.target}" names no source but is not a fill rule`);n.set(d.target,rr(d,null)),r.push({target:d.target,value:d.op.value,reason:d.note??"this architecture has no corresponding tensor"});continue}const i=d.from.map(c=>t.get(c)).find(c=>c!=null);if(!i)throw new Error(`import/foreign: checkpoint is missing "${d.from[0]}" (needed for "${d.target}", expected shape [${d.shape.join(", ")}])`+(d.from.length>1?`; also tried ${d.from.slice(1).map(c=>`"${c}"`).join(", ")}`:""));a.add(i.name),n.set(d.target,rr(d,i))}const s=[...t.keys()].filter(d=>!a.has(d)).sort();return{adapter:o.adapter,weights:n,unmappedSources:s,synthesisedTargets:r,discardedSources:o.discards}}function kt(o,e){throw new Error(`import/foreign: config field "${o}" ${e}`)}function re(o,e){const t=o[e];return(typeof t!="number"||!Number.isInteger(t)||t<=0)&&kt(e,`must be a positive integer, got ${JSON.stringify(t)}`),t}function Me(o,e){for(const t of e){const n=o[t];if(typeof n=="number"&&Number.isInteger(n)&&n>0)return n}}function qr(o,e){const t=Me(o,["intermediate_size"]);if(t!==void 0)return t;const n=Me(o,["expand"]);return n===void 0&&kt("intermediate_size",'is absent and no usable "expand" was found'),n*e}function Vr(o,e,t){if(o%e!==0)throw new Error(`import/foreign: ${t} has d_inner ${o} which is not a whole multiple of d_model ${e} — this engine's blocks are sized by an integer expand factor`);return o/e}function wa(o,e){const t=o.time_step_rank;if(typeof t=="number"&&Number.isInteger(t)&&t>0)return t;if(t===void 0||t==="auto")return Math.ceil(e/16);kt("time_step_rank",`must be a positive integer or "auto", got ${JSON.stringify(t)}`)}const ya=["backbone.embeddings.weight","backbone.embedding.weight"];function va(o){const{vocabSize:e,dModel:t,numLayers:n,dInner:r,dState:a,dConv:s,dtRank:d}=o,i=[{target:"embedding",shape:[e,t],from:ya,op:{kind:"copy"}}];for(let c=0;c<n;c++){const u=`backbone.layers.${c}.mixer`,l=`layer${c}`;i.push({target:`${l}.wInProj`,shape:[2*r,t],from:[`${u}.in_proj.weight`],op:{kind:"copy"}},{target:`${l}.bInProj`,shape:[2*r],from:[],op:{kind:"fill",value:0},note:"Falcon-Mamba sets use_bias=false — in_proj ships no bias; zeros are exact"},{target:`${l}.wConv`,shape:[r,s],from:[`${u}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [d_inner, 1, d_conv] → [d_inner, d_conv] with the tap axis reversed"},{target:`${l}.bConv`,shape:[r],from:[`${u}.conv1d.bias`],op:{kind:"copy"}},{target:`${l}.wXProj`,shape:[d+2*a,r],from:[`${u}.x_proj.weight`],op:{kind:"copy"}},{target:`${l}.bXProj`,shape:[d+2*a],from:[],op:{kind:"fill",value:0},note:"x_proj is bias-free upstream; zeros are exact"},{target:`${l}.wDtProj`,shape:[r,d],from:[`${u}.dt_proj.weight`],op:{kind:"copy"}},{target:`${l}.bDtProj`,shape:[r],from:[`${u}.dt_proj.bias`],op:{kind:"copy"}},{target:`${l}.A_log`,shape:[r,a],from:[`${u}.A_log`],op:{kind:"copy"}},{target:`${l}.D_vec`,shape:[r],from:[`${u}.D`],op:{kind:"copy"}},{target:`${l}.wOutProj`,shape:[t,r],from:[`${u}.out_proj.weight`],op:{kind:"copy"}},{target:`${l}.bOutProj`,shape:[t],from:[],op:{kind:"fill",value:0},note:"out_proj is bias-free upstream; zeros are exact"},{target:`${l}.normWeight`,shape:[t],from:[`backbone.layers.${c}.norm.weight`],op:{kind:"copy"}})}return i.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),i}function Xr(o){const e=o.id;return{...o,describe(t){const n=re(t,"hidden_size"),r=re(t,"num_hidden_layers"),a=re(t,"vocab_size"),s=re(t,"state_size"),d=re(t,"conv_kernel"),i=qr(t,n),c=Vr(i,n,o.label),u=wa(t,n),l={vocabSize:a,dModel:n,numLayers:r,dState:s,dConv:d,expand:c,defaultMamba1:{dtRank:u,biasConv:!0}},h={adapter:e,rules:va({vocabSize:a,dModel:n,numLayers:r,dInner:i,dState:s,dConv:d,dtRank:u}),discards:[]};return{modelConfig:l,plan:h}}}}const xa=Xr({id:"falcon_mamba",label:"Falcon-Mamba (Mamba-1 / S6)",modelTypes:["falcon_mamba"],architectures:["FalconMambaForCausalLM"]}),ka=Xr({id:"mamba",label:"Mamba (Mamba-1 / S6)",modelTypes:["mamba"],architectures:["MambaForCausalLM"]}),nr="codestral_mamba",Aa=["backbone.embeddings.weight","backbone.embedding.weight"];function Ma(o){const{vocabSize:e,dModel:t,numLayers:n,dInner:r,dState:a,dConv:s,nHeads:d,nGroups:i}=o,c=r+2*i*a,u=c+d,l=[{target:"embedding",shape:[e,t],from:Aa,op:{kind:"copy"}}];for(let h=0;h<n;h++){const m=`backbone.layers.${h}.mixer`,f=`layer${h}`;l.push({target:`${f}.wInProj`,shape:[u,t],from:[`${m}.in_proj.weight`],op:{kind:"rowSlice",start:r,count:u},note:"upstream rows are [gate, x, B, C, dt]; this block has no gate branch"},{target:`${f}.wConv`,shape:[c,s],from:[`${m}.conv1d.weight`],op:{kind:"convTaps"},note:"depthwise [conv_dim, 1, d_conv] → [conv_dim, d_conv] with the tap axis reversed"},{target:`${f}.bConv`,shape:[c],from:[`${m}.conv1d.bias`],op:{kind:"copy"}},{target:`${f}.A_log`,shape:[d],from:[`${m}.A_log`],op:{kind:"negExpToSoftplusInv"},note:"upstream A = -exp(A_log); this engine's SSD kernel uses A = -softplus(A_log)"},{target:`${f}.dt_bias`,shape:[d],from:[`${m}.dt_bias`],op:{kind:"copy"}},{target:`${f}.D_vec`,shape:[d],from:[`${m}.D`],op:{kind:"copy"}},{target:`${f}.wOutProj`,shape:[t,r],from:[`${m}.out_proj.weight`],op:{kind:"copy"}},{target:`${f}.normWeight`,shape:[r],from:[`${m}.norm.weight`],op:{kind:"copy"},note:"upstream this gain belongs to a GATED RMSNorm; applied ungated here"},{target:`${f}.preNormWeight`,shape:[t],from:[`backbone.layers.${h}.norm.weight`],op:{kind:"copy"}})}return l.push({target:"final_norm",shape:[t],from:["backbone.norm_f.weight"],op:{kind:"copy"}}),l}function La(o){const e=[];for(let t=0;t<o.numLayers;t++)e.push({source:`backbone.layers.${t}.mixer.in_proj.weight`,elements:o.dInner*o.dModel,reason:"the leading d_inner gate (z) rows — Mamba2Block computes norm(y) rather than norm(y * silu(z)), so it has no gate branch to receive them"});return e}const Sa={id:nr,label:"Codestral-Mamba (Mamba-2 / SSD)",modelTypes:["mamba2"],architectures:["Mamba2ForCausalLM","MambaCodestralForCausalLM"],describe(o){const e=re(o,"hidden_size"),t=re(o,"num_hidden_layers"),n=re(o,"vocab_size"),r=re(o,"state_size"),a=re(o,"conv_kernel"),s=re(o,"num_heads"),d=Me(o,["n_groups"])??1,i=Me(o,["chunk_size"])??256,c=qr(o,e),u=Vr(c,e,"Codestral-Mamba"),l=Me(o,["head_dim"]);if(c%s!==0)throw new Error(`import/foreign: Codestral-Mamba d_inner ${c} is not divisible by num_heads ${s}`);if(l!==void 0&&l*s!==c)throw new Error(`import/foreign: Codestral-Mamba config is inconsistent — head_dim ${l} × num_heads ${s} = ${l*s}, but d_inner is ${c}`);const h=Array.from({length:t},()=>({type:"mamba2"})),m={vocabSize:n,dModel:e,numLayers:t,layers:h,dState:r,dConv:a,expand:u,nHeads:s,nGroups:d,chunkLen:i},f={vocabSize:n,dModel:e,numLayers:t,dInner:c,dState:r,dConv:a,nHeads:s,nGroups:d};return{modelConfig:m,plan:{adapter:nr,rules:Ma(f),discards:La(f)}}}},it=[ka,xa,Sa];function Ea(o){const e=o.architectures;return Array.isArray(e)?e.filter(t=>typeof t=="string"):[]}function Ba(o){const e=o.model_type;return typeof e=="string"?e:void 0}function Da(o,e){const t=[...o,e??""].join(" ").toLowerCase();return t.includes("mamba")||t.includes("ssm")?!1:/llama|mistral|qwen|gpt|phi|gemma|falcon(?!_?mamba)|starcoder|deepseek|olmo|attention|forcausallm/.test(t)}function or(){return it.map(o=>`${o.label} — architectures ${o.architectures.join(" / ")}, model_type ${o.modelTypes.join(" / ")}`).join("; ")}function Fa(o){const e=Ea(o),t=Ba(o),n=it.find(s=>e.some(d=>s.architectures.includes(d)));if(n)return n;const r=t?it.find(s=>s.modelTypes.includes(t)):void 0;if(r)return r;const a=e.length>0?`architectures [${e.join(", ")}]`:t?`model_type "${t}"`:"a config declaring neither `architectures` nor `model_type`";throw Da(e,t)?new Error(`import/foreign: ${a} is a TRANSFORMER checkpoint — its attention weights (q/k/v/o projections, positional embeddings) have no counterpart in a state-space mixer, so no weight port can exist for it at any tensor naming. Transformer coders (IQuest, NousCoder, Maincoder and the like) can only be brought across by DISTILLATION — train this engine's SSM against the transformer's outputs. Weight porting is supported only for: ${or()}.`):new Error(`import/foreign: unsupported checkpoint — ${a}. Supported: ${or()}. A transformer checkpoint cannot be weight-ported at all; distillation is the only route.`)}function Ca(o,e){const t=Fa(o),{modelConfig:n,plan:r}=t.describe(o);return{...ba(r,e),modelConfig:n}}function Xs(o,e){return Ca(o,Kr(e))}function Ys(o,e){const t=o.parameters(),n=new Set(t.map(a=>a.name)),r=[...e.weights.keys()].filter(a=>!n.has(a));if(r.length>0)throw new Error(`import/foreign: ported tensors ${r.slice(0,5).map(a=>`"${a}"`).join(", ")}${r.length>5?` (+${r.length-5} more)`:""} have no parameter on this model — build it from the port's modelConfig`);for(const a of t){const s=e.weights.get(a.name);if(!s)throw new Error(`import/foreign: no ported tensor for parameter "${a.name}" — the model was built from a different config than the port's modelConfig`);if(s.length!==a.numel)throw new Error(`import/foreign: parameter "${a.name}" expects ${a.numel} elements, the port produced ${s.length}`);ge(o.device,a.buf,s)}}function Ie(o){throw new Error(`import/foreign: cannot read a Mamba-1 config from these tensors — ${o}`)}function Qs(o){const e=new Map(o.map(p=>[Hr(p.name),p])),t=p=>{var w;return(w=e.get(p))==null?void 0:w.shape},n=t("backbone.embeddings.weight")??t("backbone.embedding.weight");(!n||n.length!==2)&&Ie("no backbone.embedding(s).weight [vocab, d_model]");const[r,a]=n;let s=0;for(;e.has(`backbone.layers.${s}.mixer.in_proj.weight`);)s++;s===0&&Ie("no backbone.layers.N.mixer.in_proj.weight");const d="backbone.layers.0.mixer",i=t(`${d}.in_proj.weight`),c=t(`${d}.conv1d.weight`),u=t(`${d}.A_log`),l=t(`${d}.x_proj.weight`);(!c||!u||!l)&&Ie("layer 0 is missing conv1d.weight, A_log or x_proj.weight");const h=i[0]/2,m=u[1],f=c[c.length-1],g=l[0]-2*m;return(!Number.isInteger(h)||g<=0)&&Ie(`inconsistent shapes (in_proj ${i.join("×")}, x_proj ${l.join("×")})`),{model_type:"mamba",architectures:["MambaForCausalLM"],vocab_size:r,hidden_size:a,num_hidden_layers:s,intermediate_size:h,state_size:m,conv_kernel:f,time_step_rank:g}}function Js(o,e,t={}){if(!Number.isInteger(e)||e<=0)throw new Error(`import/foreign: vocabulary size must be a positive integer, got ${e}`);const n=o.modelConfig.vocabSize;if(e===n)return o;const r=o.weights.get("embedding");if(!r)throw new Error('import/foreign: the port has no "embedding" to resize');const a=o.modelConfig.dModel,s=new Float32Array(e*a);s.set(r.subarray(0,Math.min(n,e)*a));const d=[...o.synthesisedTargets];if(e>n){const c=t.std??.02,u=new ne(t.seed??1);s.set(we((e-n)*a,c,()=>u.next()),n*a),d.push({target:"embedding",value:c,reason:`rows ${n}..${e-1} drawn from N(0, ${c}²) to reach a ${e}-token vocabulary`})}const i=new Map(o.weights);return i.set("embedding",s),{...o,weights:i,synthesisedTargets:d,modelConfig:{...o.modelConfig,vocabSize:e}}}const Pa=`

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
`,Zs=`

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
`,ei={amygdala:"amygdala",hypothalamus:"hypothalamus",thalamus:"thalamus",basalGanglia:"basal_ganglia",hippocampus:"hippocampus"},Yr={valence:0,arousal:1,driveCuriosity:2,driveCaution:3,driveEffort:4,driveSocial:5,attention:6,exploration:7},Qr=8,se=["valence","arousal","driveCuriosity","driveCaution","driveEffort","driveSocial","attention","exploration"],Ta=[[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],At=[0,.2,.5,.5,.8,.5,.7,.5];function Ve(o,e){const t=Ta[o];return t?Number.isNaN(e)?t[0]:Math.max(t[0],Math.min(t[1],e)):e}function ti(o){for(let e=0;e<o.length&&e<Qr;e++)o[e]=Ve(e,o[e]);return o}function Na(){return Float32Array.from(At)}function Jr(o){const e={};for(let t=0;t<se.length;t++)e[se[t]]=o[t]??0;return e}function $a(o){const e=Na();for(let t=0;t<se.length;t++){const n=o[se[t]];typeof n=="number"&&!Number.isNaN(n)&&(e[t]=Ve(t,n))}return e}function ie(o){return((typeof o=="number"&&!Number.isNaN(o)?Math.max(0,Math.min(100,o)):50)-50)/50}function Zr(o){const e=Jr(At);if(!o)return e;const t=ie(o.openness),n=ie(o.emotionality),r=ie(o.conscientiousness),a=ie(o.extraversion),s=ie(o.regulatoryFocus),d=ie(o.riskTolerance),i=ie(o.grit),c=ie(o.stimulation),u=(l,h)=>{e[l]=Ve(Yr[l],h)};return u("driveCuriosity",.5+.35*t+.15*c),u("exploration",.4+.3*t+.25*d+.15*s),u("driveCaution",.5+.3*r-.3*d-.2*s+.15*n),u("arousal",.2+.2*n+.1*a),u("driveSocial",.5+.35*a),u("driveEffort",.8+.15*i+.1*r),u("valence",0+.1*s-.1*n),u("attention",.7+.1*r),e}function ri(o){return $a(Zr(o))}function dt(o,e){return Ve(Yr[o],e)}function ct(){return Jr(At)}function ni(o){if(o.length===0)return ct();const e=ct();for(const t of se)e[t]=0;for(const t of o){const n=Zr(t);for(const r of se)e[r]+=n[r]}for(const t of se)e[t]/=o.length;return e}function ar(o,e){const t={...o};for(const n of se){const r=e[n];typeof r=="number"&&!Number.isNaN(r)&&(t[n]=dt(n,t[n]+r))}return t}const Ia=o=>Math.max(0,Math.min(1,o.intensity??.5));function oi(o){const e=Ia(o);switch(o.kind){case"success":return{valence:.5*e,arousal:-.15*e,driveCaution:-.1*e,driveEffort:-.05*e};case"progress":return{valence:.25*e,arousal:.05*e,driveEffort:-.03*e};case"error":return{valence:-.45*e,arousal:.4*e,driveCaution:.3*e,attention:.15*e};case"blocked":return{valence:-.35*e,arousal:.3*e,driveEffort:-.15*e,driveSocial:.2*e};case"risk":return{arousal:.35*e,driveCaution:.4*e,attention:.2*e,exploration:-.15*e};case"feedback":{const t=Math.sign(o.sign??1)||1;return{valence:.4*e*t,arousal:.1*e,driveSocial:.1*e}}case"idle":return{arousal:-.2*e,driveEffort:.15*e};default:return{}}}function ai(o,e,t={}){const n=t.rate??.1,r=t.fatigue??0,a={...o};for(const s of se)a[s]=dt(s,a[s]+n*(e[s]-a[s]));return r>0&&(a.driveEffort=dt("driveEffort",a.driveEffort-r)),a}function za(o,e=.5){const t=o.arousal-e,n=1-2.8*t*t;return Math.max(.1,Math.min(1,n))}function lt(o){let e=.5*o.exploration+.3*o.driveCuriosity;return e+=.15*o.valence,e-=.25*(1-o.driveEffort),e-=.2*(o.driveCaution-.5),Math.max(0,Math.min(1,e))}function si(o,e){if(e.length===0)return{choice:null,exploreBias:lt(o)};const t=lt(o);let n=e[0],r=-1/0;for(const a of e){const s=Math.max(0,Math.min(1,a.novelty)),d=-Math.abs(s-t);d>r&&(r=d,n=a)}return{choice:n,exploreBias:t}}const et=.6,tt=.4;function Wa(o){const e=[],t={},n=i=>{t.thinkLevel!=="high"&&(t.thinkLevel=i)};o.valence<=-.4?(e.push("Affect (negative): recent steps have gone badly — slow down, avoid rash or destructive actions, and re-verify your assumptions before proceeding."),n("high"),t.reasoningLevel="on"):o.valence>=.4&&e.push("Affect (positive): things are going well — keep momentum, but don't get sloppy."),o.arousal>=.7?(e.push("Arousal (heightened): you are highly activated — resist the urge to rush; double-check before any irreversible step."),n("high")):o.arousal<=.15&&e.push("Arousal (low): this is routine — keep it lightweight and efficient."),o.driveCaution>=et?(e.push("Drive (caution): heightened — prefer reversible steps, add guardrails, and confirm risky or destructive operations."),n("medium")):o.driveCaution<=tt&&e.push("Drive (caution): relaxed — bias to action on low-risk work."),o.driveCuriosity>=et&&e.push("Drive (curiosity): high — it is appropriate to investigate and consider alternative approaches."),o.driveEffort<=tt&&e.push("Drive (effort): energy is low — keep scope tight, avoid over-engineering, checkpoint progress, and consider escalating rather than grinding."),o.driveSocial>=et?e.push("Drive (social): communicate proactively — surface progress and ask for input when blocked."):o.driveSocial<=tt&&e.push("Drive (social): work heads-down — narrate only what matters."),za(o)<=.5&&(e.push("Attention (degraded): your attention gate is low — re-read the task carefully and do not skip verification steps."),n("medium"));const a=lt(o);a>=.7?e.push("Action selection: lean exploratory — try a novel approach before settling on the obvious one."):a<=.3&&e.push("Action selection: lean exploitative — use the proven, known approach and avoid unnecessary detours.");let s=0;s+=.2*(o.exploration-.5)*2,s+=.06*(o.driveCuriosity-.5)*2,s+=.08*o.valence,s-=.16*(o.driveCaution-.5)*2,s-=.08*Math.max(0,o.arousal-.7);const d=Math.max(-.3,Math.min(.3,Math.round(s*100)/100));return Math.abs(d)>=.02&&(t.temperatureDelta=d),{directives:e,params:t}}const ja="Current affective state (execute accordingly):";function ii(o){if(!o)return"";const{directives:e}=Wa(o);return e.length===0?"":[ja,...e.map(t=>`- ${t}`)].join(`
`)}const Ra=/\b(delete|drop|truncate|destroy|wipe|prod(uction)?|migrat|secret|credential|password|payment|billing|charge|refund|deploy|force[- ]?push|rm\s+-rf|irreversible|security|auth|breaking)\b/i,Oa=/\b(refactor|rewrite|architecture|complex|large|entire|whole|across|end[- ]to[- ]end|overhaul)\b/i;function di(o,e=ct()){const t=o||"";let n=e;return Ra.test(t)&&(n=ar(n,{driveCaution:.3,arousal:.25,attention:.15,exploration:-.1})),Oa.test(t)&&(n=ar(n,{driveCuriosity:.2,arousal:.1,exploration:.1})),n}const Ua={inputDim:32,hiddenDim:16,stateDim:Qr,rewardWeight:.5},sr=1280131651,Ga=296863214;function Ka(o){return 1/(1+Math.exp(-o))}class ci{constructor(e={}){_(this,"config");_(this,"win");_(this,"ws");_(this,"aLogit");_(this,"woutState");_(this,"boutState");_(this,"woutReward");_(this,"boutReward");_(this,"gWin");_(this,"gWs");_(this,"gALogit");_(this,"gWoutState");_(this,"gBoutState");_(this,"gWoutReward");_(this,"gBoutReward");const t={...Ua,...e};if(t.hiddenDim>64)throw new Error(`LimbicModel hiddenDim must be ≤ 64 (got ${t.hiddenDim})`);this.config=t;const{inputDim:n,hiddenDim:r,stateDim:a}=t,s=new ne((e.seed??Ga)>>>0||1),d=c=>{const u=Math.max(s.next(),1e-12),l=s.next();return c*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*l)},i=(c,u)=>{const l=new Float32Array(c);for(let h=0;h<c;h++)l[h]=d(u);return l};this.win=i(r*n,.1),this.ws=i(r*a,.1),this.aLogit=i(r,.05),this.woutState=i(a*r,.05),this.boutState=new Float32Array(a),this.woutReward=i(r,.05),this.boutReward=new Float32Array(1),this.gWin=new Float32Array(this.win.length),this.gWs=new Float32Array(this.ws.length),this.gALogit=new Float32Array(this.aLogit.length),this.gWoutState=new Float32Array(this.woutState.length),this.gBoutState=new Float32Array(this.boutState.length),this.gWoutReward=new Float32Array(this.woutReward.length),this.gBoutReward=new Float32Array(1)}parameters(){return[{name:"win",data:this.win,numel:this.win.length},{name:"ws",data:this.ws,numel:this.ws.length},{name:"aLogit",data:this.aLogit,numel:this.aLogit.length},{name:"woutState",data:this.woutState,numel:this.woutState.length},{name:"boutState",data:this.boutState,numel:this.boutState.length},{name:"woutReward",data:this.woutReward,numel:this.woutReward.length},{name:"boutReward",data:this.boutReward,numel:this.boutReward.length}]}gradients(){return[{name:"win",data:this.gWin,numel:this.gWin.length},{name:"ws",data:this.gWs,numel:this.gWs.length},{name:"aLogit",data:this.gALogit,numel:this.gALogit.length},{name:"woutState",data:this.gWoutState,numel:this.gWoutState.length},{name:"boutState",data:this.gBoutState,numel:this.gBoutState.length},{name:"woutReward",data:this.gWoutReward,numel:this.gWoutReward.length},{name:"boutReward",data:this.gBoutReward,numel:this.gBoutReward.length}]}zeroGrad(){this.gWin.fill(0),this.gWs.fill(0),this.gALogit.fill(0),this.gWoutState.fill(0),this.gBoutState.fill(0),this.gWoutReward.fill(0),this.gBoutReward.fill(0)}initHidden(){return new Float32Array(this.config.hiddenDim)}forward(e,t,n){const r=this._forwardCached(e,t,n);return{hidden:r.hn,delta:r.delta,reward:r.reward}}_forwardCached(e,t,n){const{inputDim:r,hiddenDim:a,stateDim:s}=this.config,d=Float32Array.from({length:r},(g,p)=>e[p]??0),i=Float32Array.from({length:a},(g,p)=>t[p]??0),c=Float32Array.from({length:s},(g,p)=>n[p]??0),u=new Float32Array(a),l=new Float32Array(a),h=new Float32Array(a);for(let g=0;g<a;g++){let p=0;const w=g*r;for(let b=0;b<r;b++)p+=this.win[w+b]*d[b];const v=g*s;for(let b=0;b<s;b++)p+=this.ws[v+b]*c[b];u[g]=Ka(this.aLogit[g]),l[g]=Math.tanh(p),h[g]=u[g]*i[g]+(1-u[g])*l[g]}const m=new Float32Array(s);for(let g=0;g<s;g++){let p=this.boutState[g];const w=g*a;for(let v=0;v<a;v++)p+=this.woutState[w+v]*h[v];m[g]=Math.tanh(p)}let f=this.boutReward[0];for(let g=0;g<a;g++)f+=this.woutReward[g]*h[g];return{x:d,sPrev:c,hPrev:i,a:u,t:l,hn:h,delta:m,reward:f}}backwardStep(e,t,n,r,a){const{inputDim:s,hiddenDim:d,stateDim:i,rewardWeight:c}=this.config,u=this._forwardCached(e,t,n);let l=0;const h=new Float32Array(i);for(let p=0;p<i;p++){const w=u.delta[p]-(r[p]??0);l+=.5*w*w,h[p]=w}const m=u.reward-a;l+=.5*c*m*m;const f=c*m,g=new Float32Array(d);for(let p=0;p<i;p++){const w=h[p]*(1-u.delta[p]*u.delta[p]);this.gBoutState[p]=this.gBoutState[p]+w;const v=p*d;for(let b=0;b<d;b++)this.gWoutState[v+b]=this.gWoutState[v+b]+w*u.hn[b],g[b]=g[b]+w*this.woutState[v+b]}this.gBoutReward[0]=this.gBoutReward[0]+f;for(let p=0;p<d;p++)this.gWoutReward[p]=this.gWoutReward[p]+f*u.hn[p],g[p]=g[p]+f*this.woutReward[p];for(let p=0;p<d;p++){const w=u.a[p],v=u.t[p];this.gALogit[p]=this.gALogit[p]+g[p]*(u.hPrev[p]-v)*w*(1-w);const b=g[p]*(1-w)*(1-v*v),y=p*s;for(let S=0;S<s;S++)this.gWin[y+S]=this.gWin[y+S]+b*u.x[S];const k=p*i;for(let S=0;S<i;S++)this.gWs[k+S]=this.gWs[k+S]+b*u.sPrev[S]}return{loss:l,hidden:u.hn}}exportWeights(e={}){const t=e.fp16??!1,n=this.parameters(),r=n.reduce((u,l)=>u+l.numel,0),a=5,s=a*4,d=t?r*2:r*4,i=new ArrayBuffer(s+d),c=new Uint32Array(i,0,a);if(c[0]=sr,c[1]=t?2:1,c[2]=this.config.inputDim,c[3]=this.config.hiddenDim,c[4]=this.config.stateDim,t){const u=new Float32Array(r);let l=0;for(const m of n)u.set(m.data,l),l+=m.numel;const h=Be(u);new Uint16Array(i,s,r).set(h)}else{const u=new Float32Array(i,s,r);let l=0;for(const h of n)u.set(h.data,l),l+=h.numel}return i}loadWeights(e){const t=new Uint32Array(e,0,5);if(t[0]!==sr)throw new Error("LimbicModel.loadWeights: bad magic (not an LMBC checkpoint)");const n=t[1],r=t[2],a=t[3],s=t[4];if(r!==this.config.inputDim||a!==this.config.hiddenDim||s!==this.config.stateDim)throw new Error(`LimbicModel.loadWeights: dim mismatch — checkpoint ${r}/${a}/${s} vs model ${this.config.inputDim}/${this.config.hiddenDim}/${this.config.stateDim}`);const d=this.parameters(),i=d.reduce((h,m)=>h+m.numel,0),c=20;let u;n===2?u=De(new Uint16Array(e,c,i)):u=new Float32Array(e.slice(c,c+i*4));let l=0;for(const h of d)h.data.set(u.subarray(l,l+h.numel)),l+=h.numel}}function Ha(o,e,t,n,r,a,s,d){const i=new ArrayBuffer(32);return new Uint32Array(i,0,1).set([o]),new Float32Array(i,4,7).set([e,t,n,r,a,s,d]),i}class li{constructor(e,t=null){_(this,"model");_(this,"device");_(this,"_moments",null);_(this,"_step",0);_(this,"_adamwPipeline");this.model=e,this.device=t,this._adamwPipeline=t?O(t,Pa,"adamw_update"):null}get gpuTraining(){return this.device!=null&&this._adamwPipeline!=null}_initMoments(){this._moments||(this._moments=this.model.parameters().map(e=>({m:new Float32Array(e.numel),v:new Float32Array(e.numel)})))}async train(e,t={}){if(e.length===0)throw new Error("LimbicTrainer.train: no samples");const{learningRate:n=.05,epochs:r=50,weightDecay:a=0,beta1:s=.9,beta2:d=.999,eps:i=1e-8,maxGradNorm:c=1,onEpochEnd:u=null}=t;this._initMoments();const l=[];for(let h=0;h<r;h++){this.model.zeroGrad();let m=0;for(const k of e){const{loss:S}=this.model.backwardStep(k.input,this.model.initHidden(),k.state,k.deltaTarget,k.reward);m+=S}const f=this.model.gradients(),g=1/e.length;for(const k of f)for(let S=0;S<k.data.length;S++)k.data[S]*=g;const p=this._clipGradients(f,c);this._step++;const w=Math.pow(s,this._step),v=Math.pow(d,this._step),b={learningRate:n,weightDecay:a,beta1:s,beta2:d,eps:i,beta1_t:w,beta2_t:v};this.gpuTraining?await this._adamwStepGpu(f,b):this._adamwStepCpu(f,b);const y=m/e.length;l.push(y),u&&u(h+1,y,p)}return l}evaluate(e){if(e.length===0)return 0;let t=0;const{rewardWeight:n}=this.model.config;for(const r of e){const a=this.model.forward(r.input,this.model.initHidden(),r.state);let s=0;for(let i=0;i<a.delta.length;i++){const c=a.delta[i]-(r.deltaTarget[i]??0);s+=.5*c*c}const d=a.reward-r.reward;s+=.5*n*d*d,t+=s}return t/e.length}_clipGradients(e,t){let n=0;for(const a of e)for(let s=0;s<a.data.length;s++)n+=a.data[s]*a.data[s];const r=Math.sqrt(n);if(r>t&&r>0){const a=t/r;for(const s of e)for(let d=0;d<s.data.length;d++)s.data[d]*=a}return r}_adamwStepCpu(e,t){const n=this.model.parameters(),{learningRate:r,weightDecay:a,beta1:s,beta2:d,eps:i,beta1_t:c,beta2_t:u}=t;for(let l=0;l<n.length;l++){const h=n[l].data,m=e[l].data,f=this._moments[l];for(let g=0;g<h.length;g++){const p=m[g];f.m[g]=s*f.m[g]+(1-s)*p,f.v[g]=d*f.v[g]+(1-d)*p*p;const w=f.m[g]/(1-c),v=f.v[g]/(1-u);h[g]=h[g]*(1-r*a)-r*w/(Math.sqrt(v)+i)}}}async _adamwStepGpu(e,t){const n=this.device,r=this._adamwPipeline,a=this.model.parameters(),{learningRate:s,weightDecay:d,beta1:i,beta2:c,eps:u,beta1_t:l,beta2_t:h}=t;for(let m=0;m<a.length;m++){const f=a[m],g=this._moments[m],p=J(n,f.data,!0),w=J(n,e[m].data,!1),v=J(n,g.m,!0),b=J(n,g.v,!0),y=W(n,Ha(f.numel,s,i,c,u,d,l,h)),k=I(n,r,[y,p,w,v,b]);z(n,r,k,[C(f.numel,256),1,1]),f.data.set((await de(n,p,f.numel*4)).subarray(0,f.numel)),g.m.set((await de(n,v,f.numel*4)).subarray(0,f.numel)),g.v.set((await de(n,b,f.numel*4)).subarray(0,f.numel)),p.destroy(),w.destroy(),v.destroy(),b.destroy(),y.destroy()}}}const ui=`

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
`;function qa(){const o=new Uint8Array(8);return globalThis.crypto.getRandomValues(o),Array.from(o,e=>e.toString(16).padStart(2,"0")).join("")}const Va=new Set(["send","submit","pay","purchase","buy","order","checkout","delete","remove","confirm","transfer","publish","post","sign","approve","book","cancel","erase","wipe","format","uninstall","senden","absenden","bezahlen","kaufen","bestellen","löschen","entfernen","bestätigen","überweisen","veröffentlichen","enviar","pagar","comprar","pedido","eliminar","borrar","confirmar","transferir","publicar","envoyer","payer","acheter","commander","supprimer","confirmer","virement","publier"]),Xa=["发送","提交","支付","付款","购买","下单","删除","确认","转账","发布"];function ir(o){const e=o.toLowerCase();return Xa.some(t=>e.includes(t))?!0:e.split(/[^\p{L}\p{N}]+/u).some(t=>t.length>0&&Va.has(t))}function ue(o){return o?o.name.trim()||o.automationId.trim():""}function Ya(o){switch(o.kind){case"click":return ir(ue(o.target));case"keys":return o.keys.toLowerCase()==="enter"&&ir(ue(o.target));case"setValue":return!1}}function hi(o,e={},t=Date.now()){var d,i,c;const n=new Set(e.removed??[]),r=new Set(e.fixed??[]),a=[],s=[];for(const u of o.steps){if(n.has(u.id))continue;const l=u.action;let h;if(l.kind==="setValue")if(!l.secret&&r.has(u.id))h={kind:"setValue",target:l.target,value:{from:"literal",text:l.value}};else{const f=dr(((d=e.paramNames)==null?void 0:d[u.id])??"")||dr(ue(l.target))||"value",g=Qa(a,f);a.push({name:g,label:ue(l.target),default:l.secret?null:l.value,secret:!!l.secret}),h={kind:"setValue",target:l.target,value:{from:"param",name:g}}}else h=l;s.push({id:u.id,action:h,requiresApproval:((i=e.approvals)==null?void 0:i[u.id])??Ya(l),screenshot:u.screenshot??null})}return{id:qa(),name:((c=e.name)==null?void 0:c.trim())||o.name,program:o.program,args:[...o.args],params:a,steps:s,sourceEpisode:o.id,createdAt:t,routine:null}}function dr(o){return o.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join("_").slice(0,40).replace(/_+$/,"")}function Qa(o,e){if(!o.some(t=>t.name===e))return e;for(let t=2;;t++){const n=`${e}_${t}`;if(!o.some(r=>r.name===n))return n}}const rt=6e4,nt=864e5;function Ja(o,e,t,n){if(o.every==="minutes"){const i=Math.max(1,o.minutes)*rt;return e==null||t-e>=i}const r=n*rt,a=t+r,d=a-(a%nt+nt)%nt+Math.min(23,Math.max(0,o.hour))*36e5+Math.min(59,Math.max(0,o.minute))*rt;return a>=d&&(e==null||e+r<d)}function fi(o,e,t){return o.filter(n=>{var r;return((r=n.routine)==null?void 0:r.enabled)&&Ja(n.routine.schedule,n.routine.lastRunAt,e,t)}).sort((n,r)=>{var a,s;return(((a=n.routine)==null?void 0:a.lastRunAt)??0)-(((s=r.routine)==null?void 0:s.lastRunAt)??0)})}function me(o){const e="target"in o&&o.target?o.target.windowTitle:"";return e?` in “${e}”`:""}function en(o){switch(o.kind){case"click":return`Click “${ue(o.target)}”${me(o)}.`;case"keys":return o.target?`Press ${o.keys} in “${ue(o.target)}”${me(o)}.`:`Press ${o.keys}.`;case"setValue":{const e=`“${ue(o.target)}”`;return typeof o.value=="string"?"secret"in o&&o.secret?`Enter the secret for ${e}${me(o)}.`:`Set ${e} to “${o.value}”${me(o)}.`:o.value.from==="param"?`Set ${e} to <${o.value.name}>${me(o)}.`:`Set ${e} to “${o.value.text}”${me(o)}.`}}}function tn(o){return o.split(/[\\/]/).pop()??o}function Za(o){const e=[`Task: ${o.name} (${tn(o.program)})`];return o.steps.forEach((t,n)=>e.push(`${n+1}. ${en(t.action)}${t.requiresApproval?" Ask before doing this.":""}`)),e.join(`
`)}function es(o){const e=[`Task: ${o.name} (${tn(o.program)})`];return o.steps.forEach((t,n)=>e.push(`${n+1}. ${en(t.action)}`)),e.join(`
`)}function mi(o,e){return rn(o,e).map(t=>t.text).join(`

`)}function rn(o,e){const t=new Set(e.map(n=>n.sourceEpisode));return[...e.map(n=>({id:n.id,text:Za(n)})),...o.filter(n=>!t.has(n.id)).map(n=>({id:n.id,text:es(n)}))]}function pi(o,e){const t=[];let n=[],r=0;for(const a of o){const s=n.length?a.text.length+2:a.text.length;if(n.length&&r+s>e){t.push(n),n=[],r=0,n.push(a),r=a.text.length;continue}n.push(a),r+=s}return n.length&&t.push(n),t}const ts=864e5;function cr(o,e){return new Date(o+e*6e4).toISOString().slice(0,10)}function gi(o,e){const t=m=>{const f=o.learned[m];return typeof f=="number"&&f>=1&&f<=e.modelIndex},n=rn(o.episodes,o.skills),r=n.filter(m=>t(m.id)).length,a={running:0,succeeded:0,failed:0,stopped:0,denied:0},s={approved:0,denied:0},d=[];for(const m of o.episodes)d.push({region:"hippocampus",kind:"demonstration",id:m.id,name:m.name,at:m.startedAt});for(const m of o.skills)d.push({region:"basalGanglia",kind:"skill",id:m.id,name:m.name,at:m.createdAt});for(const m of o.runs){a[m.status]=(a[m.status]??0)+1,d.push({region:"basalGanglia",kind:"run",id:m.id,name:m.skillName,at:m.startedAt,detail:m.status});for(const f of m.steps)f.outcome!=="approved"&&f.outcome!=="denied"||(s[f.outcome]++,d.push({region:"amygdala",kind:"approval",id:m.id,name:m.skillName,at:f.at,detail:f.outcome}))}const i=o.adaptations.filter(m=>m.index<=e.modelIndex).reverse();for(const m of i)d.push({region:"neocortex",kind:"adaptation",id:m.version,name:m.version,at:m.at,detail:m.loss.toFixed(3)});const c=Math.max(1,e.days??30),u=[],l=new Map;for(let m=c-1;m>=0;m--){const f=cr(e.now-m*ts,e.utcOffsetMinutes);if(l.has(f))continue;const g={day:f,demonstrations:0,skills:0,runs:0,learned:0};l.set(f,g),u.push(g)}const h=(m,f,g=1)=>{const p=l.get(cr(m,e.utcOffsetMinutes));p&&(p[f]+=g)};for(const m of o.episodes)h(m.startedAt,"demonstrations");for(const m of o.skills)h(m.createdAt,"skills");for(const m of o.runs)h(m.startedAt,"runs");for(const m of i)h(m.at,"learned",m.learned.length);return{regions:{hippocampus:o.episodes.length,basalGanglia:o.skills.length,amygdala:s.approved+s.denied,hypothalamus:o.skills.filter(m=>{var f;return(f=m.routine)==null?void 0:f.enabled}).length,neocortex:r},learned:r,pending:n.length-r,runs:a,approvals:s,adaptations:i,days:u,recent:d.sort((m,f)=>f.at-m.at).slice(0,Math.max(0,e.recent??40))}}const ut="evermind.experience/1",rs=500,ns=200;function ht(){return{schema:ut,episodes:[],skills:[],runs:[],learned:{},adaptations:[]}}function lr(o){const e=o;return!e||e.schema!==ut?ht():{schema:ut,episodes:Array.isArray(e.episodes)?e.episodes:[],skills:Array.isArray(e.skills)?e.skills:[],runs:Array.isArray(e.runs)?e.runs:[],learned:e.learned&&typeof e.learned=="object"&&!Array.isArray(e.learned)?e.learned:{},adaptations:Array.isArray(e.adaptations)?e.adaptations:[]}}function os(o){return{id:o.id,name:o.name,program:o.program,startedAt:o.startedAt,steps:o.steps.length}}class pe{constructor(e,t){_(this,"onChange");_(this,"data");this.onChange=t,this.data=e?lr(e):ht()}load(e){this.data=lr(e)}async changed(){var e;await((e=this.onChange)==null?void 0:e.call(this,this.data))}static upsert(e,t){const n=e.findIndex(r=>r.id===t.id);n>=0?e[n]=t:e.push(t)}static remove(e,t){const n=e.findIndex(r=>r.id===t);return n<0?!1:(e.splice(n,1),!0)}async putEpisode(e){pe.upsert(this.data.episodes,e),await this.changed()}async getEpisode(e){return this.data.episodes.find(t=>t.id===e)}async listEpisodes(){return[...this.data.episodes].sort((e,t)=>t.startedAt-e.startedAt).map(os)}async deleteEpisode(e){const t=pe.remove(this.data.episodes,e);return delete this.data.learned[e],t&&await this.changed(),t}async putSkill(e){pe.upsert(this.data.skills,e),await this.changed()}async getSkill(e){return this.data.skills.find(t=>t.id===e)}async listSkills(){return[...this.data.skills].sort((e,t)=>t.createdAt-e.createdAt)}async deleteSkill(e){const t=pe.remove(this.data.skills,e);return delete this.data.learned[e],t&&await this.changed(),t}async putRun(e){pe.upsert(this.data.runs,e),this.data.runs.sort((t,n)=>n.startedAt-t.startedAt),this.data.runs.length=Math.min(this.data.runs.length,rs),await this.changed()}async appendRunStep(e,t){const n=this.data.runs.find(r=>r.id===e);return n?(n.steps.push(t),await this.changed(),!0):!1}async getRun(e){return this.data.runs.find(t=>t.id===e)}async listRuns(e){return this.data.runs.slice(0,Math.max(0,e))}async recordAdaptation(e){for(const t of e.learned)this.data.learned[t]=e.index;this.data.adaptations.unshift(e),this.data.adaptations.length=Math.min(this.data.adaptations.length,ns),await this.changed()}async snapshot(){return structuredClone(this.data)}async clear(){this.data=ht(),await this.changed()}}export{hs as ACTIVATIONS_BACKWARD_WGSL,_e as ACTIVATIONS_WGSL,ps as ATTENTION_BACKWARD_WGSL,Dt as ATTENTION_FORWARD_WGSL,zr as A_LOG_CLAMP_HI,Ir as A_LOG_CLAMP_LO,gt as AdamW,An as AttentionBlock,Fe as BPETokenizer,cn as BufferPool,Oe as COL_SLICE_ENTRY,Re as COL_SLICE_WGSL,ms as COMPLEX_SSD_BACKWARD_WGSL,bn as COMPLEX_SSD_FORWARD_WGSL,ds as CONV1D_BACKWARD_WGSL,ft as CONV1D_FORWARD_WGSL,Xt as CPU_GRADIENT_LAYER_TYPES,br as CRC_TRAILER_MAGIC,Ua as DEFAULT_LIMBIC_CONFIG,Ga as DEFAULT_LIMBIC_SEED,ve as DEFAULT_LM_CONFIG,Rn as DEFAULT_LM_SEED,Bo as DEFAULT_LORA_TARGETS,Pn as DEFAULT_MOE_CONFIG,Tn as DEFAULT_MOE_SEED,zn as DynamicLossScaler,co as EVERMIND_ADAPT_MAX_CHARS,ut as EXPERIENCE_SCHEMA,Hs as EXPORT_FORMATS,He as EvermindLM,Pr as EvermindLMLoRA,wt as EvermindLMTrainer,ee as EvermindModelPackage,js as EvermindTextEmbedder,it as FOREIGN_MAMBA_ADAPTERS,Zs as GRAD_CLIP_WGSL,Dn as HybridMambaModel,Us as ImageRVQCodec,pe as InMemoryExperienceStore,ui as LIMBIC_AFFECT_WGSL,ja as LIMBIC_BLOCK_HEADER,Ta as LIMBIC_BOUNDS,Yr as LIMBIC_DIM,se as LIMBIC_DIM_NAMES,Qr as LIMBIC_STATE_DIM,cs as LINEAR_BACKWARD_WGSL,Ee as LINEAR_FORWARD_WGSL,Jn as LN2,ci as LimbicModel,li as LimbicTrainer,Se as LoRAAdapter,$n as LoadBalanceAccumulator,vt as MAMBA1_PARAM_NAMES,ns as MAX_ADAPTATIONS,Kt as MAX_DELTA_B64_CHARS,rs as MAX_RUNS,mn as Mamba1Block,_n as Mamba2Block,yn as Mamba3Block,mn as MambaBlock,ws as MambaModel,Os as MambaTrainer,ys as MoETrainer,Kn as MultimodalVocab,At as NEUTRAL_STATE,xe as PACKAGE_HEADER_BYTES,ei as REGION,Ce as RMSNORM_EPS,is as SELECTIVE_SCAN_BACKWARD_WGSL,Et as SELECTIVE_SCAN_FORWARD_WGSL,us as SOFTMAX_BACKWARD_WGSL,ls as SOFTMAX_FORWARD_WGSL,vn as SOFTMAX_WGSL,fs as SSD_BACKWARD_WGSL,pn as SSD_FORWARD_WGSL,ne as SeededRng,wr as SharedExpertMoE,vs as Tensor,Qe as VIDEO_BANK_INTER,Ne as VIDEO_BANK_INTRA,qe as VideoRVQCodec,Pa as WEIGHT_UPDATE_WGSL,Do as WSLA_MAX_DELTA,Ye as adamwUpdateInPlace,uo as adaptAndDiff,Ps as adaptPackage,ao as adaptationsAfterSkip,Ge as appendCrcTrailer,Mr as applyCheckpointDiff,ar as applyLimbicDelta,Ys as applyPortedWeights,Ar as applyRowDelta,oi as appraiseAmygdala,di as appraiseTask,Pe as archOf,Ms as backward,lt as basalGangliaExploreBias,si as basalGangliaSelect,fo as base64ToBytes,eo as benchArgmax,Fs as benchmarkAdaptationCost,We as benchmarkModel,Ss as benchmarkModelAsync,Bs as benchmarkText,ro as bitsPerToken,Po as buildBatches,Co as buildChunks,Ns as buildDeltaLearnPayload,ii as buildLimbicBlock,Gs as buildVideoSequence,ho as bytesToBase64,C as cdiv,Ve as clampDim,dt as clampLimbicDim,ti as clampState,In as clearTape,Sa as codestralMambaAdapter,Es as compareModels,no as compareReports,Wa as compileLimbicState,kr as computeRowDelta,da as configJson,Dr as corpusToSequences,Fo as cpuDimsFor,So as cpuModelBackward,Lo as cpuModelForward,Rs as cpuModelLoss,Mo as cpuWeightsFromNamed,pt as crc32,I as createBindGroup,O as createComputePipeline,B as createEmptyStorageBuffer,J as createStorageBuffer,W as createUniformBuffer,yr as crossEntropyGrad,ye as crossEntropyLoss,$s as decodeDeltaPayload,Is as deltaUnusableReason,De as dequantizeFp16,Ln as dequantizeInt8,_s as dequantizeInt8PerChannel,Ke as deserializeRowDelta,jn as diffCheckpoints,Q as dispatchColumnSlice,z as dispatchKernel,fi as dueSkills,ue as elementLabel,ht as emptySnapshot,xs as enableGrad,bs as estimateMemory,Rr as evermindTensorSpec,ba as executePortPlan,mi as experienceCorpus,rn as experienceDocuments,gi as experienceOverview,qs as exportEvermind,tr as exportGguf,Zt as exportOnnx,Yt as exportSafetensors,xa as falconMambaAdapter,Ue as floatToFp16,Fa as foreignMambaAdapterFor,Cs as formatAdaptationCostReport,mt as fp16ToFloat,Ls as fp16View,we as gaussianArray,Ks as generateImage,To as generateVideo,ca as generationConfigJson,ai as homeostasis,Vs as importEvermind,pa as importEvermindTensors,ma as inferArchFromTensors,ss as initWebGPU,Ja as isDue,ir as isIrreversibleLabel,Zr as limbicSetpoints,$e as linearBackward,Ae as linearForward,zt as logProbOfToken,Xr as mamba1Adapter,vo as mamba1CpuBackward,Wr as mamba1CpuForward,ka as mambaAdapter,Qs as mambaConfigFromTensors,Ws as meanEvalLoss,ni as meanLimbicSetpoints,zs as mergeCheckpointDiffs,ua as modelCardMarkdown,xt as namedTensors,Ao as namedWeights,Ya as needsApproval,ct as neutralLimbicState,Na as neutralState,qa as newExperienceId,ks as noGrad,Hr as normaliseSourceName,pi as packDocuments,Or as paramCount,Eo as paramMatrixShape,Ts as parseDeltaLearnPayload,lr as parseSnapshot,to as perplexity,ri as personalitySetpoint,Ca as portForeignMamba,Xs as portForeignMambaSafetensors,bo as quantizeBase,Be as quantizeFp16,Mn as quantizeInt8,gs as quantizeInt8PerChannel,un as randn,de as readBuffer,As as recordOperation,$a as recordToState,Js as resizePortedVocab,$r as rmsNormBackward,Nr as rmsNormForward,vr as roundFp16,Kr as safetensorsToTensors,bt as serializeRowDelta,Bt as setInitSeed,Tr as sigmoid,qt as silu,Vt as siluGrad,dr as slug,wo as softplus,Jr as stateToRecord,$o as tensorsToSafetensors,za as thalamusGate,ko as toNamedGrads,Fr as tokenWindows,la as tokenizerJson,Zn as topKIndices,Ds as trainAndBenchmark,hi as trainOnce,ge as uploadBuffer,ce as verifyCrcTrailer,xo as zeroCpuModelGrads,yo as zeroMamba1Grads};
