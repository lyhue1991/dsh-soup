# dsh-tree — DSH 项目资源管理器

一个可安装的 DSH（DeepSeek Harness）插件：在会话右侧以**并列网格列**的形式提供项目文件树，与左侧工作区同款配色、同宽（默认 280px，可拖拽 264–420px）。文件「预览」在会话区新增**「预览」标签页**（原生 `conversation.view`，与 对话/轨迹 同级），采用**只读预览**：Markdown / HTML / JSON / CSV·TSV 专属渲染、图片预览、其余纯文本（不提供编辑保存）。并附带**模型吞吐徽标**（输入框正上方实时显示「正在等待模型...」与彩色 `t/s` 速率）与**GoalBar 多行展示**（把原生单行截断 GoalBar 放开为多行完整显示）。**三平台通用**（macOS / Linux / Windows）。

## 功能

### 文件标签页
- **入口**：资源管理器中右键「👁 预览」或双击文件，会话头部自动出现「预览」tab（原生 `conversation.view` 槽位，`ui-trajectory` 同款注册方式，不改 DSH 源码）。
- **多文件**：单个「文件」tab 内部子 tab 条管理多个已开文件；切走再切回内容不丢；子 tab 可单独关闭。
- **只读预览**：不提供编辑与保存（宿主也无 `write` 动作），所见即磁盘内容，⟳ 重载刷新。
- **Markdown 预览**：复用 DSH 客户端自带的不可信渲染器 `MarkdownText`（micromark 管线，禁不安全协议/相对链接；旧版宿主缺该模块时自动回退纯文本）。
- **HTML 预览**：可交互沙箱 iframe（`allow-scripts/popups/forms/modals`，**不给 `allow-same-origin`**——页面脚本跑在 opaque origin，触不到 GUI 的 DOM/存储/Cookie）+ `srcdoc` 注入 + `no-referrer`。
- **JSON 预览**：解析后 pretty-print + 轻量语法着色（键/字符串/数字/布尔/null）；解析失败回退纯文本并提示。
- **CSV / TSV 预览**：RFC 4180 引号感知解析（内嵌逗号/换行/`""` 转义）、首行作表头（sticky）、最多预览 500 行 × 64 列并提示截断。
- **代码语法高亮**：常见语言（js/ts/jsx/tsx、python、go、rust、java、c/cpp、c#、ruby、php、kotlin、swift、shell、yaml/toml/ini、css/scss/less、sql、xml、lua 等）复用 DSH 的 `CodeBlock`（Shiki JS 引擎，主题跟随 `--shiki-*` token），扩展名映射对齐 DSH 读卡片；语法包懒加载——首帧可能纯文本，加载完成后自动补上高亮；超 40 万字符的大文件与未知扩展名回退纯文本。
- **PDF 预览**：整文件 base64（≤20MB）交给浏览器原生 PDF 查看器渲染——JupyterLab pdf-extension 同思路（base64 → Blob → object 嵌入，含缩放/搜索工具栏）；超限提示用系统打开。
- **Notebook 预览（.ipynb）**：GitHub 风格静态渲染——markdown 单元走 `MarkdownText`、代码单元走 `CodeBlock` 高亮、gutter 显示执行序号；输出按 MIME 择优：image/png·jpeg·gif·svg 内联、text/html 沙箱 iframe（禁脚本）、stream/error 分别以输出块与红块 traceback 展示（剥离 ANSI）；兼容 nbformat 4 与 v3（worksheets）。读取上限放宽至 20MB（含图输出的 base64 膨胀）。
- **会话隔离**：预览列表跟随当前会话工作目录；切换到其他项目的会话时，范围外的预览 tab 自动关闭。
- **FIFO 上限**：同时最多 5 个预览 tab，打开第 6 个时自动关闭最早的一个（先进先出）。
- **图片预览**：png/jpg/gif/webp/svg 等按 base64 内联展示（上限 8 MB）。
- **二进制**：NUL 嗅探判定后只读提示；文本超过 2 MB 截断展示并提示。

### 资源管理器
- **右侧详情列（details）文件树**：与会话区真正并列（三列网格 `侧栏 | 会话 | 资源管理器`），不悬浮、不遮挡。
- **宽度与左侧工作区完全一致**：默认 280px，拖左边缘在 264–420px 间调整（shell 自带 details 列被硬限制在 300–520px，本插件直接改写网格轨实现同宽）。
- **切换按钮**：有 Session log 时保持在「Session log」胶囊右侧；空白新会话则在输入框上方右端显示 📁，与 workspace / preset 控件同一水平线。
- **文件类型图标**：采用 JupyterLab `ui-components` 的 filetype SVG 集（BSD-3-Clause）——notebook 橙、markdown 紫、json 黄、pdf 红、表格绿等固定品牌色，16px 渲染；未命中扩展名按「已知代码语言 → 文本编辑器图标，其余 → 空白文件」兜底。
- **跟随会话**：默认展示当前会话工作目录（`session.header.cwd`），切换会话/工作区自动跟随；路径栏只读展示，不可跳转。
- **文件操作**（右键菜单）：预览、用系统打开、重命名、移到废纸篓、复制完整路径、⬇ 下载到本机（≤64MB，菜单末项）；空白处右键可刷新。
- **多选**：⌘/Ctrl 加选、Shift 连选；多选时批量移到废纸篓、批量拖拽移动。
- **拖拽**：文件/文件夹拖到目录移动；系统文件拖入上传。
- **交互**：单击选中、双击文件夹展开/收起、双击文件系统打开、⌘ 打开文件、F2/回车/Delete/Escape 等键位习惯（行内重命名选中扩展名前半段）。

