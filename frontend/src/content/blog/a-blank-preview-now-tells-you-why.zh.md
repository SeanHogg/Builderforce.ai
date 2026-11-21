# 空白的预览现在会告诉你原因，Laravel API 也能在标签页里启动了

你按下 Run。预览框一片空白。或者它显示出来了，却用了十二秒，而你不知道是网络、编译器、某个包 CDN，还是你自己的代码造成的。

在此之前，浏览器内的运行时几乎没给你任何线索。预览运行在严格的安全策略之下，所以一个从第三方服务器加载瓦片的地图，或从 CDN 加载的字体，都会被拦截，页面看起来就是坏的。一次缓慢的首次加载，看上去和一次卡住的快速加载没有区别。如果你的 API 用的是 Laravel，`php artisan serve` 在处理第一个请求之前就失败了。

BuilderForce WebContainers 2026.11.9 补上了这些缺口。**空白或缓慢的预览现在会附带原因，Laravel API 现在也能在标签页里启动。**

## 一次调用，看清时间花在哪里

`runtime.diagnostics()` 返回一份加载报告。它只包含运行时实际测量到的内容：

- **各阶段耗时**：运行时启动、Service Worker 就绪、编译器加载、预览首次绘制。
- **包 CDN 流量**：请求数、总耗时，以及失败了多少次。
- **按来源统计的请求**和**最慢的请求**，以来源和发起者标注。路径和 URL 不会被记录。
- 预览中**最近的安全策略违规**。
- 浏览器缓存是**冷的还是热的**。
- 一份**无法测量**的项目清单，这样缺失的数字不会被误认为零。

```bf-figure
{
  "kind": "flow",
  "title": "加载报告计时的四个阶段",
  "steps": [
    { "label": "运行时启动", "note": "从你启动运行时开始计时。其他每个阶段都以此为起点。", "hue": "make" },
    { "label": "Service Worker 就绪", "note": "负责提供预览文件的 Worker 已安装并开始响应。", "hue": "make" },
    { "label": "编译器加载", "note": "下载并启动 WebAssembly 版的 esbuild 编译器。冷缓存最先在这里显现。", "hue": "run" },
    { "label": "预览首次绘制", "note": "预览报告它的首次内容绘制。这是一个人真正看到东西的时刻。", "hue": "measure" }
  ],
  "caption": "每个阶段都带有开始时间和持续时间。浏览器无法观测的阶段会被列为不可用，而不是报告为零。"
}
```

所以当有人说预览很慢时，你能看出大部分时间是花在了下载编译器上、花在了包 CDN 上，还是缓存只是冷的。

## 看清安全策略到底拦截了什么

预览运行的是你没有写过的代码，所以运行时会给每个预览一份严格的内容安全策略（CSP）。这是正确的默认设置，同时也是预览显示空白或样式残缺的最常见原因。

`runtime.onCspViolation(listener)` 现在会告诉宿主页面哪个来源被拦截、在哪条指令下被拦截：例如 `img-src` 拦截了 `https://tile.openstreetmap.org`。被拦截的地址会被缩减为它的来源，因此路径和查询参数都不会离开预览。重复的违规只报告一次，总数也有上限，陷入循环的页面无法把你淹没。

```bf-figure
{
  "kind": "screen",
  "frame": "你的页面，嵌入了运行时",
  "ratio": 1.6,
  "regions": [
    { "label": "预览", "note": "一个没有瓦片的地图应用：策略拦截了瓦片服务器", "x": 4, "y": 8, "w": 58, "h": 84, "hue": "muted", "style": "ghost" },
    { "label": "已拦截：img-src", "note": "https://tile.openstreetmap.org", "x": 66, "y": 8, "w": 30, "h": 24, "hue": "bad" },
    { "label": "加载报告", "note": "各阶段、CDN 请求、最慢的来源、冷缓存或热缓存", "x": 66, "y": 36, "w": 30, "h": 34, "hue": "measure" },
    { "label": "修复", "note": "把该来源加入预览的允许列表", "x": 66, "y": 74, "w": 30, "h": 18, "hue": "good" }
  ],
  "caption": "空白的框不再是谜。违规信息会指明来源和指令，修复只需一行配置。"
}
```

要把一个现有应用迁移到这套策略下？`previewCspMode: 'report-only'` 会报告每一次违规而不拦截任何东西，让你先收集完整的清单。它会关闭防护，所以只适用于迁移期间，而且你的服务器必须有意允许它。Builderforce 从不开启它。

## 使用你自己的包 CDN，不再出现空白页

如果你从自己的镜像而不是 esm.sh 提供 npm 包，镜像现在会声明它的来源，运行时会自动把这些来源加入预览策略。一个兼容 esm.sh 的镜像只需一个选项：

```ts
const runtime = await startPreviewRuntime({
  relayUrl: 'https://preview.example.com/__bfwc/relay.html',
  cdn: createEsmShCdnFactory({ origin: 'https://esm.example.com' }),
});
```

过去，一个没有声明来源的自定义 CDN 会悄无声息地失败：每个包导入都被拦截，预览一直空白。现在运行时会记录一条指明问题的警告，只记录一次。

