import{H as U}from"./index.js";const v={dim:64,order:4,channels:16,maxHistory:50},M=`
struct MambaParams {
  dim: u32,
  order: u32,
  channels: u32,
  dt: f32,
}

@group(0) @binding(0) var<uniform> params: MambaParams;
@group(0) @binding(1) var<storage, read>       state_in  : array<f32>;
@group(0) @binding(2) var<storage, read>       input_vec : array<f32>;
@group(0) @binding(3) var<storage, read_write> state_out : array<f32>;
@group(0) @binding(4) var<storage, read_write> output_vec: array<f32>;

// Learnable SSM parameters (diagonal A, projection B/C) — initialised to stable values
fn ssm_a(ch: u32, k: u32) -> f32 {
  // Diagonal A: stable eigenvalues < 1
  let base = 0.9 - f32(ch) * 0.01 - f32(k) * 0.001;
  return clamp(base, 0.5, 0.99);
}

fn ssm_b(ch: u32, d: u32) -> f32 {
  // B projection (simple learnable-like init)
  let idx = ch * params.dim + d;
  return select(0.1, -0.1, (idx & 1u) == 0u);
}

fn ssm_c(ch: u32, d: u32) -> f32 {
  return select(0.08, -0.08, (d & 1u) == 0u);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let ch = gid.x; // channel index
  if (ch >= params.channels) { return; }

  // For each order dimension k, update hidden state
  var y: f32 = 0.0;
  for (var k: u32 = 0u; k < params.order; k++) {
    let h_idx = ch * params.order + k;
    var h = state_in[h_idx];

    // Compute weighted input: x = B * input
    var x: f32 = 0.0;
    for (var d: u32 = 0u; d < params.dim; d++) {
      x += ssm_b(ch, d) * input_vec[d % arrayLength(&input_vec)];
    }

    // SSM recurrence with discretised A
    let a = ssm_a(ch, k);
    let a_disc = exp(a * params.dt);
    let b_disc = (a_disc - 1.0) / a;
    h = a_disc * h + b_disc * x;
    state_out[h_idx] = h;

    // Accumulate output: y += C * h
    y += ssm_c(ch, k) * h;
  }
  output_vec[ch] = y;
}
`;async function x(o){if(!U())return null;try{const a=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!a)return null;const t=await a.requestDevice(),r=t.createShaderModule({code:M}),s=await t.createComputePipelineAsync({layout:"auto",compute:{module:r,entryPoint:"main"}}),n=o.channels*o.order*4,i=o.dim*4,u=o.channels*4,d=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),h=t.createBuffer({size:n,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),c=t.createBuffer({size:i,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),f=t.createBuffer({size:n,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),p=t.createBuffer({size:u,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),g=t.createBuffer({size:Math.max(n,u),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});return{device:t,pipeline:s,paramsBuffer:d,stateBuffer:h,inputBuffer:c,stateOutBuffer:f,outputBuffer:p,readbackBuffer:g,config:o}}catch{return null}}function G(o,e,a,t=.01){const{channels:r,order:s,dim:n}=a,i=new Float32Array(r*s),u=new Float32Array(r);for(let d=0;d<r;d++){let h=0;for(let c=0;c<s;c++){const f=d*s+c;let p=o[f]??0,g=0;for(let l=0;l<n;l++){const _=(d*n+l&1)===0?.1:-.1;g+=_*(e[l%e.length]??0)}const y=.9-d*.01-c*.001,m=Math.max(.5,Math.min(.99,y)),w=Math.exp(m*t),b=(w-1)/m;p=w*p+b*g,i[f]=p;const B=(c&1)===0?.08:-.08;h+=B*p}u[d]=h}return{stateOut:i,outputVec:u}}function k(o,e){const a=new Float32Array(e);let t=0;for(let s=0;s<o.length;s++){const n=o.charCodeAt(s),i=s%e,u=(i+1)%e,d=Math.sin(n*.01+s*.1),h=Math.cos(n*.007+s*.07);t-=a[i]*a[i],t-=a[u]*a[u],a[i]+=d,a[u]+=h,t+=a[i]*a[i],t+=a[u]*a[u]}const r=Math.sqrt(t)+1e-8;for(let s=0;s<e;s++)a[s]/=r;return a}const D="builderforce_mamba",S="agent_states",O=1;function P(){return new Promise((o,e)=>{if(typeof indexedDB>"u"){e(new Error("IndexedDB not available"));return}const a=indexedDB.open(D,O);a.onupgradeneeded=()=>{a.result.createObjectStore(S,{keyPath:"agentId"})},a.onsuccess=()=>o(a.result),a.onerror=()=>e(a.error)})}async function C(o){const e=await P();await new Promise((a,t)=>{const r=e.transaction(S,"readwrite");r.objectStore(S).put(o),r.oncomplete=()=>a(),r.onerror=()=>t(r.error)})}async function F(o){const e=await P();return new Promise((a,t)=>{const s=e.transaction(S,"readonly").objectStore(S).get(o);s.onsuccess=()=>a(s.result??null),s.onerror=()=>t(s.error)})}class R{constructor(e,a,t){this.gpuBackend=null,this.gpuReady=!1,this.config={...v,...t},this.state=this.makeInitialState(e,a)}async init(){this.gpuReady||(this.gpuBackend=await x(this.config),this.gpuReady=!0,this.gpuBackend&&await this.uploadStateToGPU(new Float32Array(this.config.channels*this.config.order)))}async loadFromIndexedDB(){try{const e=await F(this.state.agentId);return e?(this.state=e,this.gpuBackend&&await this.uploadStateToGPU(new Float32Array(e.snapshot.data)),!0):!1}catch{return!1}}loadFromSnapshot(e){this.state.snapshot={...e},this.gpuBackend&&this.uploadStateToGPU(new Float32Array(e.data))}async step(e){const a=k(e,this.config.dim),t=new Float32Array(this.state.snapshot.data);let r,s;if(this.gpuBackend){const n=await this.runGPUScan(t,a);r=n.stateOut,s=n.outputVec}else{const n=G(t,a,this.config);r=n.stateOut,s=n.outputVec}return this.state.snapshot={data:Array.from(r),dim:this.config.dim,order:this.config.order,channels:this.config.channels,step:this.state.snapshot.step+1},this.state.history=[...this.state.history.slice(-(this.config.maxHistory-1)),e],this.state.updatedAt=new Date().toISOString(),this.buildContextString(s)}async trainMemory(e,a){for(let t=0;t<e.length;t++)await this.step(e[t]),a?.(t+1,e.length)}async save(){this.state.version+=1,await C(this.state)}getSnapshot(){return{...this.state.snapshot}}getState(){return{...this.state,history:[...this.state.history]}}get agentId(){return this.state.agentId}dispose(){const e=this.gpuBackend;this.gpuBackend=null,this.gpuReady=!1,e&&(e.paramsBuffer.destroy(),e.stateBuffer.destroy(),e.inputBuffer.destroy(),e.stateOutBuffer.destroy(),e.outputBuffer.destroy(),e.readbackBuffer.destroy(),e.device.destroy())}makeInitialState(e,a){return{agentId:e,projectId:a,version:0,snapshot:{data:new Array(this.config.channels*this.config.order).fill(0),dim:this.config.dim,order:this.config.order,channels:this.config.channels,step:0},history:[],updatedAt:new Date().toISOString()}}buildContextString(e){let a=0;const t=[];for(let i=0;i<e.length;i++){const u=e[i];a+=u*u;const d=Math.abs(u);(t.length<3||d>t[2].abs)&&(t.push({abs:d,idx:i}),t.sort((h,c)=>c.abs-h.abs),t.length>3&&t.pop())}const r=Math.sqrt(a),s=t.map(({idx:i})=>`ch${i}`).join(","),n=this.state.history.slice(-3).join(" → ");return`[Memory: step=${this.state.snapshot.step} signal=${r.toFixed(3)} channels=${s}${n?` context="${n}"`:""}]`}async uploadStateToGPU(e){if(!this.gpuBackend)return;const{device:a,stateBuffer:t}=this.gpuBackend;a.queue.writeBuffer(t,0,e)}async runGPUScan(e,a){const t=this.gpuBackend,{device:r,pipeline:s,paramsBuffer:n,stateBuffer:i,inputBuffer:u,stateOutBuffer:d,outputBuffer:h,readbackBuffer:c,config:f}=t,p=new Uint32Array([f.dim,f.order,f.channels,0]),g=new Float32Array([.01]);r.queue.writeBuffer(n,0,p),r.queue.writeBuffer(n,12,g),r.queue.writeBuffer(i,0,e),r.queue.writeBuffer(u,0,a);const y=f.channels*f.order*4,m=f.channels*4,w=r.createBindGroup({layout:s.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:n}},{binding:1,resource:{buffer:i}},{binding:2,resource:{buffer:u}},{binding:3,resource:{buffer:d}},{binding:4,resource:{buffer:h}}]}),b=r.createCommandEncoder(),B=b.beginComputePass();B.setPipeline(s),B.setBindGroup(0,w),B.dispatchWorkgroups(Math.ceil(f.channels/64)),B.end(),b.copyBufferToBuffer(d,0,c,0,y),r.queue.submit([b.finish()]),await c.mapAsync(GPUMapMode.READ,0,y);const l=new Float32Array(c.getMappedRange(0,y).slice(0));c.unmap();const _=r.createCommandEncoder();_.copyBufferToBuffer(h,0,c,0,m),r.queue.submit([_.finish()]),await c.mapAsync(GPUMapMode.READ,0,m);const A=new Float32Array(c.getMappedRange(0,m).slice(0));return c.unmap(),r.queue.writeBuffer(i,0,l),{stateOut:l,outputVec:A}}}async function I(o,e,a){const t=new R(o,e,a);return await t.init(),await t.loadFromIndexedDB(),t}export{v as DEFAULT_MAMBA_CONFIG,R as MambaEngine,I as createMambaEngine};