### 模型吞吐徽标
- 输入框**正上方居中**显示，运行中（`llm/stream` 流期间）出现、结束后自动消失。
- **等待阶段**：`正在等待模型...` 灰色文字，省略号 `.`→`..`→`...` 原地循环（文字不滚动）。
- **流式阶段**：token 计数（向下箭头）+ 彩色 `xx.x t/s` 徽标（≥50 青 / ≥30 绿 / ≥15 黄 / 其余红）。
- **数据源**：Host 包 `llm/stream` waterfall 实时统计真实 chunk/token（优先 usage 的 `outputTokens`，退化 CJK 字符估算），比浏览器端估算更准。

### GoalBar 多行展示
- 在 DSH 原生 GoalBar 基础上**仅调整展示**：把单行截断（`text-overflow: ellipsis`）放开为**多行完整显示**（`white-space: pre-wrap`），编辑控件从 `input` 改为 `textarea`。不改 DSH 源码，用 `conversation.input.dock` 槽位同 id + 更低 priority 遮蔽默认实现。
- **数据与工具**：完全复用原生 goal projection 与原生 `create_goal` / `get_goal` / `update_goal` 工具，不替换、不遮蔽。
- **操作按钮**：暂停 / 恢复 / 编辑 / 清除（与原生 GoalBar 一致）。
- **轮次**：显示原生 goal projection 的 `roundsStarted/maxGoalRounds`。
- **编辑**：点击 ✏️ 进入 textarea 编辑，`Ctrl/⌘ + Enter` 保存、`Esc` 取消。

## 安装

> 需要 DSH Desktop（或支持 `dsh plugin add` 的 DSH 安装）。插件作为 profile bundle 安装。

```sh
# 安装最新版（npm 包名 @lyhue1991/dsh-tree）
dsh plugin add @lyhue1991/dsh-tree
```

或通过 DSH Desktop「设置 → 插件 → 插件市场」搜索安装。

安装后重启 DSH，在 Session log 右侧或空白会话输入框上方右端点击 📁 即可打开资源管理器；向任意会话发送消息即可看到吞吐徽标。

## 更新日志

### 0.1.13（当前）

- **预览标签页**：资源管理器右键「👁 预览」/双击文件，在会话区新增「预览」tab（原生 `conversation.view` 槽位，与 对话/轨迹 同级）：
  - 宿主半区新增 `read`（文本截断读取 / 图片 base64 / NUL 二进制嗅探）动作，走 `node:fs/promises`。
  - 单 tab 内子 tab 条管理多文件；只读预览（md/html/json/csv 渲染 + 纯文本兜底）、⟳ 重载；图片内联预览。
  - 右键菜单第一项为「👁 预览」（标签页展示），原「🖥 用系统打开」保留为第二项。

### 0.1.12

- **吞吐徽标状态修复**：
  - 流式输出开始后立即显示 token 计数，不再因速率暖机窗口（0.5s）而停留在「正在等待模型...」（此前短输出全程显示等待）。
  - 速率改为**滑动窗口瞬时值**（近 2s 采样），不再是从首 chunk 起的累计平均——中途停顿不会把 t/s 慢慢摊到个位数。
  - 新增**停顿检测**：流中超过 2s 无新 chunk 时回到「正在等待模型...」。

### 0.1.11

- **新会话入口**：有 Session log 时保留原会话头部入口；空白新会话在输入框上方、workspace / preset 控件行右端显示备用入口，不占用输入框内部空间。

### 0.1.10

- **简化 Goal**：移除自定义 `create_goal` / `get_goal` / `update_goal` 工具覆盖与 token 预算桥（`goal-view` / `goal-action`），改回使用 DSH 原生 goal 工具与 goal projection。
- **GoalBar 多行展示**：把原生单行截断 GoalBar 放开为多行完整显示（`white-space: pre-wrap`），编辑控件从 `input` 改为 `textarea`，其余（按钮、动作、主题）与原生一致。

### 0.1.8

### 0.1.7

- **速度徽标稳定化**：徽标贴附 Deep diving 状态行（DOM 注入 + MutationObserver），使用 `-webkit-text-fill-color` + `important` 修复 `background-clip: text` 渐变对子元素颜色的影响；已挂载快路径避免重复扫描；徽标始终跟随 Deep diving 的 15s 计时。

