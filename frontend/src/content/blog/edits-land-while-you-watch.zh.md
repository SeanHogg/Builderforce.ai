# 修改即刻生效——热更新、真正的样式表，以及你已经在用的框架

每次预览重新加载，你都会丢掉当前的位置。

你正在结账流程的第三个页面，表单填了一半，还开着一个弹窗，然后你改了一个颜色。页面重新加载，表单清空了，你只好一路点回去，看看颜色改得对不对。把这件事乘以一个下午里的每一次小修改，大部分时间都花在了回到原来的位置上。

第一个缺口背后还有第二个。很多真实项目根本到不了预览这一步。一个 `styles.scss`、一个 `Button.module.css`、一句 `import 'some-library/dist/styles.css'`，或者一个 Next.js 应用，预览要么直接失败，要么悄悄显示一个没有样式的页面。

这次发布把两个缺口都补上了。

## 修改原地生效

```bf-figure
{
  "kind": "compare",
  "title": "改一个颜色",
  "columns": [
    { "title": "以前", "hue": "muted", "items": ["整个页面重新加载", "你正在填写的表单又空了", "弹窗关闭，滚动位置跳回顶部", "你得一路点回去检查修改"] },
    { "title": "现在", "hue": "run", "items": ["只替换这一份样式表", "已经输入的内容原样保留", "弹窗仍然开着，滚动位置不动", "新的颜色直接出现"] }
  ],
  "caption": "样式表的修改原地替换。React 组件的修改会重新渲染该组件并保留它的状态。无法安全原地更新的修改，会像以前一样重新加载。"
}
```

- **样式表原地替换。** 修改一个 `.css`、`.scss` 或 `.less` 文件，正在运行的页面里只有这一份样式表被替换，什么都不会重新加载。
- **React 组件保留状态。** 编辑一个组件，它会用新代码重新渲染，并借助 React 自己的 Fast Refresh 保留状态。计数器的数字不变，表单的内容也还在。
- **安全的兜底。** 如果某次修改无法原地应用（比如改了应用的入口文件），页面会像以往一样重新加载，不会留下更新了一半的状态。

## 按真实项目的写法使用样式表

```bf-figure
{
  "kind": "flow",
  "title": "从你的源码到页面",
  "steps": [
    { "label": "styles.scss", "note": "变量、嵌套、@use 和局部文件，或带 mixin 的 Less", "hue": "make" },
    { "label": "在浏览器中编译", "note": "导入依次从你的项目、node_modules、包 CDN 解析", "hue": "run", "tag": "新" },
    { "label": "Button.module.css", "note": "类名按文件隔离，支持 composes 和 :global", "hue": "run", "tag": "新" },
    { "label": "预览与发布的网站", "note": "两边是同一份 CSS", "hue": "measure" }
  ],
  "caption": "预览和发布构建使用同样的编译器，所以你构建时看到的，就是最终上线的。"
}
```

- **Sass、SCSS 和 Less 可以编译。** 包括 `.scss`、`.sass` 和 `.less` 文件，以及 Vue 和 Svelte 组件里的 `<style lang="scss">`。局部文件、`@use`、`@import` 以及来自 npm 包的导入都能解析。
- **CSS Modules 是真的。** `import styles from './Button.module.css'` 会给每个类一个隔离后的名字，所以一个组件里的 `.title` 永远不会和另一个组件里的 `.title` 冲突。`composes`、`:global` 和关键帧都按你预期的方式工作。
- **包自带的样式表会加载。** `import 'react-toastify/dist/ReactToastify.css'`、组件库的主题或字体包的 CSS，现在都会在预览和发布的网站中加载，而不是被跳过。

## 在浏览器里运行 Next.js

Next.js 项目现在可以在浏览器标签页里运行它自己的开发服务器 `next dev`，就像 Express 或 Vite 应用早已可以做到的那样。你打开的页面由 Next 自己从你的 `app/` 目录渲染，中间没有我们的任何东西。SvelteKit 项目也以同样的方式运行：`vite dev` 启动真正的 Vite，由 SvelteKit 在它自己的服务器上渲染页面。

为了做到这一点，底层运行时补上了 Next 这类框架默默依赖的那部分 Node。进程之间现在可以互发消息（`child_process.fork` 和 `worker_threads`），动态导入会加载项目自己的文件，而在原生编译器无法运行的地方，Next 会加载它的 WebAssembly 编译器。这些改动大多也让其他工具受益。

## 它在方法中的位置

构建是 [Read, Prove, Build](/blog/read-prove-build-the-inner-loop) 的第三幕。这一幕的体验取决于一件事：从*改点什么*到*看到它的效果*，这段路有多短。

热更新把重新加载从这段路上拿掉了，保留当前位置又省掉了一路点回去。真正的样式表和真正的框架补上了另一面：你在预览里验证的项目，就是你将要上线的项目，而不是一个只是看起来像它的简化副本。

## 今天就能做的事

- **改样式不丢位置：**打开一个弹窗，编辑它的 CSS，看着它变化。
- **样式表原样带来：**SCSS 局部文件、Less、CSS Modules，以及你所用包自带的 CSS。
- **在流程中途编辑 React 组件**，保留你正在测试的状态。
- **在画布上打开一个 Next.js 或 SvelteKit 项目**并运行它。

---

**相关阅读：**[你的应用现在会回应你了](/blog/your-app-talks-back) · [运行你的看板刚刚构建的应用](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers 开源了](/blog/builderforce-webcontainers-open-source)

[打开一个画布](/create)，在它运行时改点什么。
