import{lN as Se,lO as se,lP as sr,lQ as ir,lR as or,lS as ar,lT as qe,lU as Rt,lV as lr,lW as cr,_ as ur,lX as dr,lY as fr,lZ as ln,U as ct,V as A,W as xe,l_ as pr,hj as z,l$ as cn,m0 as $r,m1 as hr,m2 as mr,m3 as gr,m4 as Re,m5 as Ot,m6 as _r,m7 as ut,m8 as un,m9 as dn,ma as yr,hk as wr,mb as br,mc as vr,md as Nt,me as Er,mf as At,mg as dt,mh as Sr,mi as Ct,mj as kr,mk as Tr,hm as y,ml as x,mm as fn,mn as Pr,mo as Y,mp as Rr,mq as pn,mr as ft,ms as Oe,hn as Ye,mt as $n,mu as Or,mv as Nr,mw as Ar,mx as Cr,my as xr,mz as pt,mA as Ir,mB as hn,mC as Dr,mD as mn,mE as qr,mF as xt,mG as It,mH as Lr,mI as Mr,mJ as Ur,mK as jr}from"./index.js";import{mL as fl,hl as pl,mM as $l,mN as hl,mO as ml,mP as gl,mQ as _l,mR as yl,mS as wl,mT as bl,mU as vl,mV as El,hw as Sl,mW as kl,mX as Tl,mY as Pl,mZ as Rl,m_ as Ol,hu as Nl,m$ as Al,n0 as Cl,n1 as xl,hp as Il,n2 as Dl,n3 as ql,n4 as Ll,n5 as Ml,n6 as Ul,n7 as jl,n8 as Fl,n9 as Gl,na as Bl,nb as Hl,nc as Wl,nd as Vl,hd as zl,ne as Ql,nf as Yl,ng as Kl,nh as Jl,ni as Xl,nj as Zl,nk as ec,nl as tc,nm as nc,nn as rc,no as sc,np as ic,nq as oc,nr as ac,ns as lc,nt as cc,nu as uc,nv as dc,nw as fc,nx as pc,hv as $c,ht as hc,hr as mc,hx as gc,ny as _c,nz as yc,nA as wc,nB as bc,nC as vc,nD as Ec,nE as Sc,nF as kc,nG as Tc,nH as Pc,nI as Rc,nJ as Oc,nK as Nc,nL as Ac,nM as Cc,nN as xc,nO as Ic,nP as Dc,nQ as qc,nR as Lc,nS as Mc}from"./index.js";import{r as Fr,s as Gr,h as Br,p as Hr,m as Dt,c as Wr,a as Vr,b as $t,i as zr,d as Qr,Z as Yr,t as qt,e as gn,f as Kr,g as Jr,j as Xr,k as Zr,l as es,n as Ha}from"./chunk-rustProcessKind.js";import{D as jc,P as Fc,o as Gc,R as Bc,S as Hc,T as Wc,q as Vc,u as zc,v as Qc,w as Yc,x as Kc,y as Jc,z as Xc,A as Zc,B as eu,C as tu,E as nu,F as ru}from"./chunk-rustProcessKind.js";import{V as _n}from"./chunk-vfs.js";const ts={discovered:["preparing","failed"],preparing:["starting","stopping","failed"],starting:["ready","stopping","failed"],ready:["running","stopping","failed"],running:["stopping","stopped","failed"],stopping:["stopped","failed"],stopped:["preparing"],failed:["preparing","stopped"]},Le=new Set(["preparing","starting","ready","running"]);class ns extends Error{serviceId;from;to;constructor(t,n,r){super(`Service "${t}" cannot go from "${n}" to "${r}".`),this.serviceId=t,this.from=n,this.to=r,this.name="IllegalTransitionError"}}function rs(e,t){return ts[e].includes(t)}function ss(e,t){let n="discovered";return{serviceId:e,get state(){return n},transition(r){if(!rs(n,r))throw new ns(e,n,r);const s={serviceId:e,from:n,to:r};return n=r,t?.(s),s}}}const is={maxRestarts:5,backoffMs:250,maxBackoffMs:5e3};function os(e,t,n,r,s={}){const{maxRestarts:i,backoffMs:o,maxBackoffMs:a}={...is,...s};return t==="exit-zero"&&n===0?{restart:!1,reason:"completed"}:e==="always"||e==="on-failure"&&n!==0?r>=i?{restart:!1,reason:"limit"}:{restart:!0,delayMs:Math.min(a,o*2**r)}:{restart:!1,reason:"policy"}}function as(e){const t=new Map(e.map(n=>[n.id,n]));return{providers:[...t.values()],resolve(n){const r=t.get(n.runtime);if(!r){const i=[...t.keys()].join(", ")||"none";return{ok:!1,reason:`No runtime provider for "${n.runtime}" (available: ${i}).`}}const s=r.accepts(n);return s.ok?{ok:!0,provider:r}:{ok:!1,reason:s.reason}}}}function ls(e,t){const n=[];for(const r of e){const s=t.resolve(r);s.ok||n.push({serviceId:r.id,reason:s.reason})}return n.length===0?{ok:!0}:{ok:!1,declined:n}}const cs=20;function us(e,t,n=cs){return{services:e.map(r=>({id:r.id,state:r.state,...r.restarts>0?{restarts:r.restarts}:{},...r.exitCode!==void 0?{lastExitCode:r.exitCode}:{},lastLines:t.recent(r.id,n)}))}}class fe extends Error{error;constructor(t){super(t.message),this.error=t,this.name="ServiceFailure"}}function Me(e,t={}){const n=[],r=new Promise((s,i)=>{const o=()=>{let a=!1;for(const l of e){const c=l.readiness();if(c==="down")return i(new fe(l.failure()));c==="pending"&&(a=!0)}a||s()};for(const a of e)n.push(a.onChange(o));o()});return Se(r,{signal:t.signal,ms:t.timeoutMs}).finally(()=>n.forEach(s=>s()))}function Ke(){const e=new Set;return{on(t){return e.add(t),()=>e.delete(t)},emit(t){for(const n of[...e])try{n(t)}catch(r){queueMicrotask(()=>{throw r})}}}}const ds=5e3;function fs(e={}){const t=Fr(Math.max(1,e.history??ds)),n=Math.max(1,e.readerBuffer??1e3),r=new Set;let s=!1;const i=(l,c)=>{if((l.controller.desiredSize??0)<=1){l.dropped+=1;return}l.dropped>0&&(l.controller.enqueue({serviceId:c.serviceId,source:"runtime",text:`${l.dropped} log lines dropped (reader fell behind).`,at:c.at}),l.dropped=0),l.controller.enqueue(c)},o=l=>{t.push(l);for(const c of r)c.wanted(l)&&i(c,l)},a=(l,c,u)=>o({serviceId:l,source:c,text:u,at:Date.now()});return{pipe(l,c){return(async()=>{let u,d="";try{for(u=c.getReader();;){const{value:$,done:m}=await u.read();if(m)break;const f=(d+$).split(/\r?\n/);d=f.pop()??"";for(const p of f)a(l,"output",p)}}catch($){a(l,"runtime",`Output stopped: ${se($)}`)}finally{d&&a(l,"output",d),u?.releaseLock()}})()},note:(l,c)=>a(l,"runtime",c),recent(l,c){if(c<=0)return[];const u=[];for(const d of t)d.serviceId===l&&(u.push(d.text),u.length>c&&u.shift());return u},stream(l){let c;return new ReadableStream({start(u){c={wanted:d=>l===void 0||d.serviceId===l,controller:u,dropped:0};for(const d of t)c.wanted(d)&&u.enqueue(d);s?u.close():r.add(c)},cancel(){c&&r.delete(c)}},new CountQueuingStrategy({highWaterMark:n}))},close(){s=!0;for(const l of r)l.controller.close();r.clear()}}}function ps(){let e;return{get pending(){return e!==void 0},schedule(t,n){clearTimeout(e),e=setTimeout(()=>{e=void 0,n()},t)},cancel(){clearTimeout(e),e=void 0}}}function $s(e,t){return t===void 0?`Exited with code ${e}.`:new RegExp(`^Exited with code ${e}\\b`).test(t)?t:`Exited with code ${e} before ready: ${t}`}function hs(e){const{spec:t,logs:n}=e,r=sr(t),s=ir(t),i=r.timeoutMs??e.readinessTimeoutMs,o=Ke(),a=ss(t.id,w=>{e.onStateChange(w),o.emit()}),l=ps(),c=(w,P,T=!1,q)=>({serviceId:t.id,phase:w,message:P,exitCode:q,willRestart:T});let u,d,$=!1,m=!1,f=0,p=0,g,h,b,E,_=c("stopped","Not started.");function k(){const w={controller:new AbortController};u=w,d=w,$=!1,v(w)}async function v(w){a.transition("preparing");try{await Me(e.dependencies(),{signal:w.controller.signal,timeoutMs:e.dependencyTimeoutMs})}catch(N){const G=N instanceof fe?`Dependency "${N.error.serviceId}" is not available: ${N.error.message}`:`Dependencies not ready: ${se(N)}`;return O(w,{phase:"dependency",message:G})}if(u!==w)return;const P=e.registry.resolve(t);if(!P.ok)return O(w,{phase:"declined",message:P.reason});if(h&&await Se(h,{ms:e.stopTimeoutMs,onTimeout:()=>{},signal:w.controller.signal,onAbort:()=>{}}),u!==w)return;a.transition("starting");let T;try{w.handlePromise=Promise.resolve(P.provider.start(t,{env:e.env,signal:w.controller.signal,security:e.security,projectId:e.projectId})),T=await w.handlePromise}catch(N){return O(w,{phase:"start",message:se(N)})}if(w.handle=T,u!==w){w.abandoned?h=lr(T):T.output.cancel().catch(()=>{});return}w.drained=n.pipe(t.id,T.output),h=T.wait();const q=T.wait().then(async N=>(w.exitCode=N,b=N,await D(w,N),N));q.then(N=>j(w,N));try{const N=r.kind==="exit-zero"?T.ready().then(()=>C(w,T,q)):T.ready();await Se(N,{ms:i,onTimeout:()=>{throw new Error(`Not ready after ${i}ms (${r.kind} readiness).`)},signal:w.controller.signal})}catch(N){if(u!==w)return;const G=se(N);if(w.exitCode!==void 0||await qe(T,0)!==void 0){w.readinessReason=G;return}return u!==w?void 0:O(w,{phase:"readiness",message:G})}u===w&&M(w)}async function C(w,P,T){(w.exitCode!==void 0||await qe(P,0)!==void 0)&&await T}function D(w,P){const T=w.drained;if(!T)return Promise.resolve();const q=e.stopTimeoutMs,N=G=>(n.note(t.id,`Output could not be read to its end: ${se(G)}`),!0);return w.outputDone??=Se(T.then(()=>!0,N),{ms:q,onTimeout:()=>!1}).then(G=>{G||n.note(t.id,`Output did not end within ${q}ms of the exit (code ${P}); later lines may follow.`)})}function M(w){w.readyAt=Date.now(),E=void 0,a.transition("ready"),$=!0,a.transition("running"),w.completed&&S(w)}function j(w,P){if(u===w){if(r.kind==="exit-zero"&&P===0){w.completed=!0,a.state==="running"?S(w):a.state==="starting"&&M(w);return}O(w,{phase:"exit",message:$s(P,w.readinessReason),exitCode:P,clean:a.state==="running"&&P===0})}}function S(w){u=void 0,w.controller.abort(),n.note(t.id,"Completed."),a.transition("stopped")}function O(w,P){if(u!==w)return;u=void 0,w.controller.abort(),w.handle&&w.exitCode===void 0&&w.handle.kill("SIGKILL"),Rt(e.processes,e.security),w.readyAt!==void 0&&Date.now()-w.readyAt>=e.stableAfterMs&&(f=0);const q=P.phase==="declined"||P.phase==="dependency"?{restart:!1}:os(s,r.kind,P.exitCode??1,f,e.restart),N=c(P.phase,P.message,q.restart,P.exitCode);$=!1,_=N,q.restart&&l.schedule(q.delayMs,k),a.transition(P.clean?"stopped":"failed"),P.clean?n.note(t.id,"Exited with code 0."):(E=N,n.note(t.id,`Failed (${P.phase}): ${P.message}`),e.onError(N)),q.restart&&(f+=1,n.note(t.id,`Restarting in ${q.delayMs}ms (${s}, attempt ${f}).`))}async function L(){l.cancel();const w=u;if(u=void 0,$=!1,_=c("stopped","Stopped."),Le.has(a.state)){a.transition("stopping");const P=w?await ar(w,e.stopTimeoutMs):void 0;if(P&&(h=P.wait()),P&&w){const T=w.exitCode??await qe(P,0);T!==void 0&&await D(w,T)}Rt(e.processes,e.security),a.transition("stopped")}else a.state==="failed"?a.transition("stopped"):o.emit()}const I={id:t.id,async start(){const w=p;if(g&&await g,w!==p)throw new fe(c("stopped","Stopped before it started."));return!$&&!Le.has(a.state)&&!l.pending&&(f=0,k()),Me([I])},stop(){return p+=1,g??=L().finally(()=>g=void 0),g},async restart(){m=!0;try{const w=I.stop(),P=p;if(await w,P!==p)throw new fe(c("stopped","Stopped while restarting."));f=0,k()}finally{m=!1,o.emit()}return Me([I])},readiness:()=>$?"ready":Le.has(a.state)||l.pending||m?"pending":"down",failure:()=>_,onChange:w=>o.on(w),outputDrained:()=>d?.exitCode===void 0?Promise.resolve():D(d,d.exitCode),url:()=>u?.handle?.url(),database:()=>u?.handle?.database,snapshot:()=>({id:t.id,type:t.type,runtime:t.runtime,role:or(t),state:a.state,port:t.port,url:u?.handle?.url(),restarts:f,exitCode:b,error:E})};return I}class yn extends Error{failures;constructor(t){super(`Services failed to start: ${t.map(n=>`${n.serviceId} (${n.message})`).join("; ")}`),this.failures=t,this.name="ApplicationStartError"}}const ge={readinessTimeoutMs:12e4,dependencyTimeoutMs:6e5,stopTimeoutMs:5e3,stableAfterMs:1e4},ms=e=>"resolve"in e;async function Lt(e){const n=(await Promise.allSettled(e.map(([,r])=>r))).flatMap((r,s)=>{if(r.status==="fulfilled")return[];const i=r.reason instanceof fe?r.reason.error:{serviceId:e[s][0],phase:"start",message:se(r.reason),willRestart:!1};return i.phase==="stopped"?[]:[i]});if(n.length>0)throw new yn(n)}function gs(e){const t=e.name!==void 0,n=t?JSON.stringify(e.name):e.services.map(i=>`${i.id}\0${i.root??"/"}`).sort().join(""),r=Br("sha256").digest(new TextEncoder().encode(n)),s=Array.from(r.subarray(0,8),i=>i.toString(16).padStart(2,"0")).join("");return`app:${e.projectId}:${t?"named-":""}${s}`}function Va(e,t){const n=Gr(e),r=ms(t.providers)?t.providers:as(t.providers),s=fs({history:t.logHistory,readerBuffer:t.logReaderBuffer}),i=Ke(),o=Ke(),a=new Map;let l=!1;const c=gs(e),u=e.name!==void 0,d=(_,k)=>{const v=r.resolve(_);return v.ok?v.provider.databaseCredentials?.(_,k):void 0},$=t.processes??t.runtime,m=t.portPolicy??t.runtime.portPolicy;for(const _ of n.startOrder){const k=n.dependenciesOf(_).map(v=>a.get(v));a.set(_,hs({spec:e.services.find(v=>v.id===_),env:cr(e,_,{databaseCredentials:d}),registry:r,logs:s,onStateChange:v=>i.emit(v),onError:v=>o.emit(v),dependencies:()=>k,readinessTimeoutMs:t.readinessTimeoutMs??ge.readinessTimeoutMs,dependencyTimeoutMs:t.dependencyTimeoutMs??ge.dependencyTimeoutMs,stopTimeoutMs:t.stopTimeoutMs??ge.stopTimeoutMs,restart:t.restart??{},stableAfterMs:t.stableAfterMs??ge.stableAfterMs,security:Object.freeze({applicationId:c,serviceId:_}),projectId:e.projectId,processes:$}))}const f=_=>{const k=a.get(_);if(!k)throw new Error(`No service "${_}" in this application.`);return k},p=()=>{if(l)throw new Error("This application runtime was disposed.")};let g,h;const b=()=>{g??=m.register(c,e),e.ingress?.routes.length&&(h??=t.runtime.registerIngress?.(c,e))},E=async()=>{const _=g;h?.(),h=void 0;for(const k of n.stopOrder)await f(k).stop();u&&(!_||_!==g)||($.killApplication(c),u&&t.runtime.forgetApplication?.(c),g?.(),g=void 0)};return{projectId:e.projectId,applicationId:c,async start(){p();const _=ls(e.services,r);if(!_.ok){const k=_.declined.map(({serviceId:v,reason:C})=>({serviceId:v,phase:"declined",message:C,willRestart:!1}));throw k.forEach(v=>o.emit(v)),new yn(k)}b(),await Lt(n.startOrder.map(k=>[k,f(k).start()]))},stop:E,async restart(_){p();const k=f(_);u&&b(),await Lt([[_,k.restart()]])},async dispose(){l||(l=!0,await E(),u||t.runtime.forgetApplication?.(c),await Promise.all([...a.values()].map(_=>_.outputDrained())),s.close())},getService:_=>a.get(_)?.snapshot(),listServices:()=>n.startOrder.map(_=>f(_).snapshot()),diagnostics:()=>us(n.startOrder.map(_=>f(_).snapshot()),s),getUrl:_=>a.get(_)?.url(),logs:_=>s.stream(_),onStateChange:_=>i.on(_),onError:_=>o.on(_),database(_){const k=f(_);if(e.services.find(C=>C.id===_)?.type!=="database")throw new Error(`Service "${_}" is not a database.`);const v=async()=>k.database()??Promise.reject(new Error(`Database "${_}" is not running.`));return{export:async()=>(await v()).export(),import:async C=>(await v()).import(C),reset:async()=>(await v()).reset()}}}}const _s="0.5.16",za=`https://cdn.jsdelivr.net/npm/@electric-sql/pglite@${_s}/dist/index.js`,ys="314.0.7",ws=`https://cdn.jsdelivr.net/pyodide/v${ys}/full/`;let ce;const bs=e=>e.endsWith("/")?e:`${e}/`;async function vs(e){const t=globalThis;if(typeof t.importScripts=="function")try{if(t.importScripts(`${e}pyodide.js`),t.loadPyodide)return t.loadPyodide}catch{}return(await ur(()=>import(`${e}pyodide.mjs`),[],import.meta.url)).loadPyodide}async function Qa(e={}){const t=bs(e.indexURL??ws);if(ce?.indexURL!==t){const r=vs(t);ce={indexURL:t,load:r},r.catch(()=>{ce?.load===r&&(ce=void 0)})}const n=()=>{};return(await ce.load)({indexURL:t,env:e.env,stdout:n,stderr:n})}const Je="/bfwc-artifacts";function Es(e){const t=[];for(const n of e.matchAll(/(?:pure Python 3 wheel|pure Python wheel|wheel compatible with Pyodide)[^:'"]*:?\s*((?:['"][^'"]+['"](?:,\s*)?)+)/gi))for(const r of n[1].matchAll(/['"]([^'"]+)['"]/g))t.push(ln(r[1].split(/[<>=!~;[ ]/)[0]));return[...new Set(t)]}const Ss=e=>e instanceof Error?e.message:String(e);async function Mt(e,t,n){const r=e.toPy(n);try{await e.runPythonAsync(`import micropip
${t}`,{globals:r})}finally{r.destroy?.()}}async function Xe(e,t,n={}){const r=dr(t,n.provided),s={installed:[],provided:r.provided,declined:[...r.declined]};let i=r.install;if(!i.length)return s;const o=n.log??(()=>{});await e.loadPackage("micropip",{messageCallback:()=>{},errorCallback:o});const a=n.indexUrls?.length?[...n.indexUrls]:void 0;for(;;)try{return await Mt(e,"await micropip.install(specs, index_urls=index_urls)",{specs:i.map(l=>l.spec),index_urls:a}),s.installed.push(...i.map(l=>l.name)),s}catch(l){const c=Es(Ss(l)).filter($=>!s.declined.some(m=>m.name===$));if(!c.length)throw l;for(const $ of c)s.declined.push({name:$,reason:fr($)});const u=new Set(i.filter($=>c.includes($.name)).map($=>$.name)),d=c.filter($=>!u.has($));for(const $ of d)await Mt(e,'micropip.add_mock_package(name, "0.0.0")',{name:$});if(i=i.filter($=>!u.has($.name)),!i.length)return s}}function ks(e){const t=[];e.installed.length&&t.push(`Successfully installed ${e.installed.join(" ")}`),e.provided.length&&t.push(`Provided by the runtime (not installed): ${e.provided.join(" ")}`);for(const{reason:n}of e.declined)t.push(`Declined: ${n}`);return t}const K="/project",Ts=new Set(["node_modules",".git"]),Ps=50,Ne=e=>e.split("/").some(t=>Ts.has(t)),U=e=>e==="/"?K:A(K,e);function ke(e){const t=ct(e);return t===K?"/":t.startsWith(`${K}/`)?t.slice(K.length):void 0}const Rs=new TextDecoder("utf-8",{fatal:!0,ignoreBOM:!0});function Os(e){try{return Rs.decode(e)}catch{return e.slice()}}const me=(e,t)=>e.analyzePath(t).exists,Ie=(e,t)=>me(e,t)&&e.isDir(e.stat(t).mode),Te=(e,t)=>me(e,t)&&!e.isDir(e.stat(t).mode),wn=(e,t)=>t.startsWith("/")?t:A(e.cwd(),t),ht=(e,t)=>e.readdir(t).filter(n=>n!=="."&&n!=="..");function Ae(e,t){if(me(e,t)){if(!Ie(e,t))return e.unlink(t);for(const n of ht(e,t))Ae(e,`${t}/${n}`);e.rmdir(t)}}function mt(e,t){t.mkdirTree(K);for(const n of e.explicitDirectories())Ne(n)||t.mkdirTree(U(n));for(const n of e.list()){if(Ne(n))continue;const r=U(n);t.mkdirTree(xe(r)),t.writeFile(r,e.readFile(n)??"")}}function gt(e,t){for(const n of t){if(Ne(n.path))continue;const r=U(n.path);n.op==="write"?(e.mkdirTree(xe(r)),Ie(e,r)&&Ae(e,r),e.writeFile(r,n.content)):n.op==="mkdir"?e.mkdirTree(r):Ae(e,r)}}function bn(e,t,n=()=>!1){const r=new Set;let s=[],i=!1,o=0,a;const l=(p,g)=>{const h=U(p);return g==="mkdir"||g==="remove"?[{op:g,path:p}]:me(e,h)?Ie(e,h)?g==="write"?[]:[{op:"mkdir",path:p},...ht(e,h).flatMap(b=>l(A(p,b),"tree"))]:[{op:"write",path:p,content:Os(e.readFile(h))}]:[]},c=()=>{if(i=!1,!s.length)return;const p=s;s=[];const g=p.flatMap(({op:h,path:b})=>l(b,h)).filter(h=>!n(h.path));g.length&&t(g)},u=(p,g)=>{const h=ke(g);if(!(o||h===void 0||h==="/"||n(h)||Ne(h))){if(p==="write"){let b;for(const E of s)E.path===h&&(b=E);if(b?.op==="write")return}s.push({op:p,path:h}),i||(i=!0,queueMicrotask(c))}},d=()=>{for(const p of r)u("write",p)},$={openedForWrite(p){!o&&ke(p)!==void 0&&r.add(p)},written(p){o||ke(p)===void 0||(r.add(p),clearTimeout(a),a=setTimeout(d,Ps))},closed(p){r.delete(p)&&u("write",p)},madeDirectory:p=>u("mkdir",p),symlinked:p=>u("tree",p),deleted:p=>u("remove",p),moved(p,g){u("remove",p),u("tree",g)}},m=e.truncate.bind(e),f=e.ftruncate.bind(e);return e.truncate=(p,g)=>{m(p,g),typeof p=="string"&&u("write",wn(e,p))},e.ftruncate=(p,g)=>{f(p,g);const h=e.getStream(p)?.path;h&&u("write",h)},{events:$,tracker:{quietly(p){o++;try{p()}finally{o--}},flush(){clearTimeout(a),d(),c()}}}}const _e=U,Ya=ke;function Ns(e,t){mt(e,t)}function As(e,t){gt(e,t)}const Cs=579,xs=e=>e.includes("/__pycache__")||e.endsWith(".pyc");function Is(e,t){const{tracker:n,events:r}=bn(e,t,xs),s={onOpenFile:((i,o)=>{o&Cs&&r.openedForWrite(i)}),onWriteToFile:(i=>r.written(i)),onCloseFile:(i=>r.closed(i)),onMakeDirectory:(i=>r.madeDirectory(i)),onMakeSymlink:((i,o)=>r.symlinked(o)),onDeletePath:(i=>r.deleted(i)),onMovePath:((i,o)=>r.moved(i,o))};return Object.assign(e.trackingDelegate,s),n}const vn=e=>import(e),Ze=(e,t)=>e===t||e.startsWith(t==="/"?"/":`${t}/`);function Ds(e,t,n){const r=ct(t.root??`/opt/bfwc-extensions/${n}`);if(Ze(r,K)||Ze(K,r))throw new Error(`Python extension ${e.moduleUrl}: root ${r} overlaps the project (${K}); extensions are installed outside it.`);return r}function qs(e,t,n){const r=A(t,n);if(n.startsWith("/")||!Ze(r,t)||r===t)throw new Error(`Python extension ${e.moduleUrl}: file "${n}" is outside its root ${t}.`);return r}async function Ls(e,t,n=vn){const r=new Set,s=new Set;for(const[i,o]of t.entries()){const l=(await n(o.moduleUrl))[o.exportName];if(typeof l!="function")throw new Error(`Python extension ${o.moduleUrl} has no function export "${o.exportName}".`);const c=await l()??{},u=Object.entries(c.files??{}),d=u.length?Ds(o,c,i):void 0,$=u.map(([m,f])=>[qs(o,d,m),f]);for(const[m,f]of Object.entries(c.jsModules??{}))e.registerJsModule(m,f);for(const[m,f]of $)e.FS.mkdirTree(m.slice(0,m.lastIndexOf("/"))||"/"),e.FS.writeFile(m,f);d&&e.runPython(`import sys
if ${JSON.stringify(d)} not in sys.path: sys.path.insert(0, ${JSON.stringify(d)})`);for(const m of c.provides??[])r.add(ln(m));for(const m of c.imports??(c.provides??[]).map(f=>f.replace(/-/g,"_")))s.add(m)}return{packages:r,imports:s}}function Ms(e){const t={};for(const[n,r]of e){const s=n.toLowerCase(),i=t[s];t[s]=i===void 0?r:Array.isArray(i)?[...i,r]:[i,r]}return t}const Us=e=>JSON.stringify(Object.entries(e.headers??{}));function En(e){const t=e.handle,n=e.disconnect,r=e.close,s={interface:e.interface,app:String(e.label),port:Number(e.port)};let i=1;return{spec:s,handle:a=>new Promise((l,c)=>{const u=i++;let d,$=!1;const m={head(f,p){d=Hr(()=>{$||n(u)}),l({status:f,headers:Ms(JSON.parse(p)),body:d.stream})},chunk(f){if(!(!d||d.push(f.slice())))return d.ready()},end(f){$=!0,f?d?.fail(new Error(f)):d?.end()}};t(u,a.method,a.url,Us(a),a.body??void 0,m).then(()=>{d||c(new Error("The Python app finished without a response."))},f=>{d?d.fail(f):c(f)})}),async close(){try{await r()}finally{e.destroy?.()}}}}async function js(e,t){const n=e.pyimport("bfwc.serve").start_server;return En(await n(t.interface,t.app,t.port,!!t.factory,t.appDir))}async function Fs(e){const t=e.pyimport("bfwc.serve").start_requested;return En(await t())}function _t(e,t){let n=new _n,r,s,i,o,a=!1;const l=p=>{if(!a){r?.flush(),a=!0,i!==void 0&&e({type:"unlisten",port:i});for(const g of o?.listening??[])e({type:"unlisten",port:g});o?.closeAll(),e({type:"exit",code:p})}},c={post:e,io:{stdout:p=>!a&&e({type:"stdout",data:p}),stderr:p=>!a&&e({type:"stderr",data:p})},get exited(){return a},exit:l,mounted(p){n=void 0,r=p},get takenPorts(){return d.taken}},u=async(p,g=pr(p))=>{const h=s;s=void 0,d.cancelAll();try{o?.stop()}catch{}try{await h?.close()}finally{l(g)}},d=Wr({post:e,handlerFor:p=>s&&p===i?s.handle:o?.handlerFor(p),onListenFailed(p){if(p===i)i=void 0;else if(!o?.listening.has(p))return;c.io.stderr($.addressInUse(p)),u("SIGTERM",1)}}),$=t(c),m=p=>{n?Vr(n,p):r?.apply(p)};async function f(p){const{snapshot:g}=p;g.pack?Dt(n,g):m(g.ops);for(const _ of p.ports)d.taken.add(_);const h=$.plan(p,n);if(!h.ok)return c.io.stderr(h.message),l(h.code);if(h.port!==void 0&&d.taken.has(h.port))return c.io.stderr($.addressInUse(h.port)),l(1);const b=await h.run(n);if(b.kind==="exited")return l(b.code);if(b.kind==="running")return o=b.ports,l(await b.done);const{port:E}=b.server;if(a||d.taken.has(E))return await b.server.close(),a||c.io.stderr($.addressInUse(E)),l(1);s=b.server,i=E,d.taken.add(E),e({type:"listen",port:E}),c.io.stderr(b.banner)}return{receive(p){if(!(d.receive(p)||$.receive?.(p)))switch(p.type){case"prime":return Dt(n,p.snapshot),e({type:"primed"});case"start":f(p).catch(g=>{c.io.stderr(`${g instanceof Error?g.stack??g.message:String(g)}
`),l(1)});return;case"fs":return m(p.ops);case"kill":return void u(p.signal);case"stdin":return $.stdin?.(p.data);case"socket-open":case"socket-accept":return e({type:"socket-close",connId:p.connId});default:return}}}}const Gs=String.raw`
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
`,Bs=String.raw`
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
`,Hs=String.raw`
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
`,Ws=String.raw`
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
`,Vs=String.raw`
import os

ARTIFACT_DIR = ${JSON.stringify(Je)}


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
`,zs=String.raw`
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
`,Qs=String.raw`
class UvicornWorker:
    """Named by gunicorn's -k option; the runtime reads it from the command line and serves ASGI."""
`,Ys=String.raw`
"""The browser runtime serves WSGI apps itself; gunicorn is importable but never runs."""
__version__ = "0.0.0+bfwc"
version_info = (0, 0, 0)
`,Ue="/opt/bfwc",Ks={"bfwc/__init__.py":"","bfwc/run.py":Gs,"bfwc/serve.py":Bs,"bfwc/threads.py":Ws,"bfwc/training.py":Vs,"bfwc/vsocket.py":Hs,"uvicorn/__init__.py":zs,"uvicorn/workers.py":Qs,"gunicorn/__init__.py":Ys};function Js(e){for(const[t,n]of Object.entries(Ks)){const r=`${Ue}/${t}`;e.FS.mkdirTree(r.slice(0,r.lastIndexOf("/"))),e.FS.writeFile(r,n)}e.runPython(`import sys
if ${JSON.stringify(Ue)} not in sys.path: sys.path.insert(0, ${JSON.stringify(Ue)})`)}const Xs=new TextDecoder;function yt(e,t){return n=>{const r=z(t,n);if(!(!e.FS.analyzePath(r).exists||e.FS.isDir(e.FS.stat(r).mode)))return Xs.decode(e.FS.readFile(r))}}const Sn=e=>e.map(hr).filter(t=>!!t),kn=e=>[e.PIP_INDEX_URL,...(e.PIP_EXTRA_INDEX_URL??"").split(/\s+/)].filter(t=>!!t);async function je(e,t,n,r){const s=e.toPy({kind:t,target:n,argv:[...r]});try{const i=await e.runPythonAsync(`from bfwc.run import run_main
run_main(kind, target, argv)`,{globals:s});return i==="serve"?"serve":typeof i=="number"?i:0}finally{s.destroy?.()}}async function Ut(e,t,n){if(t)try{const r=e.pyimport("pyodide.code").find_imports,s=r(t),i=s.toJs?.()??[];s.destroy?.();const o=i.filter(a=>!n.provided.imports.has(a.split(".")[0]));if(!o.length)return;await e.loadPackagesFromImports(o.map(a=>`import ${a}`).join(`
`),{messageCallback:()=>{},errorCallback:a=>n.io.stderr(`${a}
`)})}catch(r){n.io.stderr(`${r instanceof Error?r.message:String(r)}
`)}}async function Zs(e,t,n){const r=o=>n.io.stderr(`${o}
`),s=o=>o.declined.forEach(({reason:a})=>r(`Declined: ${a}`));for(const o of n.installs)try{s(await Xe(e,Sn(o.specs),{indexUrls:o.indexUrls,log:r,provided:n.provided.packages}))}catch(a){r(`Warning: could not repeat this session's earlier pip install of ${o.specs.join(" ")}: ${a instanceof Error?a.message.trim().split(`
`).pop():String(a)}`)}const i=cn(yt(e,n.cwd),t);i.length&&s(await Xe(e,i,{indexUrls:kn(n.env),log:r,provided:n.provided.packages})),e.pyimport("bfwc.threads").install()}async function ei(e,t,n){const r=yt(e,n.cwd),s=t.projects.flatMap(c=>{const u=z(n.cwd,c),d=cn(r,u);return d.length||n.io.stderr(`${c}: no dependencies declared (pyproject.toml [project] dependencies or requirements.txt); its own code runs from the project directory as is.
`),d}),i=[...Sn(t.packages),...t.files.flatMap(c=>$r(r,z(n.cwd,c))),...s],o=[...t.indexUrls,...kn(n.env)],a=await Xe(e,i,{indexUrls:o,log:c=>n.io.stderr(`${c}
`),provided:n.provided.packages});for(const c of ks(a))(c.startsWith("Declined")?n.io.stderr:n.io.stdout)(`${c}
`);const l=i.filter(c=>a.installed.includes(c.name)).map(c=>c.spec);return l.length&&n.io.installed?.({specs:l,indexUrls:o}),a.declined.length?1:0}async function ti(e,t,n){const r=a=>({kind:"exited",code:a});if(t.kind==="install")return e.pyimport("bfwc.threads").install(),r(await ei(e,t,n));const s=t.kind==="serve"&&t.server.appDir?z(n.cwd,t.server.appDir):n.cwd;if(await Zs(e,s,n),t.kind==="serve")return{kind:"serving",server:await js(e,t.server)};const i=yt(e,n.cwd);let o;return t.kind==="script"?(await Ut(e,i(t.path),n),o=await je(e,"script",t.path,t.argv)):t.kind==="code"?(await Ut(e,t.code,n),o=await je(e,"code",t.code,t.argv)):o=await je(e,"module",t.module,t.argv),o==="serve"?{kind:"serving",server:await Fs(e)}:r(o)}const Tn=64*1024;class ni{channel;highWaterMark;queue=[];unacked=0;ended=!1;constructor(t,n,r=Tn){this.channel=t,this.highWaterMark=r,t.manualFlowControl(),t.onData(s=>{this.queue.push(s),n()}),t.onConsumed(s=>{this.unacked=Math.max(0,this.unacked-s),this.unacked<=this.highWaterMark&&n()}),t.onClose(()=>{this.ended=!0,n()})}get writable(){return this.unacked<=this.highWaterMark}tryRecv(t){const n=this.queue.shift();if(!n)return this.ended?null:void 0;const r=n.byteLength>t?n.subarray(0,t):n;return r!==n&&this.queue.unshift(n.subarray(t)),this.channel.closed||this.channel.consumed(r.byteLength),r}send(t){this.channel.send(t),this.unacked+=t.byteLength}close(){this.ended=!0,this.queue.length=0,this.channel.close()}}const ri=new Set(["localhost","127.0.0.1","::1","0.0.0.0",""]),jt=e=>{const t=e.wakeReader;e.wakeReader=void 0,t?.();for(const n of e.wakeSenders.splice(0))n()};function si(e,t=Tn){const n=new Map;let r=1;const s=i=>{const o=n.get(i);if(!o)throw new Error(`Bad file descriptor: connection ${i} is closed.`);return o};return{async connect(i,o){if(!ri.has(i.toLowerCase()))throw new Error(`connect ECONNREFUSED ${i}:${o} (only localhost is reachable in the browser runtime)`);const a=await e(o);if(!a)throw new Error(`connect ECONNREFUSED ${i}:${o}`);const l=r++,c={wakeSenders:[]},u=Object.assign(c,{endpoint:new ni(a,()=>jt(c),t)});return n.set(l,u),l},async send(i,o){const a=s(i),{endpoint:l}=a;if(l.ended)throw new Error("Broken pipe: the connection is closed.");for(l.send(o);!l.writable&&!l.ended;)await new Promise(c=>a.wakeSenders.push(c))},async recv(i,o){const a=s(i);for(;;){const l=a.endpoint.tryRecv(o);if(l!==void 0)return l;await new Promise(c=>a.wakeReader=c)}},close(i){const o=n.get(i);o&&(o.endpoint.close(),jt(o),n.delete(i))}}}function ii(e){const t=$t(e);return{transport:si(n=>t.dial(n)),receive:n=>t.receive(n)}}const oi="_bfwc_tcp",Pe="timeout",Ft=e=>new Promise(t=>setTimeout(()=>t(Pe),e));function ai(e){const t=new Map;return{async connect(n,r,s){const i=e.connect(n,r);if(s==null)return i;const o=await Promise.race([i,Ft(s)]);if(o===Pe)throw i.then(a=>e.close(a),()=>{}),new Error("timed out");return o},send:(n,r)=>Promise.resolve(e.send(n,r.slice())),async recv(n,r,s){const i=t.get(n)??e.recv(n,r);t.set(n,i);const o=s==null?await i:await Promise.race([i,Ft(s)]);return o===Pe?Pe:(t.delete(n),o??void 0)},shutdown:n=>e.shutdown?.(n),close(n){t.delete(n),e.close(n)}}}function li(e,t){e.registerJsModule(oi,ai(t)),e.runPython(`import bfwc.vsocket
bfwc.vsocket.install()`)}const ci="_bfwc_training",ui=50,di=12e4;function*Pn(e,t,n=""){for(const r of e.readdir(t)){if(r==="."||r==="..")continue;const s=`${t}/${r}`,i=n?`${n}/${r}`:r,{mode:o}=e.lstat(s);e.isLink(o)||(e.isDir(o)?yield*Pn(e,s,i):e.isFile(o)&&(yield[i,s]))}}const fi=e=>e.analyzePath(Je).exists?[...Pn(e,Je)]:[];function pi(e){let t=!1,n,r=0,s=0;const i=new Map;async function o(a=!1){if(!n)return{ok:!1,error:"Not a training process.",confirmed:!1};const{py:l,options:c}=n,u=++r;let d;try{if(d=fi(l.FS),a&&d.length===0)return{ok:!0,confirmed:!1};for(const[m,f]of d){const p=l.FS.readFile(f);e({type:"training-artifact",saveId:u,path:m,bytes:p},[p.buffer])}}catch(m){return{ok:!1,error:`Could not read the artifacts: ${m instanceof Error?m.message:String(m)}`,confirmed:!1}}const $=c.acks?new Promise(m=>{i.set(u,m),setTimeout(()=>i.get(u)===m&&(i.delete(u),m({ok:!1,error:"The page did not acknowledge the save.",confirmed:!1})),di)}):void 0;return e({type:"training-saved",saveId:u,files:d.length}),$??{ok:!0,confirmed:!1}}return{receive(a){return zr(a)?a.type==="checkpoint"?(t=!0,!0):(i.get(a.saveId)?.(a.superseded?{ok:!0,confirmed:!1,superseded:!0}:{ok:a.ok,error:a.error,confirmed:a.ok}),i.delete(a.saveId),!0):!1},install(a,l){n={py:a,options:l,cell:l.flag?new Int32Array(l.flag):void 0};const c=n.cell;a.registerJsModule(ci,{checkpoint_requested:()=>t||c!==void 0&&Atomics.load(c,0)!==0,should_yield:()=>{if(c||t)return!1;const u=Date.now();return u-s<ui?!1:(s=u,!0)},tick:()=>new Promise(u=>setTimeout(u,0)),save:()=>o().then(u=>({error:u.ok?"":u.error??"The save failed.",confirmed:u.confirmed}))})},async saveAtExit(a){if(!n)return;const l=await o(!0);l.ok||a(`bfwc.training: the artifacts were not saved: ${l.error??"unknown error"}
`)}}}const $i=e=>`[Errno 98] error while attempting to bind on address ('0.0.0.0', ${e}): address already in use
`,hi=e=>/fatal error/i.test(e instanceof Error?e.message:String(e));function Ka(e){const t=[],n=new TextDecoder,r=e.tcp?void 0:ii(e.post),s=e.tcp??r.transport,i=pi((a,l)=>e.post(a,l)),o=a=>t.push(...a.split(/(?<=\n)/).filter(Boolean));return _t(e.post,a=>{async function l(u,d){const $={...u.env,PYTHONDONTWRITEBYTECODE:"1",PYTHONUNBUFFERED:"1",PWD:_e(u.cwd)},m=await e.loadPyodide({indexURL:u.python?.indexURL,env:$}),f=_=>({write:k=>(a.io[_](k.slice()),k.length),isatty:!1});m.setStdout(f("stdout")),m.setStderr(f("stderr")),m.setStdin({stdin:()=>t.shift()??null,isatty:!1}),Js(m),li(m,s);const p=u.python?.training;p&&i.install(m,p);const g=await Ls(m,u.python?.extensions??[],e.importModule??vn);Ns(d,m.FS);const h=Is(m.FS,_=>{a.exited||e.post({type:"fs",ops:_})});a.mounted({apply:_=>h.quietly(()=>As(m.FS,_)),flush:()=>h.flush()});const b=m.pyimport("bfwc.run").bootstrap,E=m.toPy($);try{b(E,_e(u.cwd))}finally{E.destroy?.()}return{py:m,provided:g}}async function c(u,d,$){const{py:m,provided:f}=await l(u,$);if(a.exited)return{kind:"exited",code:0};const p=await ti(m,d,{cwd:_e(u.cwd),env:u.env,io:{stdout:a.io.stdout,stderr:a.io.stderr,installed:h=>e.post({type:"python-installed",...h})},installs:u.python?.installs??[],provided:f});if(p.kind==="exited")return i.saveAtExit(a.io.stderr).then(()=>p);const g=p.server;return{kind:"serving",server:{port:g.spec.port,handle:mi(g,a),close:()=>g.close()},banner:`Serving ${g.spec.interface.toUpperCase()} app ${g.spec.app} on http://localhost:${g.spec.port} (request-driven)
`}}return{addressInUse:$i,plan(u){const d=mr(u.command,u.args,u.env);if(!d.ok)return{ok:!1,message:`${u.command}: ${d.reason}
`,code:2};const $=gr(d.invocation,_e);return{ok:!0,port:$.kind==="serve"?$.server.port:void 0,run:m=>c(u,$,m)}},stdin:u=>o(u===null?n.decode():typeof u=="string"?u:n.decode(u,{stream:!0})),receive:u=>i.receive(u)||!!r?.receive(u)}})}function mi(e,t){return n=>e.handle(n).catch(r=>{throw hi(r)&&(t.io.stderr(`${r instanceof Error?r.message:String(r)}
`),t.exit(1)),r})}const gi=3,_i=64,yi=512;function wi(e){return typeof e=="string"?/[wa+]/.test(e):(e&gi)!==0||(e&(_i|yi))!==0}function Rn(e,t){const{tracker:n,events:r}=bn(e,t),s=o=>wn(e,o),i={open:e.open,write:e.write,close:e.close,mkdir:e.mkdir,unlink:e.unlink,rmdir:e.rmdir,rename:e.rename,symlink:e.symlink};return e.open=function(o,a,l){const c=i.open.call(this,o,a,l);return wi(a)&&c.path&&r.openedForWrite(c.path),c},e.write=function(o,...a){const l=i.write.call(this,o,...a);return o.path&&r.written(o.path),l},e.close=function(o){const a=o.path;i.close.call(this,o),a&&r.closed(a)},e.mkdir=function(o,a){const l=i.mkdir.call(this,o,a);return r.madeDirectory(s(o)),l},e.unlink=function(o){i.unlink.call(this,o),r.deleted(s(o))},e.rmdir=function(o){i.rmdir.call(this,o),r.deleted(s(o))},e.rename=function(o,a){i.rename.call(this,o,a),r.moved(s(o),s(a))},e.symlink=function(o,a){const l=i.symlink.call(this,o,a);return r.symlinked(s(a)),l},n}const et=e=>`'${e.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;function ie(e,t){return e==null?"null":typeof e=="boolean"||typeof e=="number"?JSON.stringify(e):typeof e=="string"?t?.(e)??et(e):Array.isArray(e)?`[${e.map(n=>ie(n,t)).join(", ")}]`:`[${Object.entries(e).map(([n,r])=>`${ie(n)} => ${ie(r,t)}`).join(", ")}]`}const bi=String.raw`<?php
// Generated by the BuilderForce WebContainers PHP runtime (composer install).
require_once __DIR__ . '/composer/ClassLoader.php';
require_once __DIR__ . '/composer/InstalledVersions.php';
return \Composer\Autoload\ClassLoader::bfwcBoot(require __DIR__ . '/composer/autoload_bfwc.php');
`,vi=String.raw`<?php
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
`,Ei=String.raw`<?php
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
`,Si=/^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z_\x80-￿][A-Za-z0-9_\x80-￿]*)/gm,ki=/^\s*namespace\s+([A-Za-z_\\][A-Za-z0-9_\\]*)\s*[;{]/m;function Ti(e){const t=e.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*(\/\/|#).*$/gm,""),n=ki.exec(t)?.[1];return[...t.matchAll(Si)].map(r=>n?`${n}\\${r[2]}`:r[2])}function Fe(e,t,n,r,s){if(!s)return;const i=a=>A(n,r,a);for(const[a,l]of Object.entries(s["psr-4"]??{}))(e.psr4[a]??=[]).push(...[l].flat().map(i));for(const[a,l]of Object.entries(s["psr-0"]??{}))(e.psr0[a]??=[]).push(...[l].flat().map(i));for(const a of s.files??[])e.files.push(i(a));const o=(s["exclude-from-classmap"]??[]).map(i);for(const a of s.classmap??[]){const l=i(a),c=t.isDir(l)?t.list(l).filter(u=>/\.(php|inc|hh)$/.test(u)):[l];for(const u of c)if(!o.some(d=>u.startsWith(d)))for(const d of Ti(t.read(u)??""))e.classmap[d]??=u}}const Pi=e=>t=>t===e||t.startsWith(`${e}/`)?`$baseDir . ${ie(t.slice(e.length))}`:void 0;function Ri(e){const t=new Map(e.map(i=>[i.name.toLowerCase(),i])),n=new Set,r=[],s=(i,o)=>{const a=i.name.toLowerCase();if(!(n.has(a)||o.has(a))){o.add(a);for(const l of Object.keys(i.require??{}).sort()){const c=t.get(l.toLowerCase());c&&s(c,o)}o.delete(a),n.add(a),r.push(i)}};for(const i of[...e].sort((o,a)=>o.name.localeCompare(a.name)))s(i,new Set);return r}function Gt(e,t,n,r,s){const i={psr4:{},psr0:{},classmap:{},files:[]};Fe(i,e,t,"",n.autoload),s.dev&&Fe(i,e,t,"",n["autoload-dev"]);const o=i.files.splice(0);for(const d of Ri(r))Fe(i,e,t,`vendor/${d.name}`,d.autoload);i.files.push(...o);const a=A(t,"vendor"),l=Pi(t);e.write(A(a,"autoload.php"),bi),e.write(A(a,"composer/ClassLoader.php"),vi),e.write(A(a,"composer/InstalledVersions.php"),Ei),e.write(A(a,"composer/autoload_bfwc.php"),`<?php
// Generated by the BuilderForce WebContainers PHP runtime.
$baseDir = dirname(__DIR__, 2);
return ${ie(i,l)};
`),e.write(A(a,"composer/installed.json"),`${JSON.stringify({packages:r,dev:s.dev,"dev-package-names":[...s.devPackages]},null,4)}
`);const c=Object.fromEntries(r.map(d=>[d.name,{pretty_version:d.version,version:d.version_normalized??d.version,reference:d.dist?.reference??d.source?.reference??null,type:d.type??"library",install_path:A(a,d.name),aliases:[],dev_requirement:s.devPackages.has(d.name)}])),u={name:n.name??"__root__",pretty_version:n.version??"dev-main",version:n.version??"dev-main",reference:null,type:"project",install_path:t,aliases:[],dev:s.dev};e.write(A(a,"composer/installed.php"),`<?php
$baseDir = dirname(__DIR__, 2);
return ${ie({root:u,versions:{...c,[u.name]:{...u,dev_requirement:!1}}},l)};
`)}const Oi=/^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]?|-{0,2})[a-z0-9]+)*$/;class wt extends Error{}const On=e=>Oi.test(e)&&!Nn(e),Nn=e=>e.split("/").some(t=>t==="."||t===".."||t===""),bt=(e,t)=>new wt(`Invalid package name "${e}" in ${t}: Composer names are vendor/package, lower-case letters, digits and [_.-] separators.`);function ae(e,t){const n=e.toLowerCase();if(Re(n)||On(n))return n;throw bt(e,t)}function tt(e,t){const n=typeof e=="string"?e.toLowerCase():"";if(On(n))return n;throw bt(String(e),t)}function Ge(e,t){return A(e,"vendor",tt(t,"a vendor path"))}function Ni(e){if(Nn(e))throw bt(e,"a repository URL");return e.split("/").map(encodeURIComponent).join("/")}function Ai(e){const n=(Array.isArray(e.repositories)?e.repositories:Object.entries(e.repositories??{}).map(([r,s])=>s===!1?{type:`${r}: false`}:s)).map(r=>r).filter(r=>!(r?.type==="composer"&&typeof r.url=="string"&&/^https:\/\/(repo\.)?packagist\.org\/?$/.test(r.url))).map(r=>typeof r?.type=="string"?r.type:"unknown");if(n.length)return`composer.json declares repositories of type ${[...new Set(n)].join(", ")}, which the PHP runtime does not support (it installs from Packagist, or the host's php.composer.repositoryUrl, only).`}function Bt(e){const t=[];for(const n of e){const r=/^([^:=\s]+)[:=](.+)$/.exec(n);r?t.push({name:ae(r[1],"composer require"),constraint:r[2]}):!n.includes("/")&&t.length&&t[t.length-1].constraint===void 0?t[t.length-1].constraint=n:t.push({name:ae(n,"composer require")})}return t}function Ci(e,t){const n=new Map;for(const i of t.values())for(const o of[...Object.keys(i.replace??{}),...Object.keys(i.provide??{})])n.set(o.toLowerCase(),i.name);const r=new Set,s=Object.keys(e.require??{}).map(i=>i.toLowerCase());for(;s.length;){const i=s.shift(),o=t.get(i)??t.get(n.get(i)??"");!o||r.has(o.name)||(r.add(o.name),s.push(...Object.keys(o.require??{}).map(a=>a.toLowerCase())))}return r}function xi(e,t){return`${JSON.stringify({_readme:["This file locks the dependencies of your project to a known state","Written by the BuilderForce WebContainers PHP runtime"],...e,aliases:[],"minimum-stability":t.minimumStability,"stability-flags":{},"prefer-stable":t.preferStable,"prefer-lowest":!1,platform:{},"platform-dev":{},"plugin-api-version":"2.6.0"},null,4)}
`}class Z extends Error{}const nt=e=>ut(e.version_normalized??e.version),Ht=e=>Object.entries(e.require??{}).map(([t,n])=>({name:ae(t,`${e.name}'s require`),constraint:n,from:e.name})),Wt=e=>[...Object.keys(e.replace??{}),...Object.keys(e.provide??{})].map(t=>t.toLowerCase());function Vt(e,t,n){return An(e,t,n)[0]}function An(e,t,n,r){const s=t.reduce((l,c)=>c.stability&&Ot({stability:l},c.stability)?c.stability:l,n.minimumStability),i=e.map(l=>({pkg:l,version:nt(l)})).filter(l=>!!l.version&&Ot(l.version,s)&&t.every(c=>c.test(l.version))).sort((l,c)=>_r(c.version,l.version)),o=n.preferStable?[...i.filter(l=>l.version.stability==="stable"),...i.filter(l=>l.version.stability!=="stable")]:i,a=r===void 0?-1:o.findIndex(l=>l.pkg.version===r);return a>0&&o.unshift(...o.splice(a,1)),o.map(l=>l.pkg)}function zt(e,t){return t.map(n=>{const r=dn(n.constraint);if(!r)throw new Z(`Cannot read the version constraint "${n.constraint}" on ${e} (required by ${n.from}).`);return r})}async function Ii(e,t,n,r={}){const s=new Set(Wt(r)),i={steps:n.maxSteps??2e4};let o="",a=-1;const l=(f,p)=>{f>=a&&(o=p,a=f)},c=new Map,u=async f=>(c.has(f)||c.set(f,await t.versions(f)),c.get(f)),d=f=>{const p=[{from:"root",conflict:r.conflict},...[...f.values()].map(g=>({from:g.name,conflict:g.conflict}))];for(const{from:g,conflict:h}of p)for(const[b,E]of Object.entries(h??{})){const _=b.toLowerCase(),k=dn(E),v=f.get(_),C=v&&nt(v);if(C&&k?.test(C))return`${g} conflicts with ${v.name} ${E}`;for(const D of f.values()){const M={...D.provide,...D.replace},j=Object.entries(M).find(([O])=>O.toLowerCase()===_)?.[1];if(j===void 0)continue;const S=ut(j==="self.version"?D.version_normalized??D.version:j.replace(/^[=\s]+/,""));if(S&&k?.test(S))return`${g} conflicts with ${_} ${E} (${D.name} ${j==="self.version"?"replaces/provides it":`provides ${j}`})`}}},$=async f=>{if(--i.steps<0)throw new Z("Dependency resolution took too long; pin the conflicting packages in composer.json.");const p=new Map;for(const v of[...e,...[...f.values()].flatMap(Ht)])Re(v.name)||p.set(v.name,[...p.get(v.name)??[],v]);const g=new Set([...s,...[...f.values()].flatMap(Wt)]);for(const[v,C]of f){const D=p.get(v)??[],M=nt(C),j=zt(v,D),S=D.find((O,L)=>!j[L].test(M));if(S){l(f.size,`${v} ${C.version} was chosen, but ${S.from} requires ${v} ${S.constraint}.`);return}}const h=d(f);if(h){l(f.size,`${h}.`);return}const b=[...p.keys()].filter(v=>!f.has(v)&&!g.has(v));let E;for(const v of b)if(await u(v)){E=v;break}if(E===void 0){if(!b.length)return f;const v=b[0];l(f.size,`Package ${v} (required by ${p.get(v).map(C=>C.from).join(", ")}) was not found in the repository, and no chosen package provides or replaces it.`);return}const _=p.get(E),k=An(await u(E),zt(E,_),n,n.preferred?.get(E));if(!k.length){l(f.size,`No version of ${E} satisfies ${_.map(v=>`${v.constraint} (required by ${v.from})`).join(" and ")} at minimum-stability ${n.minimumStability}.`);return}for(const v of k){const C=n.platform&&Object.entries(v.require??{}).map(([M,j])=>Re(M.toLowerCase())?un(M,j,n.platform):void 0).find(Boolean);if(C){l(f.size,`${v.name} ${v.version} is declined: ${C}`);continue}try{Ht(v)}catch(M){if(!(M instanceof wt))throw M;l(f.size,`${v.name} ${v.version} is skipped: ${M.message}`);continue}const D=await $(new Map([...f,[E,v]]));if(D)return D}},m=await $(new Map);if(!m)throw new Z(o||"No installable set of packages satisfies composer.json.");return{packages:m}}function Di(e,t){return[...Object.entries(e.require??{}),...t?[]:Object.entries(e["require-dev"]??{})].map(([r,s])=>({name:r.toLowerCase(),constraint:s,from:"root"}))}class ne extends Error{}const qi=["pre-install-cmd","post-install-cmd","pre-update-cmd","post-update-cmd","post-autoload-dump","post-root-package-install","post-create-project-cmd"],ye=(e,t)=>{try{return JSON.parse(e)}catch(n){throw new ne(`${t} does not contain valid JSON: ${n instanceof Error?n.message:String(n)}`)}};function Be(e,t,n,r){return[...Object.entries({...e.require,...n?e["require-dev"]:{}}).map(([o,a])=>({name:o,constraint:a,from:"your project"})),...t.flatMap(o=>Object.entries(o.require??{}).map(([a,l])=>({name:a,constraint:l,from:o.name})))].flatMap(({name:o,constraint:a,from:l})=>{const c=Re(o.toLowerCase())?un(o,a,r):void 0;return c?[`${l} requires ${o} ${a}: ${c}`]:[]})}async function Li(e,t){const{files:n,projectDir:r}=t,s=A(r,"composer.json"),i=A(r,"composer.lock"),o=A(r,"vendor/composer/installed.json"),a=n.read(s),l=n.read(i),c=!e.noDev;try{if(a===void 0&&e.command!=="require")throw new ne(`Composer could not find a composer.json file in ${r}`);const u=ye(a??"{}",s),d=Ai(u);if(d)throw new ne(d);for(const S of["require","require-dev","replace","provide","conflict"])for(const O of Object.keys(u[S]??{}))ae(O,`composer.json ${S}`);const m=(()=>{const S=n.read(o);if(S===void 0)return{packages:[],devNames:[]};const O=ye(S,o);for(const L of O.packages??[])tt(L.name,o);return{packages:O.packages??[],devNames:O["dev-package-names"]??[]}})();if(e.command==="dump-autoload"){const{packages:S,devNames:O}=m,L=new Set(O);return Gt(n,r,u,c?S:S.filter(I=>!L.has(I.name)),{dev:c,devPackages:c?L:new Set}),t.out(`Generating autoload files
Generated autoload files
`),0}const f={minimumStability:yr(u["minimum-stability"]),preferStable:!!u["prefer-stable"]};if(e.command==="require"){const S=e.dev?"require-dev":"require";for(const{name:O,constraint:L}of Bt(e.packages)){let I=L;if(!I){const w=await t.source.versions(O),P=w?.filter(G=>e.ignorePlatformReqs||!Be({},[G],!1,t.platform).length),T=P&&Vt(P,[],f),q=!T&&w&&Vt(w,[],f);if(q)throw new Z(`${q.name} ${q.version} is declined: ${Be({},[q],!1,t.platform).join("; ")}`);const N=T&&ut(T.version_normalized??T.version);if(!N||N.branch)throw new Z(`Could not find a stable version of package ${O}.`);I=`^${N.parts[0]}.${N.parts[1]}`}u[S]={...u[S],[O]:I},t.err(`./composer.json has been updated (${O}: ${I})
`)}}const p=`${JSON.stringify(u,null,4)}
`;let g=e.command==="install"&&l!==void 0?ye(l,i):void 0,h=!1;if(g){t.err("Installing dependencies from lock file"+(c?" (including require-dev)":"")+`
`);for(const S of[...g.packages??[],...g["packages-dev"]??[]])tt(S.name,i);g["content-hash"]&&g["content-hash"]!==await t.contentHash(a??p)&&t.err("Warning: The lock file is not up to date with the latest changes in composer.json. Run `composer update`.\n")}else{t.err(e.command==="install"?`No composer.lock file present. Updating dependencies to latest instead of installing from lock file.
`:`Updating dependencies
`);const S=e.command==="require"?Bt(e.packages).map(T=>T.name):e.packages.map(T=>ae(T,"composer update")),O=S.length&&l!==void 0?ye(l,i):void 0,L=new Map([...O?.packages??[],...O?.["packages-dev"]??[]].filter(T=>!S.includes(T.name)).map(T=>[T.name,T.version])),I=await Ii(Di(u,!1),t.source,{...f,preferred:L,platform:e.ignorePlatformReqs?void 0:t.platform},u);for(const T of I.packages.values())t.err(`  - Locking ${T.name} (${T.version})
`);const w=Ci(u,I.packages),P=[...I.packages.values()].sort((T,q)=>T.name.localeCompare(q.name));g={"content-hash":await t.contentHash(p),packages:P.filter(T=>w.has(T.name)),"packages-dev":P.filter(T=>!w.has(T.name))},h=!0}const b=[...g.packages??[],...c?g["packages-dev"]??[]:[]],E=new Set(c?(g["packages-dev"]??[]).map(S=>S.name):[]),_=e.ignorePlatformReqs?[]:Be(u,b,c,t.platform);if(_.length)throw new ne(`Your requirements could not be resolved to an installable set of packages.
${_.map(S=>`  - Declined: ${S}`).join(`
`)}`);e.command==="require"&&n.write(s,p),h&&(n.write(i,xi(g,f)),t.err(`Writing lock file
`));const k=new Map(m.packages.map(S=>[S.name,S])),v=(S,O)=>!!S&&S.version===O.version&&(S.dist?.reference??null)===(O.dist?.reference??null)&&n.isDir(Ge(r,O.name)),C=b.filter(S=>!v(k.get(S.name),S)),D=[...k.keys()].filter(S=>!b.some(O=>O.name===S));t.err(`Package operations: ${C.length} install${C.length===1?"":"s"}, 0 updates, ${D.length} removal${D.length===1?"":"s"}
`);const M=[];for(const S of C){t.err(`  - Downloading ${S.name} (${S.version})
`);const O=await t.source.files(S);for(const L of O.keys())if(L.split("/").some(I=>I===".."||I==="."||I===""))throw new ne(`${S.name} ${S.version} holds a file outside its directory ("${L}").`);M.push([S,O])}for(const S of D)n.remove(Ge(r,S)),t.err(`  - Removing ${S}
`);for(const[S,O]of M){const L=Ge(r,S.name);t.err(`  - Installing ${S.name} (${S.version})
`),n.remove(L);for(const[I,w]of O)n.write(A(L,I),w);S.type==="composer-plugin"&&t.err(`    ${S.name} is a Composer plugin; plugins do not run in the PHP runtime.
`)}!C.length&&!D.length&&t.err(`Nothing to install, update or remove
`),t.err(`Generating autoload files
`),Gt(n,r,u,b,{dev:c,devPackages:E});const j=qi.filter(S=>u.scripts?.[S]!==void 0);return j.length&&t.err(`Composer scripts do not run in the PHP runtime (${j.join(", ")}); run their commands yourself if needed.
`),0}catch(u){(e.command==="require"||e.command==="update")&&(a===void 0?n.remove(s):n.read(s)!==a&&n.write(s,a),l===void 0?n.remove(i):n.read(i)!==l&&n.write(i,l));const d=u instanceof Z||u instanceof ne||u instanceof wt,$=u instanceof Z?`Your requirements could not be resolved to an installable set of packages.
  `:"";return t.err(`${$}${u instanceof Error?u.message:String(u)}
`),d?2:1}}const Mi="https://packagist.org/packages/{name}.json",Ui="https://cdn.jsdelivr.net/gh/",ji="https://data.jsdelivr.com/v1/packages/gh/";function Fi(e){const t=[];let n={};for(const r of e){const s={...n};for(const[i,o]of Object.entries(r))o==="__unset"?delete s[i]:s[i]=o;t.push(s),n=s}return t}function Gi(e,t){const n=t;if(n.package?.versions)return Object.values(n.package.versions).map(s=>({...s,name:e}));const r=n.packages?.[e];if(Array.isArray(r))return(n.minified?Fi(r):r).map(s=>({...s,name:e}));if(r)return Object.values(r).map(s=>({...s,name:e}))}function Qt(e){const t=e&&/^https:\/\/(?:api\.)?github\.com\/(?:repos\/)?([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/.exec(e);return t?{owner:t[1],repo:t[2]}:void 0}const re={maxEntries:5e4,maxTotalBytes:256*1024*1024,maxEntryBytes:64*1024*1024},rt=128*1024*1024;class W extends Error{}function Bi(e){const t=new _n;try{Qr(t,e,"/",re)}catch(o){throw o instanceof Yr?new W(o.message):o}const n=t.list(),r=new Set(n.map(o=>o.split("/")[1])),s=r.size===1&&n.every(o=>o.split("/").length>2)?`/${[...r][0]}/`:"/",i=new Map;for(const o of n){const a=t.readFile(o);i.set(o.slice(s.length),typeof a=="string"?new TextEncoder().encode(a):a??new Uint8Array)}return i}async function st(e,t){const n=await e(t);if(!n.ok)throw new Error(`GET ${t}: ${n.status} ${n.statusText}`);return n}async function Ce(e,t,n){const r=Number(e.headers.get("content-length"));if(r>t)throw new W(`${n} is ${r} bytes, over the ${t}-byte limit.`);if(!e.body)return new Uint8Array(await e.arrayBuffer());const s=e.body.getReader(),i=[];let o=0;for(;;){const{value:c,done:u}=await s.read();if(u)break;if(o+=c.byteLength,o>t)throw await s.cancel(),new W(`${n} exceeds the ${t}-byte limit.`);i.push(c)}const a=new Uint8Array(o);let l=0;for(const c of i)a.set(c,l),l+=c.byteLength;return a}async function Hi(e,t,n){if(!t)return;const s=[...new Uint8Array(await crypto.subtle.digest("SHA-1",e))].map(i=>i.toString(16).padStart(2,"0")).join("");if(s!==t.toLowerCase())throw new W(`${n}: checksum mismatch (sha1 ${s}, metadata says ${t}).`)}function Wi(e,t){let n;try{n=new URL(e)}catch{throw new W(`${t}: dist URL "${e}" is not an absolute URL.`)}const r=n.hostname==="localhost"||n.hostname==="[::1]"||/^127\./.test(n.hostname);if(n.protocol!=="https:"&&!(n.protocol==="http:"&&r))throw new W(`${t}: dist URL "${e}" is not https.`)}const Vi=/^[A-Za-z0-9._-]+$/;async function zi(e,t,n,r){if(![t,n,r].every(l=>Vi.test(l)))throw new W(`Refusing GitHub source ${t}/${n}@${r}: not a plain repository and commit.`);const i=(JSON.parse(new TextDecoder().decode(await Ce(await st(e,`${ji}${t}/${n}@${r}?structure=flat`),rt,"The jsDelivr listing"))).files??[]).map(l=>l.name);if(i.length>re.maxEntries)throw new W(`${t}/${n} has ${i.length} files, over the ${re.maxEntries}-entry limit.`);for(const l of i)if(!l.startsWith("/")||l.split("/").some(c=>c===".."||c==="."))throw new W(`Refusing file "${l}" in ${t}/${n}.`);const o=new Map;let a=0;for(let l=0;l<i.length;l+=8)await Promise.all(i.slice(l,l+8).map(async c=>{const u=await Ce(await st(e,`${Ui}${t}/${n}@${r}${c.split("/").map(encodeURIComponent).join("/")}`),re.maxEntryBytes,c);if(a+=u.byteLength,a>re.maxTotalBytes)throw new W(`${t}/${n} exceeds the ${re.maxTotalBytes}-byte limit.`);o.set(c.slice(1),u)}));return o}function Qi(e={}){const t=e.fetch??((s,i)=>fetch(s,i)),n=e.repositoryUrl??Mi,r=new Map;return{versions(s){let i;try{i=ae(s,"a package request")}catch(a){return Promise.reject(a)}let o=r.get(i);return o||(o=(async()=>{const a=await t(n.replace("{name}",Ni(i)));if(a.status!==404){if(!a.ok)throw new Error(`Package metadata for ${i}: ${a.status} ${a.statusText}`);return Gi(i,JSON.parse(new TextDecoder().decode(await Ce(a,rt,`Package metadata for ${i}`))))}})(),r.set(i,o)),o},async files(s){const i=s.dist,o=Qt(i?.url)??Qt(s.source?.url??void 0),a=i?.reference??s.source?.reference,l=`${s.name} ${s.version}`;if(i?.url&&(i.type??"zip")==="zip"){Wi(i.url,l);const c=e.distProxy?`${e.distProxy}${encodeURIComponent(i.url)}`:i.url;let u;try{u=await st(t,c)}catch(d){if(!o||!a||e.distProxy)throw d}if(u){const d=await Ce(u,rt,l);return await Hi(d,i.shasum,l),Bi(d)}}if(o&&a)return zi(t,o.owner,o.repo,a);throw new Error(`${l} has no zip dist or GitHub source the PHP runtime can fetch.`)}}}const Cn=e=>e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength);function Yi(e){const t=e.getReader();return new ReadableStream({async pull(n){const{value:r,done:s}=await t.read();if(s)return n.close();const i=Cn(r);i.byteLength&&n.enqueue(i.slice())},cancel:n=>t.cancel(n)})}async function xn(e,t){const n=e.getReader();for(;;){const{value:r,done:s}=await n.read();if(s)return;const i=Cn(r);i.byteLength&&t(i.slice())}}async function In(e,t){const n=new TextDecoder;await xn(e,s=>{const i=n.decode(s,{stream:!0});i&&t(i)});const r=n.decode();r&&t(r)}const we="/bfwc/php-server-front.php",Dn="x-bfwc-router-declined";function Ki(e){return["<?php",...Object.entries(e).map(([n,r])=>`ini_set(${et(n)}, ${et(r)});`),"if (($_SERVER['HTTPS'] ?? '') === 'off') unset($_SERVER['HTTPS']);","if ((require $_SERVER['SCRIPT_FILENAME']) === false && !headers_sent()) header('X-Bfwc-Router-Declined: 1');",""].join(`
`)}const Ji=e=>/\.[^/]+$/.test(e);function Xi(e,t,n){const r=ct(e),s=l=>l==="/"?t:A(t,l),i=(l,c,u)=>l.endsWith(".php")?{kind:"script",file:l,scriptName:c,pathInfo:u}:{kind:"file",file:l},o=l=>["index.php","index.html"].map(c=>({url:A(l,c),file:A(s(l),c)})).find(({file:c})=>n.isFile(c));if(n.isFile(s(r)))return i(s(r),r);if(n.isDir(s(r))){const l=o(r);if(l)return i(l.file,l.url)}const a=r.split("/").filter(Boolean);for(let l=a.length-1;l>0;l--){const c=`/${a.slice(0,l).join("/")}`;if(c.endsWith(".php")&&n.isFile(s(c)))return i(s(c),c,`/${a.slice(l).join("/")}`)}if(Ji(r))return{kind:"missing"};for(let l=a.length;l>=0;l--){const c=`/${a.slice(0,l).join("/")}`;if(!n.isDir(s(c)))continue;const u=o(c);if(u)return i(u.file,u.url,r===c?void 0:r.slice(c==="/"?0:c.length)||void 0)}return{kind:"missing"}}const Yt=e=>({status:404,headers:{"content-type":"text/html; charset=UTF-8"},body:gn(new TextEncoder().encode(`<!doctype html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested resource <code>${e.replace(/[<>&"]/g,"")}</code> was not found on this server.</p></body></html>`))});function Zi(e){const t={};for(const[n,r]of Object.entries(e)){const s=n.toLowerCase();s===Dn||!r.length||(t[s]=r.length===1?r[0]:[...r])}return t}async function eo(e,t){const{php:n,files:r,docroot:s,router:i}=t;r.mkdirTree(we.slice(0,we.lastIndexOf("/"))),r.write(we,Ki(e.ini)),n.chdir(s);const o=e.host.replace(/^\[|\]$/g,""),a=`${o.includes(":")?`[${o}]`:o}:${e.port}`,l=async(d,$)=>{const m=d.url.includes("?")?d.url.slice(d.url.indexOf("?")+1):"",f={DOCUMENT_ROOT:s,SCRIPT_FILENAME:$.file,SCRIPT_NAME:$.scriptName,PHP_SELF:$.scriptName+($.pathInfo??""),SERVER_NAME:o,SERVER_PORT:String(e.port),SERVER_PROTOCOL:"HTTP/1.1",SERVER_SOFTWARE:`PHP ${t.phpVersion} Development Server (php-wasm, BuilderForce WebContainers)`,REMOTE_ADDR:"127.0.0.1",QUERY_STRING:m};return $.pathInfo&&(f.PATH_INFO=$.pathInfo),n.runStream({scriptPath:we,relativeUri:d.url,method:d.method.toUpperCase(),headers:{host:a,...d.headers},protocol:"http",body:d.body??void 0,env:t.env,$_SERVER:f})},c=async(d,$,m)=>{if(m.kind==="missing")return Yt($);if(m.kind==="file")return{status:200,headers:{"content-type":Kr(wr(m.file))},body:gn(r.read(m.file))};const f=await l(d,m);In(f.stderr,t.log).catch(()=>{});const[p,g]=await Promise.all([f.httpStatusCode,f.headers]);return g[Dn]?.length?(f.stdout.cancel(),"declined"):{status:p,headers:Zi(g),body:Yi(f.stdout)}};return{spec:e,handle:async d=>{const $=d.url.split("?")[0].split("#")[0];let m;try{m=decodeURIComponent($)||"/"}catch{return qt(400,"Bad Request")}try{let f=i?await c(d,m,{kind:"script",file:i,scriptName:i.startsWith(`${s}/`)?i.slice(s.length):`/${i.split("/").pop()}`}):"declined";return f==="declined"&&(f=await c(d,m,Xi(m,s,r)),f==="declined"&&(f=Yt(m))),t.log(`[${f.status}]: ${d.method.toUpperCase()} ${d.url}
`),f}catch(f){const p=f instanceof Error?f.message:String(f);return t.log(`[500]: ${d.method.toUpperCase()} ${d.url} - ${p}
`),qt(500,`PHP failed to handle the request: ${p}`)}}}}const pe=Ie;function to(e){const t=r=>ht(e,r).flatMap(s=>pe(e,A(r,s))?t(A(r,s)):[A(r,s)]);return{read:r=>Te(e,r)?new TextDecoder().decode(e.readFile(r)):void 0,write(r,s){e.mkdirTree(xe(r)),e.writeFile(r,s)},isDir:r=>pe(e,r),list:r=>pe(e,r)?t(r):[],remove:r=>Ae(e,r)}}async function qn(e,t){const n=await e.php.run({code:t});if(n.exitCode!==0)throw new Error(`PHP failed: ${n.errors||n.text}`);return n.text}const no=e=>`<?php
$c = json_decode(base64_decode('${Jr(new TextEncoder().encode(e))}'), true) ?: [];
$keys = ['name', 'version', 'require', 'require-dev', 'conflict', 'replace', 'provide', 'minimum-stability', 'prefer-stable', 'repositories', 'extra'];
$r = array_intersect_key($c, array_flip($keys));
if (isset($c['config']['platform'])) { $r['config']['platform'] = $c['config']['platform']; }
ksort($r);
echo md5(json_encode($r));`;async function Ln(e,t){const[n,r]=JSON.parse(await qn(e,'<?php echo json_encode([PHP_VERSION, array_map("strtolower", get_loaded_extensions())]);')),s={phpVersion:n,extensions:new Set(r)};return t.platformKnown?.(s),s}async function ro(e,t,n){const r=await Ln(e,n),s=t.workingDir?z(n.cwd,t.workingDir):n.cwd;return Li(t,{files:to(e.module.FS),source:Qi({...n.composer,fetch:n.fetch}),platform:r,projectDir:s,contentHash:i=>qn(e,no(i)),out:i=>n.io.stdout(i),err:i=>n.io.stderr(i)})}async function so(e,t,n){const{php:r,module:s}=e;if(t.kind==="composer")return{kind:"exited",code:await ro(e,t,n)};if(t.kind==="serve"){await r.setSapiName("cli-server");const o=(await Ln(e,n)).phpVersion,a=t.server.docroot?z(n.cwd,t.server.docroot):n.cwd;if(!pe(s.FS,a))return n.io.stderr(`Directory ${t.server.docroot} does not exist.
`),{kind:"exited",code:1};const l=t.server.routerIfPresent?z(n.cwd,t.server.routerIfPresent):void 0,c=t.server.router?z(n.cwd,t.server.router):l&&Te(s.FS,l)?l:void 0;if(c&&!Te(s.FS,c))return n.io.stderr(`Could not open input file: ${t.server.router}
`),{kind:"exited",code:1};const u=await eo(t.server,{php:r,files:{isFile:d=>Te(s.FS,d),isDir:d=>pe(s.FS,d),read:d=>s.FS.readFile(d),write:(d,$)=>s.FS.writeFile(d,$),mkdirTree:d=>s.FS.mkdirTree(d)},docroot:a,router:c,env:{...n.env},log:d=>n.io.stderr(d),phpVersion:o});return{kind:"serving",server:{port:u.spec.port,handle:u.handle,close:async()=>{}},banner:`[${new Date().toUTCString()}] PHP ${o} Development Server (http://${t.server.host}:${t.server.port}) started (request-driven)
`}}const i=await r.cli(["php",...t.argv],{env:{...n.env}});return await Promise.all([xn(i.stdout,o=>n.io.stdout(o)),In(i.stderr,o=>n.io.stderr(o))]),{kind:"exited",code:await i.exitCode}}const io=String.raw`<?php
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
`,oo=String.raw`<?php
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
`,ao=String.raw`<?php
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
`,lo=String.raw`<?php
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
`,co=String.raw`<?php
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
`,uo=String.raw`<?php
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
`,fo=String.raw`<?php
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
`,po=String.raw`<?php
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
`,$e="/bfwc",He="/internal/shared/auto_prepend_file.php",$o=`<?php
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
`,ho={"prepend.php":$o,"pgsql/wire.php":po,"pgsql/pdo.php":ao,"pgsql/statement.php":fo,"pgsql/includes.php":io,"pgsql/rewriter.php":uo,"pgsql/functions.php":lo,"pgsql/pg.php":co,"pgsql/pdo-pgsql.php":oo};function mo(e){for(const[r,s]of Object.entries(ho)){const i=`${$e}/${r}`;e.mkdirTree(i.slice(0,i.lastIndexOf("/"))),e.writeFile(i,s)}const t=`
require_once '${$e}/prepend.php';
`,n=me(e,He)?new TextDecoder().decode(e.readFile(He)):`<?php
`;n.includes(t)||e.writeFile(He,`${n.replace(/\?>\s*$/,"")}${t}`)}const go=e=>/^127\./.test(e)||e==="0.0.0.0"||e==="::1"||e==="localhost",_o=/^bfwc-tcp:\/\/\[?([^\]]*)\]?:(\d+)$/,We=0,Ve=1,Kt=2,ue=3;function yo(e){return class{url;CONNECTING=We;OPEN=Ve;CLOSING=Kt;CLOSED=ue;readyState=We;binaryType="arraybuffer";onopen=null;onmessage=null;onclose=null;onerror=null;listeners=new Map;channel;constructor(n){this.url=n;const r=_o.exec(n),s=r?.[1]??"",i=Number(r?.[2]);if(!r||!go(s)){queueMicrotask(()=>this.fail());return}e(i).then(o=>{if(!o)return this.fail();if(this.readyState!==We)return o.close();this.channel=o,this.readyState=Ve,o.onData(a=>this.emit("message",a)),o.onClose(()=>this.ended()),this.emit("open")},()=>this.fail())}send(n){if(this.readyState!==Ve||!this.channel)return;const r=n instanceof ArrayBuffer?new Uint8Array(n):new Uint8Array(n.buffer,n.byteOffset,n.byteLength);this.channel.send(r.slice())}setSocketOpt(){}close(){this.readyState===Kt||this.readyState===ue||(this.channel?.close(),this.ended())}on(n,r){return this.add(n,r,!1,!1)}once(n,r){return this.add(n,r,!0,!1)}addEventListener(n,r){this.add(n,r,!1,!0)}removeListener(n,r){return this.listeners.set(n,(this.listeners.get(n)??[]).filter(s=>s.listener!==r)),this}off(n,r){return this.removeListener(n,r)}removeEventListener(n,r){this.removeListener(n,r)}add(n,r,s,i){return this.listeners.set(n,[...this.listeners.get(n)??[],{listener:r,once:s,dom:i}]),this}emit(n,r){const s=this.listeners.get(n)??[];this.listeners.set(n,s.filter(l=>!l.once));const i=r?r.slice().buffer:void 0,o={type:n,target:this,data:i};for(const{listener:l,dom:c}of s)c?l(o):r?l(r,!0):l();const a={open:this.onopen,message:this.onmessage,close:this.onclose,error:this.onerror}[n];a?.(o)}ended(){this.readyState!==ue&&(this.readyState=ue,this.channel=void 0,queueMicrotask(()=>this.emit("close")))}fail(){this.readyState!==ue&&(this.emit("error"),this.ended())}}}function wo(e,t){const n=e.websocket??={};n.url=(s,i,o)=>`bfwc-tcp://${i.includes(":")?`[${i}]`:i}:${o}`,n.subprotocol="binary";const r=yo(t);n.decorator=()=>r}const bo=(e,t)=>`[${new Date().toUTCString()}] Failed to listen on ${e}:${t} (reason: Address already in use)
`;function Xa(e){const t=e.dial?void 0:$t(e.post),n=e.dial??(s=>t.dial(s));let r="localhost";return _t(e.post,s=>{async function i(a,l){const c=await e.loadPhp({baseUrl:a.php?.baseUrl,phpVersion:Nt(a.php?.phpVersion)});wo(c.module,n),mo(c.module.FS),mt(l,c.module.FS);const u=Rn(c.module.FS,d=>{s.exited||e.post({type:"fs",ops:d})});return s.mounted({apply:d=>u.quietly(()=>gt(c.module.FS,d)),flush:()=>u.flush()}),c.php.chdir(U(a.cwd)),c}async function o(a,l,c,u){const d=await i(a,c);return u.exited?{kind:"exited",code:0}:so(d,l,{cwd:U(a.cwd),env:a.env,io:u.io,composer:a.php?.composer,fetch:e.fetch,platformKnown:$=>e.post({type:"php-platform",phpVersion:$.phpVersion,extensions:[...$.extensions]})})}return{addressInUse:a=>bo(r,a),plan(a,l){const c=br(a.command,a.args,vr(a.env,a.cwd,l));if(!c.ok)return{ok:!1,message:`${a.command}: ${c.reason}
`,code:1};try{Nt(a.php?.phpVersion)}catch(d){return{ok:!1,message:`${d.message}
`,code:1}}const u=Er(c.invocation,U);return u.kind==="serve"&&(r=u.server.host),{ok:!0,port:u.kind==="serve"?u.server.port:void 0,run:d=>o(a,u,d,s)}},receive:a=>!!t?.receive(a)}})}function vo(e){return[...e.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(t=>t[1]??t[2]??t[3])}function Eo(e,t,n,r){if(n===null)return{ok:!0};const s=A(t,"Properties","launchSettings.json"),i=e(s);if(i===void 0)return n?{ok:!1,reason:`The launch profile "${n}" could not be applied: ${s} does not exist.`}:{ok:!0};let o;try{o=JSON.parse(i).profiles??{}}catch(d){return{ok:!1,reason:`A JSON parsing exception occurred in ${s}: ${d.message}`}}const a=n?Object.entries(o).find(([d])=>d===n):Object.entries(o).find(([,d])=>d.commandName==="Project");if(!a)return n?{ok:!1,reason:`The launch profile "${n}" could not be applied: it is not in ${s}.`}:{ok:!0};const[l,c]=a,u={};for(const[d,$]of Object.entries(c.environmentVariables??{}))u[d]=String($);return c.applicationUrl&&r.ASPNETCORE_URLS===void 0&&u.ASPNETCORE_URLS===void 0&&(u.ASPNETCORE_URLS=c.applicationUrl),{ok:!0,profile:{name:l,env:u,args:c.commandLineArgs?vo(c.commandLineArgs):[]}}}class F extends Error{name="DotnetBundleError"}const So="/dotnet/refs",Jt="bfwc-dotnet-",Mn=e=>e.endsWith("/")?e:`${e}/`,ko=e=>e instanceof Error?e.message:String(e);async function vt(e){const t=new Uint8Array(await crypto.subtle.digest("SHA-256",e));return Array.from(t,n=>n.toString(16).padStart(2,"0")).join("")}function To(e){const t=e.Bfwc?.Host?.Exports;if(!t)throw new F("The .NET runtime bundle has no Bfwc.Host.Exports: it was not built from dotnet-host/.");return t}async function it(e,t,n){try{return await e(t,n)}catch(r){throw new F(`The .NET runtime bundle could not be reached (${t}: ${ko(r)}).`)}}async function Un(e,t){const n=`${Mn(e)}manifest.json`,r=await it(t,n);if(!r.ok)throw new F(`The .NET runtime bundle's manifest could not be loaded (${n}: HTTP ${r.status}).`);const s=await r.text();let i;try{i=JSON.parse(s)}catch{throw new F(`The .NET runtime bundle's manifest (${n}) is not JSON.`)}if(i?.format!==At.format)throw new F(`The .NET runtime bundle at ${e} is format ${String(i?.format)}; this runtime reads format ${At.format}. To get one this runtime reads, ${dt}.`);return{manifest:i,text:s}}async function Po(e,t=fetch){return(await Un(e,t)).manifest}async function Ro(e,t){const n=globalThis.caches;if(!n)return(i,o)=>it(t,i,o);const r=`${Jt}${(await vt(new TextEncoder().encode(e))).slice(0,32)}`;let s;try{s=await n.open(r);for(const i of await n.keys())i.startsWith(Jt)&&i!==r&&n.delete(i)}catch{s=void 0}return async(i,o)=>{const a=await s?.match(i).catch(()=>{});if(a)return a;const l=await it(t,i,o);return l.ok&&s&&await s.put(i,l.clone()).catch(()=>{}),l}}async function Xt(e,t,n,r){const s=n.files?.[r];if(!s)throw new F(`The .NET runtime bundle's manifest has no hash for ${r}: to get a complete one, ${dt}.`);const i=await e(new URL(r,t).href);if(!i.ok)throw new F(`${r} of the .NET runtime bundle could not be loaded (HTTP ${i.status}).`);const o=new Uint8Array(await i.arrayBuffer());if(await vt(o)!==s)throw new F(`${r} of the .NET runtime bundle does not match its manifest's hash: refusing it.`);return o}async function Oo(e,t,n){const r=[];for(const s of n){const{offset:i,length:o}=s;if(!(Number.isSafeInteger(i)&&Number.isSafeInteger(o)&&i>=0&&o>=0&&i+o<=t.byteLength)||!/^[\w.-]+\.dll$/i.test(s.name))throw new F(`The "${e}" reference pack's entry ${JSON.stringify(s.name)} is out of bounds or misnamed: refusing it.`);const l=t.subarray(i,i+o);if(await vt(l)!==s.sha256)throw new F(`${e}/${s.name} does not match its manifest's hash: refusing it.`);r.push({name:s.name,bytes:l})}return r}async function Za(e){const t=e.fetch??((f,p)=>fetch(f,p)),n=Mn(e.bundleUrl),{manifest:r,text:s}=await Un(n,t),i=await Ro(s,t);await Xt(i,n,r,r.entry);const o=e.importModule??(f=>import(f)),{dotnet:a}=await o(new URL(r.entry,n).href);let l=a.withEnvironmentVariables(e.env).withModuleConfig({onExit:f=>e.onExit?.(f)});globalThis.caches&&(l=l.withResourceLoader((f,p,g,h)=>f==="dotnetjs"?void 0:i(g,h?{integrity:h}:void 0)));const c=await l.create();c.setModuleImports("bfwc",e.imports);const u=To(await c.getAssemblyExports(r.assembly)),d=c.Module.FS,$=new Map;async function m(f){const p=$.get(f);if(p)return p;const g=r.references[f];if(!g)throw new F(`The .NET runtime bundle has no "${f}" reference assemblies.`);const h=await Oo(f,await Xt(i,n,r,g.pack),g.files),b=`${So}/${f}`;d.mkdirTree(b);const E=new Map;for(const _ of h){const k=`${b}/${_.name}`;d.writeFile(k,_.bytes),E.set(`${f}/${_.name}`,k)}return $.set(f,E),E}return{exports:u,FS:d,manifest:r,async mountReferences(f){const p=new Map;for(const g of new Set(f))for(const[h,b]of await m(g))p.set(h,b);return p}}}function No(e){const t={};for(const[n,r]of Object.entries(JSON.parse(e)))t[n.toLowerCase()]=r.length===1?r[0]:r;return t}function Ao(e){let t;const n=new Set,r=new Map,s=new Map;let i=1,o=1;const a=c=>u=>new Promise((d,$)=>{if(!t)return $(new Error("The .NET runtime is not running."));const m=i++;r.set(m,{resolve:d,reject:$}),t.Request(m,c,u.method,u.url,JSON.stringify(u.headers),u.body??new Uint8Array(0))});return{imports:{stdout:c=>e.stdout(c),stderr:c=>e.stderr(c),listen(c){return e.taken.has(c)&&!n.has(c)?!1:(e.taken.add(c),n.add(c),e.post({type:"listen",port:c}),!0)},unlisten(c){n.delete(c)&&(e.taken.delete(c),e.post({type:"unlisten",port:c}))},respondHead(c,u,d){const $=r.get(c);if(!$)return;const m=new ReadableStream({start:f=>{$.body=f},cancel:()=>{r.delete(c),t?.CancelRequest(c)}});$.resolve({status:u,headers:No(d),body:m})},respondChunk(c,u){r.get(c)?.body?.enqueue(u.slice())},respondEnd(c,u){const d=r.get(c);if(r.delete(c),!!d){if(!d.body)return d.reject(new Error(u??"The response ended before its head."));u?d.body.error(new Error(u)):d.body.close()}},async dial(c){const u=await e.dial(c);if(!u)return-1;const d=o++;return s.set(d,u),u.onData($=>s.has(d)&&t?.TcpData(d,$)),u.onClose(()=>{s.delete(d)&&t?.TcpClosed(d)}),d},send(c,u){s.get(c)?.send(u.slice())},hangUp(c){const u=s.get(c);s.delete(c),u?.close()}},listening:n,handlerFor:c=>n.has(c)?a(c):void 0,attach(c){t=c},stop(){t?.Stop()},closeAll(){for(const c of r.values())c.body?c.body.error(new Error("The process exited.")):c.reject(new Error("The process exited."));r.clear();for(const c of s.values())c.close();s.clear()}}}const Co={DOTNET_CLI_TELEMETRY_OPTOUT:"1",DOTNET_NOLOGO:"1",DOTNET_SKIP_FIRST_TIME_EXPERIENCE:"1"},jn=e=>e.outputInProject?U(e.outputPath):e.outputPath;function xo(e,t){const n=`Microsoft.AspNetCore.App ${t.runtimeVersion} [browser]
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
`}}function ze(e,t){const n="configuration"in t?t.configuration:"Debug";if(t.kind==="run"&&t.file)return Ct(e.files,z(e.cwd,t.file),n);const r=kr(e.files,e.cwd,t.project,t.kind==="run"?"run":"build");return r.ok?Ct(e.files,r.path,n,t.kind==="build"?t.output:void 0):r}async function Io(e,t){const{io:n}=t,r=i=>(n.stderr(`${i}
`),{kind:"done",code:1}),s={...Co,...t.env};switch(e.kind){case"info":return n.stdout(xo(e.what,await t.manifest())),{kind:"done",code:0};case"exec":return{kind:"runtime",work:{env:s,run:{assembly:U(z(t.cwd,e.assembly)),args:e.appArgs,cwd:U(t.cwd)}}};case"restore":case"clean":{const i=ze(t,e);if(!i.ok)return r(i.reason);if(e.kind==="clean"){const o=Sr(i.plan);if(!o.ok)return r(o.reason);const a=o.paths.filter(l=>t.files.isFile(l));a.length&&t.sendOps(a.map(l=>({op:"remove",path:l}))),n.stdout(a.length?a.map(l=>`  Deleting file "${l}".
`).join(""):`  Nothing to clean in ${xe(i.plan.outputPath)}.
`)}else{for(const o of i.plan.notes)n.stdout(`  ${o}
`);n.stdout(`  Restore complete: ${i.plan.projectFile} uses ${i.plan.packages.length?"bundled packages only":"no NuGet packages"}.
`)}return{kind:"done",code:0}}case"build":{const i=ze(t,e);return i.ok?{kind:"runtime",work:{env:s,build:i.plan}}:r(i.reason)}case"run":{const i=ze(t,e);if(!i.ok)return r(i.reason);const o=i.plan;if(o.outputKind!=="exe")return r(`Unable to run your project.
Ensure you have a runnable project type and ensure '${o.projectFile}' supports running: its OutputType is Library.`);const a=o.fileBased?{ok:!0}:Eo(c=>t.files.readText(c),o.projectDir,e.launchProfile,s);if(!a.ok)return r(a.reason);const l=o.web?o.projectDir:t.cwd;return{kind:"runtime",work:{env:{...s,...a.profile?.env},build:e.noBuild?void 0:o,run:{assembly:jn(o),args:[...a.profile?.args??[],...e.appArgs],cwd:U(l)}}}}}}function Do(e,t,n,r=!1){const s=new Set;for(const i of e.referenceGroups)for(const o of n.references[i]?.files??[])s.add(t.get(`${i}/${o.name}`));for(const i of e.packages)for(const o of n.packages[i]?.references??[])t.has(o)&&s.add(t.get(o));return JSON.stringify({projectFile:U(e.projectFile),projectDir:U(e.projectDir),assemblyName:e.assemblyName,outputKind:e.outputKind,outputPath:jn(e),sources:e.sources.map(U),globalUsings:e.globalUsings,references:[...s].filter(Boolean),nullable:e.nullable,allowUnsafe:e.allowUnsafe,langVersion:e.langVersion,fileBased:e.fileBased,defines:e.defines,optimize:e.optimize,warningsAsErrors:e.warningsAsErrors,noWarn:e.noWarn,quiet:r})}async function qo(e,t,n){if(e.build){const r=e.build;for(const a of r.notes)n.stdout(`  ${a}
`);const s=[...r.referenceGroups,...r.packages.flatMap(a=>(t.manifest.packages[a]?.references??[]).map(l=>l.split("/")[0]))],i=await t.mountReferences(s),o=await t.exports.Build(Do(r,i,t.manifest,!!e.run));if(o!==0)return e.run&&n.stderr(`
The build failed. Fix the build errors and run again.
`),o}return e.run?t.exports.Run(e.run.assembly,e.run.args,e.run.cwd):0}const Zt=`The .NET runtime bundle is not configured: the host must pass \`dotnet.bundleUrl\` (to get the bundle, ${dt}).`,Lo=e=>`Unhandled exception. System.IO.IOException: Failed to bind to address http://localhost:${e}: address already in use.
`;function el(e){const t=e.dial?void 0:$t(e.post),n=e.dial??(r=>t.dial(r));return _t(e.post,r=>{const s={stdout:l=>r.io.stdout(l),stderr:l=>r.io.stderr(l)},i=Ao({post:e.post,dial:n,taken:r.takenPorts,...s});async function o(l,c,u,d){const $=await e.loadDotnet({bundleUrl:l,env:c,imports:i.imports,onExit:f=>r.exit(f),fetch:e.fetch});mt(d,$.FS);const m=Rn($.FS,f=>{r.exited||e.post({type:"fs",ops:f})});return r.mounted({apply:f=>m.quietly(()=>gt($.FS,f)),flush(){try{$.exports.Flush()}catch{}m.flush()}}),$.exports.Init(),i.attach($.exports),$.FS.mkdirTree(U(u)),$}const a=l=>{if(!(l instanceof F))throw l;return s.stderr(`${l.message}
`),1};return{addressInUse:Lo,receive:l=>!!t?.receive(l),plan(l){const c=Tr(l.command,l.args);if(!c.ok)return{ok:!1,message:`${c.reason}
`,code:1};const u=l.dotnet?.bundleUrl;return{ok:!0,async run(d){try{const $=await Io(c.invocation,{files:d,cwd:l.cwd,env:l.env,io:s,sendOps:f=>e.post({type:"fs",ops:f}),manifest:()=>u?Po(u,e.fetch):Promise.reject(new F(Zt))});if($.kind==="done")return{kind:"exited",code:$.code};if(!u)throw new F(Zt);const m=await o(u,$.work.env,l.cwd,d);return r.exited?{kind:"exited",code:1}:{kind:"running",ports:i,done:qo($.work,m,s).catch(a)}}catch($){return{kind:"exited",code:a($)}}}}}}})}const ot=["logs","diagnostics","methodology"],Fn={"path-absolute":"It is absolute.","path-parent":'It has a ".." segment.',"path-empty":"It is empty."},Mo=/^[A-Za-z]:/;function Et(e){const t=e.trim();return t===""?"path-empty":t.startsWith("/")||t.startsWith("\\")||Mo.test(t)?"path-absolute":t.split(/[/\\]/).some(n=>n==="..")?"path-parent":null}function Uo(e){const t={};if(typeof e!="object"||e===null||Array.isArray(e))return t;for(const n of ot){const r=e[n];typeof r=="string"&&Et(r)===null&&(t[n]=r.trim())}return t}const be=e=>({supported:!1,reason:`${e} in the browser arrives in a later release.`}),R=e=>({supported:!0,provider:e}),B=e=>({supported:!1,reason:e}),en="Infrastructure modules are applied only by a customer-cloud target (AWS, Azure, GCP).",St={postgres:{browser:R("pglite"),cloudflare:R("neon"),aws:R("rds"),azure:R("azure-postgres"),gcp:R("cloud-sql")},redis:{browser:be("Redis"),cloudflare:R("upstash"),aws:R("elasticache"),azure:R("azure-cache"),gcp:R("memorystore")},queue:{browser:be("A queue"),cloudflare:R("cloudflare-queues"),aws:R("sqs"),azure:R("service-bus"),gcp:R("pubsub")},"object-storage":{browser:be("Object storage"),cloudflare:R("r2"),aws:R("s3"),azure:R("blob-storage"),gcp:R("gcs")},mail:{browser:be("The mail catcher"),cloudflare:R("connection"),aws:R("connection"),azure:R("connection"),gcp:R("connection")},graph:{browser:B("A graph database (Neo4j, Memgraph) has no browser stand-in that speaks its protocol."),cloudflare:B("Cloudflare hosts no graph database."),aws:R("connection"),azure:R("connection"),gcp:R("connection")},connection:{browser:R("vault"),cloudflare:R("vault"),aws:R("vault"),azure:R("vault"),gcp:R("vault")},ai:{browser:R("host-relay"),cloudflare:B("app-token"),aws:B("app-token"),azure:B("app-token"),gcp:B("app-token")},external:{browser:B(en),cloudflare:B(en),aws:R("opentofu"),azure:R("opentofu"),gcp:R("opentofu")}},Gn={browser:{supported:!1,reason:"Scheduled jobs arrive in a later release."},cloudflare:R("cron-triggers"),aws:R("eventbridge"),azure:R("container-apps-jobs"),gcp:R("cloud-scheduler")},tl=Object.keys(St);function Bn(e){return typeof e=="string"&&Object.prototype.hasOwnProperty.call(St,e)}function kt(e,t){const n=Bn(e)?St[e]:void 0;return n?n[t]??B(`"${t}" is not a known target.`):B(`"${e}" is not a known resource type.`)}function nl(e,t){return kt(e,t).supported}const jo=[{name:"minute",min:0,max:59},{name:"hour",min:0,max:23},{name:"day of month",min:1,max:31},{name:"month",min:1,max:12,names:["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"],nameBase:1},{name:"day of week",min:0,max:7,names:["SUN","MON","TUE","WED","THU","FRI","SAT"],nameBase:0}],Fo={"@yearly":"0 0 1 1 *","@annually":"0 0 1 1 *","@monthly":"0 0 1 * *","@weekly":"0 0 * * 0","@daily":"0 0 * * *","@midnight":"0 0 * * *","@hourly":"0 * * * *"},Go=[31,29,31,30,31,30,31,31,30,31,30,31];function tn(e,t){if(/^\d+$/.test(e))return Number(e);const n=t.names?.indexOf(e.toUpperCase())??-1;return n>=0?n+(t.nameBase??0):void 0}function Bo(e,t){const n=new Set;for(const r of e.split(",")){const[s,i,o]=r.split("/");if(o!==void 0||!s)return`"${r}" in the ${t.name} field is not a value, range or step.`;let a=1;if(i!==void 0){if(!/^\d+$/.test(i)||Number(i)<1)return`Step "${i}" in the ${t.name} field must be a positive whole number.`;a=Number(i)}let l,c;if(s==="*")l=t.min,c=t.max;else{const[u,d,$]=s.split("-");if($!==void 0||!u)return`"${s}" in the ${t.name} field is not a value or range.`;l=tn(u,t),c=d!==void 0?tn(d,t):i!==void 0?t.max:l}if(l===void 0||c===void 0)return`"${s}" in the ${t.name} field is not a value.`;if(l<t.min||c>t.max||l>c)return`"${s}" is outside the ${t.name} field's range ${t.min}-${t.max}.`;for(let u=l;u<=c;u+=a)n.add(u)}return[...n].sort((r,s)=>r-s)}function Hn(e){const t=e.trim(),r=(Fo[t.toLowerCase()]??t).split(/\s+/).filter(Boolean);if(r.length!==5)return{ok:!1,reason:`A cron schedule has 5 fields (minute hour day-of-month month day-of-week); "${t}" has ${r.length}.`};const s=[];for(let m=0;m<5;m++){const f=Bo(r[m],jo[m]);if(typeof f=="string")return{ok:!1,reason:f};s.push(f)}const[i,o,a,l,c]=s,u=[...new Set(c.map(m=>m%7))].sort((m,f)=>m-f),d=!r[2].startsWith("*"),$=!r[4].startsWith("*");return d&&!$&&!l.some(m=>a.some(f=>f<=Go[m-1]))?{ok:!1,reason:`"${t}" never fires: no chosen month has the chosen day.`}:{ok:!0,schedule:{source:t,minutes:i,hours:o,daysOfMonth:a,months:l,daysOfWeek:u,dayOfMonthRestricted:d,dayOfWeekRestricted:$}}}const nn=new Map;function Wn(e){let t=nn.get(e);return t||(t=new Intl.DateTimeFormat("en-US",{timeZone:e,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",second:"numeric"}),nn.set(e,t)),t}function Vn(e){try{return Wn(e),!0}catch{return!1}}function at(e,t){if(t==="UTC")return e;const n={};for(const r of Wn(t).formatToParts(new Date(e)))r.type!=="literal"&&(n[r.type]=Number(r.value));return Date.UTC(n.year,n.month-1,n.day,n.hour%24,n.minute,n.second)}function Ho(e,t){if(t==="UTC")return e;const n=new Set;for(const r of[e-864e5,e,e+864e5]){const s=at(r,t)-r,i=e-s;at(i,t)===e&&n.add(i)}return n.size===0?void 0:Math.min(...n)}const ve=6e4,Wo=8;function Vo(e,t){const n=e.daysOfMonth.includes(t.getUTCDate()),r=e.daysOfWeek.includes(t.getUTCDay());return e.dayOfMonthRestricted&&e.dayOfWeekRestricted?n||r:e.dayOfMonthRestricted?n:e.dayOfWeekRestricted?r:!0}function zo(e,t){const n=new Date(t),r=n.getUTCFullYear()+Wo;for(;n.getUTCFullYear()<=r;){if(!e.months.includes(n.getUTCMonth()+1)){n.setUTCMonth(n.getUTCMonth()+1,1),n.setUTCHours(0,0,0,0);continue}if(!Vo(e,n)){n.setUTCDate(n.getUTCDate()+1),n.setUTCHours(0,0,0,0);continue}if(!e.hours.includes(n.getUTCHours())){n.setUTCHours(n.getUTCHours()+1,0,0,0);continue}if(!e.minutes.includes(n.getUTCMinutes())){n.setUTCMinutes(n.getUTCMinutes()+1,0,0);continue}return n.getTime()}}function rn(e,t,n="UTC"){const r=t.getTime();let s=Math.floor(at(r,n)/ve)*ve+ve;for(let i=0;i<1e4;i++){const o=zo(e,s);if(o===void 0)return;const a=Ho(o,n);if(a!==void 0&&a>r)return new Date(a);s=o+ve}}const Qo=/^(\d+)(ms|s|m|h|d)$/,Yo={ms:1,s:1e3,m:6e4,h:36e5,d:864e5};function zn(e){const t=Qo.exec(e.trim());if(!t)return;const n=Number(t[1])*Yo[t[2]];return n>0&&Number.isSafeInteger(n)?n:void 0}function le(e){return typeof e=="string"&&e.trim().length>0}function oe(e,t,n){return e===void 0?{}:x(e)?e:(n.push(y("invalid-value",t,{detail:"Expected an object keyed by id."})),{})}function V(e,t,n,r){e!==void 0&&!(typeof e=="string"&&t.includes(e))&&r.push(y("invalid-value",n,{value:String(e),detail:`Use one of: ${t.join(", ")}.`}))}function J(e,t,n,r){e!==void 0&&typeof e!==t&&r.push(y("invalid-value",n,{value:String(e),detail:`Expected a ${t}.`}))}function ee(e,t,n){return e===void 0?[]:Array.isArray(e)&&e.every(r=>typeof r=="string")?e:(n.push(y("invalid-value",t,{detail:"Expected a list of strings."})),[])}function te(e,t,n,r){const s=e[t];if(s!=null&&s!=="")return s;r.push(y("missing-field",n,{value:t}))}function Qn(e,t,n){e!==void 0&&(typeof e!="string"||zn(e)===void 0)&&n.push(y("invalid-duration",t,{value:String(e)}))}function he(e,t,n){for(const r of Object.keys(e))(!fn.test(r)||!Pr(r))&&n.push(y("invalid-id",`${t}.${r}`,{value:r}))}function Yn(e,t,n){const r=typeof e=="string"?Hn(e):{ok:!1,reason:"Expected a string."};r.ok||n.push(y("invalid-schedule",t,{value:String(e),detail:r.reason}))}function Kn(e,t,n){e!==void 0&&!(typeof e=="string"&&Vn(e))&&n.push(y("invalid-timezone",t,{value:String(e)}))}const Ko=["model","models","modelId","provider"],Jo=["role","workload"],Xo=/[/:.]/,sn={manual:["manual"],cron:["cron","timezone"],service:["service","event"]},Zo='A trigger is { "manual": true }, { "cron", "timezone"? } or { "service", "event" }.';function Tt(e,t,n){for(const r of e)n.push(y("invalid-value",r.path?`${t}.${r.path}`:t,{detail:r.detail}))}function ea(e,t,n){const r=oe(e.capabilities,"capabilities",n);he(r,"capabilities",n);const s=[];for(const[o,a]of Object.entries(r)){const l=`capabilities.${o}`,c=t.get(o);if(!c){n.push(y("unknown-capability",l,{value:o}));continue}s.push(o);for(const u of c.dependsOn)Y(r,u)||n.push(y("capability-missing-dependency",l,{value:u}));Tt(c.validateConfig?.(a)??[],l,n)}const i=Rr(s,t);i.ok||n.push(y("capability-dependency-cycle","capabilities",{detail:i.cycle.join(" → ")}));for(const[o,a]of Object.entries(pn(e))){const l=x(a)?a.target:void 0;if(ft.includes(l))for(const c of s)for(const u of t.get(c).requires){const d=kt(u,l);d.supported||n.push(y("capability-unsupported-target",`environments.${o}`,{severity:"warning",value:c,detail:`It needs "${u}": ${d.reason??"unsupported"}.`}))}}}function ta(e){const t=x(e.capabilities)?e.capabilities:{},n=Y(t,Oe)?t[Oe]:void 0;return x(n)&&(Ye.validateConfig?.(n)??[]).length===0?n:{}}function na(e,t,n){const r=Jo.filter(o=>e[o]!==void 0);if(r.length===0){n.push(y("missing-field",t,{value:"role"}));return}if(r.length>1){n.push(y("invalid-value",t,{detail:"Declare a role or a workload, not both."}));return}const s=r[0],i=e[s];typeof i=="string"&&$n.test(i)||(typeof i=="string"&&Xo.test(i)?n.push(y("agent-model-id",`${t}.${s}`,{value:i})):n.push(y("invalid-value",`${t}.${s}`,{value:String(i),detail:'A role is a lowercase key, e.g. "developer".'})))}function ra(e,t,n){if(typeof e!="string"){J(e,"string",t,n);return}const r=Et(e);r&&n.push(y("invalid-path",t,{value:e,detail:Fn[r]}))}function sa(e,t,n,r){const s=Or(e);if(Tt(s,t,r),!(s.length>0||!Array.isArray(e))){for(const i of e)i.startsWith(Nr)&&!Ar(i)&&r.push(y("invalid-value",t,{value:i,detail:`Environment tools: ${Cr.join(", ")}.`}));r.push(...Zr(e,n,t))}}function ia(e,t,n,r){const s=xr(e);Tt(s,t,r),!(s.length>0||!x(e))&&r.push(...es(e,n,t))}function oa(e,t,n,r){if(e!==void 0){if(!Array.isArray(e)){r.push(y("invalid-value",t,{detail:"Expected a list of triggers."}));return}e.forEach((s,i)=>{const o=`${t}.${i}`,a=x(s)?Object.keys(sn).filter(u=>s[u]!==void 0):[],l=a.length===1?a[0]:void 0;if(!l||!Object.keys(s).every(u=>sn[l].includes(u))){r.push(y("invalid-value",o,{detail:Zo}));return}const c=s;l==="manual"?c.manual!==!0&&r.push(y("invalid-value",`${o}.manual`,{value:String(c.manual),detail:"Set it to true."})):l==="cron"?(Yn(c.cron,`${o}.cron`,r),Kn(c.timezone,`${o}.timezone`,r)):((typeof c.service!="string"||!Y(n,c.service))&&r.push(y("unknown-service",`${o}.service`,{value:String(c.service)})),le(c.event)||r.push(y("missing-field",o,{value:"event"})))})}}function aa(e,t,n){const r=oe(e.agents,"agents",n);he(r,"agents",n);const s=Object.keys(r);if(s.length===0)return;const i=x(e.capabilities)?e.capabilities:{};Y(i,Oe)||n.push(y("capability-not-enabled","agents",{value:Oe}));const o=ta(e);n.push(...Xr("maxAgents",s.length,o.maxAgents,"agents",`At most ${o.maxAgents} agents; ${s.length} are declared.`));for(const[a,l]of Object.entries(r)){const c=`agents.${a}`;if(!x(l)){n.push(y("invalid-value",c,{detail:"Expected an agent object."}));continue}for(const u of Ko)Y(l,u)&&n.push(y("agent-model-id",`${c}.${u}`,{value:u}));na(l,c,n),ra(l.instructions,`${c}.instructions`,n),ee(l.skills,`${c}.skills`,n),sa(l.tools,`${c}.tools`,o,n),l.memory!==void 0&&!(typeof l.memory=="string"&&fn.test(l.memory))&&n.push(y("invalid-value",`${c}.memory`,{value:String(l.memory),detail:'A memory namespace starts with a letter and has only letters, digits, "_" and "-".'})),oa(l.triggers,`${c}.triggers`,t,n),ia(l.budget,`${c}.budget`,o,n)}}const Jn="node",Xn="browser",lt=(e,t)=>e===Jn&&t===Xn;function Zn(e,t,n,r){const s=n===Jn?`the ${r} target has no shell to run it`:`the ${n} runtime has no shell to run it`;return y("shell-command-unsupported",`${e}.command`,{value:t,detail:`Only node services on the ${Xn} target run a command through the shell (bfsh); ${s}.`})}function De(e,t,n,r=pt(t)){if(r.kind==="invalid")return[y("invalid-value",`${e}.command`,{value:t,detail:`The command line cannot be read: ${r.reason}.`})];const s=[];return r.kind==="shell"&&n!==void 0&&n.length>0&&s.push(y("shell-command-with-args",`${e}.args`,{value:t})),r.strayBackslash&&s.push(y("command-backslash",`${e}.command`,{severity:"warning",value:t})),s}function la(e){return e.code==="command-backslash"}function ca(e,t,n,r){const s=t.args??[],i=`services.${e}`,o=pt(t.command);if(r.push(...De(i,t.command,s,o)),o.kind==="argv"){const[a,...l]=o.argv,c=[...l,...s];return c.length>0?{command:a,args:c}:{command:a}}if(o.kind==="shell"){if(lt(t.runtime,n)&&s.length===0)return{command:"bfsh",args:["-c",o.line]};lt(t.runtime,n)||r.push(Zn(i,t.command,t.runtime,n))}return s.length>0?{command:t.command,args:[...s]}:{command:t.command}}function ua(e,t,n,r){const s=t.run;if(!s||typeof s.command!="string")return[];const i=`jobs.${e}.run`,o=pt(s.command),a=De(i,s.command,void 0,o),l=n[s.service]?.runtime;return o.kind==="shell"&&l!==void 0&&Gn[r].supported&&!lt(l,r)&&a.push(Zn(i,s.command,l,r)),a}const da=["http","port","query","exitZero","started"],fa=["redis","native"],pa=["neo4j","memgraph","age"],$a=["frontend","backend"],ha=["never","on-failure","always"],er=["session","always-on"],ma=["concurrency","cpu","requests"],ga=["allow","forbid","replace"],_a=["skip","run-once"];function ya(e,t){for(const[n,r]of Object.entries(e)){const s=`resources.${n}`;if(!x(r)){t.push(y("invalid-value",s,{detail:"Expected a resource object."}));continue}const i=te(r,"type",s,t);if(i!==void 0){if(!Bn(i)){t.push(y("unknown-resource-type",`${s}.type`,{value:String(i)}));continue}switch((i==="postgres"||i==="redis")&&J(r.persistent,"boolean",`${s}.persistent`,t),i){case"postgres":ee(r.extensions,`${s}.extensions`,t),J(r.name,"string",`${s}.name`,t);break;case"redis":r.maxMemoryMb!==void 0&&!(typeof r.maxMemoryMb=="number"&&r.maxMemoryMb>0)&&t.push(y("invalid-value",`${s}.maxMemoryMb`,{value:String(r.maxMemoryMb),detail:"Expected a positive number."}));break;case"queue":{const o=te(r,"engine",s,t);if(V(o,fa,`${s}.engine`,t),o==="redis"){const a=typeof r.on=="string"?e[r.on]:void 0;(!x(a)||a.type!=="redis")&&t.push(y("invalid-queue-host",`${s}.on`,{value:r.on===void 0?void 0:String(r.on)}))}break}case"graph":V(te(r,"engine",s,t),pa,`${s}.engine`,t);break;case"connection":le(r.connection)||t.push(y("missing-field",s,{value:"connection"}));break;case"ai":ee(r.models,`${s}.models`,t);break;case"external":le(r.module)||t.push(y("missing-field",s,{value:"module"})),ee(r.outputs,`${s}.outputs`,t);break}}}}function wa(e,t,n){if(e===void 0)return;if(!x(e)){n.push(y("invalid-readiness",t));return}const r=da.filter(s=>e[s]!==void 0);r.length!==1?n.push(y("invalid-readiness",t,{detail:r.length>1?`It names ${r.join(" and ")}.`:void 0})):(r[0]==="http"?!(typeof e.http=="string"&&e.http.startsWith("/")):e[r[0]]!==!0)&&n.push(y("invalid-readiness",`${t}.${r[0]}`,{detail:r[0]==="http"?'An http check names a path starting with "/".':"Set it to true."})),Qn(e.timeout,`${t}.timeout`,n)}function ba(e,t,n){const r=new Map;for(const[s,i]of Object.entries(e)){const o=`services.${s}`;if(!x(i)){n.push(y("invalid-value",o,{detail:"Expected a service object."}));continue}if(Y(t,s)&&n.push(y("duplicate-id",o,{value:s})),le(i.runtime)||n.push(y("missing-field",o,{value:"runtime"})),le(i.command)?n.push(...De(o,i.command,Array.isArray(i.args)?i.args:void 0)):n.push(y("missing-field",o,{value:"command"})),J(i.root,"string",`${o}.root`,n),ee(i.args,`${o}.args`,n),i.port!==void 0){const a=i.port;typeof a!="number"||!Number.isInteger(a)||a<1||a>65535?n.push(y("invalid-port",`${o}.port`,{value:String(a)})):r.set(a,[...r.get(a)??[],s])}V(i.role,$a,`${o}.role`,n);for(const a of ee(i.uses,`${o}.uses`,n))Y(t,a)?i.role==="frontend"&&n.push(y("frontend-uses-credentials",`${o}.uses`,{value:a,severity:"warning"})):n.push(y("unknown-resource",`${o}.uses`,{value:a}));for(const a of ee(i.dependsOn,`${o}.dependsOn`,n))Y(e,a)||n.push(y("unknown-service",`${o}.dependsOn`,{value:a}));wa(i.readiness,`${o}.readiness`,n),V(i.restart,ha,`${o}.restart`,n),i.env!==void 0&&!(x(i.env)&&Object.values(i.env).every(a=>typeof a=="string"))&&n.push(y("invalid-value",`${o}.env`,{detail:"Expected an object of string values."})),V(i.availability,er,`${o}.availability`,n),va(i.scale,`${o}.scale`,n)}for(const[s,i]of r)i.length>1&&n.push(y("duplicate-port","services",{value:String(s),detail:`Claimed by ${i.join(", ")}.`}))}function va(e,t,n){if(e===void 0)return;if(!x(e)){n.push(y("invalid-value",t,{detail:"Expected an object."}));return}const r=s=>s===void 0||typeof s=="number"&&Number.isInteger(s)&&s>=0;!r(e.min)||!r(e.max)?n.push(y("invalid-value",t,{detail:"min and max are whole numbers of instances."})):typeof e.min=="number"&&typeof e.max=="number"&&e.min>e.max&&n.push(y("invalid-value",t,{detail:"min is above max."})),V(e.metric,ma,`${t}.metric`,n)}function Ea(e,t,n){for(const[r,s]of Object.entries(e)){const i=`jobs.${r}`;if(!x(s)){n.push(y("invalid-value",i,{detail:"Expected a job object."}));continue}const o=te(s,"schedule",i,n);o!==void 0&&Yn(o,`${i}.schedule`,n),Kn(s.timezone,`${i}.timezone`,n),s.run!==void 0&&s.invoke!==void 0?n.push(y("invalid-value",i,{detail:"A job either runs a command or invokes an endpoint, not both."})):s.run===void 0&&s.invoke===void 0&&n.push(y("missing-field",i,{value:"run"}));const a=s.run??s.invoke,l=`${i}.${s.run!==void 0?"run":"invoke"}`;if(a!==void 0&&!x(a))n.push(y("invalid-value",l,{detail:"Expected an object."}));else if(x(a)){const c=te(a,"service",l,n),u=typeof c=="string"?t[c]:void 0;c!==void 0&&u===void 0&&n.push(y("unknown-service",`${l}.service`,{value:String(c)})),s.run!==void 0?le(a.command)?n.push(...De(l,a.command,void 0)):n.push(y("missing-field",l,{value:"command"})):(typeof a.path=="string"&&a.path.startsWith("/")||n.push(y("invalid-value",`${l}.path`,{value:a.path===void 0?void 0:String(a.path),detail:'An endpoint path starts with "/".'})),V(a.method,mn,`${l}.method`,n),x(u)&&u.port===void 0&&n.push(y("invoke-without-port",l,{value:String(c)})))}V(s.concurrency,ga,`${i}.concurrency`,n),Qn(s.timeout,`${i}.timeout`,n),V(s.missed,_a,`${i}.missed`,n),V(s.availability,er,`${i}.availability`,n)}}function Sa(e,t,n){if(e===void 0)return;const r=x(e)?e.routes:void 0;if(!Array.isArray(r)){n.push(y("invalid-value","ingress",{detail:'Expected { "routes": [...] }.'}));return}r.forEach((s,i)=>{const o=`ingress.routes.${i}`;!x(s)||!(typeof s.path=="string"&&s.path.startsWith("/"))?n.push(y("invalid-value",o,{detail:'A route has a path starting with "/" and a service.'})):(typeof s.service!="string"||!Y(t,s.service))&&n.push(y("unknown-service",`${o}.service`,{value:String(s.service)}))})}function ka(e,t){oe(e.environments,"environments",t);for(const[n,r]of Object.entries(pn(e))){const s=`environments.${n}`;if(!x(r)){t.push(y("invalid-value",s,{detail:"Expected an environment object."}));continue}const i=te(r,"target",s,t);i!==void 0&&!ft.includes(i)&&t.push(y("unknown-target",`${s}.target`,{value:String(i)}));const o=te(r,"tier",s,t);o!==void 0&&!hn.includes(o)&&t.push(y("invalid-tier",`${s}.tier`,{value:String(o)})),J(r.debug,"boolean",`${s}.debug`,t),J(r.connection,"string",`${s}.connection`,t),o==="production"&&r.debug===!0&&t.push(y("debug-in-production",`${s}.debug`,{value:n})),t.push(...Dr(e,n,r))}}function Ta(e,t){if(e!==void 0){if(!x(e)){t.push(y("invalid-value","paths",{severity:"warning",detail:"Expected an object with logs, diagnostics or methodology."}));return}for(const[n,r]of Object.entries(e)){const s=`paths.${n}`;if(!ot.includes(n))t.push(y("invalid-value",s,{severity:"warning",detail:`Use one of: ${ot.join(", ")}.`}));else if(typeof r!="string")t.push(y("invalid-value",s,{severity:"warning",value:String(r),detail:"Expected a string."}));else{const i=Et(r);i&&t.push(y("invalid-path",s,{severity:"warning",value:r,detail:Fn[i]}))}}}}function tr(e,t={}){const n=[],r=e;r.version!==1&&n.push(y("unsupported-version","version",{value:String(r.version)})),J(r.name,"string","name",n),J(r.$schema,"string","$schema",n);const s=oe(r.resources,"resources",n),i=oe(r.services,"services",n),o=oe(r.jobs,"jobs",n);return he(s,"resources",n),he(i,"services",n),he(o,"jobs",n),ya(s,n),ba(i,s,n),Ea(o,i,n),Sa(r.ingress,i,n),ka(e,n),Ta(r.paths,n),ea(e,t.capabilities??Ir,n),aa(e,i,n),n}function rl(e,t={}){let n;try{n=JSON.parse(e.replace(/^﻿/,""))}catch(l){return{manifest:null,issues:[y("invalid-json","",{detail:l instanceof Error?l.message:String(l)})]}}if(!x(n))return{manifest:null,issues:[y("not-an-object","")]};if(n.version===void 0)return{manifest:null,legacy:n,issues:[y("legacy-format","version",{severity:"info"})]};if(n.version!==1)return{manifest:null,issues:[y("unsupported-version","version",{value:JSON.stringify(n.version)})]};const r=tr(n,t);if(n.paths===void 0)return{manifest:n,issues:r};const{paths:s,...i}=n,o=Uo(s);return{manifest:Object.keys(o).length?{...i,paths:o}:i,issues:r}}const Pa={node:[{name:"NODE_ENV",values:{production:"production",development:"development",debug:"development"}}],php:[{name:"APP_ENV",values:{production:"production",development:"local",debug:"local"}},{name:"APP_DEBUG",values:{production:"false",development:"false",debug:"true"}}],dotnet:[{name:"ASPNETCORE_ENVIRONMENT",values:{production:"Production",development:"Development",debug:"Development"}},{name:"DOTNET_ENVIRONMENT",values:{production:"Production",development:"Development",debug:"Development"}}],python:[{name:"FLASK_DEBUG",values:{production:"0",development:"0",debug:"1"}},{name:"DJANGO_DEBUG",values:{production:"False",development:"False",debug:"True"}},{name:"PYTHONDEVMODE",values:{debug:"1"}}],rust:[{name:"RUST_LOG",values:{production:"info",development:"info",debug:"debug"}}]};function Pt(e){return e.tier==="non-production"&&e.debug===!0}function Ra(e){return e.tier==="production"?"production":Pt(e)?"debug":"development"}function Oa(e,t){const n=Ra(t),r={BUILDERFORCE_ENV:t.name,BUILDERFORCE_TIER:t.tier,BUILDERFORCE_DEBUG:String(Pt(t))};for(const s of Pa[e]??[]){const i=s.values[n];i!==void 0&&(r[s.name]=i)}return r}function sl(e){return e.tier!=="non-production"?"off":Pt(e)?"verbose":"basic"}const Na={postgres:5432},nr=new Set(["connection","ai"]);function Aa(e){const t=e.timeout===void 0?void 0:zn(e.timeout),n=t===void 0?{}:{timeoutMs:t};if("http"in e)return{kind:"http",path:e.http,...n};if("port"in e)return{kind:"port",...n};if("query"in e)return{kind:"query",...n};if("exitZero"in e)return{kind:"exit-zero",...n};if("started"in e)return{kind:"started",...n}}function Ca(e,t){let n=e;for(;t.has(n);)n++;return t.add(n),n}function xa(e,t,n,r,s,i){const o=(t.uses??[]).filter(d=>r.has(d)),a=[...new Set([...t.dependsOn??[],...o])],l=(t.uses??[]).flatMap(d=>{const $=s[d];if(!$||!nr.has($.type))return[];const m={id:d,type:$.type};return $.type==="ai"&&$.models&&(m.models=[...$.models]),[m]}),c=t.readiness?Aa(t.readiness):t.port===void 0&&t.restart==="always"?{kind:"started"}:void 0,u={id:e,type:"application",runtime:t.runtime,env:{...Oa(t.runtime,n),...t.env}};return t.role&&(u.role=t.role),t.root&&(u.root=t.root),t.command?Object.assign(u,ca(e,t,n.target,i)):t.args&&(u.args=[...t.args]),t.port!==void 0&&(u.port=t.port),a.length>0&&(u.dependsOn=a),c&&(u.readiness=c),t.restart&&(u.restartPolicy=t.restart),l.length>0&&(u.resourceUses=l),u}function Ia(e,t,n,r){return{id:e,type:"database",runtime:n,port:r,database:{engine:"postgres",provider:n,persistent:t.persistent??!1,...t.name?{name:t.name}:{}}}}function Da(e){if(e.code.startsWith("ingress-"))return y("spec","ingress",{spec:e});const t="serviceId"in e?e.serviceId:void 0;return y("spec",t?`services.${t}`:"services",{spec:e})}function il(e,t,n){const r=qr(e,t),s=[...tr(e).filter(b=>!la(b)),...r.issues],i=r.manifest,o=r.environment;if(!i||!o||xt(s))return{spec:null,environment:o,declined:[],issues:It(s)};const a=i.resources??{},l=i.services??{},c=[],u=[],d=new Set,$=new Set(Object.values(l).flatMap(b=>b.port===void 0?[]:[b.port]));for(const[b,E]of Object.entries(a)){const _=kt(E.type,o.target);if(!_.supported){c.push({id:b,reason:_.reason??`The ${o.target} target does not host "${E.type}" resources.`});continue}const k=Na[E.type];E.type==="postgres"&&k!==void 0&&_.provider?(u.push(Ia(b,E,_.provider,Ca(k,$))),d.add(b)):nr.has(E.type)||c.push({id:b,reason:`"${E.type}" resources on ${o.target} are provisioned by its deployment, not run by the application runtime.`})}for(const[b,E]of Object.entries(l))u.push(xa(b,E,o,d,a,s));const m=x(i.jobs)?Object.keys(i.jobs):[];for(const[b,E]of Object.entries(i.jobs??{}))s.push(...ua(b,E,l,o.target));const f=Gn[o.target];if(!f.supported)for(const b of m)s.push(y("jobs-not-run",`jobs.${b}`,{severity:"warning",detail:f.reason}));const p={projectId:n.projectId,services:u};i.name!==void 0&&(p.name=i.name);const g=i.ingress?.routes??[];g.length>0&&(p.ingress={routes:g.map(b=>({path:b.path,serviceId:b.service}))}),s.push(...Lr(p).map(Da));const h=It(s);return{spec:xt(h)?null:p,environment:o,declined:c,issues:h}}const rr="^[A-Za-z][A-Za-z0-9_-]*$",qa="^\\d+(ms|s|m|h|d)$",H=e=>({$ref:`#/$defs/${e}`}),Ee=e=>({type:"object",propertyNames:{pattern:rr},additionalProperties:H(e)}),X={type:"array",items:{type:"string"}},on={enum:["session","always-on"]},an={type:"string",pattern:$n.source},Qe=(e,t)=>({type:"object",properties:e,required:t,additionalProperties:!1}),Q=(e,t={},n=[])=>({type:"object",properties:{type:{const:e},...t},required:["type",...n],additionalProperties:!1}),de=(e,t)=>({type:"object",properties:{[e]:t,timeout:H("duration")},required:[e],additionalProperties:!1}),ol={$schema:"https://json-schema.org/draft/2020-12/schema",$id:jr,title:"Builderforce app manifest v1 (builderforce.json)",type:"object",properties:{$schema:{type:"string"},version:{const:1},name:{type:"string"},resources:Ee("resource"),services:Ee("service"),jobs:Ee("job"),ingress:H("ingress"),environments:{type:"object",additionalProperties:H("environment")},paths:H("paths"),capabilities:{type:"object",properties:{[Ye.id]:Ye.configSchema}},agents:Ee("agent")},required:["version"],additionalProperties:!1,$defs:{duration:{type:"string",pattern:qa},budget:Ur,trigger:{oneOf:[Qe({manual:{const:!0}},["manual"]),Qe({cron:{type:"string",minLength:1},timezone:{type:"string"}},["cron"]),Qe({service:{type:"string"},event:{type:"string",minLength:1}},["service","event"])]},agent:{type:"object",properties:{role:an,workload:an,instructions:{type:"string",description:"Project-relative. No absolute path, no .. segment."},skills:X,tools:Mr,memory:{type:"string",pattern:rr},triggers:{type:"array",items:H("trigger")},budget:H("budget")},oneOf:[{required:["role"]},{required:["workload"]}],additionalProperties:!1},resource:{oneOf:[Q("postgres",{persistent:{type:"boolean"},extensions:X,name:{type:"string"}}),Q("redis",{persistent:{type:"boolean"},maxMemoryMb:{type:"number",exclusiveMinimum:0}}),Q("queue",{engine:{enum:["redis","native"]},on:{type:"string"}},["engine"]),Q("object-storage"),Q("mail"),Q("graph",{engine:{enum:["neo4j","memgraph","age"]}},["engine"]),Q("connection",{connection:{type:"string",minLength:1}},["connection"]),Q("ai",{models:X}),Q("external",{module:{type:"string",minLength:1},outputs:X},["module"])]},readiness:{oneOf:[de("http",{type:"string",pattern:"^/"}),de("port",{const:!0}),de("query",{const:!0}),de("exitZero",{const:!0}),de("started",{const:!0})]},service:{type:"object",properties:{runtime:{type:"string",minLength:1},root:{type:"string"},command:{type:"string",minLength:1},args:X,port:{type:"integer",minimum:1,maximum:65535},role:{enum:["frontend","backend"]},uses:X,dependsOn:X,readiness:H("readiness"),restart:{enum:["never","on-failure","always"]},env:{type:"object",additionalProperties:{type:"string"}},availability:on,scale:{type:"object",properties:{min:{type:"integer",minimum:0},max:{type:"integer",minimum:0},metric:{enum:["concurrency","cpu","requests"]}},additionalProperties:!1}},required:["runtime","command"],additionalProperties:!1},job:{type:"object",properties:{schedule:{type:"string",minLength:1},timezone:{type:"string"},run:{type:"object",properties:{service:{type:"string"},command:{type:"string",minLength:1}},required:["service","command"],additionalProperties:!1},invoke:{type:"object",properties:{service:{type:"string"},method:{enum:[...mn]},path:{type:"string",pattern:"^/"}},required:["service","path"],additionalProperties:!1},concurrency:{enum:["allow","forbid","replace"]},timeout:H("duration"),missed:{enum:["skip","run-once"]},availability:on},required:["schedule"],oneOf:[{required:["run"]},{required:["invoke"]}],additionalProperties:!1},ingress:{type:"object",properties:{routes:{type:"array",items:{type:"object",properties:{path:{type:"string",pattern:"^/"},service:{type:"string"}},required:["path","service"],additionalProperties:!1}}},required:["routes"],additionalProperties:!1},overrides:{type:"object",properties:{services:{type:"object",additionalProperties:{type:"object"}},resources:{type:"object",additionalProperties:{type:"object"}},jobs:{type:"object",additionalProperties:{type:"object"}}},additionalProperties:!1},paths:{type:"object",properties:{logs:{type:"string",description:"Project-relative. Default .builderforce/logs. No absolute path, no .. segment."},diagnostics:{type:"string",description:"Project-relative. Default .builderforce/diagnostics. No absolute path, no .. segment."},methodology:{type:"string",description:"Project-relative. Default .builderforce/methodology. No absolute path, no .. segment."}},additionalProperties:!1},environment:{type:"object",properties:{target:{enum:[...ft]},connection:{type:"string"},tier:{enum:[...hn]},debug:{type:"boolean"},overrides:H("overrides")},required:["target","tier"],if:{properties:{tier:{const:"production"}}},then:{properties:{debug:{const:!1}}},additionalProperties:!1}}},La=2**31-1,Ma=6e4,Ua="UTC",ja="allow",Fa="skip";function al(e){const t=[];for(const[n,r]of Object.entries(e.jobs??{}))t.push({id:`job:${n}`,source:"job",target:n,cron:r.schedule,timeZone:r.timezone,concurrency:r.concurrency,missed:r.missed});for(const[n,r]of Object.entries(e.agents??{}))(r.triggers??[]).forEach((s,i)=>{"cron"in s&&t.push({id:`agent:${n}:${i}`,source:"agent",target:n,cron:s.cron,timeZone:s.timezone})});return t}function ll(e){const t=e.now??(()=>new Date),n=e.setTimer??((h,b)=>setTimeout(h,b)),r=e.clearTimer??(h=>clearTimeout(h)),{lease:s}=e,i=[],o=[];for(const h of e.triggers){const b=Hn(h.cron),E=h.timeZone??Ua;b.ok?Vn(E)?o.push({trigger:h,schedule:b.schedule,timeZone:E,watermark:e.since?.getTime(),handle:void 0,running:new Set}):i.push({trigger:h,reason:`"${E}" is not an IANA time zone.`}):i.push({trigger:h,reason:b.reason})}let a=!1,l=!1,c;function u(){for(const h of o)h.handle!==void 0&&r(h.handle),h.handle=void 0;c=void 0}function d(){const h=s.state;if(!a||h.kind!=="owner"||h.fencingToken===c)return;c!==void 0&&f(),c=h.fencingToken;const b=t().getTime();for(const E of o)E.watermark??=b,p(E)}function $(h,b){const E=Math.max(0,b-t().getTime());h.handle=n(()=>{h.handle=void 0,p(h)},Math.min(E,La))}function m(){const h=s.state;return c!==void 0&&h.kind==="owner"&&h.fencingToken===c&&s.assertFence(c)?!0:(f(),!1)}function f(){u();for(const h of o)h.watermark=void 0}function p(h){if(!a||!m())return;const b=t().getTime(),E=h.watermark??b,_=rn(h.schedule,new Date(E),h.timeZone);if(_===void 0)return;if(_.getTime()>b){$(h,_.getTime());return}const k=rn(h.schedule,new Date(Math.max(E,b-Ma)),h.timeZone),v=k!==void 0&&k.getTime()<=b?k:void 0;h.watermark=b,(v===void 0||_.getTime()<v.getTime())&&(h.trigger.missed??Fa)==="skip"&&e.onSkip?.(h.trigger,_,"missed"),v?g(h,v):h.trigger.missed==="run-once"&&g(h,_),p(h)}function g(h,b){const E=h.trigger.concurrency??ja;if(E==="forbid"&&h.running.size>0){e.onSkip?.(h.trigger,b,"overlap");return}if(E==="replace")for(const v of h.running)v.abort();const _=new AbortController;h.running.add(_);let k;try{k=e.onFire(h.trigger,b,_.signal)}catch(v){k=Promise.reject(v)}k.then(()=>h.running.delete(_),v=>{h.running.delete(_),e.onError(v,h.trigger,b)})}return{invalid:i,start(){a||(a=!0,l||(l=!0,s.onOwner(d)),d())},stop(){a=!1,u()}}}function cl(e,t,n={}){const r=n.task??((s,i)=>`Scheduled run of ${s.target} (${s.cron}) for ${i.toISOString()}`);return async(s,i,o)=>{if(s.source!=="agent")throw new Error(`Trigger ${s.id} is not an agent trigger.`);const{runId:a}=await e.start(s.target,{task:r(s,i),correlation:{...t,agentId:s.target,correlationId:`${s.id}@${i.toISOString()}`}});let l;const c=()=>{l??=e.cancel(a).then(()=>{},d=>({error:d}))};o.aborted?c():o.addEventListener("abort",c,{once:!0});try{for await(const d of e.events(a));}finally{o.removeEventListener("abort",c)}const u=await l;if(u)throw u.error}}export{Le as ACTIVE_STATES,Ye as AGENTS_CAPABILITY,Oe as AGENTS_CAPABILITY_ID,fl as AGENTS_POLICY_SCHEMA,pl as AGENT_BUDGET_KEYS,Ur as AGENT_BUDGET_SCHEMA,$n as AGENT_ROLE_PATTERN,jr as APP_MANIFEST_SCHEMA_URL,ol as APP_MANIFEST_SCHEMA_V1,$l as ApplicationSpecError,yn as ApplicationStartError,Ir as BUILTIN_CAPABILITIES,Jt as BUNDLE_CACHE_PREFIX,hl as CHILD_RUNTIMES_CAPABILITY,ml as CHILD_RUNTIMES_CAPABILITY_ID,gl as CHILD_RUNTIMES_CONFIG_SCHEMA,_l as CREDENTIAL_POLICY,yl as DATABASE_PROVIDER_DEFAULTS,wl as DATABASE_URL_SCHEMES,bl as DEFAULT_ENVIRONMENTS,za as DEFAULT_PGLITE_URL,vl as DEFAULT_PHP_VERSION,El as DEFAULT_PHP_WASM_BASE_URL,ws as DEFAULT_PYODIDE_INDEX_URL,Mi as DEFAULT_REPOSITORY_URL,is as DEFAULT_RESTART_LIMITS,re as DIST_LIMITS,At as DOTNET_BUNDLE,Sl as DOTNET_COMMAND_PATTERN,Co as DOTNET_ENV,jc as DOTNET_KIND,kl as DatabaseCoordinationError,W as DistRefused,F as DotnetBundleError,hn as ENVIRONMENT_TIERS,we as FRONT_SCRIPT,mn as HTTP_METHODS,ns as IllegalTransitionError,wt as InvalidPackageName,Gn as JOB_CAPABILITIES,ft as MANIFEST_TARGETS,rt as MAX_RESPONSE_BYTES,La as MAX_TIMER_DELAY_MS,Tl as NATIVE_ONLY_PACKAGES,Pl as NODE_DECLINED_COMMANDS,Rl as NODE_READINESS,Ma as ON_TIME_TOLERANCE_MS,Ps as OPEN_FILE_SYNC_MS,Fn as PATH_ISSUE_DETAIL,_s as PGLITE_VERSION,Ol as PGSQL_REASON,Nl as PHP_COMMAND_PATTERN,Fc as PHP_KIND,Al as PHP_WASM_EXTENSIONS,Cl as PHP_WASM_RELEASES,xl as PHP_WASM_VERSION,Gc as PIP_RECORD_LIMITS,K as PROJECT_MOUNT,ys as PYODIDE_VERSION,Il as PYTHON_COMMAND_PATTERN,So as REFERENCE_ROOT,St as RESOURCE_CAPABILITIES,tl as RESOURCE_TYPES,$e as RUNTIME_LIBRARY_ROOT,Dl as RUNTIME_PROVIDED_PACKAGES,ql as RUST_COMPILE_GATE,Bc as RUST_KIND,Ll as RUST_PROFILE,Z as ResolveError,Tn as SEND_HIGH_WATER_MARK,Ml as SERVER_COMMANDS,ts as SERVICE_TRANSITIONS,Ul as SUPPORTED_PHP_VERSIONS,fe as ServiceFailure,Hc as ServiceGraphPolicy,Pa as TIER_ENV_CONVENTIONS,jl as TOOL_KEY_PATTERN,Mr as TOOL_LIST_SCHEMA,Je as TRAINING_ARTIFACT_DIR,Wc as TRAINING_SINK_DEFAULTS,oi as VIRTUAL_TCP_MODULE,ot as WORKSPACE_PATH_KEYS,ls as acceptApplication,Fl as acceptsDotnetService,Gl as acceptsNodeService,Bl as acceptsPgliteService,Hl as acceptsPhpService,Wl as acceptsPythonService,Vl as acceptsRustService,cl as agentTriggerFire,Vc as allowedTools,zc as artifactKeyId,zl as assertValidSpec,xr as budgetIssues,es as budgetWideningIssues,rs as canTransition,Wi as checkDistUrl,ae as checkPackageName,Nt as checkPhpVersion,Ql as claimDatabase,al as collectTriggers,_r as compareVersions,Do as compilePlan,Xr as countWideningIssues,Yl as createCapabilityRegistry,si as createChannelTransport,ii as createDialTransport,Ao as createDotnetBridge,Qc as createDotnetProcessKind,Kl as createDotnetProvider,el as createDotnetWorkerProcess,ll as createJobScheduler,ss as createLifecycle,Jl as createNodeProvider,Qi as createPackageSource,Xl as createPgliteProvider,Yc as createPhpProcessKind,Zl as createPhpProvider,Xa as createPhpWorkerProcess,Kc as createPipRecord,as as createProviderRegistry,Jc as createPythonProcessKind,ec as createPythonProvider,Ka as createPythonWorkerProcess,Xc as createRustProcessKind,tc as createRustProvider,Ha as createTrainingArtifactStore,Zc as createTrainingChannel,eu as createTrainingSink,nc as databaseName,rc as databaseUrl,Ti as declaredClasses,Ri as dependencyOrder,ks as describeInstall,sc as describeIssue,ic as describeManifestIssue,sl as diagnosticsLevel,yo as dialSocketClass,Ni as encodePackageName,oc as envName,pn as environmentsOf,ac as evaluateCondition,Fi as expandMinified,lc as expandProperties,cc as expectedPlatform,kr as findProject,uc as frameworkDefines,ke as fromPhpPath,Ya as fromPyodidePath,Ki as frontScript,Qt as githubRepository,dc as globMatcher,Ms as headersOf,fc as ingressPathKey,pc as ingressTable,wo as installPhpSockets,Ls as installPythonExtensions,Xe as installRequirements,mo as installRuntimeLibrary,li as installVirtualSockets,$c as isDotnetCommand,go as isLocalAddress,hc as isPhpCommand,Re as isPlatformPackage,mc as isPythonCommand,Bn as isResourceType,gc as isRustCommand,Vn as isValidTimeZone,Za as loadDotnetRuntime,_c as loadPhpRuntime,Qa as loadPyodideRuntime,xi as lockText,xt as manifestHasErrors,gr as mapInvocationPaths,Er as mapPhpInvocationPaths,yc as mayConnectToDatabase,wc as mergeOverrides,tu as narrowChildPolicy,bc as nativeOnlyReason,rn as nextFire,fr as noWheelReason,ln as normalizeName,vc as orderByDependencies,Rr as orderCapabilities,Es as packagesWithoutWheels,dn as parseConstraint,Hn as parseCron,Tr as parseDotnetCommand,zn as parseDuration,Ec as parseFileBasedProgram,rl as parseManifest,br as parsePhpCommand,Sc as parseProjectFile,kc as parsePyproject,mr as parsePythonCommand,hr as parseRequirement,Tc as parseRequirementsTxt,Pc as parseRustCommand,Rc as parseServerCommand,ut as parseVersion,Oc as pgliteDataDir,ie as phpLiteral,et as phpString,vr as phpSurroundings,Nc as phpWasmModuleUrls,Vt as pickVersion,Ct as planBuild,dr as planRequirements,un as platformShortfall,Io as prepareInvocation,ai as pythonTcpModule,An as rankVersions,Ce as readCapped,Eo as readLaunchProfile,Po as readManifest,cn as readProjectRequirements,$r as readRequirementFile,sr as readinessOf,Ac as receivesDatabaseCredentials,Bt as requireArguments,qr as resolveEnvironment,z as resolveFrom,Ii as resolvePackages,kt as resourceCapability,os as restartDecision,ir as restartPolicyOf,or as roleOf,Di as rootRequirements,Xi as routeRequest,Li as runComposer,qo as runWithRuntime,Ci as runtimePackages,Cc as satisfies,cr as serviceEnv,Gr as serviceGraph,xc as serviceMap,vt as sha256Hex,Ic as shellCommandWords,vo as splitArgs,pt as splitCommandLine,Va as startApplicationRuntime,Dc as startDatabaseHost,eo as startPhpWebServer,js as startPythonAppServer,Fs as startRequestedAppServer,nl as targetSupports,Oa as tierEnv,Ra as tierMode,il as toApplicationSpec,U as toPhpPath,_e as toPyodidePath,Aa as toReadinessSpec,qc as tomlStringArray,Lc as tomlTable,Or as toolListIssues,Zr as toolWideningIssues,Rn as trackPhpWrites,Rn as trackWrappedFsWrites,Bi as unpackDist,Ai as unsupportedRepositories,Uo as usableWorkspacePaths,nu as validArtifactPath,On as validPackageName,ru as validPipInstall,tr as validateManifest,Lr as validateSpec,Et as validateWorkspacePath,Gi as versionsOf,Mc as withoutDatabaseCredentials,Gt as writeAutoloader};
