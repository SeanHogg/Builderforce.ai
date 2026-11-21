import{lI as Be,lJ as oe,lK as Dn,lL as qn,lM as Ln,lN as Mn,lO as mt,lP as Un,lQ as jn,lR as Fn,_ as Gn,lS as Bn,lT as Wn,lU as Vt,z as rt,B as A,C as Re,lV as Hn,gT as B,lW as zt,lX as Vn,lY as zn,lZ as Qn,l_ as Kn,l$ as Ee,m0 as gt,m1 as Yn,m2 as st,m3 as Qt,m4 as Kt,m5 as Jn,gU as Xn,m6 as Zn,m7 as _t,m8 as er,m9 as yt,ma as tr,mb as wt,mc as nr,md as rr,me as sr,mf as ir,mg as or}from"./index.js";import{mh as ca,mi as ua,mj as da,mk as fa,ml as pa,mm as $a,h0 as ha,mn as ma,mo as ga,mp as _a,mq as ya,mr as wa,g_ as ba,ms as va,mt as Ea,mu as Sa,gV as ka,mv as Pa,mw as Ta,mx as Ra,my as Oa,mz as Na,mA as Aa,mB as Ca,mC as xa,mD as Ia,mE as Da,mF as qa,gL as La,mG as Ma,mH as Ua,mI as ja,mJ as Fa,mK as Ga,mL as Ba,mM as Wa,mN as Ha,mO as Va,mP as za,mQ as Qa,mR as Ka,mS as Ya,mT as Ja,mU as Xa,mV as Za,mW as el,g$ as tl,gZ as nl,gX as rl,h1 as sl,mX as il,mY as ol,mZ as al,m_ as ll,m$ as cl,n0 as ul,n1 as dl,n2 as fl,n3 as pl,n4 as $l,n5 as hl,n6 as ml,n7 as gl,n8 as _l,n9 as yl,na as wl,nb as bl,nc as vl}from"./index.js";import{r as ar,s as lr,h as cr,p as ur,m as bt,c as dr,a as fr,b as it,i as pr,d as $r,Z as hr,t as vt,e as Yt,f as mr,g as gr,j as Go}from"./chunk-rustProcessKind.js";import{D as Sl,P as kl,k as Pl,R as Tl,S as Rl,T as Ol,l as Nl,n as Al,o as Cl,q as xl,u as Il,v as Dl,w as ql,x as Ll,y as Ml,z as Ul}from"./chunk-rustProcessKind.js";import{V as Jt}from"./chunk-vfs.js";const _r={discovered:["preparing","failed"],preparing:["starting","stopping","failed"],starting:["ready","stopping","failed"],ready:["running","stopping","failed"],running:["stopping","stopped","failed"],stopping:["stopped","failed"],stopped:["preparing"],failed:["preparing","stopped"]},Ne=new Set(["preparing","starting","ready","running"]);class yr extends Error{serviceId;from;to;constructor(t,n,r){super(`Service "${t}" cannot go from "${n}" to "${r}".`),this.serviceId=t,this.from=n,this.to=r,this.name="IllegalTransitionError"}}function wr(e,t){return _r[e].includes(t)}function br(e,t){let n="discovered";return{serviceId:e,get state(){return n},transition(r){if(!wr(n,r))throw new yr(e,n,r);const s={serviceId:e,from:n,to:r};return n=r,t?.(s),s}}}const vr={maxRestarts:5,backoffMs:250,maxBackoffMs:5e3};function Er(e,t,n,r,s={}){const{maxRestarts:i,backoffMs:o,maxBackoffMs:a}={...vr,...s};return t==="exit-zero"&&n===0?{restart:!1,reason:"completed"}:e==="always"||e==="on-failure"&&n!==0?r>=i?{restart:!1,reason:"limit"}:{restart:!0,delayMs:Math.min(a,o*2**r)}:{restart:!1,reason:"policy"}}function Sr(e){const t=new Map(e.map(n=>[n.id,n]));return{providers:[...t.values()],resolve(n){const r=t.get(n.runtime);if(!r){const i=[...t.keys()].join(", ")||"none";return{ok:!1,reason:`No runtime provider for "${n.runtime}" (available: ${i}).`}}const s=r.accepts(n);return s.ok?{ok:!0,provider:r}:{ok:!1,reason:s.reason}}}}function kr(e,t){const n=[];for(const r of e){const s=t.resolve(r);s.ok||n.push({serviceId:r.id,reason:s.reason})}return n.length===0?{ok:!0}:{ok:!1,declined:n}}class ae extends Error{error;constructor(t){super(t.message),this.error=t,this.name="ServiceFailure"}}function Ae(e,t={}){const n=[],r=new Promise((s,i)=>{const o=()=>{let a=!1;for(const l of e){const c=l.readiness();if(c==="down")return i(new ae(l.failure()));c==="pending"&&(a=!0)}a||s()};for(const a of e)n.push(a.onChange(o));o()});return Be(r,{signal:t.signal,ms:t.timeoutMs}).finally(()=>n.forEach(s=>s()))}function We(){const e=new Set;return{on(t){return e.add(t),()=>e.delete(t)},emit(t){for(const n of[...e])try{n(t)}catch(r){queueMicrotask(()=>{throw r})}}}}function Pr(e={}){const t=ar(Math.max(1,e.history??5e3)),n=Math.max(1,e.readerBuffer??1e3),r=new Set;let s=!1;const i=(l,c)=>{if((l.controller.desiredSize??0)<=1){l.dropped+=1;return}l.dropped>0&&(l.controller.enqueue({serviceId:c.serviceId,source:"runtime",text:`${l.dropped} log lines dropped (reader fell behind).`,at:c.at}),l.dropped=0),l.controller.enqueue(c)},o=l=>{t.push(l);for(const c of r)c.wanted(l)&&i(c,l)},a=(l,c,u)=>o({serviceId:l,source:c,text:u,at:Date.now()});return{pipe(l,c){(async()=>{const u=c.getReader();let d="";try{for(;;){const{value:h,done:$}=await u.read();if($)break;const f=(d+h).split(/\r?\n/);d=f.pop()??"";for(const p of f)a(l,"output",p)}}catch(h){a(l,"runtime",`Output stopped: ${oe(h)}`)}finally{d&&a(l,"output",d),u.releaseLock()}})()},note:(l,c)=>a(l,"runtime",c),stream(l){let c;return new ReadableStream({start(u){c={wanted:d=>l===void 0||d.serviceId===l,controller:u,dropped:0};for(const d of t)c.wanted(d)&&u.enqueue(d);s?u.close():r.add(c)},cancel(){c&&r.delete(c)}},new CountQueuingStrategy({highWaterMark:n}))},close(){s=!0;for(const l of r)l.controller.close();r.clear()}}}function Tr(){let e;return{get pending(){return e!==void 0},schedule(t,n){clearTimeout(e),e=setTimeout(()=>{e=void 0,n()},t)},cancel(){clearTimeout(e),e=void 0}}}function Rr(e){const{spec:t,logs:n}=e,r=Dn(t),s=qn(t),i=r.timeoutMs??e.readinessTimeoutMs,o=We(),a=br(t.id,g=>{e.onStateChange(g),o.emit()}),l=Tr(),c=(g,S,T=!1,R)=>({serviceId:t.id,phase:g,message:S,exitCode:R,willRestart:T});let u,d=!1,h=!1,$=0,f=0,p,_,v,m,w=c("stopped","Not started.");function E(){const g={controller:new AbortController};u=g,d=!1,N(g)}async function N(g){a.transition("preparing");try{await Ae(e.dependencies(),{signal:g.controller.signal,timeoutMs:e.dependencyTimeoutMs})}catch(R){const L=R instanceof ae?`Dependency "${R.error.serviceId}" is not available: ${R.error.message}`:`Dependencies not ready: ${oe(R)}`;return I(g,{phase:"dependency",message:L})}if(u!==g)return;const S=e.registry.resolve(t);if(!S.ok)return I(g,{phase:"declined",message:S.reason});if(_&&await Be(_,{ms:e.stopTimeoutMs,onTimeout:()=>{},signal:g.controller.signal,onAbort:()=>{}}),u!==g)return;a.transition("starting");let T;try{g.handlePromise=Promise.resolve(S.provider.start(t,{env:e.env,signal:g.controller.signal,security:e.security,projectId:e.projectId})),T=await g.handlePromise}catch(R){return I(g,{phase:"start",message:oe(R)})}if(g.handle=T,u!==g){g.abandoned?_=Un(T):T.output.cancel().catch(()=>{});return}n.pipe(t.id,T.output),_=T.wait(),T.wait().then(R=>D(g,R));try{await Be(T.ready(),{ms:i,onTimeout:()=>{throw new Error(`Not ready after ${i}ms (${r.kind} readiness).`)},signal:g.controller.signal})}catch(R){if(u!==g)return;const L=g.exitCode??await jn(T,0);return u!==g?void 0:r.kind==="exit-zero"&&L===0?(g.completed=!0,k(g)):I(g,{phase:L===void 0?"readiness":"exit",message:oe(R),exitCode:L})}u===g&&k(g)}function k(g){g.readyAt=Date.now(),m=void 0,a.transition("ready"),d=!0,a.transition("running"),g.completed&&x(g)}function D(g,S){if(g.exitCode=S,v=S,u===g){if(r.kind==="exit-zero"&&S===0){g.completed=!0,a.state==="running"?x(g):a.state==="starting"&&k(g);return}I(g,{phase:"exit",message:`Exited with code ${S}.`,exitCode:S,clean:a.state==="running"&&S===0})}}function x(g){u=void 0,g.controller.abort(),n.note(t.id,"Completed."),a.transition("stopped")}function I(g,S){if(u!==g)return;u=void 0,g.controller.abort(),g.handle&&g.exitCode===void 0&&g.handle.kill("SIGKILL"),mt(e.processes,e.security),g.readyAt!==void 0&&Date.now()-g.readyAt>=e.stableAfterMs&&($=0);const R=S.phase==="declined"||S.phase==="dependency"?{restart:!1}:Er(s,r.kind,S.exitCode??1,$,e.restart),L=c(S.phase,S.message,R.restart,S.exitCode);d=!1,w=L,R.restart&&l.schedule(R.delayMs,E),a.transition(S.clean?"stopped":"failed"),S.clean?n.note(t.id,"Exited with code 0."):(m=L,n.note(t.id,`Failed (${S.phase}): ${S.message}`),e.onError(L)),R.restart&&($+=1,n.note(t.id,`Restarting in ${R.delayMs}ms (${s}, attempt ${$}).`))}async function M(){l.cancel();const g=u;if(u=void 0,d=!1,w=c("stopped","Stopped."),Ne.has(a.state)){a.transition("stopping");const S=g?await Mn(g,e.stopTimeoutMs):void 0;S&&(_=S.wait()),mt(e.processes,e.security),a.transition("stopped")}else a.state==="failed"?a.transition("stopped"):o.emit()}const y={id:t.id,async start(){const g=f;if(p&&await p,g!==f)throw new ae(c("stopped","Stopped before it started."));return!d&&!Ne.has(a.state)&&!l.pending&&($=0,E()),Ae([y])},stop(){return f+=1,p??=M().finally(()=>p=void 0),p},async restart(){h=!0;try{const g=y.stop(),S=f;if(await g,S!==f)throw new ae(c("stopped","Stopped while restarting."));$=0,E()}finally{h=!1,o.emit()}return Ae([y])},readiness:()=>d?"ready":Ne.has(a.state)||l.pending||h?"pending":"down",failure:()=>w,onChange:g=>o.on(g),url:()=>u?.handle?.url(),database:()=>u?.handle?.database,snapshot:()=>({id:t.id,type:t.type,runtime:t.runtime,role:Ln(t),state:a.state,port:t.port,url:u?.handle?.url(),restarts:$,exitCode:v,error:m})};return y}class Xt extends Error{failures;constructor(t){super(`Services failed to start: ${t.map(n=>`${n.serviceId} (${n.message})`).join("; ")}`),this.failures=t,this.name="ApplicationStartError"}}const $e={readinessTimeoutMs:12e4,dependencyTimeoutMs:6e5,stopTimeoutMs:5e3,stableAfterMs:1e4},Or=e=>"resolve"in e;async function Et(e){const n=(await Promise.allSettled(e.map(([,r])=>r))).flatMap((r,s)=>{if(r.status==="fulfilled")return[];const i=r.reason instanceof ae?r.reason.error:{serviceId:e[s][0],phase:"start",message:oe(r.reason),willRestart:!1};return i.phase==="stopped"?[]:[i]});if(n.length>0)throw new Xt(n)}function Nr(e){const t=e.services.map(r=>`${r.id}\0${r.root??"/"}`).sort().join(""),n=cr("sha256").digest(new TextEncoder().encode(t));return`app:${e.projectId}:${Array.from(n.subarray(0,8),r=>r.toString(16).padStart(2,"0")).join("")}`}function Wo(e,t){const n=lr(e),r=Or(t.providers)?t.providers:Sr(t.providers),s=Pr({history:t.logHistory,readerBuffer:t.logReaderBuffer}),i=We(),o=We(),a=new Map;let l=!1;const c=Nr(e),u=(m,w)=>{const E=r.resolve(m);return E.ok?E.provider.databaseCredentials?.(m,w):void 0},d=t.processes??t.runtime,h=t.portPolicy??t.runtime.portPolicy;for(const m of n.startOrder){const w=n.dependenciesOf(m).map(E=>a.get(E));a.set(m,Rr({spec:e.services.find(E=>E.id===m),env:Fn(e,m,{databaseCredentials:u}),registry:r,logs:s,onStateChange:E=>i.emit(E),onError:E=>o.emit(E),dependencies:()=>w,readinessTimeoutMs:t.readinessTimeoutMs??$e.readinessTimeoutMs,dependencyTimeoutMs:t.dependencyTimeoutMs??$e.dependencyTimeoutMs,stopTimeoutMs:t.stopTimeoutMs??$e.stopTimeoutMs,restart:t.restart??{},stableAfterMs:t.stableAfterMs??$e.stableAfterMs,security:Object.freeze({applicationId:c,serviceId:m}),projectId:e.projectId,processes:d}))}const $=m=>{const w=a.get(m);if(!w)throw new Error(`No service "${m}" in this application.`);return w},f=()=>{if(l)throw new Error("This application runtime was disposed.")};let p,_;const v=async()=>{_?.(),_=void 0;for(const m of n.stopOrder)await $(m).stop();d.killApplication(c),p?.(),p=void 0};return{projectId:e.projectId,applicationId:c,async start(){f();const m=kr(e.services,r);if(!m.ok){const w=m.declined.map(({serviceId:E,reason:N})=>({serviceId:E,phase:"declined",message:N,willRestart:!1}));throw w.forEach(E=>o.emit(E)),new Xt(w)}p??=h.register(c,e),e.ingress?.routes.length&&(_??=t.runtime.registerIngress?.(c,e)),await Et(n.startOrder.map(w=>[w,$(w).start()]))},stop:v,async restart(m){f();const w=$(m);await Et([[m,w.restart()]])},async dispose(){l||(l=!0,await v(),t.runtime.forgetApplication?.(c),s.close())},getService:m=>a.get(m)?.snapshot(),listServices:()=>n.startOrder.map(m=>$(m).snapshot()),getUrl:m=>a.get(m)?.url(),logs:m=>s.stream(m),onStateChange:m=>i.on(m),onError:m=>o.on(m),database(m){const w=$(m);if(e.services.find(N=>N.id===m)?.type!=="database")throw new Error(`Service "${m}" is not a database.`);const E=async()=>w.database()??Promise.reject(new Error(`Database "${m}" is not running.`));return{export:async()=>(await E()).export(),import:async N=>(await E()).import(N),reset:async()=>(await E()).reset()}}}}const Ar="0.5.16",Ho=`https://cdn.jsdelivr.net/npm/@electric-sql/pglite@${Ar}/dist/index.js`,Cr="314.0.7",xr=`https://cdn.jsdelivr.net/pyodide/v${Cr}/full/`;let ne;const Ir=e=>e.endsWith("/")?e:`${e}/`;async function Dr(e){const t=globalThis;if(typeof t.importScripts=="function")try{if(t.importScripts(`${e}pyodide.js`),t.loadPyodide)return t.loadPyodide}catch{}return(await Gn(()=>import(`${e}pyodide.mjs`),[],import.meta.url)).loadPyodide}async function Vo(e={}){const t=Ir(e.indexURL??xr);if(ne?.indexURL!==t){const r=Dr(t);ne={indexURL:t,load:r},r.catch(()=>{ne?.load===r&&(ne=void 0)})}const n=()=>{};return(await ne.load)({indexURL:t,env:e.env,stdout:n,stderr:n})}const He="/bfwc-artifacts";function qr(e){const t=[];for(const n of e.matchAll(/(?:pure Python 3 wheel|pure Python wheel|wheel compatible with Pyodide)[^:'"]*:?\s*((?:['"][^'"]+['"](?:,\s*)?)+)/gi))for(const r of n[1].matchAll(/['"]([^'"]+)['"]/g))t.push(Vt(r[1].split(/[<>=!~;[ ]/)[0]));return[...new Set(t)]}const Lr=e=>e instanceof Error?e.message:String(e);async function St(e,t,n){const r=e.toPy(n);try{await e.runPythonAsync(`import micropip
${t}`,{globals:r})}finally{r.destroy?.()}}async function Ve(e,t,n={}){const r=Bn(t,n.provided),s={installed:[],provided:r.provided,declined:[...r.declined]};let i=r.install;if(!i.length)return s;const o=n.log??(()=>{});await e.loadPackage("micropip",{messageCallback:()=>{},errorCallback:o});const a=n.indexUrls?.length?[...n.indexUrls]:void 0;for(;;)try{return await St(e,"await micropip.install(specs, index_urls=index_urls)",{specs:i.map(l=>l.spec),index_urls:a}),s.installed.push(...i.map(l=>l.name)),s}catch(l){const c=qr(Lr(l)).filter(h=>!s.declined.some($=>$.name===h));if(!c.length)throw l;for(const h of c)s.declined.push({name:h,reason:Wn(h)});const u=new Set(i.filter(h=>c.includes(h.name)).map(h=>h.name)),d=c.filter(h=>!u.has(h));for(const h of d)await St(e,'micropip.add_mock_package(name, "0.0.0")',{name:h});if(i=i.filter(h=>!u.has(h.name)),!i.length)return s}}function Mr(e){const t=[];e.installed.length&&t.push(`Successfully installed ${e.installed.join(" ")}`),e.provided.length&&t.push(`Provided by the runtime (not installed): ${e.provided.join(" ")}`);for(const{reason:n}of e.declined)t.push(`Declined: ${n}`);return t}const G="/project",Ur=new Set(["node_modules",".git"]),jr=50,Se=e=>e.split("/").some(t=>Ur.has(t)),q=e=>e==="/"?G:A(G,e);function we(e){const t=rt(e);return t===G?"/":t.startsWith(`${G}/`)?t.slice(G.length):void 0}const Fr=new TextDecoder("utf-8",{fatal:!0,ignoreBOM:!0});function Gr(e){try{return Fr.decode(e)}catch{return e.slice()}}const fe=(e,t)=>e.analyzePath(t).exists,Oe=(e,t)=>fe(e,t)&&e.isDir(e.stat(t).mode),ze=(e,t)=>fe(e,t)&&!e.isDir(e.stat(t).mode),Zt=(e,t)=>t.startsWith("/")?t:A(e.cwd(),t),ot=(e,t)=>e.readdir(t).filter(n=>n!=="."&&n!=="..");function ke(e,t){if(fe(e,t)){if(!Oe(e,t))return e.unlink(t);for(const n of ot(e,t))ke(e,`${t}/${n}`);e.rmdir(t)}}function at(e,t){t.mkdirTree(G);for(const n of e.explicitDirectories())Se(n)||t.mkdirTree(q(n));for(const n of e.list()){if(Se(n))continue;const r=q(n);t.mkdirTree(Re(r)),t.writeFile(r,e.readFile(n)??"")}}function lt(e,t){for(const n of t){if(Se(n.path))continue;const r=q(n.path);n.op==="write"?(e.mkdirTree(Re(r)),Oe(e,r)&&ke(e,r),e.writeFile(r,n.content)):n.op==="mkdir"?e.mkdirTree(r):ke(e,r)}}function en(e,t,n=()=>!1){const r=new Set;let s=[],i=!1,o=0,a;const l=(p,_)=>{const v=q(p);return _==="mkdir"||_==="remove"?[{op:_,path:p}]:fe(e,v)?Oe(e,v)?_==="write"?[]:[{op:"mkdir",path:p},...ot(e,v).flatMap(m=>l(A(p,m),"tree"))]:[{op:"write",path:p,content:Gr(e.readFile(v))}]:[]},c=()=>{if(i=!1,!s.length)return;const p=s;s=[];const _=p.flatMap(({op:v,path:m})=>l(m,v)).filter(v=>!n(v.path));_.length&&t(_)},u=(p,_)=>{const v=we(_);if(!(o||v===void 0||v==="/"||n(v)||Se(v))){if(p==="write"){let m;for(const w of s)w.path===v&&(m=w);if(m?.op==="write")return}s.push({op:p,path:v}),i||(i=!0,queueMicrotask(c))}},d=()=>{for(const p of r)u("write",p)},h={openedForWrite(p){!o&&we(p)!==void 0&&r.add(p)},written(p){o||we(p)===void 0||(r.add(p),clearTimeout(a),a=setTimeout(d,jr))},closed(p){r.delete(p)&&u("write",p)},madeDirectory:p=>u("mkdir",p),symlinked:p=>u("tree",p),deleted:p=>u("remove",p),moved(p,_){u("remove",p),u("tree",_)}},$=e.truncate.bind(e),f=e.ftruncate.bind(e);return e.truncate=(p,_)=>{$(p,_),typeof p=="string"&&u("write",Zt(e,p))},e.ftruncate=(p,_)=>{f(p,_);const v=e.getStream(p)?.path;v&&u("write",v)},{events:h,tracker:{quietly(p){o++;try{p()}finally{o--}},flush(){clearTimeout(a),d(),c()}}}}const he=q,zo=we;function Br(e,t){at(e,t)}function Wr(e,t){lt(e,t)}const Hr=579,Vr=e=>e.includes("/__pycache__")||e.endsWith(".pyc");function zr(e,t){const{tracker:n,events:r}=en(e,t,Vr),s={onOpenFile:((i,o)=>{o&Hr&&r.openedForWrite(i)}),onWriteToFile:(i=>r.written(i)),onCloseFile:(i=>r.closed(i)),onMakeDirectory:(i=>r.madeDirectory(i)),onMakeSymlink:((i,o)=>r.symlinked(o)),onDeletePath:(i=>r.deleted(i)),onMovePath:((i,o)=>r.moved(i,o))};return Object.assign(e.trackingDelegate,s),n}const tn=e=>import(e),Qe=(e,t)=>e===t||e.startsWith(t==="/"?"/":`${t}/`);function Qr(e,t,n){const r=rt(t.root??`/opt/bfwc-extensions/${n}`);if(Qe(r,G)||Qe(G,r))throw new Error(`Python extension ${e.moduleUrl}: root ${r} overlaps the project (${G}); extensions are installed outside it.`);return r}function Kr(e,t,n){const r=A(t,n);if(n.startsWith("/")||!Qe(r,t)||r===t)throw new Error(`Python extension ${e.moduleUrl}: file "${n}" is outside its root ${t}.`);return r}async function Yr(e,t,n=tn){const r=new Set,s=new Set;for(const[i,o]of t.entries()){const l=(await n(o.moduleUrl))[o.exportName];if(typeof l!="function")throw new Error(`Python extension ${o.moduleUrl} has no function export "${o.exportName}".`);const c=await l()??{},u=Object.entries(c.files??{}),d=u.length?Qr(o,c,i):void 0,h=u.map(([$,f])=>[Kr(o,d,$),f]);for(const[$,f]of Object.entries(c.jsModules??{}))e.registerJsModule($,f);for(const[$,f]of h)e.FS.mkdirTree($.slice(0,$.lastIndexOf("/"))||"/"),e.FS.writeFile($,f);d&&e.runPython(`import sys
if ${JSON.stringify(d)} not in sys.path: sys.path.insert(0, ${JSON.stringify(d)})`);for(const $ of c.provides??[])r.add(Vt($));for(const $ of c.imports??(c.provides??[]).map(f=>f.replace(/-/g,"_")))s.add($)}return{packages:r,imports:s}}function Jr(e){const t={};for(const[n,r]of e){const s=n.toLowerCase(),i=t[s];t[s]=i===void 0?r:Array.isArray(i)?[...i,r]:[i,r]}return t}const Xr=e=>JSON.stringify(Object.entries(e.headers??{}));function nn(e){const t=e.handle,n=e.disconnect,r=e.close,s={interface:e.interface,app:String(e.label),port:Number(e.port)};let i=1;return{spec:s,handle:a=>new Promise((l,c)=>{const u=i++;let d,h=!1;const $={head(f,p){d=ur(()=>{h||n(u)}),l({status:f,headers:Jr(JSON.parse(p)),body:d.stream})},chunk(f){if(!(!d||d.push(f.slice())))return d.ready()},end(f){h=!0,f?d?.fail(new Error(f)):d?.end()}};t(u,a.method,a.url,Xr(a),a.body??void 0,$).then(()=>{d||c(new Error("The Python app finished without a response."))},f=>{d?d.fail(f):c(f)})}),async close(){try{await r()}finally{e.destroy?.()}}}}async function Zr(e,t){const n=e.pyimport("bfwc.serve").start_server;return nn(await n(t.interface,t.app,t.port,!!t.factory,t.appDir))}async function es(e){const t=e.pyimport("bfwc.serve").start_requested;return nn(await t())}function ct(e,t){let n=new Jt,r,s,i,o,a=!1;const l=p=>{if(!a){r?.flush(),a=!0,i!==void 0&&e({type:"unlisten",port:i});for(const _ of o?.listening??[])e({type:"unlisten",port:_});o?.closeAll(),e({type:"exit",code:p})}},c={post:e,io:{stdout:p=>!a&&e({type:"stdout",data:p}),stderr:p=>!a&&e({type:"stderr",data:p})},get exited(){return a},exit:l,mounted(p){n=void 0,r=p},get takenPorts(){return d.taken}},u=async(p,_=Hn(p))=>{const v=s;s=void 0,d.cancelAll();try{o?.stop()}catch{}try{await v?.close()}finally{l(_)}},d=dr({post:e,handlerFor:p=>s&&p===i?s.handle:o?.handlerFor(p),onListenFailed(p){if(p===i)i=void 0;else if(!o?.listening.has(p))return;c.io.stderr(h.addressInUse(p)),u("SIGTERM",1)}}),h=t(c),$=p=>{n?fr(n,p):r?.apply(p)};async function f(p){const{snapshot:_}=p;_.pack?bt(n,_):$(_.ops);for(const E of p.ports)d.taken.add(E);const v=h.plan(p);if(!v.ok)return c.io.stderr(v.message),l(v.code);if(v.port!==void 0&&d.taken.has(v.port))return c.io.stderr(h.addressInUse(v.port)),l(1);const m=await v.run(n);if(m.kind==="exited")return l(m.code);if(m.kind==="running")return o=m.ports,l(await m.done);const{port:w}=m.server;if(a||d.taken.has(w))return await m.server.close(),a||c.io.stderr(h.addressInUse(w)),l(1);s=m.server,i=w,d.taken.add(w),e({type:"listen",port:w}),c.io.stderr(m.banner)}return{receive(p){if(!(d.receive(p)||h.receive?.(p)))switch(p.type){case"prime":return bt(n,p.snapshot),e({type:"primed"});case"start":f(p).catch(_=>{c.io.stderr(`${_ instanceof Error?_.stack??_.message:String(_)}
`),l(1)});return;case"fs":return $(p.ops);case"kill":return void u(p.signal);case"stdin":return h.stdin?.(p.data);case"socket-open":case"socket-accept":return e({type:"socket-close",connId:p.connId});default:return}}}}const ts=String.raw`
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
`,ns=String.raw`
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
`,rs=String.raw`
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
`,ss=String.raw`
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
`,is=String.raw`
import os

ARTIFACT_DIR = ${JSON.stringify(He)}


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
`,os=String.raw`
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
`,as=String.raw`
class UvicornWorker:
    """Named by gunicorn's -k option; the runtime reads it from the command line and serves ASGI."""
`,ls=String.raw`
"""The browser runtime serves WSGI apps itself; gunicorn is importable but never runs."""
__version__ = "0.0.0+bfwc"
version_info = (0, 0, 0)
`,Ce="/opt/bfwc",cs={"bfwc/__init__.py":"","bfwc/run.py":ts,"bfwc/serve.py":ns,"bfwc/threads.py":ss,"bfwc/training.py":is,"bfwc/vsocket.py":rs,"uvicorn/__init__.py":os,"uvicorn/workers.py":as,"gunicorn/__init__.py":ls};function us(e){for(const[t,n]of Object.entries(cs)){const r=`${Ce}/${t}`;e.FS.mkdirTree(r.slice(0,r.lastIndexOf("/"))),e.FS.writeFile(r,n)}e.runPython(`import sys
if ${JSON.stringify(Ce)} not in sys.path: sys.path.insert(0, ${JSON.stringify(Ce)})`)}const ds=new TextDecoder;function ut(e,t){return n=>{const r=B(t,n);if(!(!e.FS.analyzePath(r).exists||e.FS.isDir(e.FS.stat(r).mode)))return ds.decode(e.FS.readFile(r))}}const rn=e=>e.map(zn).filter(t=>!!t),sn=e=>[e.PIP_INDEX_URL,...(e.PIP_EXTRA_INDEX_URL??"").split(/\s+/)].filter(t=>!!t);async function xe(e,t,n,r){const s=e.toPy({kind:t,target:n,argv:[...r]});try{const i=await e.runPythonAsync(`from bfwc.run import run_main
run_main(kind, target, argv)`,{globals:s});return i==="serve"?"serve":typeof i=="number"?i:0}finally{s.destroy?.()}}async function kt(e,t,n){if(t)try{const r=e.pyimport("pyodide.code").find_imports,s=r(t),i=s.toJs?.()??[];s.destroy?.();const o=i.filter(a=>!n.provided.imports.has(a.split(".")[0]));if(!o.length)return;await e.loadPackagesFromImports(o.map(a=>`import ${a}`).join(`
`),{messageCallback:()=>{},errorCallback:a=>n.io.stderr(`${a}
`)})}catch(r){n.io.stderr(`${r instanceof Error?r.message:String(r)}
`)}}async function fs(e,t,n){const r=o=>n.io.stderr(`${o}
`),s=o=>o.declined.forEach(({reason:a})=>r(`Declined: ${a}`));for(const o of n.installs)try{s(await Ve(e,rn(o.specs),{indexUrls:o.indexUrls,log:r,provided:n.provided.packages}))}catch(a){r(`Warning: could not repeat this session's earlier pip install of ${o.specs.join(" ")}: ${a instanceof Error?a.message.trim().split(`
`).pop():String(a)}`)}const i=zt(ut(e,n.cwd),t);i.length&&s(await Ve(e,i,{indexUrls:sn(n.env),log:r,provided:n.provided.packages})),e.pyimport("bfwc.threads").install()}async function ps(e,t,n){const r=ut(e,n.cwd),s=t.projects.flatMap(c=>{const u=B(n.cwd,c),d=zt(r,u);return d.length||n.io.stderr(`${c}: no dependencies declared (pyproject.toml [project] dependencies or requirements.txt); its own code runs from the project directory as is.
`),d}),i=[...rn(t.packages),...t.files.flatMap(c=>Vn(r,B(n.cwd,c))),...s],o=[...t.indexUrls,...sn(n.env)],a=await Ve(e,i,{indexUrls:o,log:c=>n.io.stderr(`${c}
`),provided:n.provided.packages});for(const c of Mr(a))(c.startsWith("Declined")?n.io.stderr:n.io.stdout)(`${c}
`);const l=i.filter(c=>a.installed.includes(c.name)).map(c=>c.spec);return l.length&&n.io.installed?.({specs:l,indexUrls:o}),a.declined.length?1:0}async function $s(e,t,n){const r=a=>({kind:"exited",code:a});if(t.kind==="install")return e.pyimport("bfwc.threads").install(),r(await ps(e,t,n));const s=t.kind==="serve"&&t.server.appDir?B(n.cwd,t.server.appDir):n.cwd;if(await fs(e,s,n),t.kind==="serve")return{kind:"serving",server:await Zr(e,t.server)};const i=ut(e,n.cwd);let o;return t.kind==="script"?(await kt(e,i(t.path),n),o=await xe(e,"script",t.path,t.argv)):t.kind==="code"?(await kt(e,t.code,n),o=await xe(e,"code",t.code,t.argv)):o=await xe(e,"module",t.module,t.argv),o==="serve"?{kind:"serving",server:await es(e)}:r(o)}const on=64*1024;class hs{channel;highWaterMark;queue=[];unacked=0;ended=!1;constructor(t,n,r=on){this.channel=t,this.highWaterMark=r,t.manualFlowControl(),t.onData(s=>{this.queue.push(s),n()}),t.onConsumed(s=>{this.unacked=Math.max(0,this.unacked-s),this.unacked<=this.highWaterMark&&n()}),t.onClose(()=>{this.ended=!0,n()})}get writable(){return this.unacked<=this.highWaterMark}tryRecv(t){const n=this.queue.shift();if(!n)return this.ended?null:void 0;const r=n.byteLength>t?n.subarray(0,t):n;return r!==n&&this.queue.unshift(n.subarray(t)),this.channel.closed||this.channel.consumed(r.byteLength),r}send(t){this.channel.send(t),this.unacked+=t.byteLength}close(){this.ended=!0,this.queue.length=0,this.channel.close()}}const ms=new Set(["localhost","127.0.0.1","::1","0.0.0.0",""]),Pt=e=>{const t=e.wakeReader;e.wakeReader=void 0,t?.();for(const n of e.wakeSenders.splice(0))n()};function gs(e,t=on){const n=new Map;let r=1;const s=i=>{const o=n.get(i);if(!o)throw new Error(`Bad file descriptor: connection ${i} is closed.`);return o};return{async connect(i,o){if(!ms.has(i.toLowerCase()))throw new Error(`connect ECONNREFUSED ${i}:${o} (only localhost is reachable in the browser runtime)`);const a=await e(o);if(!a)throw new Error(`connect ECONNREFUSED ${i}:${o}`);const l=r++,c={wakeSenders:[]},u=Object.assign(c,{endpoint:new hs(a,()=>Pt(c),t)});return n.set(l,u),l},async send(i,o){const a=s(i),{endpoint:l}=a;if(l.ended)throw new Error("Broken pipe: the connection is closed.");for(l.send(o);!l.writable&&!l.ended;)await new Promise(c=>a.wakeSenders.push(c))},async recv(i,o){const a=s(i);for(;;){const l=a.endpoint.tryRecv(o);if(l!==void 0)return l;await new Promise(c=>a.wakeReader=c)}},close(i){const o=n.get(i);o&&(o.endpoint.close(),Pt(o),n.delete(i))}}}function _s(e){const t=it(e);return{transport:gs(n=>t.dial(n)),receive:n=>t.receive(n)}}const ys="_bfwc_tcp",be="timeout",Tt=e=>new Promise(t=>setTimeout(()=>t(be),e));function ws(e){const t=new Map;return{async connect(n,r,s){const i=e.connect(n,r);if(s==null)return i;const o=await Promise.race([i,Tt(s)]);if(o===be)throw i.then(a=>e.close(a),()=>{}),new Error("timed out");return o},send:(n,r)=>Promise.resolve(e.send(n,r.slice())),async recv(n,r,s){const i=t.get(n)??e.recv(n,r);t.set(n,i);const o=s==null?await i:await Promise.race([i,Tt(s)]);return o===be?be:(t.delete(n),o??void 0)},shutdown:n=>e.shutdown?.(n),close(n){t.delete(n),e.close(n)}}}function bs(e,t){e.registerJsModule(ys,ws(t)),e.runPython(`import bfwc.vsocket
bfwc.vsocket.install()`)}const vs="_bfwc_training",Es=50,Ss=12e4;function*an(e,t,n=""){for(const r of e.readdir(t)){if(r==="."||r==="..")continue;const s=`${t}/${r}`,i=n?`${n}/${r}`:r,{mode:o}=e.lstat(s);e.isLink(o)||(e.isDir(o)?yield*an(e,s,i):e.isFile(o)&&(yield[i,s]))}}const ks=e=>e.analyzePath(He).exists?[...an(e,He)]:[];function Ps(e){let t=!1,n,r=0,s=0;const i=new Map;async function o(a=!1){if(!n)return{ok:!1,error:"Not a training process.",confirmed:!1};const{py:l,options:c}=n,u=++r;let d;try{if(d=ks(l.FS),a&&d.length===0)return{ok:!0,confirmed:!1};for(const[$,f]of d){const p=l.FS.readFile(f);e({type:"training-artifact",saveId:u,path:$,bytes:p},[p.buffer])}}catch($){return{ok:!1,error:`Could not read the artifacts: ${$ instanceof Error?$.message:String($)}`,confirmed:!1}}const h=c.acks?new Promise($=>{i.set(u,$),setTimeout(()=>i.get(u)===$&&(i.delete(u),$({ok:!1,error:"The page did not acknowledge the save.",confirmed:!1})),Ss)}):void 0;return e({type:"training-saved",saveId:u,files:d.length}),h??{ok:!0,confirmed:!1}}return{receive(a){return pr(a)?a.type==="checkpoint"?(t=!0,!0):(i.get(a.saveId)?.(a.superseded?{ok:!0,confirmed:!1,superseded:!0}:{ok:a.ok,error:a.error,confirmed:a.ok}),i.delete(a.saveId),!0):!1},install(a,l){n={py:a,options:l,cell:l.flag?new Int32Array(l.flag):void 0};const c=n.cell;a.registerJsModule(vs,{checkpoint_requested:()=>t||c!==void 0&&Atomics.load(c,0)!==0,should_yield:()=>{if(c||t)return!1;const u=Date.now();return u-s<Es?!1:(s=u,!0)},tick:()=>new Promise(u=>setTimeout(u,0)),save:()=>o().then(u=>({error:u.ok?"":u.error??"The save failed.",confirmed:u.confirmed}))})},async saveAtExit(a){if(!n)return;const l=await o(!0);l.ok||a(`bfwc.training: the artifacts were not saved: ${l.error??"unknown error"}
`)}}}const Ts=e=>`[Errno 98] error while attempting to bind on address ('0.0.0.0', ${e}): address already in use
`,Rs=e=>/fatal error/i.test(e instanceof Error?e.message:String(e));function Qo(e){const t=[],n=new TextDecoder,r=e.tcp?void 0:_s(e.post),s=e.tcp??r.transport,i=Ps((a,l)=>e.post(a,l)),o=a=>t.push(...a.split(/(?<=\n)/).filter(Boolean));return ct(e.post,a=>{async function l(u,d){const h={...u.env,PYTHONDONTWRITEBYTECODE:"1",PYTHONUNBUFFERED:"1",PWD:he(u.cwd)},$=await e.loadPyodide({indexURL:u.python?.indexURL,env:h}),f=E=>({write:N=>(a.io[E](N.slice()),N.length),isatty:!1});$.setStdout(f("stdout")),$.setStderr(f("stderr")),$.setStdin({stdin:()=>t.shift()??null,isatty:!1}),us($),bs($,s);const p=u.python?.training;p&&i.install($,p);const _=await Yr($,u.python?.extensions??[],e.importModule??tn);Br(d,$.FS);const v=zr($.FS,E=>{a.exited||e.post({type:"fs",ops:E})});a.mounted({apply:E=>v.quietly(()=>Wr($.FS,E)),flush:()=>v.flush()});const m=$.pyimport("bfwc.run").bootstrap,w=$.toPy(h);try{m(w,he(u.cwd))}finally{w.destroy?.()}return{py:$,provided:_}}async function c(u,d,h){const{py:$,provided:f}=await l(u,h);if(a.exited)return{kind:"exited",code:0};const p=await $s($,d,{cwd:he(u.cwd),env:u.env,io:{stdout:a.io.stdout,stderr:a.io.stderr,installed:v=>e.post({type:"python-installed",...v})},installs:u.python?.installs??[],provided:f});if(p.kind==="exited")return i.saveAtExit(a.io.stderr).then(()=>p);const _=p.server;return{kind:"serving",server:{port:_.spec.port,handle:Os(_,a),close:()=>_.close()},banner:`Serving ${_.spec.interface.toUpperCase()} app ${_.spec.app} on http://localhost:${_.spec.port} (request-driven)
`}}return{addressInUse:Ts,plan(u){const d=Qn(u.command,u.args,u.env);if(!d.ok)return{ok:!1,message:`${u.command}: ${d.reason}
`,code:2};const h=Kn(d.invocation,he);return{ok:!0,port:h.kind==="serve"?h.server.port:void 0,run:$=>c(u,h,$)}},stdin:u=>o(u===null?n.decode():typeof u=="string"?u:n.decode(u,{stream:!0})),receive:u=>i.receive(u)||!!r?.receive(u)}})}function Os(e,t){return n=>e.handle(n).catch(r=>{throw Rs(r)&&(t.io.stderr(`${r instanceof Error?r.message:String(r)}
`),t.exit(1)),r})}const Ns=3,As=64,Cs=512;function xs(e){return typeof e=="string"?/[wa+]/.test(e):(e&Ns)!==0||(e&(As|Cs))!==0}function ln(e,t){const{tracker:n,events:r}=en(e,t),s=o=>Zt(e,o),i={open:e.open,write:e.write,close:e.close,mkdir:e.mkdir,unlink:e.unlink,rmdir:e.rmdir,rename:e.rename,symlink:e.symlink};return e.open=function(o,a,l){const c=i.open.call(this,o,a,l);return xs(a)&&c.path&&r.openedForWrite(c.path),c},e.write=function(o,...a){const l=i.write.call(this,o,...a);return o.path&&r.written(o.path),l},e.close=function(o){const a=o.path;i.close.call(this,o),a&&r.closed(a)},e.mkdir=function(o,a){const l=i.mkdir.call(this,o,a);return r.madeDirectory(s(o)),l},e.unlink=function(o){i.unlink.call(this,o),r.deleted(s(o))},e.rmdir=function(o){i.rmdir.call(this,o),r.deleted(s(o))},e.rename=function(o,a){i.rename.call(this,o,a),r.moved(s(o),s(a))},e.symlink=function(o,a){const l=i.symlink.call(this,o,a);return r.symlinked(s(a)),l},n}const Ke=e=>`'${e.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;function Z(e,t){return e==null?"null":typeof e=="boolean"||typeof e=="number"?JSON.stringify(e):typeof e=="string"?t?.(e)??Ke(e):Array.isArray(e)?`[${e.map(n=>Z(n,t)).join(", ")}]`:`[${Object.entries(e).map(([n,r])=>`${Z(n)} => ${Z(r,t)}`).join(", ")}]`}const Is=String.raw`<?php
// Generated by the BuilderForce WebContainers PHP runtime (composer install).
require_once __DIR__ . '/composer/ClassLoader.php';
require_once __DIR__ . '/composer/InstalledVersions.php';
return \Composer\Autoload\ClassLoader::bfwcBoot(require __DIR__ . '/composer/autoload_bfwc.php');
`,Ds=String.raw`<?php
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
`,qs=String.raw`<?php
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
`,Ls=/^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z_\x80-￿][A-Za-z0-9_\x80-￿]*)/gm,Ms=/^\s*namespace\s+([A-Za-z_\\][A-Za-z0-9_\\]*)\s*[;{]/m;function Us(e){const t=e.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*(\/\/|#).*$/gm,""),n=Ms.exec(t)?.[1];return[...t.matchAll(Ls)].map(r=>n?`${n}\\${r[2]}`:r[2])}function Ie(e,t,n,r,s){if(!s)return;const i=a=>A(n,r,a);for(const[a,l]of Object.entries(s["psr-4"]??{}))(e.psr4[a]??=[]).push(...[l].flat().map(i));for(const[a,l]of Object.entries(s["psr-0"]??{}))(e.psr0[a]??=[]).push(...[l].flat().map(i));for(const a of s.files??[])e.files.push(i(a));const o=(s["exclude-from-classmap"]??[]).map(i);for(const a of s.classmap??[]){const l=i(a),c=t.isDir(l)?t.list(l).filter(u=>/\.(php|inc|hh)$/.test(u)):[l];for(const u of c)if(!o.some(d=>u.startsWith(d)))for(const d of Us(t.read(u)??""))e.classmap[d]??=u}}const js=e=>t=>t===e||t.startsWith(`${e}/`)?`$baseDir . ${Z(t.slice(e.length))}`:void 0;function Fs(e){const t=new Map(e.map(i=>[i.name.toLowerCase(),i])),n=new Set,r=[],s=(i,o)=>{const a=i.name.toLowerCase();if(!(n.has(a)||o.has(a))){o.add(a);for(const l of Object.keys(i.require??{}).sort()){const c=t.get(l.toLowerCase());c&&s(c,o)}o.delete(a),n.add(a),r.push(i)}};for(const i of[...e].sort((o,a)=>o.name.localeCompare(a.name)))s(i,new Set);return r}function Rt(e,t,n,r,s){const i={psr4:{},psr0:{},classmap:{},files:[]};Ie(i,e,t,"",n.autoload),s.dev&&Ie(i,e,t,"",n["autoload-dev"]);const o=i.files.splice(0);for(const d of Fs(r))Ie(i,e,t,`vendor/${d.name}`,d.autoload);i.files.push(...o);const a=A(t,"vendor"),l=js(t);e.write(A(a,"autoload.php"),Is),e.write(A(a,"composer/ClassLoader.php"),Ds),e.write(A(a,"composer/InstalledVersions.php"),qs),e.write(A(a,"composer/autoload_bfwc.php"),`<?php
// Generated by the BuilderForce WebContainers PHP runtime.
$baseDir = dirname(__DIR__, 2);
return ${Z(i,l)};
`),e.write(A(a,"composer/installed.json"),`${JSON.stringify({packages:r,dev:s.dev,"dev-package-names":[...s.devPackages]},null,4)}
`);const c=Object.fromEntries(r.map(d=>[d.name,{pretty_version:d.version,version:d.version_normalized??d.version,reference:d.dist?.reference??d.source?.reference??null,type:d.type??"library",install_path:A(a,d.name),aliases:[],dev_requirement:s.devPackages.has(d.name)}])),u={name:n.name??"__root__",pretty_version:n.version??"dev-main",version:n.version??"dev-main",reference:null,type:"project",install_path:t,aliases:[],dev:s.dev};e.write(A(a,"composer/installed.php"),`<?php
$baseDir = dirname(__DIR__, 2);
return ${Z({root:u,versions:{...c,[u.name]:{...u,dev_requirement:!1}}},l)};
`)}const Gs=/^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]?|-{0,2})[a-z0-9]+)*$/;class dt extends Error{}const cn=e=>Gs.test(e)&&!un(e),un=e=>e.split("/").some(t=>t==="."||t===".."||t===""),ft=(e,t)=>new dt(`Invalid package name "${e}" in ${t}: Composer names are vendor/package, lower-case letters, digits and [_.-] separators.`);function te(e,t){const n=e.toLowerCase();if(Ee(n)||cn(n))return n;throw ft(e,t)}function Ye(e,t){const n=typeof e=="string"?e.toLowerCase():"";if(cn(n))return n;throw ft(String(e),t)}function De(e,t){return A(e,"vendor",Ye(t,"a vendor path"))}function Bs(e){if(un(e))throw ft(e,"a repository URL");return e.split("/").map(encodeURIComponent).join("/")}function Ws(e){const n=(Array.isArray(e.repositories)?e.repositories:Object.entries(e.repositories??{}).map(([r,s])=>s===!1?{type:`${r}: false`}:s)).map(r=>r).filter(r=>!(r?.type==="composer"&&typeof r.url=="string"&&/^https:\/\/(repo\.)?packagist\.org\/?$/.test(r.url))).map(r=>typeof r?.type=="string"?r.type:"unknown");if(n.length)return`composer.json declares repositories of type ${[...new Set(n)].join(", ")}, which the PHP runtime does not support (it installs from Packagist, or the host's php.composer.repositoryUrl, only).`}function Ot(e){const t=[];for(const n of e){const r=/^([^:=\s]+)[:=](.+)$/.exec(n);r?t.push({name:te(r[1],"composer require"),constraint:r[2]}):!n.includes("/")&&t.length&&t[t.length-1].constraint===void 0?t[t.length-1].constraint=n:t.push({name:te(n,"composer require")})}return t}function Hs(e,t){const n=new Map;for(const i of t.values())for(const o of[...Object.keys(i.replace??{}),...Object.keys(i.provide??{})])n.set(o.toLowerCase(),i.name);const r=new Set,s=Object.keys(e.require??{}).map(i=>i.toLowerCase());for(;s.length;){const i=s.shift(),o=t.get(i)??t.get(n.get(i)??"");!o||r.has(o.name)||(r.add(o.name),s.push(...Object.keys(o.require??{}).map(a=>a.toLowerCase())))}return r}function Vs(e,t){return`${JSON.stringify({_readme:["This file locks the dependencies of your project to a known state","Written by the BuilderForce WebContainers PHP runtime"],...e,aliases:[],"minimum-stability":t.minimumStability,"stability-flags":{},"prefer-stable":t.preferStable,"prefer-lowest":!1,platform:{},"platform-dev":{},"plugin-api-version":"2.6.0"},null,4)}
`}class V extends Error{}const Je=e=>st(e.version_normalized??e.version),Nt=e=>Object.entries(e.require??{}).map(([t,n])=>({name:te(t,`${e.name}'s require`),constraint:n,from:e.name})),At=e=>[...Object.keys(e.replace??{}),...Object.keys(e.provide??{})].map(t=>t.toLowerCase());function Ct(e,t,n){return dn(e,t,n)[0]}function dn(e,t,n,r){const s=t.reduce((l,c)=>c.stability&&gt({stability:l},c.stability)?c.stability:l,n.minimumStability),i=e.map(l=>({pkg:l,version:Je(l)})).filter(l=>!!l.version&&gt(l.version,s)&&t.every(c=>c.test(l.version))).sort((l,c)=>Yn(c.version,l.version)),o=n.preferStable?[...i.filter(l=>l.version.stability==="stable"),...i.filter(l=>l.version.stability!=="stable")]:i,a=r===void 0?-1:o.findIndex(l=>l.pkg.version===r);return a>0&&o.unshift(...o.splice(a,1)),o.map(l=>l.pkg)}function xt(e,t){return t.map(n=>{const r=Kt(n.constraint);if(!r)throw new V(`Cannot read the version constraint "${n.constraint}" on ${e} (required by ${n.from}).`);return r})}async function zs(e,t,n,r={}){const s=new Set(At(r)),i={steps:n.maxSteps??2e4};let o="",a=-1;const l=(f,p)=>{f>=a&&(o=p,a=f)},c=new Map,u=async f=>(c.has(f)||c.set(f,await t.versions(f)),c.get(f)),d=f=>{const p=[{from:"root",conflict:r.conflict},...[...f.values()].map(_=>({from:_.name,conflict:_.conflict}))];for(const{from:_,conflict:v}of p)for(const[m,w]of Object.entries(v??{})){const E=m.toLowerCase(),N=Kt(w),k=f.get(E),D=k&&Je(k);if(D&&N?.test(D))return`${_} conflicts with ${k.name} ${w}`;for(const x of f.values()){const I={...x.provide,...x.replace},M=Object.entries(I).find(([g])=>g.toLowerCase()===E)?.[1];if(M===void 0)continue;const y=st(M==="self.version"?x.version_normalized??x.version:M.replace(/^[=\s]+/,""));if(y&&N?.test(y))return`${_} conflicts with ${E} ${w} (${x.name} ${M==="self.version"?"replaces/provides it":`provides ${M}`})`}}},h=async f=>{if(--i.steps<0)throw new V("Dependency resolution took too long; pin the conflicting packages in composer.json.");const p=new Map;for(const k of[...e,...[...f.values()].flatMap(Nt)])Ee(k.name)||p.set(k.name,[...p.get(k.name)??[],k]);const _=new Set([...s,...[...f.values()].flatMap(At)]);for(const[k,D]of f){const x=p.get(k)??[],I=Je(D),M=xt(k,x),y=x.find((g,S)=>!M[S].test(I));if(y){l(f.size,`${k} ${D.version} was chosen, but ${y.from} requires ${k} ${y.constraint}.`);return}}const v=d(f);if(v){l(f.size,`${v}.`);return}const m=[...p.keys()].filter(k=>!f.has(k)&&!_.has(k));let w;for(const k of m)if(await u(k)){w=k;break}if(w===void 0){if(!m.length)return f;const k=m[0];l(f.size,`Package ${k} (required by ${p.get(k).map(D=>D.from).join(", ")}) was not found in the repository, and no chosen package provides or replaces it.`);return}const E=p.get(w),N=dn(await u(w),xt(w,E),n,n.preferred?.get(w));if(!N.length){l(f.size,`No version of ${w} satisfies ${E.map(k=>`${k.constraint} (required by ${k.from})`).join(" and ")} at minimum-stability ${n.minimumStability}.`);return}for(const k of N){const D=n.platform&&Object.entries(k.require??{}).map(([I,M])=>Ee(I.toLowerCase())?Qt(I,M,n.platform):void 0).find(Boolean);if(D){l(f.size,`${k.name} ${k.version} is declined: ${D}`);continue}try{Nt(k)}catch(I){if(!(I instanceof dt))throw I;l(f.size,`${k.name} ${k.version} is skipped: ${I.message}`);continue}const x=await h(new Map([...f,[w,k]]));if(x)return x}},$=await h(new Map);if(!$)throw new V(o||"No installable set of packages satisfies composer.json.");return{packages:$}}function Qs(e,t){return[...Object.entries(e.require??{}),...t?[]:Object.entries(e["require-dev"]??{})].map(([r,s])=>({name:r.toLowerCase(),constraint:s,from:"root"}))}class Y extends Error{}const Ks=["pre-install-cmd","post-install-cmd","pre-update-cmd","post-update-cmd","post-autoload-dump","post-root-package-install","post-create-project-cmd"],me=(e,t)=>{try{return JSON.parse(e)}catch(n){throw new Y(`${t} does not contain valid JSON: ${n instanceof Error?n.message:String(n)}`)}};function qe(e,t,n,r){return[...Object.entries({...e.require,...n?e["require-dev"]:{}}).map(([o,a])=>({name:o,constraint:a,from:"your project"})),...t.flatMap(o=>Object.entries(o.require??{}).map(([a,l])=>({name:a,constraint:l,from:o.name})))].flatMap(({name:o,constraint:a,from:l})=>{const c=Ee(o.toLowerCase())?Qt(o,a,r):void 0;return c?[`${l} requires ${o} ${a}: ${c}`]:[]})}async function Ys(e,t){const{files:n,projectDir:r}=t,s=A(r,"composer.json"),i=A(r,"composer.lock"),o=A(r,"vendor/composer/installed.json"),a=n.read(s),l=n.read(i),c=!e.noDev;try{if(a===void 0&&e.command!=="require")throw new Y(`Composer could not find a composer.json file in ${r}`);const u=me(a??"{}",s),d=Ws(u);if(d)throw new Y(d);for(const y of["require","require-dev","replace","provide","conflict"])for(const g of Object.keys(u[y]??{}))te(g,`composer.json ${y}`);const $=(()=>{const y=n.read(o);if(y===void 0)return{packages:[],devNames:[]};const g=me(y,o);for(const S of g.packages??[])Ye(S.name,o);return{packages:g.packages??[],devNames:g["dev-package-names"]??[]}})();if(e.command==="dump-autoload"){const{packages:y,devNames:g}=$,S=new Set(g);return Rt(n,r,u,c?y:y.filter(T=>!S.has(T.name)),{dev:c,devPackages:c?S:new Set}),t.out(`Generating autoload files
Generated autoload files
`),0}const f={minimumStability:Jn(u["minimum-stability"]),preferStable:!!u["prefer-stable"]};if(e.command==="require"){const y=e.dev?"require-dev":"require";for(const{name:g,constraint:S}of Ot(e.packages)){let T=S;if(!T){const R=await t.source.versions(g),L=R?.filter(In=>e.ignorePlatformReqs||!qe({},[In],!1,t.platform).length),C=L&&Ct(L,[],f),K=!C&&R&&Ct(R,[],f);if(K)throw new V(`${K.name} ${K.version} is declined: ${qe({},[K],!1,t.platform).join("; ")}`);const pe=C&&st(C.version_normalized??C.version);if(!pe||pe.branch)throw new V(`Could not find a stable version of package ${g}.`);T=`^${pe.parts[0]}.${pe.parts[1]}`}u[y]={...u[y],[g]:T},t.err(`./composer.json has been updated (${g}: ${T})
`)}}const p=`${JSON.stringify(u,null,4)}
`;let _=e.command==="install"&&l!==void 0?me(l,i):void 0,v=!1;if(_){t.err("Installing dependencies from lock file"+(c?" (including require-dev)":"")+`
`);for(const y of[..._.packages??[],..._["packages-dev"]??[]])Ye(y.name,i);_["content-hash"]&&_["content-hash"]!==await t.contentHash(a??p)&&t.err("Warning: The lock file is not up to date with the latest changes in composer.json. Run `composer update`.\n")}else{t.err(e.command==="install"?`No composer.lock file present. Updating dependencies to latest instead of installing from lock file.
`:`Updating dependencies
`);const y=e.command==="require"?Ot(e.packages).map(C=>C.name):e.packages.map(C=>te(C,"composer update")),g=y.length&&l!==void 0?me(l,i):void 0,S=new Map([...g?.packages??[],...g?.["packages-dev"]??[]].filter(C=>!y.includes(C.name)).map(C=>[C.name,C.version])),T=await zs(Qs(u,!1),t.source,{...f,preferred:S,platform:e.ignorePlatformReqs?void 0:t.platform},u);for(const C of T.packages.values())t.err(`  - Locking ${C.name} (${C.version})
`);const R=Hs(u,T.packages),L=[...T.packages.values()].sort((C,K)=>C.name.localeCompare(K.name));_={"content-hash":await t.contentHash(p),packages:L.filter(C=>R.has(C.name)),"packages-dev":L.filter(C=>!R.has(C.name))},v=!0}const m=[..._.packages??[],...c?_["packages-dev"]??[]:[]],w=new Set(c?(_["packages-dev"]??[]).map(y=>y.name):[]),E=e.ignorePlatformReqs?[]:qe(u,m,c,t.platform);if(E.length)throw new Y(`Your requirements could not be resolved to an installable set of packages.
${E.map(y=>`  - Declined: ${y}`).join(`
`)}`);e.command==="require"&&n.write(s,p),v&&(n.write(i,Vs(_,f)),t.err(`Writing lock file
`));const N=new Map($.packages.map(y=>[y.name,y])),k=(y,g)=>!!y&&y.version===g.version&&(y.dist?.reference??null)===(g.dist?.reference??null)&&n.isDir(De(r,g.name)),D=m.filter(y=>!k(N.get(y.name),y)),x=[...N.keys()].filter(y=>!m.some(g=>g.name===y));t.err(`Package operations: ${D.length} install${D.length===1?"":"s"}, 0 updates, ${x.length} removal${x.length===1?"":"s"}
`);const I=[];for(const y of D){t.err(`  - Downloading ${y.name} (${y.version})
`);const g=await t.source.files(y);for(const S of g.keys())if(S.split("/").some(T=>T===".."||T==="."||T===""))throw new Y(`${y.name} ${y.version} holds a file outside its directory ("${S}").`);I.push([y,g])}for(const y of x)n.remove(De(r,y)),t.err(`  - Removing ${y}
`);for(const[y,g]of I){const S=De(r,y.name);t.err(`  - Installing ${y.name} (${y.version})
`),n.remove(S);for(const[T,R]of g)n.write(A(S,T),R);y.type==="composer-plugin"&&t.err(`    ${y.name} is a Composer plugin; plugins do not run in the PHP runtime.
`)}!D.length&&!x.length&&t.err(`Nothing to install, update or remove
`),t.err(`Generating autoload files
`),Rt(n,r,u,m,{dev:c,devPackages:w});const M=Ks.filter(y=>u.scripts?.[y]!==void 0);return M.length&&t.err(`Composer scripts do not run in the PHP runtime (${M.join(", ")}); run their commands yourself if needed.
`),0}catch(u){(e.command==="require"||e.command==="update")&&(a===void 0?n.remove(s):n.read(s)!==a&&n.write(s,a),l===void 0?n.remove(i):n.read(i)!==l&&n.write(i,l));const d=u instanceof V||u instanceof Y||u instanceof dt,h=u instanceof V?`Your requirements could not be resolved to an installable set of packages.
  `:"";return t.err(`${h}${u instanceof Error?u.message:String(u)}
`),d?2:1}}const Js="https://packagist.org/packages/{name}.json",Xs="https://cdn.jsdelivr.net/gh/",Zs="https://data.jsdelivr.com/v1/packages/gh/";function ei(e){const t=[];let n={};for(const r of e){const s={...n};for(const[i,o]of Object.entries(r))o==="__unset"?delete s[i]:s[i]=o;t.push(s),n=s}return t}function ti(e,t){const n=t;if(n.package?.versions)return Object.values(n.package.versions).map(s=>({...s,name:e}));const r=n.packages?.[e];if(Array.isArray(r))return(n.minified?ei(r):r).map(s=>({...s,name:e}));if(r)return Object.values(r).map(s=>({...s,name:e}))}function It(e){const t=e&&/^https:\/\/(?:api\.)?github\.com\/(?:repos\/)?([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/.exec(e);return t?{owner:t[1],repo:t[2]}:void 0}const J={maxEntries:5e4,maxTotalBytes:256*1024*1024,maxEntryBytes:64*1024*1024},Xe=128*1024*1024;class j extends Error{}function ni(e){const t=new Jt;try{$r(t,e,"/",J)}catch(o){throw o instanceof hr?new j(o.message):o}const n=t.list(),r=new Set(n.map(o=>o.split("/")[1])),s=r.size===1&&n.every(o=>o.split("/").length>2)?`/${[...r][0]}/`:"/",i=new Map;for(const o of n){const a=t.readFile(o);i.set(o.slice(s.length),typeof a=="string"?new TextEncoder().encode(a):a??new Uint8Array)}return i}async function Ze(e,t){const n=await e(t);if(!n.ok)throw new Error(`GET ${t}: ${n.status} ${n.statusText}`);return n}async function Pe(e,t,n){const r=Number(e.headers.get("content-length"));if(r>t)throw new j(`${n} is ${r} bytes, over the ${t}-byte limit.`);if(!e.body)return new Uint8Array(await e.arrayBuffer());const s=e.body.getReader(),i=[];let o=0;for(;;){const{value:c,done:u}=await s.read();if(u)break;if(o+=c.byteLength,o>t)throw await s.cancel(),new j(`${n} exceeds the ${t}-byte limit.`);i.push(c)}const a=new Uint8Array(o);let l=0;for(const c of i)a.set(c,l),l+=c.byteLength;return a}async function ri(e,t,n){if(!t)return;const s=[...new Uint8Array(await crypto.subtle.digest("SHA-1",e))].map(i=>i.toString(16).padStart(2,"0")).join("");if(s!==t.toLowerCase())throw new j(`${n}: checksum mismatch (sha1 ${s}, metadata says ${t}).`)}function si(e,t){let n;try{n=new URL(e)}catch{throw new j(`${t}: dist URL "${e}" is not an absolute URL.`)}const r=n.hostname==="localhost"||n.hostname==="[::1]"||/^127\./.test(n.hostname);if(n.protocol!=="https:"&&!(n.protocol==="http:"&&r))throw new j(`${t}: dist URL "${e}" is not https.`)}const ii=/^[A-Za-z0-9._-]+$/;async function oi(e,t,n,r){if(![t,n,r].every(l=>ii.test(l)))throw new j(`Refusing GitHub source ${t}/${n}@${r}: not a plain repository and commit.`);const i=(JSON.parse(new TextDecoder().decode(await Pe(await Ze(e,`${Zs}${t}/${n}@${r}?structure=flat`),Xe,"The jsDelivr listing"))).files??[]).map(l=>l.name);if(i.length>J.maxEntries)throw new j(`${t}/${n} has ${i.length} files, over the ${J.maxEntries}-entry limit.`);for(const l of i)if(!l.startsWith("/")||l.split("/").some(c=>c===".."||c==="."))throw new j(`Refusing file "${l}" in ${t}/${n}.`);const o=new Map;let a=0;for(let l=0;l<i.length;l+=8)await Promise.all(i.slice(l,l+8).map(async c=>{const u=await Pe(await Ze(e,`${Xs}${t}/${n}@${r}${c.split("/").map(encodeURIComponent).join("/")}`),J.maxEntryBytes,c);if(a+=u.byteLength,a>J.maxTotalBytes)throw new j(`${t}/${n} exceeds the ${J.maxTotalBytes}-byte limit.`);o.set(c.slice(1),u)}));return o}function ai(e={}){const t=e.fetch??((s,i)=>fetch(s,i)),n=e.repositoryUrl??Js,r=new Map;return{versions(s){let i;try{i=te(s,"a package request")}catch(a){return Promise.reject(a)}let o=r.get(i);return o||(o=(async()=>{const a=await t(n.replace("{name}",Bs(i)));if(a.status!==404){if(!a.ok)throw new Error(`Package metadata for ${i}: ${a.status} ${a.statusText}`);return ti(i,JSON.parse(new TextDecoder().decode(await Pe(a,Xe,`Package metadata for ${i}`))))}})(),r.set(i,o)),o},async files(s){const i=s.dist,o=It(i?.url)??It(s.source?.url??void 0),a=i?.reference??s.source?.reference,l=`${s.name} ${s.version}`;if(i?.url&&(i.type??"zip")==="zip"){si(i.url,l);const c=e.distProxy?`${e.distProxy}${encodeURIComponent(i.url)}`:i.url;let u;try{u=await Ze(t,c)}catch(d){if(!o||!a||e.distProxy)throw d}if(u){const d=await Pe(u,Xe,l);return await ri(d,i.shasum,l),ni(d)}}if(o&&a)return oi(t,o.owner,o.repo,a);throw new Error(`${l} has no zip dist or GitHub source the PHP runtime can fetch.`)}}}const fn=e=>e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength);function li(e){const t=e.getReader();return new ReadableStream({async pull(n){const{value:r,done:s}=await t.read();if(s)return n.close();const i=fn(r);i.byteLength&&n.enqueue(i.slice())},cancel:n=>t.cancel(n)})}async function pn(e,t){const n=e.getReader();for(;;){const{value:r,done:s}=await n.read();if(s)return;const i=fn(r);i.byteLength&&t(i.slice())}}async function $n(e,t){const n=new TextDecoder;await pn(e,s=>{const i=n.decode(s,{stream:!0});i&&t(i)});const r=n.decode();r&&t(r)}const ge="/bfwc/php-server-front.php",hn="x-bfwc-router-declined";function ci(e){return["<?php",...Object.entries(e).map(([n,r])=>`ini_set(${Ke(n)}, ${Ke(r)});`),"if (($_SERVER['HTTPS'] ?? '') === 'off') unset($_SERVER['HTTPS']);","if ((require $_SERVER['SCRIPT_FILENAME']) === false && !headers_sent()) header('X-Bfwc-Router-Declined: 1');",""].join(`
`)}const ui=e=>/\.[^/]+$/.test(e);function di(e,t,n){const r=rt(e),s=l=>l==="/"?t:A(t,l),i=(l,c,u)=>l.endsWith(".php")?{kind:"script",file:l,scriptName:c,pathInfo:u}:{kind:"file",file:l},o=l=>["index.php","index.html"].map(c=>({url:A(l,c),file:A(s(l),c)})).find(({file:c})=>n.isFile(c));if(n.isFile(s(r)))return i(s(r),r);if(n.isDir(s(r))){const l=o(r);if(l)return i(l.file,l.url)}const a=r.split("/").filter(Boolean);for(let l=a.length-1;l>0;l--){const c=`/${a.slice(0,l).join("/")}`;if(c.endsWith(".php")&&n.isFile(s(c)))return i(s(c),c,`/${a.slice(l).join("/")}`)}if(ui(r))return{kind:"missing"};for(let l=a.length;l>=0;l--){const c=`/${a.slice(0,l).join("/")}`;if(!n.isDir(s(c)))continue;const u=o(c);if(u)return i(u.file,u.url,r===c?void 0:r.slice(c==="/"?0:c.length)||void 0)}return{kind:"missing"}}const Dt=e=>({status:404,headers:{"content-type":"text/html; charset=UTF-8"},body:Yt(new TextEncoder().encode(`<!doctype html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested resource <code>${e.replace(/[<>&"]/g,"")}</code> was not found on this server.</p></body></html>`))});function fi(e){const t={};for(const[n,r]of Object.entries(e)){const s=n.toLowerCase();s===hn||!r.length||(t[s]=r.length===1?r[0]:[...r])}return t}async function pi(e,t){const{php:n,files:r,docroot:s,router:i}=t;r.mkdirTree(ge.slice(0,ge.lastIndexOf("/"))),r.write(ge,ci(e.ini)),n.chdir(s);const o=e.host.replace(/^\[|\]$/g,""),a=`${o.includes(":")?`[${o}]`:o}:${e.port}`,l=async(d,h)=>{const $=d.url.includes("?")?d.url.slice(d.url.indexOf("?")+1):"",f={DOCUMENT_ROOT:s,SCRIPT_FILENAME:h.file,SCRIPT_NAME:h.scriptName,PHP_SELF:h.scriptName+(h.pathInfo??""),SERVER_NAME:o,SERVER_PORT:String(e.port),SERVER_PROTOCOL:"HTTP/1.1",SERVER_SOFTWARE:`PHP ${t.phpVersion} Development Server (php-wasm, BuilderForce WebContainers)`,REMOTE_ADDR:"127.0.0.1",QUERY_STRING:$};return h.pathInfo&&(f.PATH_INFO=h.pathInfo),n.runStream({scriptPath:ge,relativeUri:d.url,method:d.method.toUpperCase(),headers:{host:a,...d.headers},protocol:"http",body:d.body??void 0,env:t.env,$_SERVER:f})},c=async(d,h,$)=>{if($.kind==="missing")return Dt(h);if($.kind==="file")return{status:200,headers:{"content-type":mr(Xn($.file))},body:Yt(r.read($.file))};const f=await l(d,$);$n(f.stderr,t.log).catch(()=>{});const[p,_]=await Promise.all([f.httpStatusCode,f.headers]);return _[hn]?.length?(f.stdout.cancel(),"declined"):{status:p,headers:fi(_),body:li(f.stdout)}};return{spec:e,handle:async d=>{const h=d.url.split("?")[0].split("#")[0];let $;try{$=decodeURIComponent(h)||"/"}catch{return vt(400,"Bad Request")}try{let f=i?await c(d,$,{kind:"script",file:i,scriptName:i.startsWith(`${s}/`)?i.slice(s.length):`/${i.split("/").pop()}`}):"declined";return f==="declined"&&(f=await c(d,$,di($,s,r)),f==="declined"&&(f=Dt($))),t.log(`[${f.status}]: ${d.method.toUpperCase()} ${d.url}
`),f}catch(f){const p=f instanceof Error?f.message:String(f);return t.log(`[500]: ${d.method.toUpperCase()} ${d.url} - ${p}
`),vt(500,`PHP failed to handle the request: ${p}`)}}}}const le=Oe;function $i(e){const t=r=>ot(e,r).flatMap(s=>le(e,A(r,s))?t(A(r,s)):[A(r,s)]);return{read:r=>ze(e,r)?new TextDecoder().decode(e.readFile(r)):void 0,write(r,s){e.mkdirTree(Re(r)),e.writeFile(r,s)},isDir:r=>le(e,r),list:r=>le(e,r)?t(r):[],remove:r=>ke(e,r)}}async function mn(e,t){const n=await e.php.run({code:t});if(n.exitCode!==0)throw new Error(`PHP failed: ${n.errors||n.text}`);return n.text}const hi=e=>`<?php
$c = json_decode(base64_decode('${gr(new TextEncoder().encode(e))}'), true) ?: [];
$keys = ['name', 'version', 'require', 'require-dev', 'conflict', 'replace', 'provide', 'minimum-stability', 'prefer-stable', 'repositories', 'extra'];
$r = array_intersect_key($c, array_flip($keys));
if (isset($c['config']['platform'])) { $r['config']['platform'] = $c['config']['platform']; }
ksort($r);
echo md5(json_encode($r));`;async function gn(e,t){const[n,r]=JSON.parse(await mn(e,'<?php echo json_encode([PHP_VERSION, array_map("strtolower", get_loaded_extensions())]);')),s={phpVersion:n,extensions:new Set(r)};return t.platformKnown?.(s),s}async function mi(e,t,n){const r=await gn(e,n),s=t.workingDir?B(n.cwd,t.workingDir):n.cwd;return Ys(t,{files:$i(e.module.FS),source:ai({...n.composer,fetch:n.fetch}),platform:r,projectDir:s,contentHash:i=>mn(e,hi(i)),out:i=>n.io.stdout(i),err:i=>n.io.stderr(i)})}async function gi(e,t,n){const{php:r,module:s}=e;if(t.kind==="composer")return{kind:"exited",code:await mi(e,t,n)};if(t.kind==="serve"){await r.setSapiName("cli-server");const o=(await gn(e,n)).phpVersion,a=t.server.docroot?B(n.cwd,t.server.docroot):n.cwd;if(!le(s.FS,a))return n.io.stderr(`Directory ${t.server.docroot} does not exist.
`),{kind:"exited",code:1};const l=t.server.router?B(n.cwd,t.server.router):void 0;if(l&&!ze(s.FS,l))return n.io.stderr(`Could not open input file: ${t.server.router}
`),{kind:"exited",code:1};const c=await pi(t.server,{php:r,files:{isFile:u=>ze(s.FS,u),isDir:u=>le(s.FS,u),read:u=>s.FS.readFile(u),write:(u,d)=>s.FS.writeFile(u,d),mkdirTree:u=>s.FS.mkdirTree(u)},docroot:a,router:l,env:{...n.env},log:u=>n.io.stderr(u),phpVersion:o});return{kind:"serving",server:{port:c.spec.port,handle:c.handle,close:async()=>{}},banner:`[${new Date().toUTCString()}] PHP ${o} Development Server (http://${t.server.host}:${t.server.port}) started (request-driven)
`}}const i=await r.cli(["php",...t.argv],{env:{...n.env}});return await Promise.all([pn(i.stdout,o=>n.io.stdout(o)),$n(i.stderr,o=>n.io.stderr(o))]),{kind:"exited",code:await i.exitCode}}const _i=String.raw`<?php
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
`,yi=String.raw`<?php
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
`,wi=String.raw`<?php
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
`,bi=String.raw`<?php
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
`,vi=String.raw`<?php
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
`,Ei=String.raw`<?php
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
`,Si=String.raw`<?php
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
`,ki=String.raw`<?php
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
`,ce="/bfwc",Le="/internal/shared/auto_prepend_file.php",Pi=`<?php
spl_autoload_register(static function (string $class): void {
    // Class names are case-insensitive: keys are lower-case, and so is the lookup (PDOPgsql finds pdopgsql).
    static $files = ['bfwc\\pgsql\\wire' => 'wire.php', 'bfwc\\pgsql\\exception' => 'wire.php', 'bfwc\\pgsql\\pdo' => 'pdo.php', 'bfwc\\pgsql\\statement' => 'statement.php', 'bfwc\\pgsql\\rewriter' => 'rewriter.php', 'pdo\\pgsql' => 'pdo-pgsql.php', 'bfwc\\pgsql\\pg' => 'pg.php', 'pgsql\\connection' => 'pg.php', 'pgsql\\result' => 'pg.php'];
    $file = $files[strtolower($class)] ?? null;
    if ($file !== null) {
        require_once '${ce}/pgsql/' . $file;
    }
});
require_once '${ce}/pgsql/includes.php';
if (!function_exists('pg_connect')) {
    require_once '${ce}/pgsql/functions.php';
}
\\Bfwc\\Pgsql\\Includes::register();
if (\\Bfwc\\Pgsql\\Includes::rewritesPrimary()) {
    require \\Bfwc\\Pgsql\\Includes::$primary;
    exit;
}
`,Ti={"prepend.php":Pi,"pgsql/wire.php":ki,"pgsql/pdo.php":wi,"pgsql/statement.php":Si,"pgsql/includes.php":_i,"pgsql/rewriter.php":Ei,"pgsql/functions.php":bi,"pgsql/pg.php":vi,"pgsql/pdo-pgsql.php":yi};function Ri(e){for(const[r,s]of Object.entries(Ti)){const i=`${ce}/${r}`;e.mkdirTree(i.slice(0,i.lastIndexOf("/"))),e.writeFile(i,s)}const t=`
require_once '${ce}/prepend.php';
`,n=fe(e,Le)?new TextDecoder().decode(e.readFile(Le)):`<?php
`;n.includes(t)||e.writeFile(Le,`${n.replace(/\?>\s*$/,"")}${t}`)}const Oi=e=>/^127\./.test(e)||e==="0.0.0.0"||e==="::1"||e==="localhost",Ni=/^bfwc-tcp:\/\/\[?([^\]]*)\]?:(\d+)$/,Me=0,Ue=1,qt=2,re=3;function Ai(e){return class{url;CONNECTING=Me;OPEN=Ue;CLOSING=qt;CLOSED=re;readyState=Me;binaryType="arraybuffer";onopen=null;onmessage=null;onclose=null;onerror=null;listeners=new Map;channel;constructor(n){this.url=n;const r=Ni.exec(n),s=r?.[1]??"",i=Number(r?.[2]);if(!r||!Oi(s)){queueMicrotask(()=>this.fail());return}e(i).then(o=>{if(!o)return this.fail();if(this.readyState!==Me)return o.close();this.channel=o,this.readyState=Ue,o.onData(a=>this.emit("message",a)),o.onClose(()=>this.ended()),this.emit("open")},()=>this.fail())}send(n){if(this.readyState!==Ue||!this.channel)return;const r=n instanceof ArrayBuffer?new Uint8Array(n):new Uint8Array(n.buffer,n.byteOffset,n.byteLength);this.channel.send(r.slice())}setSocketOpt(){}close(){this.readyState===qt||this.readyState===re||(this.channel?.close(),this.ended())}on(n,r){return this.add(n,r,!1,!1)}once(n,r){return this.add(n,r,!0,!1)}addEventListener(n,r){this.add(n,r,!1,!0)}removeListener(n,r){return this.listeners.set(n,(this.listeners.get(n)??[]).filter(s=>s.listener!==r)),this}off(n,r){return this.removeListener(n,r)}removeEventListener(n,r){this.removeListener(n,r)}add(n,r,s,i){return this.listeners.set(n,[...this.listeners.get(n)??[],{listener:r,once:s,dom:i}]),this}emit(n,r){const s=this.listeners.get(n)??[];this.listeners.set(n,s.filter(l=>!l.once));const i=r?r.slice().buffer:void 0,o={type:n,target:this,data:i};for(const{listener:l,dom:c}of s)c?l(o):r?l(r,!0):l();const a={open:this.onopen,message:this.onmessage,close:this.onclose,error:this.onerror}[n];a?.(o)}ended(){this.readyState!==re&&(this.readyState=re,this.channel=void 0,queueMicrotask(()=>this.emit("close")))}fail(){this.readyState!==re&&(this.emit("error"),this.ended())}}}function Ci(e,t){const n=e.websocket??={};n.url=(s,i,o)=>`bfwc-tcp://${i.includes(":")?`[${i}]`:i}:${o}`,n.subprotocol="binary";const r=Ai(t);n.decorator=()=>r}const xi=(e,t)=>`[${new Date().toUTCString()}] Failed to listen on ${e}:${t} (reason: Address already in use)
`;function Yo(e){const t=e.dial?void 0:it(e.post),n=e.dial??(s=>t.dial(s));let r="localhost";return ct(e.post,s=>{async function i(a,l){const c=await e.loadPhp({baseUrl:a.php?.baseUrl,phpVersion:_t(a.php?.phpVersion)});Ci(c.module,n),Ri(c.module.FS),at(l,c.module.FS);const u=ln(c.module.FS,d=>{s.exited||e.post({type:"fs",ops:d})});return s.mounted({apply:d=>u.quietly(()=>lt(c.module.FS,d)),flush:()=>u.flush()}),c.php.chdir(q(a.cwd)),c}async function o(a,l,c,u){const d=await i(a,c);return u.exited?{kind:"exited",code:0}:gi(d,l,{cwd:q(a.cwd),env:a.env,io:u.io,composer:a.php?.composer,fetch:e.fetch,platformKnown:h=>e.post({type:"php-platform",phpVersion:h.phpVersion,extensions:[...h.extensions]})})}return{addressInUse:a=>xi(r,a),plan(a){const l=Zn(a.command,a.args);if(!l.ok)return{ok:!1,message:`${a.command}: ${l.reason}
`,code:1};try{_t(a.php?.phpVersion)}catch(u){return{ok:!1,message:`${u.message}
`,code:1}}const c=er(l.invocation,q);return c.kind==="serve"&&(r=c.server.host),{ok:!0,port:c.kind==="serve"?c.server.port:void 0,run:u=>o(a,c,u,s)}},receive:a=>!!t?.receive(a)}})}function Ii(e){return[...e.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(t=>t[1]??t[2]??t[3])}function Di(e,t,n,r){if(n===null)return{ok:!0};const s=A(t,"Properties","launchSettings.json"),i=e(s);if(i===void 0)return n?{ok:!1,reason:`The launch profile "${n}" could not be applied: ${s} does not exist.`}:{ok:!0};let o;try{o=JSON.parse(i).profiles??{}}catch(d){return{ok:!1,reason:`A JSON parsing exception occurred in ${s}: ${d.message}`}}const a=n?Object.entries(o).find(([d])=>d===n):Object.entries(o).find(([,d])=>d.commandName==="Project");if(!a)return n?{ok:!1,reason:`The launch profile "${n}" could not be applied: it is not in ${s}.`}:{ok:!0};const[l,c]=a,u={};for(const[d,h]of Object.entries(c.environmentVariables??{}))u[d]=String(h);return c.applicationUrl&&r.ASPNETCORE_URLS===void 0&&u.ASPNETCORE_URLS===void 0&&(u.ASPNETCORE_URLS=c.applicationUrl),{ok:!0,profile:{name:l,env:u,args:c.commandLineArgs?Ii(c.commandLineArgs):[]}}}class U extends Error{name="DotnetBundleError"}const qi="/dotnet/refs",Lt="bfwc-dotnet-",_n=e=>e.endsWith("/")?e:`${e}/`,Li=e=>e instanceof Error?e.message:String(e);async function pt(e){const t=new Uint8Array(await crypto.subtle.digest("SHA-256",e));return Array.from(t,n=>n.toString(16).padStart(2,"0")).join("")}function Mi(e){const t=e.Bfwc?.Host?.Exports;if(!t)throw new U("The .NET runtime bundle has no Bfwc.Host.Exports: it was not built from dotnet-host/.");return t}async function et(e,t,n){try{return await e(t,n)}catch(r){throw new U(`The .NET runtime bundle could not be reached (${t}: ${Li(r)}).`)}}async function yn(e,t){const n=`${_n(e)}manifest.json`,r=await et(t,n);if(!r.ok)throw new U(`The .NET runtime bundle's manifest could not be loaded (${n}: HTTP ${r.status}).`);const s=await r.text();let i;try{i=JSON.parse(s)}catch{throw new U(`The .NET runtime bundle's manifest (${n}) is not JSON.`)}if(i?.format!==yt.format)throw new U(`The .NET runtime bundle at ${e} is format ${String(i?.format)}; this runtime reads format ${yt.format}. Rebuild it with scripts/build-dotnet-runtime.mjs.`);return{manifest:i,text:s}}async function Ui(e,t=fetch){return(await yn(e,t)).manifest}async function ji(e,t){const n=globalThis.caches;if(!n)return(i,o)=>et(t,i,o);const r=`${Lt}${(await pt(new TextEncoder().encode(e))).slice(0,32)}`;let s;try{s=await n.open(r);for(const i of await n.keys())i.startsWith(Lt)&&i!==r&&n.delete(i)}catch{s=void 0}return async(i,o)=>{const a=await s?.match(i).catch(()=>{});if(a)return a;const l=await et(t,i,o);return l.ok&&s&&await s.put(i,l.clone()).catch(()=>{}),l}}async function Mt(e,t,n,r){const s=n.files?.[r];if(!s)throw new U(`The .NET runtime bundle's manifest has no hash for ${r}: rebuild it with scripts/build-dotnet-runtime.mjs.`);const i=await e(new URL(r,t).href);if(!i.ok)throw new U(`${r} of the .NET runtime bundle could not be loaded (HTTP ${i.status}).`);const o=new Uint8Array(await i.arrayBuffer());if(await pt(o)!==s)throw new U(`${r} of the .NET runtime bundle does not match its manifest's hash: refusing it.`);return o}async function Fi(e,t,n){const r=[];for(const s of n){const{offset:i,length:o}=s;if(!(Number.isSafeInteger(i)&&Number.isSafeInteger(o)&&i>=0&&o>=0&&i+o<=t.byteLength)||!/^[\w.-]+\.dll$/i.test(s.name))throw new U(`The "${e}" reference pack's entry ${JSON.stringify(s.name)} is out of bounds or misnamed: refusing it.`);const l=t.subarray(i,i+o);if(await pt(l)!==s.sha256)throw new U(`${e}/${s.name} does not match its manifest's hash: refusing it.`);r.push({name:s.name,bytes:l})}return r}async function Jo(e){const t=e.fetch??((f,p)=>fetch(f,p)),n=_n(e.bundleUrl),{manifest:r,text:s}=await yn(n,t),i=await ji(s,t);await Mt(i,n,r,r.entry);const o=e.importModule??(f=>import(f)),{dotnet:a}=await o(new URL(r.entry,n).href);let l=a.withEnvironmentVariables(e.env).withModuleConfig({onExit:f=>e.onExit?.(f)});globalThis.caches&&(l=l.withResourceLoader((f,p,_,v)=>f==="dotnetjs"?void 0:i(_,v?{integrity:v}:void 0)));const c=await l.create();c.setModuleImports("bfwc",e.imports);const u=Mi(await c.getAssemblyExports(r.assembly)),d=c.Module.FS,h=new Map;async function $(f){const p=h.get(f);if(p)return p;const _=r.references[f];if(!_)throw new U(`The .NET runtime bundle has no "${f}" reference assemblies.`);const v=await Fi(f,await Mt(i,n,r,_.pack),_.files),m=`${qi}/${f}`;d.mkdirTree(m);const w=new Map;for(const E of v){const N=`${m}/${E.name}`;d.writeFile(N,E.bytes),w.set(`${f}/${E.name}`,N)}return h.set(f,w),w}return{exports:u,FS:d,manifest:r,async mountReferences(f){const p=new Map;for(const _ of new Set(f))for(const[v,m]of await $(_))p.set(v,m);return p}}}function Gi(e){const t={};for(const[n,r]of Object.entries(JSON.parse(e)))t[n.toLowerCase()]=r.length===1?r[0]:r;return t}function Bi(e){let t;const n=new Set,r=new Map,s=new Map;let i=1,o=1;const a=c=>u=>new Promise((d,h)=>{if(!t)return h(new Error("The .NET runtime is not running."));const $=i++;r.set($,{resolve:d,reject:h}),t.Request($,c,u.method,u.url,JSON.stringify(u.headers),u.body??new Uint8Array(0))});return{imports:{stdout:c=>e.stdout(c),stderr:c=>e.stderr(c),listen(c){return e.taken.has(c)&&!n.has(c)?!1:(e.taken.add(c),n.add(c),e.post({type:"listen",port:c}),!0)},unlisten(c){n.delete(c)&&(e.taken.delete(c),e.post({type:"unlisten",port:c}))},respondHead(c,u,d){const h=r.get(c);if(!h)return;const $=new ReadableStream({start:f=>{h.body=f},cancel:()=>{r.delete(c),t?.CancelRequest(c)}});h.resolve({status:u,headers:Gi(d),body:$})},respondChunk(c,u){r.get(c)?.body?.enqueue(u.slice())},respondEnd(c,u){const d=r.get(c);if(r.delete(c),!!d){if(!d.body)return d.reject(new Error(u??"The response ended before its head."));u?d.body.error(new Error(u)):d.body.close()}},async dial(c){const u=await e.dial(c);if(!u)return-1;const d=o++;return s.set(d,u),u.onData(h=>s.has(d)&&t?.TcpData(d,h)),u.onClose(()=>{s.delete(d)&&t?.TcpClosed(d)}),d},send(c,u){s.get(c)?.send(u.slice())},hangUp(c){const u=s.get(c);s.delete(c),u?.close()}},listening:n,handlerFor:c=>n.has(c)?a(c):void 0,attach(c){t=c},stop(){t?.Stop()},closeAll(){for(const c of r.values())c.body?c.body.error(new Error("The process exited.")):c.reject(new Error("The process exited."));r.clear();for(const c of s.values())c.close();s.clear()}}}const Wi={DOTNET_CLI_TELEMETRY_OPTOUT:"1",DOTNET_NOLOGO:"1",DOTNET_SKIP_FIRST_TIME_EXPERIENCE:"1"},wn=e=>e.outputInProject?q(e.outputPath):e.outputPath;function Hi(e,t){const n=`Microsoft.AspNetCore.App ${t.runtimeVersion} [browser]
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
`}}function je(e,t){const n="configuration"in t?t.configuration:"Debug";if(t.kind==="run"&&t.file)return wt(e.files,B(e.cwd,t.file),n);const r=nr(e.files,e.cwd,t.project,t.kind==="run"?"run":"build");return r.ok?wt(e.files,r.path,n,t.kind==="build"?t.output:void 0):r}async function Vi(e,t){const{io:n}=t,r=i=>(n.stderr(`${i}
`),{kind:"done",code:1}),s={...Wi,...t.env};switch(e.kind){case"info":return n.stdout(Hi(e.what,await t.manifest())),{kind:"done",code:0};case"exec":return{kind:"runtime",work:{env:s,run:{assembly:q(B(t.cwd,e.assembly)),args:e.appArgs,cwd:q(t.cwd)}}};case"restore":case"clean":{const i=je(t,e);if(!i.ok)return r(i.reason);if(e.kind==="clean"){const o=tr(i.plan);if(!o.ok)return r(o.reason);const a=o.paths.filter(l=>t.files.isFile(l));a.length&&t.sendOps(a.map(l=>({op:"remove",path:l}))),n.stdout(a.length?a.map(l=>`  Deleting file "${l}".
`).join(""):`  Nothing to clean in ${Re(i.plan.outputPath)}.
`)}else{for(const o of i.plan.notes)n.stdout(`  ${o}
`);n.stdout(`  Restore complete: ${i.plan.projectFile} uses ${i.plan.packages.length?"bundled packages only":"no NuGet packages"}.
`)}return{kind:"done",code:0}}case"build":{const i=je(t,e);return i.ok?{kind:"runtime",work:{env:s,build:i.plan}}:r(i.reason)}case"run":{const i=je(t,e);if(!i.ok)return r(i.reason);const o=i.plan;if(o.outputKind!=="exe")return r(`Unable to run your project.
Ensure you have a runnable project type and ensure '${o.projectFile}' supports running: its OutputType is Library.`);const a=o.fileBased?{ok:!0}:Di(c=>t.files.readText(c),o.projectDir,e.launchProfile,s);if(!a.ok)return r(a.reason);const l=o.web?o.projectDir:t.cwd;return{kind:"runtime",work:{env:{...s,...a.profile?.env},build:e.noBuild?void 0:o,run:{assembly:wn(o),args:[...a.profile?.args??[],...e.appArgs],cwd:q(l)}}}}}}function zi(e,t,n,r=!1){const s=new Set;for(const i of e.referenceGroups)for(const o of n.references[i]?.files??[])s.add(t.get(`${i}/${o.name}`));for(const i of e.packages)for(const o of n.packages[i]?.references??[])t.has(o)&&s.add(t.get(o));return JSON.stringify({projectFile:q(e.projectFile),projectDir:q(e.projectDir),assemblyName:e.assemblyName,outputKind:e.outputKind,outputPath:wn(e),sources:e.sources.map(q),globalUsings:e.globalUsings,references:[...s].filter(Boolean),nullable:e.nullable,allowUnsafe:e.allowUnsafe,langVersion:e.langVersion,fileBased:e.fileBased,defines:e.defines,optimize:e.optimize,warningsAsErrors:e.warningsAsErrors,noWarn:e.noWarn,quiet:r})}async function Qi(e,t,n){if(e.build){const r=e.build;for(const a of r.notes)n.stdout(`  ${a}
`);const s=[...r.referenceGroups,...r.packages.flatMap(a=>(t.manifest.packages[a]?.references??[]).map(l=>l.split("/")[0]))],i=await t.mountReferences(s),o=await t.exports.Build(zi(r,i,t.manifest,!!e.run));if(o!==0)return e.run&&n.stderr(`
The build failed. Fix the build errors and run again.
`),o}return e.run?t.exports.Run(e.run.assembly,e.run.args,e.run.cwd):0}const Ut="The .NET runtime bundle is not configured: the host must pass `dotnet.bundleUrl` (build it with scripts/build-dotnet-runtime.mjs).",Ki=e=>`Unhandled exception. System.IO.IOException: Failed to bind to address http://localhost:${e}: address already in use.
`;function Xo(e){const t=e.dial?void 0:it(e.post),n=e.dial??(r=>t.dial(r));return ct(e.post,r=>{const s={stdout:l=>r.io.stdout(l),stderr:l=>r.io.stderr(l)},i=Bi({post:e.post,dial:n,taken:r.takenPorts,...s});async function o(l,c,u,d){const h=await e.loadDotnet({bundleUrl:l,env:c,imports:i.imports,onExit:f=>r.exit(f),fetch:e.fetch});at(d,h.FS);const $=ln(h.FS,f=>{r.exited||e.post({type:"fs",ops:f})});return r.mounted({apply:f=>$.quietly(()=>lt(h.FS,f)),flush(){try{h.exports.Flush()}catch{}$.flush()}}),h.exports.Init(),i.attach(h.exports),h.FS.mkdirTree(q(u)),h}const a=l=>{if(!(l instanceof U))throw l;return s.stderr(`${l.message}
`),1};return{addressInUse:Ki,receive:l=>!!t?.receive(l),plan(l){const c=rr(l.command,l.args);if(!c.ok)return{ok:!1,message:`${c.reason}
`,code:1};const u=l.dotnet?.bundleUrl;return{ok:!0,async run(d){try{const h=await Vi(c.invocation,{files:d,cwd:l.cwd,env:l.env,io:s,sendOps:f=>e.post({type:"fs",ops:f}),manifest:()=>u?Ui(u,e.fetch):Promise.reject(new U(Ut))});if(h.kind==="done")return{kind:"exited",code:h.code};if(!u)throw new U(Ut);const $=await o(u,h.work.env,l.cwd,d);return r.exited?{kind:"exited",code:1}:{kind:"running",ports:i,done:Qi(h.work,$,s).catch(a)}}catch(h){return{kind:"exited",code:a(h)}}}}}}})}const Yi="https://builderforce.ai/schema/app.v1.json",bn=["browser","cloudflare","aws","azure","gcp"],vn=["production","non-production"],En=["GET","POST","PUT","PATCH","DELETE"],Ji={local:{target:"browser",tier:"non-production"}};function b(e,t,n={}){return{code:e,path:t,severity:"error",...n}}function jt(e){return e.some(t=>t.severity==="error")}function Ft(e){const t=new Set;return e.filter(n=>{const r=`${n.code}\0${n.path}\0${n.value??""}`;return t.has(r)?!1:(t.add(r),!0)})}function Zo(e){const t=e.path?`"${e.path}"`:"The manifest",n=e.detail?` ${e.detail}`:"";switch(e.code){case"invalid-json":return`builderforce.json is not valid JSON:${n}`;case"not-an-object":return"builderforce.json must hold a JSON object.";case"legacy-format":return'builderforce.json has no "version"; it is read in the legacy format. Add "version": 1 to use the manifest.';case"unsupported-version":return`Manifest version ${e.value??"?"} is not supported; this runtime reads version 1.`;case"invalid-value":return`${t} has an invalid value${e.value!==void 0?` "${e.value}"`:""}.${n}`;case"missing-field":return`${t} is missing "${e.value??"?"}".`;case"invalid-id":return`Id "${e.value??e.path}" must start with a letter and contain only letters, digits, "_" and "-".`;case"duplicate-id":return`Id "${e.value??"?"}" names both a resource and a service.`;case"unknown-resource-type":return`${t} has unknown resource type "${e.value??"?"}".`;case"unknown-resource":return`${t} uses "${e.value??"?"}", which is not a resource of this manifest.`;case"unknown-service":return`${t} names "${e.value??"?"}", which is not a service of this manifest.`;case"invalid-queue-host":return`${t}: a redis queue must name a redis resource in "on"${e.value?`, not "${e.value}"`:""}.`;case"invalid-port":return`${t} has port ${e.value??"?"}; a port is a whole number from 1 to 65535.`;case"duplicate-port":return`Port ${e.value??"?"} is claimed by more than one service.${n}`;case"invalid-readiness":return`${t} must name exactly one readiness check: http, port, query, exitZero or started.${n}`;case"invalid-duration":return`${t} has duration "${e.value??"?"}"; use a whole number with ms, s, m, h or d (e.g. "10m").`;case"invalid-schedule":return`${t} has cron schedule "${e.value??"?"}" that cannot be read.${n}`;case"invalid-timezone":return`${t} has time zone "${e.value??"?"}", which is not an IANA time zone.`;case"invoke-without-port":return`${t} invokes service "${e.value??"?"}", which has no port to call.`;case"unknown-target":return`${t} has unknown target "${e.value??"?"}"; use browser, cloudflare, aws, azure or gcp.`;case"invalid-tier":return`${t} has tier "${e.value??"?"}"; use production or non-production.`;case"debug-in-production":return`${t} is a production environment with debug on; debug is allowed only on non-production.`;case"unknown-environment":return`There is no environment "${e.value??"?"}" in this manifest.`;case"unknown-override-entry":return`${t} overrides "${e.value??"?"}", which the manifest does not declare.`;case"frontend-uses-credentials":return`${t} is a frontend using "${e.value??"?"}"; a frontend's code ships to the browser, so it never receives its credentials.`;case"jobs-not-run":return`${t} will not run on this target.${n}`;case"spec":return e.spec?sr(e.spec):`The application spec is invalid.${n}`}}const Sn=["services","resources","jobs"];function O(e){return typeof e=="object"&&e!==null&&!Array.isArray(e)}const Xi=new Set(["__proto__","constructor","prototype"]);function Te(e){return!Xi.has(e)}function ee(e,t){return Te(t)&&Object.hasOwn(e,t)}function tt(e,t){if(!O(e)||!O(t))return t===void 0?e:t;const n={};for(const[r,s]of Object.entries(e))Te(r)&&(n[r]=s);for(const[r,s]of Object.entries(t))s!==void 0&&Te(r)&&(n[r]=tt(Object.hasOwn(n,r)?n[r]:void 0,s));return n}function kn(e){const t=O(e.environments)?e.environments:void 0;return t&&Object.keys(t).length>0?t:{...Ji}}function Pn(e,t,n){const r=[],s=n.overrides;if(s===void 0)return r;if(!O(s))return[b("invalid-value",`environments.${t}.overrides`,{detail:"Expected an object."})];for(const i of Sn){const o=s[i];if(o===void 0)continue;const a=`environments.${t}.overrides.${i}`;if(!O(o)){r.push(b("invalid-value",a,{detail:"Expected an object keyed by id."}));continue}const l=e[i];for(const c of Object.keys(o))(!O(l)||!ee(l,c))&&r.push(b("unknown-override-entry",a,{value:c}))}return r}function Zi(e,t){const n=kn(e),r=Object.prototype.hasOwnProperty.call(n,t)?n[t]:void 0;if(!O(r))return{manifest:null,environment:null,issues:[b("unknown-environment","environments",{value:t,detail:`Known: ${Object.keys(n).join(", ")}.`})]};const s=Pn(e,t,r),i=O(r.overrides)?r.overrides:{},o={...e};for(const a of Sn){const l=e[a],c=i[a];if(!O(l)||!O(c))continue;const u=tt(l,{});for(const[d,h]of Object.entries(c))ee(l,d)&&(u[d]=tt(l[d],h));o[a]=u}return{manifest:o,environment:{...r,name:t},issues:s}}const _e=e=>({supported:!1,reason:`${e} in the browser arrives in a later release.`}),P=e=>({supported:!0,provider:e}),X=e=>({supported:!1,reason:e}),Gt="Infrastructure modules are applied only by a customer-cloud target (AWS, Azure, GCP).",$t={postgres:{browser:P("pglite"),cloudflare:P("neon"),aws:P("rds"),azure:P("azure-postgres"),gcp:P("cloud-sql")},redis:{browser:_e("Redis"),cloudflare:P("upstash"),aws:P("elasticache"),azure:P("azure-cache"),gcp:P("memorystore")},queue:{browser:_e("A queue"),cloudflare:P("cloudflare-queues"),aws:P("sqs"),azure:P("service-bus"),gcp:P("pubsub")},"object-storage":{browser:_e("Object storage"),cloudflare:P("r2"),aws:P("s3"),azure:P("blob-storage"),gcp:P("gcs")},mail:{browser:_e("The mail catcher"),cloudflare:P("connection"),aws:P("connection"),azure:P("connection"),gcp:P("connection")},graph:{browser:X("A graph database (Neo4j, Memgraph) has no browser stand-in that speaks its protocol."),cloudflare:X("Cloudflare hosts no graph database."),aws:P("connection"),azure:P("connection"),gcp:P("connection")},connection:{browser:P("vault"),cloudflare:P("vault"),aws:P("vault"),azure:P("vault"),gcp:P("vault")},external:{browser:X(Gt),cloudflare:X(Gt),aws:P("opentofu"),azure:P("opentofu"),gcp:P("opentofu")}},eo={browser:{supported:!1,reason:"Scheduled jobs arrive in a later release."},cloudflare:P("cron-triggers"),aws:P("eventbridge"),azure:P("container-apps-jobs"),gcp:P("cloud-scheduler")},ea=Object.keys($t);function Tn(e){return typeof e=="string"&&Object.prototype.hasOwnProperty.call($t,e)}function Rn(e,t){const n=Tn(e)?$t[e]:void 0;return n?n[t]??X(`"${t}" is not a known target.`):X(`"${e}" is not a known resource type.`)}function ta(e,t){return Rn(e,t).supported}const to=[{name:"minute",min:0,max:59},{name:"hour",min:0,max:23},{name:"day of month",min:1,max:31},{name:"month",min:1,max:12,names:["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"],nameBase:1},{name:"day of week",min:0,max:7,names:["SUN","MON","TUE","WED","THU","FRI","SAT"],nameBase:0}],no={"@yearly":"0 0 1 1 *","@annually":"0 0 1 1 *","@monthly":"0 0 1 * *","@weekly":"0 0 * * 0","@daily":"0 0 * * *","@midnight":"0 0 * * *","@hourly":"0 * * * *"},ro=[31,29,31,30,31,30,31,31,30,31,30,31];function Bt(e,t){if(/^\d+$/.test(e))return Number(e);const n=t.names?.indexOf(e.toUpperCase())??-1;return n>=0?n+(t.nameBase??0):void 0}function so(e,t){const n=new Set;for(const r of e.split(",")){const[s,i,o]=r.split("/");if(o!==void 0||!s)return`"${r}" in the ${t.name} field is not a value, range or step.`;let a=1;if(i!==void 0){if(!/^\d+$/.test(i)||Number(i)<1)return`Step "${i}" in the ${t.name} field must be a positive whole number.`;a=Number(i)}let l,c;if(s==="*")l=t.min,c=t.max;else{const[u,d,h]=s.split("-");if(h!==void 0||!u)return`"${s}" in the ${t.name} field is not a value or range.`;l=Bt(u,t),c=d!==void 0?Bt(d,t):i!==void 0?t.max:l}if(l===void 0||c===void 0)return`"${s}" in the ${t.name} field is not a value.`;if(l<t.min||c>t.max||l>c)return`"${s}" is outside the ${t.name} field's range ${t.min}-${t.max}.`;for(let u=l;u<=c;u+=a)n.add(u)}return[...n].sort((r,s)=>r-s)}function io(e){const t=e.trim(),r=(no[t.toLowerCase()]??t).split(/\s+/).filter(Boolean);if(r.length!==5)return{ok:!1,reason:`A cron schedule has 5 fields (minute hour day-of-month month day-of-week); "${t}" has ${r.length}.`};const s=[];for(let $=0;$<5;$++){const f=so(r[$],to[$]);if(typeof f=="string")return{ok:!1,reason:f};s.push(f)}const[i,o,a,l,c]=s,u=[...new Set(c.map($=>$%7))].sort(($,f)=>$-f),d=!r[2].startsWith("*"),h=!r[4].startsWith("*");return d&&!h&&!l.some($=>a.some(f=>f<=ro[$-1]))?{ok:!1,reason:`"${t}" never fires: no chosen month has the chosen day.`}:{ok:!0,schedule:{source:t,minutes:i,hours:o,daysOfMonth:a,months:l,daysOfWeek:u,dayOfMonthRestricted:d,dayOfWeekRestricted:h}}}const Wt=new Map;function On(e){let t=Wt.get(e);return t||(t=new Intl.DateTimeFormat("en-US",{timeZone:e,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",second:"numeric"}),Wt.set(e,t)),t}function oo(e){try{return On(e),!0}catch{return!1}}function nt(e,t){if(t==="UTC")return e;const n={};for(const r of On(t).formatToParts(new Date(e)))r.type!=="literal"&&(n[r.type]=Number(r.value));return Date.UTC(n.year,n.month-1,n.day,n.hour%24,n.minute,n.second)}function ao(e,t){if(t==="UTC")return e;const n=new Set;for(const r of[e-864e5,e,e+864e5]){const s=nt(r,t)-r,i=e-s;nt(i,t)===e&&n.add(i)}return n.size===0?void 0:Math.min(...n)}const ye=6e4,lo=8;function co(e,t){const n=e.daysOfMonth.includes(t.getUTCDate()),r=e.daysOfWeek.includes(t.getUTCDay());return e.dayOfMonthRestricted&&e.dayOfWeekRestricted?n||r:e.dayOfMonthRestricted?n:e.dayOfWeekRestricted?r:!0}function uo(e,t){const n=new Date(t),r=n.getUTCFullYear()+lo;for(;n.getUTCFullYear()<=r;){if(!e.months.includes(n.getUTCMonth()+1)){n.setUTCMonth(n.getUTCMonth()+1,1),n.setUTCHours(0,0,0,0);continue}if(!co(e,n)){n.setUTCDate(n.getUTCDate()+1),n.setUTCHours(0,0,0,0);continue}if(!e.hours.includes(n.getUTCHours())){n.setUTCHours(n.getUTCHours()+1,0,0,0);continue}if(!e.minutes.includes(n.getUTCMinutes())){n.setUTCMinutes(n.getUTCMinutes()+1,0,0);continue}return n.getTime()}}function na(e,t,n="UTC"){const r=t.getTime();let s=Math.floor(nt(r,n)/ye)*ye+ye;for(let i=0;i<1e4;i++){const o=uo(e,s);if(o===void 0)return;const a=ao(o,n);if(a!==void 0&&a>r)return new Date(a);s=o+ye}}const fo=/^(\d+)(ms|s|m|h|d)$/,po={ms:1,s:1e3,m:6e4,h:36e5,d:864e5};function Nn(e){const t=fo.exec(e.trim());if(!t)return;const n=Number(t[1])*po[t[2]];return n>0&&Number.isSafeInteger(n)?n:void 0}const $o=["http","port","query","exitZero","started"],ho=["redis","native"],mo=["neo4j","memgraph","age"],go=["frontend","backend"],_o=["never","on-failure","always"],An=["session","always-on"],yo=["concurrency","cpu","requests"],wo=["allow","forbid","replace"],bo=["skip","run-once"];function de(e){return typeof e=="string"&&e.trim().length>0}function ve(e,t,n){return e===void 0?{}:O(e)?e:(n.push(b("invalid-value",t,{detail:"Expected an object keyed by id."})),{})}function F(e,t,n,r){e!==void 0&&!(typeof e=="string"&&t.includes(e))&&r.push(b("invalid-value",n,{value:String(e),detail:`Use one of: ${t.join(", ")}.`}))}function Q(e,t,n,r){e!==void 0&&typeof e!==t&&r.push(b("invalid-value",n,{value:String(e),detail:`Expected a ${t}.`}))}function ue(e,t,n){return e===void 0?[]:Array.isArray(e)&&e.every(r=>typeof r=="string")?e:(n.push(b("invalid-value",t,{detail:"Expected a list of strings."})),[])}function z(e,t,n,r){const s=e[t];if(s!=null&&s!=="")return s;r.push(b("missing-field",n,{value:t}))}function Cn(e,t,n){e!==void 0&&(typeof e!="string"||Nn(e)===void 0)&&n.push(b("invalid-duration",t,{value:String(e)}))}function Fe(e,t,n){for(const r of Object.keys(e))(!ir.test(r)||!Te(r))&&n.push(b("invalid-id",`${t}.${r}`,{value:r}))}function vo(e,t){for(const[n,r]of Object.entries(e)){const s=`resources.${n}`;if(!O(r)){t.push(b("invalid-value",s,{detail:"Expected a resource object."}));continue}const i=z(r,"type",s,t);if(i!==void 0){if(!Tn(i)){t.push(b("unknown-resource-type",`${s}.type`,{value:String(i)}));continue}switch((i==="postgres"||i==="redis")&&Q(r.persistent,"boolean",`${s}.persistent`,t),i){case"postgres":ue(r.extensions,`${s}.extensions`,t),Q(r.name,"string",`${s}.name`,t);break;case"redis":r.maxMemoryMb!==void 0&&!(typeof r.maxMemoryMb=="number"&&r.maxMemoryMb>0)&&t.push(b("invalid-value",`${s}.maxMemoryMb`,{value:String(r.maxMemoryMb),detail:"Expected a positive number."}));break;case"queue":{const o=z(r,"engine",s,t);if(F(o,ho,`${s}.engine`,t),o==="redis"){const a=typeof r.on=="string"?e[r.on]:void 0;(!O(a)||a.type!=="redis")&&t.push(b("invalid-queue-host",`${s}.on`,{value:r.on===void 0?void 0:String(r.on)}))}break}case"graph":F(z(r,"engine",s,t),mo,`${s}.engine`,t);break;case"connection":de(r.connection)||t.push(b("missing-field",s,{value:"connection"}));break;case"external":de(r.module)||t.push(b("missing-field",s,{value:"module"})),ue(r.outputs,`${s}.outputs`,t);break}}}}function Eo(e,t,n){if(e===void 0)return;if(!O(e)){n.push(b("invalid-readiness",t));return}const r=$o.filter(s=>e[s]!==void 0);r.length!==1?n.push(b("invalid-readiness",t,{detail:r.length>1?`It names ${r.join(" and ")}.`:void 0})):(r[0]==="http"?!(typeof e.http=="string"&&e.http.startsWith("/")):e[r[0]]!==!0)&&n.push(b("invalid-readiness",`${t}.${r[0]}`,{detail:r[0]==="http"?'An http check names a path starting with "/".':"Set it to true."})),Cn(e.timeout,`${t}.timeout`,n)}function So(e,t,n){const r=new Map;for(const[s,i]of Object.entries(e)){const o=`services.${s}`;if(!O(i)){n.push(b("invalid-value",o,{detail:"Expected a service object."}));continue}if(ee(t,s)&&n.push(b("duplicate-id",o,{value:s})),de(i.runtime)||n.push(b("missing-field",o,{value:"runtime"})),de(i.command)||n.push(b("missing-field",o,{value:"command"})),Q(i.root,"string",`${o}.root`,n),ue(i.args,`${o}.args`,n),i.port!==void 0){const a=i.port;typeof a!="number"||!Number.isInteger(a)||a<1||a>65535?n.push(b("invalid-port",`${o}.port`,{value:String(a)})):r.set(a,[...r.get(a)??[],s])}F(i.role,go,`${o}.role`,n);for(const a of ue(i.uses,`${o}.uses`,n))ee(t,a)?i.role==="frontend"&&n.push(b("frontend-uses-credentials",`${o}.uses`,{value:a,severity:"warning"})):n.push(b("unknown-resource",`${o}.uses`,{value:a}));for(const a of ue(i.dependsOn,`${o}.dependsOn`,n))ee(e,a)||n.push(b("unknown-service",`${o}.dependsOn`,{value:a}));Eo(i.readiness,`${o}.readiness`,n),F(i.restart,_o,`${o}.restart`,n),i.env!==void 0&&!(O(i.env)&&Object.values(i.env).every(a=>typeof a=="string"))&&n.push(b("invalid-value",`${o}.env`,{detail:"Expected an object of string values."})),F(i.availability,An,`${o}.availability`,n),ko(i.scale,`${o}.scale`,n)}for(const[s,i]of r)i.length>1&&n.push(b("duplicate-port","services",{value:String(s),detail:`Claimed by ${i.join(", ")}.`}))}function ko(e,t,n){if(e===void 0)return;if(!O(e)){n.push(b("invalid-value",t,{detail:"Expected an object."}));return}const r=s=>s===void 0||typeof s=="number"&&Number.isInteger(s)&&s>=0;!r(e.min)||!r(e.max)?n.push(b("invalid-value",t,{detail:"min and max are whole numbers of instances."})):typeof e.min=="number"&&typeof e.max=="number"&&e.min>e.max&&n.push(b("invalid-value",t,{detail:"min is above max."})),F(e.metric,yo,`${t}.metric`,n)}function Po(e,t,n){for(const[r,s]of Object.entries(e)){const i=`jobs.${r}`;if(!O(s)){n.push(b("invalid-value",i,{detail:"Expected a job object."}));continue}const o=z(s,"schedule",i,n);if(o!==void 0){const c=typeof o=="string"?io(o):{ok:!1,reason:"Expected a string."};c.ok||n.push(b("invalid-schedule",`${i}.schedule`,{value:String(o),detail:c.reason}))}s.timezone!==void 0&&!(typeof s.timezone=="string"&&oo(s.timezone))&&n.push(b("invalid-timezone",`${i}.timezone`,{value:String(s.timezone)})),s.run!==void 0&&s.invoke!==void 0?n.push(b("invalid-value",i,{detail:"A job either runs a command or invokes an endpoint, not both."})):s.run===void 0&&s.invoke===void 0&&n.push(b("missing-field",i,{value:"run"}));const a=s.run??s.invoke,l=`${i}.${s.run!==void 0?"run":"invoke"}`;if(a!==void 0&&!O(a))n.push(b("invalid-value",l,{detail:"Expected an object."}));else if(O(a)){const c=z(a,"service",l,n),u=typeof c=="string"?t[c]:void 0;c!==void 0&&u===void 0&&n.push(b("unknown-service",`${l}.service`,{value:String(c)})),s.run!==void 0?de(a.command)||n.push(b("missing-field",l,{value:"command"})):(typeof a.path=="string"&&a.path.startsWith("/")||n.push(b("invalid-value",`${l}.path`,{value:a.path===void 0?void 0:String(a.path),detail:'An endpoint path starts with "/".'})),F(a.method,En,`${l}.method`,n),O(u)&&u.port===void 0&&n.push(b("invoke-without-port",l,{value:String(c)})))}F(s.concurrency,wo,`${i}.concurrency`,n),Cn(s.timeout,`${i}.timeout`,n),F(s.missed,bo,`${i}.missed`,n),F(s.availability,An,`${i}.availability`,n)}}function To(e,t,n){if(e===void 0)return;const r=O(e)?e.routes:void 0;if(!Array.isArray(r)){n.push(b("invalid-value","ingress",{detail:'Expected { "routes": [...] }.'}));return}r.forEach((s,i)=>{const o=`ingress.routes.${i}`;!O(s)||!(typeof s.path=="string"&&s.path.startsWith("/"))?n.push(b("invalid-value",o,{detail:'A route has a path starting with "/" and a service.'})):(typeof s.service!="string"||!ee(t,s.service))&&n.push(b("unknown-service",`${o}.service`,{value:String(s.service)}))})}function Ro(e,t){ve(e.environments,"environments",t);for(const[n,r]of Object.entries(kn(e))){const s=`environments.${n}`;if(!O(r)){t.push(b("invalid-value",s,{detail:"Expected an environment object."}));continue}const i=z(r,"target",s,t);i!==void 0&&!bn.includes(i)&&t.push(b("unknown-target",`${s}.target`,{value:String(i)}));const o=z(r,"tier",s,t);o!==void 0&&!vn.includes(o)&&t.push(b("invalid-tier",`${s}.tier`,{value:String(o)})),Q(r.debug,"boolean",`${s}.debug`,t),Q(r.connection,"string",`${s}.connection`,t),o==="production"&&r.debug===!0&&t.push(b("debug-in-production",`${s}.debug`,{value:n})),t.push(...Pn(e,n,r))}}function xn(e){const t=[],n=e;n.version!==1&&t.push(b("unsupported-version","version",{value:String(n.version)})),Q(n.name,"string","name",t),Q(n.$schema,"string","$schema",t);const r=ve(n.resources,"resources",t),s=ve(n.services,"services",t),i=ve(n.jobs,"jobs",t);return Fe(r,"resources",t),Fe(s,"services",t),Fe(i,"jobs",t),vo(r,t),So(s,r,t),Po(i,s,t),To(n.ingress,s,t),Ro(e,t),t}function ra(e){let t;try{t=JSON.parse(e.replace(/^﻿/,""))}catch(r){return{manifest:null,issues:[b("invalid-json","",{detail:r instanceof Error?r.message:String(r)})]}}if(!O(t))return{manifest:null,issues:[b("not-an-object","")]};if(t.version===void 0)return{manifest:null,legacy:t,issues:[b("legacy-format","version",{severity:"info"})]};if(t.version!==1)return{manifest:null,issues:[b("unsupported-version","version",{value:JSON.stringify(t.version)})]};const n=t;return{manifest:n,issues:xn(n)}}const Oo={node:[{name:"NODE_ENV",values:{production:"production",development:"development",debug:"development"}}],php:[{name:"APP_ENV",values:{production:"production",development:"local",debug:"local"}},{name:"APP_DEBUG",values:{production:"false",development:"false",debug:"true"}}],dotnet:[{name:"ASPNETCORE_ENVIRONMENT",values:{production:"Production",development:"Development",debug:"Development"}},{name:"DOTNET_ENVIRONMENT",values:{production:"Production",development:"Development",debug:"Development"}}],python:[{name:"FLASK_DEBUG",values:{production:"0",development:"0",debug:"1"}},{name:"DJANGO_DEBUG",values:{production:"False",development:"False",debug:"True"}},{name:"PYTHONDEVMODE",values:{debug:"1"}}],rust:[{name:"RUST_LOG",values:{production:"info",development:"info",debug:"debug"}}]};function ht(e){return e.tier==="non-production"&&e.debug===!0}function No(e){return e.tier==="production"?"production":ht(e)?"debug":"development"}function Ao(e,t){const n=No(t),r={BUILDERFORCE_ENV:t.name,BUILDERFORCE_TIER:t.tier,BUILDERFORCE_DEBUG:String(ht(t))};for(const s of Oo[e]??[]){const i=s.values[n];i!==void 0&&(r[s.name]=i)}return r}function sa(e){return e.tier!=="non-production"?"off":ht(e)?"verbose":"basic"}const Co={postgres:5432};function xo(e){const t=e.timeout===void 0?void 0:Nn(e.timeout),n=t===void 0?{}:{timeoutMs:t};if("http"in e)return{kind:"http",path:e.http,...n};if("port"in e)return{kind:"port",...n};if("query"in e)return{kind:"query",...n};if("exitZero"in e)return{kind:"exit-zero",...n};if("started"in e)return{kind:"started",...n}}function Io(e,t){let n=e;for(;t.has(n);)n++;return t.add(n),n}function Do(e,t,n,r){const s=(t.uses??[]).filter(l=>r.has(l)),i=[...new Set([...t.dependsOn??[],...s])],o=t.readiness?xo(t.readiness):t.port===void 0&&t.restart==="always"?{kind:"started"}:void 0,a={id:e,type:"application",runtime:t.runtime,env:{...Ao(t.runtime,n),...t.env}};return t.role&&(a.role=t.role),t.root&&(a.root=t.root),t.command&&(a.command=t.command),t.args&&(a.args=[...t.args]),t.port!==void 0&&(a.port=t.port),i.length>0&&(a.dependsOn=i),o&&(a.readiness=o),t.restart&&(a.restartPolicy=t.restart),a}function qo(e,t,n,r){return{id:e,type:"database",runtime:n,port:r,database:{engine:"postgres",provider:n,persistent:t.persistent??!1,...t.name?{name:t.name}:{}}}}function Lo(e){if(e.code.startsWith("ingress-"))return b("spec","ingress",{spec:e});const t="serviceId"in e?e.serviceId:void 0;return b("spec",t?`services.${t}`:"services",{spec:e})}function ia(e,t,n){const r=Zi(e,t),s=[...xn(e),...r.issues],i=r.manifest,o=r.environment;if(!i||!o||jt(s))return{spec:null,environment:o,declined:[],issues:Ft(s)};const a=i.resources??{},l=i.services??{},c=[],u=[],d=new Set,h=new Set(Object.values(l).flatMap(m=>m.port===void 0?[]:[m.port]));for(const[m,w]of Object.entries(a)){const E=Rn(w.type,o.target);if(!E.supported){c.push({id:m,reason:E.reason??`The ${o.target} target does not host "${w.type}" resources.`});continue}const N=Co[w.type];w.type==="postgres"&&N!==void 0&&E.provider?(u.push(qo(m,w,E.provider,Io(N,h))),d.add(m)):w.type!=="connection"&&c.push({id:m,reason:`"${w.type}" resources on ${o.target} are provisioned by its deployment, not run by the application runtime.`})}for(const[m,w]of Object.entries(l))u.push(Do(m,w,o,d));const $=O(i.jobs)?Object.keys(i.jobs):[],f=eo[o.target];if(!f.supported)for(const m of $)s.push(b("jobs-not-run",`jobs.${m}`,{severity:"warning",detail:f.reason}));const p={projectId:n.projectId,services:u},_=i.ingress?.routes??[];_.length>0&&(p.ingress={routes:_.map(m=>({path:m.path,serviceId:m.service}))}),s.push(...or(p).map(Lo));const v=Ft(s);return{spec:jt(v)?null:p,environment:o,declined:c,issues:v}}const Mo="^[A-Za-z][A-Za-z0-9_-]*$",Uo="^\\d+(ms|s|m|h|d)$",H=e=>({$ref:`#/$defs/${e}`}),Ge=e=>({type:"object",propertyNames:{pattern:Mo},additionalProperties:H(e)}),se={type:"array",items:{type:"string"}},Ht={enum:["session","always-on"]},W=(e,t={},n=[])=>({type:"object",properties:{type:{const:e},...t},required:["type",...n],additionalProperties:!1}),ie=(e,t)=>({type:"object",properties:{[e]:t,timeout:H("duration")},required:[e],additionalProperties:!1}),oa={$schema:"https://json-schema.org/draft/2020-12/schema",$id:Yi,title:"Builderforce app manifest v1 (builderforce.json)",type:"object",properties:{$schema:{type:"string"},version:{const:1},name:{type:"string"},resources:Ge("resource"),services:Ge("service"),jobs:Ge("job"),ingress:H("ingress"),environments:{type:"object",additionalProperties:H("environment")}},required:["version"],additionalProperties:!1,$defs:{duration:{type:"string",pattern:Uo},resource:{oneOf:[W("postgres",{persistent:{type:"boolean"},extensions:se,name:{type:"string"}}),W("redis",{persistent:{type:"boolean"},maxMemoryMb:{type:"number",exclusiveMinimum:0}}),W("queue",{engine:{enum:["redis","native"]},on:{type:"string"}},["engine"]),W("object-storage"),W("mail"),W("graph",{engine:{enum:["neo4j","memgraph","age"]}},["engine"]),W("connection",{connection:{type:"string",minLength:1}},["connection"]),W("external",{module:{type:"string",minLength:1},outputs:se},["module"])]},readiness:{oneOf:[ie("http",{type:"string",pattern:"^/"}),ie("port",{const:!0}),ie("query",{const:!0}),ie("exitZero",{const:!0}),ie("started",{const:!0})]},service:{type:"object",properties:{runtime:{type:"string",minLength:1},root:{type:"string"},command:{type:"string",minLength:1},args:se,port:{type:"integer",minimum:1,maximum:65535},role:{enum:["frontend","backend"]},uses:se,dependsOn:se,readiness:H("readiness"),restart:{enum:["never","on-failure","always"]},env:{type:"object",additionalProperties:{type:"string"}},availability:Ht,scale:{type:"object",properties:{min:{type:"integer",minimum:0},max:{type:"integer",minimum:0},metric:{enum:["concurrency","cpu","requests"]}},additionalProperties:!1}},required:["runtime","command"],additionalProperties:!1},job:{type:"object",properties:{schedule:{type:"string",minLength:1},timezone:{type:"string"},run:{type:"object",properties:{service:{type:"string"},command:{type:"string",minLength:1}},required:["service","command"],additionalProperties:!1},invoke:{type:"object",properties:{service:{type:"string"},method:{enum:[...En]},path:{type:"string",pattern:"^/"}},required:["service","path"],additionalProperties:!1},concurrency:{enum:["allow","forbid","replace"]},timeout:H("duration"),missed:{enum:["skip","run-once"]},availability:Ht},required:["schedule"],oneOf:[{required:["run"]},{required:["invoke"]}],additionalProperties:!1},ingress:{type:"object",properties:{routes:{type:"array",items:{type:"object",properties:{path:{type:"string",pattern:"^/"},service:{type:"string"}},required:["path","service"],additionalProperties:!1}}},required:["routes"],additionalProperties:!1},overrides:{type:"object",properties:{services:{type:"object",additionalProperties:{type:"object"}},resources:{type:"object",additionalProperties:{type:"object"}},jobs:{type:"object",additionalProperties:{type:"object"}}},additionalProperties:!1},environment:{type:"object",properties:{target:{enum:[...bn]},connection:{type:"string"},tier:{enum:[...vn]},debug:{type:"boolean"},overrides:H("overrides")},required:["target","tier"],if:{properties:{tier:{const:"production"}}},then:{properties:{debug:{const:!1}}},additionalProperties:!1}}};export{Ne as ACTIVE_STATES,Yi as APP_MANIFEST_SCHEMA_URL,oa as APP_MANIFEST_SCHEMA_V1,ca as ApplicationSpecError,Xt as ApplicationStartError,Lt as BUNDLE_CACHE_PREFIX,ua as CREDENTIAL_POLICY,da as DATABASE_PROVIDER_DEFAULTS,fa as DATABASE_URL_SCHEMES,Ji as DEFAULT_ENVIRONMENTS,Ho as DEFAULT_PGLITE_URL,pa as DEFAULT_PHP_VERSION,$a as DEFAULT_PHP_WASM_BASE_URL,xr as DEFAULT_PYODIDE_INDEX_URL,Js as DEFAULT_REPOSITORY_URL,vr as DEFAULT_RESTART_LIMITS,J as DIST_LIMITS,yt as DOTNET_BUNDLE,ha as DOTNET_COMMAND_PATTERN,Wi as DOTNET_ENV,Sl as DOTNET_KIND,ma as DatabaseCoordinationError,j as DistRefused,U as DotnetBundleError,vn as ENVIRONMENT_TIERS,ge as FRONT_SCRIPT,En as HTTP_METHODS,yr as IllegalTransitionError,dt as InvalidPackageName,eo as JOB_CAPABILITIES,bn as MANIFEST_TARGETS,Xe as MAX_RESPONSE_BYTES,ga as NATIVE_ONLY_PACKAGES,_a as NODE_DECLINED_COMMANDS,ya as NODE_READINESS,jr as OPEN_FILE_SYNC_MS,Ar as PGLITE_VERSION,wa as PGSQL_REASON,ba as PHP_COMMAND_PATTERN,kl as PHP_KIND,va as PHP_WASM_EXTENSIONS,Ea as PHP_WASM_RELEASES,Sa as PHP_WASM_VERSION,Pl as PIP_RECORD_LIMITS,G as PROJECT_MOUNT,Cr as PYODIDE_VERSION,ka as PYTHON_COMMAND_PATTERN,qi as REFERENCE_ROOT,$t as RESOURCE_CAPABILITIES,ea as RESOURCE_TYPES,ce as RUNTIME_LIBRARY_ROOT,Pa as RUNTIME_PROVIDED_PACKAGES,Ta as RUST_COMPILE_GATE,Tl as RUST_KIND,Ra as RUST_PROFILE,V as ResolveError,on as SEND_HIGH_WATER_MARK,Oa as SERVER_COMMANDS,_r as SERVICE_TRANSITIONS,Na as SUPPORTED_PHP_VERSIONS,ae as ServiceFailure,Rl as ServiceGraphPolicy,Oo as TIER_ENV_CONVENTIONS,He as TRAINING_ARTIFACT_DIR,Ol as TRAINING_SINK_DEFAULTS,ys as VIRTUAL_TCP_MODULE,kr as acceptApplication,Aa as acceptsDotnetService,Ca as acceptsNodeService,xa as acceptsPgliteService,Ia as acceptsPhpService,Da as acceptsPythonService,qa as acceptsRustService,Nl as artifactKeyId,La as assertValidSpec,wr as canTransition,si as checkDistUrl,te as checkPackageName,_t as checkPhpVersion,Ma as claimDatabase,Yn as compareVersions,zi as compilePlan,gs as createChannelTransport,_s as createDialTransport,Bi as createDotnetBridge,Al as createDotnetProcessKind,Ua as createDotnetProvider,Xo as createDotnetWorkerProcess,br as createLifecycle,ja as createNodeProvider,ai as createPackageSource,Fa as createPgliteProvider,Cl as createPhpProcessKind,Ga as createPhpProvider,Yo as createPhpWorkerProcess,xl as createPipRecord,Sr as createProviderRegistry,Il as createPythonProcessKind,Ba as createPythonProvider,Qo as createPythonWorkerProcess,Dl as createRustProcessKind,Wa as createRustProvider,Go as createTrainingArtifactStore,ql as createTrainingChannel,Ll as createTrainingSink,Ha as databaseName,Va as databaseUrl,Us as declaredClasses,Fs as dependencyOrder,Mr as describeInstall,sr as describeIssue,Zo as describeManifestIssue,sa as diagnosticsLevel,Ai as dialSocketClass,Bs as encodePackageName,za as envName,kn as environmentsOf,Qa as evaluateCondition,ei as expandMinified,Ka as expandProperties,Ya as expectedPlatform,nr as findProject,Ja as frameworkDefines,we as fromPhpPath,zo as fromPyodidePath,ci as frontScript,It as githubRepository,Xa as globMatcher,Jr as headersOf,Za as ingressPathKey,el as ingressTable,Ci as installPhpSockets,Yr as installPythonExtensions,Ve as installRequirements,Ri as installRuntimeLibrary,bs as installVirtualSockets,tl as isDotnetCommand,Oi as isLocalAddress,nl as isPhpCommand,Ee as isPlatformPackage,rl as isPythonCommand,Tn as isResourceType,sl as isRustCommand,oo as isValidTimeZone,Jo as loadDotnetRuntime,il as loadPhpRuntime,Vo as loadPyodideRuntime,Vs as lockText,jt as manifestHasErrors,Kn as mapInvocationPaths,er as mapPhpInvocationPaths,ol as mayConnectToDatabase,tt as mergeOverrides,al as nativeOnlyReason,na as nextFire,Wn as noWheelReason,Vt as normalizeName,qr as packagesWithoutWheels,Kt as parseConstraint,io as parseCron,rr as parseDotnetCommand,Nn as parseDuration,ll as parseFileBasedProgram,ra as parseManifest,Zn as parsePhpCommand,cl as parseProjectFile,ul as parsePyproject,Qn as parsePythonCommand,zn as parseRequirement,dl as parseRequirementsTxt,fl as parseRustCommand,pl as parseServerCommand,st as parseVersion,$l as pgliteDataDir,Z as phpLiteral,Ke as phpString,hl as phpWasmModuleUrls,Ct as pickVersion,wt as planBuild,Bn as planRequirements,Qt as platformShortfall,Vi as prepareInvocation,ws as pythonTcpModule,dn as rankVersions,Pe as readCapped,Di as readLaunchProfile,Ui as readManifest,zt as readProjectRequirements,Vn as readRequirementFile,Dn as readinessOf,ml as receivesDatabaseCredentials,Ot as requireArguments,Zi as resolveEnvironment,B as resolveFrom,zs as resolvePackages,Rn as resourceCapability,Er as restartDecision,qn as restartPolicyOf,Ln as roleOf,Qs as rootRequirements,di as routeRequest,Ys as runComposer,Qi as runWithRuntime,Hs as runtimePackages,gl as satisfies,Fn as serviceEnv,lr as serviceGraph,_l as serviceMap,pt as sha256Hex,Ii as splitArgs,Wo as startApplicationRuntime,yl as startDatabaseHost,pi as startPhpWebServer,Zr as startPythonAppServer,es as startRequestedAppServer,ta as targetSupports,Ao as tierEnv,No as tierMode,ia as toApplicationSpec,q as toPhpPath,he as toPyodidePath,xo as toReadinessSpec,wl as tomlStringArray,bl as tomlTable,ln as trackPhpWrites,ln as trackWrappedFsWrites,ni as unpackDist,Ws as unsupportedRepositories,Ml as validArtifactPath,cn as validPackageName,Ul as validPipInstall,xn as validateManifest,or as validateSpec,ti as versionsOf,vl as withoutDatabaseCredentials,Rt as writeAutoloader};