### 0.1.5

- **跨平台**：`move` / `create` / `upload` 改用 `node:fs/promises`（macOS / Linux / Windows 通用，消除 shell 命令依赖与注入面）；`open` / `trash` 按平台分支选命令（见下方「平台」表）。
- **模型吞吐徽标**：输入框正上方显示「正在等待模型...」（省略号 1→2→3 循环）与彩色 `t/s` 徽标，数据来自 `llm/stream` 真实流。

### 0.1.3

- 修复 details 插槽注册优先级，确保文件树面板正确显示在右侧详情列。
- 修复浏览器半区的布局实例引用，供文件树面板的布局操作正常使用。

## 开发

```sh
git clone https://github.com/lyhue1991/dsh-tree.git
cd dsh-tree
# 纯 JS 产物，无需构建：
#   lib/index.js  —— 宿主半区（webServer 路由 /api/dsh-tree，含 llm/stream 统计）
#   lib/client.js —— 浏览器半区（__ModuleLoader__ 工厂，内联 CSS）
```

`cordis.patch.yml` 在组合中插入一行 `ui-dsh-tree`，`dsh.bundle.patch` 指向它；`dsh.client.inject` 声明浏览器半区依赖的客户端包。

## 实现说明

- **宿主↔浏览器桥梁**：永久插件（profile bundle）不经过 dynamic runner，没有 `harness.handle`/`host.call`；宿主用 `webServer.register({ kind: 'exact', path: '/api/dsh-tree', handler })` 注册同源 HTTP 路由，浏览器用 `fetch` POST JSON 调用（`{ action, args }` 分派）。
- **动作**：`root` / `sessionCwd` / `list` / `open` / `trash` / `move` / `create` / `upload` / `download` / `speed-status`（返回 `{ phase, tokens, tps, ttft }`）。
- **跨平台**：`move` / `create` / `upload` 直接用 `node:fs/promises`（`rename`/`mkdir`/`writeFile`），mac/Linux/Windows 通用、无 shell 注入面；仅 `open` / `trash` 这类「唤起系统」的动作按 `process.platform` 分支选命令（见下表）。
- **吞吐统计**：`ctx.on('llm/stream', ...)` 包装 waterfall，按会话（`sessionId`/`agent.id`/`meta` 探测）维护 `{ phase: waiting|streaming|done, tokens, tps, ttft }`；首 chunk 到达标记 streaming（TTFT），结束后 4s 清除；`speed-status` 查询时按流开始累计秒数算平均 t/s（0.5s 暖机）。等待态文字用主题 token `--dsw-alias-label-caption`（与 shell 计时同款灰）。
- **宽度接管**：MutationObserver 监听 shell 框架的 `grid-template-columns`，把 details 轨改写为插件宽度（264–420px），并在 shell 重渲染后保持；`[data-side="details"]` 隐藏 shell 自带手柄，改用面板左缘自定义拖拽手柄。
- **主题**：全部使用 DSH 主题 token（`--dsw-specific-sidebar-fill`、`--dsw-alias-*` 等），跟随桌面明暗配色。

## 安全模型

- **请求门**：`/api/dsh-tree` 仅接受 POST；带 `Origin` 时必须与 `Host` 同源（挡跨站 CSRF 与 DNS rebinding），且强制 `x-dsh-tree: 1` 自定义头 + `content-type: application/json`——自定义头迫使浏览器先走 CORS preflight，而本路由永不返回 CORS 头，恶意网页无法用 `text/plain` 简单请求盲打写操作。非浏览器本地工具（无 Origin）不受影响。
- **路径围栏**：除 `list` 走沙箱 `fs.resolve` 外，所有具名文件操作（`read`/`move`/`trash`/`open`/`create`/`upload`）先经 `confine()`：realpath 解析后必须落在「workspace 根 ∪ 所有已知会话 cwd」子树内，越界返回 403。realpath 解析可防符号链接逃逸，且容忍目标末级尚不存在（新建/上传/移动目的地）。已知残留：confine 与实际操作之间存在理论上的 TOCTOU 窗口（符号链接竞态），Node 可移植 API 无法根除。
- **文件名校验**：`create` 与 `upload` 的 `name` 一律拒绝 `.`、`..`、路径分隔符与 NUL，杜绝 `../` 穿越。

## 平台

| 平台 | 系统打开 (`open`) | 移到废纸篓 (`trash`) | 移动/新建/上传 |
| --- | --- | --- | --- |
| macOS | `/usr/bin/open` | Finder `osascript` | `node:fs` |
| Linux | `xdg-open` | `gio trash`（回退 `trash-cli`） | `node:fs` |
| Windows | `cmd /c start` | PowerShell `Shell.Application`（回收站） | `node:fs` |

> 文件核心（浏览/移动/新建/上传）三平台完全一致；仅「系统打开」与「移到废纸篓」依赖各平台自带工具，这是 VS Code / Electron 等所有应用的标准做法。

## 许可证

[MIT](LICENSE)
