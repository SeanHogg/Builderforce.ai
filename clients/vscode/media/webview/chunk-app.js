import{m0 as ar,m1 as Se,m2 as se,m3 as cr,m4 as lr,m5 as ur,m6 as dr,m7 as Le,m8 as Rt,m9 as fr,ma as pr,_ as $r,mb as hr,mc as mr,md as ln,U as ut,V as x,W as Ie,me as gr,hX as z,mf as un,mg as _r,mh as yr,mi as wr,mj as br,mk as Oe,ml as Nt,mm as vr,mn as dt,mo as dn,mp as fn,mq as Er,hY as Sr,mr as kr,ms as Tr,mt as At,mu as Pr,mv as Ct,mw as ft,mx as Or,my as It,mz as Rr,mA as Nr,i8 as g,mB as D,mC as pn,mD as Ar,mE as Y,mF as Cr,mG as $n,mH as pt,mI as Re,i9 as Ir,mJ as hn,mK as xr,mL as Dr,mM as Lr,mN as qr,mO as Mr,mP as $t,mQ as Ke,mR as mn,mS as Ur,mT as gn,mU as jr,mV as xt,mW as Dt,mX as Fr,mY as Gr,mZ as Br,m_ as Hr}from"./index.js";import{m$ as Oc,i7 as Rc,n0 as Nc,n1 as Ac,n2 as Cc,n3 as Ic,n4 as xc,n5 as Dc,n6 as Lc,n7 as qc,n8 as Mc,n9 as Uc,ij as jc,na as Fc,nb as Gc,nc as Bc,nd as Hc,ne as Wc,ih as Vc,nf as zc,ng as Qc,nh as Yc,ib as Kc,ni as Jc,nj as Xc,nk as Zc,nl as el,nm as tl,nn as nl,no as rl,np as sl,nq as il,nr as ol,ns as al,nt as cl,nu as ll,nv as ul,nw as dl,nx as fl,ny as pl,i0 as $l,nz as hl,nA as ml,nB as gl,nC as _l,nD as yl,nE as wl,nF as bl,nG as vl,nH as El,nI as Sl,nJ as kl,nK as Tl,nL as Pl,nM as Ol,nN as Rl,nO as Nl,nP as Al,nQ as Cl,nR as Il,nS as xl,ii as Dl,ig as Ll,id as ql,ik as Ml,nT as Ul,nU as jl,nV as Fl,nW as Gl,nX as Bl,nY as Hl,nZ as Wl,n_ as Vl,n$ as zl,o0 as Ql,o1 as Yl,o2 as Kl,o3 as Jl,o4 as Xl,o5 as Zl,o6 as eu,o7 as tu,o8 as nu,o9 as ru,oa as su}from"./index.js";import{r as Wr,s as Vr,h as zr,p as Qr,m as Lt,c as Yr,a as Kr,b as ht,i as Jr,d as Xr,Z as Zr,t as qt,e as _n,f as es,g as ts,j as ns,k as rs,l as ss,n as sc}from"./chunk-rustProcessKind.js";import{D as ou,P as au,o as cu,R as lu,S as uu,T as du,q as fu,u as pu,v as $u,w as hu,x as mu,y as gu,z as _u,A as yu,B as wu,C as bu,E as vu,F as Eu}from"./chunk-rustProcessKind.js";import{V as yn}from"./chunk-vfs.js";const is={discovered:["preparing","failed"],preparing:["starting","stopping","failed"],starting:["ready","stopping","failed"],ready:["running","stopping","failed"],running:["stopping","stopped","failed"],stopping:["stopped","failed"],stopped:["preparing"],failed:["preparing","stopped"]},qe=new Set(["preparing","starting","ready","running"]);class os extends Error{serviceId;from;to;constructor(t,n,r){super(`Service "${t}" cannot go from "${n}" to "${r}".`),this.serviceId=t,this.from=n,this.to=r,this.name="IllegalTransitionError"}}function as(e,t){return is[e].includes(t)}function cs(e,t){let n="discovered";return{serviceId:e,get state(){return n},transition(r){if(!as(n,r))throw new os(e,n,r);const s={serviceId:e,from:n,to:r};return n=r,t?.(s),s}}}const ls={maxRestarts:5,backoffMs:250,maxBackoffMs:5e3};function us(e,t,n,r,s={}){const{maxRestarts:i,backoffMs:o,maxBackoffMs:a}={...ls,...s};return t==="exit-zero"&&n===0?{restart:!1,reason:"completed"}:e==="always"||e==="on-failure"&&n!==0?r>=i?{restart:!1,reason:"limit"}:{restart:!0,delayMs:Math.min(a,o*2**r)}:{restart:!1,reason:"policy"}}function ds(e){const t=new Map(e.map(n=>[n.id,n]));return{providers:[...t.values()],resolve(n){const r=t.get(n.runtime);if(!r){const i=[...t.keys()].join(", ")||"none";return{ok:!1,reason:`No runtime provider for "${n.runtime}" (available: ${i}).`}}const s=r.accepts(n);return s.ok?{ok:!0,provider:r}:{ok:!1,reason:s.reason}}}}function fs(e,t){const n=[];for(const r of e){const s=t.resolve(r);s.ok||n.push({serviceId:r.id,reason:s.reason})}return n.length===0?{ok:!0}:{ok:!1,declined:n}}const ps=20;function $s(e,t,n=ps){return{services:e.map(r=>({id:r.id,state:r.state,...r.restarts>0?{restarts:r.restarts}:{},...r.exitCode!==void 0?{lastExitCode:r.exitCode}:{},lastLines:t.recent(r.id,n)}))}}const hs="/v1/chat/completions",ms=new TextEncoder,wn=new TextDecoder;function gs(e){const t=new Map;if(!e)return t;if(e instanceof Headers)return e.forEach((n,r)=>t.set(r.toLowerCase(),n)),t;if(Array.isArray(e)){for(const[n,r]of e)t.set(n.toLowerCase(),Array.isArray(r)?r.join(", "):String(r));return t}for(const[n,r]of Object.entries(e))r!==void 0&&t.set(n.toLowerCase(),Array.isArray(r)?r.join(", "):String(r));return t}function Me(e,t){const n=ms.encode(JSON.stringify({error:{message:t,type:"invalid_request_error"}}));return{status:e,headers:{"content-type":"application/json","content-length":String(n.byteLength)},body:new ReadableStream({start(r){r.enqueue(n),r.close()}})}}function _s(e){try{const t=JSON.parse(wn.decode(e));return typeof t.model=="string"?t.model:void 0}catch{return}}function bn(e,t){if(!t||t.length===0)return{ok:!0};const n=_s(e);return n?t.includes(n)?{ok:!0}:{ok:!1,message:`model "${n}" is not allowed for this resource`}:{ok:!1,message:"model is required by this resource allowlist"}}function ys(e,t){if(t.get("accept")?.includes("text/event-stream"))return!0;try{return JSON.parse(wn.decode(e)).stream===!0}catch{return!1}}function ws(e,t){let n=t;return new ReadableStream({async pull(r){try{const s=n??await e.next();if(n=void 0,s.done){r.close();return}s.value.byteLength&&r.enqueue(s.value)}catch(s){r.error(s)}},async cancel(){await e.return?.()}})}function bs(e,t){return async n=>{const r=n.url.split("?")[0]??n.url;if(n.method!=="POST"||r!==hs&&r!=="/chat/completions")return Me(404,"Not found");const s=gs(n.headers);s.delete("authorization");const i=n.body??new Uint8Array,o=bn(i,t.models);if(!o.ok)return Me(400,o.message);const a={resourceId:t.resourceId,...t.models&&t.models.length>0?{models:t.models}:{},body:i,stream:ys(i,s)};let c,l;try{c=e.forwardAi(a)[Symbol.asyncIterator](),l=await c.next()}catch(u){const d=u instanceof Error?u.message:"AI relay failed";return Me(502,d)}return{status:200,headers:{"content-type":a.stream?"text/event-stream":"application/json","cache-control":"no-cache"},body:ws(c,l)}}}const vs=ar;function Es(e){const t=[],n=new Map;for(const r of e.services)if(vs(r))for(const s of r.resourceUses??[]){if(s.type!=="ai")continue;const i={resourceId:s.id,...s.models&&s.models.length>0?{models:s.models}:{}},o={applicationId:e.applicationId,serviceId:r.id},a=bs(e.relay,i),c=e.listen(0,a,o),{port:l}=c;let u=c;const d={serviceId:r.id,resourceId:s.id,port:l,baseUrl:`http://localhost:${l}/v1`,close(){u?.close(),u=void 0},open(){if(!u)try{u=e.listen(l,a,o)}catch($){throw new Error(`AI gateway port ${l} is taken.`,{cause:$})}}};t.push(d),n.set(`${r.id}\0${s.id}`,d)}return{bindings:t,baseUrl:(r,s)=>n.get(`${r}\0${s}`)?.baseUrl,open(){try{for(const r of t)r.open()}catch(r){for(const s of t)s.close();throw r}},close(){for(const r of t)r.close()}}}class fe extends Error{error;constructor(t){super(t.message),this.error=t,this.name="ServiceFailure"}}function Ue(e,t={}){const n=[],r=new Promise((s,i)=>{const o=()=>{let a=!1;for(const c of e){const l=c.readiness();if(l==="down")return i(new fe(c.failure()));l==="pending"&&(a=!0)}a||s()};for(const a of e)n.push(a.onChange(o));o()});return Se(r,{signal:t.signal,ms:t.timeoutMs}).finally(()=>n.forEach(s=>s()))}function Je(){const e=new Set;return{on(t){return e.add(t),()=>e.delete(t)},emit(t){for(const n of[...e])try{n(t)}catch(r){queueMicrotask(()=>{throw r})}}}}const Ss=5e3;function ks(e={}){const t=Wr(Math.max(1,e.history??Ss)),n=Math.max(1,e.readerBuffer??1e3),r=new Set;let s=!1;const i=(c,l)=>{if((c.controller.desiredSize??0)<=1){c.dropped+=1;return}c.dropped>0&&(c.controller.enqueue({serviceId:l.serviceId,source:"runtime",text:`${c.dropped} log lines dropped (reader fell behind).`,at:l.at}),c.dropped=0),c.controller.enqueue(l)},o=c=>{t.push(c);for(const l of r)l.wanted(c)&&i(l,c)},a=(c,l,u)=>o({serviceId:c,source:l,text:u,at:Date.now()});return{pipe(c,l){return(async()=>{let u,d="";try{for(u=l.getReader();;){const{value:$,done:m}=await u.read();if(m)break;const p=(d+$).split(/\r?\n/);d=p.pop()??"";for(const f of p)a(c,"output",f)}}catch($){a(c,"runtime",`Output stopped: ${se($)}`)}finally{d&&a(c,"output",d),u?.releaseLock()}})()},note:(c,l)=>a(c,"runtime",l),recent(c,l){if(l<=0)return[];const u=[];for(const d of t)d.serviceId===c&&(u.push(d.text),u.length>l&&u.shift());return u},stream(c){let l;return new ReadableStream({start(u){l={wanted:d=>c===void 0||d.serviceId===c,controller:u,dropped:0};for(const d of t)l.wanted(d)&&u.enqueue(d);s?u.close():r.add(l)},cancel(){l&&r.delete(l)}},new CountQueuingStrategy({highWaterMark:n}))},close(){s=!0;for(const c of r)c.controller.close();r.clear()}}}function Ts(){let e;return{get pending(){return e!==void 0},schedule(t,n){clearTimeout(e),e=setTimeout(()=>{e=void 0,n()},t)},cancel(){clearTimeout(e),e=void 0}}}function Ps(e,t){return t===void 0?`Exited with code ${e}.`:new RegExp(`^Exited with code ${e}\\b`).test(t)?t:`Exited with code ${e} before ready: ${t}`}function Os(e){const{spec:t,logs:n}=e,r=cr(t),s=lr(t),i=r.timeoutMs??e.readinessTimeoutMs,o=Je(),a=cs(t.id,y=>{e.onStateChange(y),o.emit()}),c=Ts(),l=(y,R,T=!1,M)=>({serviceId:t.id,phase:y,message:R,exitCode:M,willRestart:T});let u,d,$=!1,m=!1,p=0,f=0,_,h,w,b,k=l("stopped","Not started.");function C(){const y={controller:new AbortController};u=y,d=y,$=!1,S(y)}async function S(y){a.transition("preparing");try{await Ue(e.dependencies(),{signal:y.controller.signal,timeoutMs:e.dependencyTimeoutMs})}catch(I){const G=I instanceof fe?`Dependency "${I.error.serviceId}" is not available: ${I.error.message}`:`Dependencies not ready: ${se(I)}`;return A(y,{phase:"dependency",message:G})}if(u!==y)return;const R=e.registry.resolve(t);if(!R.ok)return A(y,{phase:"declined",message:R.reason});if(h&&await Se(h,{ms:e.stopTimeoutMs,onTimeout:()=>{},signal:y.controller.signal,onAbort:()=>{}}),u!==y)return;a.transition("starting");let T;try{y.handlePromise=Promise.resolve(R.provider.start(t,{env:e.env,signal:y.controller.signal,security:e.security,projectId:e.projectId})),T=await y.handlePromise}catch(I){return A(y,{phase:"start",message:se(I)})}if(y.handle=T,u!==y){y.abandoned?h=fr(T):T.output.cancel().catch(()=>{});return}y.drained=n.pipe(t.id,T.output),h=T.wait();const M=T.wait().then(async I=>(y.exitCode=I,w=I,await P(y,I),I));M.then(I=>q(y,I));try{const I=r.kind==="exit-zero"?T.ready().then(()=>v(y,T,M)):T.ready();await Se(I,{ms:i,onTimeout:()=>{throw new Error(`Not ready after ${i}ms (${r.kind} readiness).`)},signal:y.controller.signal})}catch(I){if(u!==y)return;const G=se(I);if(y.exitCode!==void 0||await Le(T,0)!==void 0){y.readinessReason=G;return}return u!==y?void 0:A(y,{phase:"readiness",message:G})}u===y&&O(y)}async function v(y,R,T){(y.exitCode!==void 0||await Le(R,0)!==void 0)&&await T}function P(y,R){const T=y.drained;if(!T)return Promise.resolve();const M=e.stopTimeoutMs,I=G=>(n.note(t.id,`Output could not be read to its end: ${se(G)}`),!0);return y.outputDone??=Se(T.then(()=>!0,I),{ms:M,onTimeout:()=>!1}).then(G=>{G||n.note(t.id,`Output did not end within ${M}ms of the exit (code ${R}); later lines may follow.`)})}function O(y){y.readyAt=Date.now(),b=void 0,a.transition("ready"),$=!0,a.transition("running"),y.completed&&E(y)}function q(y,R){if(u===y){if(r.kind==="exit-zero"&&R===0){y.completed=!0,a.state==="running"?E(y):a.state==="starting"&&O(y);return}A(y,{phase:"exit",message:Ps(R,y.readinessReason),exitCode:R,clean:a.state==="running"&&R===0})}}function E(y){u=void 0,y.controller.abort(),n.note(t.id,"Completed."),a.transition("stopped")}function A(y,R){if(u!==y)return;u=void 0,y.controller.abort(),y.handle&&y.exitCode===void 0&&y.handle.kill("SIGKILL"),Rt(e.processes,e.security),y.readyAt!==void 0&&Date.now()-y.readyAt>=e.stableAfterMs&&(p=0);const M=R.phase==="declined"||R.phase==="dependency"?{restart:!1}:us(s,r.kind,R.exitCode??1,p,e.restart),I=l(R.phase,R.message,M.restart,R.exitCode);$=!1,k=I,M.restart&&c.schedule(M.delayMs,C),a.transition(R.clean?"stopped":"failed"),R.clean?n.note(t.id,"Exited with code 0."):(b=I,n.note(t.id,`Failed (${R.phase}): ${R.message}`),e.onError(I)),M.restart&&(p+=1,n.note(t.id,`Restarting in ${M.delayMs}ms (${s}, attempt ${p}).`))}async function U(){c.cancel();const y=u;if(u=void 0,$=!1,k=l("stopped","Stopped."),qe.has(a.state)){a.transition("stopping");const R=y?await dr(y,e.stopTimeoutMs):void 0;if(R&&(h=R.wait()),R&&y){const T=y.exitCode??await Le(R,0);T!==void 0&&await P(y,T)}Rt(e.processes,e.security),a.transition("stopped")}else a.state==="failed"?a.transition("stopped"):o.emit()}const L={id:t.id,async start(){const y=f;if(_&&await _,y!==f)throw new fe(l("stopped","Stopped before it started."));return!$&&!qe.has(a.state)&&!c.pending&&(p=0,C()),Ue([L])},stop(){return f+=1,_??=U().finally(()=>_=void 0),_},async restart(){m=!0;try{const y=L.stop(),R=f;if(await y,R!==f)throw new fe(l("stopped","Stopped while restarting."));p=0,C()}finally{m=!1,o.emit()}return Ue([L])},readiness:()=>$?"ready":qe.has(a.state)||c.pending||m?"pending":"down",failure:()=>k,onChange:y=>o.on(y),outputDrained:()=>d?.exitCode===void 0?Promise.resolve():P(d,d.exitCode),url:()=>u?.handle?.url(),database:()=>u?.handle?.database,snapshot:()=>({id:t.id,type:t.type,runtime:t.runtime,role:ur(t),state:a.state,port:t.port,url:u?.handle?.url(),restarts:p,exitCode:w,error:b})};return L}class vn extends Error{failures;constructor(t){super(`Services failed to start: ${t.map(n=>`${n.serviceId} (${n.message})`).join("; ")}`),this.failures=t,this.name="ApplicationStartError"}}const ge={readinessTimeoutMs:12e4,dependencyTimeoutMs:6e5,stopTimeoutMs:5e3,stableAfterMs:1e4},Rs=e=>"resolve"in e;async function Mt(e){const n=(await Promise.allSettled(e.map(([,r])=>r))).flatMap((r,s)=>{if(r.status==="fulfilled")return[];const i=r.reason instanceof fe?r.reason.error:{serviceId:e[s][0],phase:"start",message:se(r.reason),willRestart:!1};return i.phase==="stopped"?[]:[i]});if(n.length>0)throw new vn(n)}function Ns(e){const t=e.name!==void 0,n=t?JSON.stringify(e.name):e.services.map(i=>`${i.id}\0${i.root??"/"}`).sort().join(""),r=zr("sha256").digest(new TextEncoder().encode(n)),s=Array.from(r.subarray(0,8),i=>i.toString(16).padStart(2,"0")).join("");return`app:${e.projectId}:${t?"named-":""}${s}`}function oc(e,t){const n=Vr(e),r=Rs(t.providers)?t.providers:ds(t.providers),s=ks({history:t.logHistory,readerBuffer:t.logReaderBuffer}),i=Je(),o=Je(),a=new Map;let c=!1;const l=Ns(e),u=e.name!==void 0,d=(v,P)=>{const O=r.resolve(v);return O.ok?O.provider.databaseCredentials?.(v,P):void 0},$=t.processes??t.runtime,m=t.portPolicy??t.runtime.portPolicy,p=t.runtime.listenHttp?.bind(t.runtime),f=t.hostRelay&&p?Es({applicationId:l,services:e.services,relay:t.hostRelay,listen:p}):void 0,_=(v,P)=>{const O=f?.baseUrl(P.id,v);return O?{baseUrl:O}:void 0};try{for(const v of n.startOrder){const P=n.dependenciesOf(v).map(O=>a.get(O));a.set(v,Os({spec:e.services.find(O=>O.id===v),env:pr(e,v,{databaseCredentials:d,aiEndpoint:_}),registry:r,logs:s,onStateChange:O=>i.emit(O),onError:O=>o.emit(O),dependencies:()=>P,readinessTimeoutMs:t.readinessTimeoutMs??ge.readinessTimeoutMs,dependencyTimeoutMs:t.dependencyTimeoutMs??ge.dependencyTimeoutMs,stopTimeoutMs:t.stopTimeoutMs??ge.stopTimeoutMs,restart:t.restart??{},stableAfterMs:t.stableAfterMs??ge.stableAfterMs,security:Object.freeze({applicationId:l,serviceId:v}),projectId:e.projectId,processes:$}))}}catch(v){throw f?.close(),v}const h=v=>{const P=a.get(v);if(!P)throw new Error(`No service "${v}" in this application.`);return P},w=()=>{if(c)throw new Error("This application runtime was disposed.")};let b,k;const C=()=>{f?.open(),b??=m.register(l,e),e.ingress?.routes.length&&(k??=t.runtime.registerIngress?.(l,e))},S=async()=>{const v=b;k?.(),k=void 0;for(const P of n.stopOrder)await h(P).stop();f?.close(),!(u&&(!v||v!==b))&&($.killApplication(l),u&&t.runtime.forgetApplication?.(l),b?.(),b=void 0)};return{projectId:e.projectId,applicationId:l,async start(){w();const v=fs(e.services,r);if(!v.ok){const P=v.declined.map(({serviceId:O,reason:q})=>({serviceId:O,phase:"declined",message:q,willRestart:!1}));throw P.forEach(O=>o.emit(O)),new vn(P)}C(),await Mt(n.startOrder.map(P=>[P,h(P).start()]))},stop:S,async restart(v){w();const P=h(v);u&&C(),await Mt([[v,P.restart()]])},async dispose(){c||(c=!0,await S(),f?.close(),u||t.runtime.forgetApplication?.(l),await Promise.all([...a.values()].map(v=>v.outputDrained())),s.close())},getService:v=>a.get(v)?.snapshot(),listServices:()=>n.startOrder.map(v=>h(v).snapshot()),diagnostics:()=>$s(n.startOrder.map(v=>h(v).snapshot()),s),getUrl:v=>a.get(v)?.url(),logs:v=>s.stream(v),onStateChange:v=>i.on(v),onError:v=>o.on(v),database(v){const P=h(v);if(e.services.find(q=>q.id===v)?.type!=="database")throw new Error(`Service "${v}" is not a database.`);const O=async()=>P.database()??Promise.reject(new Error(`Database "${v}" is not running.`));return{export:async()=>(await O()).export(),import:async q=>(await O()).import(q),reset:async()=>(await O()).reset()}}}}function As(e){return Promise.reject(new Error("Connection vault delivery is not implemented (ticket #6999)."))}async function*ac(e){const t=e.getReader();let n=!1;try{for(;;){const{done:r,value:s}=await t.read();if(r){n=!0;return}yield s}}finally{n||await t.cancel().catch(()=>{}),t.releaseLock()}}function cc(e,t){return{async*forwardAi(n){if(!t.has(n.resourceId))throw new Error(`AI resource "${n.resourceId}" is not available to this runtime.`);const r=t.get(n.resourceId),s=r&&r.length>0?r:void 0;if(s){if(n.models&&n.models.length>0&&!n.models.every(o=>s.includes(o)))throw new Error(`AI models for "${n.resourceId}" exceed this runtime's allowlist.`);const i=bn(n.body,s);if(!i.ok)throw new Error(i.message)}yield*e.forwardAi({...n,...s?{models:n.models&&n.models.length>0?n.models:s}:{}})},connectionSecrets:As}}const Cs="0.5.16",lc=`https://cdn.jsdelivr.net/npm/@electric-sql/pglite@${Cs}/dist/index.js`,Is="314.0.7",xs=`https://cdn.jsdelivr.net/pyodide/v${Is}/full/`;let le;const Ds=e=>e.endsWith("/")?e:`${e}/`;async function Ls(e){const t=globalThis;if(typeof t.importScripts=="function")try{if(t.importScripts(`${e}pyodide.js`),t.loadPyodide)return t.loadPyodide}catch{}return(await $r(()=>import(`${e}pyodide.mjs`),[],import.meta.url)).loadPyodide}async function uc(e={}){const t=Ds(e.indexURL??xs);if(le?.indexURL!==t){const r=Ls(t);le={indexURL:t,load:r},r.catch(()=>{le?.load===r&&(le=void 0)})}const n=()=>{};return(await le.load)({indexURL:t,env:e.env,stdout:n,stderr:n})}const Xe="/bfwc-artifacts";function qs(e){const t=[];for(const n of e.matchAll(/(?:pure Python 3 wheel|pure Python wheel|wheel compatible with Pyodide)[^:'"]*:?\s*((?:['"][^'"]+['"](?:,\s*)?)+)/gi))for(const r of n[1].matchAll(/['"]([^'"]+)['"]/g))t.push(ln(r[1].split(/[<>=!~;[ ]/)[0]));return[...new Set(t)]}const Ms=e=>e instanceof Error?e.message:String(e);async function Ut(e,t,n){const r=e.toPy(n);try{await e.runPythonAsync(`import micropip
${t}`,{globals:r})}finally{r.destroy?.()}}async function Ze(e,t,n={}){const r=hr(t,n.provided),s={installed:[],provided:r.provided,declined:[...r.declined]};let i=r.install;if(!i.length)return s;const o=n.log??(()=>{});await e.loadPackage("micropip",{messageCallback:()=>{},errorCallback:o});const a=n.indexUrls?.length?[...n.indexUrls]:void 0;for(;;)try{return await Ut(e,"await micropip.install(specs, index_urls=index_urls)",{specs:i.map(c=>c.spec),index_urls:a}),s.installed.push(...i.map(c=>c.name)),s}catch(c){const l=qs(Ms(c)).filter($=>!s.declined.some(m=>m.name===$));if(!l.length)throw c;for(const $ of l)s.declined.push({name:$,reason:mr($)});const u=new Set(i.filter($=>l.includes($.name)).map($=>$.name)),d=l.filter($=>!u.has($));for(const $ of d)await Ut(e,'micropip.add_mock_package(name, "0.0.0")',{name:$});if(i=i.filter($=>!u.has($.name)),!i.length)return s}}function Us(e){const t=[];e.installed.length&&t.push(`Successfully installed ${e.installed.join(" ")}`),e.provided.length&&t.push(`Provided by the runtime (not installed): ${e.provided.join(" ")}`);for(const{reason:n}of e.declined)t.push(`Declined: ${n}`);return t}const K="/project",js=new Set(["node_modules",".git"]),Fs=50,Ne=e=>e.split("/").some(t=>js.has(t)),j=e=>e==="/"?K:x(K,e);function ke(e){const t=ut(e);return t===K?"/":t.startsWith(`${K}/`)?t.slice(K.length):void 0}const Gs=new TextDecoder("utf-8",{fatal:!0,ignoreBOM:!0});function Bs(e){try{return Gs.decode(e)}catch{return e.slice()}}const me=(e,t)=>e.analyzePath(t).exists,xe=(e,t)=>me(e,t)&&e.isDir(e.stat(t).mode),Te=(e,t)=>me(e,t)&&!e.isDir(e.stat(t).mode),En=(e,t)=>t.startsWith("/")?t:x(e.cwd(),t),mt=(e,t)=>e.readdir(t).filter(n=>n!=="."&&n!=="..");function Ae(e,t){if(me(e,t)){if(!xe(e,t))return e.unlink(t);for(const n of mt(e,t))Ae(e,`${t}/${n}`);e.rmdir(t)}}function gt(e,t){t.mkdirTree(K);for(const n of e.explicitDirectories())Ne(n)||t.mkdirTree(j(n));for(const n of e.list()){if(Ne(n))continue;const r=j(n);t.mkdirTree(Ie(r)),t.writeFile(r,e.readFile(n)??"")}}function _t(e,t){for(const n of t){if(Ne(n.path))continue;const r=j(n.path);n.op==="write"?(e.mkdirTree(Ie(r)),xe(e,r)&&Ae(e,r),e.writeFile(r,n.content)):n.op==="mkdir"?e.mkdirTree(r):Ae(e,r)}}function Sn(e,t,n=()=>!1){const r=new Set;let s=[],i=!1,o=0,a;const c=(f,_)=>{const h=j(f);return _==="mkdir"||_==="remove"?[{op:_,path:f}]:me(e,h)?xe(e,h)?_==="write"?[]:[{op:"mkdir",path:f},...mt(e,h).flatMap(w=>c(x(f,w),"tree"))]:[{op:"write",path:f,content:Bs(e.readFile(h))}]:[]},l=()=>{if(i=!1,!s.length)return;const f=s;s=[];const _=f.flatMap(({op:h,path:w})=>c(w,h)).filter(h=>!n(h.path));_.length&&t(_)},u=(f,_)=>{const h=ke(_);if(!(o||h===void 0||h==="/"||n(h)||Ne(h))){if(f==="write"){let w;for(const b of s)b.path===h&&(w=b);if(w?.op==="write")return}s.push({op:f,path:h}),i||(i=!0,queueMicrotask(l))}},d=()=>{for(const f of r)u("write",f)},$={openedForWrite(f){!o&&ke(f)!==void 0&&r.add(f)},written(f){o||ke(f)===void 0||(r.add(f),clearTimeout(a),a=setTimeout(d,Fs))},closed(f){r.delete(f)&&u("write",f)},madeDirectory:f=>u("mkdir",f),symlinked:f=>u("tree",f),deleted:f=>u("remove",f),moved(f,_){u("remove",f),u("tree",_)}},m=e.truncate.bind(e),p=e.ftruncate.bind(e);return e.truncate=(f,_)=>{m(f,_),typeof f=="string"&&u("write",En(e,f))},e.ftruncate=(f,_)=>{p(f,_);const h=e.getStream(f)?.path;h&&u("write",h)},{events:$,tracker:{quietly(f){o++;try{f()}finally{o--}},flush(){clearTimeout(a),d(),l()}}}}const _e=j,dc=ke;function Hs(e,t){gt(e,t)}function Ws(e,t){_t(e,t)}const Vs=579,zs=e=>e.includes("/__pycache__")||e.endsWith(".pyc");function Qs(e,t){const{tracker:n,events:r}=Sn(e,t,zs),s={onOpenFile:((i,o)=>{o&Vs&&r.openedForWrite(i)}),onWriteToFile:(i=>r.written(i)),onCloseFile:(i=>r.closed(i)),onMakeDirectory:(i=>r.madeDirectory(i)),onMakeSymlink:((i,o)=>r.symlinked(o)),onDeletePath:(i=>r.deleted(i)),onMovePath:((i,o)=>r.moved(i,o))};return Object.assign(e.trackingDelegate,s),n}const kn=e=>import(e),et=(e,t)=>e===t||e.startsWith(t==="/"?"/":`${t}/`);function Ys(e,t,n){const r=ut(t.root??`/opt/bfwc-extensions/${n}`);if(et(r,K)||et(K,r))throw new Error(`Python extension ${e.moduleUrl}: root ${r} overlaps the project (${K}); extensions are installed outside it.`);return r}function Ks(e,t,n){const r=x(t,n);if(n.startsWith("/")||!et(r,t)||r===t)throw new Error(`Python extension ${e.moduleUrl}: file "${n}" is outside its root ${t}.`);return r}async function Js(e,t,n=kn){const r=new Set,s=new Set;for(const[i,o]of t.entries()){const c=(await n(o.moduleUrl))[o.exportName];if(typeof c!="function")throw new Error(`Python extension ${o.moduleUrl} has no function export "${o.exportName}".`);const l=await c()??{},u=Object.entries(l.files??{}),d=u.length?Ys(o,l,i):void 0,$=u.map(([m,p])=>[Ks(o,d,m),p]);for(const[m,p]of Object.entries(l.jsModules??{}))e.registerJsModule(m,p);for(const[m,p]of $)e.FS.mkdirTree(m.slice(0,m.lastIndexOf("/"))||"/"),e.FS.writeFile(m,p);d&&e.runPython(`import sys
if ${JSON.stringify(d)} not in sys.path: sys.path.insert(0, ${JSON.stringify(d)})`);for(const m of l.provides??[])r.add(ln(m));for(const m of l.imports??(l.provides??[]).map(p=>p.replace(/-/g,"_")))s.add(m)}return{packages:r,imports:s}}function Xs(e){const t={};for(const[n,r]of e){const s=n.toLowerCase(),i=t[s];t[s]=i===void 0?r:Array.isArray(i)?[...i,r]:[i,r]}return t}const Zs=e=>JSON.stringify(Object.entries(e.headers??{}));function Tn(e){const t=e.handle,n=e.disconnect,r=e.close,s={interface:e.interface,app:String(e.label),port:Number(e.port)};let i=1;return{spec:s,handle:a=>new Promise((c,l)=>{const u=i++;let d,$=!1;const m={head(p,f){d=Qr(()=>{$||n(u)}),c({status:p,headers:Xs(JSON.parse(f)),body:d.stream})},chunk(p){if(!(!d||d.push(p.slice())))return d.ready()},end(p){$=!0,p?d?.fail(new Error(p)):d?.end()}};t(u,a.method,a.url,Zs(a),a.body??void 0,m).then(()=>{d||l(new Error("The Python app finished without a response."))},p=>{d?d.fail(p):l(p)})}),async close(){try{await r()}finally{e.destroy?.()}}}}async function ei(e,t){const n=e.pyimport("bfwc.serve").start_server;return Tn(await n(t.interface,t.app,t.port,!!t.factory,t.appDir))}async function ti(e){const t=e.pyimport("bfwc.serve").start_requested;return Tn(await t())}function yt(e,t){let n=new yn,r,s,i,o,a=!1;const c=f=>{if(!a){r?.flush(),a=!0,i!==void 0&&e({type:"unlisten",port:i});for(const _ of o?.listening??[])e({type:"unlisten",port:_});o?.closeAll(),e({type:"exit",code:f})}},l={post:e,io:{stdout:f=>!a&&e({type:"stdout",data:f}),stderr:f=>!a&&e({type:"stderr",data:f})},get exited(){return a},exit:c,mounted(f){n=void 0,r=f},get takenPorts(){return d.taken}},u=async(f,_=gr(f))=>{const h=s;s=void 0,d.cancelAll();try{o?.stop()}catch{}try{await h?.close()}finally{c(_)}},d=Yr({post:e,handlerFor:f=>s&&f===i?s.handle:o?.handlerFor(f),onListenFailed(f){if(f===i)i=void 0;else if(!o?.listening.has(f))return;l.io.stderr($.addressInUse(f)),u("SIGTERM",1)}}),$=t(l),m=f=>{n?Kr(n,f):r?.apply(f)};async function p(f){const{snapshot:_}=f;_.pack?Lt(n,_):m(_.ops);for(const k of f.ports)d.taken.add(k);const h=$.plan(f,n);if(!h.ok)return l.io.stderr(h.message),c(h.code);if(h.port!==void 0&&d.taken.has(h.port))return l.io.stderr($.addressInUse(h.port)),c(1);const w=await h.run(n);if(w.kind==="exited")return c(w.code);if(w.kind==="running")return o=w.ports,c(await w.done);const{port:b}=w.server;if(a||d.taken.has(b))return await w.server.close(),a||l.io.stderr($.addressInUse(b)),c(1);s=w.server,i=b,d.taken.add(b),e({type:"listen",port:b}),l.io.stderr(w.banner)}return{receive(f){if(!(d.receive(f)||$.receive?.(f)))switch(f.type){case"prime":return Lt(n,f.snapshot),e({type:"primed"});case"start":p(f).catch(_=>{l.io.stderr(`${_ instanceof Error?_.stack??_.message:String(_)}
`),c(1)});return;case"fs":return m(f.ops);case"kill":return void u(f.signal);case"stdin":return $.stdin?.(f.data);case"socket-open":case"socket-accept":return e({type:"socket-close",connId:f.connId});default:return}}}}const ni=String.raw`
import atexit
import os
import runpy
import sys
import traceback

from bfwc.serve import ServeRequested, request_serve


def bootstrap(env, cwd):
    # Python's own defaults (HOME, …) stay unless the process env replaces them.
    os.environ.update(env)
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    sys.dont_write_bytecode = True
    os.makedirs(cwd, exist_ok=True)
    os.chdir(cwd)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(line_buffering=True)
        except Exception:
            pass


def _exit_code(error):
    code = error.code
    if code is None:
        return 0
    if isinstance(code, int):
        return code
    print(code, file=sys.stderr)
    return 1


def _flush():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:
            pass


def _run(kind, target):
    if kind == "script":
        path = os.path.abspath(target)
        if not os.path.isfile(path):
            print("python: can't open file %r: [Errno 2] No such file or directory" % target, file=sys.stderr)
            return 2
        sys.path.insert(0, os.path.dirname(path))
        runpy.run_path(path, run_name="__main__")
    elif kind == "module":
        sys.path.insert(0, os.getcwd())
        runpy.run_module(target, run_name="__main__", alter_sys=True)
    else:
        sys.path.insert(0, "")
        exec(compile(target, "<string>", "exec"), {"__name__": "__main__", "__builtins__": __builtins__})
    return 0


def run_main(kind, target, argv):
    sys.argv = list(argv)
    serving = False
    try:
        return _run(kind, target)
    except ServeRequested as request:
        request_serve(request)
        serving = True
        return "serve"
    except SystemExit as error:
        return _exit_code(error)
    except BaseException:
        traceback.print_exc()
        return 1
    finally:
        if not serving:
            try:
                atexit._run_exitfuncs()
            except BaseException:
                traceback.print_exc()
        _flush()
`,ri=String.raw`
import asyncio
import importlib
import io
import json
import os
import sys
import traceback
from urllib.parse import unquote, unquote_to_bytes

from pyodide.ffi import to_js


class ServeRequested(BaseException):
    """Serve this app (unwinds the program like SystemExit)."""

    def __init__(self, interface, app, port, factory=False, app_dir=None, lifespan="auto"):
        super().__init__(interface, app, port)
        self.interface, self.app, self.port = interface, app, int(port)
        self.factory, self.app_dir, self.lifespan = factory, app_dir, lifespan


class ClientDisconnected(OSError):
    pass


_requested = None


def request_serve(request):
    global _requested
    _requested = request


def _resolve(module_name, attr, factory):
    module = importlib.import_module(module_name)
    names = [attr] if attr else ["app", "application", "create_app", "make_app"]
    for name in names:
        obj = module
        try:
            for part in name.split("."):
                obj = getattr(obj, part)
        except AttributeError:
            continue
        if factory or (not attr and name in ("create_app", "make_app")):
            obj = obj()
        return obj
    raise ImportError("Could not find an application in module %r (looked for %s)." % (module_name, ", ".join(names)))


def load_app(target, factory=False, app_dir=None):
    sys.path.insert(0, os.path.abspath(app_dir) if app_dir else os.getcwd())
    module_name, _, attr = target.partition(":")
    return _resolve(module_name, attr, factory)


def _headers_json(headers):
    out = []
    for name, value in headers:
        name = name.decode("latin-1") if isinstance(name, (bytes, bytearray)) else str(name)
        value = value.decode("latin-1") if isinstance(value, (bytes, bytearray)) else str(value)
        out.append([name, value])
    return json.dumps(out)


class _Exchange:
    """One response: the head once, body chunks, end once."""

    def __init__(self, respond):
        self.respond = respond
        self.started = False
        self.ended = False

    def head(self, status, headers):
        if self.started:
            raise RuntimeError("The app sent the response start twice.")
        self.started = True
        self.respond.head(int(status), _headers_json(headers))

    def chunk(self, data):
        """Send body bytes; returns an awaitable while the reader is behind, else None."""
        if data:
            return self.respond.chunk(to_js(bytes(data)))
        return None

    def end(self, error=None):
        if not self.ended:
            self.ended = True
            self.respond.end(error)

    def fail(self, error_text):
        if not self.started:
            self.head(500, [(b"content-type", b"text/plain; charset=utf-8")])
            self.chunk(error_text.encode("utf-8"))
            self.end()
        else:
            self.end(error_text.splitlines()[-1] if error_text else "error")


class Server:
    def __init__(self, interface, app, port, label, lifespan="auto"):
        self.interface = interface
        self.app = app
        self.port = port
        self.label = label
        self.lifespan_mode = lifespan
        self.state = {}
        self.disconnects = {}
        self.lifespan = None

    # -- lifespan (ASGI) -------------------------------------------------
    async def startup(self):
        if self.interface != "asgi" or self.lifespan_mode == "off":
            return
        inbox = asyncio.Queue()
        outbox = asyncio.Queue()
        scope = {"type": "lifespan", "asgi": {"version": "3.0", "spec_version": "2.0"}, "state": self.state}

        async def run():
            error = None
            try:
                await self.app(scope, inbox.get, outbox.put)
            except BaseException as raised:
                error = raised
            finally:
                # The app is done with lifespan (returned, raised, or finished shutdown).
                await outbox.put({"type": "_returned", "error": error})

        task = asyncio.ensure_future(run())
        await inbox.put({"type": "lifespan.startup"})
        message = await outbox.get()
        if message["type"] == "lifespan.startup.failed":
            raise RuntimeError("Application startup failed: %s" % message.get("message", ""))
        if message["type"] == "lifespan.startup.complete":
            self.lifespan = (task, inbox, outbox)
        elif self.lifespan_mode == "on":
            raise RuntimeError("The app does not support the ASGI lifespan protocol: %r" % (message.get("error"),))

    async def close(self):
        if not self.lifespan:
            return
        task, inbox, outbox = self.lifespan
        self.lifespan = None
        await inbox.put({"type": "lifespan.shutdown"})
        try:
            await asyncio.wait_for(outbox.get(), 5)
        except Exception:
            pass

    # -- requests ----------------------------------------------------------
    def disconnect(self, req_id):
        event = self.disconnects.get(req_id)
        if event is not None:
            event.set()

    async def handle(self, req_id, method, target, headers_json, body, respond):
        exchange = _Exchange(respond)
        headers = json.loads(headers_json)
        payload = body.to_bytes() if body is not None else b""
        try:
            if self.interface == "asgi":
                await self._asgi(req_id, method, target, headers, payload, exchange)
            else:
                self._wsgi(method, target, headers, payload, exchange)
        except ClientDisconnected:
            pass  # the reader hung up: nothing to report
        except BaseException:
            text = traceback.format_exc()
            print(text, file=sys.stderr)
            exchange.fail(text)
        finally:
            self.disconnects.pop(req_id, None)
            exchange.end()

    async def _asgi(self, req_id, method, target, headers, payload, exchange):
        path, _, query = target.partition("?")
        disconnected = asyncio.Event()
        self.disconnects[req_id] = disconnected
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": unquote(path),
            "raw_path": path.encode("latin-1"),
            "query_string": query.encode("latin-1"),
            "root_path": "",
            "headers": [(name.lower().encode("latin-1"), value.encode("latin-1")) for name, value in headers],
            "client": ("127.0.0.1", 0),
            "server": ("localhost", self.port),
            "state": dict(self.state),
        }
        sent_body = False

        async def receive():
            nonlocal sent_body
            if not sent_body:
                sent_body = True
                return {"type": "http.request", "body": payload, "more_body": False}
            await disconnected.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            kind = message["type"]
            if disconnected.is_set():
                raise ClientDisconnected("The client disconnected.")
            if kind == "http.response.start":
                exchange.head(message["status"], message.get("headers", []))
            elif kind == "http.response.body":
                if not exchange.started:
                    raise RuntimeError("The app sent a response body before the response start.")
                waiter = exchange.chunk(message.get("body", b""))
                if not message.get("more_body", False):
                    exchange.end()
                    disconnected.set()
                elif waiter is not None:
                    await waiter

        await self.app(scope, receive, send)
        if not exchange.started:
            raise RuntimeError("The ASGI app returned without sending a response.")

    def _wsgi(self, method, target, headers, payload, exchange):
        path, _, query = target.partition("?")
        environ = {
            "REQUEST_METHOD": method.upper(),
            "SCRIPT_NAME": "",
            "PATH_INFO": unquote_to_bytes(path).decode("latin-1"),
            "QUERY_STRING": query,
            "SERVER_NAME": "localhost",
            "SERVER_PORT": str(self.port),
            "SERVER_PROTOCOL": "HTTP/1.1",
            "REMOTE_ADDR": "127.0.0.1",
            "wsgi.version": (1, 0),
            "wsgi.url_scheme": "http",
            "wsgi.input": io.BytesIO(payload),
            "wsgi.errors": sys.stderr,
            "wsgi.multithread": False,
            "wsgi.multiprocess": False,
            "wsgi.run_once": False,
        }
        for name, value in headers:
            key = name.upper().replace("-", "_")
            if key in ("CONTENT_TYPE", "CONTENT_LENGTH"):
                environ[key] = value
            else:
                key = "HTTP_" + key
                environ[key] = environ[key] + "," + value if key in environ else value
        if payload and "CONTENT_LENGTH" not in environ:
            environ["CONTENT_LENGTH"] = str(len(payload))
        pending = {}

        def start_response(status, response_headers, exc_info=None):
            if exc_info and exchange.started:
                raise exc_info[1].with_traceback(exc_info[2])
            pending["status"] = int(status.split(" ", 1)[0])
            pending["headers"] = list(response_headers)
            return write

        def send_head():
            if not exchange.started:
                exchange.head(pending["status"], pending["headers"])

        def write(data):
            send_head()
            exchange.chunk(data)

        result = self.app(environ, start_response)
        try:
            for data in result:
                if data:
                    send_head()
                    exchange.chunk(data)
            send_head()
        finally:
            close = getattr(result, "close", None)
            if close:
                close()
        exchange.end()


async def start_server(interface, target, port, factory=False, app_dir=None, lifespan="auto"):
    app = load_app(target, factory, app_dir) if isinstance(target, str) else target
    label = target if isinstance(target, str) else getattr(target, "__name__", type(target).__name__)
    server = Server(interface, app, port, label, lifespan)
    await server.startup()
    return server


async def start_requested():
    """The server a program asked for (run_main returned "serve")."""
    request = _requested
    if request is None:
        raise RuntimeError("No app was requested to be served.")
    return await start_server(request.interface, request.app, request.port, request.factory, request.app_dir, request.lifespan)
`,si=String.raw`
import asyncio
import errno as _errno
import io
import socket as _socket

from pyodide.ffi import to_js

try:
    from pyodide.ffi import can_run_sync, run_sync
except ImportError:  # an older Pyodide
    def can_run_sync():
        return False

    def run_sync(awaitable):
        raise RuntimeError("run_sync is unavailable")

_original_socket = _socket.socket
_TIMEOUT = "timeout"


def _transport():
    import _bfwc_tcp

    return _bfwc_tcp


def _bytes(chunk):
    return b"" if chunk is None else chunk.to_bytes()


def _block(awaitable):
    if can_run_sync():
        return run_sync(awaitable)
    raise BlockingIOError(
        "Blocking sockets need JSPI (WebAssembly stack switching), which this browser or call path lacks; "
        "use bfwc.vsocket.open_connection() from asyncio code instead."
    )


def _ms(timeout):
    return None if timeout is None else int(timeout * 1000)


def _refused(host, port, error):
    message = str(error)
    if "timed out" in message:
        return _socket.timeout("timed out connecting to %s:%d" % (host, port))
    return ConnectionRefusedError(_errno.ECONNREFUSED, "Connection refused (%s:%d): %s" % (host, port, message))


class _SocketIO(io.RawIOBase):
    def __init__(self, sock):
        self._sock = sock

    def readable(self):
        return True

    def writable(self):
        return True

    def readinto(self, buffer):
        return self._sock.recv_into(buffer)

    def write(self, data):
        self._sock.sendall(data)
        return len(data)


class VirtualSocket:
    """A stream socket on the virtual network (AF_INET/AF_INET6, SOCK_STREAM)."""

    def __init__(self, family=_socket.AF_INET, type=_socket.SOCK_STREAM, proto=0, fileno=None):
        self.family, self.type, self.proto = family, type, proto
        self._conn = None
        self._peer = None
        self._pending = b""
        self._timeout = _socket.getdefaulttimeout()
        self._read_closed = False
        self._write_closed = False

    # connection
    def connect(self, address):
        host, port = str(address[0]), int(address[1])
        try:
            self._conn = _block(_transport().connect(host, port, _ms(self._timeout)))
        except BlockingIOError:
            raise
        except Exception as error:
            raise _refused(host, port, error) from None
        self._peer = (host, port)

    def connect_ex(self, address):
        try:
            self.connect(address)
            return 0
        except OSError as error:
            return error.errno or _errno.ECONNREFUSED

    def close(self):
        if self._conn is not None:
            _transport().close(self._conn)
            self._conn = None

    def shutdown(self, how):
        self._check()
        if how in (_socket.SHUT_RD, _socket.SHUT_RDWR):
            self._read_closed = True
        if how in (_socket.SHUT_WR, _socket.SHUT_RDWR):
            self._write_closed = True
            # A real half-close when the transport has one; else the peer hears nothing until close().
            _transport().shutdown(self._conn)
        if how == _socket.SHUT_RDWR:
            self.close()

    def detach(self):
        conn, self._conn = self._conn, None
        return -1 if conn is None else conn

    def _check(self):
        if self._conn is None:
            raise OSError(_errno.EBADF, "Bad file descriptor")

    # data
    def sendall(self, data, flags=0):
        self._check()
        if self._write_closed:
            raise BrokenPipeError(_errno.EPIPE, "Broken pipe")
        _block(_transport().send(self._conn, to_js(bytes(data))))

    def send(self, data, flags=0):
        self.sendall(data)
        return len(data)

    def recv(self, bufsize, flags=0):
        self._check()
        if self._read_closed:
            return b""
        if not self._pending:
            chunk = _block(_transport().recv(self._conn, bufsize, _ms(self._timeout)))
            if isinstance(chunk, str) and chunk == _TIMEOUT:
                if self._timeout == 0:
                    raise BlockingIOError(_errno.EAGAIN, "Resource temporarily unavailable")
                raise _socket.timeout("timed out")
            self._pending = _bytes(chunk)
        data, self._pending = self._pending[:bufsize], self._pending[bufsize:]
        return data

    def recv_into(self, buffer, nbytes=0, flags=0):
        view = memoryview(buffer)
        data = self.recv(nbytes or len(view))
        view[: len(data)] = data
        return len(data)

    def makefile(self, mode="r", buffering=None, *, encoding=None, errors=None, newline=None):
        raw = _SocketIO(self)
        if "r" in mode and "w" in mode:
            stream = io.BufferedRWPair(raw, raw)
        elif "w" in mode:
            stream = io.BufferedWriter(raw)
        else:
            stream = io.BufferedReader(raw)
        return stream if "b" in mode else io.TextIOWrapper(stream, encoding=encoding, errors=errors, newline=newline)

    # timeouts: None blocks, 0.0 is non-blocking, t > 0 waits t seconds
    def settimeout(self, value):
        self._timeout = None if value is None else float(value)

    def gettimeout(self):
        return self._timeout

    def setblocking(self, flag):
        self._timeout = None if flag else 0.0

    def getblocking(self):
        return self._timeout != 0.0

    # options, accepted and ignored: there is no kernel socket underneath
    def setsockopt(self, *args):
        pass

    def getsockopt(self, *args):
        return 0

    def getpeername(self):
        return self._peer

    def getsockname(self):
        return ("127.0.0.1", 0)

    def fileno(self):
        return -1

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class _Socket(VirtualSocket):
    """What socket.socket becomes: virtual for TCP, the original for everything else."""

    def __new__(cls, family=_socket.AF_INET, type=_socket.SOCK_STREAM, proto=0, fileno=None):
        if fileno is None and family in (_socket.AF_INET, _socket.AF_INET6) and type & _socket.SOCK_STREAM:
            return super().__new__(cls)
        return _original_socket(family, type, proto, fileno)


def create_connection(address, timeout=_socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None, **kwargs):
    sock = VirtualSocket()
    if timeout is not _socket._GLOBAL_DEFAULT_TIMEOUT:
        sock.settimeout(timeout)
    sock.connect(address)
    return sock


def getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    """One IPv4 stream address for the host as given; the transport decides whether it is reachable (localhost only)."""
    try:
        number = int(port or 0)
    except (TypeError, ValueError):
        number = _socket.getservbyname(port) if isinstance(port, str) else 0
    return [(_socket.AF_INET, _socket.SOCK_STREAM, _socket.IPPROTO_TCP, "", (host or "localhost", number))]


class VirtualStreamReader:
    def __init__(self, conn):
        self._conn = conn
        self._buffer = b""
        self._eof = False

    async def _fill(self, size):
        if self._eof:
            return False
        chunk = _bytes(await _transport().recv(self._conn, size, None))
        if not chunk:
            self._eof = True
            return False
        self._buffer += chunk
        return True

    async def read(self, n=-1):
        if not self._buffer:
            await self._fill(65536 if n < 0 else n)
        if n < 0:
            while await self._fill(65536):
                pass
            n = len(self._buffer)
        data, self._buffer = self._buffer[:n], self._buffer[n:]
        return data

    async def readexactly(self, n):
        while len(self._buffer) < n:
            if not await self._fill(n - len(self._buffer)):
                raise asyncio.IncompleteReadError(self._buffer, n)
        data, self._buffer = self._buffer[:n], self._buffer[n:]
        return data

    async def readline(self):
        while b"\n" not in self._buffer and await self._fill(65536):
            pass
        index = self._buffer.find(b"\n")
        end = len(self._buffer) if index < 0 else index + 1
        data, self._buffer = self._buffer[:end], self._buffer[end:]
        return data

    def at_eof(self):
        return self._eof and not self._buffer


class VirtualStreamWriter:
    def __init__(self, conn):
        self._conn = conn
        self._queued = []
        self._closing = None

    def write(self, data):
        if self._closing is not None:
            raise ConnectionResetError("The writer is closed.")
        self._queued.append(bytes(data))

    async def drain(self):
        while self._queued:
            await _transport().send(self._conn, to_js(self._queued.pop(0)))

    async def _finish(self):
        try:
            await self.drain()
        finally:
            _transport().close(self._conn)

    def close(self):
        """Close once everything written so far is sent."""
        if self._closing is None:
            self._closing = asyncio.ensure_future(self._finish())

    async def wait_closed(self):
        if self._closing is not None:
            await self._closing

    def is_closing(self):
        return self._closing is not None


async def open_connection(host, port):
    try:
        conn = await _transport().connect(str(host), int(port), None)
    except Exception as error:
        raise _refused(str(host), int(port), error) from None
    return VirtualStreamReader(conn), VirtualStreamWriter(conn)


def install():
    """Route TCP sockets to the virtual transport: create_connection (pg8000), socket.socket + getaddrinfo (redis-py)."""
    _socket.create_connection = create_connection
    _socket.socket = _Socket
    _socket.getaddrinfo = getaddrinfo
`,ii=String.raw`
import asyncio
import sys

NO_THREADS = (
    "anyio.from_thread is unavailable in the browser runtime: Pyodide has no threads, "
    "so to_thread work runs inline on the event loop and cannot wait for it. Make the caller async instead."
)


async def _asyncio_to_thread(func, /, *args, **kwargs):
    return func(*args, **kwargs)


async def _anyio_run_sync(func, *args, abandon_on_cancel=False, cancellable=None, limiter=None):
    return func(*args)


def _no_from_thread(*args, **kwargs):
    raise RuntimeError(NO_THREADS)


def install():
    asyncio.to_thread = _asyncio_to_thread
    try:
        import anyio.to_thread
        import anyio.from_thread
    except ImportError:
        return
    anyio.to_thread.run_sync = _anyio_run_sync
    anyio.from_thread.run = _no_from_thread
    anyio.from_thread.run_sync = _no_from_thread
`,oi=String.raw`
import os

ARTIFACT_DIR = ${JSON.stringify(Xe)}


def _control():
    try:
        import _bfwc_training
    except ImportError:
        raise RuntimeError("bfwc.training: this process is not a training service") from None
    return _bfwc_training


def _wait(awaitable):
    try:
        from pyodide.ffi import can_run_sync, run_sync
    except ImportError:
        return None
    if can_run_sync():
        return run_sync(awaitable)
    return None


def artifact_dir(*parts):
    """A directory under the artifact root (created); its files outlive the run, outside the project."""
    path = os.path.normpath(os.path.join(ARTIFACT_DIR, *parts))
    if path != ARTIFACT_DIR and not path.startswith(ARTIFACT_DIR + "/"):
        raise ValueError("bfwc.training.artifact_dir: %r is outside %s" % (os.path.join(*parts) if parts else "", ARTIFACT_DIR))
    os.makedirs(path, exist_ok=True)
    return path


def log(step, loss=None, **metrics):
    """One metrics line: step=<n> loss=<x> name=value ..."""
    fields = ["step=%d" % int(step)]
    if loss is not None:
        fields.append("loss=%.6g" % float(loss))
    fields += ["%s=%s" % (name, value) for name, value in metrics.items()]
    print(" ".join(fields), flush=True)


def checkpoint_requested():
    """True once the runtime asked this run to checkpoint (it is stopping): save, then exit."""
    control = _control()
    if control.should_yield():
        _wait(control.tick())
    return bool(control.checkpoint_requested())


def save():
    """Replace the kept artifacts with the artifact directory now (also done at exit).

    Returns True once the page confirmed it committed the save. Returns False
    when the save was sent but is not confirmed: this Python has no JSPI
    (pyodide.ffi.run_sync) to wait for the page, the page does not acknowledge
    saves (a failure is then not raised here), or a newer save replaced it in
    the page's queue. Raises RuntimeError when the page refused or failed it.
    """
    result = _wait(_control().save())
    if result is None:
        return False
    if result.error:
        raise RuntimeError("bfwc.training.save: " + str(result.error))
    return bool(result.confirmed)
`,ai=String.raw`
"""The browser runtime's uvicorn: run() serves the app on a virtual port, request-driven."""
from bfwc.serve import ServeRequested

__version__ = "0.0.0+bfwc"


class Config:
    def __init__(self, app, host="127.0.0.1", port=8000, factory=False, interface="auto", app_dir=None, lifespan="auto", **kwargs):
        if interface == "asgi2":
            raise ValueError("ASGI 2 (double-callable) apps are not supported by the browser runtime; use an ASGI 3 app.")
        self.app = app
        self.host = host
        self.port = int(port)
        self.factory = factory
        self.interface = "wsgi" if interface == "wsgi" else "asgi"
        self.app_dir = app_dir
        self.lifespan = lifespan


class Server:
    def __init__(self, config):
        self.config = config
        self.should_exit = False

    def run(self, sockets=None):
        config = self.config
        raise ServeRequested(config.interface, config.app, config.port, config.factory, config.app_dir, config.lifespan)

    async def serve(self, sockets=None):
        self.run(sockets)


def run(app, *, host="127.0.0.1", port=8000, factory=False, interface="auto", app_dir=None, lifespan="auto", **kwargs):
    Server(Config(app, host=host, port=port, factory=factory, interface=interface, app_dir=app_dir, lifespan=lifespan)).run()


def main():
    raise SystemExit("Run uvicorn from the command line (uvicorn module:app); the runtime reads that command line itself.")
`,ci=String.raw`
class UvicornWorker:
    """Named by gunicorn's -k option; the runtime reads it from the command line and serves ASGI."""
`,li=String.raw`
"""The browser runtime serves WSGI apps itself; gunicorn is importable but never runs."""
__version__ = "0.0.0+bfwc"
version_info = (0, 0, 0)
`,je="/opt/bfwc",ui={"bfwc/__init__.py":"","bfwc/run.py":ni,"bfwc/serve.py":ri,"bfwc/threads.py":ii,"bfwc/training.py":oi,"bfwc/vsocket.py":si,"uvicorn/__init__.py":ai,"uvicorn/workers.py":ci,"gunicorn/__init__.py":li};function di(e){for(const[t,n]of Object.entries(ui)){const r=`${je}/${t}`;e.FS.mkdirTree(r.slice(0,r.lastIndexOf("/"))),e.FS.writeFile(r,n)}e.runPython(`import sys
if ${JSON.stringify(je)} not in sys.path: sys.path.insert(0, ${JSON.stringify(je)})`)}const fi=new TextDecoder;function wt(e,t){return n=>{const r=z(t,n);if(!(!e.FS.analyzePath(r).exists||e.FS.isDir(e.FS.stat(r).mode)))return fi.decode(e.FS.readFile(r))}}const Pn=e=>e.map(yr).filter(t=>!!t),On=e=>[e.PIP_INDEX_URL,...(e.PIP_EXTRA_INDEX_URL??"").split(/\s+/)].filter(t=>!!t);async function Fe(e,t,n,r){const s=e.toPy({kind:t,target:n,argv:[...r]});try{const i=await e.runPythonAsync(`from bfwc.run import run_main
run_main(kind, target, argv)`,{globals:s});return i==="serve"?"serve":typeof i=="number"?i:0}finally{s.destroy?.()}}async function jt(e,t,n){if(t)try{const r=e.pyimport("pyodide.code").find_imports,s=r(t),i=s.toJs?.()??[];s.destroy?.();const o=i.filter(a=>!n.provided.imports.has(a.split(".")[0]));if(!o.length)return;await e.loadPackagesFromImports(o.map(a=>`import ${a}`).join(`
`),{messageCallback:()=>{},errorCallback:a=>n.io.stderr(`${a}
`)})}catch(r){n.io.stderr(`${r instanceof Error?r.message:String(r)}
`)}}async function pi(e,t,n){const r=o=>n.io.stderr(`${o}
`),s=o=>o.declined.forEach(({reason:a})=>r(`Declined: ${a}`));for(const o of n.installs)try{s(await Ze(e,Pn(o.specs),{indexUrls:o.indexUrls,log:r,provided:n.provided.packages}))}catch(a){r(`Warning: could not repeat this session's earlier pip install of ${o.specs.join(" ")}: ${a instanceof Error?a.message.trim().split(`
`).pop():String(a)}`)}const i=un(wt(e,n.cwd),t);i.length&&s(await Ze(e,i,{indexUrls:On(n.env),log:r,provided:n.provided.packages})),e.pyimport("bfwc.threads").install()}async function $i(e,t,n){const r=wt(e,n.cwd),s=t.projects.flatMap(l=>{const u=z(n.cwd,l),d=un(r,u);return d.length||n.io.stderr(`${l}: no dependencies declared (pyproject.toml [project] dependencies or requirements.txt); its own code runs from the project directory as is.
`),d}),i=[...Pn(t.packages),...t.files.flatMap(l=>_r(r,z(n.cwd,l))),...s],o=[...t.indexUrls,...On(n.env)],a=await Ze(e,i,{indexUrls:o,log:l=>n.io.stderr(`${l}
`),provided:n.provided.packages});for(const l of Us(a))(l.startsWith("Declined")?n.io.stderr:n.io.stdout)(`${l}
`);const c=i.filter(l=>a.installed.includes(l.name)).map(l=>l.spec);return c.length&&n.io.installed?.({specs:c,indexUrls:o}),a.declined.length?1:0}async function hi(e,t,n){const r=a=>({kind:"exited",code:a});if(t.kind==="install")return e.pyimport("bfwc.threads").install(),r(await $i(e,t,n));const s=t.kind==="serve"&&t.server.appDir?z(n.cwd,t.server.appDir):n.cwd;if(await pi(e,s,n),t.kind==="serve")return{kind:"serving",server:await ei(e,t.server)};const i=wt(e,n.cwd);let o;return t.kind==="script"?(await jt(e,i(t.path),n),o=await Fe(e,"script",t.path,t.argv)):t.kind==="code"?(await jt(e,t.code,n),o=await Fe(e,"code",t.code,t.argv)):o=await Fe(e,"module",t.module,t.argv),o==="serve"?{kind:"serving",server:await ti(e)}:r(o)}const Rn=64*1024;class mi{channel;highWaterMark;queue=[];unacked=0;ended=!1;constructor(t,n,r=Rn){this.channel=t,this.highWaterMark=r,t.manualFlowControl(),t.onData(s=>{this.queue.push(s),n()}),t.onConsumed(s=>{this.unacked=Math.max(0,this.unacked-s),this.unacked<=this.highWaterMark&&n()}),t.onClose(()=>{this.ended=!0,n()})}get writable(){return this.unacked<=this.highWaterMark}tryRecv(t){const n=this.queue.shift();if(!n)return this.ended?null:void 0;const r=n.byteLength>t?n.subarray(0,t):n;return r!==n&&this.queue.unshift(n.subarray(t)),this.channel.closed||this.channel.consumed(r.byteLength),r}send(t){this.channel.send(t),this.unacked+=t.byteLength}close(){this.ended=!0,this.queue.length=0,this.channel.close()}}const gi=new Set(["localhost","127.0.0.1","::1","0.0.0.0",""]),Ft=e=>{const t=e.wakeReader;e.wakeReader=void 0,t?.();for(const n of e.wakeSenders.splice(0))n()};function _i(e,t=Rn){const n=new Map;let r=1;const s=i=>{const o=n.get(i);if(!o)throw new Error(`Bad file descriptor: connection ${i} is closed.`);return o};return{async connect(i,o){if(!gi.has(i.toLowerCase()))throw new Error(`connect ECONNREFUSED ${i}:${o} (only localhost is reachable in the browser runtime)`);const a=await e(o);if(!a)throw new Error(`connect ECONNREFUSED ${i}:${o}`);const c=r++,l={wakeSenders:[]},u=Object.assign(l,{endpoint:new mi(a,()=>Ft(l),t)});return n.set(c,u),c},async send(i,o){const a=s(i),{endpoint:c}=a;if(c.ended)throw new Error("Broken pipe: the connection is closed.");for(c.send(o);!c.writable&&!c.ended;)await new Promise(l=>a.wakeSenders.push(l))},async recv(i,o){const a=s(i);for(;;){const c=a.endpoint.tryRecv(o);if(c!==void 0)return c;await new Promise(l=>a.wakeReader=l)}},close(i){const o=n.get(i);o&&(o.endpoint.close(),Ft(o),n.delete(i))}}}function yi(e){const t=ht(e);return{transport:_i(n=>t.dial(n)),receive:n=>t.receive(n)}}const wi="_bfwc_tcp",Pe="timeout",Gt=e=>new Promise(t=>setTimeout(()=>t(Pe),e));function bi(e){const t=new Map;return{async connect(n,r,s){const i=e.connect(n,r);if(s==null)return i;const o=await Promise.race([i,Gt(s)]);if(o===Pe)throw i.then(a=>e.close(a),()=>{}),new Error("timed out");return o},send:(n,r)=>Promise.resolve(e.send(n,r.slice())),async recv(n,r,s){const i=t.get(n)??e.recv(n,r);t.set(n,i);const o=s==null?await i:await Promise.race([i,Gt(s)]);return o===Pe?Pe:(t.delete(n),o??void 0)},shutdown:n=>e.shutdown?.(n),close(n){t.delete(n),e.close(n)}}}function vi(e,t){e.registerJsModule(wi,bi(t)),e.runPython(`import bfwc.vsocket
bfwc.vsocket.install()`)}const Ei="_bfwc_training",Si=50,ki=12e4;function*Nn(e,t,n=""){for(const r of e.readdir(t)){if(r==="."||r==="..")continue;const s=`${t}/${r}`,i=n?`${n}/${r}`:r,{mode:o}=e.lstat(s);e.isLink(o)||(e.isDir(o)?yield*Nn(e,s,i):e.isFile(o)&&(yield[i,s]))}}const Ti=e=>e.analyzePath(Xe).exists?[...Nn(e,Xe)]:[];function Pi(e){let t=!1,n,r=0,s=0;const i=new Map;async function o(a=!1){if(!n)return{ok:!1,error:"Not a training process.",confirmed:!1};const{py:c,options:l}=n,u=++r;let d;try{if(d=Ti(c.FS),a&&d.length===0)return{ok:!0,confirmed:!1};for(const[m,p]of d){const f=c.FS.readFile(p);e({type:"training-artifact",saveId:u,path:m,bytes:f},[f.buffer])}}catch(m){return{ok:!1,error:`Could not read the artifacts: ${m instanceof Error?m.message:String(m)}`,confirmed:!1}}const $=l.acks?new Promise(m=>{i.set(u,m),setTimeout(()=>i.get(u)===m&&(i.delete(u),m({ok:!1,error:"The page did not acknowledge the save.",confirmed:!1})),ki)}):void 0;return e({type:"training-saved",saveId:u,files:d.length}),$??{ok:!0,confirmed:!1}}return{receive(a){return Jr(a)?a.type==="checkpoint"?(t=!0,!0):(i.get(a.saveId)?.(a.superseded?{ok:!0,confirmed:!1,superseded:!0}:{ok:a.ok,error:a.error,confirmed:a.ok}),i.delete(a.saveId),!0):!1},install(a,c){n={py:a,options:c,cell:c.flag?new Int32Array(c.flag):void 0};const l=n.cell;a.registerJsModule(Ei,{checkpoint_requested:()=>t||l!==void 0&&Atomics.load(l,0)!==0,should_yield:()=>{if(l||t)return!1;const u=Date.now();return u-s<Si?!1:(s=u,!0)},tick:()=>new Promise(u=>setTimeout(u,0)),save:()=>o().then(u=>({error:u.ok?"":u.error??"The save failed.",confirmed:u.confirmed}))})},async saveAtExit(a){if(!n)return;const c=await o(!0);c.ok||a(`bfwc.training: the artifacts were not saved: ${c.error??"unknown error"}
`)}}}const Oi=e=>`[Errno 98] error while attempting to bind on address ('0.0.0.0', ${e}): address already in use
`,Ri=e=>/fatal error/i.test(e instanceof Error?e.message:String(e));function fc(e){const t=[],n=new TextDecoder,r=e.tcp?void 0:yi(e.post),s=e.tcp??r.transport,i=Pi((a,c)=>e.post(a,c)),o=a=>t.push(...a.split(/(?<=\n)/).filter(Boolean));return yt(e.post,a=>{async function c(u,d){const $={...u.env,PYTHONDONTWRITEBYTECODE:"1",PYTHONUNBUFFERED:"1",PWD:_e(u.cwd)},m=await e.loadPyodide({indexURL:u.python?.indexURL,env:$}),p=k=>({write:C=>(a.io[k](C.slice()),C.length),isatty:!1});m.setStdout(p("stdout")),m.setStderr(p("stderr")),m.setStdin({stdin:()=>t.shift()??null,isatty:!1}),di(m),vi(m,s);const f=u.python?.training;f&&i.install(m,f);const _=await Js(m,u.python?.extensions??[],e.importModule??kn);Hs(d,m.FS);const h=Qs(m.FS,k=>{a.exited||e.post({type:"fs",ops:k})});a.mounted({apply:k=>h.quietly(()=>Ws(m.FS,k)),flush:()=>h.flush()});const w=m.pyimport("bfwc.run").bootstrap,b=m.toPy($);try{w(b,_e(u.cwd))}finally{b.destroy?.()}return{py:m,provided:_}}async function l(u,d,$){const{py:m,provided:p}=await c(u,$);if(a.exited)return{kind:"exited",code:0};const f=await hi(m,d,{cwd:_e(u.cwd),env:u.env,io:{stdout:a.io.stdout,stderr:a.io.stderr,installed:h=>e.post({type:"python-installed",...h})},installs:u.python?.installs??[],provided:p});if(f.kind==="exited")return i.saveAtExit(a.io.stderr).then(()=>f);const _=f.server;return{kind:"serving",server:{port:_.spec.port,handle:Ni(_,a),close:()=>_.close()},banner:`Serving ${_.spec.interface.toUpperCase()} app ${_.spec.app} on http://localhost:${_.spec.port} (request-driven)
`}}return{addressInUse:Oi,plan(u){const d=wr(u.command,u.args,u.env);if(!d.ok)return{ok:!1,message:`${u.command}: ${d.reason}
`,code:2};const $=br(d.invocation,_e);return{ok:!0,port:$.kind==="serve"?$.server.port:void 0,run:m=>l(u,$,m)}},stdin:u=>o(u===null?n.decode():typeof u=="string"?u:n.decode(u,{stream:!0})),receive:u=>i.receive(u)||!!r?.receive(u)}})}function Ni(e,t){return n=>e.handle(n).catch(r=>{throw Ri(r)&&(t.io.stderr(`${r instanceof Error?r.message:String(r)}
`),t.exit(1)),r})}const Ai=3,Ci=64,Ii=512;function xi(e){return typeof e=="string"?/[wa+]/.test(e):(e&Ai)!==0||(e&(Ci|Ii))!==0}function An(e,t){const{tracker:n,events:r}=Sn(e,t),s=o=>En(e,o),i={open:e.open,write:e.write,close:e.close,mkdir:e.mkdir,unlink:e.unlink,rmdir:e.rmdir,rename:e.rename,symlink:e.symlink};return e.open=function(o,a,c){const l=i.open.call(this,o,a,c);return xi(a)&&l.path&&r.openedForWrite(l.path),l},e.write=function(o,...a){const c=i.write.call(this,o,...a);return o.path&&r.written(o.path),c},e.close=function(o){const a=o.path;i.close.call(this,o),a&&r.closed(a)},e.mkdir=function(o,a){const c=i.mkdir.call(this,o,a);return r.madeDirectory(s(o)),c},e.unlink=function(o){i.unlink.call(this,o),r.deleted(s(o))},e.rmdir=function(o){i.rmdir.call(this,o),r.deleted(s(o))},e.rename=function(o,a){i.rename.call(this,o,a),r.moved(s(o),s(a))},e.symlink=function(o,a){const c=i.symlink.call(this,o,a);return r.symlinked(s(a)),c},n}const tt=e=>`'${e.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;function ie(e,t){return e==null?"null":typeof e=="boolean"||typeof e=="number"?JSON.stringify(e):typeof e=="string"?t?.(e)??tt(e):Array.isArray(e)?`[${e.map(n=>ie(n,t)).join(", ")}]`:`[${Object.entries(e).map(([n,r])=>`${ie(n)} => ${ie(r,t)}`).join(", ")}]`}const Di=String.raw`<?php
// Generated by the BuilderForce WebContainers PHP runtime (composer install).
require_once __DIR__ . '/composer/ClassLoader.php';
require_once __DIR__ . '/composer/InstalledVersions.php';
return \Composer\Autoload\ClassLoader::bfwcBoot(require __DIR__ . '/composer/autoload_bfwc.php');
`,Li=String.raw`<?php
namespace Composer\Autoload;

