import{hz as Ee,hA as z,hB as Ht,hC as Vt,hD as Qt,hE as zt,hF as Ve,hG as Kt,hH as Yt,hI as Jt,_ as Xt,hJ as Zt,hK as en,hL as mt,G as qe,H as T,I as ue,hM as tn,hn as U,hN as gt,hO as nn,hP as rn,hQ as sn,hR as on,hS as oe,hT as Qe,hU as an,hV as De,hW as _t,hX as yt,hY as ln,ho as cn,hZ as un,h_ as ze,h$ as fn,i0 as Ke,i1 as dn,i2 as Ye,i3 as pn,i4 as $n}from"./index.js";import{i5 as yi,i6 as wi,i7 as bi,i8 as vi,i9 as Ei,ia as Pi,hw as ki,ib as Si,ic as Ti,id as Ri,ie as Oi,ig as Ni,hu as Ci,ih as Ai,ii as xi,ij as Ii,hp as qi,ik as Di,il as Li,im as Mi,io as Ui,ip as Fi,iq as ji,ir as Gi,is as Bi,it as Wi,iu as Hi,iv as Vi,hf as Qi,iw as zi,ix as Ki,iy as Yi,iz as Ji,iA as Xi,iB as Zi,iC as eo,iD as to,iE as no,iF as ro,iG as so,iH as io,iI as oo,iJ as ao,iK as lo,iL as co,hv as uo,ht as fo,hr as po,hx as $o,iM as ho,iN as mo,iO as go,iP as _o,iQ as yo,iR as wo,iS as bo,iT as vo,iU as Eo,iV as Po,iW as ko,iX as So,iY as To,iZ as Ro,i_ as Oo,i$ as No,j0 as Co,j1 as Ao,j2 as xo}from"./index.js";import{r as hn,s as mn,h as gn,p as _n,m as Je,c as yn,a as wn,b as Le,i as bn,d as vn,Z as En,t as Xe,e as wt,f as Pn,g as kn,j as oi}from"./chunk-rustProcessKind.js";import{D as qo,P as Do,k as Lo,R as Mo,S as Uo,T as Fo,l as jo,n as Go,o as Bo,q as Wo,u as Ho,v as Vo,w as Qo,x as zo,y as Ko,z as Yo}from"./chunk-rustProcessKind.js";import{V as bt}from"./chunk-vfs.js";const Sn={discovered:["preparing","failed"],preparing:["starting","stopping","failed"],starting:["ready","stopping","failed"],ready:["running","stopping","failed"],running:["stopping","stopped","failed"],stopping:["stopped","failed"],stopped:["preparing"],failed:["preparing","stopped"]},de=new Set(["preparing","starting","ready","running"]);class Tn extends Error{serviceId;from;to;constructor(t,n,r){super(`Service "${t}" cannot go from "${n}" to "${r}".`),this.serviceId=t,this.from=n,this.to=r,this.name="IllegalTransitionError"}}function Rn(e,t){return Sn[e].includes(t)}function On(e,t){let n="discovered";return{serviceId:e,get state(){return n},transition(r){if(!Rn(n,r))throw new Tn(e,n,r);const i={serviceId:e,from:n,to:r};return n=r,t?.(i),i}}}const Nn={maxRestarts:5,backoffMs:250,maxBackoffMs:5e3};function Cn(e,t,n,r,i={}){const{maxRestarts:s,backoffMs:o,maxBackoffMs:a}={...Nn,...i};return t==="exit-zero"&&n===0?{restart:!1,reason:"completed"}:e==="always"||e==="on-failure"&&n!==0?r>=s?{restart:!1,reason:"limit"}:{restart:!0,delayMs:Math.min(a,o*2**r)}:{restart:!1,reason:"policy"}}function An(e){const t=new Map(e.map(n=>[n.id,n]));return{providers:[...t.values()],resolve(n){const r=t.get(n.runtime);if(!r){const s=[...t.keys()].join(", ")||"none";return{ok:!1,reason:`No runtime provider for "${n.runtime}" (available: ${s}).`}}const i=r.accepts(n);return i.ok?{ok:!0,provider:r}:{ok:!1,reason:i.reason}}}}function xn(e,t){const n=[];for(const r of e){const i=t.resolve(r);i.ok||n.push({serviceId:r.id,reason:i.reason})}return n.length===0?{ok:!0}:{ok:!1,declined:n}}class K extends Error{error;constructor(t){super(t.message),this.error=t,this.name="ServiceFailure"}}function pe(e,t={}){const n=[],r=new Promise((i,s)=>{const o=()=>{let a=!1;for(const l of e){const c=l.readiness();if(c==="down")return s(new K(l.failure()));c==="pending"&&(a=!0)}a||i()};for(const a of e)n.push(a.onChange(o));o()});return Ee(r,{signal:t.signal,ms:t.timeoutMs}).finally(()=>n.forEach(i=>i()))}function Pe(){const e=new Set;return{on(t){return e.add(t),()=>e.delete(t)},emit(t){for(const n of[...e])try{n(t)}catch(r){queueMicrotask(()=>{throw r})}}}}function In(e={}){const t=hn(Math.max(1,e.history??5e3)),n=Math.max(1,e.readerBuffer??1e3),r=new Set;let i=!1;const s=(l,c)=>{if((l.controller.desiredSize??0)<=1){l.dropped+=1;return}l.dropped>0&&(l.controller.enqueue({serviceId:c.serviceId,source:"runtime",text:`${l.dropped} log lines dropped (reader fell behind).`,at:c.at}),l.dropped=0),l.controller.enqueue(c)},o=l=>{t.push(l);for(const c of r)c.wanted(l)&&s(c,l)},a=(l,c,u)=>o({serviceId:l,source:c,text:u,at:Date.now()});return{pipe(l,c){(async()=>{const u=c.getReader();let f="";try{for(;;){const{value:$,done:h}=await u.read();if(h)break;const p=(f+$).split(/\r?\n/);f=p.pop()??"";for(const d of p)a(l,"output",d)}}catch($){a(l,"runtime",`Output stopped: ${z($)}`)}finally{f&&a(l,"output",f),u.releaseLock()}})()},note:(l,c)=>a(l,"runtime",c),stream(l){let c;return new ReadableStream({start(u){c={wanted:f=>l===void 0||f.serviceId===l,controller:u,dropped:0};for(const f of t)c.wanted(f)&&u.enqueue(f);i?u.close():r.add(c)},cancel(){c&&r.delete(c)}},new CountQueuingStrategy({highWaterMark:n}))},close(){i=!0;for(const l of r)l.controller.close();r.clear()}}}function qn(){let e;return{get pending(){return e!==void 0},schedule(t,n){clearTimeout(e),e=setTimeout(()=>{e=void 0,n()},t)},cancel(){clearTimeout(e),e=void 0}}}function Dn(e){const{spec:t,logs:n}=e,r=Ht(t),i=Vt(t),s=r.timeoutMs??e.readinessTimeoutMs,o=Pe(),a=On(t.id,m=>{e.onStateChange(m),o.emit()}),l=qn(),c=(m,v,k=!1,S)=>({serviceId:t.id,phase:m,message:v,exitCode:S,willRestart:k});let u,f=!1,$=!1,h=0,p=0,d,_,g,w,b=c("stopped","Not started.");function P(){const m={controller:new AbortController};u=m,f=!1,A(m)}async function A(m){a.transition("preparing");try{await pe(e.dependencies(),{signal:m.controller.signal,timeoutMs:e.dependencyTimeoutMs})}catch(S){const I=S instanceof K?`Dependency "${S.error.serviceId}" is not available: ${S.error.message}`:`Dependencies not ready: ${z(S)}`;return N(m,{phase:"dependency",message:I})}if(u!==m)return;const v=e.registry.resolve(t);if(!v.ok)return N(m,{phase:"declined",message:v.reason});if(_&&await Ee(_,{ms:e.stopTimeoutMs,onTimeout:()=>{},signal:m.controller.signal,onAbort:()=>{}}),u!==m)return;a.transition("starting");let k;try{m.handlePromise=Promise.resolve(v.provider.start(t,{env:e.env,signal:m.controller.signal,security:e.security,projectId:e.projectId})),k=await m.handlePromise}catch(S){return N(m,{phase:"start",message:z(S)})}if(m.handle=k,u!==m){m.abandoned?_=Kt(k):k.output.cancel().catch(()=>{});return}n.pipe(t.id,k.output),_=k.wait(),k.wait().then(S=>C(m,S));try{await Ee(k.ready(),{ms:s,onTimeout:()=>{throw new Error(`Not ready after ${s}ms (${r.kind} readiness).`)},signal:m.controller.signal})}catch(S){if(u!==m)return;const I=m.exitCode??await Yt(k,0);return u!==m?void 0:r.kind==="exit-zero"&&I===0?(m.completed=!0,E(m)):N(m,{phase:I===void 0?"readiness":"exit",message:z(S),exitCode:I})}u===m&&E(m)}function E(m){m.readyAt=Date.now(),w=void 0,a.transition("ready"),f=!0,a.transition("running"),m.completed&&O(m)}function C(m,v){if(m.exitCode=v,g=v,u===m){if(r.kind==="exit-zero"&&v===0){m.completed=!0,a.state==="running"?O(m):a.state==="starting"&&E(m);return}N(m,{phase:"exit",message:`Exited with code ${v}.`,exitCode:v,clean:a.state==="running"&&v===0})}}function O(m){u=void 0,m.controller.abort(),n.note(t.id,"Completed."),a.transition("stopped")}function N(m,v){if(u!==m)return;u=void 0,m.controller.abort(),m.handle&&m.exitCode===void 0&&m.handle.kill("SIGKILL"),Ve(e.processes,e.security),m.readyAt!==void 0&&Date.now()-m.readyAt>=e.stableAfterMs&&(h=0);const S=v.phase==="declined"||v.phase==="dependency"?{restart:!1}:Cn(i,r.kind,v.exitCode??1,h,e.restart),I=c(v.phase,v.message,S.restart,v.exitCode);f=!1,b=I,S.restart&&l.schedule(S.delayMs,P),a.transition(v.clean?"stopped":"failed"),v.clean?n.note(t.id,"Exited with code 0."):(w=I,n.note(t.id,`Failed (${v.phase}): ${v.message}`),e.onError(I)),S.restart&&(h+=1,n.note(t.id,`Restarting in ${S.delayMs}ms (${i}, attempt ${h}).`))}async function q(){l.cancel();const m=u;if(u=void 0,f=!1,b=c("stopped","Stopped."),de.has(a.state)){a.transition("stopping");const v=m?await zt(m,e.stopTimeoutMs):void 0;v&&(_=v.wait()),Ve(e.processes,e.security),a.transition("stopped")}else a.state==="failed"?a.transition("stopped"):o.emit()}const y={id:t.id,async start(){const m=p;if(d&&await d,m!==p)throw new K(c("stopped","Stopped before it started."));return!f&&!de.has(a.state)&&!l.pending&&(h=0,P()),pe([y])},stop(){return p+=1,d??=q().finally(()=>d=void 0),d},async restart(){$=!0;try{const m=y.stop(),v=p;if(await m,v!==p)throw new K(c("stopped","Stopped while restarting."));h=0,P()}finally{$=!1,o.emit()}return pe([y])},readiness:()=>f?"ready":de.has(a.state)||l.pending||$?"pending":"down",failure:()=>b,onChange:m=>o.on(m),url:()=>u?.handle?.url(),database:()=>u?.handle?.database,snapshot:()=>({id:t.id,type:t.type,runtime:t.runtime,role:Qt(t),state:a.state,port:t.port,url:u?.handle?.url(),restarts:h,exitCode:g,error:w})};return y}class vt extends Error{failures;constructor(t){super(`Services failed to start: ${t.map(n=>`${n.serviceId} (${n.message})`).join("; ")}`),this.failures=t,this.name="ApplicationStartError"}}const ee={readinessTimeoutMs:12e4,dependencyTimeoutMs:6e5,stopTimeoutMs:5e3,stableAfterMs:1e4},Ln=e=>"resolve"in e;async function Ze(e){const n=(await Promise.allSettled(e.map(([,r])=>r))).flatMap((r,i)=>{if(r.status==="fulfilled")return[];const s=r.reason instanceof K?r.reason.error:{serviceId:e[i][0],phase:"start",message:z(r.reason),willRestart:!1};return s.phase==="stopped"?[]:[s]});if(n.length>0)throw new vt(n)}function Mn(e){const t=e.services.map(r=>`${r.id}\0${r.root??"/"}`).sort().join(""),n=gn("sha256").digest(new TextEncoder().encode(t));return`app:${e.projectId}:${Array.from(n.subarray(0,8),r=>r.toString(16).padStart(2,"0")).join("")}`}function li(e,t){const n=mn(e),r=Ln(t.providers)?t.providers:An(t.providers),i=In({history:t.logHistory,readerBuffer:t.logReaderBuffer}),s=Pe(),o=Pe(),a=new Map;let l=!1;const c=Mn(e),u=(g,w)=>{const b=r.resolve(g);return b.ok?b.provider.databaseCredentials?.(g,w):void 0},f=t.processes??t.runtime,$=t.portPolicy??t.runtime.portPolicy;for(const g of n.startOrder){const w=n.dependenciesOf(g).map(b=>a.get(b));a.set(g,Dn({spec:e.services.find(b=>b.id===g),env:Jt(e,g,{databaseCredentials:u}),registry:r,logs:i,onStateChange:b=>s.emit(b),onError:b=>o.emit(b),dependencies:()=>w,readinessTimeoutMs:t.readinessTimeoutMs??ee.readinessTimeoutMs,dependencyTimeoutMs:t.dependencyTimeoutMs??ee.dependencyTimeoutMs,stopTimeoutMs:t.stopTimeoutMs??ee.stopTimeoutMs,restart:t.restart??{},stableAfterMs:t.stableAfterMs??ee.stableAfterMs,security:Object.freeze({applicationId:c,serviceId:g}),projectId:e.projectId,processes:f}))}const h=g=>{const w=a.get(g);if(!w)throw new Error(`No service "${g}" in this application.`);return w},p=()=>{if(l)throw new Error("This application runtime was disposed.")};let d;const _=async()=>{for(const g of n.stopOrder)await h(g).stop();f.killApplication(c),d?.(),d=void 0};return{projectId:e.projectId,applicationId:c,async start(){p();const g=xn(e.services,r);if(!g.ok){const w=g.declined.map(({serviceId:b,reason:P})=>({serviceId:b,phase:"declined",message:P,willRestart:!1}));throw w.forEach(b=>o.emit(b)),new vt(w)}d??=$.register(c,e),await Ze(n.startOrder.map(w=>[w,h(w).start()]))},stop:_,async restart(g){p();const w=h(g);await Ze([[g,w.restart()]])},async dispose(){l||(l=!0,await _(),t.runtime.forgetApplication?.(c),i.close())},getService:g=>a.get(g)?.snapshot(),listServices:()=>n.startOrder.map(g=>h(g).snapshot()),getUrl:g=>a.get(g)?.url(),logs:g=>i.stream(g),onStateChange:g=>s.on(g),onError:g=>o.on(g),database(g){const w=h(g);if(e.services.find(P=>P.id===g)?.type!=="database")throw new Error(`Service "${g}" is not a database.`);const b=async()=>w.database()??Promise.reject(new Error(`Database "${g}" is not running.`));return{export:async()=>(await b()).export(),import:async P=>(await b()).import(P),reset:async()=>(await b()).reset()}}}}const Un="0.5.16",ci=`https://cdn.jsdelivr.net/npm/@electric-sql/pglite@${Un}/dist/index.js`,Fn="314.0.7",jn=`https://cdn.jsdelivr.net/pyodide/v${Fn}/full/`;let V;const Gn=e=>e.endsWith("/")?e:`${e}/`;async function Bn(e){const t=globalThis;if(typeof t.importScripts=="function")try{if(t.importScripts(`${e}pyodide.js`),t.loadPyodide)return t.loadPyodide}catch{}return(await Xt(()=>import(`${e}pyodide.mjs`),[],import.meta.url)).loadPyodide}async function ui(e={}){const t=Gn(e.indexURL??jn);if(V?.indexURL!==t){const r=Bn(t);V={indexURL:t,load:r},r.catch(()=>{V?.load===r&&(V=void 0)})}const n=()=>{};return(await V.load)({indexURL:t,env:e.env,stdout:n,stderr:n})}const ke="/bfwc-artifacts";function Wn(e){const t=[];for(const n of e.matchAll(/(?:pure Python 3 wheel|pure Python wheel|wheel compatible with Pyodide)[^:'"]*:?\s*((?:['"][^'"]+['"](?:,\s*)?)+)/gi))for(const r of n[1].matchAll(/['"]([^'"]+)['"]/g))t.push(mt(r[1].split(/[<>=!~;[ ]/)[0]));return[...new Set(t)]}const Hn=e=>e instanceof Error?e.message:String(e);async function et(e,t,n){const r=e.toPy(n);try{await e.runPythonAsync(`import micropip
${t}`,{globals:r})}finally{r.destroy?.()}}async function Se(e,t,n={}){const r=Zt(t,n.provided),i={installed:[],provided:r.provided,declined:[...r.declined]};let s=r.install;if(!s.length)return i;const o=n.log??(()=>{});await e.loadPackage("micropip",{messageCallback:()=>{},errorCallback:o});const a=n.indexUrls?.length?[...n.indexUrls]:void 0;for(;;)try{return await et(e,"await micropip.install(specs, index_urls=index_urls)",{specs:s.map(l=>l.spec),index_urls:a}),i.installed.push(...s.map(l=>l.name)),i}catch(l){const c=Wn(Hn(l)).filter($=>!i.declined.some(h=>h.name===$));if(!c.length)throw l;for(const $ of c)i.declined.push({name:$,reason:en($)});const u=new Set(s.filter($=>c.includes($.name)).map($=>$.name)),f=c.filter($=>!u.has($));for(const $ of f)await et(e,'micropip.add_mock_package(name, "0.0.0")',{name:$});if(s=s.filter($=>!u.has($.name)),!s.length)return i}}function Vn(e){const t=[];e.installed.length&&t.push(`Successfully installed ${e.installed.join(" ")}`),e.provided.length&&t.push(`Provided by the runtime (not installed): ${e.provided.join(" ")}`);for(const{reason:n}of e.declined)t.push(`Declined: ${n}`);return t}const M="/project",Qn=new Set(["node_modules",".git"]),zn=50,ae=e=>e.split("/").some(t=>Qn.has(t)),x=e=>e==="/"?M:T(M,e);function se(e){const t=qe(e);return t===M?"/":t.startsWith(`${M}/`)?t.slice(M.length):void 0}const Kn=new TextDecoder("utf-8",{fatal:!0,ignoreBOM:!0});function Yn(e){try{return Kn.decode(e)}catch{return e.slice()}}const X=(e,t)=>e.analyzePath(t).exists,fe=(e,t)=>X(e,t)&&e.isDir(e.stat(t).mode),Te=(e,t)=>X(e,t)&&!e.isDir(e.stat(t).mode),Et=(e,t)=>t.startsWith("/")?t:T(e.cwd(),t),Me=(e,t)=>e.readdir(t).filter(n=>n!=="."&&n!=="..");function le(e,t){if(X(e,t)){if(!fe(e,t))return e.unlink(t);for(const n of Me(e,t))le(e,`${t}/${n}`);e.rmdir(t)}}function Ue(e,t){t.mkdirTree(M);for(const n of e.explicitDirectories())ae(n)||t.mkdirTree(x(n));for(const n of e.list()){if(ae(n))continue;const r=x(n);t.mkdirTree(ue(r)),t.writeFile(r,e.readFile(n)??"")}}function Fe(e,t){for(const n of t){if(ae(n.path))continue;const r=x(n.path);n.op==="write"?(e.mkdirTree(ue(r)),fe(e,r)&&le(e,r),e.writeFile(r,n.content)):n.op==="mkdir"?e.mkdirTree(r):le(e,r)}}function Pt(e,t,n=()=>!1){const r=new Set;let i=[],s=!1,o=0,a;const l=(d,_)=>{const g=x(d);return _==="mkdir"||_==="remove"?[{op:_,path:d}]:X(e,g)?fe(e,g)?_==="write"?[]:[{op:"mkdir",path:d},...Me(e,g).flatMap(w=>l(T(d,w),"tree"))]:[{op:"write",path:d,content:Yn(e.readFile(g))}]:[]},c=()=>{if(s=!1,!i.length)return;const d=i;i=[];const _=d.flatMap(({op:g,path:w})=>l(w,g)).filter(g=>!n(g.path));_.length&&t(_)},u=(d,_)=>{const g=se(_);if(!(o||g===void 0||g==="/"||n(g)||ae(g))){if(d==="write"){let w;for(const b of i)b.path===g&&(w=b);if(w?.op==="write")return}i.push({op:d,path:g}),s||(s=!0,queueMicrotask(c))}},f=()=>{for(const d of r)u("write",d)},$={openedForWrite(d){!o&&se(d)!==void 0&&r.add(d)},written(d){o||se(d)===void 0||(r.add(d),clearTimeout(a),a=setTimeout(f,zn))},closed(d){r.delete(d)&&u("write",d)},madeDirectory:d=>u("mkdir",d),symlinked:d=>u("tree",d),deleted:d=>u("remove",d),moved(d,_){u("remove",d),u("tree",_)}},h=e.truncate.bind(e),p=e.ftruncate.bind(e);return e.truncate=(d,_)=>{h(d,_),typeof d=="string"&&u("write",Et(e,d))},e.ftruncate=(d,_)=>{p(d,_);const g=e.getStream(d)?.path;g&&u("write",g)},{events:$,tracker:{quietly(d){o++;try{d()}finally{o--}},flush(){clearTimeout(a),f(),c()}}}}const te=x,fi=se;function Jn(e,t){Ue(e,t)}function Xn(e,t){Fe(e,t)}const Zn=579,er=e=>e.includes("/__pycache__")||e.endsWith(".pyc");function tr(e,t){const{tracker:n,events:r}=Pt(e,t,er),i={onOpenFile:((s,o)=>{o&Zn&&r.openedForWrite(s)}),onWriteToFile:(s=>r.written(s)),onCloseFile:(s=>r.closed(s)),onMakeDirectory:(s=>r.madeDirectory(s)),onMakeSymlink:((s,o)=>r.symlinked(o)),onDeletePath:(s=>r.deleted(s)),onMovePath:((s,o)=>r.moved(s,o))};return Object.assign(e.trackingDelegate,i),n}const kt=e=>import(e),Re=(e,t)=>e===t||e.startsWith(t==="/"?"/":`${t}/`);function nr(e,t,n){const r=qe(t.root??`/opt/bfwc-extensions/${n}`);if(Re(r,M)||Re(M,r))throw new Error(`Python extension ${e.moduleUrl}: root ${r} overlaps the project (${M}); extensions are installed outside it.`);return r}function rr(e,t,n){const r=T(t,n);if(n.startsWith("/")||!Re(r,t)||r===t)throw new Error(`Python extension ${e.moduleUrl}: file "${n}" is outside its root ${t}.`);return r}async function sr(e,t,n=kt){const r=new Set,i=new Set;for(const[s,o]of t.entries()){const l=(await n(o.moduleUrl))[o.exportName];if(typeof l!="function")throw new Error(`Python extension ${o.moduleUrl} has no function export "${o.exportName}".`);const c=await l()??{},u=Object.entries(c.files??{}),f=u.length?nr(o,c,s):void 0,$=u.map(([h,p])=>[rr(o,f,h),p]);for(const[h,p]of Object.entries(c.jsModules??{}))e.registerJsModule(h,p);for(const[h,p]of $)e.FS.mkdirTree(h.slice(0,h.lastIndexOf("/"))||"/"),e.FS.writeFile(h,p);f&&e.runPython(`import sys
if ${JSON.stringify(f)} not in sys.path: sys.path.insert(0, ${JSON.stringify(f)})`);for(const h of c.provides??[])r.add(mt(h));for(const h of c.imports??(c.provides??[]).map(p=>p.replace(/-/g,"_")))i.add(h)}return{packages:r,imports:i}}function ir(e){const t={};for(const[n,r]of e){const i=n.toLowerCase(),s=t[i];t[i]=s===void 0?r:Array.isArray(s)?[...s,r]:[s,r]}return t}const or=e=>JSON.stringify(Object.entries(e.headers??{}));function St(e){const t=e.handle,n=e.disconnect,r=e.close,i={interface:e.interface,app:String(e.label),port:Number(e.port)};let s=1;return{spec:i,handle:a=>new Promise((l,c)=>{const u=s++;let f,$=!1;const h={head(p,d){f=_n(()=>{$||n(u)}),l({status:p,headers:ir(JSON.parse(d)),body:f.stream})},chunk(p){if(!(!f||f.push(p.slice())))return f.ready()},end(p){$=!0,p?f?.fail(new Error(p)):f?.end()}};t(u,a.method,a.url,or(a),a.body??void 0,h).then(()=>{f||c(new Error("The Python app finished without a response."))},p=>{f?f.fail(p):c(p)})}),async close(){try{await r()}finally{e.destroy?.()}}}}async function ar(e,t){const n=e.pyimport("bfwc.serve").start_server;return St(await n(t.interface,t.app,t.port,!!t.factory,t.appDir))}async function lr(e){const t=e.pyimport("bfwc.serve").start_requested;return St(await t())}function je(e,t){let n=new bt,r,i,s,o,a=!1;const l=d=>{if(!a){r?.flush(),a=!0,s!==void 0&&e({type:"unlisten",port:s});for(const _ of o?.listening??[])e({type:"unlisten",port:_});o?.closeAll(),e({type:"exit",code:d})}},c={post:e,io:{stdout:d=>!a&&e({type:"stdout",data:d}),stderr:d=>!a&&e({type:"stderr",data:d})},get exited(){return a},exit:l,mounted(d){n=void 0,r=d},get takenPorts(){return f.taken}},u=async(d,_=tn(d))=>{const g=i;i=void 0,f.cancelAll();try{o?.stop()}catch{}try{await g?.close()}finally{l(_)}},f=yn({post:e,handlerFor:d=>i&&d===s?i.handle:o?.handlerFor(d),onListenFailed(d){if(d===s)s=void 0;else if(!o?.listening.has(d))return;c.io.stderr($.addressInUse(d)),u("SIGTERM",1)}}),$=t(c),h=d=>{n?wn(n,d):r?.apply(d)};async function p(d){const{snapshot:_}=d;_.pack?Je(n,_):h(_.ops);for(const P of d.ports)f.taken.add(P);const g=$.plan(d);if(!g.ok)return c.io.stderr(g.message),l(g.code);if(g.port!==void 0&&f.taken.has(g.port))return c.io.stderr($.addressInUse(g.port)),l(1);const w=await g.run(n);if(w.kind==="exited")return l(w.code);if(w.kind==="running")return o=w.ports,l(await w.done);const{port:b}=w.server;if(a||f.taken.has(b))return await w.server.close(),a||c.io.stderr($.addressInUse(b)),l(1);i=w.server,s=b,f.taken.add(b),e({type:"listen",port:b}),c.io.stderr(w.banner)}return{receive(d){if(!(f.receive(d)||$.receive?.(d)))switch(d.type){case"prime":return Je(n,d.snapshot),e({type:"primed"});case"start":p(d).catch(_=>{c.io.stderr(`${_ instanceof Error?_.stack??_.message:String(_)}
`),l(1)});return;case"fs":return h(d.ops);case"kill":return void u(d.signal);case"stdin":return $.stdin?.(d.data);case"socket-open":case"socket-accept":return e({type:"socket-close",connId:d.connId});default:return}}}}const cr=String.raw`
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
`,ur=String.raw`
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
`,fr=String.raw`
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
`,dr=String.raw`
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
`,pr=String.raw`
import os

ARTIFACT_DIR = ${JSON.stringify(ke)}


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
`,$r=String.raw`
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
`,hr=String.raw`
class UvicornWorker:
    """Named by gunicorn's -k option; the runtime reads it from the command line and serves ASGI."""
`,mr=String.raw`
"""The browser runtime serves WSGI apps itself; gunicorn is importable but never runs."""
__version__ = "0.0.0+bfwc"
version_info = (0, 0, 0)
`,$e="/opt/bfwc",gr={"bfwc/__init__.py":"","bfwc/run.py":cr,"bfwc/serve.py":ur,"bfwc/threads.py":dr,"bfwc/training.py":pr,"bfwc/vsocket.py":fr,"uvicorn/__init__.py":$r,"uvicorn/workers.py":hr,"gunicorn/__init__.py":mr};function _r(e){for(const[t,n]of Object.entries(gr)){const r=`${$e}/${t}`;e.FS.mkdirTree(r.slice(0,r.lastIndexOf("/"))),e.FS.writeFile(r,n)}e.runPython(`import sys
if ${JSON.stringify($e)} not in sys.path: sys.path.insert(0, ${JSON.stringify($e)})`)}const yr=new TextDecoder;function Ge(e,t){return n=>{const r=U(t,n);if(!(!e.FS.analyzePath(r).exists||e.FS.isDir(e.FS.stat(r).mode)))return yr.decode(e.FS.readFile(r))}}const Tt=e=>e.map(rn).filter(t=>!!t),Rt=e=>[e.PIP_INDEX_URL,...(e.PIP_EXTRA_INDEX_URL??"").split(/\s+/)].filter(t=>!!t);async function he(e,t,n,r){const i=e.toPy({kind:t,target:n,argv:[...r]});try{const s=await e.runPythonAsync(`from bfwc.run import run_main
run_main(kind, target, argv)`,{globals:i});return s==="serve"?"serve":typeof s=="number"?s:0}finally{i.destroy?.()}}async function tt(e,t,n){if(t)try{const r=e.pyimport("pyodide.code").find_imports,i=r(t),s=i.toJs?.()??[];i.destroy?.();const o=s.filter(a=>!n.provided.imports.has(a.split(".")[0]));if(!o.length)return;await e.loadPackagesFromImports(o.map(a=>`import ${a}`).join(`
`),{messageCallback:()=>{},errorCallback:a=>n.io.stderr(`${a}
`)})}catch(r){n.io.stderr(`${r instanceof Error?r.message:String(r)}
`)}}async function wr(e,t,n){const r=o=>n.io.stderr(`${o}
`),i=o=>o.declined.forEach(({reason:a})=>r(`Declined: ${a}`));for(const o of n.installs)try{i(await Se(e,Tt(o.specs),{indexUrls:o.indexUrls,log:r,provided:n.provided.packages}))}catch(a){r(`Warning: could not repeat this session's earlier pip install of ${o.specs.join(" ")}: ${a instanceof Error?a.message.trim().split(`
`).pop():String(a)}`)}const s=gt(Ge(e,n.cwd),t);s.length&&i(await Se(e,s,{indexUrls:Rt(n.env),log:r,provided:n.provided.packages})),e.pyimport("bfwc.threads").install()}async function br(e,t,n){const r=Ge(e,n.cwd),i=t.projects.flatMap(c=>{const u=U(n.cwd,c),f=gt(r,u);return f.length||n.io.stderr(`${c}: no dependencies declared (pyproject.toml [project] dependencies or requirements.txt); its own code runs from the project directory as is.
`),f}),s=[...Tt(t.packages),...t.files.flatMap(c=>nn(r,U(n.cwd,c))),...i],o=[...t.indexUrls,...Rt(n.env)],a=await Se(e,s,{indexUrls:o,log:c=>n.io.stderr(`${c}
`),provided:n.provided.packages});for(const c of Vn(a))(c.startsWith("Declined")?n.io.stderr:n.io.stdout)(`${c}
`);const l=s.filter(c=>a.installed.includes(c.name)).map(c=>c.spec);return l.length&&n.io.installed?.({specs:l,indexUrls:o}),a.declined.length?1:0}async function vr(e,t,n){const r=a=>({kind:"exited",code:a});if(t.kind==="install")return e.pyimport("bfwc.threads").install(),r(await br(e,t,n));const i=t.kind==="serve"&&t.server.appDir?U(n.cwd,t.server.appDir):n.cwd;if(await wr(e,i,n),t.kind==="serve")return{kind:"serving",server:await ar(e,t.server)};const s=Ge(e,n.cwd);let o;return t.kind==="script"?(await tt(e,s(t.path),n),o=await he(e,"script",t.path,t.argv)):t.kind==="code"?(await tt(e,t.code,n),o=await he(e,"code",t.code,t.argv)):o=await he(e,"module",t.module,t.argv),o==="serve"?{kind:"serving",server:await lr(e)}:r(o)}const Ot=64*1024;class Er{channel;highWaterMark;queue=[];unacked=0;ended=!1;constructor(t,n,r=Ot){this.channel=t,this.highWaterMark=r,t.manualFlowControl(),t.onData(i=>{this.queue.push(i),n()}),t.onConsumed(i=>{this.unacked=Math.max(0,this.unacked-i),this.unacked<=this.highWaterMark&&n()}),t.onClose(()=>{this.ended=!0,n()})}get writable(){return this.unacked<=this.highWaterMark}tryRecv(t){const n=this.queue.shift();if(!n)return this.ended?null:void 0;const r=n.byteLength>t?n.subarray(0,t):n;return r!==n&&this.queue.unshift(n.subarray(t)),this.channel.closed||this.channel.consumed(r.byteLength),r}send(t){this.channel.send(t),this.unacked+=t.byteLength}close(){this.ended=!0,this.queue.length=0,this.channel.close()}}const Pr=new Set(["localhost","127.0.0.1","::1","0.0.0.0",""]),nt=e=>{const t=e.wakeReader;e.wakeReader=void 0,t?.();for(const n of e.wakeSenders.splice(0))n()};function kr(e,t=Ot){const n=new Map;let r=1;const i=s=>{const o=n.get(s);if(!o)throw new Error(`Bad file descriptor: connection ${s} is closed.`);return o};return{async connect(s,o){if(!Pr.has(s.toLowerCase()))throw new Error(`connect ECONNREFUSED ${s}:${o} (only localhost is reachable in the browser runtime)`);const a=await e(o);if(!a)throw new Error(`connect ECONNREFUSED ${s}:${o}`);const l=r++,c={wakeSenders:[]},u=Object.assign(c,{endpoint:new Er(a,()=>nt(c),t)});return n.set(l,u),l},async send(s,o){const a=i(s),{endpoint:l}=a;if(l.ended)throw new Error("Broken pipe: the connection is closed.");for(l.send(o);!l.writable&&!l.ended;)await new Promise(c=>a.wakeSenders.push(c))},async recv(s,o){const a=i(s);for(;;){const l=a.endpoint.tryRecv(o);if(l!==void 0)return l;await new Promise(c=>a.wakeReader=c)}},close(s){const o=n.get(s);o&&(o.endpoint.close(),nt(o),n.delete(s))}}}function Sr(e){const t=Le(e);return{transport:kr(n=>t.dial(n)),receive:n=>t.receive(n)}}const Tr="_bfwc_tcp",ie="timeout",rt=e=>new Promise(t=>setTimeout(()=>t(ie),e));function Rr(e){const t=new Map;return{async connect(n,r,i){const s=e.connect(n,r);if(i==null)return s;const o=await Promise.race([s,rt(i)]);if(o===ie)throw s.then(a=>e.close(a),()=>{}),new Error("timed out");return o},send:(n,r)=>Promise.resolve(e.send(n,r.slice())),async recv(n,r,i){const s=t.get(n)??e.recv(n,r);t.set(n,s);const o=i==null?await s:await Promise.race([s,rt(i)]);return o===ie?ie:(t.delete(n),o??void 0)},shutdown:n=>e.shutdown?.(n),close(n){t.delete(n),e.close(n)}}}function Or(e,t){e.registerJsModule(Tr,Rr(t)),e.runPython(`import bfwc.vsocket
bfwc.vsocket.install()`)}const Nr="_bfwc_training",Cr=50,Ar=12e4;function*Nt(e,t,n=""){for(const r of e.readdir(t)){if(r==="."||r==="..")continue;const i=`${t}/${r}`,s=n?`${n}/${r}`:r,{mode:o}=e.lstat(i);e.isLink(o)||(e.isDir(o)?yield*Nt(e,i,s):e.isFile(o)&&(yield[s,i]))}}const xr=e=>e.analyzePath(ke).exists?[...Nt(e,ke)]:[];function Ir(e){let t=!1,n,r=0,i=0;const s=new Map;async function o(a=!1){if(!n)return{ok:!1,error:"Not a training process.",confirmed:!1};const{py:l,options:c}=n,u=++r;let f;try{if(f=xr(l.FS),a&&f.length===0)return{ok:!0,confirmed:!1};for(const[h,p]of f){const d=l.FS.readFile(p);e({type:"training-artifact",saveId:u,path:h,bytes:d},[d.buffer])}}catch(h){return{ok:!1,error:`Could not read the artifacts: ${h instanceof Error?h.message:String(h)}`,confirmed:!1}}const $=c.acks?new Promise(h=>{s.set(u,h),setTimeout(()=>s.get(u)===h&&(s.delete(u),h({ok:!1,error:"The page did not acknowledge the save.",confirmed:!1})),Ar)}):void 0;return e({type:"training-saved",saveId:u,files:f.length}),$??{ok:!0,confirmed:!1}}return{receive(a){return bn(a)?a.type==="checkpoint"?(t=!0,!0):(s.get(a.saveId)?.(a.superseded?{ok:!0,confirmed:!1,superseded:!0}:{ok:a.ok,error:a.error,confirmed:a.ok}),s.delete(a.saveId),!0):!1},install(a,l){n={py:a,options:l,cell:l.flag?new Int32Array(l.flag):void 0};const c=n.cell;a.registerJsModule(Nr,{checkpoint_requested:()=>t||c!==void 0&&Atomics.load(c,0)!==0,should_yield:()=>{if(c||t)return!1;const u=Date.now();return u-i<Cr?!1:(i=u,!0)},tick:()=>new Promise(u=>setTimeout(u,0)),save:()=>o().then(u=>({error:u.ok?"":u.error??"The save failed.",confirmed:u.confirmed}))})},async saveAtExit(a){if(!n)return;const l=await o(!0);l.ok||a(`bfwc.training: the artifacts were not saved: ${l.error??"unknown error"}
`)}}}const qr=e=>`[Errno 98] error while attempting to bind on address ('0.0.0.0', ${e}): address already in use
`,Dr=e=>/fatal error/i.test(e instanceof Error?e.message:String(e));function di(e){const t=[],n=new TextDecoder,r=e.tcp?void 0:Sr(e.post),i=e.tcp??r.transport,s=Ir((a,l)=>e.post(a,l)),o=a=>t.push(...a.split(/(?<=\n)/).filter(Boolean));return je(e.post,a=>{async function l(u,f){const $={...u.env,PYTHONDONTWRITEBYTECODE:"1",PYTHONUNBUFFERED:"1",PWD:te(u.cwd)},h=await e.loadPyodide({indexURL:u.python?.indexURL,env:$}),p=P=>({write:A=>(a.io[P](A.slice()),A.length),isatty:!1});h.setStdout(p("stdout")),h.setStderr(p("stderr")),h.setStdin({stdin:()=>t.shift()??null,isatty:!1}),_r(h),Or(h,i);const d=u.python?.training;d&&s.install(h,d);const _=await sr(h,u.python?.extensions??[],e.importModule??kt);Jn(f,h.FS);const g=tr(h.FS,P=>{a.exited||e.post({type:"fs",ops:P})});a.mounted({apply:P=>g.quietly(()=>Xn(h.FS,P)),flush:()=>g.flush()});const w=h.pyimport("bfwc.run").bootstrap,b=h.toPy($);try{w(b,te(u.cwd))}finally{b.destroy?.()}return{py:h,provided:_}}async function c(u,f,$){const{py:h,provided:p}=await l(u,$);if(a.exited)return{kind:"exited",code:0};const d=await vr(h,f,{cwd:te(u.cwd),env:u.env,io:{stdout:a.io.stdout,stderr:a.io.stderr,installed:g=>e.post({type:"python-installed",...g})},installs:u.python?.installs??[],provided:p});if(d.kind==="exited")return s.saveAtExit(a.io.stderr).then(()=>d);const _=d.server;return{kind:"serving",server:{port:_.spec.port,handle:Lr(_,a),close:()=>_.close()},banner:`Serving ${_.spec.interface.toUpperCase()} app ${_.spec.app} on http://localhost:${_.spec.port} (request-driven)
`}}return{addressInUse:qr,plan(u){const f=sn(u.command,u.args,u.env);if(!f.ok)return{ok:!1,message:`${u.command}: ${f.reason}
`,code:2};const $=on(f.invocation,te);return{ok:!0,port:$.kind==="serve"?$.server.port:void 0,run:h=>c(u,$,h)}},stdin:u=>o(u===null?n.decode():typeof u=="string"?u:n.decode(u,{stream:!0})),receive:u=>s.receive(u)||!!r?.receive(u)}})}function Lr(e,t){return n=>e.handle(n).catch(r=>{throw Dr(r)&&(t.io.stderr(`${r instanceof Error?r.message:String(r)}
`),t.exit(1)),r})}const Mr=3,Ur=64,Fr=512;function jr(e){return typeof e=="string"?/[wa+]/.test(e):(e&Mr)!==0||(e&(Ur|Fr))!==0}function Ct(e,t){const{tracker:n,events:r}=Pt(e,t),i=o=>Et(e,o),s={open:e.open,write:e.write,close:e.close,mkdir:e.mkdir,unlink:e.unlink,rmdir:e.rmdir,rename:e.rename,symlink:e.symlink};return e.open=function(o,a,l){const c=s.open.call(this,o,a,l);return jr(a)&&c.path&&r.openedForWrite(c.path),c},e.write=function(o,...a){const l=s.write.call(this,o,...a);return o.path&&r.written(o.path),l},e.close=function(o){const a=o.path;s.close.call(this,o),a&&r.closed(a)},e.mkdir=function(o,a){const l=s.mkdir.call(this,o,a);return r.madeDirectory(i(o)),l},e.unlink=function(o){s.unlink.call(this,o),r.deleted(i(o))},e.rmdir=function(o){s.rmdir.call(this,o),r.deleted(i(o))},e.rename=function(o,a){s.rename.call(this,o,a),r.moved(i(o),i(a))},e.symlink=function(o,a){const l=s.symlink.call(this,o,a);return r.symlinked(i(a)),l},n}const Oe=e=>`'${e.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;function W(e,t){return e==null?"null":typeof e=="boolean"||typeof e=="number"?JSON.stringify(e):typeof e=="string"?t?.(e)??Oe(e):Array.isArray(e)?`[${e.map(n=>W(n,t)).join(", ")}]`:`[${Object.entries(e).map(([n,r])=>`${W(n)} => ${W(r,t)}`).join(", ")}]`}const Gr=String.raw`<?php
// Generated by the BuilderForce WebContainers PHP runtime (composer install).
require_once __DIR__ . '/composer/ClassLoader.php';
require_once __DIR__ . '/composer/InstalledVersions.php';
return \Composer\Autoload\ClassLoader::bfwcBoot(require __DIR__ . '/composer/autoload_bfwc.php');
`,Br=String.raw`<?php
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
`,Wr=String.raw`<?php
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
`,Hr=/^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z_\x80-￿][A-Za-z0-9_\x80-￿]*)/gm,Vr=/^\s*namespace\s+([A-Za-z_\\][A-Za-z0-9_\\]*)\s*[;{]/m;function Qr(e){const t=e.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*(\/\/|#).*$/gm,""),n=Vr.exec(t)?.[1];return[...t.matchAll(Hr)].map(r=>n?`${n}\\${r[2]}`:r[2])}function me(e,t,n,r,i){if(!i)return;const s=a=>T(n,r,a);for(const[a,l]of Object.entries(i["psr-4"]??{}))(e.psr4[a]??=[]).push(...[l].flat().map(s));for(const[a,l]of Object.entries(i["psr-0"]??{}))(e.psr0[a]??=[]).push(...[l].flat().map(s));for(const a of i.files??[])e.files.push(s(a));const o=(i["exclude-from-classmap"]??[]).map(s);for(const a of i.classmap??[]){const l=s(a),c=t.isDir(l)?t.list(l).filter(u=>/\.(php|inc|hh)$/.test(u)):[l];for(const u of c)if(!o.some(f=>u.startsWith(f)))for(const f of Qr(t.read(u)??""))e.classmap[f]??=u}}const zr=e=>t=>t===e||t.startsWith(`${e}/`)?`$baseDir . ${W(t.slice(e.length))}`:void 0;function Kr(e){const t=new Map(e.map(s=>[s.name.toLowerCase(),s])),n=new Set,r=[],i=(s,o)=>{const a=s.name.toLowerCase();if(!(n.has(a)||o.has(a))){o.add(a);for(const l of Object.keys(s.require??{}).sort()){const c=t.get(l.toLowerCase());c&&i(c,o)}o.delete(a),n.add(a),r.push(s)}};for(const s of[...e].sort((o,a)=>o.name.localeCompare(a.name)))i(s,new Set);return r}function st(e,t,n,r,i){const s={psr4:{},psr0:{},classmap:{},files:[]};me(s,e,t,"",n.autoload),i.dev&&me(s,e,t,"",n["autoload-dev"]);const o=s.files.splice(0);for(const f of Kr(r))me(s,e,t,`vendor/${f.name}`,f.autoload);s.files.push(...o);const a=T(t,"vendor"),l=zr(t);e.write(T(a,"autoload.php"),Gr),e.write(T(a,"composer/ClassLoader.php"),Br),e.write(T(a,"composer/InstalledVersions.php"),Wr),e.write(T(a,"composer/autoload_bfwc.php"),`<?php
// Generated by the BuilderForce WebContainers PHP runtime.
$baseDir = dirname(__DIR__, 2);
return ${W(s,l)};
`),e.write(T(a,"composer/installed.json"),`${JSON.stringify({packages:r,dev:i.dev,"dev-package-names":[...i.devPackages]},null,4)}
`);const c=Object.fromEntries(r.map(f=>[f.name,{pretty_version:f.version,version:f.version_normalized??f.version,reference:f.dist?.reference??f.source?.reference??null,type:f.type??"library",install_path:T(a,f.name),aliases:[],dev_requirement:i.devPackages.has(f.name)}])),u={name:n.name??"__root__",pretty_version:n.version??"dev-main",version:n.version??"dev-main",reference:null,type:"project",install_path:t,aliases:[],dev:i.dev};e.write(T(a,"composer/installed.php"),`<?php
$baseDir = dirname(__DIR__, 2);
return ${W({root:u,versions:{...c,[u.name]:{...u,dev_requirement:!1}}},l)};
`)}const Yr=/^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]?|-{0,2})[a-z0-9]+)*$/;class Be extends Error{}const At=e=>Yr.test(e)&&!xt(e),xt=e=>e.split("/").some(t=>t==="."||t===".."||t===""),We=(e,t)=>new Be(`Invalid package name "${e}" in ${t}: Composer names are vendor/package, lower-case letters, digits and [_.-] separators.`);function H(e,t){const n=e.toLowerCase();if(oe(n)||At(n))return n;throw We(e,t)}function Ne(e,t){const n=typeof e=="string"?e.toLowerCase():"";if(At(n))return n;throw We(String(e),t)}function ge(e,t){return T(e,"vendor",Ne(t,"a vendor path"))}function Jr(e){if(xt(e))throw We(e,"a repository URL");return e.split("/").map(encodeURIComponent).join("/")}function Xr(e){const n=(Array.isArray(e.repositories)?e.repositories:Object.entries(e.repositories??{}).map(([r,i])=>i===!1?{type:`${r}: false`}:i)).map(r=>r).filter(r=>!(r?.type==="composer"&&typeof r.url=="string"&&/^https:\/\/(repo\.)?packagist\.org\/?$/.test(r.url))).map(r=>typeof r?.type=="string"?r.type:"unknown");if(n.length)return`composer.json declares repositories of type ${[...new Set(n)].join(", ")}, which the PHP runtime does not support (it installs from Packagist, or the host's php.composer.repositoryUrl, only).`}function it(e){const t=[];for(const n of e){const r=/^([^:=\s]+)[:=](.+)$/.exec(n);r?t.push({name:H(r[1],"composer require"),constraint:r[2]}):!n.includes("/")&&t.length&&t[t.length-1].constraint===void 0?t[t.length-1].constraint=n:t.push({name:H(n,"composer require")})}return t}function Zr(e,t){const n=new Map;for(const s of t.values())for(const o of[...Object.keys(s.replace??{}),...Object.keys(s.provide??{})])n.set(o.toLowerCase(),s.name);const r=new Set,i=Object.keys(e.require??{}).map(s=>s.toLowerCase());for(;i.length;){const s=i.shift(),o=t.get(s)??t.get(n.get(s)??"");!o||r.has(o.name)||(r.add(o.name),i.push(...Object.keys(o.require??{}).map(a=>a.toLowerCase())))}return r}function es(e,t){return`${JSON.stringify({_readme:["This file locks the dependencies of your project to a known state","Written by the BuilderForce WebContainers PHP runtime"],...e,aliases:[],"minimum-stability":t.minimumStability,"stability-flags":{},"prefer-stable":t.preferStable,"prefer-lowest":!1,platform:{},"platform-dev":{},"plugin-api-version":"2.6.0"},null,4)}
`}class F extends Error{}const Ce=e=>De(e.version_normalized??e.version),ot=e=>Object.entries(e.require??{}).map(([t,n])=>({name:H(t,`${e.name}'s require`),constraint:n,from:e.name})),at=e=>[...Object.keys(e.replace??{}),...Object.keys(e.provide??{})].map(t=>t.toLowerCase());function lt(e,t,n){return It(e,t,n)[0]}function It(e,t,n,r){const i=t.reduce((l,c)=>c.stability&&Qe({stability:l},c.stability)?c.stability:l,n.minimumStability),s=e.map(l=>({pkg:l,version:Ce(l)})).filter(l=>!!l.version&&Qe(l.version,i)&&t.every(c=>c.test(l.version))).sort((l,c)=>an(c.version,l.version)),o=n.preferStable?[...s.filter(l=>l.version.stability==="stable"),...s.filter(l=>l.version.stability!=="stable")]:s,a=r===void 0?-1:o.findIndex(l=>l.pkg.version===r);return a>0&&o.unshift(...o.splice(a,1)),o.map(l=>l.pkg)}function ct(e,t){return t.map(n=>{const r=yt(n.constraint);if(!r)throw new F(`Cannot read the version constraint "${n.constraint}" on ${e} (required by ${n.from}).`);return r})}async function ts(e,t,n,r={}){const i=new Set(at(r)),s={steps:n.maxSteps??2e4};let o="",a=-1;const l=(p,d)=>{p>=a&&(o=d,a=p)},c=new Map,u=async p=>(c.has(p)||c.set(p,await t.versions(p)),c.get(p)),f=p=>{const d=[{from:"root",conflict:r.conflict},...[...p.values()].map(_=>({from:_.name,conflict:_.conflict}))];for(const{from:_,conflict:g}of d)for(const[w,b]of Object.entries(g??{})){const P=w.toLowerCase(),A=yt(b),E=p.get(P),C=E&&Ce(E);if(C&&A?.test(C))return`${_} conflicts with ${E.name} ${b}`;for(const O of p.values()){const N={...O.provide,...O.replace},q=Object.entries(N).find(([m])=>m.toLowerCase()===P)?.[1];if(q===void 0)continue;const y=De(q==="self.version"?O.version_normalized??O.version:q.replace(/^[=\s]+/,""));if(y&&A?.test(y))return`${_} conflicts with ${P} ${b} (${O.name} ${q==="self.version"?"replaces/provides it":`provides ${q}`})`}}},$=async p=>{if(--s.steps<0)throw new F("Dependency resolution took too long; pin the conflicting packages in composer.json.");const d=new Map;for(const E of[...e,...[...p.values()].flatMap(ot)])oe(E.name)||d.set(E.name,[...d.get(E.name)??[],E]);const _=new Set([...i,...[...p.values()].flatMap(at)]);for(const[E,C]of p){const O=d.get(E)??[],N=Ce(C),q=ct(E,O),y=O.find((m,v)=>!q[v].test(N));if(y){l(p.size,`${E} ${C.version} was chosen, but ${y.from} requires ${E} ${y.constraint}.`);return}}const g=f(p);if(g){l(p.size,`${g}.`);return}const w=[...d.keys()].filter(E=>!p.has(E)&&!_.has(E));let b;for(const E of w)if(await u(E)){b=E;break}if(b===void 0){if(!w.length)return p;const E=w[0];l(p.size,`Package ${E} (required by ${d.get(E).map(C=>C.from).join(", ")}) was not found in the repository, and no chosen package provides or replaces it.`);return}const P=d.get(b),A=It(await u(b),ct(b,P),n,n.preferred?.get(b));if(!A.length){l(p.size,`No version of ${b} satisfies ${P.map(E=>`${E.constraint} (required by ${E.from})`).join(" and ")} at minimum-stability ${n.minimumStability}.`);return}for(const E of A){const C=n.platform&&Object.entries(E.require??{}).map(([N,q])=>oe(N.toLowerCase())?_t(N,q,n.platform):void 0).find(Boolean);if(C){l(p.size,`${E.name} ${E.version} is declined: ${C}`);continue}try{ot(E)}catch(N){if(!(N instanceof Be))throw N;l(p.size,`${E.name} ${E.version} is skipped: ${N.message}`);continue}const O=await $(new Map([...p,[b,E]]));if(O)return O}},h=await $(new Map);if(!h)throw new F(o||"No installable set of packages satisfies composer.json.");return{packages:h}}function ns(e,t){return[...Object.entries(e.require??{}),...t?[]:Object.entries(e["require-dev"]??{})].map(([r,i])=>({name:r.toLowerCase(),constraint:i,from:"root"}))}class G extends Error{}const rs=["pre-install-cmd","post-install-cmd","pre-update-cmd","post-update-cmd","post-autoload-dump","post-root-package-install","post-create-project-cmd"],ne=(e,t)=>{try{return JSON.parse(e)}catch(n){throw new G(`${t} does not contain valid JSON: ${n instanceof Error?n.message:String(n)}`)}};function _e(e,t,n,r){return[...Object.entries({...e.require,...n?e["require-dev"]:{}}).map(([o,a])=>({name:o,constraint:a,from:"your project"})),...t.flatMap(o=>Object.entries(o.require??{}).map(([a,l])=>({name:a,constraint:l,from:o.name})))].flatMap(({name:o,constraint:a,from:l})=>{const c=oe(o.toLowerCase())?_t(o,a,r):void 0;return c?[`${l} requires ${o} ${a}: ${c}`]:[]})}async function ss(e,t){const{files:n,projectDir:r}=t,i=T(r,"composer.json"),s=T(r,"composer.lock"),o=T(r,"vendor/composer/installed.json"),a=n.read(i),l=n.read(s),c=!e.noDev;try{if(a===void 0&&e.command!=="require")throw new G(`Composer could not find a composer.json file in ${r}`);const u=ne(a??"{}",i),f=Xr(u);if(f)throw new G(f);for(const y of["require","require-dev","replace","provide","conflict"])for(const m of Object.keys(u[y]??{}))H(m,`composer.json ${y}`);const h=(()=>{const y=n.read(o);if(y===void 0)return{packages:[],devNames:[]};const m=ne(y,o);for(const v of m.packages??[])Ne(v.name,o);return{packages:m.packages??[],devNames:m["dev-package-names"]??[]}})();if(e.command==="dump-autoload"){const{packages:y,devNames:m}=h,v=new Set(m);return st(n,r,u,c?y:y.filter(k=>!v.has(k.name)),{dev:c,devPackages:c?v:new Set}),t.out(`Generating autoload files
Generated autoload files
`),0}const p={minimumStability:ln(u["minimum-stability"]),preferStable:!!u["prefer-stable"]};if(e.command==="require"){const y=e.dev?"require-dev":"require";for(const{name:m,constraint:v}of it(e.packages)){let k=v;if(!k){const S=await t.source.versions(m),I=S?.filter(Wt=>e.ignorePlatformReqs||!_e({},[Wt],!1,t.platform).length),R=I&&lt(I,[],p),j=!R&&S&&lt(S,[],p);if(j)throw new F(`${j.name} ${j.version} is declined: ${_e({},[j],!1,t.platform).join("; ")}`);const Z=R&&De(R.version_normalized??R.version);if(!Z||Z.branch)throw new F(`Could not find a stable version of package ${m}.`);k=`^${Z.parts[0]}.${Z.parts[1]}`}u[y]={...u[y],[m]:k},t.err(`./composer.json has been updated (${m}: ${k})
`)}}const d=`${JSON.stringify(u,null,4)}
`;let _=e.command==="install"&&l!==void 0?ne(l,s):void 0,g=!1;if(_){t.err("Installing dependencies from lock file"+(c?" (including require-dev)":"")+`
`);for(const y of[..._.packages??[],..._["packages-dev"]??[]])Ne(y.name,s);_["content-hash"]&&_["content-hash"]!==await t.contentHash(a??d)&&t.err("Warning: The lock file is not up to date with the latest changes in composer.json. Run `composer update`.\n")}else{t.err(e.command==="install"?`No composer.lock file present. Updating dependencies to latest instead of installing from lock file.
`:`Updating dependencies
`);const y=e.command==="require"?it(e.packages).map(R=>R.name):e.packages.map(R=>H(R,"composer update")),m=y.length&&l!==void 0?ne(l,s):void 0,v=new Map([...m?.packages??[],...m?.["packages-dev"]??[]].filter(R=>!y.includes(R.name)).map(R=>[R.name,R.version])),k=await ts(ns(u,!1),t.source,{...p,preferred:v,platform:e.ignorePlatformReqs?void 0:t.platform},u);for(const R of k.packages.values())t.err(`  - Locking ${R.name} (${R.version})
`);const S=Zr(u,k.packages),I=[...k.packages.values()].sort((R,j)=>R.name.localeCompare(j.name));_={"content-hash":await t.contentHash(d),packages:I.filter(R=>S.has(R.name)),"packages-dev":I.filter(R=>!S.has(R.name))},g=!0}const w=[..._.packages??[],...c?_["packages-dev"]??[]:[]],b=new Set(c?(_["packages-dev"]??[]).map(y=>y.name):[]),P=e.ignorePlatformReqs?[]:_e(u,w,c,t.platform);if(P.length)throw new G(`Your requirements could not be resolved to an installable set of packages.
${P.map(y=>`  - Declined: ${y}`).join(`
`)}`);e.command==="require"&&n.write(i,d),g&&(n.write(s,es(_,p)),t.err(`Writing lock file
`));const A=new Map(h.packages.map(y=>[y.name,y])),E=(y,m)=>!!y&&y.version===m.version&&(y.dist?.reference??null)===(m.dist?.reference??null)&&n.isDir(ge(r,m.name)),C=w.filter(y=>!E(A.get(y.name),y)),O=[...A.keys()].filter(y=>!w.some(m=>m.name===y));t.err(`Package operations: ${C.length} install${C.length===1?"":"s"}, 0 updates, ${O.length} removal${O.length===1?"":"s"}
`);const N=[];for(const y of C){t.err(`  - Downloading ${y.name} (${y.version})
`);const m=await t.source.files(y);for(const v of m.keys())if(v.split("/").some(k=>k===".."||k==="."||k===""))throw new G(`${y.name} ${y.version} holds a file outside its directory ("${v}").`);N.push([y,m])}for(const y of O)n.remove(ge(r,y)),t.err(`  - Removing ${y}
`);for(const[y,m]of N){const v=ge(r,y.name);t.err(`  - Installing ${y.name} (${y.version})
`),n.remove(v);for(const[k,S]of m)n.write(T(v,k),S);y.type==="composer-plugin"&&t.err(`    ${y.name} is a Composer plugin; plugins do not run in the PHP runtime.
`)}!C.length&&!O.length&&t.err(`Nothing to install, update or remove
`),t.err(`Generating autoload files
`),st(n,r,u,w,{dev:c,devPackages:b});const q=rs.filter(y=>u.scripts?.[y]!==void 0);return q.length&&t.err(`Composer scripts do not run in the PHP runtime (${q.join(", ")}); run their commands yourself if needed.
`),0}catch(u){(e.command==="require"||e.command==="update")&&(a===void 0?n.remove(i):n.read(i)!==a&&n.write(i,a),l===void 0?n.remove(s):n.read(s)!==l&&n.write(s,l));const f=u instanceof F||u instanceof G||u instanceof Be,$=u instanceof F?`Your requirements could not be resolved to an installable set of packages.
  `:"";return t.err(`${$}${u instanceof Error?u.message:String(u)}
`),f?2:1}}const is="https://packagist.org/packages/{name}.json",os="https://cdn.jsdelivr.net/gh/",as="https://data.jsdelivr.com/v1/packages/gh/";function ls(e){const t=[];let n={};for(const r of e){const i={...n};for(const[s,o]of Object.entries(r))o==="__unset"?delete i[s]:i[s]=o;t.push(i),n=i}return t}function cs(e,t){const n=t;if(n.package?.versions)return Object.values(n.package.versions).map(i=>({...i,name:e}));const r=n.packages?.[e];if(Array.isArray(r))return(n.minified?ls(r):r).map(i=>({...i,name:e}));if(r)return Object.values(r).map(i=>({...i,name:e}))}function ut(e){const t=e&&/^https:\/\/(?:api\.)?github\.com\/(?:repos\/)?([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/.exec(e);return t?{owner:t[1],repo:t[2]}:void 0}const B={maxEntries:5e4,maxTotalBytes:256*1024*1024,maxEntryBytes:64*1024*1024},Ae=128*1024*1024;class L extends Error{}function us(e){const t=new bt;try{vn(t,e,"/",B)}catch(o){throw o instanceof En?new L(o.message):o}const n=t.list(),r=new Set(n.map(o=>o.split("/")[1])),i=r.size===1&&n.every(o=>o.split("/").length>2)?`/${[...r][0]}/`:"/",s=new Map;for(const o of n){const a=t.readFile(o);s.set(o.slice(i.length),typeof a=="string"?new TextEncoder().encode(a):a??new Uint8Array)}return s}async function xe(e,t){const n=await e(t);if(!n.ok)throw new Error(`GET ${t}: ${n.status} ${n.statusText}`);return n}async function ce(e,t,n){const r=Number(e.headers.get("content-length"));if(r>t)throw new L(`${n} is ${r} bytes, over the ${t}-byte limit.`);if(!e.body)return new Uint8Array(await e.arrayBuffer());const i=e.body.getReader(),s=[];let o=0;for(;;){const{value:c,done:u}=await i.read();if(u)break;if(o+=c.byteLength,o>t)throw await i.cancel(),new L(`${n} exceeds the ${t}-byte limit.`);s.push(c)}const a=new Uint8Array(o);let l=0;for(const c of s)a.set(c,l),l+=c.byteLength;return a}async function fs(e,t,n){if(!t)return;const i=[...new Uint8Array(await crypto.subtle.digest("SHA-1",e))].map(s=>s.toString(16).padStart(2,"0")).join("");if(i!==t.toLowerCase())throw new L(`${n}: checksum mismatch (sha1 ${i}, metadata says ${t}).`)}function ds(e,t){let n;try{n=new URL(e)}catch{throw new L(`${t}: dist URL "${e}" is not an absolute URL.`)}const r=n.hostname==="localhost"||n.hostname==="[::1]"||/^127\./.test(n.hostname);if(n.protocol!=="https:"&&!(n.protocol==="http:"&&r))throw new L(`${t}: dist URL "${e}" is not https.`)}const ps=/^[A-Za-z0-9._-]+$/;async function $s(e,t,n,r){if(![t,n,r].every(l=>ps.test(l)))throw new L(`Refusing GitHub source ${t}/${n}@${r}: not a plain repository and commit.`);const s=(JSON.parse(new TextDecoder().decode(await ce(await xe(e,`${as}${t}/${n}@${r}?structure=flat`),Ae,"The jsDelivr listing"))).files??[]).map(l=>l.name);if(s.length>B.maxEntries)throw new L(`${t}/${n} has ${s.length} files, over the ${B.maxEntries}-entry limit.`);for(const l of s)if(!l.startsWith("/")||l.split("/").some(c=>c===".."||c==="."))throw new L(`Refusing file "${l}" in ${t}/${n}.`);const o=new Map;let a=0;for(let l=0;l<s.length;l+=8)await Promise.all(s.slice(l,l+8).map(async c=>{const u=await ce(await xe(e,`${os}${t}/${n}@${r}${c.split("/").map(encodeURIComponent).join("/")}`),B.maxEntryBytes,c);if(a+=u.byteLength,a>B.maxTotalBytes)throw new L(`${t}/${n} exceeds the ${B.maxTotalBytes}-byte limit.`);o.set(c.slice(1),u)}));return o}function hs(e={}){const t=e.fetch??((i,s)=>fetch(i,s)),n=e.repositoryUrl??is,r=new Map;return{versions(i){let s;try{s=H(i,"a package request")}catch(a){return Promise.reject(a)}let o=r.get(s);return o||(o=(async()=>{const a=await t(n.replace("{name}",Jr(s)));if(a.status!==404){if(!a.ok)throw new Error(`Package metadata for ${s}: ${a.status} ${a.statusText}`);return cs(s,JSON.parse(new TextDecoder().decode(await ce(a,Ae,`Package metadata for ${s}`))))}})(),r.set(s,o)),o},async files(i){const s=i.dist,o=ut(s?.url)??ut(i.source?.url??void 0),a=s?.reference??i.source?.reference,l=`${i.name} ${i.version}`;if(s?.url&&(s.type??"zip")==="zip"){ds(s.url,l);const c=e.distProxy?`${e.distProxy}${encodeURIComponent(s.url)}`:s.url;let u;try{u=await xe(t,c)}catch(f){if(!o||!a||e.distProxy)throw f}if(u){const f=await ce(u,Ae,l);return await fs(f,s.shasum,l),us(f)}}if(o&&a)return $s(t,o.owner,o.repo,a);throw new Error(`${l} has no zip dist or GitHub source the PHP runtime can fetch.`)}}}const qt=e=>e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength);function ms(e){const t=e.getReader();return new ReadableStream({async pull(n){const{value:r,done:i}=await t.read();if(i)return n.close();const s=qt(r);s.byteLength&&n.enqueue(s.slice())},cancel:n=>t.cancel(n)})}async function Dt(e,t){const n=e.getReader();for(;;){const{value:r,done:i}=await n.read();if(i)return;const s=qt(r);s.byteLength&&t(s.slice())}}async function Lt(e,t){const n=new TextDecoder;await Dt(e,i=>{const s=n.decode(i,{stream:!0});s&&t(s)});const r=n.decode();r&&t(r)}const re="/bfwc/php-server-front.php",Mt="x-bfwc-router-declined";function gs(e){return["<?php",...Object.entries(e).map(([n,r])=>`ini_set(${Oe(n)}, ${Oe(r)});`),"if (($_SERVER['HTTPS'] ?? '') === 'off') unset($_SERVER['HTTPS']);","if ((require $_SERVER['SCRIPT_FILENAME']) === false && !headers_sent()) header('X-Bfwc-Router-Declined: 1');",""].join(`
`)}const _s=e=>/\.[^/]+$/.test(e);function ys(e,t,n){const r=qe(e),i=l=>l==="/"?t:T(t,l),s=(l,c,u)=>l.endsWith(".php")?{kind:"script",file:l,scriptName:c,pathInfo:u}:{kind:"file",file:l},o=l=>["index.php","index.html"].map(c=>({url:T(l,c),file:T(i(l),c)})).find(({file:c})=>n.isFile(c));if(n.isFile(i(r)))return s(i(r),r);if(n.isDir(i(r))){const l=o(r);if(l)return s(l.file,l.url)}const a=r.split("/").filter(Boolean);for(let l=a.length-1;l>0;l--){const c=`/${a.slice(0,l).join("/")}`;if(c.endsWith(".php")&&n.isFile(i(c)))return s(i(c),c,`/${a.slice(l).join("/")}`)}if(_s(r))return{kind:"missing"};for(let l=a.length;l>=0;l--){const c=`/${a.slice(0,l).join("/")}`;if(!n.isDir(i(c)))continue;const u=o(c);if(u)return s(u.file,u.url,r===c?void 0:r.slice(c==="/"?0:c.length)||void 0)}return{kind:"missing"}}const ft=e=>({status:404,headers:{"content-type":"text/html; charset=UTF-8"},body:wt(new TextEncoder().encode(`<!doctype html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested resource <code>${e.replace(/[<>&"]/g,"")}</code> was not found on this server.</p></body></html>`))});function ws(e){const t={};for(const[n,r]of Object.entries(e)){const i=n.toLowerCase();i===Mt||!r.length||(t[i]=r.length===1?r[0]:[...r])}return t}async function bs(e,t){const{php:n,files:r,docroot:i,router:s}=t;r.mkdirTree(re.slice(0,re.lastIndexOf("/"))),r.write(re,gs(e.ini)),n.chdir(i);const o=e.host.replace(/^\[|\]$/g,""),a=`${o.includes(":")?`[${o}]`:o}:${e.port}`,l=async(f,$)=>{const h=f.url.includes("?")?f.url.slice(f.url.indexOf("?")+1):"",p={DOCUMENT_ROOT:i,SCRIPT_FILENAME:$.file,SCRIPT_NAME:$.scriptName,PHP_SELF:$.scriptName+($.pathInfo??""),SERVER_NAME:o,SERVER_PORT:String(e.port),SERVER_PROTOCOL:"HTTP/1.1",SERVER_SOFTWARE:`PHP ${t.phpVersion} Development Server (php-wasm, BuilderForce WebContainers)`,REMOTE_ADDR:"127.0.0.1",QUERY_STRING:h};return $.pathInfo&&(p.PATH_INFO=$.pathInfo),n.runStream({scriptPath:re,relativeUri:f.url,method:f.method.toUpperCase(),headers:{host:a,...f.headers},protocol:"http",body:f.body??void 0,env:t.env,$_SERVER:p})},c=async(f,$,h)=>{if(h.kind==="missing")return ft($);if(h.kind==="file")return{status:200,headers:{"content-type":Pn(cn(h.file))},body:wt(r.read(h.file))};const p=await l(f,h);Lt(p.stderr,t.log).catch(()=>{});const[d,_]=await Promise.all([p.httpStatusCode,p.headers]);return _[Mt]?.length?(p.stdout.cancel(),"declined"):{status:d,headers:ws(_),body:ms(p.stdout)}};return{spec:e,handle:async f=>{const $=f.url.split("?")[0].split("#")[0];let h;try{h=decodeURIComponent($)||"/"}catch{return Xe(400,"Bad Request")}try{let p=s?await c(f,h,{kind:"script",file:s,scriptName:s.startsWith(`${i}/`)?s.slice(i.length):`/${s.split("/").pop()}`}):"declined";return p==="declined"&&(p=await c(f,h,ys(h,i,r)),p==="declined"&&(p=ft(h))),t.log(`[${p.status}]: ${f.method.toUpperCase()} ${f.url}
`),p}catch(p){const d=p instanceof Error?p.message:String(p);return t.log(`[500]: ${f.method.toUpperCase()} ${f.url} - ${d}
`),Xe(500,`PHP failed to handle the request: ${d}`)}}}}const Y=fe;function vs(e){const t=r=>Me(e,r).flatMap(i=>Y(e,T(r,i))?t(T(r,i)):[T(r,i)]);return{read:r=>Te(e,r)?new TextDecoder().decode(e.readFile(r)):void 0,write(r,i){e.mkdirTree(ue(r)),e.writeFile(r,i)},isDir:r=>Y(e,r),list:r=>Y(e,r)?t(r):[],remove:r=>le(e,r)}}async function Ut(e,t){const n=await e.php.run({code:t});if(n.exitCode!==0)throw new Error(`PHP failed: ${n.errors||n.text}`);return n.text}const Es=e=>`<?php
$c = json_decode(base64_decode('${kn(new TextEncoder().encode(e))}'), true) ?: [];
$keys = ['name', 'version', 'require', 'require-dev', 'conflict', 'replace', 'provide', 'minimum-stability', 'prefer-stable', 'repositories', 'extra'];
$r = array_intersect_key($c, array_flip($keys));
if (isset($c['config']['platform'])) { $r['config']['platform'] = $c['config']['platform']; }
ksort($r);
echo md5(json_encode($r));`;async function Ft(e,t){const[n,r]=JSON.parse(await Ut(e,'<?php echo json_encode([PHP_VERSION, array_map("strtolower", get_loaded_extensions())]);')),i={phpVersion:n,extensions:new Set(r)};return t.platformKnown?.(i),i}async function Ps(e,t,n){const r=await Ft(e,n),i=t.workingDir?U(n.cwd,t.workingDir):n.cwd;return ss(t,{files:vs(e.module.FS),source:hs({...n.composer,fetch:n.fetch}),platform:r,projectDir:i,contentHash:s=>Ut(e,Es(s)),out:s=>n.io.stdout(s),err:s=>n.io.stderr(s)})}async function ks(e,t,n){const{php:r,module:i}=e;if(t.kind==="composer")return{kind:"exited",code:await Ps(e,t,n)};if(t.kind==="serve"){await r.setSapiName("cli-server");const o=(await Ft(e,n)).phpVersion,a=t.server.docroot?U(n.cwd,t.server.docroot):n.cwd;if(!Y(i.FS,a))return n.io.stderr(`Directory ${t.server.docroot} does not exist.
`),{kind:"exited",code:1};const l=t.server.router?U(n.cwd,t.server.router):void 0;if(l&&!Te(i.FS,l))return n.io.stderr(`Could not open input file: ${t.server.router}
`),{kind:"exited",code:1};const c=await bs(t.server,{php:r,files:{isFile:u=>Te(i.FS,u),isDir:u=>Y(i.FS,u),read:u=>i.FS.readFile(u),write:(u,f)=>i.FS.writeFile(u,f),mkdirTree:u=>i.FS.mkdirTree(u)},docroot:a,router:l,env:{...n.env},log:u=>n.io.stderr(u),phpVersion:o});return{kind:"serving",server:{port:c.spec.port,handle:c.handle,close:async()=>{}},banner:`[${new Date().toUTCString()}] PHP ${o} Development Server (http://${t.server.host}:${t.server.port}) started (request-driven)
`}}const s=await r.cli(["php",...t.argv],{env:{...n.env}});return await Promise.all([Dt(s.stdout,o=>n.io.stdout(o)),Lt(s.stderr,o=>n.io.stderr(o))]),{kind:"exited",code:await s.exitCode}}const Ss=String.raw`<?php
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
`,Ts=String.raw`<?php
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
`,Rs=String.raw`<?php
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
`,Os=String.raw`<?php
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
`,Ns=String.raw`<?php
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
`,Cs=String.raw`<?php
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
`,As=String.raw`<?php
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
`,xs=String.raw`<?php
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
`,J="/bfwc",ye="/internal/shared/auto_prepend_file.php",Is=`<?php
spl_autoload_register(static function (string $class): void {
    // Class names are case-insensitive: keys are lower-case, and so is the lookup (PDOPgsql finds pdopgsql).
    static $files = ['bfwc\\pgsql\\wire' => 'wire.php', 'bfwc\\pgsql\\exception' => 'wire.php', 'bfwc\\pgsql\\pdo' => 'pdo.php', 'bfwc\\pgsql\\statement' => 'statement.php', 'bfwc\\pgsql\\rewriter' => 'rewriter.php', 'pdo\\pgsql' => 'pdo-pgsql.php', 'bfwc\\pgsql\\pg' => 'pg.php', 'pgsql\\connection' => 'pg.php', 'pgsql\\result' => 'pg.php'];
    $file = $files[strtolower($class)] ?? null;
    if ($file !== null) {
        require_once '${J}/pgsql/' . $file;
    }
});
require_once '${J}/pgsql/includes.php';
if (!function_exists('pg_connect')) {
    require_once '${J}/pgsql/functions.php';
}
\\Bfwc\\Pgsql\\Includes::register();
if (\\Bfwc\\Pgsql\\Includes::rewritesPrimary()) {
    require \\Bfwc\\Pgsql\\Includes::$primary;
    exit;
}
`,qs={"prepend.php":Is,"pgsql/wire.php":xs,"pgsql/pdo.php":Rs,"pgsql/statement.php":As,"pgsql/includes.php":Ss,"pgsql/rewriter.php":Cs,"pgsql/functions.php":Os,"pgsql/pg.php":Ns,"pgsql/pdo-pgsql.php":Ts};function Ds(e){for(const[r,i]of Object.entries(qs)){const s=`${J}/${r}`;e.mkdirTree(s.slice(0,s.lastIndexOf("/"))),e.writeFile(s,i)}const t=`
require_once '${J}/prepend.php';
`,n=X(e,ye)?new TextDecoder().decode(e.readFile(ye)):`<?php
`;n.includes(t)||e.writeFile(ye,`${n.replace(/\?>\s*$/,"")}${t}`)}const Ls=e=>/^127\./.test(e)||e==="0.0.0.0"||e==="::1"||e==="localhost",Ms=/^bfwc-tcp:\/\/\[?([^\]]*)\]?:(\d+)$/,we=0,be=1,dt=2,Q=3;function Us(e){return class{url;CONNECTING=we;OPEN=be;CLOSING=dt;CLOSED=Q;readyState=we;binaryType="arraybuffer";onopen=null;onmessage=null;onclose=null;onerror=null;listeners=new Map;channel;constructor(n){this.url=n;const r=Ms.exec(n),i=r?.[1]??"",s=Number(r?.[2]);if(!r||!Ls(i)){queueMicrotask(()=>this.fail());return}e(s).then(o=>{if(!o)return this.fail();if(this.readyState!==we)return o.close();this.channel=o,this.readyState=be,o.onData(a=>this.emit("message",a)),o.onClose(()=>this.ended()),this.emit("open")},()=>this.fail())}send(n){if(this.readyState!==be||!this.channel)return;const r=n instanceof ArrayBuffer?new Uint8Array(n):new Uint8Array(n.buffer,n.byteOffset,n.byteLength);this.channel.send(r.slice())}setSocketOpt(){}close(){this.readyState===dt||this.readyState===Q||(this.channel?.close(),this.ended())}on(n,r){return this.add(n,r,!1,!1)}once(n,r){return this.add(n,r,!0,!1)}addEventListener(n,r){this.add(n,r,!1,!0)}removeListener(n,r){return this.listeners.set(n,(this.listeners.get(n)??[]).filter(i=>i.listener!==r)),this}off(n,r){return this.removeListener(n,r)}removeEventListener(n,r){this.removeListener(n,r)}add(n,r,i,s){return this.listeners.set(n,[...this.listeners.get(n)??[],{listener:r,once:i,dom:s}]),this}emit(n,r){const i=this.listeners.get(n)??[];this.listeners.set(n,i.filter(l=>!l.once));const s=r?r.slice().buffer:void 0,o={type:n,target:this,data:s};for(const{listener:l,dom:c}of i)c?l(o):r?l(r,!0):l();const a={open:this.onopen,message:this.onmessage,close:this.onclose,error:this.onerror}[n];a?.(o)}ended(){this.readyState!==Q&&(this.readyState=Q,this.channel=void 0,queueMicrotask(()=>this.emit("close")))}fail(){this.readyState!==Q&&(this.emit("error"),this.ended())}}}function Fs(e,t){const n=e.websocket??={};n.url=(i,s,o)=>`bfwc-tcp://${s.includes(":")?`[${s}]`:s}:${o}`,n.subprotocol="binary";const r=Us(t);n.decorator=()=>r}const js=(e,t)=>`[${new Date().toUTCString()}] Failed to listen on ${e}:${t} (reason: Address already in use)
`;function $i(e){const t=e.dial?void 0:Le(e.post),n=e.dial??(i=>t.dial(i));let r="localhost";return je(e.post,i=>{async function s(a,l){const c=await e.loadPhp({baseUrl:a.php?.baseUrl,phpVersion:ze(a.php?.phpVersion)});Fs(c.module,n),Ds(c.module.FS),Ue(l,c.module.FS);const u=Ct(c.module.FS,f=>{i.exited||e.post({type:"fs",ops:f})});return i.mounted({apply:f=>u.quietly(()=>Fe(c.module.FS,f)),flush:()=>u.flush()}),c.php.chdir(x(a.cwd)),c}async function o(a,l,c,u){const f=await s(a,c);return u.exited?{kind:"exited",code:0}:ks(f,l,{cwd:x(a.cwd),env:a.env,io:u.io,composer:a.php?.composer,fetch:e.fetch,platformKnown:$=>e.post({type:"php-platform",phpVersion:$.phpVersion,extensions:[...$.extensions]})})}return{addressInUse:a=>js(r,a),plan(a){const l=un(a.command,a.args);if(!l.ok)return{ok:!1,message:`${a.command}: ${l.reason}
`,code:1};try{ze(a.php?.phpVersion)}catch(u){return{ok:!1,message:`${u.message}
`,code:1}}const c=fn(l.invocation,x);return c.kind==="serve"&&(r=c.server.host),{ok:!0,port:c.kind==="serve"?c.server.port:void 0,run:u=>o(a,c,u,i)}},receive:a=>!!t?.receive(a)}})}function Gs(e){return[...e.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(t=>t[1]??t[2]??t[3])}function Bs(e,t,n,r){if(n===null)return{ok:!0};const i=T(t,"Properties","launchSettings.json"),s=e(i);if(s===void 0)return n?{ok:!1,reason:`The launch profile "${n}" could not be applied: ${i} does not exist.`}:{ok:!0};let o;try{o=JSON.parse(s).profiles??{}}catch(f){return{ok:!1,reason:`A JSON parsing exception occurred in ${i}: ${f.message}`}}const a=n?Object.entries(o).find(([f])=>f===n):Object.entries(o).find(([,f])=>f.commandName==="Project");if(!a)return n?{ok:!1,reason:`The launch profile "${n}" could not be applied: it is not in ${i}.`}:{ok:!0};const[l,c]=a,u={};for(const[f,$]of Object.entries(c.environmentVariables??{}))u[f]=String($);return c.applicationUrl&&r.ASPNETCORE_URLS===void 0&&u.ASPNETCORE_URLS===void 0&&(u.ASPNETCORE_URLS=c.applicationUrl),{ok:!0,profile:{name:l,env:u,args:c.commandLineArgs?Gs(c.commandLineArgs):[]}}}class D extends Error{name="DotnetBundleError"}const Ws="/dotnet/refs",pt="bfwc-dotnet-",jt=e=>e.endsWith("/")?e:`${e}/`,Hs=e=>e instanceof Error?e.message:String(e);async function He(e){const t=new Uint8Array(await crypto.subtle.digest("SHA-256",e));return Array.from(t,n=>n.toString(16).padStart(2,"0")).join("")}function Vs(e){const t=e.Bfwc?.Host?.Exports;if(!t)throw new D("The .NET runtime bundle has no Bfwc.Host.Exports: it was not built from dotnet-host/.");return t}async function Ie(e,t,n){try{return await e(t,n)}catch(r){throw new D(`The .NET runtime bundle could not be reached (${t}: ${Hs(r)}).`)}}async function Gt(e,t){const n=`${jt(e)}manifest.json`,r=await Ie(t,n);if(!r.ok)throw new D(`The .NET runtime bundle's manifest could not be loaded (${n}: HTTP ${r.status}).`);const i=await r.text();let s;try{s=JSON.parse(i)}catch{throw new D(`The .NET runtime bundle's manifest (${n}) is not JSON.`)}if(s?.format!==Ke.format)throw new D(`The .NET runtime bundle at ${e} is format ${String(s?.format)}; this runtime reads format ${Ke.format}. Rebuild it with scripts/build-dotnet-runtime.mjs.`);return{manifest:s,text:i}}async function Qs(e,t=fetch){return(await Gt(e,t)).manifest}async function zs(e,t){const n=globalThis.caches;if(!n)return(s,o)=>Ie(t,s,o);const r=`${pt}${(await He(new TextEncoder().encode(e))).slice(0,32)}`;let i;try{i=await n.open(r);for(const s of await n.keys())s.startsWith(pt)&&s!==r&&n.delete(s)}catch{i=void 0}return async(s,o)=>{const a=await i?.match(s).catch(()=>{});if(a)return a;const l=await Ie(t,s,o);return l.ok&&i&&await i.put(s,l.clone()).catch(()=>{}),l}}async function $t(e,t,n,r){const i=n.files?.[r];if(!i)throw new D(`The .NET runtime bundle's manifest has no hash for ${r}: rebuild it with scripts/build-dotnet-runtime.mjs.`);const s=await e(new URL(r,t).href);if(!s.ok)throw new D(`${r} of the .NET runtime bundle could not be loaded (HTTP ${s.status}).`);const o=new Uint8Array(await s.arrayBuffer());if(await He(o)!==i)throw new D(`${r} of the .NET runtime bundle does not match its manifest's hash: refusing it.`);return o}async function Ks(e,t,n){const r=[];for(const i of n){const{offset:s,length:o}=i;if(!(Number.isSafeInteger(s)&&Number.isSafeInteger(o)&&s>=0&&o>=0&&s+o<=t.byteLength)||!/^[\w.-]+\.dll$/i.test(i.name))throw new D(`The "${e}" reference pack's entry ${JSON.stringify(i.name)} is out of bounds or misnamed: refusing it.`);const l=t.subarray(s,s+o);if(await He(l)!==i.sha256)throw new D(`${e}/${i.name} does not match its manifest's hash: refusing it.`);r.push({name:i.name,bytes:l})}return r}async function hi(e){const t=e.fetch??((p,d)=>fetch(p,d)),n=jt(e.bundleUrl),{manifest:r,text:i}=await Gt(n,t),s=await zs(i,t);await $t(s,n,r,r.entry);const o=e.importModule??(p=>import(p)),{dotnet:a}=await o(new URL(r.entry,n).href);let l=a.withEnvironmentVariables(e.env).withModuleConfig({onExit:p=>e.onExit?.(p)});globalThis.caches&&(l=l.withResourceLoader((p,d,_,g)=>p==="dotnetjs"?void 0:s(_,g?{integrity:g}:void 0)));const c=await l.create();c.setModuleImports("bfwc",e.imports);const u=Vs(await c.getAssemblyExports(r.assembly)),f=c.Module.FS,$=new Map;async function h(p){const d=$.get(p);if(d)return d;const _=r.references[p];if(!_)throw new D(`The .NET runtime bundle has no "${p}" reference assemblies.`);const g=await Ks(p,await $t(s,n,r,_.pack),_.files),w=`${Ws}/${p}`;f.mkdirTree(w);const b=new Map;for(const P of g){const A=`${w}/${P.name}`;f.writeFile(A,P.bytes),b.set(`${p}/${P.name}`,A)}return $.set(p,b),b}return{exports:u,FS:f,manifest:r,async mountReferences(p){const d=new Map;for(const _ of new Set(p))for(const[g,w]of await h(_))d.set(g,w);return d}}}function Ys(e){const t={};for(const[n,r]of Object.entries(JSON.parse(e)))t[n.toLowerCase()]=r.length===1?r[0]:r;return t}function Js(e){let t;const n=new Set,r=new Map,i=new Map;let s=1,o=1;const a=c=>u=>new Promise((f,$)=>{if(!t)return $(new Error("The .NET runtime is not running."));const h=s++;r.set(h,{resolve:f,reject:$}),t.Request(h,c,u.method,u.url,JSON.stringify(u.headers),u.body??new Uint8Array(0))});return{imports:{stdout:c=>e.stdout(c),stderr:c=>e.stderr(c),listen(c){return e.taken.has(c)&&!n.has(c)?!1:(e.taken.add(c),n.add(c),e.post({type:"listen",port:c}),!0)},unlisten(c){n.delete(c)&&(e.taken.delete(c),e.post({type:"unlisten",port:c}))},respondHead(c,u,f){const $=r.get(c);if(!$)return;const h=new ReadableStream({start:p=>{$.body=p},cancel:()=>{r.delete(c),t?.CancelRequest(c)}});$.resolve({status:u,headers:Ys(f),body:h})},respondChunk(c,u){r.get(c)?.body?.enqueue(u.slice())},respondEnd(c,u){const f=r.get(c);if(r.delete(c),!!f){if(!f.body)return f.reject(new Error(u??"The response ended before its head."));u?f.body.error(new Error(u)):f.body.close()}},async dial(c){const u=await e.dial(c);if(!u)return-1;const f=o++;return i.set(f,u),u.onData($=>i.has(f)&&t?.TcpData(f,$)),u.onClose(()=>{i.delete(f)&&t?.TcpClosed(f)}),f},send(c,u){i.get(c)?.send(u.slice())},hangUp(c){const u=i.get(c);i.delete(c),u?.close()}},listening:n,handlerFor:c=>n.has(c)?a(c):void 0,attach(c){t=c},stop(){t?.Stop()},closeAll(){for(const c of r.values())c.body?c.body.error(new Error("The process exited.")):c.reject(new Error("The process exited."));r.clear();for(const c of i.values())c.close();i.clear()}}}const Xs={DOTNET_CLI_TELEMETRY_OPTOUT:"1",DOTNET_NOLOGO:"1",DOTNET_SKIP_FIRST_TIME_EXPERIENCE:"1"},Bt=e=>e.outputInProject?x(e.outputPath):e.outputPath;function Zs(e,t){const n=`Microsoft.AspNetCore.App ${t.runtimeVersion} [browser]
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
`}}function ve(e,t){const n="configuration"in t?t.configuration:"Debug";if(t.kind==="run"&&t.file)return Ye(e.files,U(e.cwd,t.file),n);const r=pn(e.files,e.cwd,t.project,t.kind==="run"?"run":"build");return r.ok?Ye(e.files,r.path,n,t.kind==="build"?t.output:void 0):r}async function ei(e,t){const{io:n}=t,r=s=>(n.stderr(`${s}
`),{kind:"done",code:1}),i={...Xs,...t.env};switch(e.kind){case"info":return n.stdout(Zs(e.what,await t.manifest())),{kind:"done",code:0};case"exec":return{kind:"runtime",work:{env:i,run:{assembly:x(U(t.cwd,e.assembly)),args:e.appArgs,cwd:x(t.cwd)}}};case"restore":case"clean":{const s=ve(t,e);if(!s.ok)return r(s.reason);if(e.kind==="clean"){const o=dn(s.plan);if(!o.ok)return r(o.reason);const a=o.paths.filter(l=>t.files.isFile(l));a.length&&t.sendOps(a.map(l=>({op:"remove",path:l}))),n.stdout(a.length?a.map(l=>`  Deleting file "${l}".
`).join(""):`  Nothing to clean in ${ue(s.plan.outputPath)}.
`)}else{for(const o of s.plan.notes)n.stdout(`  ${o}
`);n.stdout(`  Restore complete: ${s.plan.projectFile} uses ${s.plan.packages.length?"bundled packages only":"no NuGet packages"}.
`)}return{kind:"done",code:0}}case"build":{const s=ve(t,e);return s.ok?{kind:"runtime",work:{env:i,build:s.plan}}:r(s.reason)}case"run":{const s=ve(t,e);if(!s.ok)return r(s.reason);const o=s.plan;if(o.outputKind!=="exe")return r(`Unable to run your project.
Ensure you have a runnable project type and ensure '${o.projectFile}' supports running: its OutputType is Library.`);const a=o.fileBased?{ok:!0}:Bs(c=>t.files.readText(c),o.projectDir,e.launchProfile,i);if(!a.ok)return r(a.reason);const l=o.web?o.projectDir:t.cwd;return{kind:"runtime",work:{env:{...i,...a.profile?.env},build:e.noBuild?void 0:o,run:{assembly:Bt(o),args:[...a.profile?.args??[],...e.appArgs],cwd:x(l)}}}}}}function ti(e,t,n,r=!1){const i=new Set;for(const s of e.referenceGroups)for(const o of n.references[s]?.files??[])i.add(t.get(`${s}/${o.name}`));for(const s of e.packages)for(const o of n.packages[s]?.references??[])t.has(o)&&i.add(t.get(o));return JSON.stringify({projectFile:x(e.projectFile),projectDir:x(e.projectDir),assemblyName:e.assemblyName,outputKind:e.outputKind,outputPath:Bt(e),sources:e.sources.map(x),globalUsings:e.globalUsings,references:[...i].filter(Boolean),nullable:e.nullable,allowUnsafe:e.allowUnsafe,langVersion:e.langVersion,fileBased:e.fileBased,defines:e.defines,optimize:e.optimize,warningsAsErrors:e.warningsAsErrors,noWarn:e.noWarn,quiet:r})}async function ni(e,t,n){if(e.build){const r=e.build;for(const a of r.notes)n.stdout(`  ${a}
`);const i=[...r.referenceGroups,...r.packages.flatMap(a=>(t.manifest.packages[a]?.references??[]).map(l=>l.split("/")[0]))],s=await t.mountReferences(i),o=await t.exports.Build(ti(r,s,t.manifest,!!e.run));if(o!==0)return e.run&&n.stderr(`
The build failed. Fix the build errors and run again.
`),o}return e.run?t.exports.Run(e.run.assembly,e.run.args,e.run.cwd):0}const ht="The .NET runtime bundle is not configured: the host must pass `dotnet.bundleUrl` (build it with scripts/build-dotnet-runtime.mjs).",ri=e=>`Unhandled exception. System.IO.IOException: Failed to bind to address http://localhost:${e}: address already in use.
`;function mi(e){const t=e.dial?void 0:Le(e.post),n=e.dial??(r=>t.dial(r));return je(e.post,r=>{const i={stdout:l=>r.io.stdout(l),stderr:l=>r.io.stderr(l)},s=Js({post:e.post,dial:n,taken:r.takenPorts,...i});async function o(l,c,u,f){const $=await e.loadDotnet({bundleUrl:l,env:c,imports:s.imports,onExit:p=>r.exit(p),fetch:e.fetch});Ue(f,$.FS);const h=Ct($.FS,p=>{r.exited||e.post({type:"fs",ops:p})});return r.mounted({apply:p=>h.quietly(()=>Fe($.FS,p)),flush(){try{$.exports.Flush()}catch{}h.flush()}}),$.exports.Init(),s.attach($.exports),$.FS.mkdirTree(x(u)),$}const a=l=>{if(!(l instanceof D))throw l;return i.stderr(`${l.message}
`),1};return{addressInUse:ri,receive:l=>!!t?.receive(l),plan(l){const c=$n(l.command,l.args);if(!c.ok)return{ok:!1,message:`${c.reason}
`,code:1};const u=l.dotnet?.bundleUrl;return{ok:!0,async run(f){try{const $=await ei(c.invocation,{files:f,cwd:l.cwd,env:l.env,io:i,sendOps:p=>e.post({type:"fs",ops:p}),manifest:()=>u?Qs(u,e.fetch):Promise.reject(new D(ht))});if($.kind==="done")return{kind:"exited",code:$.code};if(!u)throw new D(ht);const h=await o(u,$.work.env,l.cwd,f);return r.exited?{kind:"exited",code:1}:{kind:"running",ports:s,done:ni($.work,h,i).catch(a)}}catch($){return{kind:"exited",code:a($)}}}}}}})}export{de as ACTIVE_STATES,yi as ApplicationSpecError,vt as ApplicationStartError,pt as BUNDLE_CACHE_PREFIX,wi as CREDENTIAL_POLICY,bi as DATABASE_PROVIDER_DEFAULTS,vi as DATABASE_URL_SCHEMES,ci as DEFAULT_PGLITE_URL,Ei as DEFAULT_PHP_VERSION,Pi as DEFAULT_PHP_WASM_BASE_URL,jn as DEFAULT_PYODIDE_INDEX_URL,is as DEFAULT_REPOSITORY_URL,Nn as DEFAULT_RESTART_LIMITS,B as DIST_LIMITS,Ke as DOTNET_BUNDLE,ki as DOTNET_COMMAND_PATTERN,Xs as DOTNET_ENV,qo as DOTNET_KIND,Si as DatabaseCoordinationError,L as DistRefused,D as DotnetBundleError,re as FRONT_SCRIPT,Tn as IllegalTransitionError,Be as InvalidPackageName,Ae as MAX_RESPONSE_BYTES,Ti as NATIVE_ONLY_PACKAGES,Ri as NODE_DECLINED_COMMANDS,Oi as NODE_READINESS,zn as OPEN_FILE_SYNC_MS,Un as PGLITE_VERSION,Ni as PGSQL_REASON,Ci as PHP_COMMAND_PATTERN,Do as PHP_KIND,Ai as PHP_WASM_EXTENSIONS,xi as PHP_WASM_RELEASES,Ii as PHP_WASM_VERSION,Lo as PIP_RECORD_LIMITS,M as PROJECT_MOUNT,Fn as PYODIDE_VERSION,qi as PYTHON_COMMAND_PATTERN,Ws as REFERENCE_ROOT,J as RUNTIME_LIBRARY_ROOT,Di as RUNTIME_PROVIDED_PACKAGES,Li as RUST_COMPILE_GATE,Mo as RUST_KIND,Mi as RUST_PROFILE,F as ResolveError,Ot as SEND_HIGH_WATER_MARK,Ui as SERVER_COMMANDS,Sn as SERVICE_TRANSITIONS,Fi as SUPPORTED_PHP_VERSIONS,K as ServiceFailure,Uo as ServiceGraphPolicy,ke as TRAINING_ARTIFACT_DIR,Fo as TRAINING_SINK_DEFAULTS,Tr as VIRTUAL_TCP_MODULE,xn as acceptApplication,ji as acceptsDotnetService,Gi as acceptsNodeService,Bi as acceptsPgliteService,Wi as acceptsPhpService,Hi as acceptsPythonService,Vi as acceptsRustService,jo as artifactKeyId,Qi as assertValidSpec,Rn as canTransition,ds as checkDistUrl,H as checkPackageName,ze as checkPhpVersion,zi as claimDatabase,an as compareVersions,ti as compilePlan,kr as createChannelTransport,Sr as createDialTransport,Js as createDotnetBridge,Go as createDotnetProcessKind,Ki as createDotnetProvider,mi as createDotnetWorkerProcess,On as createLifecycle,Yi as createNodeProvider,hs as createPackageSource,Ji as createPgliteProvider,Bo as createPhpProcessKind,Xi as createPhpProvider,$i as createPhpWorkerProcess,Wo as createPipRecord,An as createProviderRegistry,Ho as createPythonProcessKind,Zi as createPythonProvider,di as createPythonWorkerProcess,Vo as createRustProcessKind,eo as createRustProvider,oi as createTrainingArtifactStore,Qo as createTrainingChannel,zo as createTrainingSink,to as databaseName,no as databaseUrl,Qr as declaredClasses,Kr as dependencyOrder,Vn as describeInstall,ro as describeIssue,Us as dialSocketClass,Jr as encodePackageName,so as envName,io as evaluateCondition,ls as expandMinified,oo as expandProperties,ao as expectedPlatform,pn as findProject,lo as frameworkDefines,se as fromPhpPath,fi as fromPyodidePath,gs as frontScript,ut as githubRepository,co as globMatcher,ir as headersOf,Fs as installPhpSockets,sr as installPythonExtensions,Se as installRequirements,Ds as installRuntimeLibrary,Or as installVirtualSockets,uo as isDotnetCommand,Ls as isLocalAddress,fo as isPhpCommand,oe as isPlatformPackage,po as isPythonCommand,$o as isRustCommand,hi as loadDotnetRuntime,ho as loadPhpRuntime,ui as loadPyodideRuntime,es as lockText,on as mapInvocationPaths,fn as mapPhpInvocationPaths,mo as mayConnectToDatabase,go as nativeOnlyReason,en as noWheelReason,mt as normalizeName,Wn as packagesWithoutWheels,yt as parseConstraint,$n as parseDotnetCommand,_o as parseFileBasedProgram,un as parsePhpCommand,yo as parseProjectFile,wo as parsePyproject,sn as parsePythonCommand,rn as parseRequirement,bo as parseRequirementsTxt,vo as parseRustCommand,Eo as parseServerCommand,De as parseVersion,Po as pgliteDataDir,W as phpLiteral,Oe as phpString,ko as phpWasmModuleUrls,lt as pickVersion,Ye as planBuild,Zt as planRequirements,_t as platformShortfall,ei as prepareInvocation,Rr as pythonTcpModule,It as rankVersions,ce as readCapped,Bs as readLaunchProfile,Qs as readManifest,gt as readProjectRequirements,nn as readRequirementFile,Ht as readinessOf,So as receivesDatabaseCredentials,it as requireArguments,U as resolveFrom,ts as resolvePackages,Cn as restartDecision,Vt as restartPolicyOf,Qt as roleOf,ns as rootRequirements,ys as routeRequest,ss as runComposer,ni as runWithRuntime,Zr as runtimePackages,To as satisfies,Jt as serviceEnv,mn as serviceGraph,Ro as serviceMap,He as sha256Hex,Gs as splitArgs,li as startApplicationRuntime,Oo as startDatabaseHost,bs as startPhpWebServer,ar as startPythonAppServer,lr as startRequestedAppServer,x as toPhpPath,te as toPyodidePath,No as tomlStringArray,Co as tomlTable,Ct as trackPhpWrites,Ct as trackWrappedFsWrites,us as unpackDist,Xr as unsupportedRepositories,Ko as validArtifactPath,At as validPackageName,Yo as validPipInstall,Ao as validateSpec,cs as versionsOf,xo as withoutDatabaseCredentials,st as writeAutoloader};
