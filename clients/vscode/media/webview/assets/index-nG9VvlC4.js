import{p as y,b as sr,a as F,c as $,r as ir,U as or,d as v,m as nr,e as S,s as dr}from"./training.worker-BWIogs7k.js";const x={MAP_READ:1,COPY_SRC:4,COPY_DST:8,STORAGE:128},cr=1;class I extends Error{constructor(r){super(`WebGPU unavailable: ${r}`),this.name="WebGPUUnavailableError"}}function ur(){return globalThis.navigator?.gpu}async function gr(o={}){const r=o.gpu??ur();if(!r)throw new I("no navigator.gpu in this context");const e=await r.requestAdapter({powerPreference:o.powerPreference??"high-performance"});if(!e)throw new I("requestAdapter() returned null");const t=(o.preferF16??!0)&&e.features.has("shader-f16"),s=e.limits,a=await e.requestDevice({requiredFeatures:t?["shader-f16"]:[],requiredLimits:{maxStorageBuffersPerShaderStage:Math.min(8,s.maxStorageBuffersPerShaderStage),maxStorageBufferBindingSize:s.maxStorageBufferBindingSize,maxBufferSize:s.maxBufferSize}}),n=e.info;return{device:a,f16:t,adapterDescription:n?.description||n?.vendor||"unknown adapter",owners:{gpu:r,adapter:e}}}const lr=x.STORAGE|x.COPY_SRC|x.COPY_DST,pr=16,fr=256*1024*1024;class hr extends Error{constructor(r,e,t){super(`VRAM budget exceeded: ${r} B requested with ${e} B live (budget ${t} B)`),this.name="VramBudgetError"}}function br(o){let r=pr;for(;r<o;)r*=2;return r}class yr{constructor(r,e=Number.POSITIVE_INFINITY,t=fr){this.device=r,this.maxBytes=e,this.maxPooledBytes=t}device;maxBytes;maxPooledBytes;free=new Map;liveBytes=0;pooledBytes=0;peakLiveBytes=0;buffersCreated=0;acquire(r){const e=br(Math.max(r,4)),s=this.free.get(e)?.pop();if(s)return this.pooledBytes-=e,this.track(e),s;if(this.liveBytes+this.pooledBytes+e>this.maxBytes&&this.trim(),this.liveBytes+e>this.maxBytes)throw new hr(e,this.liveBytes,this.maxBytes);const a=this.device.createBuffer({size:e,usage:lr});return this.buffersCreated+=1,this.track(e),a}release(r){const e=r.size;this.liveBytes-=e,this.pooledBytes+=e;const t=this.free.get(e);t?t.push(r):this.free.set(e,[r]),this.pooledBytes>this.maxPooledBytes&&this.trimTo(this.maxPooledBytes)}trim(){this.trimTo(0)}trimTo(r){const e=[...this.free.keys()].sort((t,s)=>s-t);for(const t of e){const s=this.free.get(t);for(;s.length>0&&this.pooledBytes>r;)s.pop().destroy(),this.pooledBytes-=t;if(s.length===0&&this.free.delete(t),this.pooledBytes<=r)return}}stats(){return{liveBytes:this.liveBytes,pooledBytes:this.pooledBytes,peakLiveBytes:this.peakLiveBytes,buffersCreated:this.buffersCreated}}track(r){this.liveBytes+=r,this.peakLiveBytes=Math.max(this.peakLiveBytes,this.liveBytes)}}class wr extends Error{constructor(r,e){super(`WebGPU device lost (${r})${e?`: ${e}`:""}`),this.reason=r,this.name="DeviceLostError"}reason}class vr extends Error{constructor(r,e){super(`WebGPU ${r}: ${e}`),this.kind=r,this.name="GpuOperationError"}kind}class mr{pending=null;lost=null;destroying=!1;constructor(r){const e=s=>{const a=s.error;this.pending??=new vr(a?.constructor?.name??"error",a?.message??"unknown error")},t=r;typeof t.addEventListener=="function"?t.addEventListener("uncapturederror",e):t.onuncapturederror=e,r.lost.then(s=>{this.destroying||(this.lost=new wr(s.reason??"unknown",s.message??""))})}markDestroying(){this.destroying=!0}get isLost(){return this.lost!==null}assertHealthy(){if(this.lost)throw this.lost;const r=this.pending;if(r)throw this.pending=null,r}}const _r=256,w=8,p="let idx = gid.x + gid.y * 65535u * 256u;",l="@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>)",Q="fn pf(i: u32) -> f32 { return bitcast<f32>(p[i]); }",q=`
const GELU_C: f32 = 0.7978845608028654;
fn gelu_t(x: f32) -> f32 { return tanh(clamp(GELU_C * (x + 0.044715 * x * x * x), -15.0, 15.0)); }
fn gelu_f(x: f32) -> f32 { return 0.5 * x * (1.0 + gelu_t(x)); }
fn gelu_d(x: f32) -> f32 {
  let t = gelu_t(x);
  return 0.5 * (1.0 + t) + 0.5 * x * (1.0 - t * t) * GELU_C * (1.0 + 3.0 * 0.044715 * x * x);
}`,W=`
fn erf_f(x: f32) -> f32 {
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return select(y, -y, x < 0.0);
}
fn gelu_erf_f(x: f32) -> f32 { return 0.5 * x * (1.0 + erf_f(x * 0.7071067811865476)); }
fn gelu_erf_d(x: f32) -> f32 { return 0.5 * (1.0 + erf_f(x * 0.7071067811865476)) + x * exp(-0.5 * x * x) * 0.3989422804014327; }`,xr={cast_f32_to_i32:{bindings:3,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<i32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${l} {
  ${p}
  if (idx >= p[0]) { return; }
  out[idx] = i32(a[idx]);
}`},cast_i32_to_f32:{bindings:3,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> a: array<i32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${l} {
  ${p}
  if (idx >= p[0]) { return; }
  out[idx] = f32(a[idx]);
}`},cast_f32_to_f16:{bindings:3,dispatch:"grid",requires:"shader-f16",wgsl:`
enable f16;
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2<f16>>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${l} {
  ${p}
  let n = p[0];
  if (idx * 2u >= n) { return; }
  let hi = select(0.0, a[idx * 2u + 1u], idx * 2u + 1u < n);
  out[idx] = vec2<f16>(f16(a[idx * 2u]), f16(hi));
}`},cast_f16_to_f32:{bindings:3,dispatch:"grid",requires:"shader-f16",wgsl:`
enable f16;
@group(0) @binding(0) var<storage, read> a: array<vec2<f16>>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${l} {
  ${p}
  if (idx >= p[0]) { return; }
  let pair = a[idx / 2u];
  out[idx] = f32(select(pair.x, pair.y, idx % 2u == 1u));
}`}};function _(o,r=""){return{bindings:3,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${Q}
${r}
${l} {
  ${p}
  if (idx >= p[0]) { return; }
  let x = a[idx];
  out[idx] = ${o};
}`}}const P=2,z=P+w,R=z+w,kr=R+w,B={shape:P,aStrides:z,bStrides:R};function m(o,r=""){return{bindings:4,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${r}
${l} {
  ${p}
  if (idx >= p[0]) { return; }
  var rem = idx;
  var ai = 0u;
  var bi = 0u;
  for (var d = i32(p[1]) - 1; d >= 0; d = d - 1) {
    let k = u32(d);
    let dim = p[${P}u + k];
    let c = rem % dim;
    rem = rem / dim;
    ai = ai + c * p[${z}u + k];
    bi = bi + c * p[${R}u + k];
  }
  let x = a[ai];
  let y = b[bi];
  out[idx] = ${o};
}`}}const Sr={bindings:3,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read_write> dst: array<f32>;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${l} {
  ${p}
  if (idx >= p[0]) { return; }
  dst[idx] = dst[idx] + src[idx];
}`},Er={bindings:3,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read_write> dst: array<u32>;
@group(0) @binding(1) var<storage, read> src: array<u32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${l} {
  ${p}
  if (idx >= p[0]) { return; }
  dst[idx] = src[idx];
}`},$r={add_inplace:Sr,copy_inplace:Er,relu:_("max(x, 0.0)"),gelu:_("gelu_f(x)",q),gelu_erf:_("gelu_erf_f(x)",W),exp:_("exp(x)"),log:_("log(x)"),affine:_("x * pf(1u) + pf(2u)"),add:m("x + y"),sub:m("x - y"),mul:m("x * y"),div:m("x / y"),relu_backward:m("select(0.0, y, x > 0.0)"),gelu_backward:m("y * gelu_d(x)",q),gelu_erf_backward:m("y * gelu_erf_d(x)",W)},Br={embedding:{bindings:4,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> weight: array<f32>;
@group(0) @binding(1) var<storage, read> ids: array<i32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${l} {
  ${p}
  let dim = p[1];
  if (idx >= p[0]) { return; }
  let id = ids[idx / dim];
  if (id < 0 || u32(id) >= p[2]) { out[idx] = 0.0; return; }
  out[idx] = weight[u32(id) * dim + idx % dim];
}`},embedding_backward_csr:{bindings:5,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> rowStart: array<u32>;
@group(0) @binding(1) var<storage, read> positions: array<u32>;
@group(0) @binding(2) var<storage, read> gy: array<f32>;
@group(0) @binding(3) var<storage, read_write> out: array<f32>;
@group(0) @binding(4) var<storage, read> p: array<u32>;
${l} {
  ${p}
  let dim = p[1];
  if (idx >= p[0] * dim) { return; }
  let row = idx / dim;
  let d = idx % dim;
  var acc = 0.0;
  for (var k = rowStart[row]; k < rowStart[row + 1u]; k = k + 1u) {
    acc = acc + gy[positions[k] * dim + d];
  }
  out[idx] = acc;
}`},embedding_backward_atomic:{bindings:4,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> ids: array<i32>;
@group(0) @binding(1) var<storage, read> gy: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${l} {
  ${p}
  let dim = p[1];
  if (idx >= p[0] * dim) { return; }
  let id = ids[idx / dim];
  if (id < 0 || u32(id) >= p[2]) { return; }
  let slot = u32(id) * dim + idx % dim;
  let add = gy[idx];
  var old = atomicLoad(&out[slot]);
  loop {
    let swapped = atomicCompareExchangeWeak(&out[slot], old, bitcast<u32>(bitcast<f32>(old) + add));
    if (swapped.exchanged) { break; }
    old = swapped.old_value;
  }
}`}},Ar={layer_norm:{bindings:7,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> gamma: array<f32>;
@group(0) @binding(2) var<storage, read> beta: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<storage, read_write> mean: array<f32>;
@group(0) @binding(5) var<storage, read_write> rstd: array<f32>;
@group(0) @binding(6) var<storage, read> p: array<u32>;
${Q}
${l} {
  ${p}
  let rows = p[0]; let cols = p[1];
  if (idx >= rows) { return; }
  let base = idx * cols;
  var mu = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { mu = mu + x[base + c]; }
  mu = mu / f32(cols);
  var vr = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { let d = x[base + c] - mu; vr = vr + d * d; }
  vr = vr / f32(cols);
  let inv = 1.0 / sqrt(vr + pf(2u));
  mean[idx] = mu;
  rstd[idx] = inv;
  for (var c = 0u; c < cols; c = c + 1u) {
    var v = (x[base + c] - mu) * inv;
    if (p[3] != 0u) { v = v * gamma[c]; }
    if (p[4] != 0u) { v = v + beta[c]; }
    y[base + c] = v;
  }
}`},layer_norm_backward:{bindings:7,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> gamma: array<f32>;
@group(0) @binding(2) var<storage, read> mean: array<f32>;
@group(0) @binding(3) var<storage, read> rstd: array<f32>;
@group(0) @binding(4) var<storage, read> gy: array<f32>;
@group(0) @binding(5) var<storage, read_write> gx: array<f32>;
@group(0) @binding(6) var<storage, read> p: array<u32>;
fn gh(i: u32, c: u32) -> f32 { return gy[i] * select(1.0, gamma[c], p[2] != 0u); }
${l} {
  ${p}
  let rows = p[0]; let cols = p[1];
  if (idx >= rows) { return; }
  let base = idx * cols;
  let mu = mean[idx];
  let r = rstd[idx];
  var sg = 0.0;
  var sgx = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) {
    let g = gh(base + c, c);
    sg = sg + g;
    sgx = sgx + g * (x[base + c] - mu) * r;
  }
  let n = f32(cols);
  for (var c = 0u; c < cols; c = c + 1u) {
    let xh = (x[base + c] - mu) * r;
    gx[base + c] = (r / n) * (n * gh(base + c, c) - sg - xh * sgx);
  }
}`},layer_norm_affine_backward:{bindings:7,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> mean: array<f32>;
@group(0) @binding(2) var<storage, read> rstd: array<f32>;
@group(0) @binding(3) var<storage, read> gy: array<f32>;
@group(0) @binding(4) var<storage, read_write> ggamma: array<f32>;
@group(0) @binding(5) var<storage, read_write> gbeta: array<f32>;
@group(0) @binding(6) var<storage, read> p: array<u32>;
${l} {
  ${p}
  let rows = p[0]; let cols = p[1];
  if (idx >= cols) { return; }
  var sg = 0.0;
  var sb = 0.0;
  for (var r = 0u; r < rows; r = r + 1u) {
    let g = gy[r * cols + idx];
    sg = sg + g * (x[r * cols + idx] - mean[r]) * rstd[r];
    sb = sb + g;
  }
  ggamma[idx] = sg;
  gbeta[idx] = sb;
}`}},L=3,M=L+w,Pr=M+w,Y={shape:L,strides:M},O=4,D=O+w,G=D+w,N=G+w,zr=N+w,E={keptShape:O,keptStrides:D,redShape:G,redStrides:N},Rr={strided_copy:{bindings:3,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> a: array<u32>;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${l} {
  ${p}
  if (idx >= p[0]) { return; }
  var rem = idx;
  var src = p[2];
  for (var d = i32(p[1]) - 1; d >= 0; d = d - 1) {
    let k = u32(d);
    let dim = p[${L}u + k];
    src = src + (rem % dim) * p[${M}u + k];
    rem = rem / dim;
  }
  out[idx] = a[src];
}`},sum:{bindings:3,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${l} {
  ${p}
  if (idx >= p[0]) { return; }
  var rem = idx;
  var base = 0u;
  for (var d = i32(p[1]) - 1; d >= 0; d = d - 1) {
    let k = u32(d);
    let dim = p[${O}u + k];
    base = base + (rem % dim) * p[${D}u + k];
    rem = rem / dim;
  }
  var acc = 0.0;
  for (var r = 0u; r < p[3]; r = r + 1u) {
    var rr = r;
    var off = base;
    for (var d = i32(p[2]) - 1; d >= 0; d = d - 1) {
      let k = u32(d);
      let dim = p[${G}u + k];
      off = off + (rr % dim) * p[${N}u + k];
      rr = rr / dim;
    }
    acc = acc + a[off];
  }
  out[idx] = acc;
}`}},Lr=`
@group(0) @binding(0) var<storage,read> base: array<f32>;
@group(0) @binding(1) var<storage,read> a: array<f32>;
@group(0) @binding(2) var<storage,read> b: array<f32>;
@group(0) @binding(3) var<storage,read_write> merged: array<f32>;
@group(0) @binding(4) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let rows=u32(p[0]); let cols=u32(p[1]); let rank=u32(p[2]); let idx=gid.x+gid.y*65535u*256u;
  if(idx>=rows*cols){return;} let row=idx/cols; let col=idx%cols; var delta=0.0;
  for(var k=0u;k<rank;k=k+1u){delta=delta+b[row*rank+k]*a[k*cols+col];}
  merged[idx]=base[idx]+p[3]*delta;
}`,Mr=`
@group(0) @binding(0) var<storage,read> gw: array<f32>;
@group(0) @binding(1) var<storage,read> a: array<f32>;
@group(0) @binding(2) var<storage,read> b: array<f32>;
@group(0) @binding(3) var<storage,read_write> ga: array<f32>;
@group(0) @binding(4) var<storage,read_write> gb: array<f32>;
@group(0) @binding(5) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let rows=u32(p[0]); let cols=u32(p[1]); let rank=u32(p[2]); let idx=gid.x+gid.y*65535u*256u; let scale=p[3];
  if(idx<rank*cols){let k=idx/cols;let col=idx%cols;var sum=0.0;for(var row=0u;row<rows;row=row+1u){sum=sum+b[row*rank+k]*gw[row*cols+col];}ga[idx]=ga[idx]+scale*sum;}
  if(idx<rows*rank){let row=idx/rank;let k=idx%rank;var sum=0.0;for(var col=0u;col<cols;col=col+1u){sum=sum+gw[row*cols+col]*a[k*cols+col];}gb[idx]=gb[idx]+scale*sum;}
}`,Or={lora_forward:{wgsl:Lr,bindings:5,dispatch:"grid"},lora_backward:{wgsl:Mr,bindings:6,dispatch:"grid"}},Dr={matmul:{bindings:4,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${l} {
  ${p}
  let M = p[0]; let N = p[1]; let K = p[2];
  if (idx >= p[3] * M * N) { return; }
  let n = idx % N;
  let m = (idx / N) % M;
  let bt = idx / (M * N);
  let aBase = bt * p[4] + m * p[6];
  let bBase = bt * p[5] + n * p[9];
  var acc = 0.0;
  for (var k = 0u; k < K; k = k + 1u) {
    acc = acc + a[aBase + k * p[7]] * b[bBase + k * p[8]];
  }
  out[idx] = acc;
}`}},Gr=`
@group(0) @binding(0) var<storage,read_write> w: array<f32>;
@group(0) @binding(1) var<storage,read_write> g: array<f32>;
@group(0) @binding(2) var<storage,read_write> m: array<f32>;
@group(0) @binding(3) var<storage,read_write> v: array<f32>;
@group(0) @binding(4) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i=gid.x+gid.y*65535u*256u;if(i>=arrayLength(&w)){return;}let grad=g[i]*p[9];let b1=p[5];let b2=p[6];
  m[i]=b1*m[i]+(1.0-b1)*grad;v[i]=b2*v[i]+(1.0-b2)*grad*grad;
  let mh=m[i]/(1.0-pow(b1,p[10]));let vh=v[i]/(1.0-pow(b2,p[10]));
  w[i]=w[i]-p[4]*(mh/(sqrt(vh)+p[7])+p[8]*w[i]);if(p[11]==0.0){g[i]=0.0;}
}`,Nr=`
@group(0) @binding(0) var<storage,read_write> w: array<f32>;
@group(0) @binding(1) var<storage,read> g: array<f32>;
@group(0) @binding(2) var<storage,read_write> buf: array<f32>;
@group(0) @binding(3) var<storage,read> p: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i=gid.x+gid.y*65535u*256u;if(i>=arrayLength(&w)){return;}
  var d=g[i]+p[2]*w[i];
  if(p[3]!=0.0){buf[i]=p[1]*buf[i]+d;d=buf[i];}
  w[i]=w[i]-p[0]*d;
}`,K=16,Tr={adamw:{wgsl:Gr,bindings:5,dispatch:"grid"},sgd:{wgsl:Nr,bindings:4,dispatch:"grid"}},H="fn target_of(row: u32, cols: u32) -> u32 { return u32(clamp(targets[row], 0, i32(cols) - 1)); }",T=`
  ${p}
  let rows = p[0];
  let cols = p[1];
  if (idx >= rows) { return; }
  let base = idx * cols;`,rr=`
  var m = -3.4e38;
  for (var c = 0u; c < cols; c = c + 1u) { m = max(m, a[base + c]); }
  var s = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { s = s + exp(a[base + c] - m); }`,X=o=>({bindings:3,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${l} {${T}${rr}
  for (var c = 0u; c < cols; c = c + 1u) { ${o} }
}`}),V=(o,r)=>({bindings:4,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> y: array<f32>;
@group(0) @binding(1) var<storage, read> g: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
@group(0) @binding(3) var<storage, read> p: array<u32>;
${l} {${T}
  var s = 0.0;
  for (var c = 0u; c < cols; c = c + 1u) { s = s + ${o}; }
  for (var c = 0u; c < cols; c = c + 1u) { out[base + c] = ${r}; }
}`}),Cr={softmax:X("out[base + c] = exp(a[base + c] - m) / s;"),log_softmax:X("out[base + c] = a[base + c] - (m + log(s));"),softmax_backward:V("g[base + c] * y[base + c]","y[base + c] * (g[base + c] - s)"),log_softmax_backward:V("g[base + c]","g[base + c] - exp(y[base + c]) * s"),cross_entropy:{bindings:6,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> targets: array<i32>;
@group(0) @binding(2) var<storage, read_write> loss: array<f32>;
@group(0) @binding(3) var<storage, read_write> probs: array<f32>;
@group(0) @binding(4) var<storage, read_write> valid: array<f32>;
@group(0) @binding(5) var<storage, read> p: array<u32>;
${H}
${l} {${T}${rr}
  for (var c = 0u; c < cols; c = c + 1u) { probs[base + c] = exp(a[base + c] - m) / s; }
  if (targets[idx] == bitcast<i32>(p[2])) { loss[idx] = 0.0; valid[idx] = 0.0; return; }
  loss[idx] = m + log(s) - a[base + target_of(idx, cols)];
  valid[idx] = 1.0;
}`},cross_entropy_backward:{bindings:5,dispatch:"grid",wgsl:`
@group(0) @binding(0) var<storage, read> probs: array<f32>;
@group(0) @binding(1) var<storage, read> targets: array<i32>;
@group(0) @binding(2) var<storage, read> gloss: array<f32>;
@group(0) @binding(3) var<storage, read_write> out: array<f32>;
@group(0) @binding(4) var<storage, read> p: array<u32>;
${H}
${l} {
  ${p}
  let cols = p[1];
  if (idx >= p[0] * cols) { return; }
  let row = idx / cols;
  let c = idx % cols;
  if (targets[row] == bitcast<i32>(p[2])) { out[idx] = 0.0; return; }
  let onehot = select(0.0, 1.0, c == target_of(row, cols));
  out[idx] = (probs[idx] - onehot) * gloss[row];
}`}},J={...$r,...Rr,...Dr,...Cr,...Ar,...Br,...Or,...Tr,...xr},Z=65535;class Ur{constructor(r,e,t,s){this.device=r,this.pool=e,this.features=t,this.health=s}device;pool;features;health;pipelines=new Map;run(r,e,t,s){this.health.assertHealthy();const a=J[r];if(e.length+1!==a.bindings)throw new Error(`${r}: kernel binds ${a.bindings} buffers, got ${e.length+1}`);if(s===0)return;const n=Math.max(4,t.byteLength),d=this.pool.acquire(n);this.device.queue.writeBuffer(d,0,t.buffer,t.byteOffset,t.byteLength);const c=[...e,{buffer:d,bytes:n}],u=this.pipeline(r),g=this.device.createBindGroup({layout:u.getBindGroupLayout(0),entries:c.map((U,ar)=>({binding:ar,resource:{buffer:U.buffer,offset:0,size:U.bytes}}))}),h=this.device.createCommandEncoder(),b=h.beginComputePass();b.setPipeline(u),b.setBindGroup(0,g);const k=Math.ceil(s/_r);b.dispatchWorkgroups(Math.min(k,Z),Math.ceil(k/Z),1),b.end(),this.device.queue.submit([h.finish()]),this.pool.release(d)}write(r,e){this.health.assertHealthy(),this.device.queue.writeBuffer(r,0,e.buffer,e.byteOffset,e.byteLength)}async read(r,e){this.health.assertHealthy();const t=Math.ceil(e/4)*4,s=this.device.createBuffer({size:t,usage:x.MAP_READ|x.COPY_DST}),a=this.device.createCommandEncoder();a.copyBufferToBuffer(r,0,s,0,t),this.device.queue.submit([a.finish()]);try{try{await s.mapAsync(cr)}catch(n){throw this.health.assertHealthy(),n}return this.health.assertHealthy(),s.getMappedRange().slice(0,e)}finally{s.unmap(),s.destroy()}}pipeline(r){const e=this.pipelines.get(r);if(e)return e;const t=J[r];if("requires"in t&&t.requires&&!this.features.has(t.requires))throw new Error(`${r}: needs the "${t.requires}" device feature, which this device lacks`);const s=this.device.createShaderModule({code:t.wgsl}),a=this.device.createComputePipeline({layout:"auto",compute:{module:s,entryPoint:"main"}});return this.pipelines.set(r,a),a}}function Fr(o,r){const e=new Int32Array(r+1);for(const a of o)a>=0&&a<r&&(e[a+1]+=1);for(let a=0;a<r;a++)e[a+1]+=e[a];const t=new Int32Array(e[r]),s=e.slice(0,r);return o.forEach((a,n)=>{a>=0&&a<r&&(t[s[a]++]=n)}),{rowStart:e,positions:t}}class j{constructor(r,e,t){this.storage=r,this.shape=e,this.dtype=t}storage;shape;dtype;released=!1;get size(){return y(this.shape)}get bytes(){return Math.max(4,er(this.shape,this.dtype))}get buffer(){if(this.released)throw new Error("GpuTensor: used after release");return this.storage.buffer}}function er(o,r){const e=y(o);return r==="float16"?Math.ceil(e/2)*4:e*4}const tr=new Float32Array(1),Ir=new Uint32Array(tr.buffer);function A(o){return tr[0]=o,Ir[0]}function C(o,r){if(o>w)throw new or(r,`rank ${o} exceeds the WebGPU kernel limit of ${w}`)}function qr(o,r,e){const t=sr(o,r);C(t.length,e);const s=F(o,t,$(o)),a=F(r,t,$(r)),n=new Uint32Array(kr);return n[0]=y(t),n[1]=t.length,n.set(t,B.shape),n.set(s,B.aStrides),n.set(a,B.bStrides),{params:n,outShape:t}}function Wr(o,r,e){C(o.length,"strided_copy");const t=new Uint32Array(Pr);return t[0]=y(o),t[1]=o.length,t[2]=e,t.set(o,Y.shape),t.set(r,Y.strides),t}function Yr(o,r,e){C(o.length,"sum");const t=ir(o,r,e),s=$(o),a=[],n=[],d=[],c=[];for(let g=0;g<o.length;g++)t.axes.includes(g)?(d.push(o[g]),c.push(s[g])):(a.push(o[g]),n.push(s[g]));const u=new Uint32Array(zr);return u[0]=y(a),u[1]=a.length,u[2]=d.length,u[3]=y(d),u.set(a,E.keptShape),u.set(n,E.keptStrides),u.set(d,E.redShape),u.set(c,E.redStrides),{params:u,outShape:t.outShape}}const f=(...o)=>Uint32Array.from(o),i=o=>({buffer:o.buffer,bytes:o.bytes});class Kr{constructor(r,e={}){this.engine=r,this.device=r.device,this.supportsF16=r.f16,this.adapterDescription=r.adapterDescription,this.ownsDevice=e.ownsDevice??!1,this.health=new mr(r.device),this.pool=new yr(r.device,e.maxBytes,e.maxPooledBytes),this.dispatcher=new Ur(r.device,this.pool,new Set(r.device.features),this.health),this.dummy=this.alloc([1],"float32")}engine;name="webgpu";supportsF16;device;adapterDescription;health;pool;dispatcher;ownsDevice;dummy;stats(){return this.pool.stats()}destroy(){this.pool.trim(),this.ownsDevice&&(this.health.markDestroying(),this.device.destroy())}alloc(r,e="float32"){return new j({buffer:this.pool.acquire(Math.max(4,er(r,e))),refs:1},[...r],e)}upload(r,e,t){if(r.length!==y(e))throw new Error(`upload: ${r.length} values for shape ${JSON.stringify(e)}`);const s=this.alloc(e,t);return r.length>0&&this.dispatcher.write(s.buffer,r),s}async download(r){if(r.dtype==="float16")throw new Error("download: packed fp16 storage — convert with fromF16 first");const e=await this.dispatcher.read(r.buffer,r.size*4);return r.dtype==="int32"?new Int32Array(e):new Float32Array(e)}release(r){r.released||(r.released=!0,r.storage.refs-=1,r.storage.refs===0&&this.pool.release(r.storage.buffer))}full(r,e){return this.upload(new Float32Array(y(r)).fill(e),r,"float32")}reshape(r,e){if(y(e)!==r.size)throw new Error(`reshape: ${JSON.stringify(e)} does not hold ${r.size} elements`);return r.storage.refs+=1,new j(r.storage,[...e],r.dtype)}stridedCopy(r,e,t,s){const a=this.alloc(e,r.dtype);return this.dispatcher.run("strided_copy",[i(r),i(a)],Wr(e,t,s),a.size),a}unary(r,e){const t=this.alloc(e.shape);return this.dispatcher.run(r,[i(e),i(t)],f(e.size,0,0),e.size),t}affine(r,e,t){const s=this.alloc(r.shape);return this.dispatcher.run("affine",[i(r),i(s)],f(r.size,A(e),A(t)),r.size),s}binary(r,e,t){const{params:s,outShape:a}=qr(e.shape,t.shape,r),n=this.alloc(a);return this.dispatcher.run(r,[i(e),i(t),i(n)],s,n.size),n}addInPlace(r,e){if(r.size!==e.size)throw new Error(`add_inplace: ${e.size} values into ${r.size}`);this.dispatcher.run("add_inplace",[i(r),i(e)],f(r.size),r.size),v(r.storage)}copyInPlace(r,e){if(r.dtype!==e.dtype)throw new Error(`copy_inplace: ${e.dtype} into ${r.dtype}`);if(r.size!==e.size)throw new Error(`copy_inplace: ${e.size} values into ${r.size}`);v(r.storage),!(r.storage===e.storage||r.size===0)&&this.dispatcher.run("copy_inplace",[i(r),i(e)],f(r.size),r.size)}storageOf(r){return r.storage}cast(r,e){if(r.dtype==="float16")throw new Error("cast: packed fp16 storage — convert with fromF16 first");if(r.dtype===e)return this.stridedCopy(r,r.shape,$(r.shape),0);const t=this.alloc(r.shape,e);return r.size>0&&this.dispatcher.run(e==="int32"?"cast_f32_to_i32":"cast_i32_to_f32",[i(r),i(t)],f(r.size),r.size),t}matmul(r,e,t,s){const a=nr(r.shape,e.shape,t,s),n=this.alloc(a.outShape),d=r.shape[r.shape.length-2],c=r.shape[r.shape.length-1],u=e.shape[e.shape.length-2],g=e.shape[e.shape.length-1],h=y(a.batch),b=f(a.M,a.N,a.K,h,a.aBatched?d*c:0,a.bBatched?u*g:0,t?1:c,t?c:1,s?1:g,s?g:1);return this.dispatcher.run("matmul",[i(r),i(e),i(n)],b,n.size),n}sum(r,e,t){const{params:s,outShape:a}=Yr(r.shape,e,t),n=this.alloc(a);return this.dispatcher.run("sum",[i(r),i(n)],s,n.size),n}rowOp(r,e){const{rows:t,cols:s}=S(e.shape,r),a=this.alloc(e.shape);return this.dispatcher.run(r,[i(e),i(a)],f(t,s),t),a}rowBackward(r,e,t){dr(e.shape,t.shape,r);const{rows:s,cols:a}=S(e.shape,r),n=this.alloc(e.shape);return this.dispatcher.run(r,[i(e),i(t),i(n)],f(s,a),s),n}softmax(r){return this.rowOp("softmax",r)}softmaxBackward(r,e){return this.rowBackward("softmax_backward",r,e)}logSoftmax(r){return this.rowOp("log_softmax",r)}logSoftmaxBackward(r,e){return this.rowBackward("log_softmax_backward",r,e)}layerNorm(r,e,t,s){const{rows:a,cols:n}=S(r.shape,"layer_norm"),d=r.shape.slice(0,-1),c=this.alloc(r.shape),u=this.alloc(d),g=this.alloc(d),h=f(a,n,A(s),e?1:0,t?1:0),b=e??this.dummy,k=t??this.dummy;return this.dispatcher.run("layer_norm",[i(r),i(b),i(k),i(c),i(u),i(g)],h,a),{y:c,mean:u,rstd:g}}layerNormBackward(r,e,t,s,a,n){const{rows:d,cols:c}=S(r.shape,"layer_norm_backward"),u=this.alloc(r.shape),g=e??this.dummy;if(this.dispatcher.run("layer_norm_backward",[i(r),i(g),i(t),i(s),i(a),i(u)],f(d,c,e?1:0),d),!n)return{gx:u,gGamma:null,gBeta:null};const h=this.alloc([c]),b=this.alloc([c]);return this.dispatcher.run("layer_norm_affine_backward",[i(r),i(t),i(s),i(a),i(h),i(b)],f(d,c),c),{gx:u,gGamma:h,gBeta:b}}embedding(r,e){const[t,s]=[r.shape[0],r.shape[1]],a=this.alloc([...e.shape,s]);return this.dispatcher.run("embedding",[i(r),i(e),i(a)],f(a.size,s,t),a.size),a}embeddingBackward(r,e,t,s){const a=e.shape[e.shape.length-1];if(!s){const h=this.full([t,a],0);return this.dispatcher.run("embedding_backward_atomic",[i(r),i(e),i(h)],f(r.size,a,t),r.size*a),h}const{rowStart:n,positions:d}=Fr(s,t),c=this.upload(n,[n.length],"int32"),u=this.upload(d,[d.length],"int32"),g=this.alloc([t,a]);return this.dispatcher.run("embedding_backward_csr",[i(c),i(u),i(e),i(g)],f(t,a),g.size),this.release(c),this.release(u),g}crossEntropy(r,e,t){if(r.shape.length!==2)throw new Error("cross_entropy: logits must be [N, C]");const[s,a]=[r.shape[0],r.shape[1]];if(e.size!==s)throw new Error(`cross_entropy: ${e.size} targets for ${s} rows`);const n=this.alloc([s]),d=this.alloc([s,a]),c=this.alloc([s]);return this.dispatcher.run("cross_entropy",[i(r),i(e),i(n),i(d),i(c)],f(s,a,t>>>0),s),{loss:n,probs:d,valid:c}}crossEntropyBackward(r,e,t,s){const[a,n]=[r.shape[0],r.shape[1]],d=this.alloc([a,n]);return this.dispatcher.run("cross_entropy_backward",[i(r),i(e),i(t),i(d)],f(a,n,s>>>0),a*n),d}loraParams(r,e,t,s){const a=new Float32Array(K);return a.set([r,e,t,s]),a}loraMerge(r,e,t,s){const[a,n]=[r.shape[0],r.shape[1]],d=e.shape[0],c=this.alloc([a,n]);return this.dispatcher.run("lora_forward",[i(r),i(e),i(t),i(c)],this.loraParams(a,n,d,s),a*n),c}loraBackward(r,e,t,s,a,n){const[d,c]=[r.shape[0],r.shape[1]],u=e.shape[0];this.dispatcher.run("lora_backward",[i(r),i(e),i(t),i(a),i(n)],this.loraParams(d,c,u,s),Math.max(e.size,t.size)),v(a.storage),v(n.storage)}adamwStep(r,e,t,s,a){const n=new Float32Array(K);n.set([a.lr,a.beta1,a.beta2,a.eps,a.weightDecay,a.gradScale,a.step,a.keepGrad?1:0],4),this.dispatcher.run("adamw",[i(r),i(e),i(t),i(s)],n,r.size);for(const d of a.keepGrad?[r,t,s]:[r,e,t,s])v(d.storage)}sgdStep(r,e,t,s){const a=Float32Array.from([s.lr,s.momentum,s.weightDecay,t?1:0]);this.dispatcher.run("sgd",[i(r),i(e),i(t??this.dummy)],a,r.size),v(r.storage),t&&v(t.storage)}toF16(r){if(r.dtype!=="float32")throw new Error(`toF16: expected float32, got ${r.dtype}`);const e=this.alloc(r.shape,"float16");return this.dispatcher.run("cast_f32_to_f16",[i(r),i(e)],f(r.size),Math.ceil(r.size/2)),e}fromF16(r,e=r.shape){if(r.dtype!=="float16")throw new Error(`fromF16: expected a float16 handle, got ${r.dtype}`);if(y(e)!==r.size)throw new Error(`fromF16: shape ${JSON.stringify(e)} does not hold the ${r.size} packed values`);const t=this.alloc(e);return this.dispatcher.run("cast_f16_to_f32",[i(r),i(t)],f(t.size),t.size),t}}async function Xr(o={}){return new Kr(await gr(o),{maxBytes:o.maxBytes,maxPooledBytes:o.maxPooledBytes,ownsDevice:!0})}export{yr as BufferPool,fr as DEFAULT_MAX_POOLED_BYTES,wr as DeviceLostError,vr as GpuOperationError,j as GpuTensor,hr as VramBudgetError,Kr as WebGPUBackend,I as WebGPUUnavailableError,Xr as createWebGPUBackend,gr as requestEngineDevice};
