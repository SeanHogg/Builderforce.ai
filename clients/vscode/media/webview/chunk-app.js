import{lN as be,lO as ee,lP as Wn,lQ as Hn,lR as Vn,lS as zn,lT as Ie,lU as vt,lV as Qn,lW as Kn,_ as Yn,lX as Jn,lY as Xn,lZ as Xt,z as at,B as C,C as Ae,l_ as Zn,gZ as H,l$ as Zt,m0 as er,m1 as tr,m2 as nr,m3 as rr,m4 as Pe,m5 as Et,m6 as sr,m7 as lt,m8 as en,m9 as tn,ma as ir,g_ as or,mb as ar,mc as lr,md as St,me as cr,mf as kt,mg as ct,mh as ur,mi as Pt,mj as dr,mk as fr,ml as pr,mm as ut,mn as $r,mo as hr}from"./index.js";import{mp as Sa,mq as ka,mr as Pa,ms as Ta,mt as Ra,mu as Oa,h6 as Na,mv as Aa,mw as Ca,mx as xa,my as Ia,mz as Da,h4 as qa,mA as La,mB as Ma,mC as Ua,g$ as ja,mD as Fa,mE as Ga,mF as Ba,mG as Wa,mH as Ha,mI as Va,mJ as za,mK as Qa,mL as Ka,mM as Ya,mN as Ja,gR as Xa,mO as Za,mP as el,mQ as tl,mR as nl,mS as rl,mT as sl,mU as il,mV as ol,mW as al,mX as ll,mY as cl,mZ as ul,m_ as dl,m$ as fl,n0 as pl,n1 as $l,n2 as hl,h5 as ml,h3 as gl,h1 as _l,h7 as yl,n3 as wl,n4 as bl,n5 as vl,n6 as El,n7 as Sl,n8 as kl,n9 as Pl,na as Tl,nb as Rl,nc as Ol,nd as Nl,ne as Al,nf as Cl,ng as xl,nh as Il,ni as Dl,nj as ql,nk as Ll,nl as Ml}from"./index.js";import{r as mr,s as gr,h as _r,p as yr,m as Tt,c as wr,a as br,b as dt,i as vr,d as Er,Z as Sr,t as Rt,e as nn,f as kr,g as Pr,j as ra}from"./chunk-rustProcessKind.js";import{D as jl,P as Fl,k as Gl,R as Bl,S as Wl,T as Hl,l as Vl,n as zl,o as Ql,q as Kl,u as Yl,v as Jl,w as Xl,x as Zl,y as ec,z as tc}from"./chunk-rustProcessKind.js";import{V as rn}from"./chunk-vfs.js";const Tr={discovered:["preparing","failed"],preparing:["starting","stopping","failed"],starting:["ready","stopping","failed"],ready:["running","stopping","failed"],running:["stopping","stopped","failed"],stopping:["stopped","failed"],stopped:["preparing"],failed:["preparing","stopped"]},De=new Set(["preparing","starting","ready","running"]);class Rr extends Error{serviceId;from;to;constructor(t,n,r){super(`Service "${t}" cannot go from "${n}" to "${r}".`),this.serviceId=t,this.from=n,this.to=r,this.name="IllegalTransitionError"}}function Or(e,t){return Tr[e].includes(t)}function Nr(e,t){let n="discovered";return{serviceId:e,get state(){return n},transition(r){if(!Or(n,r))throw new Rr(e,n,r);const s={serviceId:e,from:n,to:r};return n=r,t?.(s),s}}}const Ar={maxRestarts:5,backoffMs:250,maxBackoffMs:5e3};function Cr(e,t,n,r,s={}){const{maxRestarts:i,backoffMs:o,maxBackoffMs:a}={...Ar,...s};return t==="exit-zero"&&n===0?{restart:!1,reason:"completed"}:e==="always"||e==="on-failure"&&n!==0?r>=i?{restart:!1,reason:"limit"}:{restart:!0,delayMs:Math.min(a,o*2**r)}:{restart:!1,reason:"policy"}}function xr(e){const t=new Map(e.map(n=>[n.id,n]));return{providers:[...t.values()],resolve(n){const r=t.get(n.runtime);if(!r){const i=[...t.keys()].join(", ")||"none";return{ok:!1,reason:`No runtime provider for "${n.runtime}" (available: ${i}).`}}const s=r.accepts(n);return s.ok?{ok:!0,provider:r}:{ok:!1,reason:s.reason}}}}function Ir(e,t){const n=[];for(const r of e){const s=t.resolve(r);s.ok||n.push({serviceId:r.id,reason:s.reason})}return n.length===0?{ok:!0}:{ok:!1,declined:n}}const Dr=20;function qr(e,t,n=Dr){return{services:e.map(r=>({id:r.id,state:r.state,...r.restarts>0?{restarts:r.restarts}:{},...r.exitCode!==void 0?{lastExitCode:r.exitCode}:{},lastLines:t.recent(r.id,n)}))}}class ce extends Error{error;constructor(t){super(t.message),this.error=t,this.name="ServiceFailure"}}function qe(e,t={}){const n=[],r=new Promise((s,i)=>{const o=()=>{let a=!1;for(const l of e){const c=l.readiness();if(c==="down")return i(new ce(l.failure()));c==="pending"&&(a=!0)}a||s()};for(const a of e)n.push(a.onChange(o));o()});return be(r,{signal:t.signal,ms:t.timeoutMs}).finally(()=>n.forEach(s=>s()))}function Qe(){const e=new Set;return{on(t){return e.add(t),()=>e.delete(t)},emit(t){for(const n of[...e])try{n(t)}catch(r){queueMicrotask(()=>{throw r})}}}}const Lr=5e3;function Mr(e={}){const t=mr(Math.max(1,e.history??Lr)),n=Math.max(1,e.readerBuffer??1e3),r=new Set;let s=!1;const i=(l,c)=>{if((l.controller.desiredSize??0)<=1){l.dropped+=1;return}l.dropped>0&&(l.controller.enqueue({serviceId:c.serviceId,source:"runtime",text:`${l.dropped} log lines dropped (reader fell behind).`,at:c.at}),l.dropped=0),l.controller.enqueue(c)},o=l=>{t.push(l);for(const c of r)c.wanted(l)&&i(c,l)},a=(l,c,u)=>o({serviceId:l,source:c,text:u,at:Date.now()});return{pipe(l,c){return(async()=>{let u,d="";try{for(u=c.getReader();;){const{value:$,done:h}=await u.read();if(h)break;const f=(d+$).split(/\r?\n/);d=f.pop()??"";for(const p of f)a(l,"output",p)}}catch($){a(l,"runtime",`Output stopped: ${ee($)}`)}finally{d&&a(l,"output",d),u?.releaseLock()}})()},note:(l,c)=>a(l,"runtime",c),recent(l,c){if(c<=0)return[];const u=[];for(const d of t)d.serviceId===l&&(u.push(d.text),u.length>c&&u.shift());return u},stream(l){let c;return new ReadableStream({start(u){c={wanted:d=>l===void 0||d.serviceId===l,controller:u,dropped:0};for(const d of t)c.wanted(d)&&u.enqueue(d);s?u.close():r.add(c)},cancel(){c&&r.delete(c)}},new CountQueuingStrategy({highWaterMark:n}))},close(){s=!0;for(const l of r)l.controller.close();r.clear()}}}function Ur(){let e;return{get pending(){return e!==void 0},schedule(t,n){clearTimeout(e),e=setTimeout(()=>{e=void 0,n()},t)},cancel(){clearTimeout(e),e=void 0}}}function jr(e,t){return t===void 0?`Exited with code ${e}.`:new RegExp(`^Exited with code ${e}\\b`).test(t)?t:`Exited with code ${e} before ready: ${t}`}function Fr(e){const{spec:t,logs:n}=e,r=Wn(t),s=Hn(t),i=r.timeoutMs??e.readinessTimeoutMs,o=Qe(),a=Nr(t.id,g=>{e.onStateChange(g),o.emit()}),l=Ur(),c=(g,k,S=!1,D)=>({serviceId:t.id,phase:g,message:k,exitCode:D,willRestart:S});let u,d,$=!1,h=!1,f=0,p=0,_,b,m,y,E=c("stopped","Not started.");function N(){const g={controller:new AbortController};u=g,d=g,$=!1,P(g)}async function P(g){a.transition("preparing");try{await qe(e.dependencies(),{signal:g.controller.signal,timeoutMs:e.dependencyTimeoutMs})}catch(O){const G=O instanceof ce?`Dependency "${O.error.serviceId}" is not available: ${O.error.message}`:`Dependencies not ready: ${ee(O)}`;return R(g,{phase:"dependency",message:G})}if(u!==g)return;const k=e.registry.resolve(t);if(!k.ok)return R(g,{phase:"declined",message:k.reason});if(b&&await be(b,{ms:e.stopTimeoutMs,onTimeout:()=>{},signal:g.controller.signal,onAbort:()=>{}}),u!==g)return;a.transition("starting");let S;try{g.handlePromise=Promise.resolve(k.provider.start(t,{env:e.env,signal:g.controller.signal,security:e.security,projectId:e.projectId})),S=await g.handlePromise}catch(O){return R(g,{phase:"start",message:ee(O)})}if(g.handle=S,u!==g){g.abandoned?b=Qn(S):S.output.cancel().catch(()=>{});return}g.drained=n.pipe(t.id,S.output),b=S.wait();const D=S.wait().then(async O=>(g.exitCode=O,m=O,await I(g,O),O));D.then(O=>j(g,O));try{const O=r.kind==="exit-zero"?S.ready().then(()=>L(g,S,D)):S.ready();await be(O,{ms:i,onTimeout:()=>{throw new Error(`Not ready after ${i}ms (${r.kind} readiness).`)},signal:g.controller.signal})}catch(O){if(u!==g)return;const G=ee(O);if(g.exitCode!==void 0||await Ie(S,0)!==void 0){g.readinessReason=G;return}return u!==g?void 0:R(g,{phase:"readiness",message:G})}u===g&&M(g)}async function L(g,k,S){(g.exitCode!==void 0||await Ie(k,0)!==void 0)&&await S}function I(g,k){const S=g.drained;if(!S)return Promise.resolve();const D=e.stopTimeoutMs,O=G=>(n.note(t.id,`Output could not be read to its end: ${ee(G)}`),!0);return g.outputDone??=be(S.then(()=>!0,O),{ms:D,onTimeout:()=>!1}).then(G=>{G||n.note(t.id,`Output did not end within ${D}ms of the exit (code ${k}); later lines may follow.`)})}function M(g){g.readyAt=Date.now(),y=void 0,a.transition("ready"),$=!0,a.transition("running"),g.completed&&v(g)}function j(g,k){if(u===g){if(r.kind==="exit-zero"&&k===0){g.completed=!0,a.state==="running"?v(g):a.state==="starting"&&M(g);return}R(g,{phase:"exit",message:jr(k,g.readinessReason),exitCode:k,clean:a.state==="running"&&k===0})}}function v(g){u=void 0,g.controller.abort(),n.note(t.id,"Completed."),a.transition("stopped")}function R(g,k){if(u!==g)return;u=void 0,g.controller.abort(),g.handle&&g.exitCode===void 0&&g.handle.kill("SIGKILL"),vt(e.processes,e.security),g.readyAt!==void 0&&Date.now()-g.readyAt>=e.stableAfterMs&&(f=0);const D=k.phase==="declined"||k.phase==="dependency"?{restart:!1}:Cr(s,r.kind,k.exitCode??1,f,e.restart),O=c(k.phase,k.message,D.restart,k.exitCode);$=!1,E=O,D.restart&&l.schedule(D.delayMs,N),a.transition(k.clean?"stopped":"failed"),k.clean?n.note(t.id,"Exited with code 0."):(y=O,n.note(t.id,`Failed (${k.phase}): ${k.message}`),e.onError(O)),D.restart&&(f+=1,n.note(t.id,`Restarting in ${D.delayMs}ms (${s}, attempt ${f}).`))}async function q(){l.cancel();const g=u;if(u=void 0,$=!1,E=c("stopped","Stopped."),De.has(a.state)){a.transition("stopping");const k=g?await zn(g,e.stopTimeoutMs):void 0;if(k&&(b=k.wait()),k&&g){const S=g.exitCode??await Ie(k,0);S!==void 0&&await I(g,S)}vt(e.processes,e.security),a.transition("stopped")}else a.state==="failed"?a.transition("stopped"):o.emit()}const x={id:t.id,async start(){const g=p;if(_&&await _,g!==p)throw new ce(c("stopped","Stopped before it started."));return!$&&!De.has(a.state)&&!l.pending&&(f=0,N()),qe([x])},stop(){return p+=1,_??=q().finally(()=>_=void 0),_},async restart(){h=!0;try{const g=x.stop(),k=p;if(await g,k!==p)throw new ce(c("stopped","Stopped while restarting."));f=0,N()}finally{h=!1,o.emit()}return qe([x])},readiness:()=>$?"ready":De.has(a.state)||l.pending||h?"pending":"down",failure:()=>E,onChange:g=>o.on(g),outputDrained:()=>d?.exitCode===void 0?Promise.resolve():I(d,d.exitCode),url:()=>u?.handle?.url(),database:()=>u?.handle?.database,snapshot:()=>({id:t.id,type:t.type,runtime:t.runtime,role:Vn(t),state:a.state,port:t.port,url:u?.handle?.url(),restarts:f,exitCode:m,error:y})};return x}class sn extends Error{failures;constructor(t){super(`Services failed to start: ${t.map(n=>`${n.serviceId} (${n.message})`).join("; ")}`),this.failures=t,this.name="ApplicationStartError"}}const he={readinessTimeoutMs:12e4,dependencyTimeoutMs:6e5,stopTimeoutMs:5e3,stableAfterMs:1e4},Gr=e=>"resolve"in e;async function Ot(e){const n=(await Promise.allSettled(e.map(([,r])=>r))).flatMap((r,s)=>{if(r.status==="fulfilled")return[];const i=r.reason instanceof ce?r.reason.error:{serviceId:e[s][0],phase:"start",message:ee(r.reason),willRestart:!1};return i.phase==="stopped"?[]:[i]});if(n.length>0)throw new sn(n)}function Br(e){const t=e.services.map(r=>`${r.id}\0${r.root??"/"}`).sort().join(""),n=_r("sha256").digest(new TextEncoder().encode(t));return`app:${e.projectId}:${Array.from(n.subarray(0,8),r=>r.toString(16).padStart(2,"0")).join("")}`}function ia(e,t){const n=gr(e),r=Gr(t.providers)?t.providers:xr(t.providers),s=Mr({history:t.logHistory,readerBuffer:t.logReaderBuffer}),i=Qe(),o=Qe(),a=new Map;let l=!1;const c=Br(e),u=(m,y)=>{const E=r.resolve(m);return E.ok?E.provider.databaseCredentials?.(m,y):void 0},d=t.processes??t.runtime,$=t.portPolicy??t.runtime.portPolicy;for(const m of n.startOrder){const y=n.dependenciesOf(m).map(E=>a.get(E));a.set(m,Fr({spec:e.services.find(E=>E.id===m),env:Kn(e,m,{databaseCredentials:u}),registry:r,logs:s,onStateChange:E=>i.emit(E),onError:E=>o.emit(E),dependencies:()=>y,readinessTimeoutMs:t.readinessTimeoutMs??he.readinessTimeoutMs,dependencyTimeoutMs:t.dependencyTimeoutMs??he.dependencyTimeoutMs,stopTimeoutMs:t.stopTimeoutMs??he.stopTimeoutMs,restart:t.restart??{},stableAfterMs:t.stableAfterMs??he.stableAfterMs,security:Object.freeze({applicationId:c,serviceId:m}),projectId:e.projectId,processes:d}))}const h=m=>{const y=a.get(m);if(!y)throw new Error(`No service "${m}" in this application.`);return y},f=()=>{if(l)throw new Error("This application runtime was disposed.")};let p,_;const b=async()=>{_?.(),_=void 0;for(const m of n.stopOrder)await h(m).stop();d.killApplication(c),p?.(),p=void 0};return{projectId:e.projectId,applicationId:c,async start(){f();const m=Ir(e.services,r);if(!m.ok){const y=m.declined.map(({serviceId:E,reason:N})=>({serviceId:E,phase:"declined",message:N,willRestart:!1}));throw y.forEach(E=>o.emit(E)),new sn(y)}p??=$.register(c,e),e.ingress?.routes.length&&(_??=t.runtime.registerIngress?.(c,e)),await Ot(n.startOrder.map(y=>[y,h(y).start()]))},stop:b,async restart(m){f();const y=h(m);await Ot([[m,y.restart()]])},async dispose(){l||(l=!0,await b(),t.runtime.forgetApplication?.(c),await Promise.all([...a.values()].map(m=>m.outputDrained())),s.close())},getService:m=>a.get(m)?.snapshot(),listServices:()=>n.startOrder.map(m=>h(m).snapshot()),diagnostics:()=>qr(n.startOrder.map(m=>h(m).snapshot()),s),getUrl:m=>a.get(m)?.url(),logs:m=>s.stream(m),onStateChange:m=>i.on(m),onError:m=>o.on(m),database(m){const y=h(m);if(e.services.find(N=>N.id===m)?.type!=="database")throw new Error(`Service "${m}" is not a database.`);const E=async()=>y.database()??Promise.reject(new Error(`Database "${m}" is not running.`));return{export:async()=>(await E()).export(),import:async N=>(await E()).import(N),reset:async()=>(await E()).reset()}}}}const Wr="0.5.16",oa=`https://cdn.jsdelivr.net/npm/@electric-sql/pglite@${Wr}/dist/index.js`,Hr="314.0.7",Vr=`https://cdn.jsdelivr.net/pyodide/v${Hr}/full/`;let ie;const zr=e=>e.endsWith("/")?e:`${e}/`;async function Qr(e){const t=globalThis;if(typeof t.importScripts=="function")try{if(t.importScripts(`${e}pyodide.js`),t.loadPyodide)return t.loadPyodide}catch{}return(await Yn(()=>import(`${e}pyodide.mjs`),[],import.meta.url)).loadPyodide}async function aa(e={}){const t=zr(e.indexURL??Vr);if(ie?.indexURL!==t){const r=Qr(t);ie={indexURL:t,load:r},r.catch(()=>{ie?.load===r&&(ie=void 0)})}const n=()=>{};return(await ie.load)({indexURL:t,env:e.env,stdout:n,stderr:n})}const Ke="/bfwc-artifacts";function Kr(e){const t=[];for(const n of e.matchAll(/(?:pure Python 3 wheel|pure Python wheel|wheel compatible with Pyodide)[^:'"]*:?\s*((?:['"][^'"]+['"](?:,\s*)?)+)/gi))for(const r of n[1].matchAll(/['"]([^'"]+)['"]/g))t.push(Xt(r[1].split(/[<>=!~;[ ]/)[0]));return[...new Set(t)]}const Yr=e=>e instanceof Error?e.message:String(e);async function Nt(e,t,n){const r=e.toPy(n);try{await e.runPythonAsync(`import micropip
${t}`,{globals:r})}finally{r.destroy?.()}}async function Ye(e,t,n={}){const r=Jn(t,n.provided),s={installed:[],provided:r.provided,declined:[...r.declined]};let i=r.install;if(!i.length)return s;const o=n.log??(()=>{});await e.loadPackage("micropip",{messageCallback:()=>{},errorCallback:o});const a=n.indexUrls?.length?[...n.indexUrls]:void 0;for(;;)try{return await Nt(e,"await micropip.install(specs, index_urls=index_urls)",{specs:i.map(l=>l.spec),index_urls:a}),s.installed.push(...i.map(l=>l.name)),s}catch(l){const c=Kr(Yr(l)).filter($=>!s.declined.some(h=>h.name===$));if(!c.length)throw l;for(const $ of c)s.declined.push({name:$,reason:Xn($)});const u=new Set(i.filter($=>c.includes($.name)).map($=>$.name)),d=c.filter($=>!u.has($));for(const $ of d)await Nt(e,'micropip.add_mock_package(name, "0.0.0")',{name:$});if(i=i.filter($=>!u.has($.name)),!i.length)return s}}function Jr(e){const t=[];e.installed.length&&t.push(`Successfully installed ${e.installed.join(" ")}`),e.provided.length&&t.push(`Provided by the runtime (not installed): ${e.provided.join(" ")}`);for(const{reason:n}of e.declined)t.push(`Declined: ${n}`);return t}const V="/project",Xr=new Set(["node_modules",".git"]),Zr=50,Te=e=>e.split("/").some(t=>Xr.has(t)),U=e=>e==="/"?V:C(V,e);function ve(e){const t=at(e);return t===V?"/":t.startsWith(`${V}/`)?t.slice(V.length):void 0}const es=new TextDecoder("utf-8",{fatal:!0,ignoreBOM:!0});function ts(e){try{return es.decode(e)}catch{return e.slice()}}const $e=(e,t)=>e.analyzePath(t).exists,Ce=(e,t)=>$e(e,t)&&e.isDir(e.stat(t).mode),Ee=(e,t)=>$e(e,t)&&!e.isDir(e.stat(t).mode),on=(e,t)=>t.startsWith("/")?t:C(e.cwd(),t),ft=(e,t)=>e.readdir(t).filter(n=>n!=="."&&n!=="..");function Re(e,t){if($e(e,t)){if(!Ce(e,t))return e.unlink(t);for(const n of ft(e,t))Re(e,`${t}/${n}`);e.rmdir(t)}}function pt(e,t){t.mkdirTree(V);for(const n of e.explicitDirectories())Te(n)||t.mkdirTree(U(n));for(const n of e.list()){if(Te(n))continue;const r=U(n);t.mkdirTree(Ae(r)),t.writeFile(r,e.readFile(n)??"")}}function $t(e,t){for(const n of t){if(Te(n.path))continue;const r=U(n.path);n.op==="write"?(e.mkdirTree(Ae(r)),Ce(e,r)&&Re(e,r),e.writeFile(r,n.content)):n.op==="mkdir"?e.mkdirTree(r):Re(e,r)}}function an(e,t,n=()=>!1){const r=new Set;let s=[],i=!1,o=0,a;const l=(p,_)=>{const b=U(p);return _==="mkdir"||_==="remove"?[{op:_,path:p}]:$e(e,b)?Ce(e,b)?_==="write"?[]:[{op:"mkdir",path:p},...ft(e,b).flatMap(m=>l(C(p,m),"tree"))]:[{op:"write",path:p,content:ts(e.readFile(b))}]:[]},c=()=>{if(i=!1,!s.length)return;const p=s;s=[];const _=p.flatMap(({op:b,path:m})=>l(m,b)).filter(b=>!n(b.path));_.length&&t(_)},u=(p,_)=>{const b=ve(_);if(!(o||b===void 0||b==="/"||n(b)||Te(b))){if(p==="write"){let m;for(const y of s)y.path===b&&(m=y);if(m?.op==="write")return}s.push({op:p,path:b}),i||(i=!0,queueMicrotask(c))}},d=()=>{for(const p of r)u("write",p)},$={openedForWrite(p){!o&&ve(p)!==void 0&&r.add(p)},written(p){o||ve(p)===void 0||(r.add(p),clearTimeout(a),a=setTimeout(d,Zr))},closed(p){r.delete(p)&&u("write",p)},madeDirectory:p=>u("mkdir",p),symlinked:p=>u("tree",p),deleted:p=>u("remove",p),moved(p,_){u("remove",p),u("tree",_)}},h=e.truncate.bind(e),f=e.ftruncate.bind(e);return e.truncate=(p,_)=>{h(p,_),typeof p=="string"&&u("write",on(e,p))},e.ftruncate=(p,_)=>{f(p,_);const b=e.getStream(p)?.path;b&&u("write",b)},{events:$,tracker:{quietly(p){o++;try{p()}finally{o--}},flush(){clearTimeout(a),d(),c()}}}}const me=U,la=ve;function ns(e,t){pt(e,t)}function rs(e,t){$t(e,t)}const ss=579,is=e=>e.includes("/__pycache__")||e.endsWith(".pyc");function os(e,t){const{tracker:n,events:r}=an(e,t,is),s={onOpenFile:((i,o)=>{o&ss&&r.openedForWrite(i)}),onWriteToFile:(i=>r.written(i)),onCloseFile:(i=>r.closed(i)),onMakeDirectory:(i=>r.madeDirectory(i)),onMakeSymlink:((i,o)=>r.symlinked(o)),onDeletePath:(i=>r.deleted(i)),onMovePath:((i,o)=>r.moved(i,o))};return Object.assign(e.trackingDelegate,s),n}const ln=e=>import(e),Je=(e,t)=>e===t||e.startsWith(t==="/"?"/":`${t}/`);function as(e,t,n){const r=at(t.root??`/opt/bfwc-extensions/${n}`);if(Je(r,V)||Je(V,r))throw new Error(`Python extension ${e.moduleUrl}: root ${r} overlaps the project (${V}); extensions are installed outside it.`);return r}function ls(e,t,n){const r=C(t,n);if(n.startsWith("/")||!Je(r,t)||r===t)throw new Error(`Python extension ${e.moduleUrl}: file "${n}" is outside its root ${t}.`);return r}async function cs(e,t,n=ln){const r=new Set,s=new Set;for(const[i,o]of t.entries()){const l=(await n(o.moduleUrl))[o.exportName];if(typeof l!="function")throw new Error(`Python extension ${o.moduleUrl} has no function export "${o.exportName}".`);const c=await l()??{},u=Object.entries(c.files??{}),d=u.length?as(o,c,i):void 0,$=u.map(([h,f])=>[ls(o,d,h),f]);for(const[h,f]of Object.entries(c.jsModules??{}))e.registerJsModule(h,f);for(const[h,f]of $)e.FS.mkdirTree(h.slice(0,h.lastIndexOf("/"))||"/"),e.FS.writeFile(h,f);d&&e.runPython(`import sys
if ${JSON.stringify(d)} not in sys.path: sys.path.insert(0, ${JSON.stringify(d)})`);for(const h of c.provides??[])r.add(Xt(h));for(const h of c.imports??(c.provides??[]).map(f=>f.replace(/-/g,"_")))s.add(h)}return{packages:r,imports:s}}function us(e){const t={};for(const[n,r]of e){const s=n.toLowerCase(),i=t[s];t[s]=i===void 0?r:Array.isArray(i)?[...i,r]:[i,r]}return t}const ds=e=>JSON.stringify(Object.entries(e.headers??{}));function cn(e){const t=e.handle,n=e.disconnect,r=e.close,s={interface:e.interface,app:String(e.label),port:Number(e.port)};let i=1;return{spec:s,handle:a=>new Promise((l,c)=>{const u=i++;let d,$=!1;const h={head(f,p){d=yr(()=>{$||n(u)}),l({status:f,headers:us(JSON.parse(p)),body:d.stream})},chunk(f){if(!(!d||d.push(f.slice())))return d.ready()},end(f){$=!0,f?d?.fail(new Error(f)):d?.end()}};t(u,a.method,a.url,ds(a),a.body??void 0,h).then(()=>{d||c(new Error("The Python app finished without a response."))},f=>{d?d.fail(f):c(f)})}),async close(){try{await r()}finally{e.destroy?.()}}}}async function fs(e,t){const n=e.pyimport("bfwc.serve").start_server;return cn(await n(t.interface,t.app,t.port,!!t.factory,t.appDir))}async function ps(e){const t=e.pyimport("bfwc.serve").start_requested;return cn(await t())}function ht(e,t){let n=new rn,r,s,i,o,a=!1;const l=p=>{if(!a){r?.flush(),a=!0,i!==void 0&&e({type:"unlisten",port:i});for(const _ of o?.listening??[])e({type:"unlisten",port:_});o?.closeAll(),e({type:"exit",code:p})}},c={post:e,io:{stdout:p=>!a&&e({type:"stdout",data:p}),stderr:p=>!a&&e({type:"stderr",data:p})},get exited(){return a},exit:l,mounted(p){n=void 0,r=p},get takenPorts(){return d.taken}},u=async(p,_=Zn(p))=>{const b=s;s=void 0,d.cancelAll();try{o?.stop()}catch{}try{await b?.close()}finally{l(_)}},d=wr({post:e,handlerFor:p=>s&&p===i?s.handle:o?.handlerFor(p),onListenFailed(p){if(p===i)i=void 0;else if(!o?.listening.has(p))return;c.io.stderr($.addressInUse(p)),u("SIGTERM",1)}}),$=t(c),h=p=>{n?br(n,p):r?.apply(p)};async function f(p){const{snapshot:_}=p;_.pack?Tt(n,_):h(_.ops);for(const E of p.ports)d.taken.add(E);const b=$.plan(p,n);if(!b.ok)return c.io.stderr(b.message),l(b.code);if(b.port!==void 0&&d.taken.has(b.port))return c.io.stderr($.addressInUse(b.port)),l(1);const m=await b.run(n);if(m.kind==="exited")return l(m.code);if(m.kind==="running")return o=m.ports,l(await m.done);const{port:y}=m.server;if(a||d.taken.has(y))return await m.server.close(),a||c.io.stderr($.addressInUse(y)),l(1);s=m.server,i=y,d.taken.add(y),e({type:"listen",port:y}),c.io.stderr(m.banner)}return{receive(p){if(!(d.receive(p)||$.receive?.(p)))switch(p.type){case"prime":return Tt(n,p.snapshot),e({type:"primed"});case"start":f(p).catch(_=>{c.io.stderr(`${_ instanceof Error?_.stack??_.message:String(_)}
`),l(1)});return;case"fs":return h(p.ops);case"kill":return void u(p.signal);case"stdin":return $.stdin?.(p.data);case"socket-open":case"socket-accept":return e({type:"socket-close",connId:p.connId});default:return}}}}const $s=String.raw`
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
`,hs=String.raw`
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
`,ms=String.raw`
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
`,gs=String.raw`
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
`,_s=String.raw`
import os

ARTIFACT_DIR = ${JSON.stringify(Ke)}


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
`,ys=String.raw`
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
`,ws=String.raw`
class UvicornWorker:
    """Named by gunicorn's -k option; the runtime reads it from the command line and serves ASGI."""
`,bs=String.raw`
"""The browser runtime serves WSGI apps itself; gunicorn is importable but never runs."""
__version__ = "0.0.0+bfwc"
version_info = (0, 0, 0)
`,Le="/opt/bfwc",vs={"bfwc/__init__.py":"","bfwc/run.py":$s,"bfwc/serve.py":hs,"bfwc/threads.py":gs,"bfwc/training.py":_s,"bfwc/vsocket.py":ms,"uvicorn/__init__.py":ys,"uvicorn/workers.py":ws,"gunicorn/__init__.py":bs};function Es(e){for(const[t,n]of Object.entries(vs)){const r=`${Le}/${t}`;e.FS.mkdirTree(r.slice(0,r.lastIndexOf("/"))),e.FS.writeFile(r,n)}e.runPython(`import sys
if ${JSON.stringify(Le)} not in sys.path: sys.path.insert(0, ${JSON.stringify(Le)})`)}const Ss=new TextDecoder;function mt(e,t){return n=>{const r=H(t,n);if(!(!e.FS.analyzePath(r).exists||e.FS.isDir(e.FS.stat(r).mode)))return Ss.decode(e.FS.readFile(r))}}const un=e=>e.map(tr).filter(t=>!!t),dn=e=>[e.PIP_INDEX_URL,...(e.PIP_EXTRA_INDEX_URL??"").split(/\s+/)].filter(t=>!!t);async function Me(e,t,n,r){const s=e.toPy({kind:t,target:n,argv:[...r]});try{const i=await e.runPythonAsync(`from bfwc.run import run_main
run_main(kind, target, argv)`,{globals:s});return i==="serve"?"serve":typeof i=="number"?i:0}finally{s.destroy?.()}}async function At(e,t,n){if(t)try{const r=e.pyimport("pyodide.code").find_imports,s=r(t),i=s.toJs?.()??[];s.destroy?.();const o=i.filter(a=>!n.provided.imports.has(a.split(".")[0]));if(!o.length)return;await e.loadPackagesFromImports(o.map(a=>`import ${a}`).join(`
`),{messageCallback:()=>{},errorCallback:a=>n.io.stderr(`${a}
`)})}catch(r){n.io.stderr(`${r instanceof Error?r.message:String(r)}
`)}}async function ks(e,t,n){const r=o=>n.io.stderr(`${o}
`),s=o=>o.declined.forEach(({reason:a})=>r(`Declined: ${a}`));for(const o of n.installs)try{s(await Ye(e,un(o.specs),{indexUrls:o.indexUrls,log:r,provided:n.provided.packages}))}catch(a){r(`Warning: could not repeat this session's earlier pip install of ${o.specs.join(" ")}: ${a instanceof Error?a.message.trim().split(`
`).pop():String(a)}`)}const i=Zt(mt(e,n.cwd),t);i.length&&s(await Ye(e,i,{indexUrls:dn(n.env),log:r,provided:n.provided.packages})),e.pyimport("bfwc.threads").install()}async function Ps(e,t,n){const r=mt(e,n.cwd),s=t.projects.flatMap(c=>{const u=H(n.cwd,c),d=Zt(r,u);return d.length||n.io.stderr(`${c}: no dependencies declared (pyproject.toml [project] dependencies or requirements.txt); its own code runs from the project directory as is.
`),d}),i=[...un(t.packages),...t.files.flatMap(c=>er(r,H(n.cwd,c))),...s],o=[...t.indexUrls,...dn(n.env)],a=await Ye(e,i,{indexUrls:o,log:c=>n.io.stderr(`${c}
`),provided:n.provided.packages});for(const c of Jr(a))(c.startsWith("Declined")?n.io.stderr:n.io.stdout)(`${c}
`);const l=i.filter(c=>a.installed.includes(c.name)).map(c=>c.spec);return l.length&&n.io.installed?.({specs:l,indexUrls:o}),a.declined.length?1:0}async function Ts(e,t,n){const r=a=>({kind:"exited",code:a});if(t.kind==="install")return e.pyimport("bfwc.threads").install(),r(await Ps(e,t,n));const s=t.kind==="serve"&&t.server.appDir?H(n.cwd,t.server.appDir):n.cwd;if(await ks(e,s,n),t.kind==="serve")return{kind:"serving",server:await fs(e,t.server)};const i=mt(e,n.cwd);let o;return t.kind==="script"?(await At(e,i(t.path),n),o=await Me(e,"script",t.path,t.argv)):t.kind==="code"?(await At(e,t.code,n),o=await Me(e,"code",t.code,t.argv)):o=await Me(e,"module",t.module,t.argv),o==="serve"?{kind:"serving",server:await ps(e)}:r(o)}const fn=64*1024;class Rs{channel;highWaterMark;queue=[];unacked=0;ended=!1;constructor(t,n,r=fn){this.channel=t,this.highWaterMark=r,t.manualFlowControl(),t.onData(s=>{this.queue.push(s),n()}),t.onConsumed(s=>{this.unacked=Math.max(0,this.unacked-s),this.unacked<=this.highWaterMark&&n()}),t.onClose(()=>{this.ended=!0,n()})}get writable(){return this.unacked<=this.highWaterMark}tryRecv(t){const n=this.queue.shift();if(!n)return this.ended?null:void 0;const r=n.byteLength>t?n.subarray(0,t):n;return r!==n&&this.queue.unshift(n.subarray(t)),this.channel.closed||this.channel.consumed(r.byteLength),r}send(t){this.channel.send(t),this.unacked+=t.byteLength}close(){this.ended=!0,this.queue.length=0,this.channel.close()}}const Os=new Set(["localhost","127.0.0.1","::1","0.0.0.0",""]),Ct=e=>{const t=e.wakeReader;e.wakeReader=void 0,t?.();for(const n of e.wakeSenders.splice(0))n()};function Ns(e,t=fn){const n=new Map;let r=1;const s=i=>{const o=n.get(i);if(!o)throw new Error(`Bad file descriptor: connection ${i} is closed.`);return o};return{async connect(i,o){if(!Os.has(i.toLowerCase()))throw new Error(`connect ECONNREFUSED ${i}:${o} (only localhost is reachable in the browser runtime)`);const a=await e(o);if(!a)throw new Error(`connect ECONNREFUSED ${i}:${o}`);const l=r++,c={wakeSenders:[]},u=Object.assign(c,{endpoint:new Rs(a,()=>Ct(c),t)});return n.set(l,u),l},async send(i,o){const a=s(i),{endpoint:l}=a;if(l.ended)throw new Error("Broken pipe: the connection is closed.");for(l.send(o);!l.writable&&!l.ended;)await new Promise(c=>a.wakeSenders.push(c))},async recv(i,o){const a=s(i);for(;;){const l=a.endpoint.tryRecv(o);if(l!==void 0)return l;await new Promise(c=>a.wakeReader=c)}},close(i){const o=n.get(i);o&&(o.endpoint.close(),Ct(o),n.delete(i))}}}function As(e){const t=dt(e);return{transport:Ns(n=>t.dial(n)),receive:n=>t.receive(n)}}const Cs="_bfwc_tcp",Se="timeout",xt=e=>new Promise(t=>setTimeout(()=>t(Se),e));function xs(e){const t=new Map;return{async connect(n,r,s){const i=e.connect(n,r);if(s==null)return i;const o=await Promise.race([i,xt(s)]);if(o===Se)throw i.then(a=>e.close(a),()=>{}),new Error("timed out");return o},send:(n,r)=>Promise.resolve(e.send(n,r.slice())),async recv(n,r,s){const i=t.get(n)??e.recv(n,r);t.set(n,i);const o=s==null?await i:await Promise.race([i,xt(s)]);return o===Se?Se:(t.delete(n),o??void 0)},shutdown:n=>e.shutdown?.(n),close(n){t.delete(n),e.close(n)}}}function Is(e,t){e.registerJsModule(Cs,xs(t)),e.runPython(`import bfwc.vsocket
bfwc.vsocket.install()`)}const Ds="_bfwc_training",qs=50,Ls=12e4;function*pn(e,t,n=""){for(const r of e.readdir(t)){if(r==="."||r==="..")continue;const s=`${t}/${r}`,i=n?`${n}/${r}`:r,{mode:o}=e.lstat(s);e.isLink(o)||(e.isDir(o)?yield*pn(e,s,i):e.isFile(o)&&(yield[i,s]))}}const Ms=e=>e.analyzePath(Ke).exists?[...pn(e,Ke)]:[];function Us(e){let t=!1,n,r=0,s=0;const i=new Map;async function o(a=!1){if(!n)return{ok:!1,error:"Not a training process.",confirmed:!1};const{py:l,options:c}=n,u=++r;let d;try{if(d=Ms(l.FS),a&&d.length===0)return{ok:!0,confirmed:!1};for(const[h,f]of d){const p=l.FS.readFile(f);e({type:"training-artifact",saveId:u,path:h,bytes:p},[p.buffer])}}catch(h){return{ok:!1,error:`Could not read the artifacts: ${h instanceof Error?h.message:String(h)}`,confirmed:!1}}const $=c.acks?new Promise(h=>{i.set(u,h),setTimeout(()=>i.get(u)===h&&(i.delete(u),h({ok:!1,error:"The page did not acknowledge the save.",confirmed:!1})),Ls)}):void 0;return e({type:"training-saved",saveId:u,files:d.length}),$??{ok:!0,confirmed:!1}}return{receive(a){return vr(a)?a.type==="checkpoint"?(t=!0,!0):(i.get(a.saveId)?.(a.superseded?{ok:!0,confirmed:!1,superseded:!0}:{ok:a.ok,error:a.error,confirmed:a.ok}),i.delete(a.saveId),!0):!1},install(a,l){n={py:a,options:l,cell:l.flag?new Int32Array(l.flag):void 0};const c=n.cell;a.registerJsModule(Ds,{checkpoint_requested:()=>t||c!==void 0&&Atomics.load(c,0)!==0,should_yield:()=>{if(c||t)return!1;const u=Date.now();return u-s<qs?!1:(s=u,!0)},tick:()=>new Promise(u=>setTimeout(u,0)),save:()=>o().then(u=>({error:u.ok?"":u.error??"The save failed.",confirmed:u.confirmed}))})},async saveAtExit(a){if(!n)return;const l=await o(!0);l.ok||a(`bfwc.training: the artifacts were not saved: ${l.error??"unknown error"}
`)}}}const js=e=>`[Errno 98] error while attempting to bind on address ('0.0.0.0', ${e}): address already in use
`,Fs=e=>/fatal error/i.test(e instanceof Error?e.message:String(e));function ca(e){const t=[],n=new TextDecoder,r=e.tcp?void 0:As(e.post),s=e.tcp??r.transport,i=Us((a,l)=>e.post(a,l)),o=a=>t.push(...a.split(/(?<=\n)/).filter(Boolean));return ht(e.post,a=>{async function l(u,d){const $={...u.env,PYTHONDONTWRITEBYTECODE:"1",PYTHONUNBUFFERED:"1",PWD:me(u.cwd)},h=await e.loadPyodide({indexURL:u.python?.indexURL,env:$}),f=E=>({write:N=>(a.io[E](N.slice()),N.length),isatty:!1});h.setStdout(f("stdout")),h.setStderr(f("stderr")),h.setStdin({stdin:()=>t.shift()??null,isatty:!1}),Es(h),Is(h,s);const p=u.python?.training;p&&i.install(h,p);const _=await cs(h,u.python?.extensions??[],e.importModule??ln);ns(d,h.FS);const b=os(h.FS,E=>{a.exited||e.post({type:"fs",ops:E})});a.mounted({apply:E=>b.quietly(()=>rs(h.FS,E)),flush:()=>b.flush()});const m=h.pyimport("bfwc.run").bootstrap,y=h.toPy($);try{m(y,me(u.cwd))}finally{y.destroy?.()}return{py:h,provided:_}}async function c(u,d,$){const{py:h,provided:f}=await l(u,$);if(a.exited)return{kind:"exited",code:0};const p=await Ts(h,d,{cwd:me(u.cwd),env:u.env,io:{stdout:a.io.stdout,stderr:a.io.stderr,installed:b=>e.post({type:"python-installed",...b})},installs:u.python?.installs??[],provided:f});if(p.kind==="exited")return i.saveAtExit(a.io.stderr).then(()=>p);const _=p.server;return{kind:"serving",server:{port:_.spec.port,handle:Gs(_,a),close:()=>_.close()},banner:`Serving ${_.spec.interface.toUpperCase()} app ${_.spec.app} on http://localhost:${_.spec.port} (request-driven)
`}}return{addressInUse:js,plan(u){const d=nr(u.command,u.args,u.env);if(!d.ok)return{ok:!1,message:`${u.command}: ${d.reason}
`,code:2};const $=rr(d.invocation,me);return{ok:!0,port:$.kind==="serve"?$.server.port:void 0,run:h=>c(u,$,h)}},stdin:u=>o(u===null?n.decode():typeof u=="string"?u:n.decode(u,{stream:!0})),receive:u=>i.receive(u)||!!r?.receive(u)}})}function Gs(e,t){return n=>e.handle(n).catch(r=>{throw Fs(r)&&(t.io.stderr(`${r instanceof Error?r.message:String(r)}
`),t.exit(1)),r})}const Bs=3,Ws=64,Hs=512;function Vs(e){return typeof e=="string"?/[wa+]/.test(e):(e&Bs)!==0||(e&(Ws|Hs))!==0}function $n(e,t){const{tracker:n,events:r}=an(e,t),s=o=>on(e,o),i={open:e.open,write:e.write,close:e.close,mkdir:e.mkdir,unlink:e.unlink,rmdir:e.rmdir,rename:e.rename,symlink:e.symlink};return e.open=function(o,a,l){const c=i.open.call(this,o,a,l);return Vs(a)&&c.path&&r.openedForWrite(c.path),c},e.write=function(o,...a){const l=i.write.call(this,o,...a);return o.path&&r.written(o.path),l},e.close=function(o){const a=o.path;i.close.call(this,o),a&&r.closed(a)},e.mkdir=function(o,a){const l=i.mkdir.call(this,o,a);return r.madeDirectory(s(o)),l},e.unlink=function(o){i.unlink.call(this,o),r.deleted(s(o))},e.rmdir=function(o){i.rmdir.call(this,o),r.deleted(s(o))},e.rename=function(o,a){i.rename.call(this,o,a),r.moved(s(o),s(a))},e.symlink=function(o,a){const l=i.symlink.call(this,o,a);return r.symlinked(s(a)),l},n}const Xe=e=>`'${e.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;function ne(e,t){return e==null?"null":typeof e=="boolean"||typeof e=="number"?JSON.stringify(e):typeof e=="string"?t?.(e)??Xe(e):Array.isArray(e)?`[${e.map(n=>ne(n,t)).join(", ")}]`:`[${Object.entries(e).map(([n,r])=>`${ne(n)} => ${ne(r,t)}`).join(", ")}]`}const zs=String.raw`<?php
// Generated by the BuilderForce WebContainers PHP runtime (composer install).
require_once __DIR__ . '/composer/ClassLoader.php';
require_once __DIR__ . '/composer/InstalledVersions.php';
return \Composer\Autoload\ClassLoader::bfwcBoot(require __DIR__ . '/composer/autoload_bfwc.php');
`,Qs=String.raw`<?php
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
`,Ks=String.raw`<?php
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
`,Ys=/^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z_\x80-￿][A-Za-z0-9_\x80-￿]*)/gm,Js=/^\s*namespace\s+([A-Za-z_\\][A-Za-z0-9_\\]*)\s*[;{]/m;function Xs(e){const t=e.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*(\/\/|#).*$/gm,""),n=Js.exec(t)?.[1];return[...t.matchAll(Ys)].map(r=>n?`${n}\\${r[2]}`:r[2])}function Ue(e,t,n,r,s){if(!s)return;const i=a=>C(n,r,a);for(const[a,l]of Object.entries(s["psr-4"]??{}))(e.psr4[a]??=[]).push(...[l].flat().map(i));for(const[a,l]of Object.entries(s["psr-0"]??{}))(e.psr0[a]??=[]).push(...[l].flat().map(i));for(const a of s.files??[])e.files.push(i(a));const o=(s["exclude-from-classmap"]??[]).map(i);for(const a of s.classmap??[]){const l=i(a),c=t.isDir(l)?t.list(l).filter(u=>/\.(php|inc|hh)$/.test(u)):[l];for(const u of c)if(!o.some(d=>u.startsWith(d)))for(const d of Xs(t.read(u)??""))e.classmap[d]??=u}}const Zs=e=>t=>t===e||t.startsWith(`${e}/`)?`$baseDir . ${ne(t.slice(e.length))}`:void 0;function ei(e){const t=new Map(e.map(i=>[i.name.toLowerCase(),i])),n=new Set,r=[],s=(i,o)=>{const a=i.name.toLowerCase();if(!(n.has(a)||o.has(a))){o.add(a);for(const l of Object.keys(i.require??{}).sort()){const c=t.get(l.toLowerCase());c&&s(c,o)}o.delete(a),n.add(a),r.push(i)}};for(const i of[...e].sort((o,a)=>o.name.localeCompare(a.name)))s(i,new Set);return r}function It(e,t,n,r,s){const i={psr4:{},psr0:{},classmap:{},files:[]};Ue(i,e,t,"",n.autoload),s.dev&&Ue(i,e,t,"",n["autoload-dev"]);const o=i.files.splice(0);for(const d of ei(r))Ue(i,e,t,`vendor/${d.name}`,d.autoload);i.files.push(...o);const a=C(t,"vendor"),l=Zs(t);e.write(C(a,"autoload.php"),zs),e.write(C(a,"composer/ClassLoader.php"),Qs),e.write(C(a,"composer/InstalledVersions.php"),Ks),e.write(C(a,"composer/autoload_bfwc.php"),`<?php
// Generated by the BuilderForce WebContainers PHP runtime.
$baseDir = dirname(__DIR__, 2);
return ${ne(i,l)};
`),e.write(C(a,"composer/installed.json"),`${JSON.stringify({packages:r,dev:s.dev,"dev-package-names":[...s.devPackages]},null,4)}
`);const c=Object.fromEntries(r.map(d=>[d.name,{pretty_version:d.version,version:d.version_normalized??d.version,reference:d.dist?.reference??d.source?.reference??null,type:d.type??"library",install_path:C(a,d.name),aliases:[],dev_requirement:s.devPackages.has(d.name)}])),u={name:n.name??"__root__",pretty_version:n.version??"dev-main",version:n.version??"dev-main",reference:null,type:"project",install_path:t,aliases:[],dev:s.dev};e.write(C(a,"composer/installed.php"),`<?php
$baseDir = dirname(__DIR__, 2);
return ${ne({root:u,versions:{...c,[u.name]:{...u,dev_requirement:!1}}},l)};
`)}const ti=/^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]?|-{0,2})[a-z0-9]+)*$/;class gt extends Error{}const hn=e=>ti.test(e)&&!mn(e),mn=e=>e.split("/").some(t=>t==="."||t===".."||t===""),_t=(e,t)=>new gt(`Invalid package name "${e}" in ${t}: Composer names are vendor/package, lower-case letters, digits and [_.-] separators.`);function se(e,t){const n=e.toLowerCase();if(Pe(n)||hn(n))return n;throw _t(e,t)}function Ze(e,t){const n=typeof e=="string"?e.toLowerCase():"";if(hn(n))return n;throw _t(String(e),t)}function je(e,t){return C(e,"vendor",Ze(t,"a vendor path"))}function ni(e){if(mn(e))throw _t(e,"a repository URL");return e.split("/").map(encodeURIComponent).join("/")}function ri(e){const n=(Array.isArray(e.repositories)?e.repositories:Object.entries(e.repositories??{}).map(([r,s])=>s===!1?{type:`${r}: false`}:s)).map(r=>r).filter(r=>!(r?.type==="composer"&&typeof r.url=="string"&&/^https:\/\/(repo\.)?packagist\.org\/?$/.test(r.url))).map(r=>typeof r?.type=="string"?r.type:"unknown");if(n.length)return`composer.json declares repositories of type ${[...new Set(n)].join(", ")}, which the PHP runtime does not support (it installs from Packagist, or the host's php.composer.repositoryUrl, only).`}function Dt(e){const t=[];for(const n of e){const r=/^([^:=\s]+)[:=](.+)$/.exec(n);r?t.push({name:se(r[1],"composer require"),constraint:r[2]}):!n.includes("/")&&t.length&&t[t.length-1].constraint===void 0?t[t.length-1].constraint=n:t.push({name:se(n,"composer require")})}return t}function si(e,t){const n=new Map;for(const i of t.values())for(const o of[...Object.keys(i.replace??{}),...Object.keys(i.provide??{})])n.set(o.toLowerCase(),i.name);const r=new Set,s=Object.keys(e.require??{}).map(i=>i.toLowerCase());for(;s.length;){const i=s.shift(),o=t.get(i)??t.get(n.get(i)??"");!o||r.has(o.name)||(r.add(o.name),s.push(...Object.keys(o.require??{}).map(a=>a.toLowerCase())))}return r}function ii(e,t){return`${JSON.stringify({_readme:["This file locks the dependencies of your project to a known state","Written by the BuilderForce WebContainers PHP runtime"],...e,aliases:[],"minimum-stability":t.minimumStability,"stability-flags":{},"prefer-stable":t.preferStable,"prefer-lowest":!1,platform:{},"platform-dev":{},"plugin-api-version":"2.6.0"},null,4)}
`}class K extends Error{}const et=e=>lt(e.version_normalized??e.version),qt=e=>Object.entries(e.require??{}).map(([t,n])=>({name:se(t,`${e.name}'s require`),constraint:n,from:e.name})),Lt=e=>[...Object.keys(e.replace??{}),...Object.keys(e.provide??{})].map(t=>t.toLowerCase());function Mt(e,t,n){return gn(e,t,n)[0]}function gn(e,t,n,r){const s=t.reduce((l,c)=>c.stability&&Et({stability:l},c.stability)?c.stability:l,n.minimumStability),i=e.map(l=>({pkg:l,version:et(l)})).filter(l=>!!l.version&&Et(l.version,s)&&t.every(c=>c.test(l.version))).sort((l,c)=>sr(c.version,l.version)),o=n.preferStable?[...i.filter(l=>l.version.stability==="stable"),...i.filter(l=>l.version.stability!=="stable")]:i,a=r===void 0?-1:o.findIndex(l=>l.pkg.version===r);return a>0&&o.unshift(...o.splice(a,1)),o.map(l=>l.pkg)}function Ut(e,t){return t.map(n=>{const r=tn(n.constraint);if(!r)throw new K(`Cannot read the version constraint "${n.constraint}" on ${e} (required by ${n.from}).`);return r})}async function oi(e,t,n,r={}){const s=new Set(Lt(r)),i={steps:n.maxSteps??2e4};let o="",a=-1;const l=(f,p)=>{f>=a&&(o=p,a=f)},c=new Map,u=async f=>(c.has(f)||c.set(f,await t.versions(f)),c.get(f)),d=f=>{const p=[{from:"root",conflict:r.conflict},...[...f.values()].map(_=>({from:_.name,conflict:_.conflict}))];for(const{from:_,conflict:b}of p)for(const[m,y]of Object.entries(b??{})){const E=m.toLowerCase(),N=tn(y),P=f.get(E),L=P&&et(P);if(L&&N?.test(L))return`${_} conflicts with ${P.name} ${y}`;for(const I of f.values()){const M={...I.provide,...I.replace},j=Object.entries(M).find(([R])=>R.toLowerCase()===E)?.[1];if(j===void 0)continue;const v=lt(j==="self.version"?I.version_normalized??I.version:j.replace(/^[=\s]+/,""));if(v&&N?.test(v))return`${_} conflicts with ${E} ${y} (${I.name} ${j==="self.version"?"replaces/provides it":`provides ${j}`})`}}},$=async f=>{if(--i.steps<0)throw new K("Dependency resolution took too long; pin the conflicting packages in composer.json.");const p=new Map;for(const P of[...e,...[...f.values()].flatMap(qt)])Pe(P.name)||p.set(P.name,[...p.get(P.name)??[],P]);const _=new Set([...s,...[...f.values()].flatMap(Lt)]);for(const[P,L]of f){const I=p.get(P)??[],M=et(L),j=Ut(P,I),v=I.find((R,q)=>!j[q].test(M));if(v){l(f.size,`${P} ${L.version} was chosen, but ${v.from} requires ${P} ${v.constraint}.`);return}}const b=d(f);if(b){l(f.size,`${b}.`);return}const m=[...p.keys()].filter(P=>!f.has(P)&&!_.has(P));let y;for(const P of m)if(await u(P)){y=P;break}if(y===void 0){if(!m.length)return f;const P=m[0];l(f.size,`Package ${P} (required by ${p.get(P).map(L=>L.from).join(", ")}) was not found in the repository, and no chosen package provides or replaces it.`);return}const E=p.get(y),N=gn(await u(y),Ut(y,E),n,n.preferred?.get(y));if(!N.length){l(f.size,`No version of ${y} satisfies ${E.map(P=>`${P.constraint} (required by ${P.from})`).join(" and ")} at minimum-stability ${n.minimumStability}.`);return}for(const P of N){const L=n.platform&&Object.entries(P.require??{}).map(([M,j])=>Pe(M.toLowerCase())?en(M,j,n.platform):void 0).find(Boolean);if(L){l(f.size,`${P.name} ${P.version} is declined: ${L}`);continue}try{qt(P)}catch(M){if(!(M instanceof gt))throw M;l(f.size,`${P.name} ${P.version} is skipped: ${M.message}`);continue}const I=await $(new Map([...f,[y,P]]));if(I)return I}},h=await $(new Map);if(!h)throw new K(o||"No installable set of packages satisfies composer.json.");return{packages:h}}function ai(e,t){return[...Object.entries(e.require??{}),...t?[]:Object.entries(e["require-dev"]??{})].map(([r,s])=>({name:r.toLowerCase(),constraint:s,from:"root"}))}class X extends Error{}const li=["pre-install-cmd","post-install-cmd","pre-update-cmd","post-update-cmd","post-autoload-dump","post-root-package-install","post-create-project-cmd"],ge=(e,t)=>{try{return JSON.parse(e)}catch(n){throw new X(`${t} does not contain valid JSON: ${n instanceof Error?n.message:String(n)}`)}};function Fe(e,t,n,r){return[...Object.entries({...e.require,...n?e["require-dev"]:{}}).map(([o,a])=>({name:o,constraint:a,from:"your project"})),...t.flatMap(o=>Object.entries(o.require??{}).map(([a,l])=>({name:a,constraint:l,from:o.name})))].flatMap(({name:o,constraint:a,from:l})=>{const c=Pe(o.toLowerCase())?en(o,a,r):void 0;return c?[`${l} requires ${o} ${a}: ${c}`]:[]})}async function ci(e,t){const{files:n,projectDir:r}=t,s=C(r,"composer.json"),i=C(r,"composer.lock"),o=C(r,"vendor/composer/installed.json"),a=n.read(s),l=n.read(i),c=!e.noDev;try{if(a===void 0&&e.command!=="require")throw new X(`Composer could not find a composer.json file in ${r}`);const u=ge(a??"{}",s),d=ri(u);if(d)throw new X(d);for(const v of["require","require-dev","replace","provide","conflict"])for(const R of Object.keys(u[v]??{}))se(R,`composer.json ${v}`);const h=(()=>{const v=n.read(o);if(v===void 0)return{packages:[],devNames:[]};const R=ge(v,o);for(const q of R.packages??[])Ze(q.name,o);return{packages:R.packages??[],devNames:R["dev-package-names"]??[]}})();if(e.command==="dump-autoload"){const{packages:v,devNames:R}=h,q=new Set(R);return It(n,r,u,c?v:v.filter(x=>!q.has(x.name)),{dev:c,devPackages:c?q:new Set}),t.out(`Generating autoload files
Generated autoload files
`),0}const f={minimumStability:ir(u["minimum-stability"]),preferStable:!!u["prefer-stable"]};if(e.command==="require"){const v=e.dev?"require-dev":"require";for(const{name:R,constraint:q}of Dt(e.packages)){let x=q;if(!x){const g=await t.source.versions(R),k=g?.filter(G=>e.ignorePlatformReqs||!Fe({},[G],!1,t.platform).length),S=k&&Mt(k,[],f),D=!S&&g&&Mt(g,[],f);if(D)throw new K(`${D.name} ${D.version} is declined: ${Fe({},[D],!1,t.platform).join("; ")}`);const O=S&&lt(S.version_normalized??S.version);if(!O||O.branch)throw new K(`Could not find a stable version of package ${R}.`);x=`^${O.parts[0]}.${O.parts[1]}`}u[v]={...u[v],[R]:x},t.err(`./composer.json has been updated (${R}: ${x})
`)}}const p=`${JSON.stringify(u,null,4)}
`;let _=e.command==="install"&&l!==void 0?ge(l,i):void 0,b=!1;if(_){t.err("Installing dependencies from lock file"+(c?" (including require-dev)":"")+`
`);for(const v of[..._.packages??[],..._["packages-dev"]??[]])Ze(v.name,i);_["content-hash"]&&_["content-hash"]!==await t.contentHash(a??p)&&t.err("Warning: The lock file is not up to date with the latest changes in composer.json. Run `composer update`.\n")}else{t.err(e.command==="install"?`No composer.lock file present. Updating dependencies to latest instead of installing from lock file.
`:`Updating dependencies
`);const v=e.command==="require"?Dt(e.packages).map(S=>S.name):e.packages.map(S=>se(S,"composer update")),R=v.length&&l!==void 0?ge(l,i):void 0,q=new Map([...R?.packages??[],...R?.["packages-dev"]??[]].filter(S=>!v.includes(S.name)).map(S=>[S.name,S.version])),x=await oi(ai(u,!1),t.source,{...f,preferred:q,platform:e.ignorePlatformReqs?void 0:t.platform},u);for(const S of x.packages.values())t.err(`  - Locking ${S.name} (${S.version})
`);const g=si(u,x.packages),k=[...x.packages.values()].sort((S,D)=>S.name.localeCompare(D.name));_={"content-hash":await t.contentHash(p),packages:k.filter(S=>g.has(S.name)),"packages-dev":k.filter(S=>!g.has(S.name))},b=!0}const m=[..._.packages??[],...c?_["packages-dev"]??[]:[]],y=new Set(c?(_["packages-dev"]??[]).map(v=>v.name):[]),E=e.ignorePlatformReqs?[]:Fe(u,m,c,t.platform);if(E.length)throw new X(`Your requirements could not be resolved to an installable set of packages.
${E.map(v=>`  - Declined: ${v}`).join(`
`)}`);e.command==="require"&&n.write(s,p),b&&(n.write(i,ii(_,f)),t.err(`Writing lock file
`));const N=new Map(h.packages.map(v=>[v.name,v])),P=(v,R)=>!!v&&v.version===R.version&&(v.dist?.reference??null)===(R.dist?.reference??null)&&n.isDir(je(r,R.name)),L=m.filter(v=>!P(N.get(v.name),v)),I=[...N.keys()].filter(v=>!m.some(R=>R.name===v));t.err(`Package operations: ${L.length} install${L.length===1?"":"s"}, 0 updates, ${I.length} removal${I.length===1?"":"s"}
`);const M=[];for(const v of L){t.err(`  - Downloading ${v.name} (${v.version})
`);const R=await t.source.files(v);for(const q of R.keys())if(q.split("/").some(x=>x===".."||x==="."||x===""))throw new X(`${v.name} ${v.version} holds a file outside its directory ("${q}").`);M.push([v,R])}for(const v of I)n.remove(je(r,v)),t.err(`  - Removing ${v}
`);for(const[v,R]of M){const q=je(r,v.name);t.err(`  - Installing ${v.name} (${v.version})
`),n.remove(q);for(const[x,g]of R)n.write(C(q,x),g);v.type==="composer-plugin"&&t.err(`    ${v.name} is a Composer plugin; plugins do not run in the PHP runtime.
`)}!L.length&&!I.length&&t.err(`Nothing to install, update or remove
`),t.err(`Generating autoload files
`),It(n,r,u,m,{dev:c,devPackages:y});const j=li.filter(v=>u.scripts?.[v]!==void 0);return j.length&&t.err(`Composer scripts do not run in the PHP runtime (${j.join(", ")}); run their commands yourself if needed.
`),0}catch(u){(e.command==="require"||e.command==="update")&&(a===void 0?n.remove(s):n.read(s)!==a&&n.write(s,a),l===void 0?n.remove(i):n.read(i)!==l&&n.write(i,l));const d=u instanceof K||u instanceof X||u instanceof gt,$=u instanceof K?`Your requirements could not be resolved to an installable set of packages.
  `:"";return t.err(`${$}${u instanceof Error?u.message:String(u)}
`),d?2:1}}const ui="https://packagist.org/packages/{name}.json",di="https://cdn.jsdelivr.net/gh/",fi="https://data.jsdelivr.com/v1/packages/gh/";function pi(e){const t=[];let n={};for(const r of e){const s={...n};for(const[i,o]of Object.entries(r))o==="__unset"?delete s[i]:s[i]=o;t.push(s),n=s}return t}function $i(e,t){const n=t;if(n.package?.versions)return Object.values(n.package.versions).map(s=>({...s,name:e}));const r=n.packages?.[e];if(Array.isArray(r))return(n.minified?pi(r):r).map(s=>({...s,name:e}));if(r)return Object.values(r).map(s=>({...s,name:e}))}function jt(e){const t=e&&/^https:\/\/(?:api\.)?github\.com\/(?:repos\/)?([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/.exec(e);return t?{owner:t[1],repo:t[2]}:void 0}const Z={maxEntries:5e4,maxTotalBytes:256*1024*1024,maxEntryBytes:64*1024*1024},tt=128*1024*1024;class B extends Error{}function hi(e){const t=new rn;try{Er(t,e,"/",Z)}catch(o){throw o instanceof Sr?new B(o.message):o}const n=t.list(),r=new Set(n.map(o=>o.split("/")[1])),s=r.size===1&&n.every(o=>o.split("/").length>2)?`/${[...r][0]}/`:"/",i=new Map;for(const o of n){const a=t.readFile(o);i.set(o.slice(s.length),typeof a=="string"?new TextEncoder().encode(a):a??new Uint8Array)}return i}async function nt(e,t){const n=await e(t);if(!n.ok)throw new Error(`GET ${t}: ${n.status} ${n.statusText}`);return n}async function Oe(e,t,n){const r=Number(e.headers.get("content-length"));if(r>t)throw new B(`${n} is ${r} bytes, over the ${t}-byte limit.`);if(!e.body)return new Uint8Array(await e.arrayBuffer());const s=e.body.getReader(),i=[];let o=0;for(;;){const{value:c,done:u}=await s.read();if(u)break;if(o+=c.byteLength,o>t)throw await s.cancel(),new B(`${n} exceeds the ${t}-byte limit.`);i.push(c)}const a=new Uint8Array(o);let l=0;for(const c of i)a.set(c,l),l+=c.byteLength;return a}async function mi(e,t,n){if(!t)return;const s=[...new Uint8Array(await crypto.subtle.digest("SHA-1",e))].map(i=>i.toString(16).padStart(2,"0")).join("");if(s!==t.toLowerCase())throw new B(`${n}: checksum mismatch (sha1 ${s}, metadata says ${t}).`)}function gi(e,t){let n;try{n=new URL(e)}catch{throw new B(`${t}: dist URL "${e}" is not an absolute URL.`)}const r=n.hostname==="localhost"||n.hostname==="[::1]"||/^127\./.test(n.hostname);if(n.protocol!=="https:"&&!(n.protocol==="http:"&&r))throw new B(`${t}: dist URL "${e}" is not https.`)}const _i=/^[A-Za-z0-9._-]+$/;async function yi(e,t,n,r){if(![t,n,r].every(l=>_i.test(l)))throw new B(`Refusing GitHub source ${t}/${n}@${r}: not a plain repository and commit.`);const i=(JSON.parse(new TextDecoder().decode(await Oe(await nt(e,`${fi}${t}/${n}@${r}?structure=flat`),tt,"The jsDelivr listing"))).files??[]).map(l=>l.name);if(i.length>Z.maxEntries)throw new B(`${t}/${n} has ${i.length} files, over the ${Z.maxEntries}-entry limit.`);for(const l of i)if(!l.startsWith("/")||l.split("/").some(c=>c===".."||c==="."))throw new B(`Refusing file "${l}" in ${t}/${n}.`);const o=new Map;let a=0;for(let l=0;l<i.length;l+=8)await Promise.all(i.slice(l,l+8).map(async c=>{const u=await Oe(await nt(e,`${di}${t}/${n}@${r}${c.split("/").map(encodeURIComponent).join("/")}`),Z.maxEntryBytes,c);if(a+=u.byteLength,a>Z.maxTotalBytes)throw new B(`${t}/${n} exceeds the ${Z.maxTotalBytes}-byte limit.`);o.set(c.slice(1),u)}));return o}function wi(e={}){const t=e.fetch??((s,i)=>fetch(s,i)),n=e.repositoryUrl??ui,r=new Map;return{versions(s){let i;try{i=se(s,"a package request")}catch(a){return Promise.reject(a)}let o=r.get(i);return o||(o=(async()=>{const a=await t(n.replace("{name}",ni(i)));if(a.status!==404){if(!a.ok)throw new Error(`Package metadata for ${i}: ${a.status} ${a.statusText}`);return $i(i,JSON.parse(new TextDecoder().decode(await Oe(a,tt,`Package metadata for ${i}`))))}})(),r.set(i,o)),o},async files(s){const i=s.dist,o=jt(i?.url)??jt(s.source?.url??void 0),a=i?.reference??s.source?.reference,l=`${s.name} ${s.version}`;if(i?.url&&(i.type??"zip")==="zip"){gi(i.url,l);const c=e.distProxy?`${e.distProxy}${encodeURIComponent(i.url)}`:i.url;let u;try{u=await nt(t,c)}catch(d){if(!o||!a||e.distProxy)throw d}if(u){const d=await Oe(u,tt,l);return await mi(d,i.shasum,l),hi(d)}}if(o&&a)return yi(t,o.owner,o.repo,a);throw new Error(`${l} has no zip dist or GitHub source the PHP runtime can fetch.`)}}}const _n=e=>e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength);function bi(e){const t=e.getReader();return new ReadableStream({async pull(n){const{value:r,done:s}=await t.read();if(s)return n.close();const i=_n(r);i.byteLength&&n.enqueue(i.slice())},cancel:n=>t.cancel(n)})}async function yn(e,t){const n=e.getReader();for(;;){const{value:r,done:s}=await n.read();if(s)return;const i=_n(r);i.byteLength&&t(i.slice())}}async function wn(e,t){const n=new TextDecoder;await yn(e,s=>{const i=n.decode(s,{stream:!0});i&&t(i)});const r=n.decode();r&&t(r)}const _e="/bfwc/php-server-front.php",bn="x-bfwc-router-declined";function vi(e){return["<?php",...Object.entries(e).map(([n,r])=>`ini_set(${Xe(n)}, ${Xe(r)});`),"if (($_SERVER['HTTPS'] ?? '') === 'off') unset($_SERVER['HTTPS']);","if ((require $_SERVER['SCRIPT_FILENAME']) === false && !headers_sent()) header('X-Bfwc-Router-Declined: 1');",""].join(`
`)}const Ei=e=>/\.[^/]+$/.test(e);function Si(e,t,n){const r=at(e),s=l=>l==="/"?t:C(t,l),i=(l,c,u)=>l.endsWith(".php")?{kind:"script",file:l,scriptName:c,pathInfo:u}:{kind:"file",file:l},o=l=>["index.php","index.html"].map(c=>({url:C(l,c),file:C(s(l),c)})).find(({file:c})=>n.isFile(c));if(n.isFile(s(r)))return i(s(r),r);if(n.isDir(s(r))){const l=o(r);if(l)return i(l.file,l.url)}const a=r.split("/").filter(Boolean);for(let l=a.length-1;l>0;l--){const c=`/${a.slice(0,l).join("/")}`;if(c.endsWith(".php")&&n.isFile(s(c)))return i(s(c),c,`/${a.slice(l).join("/")}`)}if(Ei(r))return{kind:"missing"};for(let l=a.length;l>=0;l--){const c=`/${a.slice(0,l).join("/")}`;if(!n.isDir(s(c)))continue;const u=o(c);if(u)return i(u.file,u.url,r===c?void 0:r.slice(c==="/"?0:c.length)||void 0)}return{kind:"missing"}}const Ft=e=>({status:404,headers:{"content-type":"text/html; charset=UTF-8"},body:nn(new TextEncoder().encode(`<!doctype html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested resource <code>${e.replace(/[<>&"]/g,"")}</code> was not found on this server.</p></body></html>`))});function ki(e){const t={};for(const[n,r]of Object.entries(e)){const s=n.toLowerCase();s===bn||!r.length||(t[s]=r.length===1?r[0]:[...r])}return t}async function Pi(e,t){const{php:n,files:r,docroot:s,router:i}=t;r.mkdirTree(_e.slice(0,_e.lastIndexOf("/"))),r.write(_e,vi(e.ini)),n.chdir(s);const o=e.host.replace(/^\[|\]$/g,""),a=`${o.includes(":")?`[${o}]`:o}:${e.port}`,l=async(d,$)=>{const h=d.url.includes("?")?d.url.slice(d.url.indexOf("?")+1):"",f={DOCUMENT_ROOT:s,SCRIPT_FILENAME:$.file,SCRIPT_NAME:$.scriptName,PHP_SELF:$.scriptName+($.pathInfo??""),SERVER_NAME:o,SERVER_PORT:String(e.port),SERVER_PROTOCOL:"HTTP/1.1",SERVER_SOFTWARE:`PHP ${t.phpVersion} Development Server (php-wasm, BuilderForce WebContainers)`,REMOTE_ADDR:"127.0.0.1",QUERY_STRING:h};return $.pathInfo&&(f.PATH_INFO=$.pathInfo),n.runStream({scriptPath:_e,relativeUri:d.url,method:d.method.toUpperCase(),headers:{host:a,...d.headers},protocol:"http",body:d.body??void 0,env:t.env,$_SERVER:f})},c=async(d,$,h)=>{if(h.kind==="missing")return Ft($);if(h.kind==="file")return{status:200,headers:{"content-type":kr(or(h.file))},body:nn(r.read(h.file))};const f=await l(d,h);wn(f.stderr,t.log).catch(()=>{});const[p,_]=await Promise.all([f.httpStatusCode,f.headers]);return _[bn]?.length?(f.stdout.cancel(),"declined"):{status:p,headers:ki(_),body:bi(f.stdout)}};return{spec:e,handle:async d=>{const $=d.url.split("?")[0].split("#")[0];let h;try{h=decodeURIComponent($)||"/"}catch{return Rt(400,"Bad Request")}try{let f=i?await c(d,h,{kind:"script",file:i,scriptName:i.startsWith(`${s}/`)?i.slice(s.length):`/${i.split("/").pop()}`}):"declined";return f==="declined"&&(f=await c(d,h,Si(h,s,r)),f==="declined"&&(f=Ft(h))),t.log(`[${f.status}]: ${d.method.toUpperCase()} ${d.url}
`),f}catch(f){const p=f instanceof Error?f.message:String(f);return t.log(`[500]: ${d.method.toUpperCase()} ${d.url} - ${p}
`),Rt(500,`PHP failed to handle the request: ${p}`)}}}}const ue=Ce;function Ti(e){const t=r=>ft(e,r).flatMap(s=>ue(e,C(r,s))?t(C(r,s)):[C(r,s)]);return{read:r=>Ee(e,r)?new TextDecoder().decode(e.readFile(r)):void 0,write(r,s){e.mkdirTree(Ae(r)),e.writeFile(r,s)},isDir:r=>ue(e,r),list:r=>ue(e,r)?t(r):[],remove:r=>Re(e,r)}}async function vn(e,t){const n=await e.php.run({code:t});if(n.exitCode!==0)throw new Error(`PHP failed: ${n.errors||n.text}`);return n.text}const Ri=e=>`<?php
$c = json_decode(base64_decode('${Pr(new TextEncoder().encode(e))}'), true) ?: [];
$keys = ['name', 'version', 'require', 'require-dev', 'conflict', 'replace', 'provide', 'minimum-stability', 'prefer-stable', 'repositories', 'extra'];
$r = array_intersect_key($c, array_flip($keys));
if (isset($c['config']['platform'])) { $r['config']['platform'] = $c['config']['platform']; }
ksort($r);
echo md5(json_encode($r));`;async function En(e,t){const[n,r]=JSON.parse(await vn(e,'<?php echo json_encode([PHP_VERSION, array_map("strtolower", get_loaded_extensions())]);')),s={phpVersion:n,extensions:new Set(r)};return t.platformKnown?.(s),s}async function Oi(e,t,n){const r=await En(e,n),s=t.workingDir?H(n.cwd,t.workingDir):n.cwd;return ci(t,{files:Ti(e.module.FS),source:wi({...n.composer,fetch:n.fetch}),platform:r,projectDir:s,contentHash:i=>vn(e,Ri(i)),out:i=>n.io.stdout(i),err:i=>n.io.stderr(i)})}async function Ni(e,t,n){const{php:r,module:s}=e;if(t.kind==="composer")return{kind:"exited",code:await Oi(e,t,n)};if(t.kind==="serve"){await r.setSapiName("cli-server");const o=(await En(e,n)).phpVersion,a=t.server.docroot?H(n.cwd,t.server.docroot):n.cwd;if(!ue(s.FS,a))return n.io.stderr(`Directory ${t.server.docroot} does not exist.
`),{kind:"exited",code:1};const l=t.server.routerIfPresent?H(n.cwd,t.server.routerIfPresent):void 0,c=t.server.router?H(n.cwd,t.server.router):l&&Ee(s.FS,l)?l:void 0;if(c&&!Ee(s.FS,c))return n.io.stderr(`Could not open input file: ${t.server.router}
`),{kind:"exited",code:1};const u=await Pi(t.server,{php:r,files:{isFile:d=>Ee(s.FS,d),isDir:d=>ue(s.FS,d),read:d=>s.FS.readFile(d),write:(d,$)=>s.FS.writeFile(d,$),mkdirTree:d=>s.FS.mkdirTree(d)},docroot:a,router:c,env:{...n.env},log:d=>n.io.stderr(d),phpVersion:o});return{kind:"serving",server:{port:u.spec.port,handle:u.handle,close:async()=>{}},banner:`[${new Date().toUTCString()}] PHP ${o} Development Server (http://${t.server.host}:${t.server.port}) started (request-driven)
`}}const i=await r.cli(["php",...t.argv],{env:{...n.env}});return await Promise.all([yn(i.stdout,o=>n.io.stdout(o)),wn(i.stderr,o=>n.io.stderr(o))]),{kind:"exited",code:await i.exitCode}}const Ai=String.raw`<?php
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
`,Ci=String.raw`<?php
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
`,xi=String.raw`<?php
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
`,Ii=String.raw`<?php
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
`,Di=String.raw`<?php
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
`,qi=String.raw`<?php
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
`,Li=String.raw`<?php
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
`,Mi=String.raw`<?php
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
`,de="/bfwc",Ge="/internal/shared/auto_prepend_file.php",Ui=`<?php
spl_autoload_register(static function (string $class): void {
    // Class names are case-insensitive: keys are lower-case, and so is the lookup (PDOPgsql finds pdopgsql).
    static $files = ['bfwc\\pgsql\\wire' => 'wire.php', 'bfwc\\pgsql\\exception' => 'wire.php', 'bfwc\\pgsql\\pdo' => 'pdo.php', 'bfwc\\pgsql\\statement' => 'statement.php', 'bfwc\\pgsql\\rewriter' => 'rewriter.php', 'pdo\\pgsql' => 'pdo-pgsql.php', 'bfwc\\pgsql\\pg' => 'pg.php', 'pgsql\\connection' => 'pg.php', 'pgsql\\result' => 'pg.php'];
    $file = $files[strtolower($class)] ?? null;
    if ($file !== null) {
        require_once '${de}/pgsql/' . $file;
    }
});
require_once '${de}/pgsql/includes.php';
if (!function_exists('pg_connect')) {
    require_once '${de}/pgsql/functions.php';
}
\\Bfwc\\Pgsql\\Includes::register();
if (\\Bfwc\\Pgsql\\Includes::rewritesPrimary()) {
    require \\Bfwc\\Pgsql\\Includes::$primary;
    exit;
}
`,ji={"prepend.php":Ui,"pgsql/wire.php":Mi,"pgsql/pdo.php":xi,"pgsql/statement.php":Li,"pgsql/includes.php":Ai,"pgsql/rewriter.php":qi,"pgsql/functions.php":Ii,"pgsql/pg.php":Di,"pgsql/pdo-pgsql.php":Ci};function Fi(e){for(const[r,s]of Object.entries(ji)){const i=`${de}/${r}`;e.mkdirTree(i.slice(0,i.lastIndexOf("/"))),e.writeFile(i,s)}const t=`
require_once '${de}/prepend.php';
`,n=$e(e,Ge)?new TextDecoder().decode(e.readFile(Ge)):`<?php
`;n.includes(t)||e.writeFile(Ge,`${n.replace(/\?>\s*$/,"")}${t}`)}const Gi=e=>/^127\./.test(e)||e==="0.0.0.0"||e==="::1"||e==="localhost",Bi=/^bfwc-tcp:\/\/\[?([^\]]*)\]?:(\d+)$/,Be=0,We=1,Gt=2,oe=3;function Wi(e){return class{url;CONNECTING=Be;OPEN=We;CLOSING=Gt;CLOSED=oe;readyState=Be;binaryType="arraybuffer";onopen=null;onmessage=null;onclose=null;onerror=null;listeners=new Map;channel;constructor(n){this.url=n;const r=Bi.exec(n),s=r?.[1]??"",i=Number(r?.[2]);if(!r||!Gi(s)){queueMicrotask(()=>this.fail());return}e(i).then(o=>{if(!o)return this.fail();if(this.readyState!==Be)return o.close();this.channel=o,this.readyState=We,o.onData(a=>this.emit("message",a)),o.onClose(()=>this.ended()),this.emit("open")},()=>this.fail())}send(n){if(this.readyState!==We||!this.channel)return;const r=n instanceof ArrayBuffer?new Uint8Array(n):new Uint8Array(n.buffer,n.byteOffset,n.byteLength);this.channel.send(r.slice())}setSocketOpt(){}close(){this.readyState===Gt||this.readyState===oe||(this.channel?.close(),this.ended())}on(n,r){return this.add(n,r,!1,!1)}once(n,r){return this.add(n,r,!0,!1)}addEventListener(n,r){this.add(n,r,!1,!0)}removeListener(n,r){return this.listeners.set(n,(this.listeners.get(n)??[]).filter(s=>s.listener!==r)),this}off(n,r){return this.removeListener(n,r)}removeEventListener(n,r){this.removeListener(n,r)}add(n,r,s,i){return this.listeners.set(n,[...this.listeners.get(n)??[],{listener:r,once:s,dom:i}]),this}emit(n,r){const s=this.listeners.get(n)??[];this.listeners.set(n,s.filter(l=>!l.once));const i=r?r.slice().buffer:void 0,o={type:n,target:this,data:i};for(const{listener:l,dom:c}of s)c?l(o):r?l(r,!0):l();const a={open:this.onopen,message:this.onmessage,close:this.onclose,error:this.onerror}[n];a?.(o)}ended(){this.readyState!==oe&&(this.readyState=oe,this.channel=void 0,queueMicrotask(()=>this.emit("close")))}fail(){this.readyState!==oe&&(this.emit("error"),this.ended())}}}function Hi(e,t){const n=e.websocket??={};n.url=(s,i,o)=>`bfwc-tcp://${i.includes(":")?`[${i}]`:i}:${o}`,n.subprotocol="binary";const r=Wi(t);n.decorator=()=>r}const Vi=(e,t)=>`[${new Date().toUTCString()}] Failed to listen on ${e}:${t} (reason: Address already in use)
`;function da(e){const t=e.dial?void 0:dt(e.post),n=e.dial??(s=>t.dial(s));let r="localhost";return ht(e.post,s=>{async function i(a,l){const c=await e.loadPhp({baseUrl:a.php?.baseUrl,phpVersion:St(a.php?.phpVersion)});Hi(c.module,n),Fi(c.module.FS),pt(l,c.module.FS);const u=$n(c.module.FS,d=>{s.exited||e.post({type:"fs",ops:d})});return s.mounted({apply:d=>u.quietly(()=>$t(c.module.FS,d)),flush:()=>u.flush()}),c.php.chdir(U(a.cwd)),c}async function o(a,l,c,u){const d=await i(a,c);return u.exited?{kind:"exited",code:0}:Ni(d,l,{cwd:U(a.cwd),env:a.env,io:u.io,composer:a.php?.composer,fetch:e.fetch,platformKnown:$=>e.post({type:"php-platform",phpVersion:$.phpVersion,extensions:[...$.extensions]})})}return{addressInUse:a=>Vi(r,a),plan(a,l){const c=ar(a.command,a.args,lr(a.env,a.cwd,l));if(!c.ok)return{ok:!1,message:`${a.command}: ${c.reason}
`,code:1};try{St(a.php?.phpVersion)}catch(d){return{ok:!1,message:`${d.message}
`,code:1}}const u=cr(c.invocation,U);return u.kind==="serve"&&(r=u.server.host),{ok:!0,port:u.kind==="serve"?u.server.port:void 0,run:d=>o(a,u,d,s)}},receive:a=>!!t?.receive(a)}})}function zi(e){return[...e.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(t=>t[1]??t[2]??t[3])}function Qi(e,t,n,r){if(n===null)return{ok:!0};const s=C(t,"Properties","launchSettings.json"),i=e(s);if(i===void 0)return n?{ok:!1,reason:`The launch profile "${n}" could not be applied: ${s} does not exist.`}:{ok:!0};let o;try{o=JSON.parse(i).profiles??{}}catch(d){return{ok:!1,reason:`A JSON parsing exception occurred in ${s}: ${d.message}`}}const a=n?Object.entries(o).find(([d])=>d===n):Object.entries(o).find(([,d])=>d.commandName==="Project");if(!a)return n?{ok:!1,reason:`The launch profile "${n}" could not be applied: it is not in ${s}.`}:{ok:!0};const[l,c]=a,u={};for(const[d,$]of Object.entries(c.environmentVariables??{}))u[d]=String($);return c.applicationUrl&&r.ASPNETCORE_URLS===void 0&&u.ASPNETCORE_URLS===void 0&&(u.ASPNETCORE_URLS=c.applicationUrl),{ok:!0,profile:{name:l,env:u,args:c.commandLineArgs?zi(c.commandLineArgs):[]}}}class F extends Error{name="DotnetBundleError"}const Ki="/dotnet/refs",Bt="bfwc-dotnet-",Sn=e=>e.endsWith("/")?e:`${e}/`,Yi=e=>e instanceof Error?e.message:String(e);async function yt(e){const t=new Uint8Array(await crypto.subtle.digest("SHA-256",e));return Array.from(t,n=>n.toString(16).padStart(2,"0")).join("")}function Ji(e){const t=e.Bfwc?.Host?.Exports;if(!t)throw new F("The .NET runtime bundle has no Bfwc.Host.Exports: it was not built from dotnet-host/.");return t}async function rt(e,t,n){try{return await e(t,n)}catch(r){throw new F(`The .NET runtime bundle could not be reached (${t}: ${Yi(r)}).`)}}async function kn(e,t){const n=`${Sn(e)}manifest.json`,r=await rt(t,n);if(!r.ok)throw new F(`The .NET runtime bundle's manifest could not be loaded (${n}: HTTP ${r.status}).`);const s=await r.text();let i;try{i=JSON.parse(s)}catch{throw new F(`The .NET runtime bundle's manifest (${n}) is not JSON.`)}if(i?.format!==kt.format)throw new F(`The .NET runtime bundle at ${e} is format ${String(i?.format)}; this runtime reads format ${kt.format}. To get one this runtime reads, ${ct}.`);return{manifest:i,text:s}}async function Xi(e,t=fetch){return(await kn(e,t)).manifest}async function Zi(e,t){const n=globalThis.caches;if(!n)return(i,o)=>rt(t,i,o);const r=`${Bt}${(await yt(new TextEncoder().encode(e))).slice(0,32)}`;let s;try{s=await n.open(r);for(const i of await n.keys())i.startsWith(Bt)&&i!==r&&n.delete(i)}catch{s=void 0}return async(i,o)=>{const a=await s?.match(i).catch(()=>{});if(a)return a;const l=await rt(t,i,o);return l.ok&&s&&await s.put(i,l.clone()).catch(()=>{}),l}}async function Wt(e,t,n,r){const s=n.files?.[r];if(!s)throw new F(`The .NET runtime bundle's manifest has no hash for ${r}: to get a complete one, ${ct}.`);const i=await e(new URL(r,t).href);if(!i.ok)throw new F(`${r} of the .NET runtime bundle could not be loaded (HTTP ${i.status}).`);const o=new Uint8Array(await i.arrayBuffer());if(await yt(o)!==s)throw new F(`${r} of the .NET runtime bundle does not match its manifest's hash: refusing it.`);return o}async function eo(e,t,n){const r=[];for(const s of n){const{offset:i,length:o}=s;if(!(Number.isSafeInteger(i)&&Number.isSafeInteger(o)&&i>=0&&o>=0&&i+o<=t.byteLength)||!/^[\w.-]+\.dll$/i.test(s.name))throw new F(`The "${e}" reference pack's entry ${JSON.stringify(s.name)} is out of bounds or misnamed: refusing it.`);const l=t.subarray(i,i+o);if(await yt(l)!==s.sha256)throw new F(`${e}/${s.name} does not match its manifest's hash: refusing it.`);r.push({name:s.name,bytes:l})}return r}async function fa(e){const t=e.fetch??((f,p)=>fetch(f,p)),n=Sn(e.bundleUrl),{manifest:r,text:s}=await kn(n,t),i=await Zi(s,t);await Wt(i,n,r,r.entry);const o=e.importModule??(f=>import(f)),{dotnet:a}=await o(new URL(r.entry,n).href);let l=a.withEnvironmentVariables(e.env).withModuleConfig({onExit:f=>e.onExit?.(f)});globalThis.caches&&(l=l.withResourceLoader((f,p,_,b)=>f==="dotnetjs"?void 0:i(_,b?{integrity:b}:void 0)));const c=await l.create();c.setModuleImports("bfwc",e.imports);const u=Ji(await c.getAssemblyExports(r.assembly)),d=c.Module.FS,$=new Map;async function h(f){const p=$.get(f);if(p)return p;const _=r.references[f];if(!_)throw new F(`The .NET runtime bundle has no "${f}" reference assemblies.`);const b=await eo(f,await Wt(i,n,r,_.pack),_.files),m=`${Ki}/${f}`;d.mkdirTree(m);const y=new Map;for(const E of b){const N=`${m}/${E.name}`;d.writeFile(N,E.bytes),y.set(`${f}/${E.name}`,N)}return $.set(f,y),y}return{exports:u,FS:d,manifest:r,async mountReferences(f){const p=new Map;for(const _ of new Set(f))for(const[b,m]of await h(_))p.set(b,m);return p}}}function to(e){const t={};for(const[n,r]of Object.entries(JSON.parse(e)))t[n.toLowerCase()]=r.length===1?r[0]:r;return t}function no(e){let t;const n=new Set,r=new Map,s=new Map;let i=1,o=1;const a=c=>u=>new Promise((d,$)=>{if(!t)return $(new Error("The .NET runtime is not running."));const h=i++;r.set(h,{resolve:d,reject:$}),t.Request(h,c,u.method,u.url,JSON.stringify(u.headers),u.body??new Uint8Array(0))});return{imports:{stdout:c=>e.stdout(c),stderr:c=>e.stderr(c),listen(c){return e.taken.has(c)&&!n.has(c)?!1:(e.taken.add(c),n.add(c),e.post({type:"listen",port:c}),!0)},unlisten(c){n.delete(c)&&(e.taken.delete(c),e.post({type:"unlisten",port:c}))},respondHead(c,u,d){const $=r.get(c);if(!$)return;const h=new ReadableStream({start:f=>{$.body=f},cancel:()=>{r.delete(c),t?.CancelRequest(c)}});$.resolve({status:u,headers:to(d),body:h})},respondChunk(c,u){r.get(c)?.body?.enqueue(u.slice())},respondEnd(c,u){const d=r.get(c);if(r.delete(c),!!d){if(!d.body)return d.reject(new Error(u??"The response ended before its head."));u?d.body.error(new Error(u)):d.body.close()}},async dial(c){const u=await e.dial(c);if(!u)return-1;const d=o++;return s.set(d,u),u.onData($=>s.has(d)&&t?.TcpData(d,$)),u.onClose(()=>{s.delete(d)&&t?.TcpClosed(d)}),d},send(c,u){s.get(c)?.send(u.slice())},hangUp(c){const u=s.get(c);s.delete(c),u?.close()}},listening:n,handlerFor:c=>n.has(c)?a(c):void 0,attach(c){t=c},stop(){t?.Stop()},closeAll(){for(const c of r.values())c.body?c.body.error(new Error("The process exited.")):c.reject(new Error("The process exited."));r.clear();for(const c of s.values())c.close();s.clear()}}}const ro={DOTNET_CLI_TELEMETRY_OPTOUT:"1",DOTNET_NOLOGO:"1",DOTNET_SKIP_FIRST_TIME_EXPERIENCE:"1"},Pn=e=>e.outputInProject?U(e.outputPath):e.outputPath;function so(e,t){const n=`Microsoft.AspNetCore.App ${t.runtimeVersion} [browser]
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
`}}function He(e,t){const n="configuration"in t?t.configuration:"Debug";if(t.kind==="run"&&t.file)return Pt(e.files,H(e.cwd,t.file),n);const r=dr(e.files,e.cwd,t.project,t.kind==="run"?"run":"build");return r.ok?Pt(e.files,r.path,n,t.kind==="build"?t.output:void 0):r}async function io(e,t){const{io:n}=t,r=i=>(n.stderr(`${i}
`),{kind:"done",code:1}),s={...ro,...t.env};switch(e.kind){case"info":return n.stdout(so(e.what,await t.manifest())),{kind:"done",code:0};case"exec":return{kind:"runtime",work:{env:s,run:{assembly:U(H(t.cwd,e.assembly)),args:e.appArgs,cwd:U(t.cwd)}}};case"restore":case"clean":{const i=He(t,e);if(!i.ok)return r(i.reason);if(e.kind==="clean"){const o=ur(i.plan);if(!o.ok)return r(o.reason);const a=o.paths.filter(l=>t.files.isFile(l));a.length&&t.sendOps(a.map(l=>({op:"remove",path:l}))),n.stdout(a.length?a.map(l=>`  Deleting file "${l}".
`).join(""):`  Nothing to clean in ${Ae(i.plan.outputPath)}.
`)}else{for(const o of i.plan.notes)n.stdout(`  ${o}
`);n.stdout(`  Restore complete: ${i.plan.projectFile} uses ${i.plan.packages.length?"bundled packages only":"no NuGet packages"}.
`)}return{kind:"done",code:0}}case"build":{const i=He(t,e);return i.ok?{kind:"runtime",work:{env:s,build:i.plan}}:r(i.reason)}case"run":{const i=He(t,e);if(!i.ok)return r(i.reason);const o=i.plan;if(o.outputKind!=="exe")return r(`Unable to run your project.
Ensure you have a runnable project type and ensure '${o.projectFile}' supports running: its OutputType is Library.`);const a=o.fileBased?{ok:!0}:Qi(c=>t.files.readText(c),o.projectDir,e.launchProfile,s);if(!a.ok)return r(a.reason);const l=o.web?o.projectDir:t.cwd;return{kind:"runtime",work:{env:{...s,...a.profile?.env},build:e.noBuild?void 0:o,run:{assembly:Pn(o),args:[...a.profile?.args??[],...e.appArgs],cwd:U(l)}}}}}}function oo(e,t,n,r=!1){const s=new Set;for(const i of e.referenceGroups)for(const o of n.references[i]?.files??[])s.add(t.get(`${i}/${o.name}`));for(const i of e.packages)for(const o of n.packages[i]?.references??[])t.has(o)&&s.add(t.get(o));return JSON.stringify({projectFile:U(e.projectFile),projectDir:U(e.projectDir),assemblyName:e.assemblyName,outputKind:e.outputKind,outputPath:Pn(e),sources:e.sources.map(U),globalUsings:e.globalUsings,references:[...s].filter(Boolean),nullable:e.nullable,allowUnsafe:e.allowUnsafe,langVersion:e.langVersion,fileBased:e.fileBased,defines:e.defines,optimize:e.optimize,warningsAsErrors:e.warningsAsErrors,noWarn:e.noWarn,quiet:r})}async function ao(e,t,n){if(e.build){const r=e.build;for(const a of r.notes)n.stdout(`  ${a}
`);const s=[...r.referenceGroups,...r.packages.flatMap(a=>(t.manifest.packages[a]?.references??[]).map(l=>l.split("/")[0]))],i=await t.mountReferences(s),o=await t.exports.Build(oo(r,i,t.manifest,!!e.run));if(o!==0)return e.run&&n.stderr(`
The build failed. Fix the build errors and run again.
`),o}return e.run?t.exports.Run(e.run.assembly,e.run.args,e.run.cwd):0}const Ht=`The .NET runtime bundle is not configured: the host must pass \`dotnet.bundleUrl\` (to get the bundle, ${ct}).`,lo=e=>`Unhandled exception. System.IO.IOException: Failed to bind to address http://localhost:${e}: address already in use.
`;function pa(e){const t=e.dial?void 0:dt(e.post),n=e.dial??(r=>t.dial(r));return ht(e.post,r=>{const s={stdout:l=>r.io.stdout(l),stderr:l=>r.io.stderr(l)},i=no({post:e.post,dial:n,taken:r.takenPorts,...s});async function o(l,c,u,d){const $=await e.loadDotnet({bundleUrl:l,env:c,imports:i.imports,onExit:f=>r.exit(f),fetch:e.fetch});pt(d,$.FS);const h=$n($.FS,f=>{r.exited||e.post({type:"fs",ops:f})});return r.mounted({apply:f=>h.quietly(()=>$t($.FS,f)),flush(){try{$.exports.Flush()}catch{}h.flush()}}),$.exports.Init(),i.attach($.exports),$.FS.mkdirTree(U(u)),$}const a=l=>{if(!(l instanceof F))throw l;return s.stderr(`${l.message}
`),1};return{addressInUse:lo,receive:l=>!!t?.receive(l),plan(l){const c=fr(l.command,l.args);if(!c.ok)return{ok:!1,message:`${c.reason}
`,code:1};const u=l.dotnet?.bundleUrl;return{ok:!0,async run(d){try{const $=await io(c.invocation,{files:d,cwd:l.cwd,env:l.env,io:s,sendOps:f=>e.post({type:"fs",ops:f}),manifest:()=>u?Xi(u,e.fetch):Promise.reject(new F(Ht))});if($.kind==="done")return{kind:"exited",code:$.code};if(!u)throw new F(Ht);const h=await o(u,$.work.env,l.cwd,d);return r.exited?{kind:"exited",code:1}:{kind:"running",ports:i,done:ao($.work,h,s).catch(a)}}catch($){return{kind:"exited",code:a($)}}}}}}})}const co="https://builderforce.ai/schema/app.v1.json",Tn=["browser","cloudflare","aws","azure","gcp"],Rn=["production","non-production"],On=["GET","POST","PUT","PATCH","DELETE"],uo={local:{target:"browser",tier:"non-production"}};function w(e,t,n={}){return{code:e,path:t,severity:"error",...n}}function Vt(e){return e.some(t=>t.severity==="error")}function zt(e){const t=new Set;return e.filter(n=>{const r=`${n.code}\0${n.path}\0${n.value??""}`;return t.has(r)?!1:(t.add(r),!0)})}function $a(e){const t=e.path?`"${e.path}"`:"The manifest",n=e.detail?` ${e.detail}`:"";switch(e.code){case"invalid-json":return`builderforce.json is not valid JSON:${n}`;case"not-an-object":return"builderforce.json must hold a JSON object.";case"legacy-format":return'builderforce.json has no "version"; it is read in the legacy format. Add "version": 1 to use the manifest.';case"unsupported-version":return`Manifest version ${e.value??"?"} is not supported; this runtime reads version 1.`;case"invalid-value":return`${t} has an invalid value${e.value!==void 0?` "${e.value}"`:""}.${n}`;case"missing-field":return`${t} is missing "${e.value??"?"}".`;case"invalid-id":return`Id "${e.value??e.path}" must start with a letter and contain only letters, digits, "_" and "-".`;case"duplicate-id":return`Id "${e.value??"?"}" names both a resource and a service.`;case"unknown-resource-type":return`${t} has unknown resource type "${e.value??"?"}".`;case"unknown-resource":return`${t} uses "${e.value??"?"}", which is not a resource of this manifest.`;case"unknown-service":return`${t} names "${e.value??"?"}", which is not a service of this manifest.`;case"invalid-queue-host":return`${t}: a redis queue must name a redis resource in "on"${e.value?`, not "${e.value}"`:""}.`;case"invalid-port":return`${t} has port ${e.value??"?"}; a port is a whole number from 1 to 65535.`;case"duplicate-port":return`Port ${e.value??"?"} is claimed by more than one service.${n}`;case"invalid-readiness":return`${t} must name exactly one readiness check: http, port, query, exitZero or started.${n}`;case"invalid-duration":return`${t} has duration "${e.value??"?"}"; use a whole number with ms, s, m, h or d (e.g. "10m").`;case"invalid-schedule":return`${t} has cron schedule "${e.value??"?"}" that cannot be read.${n}`;case"invalid-timezone":return`${t} has time zone "${e.value??"?"}", which is not an IANA time zone.`;case"invoke-without-port":return`${t} invokes service "${e.value??"?"}", which has no port to call.`;case"unknown-target":return`${t} has unknown target "${e.value??"?"}"; use browser, cloudflare, aws, azure or gcp.`;case"invalid-tier":return`${t} has tier "${e.value??"?"}"; use production or non-production.`;case"debug-in-production":return`${t} is a production environment with debug on; debug is allowed only on non-production.`;case"unknown-environment":return`There is no environment "${e.value??"?"}" in this manifest.`;case"unknown-override-entry":return`${t} overrides "${e.value??"?"}", which the manifest does not declare.`;case"frontend-uses-credentials":return`${t} is a frontend using "${e.value??"?"}"; a frontend's code ships to the browser, so it never receives its credentials.`;case"jobs-not-run":return`${t} will not run on this target.${n}`;case"shell-command-unsupported":return`${t} has command "${e.value??"?"}", which needs a shell (operators, redirects, variable assignments, expansions or globs). Use a single program and its arguments.${n}`;case"shell-command-with-args":return`${t}: command "${e.value??"?"}" needs a shell, so it cannot take "args" as well; put the whole command line in "command".`;case"command-backslash":return`${t} has command "${e.value??"?"}" with a backslash the shell drops (a backslash escapes the next character). Use forward slashes in paths, or quote the word.`;case"spec":return e.spec?pr(e.spec):`The application spec is invalid.${n}`}}const Nn=["services","resources","jobs"];function A(e){return typeof e=="object"&&e!==null&&!Array.isArray(e)}const fo=new Set(["__proto__","constructor","prototype"]);function Ne(e){return!fo.has(e)}function re(e,t){return Ne(t)&&Object.hasOwn(e,t)}function st(e,t){if(!A(e)||!A(t))return t===void 0?e:t;const n={};for(const[r,s]of Object.entries(e))Ne(r)&&(n[r]=s);for(const[r,s]of Object.entries(t))s!==void 0&&Ne(r)&&(n[r]=st(Object.hasOwn(n,r)?n[r]:void 0,s));return n}function An(e){const t=A(e.environments)?e.environments:void 0;return t&&Object.keys(t).length>0?t:{...uo}}function Cn(e,t,n){const r=[],s=n.overrides;if(s===void 0)return r;if(!A(s))return[w("invalid-value",`environments.${t}.overrides`,{detail:"Expected an object."})];for(const i of Nn){const o=s[i];if(o===void 0)continue;const a=`environments.${t}.overrides.${i}`;if(!A(o)){r.push(w("invalid-value",a,{detail:"Expected an object keyed by id."}));continue}const l=e[i];for(const c of Object.keys(o))(!A(l)||!re(l,c))&&r.push(w("unknown-override-entry",a,{value:c}))}return r}function po(e,t){const n=An(e),r=Object.prototype.hasOwnProperty.call(n,t)?n[t]:void 0;if(!A(r))return{manifest:null,environment:null,issues:[w("unknown-environment","environments",{value:t,detail:`Known: ${Object.keys(n).join(", ")}.`})]};const s=Cn(e,t,r),i=A(r.overrides)?r.overrides:{},o={...e};for(const a of Nn){const l=e[a],c=i[a];if(!A(l)||!A(c))continue;const u=st(l,{});for(const[d,$]of Object.entries(c))re(l,d)&&(u[d]=st(l[d],$));o[a]=u}return{manifest:o,environment:{...r,name:t},issues:s}}const ye=e=>({supported:!1,reason:`${e} in the browser arrives in a later release.`}),T=e=>({supported:!0,provider:e}),te=e=>({supported:!1,reason:e}),Qt="Infrastructure modules are applied only by a customer-cloud target (AWS, Azure, GCP).",wt={postgres:{browser:T("pglite"),cloudflare:T("neon"),aws:T("rds"),azure:T("azure-postgres"),gcp:T("cloud-sql")},redis:{browser:ye("Redis"),cloudflare:T("upstash"),aws:T("elasticache"),azure:T("azure-cache"),gcp:T("memorystore")},queue:{browser:ye("A queue"),cloudflare:T("cloudflare-queues"),aws:T("sqs"),azure:T("service-bus"),gcp:T("pubsub")},"object-storage":{browser:ye("Object storage"),cloudflare:T("r2"),aws:T("s3"),azure:T("blob-storage"),gcp:T("gcs")},mail:{browser:ye("The mail catcher"),cloudflare:T("connection"),aws:T("connection"),azure:T("connection"),gcp:T("connection")},graph:{browser:te("A graph database (Neo4j, Memgraph) has no browser stand-in that speaks its protocol."),cloudflare:te("Cloudflare hosts no graph database."),aws:T("connection"),azure:T("connection"),gcp:T("connection")},connection:{browser:T("vault"),cloudflare:T("vault"),aws:T("vault"),azure:T("vault"),gcp:T("vault")},external:{browser:te(Qt),cloudflare:te(Qt),aws:T("opentofu"),azure:T("opentofu"),gcp:T("opentofu")}},xn={browser:{supported:!1,reason:"Scheduled jobs arrive in a later release."},cloudflare:T("cron-triggers"),aws:T("eventbridge"),azure:T("container-apps-jobs"),gcp:T("cloud-scheduler")},ha=Object.keys(wt);function In(e){return typeof e=="string"&&Object.prototype.hasOwnProperty.call(wt,e)}function Dn(e,t){const n=In(e)?wt[e]:void 0;return n?n[t]??te(`"${t}" is not a known target.`):te(`"${e}" is not a known resource type.`)}function ma(e,t){return Dn(e,t).supported}const $o=[{name:"minute",min:0,max:59},{name:"hour",min:0,max:23},{name:"day of month",min:1,max:31},{name:"month",min:1,max:12,names:["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"],nameBase:1},{name:"day of week",min:0,max:7,names:["SUN","MON","TUE","WED","THU","FRI","SAT"],nameBase:0}],ho={"@yearly":"0 0 1 1 *","@annually":"0 0 1 1 *","@monthly":"0 0 1 * *","@weekly":"0 0 * * 0","@daily":"0 0 * * *","@midnight":"0 0 * * *","@hourly":"0 * * * *"},mo=[31,29,31,30,31,30,31,31,30,31,30,31];function Kt(e,t){if(/^\d+$/.test(e))return Number(e);const n=t.names?.indexOf(e.toUpperCase())??-1;return n>=0?n+(t.nameBase??0):void 0}function go(e,t){const n=new Set;for(const r of e.split(",")){const[s,i,o]=r.split("/");if(o!==void 0||!s)return`"${r}" in the ${t.name} field is not a value, range or step.`;let a=1;if(i!==void 0){if(!/^\d+$/.test(i)||Number(i)<1)return`Step "${i}" in the ${t.name} field must be a positive whole number.`;a=Number(i)}let l,c;if(s==="*")l=t.min,c=t.max;else{const[u,d,$]=s.split("-");if($!==void 0||!u)return`"${s}" in the ${t.name} field is not a value or range.`;l=Kt(u,t),c=d!==void 0?Kt(d,t):i!==void 0?t.max:l}if(l===void 0||c===void 0)return`"${s}" in the ${t.name} field is not a value.`;if(l<t.min||c>t.max||l>c)return`"${s}" is outside the ${t.name} field's range ${t.min}-${t.max}.`;for(let u=l;u<=c;u+=a)n.add(u)}return[...n].sort((r,s)=>r-s)}function _o(e){const t=e.trim(),r=(ho[t.toLowerCase()]??t).split(/\s+/).filter(Boolean);if(r.length!==5)return{ok:!1,reason:`A cron schedule has 5 fields (minute hour day-of-month month day-of-week); "${t}" has ${r.length}.`};const s=[];for(let h=0;h<5;h++){const f=go(r[h],$o[h]);if(typeof f=="string")return{ok:!1,reason:f};s.push(f)}const[i,o,a,l,c]=s,u=[...new Set(c.map(h=>h%7))].sort((h,f)=>h-f),d=!r[2].startsWith("*"),$=!r[4].startsWith("*");return d&&!$&&!l.some(h=>a.some(f=>f<=mo[h-1]))?{ok:!1,reason:`"${t}" never fires: no chosen month has the chosen day.`}:{ok:!0,schedule:{source:t,minutes:i,hours:o,daysOfMonth:a,months:l,daysOfWeek:u,dayOfMonthRestricted:d,dayOfWeekRestricted:$}}}const Yt=new Map;function qn(e){let t=Yt.get(e);return t||(t=new Intl.DateTimeFormat("en-US",{timeZone:e,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",second:"numeric"}),Yt.set(e,t)),t}function yo(e){try{return qn(e),!0}catch{return!1}}function it(e,t){if(t==="UTC")return e;const n={};for(const r of qn(t).formatToParts(new Date(e)))r.type!=="literal"&&(n[r.type]=Number(r.value));return Date.UTC(n.year,n.month-1,n.day,n.hour%24,n.minute,n.second)}function wo(e,t){if(t==="UTC")return e;const n=new Set;for(const r of[e-864e5,e,e+864e5]){const s=it(r,t)-r,i=e-s;it(i,t)===e&&n.add(i)}return n.size===0?void 0:Math.min(...n)}const we=6e4,bo=8;function vo(e,t){const n=e.daysOfMonth.includes(t.getUTCDate()),r=e.daysOfWeek.includes(t.getUTCDay());return e.dayOfMonthRestricted&&e.dayOfWeekRestricted?n||r:e.dayOfMonthRestricted?n:e.dayOfWeekRestricted?r:!0}function Eo(e,t){const n=new Date(t),r=n.getUTCFullYear()+bo;for(;n.getUTCFullYear()<=r;){if(!e.months.includes(n.getUTCMonth()+1)){n.setUTCMonth(n.getUTCMonth()+1,1),n.setUTCHours(0,0,0,0);continue}if(!vo(e,n)){n.setUTCDate(n.getUTCDate()+1),n.setUTCHours(0,0,0,0);continue}if(!e.hours.includes(n.getUTCHours())){n.setUTCHours(n.getUTCHours()+1,0,0,0);continue}if(!e.minutes.includes(n.getUTCMinutes())){n.setUTCMinutes(n.getUTCMinutes()+1,0,0);continue}return n.getTime()}}function ga(e,t,n="UTC"){const r=t.getTime();let s=Math.floor(it(r,n)/we)*we+we;for(let i=0;i<1e4;i++){const o=Eo(e,s);if(o===void 0)return;const a=wo(o,n);if(a!==void 0&&a>r)return new Date(a);s=o+we}}const So=/^(\d+)(ms|s|m|h|d)$/,ko={ms:1,s:1e3,m:6e4,h:36e5,d:864e5};function Ln(e){const t=So.exec(e.trim());if(!t)return;const n=Number(t[1])*ko[t[2]];return n>0&&Number.isSafeInteger(n)?n:void 0}const Mn="node",Un="browser",ot=(e,t)=>e===Mn&&t===Un;function jn(e,t,n,r){const s=n===Mn?`the ${r} target has no shell to run it`:`the ${n} runtime has no shell to run it`;return w("shell-command-unsupported",`${e}.command`,{value:t,detail:`Only node services on the ${Un} target run a command through the shell (bfsh); ${s}.`})}function xe(e,t,n,r=ut(t)){if(r.kind==="invalid")return[w("invalid-value",`${e}.command`,{value:t,detail:`The command line cannot be read: ${r.reason}.`})];const s=[];return r.kind==="shell"&&n!==void 0&&n.length>0&&s.push(w("shell-command-with-args",`${e}.args`,{value:t})),r.strayBackslash&&s.push(w("command-backslash",`${e}.command`,{severity:"warning",value:t})),s}function Po(e){return e.code==="command-backslash"}function To(e,t,n,r){const s=t.args??[],i=`services.${e}`,o=ut(t.command);if(r.push(...xe(i,t.command,s,o)),o.kind==="argv"){const[a,...l]=o.argv,c=[...l,...s];return c.length>0?{command:a,args:c}:{command:a}}if(o.kind==="shell"){if(ot(t.runtime,n)&&s.length===0)return{command:"bfsh",args:["-c",o.line]};ot(t.runtime,n)||r.push(jn(i,t.command,t.runtime,n))}return s.length>0?{command:t.command,args:[...s]}:{command:t.command}}function Ro(e,t,n,r){const s=t.run;if(!s||typeof s.command!="string")return[];const i=`jobs.${e}.run`,o=ut(s.command),a=xe(i,s.command,void 0,o),l=n[s.service]?.runtime;return o.kind==="shell"&&l!==void 0&&xn[r].supported&&!ot(l,r)&&a.push(jn(i,s.command,l,r)),a}const Oo=["http","port","query","exitZero","started"],No=["redis","native"],Ao=["neo4j","memgraph","age"],Co=["frontend","backend"],xo=["never","on-failure","always"],Fn=["session","always-on"],Io=["concurrency","cpu","requests"],Do=["allow","forbid","replace"],qo=["skip","run-once"];function pe(e){return typeof e=="string"&&e.trim().length>0}function ke(e,t,n){return e===void 0?{}:A(e)?e:(n.push(w("invalid-value",t,{detail:"Expected an object keyed by id."})),{})}function W(e,t,n,r){e!==void 0&&!(typeof e=="string"&&t.includes(e))&&r.push(w("invalid-value",n,{value:String(e),detail:`Use one of: ${t.join(", ")}.`}))}function J(e,t,n,r){e!==void 0&&typeof e!==t&&r.push(w("invalid-value",n,{value:String(e),detail:`Expected a ${t}.`}))}function fe(e,t,n){return e===void 0?[]:Array.isArray(e)&&e.every(r=>typeof r=="string")?e:(n.push(w("invalid-value",t,{detail:"Expected a list of strings."})),[])}function Y(e,t,n,r){const s=e[t];if(s!=null&&s!=="")return s;r.push(w("missing-field",n,{value:t}))}function Gn(e,t,n){e!==void 0&&(typeof e!="string"||Ln(e)===void 0)&&n.push(w("invalid-duration",t,{value:String(e)}))}function Ve(e,t,n){for(const r of Object.keys(e))(!$r.test(r)||!Ne(r))&&n.push(w("invalid-id",`${t}.${r}`,{value:r}))}function Lo(e,t){for(const[n,r]of Object.entries(e)){const s=`resources.${n}`;if(!A(r)){t.push(w("invalid-value",s,{detail:"Expected a resource object."}));continue}const i=Y(r,"type",s,t);if(i!==void 0){if(!In(i)){t.push(w("unknown-resource-type",`${s}.type`,{value:String(i)}));continue}switch((i==="postgres"||i==="redis")&&J(r.persistent,"boolean",`${s}.persistent`,t),i){case"postgres":fe(r.extensions,`${s}.extensions`,t),J(r.name,"string",`${s}.name`,t);break;case"redis":r.maxMemoryMb!==void 0&&!(typeof r.maxMemoryMb=="number"&&r.maxMemoryMb>0)&&t.push(w("invalid-value",`${s}.maxMemoryMb`,{value:String(r.maxMemoryMb),detail:"Expected a positive number."}));break;case"queue":{const o=Y(r,"engine",s,t);if(W(o,No,`${s}.engine`,t),o==="redis"){const a=typeof r.on=="string"?e[r.on]:void 0;(!A(a)||a.type!=="redis")&&t.push(w("invalid-queue-host",`${s}.on`,{value:r.on===void 0?void 0:String(r.on)}))}break}case"graph":W(Y(r,"engine",s,t),Ao,`${s}.engine`,t);break;case"connection":pe(r.connection)||t.push(w("missing-field",s,{value:"connection"}));break;case"external":pe(r.module)||t.push(w("missing-field",s,{value:"module"})),fe(r.outputs,`${s}.outputs`,t);break}}}}function Mo(e,t,n){if(e===void 0)return;if(!A(e)){n.push(w("invalid-readiness",t));return}const r=Oo.filter(s=>e[s]!==void 0);r.length!==1?n.push(w("invalid-readiness",t,{detail:r.length>1?`It names ${r.join(" and ")}.`:void 0})):(r[0]==="http"?!(typeof e.http=="string"&&e.http.startsWith("/")):e[r[0]]!==!0)&&n.push(w("invalid-readiness",`${t}.${r[0]}`,{detail:r[0]==="http"?'An http check names a path starting with "/".':"Set it to true."})),Gn(e.timeout,`${t}.timeout`,n)}function Uo(e,t,n){const r=new Map;for(const[s,i]of Object.entries(e)){const o=`services.${s}`;if(!A(i)){n.push(w("invalid-value",o,{detail:"Expected a service object."}));continue}if(re(t,s)&&n.push(w("duplicate-id",o,{value:s})),pe(i.runtime)||n.push(w("missing-field",o,{value:"runtime"})),pe(i.command)?n.push(...xe(o,i.command,Array.isArray(i.args)?i.args:void 0)):n.push(w("missing-field",o,{value:"command"})),J(i.root,"string",`${o}.root`,n),fe(i.args,`${o}.args`,n),i.port!==void 0){const a=i.port;typeof a!="number"||!Number.isInteger(a)||a<1||a>65535?n.push(w("invalid-port",`${o}.port`,{value:String(a)})):r.set(a,[...r.get(a)??[],s])}W(i.role,Co,`${o}.role`,n);for(const a of fe(i.uses,`${o}.uses`,n))re(t,a)?i.role==="frontend"&&n.push(w("frontend-uses-credentials",`${o}.uses`,{value:a,severity:"warning"})):n.push(w("unknown-resource",`${o}.uses`,{value:a}));for(const a of fe(i.dependsOn,`${o}.dependsOn`,n))re(e,a)||n.push(w("unknown-service",`${o}.dependsOn`,{value:a}));Mo(i.readiness,`${o}.readiness`,n),W(i.restart,xo,`${o}.restart`,n),i.env!==void 0&&!(A(i.env)&&Object.values(i.env).every(a=>typeof a=="string"))&&n.push(w("invalid-value",`${o}.env`,{detail:"Expected an object of string values."})),W(i.availability,Fn,`${o}.availability`,n),jo(i.scale,`${o}.scale`,n)}for(const[s,i]of r)i.length>1&&n.push(w("duplicate-port","services",{value:String(s),detail:`Claimed by ${i.join(", ")}.`}))}function jo(e,t,n){if(e===void 0)return;if(!A(e)){n.push(w("invalid-value",t,{detail:"Expected an object."}));return}const r=s=>s===void 0||typeof s=="number"&&Number.isInteger(s)&&s>=0;!r(e.min)||!r(e.max)?n.push(w("invalid-value",t,{detail:"min and max are whole numbers of instances."})):typeof e.min=="number"&&typeof e.max=="number"&&e.min>e.max&&n.push(w("invalid-value",t,{detail:"min is above max."})),W(e.metric,Io,`${t}.metric`,n)}function Fo(e,t,n){for(const[r,s]of Object.entries(e)){const i=`jobs.${r}`;if(!A(s)){n.push(w("invalid-value",i,{detail:"Expected a job object."}));continue}const o=Y(s,"schedule",i,n);if(o!==void 0){const c=typeof o=="string"?_o(o):{ok:!1,reason:"Expected a string."};c.ok||n.push(w("invalid-schedule",`${i}.schedule`,{value:String(o),detail:c.reason}))}s.timezone!==void 0&&!(typeof s.timezone=="string"&&yo(s.timezone))&&n.push(w("invalid-timezone",`${i}.timezone`,{value:String(s.timezone)})),s.run!==void 0&&s.invoke!==void 0?n.push(w("invalid-value",i,{detail:"A job either runs a command or invokes an endpoint, not both."})):s.run===void 0&&s.invoke===void 0&&n.push(w("missing-field",i,{value:"run"}));const a=s.run??s.invoke,l=`${i}.${s.run!==void 0?"run":"invoke"}`;if(a!==void 0&&!A(a))n.push(w("invalid-value",l,{detail:"Expected an object."}));else if(A(a)){const c=Y(a,"service",l,n),u=typeof c=="string"?t[c]:void 0;c!==void 0&&u===void 0&&n.push(w("unknown-service",`${l}.service`,{value:String(c)})),s.run!==void 0?pe(a.command)?n.push(...xe(l,a.command,void 0)):n.push(w("missing-field",l,{value:"command"})):(typeof a.path=="string"&&a.path.startsWith("/")||n.push(w("invalid-value",`${l}.path`,{value:a.path===void 0?void 0:String(a.path),detail:'An endpoint path starts with "/".'})),W(a.method,On,`${l}.method`,n),A(u)&&u.port===void 0&&n.push(w("invoke-without-port",l,{value:String(c)})))}W(s.concurrency,Do,`${i}.concurrency`,n),Gn(s.timeout,`${i}.timeout`,n),W(s.missed,qo,`${i}.missed`,n),W(s.availability,Fn,`${i}.availability`,n)}}function Go(e,t,n){if(e===void 0)return;const r=A(e)?e.routes:void 0;if(!Array.isArray(r)){n.push(w("invalid-value","ingress",{detail:'Expected { "routes": [...] }.'}));return}r.forEach((s,i)=>{const o=`ingress.routes.${i}`;!A(s)||!(typeof s.path=="string"&&s.path.startsWith("/"))?n.push(w("invalid-value",o,{detail:'A route has a path starting with "/" and a service.'})):(typeof s.service!="string"||!re(t,s.service))&&n.push(w("unknown-service",`${o}.service`,{value:String(s.service)}))})}function Bo(e,t){ke(e.environments,"environments",t);for(const[n,r]of Object.entries(An(e))){const s=`environments.${n}`;if(!A(r)){t.push(w("invalid-value",s,{detail:"Expected an environment object."}));continue}const i=Y(r,"target",s,t);i!==void 0&&!Tn.includes(i)&&t.push(w("unknown-target",`${s}.target`,{value:String(i)}));const o=Y(r,"tier",s,t);o!==void 0&&!Rn.includes(o)&&t.push(w("invalid-tier",`${s}.tier`,{value:String(o)})),J(r.debug,"boolean",`${s}.debug`,t),J(r.connection,"string",`${s}.connection`,t),o==="production"&&r.debug===!0&&t.push(w("debug-in-production",`${s}.debug`,{value:n})),t.push(...Cn(e,n,r))}}function Bn(e){const t=[],n=e;n.version!==1&&t.push(w("unsupported-version","version",{value:String(n.version)})),J(n.name,"string","name",t),J(n.$schema,"string","$schema",t);const r=ke(n.resources,"resources",t),s=ke(n.services,"services",t),i=ke(n.jobs,"jobs",t);return Ve(r,"resources",t),Ve(s,"services",t),Ve(i,"jobs",t),Lo(r,t),Uo(s,r,t),Fo(i,s,t),Go(n.ingress,s,t),Bo(e,t),t}function _a(e){let t;try{t=JSON.parse(e.replace(/^﻿/,""))}catch(r){return{manifest:null,issues:[w("invalid-json","",{detail:r instanceof Error?r.message:String(r)})]}}if(!A(t))return{manifest:null,issues:[w("not-an-object","")]};if(t.version===void 0)return{manifest:null,legacy:t,issues:[w("legacy-format","version",{severity:"info"})]};if(t.version!==1)return{manifest:null,issues:[w("unsupported-version","version",{value:JSON.stringify(t.version)})]};const n=t;return{manifest:n,issues:Bn(n)}}const Wo={node:[{name:"NODE_ENV",values:{production:"production",development:"development",debug:"development"}}],php:[{name:"APP_ENV",values:{production:"production",development:"local",debug:"local"}},{name:"APP_DEBUG",values:{production:"false",development:"false",debug:"true"}}],dotnet:[{name:"ASPNETCORE_ENVIRONMENT",values:{production:"Production",development:"Development",debug:"Development"}},{name:"DOTNET_ENVIRONMENT",values:{production:"Production",development:"Development",debug:"Development"}}],python:[{name:"FLASK_DEBUG",values:{production:"0",development:"0",debug:"1"}},{name:"DJANGO_DEBUG",values:{production:"False",development:"False",debug:"True"}},{name:"PYTHONDEVMODE",values:{debug:"1"}}],rust:[{name:"RUST_LOG",values:{production:"info",development:"info",debug:"debug"}}]};function bt(e){return e.tier==="non-production"&&e.debug===!0}function Ho(e){return e.tier==="production"?"production":bt(e)?"debug":"development"}function Vo(e,t){const n=Ho(t),r={BUILDERFORCE_ENV:t.name,BUILDERFORCE_TIER:t.tier,BUILDERFORCE_DEBUG:String(bt(t))};for(const s of Wo[e]??[]){const i=s.values[n];i!==void 0&&(r[s.name]=i)}return r}function ya(e){return e.tier!=="non-production"?"off":bt(e)?"verbose":"basic"}const zo={postgres:5432};function Qo(e){const t=e.timeout===void 0?void 0:Ln(e.timeout),n=t===void 0?{}:{timeoutMs:t};if("http"in e)return{kind:"http",path:e.http,...n};if("port"in e)return{kind:"port",...n};if("query"in e)return{kind:"query",...n};if("exitZero"in e)return{kind:"exit-zero",...n};if("started"in e)return{kind:"started",...n}}function Ko(e,t){let n=e;for(;t.has(n);)n++;return t.add(n),n}function Yo(e,t,n,r,s){const i=(t.uses??[]).filter(c=>r.has(c)),o=[...new Set([...t.dependsOn??[],...i])],a=t.readiness?Qo(t.readiness):t.port===void 0&&t.restart==="always"?{kind:"started"}:void 0,l={id:e,type:"application",runtime:t.runtime,env:{...Vo(t.runtime,n),...t.env}};return t.role&&(l.role=t.role),t.root&&(l.root=t.root),t.command?Object.assign(l,To(e,t,n.target,s)):t.args&&(l.args=[...t.args]),t.port!==void 0&&(l.port=t.port),o.length>0&&(l.dependsOn=o),a&&(l.readiness=a),t.restart&&(l.restartPolicy=t.restart),l}function Jo(e,t,n,r){return{id:e,type:"database",runtime:n,port:r,database:{engine:"postgres",provider:n,persistent:t.persistent??!1,...t.name?{name:t.name}:{}}}}function Xo(e){if(e.code.startsWith("ingress-"))return w("spec","ingress",{spec:e});const t="serviceId"in e?e.serviceId:void 0;return w("spec",t?`services.${t}`:"services",{spec:e})}function wa(e,t,n){const r=po(e,t),s=[...Bn(e).filter(m=>!Po(m)),...r.issues],i=r.manifest,o=r.environment;if(!i||!o||Vt(s))return{spec:null,environment:o,declined:[],issues:zt(s)};const a=i.resources??{},l=i.services??{},c=[],u=[],d=new Set,$=new Set(Object.values(l).flatMap(m=>m.port===void 0?[]:[m.port]));for(const[m,y]of Object.entries(a)){const E=Dn(y.type,o.target);if(!E.supported){c.push({id:m,reason:E.reason??`The ${o.target} target does not host "${y.type}" resources.`});continue}const N=zo[y.type];y.type==="postgres"&&N!==void 0&&E.provider?(u.push(Jo(m,y,E.provider,Ko(N,$))),d.add(m)):y.type!=="connection"&&c.push({id:m,reason:`"${y.type}" resources on ${o.target} are provisioned by its deployment, not run by the application runtime.`})}for(const[m,y]of Object.entries(l))u.push(Yo(m,y,o,d,s));const h=A(i.jobs)?Object.keys(i.jobs):[];for(const[m,y]of Object.entries(i.jobs??{}))s.push(...Ro(m,y,l,o.target));const f=xn[o.target];if(!f.supported)for(const m of h)s.push(w("jobs-not-run",`jobs.${m}`,{severity:"warning",detail:f.reason}));const p={projectId:n.projectId,services:u},_=i.ingress?.routes??[];_.length>0&&(p.ingress={routes:_.map(m=>({path:m.path,serviceId:m.service}))}),s.push(...hr(p).map(Xo));const b=zt(s);return{spec:Vt(b)?null:p,environment:o,declined:c,issues:b}}const Zo="^[A-Za-z][A-Za-z0-9_-]*$",ea="^\\d+(ms|s|m|h|d)$",Q=e=>({$ref:`#/$defs/${e}`}),ze=e=>({type:"object",propertyNames:{pattern:Zo},additionalProperties:Q(e)}),ae={type:"array",items:{type:"string"}},Jt={enum:["session","always-on"]},z=(e,t={},n=[])=>({type:"object",properties:{type:{const:e},...t},required:["type",...n],additionalProperties:!1}),le=(e,t)=>({type:"object",properties:{[e]:t,timeout:Q("duration")},required:[e],additionalProperties:!1}),ba={$schema:"https://json-schema.org/draft/2020-12/schema",$id:co,title:"Builderforce app manifest v1 (builderforce.json)",type:"object",properties:{$schema:{type:"string"},version:{const:1},name:{type:"string"},resources:ze("resource"),services:ze("service"),jobs:ze("job"),ingress:Q("ingress"),environments:{type:"object",additionalProperties:Q("environment")}},required:["version"],additionalProperties:!1,$defs:{duration:{type:"string",pattern:ea},resource:{oneOf:[z("postgres",{persistent:{type:"boolean"},extensions:ae,name:{type:"string"}}),z("redis",{persistent:{type:"boolean"},maxMemoryMb:{type:"number",exclusiveMinimum:0}}),z("queue",{engine:{enum:["redis","native"]},on:{type:"string"}},["engine"]),z("object-storage"),z("mail"),z("graph",{engine:{enum:["neo4j","memgraph","age"]}},["engine"]),z("connection",{connection:{type:"string",minLength:1}},["connection"]),z("external",{module:{type:"string",minLength:1},outputs:ae},["module"])]},readiness:{oneOf:[le("http",{type:"string",pattern:"^/"}),le("port",{const:!0}),le("query",{const:!0}),le("exitZero",{const:!0}),le("started",{const:!0})]},service:{type:"object",properties:{runtime:{type:"string",minLength:1},root:{type:"string"},command:{type:"string",minLength:1},args:ae,port:{type:"integer",minimum:1,maximum:65535},role:{enum:["frontend","backend"]},uses:ae,dependsOn:ae,readiness:Q("readiness"),restart:{enum:["never","on-failure","always"]},env:{type:"object",additionalProperties:{type:"string"}},availability:Jt,scale:{type:"object",properties:{min:{type:"integer",minimum:0},max:{type:"integer",minimum:0},metric:{enum:["concurrency","cpu","requests"]}},additionalProperties:!1}},required:["runtime","command"],additionalProperties:!1},job:{type:"object",properties:{schedule:{type:"string",minLength:1},timezone:{type:"string"},run:{type:"object",properties:{service:{type:"string"},command:{type:"string",minLength:1}},required:["service","command"],additionalProperties:!1},invoke:{type:"object",properties:{service:{type:"string"},method:{enum:[...On]},path:{type:"string",pattern:"^/"}},required:["service","path"],additionalProperties:!1},concurrency:{enum:["allow","forbid","replace"]},timeout:Q("duration"),missed:{enum:["skip","run-once"]},availability:Jt},required:["schedule"],oneOf:[{required:["run"]},{required:["invoke"]}],additionalProperties:!1},ingress:{type:"object",properties:{routes:{type:"array",items:{type:"object",properties:{path:{type:"string",pattern:"^/"},service:{type:"string"}},required:["path","service"],additionalProperties:!1}}},required:["routes"],additionalProperties:!1},overrides:{type:"object",properties:{services:{type:"object",additionalProperties:{type:"object"}},resources:{type:"object",additionalProperties:{type:"object"}},jobs:{type:"object",additionalProperties:{type:"object"}}},additionalProperties:!1},environment:{type:"object",properties:{target:{enum:[...Tn]},connection:{type:"string"},tier:{enum:[...Rn]},debug:{type:"boolean"},overrides:Q("overrides")},required:["target","tier"],if:{properties:{tier:{const:"production"}}},then:{properties:{debug:{const:!1}}},additionalProperties:!1}}};export{De as ACTIVE_STATES,co as APP_MANIFEST_SCHEMA_URL,ba as APP_MANIFEST_SCHEMA_V1,Sa as ApplicationSpecError,sn as ApplicationStartError,Bt as BUNDLE_CACHE_PREFIX,ka as CREDENTIAL_POLICY,Pa as DATABASE_PROVIDER_DEFAULTS,Ta as DATABASE_URL_SCHEMES,uo as DEFAULT_ENVIRONMENTS,oa as DEFAULT_PGLITE_URL,Ra as DEFAULT_PHP_VERSION,Oa as DEFAULT_PHP_WASM_BASE_URL,Vr as DEFAULT_PYODIDE_INDEX_URL,ui as DEFAULT_REPOSITORY_URL,Ar as DEFAULT_RESTART_LIMITS,Z as DIST_LIMITS,kt as DOTNET_BUNDLE,Na as DOTNET_COMMAND_PATTERN,ro as DOTNET_ENV,jl as DOTNET_KIND,Aa as DatabaseCoordinationError,B as DistRefused,F as DotnetBundleError,Rn as ENVIRONMENT_TIERS,_e as FRONT_SCRIPT,On as HTTP_METHODS,Rr as IllegalTransitionError,gt as InvalidPackageName,xn as JOB_CAPABILITIES,Tn as MANIFEST_TARGETS,tt as MAX_RESPONSE_BYTES,Ca as NATIVE_ONLY_PACKAGES,xa as NODE_DECLINED_COMMANDS,Ia as NODE_READINESS,Zr as OPEN_FILE_SYNC_MS,Wr as PGLITE_VERSION,Da as PGSQL_REASON,qa as PHP_COMMAND_PATTERN,Fl as PHP_KIND,La as PHP_WASM_EXTENSIONS,Ma as PHP_WASM_RELEASES,Ua as PHP_WASM_VERSION,Gl as PIP_RECORD_LIMITS,V as PROJECT_MOUNT,Hr as PYODIDE_VERSION,ja as PYTHON_COMMAND_PATTERN,Ki as REFERENCE_ROOT,wt as RESOURCE_CAPABILITIES,ha as RESOURCE_TYPES,de as RUNTIME_LIBRARY_ROOT,Fa as RUNTIME_PROVIDED_PACKAGES,Ga as RUST_COMPILE_GATE,Bl as RUST_KIND,Ba as RUST_PROFILE,K as ResolveError,fn as SEND_HIGH_WATER_MARK,Wa as SERVER_COMMANDS,Tr as SERVICE_TRANSITIONS,Ha as SUPPORTED_PHP_VERSIONS,ce as ServiceFailure,Wl as ServiceGraphPolicy,Wo as TIER_ENV_CONVENTIONS,Ke as TRAINING_ARTIFACT_DIR,Hl as TRAINING_SINK_DEFAULTS,Cs as VIRTUAL_TCP_MODULE,Ir as acceptApplication,Va as acceptsDotnetService,za as acceptsNodeService,Qa as acceptsPgliteService,Ka as acceptsPhpService,Ya as acceptsPythonService,Ja as acceptsRustService,Vl as artifactKeyId,Xa as assertValidSpec,Or as canTransition,gi as checkDistUrl,se as checkPackageName,St as checkPhpVersion,Za as claimDatabase,sr as compareVersions,oo as compilePlan,Ns as createChannelTransport,As as createDialTransport,no as createDotnetBridge,zl as createDotnetProcessKind,el as createDotnetProvider,pa as createDotnetWorkerProcess,Nr as createLifecycle,tl as createNodeProvider,wi as createPackageSource,nl as createPgliteProvider,Ql as createPhpProcessKind,rl as createPhpProvider,da as createPhpWorkerProcess,Kl as createPipRecord,xr as createProviderRegistry,Yl as createPythonProcessKind,sl as createPythonProvider,ca as createPythonWorkerProcess,Jl as createRustProcessKind,il as createRustProvider,ra as createTrainingArtifactStore,Xl as createTrainingChannel,Zl as createTrainingSink,ol as databaseName,al as databaseUrl,Xs as declaredClasses,ei as dependencyOrder,Jr as describeInstall,pr as describeIssue,$a as describeManifestIssue,ya as diagnosticsLevel,Wi as dialSocketClass,ni as encodePackageName,ll as envName,An as environmentsOf,cl as evaluateCondition,pi as expandMinified,ul as expandProperties,dl as expectedPlatform,dr as findProject,fl as frameworkDefines,ve as fromPhpPath,la as fromPyodidePath,vi as frontScript,jt as githubRepository,pl as globMatcher,us as headersOf,$l as ingressPathKey,hl as ingressTable,Hi as installPhpSockets,cs as installPythonExtensions,Ye as installRequirements,Fi as installRuntimeLibrary,Is as installVirtualSockets,ml as isDotnetCommand,Gi as isLocalAddress,gl as isPhpCommand,Pe as isPlatformPackage,_l as isPythonCommand,In as isResourceType,yl as isRustCommand,yo as isValidTimeZone,fa as loadDotnetRuntime,wl as loadPhpRuntime,aa as loadPyodideRuntime,ii as lockText,Vt as manifestHasErrors,rr as mapInvocationPaths,cr as mapPhpInvocationPaths,bl as mayConnectToDatabase,st as mergeOverrides,vl as nativeOnlyReason,ga as nextFire,Xn as noWheelReason,Xt as normalizeName,Kr as packagesWithoutWheels,tn as parseConstraint,_o as parseCron,fr as parseDotnetCommand,Ln as parseDuration,El as parseFileBasedProgram,_a as parseManifest,ar as parsePhpCommand,Sl as parseProjectFile,kl as parsePyproject,nr as parsePythonCommand,tr as parseRequirement,Pl as parseRequirementsTxt,Tl as parseRustCommand,Rl as parseServerCommand,lt as parseVersion,Ol as pgliteDataDir,ne as phpLiteral,Xe as phpString,lr as phpSurroundings,Nl as phpWasmModuleUrls,Mt as pickVersion,Pt as planBuild,Jn as planRequirements,en as platformShortfall,io as prepareInvocation,xs as pythonTcpModule,gn as rankVersions,Oe as readCapped,Qi as readLaunchProfile,Xi as readManifest,Zt as readProjectRequirements,er as readRequirementFile,Wn as readinessOf,Al as receivesDatabaseCredentials,Dt as requireArguments,po as resolveEnvironment,H as resolveFrom,oi as resolvePackages,Dn as resourceCapability,Cr as restartDecision,Hn as restartPolicyOf,Vn as roleOf,ai as rootRequirements,Si as routeRequest,ci as runComposer,ao as runWithRuntime,si as runtimePackages,Cl as satisfies,Kn as serviceEnv,gr as serviceGraph,xl as serviceMap,yt as sha256Hex,Il as shellCommandWords,zi as splitArgs,ut as splitCommandLine,ia as startApplicationRuntime,Dl as startDatabaseHost,Pi as startPhpWebServer,fs as startPythonAppServer,ps as startRequestedAppServer,ma as targetSupports,Vo as tierEnv,Ho as tierMode,wa as toApplicationSpec,U as toPhpPath,me as toPyodidePath,Qo as toReadinessSpec,ql as tomlStringArray,Ll as tomlTable,$n as trackPhpWrites,$n as trackWrappedFsWrites,hi as unpackDist,ri as unsupportedRepositories,ec as validArtifactPath,hn as validPackageName,tc as validPipInstall,Bn as validateManifest,hr as validateSpec,$i as versionsOf,Ml as withoutDatabaseCredentials,It as writeAutoloader};
