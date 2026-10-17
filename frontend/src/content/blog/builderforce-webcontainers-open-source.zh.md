你在 Builderforce 画布上构建的每个应用，都会先在你的浏览器里运行，然后才在别处运行。直到这个月之前，负责运行它的东西都不是我们自己的。

我们以前使用 StackBlitz WebContainers（`@webcontainer/api`）。这是一项令人印象深刻的技术，用它起步也是正确的选择。但它带来了四个约束，画布能做的事越多，这些约束就越难忍受：

- **专有许可证。** 免费版仅限非商业用途，并要求署名。位于商业产品之下的运行时需要商业协议，而每个想要自托管的客户也都继承了这个问题。
- **跨源隔离。** 它要求宿主页面带有 COOP 和 COEP 响应头。而这些响应头恰恰会破坏真实应用中嵌入的东西：登录弹窗、支付框架、视频播放器、分析脚本，以及任何没有返回正确响应头的第三方脚本。
- **会话上限。** 免费版每月 25,000 次 API 会话。一个每次有人查看应用就打开一次预览的画布，会很快用完这些会话。
- **无从下手。** 当预览在运行时内部出错时，我们只能报告问题然后等待。我们无法阅读代码、修复它或复刻它。

所以我们构建了自己的运行时，今天它以 MIT 许可开源：**BuilderForce WebContainers**，代码在 [GitHub](https://github.com/SeanHogg/builderforce-webcontainers)，npm 包为 [`@seanhogg/builderforce-webcontainers`](https://www.npmjs.com/package/@seanhogg/builderforce-webcontainers)。

## 现在你可以用它做什么

把项目以文件的形式交给它，它就会在 iframe 中提供实时预览，TypeScript、JSX、CSS、JSON 和 npm 包的工作方式与在 Vite 下完全相同。这一切都在用户的浏览器中运行。

- **预览前端应用。** 使用 React、Vue 或 Svelte 的 Vite 项目、Create React App 以及静态网站。修改会让该项目所有打开的预览重新加载，没有任何东西需要重启。
- **在页面中构建部署产物。** `runtime.build()` 就是不需要服务器的 `npm run build`。它返回一个打包、压缩、带内容哈希的静态网站，可以上传到任何地方。
- **在页面中做类型检查。** `createChecker()` 在 Web Worker 中按项目自己的 tsconfig 运行 TypeScript，并以纯数据形式返回诊断结果。
- **运行 Node 程序。** 从真实的 npm 仓库执行 `npm install`、运行 Node 脚本、在虚拟端口上运行 Express 风格的服务器，还有一个供终端使用的交互式 `bfsh` shell。每个进程都有自己的 Web Worker，所以死循环永远不会卡住页面，`kill()` 也总是有效。
- **隔离不可信代码。** 在中继模式下，预览和进程运行在独立的源上，AI 编写的代码和任意 npm 包永远不会共享你应用的 Cookie 或存储。
- **复刻它。** 编译器、包 CDN 和传输层都是可替换的端口。把 esbuild 换成 SWC，或把 esm.sh 换成你自己的镜像，都不需要修改核心。

```bf-figure
{
  "kind": "compare",
  "title": "两种运行时，并排对比",
  "columns": [
    { "title": "StackBlitz WebContainers", "hue": "muted", "items": ["专有许可证；免费版仅限非商业用途", "免费版每月 25,000 次 API 会话", "要求宿主页面设置 COOP 和 COEP", "编译器和包来源固定", "构建和类型检查需要在容器中运行 npm run build 和 tsc", "Node、npm 和 shell"] },
    { "title": "BuilderForce WebContainers", "hue": "make", "items": ["MIT：复刻、发布、出售都可以", "没有会话上限", "无需跨源隔离；嵌入内容照常工作", "编译器、包 CDN 和传输层都是可插拔端口", "在浏览器中使用 runtime.build() 和 createChecker()", "Node、npm 和 shell，每个进程一个 Web Worker"] }
  ],
  "caption": "我们的运行时只需要：一个供 Service Worker 使用的安全上下文（https 或 localhost）。仅此而已。"
}
```

## 工作原理

开发期间没有打包。运行时的工作方式与 Vite 开发服务器相同，只是由一个 Service Worker 代替了网络。

```bf-figure
{
  "kind": "flow",
  "title": "从文件到运行中的预览",
  "steps": [
    { "label": "挂载", "note": "项目存放在页面中的虚拟文件系统里。写入文件就是一次编辑，没有磁盘。", "hue": "idea" },
    { "label": "逐文件编译", "note": "当预览请求 src/App.tsx 时，只用 esbuild-wasm 编译这一个文件，并作为原生 ES 模块提供。", "hue": "make" },
    { "label": "解析依赖包", "note": "裸导入变成 esm.sh 地址，版本从 package.json 锁定并去重，所以只有一份 React。", "hue": "make" },
    { "label": "提供服务", "note": "Service Worker 通过询问页面来响应 iframe 的请求，所以预览像任何网站一样加载。", "hue": "run", "tag": "在标签页中" }
  ],
  "caption": "启动是即时的，一次修改只重新编译一个文件。浏览器会终止空闲的 Service Worker；发生这种情况时，Worker 会请求打开的页面重新连接，而不是让请求失败。"
}
```

Node 程序走的是另一条路径。`runtime.run('node', …)` 会启动一个 Web Worker，带上文件快照，以及 `fs`、`http`、`child_process` 等 Node 核心模块的垫片；写入会同步回其他所有进程。调用 `listen(3000)` 的服务器通过同一个 Service Worker 响应，`onServerListening` 会把它的 URL 交给宿主页面。每个进程都以 `RuntimeProcess` 返回：一个合并的输出流、`stdin`、用于获取退出码的 `wait()`、`kill()` 和 `resizeTerminal()`。

## 它在 Builderforce 上驱动着什么

```bf-figure
{
  "kind": "screen",
  "frame": "画布上的应用，运行在 BuilderForce WebContainers 之上",
  "ratio": 1.62,
  "regions": [
    { "label": "预览", "note": "由 preview.builderforce.ai 提供，与你的会话隔离", "x": 4, "y": 8, "w": 58, "h": 62, "hue": "make" },
    { "label": "终端", "note": "bfsh：npm、npx、node、管道", "x": 4, "y": 74, "w": 58, "h": 20, "hue": "run" },
    { "label": "检查", "note": "类型检查、构建、lint，失败结果发送给智能体", "x": 65, "y": 8, "w": 31, "h": 40, "hue": "prove" },
    { "label": "发布", "note": "runtime.build() 生成静态网站，发布到你的地址", "x": 65, "y": 52, "w": 31, "h": 42, "hue": "accent" }
  ],
  "caption": "四者背后是同一个运行时。这里没有任何东西要求浏览器开启跨源隔离，所以你预览的应用和你发布的应用表现一致。"
}
```

- **画布预览。** 应用视图和 Studio 都以中继模式通过它运行每个项目：预览位于 `preview.builderforce.ai` 这个独立的源上，智能体编写的代码永远接触不到你的 Builderforce Cookie 或存储。
- **发布。** 发布会在你的浏览器中根据项目文件构建网站，然后把静态产物上传到你的子域名。预览以及挂载在其中的任何东西都不受影响。
- **检查。** 检查会直接基于文件对项目做类型检查和构建，无需安装；如果项目定义了 `npm run lint`，还会在 Node 运行时上运行它。每个失败的步骤都会作为待修复事项交还给智能体。
- **错误。** 预览中未捕获的错误会发送给宿主页面，这样坏掉的应用会回到编写它的助手那里，而不是看起来像已经完成一样停在那里。

## 它暂时还做不到什么

我们宁愿自己说出来，也不愿让你自己发现：

- **原生插件和安装脚本。** `.node` 插件无法在浏览器中加载，`postinstall` 会被跳过。带有 WebAssembly 回退的包（esbuild-wasm、@swc/wasm）可以工作；只提供原生二进制的包（sharp、better-sqlite3）不行。
- **Next.js、Nuxt、SvelteKit、Remix 和 Astro 的开发服务器。** 它们目前需要原生二进制文件。运行时会识别这些项目并说明原因后拒绝运行，宿主因此可以回退到另一个运行时，而不是显示一个坏掉的预览。
- **WebSocket 和流式响应**（来自运行时内部的服务器）。目前响应会被完整缓冲后再返回。
- **`execSync` 和 `spawnSync`。** 让一个 Worker 阻塞等待另一个需要跨源隔离，而这个运行时拒绝提出这种要求。

这些都列在公开的[路线图](https://github.com/SeanHogg/builderforce-webcontainers/blob/main/ROADMAP.md)上，大致按值得解决的顺序排列。

## 快速上手

从包中把 Service Worker 提供在 `/__bfwc/sw.js`，然后启动、挂载、预览：

```ts
import { startPreviewRuntime } from '@seanhogg/builderforce-webcontainers';

const runtime = await startPreviewRuntime({ serviceWorkerUrl: '/__bfwc/sw.js', id: 'my-project' });
runtime.writeTree({
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': `import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<h1>Hello</h1>);`,
});

if (runtime.profile().supported) iframe.src = runtime.url;
runtime.onError((e) => console.warn('preview crashed:', e.message));

// Ship it: a static site with hashed assets, built in the page.
const { files } = await runtime.build({ base: './' });
```

如果你预览的代码是 AI 编写的，或者引入了任意的包，请从独立的源提供中继文件，并传入 `relayUrl` 而不是 `serviceWorkerUrl`。[README](https://github.com/SeanHogg/builderforce-webcontainers#readme) 介绍了中继模式、类型检查、Vue 和 Svelte，以及 Node 运行时。

每个预览都会显示一个小小的 “Built with Builderforce.ai” 徽标。它不是许可证条件，`attribution: false` 就可以关闭。如果这个运行时为你省了钱，保留它就是对这个项目的资助。

## 它在方法中的位置

在 Builderforce 上，工作遵循一条弧线：**Idea → Make → Run → Measure**，每一幕都经过同一个内循环：[Read、Prove、Build](/blog/read-prove-build-the-inner-loop)。

```bf-figure
{
  "kind": "flow",
  "title": "一个运行时，贯穿弧线的三幕",
  "steps": [
    { "label": "Make", "note": "标签页里的预览：一次修改只重新编译一个文件，所有打开的预览都会重新加载。", "hue": "make" },
    { "label": "检查", "note": "在任何东西发布之前做类型检查、构建和 lint，失败结果交还给智能体。", "hue": "prove" },
    { "label": "Run", "note": "发布在浏览器中完成构建，把静态网站放到你的地址上。", "hue": "run" },
    { "label": "Measure", "note": "预览错误会上报给页面，所以第一份证据比第一个用户来得更早。", "hue": "measure" }
  ],
  "caption": "启动运行时不花一分钱，这正是 Prove 保持低成本的原因：一个能运行的原型只是标签页里的几秒钟，而不是一个容器。"
}
```

运行时位于 **Make** 这一幕，它也改变了 **Prove** 的感受。过去用一个能运行的原型来验证想法，意味着要等待容器或部署。现在原型在标签页里启动，运行不花钱，也没有会话计量，所以尝试第二个想法和第一个一样便宜。

**Build** 多了一道关卡。检查运行的类型检查和构建与发布时完全相同，所以从 **Make** 到 **Run** 的这一步，是一个你能读懂的结果，而不是一个期望。

而且因为运行时采用 MIT 许可，这一切都不是你看不透的依赖。如果某个预览表现异常，运行它的代码就在 GitHub 上。

## 今天你就可以用它做的事

- **在画布上构建应用**，看着它在标签页里运行，无需配置响应头，也无需安装。
- **把运行时嵌入你自己的产品。** 一个包，一个 Service Worker，MIT 许可。
- **在标签页里运行 Node。** `runtime.run('npm', ['install'])`，然后 `node server.js`；`onServerListening` 会给出可嵌入 iframe 的 URL。
- **阅读路线图并提交 Pull Request。** 检查 Worker 中的 lint、热模块替换和样式预处理器是下一步。

---

**相关阅读：** [Builderforce 的开源项目](/blog/open-source-at-builderforce) · [你画布上的应用现在是一个真正的项目](/blog/your-canvas-app-is-a-real-project) · [浏览器内 IDE](/blog/in-browser-ide-and-collaboration)

[查看我们开源的全部项目](/open-source)，或[阅读这个运行时的介绍页](/open-source/builderforce-webcontainers)。
