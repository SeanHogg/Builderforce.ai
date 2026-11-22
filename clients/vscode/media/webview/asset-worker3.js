"use strict";(()=>{var bt=Object.defineProperty;var xt=(e,t,r)=>t in e?bt(e,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):e[t]=r;var _=(e,t,r)=>xt(e,typeof t!="symbol"?t+"":t,r);var Pt="314.0.7",St=`https://cdn.jsdelivr.net/pyodide/v${Pt}/full/`,N,Et=e=>e.endsWith("/")?e:`${e}/`;async function Tt(e){let t=globalThis;if(typeof t.importScripts=="function")try{if(t.importScripts(`${e}pyodide.js`),t.loadPyodide)return t.loadPyodide}catch{}return(await import(`${e}pyodide.mjs`)).loadPyodide}async function _e(e={}){let t=Et(e.indexURL??St);if(N?.indexURL!==t){let n=Tt(t);N={indexURL:t,load:n},n.catch(()=>{N?.load===n&&(N=void 0)})}let r=()=>{};return(await N.load)({indexURL:t,env:e.env,stdout:r,stderr:r})}var Rt=/^(?:[^/]|$)|\/\/|\/\.\.?(?:\/|$)|[\s\S]\/$|\\/;function k(e){if(!Rt.test(e))return e;let t=[];for(let r of e.replace(/\\/g,"/").split("/"))!r||r==="."||(r===".."?t.pop():t.push(r));return"/"+t.join("/")}function T(e){let t=k(e),r=t.lastIndexOf("/");return r<=0?"/":t.slice(0,r)}function b(...e){return k(e.join("/"))}function R(e,t){return t.startsWith("/")?k(t):b(e,t)}var It=new TextDecoder,M=class{constructor(){_(this,"files",new Map);_(this,"versions",new Map);_(this,"mtimes",new Map);_(this,"children",new Map([["/",new Set]]));_(this,"explicit",new Set);_(this,"listeners",new Map);_(this,"queued",[]);_(this,"dispatching",!1);_(this,"clock",0);_(this,"content",t=>{let r=this.files.get(t);if(typeof r!="function")return r;let n=r();return this.files.set(t,n),n})}writeFile(t,r){let n=k(t);if(n==="/"||this.children.has(n))throw new Error(`EISDIR: illegal operation on a directory, open '${n}'`);let o=!this.files.has(n);o&&this.link(n),this.files.set(n,r),this.versions.set(n,++this.clock),this.mtimes.set(n,Date.now()),this.emit({type:"write",path:n,created:o})}readFile(t){return this.content(k(t))}readText(t){let r=this.readFile(t);if(r!==void 0)return typeof r=="string"?r:It.decode(r)}isFile(t){return this.files.has(k(t))}isDirectory(t){return this.children.has(k(t))}exists(t){return this.isFile(t)||this.isDirectory(t)}mkdir(t){let r=k(t);if(this.files.has(r))throw new Error(`EEXIST: file already exists, mkdir '${r}'`);if(r==="/")return;let n=this.children.has(r),o=n&&!this.explicit.has(r);if(this.explicit.add(r),n){o&&this.emit({type:"mkdir",path:r,promoted:!0},!0);return}this.ensureDir(r),this.emit({type:"mkdir",path:r})}seed(t,r=[]){for(let o of r){let s=k(o);if(s!=="/"){if(this.files.has(s))throw new Error(`EEXIST: file already exists, mkdir '${s}'`);this.explicit.add(s),this.ensureDir(s)}}let n=Date.now();for(let[o,s]of t){let i=k(o);if(i==="/"||this.children.has(i))throw new Error(`EISDIR: illegal operation on a directory, open '${i}'`);this.files.has(i)||this.link(i),this.files.set(i,s),this.versions.set(i,++this.clock),this.mtimes.set(i,n)}}readdir(t){return[...this.children.get(k(t))??[]].sort()}entries(t){let r=k(t);return this.readdir(r).map(n=>({name:n,kind:this.children.has(b(r,n))?"directory":"file"}))}rename(t,r){let n=k(t),o=k(r);if(n===o)return;if(!this.exists(n))throw new Error(`ENOENT: no such file or directory, rename '${n}' -> '${o}'`);if(this.exists(o))throw new Error(`EEXIST: file already exists, rename '${n}' -> '${o}'`);if(o.startsWith(n+"/"))throw new Error(`EINVAL: cannot move '${n}' into itself`);if(this.files.has(n)){let a=this.content(n);this.removeFile(n),this.writeFile(o,a);return}let s=n+"/",i=[...this.files.keys()].filter(a=>a.startsWith(s)).map(a=>[a,this.content(a)]),d=[...this.explicit].filter(a=>a===n||a.startsWith(s));this.rm(n),this.mkdir(o);for(let a of d)this.mkdir(o+a.slice(n.length));for(let[a,p]of i)this.writeFile(o+a.slice(n.length),p)}list(){return[...this.files.keys()].sort()}explicitDirectories(){return[...this.explicit].sort()}rm(t){let r=k(t);if(this.files.has(r)){this.removeFile(r);return}if(!this.children.has(r))return;for(let o of[...this.children.get(r)??[]])this.rm(r==="/"?"/"+o:`${r}/${o}`);if(r==="/")return;let n=this.explicit.delete(r);this.children.has(r)&&this.unlinkDir(r),n&&this.emit({type:"remove",path:r})}version(t){return this.versions.get(k(t))}mtime(t){return this.mtimes.get(k(t))}writeTree(t,r="/"){for(let[n,o]of Object.entries(t)){let s=b(r,n);typeof o=="string"||o instanceof Uint8Array?this.writeFile(s,o):(this.mkdir(s),this.writeTree(o,s))}}toFlat(){let t={};for(let r of this.files.keys())t[r.slice(1)]=this.content(r);return t}watch(t,r={}){let n=r.under===void 0?void 0:k(r.under),o=n===void 0||n==="/"?t:s=>(s.path===n||s.path.startsWith(n+"/"))&&t(s);return this.listeners.set(o,!!r.promotions),()=>this.listeners.delete(o)}removeFile(t){this.files.delete(t),this.versions.delete(t),this.mtimes.delete(t),this.unlink(t),this.emit({type:"remove",path:t})}link(t){let r=T(t);this.ensureDir(r),this.children.get(r).add(t.slice(t.lastIndexOf("/")+1))}ensureDir(t){if(!this.children.has(t)){if(this.files.has(t))throw new Error(`ENOTDIR: not a directory, '${t}'`);this.children.set(t,new Set),this.link(t)}}unlink(t){let r=T(t),n=this.children.get(r);n&&(n.delete(t.slice(t.lastIndexOf("/")+1)),n.size===0&&r!=="/"&&!this.explicit.has(r)&&this.unlinkDir(r))}unlinkDir(t){this.children.delete(t),this.unlink(t)}emit(t,r=!1){if(this.queued.push([t,r]),!this.dispatching){this.dispatching=!0;try{for(let n=this.queued.shift();n;n=this.queued.shift()){let[o,s]=n;for(let[i,d]of this.listeners)(d||!s)&&i(o)}}finally{this.dispatching=!1,this.queued.length=0}}}};function D(e,t){for(let r of t)r.op==="write"?e.writeFile(r.path,r.content):r.op==="mkdir"?e.mkdir(r.path):e.rm(r.path)}var Lr=new TextEncoder,Ot=new TextDecoder("utf-8",{ignoreBOM:!0});function ke(e){let t="";for(let r=0;r<e.length;r+=8192)t+=String.fromCharCode.apply(null,e.subarray(r,r+8192));return t}function ve(e){let t=new Uint32Array(e,0,8);if(t[0]!==1263552066||t[1]!==1)throw new Error("Not a file-system pack (or a pack from another runtime version).");let r=t[2]+t[3]*2**32,n=t[4],o=t[5],s=t[6],i=t[7],d=n+o,a=new Uint32Array(e,8*4,d),p=(8+d)*4,l=new Uint32Array(e,p,n*3),m=ke(new Uint16Array(e,p+n*12,s)),u=new Array(d),f=0;for(let c=0;c<d;c++){let h=f+a[c];u[c]=m.slice(f,h),f=h}let g=new Array(n);for(let c=0;c<n;c++){let h=l[c*3],y=i+l[c*3+1],w=l[c*3+2];g[c]=[u[c],()=>At(e,h,y,w)]}return{seq:r,files:g,dirs:u.slice(n)}}function At(e,t,r,n){return t===1?new Uint8Array(e.slice(r,r+n)):t===2?ke(new Uint16Array(e.slice(r,r+n))):Ot.decode(new Uint8Array(e,r,n))}var Br=1024*1024;function $(e,t){let{files:r,dirs:n}=ve(t.pack);e.seed(r,n),D(e,t.ops)}function j(e,t=1048576){let r,n=!1,o=[],s=()=>{let a=o;o=[];for(let p of a)p()},i=()=>!n&&(r.desiredSize??0)>0;return{stream:new ReadableStream({start:a=>void(r=a),pull:s,cancel:a=>{n||(n=!0,s(),e?.(a))}},new ByteLengthQueuingStrategy({highWaterMark:t})),push(a){return!n&&a.byteLength&&r.enqueue(a),i()},ready(){return n||i()?Promise.resolve():new Promise(a=>o.push(a))},end(){n||(n=!0,r.close(),s())},fail(a){n||(n=!0,r.error(a),s())},get done(){return n}}}function we(e){return new ReadableStream({start(t){e.byteLength&&t.enqueue(e),t.close()}})}function Q(e,t){return{status:e,headers:{"content-type":"text/plain; charset=utf-8"},body:we(new TextEncoder().encode(t))}}function ee(e){return{status:e.status,statusText:e.statusText,headers:e.headers}}function te(e,t){let r=e.getReader(),n=!1;return(async()=>{try{for(;;){let{value:o,done:s}=await r.read();if(s||n)break;t.chunk(o)}n||t.end()}catch(o){n||t.end(o instanceof Error?o.message:String(o))}})(),()=>{n||(n=!0,r.cancel().catch(()=>{}))}}var H=class{constructor(){_(this,"peer");_(this,"closed",!1);_(this,"manual",!1);_(this,"data",new Set);_(this,"closes",new Set);_(this,"credits",new Set)}send(t){if(this.closed)return;let r=new Uint8Array(t);queueMicrotask(()=>{let n=this.peer;if(!n.closed){for(let o of n.data)o(r);n.manual||n.consumed(r.byteLength)}})}manualFlowControl(){this.manual=!0}close(){this.closed||(this.closed=!0,queueMicrotask(()=>{if(!this.peer.closed){this.peer.closed=!0;for(let t of this.peer.closes)t()}}))}consumed(t){this.closed||t<=0||queueMicrotask(()=>{for(let r of this.peer.credits)r(t)})}onData(t){return this.data.add(t),()=>this.data.delete(t)}onClose(t){return this.closes.add(t),()=>this.closes.delete(t)}onConsumed(t){return this.credits.add(t),()=>this.credits.delete(t)}};function F(){let e=new H,t=new H;return e.peer=t,t.peer=e,[e,t]}function Ct(e){e.onData(()=>e.close())}function re(e){let[t,r]=F();return(e??Ct)(r),t}var ne={SIGHUP:129,SIGINT:130,SIGKILL:137,SIGPIPE:141,SIGTERM:143},Nt=ne.SIGPIPE;function oe(e){return ne[e]??1}var Mt=new TextEncoder;function be(e,t,r,n){let o=!1,s,i=()=>{o||(o=!0,n?.())};return r.then(d=>{if(o)return void d?.body.cancel().catch(()=>{});if(!d)return e({type:"response-head",reqId:t,head:null}),i();e({type:"response-head",reqId:t,head:ee(d)}),s=te(d.body,{chunk:a=>e({type:"response-chunk",reqId:t,data:a}),end:a=>{e(a?{type:"response-end",reqId:t,error:a}:{type:"response-end",reqId:t}),i()}})},d=>{o||(e({type:"response-head",reqId:t,head:{status:500,headers:{"content-type":"text/plain"}}}),e({type:"response-chunk",reqId:t,data:Mt.encode(String(d instanceof Error?d.stack:d))}),e({type:"response-end",reqId:t}),i())}),()=>{s?.(),i()}}var Dt=e=>Q(502,`Nothing is listening on port ${e}.`);function xe(e){let t=new Set,r=new Map;return{taken:t,receive(n){switch(n.type){case"ports":for(let o of n.open)t.add(o);for(let o of n.closed)e.handlerFor(o)||t.delete(o);return!0;case"http-request":{let{reqId:o}=n,s=e.handlerFor(n.port),i=s?s(n.request):Promise.resolve(Dt(n.port));return r.set(o,be(e.post,o,i,()=>r.delete(o))),!0}case"request-cancel":return r.get(n.reqId)?.(),!0;case"listen-failed":return e.onListenFailed(n.port,n.message,n.id),!0;case"listened":return e.onListened?.(n.port,n.id),!0;default:return!1}},cancelAll(){for(let n of[...r.values()])n();r.clear()}}}function Pe(e,t){let r=new M,n,o,s,i,d=!1,a=c=>{if(!d){n?.flush(),d=!0,s!==void 0&&e({type:"unlisten",port:s});for(let h of i?.listening??[])e({type:"unlisten",port:h});i?.closeAll(),e({type:"exit",code:c})}},p={post:e,io:{stdout:c=>!d&&e({type:"stdout",data:c}),stderr:c=>!d&&e({type:"stderr",data:c})},get exited(){return d},exit:a,mounted(c){r=void 0,n=c},get takenPorts(){return m.taken}},l=async(c,h=oe(c))=>{let y=o;o=void 0,m.cancelAll();try{i?.stop()}catch{}try{await y?.close()}finally{a(h)}},m=xe({post:e,handlerFor:c=>o&&c===s?o.handle:i?.handlerFor(c),onListenFailed(c){if(c===s)s=void 0;else if(!i?.listening.has(c))return;p.io.stderr(u.addressInUse(c)),l("SIGTERM",1)}}),u=t(p),f=c=>{r?D(r,c):n?.apply(c)};async function g(c){let{snapshot:h}=c;h.pack?$(r,h):f(h.ops);for(let O of c.ports)m.taken.add(O);let y=u.plan(c,r);if(!y.ok)return p.io.stderr(y.message),a(y.code);if(y.port!==void 0&&m.taken.has(y.port))return p.io.stderr(u.addressInUse(y.port)),a(1);let w=await y.run(r);if(w.kind==="exited")return a(w.code);if(w.kind==="running")return i=w.ports,a(await w.done);let{port:P}=w.server;if(d||m.taken.has(P))return await w.server.close(),d||p.io.stderr(u.addressInUse(P)),a(1);o=w.server,s=P,m.taken.add(P),e({type:"listen",port:P}),p.io.stderr(w.banner)}return{receive(c){if(!(m.receive(c)||u.receive?.(c)))switch(c.type){case"prime":return $(r,c.snapshot),e({type:"primed"});case"start":g(c).catch(h=>{p.io.stderr(`${h instanceof Error?h.stack??h.message:String(h)}
`),a(1)});return;case"fs":return f(c.ops);case"kill":return void l(c.signal);case"stdin":return u.stdin?.(c.data);case"socket-open":case"socket-accept":return e({type:"socket-close",connId:c.connId});default:return}}}}var Se=String.raw`
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
`;var Ee=String.raw`
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
`;var Te=String.raw`
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
`;var Re=String.raw`
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
`;var L="/bfwc-artifacts";var Ie=String.raw`
import os

ARTIFACT_DIR = ${JSON.stringify(L)}


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
`;var Oe=String.raw`
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
`,Ae=String.raw`
class UvicornWorker:
    """Named by gunicorn's -k option; the runtime reads it from the command line and serves ASGI."""
`,Ce=String.raw`
"""The browser runtime serves WSGI apps itself; gunicorn is importable but never runs."""
__version__ = "0.0.0+bfwc"
version_info = (0, 0, 0)
`;var se="/opt/bfwc",Ft={"bfwc/__init__.py":"","bfwc/run.py":Se,"bfwc/serve.py":Ee,"bfwc/threads.py":Re,"bfwc/training.py":Ie,"bfwc/vsocket.py":Te,"uvicorn/__init__.py":Oe,"uvicorn/workers.py":Ae,"gunicorn/__init__.py":Ce};function Ne(e){for(let[t,r]of Object.entries(Ft)){let n=`${se}/${t}`;e.FS.mkdirTree(n.slice(0,n.lastIndexOf("/"))),e.FS.writeFile(n,r)}e.runPython(`import sys
if ${JSON.stringify(se)} not in sys.path: sys.path.insert(0, ${JSON.stringify(se)})`)}var G=new Set(["uvicorn","hypercorn","gunicorn","waitress-serve","flask","fastapi"]),Lt={uvicorn:["--host","--port","--app-dir","--root-path","--log-level","--workers","--env-file","--uds","--fd","--lifespan","--loop","--http","--ws","--interface","--log-config","--reload-dir","--reload-include","--reload-exclude","--reload-delay","--limit-concurrency","--limit-max-requests","--backlog","--timeout-keep-alive","--ssl-keyfile","--ssl-certfile","--forwarded-allow-ips","--header","--h11-max-incomplete-event-size","--ws-max-size","--ws-ping-interval","--ws-ping-timeout"],hypercorn:["-b","--bind","-w","--workers","-k","--worker-class","-c","--config","--root-path","--log-level","--access-logfile","--error-logfile","--keep-alive","--graceful-timeout","-m","--umask","-u","--user","-g","--group"],gunicorn:["-b","--bind","-w","--workers","-k","--worker-class","-c","--config","--chdir","-t","--timeout","--log-level","--threads","--access-logfile","--error-logfile","-e","--env","-n","--name","--pythonpath","-p","--pid","--max-requests","--graceful-timeout","--keep-alive","-u","--user","-g","--group"],"waitress-serve":["--host","--port","--listen","--threads","--url-scheme","--url-prefix","--ident","--call"],flask:["--app","-A","--host","-h","--port","-p","--cert","--key","--extra-files","--exclude-patterns","-e","--env-file"],fastapi:["--host","--port","--app","--root-path","--entrypoint","--workers","--proxy-headers","--forwarded-allow-ips"]},Ut={uvicorn:8e3,hypercorn:8e3,gunicorn:8e3,"waitress-serve":8080,flask:5e3,fastapi:8e3};function x(e,t){for(let r=0;r<e.length;r++){let n=e[r];for(let o of t){if(n===o)return e[r+1];if(n.startsWith(`${o}=`))return n.slice(o.length+1)}}}function qt(e,t){let r=[];for(let n=0;n<e.length;n++){let o=e[n];t.includes(o)?n++:o.startsWith("-")||r.push(o)}return r}var B=e=>e.find(t=>t.includes(":"))??e[e.length-1],ie=e=>e===void 0?void 0:e.split(":").pop();function Wt(e,t,r){let n=e??t.PORT;if(n===void 0)return r;let o=Number(n);return Number.isInteger(o)&&o>0&&o<65536?o:`Invalid port "${n}".`}function $t(e){let t=e.replace(/\\/g,"/").replace(/^\.\//,""),r=t.lastIndexOf("/"),n=t.slice(r+1).replace(/\.py$/,"");return r<0?{module:n}:{module:n,dir:t.slice(0,r)||"/"}}function ae(e,t,r){let n=Lt[e];if(!n)return{ok:!1,reason:`"${e}" is not a supported Python app server.`};let o=u=>({ok:!1,reason:`${e}: ${u}`}),s=qt(t,n),i,d="asgi",a,p;switch(e){case"uvicorn":{let u=x(t,["--interface"])??"auto";if(u==="asgi2")return o("ASGI 2 (double-callable) apps are not supported; use an ASGI 3 app.");d=u==="wsgi"?"wsgi":"asgi",i=B(s),a=x(t,["--port"]),p=x(t,["--app-dir"]);break}case"hypercorn":i=B(s),a=ie(x(t,["-b","--bind"]));break;case"gunicorn":d=/uvicorn|asgi/i.test(x(t,["-k","--worker-class"])??"")?"asgi":"wsgi",i=B(s),a=ie(x(t,["-b","--bind"])),p=x(t,["--chdir"]);break;case"waitress-serve":d="wsgi",i=B(s),a=x(t,["--port"])??ie(x(t,["--listen"]));break;case"flask":if(d="wsgi",!s.includes("run"))return o('only "flask run" is supported by the Python runtime.');i=x(t,["--app","-A"])??r.FLASK_APP??"app",a=x(t,["--port","-p"]);break;case"fastapi":{let[u,f]=s;if(u!=="run"&&u!=="dev")return o('only "fastapi run" and "fastapi dev" are supported by the Python runtime.');let g=x(t,["--entrypoint"]);if(g)i=g;else{let c=$t(f??"main.py"),h=x(t,["--app"]);i=h?`${c.module}:${h}`:c.module,p=c.dir}a=x(t,["--port"]);break}}if(!i)return o("no application given (expected module:app).");let l=Wt(a,r,Ut[e]);if(typeof l=="string")return o(l);let m=t.includes("--factory")||i.endsWith("()");return{ok:!0,server:{interface:d,app:i.replace(/\(\)$/,""),port:l,...m?{factory:m}:{},...p?{appDir:p}:{}}}}var De=/^(python(3(\.\d+)?)?|py)(\.exe)?$/,Fe=/^pip(3(\.\d+)?)?(\.exe)?$/,jt=new Set(["-W","-X","-Q"]),Ht=new Set(["-c","--constraint","-t","--target","--prefix","--root","--src","-f","--find-links","--platform","--python-version","--implementation","--abi","--upgrade-strategy","--progress-bar","--config-settings","-C","--global-option","--report","--no-binary","--only-binary","--hash","--trusted-host","--cert","--client-cert","--cache-dir","--log","--proxy","--retries","--timeout"]),Bt=e=>e.replace(/\\/g,"/").split("/").pop()??e,Gt=`^(?:${De.source.slice(1,-1)}|${Fe.source.slice(1,-1)}|${[...G].map(e=>e.replace(/[-.]/g,"\\$&")).join("|")})$`,Gn=new RegExp(Gt);var I=e=>({ok:!1,reason:e}),U=e=>({ok:!0,invocation:e});function Le(e,t,r={}){let n=Bt(e);return Fe.test(n)?qe(t):G.has(n)?Ue(ae(n,t,r)):De.test(n)?Vt(t,r):I(`"${e}" is not a Python command.`)}function Ue(e){return e.ok?U({kind:"serve",server:e.server}):I(e.reason)}function Vt(e,t){for(let r=0;r<e.length;r++){let n=e[r];if(n==="-c"){let o=e[r+1];return o===void 0?I("Argument expected for the -c option."):U({kind:"code",code:o,argv:["-c",...e.slice(r+2)]})}if(n==="-m"){let o=e[r+1];if(o===void 0)return I("Argument expected for the -m option.");let s=e.slice(r+2);return o==="pip"?qe(s):G.has(o)?Ue(ae(o,s,t)):U({kind:"module",module:o,argv:[o,...s]})}if(jt.has(n)){r++;continue}if(!(n.startsWith("-")&&n!=="-"))return U({kind:"script",path:n,argv:e.slice(r)})}return I("Interactive Python (no script, -c or -m) needs a terminal, which the Python runtime does not provide.")}var Me=e=>e==="."||e===".."||e.startsWith("./")||e.startsWith("../")||e.startsWith("/");function qe(e){if(e[0]!=="install")return I(`pip ${e[0]??""}`.trim()+" is not supported; the Python runtime only installs (pip install).");let t={packages:[],files:[],projects:[],indexUrls:[]},r=[];for(let n=1;n<e.length;n++){let o=e[n],[s,i]=o.startsWith("--")&&o.includes("=")?[o.slice(0,o.indexOf("=")),o.slice(o.indexOf("=")+1)]:[o,void 0],d=()=>i??e[++n];if(s==="-r"||s==="--requirement"){let a=d();a&&t.files.push(a)}else if(s==="-e"||s==="--editable"){let a=d();if(a&&Me(a))t.projects.push(a);else return I(`Editable installs of "${a??""}" are not supported; the Python runtime installs a local project's dependencies (pip install -e .).`)}else if(s==="-i"||s==="--index-url"){let a=d();a&&t.indexUrls.unshift(a)}else if(s==="--extra-index-url"){let a=d();a&&r.push(a)}else Ht.has(s)?i===void 0&&n++:o.startsWith("-")||(Me(o)?t.projects.push(o):t.packages.push(o))}return t.indexUrls.push(...r),!t.packages.length&&!t.files.length&&!t.projects.length?I("pip install needs a package, a project directory or -r <requirements file>."):U({kind:"install",...t})}function We(e,t){let r=n=>n.startsWith("/")?t(n):n;switch(e.kind){case"script":return{...e,path:r(e.path),argv:[r(e.path),...e.argv.slice(1)]};case"install":return{...e,files:e.files.map(r),projects:e.projects.map(r)};case"serve":return e.server.appDir?{...e,server:{...e.server,appDir:r(e.server.appDir)}}:e;default:return e}}var S="/project",$e=new Set(["node_modules",".git"]),je=50,K=e=>e.split("/").some(t=>$e.has(t)),A=e=>e==="/"?S:b(S,e);function V(e){let t=k(e);return t===S?"/":t.startsWith(`${S}/`)?t.slice(S.length):void 0}var Kt=new TextDecoder("utf-8",{fatal:!0,ignoreBOM:!0});function zt(e){try{return Kt.decode(e)}catch{return e.slice()}}var ce=(e,t)=>e.analyzePath(t).exists,le=(e,t)=>ce(e,t)&&e.isDir(e.stat(t).mode);var Yt=(e,t)=>t.startsWith("/")?t:b(e.cwd(),t),He=(e,t)=>e.readdir(t).filter(r=>r!=="."&&r!=="..");function de(e,t){if(ce(e,t)){if(!le(e,t))return e.unlink(t);for(let r of He(e,t))de(e,`${t}/${r}`);e.rmdir(t)}}function Be(e,t){t.mkdirTree(S);for(let r of e.explicitDirectories())K(r)||t.mkdirTree(A(r));for(let r of e.list()){if(K(r))continue;let n=A(r);t.mkdirTree(T(n)),t.writeFile(n,e.readFile(r)??"")}}function Ge(e,t){for(let r of t){if(K(r.path))continue;let n=A(r.path);r.op==="write"?(e.mkdirTree(T(n)),le(e,n)&&de(e,n),e.writeFile(n,r.content)):r.op==="mkdir"?e.mkdirTree(n):de(e,n)}}function Ve(e,t,r=()=>!1){let n=new Set,o=[],s=!1,i=0,d,a=(c,h)=>{let y=A(c);return h==="mkdir"||h==="remove"?[{op:h,path:c}]:ce(e,y)?le(e,y)?h==="write"?[]:[{op:"mkdir",path:c},...He(e,y).flatMap(w=>a(b(c,w),"tree"))]:[{op:"write",path:c,content:zt(e.readFile(y))}]:[]},p=()=>{if(s=!1,!o.length)return;let c=o;o=[];let h=c.flatMap(({op:y,path:w})=>a(w,y)).filter(y=>!r(y.path));h.length&&t(h)},l=(c,h)=>{let y=V(h);if(!(i||y===void 0||y==="/"||r(y)||K(y))){if(c==="write"){let w;for(let P of o)P.path===y&&(w=P);if(w?.op==="write")return}o.push({op:c,path:y}),s||(s=!0,queueMicrotask(p))}},m=()=>{for(let c of n)l("write",c)},u={openedForWrite(c){!i&&V(c)!==void 0&&n.add(c)},written(c){i||V(c)===void 0||(n.add(c),clearTimeout(d),d=setTimeout(m,je))},closed(c){n.delete(c)&&l("write",c)},madeDirectory:c=>l("mkdir",c),symlinked:c=>l("tree",c),deleted:c=>l("remove",c),moved(c,h){l("remove",c),l("tree",h)}},f=e.truncate.bind(e),g=e.ftruncate.bind(e);return e.truncate=(c,h)=>{f(c,h),typeof c=="string"&&l("write",Yt(e,c))},e.ftruncate=(c,h)=>{g(c,h);let y=e.getStream(c)?.path;y&&l("write",y)},{events:u,tracker:{quietly(c){i++;try{c()}finally{i--}},flush(){clearTimeout(d),m(),p()}}}}var q=A;function Ke(e,t){Be(e,t)}function ze(e,t){Ge(e,t)}var Jt=579,Xt=e=>e.includes("/__pycache__")||e.endsWith(".pyc");function Ye(e,t){let{tracker:r,events:n}=Ve(e,t,Xt),o={onOpenFile:(s,i)=>{i&Jt&&n.openedForWrite(s)},onWriteToFile:s=>n.written(s),onCloseFile:s=>n.closed(s),onMakeDirectory:s=>n.madeDirectory(s),onMakeSymlink:(s,i)=>n.symlinked(i),onDeletePath:s=>n.deleted(s),onMovePath:(s,i)=>n.moved(s,i)};return Object.assign(e.trackingDelegate,o),r}function pe(e,t){let r=e.split(/\r?\n/),n=r.findIndex(i=>i.trim()===`[${t}]`);if(n<0)return;let o=0,s=[];for(let i of r.slice(n+1)){if(o===0&&/^\s*\[/.test(i))break;o=Math.max(0,o+Zt(i)),s.push(i)}return s.join(`
`)}function Zt(e){let t=0;return Je(e,0,r=>(r==="["?t++:r==="]"&&t--,!0)),t}function Je(e,t,r,n){let o=t;for(;o<e.length;){let s=e[o];if(s==="#"){for(;o<e.length&&e[o]!==`
`;)o++;continue}if(s==='"'||s==="'"){let d=e.startsWith(s.repeat(3),o)?s.repeat(3):s,a=o+d.length,p="";for(;a<e.length&&!e.startsWith(d,a);)s==='"'&&e[a]==="\\"&&a+1<e.length?(p+=e[a+1],a+=2):p+=e[a++];n?.(p),o=a+d.length;continue}if(!r(s,o))return o;o++}return o}function Xe(e,t){let r=new RegExp(`^\\s*${t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\s*=\\s*\\[`,"m").exec(e);if(!r)return[];let n=[],o=1;return Je(e,r.index+r[0].length,s=>(s==="["?o++:s==="]"&&o--,o>0),s=>{o===1&&n.push(s)}),n}var E=e=>e.trim().toLowerCase().replace(/[-_.]+/g,"-"),v="has native code with no WebAssembly (Pyodide) build",C="use pg8000 (pure Python) to reach Postgres.",Qt={psycopg2:`${v}; ${C}`,"psycopg2-binary":`${v}; ${C}`,psycopg:`needs the native libpq client library; ${C}`,"psycopg-binary":`${v}; ${C}`,"psycopg-c":`${v}; ${C}`,asyncpg:`opens sockets through asyncio's native event loop, which the browser runtime cannot provide; ${C}`,mysqlclient:"needs the native MySQL client library; use PyMySQL (pure Python).",pycurl:`${v} (it links libcurl); use requests or httpx.`,psutil:`${v} (it reads the operating system's process table).`,greenlet:`${v} (it switches C stacks).`,gevent:`${v} (it needs greenlet and libev).`,uvloop:`${v}; the runtime drives asyncio itself.`,httptools:`${v}; the runtime parses HTTP itself.`,watchfiles:`${v}; the runtime reloads on file changes itself.`,grpcio:`${v}.`,"grpcio-tools":`${v}.`,pyzmq:`${v} (it links libzmq).`,pymssql:`${v} (it links FreeTDS).`,pyodbc:`${v} (it links an ODBC driver manager).`,uwsgi:`${v}; the runtime serves WSGI apps itself.`,"mod-wsgi":`${v}; the runtime serves WSGI apps itself.`,torch:`${v}; PyTorch training runs on the runtime's WebGPU torch module (PRD 31 phase 7) or in a container.`,torchvision:`${v}.`,torchaudio:`${v}.`,tensorflow:`${v}.`,"tensorflow-cpu":`${v}.`,jaxlib:`${v}.`},er=new Set(["uvicorn","gunicorn","hypercorn","waitress","daphne","granian","fastapi-cli"]);function Ze(e){let t=E(e),r=Qt[t];return r&&`"${t}" ${r}`}var Qe=e=>Ze(e)??`"${E(e)}" has no pure-Python or Pyodide wheel (a native-only package); it cannot be installed in the browser runtime.`,tr=/\s+--?[A-Za-z][\w-]*(?:[=\s][\s\S]*)?$/;function z(e){let t=e.replace(/(^|\s)#.*$/,"").replace(tr,"").trim();if(!t||t.startsWith("-"))return;if(/^[a-z+]+:\/\//i.test(t)||t.endsWith(".whl")){let n=t.split("/").pop().split("#")[0];return{name:E(n.split("-")[0]),spec:t}}let r=/^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(t);if(r)return{name:E(r[1]),spec:t}}function rr(e){let t=[],r=[];for(let n of e.replace(/\\\r?\n/g," ").split(/\r?\n/)){let o=/^\s*(?:-r|--requirement)[\s=]+(\S+)/.exec(n);o&&r.push(o[1]);let s=z(n);s&&t.push(s)}return{requirements:t,includes:r}}function nr(e){let t=pe(e,"project"),r=t===void 0?[]:Xe(t,"dependencies");if(r.length)return r.map(z).filter(s=>!!s);let n=pe(e,"tool.poetry.dependencies");if(n===void 0)return[];let o=[];for(let s of n.split(/\r?\n/)){let i=/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(s);i&&E(i[1])!=="python"&&o.push({name:E(i[1]),spec:i[1]})}return o}function Y(e,t,r=new Set){let n=k(t);if(r.has(n))return[];r.add(n);let o=e(n);if(o===void 0)throw new Error(`Could not open requirements file: ${t}`);let{requirements:s,includes:i}=rr(o);return[...s,...i.flatMap(d=>Y(e,R(T(n),d),r))]}function fe(e,t){let r=b(t,"requirements.txt");if(e(r)!==void 0)return Y(e,r);let n=e(b(t,"pyproject.toml"));return n===void 0?[]:nr(n)}function et(e,t=new Set){let r={install:[],provided:[],declined:[]},n=new Set;for(let o of e){if(n.has(o.name))continue;n.add(o.name);let s=Ze(o.name);t.has(o.name)||er.has(o.name)?r.provided.push(o.name):s?r.declined.push({name:o.name,reason:s}):r.install.push(o)}return r}var me=e=>import(e);var ue=(e,t)=>e===t||e.startsWith(t==="/"?"/":`${t}/`);function or(e,t,r){let n=k(t.root??`/opt/bfwc-extensions/${r}`);if(ue(n,S)||ue(S,n))throw new Error(`Python extension ${e.moduleUrl}: root ${n} overlaps the project (${S}); extensions are installed outside it.`);return n}function sr(e,t,r){let n=b(t,r);if(r.startsWith("/")||!ue(n,t)||n===t)throw new Error(`Python extension ${e.moduleUrl}: file "${r}" is outside its root ${t}.`);return n}async function tt(e,t,r=me){let n=new Set,o=new Set;for(let[s,i]of t.entries()){let a=(await r(i.moduleUrl))[i.exportName];if(typeof a!="function")throw new Error(`Python extension ${i.moduleUrl} has no function export "${i.exportName}".`);let p=await a()??{},l=Object.entries(p.files??{}),m=l.length?or(i,p,s):void 0,u=l.map(([f,g])=>[sr(i,m,f),g]);for(let[f,g]of Object.entries(p.jsModules??{}))e.registerJsModule(f,g);for(let[f,g]of u)e.FS.mkdirTree(f.slice(0,f.lastIndexOf("/"))||"/"),e.FS.writeFile(f,g);m&&e.runPython(`import sys
if ${JSON.stringify(m)} not in sys.path: sys.path.insert(0, ${JSON.stringify(m)})`);for(let f of p.provides??[])n.add(E(f));for(let f of p.imports??(p.provides??[]).map(g=>g.replace(/-/g,"_")))o.add(f)}return{packages:n,imports:o}}function ir(e){let t={};for(let[r,n]of e){let o=r.toLowerCase(),s=t[o];t[o]=s===void 0?n:Array.isArray(s)?[...s,n]:[s,n]}return t}var ar=e=>JSON.stringify(Object.entries(e.headers??{}));function rt(e){let t=e.handle,r=e.disconnect,n=e.close,o={interface:e.interface,app:String(e.label),port:Number(e.port)},s=1;return{spec:o,handle:d=>new Promise((a,p)=>{let l=s++,m,u=!1,f={head(g,c){m=j(()=>{u||r(l)}),a({status:g,headers:ir(JSON.parse(c)),body:m.stream})},chunk(g){if(!(!m||m.push(g.slice())))return m.ready()},end(g){u=!0,g?m?.fail(new Error(g)):m?.end()}};t(l,d.method,d.url,ar(d),d.body??void 0,f).then(()=>{m||p(new Error("The Python app finished without a response."))},g=>{m?m.fail(g):p(g)})}),async close(){try{await n()}finally{e.destroy?.()}}}}async function nt(e,t){let r=e.pyimport("bfwc.serve").start_server;return rt(await r(t.interface,t.app,t.port,!!t.factory,t.appDir))}async function ot(e){let t=e.pyimport("bfwc.serve").start_requested;return rt(await t())}function dr(e){let t=[];for(let r of e.matchAll(/(?:pure Python 3 wheel|pure Python wheel|wheel compatible with Pyodide)[^:'"]*:?\s*((?:['"][^'"]+['"](?:,\s*)?)+)/gi))for(let n of r[1].matchAll(/['"]([^'"]+)['"]/g))t.push(E(n[1].split(/[<>=!~;[ ]/)[0]));return[...new Set(t)]}var cr=e=>e instanceof Error?e.message:String(e);async function st(e,t,r){let n=e.toPy(r);try{await e.runPythonAsync(`import micropip
${t}`,{globals:n})}finally{n.destroy?.()}}async function J(e,t,r={}){let n=et(t,r.provided),o={installed:[],provided:n.provided,declined:[...n.declined]},s=n.install;if(!s.length)return o;let i=r.log??(()=>{});await e.loadPackage("micropip",{messageCallback:()=>{},errorCallback:i});let d=r.indexUrls?.length?[...r.indexUrls]:void 0;for(;;)try{return await st(e,"await micropip.install(specs, index_urls=index_urls)",{specs:s.map(a=>a.spec),index_urls:d}),o.installed.push(...s.map(a=>a.name)),o}catch(a){let p=dr(cr(a)).filter(u=>!o.declined.some(f=>f.name===u));if(!p.length)throw a;for(let u of p)o.declined.push({name:u,reason:Qe(u)});let l=new Set(s.filter(u=>p.includes(u.name)).map(u=>u.name)),m=p.filter(u=>!l.has(u));for(let u of m)await st(e,'micropip.add_mock_package(name, "0.0.0")',{name:u});if(s=s.filter(u=>!l.has(u.name)),!s.length)return o}}function it(e){let t=[];e.installed.length&&t.push(`Successfully installed ${e.installed.join(" ")}`),e.provided.length&&t.push(`Provided by the runtime (not installed): ${e.provided.join(" ")}`);for(let{reason:r}of e.declined)t.push(`Declined: ${r}`);return t}var lr=new TextDecoder;function ye(e,t){return r=>{let n=R(t,r);if(!(!e.FS.analyzePath(n).exists||e.FS.isDir(e.FS.stat(n).mode)))return lr.decode(e.FS.readFile(n))}}var dt=e=>e.map(z).filter(t=>!!t),ct=e=>[e.PIP_INDEX_URL,...(e.PIP_EXTRA_INDEX_URL??"").split(/\s+/)].filter(t=>!!t);async function he(e,t,r,n){let o=e.toPy({kind:t,target:r,argv:[...n]});try{let s=await e.runPythonAsync(`from bfwc.run import run_main
run_main(kind, target, argv)`,{globals:o});return s==="serve"?"serve":typeof s=="number"?s:0}finally{o.destroy?.()}}async function at(e,t,r){if(t)try{let n=e.pyimport("pyodide.code").find_imports,o=n(t),s=o.toJs?.()??[];o.destroy?.();let i=s.filter(d=>!r.provided.imports.has(d.split(".")[0]));if(!i.length)return;await e.loadPackagesFromImports(i.map(d=>`import ${d}`).join(`
`),{messageCallback:()=>{},errorCallback:d=>r.io.stderr(`${d}
`)})}catch(n){r.io.stderr(`${n instanceof Error?n.message:String(n)}
`)}}async function pr(e,t,r){let n=i=>r.io.stderr(`${i}
`),o=i=>i.declined.forEach(({reason:d})=>n(`Declined: ${d}`));for(let i of r.installs)try{o(await J(e,dt(i.specs),{indexUrls:i.indexUrls,log:n,provided:r.provided.packages}))}catch(d){n(`Warning: could not repeat this session's earlier pip install of ${i.specs.join(" ")}: ${d instanceof Error?d.message.trim().split(`
`).pop():String(d)}`)}let s=fe(ye(e,r.cwd),t);s.length&&o(await J(e,s,{indexUrls:ct(r.env),log:n,provided:r.provided.packages})),e.pyimport("bfwc.threads").install()}async function fr(e,t,r){let n=ye(e,r.cwd),o=t.projects.flatMap(p=>{let l=R(r.cwd,p),m=fe(n,l);return m.length||r.io.stderr(`${p}: no dependencies declared (pyproject.toml [project] dependencies or requirements.txt); its own code runs from the project directory as is.
`),m}),s=[...dt(t.packages),...t.files.flatMap(p=>Y(n,R(r.cwd,p))),...o],i=[...t.indexUrls,...ct(r.env)],d=await J(e,s,{indexUrls:i,log:p=>r.io.stderr(`${p}
`),provided:r.provided.packages});for(let p of it(d))(p.startsWith("Declined")?r.io.stderr:r.io.stdout)(`${p}
`);let a=s.filter(p=>d.installed.includes(p.name)).map(p=>p.spec);return a.length&&r.io.installed?.({specs:a,indexUrls:i}),d.declined.length?1:0}async function lt(e,t,r){let n=d=>({kind:"exited",code:d});if(t.kind==="install")return e.pyimport("bfwc.threads").install(),n(await fr(e,t,r));let o=t.kind==="serve"&&t.server.appDir?R(r.cwd,t.server.appDir):r.cwd;if(await pr(e,o,r),t.kind==="serve")return{kind:"serving",server:await nt(e,t.server)};let s=ye(e,r.cwd),i;return t.kind==="script"?(await at(e,s(t.path),r),i=await he(e,"script",t.path,t.argv)):t.kind==="code"?(await at(e,t.code,r),i=await he(e,"code",t.code,t.argv)):i=await he(e,"module",t.module,t.argv),i==="serve"?{kind:"serving",server:await ot(e)}:n(i)}var W=class{constructor(t,r){this.kind=t;this.post=r;_(this,"ends",new Map)}owns(t){return t.type===`${this.kind}-data`||t.type===`${this.kind}-ack`||t.type===`${this.kind}-close`}get size(){return this.ends.size}add(t,r){let{kind:n}=this;this.ends.set(t,r),r.manualFlowControl(),r.onData(o=>this.post({type:`${n}-data`,connId:t,data:o})),r.onConsumed(o=>this.post({type:`${n}-ack`,connId:t,bytes:o})),r.onClose(()=>{this.ends.delete(t)&&this.post({type:`${n}-close`,connId:t})})}receive(t){let r=this.ends.get(t.connId);t.type===`${this.kind}-data`?r?.send(t.data):t.type===`${this.kind}-ack`?r?.consumed(t.bytes):this.hangUp(t.connId)}hangUp(t){let r=this.ends.get(t);this.ends.delete(t),r?.close()}closeAll(t=!1){let r=[...this.ends.keys()];for(let n of r)this.hangUp(n),t&&this.post({type:`${this.kind}-close`,connId:n})}};var ur=new Set(["socket-data","socket-ack","socket-close","dial-result","dial-data","dial-ack","dial-close"]);function mr(e){return ur.has(e.type)}function pt(e){let t=hr(e);return{dial:r=>t.dial(r),receive(r){return!mr(r)||!r.type.startsWith("dial")?!1:(t.receive(r),!0)}}}function hr(e){let t=new W("socket",e),r=new W("dial",e),n=new Map,o=1;return{upgraded(s,i,d){if(!d)return e({type:"socket-close",connId:s});let[a,p]=F();t.add(s,a),d(i,p)},accepted(s,i){if(!i)return e({type:"socket-close",connId:s});t.add(s,re(i.accept))},dial(s){let i=o++;return e({type:"dial",connId:i,port:s}),new Promise(d=>{n.set(i,a=>{if(!a)return d(void 0);let[p,l]=F();r.add(i,p),d(l)})})},receive(s){if(s.type==="dial-result"){let i=n.get(s.connId);return n.delete(s.connId),i?.(s.ok)}if(t.owns(s))return t.receive(s);if(r.owns(s))return r.receive(s)}}}var X=class{constructor(t,r,n=65536){this.channel=t;this.highWaterMark=n;_(this,"queue",[]);_(this,"unacked",0);_(this,"ended",!1);t.manualFlowControl(),t.onData(o=>{this.queue.push(o),r()}),t.onConsumed(o=>{this.unacked=Math.max(0,this.unacked-o),this.unacked<=this.highWaterMark&&r()}),t.onClose(()=>{this.ended=!0,r()})}get writable(){return this.unacked<=this.highWaterMark}tryRecv(t){let r=this.queue.shift();if(!r)return this.ended?null:void 0;let n=r.byteLength>t?r.subarray(0,t):r;return n!==r&&this.queue.unshift(r.subarray(t)),this.channel.closed||this.channel.consumed(n.byteLength),n}send(t){this.channel.send(t),this.unacked+=t.byteLength}close(){this.ended=!0,this.queue.length=0,this.channel.close()}};var gr=new Set(["localhost","127.0.0.1","::1","0.0.0.0",""]),ft=e=>{let t=e.wakeReader;e.wakeReader=void 0,t?.();for(let r of e.wakeSenders.splice(0))r()};function _r(e,t=65536){let r=new Map,n=1,o=s=>{let i=r.get(s);if(!i)throw new Error(`Bad file descriptor: connection ${s} is closed.`);return i};return{async connect(s,i){if(!gr.has(s.toLowerCase()))throw new Error(`connect ECONNREFUSED ${s}:${i} (only localhost is reachable in the browser runtime)`);let d=await e(i);if(!d)throw new Error(`connect ECONNREFUSED ${s}:${i}`);let a=n++,p={wakeSenders:[]},l=Object.assign(p,{endpoint:new X(d,()=>ft(p),t)});return r.set(a,l),a},async send(s,i){let d=o(s),{endpoint:a}=d;if(a.ended)throw new Error("Broken pipe: the connection is closed.");for(a.send(i);!a.writable&&!a.ended;)await new Promise(p=>d.wakeSenders.push(p))},async recv(s,i){let d=o(s);for(;;){let a=d.endpoint.tryRecv(i);if(a!==void 0)return a;await new Promise(p=>d.wakeReader=p)}},close(s){let i=r.get(s);i&&(i.endpoint.close(),ft(i),r.delete(s))}}}function ut(e){let t=pt(e);return{transport:_r(r=>t.dial(r)),receive:r=>t.receive(r)}}var kr="_bfwc_tcp",Z="timeout",mt=e=>new Promise(t=>setTimeout(()=>t(Z),e));function vr(e){let t=new Map;return{async connect(r,n,o){let s=e.connect(r,n);if(o==null)return s;let i=await Promise.race([s,mt(o)]);if(i===Z)throw s.then(d=>e.close(d),()=>{}),new Error("timed out");return i},send:(r,n)=>Promise.resolve(e.send(r,n.slice())),async recv(r,n,o){let s=t.get(r)??e.recv(r,n);t.set(r,s);let i=o==null?await s:await Promise.race([s,mt(o)]);return i===Z?Z:(t.delete(r),i??void 0)},shutdown:r=>e.shutdown?.(r),close(r){t.delete(r),e.close(r)}}}function ht(e,t){e.registerJsModule(kr,vr(t)),e.runPython(`import bfwc.vsocket
bfwc.vsocket.install()`)}var yt=e=>typeof e=="object"&&e!==null?e.type:void 0;var gt=e=>yt(e)==="checkpoint"||yt(e)==="training-saved-ack";var wr="_bfwc_training",br=50,xr=12e4;function*_t(e,t,r=""){for(let n of e.readdir(t)){if(n==="."||n==="..")continue;let o=`${t}/${n}`,s=r?`${r}/${n}`:n,{mode:i}=e.lstat(o);e.isLink(i)||(e.isDir(i)?yield*_t(e,o,s):e.isFile(i)&&(yield[s,o]))}}var Pr=e=>e.analyzePath(L).exists?[..._t(e,L)]:[];function kt(e){let t=!1,r,n=0,o=0,s=new Map;async function i(d=!1){if(!r)return{ok:!1,error:"Not a training process.",confirmed:!1};let{py:a,options:p}=r,l=++n,m;try{if(m=Pr(a.FS),d&&m.length===0)return{ok:!0,confirmed:!1};for(let[f,g]of m){let c=a.FS.readFile(g);e({type:"training-artifact",saveId:l,path:f,bytes:c},[c.buffer])}}catch(f){return{ok:!1,error:`Could not read the artifacts: ${f instanceof Error?f.message:String(f)}`,confirmed:!1}}let u=p.acks?new Promise(f=>{s.set(l,f),setTimeout(()=>s.get(l)===f&&(s.delete(l),f({ok:!1,error:"The page did not acknowledge the save.",confirmed:!1})),xr)}):void 0;return e({type:"training-saved",saveId:l,files:m.length}),u??{ok:!0,confirmed:!1}}return{receive(d){return gt(d)?d.type==="checkpoint"?(t=!0,!0):(s.get(d.saveId)?.(d.superseded?{ok:!0,confirmed:!1,superseded:!0}:{ok:d.ok,error:d.error,confirmed:d.ok}),s.delete(d.saveId),!0):!1},install(d,a){r={py:d,options:a,cell:a.flag?new Int32Array(a.flag):void 0};let p=r.cell;d.registerJsModule(wr,{checkpoint_requested:()=>t||p!==void 0&&Atomics.load(p,0)!==0,should_yield:()=>{if(p||t)return!1;let l=Date.now();return l-o<br?!1:(o=l,!0)},tick:()=>new Promise(l=>setTimeout(l,0)),save:()=>i().then(l=>({error:l.ok?"":l.error??"The save failed.",confirmed:l.confirmed}))})},async saveAtExit(d){if(!r)return;let a=await i(!0);a.ok||d(`bfwc.training: the artifacts were not saved: ${a.error??"unknown error"}
`)}}}var Sr=e=>`[Errno 98] error while attempting to bind on address ('0.0.0.0', ${e}): address already in use
`,Er=e=>/fatal error/i.test(e instanceof Error?e.message:String(e));function vt(e){let t=[],r=new TextDecoder,n=e.tcp?void 0:ut(e.post),o=e.tcp??n.transport,s=kt((d,a)=>e.post(d,a)),i=d=>t.push(...d.split(/(?<=\n)/).filter(Boolean));return Pe(e.post,d=>{async function a(l,m){let u={...l.env,PYTHONDONTWRITEBYTECODE:"1",PYTHONUNBUFFERED:"1",PWD:q(l.cwd)},f=await e.loadPyodide({indexURL:l.python?.indexURL,env:u}),g=O=>({write:ge=>(d.io[O](ge.slice()),ge.length),isatty:!1});f.setStdout(g("stdout")),f.setStderr(g("stderr")),f.setStdin({stdin:()=>t.shift()??null,isatty:!1}),Ne(f),ht(f,o);let c=l.python?.training;c&&s.install(f,c);let h=await tt(f,l.python?.extensions??[],e.importModule??me);Ke(m,f.FS);let y=Ye(f.FS,O=>{d.exited||e.post({type:"fs",ops:O})});d.mounted({apply:O=>y.quietly(()=>ze(f.FS,O)),flush:()=>y.flush()});let w=f.pyimport("bfwc.run").bootstrap,P=f.toPy(u);try{w(P,q(l.cwd))}finally{P.destroy?.()}return{py:f,provided:h}}async function p(l,m,u){let{py:f,provided:g}=await a(l,u);if(d.exited)return{kind:"exited",code:0};let c=await lt(f,m,{cwd:q(l.cwd),env:l.env,io:{stdout:d.io.stdout,stderr:d.io.stderr,installed:y=>e.post({type:"python-installed",...y})},installs:l.python?.installs??[],provided:g});if(c.kind==="exited")return s.saveAtExit(d.io.stderr).then(()=>c);let h=c.server;return{kind:"serving",server:{port:h.spec.port,handle:Tr(h,d),close:()=>h.close()},banner:`Serving ${h.spec.interface.toUpperCase()} app ${h.spec.app} on http://localhost:${h.spec.port} (request-driven)
`}}return{addressInUse:Sr,plan(l){let m=Le(l.command,l.args,l.env);if(!m.ok)return{ok:!1,message:`${l.command}: ${m.reason}
`,code:2};let u=We(m.invocation,q);return{ok:!0,port:u.kind==="serve"?u.server.port:void 0,run:f=>p(l,u,f)}},stdin:l=>i(l===null?r.decode():typeof l=="string"?l:r.decode(l,{stream:!0})),receive:l=>s.receive(l)||!!n?.receive(l)}})}function Tr(e,t){return r=>e.handle(r).catch(n=>{throw Er(n)&&(t.io.stderr(`${n instanceof Error?n.message:String(n)}
`),t.exit(1)),n})}var wt=globalThis,Rr=vt({post:(e,t)=>wt.postMessage(e,t),loadPyodide:e=>_e(e)});wt.addEventListener("message",e=>Rr.receive(e.data));})();
