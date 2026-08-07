import{h as P}from"./index.js";const M={dim:64,order:4,channels:16,maxHistory:50},v=`
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
`;async function x(o){if(!P())return null;try{const e=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!e)return null;const t=await e.requestDevice(),n=t.createShaderModule({code:v}),r=await t.createComputePipelineAsync({layout:"auto",compute:{module:n,entryPoint:"main"}}),s=o.channels*o.order*4,i=o.dim*4,u=o.channels*4,d=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),h=t.createBuffer({size:s,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),c=t.createBuffer({size:i,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),f=t.createBuffer({size:s,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),l=t.createBuffer({size:u,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),g=t.createBuffer({size:Math.max(s,u),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});return{device:t,pipeline:r,paramsBuffer:d,stateBuffer:h,inputBuffer:c,stateOutBuffer:f,outputBuffer:l,readbackBuffer:g,config:o}}catch{return null}}function G(o,a,e,t=.01){const{channels:n,order:r,dim:s}=e,i=new Float32Array(n*r),u=new Float32Array(n);for(let d=0;d<n;d++){let h=0;for(let c=0;c<r;c++){const f=d*r+c;let l=o[f]??0,g=0;for(let p=0;p<s;p++){const _=(d*s+p&1)===0?.1:-.1;g+=_*(a[p%a.length]??0)}const b=.9-d*.01-c*.001,m=Math.max(.5,Math.min(.99,b)),w=Math.exp(m*t),y=(w-1)/m;l=w*l+y*g,i[f]=l;const B=(c&1)===0?.08:-.08;h+=B*l}u[d]=h}return{stateOut:i,outputVec:u}}function k(o,a){const e=new Float32Array(a);let t=0;for(let r=0;r<o.length;r++){const s=o.charCodeAt(r),i=r%a,u=(i+1)%a,d=Math.sin(s*.01+r*.1),h=Math.cos(s*.007+r*.07);t-=e[i]*e[i],t-=e[u]*e[u],e[i]+=d,e[u]+=h,t+=e[i]*e[i],t+=e[u]*e[u]}const n=Math.sqrt(t)+1e-8;for(let r=0;r<a;r++)e[r]/=n;return e}const D="builderforce_mamba",S="agent_states",O=1;function A(){return new Promise((o,a)=>{if(typeof indexedDB>"u"){a(new Error("IndexedDB not available"));return}const e=indexedDB.open(D,O);e.onupgradeneeded=()=>{e.result.createObjectStore(S,{keyPath:"agentId"})},e.onsuccess=()=>o(e.result),e.onerror=()=>a(e.error)})}async function C(o){const a=await A();await new Promise((e,t)=>{const n=a.transaction(S,"readwrite");n.objectStore(S).put(o),n.oncomplete=()=>e(),n.onerror=()=>t(n.error)})}async function F(o){const a=await A();return new Promise((e,t)=>{const r=a.transaction(S,"readonly").objectStore(S).get(o);r.onsuccess=()=>e(r.result??null),r.onerror=()=>t(r.error)})}class E{constructor(a,e,t){this.gpuBackend=null,this.gpuReady=!1,this.config={...M,...t},this.state=this.makeInitialState(a,e)}async init(){this.gpuReady||(this.gpuBackend=await x(this.config),this.gpuReady=!0,this.gpuBackend&&await this.uploadStateToGPU(new Float32Array(this.config.channels*this.config.order)))}async loadFromIndexedDB(){try{const a=await F(this.state.agentId);return a?(this.state=a,this.gpuBackend&&await this.uploadStateToGPU(new Float32Array(a.snapshot.data)),!0):!1}catch{return!1}}loadFromSnapshot(a){this.state.snapshot={...a},this.gpuBackend&&this.uploadStateToGPU(new Float32Array(a.data))}async step(a){const e=k(a,this.config.dim),t=new Float32Array(this.state.snapshot.data);let n,r;if(this.gpuBackend){const s=await this.runGPUScan(t,e);n=s.stateOut,r=s.outputVec}else{const s=G(t,e,this.config);n=s.stateOut,r=s.outputVec}return this.state.snapshot={data:Array.from(n),dim:this.config.dim,order:this.config.order,channels:this.config.channels,step:this.state.snapshot.step+1},this.state.history=[...this.state.history.slice(-(this.config.maxHistory-1)),a],this.state.updatedAt=new Date().toISOString(),this.buildContextString(r)}async trainMemory(a,e){for(let t=0;t<a.length;t++)await this.step(a[t]),e==null||e(t+1,a.length)}async save(){this.state.version+=1,await C(this.state)}getSnapshot(){return{...this.state.snapshot}}getState(){return{...this.state,history:[...this.state.history]}}get agentId(){return this.state.agentId}makeInitialState(a,e){return{agentId:a,projectId:e,version:0,snapshot:{data:new Array(this.config.channels*this.config.order).fill(0),dim:this.config.dim,order:this.config.order,channels:this.config.channels,step:0},history:[],updatedAt:new Date().toISOString()}}buildContextString(a){let e=0;const t=[];for(let i=0;i<a.length;i++){const u=a[i];e+=u*u;const d=Math.abs(u);(t.length<3||d>t[2].abs)&&(t.push({abs:d,idx:i}),t.sort((h,c)=>c.abs-h.abs),t.length>3&&t.pop())}const n=Math.sqrt(e),r=t.map(({idx:i})=>`ch${i}`).join(","),s=this.state.history.slice(-3).join(" → ");return`[Memory: step=${this.state.snapshot.step} signal=${n.toFixed(3)} channels=${r}${s?` context="${s}"`:""}]`}async uploadStateToGPU(a){if(!this.gpuBackend)return;const{device:e,stateBuffer:t}=this.gpuBackend;e.queue.writeBuffer(t,0,a)}async runGPUScan(a,e){const t=this.gpuBackend,{device:n,pipeline:r,paramsBuffer:s,stateBuffer:i,inputBuffer:u,stateOutBuffer:d,outputBuffer:h,readbackBuffer:c,config:f}=t,l=new Uint32Array([f.dim,f.order,f.channels,0]),g=new Float32Array([.01]);n.queue.writeBuffer(s,0,l),n.queue.writeBuffer(s,12,g),n.queue.writeBuffer(i,0,a),n.queue.writeBuffer(u,0,e);const b=f.channels*f.order*4,m=f.channels*4,w=n.createBindGroup({layout:r.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:s}},{binding:1,resource:{buffer:i}},{binding:2,resource:{buffer:u}},{binding:3,resource:{buffer:d}},{binding:4,resource:{buffer:h}}]}),y=n.createCommandEncoder(),B=y.beginComputePass();B.setPipeline(r),B.setBindGroup(0,w),B.dispatchWorkgroups(Math.ceil(f.channels/64)),B.end(),y.copyBufferToBuffer(d,0,c,0,b),n.queue.submit([y.finish()]),await c.mapAsync(GPUMapMode.READ,0,b);const p=new Float32Array(c.getMappedRange(0,b).slice(0));c.unmap();const _=n.createCommandEncoder();_.copyBufferToBuffer(h,0,c,0,m),n.queue.submit([_.finish()]),await c.mapAsync(GPUMapMode.READ,0,m);const U=new Float32Array(c.getMappedRange(0,m).slice(0));return c.unmap(),n.queue.writeBuffer(i,0,p),{stateOut:p,outputVec:U}}}async function R(o,a,e){const t=new E(o,a,e);return await t.init(),await t.loadFromIndexedDB(),t}export{M as DEFAULT_MAMBA_CONFIG,E as MambaEngine,R as createMambaEngine};
