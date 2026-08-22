# dsh-tree — DSH 项目资源管理器

一个可安装的 DSH（DeepSeek Harness）插件：在会话右侧以**并列网格列**的形式提供项目文件树，与左侧工作区同款配色、同宽（默认 280px，可拖拽 264–420px）。并附带**模型吞吐徽标**（输入框正上方实时显示「正在等待模型...」与彩色 `t/s` 速率）与**目标卡片**（参考 pi-web 的 GoalPanel，把默认的一行 GoalBar 升级为卡片式展示）。**三平台通用**（macOS / Linux / Windows）。

## 功能

### 资源管理器
- **右侧详情列（details）文件树**：与会话区真正并列（三列网格 `侧栏 | 会话 | 资源管理器`），不悬浮、不遮挡。
- **宽度与左侧工作区完全一致**：默认 280px，拖左边缘在 264–420px 间调整（shell 自带 details 列被硬限制在 300–520px，本插件直接改写网格轨实现同宽）。
- **切换按钮**：会话头部右侧工具区（「Session log」胶囊右侧）一个 📁 图标，点击打开/再点折叠（打开时高亮）。
- **跟随会话**：默认展示当前会话工作目录（`session.header.cwd`），切换会话/工作区自动跟随；路径栏只读展示，不可跳转。
- **文件操作**（右键菜单）：用系统打开、重命名、移到废纸篓、新建文件、新建文件夹、复制路径；空白处右键可刷新。
- **多选**：⌘/Ctrl 加选、Shift 连选；多选时批量移到废纸篓、批量拖拽移动。
- **拖拽**：文件/文件夹拖到目录移动；系统文件拖入上传。
- **交互**：单击选中、双击文件夹展开/收起、双击文件系统打开、⌘ 打开文件、F2/回车/Delete/Escape 等键位习惯（行内重命名选中扩展名前半段）。

### 模型吞吐徽标
- 输入框**正上方居中**显示，运行中（`llm/stream` 流期间）出现、结束后自动消失。
- **等待阶段**：`正在等待模型...` 灰色文字，省略号 `.`→`..`→`...` 原地循环（文字不滚动）。
- **流式阶段**：token 计数（向下箭头）+ 彩色 `xx.x t/s` 徽标（≥50 青 / ≥30 绿 / ≥15 黄 / 其余红）。
- **数据源**：Host 包 `llm/stream` waterfall 实时统计真实 chunk/token（优先 usage 的 `outputTokens`，退化 CJK 字符估算），比浏览器端估算更准。

### 目标卡片（Goal 卡片）
- 参考 **pi-web 的 GoalPanel** 设计，把 DSH 默认的一行 GoalBar 升级为**卡片式两行展示**（不改 DSH 源码，用 `conversation.input.dock` 槽位同 id + 更低 priority 原生遮蔽默认实现）。
- **第一行**：状态圆点（进行中绿 / 已暂停琥珀 / 受阻橙红）+ 相位标签 + 右侧 meta（`用时 · 已开始/上限 轮次`）+ 操作按钮（暂停 / 恢复 / 编辑 / 清除）。
- **第二行**：完整 objective 多行展示（`pre-wrap` 换行，不再截断）。
- **编辑**：点击 ✏️ 进入 textarea 编辑，`Ctrl/⌘ + Enter` 保存、`Esc` 取消。
- **数据**：来自会话 `goal` 投影（`createdAt` 起算用时每秒刷新；轮次 = `roundsStarted/maxGoalRounds`）；变更动词（`pause` / `resume` / `edit` / `clear`）走 `remote.goals`，CAS ref 调用时现读。

## 安装

> 需要 DSH Desktop（或支持 `dsh plugin add` 的 DSH 安装）。插件作为 profile bundle 安装。

```sh
# 安装最新版（npm 包名 @lyhue1991/dsh-tree）
dsh plugin add @lyhue1991/dsh-tree
```

或通过 DSH Desktop「设置 → 插件 → 插件市场」搜索安装。

安装后重启 DSH，在任意会话头部（Session log 右侧）点击 📁 即可打开资源管理器；向任意会话发送消息即可看到吞吐徽标。

## 更新日志

### 0.1.8（当前）

- **目标卡片（Goal 卡片）**：参考 pi-web GoalPanel 设计，把默认的一行 GoalBar 升级为卡片式两行展示（状态圆点 + 相位标签 + `用时 · 轮次` meta + 完整多行 objective + 编辑/暂停/恢复/清除）。通过 `conversation.input.dock` 槽位同 id `goal` + 更低 priority（-1）**原生遮蔽**默认实现，不改 DSH 源码；变更动词走 `remote.goals`（CAS ref 调用时现读）。

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
- **动作**：`root` / `sessionCwd` / `list` / `open` / `trash` / `move` / `create` / `upload` / `speed-status`（返回 `{ phase, tokens, tps, ttft }`）。
- **跨平台**：`move` / `create` / `upload` 直接用 `node:fs/promises`（`rename`/`mkdir`/`writeFile`），mac/Linux/Windows 通用、无 shell 注入面；仅 `open` / `trash` 这类「唤起系统」的动作按 `process.platform` 分支选命令（见下表）。
- **吞吐统计**：`ctx.on('llm/stream', ...)` 包装 waterfall，按会话（`sessionId`/`agent.id`/`meta` 探测）维护 `{ phase: waiting|streaming|done, tokens, tps, ttft }`；首 chunk 到达标记 streaming（TTFT），结束后 4s 清除；`speed-status` 查询时按流开始累计秒数算平均 t/s（0.5s 暖机）。等待态文字用主题 token `--dsw-alias-label-caption`（与 shell 计时同款灰）。
- **宽度接管**：MutationObserver 监听 shell 框架的 `grid-template-columns`，把 details 轨改写为插件宽度（264–420px），并在 shell 重渲染后保持；`[data-side="details"]` 隐藏 shell 自带手柄，改用面板左缘自定义拖拽手柄。
- **主题**：全部使用 DSH 主题 token（`--dsw-specific-sidebar-fill`、`--dsw-alias-*` 等），跟随桌面明暗配色。

## 平台

| 平台 | 系统打开 (`open`) | 移到废纸篓 (`trash`) | 移动/新建/上传 |
| --- | --- | --- | --- |
| macOS | `/usr/bin/open` | Finder `osascript` | `node:fs` |
| Linux | `xdg-open` | `gio trash`（回退 `trash-cli`） | `node:fs` |
| Windows | `cmd /c start` | PowerShell `Shell.Application`（回收站） | `node:fs` |

> 文件核心（浏览/移动/新建/上传）三平台完全一致；仅「系统打开」与「移到废纸篓」依赖各平台自带工具，这是 VS Code / Electron 等所有应用的标准做法。

## 许可证

[MIT](LICENSE)
