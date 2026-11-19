"use strict";(()=>{var tn=Object.defineProperty;var rn=(e,t,r)=>t in e?tn(e,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):e[t]=r;var v=(e,t,r)=>rn(e,typeof t!="symbol"?t+"":t,r);var Ye="3.1.62",nn="8.3",sn={"8.1":"8.1.34","8.2":"8.2.35","8.3":"8.3.36","8.4":"8.4.27"},Ft=Object.keys(sn),on="https://cdn.jsdelivr.net/npm/",an=e=>e.endsWith("/")?e:`${e}/`;function Te(e){let t=e??nn;if(!Ft.includes(t))throw new Error(`PHP ${t} is not available in the browser runtime (php-wasm ${Ye} builds ${Ft.join(", ")}).`);return t}function ln(e,t,r){let n=an(e);return{universal:`${n}@php-wasm/universal@${Ye}/+esm`,loader:`${n}@php-wasm/web-${t.replace(".","-")}@${Ye}/${r}/php_${t.replace(".","_")}.js`}}var $e;async function Wt(e={}){let t=Te(e.phpVersion),r="Suspending"in WebAssembly?"jspi":"asyncify",n=ln(e.baseUrl??on,t,r),s=`${n.universal} ${n.loader}`;if($e?.key!==s){let p=Promise.all([import(n.universal),import(n.loader)]);$e={key:s,load:p},p.catch(()=>{$e?.load===p&&($e=void 0)})}let[i,o]=await $e.load,l=globalThis;l.setImmediate??(l.setImmediate=p=>setTimeout(p,0));let a=await i.loadPHPRuntime(o,{phpWasmAsyncMode:r,websocket:{}}),u=new i.PHP(a);return{php:u,module:u[i.__private__dont__use]}}var cn=/^(?:[^/]|$)|\/\/|\/\.\.?(?:\/|$)|[\s\S]\/$|\\/;function k(e){if(!cn.test(e))return e;let t=[];for(let r of e.replace(/\\/g,"/").split("/"))!r||r==="."||(r===".."?t.pop():t.push(r));return"/"+t.join("/")}function Y(e){let t=k(e),r=t.lastIndexOf("/");return r<=0?"/":t.slice(0,r)}function Ht(e){let t=k(e);return t.slice(t.lastIndexOf("/")+1)}function P(...e){return k(e.join("/"))}function me(e,t){return t.startsWith("/")?k(t):P(e,t)}function Ze(e){let t=Ht(e),r=t.lastIndexOf(".");return r<=0?"":t.slice(r).toLowerCase()}var un=new TextDecoder,se=class{constructor(){v(this,"files",new Map);v(this,"versions",new Map);v(this,"mtimes",new Map);v(this,"children",new Map([["/",new Set]]));v(this,"explicit",new Set);v(this,"listeners",new Map);v(this,"queued",[]);v(this,"dispatching",!1);v(this,"clock",0);v(this,"content",t=>{let r=this.files.get(t);if(typeof r!="function")return r;let n=r();return this.files.set(t,n),n})}writeFile(t,r){let n=k(t);if(n==="/"||this.children.has(n))throw new Error(`EISDIR: illegal operation on a directory, open '${n}'`);let s=!this.files.has(n);s&&this.link(n),this.files.set(n,r),this.versions.set(n,++this.clock),this.mtimes.set(n,Date.now()),this.emit({type:"write",path:n,created:s})}readFile(t){return this.content(k(t))}readText(t){let r=this.readFile(t);if(r!==void 0)return typeof r=="string"?r:un.decode(r)}isFile(t){return this.files.has(k(t))}isDirectory(t){return this.children.has(k(t))}exists(t){return this.isFile(t)||this.isDirectory(t)}mkdir(t){let r=k(t);if(this.files.has(r))throw new Error(`EEXIST: file already exists, mkdir '${r}'`);if(r==="/")return;let n=this.children.has(r),s=n&&!this.explicit.has(r);if(this.explicit.add(r),n){s&&this.emit({type:"mkdir",path:r,promoted:!0},!0);return}this.ensureDir(r),this.emit({type:"mkdir",path:r})}seed(t,r=[]){for(let s of r){let i=k(s);if(i!=="/"){if(this.files.has(i))throw new Error(`EEXIST: file already exists, mkdir '${i}'`);this.explicit.add(i),this.ensureDir(i)}}let n=Date.now();for(let[s,i]of t){let o=k(s);if(o==="/"||this.children.has(o))throw new Error(`EISDIR: illegal operation on a directory, open '${o}'`);this.files.has(o)||this.link(o),this.files.set(o,i),this.versions.set(o,++this.clock),this.mtimes.set(o,n)}}readdir(t){return[...this.children.get(k(t))??[]].sort()}entries(t){let r=k(t);return this.readdir(r).map(n=>({name:n,kind:this.children.has(P(r,n))?"directory":"file"}))}rename(t,r){let n=k(t),s=k(r);if(n===s)return;if(!this.exists(n))throw new Error(`ENOENT: no such file or directory, rename '${n}' -> '${s}'`);if(this.exists(s))throw new Error(`EEXIST: file already exists, rename '${n}' -> '${s}'`);if(s.startsWith(n+"/"))throw new Error(`EINVAL: cannot move '${n}' into itself`);if(this.files.has(n)){let a=this.content(n);this.removeFile(n),this.writeFile(s,a);return}let i=n+"/",o=[...this.files.keys()].filter(a=>a.startsWith(i)).map(a=>[a,this.content(a)]),l=[...this.explicit].filter(a=>a===n||a.startsWith(i));this.rm(n),this.mkdir(s);for(let a of l)this.mkdir(s+a.slice(n.length));for(let[a,u]of o)this.writeFile(s+a.slice(n.length),u)}list(){return[...this.files.keys()].sort()}explicitDirectories(){return[...this.explicit].sort()}rm(t){let r=k(t);if(this.files.has(r)){this.removeFile(r);return}if(!this.children.has(r))return;for(let s of[...this.children.get(r)??[]])this.rm(r==="/"?"/"+s:`${r}/${s}`);if(r==="/")return;let n=this.explicit.delete(r);this.children.has(r)&&this.unlinkDir(r),n&&this.emit({type:"remove",path:r})}version(t){return this.versions.get(k(t))}mtime(t){return this.mtimes.get(k(t))}writeTree(t,r="/"){for(let[n,s]of Object.entries(t)){let i=P(r,n);typeof s=="string"||s instanceof Uint8Array?this.writeFile(i,s):(this.mkdir(i),this.writeTree(s,i))}}toFlat(){let t={};for(let r of this.files.keys())t[r.slice(1)]=this.content(r);return t}watch(t,r={}){let n=r.under===void 0?void 0:k(r.under),s=n===void 0||n==="/"?t:i=>(i.path===n||i.path.startsWith(n+"/"))&&t(i);return this.listeners.set(s,!!r.promotions),()=>this.listeners.delete(s)}removeFile(t){this.files.delete(t),this.versions.delete(t),this.mtimes.delete(t),this.unlink(t),this.emit({type:"remove",path:t})}link(t){let r=Y(t);this.ensureDir(r),this.children.get(r).add(t.slice(t.lastIndexOf("/")+1))}ensureDir(t){if(!this.children.has(t)){if(this.files.has(t))throw new Error(`ENOTDIR: not a directory, '${t}'`);this.children.set(t,new Set),this.link(t)}}unlink(t){let r=Y(t),n=this.children.get(r);n&&(n.delete(t.slice(t.lastIndexOf("/")+1)),n.size===0&&r!=="/"&&!this.explicit.has(r)&&this.unlinkDir(r))}unlinkDir(t){this.children.delete(t),this.unlink(t)}emit(t,r=!1){if(this.queued.push([t,r]),!this.dispatching){this.dispatching=!0;try{for(let n=this.queued.shift();n;n=this.queued.shift()){let[s,i]=n;for(let[o,l]of this.listeners)(l||!i)&&o(s)}}finally{this.dispatching=!1,this.queued.length=0}}}};function ge(e,t){for(let r of t)r.op==="write"?e.writeFile(r.path,r.content):r.op==="mkdir"?e.mkdir(r.path):e.rm(r.path)}var Ws=new TextEncoder,pn=new TextDecoder("utf-8",{ignoreBOM:!0});function Gt(e){let t="";for(let r=0;r<e.length;r+=8192)t+=String.fromCharCode.apply(null,e.subarray(r,r+8192));return t}function jt(e){let t=new Uint32Array(e,0,8);if(t[0]!==1263552066||t[1]!==1)throw new Error("Not a file-system pack (or a pack from another runtime version).");let r=t[2]+t[3]*2**32,n=t[4],s=t[5],i=t[6],o=t[7],l=n+s,a=new Uint32Array(e,8*4,l),u=(8+l)*4,p=new Uint32Array(e,u,n*3),c=Gt(new Uint16Array(e,u+n*12,i)),d=new Array(l),g=0;for(let f=0;f<l;f++){let m=g+a[f];d[f]=c.slice(g,m),g=m}let h=new Array(n);for(let f=0;f<n;f++){let m=p[f*3],y=o+p[f*3+1],_=p[f*3+2];h[f]=[d[f],()=>fn(e,m,y,_)]}return{seq:r,files:h,dirs:d.slice(n)}}function fn(e,t,r,n){return t===1?new Uint8Array(e.slice(r,r+n)):t===2?Gt(new Uint16Array(e.slice(r,r+n))):pn.decode(new Uint8Array(e,r,n))}var Qs=1024*1024;function Ce(e,t){let{files:r,dirs:n}=jt(t.pack);e.seed(r,n),ge(e,t.ops)}function Je(e,t){let r=k(t),n=k(e);return n==="/"?r:r==="/"?n:n+r}var q=Uint8Array,ce=Uint16Array,dn=Int32Array,Bt=new q([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),Vt=new q([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),hn=new q([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),zt=function(e,t){for(var r=new ce(31),n=0;n<31;++n)r[n]=t+=1<<e[n-1];for(var s=new dn(r[30]),n=1;n<30;++n)for(var i=r[n];i<r[n+1];++i)s[i]=i-r[n]<<5|n;return{b:r,r:s}},Qt=zt(Bt,2),Kt=Qt.b,$n=Qt.r;Kt[28]=258,$n[258]=28;var Yt=zt(Vt,0),mn=Yt.b,ei=Yt.r,rt=new ce(32768);for(S=0;S<32768;++S)Z=(S&43690)>>1|(S&21845)<<1,Z=(Z&52428)>>2|(Z&13107)<<2,Z=(Z&61680)>>4|(Z&3855)<<4,rt[S]=((Z&65280)>>8|(Z&255)<<8)>>1;var Z,S,ye=function(e,t,r){for(var n=e.length,s=0,i=new ce(t);s<n;++s)e[s]&&++i[e[s]-1];var o=new ce(t);for(s=1;s<t;++s)o[s]=o[s-1]+i[s-1]<<1;var l;if(r){l=new ce(1<<t);var a=15-t;for(s=0;s<n;++s)if(e[s])for(var u=s<<4|e[s],p=t-e[s],c=o[e[s]-1]++<<p,d=c|(1<<p)-1;c<=d;++c)l[rt[c]>>a]=u}else for(l=new ce(n),s=0;s<n;++s)e[s]&&(l[s]=rt[o[e[s]-1]++]>>15-e[s]);return l},ve=new q(288);for(S=0;S<144;++S)ve[S]=8;var S;for(S=144;S<256;++S)ve[S]=9;var S;for(S=256;S<280;++S)ve[S]=7;var S;for(S=280;S<288;++S)ve[S]=8;var S,Zt=new q(32);for(S=0;S<32;++S)Zt[S]=5;var S;var gn=ye(ve,9,1);var yn=ye(Zt,5,1),Xe=function(e){for(var t=e[0],r=1;r<e.length;++r)e[r]>t&&(t=e[r]);return t},G=function(e,t,r){var n=t/8|0;return(e[n]|e[n+1]<<8)>>(t&7)&r},et=function(e,t){var r=t/8|0;return(e[r]|e[r+1]<<8|e[r+2]<<16)>>(t&7)},vn=function(e){return(e+7)/8|0},st=function(e,t,r){return(t==null||t<0)&&(t=0),(r==null||r>e.length)&&(r=e.length),new q(e.subarray(t,r))};var wn=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],D=function(e,t,r){var n=new Error(t||wn[e]);if(n.code=e,Error.captureStackTrace&&Error.captureStackTrace(n,D),!r)throw n;return n},bn=function(e,t,r,n){var s=e.length,i=n?n.length:0;if(!s||t.f&&!t.l)return r||new q(0);var o=!r,l=o||t.i!=2,a=t.i;o&&(r=new q(s*3));var u=function(qt){var Mt=r.length;if(qt>Mt){var Ut=new q(Math.max(Mt*2,qt));Ut.set(r),r=Ut}},p=t.f||0,c=t.p||0,d=t.b||0,g=t.l,h=t.d,f=t.m,m=t.n,y=s*8;do{if(!g){p=G(e,c,1);var _=G(e,c+1,3);if(c+=3,_)if(_==1)g=gn,h=yn,f=9,m=5;else if(_==2){var w=G(e,c,31)+257,C=G(e,c+10,15)+4,R=w+G(e,c+5,31)+1;c+=14;for(var T=new q(R),I=new q(19),$=0;$<C;++$)I[hn[$]]=G(e,c+$*3,7);c+=C*3;for(var x=Xe(I),O=(1<<x)-1,A=ye(I,x,1),$=0;$<R;){var H=A[G(e,c,O)];c+=H&15;var b=H>>4;if(b<16)T[$++]=b;else{var U=0,E=0;for(b==16?(E=3+G(e,c,3),c+=2,U=T[$-1]):b==17?(E=3+G(e,c,7),c+=3):b==18&&(E=11+G(e,c,127),c+=7);E--;)T[$++]=U}}var K=T.subarray(0,w),N=T.subarray(w);f=Xe(K),m=Xe(N),g=ye(K,f,1),h=ye(N,m,1)}else D(1);else{var b=vn(c)+4,L=e[b-4]|e[b-3]<<8,M=b+L;if(M>s){a&&D(0);break}l&&u(d+L),r.set(e.subarray(b,M),d),t.b=d+=L,t.p=c=M*8,t.f=p;continue}if(c>y){a&&D(0);break}}l&&u(d+131072);for(var Ve=(1<<f)-1,Xr=(1<<m)-1,ze=c;;ze=c){var U=g[et(e,c)&Ve],le=U>>4;if(c+=U&15,c>y){a&&D(0);break}if(U||D(2),le<256)r[d++]=le;else if(le==256){ze=c,g=null;break}else{var Lt=le-254;if(le>264){var $=le-257,he=Bt[$];Lt=G(e,c,(1<<he)-1)+Kt[$],c+=he}var Qe=h[et(e,c)&Xr],Ke=Qe>>4;Qe||D(3),c+=Qe&15;var N=mn[Ke];if(Ke>3){var he=Vt[Ke];N+=et(e,c)&(1<<he)-1,c+=he}if(c>y){a&&D(0);break}l&&u(d+131072);var Nt=d+Lt;if(d<N){var Dt=i-N,en=Math.min(N,Nt);for(Dt+d<0&&D(3);d<en;++d)r[d]=n[Dt+d]}for(;d<Nt;++d)r[d]=r[d-N]}}t.l=g,t.p=ze,t.b=d,t.f=p,g&&(p=1,t.m=f,t.d=h,t.n=m)}while(!p);return d!=r.length&&o?st(r,0,d):r.subarray(0,d)};var Pn=new q(0);var B=function(e,t){return e[t]|e[t+1]<<8},F=function(e,t){return(e[t]|e[t+1]<<8|e[t+2]<<16|e[t+3]<<24)>>>0},tt=function(e,t){return F(e,t)+F(e,t+4)*4294967296};function _n(e,t){return bn(e,{i:2},t&&t.out,t&&t.dictionary)}var nt=typeof TextDecoder<"u"&&new TextDecoder,xn=0;try{nt.decode(Pn,{stream:!0}),xn=1}catch{}var Sn=function(e){for(var t="",r=0;;){var n=e[r++],s=(n>127)+(n>223)+(n>239);if(r+s>e.length)return{s:t,r:st(e,r-1)};s?s==3?(n=((n&15)<<18|(e[r++]&63)<<12|(e[r++]&63)<<6|e[r++]&63)-65536,t+=String.fromCharCode(55296|n>>10,56320|n&1023)):s&1?t+=String.fromCharCode((n&31)<<6|e[r++]&63):t+=String.fromCharCode((n&15)<<12|(e[r++]&63)<<6|e[r++]&63):t+=String.fromCharCode(n)}};function kn(e,t){if(t){for(var r="",n=0;n<e.length;n+=16384)r+=String.fromCharCode.apply(null,e.subarray(n,n+16384));return r}else{if(nt)return nt.decode(e);var s=Sn(e),i=s.s,r=s.r;return r.length&&D(8),i}}var En=function(e,t){return t+30+B(e,t+26)+B(e,t+28)},Rn=function(e,t,r){var n=B(e,t+28),s=B(e,t+30),i=kn(e.subarray(t+46,t+46+n),!(B(e,t+8)&2048)),o=t+46+n,l=Tn(e,o,s,r,F(e,t+20),F(e,t+24),F(e,t+42)),a=l[0],u=l[1],p=l[2];return[B(e,t+10),a,u,i,o+s+B(e,t+32),p]},Tn=function(e,t,r,n,s,i,o){var l=s==4294967295,a=i==4294967295,u=o==4294967295,p=t+r,c=l+a+u;if(n&&c){for(;t+4<p;t+=4+B(e,t+2))if(B(e,t)==1)return[l?tt(e,t+4+8*a):s,a?tt(e,t+4):i,u?tt(e,t+4+8*(a+l)):o,1];n<2&&D(13)}return[s,i,o,0]};function Jt(e,t){for(var r={},n=e.length-22;F(e,n)!=101010256;--n)(!n||e.length-n>65558)&&D(13);var s=B(e,n+8);if(!s)return{};var i=F(e,n+16),o=F(e,n-20)==117853008;if(o){var l=F(e,n-12);o=F(e,l)==101075792,o&&(s=F(e,l+32),i=F(e,l+48))}for(var a=t&&t.filter,u=0;u<s;++u){var p=Rn(e,i,o),c=p[0],d=p[1],g=p[2],h=p[3],f=p[4],m=p[5],y=En(e,m);i=f,(!a||a({name:h,size:d,originalSize:g,compression:c}))&&(c?c==8?r[h]=_n(e.subarray(y,y+d),{out:new q(g)}):D(14,"unknown compression type "+c):r[h]=st(e,y,y+d))}return r}var ii=new TextEncoder,Cn=new TextDecoder("utf-8",{fatal:!0});var Xt={maxEntries:25e4,maxEntryBytes:256*1024*1024,maxTotalBytes:1024*1024*1024},ee=class extends Error{constructor(r,n,s,i){super(`The zip exceeds ${r} (${n} > ${s})${i?` at "${i}"`:""}.`);v(this,"limit");v(this,"value");v(this,"max");v(this,"entry");v(this,"code","EZIPLIMIT");this.limit=r,this.value=n,this.max=s,this.entry=i,this.name="ZipLimitError"}};function it(e,t,r="/",n={}){let{maxEntries:s,maxEntryBytes:i,maxTotalBytes:o}={...Xt,...n},l=0,a=0,u=Jt(t,{filter({name:p,size:c,originalSize:d,compression:g}){if(++l>s)throw new ee("maxEntries",l,s);let h=g===0?Math.max(c,d):d;if(h>i)throw new ee("maxEntryBytes",h,i,p);if(a+=h,a>o)throw new ee("maxTotalBytes",a,o,p);return!0}});for(let[p,c]of Object.entries(u)){if(p.endsWith("/")){e.mkdir(Je(r,p.slice(0,-1)));continue}let d=c;try{d=Cn.decode(c)}catch{}e.writeFile(Je(r,p),d)}}var On={".html":"text/html; charset=utf-8",".htm":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".map":"application/json; charset=utf-8",".txt":"text/plain; charset=utf-8",".md":"text/markdown; charset=utf-8",".xml":"application/xml; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".webp":"image/webp",".avif":"image/avif",".ico":"image/x-icon",".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".otf":"font/otf",".mp3":"audio/mpeg",".wav":"audio/wav",".mp4":"video/mp4",".webm":"video/webm",".wasm":"application/wasm",".pdf":"application/pdf"};function ot(e){return On[e]??"application/octet-stream"}function we(e){return new ReadableStream({start(t){e.byteLength&&t.enqueue(e),t.close()}})}function ue(e,t){return{status:e,headers:{"content-type":"text/plain; charset=utf-8"},body:we(new TextEncoder().encode(t))}}function at(e){return{status:e.status,statusText:e.statusText,headers:e.headers}}function lt(e,t){let r=e.getReader(),n=!1;return(async()=>{try{for(;;){let{value:s,done:i}=await r.read();if(i||n)break;t.chunk(s)}n||t.end()}catch(s){n||t.end(s instanceof Error?s.message:String(s))}})(),()=>{n||(n=!0,r.cancel().catch(()=>{}))}}var Oe=class{constructor(){v(this,"peer");v(this,"closed",!1);v(this,"manual",!1);v(this,"data",new Set);v(this,"closes",new Set);v(this,"credits",new Set)}send(t){if(this.closed)return;let r=new Uint8Array(t);queueMicrotask(()=>{let n=this.peer;if(!n.closed){for(let s of n.data)s(r);n.manual||n.consumed(r.byteLength)}})}manualFlowControl(){this.manual=!0}close(){this.closed||(this.closed=!0,queueMicrotask(()=>{if(!this.peer.closed){this.peer.closed=!0;for(let t of this.peer.closes)t()}}))}consumed(t){this.closed||t<=0||queueMicrotask(()=>{for(let r of this.peer.credits)r(t)})}onData(t){return this.data.add(t),()=>this.data.delete(t)}onClose(t){return this.closes.add(t),()=>this.closes.delete(t)}onConsumed(t){return this.credits.add(t),()=>this.credits.delete(t)}};function be(){let e=new Oe,t=new Oe;return e.peer=t,t.peer=e,[e,t]}function An(e){e.onData(()=>e.close())}function ct(e){let[t,r]=be();return(e??An)(r),t}var ut={SIGHUP:129,SIGINT:130,SIGKILL:137,SIGPIPE:141,SIGTERM:143},In=ut.SIGPIPE;function pt(e){return ut[e]??1}function ft(e){let t="";for(let r=0;r<e.length;r++)t+=String.fromCharCode(e[r]);return btoa(t)}var Pe=class{constructor(t,r){this.kind=t;this.post=r;v(this,"ends",new Map)}owns(t){return t.type===`${this.kind}-data`||t.type===`${this.kind}-ack`||t.type===`${this.kind}-close`}get size(){return this.ends.size}add(t,r){let{kind:n}=this;this.ends.set(t,r),r.manualFlowControl(),r.onData(s=>this.post({type:`${n}-data`,connId:t,data:s})),r.onConsumed(s=>this.post({type:`${n}-ack`,connId:t,bytes:s})),r.onClose(()=>{this.ends.delete(t)&&this.post({type:`${n}-close`,connId:t})})}receive(t){let r=this.ends.get(t.connId);t.type===`${this.kind}-data`?r?.send(t.data):t.type===`${this.kind}-ack`?r?.consumed(t.bytes):this.hangUp(t.connId)}hangUp(t){let r=this.ends.get(t);this.ends.delete(t),r?.close()}closeAll(t=!1){let r=[...this.ends.keys()];for(let n of r)this.hangUp(n),t&&this.post({type:`${this.kind}-close`,connId:n})}};var Nn=new Set(["socket-data","socket-ack","socket-close","dial-result","dial-data","dial-ack","dial-close"]);function Dn(e){return Nn.has(e.type)}function er(e){let t=qn(e);return{dial:r=>t.dial(r),receive(r){return!Dn(r)||!r.type.startsWith("dial")?!1:(t.receive(r),!0)}}}function qn(e){let t=new Pe("socket",e),r=new Pe("dial",e),n=new Map,s=1;return{upgraded(i,o,l){if(!l)return e({type:"socket-close",connId:i});let[a,u]=be();t.add(i,a),l(o,u)},accepted(i,o){if(!o)return e({type:"socket-close",connId:i});t.add(i,ct(o.accept))},dial(i){let o=s++;return e({type:"dial",connId:o,port:i}),new Promise(l=>{n.set(o,a=>{if(!a)return l(void 0);let[u,p]=be();r.add(o,u),l(p)})})},receive(i){if(i.type==="dial-result"){let o=n.get(i.connId);return n.delete(i.connId),o?.(i.ok)}if(t.owns(i))return t.receive(i);if(r.owns(i))return r.receive(i)}}}var Mn=new TextEncoder;function tr(e,t,r,n){let s=!1,i,o=()=>{s||(s=!0,n?.())};return r.then(l=>{if(s)return void l?.body.cancel().catch(()=>{});if(!l)return e({type:"response-head",reqId:t,head:null}),o();e({type:"response-head",reqId:t,head:at(l)}),i=lt(l.body,{chunk:a=>e({type:"response-chunk",reqId:t,data:a}),end:a=>{e(a?{type:"response-end",reqId:t,error:a}:{type:"response-end",reqId:t}),o()}})},l=>{s||(e({type:"response-head",reqId:t,head:{status:500,headers:{"content-type":"text/plain"}}}),e({type:"response-chunk",reqId:t,data:Mn.encode(String(l instanceof Error?l.stack:l))}),e({type:"response-end",reqId:t}),o())}),()=>{i?.(),o()}}var Un=e=>ue(502,`Nothing is listening on port ${e}.`);function rr(e){let t=new Set,r=new Map;return{taken:t,receive(n){switch(n.type){case"ports":for(let s of n.open)t.add(s);for(let s of n.closed)e.handlerFor(s)||t.delete(s);return!0;case"http-request":{let{reqId:s}=n,i=e.handlerFor(n.port),o=i?i(n.request):Promise.resolve(Un(n.port));return r.set(s,tr(e.post,s,o,()=>r.delete(s))),!0}case"request-cancel":return r.get(n.reqId)?.(),!0;case"listen-failed":return e.onListenFailed(n.port,n.message,n.id),!0;case"listened":return e.onListened?.(n.port,n.id),!0;default:return!1}},cancelAll(){for(let n of[...r.values()])n();r.clear()}}}function nr(e,t){let r=new se,n,s,i,o,l=!1,a=f=>{if(!l){n?.flush(),l=!0,i!==void 0&&e({type:"unlisten",port:i});for(let m of o?.listening??[])e({type:"unlisten",port:m});o?.closeAll(),e({type:"exit",code:f})}},u={post:e,io:{stdout:f=>!l&&e({type:"stdout",data:f}),stderr:f=>!l&&e({type:"stderr",data:f})},get exited(){return l},exit:a,mounted(f){r=void 0,n=f},get takenPorts(){return c.taken}},p=async(f,m=pt(f))=>{let y=s;s=void 0,c.cancelAll();try{o?.stop()}catch{}try{await y?.close()}finally{a(m)}},c=rr({post:e,handlerFor:f=>s&&f===i?s.handle:o?.handlerFor(f),onListenFailed(f){if(f===i)i=void 0;else if(!o?.listening.has(f))return;u.io.stderr(d.addressInUse(f)),p("SIGTERM",1)}}),d=t(u),g=f=>{r?ge(r,f):n?.apply(f)};async function h(f){let{snapshot:m}=f;m.pack?Ce(r,m):g(m.ops);for(let L of f.ports)c.taken.add(L);let y=d.plan(f);if(!y.ok)return u.io.stderr(y.message),a(y.code);if(y.port!==void 0&&c.taken.has(y.port))return u.io.stderr(d.addressInUse(y.port)),a(1);let _=await y.run(r);if(_.kind==="exited")return a(_.code);if(_.kind==="running")return o=_.ports,a(await _.done);let{port:b}=_.server;if(l||c.taken.has(b))return await _.server.close(),l||u.io.stderr(d.addressInUse(b)),a(1);s=_.server,i=b,c.taken.add(b),e({type:"listen",port:b}),u.io.stderr(_.banner)}return{receive(f){if(!(c.receive(f)||d.receive?.(f)))switch(f.type){case"prime":return Ce(r,f.snapshot),e({type:"primed"});case"start":h(f).catch(m=>{u.io.stderr(`${m instanceof Error?m.stack??m.message:String(m)}
`),a(1)});return;case"fs":return g(f.ops);case"kill":return void p(f.signal);case"stdin":return d.stdin?.(f.data);case"socket-open":case"socket-accept":return e({type:"socket-close",connId:f.connId});default:return}}}}var or=/^php(\d+(\.\d+)?)?(-cli)?(\.exe)?$/,dt=/^composer(\.phar)?$/,sr=e=>e.replace(/\\/g,"/").split("/").pop()??e,Fn=`^(?:${or.source.slice(1,-1)}|${dt.source.slice(1,-1)})$`,oo=new RegExp(Fn);var V=e=>({ok:!1,reason:e}),ht=e=>({ok:!0,invocation:e}),ar=new Set(["-d","-c","-z","-t","-S","-f","-r","-B","-R","-F","-E","--rf","--rc","--re","--rz","--ri"]);function lr(e,t){let r=sr(e);if(dt.test(r))return ir(t);if(!or.test(r))return V(`"${e}" is not a PHP command.`);for(let n=0;n<t.length;n++){let s=t[n];if(s==="-S")return Hn(t);if(s==="-a")return V("Interactive PHP (-a) needs a terminal, which the PHP runtime does not provide.");if(ar.has(s)){n++;continue}if(s==="--")break;if(!s.startsWith("-")){if(dt.test(sr(s)))return ir(t.slice(n+1));break}}return t.length?ht({kind:"cli",argv:[...t]}):V("Interactive PHP (no script or -r code) needs a terminal, which the PHP runtime does not provide.")}function Wn(e){if(!e)return"Option -S needs host:port (php -S localhost:8000).";let t=/^(\[[^\]]+\]|[^:]*):(\d+)$/.exec(e),r=Number(t?.[2]);return!t||!Number.isInteger(r)||r<1||r>65535?`Invalid address "${e}": php -S needs host:port (php -S localhost:8000).`:{host:t[1]||"localhost",port:r}}function Hn(e){let t={ini:{}};for(let r=0;r<e.length;r++){let n=e[r];if(n==="-S"){let s=Wn(e[++r]);if(typeof s=="string")return V(s);Object.assign(t,s)}else if(n==="-t"){let s=e[++r];if(!s)return V("Option -t needs a document root.");t.docroot=s}else if(n==="-d"){let s=e[++r]??"",i=s.indexOf("=");t.ini[i===-1?s:s.slice(0,i)]=i===-1?"1":s.slice(i+1)}else if(n==="-c"||n==="-z")r++;else if(n.startsWith("-")){if(n!=="-q"&&n!=="-n"&&n!=="-e"&&n!=="-H")return V(`Option ${n} is not supported with php -S in the PHP runtime.`)}else{if(t.router)return V(`php -S takes one router script; "${n}" is extra.`);t.router=n}}return ht({kind:"serve",server:t})}var Gn=new Set(["--prefer-install","--apcu-autoloader-prefix","--audit-format","--ignore-platform-req"]),jn={install:"install",i:"install",update:"update",u:"update",upgrade:"update",require:"require",r:"require","dump-autoload":"dump-autoload",dumpautoload:"dump-autoload"};function ir(e){let t={command:"install",packages:[],noDev:!1,ignorePlatformReqs:!1,dev:!1},r;for(let s=0;s<e.length;s++){let i=e[s],[o,l]=i.startsWith("--")&&i.includes("=")?[i.slice(0,i.indexOf("=")),i.slice(i.indexOf("=")+1)]:[i,void 0];if(o==="-d"||o==="--working-dir")t.workingDir=l??e[++s];else if(o==="--no-dev")t.noDev=!0;else if(o==="--dev")t.dev=!0;else if(o==="--ignore-platform-reqs")t.ignorePlatformReqs=!0;else if(Gn.has(o))l===void 0&&s++;else{if(o.startsWith("-"))continue;r===void 0?r=i:t.packages.push(i)}}let n=jn[r??"install"];return n?(t.command=n,n==="require"&&!t.packages.length?V("composer require needs a package (composer require vendor/name)."):n!=="require"&&n!=="update"&&t.packages.length?V(`composer ${n} takes no packages.`):ht({kind:"composer",...t})):V(`composer ${r} is not supported; the PHP runtime runs composer install, update, require and dump-autoload.`)}function cr(e,t){let r=n=>n?.startsWith("/")?t(n):n;switch(e.kind){case"serve":return{...e,server:{...e.server,docroot:r(e.server.docroot),router:r(e.server.router)}};case"composer":return{...e,workingDir:r(e.workingDir)};default:{let n=[...e.argv];for(let s=0;s<n.length;s++){if(ar.has(n[s])){if(n[s]==="-f"&&(n[s+1]=r(n[s+1])??""),n[s]==="-r")break;s++;continue}if(n[s]==="--")break;if(!n[s].startsWith("-")){n[s]=r(n[s])??n[s];break}}return{kind:"cli",argv:n}}}}var ie="/project",Bn=new Set(["node_modules",".git"]),Vn=50,Ie=e=>e.split("/").some(t=>Bn.has(t)),J=e=>e==="/"?ie:P(ie,e);function Ae(e){let t=k(e);return t===ie?"/":t.startsWith(`${ie}/`)?t.slice(ie.length):void 0}var zn=new TextDecoder("utf-8",{fatal:!0,ignoreBOM:!0});function Qn(e){try{return zn.decode(e)}catch{return e.slice()}}var pe=(e,t)=>e.analyzePath(t).exists,xe=(e,t)=>pe(e,t)&&e.isDir(e.stat(t).mode),Le=(e,t)=>pe(e,t)&&!e.isDir(e.stat(t).mode),$t=(e,t)=>t.startsWith("/")?t:P(e.cwd(),t),Ne=(e,t)=>e.readdir(t).filter(r=>r!=="."&&r!=="..");function _e(e,t){if(pe(e,t)){if(!xe(e,t))return e.unlink(t);for(let r of Ne(e,t))_e(e,`${t}/${r}`);e.rmdir(t)}}function mt(e,t){t.mkdirTree(ie);for(let r of e.explicitDirectories())Ie(r)||t.mkdirTree(J(r));for(let r of e.list()){if(Ie(r))continue;let n=J(r);t.mkdirTree(Y(n)),t.writeFile(n,e.readFile(r)??"")}}function gt(e,t){for(let r of t){if(Ie(r.path))continue;let n=J(r.path);r.op==="write"?(e.mkdirTree(Y(n)),xe(e,n)&&_e(e,n),e.writeFile(n,r.content)):r.op==="mkdir"?e.mkdirTree(n):_e(e,n)}}function ur(e,t,r=()=>!1){let n=new Set,s=[],i=!1,o=0,l,a=(f,m)=>{let y=J(f);return m==="mkdir"||m==="remove"?[{op:m,path:f}]:pe(e,y)?xe(e,y)?m==="write"?[]:[{op:"mkdir",path:f},...Ne(e,y).flatMap(_=>a(P(f,_),"tree"))]:[{op:"write",path:f,content:Qn(e.readFile(y))}]:[]},u=()=>{if(i=!1,!s.length)return;let f=s;s=[];let m=f.flatMap(({op:y,path:_})=>a(_,y)).filter(y=>!r(y.path));m.length&&t(m)},p=(f,m)=>{let y=Ae(m);if(!(o||y===void 0||y==="/"||r(y)||Ie(y))){if(f==="write"){let _;for(let b of s)b.path===y&&(_=b);if(_?.op==="write")return}s.push({op:f,path:y}),i||(i=!0,queueMicrotask(u))}},c=()=>{for(let f of n)p("write",f)},d={openedForWrite(f){!o&&Ae(f)!==void 0&&n.add(f)},written(f){o||Ae(f)===void 0||(n.add(f),clearTimeout(l),l=setTimeout(c,Vn))},closed(f){n.delete(f)&&p("write",f)},madeDirectory:f=>p("mkdir",f),symlinked:f=>p("tree",f),deleted:f=>p("remove",f),moved(f,m){p("remove",f),p("tree",m)}},g=e.truncate.bind(e),h=e.ftruncate.bind(e);return e.truncate=(f,m)=>{g(f,m),typeof f=="string"&&p("write",$t(e,f))},e.ftruncate=(f,m)=>{h(f,m);let y=e.getStream(f)?.path;y&&p("write",y)},{events:d,tracker:{quietly(f){o++;try{f()}finally{o--}},flush(){clearTimeout(l),c(),u()}}}}var Kn=3,Yn=64,Zn=512;function Jn(e){return typeof e=="string"?/[wa+]/.test(e):(e&Kn)!==0||(e&(Yn|Zn))!==0}function pr(e,t){let{tracker:r,events:n}=ur(e,t),s=o=>$t(e,o),i={open:e.open,write:e.write,close:e.close,mkdir:e.mkdir,unlink:e.unlink,rmdir:e.rmdir,rename:e.rename,symlink:e.symlink};return e.open=function(o,l,a){let u=i.open.call(this,o,l,a);return Jn(l)&&u.path&&n.openedForWrite(u.path),u},e.write=function(o,...l){let a=i.write.call(this,o,...l);return o.path&&n.written(o.path),a},e.close=function(o){let l=o.path;i.close.call(this,o),l&&n.closed(l)},e.mkdir=function(o,l){let a=i.mkdir.call(this,o,l);return n.madeDirectory(s(o)),a},e.unlink=function(o){i.unlink.call(this,o),n.deleted(s(o))},e.rmdir=function(o){i.rmdir.call(this,o),n.deleted(s(o))},e.rename=function(o,l){i.rename.call(this,o,l),n.moved(s(o),s(l))},e.symlink=function(o,l){let a=i.symlink.call(this,o,l);return n.symlinked(s(l)),a},r}var De=e=>`'${e.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;function oe(e,t){return e==null?"null":typeof e=="boolean"||typeof e=="number"?JSON.stringify(e):typeof e=="string"?t?.(e)??De(e):Array.isArray(e)?`[${e.map(r=>oe(r,t)).join(", ")}]`:`[${Object.entries(e).map(([r,n])=>`${oe(r)} => ${oe(n,t)}`).join(", ")}]`}var fr=String.raw`<?php
// Generated by the BuilderForce WebContainers PHP runtime (composer install).
require_once __DIR__ . '/composer/ClassLoader.php';
require_once __DIR__ . '/composer/InstalledVersions.php';
return \Composer\Autoload\ClassLoader::bfwcBoot(require __DIR__ . '/composer/autoload_bfwc.php');
`,dr=String.raw`<?php
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
`,hr=String.raw`<?php
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
`;var Xn=/^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z_\x80-￿][A-Za-z0-9_\x80-￿]*)/gm,es=/^\s*namespace\s+([A-Za-z_\\][A-Za-z0-9_\\]*)\s*[;{]/m;function ts(e){let t=e.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*(\/\/|#).*$/gm,""),r=es.exec(t)?.[1];return[...t.matchAll(Xn)].map(n=>r?`${r}\\${n[2]}`:n[2])}function yt(e,t,r,n,s){var l,a,u;if(!s)return;let i=p=>P(r,n,p);for(let[p,c]of Object.entries(s["psr-4"]??{}))((l=e.psr4)[p]??(l[p]=[])).push(...[c].flat().map(i));for(let[p,c]of Object.entries(s["psr-0"]??{}))((a=e.psr0)[p]??(a[p]=[])).push(...[c].flat().map(i));for(let p of s.files??[])e.files.push(i(p));let o=(s["exclude-from-classmap"]??[]).map(i);for(let p of s.classmap??[]){let c=i(p),d=t.isDir(c)?t.list(c).filter(g=>/\.(php|inc|hh)$/.test(g)):[c];for(let g of d)if(!o.some(h=>g.startsWith(h)))for(let h of ts(t.read(g)??""))(u=e.classmap)[h]??(u[h]=g)}}var rs=e=>t=>t===e||t.startsWith(`${e}/`)?`$baseDir . ${oe(t.slice(e.length))}`:void 0;function ns(e){let t=new Map(e.map(i=>[i.name.toLowerCase(),i])),r=new Set,n=[],s=(i,o)=>{let l=i.name.toLowerCase();if(!(r.has(l)||o.has(l))){o.add(l);for(let a of Object.keys(i.require??{}).sort()){let u=t.get(a.toLowerCase());u&&s(u,o)}o.delete(l),r.add(l),n.push(i)}};for(let i of[...e].sort((o,l)=>o.name.localeCompare(l.name)))s(i,new Set);return n}function vt(e,t,r,n,s){let i={psr4:{},psr0:{},classmap:{},files:[]};yt(i,e,t,"",r.autoload),s.dev&&yt(i,e,t,"",r["autoload-dev"]);let o=i.files.splice(0);for(let c of ns(n))yt(i,e,t,`vendor/${c.name}`,c.autoload);i.files.push(...o);let l=P(t,"vendor"),a=rs(t);e.write(P(l,"autoload.php"),fr),e.write(P(l,"composer/ClassLoader.php"),dr),e.write(P(l,"composer/InstalledVersions.php"),hr),e.write(P(l,"composer/autoload_bfwc.php"),`<?php
// Generated by the BuilderForce WebContainers PHP runtime.
$baseDir = dirname(__DIR__, 2);
return ${oe(i,a)};
`),e.write(P(l,"composer/installed.json"),`${JSON.stringify({packages:n,dev:s.dev,"dev-package-names":[...s.devPackages]},null,4)}
`);let u=Object.fromEntries(n.map(c=>[c.name,{pretty_version:c.version,version:c.version_normalized??c.version,reference:c.dist?.reference??c.source?.reference??null,type:c.type??"library",install_path:P(l,c.name),aliases:[],dev_requirement:s.devPackages.has(c.name)}])),p={name:r.name??"__root__",pretty_version:r.version??"dev-main",version:r.version??"dev-main",reference:null,type:"project",install_path:t,aliases:[],dev:s.dev};e.write(P(l,"composer/installed.php"),`<?php
$baseDir = dirname(__DIR__, 2);
return ${oe({root:p,versions:{...u,[p.name]:{...p,dev_requirement:!1}}},a)};
`)}var fe={dev:0,alpha:1,beta:2,RC:3,stable:4},$r=/^[._-]?(stable|beta|b|RC|rc|alpha|a|patch|pl|p|dev)((?:[.-]?\d+)*)$/;function te(e){let t=e.trim().replace(/^v(?=\d)/i,"");if(/^dev-/i.test(t))return{parts:[],stability:"dev",pre:0,branch:t.toLowerCase()};let r=/^(\d+)(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?(.*)$/i.exec(t);if(!r)return;let n=[r[1],r[2],r[3],r[4]].map(a=>a===void 0?0:/[x*]/i.test(a)?9999999:Number(a)),s=r[5]??"";if(!s)return{parts:n,stability:"stable",pre:0};let i=$r.exec(s.replace(/^-?(?=[a-z])/i,"-"))??$r.exec(s);if(!i)return;let o=i[1].toLowerCase(),l=o==="dev"?"dev":o==="rc"?"RC":o.startsWith("b")?"beta":o.startsWith("a")?"alpha":"stable";return{parts:n,stability:/-dev$/i.test(s)?"dev":l,pre:Number((i[2]??"").replace(/\D/g,"")||0)}}function X(e,t){if(e.branch||t.branch)return e.branch&&t.branch?e.branch.localeCompare(t.branch):e.branch?-1:1;for(let r=0;r<4;r++)if(e.parts[r]!==t.parts[r])return e.parts[r]-t.parts[r];return fe[e.stability]-fe[t.stability]||e.pre-t.pre}var bt=(e,t)=>fe[e.stability]>=fe[t];function Pt(e){let t=(e??"stable").toLowerCase();return t==="rc"?"RC":["dev","alpha","beta","stable"].find(r=>r===t)??"stable"}var j=(e,t="dev")=>({parts:[...e,0,0,0,0].slice(0,4),stability:t,pre:0}),Se=e=>t=>!t.branch&&X(t,e)>=0,ke=e=>t=>!t.branch&&X(t,e)<0,qe=(e,t)=>r=>e(r)&&t(r),wt=e=>e.replace(/^v/i,"").split(/[-@+]/)[0].split(".").filter(t=>/^\d+$/.test(t)).map(Number);function ss(e){let t=/@(stable|rc|beta|alpha|dev)$/i.exec(e),r=t?e.slice(0,t.index):e,n=t?Pt(t[1]):void 0,s=(c,d)=>({test:c,stability:n??d});if(r===""||r==="*"||/^[*x](\.[*x])*$/i.test(r))return s(()=>!0);if(/^dev-/i.test(r)){let c=r.toLowerCase();return s(d=>d.branch===c,"dev")}let i=/^(\^|~|>=|<=|>|<|!=|==|=)?\s*(.+)$/.exec(r);if(!i)return;let[,o="",l=""]=i,a=te(l);if(!a)return;let u=a.stability==="stable"?void 0:a.stability,p=wt(l);if(/[*x]$/i.test(l.replace(/-dev$/i,""))&&o===""&&!/-dev$/i.test(l)){let c=p,d=[...c.slice(0,-1),(c[c.length-1]??-1)+1];return s(c.length?qe(Se(j(c)),ke(j(d))):()=>!0)}switch(o){case"^":{let c=p.findIndex(h=>h!==0),d=c===-1?Math.max(p.length-1,0):c,g=[...p.slice(0,d),(p[d]??0)+1];return s(qe(Se(j(p,a.stability==="stable"?"dev":a.stability)),ke(j(g))),u)}case"~":{let c=Math.max(p.length-2,0),d=[...p.slice(0,c),(p[c]??0)+1];return s(qe(Se(j(p,a.stability==="stable"?"dev":a.stability)),ke(j(d))),u)}case">=":return s(Se(a.stability==="stable"?j(p):a),u);case">":return s(c=>!c.branch&&X(c,a)>0,u);case"<":return s(ke(a.stability==="stable"?j(p):a),u);case"<=":return s(c=>!c.branch&&X(c,a)<=0,u);case"!=":return s(c=>c.branch!==void 0||X(c,a)!==0,u);default:return s(c=>!c.branch&&X(c,a)===0,u)}}var mr=e=>e.reduce((t,r)=>r&&(!t||fe[r]<fe[t])?r:t,void 0);function Me(e){let t=e.trim().split(/\s*\|\|?\s*/),r=[];for(let n of t){let s=n.replace(/(\^|~|>=|<=|>|<|!=|==|=)\s+/g,"$1").trim(),i=/^(\S+)\s+-\s+(\S+)$/.exec(s);if(i){let a=te(i[1]),u=wt(i[2]);if(!a)return;let p=u.length<3?ke(j([...u.slice(0,-1),u[u.length-1]+1])):c=>!c.branch&&X(c,j(u,"stable"))<=0;r.push({test:qe(Se(j(wt(i[1]))),p)});continue}let o=s.split(/\s*,\s*|\s+/).filter(Boolean).map(ss);if(!o.length||o.some(a=>!a))return;let l=o;r.push({test:a=>l.every(u=>u.test(a)),stability:mr(l.map(a=>a.stability))})}return{test:n=>r.some(s=>s.test(n)),stability:mr(r.map(n=>n.stability))}}function _t(e,t){let r=te(e),n=Me(t);return!!r&&!!n&&n.test(r)}var xt={composer:"2.8.0","composer-plugin-api":"2.6.0","composer-runtime-api":"2.2.2"},is=/^(?:php(?:-64bit|-ipv6|-zts|-debug)?|hhvm|(?:ext|lib)-[a-z0-9](?:[_.-]?[a-z0-9]+)*|composer(?:-(?:plugin|runtime)-api)?)$/,re=e=>is.test(e.toLowerCase()),os="php-wasm's images have no pgsql/pdo_pgsql extension (and no libpq to build one); new PDO('pgsql:\u2026') and the pg_* functions still work, on the runtime's pure-PHP driver (\\Bfwc\\Pgsql\\PDO), but a package that requires the extension itself is declined",gr={"zend-opcache":"zend opcache",opcache:"zend opcache"};function Ue(e,t,r){let n=e.toLowerCase();if(n==="php"||n==="php-zts"||n==="php-debug")return n!=="php"?`${e} is not available (php-wasm is a non-thread-safe release build).`:_t(r.phpVersion,t)?void 0:`PHP ${r.phpVersion} does not satisfy php ${t}.`;if(n==="php-64bit")return"php-64bit is not available (php-wasm is 32-bit).";if(n!=="php-ipv6"&&re(n)){if(n==="hhvm")return"hhvm is not available (the runtime is PHP on php-wasm).";if(Object.hasOwn(xt,n))return _t(xt[n],t)?void 0:`${e} ${t} is not provided (the runtime's installer answers as ${e} ${xt[n]}).`;if(n.startsWith("ext-")){let s=n.slice(4);return r.extensions.has(Object.hasOwn(gr,s)?gr[s]:s)?void 0:s==="pgsql"||s==="pdo_pgsql"?`ext-${s}: ${os}.`:`ext-${s} is not in the php-wasm image (loaded: ${[...r.extensions].sort().join(", ")}).`}}}var as=/^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]?|-{0,2})[a-z0-9]+)*$/,ae=class extends Error{},yr=e=>as.test(e)&&!vr(e),vr=e=>e.split("/").some(t=>t==="."||t===".."||t===""),St=(e,t)=>new ae(`Invalid package name "${e}" in ${t}: Composer names are vendor/package, lower-case letters, digits and [_.-] separators.`);function z(e,t){let r=e.toLowerCase();if(re(r)||yr(r))return r;throw St(e,t)}function Fe(e,t){let r=typeof e=="string"?e.toLowerCase():"";if(yr(r))return r;throw St(String(e),t)}function We(e,t){return P(e,"vendor",Fe(t,"a vendor path"))}function wr(e){if(vr(e))throw St(e,"a repository URL");return e.split("/").map(encodeURIComponent).join("/")}function br(e){let r=(Array.isArray(e.repositories)?e.repositories:Object.entries(e.repositories??{}).map(([n,s])=>s===!1?{type:`${n}: false`}:s)).map(n=>n).filter(n=>!(n?.type==="composer"&&typeof n.url=="string"&&/^https:\/\/(repo\.)?packagist\.org\/?$/.test(n.url))).map(n=>typeof n?.type=="string"?n.type:"unknown");if(r.length)return`composer.json declares repositories of type ${[...new Set(r)].join(", ")}, which the PHP runtime does not support (it installs from Packagist, or the host's php.composer.repositoryUrl, only).`}function kt(e){let t=[];for(let r of e){let n=/^([^:=\s]+)[:=](.+)$/.exec(r);n?t.push({name:z(n[1],"composer require"),constraint:n[2]}):!r.includes("/")&&t.length&&t[t.length-1].constraint===void 0?t[t.length-1].constraint=r:t.push({name:z(r,"composer require")})}return t}function Pr(e,t){let r=new Map;for(let i of t.values())for(let o of[...Object.keys(i.replace??{}),...Object.keys(i.provide??{})])r.set(o.toLowerCase(),i.name);let n=new Set,s=Object.keys(e.require??{}).map(i=>i.toLowerCase());for(;s.length;){let i=s.shift(),o=t.get(i)??t.get(r.get(i)??"");!o||n.has(o.name)||(n.add(o.name),s.push(...Object.keys(o.require??{}).map(l=>l.toLowerCase())))}return n}function _r(e,t){return`${JSON.stringify({_readme:["This file locks the dependencies of your project to a known state","Written by the BuilderForce WebContainers PHP runtime"],...e,aliases:[],"minimum-stability":t.minimumStability,"stability-flags":{},"prefer-stable":t.preferStable,"prefer-lowest":!1,platform:{},"platform-dev":{},"plugin-api-version":"2.6.0"},null,4)}
`}var Q=class extends Error{},Et=e=>te(e.version_normalized??e.version),xr=e=>Object.entries(e.require??{}).map(([t,r])=>({name:z(t,`${e.name}'s require`),constraint:r,from:e.name})),Sr=e=>[...Object.keys(e.replace??{}),...Object.keys(e.provide??{})].map(t=>t.toLowerCase());function Rt(e,t,r){return Er(e,t,r)[0]}function Er(e,t,r,n){let s=t.reduce((a,u)=>u.stability&&bt({parts:[],stability:a,pre:0},u.stability)?u.stability:a,r.minimumStability),i=e.map(a=>({pkg:a,version:Et(a)})).filter(a=>!!a.version&&bt(a.version,s)&&t.every(u=>u.test(a.version))).sort((a,u)=>X(u.version,a.version)),o=r.preferStable?[...i.filter(a=>a.version.stability==="stable"),...i.filter(a=>a.version.stability!=="stable")]:i,l=n===void 0?-1:o.findIndex(a=>a.pkg.version===n);return l>0&&o.unshift(...o.splice(l,1)),o.map(a=>a.pkg)}function kr(e,t){return t.map(r=>{let n=Me(r.constraint);if(!n)throw new Q(`Cannot read the version constraint "${r.constraint}" on ${e} (required by ${r.from}).`);return n})}async function Rr(e,t,r,n={}){let s=new Set(Sr(n)),i={steps:r.maxSteps??2e4},o="",l=-1,a=(h,f)=>{h>=l&&(o=f,l=h)},u=new Map,p=async h=>(u.has(h)||u.set(h,await t.versions(h)),u.get(h)),c=h=>{let f=[{from:"root",conflict:n.conflict},...[...h.values()].map(m=>({from:m.name,conflict:m.conflict}))];for(let{from:m,conflict:y}of f)for(let[_,b]of Object.entries(y??{})){let L=_.toLowerCase(),M=Me(b),w=h.get(L),C=w&&Et(w);if(C&&M?.test(C))return`${m} conflicts with ${w.name} ${b}`;for(let R of h.values()){let T={...R.provide,...R.replace},I=Object.entries(T).find(([x])=>x.toLowerCase()===L)?.[1];if(I===void 0)continue;let $=te(I==="self.version"?R.version_normalized??R.version:I.replace(/^[=\s]+/,""));if($&&M?.test($))return`${m} conflicts with ${L} ${b} (${R.name} ${I==="self.version"?"replaces/provides it":`provides ${I}`})`}}},d=async h=>{if(--i.steps<0)throw new Q("Dependency resolution took too long; pin the conflicting packages in composer.json.");let f=new Map;for(let w of[...e,...[...h.values()].flatMap(xr)])re(w.name)||f.set(w.name,[...f.get(w.name)??[],w]);let m=new Set([...s,...[...h.values()].flatMap(Sr)]);for(let[w,C]of h){let R=f.get(w)??[],T=Et(C),I=kr(w,R),$=R.find((x,O)=>!I[O].test(T));if($){a(h.size,`${w} ${C.version} was chosen, but ${$.from} requires ${w} ${$.constraint}.`);return}}let y=c(h);if(y){a(h.size,`${y}.`);return}let _=[...f.keys()].filter(w=>!h.has(w)&&!m.has(w)),b;for(let w of _)if(await p(w)){b=w;break}if(b===void 0){if(!_.length)return h;let w=_[0];a(h.size,`Package ${w} (required by ${f.get(w).map(C=>C.from).join(", ")}) was not found in the repository, and no chosen package provides or replaces it.`);return}let L=f.get(b),M=Er(await p(b),kr(b,L),r,r.preferred?.get(b));if(!M.length){a(h.size,`No version of ${b} satisfies ${L.map(w=>`${w.constraint} (required by ${w.from})`).join(" and ")} at minimum-stability ${r.minimumStability}.`);return}for(let w of M){let C=r.platform&&Object.entries(w.require??{}).map(([T,I])=>re(T.toLowerCase())?Ue(T,I,r.platform):void 0).find(Boolean);if(C){a(h.size,`${w.name} ${w.version} is declined: ${C}`);continue}try{xr(w)}catch(T){if(!(T instanceof ae))throw T;a(h.size,`${w.name} ${w.version} is skipped: ${T.message}`);continue}let R=await d(new Map([...h,[b,w]]));if(R)return R}},g=await d(new Map);if(!g)throw new Q(o||"No installable set of packages satisfies composer.json.");return{packages:g}}function Tr(e,t){return[...Object.entries(e.require??{}),...t?[]:Object.entries(e["require-dev"]??{})].map(([n,s])=>({name:n.toLowerCase(),constraint:s,from:"root"}))}var ne=class extends Error{},ls=["pre-install-cmd","post-install-cmd","pre-update-cmd","post-update-cmd","post-autoload-dump","post-root-package-install","post-create-project-cmd"],He=(e,t)=>{try{return JSON.parse(e)}catch(r){throw new ne(`${t} does not contain valid JSON: ${r instanceof Error?r.message:String(r)}`)}};function Tt(e,t,r,n){return[...Object.entries({...e.require,...r?e["require-dev"]:{}}).map(([o,l])=>({name:o,constraint:l,from:"your project"})),...t.flatMap(o=>Object.entries(o.require??{}).map(([l,a])=>({name:l,constraint:a,from:o.name})))].flatMap(({name:o,constraint:l,from:a})=>{let u=re(o.toLowerCase())?Ue(o,l,n):void 0;return u?[`${a} requires ${o} ${l}: ${u}`]:[]})}async function Cr(e,t){let{files:r,projectDir:n}=t,s=P(n,"composer.json"),i=P(n,"composer.lock"),o=P(n,"vendor/composer/installed.json"),l=r.read(s),a=r.read(i),u=!e.noDev;try{if(l===void 0&&e.command!=="require")throw new ne(`Composer could not find a composer.json file in ${n}`);let p=He(l??"{}",s),c=br(p);if(c)throw new ne(c);for(let $ of["require","require-dev","replace","provide","conflict"])for(let x of Object.keys(p[$]??{}))z(x,`composer.json ${$}`);let g=(()=>{let $=r.read(o);if($===void 0)return{packages:[],devNames:[]};let x=He($,o);for(let O of x.packages??[])Fe(O.name,o);return{packages:x.packages??[],devNames:x["dev-package-names"]??[]}})();if(e.command==="dump-autoload"){let{packages:$,devNames:x}=g,O=new Set(x);return vt(r,n,p,u?$:$.filter(A=>!O.has(A.name)),{dev:u,devPackages:u?O:new Set}),t.out(`Generating autoload files
Generated autoload files
`),0}let h={minimumStability:Pt(p["minimum-stability"]),preferStable:!!p["prefer-stable"]};if(e.command==="require"){let $=e.dev?"require-dev":"require";for(let{name:x,constraint:O}of kt(e.packages)){let A=O;if(!A){let H=await t.source.versions(x),U=H?.filter(Ve=>e.ignorePlatformReqs||!Tt({},[Ve],!1,t.platform).length),E=U&&Rt(U,[],h),K=!E&&H&&Rt(H,[],h);if(K)throw new Q(`${K.name} ${K.version} is declined: ${Tt({},[K],!1,t.platform).join("; ")}`);let N=E&&te(E.version_normalized??E.version);if(!N||N.branch)throw new Q(`Could not find a stable version of package ${x}.`);A=`^${N.parts[0]}.${N.parts[1]}`}p[$]={...p[$],[x]:A},t.err(`./composer.json has been updated (${x}: ${A})
`)}}let f=`${JSON.stringify(p,null,4)}
`,m=e.command==="install"&&a!==void 0?He(a,i):void 0,y=!1;if(m){t.err("Installing dependencies from lock file"+(u?" (including require-dev)":"")+`
`);for(let $ of[...m.packages??[],...m["packages-dev"]??[]])Fe($.name,i);m["content-hash"]&&m["content-hash"]!==await t.contentHash(l??f)&&t.err("Warning: The lock file is not up to date with the latest changes in composer.json. Run `composer update`.\n")}else{t.err(e.command==="install"?`No composer.lock file present. Updating dependencies to latest instead of installing from lock file.
`:`Updating dependencies
`);let $=e.command==="require"?kt(e.packages).map(E=>E.name):e.packages.map(E=>z(E,"composer update")),x=$.length&&a!==void 0?He(a,i):void 0,O=new Map([...x?.packages??[],...x?.["packages-dev"]??[]].filter(E=>!$.includes(E.name)).map(E=>[E.name,E.version])),A=await Rr(Tr(p,!1),t.source,{...h,preferred:O,platform:e.ignorePlatformReqs?void 0:t.platform},p);for(let E of A.packages.values())t.err(`  - Locking ${E.name} (${E.version})
`);let H=Pr(p,A.packages),U=[...A.packages.values()].sort((E,K)=>E.name.localeCompare(K.name));m={"content-hash":await t.contentHash(f),packages:U.filter(E=>H.has(E.name)),"packages-dev":U.filter(E=>!H.has(E.name))},y=!0}let _=[...m.packages??[],...u?m["packages-dev"]??[]:[]],b=new Set(u?(m["packages-dev"]??[]).map($=>$.name):[]),L=e.ignorePlatformReqs?[]:Tt(p,_,u,t.platform);if(L.length)throw new ne(`Your requirements could not be resolved to an installable set of packages.
${L.map($=>`  - Declined: ${$}`).join(`
`)}`);e.command==="require"&&r.write(s,f),y&&(r.write(i,_r(m,h)),t.err(`Writing lock file
`));let M=new Map(g.packages.map($=>[$.name,$])),w=($,x)=>!!$&&$.version===x.version&&($.dist?.reference??null)===(x.dist?.reference??null)&&r.isDir(We(n,x.name)),C=_.filter($=>!w(M.get($.name),$)),R=[...M.keys()].filter($=>!_.some(x=>x.name===$));t.err(`Package operations: ${C.length} install${C.length===1?"":"s"}, 0 updates, ${R.length} removal${R.length===1?"":"s"}
`);let T=[];for(let $ of C){t.err(`  - Downloading ${$.name} (${$.version})
`);let x=await t.source.files($);for(let O of x.keys())if(O.split("/").some(A=>A===".."||A==="."||A===""))throw new ne(`${$.name} ${$.version} holds a file outside its directory ("${O}").`);T.push([$,x])}for(let $ of R)r.remove(We(n,$)),t.err(`  - Removing ${$}
`);for(let[$,x]of T){let O=We(n,$.name);t.err(`  - Installing ${$.name} (${$.version})
`),r.remove(O);for(let[A,H]of x)r.write(P(O,A),H);$.type==="composer-plugin"&&t.err(`    ${$.name} is a Composer plugin; plugins do not run in the PHP runtime.
`)}!C.length&&!R.length&&t.err(`Nothing to install, update or remove
`),t.err(`Generating autoload files
`),vt(r,n,p,_,{dev:u,devPackages:b});let I=ls.filter($=>p.scripts?.[$]!==void 0);return I.length&&t.err(`Composer scripts do not run in the PHP runtime (${I.join(", ")}); run their commands yourself if needed.
`),0}catch(p){(e.command==="require"||e.command==="update")&&(l===void 0?r.remove(s):r.read(s)!==l&&r.write(s,l),a===void 0?r.remove(i):r.read(i)!==a&&r.write(i,a));let c=p instanceof Q||p instanceof ne||p instanceof ae,d=p instanceof Q?`Your requirements could not be resolved to an installable set of packages.
  `:"";return t.err(`${d}${p instanceof Error?p.message:String(p)}
`),c?2:1}}var cs="https://packagist.org/packages/{name}.json",us="https://cdn.jsdelivr.net/gh/",ps="https://data.jsdelivr.com/v1/packages/gh/";function fs(e){let t=[],r={};for(let n of e){let s={...r};for(let[i,o]of Object.entries(n))o==="__unset"?delete s[i]:s[i]=o;t.push(s),r=s}return t}function ds(e,t){let r=t;if(r.package?.versions)return Object.values(r.package.versions).map(s=>({...s,name:e}));let n=r.packages?.[e];if(Array.isArray(n))return(r.minified?fs(n):n).map(s=>({...s,name:e}));if(n)return Object.values(n).map(s=>({...s,name:e}))}function Or(e){let t=e&&/^https:\/\/(?:api\.)?github\.com\/(?:repos\/)?([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/.exec(e);return t?{owner:t[1],repo:t[2]}:void 0}var de={maxEntries:5e4,maxTotalBytes:256*1024*1024,maxEntryBytes:64*1024*1024},Ct=128*1024*1024,W=class extends Error{};function hs(e){let t=new se;try{it(t,e,"/",de)}catch(o){throw o instanceof ee?new W(o.message):o}let r=t.list(),n=new Set(r.map(o=>o.split("/")[1])),s=n.size===1&&r.every(o=>o.split("/").length>2)?`/${[...n][0]}/`:"/",i=new Map;for(let o of r){let l=t.readFile(o);i.set(o.slice(s.length),typeof l=="string"?new TextEncoder().encode(l):l??new Uint8Array)}return i}async function Ot(e,t){let r=await e(t);if(!r.ok)throw new Error(`GET ${t}: ${r.status} ${r.statusText}`);return r}async function Ge(e,t,r){let n=Number(e.headers.get("content-length"));if(n>t)throw new W(`${r} is ${n} bytes, over the ${t}-byte limit.`);if(!e.body)return new Uint8Array(await e.arrayBuffer());let s=e.body.getReader(),i=[],o=0;for(;;){let{value:u,done:p}=await s.read();if(p)break;if(o+=u.byteLength,o>t)throw await s.cancel(),new W(`${r} exceeds the ${t}-byte limit.`);i.push(u)}let l=new Uint8Array(o),a=0;for(let u of i)l.set(u,a),a+=u.byteLength;return l}async function $s(e,t,r){if(!t)return;let s=[...new Uint8Array(await crypto.subtle.digest("SHA-1",e))].map(i=>i.toString(16).padStart(2,"0")).join("");if(s!==t.toLowerCase())throw new W(`${r}: checksum mismatch (sha1 ${s}, metadata says ${t}).`)}function ms(e,t){let r;try{r=new URL(e)}catch{throw new W(`${t}: dist URL "${e}" is not an absolute URL.`)}let n=r.hostname==="localhost"||r.hostname==="[::1]"||/^127\./.test(r.hostname);if(r.protocol!=="https:"&&!(r.protocol==="http:"&&n))throw new W(`${t}: dist URL "${e}" is not https.`)}var gs=/^[A-Za-z0-9._-]+$/;async function ys(e,t,r,n){if(![t,r,n].every(a=>gs.test(a)))throw new W(`Refusing GitHub source ${t}/${r}@${n}: not a plain repository and commit.`);let i=(JSON.parse(new TextDecoder().decode(await Ge(await Ot(e,`${ps}${t}/${r}@${n}?structure=flat`),Ct,"The jsDelivr listing"))).files??[]).map(a=>a.name);if(i.length>de.maxEntries)throw new W(`${t}/${r} has ${i.length} files, over the ${de.maxEntries}-entry limit.`);for(let a of i)if(!a.startsWith("/")||a.split("/").some(u=>u===".."||u==="."))throw new W(`Refusing file "${a}" in ${t}/${r}.`);let o=new Map,l=0;for(let a=0;a<i.length;a+=8)await Promise.all(i.slice(a,a+8).map(async u=>{let p=await Ge(await Ot(e,`${us}${t}/${r}@${n}${u.split("/").map(encodeURIComponent).join("/")}`),de.maxEntryBytes,u);if(l+=p.byteLength,l>de.maxTotalBytes)throw new W(`${t}/${r} exceeds the ${de.maxTotalBytes}-byte limit.`);o.set(u.slice(1),p)}));return o}function Ar(e={}){let t=e.fetch??((s,i)=>fetch(s,i)),r=e.repositoryUrl??cs,n=new Map;return{versions(s){let i;try{i=z(s,"a package request")}catch(l){return Promise.reject(l)}let o=n.get(i);return o||(o=(async()=>{let l=await t(r.replace("{name}",wr(i)));if(l.status!==404){if(!l.ok)throw new Error(`Package metadata for ${i}: ${l.status} ${l.statusText}`);return ds(i,JSON.parse(new TextDecoder().decode(await Ge(l,Ct,`Package metadata for ${i}`))))}})(),n.set(i,o)),o},async files(s){let i=s.dist,o=Or(i?.url)??Or(s.source?.url??void 0),l=i?.reference??s.source?.reference,a=`${s.name} ${s.version}`;if(i?.url&&(i.type??"zip")==="zip"){ms(i.url,a);let u=e.distProxy?`${e.distProxy}${encodeURIComponent(i.url)}`:i.url,p;try{p=await Ot(t,u)}catch(c){if(!o||!l||e.distProxy)throw c}if(p){let c=await Ge(p,Ct,a);return await $s(c,i.shasum,a),hs(c)}}if(o&&l)return ys(t,o.owner,o.repo,l);throw new Error(`${a} has no zip dist or GitHub source the PHP runtime can fetch.`)}}}var Ir=e=>e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength);function Lr(e){let t=e.getReader();return new ReadableStream({async pull(r){let{value:n,done:s}=await t.read();if(s)return r.close();let i=Ir(n);i.byteLength&&r.enqueue(i.slice())},cancel:r=>t.cancel(r)})}async function At(e,t){let r=e.getReader();for(;;){let{value:n,done:s}=await r.read();if(s)return;let i=Ir(n);i.byteLength&&t(i.slice())}}async function je(e,t){let r=new TextDecoder;await At(e,s=>{let i=r.decode(s,{stream:!0});i&&t(i)});let n=r.decode();n&&t(n)}var Be="/bfwc/php-server-front.php",Dr="x-bfwc-router-declined";function vs(e){return["<?php",...Object.entries(e).map(([r,n])=>`ini_set(${De(r)}, ${De(n)});`),"if (($_SERVER['HTTPS'] ?? '') === 'off') unset($_SERVER['HTTPS']);","if ((require $_SERVER['SCRIPT_FILENAME']) === false && !headers_sent()) header('X-Bfwc-Router-Declined: 1');",""].join(`
`)}var ws=e=>/\.[^/]+$/.test(e);function bs(e,t,r){let n=k(e),s=a=>a==="/"?t:P(t,a),i=(a,u,p)=>a.endsWith(".php")?{kind:"script",file:a,scriptName:u,pathInfo:p}:{kind:"file",file:a},o=a=>["index.php","index.html"].map(u=>({url:P(a,u),file:P(s(a),u)})).find(({file:u})=>r.isFile(u));if(r.isFile(s(n)))return i(s(n),n);if(r.isDir(s(n))){let a=o(n);if(a)return i(a.file,a.url)}let l=n.split("/").filter(Boolean);for(let a=l.length-1;a>0;a--){let u=`/${l.slice(0,a).join("/")}`;if(u.endsWith(".php")&&r.isFile(s(u)))return i(s(u),u,`/${l.slice(a).join("/")}`)}if(ws(n))return{kind:"missing"};for(let a=l.length;a>=0;a--){let u=`/${l.slice(0,a).join("/")}`;if(!r.isDir(s(u)))continue;let p=o(u);if(p)return i(p.file,p.url,n===u?void 0:n.slice(u==="/"?0:u.length)||void 0)}return{kind:"missing"}}var Nr=e=>({status:404,headers:{"content-type":"text/html; charset=UTF-8"},body:we(new TextEncoder().encode(`<!doctype html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested resource <code>${e.replace(/[<>&"]/g,"")}</code> was not found on this server.</p></body></html>`))});function Ps(e){let t={};for(let[r,n]of Object.entries(e)){let s=r.toLowerCase();s===Dr||!n.length||(t[s]=n.length===1?n[0]:[...n])}return t}async function qr(e,t){let{php:r,files:n,docroot:s,router:i}=t;n.mkdirTree(Be.slice(0,Be.lastIndexOf("/"))),n.write(Be,vs(e.ini)),r.chdir(s);let o=e.host.replace(/^\[|\]$/g,""),l=`${o.includes(":")?`[${o}]`:o}:${e.port}`,a=async(c,d)=>{let g=c.url.includes("?")?c.url.slice(c.url.indexOf("?")+1):"",h={DOCUMENT_ROOT:s,SCRIPT_FILENAME:d.file,SCRIPT_NAME:d.scriptName,PHP_SELF:d.scriptName+(d.pathInfo??""),SERVER_NAME:o,SERVER_PORT:String(e.port),SERVER_PROTOCOL:"HTTP/1.1",SERVER_SOFTWARE:`PHP ${t.phpVersion} Development Server (php-wasm, BuilderForce WebContainers)`,REMOTE_ADDR:"127.0.0.1",QUERY_STRING:g};return d.pathInfo&&(h.PATH_INFO=d.pathInfo),r.runStream({scriptPath:Be,relativeUri:c.url,method:c.method.toUpperCase(),headers:{host:l,...c.headers},protocol:"http",body:c.body??void 0,env:t.env,$_SERVER:h})},u=async(c,d,g)=>{if(g.kind==="missing")return Nr(d);if(g.kind==="file")return{status:200,headers:{"content-type":ot(Ze(g.file))},body:we(n.read(g.file))};let h=await a(c,g);je(h.stderr,t.log).catch(()=>{});let[f,m]=await Promise.all([h.httpStatusCode,h.headers]);return m[Dr]?.length?(h.stdout.cancel(),"declined"):{status:f,headers:Ps(m),body:Lr(h.stdout)}};return{spec:e,handle:async c=>{let d=c.url.split("?")[0].split("#")[0],g;try{g=decodeURIComponent(d)||"/"}catch{return ue(400,"Bad Request")}try{let h=i?await u(c,g,{kind:"script",file:i,scriptName:i.startsWith(`${s}/`)?i.slice(s.length):`/${i.split("/").pop()}`}):"declined";return h==="declined"&&(h=await u(c,g,bs(g,s,n)),h==="declined"&&(h=Nr(g))),t.log(`[${h.status}]: ${c.method.toUpperCase()} ${c.url}
`),h}catch(h){let f=h instanceof Error?h.message:String(h);return t.log(`[500]: ${c.method.toUpperCase()} ${c.url} - ${f}
`),ue(500,`PHP failed to handle the request: ${f}`)}}}}var Ee=xe;function _s(e){let t=n=>Ne(e,n).flatMap(s=>Ee(e,P(n,s))?t(P(n,s)):[P(n,s)]);return{read:n=>Le(e,n)?new TextDecoder().decode(e.readFile(n)):void 0,write(n,s){e.mkdirTree(Y(n)),e.writeFile(n,s)},isDir:n=>Ee(e,n),list:n=>Ee(e,n)?t(n):[],remove:n=>_e(e,n)}}async function Mr(e,t){let r=await e.php.run({code:t});if(r.exitCode!==0)throw new Error(`PHP failed: ${r.errors||r.text}`);return r.text}var xs=e=>`<?php
$c = json_decode(base64_decode('${ft(new TextEncoder().encode(e))}'), true) ?: [];
$keys = ['name', 'version', 'require', 'require-dev', 'conflict', 'replace', 'provide', 'minimum-stability', 'prefer-stable', 'repositories', 'extra'];
$r = array_intersect_key($c, array_flip($keys));
if (isset($c['config']['platform'])) { $r['config']['platform'] = $c['config']['platform']; }
ksort($r);
echo md5(json_encode($r));`;async function Ur(e,t){let[r,n]=JSON.parse(await Mr(e,'<?php echo json_encode([PHP_VERSION, array_map("strtolower", get_loaded_extensions())]);')),s={phpVersion:r,extensions:new Set(n)};return t.platformKnown?.(s),s}async function Ss(e,t,r){let n=await Ur(e,r),s=t.workingDir?me(r.cwd,t.workingDir):r.cwd;return Cr(t,{files:_s(e.module.FS),source:Ar({...r.composer,fetch:r.fetch}),platform:n,projectDir:s,contentHash:i=>Mr(e,xs(i)),out:i=>r.io.stdout(i),err:i=>r.io.stderr(i)})}async function Fr(e,t,r){let{php:n,module:s}=e;if(t.kind==="composer")return{kind:"exited",code:await Ss(e,t,r)};if(t.kind==="serve"){await n.setSapiName("cli-server");let o=(await Ur(e,r)).phpVersion,l=t.server.docroot?me(r.cwd,t.server.docroot):r.cwd;if(!Ee(s.FS,l))return r.io.stderr(`Directory ${t.server.docroot} does not exist.
`),{kind:"exited",code:1};let a=t.server.router?me(r.cwd,t.server.router):void 0;if(a&&!Le(s.FS,a))return r.io.stderr(`Could not open input file: ${t.server.router}
`),{kind:"exited",code:1};let u=await qr(t.server,{php:n,files:{isFile:p=>Le(s.FS,p),isDir:p=>Ee(s.FS,p),read:p=>s.FS.readFile(p),write:(p,c)=>s.FS.writeFile(p,c),mkdirTree:p=>s.FS.mkdirTree(p)},docroot:l,router:a,env:{...r.env},log:p=>r.io.stderr(p),phpVersion:o});return{kind:"serving",server:{port:u.spec.port,handle:u.handle,close:async()=>{}},banner:`[${new Date().toUTCString()}] PHP ${o} Development Server (http://${t.server.host}:${t.server.port}) started (request-driven)
`}}let i=await n.cli(["php",...t.argv],{env:{...r.env}});return await Promise.all([At(i.stdout,o=>r.io.stdout(o)),je(i.stderr,o=>r.io.stderr(o))]),{kind:"exited",code:await i.exitCode}}var Wr=String.raw`<?php
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
`;var Hr=String.raw`<?php
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
`;var Gr=String.raw`<?php
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
`;var jr=String.raw`<?php
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
`;var Br=String.raw`<?php
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
`;var Vr=String.raw`<?php
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
`;var zr=String.raw`<?php
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
`;var Qr=String.raw`<?php
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
`;var Re="/bfwc",It="/internal/shared/auto_prepend_file.php",ks=`<?php
spl_autoload_register(static function (string $class): void {
    // Class names are case-insensitive: keys are lower-case, and so is the lookup (PDOPgsql finds pdopgsql).
    static $files = ['bfwc\\pgsql\\wire' => 'wire.php', 'bfwc\\pgsql\\exception' => 'wire.php', 'bfwc\\pgsql\\pdo' => 'pdo.php', 'bfwc\\pgsql\\statement' => 'statement.php', 'bfwc\\pgsql\\rewriter' => 'rewriter.php', 'pdo\\pgsql' => 'pdo-pgsql.php', 'bfwc\\pgsql\\pg' => 'pg.php', 'pgsql\\connection' => 'pg.php', 'pgsql\\result' => 'pg.php'];
    $file = $files[strtolower($class)] ?? null;
    if ($file !== null) {
        require_once '${Re}/pgsql/' . $file;
    }
});
require_once '${Re}/pgsql/includes.php';
if (!function_exists('pg_connect')) {
    require_once '${Re}/pgsql/functions.php';
}
\\Bfwc\\Pgsql\\Includes::register();
if (\\Bfwc\\Pgsql\\Includes::rewritesPrimary()) {
    require \\Bfwc\\Pgsql\\Includes::$primary;
    exit;
}
`,Es={"prepend.php":ks,"pgsql/wire.php":Qr,"pgsql/pdo.php":Gr,"pgsql/statement.php":zr,"pgsql/includes.php":Wr,"pgsql/rewriter.php":Vr,"pgsql/functions.php":jr,"pgsql/pg.php":Br,"pgsql/pdo-pgsql.php":Hr};function Kr(e){for(let[n,s]of Object.entries(Es)){let i=`${Re}/${n}`;e.mkdirTree(i.slice(0,i.lastIndexOf("/"))),e.writeFile(i,s)}let t=`
require_once '${Re}/prepend.php';
`,r=pe(e,It)?new TextDecoder().decode(e.readFile(It)):`<?php
`;r.includes(t)||e.writeFile(It,`${r.replace(/\?>\s*$/,"")}${t}`)}var Rs=e=>/^127\./.test(e)||e==="0.0.0.0"||e==="::1"||e==="localhost",Ts=/^bfwc-tcp:\/\/\[?([^\]]*)\]?:(\d+)$/;function Cs(e){return class{constructor(r){this.url=r;v(this,"CONNECTING",0);v(this,"OPEN",1);v(this,"CLOSING",2);v(this,"CLOSED",3);v(this,"readyState",0);v(this,"binaryType","arraybuffer");v(this,"onopen",null);v(this,"onmessage",null);v(this,"onclose",null);v(this,"onerror",null);v(this,"listeners",new Map);v(this,"channel");let n=Ts.exec(r),s=n?.[1]??"",i=Number(n?.[2]);if(!n||!Rs(s)){queueMicrotask(()=>this.fail());return}e(i).then(o=>{if(!o)return this.fail();if(this.readyState!==0)return o.close();this.channel=o,this.readyState=1,o.onData(l=>this.emit("message",l)),o.onClose(()=>this.ended()),this.emit("open")},()=>this.fail())}send(r){if(this.readyState!==1||!this.channel)return;let n=r instanceof ArrayBuffer?new Uint8Array(r):new Uint8Array(r.buffer,r.byteOffset,r.byteLength);this.channel.send(n.slice())}setSocketOpt(){}close(){this.readyState===2||this.readyState===3||(this.channel?.close(),this.ended())}on(r,n){return this.add(r,n,!1,!1)}once(r,n){return this.add(r,n,!0,!1)}addEventListener(r,n){this.add(r,n,!1,!0)}removeListener(r,n){return this.listeners.set(r,(this.listeners.get(r)??[]).filter(s=>s.listener!==n)),this}off(r,n){return this.removeListener(r,n)}removeEventListener(r,n){this.removeListener(r,n)}add(r,n,s,i){return this.listeners.set(r,[...this.listeners.get(r)??[],{listener:n,once:s,dom:i}]),this}emit(r,n){let s=this.listeners.get(r)??[];this.listeners.set(r,s.filter(a=>!a.once));let i=n?n.slice().buffer:void 0,o={type:r,target:this,data:i};for(let{listener:a,dom:u}of s)u?a(o):n?a(n,!0):a();let l={open:this.onopen,message:this.onmessage,close:this.onclose,error:this.onerror}[r];l?.(o)}ended(){this.readyState!==3&&(this.readyState=3,this.channel=void 0,queueMicrotask(()=>this.emit("close")))}fail(){this.readyState!==3&&(this.emit("error"),this.ended())}}}function Yr(e,t){let r=e.websocket??(e.websocket={});r.url=(s,i,o)=>`bfwc-tcp://${i.includes(":")?`[${i}]`:i}:${o}`,r.subprotocol="binary";let n=Cs(t);r.decorator=()=>n}var Os=(e,t)=>`[${new Date().toUTCString()}] Failed to listen on ${e}:${t} (reason: Address already in use)
`;function Zr(e){let t=e.dial?void 0:er(e.post),r=e.dial??(s=>t.dial(s)),n="localhost";return nr(e.post,s=>{async function i(l,a){let u=await e.loadPhp({baseUrl:l.php?.baseUrl,phpVersion:Te(l.php?.phpVersion)});Yr(u.module,r),Kr(u.module.FS),mt(a,u.module.FS);let p=pr(u.module.FS,c=>{s.exited||e.post({type:"fs",ops:c})});return s.mounted({apply:c=>p.quietly(()=>gt(u.module.FS,c)),flush:()=>p.flush()}),u.php.chdir(J(l.cwd)),u}async function o(l,a,u,p){let c=await i(l,u);return p.exited?{kind:"exited",code:0}:Fr(c,a,{cwd:J(l.cwd),env:l.env,io:p.io,composer:l.php?.composer,fetch:e.fetch,platformKnown:d=>e.post({type:"php-platform",phpVersion:d.phpVersion,extensions:[...d.extensions]})})}return{addressInUse:l=>Os(n,l),plan(l){let a=lr(l.command,l.args);if(!a.ok)return{ok:!1,message:`${l.command}: ${a.reason}
`,code:1};try{Te(l.php?.phpVersion)}catch(p){return{ok:!1,message:`${p.message}
`,code:1}}let u=cr(a.invocation,J);return u.kind==="serve"&&(n=u.server.host),{ok:!0,port:u.kind==="serve"?u.server.port:void 0,run:p=>o(l,u,p,s)}},receive:l=>!!t?.receive(l)}})}var Jr=globalThis,As=Zr({post:e=>Jr.postMessage(e),loadPhp:e=>Wt(e)});Jr.addEventListener("message",e=>As.receive(e.data));})();
