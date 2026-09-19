## 仓库是什么

**dsh-soup**（npm: `@lyhue1991/dsh-soup`）是 DeepSeek Harness（DSH / dsh-desktop）的一个永久界面插件，给官方 UI 加四样"调料"，不重写、不遮蔽 DSH 数据层：

- 🧅 **右侧文件树**（资源管理器）：与左侧工作区并列的右列文件浏览器，多选、右键菜单、拖拽移动、分块上传、自动刷新（目录签名探测）、沙箱围栏。
- 🫚 **会话内文件预览**：会话区「文件」标签页，按扩展名分派渲染器（md 富文本 / html 沙箱 iframe / json / csv / pdf / notebook / 图片 / CodeMirror 代码高亮与编辑、⌘S 保存 + 5s 自动保存）。会话内文件产物链接点击也接入此预览（官方 file 地址解析在 `lib/client/file-address.js`）。
- 🧂 **速率徽标**：输入框上方实时 t/s 徽标，数据来自宿主 `llm/stream` 事件（近 2s 滑动窗口）。
- 🧄 **多行 GoalBar**：复用原生 goal projection 与动作，仅放开为多行 + textarea 编辑（priority -1 遮蔽默认实现）。

## 代码结构

插件分**宿主半区**（Node，走 `webServer` 同源 HTTP RPC）与**浏览器半区**（打包 bundle），入口在 `lib/index.js` 的 `apply()`。

```
lib/
├── index.js            宿主入口：注册 /api/dsh-soup 路由，组装各供给器，客户端代码字符串注入
├── client.entry.js     浏览器 bundle 打包入口（esbuild iife）
├── client.main.js      客户端装配层（~550 行）：共享 store、宿主环境探测、各工厂组装接线、apply 槽位注册
├── client.js           构建产物（勿手编，npm run build 生成）
├── codemirror-modules.js  CodeMirror 可选依赖注入
├── client/             浏览器半区模块（createXxx 工厂模式）
│   ├── explorer-data.js   文件树数据层：加载/自动刷新/选择/拖拽/上传下载/重命名
│   ├── explorer-view.js   文件树 UI：Row/Menu/Panel/HeaderAction/宽度合同（300–520px）
│   ├── files-store.js     files tab 状态机：FIFO(≤5)/编辑草稿/自动保存/官方 file 地址桥接
│   ├── files-view.js      FilesView 子标签条 + 空会话兜底 PreviewOverlay
│   ├── preview-renderers.js  按扩展名分派的渲染器 + CodeMirror 编辑器 + FileToolbar
│   ├── html-preview.js    HTML 沙箱 iframe 预览（相对资源经宿主 RPC 安全读取）
│   ├── file-address.js    官方 file: 地址解析（纯函数）
│   ├── file-icons.js      文件类型 SVG 图标
│   ├── speed-badge.js     t/s 速率徽标（MutationObserver 定位 Deep diving 行）
│   ├── goal-bar.js        多行 GoalBar
│   ├── i18n.js            双语词典；组件内 t()、组件外 T()
│   ├── styles.js          插件 CSS + 工具栏 SVG
│   └── rpc.js             宿主 origin 解析 + fetch RPC
└── host/               宿主半区模块
    ├── paths.js           createPathGuard：工作区/会话目录边界围栏（越界拒绝）
    ├── file-view.js       读/写/重命名/删除 + 文本截断常量
    ├── resources.js       图片与 HTML 同目录资源的 HTTP 路由
    ├── speed.js           llm/stream 吞吐跟踪器
    └── system.js          跨平台系统打开 / 废纸篓
```

### 关键架构约定

- **状态注入**：客户端共享 store（state/listeners/setState/subscribe）在 main 创建；跨模块一律经 `getState()`/`getActiveSessionId()`/`getLayout()` 访问器注入，避免初始化顺序耦合。模块尾部挂 `window.__DSH_SOUP_XXX__` 供 e2e 验证。
- **T/t 延迟绑定**：传给工厂的 T 是包装函数 `function (key, params) { return T(key, params) }`，保证 apply 生命周期内 locale 重绑定生效。
- **永久插件桥接**：profile bundle 不经动态 runner，浏览器半区经同源 `fetch` 调宿主 `webServer` 路由，不用 `harness.handle`/`host.call`。
- **安全边界**：宿主所有文件操作必须过 `createPathGuard`；markdown 走不可信安全渲染管线，html 进沙箱 iframe。

## 测试与编译

```bash
npm run build   # esbuild 打包 lib/client.entry.js → lib/client.js（iife, es2020）
npm test        # build + node --test 两套件
```

- `test/client-goal.spec.mjs`：客户端源码**静态断言** + 可编程 React stub 渲染测试。注意：断言直接匹配 `client.main.js` 与 `lib/client/*.js` 源码字符串字面量，重构搬移代码时必须同步维护这些断言（如 `getState()`/`getLayout()` 写法）。
- `test/host.spec.mjs`：宿主 RPC 冒烟测试，用真实 `node:fs` 临时目录验证列目录/move/create/upload/路径围栏/速率跟踪，模拟 ctx 与 webServer 注册捕获。

Node ≥ 22（`engines` 要求，`node --test` 原生 runner）。


## 发版

`npm publish` 前 `prepublishOnly` 自动 build。流程：bump `package.json` version → commit（`chore(release): x.y.z`）→ push → `npm publish`。发版必须用户明确要求；registry 传播延迟约 2 分钟。

## 协作注意

- commit 用英文 conventional 风格（`refactor(client)` / `fix(host)` / `chore(release)`）。
- 根目录未跟踪的 `thinking-effort-loaded.json` 永不提交。
- 功能变更保持用户侧体验不变时，需 `npm test` + 桌面端 e2e 双重验证后再 commit。