```bf-figure
{
  "kind": "compare",
  "title": "空白的预览，之前与之后",
  "columns": [
    { "title": "2026.11.9 之前", "hue": "muted", "items": ["一个白框，没有任何原因", "被拦截的来源只在你的服务器上可见，前提是你收集了报告", "缓慢的加载看起来和卡住的加载一样", "没有列出来源的自定义 CDN 会悄无声息地出错", "php artisan serve 在启动时失败"] },
    { "title": "使用 2026.11.9", "hue": "run", "items": ["被拦截的来源和指令，直接在宿主页面上", "一份加载报告：阶段、CDN、来源、缓存", "用 report-only 模式把应用迁移到策略之下", "自定义 CDN 的来源自动加入策略，否则你会收到一条警告", "Laravel API 可以用 php artisan serve 启动"] }
  ],
  "caption": "策略和以前一样严格。变化在于它现在会解释自己。"
}
```

## Laravel API 现在能在标签页里启动

`php artisan serve` 会把 PHP 内置的 Web 服务器作为一个独立进程启动。在浏览器中运行的 WebAssembly 版 PHP 无法以这种方式启动进程，所以 Laravel 自己的 serve 命令在 API 响应任何请求之前就失败了。现在运行时会直接提供服务，方式与 Laravel 相同，从应用的 `public/` 目录提供。

这意味着一个 Vite 前端、一个 Laravel API 和一个 Postgres 数据库可以在同一个标签页里端到端地启动：Composer 安装依赖包，迁移执行完毕，API 启动，前端通过同一个地址访问它。

```bf-figure
{
  "kind": "flow",
  "title": "一个 Vite、Laravel 和 Postgres 应用在同一个标签页中启动",
  "steps": [
    { "label": "Postgres", "note": "一个真正的 Postgres 数据库，存放在页面中。", "hue": "measure", "tag": "在标签页内" },
    { "label": "composer install", "note": "安装 API 的依赖包。在下一步开始之前，它的输出会以最后一行结束。", "hue": "make", "tag": "准备步骤" },
    { "label": "artisan migrate", "note": "在依赖包和数据库就绪后创建表结构。", "hue": "make", "tag": "准备步骤" },
    { "label": "artisan serve", "note": "Laravel API，在健康检查路由响应时就绪。", "hue": "run", "tag": "在标签页内" },
    { "label": "Vite 前端", "note": "你点击浏览的页面，在 /api 调用 API。", "hue": "run", "tag": "在标签页内" }
  ],
  "caption": "准备步骤也是服务：每一步都会在依赖它的服务启动之前完成，完成时它的完整日志就已经在那里了。"
}
```

准备步骤还多了一项修复。当 `composer install` 或 `npm install` 完成时，它的日志现在总会以最后一行结束，然后下一个服务才改变状态。如果某一步失败，你需要的错误信息就在日志里，而不是恰好在它上方被截断。

## 让托管更容易的小改进

- **.NET 运行时包可以从 npm 安装**，包名为 `@seanhogg/builderforce-webcontainers-dotnet`，版本与运行时相同。把它复制到你的静态文件中，再让运行时指向它即可。
- **一张列出运行时下载的所有资源的表格**。README 现在列出了运行时下载的每一个来源、由哪个页面或 Worker 获取、何时获取，以及如何自行托管。如果你的网站有严格的策略或没有网络，你能准确看出需要镜像哪些内容。

## 它在方法中的位置

Idea to Real 是一道弧线，**Idea → Make → Run → Measure**，其中有一个循环：[Read、Prove、Build](/blog/read-prove-build-the-inner-loop)。阅读和验证不花钱，所以决定是否构建是一个真正的决定。

一次验证只有在答案清楚时才有用。运行一次冒烟测试或概念验证，却得到一个空白页，你无法分辨是想法失败了，还是底层管道出了问题。一份加载报告和一个被点名的拦截来源能把两者分开：要么应用做到了你描述的事，要么你知道是哪一行配置挡住了它。

```bf-figure
{
  "kind": "stack",
  "title": "这道弧线，Run 和 Measure 会反馈结果",
  "bands": [
    { "label": "Idea", "note": "先阅读它，选择最便宜却值得运行的验证：冒烟测试、概念验证、试点。", "hue": "idea" },
    { "label": "Make", "note": "构建验证所要求的那一样东西，包括一个 Laravel API。", "hue": "make" },
    { "label": "Run", "note": "看它在标签页里启动。如果预览空白，被拦截的来源会被点名。", "hue": "run", "tag": "会解释自己" },
    { "label": "Measure", "note": "各阶段耗时和请求数，让一次缓慢的运行有数字可依。", "hue": "measure", "tag": "加载报告" }
  ],
  "caption": "一次失败的验证应当是关于想法的发现，而不是关于预览的。"
}
```

## 今天你可以做什么

- **找出预览为什么空白**：读取被拦截的来源和指令，然后允许该来源。
- **找出预览为什么缓慢**：一次调用即可为每个阶段计时，并统计 CDN 和各来源的流量。
- **把现有应用迁移到策略之下**：先用 report-only 模式，再切回强制执行。
- **从你自己的镜像提供包**，无需手动列出它的来源。
- **运行 Laravel API**，搭配 Vite 前端和 Postgres，在浏览器标签页里端到端运行。
- **在受限的网站上托管运行时**，附带它所下载的全部内容清单，以及来自 npm 的 .NET 包。

---

**相关阅读：** [BuilderForce WebContainers 开源了](/blog/builderforce-webcontainers-open-source) · [你的全栈应用现在就在你构建它的浏览器标签页里运行](/blog/your-full-stack-app-now-runs-in-your-browser-tab) · [Read、Prove、Build：内循环](/blog/read-prove-build-the-inner-loop)

[在 GitHub 上阅读运行时源码](https://github.com/SeanHogg/builderforce-webcontainers)，或者[打开一个画布](/create)，描述一个带 Laravel API 的应用，然后按下 Run。