class ClassLoader
{
    private array $psr4 = [];
    private array $psr0 = [];
    private array $classMap = [];
    private static ?self $booted = null;

    /** @internal The generated maps, registered once; their files required once. */
    public static function bfwcBoot(array $maps): self
    {
        if (self::$booted) {
            return self::$booted;
        }
        $loader = new self();
        foreach ($maps['psr4'] as $prefix => $paths) {
            $loader->addPsr4($prefix, $paths);
        }
        foreach ($maps['psr0'] as $prefix => $paths) {
            $loader->add($prefix, $paths);
        }
        $loader->addClassMap($maps['classmap']);
        $loader->register(true);
        self::$booted = $loader;
        foreach ($maps['files'] as $file) {
            require_once $file;
        }
        return $loader;
    }

    public function addPsr4(string $prefix, array|string $paths, bool $prepend = false): void
    {
        $existing = $this->psr4[$prefix] ?? [];
        $this->psr4[$prefix] = $prepend ? array_merge((array) $paths, $existing) : array_merge($existing, (array) $paths);
        krsort($this->psr4);
    }

    public function setPsr4(string $prefix, array|string $paths): void
    {
        $this->psr4[$prefix] = (array) $paths;
        krsort($this->psr4);
    }

    public function add(string $prefix, array|string $paths, bool $prepend = false): void
    {
        $existing = $this->psr0[$prefix] ?? [];
        $this->psr0[$prefix] = $prepend ? array_merge((array) $paths, $existing) : array_merge($existing, (array) $paths);
    }

    public function addClassMap(array $classMap): void
    {
        $this->classMap = array_merge($this->classMap, $classMap);
    }

    public function getPrefixesPsr4(): array
    {
        return $this->psr4;
    }

    public function getPrefixes(): array
    {
        return $this->psr0;
    }

    public function getClassMap(): array
    {
        return $this->classMap;
    }

    public function register(bool $prepend = false): void
    {
        spl_autoload_register([$this, 'loadClass'], true, $prepend);
    }

    public function unregister(): void
    {
        spl_autoload_unregister([$this, 'loadClass']);
    }

    public function loadClass(string $class): ?bool
    {
        $file = $this->findFile($class);
        if ($file === false) {
            return null;
        }
        (static function (string $file) {
            include $file;
        })($file);
        return true;
    }

    public function findFile(string $class): string|false
    {
        if (isset($this->classMap[$class])) {
            return $this->classMap[$class];
        }
        $relative = strtr($class, '\\', '/') . '.php';
        foreach ($this->psr4 as $prefix => $dirs) {
            if (str_starts_with($class, $prefix)) {
                foreach ($dirs as $dir) {
                    $file = rtrim($dir, '/') . '/' . substr($relative, strlen($prefix));
                    if (is_file($file)) {
                        return $file;
                    }
                }
            }
        }
        $position = strrpos($class, '\\');
        $psr0 = $position === false ? strtr($class, '_', '/') . '.php' : strtr(substr($class, 0, $position + 1), '\\', '/') . strtr(substr($class, $position + 1), '_', '/') . '.php';
        foreach ($this->psr0 as $prefix => $dirs) {
            if ($prefix === '' || str_starts_with($class, $prefix)) {
                foreach ($dirs as $dir) {
                    if (is_file($file = rtrim($dir, '/') . '/' . $psr0)) {
                        return $file;
                    }
                }
            }
        }
        return false;
    }

    public static function getRegisteredLoaders(): array
    {
        return self::$booted ? [dirname(__DIR__) => self::$booted] : [];
    }
}
`,qi=String.raw`<?php
namespace Composer;

class InstalledVersions
{
    private static ?array $installed = null;

    private static function data(): array
    {
        return self::$installed ??= require __DIR__ . '/installed.php';
    }

    public static function getInstalledPackages(): array
    {
        return array_keys(self::data()['versions']);
    }

    public static function isInstalled(string $packageName, bool $includeDevRequirements = true): bool
    {
        $entry = self::data()['versions'][$packageName] ?? null;
        return $entry !== null && ($includeDevRequirements || !$entry['dev_requirement']);
    }

    public static function getVersion(string $packageName): ?string
    {
        return self::entry($packageName)['version'] ?? null;
    }

    public static function getPrettyVersion(string $packageName): ?string
    {
        return self::entry($packageName)['pretty_version'] ?? null;
    }

    public static function getReference(string $packageName): ?string
    {
        return self::entry($packageName)['reference'] ?? null;
    }

    public static function getInstallPath(string $packageName): ?string
    {
        return self::entry($packageName)['install_path'] ?? null;
    }

    public static function getRootPackage(): array
    {
        return self::data()['root'];
    }

    public static function getRawData(): array
    {
        return self::data();
    }

    private static function entry(string $packageName): array
    {
        $entry = self::data()['versions'][$packageName] ?? null;
        if ($entry === null) {
            throw new \OutOfBoundsException('Package "' . $packageName . '" is not installed');
        }
        return $entry;
    }
}
`,Mi=/^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z_\x80-￿][A-Za-z0-9_\x80-￿]*)/gm,Ui=/^\s*namespace\s+([A-Za-z_\\][A-Za-z0-9_\\]*)\s*[;{]/m;function ji(e){const t=e.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*(\/\/|#).*$/gm,""),n=Ui.exec(t)?.[1];return[...t.matchAll(Mi)].map(r=>n?`${n}\\${r[2]}`:r[2])}function Ge(e,t,n,r,s){if(!s)return;const i=a=>x(n,r,a);for(const[a,c]of Object.entries(s["psr-4"]??{}))(e.psr4[a]??=[]).push(...[c].flat().map(i));for(const[a,c]of Object.entries(s["psr-0"]??{}))(e.psr0[a]??=[]).push(...[c].flat().map(i));for(const a of s.files??[])e.files.push(i(a));const o=(s["exclude-from-classmap"]??[]).map(i);for(const a of s.classmap??[]){const c=i(a),l=t.isDir(c)?t.list(c).filter(u=>/\.(php|inc|hh)$/.test(u)):[c];for(const u of l)if(!o.some(d=>u.startsWith(d)))for(const d of ji(t.read(u)??""))e.classmap[d]??=u}}const Fi=e=>t=>t===e||t.startsWith(`${e}/`)?`$baseDir . ${ie(t.slice(e.length))}`:void 0;function Gi(e){const t=new Map(e.map(i=>[i.name.toLowerCase(),i])),n=new Set,r=[],s=(i,o)=>{const a=i.name.toLowerCase();if(!(n.has(a)||o.has(a))){o.add(a);for(const c of Object.keys(i.require??{}).sort()){const l=t.get(c.toLowerCase());l&&s(l,o)}o.delete(a),n.add(a),r.push(i)}};for(const i of[...e].sort((o,a)=>o.name.localeCompare(a.name)))s(i,new Set);return r}function Bt(e,t,n,r,s){const i={psr4:{},psr0:{},classmap:{},files:[]};Ge(i,e,t,"",n.autoload),s.dev&&Ge(i,e,t,"",n["autoload-dev"]);const o=i.files.splice(0);for(const d of Gi(r))Ge(i,e,t,`vendor/${d.name}`,d.autoload);i.files.push(...o);const a=x(t,"vendor"),c=Fi(t);e.write(x(a,"autoload.php"),Di),e.write(x(a,"composer/ClassLoader.php"),Li),e.write(x(a,"composer/InstalledVersions.php"),qi),e.write(x(a,"composer/autoload_bfwc.php"),`<?php
// Generated by the BuilderForce WebContainers PHP runtime.
$baseDir = dirname(__DIR__, 2);
return ${ie(i,c)};
`),e.write(x(a,"composer/installed.json"),`${JSON.stringify({packages:r,dev:s.dev,"dev-package-names":[...s.devPackages]},null,4)}
`);const l=Object.fromEntries(r.map(d=>[d.name,{pretty_version:d.version,version:d.version_normalized??d.version,reference:d.dist?.reference??d.source?.reference??null,type:d.type??"library",install_path:x(a,d.name),aliases:[],dev_requirement:s.devPackages.has(d.name)}])),u={name:n.name??"__root__",pretty_version:n.version??"dev-main",version:n.version??"dev-main",reference:null,type:"project",install_path:t,aliases:[],dev:s.dev};e.write(x(a,"composer/installed.php"),`<?php
$baseDir = dirname(__DIR__, 2);
return ${ie({root:u,versions:{...l,[u.name]:{...u,dev_requirement:!1}}},c)};
`)}const Bi=/^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]?|-{0,2})[a-z0-9]+)*$/;class bt extends Error{}const Cn=e=>Bi.test(e)&&!In(e),In=e=>e.split("/").some(t=>t==="."||t===".."||t===""),vt=(e,t)=>new bt(`Invalid package name "${e}" in ${t}: Composer names are vendor/package, lower-case letters, digits and [_.-] separators.`);function ae(e,t){const n=e.toLowerCase();if(Oe(n)||Cn(n))return n;throw vt(e,t)}function nt(e,t){const n=typeof e=="string"?e.toLowerCase():"";if(Cn(n))return n;throw vt(String(e),t)}function Be(e,t){return x(e,"vendor",nt(t,"a vendor path"))}function Hi(e){if(In(e))throw vt(e,"a repository URL");return e.split("/").map(encodeURIComponent).join("/")}function Wi(e){const n=(Array.isArray(e.repositories)?e.repositories:Object.entries(e.repositories??{}).map(([r,s])=>s===!1?{type:`${r}: false`}:s)).map(r=>r).filter(r=>!(r?.type==="composer"&&typeof r.url=="string"&&/^https:\/\/(repo\.)?packagist\.org\/?$/.test(r.url))).map(r=>typeof r?.type=="string"?r.type:"unknown");if(n.length)return`composer.json declares repositories of type ${[...new Set(n)].join(", ")}, which the PHP runtime does not support (it installs from Packagist, or the host's php.composer.repositoryUrl, only).`}function Ht(e){const t=[];for(const n of e){const r=/^([^:=\s]+)[:=](.+)$/.exec(n);r?t.push({name:ae(r[1],"composer require"),constraint:r[2]}):!n.includes("/")&&t.length&&t[t.length-1].constraint===void 0?t[t.length-1].constraint=n:t.push({name:ae(n,"composer require")})}return t}function Vi(e,t){const n=new Map;for(const i of t.values())for(const o of[...Object.keys(i.replace??{}),...Object.keys(i.provide??{})])n.set(o.toLowerCase(),i.name);const r=new Set,s=Object.keys(e.require??{}).map(i=>i.toLowerCase());for(;s.length;){const i=s.shift(),o=t.get(i)??t.get(n.get(i)??"");!o||r.has(o.name)||(r.add(o.name),s.push(...Object.keys(o.require??{}).map(a=>a.toLowerCase())))}return r}function zi(e,t){return`${JSON.stringify({_readme:["This file locks the dependencies of your project to a known state","Written by the BuilderForce WebContainers PHP runtime"],...e,aliases:[],"minimum-stability":t.minimumStability,"stability-flags":{},"prefer-stable":t.preferStable,"prefer-lowest":!1,platform:{},"platform-dev":{},"plugin-api-version":"2.6.0"},null,4)}
`}class Z extends Error{}const rt=e=>dt(e.version_normalized??e.version),Wt=e=>Object.entries(e.require??{}).map(([t,n])=>({name:ae(t,`${e.name}'s require`),constraint:n,from:e.name})),Vt=e=>[...Object.keys(e.replace??{}),...Object.keys(e.provide??{})].map(t=>t.toLowerCase());function zt(e,t,n){return xn(e,t,n)[0]}function xn(e,t,n,r){const s=t.reduce((c,l)=>l.stability&&Nt({stability:c},l.stability)?l.stability:c,n.minimumStability),i=e.map(c=>({pkg:c,version:rt(c)})).filter(c=>!!c.version&&Nt(c.version,s)&&t.every(l=>l.test(c.version))).sort((c,l)=>vr(l.version,c.version)),o=n.preferStable?[...i.filter(c=>c.version.stability==="stable"),...i.filter(c=>c.version.stability!=="stable")]:i,a=r===void 0?-1:o.findIndex(c=>c.pkg.version===r);return a>0&&o.unshift(...o.splice(a,1)),o.map(c=>c.pkg)}function Qt(e,t){return t.map(n=>{const r=fn(n.constraint);if(!r)throw new Z(`Cannot read the version constraint "${n.constraint}" on ${e} (required by ${n.from}).`);return r})}async function Qi(e,t,n,r={}){const s=new Set(Vt(r)),i={steps:n.maxSteps??2e4};let o="",a=-1;const c=(p,f)=>{p>=a&&(o=f,a=p)},l=new Map,u=async p=>(l.has(p)||l.set(p,await t.versions(p)),l.get(p)),d=p=>{const f=[{from:"root",conflict:r.conflict},...[...p.values()].map(_=>({from:_.name,conflict:_.conflict}))];for(const{from:_,conflict:h}of f)for(const[w,b]of Object.entries(h??{})){const k=w.toLowerCase(),C=fn(b),S=p.get(k),v=S&&rt(S);if(v&&C?.test(v))return`${_} conflicts with ${S.name} ${b}`;for(const P of p.values()){const O={...P.provide,...P.replace},q=Object.entries(O).find(([A])=>A.toLowerCase()===k)?.[1];if(q===void 0)continue;const E=dt(q==="self.version"?P.version_normalized??P.version:q.replace(/^[=\s]+/,""));if(E&&C?.test(E))return`${_} conflicts with ${k} ${b} (${P.name} ${q==="self.version"?"replaces/provides it":`provides ${q}`})`}}},$=async p=>{if(--i.steps<0)throw new Z("Dependency resolution took too long; pin the conflicting packages in composer.json.");const f=new Map;for(const S of[...e,...[...p.values()].flatMap(Wt)])Oe(S.name)||f.set(S.name,[...f.get(S.name)??[],S]);const _=new Set([...s,...[...p.values()].flatMap(Vt)]);for(const[S,v]of p){const P=f.get(S)??[],O=rt(v),q=Qt(S,P),E=P.find((A,U)=>!q[U].test(O));if(E){c(p.size,`${S} ${v.version} was chosen, but ${E.from} requires ${S} ${E.constraint}.`);return}}const h=d(p);if(h){c(p.size,`${h}.`);return}const w=[...f.keys()].filter(S=>!p.has(S)&&!_.has(S));let b;for(const S of w)if(await u(S)){b=S;break}if(b===void 0){if(!w.length)return p;const S=w[0];c(p.size,`Package ${S} (required by ${f.get(S).map(v=>v.from).join(", ")}) was not found in the repository, and no chosen package provides or replaces it.`);return}const k=f.get(b),C=xn(await u(b),Qt(b,k),n,n.preferred?.get(b));if(!C.length){c(p.size,`No version of ${b} satisfies ${k.map(S=>`${S.constraint} (required by ${S.from})`).join(" and ")} at minimum-stability ${n.minimumStability}.`);return}for(const S of C){const v=n.platform&&Object.entries(S.require??{}).map(([O,q])=>Oe(O.toLowerCase())?dn(O,q,n.platform):void 0).find(Boolean);if(v){c(p.size,`${S.name} ${S.version} is declined: ${v}`);continue}try{Wt(S)}catch(O){if(!(O instanceof bt))throw O;c(p.size,`${S.name} ${S.version} is skipped: ${O.message}`);continue}const P=await $(new Map([...p,[b,S]]));if(P)return P}},m=await $(new Map);if(!m)throw new Z(o||"No installable set of packages satisfies composer.json.");return{packages:m}}function Yi(e,t){return[...Object.entries(e.require??{}),...t?[]:Object.entries(e["require-dev"]??{})].map(([r,s])=>({name:r.toLowerCase(),constraint:s,from:"root"}))}class ne extends Error{}const Ki=["pre-install-cmd","post-install-cmd","pre-update-cmd","post-update-cmd","post-autoload-dump","post-root-package-install","post-create-project-cmd"],ye=(e,t)=>{try{return JSON.parse(e)}catch(n){throw new ne(`${t} does not contain valid JSON: ${n instanceof Error?n.message:String(n)}`)}};function He(e,t,n,r){return[...Object.entries({...e.require,...n?e["require-dev"]:{}}).map(([o,a])=>({name:o,constraint:a,from:"your project"})),...t.flatMap(o=>Object.entries(o.require??{}).map(([a,c])=>({name:a,constraint:c,from:o.name})))].flatMap(({name:o,constraint:a,from:c})=>{const l=Oe(o.toLowerCase())?dn(o,a,r):void 0;return l?[`${c} requires ${o} ${a}: ${l}`]:[]})}async function Ji(e,t){const{files:n,projectDir:r}=t,s=x(r,"composer.json"),i=x(r,"composer.lock"),o=x(r,"vendor/composer/installed.json"),a=n.read(s),c=n.read(i),l=!e.noDev;try{if(a===void 0&&e.command!=="require")throw new ne(`Composer could not find a composer.json file in ${r}`);const u=ye(a??"{}",s),d=Wi(u);if(d)throw new ne(d);for(const E of["require","require-dev","replace","provide","conflict"])for(const A of Object.keys(u[E]??{}))ae(A,`composer.json ${E}`);const m=(()=>{const E=n.read(o);if(E===void 0)return{packages:[],devNames:[]};const A=ye(E,o);for(const U of A.packages??[])nt(U.name,o);return{packages:A.packages??[],devNames:A["dev-package-names"]??[]}})();if(e.command==="dump-autoload"){const{packages:E,devNames:A}=m,U=new Set(A);return Bt(n,r,u,l?E:E.filter(L=>!U.has(L.name)),{dev:l,devPackages:l?U:new Set}),t.out(`Generating autoload files
Generated autoload files
`),0}const p={minimumStability:Er(u["minimum-stability"]),preferStable:!!u["prefer-stable"]};if(e.command==="require"){const E=e.dev?"require-dev":"require";for(const{name:A,constraint:U}of Ht(e.packages)){let L=U;if(!L){const y=await t.source.versions(A),R=y?.filter(G=>e.ignorePlatformReqs||!He({},[G],!1,t.platform).length),T=R&&zt(R,[],p),M=!T&&y&&zt(y,[],p);if(M)throw new Z(`${M.name} ${M.version} is declined: ${He({},[M],!1,t.platform).join("; ")}`);const I=T&&dt(T.version_normalized??T.version);if(!I||I.branch)throw new Z(`Could not find a stable version of package ${A}.`);L=`^${I.parts[0]}.${I.parts[1]}`}u[E]={...u[E],[A]:L},t.err(`./composer.json has been updated (${A}: ${L})
`)}}const f=`${JSON.stringify(u,null,4)}
`;let _=e.command==="install"&&c!==void 0?ye(c,i):void 0,h=!1;if(_){t.err("Installing dependencies from lock file"+(l?" (including require-dev)":"")+`
`);for(const E of[..._.packages??[],..._["packages-dev"]??[]])nt(E.name,i);_["content-hash"]&&_["content-hash"]!==await t.contentHash(a??f)&&t.err("Warning: The lock file is not up to date with the latest changes in composer.json. Run `composer update`.\n")}else{t.err(e.command==="install"?`No composer.lock file present. Updating dependencies to latest instead of installing from lock file.
`:`Updating dependencies
`);const E=e.command==="require"?Ht(e.packages).map(T=>T.name):e.packages.map(T=>ae(T,"composer update")),A=E.length&&c!==void 0?ye(c,i):void 0,U=new Map([...A?.packages??[],...A?.["packages-dev"]??[]].filter(T=>!E.includes(T.name)).map(T=>[T.name,T.version])),L=await Qi(Yi(u,!1),t.source,{...p,preferred:U,platform:e.ignorePlatformReqs?void 0:t.platform},u);for(const T of L.packages.values())t.err(`  - Locking ${T.name} (${T.version})
`);const y=Vi(u,L.packages),R=[...L.packages.values()].sort((T,M)=>T.name.localeCompare(M.name));_={"content-hash":await t.contentHash(f),packages:R.filter(T=>y.has(T.name)),"packages-dev":R.filter(T=>!y.has(T.name))},h=!0}const w=[..._.packages??[],...l?_["packages-dev"]??[]:[]],b=new Set(l?(_["packages-dev"]??[]).map(E=>E.name):[]),k=e.ignorePlatformReqs?[]:He(u,w,l,t.platform);if(k.length)throw new ne(`Your requirements could not be resolved to an installable set of packages.
${k.map(E=>`  - Declined: ${E}`).join(`
`)}`);e.command==="require"&&n.write(s,f),h&&(n.write(i,zi(_,p)),t.err(`Writing lock file
`));const C=new Map(m.packages.map(E=>[E.name,E])),S=(E,A)=>!!E&&E.version===A.version&&(E.dist?.reference??null)===(A.dist?.reference??null)&&n.isDir(Be(r,A.name)),v=w.filter(E=>!S(C.get(E.name),E)),P=[...C.keys()].filter(E=>!w.some(A=>A.name===E));t.err(`Package operations: ${v.length} install${v.length===1?"":"s"}, 0 updates, ${P.length} removal${P.length===1?"":"s"}
`);const O=[];for(const E of v){t.err(`  - Downloading ${E.name} (${E.version})
`);const A=await t.source.files(E);for(const U of A.keys())if(U.split("/").some(L=>L===".."||L==="."||L===""))throw new ne(`${E.name} ${E.version} holds a file outside its directory ("${U}").`);O.push([E,A])}for(const E of P)n.remove(Be(r,E)),t.err(`  - Removing ${E}
`);for(const[E,A]of O){const U=Be(r,E.name);t.err(`  - Installing ${E.name} (${E.version})
`),n.remove(U);for(const[L,y]of A)n.write(x(U,L),y);E.type==="composer-plugin"&&t.err(`    ${E.name} is a Composer plugin; plugins do not run in the PHP runtime.
`)}!v.length&&!P.length&&t.err(`Nothing to install, update or remove
`),t.err(`Generating autoload files
`),Bt(n,r,u,w,{dev:l,devPackages:b});const q=Ki.filter(E=>u.scripts?.[E]!==void 0);return q.length&&t.err(`Composer scripts do not run in the PHP runtime (${q.join(", ")}); run their commands yourself if needed.
`),0}catch(u){(e.command==="require"||e.command==="update")&&(a===void 0?n.remove(s):n.read(s)!==a&&n.write(s,a),c===void 0?n.remove(i):n.read(i)!==c&&n.write(i,c));const d=u instanceof Z||u instanceof ne||u instanceof bt,$=u instanceof Z?`Your requirements could not be resolved to an installable set of packages.
  `:"";return t.err(`${$}${u instanceof Error?u.message:String(u)}
`),d?2:1}}const Xi="https://packagist.org/packages/{name}.json",Zi="https://cdn.jsdelivr.net/gh/",eo="https://data.jsdelivr.com/v1/packages/gh/";function to(e){const t=[];let n={};for(const r of e){const s={...n};for(const[i,o]of Object.entries(r))o==="__unset"?delete s[i]:s[i]=o;t.push(s),n=s}return t}function no(e,t){const n=t;if(n.package?.versions)return Object.values(n.package.versions).map(s=>({...s,name:e}));const r=n.packages?.[e];if(Array.isArray(r))return(n.minified?to(r):r).map(s=>({...s,name:e}));if(r)return Object.values(r).map(s=>({...s,name:e}))}function Yt(e){const t=e&&/^https:\/\/(?:api\.)?github\.com\/(?:repos\/)?([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/.exec(e);return t?{owner:t[1],repo:t[2]}:void 0}const re={maxEntries:5e4,maxTotalBytes:256*1024*1024,maxEntryBytes:64*1024*1024},st=128*1024*1024;class W extends Error{}function ro(e){const t=new yn;try{Xr(t,e,"/",re)}catch(o){throw o instanceof Zr?new W(o.message):o}const n=t.list(),r=new Set(n.map(o=>o.split("/")[1])),s=r.size===1&&n.every(o=>o.split("/").length>2)?`/${[...r][0]}/`:"/",i=new Map;for(const o of n){const a=t.readFile(o);i.set(o.slice(s.length),typeof a=="string"?new TextEncoder().encode(a):a??new Uint8Array)}return i}async function it(e,t){const n=await e(t);if(!n.ok)throw new Error(`GET ${t}: ${n.status} ${n.statusText}`);return n}async function Ce(e,t,n){const r=Number(e.headers.get("content-length"));if(r>t)throw new W(`${n} is ${r} bytes, over the ${t}-byte limit.`);if(!e.body)return new Uint8Array(await e.arrayBuffer());const s=e.body.getReader(),i=[];let o=0;for(;;){const{value:l,done:u}=await s.read();if(u)break;if(o+=l.byteLength,o>t)throw await s.cancel(),new W(`${n} exceeds the ${t}-byte limit.`);i.push(l)}const a=new Uint8Array(o);let c=0;for(const l of i)a.set(l,c),c+=l.byteLength;return a}async function so(e,t,n){if(!t)return;const s=[...new Uint8Array(await crypto.subtle.digest("SHA-1",e))].map(i=>i.toString(16).padStart(2,"0")).join("");if(s!==t.toLowerCase())throw new W(`${n}: checksum mismatch (sha1 ${s}, metadata says ${t}).`)}function io(e,t){let n;try{n=new URL(e)}catch{throw new W(`${t}: dist URL "${e}" is not an absolute URL.`)}const r=n.hostname==="localhost"||n.hostname==="[::1]"||/^127\./.test(n.hostname);if(n.protocol!=="https:"&&!(n.protocol==="http:"&&r))throw new W(`${t}: dist URL "${e}" is not https.`)}const oo=/^[A-Za-z0-9._-]+$/;async function ao(e,t,n,r){if(![t,n,r].every(c=>oo.test(c)))throw new W(`Refusing GitHub source ${t}/${n}@${r}: not a plain repository and commit.`);const i=(JSON.parse(new TextDecoder().decode(await Ce(await it(e,`${eo}${t}/${n}@${r}?structure=flat`),st,"The jsDelivr listing"))).files??[]).map(c=>c.name);if(i.length>re.maxEntries)throw new W(`${t}/${n} has ${i.length} files, over the ${re.maxEntries}-entry limit.`);for(const c of i)if(!c.startsWith("/")||c.split("/").some(l=>l===".."||l==="."))throw new W(`Refusing file "${c}" in ${t}/${n}.`);const o=new Map;let a=0;for(let c=0;c<i.length;c+=8)await Promise.all(i.slice(c,c+8).map(async l=>{const u=await Ce(await it(e,`${Zi}${t}/${n}@${r}${l.split("/").map(encodeURIComponent).join("/")}`),re.maxEntryBytes,l);if(a+=u.byteLength,a>re.maxTotalBytes)throw new W(`${t}/${n} exceeds the ${re.maxTotalBytes}-byte limit.`);o.set(l.slice(1),u)}));return o}function co(e={}){const t=e.fetch??((s,i)=>fetch(s,i)),n=e.repositoryUrl??Xi,r=new Map;return{versions(s){let i;try{i=ae(s,"a package request")}catch(a){return Promise.reject(a)}let o=r.get(i);return o||(o=(async()=>{const a=await t(n.replace("{name}",Hi(i)));if(a.status!==404){if(!a.ok)throw new Error(`Package metadata for ${i}: ${a.status} ${a.statusText}`);return no(i,JSON.parse(new TextDecoder().decode(await Ce(a,st,`Package metadata for ${i}`))))}})(),r.set(i,o)),o},async files(s){const i=s.dist,o=Yt(i?.url)??Yt(s.source?.url??void 0),a=i?.reference??s.source?.reference,c=`${s.name} ${s.version}`;if(i?.url&&(i.type??"zip")==="zip"){io(i.url,c);const l=e.distProxy?`${e.distProxy}${encodeURIComponent(i.url)}`:i.url;let u;try{u=await it(t,l)}catch(d){if(!o||!a||e.distProxy)throw d}if(u){const d=await Ce(u,st,c);return await so(d,i.shasum,c),ro(d)}}if(o&&a)return ao(t,o.owner,o.repo,a);throw new Error(`${c} has no zip dist or GitHub source the PHP runtime can fetch.`)}}}const Dn=e=>e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength);function lo(e){const t=e.getReader();return new ReadableStream({async pull(n){const{value:r,done:s}=await t.read();if(s)return n.close();const i=Dn(r);i.byteLength&&n.enqueue(i.slice())},cancel:n=>t.cancel(n)})}async function Ln(e,t){const n=e.getReader();for(;;){const{value:r,done:s}=await n.read();if(s)return;const i=Dn(r);i.byteLength&&t(i.slice())}}async function qn(e,t){const n=new TextDecoder;await Ln(e,s=>{const i=n.decode(s,{stream:!0});i&&t(i)});const r=n.decode();r&&t(r)}const we="/bfwc/php-server-front.php",Mn="x-bfwc-router-declined";function uo(e){return["<?php",...Object.entries(e).map(([n,r])=>`ini_set(${tt(n)}, ${tt(r)});`),"if (($_SERVER['HTTPS'] ?? '') === 'off') unset($_SERVER['HTTPS']);","if ((require $_SERVER['SCRIPT_FILENAME']) === false && !headers_sent()) header('X-Bfwc-Router-Declined: 1');",""].join(`
`)}const fo=e=>/\.[^/]+$/.test(e);function po(e,t,n){const r=ut(e),s=c=>c==="/"?t:x(t,c),i=(c,l,u)=>c.endsWith(".php")?{kind:"script",file:c,scriptName:l,pathInfo:u}:{kind:"file",file:c},o=c=>["index.php","index.html"].map(l=>({url:x(c,l),file:x(s(c),l)})).find(({file:l})=>n.isFile(l));if(n.isFile(s(r)))return i(s(r),r);if(n.isDir(s(r))){const c=o(r);if(c)return i(c.file,c.url)}const a=r.split("/").filter(Boolean);for(let c=a.length-1;c>0;c--){const l=`/${a.slice(0,c).join("/")}`;if(l.endsWith(".php")&&n.isFile(s(l)))return i(s(l),l,`/${a.slice(c).join("/")}`)}if(fo(r))return{kind:"missing"};for(let c=a.length;c>=0;c--){const l=`/${a.slice(0,c).join("/")}`;if(!n.isDir(s(l)))continue;const u=o(l);if(u)return i(u.file,u.url,r===l?void 0:r.slice(l==="/"?0:l.length)||void 0)}return{kind:"missing"}}const Kt=e=>({status:404,headers:{"content-type":"text/html; charset=UTF-8"},body:_n(new TextEncoder().encode(`<!doctype html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested resource <code>${e.replace(/[<>&"]/g,"")}</code> was not found on this server.</p></body></html>`))});function $o(e){const t={};for(const[n,r]of Object.entries(e)){const s=n.toLowerCase();s===Mn||!r.length||(t[s]=r.length===1?r[0]:[...r])}return t}async function ho(e,t){const{php:n,files:r,docroot:s,router:i}=t;r.mkdirTree(we.slice(0,we.lastIndexOf("/"))),r.write(we,uo(e.ini)),n.chdir(s);const o=e.host.replace(/^\[|\]$/g,""),a=`${o.includes(":")?`[${o}]`:o}:${e.port}`,c=async(d,$)=>{const m=d.url.includes("?")?d.url.slice(d.url.indexOf("?")+1):"",p={DOCUMENT_ROOT:s,SCRIPT_FILENAME:$.file,SCRIPT_NAME:$.scriptName,PHP_SELF:$.scriptName+($.pathInfo??""),SERVER_NAME:o,SERVER_PORT:String(e.port),SERVER_PROTOCOL:"HTTP/1.1",SERVER_SOFTWARE:`PHP ${t.phpVersion} Development Server (php-wasm, BuilderForce WebContainers)`,REMOTE_ADDR:"127.0.0.1",QUERY_STRING:m};return $.pathInfo&&(p.PATH_INFO=$.pathInfo),n.runStream({scriptPath:we,relativeUri:d.url,method:d.method.toUpperCase(),headers:{host:a,...d.headers},protocol:"http",body:d.body??void 0,env:t.env,$_SERVER:p})},l=async(d,$,m)=>{if(m.kind==="missing")return Kt($);if(m.kind==="file")return{status:200,headers:{"content-type":es(Sr(m.file))},body:_n(r.read(m.file))};const p=await c(d,m);qn(p.stderr,t.log).catch(()=>{});const[f,_]=await Promise.all([p.httpStatusCode,p.headers]);return _[Mn]?.length?(p.stdout.cancel(),"declined"):{status:f,headers:$o(_),body:lo(p.stdout)}};return{spec:e,handle:async d=>{const $=d.url.split("?")[0].split("#")[0];let m;try{m=decodeURIComponent($)||"/"}catch{return qt(400,"Bad Request")}try{let p=i?await l(d,m,{kind:"script",file:i,scriptName:i.startsWith(`${s}/`)?i.slice(s.length):`/${i.split("/").pop()}`}):"declined";return p==="declined"&&(p=await l(d,m,po(m,s,r)),p==="declined"&&(p=Kt(m))),t.log(`[${p.status}]: ${d.method.toUpperCase()} ${d.url}
`),p}catch(p){const f=p instanceof Error?p.message:String(p);return t.log(`[500]: ${d.method.toUpperCase()} ${d.url} - ${f}
`),qt(500,`PHP failed to handle the request: ${f}`)}}}}const pe=xe;function mo(e){const t=r=>mt(e,r).flatMap(s=>pe(e,x(r,s))?t(x(r,s)):[x(r,s)]);return{read:r=>Te(e,r)?new TextDecoder().decode(e.readFile(r)):void 0,write(r,s){e.mkdirTree(Ie(r)),e.writeFile(r,s)},isDir:r=>pe(e,r),list:r=>pe(e,r)?t(r):[],remove:r=>Ae(e,r)}}async function Un(e,t){const n=await e.php.run({code:t});if(n.exitCode!==0)throw new Error(`PHP failed: ${n.errors||n.text}`);return n.text}const go=e=>`<?php
$c = json_decode(base64_decode('${ts(new TextEncoder().encode(e))}'), true) ?: [];
$keys = ['name', 'version', 'require', 'require-dev', 'conflict', 'replace', 'provide', 'minimum-stability', 'prefer-stable', 'repositories', 'extra'];
$r = array_intersect_key($c, array_flip($keys));
if (isset($c['config']['platform'])) { $r['config']['platform'] = $c['config']['platform']; }
ksort($r);
echo md5(json_encode($r));`;async function jn(e,t){const[n,r]=JSON.parse(await Un(e,'<?php echo json_encode([PHP_VERSION, array_map("strtolower", get_loaded_extensions())]);')),s={phpVersion:n,extensions:new Set(r)};return t.platformKnown?.(s),s}async function _o(e,t,n){const r=await jn(e,n),s=t.workingDir?z(n.cwd,t.workingDir):n.cwd;return Ji(t,{files:mo(e.module.FS),source:co({...n.composer,fetch:n.fetch}),platform:r,projectDir:s,contentHash:i=>Un(e,go(i)),out:i=>n.io.stdout(i),err:i=>n.io.stderr(i)})}async function yo(e,t,n){const{php:r,module:s}=e;if(t.kind==="composer")return{kind:"exited",code:await _o(e,t,n)};if(t.kind==="serve"){await r.setSapiName("cli-server");const o=(await jn(e,n)).phpVersion,a=t.server.docroot?z(n.cwd,t.server.docroot):n.cwd;if(!pe(s.FS,a))return n.io.stderr(`Directory ${t.server.docroot} does not exist.
`),{kind:"exited",code:1};const c=t.server.routerIfPresent?z(n.cwd,t.server.routerIfPresent):void 0,l=t.server.router?z(n.cwd,t.server.router):c&&Te(s.FS,c)?c:void 0;if(l&&!Te(s.FS,l))return n.io.stderr(`Could not open input file: ${t.server.router}
`),{kind:"exited",code:1};const u=await ho(t.server,{php:r,files:{isFile:d=>Te(s.FS,d),isDir:d=>pe(s.FS,d),read:d=>s.FS.readFile(d),write:(d,$)=>s.FS.writeFile(d,$),mkdirTree:d=>s.FS.mkdirTree(d)},docroot:a,router:l,env:{...n.env},log:d=>n.io.stderr(d),phpVersion:o});return{kind:"serving",server:{port:u.spec.port,handle:u.handle,close:async()=>{}},banner:`[${new Date().toUTCString()}] PHP ${o} Development Server (http://${t.server.host}:${t.server.port}) started (request-driven)
`}}const i=await r.cli(["php",...t.argv],{env:{...n.env}});return await Promise.all([Ln(i.stdout,o=>n.io.stdout(o)),qn(i.stderr,o=>n.io.stderr(o))]),{kind:"exited",code:await i.exitCode}}const wo=String.raw`<?php
namespace Bfwc\Pgsql;

/** What a rewritten 'new PDO(...)' calls: the runtime's PDO for pgsql: DSNs, the native one for the rest. */
function pdo(string $dsn, ?string $username = null, #[\SensitiveParameter] ?string $password = null, ?array $options = null): \PDO
{
    $pgsql = PDO::pgsqlDsn($dsn);
    return $pgsql !== null ? new PDO($pgsql, $username, $password, $options) : new \PDO($dsn, $username, $password, $options);
}

/** What a rewritten 'PDO::connect(...)' / 'Pdo\Pgsql::connect(...)' (PHP 8.4) calls. */
function connect(string $dsn, ?string $username = null, #[\SensitiveParameter] ?string $password = null, ?array $options = null): \PDO
{
    $pgsql = PDO::pgsqlDsn($dsn);
    if ($pgsql !== null) {
        return PHP_VERSION_ID >= 80400 ? new \Pdo\Pgsql($pgsql, $username, $password, $options) : new PDO($pgsql, $username, $password, $options);
    }
    return method_exists(\PDO::class, 'connect') ? \PDO::connect($dsn, $username, $password, $options) : new \PDO($dsn, $username, $password, $options);
}

final class Includes
{
    private const FOR_INCLUDE = 128; // STREAM_OPEN_FOR_INCLUDE (not exposed to PHP code)
    private const RUNTIME_ROOT = '/bfwc/';
    private const CACHE = '/bfwc/cache';
    private const UNCHANGED = '=';
    private const REWRITTEN = '+';

    /** @var resource|null */
    public $context;
    /** @var resource|null a native file or directory handle */
    private $handle;
    /** An included file's (rewritten) source, served from memory, and the file's stat. */
    private ?string $source = null;
    private int $position = 0;
    private array $stat = [];
    /** @var array<string, array{0: string, 1: array}> the CLI script's rewritten source and stat, by real path, until its include opens it */
    private static array $handoff = [];

    public static function register(): void
    {
        @stream_wrapper_unregister('file');
        stream_wrapper_register('file', self::class);
    }

    /**
     * Run $call on the native file wrapper (one restore and one re-register per
     * operation) under a scoped error handler: errors are kept, not shown,
     * and the app's error_get_last() is left as it was. When $call fails
     * (false or null) and $report, the first E_WARNING (else the last error)
     * is raised again.
     */
    private static function native(callable $call, bool $report = true): mixed
    {
        $error = null;
        $warned = false;
        set_error_handler(static function (int $level, string $message) use (&$error, &$warned): bool {
            if (!$warned) {
                $error = $message;
                $warned = $level === E_WARNING;
            }
            return true;
        });
        stream_wrapper_restore('file');
        try {
            $result = $call();
        } finally {
            self::register();
            restore_error_handler();
        }
        if ($report && $error !== null && ($result === false || $result === null)) {
            trigger_error($error, E_USER_WARNING);
        }
        return $result;
    }

    /** The CLI script's real path once rewritesPrimary() said it needs the rewrite (the prepend requires it). */
    public static ?string $primary = null;

    /** Whether the CLI's script needs the rewrite; if so it is handed over for the prepend's require of {@see $primary}. */
    public static function rewritesPrimary(): bool
    {
        $script = $_SERVER['SCRIPT_FILENAME'] ?? '';
        // Under php -S the primary script is the runtime's front script, which requires the target itself.
        if (PHP_SAPI === 'cli-server' || $script === '' || str_starts_with($script, self::RUNTIME_ROOT) || str_starts_with($script, '/internal/')) {
            return false;
        }
        self::$primary = self::native(static function () use ($script): ?string {
            $path = realpath($script);
            $loaded = $path === false ? null : self::load($path);
            if ($loaded === null || $loaded[2] === false) {
                return null;
            }
            // The CLI skips a leading #! line; required, it would print. It becomes the open tag's line, so the line numbers hold.
            self::$handoff[$path] = [preg_replace(['/\A#![^\n]*\n<\?php(?=\s)/', '/\A#![^\n]*/'], ["<?php\n", ''], $loaded[0], 1), $loaded[1]];
            return $path;
        }, false);
        return self::$primary !== null;
    }

    /**
     * $path's source, rewritten where needed, its stat, and whether it changed;
     * null when it is not a regular file or cannot be read. Native wrapper only.
     * @return array{0: string, 1: array, 2: bool}|null
     */
    private static function load(string $path): ?array
    {
        if (!is_file($path)) {
            return null;
        }
        $source = file_get_contents($path);
        if ($source === false) {
            return null;
        }
        $stat = stat($path) ?: [];
        if (str_starts_with($path, self::RUNTIME_ROOT) || !Rewriter::isCandidate($source)) {
            return [$source, $stat, false];
        }
        $hash = md5($source);
        $slot = self::CACHE . '/' . md5($path);
        $cached = is_file($slot) ? file_get_contents($slot) : false;
        if ($cached !== false && str_starts_with($cached, $hash)) {
            $changed = $cached[32] === self::REWRITTEN;
            return [$changed ? substr($cached, 33) : $source, $stat, $changed];
        }
        $rewritten = Rewriter::rewriteCandidate($source);
        $changed = $rewritten !== $source;
        if (is_dir(self::CACHE) || mkdir(self::CACHE, 0777, true)) {
            file_put_contents($slot, $hash . ($changed ? self::REWRITTEN . $rewritten : self::UNCHANGED));
        }
        return [$rewritten, $stat, $changed];
    }

    public function stream_open(string $path, string $mode, int $options, ?string &$openedPath): bool
    {
        if ($options & self::FOR_INCLUDE) {
            if (isset(self::$handoff[$path])) {
                [$this->source, $this->stat] = self::$handoff[$path];
                unset(self::$handoff[$path]);
            } else {
                // A missing include gets PHP's own two warnings ("call failed", "Failed opening … for inclusion"), not a third.
                $loaded = self::native(static fn () => self::load($path), false);
                if ($loaded === null) {
                    return false;
                }
                [$this->source, $this->stat] = $loaded;
            }
            $this->stat[7] = $this->stat['size'] = strlen($this->source);
        } else {
            $usePath = (bool) ($options & STREAM_USE_PATH);
            $this->handle = self::native(fn () => fopen($path, $mode, $usePath, $this->context));
            if (!$this->handle) {
                return false;
            }
        }
        $openedPath = $path;
        return true;
    }

    public function stream_read(int $count): string|false
    {
        if ($this->source === null) {
            return fread($this->handle, $count);
        }
        $chunk = substr($this->source, $this->position, $count);
        $this->position += strlen($chunk);
        return $chunk;
    }

    public function stream_write(string $data): int|false
    {
        return $this->source === null ? fwrite($this->handle, $data) : false;
    }

    public function stream_eof(): bool
    {
        return $this->source === null ? feof($this->handle) : $this->position >= strlen($this->source);
    }

    public function stream_tell(): int|false
    {
        return $this->source === null ? ftell($this->handle) : $this->position;
    }

    public function stream_seek(int $offset, int $whence = SEEK_SET): bool
    {
        if ($this->source === null) {
            return fseek($this->handle, $offset, $whence) === 0;
        }
        $target = match ($whence) { SEEK_CUR => $this->position + $offset, SEEK_END => strlen($this->source) + $offset, default => $offset };
        if ($target < 0) {
            return false;
        }
        $this->position = $target;
        return true;
    }

    public function stream_flush(): bool
    {
        return $this->source === null ? fflush($this->handle) : true;
    }

    public function stream_close(): void
    {
        if (is_resource($this->handle)) {
            fclose($this->handle);
        }
    }

    public function stream_stat(): array|false
    {
        return $this->source === null ? fstat($this->handle) : $this->stat;
    }

    public function stream_lock(int $operation): bool
    {
        return $this->source !== null || $operation === 0 ? true : flock($this->handle, $operation);
    }

    public function stream_truncate(int $size): bool
    {
        return $this->source === null && ftruncate($this->handle, $size);
    }

    public function stream_set_option(int $option, int $arg1, ?int $arg2): bool
    {
        if ($this->source !== null) {
            return false;
        }
        return match ($option) {
            STREAM_OPTION_BLOCKING => stream_set_blocking($this->handle, (bool) $arg1),
            STREAM_OPTION_READ_TIMEOUT => stream_set_timeout($this->handle, $arg1, (int) $arg2),
            STREAM_OPTION_WRITE_BUFFER => stream_set_write_buffer($this->handle, (int) $arg2) === 0,
            default => false,
        };
    }

    /** @return resource|false */
    public function stream_cast(int $castAs)
    {
        return $this->handle ?? false;
    }

    public function stream_metadata(string $path, int $option, mixed $value): bool
    {
        return self::native(static fn () => match ($option) {
            STREAM_META_TOUCH => touch($path, ...array_values((array) $value)),
            STREAM_META_OWNER_NAME, STREAM_META_OWNER => chown($path, $value),
            STREAM_META_GROUP_NAME, STREAM_META_GROUP => chgrp($path, $value),
            STREAM_META_ACCESS => chmod($path, $value),
            default => false,
        });
    }

    public function url_stat(string $path, int $flags): array|false
    {
        $stat = $flags & STREAM_URL_STAT_LINK ? 'lstat' : 'stat';
        return self::native(static fn () => $stat($path), false); // PHP reports a failed stat itself where it should
    }

    public function unlink(string $path): bool
    {
        return self::native(fn () => unlink($path, $this->context));
    }

    public function rename(string $from, string $to): bool
    {
        return self::native(fn () => rename($from, $to, $this->context));
    }

    public function mkdir(string $path, int $mode, int $options): bool
    {
        return self::native(fn () => mkdir($path, $mode, (bool) ($options & STREAM_MKDIR_RECURSIVE), $this->context));
    }

    public function rmdir(string $path, int $options): bool
    {
        return self::native(fn () => rmdir($path, $this->context));
    }

    public function dir_opendir(string $path, int $options): bool
    {
        $this->handle = self::native(fn () => opendir($path, $this->context));
        return (bool) $this->handle;
    }

    public function dir_readdir(): string|false
    {
        return readdir($this->handle);
    }

    public function dir_rewinddir(): bool
    {
        rewinddir($this->handle);
        return true;
    }

    public function dir_closedir(): bool
    {
        closedir($this->handle);
        return true;
    }
}
`,bo=String.raw`<?php
namespace Pdo;

if (PHP_VERSION_ID >= 80400 && !class_exists(Pgsql::class, false)) {
    class Pgsql extends \Bfwc\Pgsql\PDO
    {
        public function escapeIdentifier(string $input): string
        {
            return '"' . str_replace('"', '""', $input) . '"';
        }

        public function getPid(): int
        {
            return $this->bfwcWire()->pid;
        }
    }
}
`,vo=String.raw`<?php
namespace Bfwc\Pgsql;

class PDO extends \PDO
{
    private Wire $wire;
    private array $attributes = [
        \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
        \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_BOTH,
        \PDO::ATTR_STRINGIFY_FETCHES => false,
        \PDO::ATTR_EMULATE_PREPARES => false,
        \PDO::ATTR_CASE => \PDO::CASE_NATURAL,
    ];
    private array $error = ['00000', null, null];

    /**
     * $dsn as the pgsql: DSN it names, or null for another driver. Resolved as
     * PDO resolves it (no trimming): an alias (no colon) through the
     * pdo.dsn.<name> ini setting, and 'uri:<url>' through the first line read
     * from that URL.
     */
    public static function pgsqlDsn(string $dsn): ?string
    {
        if (!str_contains($dsn, ':')) {
            $dsn = (string) ini_get('pdo.dsn.' . $dsn); // an alias may itself be a uri:
        }
        if (str_starts_with($dsn, 'uri:')) {
            $handle = @fopen(substr($dsn, 4), 'rb');
            $dsn = $handle ? rtrim((string) fgets($handle), "\r\n") : '';
            $handle && fclose($handle);
        }
        return str_starts_with($dsn, 'pgsql:') ? $dsn : null;
    }

    public function __construct(string $dsn, ?string $username = null, #[\SensitiveParameter] ?string $password = null, ?array $options = null)
    {
        $resolved = self::pgsqlDsn($dsn);
        if ($resolved === null) {
            throw new \PDOException('Bfwc\Pgsql\PDO connects to pgsql: DSNs only; use \PDO for "' . strtok($dsn, ':') . '"');
        }
        $config = [];
        foreach (preg_split('/[;\s]+/', substr($resolved, 6), -1, PREG_SPLIT_NO_EMPTY) as $pair) {
            [$key, $value] = array_pad(explode('=', $pair, 2), 2, '');
            $config[strtolower(trim($key))] = trim($value, " '\"");
        }
        foreach ($options ?? [] as $attribute => $value) {
            $this->attributes[$attribute] = $value;
        }
        $this->wire = Wire::fromConfig($config, $username, $password);
    }

    /** @internal The wire client (Pdo\Pgsql::getPid). */
    protected function bfwcWire(): Wire
    {
        return $this->wire;
    }

    /** @internal Run one statement; failures follow the error mode (null when not thrown). */
    public function bfwcRun(string $sql, array $params, ?object $reporter = null): ?array
    {
        try {
            $result = $params === [] && $reporter === null ? $this->wire->simple($sql) : $this->wire->execute($sql, $params);
            $this->error = ['00000', null, null];
            return $result;
        } catch (Exception $exception) {
            $this->error = $exception->errorInfo;
            if ($reporter && method_exists($reporter, 'bfwcFailed')) {
                $reporter->bfwcFailed($exception->errorInfo);
            }
            $mode = $this->attributes[\PDO::ATTR_ERRMODE];
            if ($mode === \PDO::ERRMODE_EXCEPTION) {
                throw $exception;
            }
            if ($mode === \PDO::ERRMODE_WARNING) {
                trigger_error($exception->getMessage(), E_USER_WARNING);
            }
            return null;
        }
    }

    public function prepare(string $query, array $options = []): Statement|false
    {
        return new Statement($this, $query, $this->attributes[\PDO::ATTR_DEFAULT_FETCH_MODE], (bool) $this->attributes[\PDO::ATTR_STRINGIFY_FETCHES]);
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): Statement|false
    {
        $statement = $this->prepare($query);
        if ($fetchMode !== null) {
            $statement->setFetchMode($fetchMode, ...$fetchModeArgs);
        }
        return $statement->execute() ? $statement : false;
    }

    public function exec(string $statement): int|false
    {
        $result = $this->bfwcRun($statement, []);
        return $result === null ? false : $result['affected'];
    }

    public function beginTransaction(): bool
    {
        if ($this->inTransaction()) {
            throw new \PDOException('There is already an active transaction');
        }
        return $this->bfwcRun('BEGIN', []) !== null;
    }

    public function commit(): bool
    {
        if (!$this->inTransaction()) {
            throw new \PDOException('There is no active transaction');
        }
        return $this->bfwcRun('COMMIT', []) !== null;
    }

    public function rollBack(): bool
    {
        if (!$this->inTransaction()) {
            throw new \PDOException('There is no active transaction');
        }
        return $this->bfwcRun('ROLLBACK', []) !== null;
    }

    public function inTransaction(): bool
    {
        return $this->wire->status !== 'I';
    }

    public function lastInsertId(?string $name = null): string|false
    {
        $result = $name === null ? $this->bfwcRun('SELECT lastval()', [], $this) : $this->bfwcRun('SELECT currval($1)', [$name], $this);
        return $result === null ? false : (string) $result['rows'][0][0];
    }

    public function quote(string $string, int $type = \PDO::PARAM_STR): string|false
    {
        return "'" . str_replace("'", "''", $string) . "'";
    }

    public function setAttribute(int $attribute, mixed $value): bool
    {
        $this->attributes[$attribute] = $value;
        return true;
    }

    public function getAttribute(int $attribute): mixed
    {
        return match ($attribute) {
            \PDO::ATTR_DRIVER_NAME => 'pgsql',
            \PDO::ATTR_SERVER_VERSION => $this->wire->parameters['server_version'] ?? '',
            \PDO::ATTR_CLIENT_VERSION => 'bfwc-pgsql',
            \PDO::ATTR_CONNECTION_STATUS => 'Connection OK; waiting to send.',
            default => $this->attributes[$attribute] ?? null,
        };
    }

    public function errorCode(): ?string
    {
        return $this->error[0];
    }

    public function errorInfo(): array
    {
        return $this->error;
    }

    public static function getAvailableDrivers(): array
    {
        return ['pgsql'];
    }
}
`,Eo=String.raw`<?php
namespace {
    use Bfwc\Pgsql\Pg;

    const PGSQL_ASSOC = 1;
    const PGSQL_NUM = 2;
    const PGSQL_BOTH = 3;
    const PGSQL_CONNECT_FORCE_NEW = 2;
    const PGSQL_CONNECT_ASYNC = 4;
    const PGSQL_CONNECTION_OK = 0;
    const PGSQL_CONNECTION_BAD = 1;
    const PGSQL_CONNECTION_STARTED = 2;
    const PGSQL_CONNECTION_MADE = 3;
    const PGSQL_CONNECTION_AWAITING_RESPONSE = 4;
    const PGSQL_CONNECTION_AUTH_OK = 5;
    const PGSQL_CONNECTION_SETENV = 6;
    const PGSQL_TRANSACTION_IDLE = 0;
    const PGSQL_TRANSACTION_ACTIVE = 1;
    const PGSQL_TRANSACTION_INTRANS = 2;
    const PGSQL_TRANSACTION_INERROR = 3;
    const PGSQL_TRANSACTION_UNKNOWN = 4;
    const PGSQL_EMPTY_QUERY = 0;
    const PGSQL_COMMAND_OK = 1;
    const PGSQL_TUPLES_OK = 2;
    const PGSQL_COPY_OUT = 3;
    const PGSQL_COPY_IN = 4;
    const PGSQL_BAD_RESPONSE = 5;
    const PGSQL_NONFATAL_ERROR = 6;
    const PGSQL_FATAL_ERROR = 7;
    const PGSQL_STATUS_LONG = 1;
    const PGSQL_STATUS_STRING = 2;
    const PGSQL_SEEK_SET = 0;
    const PGSQL_SEEK_CUR = 1;
    const PGSQL_SEEK_END = 2;
    const PGSQL_ERRORS_TERSE = 0;
    const PGSQL_ERRORS_DEFAULT = 1;
    const PGSQL_ERRORS_VERBOSE = 2;
    const PGSQL_DIAG_SEVERITY = 83;
    const PGSQL_DIAG_SQLSTATE = 67;
    const PGSQL_DIAG_MESSAGE_PRIMARY = 77;
    const PGSQL_DIAG_MESSAGE_DETAIL = 68;
    const PGSQL_DIAG_MESSAGE_HINT = 72;
    const PGSQL_CONV_IGNORE_DEFAULT = 2;
    const PGSQL_CONV_FORCE_NULL = 4;
    const PGSQL_CONV_IGNORE_NOT_NULL = 8;
    const PGSQL_DML_NO_CONV = 256;
    const PGSQL_DML_EXEC = 512;
    const PGSQL_DML_ASYNC = 1024;
    const PGSQL_DML_STRING = 2048;
    const PGSQL_DML_ESCAPE = 4096;

    function pg_connect(#[\SensitiveParameter] string $connection_string, int $flags = 0): PgSql\Connection|false { return Pg::connect($connection_string, $flags); }
    function pg_pconnect(#[\SensitiveParameter] string $connection_string, int $flags = 0): PgSql\Connection|false { return Pg::connect($connection_string, $flags); }
    function pg_close(?PgSql\Connection $connection = null): bool { Pg::close($connection); return true; }
    function pg_connection_reset(PgSql\Connection $connection): bool { return Pg::reset($connection); }
    function pg_ping(?PgSql\Connection $connection = null): bool { return Pg::ping($connection); }
    function pg_query($connection, ?string $query = null): PgSql\Result|false { [$connection, $query] = Pg::split($connection, $query); return Pg::run($connection, 'pg_query', $query, null); }
    function pg_query_params($connection, $query, ?array $params = null): PgSql\Result|false
    {
        [$connection, $query, $params] = Pg::split3($connection, $query, $params);
        return Pg::run($connection, 'pg_query_params', $query, $params);
    }
    function pg_prepare($connection, string $name, ?string $query = null): PgSql\Result|false
    {
        [$connection, $name, $query] = Pg::split3($connection, $name, $query);
        return Pg::prepare($connection, $name, $query);
    }
    function pg_execute($connection, $name, ?array $params = null): PgSql\Result|false
    {
        [$connection, $name, $params] = Pg::split3($connection, $name, $params);
        return Pg::run($connection, 'pg_execute', $name, $params, true);
    }
    function pg_fetch_assoc(PgSql\Result $result, ?int $row = null): array|false { return Pg::row($result, $row, PGSQL_ASSOC); }
    function pg_fetch_row(PgSql\Result $result, ?int $row = null, int $mode = PGSQL_NUM): array|false { return Pg::row($result, $row, $mode); }
    function pg_fetch_array(PgSql\Result $result, ?int $row = null, int $mode = PGSQL_BOTH): array|false { return Pg::row($result, $row, $mode); }
    function pg_fetch_object(PgSql\Result $result, ?int $row = null, string $class = 'stdClass', array $constructor_args = []): object|false
    {
        $values = Pg::row($result, $row, PGSQL_ASSOC);
        if ($values === false || $class === 'stdClass') {
            return $values === false ? false : (object) $values;
        }
        return Bfwc\Pgsql\Statement::instance($class, $constructor_args, $values, false);
    }
    function pg_fetch_all(PgSql\Result $result, int $mode = PGSQL_ASSOC): array { return array_map(static fn (int $index) => Pg::row($result, $index, $mode, false), array_keys($result->rows)); }
    function pg_fetch_all_columns(PgSql\Result $result, int $field = 0): array { return array_column($result->rows, Pg::field($result, $field, 'pg_fetch_all_columns', 2)); }
    function pg_fetch_result(PgSql\Result $result, $row, $field = null): string|false|null { return Pg::cell($result, $row, $field, 'pg_fetch_result'); }
    function pg_field_is_null(PgSql\Result $result, $row, $field = null): int|false
    {
        $value = Pg::cell($result, $row, $field, 'pg_field_is_null');
        return $value === false ? false : (int) ($value === null);
    }
    function pg_field_prtlen(PgSql\Result $result, $row, $field = null): int|false
    {
        $value = Pg::cell($result, $row, $field, 'pg_field_prtlen');
        return $value === false ? false : strlen((string) $value);
    }
    function pg_num_rows(PgSql\Result $result): int { return count($result->rows); }
    function pg_num_fields(PgSql\Result $result): int { return count($result->fields); }
    function pg_field_name(PgSql\Result $result, int $field): string { return $result->fields[Pg::field($result, $field, 'pg_field_name', 2)]['name']; }
    function pg_field_num(PgSql\Result $result, string $field): int
    {
        try {
            return Pg::field($result, $field, 'pg_field_num', 2);
        } catch (ValueError) {
            return -1;
        }
    }
    function pg_field_type(PgSql\Result $result, int $field): string { return Pg::typeName($result->fields[Pg::field($result, $field, 'pg_field_type', 2)]['type']); }
    function pg_field_type_oid(PgSql\Result $result, int $field): string|int { return $result->fields[Pg::field($result, $field, 'pg_field_type_oid', 2)]['type']; }
    function pg_field_size(PgSql\Result $result, int $field): int { return $result->fields[Pg::field($result, $field, 'pg_field_size', 2)]['size']; }
    function pg_field_table(PgSql\Result $result, int $field, bool $oid_only = false): string|int|false
    {
        $oid = $result->fields[Pg::field($result, $field, 'pg_field_table', 2)]['table'];
        if ($oid === 0 || $oid_only) {
            return $oid === 0 ? false : $oid;
        }
        $name = Pg::run(Pg::of($result->connection), 'pg_field_table', 'SELECT relname FROM pg_class WHERE oid = $1', [$oid]);
        return $name && $name->rows ? $name->rows[0][0] : false;
    }
    function pg_affected_rows(PgSql\Result $result): int { return $result->affected; }
    function pg_free_result(PgSql\Result $result): bool { $result->rows = []; return true; }
    function pg_result_seek(PgSql\Result $result, int $row): bool { if (!isset($result->rows[$row])) return false; $result->cursor = $row; return true; }
    function pg_result_error(PgSql\Result $result): string|false { return ''; }
    function pg_result_error_field(PgSql\Result $result, int $field_code): string|false|null { return null; }
    function pg_result_status(PgSql\Result $result, int $mode = PGSQL_STATUS_LONG): string|int
    {
        return $mode === PGSQL_STATUS_STRING ? $result->command : ($result->fields !== [] ? PGSQL_TUPLES_OK : PGSQL_COMMAND_OK);
    }
    function pg_last_oid(PgSql\Result $result): string|int|false
    {
        $tag = explode(' ', $result->command);
        return $tag[0] === 'INSERT' && (int) ($tag[1] ?? 0) !== 0 ? (int) $tag[1] : false; // InvalidOid: false, as the extension returns
    }
    function pg_last_error(?PgSql\Connection $connection = null): string { return Pg::live($connection)->lastError; }
    function pg_dbname(?PgSql\Connection $connection = null): string { return Pg::live($connection)->dbname; }
    function pg_host(?PgSql\Connection $connection = null): string { return (string) (Pg::live($connection)->config['host'] ?? 'localhost'); }
    function pg_port(?PgSql\Connection $connection = null): string { return (string) (Pg::live($connection)->config['port'] ?? '5432'); }
    function pg_options(?PgSql\Connection $connection = null): string { return (string) (Pg::live($connection)->config['options'] ?? ''); }
    function pg_get_pid(PgSql\Connection $connection): int { return Pg::live($connection)->wire?->pid ?? 0; }
    function pg_set_error_verbosity($connection, ?int $verbosity = null): int
    {
        [$connection, $verbosity] = Pg::split($connection, $verbosity);
        $state = Pg::state($connection);
        [$previous, $state->verbosity] = [$state->verbosity, $verbosity];
        return $previous;
    }
    function pg_escape_string($connection, ?string $string = null): string { return str_replace("'", "''", $string ?? $connection); }
    function pg_escape_literal($connection, ?string $string = null): string|false { return Pg::quote(Pg::split($connection, $string)[1], "'"); }
    function pg_escape_identifier($connection, ?string $string = null): string|false { return Pg::quote(Pg::split($connection, $string)[1], '"'); }
    function pg_escape_bytea($connection, ?string $string = null): string { return '\\x' . bin2hex($string ?? $connection); }
    function pg_unescape_bytea(string $string): string
    {
        if (str_starts_with($string, '\\x')) {
            return (string) hex2bin(substr($string, 2));
        }
        return preg_replace_callback('/\\\\([0-7]{3}|\\\\)/', static fn (array $m) => $m[1] === '\\' ? '\\' : chr(octdec($m[1])), $string); // the escape format
    }
    function pg_set_client_encoding($connection, ?string $encoding = null): int
    {
        [$connection, $encoding] = Pg::split($connection, $encoding);
        return @Pg::run($connection, 'pg_set_client_encoding', 'SET client_encoding TO ' . Pg::quote($encoding, "'"), null) === false ? -1 : 0;
    }
    function pg_client_encoding(?PgSql\Connection $connection = null): string { return Pg::live($connection)->wire?->parameters['client_encoding'] ?? 'UTF8'; }
    function pg_connection_status(PgSql\Connection $connection): int { return Pg::live($connection)->wire ? PGSQL_CONNECTION_OK : PGSQL_CONNECTION_BAD; }
    function pg_connection_busy(PgSql\Connection $connection): bool { return false; }
    function pg_transaction_status(PgSql\Connection $connection): int
    {
        return match (Pg::state($connection)->wire?->status) { 'I' => PGSQL_TRANSACTION_IDLE, 'T' => PGSQL_TRANSACTION_INTRANS, 'E' => PGSQL_TRANSACTION_INERROR, default => PGSQL_TRANSACTION_UNKNOWN };
    }
    function pg_parameter_status($connection, ?string $name = null): string|false
    {
        [$connection, $name] = Pg::split($connection, $name);
        return Pg::state($connection)->wire?->parameters[$name] ?? false;
    }
    function pg_version(?PgSql\Connection $connection = null): array
    {
        return ['client' => 'bfwc-pgsql', 'protocol' => 3, 'server' => Pg::live($connection)->wire?->parameters['server_version'] ?? ''];
    }
}
`,So=String.raw`<?php
namespace PgSql {
    final class Connection
    {
        public function __construct()
        {
            throw new \Error('Cannot directly construct PgSql\Connection, use pg_connect() instead');
        }

        public function __clone(): void
        {
            throw new \Error('Trying to clone an uncloneable object of class PgSql\Connection');
        }

        public function __serialize(): array
        {
            throw new \Exception("Serialization of 'PgSql\Connection' is not allowed");
        }

        public function __unserialize(array $data): void
        {
            throw new \Exception("Unserialization of 'PgSql\Connection' is not allowed");
        }
    }

    final class Result
    {
        /** @internal */
        public int $cursor = 0;

        /** @internal */
        public function __construct(public array $fields, public array $rows, public int $affected, public string $command, public ?Connection $connection = null)
        {
        }
    }
}

namespace Bfwc\Pgsql {
    use PgSql;

    /** @internal The pg_* functions' shared work. */
    final class Pg
    {
        public static ?PgSql\Connection $last = null;
        /** @var array<string, PgSql\Connection> open connections by a hash of their connection string (reused, as the extension does) */
        private static array $open = [];
        private static ?\WeakMap $state = null;
        private const NO_SERVER = 'no connection to the server';
        private const TYPES = [16 => 'bool', 17 => 'bytea', 18 => 'char', 19 => 'name', 20 => 'int8', 21 => 'int2', 23 => 'int4', 25 => 'text', 26 => 'oid', 114 => 'json', 700 => 'float4', 701 => 'float8', 1042 => 'bpchar', 1043 => 'varchar', 1082 => 'date', 1083 => 'time', 1114 => 'timestamp', 1184 => 'timestamptz', 1186 => 'interval', 1700 => 'numeric', 2950 => 'uuid', 3802 => 'jsonb'];

        /** A connection's state: wire (null when BAD or closed), closed, config, key, dbname, lastError, verbosity. */
        public static function state(PgSql\Connection $connection): object
        {
            if (!isset(self::$state[$connection])) {
                throw new \Error('This PgSql\Connection was not opened by pg_connect()');
            }
            return self::$state[$connection];
        }

        /** The state of the connection to use ($connection, else the last opened), which must not be closed. */
        public static function live(?PgSql\Connection $connection): object
        {
            return self::state(self::of($connection));
        }

        /** pg_connect's conninfo ('host=… dbname=…', values optionally quoted with \' and \\ escapes) or URI ('postgresql://user:pass@host:port/db'). */
        public static function connect(#[\SensitiveParameter] string $conninfo, int $flags): PgSql\Connection|false
        {
            $key = hash('sha256', $conninfo);
            $reuse = self::$open[$key] ?? null;
            if ($reuse && self::state($reuse)->wire && !($flags & PGSQL_CONNECT_FORCE_NEW)) {
                return self::$last = $reuse;
            }
            $config = [];
            if (preg_match('#^postgres(?:ql)?://#', $conninfo)) {
                $url = parse_url($conninfo);
                $config = array_filter(['host' => $url['host'] ?? null, 'port' => $url['port'] ?? null, 'user' => isset($url['user']) ? urldecode($url['user']) : null, 'password' => isset($url['pass']) ? urldecode($url['pass']) : null, 'dbname' => ltrim($url['path'] ?? '', '/') ?: null], static fn ($value) => $value !== null);
            } else {
                preg_match_all("/(\\w+)\\s*=\\s*('(?:[^'\\\\]|\\\\.)*'|\\S+)/", $conninfo, $pairs, PREG_SET_ORDER);
                foreach ($pairs as [, $name, $value]) {
                    $config[strtolower($name)] = str_starts_with($value, "'") ? preg_replace("/\\\\(['\\\\])/", '$1', substr($value, 1, -1)) : $value;
                }
            }
            try {
                $wire = Wire::fromConfig($config);
            } catch (Exception $exception) {
                trigger_error('pg_connect(): Unable to connect to PostgreSQL server: ' . $exception->errorInfo[2], E_USER_WARNING);
                return false;
            }
            $connection = (new \ReflectionClass(PgSql\Connection::class))->newInstanceWithoutConstructor();
            self::$state ??= new \WeakMap();
            self::$state[$connection] = (object) ['wire' => $wire, 'closed' => false, 'config' => $config, 'key' => $key, 'dbname' => $wire->database, 'lastError' => '', 'verbosity' => PGSQL_ERRORS_DEFAULT];
            return self::$last = self::$open[$key] = $connection;
        }

        /** The connection to use ($connection, else the last opened); throws, as the extension does, when there is none or it was closed. */
        public static function of(?PgSql\Connection $connection): PgSql\Connection
        {
            $connection ??= self::$last;
            if (!$connection) {
                throw new \Error('No PostgreSQL connection opened yet');
            }
            if (self::state($connection)->closed) {
                throw new \Error('PostgreSQL connection has already been closed');
            }
            return $connection;
        }

        public static function close(?PgSql\Connection $connection): void
        {
            $connection = self::of($connection);
            $state = self::state($connection);
            $state->wire?->close();
            $state->wire = null;
            $state->closed = true;
            if ((self::$open[$state->key] ?? null) === $connection) {
                unset(self::$open[$state->key]);
            }
            if (self::$last === $connection) {
                self::$last = null;
            }
        }

        /** Reconnect with the same settings (a closed connection throws). */
        public static function reset(PgSql\Connection $connection): bool
        {
            $state = self::live($connection);
            $state->wire?->close();
            try {
                $state->wire = Wire::fromConfig($state->config);
                return true;
            } catch (Exception) {
                $state->wire = null;
                return false;
            }
        }

        /** Whether the server answers; a BAD connection is reset first, as libpq's PQping-and-reset does. */
        public static function ping(?PgSql\Connection $connection): bool
        {
            $connection = self::of($connection);
            $state = self::state($connection);
            if ($state->wire) {
                try {
                    $state->wire->simple('SELECT 1');
                    return true;
                } catch (Exception) {
                    // fall through to a reset
                }
            }
            return self::reset($connection);
        }

        /** Run $sql: a simple query when $params is null, a named prepared statement when $prepared; failures warn and return false. */
        public static function run(PgSql\Connection $connection, string $function, string $sql, ?array $params, bool $prepared = false): PgSql\Result|false
        {
            return self::attempt($connection, $function, static function (Wire $wire) use ($connection, $sql, $params, $prepared): PgSql\Result {
                $values = $params === null ? null : array_map(static fn ($value) => Wire::text($value, '1', ''), array_values($params));
                $result = match (true) {
                    $prepared => $wire->executePrepared($sql, $values ?? []),
                    $values === null => $wire->simple($sql),
                    default => $wire->execute($sql, $values),
                };
                return new PgSql\Result($result['fields'], $result['rows'], $result['affected'], $result['command'], $connection);
            });
        }

        public static function prepare(PgSql\Connection $connection, string $name, string $sql): PgSql\Result|false
        {
            return self::attempt($connection, 'pg_prepare', static fn (Wire $wire) => new PgSql\Result([], [], 0, $wire->prepare($name, $sql)['command'], $connection));
        }

        /** $work on the connection's wire; a failure (or a BAD connection) sets the last error, warns "Query failed" and returns false. */
        private static function attempt(PgSql\Connection $connection, string $function, callable $work): PgSql\Result|false
        {
            $state = self::state($connection);
            $message = self::NO_SERVER;
            if ($state->wire) {
                try {
                    $result = $work($state->wire);
                    $state->lastError = '';
                    return $result;
                } catch (Exception $exception) {
                    $message = $exception->errorInfo[2];
                    $code = (string) $exception->errorInfo[0];
                    if (str_starts_with($code, '08') || str_starts_with($code, '57P')) {
                        // A broken connection (or a terminated backend) is BAD from now on, as libpq's is.
                        $state->wire->close();
                        $state->wire = null;
                    }
                }
            }
            $state->lastError = $message;
            trigger_error($function . '(): Query failed: ' . $message, E_USER_WARNING);
            return false;
        }

        /** Row $row (the cursor's when null, which then advances) shaped by $mode; false past the end. */
        public static function row(PgSql\Result $result, ?int $row, int $mode, bool $advance = true): array|false
        {
            $index = $row ?? $result->cursor;
            if (!isset($result->rows[$index])) {
                return false;
            }
            if ($advance) {
                $result->cursor = $index + 1;
            }
            $values = $result->rows[$index];
            if ($mode === PGSQL_NUM) {
                return $values;
            }
            $out = [];
            foreach ($result->fields as $i => $field) {
                if ($mode !== PGSQL_ASSOC) {
                    $out[$i] = $values[$i];
                }
                $out[$field['name']] = $values[$i];
            }
            return $out;
        }

        /** Field $field (index or name) of $result, or a ValueError naming $function's argument $argument, as the extension throws. */
        public static function field(PgSql\Result $result, int|string $field, string $function, int $argument): int
        {
            if (is_int($field)) {
                if ($field < 0 || $field >= count($result->fields)) {
                    throw new \ValueError($function . '(): Argument #' . $argument . ' ($field) must be less than the number of fields for this result set');
                }
                return $field;
            }
            $at = array_search($field, array_column($result->fields, 'name'), true);
            if ($at === false) {
                throw new \ValueError($function . '(): Argument #' . $argument . ' ($field) must be a field name from this result set');
            }
            return $at;
        }

        /**
         * One cell, called as pg_fetch_result is: ($result, $field) reads the
         * cursor's row and advances (false, silently, past the end); ($result,
         * $row, $field) reads $row (false with the extension's warning past the end).
         */
        public static function cell(PgSql\Result $result, mixed $rowOrField, mixed $field, string $function): string|false|null
        {
            if ($field === null) {
                $column = self::field($result, $rowOrField, $function, 2);
                if (!isset($result->rows[$result->cursor])) {
                    return false;
                }
                return $result->rows[$result->cursor++][$column];
            }
            $column = self::field($result, $field, $function, 3);
            if (!isset($result->rows[$rowOrField])) {
                trigger_error($function . '(): Unable to jump to row ' . $rowOrField . ' on PostgreSQL result index', E_USER_WARNING);
                return false;
            }
            return $result->rows[$rowOrField][$column];
        }

        public static function typeName(int $oid): string
        {
            return self::TYPES[$oid] ?? 'unknown';
        }

        public static function quote(string $value, string $quote): string
        {
            return $quote . str_replace($quote, $quote . $quote, $value) . $quote;
        }

        /** The connection and the remaining argument of a function whose leading connection is optional. */
        public static function split(mixed $first, mixed $second): array
        {
            return $second === null ? [self::of(null), $first] : [self::of($first), $second];
        }

        /** The same for a function with two further arguments. */
        public static function split3(mixed $first, mixed $second, mixed $third): array
        {
            return $third === null ? [self::of(null), $first, $second] : [self::of($first), $second, $third];
        }
    }
}
`,ko=String.raw`<?php
namespace Bfwc\Pgsql;

final class Rewriter
{
    /** Cheap test for a file that might need the rewrite: a construction or connect naming PDO, or an import mentioning it. */
    public const CANDIDATE = '/\bnew\b[^;(]*\bpdo\b|\b(?:pdo|pgsql)\s*::\s*connect\b|\buse\b[^;]*\bpdo\b/i';

    private const SKIP = [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT];
    private const TARGETS = ['pdo', 'pdo\\pgsql'];

    public static function isCandidate(string $source): bool
    {
        return preg_match(self::CANDIDATE, $source) === 1 && stripos($source, '__halt_compiler') === false;
    }

    public static function rewrite(string $source): string
    {
        return self::isCandidate($source) ? self::rewriteCandidate($source) : $source;
    }

    /** The rewrite of a source {@see isCandidate()} accepted. */
    public static function rewriteCandidate(string $source): string
    {
        try {
            $tokens = \PhpToken::tokenize($source);
        } catch (\Throwable) {
            return $source;
        }
        $constant = self::constantContexts($tokens);
        $global = true;
        $aliases = []; // lower-case local name => the lower-case class it imports
        $out = '';
        $changed = false;
        for ($i = 0, $count = count($tokens); $i < $count; $i++) {
            $token = $tokens[$i];
            $replace = null;
            if ($token->id === T_NAMESPACE) {
                $next = self::next($tokens, $i + 1);
                $global = $next === null || in_array($tokens[$next]->text, [';', '{'], true);
                $aliases = [];
            } elseif ($token->id === T_USE && self::isImport($tokens, $i)) {
                $aliases = self::imports($tokens, $i + 1) + $aliases;
            } elseif (!$constant[$i] && $token->id === T_NEW) {
                $name = self::next($tokens, $i + 1);
                $paren = $name === null ? null : self::next($tokens, $name + 1);
                if ($paren !== null && $tokens[$paren]->text === '(' && self::resolve($tokens[$name], $global, $aliases) === 'pdo') {
                    $replace = ['\\Bfwc\\Pgsql\\pdo', $paren];
                }
            } elseif (!$constant[$i] && self::resolve($token, $global, $aliases) !== null) {
                $colons = self::next($tokens, $i + 1);
                $method = $colons === null ? null : self::next($tokens, $colons + 1);
                $paren = $method === null ? null : self::next($tokens, $method + 1);
                if ($paren !== null && $tokens[$colons]->id === T_DOUBLE_COLON && strtolower($tokens[$method]->text) === 'connect' && $tokens[$paren]->text === '(') {
                    $previous = self::previous($tokens, $i - 1);
                    if ($previous === null || !in_array($tokens[$previous]->id, [T_NEW, T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION], true)) {
                        $replace = ['\\Bfwc\\Pgsql\\connect', $paren];
                    }
                }
            }
            if ($replace) {
                [$call, $paren] = $replace;
                $skipped = '';
                for ($j = $i; $j < $paren; $j++) {
                    $skipped .= $tokens[$j]->text;
                }
                $out .= $call . str_repeat("\n", substr_count($skipped, "\n"));
                $changed = true;
                $i = $paren - 1;
                continue;
            }
            $out .= $token->text;
        }
        return $changed ? $out : $source;
    }

    /**
     * For each token, whether it sits where only a constant expression may:
     * a parameter list (its defaults), an attribute, a 'const' declaration, or
     * (before PHP 8.3) a 'static $x =' initialiser.
     * @return list<bool>
     */
    private static function constantContexts(array $tokens): array
    {
        $flags = [];
        $parens = 0;
        $parameterLists = []; // the paren depth each open parameter list started at
        $attribute = 0; // bracket depth inside #[ … ]
        $statement = false; // inside a const / static-variable declaration, until ';'
        $awaitingParameters = false;
        $count = count($tokens);
        for ($i = 0; $i < $count; $i++) {
            $token = $tokens[$i];
            if ($attribute > 0) {
                $attribute += $token->text === '[' ? 1 : ($token->text === ']' ? -1 : 0);
                $flags[$i] = true;
                continue;
            }
            if ($token->id === T_ATTRIBUTE) {
                $attribute = 1;
                $flags[$i] = true;
                continue;
            }
            $previous = self::previous($tokens, $i - 1);
            $afterUse = $previous !== null && $tokens[$previous]->id === T_USE;
            if ($token->id === T_CONST && !$afterUse) {
                $statement = true;
            } elseif ($token->id === T_STATIC && PHP_VERSION_ID < 80300) {
                $next = self::next($tokens, $i + 1);
                $starts = $previous === null || in_array($tokens[$previous]->id, [T_OPEN_TAG, T_ELSE], true) || in_array($tokens[$previous]->text, [';', '{', '}', ':', ')'], true);
                if ($next !== null && $tokens[$next]->id === T_VARIABLE && $starts) {
                    $statement = true;
                }
            } elseif (($token->id === T_FUNCTION || $token->id === T_FN) && !$afterUse) {
                $awaitingParameters = true;
            } elseif ($token->text === '(') {
                $parens++;
                if ($awaitingParameters) {
                    $parameterLists[] = $parens;
                    $awaitingParameters = false;
                }
            } elseif ($token->text === ')') {
                if ($parameterLists && end($parameterLists) === $parens) {
                    array_pop($parameterLists);
                }
                $parens--;
            } elseif ($token->text === ';') {
                $statement = false;
            }
            $flags[$i] = $statement || $parameterLists !== [];
        }
        return $flags;
    }

    /** The class $name refers to, when it is the global PDO or Pdo\Pgsql ('pdo', 'pdo\pgsql'); otherwise null. */
    private static function resolve(\PhpToken $name, bool $global, array $aliases): ?string
    {
        $lower = strtolower($name->text);
        $class = match ($name->id) {
            T_NAME_FULLY_QUALIFIED => substr($lower, 1),
            T_NAME_QUALIFIED => isset($aliases[strstr($lower, '\\', true)]) ? $aliases[strstr($lower, '\\', true)] . strstr($lower, '\\') : ($global ? $lower : null),
            T_STRING => $aliases[$lower] ?? ($global ? $lower : null),
            default => null,
        };
        return in_array($class, self::TARGETS, true) ? $class : null;
    }

    private static function next(array $tokens, int $from): ?int
    {
        for ($i = $from, $n = count($tokens); $i < $n; $i++) {
            if (!$tokens[$i]->is(self::SKIP)) {
                return $i;
            }
        }
        return null;
    }

    private static function previous(array $tokens, int $from): ?int
    {
        for ($i = $from; $i >= 0; $i--) {
            if (!$tokens[$i]->is(self::SKIP)) {
                return $i;
            }
        }
        return null;
    }

    /** An import 'use' (not a closure's 'use (…)' and not a trait 'use' inside a class body, which follows '{' or ';' within braces). */
    private static function isImport(array $tokens, int $at): bool
    {
        $next = self::next($tokens, $at + 1);
        if ($next === null || $tokens[$next]->text === '(') {
            return false;
        }
        $depth = 0;
        for ($i = $at - 1; $i >= 0; $i--) {
            if ($tokens[$i]->text === '}') {
                $depth++;
            } elseif ($tokens[$i]->text === '{' || $tokens[$i]->id === T_CURLY_OPEN || $tokens[$i]->id === T_DOLLAR_OPEN_CURLY_BRACES) {
                if ($depth === 0) {
                    // Directly inside braces: only a braced namespace's body holds imports.
                    $opener = self::previous($tokens, $i - 1);
                    $before = $opener === null ? null : self::previous($tokens, $opener - 1);
                    return $opener !== null && ($tokens[$opener]->id === T_NAMESPACE || ($before !== null && $tokens[$before]->id === T_NAMESPACE));
                }
                $depth--;
            }
        }
        return true;
    }

    /** What an import statement's names say about PDO: local name => the class it imports (PDO, Pdo\Pgsql, or a class shadowing PDO). */
    private static function imports(array $tokens, int $from): array
    {
        $aliases = [];
        $name = null;
        $alias = null;
        $expectAlias = false;
        for ($i = $from, $n = count($tokens); $i < $n; $i++) {
            $token = $tokens[$i];
            if ($token->is(self::SKIP)) {
                continue;
            }
            if ($token->text === '{' || ($name === null && in_array(strtolower($token->text), ['function', 'const'], true))) {
                return []; // group imports and function/constant imports never name the PDO class
            }
            if ($token->id === T_AS) {
                $expectAlias = true;
            } elseif ($token->text === ',' || $token->text === ';') {
                if ($name !== null) {
                    $target = strtolower(ltrim($name, '\\'));
                    $local = strtolower($alias ?? substr((string) strrchr('\\' . $name, '\\'), 1));
                    if ($local === 'pdo' || in_array($target, self::TARGETS, true)) {
                        $aliases[$local] = $target; // 'pdo' / 'pdo\pgsql', or what shadows the name PDO
                    }
                }
                $name = $alias = null;
                $expectAlias = false;
                if ($token->text === ';') {
                    return $aliases;
                }
            } elseif ($expectAlias) {
                $alias = $token->text;
            } else {
                $name = $token->text;
            }
        }
        return $aliases;
    }
}
`,To=String.raw`<?php
namespace Bfwc\Pgsql;

class Statement extends \PDOStatement
{
    private string $sql;
    /** @var list<int|string> placeholder keys, in $n order */
    private array $keys;
    private array $bound = [];
    private array $fields = [];
    private array $rows = [];
    /** The next row to fetch (a cursor: fetchAll stays linear). */
    private int $cursor = 0;
    private int $affected = 0;
    private array $fetchArgs = [];
    private array $error = ['00000', null, null];

    public function __construct(private PDO $pdo, string $query, private int $fetchMode, private bool $stringify)
    {
        $this->queryString = $query;
        [$this->sql, $this->keys] = self::placeholders($query);
    }

    /** Whether $char continues an identifier (so a $ or E' there does not start a quote). */
    private static function identifierChar(string $char): bool
    {
        return $char !== '' && (ctype_alnum($char) || $char === '_' || $char === '$' || ord($char) >= 0x80);
    }

    private static function invalidParameters(string $why): Exception
    {
        return Exception::fromState('HY093', 'Invalid parameter number: ' . $why);
    }

    /**
     * ? and :name as $1…, outside quotes ('…', E'…' at a token boundary, "…"),
     * comments (-- to the line end; nested block comments), dollar quotes ($tag$…$tag$, not inside an
     * identifier) and :: casts; ?? is a literal ?. Mixing named and positional
     * placeholders is refused, as PDO does.
     */
    public static function placeholders(string $sql): array
    {
        $out = '';
        $keys = [];
        $named = [];
        $positional = false;
        $length = strlen($sql);
        for ($i = 0; $i < $length; $i++) {
            $char = $sql[$i];
            $next = $sql[$i + 1] ?? '';
            $previous = $i > 0 ? $sql[$i - 1] : '';
            if ($char === "'" || $char === '"') {
                $end = $i + 1;
                $escapes = $char === "'" && ($previous === 'E' || $previous === 'e') && !self::identifierChar($i > 1 ? $sql[$i - 2] : '');
                while ($end < $length && ($sql[$end] !== $char || ($sql[$end + 1] ?? '') === $char)) {
                    $end += ($sql[$end] === $char || ($escapes && $sql[$end] === '\\')) ? 2 : 1;
                }
                $out .= substr($sql, $i, $end - $i + 1);
                $i = $end;
            } elseif ($char === '-' && $next === '-') {
                $end = strpos($sql, "\n", $i);
                $end = $end === false ? $length : $end;
                $out .= substr($sql, $i, $end - $i);
                $i = $end - 1;
            } elseif ($char === '/' && $next === '*') {
                $depth = 0;
                for ($end = $i; $end < $length; $end++) {
                    if ($sql[$end] === '/' && ($sql[$end + 1] ?? '') === '*') {
                        $depth++;
                        $end++;
                    } elseif ($sql[$end] === '*' && ($sql[$end + 1] ?? '') === '/') {
                        $depth--;
                        $end++;
                        if ($depth === 0) {
                            break;
                        }
                    }
                }
                $end = min($end + 1, $length);
                $out .= substr($sql, $i, $end - $i);
                $i = $end - 1;
            } elseif ($char === '$' && !self::identifierChar($previous) && preg_match('/\G\$([A-Za-z_][A-Za-z0-9_]*)?\$/', $sql, $tag, 0, $i)) {
                $end = strpos($sql, $tag[0], $i + strlen($tag[0]));
                $end = $end === false ? $length : $end + strlen($tag[0]);
                $out .= substr($sql, $i, $end - $i);
                $i = $end - 1;
            } elseif ($char === ':' && $next === ':') {
                $out .= '::';
                $i++;
            } elseif ($char === ':' && preg_match('/\G:([A-Za-z_][A-Za-z0-9_]*)/', $sql, $name, 0, $i)) {
                if ($positional) {
                    throw self::invalidParameters('mixed named and positional parameters');
                }
                $named[$name[1]] ??= count($keys) + 1;
                if ($named[$name[1]] === count($keys) + 1) {
                    $keys[] = $name[1];
                }
                $out .= '$' . $named[$name[1]];
                $i += strlen($name[0]) - 1;
            } elseif ($char === '?' && $next === '?') {
                $out .= '?';
                $i++;
            } elseif ($char === '?') {
                if ($named) {
                    throw self::invalidParameters('mixed named and positional parameters');
                }
                $positional = true;
                $keys[] = count($keys);
                $out .= '$' . count($keys);
            } else {
                $out .= $char;
            }
        }
        return [$out, $keys];
    }

    private static function text(mixed $value, int $type): ?string
    {
        if ($value === null || $type === \PDO::PARAM_NULL) {
            return null;
        }
        return Wire::text($type === \PDO::PARAM_BOOL && !is_resource($value) ? (bool) $value : $value);
    }

    public function bindValue(int|string $param, mixed $value, int $type = \PDO::PARAM_STR): bool
    {
        $this->bound[is_int($param) ? $param - 1 : ltrim($param, ':')] = [$value, $type];
        return true;
    }

    public function bindParam(int|string $param, mixed &$var, int $type = \PDO::PARAM_STR, int $maxLength = 0, mixed $driverOptions = null): bool
    {
        $this->bound[is_int($param) ? $param - 1 : ltrim($param, ':')] = [&$var, $type];
        return true;
    }

    /** @internal */
    public function bfwcFailed(array $errorInfo): void
    {
        $this->error = $errorInfo;
    }

    public function execute(?array $params = null): bool
    {
        $values = [];
        if ($params !== null && count($params) !== count($this->keys)) {
            throw self::invalidParameters('number of bound variables does not match number of tokens');
        }
        foreach ($this->keys as $key) {
            if ($params !== null) {
                $name = is_int($key) ? $key : (array_key_exists($key, $params) ? $key : ':' . $key);
                if (!array_key_exists($name, $params)) {
                    throw self::invalidParameters('parameter was not defined');
                }
                $values[] = self::text($params[$name], \PDO::PARAM_STR);
            } else {
                if (!array_key_exists($key, $this->bound)) {
                    throw self::invalidParameters('parameter was not defined');
                }
                [$value, $type] = $this->bound[$key];
                $values[] = self::text($value, $type);
            }
        }
        $result = $this->pdo->bfwcRun($this->sql, $values, $this);
        if ($result === null) {
            return false;
        }
        $this->error = ['00000', null, null];
        $this->fields = $result['fields'];
        $this->rows = $result['rows'];
        $this->cursor = 0;
        $this->affected = $result['affected'];
        return true;
    }

    private function value(?string $text, int $type): mixed
    {
        if ($text === null || $this->stringify) {
            return $text;
        }
        return match ($type) {
            16 => $text === 't',
            // int8 and oid fit PHP's int only on 64-bit; past PHP_INT_MAX (php-wasm is 32-bit) they stay strings, as pdo_pgsql leaves them.
            20, 21, 23, 26 => PHP_INT_SIZE === 8 || (string) (int) $text === ltrim($text, '+') ? (int) $text : $text,
            700, 701 => (float) $text,
            default => $text,
        };
    }

    private function shape(array $row, int $mode, array $args): mixed
    {
        $values = [];
        foreach ($row as $i => $text) {
            $values[$i] = $this->value($text, $this->fields[$i]['type']);
        }
        $names = array_column($this->fields, 'name');
        return match ($mode & ~\PDO::FETCH_PROPS_LATE) {
            \PDO::FETCH_ASSOC => array_combine($names, $values),
            \PDO::FETCH_NUM => $values,
            \PDO::FETCH_BOTH => array_combine($names, $values) + $values,
            \PDO::FETCH_OBJ => (object) array_combine($names, $values),
            \PDO::FETCH_COLUMN => $values[$args[0] ?? 0] ?? null,
            \PDO::FETCH_CLASS => self::instance($args[0] ?? \stdClass::class, $args[1] ?? [], array_combine($names, $values), (bool) ($mode & \PDO::FETCH_PROPS_LATE)),
            default => throw new \PDOException('Fetch mode ' . $mode . ' is not supported by the runtime\'s pgsql client (ASSOC, NUM, BOTH, OBJ, COLUMN, KEY_PAIR, CLASS are)'),
        };
    }

    /** @internal An object of $class with $properties set before its constructor runs (after, when $late); pg_fetch_object shares it. */
    public static function instance(string $class, array $args, array $properties, bool $late): object
    {
        $object = (new \ReflectionClass($class))->newInstanceWithoutConstructor();
        $assign = function () use ($object, $properties) {
            foreach ($properties as $name => $value) {
                $object->$name = $value;
            }
        };
        if (!$late) {
            \Closure::bind($assign, null, $class)();
        }
        if (method_exists($object, '__construct')) {
            $object->__construct(...$args);
        }
        if ($late) {
            \Closure::bind($assign, null, $class)();
        }
        return $object;
    }

    private function mode(int $mode): int
    {
        return $mode === \PDO::FETCH_DEFAULT ? $this->fetchMode : $mode;
    }

    private function next(): ?array
    {
        return $this->cursor < count($this->rows) ? $this->rows[$this->cursor++] : null;
    }

    public function fetch(int $mode = \PDO::FETCH_DEFAULT, int $cursorOrientation = \PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed
    {
        $row = $this->next();
        if ($row === null) {
            return false;
        }
        $mode = $this->mode($mode);
        return $mode === \PDO::FETCH_KEY_PAIR ? [$this->value($row[0], $this->fields[0]['type']) => $this->value($row[1], $this->fields[1]['type'])] : $this->shape($row, $mode, $this->fetchArgs);
    }

    public function fetchAll(int $mode = \PDO::FETCH_DEFAULT, mixed ...$args): array
    {
        $mode = $this->mode($mode);
        $args = $args ?: $this->fetchArgs;
        $out = [];
        while (($row = $this->next()) !== null) {
            if ($mode === \PDO::FETCH_KEY_PAIR) {
                $out[$this->value($row[0], $this->fields[0]['type'])] = $this->value($row[1], $this->fields[1]['type']);
            } else {
                $out[] = $this->shape($row, $mode, $args);
            }
        }
        return $out;
    }

    public function fetchColumn(int $column = 0): mixed
    {
        $row = $this->next();
        return $row === null ? false : $this->value($row[$column] ?? null, $this->fields[$column]['type'] ?? 25);
    }

    public function fetchObject(?string $class = 'stdClass', array $constructorArgs = []): object|false
    {
        $row = $this->next();
        return $row === null ? false : $this->shape($row, \PDO::FETCH_CLASS, [$class ?? \stdClass::class, $constructorArgs]);
    }

    public function setFetchMode(int $mode, mixed ...$args): bool
    {
        $this->fetchMode = $mode;
        $this->fetchArgs = $args;
        return true;
    }

    public function rowCount(): int
    {
        return $this->affected;
    }

    public function columnCount(): int
    {
        return count($this->fields);
    }

    public function getColumnMeta(int $column): array|false
    {
        $field = $this->fields[$column] ?? null;
        return $field ? ['name' => $field['name'], 'pgsql:oid' => $field['type'], 'native_type' => (string) $field['type'], 'len' => -1, 'precision' => -1, 'flags' => []] : false;
    }

    public function closeCursor(): bool
    {
        $this->rows = [];
        $this->cursor = 0;
        return true;
    }

    public function errorCode(): ?string
    {
        return $this->error[0];
    }

    public function errorInfo(): array
    {
        return $this->error;
    }

    public function getIterator(): \Iterator
    {
        while (($row = $this->fetch()) !== false) {
            yield $row;
        }
    }
}
`,Po=String.raw`<?php
namespace Bfwc\Pgsql;

final class Wire
{
    /** @var resource */
    private $socket;
    private string $buffer = '';
    /** ReadyForQuery's status: I (idle), T (in a transaction), E (in a failed transaction). */
    public string $status = 'I';
    /** The database connected to. */
    public string $database;
    /** The backend's process id (BackendKeyData). */
    public int $pid = 0;
    /** @var array<string, string> ParameterStatus values (server_version …). */
    public array $parameters = [];
    private string $endpoint;
    /** Whether the server has sent anything yet. */
    private bool $answered = false;
    /** An ErrorResponse waiting for ReadyForQuery, rethrown if the server hangs up first. */
    private ?Exception $pending = null;

    public function __construct(string $host, int $port, string $user, string $database, ?string $password, float $timeout)
    {
        $this->endpoint = '"' . $host . '", port ' . $port;
        $this->database = $database;
        $socket = @stream_socket_client('tcp://' . $host . ':' . $port, $errno, $errstr, $timeout);
        if (!$socket) {
            throw Exception::fromState('08006', 'connection to server at "' . $host . '", port ' . $port . ' failed: ' . ($errstr ?: 'Connection refused'));
        }
        stream_set_blocking($socket, true);
        $this->socket = $socket;
        $params = "user\0" . $user . "\0database\0" . $database . "\0client_encoding\0UTF8\0application_name\0bfwc-php\0\0";
        $this->send(pack('NN', 8 + strlen($params), 196608) . $params);
        $this->authenticate($user, $password ?? '');
        $this->untilReady();
    }

    /**
     * Connect from libpq-style settings (host, port, dbname, user, password,
     * connect_timeout), as a DSN or conninfo string gives them; explicit
     * credentials win. The database defaults to the user, as libpq's does.
     */
    public static function fromConfig(#[\SensitiveParameter] array $config, ?string $user = null, #[\SensitiveParameter] ?string $password = null): self
    {
        $user ??= $config['user'] ?? 'postgres';
        return new self($config['host'] ?? 'localhost', (int) ($config['port'] ?? 5432), $user, $config['dbname'] ?? $user, $password ?? $config['password'] ?? null, (float) ($config['connect_timeout'] ?? 30));
    }

    /** A PHP value as a text-format parameter: null stays null, a stream is read, booleans become $true / $false. */
    public static function text(mixed $value, string $true = 't', string $false = 'f'): ?string
    {
        if ($value === null) {
            return null;
        }
        if (is_resource($value)) {
            return stream_get_contents($value);
        }
        if (is_bool($value)) {
            return $value ? $true : $false;
        }
        return (string) $value;
    }

    public static function frame(string $type, string $body): string
    {
        return $type . pack('N', strlen($body) + 4) . $body;
    }

    private function send(string $bytes): void
    {
        $length = strlen($bytes);
        for ($offset = 0; $offset < $length; $offset += $written) {
            $written = @fwrite($this->socket, substr($bytes, $offset)); // a failure is reported below, as the extension reports it
            if ($written === false || $written === 0) {
                throw Exception::fromState('08006', 'server closed the connection while the client was sending');
            }
        }
    }

    private function read(int $length): string
    {
        while (strlen($this->buffer) < $length) {
            $chunk = fread($this->socket, max(65536, $length - strlen($this->buffer)));
            if ($chunk === false || ($chunk === '' && feof($this->socket))) {
                // An error the server sent before hanging up says why (a FATAL during a query, a terminated backend).
                if ($this->pending) {
                    throw $this->pending;
                }
                // php-wasm reports a connect as made at once; a refused one ends before the server says anything.
                throw Exception::fromState('08006', $this->answered ? 'server closed the connection unexpectedly' : 'connection to server at ' . $this->endpoint . ' failed: Connection refused (is the database running?)');
            }
            $this->answered = true;
            $this->buffer .= $chunk;
        }
        $out = substr($this->buffer, 0, $length);
        $this->buffer = (string) substr($this->buffer, $length);
        return $out;
    }

    /** @return array{0: string, 1: string} the message type and its body */
    private function message(): array
    {
        $head = $this->read(5);
        $length = unpack('N', substr($head, 1))[1];
        return [$head[0], $length > 4 ? $this->read($length - 4) : ''];
    }

    private function authenticate(string $user, string $password): void
    {
        for (;;) {
            [$type, $body] = $this->message();
            if ($type === 'E') {
                throw self::error($body)[0];
            }
            if ($type !== 'R') {
                throw Exception::fromState('08P01', 'unexpected message "' . $type . '" during authentication');
            }
            $method = unpack('N', $body)[1];
            if ($method === 0) {
                return;
            } elseif ($method === 3) {
                $this->send(self::frame('p', $password . "\0"));
            } elseif ($method === 5) {
                $this->send(self::frame('p', 'md5' . md5(md5($password . $user) . substr($body, 4, 4)) . "\0"));
            } else {
                throw Exception::fromState('28000', 'authentication method ' . $method . ' (SASL/SCRAM, GSS, SSPI …) is not supported by the runtime\'s pgsql client; trust, password and md5 are');
            }
        }
    }

    /**
     * Messages up to ReadyForQuery; an ErrorResponse among them is thrown after
     * it — at once when it is FATAL or PANIC (the server hangs up; no
     * ReadyForQuery follows). COPY is refused rather than left to deadlock:
     * COPY FROM STDIN is answered with CopyFail, COPY TO STDOUT's data is
     * drained, and either ends as an error.
     */
    private function untilReady(?callable $each = null): void
    {
        $this->pending = null;
        for (;;) {
            [$type, $body] = $this->message();
            if ($type === 'Z') {
                $this->status = $body;
                $error = $this->pending;
                $this->pending = null;
                if ($error) {
                    throw $error;
                }
                return;
            }
            if ($type === 'E') {
                [$exception, $severity] = self::error($body);
                if ($severity === 'FATAL' || $severity === 'PANIC') {
                    $this->pending = null;
                    throw $exception;
                }
                $this->pending ??= $exception;
            } elseif ($type === 'G') {
                $this->send(self::frame('f', "COPY FROM STDIN is not supported by the runtime's pgsql client\0"));
                $this->pending ??= Exception::fromState('0A000', 'COPY FROM STDIN is not supported by the runtime\'s pgsql client; use INSERT');
            } elseif ($type === 'H' || $type === 'W') {
                $this->pending ??= Exception::fromState('0A000', 'COPY TO STDOUT is not supported by the runtime\'s pgsql client; use SELECT');
            } elseif ($type === 'd' || $type === 'c') {
                continue; // COPY TO STDOUT's data, drained
            } elseif ($type === 'K') {
                $this->pid = unpack('N', $body)[1];
            } elseif ($type === 'S') {
                [$name, $value] = explode("\0", $body);
                $this->parameters[$name] = $value;
            } elseif ($each && !$this->pending) {
                $each($type, $body);
            }
        }
    }

    /** @return array{0: Exception, 1: string} the exception and the severity (ERROR, FATAL, PANIC …) */
    public static function error(string $body): array
    {
        $fields = [];
        for ($i = 0, $n = strlen($body); $i < $n && $body[$i] !== "\0"; $i = $end + 1) {
            $end = strpos($body, "\0", $i + 1);
            if ($end === false) {
                break; // a truncated field: keep what was read
            }
            $fields[$body[$i]] = substr($body, $i + 1, $end - $i - 1);
        }
        $severity = $fields['V'] ?? $fields['S'] ?? 'ERROR';
        $message = ($fields['S'] ?? $severity) . ':  ' . ($fields['M'] ?? 'unknown error') . (isset($fields['D']) ? "\nDETAIL:  " . $fields['D'] : '');
        return [Exception::fromState($fields['C'] ?? 'XX000', $message), $severity];
    }

    /**
     * One statement with $1… parameters (null or text), results as text.
     * @return array{fields: list<array{name: string, type: int}>, rows: list<list<?string>>, affected: int, command: string}
     */
    public function execute(string $sql, array $params): array
    {
        $this->send(self::frame('P', "\0" . $sql . "\0" . pack('n', 0)) . self::bind('', $params));
        return $this->results();
    }

    /** Parse $sql as the named prepared statement $name (pg_prepare). */
    public function prepare(string $name, string $sql): array
    {
        $this->send(self::frame('P', $name . "\0" . $sql . "\0" . pack('n', 0)) . self::frame('S', ''));
        return $this->results();
    }

    /** Run the named prepared statement $name with $params (pg_execute). */
    public function executePrepared(string $name, array $params): array
    {
        $this->send(self::bind($name, $params));
        return $this->results();
    }

    /** Bind, Describe, Execute and Sync for $statement ('' is the unnamed one). */
    private static function bind(string $statement, array $params): string
    {
        $bind = "\0" . $statement . "\0" . pack('nn', 0, count($params));
        foreach ($params as $value) {
            $bind .= $value === null ? pack('N', -1) : pack('N', strlen($value)) . $value;
        }
        $bind .= pack('n', 0);
        return self::frame('B', $bind) . self::frame('D', "P\0") . self::frame('E', "\0" . pack('N', 0)) . self::frame('S', '');
    }

    /** Statements as one simple query (several allowed: a migration); the last result's rows. */
    public function simple(string $sql): array
    {
        $this->send(self::frame('Q', $sql . "\0"));
        return $this->results();
    }

    private function results(): array
    {
        $result = ['fields' => [], 'rows' => [], 'affected' => 0, 'command' => ''];
        $this->untilReady(function (string $type, string $body) use (&$result) {
            if ($type === 'T') {
                $result = ['fields' => self::fields($body), 'rows' => [], 'affected' => 0, 'command' => ''];
            } elseif ($type === 'D') {
                $result['rows'][] = self::row($body);
            } elseif ($type === 'C') {
                $result['command'] = rtrim($body, "\0");
                $tag = explode(' ', $result['command']);
                $result['affected'] = is_numeric(end($tag)) ? (int) end($tag) : 0;
            }
        });
        return $result;
    }

    private static function fields(string $body): array
    {
        $count = unpack('n', $body)[1];
        $fields = [];
        for ($i = 0, $at = 2; $i < $count; $i++) {
            $end = strpos($body, "\0", $at);
            if ($end === false) {
                throw Exception::fromState('08P01', 'malformed RowDescription from the server');
            }
            $name = substr($body, $at, $end - $at);
            $meta = unpack('Ntable/ncolumn/Ntype/nsize/Nmod/nformat', substr($body, $end + 1, 18));
            $fields[] = ['name' => $name, 'type' => $meta['type'], 'table' => $meta['table'], 'size' => $meta['size'] > 32767 ? $meta['size'] - 65536 : $meta['size']];
            $at = $end + 19;
        }
        return $fields;
    }

    private static function row(string $body): array
    {
        $count = unpack('n', $body)[1];
        $row = [];
        for ($i = 0, $at = 2; $i < $count; $i++) {
            $length = unpack('N', substr($body, $at, 4))[1];
            $at += 4;
            if ($length === -1 || $length === 4294967295) { // NULL (-1), as 32-bit (php-wasm) and 64-bit PHP unpack it
                $row[] = null;
            } else {
                $row[] = substr($body, $at, $length);
                $at += $length;
            }
        }
        return $row;
    }

    public function close(): void
    {
        if (is_resource($this->socket)) {
            @fwrite($this->socket, self::frame('X', ''));
            fclose($this->socket);
        }
    }

    public function __destruct()
    {
        $this->close();
    }
}

class Exception extends \PDOException
{
    public static function fromState(string $state, string $message): self
    {
        $exception = new self('SQLSTATE[' . $state . ']: ' . $message);
        $exception->code = $state;
        $exception->errorInfo = [$state, 7, $message];
        return $exception;
    }
}
`,$e="/bfwc",We="/internal/shared/auto_prepend_file.php",Oo=`<?php
spl_autoload_register(static function (string $class): void {
    // Class names are case-insensitive: keys are lower-case, and so is the lookup (PDOPgsql finds pdopgsql).
    static $files = ['bfwc\\pgsql\\wire' => 'wire.php', 'bfwc\\pgsql\\exception' => 'wire.php', 'bfwc\\pgsql\\pdo' => 'pdo.php', 'bfwc\\pgsql\\statement' => 'statement.php', 'bfwc\\pgsql\\rewriter' => 'rewriter.php', 'pdo\\pgsql' => 'pdo-pgsql.php', 'bfwc\\pgsql\\pg' => 'pg.php', 'pgsql\\connection' => 'pg.php', 'pgsql\\result' => 'pg.php'];
    $file = $files[strtolower($class)] ?? null;
    if ($file !== null) {
        require_once '${$e}/pgsql/' . $file;
    }
});
require_once '${$e}/pgsql/includes.php';
if (!function_exists('pg_connect')) {
    require_once '${$e}/pgsql/functions.php';
}
\\Bfwc\\Pgsql\\Includes::register();
if (\\Bfwc\\Pgsql\\Includes::rewritesPrimary()) {
    require \\Bfwc\\Pgsql\\Includes::$primary;
    exit;
}
`,Ro={"prepend.php":Oo,"pgsql/wire.php":Po,"pgsql/pdo.php":vo,"pgsql/statement.php":To,"pgsql/includes.php":wo,"pgsql/rewriter.php":ko,"pgsql/functions.php":Eo,"pgsql/pg.php":So,"pgsql/pdo-pgsql.php":bo};function No(e){for(const[r,s]of Object.entries(Ro)){const i=`${$e}/${r}`;e.mkdirTree(i.slice(0,i.lastIndexOf("/"))),e.writeFile(i,s)}const t=`
require_once '${$e}/prepend.php';
`,n=me(e,We)?new TextDecoder().decode(e.readFile(We)):`<?php
`;n.includes(t)||e.writeFile(We,`${n.replace(/\?>\s*$/,"")}${t}`)}const Ao=e=>/^127\./.test(e)||e==="0.0.0.0"||e==="::1"||e==="localhost",Co=/^bfwc-tcp:\/\/\[?([^\]]*)\]?:(\d+)$/,Ve=0,ze=1,Jt=2,ue=3;function Io(e){return class{url;CONNECTING=Ve;OPEN=ze;CLOSING=Jt;CLOSED=ue;readyState=Ve;binaryType="arraybuffer";onopen=null;onmessage=null;onclose=null;onerror=null;listeners=new Map;channel;constructor(n){this.url=n;const r=Co.exec(n),s=r?.[1]??"",i=Number(r?.[2]);if(!r||!Ao(s)){queueMicrotask(()=>this.fail());return}e(i).then(o=>{if(!o)return this.fail();if(this.readyState!==Ve)return o.close();this.channel=o,this.readyState=ze,o.onData(a=>this.emit("message",a)),o.onClose(()=>this.ended()),this.emit("open")},()=>this.fail())}send(n){if(this.readyState!==ze||!this.channel)return;const r=n instanceof ArrayBuffer?new Uint8Array(n):new Uint8Array(n.buffer,n.byteOffset,n.byteLength);this.channel.send(r.slice())}setSocketOpt(){}close(){this.readyState===Jt||this.readyState===ue||(this.channel?.close(),this.ended())}on(n,r){return this.add(n,r,!1,!1)}once(n,r){return this.add(n,r,!0,!1)}addEventListener(n,r){this.add(n,r,!1,!0)}removeListener(n,r){return this.listeners.set(n,(this.listeners.get(n)??[]).filter(s=>s.listener!==r)),this}off(n,r){return this.removeListener(n,r)}removeEventListener(n,r){this.removeListener(n,r)}add(n,r,s,i){return this.listeners.set(n,[...this.listeners.get(n)??[],{listener:r,once:s,dom:i}]),this}emit(n,r){const s=this.listeners.get(n)??[];this.listeners.set(n,s.filter(c=>!c.once));const i=r?r.slice().buffer:void 0,o={type:n,target:this,data:i};for(const{listener:c,dom:l}of s)l?c(o):r?c(r,!0):c();const a={open:this.onopen,message:this.onmessage,close:this.onclose,error:this.onerror}[n];a?.(o)}ended(){this.readyState!==ue&&(this.readyState=ue,this.channel=void 0,queueMicrotask(()=>this.emit("close")))}fail(){this.readyState!==ue&&(this.emit("error"),this.ended())}}}function xo(e,t){const n=e.websocket??={};n.url=(s,i,o)=>`bfwc-tcp://${i.includes(":")?`[${i}]`:i}:${o}`,n.subprotocol="binary";const r=Io(t);n.decorator=()=>r}const Do=(e,t)=>`[${new Date().toUTCString()}] Failed to listen on ${e}:${t} (reason: Address already in use)
`;function $c(e){const t=e.dial?void 0:ht(e.post),n=e.dial??(s=>t.dial(s));let r="localhost";return yt(e.post,s=>{async function i(a,c){const l=await e.loadPhp({baseUrl:a.php?.baseUrl,phpVersion:At(a.php?.phpVersion)});xo(l.module,n),No(l.module.FS),gt(c,l.module.FS);const u=An(l.module.FS,d=>{s.exited||e.post({type:"fs",ops:d})});return s.mounted({apply:d=>u.quietly(()=>_t(l.module.FS,d)),flush:()=>u.flush()}),l.php.chdir(j(a.cwd)),l}async function o(a,c,l,u){const d=await i(a,l);return u.exited?{kind:"exited",code:0}:yo(d,c,{cwd:j(a.cwd),env:a.env,io:u.io,composer:a.php?.composer,fetch:e.fetch,platformKnown:$=>e.post({type:"php-platform",phpVersion:$.phpVersion,extensions:[...$.extensions]})})}return{addressInUse:a=>Do(r,a),plan(a,c){const l=kr(a.command,a.args,Tr(a.env,a.cwd,c));if(!l.ok)return{ok:!1,message:`${a.command}: ${l.reason}
`,code:1};try{At(a.php?.phpVersion)}catch(d){return{ok:!1,message:`${d.message}
`,code:1}}const u=Pr(l.invocation,j);return u.kind==="serve"&&(r=u.server.host),{ok:!0,port:u.kind==="serve"?u.server.port:void 0,run:d=>o(a,u,d,s)}},receive:a=>!!t?.receive(a)}})}function Lo(e){return[...e.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(t=>t[1]??t[2]??t[3])}function qo(e,t,n,r){if(n===null)return{ok:!0};const s=x(t,"Properties","launchSettings.json"),i=e(s);if(i===void 0)return n?{ok:!1,reason:`The launch profile "${n}" could not be applied: ${s} does not exist.`}:{ok:!0};let o;try{o=JSON.parse(i).profiles??{}}catch(d){return{ok:!1,reason:`A JSON parsing exception occurred in ${s}: ${d.message}`}}const a=n?Object.entries(o).find(([d])=>d===n):Object.entries(o).find(([,d])=>d.commandName==="Project");if(!a)return n?{ok:!1,reason:`The launch profile "${n}" could not be applied: it is not in ${s}.`}:{ok:!0};const[c,l]=a,u={};for(const[d,$]of Object.entries(l.environmentVariables??{}))u[d]=String($);return l.applicationUrl&&r.ASPNETCORE_URLS===void 0&&u.ASPNETCORE_URLS===void 0&&(u.ASPNETCORE_URLS=l.applicationUrl),{ok:!0,profile:{name:c,env:u,args:l.commandLineArgs?Lo(l.commandLineArgs):[]}}}class F extends Error{name="DotnetBundleError"}const Mo="/dotnet/refs",Xt="bfwc-dotnet-",Fn=e=>e.endsWith("/")?e:`${e}/`,Uo=e=>e instanceof Error?e.message:String(e);async function Et(e){const t=new Uint8Array(await crypto.subtle.digest("SHA-256",e));return Array.from(t,n=>n.toString(16).padStart(2,"0")).join("")}function jo(e){const t=e.Bfwc?.Host?.Exports;if(!t)throw new F("The .NET runtime bundle has no Bfwc.Host.Exports: it was not built from dotnet-host/.");return t}async function ot(e,t,n){try{return await e(t,n)}catch(r){throw new F(`The .NET runtime bundle could not be reached (${t}: ${Uo(r)}).`)}}async function Gn(e,t){const n=`${Fn(e)}manifest.json`,r=await ot(t,n);if(!r.ok)throw new F(`The .NET runtime bundle's manifest could not be loaded (${n}: HTTP ${r.status}).`);const s=await r.text();let i;try{i=JSON.parse(s)}catch{throw new F(`The .NET runtime bundle's manifest (${n}) is not JSON.`)}if(i?.format!==Ct.format)throw new F(`The .NET runtime bundle at ${e} is format ${String(i?.format)}; this runtime reads format ${Ct.format}. To get one this runtime reads, ${ft}.`);return{manifest:i,text:s}}async function Fo(e,t=fetch){return(await Gn(e,t)).manifest}async function Go(e,t){const n=globalThis.caches;if(!n)return(i,o)=>ot(t,i,o);const r=`${Xt}${(await Et(new TextEncoder().encode(e))).slice(0,32)}`;let s;try{s=await n.open(r);for(const i of await n.keys())i.startsWith(Xt)&&i!==r&&n.delete(i)}catch{s=void 0}return async(i,o)=>{const a=await s?.match(i).catch(()=>{});if(a)return a;const c=await ot(t,i,o);return c.ok&&s&&await s.put(i,c.clone()).catch(()=>{}),c}}async function Zt(e,t,n,r){const s=n.files?.[r];if(!s)throw new F(`The .NET runtime bundle's manifest has no hash for ${r}: to get a complete one, ${ft}.`);const i=await e(new URL(r,t).href);if(!i.ok)throw new F(`${r} of the .NET runtime bundle could not be loaded (HTTP ${i.status}).`);const o=new Uint8Array(await i.arrayBuffer());if(await Et(o)!==s)throw new F(`${r} of the .NET runtime bundle does not match its manifest's hash: refusing it.`);return o}async function Bo(e,t,n){const r=[];for(const s of n){const{offset:i,length:o}=s;if(!(Number.isSafeInteger(i)&&Number.isSafeInteger(o)&&i>=0&&o>=0&&i+o<=t.byteLength)||!/^[\w.-]+\.dll$/i.test(s.name))throw new F(`The "${e}" reference pack's entry ${JSON.stringify(s.name)} is out of bounds or misnamed: refusing it.`);const c=t.subarray(i,i+o);if(await Et(c)!==s.sha256)throw new F(`${e}/${s.name} does not match its manifest's hash: refusing it.`);r.push({name:s.name,bytes:c})}return r}async function hc(e){const t=e.fetch??((p,f)=>fetch(p,f)),n=Fn(e.bundleUrl),{manifest:r,text:s}=await Gn(n,t),i=await Go(s,t);await Zt(i,n,r,r.entry);const o=e.importModule??(p=>import(p)),{dotnet:a}=await o(new URL(r.entry,n).href);let c=a.withEnvironmentVariables(e.env).withModuleConfig({onExit:p=>e.onExit?.(p)});globalThis.caches&&(c=c.withResourceLoader((p,f,_,h)=>p==="dotnetjs"?void 0:i(_,h?{integrity:h}:void 0)));const l=await c.create();l.setModuleImports("bfwc",e.imports);const u=jo(await l.getAssemblyExports(r.assembly)),d=l.Module.FS,$=new Map;async function m(p){const f=$.get(p);if(f)return f;const _=r.references[p];if(!_)throw new F(`The .NET runtime bundle has no "${p}" reference assemblies.`);const h=await Bo(p,await Zt(i,n,r,_.pack),_.files),w=`${Mo}/${p}`;d.mkdirTree(w);const b=new Map;for(const k of h){const C=`${w}/${k.name}`;d.writeFile(C,k.bytes),b.set(`${p}/${k.name}`,C)}return $.set(p,b),b}return{exports:u,FS:d,manifest:r,async mountReferences(p){const f=new Map;for(const _ of new Set(p))for(const[h,w]of await m(_))f.set(h,w);return f}}}function Ho(e){const t={};for(const[n,r]of Object.entries(JSON.parse(e)))t[n.toLowerCase()]=r.length===1?r[0]:r;return t}function Wo(e){let t;const n=new Set,r=new Map,s=new Map;let i=1,o=1;const a=l=>u=>new Promise((d,$)=>{if(!t)return $(new Error("The .NET runtime is not running."));const m=i++;r.set(m,{resolve:d,reject:$}),t.Request(m,l,u.method,u.url,JSON.stringify(u.headers),u.body??new Uint8Array(0))});return{imports:{stdout:l=>e.stdout(l),stderr:l=>e.stderr(l),listen(l){return e.taken.has(l)&&!n.has(l)?!1:(e.taken.add(l),n.add(l),e.post({type:"listen",port:l}),!0)},unlisten(l){n.delete(l)&&(e.taken.delete(l),e.post({type:"unlisten",port:l}))},respondHead(l,u,d){const $=r.get(l);if(!$)return;const m=new ReadableStream({start:p=>{$.body=p},cancel:()=>{r.delete(l),t?.CancelRequest(l)}});$.resolve({status:u,headers:Ho(d),body:m})},respondChunk(l,u){r.get(l)?.body?.enqueue(u.slice())},respondEnd(l,u){const d=r.get(l);if(r.delete(l),!!d){if(!d.body)return d.reject(new Error(u??"The response ended before its head."));u?d.body.error(new Error(u)):d.body.close()}},async dial(l){const u=await e.dial(l);if(!u)return-1;const d=o++;return s.set(d,u),u.onData($=>s.has(d)&&t?.TcpData(d,$)),u.onClose(()=>{s.delete(d)&&t?.TcpClosed(d)}),d},send(l,u){s.get(l)?.send(u.slice())},hangUp(l){const u=s.get(l);s.delete(l),u?.close()}},listening:n,handlerFor:l=>n.has(l)?a(l):void 0,attach(l){t=l},stop(){t?.Stop()},closeAll(){for(const l of r.values())l.body?l.body.error(new Error("The process exited.")):l.reject(new Error("The process exited."));r.clear();for(const l of s.values())l.close();s.clear()}}}const Vo={DOTNET_CLI_TELEMETRY_OPTOUT:"1",DOTNET_NOLOGO:"1",DOTNET_SKIP_FIRST_TIME_EXPERIENCE:"1"},Bn=e=>e.outputInProject?j(e.outputPath):e.outputPath;function zo(e,t){const n=`Microsoft.AspNetCore.App ${t.runtimeVersion} [browser]
Microsoft.NETCore.App ${t.runtimeVersion} [browser]
`;switch(e){case"version":return`${t.sdkVersion}
`;case"list-sdks":return`${t.sdkVersion} [browser]
`;case"list-runtimes":return n;case"info":return`.NET SDK:
 Version:           ${t.sdkVersion}

Runtime Environment:
 OS Name:     browser
 RID:         browser-wasm

.NET runtimes installed:
${n.replace(/^/gm,"  ").trimEnd()}
`;default:return`Usage: dotnet [command] [options]

Commands available in the browser runtime:
  run        Build and run a project, or a file-based program (dotnet run app.cs).
  build      Build a project.
  clean      Remove a project's build output.
  restore    Check a project's packages against the bundled ones.
  <app.dll>  Run a built application.
`}}function Qe(e,t){const n="configuration"in t?t.configuration:"Debug";if(t.kind==="run"&&t.file)return It(e.files,z(e.cwd,t.file),n);const r=Rr(e.files,e.cwd,t.project,t.kind==="run"?"run":"build");return r.ok?It(e.files,r.path,n,t.kind==="build"?t.output:void 0):r}async function Qo(e,t){const{io:n}=t,r=i=>(n.stderr(`${i}
`),{kind:"done",code:1}),s={...Vo,...t.env};switch(e.kind){case"info":return n.stdout(zo(e.what,await t.manifest())),{kind:"done",code:0};case"exec":return{kind:"runtime",work:{env:s,run:{assembly:j(z(t.cwd,e.assembly)),args:e.appArgs,cwd:j(t.cwd)}}};case"restore":case"clean":{const i=Qe(t,e);if(!i.ok)return r(i.reason);if(e.kind==="clean"){const o=Or(i.plan);if(!o.ok)return r(o.reason);const a=o.paths.filter(c=>t.files.isFile(c));a.length&&t.sendOps(a.map(c=>({op:"remove",path:c}))),n.stdout(a.length?a.map(c=>`  Deleting file "${c}".
`).join(""):`  Nothing to clean in ${Ie(i.plan.outputPath)}.
`)}else{for(const o of i.plan.notes)n.stdout(`  ${o}
`);n.stdout(`  Restore complete: ${i.plan.projectFile} uses ${i.plan.packages.length?"bundled packages only":"no NuGet packages"}.
`)}return{kind:"done",code:0}}case"build":{const i=Qe(t,e);return i.ok?{kind:"runtime",work:{env:s,build:i.plan}}:r(i.reason)}case"run":{const i=Qe(t,e);if(!i.ok)return r(i.reason);const o=i.plan;if(o.outputKind!=="exe")return r(`Unable to run your project.
Ensure you have a runnable project type and ensure '${o.projectFile}' supports running: its OutputType is Library.`);const a=o.fileBased?{ok:!0}:qo(l=>t.files.readText(l),o.projectDir,e.launchProfile,s);if(!a.ok)return r(a.reason);const c=o.web?o.projectDir:t.cwd;return{kind:"runtime",work:{env:{...s,...a.profile?.env},build:e.noBuild?void 0:o,run:{assembly:Bn(o),args:[...a.profile?.args??[],...e.appArgs],cwd:j(c)}}}}}}function Yo(e,t,n,r=!1){const s=new Set;for(const i of e.referenceGroups)for(const o of n.references[i]?.files??[])s.add(t.get(`${i}/${o.name}`));for(const i of e.packages)for(const o of n.packages[i]?.references??[])t.has(o)&&s.add(t.get(o));return JSON.stringify({projectFile:j(e.projectFile),projectDir:j(e.projectDir),assemblyName:e.assemblyName,outputKind:e.outputKind,outputPath:Bn(e),sources:e.sources.map(j),globalUsings:e.globalUsings,references:[...s].filter(Boolean),nullable:e.nullable,allowUnsafe:e.allowUnsafe,langVersion:e.langVersion,fileBased:e.fileBased,defines:e.defines,optimize:e.optimize,warningsAsErrors:e.warningsAsErrors,noWarn:e.noWarn,quiet:r})}async function Ko(e,t,n){if(e.build){const r=e.build;for(const a of r.notes)n.stdout(`  ${a}
`);const s=[...r.referenceGroups,...r.packages.flatMap(a=>(t.manifest.packages[a]?.references??[]).map(c=>c.split("/")[0]))],i=await t.mountReferences(s),o=await t.exports.Build(Yo(r,i,t.manifest,!!e.run));if(o!==0)return e.run&&n.stderr(`
The build failed. Fix the build errors and run again.
`),o}return e.run?t.exports.Run(e.run.assembly,e.run.args,e.run.cwd):0}const en=`The .NET runtime bundle is not configured: the host must pass \`dotnet.bundleUrl\` (to get the bundle, ${ft}).`,Jo=e=>`Unhandled exception. System.IO.IOException: Failed to bind to address http://localhost:${e}: address already in use.
`;function mc(e){const t=e.dial?void 0:ht(e.post),n=e.dial??(r=>t.dial(r));return yt(e.post,r=>{const s={stdout:c=>r.io.stdout(c),stderr:c=>r.io.stderr(c)},i=Wo({post:e.post,dial:n,taken:r.takenPorts,...s});async function o(c,l,u,d){const $=await e.loadDotnet({bundleUrl:c,env:l,imports:i.imports,onExit:p=>r.exit(p),fetch:e.fetch});gt(d,$.FS);const m=An($.FS,p=>{r.exited||e.post({type:"fs",ops:p})});return r.mounted({apply:p=>m.quietly(()=>_t($.FS,p)),flush(){try{$.exports.Flush()}catch{}m.flush()}}),$.exports.Init(),i.attach($.exports),$.FS.mkdirTree(j(u)),$}const a=c=>{if(!(c instanceof F))throw c;return s.stderr(`${c.message}
`),1};return{addressInUse:Jo,receive:c=>!!t?.receive(c),plan(c){const l=Nr(c.command,c.args);if(!l.ok)return{ok:!1,message:`${l.reason}
`,code:1};const u=c.dotnet?.bundleUrl;return{ok:!0,async run(d){try{const $=await Qo(l.invocation,{files:d,cwd:c.cwd,env:c.env,io:s,sendOps:p=>e.post({type:"fs",ops:p}),manifest:()=>u?Fo(u,e.fetch):Promise.reject(new F(en))});if($.kind==="done")return{kind:"exited",code:$.code};if(!u)throw new F(en);const m=await o(u,$.work.env,c.cwd,d);return r.exited?{kind:"exited",code:1}:{kind:"running",ports:i,done:Ko($.work,m,s).catch(a)}}catch($){return{kind:"exited",code:a($)}}}}}}})}const at=["logs","diagnostics","methodology"],Hn={"path-absolute":"It is absolute.","path-parent":'It has a ".." segment.',"path-empty":"It is empty."},Xo=/^[A-Za-z]:/;function St(e){const t=e.trim();return t===""?"path-empty":t.startsWith("/")||t.startsWith("\\")||Xo.test(t)?"path-absolute":t.split(/[/\\]/).some(n=>n==="..")?"path-parent":null}function Zo(e){const t={};if(typeof e!="object"||e===null||Array.isArray(e))return t;for(const n of at){const r=e[n];typeof r=="string"&&St(r)===null&&(t[n]=r.trim())}return t}const be=e=>({supported:!1,reason:`${e} in the browser arrives in a later release.`}),N=e=>({supported:!0,provider:e}),B=e=>({supported:!1,reason:e}),tn="Infrastructure modules are applied only by a customer-cloud target (AWS, Azure, GCP).",kt={postgres:{browser:N("pglite"),cloudflare:N("neon"),aws:N("rds"),azure:N("azure-postgres"),gcp:N("cloud-sql")},redis:{browser:be("Redis"),cloudflare:N("upstash"),aws:N("elasticache"),azure:N("azure-cache"),gcp:N("memorystore")},queue:{browser:be("A queue"),cloudflare:N("cloudflare-queues"),aws:N("sqs"),azure:N("service-bus"),gcp:N("pubsub")},"object-storage":{browser:be("Object storage"),cloudflare:N("r2"),aws:N("s3"),azure:N("blob-storage"),gcp:N("gcs")},mail:{browser:be("The mail catcher"),cloudflare:N("connection"),aws:N("connection"),azure:N("connection"),gcp:N("connection")},graph:{browser:B("A graph database (Neo4j, Memgraph) has no browser stand-in that speaks its protocol."),cloudflare:B("Cloudflare hosts no graph database."),aws:N("connection"),azure:N("connection"),gcp:N("connection")},connection:{browser:N("vault"),cloudflare:N("vault"),aws:N("vault"),azure:N("vault"),gcp:N("vault")},ai:{browser:N("host-relay"),cloudflare:B("app-token"),aws:B("app-token"),azure:B("app-token"),gcp:B("app-token")},external:{browser:B(tn),cloudflare:B(tn),aws:N("opentofu"),azure:N("opentofu"),gcp:N("opentofu")}},Wn={browser:{supported:!1,reason:"Scheduled jobs arrive in a later release."},cloudflare:N("cron-triggers"),aws:N("eventbridge"),azure:N("container-apps-jobs"),gcp:N("cloud-scheduler")},gc=Object.keys(kt);function Vn(e){return typeof e=="string"&&Object.prototype.hasOwnProperty.call(kt,e)}function Tt(e,t){const n=Vn(e)?kt[e]:void 0;return n?n[t]??B(`"${t}" is not a known target.`):B(`"${e}" is not a known resource type.`)}function _c(e,t){return Tt(e,t).supported}const ea=[{name:"minute",min:0,max:59},{name:"hour",min:0,max:23},{name:"day of month",min:1,max:31},{name:"month",min:1,max:12,names:["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"],nameBase:1},{name:"day of week",min:0,max:7,names:["SUN","MON","TUE","WED","THU","FRI","SAT"],nameBase:0}],ta={"@yearly":"0 0 1 1 *","@annually":"0 0 1 1 *","@monthly":"0 0 1 * *","@weekly":"0 0 * * 0","@daily":"0 0 * * *","@midnight":"0 0 * * *","@hourly":"0 * * * *"},na=[31,29,31,30,31,30,31,31,30,31,30,31];function nn(e,t){if(/^\d+$/.test(e))return Number(e);const n=t.names?.indexOf(e.toUpperCase())??-1;return n>=0?n+(t.nameBase??0):void 0}function ra(e,t){const n=new Set;for(const r of e.split(",")){const[s,i,o]=r.split("/");if(o!==void 0||!s)return`"${r}" in the ${t.name} field is not a value, range or step.`;let a=1;if(i!==void 0){if(!/^\d+$/.test(i)||Number(i)<1)return`Step "${i}" in the ${t.name} field must be a positive whole number.`;a=Number(i)}let c,l;if(s==="*")c=t.min,l=t.max;else{const[u,d,$]=s.split("-");if($!==void 0||!u)return`"${s}" in the ${t.name} field is not a value or range.`;c=nn(u,t),l=d!==void 0?nn(d,t):i!==void 0?t.max:c}if(c===void 0||l===void 0)return`"${s}" in the ${t.name} field is not a value.`;if(c<t.min||l>t.max||c>l)return`"${s}" is outside the ${t.name} field's range ${t.min}-${t.max}.`;for(let u=c;u<=l;u+=a)n.add(u)}return[...n].sort((r,s)=>r-s)}function zn(e){const t=e.trim(),r=(ta[t.toLowerCase()]??t).split(/\s+/).filter(Boolean);if(r.length!==5)return{ok:!1,reason:`A cron schedule has 5 fields (minute hour day-of-month month day-of-week); "${t}" has ${r.length}.`};const s=[];for(let m=0;m<5;m++){const p=ra(r[m],ea[m]);if(typeof p=="string")return{ok:!1,reason:p};s.push(p)}const[i,o,a,c,l]=s,u=[...new Set(l.map(m=>m%7))].sort((m,p)=>m-p),d=!r[2].startsWith("*"),$=!r[4].startsWith("*");return d&&!$&&!c.some(m=>a.some(p=>p<=na[m-1]))?{ok:!1,reason:`"${t}" never fires: no chosen month has the chosen day.`}:{ok:!0,schedule:{source:t,minutes:i,hours:o,daysOfMonth:a,months:c,daysOfWeek:u,dayOfMonthRestricted:d,dayOfWeekRestricted:$}}}const rn=new Map;function Qn(e){let t=rn.get(e);return t||(t=new Intl.DateTimeFormat("en-US",{timeZone:e,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",second:"numeric"}),rn.set(e,t)),t}function Yn(e){try{return Qn(e),!0}catch{return!1}}function ct(e,t){if(t==="UTC")return e;const n={};for(const r of Qn(t).formatToParts(new Date(e)))r.type!=="literal"&&(n[r.type]=Number(r.value));return Date.UTC(n.year,n.month-1,n.day,n.hour%24,n.minute,n.second)}function sa(e,t){if(t==="UTC")return e;const n=new Set;for(const r of[e-864e5,e,e+864e5]){const s=ct(r,t)-r,i=e-s;ct(i,t)===e&&n.add(i)}return n.size===0?void 0:Math.min(...n)}const ve=6e4,ia=8;function oa(e,t){const n=e.daysOfMonth.includes(t.getUTCDate()),r=e.daysOfWeek.includes(t.getUTCDay());return e.dayOfMonthRestricted&&e.dayOfWeekRestricted?n||r:e.dayOfMonthRestricted?n:e.dayOfWeekRestricted?r:!0}function aa(e,t){const n=new Date(t),r=n.getUTCFullYear()+ia;for(;n.getUTCFullYear()<=r;){if(!e.months.includes(n.getUTCMonth()+1)){n.setUTCMonth(n.getUTCMonth()+1,1),n.setUTCHours(0,0,0,0);continue}if(!oa(e,n)){n.setUTCDate(n.getUTCDate()+1),n.setUTCHours(0,0,0,0);continue}if(!e.hours.includes(n.getUTCHours())){n.setUTCHours(n.getUTCHours()+1,0,0,0);continue}if(!e.minutes.includes(n.getUTCMinutes())){n.setUTCMinutes(n.getUTCMinutes()+1,0,0);continue}return n.getTime()}}function sn(e,t,n="UTC"){const r=t.getTime();let s=Math.floor(ct(r,n)/ve)*ve+ve;for(let i=0;i<1e4;i++){const o=aa(e,s);if(o===void 0)return;const a=sa(o,n);if(a!==void 0&&a>r)return new Date(a);s=o+ve}}const ca=/^(\d+)(ms|s|m|h|d)$/,la={ms:1,s:1e3,m:6e4,h:36e5,d:864e5};function Kn(e){const t=ca.exec(e.trim());if(!t)return;const n=Number(t[1])*la[t[2]];return n>0&&Number.isSafeInteger(n)?n:void 0}function ce(e){return typeof e=="string"&&e.trim().length>0}function oe(e,t,n){return e===void 0?{}:D(e)?e:(n.push(g("invalid-value",t,{detail:"Expected an object keyed by id."})),{})}function V(e,t,n,r){e!==void 0&&!(typeof e=="string"&&t.includes(e))&&r.push(g("invalid-value",n,{value:String(e),detail:`Use one of: ${t.join(", ")}.`}))}function J(e,t,n,r){e!==void 0&&typeof e!==t&&r.push(g("invalid-value",n,{value:String(e),detail:`Expected a ${t}.`}))}function ee(e,t,n){return e===void 0?[]:Array.isArray(e)&&e.every(r=>typeof r=="string")?e:(n.push(g("invalid-value",t,{detail:"Expected a list of strings."})),[])}function te(e,t,n,r){const s=e[t];if(s!=null&&s!=="")return s;r.push(g("missing-field",n,{value:t}))}function Jn(e,t,n){e!==void 0&&(typeof e!="string"||Kn(e)===void 0)&&n.push(g("invalid-duration",t,{value:String(e)}))}function he(e,t,n){for(const r of Object.keys(e))(!pn.test(r)||!Ar(r))&&n.push(g("invalid-id",`${t}.${r}`,{value:r}))}function Xn(e,t,n){const r=typeof e=="string"?zn(e):{ok:!1,reason:"Expected a string."};r.ok||n.push(g("invalid-schedule",t,{value:String(e),detail:r.reason}))}function Zn(e,t,n){e!==void 0&&!(typeof e=="string"&&Yn(e))&&n.push(g("invalid-timezone",t,{value:String(e)}))}const ua=["model","models","modelId","provider"],da=["role","workload"],fa=/[/:.]/,on={manual:["manual"],cron:["cron","timezone"],service:["service","event"]},pa='A trigger is { "manual": true }, { "cron", "timezone"? } or { "service", "event" }.';function Pt(e,t,n){for(const r of e)n.push(g("invalid-value",r.path?`${t}.${r.path}`:t,{detail:r.detail}))}function $a(e,t,n){const r=oe(e.capabilities,"capabilities",n);he(r,"capabilities",n);const s=[];for(const[o,a]of Object.entries(r)){const c=`capabilities.${o}`,l=t.get(o);if(!l){n.push(g("unknown-capability",c,{value:o}));continue}s.push(o);for(const u of l.dependsOn)Y(r,u)||n.push(g("capability-missing-dependency",c,{value:u}));Pt(l.validateConfig?.(a)??[],c,n)}const i=Cr(s,t);i.ok||n.push(g("capability-dependency-cycle","capabilities",{detail:i.cycle.join(" → ")}));for(const[o,a]of Object.entries($n(e))){const c=D(a)?a.target:void 0;if(pt.includes(c))for(const l of s)for(const u of t.get(l).requires){const d=Tt(u,c);d.supported||n.push(g("capability-unsupported-target",`environments.${o}`,{severity:"warning",value:l,detail:`It needs "${u}": ${d.reason??"unsupported"}.`}))}}}function ha(e){const t=D(e.capabilities)?e.capabilities:{},n=Y(t,Re)?t[Re]:void 0;return D(n)&&(Ir.validateConfig?.(n)??[]).length===0?n:{}}function ma(e,t,n){const r=da.filter(o=>e[o]!==void 0);if(r.length===0){n.push(g("missing-field",t,{value:"role"}));return}if(r.length>1){n.push(g("invalid-value",t,{detail:"Declare a role or a workload, not both."}));return}const s=r[0],i=e[s];typeof i=="string"&&hn.test(i)||(typeof i=="string"&&fa.test(i)?n.push(g("agent-model-id",`${t}.${s}`,{value:i})):n.push(g("invalid-value",`${t}.${s}`,{value:String(i),detail:'A role is a lowercase key, e.g. "developer".'})))}function ga(e,t,n){if(typeof e!="string"){J(e,"string",t,n);return}const r=St(e);r&&n.push(g("invalid-path",t,{value:e,detail:Hn[r]}))}function _a(e,t,n,r){const s=xr(e);if(Pt(s,t,r),!(s.length>0||!Array.isArray(e))){for(const i of e)i.startsWith(Dr)&&!Lr(i)&&r.push(g("invalid-value",t,{value:i,detail:`Environment tools: ${qr.join(", ")}.`}));r.push(...rs(e,n,t))}}function ya(e,t,n,r){const s=Mr(e);Pt(s,t,r),!(s.length>0||!D(e))&&r.push(...ss(e,n,t))}function wa(e,t,n,r){if(e!==void 0){if(!Array.isArray(e)){r.push(g("invalid-value",t,{detail:"Expected a list of triggers."}));return}e.forEach((s,i)=>{const o=`${t}.${i}`,a=D(s)?Object.keys(on).filter(u=>s[u]!==void 0):[],c=a.length===1?a[0]:void 0;if(!c||!Object.keys(s).every(u=>on[c].includes(u))){r.push(g("invalid-value",o,{detail:pa}));return}const l=s;c==="manual"?l.manual!==!0&&r.push(g("invalid-value",`${o}.manual`,{value:String(l.manual),detail:"Set it to true."})):c==="cron"?(Xn(l.cron,`${o}.cron`,r),Zn(l.timezone,`${o}.timezone`,r)):((typeof l.service!="string"||!Y(n,l.service))&&r.push(g("unknown-service",`${o}.service`,{value:String(l.service)})),ce(l.event)||r.push(g("missing-field",o,{value:"event"})))})}}function ba(e,t,n){const r=oe(e.agents,"agents",n);he(r,"agents",n);const s=Object.keys(r);if(s.length===0)return;const i=D(e.capabilities)?e.capabilities:{};Y(i,Re)||n.push(g("capability-not-enabled","agents",{value:Re}));const o=ha(e);n.push(...ns("maxAgents",s.length,o.maxAgents,"agents",`At most ${o.maxAgents} agents; ${s.length} are declared.`));for(const[a,c]of Object.entries(r)){const l=`agents.${a}`;if(!D(c)){n.push(g("invalid-value",l,{detail:"Expected an agent object."}));continue}for(const u of ua)Y(c,u)&&n.push(g("agent-model-id",`${l}.${u}`,{value:u}));ma(c,l,n),ga(c.instructions,`${l}.instructions`,n),ee(c.skills,`${l}.skills`,n),_a(c.tools,`${l}.tools`,o,n),c.memory!==void 0&&!(typeof c.memory=="string"&&pn.test(c.memory))&&n.push(g("invalid-value",`${l}.memory`,{value:String(c.memory),detail:'A memory namespace starts with a letter and has only letters, digits, "_" and "-".'})),wa(c.triggers,`${l}.triggers`,t,n),ya(c.budget,`${l}.budget`,o,n)}}const er="node",tr="browser",lt=(e,t)=>e===er&&t===tr;function nr(e,t,n,r){const s=n===er?`the ${r} target has no shell to run it`:`the ${n} runtime has no shell to run it`;return g("shell-command-unsupported",`${e}.command`,{value:t,detail:`Only node services on the ${tr} target run a command through the shell (bfsh); ${s}.`})}function De(e,t,n,r=$t(t)){if(r.kind==="invalid")return[g("invalid-value",`${e}.command`,{value:t,detail:`The command line cannot be read: ${r.reason}.`})];const s=[];return r.kind==="shell"&&n!==void 0&&n.length>0&&s.push(g("shell-command-with-args",`${e}.args`,{value:t})),r.strayBackslash&&s.push(g("command-backslash",`${e}.command`,{severity:"warning",value:t})),s}function va(e){return e.code==="command-backslash"}function Ea(e,t,n,r){const s=t.args??[],i=`services.${e}`,o=$t(t.command);if(r.push(...De(i,t.command,s,o)),o.kind==="argv"){const[a,...c]=o.argv,l=[...c,...s];return l.length>0?{command:a,args:l}:{command:a}}if(o.kind==="shell"){if(lt(t.runtime,n)&&s.length===0)return{command:"bfsh",args:["-c",o.line]};lt(t.runtime,n)||r.push(nr(i,t.command,t.runtime,n))}return s.length>0?{command:t.command,args:[...s]}:{command:t.command}}function Sa(e,t,n,r){const s=t.run;if(!s||typeof s.command!="string")return[];const i=`jobs.${e}.run`,o=$t(s.command),a=De(i,s.command,void 0,o),c=n[s.service]?.runtime;return o.kind==="shell"&&c!==void 0&&Wn[r].supported&&!lt(c,r)&&a.push(nr(i,s.command,c,r)),a}const ka=["http","port","query","exitZero","started"],Ta=["redis","native"],Pa=["neo4j","memgraph","age"],Oa=["frontend","backend"],Ra=["never","on-failure","always"],rr=["session","always-on"],Na=["concurrency","cpu","requests"],Aa=["allow","forbid","replace"],Ca=["skip","run-once"];function Ia(e,t){for(const[n,r]of Object.entries(e)){const s=`resources.${n}`;if(!D(r)){t.push(g("invalid-value",s,{detail:"Expected a resource object."}));continue}const i=te(r,"type",s,t);if(i!==void 0){if(!Vn(i)){t.push(g("unknown-resource-type",`${s}.type`,{value:String(i)}));continue}switch((i==="postgres"||i==="redis")&&J(r.persistent,"boolean",`${s}.persistent`,t),i){case"postgres":ee(r.extensions,`${s}.extensions`,t),J(r.name,"string",`${s}.name`,t);break;case"redis":r.maxMemoryMb!==void 0&&!(typeof r.maxMemoryMb=="number"&&r.maxMemoryMb>0)&&t.push(g("invalid-value",`${s}.maxMemoryMb`,{value:String(r.maxMemoryMb),detail:"Expected a positive number."}));break;case"queue":{const o=te(r,"engine",s,t);if(V(o,Ta,`${s}.engine`,t),o==="redis"){const a=typeof r.on=="string"?e[r.on]:void 0;(!D(a)||a.type!=="redis")&&t.push(g("invalid-queue-host",`${s}.on`,{value:r.on===void 0?void 0:String(r.on)}))}break}case"graph":V(te(r,"engine",s,t),Pa,`${s}.engine`,t);break;case"connection":ce(r.connection)||t.push(g("missing-field",s,{value:"connection"}));break;case"ai":ee(r.models,`${s}.models`,t);break;case"external":ce(r.module)||t.push(g("missing-field",s,{value:"module"})),ee(r.outputs,`${s}.outputs`,t);break}}}}function xa(e,t,n){if(e===void 0)return;if(!D(e)){n.push(g("invalid-readiness",t));return}const r=ka.filter(s=>e[s]!==void 0);r.length!==1?n.push(g("invalid-readiness",t,{detail:r.length>1?`It names ${r.join(" and ")}.`:void 0})):(r[0]==="http"?!(typeof e.http=="string"&&e.http.startsWith("/")):e[r[0]]!==!0)&&n.push(g("invalid-readiness",`${t}.${r[0]}`,{detail:r[0]==="http"?'An http check names a path starting with "/".':"Set it to true."})),Jn(e.timeout,`${t}.timeout`,n)}function Da(e,t,n){const r=new Map;for(const[s,i]of Object.entries(e)){const o=`services.${s}`;if(!D(i)){n.push(g("invalid-value",o,{detail:"Expected a service object."}));continue}if(Y(t,s)&&n.push(g("duplicate-id",o,{value:s})),ce(i.runtime)||n.push(g("missing-field",o,{value:"runtime"})),ce(i.command)?n.push(...De(o,i.command,Array.isArray(i.args)?i.args:void 0)):n.push(g("missing-field",o,{value:"command"})),J(i.root,"string",`${o}.root`,n),ee(i.args,`${o}.args`,n),i.port!==void 0){const a=i.port;typeof a!="number"||!Number.isInteger(a)||a<1||a>65535?n.push(g("invalid-port",`${o}.port`,{value:String(a)})):r.set(a,[...r.get(a)??[],s])}V(i.role,Oa,`${o}.role`,n);for(const a of ee(i.uses,`${o}.uses`,n))Y(t,a)?i.role==="frontend"&&n.push(g("frontend-uses-credentials",`${o}.uses`,{value:a,severity:"warning"})):n.push(g("unknown-resource",`${o}.uses`,{value:a}));for(const a of ee(i.dependsOn,`${o}.dependsOn`,n))Y(e,a)||n.push(g("unknown-service",`${o}.dependsOn`,{value:a}));xa(i.readiness,`${o}.readiness`,n),V(i.restart,Ra,`${o}.restart`,n),i.env!==void 0&&!(D(i.env)&&Object.values(i.env).every(a=>typeof a=="string"))&&n.push(g("invalid-value",`${o}.env`,{detail:"Expected an object of string values."})),V(i.availability,rr,`${o}.availability`,n),La(i.scale,`${o}.scale`,n)}for(const[s,i]of r)i.length>1&&n.push(g("duplicate-port","services",{value:String(s),detail:`Claimed by ${i.join(", ")}.`}))}function La(e,t,n){if(e===void 0)return;if(!D(e)){n.push(g("invalid-value",t,{detail:"Expected an object."}));return}const r=s=>s===void 0||typeof s=="number"&&Number.isInteger(s)&&s>=0;!r(e.min)||!r(e.max)?n.push(g("invalid-value",t,{detail:"min and max are whole numbers of instances."})):typeof e.min=="number"&&typeof e.max=="number"&&e.min>e.max&&n.push(g("invalid-value",t,{detail:"min is above max."})),V(e.metric,Na,`${t}.metric`,n)}function qa(e,t,n){for(const[r,s]of Object.entries(e)){const i=`jobs.${r}`;if(!D(s)){n.push(g("invalid-value",i,{detail:"Expected a job object."}));continue}const o=te(s,"schedule",i,n);o!==void 0&&Xn(o,`${i}.schedule`,n),Zn(s.timezone,`${i}.timezone`,n),s.run!==void 0&&s.invoke!==void 0?n.push(g("invalid-value",i,{detail:"A job either runs a command or invokes an endpoint, not both."})):s.run===void 0&&s.invoke===void 0&&n.push(g("missing-field",i,{value:"run"}));const a=s.run??s.invoke,c=`${i}.${s.run!==void 0?"run":"invoke"}`;if(a!==void 0&&!D(a))n.push(g("invalid-value",c,{detail:"Expected an object."}));else if(D(a)){const l=te(a,"service",c,n),u=typeof l=="string"?t[l]:void 0;l!==void 0&&u===void 0&&n.push(g("unknown-service",`${c}.service`,{value:String(l)})),s.run!==void 0?ce(a.command)?n.push(...De(c,a.command,void 0)):n.push(g("missing-field",c,{value:"command"})):(typeof a.path=="string"&&a.path.startsWith("/")||n.push(g("invalid-value",`${c}.path`,{value:a.path===void 0?void 0:String(a.path),detail:'An endpoint path starts with "/".'})),V(a.method,gn,`${c}.method`,n),D(u)&&u.port===void 0&&n.push(g("invoke-without-port",c,{value:String(l)})))}V(s.concurrency,Aa,`${i}.concurrency`,n),Jn(s.timeout,`${i}.timeout`,n),V(s.missed,Ca,`${i}.missed`,n),V(s.availability,rr,`${i}.availability`,n)}}function Ma(e,t,n){if(e===void 0)return;const r=D(e)?e.routes:void 0;if(!Array.isArray(r)){n.push(g("invalid-value","ingress",{detail:'Expected { "routes": [...] }.'}));return}r.forEach((s,i)=>{const o=`ingress.routes.${i}`;!D(s)||!(typeof s.path=="string"&&s.path.startsWith("/"))?n.push(g("invalid-value",o,{detail:'A route has a path starting with "/" and a service.'})):(typeof s.service!="string"||!Y(t,s.service))&&n.push(g("unknown-service",`${o}.service`,{value:String(s.service)}))})}function Ua(e,t){oe(e.environments,"environments",t);for(const[n,r]of Object.entries($n(e))){const s=`environments.${n}`;if(!D(r)){t.push(g("invalid-value",s,{detail:"Expected an environment object."}));continue}const i=te(r,"target",s,t);i!==void 0&&!pt.includes(i)&&t.push(g("unknown-target",`${s}.target`,{value:String(i)}));const o=te(r,"tier",s,t);o!==void 0&&!mn.includes(o)&&t.push(g("invalid-tier",`${s}.tier`,{value:String(o)})),J(r.debug,"boolean",`${s}.debug`,t),J(r.connection,"string",`${s}.connection`,t),o==="production"&&r.debug===!0&&t.push(g("debug-in-production",`${s}.debug`,{value:n})),t.push(...Ur(e,n,r))}}function ja(e,t){if(e!==void 0){if(!D(e)){t.push(g("invalid-value","paths",{severity:"warning",detail:"Expected an object with logs, diagnostics or methodology."}));return}for(const[n,r]of Object.entries(e)){const s=`paths.${n}`;if(!at.includes(n))t.push(g("invalid-value",s,{severity:"warning",detail:`Use one of: ${at.join(", ")}.`}));else if(typeof r!="string")t.push(g("invalid-value",s,{severity:"warning",value:String(r),detail:"Expected a string."}));else{const i=St(r);i&&t.push(g("invalid-path",s,{severity:"warning",value:r,detail:Hn[i]}))}}}}function sr(e,t={}){const n=[],r=e;r.version!==1&&n.push(g("unsupported-version","version",{value:String(r.version)})),J(r.name,"string","name",n),J(r.$schema,"string","$schema",n);const s=oe(r.resources,"resources",n),i=oe(r.services,"services",n),o=oe(r.jobs,"jobs",n);return he(s,"resources",n),he(i,"services",n),he(o,"jobs",n),Ia(s,n),Da(i,s,n),qa(o,i,n),Ma(r.ingress,i,n),Ua(e,n),ja(r.paths,n),$a(e,t.capabilities??Ke,n),ba(e,i,n),n}function yc(e,t={}){let n;try{n=JSON.parse(e.replace(/^﻿/,""))}catch(c){return{manifest:null,issues:[g("invalid-json","",{detail:c instanceof Error?c.message:String(c)})]}}if(!D(n))return{manifest:null,issues:[g("not-an-object","")]};if(n.version===void 0)return{manifest:null,legacy:n,issues:[g("legacy-format","version",{severity:"info"})]};if(n.version!==1)return{manifest:null,issues:[g("unsupported-version","version",{value:JSON.stringify(n.version)})]};const r=sr(n,t);if(n.paths===void 0)return{manifest:n,issues:r};const{paths:s,...i}=n,o=Zo(s);return{manifest:Object.keys(o).length?{...i,paths:o}:i,issues:r}}const Fa={node:[{name:"NODE_ENV",values:{production:"production",development:"development",debug:"development"}}],php:[{name:"APP_ENV",values:{production:"production",development:"local",debug:"local"}},{name:"APP_DEBUG",values:{production:"false",development:"false",debug:"true"}}],dotnet:[{name:"ASPNETCORE_ENVIRONMENT",values:{production:"Production",development:"Development",debug:"Development"}},{name:"DOTNET_ENVIRONMENT",values:{production:"Production",development:"Development",debug:"Development"}}],python:[{name:"FLASK_DEBUG",values:{production:"0",development:"0",debug:"1"}},{name:"DJANGO_DEBUG",values:{production:"False",development:"False",debug:"True"}},{name:"PYTHONDEVMODE",values:{debug:"1"}}],rust:[{name:"RUST_LOG",values:{production:"info",development:"info",debug:"debug"}}]};function Ot(e){return e.tier==="non-production"&&e.debug===!0}function Ga(e){return e.tier==="production"?"production":Ot(e)?"debug":"development"}function Ba(e,t){const n=Ga(t),r={BUILDERFORCE_ENV:t.name,BUILDERFORCE_TIER:t.tier,BUILDERFORCE_DEBUG:String(Ot(t))};for(const s of Fa[e]??[]){const i=s.values[n];i!==void 0&&(r[s.name]=i)}return r}function wc(e){return e.tier!=="non-production"?"off":Ot(e)?"verbose":"basic"}const Ha={postgres:5432},ir=new Set(["connection","ai"]);function Wa(e){const t=e.timeout===void 0?void 0:Kn(e.timeout),n=t===void 0?{}:{timeoutMs:t};if("http"in e)return{kind:"http",path:e.http,...n};if("port"in e)return{kind:"port",...n};if("query"in e)return{kind:"query",...n};if("exitZero"in e)return{kind:"exit-zero",...n};if("started"in e)return{kind:"started",...n}}function Va(e,t){let n=e;for(;t.has(n);)n++;return t.add(n),n}function za(e,t,n,r,s,i){const o=(t.uses??[]).filter(d=>r.has(d)),a=[...new Set([...t.dependsOn??[],...o])],c=(t.uses??[]).flatMap(d=>{const $=s[d];if(!$||!ir.has($.type))return[];const m={id:d,type:$.type};return $.type==="ai"&&$.models&&(m.models=[...$.models]),[m]}),l=t.readiness?Wa(t.readiness):t.port===void 0&&t.restart==="always"?{kind:"started"}:void 0,u={id:e,type:"application",runtime:t.runtime,env:{...Ba(t.runtime,n),...t.env}};return t.role&&(u.role=t.role),t.root&&(u.root=t.root),t.command?Object.assign(u,Ea(e,t,n.target,i)):t.args&&(u.args=[...t.args]),t.port!==void 0&&(u.port=t.port),a.length>0&&(u.dependsOn=a),l&&(u.readiness=l),t.restart&&(u.restartPolicy=t.restart),c.length>0&&(u.resourceUses=c),u}function Qa(e,t,n,r){return{id:e,type:"database",runtime:n,port:r,database:{engine:"postgres",provider:n,persistent:t.persistent??!1,...t.name?{name:t.name}:{}}}}function Ya(e){if(e.code.startsWith("ingress-"))return g("spec","ingress",{spec:e});const t="serviceId"in e?e.serviceId:void 0;return g("spec",t?`services.${t}`:"services",{spec:e})}function bc(e,t,n){const r=jr(e,t),s=[...sr(e).filter(w=>!va(w)),...r.issues],i=r.manifest,o=r.environment;if(!i||!o||xt(s))return{spec:null,environment:o,declined:[],issues:Dt(s)};const a=i.resources??{},c=i.services??{},l=[],u=[],d=new Set,$=new Set(Object.values(c).flatMap(w=>w.port===void 0?[]:[w.port]));for(const[w,b]of Object.entries(a)){const k=Tt(b.type,o.target);if(!k.supported){l.push({id:w,reason:k.reason??`The ${o.target} target does not host "${b.type}" resources.`});continue}const C=Ha[b.type];b.type==="postgres"&&C!==void 0&&k.provider?(u.push(Qa(w,b,k.provider,Va(C,$))),d.add(w)):ir.has(b.type)||l.push({id:w,reason:`"${b.type}" resources on ${o.target} are provisioned by its deployment, not run by the application runtime.`})}for(const[w,b]of Object.entries(c))u.push(za(w,b,o,d,a,s));const m=D(i.jobs)?Object.keys(i.jobs):[];for(const[w,b]of Object.entries(i.jobs??{}))s.push(...Sa(w,b,c,o.target));const p=Wn[o.target];if(!p.supported)for(const w of m)s.push(g("jobs-not-run",`jobs.${w}`,{severity:"warning",detail:p.reason}));const f={projectId:n.projectId,services:u};i.name!==void 0&&(f.name=i.name);const _=i.ingress?.routes??[];_.length>0&&(f.ingress={routes:_.map(w=>({path:w.path,serviceId:w.service}))}),s.push(...Fr(f).map(Ya));const h=Dt(s);return{spec:xt(h)?null:f,environment:o,declined:l,issues:h}}const or="^[A-Za-z][A-Za-z0-9_-]*$",Ka="^\\d+(ms|s|m|h|d)$",H=e=>({$ref:`#/$defs/${e}`}),Ee=e=>({type:"object",propertyNames:{pattern:or},additionalProperties:H(e)}),X={type:"array",items:{type:"string"}},an={enum:["session","always-on"]},cn={type:"string",pattern:hn.source},Ye=(e,t)=>({type:"object",properties:e,required:t,additionalProperties:!1}),Q=(e,t={},n=[])=>({type:"object",properties:{type:{const:e},...t},required:["type",...n],additionalProperties:!1}),de=(e,t)=>({type:"object",properties:{[e]:t,timeout:H("duration")},required:[e],additionalProperties:!1}),vc={$schema:"https://json-schema.org/draft/2020-12/schema",$id:Hr,title:"Builderforce app manifest v1 (builderforce.json)",type:"object",properties:{$schema:{type:"string"},version:{const:1},name:{type:"string"},resources:Ee("resource"),services:Ee("service"),jobs:Ee("job"),ingress:H("ingress"),environments:{type:"object",additionalProperties:H("environment")},paths:H("paths"),capabilities:{type:"object",properties:Object.fromEntries(Ke.ids().map(e=>[e,Ke.get(e).configSchema]))},agents:Ee("agent")},required:["version"],additionalProperties:!1,$defs:{duration:{type:"string",pattern:Ka},budget:Br,trigger:{oneOf:[Ye({manual:{const:!0}},["manual"]),Ye({cron:{type:"string",minLength:1},timezone:{type:"string"}},["cron"]),Ye({service:{type:"string"},event:{type:"string",minLength:1}},["service","event"])]},agent:{type:"object",properties:{role:cn,workload:cn,instructions:{type:"string",description:"Project-relative. No absolute path, no .. segment."},skills:X,tools:Gr,memory:{type:"string",pattern:or},triggers:{type:"array",items:H("trigger")},budget:H("budget")},oneOf:[{required:["role"]},{required:["workload"]}],additionalProperties:!1},resource:{oneOf:[Q("postgres",{persistent:{type:"boolean"},extensions:X,name:{type:"string"}}),Q("redis",{persistent:{type:"boolean"},maxMemoryMb:{type:"number",exclusiveMinimum:0}}),Q("queue",{engine:{enum:["redis","native"]},on:{type:"string"}},["engine"]),Q("object-storage"),Q("mail"),Q("graph",{engine:{enum:["neo4j","memgraph","age"]}},["engine"]),Q("connection",{connection:{type:"string",minLength:1}},["connection"]),Q("ai",{models:X}),Q("external",{module:{type:"string",minLength:1},outputs:X},["module"])]},readiness:{oneOf:[de("http",{type:"string",pattern:"^/"}),de("port",{const:!0}),de("query",{const:!0}),de("exitZero",{const:!0}),de("started",{const:!0})]},service:{type:"object",properties:{runtime:{type:"string",minLength:1},root:{type:"string"},command:{type:"string",minLength:1},args:X,port:{type:"integer",minimum:1,maximum:65535},role:{enum:["frontend","backend"]},uses:X,dependsOn:X,readiness:H("readiness"),restart:{enum:["never","on-failure","always"]},env:{type:"object",additionalProperties:{type:"string"}},availability:an,scale:{type:"object",properties:{min:{type:"integer",minimum:0},max:{type:"integer",minimum:0},metric:{enum:["concurrency","cpu","requests"]}},additionalProperties:!1}},required:["runtime","command"],additionalProperties:!1},job:{type:"object",properties:{schedule:{type:"string",minLength:1},timezone:{type:"string"},run:{type:"object",properties:{service:{type:"string"},command:{type:"string",minLength:1}},required:["service","command"],additionalProperties:!1},invoke:{type:"object",properties:{service:{type:"string"},method:{enum:[...gn]},path:{type:"string",pattern:"^/"}},required:["service","path"],additionalProperties:!1},concurrency:{enum:["allow","forbid","replace"]},timeout:H("duration"),missed:{enum:["skip","run-once"]},availability:an},required:["schedule"],oneOf:[{required:["run"]},{required:["invoke"]}],additionalProperties:!1},ingress:{type:"object",properties:{routes:{type:"array",items:{type:"object",properties:{path:{type:"string",pattern:"^/"},service:{type:"string"}},required:["path","service"],additionalProperties:!1}}},required:["routes"],additionalProperties:!1},overrides:{type:"object",properties:{services:{type:"object",additionalProperties:{type:"object"}},resources:{type:"object",additionalProperties:{type:"object"}},jobs:{type:"object",additionalProperties:{type:"object"}}},additionalProperties:!1},paths:{type:"object",properties:{logs:{type:"string",description:"Project-relative. Default .builderforce/logs. No absolute path, no .. segment."},diagnostics:{type:"string",description:"Project-relative. Default .builderforce/diagnostics. No absolute path, no .. segment."},methodology:{type:"string",description:"Project-relative. Default .builderforce/methodology. No absolute path, no .. segment."}},additionalProperties:!1},environment:{type:"object",properties:{target:{enum:[...pt]},connection:{type:"string"},tier:{enum:[...mn]},debug:{type:"boolean"},overrides:H("overrides")},required:["target","tier"],if:{properties:{tier:{const:"production"}}},then:{properties:{debug:{const:!1}}},additionalProperties:!1}}},Ja=2**31-1,Xa=6e4,Za="UTC",ec="allow",tc="skip";function Ec(e){const t=[];for(const[n,r]of Object.entries(e.jobs??{}))t.push({id:`job:${n}`,source:"job",target:n,cron:r.schedule,timeZone:r.timezone,concurrency:r.concurrency,missed:r.missed});for(const[n,r]of Object.entries(e.agents??{}))(r.triggers??[]).forEach((s,i)=>{"cron"in s&&t.push({id:`agent:${n}:${i}`,source:"agent",target:n,cron:s.cron,timeZone:s.timezone})});return t}function Sc(e){const t=e.now??(()=>new Date),n=e.setTimer??((h,w)=>setTimeout(h,w)),r=e.clearTimer??(h=>clearTimeout(h)),{lease:s}=e,i=[],o=[];for(const h of e.triggers){const w=zn(h.cron),b=h.timeZone??Za;w.ok?Yn(b)?o.push({trigger:h,schedule:w.schedule,timeZone:b,watermark:e.since?.getTime(),handle:void 0,running:new Set}):i.push({trigger:h,reason:`"${b}" is not an IANA time zone.`}):i.push({trigger:h,reason:w.reason})}let a=!1,c=!1,l;function u(){for(const h of o)h.handle!==void 0&&r(h.handle),h.handle=void 0;l=void 0}function d(){const h=s.state;if(!a||h.kind!=="owner"||h.fencingToken===l)return;l!==void 0&&p(),l=h.fencingToken;const w=t().getTime();for(const b of o)b.watermark??=w,f(b)}function $(h,w){const b=Math.max(0,w-t().getTime());h.handle=n(()=>{h.handle=void 0,f(h)},Math.min(b,Ja))}function m(){const h=s.state;return l!==void 0&&h.kind==="owner"&&h.fencingToken===l&&s.assertFence(l)?!0:(p(),!1)}function p(){u();for(const h of o)h.watermark=void 0}function f(h){if(!a||!m())return;const w=t().getTime(),b=h.watermark??w,k=sn(h.schedule,new Date(b),h.timeZone);if(k===void 0)return;if(k.getTime()>w){$(h,k.getTime());return}const C=sn(h.schedule,new Date(Math.max(b,w-Xa)),h.timeZone),S=C!==void 0&&C.getTime()<=w?C:void 0;h.watermark=w,(S===void 0||k.getTime()<S.getTime())&&(h.trigger.missed??tc)==="skip"&&e.onSkip?.(h.trigger,k,"missed"),S?_(h,S):h.trigger.missed==="run-once"&&_(h,k),f(h)}function _(h,w){const b=h.trigger.concurrency??ec;if(b==="forbid"&&h.running.size>0){e.onSkip?.(h.trigger,w,"overlap");return}if(b==="replace")for(const S of h.running)S.abort();const k=new AbortController;h.running.add(k);let C;try{C=e.onFire(h.trigger,w,k.signal)}catch(S){C=Promise.reject(S)}C.then(()=>h.running.delete(k),S=>{h.running.delete(k),e.onError(S,h.trigger,w)})}return{invalid:i,start(){a||(a=!0,c||(c=!0,s.onOwner(d)),d())},stop(){a=!1,u()}}}function kc(e,t,n={}){const r=n.task??((s,i)=>`Scheduled run of ${s.target} (${s.cron}) for ${i.toISOString()}`);return async(s,i,o)=>{if(s.source!=="agent")throw new Error(`Trigger ${s.id} is not an agent trigger.`);const{runId:a}=await e.start(s.target,{task:r(s,i),correlation:{...t,agentId:s.target,correlationId:`${s.id}@${i.toISOString()}`}});let c;const l=()=>{c??=e.cancel(a).then(()=>{},d=>({error:d}))};o.aborted?l():o.addEventListener("abort",l,{once:!0});try{for await(const d of e.events(a));}finally{o.removeEventListener("abort",l)}const u=await c;if(u)throw u.error}}export{qe as ACTIVE_STATES,Ir as AGENTS_CAPABILITY,Re as AGENTS_CAPABILITY_ID,Oc as AGENTS_POLICY_SCHEMA,Rc as AGENT_BUDGET_KEYS,Br as AGENT_BUDGET_SCHEMA,hn as AGENT_ROLE_PATTERN,Hr as APP_MANIFEST_SCHEMA_URL,vc as APP_MANIFEST_SCHEMA_V1,Nc as ApplicationSpecError,vn as ApplicationStartError,Ke as BUILTIN_CAPABILITIES,Xt as BUNDLE_CACHE_PREFIX,Ac as CHILD_RUNTIMES_CAPABILITY,Cc as CHILD_RUNTIMES_CAPABILITY_ID,Ic as CHILD_RUNTIMES_CONFIG_SCHEMA,xc as CREDENTIAL_POLICY,Dc as DATABASE_PROVIDER_DEFAULTS,Lc as DATABASE_URL_SCHEMES,qc as DEFAULT_ENVIRONMENTS,lc as DEFAULT_PGLITE_URL,Mc as DEFAULT_PHP_VERSION,Uc as DEFAULT_PHP_WASM_BASE_URL,xs as DEFAULT_PYODIDE_INDEX_URL,Xi as DEFAULT_REPOSITORY_URL,ls as DEFAULT_RESTART_LIMITS,re as DIST_LIMITS,Ct as DOTNET_BUNDLE,jc as DOTNET_COMMAND_PATTERN,Vo as DOTNET_ENV,ou as DOTNET_KIND,Fc as DatabaseCoordinationError,W as DistRefused,F as DotnetBundleError,mn as ENVIRONMENT_TIERS,we as FRONT_SCRIPT,gn as HTTP_METHODS,os as IllegalTransitionError,bt as InvalidPackageName,Wn as JOB_CAPABILITIES,pt as MANIFEST_TARGETS,st as MAX_RESPONSE_BYTES,Ja as MAX_TIMER_DELAY_MS,Gc as NATIVE_ONLY_PACKAGES,Bc as NODE_DECLINED_COMMANDS,Hc as NODE_READINESS,Xa as ON_TIME_TOLERANCE_MS,Fs as OPEN_FILE_SYNC_MS,Hn as PATH_ISSUE_DETAIL,Cs as PGLITE_VERSION,Wc as PGSQL_REASON,Vc as PHP_COMMAND_PATTERN,au as PHP_KIND,zc as PHP_WASM_EXTENSIONS,Qc as PHP_WASM_RELEASES,Yc as PHP_WASM_VERSION,cu as PIP_RECORD_LIMITS,K as PROJECT_MOUNT,Is as PYODIDE_VERSION,Kc as PYTHON_COMMAND_PATTERN,Mo as REFERENCE_ROOT,kt as RESOURCE_CAPABILITIES,gc as RESOURCE_TYPES,$e as RUNTIME_LIBRARY_ROOT,Jc as RUNTIME_PROVIDED_PACKAGES,Xc as RUST_COMPILE_GATE,lu as RUST_KIND,Zc as RUST_PROFILE,Z as ResolveError,Rn as SEND_HIGH_WATER_MARK,el as SERVER_COMMANDS,is as SERVICE_TRANSITIONS,tl as STATE_CAPABILITY,nl as STATE_CAPABILITY_ID,rl as STATE_CONFIG_SCHEMA,sl as STATE_POLICY_DEFAULTS,il as STATE_STRATEGIES,ol as SUPPORTED_PHP_VERSIONS,fe as ServiceFailure,uu as ServiceGraphPolicy,Fa as TIER_ENV_CONVENTIONS,al as TOOL_KEY_PATTERN,Gr as TOOL_LIST_SCHEMA,Xe as TRAINING_ARTIFACT_DIR,du as TRAINING_SINK_DEFAULTS,wi as VIRTUAL_TCP_MODULE,at as WORKSPACE_PATH_KEYS,fs as acceptApplication,cl as acceptsDotnetService,ll as acceptsNodeService,ul as acceptsPgliteService,dl as acceptsPhpService,fl as acceptsPythonService,pl as acceptsRustService,kc as agentTriggerFire,fu as allowedTools,pu as artifactKeyId,$l as assertValidSpec,ac as bodyChunks,Mr as budgetIssues,ss as budgetWideningIssues,as as canTransition,io as checkDistUrl,ae as checkPackageName,At as checkPhpVersion,hl as claimDatabase,Ec as collectTriggers,vr as compareVersions,Yo as compilePlan,As as connectionSecretsUnfilled,ns as countWideningIssues,ml as createCapabilityRegistry,_i as createChannelTransport,yi as createDialTransport,Wo as createDotnetBridge,$u as createDotnetProcessKind,gl as createDotnetProvider,mc as createDotnetWorkerProcess,Sc as createJobScheduler,cs as createLifecycle,_l as createNodeProvider,co as createPackageSource,yl as createPgliteProvider,hu as createPhpProcessKind,wl as createPhpProvider,$c as createPhpWorkerProcess,mu as createPipRecord,ds as createProviderRegistry,gu as createPythonProcessKind,bl as createPythonProvider,fc as createPythonWorkerProcess,_u as createRustProcessKind,vl as createRustProvider,sc as createTrainingArtifactStore,yu as createTrainingChannel,wu as createTrainingSink,El as databaseName,Sl as databaseUrl,ji as declaredClasses,Gi as dependencyOrder,Us as describeInstall,kl as describeIssue,Tl as describeManifestIssue,wc as diagnosticsLevel,Io as dialSocketClass,Hi as encodePackageName,Pl as envName,$n as environmentsOf,Ol as evaluateCondition,to as expandMinified,Rl as expandProperties,Nl as expectedPlatform,Rr as findProject,Al as frameworkDefines,ke as fromPhpPath,dc as fromPyodidePath,uo as frontScript,Yt as githubRepository,Cl as globMatcher,Xs as headersOf,Il as ingressPathKey,xl as ingressTable,xo as installPhpSockets,Js as installPythonExtensions,Ze as installRequirements,No as installRuntimeLibrary,vi as installVirtualSockets,Dl as isDotnetCommand,Ao as isLocalAddress,Ll as isPhpCommand,Oe as isPlatformPackage,ql as isPythonCommand,Vn as isResourceType,Ml as isRustCommand,Yn as isValidTimeZone,hc as loadDotnetRuntime,Ul as loadPhpRuntime,uc as loadPyodideRuntime,zi as lockText,xt as manifestHasErrors,br as mapInvocationPaths,Pr as mapPhpInvocationPaths,jl as mayConnectToDatabase,Fl as mergeOverrides,bu as narrowChildPolicy,cc as narrowHostRelay,Gl as nativeOnlyReason,sn as nextFire,mr as noWheelReason,ln as normalizeName,Bl as orderByDependencies,Cr as orderCapabilities,qs as packagesWithoutWheels,fn as parseConstraint,zn as parseCron,Nr as parseDotnetCommand,Kn as parseDuration,Hl as parseFileBasedProgram,yc as parseManifest,kr as parsePhpCommand,Wl as parseProjectFile,Vl as parsePyproject,wr as parsePythonCommand,yr as parseRequirement,zl as parseRequirementsTxt,Ql as parseRustCommand,Yl as parseServerCommand,dt as parseVersion,Kl as pgliteDataDir,ie as phpLiteral,tt as phpString,Tr as phpSurroundings,Jl as phpWasmModuleUrls,zt as pickVersion,It as planBuild,hr as planRequirements,dn as platformShortfall,Qo as prepareInvocation,bi as pythonTcpModule,xn as rankVersions,Ce as readCapped,qo as readLaunchProfile,Fo as readManifest,un as readProjectRequirements,_r as readRequirementFile,cr as readinessOf,ar as receivesDatabaseCredentials,Ht as requireArguments,jr as resolveEnvironment,z as resolveFrom,Qi as resolvePackages,Tt as resourceCapability,us as restartDecision,lr as restartPolicyOf,ur as roleOf,Yi as rootRequirements,po as routeRequest,Ji as runComposer,Ko as runWithRuntime,Vi as runtimePackages,Xl as satisfies,pr as serviceEnv,Vr as serviceGraph,Zl as serviceMap,Et as sha256Hex,eu as shellCommandWords,Lo as splitArgs,$t as splitCommandLine,oc as startApplicationRuntime,tu as startDatabaseHost,ho as startPhpWebServer,ei as startPythonAppServer,ti as startRequestedAppServer,_c as targetSupports,Ba as tierEnv,Ga as tierMode,bc as toApplicationSpec,j as toPhpPath,_e as toPyodidePath,Wa as toReadinessSpec,nu as tomlStringArray,ru as tomlTable,xr as toolListIssues,rs as toolWideningIssues,An as trackPhpWrites,An as trackWrappedFsWrites,ro as unpackDist,Wi as unsupportedRepositories,Zo as usableWorkspacePaths,vu as validArtifactPath,Cn as validPackageName,Eu as validPipInstall,sr as validateManifest,Fr as validateSpec,St as validateWorkspacePath,no as versionsOf,su as withoutDatabaseCredentials,Bt as writeAutoloader};
